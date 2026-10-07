// server/audit/__tests__/route-stats.test.cjs - ortam basina route / SPA / IP istatistigi.
//
// OLCUT DEGISTI (2026-10-08). Kullanici: "Kapsam'da SPA olan ama SPA standartina uymayan
// route'lari 'SPA degil' olarak goruyorum - uygulamanin icine giremedigin icin mi
// tagleyemedin?" Hayir: bu ekran canli sinyale HIC bakmiyordu, ADA bakiyordu. Artik
// birincil olcut dbo.BMW_Spa_Discovery (kabinde nginx kosuyor mu), ad kalibi IKINCIL
// eksen. Gerekce: server/audit/route-stats.cjs basligi.
//
// EN PAHALI DORT YANLIS:
//   1. "Kesifte satiri yok" ile "SPA degil"i ayni saymak. Kesfin gormedigi her route
//      SPA-disi sayilirsa yuzde duser ve ekran "bu cluster'da SPA yok" der. UC KOVA:
//      spa / nonSpa / unmeasured.
//   2. Hic olculmemis cluster icin %0 yazmak. %0 bir IDDIADIR; dogru cevap NULL.
//   3. Ad kalibi eksenini SILMEK. Production Tasimalari ekraninin dogru olcutu odur;
//      iki ekranin sayilari karsilastirilabilir kalmali (`byName`).
//   4. Kesif satiri VAR ama hic eslesme YOKSA bunu "SPA yok" gostermek. Iki job cluster
//      ya da route adini farkli yaziyor olabilir - `keyMismatch`.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildRouteStats,
  routesOfIp,
  routesOfCluster,
  spaIndex,
  olculenYuzde,
} = require('../route-stats.cjs');

const R = (ns, route, addr, ip, tt = 'passthrough', cluster = 'ark-prod-1') => ({
  namespace_name: ns,
  route_name: route,
  route_address: addr,
  resolved_ip: ip,
  termination_type: tt,
  cluster_name: cluster,
});
const A = '.apps.fw.garanti.com.tr';
/** Kesif satiri: dbo.BMW_Spa_Discovery sekli. */
const S = (cluster, ns, route, isSpa, o = {}) => ({
  cluster,
  namespace: ns,
  route,
  is_spa: isSpa,
  signal: o.signal === undefined ? (isSpa ? 'nginx-start.sh' : '') : o.signal,
  match_by: o.matchBy === undefined ? 'selector' : o.matchBy,
  workload: o.workload === undefined ? route : o.workload,
  scan_date: o.scanDate || '2026-10-07',
});

test('ortam namespace son ekinden; canli sinyalle SPA/SPA-disi; IP kovalari; cozulmeyen IP ve ortam ayri', () => {
  const rows = [
    R('glomo-prod', 'x-app-v1', 'x-app-v1-glomo-prod' + A, '10.1.1.1'),
    R('glomo-prod', 'y-app-emb-v2', 'y-app-emb-v2-glomo-prod' + A, '10.1.1.1'),
    R('glomo-prod', 'glomo-api', 'glomo-api-glomo-prod' + A, '10.1.1.2', 'reencrypt'),
    R('glomo-prod', 'z-app-v3', 'ozel-adres.garanti.com.tr', '', 'edge'),
    R('glomo-test', 'x-app-v1', 'x-app-v1-glomo-test' + A, '10.2.2.2', 'passthrough', 'ark-test-1'),
    R('sandbox', 'x-app-v1', 'x' + A, '10.9.9.9'),
    R('glomo-prod', 'olculmeyen', '', '10.1.1.3'),
  ];
  const sig = [
    S('ark-prod-1', 'glomo-prod', 'x-app-v1', 1),
    S('ark-prod-1', 'glomo-prod', 'y-app-emb-v2', 1),
    S('ark-prod-1', 'glomo-prod', 'glomo-api', 0),
    S('ark-prod-1', 'glomo-prod', 'z-app-v3', 1),
    S('ark-test-1', 'glomo-test', 'x-app-v1', 1),
  ];
  const out = buildRouteStats(rows, sig);
  assert.deepEqual(
    out.envs.map((e) => e.env),
    ['TEST', 'PROD'],
  );
  const prod = out.envs.find((e) => e.env === 'PROD');
  assert.equal(prod.routes, 5);
  assert.equal(prod.spa, 3);
  assert.equal(prod.nonSpa, 1);
  // 'olculmeyen' route'un kesifte satiri YOK -> unmeasured, nonSpa DEGIL
  assert.equal(prod.unmeasured, 1);
  assert.deepEqual(prod.spaIps, [
    { ip: '10.1.1.1', count: 2, samples: ['glomo-prod/x-app-v1', 'glomo-prod/y-app-emb-v2'] },
  ]);
  assert.deepEqual(prod.nonSpaIps, [
    { ip: '10.1.1.2', count: 1, samples: ['glomo-prod/glomo-api'] },
  ]);
  assert.deepEqual(prod.unmeasuredIps, [
    { ip: '10.1.1.3', count: 1, samples: ['glomo-prod/olculmeyen'] },
  ]);
  assert.deepEqual(prod.unresolvedIp, { spa: 1, nonSpa: 0, unmeasured: 0 });
  assert.deepEqual(
    prod.terminations.map((t) => t.type),
    ['passthrough', 'reencrypt', 'edge'],
  );
  assert.deepEqual(prod.clusters, ['ark-prod-1']);
  assert.equal(out.totals.noEnv, 1);
  assert.equal(out.totals.routes, 6);
  assert.equal(out.spaSignalRead, true);
});

