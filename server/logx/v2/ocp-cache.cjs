// server/logx/v2/ocp-cache.cjs — OCP namespace ve uygulama kesif sonuclarinin onbellegi.
//
// NEDEN VAR: kesif sonuclari bugune kadar REQUEST-SCOPED idi
// (logx_v2_requests.discovery_result_json, 24s TTL) — her kullanici her seferinde yeniden
// AWX job'i calistiriyor, sonuc kimseyle paylasilmiyordu. Bu katman sonucu paylasilir
// hale getirir: sihirbaz ONCE buradan okur, kullanici aradigini bulamazsa "Burada kesfet"
// ile taze tarama tetikler.
//
// TTL FELSEFESI: suresi dolan kayit SILINMEZ. `stale: true` ile yine dondurulur —
// bayat liste, hic liste olmamasindan iyidir (bkz. legacy.cjs snapshot fallback deseni).
// Kullanici bayatligi rozetten gorur ve isterse yeniden tarar.
'use strict';

const db = require('../../db/index.cjs');

// TTL saatleri admin ekranindan yonetilir (logx:ocp-runtime blob'u).
async function ttlHours() {
  try {
    const cfg = await require('./ocp-runtime-config.cjs').getConfig();
    return { ns: cfg.nsCacheTtlHours, app: cfg.appCacheTtlHours };
  } catch {
    return { ns: 24, app: 12 };
  }
}

// Tur baslangicini SUNUCU saatinden alir: portal ile veritabani saatleri kaymissa
// "bu turda yazildi mi" karsilastirmasi yanlis sonuc verirdi.
async function dbNow() {
  const { rows } = await db.query('SELECT GETUTCDATE() AS now_utc');
  return rows[0].now_utc;
}

// Kubernetes obje adlari 253 karaktere kadar cikabilir ama `app_name` kolonu (UNIQUE
// indeks 900 bayt sinirina sigsin diye) 150. Uzun adi kesmek YANLIS bir kayit uretirdi;
// MSSQL'e oldugu gibi gondermek ise "String or binary data would be truncated" ile o
// namespace'in TUM yazimini dusururdu. Bu yuzden yalniz o obje atlanir.
const APP_NAME_MAX = 150;

// k8s `creationTimestamp` (ISO8601) → Date. Bicimi bozuk gelirse null: gecersiz bir tarihi
// DATETIME2'ye gondermek o namespace'in tum yazimini dusururdu.
function toDateOrNull(value) {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isFinite(d.getTime()) ? d : null;
}

function isStale(expiresAt) {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() < Date.now();
}

// UPDATE-once, 0 satir etkilendiyse INSERT (repo genelindeki upsert deseni —
// bkz. server/nobetci/index.cjs). Transaction API'si olmadigi icin toplu yazim
// satir-satir yapilir; UNIQUE kisiti es zamanli yazimlarda son sozu soyler.
async function upsertNamespace({ env, tenant, clusterName, namespace, source, ttl }) {
  const params = [String(env), String(tenant), String(clusterName), String(namespace), String(source || 'discovery'), Number(ttl)];
  const upd = await db.query(
    `UPDATE ocp_namespace_cache
       SET source=$5, fetched_at=GETUTCDATE(), expires_at=DATEADD(HOUR, $6, GETUTCDATE()), is_deleted=0
     WHERE env=$1 AND tenant=$2 AND cluster_name=$3 AND namespace=$4`,
    params
  );
  if (!upd.rowCount) {
    await db.query(
      `INSERT INTO ocp_namespace_cache (env, tenant, cluster_name, namespace, source, expires_at)
       VALUES ($1,$2,$3,$4,$5, DATEADD(HOUR, $6, GETUTCDATE()))`,
      params
    );
  }
}

// Bir cluster icin namespace listesini yazar. Bu taramada GORULMEYEN eski kayitlar
// `is_deleted=1` ile isaretlenir (silinmez — gecmis bilgi kaybolmasin, ayrica bir sonraki
// tarama onlari geri getirebilir).
async function putNamespaces({ env, tenant, clusterName, namespaces, source = 'discovery' }) {
  const list = [...new Set((namespaces || []).map((n) => String(n || '').trim()).filter(Boolean))];
  const { ns: ttl } = await ttlHours();
  const runStart = await dbNow();

  for (const namespace of list) {
    await upsertNamespace({ env, tenant, clusterName, namespace, source, ttl });
  }

  // Bu taramada GORULMEYENLER = `fetched_at`'i tur baslangicindan eski kalanlar. Eskiden
  // `namespace NOT IN (...)` kullaniliyordu; 2097'den fazla namespace'te MSSQL'in 2100
  // parametre siniri asilir ve TUM yazim throw ederdi (ustteki catch yutar → onbellek
  // sessizce bos kalir). Zaman damgasi olcutu parametre sayisindan bagimsizdir ve liste
  // BOS geldiginde de dogru calisir (hepsi silinmis olarak isaretlenir).
  await db.query(
    `UPDATE ocp_namespace_cache SET is_deleted=1
     WHERE env=$1 AND tenant=$2 AND cluster_name=$3 AND is_deleted=0 AND fetched_at < $4`,
    [String(env), String(tenant), String(clusterName), runStart]
  );
  return { written: list.length };
}

