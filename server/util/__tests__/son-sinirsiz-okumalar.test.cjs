// server/util/__tests__/son-sinirsiz-okumalar.test.cjs
//
// GERIYE KALAN SINIRSIZ OKUMA YOLLARI (P0-1'in kuyrugu).
//
// Portal 2026-09'da yedi kez OOM ile coktu; hepsinin koku bir HTTP govdesinin
// SINIRSIZ tamponlanmasiydi. Bes yol daha aciktı ve IKI SINIFTA toplaniyordu:
//
//   A) Teams webhook HATA yollari (3 yer) — `await res.text()` sonra
//      `.slice(0, 200)`. Kirpma TAMPONLAMADAN SONRA yapiliyordu, yani
//      HICBIR SEY KURTARMIYORDU.
//   B) AWX token uclari (2 yer) — `data += c`, hicbir tavan yok. AWX ayakta
//      degilse ters-vekil portalin KENDI index.html'ini donuyor.
//
// Bu testler GERCEK kod yolunu sahte bir HTTP katmaniyla kosturur: kaynak
// taramasi bu sinifi goremez — kapinin VAR olmasi yetmez, CALISMASI gerekir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..', '..', '..');
const { readBodyPreview } = require('../bounded-read.cjs');

/** Istendigi kadar buyuk bir govde donduren sunucu; `durum` yazilani olcer. */
function devSunucu(bayt, kod = 500) {
  const durum = { yazilan: 0 };
  const parca = 'H'.repeat(64 * 1024);
  const srv = http.createServer((req, res) => {
    res.writeHead(kod, { 'content-type': 'text/html' });
    const yaz = () => {
      while (durum.yazilan < bayt) {
        durum.yazilan += parca.length;
        if (!res.write(parca)) return res.once('drain', yaz);
      }
      res.end();
    };
    yaz();
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, durum, port: srv.address().port })));
}

function sureSinirli(p, ms, etiket) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${etiket}: ${ms} ms icinde cozulmedi`)), ms)),
  ]);
}

// ── A sinifi: hata govdesi onizlemesi ───────────────────────────────────────

test('SS1 `readBodyPreview` 64 MB govdeyi TAMAMEN OKUMAZ', async () => {
  const { srv, port } = await devSunucu(64 * 1024 * 1024);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    const oncesi = process.memoryUsage().heapUsed;
    const text = await sureSinirli(readBodyPreview(res.body, { maxBytes: 1024 }), 20000, 'SS1');
    const artis = process.memoryUsage().heapUsed - oncesi;
    assert.ok(text.length <= 1024, `tavan asildi: ${text.length} bayt`);
    // OLCULEN kanit: girdi 64 MB iken heap artisi MB mertebesinde olmamali.
    assert.ok(artis < 16 * 1024 * 1024, `heap ${Math.round(artis / 1024 / 1024)} MB artti — govde tamponlanmis`);
  } finally {
    srv.close();
  }
});

test('SS2 `readBodyPreview` HATA FIRLATMAZ — gercek HTTP durumunu maskelemez', async () => {
  // Cagiran taraf zaten bir hatayi bildirmek uzere; tavan asildi diye BASKA bir
  // hata firlatmak asil sebebi (HTTP 503 vs.) gizlerdi.
  const { srv, port } = await devSunucu(8 * 1024 * 1024, 503);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    const text = await sureSinirli(readBodyPreview(res.body, { maxBytes: 512 }), 20000, 'SS2');
    assert.equal(typeof text, 'string');
  } finally {
    srv.close();
  }
});

test('SS3 `readBodyPreview` govde yoksa/bozuksa bos doner, patlamaz', async () => {
  assert.equal(await readBodyPreview(null), '');
  assert.equal(await readBodyPreview(undefined), '');
  const bozuk = (async function* () { yield Buffer.from('bas'); throw new Error('akis koptu'); })();
  // Akis YARIDA koparsa eldeki kisim yine de teshise yarar: '' degil 'bas' beklenir.
  assert.equal(await readBodyPreview(bozuk, { maxBytes: 100 }), 'bas');
});

test('SS4 kucuk govde DOKUNULMADAN gecer (asiri sikilasma yok)', async () => {
  const { srv, port } = await devSunucu(0, 500);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(await readBodyPreview(res.body, { maxBytes: 1024 }), '');
  } finally {
    srv.close();
  }
});

test('SS5 UC Teams yolunun HICBIRINDE `res.text()` KALMADI', () => {
  const dosyalar = [
    'server/ansible/long-job-watcher.cjs',
    'server/ansible/long-job-cancel.cjs',
    'server/db/housekeeping.cjs',
  ];
  for (const f of dosyalar) {
    const kod = fs.readFileSync(path.join(ROOT, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(kod, /await\s+res\.text\(\)/, `${f}: sinirsiz .text() geri geldi`);
    assert.match(kod, /readBodyPreview\(/, `${f}: sinirli okuma kullanilmiyor`);
  }
});

// ── B sinifi: AWX token uclari ──────────────────────────────────────────────

const RUNNER_SRC = fs.readFileSync(path.join(ROOT, 'server/ansible/runner.cjs'), 'utf8');

/** GERCEK `fetchTokenOAuth2AtPath` govdesi — kopyasi degil. */
function gercekTokenFn() {
  const c = RUNNER_SRC.indexOf('const AWX_TOKEN_MAX_BYTES');
  const i = RUNNER_SRC.indexOf('function fetchTokenOAuth2AtPath');
  // SINIR `async function ...` SATIRININ BASINDAN alinir. `indexOf('function ...')`
  // kullanmak `async ` onekini dilimin ICINDE birakir ve cikarilan kod
  // "ReferenceError: async is not defined" ile duserdi — bu tuzaga bir kez dusuldu.
  const j = RUNNER_SRC.indexOf('\nasync function fetchTokenOAuth2(');
  assert.ok(c > 0 && i > c && j > i, 'kaynak cikarimi bozuldu — desen degismis');
  return new Function(
    'http', 'https', 'URL',
    `${RUNNER_SRC.slice(c, i)}\n${RUNNER_SRC.slice(i, j)}\nreturn { fetchTokenOAuth2AtPath, AWX_TOKEN_MAX_BYTES };`,
  )(http, require('node:https'), URL);
}

test('SS6 token ucu DEV yaniti tamponlamaz ve ACIKCA reddeder', async () => {
  const fn = gercekTokenFn();
  const { srv, durum, port } = await devSunucu(64 * 1024 * 1024, 200);
  try {
    const hata = await sureSinirli(
      fn.fetchTokenOAuth2AtPath(`http://127.0.0.1:${port}`, '/api/o/token/', 'u', 'p')
        .then(() => null, (e) => e),
      20000,
      'SS6',
    );
    assert.ok(hata, 'dev yanit KABUL edildi — sinir yok');
    assert.match(hata.message, /çok büyük/, `beklenmeyen hata: ${hata.message}`);
    assert.equal(hata.tooLarge, true, 'tooLarge isareti yok — cagiran kalici/gecici ayrimini yapamaz');
    // Sunucu 64 MB yazmayi BITIREMEDEN baglanti kesilmis olmali.
    assert.ok(durum.yazilan < 64 * 1024 * 1024, 'baglanti kesilmedi, tum govde cekildi');
  } finally {
    srv.close();
  }
});

