// server/scalex/state.cjs — "su an ne durdurulmus" aynasi ve SAPMA tespiti.
//
// GERCEGIN KAYNAGI CLUSTER'DIR: her durdurulmus uygulamanin onceki replica sayisi
// namespace icindeki `scalex-state-<app>` ConfigMap'inde durur ve playbook onu
// yonetir. Portal AYNA tutar — cunku ConfigMap "kim, neden, hangi talep numarasiyla"
// sorusunu cevaplamaz ve her soruda 48 cluster'a gitmek pratik degildir.
//
// Iki kaynak AYRISABILIR ve bu NORMAL bir durumdur:
//   * biri AWX'ten elle geri almistir  → portalda kayit var, cluster'da ConfigMap yok
//   * biri AWX'ten elle durdurmustur   → cluster'da ConfigMap var, portalda kayit yok
// Ekran bunu GIZLEMEZ, gosterir. Gizlemek "portal yaniliyor" demek olurdu; gostermek
// "birisi portal disindan is yapmis" demek — ikincisi kullanicinin bilmesi gereken sey.
'use strict';

const db = require('../db/index.cjs');

const DRIFT = Object.freeze({
  IN_SYNC: 'in_sync',
  MISSING_ON_CLUSTER: 'missing_on_cluster',   // portalda var, cluster'da yok
  UNKNOWN_TO_PORTAL: 'unknown_to_portal',     // cluster'da var, portalda yok
});

function keyOf(r) {
  return [r.env, r.tenant, r.clusterName ?? r.cluster_name, r.namespace, r.appName ?? r.app_name].join('\u001f');
}

// SAF FONKSIYON — DB gerektirmez, bu yuzden dogrudan test edilir.
// Portal aynasi ile cluster gercegini karsilastirip her satirin sapma durumunu verir.
// `clusterStates` yalnizca TARANAN cluster'lari kapsar; taranmamis bir cluster'in ayna
// satiri "kayip" sayilmamalidir (yoksa erisilemeyen bir bastion, tum kayitlari yanlislikla
// "biri elle geri almis" gibi gosterirdi).
function classifyDrift({ mirrorRows = [], clusterStates = [], scannedClusters = [] }) {
  const scanned = new Set(scannedClusters);
  const clusterByKey = new Map(clusterStates.map((s) => [keyOf(s), s]));
  const mirrorByKey = new Map(mirrorRows.map((m) => [keyOf(m), m]));
  const out = [];

  for (const m of mirrorRows) {
    const k = keyOf(m);
    const onCluster = clusterByKey.get(k);
    const clusterName = m.clusterName ?? m.cluster_name;
    let drift;
    if (onCluster) drift = DRIFT.IN_SYNC;
    else if (scanned.has(clusterName)) drift = DRIFT.MISSING_ON_CLUSTER;
    else drift = null;   // taranmadi → KARAR VERME, eski durumu koru
    out.push({ ...m, source: 'portal', onCluster: !!onCluster, drift });
  }

  for (const s of clusterStates) {
    if (mirrorByKey.has(keyOf(s))) continue;
    out.push({ ...s, source: 'cluster', onCluster: true, drift: DRIFT.UNKNOWN_TO_PORTAL });
  }
  return out;
}

// UST SINIR: "su an durdurulmus" listesi tasarim geregi kisadir, ama bir olay sonrasi
// yuzlerce uygulama durdurulmus olabilir. Sinirsiz birakmak, tek bir istegin butun
// aynayi belege cekmesi demekti. Sinir asilirsa cagiran taraf bunu KULLANICIYA soyler
// (sessizce kirpmak, "hepsi bu kadar" yalanini soylerdi).
// NOT: asagidaki SQL'de `TOP 501` ELLE yazili (MIRROR_LIMIT + 1). SQL metnine sablon
// degiskeni koymak bu modulde bekci tarafindan yasak — sabit bile olsa. Ikisi ayrisirsa
// `MIRROR_LIMIT_SQL_GUARD` testi kirmizi olur.
const MIRROR_LIMIT = 500;

