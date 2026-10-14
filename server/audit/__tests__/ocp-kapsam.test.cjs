// server/audit/__tests__/ocp-kapsam.test.cjs
//
// Denetim > OpenShift ve Denetim > OpenShift Route ekranlarinin ORTAK kurucusunu kilitler
// (2026-10-14, kullanici: "bunun aynisini Route envanteri icinde yapabilir miyiz?").
//
// Kilitlenen iddialar:
//   OK1 route satiri = namespace TABANI + route adi: ayni route dev/prod namespace'lerinde tek satir;
//       ayni adli route baska namespace'te AYRI satir (genel adlar "her yerde var" gorunmesin)
//   OK2 eki olmayan namespace sayilmaz, skippedNoEnv olarak soylenir
//   OK3 resmi cluster'dan HIC kayit gelmediyse veriYok (olculemedi != yok); kaydi olan ama o ortamda
//       satiri olmayan cluster veriYok DEGIL (apps 0)
//   OK4 uygulama ekraninin yanit sekli degismedi (key/alt alanlari eklenmez)
//   OK5 sunucu uclari ve sekme kapisi bagli
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { kapsamKur, routeKaydi } = require('../ocp-kapsam.cjs');
const { ENV_CLUSTERS } = require('../ocp-platforms.cjs');

const R = (cluster_name, namespace_name, route_name) => ({ cluster_name, namespace_name, route_name });

test('OK1 route satiri namespace tabani + route adi; ayni ad baska namespace\'te ayri satir', () => {
  const k = kapsamKur(
    [
      R('gbocptest1', 'retiree-banking-dev', 'cfa-retiree-app-v0'),
      R('gbocpprod1', 'retiree-banking-prod', 'cfa-retiree-app-v0'),
      R('gbocpprod2', 'retiree-banking-prod', 'cfa-retiree-app-v0'),
      R('gbocptest1', 'odeme-dev', 'api'),
      R('gbocptest1', 'kart-dev', 'api'),
    ].map(routeKaydi),
    ENV_CLUSTERS.ark,
  );
  assert.equal(k.totalApplications, 3);
  const cfa = k.rows.find((r) => r.application === 'cfa-retiree-app-v0');
  assert.equal(cfa.key, 'retiree-banking/cfa-retiree-app-v0');
  assert.equal(cfa.alt, 'retiree-banking');
  assert.deepEqual(cfa.present, ['dev', 'prod']);
  assert.deepEqual(cfa.envs.prod.map((h) => h.cluster), ['gbocpprod1', 'gbocpprod2']);
  const api = k.rows.filter((r) => r.application === 'api').map((r) => r.alt);
  assert.deepEqual(api, ['kart', 'odeme']);
});

test('OK2 eki olmayan namespace sayilmaz, skippedNoEnv soylenir', () => {
  const k = kapsamKur([R('gbocptest1', 'openshift-monitoring', 'grafana'), R('gbocptest1', 'a-test', 'x')].map(routeKaydi), ENV_CLUSTERS.ark);
  assert.equal(k.skippedNoEnv, 1);
  assert.deepEqual(k.rows.map((r) => r.application), ['x']);
});

test('OK3 hic kaydi gelmeyen resmi cluster veriYok; kaydi olan ama o ortamda bos cluster degil', () => {
  const k = kapsamKur(
    [
      R('gbocpprod1', 'a-prod', 'x'),
      R('gbocpprod2', 'a-prod', 'x'),
      R('gbocpprod4', 'openshift-monitoring', 'grafana'),
    ].map(routeKaydi),
    ENV_CLUSTERS.ark,
  );
  const prod = Object.fromEntries(k.envClusters.prod.map((c) => [c.cluster, c]));
  assert.equal(prod.gbocpprod1.apps, 1);
  assert.equal(prod.gbocpprod4.apps, 0);
  assert.ok(!prod.gbocpprod4.veriYok, 'kaydi olan cluster olculmus sayilir');
  assert.equal(prod.gbocpankprod2.veriYok, true);
  assert.equal(prod.gbocpdrcprod1.veriYok, true);
  assert.equal(k.envClusterKaynagi.prod, 'resmi');
});

test('OK4 uygulama ekraninin satir sekli degismedi (key/alt yok)', () => {
  const k = kapsamKur(
    [{ cluster: 'gbocpprod1', namespace: 'a-prod', application: 'app1' }],
    ENV_CLUSTERS.ark,
  );
  assert.deepEqual(Object.keys(k.rows[0]).sort(), ['application', 'envs', 'missing', 'missingCount', 'present']);
  assert.deepEqual(k.rows[0].envs, { prod: [{ cluster: 'gbocpprod1', namespace: 'a-prod' }] });
  assert.deepEqual(Object.keys(k).sort(), ['completeCount', 'envClusterKaynagi', 'envClusters', 'patterns', 'rows', 'skippedNoEnv', 'totalApplications']);
});

test('OK5 sunucu ucu route envanterinden okur ve OpenShift Route sekme kapisina bagli', () => {
  const den = fs.readFileSync(path.join(__dirname, '..', 'denetim.cjs'), 'utf8');
  assert.match(den, /router\.get\('\/ocp-route-coverage'/);
  assert.match(den, /FROM dbo\.BMW_Openshift_Route_Inventory\s+WHERE cluster_name IN/);
  assert.match(den, /\[\/\^\\\/ocp-route-coverage\(\\\/\|\$\)\/, 'ocproute'\]/);
  const page = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'DenetimPage.tsx'), 'utf8');
  assert.ok(page.includes(`{activeTab === 'ocproute' && <OcpCoverage kaynak="route" />}`));
  // veri yok cluster'i n'ye katilmaz (yoksa her satir o cluster yuzunden "kismi" gorunur)
  assert.match(page, /liste\.filter\(\(c\) => !c\.beklenmeyen && !c\.veriYok\)/);
});
