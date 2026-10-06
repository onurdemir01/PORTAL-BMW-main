// server/audit/app-traffic.cjs — Denetim ▸ Uygulama Trafiği. Birim: UYGULAMA.
//
// ── OMURGA DEGISTI (kullanici, 2026-10-06) ───────────────────────────────────────────
// Istenen kolonlar, kullanicinin kendi sozleriyle:
//   "Namespace - Uygulama - Ortam/SPA - Istek - Route - Cluster"
//   "her bir uygulama icin tek satir olmali"
//   "uygulamanin pod ismi degil direkt kendi ismi yazilmali"
//   "ilgili route hangi cluster'larda var ise Kismi veya Tam olarak gosterilmeli...
//    4 prod cluster'in 4'unde de varsa 4/4 Tam, 3'unde varsa 3/4 Kismi"
//
// ONCEKI HALI YANLIS TABLODAN BESLENIYORDU: omurga `BMW_Openshift_Route_Inventory` +
// Dynatrace `displayName` idi. Uc sonucu vardi, kullanici ucunu de bildirdi:
//   * "pod ismi gozukuyor"  -> uygulama adi Dynatrace displayName'den geliyordu ve
//                              type("CLOUD_APPLICATION") POD'lari da donuyor
//   * "route bos geliyor"   -> route<->uygulama eslemesi AD KALIBIYLA tahmin ediliyordu
//   * "SPA mi belli degil"  -> SPA, ad kalibindan (`-app-v`) TAHMIN ediliyordu
//
// DOGRU OMURGA `dbo.BMW_Spa_Discovery` (job: openshift_spa_discovery). O job route'un
// ardindaki is yukunu GERCEKTEN cozuyor (Service -> Deployment / DeploymentConfig / Argo
// Rollout, yetki kapsami yedekleriyle) ve SPA'yi OLCUYOR: kabinde nginx sinyali
// (`nginx-start.sh`) var mi. Tablo tam gereken alanlari tasiyor:
//   cluster | namespace | route | host | termination | workload_kind | workload | is_spa
// `workload` = uygulamanin KENDI adi (pod adi DEGIL). `is_spa` = TAHMIN DEGIL, olcum.
//
// ISTEK kolonu `dbo.BMW_Application_Usage`'tan (job: application_usage; Dynatrace
// builtin:service.requestCount.total, 7 gun). Iki job AYRI yerde kosar — SPA kesfi jump
// server'larda `oc` ile, kullanim GBLABT02'de Dynatrace proxy'siyle — ve AWX workflow'uyla
// zincirlenir (SPA Discovery -> Application Usage), BIRLESTIRILMEZLER. Bu yuzden iki ayri
// `scan_date` olabilir; ekran bunu SAKLAMAZ, cagiran `freshness` ile yuzeye cikarir.
//
// ── OLCULEMEDI != YOK (bu dosyanin en onemli kurali) ────────────────────────────────
// Uc ayri yerde "bilmiyoruz" durumu var; ucu de "yok"tan AYRI tutulur:
//   1. ISTEK: kullanim satiri yoksa ya da measured=0 ise -> 'unmeasured'. 0 yazmak
//      "istek almiyor" demek olurdu; atil bir uygulamayla hic olculmemis bir uygulamayi
//      ayni gostermek emeklilik kararini bozar.
//   2. SPA: route bir is yukune eslesemediyse (workload bos) -> 'unknown'. "SPA degil"
//      demek, nginx kosan bir uygulamayi gorunmez yapardi.
//   3. CLUSTER KAPSAMI: o ortamin TARANAMAYAN cluster'lari paydaya girmez ve "Kismi"
//      damgasina sebep OLMAZ; ayri sayilir. Bugun 12 cluster `login` ile dusuyor —
//      erisilemeyen bir cluster yuzunden "4/5 Kismi" demek UYDURMA bir eksiklik raporu
//      olurdu; uygulama orada olabilir de olmayabilir de, BILMIYORUZ.
'use strict';

const { envOfNamespace } = require('./ocp-platforms.cjs');

const L = (v) =>
  String(v == null ? '' : v)
    .trim()
    .toLowerCase();
const S = (v) => String(v == null ? '' : v).trim();

/** Cluster katalogu: cluster -> {env, tenant}; ve env -> o ortamin cluster kumesi. */
function clusterHaritasi(clusterRows) {
  const byCluster = new Map();
  const byEnv = new Map();
  for (const r of clusterRows || []) {
    const c = L(r.cluster_name);
    const env = S(r.env);
    if (!c || !env) continue;
    byCluster.set(c, { env, tenant: S(r.tenant) });
    const k = L(env);
    if (!byEnv.has(k)) byEnv.set(k, new Set());
    byEnv.get(k).add(c);
  }
  return { byCluster, byEnv };
}

