// server/selfservice/__tests__/lb-ip-kurallari.test.cjs - sunucu listesinden LB IP'leri.
// Beklentiler lb_suspend_excludelist.sh ciktisindan alindi (betik Ansible deposunda, burada kosmaz).
//   LB1 dogrudan kayit ve U eslenikleri
//   LB2 uygulama / sube sunucusunun web eslenigi; baska 5. harfte W eslenigi "bulundu" kaniti degil
//   LB3 eslenik girdide varsa eklenmez; CGW adi W denetimini kapatir
//   LB4 GBSUB -> GBWEB; Ankara eslenigi "bulundu" saymaz ama eklenir
//   LB5 dijital kanal web sunuculari
//   LB6 operasyon uyarilari, gecersiz girdi, IP tekillestirme
//   LB7 veri tarihi; dijital kanal okunamazsa soylenir
//   LB8 GERCEK uc: giris yapmis herkes, Admin sart degil; bos envanter hata; oturumsuz 401
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const SERVER = path.join(__dirname, '..', '..');
const stub = (rel, exports) => {
  const file = path.join(SERVER, rel);
  const m = new Module(file);
  m.filename = file;
  m.loaded = true;
  m.exports = exports;
  require.cache[file] = m;
};

const { lbIpCoz, girdiyiAyikla, dijitalKanalOku, veriDurumu, VERI_BAYAT_SAAT } = require('../lb-ip-kurallari.cjs');

const K = (...satirlar) => satirlar.map((s) => {
  const i = s.indexOf('-');
  return { host: s.slice(0, i), ip: s.slice(i + 1) };
});
const coz = (sunucular, kayitlar, dijitalKanalMetni) => lbIpCoz({ sunucular, kayitlar, dijitalKanalMetni });
const hostlar = (s) => s.kayitlar.map((k) => k.host);

test('LB1 dogrudan kayit ve U eslenikleri', () => {
  const r = coz(['GBJBOP01'], K('GBJBOP01-10.0.0.1', 'GBJBOP01-10.0.0.2', 'GBJBOPU01-10.0.0.3', 'GBJBOUP01-10.0.0.4', 'GBJBOP02-10.0.0.9'));
  assert.equal(r.sonuclar[0].bulundu, true);
  assert.deepEqual(r.ipler, ['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4']);
  assert.deepEqual(r.sonuclar[0].kayitlar.map((k) => k.neden), ['sunucu', 'sunucu', 'u_eslenigi', 'u_eslenigi']);
  assert.equal(coz(['GBJBOPU1'], K('gbjbopu1-10.0.0.5')).sonuclar[0].bulundu, true, 'buyuk / kucuk harf duyarsiz degil');
  for (const yalnizU of ['GBJBOPU01-10.0.0.3', 'GBJBOUP01-10.0.0.4']) {
    const u = coz(['GBJBOP01'], K(yalnizU));
    assert.equal(u.sonuclar[0].bulundu, true, `${yalnizU} tek basina bulundu sayilmadi`);
    assert.equal(u.ipler.length, 1);
  }
});

test('LB2 web eslenigi yalniz 5. harf A ya da S ise', () => {
  const r = coz(['GBAPAP01', 'GBSBSP01'], K('GBAPWP01-10.0.0.1', 'GBSBWP01-10.0.0.2'));
  assert.deepEqual(r.sonuclar.map((s) => s.bulundu), [true, true]);
  assert.deepEqual(r.sonuclar.map(hostlar), [['GBAPWP01'], ['GBSBWP01']]);
  assert.equal(r.sonuclar[0].kayitlar[0].neden, 'web_eslenigi');
  // job_3323940: GBNGXP02 listede yok; GBNGWP02 baska bir sunucu.
  const x = coz(['GBNGXP02'], K('GBNGWP02-10.1.1.2'));
  assert.equal(x.sonuclar[0].bulundu, false);
  assert.deepEqual(x.ipler, []);
});