test('routesOfIp (2026-09-17): IP + ortam suzgeci, canli tur, siralama', () => {
  const rows = [
    {
      cluster_name: 'ark-a',
      namespace_name: 'digital-ch-dev',
      route_name: 'odeme',
      route_address: 'odeme-app-v1-digital-ch-dev.apps-t.fw.garanti.com.tr',
      resolved_ip: '10.1.1.1',
      termination_type: 'passthrough',
    },
    {
      cluster_name: 'ark-a',
      namespace_name: 'api-dev',
      route_name: 'api',
      route_address: 'api-svc-api-dev.apps-t.fw.garanti.com.tr',
      resolved_ip: '10.1.1.1',
      termination_type: 'reencrypt',
    },
    {
      cluster_name: 'ark-a',
      namespace_name: 'digital-ch-test',
      route_name: 'odeme',
      route_address: 'odeme-app-v1-digital-ch-test.apps-t.fw.garanti.com.tr',
      resolved_ip: '10.1.1.1',
      termination_type: 'passthrough',
    },
    {
      cluster_name: 'ark-a',
      namespace_name: 'digital-ch-dev',
      route_name: 'kart',
      route_address: 'kart-app-v1-digital-ch-dev.apps-t.fw.garanti.com.tr',
      resolved_ip: '10.1.1.2',
      termination_type: 'passthrough',
    },
  ];
  const sig = [
    S('ark-a', 'digital-ch-dev', 'odeme', 1),
    S('ark-a', 'api-dev', 'api', 0),
    S('ark-a', 'digital-ch-test', 'odeme', 1),
    S('ark-a', 'digital-ch-dev', 'kart', 1),
  ];
  const all = routesOfIp(rows, '10.1.1.1', 'dev', 'all', sig);
  assert.deepEqual(
    all.map((r) => [r.namespace, r.kind, r.type]),
    [
      ['api-dev', 'nonSpa', 'reencrypt'],
      ['digital-ch-dev', 'spa', 'passthrough'],
    ],
  );
  assert.deepEqual(
    routesOfIp(rows, '10.1.1.1', 'DEV', 'spa', sig).map((r) => r.route),
    ['odeme'],
  );
  assert.equal(routesOfIp(rows, '10.1.1.1', '', 'all', sig).length, 3);
  assert.equal(routesOfIp(rows, '10.9.9.9', 'dev', 'all', sig).length, 0);
});

// ── CANLI SINYAL SOZLESMESI (CS1..CS12, 2026-10-08) ──────────────────────────────────

const CB = (o) => ({
  cluster_name: o.c,
  namespace_name: o.ns,
  route_name: o.r || 'r',
  route_address: o.addr || '',
  resolved_ip: o.ip || '10.0.0.1',
  termination_type: o.t || 'passthrough',
});

