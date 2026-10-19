// server/spa-report/__tests__/intranet.test.cjs - Nginx ARK SPA > Intranet SPA (2026-10-19).
//
// Kullanici: intranet SPA'lar yuk aliyor mu, kullaniliyor mu raporu + ekiplerden kullanim beyani.
// Duzeltme (ayni gun): "Dynatrace metriklerinden cikarmamiz gerekiyordu" - liste OpenShift'teki
// intranet SPA'lar (Gercek SPA Kesfi), yuk mevcut Dynatrace kullanim verisi (BMW_Application_Usage).
//   IS1 liste: yalniz SPA (spa='evet') ve ag intranet / karisik; internet, diger, bilinmiyor, SPA
//       olmayan ve SPA'ligi bilinmeyen GIRMEZ
//   IS2 Dynatrace bes durum AYNEN tasinir; sayi yalniz olculduyse; pencere / servis / not ipucuna
//   IS3 GERCEK hesap: buildSpaDiscovery ciktisi uzerinden - cluster'lar toplanir, servisi olmayan
//       'servis-yok', olculemeyen cluster varken 0 'yok' DEGIL, Dynatrace tablosu dustuyse olculemedi
//   IS4 beyan: uygulama seviyesi, harf duyarsiz; location beyani karismaz; gecersiz deger yok sayilir
//   IS5 degerlendirme olcumu ve beyani yan yana okur
//   IS6 ortam ozeti + siralama (PROD sonda degil, ENV sirasi) + sorunlu cluster listesi
//   IS7 yukleyici: kesif tablosu yoksa notScanned; ekip sahipleri; onbellek; dynatraceOkunamadi
//   IS8 uclar: GET rapor; PUT beyan (kim OTURUMDAN), 400'ler, onbellek silinir
//   IS9 uygulama beyani SPA Raporu ile AYNI fonksiyon (UPDATE varsa, yoksa INSERT ark)
//   IS10 sayfa kaydi: DB seed + elements + menu + route + sunucu kapisi; kesif hesabi paylasilir
// Intranet sunucu kurulumu (ayni gun: "deployment tamamlanmis tamamlanmamis mi"):
//   IS11 kendi ortaminin TARANAN intranet sunucularina gore tamam / kismi / yok; taranmayan sunucu
//        eksik SAYILMAZ; baska ortamin sunucusu sayilmaz; '-prod' eksiz dizin ns'i eslesir
//   IS12 dizin okunamadi / ortamin sunucusu taranmadi -> olculemedi; ortamin intranet sunucusu yok
//        -> sunucu-yok; ortam ozeti
//   IS13 yukleyici dizin tablosunu intranet sunuculariyla okur; sorgu duserse olculemedi
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');

// index.cjs db/index.cjs'i yukler: sahte DB (yalniz IS9'un bekledigi sorgular).
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

const { buildIntranetRapor, loadIntranet, mountIntranet, onbellekSil } = require('../intranet.cjs');
const { buildSpaDiscovery } = require('../../nginx-console/spa-discovery.cjs');

// Gercek SPA Kesfi uygulama satiri (spa-discovery uygulamalar() bicimi).
const A = (application, o = {}) => ({
  application, namespace: 'kart-prod', env: 'prod', spa: 'evet', ag: 'intranet', istek: 'var', reqShown: 120,
  usage: { scanDate: '2026-10-18', windowDays: 35, services: 2 }, hosts: [`${application}-kart-prod.apps.fw.garanti.com.tr`],
  clusters: ['gbocpp1', 'gbocpp2'], staleClusters: [], kapsamDurum: 'tam', kapsamVar: 2, kapsamToplam: 2,
  weakEvidence: false, pattern: 'uyuyor', ...o,
});
const kur = (apps, o = {}) => buildIntranetRapor({ apps, ownersByNs: new Map(), beyanlar: new Map(), ...o });
const SQL = new Proxy({}, { get: () => () => 'tip' });
// Intranet dizin satiri (Nginx_Intranet_Audit).
const DZ = (host, ns, app, o = {}) => ({
  host, namespace: ns, application: app, hys_deployed: 1, app_deployed: 1, conf_exists: 1, status: 'OK', scan_date: '2026-10-18', ...o,
});
const PROD_INTRA = ['GBNGXAP50', 'GBNGXP50', 'GBNGXP51', 'GBNGXT50'];
const satir = (out, app) => out.rows.find((r) => r.application === app);

