'use strict';
// DENETIM > NGINX SPA AUDIT > LOCATION DETAYI (server/audit/nginx-locations.cjs) — gercek express;
// envanter sorgusu (inventory/mssql.cjs `query`) ve sunucu etiket haritasi (nginx-host-labels
// `etiketHaritasi`) cagri aninda okunur, yerinde sahte. Etiketin tanima uygulanmasi gercek kod.
//   NL1 tarama yoksa bos yanit; tarih verilirse sorgu parametresiyle normalize edilir.
//   NL2 aynali satirlar (ayni tanim, farkli host) tekillesir: host / vhost toplanir ve siralanir;
//       durum sayilari, alanlarin kirpilmasi, path-uygulama uyumu, siralama.
//   NL3 filtreler: servis, ortam (harf duyarsiz), durum, arama (uygulama / namespace / path /
//       include); filtre secenekleri TUM veriden.
//   NL4 elle etiket: tum aynalar ayni tek etiketi tasiyorsa servis o etiket (asil ad serviceOto);
//       aynalar karisiksa ya da etiket ayni servisse degismez.
//   NL5 1500 satir tavani: fazlasi kirpilir, toplam ve isaret dogru.
//   NL6 DB hatasi 500 ve ileti.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');

const envanter = require('../../inventory/mssql.cjs');
const etiketler = require('../nginx-host-labels.cjs');
const { registerNginxLocations } = require('../nginx-locations.cjs');

const satir = (o) => ({
  service: 'ODEME',
  env: 'prod',
  host: 'h1',
  vhost: 'v1',
  location_path: '/odeme/',
  include_name: 'odeme',
  application: 'odeme',
  namespace: 'ns1',
  deploy_mode: 'namespaced',
  include_exists: 1,
  app_deployed: 1,
  in_ocp_inventory: 0,
  status: 'OK',
  ...o,
});

async function sunucu(t, { tarih = '2026-11-20', satirlar = [], etiket = new Map(), hata } = {}) {
  const sorgular = [];
  t.mock.method(envanter, 'query', async (metin, params) => {
    sorgular.push({ metin: metin.replace(/\s+/g, ' ').trim(), params });
    if (hata) throw hata;
    if (/AS d/.test(metin)) return { recordset: [{ d: tarih }] };
    return { recordset: satirlar };
  });
  t.mock.method(etiketler, 'etiketHaritasi', async () => ({ m: etiket, hata: null }));
  const router = express.Router();
  registerNginxLocations(router);
  const app = express();
  app.use('/api/denetim', router);
  const s = app.listen(0, '127.0.0.1');
  await once(s, 'listening');
  t.after(() => new Promise((r) => s.close(r)));
  const al = async (yol = '') => {
    const r = await fetch(`http://127.0.0.1:${s.address().port}/api/denetim/nginx-locations${yol}`);
    return { status: r.status, govde: await r.json() };
  };
  return { al, sorgular };
}

test('NL1 tarama yoksa bos yanit; verilen tarih parametreyle normalize edilir', async (t) => {
  let { al, sorgular } = await sunucu(t, { tarih: null });
  let r = await al();
  assert.deepEqual(r.govde, {
    ok: true,
    scanDate: null,
    services: [],
    envs: [],
    statusCounts: [],
    total: 0,
    shown: 0,
    capped: false,
    rows: [],
  });
  assert.equal(sorgular.length, 1, 'tarama yokken satir sorgusu atildi');
  assert.equal(
    sorgular[0].metin,
    'SELECT CONVERT(varchar(10), MAX(scan_date), 23) AS d FROM dbo.Nginx_Config_Audit',
  );
  assert.deepEqual(sorgular[0].params, []);

  ({ al, sorgular } = await sunucu(t, { tarih: '2026-11-19' }));
  r = await al('?scanDate=%202026-11-19%20');
  assert.equal(r.govde.scanDate, '2026-11-19');
  assert.equal(sorgular[0].metin, 'SELECT CONVERT(varchar(10), CAST(@d AS DATE), 23) AS d');
  assert.equal(sorgular[0].params[0].name, 'd');
  assert.equal(sorgular[0].params[0].value, '2026-11-19');
  assert.match(sorgular[1].metin, /FROM dbo\.Nginx_Config_Audit WHERE scan_date = @d$/);
  assert.equal(sorgular[1].params[0].value, '2026-11-19');
  assert.equal(r.govde.bodyAvailable, false, 'blok govdesi taranmiyor, ekran bunu bilmeli');
});

