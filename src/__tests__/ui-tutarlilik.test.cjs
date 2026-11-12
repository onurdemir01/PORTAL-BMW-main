// src/__tests__/ui-tutarlilik.test.cjs — UI tutarliligi (2026-11-08): onay penceresi, yardim dugmesi, giris kutusu dili.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}
const SRC_FILES = walk(ROOT);
const stripComments = (s) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');

// Tarayicinin gri `confirm` kutusu portal temasina uymuyor, dugmeleri tarayici dilinde yaziyor
// ve tehlikeli islemi ayirmiyordu. Onay `useOnay` (common/OnayPenceresi) ile sorulur.
test('ON1 kaynakta tarayici confirm() kalmadi', () => {
  const bad = SRC_FILES.filter((f) => !f.split(path.sep).includes('__tests__'))
    .filter((f) =>
      /(^|[^\w.])(window\.)?confirm\(/m.test(stripComments(fs.readFileSync(f, 'utf8'))),
    )
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(bad, []);
});

// Kancayi cagirip `{onayPenceresi}`ni cizmeyen bilesende pencere hic acilmaz ve `await onayla()`
// sonsuza dek bekler: dugme sessizce hicbir sey yapmaz.
test('ON2 useOnay kullanan her dosya {onayPenceresi}ni ciziyor', () => {
  const kullananlar = SRC_FILES.filter((f) => !f.split(path.sep).includes('__tests__'))
    .map((f) => [path.relative(ROOT, f), stripComments(fs.readFileSync(f, 'utf8'))])
    .filter(([, s]) => /\buseOnay\(\)/.test(s) && !/export function useOnay/.test(s));
  assert.ok(kullananlar.length >= 10, `useOnay kullanan dosya az: ${kullananlar.length}`);
  for (const [f, s] of kullananlar) {
    const kanca = (s.match(/\buseOnay\(\)/g) || []).length;
    const cizim = (s.match(/\{onayPenceresi\}/g) || []).length;
    assert.equal(cizim, kanca, `${f}: ${kanca} useOnay, ${cizim} {onayPenceresi}`);
  }
});

// Yardim dugmesi alti sayfada alti bicimdeydi ("Bu sayfa nasıl kullanılır?" baglantisi,
// "Yardım" / "Nasıl kullanılır?" dugmeleri; farkli kose, boy, renk). HelpModal acan sayfa
// tetikleyiciyi ortak bilesenden alir. Kapsam disi: nginx_console (sahibi baska ekip, zaten
// ayni metin) ve kendi yardim penceresini tasiyan PageVisibilityTab.
const YARDIM_KAPSAM_DISI = /^components\/nginx_console\/|^components\/admin\/tabs\/PageVisibilityTab\.tsx$/;
test('YD1 HelpModal acan sayfa yardim dugmesini YardimDugmesi`nden alir', () => {
  const sayfalar = SRC_FILES.filter((f) => !f.split(path.sep).includes('__tests__'))
    .map((f) => [path.relative(ROOT, f), stripComments(fs.readFileSync(f, 'utf8'))])
    // Yol ayraci normalize: Windows'ta path.relative ters egik cizgi verir, desen '/' bekler (bekci platformdan bagimsiz).
    .map(([f, s]) => [f.split(path.sep).join('/'), s])
    .filter(([f, s]) => /<HelpModal\b/.test(s) && !YARDIM_KAPSAM_DISI.test(f) && !/common\/HelpModal\.tsx$/.test(f));
  assert.ok(sayfalar.length >= 6, `HelpModal kullanan sayfa az: ${sayfalar.length}`);
  for (const [f, s] of sayfalar) {
    assert.match(s, /<YardimDugmesi\b/, `${f}: ortak yardim dugmesi yok`);
    assert.doesNotMatch(s, /\bYardım\s*<\/button>|Bu sayfa nasıl kullanılır\?/, `${f}: eski yardim tetikleyicisi duruyor`);
  }
});

// `.pf-input` / `.input-modern` katmansiz yazildiginda ayni ogedeki Tailwind dolgusunu eziyordu
// (`pf-input pr-10` giris parolasi, `pf-input pl-9` arama): metin ikonun altina giriyordu.
test('IN1 .pf-input @layer components icinde; katmansiz tanim yok', () => {
  // Yorumlar ayiklanir: bas yorumu `.input-modern` adini duz metin olarak anar.
  const css = fs.readFileSync(path.join(ROOT, 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const i = css.indexOf('@layer components {');
  assert.ok(i >= 0, '@layer components blogu yok');
  let derin = 0;
  let j = css.indexOf('{', i);
  for (; j < css.length; j++) {
    if (css[j] === '{') derin++;
    else if (css[j] === '}' && --derin === 0) break;
  }
  const ic = css.slice(i, j);
  const dis = css.slice(0, i) + css.slice(j);
  assert.match(ic, /\.pf-input\s*\{/);
  assert.match(ic, /\.input-modern,/);
  assert.doesNotMatch(dis, /\.(pf-input|input-modern)\b[^{]*\{/, 'katman disinda .pf-input kurali var');
  assert.match(ic, /border-radius: var\(--radius-md\)/, 'PF6 kosesi yok');
});
