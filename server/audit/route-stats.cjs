// server/audit/route-stats.cjs - OpenShift route istatistikleri (Denetim > Nginx SPA).
//
// Kullanici (2026-09-14): "dev/test/qa/prod icin kac route var, kaci SPA, kaci degil;
// SPA'lar hangi IP'lere cozuyor, SPA olmayanlar hangi IP'lere".
//
// KAYNAK: dbo.BMW_Openshift_Route_Inventory (route_inventory job'i: cluster, namespace,
// route, adres, nslookup ile cozulen IP, termination). Ortam NAMESPACE son ekinden
// (-dev/-test/-qa/-prod; ocp-platforms.envOfNamespace), cluster'dan DEGIL.
//
// SPA MI: CANLI SINYAL (2026-10-08). Kullanici: "Kapsam'da SPA olan ama SPA standartina
// uymayan route'lari 'SPA degil' olarak goruyorum - uygulamanin icine giremedigin icin mi
// tagleyemedin?" Hayir: bu ekran o gune kadar canli sinyale HIC bakmiyordu, ADA bakiyordu
// (isSpaApp, '-app-v / -app-emb-v' kalibi). Oysa spa_discovery job'i 1 Ekim'den beri is
// yukunun kabininde nginx kosup kosmadigini olcup dbo.BMW_Spa_Discovery'ye yaziyor; o
// sinyal yalnizca "Gercek SPA Kesfi" sekmesini besliyordu. Iki sekme birlesince ayni
// ekranda iki farkli olcute gore iki farkli cevap yan yana durdu.
//
// Artik birincil olcut CANLI SINYAL, ad kalibi IKINCIL eksen olarak KORUNUR (byName):
//   - nameMismatch      : nginx kosuyor ama ad standarda UYMUYOR  <- kullanicinin aradigi
//   - nameFalsePositive : ad SPA diyor ama kabinde nginx YOK
// Ad kalibi silinmedi cunku Production Tasimalari ekraninda DOGRU olcut odur (oradaki soru
// "standarda uyuyor mu"); tek kaynak server/audit/spa-pattern.cjs olarak kaliyor.
//
// UC KOVA, IKI DEGIL: spa / nonSpa / unmeasured. Kesifte satiri olmayan route "SPA degil"
// DEGILDIR - olculemedi. Bu ayrim olmadan, kesfin gormedigi her route yuzdeyi asagi cekip
// "bu cluster'da SPA yok" izlenimi verirdi (ayni sinif: Server Hub trafik olcumu,
// retirement vhost uyarisi, nginx kapsam ekrani).
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
const T = (s) => String(s == null ? '' : s).trim();

/** Route adresinden uygulama adi: "<app>-<ns>.apps..." -> app (ns biliniyor). */
function appFromAddress(addr, nsLower) {
  const label = L(addr).split('.')[0];
  if (!label || !nsLower) return null;
  const suf = '-' + nsLower;
  return label.endsWith(suf) && label.length > suf.length ? label.slice(0, -suf.length) : null;
}

/**
 * Canli SPA sinyali dizini (dbo.BMW_Spa_Discovery satirlari).
 *
 * @param spaRows [{cluster, namespace, route, is_spa, signal, match_by, workload, scan_date}]
 *   null/undefined = KESIF OKUNAMADI (tablo yok ya da sorgu dustu) -> her route
 *   'unmeasured'. Bos dizi ise tablo okundu ama satir yok; ayrim cagirana tasinir.
 * @returns {{byRoute: Map, byCluster: Map}|null}
 */
function spaIndex(spaRows) {
  if (!spaRows) return null;
  const byRoute = new Map();
  const byCluster = new Map();
  for (const d of spaRows) {
    const cl = L(d.cluster);
    const c = byCluster.get(cl) || { rows: 0, scanDate: null };
    c.rows++;
    const sd = T(d.scan_date);
    if (sd && (!c.scanDate || sd > c.scanDate)) c.scanDate = sd;
    byCluster.set(cl, c);
    const ns = L(d.namespace);
    const rt = L(d.route);
    if (!ns || !rt) continue;
    const k = cl + '|' + ns + '|' + rt;
    const cur = {
      isSpa: Number(d.is_spa) === 1,
      signal: T(d.signal),
      matchBy: T(d.match_by),
      workload: T(d.workload),
    };
    // AYNI ROUTE ICIN BIRDEN COK SATIR OLABILIR. spa_discovery her ESLESEN is yuku icin
    // bir satir yaziyor (Deployment + DeploymentConfig + Rollout ayni ada sahip olabilir).
    // SPA diyen satir KAZANIR: kabinlerden birinde nginx kosuyorsa o route bir SPA sunuyor.
    // "son satir kazansin" demek, sirasi rastgele olan bir listede cevabi zara baglardi.
    const prev = byRoute.get(k);
    if (!prev || (!prev.isSpa && cur.isSpa)) byRoute.set(k, cur);
  }
  return { byRoute, byCluster };
}

