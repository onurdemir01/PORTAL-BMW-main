// server/audit/app-traffic.cjs — Denetim > Uygulama Trafigi: ROUTE bazli kullanim.
//
// KULLANICI KARARI (2026-09-30): "Prometheus'tan cektigimiz metrikler calismiyor. Orayi
// bos ver. Biz sadece application usage playbook'unu kullanalim ve Dynatrace metriklerine
// bakalim. Hata oranlarini bos ver."
//
// BIRIM: ROUTE (kullanici, 2026-10-06). Istenen akis onun sozleriyle: "tum route'lari
// cekiyoruz -> bu route'larin hangi uygulamaya ait oldugunu kesfediyoruz -> bu uygulamanin
// hangi ortamda ve hangi cluster'larda oldugunu buluyoruz -> bu route'lara gelen trafigi
// Dynatrace uzerinden sorguluyoruz -> metrik tespit edildiyse 'Istek' kolonuna isliyoruz"
// + "route'a sahip uygulamanin SPA olup olmadigini da yaziyoruz".
//
// 30 EYLUL'DE BIRIM UYGULAMAYA CEVRILMISTI, GERI ALINDI. O zamanki gerekce: 1.020 prod
// route'un yalniz 29'u bir Dynatrace uygulamasiyla eslesiyordu, yani route bazli ekranin
// %97'si "eslesmedi" gorunecekti. ESLESMEYI BOZAN SEY SONRADAN BULUNDU: Dynatrace
// type("CLOUD_APPLICATION") hem Deployment'i hem her ReplicaSet'i donduruyordu ve
// `security-tcs-v3-79bd8fbbbd` gibi ReplicaSet adlari hicbir route adiyla eslesmiyordu
// (bkz. application_usage.py replicaset_ele, 2026-10-06). Birimi degistirmek o kirliligin
// SEMPTOMUNU orterdi; kaynak duzelince dogru birim geri alinabilir.
//
// ESLESMEYEN ROUTE GIZLENMEZ: "eslesmedi" ayri bir durumdur ve satir olarak durur. Kullanici
// karari (2026-10-06): "eslesmeyenleri 'eslesmedi' olarak goster". Gizlemek, envanterdeki
// route'un olculdugu izlenimini verirdi.
//
// ROUTE'SUZ UYGULAMALAR DA DURUR: servisten servise cagrilan bir backend router'dan hic
// gecmez. Eski route bazli ekranin en buyuk kor noktasi buydu; `kind: 'app'` satirlariyla
// korunuyor.
//
// DURUSTLUK SINIRI — ISTEK KOLONU: Dynatrace trafigi ROUTE bazinda olcmuyor; servis bazinda
// olcup UYGULAMAYA topluyor. Bu yuzden satir route olsa da "Istek" o route'un degil, ona
// bagli uygulamanin toplamidir. Bir uygulamanin birden cok route'u varsa AYNI sayi her
// satirda gorunur (`reqShared: true` ile isaretlenir, ekran bunu yazar). Bunu gizlemek
// "bu route'a su kadar istek geldi" diye okunurdu ki yanlis olur.
//
// KALDIRILAN: gun bazli gecmis (son 7/30/90 gun), gunluk ortalama ve 4xx/5xx oranlari.
// Hepsi Prometheus/Thanos olcumunden geliyordu; Dynatrace bu kirilimi vermiyor ve
// kullanici "hata oranlarini bos ver" dedi.
'use strict';

const { envOfNamespace } = require('./ocp-platforms.cjs');
const { isSpaApp } = require('./spa-pattern.cjs');

const L = (s) =>
  String(s == null ? '' : s)
    .trim()
    .toLowerCase();

/** "app-ns.apps.fw.garanti.com.tr" -> "app-ns" */
const etiket = (adres) => L(adres).split('.')[0];

/**
 * Olcum satirlarini (namespace, app) basina TEKILLESTIRIR: EN YENI tarama gecerlidir.
 *
 * GUNLER TOPLANMAZ: her satir zaten `window_days` gunluk bir pencereyi tasiyor; iki
 * taramayi toplamak ayni istekleri iki kez saymak olurdu.
 */
