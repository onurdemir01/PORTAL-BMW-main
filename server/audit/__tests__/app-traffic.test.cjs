// server/audit/__tests__/app-traffic.test.cjs — UT1..UT12 (2026-10-06).
//
// Denetim ▸ Uygulama Trafiği. Birim UYGULAMA, omurga dbo.BMW_Spa_Discovery.
// Kullanici: "Namespace - Uygulama - Ortam/SPA - İstek - Route - Cluster", "her bir
// uygulama icin tek satir olmali", "uygulamanin pod ismi degil direkt kendi ismi
// yazilmali", "4 prod cluster'in 4'unde de varsa 4/4 Tam, 3'unde varsa 3/4 Kismi".
//
// EN PAHALI UC YANLIS, bu bekcilerin kilitledigi sey:
//   1. "olculemedi"yi "yok" gostermek (istek 0 / SPA degil) -> emeklilik karari bozulur
//   2. Hic erisilemeyen cluster'i eksiklik saymak -> UYDURMA "3/4 Kismi" raporu
//   3. Pod adini uygulama adi sanmak -> ekranin ilk halinin asil kusuru
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildAppTraffic } = require('../app-traffic.cjs');

const sp = (cluster, namespace, route, workload, is_spa = 1, extra = {}) => ({
  cluster,
  namespace,
  route,
  host: `${route}-${namespace}.apps.fw.garanti.com.tr`,
  workload,
  workload_kind: workload ? 'Deployment' : null,
  is_spa,
  scan_date: '2026-10-06',
  ...extra,
});
const run = (cluster, durum) => ({ cluster, durum, scan_date: '2026-10-06' });
const kat = (cluster, env, tenant = 'ark') => ({ cluster_name: cluster, env, tenant });
const kul = (namespace, app, req_total, measured = 1, note = '') => ({
  namespace,
  app,
  req_total,
  measured,
  note,
  scan_date: '2026-10-06',
});

const PROD = [kat('c1', 'prod'), kat('c2', 'prod'), kat('c3', 'prod'), kat('c4', 'prod')];
const PROD_RUNS = [run('c1', 'ok'), run('c2', 'kismi'), run('c3', 'ok'), run('c4', 'kismi')];

test('UT1 UYGULAMA BASINA TEK SATIR: ayni uygulama 4 cluster"da 1 satir', () => {
  const r = buildAppTraffic({
    spa: ['c1', 'c2', 'c3', 'c4'].map((c) => sp(c, 'acc-prod', 'acc-app', 'acc-app-v0')),
    runs: PROD_RUNS,
    usage: [kul('acc-prod', 'acc-app-v0', 500)],
    clusters: PROD,
  });
  assert.equal(r.rows.length, 1, 'cluster basina ayri satir uretilmis');
  assert.equal(r.rows[0].app, 'acc-app-v0');
  assert.deepEqual(r.rows[0].clusters, ['c1', 'c2', 'c3', 'c4']);
});

test('UT2 KAPSAM 4/4 Tam ve 3/4 Kismi', () => {
  const tam = buildAppTraffic({
    spa: ['c1', 'c2', 'c3', 'c4'].map((c) => sp(c, 'x-prod', 'x', 'x-v0')),
    runs: PROD_RUNS,
    usage: [],
    clusters: PROD,
  }).rows[0];
  assert.equal(tam.coverage, 'full');
  assert.equal(tam.coveragePresent, 4);
  assert.equal(tam.coverageTotal, 4);

  const kismi = buildAppTraffic({
    spa: ['c1', 'c2', 'c3'].map((c) => sp(c, 'x-prod', 'x', 'x-v0')),
    runs: PROD_RUNS,
    usage: [],
    clusters: PROD,
  }).rows[0];
  assert.equal(kismi.coverage, 'partial');
  assert.equal(kismi.coveragePresent, 3);
  assert.equal(kismi.coverageTotal, 4);
});

test('UT3 ERISILEMEYEN CLUSTER PAYDAYA GIRMEZ (uydurma eksiklik raporu yok)', () => {
  // c4'e hic girilemedi (login dustu). Uygulama c1-c2-c3'te var. "3/4 Kismi" demek
  // YANLIS: c4'te var mi yok mu BILMIYORUZ. Payda 3 olur (3/3 Tam) ve "1 cluster
  // olculemedi" AYRICA raporlanir.
  const runs = [run('c1', 'ok'), run('c2', 'ok'), run('c3', 'ok'), run('c4', 'login')];
  const row = buildAppTraffic({
    spa: ['c1', 'c2', 'c3'].map((c) => sp(c, 'x-prod', 'x', 'x-v0')),
    runs,
    usage: [],
    clusters: PROD,
  }).rows[0];
  assert.equal(row.coverageTotal, 3, 'erisilemeyen cluster paydaya girmis');
  assert.equal(row.coverage, 'full', 'erisilemeyen cluster yuzunden Kismi denmis');
  assert.equal(row.coverageUnmeasured, 1, 'olculemeyen cluster sayisi gorunmuyor');
});