async function listMirror({ env, tenant, clusterName = null }) {
  const params = [env, tenant];
  let sql = `SELECT TOP 501 * FROM scalex_state_mirror WHERE env = $1 AND tenant = $2`;
  if (clusterName) { params.push(clusterName); sql += ` AND cluster_name = $3`; }
  const { rows } = await db.query(`${sql} ORDER BY cluster_name, namespace, app_name`, params);
  // Bir fazla cekip kirpiyoruz: "daha var mi" sorusunu ikinci bir COUNT sorgusu
  // olmadan cevaplamanin en ucuz yolu.
  const truncated = rows.length > MIRROR_LIMIT;
  return Object.assign(rows.slice(0, MIRROR_LIMIT).map(normalizeRow), { truncated });
}

function normalizeRow(r) {
  return {
    id: r.id, env: r.env, tenant: r.tenant, clusterName: r.cluster_name,
    namespace: r.namespace, appName: r.app_name, workloadKind: r.workload_kind,
    previousReplicas: r.previous_replicas, phase: r.phase,
    stoppedBy: r.stopped_by, stoppedAt: r.stopped_at, operationId: r.operation_id,
    lastSeenAt: r.last_seen_at, driftStatus: r.drift_status,
  };
}

// Bir `stop` islemi basariyla dogrulandiginda cagrilir.
async function upsertStopped({ env, tenant, clusterName, namespace, appName, workloadKind, previousReplicas, stoppedBy, operationId }) {
  const { rows } = await db.query(
    `MERGE scalex_state_mirror AS t
     USING (SELECT $1 AS env, $2 AS tenant, $3 AS cluster_name, $4 AS namespace, $5 AS app_name) AS s
       ON t.env = s.env AND t.tenant = s.tenant AND t.cluster_name = s.cluster_name
      AND t.namespace = s.namespace AND t.app_name = s.app_name
     WHEN MATCHED THEN UPDATE SET
       workload_kind = $6, previous_replicas = $7, phase = 'scaled_down',
       stopped_by = $8, stopped_at = GETUTCDATE(), operation_id = $9,
       last_seen_at = GETUTCDATE(), drift_status = 'in_sync', updated_at = GETUTCDATE()
     WHEN NOT MATCHED THEN INSERT
       (env, tenant, cluster_name, namespace, app_name, workload_kind, previous_replicas,
        phase, stopped_by, stopped_at, operation_id, last_seen_at, drift_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'scaled_down',$8,GETUTCDATE(),$9,GETUTCDATE(),'in_sync')
     OUTPUT INSERTED.*;`,
    [env, tenant, clusterName, namespace, appName, workloadKind || null,
      Number.isFinite(previousReplicas) ? previousReplicas : null, stoppedBy, operationId || null]
  );
  return rows[0] ? normalizeRow(rows[0]) : null;
}

