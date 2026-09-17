// server/audit/__tests__/nginx-migration.test.cjs
//
// Nginx SPA > "Prod Tasima" (2026-09-14): eski GBRVP* proxy_pass hedefleri yeni
// GBNGXP4x/5x sunucularinda dizin olarak var mi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildMigration, resolveTarget, MIGRATION_GROUPS } = require('../nginx-migration.cjs');

const APPS = '.apps.fw.garanti.com.tr';
const P = (host, service, location, target, upstream = 'ups') => ({
  host, vhost: service + '-PROD.conf', service, location, upstream_name: upstream, target_url: target,
});
const D = (host, namespace, application, hys = 1, app = 1, conf = 1) => ({
  host, namespace, application, hys_deployed: hys, app_deployed: app, conf_exists: conf,
});

test('gruplar kullanicinin verdigi sunucularla BIREBIR', () => {
  const g = Object.fromEntries(MIGRATION_GROUPS.map((x) => [x.id, x]));
  assert.deepEqual(g.glomo.oldHosts, ['GBRVPP07', 'GBRVPP08', 'GBRVPP09', 'GBRVPP10', 'GBRVPAP03', 'GBRVPAP04', 'GBRVPAP05', 'GBRVPAP06']);
  assert.deepEqual(g.glomo.newHosts, ['GBNGXP40', 'GBNGXP41', 'GBNGXP48', 'GBNGXP49', 'GBNGXAP24', 'GBNGXAP25']);
  assert.deepEqual(g.other.oldHosts, ['GBRVPP01', 'GBRVPP02', 'GBRVPAP01', 'GBRVPAP02']);
  assert.deepEqual(g.other.newHosts, ['GBNGXP44', 'GBNGXP45', 'GBNGXP58', 'GBNGXP59', 'GBNGXAP28', 'GBNGXAP29']);
});

test('hedef cozumu: route adresi KESIN; tireli ns/app belirsizligi dogmaz; yedek envanter; belirsiz/cozulemedi ayri', () => {
  // "sube-portali-app-v1-kurumsal-prod": app = sube-portali-app-v1, ns = kurumsal-prod.
  // Route envanteri namespace'i soyler, etiketten "-kurumsal-prod" TAM kesilir.
  const routeByAddress = new Map([['sube-portali-app-v1-kurumsal-prod' + APPS, 'kurumsal-prod']]);
  const ocpByLabel = new Map([
    ['x-app-v2-glomo-prod', [{ namespace: 'glomo-prod', application: 'x-app-v2' }]],
    ['a-b-app-v1-c-prod', [
      { namespace: 'c-prod', application: 'a-b-app-v1' },
      { namespace: 'b-c-prod', application: 'a-app-v1' }, // etiketi ayni ureten ikinci cift
    ]],
  ]);
  let r = resolveTarget('sube-portali-app-v1-kurumsal-prod' + APPS, routeByAddress, ocpByLabel);
  assert.deepEqual([r.namespace, r.application, r.how], ['kurumsal-prod', 'sube-portali-app-v1', 'route']);
  r = resolveTarget('https://x-app-v2-glomo-prod' + APPS + ':443/', routeByAddress, ocpByLabel);
  assert.equal(r.how, 'unresolved', 'hostOf uygulanmadan tam URL gecirilirse etiket bulunmaz (cagiran hostOf uygular)');
  r = resolveTarget('x-app-v2-glomo-prod' + APPS, routeByAddress, ocpByLabel);
  assert.deepEqual([r.namespace, r.application, r.how], ['glomo-prod', 'x-app-v2', 'inventory']);
  r = resolveTarget('a-b-app-v1-c-prod' + APPS, routeByAddress, ocpByLabel);
  assert.equal(r.how, 'ambiguous');
  assert.equal(r.candidates.length, 2);
  r = resolveTarget('bilinmeyen-app-v9-yok-prod' + APPS, routeByAddress, ocpByLabel);
  assert.equal(r.how, 'unresolved');
});

