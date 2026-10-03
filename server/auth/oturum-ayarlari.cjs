// server/auth/oturum-ayarlari.cjs — Admin > Sistem Yapilandirmasi "Oturum" anahtarlari
// ve KAYDETMEDEN ONCE dogrulamalari (Faz E, 2026-10-02).
//
// Okuyan kodlar (session-policy, login-throttle, sessions-routes, login-input, service
// hiz siniri) degeri HER ISTEKTE process.env'den okur: hepsi SICAK yuklenir.
// Okuyan taraf bozuk degerde zaten varsayilana duser; burada ayrica REDDEDILIR ki admin
// "kaydettim ama hic etki etmedi" durumuna dusmesin.
'use strict';

const { AYARLAR } = require('./session-policy.cjs');

const SAYI = (anahtar, min, max) => ({ anahtar, tur: 'sayi', min, max });
const KURALLAR = [
  SAYI(AYARLAR.idleMinutes[0], AYARLAR.idleMinutes[1], AYARLAR.idleMinutes[2]),
  SAYI(AYARLAR.absoluteHours[0], AYARLAR.absoluteHours[1], AYARLAR.absoluteHours[2]),
  SAYI(AYARLAR.rememberDays[0], AYARLAR.rememberDays[1], AYARLAR.rememberDays[2]),
  SAYI(AYARLAR.warnSeconds[0], AYARLAR.warnSeconds[1], AYARLAR.warnSeconds[2]),
  SAYI('SESSION_MAX_CONCURRENT', 0, 100),
  SAYI('LOGIN_USER_MAX_FAILS', 3, 20),
  SAYI('LOGIN_IP_MAX_PER_MIN', 5, 1000),
  { anahtar: 'AUTH_ALLOWED_DOMAINS', tur: 'liste', desen: /^[A-Za-z0-9][A-Za-z0-9._-]{0,14}$/ },
  { anahtar: 'AUTH_ALLOWED_UPN_SUFFIXES', tur: 'liste', desen: /^[A-Za-z0-9.-]{1,253}$/ },
  { anahtar: 'PORTAL_ALLOWED_ORIGINS', tur: 'liste', desen: /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/ },
  { anahtar: 'CSRF_ORIGIN_CHECK', tur: 'secim', secenekler: ['enforce', 'log', 'off'] },
  // Okuyan taraf (guvenlik-basliklari.cjs) bozuk degerde 'self'e duser; burada reddedilir.
  {
    anahtar: 'PORTAL_FRAME_ANCESTORS',
    tur: 'ozel',
    kontrol: (v) => {
      const kotu = v.split(/[\s,]+/).filter((o) => o && !/^('self'|'none'|\*|https?:\/\/[A-Za-z0-9.*-]+(:\d{1,5})?)$/.test(o));
      return kotu.length ? `PORTAL_FRAME_ANCESTORS geçersiz öğe: ${kotu.join(', ')} ('self', 'none', * ya da https://alan)` : null;
    },
  },
  SAYI('PORTAL_HSTS_MAX_AGE', 0, 63072000),
];

const OTURUM_AYAR_ANAHTARLARI = KURALLAR.map((k) => k.anahtar);

/** Bos deger her zaman gecerli (= varsayilan). Hata varsa mesaj, yoksa null. */
function oturumAyariHatasi(anahtar, deger) {
  const k = KURALLAR.find((x) => x.anahtar === anahtar);
  if (!k) return null;
  const v = String(deger ?? '').trim();
  if (!v) return null;
  if (k.tur === 'sayi') {
    if (!/^\d+$/.test(v)) return `${anahtar} tam sayı olmalı (${k.min}-${k.max}).`;
    const n = Number(v);
    if (n < k.min || n > k.max) return `${anahtar} ${k.min} ile ${k.max} arasında olmalı.`;
    return null;
  }
  if (k.tur === 'ozel') return k.kontrol(v);
  if (k.tur === 'secim') {
    return k.secenekler.includes(v.toLowerCase()) ? null : `${anahtar}: ${k.secenekler.join(' | ')}`;
  }
  const kotu = v.split(',').map((s) => s.trim()).filter((s) => s && !k.desen.test(s));
  return kotu.length ? `${anahtar} geçersiz öğe: ${kotu.join(', ')}` : null;
}

module.exports = { OTURUM_AYAR_ANAHTARLARI, oturumAyariHatasi };
