// server/audit/nginx-app-routes.cjs — (namespace, uygulama) -> ROUTE ADRESI.
//
// NEDEN VAR (kullanici, 2026-10-06): "Artik Nginx Reverse Proxy tanimlari yeni yapiya uygun
// yapilmali. Ancak halen eski sunuculara deployment gidecek. Portaldan Reverse Proxy
// Production isteklerini yeni yapiya gore, yani namespace'e uygulama ismi alarak
// yaptirtmak istiyorum... eski sunuculara da sanki input URL gelmis gibi davranilmasi
// lazim. Ilgili namespace'e uygulamaya tanimli root'u bulup ona gore tanim yapilmasi
// gerekiyor."
//
// Bu modul, `bmw_nginx/nginx_ops/files/nginx_url_resolve.py` ile Portal'daki `resolveTarget()`
// (nginx-migration.cjs) ikilisinin TERSIDIR:
//   ileri  URL              -> (namespace, uygulama)   [yeni filoya tanim yazabilmek icin]
//   ters   (namespace, app) -> URL                     [ESKI sunuculara tanim yazabilmek icin]
//
// ESLEME KURALI ILERIYLE AYNI OLMAK ZORUNDA, bu yuzden ayni `appFromAddress()` kullanilir
// (route-stats.cjs'ten). Ayri bir kural yazilsa ikisi zamanla kayar: Portal bir URL verir,
// playbook o URL'i baska bir namespace'e cozer ve tanim yanlis yere gider.
//
// ── ESKI AKIS NEDEN HIC DEGISMIYOR ────────────────────────────────────────────────────
// `prod_create.yaml` (eski GBRVP* sunuculari) tamamen URL'e bagli: `upstream_host`'u
// input_url'den tureteiyor, namespace/application HIC okumuyor. Portal cozumu yapip
// `input_url`'i GERCEK bir route adresi olarak gonderdigi icin o akis aynen calisir -
// playbook tarafinda tek satir degisiklik gerekmez. Dahasi `nginx_ops.yml`'in yeni filo
// icin kostugu ileri cozumleme de duser: BIREBIR FQDN eslesmesi ilk adimda tutar, yani
// "birden fazla aday" (rc 91) durumuna hic girmez.
//
// ── COKLU ADAY: REDDEDILIR ────────────────────────────────────────────────────────────
// Bir uygulama ayni namespace'te BIRDEN FAZLA route yayinlayabilir (farkli hostname,
// farkli termination tipi). Kullanici karari (2026-10-06): coklu adayda OTOMATIK SECIM
// YAPILMAZ, adaylar listelenir ve isteyen secer. Gerekcesi: termination tipi uygulamanin
// AGINI belirliyor (passthrough=internet, reencrypt=intranet) - yanlisini secmek
// proxy_pass'i yanlis uca yazar. Ileri yon de ayni sekilde coklu adayda reddediyor
// (uretimde custody-management-app-v0 -> 12 namespace).
//
// ── ROUTE YOKSA: REDDEDILIR ───────────────────────────────────────────────────────────
// Envanterde karsiligi olmayan (ns, app) icin URL UYDURULMAZ (kullanici karari). Bos liste
// doner; Self Servis'in secenek kaynagi dogrulamasi (assertValueInSource) isi 400 ile
// durdurur. "Olculemedi != yok": sebep "route envanterinde kayit yok" diye yazilir, envanter
// isi (openshift_route_export) guncellenince tekrar denenir.
'use strict';

const { appFromAddress } = require('./route-stats.cjs');

const L = (v) =>
  String(v ?? '')
    .trim()
    .toLowerCase();

/** FQDN'in govdesi: sema ve yol atilir, kucuk harfe indirilir. */
function hostOf(v) {
  return L(v)
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
}

/** Route inventory satirlarindan (ns, app) -> aday adresler. SAF fonksiyon, test edilebilir.
 *
 * @param {object[]} routeRows dbo.BMW_Openshift_Route_Inventory satirlari
 *   (namespace_name, route_name, route_address, termination_type, cluster_name)
 * @param {string} namespace
 * @param {string} application
 * @returns {{adaylar: {url:string, routeName:string, termination:string, clusters:string[]}[],
 *            how: 'address'|'name'|null, suffixAdded: boolean}}
 */
