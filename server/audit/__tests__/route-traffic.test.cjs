// server/audit/__tests__/route-traffic.test.cjs — RT1..RT7 (2026-09-21).
//
// Route Trafigi siniflamasi: "bu route yasiyor mu?" hukmu gun toplamlarindan verilir.
// Kilit: esikler (30/90 gun), cluster'larin toplanmasi, envanterde olup trafik satiri
// olmayan route'un "veri yok" olmasi, ilk kosunun 14 gunluk penceresinin gunluk
// ortalamayi sisirmemesi, ve denetim.cjs'in sekme kapisi/rotasi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildRouteTraffic } = require('../route-traffic.cjs');

const NOW = new Date('2026-09-21T10:00:00Z');
const day = (n) => new Date(Date.UTC(2026, 8, 21 - n)); // n gun once
const row = (n, ns, route, req, extra = {}) => ({
  scan_date: day(n),
  window_hours: 24,
  cluster: 'gbocpprod1',
  namespace: ns,
  route,
  req_total: req,
  r2xx: req,
  r4xx: 0,
  r5xx: 0,
  ...extra,
});
const inv = (ns, route, address = '') => ({
  cluster_name: 'gbocpprod1',
  namespace_name: ns,
  route_name: route,
  route_address: address,
});

test('RT1: son 30 gunde istek -> active; 30-90 arasi -> silent; hic -> dead', () => {
  const t = [
    row(1, 'a-prod', 'x', 5),
    row(45, 'a-prod', 'x', 1),
    row(1, 'b-prod', 'y', 0),
    row(45, 'b-prod', 'y', 3),
    row(1, 'c-prod', 'z', 0),
    row(60, 'c-prod', 'z', 0),
  ];
  const r = buildRouteTraffic(t, [], { now: NOW });
  const by = Object.fromEntries(r.rows.map((x) => [x.route, x]));
  assert.equal(by.x.status, 'active');
  assert.equal(by.y.status, 'silent');
  assert.equal(by.z.status, 'dead');
  assert.equal(by.y.lastSeen, '2026-08-07');
  assert.equal(by.z.lastSeen, null);
  assert.deepEqual(r.summary, {
    routes: 3,
    active: 1,
    silent: 1,
    dead: 1,
    nodata: 0,
    spa: 0,
    spaDead: 0,
  });
});

test('RT2: envanterde var, trafik satiri yok -> nodata (listede gorunur)', () => {
  const r = buildRouteTraffic(
    [row(1, 'a-prod', 'x', 1)],
    [inv('a-prod', 'x'), inv('q-prod', 'ghost', 'ghost-q-prod.apps.x')],
    { now: NOW },
  );
  const ghost = r.rows.find((x) => x.route === 'ghost');
  assert.ok(ghost);
  assert.equal(ghost.status, 'nodata');
  assert.equal(ghost.inInventory, true);
  assert.equal(ghost.address, 'ghost-q-prod.apps.x');
  assert.equal(r.rows.find((x) => x.route === 'x').inInventory, true);
});

test("RT3: ayni route iki cluster'da -> toplanir, cluster listesi ikisini de tasir", () => {
  const t = [row(1, 'a-prod', 'x', 2), row(1, 'a-prod', 'x', 3, { cluster: 'gbocpprod2' })];
  const r = buildRouteTraffic(t, [], { now: NOW });
  assert.equal(r.rows[0].req7, 5);
  assert.deepEqual(r.rows[0].clusters, ['gbocpprod1', 'gbocpprod2']);
});

test('RT4: ilk kosu 14d penceresi (336 saat) gunluk ortalamayi sisirmez', () => {
  const t = [row(1, 'a-prod', 'x', 1400, { window_hours: 336 })];
  const r = buildRouteTraffic(t, [], { now: NOW });
  assert.equal(r.rows[0].req30, 1400);
  assert.equal(r.rows[0].perDay, 100); // 1400 / 14 gun
});

