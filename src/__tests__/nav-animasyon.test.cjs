// src/__tests__/nav-animasyon.test.cjs — sol menu acilip kapanirken hafif animasyon (2026-10-15).
//
// Kullanici: "sol menunun kapanmasi icin cok hafif bir animasyon yapar misin?" Eskiden menu
// `navOpen && (...)` ile DOM'dan kaldiriliyordu; kapanirken animasyon olamazdi.
//   NA1 menu her zaman yerinde (kosullu kaldirma yok); kapaliyken inert (odak / ekran okuyucu girmez)
//   NA2 gecis "cok hafif": 300 ms'den kisa; masaustu genislik + saydamlik, mobil yandan kayma
//   NA3 hareket azaltma tercihi genel kuralla gecisi kapatir (index.css)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const oku = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const L = oku('layouts/AppLayout.tsx');

test('NA1 menu hep yerinde, kapaliyken inert', () => {
  assert.doesNotMatch(L, /\{navOpen && \(/, 'menu kosullu kaldiriliyor: kapanis animasyonu olamaz');
  assert.match(L, /inert=\{!navOpen\}/, 'kapali menu klavye odagina aciK kalir');
  assert.match(L, /<PageNav onNavigate=/);
});

test('NA2 gecis hafif ve kisa; masaustu genislik+saydamlik, mobil kayma', () => {
  const sureler = [...L.matchAll(/(\d+)ms/g)].map((m) => Number(m[1]));
  assert.ok(sureler.length >= 3, 'gecis sureleri bulunamadi');
  assert.ok(sureler.every((s) => s > 0 && s < 300), `gecis cok hafif olmali (<300 ms): ${sureler}`);
  assert.match(L, /width: navOpen \? "var\(--nav-w\)" : 0/);
  assert.match(L, /opacity: navOpen \? 1 : 0/);
  assert.match(L, /transform: navOpen \? "translateX\(0\)" : "translateX\(-100%\)"/);
  assert.match(L, /pointerEvents: navOpen \? "auto" : "none"/, 'kapali karartma tiklamalari yutar');
});

test('NA3 hareket azaltma tercihi gecisi kapatir', () => {
  const css = oku('index.css');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{[\s\S]*?transition-duration: 0\.001ms !important;/);
});

// NA4 (2026-11-08): ortak Modal aniden beliriyordu. Ortu solar, panel hafif buyur; ikisi de kisa
// ve hareket azaltma tercihinde genel kural (animation-duration) sureyi sifirlar.
test('NA4 modal acilis hareketi hafif ve hareket azaltmaya bagli', () => {
  const M = oku('components/common/Modal.tsx');
  assert.match(M, /className="fixed inset-0 z-\[1000\][^"]*\banimate-fade-in\b/, 'ortu animasyonsuz');
  assert.match(M, /\$\{SIZE_MAP\[size\]\}[^`]*\banimate-scale-in\b/, 'panel animasyonsuz');
  const A = oku('styles/animations.css');
  for (const ad of ['fade-in', 'scale-in']) {
    const m = new RegExp(`\\.animate-${ad}\\s*\\{ animation: \\w+ (\\d*\\.?\\d+)s`).exec(A);
    assert.ok(m, `.animate-${ad} tanimsiz`);
    assert.ok(Number(m[1]) < 0.3, `.animate-${ad} cok uzun: ${m[1]}s`);
  }
  assert.match(oku('index.css'), /prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{\s*animation-duration: 0\.001ms !important;/);
});
