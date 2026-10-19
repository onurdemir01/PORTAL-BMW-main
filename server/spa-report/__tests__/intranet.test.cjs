// server/spa-report/__tests__/intranet.test.cjs - Nginx ARK SPA > Intranet SPA (2026-10-19).
//
// Kullanici: intranet SPA'lar yuk aliyor mu, kullaniliyor mu raporu + ekiplerden kullanim beyani.
//   IS1 mirror sunucularin istegi TOPLANIR; son istek en yenisi; conf'u olmayan sunucu yuke katilmaz
//   IS2 'yuk almiyor' YALNIZ sunulan her sunucu tam pencerede kesin 0 iken; okunamayan log, satirsiz
//       sunucu, kisa pencere, sahipsiz istek (kova) -> 'unknown' + nedeni
//   IS3 ayni conf.d adina iki uygulama -> istek ayrilamaz (belirsiz-vhost), baskasina yazilmaz
//   IS4 conf_name -N yedegi (nginx_ops eki) yalniz kendi vhost satiri yoksa
//   IS5 olcum tablosu yok / okunamadi / host kipi hic yok -> 'olcum yok' (null), "yuk almiyor" DEGIL
//   IS6 kurulum: ortamin TARANAN sunucularina gore eksik sunucu; taranmayan sunucu eksik SAYILMAZ;
//       ortamlar ayri satir (GBNGXT50 TEST / GBNGXT51 EDU)
//   IS7 beyan: uygulama seviyesi, harf duyarsiz; location beyani karismaz; gecersiz deger yok sayilir
//   IS8 degerlendirme kodlari olcumu ve beyani YAN YANA okur
//   IS9 ortam ozeti
//   IS10 uclar: GET rapor; PUT beyan (kim yazdi kaydedilir), 400'ler, onbellek silinir
//   IS11 uygulama beyani yazimi SPA Raporu ile AYNI fonksiyon (UPDATE varsa, yoksa INSERT 'ark')
//   IS12 sayfa kaydi: DB seed + elements + menu + route + sunucu kapisi
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');

// index.cjs db/index.cjs'i yukler: sahte DB (yalniz IS11'in bekledigi sorgular).
const DB_YOL = path.join(__dirname, '..', '..', 'db', 'index.cjs');
const dbSorgular = [];
let takipVar = false;
require.cache[Module._resolveFilename(DB_YOL, module)] = {
  id: DB_YOL,
  filename: DB_YOL,
  loaded: true,
  exports: {
    query: async (sql, p = []) => {
      const t = String(sql).replace(/\s+/g, ' ').trim();
      dbSorgular.push({ t, p });
      if (t.startsWith('SELECT TOP 1 group_id FROM nginx_migration_tracking')) return { rows: takipVar ? [{ group_id: 'glomo' }] : [] };
      if (t.startsWith('UPDATE nginx_migration_tracking') || t.startsWith('INSERT INTO nginx_migration_tracking')) return { rows: [], rowCount: 1 };
      throw new Error(`sahte DB bilinmeyen SQL: ${t.slice(0, 120)}`);
    },
  },
};

const { buildIntranetRapor, mountIntranet, onbellekSil } = require('../intranet.cjs');

const PROD = ['GBNGXAP50', 'GBNGXAP51', 'GBNGXP50', 'GBNGXP51', 'GBNGXP52', 'GBNGXP53'];
const D = (host, ns, app, o = {}) => ({
  host, namespace: ns, application: app, hys_deployed: 1, app_deployed: 1, conf_exists: 1,
  conf_name: `${app}-${ns}`, in_ocp_inventory: 1, status: 'OK', scan_date: '2026-10-18', ...o,
});
// Host kipi trafik satiri: vhost = <app>-<ns>, location '@server_name'. first_seen 8 gun once (tam pencere).
const H = (host, vhost, req7, o = {}) => ({
  host, vhost, location: `@${vhost}.apps.fw.garanti.com.tr`, req_24h: Math.min(req7, 5), req_7d: req7, hc_24h: 100,
  sampled: 0, last_seen: '2026-10-17 10:00:00', error: null, first_seen: '20261010000000', scan_date: '2026-10-18', ...o,
});
const kur = (p) => buildIntranetRapor({ trafikTablo: 'var', ownersByNs: new Map(), beyanlar: new Map(), hosts: PROD, ...p });
const satir = (out, app) => out.rows.find((r) => r.application === app);

