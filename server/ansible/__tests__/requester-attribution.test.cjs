// server/ansible/__tests__/requester-attribution.test.cjs — ISI KIM TETIKLEDI.
//
// URETIM (2026-09-07): kullanici KENDI actigi LogX isinde, AWX extra_vars'inda
// baska bir calisanin adini gordu:
//
//   "requester_email": "onurdemir3@garantibbva.com.tr",
//   "requester_name":  "Onur Demir"
//
// SEBEP LDAP DEGILDI. `runner.launchJobOnServer(serverId, templateId, extraVars,
// limit, requester = null)` — LogX v2 bu fonksiyonu DORT argumanla cagiriyordu,
// yani `requester` HER ZAMAN null'di ve her is kod deposundaki sabit kisiye
// (DEFAULT_REQUESTER) atfediliyordu. Yanlis atif, bildirimin GORUNTUSUNDEN
// ayirt edilemiyordu: varsayilan gercek bir calisanin kimligi oldugu icin o kisi
// kendi adini gorup "calisiyor" sanabilirdi.
//
// Bu bekci iki seyi birden kilitler: (1) kullanici GECIRILIYOR, (2) gecirilemedigi
// durumda bu VERIDE gorunur oluyor.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
const codeOnly = (s) =>
  s
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

test('RA1 LogX v2 isi tetikleyen kullaniciyi GECIRIYOR', () => {
  const src = codeOnly(read('logx/v2/jobs.cjs'));

  // Kullanici istek satirindan okunuyor mu?
  assert.match(
    src,
    /getRequestRow\(requestId\)/,
    'launchJob istegin sahibini hic okumuyor — atif varsayilana duser',
  );

  // VE her launch cagrisina GECIRILIYOR mu. "Dosyada requester geciyor mu" demek
  // YETMEZ: degiskeni tanimlayip cagriya koymamak tam da uretimdeki hataydi.
  const calls = [...src.matchAll(/launchJobOnServer\(([\s\S]*?)\)\s*;/g)];
  assert.ok(
    calls.length >= 2,
    `launchJobOnServer ${calls.length} yerde cagriliyor (>=2 bekleniyor)`,
  );
  for (const c of calls) {
    assert.match(
      c[1],
      /requester/,
      'launchJobOnServer cagrisi requester GECIRMIYOR — is sabit kisiye atfedilir:\n' +
        c[0].slice(0, 160),
    );
  }
});

test('RA2 atif varsayilana dustugunde bu VERIDE gorunur', () => {
  const src = codeOnly(read('ansible/runner.cjs'));

  // Gercek tetikleyici, e-posta cozulemese bile gonderilir.
  assert.match(
    src,
    /requester_username:/,
    'gercek tetikleyicinin kullanici adi gonderilmiyor — yanlis atif izlenemez',
  );
  // Varsayilana dusuldugu ACIKCA isaretlenir.
  assert.match(
    src,
    /requester_is_fallback:/,
    'varsayilana dusuldugu isaretlenmiyor — bildirimin gorunusunden ayirt edilemez',
  );
  // Bayrak SABIT olamaz; gercekten hesaplanmali.
  const flag = (src.match(/requester_is_fallback:\s*([^,\n]+)/) || [])[1] || '';
  assert.doesNotMatch(flag, /^(true|false)\s*$/, 'requester_is_fallback sabit yazilmis');
  assert.match(flag, /rawEmail|rawName/, 'bayrak gercek cozumden turetilmiyor');
});

test('RA3 varsayilan kimlik `.env` ile degistirilebilir', () => {
  const src = codeOnly(read('ansible/runner.cjs'));
  // Kod deposuna gomulu bir calisan kimligi, degistirilemez olmamali.
  assert.match(
    src,
    /process\.env\.PORTAL_DEFAULT_REQUESTER_EMAIL/,
    'varsayilan e-posta kod deposuna sabitlenmis — baska bir kurulumda yanlis kisiyi etiketler',
  );
  assert.match(src, /process\.env\.PORTAL_DEFAULT_REQUESTER_NAME/, 'varsayilan ad sabitlenmis');
});

test('RA4 kullanici adi BILINIYORSA ad varsayilana DUSMEZ', () => {
  const src = codeOnly(read('ansible/runner.cjs'));
  // `displayName` bos ama `username` doluysa ad kullanici adi olmali.
  const fn = src.slice(src.indexOf('function withRequesterVars'));
  assert.match(
    fn.slice(0, 900),
    /rawUsername\s*=\s*String\(user\?\.username/,
    'kullanici adi hic okunmuyor',
  );
  assert.match(
    fn.slice(0, 900),
    /rawName\s*=\s*String\(user\?\.displayName\s*\|\|\s*rawUsername/,
    'ad cozumu kullanici adina dusmuyor — bilinen kisi bile "varsayilan" gorunur',
  );
});
