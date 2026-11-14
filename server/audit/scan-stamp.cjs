// server/audit/scan-stamp.cjs — "son tarama" anini (saat:dakika) veren tek yardimci (2026-09-23).
//
// Kullanici: "tarama tarihlerine saat dakika bilgisini de ekler misin?"
// Denetim tablolari yalnizca `scan_date` (GUN) tutuyordu; Ansible yukleyicileri 2026-09-23'ten
// itibaren tabloya `scanned_at DATETIME2 NULL` sutunu ekliyor (metadata-only ALTER + DEFAULT).
//
// Bu yardimci UC DURUMU da sessizce karsilar:
//   * sutun henuz yok (job kosmamis)            → null doner, ekran eski gibi yalniz tarihi gosterir
//   * sutun var ama satirlar eski (NULL)        → null doner
//   * sutun var ve dolu                         → ISO (UTC) damga
// Boylece Portal, job'lar guncellenmeden de calismaya devam eder.
'use strict';

const _colCache = new Map(); // tablo -> boolean (sutun var mi); surec omru boyunca

/**
 * @param {(sql: string, params?: unknown[]) => Promise<{ recordset?: unknown[] }>} query mssql query fonksiyonu
 * @param {string} table  'dbo.Nginx_Audit_Hosts' gibi TAM ad (sabit; kullanici girdisi DEGIL)
 * @param {string} [where] istege bagli ek kosul (or. "scan_date = @d") — parametresiz kullanilir
 * @returns {Promise<string|null>} ISO damga ya da null
 */
async function scanStamp(query, table, where = '') {
  if (!/^[A-Za-z0-9_.]+$/.test(table)) return null; // savunma: yalniz sabit tablo adlari
  try {
    if (!_colCache.has(table)) {
      const c = await query(`SELECT COL_LENGTH('${table}', 'scanned_at') AS c`);
      _colCache.set(table, !!(c.recordset && c.recordset[0] && c.recordset[0].c));
    }
    if (!_colCache.get(table)) return null;
    // Son taramanin ani: en yeni scan_date icindeki en yeni scanned_at.
    const sql = `SELECT MAX(scanned_at) AS t FROM ${table}
                  WHERE scan_date = (SELECT MAX(scan_date) FROM ${table})${where ? ' AND ' + where : ''}`;
    const r = await query(sql);
    const v = r.recordset && r.recordset[0] ? r.recordset[0].t : null;
    return v ? new Date(v).toISOString() : null;
  } catch {
    return null; // tarama saati bir SUS bilgisidir; ekrani dusurmez
  }
}

/** Test/yeniden kurulum icin: sutun var mi onbellegini temizler. */
function _resetScanStampCache() {
  _colCache.clear();
}

module.exports = { scanStamp, _resetScanStampCache };