test('CS1 nginx KOSUYOR ama ad standarda UYMUYOR -> SPA sayilir, nameMismatch isaretlenir', () => {
  // KULLANICININ ASIL SORUSU. Eski olcut (ad kalibi) bu route'u "SPA degil" gosteriyordu.
  const rows = [
    CB({ c: 'GBOCPP1', ns: 'kredi-prod', r: 'kredi-ui', addr: 'kredi-ui-kredi-prod.apps.fw' }),
  ];
  const out = buildRouteStats(rows, [S('GBOCPP1', 'kredi-prod', 'kredi-ui', 1)]);
  const prod = out.envs.find((e) => e.env === 'PROD');
  assert.equal(prod.spa, 1, 'canli sinyal yerine ad kalibina bakiliyor olabilir');
  assert.equal(prod.nonSpa, 0);
  assert.equal(prod.nameMismatch, 1, 'ad uyumsuzlugu isaretlenmedi - kullanici bu sayiyi istedi');
  // AD EKSENI KORUNUR: Tasima ekrani bu route'u SPA SAYMAZ ve iki ekran karsilastirilabilir
  assert.deepEqual(prod.byName, { spa: 0, nonSpa: 1, unclassified: 0 });
  assert.equal(prod.clusterRows[0].nameMismatch, 1, 'cluster satirinda ad uyumsuzlugu yok');
});

test('CS2 ad SPA kalibina UYUYOR ama kabinde nginx YOK -> nonSpa + nameFalsePositive', () => {
  const rows = [
    CB({ c: 'GBOCPP1', ns: 'kart-prod', r: 'kart-app-v1', addr: 'kart-app-v1-kart-prod.apps.fw' }),
  ];
  const out = buildRouteStats(rows, [S('GBOCPP1', 'kart-prod', 'kart-app-v1', 0)]);
  const prod = out.envs.find((e) => e.env === 'PROD');
  assert.equal(prod.spa, 0, 'ad kalibi canli sinyali EZIYOR');
  assert.equal(prod.nonSpa, 1);
  assert.equal(prod.nameFalsePositive, 1);
  assert.deepEqual(prod.byName, { spa: 1, nonSpa: 0, unclassified: 0 });
});

test('CS3 KESIFTE SATIRI OLMAYAN route unmeasured; nonSpa SAYILMAZ', () => {
  const rows = [
    CB({ c: 'GBOCPP1', ns: 'a-prod', r: 'var', addr: 'var-a-prod.apps.fw' }),
    CB({ c: 'GBOCPP1', ns: 'a-prod', r: 'yok', addr: 'yok-a-prod.apps.fw' }),
  ];
  const out = buildRouteStats(rows, [S('GBOCPP1', 'a-prod', 'var', 0)]);
  const prod = out.envs.find((e) => e.env === 'PROD');
  assert.equal(prod.nonSpa, 1, 'olculemeyen route SPA-disi sayildi');
  assert.equal(prod.unmeasured, 1);
  assert.deepEqual(
    prod.clusterRows[0].reasons,
    [{ reason: 'route-kesifte-yok', count: 1 }],
    'olculemedi sebebi yazilmiyor',
  );
  // LISTE UCU de ayni disiplinde: 'nonSpa' suzgeci olculemeyeni VERMEZ
  assert.equal(
    routesOfCluster(rows, 'GBOCPP1', 'PROD', 'nonSpa', [S('GBOCPP1', 'a-prod', 'var', 0)]).length,
    1,
  );
  assert.deepEqual(
    routesOfCluster(rows, 'GBOCPP1', 'PROD', 'unmeasured', [S('GBOCPP1', 'a-prod', 'var', 0)]).map(
      (r) => r.route,
    ),
    ['yok'],
  );
});

test('CS4 KESIF HIC OKUNAMADI (null) -> her route unmeasured, spaSignalRead false', () => {
  // Tablo yok / sorgu dustu. Bos liste ile AYNI SEY DEGIL: bos liste "tarama kostu ama
  // satir yok" demek. Ikisini birlestirmek, hic olculmemis bir ortami "SPA yok" gostermek.
  const rows = [CB({ c: 'GBOCPP1', ns: 'a-prod', r: 'x-app-v1', addr: 'x-app-v1-a-prod.apps.fw' })];
  const out = buildRouteStats(rows, null);
  const prod = out.envs.find((e) => e.env === 'PROD');
  assert.equal(out.spaSignalRead, false);
  assert.equal(prod.spa, 0);
  assert.equal(prod.unmeasured, 1, 'kesif okunmadan SPA/nonSpa karari verilmis');
  assert.deepEqual(prod.clusterRows[0].reasons, [{ reason: 'kesif-okunamadi', count: 1 }]);
  // AD EKSENI yine de hesaplanir: ad kalibi kesiften BAGIMSIZ bir olcut
  assert.deepEqual(prod.byName, { spa: 1, nonSpa: 0, unclassified: 0 });
  // BOS LISTE ile AYRISIR
  const bos = buildRouteStats(rows, []);
  assert.equal(bos.spaSignalRead, true, 'bos liste "okunamadi" ile ayni muamele goruyor');
  assert.equal(bos.envs[0].clusterRows[0].reasons[0].reason, 'cluster-taranmadi');
});

