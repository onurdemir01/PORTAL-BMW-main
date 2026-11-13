// server/inventory/mssql.cjs
const sql = require("mssql");
const { timeQuery, tarnPoolStats } = require("../metrics.cjs");

let _pool = null;
let _available = false;
let _lastErrorAt = 0;
const RETRY_COOLDOWN_MS = 10_000;
const MAIN_POOL_MAX = 20;
const LONG_POOL_MAX = 4;

const REQUIRED = ["MSSQL_SERVER", "MSSQL_DATABASE", "MSSQL_USER", "MSSQL_PASSWORD"];

function isConfigured() {
  return REQUIRED.every((k) => process.env[k]);
}

// Havuz alt siniri env ile (varsayilan 2) ve bosta bekleme 5 dk: isinmis baglantilar
// her 30 sn'de dusup yeniden acilmasin (soguk baglanti gecikmesi her istekte odenmesin).
function poolMin() {
  const n = Number.parseInt(process.env.TBMWANS_DB_POOL_MIN || "2", 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 20) : 2;
}
const POOL_IDLE_TIMEOUT_MS = 300_000;

function closeQuietly(pool) {
  try {
    if (pool && typeof pool.close === "function") {
      const r = pool.close();
      if (r && typeof r.catch === "function") r.catch(() => {});
    }
  } catch { /* yoksay */ }
}

// db/portal-mssql.cjs'teki AYRI havuzda da ayni desen — DB gercekten ulasilamazken her
// cagrinin hemen yeniden baglanmayi denemesini onler (kurumsal AI kod incelemesi,
// review.md #18b). Cooldown penceresinde sessizce null doner.
//
// Tek-ucus (single-flight): baglanti kurulurken gelen eszamanli cagrilar AYNI connect
// sozunu (_connecting) bekler. Hata olursa _connecting temizlenir (cooldown korunur).
// Hata veren eski havuz, yerine yenisi kuruldugunda kapatilir (_superseded).
let _connecting = null;
let _superseded = null;

async function connectOnce() {
  try {
    // `sql.connect()` DEGIL: o, node-mssql'in GLOBAL havuzunu kurar ve
    // `config` argumanini YALNIZCA ILK cagride kullanir (bkz. asagidaki not).
    // Bu dosya ile `mssql-readonly.cjs` ayni anda global havuzu istediginde
    // IKINCISI SESSIZCE BIRINCISININ KIMLIGIYLE calisiyordu.
    const pool = await new sql.ConnectionPool({
      server: process.env.MSSQL_SERVER,
      port: parseInt(process.env.MSSQL_PORT || "1433", 10),
      database: process.env.MSSQL_DATABASE,
      user: process.env.MSSQL_USER,
      password: process.env.MSSQL_PASSWORD,
      options: { trustServerCertificate: true, encrypt: false },
      connectionTimeout: 10000,
      requestTimeout: 30000,
      pool: { max: MAIN_POOL_MAX, min: poolMin(), idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS },
    }).connect();
    // Reset cached pool if it closes unexpectedly so next call reconnects
    pool.on('error', (err) => {
      console.error('[Inventory] MSSQL pool error — baglanti yeniden kurulacak:', err.message);
      if (_pool === pool) {
        _pool = null;
        _available = false;
        _superseded = pool;
      }
      _lastErrorAt = Date.now();
    });
    if (_superseded && _superseded !== pool) closeQuietly(_superseded);
    _superseded = null;
    _pool = pool;
    _available = true;
    console.log("[Inventory] MSSQL baglantisi kuruldu.");
  } catch (err) {
    console.error("[Inventory] MSSQL baglanti hatasi:", err.message);
    _pool = null;
    _lastErrorAt = Date.now();
  }
  return _pool;
}

async function getPool() {
  if (_pool) return _pool;
  if (_connecting) return _connecting;
  if (Date.now() - _lastErrorAt < RETRY_COOLDOWN_MS) return null;
  if (!isConfigured()) {
    console.warn("[Inventory] MSSQL env vars eksik — envanter devre disi.");
    return null;
  }
  _connecting = connectOnce().finally(() => { _connecting = null; });
  return _connecting;
}

