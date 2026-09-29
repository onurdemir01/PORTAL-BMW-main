// server/audit/route-traffic.cjs - OpenShift route trafigi (Denetim > Route Trafigi).
//
// Kullanici (2026-09-21): "SPA uygulamalari var ama kullaniliyor mu? atil mi, emekli mi?
// ... intranet uygulamalarin yasayip yasamadigini ancak route metrikleriyle anlariz."
//
// KAYNAK: dbo.BMW_Openshift_Route_Traffic (route_traffic job'i: gun basina, cluster/namespace/
// route, req_total + kod siniflari; window_hours = sayimin penceresi). Route envanteri
// (BMW_Openshift_Route_Inventory) ile birlestirilir ki trafik satiri HIC olmayan route'lar
// da listede "veri yok" olarak gorunsun (metrik seri acmamis = router hic gormemis).
//
// SINIFLAMA (route basina, gun toplamlarindan):
//   active    : son SILENT_DAYS gunde istek var
//   silent    : SILENT_DAYS gundur istek yok ama DEAD_DAYS icinde vardi  -> "atil aday"
//   dead      : DEAD_DAYS (ya da verinin tamami) boyunca hic istek yok   -> "emekli aday"
//   nodata    : trafik tablosunda satiri yok (envanterde var)
// Veri henuz DEAD_DAYS'i kapsamiyorsa (job yeni), "dead" hukmu verinin kapsadigi gun
// sayisiyla birlikte sunulur (daysCovered) - kullanici bunu goz onunde tutar.
//
// SAYILAR pencereye bolunmez: gunluk kosuda window 24h; ilk kosu 14d ile alinirsa o gun
// 14 gunun toplamini tasir - "son 30 gun" toplaminda dogru yerde durur (pencere gunleri
// zaten o 30 gunun icinde). Yalnizca "gunluk ortalama" window_hours'a gore hesaplanir.
'use strict';

const { envOfNamespace } = require('./ocp-platforms.cjs');
const { appFromAddress } = require('./route-stats.cjs');
const { isSpaLabel } = require('./spa-pattern.cjs');

const SILENT_DAYS = 30;
const DEAD_DAYS = 90;
const DAY = 86400000;

const L = (s) =>
  String(s || '')
    .trim()
    .toLowerCase();
const dayKey = (d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);

/**
 * Dynatrace SERVIS olcumu (dbo.BMW_Application_Usage) -> (namespace|app) haritasi.
 *
 * NEDEN EN YENI SATIR, TOPLAM DEGIL: her satir zaten `window_days` gunluk bir PENCEREYI
 * tasiyor (varsayilan 35). Gunleri toplamak ayni istekleri defalarca saymak olurdu.
 *
 * OLCULEMEYEN SATIR 0 SAYILMAZ: measured=0 ise sayi degil, "olculemedi" bilgisi tasinir.
 * Ornek kodda dusen metrik sorgusu 0 istek gibi gorunuyordu; emeklilik kararinda calisan
 * bir uygulamayi "kullanilmiyor" diye okutan tam olarak buydu.
 */
function buildUsageMap(usageRows) {
  const m = new Map();
  for (const r of usageRows || []) {
    const ns = L(r.namespace);
    const app = L(r.app);
    if (!ns || !app || !r.scan_date) continue;
    const day = dayKey(r.scan_date);
    const k = ns + '|' + app;
    const onceki = m.get(k);
    if (onceki && onceki.scanDate >= day) continue;
    m.set(k, {
      scanDate: day,
      windowDays: Number(r.window_days) || 0,
      req: Number(r.req_total) || 0,
      measured: r.measured === true || Number(r.measured) === 1,
      services: Number(r.services_total) || 0,
      servicesMeasured: Number(r.services_measured) || 0,
      servicesSkipped: Number(r.services_skipped) || 0,
      note: String(r.note || '').trim(),
      cluster: String(r.cluster || '').trim(),
    });
  }
  return m;
}

