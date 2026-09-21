// server/db/external-indexes.cjs - Ansible loader'larinin doldurdugu denetim tablolarina
// scan_date indeksi (2026-09-21).
//
// NE OLDU: Denetim > Nginx Audit 30 sn'de zaman asimina dustu ("Timeout: Request failed to
// complete in 30000ms"), diger denetim sayfalari da yavasladi. Sebep: dbo.Nginx_Audit_*,
// Nginx_Config_Audit, Nginx_Intranet_Audit, NginxRateLimitInventory gun basina satir tutar
// (14 gun saklama) ve Portal hep `WHERE scan_date = <son gun>` ile okur; indeks olmadigi icin
// her istek 14 gunluk tum tabloyu tarar (Settings tablosu sunucu basina binlerce satir ->
// milyonlar). MAX(scan_date) bile tam tarama.
//
// NEDEN PORTAL'DA: tablolarin sahibi Ansible loader'lari, ama indeks eksikligi Portal'i
// vuruyor ve Ansible degisikligi elle tasiniyor (gunler). Portal ayni kullaniciyla (DDL
// yetkisi var: kendi tablolarini yaratiyor) EKSIK indeksi bir kez yaratir; olan indekse
// dokunmaz; tablo yoksa atlar. Buyuk tabloda ilk olusturma dakikalar surebilir: boot'u
// BLOKLAMAZ (arka planda, sirayla), sonucu loglar.
'use strict';

// table -> indeks adi + sutunlar. scan_date onde: Portal'in tum okuma kaliplari bu esitlikle
// basliyor; host ikinci (tek sunucu sorgulari icin).
const WANTED = [
  { table: 'Nginx_Audit_Hosts', name: 'IX_Nginx_Audit_Hosts_scan', cols: 'scan_date, host' },
  { table: 'Nginx_Audit_Servers', name: 'IX_Nginx_Audit_Servers_scan', cols: 'scan_date, host' },
  { table: 'Nginx_Audit_Locations', name: 'IX_Nginx_Audit_Locations_scan', cols: 'scan_date, host' },
  { table: 'Nginx_Audit_Upstreams', name: 'IX_Nginx_Audit_Upstreams_scan', cols: 'scan_date, host' },
  { table: 'Nginx_Audit_Settings', name: 'IX_Nginx_Audit_Settings_scan', cols: 'scan_date, host' },
  { table: 'Nginx_Audit_Files', name: 'IX_Nginx_Audit_Files_scan', cols: 'scan_date, host' },
  { table: 'Nginx_Config_Audit', name: 'IX_Nginx_Config_Audit_scan', cols: 'scan_date, kind, env' },
  { table: 'Nginx_Intranet_Audit', name: 'IX_Nginx_Intranet_Audit_scan', cols: 'scan_date' },
  { table: 'Nginx_Legacy_Audit', name: 'IX_Nginx_Legacy_Audit_scan', cols: 'scan_date' },
  { table: 'Nginx_Legacy_Findings', name: 'IX_Nginx_Legacy_Findings_scan', cols: 'scan_date' },
  { table: 'NginxRateLimitInventory', name: 'IX_NginxRateLimitInventory_scan', cols: 'scan_date' },
  { table: 'DeployScriptsInventory', name: 'IX_DeployScriptsInventory_scan', cols: 'scan_date, host' },
];

/** Eksik indeksleri sirayla yaratir. Hata bir tabloyu atlatir, digerlerini durdurmaz.
 *  CREATE INDEX buyuk tabloda dakikalar surer: havuzun 30 sn requestTimeout'u yetmez, bu
 *  yuzden AYRI, uzun zaman asimli tek bir baglanti acilir ve sonunda kapatilir. */
async function ensureExternalIndexes(pool, log = console) {
  const done = [];
  let ddl = null; // uzun zaman asimli baglanti (yalniz gerekirse acilir)
  const ddlPool = async () => {
    if (ddl) return ddl;
    const sql = require('mssql');
    const cfg = { ...require('./portal-mssql.cjs').getConfig(), requestTimeout: 30 * 60 * 1000, pool: { max: 1, min: 0, idleTimeoutMillis: 5000 } };
    ddl = await new sql.ConnectionPool(cfg).connect();
    return ddl;
  };
  try {
  for (const w of WANTED) {
    try {
      const r = await pool.request().query(
        `SELECT
           (SELECT COUNT(*) FROM sys.tables t WHERE t.name = '${w.table}' AND t.schema_id = SCHEMA_ID('dbo')) AS has_table,
           (SELECT COUNT(*) FROM sys.indexes i JOIN sys.tables t ON t.object_id = i.object_id
             WHERE t.name = '${w.table}' AND t.schema_id = SCHEMA_ID('dbo') AND i.name = '${w.name}') AS has_index,
           (SELECT COUNT(*) FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id
             WHERE t.name = '${w.table}' AND t.schema_id = SCHEMA_ID('dbo') AND c.name = 'scan_date') AS has_col`,
      );
      const row = r.recordset?.[0] || {};
      if (!row.has_table || row.has_index || !row.has_col) continue;
      const t0 = Date.now();
      await (await ddlPool()).request().query(`CREATE INDEX ${w.name} ON dbo.${w.table} (${w.cols})`);
      done.push(w.name);
      log.log(`[DB] Indeks olusturuldu: dbo.${w.table} (${w.cols}) ${Math.round((Date.now() - t0) / 1000)} sn`);
    } catch (err) {
      log.warn(`[DB] Indeks olusturulamadi (${w.table}):`, err.message);
    }
  }
  } finally {
    if (ddl) { try { await ddl.close(); } catch { /* */ } }
  }
  return done;
}

module.exports = { ensureExternalIndexes, WANTED };