/**
 * Hangi cluster GERCEKTEN tarandi?
 *
 * `ok` ve `kismi` TARANDI sayilir: `kismi` demek "route'lar okundu ama bazi namespace'lerin
 * servisleri okunamadi" — route VARLIGI guvenilir, eksik olan is yuku eslemesidir.
 * `login` / `hata` ise cluster'a HIC bakilamadi; o cluster kapsam paydasina GIRMEZ.
 */
function olculenClusterlar(runRows) {
  const olculen = new Set();
  const bakilamayan = new Set();
  for (const r of runRows || []) {
    const c = L(r.cluster);
    if (!c) continue;
    if (['ok', 'kismi'].includes(L(r.durum))) olculen.add(c);
    else bakilamayan.add(c);
  }
  return { olculen, bakilamayan };
}

/**
 * Uygulama basina TEK satir uretir.
 *
 * @param {{spa:object[], runs:object[], usage:object[], clusters:object[]}} veri
 * @param {{q?:string, env?:string, spa?:string, status?:string, coverage?:string, limit?:any}} [opts]
 */
function buildAppTraffic(veri, opts = {}) {
  const { spa = [], runs = [], usage = [], clusters = [] } = veri || {};
  const { byCluster, byEnv } = clusterHaritasi(clusters);
  const { olculen, bakilamayan } = olculenClusterlar(runs);

  // ISTEK indeksi: (namespace, app) -> kullanim satiri. Cagiran uygulama basina EN YENI
  // satiri getirir (SQL'de ROW_NUMBER), burada tekrar tarih karsilastirmasi yapilmaz.
  const kullanim = new Map();
  for (const u of usage) {
    const k = L(u.namespace) + '\u0000' + L(u.app);
    if (!kullanim.has(k)) kullanim.set(k, u);
  }

  // ── GRUPLAMA: (namespace, workload). workload BOSSA route bir is yukune eslesmemistir
  // ve satir AYRI durur ("eşleşmedi"); gizlemek, Portal'in gormedigi bir route birakmak
  // ve o route'un olculdugu izlenimini vermek olurdu.
  const gruplar = new Map();
  for (const r of spa) {
    const ns = S(r.namespace);
    if (!ns) continue;
    const app = S(r.workload);
    const cl = L(r.cluster);
    const route = S(r.route);
    const anahtar = app ? ns + '\u0000' + app : ns + '\u0000\u0001route:' + route;
    let g = gruplar.get(anahtar);
    if (!g) {
      g = {
        namespace: ns,
        app: app || null,
        kind: S(r.workload_kind) || null,
        routes: new Map(),
        clusters: new Set(),
        isSpa: 0,
        spaOlculdu: false,
        notlar: new Set(),
      };
      gruplar.set(anahtar, g);
    }
    if (cl) g.clusters.add(cl);
    if (route && !g.routes.has(route)) g.routes.set(route, S(r.host));
    // SPA OLCUMU yalniz is yukune eslesmis satirdan gelir: eslesmemis satir "SPA degil"
    // DEMEK DEGILDIR, olculememistir.
    if (app) {
      g.spaOlculdu = true;
      if (Number(r.is_spa) === 1) g.isSpa = 1;
    }
    if (S(r.note)) g.notlar.add(S(r.note));
  }

  const rows = [];
  for (const g of gruplar.values()) {
    // ORTAM: once cluster katalogu (olculmus gercek), tutmazsa namespace son-eki
    // (envOfNamespace — ayni kural Denetim'in geri kalaninda da kullaniliyor).
    const ortamlar = [
      ...new Set([...g.clusters].map((c) => byCluster.get(c)?.env).filter(Boolean)),
    ];
    const env = ortamlar.length ? ortamlar.sort().join(', ') : envOfNamespace(g.namespace) || null;

    // ── CLUSTER KAPSAMI ────────────────────────────────────────────────────────
    // Payda KATALOGDAN gelir (elle cluster listesi YOK) ve yalniz TARANABILEN
    // cluster'lari sayar. Bakilamayan cluster ayri raporlanir (bkz. dosya basi).
    const envKey = ortamlar.length === 1 ? L(ortamlar[0]) : null;
    const envClusterlari = envKey ? [...(byEnv.get(envKey) || [])] : [];
    const payda = envClusterlari.filter((c) => olculen.has(c)).length;
    const pay = [...g.clusters].filter((c) => envClusterlari.includes(c) && olculen.has(c)).length;
    const bakilamayanSayisi = envClusterlari.filter((c) => bakilamayan.has(c)).length;
    let kapsam = 'unknown';
    if (payda > 0) kapsam = pay >= payda ? 'full' : pay > 0 ? 'partial' : 'none';

    // ── ISTEK ──────────────────────────────────────────────────────────────────
    const u = g.app ? kullanim.get(L(g.namespace) + '\u0000' + L(g.app)) : null;
    let reqStatus = 'unmeasured';
    let req = null;
    if (u) {
      const olculdu = u.measured === true || Number(u.measured) === 1;
      const n = Number(u.req_total) || 0;
      if (olculdu) {
        reqStatus = n > 0 ? 'active' : 'idle';
        req = n;
      }
    }

    rows.push({
      namespace: g.namespace,
      app: g.app,
      kind: g.kind,
      env,
      // UC DEGERLI: yes | no | unknown
      spa: g.spaOlculdu ? (g.isSpa ? 'yes' : 'no') : 'unknown',
      req,
      reqStatus,
      reqNote: u ? S(u.note) || null : null,
      reqScanDate: u && u.scan_date ? new Date(u.scan_date).toISOString().slice(0, 10) : null,
      routes: [...g.routes.entries()].map(([route, host]) => ({ route, host: host || null })),
      clusters: [...g.clusters].sort(),
      coverage: kapsam,
      coveragePresent: pay,
      coverageTotal: payda,
      coverageUnmeasured: bakilamayanSayisi,
      matched: !!g.app,
      note: [...g.notlar][0] || null,
    });
  }

  // SIRALAMA: once eslesmeyenler, sonra olculemeyen istek, sonra istege gore azalan.
  // Kullanicinin "neyi duzeltmeliyim" sorusu ustte cevaplanir.
  const sira = { unmeasured: 0, active: 1, idle: 2 };
  rows.sort(
    (a, b) =>
      Number(a.matched) - Number(b.matched) ||
      sira[a.reqStatus] - sira[b.reqStatus] ||
      (b.req == null ? -1 : b.req) - (a.req == null ? -1 : a.req) ||
      String(a.namespace).localeCompare(String(b.namespace)) ||
      String(a.app || '').localeCompare(String(b.app || '')),
  );

  // OZET TUM KUMEDEN (suzgecten ONCE): suzulmus bir listenin ozeti "filoda durum bu"
  // diye okunur ve yanlis olur.
  const summary = {
    apps: rows.filter((r) => r.matched).length,
    unmatched: rows.filter((r) => !r.matched).length,
    spa: rows.filter((r) => r.spa === 'yes').length,
    spaUnknown: rows.filter((r) => r.spa === 'unknown').length,
    active: rows.filter((r) => r.reqStatus === 'active').length,
    idle: rows.filter((r) => r.reqStatus === 'idle').length,
    unmeasured: rows.filter((r) => r.reqStatus === 'unmeasured').length,
    coverageFull: rows.filter((r) => r.coverage === 'full').length,
    coveragePartial: rows.filter((r) => r.coverage === 'partial').length,
    routes: rows.reduce((a, r) => a + r.routes.length, 0),
  };

  // SUZGECLER SUNUCUDA (2026-09-30 olcumu: 70k satir = 20,9 MB JSON, ekran donuyordu).
  const q = L(opts.q);
  const envF = L(opts.env);
  const spaF = L(opts.spa);
  const durumF = L(opts.status);
  const kapsamF = L(opts.coverage);
  let out = rows;
  if (q)
    out = out.filter(
      (r) =>
        L(r.namespace).includes(q) ||
        L(r.app).includes(q) ||
        r.routes.some((x) => L(x.route).includes(q) || L(x.host).includes(q)),
    );
  if (envF) out = out.filter((r) => L(r.env) === envF);
  if (spaF) out = out.filter((r) => r.spa === spaF);
  if (durumF) out = out.filter((r) => r.reqStatus === durumF);
  if (kapsamF) out = out.filter((r) => r.coverage === kapsamF);

  const n = Number(opts.limit);
  const limit = Number.isFinite(n) && n > 0 ? Math.min(n, 5000) : 1000;
  // ORTAM SECENEKLERI TUM KUMEDEN: kirpilmis listeden uretmek, suzgecte eksik ortam
  // gostermek olurdu (kullanici o ortamin hic uygulamasi yok sanar).
  const envs = [...new Set(rows.map((r) => r.env).filter(Boolean))].sort();
  return {
    rows: out.slice(0, limit),
    summary,
    envs,
    total: rows.length,
    filtered: out.length,
    limit,
    // TAVANDA KESILDIYSE EKRAN SOYLEMEK ZORUNDA: sessizce kirpmak, "filoda bu kadar var"
    // diye okunur.
    truncated: out.length > limit,
  };
}

module.exports = { buildAppTraffic, clusterHaritasi, olculenClusterlar };
