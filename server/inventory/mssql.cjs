// server/inventory/mssql.cjs
const sql = require("mssql");

let _pool = null;
let _available = false;
let _lastErrorAt = 0;
const RETRY_COOLDOWN_MS = 10_000;

const REQUIRED = ["MSSQL_SERVER", "MSSQL_DATABASE", "MSSQL_USER", "MSSQL_PASSWORD"];

function isConfigured() {
  return REQUIRED.every((k) => process.env[k]);
}

// db/portal-mssql.cjs'teki AYRI havuzda da ayni desen — DB gercekten ulasilamazken her
// cagrinin hemen yeniden baglanmayi denemesini onler (kurumsal AI kod incelemesi,
// review.md #18b). Cooldown penceresinde sessizce null doner.
async function getPool() {
  if (_pool) return _pool;
  if (Date.now() - _lastErrorAt < RETRY_COOLDOWN_MS) return null;
  if (!isConfigured()) {
    console.warn("[Inventory] MSSQL env vars eksik — envanter devre disi.");
    return null;
  }
  try {
    _pool = await sql.connect({
      server: process.env.MSSQL_SERVER,
      port: parseInt(process.env.MSSQL_PORT || "1433", 10),
      database: process.env.MSSQL_DATABASE,
      user: process.env.MSSQL_USER,
      password: process.env.MSSQL_PASSWORD,
      options: { trustServerCertificate: true, encrypt: false },
      connectionTimeout: 10000,
      requestTimeout: 30000,
      pool: { max: 20, min: 0, idleTimeoutMillis: 30000 },
    });
    _available = true;
    // Reset cached pool if it closes unexpectedly so next call reconnects
    _pool.on('error', (err) => {
      console.error('[Inventory] MSSQL pool error — baglanti yeniden kurulacak:', err.message);
      _pool = null;
      _available = false;
      _lastErrorAt = Date.now();
    });
    console.log("[Inventory] MSSQL baglantisi kuruldu.");
  } catch (err) {
    console.error("[Inventory] MSSQL baglanti hatasi:", err.message);
    _pool = null;
    _lastErrorAt = Date.now();
  }
  return _pool;
}

function isAvailable() {
  return _available;
}

// N-03: pool stats for health endpoint
function poolStats() {
  if (!_pool || !_pool.pool) return null;
  const p = _pool.pool;
  return {
    size:    typeof p.size    === 'number' ? p.size    : null,
    used:    typeof p.used    === 'number' ? p.used    : null,
    pending: typeof p.pending === 'number' ? p.pending : null,
    max:     20,
  };
}

async function query(sqlText, inputs = []) {
  const pool = await getPool();
  if (!pool) throw new Error("MSSQL bağlantısı yok");
  const req = pool.request();
  for (const { name, type, value } of inputs) {
    req.input(name, type, value);
  }
  return req.query(sqlText);
}

module.exports = { getPool, isAvailable, query, sql, poolStats };
