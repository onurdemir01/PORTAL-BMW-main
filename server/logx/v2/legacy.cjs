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

// Transfer istegindeki `selected` dizisi icin azami govde boyutu.
// TURETME: global parser `express.json({ limit: "2mb" })` (server/service.cjs).
// Govdede `selected` disinda da alanlar var, ayrica base64/kacis genislemesi olabilir;
// bu yuzden parser limitinin YARISI alinir — sinira dayanan bir istek yine de parse
// EDILEBILIR olmali ki kullanici opak bir 413 yerine anlasilir bir 400 gorsun.
const EXPRESS_JSON_LIMIT_BYTES = 2 * 1024 * 1024;
const TRANSFER_SELECTION_MAX_BYTES = Math.floor(EXPRESS_JSON_LIMIT_BYTES / 2);


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

// Sihirbazin SUNUCU SECIMI adimi icin: uygulamanin sunuculari + ortam/JBoss/durum.
// `resolveHostsForApp` yalnizca host ADLARINI dondurur; secim ekraninda kullanicinin
// filtreleyebilmesi icin bu alanlar da gerekir (ayni tablo, tek sorgu).
// Durum CANLI SORGULANMAZ — envanterdeki `status` okunur (ucuz ve anlik).
async function listHostsForApp(app) {
  const appName = String(app || '').trim();
  if (!appName) throw Object.assign(new Error('Uygulama adı gerekli.'), { status: 400 });
  const pool = await inventoryDb.getPool();
  if (!pool) throw Object.assign(new Error('Envanter DB bağlantısı yok.'), { status: 503 });
  const req = pool.request();
  req.input('app', appName);
  const result = await req.query(
    `SELECT DISTINCT UPPER(host) AS host, env, jboss_version, status
     FROM ${getAppsTable()} WHERE app = @app ORDER BY host`
  );
  return result.recordset
    .filter((r) => r.host)
    .map((r) => ({
      host: String(r.host).trim(),
      env: String(r.env || '').trim(),
      jbossVersion: String(r.jboss_version || '').trim(),
      status: String(r.status || '').trim().toLowerCase(),
    }));
}

// POST /legacy/:requestId/discover
//
// `selectedHosts`: kullanicinin SUNUCU SECIMI adiminda isaretledigi hostlar. Bos ise eski
// davranis korunur (uygulamanin TUM hostlari taranir) — boylece bu alani gondermeyen eski
// istemciler kirilmaz.
//
// ANTI-TOCTOU: client'in gonderdigi listeye guvenilmez; secim envanterden yeniden cozulen
// host kumesine karsi suzulur. Aksi halde kullanici bu uygulamaya ait OLMAYAN bir sunucuda
// log taratabilirdi.
async function discover(requestRow, app, selectedHosts) {
  const inventoryHosts = await resolveHostsForApp(app, false).catch(() => []);
  const allowed = new Set(inventoryHosts.map((h) => String(h).toUpperCase()));

  const requested = Array.isArray(selectedHosts)
    ? [...new Set(selectedHosts.map((h) => String(h || '').trim().toUpperCase()).filter(Boolean))]
    : [];

  let hosts;
  if (requested.length) {
    const notMine = requested.filter((h) => !allowed.has(h));
    if (notMine.length) {
      throw Object.assign(
        new Error(`Bu sunucular seçilen uygulamaya ait değil: ${notMine.join(', ')}`),
        { status: 400 }
      );
    }
    hosts = requested;
  } else {
    // Secim yok → eski davranis. Envanter okunamadiysa (DB kesintisi) snapshot yoluna dus.
    hosts = inventoryHosts.length ? inventoryHosts : await resolveHostsForApp(app, true);
  }

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

  // ── UST SINIR (2026-08-28) ──────────────────────────────────────────────────
  // Buraya kadar HICBIR ust sinir yoktu (tek kontrol `=== 0`). Oysa gercek bir tavan
  // VAR ve fark edilmeden carpiliyordu: bu istegin govdesi `express.json({limit:"2mb"})`
  // parser'indan geciyor (server/service.cjs). Secim buyudugunde istek handler'a HIC
  // ULASMIYOR, body-parser 413 firlatiyor ve kullanici "transfer basarisiz" disinda
  // hicbir sey gormuyordu.
  //
  // Sinir UYDURULMADI, gercek tavandan TURETILDI: govdenin yalnizca `selected` kismi
  // olculur ve parser limitinin guvenli bir kesrini asarsa ANLASILIR bir 400 doner.
  // Istemci ayni hesabi yapip kullaniciyi daha secim ekranindayken uyarir
  // (bkz. src/components/logx_v2/shared/selectionLimits.ts — AYNI sabitler).
  const selectedBytes = Buffer.byteLength(JSON.stringify(selected), 'utf8');
  if (selectedBytes > TRANSFER_SELECTION_MAX_BYTES) {
    throw Object.assign(
      new Error(
        `Seçim çok büyük (${selected.length} dosya, ~${Math.round(selectedBytes / 1024)} KB). ` +
        `İstek gövdesi sınırı ${Math.round(TRANSFER_SELECTION_MAX_BYTES / 1024)} KB. ` +
        `Daha az dosya seçin ya da transferi birkaç parçaya bölün.`
      ),
      { status: 400, code: 'selection_too_large' }
    );
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
    // UZAK host'ta olusturulacak yedek dizin (bkz. downloads.remoteFallbackDir). Portalin
    // okuma tarafi (stagingRoots) hem bunu hem yerel ingest dizinini tarar — eskiden yalniz
    // yerel dizini tariyordu ve fallback'e dusen arsiv asla servis edilemiyordu.
    fallback_dir: require('./downloads.cjs').remoteFallbackDir(),
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

module.exports = { searchApps, resolveHostsForApp, listHostsForApp, discover, finalizeDiscovery, transfer };