test('CS5 AYNI route icin iki kesif satiri: SPA diyen KAZANIR (sira bagimsiz)', () => {
  // spa_discovery her ESLESEN is yuku icin satir yaziyor (Deployment + DC + Rollout).
  // "son satir kazansin" demek, sirasi rastgele olan bir listede cevabi zara baglardi.
  const rows = [CB({ c: 'GBOCPP1', ns: 'a-prod', r: 'web', addr: 'web-a-prod.apps.fw' })];
  const ileri = [S('GBOCPP1', 'a-prod', 'web', 0), S('GBOCPP1', 'a-prod', 'web', 1)];
  const geri = [S('GBOCPP1', 'a-prod', 'web', 1), S('GBOCPP1', 'a-prod', 'web', 0)];
  assert.equal(
    buildRouteStats(rows, ileri).envs[0].spa,
    1,
    'SPA diyen satir kaybetti (sira: 0 sonra 1)',
  );
  assert.equal(
    buildRouteStats(rows, geri).envs[0].spa,
    1,
    'SPA diyen satir kaybetti (sira: 1 sonra 0)',
  );
});

test('CS6 HIC OLCULMEMIS cluster icin yuzde NULL, %0 DEGIL', () => {
  const rows = [CB({ c: 'GBOCPP9', ns: 'a-prod', r: 'x', addr: 'x-a-prod.apps.fw' })];
  const c = buildRouteStats(rows, []).envs[0].clusterRows[0];
  assert.equal(c.spaPctMeasured, null, '%0 yazilmis - bu "SPA yok" iddiasidir');
  assert.equal(c.unmeasured, 1);
  assert.equal(c.discoveryRows, 0, 'cluster hic taranmadi ama satir sayisi 0 degil');
  // Dogrudan birim: payda sifirsa NULL
  assert.equal(olculenYuzde(0, 0), null);
  assert.equal(olculenYuzde(1, 1), 50);
  assert.equal(olculenYuzde(1, 0), 100);
});

test('CS7 PAYDA ROUTE TOPLAMI; olculen uzerinden yuzde AYRI ve FARKLI deger verir', () => {
  // 1 SPA (olculdu) + 1 olculemedi. spaPct = 1/2 = %50 (olculemeyen paydada).
  // spaPctMeasured = 1/1 = %100. Ikisinin FARKLI olmasi testin ayirt edici gucu:
  // ayni degeri verseler, paydayi degistiren mutasyon bekciden gecerdi.
  const rows = [
    CB({ c: 'GBOCPQA1', ns: 'musteri-qa', r: 'crm', addr: 'crm-musteri-qa.apps.fw' }),
    CB({ c: 'GBOCPQA1', ns: 'musteri-qa', r: 'gizli', addr: 'gizli-musteri-qa.apps.fw' }),
  ];
  const c = buildRouteStats(rows, [S('GBOCPQA1', 'musteri-qa', 'crm', 1)]).envs[0].clusterRows[0];
  assert.equal(c.routes, 2);
  assert.equal(c.spa, 1);
  assert.equal(c.unmeasured, 1);
  assert.equal(c.spaPct, 50, 'yuzde sismis - payda spa+nonSpa olmus olabilir');
  assert.equal(c.spaPctMeasured, 100, 'olculen uzerinden yuzde yanlis');
  assert.notEqual(c.spaPct, c.spaPctMeasured, 'iki yuzde ayni cikti - test ayirt edemiyor');
});

test('CS8 KESIF SATIRI VAR ama hic eslesme YOK -> keyMismatch (anahtar uyusmuyor)', () => {
  // Iki job cluster ya da route adini farkli yaziyor olabilir. Bunu "SPA yok" gostermek,
  // olcum olmayan bir yere olcum iddiasi yazmak olurdu.
  const rows = [CB({ c: 'GBOCPP1', ns: 'a-prod', r: 'web', addr: 'web-a-prod.apps.fw' })];
  const c = buildRouteStats(rows, [S('GBOCPP1', 'a-prod', 'BASKA-ROUTE', 1)]).envs[0]
    .clusterRows[0];
  assert.equal(c.discoveryRows, 1, 'cluster icin kesif satiri sayilmadi');
  assert.equal(c.spa + c.nonSpa, 0);
  assert.equal(c.keyMismatch, true, 'anahtar uyusmazligi bildirilmedi');
  assert.equal(c.discoveryScanDate, '2026-10-07', 'tarama tarihi tasinmadi');
  // Eslesme VARSA bayrak dusmeli
  const d = buildRouteStats(rows, [S('GBOCPP1', 'a-prod', 'web', 1)]).envs[0].clusterRows[0];
  assert.equal(d.keyMismatch, false, 'eslesme oldugu halde anahtar uyusmazligi deniyor');
});

