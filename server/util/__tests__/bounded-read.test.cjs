// server/util/__tests__/bounded-read.test.cjs
//
// SINIRLI OKUMA — tek dogru uygulama ve onu kullanan cagri yerleri.
//
// Portal 2026-09'da YEDI KEZ OOM ile coktu; yedisinin de koku bir HTTP
// govdesinin sinirsiz tamponlanmasiydi. Yollar tek tek duzeltildi ve HER
// SEFERINDE ayni iki hata tekrarlandi:
//   1. `destroy()` `end` olayini oldurur → yalnizca `end`de cozmek promise'i
//      SONSUZA DEK asili birakir (PR #106'da tam bu yasandi)
//   2. `.text()` cagirip SONRA uzunluga bakmak ise yaramaz — veri o noktada
//      ZATEN bellektedir
//
// Bu testler yardimciyi GERCEKTEN kosturur (sahte HTTP sunucusuyla) ve cagri
// yerlerinin onu kullandigini kilitler.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { readResponseLimited, readBodyLimited, parseJsonLimited } = require('../bounded-read.cjs');

/** Istenen kadar bayt akitan sahte sunucu. */
function sahteSunucu(bayt, { yavas = false } = {}) {
  return new Promise((cozumle) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      const parca = 'x'.repeat(64 * 1024);
      let kalan = bayt;
      const yaz = () => {
        while (kalan > 0) {
          const n = Math.min(parca.length, kalan);
          kalan -= n;
          if (!res.write(parca.slice(0, n))) {
            res.once('drain', yaz);
            return;
          }
        }
        res.end();
      };
      if (yavas) setTimeout(yaz, 5);
      else yaz();
    });
    srv.listen(0, '127.0.0.1', () => cozumle({ srv, port: srv.address().port }));
  });
}

function istek(port, opts) {
  return new Promise((cozumle, reddet) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/' }, (res) => {
      readResponseLimited(res, { ...opts, onAbort: () => req.destroy() }).then(cozumle, reddet);
    });
    req.on('error', reddet);
  });
}

/** Asili kalmayi HATA olarak gorunur kilar. */
function sureSinirli(p, ms, etiket) {
  return Promise.race([
    p,
    new Promise((_, r) => setTimeout(() => r(new Error(`${etiket}: ${ms} ms icinde SONUC GELMEDI`)), ms)),
  ]);
}

test('BR1 tavani asan govde REDDEDILIYOR ve promise ASILI KALMIYOR', async () => {
  const { srv, port } = await sahteSunucu(8 * 1024 * 1024);
  try {
    await assert.rejects(
      // 15 sn: `destroy()` sonrasi `end` GELMEZ. Yalnizca `end`de cozen bir
      // uygulama burada SONSUZA DEK asili kalirdi — PR #106'daki tuzak.
      sureSinirli(istek(port, { maxBytes: 512 * 1024, label: 'test' }), 15000, 'BR1'),
      (e) => {
        assert.equal(e.tooLarge, true, 'hata `tooLarge` isaretlenmemis');
        assert.equal(e.permanent, true, 'red KALICI isaretlenmemis — tekrar denenir');
        assert.match(e.message, /çok büyük/, 'kullaniciya sebep soylenmiyor');
        return true;
      },
    );
  } finally {
    srv.close();
  }
});

test('BR2 tavan altindaki govde DOKUNULMADAN donuyor', async () => {
  const { srv, port } = await sahteSunucu(100 * 1024);
  try {
    const metin = await sureSinirli(istek(port, { maxBytes: 1024 * 1024, label: 'test' }), 15000, 'BR2');
    assert.equal(Buffer.byteLength(metin, 'utf8'), 100 * 1024);
  } finally {
    srv.close();
  }
});

test('BR3 `readBodyLimited` .text() CAGIRMADAN sinirliyor', async () => {
  // `.text()` govdenin tamamini bellege alir; uzunluga SONRADAN bakmak
  // hicbir seyi kurtarmaz.
  const src = fs.readFileSync(path.join(__dirname, '..', 'bounded-read.cjs'), 'utf8');
  const govde = src.slice(src.indexOf('async function readBodyLimited'), src.indexOf('function parseJsonLimited'));
  assert.ok(!/\.text\(\)/.test(govde), 'yardimci hala `.text()` kullaniyor');

  // Davranis: akis tavani asinca kesiliyor.
  async function* akis(toplam) {
    let kalan = toplam;
    while (kalan > 0) {
      const n = Math.min(64 * 1024, kalan);
      kalan -= n;
      yield Buffer.alloc(n, 0x78);
    }
  }
  await assert.rejects(
    readBodyLimited(akis(4 * 1024 * 1024), { maxBytes: 256 * 1024, label: 'test' }),
    (e) => e.tooLarge === true,
  );
  const kucuk = await readBodyLimited(akis(1024), { maxBytes: 256 * 1024, label: 'test' });
  assert.equal(kucuk.length, 1024);
});

