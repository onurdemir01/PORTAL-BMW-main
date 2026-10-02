// server/auth/__tests__/giris-girdisi.test.cjs
//
// GIRIS GIRDISI (Faz C, 2026-10-02). Kullanici: "user pass girerken olabilecek her
// kombinasyonu handle edebilsin". Her satir ayri bir vaka: biri bozulunca hangisi
// oldugu adiyla gorunur.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLoginInput, checkPassword } = require('../login-input.cjs');

function ortam(env, fn) {
  const eski = {};
  for (const k of Object.keys(env)) {
    eski[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (eski[k] === undefined) delete process.env[k];
      else process.env[k] = eski[k];
    }
  }
}

const IYI = [
  // [ad, girdi, beklenen username, beklenen lookup]
  ['duz', 'ayse.yilmaz', 'ayse.yilmaz', { attr: 'sAMAccountName', value: 'ayse.yilmaz' }],
  ['buyuk harf', 'AYSE.Yilmaz', 'ayse.yilmaz', { attr: 'sAMAccountName', value: 'ayse.yilmaz' }],
  ['bas/son bosluk', '  ayse  ', 'ayse', { attr: 'sAMAccountName', value: 'ayse' }],
  ['KURUM\\ad', 'KURUM\\Ayse', 'ayse', { attr: 'sAMAccountName', value: 'ayse' }],
  ['kurum\\ad kucuk', 'kurum\\ayse', 'ayse', { attr: 'sAMAccountName', value: 'ayse' }],
  ['UPN', 'Ayse@Kurum.com.tr', 'ayse', { attr: 'userPrincipalName', value: 'ayse@kurum.com.tr' }],
  ['noktali buyuk I (Turkce klavye)', '\u0130sci', 'isci', { attr: 'sAMAccountName', value: 'isci' }],
  ['noktasiz kucuk i', 'hakan.\u0131sci', 'hakan.isci', { attr: 'sAMAccountName', value: 'hakan.isci' }],
  ['eski toLowerCase ciktisi (i + U+0307)', 'i\u0307sci', 'isci', { attr: 'sAMAccountName', value: 'isci' }],
  ['NFD bicimi', 'jose\u0301', 'jos\u00e9', { attr: 'sAMAccountName', value: 'jos\u00e9' }],
  ['bastaki BOM (yapistirma) kirpilir', '\ufeffayse', 'ayse', { attr: 'sAMAccountName', value: 'ayse' }],
  ['tire ve alt cizgi', 'a_b-c.d', 'a_b-c.d', { attr: 'sAMAccountName', value: 'a_b-c.d' }],
];

for (const [ad, girdi, username, lookup] of IYI) {
  test(`GG kabul: ${ad}`, () => {
    const r = normalizeLoginInput(girdi);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.username, username);
    assert.deepEqual(r.lookup, lookup);
  });
}

const KOTU = [
  ['bos', '', 'bos'],
  ['yalniz bosluk', '   ', 'bos'],
  ['dizi degil', ['a'], 'bos'],
  ['null', null, 'bos'],
  ['ortada bosluk', 'ayse yilmaz', 'gecersiz'],
  ['sekme', 'ayse\tx', 'gecersiz'],
  ['NUL', 'ayse\u0000', 'gecersiz'],
  ['sifir genislikli bosluk (yapistirma)', 'ayse\u200b', 'gecersiz'],
  ['ortada BOM', 'ay\ufeffse', 'gecersiz'],
  ['iki ters bolu', 'A\\B\\c', 'gecersiz'],
  ['bos alan adi', '\\ayse', 'gecersiz'],
  ['bos ad', 'KURUM\\', 'gecersiz'],
  ['alan adi + UPN', 'KURUM\\ayse@kurum.com', 'gecersiz'],
  ['iki @', 'a@b@c', 'gecersiz'],
  ['bos UPN soneki', 'ayse@', 'gecersiz'],
  ['LDAP filtre karakteri *', 'ay*se', 'gecersiz'],
  ['virgul', 'ayse,ou=x', 'gecersiz'],
  ['esittir', 'cn=ayse', 'gecersiz'],
  ['cok uzun', 'a'.repeat(257), 'uzun'],
];

for (const [ad, girdi, code] of KOTU) {
  test(`GG ret: ${ad}`, () => {
    const r = normalizeLoginInput(girdi);
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.code, code);
    assert.ok(r.message && r.message.length > 5, 'kullaniciya mesaj yok');
  });
}

test('GG izinli alan adlari: liste verilmisse disindaki NetBIOS reddedilir, icindeki kabul', () => {
  ortam({ AUTH_ALLOWED_DOMAINS: 'KURUM, test' }, () => {
    assert.equal(normalizeLoginInput('kurum\\a').ok, true);
    assert.equal(normalizeLoginInput('TEST\\a').ok, true);
    const r = normalizeLoginInput('BASKA\\a');
    assert.equal(r.code, 'alan_adi');
  });
  ortam({ AUTH_ALLOWED_DOMAINS: undefined }, () => assert.equal(normalizeLoginInput('BASKA\\a').ok, true));
});

test('GG izinli UPN sonekleri', () => {
  ortam({ AUTH_ALLOWED_UPN_SUFFIXES: 'kurum.com.tr' }, () => {
    assert.equal(normalizeLoginInput('a@KURUM.com.tr').ok, true);
    assert.equal(normalizeLoginInput('a@gmail.com').code, 'alan_adi');
  });
});

test('GG arama ozniteligi zaten UPN/mail ise ayni oznitelik TAM degerle kullanilir', () => {
  const r = normalizeLoginInput('a@kurum.com', { searchAttr: 'mail' });
  assert.deepEqual(r.lookup, { attr: 'mail', value: 'a@kurum.com' });
});

test('GG sifre: KIRPILMAZ, bos ve cok uzun reddedilir', () => {
  assert.equal(checkPassword(' bosluklu ').ok, true);
  assert.equal(checkPassword('').code, 'bos');
  assert.equal(checkPassword(undefined).code, 'bos');
  assert.equal(checkPassword(12345).code, 'bos');
  assert.equal(checkPassword('x'.repeat(1025)).code, 'uzun');
  assert.equal(checkPassword('x'.repeat(1024)).ok, true);
});