test('UT4 "kismi" durumu TARANDI sayilir (route varligi guvenilir)', () => {
  // `kismi` = route'lar okundu, bazi namespace'lerin SERVISLERI okunamadi. Route'un o
  // cluster'da olup olmadigi guvenilir; eksik olan is yuku eslemesidir. Bu cluster'i
  // paydadan dusurmek, olculmus bir bilgiyi atmak olurdu.
  const row = buildAppTraffic({
    spa: [sp('c1', 'x-prod', 'x', 'x-v0'), sp('c2', 'x-prod', 'x', 'x-v0')],
    runs: [run('c1', 'ok'), run('c2', 'kismi')],
    usage: [],
    clusters: [kat('c1', 'prod'), kat('c2', 'prod')],
  }).rows[0];
  assert.equal(row.coverageTotal, 2);
  assert.equal(row.coverage, 'full');
});

test('UT5 ISTEK UC DEGERLI: aktif / atil / OLCULEMEDI', () => {
  const g = (usage) =>
    buildAppTraffic({
      spa: [sp('c1', 'x-prod', 'x', 'x-v0')],
      runs: [run('c1', 'ok')],
      usage,
      clusters: [kat('c1', 'prod')],
    }).rows[0];
  assert.equal(g([kul('x-prod', 'x-v0', 120)]).reqStatus, 'active');
  assert.equal(g([kul('x-prod', 'x-v0', 120)]).req, 120);
  assert.equal(g([kul('x-prod', 'x-v0', 0)]).reqStatus, 'idle');
  // measured=0 -> sayi bir alt sinir bile degil
  assert.equal(g([kul('x-prod', 'x-v0', 7, 0)]).reqStatus, 'unmeasured');
  assert.equal(g([kul('x-prod', 'x-v0', 7, 0)]).req, null, 'olculemeyen istek SAYI donmus');
  // kullanim satiri HIC yok -> olculemedi, 0 DEGIL
  assert.equal(g([]).reqStatus, 'unmeasured');
  assert.equal(g([]).req, null, 'kullanim satiri olmayan uygulama 0 istek gosterilmis');
});

test('UT6 SPA UC DEGERLI ve OLCULMUS (ad kalibi YOK)', () => {
  const g = (is_spa, workload) =>
    buildAppTraffic({
      spa: [sp('c1', 'x-prod', 'x', workload, is_spa)],
      runs: [run('c1', 'ok')],
      usage: [],
      clusters: [kat('c1', 'prod')],
    }).rows[0];
  // Adi '-app-v' kalibina UYMUYOR ama olcum SPA diyor -> SPA
  assert.equal(g(1, 'bambaska-ad').spa, 'yes', 'olculmus SPA ad kalibina kurban edilmis');
  // Adi kaliba UYUYOR ama olcum SPA DEGIL diyor -> degil
  assert.equal(g(0, 'legacy-app-v0').spa, 'no', 'ad kalibi olcumu ezmis');
  // Is yukune eslesmemis route -> OLCULEMEDI ("degil" DEGIL)
  assert.equal(g(0, '').spa, 'unknown', 'eslesmeyen route "SPA degil" sayilmis');
});

test('UT7 ESLESMEYEN ROUTE GIZLENMEZ, ayri satir olur ve EN USTTE durur', () => {
  const r = buildAppTraffic({
    spa: [sp('c1', 'x-prod', 'bilinmeyen-route', ''), sp('c1', 'x-prod', 'x', 'x-v0')],
    runs: [run('c1', 'ok')],
    usage: [],
    clusters: [kat('c1', 'prod')],
  });
  assert.equal(r.rows.length, 2);
  const esz = r.rows.find((x) => !x.matched);
  assert.ok(esz, 'eslesmeyen route satiri yok - route Portal"da gorunmez olur');
  assert.equal(esz.app, null);
  assert.deepEqual(
    esz.routes.map((x) => x.route),
    ['bilinmeyen-route'],
  );
  assert.equal(r.summary.unmatched, 1);
  assert.equal(r.rows[0].matched, false, 'eslesmeyenler ustte degil');
});

