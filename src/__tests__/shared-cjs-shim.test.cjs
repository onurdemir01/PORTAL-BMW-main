// src/__tests__/shared-cjs-shim.test.cjs
//
// DEV SUNUCUSU SHIM'I: shared modullerin GERCEK disa aktarimlarini verir (2026-10-07).
//
// `shared/*.cjs` sunucuyla paylasilan saf CommonJS modulleridir. Vite dev sunucusu bunlari
// kendiliginden ESM'e cevirmez; `scripts/shared-cjs-shim.cjs` sarar. Eski surum disa aktarilan
// adlari REGEX ile metinden cikariyordu ve ILK `module.exports = {` eslesmesini aliyordu:
// `shared/cryptoHubResources.cjs` icindeki bir aciklama yorumu (`module.exports = { a, b }`)
// gercek disa aktarimdan once geldigi icin shim `a` ve `b` adlarini uretti, Crypto Hub sayfasi
// dev sunucusunda "Export 'a' is not defined in module" ile hic acilmadi.
//
// Bu bekci metne bakmaz: her shared modulu shim'den gecirir ve sonucu GERCEK bir ES modulu
// olarak ice aktarir. Adlar ve degerler, modulun `require` ile gelen haliyle ayni olmalidir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { exportKeys, wrapSharedCjs } = require('../../scripts/shared-cjs-shim.cjs');

const SHARED = path.join(__dirname, '..', '..', 'shared');
const dosyalar = fs.readdirSync(SHARED).filter((f) => f.endsWith('.cjs'));

async function sarIceAktar(kaynak, anahtarlar, ad) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shim-'));
  try {
    const f = path.join(tmp, `${ad}.mjs`);
    fs.writeFileSync(f, wrapSharedCjs(kaynak, anahtarlar));
    return await import(pathToFileURL(f).href);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('SH0 taranacak shared modul var (dizin tasinirsa bekci bos kalmasin)', () => {
  assert.ok(dosyalar.length >= 5, `shared altinda .cjs az: ${dosyalar}`);
});

for (const f of dosyalar) {
  test(`SH1 ${f}: shim'den gecen modul GERCEK disa aktarimlarini verir`, async () => {
    const yol = path.join(SHARED, f);
    const gercek = require(yol);
    const anahtarlar = exportKeys(yol);
    assert.ok(anahtarlar, `${f} yuklenemedi`);
    assert.deepEqual([...anahtarlar].sort(), Object.keys(gercek).sort());
    const esm = await sarIceAktar(fs.readFileSync(yol, 'utf8'), anahtarlar, f.replace(/\W/g, '_'));
    assert.deepEqual(
      Object.keys(esm)
        .filter((k) => k !== 'default')
        .sort(),
      Object.keys(gercek).sort(),
      `${f}: tarayicinin gorecegi adlar gercek disa aktarimlardan farkli`,
    );
    for (const k of Object.keys(gercek)) {
      assert.equal(typeof esm[k], typeof gercek[k], `${f}: ${k} turu farkli`);
    }
    assert.deepEqual(Object.keys(esm.default).sort(), Object.keys(gercek).sort());
  });
}

test('SH2 yorumdaki ornek disa aktarim GERCEK sanilmaz; ust kapsamla ad cakismasi olmaz', async () => {
  const kaynak = [
    '// Shim yalniz `module.exports = { a, b }` bicimini anlar.',
    'const ALAN = 7;',
    'function topla(x) { return x + ALAN; }',
    'module.exports = { ALAN, topla, takma: topla, ic: { derin: { x: 1 } } };',
  ].join('\n');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shim-'));
  let anahtarlar;
  try {
    const f = path.join(tmp, 'ornek.cjs');
    fs.writeFileSync(f, kaynak);
    anahtarlar = exportKeys(f);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  assert.deepEqual(anahtarlar, ['ALAN', 'topla', 'takma', 'ic']);
  const esm = await sarIceAktar(kaynak, anahtarlar, 'ornek');
  assert.equal(esm.ALAN, 7);
  assert.equal(esm.topla(1), 8);
  assert.equal(esm.takma, esm.topla);
  assert.equal(esm.ic.derin.x, 1);
  assert.equal('a' in esm, false);
});

test('SH3 yuklenemeyen dosya sarilmaz (null): dev sunucusu yanlis adlar uretmez', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shim-'));
  try {
    const f = path.join(tmp, 'bozuk.cjs');
    fs.writeFileSync(f, 'module.exports = { a: ;');
    assert.equal(exportKeys(f), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('SH4 vite.config.ts shim mantigini bu dosyadan alir (kendi regex kopyasi yok)', () => {
  const cfg = fs.readFileSync(path.join(__dirname, '..', '..', 'vite.config.ts'), 'utf8');
  assert.match(cfg, /scripts\/shared-cjs-shim\.cjs/);
  assert.ok(
    !/module\\\.exports/.test(cfg),
    'vite.config.ts icinde metinden ad cikaran regex kalmis',
  );
});