test('IS1 mirror istekleri toplanir; son istek en yenisi; conf yoksa yuke katilmaz', () => {
  const out = kur({
    dirRows: [D('GBNGXP50', 'kart-prod', 'ekran-app-v1'), D('GBNGXP51', 'kart-prod', 'ekran-app-v1'),
      D('GBNGXP52', 'kart-prod', 'ekran-app-v1', { conf_exists: 0, status: 'MISSING_CONF' })],
    trafficRows: [H('GBNGXP50', 'ekran-app-v1-kart-prod', 7), H('GBNGXP51', 'ekran-app-v1-kart-prod', 5, { last_seen: '2026-10-17 23:59:00' })],
  });
  const r = satir(out, 'ekran-app-v1');
  assert.equal(r.yuk.state, 'active');
  assert.equal(r.yuk.req7, 12);
  assert.equal(r.yuk.hosts, 2, 'conf olmayan sunucu olculen sayilmamali');
  assert.equal(r.yuk.lastSeen, '2026-10-17 23:59:00');
  assert.equal(r.sunulan, 2);
});

test('IS2 yuk almiyor yalniz her sunucu tam pencerede kesin 0 iken', () => {
  const ns = 'kart-prod';
  const durum = (rows, trafik) => satir(kur({ dirRows: rows, trafficRows: trafik }), 'a-app-v1').yuk;
  const iki = [D('GBNGXP50', ns, 'a-app-v1'), D('GBNGXP51', ns, 'a-app-v1')];
  const vh = 'a-app-v1-kart-prod';
  assert.equal(durum(iki, [H('GBNGXP50', vh, 0), H('GBNGXP51', vh, 0)]).state, 'idle');
  // conf'u olmayan (sunmayan) ucuncu sunucu 'idle'i bozmaz: olcum beklenmez
  const ucConfsuz = [...iki, D('GBNGXP52', ns, 'a-app-v1', { conf_exists: 0, status: 'MISSING_CONF' })];
  assert.equal(durum(ucConfsuz, [H('GBNGXP50', vh, 0), H('GBNGXP51', vh, 0)]).state, 'idle', 'conf yok sunucu olculemedi sayildi');
  // okunamayan log
  let y = durum(iki, [H('GBNGXP50', vh, 0), { host: 'GBNGXP51', vhost: vh, location: '@x', error: 'log dosyasi yok', scan_date: '2026-10-18' }]);
  assert.equal(y.state, 'unknown');
  assert.deepEqual(y.kismi, ['okunamayan-sunucu']);
  assert.equal(y.unknownHosts, 1);
  // satirsiz sunucu (o vhost icin satir yok, sunucunun baska host kipi satiri var)
  y = durum(iki, [H('GBNGXP50', vh, 0), H('GBNGXP51', 'baska-app-v1-kart-prod', 3)]);
  assert.deepEqual([y.state, y.kismi, y.missingHosts], ['unknown', ['satirsiz-sunucu'], 1]);
  // kisa pencere (gunluk rotasyon)
  y = durum(iki, [H('GBNGXP50', vh, 0, { first_seen: '20261016000000' }), H('GBNGXP51', vh, 0)]);
  assert.deepEqual([y.state, y.kismi, y.pencereSaat], ['unknown', ['pencere'], 48]);
  // sahipsiz istek (kova): 0 alt sinir
  y = durum(iki, [H('GBNGXP50', vh, 0), H('GBNGXP51', vh, 0),
    { host: 'GBNGXP51', vhost: '_', location: '@_', req_7d: 9, scan_date: '2026-10-18' }]);
  assert.deepEqual([y.state, y.kismi], ['unknown', ['eslesmeyen-host']]);
  // biri yuk aliyorsa digerinin olculememesi 'active'i bozmaz
  y = durum(iki, [H('GBNGXP50', vh, 4), { host: 'GBNGXP51', vhost: vh, location: '@x', error: 'okunamadi', scan_date: '2026-10-18' }]);
  assert.equal(y.state, 'active');
  assert.equal(y.kismi, undefined);
});