test('RT5: SPA tespiti adresten (-app-v), 4xx/5xx yuzdesi 90 gun toplamindan', () => {
  const t = [
    row(1, 'a-prod', 'cso-app-v1-route-1', 100, { r2xx: 0, r4xx: 100 }),
    row(2, 'a-prod', 'api', 200, { r2xx: 190, r5xx: 10 }),
  ];
  const r = buildRouteTraffic(
    t,
    [inv('a-prod', 'cso-app-v1-route-1', 'cso-app-v1-a-prod.apps.x')],
    { now: NOW },
  );
  const by = Object.fromEntries(r.rows.map((x) => [x.route, x]));
  assert.equal(by['cso-app-v1-route-1'].spa, true);
  assert.equal(by['cso-app-v1-route-1'].err4xxPct, 100);
  assert.equal(by['cso-app-v1-route-1'].app, 'cso-app-v1');
  assert.equal(by.api.spa, false);
  assert.equal(by.api.err5xxPct, 5);
  assert.equal(r.summary.spa, 1);
});

test('RT6: kapsanan gun sayisi ve tarih araligi donuyor (ekran "veri N gun" notu)', () => {
  const r = buildRouteTraffic([row(1, 'a', 'x', 1), row(3, 'a', 'x', 1), row(3, 'b', 'y', 0)], [], {
    now: NOW,
  });
  assert.equal(r.daysCovered, 2);
  assert.equal(r.latestScan, '2026-09-20');
  assert.equal(r.earliestScan, '2026-09-18');
  assert.equal(r.deadDays, 90);
});

test('RT7: denetim.cjs rota + sekme kapisi + seed + sayfa sekmesi', () => {
  const den = fs.readFileSync(path.join(__dirname, '..', 'denetim.cjs'), 'utf8');
  assert.match(den, /\[\/\^\\\/route-traffic\(\\\/\|\$\)\/, 'routetraffic'\]/);
  assert.match(den, /router\.get\('\/route-traffic'/);
  assert.match(den, /DATEADD\(day, -\$\{DEAD_DAYS\}/);
  const seed = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
  assert.match(seed, /element_key: 'tab:denetim:routetraffic'/);
  const page = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'components', 'DenetimPage.tsx'),
    'utf8',
  );
  assert.match(page, /id: 'routetraffic', label: 'Route Trafiği'/);
});

// ── Dynatrace servis olcumu (2026-09-28, kullanici) ──────────────────────────────────
// Kullanici gonderdigi betik: OpenShift uygulamalarinin Dynatrace servislerine bakip istek
// alip almadigini olcuyor. Route trafigi ROUTER'dan gecen istekleri sayiyor; route'u
// olmayan backend'ler orada hic gorunmuyordu.

test('RTU1: servis olcumu satira eklenir - EN YENI tarama gecerli, gunler TOPLANMAZ', () => {
  const now = new Date('2026-09-28T00:00:00Z');
  const traffic = [
    {
      scan_date: '2026-09-27',
      window_hours: 24,
      cluster: 'c',
      namespace: 'ns1',
      route: 'app-a',
      req_total: 5,
      r2xx: 5,
      r4xx: 0,
      r5xx: 0,
    },
  ];
  const inv = [
    {
      cluster_name: 'c',
      namespace_name: 'ns1',
      route_name: 'app-a',
      route_address: 'app-a.apps.x',
    },
  ];
  const usage = [
    {
      scan_date: '2026-09-20',
      window_days: 35,
      cluster: 'c',
      namespace: 'ns1',
      app: 'app-a',
      req_total: 100,
      services_total: 2,
      services_measured: 2,
      services_skipped: 0,
      measured: 1,
      note: null,
    },
    {
      scan_date: '2026-09-27',
      window_days: 35,
      cluster: 'c',
      namespace: 'ns1',
      app: 'app-a',
      req_total: 900,
      services_total: 2,
      services_measured: 2,
      services_skipped: 0,
      measured: 1,
      note: null,
    },
  ];
  const r = buildRouteTraffic(traffic, inv, { now, usageRows: usage });
  // HER SATIR 35 GUNLUK PENCEREYI tasiyor; gunleri toplamak ayni istekleri defalarca
  // saymak olurdu (100+900=1000 YANLIS cevap).
  assert.equal(r.rows[0].usage.req, 900, 'en yeni tarama yerine toplam alinmis');
  assert.equal(r.rows[0].usage.windowDays, 35);
});

