// server/auth/oturum-belirteci.cjs — OTURUM, SESSION_SECRET'TEN BAGIMSIZ (2026-10-03).
//
// NEDEN: express-session cerezi `s:<oturum kimligi>.<imza>` bicimindedir ve imza
// SESSION_SECRET ile uretilir. Anahtar degistiginde (uretimde rastgele uretiliyor ve her
// seferinde degisebiliyor) TUM cerezlerin imzasi gecersiz kalir: oturumlar DB'de dururken
// herkes atilir. Kullanici karari: "buna bagimli bir sey olmamali".
//
// MODEL (GitHub / Laravel Sanctum ile ayni: "sunucu belirtecin yalnizca OZETINI saklar"):
//   * Cerez rastgele bir BELIRTEC tasir:  v2.<32 bayt, base64url>
//   * Sunucudaki oturum kimligi belirtecin ozetidir:  ~ + sha256(belirtec)[ilk 186 bit]
//   * Belirtec sunucuda HICBIR yere yazilmaz. `req.sessionID` (oturum tablosu, denetim
//     kaydi, LogX indirme baglamasi...) hep OZETTIR.
//
// KAZANIMLAR:
//   1. Imza artik bir guvenlik denetimi DEGIL; anahtar her yeniden baslatmada degisse de
//      oturum bulunur. Guvenlik, belirtecin 256 bitlik rastgeleligindedir.
//   2. Eskiden oturum kimligi DB'de DUZ duruyordu (portal_sessions.sid, denetim
//      kayitlarindaki session_id, logx session_token). O tablolari okuyabilen biri
//      SESSION_SECRET'i de ele gecirirse oturum calabiliyordu. Artik DB'deki deger ozet:
//      cereze konamaz (ozetin on-goruntusu bulunamaz), anahtar bilinse bile.
//
// GECIS: bu surumden ONCE acilmis oturumlar eski bicimde (`s:<32 karakter>.<imza>`) kalir
// ve eskisi gibi imzayla dogrulanir; en gec mutlak sure (12 sa / beni-hatirla 7 gun)
// sonunda biter. Yeni girislerin hepsi belirtec tabanlidir. Eski bicimli bir cerez YENI
// tur bir kimlik (`~...`) tasiyamaz — tasirsa dusurulur (DB'den okunan ozetle + bilinen
// anahtarla eski kapidan girilemesin).
'use strict';

const crypto = require('node:crypto');

const ONEK = 'v2.';
const BELIRTEC = /^[A-Za-z0-9_-]{43}$/; // 32 bayt base64url
const ESKI_KIMLIK = /^[A-Za-z0-9_-]{32}$/; // express-session uid-safe(24)
const KIMLIK_ISARETI = '~'; // uid-safe alfabesinde YOK: eski kimlikle karismaz

function yeniBelirtec() {
  return crypto.randomBytes(32).toString('base64url');
}

// 32 karakter: denetim tablolarindaki session_id NVARCHAR(36) sinirina sigar.
function kimlik(belirtec) {
  return KIMLIK_ISARETI + crypto.createHash('sha256').update(String(belirtec)).digest('base64url').slice(0, 31);
}

// express-session'in bekledigi imza (cookie-signature ile ayni algoritma). Yalnizca
// express-session'in ic denetimini gecmek icin — guvenlik buna DAYANMAZ.
function imzala(deger, secret) {
  return `${deger}.${crypto.createHmac('sha256', secret).update(deger).digest('base64').replace(/=+$/, '')}`;
}

/** express-session `genid`: yeni oturuma belirtec uretir, kimlik olarak OZETINI verir. */
function kimlikUret(req) {
  const belirtec = yeniBelirtec();
  const sid = kimlik(belirtec);
  if (!req._oturumBelirtecleri) req._oturumBelirtecleri = new Map();
  req._oturumBelirtecleri.set(sid, belirtec);
  return sid;
}