const BOS_SINYAL = { signal: '', matchBy: '', workload: '' };

/**
 * Tek route'un canli sinifi. ix null ise (kesif okunamadi) her zaman 'unmeasured'.
 * @returns {{kind:'spa'|'nonSpa'|'unmeasured', reason:string, signal:string, matchBy:string, workload:string}}
 */
function canliSinif(ix, r) {
  const cl = L(r.cluster_name);
  if (!ix) return { kind: 'unmeasured', reason: 'kesif-okunamadi', ...BOS_SINYAL };
  const e = ix.byRoute.get(cl + '|' + L(r.namespace_name) + '|' + L(r.route_name));
  if (!e) {
    // CLUSTER HIC TARANMADI ile ROUTE TARAMADA YOK AYRI SEBEPLER. Birincisi yetki/login
    // sorunu (ekranda "kesif bu cluster'a girememis"), ikincisi route'un kesif kostuktan
    // sonra acilmis olmasi ya da o namespace'in okunamamasi.
    return {
      kind: 'unmeasured',
      reason: ix.byCluster.has(cl) ? 'route-kesifte-yok' : 'cluster-taranmadi',
      ...BOS_SINYAL,
    };
  }
  return {
    kind: e.isSpa ? 'spa' : 'nonSpa',
    reason: '',
    signal: e.signal,
    matchBy: e.matchBy,
    workload: e.workload,
  };
}

/** spa / (spa + nonSpa). Hic olculmemisse NULL - %0 yazmak "SPA yok" iddiasi olurdu. */
function olculenYuzde(spa, nonSpa) {
  const n = spa + nonSpa;
  return n ? Math.round((spa / n) * 1000) / 10 : null;
}

/**
 * @param routeRows  [{namespace_name, route_name, route_address, resolved_ip, termination_type, cluster_name}]
 * @param spaRows    dbo.BMW_Spa_Discovery satirlari; null = kesif okunamadi
 * @returns {{envs: Array, totals: Object, spaSignalRead: boolean, spaSignalRows: number}}
 */