test('IS3 ayni conf.d adina iki uygulama: istek ayrilamaz', () => {
  // 'ui' / 'odeme-prod' ile 'ui-odeme' / 'prod' ayni dosya adina duser: ui-odeme-prod
  const out = kur({
    dirRows: [D('GBNGXP50', 'odeme-prod', 'ui'), D('GBNGXP50', 'prod', 'ui-odeme')],
    trafficRows: [H('GBNGXP50', 'ui-odeme-prod', 50)],
  });
  for (const r of out.rows) {
    assert.equal(r.yuk.state, 'unknown', `${r.namespace}/${r.application} baskasinin istegini aldi`);
    assert.deepEqual(r.yuk.kismi, ['belirsiz-vhost']);
  }
});

test('IS4 conf_name -N yedegi yalniz kendi vhost satiri yoksa', () => {
  const out = kur({
    dirRows: [D('GBNGXP50', 'kart-prod', 'b-app-v1', { conf_name: 'b-app-v1-kart-prod-2' })],
    trafficRows: [H('GBNGXP50', 'b-app-v1-kart-prod-2', 6)],
  });
  assert.equal(satir(out, 'b-app-v1').yuk.req7, 6);
  const out2 = kur({
    dirRows: [D('GBNGXP50', 'kart-prod', 'b-app-v1', { conf_name: 'kart-b-app-v1-kart-prod' })],
    trafficRows: [H('GBNGXP50', 'kart-b-app-v1-kart-prod', 6)],
  });
  assert.notEqual(satir(out2, 'b-app-v1').yuk.state, 'active', 'cekirdek eslesmeli conf adi baska uygulamanin istegini getirdi');
});

test('IS5 olcum tablosu yok / okunamadi / host kipi yok -> olcum yok', () => {
  const rows = [D('GBNGXP50', 'kart-prod', 'c-app-v1')];
  for (const trafikTablo of ['yok', 'okunamadi']) {
    const out = kur({ dirRows: rows, trafficRows: null, trafikTablo });
    assert.equal(satir(out, 'c-app-v1').yuk, null, trafikTablo);
  }
  // tablo var ama yalniz location kipi satirlari (host kipi hic uretilmemis)
  const out = kur({ dirRows: rows, trafficRows: [{ host: 'GBNGXP50', vhost: 'GLOMO-PROD', location: '/x/', req_7d: 3, scan_date: '2026-10-18' }] });
  assert.equal(satir(out, 'c-app-v1').yuk, null);
  assert.equal(out.hostKipi, false);
});

