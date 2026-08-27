// Sekme ikonunun "acilista bir an eski/varsayilan gorunup degismesi" davranisina
// karsi eklenen surumleme. Gercek express uygulamasi ayaga kaldirilip HTTP ile
// olculur - basliklarin ve enjeksiyonun dogrulugu ancak boyle dogrulanabilir.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const branding = require('../branding.cjs');

function listen(app) {
  return new Promise((resolve) => {
    const srv = http.createServer(app);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

// DB yok: getSlot hata firlatir -> gomulu varsayilan servis edilir. Testin amaci
// zaten baslik/surum davranisi, hangi goruntunun dondugu degil.
test('surum bilgisi URL-guvenli ve sabit', () => {
  const v = branding.faviconVersion();
  assert.match(v, /^[A-Za-z0-9]+$/, 'tirnak/ozel karakter icermemeli: ' + v);
  assert.strictEqual(v, branding.faviconVersion(), 'ayni icerik icin degismemeli');
});

test('?v YOKSA eski davranis: her seferinde dogrula', async () => {
  const app = express();
  branding.initBranding(app);
  const srv = await listen(app);
  try {
    const r = await get(srv.address().port, '/api/branding/favicon');
    assert.strictEqual(r.status, 200);
    assert.match(r.headers['cache-control'], /no-cache/);
    assert.ok(r.headers.etag, 'ETag gonderilmeli');
  } finally { srv.close(); }
});

test('?v VARSA uzun sureli/immutable onbellek - tarayici bir daha istemez', async () => {
  const app = express();
  branding.initBranding(app);
  const srv = await listen(app);
  try {
    const v = branding.faviconVersion();
    const r = await get(srv.address().port, `/api/branding/favicon?v=${v}`);
    assert.strictEqual(r.status, 200);
    assert.match(r.headers['cache-control'], /immutable/);
    assert.match(r.headers['cache-control'], /max-age=31536000/);
  } finally { srv.close(); }
});

test('ETag hala calisiyor (304)', async () => {
  const app = express();
  branding.initBranding(app);
  const srv = await listen(app);
  try {
    const first = await get(srv.address().port, '/api/branding/favicon');
    const again = await get(srv.address().port, '/api/branding/favicon', {
      'if-none-match': first.headers.etag,
    });
    assert.strictEqual(again.status, 304);
  } finally { srv.close(); }
});

test('guvenlik basliklari korundu', async () => {
  const app = express();
  branding.initBranding(app);
  const srv = await listen(app);
  try {
    const r = await get(srv.address().port, '/api/branding/favicon?v=x');
    assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
    assert.match(r.headers['content-security-policy'], /default-src 'none'/);
  } finally { srv.close(); }
});