test('BR4 `parseJsonLimited` PARSE ETMEDEN once sinirliyor', () => {
  // `JSON.parse` metnin 3-6 kati nesne grafigi uretir; parse'tan SONRA kirpmak
  // bellegi kurtarmaz.
  const buyuk = JSON.stringify({ a: 'x'.repeat(2 * 1024 * 1024) });
  assert.throws(() => parseJsonLimited(buyuk, { maxBytes: 64 * 1024, label: 'test' }), (e) => e.tooLarge === true);
  assert.deepEqual(parseJsonLimited('{"a":1}', { maxBytes: 1024, label: 'test' }), { a: 1 });

  // ── SIRAYI GERCEKTEN AYIRT ET ────────────────────────────────────────────
  //
  // Yukaridaki iki assert SIRAYI OLCMUYOR: parse once kosup SONRA boyut
  // kontrolu firlatsa da sonuc yine `tooLarge` olurdu. Mutasyon turunda
  // "kapiyi parse'tan sonraya al" mutasyonu HICBIR BEKCIYI ates almadi.
  //
  // AYIRT EDICI: hem TAVANI ASAN hem de GECERSIZ JSON olan bir girdi.
  //   kapi ONCE ise  -> `tooLarge` (parse hic calismaz)
  //   parse ONCE ise -> `SyntaxError`
  const bozukVeBuyuk = '{' + 'x'.repeat(200 * 1024);
  assert.throws(
    () => parseJsonLimited(bozukVeBuyuk, { maxBytes: 64 * 1024, label: 'test' }),
    (e) => {
      assert.equal(
        e.tooLarge,
        true,
        `kapi PARSE'TAN SONRA calisiyor — bellegi kurtarmiyor (alinan: ${e.name})`,
      );
      return true;
    },
  );
});

// ── CAGRI YERLERI ──────────────────────────────────────────────────────────

const oku = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');

test('BR5 sinirsiz okuma yollari KAPANDI', () => {
  const hedefler = [
    ['logx/v2/ocp-health.cjs', /readResponseLimited\(/, /let data = '';[\s\S]{0,80}data \+= c/],
    ['nobetci/index.cjs', /readResponseLimited\(/, /chunks\.push\(c\)\);[\s\S]{0,120}Buffer\.concat/],
    ['ai/provider.cjs', /readResponseLimited\(/, /res\.on\('data', \(c\) => \{ data \+= c; \}\)/],
    ['smart/client.cjs', /readBodyLimited\(/, /await result\.body\.text\(\)/],
    ['splunk/client.cjs', /readBodyLimited\(/, /const text = await res\.text\(\)/],
  ];
  for (const [dosya, olmali, olmamali] of hedefler) {
    const src = oku(dosya);
    assert.match(src, olmali, `${dosya}: sinirli okuyucu KULLANILMIYOR`);
    assert.ok(!olmamali.test(src), `${dosya}: SINIRSIZ okuma hala duruyor`);
  }
});

test('BR6 MCP arac sonucu PARSE`TAN ONCE sinirlaniyor', () => {
  const src = oku('mcp/client.cjs');
  const i = src.indexOf('async function callTool');
  const govde = src.slice(i, src.indexOf('async function listTools', i));
  const kapi = govde.indexOf('MCP_RESULT_MAX_BYTES');
  const parse = govde.indexOf('JSON.parse(textContent)');
  assert.ok(kapi > 0, 'bayt kapisi yok');
  assert.ok(parse > 0, 'parse bulunamadi');
  assert.ok(kapi < parse, 'kapi PARSE`TAN SONRA — bellegi kurtarmaz');
  assert.match(govde, /truncated: true/, 'kirpma SESSIZ — cagiran bilmiyor');
});

test('BR7 yardimci `end` beklemeden REDDEDIYOR (asili promise tuzagi)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'bounded-read.cjs'), 'utf8');
  const govde = src.slice(src.indexOf('function readResponseLimited'), src.indexOf('async function readBodyLimited'));
  // Red, `data` isleyicisinin ICINDE olmali; `end` isleyicisine ertelenmis
  // olmamali. `destroy()` sonrasi `end` GELMEZ.
  const dataIdx = govde.indexOf("response.on('data'");
  const endIdx = govde.indexOf("response.on('end'");
  const kesIdx = govde.indexOf('kes(tooLargeError');
  assert.ok(dataIdx > 0 && endIdx > dataIdx, 'isleyici sirasi beklenmedik');
  assert.ok(kesIdx > dataIdx && kesIdx < endIdx, 'red `data` isleyicisinde DEGIL — promise asili kalabilir');
});

test('BR8 OCP baglanti helperi akan govdeyi sinirsiz biriktirmiyor', () => {
  const src = oku('ansible/runner.cjs');
  const start = src.indexOf('function probeClusterApiVersion');
  const end = src.indexOf('function initAnsibleRunner', start);
  const helper = src.slice(start, end);

  assert.ok(start >= 0 && end > start, 'OCP baglanti helper siniri bulunamadi');
  assert.match(helper, /readResponseLimited\(httpRes,/, 'helper ortak bayt kapisini kullanmiyor');
  assert.match(helper, /maxBytes:\s*256 \* 1024/, 'OCP probe bayt tavani yok');
  assert.doesNotMatch(
    helper,
    /httpRes\.on\('data',[\s\S]{0,160}data \+= c/,
    'OCP probe govdeyi yeniden sinirsiz biriktiriyor',
  );
});