test('CS9 cluster / namespace / route eslesmesi BUYUK-KUCUK harf DUYARSIZ', () => {
  // route_inventory ve spa_discovery ayni adi farkli kasada yazabiliyor; kasa duyarli bir
  // anahtar her route'u "olculemedi" yapardi (sessiz, cunku sayi yine tutarli gorunur).
  const rows = [CB({ c: 'GBOCPP1', ns: 'A-Prod', r: 'Web', addr: 'web-a-prod.apps.fw' })];
  const out = buildRouteStats(rows, [S('gbocpp1', 'a-prod', 'web', 1)]);
  assert.equal(out.envs[0].spa, 1, 'anahtar kasaya duyarli - her sey olculemedi oluyor');
});

test('CS10 kanit alanlari listeye TASINIR: signal, matchBy, workload, nameSpa, reason', () => {
  // Karari veren kisi sinyalin NEREDEN geldigini gormek zorunda: 'selector' kesin,
  // 'ad' ayni adli is yukune dusulmus (ZAYIF kanit, 2026-10-08 olcumunde baskin yol).
  const rows = [
    CB({ c: 'GBOCPP1', ns: 'a-prod', r: 'web', addr: 'web-a-prod.apps.fw' }),
    CB({ c: 'GBOCPP1', ns: 'a-prod', r: 'yok', addr: 'yok-a-prod.apps.fw' }),
  ];
  const sig = [
    S('GBOCPP1', 'a-prod', 'web', 1, { signal: 'image', matchBy: 'ad', workload: 'web-dep' }),
  ];
  const liste = routesOfCluster(rows, 'GBOCPP1', 'PROD', 'all', sig);
  const web = liste.find((r) => r.route === 'web');
  assert.deepEqual(
    [web.kind, web.signal, web.matchBy, web.workload, web.nameSpa, web.reason],
    ['spa', 'image', 'ad', 'web-dep', false, ''],
  );
  const yok = liste.find((r) => r.route === 'yok');
  assert.deepEqual([yok.kind, yok.reason, yok.signal], ['unmeasured', 'route-kesifte-yok', '']);
});

test('CS11 spaIndex: cluster basina satir sayisi ve EN YENI tarama tarihi', () => {
  const ix = spaIndex([
    S('C1', 'ns', 'a', 1, { scanDate: '2026-10-01' }),
    S('C1', 'ns', 'b', 0, { scanDate: '2026-10-07' }),
    S('C2', 'ns', 'c', 1, { scanDate: '2026-09-30' }),
  ]);
  assert.equal(ix.byCluster.get('c1').rows, 2);
  assert.equal(ix.byCluster.get('c1').scanDate, '2026-10-07', 'en yeni tarih alinmadi');
  assert.equal(ix.byCluster.get('c2').scanDate, '2026-09-30');
  assert.equal(spaIndex(null), null, 'null girdi null dizin uretmeli (okunamadi)');
  // namespace ya da route'u BOS satir route dizinine girmez ama cluster sayimina girer
  const ix2 = spaIndex([{ cluster: 'C3', namespace: '', route: '', is_spa: 1 }]);
  assert.equal(ix2.byRoute.size, 0);
  assert.equal(ix2.byCluster.get('c3').rows, 1);
});

