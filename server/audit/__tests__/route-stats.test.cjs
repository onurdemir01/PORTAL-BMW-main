// server/audit/__tests__/route-stats.test.cjs - ortam basina route / SPA / IP istatistigi.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildRouteStats, routesOfIp } = require('../route-stats.cjs');

const R = (ns, route, addr, ip, tt = 'passthrough', cluster = 'ark-prod-1') => ({
  namespace_name: ns, route_name: route, route_address: addr, resolved_ip: ip, termination_type: tt, cluster_name: cluster,
});
const A = '.apps.fw.garanti.com.tr';

test('ortam namespace son ekinden; SPA/SPA-disi ayrimi; IP kovalari; cozulmeyen IP ve ortam ayri sayilir', () => {
  const out = buildRouteStats([
    R('glomo-prod', 'x-app-v1', 'x-app-v1-glomo-prod' + A, '10.1.1.1'),
    R('glomo-prod', 'y-app-emb-v2', 'y-app-emb-v2-glomo-prod' + A, '10.1.1.1'),
    R('glomo-prod', 'glomo-api', 'glomo-api-glomo-prod' + A, '10.1.1.2', 'reencrypt'),
    // adres kaliba uymuyor (elle verilmis) -> route ADI: SPA
    R('glomo-prod', 'z-app-v3', 'ozel-adres.garanti.com.tr', '', 'edge'),
    R('glomo-test', 'x-app-v1', 'x-app-v1-glomo-test' + A, '10.2.2.2', 'passthrough', 'ark-test-1'),
    // ortam cozulemez
    R('sandbox', 'x-app-v1', 'x' + A, '10.9.9.9'),
    // hem adres hem ad bos -> siniflandirilamadi
    R('glomo-prod', '', '', '10.1.1.3'),
  ]);
  assert.deepEqual(out.envs.map((e) => e.env), ['TEST', 'PROD']);
  const prod = out.envs.find((e) => e.env === 'PROD');
  assert.equal(prod.routes, 5);
  assert.equal(prod.spa, 3);
  assert.equal(prod.nonSpa, 1);
  assert.equal(prod.unclassified, 1);
  assert.deepEqual(prod.spaIps, [{ ip: '10.1.1.1', count: 2, samples: ['glomo-prod/x-app-v1', 'glomo-prod/y-app-emb-v2'] }]);
  assert.deepEqual(prod.nonSpaIps, [{ ip: '10.1.1.2', count: 1, samples: ['glomo-prod/glomo-api'] }]);
  assert.deepEqual(prod.unresolvedIp, { spa: 1, nonSpa: 0 });
  assert.deepEqual(prod.terminations.map((t) => t.type), ['passthrough', 'reencrypt', 'edge']);
  assert.deepEqual(prod.clusters, ['ark-prod-1']);
  assert.equal(out.totals.noEnv, 1);
  assert.equal(out.totals.routes, 6);
});

test('routesOfIp (2026-09-17): IP + ortam suzgeci, SPA / SPA-disi turu, siralama', () => {
  const rows = [
    { cluster_name: 'ark-a', namespace_name: 'digital-ch-dev', route_name: 'odeme', route_address: 'odeme-app-v1-digital-ch-dev.apps-t.fw.garanti.com.tr', resolved_ip: '10.1.1.1', termination_type: 'passthrough' },
    { cluster_name: 'ark-a', namespace_name: 'api-dev', route_name: 'api', route_address: 'api-svc-api-dev.apps-t.fw.garanti.com.tr', resolved_ip: '10.1.1.1', termination_type: 'reencrypt' },
    { cluster_name: 'ark-a', namespace_name: 'digital-ch-test', route_name: 'odeme', route_address: 'odeme-app-v1-digital-ch-test.apps-t.fw.garanti.com.tr', resolved_ip: '10.1.1.1', termination_type: 'passthrough' }, // baska ortam
    { cluster_name: 'ark-a', namespace_name: 'digital-ch-dev', route_name: 'kart', route_address: 'kart-app-v1-digital-ch-dev.apps-t.fw.garanti.com.tr', resolved_ip: '10.1.1.2', termination_type: 'passthrough' }, // baska IP
  ];
  const all = routesOfIp(rows, '10.1.1.1', 'dev');
  assert.deepEqual(all.map((r) => [r.namespace, r.kind, r.type]), [['api-dev', 'nonSpa', 'reencrypt'], ['digital-ch-dev', 'spa', 'passthrough']]);
  assert.deepEqual(routesOfIp(rows, '10.1.1.1', 'DEV', 'spa').map((r) => r.route), ['odeme']);
  assert.equal(routesOfIp(rows, '10.1.1.1', '').length, 3); // ortam verilmezse hepsi
  assert.equal(routesOfIp(rows, '10.9.9.9', 'dev').length, 0);
});