/**
 * @param {Array<{scan_date:any, window_hours:number, cluster:string, namespace:string, route:string,
 *   req_total:number, r2xx:number, r4xx:number, r5xx:number}>} trafficRows  son DEAD_DAYS gunun satirlari
 * @param {Array<{cluster_name:string, namespace_name:string, route_name:string, route_address:string}>} inventoryRows
 * @param {{now?: Date, silentDays?: number, deadDays?: number, usageRows?: Array<object>}} [opt]
 */
function buildRouteTraffic(trafficRows, inventoryRows, opt = {}) {
  const now = opt.now || new Date();
  const silentDays = opt.silentDays || SILENT_DAYS;
  const deadDays = opt.deadDays || DEAD_DAYS;
  const todayKey = dayKey(now);
  const ageDays = (key) => Math.floor((Date.parse(todayKey) - Date.parse(key)) / DAY);

  // envanter: (namespace, route) -> adres, cluster(lar)
  const inv = new Map();
  for (const r of inventoryRows || []) {
    const k = L(r.namespace_name) + '|' + L(r.route_name);
    if (!k.startsWith('|') && !k.endsWith('|')) {
      const e = inv.get(k) || {
        namespace: String(r.namespace_name).trim(),
        route: String(r.route_name).trim(),
        address: '',
        clusters: new Set(),
      };
      if (r.route_address && !e.address) e.address = String(r.route_address).trim();
      if (r.cluster_name) e.clusters.add(String(r.cluster_name).trim());
      inv.set(k, e);
    }
  }

  // trafik: (namespace, route) -> gun bazli toplamlar (cluster'lar toplanir: ayni route iki
  // cluster'da da olabilir - DR/ikinci lokasyon; soru "hic istek var mi", cluster degil)
  const agg = new Map();
  const scanDays = new Set();
  let latestScan = null;
  let earliestScan = null;
  for (const r of trafficRows || []) {
    const ns = L(r.namespace);
    const route = L(r.route);
    if (!ns || !route || !r.scan_date) continue;
    const key = ns + '|' + route;
    const day = dayKey(r.scan_date);
    scanDays.add(day);
    if (!latestScan || day > latestScan) latestScan = day;
    if (!earliestScan || day < earliestScan) earliestScan = day;
    const a = agg.get(key) || {
      namespace: String(r.namespace).trim(),
      route: String(r.route).trim(),
      clusters: new Set(),
      days: new Map(), // day -> {req, r2xx, r4xx, r5xx, hours}
    };
    if (r.cluster) a.clusters.add(String(r.cluster).trim());
    const d = a.days.get(day) || { req: 0, r2xx: 0, r4xx: 0, r5xx: 0, hours: 0 };
    d.req += Number(r.req_total) || 0;
    d.r2xx += Number(r.r2xx) || 0;
    d.r4xx += Number(r.r4xx) || 0;
    d.r5xx += Number(r.r5xx) || 0;
    d.hours = Math.max(d.hours, Number(r.window_hours) || 24);
    a.days.set(day, d);
    agg.set(key, a);
  }
  const daysCovered = scanDays.size;

  // DYNATRACE SERVIS OLCUMU (istege bagli): tablo yoksa ya da job hic kosmadiysa harita
  // BOS kalir ve satirlar "olcum yok" gorunur - route sonuclari bundan ETKILENMEZ.
  const usage = buildUsageMap(opt.usageRows);
  const usageEslesen = new Set();
  // NAMESPACE INDEKSI BIR KEZ KURULUR (2026-09-29, uretimde olculdu).
  //
  // Onek eslesmesi ilk yazildiginda her route icin `[...usage.entries()]` cagriliyordu:
  // 70.000 elemanli dizi, her route icin her aday icin YENIDEN. 5.000 route'luk bir
  // olcumde ekran 43,5 saniyede aciliyordu, gercek envanterde DAKIKALAR - kullanici
  // "Route Trafigi 10 dakikadir acilmadi" dedi.
  //
  // Onek aramasi zaten YALNIZ AYNI NAMESPACE icinde anlamli; namespace basina kucuk bir
  // liste tutmak hem dogru hem de ucuz.
  const usageByNs = new Map();
  for (const [anahtar, u] of usage) {
    const i = anahtar.indexOf('|');
    if (i < 0) continue;
    const ns = anahtar.slice(0, i);
    if (!usageByNs.has(ns)) usageByNs.set(ns, []);
    usageByNs.get(ns).push([anahtar.slice(i + 1), u]);
  }

  const rows = [];
  const keys = new Set([...agg.keys(), ...inv.keys()]);
  for (const key of keys) {
    const a = agg.get(key);
    const e = inv.get(key);
    const [nsLower, routeLower] = key.split('|');
    const namespace = a ? a.namespace : e ? e.namespace : nsLower;
    const route = a ? a.route : e ? e.route : routeLower;
    const address = e?.address || '';
    const app = appFromAddress(address, nsLower) || route;
    // Burada elde UYGULAMA ADI degil route adresi/adi var: "<app>-<ns>" kalibinda surum
    // eki ORTADA kalabilir, o yuzden isSpaApp degil isSpaLabel (bkz. spa-pattern.cjs).
    const spa = isSpaLabel(address) || isSpaLabel(route);
    let req7 = 0,
      req30 = 0,
      req90 = 0,
      r4xx = 0,
      r5xx = 0,
      hours90 = 0,
      lastSeen = null,
      lastScan = null;
    if (a) {
      for (const [day, d] of a.days) {
        const age = ageDays(day);
        if (age < 0) continue;
        if (!lastScan || day > lastScan) lastScan = day;
        if (age < 7) req7 += d.req;
        if (age < silentDays) req30 += d.req;
        if (age < deadDays) {
          req90 += d.req;
          r4xx += d.r4xx;
          r5xx += d.r5xx;
          hours90 += d.hours;
        }
        if (d.req > 0 && (!lastSeen || day > lastSeen)) lastSeen = day;
      }
    }
    let status;
    if (!a) status = 'nodata';
    else if (req30 > 0) status = 'active';
    else if (req90 > 0) status = 'silent';
    else status = 'dead';
    rows.push({
      namespace,
      route,
      address,
      app,
      spa,
      env: envOfNamespace(namespace),
      clusters: [...(a?.clusters || e?.clusters || [])].sort(),
      inInventory: !!e,
      req7,
      req30,
      req90,
      perDay: hours90 > 0 ? Math.round((req90 / hours90) * 24) : 0,
      err4xxPct: req90 > 0 ? Math.round((r4xx / req90) * 100) : 0,
      err5xxPct: req90 > 0 ? Math.round((r5xx / req90) * 100) : 0,
      lastSeen,
      lastScan,
      status,
      // SERVIS OLCUMU: route trafigi ROUTER'dan gecen istekleri sayar; bu ise uygulamanin
      // aldigi TUM servis cagrilarini. Eslesme (namespace + uygulama adi) tutmazsa `null`
      // doner - "0 istek" DEMEK DEGIL, "bu uygulama icin olcum bulunamadi" demek.
      usage: (() => {
        // ESLESME TEK ISIMLE GUVENILIR DEGIL: Dynatrace uygulama adi (deployment adi) ile
        // route adi cogu zaman ayni degil. Birkac aday denenir; hicbiri tutmazsa null
        // doner ve ekran "eslesmedi" der - "0 istek" DEMEZ. Eslesmeyen olcumlerin sayisi
        // ozette ayrica bildirilir ki "hepsini gordum" yanilgisi olusmasin.
        const adaylar = [L(app), routeLower, L(String(address).split('.')[0])];
        let k = null;
        for (const c of adaylar) {
          if (c && usage.has(nsLower + '|' + c)) {
            k = nsLower + '|' + c;
            break;
          }
        }
        if (k) {
          const u = usage.get(k);
          usageEslesen.add(k);
          return {
            req: u.measured ? u.req : null,
            measured: u.measured,
            windowDays: u.windowDays,
            scanDate: u.scanDate,
            services: u.services,
            servicesSkipped: u.servicesSkipped,
            note: u.note,
          };
        }

        // ── SON CARE: AYNI ONEKI TASIYAN UYGULAMALAR ─────────────────────────────
        // Uretimde olculdu (2026-09-29): route `apigw.apps.fw.garanti.com.tr`, namespace
        // `middleware-architecture-prod`. Dynatrace ayni namespace'te `apigw-1-prod`,
        // `apigw-2-prod`, `apigw-3-prod` diyor - ucu de ~9,63 milyar istek, yani AYNI
        // gecidin uc ornegi. Tam ad eslesmesi tutmuyordu ve EN COK ISTEK ALAN satirlar
        // bos kaliyordu.
        //
        // SINIR TIRE ILE: "apigw" -> "apigw-1-prod" EVET, "apigwhc" HAYIR. Tiresiz onek
        // eslesmesi "api" ile "apigw"yi de birlestirirdi.
        //
        // TOPLAM SESSIZCE VERILMEZ: hangi uygulamalarin toplandigi satirda tasinir ve
        // ekran bunu gosterir. Uc gecit ornegini toplamak dogru, ama "apigw-4" gibi ayri
        // bir uygulamayi da katmis olabiliriz - karar veren kisi NEYIN toplandigini
        // gormeden buna guvenmemeli.
        // HER ADAY denenir, yalnizca ilki DEGIL: route adi cogu zaman tam adresin
        // kendisidir ("apigw.apps.fw.garanti.com.tr") ve onek olarak ise yaramaz;
        // isimize yarayan aday adresin ILK ETIKETIDIR ("apigw").
        const nsListe = usageByNs.get(nsLower);
        if (!nsListe || !nsListe.length) return null;
        let esles = [];
        for (const c of adaylar) {
          if (!c) continue;
          const bas = c + '-';
          esles = nsListe.filter(([app2]) => app2.startsWith(bas));
          if (esles.length) break;
        }
        if (!esles.length) return null;
        const olculen = esles.filter(([, u]) => u.measured);
        // esles artik NAMESPACE ICI liste: anahtar yalniz uygulama adi, ns basa eklenir.
        for (const [app2] of esles) usageEslesen.add(nsLower + '|' + app2);
        const ilk = olculen[0] ? olculen[0][1] : esles[0][1];
        return {
          // Yalniz OLCULEN uygulamalarin toplami; olculemeyen bir uygulamayi 0 sayip
          // toplama katmak, eksik olcumu tam gibi gosterirdi.
          req: olculen.length ? olculen.reduce((t, [, u]) => t + (Number(u.req) || 0), 0) : null,
          measured: olculen.length > 0,
          windowDays: ilk.windowDays,
          scanDate: ilk.scanDate,
          services: esles.reduce((t, [, u]) => t + (Number(u.services) || 0), 0),
          servicesSkipped: esles.reduce((t, [, u]) => t + (Number(u.servicesSkipped) || 0), 0),
          note: ilk.note,
          // TOPLAMIN ICERIGI: ekranda gosterilir, tahmin degil kanit olsun diye.
          aggregated: esles.map(([app2]) => app2).sort(),
          unmeasured: esles.length - olculen.length,
        };
      })(),
    });
  }
  rows.sort((x, y) => (x.namespace + x.route).localeCompare(y.namespace + y.route));

  const summary = {
    routes: rows.length,
    active: 0,
    silent: 0,
    dead: 0,
    nodata: 0,
    spa: 0,
    spaDead: 0,
  };
  for (const r of rows) {
    summary[r.status] += 1;
    if (r.spa) {
      summary.spa += 1;
      if (r.status === 'dead' || r.status === 'silent') summary.spaDead += 1;
    }
  }

  // ROUTE'U OLMAYAN UYGULAMALAR: Dynatrace'te olculmus ama bu listede KARSILIGI OLMAYAN
  // uygulamalar. Route trafiginin kor noktasi tam olarak burasi - sayiyi gostermezsek
  // "hepsini gordum" yanilgisi olusur.
  const usageRowsCount = usage.size;
  const usageRoutesuz = [...usage.keys()].filter((k) => !usageEslesen.has(k)).length;

  return {
    rows,
    summary,
    latestScan,
    earliestScan,
    daysCovered,
    silentDays,
    deadDays,
    usage: {
      olculenUygulama: usageRowsCount,
      eslesen: usageEslesen.size,
      routesuz: usageRoutesuz,
      olculemeyen: [...usage.values()].filter((u) => !u.measured).length,
    },
  };
}

module.exports = { buildRouteTraffic, buildUsageMap, SILENT_DAYS, DEAD_DAYS };
