// server/logx/v2/ocp-sync.cjs — Kesif onbellegini arka planda besleyen periyodik job.
//
// NEDEN VAR: kullanici sihirbazi actiginda namespace/uygulama listesi ANINDA gelsin
// istiyoruz. Onbellek yalnizca kullanici kesif yaptikca dolarsa ilk kullanimda hep bos
// olur; bu job aktif cluster'lari duzenli gezip listeyi taze tutar.
//
// VARSAYILAN KAPALI (`periodicSyncEnabled: false`): AWX'te otomatik job kosturan bir
// mekanizma, acikca istenmeden devreye girmemeli. Admin > OCP Calistirma Ayarlari'ndan
// acilir; acil durumda LOGX_OCP_SYNC_DISABLED=1 ile kod degisikligi olmadan durdurulur.
//
// Desen: server/metrics.cjs startSnapshotWriter — setInterval + unref (surecin
// kapanmasini engellemez), her tur try/catch ile izole.
'use strict';

const db = require('../../db/index.cjs');

let _timer = null;
let _running = false;   // ust uste calismayi onler (uzun suren tur bir sonrakini bloklamasin)

// Taranacak cluster'lar: yalnizca AKTIF ve calistirmak icin gereken metadata'si TAM olanlar.
// api_url/vault_credential_key eksikse playbook eski inventory yoluna duserdi; arka plan
// job'inda bunu denemek yerine atlamak daha dogru (sessiz hata uretmesin).
async function listSyncableClusters(limit) {
  const { rows } = await db.query(
    `SELECT TOP (${Number(limit) || 25}) env, tenant, cluster_name, terminal_host,
            api_url, vault_credential_key, last_synced_at
     FROM ocp_cluster_index
     WHERE is_active = 1
       AND api_url IS NOT NULL AND LEN(api_url) > 0
       AND vault_credential_key IS NOT NULL AND LEN(vault_credential_key) > 0
     ORDER BY CASE WHEN last_synced_at IS NULL THEN 0 ELSE 1 END, last_synced_at ASC`
  );
  return rows;
}

async function markSync(cluster, status, error) {
  try {
    await db.query(
      `UPDATE ocp_cluster_index
         SET last_synced_at = GETUTCDATE(), sync_status = $1, sync_error = $2
       WHERE env=$3 AND tenant=$4 AND cluster_name=$5`,
      [String(status).slice(0, 32), error ? String(error).slice(0, 1000) : null,
       cluster.env, cluster.tenant, cluster.cluster_name]
    );
  } catch (e) {
    console.warn('[OcpSync] durum yazilamadi:', e.message);
  }
}

// Bir tur: hic senkronlanmamis / en eski senkronlanmis cluster'lardan baslayarak
// namespace listesini tazeler. Uygulama taramasi BILEREK YOK — namespace basina ayri
// AWX job'i demek olurdu; uygulamalar kullanici "Burada kesfet" dedikce dolar.
async function runOnce() {
  if (_running) return { skipped: true, reason: 'already_running' };
  _running = true;
  const report = { scanned: 0, ok: 0, failed: 0 };
  try {
    const cfg = await require('./ocp-runtime-config.cjs').getConfig();
    if (!cfg.periodicSyncEnabled || process.env.LOGX_OCP_SYNC_DISABLED === '1') {
      return { skipped: true, reason: 'disabled' };
    }

    const clusters = await listSyncableClusters(cfg.periodicSyncMaxClusters);
    if (!clusters.length) return { skipped: true, reason: 'no_clusters' };

    // Bastion basina grupla: ayni bastiondaki cluster'lar TEK job'da taranir
    // (playbook zaten cok-cluster destekliyor).
    const byHost = new Map();
    for (const c of clusters) {
      const key = `${c.tenant}|${c.env}|${c.terminal_host || ''}`;
      if (!byHost.has(key)) byHost.set(key, []);
      byHost.get(key).push(c);
    }

    for (const group of byHost.values()) {
      report.scanned += group.length;
      try {
        await syncGroup(group);
        for (const c of group) await markSync(c, 'ok', null);
        report.ok += group.length;
      } catch (e) {
        for (const c of group) await markSync(c, 'error', e.message);
        report.failed += group.length;
        console.warn(`[OcpSync] grup taramasi basarisiz (${group[0].tenant}/${group[0].env}):`, e.message);
      }
    }
    return report;
  } catch (e) {
    console.warn('[OcpSync] tur calistirilamadi:', e.message);
    return { skipped: true, reason: 'error', error: e.message };
  } finally {
    _running = false;
  }
}

// Bir bastion grubunu tarar. Sihirbazdan BAGIMSIZ calisir: kendi "sistem" istegini
// olusturur, job'i baslatir ve terminal duruma kadar bekler.
async function syncGroup(group) {
  const jobs = require('./jobs.cjs');
  const requests = require('./requests.cjs');
  const ocp = require('./ocp.cjs');
  const cache = require('./ocp-cache.cjs');

  const first = group[0];
  const clusterNames = group.map((c) => c.cluster_name);

  // Arka plan taramasi icin teknik bir istek satiri — kullaniciya ait DEGIL.
  const request = await requests.createRequest(
    { username: 'system:ocp-sync', sessionToken: null }, 'openshift'
  );
  await requests.updateRequest(request.id, {
    state: 'draft',
    input: { env: first.env, tenant: first.tenant, clusters: clusterNames },
  });

  const row = await requests.getRequestRow(request.id);
  const job = await ocp.discoverNamespaces(row);

  // Terminal duruma kadar bekle (arka plan job'i — kullaniciyi bekletmiyoruz).
  const started = Date.now();
  const TIMEOUT_MS = 10 * 60 * 1000;
  let last = job;
  while (!jobs.TERMINAL_STATUSES.has(last.status)) {
    if (Date.now() - started > TIMEOUT_MS) throw new Error('Tarama zaman asimina ugradi.');
    await new Promise((r) => setTimeout(r, 5000));
    last = await jobs.pollJob(last);
  }
  if (!last.artifacts) throw new Error(last.errorMessage || 'Tarama sonuc uretmedi.');

  const normalized = last.artifacts;
  for (const c of normalized.clusters || []) {
    if (c.status !== 'ok') continue;
    await cache.putNamespaces({
      env: first.env, tenant: first.tenant, clusterName: c.cluster_name,
      namespaces: (c.namespaces || []).map((n) => String(n).replace(/^.*\//, '').trim()),
      source: 'periodic',
    });
  }
}

// Boot'ta cagrilir. Ilk tur 5 dk gecikmeli (acilis yukunu artirmasin).
function startOcpSync() {
  if (_timer) return;
  const boot = async () => {
    let intervalMin = 360;
    try {
      const cfg = await require('./ocp-runtime-config.cjs').getConfig();
      intervalMin = cfg.periodicSyncIntervalMin || 360;
      if (!cfg.periodicSyncEnabled || process.env.LOGX_OCP_SYNC_DISABLED === '1') {
        console.log('[OcpSync] periyodik besleme KAPALI (admin ekranindan acilabilir).');
      }
    } catch { /* varsayilan araligi kullan */ }

    _timer = setInterval(() => { runOnce().catch(() => {}); }, intervalMin * 60 * 1000);
    if (_timer.unref) _timer.unref();
    runOnce().catch(() => {});
  };
  setTimeout(() => { boot().catch(() => {}); }, 5 * 60 * 1000).unref?.();
}

function stopOcpSync() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { startOcpSync, stopOcpSync, runOnce, listSyncableClusters };
