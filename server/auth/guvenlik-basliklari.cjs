// server/auth/guvenlik-basliklari.cjs — YANIT GUVENLIK BASLIKLARI (2026-10-03).
//
// Uretim modu ilk kez uctan uca kosuldugunda goruldu: ne nginx conf'u ne uygulama HICBIR
// guvenlik basligi koyuyordu. Oturum acik bir portal icin en onemlisi CERCEVEYE GOMULME:
// `SameSite=Lax` cerez baska bir SITEDEN acilan cercevede gitmez, ama ayni ust alan
// adindaki bir kardes alt alan ("ayni site") portali gorunmez bir cerceveye gomup
// kullaniciya dugmelere bastirabilir (clickjacking) — `__Host-` cerez ve koken kontrolunun
// (Faz E) kapattigi tehdit modelinin ucuncu ayagi.
//
//   * Content-Security-Policy: frame-ancestors 'self'  (+ eski tarayicilar icin
//     X-Frame-Options: SAMEORIGIN). Portal kendini cerceveye almaz; baska bir kurumsal
//     sayfa portali BILEREK gomuyorsa PORTAL_FRAME_ANCESTORS'a kokeni eklenir
//     (`*` = koruma kapali).
//   * X-Content-Type-Options: nosniff — yanlis etiketli bir yanit betik/stil diye
//     calistirilamaz.
//   * Referrer-Policy: strict-origin-when-cross-origin — portal adresindeki sorgu (filtre,
//     sunucu adi) baska sitelere tasinmaz; ayni kokende tam adres gider (koken kontrolunun
//     Referer yedegi bozulmaz).
//   * Strict-Transport-Security: VARSAYILAN KAPALI. HSTS ana makine adinin TUM portlarini
//     HTTPS'e zorlar; ayni adda duz HTTP bir servis (baska port) varsa o kirilir. Ad yalnizca
//     HTTPS ise PORTAL_HSTS_MAX_AGE (sn) ile acilir; yalnizca HTTPS isteginde gonderilir.
//
// Degerler her istekte process.env'den okunur (Admin'den sicak degisir).
'use strict';

const OGE = /^('self'|'none'|\*|https?:\/\/[A-Za-z0-9.*-]+(:\d{1,5})?)$/;

/** Gecerli `frame-ancestors` degeri; bozuksa guvenli varsayilan. `*` → null (baslik yok). */
function cerceveAtalari() {
  const ham = String(process.env.PORTAL_FRAME_ANCESTORS || '').trim();
  if (!ham) return "'self'";
  const ogeler = ham.split(/[\s,]+/).filter(Boolean);
  if (!ogeler.length || !ogeler.every((o) => OGE.test(o))) return "'self'";
  if (ogeler.includes('*')) return null;
  if (ogeler.includes("'none'")) return "'none'";
  return ogeler.join(' ');
}

function hstsSuresi() {
  const n = Number(process.env.PORTAL_HSTS_MAX_AGE);
  return Number.isInteger(n) && n > 0 && n <= 63072000 ? n : 0;
}

function guvenlikBasliklari() {
  return function guvenlikBasliklariMw(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    const atalar = cerceveAtalari();
    if (atalar) {
      res.setHeader('Content-Security-Policy', `frame-ancestors ${atalar}`);
      // X-Frame-Options yalnizca iki degeri ifade edebilir; koken listesi varsa CSP yeter
      // (XFO eklemek listedeki mesru cerceveyi eski kuralla ENGELLERDI).
      if (atalar === "'self'") res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      else if (atalar === "'none'") res.setHeader('X-Frame-Options', 'DENY');
    }
    const hsts = hstsSuresi();
    if (hsts && req.secure) res.setHeader('Strict-Transport-Security', `max-age=${hsts}`);
    next();
  };
}

module.exports = { guvenlikBasliklari, cerceveAtalari, hstsSuresi };