/**
 * express-session'dan ONCE baglanir.
 *   GIRIS: `v2.<belirtec>` cerezini express-session'in anlayacagi imzali ozet kimlige cevirir.
 *   CIKIS: express-session'in yazdigi `s:<ozet>.<imza>` cerezini `v2.<belirtec>` ile degistirir.
 */
function belirtecKatmani({ ad, secret }) {
  const onek = `${ad}=`;
  return function belirtecKatmaniMw(req, res, next) {
    if (!req._oturumBelirtecleri) req._oturumBelirtecleri = new Map();
    const baslik = req.headers.cookie;
    if (baslik && baslik.includes(ad)) {
      const parcalar = baslik.split(';');
      let degisti = false;
      for (let i = 0; i < parcalar.length; i++) {
        const p = parcalar[i];
        const e = p.indexOf('=');
        if (e < 0 || p.slice(0, e).trim() !== ad) continue;
        let ham = p.slice(e + 1).trim();
        try {
          ham = decodeURIComponent(ham);
        } catch {
          ham = '';
        }
        if (ham.startsWith(ONEK) && BELIRTEC.test(ham.slice(ONEK.length))) {
          const belirtec = ham.slice(ONEK.length);
          const sid = kimlik(belirtec);
          req._oturumBelirtecleri.set(sid, belirtec);
          parcalar[i] = ` ${ad}=${encodeURIComponent(`s:${imzala(sid, secret)}`)}`;
          degisti = true;
          continue;
        }
        if (ham.startsWith('s:')) {
          const govde = ham.slice(2);
          // Eski bicim + eski tur kimlik: dokunma, imzayi express-session dogrular.
          if (ESKI_KIMLIK.test(govde.slice(0, govde.lastIndexOf('.')))) continue;
        }
        // Taninmayan bicim ya da eski bicimle yeni tur kimlik: cerezi dusur.
        parcalar[i] = null;
        degisti = true;
      }
      if (degisti) req.headers.cookie = parcalar.filter((x) => x !== null).join(';');
    }

    // Basliklar gonderilmeden hemen once cerezi belirtece cevir. `writeHead` sarmalanir
    // (express-session'in kullandigi on-headers ile ayni teknik; ek bagimlilik yok).
    // express-session kendi sarmalini BU katmandan sonra kurar, yani onunki DISTA kalir:
    // once o calisip cerezi yazar, sonra bu sarmala duser — cerez o an yazilmistir.
    const asilWriteHead = res.writeHead;
    let yazildi = false;
    res.writeHead = function belirteciYazVeDevam(...args) {
      if (!yazildi) {
        yazildi = true;
        belirteciYaz();
      }
      return asilWriteHead.apply(this, args);
    };
    function belirteciYaz() {
      const sc = res.getHeader('Set-Cookie');
      if (!sc) return;
      const liste = Array.isArray(sc) ? sc : [String(sc)];
      let degisti = false;
      const yeni = liste.map((c) => {
        if (!c.startsWith(onek)) return c;
        const son = c.indexOf(';');
        const deger = son < 0 ? c.slice(onek.length) : c.slice(onek.length, son);
        let coz;
        try {
          coz = decodeURIComponent(deger);
        } catch {
          return c;
        }
        if (!coz.startsWith('s:')) return c; // silme cerezi (bos deger) vb.
        const govde = coz.slice(2);
        const belirtec = req._oturumBelirtecleri.get(govde.slice(0, govde.lastIndexOf('.')));
        if (!belirtec) return c; // eski tur oturum: imzali cerez aynen kalir
        degisti = true;
        return `${onek}${ONEK}${belirtec}${son < 0 ? '' : c.slice(son)}`;
      });
      if (degisti) res.setHeader('Set-Cookie', yeni);
    }
    next();
  };
}

module.exports = { belirtecKatmani, kimlikUret, kimlik, yeniBelirtec, imzala, ONEK, KIMLIK_ISARETI };