test('CS12 uc noktalar sinyali GECIRIR; okunamadi ile bos AYRI bildirilir', () => {
  const den = fs.readFileSync(path.join(__dirname, '..', 'denetim.cjs'), 'utf8');
  assert.match(den, /async function spaSinyali\(clusters\)/, 'sinyal yardimcisi yok');
  // OKUNAMADI -> rows: null. Bos listeye dusmek, olculmemis her seyi "SPA degil" yapardi.
  assert.match(den, /rows: null,\s*tableMissing: true/, 'tablo yoksa null donmuyor');
  assert.match(den, /CLUSTER BASINA EN YENI TARAMA/, 'global MAX(scan_date) tuzagi belgelenmemis');
  assert.match(
    den,
    /GROUP BY cluster\) m\s*\n?\s*ON m\.cluster = d\.cluster AND m\.sd = d\.scan_date/,
    'kesif sorgusu cluster basina en yeni taramayi suzmuyor - login dusen cluster dunku verisiyle SILINIR',
  );
  // UC UCUN UCU de sinyali buildRouteStats/liste fonksiyonlarina GECIRMELI
  assert.match(
    den,
    /buildRouteStats\(r\.recordset \|\| \[\], sig\.rows\)/,
    '/route-stats sinyali gecirmiyor',
  );
  assert.match(
    den,
    /routesOfCluster\(r\.recordset \|\| \[\], esles, req\.query\.env, kind, sig\.rows\)/,
    '/route-stats/cluster sinyali gecirmiyor',
  );
  assert.match(
    den,
    /routesOfIp\(r\.recordset \|\| \[\], ip, req\.query\.env, kind, sig\.rows\)/,
    '/route-stats/ip sinyali gecirmiyor',
  );
  // 'unmeasured' SUZGEC DEGERI kabul edilmeli, yoksa ekrandaki sekme bos doner
  assert.equal(
    (den.match(/'spa', 'nonSpa', 'unmeasured', 'all'/g) || []).length,
    2,
    'unmeasured suzgeci iki ucta da tanimli degil',
  );
});

// ── CLUSTER BAZINDA KIRILIM (CB1..CB5, 2026-10-08) ───────────────────────────────────
// Kullanici: "GBOCP Prod 1'de bu kadar root var, bunlarin su kadari SPA root'u, yuzdesi
// de budur." Ortam toplami "hangi cluster'da eksik" sorusunu cevaplamiyordu.

test('CB1 cluster basina route/SPA ayrisir ve TOPLAMI ortam toplamina esittir', () => {
  const rows = [
    CB({ c: 'GBOCPPROD1', ns: 'musteri-prod', r: 'crm', addr: 'crm-musteri-prod.apps.fw' }),
    CB({ c: 'GBOCPPROD1', ns: 'musteri-prod', r: 'kyc', addr: 'kyc-musteri-prod.apps.fw' }),
    CB({ c: 'GBOCPPROD1', ns: 'musteri-prod', r: 'api', addr: 'api-musteri-prod.apps.fw' }),
    CB({ c: 'GBOCPPROD2', ns: 'odeme-prod', r: 'pay', addr: 'pay-odeme-prod.apps.fw' }),
  ];
  const sig = [
    S('GBOCPPROD1', 'musteri-prod', 'crm', 1),
    S('GBOCPPROD1', 'musteri-prod', 'kyc', 1),
    S('GBOCPPROD1', 'musteri-prod', 'api', 0),
    S('GBOCPPROD2', 'odeme-prod', 'pay', 1),
  ];
  const { envs } = buildRouteStats(rows, sig);
  const prod = envs.find((e) => e.env === 'PROD');
  assert.ok(prod, 'PROD ortami uretilmedi');
  const p1 = prod.clusterRows.find((c) => c.cluster === 'GBOCPPROD1');
  assert.deepEqual(
    [p1.routes, p1.spa, p1.nonSpa, p1.unmeasured, p1.spaPct],
    [3, 2, 1, 0, 66.7],
    'GBOCPPROD1 kirilimi yanlis',
  );
  const p2 = prod.clusterRows.find((c) => c.cluster === 'GBOCPPROD2');
  assert.deepEqual([p2.routes, p2.spa, p2.spaPct], [1, 1, 100]);
  // TOPLAM TUTMALI
  assert.equal(
    prod.clusterRows.reduce((a, c) => a + c.routes, 0),
    prod.routes,
  );
  assert.equal(
    prod.clusterRows.reduce((a, c) => a + c.spa, 0),
    prod.spa,
  );
  // UC KOVA TOPLAMI da route sayisini VERMELI - bir kova sessizce dusmesin
  for (const c of prod.clusterRows)
    assert.equal(
      c.spa + c.nonSpa + c.unmeasured,
      c.routes,
      `${c.cluster}: kovalar route sayisini tutmuyor`,
    );
});

test('CB3 cluster adi BOS gelen route ATLANMAZ, ayri kovada durur', () => {
  const rows = [
    CB({ c: 'GBOCPDEV1', ns: 'musteri-dev', r: 'a', addr: 'a-musteri-dev.apps.fw' }),
    CB({ c: '', ns: 'musteri-dev', r: 'b', addr: 'b-musteri-dev.apps.fw' }),
    CB({ c: '   ', ns: 'musteri-dev', r: 'c', addr: 'c-musteri-dev.apps.fw' }),
  ];
  const { envs } = buildRouteStats(rows, []);
  const dev = envs.find((e) => e.env === 'DEV');
  const bos = dev.clusterRows.find((c) => c.cluster === '(cluster adi yok)');
  assert.ok(bos, 'adi bos cluster kovasi yok - satirlar sessizce kayboldu');
  assert.equal(bos.routes, 2, 'bos adli iki route tek kovada toplanmadi');
  // TOPLAM YINE TUTMALI - bu kovanin varlik sebebi tam bu
  assert.equal(
    dev.clusterRows.reduce((a, c) => a + c.routes, 0),
    dev.routes,
  );
});

