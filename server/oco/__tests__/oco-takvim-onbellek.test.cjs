// server/oco/__tests__/oco-takvim-onbellek.test.cjs - OCO Takvimi hiz isi (2026-11-13).
//
// Kullanici: "OCO Takvimi sayfasi da gec aciliyor 3-4 saniye suruyor" (SlowQuery'de yok:
// sure dis HTTP). Bekciler:
// T1 tek-ucus: esanli istekler tek cekim paylasir.
// T2 SWR: bayat deger ANINDA doner (stale), arka planda tek yenileme; sonraki istek yeniyi alir.
// T3 hata: arka plan yenilemesi duserse onceki iyi deger korunur.
// T4 refresh: taze cekimi bekler.
// T5 enEskiMs asilinca bayat deger donmez, cekim beklenir.
// T5b "eksik" sonuc kisa sure taze sayilir.
// T5c isitma: sessiz donemde tur atlanir; yapilandirilmamissa calismaz.
// T6 paralel sayfa: skip seti, esanlilik siniri, bos sayfada durma, MAX_PAGES/truncated.
// T7 kalici dispatcher: ayni anahtar ayni nesne; proxy/CA degisince eskisi kapatilir.
// T8 uc: Server-Timing basligi ve stale bayragi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.OCO_API_URL = process.env.OCO_API_URL || 'https://ornek-servis';
const { createTakvimOnbellek } = require('../takvim-onbellek.cjs');
const search = require('../search.cjs');

const quiet = { warn() {} };
const bekle = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function saat(bas = 1_000_000) {
  let t = bas;
  const now = () => t;
  now.ileri = (ms) => {
    t += ms;
  };
  return now;
}

test('T1 tek-ucus: 3 esanli get -> fetch 1 kez', async () => {
  let n = 0;
  const c = createTakvimOnbellek({
    fetch: async () => {
      n += 1;
      await bekle(10);
      return { ok: true, n, eksik: [] };
    },
    log: quiet,
  });
  const r = await Promise.all([c.get({ group: '6203' }), c.get({ group: '6203' }), c.get({ group: '6203' })]);
  assert.equal(n, 1, 'esanli istekler ayri cekim yapti');
  assert.deepEqual(r.map((x) => x.value.n), [1, 1, 1]);
  assert.equal((await c.get({ group: '6203' })).cache, 'hit');
  assert.equal(n, 1);
});

test('T2 SWR: bayat deger aninda doner, arka planda tek yenileme', async () => {
  const now = saat();
  let n = 0;
  let birak;
  const c = createTakvimOnbellek({
    now,
    tazeMs: 1000,
    enEskiMs: 10_000,
    log: quiet,
    fetch: async () => {
      n += 1;
      if (n > 1) await new Promise((r) => (birak = r));
      return { ok: true, n, eksik: [] };
    },
  });
  await c.get({ group: 'g' });
  now.ileri(1001);
  const a = await c.get({ group: 'g' });
  assert.equal(a.cache, 'stale');
  assert.equal(a.value.n, 1, 'bayat deger aninda donmedi');
  const b = await c.get({ group: 'g' });
  assert.equal(b.cache, 'stale');
  assert.equal(n, 2, 'arka plan yenilemesi tek-ucus degil');
  birak();
  await bekle(1);
  const d = await c.get({ group: 'g' });
  assert.equal(d.cache, 'hit');
  assert.equal(d.value.n, 2);
});

test('T3 arka plan hatasi onceki iyi degeri silmez', async () => {
  const now = saat();
  let n = 0;
  const uyarilar = [];
  const c = createTakvimOnbellek({
    now,
    tazeMs: 1000,
    log: { warn: (m) => uyarilar.push(m) },
    fetch: async () => {
      n += 1;
      if (n > 1) throw new Error('servis kapali');
      return { ok: true, n, eksik: [] };
    },
  });
  await c.get({ group: 'g' });
  now.ileri(2000);
  assert.equal((await c.get({ group: 'g' })).value.n, 1);
  await bekle(1);
  const r = await c.get({ group: 'g' });
  assert.equal(r.value.n, 1, 'hata onceki degeri sildi');
  assert.equal(r.cache, 'stale');
  assert.ok(uyarilar.some((u) => /servis kapali/.test(u)), 'arka plan hatasi loglanmadi');
  // Bekleyen istek (refresh) hatayi gorur; deger yine korunur.
  await assert.rejects(c.get({ group: 'g', refresh: true }), /servis kapali/);
  assert.equal((await c.get({ group: 'g' })).value.n, 1);
});

