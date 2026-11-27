// server/admin/__tests__/kurum-ayari-fark.test.js - KF1..KF9 (2026-11-27).
//
// shared/kurumAyari.cjs saf kurallari: Admin > Kurum Ayari fark on izlemesi (ekran) ve denetimdeki
// anahtar yollari (sunucu) ayni hesaptan gelir.
//   KF1 nesne: eklenen / silinen / degisen yol; anahtar sirasi fark sayilmaz
//   KF2 ilkel liste kume gibi: eklenen / cikan deger, tekrar sayisi, yalniz sira degisimi
//   KF3 nesne ogeli liste sira numarasiyla alan alan (eklenen / silinen oge); tur degisimi butun alan
//   KF4 okunur yol: noktali / ozel karakterli anahtar koseli, liste sirasi [i]
//   KF5 farkYollari degerleri tasimaz, sirali; farkBosMu
//   KF6 sunucuIhlalleri / yeniSunucuIhlalleri: tur, '*' acilimi, olmayan alan serbest
//   KF7 yeni ihlal tekrar sayar; 'anahtarlar' turu (nginx.rvp.sunucular)
//   KF8 onayliSilmeler: silinen / bosaltilan / turu degisen bolum, silinen dolu sunucu alani
//   KF9 derinlikAsildi yinelemeli (yigin tasirmaz)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  SUNUCU,
  farkHesapla,
  farkBosMu,
  farkYollari,
  sunucuIhlalleri,
  yeniSunucuIhlalleri,
  onayliSilmeler,
  derinlikAsildi,
  MAKS_DERINLIK,
} = require('../../../shared/kurumAyari.cjs');

test('KF1 nesne farki; anahtar sirasi fark sayilmaz', () => {
  const f = farkHesapla(
    { a: 1, b: { c: 2, d: 3 }, x: true },
    { b: { d: 3, c: 5 }, a: 1, y: { z: 1 } },
  );
  assert.deepEqual(f.eklenen, [{ yol: 'y', deger: { z: 1 } }]);
  assert.deepEqual(f.silinen, [{ yol: 'x', deger: true }]);
  assert.deepEqual(f.degisen, [{ yol: 'b.c', eski: 2, yeni: 5 }]);
  assert.deepEqual(f.listeler, []);
  assert.equal(farkBosMu(farkHesapla({ a: 1, b: [1] }, { b: [1], a: 1 })), true);
});

test('KF2 ilkel liste kume gibi okunur', () => {
  const f = farkHesapla({ l: ['A', 'B', 'B', 'C'] }, { l: ['B', 'D', 'A'] });
  assert.deepEqual(f.listeler, [
    { yol: 'l', eklenen: ['D'], cikan: ['B', 'C'], siraDegisti: false },
  ]);
  const sira = farkHesapla({ l: [1, 2, 3] }, { l: [3, 2, 1] });
  assert.deepEqual(sira.listeler, [{ yol: 'l', eklenen: [], cikan: [], siraDegisti: true }]);
  const bos = farkHesapla({ l: [] }, { l: [null, 'a'] });
  assert.deepEqual(bos.listeler[0].eklenen, [null, 'a']);
});

test('KF3 nesne ogeli liste alan alan; tur degisimi butun alan degisen', () => {
  const f = farkHesapla(
    { l: [{ a: 1 }], t: ['A'], s: 'x', n: null },
    { l: [{ a: 2 }], t: 'A', s: 1, n: {} },
  );
  assert.deepEqual(
    f.degisen.map((d) => d.yol),
    ['l[0].a', 't', 's', 'n'],
  );
  assert.deepEqual(f.degisen[0], { yol: 'l[0].a', eski: 1, yeni: 2 });
  // Uzun deger icindeki tek alan da okunur: 120 karakter kesmesi farki gizlemez.
  const uzun = 'x'.repeat(200);
  const u = farkHesapla(
    { u: [{ s: 'ORNGXD50', a: uzun, b: 'eski' }, { s: 'ORNGXD51' }] },
    { u: [{ s: 'ORNGXD50', a: uzun, b: 'yeni' }, { s: 'ORNGXD51' }, { s: 'ORNGXD52' }] },
  );
  assert.deepEqual(u.degisen, [{ yol: 'u[0].b', eski: 'eski', yeni: 'yeni' }]);
  assert.deepEqual(u.eklenen, [{ yol: 'u[2]', deger: { s: 'ORNGXD52' } }]);
  const c = farkHesapla({ u: [{ s: 1 }, { s: 2 }] }, { u: [{ s: 1 }] });
  assert.deepEqual(c.silinen, [{ yol: 'u[1]', deger: { s: 2 } }]);
  const kok = farkHesapla([1], { a: 1 });
  assert.deepEqual(kok.degisen, [{ yol: '', eski: [1], yeni: { a: 1 } }]);
});

test('KF4 okunur yol: koseli anahtar', () => {
  const f = farkHesapla(
    { s: { 'ORNGXD02.x': 1, 'a b': 2, ok_1: 3, 'a-b': 4 } },
    { s: { 'ORNGXD02.x': 9, 'a b': 8, ok_1: 7, 'a-b': 6 } },
  );
  assert.deepEqual(
    f.degisen.map((d) => d.yol),
    ['s["ORNGXD02.x"]', 's["a b"]', 's.ok_1', 's.a-b'],
  );
});

test('KF5 farkYollari degerleri tasimaz, sirali', () => {
  const f = farkHesapla({ z: 1, a: [1], m: 1 }, { z: 2, a: [2], k: 'GIZLI' });
  const y = farkYollari(f);
  assert.deepEqual(y, { eklenen: ['k'], silinen: ['m'], degisen: ['a', 'z'] });
  assert.ok(!JSON.stringify(y).includes('GIZLI'));
  assert.equal(farkBosMu(f), false);
});