test('LB3 eslenik girdideyse eklenmez, CGW denetimi kapatir', () => {
  const liste = K('GBAPAP01-10.0.0.1', 'GBAPWP01-10.0.0.2');
  const r = coz(['GBAPAP01', 'GBAPWP01'], liste);
  assert.deepEqual(r.sonuclar.map(hostlar), [['GBAPAP01'], ['GBAPWP01']]);
  const c = coz(['GBAPAP01', 'GBAPWP01', 'GBCGWP01'], liste);
  assert.deepEqual(hostlar(c.sonuclar[0]), ['GBAPAP01', 'GBAPWP01']);
  const web = coz(['GBAPAP01', 'GBWEBX01'], [...liste, ...K('GBWEBX01-10.0.0.3')]);
  assert.deepEqual(hostlar(web.sonuclar[0]), ['GBAPAP01', 'GBAPWP01'], 'GBWEBX01, GBWEB01 degil');
  const web2 = coz(['GBAPAP01', 'GBWEB01'], [...liste, ...K('GBWEB01-10.0.0.3')]);
  assert.deepEqual(hostlar(web2.sonuclar[0]), ['GBAPAP01'], 'GBWEB girdide varsa eslenik eklenmez');
});

test('LB4 GBSUB ve Ankara eslenikleri', () => {
  const s = coz(['GBSUBP09'], K('GBWEB09-10.0.0.1'));
  assert.equal(s.sonuclar[0].bulundu, false);
  assert.deepEqual(hostlar(s.sonuclar[0]), ['GBWEB09']);
  assert.deepEqual(coz(['GBAPXP09'], K('GBWEB09-10.0.0.1')).ipler, [], 'GBSUB disinda GBWEB eklendi');
  const a = coz(['GOJBANP03'], K('GOJBWNP03-10.0.0.2'));
  assert.equal(a.sonuclar[0].bulundu, false, 'Ankara eslenigi bulundu saymaz');
  assert.deepEqual(hostlar(a.sonuclar[0]), ['GOJBWNP03']);
  assert.equal(coz(['GOJBXNP03'], K('GOJBWNP03-10.0.0.2')).ipler.length, 0);
});

test('LB5 dijital kanal web sunuculari', () => {
  const metin = 'GBDKWP01 GBCTGP01\r\nGBDKWP02 GBCTGP01 GBCTGP02\nGBDKWP03 GBCTGP03\n';
  const r = coz(['GBCTGP01'], K('GBDKWP01-10.0.0.1', 'GBDKWP02-10.0.0.2', 'GBDKWP03-10.0.0.3'), metin);
  assert.deepEqual(r.sonuclar[0].eslenikler, ['GBDKWP01', 'GBDKWP02']);
  assert.deepEqual(r.ipler, ['10.0.0.1', '10.0.0.2']);
  assert.equal(r.sonuclar[0].kayitlar[0].neden, 'dijital_kanal_web');
});

test('LB6 uyarilar, gecersiz girdi, IP tekillestirme', () => {
  const r = coz(['GBJBOP07', 'GBAPAP01'], K('GBJBOP07-10.0.0.1'));
  assert.deepEqual(r.uyarilar.map((u) => u.sunucu), ['GBJBOP07']);
  assert.match(r.uyarilar[0].aciklama, /GBJBOP08/);
  assert.deepEqual(girdiyiAyikla([' gbapap01 ', 'GBAPAP01', 'a;b', 'GB', '', null]), { sunucular: ['GBAPAP01'], gecersiz: ['A;B', 'GB'] });
  const t = coz(['GBAPAP01', 'GBAPAP02'], K('GBAPAP01-10.0.0.1', 'GBAPAP02-10.0.0.1'));
  assert.deepEqual(t.ipler, ['10.0.0.1']);
});

