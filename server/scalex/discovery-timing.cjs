// server/scalex/discovery-timing.cjs — KESIF SURE OLCUMU.
//
// NEDEN VAR
// ─────────
// "ScaleX kesfi cok yavas" sikayeti aylarca NEREDE yavas oldugu bilinmeden
// tartisildi: AWX kuyrugu mu, bastion uzerinden `oc login` mi, yoksa tip
// taramasi mi? Tahminle optimizasyon, yanlis kaldiraca yatirim yapma riskidir —
// ve bu depoda bir kez yapildi (sabit tip listesi genisletildi, kazanc sifir).
//
// Betik her kesif isinde cluster basina BIR `TIMING` satiri basiyor
// (scalex_runner.sh, `discover` fazi). Bu modul onu KALICI hale getirir ki
// "once/sonra" karsilastirmasi SENTETIK bir testte degil URETIMDE yapilabilsin:
// sentetik bekci `oc` cagri sayisini olcer, AWX kuyrugunu ve bastion RTT'sini
// OLCEMEZ.
//
// ── UC ALAN, UC AYRI SORU ───────────────────────────────────────────────────
//   setup_ms    → AWX'ten sonra bastion + `oc login` + kubeconfig
//   discover_ms → yalnizca tip taramasi
//   cached      → yetenek onbellegi ISE YARADI MI
// Ucu de ayri kaldiraclara bakar. Yalnizca `elapsed_ms` saklamak, darbogazin
// hangisinde oldugunu TAHMIN ettirirdi.
//
// ── OLCULEMEDI ile SIFIR AYRI ───────────────────────────────────────────────
// Betik olcemedigi degeri '-' ile bildirir ve `result.cjs` onu `null` yapar.
// Burada da `null` yazilir. Uydurulmus bir sifir, grafikte "bu adim bedava"
// diye okunur.
'use strict';

const db = require('../db/index.cjs');

/**
 * Saklama suresi. Olcum bir DENETIM kaydi degil, bir trend: "gecen ay ne kadar
 * suruyordu" sorusu 30 gunle cevaplanir. Sinirsiz birikim bu depoda bir sisme
 * sinifiydi; olcum tablosu da istisna degil.
 */
const RETENTION_DAYS = 30;

/** Ekranin bir defada okudugu en fazla satir. */
const LIST_LIMIT = 200;

const S = (v, max) =>
  String(v ?? '')
    .trim()
    .slice(0, max);

/**
 * `null` KORUNUR. `Number(null)` 0 eder ve "olculmedi"yi "0 ms surdu"ye
 * cevirirdi — bu modulun engellemek icin var oldugu tam olarak bu.
 */
function msOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/**
 * Kesif sonucundaki `timing` satirlarini yazar.
 *
 * BEST-EFFORT: yazim dustugunde kesif akisi DURMAZ. Bu bir olcum; DB
 * tokezlemesi yuzunden calisan bir kesfi dusurmek, cozdugu sorundan buyuk olur.
 */
async function record({ env, tenant, namespace, timing, awxJobId }) {
  const rows = Array.isArray(timing) ? timing : [];
  if (!rows.length) return { written: 0 };

  let written = 0;
  for (const t of rows) {
    const cluster = S(t && t.cluster, 64);
    if (!cluster) continue; // cluster'i olmayan bir olcumun anlami yok
    try {
      await db.query(
        `INSERT INTO scalex_discovery_timing
           (env, tenant, cluster_name, namespace, mode, kinds, cached,
            setup_ms, discover_ms, elapsed_ms, awx_job_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          S(env, 30),
          S(tenant, 64),
          cluster,
          S(t.namespace ?? namespace, 100) || null,
          S(t.mode, 32) || 'unknown',
          msOrNull(t.kinds),
          t.cached === true ? 1 : t.cached === false ? 0 : null,
          msOrNull(t.setupMs),
          msOrNull(t.discoverMs),
          msOrNull(t.elapsedMs),
          Number.isInteger(Number(awxJobId)) ? Number(awxJobId) : null,
        ],
      );
      written++;
    } catch (e) {
      console.warn('[ScaleX] kesif suresi yazilamadi:', e.message);
    }
  }

  // BUDAMA YAZIMDAN SONRA ve AYRI bir try icinde: budama dusmesi, yeni yazilan
  // olcumu gizlememeli.
  if (written) {
    try {
      await db.query(
        `DELETE FROM scalex_discovery_timing
          WHERE created_at < DATEADD(day, -${RETENTION_DAYS}, GETUTCDATE())`,
      );
    } catch (e) {
      console.warn('[ScaleX] eski kesif olcumleri budanamadi:', e.message);
    }
  }
  return { written };
}

/** Son N olcum, yeniden eskiye. */
async function list({ limit } = {}) {
  const n = Math.min(Math.max(Number(limit) || 50, 1), LIST_LIMIT);
  const r = await db.query(
    `SELECT TOP ${n} id, env, tenant, cluster_name, namespace, mode, kinds, cached,
            setup_ms, discover_ms, elapsed_ms, awx_job_id, created_at
       FROM scalex_discovery_timing
      ORDER BY created_at DESC, id DESC`,
  );
  return (r.rows || []).map((x) => ({
    id: x.id,
    env: x.env,
    tenant: x.tenant,
    clusterName: x.cluster_name,
    namespace: x.namespace ?? null,
    mode: x.mode,
    kinds: x.kinds ?? null,
    // BIT sutunu surucuye gore 0/1 ya da false/true doner; NULL ("olculmedi")
    // ikisinden de AYRI kalmali.
    cached: x.cached === null || x.cached === undefined ? null : !!x.cached,
    setupMs: x.setup_ms ?? null,
    discoverMs: x.discover_ms ?? null,
    elapsedMs: x.elapsed_ms ?? null,
    awxJobId: x.awx_job_id ?? null,
    createdAt: x.created_at,
  }));
}

module.exports = { record, list, msOrNull, RETENTION_DAYS, LIST_LIMIT };