// ── GERI ALMA KILIDI ────────────────────────────────────────────────────────
//
// COZDUGU SORUN: sunucuda ayni hedefe ikinci bir geri alma baslatmayi engelleyen
// HICBIR kontrol yoktu. Ayna satiri ancak `finalizeOperation` ile siliniyor (tarayici
// yoklamasi ya da 120 sn'lik uzlastirici), yani is calisirken liste hala "durdurulmus"
// gosteriyor ve kullanici ayni satira tekrar basabiliyor. Asil tehlike ikinci geri
// alma degil — playbook onu zararsiz karsiliyor ("Already at restore target") — asil
// tehlike GERI ALMA ile yeni bir DURDURMANIN cakismasi: geri alma durum kaydini
// silerken durdurma yenisini yaziyor ve uygulama "0 replica + kayit yok" halinde
// kalabiliyor. O durumda portal icinden geri alinamaz, `/adopt` gerekir.
//
// NEDEN ZAMAN PENCERESI YOK: `created_at` tabanli bir pencere hem GEVSEK hem SIKI
// olurdu. 40 dakikalik bir is 31. dakikada kilidini kaybeder; 2. dakikada asilan bir
// is 30 dakika kilitler; SMART onayi saatlerce bekleyebilir; ve "Once kontrol et"
// (dry_run) calistirmalari gercek bir geri almayi bloke ederdi.
//
// COZUM: aynanin KENDISINDE tek ifadelik compare-and-set. `UNIQUE(env, tenant,
// cluster_name, namespace, app_name)` zaten var, yani kilit dogal olarak UYGULAMA
// BAZINDA calisir — `app_names_json` kesisimi, `OPENJSON` ya da yeni bir indeks
// GEREKMEZ. `rowCount === 0` ⇒ ya geri alinacak kayit yok ya baskasi aldi; iki
// durumda da is baslatilmamali. TOCTOU yok: kontrol ve yazma TEK ifade.
// UC DURUM, IKISI FARKLI SEY: "aynada kayit yok" bir CAKISMA DEGILDIR.
//   'locked' → kilit alindi, is baslatilabilir
//   'busy'   → kayit var ama zaten kilitli, yani bir geri alma SURUYOR → 409
//   'absent' → aynada kayit yok. Bu MESRU bir durum: AWX'ten ELLE durdurulmus bir
//              uygulamanin cluster'da ConfigMap'i vardir ama portal kaydi yoktur
//              (sapma: `unknown_to_portal`). Onu 409 ile reddetmek, bugun calisan
//              bir yolu KAPATMAK olurdu — kilitlenecek bir sey yok, is gecer.
async function tryLockRestore({ env, tenant, clusterName, namespace, appName }) {
  const params = [env, tenant, clusterName, namespace, appName];
  // `operation_id`e DOKUNULMAZ: o alan uygulamayi DURDURAN islemi gosteriyor ve
  // "geri alma yolu" o baglantiya dayaniyor.
  const { rowCount } = await db.query(
    `UPDATE scalex_state_mirror
        SET phase = 'restoring', updated_at = GETUTCDATE()
      WHERE env=$1 AND tenant=$2 AND cluster_name=$3 AND namespace=$4 AND app_name=$5
        AND phase = 'scaled_down'`,
    params
  );
  if (rowCount > 0) return 'locked';
  const { rows } = await db.query(
    `SELECT TOP 1 phase FROM scalex_state_mirror
      WHERE env=$1 AND tenant=$2 AND cluster_name=$3 AND namespace=$4 AND app_name=$5`,
    params
  );
  return rows.length ? 'busy' : 'absent';
}

// KILIDI BIRAK. Basarili geri almada satir zaten SILINIYOR (`clearRestored`); bu
// fonksiyon BASARISIZ ve YARIDA KALAN yollar icin: kapi reddettiginde, hedef FAIL
// dondugunde ve uzlastiricinin yetim kilit turunda. Birakma yollari eksiksiz
// olmazsa KALICI kilit dogar — kullanici bir daha hic geri alamaz.
async function unlockRestore({ env, tenant, clusterName, namespace, appName }) {
  const { rowCount } = await db.query(
    `UPDATE scalex_state_mirror
        SET phase = 'scaled_down', updated_at = GETUTCDATE()
      WHERE env=$1 AND tenant=$2 AND cluster_name=$3 AND namespace=$4 AND app_name=$5
        AND phase = 'restoring'`,
    [env, tenant, clusterName, namespace, appName]
  );
  return rowCount > 0;
}

// Su an kilitli olan satirlar. Uzlastirici bunlari calisan islemlerle karsilastirip
// yetim kalanlari birakir — ZAMAN PENCERESIYLE DEGIL, `scalex_operations.status`u
// kaynak alarak. Kesisim SQL'de degil JS'te yapilir: `app_names_json` bir JSON dizi
// ve `OPENJSON` hem uyumluluk seviyesi 130+ ister hem SARGable degildir
// (ayni gerekce: server/logx/v2/restrictions.cjs).
async function listLockedRestores() {
  const { rows } = await db.query(
    `SELECT TOP 500 env, tenant, cluster_name, namespace, app_name, updated_at
       FROM scalex_state_mirror WHERE phase = 'restoring'`
  );
  return rows.map((r) => ({
    env: r.env, tenant: r.tenant, clusterName: r.cluster_name,
    namespace: r.namespace, appName: r.app_name, updatedAt: r.updated_at,
  }));
}