function buildRouteStats(routeRows, spaRows) {
  const ix = spaIndex(spaRows);
  const byEnv = new Map();
  const mk = () => ({
    routes: 0,
    spa: 0,
    nonSpa: 0,
    unmeasured: 0,
    // AD KALIBI EKSENI KORUNUR: Tasima ekraninin olcutu bu ve iki ekranin sayilari
    // karsilastirilabilir kalmali.
    byName: { spa: 0, nonSpa: 0, unclassified: 0 },
    nameMismatch: 0,
    nameFalsePositive: 0,
    terminations: new Map(),
    // kind -> ip -> {count, routes:Set(ns/app)}
    ips: { spa: new Map(), nonSpa: new Map(), unmeasured: new Map() },
    unresolvedIp: { spa: 0, nonSpa: 0, unmeasured: 0 },
    clusters: new Set(),
    // CLUSTER BASINA KIRILIM (kullanici, 2026-10-08): "GBOCP Prod 1'de bu kadar route
    // var, bunlarin su kadari SPA route'u, yuzdesi de budur." Ortam toplami tek basina
    // "hangi cluster'da eksik" sorusunu cevaplamiyordu; ARK'in prod'u dort cluster.
    //
    // clusters (isim kumesi) KORUNUR: ekranda ortam basina cluster SAYISI icin
    // kullaniliyor ve tipini degistirmek onyuzu sessizce bozardi.
    clusterStats: new Map(),
    namespaces: new Set(),
  });

  // Cluster kovasi - ortam kovasiyla AYNI alanlar, IP/termination kirilimi YOK
  // (ekranda cluster satiri yalnizca route/SPA/yuzde gosteriyor; IP dagilimi ortam
  // duzeyinde anlamli, cluster duzeyinde gurultu).
  const mkCluster = () => ({
    routes: 0,
    spa: 0,
    nonSpa: 0,
    unmeasured: 0,
    nameMismatch: 0,
    nameFalsePositive: 0,
    reasons: new Map(),
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

    // AD EKSENI (ikincil): uygulama adi adresten, olmazsa route adindan.
    const app = appFromAddress(r.route_address, ns) || L(r.route_name) || null;
    const adSpa = app ? isSpaApp(app) : null;
    if (adSpa === null) b.byName.unclassified++;
    else if (adSpa) b.byName.spa++;
    else b.byName.nonSpa++;

    // CANLI EKSEN (birincil).
    const cs = canliSinif(ix, r);
    const kind = cs.kind;
    b[kind]++;
    cb[kind]++;
    if (cs.reason) cb.reasons.set(cs.reason, (cb.reasons.get(cs.reason) || 0) + 1);
    // CAPRAZ: kullanicinin aradigi satir, nginx kosan ama adi standarda uymayan route.
    if (kind === 'spa' && adSpa === false) {
      b.nameMismatch++;
      cb.nameMismatch++;
    } else if (kind === 'nonSpa' && adSpa === true) {
      b.nameFalsePositive++;
      cb.nameFalsePositive++;
    }

    const ip = String(r.resolved_ip || '').trim();
    if (!ip) {
      b.unresolvedIp[kind]++;
      continue;
    }
    const m = b.ips[kind];
    if (!m.has(ip)) m.set(ip, { ip, count: 0, samples: new Set() });
    const e = m.get(ip);
    e.count++;
    if (e.samples.size < 5) e.samples.add(ns + '/' + (app || T(r.route_name) || '?'));
  }

  const ipList = (m) =>
    [...m.values()]
      .map((x) => ({ ip: x.ip, count: x.count, samples: [...x.samples] }))
      .sort((a, c) => c.count - a.count);
  const clInfo = (cluster) => (ix ? ix.byCluster.get(L(cluster)) || null : null);

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
      unmeasured: b.unmeasured,
      byName: { ...b.byName },
      nameMismatch: b.nameMismatch,
      nameFalsePositive: b.nameFalsePositive,
      clusters: [...b.clusters].filter(Boolean).sort(),
      clusterRows: [...b.clusterStats.entries()]
        .map(([cluster, c]) => ({
          cluster,
          routes: c.routes,
          spa: c.spa,
          nonSpa: c.nonSpa,
          unmeasured: c.unmeasured,
          nameMismatch: c.nameMismatch,
          nameFalsePositive: c.nameFalsePositive,
          // SPA YUZDESI OLCULEMEYENI DE PAYDAYA KOYAR. spa/(spa+nonSpa) yazmak,
          // kesfin gormedigi route'lari yok sayip yuzdeyi SISIRIRDI - "olculemedi" ile
          // "SPA degil" ayni sey degil. Payda route TOPLAMI.
          spaPct: c.routes ? Math.round((c.spa / c.routes) * 1000) / 10 : 0,
          // OLCULEN uzerinden ikinci yuzde: kesfin gordugu route'larin ne kadari SPA.
          // Hic olculmemisse NULL (bkz. olculenYuzde) - %0, "SPA yok" iddiasidir.
          spaPctMeasured: olculenYuzde(c.spa, c.nonSpa),
          // KESIF BU CLUSTER'DA NE KADAR VERI BIRAKMIS. 0 ise cluster hic taranmamis;
          // satiri olup da hic eslesme yoksa ANAHTAR UYUSMUYOR (iki job cluster adini
          // farkli yaziyor olabilir) - bu da "SPA yok" ile karistirilmamali.
          discoveryRows: clInfo(cluster)?.rows || 0,
          discoveryScanDate: clInfo(cluster)?.scanDate || null,
          keyMismatch: !!ix && (clInfo(cluster)?.rows || 0) > 0 && c.spa + c.nonSpa === 0,
          reasons: [...c.reasons.entries()]
            .map(([reason, count]) => ({ reason, count }))
            .sort((x, y) => y.count - x.count),
        }))
        .sort((x, y) => y.routes - x.routes || x.cluster.localeCompare(y.cluster)),
      namespaces: b.namespaces.size,
      terminations: [...b.terminations.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, c) => c.count - a.count),
      spaIps: ipList(b.ips.spa),
      nonSpaIps: ipList(b.ips.nonSpa),
      unmeasuredIps: ipList(b.ips.unmeasured),
      unresolvedIp: { ...b.unresolvedIp },
    }));

  const sum = (f) => envs.reduce((a, e) => a + f(e), 0);
  return {
    envs,
    totals: {
      routes: sum((e) => e.routes),
      spa: sum((e) => e.spa),
      nonSpa: sum((e) => e.nonSpa),
      unmeasured: sum((e) => e.unmeasured),
      nameMismatch: sum((e) => e.nameMismatch),
      nameFalsePositive: sum((e) => e.nameFalsePositive),
      byName: {
        spa: sum((e) => e.byName.spa),
        nonSpa: sum((e) => e.byName.nonSpa),
        unclassified: sum((e) => e.byName.unclassified),
      },
      noEnv,
    },
    // KESIF OKUNDU MU: false ise kesif verisi hic gelmedi demek. Onyuz bunu "SPA yok"
    // diye degil "olculemedi" diye gostermek ZORUNDA.
    spaSignalRead: !!ix,
    spaSignalRows: ix ? [...ix.byCluster.values()].reduce((a, c) => a + c.rows, 0) : 0,
  };
}

