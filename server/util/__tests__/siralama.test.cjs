// server/util/__tests__/siralama.test.cjs — varsayilanSira, Array.prototype.sort'un varsayilan
// sirasiyla BIREBIR ayni (S2871 duzeltmesi sirayi degistirmesin).
//   SR1 karisik degerler (sayi, metin, Turkce harf, null, bool, undefined) rastgele dizilerde ayni sira
//   SR2 sayilar varsayilan sirada kalir (10, 9): sayisal siraya bilerek gecilmez
//   SR3 MANDAL: sunucuda karsilastiricisiz `.sort()` sayisi artmaz (kalanlar tipli dizi ya da metin
//       dizisi: tipli dizide varsayilan sira SAYISALDIR, SonarQube bunlari isaretlemez)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { varsayilanSira } = require('../siralama.cjs');

// Belirlenimci sozde rastgele (her kosuda ayni diziler).
function rastgele(tohum) {
  let s = tohum >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const HAVUZ = [
  'b',
  'B',
  'a',
  'ab',
  'a-b',
  'a_b',
  '_x',
  'Zeta',
  'ç',
  'ı',
  'İ',
  'ş',
  '',
  ' ',
  '10',
  '9',
  10,
  9,
  0,
  -1,
  1.5,
  NaN,
  null,
  true,
  false,
  undefined,
  'null',
  'undefined',
];

test('SR1 rastgele karisik dizilerde varsayilan siranin aynisi', () => {
  const r = rastgele(20261115);
  for (let n = 0; n < 2000; n++) {
    const uzunluk = Math.floor(r() * 12);
    const dizi = Array.from({ length: uzunluk }, () => HAVUZ[Math.floor(r() * HAVUZ.length)]);
    assert.deepEqual([...dizi].sort(varsayilanSira), [...dizi].sort(), JSON.stringify(dizi));
  }
});

test('SR2 sayilar varsayilan (metin) sirasinda kalir', () => {
  assert.deepEqual([10, 9, 1, 100].sort(varsayilanSira), [1, 10, 100, 9]);
  assert.equal(varsayilanSira('a', 'a'), 0);
  assert.equal(varsayilanSira('A', 'a'), -1);
  assert.equal(varsayilanSira('ç', 'z'), 1, 'kod birimi sirasi, yerel ayar degil');
});

// Metin taramasi dizinin turunu bilemez: `Float64Array#sort()` sayisal, `string[]#sort()` dogru sirada
// ve SonarQube ikisini de isaretlemez. Bu yuzden kesin yasak degil MANDAL: sayi yalniz azalabilir.
// Yeni bir karsilastiricisiz `.sort()` eklenirse: dizi sayi / karisik ise `varsayilanSira` ya da
// `(a, b) => a - b`; tipli dizi ya da metin dizisiyse TAVAN bilerek artirilir.
const TAVAN = 20;
test('SR3 karsilastiricisiz .sort() sayisi tavani asmaz', () => {
  const KOK = path.join(__dirname, '..', '..', '..');
  const bulunan = [];
  const gez = (dizin) => {
    for (const g of fs.readdirSync(dizin, { withFileTypes: true })) {
      if (g.name === 'node_modules' || g.name === '__tests__' || g.name === 'bmw_portal') continue;
      const yol = path.join(dizin, g.name);
      if (g.isDirectory()) gez(yol);
      else if (/\.(c|m)?js$/.test(g.name)) {
        fs.readFileSync(yol, 'utf8')
          .split('\n')
          .forEach((satir, i) => {
            if (/^\s*(\/\/|\*)/.test(satir)) return;
            for (const _ of satir.matchAll(/\.sort\(\s*\)/g))
              bulunan.push(`${path.relative(KOK, yol)}:${i + 1}`);
          });
      }
    }
  };
  gez(path.join(KOK, 'server'));
  gez(path.join(KOK, 'shared'));
  assert.ok(
    bulunan.length <= TAVAN,
    `karsilastiricisiz .sort() ${bulunan.length} > ${TAVAN}:\n${bulunan.join('\n')}`,
  );
  assert.ok(bulunan.length >= TAVAN - 5, `tavan bayat (${bulunan.length}); TAVAN'i dusurun`);
});
