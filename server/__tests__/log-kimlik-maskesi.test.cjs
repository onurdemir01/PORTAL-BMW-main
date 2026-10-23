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