test('SS7 token ucu kirpmada ASILMAZ (`destroy` sonrasi `end` GELMEZ)', async () => {
  const fn = gercekTokenFn();
  const { srv, port } = await devSunucu(64 * 1024 * 1024, 200);
  try {
    const sonuc = await Promise.race([
      fn.fetchTokenOAuth2AtPath(`http://127.0.0.1:${port}`, '/api/o/token/', 'u', 'p')
        .then(() => 'cozuldu', () => 'cozuldu'),
      new Promise((r) => setTimeout(() => r('ASILDI'), 20000)),
    ]);
    assert.equal(sonuc, 'cozuldu', 'promise asili kaldi — sinirsiz tamponlamadan DAHA KOTU');
  } finally {
    srv.close();
  }
});

test('SS8 NORMAL token yaniti bozulmadan gecer', async () => {
  const fn = gercekTokenFn();
  const srv = http.createServer((q, s) => {
    s.writeHead(200, { 'content-type': 'application/json' });
    s.end(JSON.stringify({ access_token: 'abc123' }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const t = await sureSinirli(
      fn.fetchTokenOAuth2AtPath(`http://127.0.0.1:${srv.address().port}`, '/api/o/token/', 'u', 'p'),
      10000, 'SS8',
    );
    assert.equal(t.token, 'abc123', 'mesru token yolu bozuldu');
    assert.ok(t.expires, 'son kullanma damgasi kayboldu');
  } finally {
    srv.close();
  }
});

test('SS9 token tavani AWX_RESPONSE_MAX_BYTES`ten AYRI ve cok daha kucuk', () => {
  const fn = gercekTokenFn();
  const m = RUNNER_SRC.match(/const AWX_RESPONSE_MAX_BYTES = ([\d\s*]+);/);
  assert.ok(m, 'AWX_RESPONSE_MAX_BYTES bulunamadi');
  const buyuk = m[1].split('*').reduce((a, b) => a * Number(b.trim()), 1);
  assert.ok(
    fn.AWX_TOKEN_MAX_BYTES < buyuk / 4,
    'token tavani govde tavaniyla ayni mertebede — 8 MB`lik hata sayfasi "normal" sayilir',
  );
});

test('SS10 `data += c` yazan HER AWX okuyucusunda bayt kapisi var', () => {
  const kod = RUNNER_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const satirlar = kod.split('\n');
  const kapisiz = [];
  satirlar.forEach((s, i) => {
    if (!/^\s*data \+= (c|chunk);\s*$/.test(s)) return;
    // Ayni `res.on('data')` geri cagrisinda, birikimden ONCE bir tavan
    // karsilastirmasi olmali.
    const once = satirlar.slice(Math.max(0, i - 25), i).join('\n');
    if (!/>\s*[A-Z_]*MAX_BYTES/.test(once)) kapisiz.push(i + 1);
  });
  assert.deepEqual(kapisiz, [], `bayt kapisi OLMAYAN tamponlama satirlari: ${kapisiz.join(', ')}`);
});
