// server/scalex/__tests__/nginx-red-cevirici.test.cjs
//
// NGINX'IN YAKALADIGI REDLER (2026-10-23). Kurumsal nginx 403 / 404 / 5xx govdesini HTML
// sayfasiyla degistiriyor; ScaleX 403 / 404 JSON redlerini 409'a cevirir.
//
//   NR1 403 / 404 `ok:false` -> 409 + code + upstreamStatus; mesaj ve ret ayrintisi kalir;
//       cagiranin kendi `code`u korunur
//   NR2 dokunulmayanlar: 401, 5xx, 2xx, `ok:false` olmayan govde, JSON olmayan govde
//   NR3 ara katman ScaleX yonlendiricisinin ILK katmani (oturum / gorunurluk redleri dahil)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const { nginxRedCevirici } = require('../index.cjs');

async function uygulama(fn) {
  const app = express();
  app.use(nginxRedCevirici);
  fn(app);
  const s = await new Promise((r) => {
    const x = app.listen(0, '127.0.0.1', () => r(x));
  });
  const url = `http://127.0.0.1:${s.address().port}`;
  return {
    al: async (yol) => {
      const r = await fetch(url + yol);
      const metin = await r.text();
      let json = null;
      try {
        json = JSON.parse(metin);
      } catch {
        // JSON degil
      }
      return { status: r.status, json, metin };
    },
    kapat: () => {
      s.closeAllConnections();
      s.close();
    },
  };
}

test('NR1 403 / 404 JSON reddi 409 olur; mesaj, ayrinti ve cagiranin kodu korunur', async () => {
  const u = await uygulama((app) => {
    app.get('/yasak', (req, res) =>
      res
        .status(403)
        .json({
          ok: false,
          message: 'Bu namespace icin yetkiniz yok',
          restriction: { kaynak: 'ns' },
        }),
    );
    app.get('/yok', (req, res) =>
      res.status(404).json({ ok: false, message: 'Kayit bulunamadi.' }),
    );
    app.get('/kodlu', (req, res) =>
      res.status(403).json({ ok: false, message: 'x', code: 'ozel_kod' }),
    );
  });
  try {
    let r = await u.al('/yasak');
    assert.equal(r.status, 409);
    assert.deepEqual(r.json, {
      ok: false,
      message: 'Bu namespace icin yetkiniz yok',
      restriction: { kaynak: 'ns' },
      code: 'scalex_forbidden',
      upstreamStatus: 403,
      nginxRed: true,
    });
    r = await u.al('/yok');
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'scalex_not_found');
    assert.equal(r.json.upstreamStatus, 404);
    r = await u.al('/kodlu');
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'ozel_kod', 'cagiranin kodu ezildi');
    assert.equal(r.json.upstreamStatus, 403);
  } finally {
    u.kapat();
  }
});

test('NR2 401, 5xx, basari, ok:false olmayan ve JSON olmayan yanitlar DEGISMEZ', async () => {
  const u = await uygulama((app) => {
    app.get('/oturum', (req, res) => res.status(401).json({ ok: false, message: 'Oturum yok' }));
    app.get('/gecici', (req, res) => res.status(503).json({ ok: false, message: 'gecici' }));
    app.get('/hata', (req, res) => res.status(500).json({ ok: false, message: 'hata' }));
    app.get('/tamam', (req, res) => res.json({ ok: true }));
    app.get('/okyok', (req, res) => res.status(403).json({ mesaj: 'ok alani yok' }));
    app.get('/duz', (req, res) => res.status(404).send('duz metin'));
  });
  try {
    for (const [yol, kod] of [
      ['/oturum', 401],
      ['/gecici', 503],
      ['/hata', 500],
      ['/tamam', 200],
      ['/okyok', 403],
      ['/duz', 404],
    ]) {
      const r = await u.al(yol);
      assert.equal(r.status, kod, `${yol}: ${r.status}`);
      assert.equal(r.json?.upstreamStatus, undefined, `${yol}: govdeye upstreamStatus eklendi`);
    }
  } finally {
    u.kapat();
  }
});

test('NR3 ara katman ScaleX yonlendiricisinin ILK katmani', () => {
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  const bas = kaynak.indexOf('function initScaleX(app)');
  const ilk = kaynak.indexOf('router.use(', bas);
  assert.ok(bas > 0 && ilk > bas);
  assert.equal(
    kaynak.slice(ilk, ilk + 'router.use(nginxRedCevirici)'.length),
    'router.use(nginxRedCevirici)',
    'ilk ara katman cevirici degil: oturum / gorunurluk redleri HTML olarak dusebilir',
  );
});
