// server/ansible/__tests__/job-output-bounds.test.cjs
// AWX CIKTISI BELLEGE SINIRSIZ ALINMASIN — URETIMDE IKI KEZ COKERTTI.
//
// 2026-09-19, `prod.out`: iki ayri OOM, ikisi de ~2 GB heap tavaninda.
//   Mark-Compact 2090.0 (2122.6) -> 2065.6 (2107.6) MB ... allocation failure
//   FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
//
// ONEMLI AYRIM: iki cokmenin son JS karesi FARKLI —
//   OOM #1: Runtime_AllocateInYoungGeneration   (split YOK)
//   OOM #2: Runtime_StringSplit
// Yani `split` SON DAMLAYDI, SEBEP DEGIL. Mark-Compact'tan SONRA hala 2065 MB
// canliydi: sorun TUTULAN (retained) tamponlar. Sebep `fetchAwxPlainText`in
// `data += chunk` ile sinirsiz tamponlamasi ve ayni ciktinin HER YOKLAMADA
// yeniden indirilmesi.
//
// Bu testler GERCEK kod yolunu sahte bir HTTP katmaniyla kosturur — kaynak
// taramasi bu sinifi goremez (kapinin VAR olmasi yetmez, CALISMASI gerekir).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER_SRC = fs.readFileSync(path.join(ROOT, 'server/ansible/runner.cjs'), 'utf8');

/** Belirtilen boyutta duz metin donduren gecici bir HTTP sunucusu. */
function sahteAwx(bayt) {
  const parca = 'x'.repeat(64 * 1024);
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      let yazilan = 0;
      const yaz = () => {
        while (yazilan < bayt) {
          yazilan += parca.length;
          if (!res.write(parca)) return res.once('drain', yaz);
        }
        res.end();
      };
      yaz();
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

/**
 * ASILMAYA DAYANIKLI BEKLEME. Bir mutasyon promise'i cozulmez birakirsa (bkz.
 * JO1b), `await` suiti SONSUZA DEK bloklar ve dosyadaki DIGER testler de hic
 * kosmaz — yani tek bir hata butun bekciyi sustururdu. Her cagri kendi sinirini
 * tasir.
 */
function sureSinirli(p, ms, etiket) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${etiket}: promise ${ms} ms icinde cozulmedi`)), ms)),
  ]);
}

/**
 * `fetchAwxPlainText` disa acilmiyor; kaynaktan cikarilip AYNI bagimliliklarla
 * kosturulur — kopyasi degil, GERCEK govde. (Sabitler de birlikte alinir, yoksa
 * `AWX_RESPONSE_MAX_BYTES` tanimsiz kalir.)
 */
function gercekFetch() {
  const i = RUNNER_SRC.indexOf('function fetchAwxPlainText');
  const j = RUNNER_SRC.indexOf('function isAwxStdoutTooLarge');
  const k = RUNNER_SRC.indexOf('const JOB_OUTPUT_MAX_BYTES');
  assert.ok(i > 0 && j > i && k > 0 && k < i, 'kaynak cikarimi bozuldu — desen degismis');
  return new Function(
    'http',
    'https',
    'URL',
    `${RUNNER_SRC.slice(k, i)}\n${RUNNER_SRC.slice(i, j)}\n` +
      'return { fetchAwxPlainText, AWX_RESPONSE_MAX_BYTES, AWX_TRUNCATION_NOTICE };',
  )(http, require('node:https'), URL);
}

// JO1 — ASIL KAPI. Buyuk yanit bellege OLDUGU GIBI alinmamali.
test('JO1 `fetchAwxPlainText` buyuk yaniti KIRPIYOR ve sessiz kalmiyor', async () => {
  const fn = gercekFetch();
  const { srv, port } = await sahteAwx(20 * 1024 * 1024);
  try {
    const out = await sureSinirli(
      fn.fetchAwxPlainText(`http://127.0.0.1:${port}`, 't', '/stdout'),
      15000,
      'JO1',
    );
    assert.ok(
      out.length <= fn.AWX_RESPONSE_MAX_BYTES + fn.AWX_TRUNCATION_NOTICE.length + 65536,
      `yanit kirpilmadi: ${Math.round(out.length / 1024 / 1024)} MB alindi`,
    );
    assert.ok(out.includes('KIRPILDI'), 'kirpma SESSIZCE yapildi — kullanici yarim logu tam sanar');
  } finally {
    srv.close();
  }
});

