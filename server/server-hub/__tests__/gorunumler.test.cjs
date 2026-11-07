// server/server-hub/__tests__/gorunumler.test.cjs - Server Hub ortak kayitli gorunumleri (2026-11-07).
//
//   G1 dogrulama: ekran / ad / islec / anahtar / deger / siralama / kolon / boyut beyaz listesi;
//      bilinmeyen alanlar atilir (gorunum ekrana yeniden basilir)
//   G2 okuma: bozuk satir atlanir, digerleri gelir; DB hatasi okunamadi (ekran dusmez)
//   G3 uclar: GET (400 gecersiz ekran), PUT (200 + denetim, 400, sinir 400, depo 424), DELETE (409 yok, 424)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');

function stub(rel, exports) {
  const p = require.resolve(rel);
  const m = new Module(p);
  m.filename = p;
  m.loaded = true;
  m.exports = exports;
  require.cache[p] = m;
}
const N = (s) => String(s).replace(/\s+/g, ' ').trim();
const D = { satirlar: [], dus: false, yazDus: null, silinen: 0, sorgular: [] };
stub('../../db/index.cjs', {
  query: async (sql, p = []) => {
    const s = N(sql);
    D.sorgular.push([s.slice(0, 40), p]);
    if (s.startsWith('SELECT ad, gorunum, kaydeden, zaman FROM server_hub_gorunumler')) {
      if (D.dus) throw new Error('baglanti yok');
      return { rows: D.satirlar.filter((r) => r.ekran === p[0]) };
    }
    if (s.startsWith('SET XACT_ABORT ON;') && s.includes('server_hub_gorunumler')) {
      if (D.yazDus) throw new Error(D.yazDus);
      const [ekran, ad, gorunum, kaydeden] = p;
      const i = D.satirlar.findIndex((r) => r.ekran === ekran && r.ad === ad);
      const r = { ekran, ad, gorunum, kaydeden, zaman: new Date('2026-11-07T10:00:00Z') };
      if (i >= 0) D.satirlar[i] = r;
      else D.satirlar.push(r);
      return { rows: [{ tamam: 1 }] };
    }
    if (s.startsWith('DELETE FROM server_hub_gorunumler')) {
      if (D.dus) throw new Error('baglanti yok');
      const once = D.satirlar.length;
      D.satirlar = D.satirlar.filter((r) => !(r.ekran === p[0] && r.ad === p[1]));
      return { rows: once === D.satirlar.length ? [] : [{ ad: p[1] }] };
    }
    throw new Error(`sahte DB bilinmeyen SQL: ${s.slice(0, 80)}`);
  },
});

const { gorunumDogrula, oku, mount, EKRANLAR } = require('../gorunumler.cjs');

const sifirla = () => Object.assign(D, { satirlar: [], dus: false, yazDus: null, sorgular: [] });

test('G1 dogrulama: beyaz liste, bilinmeyen alanlar atilir', () => {
  const g = gorunumDogrula({
    f: [
      { k: 'onem', op: 'in', v: ['danger'], fazla: 'x' },
      { k: 'islem', op: 'evet' },
    ],
    s: 'kod:desc',
    kolonlar: ['host', 'kod'],
    html: '<b>x</b>',
  });
  assert.deepEqual(g, {
    f: [
      { k: 'onem', op: 'in', v: ['danger'] },
      { k: 'islem', op: 'evet' },
    ],
    s: 'kod:desc',
    kolonlar: ['host', 'kod'],
  });
  assert.deepEqual(gorunumDogrula({ f: [] }), { f: [], s: '' });
  const kotu = [
    null,
    { f: 'x' },
    { f: Array.from({ length: 31 }, () => ({ k: 'a', op: 'in' })) },
    { f: [{ k: 'a b', op: 'in' }] },
    { f: [{ k: 'a', op: 'drop' }] },
    { f: [{ k: 'a', op: 'in', v: [{ x: 1 }] }] },
    { f: [{ k: 'a', op: 'in', v: Array.from({ length: 201 }, (_, i) => i) }] },
    { f: [{ k: 'a', op: 'icerir', v: 'x'.repeat(201) }] },
    { f: [], s: 'kod; DROP' },
    { f: [], kolonlar: ['ok', 'kotu kolon'] },
    { f: [], kolonlar: 'host' },
    {
      f: Array.from({ length: 30 }, (_, i) => ({
        k: `k${i}`,
        op: 'in',
        v: Array.from({ length: 50 }, () => 'x'.repeat(10)),
      })),
    },
  ];
  for (const g2 of kotu)
    assert.throws(
      () => gorunumDogrula(g2),
      (e) => e.status === 400,
      JSON.stringify(g2).slice(0, 80),
    );
  assert.deepEqual(EKRANLAR, [
    'server-hub-bulgular',
    'server-hub-sunucular',
    'uygulama-360',
    'retirement-etiketleri',
  ]);
});