test('LB7 veri tarihi ve dijital kanal dosyasi', async (t) => {
  const simdi = Date.parse('2026-11-05T12:00:00Z');
  const taze = veriDurumu([{ last_seen_at: new Date(simdi - 3600e3) }, { last_seen_at: null }], simdi);
  assert.deepEqual(taze, { veriTarihi: '2026-11-05T11:00:00.000Z', veriBayat: false });
  assert.equal(veriDurumu([{ last_seen_at: new Date(simdi - (VERI_BAYAT_SAAT + 1) * 3600e3) }], simdi).veriBayat, true);
  assert.deepEqual(veriDurumu([{ last_seen_at: null }], simdi), { veriTarihi: null, veriBayat: true });

  const dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'lbk-'));
  const onceki = process.env.LB_SUSPEND_RAPOR_DIZIN;
  process.env.LB_SUSPEND_RAPOR_DIZIN = dizin;
  t.after(() => {
    if (onceki === undefined) delete process.env.LB_SUSPEND_RAPOR_DIZIN;
    else process.env.LB_SUSPEND_RAPOR_DIZIN = onceki;
    fs.rmSync(dizin, { recursive: true, force: true });
  });
  assert.deepEqual(await dijitalKanalOku(), { ok: false, metin: '' });
  fs.writeFileSync(path.join(dizin, 'dijital-kanal-sunuculari.txt'), 'A B\n');
  assert.deepEqual(await dijitalKanalOku(), { ok: true, metin: 'A B\n' });
});

test('LB8 GERCEK selfservice ucu', async (t) => {
  let satirlar = [{ host: 'GBAPAP01', ip: '10.0.0.1', last_seen_at: new Date() }];
  stub('auth/index.cjs', {
    requireAuth: (req, res, next) => (req.headers['x-oturum'] ? next() : res.status(401).json({ ok: false })),
    requireAdmin: (_q, res) => res.status(403).json({ ok: false }),
  });
  stub('auth/visibility.cjs', { requireVisiblePrefix: () => (_q, _s, n) => n() });
  stub('audit/index.cjs', { auditMutations: () => (_q, _s, n) => n() });
  stub('selfservice/store.cjs', { loadSelfServiceStore: async () => {}, readGroups: () => [], updateGroup: async () => null });
  stub('inventory/mssql.cjs', { sql: { NVarChar: () => 'nv' }, query: async () => ({ recordset: satirlar }) });
  const express = require('express');
  const app = express();
  const log = console.log;
  console.log = () => {};
  try {
    require('../index.cjs').initSelfService(app);
  } finally {
    console.log = log;
  }
  const srv = await new Promise((res) => {
    const s = app.listen(0, '127.0.0.1', () => res(s));
  });
  t.after(() => srv.close());
  const uc = `http://127.0.0.1:${srv.address().port}/api/selfservice/server-ip-check`;
  const gonder = (govde, oturum = true) => fetch(uc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(oturum ? { 'x-oturum': '1' } : {}) },
    body: JSON.stringify(govde),
  });

  let r = await gonder({ servers: ['gbapap01', 'GBYOKP01', 'a;b'] });
  let j = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(j.ipler, ['10.0.0.1']);
  assert.deepEqual(j.sonuclar.map((s) => s.bulundu), [true, false]);
  assert.deepEqual(j.gecersiz, ['A;B']);
  assert.equal(j.veriBayat, false);
  assert.equal(typeof j.dijitalKanalOkundu, 'boolean');
  assert.equal(j.truncated, 0);

  r = await gonder({ servers: Array.from({ length: 1002 }, (_, i) => `GBAPAP${i}`) });
  j = await r.json();
  assert.equal(j.truncated, 2);
  assert.equal(j.sonuclar.length, 1000);

  assert.equal((await gonder({ servers: [] })).status, 400);
  assert.equal((await gonder({ servers: ['a;b'] })).status, 400);
  assert.equal((await gonder({ servers: ['GBAPAP01'] }, false)).status, 401);

  satirlar = [];
  r = await gonder({ servers: ['GBAPAP01'] });
  assert.equal(r.status, 503, 'bos envanter bulunamadi diye okunuyor');
});
