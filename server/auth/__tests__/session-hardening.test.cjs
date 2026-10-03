// server/auth/__tests__/session-hardening.test.cjs — oturum cerezi ve imza anahtari.
//
// TARAMA SONUCU ONCE: bu ayarlarin HEPSI dogru yapilandirilmis. Bu bekci bulunan bir
// acigi kapatmiyor — var olan iyi durumu KORUYOR.
//
// NEDEN GEREKLI: bunlar tek satirlik ayarlar ve bozulmalari SESSIZ. `secure: false`
// yapmak (yerelde HTTPS yokken hata ayiklarken cok cazip), `httpOnly`i dusurmek ya da
// production'daki SESSION_SECRET kontrolunu "gecici olarak" kaldirmak — hicbiri test
// kirmaz, hicbiri derlemede gorunmez, ama ucu de oturum calmayi mumkun kilar.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const codeOnly = SRC.split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n');
const flat = codeOnly.replace(/\s+/g, ' ').replace(/"/g, "'");

// `session({ ... })` cagrisindaki `cookie` blogunu cikarir — SABIT PENCERE DEGIL.
function cookieBlock() {
  const at = codeOnly.indexOf('cookie:');
  assert.ok(at > 0, 'session cookie blogu bulunamadi');
  const open = codeOnly.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < codeOnly.length; i++) {
    if (codeOnly[i] === '{') depth++;
    else if (codeOnly[i] === '}' && --depth === 0) return codeOnly.slice(open, i);
  }
  return '';
}

test('SH1 cerez JS`ten OKUNAMAZ (httpOnly)', () => {
  // `httpOnly` dusurulurse XSS ile oturum cerezi dogrudan calinabilir.
  assert.match(cookieBlock(), /httpOnly:\s*true/, 'httpOnly kapali — cerez JS`ten okunabilir');
});

test('SH2 production`da cerez YALNIZCA HTTPS uzerinde gider (secure)', () => {
  const b = cookieBlock().replace(/\s+/g, ' ').replace(/"/g, "'");
  // Sabit `false` OLMAMALI. Ortama bagli olmasi mesru: yerelde HTTPS yok.
  assert.doesNotMatch(b, /secure:\s*false/, 'secure sabit false — cerez duz HTTP`de gider');
  assert.match(
    b,
    /secure:\s*process\.env\.NODE_ENV === 'production'/,
    'secure ortama bagli degil — production`da duz HTTP`de sizabilir',
  );
});

test('SH3 CSRF yuzeyi dar (sameSite)', () => {
  const b = cookieBlock().replace(/\s+/g, ' ').replace(/"/g, "'");
  assert.match(b, /sameSite:\s*'(lax|strict)'/, 'sameSite yok ya da none — CSRF yuzeyi acilir');
});

test('SH4 HICBIR ortamda sabit / bilinen imza anahtari yok; bos anahtar sureci DUSURMEZ', () => {
  // 2026-10-03: oturum artik SESSION_SECRET'e bagli degil (kullanici: "buna bagimli bir sey
  // olmamali" — uretimde rastgele uretiliyor, her seferinde degisebiliyor). Eski kural
  // "bos anahtarla ACILMAZ" idi; yeni kural: bossa SUREC BASINA RASTGELE uretilir.
  // Korunan sey ayni: kaynak kodda duran, herkesce bilinen bir anahtar ASLA kullanilmaz.
  assert.match(
    flat,
    /const SESSION_SECRET = process\.env\.SESSION_SECRET \|\| require\('node:crypto'\)\.randomBytes\(32\)\.toString\('hex'\)/,
    'bos anahtarin yedegi surec basina rastgele degil',
  );
  // Atamada dize SABITI yedek olamaz (eski "bmw-portal-dev-secret..." deseni).
  const atama = flat.slice(flat.indexOf('const SESSION_SECRET'), flat.indexOf(';', flat.indexOf('const SESSION_SECRET')));
  assert.doesNotMatch(atama, /\|\| *'[^']+'/, 'sabit bir anahtar yedegi geri gelmis');
  assert.doesNotMatch(SRC, /dev-secret/, 'eski sabit gelistirme anahtari geri gelmis');
  // Anahtar yok diye surec dusurulmez: buna bagimli hicbir sey yok.
  const ust = codeOnly.slice(0, codeOnly.indexOf('function initAuth'));
  assert.doesNotMatch(ust, /process\.exit\(/, 'SESSION_SECRET yoklugu sureci dusuruyor');
});

test('SH5 oturum SUNUCUDA saklaniyor ve bos oturum YAZILMIYOR', () => {
  // `saveUninitialized: true` her ziyaretciye kayit acar: DB sisirir ve oturum
  // sabitleme (fixation) yuzeyini genisletir.
  assert.match(flat, /saveUninitialized:\s*false/, 'bos oturumlar da kaydediliyor');
  assert.match(flat, /resave:\s*false/, 'her istekte oturum yeniden yaziliyor');
});

test('SH6 oturum kimligi belirtecten turer; imza her istekte gecerli anahtarla yenilenir', () => {
  // Anahtardan bagimsizligin iki ayagi initAuth'ta BAGLI olmali (davranis bekcisi:
  // oturum-belirteci.test.cjs). Biri duserse anahtar degisimi yine herkesi atar.
  assert.match(flat, /genid: oturumBelirteci\.kimlikUret/, 'yeni oturumlar belirtec tabanli degil');
  const katman = flat.indexOf('oturumBelirteci.belirtecKatmani({ ad: COOKIE_NAME, secret: SESSION_SECRET })');
  assert.ok(katman > 0, 'belirtec katmani baglanmamis');
  assert.ok(katman < flat.indexOf('session({'), 'belirtec katmani express-session`dan SONRA — cerez cevrilmeden okunur');
  assert.ok(flat.indexOf('eskiCereziTasi(COOKIE_NAME)') < katman, 'eski ad tasinmadan belirtec katmani calisiyor');
});