test('T4 refresh taze cekimi bekler; ucustaki cekim varsa onu paylasir', async () => {
  let n = 0;
  const c = createTakvimOnbellek({
    log: quiet,
    fetch: async () => {
      n += 1;
      await bekle(5);
      return { ok: true, n, eksik: [] };
    },
  });
  await c.get({ group: 'g' });
  const r = await c.get({ group: 'g', refresh: true });
  assert.equal(r.value.n, 2);
  assert.equal(r.cache, 'miss');
  const [x, y] = await Promise.all([c.get({ group: 'g', refresh: true }), c.get({ group: 'g', refresh: true })]);
  assert.equal(n, 3);
  assert.equal(x.value.n, y.value.n);
});

test('T5 enEskiMs asilinca bayat deger donmez, cekim beklenir', async () => {
  const now = saat();
  let n = 0;
  const c = createTakvimOnbellek({ now, tazeMs: 1000, enEskiMs: 5000, log: quiet, fetch: async () => ({ ok: true, n: ++n, eksik: [] }) });
  await c.get({ group: 'g' });
  now.ileri(5001);
  const r = await c.get({ group: 'g' });
  assert.equal(r.cache, 'miss');
  assert.equal(r.value.n, 2);
});

test('T5b eksik (bir rol dustu) sonuc tazeMs yerine kisa sure taze sayilir', async () => {
  const now = saat();
  let n = 0;
  const c = createTakvimOnbellek({
    now,
    tazeMs: 300_000,
    eksikTazeMs: 60_000,
    log: quiet,
    fetch: async () => ({ ok: true, n: ++n, eksik: n === 1 ? [{ rol: 'acan', message: 'x' }] : [] }),
  });
  await c.get({ group: 'g' });
  now.ileri(30_000);
  assert.equal((await c.get({ group: 'g' })).cache, 'hit');
  now.ileri(31_000);
  assert.equal((await c.get({ group: 'g' })).cache, 'stale', 'eksik sonuc 5 dk taze tutuldu');
  await bekle(1);
  now.ileri(100_000);
  assert.equal((await c.get({ group: 'g' })).cache, 'hit', 'tam sonuc tazeMs boyunca taze olmali');
});

test('T5c isitma turu: istek yoksa ya da yapilandirilmamissa cekmez', async () => {
  const now = saat();
  let n = 0;
  const c = createTakvimOnbellek({ now, log: quiet, fetch: async () => ({ ok: true, n: ++n, eksik: [] }) });
  assert.equal(await c.isitTuru({ group: 'g' }), false, 'hic istek yokken isitti');
  await c.get({ group: 'g' });
  assert.equal(await c.isitTuru({ group: 'g', isConfigured: () => false }), false);
  assert.equal(await c.isitTuru({ group: 'g' }), true);
  assert.equal(n, 2);
  now.ileri(2 * 60 * 60 * 1000 + 1);
  assert.equal(await c.isitTuru({ group: 'g' }), false, 'gece (2 saat sessiz) upstream yuklendi');
  assert.equal(c.isit({ group: 'g', araMs: 60_000 }), true);
  assert.equal(c.isit({ group: 'g', araMs: 60_000 }), false, 'ikinci zamanlayici kuruldu');
  c.durdur();
});

const ORNEK = (id) => ({ OcoWfInstanceId: id, Subject: 's' + id, PlannedStartDate: `/Date(${1791309600000 + id * 1000}+0300)/` });
function sayfaliServis(total, { bosIndeks = null, gecikme = 3, hataSkip = null } = {}) {
  const cagrilar = [];
  let aktif = 0;
  let enCok = 0;
  const fn = async (skip) => {
    cagrilar.push(skip);
    aktif += 1;
    enCok = Math.max(enCok, aktif);
    await bekle(gecikme);
    aktif -= 1;
    if (hataSkip === skip) throw new Error('sayfa hatasi');
    const i = skip / search.PAGE_SIZE;
    if (bosIndeks != null && i >= bosIndeks) return { SearchChangeOrderWithOffsetResult: { TotalCount: total, Result: [] } };
    const adet = Math.max(0, Math.min(search.PAGE_SIZE, total - skip));
    return {
      SearchChangeOrderWithOffsetResult: {
        TotalCount: total,
        Result: Array.from({ length: adet }, (_, k) => ORNEK(skip + k + 1)),
      },
    };
  };
  fn.cagrilar = cagrilar;
  fn.enCok = () => enCok;
  return fn;
}

