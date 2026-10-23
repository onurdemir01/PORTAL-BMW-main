// server/auth/brotli-govde-reddi.cjs — BROTLI ILE SIKISTIRILMIS ISTEK GOVDESI REDDI (2026-10-23).
//
// Node.js 2026-10-21 guvenlik yayini: CVE-2026-111497 (High) — Node'un gomulu Brotli cozucusunde
// sinir disi yazma, uzaktan kod calistirma. Portal'in sunucusunda Node v20.20.2 kosuyor; 20.x
// 2026-04-30'da omrunu doldurdu ve bu yayinda YAMA ALMADI (yamali surumler: 22.23.4 / 24.22.1 /
// 26.12.1).
//
// Portal'da cozucuye en kolay ulasan yol: Express 5'in govde ayristiricisi (body-parser 2.x)
// `Content-Encoding: br` gelen govdeyi zlib.createBrotliDecompress() ile ACIYOR — ve
// express.json() TUM isteklerde, oturum kontrolunden ONCE kosuyor (service.cjs). Yani agdaki
// herkes, oturum acmadan, herhangi bir POST ucuna hazirlanmis bir Brotli govdesi gonderebilir.
//
// Bu ara katman Node yukseltilene kadar o yolu KAPATIR: Content-Encoding'i `br` iceren her istek,
// govdesi HIC okunmadan 415 ile reddedilir. Tarayicilar ve Portal'in kendi istemcileri istek
// govdesini sikistirmaz; gzip / deflate etkilenmez (bu yayinda acik yok). Kalici cozum Node
// yukseltmesidir; yukseltmeden sonra da zarari yok (Brotli govde beklenen bir sey degil).
'use strict';

function brotliKodlamasi(baslik) {
  return String(baslik || '')
    .toLowerCase()
    .split(',')
    .some((k) => k.trim() === 'br');
}

/** Express ara katmani: `Content-Encoding: br` -> 415, govde okunmaz. */
function brotliGovdeReddi() {
  return (req, res, next) => {
    if (!brotliKodlamasi(req.headers['content-encoding'])) return next();
    console.warn(`[guvenlik] Brotli sikistirilmis istek govdesi reddedildi: ${req.method} ${String(req.originalUrl || req.url).split('?')[0]} (${req.ip})`);
    // Govde okunmadigi icin baglanti yeniden kullanilmaz.
    res.set('Connection', 'close');
    res.status(415).json({ ok: false, message: 'Brotli ile sıkıştırılmış istek gövdesi kabul edilmiyor.' });
  };
}

module.exports = { brotliGovdeReddi, brotliKodlamasi };
