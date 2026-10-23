// server/__tests__/node-telafi.test.cjs
//
// YAMASIZ NODE ICIN TELAFI KORUMALARI (2026-10-23). Portalin calistigi makine Node 22.22.2'de
// kaliyor; uygulama icinden kapatilabilen acikler server/node-guvenlik.cjs'te.
//
//   NT1 yalniz tabanin altindaki surumde kurulur (yamali Node'da hicbir sey degismez)
//   NT2 giden fetch: basliksiz istek `accept-encoding: gzip, deflate`; verilen baslik korunur
//   NT2b sarmalayici HTTPS isteginde de bunu alttaki fetch'e verir (undici https'te br ister)
//   NT3 giden fetch (global ve undici): `content-encoding: br` yanit REDDEDILIR; gzip calisir
//   NT4 dns: NUL bayti olan ad (geri cagirimli, promise, resolve4) reddedilir; normal ad cozulur
//   NT5 kaldirinca ozgun fonksiyonlar geri gelir
//   NT6 acilis: korumalar diger modullerden ONCE kurulur ve devredeyse loga yazilir
'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const dns = require('node:dns');
const fs = require('node:fs');
const path = require('node:path');

const g = require('../node-guvenlik.cjs');

const GOVDE = JSON.stringify({ ok: true, mesaj: 'merhaba' });
let gorulenKodlama = null;
const sunucu = http.createServer((req, res) => {
  gorulenKodlama = req.headers['accept-encoding'] || null;
  if (req.url === '/br') {
    res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'br' });
    return res.end(zlib.brotliCompressSync(GOVDE));
  }
  if (req.url === '/gzip') {
    res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
    return res.end(zlib.gzipSync(GOVDE));
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(GOVDE);
});
let taban;
const hazir = new Promise((r) =>
  sunucu.listen(0, '127.0.0.1', () => r((taban = `http://127.0.0.1:${sunucu.address().port}`))),
);

after(() => {
  g.telafiKorumalariniKaldir();
  sunucu.closeAllConnections();
  sunucu.close();
});

test('NT1 yalniz tabanin altindaki surumde kurulur', () => {
  assert.deepEqual(g.telafiKorumalariniKur({ surum: 'v26.12.1' }), []);
  assert.deepEqual(g.telafiKorumalariniKur({ surum: 'v22.23.4' }), []);
  assert.equal(
    globalThis.fetch[Symbol.for('portal.yamasizNodeTelafi')],
    undefined,
    'yamali surumde fetch sarildi',
  );
  assert.deepEqual(g.telafiKorumalariniKur({ surum: 'v22.22.2' }), ['giden-brotli', 'dns-nul']);
  // Ikinci cagri ikinci kez sarmaz.
  assert.deepEqual(g.telafiKorumalariniKur({ surum: 'v22.22.2' }), ['giden-brotli', 'dns-nul']);
});

test('NT2 basliksiz istek gzip, deflate ister; verilen baslik korunur', async () => {
  await hazir;
  await (await fetch(`${taban}/duz`)).text();
  assert.equal(gorulenKodlama, 'gzip, deflate');
  await (await fetch(`${taban}/duz`, { headers: { 'Accept-Encoding': 'identity' } })).text();
  assert.equal(gorulenKodlama, 'identity');
});

test('NT2b sarmalayici HTTPS isteginde alttaki fetch e gzip, deflate verir; verilen baslik ve govde korunur', async () => {
  // undici fetch HTTP'de zaten `gzip, deflate` ister, HTTPS'te `br` de ekler: yerel HTTP sunucusu
  // bu farki GORMEZ. Alttaki fetch sahte: ne aldigi dogrudan olculur.
  let gelen = null;
  const sahte = async (input, init) => {
    gelen = {
      kodlama: init.headers.get('accept-encoding'),
      tur: init.headers.get('content-type'),
      govde: init.body,
      yontem: init.method,
    };
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  };
  const f = g.brotliRedliFetch(sahte, Headers);
  await f('https://ornek.test/x');
  assert.equal(gelen.kodlama, 'gzip, deflate');
  await f('https://ornek.test/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"a":1}',
  });
  assert.deepEqual(gelen, {
    kodlama: 'gzip, deflate',
    tur: 'application/json',
    govde: '{"a":1}',
    yontem: 'POST',
  });
  await f('https://ornek.test/x', { headers: [['Accept-Encoding', 'identity']] });
  assert.equal(gelen.kodlama, 'identity');
});

test('NT3 br yanit reddedilir (global ve undici fetch); gzip ve duz yanit calisir', async () => {
  await hazir;
  const undici = require('undici');
  for (const [ad, f] of [
    ['global', globalThis.fetch],
    ['undici', undici.fetch],
  ]) {
    await assert.rejects(
      f(`${taban}/br`),
      (e) => e.code === 'BROTLI_YANIT_REDDI' && /CVE-2026-111497/.test(e.message),
      `${ad}: br reddedilmedi`,
    );
    assert.deepEqual(
      await (await f(`${taban}/gzip`)).json(),
      JSON.parse(GOVDE),
      `${ad}: gzip bozuldu`,
    );
    assert.deepEqual(
      await (await f(`${taban}/duz`)).json(),
      JSON.parse(GOVDE),
      `${ad}: duz yanit bozuldu`,
    );
  }
});

test('NT4 NUL bayti olan konak adi reddedilir; normal ad cozulur', async () => {
  await new Promise((resolve) =>
    dns.lookup('ornek\u0000.test', (e) => {
      assert.equal(e && e.code, 'ERR_INVALID_ARG_VALUE');
      resolve();
    }),
  );
  await assert.rejects(dns.promises.lookup('ornek\u0000.test'), { code: 'ERR_INVALID_ARG_VALUE' });
  await assert.rejects(dns.promises.resolve4('ornek\u0000.test'), {
    code: 'ERR_INVALID_ARG_VALUE',
  });
  const r = await dns.promises.lookup('localhost');
  assert.ok(r.address, 'localhost cozulmedi');
});

test('NT5 kaldirinca ozgun fonksiyonlar geri gelir', () => {
  const sarili = globalThis.fetch;
  assert.ok(sarili[Symbol.for('portal.yamasizNodeTelafi')], 'once sarili olmali');
  g.telafiKorumalariniKaldir();
  assert.equal(globalThis.fetch[Symbol.for('portal.yamasizNodeTelafi')], undefined);
  assert.equal(dns.lookup[Symbol.for('portal.yamasizNodeTelafi')], undefined);
  assert.equal(require('undici').fetch[Symbol.for('portal.yamasizNodeTelafi')], undefined);
});

test('NT6 acilista korumalar diger modullerden ONCE kurulur ve loga yazilir', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  const log = kaynak.indexOf("require('./log.cjs').install(");
  const kur = kaynak.indexOf('telafiKorumalariniKur()');
  const servis = kaynak.indexOf("require('./service.cjs')");
  assert.ok(
    log > 0 && kur > log && servis > kur,
    'telafi korumalari log kurulumundan sonra, service.cjs den once olmali',
  );
  const dinle = kaynak.slice(kaynak.indexOf('app.listen(PORT'));
  assert.match(
    dinle.slice(0, 1500),
    /if \(TELAFI\.length\)[\s\S]{0,80}console\.warn\(/,
    'devredeki korumalar loga yazilmiyor',
  );
});
