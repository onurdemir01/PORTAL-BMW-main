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
const { appFromAddress, SPA_RE } = require('./route-stats.cjs');

const SILENT_DAYS = 30;
const DEAD_DAYS = 90;
const DAY = 86400000;

const L = (s) => String(s || '').trim().toLowerCase();
const dayKey = (d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);

/**
 * @param {Array<{scan_date:any, window_hours:number, cluster:string, namespace:string, route:string,
 *   req_total:number, r2xx:number, r4xx:number, r5xx:number}>} trafficRows  son DEAD_DAYS gunun satirlari
 * @param {Array<{cluster_name:string, namespace_name:string, route_name:string, route_address:string}>} inventoryRows
 * @param {{now?: Date, silentDays?: number, deadDays?: number}} [opt]
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
      const e = inv.get(k) || { namespace: String(r.namespace_name).trim(), route: String(r.route_name).trim(), address: '', clusters: new Set() };
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
      namespace: String(r.namespace).trim(), route: String(r.route).trim(), clusters: new Set(),
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
    const spa = SPA_RE.test(address) || SPA_RE.test(route);
    let req7 = 0, req30 = 0, req90 = 0, r4xx = 0, r5xx = 0, hours90 = 0, lastSeen = null, lastScan = null;
    if (a) {
      for (const [day, d] of a.days) {
        const age = ageDays(day);
        if (age < 0) continue;
        if (!lastScan || day > lastScan) lastScan = day;
        if (age < 7) req7 += d.req;
        if (age < silentDays) req30 += d.req;
        if (age < deadDays) { req90 += d.req; r4xx += d.r4xx; r5xx += d.r5xx; hours90 += d.hours; }
        if (d.req > 0 && (!lastSeen || day > lastSeen)) lastSeen = day;
      }
    }
    let status;
    if (!a) status = 'nodata';
    else if (req30 > 0) status = 'active';
    else if (req90 > 0) status = 'silent';
    else status = 'dead';
    rows.push({
      namespace, route, address, app, spa,
      env: envOfNamespace(namespace),
      clusters: [...(a?.clusters || e?.clusters || [])].sort(),
      inInventory: !!e,
      req7, req30, req90,
      perDay: hours90 > 0 ? Math.round((req90 / hours90) * 24) : 0,
      err4xxPct: req90 > 0 ? Math.round((r4xx / req90) * 100) : 0,
      err5xxPct: req90 > 0 ? Math.round((r5xx / req90) * 100) : 0,
      lastSeen, lastScan, status,
    });
  }
  rows.sort((x, y) => (x.namespace + x.route).localeCompare(y.namespace + y.route));

  const summary = { routes: rows.length, active: 0, silent: 0, dead: 0, nodata: 0, spa: 0, spaDead: 0 };
  for (const r of rows) {
    summary[r.status] += 1;
    if (r.spa) { summary.spa += 1; if (r.status === 'dead' || r.status === 'silent') summary.spaDead += 1; }
  }
  return { rows, summary, latestScan, earliestScan, daysCovered, silentDays, deadDays };
}

module.exports = { buildRouteTraffic, SILENT_DAYS, DEAD_DAYS };
