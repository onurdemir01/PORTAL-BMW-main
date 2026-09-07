// src/__tests__/links-page-restore.test.cjs — "Faydali Linkler" sayfasinin GORUNUR kalmasi.
//
// Sayfa 2026-08-26'da menuden kaldirilmis, 2026-09-07'de geri acildi. Geri acmak UC
// YERI birden gerektirdi ve biri unutulsa sayfa SESSIZCE gorunmez kalirdi:
//
//   1) src/config/elements.ts   — ELEMENTS ogesi + NAV_GROUPS grubu
//   2) src/App.tsx              — /links route'u
//   3) server/db/mssql-setup.cjs— removeKaynaklarNavGroup() cagrisi KALDIRILMALI
//
// (3) en sinsisi: fonksiyon HER ACILISTA `Linkler` kaydini siliyordu. Kaldirilmasaydi
// sayfa her restart'ta menuden duser, kod dogru gorunur ve sebep hicbir yerde yazmazdi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const codeOnly = (s) =>
  s
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

test('LR1 menu ogesi ve grubu KAYITLI', () => {
  const el = codeOnly(read('src/config/elements.ts'));
  assert.match(el, /id: "Linkler"/, 'ELEMENTS icinde "Linkler" ogesi yok');
  assert.match(el, /itemIds: \["Linkler"\]/, 'NAV_GROUPS icinde "Linkler" grubu yok');
});

test('LR2 route BAGLI', () => {
  const app = codeOnly(read('src/App.tsx'));
  assert.match(app, /path="\/links"/, "/links route'u yok — menu ogesi 404'e gider");
  assert.match(app, /ImportantLinksPage/, 'sayfa bileseni import edilmemis');
});

test('LR3 sayfayi HER ACILISTA silen temizlik CAGRILMIYOR', () => {
  const setup = codeOnly(read('server/db/mssql-setup.cjs'));
  // Fonksiyon TANIMLI kalabilir (ileride yeniden kaldirmak icin); CAGRILMAMALI.
  assert.doesNotMatch(
    setup,
    /^\s*await removeKaynaklarNavGroup\(pool\);/m,
    "removeKaynaklarNavGroup HALA cagriliyor — sayfa her restart'ta menuden duser",
  );
});

test("LR4 DB seed'i sayfayi TANIYOR (kayitsiz anahtar yonetilemez)", () => {
  // Kayitsiz bir anahtar "varsayilan gorunur" olur ve Sayfa Erisimi ekranindan
  // YONETILEMEZ — bu repoda daha once yasanan bir tuzak.
  const setup = codeOnly(read('server/db/mssql-setup.cjs'));
  assert.match(setup, /element_key: 'Linkler'/, 'ELEMENT_SEED icinde "Linkler" yok');
  assert.match(setup, /element_key: 'navgroup:kaynaklar'/, 'nav grubu seed edilmemis');
  assert.match(setup, /page_name: 'Linkler'/, 'PAGE_VISIBILITY_SEED icinde "Linkler" yok');
});

test('LR5 yeni alanlar MEVCUT kurulumlara da gidiyor (ALTER var)', () => {
  // Kolonu yalnizca CREATE TABLE'a eklemek YETMEZ: tablo zaten varsa o blok hic
  // calismaz ve alan sessizce eksik kalir — API her yazimda "invalid column" alirdi.
  const setup = codeOnly(read('server/db/mssql-setup.cjs'));
  for (const col of ['purpose', 'how_to_use']) {
    assert.match(
      setup,
      new RegExp(`ALTER TABLE portal_links ADD ${col}`),
      `${col} icin ALTER yok — mevcut kurulumlarda kolon olusmaz`,
    );
  }
});