// JO1b — ASILMA YOK. `req.destroy()` cagrildiginda `end` olayi ARTIK GELMEZ;
// yalnizca `end` icinde cozen bir kapi promise'i SONSUZA DEK asili birakirdi —
// sinirsiz tamponlamadan DAHA KOTU bir hata. (Ilk yazimda tam bu tuzaga dustum.)
test('JO1b kirpma promise`i ASILI BIRAKMIYOR', async () => {
  const fn = gercekFetch();
  const { srv, port } = await sahteAwx(20 * 1024 * 1024);
  try {
    const yaris = await Promise.race([
      fn.fetchAwxPlainText(`http://127.0.0.1:${port}`, 't', '/stdout').then(() => 'cozuldu'),
      new Promise((r) => setTimeout(() => r('ASILDI'), 15000)),
    ]);
    assert.equal(yaris, 'cozuldu', 'promise cozulmedi — cagiran taraf sonsuza dek bekler');
  } finally {
    srv.close();
  }
});

// JO2 — KUCUK YANIT DOKUNULMADAN GECMELI (asiri sikilasma yok).
test('JO2 kucuk yanit kirpilmiyor ve uyari metni EKLENMIYOR', async () => {
  const fn = gercekFetch();
  const { srv, port } = await sahteAwx(128 * 1024);
  try {
    const out = await sureSinirli(
      fn.fetchAwxPlainText(`http://127.0.0.1:${port}`, 't', '/stdout'),
      15000,
      'JO2',
    );
    assert.equal(out.length, 128 * 1024, 'kucuk yanit degistirildi');
    assert.ok(!out.includes('KIRPILDI'), 'kirpilmayan yanita uyari eklendi');
  } finally {
    srv.close();
  }
});

// JO3 — `changed=` kontrolu DIZI AYIRMADAN yapilmali. OOM #2'nin son JS karesi
// (`Runtime_StringSplit`) tam olarak buydu ve amaci yalnizca bir regex testiydi.
test('JO3 `changed=` kontrolu tum ciktiyi diziye AYIRMIYOR', () => {
  const kod = RUNNER_SRC.split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  assert.doesNotMatch(
    kod,
    /const lines = output\.split\('\\n'\)/,
    'cikti yine diziye ayriliyor — OOM #2 bu satirda oldu',
  );
  assert.match(kod, /changed=\\s\*\[1-9\]\/m\.test\(output\)/, 'regex dogrudan metne uygulanmiyor');
});

// JO4 — EVENT YEDEGINDE BAYT BUTCESI. Tavan "event sayisi" (40000) idi; bayt
// degil. Event basina stdout birkac KB olabildigi icin birikim yuzlerce MB'a
// cikiyordu — yani yanlis eksende sinirlanmisti.
test('JO4 `collectJobEventsStdout` BAYT butcesi tasiyor (event sayisi degil)', () => {
  const govde = RUNNER_SRC.slice(
    RUNNER_SRC.indexOf('async function collectJobEventsStdout'),
    RUNNER_SRC.indexOf('function applyOutputFilter'),
  );
  assert.match(govde, /JOB_OUTPUT_MAX_BYTES/, 'bayt butcesi yok');
  assert.match(govde, /kirpildi/, 'kirpma bayragi yok');
  assert.match(govde, /AWX_TRUNCATION_NOTICE/, 'kirpma SESSIZ — kullaniciya soylenmiyor');
});