test('RTU2: OLCULEMEYEN uygulama 0 istek DEGIL, eslesmeyen de 0 DEGIL', () => {
  const now = new Date('2026-09-28T00:00:00Z');
  const traffic = [
    {
      scan_date: '2026-09-27',
      window_hours: 24,
      cluster: 'c',
      namespace: 'ns1',
      route: 'app-a',
      req_total: 1,
      r2xx: 1,
      r4xx: 0,
      r5xx: 0,
    },
    {
      scan_date: '2026-09-27',
      window_hours: 24,
      cluster: 'c',
      namespace: 'ns2',
      route: 'app-b',
      req_total: 1,
      r2xx: 1,
      r4xx: 0,
      r5xx: 0,
    },
  ];
  const usage = [
    // app-a: servisleri var ama hicbiri olculemedi -> measured=0
    {
      scan_date: '2026-09-27',
      window_days: 35,
      cluster: 'c',
      namespace: 'ns1',
      app: 'app-a',
      req_total: 0,
      services_total: 3,
      services_measured: 0,
      services_skipped: 0,
      measured: 0,
      note: 'HTTP 500',
    },
  ];
  const r = buildRouteTraffic(traffic, [], { now, usageRows: usage });
  const a = r.rows.find((x) => x.route === 'app-a');
  const b = r.rows.find((x) => x.route === 'app-b');
  // OLCULEMEDI: sayi VERILMEZ (null), measured=false ile birlikte.
  assert.equal(a.usage.measured, false, 'olculemeyen satir olculdu sayilmis');
  assert.equal(
    a.usage.req,
    null,
    'olculemeyen uygulamaya 0 istek yazilmis - "kullanilmiyor" diye okunur',
  );
  assert.equal(a.usage.note, 'HTTP 500', 'gercek hata sebebi tasinmiyor');
  // ESLESMEDI: olcum satiri YOK -> null. "0 istek" ile karistirilmamali.
  assert.equal(b.usage, null, 'olcumu olmayan satira sayi uydurulmus');
});

test("RTU3: route'u olmayan uygulamalar ozette GORUNUR (kor nokta gizlenmesin)", () => {
  const now = new Date('2026-09-28T00:00:00Z');
  const traffic = [
    {
      scan_date: '2026-09-27',
      window_hours: 24,
      cluster: 'c',
      namespace: 'ns1',
      route: 'app-a',
      req_total: 1,
      r2xx: 1,
      r4xx: 0,
      r5xx: 0,
    },
  ];
  const usage = [
    {
      scan_date: '2026-09-27',
      window_days: 35,
      cluster: 'c',
      namespace: 'ns1',
      app: 'app-a',
      req_total: 10,
      services_total: 1,
      services_measured: 1,
      services_skipped: 0,
      measured: 1,
      note: null,
    },
    // Bu backend'in route'u YOK: route trafiginde hic gorunmez. Sayilmazsa "hepsini gordum"
    // yanilgisi olusur - bu ozelligin varlik sebebi tam olarak bu.
    {
      scan_date: '2026-09-27',
      window_days: 35,
      cluster: 'c',
      namespace: 'ns9',
      app: 'backend-x',
      req_total: 42,
      services_total: 1,
      services_measured: 1,
      services_skipped: 0,
      measured: 1,
      note: null,
    },
  ];
  const r = buildRouteTraffic(traffic, [], { now, usageRows: usage });
  assert.equal(r.usage.olculenUygulama, 2);
  assert.equal(r.usage.eslesen, 1);
  assert.equal(r.usage.routesuz, 1, "route'u olmayan uygulama sayisi bildirilmiyor");
});

