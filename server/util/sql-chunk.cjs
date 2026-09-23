// server/util/sql-chunk.cjs — `IN (...)` listelerini MSSQL parametre tavaninin
// ALTINDA tut.
//
// NEDEN VAR
// ─────────
// MSSQL bir sorguda en fazla **2100 parametre** kabul eder. Bu depoda iki temizlik
// yolu `... IN ($1, $2, ... $N)` uretiyordu ve `N` = suresi dolmus satir sayisiydi:
//
//   downloads.cleanupExpiredDownloads  → DELETE ... token IN (...)
//   requests.expireOldRequests         → (bu turda hedefli hale getirildi)
//
// Normal gunlerde N kucuk. Ama temizlik turu bir sure kosamazsa (portal kapali,
// DB erisilemez) N birikir; 2100'u astigi anda sorgu HATA verir, tur basarisiz
// olur ve satirlar TEMIZLENMEZ — yani her turda N daha da buyur. Kendi kendini
// kotulestiren bir ariza: hicbir sey olmadan baslayip hic duzelmiyor.
//
// Tavan tek basina yetmez, `SELECT` tarafinda da sinir olmali: sinirsiz bir
// `SELECT` once BELLEGI doldurur (bu depoda sekiz OOM'un sinifi).
'use strict';

/**
 * MSSQL'in sert sinirindan (2100) belirgin sekilde asagida tutulan parca boyu.
 * Sorgunun kendi parametreleri (varsa) de ayni butceden yer kaplar.
 */
const MAX_PARAMS_PER_QUERY = 500;

/**
 * Listeyi en fazla `size` elemanli parcalara boler.
 *
 * Bos liste → bos dizi (cagiran taraf dongu kurmaz, bos `IN ()` uretmez —
 * bos parantez MSSQL'de sozdizimi hatasidir).
 */
function chunk(list, size = MAX_PARAMS_PER_QUERY) {
  const src = Array.isArray(list) ? list : [];
  if (!src.length) return [];
  const n = Math.max(1, Math.floor(size) || MAX_PARAMS_PER_QUERY);
  const out = [];
  for (let i = 0; i < src.length; i += n) out.push(src.slice(i, i + n));
  return out;
}

module.exports = { chunk, MAX_PARAMS_PER_QUERY };
