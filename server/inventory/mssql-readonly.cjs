// server/inventory/mssql-readonly.cjs — actions.md #20 (Bolum P) Custom SQL icin AYRI,
// salt-okunur MSSQL kimlik bilgisiyle kurulan bir havuz. mssql.cjs'teki paylasilan
// (yazma-yetkili) havuzdan KASITLI olarak ayridir — /query route'u yalniz bunu kullanir.
//
// MSSQL_RO_USER/MSSQL_RO_PASSWORD tanimli DEGILSE bu modul isConfigured()=false doner;
// cagiran taraf (inventory/index.cjs) o zaman PAYLASILAN havuza duser ve bir UYARI loglar
// (geriye uyumlu — davranis BOZULMAZ, sadece guvenlik onerisi verilir).
//
// ONEMLI (kod-disi/operasyonel): bu kullanicinin gercek MSSQL sunucusunda SADECE
// GRANT SELECT ile olusturulmasi gerekir (yazma yetkisi KESINLIKLE verilmemeli) — bu adimi
// DBA/altyapi ekibi yapmali, uygulama kodu bunu dogrulayamaz/zorlayamaz.
//
// ── 2026-09-22: BU AYRIM CALISMIYORDU ────────────────────────────────────────
// Hem bu dosya hem `mssql.cjs` `sql.connect(config)` cagiriyordu. node-mssql'in
// `connect`i GLOBAL bir havuz kurar ve `config`i YALNIZCA ILK cagride kullanir
// (node_modules/mssql/lib/global-connection.js):
//
//     function connect (config, callback) {
//       if (!globalConnection) {
//         globalConnection = new shared.driver.ConnectionPool(config)
//       }                      // ← sonraki config'ler SESSIZCE YOK SAYILIR
//       ...
//       return globalConnection.connect()
//     }
//
// Envanter ekranlari yonetici "Custom SQL" ekranindan cok once acildigi icin
// global havuzu pratikte HEP `mssql.cjs` (YAZMA YETKILI) kuruyordu. Sonuc:
// `getReadOnlyPool()` yazma yetkili havuzu donuyor, `MSSQL_RO_USER` hesabi HIC
// KULLANILMIYOR ve asagidaki "Salt-okunur baglanti kuruldu" satiri YANLIS
// bilgi veriyordu. Yani DB seviyesindeki SELECT-only savunmasi bir kapi degil,
// yalnizca bir NIYETTI.
//
// Ayrica iki modul AYNI havuz nesnesine `error` dinleyicisi takip her biri
// YALNIZ KENDI `_pool`unu null'luyordu; bir havuz hatasindan sonra ikisi
// baglanti durumu konusunda ANLASMAZLIGA dusuyordu (uretimde 12 kez
// "MSSQL pool error").
//
// Artik her iki modul de KENDI `new sql.ConnectionPool(...)` nesnesini kurar.
'use strict';

const sql = require('mssql');
const { reportQueryTiming } = require('../metrics.cjs');

let _pool = null;
let _lastErrorAt = 0;
const RETRY_COOLDOWN_MS = 10_000;
const POOL_MAX = 10;
const POOL_IDLE_TIMEOUT_MS = 300_000;

// Havuz alt siniri ana TBMWANS havuzuyla ayni env'den (varsayilan 2).
function poolMin() {
  const n = Number.parseInt(process.env.TBMWANS_DB_POOL_MIN || '2', 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, POOL_MAX) : 2;
}

function isConfigured() {
  return !!(process.env.MSSQL_RO_USER && process.env.MSSQL_RO_PASSWORD && process.env.MSSQL_SERVER && process.env.MSSQL_DATABASE);
}

function closeQuietly(pool) {
  try {
    if (pool && typeof pool.close === 'function') {
      const r = pool.close();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    }
  } catch { /* yoksay */ }
}

// Yavas sorgu gunlugu: cagiran (inventory/index.cjs) `pool.request().query(...)`
// kullandigi icin olcum havuzun request() fabrikasina takilir. Yalniz soz (promise)
// bicimindeki string sorgular olculur; callback / tagged-template bicimi aynen gecer.
// Havuz bekleme suresi burada bilinemez (getReadOnlyPool cagirana aittir) -> wait=0.
function instrumentPool(pool) {
  if (!pool || typeof pool.request !== 'function' || pool.__slowQueryWrapped) return pool;
  const origRequest = pool.request.bind(pool);
  pool.request = function request(...args) {
    const req = origRequest(...args);
    if (req && typeof req.query === 'function') {
      const origQuery = req.query.bind(req);
      req.query = function query(command, ...rest) {
        if (typeof command !== 'string' || rest.some((a) => typeof a === 'function')) {
          return origQuery(command, ...rest);
        }
        const t0 = process.hrtime.bigint();
        const p = origQuery(command, ...rest);
        if (!p || typeof p.then !== 'function') return p;
        return p.then(
          (result) => {
            reportQueryTiming({ pool: 'tbmwans-ro', waitNs: 0n, queryNs: process.hrtime.bigint() - t0, result, sqlText: command });
            return result;
          },
          (err) => {
            reportQueryTiming({ pool: 'tbmwans-ro', waitNs: 0n, queryNs: process.hrtime.bigint() - t0, sqlText: command, failed: true });
            throw err;
          },
        );
      };
    }
    return req;
  };
  Object.defineProperty(pool, '__slowQueryWrapped', { value: true });
  return pool;
}

// Tek-ucus (single-flight): baglanti kurulurken gelen eszamanli cagrilar AYNI connect
// sozunu (_connecting) bekler. Hata olursa _connecting temizlenir (cooldown korunur).
// Hata veren eski havuz, yerine yenisi kuruldugunda kapatilir (_superseded).
let _connecting = null;
let _superseded = null;

async function connectOnce() {
  try {
    // `sql.connect()` KULLANILMAZ — bu dosyanin VAR OLUS SEBEBINI yok ederdi.
    // Ayrinti icin dosyanin basindaki nota bak.
    const pool = await new sql.ConnectionPool({
      server: process.env.MSSQL_SERVER,
      port: parseInt(process.env.MSSQL_PORT || '1433', 10),
      database: process.env.MSSQL_DATABASE,
      user: process.env.MSSQL_RO_USER,
      password: process.env.MSSQL_RO_PASSWORD,
      options: { trustServerCertificate: true, encrypt: false },
      connectionTimeout: 10000,
      requestTimeout: 30000,
      pool: { max: POOL_MAX, min: poolMin(), idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS },
    }).connect();
    pool.on('error', (err) => {
      console.error('[Inventory:RO] MSSQL pool hatasi — yeniden kurulacak:', err.message);
      if (_pool === pool) {
        _pool = null;
        _superseded = pool;
      }
      _lastErrorAt = Date.now();
    });
    if (_superseded && _superseded !== pool) closeQuietly(_superseded);
    _superseded = null;
    _pool = instrumentPool(pool);
    console.log('[Inventory:RO] Salt-okunur MSSQL baglantisi kuruldu.');
  } catch (err) {
    console.error('[Inventory:RO] Salt-okunur MSSQL baglanti hatasi:', err.message);
    _pool = null;
    _lastErrorAt = Date.now();
  }
  return _pool;
}

async function getReadOnlyPool() {
  if (_pool) return _pool;
  if (_connecting) return _connecting;
  if (Date.now() - _lastErrorAt < RETRY_COOLDOWN_MS) return null;
  if (!isConfigured()) return null;
  _connecting = connectOnce().finally(() => { _connecting = null; });
  return _connecting;
}

module.exports = { getReadOnlyPool, isConfigured };