test('RTU4: olcum tablosu YOKKEN route sonuclari degismez', () => {
  const now = new Date('2026-09-28T00:00:00Z');
  const traffic = [
    {
      scan_date: '2026-09-27',
      window_hours: 24,
      cluster: 'c',
      namespace: 'ns1',
      route: 'app-a',
      req_total: 7,
      r2xx: 7,
      r4xx: 0,
      r5xx: 0,
    },
  ];
  const ile = buildRouteTraffic(traffic, [], { now, usageRows: [] });
  const olmadan = buildRouteTraffic(traffic, [], { now });
  // Bir kaynagin eksikligi otekini karartmamali.
  assert.equal(ile.rows[0].status, olmadan.rows[0].status);
  assert.equal(olmadan.rows[0].req90, 7);
  assert.equal(olmadan.rows[0].usage, null);
  assert.deepEqual(olmadan.usage, { olculenUygulama: 0, eslesen: 0, routesuz: 0, olculemeyen: 0 });
});

// ── RTU5/RTU6: ONEK ESLESMESI (uretimde olculdu, 2026-09-29) ─────────────────────────
// Route `apigw.apps.fw.garanti.com.tr`, namespace `middleware-architecture-prod`.
// Dynatrace ayni namespace'te `apigw-1-prod`, `apigw-2-prod`, `apigw-3-prod` diyor -
// ucu de ~9,63 milyar istek, yani AYNI gecidin uc ornegi. Tam ad eslesmesi tutmuyordu ve
// EN COK ISTEK ALAN satirlar bos kaliyordu.
const kullanim = (ns, app, req, measured = 1, extra = {}) => ({
  scan_date: day(0),
  namespace: ns,
  app,
  req_total: req,
  window_days: 7,
  measured,
  services_total: 5948,
  services_measured: 5948,
  services_skipped: 0,
  note: '',
  cluster: 'gbocpprod1',
  ...extra,
});

test('RTU5: ayni onegi tasiyan uygulamalar TOPLANIR ve NELERIN toplandigi yazilir', () => {
  const NS = 'middleware-architecture-prod';
  const ADR = 'apigw.apps.fw.garanti.com.tr';
  const r = buildRouteTraffic([row(1, NS, ADR, 10)], [inv(NS, ADR, ADR)], {
    now: NOW,
    usageRows: [
      kullanim(NS, 'apigw-1-prod', 9632261646),
      kullanim(NS, 'apigw-2-prod', 9630161449),
      kullanim(NS, 'apigw-3-prod', 9630896886),
      // Ayni onek AMA tiresiz: baska bir route. TOPLAMA GIRMEMELI.
      kullanim(NS, 'apigwhc', 5),
    ],
  });
  const satir = r.rows.find((x) => x.route === ADR);
  assert.ok(satir && satir.usage, 'en cok istek alan satir hala eslesmiyor');
  assert.equal(satir.usage.req, 9632261646 + 9630161449 + 9630896886);
  assert.deepEqual(satir.usage.aggregated, ['apigw-1-prod', 'apigw-2-prod', 'apigw-3-prod']);
  assert.ok(
    !satir.usage.aggregated.includes('apigwhc'),
    'tiresiz onek eslesmesi ayri bir uygulamayi toplama katmis',
  );
});

test('RTU6: OLCULEMEYEN uygulama toplama 0 olarak KATILMAZ', () => {
  const NS = 'ns-prod';
  const ADR = 'gw.apps.fw.garanti.com.tr';
  const r = buildRouteTraffic([row(1, NS, ADR, 10)], [inv(NS, ADR, ADR)], {
    now: NOW,
    usageRows: [
      kullanim(NS, 'gw-1', 100),
      // measured=0: olculemedi. Satirda bir sayi DURSA BILE toplama katilmamali -
      // olculemeyen bir olcumu tam gibi gostermek, eksik toplami kesin gosterirdi.
      kullanim(NS, 'gw-2', 50, 0, { note: 'metrik sorgusu dustu' }),
    ],
  });
  const u = r.rows.find((x) => x.route === ADR).usage;
  assert.equal(u.req, 100, 'olculemeyen uygulama toplama katilmis');
  assert.equal(u.measured, true, 'en az bir olcum varken olculemedi denmis');
  assert.equal(u.unmeasured, 1, 'kac uygulamanin olculemedigi tasinmiyor');
  assert.deepEqual(u.aggregated, ['gw-1', 'gw-2']);
});

