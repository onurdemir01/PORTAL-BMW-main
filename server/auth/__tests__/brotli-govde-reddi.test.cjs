// server/auth/__tests__/brotli-govde-reddi.test.cjs — CVE-2026-111497 (Node Brotli cozucusu, RCE) onlemi.
//
// Node 2026-10-21 guvenlik yayini; sunucuda Node v20.20.2 (20.x omrunu doldurdu, yama almadi). Express 5
// govde ayristiricisi `Content-Encoding: br` govdeyi Brotli ile aciyor ve express.json() oturum kontrolunden
// ONCE kosuyor. Kilitler:
//   BR1 GERCEK createApp: `br` (ve `gzip, br`) govde 415 alir, route HIC calismaz, govde ayristirilmaz
//   BR2 gzip ve sikistirmasiz govde ESKISI GIBI ayristirilir (davranis degismedi)
//   BR3 ara katman service.cjs'te express.json'dan ve tum route'lardan ONCE baglaniyor
//   BR4 kodlama ayristirma: buyuk/kucuk harf, bosluk, liste; "brx" gibi benzer adlar br sayilmaz
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const { createApp } = require('../../service.cjs');
const { brotliKodlamasi } = require('../brotli-govde-reddi.cjs');

async function sunucu() {
  const app = createApp();
  const cagri = [];
  app.post('/api/deneme', (req, res) => {
    cagri.push(req.body);
    res.json({ ok: true, body: req.body });
  });
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  return { url: `http://127.0.0.1:${s.address().port}`, cagri, kapat: () => new Promise((r) => s.close(r)) };
}

test('BR1 + BR2 gercek createApp: br govde reddedilir, gzip / duz govde eskisi gibi', async () => {
  const { url, cagri, kapat } = await sunucu();
  const json = JSON.stringify({ a: 1 });
  try {
    for (const kodlama of ['br', 'gzip, br', ' BR ']) {
      const r = await fetch(`${url}/api/deneme`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-encoding': kodlama },
        body: zlib.brotliCompressSync(Buffer.from(json)),
      });
      assert.equal(r.status, 415, `${kodlama}: 415 beklenir`);
      const g = await r.json();
      assert.match(g.message, /Brotli/);
    }
    assert.equal(cagri.length, 0, 'Brotli govdeli istek route a ULASMAMALI');
    const gz = await fetch(`${url}/api/deneme`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      body: zlib.gzipSync(Buffer.from(json)),
    });
    assert.equal(gz.status, 200);
    assert.deepEqual((await gz.json()).body, { a: 1 });
    const duz = await fetch(`${url}/api/deneme`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: json });
    assert.equal(duz.status, 200);
    assert.deepEqual((await duz.json()).body, { a: 1 });
    assert.equal(cagri.length, 2);
  } finally {
    await kapat();
  }
});

test('BR3 service.cjs: ara katman express.json ve tum route lardan ONCE', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'service.cjs'), 'utf8');
  const i = src.indexOf('app.use(brotliGovdeReddi());');
  assert.ok(i > 0, 'brotliGovdeReddi baglanmamis');
  for (const sonra of ['app.use(express.json(', 'app.use(compression());', 'app.use("/api", (req, res, next) => {']) {
    const j = src.indexOf(sonra);
    assert.ok(j > i, `${sonra} brotliGovdeReddi'den once geliyor`);
  }
});

test('BR4 kodlama ayristirma', () => {
  for (const v of ['br', 'BR', ' br ', 'gzip, br', 'br,gzip', 'identity, br']) assert.equal(brotliKodlamasi(v), true, v);
  for (const v of [undefined, '', 'gzip', 'deflate', 'identity', 'brx', 'xbr', 'gzip, deflate']) assert.equal(brotliKodlamasi(v), false, String(v));
});
