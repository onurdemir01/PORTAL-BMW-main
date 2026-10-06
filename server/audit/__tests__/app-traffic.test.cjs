// server/audit/__tests__/app-traffic.test.cjs — AT1..AT12 (2026-09-30).
//
// Denetim > Route Trafigi ekrani 2026-09-30'da UYGULAMA bazliya cevrildi. Kullanici:
// "Prometheus'tan cektigimiz metrikler calismiyor. Orayi bos ver. Biz sadece application
// usage playbook'unu kullanalim ve Dynatrace metriklerine bakalim."
//
// Bu bekciler, eski RT/RTU serisinden HALA GECERLI olan tuzaklari tasir:
//   - "olculemedi" ile "istek yok" birbirine karismasin (emeklilik karari buna bakiyor)
//   - ayni uygulamanin iki taramasi TOPLANMASIN (ayni istekleri iki kez saymak)
//   - onek eslesmesi tire sinirinda dursun (apigw != apigwhc)
//   - eslesme uygulama x envanter buyuklugunde calismasin (ekran 10 dk acilmamisti)
//   - olcum sorgusu uygulama basina TEK satir cekssin (yarim milyon satir tasinmasin)
//   - route'u OLMAYAN uygulamalar listede KALSIN (eski ekranin kor noktasi)
//   - Thanos kolonlari geri sizmasin (bos kolon = yanlis guven)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildAppTraffic, tekillestir, routelariBul, routeIndeksi } = require('../app-traffic.cjs');

const K = (ns, app, req, extra = {}) => ({
  scan_date: '2026-09-30',
  window_days: 7,
  cluster: 'gbocpprod1',
  namespace: ns,
  app,
  req_total: req,
  services_total: 3,
  services_measured: 3,
  services_skipped: 0,
  measured: 1,
  note: '',
  ...extra,
});
const INV = (ns, route, address = '') => ({
  cluster_name: 'gbocpprod1',
  namespace_name: ns,
  route_name: route,
  route_address: address,
});

test('AT1: uc durum ayri - olculup istek alan / olculup almayan / OLCULEMEYEN', () => {
  const r = buildAppTraffic(
    [
      K('ns-prod', 'canli', 500),
      K('ns-prod', 'sessiz', 0),
      K('ns-prod', 'karanlik', 0, { measured: 0, note: 'metrik sorgusu dustu' }),
    ],
    [],
  );
  const by = Object.fromEntries(r.rows.map((x) => [x.application, x]));
  assert.equal(by.canli.status, 'active');
  assert.equal(by.sessiz.status, 'idle');
  assert.equal(by.karanlik.status, 'unmeasured');
  // OLCULEMEYEN SATIRDA SAYI YOK: 0 yazmak, calisan bir uygulamayi emekli aday gosterir.
  assert.equal(by.canli.reqShown, 500);
  assert.equal(by.sessiz.reqShown, 0);
  assert.equal(by.karanlik.reqShown, null);
  assert.deepEqual(r.summary, {
    apps: 3,
    active: 1,
    idle: 1,
    unmeasured: 1,
    routeless: 3,
    spa: 0,
    routesWithoutUsage: 0,
  });
});

test('AT2: ayni uygulamanin iki taramasi TOPLANMAZ - EN YENI gecerli', () => {
  // Her satir ZATEN window_days gunluk bir pencere tasiyor; iki taramayi toplamak ayni
  // istekleri iki kez saymak olurdu.
  const m = tekillestir([
    K('ns-prod', 'app', 100, { scan_date: '2026-09-23' }),
    K('ns-prod', 'app', 250, { scan_date: '2026-09-30' }),
    K('ns-prod', 'app', 900, { scan_date: '2026-09-28' }),
  ]);
  assert.equal(m.size, 1);
  const u = m.get('ns-prod|app');
  assert.equal(u.req, 250, 'gunler toplanmis ya da en yeni tarama secilmemis');
  assert.equal(u.scanDate, '2026-09-30');
});

