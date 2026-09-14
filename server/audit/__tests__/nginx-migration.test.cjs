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
  assert.deepEqual(glomo.totals, { apps: 3, ready: 0, partial: 2, missing: 1, notScanned: 0, nonSpa: 1, unresolved: 1 });

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
