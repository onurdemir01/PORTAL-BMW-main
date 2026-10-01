// server/nginx-console/spa-discovery.cjs — Nginx Hub > "Gerçek SPA Keşfi" (2026-10-01).
//
// Kullanici: "Nginx Hub icerisinde gercekten SPA olan tum uygulamalarin cekilmesi, bu
// uygulamalara nazaran route envanterinin karsilastirilmasi ve route'larinin yazilmasi,
// ayni zamanda uygulama trafiginin de yanlarina islenmesi."
//
// UC KAYNAK, UC AYRI SORU:
//   dbo.BMW_Spa_Discovery          -> route'un ardindaki kabinde GERCEKTEN nginx var mi
//   dbo.BMW_Openshift_Route_Inventory -> bu route envanterde kayitli mi
//   dbo.BMW_Application_Usage      -> uygulama istek aliyor mu (Dynatrace)
//
// EKRANIN ASIL ISI: ad kalibina (`-app-v` / `-app-emb-v`) UYMAYAN ama gercekten SPA olan
// uygulamalari gostermek. Kullanici bu sayfayi tam da onun icin istedi; o yuzden
// `patternMiss` hem satirda hem ozette ayri durur.
'use strict';

const { isSpaApp } = require('../audit/spa-pattern.cjs');
const { envOfNamespace } = require('../audit/ocp-platforms.cjs');

const L = (s) =>
  String(s == null ? '' : s)
    .trim()
    .toLowerCase();
const T = (s) => String(s == null ? '' : s).trim();

/**
 * Keşif satırından UYGULAMA adını türetir.
 *
 * Is yukunun adi (DeploymentConfig/Deployment) uygulamanin adidir; yoksa route adina
 * dusulur. Dynatrace olcumu de uygulama adiyla tutuluyor, eslesme bunun uzerinden kurulur.
 */
const uygulamaAdi = (r) => T(r.workload) || T(r.route);

/**
 * @param {object[]} discovery  dbo.BMW_Spa_Discovery (EN YENI tarama)
 * @param {object[]} inventory  dbo.BMW_Openshift_Route_Inventory
 * @param {object[]} usage      dbo.BMW_Application_Usage (uygulama basina EN YENI satir)
 */
function buildSpaDiscovery(discovery, inventory, usage) {
  // ENVANTER INDEKSI: (namespace, route) ve (namespace, adres) ayri ayri aranir - kesif
  // route ADINI, envanter bazen yalniz ADRESI tasiyor.
  const envRoute = new Set();
  const envAdres = new Set();
  for (const r of inventory || []) {
    const ns = L(r.namespace_name);
    if (!ns) continue;
    if (r.route_name) envRoute.add(`${ns}|${L(r.route_name)}`);
    if (r.route_address) envAdres.add(`${ns}|${L(r.route_address)}`);
  }

  // OLCUM INDEKSI: (namespace, uygulama) -> en yeni kullanim satiri.
  const olcum = new Map();
  for (const u of usage || []) {
    const k = `${L(u.namespace)}|${L(u.app)}`;
    const gun = u.scan_date ? new Date(u.scan_date).toISOString().slice(0, 10) : '';
    const onceki = olcum.get(k);
    if (onceki && onceki.scanDate >= gun) continue;
    olcum.set(k, {
      scanDate: gun,
      windowDays: Number(u.window_days) || 0,
      req: Number(u.req_total) || 0,
      measured: u.measured === true || Number(u.measured) === 1,
      services: Number(u.services_total) || 0,
      note: T(u.note),
    });
  }

  const rows = (discovery || []).map((d) => {
    const ns = T(d.namespace);
    const app = uygulamaAdi(d);
    const u = olcum.get(`${L(ns)}|${L(app)}`) || null;
    const envVar =
      envRoute.has(`${L(ns)}|${L(d.route)}`) || envAdres.has(`${L(ns)}|${L(d.host)}`);
    const spa = Number(d.is_spa) === 1;
    const kalip = isSpaApp(app);
    return {
      cluster: T(d.cluster),
      namespace: ns,
      route: T(d.route),
      host: T(d.host),
      termination: T(d.termination),
      workloadKind: T(d.workload_kind),
      workload: T(d.workload),
      application: app,
      env: envOfNamespace(ns),
      isSpa: spa,
      signal: T(d.signal),
      image: T(d.image),
      note: T(d.note),
      // ENVANTER KARSILASTIRMASI: route envanterde kayitli mi.
      inInventory: envVar,
      // AD KALIBI: eski yontem bu uygulamayi SPA sayar miydi?
      patternMatch: kalip,
      // ASIL BULGU: gercekten SPA ama ad kalibina UYMUYOR - eski yontemin kacirdigi.
      patternMiss: spa && !kalip,
      // YANLIS POZITIF: ad kalibina uyuyor ama kabinde nginx YOK.
      patternFalse: !spa && kalip,
      // OLCUM: "olculemedi" ile "istek yok" AYRI; sayi yalniz olculduyse anlamli.
      usage: u,
      reqShown: u && u.measured ? u.req : null,
    };
  });

  rows.sort(
    (a, b) =>
      Number(b.patternMiss) - Number(a.patternMiss) ||
      a.namespace.localeCompare(b.namespace) ||
      a.application.localeCompare(b.application),
  );

  const say = (f) => rows.filter(f).length;
  const spaSatir = rows.filter((r) => r.isSpa);
  return {
    rows,
    clusters: [...new Set(rows.map((r) => r.cluster).filter(Boolean))].sort(),
    envs: [...new Set(rows.map((r) => r.env).filter(Boolean))].sort(),
    summary: {
      routes: rows.length,
      spa: spaSatir.length,
      notSpa: say((r) => !r.isSpa && !r.note),
      // EKRANIN SEBEBI: ad kalibinin kacirdiklari.
      patternMiss: say((r) => r.patternMiss),
      patternFalse: say((r) => r.patternFalse),
      // ENVANTER FARKI: gercekten SPA ama route envanterinde YOK.
      spaNotInInventory: spaSatir.filter((r) => !r.inInventory).length,
      // SINYAL KIRILIMI: iki sinyal ayri sayilir, biri otekinden zayiftir.
      bySignal: spaSatir.reduce((m, r) => {
        const k = r.signal || 'bilinmiyor';
        m[k] = (m[k] || 0) + 1;
        return m;
      }, {}),
      // OLCUM: kac SPA'nin trafigi var. "olculemedi" AYRI sayilir.
      trafficActive: spaSatir.filter((r) => r.reqShown != null && r.reqShown > 0).length,
      trafficIdle: spaSatir.filter((r) => r.reqShown === 0).length,
      trafficUnmeasured: spaSatir.filter((r) => r.usage && !r.usage.measured).length,
      trafficNone: spaSatir.filter((r) => !r.usage).length,
      // ESLESMEYEN KESIF SATIRLARI: sebebi `note`ta yazan satirlar.
      unmatched: say((r) => !!r.note),
    },
  };
}

module.exports = { buildSpaDiscovery, uygulamaAdi };