test('AT3: onek eslesmesi TIRE sinirinda durur (apigw != apigwhc)', () => {
  const ADR = 'apigw.apps.fw.garanti.com.tr';
  const ix = routeIndeksi([INV('mw-prod', 'apigw', ADR)]);
  const liste = ix.get('mw-prod');
  assert.equal(routelariBul('apigw-1-prod', liste).length, 1, 'onek eslesmesi tutmadi');
  assert.equal(routelariBul('apigw', liste).length, 1, 'tam ad eslesmesi tutmadi');
  assert.equal(
    routelariBul('apigwhc', liste).length,
    0,
    'tiresiz onek eslesmesi ayri bir uygulamayi route ile birlestirdi',
  );
});

test('AT4: ayni route birden fazla uygulamaya baglanabilir - toplama YAPILMAZ', () => {
  // Uretimde olculdu: route `apigw`, Dynatrace `apigw-1-prod`, `-2-prod`, `-3-prod`.
  // Eski ROUTE bazli ekranda bunlar tek satirda TOPLANIYORDU ve "neyin toplandigi"
  // ipucunda kaliyordu. Uygulama bazinda toplam GEREKMEZ: her orneginin kendi satiri var.
  const ADR = 'apigw.apps.fw.garanti.com.tr';
  const r = buildAppTraffic(
    [
      K('mw-prod', 'apigw-1-prod', 9632261646),
      K('mw-prod', 'apigw-2-prod', 9630161449),
      K('mw-prod', 'apigw-3-prod', 9630896886),
    ],
    [INV('mw-prod', 'apigw', ADR)],
  );
  assert.equal(r.rows.length, 3, 'uygulamalar tek satirda toplanmis');
  for (const x of r.rows) {
    assert.deepEqual(
      x.routes.map((y) => y.route),
      ['apigw'],
      'route kolonu bos kaldi',
    );
    assert.equal(x.routes[0].exact, false, 'onek eslesmesi tam eslesme gibi isaretlenmis');
  }
  assert.equal(r.summary.routeless, 0);
  assert.equal(r.summary.routesWithoutUsage, 0);
});

test('AT5: route’u OLMAYAN uygulama listede KALIR (eski ekranin kor noktasi)', () => {
  // Servisten servise cagrilan bir backend router'dan hic gecmez. Route bazli listede
  // ya hic yoktu ya "sifir istek" gorunuyordu - emekli aday diye okunurdu.
  const r = buildAppTraffic([K('ns-prod', 'ic-backend', 42)], [INV('ns-prod', 'baska-app', '')]);
  const satir = r.rows.find((x) => x.application === 'ic-backend');
  assert.ok(satir, 'route’u olmayan uygulama listeden dusmus');
  assert.deepEqual(satir.routes, []);
  assert.equal(satir.status, 'active');
  assert.equal(r.summary.routeless, 1);
  // Envanterde olup hicbir uygulamaya baglanamayan route AYRICA sayilir: "hepsini gordum"
  // yanilgisi olusmasin.
  assert.equal(r.summary.routesWithoutUsage, 1);
});

test('AT6: ortam ve SPA isareti satira gecer', () => {
  const r = buildAppTraffic(
    [K('sube-prod', 'cso-app-v1', 10), K('sube-test', 'api', 10)],
    [INV('sube-prod', 'cso-app-v1', 'cso-app-v1.apps.fw.garanti.com.tr')],
  );
  const by = Object.fromEntries(r.rows.map((x) => [x.application, x]));
  assert.equal(by['cso-app-v1'].spa, true);
  assert.equal(by['cso-app-v1'].env, 'prod');
  assert.equal(by.api.spa, false);
  assert.equal(r.summary.spa, 1);
});

test('AT7: siralama ISTEGE gore azalan; olculemeyen satirlar sona duser', () => {
  const r = buildAppTraffic(
    [
      K('ns-prod', 'kucuk', 5),
      K('ns-prod', 'olculemeyen', 999999, { measured: 0 }),
      K('ns-prod', 'buyuk', 1000),
    ],
    [],
  );
  assert.deepEqual(
    r.rows.map((x) => x.application),
    ['buyuk', 'kucuk', 'olculemeyen'],
    'olculemeyen satirin ham sayisi siralamaya girmis',
  );
});