async function getNamespaces({ env, tenant, clusterName }) {
  const { rows } = await db.query(
    `SELECT namespace, source, fetched_at, expires_at FROM ocp_namespace_cache
     WHERE env=$1 AND tenant=$2 AND cluster_name=$3 AND is_deleted=0
     ORDER BY namespace`,
    [String(env), String(tenant), String(clusterName)]
  );
  const newest = rows.reduce((acc, r) => (!acc || new Date(r.fetched_at) > new Date(acc) ? r.fetched_at : acc), null);
  const oldestExpiry = rows.reduce((acc, r) => (!acc || new Date(r.expires_at) < new Date(acc) ? r.expires_at : acc), null);
  return {
    items: rows.map((r) => r.namespace),
    cached: rows.length > 0,
    fetchedAt: newest,
    stale: rows.length > 0 ? isStale(oldestExpiry) : true,
    source: rows[0]?.source || null,
  };
}

// Uygulama/obje onbellegi. `entries` ocp-app-parse.cjs ciktisidir
// ({ clusterName, namespace, status, objects[] }).
async function putApps({ env, tenant, entries, source = 'discovery' }) {
  const { app: ttl } = await ttlHours();
  const runStart = await dbNow();
  let written = 0;
  let skipped = 0;

  for (const e of entries || []) {
    // Basarisiz namespace taramasi onbellege YAZILMAZ — aksi halde "hic uygulama yok"
    // gibi gorunur ve kullanici yanilir.
    if (!e || e.status !== 'ok' || !e.clusterName || !e.namespace) continue;

    for (const o of e.objects || []) {
      const name = String(o.name || '');
      if (!name || name.length > APP_NAME_MAX) { skipped++; continue; }

      const params = [
        String(env), String(tenant), String(e.clusterName), String(e.namespace),
        String(o.kind || 'Unknown'), name,
        o.replicas == null ? null : Number(o.replicas),
        o.image || null, o.labelApp || null, toDateOrNull(o.created),
        String(source), Number(ttl),
      ];
      const upd = await db.query(
        `UPDATE ocp_app_cache
           SET replicas=$7, image=$8, label_app=$9, created_at_k8s=$10, source=$11,
               fetched_at=GETUTCDATE(), expires_at=DATEADD(HOUR, $12, GETUTCDATE()), is_deleted=0
         WHERE env=$1 AND tenant=$2 AND cluster_name=$3 AND namespace=$4 AND kind=$5 AND app_name=$6`,
        params
      );
      if (!upd.rowCount) {
        await db.query(
          `INSERT INTO ocp_app_cache
             (env, tenant, cluster_name, namespace, kind, app_name, replicas, image, label_app,
              created_at_k8s, source, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, DATEADD(HOUR, $12, GETUTCDATE()))`,
          params
        );
      }
      written++;
    }

    // Bu taramada gorulmeyen objeleri isaretle (silinmis/yeniden adlandirilmis olabilir).
    // Olcut zaman damgasi: `app_name NOT IN (...)` hem MSSQL parametre sinirina takilirdi
    // hem de namespace TAMAMEN bosaldiginda (objects=[]) hic calismaz, eski uygulamalar
    // listede kalirdi.
    await db.query(
      `UPDATE ocp_app_cache SET is_deleted=1
       WHERE env=$1 AND tenant=$2 AND cluster_name=$3 AND namespace=$4
         AND is_deleted=0 AND fetched_at < $5`,
      [String(env), String(tenant), String(e.clusterName), String(e.namespace), runStart]
    );
  }
  if (skipped) console.warn(`[OcpCache] ${skipped} obje atlandi (ad ${APP_NAME_MAX} karakterden uzun).`);
  return { written, skipped };
}

async function getApps({ env, tenant, clusterName, namespace }) {
  const { rows } = await db.query(
    `SELECT kind, app_name, replicas, image, label_app, source, fetched_at, expires_at
     FROM ocp_app_cache
     WHERE env=$1 AND tenant=$2 AND cluster_name=$3 AND namespace=$4 AND is_deleted=0
     ORDER BY app_name, kind`,
    [String(env), String(tenant), String(clusterName), String(namespace)]
  );
  const newest = rows.reduce((acc, r) => (!acc || new Date(r.fetched_at) > new Date(acc) ? r.fetched_at : acc), null);
  const oldestExpiry = rows.reduce((acc, r) => (!acc || new Date(r.expires_at) < new Date(acc) ? r.expires_at : acc), null);
  return {
    items: rows.map((r) => ({
      kind: r.kind, name: r.app_name, replicas: r.replicas,
      image: r.image, labelApp: r.label_app,
    })),
    cached: rows.length > 0,
    fetchedAt: newest,
    stale: rows.length > 0 ? isStale(oldestExpiry) : true,
    source: rows[0]?.source || null,
  };
}

module.exports = { getNamespaces, putNamespaces, getApps, putApps, isStale };