test('T6 paralel sayfa: skip seti, esanlilik <= 3, sira korunur, bos sayfada durur, MAX_PAGES', async () => {
  const s1 = sayfaliServis(550);
  const r = await search.tekSorgu(s1, { eszaman: 3 });
  assert.deepEqual([...s1.cagrilar].sort((a, b) => a - b), [0, 100, 200, 300, 400, 500]);
  assert.ok(s1.enCok() <= 3, `esanlilik siniri asildi: ${s1.enCok()}`);
  assert.equal(r.fetched, 550);
  assert.equal(r.truncated, false);
  assert.deepEqual(r.rows.map((x) => x.oco), Array.from({ length: 550 }, (_, i) => i + 1));

  // Ortada bos sayfa: sonrasi alinmaz (alinmissa yok sayilir), kirpma sayilmaz.
  const s2 = sayfaliServis(1000, { bosIndeks: 3, gecikme: 1 });
  const r2 = await search.tekSorgu(s2, { eszaman: 1 + 1 });
  assert.equal(r2.fetched, 300);
  assert.equal(r2.truncated, false);
  assert.ok(!s2.cagrilar.includes(900), 'bos sayfadan sonra cekmeye devam etti');

  // Ust sinir: total > MAX_PAGES * PAGE_SIZE -> truncated, MAX_PAGES asilmaz.
  const s3 = sayfaliServis(search.MAX_PAGES * search.PAGE_SIZE + 500, { gecikme: 0 });
  const r3 = await search.tekSorgu(s3, { eszaman: 3 });
  assert.equal(r3.truncated, true);
  assert.equal(s3.cagrilar.length, search.MAX_PAGES);
  assert.ok(Math.max(...s3.cagrilar) < search.MAX_PAGES * search.PAGE_SIZE);

  // Herhangi bir sayfa hatasi rolun hatasidir.
  await assert.rejects(search.tekSorgu(sayfaliServis(550, { hataSkip: 300 }), { eszaman: 3 }), /sayfa hatasi/);

  // eszaman=1 eski sirali yol (ofset = ham kayit): ayni sonuc.
  const s4 = sayfaliServis(550);
  const r4 = await search.tekSorgu(s4, { eszaman: 1 });
  assert.deepEqual(s4.cagrilar, [0, 100, 200, 300, 400, 500]);
  assert.equal(s4.enCok(), 1);
  assert.deepEqual(r4.rows.map((x) => x.oco), r.rows.map((x) => x.oco));
});

test('T6b paralel cekimde kayan kayit rol icinde bir kez', async () => {
  const cek = async (skip) => ({
    SearchChangeOrderWithOffsetResult: {
      TotalCount: 200,
      // Ikinci sayfanin ilk kaydi birinci sayfanin sonuncusuyla ayni (kayma).
      Result: Array.from({ length: 100 }, (_, k) => ORNEK(skip === 0 ? k + 1 : k + 100)),
    },
  });
  const r = await search.tekSorgu(cek, { eszaman: 3 });
  assert.equal(r.fetched, 199);
  assert.equal(new Set(r.rows.map((x) => x.oco)).size, r.rows.length);
});

