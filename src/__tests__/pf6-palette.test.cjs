// src/__tests__/pf6-palette.test.cjs — PF6 palet butunlugu ve NOTRLUK bekcisi.
//
// NEDEN VAR: portalin gorunum katmani PatternFly **v5** token'larindan turetilmisti.
// PF5 grileri mavi-yesil CALIYOR (#4f5255, #3c3f42, #b8bbbe, #d2d2d2 — R/G/B esit
// DEGIL); guncel OpenShift Console'un kullandigi PF6 grileri ise TAM NOTR antrasittir
// (R=G=B). Kullanicinin istedigi "guncel gri antrasit tonlari" tam olarak bu fark.
//
// Degerler uydurulmadi: @patternfly/patternfly@6.6.1 paketinin
// base/tokens/tokens-palette.scss dosyasindan alindi. Bu test iki seyi kilitler:
//   1) her gri token PF6 RAMPASINDAN bir deger olmali (keyfi ara ton eklenmesin),
//   2) her gri token NOTR olmali (R=G=B) — PF5 sapmasi sessizce geri gelmesin.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'index.css'), 'utf8');

// PF6 gri rampasi — tokens-palette.scss (gray-10 ... gray-95) + siyah/beyaz.
const PF6_GRAYS = new Set([
  '#ffffff', '#f2f2f2', '#e0e0e0', '#c7c7c7', '#a3a3a3', '#8c8c8c',
  '#707070', '#4d4d4d', '#383838', '#292929', '#1f1f1f', '#151515', '#000000',
]);

// Gri olmasi BEKLENEN token'lar: yuzeyler, kenarliklar, metin, masthead/nav.
const GRAY_TOKENS = [
  '--bg-base', '--bg-surface', '--bg-elevated', '--bg-inset',
  '--border', '--border-subtle', '--border-strong',
  '--text-primary', '--text-secondary', '--text-muted', '--text-on-dark',
  '--masthead-bg', '--masthead-border',
  '--nav-bg', '--nav-hover-bg', '--nav-current-bg', '--nav-text', '--nav-text-muted',
];

// `:root { ... }` ve `:root[data-theme="dark"] { ... }` bloklarini ayikla.
function themeBlock(selector) {
  const i = CSS.indexOf(selector);
  assert.ok(i >= 0, `blok bulunamadi: ${selector}`);
  const start = CSS.indexOf('{', i);
  const end = CSS.indexOf('\n}', start);
  return CSS.slice(start, end);
}

