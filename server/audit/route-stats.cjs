// server/audit/route-stats.cjs - OpenShift route istatistikleri (Denetim > Nginx SPA).
//
// Kullanici (2026-09-14): "dev/test/qa/prod icin kac route var, kaci SPA, kaci degil;
// SPA'lar hangi IP'lere cozuyor, SPA olmayanlar hangi IP'lere".
//
// KAYNAK: dbo.BMW_Openshift_Route_Inventory (route_inventory job'i: cluster, namespace,
// route, adres, nslookup ile cozulen IP, termination). Ortam NAMESPACE son ekinden
// (-dev/-test/-qa/-prod; ocp-platforms.envOfNamespace), cluster'dan DEGIL.
//
// SPA MI: uygulama adi route ADRESINDEN cozulur (<app>-<ns>.apps...; namespace bilindigi
// icin kesin), adres kaliba uymuyorsa route ADI kullanilir. "-app-v / -app-emb-v"
// kalibi = SPA (Denetim'deki tanimla ayni). Ne adresten ne addan cozulemeyen route
// "siniflandirilamadi" olarak AYRI sayilir.
//
// IP: resolved_ip bos ise "cozulmedi" kovasi (nslookup basarisiz / zaman asimi).
'use strict';

const { envOfNamespace } = require('./ocp-platforms.cjs');

const SPA_RE = /-app(-emb)?-v/i;
const L = (s) => String(s || '').trim().toLowerCase();

/** Route adresinden uygulama adi: "<app>-<ns>.apps..." -> app (ns biliniyor). */
function appFromAddress(addr, nsLower) {
  const label = L(addr).split('.')[0];
  if (!label || !nsLower) return null;
  const suf = '-' + nsLower;
  return label.endsWith(suf) && label.length > suf.length ? label.slice(0, -suf.length) : null;
}

/**
 * @param routeRows  [{namespace_name, route_name, route_address, resolved_ip, termination_type, cluster_name}]
 * @returns {{envs: Array, totals: Object}}
 */
function buildRouteStats(routeRows) {
  const byEnv = new Map();
  const mk = () => ({
    routes: 0,
    spa: 0,
    nonSpa: 0,
    unclassified: 0,
    terminations: new Map(),
    // kind -> ip -> {count, routes:Set(ns/app)}
    ips: { spa: new Map(), nonSpa: new Map() },
    unresolvedIp: { spa: 0, nonSpa: 0 },
    clusters: new Set(),
    namespaces: new Set(),
  });
  let noEnv = 0;

  for (const r of routeRows || []) {
    const ns = L(r.namespace_name);
    const env = envOfNamespace(ns);
    if (!env) {
      noEnv++;
      continue;
    }
    const E = env.toUpperCase();
    if (!byEnv.has(E)) byEnv.set(E, mk());
    const b = byEnv.get(E);
    b.routes++;
    b.clusters.add(String(r.cluster_name || '').trim());
    b.namespaces.add(ns);
    const tt = L(r.termination_type) || 'yok';
    b.terminations.set(tt, (b.terminations.get(tt) || 0) + 1);

    const app = appFromAddress(r.route_address, ns) || L(r.route_name) || null;
    if (!app) {
      b.unclassified++;
      continue;
    }
    const kind = SPA_RE.test(app) ? 'spa' : 'nonSpa';
    b[kind]++;
    const ip = String(r.resolved_ip || '').trim();
    if (!ip) {
      b.unresolvedIp[kind]++;
      continue;
    }
    const m = b.ips[kind];
    if (!m.has(ip)) m.set(ip, { ip, count: 0, samples: new Set() });
    const e = m.get(ip);
    e.count++;
    if (e.samples.size < 5) e.samples.add(ns + '/' + app);
  }

  const ORDER = ['DEV', 'TEST', 'QA', 'EDU', 'PROD'];
  const envs = [...byEnv.entries()]
    .sort((a, b) => {
      const ia = ORDER.indexOf(a[0]), ib = ORDER.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a[0].localeCompare(b[0]);
    })
    .map(([env, b]) => ({
      env,
      routes: b.routes,
      spa: b.spa,
      nonSpa: b.nonSpa,
      unclassified: b.unclassified,
      clusters: [...b.clusters].filter(Boolean).sort(),
      namespaces: b.namespaces.size,
      terminations: [...b.terminations.entries()].map(([type, count]) => ({ type, count })).sort((a, c) => c.count - a.count),
      spaIps: [...b.ips.spa.values()].map((x) => ({ ip: x.ip, count: x.count, samples: [...x.samples] })).sort((a, c) => c.count - a.count),
      nonSpaIps: [...b.ips.nonSpa.values()].map((x) => ({ ip: x.ip, count: x.count, samples: [...x.samples] })).sort((a, c) => c.count - a.count),
      unresolvedIp: { ...b.unresolvedIp },
    }));

  const sum = (f) => envs.reduce((a, e) => a + f(e), 0);
  return {
    envs,
    totals: {
      routes: sum((e) => e.routes),
      spa: sum((e) => e.spa),
      nonSpa: sum((e) => e.nonSpa),
      unclassified: sum((e) => e.unclassified),
      noEnv,
    },
  };
}

module.exports = { buildRouteStats, appFromAddress, SPA_RE };
