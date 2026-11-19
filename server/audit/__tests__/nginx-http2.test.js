// server/audit/__tests__/nginx-http2.test.js
//
// Nginx_Audit_Servers.http2 degerinin okunmasi (Upstream Envanteri kullanir). DB gerektirmez.
// Kilitlenen iddialar:
//   H1 BIT bicimleri: true/1/'1' acik, false/0/'0' kapali
//   H2 NULL / bilinmeyen "olculmedi"dir (null), kapali SAYILMAZ
//   H3 HTTP olmayan kaynaklar yalniz stream / mail
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { h2Degeri, HTTP_DISI } = require('../nginx-http2.cjs');

test('H1 BIT bicimleri', () => {
  for (const v of [true, 1, '1']) assert.equal(h2Degeri(v), true);
  for (const v of [false, 0, '0']) assert.equal(h2Degeri(v), false);
});

test('H2 NULL / bilinmeyen olculmedi; kapali sayilmaz', () => {
  for (const v of [null, undefined, 'x', 2, '', 'true']) assert.equal(h2Degeri(v), null);
});

test('H3 HTTP olmayan kaynaklar', () => {
  assert.deepEqual(HTTP_DISI, ['stream', 'mail']);
});
