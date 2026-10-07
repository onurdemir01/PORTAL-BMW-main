// server/audit/__tests__/route-stats.test.cjs - ortam basina route / SPA / IP istatistigi.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildRouteStats, routesOfIp, routesOfCluster } = require('../route-stats.cjs');

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

// ── CLUSTER ROUTE LISTESI (CR1..CR5, 2026-10-08) ─────────────────────────────────────
// Kullanici: "Cluster bazli route'larin SPA olup olmadigini gosterdik ya, ustlerine
// tikladigimda SPA olmayan route'lari gormek istiyorum."
//
// EN PAHALI UC YANLIS:
//   1. SPA kalibini IKINCI KEZ yazmak -> kalip degisince biri guncellenir, oteki sessizce
//      eski kalir. `routesOfCluster` ve `routesOfIp` AYNI govdeyi (routeListesi) kullanir.
//   2. Ortam suzgecini atlamak -> ayni cluster'da hem -dev hem -prod namespace'i var;
//      PROD satirina tiklayan kullaniciya dev route'lari gosterilirdi.
//   3. Siniflandirilamayani "SPA degil" saymak -> ekranda yuzde paydasiyla TUTARSIZ olur
//      (CB2 ile ayni disiplin): 'nonSpa' suzgeci yalnizca GERCEKTEN SPA olmayani verir.

const CR = (c, ns, addr, rname) => ({
  cluster_name: c, namespace_name: ns, route_name: rname === undefined ? 'r' : rname,
  route_address: addr, resolved_ip: '10.0.0.1', termination_type: 'reencrypt',
});

test('CR1 cluster + ortam suzgeci; nonSpa yalniz SPA olmayani verir', () => {
  const rows = [
    CR('GBOCPPROD1', 'musteri-prod', 'crm-app-v-musteri-prod.apps.fw'),
    CR('GBOCPPROD1', 'musteri-prod', 'api-musteri-prod.apps.fw'),
    CR('GBOCPPROD2', 'musteri-prod', 'pay-app-v-musteri-prod.apps.fw'),
    CR('GBOCPPROD1', 'musteri-dev', 'x-app-v-musteri-dev.apps.fw'),
  ];
  assert.deepEqual(
    routesOfCluster(rows, 'GBOCPPROD1', 'PROD', 'nonSpa').map((r) => r.address),
    ['api-musteri-prod.apps.fw'],
  );
  assert.equal(routesOfCluster(rows, 'GBOCPPROD1', 'PROD', 'all').length, 2, 'baska cluster sizdi');
  // ORTAM SUZGECI: ayni cluster'in dev namespace'i PROD listesine GIRMEZ
  assert.deepEqual(
    routesOfCluster(rows, 'GBOCPPROD1', 'DEV', 'all').map((r) => r.namespace),
    ['musteri-dev'],
  );
});

test('CR2 cluster adi BUYUK/KUCUK harf duyarsiz eslesir', () => {
  const rows = [CR('GBOCPPROD2', 'a-prod', 'x-app-v-a-prod.apps.fw')];
  assert.equal(routesOfCluster(rows, 'gbocpprod2', 'PROD', 'all').length, 1);
  assert.equal(routesOfCluster(rows, 'GBOCPPROD2', 'PROD', 'all').length, 1);
  assert.equal(routesOfCluster(rows, 'BASKA', 'PROD', 'all').length, 0);
});

test('CR3 SINIFLANDIRILAMAYAN route nonSpa sayilmaz (CB2 ile ayni disiplin)', () => {
  // Ne adresinden ne adindan cozulemeyen route'un SPA olup olmadigini BILMIYORUZ.
  // 'nonSpa' suzgecine katmak, ekrandaki yuzde paydasiyla tutarsiz bir liste verirdi.
  const rows = [
    CR('GBOCPQA1', 'musteri-qa', 'crm-app-v-musteri-qa.apps.fw'),
    CR('GBOCPQA1', 'musteri-qa', '', ''),
  ];
  assert.equal(routesOfCluster(rows, 'GBOCPQA1', 'QA', 'nonSpa').length, 0, 'olculemeyen SPA-disi sayildi');
  assert.equal(routesOfCluster(rows, 'GBOCPQA1', 'QA', 'all').length, 2);
  assert.deepEqual(
    routesOfCluster(rows, 'GBOCPQA1', 'QA', 'all').map((r) => r.kind).sort(),
    ['spa', 'unclassified'],
  );
});