// ── CLUSTER BAZINDA KIRILIM (CB1..CB5, 2026-10-08) ───────────────────────────────────
// Kullanici: "Bu rootlar kolonunda dev/test/qa/prod'daki rootlarin yuzde kacinin SPA'lara
// ait oldugunu gosteriyoruz. Bunu cluster bazinda bolmeni istiyorum. Yani GBOCP Prod 1'de
// bu kadar root var, bunlarin su kadari SPA root'u, yuzdesi de budur."
//
// EN PAHALI UC YANLIS:
//   1. Yuzdeyi `spa/(spa+nonSpa)` hesaplamak -> siniflandirilamayan route'lar yok sayilir
//      ve yuzde SISER. "olculemedi" ile "SPA degil" ayni sey DEGIL.
//   2. Cluster adi BOS gelen satiri atlamak -> cluster satirlarinin toplami ortam
//      toplamiyla TUTMAZ ve kimse sebebini goremez.
//   3. Ortam sizmasi: ortam namespace EKINDEN cozuluyor, cluster'dan DEGIL. Ayni
//      cluster'da hem -dev hem -test namespace'i olabilir.

const CB = (o) => ({
  cluster_name: o.c, namespace_name: o.ns, route_name: o.r || 'r',
  route_address: o.addr || '', resolved_ip: o.ip || '10.0.0.1',
  termination_type: o.t || 'passthrough',
});

test('CB1 cluster basina route/SPA ayrisir ve TOPLAMI ortam toplamina esittir', () => {
  const rows = [
    CB({ c: 'GBOCPPROD1', ns: 'musteri-prod', addr: 'crm-app-v-musteri-prod.apps.fw' }),
    CB({ c: 'GBOCPPROD1', ns: 'musteri-prod', addr: 'kyc-app-v-musteri-prod.apps.fw' }),
    CB({ c: 'GBOCPPROD1', ns: 'musteri-prod', addr: 'api-musteri-prod.apps.fw' }),
    CB({ c: 'GBOCPPROD2', ns: 'odeme-prod', addr: 'pay-app-v-odeme-prod.apps.fw' }),
  ];
  const { envs } = buildRouteStats(rows);
  const prod = envs.find((e) => e.env === 'PROD');
  assert.ok(prod, 'PROD ortami uretilmedi');
  const p1 = prod.clusterRows.find((c) => c.cluster === 'GBOCPPROD1');
  assert.deepEqual(
    [p1.routes, p1.spa, p1.nonSpa, p1.unclassified, p1.spaPct],
    [3, 2, 1, 0, 66.7],
    'GBOCPPROD1 kirilimi yanlis',
  );
  const p2 = prod.clusterRows.find((c) => c.cluster === 'GBOCPPROD2');
  assert.deepEqual([p2.routes, p2.spa, p2.spaPct], [1, 1, 100]);
  // TOPLAM TUTMALI
  assert.equal(prod.clusterRows.reduce((a, c) => a + c.routes, 0), prod.routes);
  assert.equal(prod.clusterRows.reduce((a, c) => a + c.spa, 0), prod.spa);
});

test('CB2 YUZDE paydasi route TOPLAMI (siniflandirilamayan yok sayilmaz)', () => {
  // 1 SPA + 1 siniflandirilamayan. `spa/(spa+nonSpa)` = %100 olurdu - YANLIS, cunku
  // olculemeyen route'un SPA olup olmadigini BILMIYORUZ. Dogru: 1/2 = %50.
  // Satir DOGRUDAN kurulur: CB yardimcisi `route_name: o.r || 'r'` ile bos degeri
  // doldurdugu icin route siniflandirilabilir hale geliyor ve test kendi kendini
  // sabote ediyordu (ilk yazimda boyle oldu).
  const rows = [
    CB({ c: 'GBOCPQA1', ns: 'musteri-qa', addr: 'crm-app-v-musteri-qa.apps.fw' }),
    { cluster_name: 'GBOCPQA1', namespace_name: 'musteri-qa', route_name: '', route_address: '', resolved_ip: '10.0.0.1', termination_type: 'passthrough' },
  ];
  const { envs } = buildRouteStats(rows);
  const qa = envs.find((e) => e.env === 'QA');
  const c = qa.clusterRows[0];
  assert.equal(c.routes, 2);
  assert.equal(c.spa, 1);
  assert.equal(c.unclassified, 1, 'siniflandirilamayan sayilmadi');
  assert.equal(c.spaPct, 50, 'yuzde sismis - payda spa+nonSpa olmus olabilir');
});

