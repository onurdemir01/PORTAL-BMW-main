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

// Arka plan isteklerinin sahibi. Admin ekranindaki istek listesi bu adla filtrelenebilsin
// ve temizlik bu satirlari tanisin diye tek yerde tanimli.
const SYNC_USERNAME = 'system:ocp-sync';

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
        // Cluster BASINA durum: eskiden grubun tamami 'ok' isaretleniyordu, bu yuzden
        // erisilemeyen bir cluster hem tanilamada basarili gorunuyor hem de
        // `last_synced_at` guncellendigi icin siranin en sonuna atiliyordu.
        const perCluster = await syncGroup(group);
        for (const c of group) {
          const err = perCluster.get(c.cluster_name);
          await markSync(c, err ? 'error' : 'ok', err || null);
          if (err) report.failed++; else report.ok++;
        }
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
  // `session_token` kolonu NOT NULL: null gecmek her turda INSERT hatasi verirdi.
  // Sabit, oturuma karsilik gelmeyen bir belirtec kullaniyoruz (hicbir oturum dogrulamasi
  // bu degeri kabul etmez, yalniz kolonu doldurur).
  const request = await requests.createRequest(
    { username: SYNC_USERNAME, sessionToken: 'ocp-sync', role: 'System' }, 'openshift'
  );
  await requests.updateRequest(request.id, {
    state: 'draft',
    input: { env: first.env, tenant: first.tenant, clusters: clusterNames },
  });

  // Cluster adi → hata metni (bos = basarili). Cagiran her cluster'in durumunu ayri yazar.
  const errors = new Map();
  try {
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

    const reported = new Set();
    for (const c of last.artifacts.clusters || []) {
      reported.add(c.cluster_name);
      if (c.status !== 'ok') { errors.set(c.cluster_name, c.error || 'Cluster taranamadi.'); continue; }
      await cache.putNamespaces({
        env: first.env, tenant: first.tenant, clusterName: c.cluster_name,
        namespaces: (c.namespaces || []).map((n) => String(n).replace(/^.*\//, '').trim()),
        source: 'periodic',
      });
    }
    // Sonuc uretmeyen cluster da basarili sayilmamali.
    for (const name of clusterNames) {
      if (!reported.has(name)) errors.set(name, 'Playbook bu cluster icin sonuc dondurmedi.');
    }

    // ── Uygulama kesfi ────────────────────────────────────────────────────────
    // NEDEN: periyodik sync eskiden YALNIZCA namespace yaziyordu; uygulama onbellegi hic
    // beslenmiyordu. Kullanicinin en sik bekledigi job da buydu ("Bu namespace'i tara",
    // ~1 dk). Namespaceleri tararken uygulamalari da doldurursak o beklemeyi buyuk olcude
    // ortadan kaldiririz. Basarisizligi TURU DUSURMEZ: namespace onbellegi zaten yazildi.
    await syncApps({ request, first, artifacts: last.artifacts }).catch((e) => {
      console.warn('[OcpSync] uygulama kesfi atlandi:', e.message);
    });

    return errors;
  } finally {
    // Teknik istek satiri isini bitirdi. Silinmezse her turda bir satir birikir ve
    // `namespace_discovering` durumunda takili kalarak admin istek listesini doldurur.
    // Job satirlari ON DELETE CASCADE ile birlikte gider.
    await db.query('DELETE FROM logx_v2_requests WHERE request_id = $1 AND username = $2',
      [request.id, SYNC_USERNAME]).catch((e) => {
      console.warn('[OcpSync] teknik istek satiri silinemedi:', e.message);
    });
  }
}

// Namespace taramasinin ARDINDAN ayni teknik istek satiriyla uygulama kesfi calistirir
// ve sonucu onbellege `periodic` kaynagiyla yazar. Namespace sayisi yapilandirilabilir
// bir tavanla sinirlidir (`periodicSyncMaxNamespaces`, 0 = kapali) — aksi halde yuzlerce
// namespace'li bir cluster tek turda AWX'i doldururdu.
async function syncApps({ request, first, artifacts }) {
  const cfg = await require('./ocp-runtime-config.cjs').getConfig();
  const maxNs = Number(cfg.periodicSyncMaxNamespaces || 0);
  if (maxNs <= 0) return;

  const jobs = require('./jobs.cjs');
  const requests = require('./requests.cjs');
  const ocp = require('./ocp.cjs');
  const cache = require('./ocp-cache.cjs');

  // Yalnizca BASARILI cluster'larin namespace'leri; tekillestirilip tavana kirpilir.
  const nsSet = new Set();
  for (const c of artifacts.clusters || []) {
    if (c.status !== 'ok') continue;
    for (const n of c.namespaces || []) {
      const clean = String(n).replace(/^.*\//, '').trim();
      if (clean) nsSet.add(clean);
    }
  }
  const namespaces = [...nsSet].sort().slice(0, maxNs);
  if (!namespaces.length) return;
  if (nsSet.size > namespaces.length) {
    // Sessiz kirpma YOK: hangi kismin taranmadigi loga yazilir.
    console.warn(`[OcpSync] ${first.tenant}/${first.env}: ${nsSet.size} namespace'ten ilk ${namespaces.length} tanesi tarandi (periodicSyncMaxNamespaces).`);
  }

  const row = await requests.getRequestRow(request.id);
  const job = await ocp.discoverApps(row, namespaces);

  const started = Date.now();
  const TIMEOUT_MS = 15 * 60 * 1000;
  let last = job;
  while (!jobs.TERMINAL_STATUSES.has(last.status)) {
    if (Date.now() - started > TIMEOUT_MS) throw new Error('Uygulama kesfi zaman asimina ugradi.');
    await new Promise((r) => setTimeout(r, 5000));
    last = await jobs.pollJob(last);
  }
  if (!last.artifacts) throw new Error(last.errorMessage || 'Uygulama kesfi sonuc uretmedi.');

  const parsed = require('./ocp-app-parse.cjs').parseAppDiscoveryResult(last.artifacts);
  const { written } = await cache.putApps({
    env: first.env, tenant: first.tenant, entries: parsed.entries, source: 'periodic',
  });
  console.log(`[OcpSync] ${first.tenant}/${first.env}: ${namespaces.length} namespace, ${written} uygulama onbellege yazildi.`);
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
