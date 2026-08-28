// src/__tests__/color-syntax.test.cjs — URETILEN renk degerinin GECERLI olmasi.
//
// NE OLDU: saydam tonlar icin sayisal RGB uclusu tasiyan token'lar eklendi
// (`--accent-rgb`, terminal `meta.rgb`) ve `rgb(var(--accent-rgb) / 0.08)` gibi
// kullanildi. Ucluler VIRGULLU yazilmisti (`0, 102, 204`), dolayisiyla uretilen
// deger `rgb(0, 102, 204 / 0.08)` oluyordu.
//
// BU GECERSIZ CSS'TIR. `rgb()` iki AYRI dilbilgisi tanir — eski virgullu
// (`rgb(r, g, b)` / `rgba(r, g, b, a)`) ve modern bosluklu (`rgb(r g b / a)`) —
// ve IKISI KARISTIRILAMAZ. Tarayici boyle bir bildirimi TUMDEN ATAR: hata yok,
// uyari yok, sadece o kural hic uygulanmaz.
//
// URETIMDEKI SONUCU: Ansible/job terminalinin CALISIRKEN gorunen kenarligi,
// parildamasi ve tarama efekti hicbir sey cizmiyordu.
//
// ONCEKI TEST NEDEN YAKALAMADI: `rgb(${meta.rgb} / 0.\d+)` KALIBININ kullanildigini
// dogruluyordu — kalip dogruydu, URETILEN DEGER gecersizdi. Sekli test etmek
// gecerliligi test etmek DEGILDIR. Bu test artik degerin kendisini ayristirir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

// Modern `rgb(r g b / a)` dilbilgisi — bilesenler BOSLUKLA ayrilir.
// Bu, culori/tarayici davranisiyla dogrulanmis daraltilmis bir kontroldur:
// uclunun icinde VIRGUL varsa deger gecersizdir.
function isValidModernTriple(triple) {
  return /^\s*\d{1,3}\s+\d{1,3}\s+\d{1,3}\s*$/.test(triple);
}

test('--accent-rgb BOSLUKLU (virgullu olsa uretilen deger GECERSIZ olurdu)', () => {
  const css = strip(fs.readFileSync(path.join(ROOT, 'index.css'), 'utf8'));
  const triples = [...css.matchAll(/--accent-rgb:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.equal(triples.length, 2, 'acik ve koyu tema icin iki tanim bekleniyor');
  for (const t of triples) {
    assert.ok(!t.includes(','), `virgullu uclu: "${t}" -> rgb(${t} / 0.08) GECERSIZ`);
    assert.ok(isValidModernTriple(t), `gecersiz uclu: "${t}"`);
  }
});

test('terminal durum ucluleri BOSLUKLU', () => {
  const src = strip(fs.readFileSync(path.join(ROOT, 'components/common/AnsibleLogTerminal.tsx'), 'utf8'));
  const triples = [...src.matchAll(/of\("--term-[a-z]+",\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(triples.length >= 5, `beklenenden az uclu bulundu: ${triples.length}`);
  for (const t of triples) {
    assert.ok(!t.includes(','), `virgullu uclu: "${t}" -> rgb(${t} / 0.33) GECERSIZ`);
    assert.ok(isValidModernTriple(t), `gecersiz uclu: "${t}"`);
  }
});

test('slash sozdizimi YALNIZCA bosluklu uclulerle kullaniliyor', () => {
  // Kaynakta `rgb(<virgullu> / <alpha>)` bicimi HIC gecmemeli.
  function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(tsx?|css)$/.test(e.name)) out.push(p);
    }
    return out;
  }
  const bad = [];
  for (const f of walk(ROOT)) {
    const src = strip(fs.readFileSync(f, 'utf8'));
    // rgb( ... , ... / ... )  -> virgul VE slash birlikte
    for (const m of src.matchAll(/rgba?\([^)]*,[^)]*\/[^)]*\)/g)) {
      bad.push(`${path.relative(ROOT, f)}: ${m[0].slice(0, 60)}`);
    }
  }
  assert.deepEqual(bad, [], `virgul + slash KARISIMI (gecersiz):\n${bad.join('\n')}`);
});

test('bekcinin kendisi kor DEGIL', () => {
  // Kontrol gercekten ayirt ediyor mu?
  assert.ok(isValidModernTriple('0 102 204'));
  assert.ok(!isValidModernTriple('0, 102, 204'));
  assert.ok(!isValidModernTriple('0,102,204'));
});
