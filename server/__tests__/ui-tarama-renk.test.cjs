// server/__tests__/ui-tarama-renk.test.cjs - UI tarama denetleyicisinin kontrast olcumu (2026-11-06).
//
// Bekci korlugu: scripts/ui-tarama/lib.mjs DENETIM'deki lum() her rengi 0-255 sayiyordu. Chrome
// color-mix() sonucunu color(srgb 0-1) olarak verir: metin siyah okunuyor, acik temada her zaman
// "gecer", koyu temada yanlis alarm veriyordu (Server Hub "dogrulandi" rozeti, gercek Chrome olcumu).
//   UT1 rgb / rgba / color(srgb ...) dogru okunur; alfa iki bicimde de; baska renk uzayi null
//   UT2 olculen kontrast: color-mix metni koyu zeminde yuksek, acik sari uzerinde --status-warning dusuk
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

async function lumAl() {
  const m = await import(path.join(__dirname, '..', '..', 'scripts', 'ui-tarama', 'lib.mjs'));
  // DENETIM sayfa icinde calisan tek ifade; derlenebilmeli.
  assert.equal(typeof new Function(`return () => ${m.DENETIM}`), 'function');
  const satir = m.DENETIM.split('\n').find((x) => x.trim().startsWith('const lum ='));
  assert.ok(satir, 'DENETIM icinde lum yok');
  return new Function(`${satir.trim()}; return lum;`)();
}
const oran = (lum, a, b) => {
  const [x, y] = [lum(a).l, lum(b).l];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

test('UT1 renk bicimleri: rgb, rgba, color(srgb); alfa; bilinmeyen uzay null', async () => {
  const lum = await lumAl();
  assert.equal(lum('rgb(0, 0, 0)').l, 0);
  assert.equal(lum('rgb(255, 255, 255)').l, 1);
  assert.equal(lum('color(srgb 1 1 1)').l, 1, 'color(srgb) 0-1 araligindadir');
  assert.ok(Math.abs(lum('color(srgb 0.5 0.5 0.5)').l - lum('rgb(127.5, 127.5, 127.5)').l) < 1e-9);
  assert.equal(lum('rgba(255, 204, 23, 0.16)').a, 0.16);
  assert.equal(lum('color(srgb 0.5 0.6 0.7 / 0.18)').a, 0.18);
  assert.equal(lum('rgb(1, 2, 3)').a, 1);
  assert.equal(lum('oklch(0.7 0.1 140)'), null);
  assert.equal(lum('lab(50 20 30)'), null);
});

test('UT2 olculen kontrast: color-mix metni ve --status-warning metni', async () => {
  const lum = await lumAl();
  // Koyu tema "dogrulandi": acik yesil metin, koyu zemin -> yuksek (eskiden 1.14 yanlis alarm).
  assert.ok(oran(lum, 'color(srgb 0.741176 0.853333 0.661373)', 'rgb(27, 29, 33)') > 7);
  // Acik tema "dogrulandi": koyu yesil metin, acik yesil zemin -> yeterli.
  assert.ok(oran(lum, 'color(srgb 0.168627 0.285098 0.0866667)', 'rgb(233, 247, 223)') > 4.5);
  // Acik tema --status-warning metni kendi zemininde: GERCEK sorun (2:1), yakalanmali.
  assert.ok(oran(lum, 'rgb(220, 166, 20)', 'rgb(255, 244, 204)') < 3);
  // --status-warning-text ayni zeminde gecer.
  assert.ok(oran(lum, 'rgb(121, 86, 0)', 'rgb(255, 244, 204)') > 4.5);
});
