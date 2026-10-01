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

/** 'YYYY-MM-DD' ya da '' (Date, ISO metin ya da bos). */
const gunu = (v) => {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

/**
 * Eslesmeme notunu KOVAYA indirger: "servis bulunamadi: x-svc" -> "servis bulunamadi".
 * Kovalar AYRI sayilir cunku anlamlari zittir: "servis okunamadi" bir OLCUM sorunudur
 * (yetki), "servis bulunamadi" ise route'un kendisinde bir BULGUDUR.
 */
const notKovasi = (note) => T(note).split(':')[0].trim() || 'bilinmiyor';

const BASARISIZ = new Set(['login', 'hata', 'erisilemedi']);

/**
 * CLUSTER KAPSAMI (2026-10-01, ilk uretim kosusu): 43 cluster'in 27'si hic veri uretmedi
 * ama ekran yalnizca "0 SPA" diyordu. "Taranamadi" ile "SPA'si yok" AYRI gosterilir.
 *
 * KOVALAR AYRIKTIR (dusmanca dogrulama bulgusu: bir cluster iki sayida birden geciyordu).
 * Oncelik sirasi: taranamadi > kismi > bilinmiyor > onceki kosudan > guncel. Her cluster
 * TEK kovadadir; kovalarin toplami cluster sayisidir.
 *
 * "SON KOSUYA GIRMEDI" BIR HATA DEGILDIR: tek cluster'a kosulan bir is digerlerini hedeflemez.
 * Hedeflenip sonuc vermeyen cluster'i yukleyici `erisilemedi` diye ZATEN yazar (hedef listesi);
 * burada tahmin yurutulmez, yalnizca "onceki kosudan" diye notr isaretlenir.
 *
 * @param {object[]|null} runs  dbo.BMW_Spa_Discovery_Run, cluster basina EN YENI satir;
 *                              null = tablo OKUNAMADI (bos dizi ile ayni sey DEGIL)
 * @param {Map<string,string>} veriGunu  cluster -> ekranda gosterilen verinin tarihi
 */
function kapsam(runs, veriGunu) {
  const out = new Map();
  for (const r of runs || []) {
    const c = T(r.cluster);
    if (!c) continue;
    out.set(c, {
      cluster: c,
      status: T(r.durum) || 'bilinmiyor',
      runDate: gunu(r.scan_date),
      routes: r.routes == null ? null : Number(r.routes),
      spa: r.spa == null ? null : Number(r.spa),
      unmatched: r.eslesmeyen == null ? null : Number(r.eslesmeyen),
      svcMode: T(r.svc_kip),
      svcUnreadableNs: r.svc_okunamayan_ns == null ? null : Number(r.svc_okunamayan_ns),
      reason: T(r.sebep),
    });
  }
  // Verisi olup durum satiri OLMAYAN cluster: yukleyicinin durum yazmayan eski surumu.
  // Sonucu BILINMIYOR - "ok" diye boyanmaz.
  for (const c of veriGunu.keys()) {
    if (!out.has(c))
      out.set(c, {
        cluster: c,
        status: 'bilinmiyor',
        runDate: '',
        routes: null,
        spa: null,
        unmatched: null,
        svcMode: '',
        svcUnreadableNs: null,
        reason: 'bu cluster icin tarama durumu kaydi yok',
      });
  }
  const sonKosu = [...out.values()].reduce((m, k) => (k.runDate > m ? k.runDate : m), '');
  const SIRA = { taranamadi: 0, kismi: 1, bilinmiyor: 2, onceki: 3, guncel: 4 };
  const clusters = [...out.values()]
    .map((k) => {
      const dataDate = veriGunu.get(k.cluster) || '';
      const basarisiz = BASARISIZ.has(k.status);
      // VERI DURUMDAN YENI: veri yazilmis ama durum satiri yazilmamis (yarim yukleme ya da
      // eski surum). Ne oldugunu bilmiyoruz.
      const veriIleride = !!(dataDate && k.runDate && dataDate > k.runDate);
      // ESKI VERI: basarisiz bir kosu VERI YAZMAZ; o cluster'in ekrandaki satirlari mutlaka
      // ONCEKI bir kosudan. Ayni gun iki kez kosulsa bile (tarih esit) bu boyle.
      const stale = !!(dataDate && (basarisiz || (k.runDate && dataDate < k.runDate)));
      const oncekiKosudan = !!(k.runDate && sonKosu && k.runDate < sonKosu);
      let bucket;
      if (basarisiz) bucket = 'taranamadi';
      else if (k.status === 'kismi') bucket = 'kismi';
      else if (k.status !== 'ok' || veriIleride) bucket = 'bilinmiyor';
      else if (oncekiKosudan) bucket = 'onceki';
      else bucket = 'guncel';
      return {
        ...k,
        reason: veriIleride
          ? `veri (${dataDate}) durum kaydından (${k.runDate}) yeni — yükleme yarım kalmış olabilir` +
            (k.reason ? `; ${k.reason}` : '')
          : k.reason,
        dataDate,
        bucket,
        stale,
        notInLastRun: oncekiKosudan,
        noData: !dataDate,
      };
    })
    .sort((a, b) => SIRA[a.bucket] - SIRA[b.bucket] || a.cluster.localeCompare(b.cluster));
  const say = (b) => clusters.filter((k) => k.bucket === b).length;
  return {
    // Durum tablosu hic yoksa (yukleyicinin eski surumu) kapsam OLCULMEMISTIR; okunamadiysa
    // (runs === null) bu AYRICA soylenir.
    measured: (runs || []).length > 0,
    error: runs === null ? 'cluster tarama durumu okunamadı' : '',
    lastRun: sonKosu,
    clusters,
    total: clusters.length,
    ok: say('guncel'),
    older: say('onceki'),
    partial: say('kismi'),
    failed: say('taranamadi'),
    unknown: say('bilinmiyor'),
    // KOVA DEGIL, ALT BILGI: hangi kovada olursa olsun ekranda hic satiri olmayan cluster.
    noData: clusters.filter((k) => k.noData).length,
  };
}

/**
 * @param {object[]} discovery  dbo.BMW_Spa_Discovery (cluster basina EN YENI tarama)
 * @param {object[]} inventory  dbo.BMW_Openshift_Route_Inventory
 * @param {object[]} usage      dbo.BMW_Application_Usage (uygulama basina EN YENI satir)
 * @param {object[]} [runs]     dbo.BMW_Spa_Discovery_Run (cluster basina EN YENI satir)
 */
function buildSpaDiscovery(discovery, inventory, usage, runs) {
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
    const envVar = envRoute.has(`${L(ns)}|${L(d.route)}`) || envAdres.has(`${L(ns)}|${L(d.host)}`);
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
      // ESLESME KANITI: 'selector' (servis selector'u pod etiketlerine uydu) ya da 'ad'
      // (servis OKUNAMADI, servisle ayni adli is yukune dusuldu - daha zayif kanit).
      matchBy: T(d.match_by),
      scanDate: gunu(d.scan_date),
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
  const veriGunu = new Map();
  for (const r of rows) {
    if (r.cluster && r.scanDate > (veriGunu.get(r.cluster) || ''))
      veriGunu.set(r.cluster, r.scanDate);
  }
  return {
    rows,
    coverage: kapsam(runs, veriGunu),
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
      // ...ve SEBEP KIRILIMI. Ilk uretim kosusunda 4532 satirin tamami tek kovadaydi
      // ("servis bulunamadi") ve ekran yalnizca "0 SPA" diyordu; kovayi gormek sorunun
      // bir YETKI sorunu oldugunu bir bakista soylerdi.
      unmatchedReasons: rows.reduce((m, r) => {
        if (!r.note) return m;
        const k = notKovasi(r.note);
        m[k] = (m[k] || 0) + 1;
        return m;
      }, {}),
      // ESLESME KANITI KIRILIMI: 'ad' ile eslesen satirlar daha zayif kanittir.
      byMatch: rows.reduce((m, r) => {
        if (r.matchBy) m[r.matchBy] = (m[r.matchBy] || 0) + 1;
        return m;
      }, {}),
    },
  };
}

module.exports = { buildSpaDiscovery, uygulamaAdi, notKovasi };
