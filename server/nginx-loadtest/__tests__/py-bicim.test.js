// server/nginx-loadtest/__tests__/py-bicim.test.js — Python int / float soz dizimi (py-bicim.cjs).
//
//   PB1 pyOndalikBicimi eski tek desenle (analiz.cjs + sonuc.cjs kopyasi) birebir ayni: 11 harfli
//       alfabede 6 karaktere kadar TUM dizgiler + elle uclar
//   PB2 pyTamsayiBicimi eski PY_INT_RE ile birebir ayni (ayni tarama)
//   PB3 bilinen degerler (Python float() / int() davranisi) ve kotu girdide hizli
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pyOndalikBicimi, pyTamsayiBicimi } = require('../py-bicim.cjs');

// Eski yazim (2026-11-20 oncesi; Sonar S5843 karmasiklik 45). Yalniz referans.
const ESKI_FLOAT =
  /^[+-]?(?:[0-9](?:_?[0-9])*(?:\.(?:[0-9](?:_?[0-9])*)?)?|\.[0-9](?:_?[0-9])*)(?:[eE][+-]?[0-9](?:_?[0-9])*)?$/;
const ESKI_INT = /^[+-]?[0-9](?:_?[0-9])*$/;

const ALFABE = ['0', '7', '_', '.', 'e', 'E', '+', '-', ' ', 'x', '\n'];
const EL = [
  '١', // Arapca rakam: \d degil
  '1٢',
  '1_000.000_1e1_0',
  '+.5e-3',
  '5.e3',
  '.e5',
  'e5',
  '1e',
  '1e+',
  '1e+-5',
  '+-1',
  '1..2',
  '1.2.3',
  '1e2e3',
  ' 1',
  '1 ',
];

function* tumDizgiler(alfabe, maks) {
  yield '';
  let kume = [''];
  for (let n = 1; n <= maks; n += 1) {
    const yeni = [];
    for (const on of kume) for (const c of alfabe) yeni.push(on + c);
    yield* yeni;
    kume = yeni;
  }
}

function karsilastir(yeniFn, eskiRe) {
  let adet = 0;
  let kabul = 0;
  for (const s of [...tumDizgiler(ALFABE, 6), ...EL]) {
    const e = eskiRe.test(s);
    if (yeniFn(s) !== e) assert.fail(`fark: ${JSON.stringify(s)} eski=${e}`);
    adet += 1;
    if (e) kabul += 1;
  }
  return { adet, kabul };
}

test('PB1 pyOndalikBicimi eski tek desenle birebir ayni (6 karaktere kadar tum dizgiler)', () => {
  const { adet, kabul } = karsilastir(pyOndalikBicimi, ESKI_FLOAT);
  assert.ok(adet > 1_900_000, `adet ${adet}`);
  assert.ok(kabul > 1000, `kabul ${kabul}`);
});

test('PB2 pyTamsayiBicimi eski PY_INT_RE ile birebir ayni', () => {
  const { kabul } = karsilastir(pyTamsayiBicimi, ESKI_INT);
  assert.ok(kabul > 100, `kabul ${kabul}`);
});

test('PB3 bilinen degerler, kotu girdide hizli', () => {
  for (const s of ['1', '-4e2', '.5', '5.', '1_000', '+3', '2.5', '1E5', '0.0_1'])
    assert.equal(pyOndalikBicimi(s), true, s);
  for (const s of ['', '1__0', '_1', '1_', '0x10', 'inf', 'nan', '12abc', '.', 'e', ' 1'])
    assert.equal(pyOndalikBicimi(s), false, s);
  assert.equal(pyTamsayiBicimi('-1_0'), true);
  assert.equal(pyTamsayiBicimi('1.0'), false);
  const t0 = performance.now();
  pyOndalikBicimi(`${'1_'.repeat(50000)}x`);
  pyOndalikBicimi(`${'1'.repeat(100000)}.${'2'.repeat(100000)}e${'3'.repeat(100000)}`);
  assert.ok(performance.now() - t0 < 200);
});