test('IS6 kurulum ortamin taranan sunucularina gore; ortamlar ayri satir', () => {
  const out = buildIntranetRapor({
    trafikTablo: 'var', trafficRows: [], ownersByNs: new Map(), beyanlar: new Map(),
    hosts: ['GBNGXP50', 'GBNGXP51', 'GBNGXP52', 'GBNGXT50', 'GBNGXT51'],
    dirRows: [
      D('GBNGXP50', 'kart-prod', 'd-app-v1'),
      D('GBNGXP51', 'kart-prod', 'd-app-v1', { app_deployed: 0, status: 'MISSING_APP' }),
      D('GBNGXP51', 'kart-prod', 'tam-app-v1'),
      D('GBNGXP50', 'kart-prod', 'tam-app-v1'),
      D('GBNGXT50', 'kart-test', 'd-app-v1'),
      D('GBNGXT51', 'kart-test', 'd-app-v1'),
    ],
  });
  const d = out.rows.find((r) => r.env === 'PROD' && r.application === 'd-app-v1');
  assert.deepEqual([d.beklenen, d.tamSunucu, d.kurulum, d.eksikSunucular], [2, 1, 'kismi', []],
    'GBNGXP52 taranmadi: eksik sayilmamali');
  assert.deepEqual(out.taranmayan, ['GBNGXP52']);
  assert.equal(out.rows.find((r) => r.application === 'tam-app-v1').kurulum, 'tam');
  assert.deepEqual(out.rows.filter((r) => r.application === 'd-app-v1').map((r) => r.env).sort(), ['EDU', 'PROD', 'TEST']);
  // PROD'da biri eksik: P50 taranmis, uygulama yalniz P51'de
  const out2 = kur({ dirRows: [D('GBNGXP50', 'kart-prod', 'x-app-v1'), D('GBNGXP51', 'kart-prod', 'y-app-v1')], trafficRows: [] });
  assert.deepEqual(satir(out2, 'x-app-v1').eksikSunucular, ['GBNGXP51']);
});

test('IS7 beyan uygulama seviyesinden, harf duyarsiz; location beyani karismaz', () => {
  const beyanlar = new Map([
    ['Kart-Prod/E-App-v1', { inUse: 'no', inUseBy: 'ayse', inUseAt: '2026-10-18T09:00:00Z', note: 'kapatilabilir' }],
    ['kart-prod/f-app-v1\u0000/f/', { inUse: 'yes', inUseBy: 'x', note: '' }],
    ['kart-prod/g-app-v1', { inUse: 'belki', inUseBy: 'y', note: '' }],
  ]);
  const out = kur({ dirRows: ['e', 'f', 'g'].map((a) => D('GBNGXP50', 'kart-prod', `${a}-app-v1`)), trafficRows: [], beyanlar });
  const e = satir(out, 'e-app-v1');
  assert.deepEqual([e.inUse, e.inUseBy, e.note, e.inUseAt], ['no', 'ayse', 'kapatilabilir', '2026-10-18T09:00:00.000Z']);
  assert.equal(satir(out, 'f-app-v1').inUse, null, 'location beyani uygulama satirina yazildi');
  assert.equal(satir(out, 'g-app-v1').inUse, null, 'gecersiz beyan gosterildi');
});

test('IS8 degerlendirme olcumu ve beyani yan yana okur', () => {
  const vh = (a) => `${a}-kart-prod`;
  const out = kur({
    dirRows: [
      D('GBNGXP50', 'kart-prod', 'kapat-app-v1'), D('GBNGXP50', 'kart-prod', 'teyit-app-v1'),
      D('GBNGXP50', 'kart-prod', 'cel-app-v1', { in_ocp_inventory: 0 }),
      D('GBNGXP50', 'kart-prod', 'sun-app-v1', { conf_exists: 0, status: 'MISSING_CONF' }),
    ],
    trafficRows: [H('GBNGXP50', vh('kapat-app-v1'), 0), H('GBNGXP50', vh('teyit-app-v1'), 0), H('GBNGXP50', vh('cel-app-v1'), 30)],
    beyanlar: new Map([['kart-prod/kapat-app-v1', { inUse: 'no' }], ['kart-prod/cel-app-v1', { inUse: 'no' }]]),
  });
  assert.deepEqual(satir(out, 'kapat-app-v1').degerlendirme, ['kapatma-adayi']);
  assert.deepEqual(satir(out, 'teyit-app-v1').degerlendirme, ['teyit-bekliyor']);
  assert.deepEqual(satir(out, 'cel-app-v1').degerlendirme, ['celiski', 'ocp-yok']);
  assert.deepEqual(satir(out, 'sun-app-v1').degerlendirme, ['sunulmuyor']);
  // OpenShift: sunuculardan BIRI "var" diyorsa var (tarama sunucu basina; biri gec guncellenmis olabilir)
  const ocp = kur({ dirRows: [D('GBNGXP50', 'kart-prod', 'o-app-v1', { in_ocp_inventory: 0 }), D('GBNGXP51', 'kart-prod', 'o-app-v1')], trafficRows: [] });
  assert.equal(satir(ocp, 'o-app-v1').ocpVar, true);
  assert.ok(!satir(ocp, 'o-app-v1').degerlendirme.includes('ocp-yok'));
  assert.equal(satir(out, 'sun-app-v1').yuk, null);
});