test('IS1 yalniz SPA ve intranet / karisik ag', () => {
  const out = kur([
    A('i1'), A('k1', { ag: 'karisik' }), A('net1', { ag: 'internet' }), A('d1', { ag: 'diger' }),
    A('b1', { ag: 'bilinmiyor' }), A('h1', { spa: 'hayir' }), A('u1', { spa: 'bilinmiyor' }),
  ]);
  assert.deepEqual(out.rows.map((r) => r.application).sort(), ['i1', 'k1']);
  assert.ok(satir(out, 'k1').degerlendirme.includes('internet-route-da-var'));
  assert.ok(!satir(out, 'i1').degerlendirme.includes('internet-route-da-var'));
});

test('IS2 Dynatrace bes durum aynen; sayi yalniz olculduyse', () => {
  const out = kur([
    A('var1'), A('yok1', { istek: 'yok', reqShown: 0 }), A('sy1', { istek: 'servis-yok', reqShown: 0, usage: { scanDate: '2026-10-18', windowDays: 35, services: 0 } }),
    A('olc1', { istek: 'olculemedi', reqShown: null, usage: { scanDate: '2026-10-18', windowDays: 35, services: 3, note: 'servis okunamadi', olcum: '1/2' } }),
    A('none1', { istek: 'olcum-yok', reqShown: null, usage: null }),
  ]);
  assert.deepEqual(out.rows.map((r) => [r.application, r.istek, r.req]).sort(), [
    ['none1', 'olcum-yok', null], ['olc1', 'olculemedi', null], ['sy1', 'servis-yok', 0], ['var1', 'var', 120], ['yok1', 'yok', 0],
  ]);
  assert.deepEqual(satir(out, 'olc1').dynatrace, { scanDate: '2026-10-18', windowDays: 35, services: 3, note: 'servis okunamadi', olcum: '1/2' });
  assert.equal(satir(out, 'none1').dynatrace, null);
  assert.equal(out.dynatraceTarihi, '2026-10-18');
  assert.deepEqual(satir(out, 'var1').adresler, ['var1-kart-prod.apps.fw.garanti.com.tr']);
  assert.equal(satir(out, 'var1').env, 'PROD');
});

// Gercek kesif hesabi: route satiri (BMW_Spa_Discovery) + Dynatrace satiri (BMW_Application_Usage).
const D = (cluster, ns, workload, termination, o = {}) => ({
  cluster, namespace: ns, route: workload, host: `${workload}-${ns}.apps.fw.garanti.com.tr`, termination,
  workload_kind: 'Deployment', workload, is_spa: 1, signal: 'nginx-start.sh', image: '', note: '', match_by: 'selector',
  scan_date: '2026-10-18', ...o,
});
const Uu = (cluster, ns, app, req, o = {}) => ({
  cluster, namespace: ns, app, scan_date: '2026-10-18', window_days: 35, req_total: req, services_total: 1, measured: 1, note: '', ...o,
});
const RUNS = [{ cluster: 'gbocpp1', durum: 'ok', routes: 5, scan_date: '2026-10-18' }, { cluster: 'gbocpp2', durum: 'ok', routes: 5, scan_date: '2026-10-18' }];