function isAvailable() {
  return _available;
}

// N-03: pool stats for health endpoint. tarn'da size/used/pending ozellikleri YOK
// (hep null donuyordu); numUsed/numFree/numPendingAcquires okunur (portal-mssql ile ayni).
function poolStats() {
  return _pool ? tarnPoolStats(_pool) : null;
}
function longPoolStats() {
  return _longPool ? tarnPoolStats(_longPool) : null;
}

async function query(sqlText, inputs = []) {
  const w0 = process.hrtime.bigint();
  const pool = await getPool();
  const waitNs = process.hrtime.bigint() - w0;
  if (!pool) throw new Error("MSSQL bağlantısı yok");
  const req = pool.request();
  for (const { name, type, value } of inputs) {
    req.input(name, type, value);
  }
  return timeQuery("tbmwans", waitNs, sqlText, () => req.query(sqlText));
}

// UZUN sorgular icin ayri, kucuk havuz (2026-09-21): Denetim'in 14 gunluk denetim tablolarini
// tarayan sorgulari 30 sn'lik requestTimeout'a takiliyordu ("Timeout: Request failed to complete
// in 30000ms"). Ana havuzun zaman asimi kisa kalmali (istek yigilmasin); agir denetim okumalari
// bu havuzdan 180 sn ile gider. Tembel kurulur, ana havuzla ayni kimlik.
// Tek-ucus: kurulum surerken gelen cagrilar ayni sozu bekler (_longConnecting).
let _longPool = null;
let _longConnecting = null;
async function connectLongOnce() {
  try {
    const pool = await new sql.ConnectionPool({
      server: process.env.MSSQL_SERVER,
      port: parseInt(process.env.MSSQL_PORT || "1433", 10),
      database: process.env.MSSQL_DATABASE,
      user: process.env.MSSQL_USER,
      password: process.env.MSSQL_PASSWORD,
      options: { trustServerCertificate: true, encrypt: false },
      connectionTimeout: 10000,
      requestTimeout: parseInt(process.env.MSSQL_LONG_REQUEST_TIMEOUT_MS || "180000", 10),
      pool: { max: LONG_POOL_MAX, min: 0, idleTimeoutMillis: 60000 },
    }).connect();
    pool.on('error', () => {
      if (_longPool === pool) _longPool = null;
      closeQuietly(pool);
    });
    _longPool = pool;
  } catch (err) {
    console.error("[Inventory] MSSQL uzun-sorgu havuzu kurulamadi:", err.message);
    _longPool = null;
  }
  return _longPool;
}
async function getLongPool() {
  if (_longPool) return _longPool;
  if (_longConnecting) return _longConnecting;
  const base = await getPool();
  if (!base) return null;
  if (_longPool) return _longPool;
  if (!_longConnecting) {
    _longConnecting = connectLongOnce().finally(() => { _longConnecting = null; });
  }
  return _longConnecting;
}
async function queryLong(sqlText, inputs = []) {
  const w0 = process.hrtime.bigint();
  const longPool = await getLongPool();
  const pool = longPool || (await getPool());
  const waitNs = process.hrtime.bigint() - w0;
  if (!pool) throw new Error("MSSQL bağlantısı yok");
  const req = pool.request();
  for (const { name, type, value } of inputs) req.input(name, type, value);
  // Uzun havuz kurulamadiysa ana havuza dusulur; gunlukte AYRI etiket (ana havuzun 30 sn
  // zaman asimiyla calistigi gorunsun, "pool=tbmwans" ile karismasin).
  return timeQuery(longPool ? "tbmwans-long" : "tbmwans(long-fallback)", waitNs, sqlText, () => req.query(sqlText));
}

module.exports = { getPool, isAvailable, query, queryLong, sql, poolStats, longPoolStats };