test('CB4 ORTAM namespace ekinden; ayni cluster iki ortama bolunur', () => {
  // Cluster'dan ortam cikarmak yanlis olurdu: ayni cluster'da hem -dev hem -test
  // namespace'i bulunabiliyor.
  const rows = [
    CB({ c: 'ARK-A', ns: 'musteri-dev', r: 'a', addr: 'a-musteri-dev.apps.fw' }),
    CB({ c: 'ARK-A', ns: 'musteri-test', r: 'a', addr: 'a-musteri-test.apps.fw' }),
  ];
  const { envs } = buildRouteStats(rows, []);
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
    CB({ c: 'AAZ', ns: 'a-prod', r: 'x', addr: 'x-a-prod.apps.fw' }),
    CB({ c: 'ZCOK', ns: 'a-prod', r: 'y', addr: 'y-a-prod.apps.fw' }),
    CB({ c: 'ZCOK', ns: 'a-prod', r: 'z', addr: 'z-a-prod.apps.fw' }),
  ];
  const { envs } = buildRouteStats(rows, []);
  const prod = envs.find((e) => e.env === 'PROD');
  assert.deepEqual(
    prod.clusterRows.map((c) => c.cluster),
    ['ZCOK', 'AAZ'],
    'siralama route sayisina gore degil (alfabetige mi dondu?)',
  );
  // Tek cluster'li ortamda da veri URETILIR (ekran gostermemeyi kendi secer)
  const tek = buildRouteStats(
    [CB({ c: 'TEK', ns: 'b-prod', r: 'q', addr: 'q-b-prod.apps.fw' })],
    [],
  );
  assert.equal(tek.envs[0].clusterRows.length, 1);
});

// ── CLUSTER ROUTE LISTESI (CR1..CR6, 2026-10-08) ─────────────────────────────────────

const CR = (c, ns, addr, rname) => ({
  cluster_name: c,
  namespace_name: ns,
  route_name: rname === undefined ? 'r' : rname,
  route_address: addr,
  resolved_ip: '10.0.0.1',
  termination_type: 'reencrypt',
});

test('CR1 cluster + ortam suzgeci; nonSpa yalniz OLCULMUS ve SPA olmayani verir', () => {
  const rows = [
    CR('GBOCPPROD1', 'musteri-prod', 'crm-musteri-prod.apps.fw', 'crm'),
    CR('GBOCPPROD1', 'musteri-prod', 'api-musteri-prod.apps.fw', 'api'),
    CR('GBOCPPROD2', 'musteri-prod', 'pay-musteri-prod.apps.fw', 'pay'),
    CR('GBOCPPROD1', 'musteri-dev', 'x-musteri-dev.apps.fw', 'x'),
  ];
  const sig = [
    S('GBOCPPROD1', 'musteri-prod', 'crm', 1),
    S('GBOCPPROD1', 'musteri-prod', 'api', 0),
    S('GBOCPPROD2', 'musteri-prod', 'pay', 1),
    S('GBOCPPROD1', 'musteri-dev', 'x', 1),
  ];
  assert.deepEqual(
    routesOfCluster(rows, 'GBOCPPROD1', 'PROD', 'nonSpa', sig).map((r) => r.address),
    ['api-musteri-prod.apps.fw'],
  );
  assert.equal(
    routesOfCluster(rows, 'GBOCPPROD1', 'PROD', 'all', sig).length,
    2,
    'baska cluster sizdi',
  );
  // ORTAM SUZGECI: ayni cluster'in dev namespace'i PROD listesine GIRMEZ
  assert.deepEqual(
    routesOfCluster(rows, 'GBOCPPROD1', 'DEV', 'all', sig).map((r) => r.namespace),
    ['musteri-dev'],
  );
});

