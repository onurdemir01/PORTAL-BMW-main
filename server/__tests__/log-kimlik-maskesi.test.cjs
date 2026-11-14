// server/__tests__/log-kimlik-maskesi.test.cjs
//
// URL ICINDEKI KIMLIK LOGA ACIK YAZILMAZ (2026-10-23). Smart istemcisi proxy adresini her cagrida
// logluyordu; yamasiz Node (22.22.2, CVE-2026-48615) tunel hatasinda proxy kimligini mesaja koyar.
//
//   LM1 parola maskelenir; sema, kullanici, sunucu, port kalir; kimliksiz URL degismez
//   LM2 dosya satiri (formatArgs) Error yigininda da maskeler
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { kimlikMaskele, formatArgs } = require('../log.cjs');

test('LM1 parola maskelenir, gerisi kalir', () => {
  assert.equal(
    kimlikMaskele(
      '[Smart] Proxy uzerinden baglanilacak: http://svc:Gizli!23@proxy.ornek:8080 -> smart.ornek',
    ),
    '[Smart] Proxy uzerinden baglanilacak: http://svc:***@proxy.ornek:8080 -> smart.ornek',
  );
  assert.equal(
    kimlikMaskele('a https://u:p@h/x b ftp://k:s@q'),
    'a https://u:***@h/x b ftp://k:***@q',
  );
  for (const degismez of [
    'https://h:8443/yol?x=1',
    'http://yalniz-kullanici@h',
    'duz metin: ok',
    'mailto:a@b.c',
  ]) {
    assert.equal(kimlikMaskele(degismez), degismez);
  }
  assert.equal(kimlikMaskele(42), 42);
});

test('LM2 dosya satiri Error yigininda da maskeler', () => {
  const satir = formatArgs([
    'tunel hatasi:',
    new Error('connect ECONNREFUSED http://svc:Gizli!23@proxy:3128'),
  ]);
  assert.doesNotMatch(satir, /Gizli!23/);
  assert.match(satir, /http:\/\/svc:\*\*\*@proxy:3128/);
});

test('LM3 Bearer, Basic ve JWT belirtecleri maskelenir', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.abc123signature';
  const r1 = kimlikMaskele(`Authorization: Bearer super-gizli-token-999`);
  assert.doesNotMatch(r1, /super-gizli-token-999/);
  assert.equal(r1, 'Authorization: Bearer ***');

  const r2 = kimlikMaskele(`Authorization: Basic dXNlcjpwYXNzd29yZA==`);
  assert.doesNotMatch(r2, /dXNlcjpwYXNzd29yZA==/);
  assert.equal(r2, 'Authorization: Basic ***');

  const r3 = kimlikMaskele(`token=${jwt}`);
  assert.doesNotMatch(r3, /eyJzdWI/);
  assert.doesNotMatch(r3, /abc123signature/);
});

test('LM4 Cookie, Set-Cookie ve oturum cerezi degerleri maskelenir', () => {
  const c1 = kimlikMaskele('Cookie: __Host-portal.sid=s%3Asecret123; theme=dark');
  assert.doesNotMatch(c1, /secret123/);
  assert.equal(c1, 'Cookie: [MASKED]');

  const c2 = kimlikMaskele('Set-Cookie: connect.sid=s%3Aabc; Path=/; HttpOnly');
  assert.doesNotMatch(c2, /s%3Aabc/);
  assert.equal(c2, 'Set-Cookie: [MASKED]');

  const c3 = kimlikMaskele('oturum __Host-portal.sid=gizliOturum123&x=1');
  assert.doesNotMatch(c3, /gizliOturum123/);
  assert.match(c3, /__Host-portal\.sid=\[MASKED\]/);
});

test('LM5 sorgu parametresi ve JSON gizli alanlari maskelenir', () => {
  const q1 = kimlikMaskele('GET /api/login?user=ali&password=CokGizli1&token=tok999');
  assert.doesNotMatch(q1, /CokGizli1/);
  assert.doesNotMatch(q1, /tok999/);
  assert.match(q1, /user=ali/);

  const j1 = kimlikMaskele('{"user":"ali","api_key":"ak_live_12345","client_secret":"cs_999"}');
  assert.doesNotMatch(j1, /ak_live_12345/);
  assert.doesNotMatch(j1, /cs_999/);
  assert.match(j1, /"user":"ali"/);
});