function tokenValue(block, name) {
  const m = block.match(new RegExp(`${name}:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}

const LIGHT = themeBlock(':root {');
const DARK = themeBlock(':root[data-theme="dark"] {');

function isNeutral(hex) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return false;
  return h.slice(0, 2) === h.slice(2, 4) && h.slice(2, 4) === h.slice(4, 6);
}

test('acik tema: gri token’larin TAMAMI PF6 rampasindan', () => {
  const bad = [];
  for (const t of GRAY_TOKENS) {
    const v = tokenValue(LIGHT, t);
    assert.ok(v, `${t} acik temada tanimli degil`);
    if (!PF6_GRAYS.has(v.toLowerCase())) bad.push(`${t}: ${v}`);
  }
  assert.deepEqual(bad, [], `PF6 rampasi disinda gri:\n${bad.join('\n')}`);
});

test('koyu tema: gri token’larin TAMAMI PF6 rampasindan', () => {
  const bad = [];
  for (const t of GRAY_TOKENS) {
    // Koyu blok yalnizca DEGISENLERI yeniden tanimlar; tanimsizsa acik degeri gecerli.
    const v = tokenValue(DARK, t);
    if (v === null) continue;
    if (!PF6_GRAYS.has(v.toLowerCase())) bad.push(`${t}: ${v}`);
  }
  assert.deepEqual(bad, [], `PF6 rampasi disinda gri (koyu):\n${bad.join('\n')}`);
});

test('NOTRLUK: hicbir gri token’da R/G/B sapmasi yok (PF5 geri gelmesin)', () => {
  const bad = [];
  for (const [name, block] of [['acik', LIGHT], ['koyu', DARK]]) {
    for (const t of GRAY_TOKENS) {
      const v = tokenValue(block, t);
      if (!v || !v.startsWith('#')) continue;
      if (!isNeutral(v)) bad.push(`${name}/${t}: ${v}`);
    }
  }
  assert.deepEqual(bad, [], `notr OLMAYAN gri (PF5 mavi-yesil sapmasi):\n${bad.join('\n')}`);
});

test('PF5’in bilinen gri degerleri kaynakta KALMADI', () => {
  // Bu degerler PF5'e ozgudur; bir yerde kalmislarsa gecis eksik demektir.
  const PF5 = ['#4f5255', '#3c3f42', '#b8bbbe', '#d2d2d2', '#8a8d90', '#6a6e73', '#212427', '#1b1d21', '#0f1214'];
  // Yorum satirlari HARIC — aciklamalar farki ANLATMAK icin bu degerlerden bahsediyor.
  const code = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = PF5.filter((h) => code.toLowerCase().includes(h));
  assert.deepEqual(found, [], `PF5 gri degerleri hala kullanimda: ${found.join(', ')}`);
});

test('masthead ve sol menu TEMAYI IZLIYOR (PF6 davranisi)', () => {
  // PF6 masthead.css: BackgroundColor = background--color--secondary--default
  // -> acik gray-10, koyu gray-95. Sidebar (page.css) ayni degeri kullanir.
  assert.equal(tokenValue(LIGHT, '--masthead-bg'), '#f2f2f2');
  assert.equal(tokenValue(DARK, '--masthead-bg'), '#151515');
  assert.equal(tokenValue(LIGHT, '--nav-bg'), '#f2f2f2');
  assert.equal(tokenValue(DARK, '--nav-bg'), '#151515');
  // Acik temada menu metni KOYU olmali; eski #e0e0e0 beyazimsi zeminde okunmazdi.
  assert.equal(tokenValue(LIGHT, '--nav-text'), '#151515');
  assert.equal(tokenValue(DARK, '--nav-text'), '#ffffff');
});

test('masthead/nav CSS ve bilesenlerinde SABIT renk kalmadi', () => {
  const block = CSS.slice(CSS.indexOf('.pf-masthead {'), CSS.indexOf('/* ── Tabs'));
  const code = block.replace(/\/\*[\s\S]*?\*\//g, '');
  const hex = code.match(/#[0-9a-fA-F]{3,6}/g) || [];
  assert.deepEqual(hex, [], `masthead/nav CSS'inde sabit renk: ${hex.join(', ')}`);

  for (const f of ['components/layout/Masthead.tsx', 'components/layout/PageNav.tsx']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    const found = src.match(/#[0-9a-fA-F]{6}\b|text-white|bg-\[#[0-9a-fA-F]+\]/g) || [];
    assert.deepEqual(found, [], `${f}: sabit renk kaldi -> ${found.join(', ')}`);
  }
});

test('kart HER IKI temada da cerceveli (PF6 card.css: border--color--subtle)', () => {
  // Acik temada `transparent`ti; kart yalnizca golgeyle ayrisiyordu. Ayrica palet
  // gecisinde `--bg-elevated` sayfa zeminiyle ayni tona geldigi icin dolgu farkina
  // guvenen yuzeyler ayrisamazdi — cizgi bu belirsizligi kokten kaldirir.
  // Blok SINIRLARI icinde bak: lazy regex kural sinirini asip baska bir kuraldaki
  // `border: 1px solid transparent;` ile eslesebiliyor (ilk denemede tam bu oldu).
  const i = CSS.indexOf('.card {');
  assert.ok(i > 0, '.card kurali bulunamadi');
  const cardRule = CSS.slice(i, CSS.indexOf('}', i));
  assert.ok(!/border:\s*1px solid transparent;/.test(cardRule), 'kart acik temada hala cerceveSIZ');
  assert.match(cardRule, /border: 1px solid var\(--border-subtle\);/);
});

test('kose yaricapi PF6 olceginde (tiny 4px / small 6px)', () => {
  assert.equal(tokenValue(LIGHT, '--radius-sm'), '4px');
  assert.equal(tokenValue(LIGHT, '--radius-md'), '6px');
  assert.equal(tokenValue(LIGHT, '--radius-lg'), '6px');
});

test('AKSAN USTU METIN: token var, buton onu okuyor, koyu temada kontrast yeterli', () => {
  assert.ok(tokenValue(LIGHT, '--text-on-accent'), '--text-on-accent acik temada yok');
  assert.ok(tokenValue(DARK, '--text-on-accent'), '--text-on-accent koyu temada yok');
  assert.match(CSS, /\.btn-primary \{[\s\S]*?color: var\(--text-on-accent\);/,
    'btn-primary hala sabit renk kullaniyor');

  // Kontrast (WCAG 2.x nispi parlaklik). Eski koyu tema cifti (#2b9af3 + beyaz)
  // ~2.9:1 idi ve AA'yi GECMIYORDU; yeni cift bunu asmali.
  const srgb = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const lum = (hex) => {
    const h = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => srgb(parseInt(h.slice(i, i + 2), 16) / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  for (const [name, block] of [['acik', LIGHT], ['koyu', DARK]]) {
    const bg = tokenValue(block, '--accent');
    const fg = tokenValue(block, '--text-on-accent');
    const r = ratio(bg, fg);
    assert.ok(r >= 4.5, `${name} tema: aksan ustu metin kontrasti ${r.toFixed(2)}:1 — AA (4.5) altinda`);
  }
});
