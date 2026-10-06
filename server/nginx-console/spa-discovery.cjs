// server/nginx-console/spa-discovery.cjs — Nginx Hub > "Gercek SPA Kesfi" (2026-10-01).
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
//
// UC SORU DAHA (kullanici, 2026-10-01): "ayni tabloda uygulamanin istek alip almadigi,
// intranet mi internet mi, internet ise BIZIM reverse proxy sunucularimizda tanimli mi ve
// RP tanimi istek aliyor mu - hepsi tek yerde."
//   Ag          route TLS termination'i (passthrough=internet, reencrypt=intranet, ikisi
//               birden=karisik, edge/TLS'siz=diger, NULL=bilinmiyor); route envanteriyle
//               capraz kontrol EDILIR ama ag degerini EZMEZ.
//   RP / istegi spa-rp.cjs (Nginx_Config_Audit, Nginx_Intranet_Audit, Nginx_Spa_Traffic).
// SATIRA yalniz KOD ve SAYI yazilir (yanit 8 MB onbellek siniri altinda kalmali); tanim
// listesi GET /spa-discovery/rp ucundan gelir.
'use strict';

const { isSpaApp } = require('../audit/spa-pattern.cjs');
const { envOfNamespace } = require('../audit/ocp-platforms.cjs');
const { rpUygula } = require('./spa-rp.cjs');

const L = (s) =>
  String(s == null ? '' : s)
    .trim()
    .toLowerCase();
const T = (s) => String(s == null ? '' : s).trim();

/**
 * Kesif satirindan UYGULAMA adini turetir.
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

/**
 * OLCUM INDEKSI: (namespace, uygulama) -> Dynatrace ozeti, CLUSTER'LAR TOPLANARAK.
 *
 * NEDEN (dogrulama bulgusu, 2026-10-01): dbo.BMW_Application_Usage satiri CLUSTER basinadir
 * (tekil anahtar scan_date, cluster, namespace, app). Eskiden (namespace, app) basina tek satir
 * seciliyordu; prod1/prod2'den hangisinin gelecegi belirsizdi ve aktif/pasif bir uygulamada
 * pasif cluster'in 0'i ekranda "istek yok" gorunebiliyordu.
 *
 * KURAL: cluster basina EN YENI satir alinir (sorgu da oyle secer; burada ikinci kez
 * guvenceye alinir), sonra cluster'lar birlestirilir:
 *   req / services  yalniz OLCULEN cluster'larin toplami
 *   reqShown        olculen cluster'larda istek varsa toplam ('var' - biri gorduyse yeter);
 *                   0 ise YALNIZ hepsi olculduyse 0 ('yok'), degilse null ('olculemedi')
 *   measured        HEPSI olculdu mu
 * @param {object[]|null} usage
 * @returns {Map<string, object>}
 */
function olcumIndeksi(usage) {
  const sonCluster = new Map();
  for (const u of usage || []) {
    const k = `${L(u.namespace)}|${L(u.app)}|${L(u.cluster)}`;
    const gun = gunu(u.scan_date);
    const onceki = sonCluster.get(k);
    if (onceki && onceki.gun >= gun) continue;
    sonCluster.set(k, { u, gun });
  }
  const olcum = new Map();
  for (const { u, gun } of sonCluster.values()) {
    const k = `${L(u.namespace)}|${L(u.app)}`;
    let o = olcum.get(k);
    if (!o) {
      o = {
        scanDate: '',
        windowDays: 0,
        req: 0,
        services: 0,
        measured: true,
        clusters: 0,
        olculen: 0,
        note: '',
      };
      olcum.set(k, o);
    }
    o.clusters += 1;
    if (gun > o.scanDate) o.scanDate = gun;
    const wd = Number(u.window_days) || 0;
    // EN KISA pencere: kapsam, en dar olculen cluster'in kapsamidir.
    if (wd && (!o.windowDays || wd < o.windowDays)) o.windowDays = wd;
    if (u.measured === true || Number(u.measured) === 1) {
      o.olculen += 1;
      o.req += Number(u.req_total) || 0;
      o.services += Number(u.services_total) || 0;
    } else o.measured = false;
    if (!o.note && T(u.note)) o.note = T(u.note);
  }
  for (const o of olcum.values())
    o.reqShown = o.olculen > 0 && (o.req > 0 || o.measured) ? o.req : null;
  return olcum;
}

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
 * @param {object[]|null} discovery  dbo.BMW_Spa_Discovery (cluster basina EN YENI tarama)
 * @param {object[]|null} inventory  dbo.BMW_Openshift_Route_Inventory; null = OKUNAMADI
 *                                   (bos dizi ile ayni sey DEGIL: 'kayitli degil' denmez)
 * @param {object[]|null} usage      dbo.BMW_Application_Usage; null = OKUNAMADI
 * @param {object[]} [runs]          dbo.BMW_Spa_Discovery_Run (cluster basina EN YENI satir)
 * @param {object} [rpKaynak]        spa-rp.cjs kaynaklari; verilmezse RP 'olculemedi' der
 */
