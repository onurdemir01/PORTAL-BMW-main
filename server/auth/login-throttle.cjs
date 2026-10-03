// server/auth/login-throttle.cjs — KULLANICI BASINA GIRIS GERI CEKILMESI (Faz C, 2026-10-02).
//
// NEDEN: tek koruma IP basina dakikada 10 denemeydi. Iki sorunu vardi:
//   * Kurumsal agda yuzlerce kisi ayni NAT/proxy IP'sinden gelir: biri yanlis sifreyle
//     10 kez denerse o IP'deki HERKES bir dakika giremezdi.
//   * Tek bir hesaba karsi yavas deneme (dakikada 9) hic durmazdi; her deneme AD'ye
//     gidip hesabi AD KILIDINE dogru ilerletirdi — kullanici portaldan degil Windows'tan
//     da kilitlenirdi.
// ARTIK: hatali denemeler KULLANICI ADI basina sayilir. Esik (varsayilan 5) asilinca
// istek AD'ye HIC GITMEDEN 429 doner ve bekleme ustel buyur (30 sn, 2 dk, 8 dk, en fazla
// 15 dk). Basarili giris sayaci sifirlar. Esik Admin'den (LOGIN_USER_MAX_FAILS)
// AD'nin kilit esiginin ALTINA cekilebilir.
//
// AD'NIN KILIT ESIGI BILINMIYOR (2026-10-03, kullanici: "ulasamayiz, bizi ilgilendirmemeli").
// Esigi bilmeden yapilabilecek en etkili sey, AD'ye GEREKSIZ hata gondermemek: gercek
// hayatta kilitlenmelerin cogu AYNI yanlis sifrenin ust uste denenmesinden gelir (eski
// sifre, tarayicinin hatirladigi sifre, cift tiklama). Ayni kullanici icin ayni hatali
// sifre kisa bir pencere icinde yeniden gelirse AD'ye GONDERILMEZ ve sayaca yazilmaz:
// AD o sifre icin yalnizca BIR hata gorur. Sifrenin kendisi tutulmaz; surec basina
// rastgele bir anahtarla HMAC ozeti, yalnizca bellekte, kisa omurlu.
//
// BELLEK SINIRLI (OOM dersi): en fazla 10.000 kayit; eski kayitlar her yazimda budanir.
'use strict';

const crypto = require('node:crypto');

const PENCERE_MS = 15 * 60 * 1000; // son hatadan bu kadar sonra sayac unutulur
const ILK_BEKLEME_MS = 30 * 1000;
const UST_BEKLEME_MS = 15 * 60 * 1000;
const KAYIT_UST = 10000;
// Ayni hatali sifrenin AD'ye yeniden gonderilmedigi pencere. Kisa tutulur: sifre AD'de
// az once degistiyse / hesap az once acildiysa kullanici en fazla bu kadar bekler.
const AYNI_SIFRE_PENCERE_MS = 90 * 1000;
const OZET_ANAHTARI = crypto.randomBytes(32);

function sifreOzeti(username, password) {
  return crypto
    .createHmac('sha256', OZET_ANAHTARI)
    .update(anahtar(username))
    .update('\u0000')
    .update(String(password))
    .digest();
}

let saat = () => Date.now();
function _saatAyarla(fn) {
  saat = typeof fn === 'function' ? fn : () => Date.now();
}

function esik() {
  const n = Number(process.env.LOGIN_USER_MAX_FAILS);
  return Number.isInteger(n) && n >= 3 && n <= 20 ? n : 5;
}

// anahtar -> { fails, lastFail, lockedUntil }
const kayitlar = new Map();

function anahtar(username) {
  return String(username || '').toLowerCase();
}

// Kayitlar son hata zamanina gore sirali (her yazimda sona tasinir): bastan bayatlari,
// ust sinir asildiysa en eskileri sil; ilk taze kayitta dur.
function buda(now) {
  for (const [k, v] of kayitlar) {
    const bayat = now - v.lastFail >= PENCERE_MS && now >= v.lockedUntil;
    if (!bayat && kayitlar.size <= KAYIT_UST) break;
    kayitlar.delete(k);
  }
}

/** Giris denenebilir mi? Kilitliyse { ok:false, retryAfter (sn) }. */
function kontrol(username) {
  const v = kayitlar.get(anahtar(username));
  const now = saat();
  if (!v) return { ok: true };
  if (now - v.lastFail >= PENCERE_MS && now >= v.lockedUntil) {
    kayitlar.delete(anahtar(username));
    return { ok: true };
  }
  if (now < v.lockedUntil) return { ok: false, retryAfter: Math.ceil((v.lockedUntil - now) / 1000) };
  return { ok: true };
}

/**
 * Bu kullanici icin bu sifre az once HATALI cikti mi? Oyleyse cagiran AD'ye gitmez.
 * Donus: kalan bekleme (sn) ya da 0.
 */
function ayniHataliSifre(username, password) {
  const v = kayitlar.get(anahtar(username));
  if (!v || !v.sonOzet) return 0;
  const kalan = v.sonOzetAn + AYNI_SIFRE_PENCERE_MS - saat();
  if (kalan <= 0) return 0;
  const ozet = sifreOzeti(username, password);
  return crypto.timingSafeEqual(ozet, v.sonOzet) ? Math.ceil(kalan / 1000) : 0;
}

/**
 * Kimlik hatasi (yanlis sifre / kullanici yok). Sunucu erisilemezligi SAYILMAZ.
 * `password` verilirse ozeti saklanir (ayni hatali sifre AD'ye yeniden gitmesin).
 */
function hataKaydet(username, password) {
  const k = anahtar(username);
  const now = saat();
  const eski = kayitlar.get(k);
  const fails = eski && now - eski.lastFail < PENCERE_MS ? eski.fails + 1 : 1;
  const max = esik();
  let lockedUntil = 0;
  if (fails >= max) {
    const bekleme = Math.min(UST_BEKLEME_MS, ILK_BEKLEME_MS * 4 ** (fails - max));
    lockedUntil = now + bekleme;
  }
  kayitlar.delete(k); // sona tasi (budama sirasi)
  kayitlar.set(k, {
    fails,
    lastFail: now,
    lockedUntil,
    sonOzet: password === undefined ? null : sifreOzeti(username, password),
    sonOzetAn: now,
  });
  buda(now);
  return {
    fails,
    kalan: Math.max(0, max - fails),
    retryAfter: lockedUntil ? Math.ceil((lockedUntil - now) / 1000) : 0,
  };
}

function basariKaydet(username) {
  kayitlar.delete(anahtar(username));
}

function _sifirla() {
  kayitlar.clear();
}

module.exports = {
  kontrol,
  ayniHataliSifre,
  AYNI_SIFRE_PENCERE_MS,
  hataKaydet,
  basariKaydet,
  esik,
  _saatAyarla,
  _sifirla,
  _kayitlar: kayitlar,
  KAYIT_UST,
  PENCERE_MS,
};