test('AT8: eslesme UYGULAMA x ENVANTER buyuklugunde calismaz (uretim: ekran 10 dk acilmadi)', () => {
  // 2026-09-29: onek eslesmesi ilk yazildiginda her aday icin tum olcum tablosu
  // yeniden geziliyordu. Kullanici: "Denetim -> Route Trafigi 10 dakikadir acilmadi".
  // Olculdu: 43,5 sn -> namespace indeksinden sonra 0,2 sn.
  //
  // Bu bekci SURE olcer: mantigi degil BUYUME HIZINI korur. Bilerek bol paylidir.
  //
  // DUVAR SAATI DEGIL, SURECIN CPU SURESI (2026-09-30). Ilk yazim `Date.now()`
  // farkini olcuyordu ve tek basina yesil, TUM SUIT paralel kosarken ara sira
  // KIRMIZI donuyordu: diger test surecleriyle CPU paylasilirken BEKLEME de
  // duvar saatine eklenir — esik kodu degil makinenin YUKUNU olcer (bu depoda
  // PD1'de ayni tuzaga dusulmustu). `process.cpuUsage()` yalnizca bu surecin
  // gercekten harcadigi hesaplamayi sayar; esik ve mutasyon ayni kaldi.
  const NS = 100;
  const UYG = 40000;
  const ROUTE = 5000;
  const olcumler = [];
  const envanter = [];
  for (let i = 0; i < UYG; i += 1) olcumler.push(K(`ns-${i % NS}-prod`, `svc${i}-1-prod`, 5));
  for (let i = 0; i < ROUTE; i += 1) {
    const ns = `ns-${i % NS}-prod`;
    envanter.push(INV(ns, `r${i}`, `r${i}.apps.fw.garanti.com.tr`));
  }
  const c0 = process.cpuUsage();
  // TAVAN KALDIRILIR: olculen sey ESLESME maliyeti, kirpma degil.
  const r = buildAppTraffic(olcumler, envanter, { limit: UYG });
  const cpu = process.cpuUsage(c0);
  const sn = (cpu.user + cpu.system) / 1e6;
  assert.equal(r.rows.length, UYG);
  assert.equal(r.totalMatched, UYG);
  // ESIK MUTASYONLA AYARLANDI: indeks kaldirilinca ayni veri 3,1 sn suruyor, saglam
  // halde 0,2 sn. 5 sn'lik ilk esik bu mutasyonu YAKALAMIYORDU - 2 sn hem saglam kosuya
  // on kat pay birakir hem regresyonu gorur.
  assert.ok(
    sn < 2,
    `eslesme ${sn.toFixed(1)} sn CPU harcadi - uygulama x envanter buyuklugunde calisiyor ` +
      `(namespace indeksi kaldirilmis olabilir). Saglam halde 0,2 sn, indeks yokken 3,1 sn.`,
  );
});

test('AT9: uc dbo.BMW_Application_Usage okur ve uygulama basina TEK satir ceker', () => {
  // Olculdu (2026-09-30): tablo gunde ~70.000 satir yaziyor; 7 gunluk pencereyi ham
  // cekmek ~490.000 satir demekti ve altisi zaten atiliyordu.
  const src = fs.readFileSync(path.join(__dirname, '..', 'denetim.cjs'), 'utf8');
  const i = src.indexOf("router.get('/route-traffic'");
  assert.ok(i > 0, 'route-traffic ucu bulunamadi');
  const blok = src.slice(i, i + 4000);
  assert.match(blok, /app-traffic\.cjs/, 'uc uygulama bazli modulu kullanmiyor');
  assert.match(
    blok,
    /OBJECT_ID\('dbo\.BMW_Application_Usage'\)/,
    'tablo varlik kontrolu hala Thanos tablosuna bakiyor',
  );
  assert.match(
    blok,
    /ROW_NUMBER\(\) OVER \(PARTITION BY namespace, app ORDER BY scan_date DESC\)/,
    'en yeni satir secimi veritabaninda yapilmiyor - yarim milyon satir tasiniyor',
  );
  assert.match(blok, /WHERE rn = 1/, 'ROW_NUMBER var ama suzgec yok');
  // PENCERE KORUNMALI: son kosu dusen bir uygulama icin bir onceki olcum gecerlidir.
  assert.match(
    blok,
    /DATEADD\(day, -7, CAST\(GETDATE\(\) AS DATE\)\)/,
    '7 gunluk pencere kaybolmus',
  );
});

