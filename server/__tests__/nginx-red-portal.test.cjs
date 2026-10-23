// server/__tests__/nginx-red-portal.test.cjs
//
// PORTAL GENELINDE NGINX'IN YAKALADIGI REDLER (2026-10-23). Kurumsal nginx 403 / 404 / 5xx
// govdesini HTML sayfasiyla degistiriyor; gercek `createApp` /api altindaki redleri cevirir.
//
//   NP1 /api altinda `ok:false` 403 / 404 -> 409 + asil kod; GET disi 503 -> 424; GET 503 kalir
//   NP2 HARIC yollar (retirement / server-hub / nginx-console / nginx-cis kapsam disi) eskisi
//       gibi; onek siniri (`/retirementx` haric DEGIL)
//   NP5 OpsX DAHIL (2026-10-23): 403 / 404 -> 409, eylemde 503 -> 424, GET 503 kalir
//   NP3 modulun kendi cevirici katmani (ScaleX / LogX gibi) ONCELIKLI: cift cevrim yok
//   NP4 /api disi yollara dokunulmaz
'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { createApp } = require('../service.cjs');
const { nginxRedCevirici } = require('../util/nginx-red.cjs');

const sunucular = [];
after(() => sunucular.forEach((s) => (s.closeAllConnections(), s.close())));

async function kur() {
  const app = createApp();
  const red = (kod) => (req, res) => res.status(kod).json({ ok: false, message: `ret ${kod}` });
  for (const onek of [
    '/api/ornek',
    '/api/opsx',
    '/api/retirement',
    '/api/server-hub',
    '/api/nginx-console',
    '/api/nginx-cis',
    '/api/opsxyz',
    '/api/retirementx',
  ]) {
    app.get(`${onek}/yasak`, red(403));
    app.get(`${onek}/yok`, red(404));
    app.get(`${onek}/awx`, red(503));
    app.post(`${onek}/awx`, red(503));
  }
  const ic = express.Router();
  ic.use(nginxRedCevirici({ onek: 'ic' }));
  ic.get('/yasak', red(403));
  app.use('/api/icmodul', ic);
  app.get('/disari/yasak', red(403));
  const s = await new Promise((r) => {
    const x = app.listen(0, '127.0.0.1', () => r(x));
  });
  sunucular.push(s);
  const url = `http://127.0.0.1:${s.address().port}`;
  return async (method, yol) => {
    const r = await fetch(url + yol, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : '{}',
    });
    const metin = await r.text();
    let json = null;
    try {
      json = JSON.parse(metin);
    } catch {
      // json degil
    }
    return { status: r.status, json };
  };
}

test('NP1 /api altinda 403 / 404 -> 409, eylemde 503 -> 424, GET 503 kalir', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const istek = await kur();
  let r = await istek('GET', '/api/ornek/yasak');
  assert.equal(r.status, 409);
  assert.deepEqual(r.json, {
    ok: false,
    message: 'ret 403',
    code: 'portal_forbidden',
    upstreamStatus: 403,
    nginxRed: true,
  });
  r = await istek('GET', '/api/ornek/yok');
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'portal_not_found');
  r = await istek('POST', '/api/ornek/awx');
  assert.equal(r.status, 424);
  assert.equal(r.json.code, 'portal_upstream_unavailable');
  assert.equal(r.json.upstreamStatus, 503);
  assert.equal(r.json.message, 'ret 503');
  r = await istek('GET', '/api/ornek/awx');
  assert.equal(r.status, 503, 'GET 5xx cevrildi: yoklayici gecici hatayi tanimaz');
});

test('NP2 haric yollar eskisi gibi; onek siniri dogru', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const istek = await kur();
  for (const onek of [
    '/api/retirement',
    '/api/server-hub',
    '/api/nginx-console',
    '/api/nginx-cis',
  ]) {
    assert.equal((await istek('GET', `${onek}/yasak`)).status, 403, `${onek} cevrildi`);
    assert.equal((await istek('GET', `${onek}/yok`)).status, 404, `${onek} cevrildi`);
    assert.equal((await istek('POST', `${onek}/awx`)).status, 503, `${onek} cevrildi`);
  }
  const r = await istek('GET', '/api/retirementx/yasak');
  assert.equal(r.status, 409, '/retirementx haric tutuldu: onek siniri yanlis');
});

test('NP5 OpsX dahil: 403 / 404 -> 409, eylemde 503 -> 424, GET 503 kalir', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const istek = await kur();
  let r = await istek('GET', '/api/opsx/yasak');
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'portal_forbidden');
  assert.equal(r.json.upstreamStatus, 403);
  assert.equal(r.json.nginxRed, true);
  r = await istek('GET', '/api/opsx/yok');
  assert.equal(r.status, 409);
  assert.equal(r.json.upstreamStatus, 404);
  r = await istek('POST', '/api/opsx/awx');
  assert.equal(r.status, 424);
  assert.equal(r.json.upstreamStatus, 503);
  assert.equal((await istek('GET', '/api/opsx/awx')).status, 503, 'OpsX yoklamasinin gecici hatasi cevrildi');
});

test('NP3 modulun kendi cevirici katmani oncelikli; cift cevrim yok', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const istek = await kur();
  const r = await istek('GET', '/api/icmodul/yasak');
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'ic_forbidden');
  assert.equal(r.json.upstreamStatus, 403);
});

test('NP4 /api disi yollara dokunulmaz', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const istek = await kur();
  assert.equal((await istek('GET', '/disari/yasak')).status, 403);
});