test('IS9 ortam ozeti', () => {
  const out = kur({
    dirRows: [D('GBNGXP50', 'kart-prod', 'a1'), D('GBNGXP50', 'kart-prod', 'a2'), D('GBNGXP50', 'kart-prod', 'a3')],
    trafficRows: [H('GBNGXP50', 'a1-kart-prod', 2), H('GBNGXP50', 'a2-kart-prod', 0)],
    beyanlar: new Map([['kart-prod/a2', { inUse: 'no' }]]),
  });
  const p = out.envs.find((e) => e.env === 'PROD');
  assert.deepEqual(
    [p.uygulama, p.active, p.idle, p.unknown, p.olcumYok, p.beyanli, p.kapatmaAdayi, p.celiski],
    [3, 1, 1, 1, 0, 1, 1, 0],
  );
});

async function sunucu(deps) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { user: { username: 'ayse', role: 'User' } }; next(); });
  const router = express.Router();
  mountIntranet(router, deps);
  app.use('/api/spa-report', router);
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  return { s, base: `http://127.0.0.1:${s.address().port}/api/spa-report` };
}

test('IS10 uclar: rapor, beyan yazimi (kim kaydedilir), 400, onbellek silinir', async (t) => {
  onbellekSil();
  let beyan = new Map();
  const yazilan = [];
  const sorgular = [];
  const sql = new Proxy({}, { get: () => () => 'tip' });
  const mssql = {
    sql,
    query: async (text, params) => {
      const q = String(text);
      sorgular.push({ q, params });
      if (q.includes('OBJECT_ID')) return { recordset: [{ trf: 1, fs: 8 }] };
      if (q.includes('FROM dbo.Nginx_Intranet_Audit')) return { recordset: [D('GBNGXP50', 'kart-prod', 'z-app-v1')] };
      if (q.includes('FROM dbo.Nginx_Spa_Traffic')) return { recordset: [H('GBNGXP50', 'z-app-v1-kart-prod', 0)] };
      if (q.includes('Openshift_Namespace_Owners')) return { recordset: [{ namespace: 'kart-prod', owner_group_name: 'GT-Kart', owner_email: 'kart@banka.com', lookup_status: 'OK' }] };
      throw new Error('beklenmeyen sorgu ' + q.slice(0, 80));
    },
  };
  require('../../audit/ns-owners.cjs')._resetCache();
  const { s, base } = await sunucu({
    mssql,
    loadBeyanlar: async () => beyan,
    uygulamaBeyaniYaz: async (b) => {
      yazilan.push(b);
      beyan = new Map([[`${b.namespace}/${b.application}`, { inUse: b.inUse, inUseBy: b.by, note: b.note }]]);
    },
  });
  t.after(() => s.close());
  let r = await fetch(`${base}/intranet`).then((x) => x.json());
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows.map((x) => [x.application, x.yuk.state, x.ekip[0], x.inUse]), [['z-app-v1', 'idle', 'GT-Kart', null]]);
  const dizinSorgu = sorgular.find((x) => x.q.includes('Nginx_Intranet_Audit'));
  assert.ok(dizinSorgu.params.some((p) => p.value === 'GBNGXAP51') && dizinSorgu.params.some((p) => p.value === 'GBNGXD50'), 'intranet sunuculari sorguda yok');
  const put = (body) => fetch(`${base}/intranet/declare`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await put({ namespace: 'kart-prod' })).status, 400);
  assert.equal((await put({ namespace: 'kart-prod', application: 'z-app-v1', inUse: 'belki' })).status, 400);
  // BEYAN EDEN OTURUMDAN: govdeye yazilan ad kullanilmaz.
  const w = await put({ namespace: 'kart-prod', application: 'z-app-v1', inUse: 'no', note: 'kimse kullanmiyor', by: 'sahte', inUseBy: 'sahte' }).then((x) => x.json());
  assert.equal(w.ok, true);
  assert.equal(w.inUseBy, 'ayse');
  assert.deepEqual(yazilan, [{ namespace: 'kart-prod', application: 'z-app-v1', inUse: 'no', note: 'kimse kullanmiyor', by: 'ayse' }]);
  r = await fetch(`${base}/intranet`).then((x) => x.json());
  assert.equal(r.rows[0].inUse, 'no', 'beyan sonrasi onbellek silinmedi');
  assert.deepEqual(r.rows[0].degerlendirme, ['kapatma-adayi']);
});