function tekillestir(usageRows) {
  const m = new Map();
  for (const r of usageRows || []) {
    const ns = L(r.namespace);
    const app = L(r.app);
    if (!ns || !app || !r.scan_date) continue;
    const gun = new Date(r.scan_date).toISOString().slice(0, 10);
    const k = ns + '|' + app;
    const onceki = m.get(k);
    if (onceki && onceki.scanDate >= gun) continue;
    m.set(k, {
      namespace: String(r.namespace).trim(),
      application: String(r.app).trim(),
      cluster: String(r.cluster || '').trim(),
      scanDate: gun,
      windowDays: Number(r.window_days) || 0,
      req: Number(r.req_total) || 0,
      // OLCULEMEDI ile ISTEK YOK AYRI: measured=0 ise sayi bir alt sinir bile degildir.
      measured: r.measured === true || Number(r.measured) === 1,
      services: Number(r.services_total) || 0,
      servicesMeasured: Number(r.services_measured) || 0,
      servicesSkipped: Number(r.services_skipped) || 0,
      note: String(r.note || '').trim(),
    });
  }
  return m;
}

/**
 * Route envanterini namespace basina indeksler.
 *
 * INDEKS BIR KEZ KURULUR: route basina tum olcum kumesini taramak, 15.000 x 70.000
 * buyuklugunde bir is olurdu (ayni hata 2026-09-29'da ekrani 10 dakika actirmamisti).
 */
function routeIndeksi(invRows) {
  const byNs = new Map();
  for (const r of invRows || []) {
    const ns = L(r.namespace_name);
    if (!ns) continue;
    if (!byNs.has(ns)) byNs.set(ns, []);
    byNs.get(ns).push({
      route: String(r.route_name || '').trim(),
      address: String(r.route_address || '').trim(),
      cluster: String(r.cluster_name || '').trim(),
      namespace: String(r.namespace_name || '').trim(),
      // Eslesme icin: route adi ve adresin ilk etiketi.
      adaylar: [L(r.route_name), etiket(r.route_address)].filter(Boolean),
    });
  }
  return byNs;
}

/**
 * Uygulamaya ait route'lar (UYGULAMA -> ROUTE yonu; route'suz uygulama satiri icin).
 *
 * ESLESME IKI YONLU: route adi uygulamanin TAMAMI olabilir (`sube-portali-app-v1`) ya da
 * uygulama adinin ONEKI olabilir (`apigw` -> `apigw-1-prod`). Onek sinirinda TIRE aranir:
 * "apigw" ile "apigwhc" ayri uygulamalardir.
 */
function routelariBul(app, nsRoutes) {
  if (!nsRoutes || !nsRoutes.length) return [];
  const a = L(app);
  const bulunan = [];
  for (const r of nsRoutes) {
    const tam = r.adaylar.some((c) => c === a);
    const onek = !tam && r.adaylar.some((c) => c && a.startsWith(c + '-'));
    if (tam || onek)
      bulunan.push({ route: r.route, address: r.address, exact: tam, cluster: r.cluster });
  }
  return bulunan;
}

/**
 * Bir route'a hangi uygulamalar ait (ROUTE -> UYGULAMA yonu; ekranin ana yonu).
 *
 * TAM ESLESME VARSA ONEKLER ELENIR: `apigw` route'u hem `apigw` hem `apigw-1-prod` ile
 * eslesebilir; tam eslesen varken onekleri de yazmak ayni route'u iki uygulamaya baglardi.
 * Tam eslesme yoksa TUM onekler kalir (`apigw` -> apigw-1/2/3-prod uctur ve ucu de gercek).
 */
function uygulamalariBul(route, nsApps) {
  if (!nsApps || !nsApps.length) return [];
  const tamlar = [];
  const onekler = [];
  for (const u of nsApps) {
    const a = L(u.application);
    if (route.adaylar.some((c) => c === a)) tamlar.push(u);
    else if (route.adaylar.some((c) => c && a.startsWith(c + '-'))) onekler.push(u);
  }
  return tamlar.length ? tamlar : onekler;
}

/**
 * Bir route satirinin olcum alanlari.
 *
 * BIRDEN COK UYGULAMA: istek TOPLANIR (farkli uygulamalar farkli servisler; ayni istek iki
 * kez sayilmaz). Durum TEMKINLI tarafta: uygulamalardan BIRI bile olculemediyse satir
 * `unmeasured` olur - "bir kismini olctum" ile "hepsini olctum" ayni sey degildir.
 */