// ── UYGULAMA BASINA CLUSTER KAPSAMI (kullanici, 2026-10-06) ──────────────────────────
// "ARK'in prod/test/qa/dev cluster'lari zaten belli. Ilgili route hangi cluster'larda var
//  ise Kismi veya Tam olarak gosterilmeli. Ornegin eger 4 prod cluster'in 4'unde de varsa
//  4/4 Tam, 3'unde varsa 3/4 Kismi diye yazmali."
//
// PAYDA KATALOGDAN (ocp_cluster_index), elle cluster listesi YOK. Ve payda yalniz
// TARANABILEN cluster'lari sayar: uretimde 12 cluster `login` ile dusuyor (DNS cozulmuyor /
// 401 / timeout). Erisilemeyen bir cluster yuzunden "4/5 Kismi" demek UYDURMA bir eksiklik
// raporu olurdu - uygulama orada olabilir de olmayabilir de, BILMIYORUZ. Onlar paydaya
// girmez, ayri sayilir.
//
// `kismi` durumu TARANDI sayilir: route'lar cluster kapsaminda okundu ve route VARLIGI
// guvenilir; eksik olan servis -> is yuku eslemesidir (yetki). O cluster'i paydadan
// dusurmek, olculmus bir bilgiyi atmak olurdu.
function kapsamOrani(katalog, runs) {
  if (!Array.isArray(katalog)) return null; // OKUNAMADI: oran iddia edilmez
  const byCluster = new Map();
  const byEnv = new Map();
  for (const r of katalog) {
    const c = L(r.cluster_name);
    const env = T(r.env);
    if (!c || !env) continue;
    byCluster.set(c, env);
    if (!byEnv.has(L(env))) byEnv.set(L(env), new Set());
    byEnv.get(L(env)).add(c);
  }
  const olculen = new Set();
  const bakilamayan = new Set();
  for (const r of runs || []) {
    const c = L(r.cluster);
    if (!c) continue;
    if (['ok', 'kismi'].includes(L(r.durum))) olculen.add(c);
    else bakilamayan.add(c);
  }
  return { byCluster, byEnv, olculen, bakilamayan };
}