test('uygulama satiri: her yeni sunucuda hys+app var mi; hazir / kismi / eksik / taranmadi', () => {
  const out = buildMigration({
    proxyRows: [
      // Glomo: iki eski sunucu ayni uygulamaya, farkli location'lardan
      P('GBRVPP07', 'GLOMO', '/hazir/', 'hazir-app-v1-glomo-prod' + APPS),
      P('GBRVPP08', 'GLOMO', '/hazir2/', 'hazir-app-v1-glomo-prod' + APPS),
      P('GBRVPP07', 'GLOMO', '/kismi/', 'kismi-app-v1-glomo-prod' + APPS),
      P('GBRVPP07', 'GLOMO', '/eksik/', 'eksik-app-emb-v2-glomo-prod' + APPS),
      // target_url bos: upstream'in server host'undan cozulur
      P('GBRVPP09', 'GLOMO', '/ups/', '', 'ups-hazir'),
      // SPA olmayan arka uc: dizin beklenmez
      P('GBRVPP07', 'GLOMO', '/api/', 'glomo-api-glomo-prod' + APPS),
      // SPA kalibinda ama envanterde yok: cozulemedi
      P('GBRVPP10', 'GLOMO', '/hayalet/', 'hayalet-app-v1-yok-prod' + APPS),
      // Diger grup - Glomo'ya KARISMAMALI
      P('GBRVPP01', 'WEBFORMS', '/wf/', 'wf-app-v1-webforms-prod' + APPS),
      // Tasima disi sunucu - hic sayilmamali
      P('GBNGXT33', 'GLOMO', '/test/', 'hazir-app-v1-glomo-test' + APPS),
    ],
    upstreamRows: [{ host: 'GBRVPP09', name: 'ups-hazir', server: 'hazir-app-v1-glomo-prod' + APPS + ':443' }],
    routeRows: [
      { namespace_name: 'glomo-prod', route_address: 'hazir-app-v1-glomo-prod' + APPS },
      { namespace_name: 'glomo-prod', route_address: 'glomo-api-glomo-prod' + APPS },
    ],
    ocpRows: [
      { namespace: 'glomo-prod', application: 'kismi-app-v1' },
      { namespace: 'glomo-prod', application: 'eksik-app-emb-v2' },
      { namespace: 'webforms-prod', application: 'wf-app-v1' },
    ],
    dirRows: [
      // 6 yeni Glomo sunucusunun 5'i taranmis (GBNGXAP25 yok)
      ...['GBNGXP40', 'GBNGXP41', 'GBNGXP48', 'GBNGXP49', 'GBNGXAP24'].map((h) => D(h, 'glomo-prod', 'hazir-app-v1')),
      D('GBNGXP40', 'glomo-prod', 'kismi-app-v1'),
      D('GBNGXP41', 'glomo-prod', 'kismi-app-v1', 1, 0, 1), // hys var, app yok -> hazir degil
      // eksik-app-emb-v2 hicbir yeni sunucuda yok
      D('GBNGXP44', 'webforms-prod', 'wf-app-v1'),
    ],
  });
  const glomo = out.find((g) => g.id === 'glomo');
  const other = out.find((g) => g.id === 'other');

  assert.deepEqual(glomo.newHostsScanned, ['GBNGXP40', 'GBNGXP41', 'GBNGXP48', 'GBNGXP49', 'GBNGXAP24']);
  assert.deepEqual(glomo.oldHostsSeen, ['GBRVPP07', 'GBRVPP08', 'GBRVPP09', 'GBRVPP10']);

  const by = Object.fromEntries(glomo.apps.map((a) => [a.application, a]));
  assert.deepEqual(Object.keys(by).sort(), ['eksik-app-emb-v2', 'hazir-app-v1', 'kismi-app-v1']);

  // hazir: 5 taranan sunucuda var ama 6. taranmadi -> 'partial' (tam hazir DENEMEZ)
  assert.equal(by['hazir-app-v1'].status, 'partial');
  assert.equal(by['hazir-app-v1'].readyHosts, 5);
  assert.equal(by['hazir-app-v1'].perHost.GBNGXAP25, null, 'taranmayan sunucu null');
  assert.deepEqual(by['hazir-app-v1'].oldHosts, ['GBRVPP07', 'GBRVPP08', 'GBRVPP09'], 'upstream server host ile cozulen GBRVPP09 dahil');
  assert.equal(by['hazir-app-v1'].locationCount, 3);
  assert.equal(by['hazir-app-v1'].how, 'route');

  assert.equal(by['kismi-app-v1'].status, 'partial');
  assert.equal(by['kismi-app-v1'].readyHosts, 1, 'GBNGXP41 app_deployed=0 -> hazir sayilmaz');
  assert.equal(by['kismi-app-v1'].how, 'inventory');

  assert.equal(by['eksik-app-emb-v2'].status, 'missing');
  assert.equal(by['eksik-app-emb-v2'].readyHosts, 0);

  // Siralama: eksik > kismi > hazir
  assert.equal(glomo.apps[0].application, 'eksik-app-emb-v2');

  // SPA olmayan ve cozulemeyen AYRI, eksik SAYILMAZ
  assert.equal(glomo.nonSpa.length, 1);
  assert.equal(glomo.nonSpa[0].application, 'glomo-api');
  assert.equal(glomo.unresolved.length, 1);
  assert.equal(glomo.unresolved[0].target, 'hayalet-app-v1-yok-prod' + APPS);
  assert.deepEqual(glomo.totals, { locations: { total: 7, defined: 0, partial: 0, none: 7, notScanned: 0 }, apps: 3, ready: 0, partial: 2, missing: 1, notScanned: 0, nonSpa: 1, unresolved: 1 });

  // Diger grup: yalniz GBNGXP44 taranmis -> partial; Glomo satiri sizmamis
  assert.equal(other.apps.length, 1);
  assert.equal(other.apps[0].application, 'wf-app-v1');
  assert.equal(other.apps[0].status, 'partial');
});