function routesForApp(routeRows, namespace, application) {
  const app = L(application);
  if (!app) return { adaylar: [], how: null, suffixAdded: false };

  // `-prod` SONEKI: ileri yondeki resolveTarget ayni esnekligi gosteriyor (eski yazimda
  // namespace sonekli, route etiketinde eksik olabiliyor). Once TAM ad denenir; bos
  // donerse sonekli hali. Hangisinin tuttugu `suffixAdded` ile GORUNUR kalir - sessiz
  // bir esneklik, yanlis namespace'e tanim yazdirabilir.
  for (const [ns, suffixAdded] of [
    [L(namespace), false],
    [L(namespace) ? L(namespace) + '-prod' : '', true],
  ]) {
    if (!ns) continue;
    if (suffixAdded && ns === L(namespace)) continue;

    // ADRESTEN ve ROUTE ADINDAN eslesmeler BIRLIKTE toplanir (ikisi de o uygulamanin
    // gercek route'u; sadece KANIT guclerI farkli: adres = kurumsal kalip "<app>-<ns>.apps...",
    // ad = route objesinin adi uygulamayla ayni). Once "adres tuttuysa ada bakma" deniyordu;
    // o kural, adresi kaliba uymayan GERCEK bir ikinci route'u (or. ozel internet hostname'i,
    // passthrough) SESSIZCE gorunmez yapiyordu ve tek aday varmis gibi "cozuldu" donuyordu -
    // tam olarak kacinilmak istenen sessiz yanlis secim. Ayni URL ikisinden de tutarsa
    // GUCLU kanit (adres) yazilir.
    const gorulen = new Map(); // url -> aday
    // Namespace'teki TUM route adresleri (cluster yinelemeleri teklenmis): atfedilemeyen
    // route sayisini bundan cikaririz. Satir saymak yanlis olurdu - ayni route uc prod
    // cluster'inda uc satir olarak duruyor.
    const nsAdresler = new Set();
    for (const r of routeRows || []) {
      if (L(r.namespace_name) !== ns) continue;
      const url = hostOf(r.route_address);
      if (!url) continue;
      nsAdresler.add(url);
      const adresTutar = appFromAddress(url, ns) === app;
      const adTutar = L(r.route_name) === app;
      if (!adresTutar && !adTutar) continue;
      // AYNI ADRES BIRDEN FAZLA CLUSTER'DA: ayni cevaptir, coklu aday DEGIL.
      // (prod'da ns/app gbocpprod1/2/4'te birden duruyor.)
      const v = gorulen.get(url) || {
        url,
        routeName: String(r.route_name || '').trim(),
        termination: L(r.termination_type) || 'yok',
        clusters: [],
        how: 'name',
      };
      if (adresTutar) v.how = 'address';
      const c = String(r.cluster_name || '').trim();
      if (c && !v.clusters.includes(c)) v.clusters.push(c);
      gorulen.set(url, v);
    }
    if (gorulen.size) {
      const adaylar = [...gorulen.values()].sort((a, b) => a.url.localeCompare(b.url));
      for (const a of adaylar) a.clusters.sort();
      return {
        adaylar,
        // Kart/etiket icin: adaylarin TAMAMI adresten mi cozuldu, biri ada mi dayaniyor
        how: adaylar.every((a) => a.how === 'address') ? 'address' : 'name',
        suffixAdded,
        // ATFEDILEMEYEN ROUTE SAYISI GORUNUR KALIR: bu namespace'te ne adresi kaliba uyan
        // ne adi uygulamayla ayni olan route'lar varsa liste EKSIK olabilir. Envanterde
        // route -> service bagi YOK, o yuzden onlari bir uygulamaya atfetmek OLCULEMEZ;
        // sessiz gecmek "bu uygulamanin tek route'u var" izlenimi verirdi.
        atfedilmeyen: nsAdresler.size - gorulen.size,
      };
    }
  }
  return { adaylar: [], how: null, suffixAdded: false, atfedilmeyen: 0 };
}

/**
 * Tek bir URL'e COZULDU MU? Coklu aday ve kayit yok AYRI sonuclardir: ikisini "cozulemedi"
 * diye birlestirmek, kullaniciya "listeden sec" mi "envanteri guncelle" mi yapacagini
 * soylemezdi.
 *
 * @returns {{ok:true, url:string, how:string, suffixAdded:boolean, aday:object}
 *          |{ok:false, code:'no_route'|'ambiguous', adaylar:object[], message:string}}
 */
function resolveRouteForApp(routeRows, namespace, application) {
  const { adaylar, how, suffixAdded, atfedilmeyen } = routesForApp(
    routeRows,
    namespace,
    application,
  );
  if (!adaylar.length) {
    return {
      ok: false,
      code: 'no_route',
      adaylar: [],
      message:
        `${namespace}/${application} için route envanterinde (dbo.BMW_Openshift_Route_Inventory) ` +
        `kayıt yok. URL uydurulmaz: uygulama henüz deploy edilmemiş olabilir ya da envanter ` +
        `işi (openshift_route_export) güncel değil. Envanter tazelenince tekrar deneyin.`,
    };
  }
  if (adaylar.length > 1) {
    return {
      ok: false,
      code: 'ambiguous',
      adaylar,
      message:
        `${namespace}/${application} için ${adaylar.length} route var; hangisine tanım ` +
        `yapılacağını envanter söyleyemez (termination tipi uygulamanın ağını belirler). ` +
        `Listeden seçin: ` +
        adaylar.map((a) => `${a.url} (${a.termination})`).join(' · '),
    };
  }
  return {
    ok: true,
    url: adaylar[0].url,
    how,
    suffixAdded,
    aday: adaylar[0],
    // Tek aday bulundu AMA namespace'te atfedilemeyen route'lar da var: cevap "bu
    // uygulamanin TEK route'u bu" DEGIL, "atfedebildigimiz tek route bu"dur. Fark
    // ekranda soylenir (bkz. choice-sources 'ocp-app-routes' etiketi).
    atfedilmeyen: atfedilmeyen || 0,
  };
}

module.exports = { routesForApp, resolveRouteForApp, hostOf };