function buildSpaDiscovery(discovery, inventory, usage, runs, rpKaynak, katalog) {
  const envanterOkunamadi = !Array.isArray(inventory);
  const dynatraceOkunamadi = !Array.isArray(usage);
  // ENVANTER INDEKSI: (namespace, route) ve (namespace, adres) ayri ayri aranir - kesif
  // route ADINI, envanter bazen yalniz ADRESI tasiyor. Deger: route'un termination_type'i
  // (Ag capraz kontrolu; NULL ve '' ikisi de TLS yok). Kolon yoksa undefined: karsilastirilmaz.
  const envRoute = new Map();
  const envAdres = new Map();
  // AYNI CLUSTER ONCE: ayni (namespace, route) prod1/prod2'de ayri satirdir; termination
  // karsilastirmasi once ayni cluster'in satiriyla yapilir (ilk gelen satir yanlis celiski uretmesin).
  const envRouteC = new Map();
  for (const r of inventory || []) {
    const ns = L(r.namespace_name);
    if (!ns) continue;
    const tt = r.termination_type === undefined ? undefined : L(r.termination_type);
    const k1 = `${ns}|${L(r.route_name)}`;
    const k2 = `${ns}|${L(r.route_address)}`;
    if (r.route_name && !envRoute.has(k1)) envRoute.set(k1, tt);
    if (r.route_address && !envAdres.has(k2)) envAdres.set(k2, tt);
    if (r.route_name && r.cluster_name) envRouteC.set(`${L(r.cluster_name)}|${k1}`, tt);
    if (r.route_address && r.cluster_name) envRouteC.set(`${L(r.cluster_name)}|${k2}`, tt);
  }

  const olcum = olcumIndeksi(usage);

  // ROUTE'U SIFIRA INEN CLUSTER: son kosu 'ok' ve 0 route buldu; ekrandaki onceki satirlar
  // artik var olmayan route'lardir. Gosterilirlerse "KALIP KACIRDI" rozeti ve ozet sayilari
  // olmayan uygulamalari sayar (ikinci dogrulama turu).
  const sonDurum = new Map();
  for (const r of runs || []) sonDurum.set(T(r.cluster), r);
  const bosaldi = (d) => {
    const r = sonDurum.get(T(d.cluster));
    return !!(
      r &&
      T(r.durum) === 'ok' &&
      Number(r.routes) === 0 &&
      gunu(d.scan_date) < gunu(r.scan_date)
    );
  };

  // PLATFORM NAMESPACE'LERI KAPSAM DISI (kullanici, 2026-10-01): openshift-*, kube-*, default
  // altindaki route'lar konsol/oauth/monitoring gibi PLATFORM route'larudur, uygulama degil;
  // uxmid'in orada servis yetkisi de yok ve "namespace okunamadi" diye yanlis yonlendiriyordu.
  // Atlanir ama SAYILIR - sessizce dusurulmez.
  const platform = { routes: 0, namespaces: new Set() };
  const rows = (discovery || [])
    .filter((d) => !bosaldi(d))
    .filter((d) => {
      if (!platformNamespace(d.namespace)) return true;
      platform.routes += 1;
      platform.namespaces.add(L(d.namespace));
      return false;
    })
    .map((d) => {
      const ns = T(d.namespace);
      const app = uygulamaAdi(d);
      const u = olcum.get(`${L(ns)}|${L(app)}`) || null;
      const k1 = `${L(ns)}|${L(d.route)}`;
      const k2 = `${L(ns)}|${L(d.host)}`;
      // OKUNAMADI ile KAYITLI DEGIL AYRI: envanter sorgusu dustuyse null.
      const envVar = envanterOkunamadi ? null : envRoute.has(k1) || envAdres.has(k2);
      const c = L(d.cluster);
      const invTt = envRouteC.has(`${c}|${k1}`)
        ? envRouteC.get(`${c}|${k1}`)
        : envRouteC.has(`${c}|${k2}`)
          ? envRouteC.get(`${c}|${k2}`)
          : envRoute.has(k1)
            ? envRoute.get(k1)
            : envAdres.get(k2);
      // NULL KORUNUR (2026-10-01): '' = route'ta TLS yok ('diger'), NULL = bilinmiyor. Eski
      // T() ikisini de '' yapiyordu ve 'bilinmiyor' hic olusmuyordu.
      const termination = d.termination == null ? null : L(d.termination);
      const spa = Number(d.is_spa) === 1;
      const kalip = isSpaApp(app);
      return {
        cluster: T(d.cluster),
        namespace: ns,
        route: T(d.route),
        host: T(d.host),
        termination,
        // AG CAPRAZ KONTROLU: envanterdeki termination_type kesiftekiyle FARKLI. Yalniz uyari;
        // ag degeri kesiften gelir (cluster basina tarihli ve route duzeyinde tam).
        invTermination: invTt,
        agCelisik: invTt !== undefined && termination != null && invTt !== termination,
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
        reqShown: u ? u.reqShown : null,
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
  const coverage = kapsam(runs, veriGunu);
  const apps = uygulamalar(rows, coverage, { dynatraceOkunamadi, oran: kapsamOrani(katalog, runs) });
  // RP KOLONLARI: indeks platform haric TUM route satirlarindan kurulur (yalniz SPA'lardan
  // degil) - proxy hedefi SPA olmayan bir route'a da gidebilir, dogru uygulamaya baglanmali.
  const rp = rpUygula({
    rows,
    apps,
    inventory: envanterOkunamadi ? null : inventory,
    kaynak: rpKaynak,
  });
  const out = {
    rows,
    apps,
    appSummary: uygulamaOzeti(apps),
    // UST BANT: RP kaynaklarinin tarihleri, tablo durumlari, taranan hostlar ve 'olculemedi'
    // nin nereden geldigi. Ek sorgu yok; yukaridaki sonuclardan turetilir.
    rpKapsam: { ...rp.kapsam, envanterOkunamadi, dynatraceOkunamadi },
    platformHidden: { routes: platform.routes, namespaces: platform.namespaces.size },
    namespaces: [...new Set(apps.map((a) => a.namespace).filter(Boolean))].sort(),
    coverage,
    clusters: [...new Set(rows.map((r) => r.cluster).filter(Boolean))].sort(),
    envs: [...new Set(rows.map((r) => r.env).filter(Boolean))].sort(),
    summary: {
      routes: rows.length,
      spa: spaSatir.length,
      notSpa: say((r) => !r.isSpa && !r.note),
      // EKRANIN SEBEBI: ad kalibinin kacirdiklari.
      patternMiss: say((r) => r.patternMiss),
      patternFalse: say((r) => r.patternFalse),
      // ENVANTER FARKI: gercekten SPA ama route envanterinde YOK. Envanter okunamadiysa
      // (inInventory null) "yok" diye SAYILMAZ.
      spaNotInInventory: spaSatir.filter((r) => r.inInventory === false).length,
      // SINYAL KIRILIMI: iki sinyal ayri sayilir, biri otekinden zayiftir.
      bySignal: spaSatir.reduce((m, r) => {
        const k = r.signal || 'bilinmiyor';
        m[k] = (m[k] || 0) + 1;
        return m;
      }, {}),
      // OLCUM: kac SPA'nin trafigi var. "olculemedi" AYRI sayilir.
      trafficActive: spaSatir.filter((r) => r.reqShown != null && r.reqShown > 0).length,
      // Dynatrace servisi OLUSMAMIS (services_total=0) satir measured=1, req=0 yazilir;
      // "istek yok" degil "servis yok" - ayri sayilir.
      trafficIdle: spaSatir.filter((r) => r.reqShown === 0 && r.usage.services !== 0).length,
      trafficNoService: spaSatir.filter((r) => r.reqShown === 0 && r.usage.services === 0).length,
      // Olcum denendi ama sonuc yok (cluster'larin biri olculemedi ve gorulen istek yok).
      trafficUnmeasured: spaSatir.filter((r) => r.usage && r.reqShown == null).length,
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
  // AYRINTI (uygulama -> RP tanimlari + tanim basina trafik) YANITA GIRMEZ: satira gommek
  // yaniti 8 MB onbellek sinirinin ustune tasirdi. Sayilamaz alan: JSON'a hic yazilmaz,
  // /spa-discovery/rp ucu bunu kullanir.
  Object.defineProperty(out, 'rpDetay', { value: rp.detay, enumerable: false });
  return out;
}

/** Uygulama satirindaki Dynatrace ozeti: yalniz ipucunda gosterilen alanlar. */
function kisaUsage(u) {
  const o = { scanDate: u.scanDate, windowDays: u.windowDays, services: u.services };
  if (u.note) o.note = u.note;
  // Cluster'larin yalniz bir kismi olculduyse ipucunda yazilir ('olculen/toplam').
  if (u.olculen < u.clusters) o.olcum = `${u.olculen}/${u.clusters}`;
  return o;
}

/**
 * AG (kullanici karari K1, 2026-10-01): route TLS termination'indan.
 *   passthrough -> internet, reencrypt -> intranet, ikisi birden -> karisik (RP internet gibi
 *   aranir, ayrica GORUNUR - Denetim bunu internet sayip gizliyor), yalniz edge/TLS'siz ->
 *   diger (siniflanmaz, RP aranmaz), yalniz NULL -> bilinmiyor.
 * Route BIR KEZ sayilir (ayni route birden cok is yukune eslesip cok satir uretebilir).
 * @param {Map<string, string|null>} term  'cluster|route' -> termination
 */
function agKarari(term) {
  const s = { passthrough: 0, reencrypt: 0, edge: 0, tlsYok: 0, bos: 0 };
  for (const t of term.values()) {
    if (t == null) s.bos += 1;
    else if (t === '') s.tlsYok += 1;
    else if (t === 'passthrough' || t === 'reencrypt') s[t] += 1;
    else s.edge += 1;
  }
  const ag =
    s.passthrough && s.reencrypt
      ? 'karisik'
      : s.passthrough
        ? 'internet'
        : s.reencrypt
          ? 'intranet'
          : s.edge || s.tlsYok
            ? 'diger'
            : 'bilinmiyor';
  // Yalniz sifirdan buyuk anahtarlar (yanit boyutu).
  const agSay = {};
  for (const [k, v] of Object.entries(s)) if (v) agSay[k] = v;
  return { ag, agSay };
}

/**
 * UYGULAMA BASINA TEK SATIR (kullanici, 2026-10-01): "her uygulama icin tek satir olsun;
 * route adresleri ve cluster isimleri ayni satira yazilsin; is yuku kolonuna gerek yok."
 *
 * Anahtar (namespace, uygulama): ayni uygulama birden cok cluster'da / route'ta olabilir.
 * Kararlar route'lardan TURETILIR, uydurulmaz:
 *   spa      'evet'       en az bir route'un ardinda nginx bulundu
 *            'hayir'      route'lar eslesti ve hicbirinde nginx yok
 *            'bilinmiyor' HICBIR route eslesmedi (olculemedi - "SPA degil" DEMEK DEGIL)
 *   istek    'var' | 'yok' | 'servis-yok' | 'olculemedi' | 'olcum-yok'  (Dynatrace)
 *   envanter 'kayitli' | 'kayitli-degil' | 'kismen' | 'olculemedi'  (route envanteri)
 *   ag       'internet' | 'intranet' | 'karisik' | 'diger' | 'bilinmiyor' (agKarari)
 *   agEnvanter 'uyumlu' | 'celisik' | 'envanterde-yok' | 'olculemedi' (ag degerini EZMEZ)
 * @param {{dynatraceOkunamadi?: boolean}} [opt]  Dynatrace sorgusu dustuyse TUM satirlar
 *   'olculemedi' (eskiden 'olcum-yok' gorunuyordu: okunamadi ile olcum yok karisiyordu).
 */
function uygulamalar(rows, coverage, opt = {}) {
  const eski = new Map((coverage?.clusters || []).map((c) => [c.cluster, c]));
  const oran = opt.oran || null;
  const m = new Map();
  for (const r of rows) {
    const k = `${L(r.namespace)}|${L(r.application)}`;
    let a = m.get(k);
    if (!a) {
      a = {
        application: r.application,
        namespace: r.namespace,
        env: r.env,
        hosts: new Set(),
        routes: new Set(),
        clusters: new Set(),
        signals: new Set(),
        matchBy: new Set(),
        notes: new Set(),
        routeCount: 0,
        spaRoutes: 0,
        unmatchedRoutes: 0,
        invRoutes: 0,
        invOkunamadi: false,
        // AG: route basina BIR KEZ ('cluster|route' -> termination / envanter karsilastirmasi)
        term: new Map(),
        invBulundu: new Set(),
        invKiyas: new Set(),
        invCelisik: new Set(),
        patternMatch: r.patternMatch,
        usage: r.usage,
        reqShown: r.reqShown,
      };
      m.set(k, a);
    }
    const rk = `${r.cluster}|${r.route}`;
    if (!a.term.has(rk)) a.term.set(rk, r.termination === undefined ? null : r.termination);
    if (r.inInventory === null) a.invOkunamadi = true;
    if (r.inInventory) {
      a.invBulundu.add(rk);
      if (r.invTermination !== undefined && r.termination != null) a.invKiyas.add(rk);
      if (r.agCelisik) a.invCelisik.add(rk);
    }
    a.routeCount += 1;
    if (r.host) a.hosts.add(r.host);
    if (r.route) a.routes.add(r.route);
    if (r.cluster) a.clusters.add(r.cluster);
    if (r.isSpa) {
      a.spaRoutes += 1;
      if (r.signal) a.signals.add(r.signal);
    }
    if (r.matchBy) a.matchBy.add(r.matchBy);
    if (r.note) {
      a.unmatchedRoutes += 1;
      a.notes.add(r.note);
    }
    if (r.inInventory) a.invRoutes += 1;
  }
  const out = [...m.values()].map((a) => {
    const spa =
      a.spaRoutes > 0 ? 'evet' : a.unmatchedRoutes === a.routeCount ? 'bilinmiyor' : 'hayir';
    const clusters = [...a.clusters].sort();
    // CLUSTER KAPSAMI: payda ortamin katalogdaki TARANABILEN cluster'lari (bkz. kapsamOrani).
    // Ortam tek bir cluster ortamina cozulemiyorsa oran iddia EDILMEZ.
    let kapsamDurum = 'olculemedi';
    let kapsamVar = 0;
    let kapsamToplam = 0;
    let kapsamBakilamayan = 0;
    if (oran) {
      const ortamlar = [...new Set(clusters.map((c) => oran.byCluster.get(L(c))).filter(Boolean))];
      if (ortamlar.length === 1) {
        const envC = [...(oran.byEnv.get(L(ortamlar[0])) || [])];
        kapsamToplam = envC.filter((c) => oran.olculen.has(c)).length;
        kapsamVar = clusters.filter((c) => envC.includes(L(c)) && oran.olculen.has(L(c))).length;
        kapsamBakilamayan = envC.filter((c) => oran.bakilamayan.has(c)).length;
        if (kapsamToplam > 0)
          kapsamDurum = kapsamVar >= kapsamToplam ? 'tam' : kapsamVar > 0 ? 'kismi' : 'yok';
      }
    }
    const { ag, agSay } = agKarari(a.term);
    // ENVANTER CAPRAZ KONTROLU (ag'i EZMEZ): okunamadi > celisik > uyumlu > envanterde yok.
    // Envanterde bulunup termination_type kolonu gelmeyen route karsilastirilamaz.
    const agEnvanter = a.invOkunamadi
      ? 'olculemedi'
      : a.invCelisik.size
        ? 'celisik'
        : a.invKiyas.size
          ? 'uyumlu'
          : a.invBulundu.size
            ? 'olculemedi'
            : 'envanterde-yok';
    const istek = opt.dynatraceOkunamadi
      ? 'olculemedi'
      : a.reqShown != null
        ? a.reqShown > 0
          ? 'var'
          : a.usage.services === 0
            ? 'servis-yok'
            : 'yok'
        : a.usage && !a.usage.measured
          ? 'olculemedi'
          : 'olcum-yok';
    const ek = {};
    if (a.invCelisik.size) ek.agCelisikRoute = a.invCelisik.size;
    return {
      application: a.application,
      namespace: a.namespace,
      env: a.env,
      // "4/4 Tam" / "3/4 Kismi" / "olculemedi". Erisilemeyen cluster paydaya GIRMEZ,
      // `kapsamBakilamayan` ile AYRICA gorunur.
      kapsamDurum,
      kapsamVar,
      kapsamToplam,
      kapsamBakilamayan,
      spa,
      // KANIT: nginx-start.sh (guclu) / image (zayif). Yalniz 'ad' eslesmesiyle bulunduysa
      // (servis okunamadi, ayni adli is yukune dusuldu) kanit zayiftir ve oyle gosterilir.
      signals: [...a.signals].sort(),
      weakEvidence: spa === 'evet' && a.matchBy.size > 0 && !a.matchBy.has('selector'),
      // AD KALIBI: uygulama adi `-app-v` / `-app-emb-v` kuralina uyuyor mu. Gercekten SPA
      // olup UYMAYANLAR eski (ada dayali) yontemle bulunamiyordu - sayfanin varlik sebebi.
      pattern: a.patternMatch ? 'uyuyor' : 'uymuyor',
      patternMiss: spa === 'evet' && !a.patternMatch,
      patternFalse: spa === 'hayir' && a.patternMatch,
      istek,
      reqShown: a.reqShown,
      // YANIT BOYUTU: req (= reqShown) ve measured (istek'ten okunur) tekrarlanmaz; bos not
      // yazilmaz. Ipucunda gosterilen alanlar kalir.
      usage: a.usage ? kisaUsage(a.usage) : null,
      ag,
      agSay,
      agEnvanter,
      ...ek,
      inventory: a.invOkunamadi
        ? 'olculemedi'
        : a.invRoutes === a.routeCount
          ? 'kayitli'
          : a.invRoutes === 0
            ? 'kayitli-degil'
            : 'kismen',
      invRoutes: a.invRoutes,
      routeCount: a.routeCount,
      hosts: [...a.hosts].sort(),
      routes: [...a.routes].sort(),
      clusters,
      // ESKI VERI: bu cluster'in son kosusu basarisiz, satir onceki bir kosudan.
      staleClusters: clusters.filter((c) => eski.get(c)?.stale),
      notes: [...a.notes].sort(),
    };
  });
  const SPA_SIRA = { evet: 0, bilinmiyor: 1, hayir: 2 };
  out.sort(
    (a, b) =>
      SPA_SIRA[a.spa] - SPA_SIRA[b.spa] ||
      Number(b.patternMiss) - Number(a.patternMiss) ||
      a.namespace.localeCompare(b.namespace) ||
      a.application.localeCompare(b.application),
  );
  return out;
}

/** Uygulama duzeyinde ozet: ust bantta ve suzgec seceneklerinde sayilar. */
function uygulamaOzeti(apps) {
  const say = (f) => apps.filter(f).length;
  const spa = apps.filter((a) => a.spa === 'evet');
  return {
    apps: apps.length,
    spa: spa.length,
    notSpa: say((a) => a.spa === 'hayir'),
    unknown: say((a) => a.spa === 'bilinmiyor'),
    patternMiss: say((a) => a.patternMiss),
    patternFalse: say((a) => a.patternFalse),
    spaRequestActive: spa.filter((a) => a.istek === 'var').length,
    spaRequestIdle: spa.filter((a) => a.istek === 'yok').length,
    // Dynatrace servisi yok: "istek yok" DEGIL (statik SPA'nin pod'u istek almayabilir).
    spaRequestNoService: spa.filter((a) => a.istek === 'servis-yok').length,
    spaRequestUnknown: spa.filter((a) => a.istek === 'olculemedi' || a.istek === 'olcum-yok')
      .length,
    // Envanter okunamadiysa 'olculemedi': "kayitli degil" diye SAYILMAZ.
    spaNotInInventory: spa.filter(
      (a) => a.inventory === 'kayitli-degil' || a.inventory === 'kismen',
    ).length,
    // AG / RP / RP ISTEGI kirilimlari (yalniz SPA'lar; RP kolonlari zaten yalniz onlar icin).
    spaAg: kirilim(spa, 'ag'),
    spaRp: kirilim(spa, 'rp'),
    spaRpIstek: kirilim(spa, 'rpIstek'),
  };
}

/** apps -> { deger: sayi } (yalniz gorulen degerler). */
function kirilim(apps, alan) {
  const m = {};
  for (const a of apps) {
    const v = a[alan];
    if (v) m[v] = (m[v] || 0) + 1;
  }
  return m;
}

/**
 * YANIT GOVDESINDE YAZILMAYAN VARSAYILANLAR (dogrulama bulgusu, 2026-10-01: gercekci profilde
 * /spa-discovery 8 MB onbellek sinirini asiyordu). Istemci (src/api/nginxConsoleApi.ts
 * SPA_YANIT_VARSAYILAN / SPA_YANIT_BOS_DIZI, spaYanitDoldur) eksik alani AYNI degerle geri
 * doldurur - iki liste birlikte degismeli (SR27 bekcisi esitler; doldurma olmadan ekran
 * `a.staleClusters.includes` uzerinde cokuyor ve rp alani olmayan satir 'olculemedi'
 * gorunuyordu - vitest NginxSpaDiscovery.test.tsx).
 * Bellekteki tam nesne DEGISMEZ (testler, ayrinti ucu ve ozet onu kullanir).
 */
const YANIT_VARSAYILAN = Object.freeze({
  rp: 'uygulanamaz',
  rpIstek: 'uygulanamaz',
  agEnvanter: 'uyumlu',
  weakEvidence: false,
  patternMiss: false,
  patternFalse: false,
  usage: null,
  reqShown: null,
});
/** Bos oldugunda yazilmayan diziler (istemci [] doldurur). */
const YANIT_BOS_DIZI = new Set(['signals', 'staleClusters', 'notes', 'routes', 'hosts']);

/**
 * Uygulama satirinin HTTP govdesindeki kisa hali.
 *   - YANIT_VARSAYILAN'daki degerler ve bos diziler yazilmaz.
 *   - invRoutes/routeCount yalniz envanter 'kismen' iken anlamli (ekran yalniz orada yazar).
 *   - ADRESIN ICINDE GECEN route adlari yazilmaz: ekran adres varken route adini gostermez;
 *     arama icin de kayip yok - route adi bir adresin alt dizgisiyse, o adin her parcasi da
 *     adreste gecer. Adres yoksa route'lar OLDUGU GIBI kalir.
 */
function yanitUygulamasi(a) {
  const o = {};
  for (const [k, v] of Object.entries(a)) {
    if (Object.prototype.hasOwnProperty.call(YANIT_VARSAYILAN, k) && YANIT_VARSAYILAN[k] === v)
      continue;
    if (YANIT_BOS_DIZI.has(k) && Array.isArray(v) && !v.length) continue;
    o[k] = v;
  }
  if (a.inventory !== 'kismen') {
    delete o.invRoutes;
    delete o.routeCount;
  }
  if (o.routes && Array.isArray(a.hosts) && a.hosts.length) {
    const adres = a.hosts.map(L);
    const kalan = a.routes.filter((r) => !adres.some((h) => h.includes(L(r))));
    if (kalan.length) o.routes = kalan;
    else delete o.routes;
  }
  if (o.agSay && !Object.keys(o.agSay).length) delete o.agSay;
  return o;
}

/**
 * /spa-discovery HTTP GOVDESI: hesap sonucunu DEGISTIRMEDEN kisa kopyasini kurar (sonuc
 * nesnesi devam eden hesabi bekleyen baska cagrilarla paylasilir).
 * @param {object} sonuc  spaKesfiHesapla() ciktisi
 * @param {{satir?: boolean}} [opt]  satir: route satirlarini da gonder (?satir=1)
 */
function spaYanitGovdesi(sonuc, opt = {}) {
  const { rows, apps, ...govde } = sonuc;
  if (opt.satir) govde.rows = rows;
  if (Array.isArray(apps)) govde.apps = apps.map(yanitUygulamasi);
  return govde;
}

/** OpenShift platform namespace'i mi: openshift, openshift-*, kube-*, default. */
const PLATFORM_NS_RE = /^(openshift|kube)(-|$)|^default$/i;
const platformNamespace = (ns) => PLATFORM_NS_RE.test(T(ns));

module.exports = {
  buildSpaDiscovery,
  spaYanitGovdesi,
  yanitUygulamasi,
  YANIT_VARSAYILAN,
  YANIT_BOS_DIZI,
  olcumIndeksi,
  uygulamaAdi,
  notKovasi,
  platformNamespace,
  uygulamalar,
  agKarari,
};
