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

test('SH4 production`da BOS SESSION_SECRET ile ACILMAZ', () => {
  // Bilinen bir imza anahtariyla oturum SAHTECILIGI mumkun olur. Kontrol
  // GURULTULU olmali: uyarip devam etmek, kimsenin fark etmedigi bir acik birakir.
  assert.match(
    flat,
    /NODE_ENV === 'production' && !process\.env\.SESSION_SECRET/,
    'production`da bos SESSION_SECRET kontrolu yok',
  );
  const at = codeOnly.indexOf('!process.env.SESSION_SECRET');
  assert.match(
    codeOnly.slice(at, at + 700),
    /process\.exit\(1\)/,
    'bos secret ile SUSARAK devam ediliyor — uyarmak yetmez, ACILMAMALI',
  );
});

test('SH5 oturum SUNUCUDA saklaniyor ve bos oturum YAZILMIYOR', () => {
  // `saveUninitialized: true` her ziyaretciye kayit acar: DB sisirir ve oturum
  // sabitleme (fixation) yuzeyini genisletir.
  assert.match(flat, /saveUninitialized:\s*false/, 'bos oturumlar da kaydediliyor');
  assert.match(flat, /resave:\s*false/, 'her istekte oturum yeniden yaziliyor');
});

test('SH6 gelistirme fallback`i PRODUCTION`a sizamaz', () => {
  // Sabit fallback anahtari YERELDE mesru (sifir-kurulum). Tehlike, production
  // kontrolunun kaldirilip fallback`in oraya sizmasi. SH4 o kontrolu kilitliyor;
  // burada fallback`in TEK basina kalmadigini dogruluyoruz.
  const at = codeOnly.indexOf('const SESSION_SECRET');
  assert.ok(at > 0, 'SESSION_SECRET tanimi bulunamadi');
  // Tanimdan ONCE production kontrolu gelmeli — sonra gelseydi fallback zaten atanmis olurdu.
  assert.ok(
    codeOnly.indexOf('!process.env.SESSION_SECRET') < at,
    'production kontrolu SESSION_SECRET atamasindan SONRA — fallback yine de kullanilir',
  );
});
