// server/audit/__tests__/response-cache.test.cjs — Denetim yanit onbellegi.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createResponseCache } = require('../response-cache.cjs');

function fakeRes() {
  const r = { statusCode: 200, headers: {}, sent: null, jsonBody: null };
  r.setHeader = (k, v) => {
    r.headers[k] = v;
  };
  r.status = (c) => {
    r.statusCode = c;
    return r;
  };
  r.send = (b) => {
    r.sent = b;
    return r;
  };
  r.json = (p) => {
    r.jsonBody = p;
    return r;
  };
  return r;
}

test('ilk istek MISS ve yaniti saklar; ikinci istek HIT (handler cagrilmaz); fresh=1 BYPASS; TTL dolunca MISS', async () => {
  const c = createResponseCache({ ttlMs: 50 });
  let calls = 0;
  const handler = (req, res) => {
    calls++;
    res.json({ ok: true, n: calls });
  };
  const run = (url) => {
    const req = {
      method: 'GET',
      originalUrl: url,
      query: Object.fromEntries(new URL('http://x' + url).searchParams),
    };
    const res = fakeRes();
    let nextCalled = false;
    c.middleware(req, res, () => {
      nextCalled = true;
      handler(req, res);
    });
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
  c.middleware(mk('/x'), res, () => {
    res.status(500).json({ ok: false, message: 'hata' });
  });
  assert.equal(c.store.size, 0);
  res = fakeRes();
  c.middleware(mk('/x'), res, () => res.json({ ok: false, message: 'yumusak hata' }));
  assert.equal(c.store.size, 0);
  let next = false;
  c.middleware(mk('/x', 'POST'), fakeRes(), () => {
    next = true;
  });
  assert.equal(next, true);
});

test('RC3 govde siniri asilinca SESSIZ DEGIL: baslik SKIP-SIZE, anahtar basina bir kez uyari, saklanmaz', () => {
  // Gercek SPA Kesfi dogrulama bulgusu (2026-10-01): 8 MB'i asan govde onbellege girmiyor ama
  // baslik 'MISS' kaliyordu - her acilis tum sorgulari kosturuyordu ve bu hic gorunmuyordu.
  const c = createResponseCache({ ttlMs: 1000, maxBodyBytes: 64 });
  const uyarilar = [];
  const eski = console.warn;
  console.warn = (m) => uyarilar.push(String(m));
  try {
    const kos = (url, payload) => {
      const res = fakeRes();
      c.middleware({ method: 'GET', originalUrl: url, query: {} }, res, () => res.json(payload));
      return res;
    };
    const buyuk = { ok: true, veri: 'x'.repeat(200) };
    const a = kos('/api/nginx-console/spa-discovery', buyuk);
    assert.equal(a.headers['X-Portal-Cache'], 'SKIP-SIZE', 'sinir asimi baslikta gorunmuyor');
    assert.deepEqual(a.jsonBody, buyuk, 'yanit yine gonderilmeli');
    assert.equal(c.store.size, 0, 'siniri asan govde saklandi');
    kos('/api/nginx-console/spa-discovery', buyuk);
    assert.equal(uyarilar.length, 1, 'ayni anahtar icin uyari tekrarlandi ya da hic yazilmadi');
    assert.match(uyarilar[0], /spa-discovery/);
    // Sinirin altindaki govde normal saklanir (baslik MISS).
    const k = kos('/kucuk', { ok: true });
    assert.equal(k.headers['X-Portal-Cache'], 'MISS');
    assert.equal(c.store.size, 1);
  } finally {
    console.warn = eski;
  }
});