function routeOlcumu(uygular) {
  if (!uygular.length) return { status: 'unmatched', reqShown: null, measured: false };
  const hepsiOlculdu = uygular.every((u) => u.measured);
  const toplam = uygular.reduce((a, u) => a + (u.measured ? u.req : 0), 0);
  return {
    status: !hepsiOlculdu ? 'unmeasured' : toplam > 0 ? 'active' : 'idle',
    reqShown: hepsiOlculdu ? toplam : null,
    measured: hepsiOlculdu,
  };
}

/** Varsayilan satir tavani. Bkz. buildAppTraffic'teki OLCUM notu. */
const LIMIT_DEFAULT = 1000;
/** CSV icin acik istek uzerine cikilabilecek tavan. */
const LIMIT_MAX = 100000;

/**
 * Suzgecler SUNUCUDA uygulanir.
 *
 * NEDEN SUNUCUDA (2026-09-30, kullanici: "sayfa dondu ve hicbir sey yuklenmiyor"):
 * ekran once tum kumeyi indirip tarayicida suzuyordu. Olculdu: 70.059 satir =
 * 20,9 MB JSON ve 70.059 x 9 hucre DOM. Yanit 8 MB'lik onbellek tavanini da astigi
 * icin her acilis bastan hesaplaniyordu. Suzgeci sunucuya almak govdeyi birkac yuz
 * KB'ye indirir ve yaniti yeniden onbelleklenebilir kilar (anahtar sorgu dizesini
 * icerir, bkz. response-cache.cjs).
 *
 * `routes` suzgeci SATIR TURUNU secer: 'with' = route satirlari, 'without' = route'u
 * olmayan uygulama satirlari.
 */
function suz(rows, { q = '', env = '', status = '', kind = '', routes = '' } = {}) {
  const needle = L(q);
  const e = L(env);
  return rows.filter((r) => {
    if (e && e !== 'all' && L(r.env || '') !== e) return false;
    if (kind === 'spa' && !r.spa) return false;
    if (kind === 'nonspa' && r.spa) return false;
    if (status && status !== 'all' && r.status !== status) return false;
    if (routes === 'with' && r.kind !== 'route') return false;
    if (routes === 'without' && r.kind !== 'app') return false;
    if (
      needle &&
      !(
        L(r.namespace).includes(needle) ||
        L(r.application || '').includes(needle) ||
        L(r.route || '').includes(needle) ||
        L(r.address || '').includes(needle) ||
        (r.apps || []).some((x) => L(x).includes(needle))
      )
    )
      return false;
    return true;
  });
}

/**
 * @param {object[]} usageRows dbo.BMW_Application_Usage satirlari
 * @param {object[]} invRows   dbo.BMW_Openshift_Route_Inventory satirlari
 * @param {object}   opt       suzgecler + `limit` (satir tavani)
 */