test('IS11 uygulama beyani SPA Raporu ile ayni fonksiyon: varsa UPDATE, yoksa INSERT ark', async () => {
  const { uygulamaBeyaniYaz } = require('../index.cjs');
  dbSorgular.length = 0;
  takipVar = true;
  await uygulamaBeyaniYaz({ namespace: 'kart-prod', application: 'z', inUse: 'yes', note: 'n', by: 'ayse' });
  assert.ok(dbSorgular.some((q) => q.t.startsWith('UPDATE nginx_migration_tracking') && q.p[0] === 'glomo' && q.p[3] === 'ayse'));
  dbSorgular.length = 0;
  takipVar = false;
  await uygulamaBeyaniYaz({ namespace: 'kart-prod', application: 'z', inUse: 'no', note: '', by: 'ayse' });
  assert.ok(dbSorgular.some((q) => q.t.startsWith("INSERT INTO nginx_migration_tracking") && q.t.includes("VALUES ('ark'")));
  // SPA Raporu'nun location'siz beyani da bu fonksiyondan gecer (tek yazim yolu)
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  assert.equal((src.match(/INSERT INTO nginx_migration_tracking/g) || []).length, 1, 'ikinci bir uygulama beyani yazim yolu var');
  assert.match(src, /await uygulamaBeyaniYaz\(\{ namespace: ns, application: app2, inUse, note, by \}\);\s*intranetOnbellekSil\(\);/);
});

test('IS12 sayfa kaydi: seed + elements + menu + route + sunucu kapisi', () => {
  const KOK = path.join(__dirname, '..', '..', '..');
  const oku = (p) => fs.readFileSync(path.join(KOK, p), 'utf8').replace(/"/g, "'");
  assert.match(oku('server/db/mssql-setup.cjs'), /element_key: 'ArkIntranetSpa',\s*element_type: 'page',\s*parent_key: 'navgroup:arkspa',\s*label: 'Intranet SPA',\s*route: '\/ark-spa\/intranet-spa'/);
  assert.match(oku('src/config/elements.ts'), /id: 'ArkIntranetSpa', label: 'Intranet SPA', route: '\/ark-spa\/intranet-spa'/);
  assert.match(oku('src/config/elements.ts'), /itemIds: \['ArkSpaRaporu', 'ArkGlomoGecis', 'ArkIntranetSpa'\]/);
  assert.match(oku('src/App.tsx'), /pageId='ArkIntranetSpa' \/>\}>\s*<Route path='\/ark-spa\/intranet-spa' element=\{<IntranetSpaPage \/>\}/);
  const idx = oku('server/spa-report/index.cjs');
  assert.match(idx, /intranetRouter\.use\('\/intranet', requireVisible\('ArkIntranetSpa'\)\)/);
  assert.match(idx, /intranetRouter\.use\('\/intranet', requireAuth\)/);
  assert.ok(idx.indexOf("app.use('/api/spa-report', intranetRouter)") < idx.indexOf("app.use('/api/spa-report', router)"),
    'intranet router rapor kapisindan SONRA baglandi (ArkSpaRaporu gormeyen kullanici giremez)');
});
