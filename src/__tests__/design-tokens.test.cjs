// src/__tests__/design-tokens.test.cjs — G1/G2: temaya bagli olmayan renk kalintilari.
//
// Token sistemi (PatternFly v5 turevi) iyi kurulmus ve bir Tailwind uyum katmani
// cogunu yakaliyor. Sorun katmanin KACIRDIKLARIYDI: koyu temada zeminle ayni tonda
// kalan kenarliklar (border-*-100), okunamayan koyu metinler (text-*-800) ve
// zeminden ayirt edilemeyen koyu bloklar (bg-gray-800/900).
//
// Ayrica 40+ yerde `--accent` yerine SABIT `#0066CC` yaziliydi. Koyu temada
// `--accent` #2b9af3'tur; o noktalar temayla birlikte degismiyor, acik-tema
// aksaninda takili kaliyordu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const INDEX_CSS = fs.readFileSync(path.join(ROOT, 'src', 'index.css'), 'utf8');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}
const TSX = walk(path.join(ROOT, 'src'));

test('G2: Tailwind sinifi icinde SABIT accent hex kalmadi', () => {
  const offenders = [];
  for (const f of TSX) {
    const src = fs.readFileSync(f, 'utf8');
    // `text-[#0066CC]`, `bg-[#0066cc]`, `focus:ring-[#0066CC]` ...
    for (const m of src.matchAll(/[\w:-]+-\[#0066[cC]{2}\]/g)) {
      offenders.push(`${path.relative(ROOT, f)}: ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `koyu temada acik-tema aksaninda takili kalir:\n${offenders.join('\n')}`);
});

test('G1: koyu temada bozulan siniflar uyum katmaninda esleniyor', () => {
  // Gercek kullanim sayilariyla birlikte en cok acan siniflar.
  const required = [
    '.border-red-100', '.border-amber-100', '.border-green-100', '.border-blue-100',
    '.text-amber-800', '.text-red-800', '.text-blue-800', '.text-indigo-700',
    '.bg-gray-800', '.bg-gray-900', '.bg-black', '.text-black',
    '.divide-gray-200', '.ring-gray-200', '.placeholder-gray-400',
  ];
  const missing = required.filter((c) => !INDEX_CSS.includes(c));
  assert.deepEqual(missing, [], `uyum katmaninda eksik: ${missing.join(', ')}`);
});

test('G1: text-white BILEREK eslenmemis (esleseydi butun butonlari bozardi)', () => {
  // Kullanimlarin tamami renkli/koyu zemin uzerinde. Token'a baglamak acik temada
  // beyaz-uzerine-beyaz uretirdi. Karar yorumda gerekcesiyle duruyor.
  assert.ok(
    !/:root \.text-white\s*\{/.test(INDEX_CSS),
    'text-white eslenmis — btn-primary/masthead metinleri bozulur'
  );
  assert.match(INDEX_CSS, /`text-white` BILEREK ESLENMEDI/);
});

test('G3: nefes token’lari tanimli, kose yaricapi Red Hat’te KALIYOR', () => {
  assert.match(INDEX_CSS, /--breath-line:\s*1\.55;/);
  // PF imzasi: 3px kose. "OpenAI nefesi" yalnizca ritim; yaricap DEGISMEMELI.
  assert.match(INDEX_CSS, /--radius-sm:\s*3px/);
});

test('G3: veri yogun yuzeylerde (tablo) nefes uygulanmaz', () => {
  assert.match(INDEX_CSS, /:root table, :root th, :root td \{ line-height: 1\.45; \}/,
    'tablo satirlari da acilirsa yogun ekranlarda satir sayisi duser');
});
