// server/logx/v2/legacy.cjs — Legacy (JBoss /vhosting, /vhosting8) akisi: EnvanterApps'e
// dayali uygulama arama, kesif (discovery) ve transfer job'larinin baslatilmasi, TOCTOU
// dogrulamasi. EnvanterApps genel Envanter DB'sinde yasar (server/inventory/mssql.cjs) —
// bu portalin kendi tablosu DEGIL, salt-okunur sorgulanir.
'use strict';

const fs = require('fs');
const path = require('path');
const inventoryDb = require('../../inventory/mssql.cjs');
const jobs = require('./jobs.cjs');
const requests = require('./requests.cjs');
const adminData = require('./admin.cjs');
const { getAppsTable } = require('../../config/apps-table.cjs');

const SNAPSHOT_FILE = path.join(__dirname, '..', '..', 'data', 'logx-legacy-snapshot.json');

function readSnapshot() {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return { apps: [], appHosts: {}, generatedAt: null };
    return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf-8'));
  } catch {
    return { apps: [], appHosts: {}, generatedAt: null };
  }
}

// Her basarili DB sorgusunda fire-and-forget guncellenir — DB kapandiginda son bilinen
// iyi durumun kullanilabilmesi icin (bkz. plan dosyasi B-new-7, kullanici karari §2).
function writeSnapshotAsync(apps, appHosts) {
  try {
    fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify({ apps, appHosts, generatedAt: new Date().toISOString() }, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[LogXv2] Legacy snapshot yazilamadi:', err.message);
  }
}

// GET /legacy/apps?search= — DISTINCT app adlari. DB erisilemezse son bilinen snapshot'a duser.
async function searchApps(search) {
  const term = String(search || '').trim();
  try {
    const pool = await inventoryDb.getPool();
    if (!pool) throw new Error('Envanter DB bağlantısı yok.');
    const req = pool.request();
    req.input('q', `%${term}%`);
    const result = await req.query(
      `SELECT DISTINCT app FROM ${getAppsTable()} WHERE app LIKE @q ORDER BY app`
    );
    const apps = result.recordset.map((r) => r.app);

    // Snapshot'i arka planda tazele (yalnizca bos arama = tam liste iken, snapshot'in
    // gereksiz yere kismi bir alt kumeye indirgenmemesi icin).
    if (!term) {
      refreshFullSnapshot(pool).catch(() => {});
    }
    return { apps, fallbackMode: false };
  } catch (err) {
    console.warn(`[LogXv2] ${getAppsTable()} sorgusu basarisiz, snapshot fallback kullaniliyor:`, err.message);
    const snap = readSnapshot();
    const apps = term
      ? snap.apps.filter((a) => a.toUpperCase().includes(term.toUpperCase()))
      : snap.apps;
    return { apps, fallbackMode: true };
  }
}

async function refreshFullSnapshot(pool) {
  const allApps = await pool.request().query(`SELECT DISTINCT app FROM ${getAppsTable()} ORDER BY app`);
  const allHosts = await pool.request().query(`SELECT app, UPPER(host) AS host FROM ${getAppsTable()}`);
  const appHosts = {};
  for (const row of allHosts.recordset) {
    appHosts[row.app] ??= [];
    if (!appHosts[row.app].includes(row.host)) appHosts[row.app].push(row.host);
  }
  writeSnapshotAsync(allApps.recordset.map((r) => r.app), appHosts);
}

// Bir app icin TUM host satirlarini (buyuk harf) doner — EnvanterApps.env sutunu
// guvenilmez oldugu icin burada hic okunmuyor (kullanici karari, plan dosyasi §1).
async function resolveHostsForApp(app, fallbackMode) {
  if (fallbackMode) {
    const snap = readSnapshot();
    return snap.appHosts[app] || [];
  }
  const pool = await inventoryDb.getPool();
  if (!pool) throw Object.assign(new Error('Envanter DB bağlantısı yok.'), { status: 503 });
  const req = pool.request();
  req.input('app', app);
  const result = await req.query(`SELECT DISTINCT UPPER(host) AS host FROM ${getAppsTable()} WHERE app = @app`);
  return result.recordset.map((r) => r.host);
}

// POST /legacy/:requestId/discover
async function discover(requestRow, app, fallbackHosts) {
  const fallbackMode = Array.isArray(fallbackHosts) && fallbackHosts.length > 0;
  const hosts = fallbackMode ? fallbackHosts.map((h) => String(h).toUpperCase()) : await resolveHostsForApp(app, false);
  if (hosts.length === 0) {
    throw Object.assign(new Error('Bu uygulama için envanterde host bulunamadı.'), { status: 404 });
  }

  const job = await jobs.launchJob(requestRow.request_id, 'legacy_discovery', {
    app_name: app,
    target_hosts: hosts.join(','),
  });

  await requests.updateRequest(requestRow.request_id, {
    state: 'discovering',
    input: { app, hosts },
  });
  return job;
}

// Discovery job'i terminal duruma ulastiginda (jobs.pollJob tarafindan cagrilir) — artifacts'i
// discovery_result_json'a yazar, ortam etiketlerini logx_env_suffix_map ile turetir.
async function finalizeDiscovery(requestRow, job) {
  if (!job.artifacts) {
    await requests.updateRequest(requestRow.request_id, { state: 'failed', errorMessage: job.errorMessage || 'Keşif başarısız oldu.' });
    return;
  }
  const suffixRows = await adminData.listEnvSuffixMap();
  const hosts = job.artifacts.hosts || [];
  for (const hostEntry of hosts) {
    for (const file of hostEntry.files || []) {
      const folderMatch = /\/([^/]+)\.ear\//.exec(file.path || '');
      const folderName = folderMatch ? folderMatch[1] : '';
      file.environment = await adminData.resolveEnvLabel(folderName, suffixRows);
    }
  }
  await requests.updateRequest(requestRow.request_id, {
    state: job.artifacts.overall_status === 'failed' ? 'failed' : 'discovered',
    discoveryResult: job.artifacts,
    errorMessage: job.artifacts.overall_status === 'failed' ? 'Tüm sunucularda keşif başarısız oldu.' : null,
  });
}

// POST /legacy/:requestId/transfer — Anti-TOCTOU: her (host,path) cifti discovery_result_json'a
// BIREBIR eslesmelidir; aksi halde HICBIR job launch edilmez.
async function transfer(requestRow, selected) {
  const discoveryResult = requestRow.discovery_result_json ? JSON.parse(requestRow.discovery_result_json) : null;
  if (!discoveryResult) {
    throw Object.assign(new Error('Önce keşif tamamlanmalı.'), { status: 400 });
  }
  const validPairs = new Set();
  for (const hostEntry of discoveryResult.hosts || []) {
    for (const file of hostEntry.files || []) {
      validPairs.add(`${hostEntry.host}::${file.path}`);
    }
  }
  const invalid = (selected || []).filter((s) => !validPairs.has(`${s.host}::${s.path}`));
  if (invalid.length > 0) {
    throw Object.assign(
      new Error('Seçilen dosyalardan bazıları keşif sonucuyla eşleşmiyor — işlem reddedildi.'),
      { status: 400, code: 'toctou_mismatch', invalid }
    );
  }
  if (selected.length === 0) {
    throw Object.assign(new Error('En az bir dosya seçilmeli.'), { status: 400 });
  }

  const archiveName = `${cryptoRandomId()}.zip`;
  // A4 fetch-back: kaynak host NFS'e yazamazsa arsivi bu URL'ye push edebilir (bkz. ingest.cjs).
  // DB yoksa null → sadece NFS yolu kalir (graceful).
  const ingestInfo = await require('./ingest.cjs')
    .issueIngestToken({ requestId: requestRow.request_id, filename: archiveName })
    .catch(() => null);
  const job = await jobs.launchJob(requestRow.request_id, 'legacy_transfer', {
    selected_files: selected,
    staging_dir: process.env.LOGX_V2_STAGING_LEGACY_DIR || '/sw/BMW_PORTAL/logs/legacy',
    fallback_dir: process.env.LOGX_STAGING_FALLBACK_DIR || '/tmp/logx-v2-fallback',
    archive_name: archiveName,
    ...(ingestInfo ? { ingest_url: ingestInfo.url } : {}),
  });

  await requests.updateRequest(requestRow.request_id, {
    state: 'transferring',
    selectedFiles: selected,
  });
  return job;
}

function cryptoRandomId() {
  return require('crypto').randomBytes(16).toString('hex');
}

module.exports = { searchApps, resolveHostsForApp, discover, finalizeDiscovery, transfer };