test('AT10: THANOS kolonlari geri sizmedi (bos kolon = yanlis guven)', () => {
  // Kullanici: "Hata oranlarini bos ver." Dynatrace 4xx/5xx ve gun kirilimi vermiyor;
  // o kolonlari bos gostermek, veri varmis gibi okunurdu.
  const uc = fs.readFileSync(path.join(__dirname, '..', 'denetim.cjs'), 'utf8');
  const i = uc.indexOf("router.get('/route-traffic'");
  const blok = uc.slice(i, i + 4000);
  assert.ok(
    !/BMW_Openshift_Route_Traffic/.test(blok),
    'uc hala Thanos trafik tablosunu okuyor',
  );
  const ekran = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'components', 'denetim', 'RouteTraffic.tsx'),
    'utf8',
  );
  for (const kolon of ['req7', 'req30', 'req90', 'err4xxPct', 'err5xxPct', 'perDay', 'lastSeen']) {
    assert.ok(!ekran.includes(kolon), `ekranda Thanos alani geri gelmis: ${kolon}`);
  }
  assert.ok(
    !fs.existsSync(path.join(__dirname, '..', 'route-traffic.cjs')),
    'eski route bazli modul hala duruyor - iki kaynak arasinda sessiz ayrisma olur',
  );
});

test('AT11: tablo YOKSA bos liste degil, TABLO YOK denir', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'denetim.cjs'), 'utf8');
  const i = src.indexOf("router.get('/route-traffic'");
  const blok = src.slice(i, i + 4000);
  assert.match(blok, /tableMissing: true/, 'tablo yoksa ekran "hic istek yok" gibi okunur');
  assert.match(blok, /application_usage job/, 'kullaniciya ne yapmasi gerektigi yazilmiyor');
});

test('AT12: rota + sekme kapisi + seed + sayfa sekmesi yerinde', () => {
  const den = fs.readFileSync(path.join(__dirname, '..', 'denetim.cjs'), 'utf8');
  assert.match(den, /\[\/\^\\\/route-traffic\(\\\/\|\$\)\/, 'routetraffic'\]/);
  assert.match(den, /router\.get\('\/route-traffic'/);
  const seed = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
  assert.match(seed, /element_key: 'tab:denetim:routetraffic'/);
  const page = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'components', 'DenetimPage.tsx'),
    'utf8',
  );
  assert.match(page, /id: 'routetraffic', label: 'Uygulama Trafiği'/);
});

test('AT13: liste TAVANA kirpilir ama OZET TUM KUMEDEN gelir', () => {
  // URETIM (2026-09-30): kullanici "Uygulama Trafigi sayfasi dondu ve hicbir sey
  // yuklenmiyor" dedi. Olculdu: 70.059 uygulama = 20,9 MB JSON ve 70.059 x 8 hucre DOM;
  // yanit 8 MB'lik onbellek tavanini da astigi icin her acilis bastan hesaplaniyordu.
  //
  // Kirpma sart AMA ozet kirpilmis listeden hesaplanmamali: o zaman 70.059 uygulamalik
  // bir kume ekranda 1.000 gorunurdu ve "kac uygulama atil" sorusu YANLIS cevaplanirdi.
  const satirlar = [];
  for (let i = 0; i < 2500; i += 1) satirlar.push(K('ns-prod', 'app-' + i, i % 5 === 0 ? 0 : i));
  const r = buildAppTraffic(satirlar, [], { limit: 100 });
  assert.equal(r.rows.length, 100, 'tavan uygulanmiyor - govde sinirsiz buyur');
  assert.equal(r.totalMatched, 2500, 'uyan satir sayisi tasinmiyor');
  assert.equal(r.total, 2500);
  assert.equal(r.truncated, true, 'kirpma isareti yok - ekran "hepsi bu" der');
  assert.equal(r.summary.apps, 2500, 'OZET KIRPILMIS LISTEDEN hesaplanmis');
  assert.equal(r.summary.idle, 500, 'atil sayisi kirpilmis listeden hesaplanmis');
  // Ortam listesi de tum kumeden gelmeli, yoksa suzgec kendi kendini kisitlar.
  assert.deepEqual(r.envs, ['prod']);
});

