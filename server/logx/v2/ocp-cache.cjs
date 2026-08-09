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

  for (const namespace of list) {
    await upsertNamespace({ env, tenant, clusterName, namespace, source, ttl });
  }

  if (list.length) {
    // Parametreli IN listesi — dize birlestirme YOK.
    const ph = list.map((_, i) => `$${i + 4}`).join(', ');
    await db.query(
      `UPDATE ocp_namespace_cache SET is_deleted=1
       WHERE env=$1 AND tenant=$2 AND cluster_name=$3 AND namespace NOT IN (${ph})`,
      [String(env), String(tenant), String(clusterName), ...list]
    );
  }
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
  let written = 0;

  for (const e of entries || []) {
    // Basarisiz namespace taramasi onbellege YAZILMAZ — aksi halde "hic uygulama yok"
    // gibi gorunur ve kullanici yanilir.
    if (!e || e.status !== 'ok' || !e.clusterName || !e.namespace) continue;

    for (const o of e.objects || []) {
      const params = [
        String(env), String(tenant), String(e.clusterName), String(e.namespace),
        String(o.kind || 'Unknown'), String(o.name),
        o.replicas == null ? null : Number(o.replicas),
        o.image || null, o.labelApp || null, String(source), Number(ttl),
      ];
      const upd = await db.query(
        `UPDATE ocp_app_cache
           SET replicas=$7, image=$8, label_app=$9, source=$10,
               fetched_at=GETUTCDATE(), expires_at=DATEADD(HOUR, $11, GETUTCDATE()), is_deleted=0
         WHERE env=$1 AND tenant=$2 AND cluster_name=$3 AND namespace=$4 AND kind=$5 AND app_name=$6`,
        params
      );
      if (!upd.rowCount) {
        await db.query(
          `INSERT INTO ocp_app_cache
             (env, tenant, cluster_name, namespace, kind, app_name, replicas, image, label_app, source, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, DATEADD(HOUR, $11, GETUTCDATE()))`,
          params
        );
      }
      written++;
    }

    // Bu taramada gorulmeyen objeleri isaretle (silinmis/yeniden adlandirilmis olabilir).
    const names = (e.objects || []).map((o) => String(o.name));
    if (names.length) {
      const ph = names.map((_, i) => `$${i + 5}`).join(', ');
      await db.query(
        `UPDATE ocp_app_cache SET is_deleted=1
         WHERE env=$1 AND tenant=$2 AND cluster_name=$3 AND namespace=$4 AND app_name NOT IN (${ph})`,
        [String(env), String(tenant), String(e.clusterName), String(e.namespace), ...names]
      );
    }
  }
  return { written };
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
