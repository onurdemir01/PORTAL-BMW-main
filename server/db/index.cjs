'use strict';
// PostgreSQL → MSSQL adapter
// Provides a { rows, rowCount } compatible interface over the existing MSSQL pool.
//
// MIMARI NOT (kurumsal AI kod incelemesi, review.md #16): bu regex-tabanli adapter
// PG-tarzi YAZILAN SQL STRING'lerini (developer conventionu) T-SQL'e cevirir — repoda
// GERCEK bir PostgreSQL suruculu baglanti YOK (yalniz `mssql`), dolayisiyla "iki lehceyi
// destekleme" izlenimi vermez, tek amaci kod tabanindaki 169 `db.query(` cagri noktasinin
// pg-benzeri, tutarli bir sozdizimi kullanabilmesidir. Adapter'i kaldirip tum cagri
// noktalarini native T-SQL'e cevirmek bu turun kapsami disinda (169 site) — onun yerine
// kapsadigi/kapsamadigi durumlar (asagida ILIKE notu gibi) acikca belgelenir ve regex'ler
// (asagidaki handleReturning gibi) test kapsamiyla sertlestirilir.
const mssql = require('mssql');
const { getPool } = require('./portal-mssql.cjs');

// ── SQL translation ───────────────────────────────────────────────────────────

// Onceki regex ([\w\s,*]+) koseli-parantezli (`[id]`) veya tablo-nitelikli (`t.id`) kolon
// adlarini yakalayamiyordu (kurumsal AI kod incelemesi, review.md #20) — su an hicbir gercek
// db.query( cagri noktasi bu bicimleri kullanmiyor (dogrulandi, tek RETURNING kullanimi
// history.cjs'teki duz `RETURNING id`), yani onleyici bir sertlestirme, aktif bug degil.
// Yeni regex noktali virgul HARIC her karakteri yakalar.
function handleReturning(sql) {
  const m = sql.match(/\bRETURNING\b\s+([^;]+?)\s*(?:;\s*)?$/i);
  if (!m) return sql;

  const rawCols = m[1].trim();
  const outputCols = rawCols === '*'
    ? 'INSERTED.*'
    : rawCols.split(',').map(c => {
        const col = c.trim();
        // Tablo/alias-nitelikli RETURNING kolonlari (RETURNING t.id) icin OUTPUT'ta
        // INSERTED/DELETED pseudo-tablosuna gore SADECE kolon adi kalmali —
        // `OUTPUT INSERTED.t.id` GECERSIZ T-SQL'dir; son "." sonrasi segment alinir.
        const bare = col.includes('.') ? col.slice(col.lastIndexOf('.') + 1) : col;
        return `INSERTED.${bare}`;
      }).join(', ');

  // Remove RETURNING clause
  sql = sql.replace(/\s*\bRETURNING\b\s+[^;]+?\s*(?:;\s*)?$/i, '').trim();

  if (/^\s*INSERT\b/i.test(sql)) {
    // INSERT INTO t (cols) OUTPUT INSERTED.* VALUES (...)
    sql = sql.replace(/\b(VALUES\b)/i, `OUTPUT ${outputCols} $1`);
  } else if (/^\s*UPDATE\b/i.test(sql)) {
    // UPDATE t SET ... OUTPUT INSERTED.* WHERE ...
    // WHERE'siz bir UPDATE...RETURNING (ornegin "UPDATE t SET col=$1 RETURNING col") burada
    // WHERE regex'i hic eslesmedigi icin OUTPUT eklenmeden geciyordu — RETURNING zaten yukarida
    // silinmis oldugundan sonuc: satir(lar) guncellenir AMA caller'a rows=[] doner (sessiz veri
    // kaybi, hata firlatilmaz). WHERE varsa onun onune, yoksa sorgunun sonuna OUTPUT eklenir.
    if (/\bWHERE\b/i.test(sql)) {
      sql = sql.replace(/\b(WHERE\b)/i, `OUTPUT ${outputCols} $1`);
    } else {
      sql = sql.trimEnd().replace(/;?$/, '') + ` OUTPUT ${outputCols}`;
    }
  }
  return sql;
}