test('CR2 cluster adi BUYUK/KUCUK harf duyarsiz eslesir', () => {
  const rows = [CR('GBOCPPROD2', 'a-prod', 'x-a-prod.apps.fw', 'x')];
  const sig = [S('GBOCPPROD2', 'a-prod', 'x', 1)];
  assert.equal(routesOfCluster(rows, 'gbocpprod2', 'PROD', 'all', sig).length, 1);
  assert.equal(routesOfCluster(rows, 'GBOCPPROD2', 'PROD', 'all', sig).length, 1);
  assert.equal(routesOfCluster(rows, 'BASKA', 'PROD', 'all', sig).length, 0);
});

test('CR4 ortam VERILMEZSE suzgec uygulanmaz (tum ortamlar)', () => {
  const rows = [
    CR('ARK-A', 'a-dev', 'x-a-dev.apps.fw', 'x'),
    CR('ARK-A', 'a-prod', 'y-a-prod.apps.fw', 'y'),
  ];
  assert.equal(routesOfCluster(rows, 'ARK-A', '', 'all', []).length, 2);
});

test('CR5 routesOfIp ile AYNI govde: siniflandirma iki kez yazilmamis', () => {
  // `routeListesi` paylasimi kaynak duzeyinde kilitlenir: ikinci bir siniflandirma
  // kopyasi, olcut degisince iki ekranin farkli sayi gostermesi demekti.
  const src = fs.readFileSync(path.join(__dirname, '..', 'route-stats.cjs'), 'utf8');
  const govde = src.slice(src.indexOf('function routeListesi'));
  assert.match(govde, /canliSinif\(ix, r\)/, 'canli siniflandirma ortak govdede degil');
  // CANLI SINIFLANDIRMA YALNIZ IKI yerde cagrilir: buildRouteStats (sayim) ve
  // routeListesi (liste). Ucuncu bir cagri, kararin kopyalandigi anlamina gelir.
  // `= canliSinif(` CAGRIYI sayar; duz `canliSinif(ix, r)` fonksiyon TANIMINI da tutuyordu
  // ve sayi 3 cikiyordu (ilk yazimda boyle oldu).
  assert.equal(
    (src.match(/= canliSinif\(ix, r\)/g) || []).length,
    2,
    'canliSinif cagri sayisi 2 degil - karar kopyalanmis olabilir',
  );
  // AD EKSENI de ayni disiplinde: isSpaApp yalniz bu iki yerden cagrilir.
  assert.equal((src.match(/isSpaApp\(app\)/g) || []).length, 2, 'isSpaApp cagri sayisi 2 degil');
  assert.ok(
    !/function routesOfCluster[\s\S]{0,400}canliSinif\(/.test(src),
    'routesOfCluster kendi siniflandirmasini yapiyor',
  );
});

test('CR6 uc: cluster adi BEYAZ LISTEYE karsi dogrulanir, yetki kapisini paylasir', () => {
  // Serbest metin kabul etmek, istemciye `cluster_name` uzerinden route envanterinin
  // TAMAMINI sorgulatmak olurdu (platform suzgeci atlanir).
  const den = fs.readFileSync(path.join(__dirname, '..', 'denetim.cjs'), 'utf8');
  const blok = den.slice(
    den.indexOf("router.get('/route-stats/cluster'"),
    den.indexOf("// Bir IP'ye cozen route'lar"),
  );
  assert.ok(blok.length > 0, '/route-stats/cluster ucu yok');
  assert.match(
    blok,
    /clusters\.find\(\(c\) =>/,
    'cluster adi platform listesine karsi dogrulanmiyor',
  );
  assert.match(blok, /status\(400\)/, 'tanimsiz cluster 400 donmuyor');
  // SORGU DOGRULANMIS adi kullanmali, istemciden geleni DEGIL
  assert.match(blok, /value: esles/, 'sorgu istemciden gelen ham adi kullaniyor');
  assert.ok(!/value: cluster\b/.test(blok), 'ham cluster adi sorguya giriyor');
  // Kesif sorgusu da DOGRULANMIS adla cagrilir
  assert.match(
    blok,
    /spaSinyali\(\[esles\]\)/,
    'kesif sorgusu dogrulanmis cluster adiyla cagrilmiyor',
  );
  // YETKI: yol deseni `route-stats` ile baslayan her sey 'spa' sekmesi kapisindan gecer
  // Desen metni OLDUGU GIBI aranir: regex icinde regex kacisi yazmak hem okunmaz hem
  // kirilgan (kacislar bir araci yutarsa bekci sessizce yanlis sey arar).
  assert.ok(
    den.includes('nginx-spa|nginx-spa-coverage|route-stats|nginx-migration'),
    'route-stats yol deseni degismis - yeni uc yetki kapisi disinda kalabilir',
  );
});
