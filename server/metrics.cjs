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

function middleware(req, res, next) {
  const start = Date.now();
  requests++;
  res.on("finish", () => {
    const ms = Date.now() - start;
    latencies.push(ms);
    if (latencies.length > MAX_SAMPLES) latencies.shift();
    if (res.statusCode >= 500) errors5xx++;
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

module.exports = { middleware, snapshot, initMetrics };