test('CB3 cluster adi BOS gelen route ATLANMAZ, ayri kovada durur', () => {
  const rows = [
    CB({ c: 'GBOCPDEV1', ns: 'musteri-dev', addr: 'crm-app-v-musteri-dev.apps.fw' }),
    CB({ c: '', ns: 'musteri-dev', addr: 'kyc-app-v-musteri-dev.apps.fw' }),
    CB({ c: '   ', ns: 'musteri-dev', addr: 'x-app-v-musteri-dev.apps.fw' }),
  ];
  const { envs } = buildRouteStats(rows);
  const dev = envs.find((e) => e.env === 'DEV');
  const bos = dev.clusterRows.find((c) => c.cluster === '(cluster adi yok)');
  assert.ok(bos, 'adi bos cluster kovasi yok - satirlar sessizce kayboldu');
  assert.equal(bos.routes, 2, 'bos adli iki route tek kovada toplanmadi');
  // TOPLAM YINE TUTMALI - bu kovanin varlik sebebi tam bu
  assert.equal(dev.clusterRows.reduce((a, c) => a + c.routes, 0), dev.routes);
});

test('CB4 ORTAM namespace ekinden; ayni cluster iki ortama bolunur', () => {
  // Cluster'dan ortam cikarmak yanlis olurdu: ayni cluster'da hem -dev hem -test
  // namespace'i bulunabiliyor.
  const rows = [
    CB({ c: 'ARK-A', ns: 'musteri-dev', addr: 'crm-app-v-musteri-dev.apps.fw' }),
    CB({ c: 'ARK-A', ns: 'musteri-test', addr: 'crm-app-v-musteri-test.apps.fw' }),
  ];
  const { envs } = buildRouteStats(rows);
  const dev = envs.find((e) => e.env === 'DEV');
  const test_ = envs.find((e) => e.env === 'TEST');
  assert.equal(dev.clusterRows.length, 1);
  assert.equal(dev.clusterRows[0].routes, 1, 'ayni cluster iki ortamda ayri sayilmadi');
  assert.equal(test_.clusterRows[0].routes, 1);
});

test('CB5 kirilim route sayisina gore AZALAN; tek cluster da satir uretir', () => {
  // ADLAR BILINCLI SECILDI: route sayisina gore siralama ['ZCOK','AAZ'], ALFABETIK
  // siralama ['AAZ','ZCOK'] verir. Ilk yazimda adlar 'BUYUK'/'KUCUK' idi ve iki siralama
  // AYNI sonucu veriyordu - mutasyon testi (siralamayi alfabetige cevirmek) bekciden
  // GECTI. Test verisi, olctugu seyi ayirt edebilmek ZORUNDA.
  const rows = [
    CB({ c: 'AAZ', ns: 'a-prod', addr: 'x-app-v-a-prod.apps.fw' }),
    CB({ c: 'ZCOK', ns: 'a-prod', addr: 'y-app-v-a-prod.apps.fw' }),
    CB({ c: 'ZCOK', ns: 'a-prod', addr: 'z-app-v-a-prod.apps.fw' }),
  ];
  const { envs } = buildRouteStats(rows);
  const prod = envs.find((e) => e.env === 'PROD');
  assert.deepEqual(prod.clusterRows.map((c) => c.cluster), ['ZCOK', 'AAZ'], 'siralama route sayisina gore degil (alfabetige mi dondu?)');
  // Tek cluster'li ortamda da veri URETILIR (ekran gostermemeyi kendi secer)
  const tek = buildRouteStats([CB({ c: 'TEK', ns: 'b-prod', addr: 'q-app-v-b-prod.apps.fw' })]);
  assert.equal(tek.envs[0].clusterRows.length, 1);
});