test('T7 kalici dispatcher: ayni anahtar ayni nesne; proxy ya da CA degisince eskisi kapatilir', () => {
  search._resetDispatcher();
  const kurulan = [];
  const fabrika = (o) => {
    const d = { o, kapandi: false, close() { this.kapandi = true; return Promise.resolve(); } };
    kurulan.push(d);
    return d;
  };
  let ca = ['ca1'];
  const caOku = () => ({ ca });
  const url = 'https://servicerepository/x';
  const eskiProxy = process.env.OCO_PROXY_URL;
  try {
    delete process.env.OCO_PROXY_URL;
    const a = search.getDispatcher(url, { fabrika, caOku });
    const b = search.getDispatcher(url + '/y?z=1', { fabrika, caOku });
    assert.equal(a, b, 'her sayfada yeni dispatcher kuruldu (keep-alive yok)');
    assert.equal(a.o.tlsOpts.servername, 'servicerepository');
    assert.equal(a.o.tlsOpts.rejectUnauthorized, true);
    process.env.OCO_PROXY_URL = 'http://proxy:8080';
    const c = search.getDispatcher(url, { fabrika, caOku });
    assert.notEqual(c, a);
    assert.equal(a.kapandi, true, 'eski dispatcher kapatilmadi');
    assert.equal(c.o.proxyUrl, 'http://proxy:8080');
    ca = ['ca2'];
    const d = search.getDispatcher(url, { fabrika, caOku });
    assert.notEqual(d, c, 'CA donunce dispatcher yenilenmedi');
    assert.equal(c.kapandi, true);
    assert.equal(kurulan.length, 3);
  } finally {
    if (eskiProxy == null) delete process.env.OCO_PROXY_URL;
    else process.env.OCO_PROXY_URL = eskiProxy;
    search._resetDispatcher();
  }
});

test('T7b sayfa sonunda dispatcher KAPATILMAZ (kaynak bekcisi)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'search.cjs'), 'utf8');
  const govde = src.slice(src.indexOf('async function httpPage('));
  assert.ok(govde.includes('getDispatcher(url)'), 'httpPage kalici dispatcher kullanmiyor');
  assert.ok(!/dispatcher\.close\(/.test(govde), 'httpPage her sayfada dispatcher kapatiyor');
  assert.equal(search.sayfaEszaman(), Number(process.env.OCO_SAYFA_ESZAMAN) || 3);
});

test('T8 uc: Server-Timing + stale bayragi; ikinci istek onbellekten', async () => {
  const path = require('node:path');
  const authYol = require.resolve('../../auth/index.cjs');
  const visYol = require.resolve('../../auth/visibility.cjs');
  const idxYol = require.resolve('../index.cjs');
  const srcYol = require.resolve('../search.cjs');
  const eski = { a: require.cache[authYol], v: require.cache[visYol], i: require.cache[idxYol], s: require.cache[srcYol] };
  const sahte = (yol, exports) => ({ id: yol, filename: yol, loaded: true, exports });
  let n = 0;
  require.cache[authYol] = sahte(authYol, { requireAuth: (_q, _s, next) => next() });
  require.cache[visYol] = sahte(visYol, { requireVisible: () => (_q, _s, next) => next() });
  require.cache[srcYol] = sahte(srcYol, {
    searchChangeOrders: async () => {
      n += 1;
      return { rows: [{ oco: 1 }], total: 1, fetched: 1, truncated: false, kaynak: {}, eksik: [] };
    },
  });
  delete require.cache[idxYol];
  const express = require('express');
  const app = express();
  const eskiLog = console.log;
  console.log = () => {};
  require(path.join(__dirname, '..', 'index.cjs')).initOco(app);
  console.log = eskiLog;
  const sunucu = app.listen(0);
  try {
    const port = sunucu.address().port;
    const al = async (q = '') => {
      const r = await fetch(`http://127.0.0.1:${port}/api/oco/calendar${q}`);
      return { st: r.headers.get('server-timing'), j: await r.json() };
    };
    const a = await al();
    assert.match(a.st, /^oco;dur=\d+, cache;desc=miss$/);
    assert.equal(a.j.cached, false);
    assert.equal(a.j.stale, false);
    assert.equal(a.j.truncated, false);
    const b = await al();
    assert.match(b.st, /cache;desc=hit/);
    assert.equal(b.j.cached, true);
    assert.equal(n, 1, 'ikinci istek servise gitti');
    const c = await al('?refresh=1');
    assert.match(c.st, /cache;desc=miss/);
    assert.equal(n, 2);
  } finally {
    sunucu.closeAllConnections?.();
    sunucu.close();
    require(idxYol)._onbellek.durdur();
    for (const [k, v] of [[authYol, eski.a], [visYol, eski.v], [idxYol, eski.i], [srcYol, eski.s]]) {
      if (v) require.cache[k] = v;
      else delete require.cache[k];
    }
  }
});