test('IS3 gercek kesif hesabi uzerinden: cluster toplami, servis-yok, olculemeyen cluster, tablo dustu', () => {
  const disc = [
    D('gbocpp1', 'kart-prod', 'aktif-ui', 'reencrypt'), D('gbocpp2', 'kart-prod', 'aktif-ui', 'reencrypt'),
    D('gbocpp1', 'kart-prod', 'sessiz-ui', 'reencrypt'), D('gbocpp2', 'kart-prod', 'sessiz-ui', 'reencrypt'),
    D('gbocpp1', 'kart-prod', 'yarim-ui', 'reencrypt'), D('gbocpp2', 'kart-prod', 'yarim-ui', 'reencrypt'),
    D('gbocpp1', 'kart-prod', 'servissiz-ui', 'reencrypt'),
    D('gbocpp1', 'kart-prod', 'dis-ui', 'passthrough'),
    D('gbocpp1', 'kart-prod', 'api', 'reencrypt', { is_spa: 0, signal: '' }),
  ];
  const usage = [
    Uu('gbocpp1', 'kart-prod', 'aktif-ui', 7), Uu('gbocpp2', 'kart-prod', 'aktif-ui', 5),
    Uu('gbocpp1', 'kart-prod', 'sessiz-ui', 0), Uu('gbocpp2', 'kart-prod', 'sessiz-ui', 0),
    Uu('gbocpp1', 'kart-prod', 'yarim-ui', 0), Uu('gbocpp2', 'kart-prod', 'yarim-ui', 0, { measured: 0, note: 'servis okunamadi: 403' }),
    Uu('gbocpp1', 'kart-prod', 'servissiz-ui', 0, { services_total: 0 }),
  ];
  const kes = buildSpaDiscovery(disc, [], usage, RUNS, { tablolar: {} }, null);
  const out = kur(kes.apps, { coverage: kes.coverage });
  assert.deepEqual(out.rows.map((r) => r.application).sort(), ['aktif-ui', 'servissiz-ui', 'sessiz-ui', 'yarim-ui'],
    'internet (passthrough) ve SPA olmayan girmemeli');
  assert.deepEqual([satir(out, 'aktif-ui').istek, satir(out, 'aktif-ui').req], ['var', 12], 'cluster istekleri toplanmali');
  assert.equal(satir(out, 'sessiz-ui').istek, 'yok');
  assert.equal(satir(out, 'yarim-ui').istek, 'olculemedi', 'bir cluster olculemezken 0 "yok" sayildi');
  assert.equal(satir(out, 'yarim-ui').req, null);
  assert.equal(satir(out, 'servissiz-ui').istek, 'servis-yok');
  // Dynatrace tablosu okunamadi (usage null): HER satir olculemedi
  const dus = kur(buildSpaDiscovery(disc, [], null, RUNS, { tablolar: {} }, null).apps);
  assert.ok(dus.rows.every((r) => r.istek === 'olculemedi'));
});

test('IS4 beyan uygulama seviyesinden, harf duyarsiz; location beyani karismaz', () => {
  const beyanlar = new Map([
    ['Kart-Prod/E-UI', { inUse: 'no', inUseBy: 'ayse', inUseAt: '2026-10-18T09:00:00Z', note: 'kapatilabilir' }],
    ['kart-prod/f-ui\u0000/f/', { inUse: 'yes', inUseBy: 'x', note: '' }],
    ['kart-prod/g-ui', { inUse: 'belki', inUseBy: 'y', note: '' }],
  ]);
  const out = kur([A('e-ui'), A('f-ui'), A('g-ui')], { beyanlar });
  const e = satir(out, 'e-ui');
  assert.deepEqual([e.inUse, e.inUseBy, e.note, e.inUseAt], ['no', 'ayse', 'kapatilabilir', '2026-10-18T09:00:00.000Z']);
  assert.equal(satir(out, 'f-ui').inUse, null, 'location beyani uygulama satirina yazildi');
  assert.equal(satir(out, 'g-ui').inUse, null, 'gecersiz beyan gosterildi');
});

