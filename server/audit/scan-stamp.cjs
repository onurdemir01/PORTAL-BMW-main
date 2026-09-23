// server/audit/scan-stamp.cjs — "son tarama" anını (saat:dakika) veren tek yardımcı (2026-09-23).
//
// Kullanıcı: "tarama tarihlerine saat dakika bilgisini de ekler misin?"
// Denetim tabloları yalnızca `scan_date` (GÜN) tutuyordu; Ansible yükleyicileri 2026-09-23'ten
// itibaren tabloya `scanned_at DATETIME2 NULL` sütunu ekliyor (metadata-only ALTER + DEFAULT).
//
// Bu yardımcı ÜÇ DURUMU da sessizce karşılar:
//   * sütun henüz yok (job koşmamış)            → null döner, ekran eski gibi yalnız tarihi gösterir
//   * sütun var ama satırlar eski (NULL)        → null döner
//   * sütun var ve dolu                         → ISO (UTC) damga
// Böylece Portal, job'lar güncellenmeden de çalışmaya devam eder.
'use strict';

const _colCache = new Map(); // tablo -> boolean (sütun var mı); süreç ömrü boyunca

/**
 * @param {(sql: string, params?: unknown[]) => Promise<{ recordset?: unknown[] }>} query mssql query fonksiyonu
 * @param {string} table  'dbo.Nginx_Audit_Hosts' gibi TAM ad (sabit; kullanıcı girdisi DEĞİL)
 * @param {string} [where] isteğe bağlı ek koşul (ör. "scan_date = @d") — parametresiz kullanılır
 * @returns {Promise<string|null>} ISO damga ya da null
 */
async function scanStamp(query, table, where = '') {
  if (!/^[A-Za-z0-9_.]+$/.test(table)) return null; // savunma: yalnız sabit tablo adları
  try {
    if (!_colCache.has(table)) {
      const c = await query(`SELECT COL_LENGTH('${table}', 'scanned_at') AS c`);
      _colCache.set(table, !!(c.recordset && c.recordset[0] && c.recordset[0].c));
    }
    if (!_colCache.get(table)) return null;
    // Son taramanın anı: en yeni scan_date içindeki en yeni scanned_at.
    const sql = `SELECT MAX(scanned_at) AS t FROM ${table}
                  WHERE scan_date = (SELECT MAX(scan_date) FROM ${table})${where ? ' AND ' + where : ''}`;
    const r = await query(sql);
    const v = r.recordset && r.recordset[0] ? r.recordset[0].t : null;
    return v ? new Date(v).toISOString() : null;
  } catch {
    return null; // tarama saati bir SÜS bilgisidir; ekranı düşürmez
  }
}

/** Test/yeniden kurulum için: sütun var mı önbelleğini temizler. */
function _resetScanStampCache() {
  _colCache.clear();
}

module.exports = { scanStamp, _resetScanStampCache };