test('RTU7: TAM AD eslesmesi varsa onek eslesmesine DUSULMEZ', () => {
  const NS = 'ns-prod';
  const ADR = 'gw.apps.fw.garanti.com.tr';
  const r = buildRouteTraffic([row(1, NS, ADR, 10)], [inv(NS, ADR, ADR)], {
    now: NOW,
    usageRows: [kullanim(NS, 'gw', 7), kullanim(NS, 'gw-1', 100)],
  });
  const u = r.rows.find((x) => x.route === ADR).usage;
  assert.equal(u.req, 7, 'tam ad eslesmesi varken onek toplami kullanilmis');
  assert.equal(u.aggregated, undefined, 'tam eslesmede toplam isareti birakilmis');
});

test('RTU8: olcum eslesmesi ROUTE x OLCUM buyuklugunde calismaz (uretim: ekran 10 dk acilmadi)', () => {
  // 2026-09-29: onek eslesmesi ilk yazildiginda her route icin `[...usage.entries()]`
  // cagriliyordu - 70.000 elemanli dizi, her route icin her aday icin YENIDEN. Kullanici:
  // "Denetim -> Route Trafigi 10 dakikadir acilmadi". Olculdu: 5.000 route x 70.000 olcum
  // -> 43,5 sn; namespace indeksinden sonra 0,2 sn.
  //
  // Bu bekci SURE olcer: mantigi degil, BUYUME HIZINI korur. Bilerek bol paylidir -
  // amaci yavas bir makinede kirmizi yanmak degil, kare karmasikligin geri gelmesini
  // yakalamak.
  const ROUTES = 2000;
  const OLCUM = 40000;
  const NS = 100;
  const trafik = [];
  const envanter = [];
  const olcumler = [];
  for (let i = 0; i < ROUTES; i += 1) {
    const ns = `ns-${i % NS}-prod`;
    const adr = `app${i}.apps.fw.garanti.com.tr`;
    trafik.push(row(1, ns, adr, 10));
    envanter.push(inv(ns, adr, adr));
  }
  for (let i = 0; i < OLCUM; i += 1) {
    olcumler.push(kullanim(`ns-${i % NS}-prod`, `svc${i}-1-prod`, 5));
  }
  const t0 = Date.now();
  const r = buildRouteTraffic(trafik, envanter, { now: NOW, usageRows: olcumler });
  const sn = (Date.now() - t0) / 1000;
  assert.equal(r.rows.length, ROUTES);
  assert.ok(
    sn < 5,
    `olcum eslesmesi ${sn.toFixed(1)} sn surdu - route x olcum buyuklugunde calisiyor ` +
      `(namespace indeksi kaldirilmis olabilir). Duzeltmeden once bu deger 43,5 sn idi.`,
  );
});

test('RTU9: olcum sorgusu uygulama basina TEK satir ceker (yarim milyon satir tasinmasin)', () => {
  // Olculdu (2026-09-30): tablo gunde ~70.000 satir yaziyor; 7 gunluk pencere ~490.000
  // satir demekti ve buildUsageMap zaten her (namespace, app) icin YALNIZ EN YENISINI
  // tutuyordu - altisi bosuna tasiniyordu. Ekranin gec acilmasinin sebebi buydu
  // (eslesme mantigi ayni veride 0,3 sn suruyor).
  const src = fs.readFileSync(path.join(__dirname, '..', 'denetim.cjs'), 'utf8');
  const i = src.indexOf('FROM dbo.BMW_Application_Usage');
  assert.ok(i > 0, 'olcum sorgusu bulunamadi');
  const blok = src.slice(Math.max(0, i - 1200), i + 600);
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