test('IS5 degerlendirme olcumu ve beyani yan yana okur', () => {
  const out = kur(
    [
      A('kapat', { istek: 'yok', reqShown: 0 }), A('teyit', { istek: 'yok', reqShown: 0 }), A('cel'),
      A('sy', { istek: 'servis-yok', reqShown: 0 }), A('zayif', { weakEvidence: true, staleClusters: ['gbocpp2'] }),
      A('kullaniyor', { istek: 'yok', reqShown: 0 }),
    ],
    { beyanlar: new Map([['kart-prod/kapat', { inUse: 'no' }], ['kart-prod/cel', { inUse: 'no' }], ['kart-prod/sy', { inUse: 'no' }], ['kart-prod/kullaniyor', { inUse: 'yes' }]]) },
  );
  assert.deepEqual(satir(out, 'kapat').degerlendirme, ['kapatma-adayi']);
  assert.deepEqual(satir(out, 'teyit').degerlendirme, ['teyit-bekliyor']);
  assert.deepEqual(satir(out, 'cel').degerlendirme, ['celiski']);
  assert.deepEqual(satir(out, 'sy').degerlendirme, [], '"servis yok" kapatma adayi YAPILMAMALI (sayilamadi)');
  assert.deepEqual(satir(out, 'zayif').degerlendirme, ['zayif-kanit', 'eski-veri']);
  // istek yok ama ekip "kullaniyor" dedi (ayda bir kullanilan ekran): teyit BEKLENMEZ, aday da degil
  assert.deepEqual(satir(out, 'kullaniyor').degerlendirme, []);
});

test('IS6 ortam ozeti, siralama, sorunlu cluster', () => {
  const out = kur(
    [
      A('p1'), A('p2', { istek: 'yok', reqShown: 0 }), A('p3', { istek: 'servis-yok', reqShown: 0 }), A('p4', { istek: 'yok', reqShown: 0 }),
      A('t1', { namespace: 'kart-test', env: 'test' }), A('x1', { namespace: 'kart', env: null }),
    ],
    {
      beyanlar: new Map([['kart-prod/p2', { inUse: 'no' }]]),
      coverage: { clusters: [
        { cluster: 'gbocpp1', status: 'ok', bucket: 'guncel', stale: false, reason: '' },
        { cluster: 'gbocpp2', status: 'login', bucket: 'taranamadi', stale: true, reason: 'login basarisiz' },
        { cluster: 'gbocpt1', status: 'ok', bucket: 'onceki', stale: true, reason: '' },
      ] },
    },
  );
  assert.deepEqual(out.rows.map((r) => r.env), ['TEST', 'PROD', 'PROD', 'PROD', 'PROD', 'BILINMIYOR']);
  const p = out.envs.find((e) => e.env === 'PROD');
  assert.deepEqual([p.uygulama, p.var, p.yok, p.servisYok, p.olculemedi, p.olcumYok, p.beyanli, p.kapatmaAdayi, p.celiski], [4, 1, 2, 1, 0, 0, 1, 1, 0]);
  assert.deepEqual(out.sorunluCluster.map((c) => c.cluster), ['gbocpp2', 'gbocpt1']);
});

