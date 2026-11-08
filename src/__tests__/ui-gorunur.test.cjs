// src/__tests__/ui-gorunur.test.cjs — gorunur kucuk modernlesme (2026-11-08): PF6 menu ogesi ve
// masthead arama kutusu. Kullanici: "buyuk degisiklik olmasin, insanlar alisti" -> yerlesim ve
// metin konumu DEGISMEZ; yalniz zeminin bicimi.
//   GD1 menu ogesi / bolum basligi / tek ogeli grup metni eski x konumunda (36 / 20 / 20 px)
//   GD2 etkin oge aksan cizgisi ogenin icinde; Hub ogesine binmez
//   GD3 masthead arama: genis ekranda kutu + kisayol, dar ekranda ikon; gizleme sarmalayicida
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const oku = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const CSS = oku('index.css').replace(/\/\*[\s\S]*?\*\//g, '');
const kural = (secici) => {
  const i = CSS.indexOf(`${secici} {`);
  assert.ok(i >= 0, `${secici} kurali yok`);
  return CSS.slice(i, CSS.indexOf('}', i));
};
const rem = (v) =>
  v.endsWith('rem') ? parseFloat(v) * 16 : v.endsWith('px') ? parseFloat(v) : NaN;
/** `margin: 0 0.5rem` / `padding: a b c d` -> sol deger (px). */
function sol(blok, ozellik) {
  const m = new RegExp(`\\n\\s*${ozellik}:\\s*([^;]+);`).exec(blok);
  if (!m) return 0;
  const p = m[1].trim().split(/\s+/);
  return rem(p.length === 1 ? p[0] : p.length <= 3 ? p[1] : p[3]);
}

test('GD1 menu metni eski x konumunda', () => {
  const link = kural('.pf-nav-link');
  assert.equal(
    sol(link, 'margin') + sol(link, 'padding'),
    36,
    'alt oge metni 36 px (4 + 32) degil',
  );
  assert.doesNotMatch(link, /border-left/, 'kenar seridi geri gelmis');
  assert.match(link, /border-radius: var\(--radius-md\)/);
  const bas = kural('.pf-nav-toggle');
  assert.equal(
    sol(bas, 'margin') + sol(bas, 'padding'),
    20,
    'bolum basligi metni 20 px (4 + 16) degil',
  );
  assert.match(bas, /width: calc\(100% - 1rem\)/, 'baslik kenar bosluguyla tasar');
  // Tek ogeli grup (Genel, Performance...) satir ici dolguyla: 8 + 12 = 20 px.
  assert.match(oku('components/layout/PageNav.tsx'), /style=\{\{ paddingLeft: "0\.75rem" \}\}/);
});

test('GD2 etkin oge aksan cizgisi icerde; Hub ogesine binmez', () => {
  assert.match(kural('.pf-nav-link.is-current'), /box-shadow: inset 3px 0 0 var\(--accent\)/);
  assert.match(
    CSS,
    /\.nginx-hub-link\.is-current \{[^}]*box-shadow: none/,
    'Hub ogesinde aksan cizgisi',
  );
});

test('GD3 masthead arama kutusu: kisayol etiketi, dar ekranda ikon, gizleme sarmalayicida', () => {
  const M = oku('components/layout/Masthead.tsx');
  assert.match(
    M,
    /<span className="hidden md:inline-flex">\s*<button type="button" className="pf-masthead-ara"/,
  );
  assert.match(M, /<span className="inline-flex md:hidden">\s*<button className="pf-masthead-btn"/);
  assert.match(M, /<kbd>\{kisayol\}<\/kbd>/);
  assert.equal(
    (M.match(/onClick=\{openSearch\}/g) || []).length,
    2,
    'iki dugme de ayni paleti acmali',
  );
  // Katmansiz sinif + duyarli gizleme utility'si ayni ogede: utility kaybeder, dugme hep gorunur.
  for (const m of M.matchAll(/className="([^"]*)"/g)) {
    if (/\bpf-masthead-(btn|ara)\b/.test(m[1]))
      assert.doesNotMatch(m[1], /\b(hidden|(sm|md|lg):)/, m[1]);
  }
  const ara = kural('.pf-masthead-ara');
  assert.doesNotMatch(ara, /#[0-9a-f]{3,6}\b/i, 'sabit renk');
});

// Ogeler arasina dikey bosluk eklenirse menu asagi kayar (20 oge x 2 px); alisilmis satirlar bozulur.
test('GD4 menu ogelerine dikey bosluk eklenmedi (satirlar eski yerinde)', () => {
  for (const s of ['.pf-nav-link', '.pf-nav-toggle']) {
    assert.match(kural(s), /\n\s*margin: 0 0\.5rem;/, `${s} dikey bosluk tasiyor`);
  }
});
