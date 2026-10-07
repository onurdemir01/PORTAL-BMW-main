// server/auth/oturum-cerezi.cjs — OTURUM CEREZININ ADI ve SESSIZ GECIS (Faz E, 2026-10-02).
//
// Uretimde cerez `__Host-portal.sid` olur. `__Host-` oneki tarayiciya uc kurali ZORLATIR:
// yalnizca HTTPS (Secure), Path=/ ve Domain YOK. Boylece ayni ust alan adindaki baska bir
// uygulama (or. kardes alt alan) portalin oturum cerezini yazamaz / ezemez (cerez
// enjeksiyonu, oturum sabitleme).
//
// GECIS KIMSEYI ATMAZ: eski `connect.sid` ile gelen istekte deger yeni ada kopyalanir
// (imza ayni SESSION_SECRET ile — oturum aynen bulunur), yanitla yeni cerez yazilir
// (`rolling`), eski cerez silinir. Ilk istekten sonra tarayici yalnizca yeni adi tasir.
//
// Gelistirmede (HTTP) `__Host-` KULLANILAMAZ (Secure ister): orada ad `connect.sid` kalir.
// `SESSION_COOKIE_NAME` ile acikca ezilebilir.
'use strict';

const ESKI_AD = 'connect.sid';
const URETIM_ADI = '__Host-portal.sid';

// `__Host-` YALNIZCA Secure cerezle calisir; cerez de yalnizca production'da Secure
// (server/auth/index.cjs). Gelistirmede secilseydi tarayici cerezi REDDEDER ve kimse giris
// yapamazdi — bu yuzden production disinda `__Host-` acik verilse bile eski ada dusulur.
function cerezAdi() {
  const uretim = process.env.NODE_ENV === 'production';
  const acik = String(process.env.SESSION_COOKIE_NAME || '').trim();
  if (/^__Host-[A-Za-z0-9._-]{1,56}$/.test(acik)) {
    if (uretim) return acik;
    console.warn(`[Auth] SESSION_COOKIE_NAME=${acik} yalnizca production'da (HTTPS) kullanilabilir; ${ESKI_AD} kullaniliyor.`);
    return ESKI_AD;
  }
  if (/^[A-Za-z0-9._-]{1,64}$/.test(acik)) return acik;
  return uretim ? URETIM_ADI : ESKI_AD;
}

function cerezOku(baslik, ad) {
  for (const parca of String(baslik || '').split(';')) {
    const i = parca.indexOf('=');
    if (i < 0) continue;
    if (parca.slice(0, i).trim() === ad) return parca.slice(i + 1).trim();
  }
  return null;
}

// SILME cerezi, yazilan cerezle AYNI niteliklerle gitmeli. `__Host-` onekli bir ad icin
// `Secure` tasimayan Set-Cookie tarayicida REDDEDILIR: cikista sunucu oturumu siler ama
// tarayici cerezi tutmaya devam ederdi (her istekte olu bir kimlik tasinir).
function silmeSecenekleri() {
  return { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' };
}

/** Oturum cerez(ler)ini siler: gecerli ad + (farkliysa) eski ad. */
function cerezleriSil(res, ad = cerezAdi()) {
  res.clearCookie(ad, silmeSecenekleri());
  if (ad !== ESKI_AD) res.clearCookie(ESKI_AD, silmeSecenekleri());
}

/** express-session'dan ONCE: eski adla gelen cerezi yeni ada tasir. */
function eskiCereziTasi(ad) {
  return function eskiCereziTasiMw(req, res, next) {
    if (ad === ESKI_AD) return next();
    const baslik = req.headers.cookie;
    if (!baslik) return next();
    const eski = cerezOku(baslik, ESKI_AD);
    if (!eski) return next();
    // Yeni ad zaten varsa YENI kazanir; artakalan eski cerez yalnizca silinir.
    if (cerezOku(baslik, ad) !== null) {
      res.clearCookie(ESKI_AD, silmeSecenekleri());
      return next();
    }
    req.headers.cookie = `${baslik}; ${ad}=${eski}`;
    // Eski cerez yanitla silinir; yeni cerezi express-session (rolling) yazar.
    res.clearCookie(ESKI_AD, silmeSecenekleri());
    next();
  };
}

/** Istekte bir oturum cerezi var mi (hiz siniri anahtari, teshis). Ham deger doner. */
function istektekiOturumCerezi(req) {
  const baslik = req.headers && req.headers.cookie;
  return cerezOku(baslik, cerezAdi()) || cerezOku(baslik, ESKI_AD);
}

/**
 * Hiz siniri icin oturum basina anahtar. Cerezin HAM degeri bellekte anahtar olarak
 * tutulmaz (belirtec = oturumun kendisi): ozeti kullanilir. Eski yazim degerin ilk
 * noktaya kadar olan kismini aliyordu; `v2.<belirtec>` biciminde bu HERKES icin "v2"
 * olurdu — tum kullanicilar tek bir hiz siniri butcesini paylasirdi.
 */
function oturumHizAnahtari(req) {
  const ham = istektekiOturumCerezi(req);
  if (!ham) return null;
  return `sid:${require('node:crypto').createHash('sha256').update(ham).digest('hex').slice(0, 32)}`;
}

module.exports = {
  cerezAdi,
  oturumHizAnahtari,
  eskiCereziTasi,
  istektekiOturumCerezi,
  cerezOku,
  cerezleriSil,
  silmeSecenekleri,
  ESKI_AD,
  URETIM_ADI,
};
