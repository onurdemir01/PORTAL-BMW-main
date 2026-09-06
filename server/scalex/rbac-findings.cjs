// server/scalex/rbac-findings.cjs — kesifte OKUNAMAYAN nesne tiplerinin BIRIKIMI.
//
// NEDEN VAR: kesif her tip icin zaten bir rapor satiri uretiyor
// (`WORKLOAD_KIND;WARN;kind=... reason=no_permission|api_absent`), ama bu satirlar
// hicbir yerde BIRIKMIYORDU. Sonuc:
//   - her kullanici ayni uzun uyari duvarini kendi ekraninda goruyor,
//   - platform ekibine ayni talep tekrar tekrar aciliyor,
//   - hangi namespace'te neyin eksik oldugu kimsede TOPLU halde durmuyor.
//
// IKI NEDEN AYRI TUTULUR — bu ayrim bu modulun var olus sebebi:
//   `no_permission` → platformdan ISTENEBILIR (genellikle `view` ClusterRole binding).
//   `api_absent`    → o tip cluster'da kurulu DEGIL; yapilacak bir sey YOK.
// Ikisini karistirmak, asla cozulmeyecek bir RBAC talebi acmak demektir (uretimde
// tam olarak bu yasandi ve `oc api-resources` olcutu bu yuzden getirildi).
'use strict';

const db = require('../db/index.cjs');

// Playbook'un uretebilecegi nedenler. Bilinmeyen bir deger YAZILMAZ: tablo, ekranin
// "istenebilir mi" kararini verdigi yer ve oraya tanimadigimiz bir etiket koymak
// kullaniciyi yanlis yonlendirirdi.
const KNOWN_REASONS = new Set(['no_permission', 'api_absent']);

const S = (v, max) =>
  String(v ?? '')
    .trim()
    .slice(0, max);

// Kesif sonucundaki `kindReports` satirlarini kalici hale getirir.
//
// BEST-EFFORT: yazim basarisiz olsa da kesif akisi DURMAZ. Bu bir denetim kaydi
// degil, bir kolaylik birikimi; DB tokezlemesi yuzunden calisan bir kesfi
// dusurmek cozdugu sorundan buyuk olurdu.
async function record({ env, tenant, namespace, kindReports }) {
  const rows = (kindReports || []).filter(
    (k) => k && k.readable === false && KNOWN_REASONS.has(String(k.reason || '')),
  );
  if (!rows.length) return { written: 0 };

  let written = 0;
  for (const k of rows) {
    const params = [
      S(env, 30),
      S(tenant, 64),
      S(k.cluster, 64),
      S(namespace, 100),
      S(k.kind, 64),
      S(k.resource, 200) || null,
      S(k.reason, 32),
      S(k.verb, 32) || null,
    ];
    if (!params[2] || !params[4]) continue; // cluster/kind bos ise satirin anlami yok
    try {
      // UPDATE-once, 0 satir etkilendiyse INSERT (repo genelindeki upsert deseni).
      // `first_seen_at` KORUNUR: bir eksigin NE ZAMANDIR durdugu, kac kez
      // karsilasildigindan daha cok sey anlatir.
      const upd = await db.query(
        `UPDATE scalex_rbac_findings
            SET resource_name = $6, reason = $7, verb = $8, last_seen_at = GETUTCDATE()
          WHERE env = $1 AND tenant = $2 AND cluster_name = $3
            AND namespace = $4 AND kind = $5`,
        params,
      );
      if (!upd.rowCount) {
        await db.query(
          `INSERT INTO scalex_rbac_findings
             (env, tenant, cluster_name, namespace, kind, resource_name, reason, verb)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          params,
        );
      }
      written++;
    } catch (e) {
      console.warn('[ScaleX] RBAC bulgusu yazilamadi:', e.message);
    }
  }
  return { written };
}

// Admin ekrani icin liste. En son gorulen once; sinir SABIT (ekran zaten gruplayarak
// gosteriyor, sinirsiz liste hem sorguyu hem ekrani bogar).
//
// SQL METNINDE SABLON DEGISKENI YOK — bu modulde bir bekci tarafindan yasak. Sabit
// bile olsa, enjeksiyon incelemesini "bu deger nereden geliyor?" sorusuna mahkum
// ediyor. `TOP 500` elle yazili; `LIST_LIMIT` ile esitligi bir bekci kilitliyor.
const LIST_LIMIT = 500;

// Iki AYRI sabit sorgu — dinamik `WHERE` kurmak da ayni yasagin kapsaminda.
async function list({ reason } = {}) {
  const filtered = reason && KNOWN_REASONS.has(String(reason));
  const { rows } = filtered
    ? await db.query(
        `SELECT TOP 500
                id, env, tenant, cluster_name, namespace, kind, resource_name,
                reason, verb, first_seen_at, last_seen_at
           FROM scalex_rbac_findings
          WHERE reason = $1
          ORDER BY last_seen_at DESC`,
        [String(reason)],
      )
    : await db.query(
        `SELECT TOP 500
                id, env, tenant, cluster_name, namespace, kind, resource_name,
                reason, verb, first_seen_at, last_seen_at
           FROM scalex_rbac_findings
          ORDER BY last_seen_at DESC`,
        [],
      );
  return rows.map((r) => ({
    id: r.id,
    env: r.env,
    tenant: r.tenant,
    cluster: r.cluster_name,
    namespace: r.namespace,
    kind: r.kind,
    resource: r.resource_name,
    reason: r.reason,
    verb: r.verb,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
  }));
}

// Cozulmus bir eksigi listeden dusurmek icin. Silme BILEREK var: platform ekibi
// yetkiyi verdiginde satir bir sonraki kesife kadar "cozulmemis" gorunurdu ve
// admin ekrani guvenilirligini yitirirdi.
async function remove(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) {
    throw Object.assign(new Error('Gecersiz kayit kimligi.'), { status: 400 });
  }
  await db.query('DELETE FROM scalex_rbac_findings WHERE id = $1', [n]);
  return { ok: true };
}

module.exports = { record, list, remove, KNOWN_REASONS, LIST_LIMIT };
