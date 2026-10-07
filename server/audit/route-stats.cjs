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

// SPA kalibi TEK KAYNAKTAN (2026-09-28, kullanici: "bazi SPA uygulamalarinin standarta
// uymayan kalibi var, bence genisletelim"). Burada da ayni kural gecerli: eskiden bu
// dosyanin kendi kopyasi vardi ve Nginx SPA ekranindaki sayilar Tasima ekraniyla
// tutmuyordu. Gerekce: server/audit/spa-pattern.cjs.
const { SPA_RE, isSpaApp } = require('./spa-pattern.cjs');
const L = (s) =>
  String(s || '')
    .trim()
    .toLowerCase();

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
    // CLUSTER BASINA KIRILIM (kullanici, 2026-10-08): "GBOCP Prod 1'de bu kadar route
    // var, bunlarin su kadari SPA route'u, yuzdesi de budur." Ortam toplami tek basina
    // "hangi cluster'da eksik" sorusunu cevaplamiyordu; ARK'in prod'u dort cluster.
    //
    // `clusters` (isim kumesi) KORUNUR: ekranda ortam basina cluster SAYISI icin
    // kullaniliyor ve tipini degistirmek onyuzu sessizce bozardi.
    clusterStats: new Map(),
    namespaces: new Set(),
  });

  // Cluster kovasi - ortam kovasiyla AYNI alanlar, IP/termination kirilimi YOK
  // (ekranda cluster satiri yalnizca route/SPA/yuzde gosteriyor; IP dagilimi ortam
  // duzeyinde anlamli, cluster duzeyinde gurultu).
  const mkCluster = () => ({ routes: 0, spa: 0, nonSpa: 0, unclassified: 0 });
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
    const cn = String(r.cluster_name || '').trim();
    b.clusters.add(cn);
    // ADI BOS GELEN CLUSTER AYRI KOVADA. Sessizce atlamak, ortam toplami ile cluster
    // satirlarinin toplaminin TUTMAMASINA yol acardi ve kimse sebebini goremezdi.
    const ck = cn || '(cluster adi yok)';
    if (!b.clusterStats.has(ck)) b.clusterStats.set(ck, mkCluster());
    const cb = b.clusterStats.get(ck);
    cb.routes++;
    b.namespaces.add(ns);
    const tt = L(r.termination_type) || 'yok';
    b.terminations.set(tt, (b.terminations.get(tt) || 0) + 1);

    const app = appFromAddress(r.route_address, ns) || L(r.route_name) || null;
    if (!app) {
      b.unclassified++;
      cb.unclassified++;
      continue;
    }
    const kind = isSpaApp(app) ? 'spa' : 'nonSpa';
    b[kind]++;
    cb[kind]++;
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
      const ia = ORDER.indexOf(a[0]),
        ib = ORDER.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a[0].localeCompare(b[0]);
    })
    .map(([env, b]) => ({
      env,
      routes: b.routes,
      spa: b.spa,
      nonSpa: b.nonSpa,
      unclassified: b.unclassified,
      clusters: [...b.clusters].filter(Boolean).sort(),
      // SPA YUZDESI SINIFLANDIRILAMAYANI DA PAYDAYA KOYAR. `spa/(spa+nonSpa)` yazmak,
      // adresinden de adindan da cozulemeyen route'lari yok sayip yuzdeyi SISIRIRDI -
      // "olculemedi" ile "SPA degil" ayni sey degil. Payda route TOPLAMI.
      clusterRows: [...b.clusterStats.entries()]
        .map(([cluster, c]) => ({
          cluster,
          routes: c.routes,
          spa: c.spa,
          nonSpa: c.nonSpa,
          unclassified: c.unclassified,
          spaPct: c.routes ? Math.round((c.spa / c.routes) * 1000) / 10 : 0,
        }))
        .sort((x, y) => y.routes - x.routes || x.cluster.localeCompare(y.cluster)),
      namespaces: b.namespaces.size,
      terminations: [...b.terminations.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, c) => c.count - a.count),
      spaIps: [...b.ips.spa.values()]
        .map((x) => ({ ip: x.ip, count: x.count, samples: [...x.samples] }))
        .sort((a, c) => c.count - a.count),
      nonSpaIps: [...b.ips.nonSpa.values()]
        .map((x) => ({ ip: x.ip, count: x.count, samples: [...x.samples] }))
        .sort((a, c) => c.count - a.count),
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

/**
 * Bir IP'ye cozen route'lar (kullanici, 2026-09-17: "IP'ye tikladigimda hangi route'lar
 * cozuyor"). Ortam namespace ekinden; kind = spa | nonSpa | all.
 * @returns {{namespace:string, route:string, address:string, type:string, kind:'spa'|'nonSpa'|'unclassified', cluster:string}[]}
 */
function routesOfIp(routeRows, ip, env, kind = 'all') {
  const want = String(ip || '').trim();
  return routeListesi(routeRows, env, kind, (r) => String(r.resolved_ip || '').trim() === want);
}

/**
 * Bir CLUSTER'daki route'lar (kullanici, 2026-10-08: "cluster bazli route'larin SPA olup
 * olmadigini gosterdik ya, ustlerine tikladigimda SPA olmayan route'lari gormek istiyorum").
 *
 * `routesOfIp` ile AYNI govdeyi kullanir (`routeListesi`): SPA siniflandirmasi tek yerde
 * kalsin. Ikinci bir kopya, bu depoda tekrar tekrar yasanan sinifa girerdi - SPA kalibi
 * degisince biri guncellenir, oteki sessizce eski kalir (bkz. spa-pattern.cjs gerekcesi).
 *
 * @returns {{namespace:string, route:string, address:string, type:string, kind:'spa'|'nonSpa'|'unclassified', cluster:string}[]}
 */
function routesOfCluster(routeRows, cluster, env, kind = 'all') {
  const want = L(cluster);
  // ADI BOS GELEN CLUSTER da sorgulanabilir: ekrandaki '(cluster adi yok)' kovasina
  // tiklanabiliyor ve o satirin icerigi gorunmez kalmamali.
  return routeListesi(routeRows, env, kind, (r) =>
    want === '' ? L(r.cluster_name) === '' : L(r.cluster_name) === want,
  );
}

/** Ortak govde: ortam suzgeci + SPA siniflandirmasi + siralama. `sec` satir suzgeci. */
function routeListesi(routeRows, env, kind, sec) {
  const E = String(env || '')
    .trim()
    .toUpperCase();
  const out = [];
  for (const r of routeRows || []) {
    if (!sec(r)) continue;
    const ns = L(r.namespace_name);
    const e = envOfNamespace(ns);
    if (E && (!e || e.toUpperCase() !== E)) continue;
    const app = appFromAddress(r.route_address, ns) || L(r.route_name) || null;
    const k = !app ? 'unclassified' : isSpaApp(app) ? 'spa' : 'nonSpa';
    if (kind !== 'all' && k !== kind) continue;
    out.push({
      namespace: ns,
      route: String(r.route_name || '').trim(),
      address: String(r.route_address || '').trim(),
      type: L(r.termination_type) || 'yok',
      kind: k,
      cluster: String(r.cluster_name || '').trim(),
    });
  }
  return out.sort(
    (a, b) => a.namespace.localeCompare(b.namespace) || a.address.localeCompare(b.address),
  );
}

module.exports = { buildRouteStats, routesOfIp, routesOfCluster, appFromAddress, SPA_RE };
