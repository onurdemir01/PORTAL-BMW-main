// server/util/__tests__/nginx-red.test.cjs
//
// ORTAK CEVIRICI (2026-10-23): kurumsal nginx 403 / 404 / 5xx govdesini HTML ile degistirir.
//
//   NG1 403 / 404 `ok:false` -> 409 her yontemde; kod, asil durum, mesaj ve ayrinti
//   NG2 eylem5xx: GET disi isteklerde 501 -> 409, 502 / 503 / 504 -> 424; GET'te 5xx KALIR
//   NG3 dokunulmayanlar: 401, 500, eylem5xx kapaliyken 5xx, ok:false olmayan govde, metin
//   NG4 `haric` onekleri (baglandigi yola goreli) hic cevrilmez; onek siniri tam
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { nginxRedCevirici } = require('../nginx-red.cjs');

async function kur(secenek) {
  const app = express();
  app.use(nginxRedCevirici(secenek));
  app.all('/kod/:kod', (req, res) => {
    const kod = Number(req.params.kod);
    if (req.query.metin) return res.status(kod).send('duz metin');
    if (req.query.oksuz) return res.status(kod).json({ mesaj: 'ok alani yok' });
    const govde = { ok: false, message: `ret ${kod}`, ayrinti: { a: 1 } };
    if (req.query.kodlu) govde.code = 'cagiranin_kodu';
    return res.status(kod).json(govde);
  });
  const s = await new Promise((r) => {
    const x = app.listen(0, '127.0.0.1', () => r(x));
  });
  const url = `http://127.0.0.1:${s.address().port}`;
  return {
    istek: async (method, yol) => {
      const r = await fetch(url + yol, { method });
      const metin = await r.text();
      let json = null;
      try {
        json = JSON.parse(metin);
      } catch {
        // metin
      }
      return { status: r.status, json };
    },
    kapat: () => {
      s.closeAllConnections();
      s.close();
    },
  };
}

test('NG1 403 / 404 her yontemde 409; kod, asil durum, mesaj ve ayrinti korunur', async () => {
  const u = await kur({ onek: 'ornek' });
  try {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      let r = await u.istek(method, '/kod/403');
      assert.equal(r.status, 409, method);
      assert.deepEqual(r.json, {
        ok: false,
        message: 'ret 403',
        ayrinti: { a: 1 },
        code: 'ornek_forbidden',
        upstreamStatus: 403,
        nginxRed: true,
      });
      r = await u.istek(method, '/kod/404');
      assert.equal(r.status, 409, method);
      assert.equal(r.json.code, 'ornek_not_found');
      assert.equal(r.json.upstreamStatus, 404);
    }
    const k = await u.istek('POST', '/kod/403?kodlu=1');
    assert.equal(k.json.code, 'cagiranin_kodu', 'cagiranin kodu ezildi');
  } finally {
    u.kapat();
  }
});

test('NG2 eylem5xx: GET disinda 501 -> 409, 502 / 503 / 504 -> 424; GET te 5xx kalir', async () => {
  const u = await kur({ onek: 'ornek', eylem5xx: true });
  try {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const n = await u.istek(method, '/kod/501');
      assert.equal(n.status, 409, method);
      assert.equal(n.json.code, 'ornek_not_configured');
      assert.equal(n.json.upstreamStatus, 501);
      for (const kod of [502, 503, 504]) {
        const r = await u.istek(method, `/kod/${kod}`);
        assert.equal(r.status, 424, `${method} ${kod}`);
        assert.equal(r.json.code, 'ornek_upstream_unavailable');
        assert.equal(r.json.upstreamStatus, kod);
        assert.equal(r.json.message, `ret ${kod}`);
      }
    }
    for (const kod of [501, 502, 503, 504]) {
      const g = await u.istek('GET', `/kod/${kod}`);
      assert.equal(g.status, kod, `GET ${kod} cevrildi`);
      assert.equal(g.json.upstreamStatus, undefined);
    }
  } finally {
    u.kapat();
  }
});

test('NG3 401, 500, eylem5xx kapaliyken 5xx, ok:false olmayan ve metin govde DEGISMEZ', async () => {
  const kapali = await kur({ onek: 'ornek' });
  const acik = await kur({ onek: 'ornek', eylem5xx: true });
  try {
    for (const [u, method, yol, kod] of [
      [acik, 'POST', '/kod/401', 401],
      [acik, 'POST', '/kod/500', 500],
      [kapali, 'POST', '/kod/503', 503],
      [kapali, 'POST', '/kod/501', 501],
      [acik, 'POST', '/kod/403?oksuz=1', 403],
      [acik, 'POST', '/kod/503?oksuz=1', 503],
      [acik, 'POST', '/kod/404?metin=1', 404],
      [acik, 'GET', '/kod/200', 200],
    ]) {
      const r = await u.istek(method, yol);
      assert.equal(r.status, kod, `${method} ${yol}`);
      assert.equal(r.json?.upstreamStatus, undefined, `${method} ${yol}`);
    }
  } finally {
    kapali.kapat();
    acik.kapat();
  }
});

test('NG4 haric onekler cevrilmez; onek siniri tam', async () => {
  const app = express();
  app.use('/api', nginxRedCevirici({ onek: 'ornek', eylem5xx: true, haric: ['/opsx'] }));
  for (const yol of ['/api/opsx/x', '/api/opsx', '/api/opsxyz/x', '/api/diger/x'])
    app.post(yol, (req, res) => res.status(403).json({ ok: false, message: 'ret' }));
  const s = await new Promise((r) => {
    const x = app.listen(0, '127.0.0.1', () => r(x));
  });
  const url = `http://127.0.0.1:${s.address().port}`;
  try {
    for (const [yol, kod] of [
      ['/api/opsx/x', 403],
      ['/api/opsx', 403],
      ['/api/opsxyz/x', 409],
      ['/api/diger/x', 409],
    ]) {
      const r = await fetch(url + yol, { method: 'POST' });
      assert.equal(r.status, kod, yol);
    }
  } finally {
    s.closeAllConnections();
    s.close();
  }
});