test('hic yeni sunucu taranmamissa uygulama satiri "not-scanned" - "eksik" DEGIL', () => {
  const out = buildMigration({
    proxyRows: [P('GBRVPP01', 'WEBFORMS', '/wf/', 'wf-app-v1-webforms-prod' + APPS)],
    upstreamRows: [],
    routeRows: [{ namespace_name: 'webforms-prod', route_address: 'wf-app-v1-webforms-prod' + APPS }],
    ocpRows: [],
    dirRows: [],
  });
  const other = out.find((g) => g.id === 'other');
  assert.equal(other.apps[0].status, 'not-scanned');
  assert.equal(other.totals.notScanned, 1);
  assert.equal(other.totals.missing, 0);
});

// ── proxy_pass yazim bicimleri (kullanici, 2026-09-14) ──────────────────────────────
// Dort yazim: FQDN, FQDN/, <app>-<ns> (upstream), <app>-<ns>/ (upstream). Tarayici
// sema/yol/portu attigi icin DB'de FQDN ya da ciplak ad kalir; ikisi de ayni
// uygulamaya cozulmeli. Ayrica takma adli upstream ("onur") server satirindan cozulur.
test('dort proxy_pass yazimi da ayni uygulamaya cozulur; takma adli upstream server satirindan', () => {
  const R = (host, loc, upstream_name, target_url = '') => P(host, 'GLOMO', loc, target_url, upstream_name);
  const out = buildMigration({
    proxyRows: [
      // FQDN (yolsuz ve yollu - tarayici ikisini de host'a indirger), proxy_ssl_name YOK
      R('GBRVPP07', '/a/', 'x-app-v1-glomo-prod' + APPS),
      R('GBRVPP08', '/b/', 'x-app-v1-glomo-prod' + APPS),
      // ciplak upstream adi, proxy_ssl_name YOK, nginx_audit upstream satiri da YOK
      // -> route envanterinde ILK ETIKET eslesmesiyle cozulmeli (route kesinligi)
      R('GBRVPP09', '/c/', 'x-app-v1-glomo-prod'),
      // ciplak upstream adi + nginx_audit server satiri var
      R('GBRVPP10', '/d/', 'x-app-v1-glomo-prod'),
      // takma adli upstream: adi hicbir kaliba uymaz, server satiri gercek adresi verir
      R('GBRVPAP03', '/e/', 'onur'),
      // envanterde route'u olmayan ciplak ad -> OpenShift envanter ciftinden (yedek)
      R('GBRVPAP04', '/f/', 'y-app-v2-glomo-prod'),
    ],
    upstreamRows: [
      { host: 'GBRVPP10', name: 'x-app-v1-glomo-prod', server: 'x-app-v1-glomo-prod' + APPS + ':443' },
      { host: 'GBRVPAP03', name: 'onur', server: 'https://x-app-v1-glomo-prod' + APPS + '/' },
    ],
    routeRows: [{ namespace_name: 'glomo-prod', route_address: 'x-app-v1-glomo-prod' + APPS }],
    ocpRows: [{ namespace: 'glomo-prod', application: 'y-app-v2' }],
    dirRows: [],
  });
  const glomo = out.find((g) => g.id === 'glomo');
  const by = Object.fromEntries(glomo.apps.map((a) => [a.application, a]));
  assert.deepEqual(Object.keys(by).sort(), ['x-app-v1', 'y-app-v2']);
  const x = by['x-app-v1'];
  assert.equal(x.namespace, 'glomo-prod');
  assert.equal(x.how, 'route');
  assert.deepEqual(x.oldHosts, ['GBRVPAP03', 'GBRVPP07', 'GBRVPP08', 'GBRVPP09', 'GBRVPP10'], 'bes yazim tek satirda toplanmali');
  assert.deepEqual(x.forms, ['fqdn', 'upstream']);
  assert.deepEqual(x.written, ['onur', 'x-app-v1-glomo-prod', 'x-app-v1-glomo-prod' + APPS]);
  assert.equal(x.locationCount, 5);
  assert.equal(glomo.unresolved.length, 0, 'takma ad "onur" cozulemedi listesine DUSMEMELI');
  const y = by['y-app-v2'];
  assert.equal(y.how, 'inventory');
  assert.deepEqual(y.forms, ['upstream']);
});

