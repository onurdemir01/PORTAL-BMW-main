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
  const c = createResponseCache({ ttlMs: 50, staleMs: 0 });
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

// ── Tek ucus + bayat-iken-yenile (2026-11-12) ────────────────────────────────────────
const { EventEmitter } = require('node:events');
function evRes() {
  const r = fakeRes();
  const ee = new EventEmitter();
  r.once = ee.once.bind(ee);
  r.emit = ee.emit.bind(ee);
  return r;
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const getReq = (url) => ({
  method: 'GET',
  originalUrl: url,
  query: Object.fromEntries(new URL('http://x' + url).searchParams),
});

test('SF1 tek ucus: ayni anda gelen N kacirma handler-i BIR KEZ kosturur, hepsi ayni govdeyi alir', async () => {
  const c = createResponseCache({ ttlMs: 1000, staleMs: 0 });
  let calls = 0;
  let release;
  const gate = new Promise((r) => (release = r));
  const resler = [];
  for (let i = 0; i < 5; i++) {
    const res = evRes();
    resler.push(res);
    c.middleware(getReq('/api/denetim/nginx-spa'), res, async () => {
      calls++;
      await gate;
      res.json({ ok: true, n: calls });
    });
  }
  assert.equal(calls, 1, 'bekleyenler handler kosturmamali');
  release();
  await tick(5);
  assert.equal(calls, 1);
  assert.equal(resler[0].headers['X-Portal-Cache'], 'MISS');
  assert.deepEqual(resler[0].jsonBody, { ok: true, n: 1 });
  for (const r of resler.slice(1)) {
    assert.equal(r.headers['X-Portal-Cache'], 'SHARED');
    assert.deepEqual(JSON.parse(r.sent), { ok: true, n: 1 });
  }
  assert.equal(c.inflight.size, 0);
  assert.equal(c.store.size, 1);
});

test('SF2 tek ucus: ilk hesap hata / ok:false / json-suz kapanirsa bekleyenler handler-i kendileri kosturur', async () => {
  for (const kotu of ['500', 'okfalse', 'close']) {
    const c = createResponseCache({ ttlMs: 1000, staleMs: 0 });
    let calls = 0;
    let release;
    const gate = new Promise((r) => (release = r));
    const lider = evRes();
    c.middleware(getReq('/k'), lider, async () => {
      calls++;
      await gate;
      if (kotu === '500') lider.status(500).json({ ok: false, message: 'hata' });
      else if (kotu === 'okfalse') lider.json({ ok: false, message: 'yumusak' });
      else lider.emit('close');
    });
    const bekleyen = evRes();
    c.middleware(getReq('/k'), bekleyen, () => {
      calls++;
      bekleyen.json({ ok: true, kendi: true });
    });
    assert.equal(calls, 1);
    release();
    await tick(5);
    assert.equal(calls, 2, `${kotu}: bekleyen kendi hesabini kosturmali`);
    assert.equal(bekleyen.sent, null, `${kotu}: hata yaniti paylasilmamali`);
    assert.deepEqual(bekleyen.jsonBody, { ok: true, kendi: true });
    assert.equal(bekleyen.headers['X-Portal-Cache'], 'MISS');
    assert.equal(c.inflight.size, 0);
  }
});

test('SF3 tek ucus: fresh=1 ucusa katilmaz; clear() bekleyeni serbest birakir, eski hesap saklanmaz', async () => {
  const c = createResponseCache({ ttlMs: 1000, staleMs: 0 });
  let calls = 0;
  let release;
  const gate = new Promise((r) => (release = r));
  const lider = evRes();
  c.middleware(getReq('/k'), lider, async () => {
    calls++;
    await gate;
    lider.json({ ok: true, eski: true });
  });
  const fr = evRes();
  c.middleware(getReq('/k?fresh=1'), fr, async () => {
    calls++;
    await gate;
    fr.json({ ok: true, fresh: true });
  });
  assert.equal(calls, 2, 'fresh=1 beklememeli');
  assert.equal(fr.headers['X-Portal-Cache'], 'BYPASS');
  const bekleyen = evRes();
  c.middleware(getReq('/k'), bekleyen, () => {
    calls++;
    bekleyen.json({ ok: true, yeni: true });
  });
  assert.equal(calls, 2);
  c.clear();
  assert.equal(calls, 3, 'clear sonrasi bekleyen kendi hesabini kosturmali');
  assert.deepEqual(bekleyen.jsonBody, { ok: true, yeni: true });
  release();
  await tick(5);
  assert.deepEqual(lider.jsonBody, { ok: true, eski: true }, 'lider yine yanitini alir');
  assert.deepEqual(JSON.parse(c.store.get('/k').body), { ok: true, yeni: true }, 'clear oncesi hesap yazilmamali');
});

test('SF4 tek ucus: asili hesap inflightMaxMs sonra birakilir', async () => {
  const c = createResponseCache({ ttlMs: 1000, staleMs: 0, inflightMaxMs: 20 });
  let calls = 0;
  c.middleware(getReq('/k'), evRes(), () => {
    calls++;
  });
  const b = evRes();
  c.middleware(getReq('/k'), b, () => {
    calls++;
    b.json({ ok: true });
  });
  assert.equal(calls, 1);
  await tick(40);
  assert.equal(calls, 2);
  assert.deepEqual(b.jsonBody, { ok: true });
});

test('SWR1 bayat giris ANINDA STALE doner, arka planda tek yenileme olur, sonra HIT yeni veri', async () => {
  const c = createResponseCache({ ttlMs: 300, staleMs: 5000 });
  let calls = 0;
  let release = null;
  const run = (url) => {
    const res = evRes();
    c.middleware(getReq(url), res, async () => {
      calls++;
      const n = calls;
      if (n > 1) await new Promise((r) => (release = r));
      // Yanit gonderildikten sonra handler'in baslik / durum / send cagrilari patlamamali.
      res.setHeader('X-Extra', '1');
      res.status(200).json({ ok: true, n });
      res.send('ignored');
    });
    return res;
  };
  run('/k');
  assert.equal(calls, 1);
  await tick(320);
  const s1 = run('/k');
  assert.equal(s1.headers['X-Portal-Cache'], 'STALE');
  assert.deepEqual(JSON.parse(s1.sent), { ok: true, n: 1 });
  assert.equal(calls, 2, 'arka plan yenileme baslamali');
  const s2 = run('/k');
  assert.equal(s2.headers['X-Portal-Cache'], 'STALE');
  assert.equal(calls, 2, 'ikinci bayat istek ikinci yenileme baslatmamali');
  release();
  await tick(5);
  assert.equal(s1.jsonBody, null, 'yenileme ciktisi istemciye yazilmamali');
  assert.deepEqual(JSON.parse(s1.sent), { ok: true, n: 1 }, 'gonderilmis govde degismemeli');
  assert.equal(s1.headers['X-Extra'], undefined, 'gonderilmis yanita baslik yazilmamali');
  const h = run('/k');
  assert.equal(h.headers['X-Portal-Cache'], 'HIT');
  assert.deepEqual(JSON.parse(h.sent), { ok: true, n: 2 });
  assert.equal(c.inflight.size, 0);
});

test('SWR2 yenileme basarisizsa bayat giris korunur; fresh=1 bayati atlar; staleMs asilinca MISS', async () => {
  const uyarilar = [];
  const eski = console.warn;
  console.warn = (m) => uyarilar.push(String(m));
  try {
    const c = createResponseCache({ ttlMs: 10, staleMs: 60 });
    let mod = 'ok';
    let calls = 0;
    const run = (url) => {
      const res = evRes();
      c.middleware(getReq(url), res, () => {
        calls++;
        if (mod === 'ok') res.json({ ok: true, n: calls });
        else res.status(500).json({ ok: false, message: 'db yok' });
      });
      return res;
    };
    run('/k');
    await tick(20);
    mod = 'hata';
    const s = run('/k');
    assert.equal(s.headers['X-Portal-Cache'], 'STALE');
    assert.deepEqual(JSON.parse(c.store.get('/k').body), { ok: true, n: 1 }, 'bayat giris silinmemeli');
    assert.equal(uyarilar.length, 1);
    assert.doesNotMatch(uyarilar[0], /db yok/, 'hata govdesi loglanmamali');
    mod = 'ok';
    const f = run('/k?fresh=1');
    assert.equal(f.headers['X-Portal-Cache'], 'BYPASS');
    assert.deepEqual(f.jsonBody, { ok: true, n: 3 });
    await tick(90);
    const m = run('/k');
    assert.equal(m.headers['X-Portal-Cache'], 'MISS', 'staleMs asildi');
  } finally {
    console.warn = eski;
  }
});

test('SWR3 clear() bayat girisleri de siler', async () => {
  const c = createResponseCache({ ttlMs: 10, staleMs: 1000 });
  const res = evRes();
  c.middleware(getReq('/k'), res, () => res.json({ ok: true }));
  await tick(20);
  c.clear();
  const b = evRes();
  let ran = false;
  c.middleware(getReq('/k'), b, () => {
    ran = true;
    b.json({ ok: true });
  });
  assert.equal(b.headers['X-Portal-Cache'], 'MISS');
  assert.equal(ran, true);
});

test('SWR4 gercek Express + compression: STALE yanit sonrasi arka plan yenileme hata atmaz, tek ucus HTTP uzerinden calisir', async () => {
  const express = require('express');
  const compression = require('compression');
  const http = require('node:http');
  const c = createResponseCache({ ttlMs: 400, staleMs: 5000 });
  const app = express();
  app.use(compression());
  const hatalar = [];
  let calls = 0;
  let gecikme = 0;
  const router = express.Router();
  router.use((req, res, next) => c.middleware(req, res, next));
  router.get('/veri', async (req, res) => {
    calls++;
    const n = calls;
    await tick(gecikme);
    try {
      res.setHeader('X-Handler', String(n));
      res.status(200).json({ ok: true, n, kim: req.headers['x-kim'] || null });
    } catch (e) {
      hatalar.push(e.code || e.message);
    }
  });
  app.use('/api/denetim', router);
  app.use((err, _req, _res, next) => {
    hatalar.push(err.code || err.message);
    next(err);
  });
  const srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/api/denetim/veri`;
  const al = async () => {
    const r = await fetch(base);
    return { tag: r.headers.get('x-portal-cache'), body: await r.json() };
  };
  try {
    gecikme = 30;
    const ilk = await Promise.all([al(), al(), al()]);
    assert.equal(calls, 1, 'ayni anda gelen 3 istek tek hesap');
    assert.deepEqual(ilk.map((x) => x.tag).sort(), ['MISS', 'SHARED', 'SHARED']);
    for (const x of ilk) assert.equal(x.body.n, 1);
    await tick(450);
    const s = await al();
    assert.equal(s.tag, 'STALE');
    assert.equal(s.body.n, 1);
    for (let i = 0; i < 40 && !c.store.get('/api/denetim/veri').body.includes('"n":2'); i++) await tick(10);
    assert.equal(calls, 2, 'arka plan yenileme kostu');
    const h = await al();
    assert.equal(h.tag, 'HIT');
    assert.equal(h.body.n, 2);
    assert.deepEqual(hatalar, [], 'yanit sonrasi handler cagrilari hata uretmemeli');
  } finally {
    await new Promise((r) => srv.close(r));
  }
});