function adaptSql(pgSql) {
  let s = pgSql;

  // 1) RETURNING → OUTPUT INSERTED (before $n substitution)
  s = handleReturning(s);

  // 2) $n → @pn
  s = s.replace(/\$(\d+)/g, '@p$1');

  // 3) Boolean literals (PG → MSSQL)
  // \b= won't match "col = true" (space before =), so use =\s* directly
  s = s.replace(/=\s*true\b/gi,  '= 1');
  s = s.replace(/=\s*false\b/gi, '= 0');
  s = s.replace(/\bIS\s+true\b/gi,  '= 1');
  s = s.replace(/\bIS\s+false\b/gi, '= 0');

  // 4) ILIKE → LIKE
  // DIKKAT: bu donusum buyuk/kucuk harf duyarsizligini GARANTI ETMEZ. PG'de ILIKE her
  // zaman case-insensitive'dir; MSSQL'de LIKE, sutun/DB collation'ina baglidir (collation
  // "_CS_" iceriyorsa case-sensitive kalir) — sonuc PG'den sessizce farklilasabilir. Su an
  // uygulamada hic ILIKE kullanimi yok (dead code path); kullanilmaya baslanirsa
  // LOWER(col) LIKE LOWER($n) deseni ya da acik COLLATE tercih edilmelidir.
  s = s.replace(/\bILIKE\b/gi, 'LIKE');

  // 5) NOW() → GETUTCDATE() (GETDATE() returns local time UTC+3; portal timestamps must be UTC)
  s = s.replace(/\bNOW\(\)/gi, 'GETUTCDATE()');

  // 6) LIMIT @pX OFFSET @pY → OFFSET @pY ROWS FETCH NEXT @pX ROWS ONLY
  s = s.replace(/\bLIMIT\s+(@p\d+)\s+OFFSET\s+(@p\d+)/gi, 'OFFSET $2 ROWS FETCH NEXT $1 ROWS ONLY');
  s = s.replace(/\bLIMIT\s+(\d+)\s+OFFSET\s+(\d+)/gi, 'OFFSET $2 ROWS FETCH NEXT $1 ROWS ONLY');
  s = s.replace(/\bLIMIT\s+(@p\d+)/gi, 'OFFSET 0 ROWS FETCH NEXT $1 ROWS ONLY');
  s = s.replace(/\bLIMIT\s+(\d+)/gi, 'OFFSET 0 ROWS FETCH NEXT $1 ROWS ONLY');

  return s;
}

function inferType(val) {
  if (val === null || val === undefined) return mssql.NVarChar(mssql.MAX);
  if (typeof val === 'boolean') return mssql.Bit;
  if (typeof val === 'number') return Number.isInteger(val) ? mssql.Int : mssql.Float;
  if (val instanceof Date) return mssql.DateTime2;
  return mssql.NVarChar(mssql.MAX);
}

function coerce(val) {
  if (val === undefined) return null;
  if (Array.isArray(val)) return JSON.stringify(val);
  if (typeof val === 'boolean') return val ? 1 : 0;
  return val;
}

// ── Public API ────────────────────────────────────────────────────────────────

async function _execQuery(pgSql, params) {
  const pool = await getPool().catch(() => null);
  if (!pool) throw new Error('Database not available. MSSQL bağlantısı yok.');

  const request = pool.request();
  (params || []).forEach((val, idx) => {
    request.input(`p${idx + 1}`, inferType(val), coerce(val));
  });

  const sql = adaptSql(pgSql);
  const result = await request.query(sql);

  const rows = result.recordset || [];
  const rowCount = result.rowsAffected?.[0] ?? rows.length;
  return { rows, rowCount };
}

async function query(pgSql, params = []) {
  try {
    return await _execQuery(pgSql, params);
  } catch (err) {
    // Single retry for transient connection drop (ECONNCLOSED, ECONNRESET, etc.)
    const isTransient = err.code === 'ECONNCLOSED' || err.code === 'ECONNRESET' ||
      err.message?.includes('Connection not yet open') || err.message?.includes('pool');
    if (isTransient) {
      console.warn('[db] Transient connection error, retrying once:', err.message);
      await new Promise(r => setTimeout(r, 300));
      return _execQuery(pgSql, params);
    }
    throw err;
  }
}

async function isAvailable() {
  try {
    const pool = await getPool();
    if (!pool) return false;
    await pool.request().query('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  query, isAvailable,
  // saf ceviri yardimcilari — birim testleri icin acildi (DB gerektirmez)
  _adaptSql: adaptSql, _handleReturning: handleReturning, _coerce: coerce,
};
