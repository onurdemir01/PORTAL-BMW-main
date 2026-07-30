// server/db/portal-mssql.cjs
// Portal uygulama DB'si: logx_sessions, audit, ansible_job_history
// Envanter DB'sinden (server/inventory/mssql.cjs) bagimsiz connection pool.
'use strict';

const sql = require('mssql');

let _pool = null;
let _lastErrorAt = 0;
const RETRY_COOLDOWN_MS = 10_000;

function getConfig() {
  return {
    server:   process.env.PORTAL_DB_SERVER   || process.env.MSSQL_SERVER,
    port:     parseInt(process.env.PORTAL_DB_PORT || process.env.MSSQL_PORT || '1433', 10),
    database: process.env.PORTAL_DB_DATABASE || process.env.MSSQL_DATABASE,
    user:     process.env.PORTAL_DB_USER     || process.env.MSSQL_USER,
    password: process.env.PORTAL_DB_PASSWORD || process.env.MSSQL_PASSWORD,
    options:  { trustServerCertificate: true, encrypt: false },
    connectionTimeout: 10_000,
    requestTimeout:    30_000,
    // ~1000 kullanici icin havuz buyutuldu (env ile ayarlanabilir; DB sunucusunun baglanti
    // limitiyle hizali olmali). min>0 → soguk-baslangic gecikmesini azaltir (isinmis baglantilar).
    pool: {
      max: parseInt(process.env.PORTAL_DB_POOL_MAX || '25', 10),
      min: parseInt(process.env.PORTAL_DB_POOL_MIN || '2', 10),
      idleTimeoutMillis: 30_000,
    },
  };
}

// DB gercekten ulasilamazken her cagrinin hemen yeniden baglanmayi denemesini onler
// (baglanti-firtinasi riski, yuk altinda event-loop'u dolduran yavas denemeler biriktirir —
// kurumsal AI kod incelemesi, review.md #18). Cooldown penceresinde sessizce null doner.
async function getPool() {
  if (_pool) return _pool;
  if (Date.now() - _lastErrorAt < RETRY_COOLDOWN_MS) return null;
  const cfg = getConfig();
  if (!cfg.server || !cfg.database || !cfg.user || !cfg.password) {
    console.warn('[PortalDB] Baglanti env vars eksik — portal DB devre disi.');
    return null;
  }
  try {
    _pool = await new sql.ConnectionPool(cfg).connect();
    _pool.on('error', (err) => {
      console.error('[PortalDB] Pool hatasi — yeniden baglanilacak:', err.message);
      _pool = null;
      _lastErrorAt = Date.now();
    });
    console.log('[PortalDB] Baglanti kuruldu:', cfg.server, '/', cfg.database);
  } catch (err) {
    console.error('[PortalDB] Baglanti hatasi:', err.message);
    _pool = null;
    _lastErrorAt = Date.now();
  }
  return _pool;
}

// Izleme icin havuz dolulugu (metrics-lite). mssql, altta tarn havuzu (_pool.pool) kullanir.
function poolStats() {
  try {
    const p = _pool && _pool.pool;
    if (!p) return { connected: false };
    return {
      connected: true,
      used: typeof p.numUsed === 'function' ? p.numUsed() : undefined,
      free: typeof p.numFree === 'function' ? p.numFree() : undefined,
      pendingAcquires: typeof p.numPendingAcquires === 'function' ? p.numPendingAcquires() : undefined,
      max: p.max, min: p.min,
    };
  } catch {
    return { connected: false };
  }
}

module.exports = { getPool, sql, poolStats };