test('gercek arka uc oncelik sirasi: upstream server > proxy_ssl_name > yazilan ad', () => {
  const out = buildMigration({
    proxyRows: [
      // ucu de var ve FARKLI: upstream server satiri kazanmali
      P('GBRVPP01', 'WEBFORMS', '/w/', 'sni-app-v1-webforms-prod' + APPS, 'takma'),
      // yalniz proxy_ssl_name var
      P('GBRVPP02', 'WEBFORMS', '/z/', 'ssl-app-v1-webforms-prod' + APPS, 'takma2'),
    ],
    upstreamRows: [{ host: 'GBRVPP01', name: 'takma', server: 'ups-app-v1-webforms-prod' + APPS }],
    routeRows: [
      { namespace_name: 'webforms-prod', route_address: 'ups-app-v1-webforms-prod' + APPS },
      { namespace_name: 'webforms-prod', route_address: 'sni-app-v1-webforms-prod' + APPS },
      { namespace_name: 'webforms-prod', route_address: 'ssl-app-v1-webforms-prod' + APPS },
    ],
    ocpRows: [],
    dirRows: [],
  });
  const other = out.find((g) => g.id === 'other');
  const by = Object.fromEntries(other.apps.map((a) => [a.application, a]));
  assert.ok(by['ups-app-v1'] && !by['sni-app-v1'], 'upstream server satiri proxy_ssl_name\'i gecmeli');
  assert.equal(by['ups-app-v1'].targetSource, 'upstream-server');
  assert.equal(by['ssl-app-v1'].targetSource, 'proxy_ssl_name');
});