test('AT14: suzgecler SUNUCUDA uygulanir ve tavani asmaz', () => {
  const satirlar = [
    K('a-prod', 'canli', 10),
    K('a-prod', 'sessiz', 0),
    K('b-test', 'canli-test', 7),
    K('a-prod', 'karanlik', 0, { measured: 0 }),
  ];
  const durum = buildAppTraffic(satirlar, [], { status: 'idle' });
  assert.deepEqual(
    durum.rows.map((x) => x.application),
    ['sessiz'],
  );
  assert.equal(durum.summary.apps, 4, 'ozet suzgecten etkilenmis');
  const ortam = buildAppTraffic(satirlar, [], { env: 'test' });
  assert.deepEqual(
    ortam.rows.map((x) => x.application),
    ['canli-test'],
  );
  const arama = buildAppTraffic(satirlar, [], { q: 'KARANLIK' });
  assert.deepEqual(
    arama.rows.map((x) => x.application),
    ['karanlik'],
    'arama buyuk/kucuk harf duyarli olmamali',
  );
  // 'all' suzgec DEGIL: ekran varsayilan olarak bunu gonderiyor.
  const hepsi = buildAppTraffic(satirlar, [], { status: 'all', env: 'all' });
  assert.equal(hepsi.rows.length, 4, "'all' bir durum degeri gibi suzuluyor");
});

test('AT15: uc suzgecleri sorgu dizesinden OKUR (yoksa govde 20 MB kalir)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'denetim.cjs'), 'utf8');
  const i = src.indexOf("router.get('/route-traffic'");
  const blok = src.slice(i, i + 4500);
  for (const ad of ['q', 'env', 'status', 'kind', 'routes', 'limit']) {
    assert.ok(
      new RegExp('req\.query\.' + ad).test(blok),
      `uc '${ad}' suzgecini okumuyor - suzgec tarayiciya kalir ve tum kume inmek zorunda kalir`,
    );
  }
});

// ── AT16: CLUSTER route envanterinden doldurulur ───────────────────────────────────
//
// Uretim (2026-10-06, kullanici: "cluster kolonu bombos geliyor"). dbo.BMW_Application_Usage
// cluster'i BOS yaziyor: Dynatrace CLOUD_APPLICATION entity'sinde `clusterName` gelmiyor.
// Ayni bilgi dbo.BMW_Openshift_Route_Inventory.cluster_name icinde DOLU; uygulamanin
// route'lari hangi cluster'daysa cluster odur.
test('AT16: Dynatrace cluster bos ise route envanterinden gelir; dolu ise EZILMEZ', () => {
  const kullanim = [
    { scan_date: '2026-10-06', window_days: 7, cluster: '', namespace: 'ns1', app: 'odeme-v1', req_total: 5, measured: 1, services_total: 1, services_measured: 1, services_skipped: 0 },
    { scan_date: '2026-10-06', window_days: 7, cluster: 'gbocpprod9', namespace: 'ns1', app: 'kart-v1', req_total: 5, measured: 1, services_total: 1, services_measured: 1, services_skipped: 0 },
    { scan_date: '2026-10-06', window_days: 7, cluster: '', namespace: 'ns2', app: 'routesuz-v1', req_total: 5, measured: 1, services_total: 1, services_measured: 1, services_skipped: 0 },
  ];
  const envanter = [
    { cluster_name: 'gbocpprod1', namespace_name: 'ns1', route_name: 'odeme-v1', route_address: 'odeme.bmw.de' },
    // ayni uygulama iki cluster'da olabilir: ikisi de yazilir, biri secilip oteki GIZLENMEZ
    { cluster_name: 'gbocpprod2', namespace_name: 'ns1', route_name: 'odeme-v1', route_address: 'odeme2.bmw.de' },
    { cluster_name: 'gbocpprod3', namespace_name: 'ns1', route_name: 'kart-v1', route_address: 'kart.bmw.de' },
  ];
  const { rows } = buildAppTraffic(kullanim, envanter, { limit: 100 });
  const g = (a) => rows.find((r) => r.application === a);
  assert.equal(g('odeme-v1').cluster, 'gbocpprod1, gbocpprod2', 'route envanterinden dolmuyor');
  assert.equal(g('odeme-v1').clusterSrc, 'route');
  // Dynatrace degeri varsa EZILMEZ
  assert.equal(g('kart-v1').cluster, 'gbocpprod9');
  assert.equal(g('kart-v1').clusterSrc, 'dynatrace');
  // Ikisi de yoksa alan BOS kalir - uydurulmus bir cluster adi yazmak daha kotudur
  assert.equal(g('routesuz-v1').cluster, '');
  assert.equal(g('routesuz-v1').clusterSrc, null);
});
