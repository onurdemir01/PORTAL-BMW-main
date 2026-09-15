// server/audit/__tests__/response-cache.test.cjs — Denetim yanit onbellegi.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createResponseCache } = require('../response-cache.cjs');

function fakeRes() {
  const r = { statusCode: 200, headers: {}, sent: null, jsonBody: null };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.send = (b) => { r.sent = b; return r; };
  r.json = (p) => { r.jsonBody = p; return r; };
  return r;
}

test('ilk istek MISS ve yaniti saklar; ikinci istek HIT (handler cagrilmaz); fresh=1 BYPASS; TTL dolunca MISS', async () => {
  const c = createResponseCache({ ttlMs: 50 });
  let calls = 0;
  const handler = (req, res) => { calls++; res.json({ ok: true, n: calls }); };
  const run = (url) => {
    const req = { method: 'GET', originalUrl: url, query: Object.fromEntries(new URL('http://x' + url).searchParams) };
    const res = fakeRes();
    let nextCalled = false;
    c.middleware(req, res, () => { nextCalled = true; handler(req, res); });
    return { res, nextCalled };
  };
  let a = run('/api/denetim/nginx-spa');
  assert.equal(a.res.headers['X-Portal-Cache'], 'MISS');
  assert.equal(calls, 1);
  let b = run('/api/denetim/nginx-spa');
  assert.equal(b.res.headers['X-Portal-Cache'], 'HIT');
  assert.equal(b.nextCalled, false, 'HIT: handler kosmamali');
  assert.deepEqual(JSON.parse(b.res.sent), { ok: true, n: 1 });
  let f = run('/api/denetim/nginx-spa?fresh=1');
  assert.equal(f.res.headers['X-Portal-Cache'], 'BYPASS');
  assert.equal(calls, 2);
  // fresh sonrasi onbellek YENILENMIS olmali (n=2)
  let d = run('/api/denetim/nginx-spa');
  assert.deepEqual(JSON.parse(d.res.sent), { ok: true, n: 2 });
  // farkli sorgu dizesi ayri anahtar
  let e = run('/api/denetim/nginx-spa?scanDate=2026-09-14');
  assert.equal(e.res.headers['X-Portal-Cache'], 'MISS');
  await new Promise((r) => setTimeout(r, 70));
  let g = run('/api/denetim/nginx-spa');
  assert.equal(g.res.headers['X-Portal-Cache'], 'MISS', 'TTL doldu');
});

test('ok:false ve 200 disi yanitlar onbellege GIRMEZ; GET disi dokunulmaz', () => {
  const c = createResponseCache({ ttlMs: 1000 });
  const mk = (url, method = 'GET') => ({ method, originalUrl: url, query: {} });
  let res = fakeRes();
  c.middleware(mk('/x'), res, () => { res.status(500).json({ ok: false, message: 'hata' }); });
  assert.equal(c.store.size, 0);
  res = fakeRes();
  c.middleware(mk('/x'), res, () => res.json({ ok: false, message: 'yumusak hata' }));
  assert.equal(c.store.size, 0);
  let next = false;
  c.middleware(mk('/x', 'POST'), fakeRes(), () => { next = true; });
  assert.equal(next, true);
});