test('G2 okuma: bozuk satir atlanir; DB hatasi okunamadi', async () => {
  sifirla();
  D.satirlar = [
    {
      ekran: 'server-hub-bulgular',
      ad: 'iyi',
      gorunum: JSON.stringify({ f: [{ k: 'onem', op: 'in', v: ['danger'] }], s: '' }),
      kaydeden: 'ayse',
      zaman: new Date('2026-11-07T08:00:00Z'),
    },
    { ekran: 'server-hub-bulgular', ad: 'bozuk', gorunum: '{x', kaydeden: 'ayse', zaman: null },
    {
      ekran: 'server-hub-bulgular',
      ad: 'zararli',
      gorunum: JSON.stringify({ f: [{ k: 'a', op: 'eval' }] }),
      kaydeden: 'x',
      zaman: null,
    },
    {
      ekran: 'uygulama-360',
      ad: 'baska',
      gorunum: JSON.stringify({ f: [] }),
      kaydeden: 'x',
      zaman: null,
    },
  ];
  const r = await oku('server-hub-bulgular');
  assert.deepEqual(r, {
    okunamadi: false,
    gorunumler: [
      {
        ad: 'iyi',
        f: [{ k: 'onem', op: 'in', v: ['danger'] }],
        s: '',
        kaydeden: 'ayse',
        zaman: '2026-11-07T08:00:00.000Z',
      },
    ],
  });
  D.dus = true;
  assert.deepEqual(await oku('server-hub-bulgular'), { okunamadi: true, gorunumler: [] });
});

test('G3 uclar: GET / PUT / DELETE, durum kodlari, denetim', async () => {
  sifirla();
  const denetim = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { user: { role: 'Admin', username: 'ayse' } };
    next();
  });
  const router = express.Router();
  mount(router, { audit: (_req, d) => denetim.push(d) });
  app.use('/api/server-hub', router);
  const srv = await new Promise((res) => {
    const s = app.listen(0, '127.0.0.1', () => res(s));
  });
  const kok = `http://127.0.0.1:${srv.address().port}/api/server-hub`;
  const J = async (r) => ({ status: r.status, body: await r.json() });
  const put = (b) =>
    fetch(`${kok}/gorunumler`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(b),
    }).then(J);
  const sil = (ekran, ad) =>
    fetch(`${kok}/gorunumler?ekran=${encodeURIComponent(ekran)}&ad=${encodeURIComponent(ad)}`, {
      method: 'DELETE',
    }).then(J);
  try {
    assert.equal((await fetch(`${kok}/gorunumler?ekran=baska`).then(J)).status, 400);
    let r = await fetch(`${kok}/gorunumler?ekran=server-hub-bulgular`).then(J);
    assert.deepEqual([r.status, r.body.okunamadi, r.body.gorunumler], [200, false, []]);
    r = await put({
      ekran: 'server-hub-bulgular',
      ad: '  Prod JVM  ',
      gorunum: { f: [{ k: 'ortam', op: 'in', v: ['PROD'] }], s: 'host:asc' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(
      r.body.gorunumler.map((g) => [g.ad, g.kaydeden, g.s]),
      [['Prod JVM', 'ayse', 'host:asc']],
    );
    assert.deepEqual(denetim, [
      { op: 'gorunum_kaydet', ekran: 'server-hub-bulgular', ad: 'Prod JVM', suzgec: 1 },
    ]);
    // Ayni ad guncellenir (iki satir olmaz).
    r = await put({ ekran: 'server-hub-bulgular', ad: 'Prod JVM', gorunum: { f: [] } });
    assert.deepEqual(
      r.body.gorunumler.map((g) => [g.ad, g.f.length]),
      [['Prod JVM', 0]],
    );
    for (const b of [
      { ekran: 'yok', ad: 'a', gorunum: { f: [] } },
      { ekran: 'server-hub-bulgular', ad: '', gorunum: { f: [] } },
      { ekran: 'server-hub-bulgular', ad: 'x'.repeat(61), gorunum: { f: [] } },
      { ekran: 'server-hub-bulgular', ad: 'a', gorunum: { f: [{ k: 'a', op: 'yok' }] } },
    ])
      assert.equal((await put(b)).status, 400, JSON.stringify(b).slice(0, 60));
    D.yazDus = 'Bu ekranda en çok 50 ortak görünüm olabilir.';
    r = await put({ ekran: 'server-hub-bulgular', ad: 'yeni', gorunum: { f: [] } });
    assert.deepEqual(
      [r.status, r.body.message],
      [400, 'Bu ekranda en çok 50 ortak görünüm olabilir.'],
    );
    D.yazDus = 'Timeout';
    assert.equal(
      (await put({ ekran: 'server-hub-bulgular', ad: 'yeni', gorunum: { f: [] } })).status,
      424,
    );
    D.yazDus = null;
    assert.equal((await sil('server-hub-bulgular', 'olmayan')).status, 409);
    r = await sil('server-hub-bulgular', 'Prod JVM');
    assert.deepEqual([r.status, r.body.gorunumler], [200, []]);
    assert.deepEqual(denetim.at(-1), {
      op: 'gorunum_sil',
      ekran: 'server-hub-bulgular',
      ad: 'Prod JVM',
    });
    assert.equal((await sil('yok', 'a')).status, 400);
    D.dus = true;
    assert.equal((await sil('server-hub-bulgular', 'a')).status, 424);
    r = await fetch(`${kok}/gorunumler?ekran=server-hub-bulgular`).then(J);
    assert.deepEqual([r.status, r.body.okunamadi], [200, true], 'okunamayan liste ekrani dusurmez');
  } finally {
    srv.close();
  }
});