test('KF6 sunucu adi ihlalleri', () => {
  assert.match('ORNGXD50', SUNUCU);
  assert.doesNotMatch('9ABC', SUNUCU);
  assert.doesNotMatch('A'.repeat(64), SUNUCU);
  const veri = {
    nginx: {
      intranetSunuculari: ['ORNGXD50', ' ORNGXT50 ', 'kotu ad', 5],
      internetRpNonprod: { DEV: ['ORNGXD01'], TEST: 'ORNGXT33' },
      apiKumeleri: ['liste'],
      gocGruplari: { a: { eski: ['OK1'], yeni: ['-X'] }, b: 'bozuk' },
      yukTesti: { derlemeSunucusu: 'ORLABT02' },
      exposeHedefi: null,
    },
    opsx: {},
  };
  assert.deepEqual(
    sunucuIhlalleri(veri).map(({ yol, neden }) => `${yol} ${neden}`),
    [
      'nginx.intranetSunuculari[2] gecersiz-ad',
      'nginx.intranetSunuculari[3] gecersiz-ad',
      'nginx.internetRpNonprod.TEST liste-degil',
      'nginx.gocGruplari.a.yeni[0] gecersiz-ad',
      'nginx.apiKumeleri nesne-degil',
      'nginx.exposeHedefi gecersiz-ad',
    ],
  );
  assert.deepEqual(sunucuIhlalleri({}), []);
  assert.deepEqual(sunucuIhlalleri(null), []);
  // Yeni ihlal: yalniz eski dosyada olmayan; dizin kaymasi yeni sayilmaz.
  const eski = { nginx: { intranetSunuculari: ['kotu'] } };
  assert.deepEqual(
    yeniSunucuIhlalleri(eski, { nginx: { intranetSunuculari: ['A1', 'kotu'] } }),
    [],
  );
  assert.deepEqual(
    yeniSunucuIhlalleri(eski, { nginx: { intranetSunuculari: ['kotu', 'x y'] } }).map((x) => x.yol),
    ['nginx.intranetSunuculari[1]'],
  );
});

test('KF7 yeni ihlal tekrar sayar; anahtarlar turu', () => {
  const eski = { nginx: { intranetSunuculari: ['1A'] } };
  assert.deepEqual(
    yeniSunucuIhlalleri(eski, { nginx: { intranetSunuculari: ['1A', '1A', ' 2b'] } }).map(
      (x) => x.yol,
    ),
    ['nginx.intranetSunuculari[1]', 'nginx.intranetSunuculari[2]'],
  );
  const rvp = {
    nginx: { rvp: { sunucular: { ORNGXD02: {}, '9X': {} }, kutular: { a: ['ok', '-'] } } },
  };
  assert.deepEqual(
    sunucuIhlalleri(rvp).map(({ yol, neden }) => `${yol} ${neden}`),
    ['nginx.rvp.sunucular["9X"] gecersiz-ad', 'nginx.rvp.kutular.a[1] gecersiz-ad'],
  );
  assert.deepEqual(
    sunucuIhlalleri({ nginx: { rvp: { sunucular: ['ORNGXD02'] } } }).map((x) => x.neden),
    ['nesne-degil'],
  );
});

test('KF8 onayliSilmeler', () => {
  const eski = {
    nginx: { intranetSunuculari: ['ORNGXD50'], exposeHedefi: 'ORNGXT07', not: 'x' },
    ocp: { a: 1 },
    bos: {},
    sayi: 3,
  };
  assert.deepEqual(onayliSilmeler(eski, eski), { bolumler: [], sunucuAlanlari: [] });
  for (const nginx of [{}, null, [], 'x', undefined]) {
    const yeni = { ...eski, nginx };
    if (nginx === undefined) delete yeni.nginx;
    assert.deepEqual(onayliSilmeler(eski, yeni).bolumler, ['nginx'], String(nginx));
  }
  // Bos bolumu doldurmak / ilkel degistirmek onay istemez; ilkel silmek ister.
  assert.deepEqual(onayliSilmeler(eski, { ...eski, bos: { a: 1 }, sayi: 4 }).bolumler, []);
  const { sayi, ...sayisiz } = eski;
  assert.equal(sayi, 3);
  assert.deepEqual(onayliSilmeler(eski, sayisiz).bolumler, ['sayi']);
  const alanSiz = structuredClone(eski);
  delete alanSiz.nginx.exposeHedefi;
  delete alanSiz.nginx.not;
  assert.deepEqual(onayliSilmeler(eski, alanSiz), {
    bolumler: [],
    sunucuAlanlari: ['nginx.exposeHedefi'],
  });
  // Bos sunucu listesini silmek onay istemez.
  assert.deepEqual(
    onayliSilmeler({ nginx: { intranetSunuculari: [], a: 1 } }, { nginx: { a: 1 } }).sunucuAlanlari,
    [],
  );
});

test('KF9 derinlikAsildi yinelemeli', () => {
  let d = 1;
  for (let i = 0; i < MAKS_DERINLIK; i++) d = { a: d };
  assert.equal(derinlikAsildi(d), false);
  assert.equal(derinlikAsildi({ a: d }), true);
  assert.equal(derinlikAsildi([[[1]]], 2), true);
  let cok = 1;
  for (let i = 0; i < 100000; i++) cok = [cok];
  assert.equal(derinlikAsildi(cok), true);
  assert.equal(derinlikAsildi('metin'), false);
});