test('UT8 ROUTE KOLONU DOLU: uygulamanin route"lari satirda, yinelenmeden', () => {
  const row = buildAppTraffic({
    spa: [
      sp('c1', 'x-prod', 'x-ana', 'x-v0'),
      sp('c1', 'x-prod', 'x-yedek', 'x-v0'),
      sp('c2', 'x-prod', 'x-ana', 'x-v0'),
    ],
    runs: [run('c1', 'ok'), run('c2', 'ok')],
    usage: [],
    clusters: [kat('c1', 'prod'), kat('c2', 'prod')],
  }).rows[0];
  assert.deepEqual(
    row.routes.map((r) => r.route).sort(),
    ['x-ana', 'x-yedek'],
    'route kolonu bos ya da yineleniyor',
  );
  assert.ok(row.routes[0].host, 'host (adres) tasinmiyor');
});

test('UT9 UYGULAMA ADI `workload`DAN gelir - POD adi DEGIL', () => {
  // Ekranin ilk halinin asil kusuru: ad Dynatrace displayName'den geliyordu ve
  // type("CLOUD_APPLICATION") POD'lari da donuyor.
  const row = buildAppTraffic({
    spa: [sp('c1', 'bpm-prod', 'bpm', 'bpm-prcss-v0')],
    runs: [run('c1', 'ok')],
    usage: [],
    clusters: [kat('c1', 'prod')],
  }).rows[0];
  assert.equal(row.app, 'bpm-prcss-v0');
  assert.ok(!/-[0-9a-f]{8,10}$/.test(row.app), 'uygulama adi pod/replicaset eki tasiyor');
  assert.equal(row.kind, 'Deployment');
});

test('UT10 ORTAM katalogdan; cluster katalogda yoksa namespace son-ekinden', () => {
  const katalogdan = buildAppTraffic({
    spa: [sp('c1', 'x-prod', 'x', 'x-v0')],
    runs: [run('c1', 'ok')],
    usage: [],
    clusters: [kat('c1', 'prod')],
  }).rows[0];
  assert.equal(katalogdan.env, 'prod');
  // Katalogda olmayan cluster: ortam namespace'ten turetilir, kapsam ise OLCULEMEZ
  const yedek = buildAppTraffic({
    spa: [sp('bilinmeyen', 'digital-ch-test', 'x', 'x-v0')],
    runs: [run('bilinmeyen', 'ok')],
    usage: [],
    clusters: [],
  }).rows[0];
  assert.ok(yedek.env, 'ortam hic cozulememis');
  assert.equal(yedek.coverage, 'unknown', 'payda yokken kapsam iddia edilmis');
});

test('UT11 OZET SUZGECTEN ONCE hesaplanir', () => {
  const veri = {
    spa: [
      sp('c1', 'a-prod', 'a', 'a-v0'),
      sp('c1', 'b-prod', 'b', 'b-v0'),
      sp('c1', 'c-prod', 'c', 'c-v0'),
    ],
    runs: [run('c1', 'ok')],
    usage: [kul('a-prod', 'a-v0', 10)],
    clusters: [kat('c1', 'prod')],
  };
  const hepsi = buildAppTraffic(veri, {});
  const suzulmus = buildAppTraffic(veri, { q: 'a-prod' });
  assert.equal(suzulmus.rows.length, 1);
  assert.deepEqual(
    suzulmus.summary,
    hepsi.summary,
    'ozet suzgecten SONRA hesaplanmis - "filoda durum bu" diye yanlis okunur',
  );
  assert.equal(suzulmus.filtered, 1);
});

test('UT12 SUZGECLER: ortam / SPA / durum / kapsam / limit', () => {
  const veri = {
    spa: [
      sp('c1', 'a-prod', 'a', 'a-v0', 1),
      sp('c1', 'b-prod', 'b', 'b-v0', 0),
      sp('c1', 'c-prod', 'c', ''),
    ],
    runs: [run('c1', 'ok'), run('c2', 'ok')],
    usage: [kul('a-prod', 'a-v0', 10)],
    clusters: [kat('c1', 'prod'), kat('c2', 'prod')],
  };
  assert.equal(buildAppTraffic(veri, { spa: 'yes' }).rows.length, 1);
  assert.equal(buildAppTraffic(veri, { spa: 'unknown' }).rows.length, 1);
  assert.equal(buildAppTraffic(veri, { status: 'active' }).rows.length, 1);
  assert.equal(buildAppTraffic(veri, { status: 'unmeasured' }).rows.length, 2);
  assert.equal(buildAppTraffic(veri, { env: 'prod' }).rows.length, 3);
  // Hepsi yalniz c1'de, ortamda 2 taranmis cluster var -> 1/2 Kismi
  assert.equal(buildAppTraffic(veri, { coverage: 'partial' }).rows.length, 3);
  assert.equal(buildAppTraffic(veri, { limit: 2 }).rows.length, 2);
});