// ── "-prod" eki (kullanici, 2026-09-14): eski yazimda <Namespace> "-prod" eksiz ─────
test('"-prod" eksiz yazim: once oldugu gibi, tutmazsa -prod eklenerek cozulur ve isaretlenir', () => {
  const routeByAddress = new Map([['base-app-v0-digital-banking-ch-prod' + APPS, 'digital-banking-ch-prod']]);
  const routeByLabel = new Map([['base-app-v0-digital-banking-ch-prod', 'digital-banking-ch-prod']]);
  const ocpByLabel = new Map([['other-app-v1-x-ch-prod', [{ namespace: 'x-ch-prod', application: 'other-app-v1' }]]]);

  // ciplak upstream adi, -prod yok -> route etiketiyle (-prod eklenerek)
  let r = resolveTarget('base-app-v0-digital-banking-ch', routeByAddress, ocpByLabel, routeByLabel);
  assert.deepEqual([r.namespace, r.application, r.how, r.suffixAdded], ['digital-banking-ch-prod', 'base-app-v0', 'route', true]);
  // FQDN, -prod yok -> adres -prod eklenerek birebir
  r = resolveTarget('base-app-v0-digital-banking-ch' + APPS, routeByAddress, ocpByLabel, routeByLabel);
  assert.deepEqual([r.namespace, r.how, r.suffixAdded], ['digital-banking-ch-prod', 'route', true]);
  // -prod zaten varsa ek DENENMEZ, isaret yok
  r = resolveTarget('base-app-v0-digital-banking-ch-prod', routeByAddress, ocpByLabel, routeByLabel);
  assert.deepEqual([r.namespace, r.suffixAdded], ['digital-banking-ch-prod', false]);
  // envanter yedegi de -prod ile
  r = resolveTarget('other-app-v1-x-ch', routeByAddress, ocpByLabel, routeByLabel);
  assert.deepEqual([r.namespace, r.application, r.how, r.suffixAdded], ['x-ch-prod', 'other-app-v1', 'inventory', true]);
  // hicbiri: cozulemedi
  r = resolveTarget('yok-app-v1-yok-ch', routeByAddress, ocpByLabel, routeByLabel);
  assert.equal(r.how, 'unresolved');

  // Uctan uca: satirda suffixAdded ve namespace -prod'lu (ekip/dizin eslesmesi buna bagli)
  const out = buildMigration({
    proxyRows: [P('GBRVPP07', 'GLOMO', '/base/', '', 'base-app-v0-digital-banking-ch')],
    upstreamRows: [],
    routeRows: [{ namespace_name: 'digital-banking-ch-prod', route_address: 'base-app-v0-digital-banking-ch-prod' + APPS }],
    ocpRows: [],
    dirRows: [D('GBNGXP40', 'digital-banking-ch-prod', 'base-app-v0')],
  });
  const a = out.find((g) => g.id === 'glomo').apps[0];
  assert.equal(a.namespace, 'digital-banking-ch-prod');
  assert.equal(a.suffixAdded, true);
  assert.equal(a.perHost.GBNGXP40.hys, true, 'dizin eslesmesi -prod\'lu namespace ile yapilmali');
});