test('NL2 aynalar tekillesir; durum sayilari, uyum ve siralama', async (t) => {
  const { al } = await sunucu(t, {
    satirlar: [
      satir({ host: 'h2', vhost: 'v2' }),
      satir({ host: 'h1', vhost: 'v1' }),
      satir({ host: 'h1', vhost: null }),
      satir({
        service: 'CARI',
        env: 'test',
        location_path: ' /cari/ ',
        include_name: ' cari ',
        application: ' Cari ',
        namespace: ' ns2 ',
        deploy_mode: ' flat ',
        include_exists: 0,
        app_deployed: null,
        in_ocp_inventory: 1,
        status: 'BROKEN_INCLUDE',
        host: null,
      }),
      satir({ location_path: '/eski/', application: 'odeme', status: 'NAME_MISMATCH' }),
      satir({
        location_path: '/bos/',
        application: '',
        include_name: 'bos',
        status: 'NAME_MISMATCH',
      }),
    ],
  });
  const { govde } = await al();
  assert.equal(govde.scanDate, '2026-11-20');
  assert.equal(govde.total, 4);
  assert.equal(govde.shown, 4);
  assert.equal(govde.capped, false);
  assert.deepEqual(govde.services, ['CARI', 'ODEME']);
  assert.deepEqual(govde.envs, ['PROD', 'TEST']);
  assert.deepEqual(govde.statusCounts, [
    { status: 'NAME_MISMATCH', count: 2 },
    { status: 'OK', count: 1 },
    { status: 'BROKEN_INCLUDE', count: 1 },
  ]);
  assert.deepEqual(
    govde.rows.map((r) => [r.service, r.env, r.application, r.locationPath]),
    [
      ['CARI', 'TEST', 'Cari', '/cari/'],
      ['ODEME', 'PROD', '', '/bos/'],
      ['ODEME', 'PROD', 'odeme', '/eski/'],
      ['ODEME', 'PROD', 'odeme', '/odeme/'],
    ],
  );
  const odeme = govde.rows[3];
  assert.deepEqual(odeme.hosts, ['h1', 'h2']);
  assert.deepEqual(odeme.vhosts, ['v1', 'v2']);
  assert.equal(odeme.pathMatchesApp, true);
  assert.deepEqual(
    [odeme.includeExists, odeme.appDeployed, odeme.inOcpInventory],
    [true, true, false],
  );
  assert.equal('serviceOto' in odeme, false);
  const cari = govde.rows[0];
  assert.deepEqual(
    [cari.includeName, cari.namespace, cari.deployMode, cari.hosts],
    ['cari', 'ns2', 'flat', []],
  );
  assert.equal(cari.pathMatchesApp, true, 'uyum harf duyarsiz olmali');
  assert.deepEqual(
    [cari.includeExists, cari.appDeployed, cari.inOcpInventory],
    [false, false, true],
  );
  assert.equal(govde.rows[2].pathMatchesApp, false, 'uygulama adini tasimayan path uyumlu sayildi');
  assert.equal(govde.rows[1].pathMatchesApp, false, 'bos uygulama adi uyumlu sayildi');
});

