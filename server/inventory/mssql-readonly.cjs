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
'use strict';

const sql = require('mssql');

let _pool = null;
let _lastErrorAt = 0;
const RETRY_COOLDOWN_MS = 10_000;

function isConfigured() {
  return !!(process.env.MSSQL_RO_USER && process.env.MSSQL_RO_PASSWORD && process.env.MSSQL_SERVER && process.env.MSSQL_DATABASE);
}

async function getReadOnlyPool() {
  if (_pool) return _pool;
  if (Date.now() - _lastErrorAt < RETRY_COOLDOWN_MS) return null;
  if (!isConfigured()) return null;
  try {
    _pool = await sql.connect({
      server: process.env.MSSQL_SERVER,
      port: parseInt(process.env.MSSQL_PORT || '1433', 10),
      database: process.env.MSSQL_DATABASE,
      user: process.env.MSSQL_RO_USER,
      password: process.env.MSSQL_RO_PASSWORD,
      options: { trustServerCertificate: true, encrypt: false },
      connectionTimeout: 10000,
      requestTimeout: 30000,
      pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    });
    _pool.on('error', (err) => {
      console.error('[Inventory:RO] MSSQL pool hatasi — yeniden kurulacak:', err.message);
      _pool = null;
      _lastErrorAt = Date.now();
    });
    console.log('[Inventory:RO] Salt-okunur MSSQL baglantisi kuruldu.');
  } catch (err) {
    console.error('[Inventory:RO] Salt-okunur MSSQL baglanti hatasi:', err.message);
    _pool = null;
    _lastErrorAt = Date.now();
  }
  return _pool;
}

module.exports = { getReadOnlyPool, isConfigured };