test('grup basina servis location sayisi: SPA-disi ve cozulemeyen dahil, mirror sunucu carpilmaz', () => {
  const out = buildMigration({
    proxyRows: [
      P('GBRVPP07', 'GLOMO', '/a/', 'a-app-v1-glomo-prod' + APPS),
      P('GBRVPP08', 'GLOMO', '/a/', 'a-app-v1-glomo-prod' + APPS), // mirror: ayni location
      P('GBRVPP07', 'GLOMO', '/api/', 'glomo-api-glomo-prod' + APPS), // SPA degil
      P('GBRVPP07', 'GLOMO', '/x/', 'hayalet-app-v1-yok-prod' + APPS), // cozulemedi
      P('GBRVPP01', 'WEBFORMS', '/w/', 'w-app-v1-webforms-prod' + APPS),
    ],
    upstreamRows: [], routeRows: [{ namespace_name: 'glomo-prod', route_address: 'a-app-v1-glomo-prod' + APPS }], ocpRows: [], dirRows: [],
  });
  // yeni sunucu taranmadi -> hepsi notScanned
  assert.deepEqual(out.find((g) => g.id === 'glomo').serviceLocations, [{ service: 'GLOMO', locations: 3, defined: 0, partial: 0, none: 0, notScanned: 3 }]);
  assert.deepEqual(out.find((g) => g.id === 'other').serviceLocations, [{ service: 'WEBFORMS', locations: 1, defined: 0, partial: 0, none: 0, notScanned: 1 }]);
  assert.deepEqual(out.find((g) => g.id === 'glomo').totals.locations, { total: 3, defined: 0, partial: 0, none: 0, notScanned: 3 });
});

test('location ilerlemesi (2026-09-17): yeni sunuculardaki tanimlara gore defined / partial / none; path basina yeni sunucu listesi', () => {
  const N = (host, service, location) => ({ host, service, vhost: service + '-PROD.conf', location });
  const glomoNew = MIGRATION_GROUPS.find((g) => g.id === 'glomo').newHosts;
  const out = buildMigration({
    proxyRows: [
      P('GBRVPP07', 'GLOMO', '/tam/', 'tam-app-v1-glomo-prod' + APPS),
      P('GBRVPP07', 'GLOMO', '/yarim/', 'yarim-app-v1-glomo-prod' + APPS),
      P('GBRVPP07', 'GLOMO', '/yok/', 'yok-app-v1-glomo-prod' + APPS),
      P('GBRVPP07', 'GLOMO', '/api/', 'glomo-api-glomo-prod' + APPS), // SPA degil, proxy ile tasinir
    ],
    upstreamRows: [], routeRows: ['tam', 'yarim', 'yok'].map((a) => ({ namespace_name: 'glomo-prod', route_address: a + '-app-v1-glomo-prod' + APPS })), ocpRows: [],
    dirRows: glomoNew.map((h) => D(h, 'glomo-prod', 'tam-app-v1')),
    newLocRows: [
      ...glomoNew.map((h) => N(h, 'GLOMO', '/tam/')),
      N(glomoNew[0], 'glomo', '/yarim/'), // servis adi kucuk harf yazilsa da eslesir
      ...glomoNew.map((h) => N(h, 'GLOMO', '/api/')), // SPA-disi location proxy ile tasinmis
    ],
  });
  const g = out.find((x) => x.id === 'glomo');
  assert.deepEqual(g.serviceLocations, [{ service: 'GLOMO', locations: 4, defined: 2, partial: 1, none: 1, notScanned: 0 }]);
  assert.deepEqual(g.totals.locations, { total: 4, defined: 2, partial: 1, none: 1, notScanned: 0 });
  const byApp = Object.fromEntries(g.apps.map((a) => [a.application, a]));
  assert.equal(byApp['tam-app-v1'].paths[0].newStatus, 'defined');
  assert.deepEqual(byApp['tam-app-v1'].paths[0].newHosts, glomoNew);
  assert.equal(byApp['yarim-app-v1'].paths[0].newStatus, 'partial');
  assert.deepEqual(byApp['yarim-app-v1'].paths[0].newHosts, [glomoNew[0]]);
  assert.equal(byApp['yok-app-v1'].paths[0].newStatus, 'none');
  // hic yeni sunucu taranmadiysa "none" DEGIL "not-scanned"
  const out2 = buildMigration({ proxyRows: [P('GBRVPP07', 'GLOMO', '/a/', 'a-app-v1-glomo-prod' + APPS)], upstreamRows: [], routeRows: [{ namespace_name: 'glomo-prod', route_address: 'a-app-v1-glomo-prod' + APPS }], ocpRows: [], dirRows: [] });
  assert.equal(out2.find((x) => x.id === 'glomo').apps[0].paths[0].newStatus, 'not-scanned');
});