test('NL3 filtreler; secenekler tum veriden', async (t) => {
  const { al } = await sunucu(t, {
    satirlar: [
      satir({}),
      satir({ env: 'test', status: 'NOT_DEPLOYED' }),
      satir({ service: 'CARI', location_path: '/cari/', application: 'cari', include_name: 'x' }),
      satir({ service: 'KASA', location_path: '/k/', application: 'kasa', namespace: 'Para-NS' }),
      satir({
        service: 'KREDI',
        location_path: '/kredi/api',
        application: 'kredi',
        include_name: 'kr-conf',
      }),
    ],
  });
  const yollar = async (q) => (await al(q)).govde.rows.map((r) => `${r.service}:${r.env}`);
  assert.deepEqual(await yollar('?service=ODEME'), ['ODEME:PROD', 'ODEME:TEST']);
  assert.deepEqual(await yollar('?env=Test'), ['ODEME:TEST']);
  assert.deepEqual(await yollar('?status=NOT_DEPLOYED'), ['ODEME:TEST']);
  assert.deepEqual(await yollar('?q=PARA-ns'), ['KASA:PROD'], 'namespace aramasi');
  assert.deepEqual(await yollar('?q=/kredi/API'), ['KREDI:PROD'], 'path aramasi');
  assert.deepEqual(await yollar('?q=KR-CONF'), ['KREDI:PROD'], 'include aramasi');
  assert.deepEqual(await yollar('?q=car'), ['CARI:PROD'], 'uygulama aramasi');
  const r = await al('?service=KASA&env=PROD');
  assert.deepEqual(r.govde.services, ['CARI', 'KASA', 'KREDI', 'ODEME']);
  assert.deepEqual(r.govde.envs, ['PROD', 'TEST']);
  assert.equal(r.govde.total, 1);
});

test('NL4 elle etiket tanimin tum aynalari ayni tek etiketi tasiyorsa uygulanir', async (t) => {
  const degistir = (e) => ({ mod: 'degistir', etiketler: [e] });
  const etiket = new Map([
    ['H1', degistir('yeni-servis')],
    ['H2', degistir('yeni-servis')],
    ['H3', degistir('yeni-servis')],
    ['H5', degistir('kasa')],
    ['H6', { mod: 'ekle', etiketler: ['x'] }],
  ]);
  const { al } = await sunucu(t, {
    etiket,
    satirlar: [
      satir({ host: 'h1' }),
      satir({ host: 'h2' }),
      satir({ service: 'CARI', location_path: '/cari/', application: 'cari', host: 'h3' }),
      satir({ service: 'CARI', location_path: '/cari/', application: 'cari', host: 'h4' }),
      satir({ service: 'KASA', location_path: '/k/', application: 'kasa', host: 'h5' }),
      satir({ service: 'BORC', location_path: '/b/', application: 'borc', host: 'h6' }),
    ],
  });
  const { govde } = await al();
  const bul = (app) => govde.rows.find((r) => r.application === app);
  assert.equal(bul('odeme').service, 'YENI-SERVIS');
  assert.equal(bul('odeme').serviceOto, 'ODEME');
  assert.deepEqual(bul('odeme').hosts, ['h1', 'h2']);
  assert.equal(bul('cari').service, 'CARI', 'karisik aynalarda tanim bolundu');
  assert.deepEqual(bul('cari').hosts, ['h3', 'h4']);
  assert.equal(bul('kasa').service, 'KASA');
  assert.equal('serviceOto' in bul('kasa'), false, 'ayni servis etiketi serviceOto uretti');
  assert.equal(bul('borc').service, 'BORC', 'ekle kipi servisi degistirdi');
  assert.ok(govde.services.includes('YENI-SERVIS'));
  assert.ok(!govde.services.includes('ODEME'));
});

test('NL5 1500 satir tavani', async (t) => {
  const satirlar = Array.from({ length: 1501 }, (_, i) =>
    satir({ location_path: `/p${String(i).padStart(4, '0')}/` }),
  );
  const { al } = await sunucu(t, { satirlar });
  const { govde } = await al();
  assert.equal(govde.total, 1501);
  assert.equal(govde.shown, 1500);
  assert.equal(govde.capped, true);
  assert.equal(govde.rows.length, 1500);
  assert.equal(govde.rows.at(-1).locationPath, '/p1499/');
});

test('NL6 DB hatasi 500 ve ileti', async (t) => {
  let { al } = await sunucu(t, { hata: new Error('Envanter DB yok') });
  let r = await al();
  assert.equal(r.status, 500);
  assert.deepEqual(r.govde, { ok: false, message: 'Envanter DB yok' });
  ({ al } = await sunucu(t, { hata: new Error('') }));
  r = await al();
  assert.deepEqual(r.govde, { ok: false, message: 'Location detayı alınamadı.' });
});
