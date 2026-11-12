// server/server-hub/__tests__/karsilastirma.test.cjs - KR1..KR2 (Faz 4, 2026-11-11).
//   KR1 siniflar: KRITIK (A kesin, B kullanimda), A kesin B kararsiz, B aday A yok, B aday A engel,
//       EAR/girdi, eslenemeyen, uyum; KRITIK once siralanir
//   KR2 grup anahtari: taban ad (-T/-Q son eki atilir), ortam, nesil; nesil 0/bos -> '?'
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { karsilastir, grupAnahtari } = require('../karsilastirma.cjs');

const g = (ad, ortam, nesil, karar) => [`grup:${ad}|${ortam}|${nesil}`, { anahtar: `grup:${ad}|${ortam}|${nesil}`, ad, ortam, nesil, karar }];
const e = (o) => ({ tur: 'JVM', seviye: 'KESIN', kurallar: ['R1'], nedenler: [], gen: 8, ortam: 'PROD', ...o, anahtar: `JVM|${o.ad}|${o.ortam || 'PROD'}|${o.gen ?? 8}` });

test('KR1 siniflar', () => {
  const gruplar = new Map([
    g('KULLAN', 'PROD', '8', 'KULLANIMDA'),
    g('KARARSIZ', 'PROD', '8', 'SUPHELI'),
    g('UYUMLU', 'PROD', '8', 'RETIRE_ADAYI'),
    g('ENGELLI', 'PROD', '8', 'RETIRE_ADAYI'),
    g('YALNIZB', 'TEST', '7', 'RETIRE_ADAYI'),
  ]);
  const etiketler = [
    e({ ad: 'KULLAN' }),
    e({ ad: 'KARARSIZ' }),
    e({ ad: 'UYUMLU' }),
    e({ ad: 'ENGELLI', seviye: 'SUPHELI', nedenler: ['web katmani olculemedi'] }),
    e({ ad: 'YOKGRUP' }),
    { tur: 'EAR', ad: 'X.ear', seviye: 'SUPHELI', ortam: 'PROD', gen: 8, anahtar: 'EAR|X.ear|PROD|8' },
  ];
  const r = karsilastir({ etiketler, gruplar });
  const sinif = (konu) => r.satirlar.find((x) => x.konu === konu).sinif;
  assert.equal(sinif('KULLAN'), 'KRITIK_A_KESIN_B_KULLANIMDA');
  assert.equal(sinif('KARARSIZ'), 'A_KESIN_B_KARARSIZ');
  assert.equal(sinif('UYUMLU'), 'UYUM');
  assert.equal(sinif('ENGELLI'), 'B_ADAY_A_ENGEL');
  assert.equal(sinif('YOKGRUP'), 'ANAHTAR_ESLENEMEDI');
  assert.equal(sinif('X.ear'), 'A_ONLY_EAR_GIRDI');
  assert.equal(sinif('YALNIZB'), 'B_ADAY_A_YOK');
  assert.equal(r.satirlar[0].sinif, 'KRITIK_A_KESIN_B_KULLANIMDA', 'KRITIK once gelmeli');
  assert.equal(r.sayilar.KRITIK_A_KESIN_B_KULLANIMDA, 1);
  assert.equal(r.satirlar.filter((x) => x.konu === 'UYUMLU').length, 1, 'etiketli aday grup B_ADAY_A_YOK sayildi');
});

test('KR2 grup anahtari', () => {
  assert.equal(grupAnahtari({ ad: 'MUSTERI-T', ortam: 'TEST', gen: 7 }), 'grup:MUSTERI|TEST|7');
  assert.equal(grupAnahtari({ ad: 'musteri', ortam: 'PROD', gen: 0 }), 'grup:MUSTERI|PROD|?');
  assert.equal(grupAnahtari({ ad: 'A', ortam: null, gen: null }), 'grup:A|?|?');
});
