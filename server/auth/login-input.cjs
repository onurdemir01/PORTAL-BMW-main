// server/auth/login-input.cjs — GIRIS GIRDISININ TEK NORMALIZASYON NOKTASI (Faz C, 2026-10-02).
//
// Kullanici: "user pass girerken olabilecek her kombinasyonu handle edebilsin". Eskiden
// ad yalnizca `trim` ediliyordu; asagidakilerin HEPSI ayni "Kullanici adi veya sifre
// hatali" mesajina dusuyordu ve kullanici "atildim / sifrem yanlis" saniyordu:
//   * `KURUM\kullanici` (Windows aliskanligi)       -> LDAP'ta `KURUM\kullanici` aranirdi
//   * `kullanici@kurum.com` (e-posta aliskanligi)   -> sAMAccountName'de aranirdi, bulunmazdi
//   * Turkce klavye / telefon: buyuk noktali I ile baslayan ad -> JS `toLowerCase` ->
//     `i` + birlesik nokta (U+0307): AD'de hic eslesmez
//   * yapistirilan gorunmez karakterler, ortadaki bosluk, NFD bicimi
//
// SAF modul: env okur ama G/C yapmaz; tablo testiyle her vaka ayri sinanir.
'use strict';

const AD_YASAK = /["/\\[\]:;|=,+*?<>]/; // sAMAccountName'de gecemeyen karakterler
const KONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u2060\ufeff]/;
const NETBIOS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,14}$/;
const AD_UST = 256;
const SIFRE_UST = 1024;

function liste(anahtar) {
  return String(process.env[anahtar] || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Dil-bagimsiz kucuk harf + Turkce i ailesi katlamasi. AD hesap adlari pratikte ASCII'dir;
// noktali I / noktasiz i buraya yalnizca Turkce klavye/telefon otomatik buyuk harfi yuzunden gelir.
function katla(s) {
  return s
    .replace(/\u0130/g, 'I') // buyuk noktali I
    .replace(/\u0131/g, 'i') // noktasiz kucuk i
    .toLowerCase()
    .replace(/i\u0307/g, 'i'); // i + birlesik nokta (eski toLowerCase ciktisi)
}

function hata(code, message) {
  return { ok: false, code, message };
}

/**
 * Ham kullanici adi -> arama bilgisi.
 * Basarida: { ok: true, username, lookup: { attr, value }, domain? }
 *   `username`  oturumda ve loglarda kullanilan kanonik ad (kucuk harf, alan adsiz)
 *   `lookup`    LDAP'ta ne aranacak (UPN girildiyse userPrincipalName ile TAM deger)
 * Hatada: { ok: false, code, message } — mesaj kullaniciya aynen gosterilir.
 */
function normalizeLoginInput(ham, { searchAttr = 'sAMAccountName' } = {}) {
  if (typeof ham !== 'string') return hata('bos', 'Kullanıcı adı gerekli.');
  let s = ham.normalize('NFC').trim();
  if (!s) return hata('bos', 'Kullanıcı adı gerekli.');
  if (s.length > AD_UST) return hata('uzun', 'Kullanıcı adı çok uzun.');
  if (KONTROL.test(s)) return hata('gecersiz', 'Kullanıcı adında görünmez/geçersiz bir karakter var. Elle yazmayı deneyin.');
  if (/\s/.test(s)) return hata('gecersiz', 'Kullanıcı adında boşluk olamaz.');

  // KURUM\kullanici
  let domain;
  const ters = s.split('\\');
  if (ters.length > 2) return hata('gecersiz', 'Kullanıcı adı biçimi tanınmadı. Örnek: kullanici veya KURUM\\kullanici');
  if (ters.length === 2) {
    const [d, u] = ters;
    if (!NETBIOS.test(d) || !u) {
      return hata('gecersiz', 'Kullanıcı adı biçimi tanınmadı. Örnek: kullanici veya KURUM\\kullanici');
    }
    const izinli = liste('AUTH_ALLOWED_DOMAINS');
    if (izinli.length && !izinli.includes(d.toLowerCase())) {
      return hata('alan_adi', `"${d}" alan adı bu portalda kullanılamıyor. Yalnızca kullanıcı adınızı yazın.`);
    }
    domain = d.toUpperCase();
    s = u;
  }

  // kullanici@kurum
  const at = s.indexOf('@');
  if (at >= 0) {
    if (domain) return hata('gecersiz', 'Alan adını iki kez yazmayın: "KURUM\\kullanici" ya da "kullanici@kurum".');
    const yerel = s.slice(0, at);
    const sonek = s.slice(at + 1);
    if (!yerel || !sonek || sonek.includes('@') || !/^[A-Za-z0-9.-]+$/.test(sonek)) {
      return hata('gecersiz', 'E-posta biçimi tanınmadı. Yalnızca kullanıcı adınızı da yazabilirsiniz.');
    }
    if (AD_YASAK.test(yerel)) return hata('gecersiz', 'Kullanıcı adında geçersiz karakter var.');
    const izinli = liste('AUTH_ALLOWED_UPN_SUFFIXES');
    if (izinli.length && !izinli.includes(sonek.toLowerCase())) {
      return hata('alan_adi', `"@${sonek}" bu portalda kullanılamıyor. Yalnızca kullanıcı adınızı yazın.`);
    }
    const tam = `${katla(yerel)}@${sonek.toLowerCase()}`;
    // Arama ozniteligi zaten UPN/mail ise ayni ozniteligi TAM degerle kullan; degilse UPN.
    const attr = /^(userPrincipalName|mail)$/i.test(searchAttr) ? searchAttr : 'userPrincipalName';
    return { ok: true, username: katla(yerel), lookup: { attr, value: tam }, upn: true };
  }

  if (AD_YASAK.test(s)) return hata('gecersiz', 'Kullanıcı adında geçersiz karakter var.');
  const ad = katla(s);
  return { ok: true, username: ad, lookup: { attr: searchAttr, value: ad }, ...(domain ? { domain } : {}) };
}

/** Sifre: KIRPILMAZ (bosluk sifrenin parcasi olabilir); yalnizca tur ve uzunluk. */
function checkPassword(p) {
  if (typeof p !== 'string' || p.length === 0) return hata('bos', 'Şifre gerekli.');
  if (p.length > SIFRE_UST) return hata('uzun', 'Şifre çok uzun.');
  return { ok: true };
}

module.exports = { normalizeLoginInput, checkPassword, katla, AD_UST, SIFRE_UST };