/**
 * Bir IP'ye cozen route'lar (kullanici, 2026-09-17: "IP'ye tikladigimda hangi route'lar
 * cozuyor"). Ortam namespace ekinden; kind = spa | nonSpa | unmeasured | all.
 */
function routesOfIp(routeRows, ip, env, kind = 'all', spaRows) {
  const want = String(ip || '').trim();
  return routeListesi(
    routeRows,
    env,
    kind,
    (r) => String(r.resolved_ip || '').trim() === want,
    spaRows,
  );
}

/**
 * Bir CLUSTER'daki route'lar (kullanici, 2026-10-08: "cluster bazli route'larin SPA olup
 * olmadigini gosterdik ya, ustlerine tikladigimda SPA olmayan route'lari gormek istiyorum").
 *
 * routesOfIp ile AYNI govdeyi kullanir (routeListesi): siniflandirma tek yerde kalsin.
 * Ikinci bir kopya, bu depoda tekrar tekrar yasanan sinifa girerdi - olcut degisince biri
 * guncellenir, oteki sessizce eski kalir (bkz. spa-pattern.cjs gerekcesi).
 */
function routesOfCluster(routeRows, cluster, env, kind = 'all', spaRows) {
  const want = L(cluster);
  // ADI BOS GELEN CLUSTER da sorgulanabilir: ekrandaki '(cluster adi yok)' kovasina
  // tiklanabiliyor ve o satirin icerigi gorunmez kalmamali.
  return routeListesi(
    routeRows,
    env,
    kind,
    (r) => (want === '' ? L(r.cluster_name) === '' : L(r.cluster_name) === want),
    spaRows,
  );
}

/** Ortak govde: ortam suzgeci + canli siniflandirma + siralama. sec = satir suzgeci. */
function routeListesi(routeRows, env, kind, sec, spaRows) {
  const ix = spaIndex(spaRows);
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
    const cs = canliSinif(ix, r);
    if (kind !== 'all' && cs.kind !== kind) continue;
    out.push({
      namespace: ns,
      route: T(r.route_name),
      address: T(r.route_address),
      type: L(r.termination_type) || 'yok',
      kind: cs.kind,
      // NEDEN OLCULEMEDI / SINYAL NEREDEN GELDI: karari veren kisi gormek zorunda.
      // matchBy 'selector' ise servis secicisi okunmus (kesin); 'ad' ise ayni adli is
      // yukune DUSULMUS (zayif kanit); bos ise is yuku hic eslesmemis.
      reason: cs.reason,
      signal: cs.signal,
      matchBy: cs.matchBy,
      workload: cs.workload,
      // AD EKSENI: true standarda uyuyor, false uymuyor, null ad cozulemedi.
      nameSpa: app ? isSpaApp(app) : null,
      cluster: T(r.cluster_name),
    });
  }
  return out.sort(
    (a, b) => a.namespace.localeCompare(b.namespace) || a.address.localeCompare(b.address),
  );
}

module.exports = {
  buildRouteStats,
  routesOfIp,
  routesOfCluster,
  appFromAddress,
  spaIndex,
  canliSinif,
  olculenYuzde,
  SPA_RE,
};