function buildAppTraffic(usageRows, invRows, opt = {}) {
  const olcumler = tekillestir(usageRows);
  const nsIndeks = routeIndeksi(invRows);

  // Namespace basina olcum listesi: route -> uygulama eslesmesi bunun uzerinde yapilir.
  const nsApps = new Map();
  let latestScan = null;
  for (const u of olcumler.values()) {
    if (!latestScan || u.scanDate > latestScan) latestScan = u.scanDate;
    const k = L(u.namespace);
    if (!nsApps.has(k)) nsApps.set(k, []);
    nsApps.get(k).push(u);
  }

  const rows = [];
  const eslesenApp = new Set();

  // ── 1) ROUTE SATIRLARI ──────────────────────────────────────────────────────────
  for (const [ns, routeler] of nsIndeks) {
    for (const r of routeler) {
      const uygular = uygulamalariBul(r, nsApps.get(ns) || []);
      for (const u of uygular) eslesenApp.add(L(u.namespace) + '|' + L(u.application));
      const olcum = routeOlcumu(uygular);
      const ilk = uygular[0] || null;
      rows.push({
        kind: 'route',
        // CLUSTER ROUTE ENVANTERINDEN (uretim, 2026-10-06: kullanici "cluster kolonu
        // bombos geliyor"). Dynatrace CLOUD_APPLICATION entity'sinde `clusterName`
        // gelmiyor, yani olcum satirindaki cluster BOS. Route envanterinde DOLU; birim
        // route olunca bu alan tanim geregi dolu gelir.
        cluster: r.cluster,
        clusterSrc: r.cluster ? 'route' : null,
        namespace: r.namespace,
        route: r.route,
        address: r.address,
        // Birden cok uygulama eslesebilir (`apigw` -> apigw-1/2/3-prod). Ekran ilkini
        // yazar, tamami `apps` icinde durur; hicbiri gizlenmez.
        application: ilk ? ilk.application : null,
        apps: uygular.map((u) => u.application),
        appCount: uygular.length,
        env: envOfNamespace(r.namespace),
        // SPA isareti ESLESEN UYGULAMAYA gore (kullanici: "route'a sahip uygulamanin SPA
        // olup olmadigini da yaziyoruz"). Eslesme yoksa route adindan tahmin EDILMEZ.
        spa: ilk ? isSpaApp(ilk.application) : false,
        ...olcum,
        // Ayni uygulamanin birden cok route'u varsa AYNI sayi her satirda gorunur.
        reqShared: !!ilk && routelariBul(ilk.application, nsIndeks.get(ns)).length > 1,
        windowDays: ilk ? ilk.windowDays : 0,
        scanDate: ilk ? ilk.scanDate : null,
        services: uygular.reduce((a, u) => a + u.services, 0),
        servicesMeasured: uygular.reduce((a, u) => a + u.servicesMeasured, 0),
        servicesSkipped: uygular.reduce((a, u) => a + u.servicesSkipped, 0),
        note: ilk ? ilk.note : '',
      });
    }
  }

  // ── 2) ROUTE'U OLMAYAN UYGULAMA SATIRLARI ───────────────────────────────────────
  // Eski route bazli ekranin kor noktasi: router'dan hic gecmeyen backend'ler.
  for (const u of olcumler.values()) {
    if (eslesenApp.has(L(u.namespace) + '|' + L(u.application))) continue;
    rows.push({
      kind: 'app',
      cluster: u.cluster,
      clusterSrc: u.cluster ? 'dynatrace' : null,
      namespace: u.namespace,
      route: null,
      address: null,
      application: u.application,
      apps: [u.application],
      appCount: 1,
      env: envOfNamespace(u.namespace),
      spa: isSpaApp(u.application),
      status: !u.measured ? 'unmeasured' : u.req > 0 ? 'active' : 'idle',
      reqShown: u.measured ? u.req : null,
      measured: u.measured,
      reqShared: false,
      windowDays: u.windowDays,
      scanDate: u.scanDate,
      services: u.services,
      servicesMeasured: u.servicesMeasured,
      servicesSkipped: u.servicesSkipped,
      note: u.note,
    });
  }

  rows.sort(
    (a, b) =>
      (b.reqShown || 0) - (a.reqShown || 0) ||
      String(a.namespace).localeCompare(String(b.namespace)) ||
      String(a.route || a.application || '').localeCompare(String(b.route || b.application || '')),
  );

  // SUZGEC SONRASI KIRPMA. Ozet ve ortam listesi HER ZAMAN TUM KUMEDEN hesaplanir:
  // kirpilmis bir listeden sayi uretmek, on binlerce satirlik bir kumeyi 1.000 sanmaya
  // yol acardi - bu ekranin isi tam olarak "kac route olculemiyor" sorusuna cevap vermek.
  const limit = Math.min(Math.max(Number(opt.limit) || LIMIT_DEFAULT, 1), LIMIT_MAX);
  const eslesen = suz(rows, opt);
  const kirpilmis = eslesen.slice(0, limit);
  const envs = [...new Set(rows.map((r) => r.env).filter(Boolean))].sort();

  const say = (f) => rows.filter(f).length;
  return {
    latestScan,
    rows: kirpilmis,
    envs,
    total: rows.length,
    totalMatched: eslesen.length,
    limit,
    truncated: eslesen.length > kirpilmis.length,
    summary: {
      routes: say((r) => r.kind === 'route'),
      // ESLESMEYEN ROUTE AYRI SAYILIR: "hepsini olctum" yanilgisi olusmasin.
      unmatched: say((r) => r.kind === 'route' && r.status === 'unmatched'),
      active: say((r) => r.status === 'active'),
      idle: say((r) => r.status === 'idle'),
      unmeasured: say((r) => r.status === 'unmeasured'),
      // ROUTE'SUZ UYGULAMALAR: route bazli ekranin goremedigi kume.
      routeless: say((r) => r.kind === 'app'),
      spa: say((r) => r.spa),
      apps: olcumler.size,
    },
  };
}

module.exports = {
  buildAppTraffic,
  tekillestir,
  routelariBul,
  uygulamalariBul,
  routeOlcumu,
  routeIndeksi,
  suz,
  LIMIT_DEFAULT,
  LIMIT_MAX,
};
