// src/__tests__/links-page-restore.test.cjs — "Faydali Linkler" sayfasi: 2026-09-19'dan beri GIZLI (menu/route/seed kapali).
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

// 2026-09-19: sayfa YENIDEN KALDIRILDI (kullanici: "Yardimci Araclar su an hicbir ise
// yaramiyor"). Bekciler tersine cevrildi: uc yer birden KAPALI olmali, aksi halde sayfa
// yarim gorunur (menude var ama route yok -> 404; ya da DB seed geri getirir).
test('LR1 menu ogesi ve grubu KAYITLI DEGIL', () => {
  const el = codeOnly(read('src/config/elements.ts')).replace(/"/g, "'");
  assert.doesNotMatch(el, /id: 'Linkler'/, 'ELEMENTS icinde "Linkler" hala var');
  assert.doesNotMatch(el, /itemIds: \['Linkler'\]/, 'NAV_GROUPS icinde "kaynaklar" grubu hala var');
});

test('LR2 route BAGLI DEGIL', () => {
  const app = codeOnly(read('src/App.tsx'));
  assert.doesNotMatch(app, /path="\/links"/, "/links route'u hala bagli");
});

test('LR3 sayfayi her aciliste silen temizlik CAGRILIYOR (DB nav grubu da menuden dussun)', () => {
  const setup = codeOnly(read('server/db/mssql-setup.cjs'));
  assert.match(setup, /^\s*await removeKaynaklarNavGroup\(pool\);/m, 'removeKaynaklarNavGroup cagrilmiyor — DB-driven menude grup kalir');
});

test("LR4 DB seed'i sayfayi YENIDEN OLUSTURMUYOR", () => {
  const setup = codeOnly(read('server/db/mssql-setup.cjs'));
  assert.doesNotMatch(setup, /element_key: 'Linkler'/, 'ELEMENT_SEED icinde "Linkler" hala var');
  assert.doesNotMatch(setup, /element_key: 'navgroup:kaynaklar'/, 'nav grubu hala seed ediliyor');
  assert.doesNotMatch(setup, /page_name: 'Linkler'/, 'PAGE_VISIBILITY_SEED icinde "Linkler" hala var');
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
