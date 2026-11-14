// server/metrics.cjs — Hafif, bagimliliksiz in-process metrikler (Sprint 5). Prometheus/
// prom-client GEREKMEZ; admin'e JSON doner. Olcek izleme icin: istek/hata/latency ozeti,
// event-loop lag, bellek, portal DB havuz dolulugu. (Ileride prom-client'a genisletilebilir.)
'use strict';

let requests = 0;
let errors5xx = 0;
const latencies = [];         // son N istek suresi (ms) — kayan pencere
const MAX_SAMPLES = 2000;
let loopLagMs = 0;

// Event-loop lag: 1sn'lik timer'in gercek gecikmesi (beklenen 1000ms ustu = lag).
(function measureLoopLag() {
  let last = process.hrtime.bigint();
  const iv = setInterval(() => {
    const now = process.hrtime.bigint();
    loopLagMs = Math.max(0, Number(now - last) / 1e6 - 1000);
    last = now;
  }, 1000);
  if (iv.unref) iv.unref();
})();

// -- Yavas istek gunlugu (2026-11-13) ----------
// SlowQuery yalniz SQL'i gorur; OCO Takvimi gibi dis HTTP'ye giden ekranlar orada hic
// gorunmuyordu. Istek suresi SLOW_HTTP_MS'i (varsayilan 1500) asarsa TEK satir yazilir.
// GUNLUGE YALNIZ rota KALIBI girer (req.baseUrl + req.route.path): ham URL, query string,
// parametre degeri ve kullanici adi ASLA yazilmaz (token/host adi sizmasin).
const DEFAULT_SLOW_HTTP_MS = 1500;
let slowHttpCount = 0;