test('IS7 yukleyici: tablo yok, sahipler, onbellek, Dynatrace okunamadi', async () => {
  onbellekSil();
  require('../../audit/ns-owners.cjs')._resetCache();
  const mssql = { sql: SQL, query: async (q) => {
    if (String(q).includes('Openshift_Namespace_Owners')) return { recordset: [{ namespace: 'kart-prod', owner_group_name: 'GT-Kart', owner_email: 'kart@banka.com', lookup_status: 'OK' }] };
    if (String(q).includes('FROM dbo.Nginx_Intranet_Audit')) return { recordset: [] };
    throw new Error('beklenmeyen sorgu');
  } };
  let cagri = 0;
  const yok = await loadIntranet(true, { mssql, loadBeyanlar: async () => new Map(), spaKesfi: async () => ({ tableMissing: true, message: 'dbo.BMW_Spa_Discovery tablosu henüz yok' }) });
  assert.deepEqual([yok.ok, yok.notScanned, yok.rows.length], [true, true, 0]);
  assert.match(yok.message, /BMW_Spa_Discovery/);
  const deps = { mssql, loadBeyanlar: async () => new Map(), spaKesfi: async () => { cagri += 1; return { scanDate: '2026-10-18', apps: [A('z-ui')], coverage: { clusters: [] }, rpKapsam: { dynatraceOkunamadi: true } }; } };
  const r = await loadIntranet(false, deps);
  assert.deepEqual([r.kesifTarihi, r.dynatraceOkunamadi, r.rows[0].ekip, r.rows[0].ekipEposta], ['2026-10-18', true, ['GT-Kart'], ['kart@banka.com']]);
  await loadIntranet(false, deps);
  assert.equal(cagri, 1, 'onbellek kullanilmadi');
  await loadIntranet(true, deps);
  assert.equal(cagri, 2, 'fresh onbellegi asmadi');
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

test('IS8 uclar: rapor, beyan yazimi (kim oturumdan), 400, onbellek silinir', async (t) => {
  onbellekSil();
  let beyan = new Map();
  const yazilan = [];
  const { s, base } = await sunucu({
    mssql: { sql: SQL, query: async () => ({ recordset: [] }) },
    spaKesfi: async () => ({ scanDate: '2026-10-18', apps: [A('z-ui', { istek: 'yok', reqShown: 0 })], coverage: { clusters: [] }, rpKapsam: {} }),
    loadBeyanlar: async () => beyan,
    uygulamaBeyaniYaz: async (b) => {
      yazilan.push(b);
      beyan = new Map([[`${b.namespace}/${b.application}`, { inUse: b.inUse, inUseBy: b.by, note: b.note }]]);
    },
  });
  t.after(() => s.close());
  let r = await fetch(`${base}/intranet`).then((x) => x.json());
  assert.deepEqual(r.rows.map((x) => [x.application, x.istek, x.inUse]), [['z-ui', 'yok', null]]);
  const put = (body) => fetch(`${base}/intranet/declare`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await put({ namespace: 'kart-prod' })).status, 400);
  assert.equal((await put({ namespace: 'kart-prod', application: 'z-ui', inUse: 'belki' })).status, 400);
  // BEYAN EDEN OTURUMDAN: govdeye yazilan ad kullanilmaz.
  const w = await put({ namespace: 'kart-prod', application: 'z-ui', inUse: 'no', note: 'kimse kullanmiyor', by: 'sahte', inUseBy: 'sahte' }).then((x) => x.json());
  assert.equal(w.ok, true);
  assert.equal(w.inUseBy, 'ayse');
  assert.deepEqual(yazilan, [{ namespace: 'kart-prod', application: 'z-ui', inUse: 'no', note: 'kimse kullanmiyor', by: 'ayse' }]);
  r = await fetch(`${base}/intranet`).then((x) => x.json());
  assert.equal(r.rows[0].inUse, 'no', 'beyan sonrasi onbellek silinmedi');
  assert.deepEqual(r.rows[0].degerlendirme, ['kapatma-adayi']);
});

test('IS9 uygulama beyani SPA Raporu ile ayni fonksiyon: varsa UPDATE, yoksa INSERT ark', async () => {
  const { uygulamaBeyaniYaz } = require('../index.cjs');
  dbSorgular.length = 0;
  takipVar = true;
  await uygulamaBeyaniYaz({ namespace: 'kart-prod', application: 'z', inUse: 'yes', note: 'n', by: 'ayse' });
  assert.ok(dbSorgular.some((q) => q.t.startsWith('UPDATE nginx_migration_tracking') && q.p[0] === 'glomo' && q.p[3] === 'ayse'));
  dbSorgular.length = 0;
  takipVar = false;
  await uygulamaBeyaniYaz({ namespace: 'kart-prod', application: 'z', inUse: 'no', note: '', by: 'ayse' });
  assert.ok(dbSorgular.some((q) => q.t.startsWith('INSERT INTO nginx_migration_tracking') && q.t.includes("VALUES ('ark'")));
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  assert.equal((src.match(/INSERT INTO nginx_migration_tracking/g) || []).length, 1, 'ikinci bir uygulama beyani yazim yolu var');
  assert.match(src, /await uygulamaBeyaniYaz\(\{ namespace: ns, application: app2, inUse, note, by \}\);\s*intranetOnbellekSil\(\);/);
});

test('IS10 sayfa kaydi + kesif hesabi paylasilir', () => {
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
  // Gercek SPA Kesfi ile AYNI hesap: nginx-console paylasilan hesabi disa acar, intranet onu cagirir.
  assert.equal(require('../../nginx-console/index.cjs').spaKesfiPaylas.name, 'spaHesapPaylas');
  assert.match(oku('server/spa-report/intranet.cjs'), /require\('\.\.\/nginx-console\/index\.cjs'\)\.spaKesfiPaylas/);
});

test('IS11 kurulum: kendi ortaminin taranan sunucularina gore tamam / kismi / yok', () => {
  const out = kur(
    [A('tam-ui'), A('yarim-ui'), A('tek-ui'), A('yok-ui'), A('ek-ui'), A('test-ui', { namespace: 'kart-test', env: 'test' })],
    {
      hosts: PROD_INTRA,
      dirRows: [
        DZ('GBNGXP50', 'kart-prod', 'tam-ui'), DZ('GBNGXP51', 'kart-prod', 'tam-ui'),
        DZ('GBNGXP50', 'kart-prod', 'yarim-ui'), DZ('GBNGXP51', 'kart-prod', 'yarim-ui', { app_deployed: 0, status: 'MISSING_APP' }),
        DZ('GBNGXP51', 'kart-prod', 'tek-ui'),
        // baska ortamin sunucusu: PROD uygulamasinin kurulumuna SAYILMAZ
        DZ('GBNGXT50', 'kart-prod', 'yok-ui'),
        // '-prod' eksiz dizin ns'i
        DZ('GBNGXP50', 'kart', 'ek-ui'), DZ('GBNGXP51', 'kart', 'ek-ui'),
        DZ('GBNGXT50', 'kart-test', 'test-ui'),
      ],
    },
  );
  const k = (app) => satir(out, app).kurulum;
  // GBNGXAP50 o gun taranmadi: eksik SAYILMAZ, ayrica listelenir
  assert.deepEqual([k('tam-ui').durum, k('tam-ui').tam, k('tam-ui').beklenen, k('tam-ui').taranmayan], ['tamam', 2, 2, ['GBNGXAP50']]);
  assert.deepEqual([k('yarim-ui').durum, k('yarim-ui').tam, k('yarim-ui').eksik], ['kismi', 1, ['GBNGXP51']]);
  assert.equal(k('yarim-ui').sunucular.find((x) => x.host === 'GBNGXP51').status, 'MISSING_APP');
  assert.deepEqual([k('tek-ui').durum, k('tek-ui').eksik], ['kismi', ['GBNGXP50']]);
  assert.equal(k('tek-ui').sunucular.find((x) => x.host === 'GBNGXP50').status, 'YOK');
  assert.equal(k('yok-ui').durum, 'yok', 'TEST sunucusundaki dizin PROD uygulamasina sayildi');
  assert.deepEqual([k('ek-ui').durum, k('ek-ui').eslesme], ['tamam', 'ek-prod']);
  assert.deepEqual([k('test-ui').durum, k('test-ui').beklenen], ['tamam', 1]);
  assert.equal(k('tam-ui').eslesme, 'kesin');
  assert.deepEqual(out.taranmayanSunucu, ['GBNGXAP50']);
  assert.equal(out.dizinTarihi, '2026-10-18');
});

test('IS12 kurulum olculemedi / sunucu-yok; ortam ozeti', () => {
  const apps = [A('a-ui'), A('x-ui', { namespace: 'kart', env: null })];
  const dus = kur(apps, { hosts: PROD_INTRA, dirRows: null, dizinDurum: 'okunamadi' });
  assert.equal(satir(dus, 'a-ui').kurulum.durum, 'olculemedi', 'dizin okunamadi ama kurulum karari verildi');
  assert.deepEqual(dus.taranmayanSunucu, PROD_INTRA);
  // ortamin hicbir intranet sunucusu taranmadi (yalniz TEST taranmis)
  const tarama = kur(apps, { hosts: PROD_INTRA, dirRows: [DZ('GBNGXT50', 'kart-test', 'z-ui')] });
  assert.equal(satir(tarama, 'a-ui').kurulum.durum, 'olculemedi');
  assert.equal(satir(tarama, 'x-ui').kurulum.durum, 'sunucu-yok');
  const out = kur([A('t1'), A('t2'), A('k1'), A('y1'), A('y2')], {
    hosts: ['GBNGXP50', 'GBNGXP51'],
    dirRows: [DZ('GBNGXP50', 'kart-prod', 't1'), DZ('GBNGXP51', 'kart-prod', 't1'), DZ('GBNGXP50', 'kart-prod', 't2'), DZ('GBNGXP51', 'kart-prod', 't2'), DZ('GBNGXP50', 'kart-prod', 'k1')],
  });
  const p = out.envs.find((e) => e.env === 'PROD');
  assert.deepEqual([p.kurulumTamam, p.kurulumKismi, p.kurulumYok], [2, 1, 2]);
  // dizin okunamadi: beklenen sunucularin HEPSI taranmayan (olculemedi), "eksik" degil
  assert.deepEqual([satir(dus, 'a-ui').kurulum.taranmayan, satir(dus, 'a-ui').kurulum.eksik], [['GBNGXAP50', 'GBNGXP50', 'GBNGXP51'], []]);
});

test('IS13 yukleyici dizin tablosunu intranet sunuculariyla okur; sorgu duserse olculemedi', async () => {
  require('../../audit/ns-owners.cjs')._resetCache();
  const sorgular = [];
  let dizinDussun = false;
  const mssql = { sql: SQL, query: async (q, params) => {
    sorgular.push({ q: String(q), params });
    if (String(q).includes('FROM dbo.Nginx_Intranet_Audit')) {
      if (dizinDussun) throw new Error('Invalid object name');
      return { recordset: [DZ('GBNGXP50', 'kart-prod', 'z-ui'), DZ('GBNGXP51', 'kart-prod', 'z-ui')] };
    }
    return { recordset: [] };
  } };
  const deps = { mssql, loadBeyanlar: async () => new Map(), spaKesfi: async () => ({ scanDate: '2026-10-18', apps: [A('z-ui')], coverage: { clusters: [] }, rpKapsam: {} }) };
  onbellekSil();
  const r = await loadIntranet(true, deps);
  const q = sorguBul(sorgular);
  assert.ok(q.params.some((p) => p.value === 'GBNGXAP51') && q.params.some((p) => p.value === 'GBNGXD50'), 'intranet sunuculari sorguda yok');
  assert.ok(!q.params.some((p) => p.value === 'GBNGXP40'), 'internet sunucusu intranet kurulumuna girdi');
  assert.equal(r.dizinDurum, 'var');
  assert.equal(r.rows[0].kurulum.tam, 2);
  dizinDussun = true;
  onbellekSil();
  const d = await loadIntranet(true, deps);
  assert.equal(d.dizinDurum, 'okunamadi');
  assert.equal(d.rows[0].kurulum.durum, 'olculemedi');
});
const sorguBul = (sorgular) => sorgular.find((x) => x.q.includes('FROM dbo.Nginx_Intranet_Audit'));