// Basarili bir `restore` sonrasi. Satir SILINIR: "durdurulmus" listesi yalnizca gercekten
// durdurulmus olanlari gostermeli, "eskiden durdurulmustu" gecmisi `scalex_operations`
// tablosunda zaten duruyor.
async function clearRestored({ env, tenant, clusterName, namespace, appName }) {
  const { rowCount } = await db.query(
    `DELETE FROM scalex_state_mirror
      WHERE env=$1 AND tenant=$2 AND cluster_name=$3 AND namespace=$4 AND app_name=$5`,
    [env, tenant, clusterName, namespace, appName]
  );
  return rowCount > 0;
}

// KAPSAMSIZ liste: kullanicinin gorebildigi TUM durdurulmus kayitlar. "Hizli aksiyon"
// paneli sihirbazin ILK adiminda da gorunuyor ve orada henuz secilmis bir env/tenant
// yok.
//
// NEDEN AYRI FONKSIYON, `listMirror`a opsiyonel parametre DEGIL: `(($1 = '') OR env = $1)`
// gibi bir numara hem SARGable degildir (yani `IX_scalexmirror_scope` indeksi
// kullanilamaz) hem de `listMirror`in parametre sayisini kilitleyen C5 bekcisini
// bozardi. Iki sabit SQL, tek dinamik SQL'den iyidir.
//
// SIRALAMA env/tenant ILE BASLAR: kapsamsiz listede tavan (`TOP 501`) yetki
// suzgecinden ONCE uygulaniyor; cluster adina gore siralamak, kullanicinin kendi
// kaydini alfabetik olarak sona atip listeden dusurebilirdi.
async function listMirrorAll() {
  const { rows } = await db.query(
    `SELECT TOP 501 * FROM scalex_state_mirror
      ORDER BY env, tenant, cluster_name, namespace, app_name`
  );
  const truncated = rows.length > MIRROR_LIMIT;
  return Object.assign(rows.slice(0, MIRROR_LIMIT).map(normalizeRow), { truncated });
}

// `scalex_state_audit` kesfinden sonra sapma durumlarini tazeler. Taranmayan cluster'lara
// DOKUNMAZ (bkz. classifyDrift gerekcesi).
async function refreshDrift({ env, tenant, scannedClusters, clusterStates }) {
  const mirrorRows = await listMirror({ env, tenant });
  const classified = classifyDrift({ mirrorRows, clusterStates, scannedClusters });

  for (const row of classified) {
    if (row.source !== 'portal' || row.drift === null) continue;
    await db.query(
      `UPDATE scalex_state_mirror
          SET drift_status = $1, last_seen_at = GETUTCDATE(), updated_at = GETUTCDATE()
        WHERE id = $2`,
      [row.drift, row.id]
    );
  }
  return classified;
}

// Cluster'da durdurulmus ama portalda kaydi olmayan bir uygulamayi portala alir
// ("Portala Al"). Kullaniciyi kaydin SAHIBI yapmaz — `stopped_by` bilinmiyorsa
// ConfigMap'teki `created_by` yazilir, o da yoksa acikca 'bilinmiyor'.
async function adopt({ env, tenant, clusterName, namespace, appName, workloadKind, previousReplicas, stoppedBy, adoptedBy }) {
  const row = await upsertStopped({
    env, tenant, clusterName, namespace, appName, workloadKind, previousReplicas,
    stoppedBy: stoppedBy || 'bilinmiyor', operationId: null,
  });
  await db.query(
    `UPDATE scalex_state_mirror SET drift_status = 'in_sync', updated_at = GETUTCDATE() WHERE id = $1`,
    [row.id]
  );
  return { ...row, adoptedBy };
}

module.exports = {
  tryLockRestore, unlockRestore, listLockedRestores, listMirrorAll,
  MIRROR_LIMIT, DRIFT, classifyDrift, listMirror, upsertStopped, clearRestored, refreshDrift, adopt };