function slowHttpThresholdMs() {
  const n = Number.parseInt(process.env.SLOW_HTTP_MS, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SLOW_HTTP_MS;
}

/** Rota KALIBI: '/api/oco' + '/calendar'. Rota eslesmediyse yalniz baseUrl (ham URL degil). */
function routeOf(req) {
  const base = typeof req.baseUrl === "string" ? req.baseUrl : "";
  const rp = typeof req.route?.path === "string" ? req.route.path : "";
  return (base + rp) || "?";
}

function middleware(req, res, next) {
  const start = Date.now();
  requests++;
  res.on("finish", () => {
    const ms = Date.now() - start;
    latencies.push(ms);
    if (latencies.length > MAX_SAMPLES) latencies.shift();
    if (res.statusCode >= 500) errors5xx++;
    try {
      if (ms > slowHttpThresholdMs()) {
        slowHttpCount++;
        console.warn(
          `[SlowHttp] method=${String(req.method || "?").replace(/[^A-Z]/gi, "")} route=${routeOf(req)} ` +
          `status=${res.statusCode} ms=${ms} loopLag=${Math.round(loopLagMs)}ms`
        );
      }
    } catch { /* gozlem istegi bozmamali */ }
  });
  next();
}

function percentile(p) {
  if (!latencies.length) return 0;
  const sorted = [...latencies].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function poolStats() {
  try {
    const portal = require("./db/portal-mssql.cjs");
    if (typeof portal.poolStats === "function") return portal.poolStats();
  } catch { /* yoksay */ }
  return null;
}

// TBMWANS (envanter) havuzlari: ana + uzun-sorgu. Modul yuklenemezse null.
function tbmwansPoolStats() {
  try {
    const inv = require("./inventory/mssql.cjs");
    return {
      main: typeof inv.poolStats === "function" ? inv.poolStats() : null,
      long: typeof inv.longPoolStats === "function" ? inv.longPoolStats() : null,
    };
  } catch { /* yoksay */ }
  return null;
}

// tarn havuzu (ConnectionPool.pool) dolulugu; numUsed/numFree/numPendingAcquires
// tarn'in gercek API'sidir (size/used/pending ozellikleri tarn'da YOKTUR).
function tarnPoolStats(connectionPool) {
  try {
    const p = connectionPool?.pool;
    if (!p) return null;
    const num = (fn) => (typeof p[fn] === "function" ? p[fn]() : null);
    const used = num("numUsed");
    const free = num("numFree");
    const pendingAcquires = num("numPendingAcquires");
    return {
      connected: true,
      size: typeof used === "number" && typeof free === "number" ? used + free : null,
      used,
      free,
      pending: pendingAcquires,
      pendingAcquires,
      max: typeof p.max === "number" ? p.max : null,
      min: typeof p.min === "number" ? p.min : null,
    };
  } catch {
    return null;
  }
}

// -- Yavas sorgu gunlugu ----------
// Havuz bekleme (getPool) ve request.query suresi AYRI olculur (hrtime.bigint).
// Toplam SLOW_QUERY_MS (varsayilan 500) esigini asarsa TEK satir console.warn.
// Gunluge YALNIZ havuz adi, sureler, satir sayisi ve SQL metninin ilk 150
// karakteri (bosluklar tek bosluga indirilmis) yazilir; parametre DEGERLERI ASLA.
const DEFAULT_SLOW_QUERY_MS = 500;
const SQL_PREVIEW_CHARS = 150;
let slowQueryCount = 0;

function slowQueryThresholdMs() {
  const n = Number.parseInt(process.env.SLOW_QUERY_MS, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SLOW_QUERY_MS;
}

function sqlPreview(text) {
  if (typeof text !== "string") return "";
  return text.replace(/\s+/g, " ").trim().slice(0, SQL_PREVIEW_CHARS);
}

function nsToMs(ns) {
  return typeof ns === "bigint" ? Number(ns) / 1e6 : 0;
}

function rowCountOf(result) {
  if (!result) return null;
  if (Array.isArray(result.recordset)) return result.recordset.length;
  if (Array.isArray(result.rows)) return result.rows.length;
  if (Array.isArray(result.rowsAffected)) return result.rowsAffected.reduce((a, b) => a + (Number(b) || 0), 0);
  return null;
}

// Gunluge yazildiysa true doner. Asla firlatmaz (gozlem, sorguyu bozmamali).
function reportQueryTiming({ pool, waitNs, queryNs, result, sqlText, failed, retry } = {}) {
  try {
    const waitMs = nsToMs(waitNs);
    const queryMs = nsToMs(queryNs);
    if (!(waitMs + queryMs > slowQueryThresholdMs())) return false;
    slowQueryCount++;
    const rows = failed ? "-" : rowCountOf(result);
    console.warn(
      `[SlowQuery] pool=${pool || "?"} wait=${waitMs.toFixed(1)}ms query=${queryMs.toFixed(1)}ms ` +
      // loopLag: "query=" suresi SQL mi yoksa olay dongusu (ayristirma/GC) mu - ayirt etmek icin.
      `loopLag=${Math.round(loopLagMs)}ms ` +
      `rows=${rows === null || rows === undefined ? "?" : rows}${failed ? " status=error" : ""}${retry ? " retry=1" : ""} ` +
      `sql="${sqlPreview(sqlText)}"`
    );
    return true;
  } catch {
    return false;
  }
}

// run() cagrisini olcer; sonuc/hatayi AYNEN iletir.
async function timeQuery(pool, waitNs, sqlText, run, opts = {}) {
  const t0 = process.hrtime.bigint();
  let result;
  let failed = true;
  try {
    result = await run();
    failed = false;
    return result;
  } finally {
    reportQueryTiming({
      pool, waitNs, queryNs: process.hrtime.bigint() - t0, result, sqlText, failed, retry: !!opts.retry,
    });
  }
}

function snapshot() {
  const mem = process.memoryUsage();
  return {
    ok: true,
    uptimeSec: Math.floor(process.uptime()),
    requests,
    errors5xx,
    latencyMs: { p50: percentile(50), p95: percentile(95), p99: percentile(99), samples: latencies.length },
    eventLoopLagMs: Math.round(loopLagMs),
    memoryMB: { rss: Math.round(mem.rss / 1048576), heapUsed: Math.round(mem.heapUsed / 1048576) },
    portalDbPool: poolStats(),
    tbmwansDbPool: tbmwansPoolStats(),
    slowQueries: { count: slowQueryCount, thresholdMs: slowQueryThresholdMs() },
    slowHttp: { count: slowHttpCount, thresholdMs: slowHttpThresholdMs() },
  };
}

// Periyodik snapshot yazici: canli sayaclar proses ici kalir (restart'ta sifirlanmasi
// dogru), ama 5 dk'da bir metrics_snapshots tablosuna ozet yazilir — restart'lar arasi
// trend gecmisi DB'de korunur. Best-effort: DB yoksa sessizce atlanir.
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

async function writeSnapshotToDb() {
  try {
    const db = require("./db/index.cjs");
    const s = snapshot();
    await db.query(
      `INSERT INTO metrics_snapshots
         (requests, errors_5xx, p50_ms, p95_ms, p99_ms, event_loop_lag_ms, rss_mb, heap_used_mb)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [s.requests, s.errors5xx, s.latencyMs.p50, s.latencyMs.p95, s.latencyMs.p99,
       s.eventLoopLagMs, s.memoryMB.rss, s.memoryMB.heapUsed]
    );
  } catch { /* DB yok/erisilemez → snapshot atlanir */ }
}

function startSnapshotWriter() {
  const iv = setInterval(writeSnapshotToDb, SNAPSHOT_INTERVAL_MS);
  if (iv.unref) iv.unref();
}

// Admin-gated JSON endpoint. Auth modulu yuklenemezse endpoint mount edilmez (guvenli).
function initMetrics(app) {
  let requireAuth, requireAdmin;
  try {
    const auth = require("./auth/index.cjs");
    requireAuth = auth.requireAuth;
    requireAdmin = auth.requireAdmin;
  } catch { /* auth yok → endpoint acilmaz */ }
  if (requireAuth && requireAdmin) {
    app.get("/api/metrics-lite", requireAuth, requireAdmin, (req, res) => res.json(snapshot()));
    // Gecmis snapshot'lar (trend) — metrics_snapshots tablosundan.
    app.get("/api/metrics-lite/history", requireAuth, requireAdmin, async (req, res) => {
      const hours = Math.min(Number(req.query.hours) || 24, 24 * 30);
      try {
        const db = require("./db/index.cjs");
        const { rows } = await db.query(
          `SELECT TOP 2000 * FROM metrics_snapshots
           WHERE captured_at >= DATEADD(hour, -${hours}, GETUTCDATE())
           ORDER BY captured_at DESC`
        );
        res.json({ ok: true, snapshots: rows });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message, snapshots: [] });
      }
    });
    console.log("[Metrics] /api/metrics-lite (admin) mounted");
  }
  startSnapshotWriter();
}

module.exports = {
  middleware, snapshot, initMetrics,
  // db katmani yardimcilari (yavas sorgu gunlugu, havuz dolulugu)
  timeQuery, reportQueryTiming, tarnPoolStats, sqlPreview, slowQueryThresholdMs,
  slowHttpThresholdMs, routeOf, loopLag: () => loopLagMs,
};