test('CR4 ortam VERILMEZSE suzgec uygulanmaz (tum ortamlar)', () => {
  const rows = [
    CR('ARK-A', 'a-dev', 'x-app-v-a-dev.apps.fw'),
    CR('ARK-A', 'a-prod', 'y-app-v-a-prod.apps.fw'),
  ];
  assert.equal(routesOfCluster(rows, 'ARK-A', '', 'all').length, 2);
});

test('CR5 routesOfIp ile AYNI govde: SPA kalibi iki kez yazilmamis', () => {
  // `routeListesi` paylasimi kaynak duzeyinde kilitlenir: ikinci bir siniflandirma
  // kopyasi, SPA kalibi degisince iki ekranin farkli sayi gostermesi demekti.
  const src = fs.readFileSync(path.join(__dirname, '..', 'route-stats.cjs'), 'utf8');
  const govde = src.slice(src.indexOf('function routeListesi'));
  assert.match(govde, /isSpaApp\(app\)/, 'siniflandirma ortak govdede degil');
  // `isSpaApp(` YALNIZ IKI yerde CAGRILIR: buildRouteStats (sayim) ve routeListesi
  // (liste). Ucuncu bir cagri, siniflandirmanin kopyalandigi anlamina gelir.
  // (Satir 24'teki `isSpaApp` destructuring'dir, parantezsiz - sayima girmez.)
  assert.equal((src.match(/isSpaApp\(/g) || []).length, 2, 'isSpaApp cagri sayisi 2 degil - siniflandirma kopyalanmis olabilir');
  assert.ok(!/function routesOfCluster[\s\S]{0,400}isSpaApp\(/.test(src), 'routesOfCluster kendi siniflandirmasini yapiyor');
});

test('CR6 uc: cluster adi BEYAZ LISTEYE karsi dogrulanir, yetki kapisini paylasir', () => {
  // Serbest metin kabul etmek, istemciye `cluster_name` uzerinden route envanterinin
  // TAMAMINI sorgulatmak olurdu (platform suzgeci atlanir).
  const den = fs.readFileSync(path.join(__dirname, '..', 'denetim.cjs'), 'utf8');
  const blok = den.slice(den.indexOf("router.get('/route-stats/cluster'"), den.indexOf("// Bir IP'ye cozen route'lar"));
  assert.ok(blok.length > 0, '/route-stats/cluster ucu yok');
  assert.match(blok, /clusters\.find\(\(c\) =>/, 'cluster adi platform listesine karsi dogrulanmiyor');
  assert.match(blok, /status\(400\)/, 'tanimsiz cluster 400 donmuyor');
  // SORGU DOGRULANMIS adi kullanmali, istemciden geleni DEGIL
  assert.match(blok, /value: esles/, 'sorgu istemciden gelen ham adi kullaniyor');
  assert.ok(!/value: cluster\b/.test(blok), 'ham cluster adi sorguya giriyor');
  // YETKI: yol deseni `route-stats` ile baslayan her sey 'spa' sekmesi kapisindan gecer
  // Desen metni OLDUGU GIBI aranir: regex icinde regex kacisi yazmak hem okunmaz hem
  // kirilgan (kacislar bir araci yutarsa bekci sessizce yanlis sey arar).
  assert.ok(
    den.includes('nginx-spa|nginx-spa-coverage|route-stats|nginx-migration'),
    'route-stats yol deseni degismis - yeni uc yetki kapisi disinda kalabilir',
  );
});
