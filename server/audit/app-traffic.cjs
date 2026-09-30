// server/audit/app-traffic.cjs — Denetim > Route Trafigi: UYGULAMA bazli kullanim.
//
// KULLANICI KARARI (2026-09-30): "Prometheus'tan cektigimiz metrikler calismiyor. Orayi
// bos ver. Biz sadece application usage playbook'unu kullanalim ve Dynatrace metriklerine
// bakalim. Hata oranlarini bos ver."
//
// BIRIM DEGISTI: ekran ROUTE bazliydi, artik UYGULAMA bazli.
//
// Sebep olculdu: envanterde 15.594 route, Dynatrace'te 70.059 uygulama var ve ikisi
// birebir ortusmuyor (route `apigw` ↔ uygulamalar `apigw-1-prod`, `-2-prod`, `-3-prod`).
// Route bazli kalsaydi, durumu Dynatrace'ten turetince satirlarin %97'si "eslesmedi"
// gorunecekti - 1.020 prod route'un yalniz 29'u eslesiyordu. Dynatrace'in birimi
// uygulamadir; satiri onun birimine cevirince her satirin verisi TANIM GEREGI dolu olur.
//
// KAZANC: route'u OLMAYAN uygulamalar da gorunur. Eski ekranin en buyuk kor noktasi
// buydu - servisten servise cagrilan bir backend router'dan hic gecmez, route bazli
// listede "sifir istek" gorunurdu.
//
// KALDIRILAN: gun bazli gecmis (son 7/30/90 gun), gunluk ortalama ve 4xx/5xx oranlari.
// Hepsi Prometheus/Thanos olcumunden geliyordu; Dynatrace bu kirilimi vermiyor ve
// kullanici "hata oranlarini bos ver" dedi. Var olmayan bir kolonu bos gostermek yerine
// kaldirildi.
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
 * INDEKS BIR KEZ KURULUR: uygulama basina tum envanteri taramak, 70.000 x 15.000
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
      // Eslesme icin: route adi ve adresin ilk etiketi.
      adaylar: [L(r.route_name), etiket(r.route_address)].filter(Boolean),
    });
  }
  return byNs;
}

/**
 * Uygulamaya ait route'lar.
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
    if (tam || onek) bulunan.push({ route: r.route, address: r.address, exact: tam });
  }
  return bulunan;
}

/** Varsayilan satir tavani. Bkz. buildAppTraffic'teki OLCUM notu. */
const LIMIT_DEFAULT = 1000;
/** CSV icin acik istek uzerine cikilabilecek tavan. */
const LIMIT_MAX = 100000;

/**
 * Suzgecler SUNUCUDA uygulanir.
 *
 * NEDEN SUNUCUDA (2026-09-30, kullanici: "sayfa dondu ve hicbir sey yuklenmiyor"):
 * ekran once tum kumeyi indirip tarayicida suzuyordu. Olculdu: 70.059 uygulama =
 * 20,9 MB JSON ve 70.059 x 8 hucre DOM. Yanit 8 MB'lik onbellek tavanini da astigi
 * icin her acilis bastan hesaplaniyordu. Suzgeci sunucuya almak govdeyi birkac yuz
 * KB'ye indirir ve yaniti yeniden onbelleklenebilir kilar (anahtar sorgu dizesini
 * icerir, bkz. response-cache.cjs).
 */
function suz(rows, { q = '', env = '', status = '', kind = '', routes = '' } = {}) {
  const needle = L(q);
  const e = L(env);
  return rows.filter((r) => {
    if (e && e !== 'all' && L(r.env || '') !== e) return false;
    if (kind === 'spa' && !r.spa) return false;
    if (kind === 'nonspa' && r.spa) return false;
    if (status && status !== 'all' && r.status !== status) return false;
    if (routes === 'with' && !r.routes.length) return false;
    if (routes === 'without' && r.routes.length) return false;
    if (
      needle &&
      !(
        L(r.namespace).includes(needle) ||
        L(r.application).includes(needle) ||
        r.routes.some((x) => L(x.route).includes(needle) || L(x.address).includes(needle))
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

  const rows = [];
  let latestScan = null;
  for (const u of olcumler.values()) {
    if (!latestScan || u.scanDate > latestScan) latestScan = u.scanDate;
    const routes = routelariBul(u.application, nsIndeks.get(L(u.namespace)));
    rows.push({
      ...u,
      env: envOfNamespace(u.namespace),
      spa: isSpaApp(u.application),
      routes,
      // UC DURUM, IKI DEGIL: "olculemedi" ile "istek yok" ayni sey degildir. Bir
      // uygulamayi olcemedigimiz icin emekli adayi saymak, en pahali hatadir.
      status: !u.measured ? 'unmeasured' : u.req > 0 ? 'active' : 'idle',
      // Sayi YALNIZ olculduyse anlamlidir.
      reqShown: u.measured ? u.req : null,
    });
  }

  rows.sort(
    (a, b) =>
      (b.reqShown || 0) - (a.reqShown || 0) ||
      a.namespace.localeCompare(b.namespace) ||
      a.application.localeCompare(b.application),
  );

  // SUZGEC SONRASI KIRPMA. Ozet ve ortam listesi HER ZAMAN TUM KUMEDEN hesaplanir:
  // kirpilmis bir listeden sayi uretmek, 70.059 uygulamalik bir kumeyi 1.000 sanmaya
  // yol acardi - bu ekranin isi tam olarak "kac uygulama atil" sorusuna cevap vermek.
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
      apps: rows.length,
      active: say((r) => r.status === 'active'),
      idle: say((r) => r.status === 'idle'),
      unmeasured: say((r) => r.status === 'unmeasured'),
      // ROUTE'SUZ UYGULAMALAR: eski route bazli ekranin hic goremedigi kume.
      routeless: say((r) => !r.routes.length),
      spa: say((r) => r.spa),
      // Envanterde olup OLCUMU OLMAYAN route'lar ayrica sayilir: "hepsini gordum"
      // yanilgisi olusmasin.
      routesWithoutUsage: (() => {
        const eslesen = new Set();
        for (const r of rows) for (const x of r.routes) eslesen.add(L(r.namespace) + '|' + L(x.route));
        let n = 0;
        for (const [ns, liste] of nsIndeks) {
          for (const r of liste) if (!eslesen.has(ns + '|' + L(r.route))) n += 1;
        }
        return n;
      })(),
    },
  };
}

module.exports = {
  buildAppTraffic,
  tekillestir,
  routelariBul,
  routeIndeksi,
  suz,
  LIMIT_DEFAULT,
  LIMIT_MAX,
};
