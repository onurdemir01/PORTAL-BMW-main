// server/audit/nginx-migration.cjs - Nginx SPA > "Production Tasimalari": eski GBRVP* sunucularinin
// proxy_pass hedefleri, yeni GBNGXP4x/5x sunucularinda DIZIN olarak var mi?
//
// SORU (kullanici, 2026-09-14): eski sunuculardaki location'larda tanimli proxy_pass
// uygulamalari yeni sunucularda /hysdeploy/<ns>/<app>/ ve
// /usr/nginx/applications/<ns>/<app>/ olarak bulunuyor mu?
//
// KAYNAKLAR (hepsi mevcut tablolar, yeni tablo YOK):
//   dbo.Nginx_Config_Audit  kind='proxy'  -> eski sunucu: vhost, location, upstream,
//                                            target_url (= proxy_ssl_name, route adresi)
//   dbo.Nginx_Audit_Upstreams             -> target_url bossa upstream'in server host'u
//   dbo.BMW_Openshift_Route_Inventory     -> route adresi -> namespace (KESIN eslesme)
//   dbo.Openshift_Inventory               -> (namespace, application) ciftleri (yedek cozum)
//   dbo.Nginx_Intranet_Audit              -> yeni sunucu: hys/app/conf dizin bayraklari
//                                            (tablo adi tarihsel; dizin taramasi HER
//                                            sunucuda kosar - bmw_nginx/nginx_config_audit)
//
// proxy_pass YAZIM BICIMLERI (kullanici, 2026-09-14) - dordu de gecerli:
//   proxy_pass https://<app>-<ns>.apps.fw.garanti.com.tr     (FQDN)
//   proxy_pass https://<app>-<ns>.apps.fw.garanti.com.tr/    (FQDN, yol)
//   proxy_pass https://<app>-<ns>                             (upstream blogu adi)
//   proxy_pass https://<app>-<ns>/                            (upstream blogu adi, yol)
// Tarayici sema/yol/portu attigi icin DB'de iki bicim kalir: FQDN ya da CIPLAK AD.
// Upstream adi her zaman <app>-<ns> DEGILDIR (takma ad olabilir: "onur", "pblc-cfa");
// o yuzden GERCEK arka uc su sirayla bulunur:
//   1) upstream blogunun server satiri (nginx_audit / Nginx_Audit_Upstreams)  - en kesin
//   2) location'daki proxy_ssl_name (target_url)                               - SNI adi
//   3) proxy_pass'teki adin kendisi (FQDN ya da ciplak <app>-<ns>)
//
// "-prod" EKI (kullanici, 2026-09-14): eski vhost'lardaki yazimda <Namespace> "-prod"
// EKSIZDIR (proxy_pass https://x-app-v1-digital-banking-ch/ -> gercek namespace
// digital-banking-ch-prod). Cozum once adi OLDUGU GIBI dener; tutmazsa "-prod"
// eklenmis halini dener ve bunu satirda isaretler (suffixAdded) - sessiz ek yok.
//
// HEDEF -> (namespace, uygulama) COZUMU: etiket <app>-<ns> kalibindadir ama hem app hem
// ns tire icerebilir; "nerede bolunur" belirsiz. Bu yuzden TAHMIN EDILMEZ:
//   (1) FQDN route envanterinde BIREBIR varsa namespace oradan, app = etiket - "-ns"
//   (2) ciplak ad / etiket, route envanterindeki bir adresin ILK ETIKETIYLE ayniysa
//       (ayni kesinlik: route adresleri kurumsal kalipta)
//   (3) OpenShift envanterindeki (ns, app) ciftlerinden etiketi birebir ureten(ler);
//       birden fazla ciftse "belirsiz", hicbiri yoksa "cozulemedi" - ikisi de ekranda
//       AYRI gorunur, sessizce dusmez.
//
// SPA OLMAYAN HEDEFLER: eski vhost'lar API/arka uc servislerine de proxy_pass yapar.
// Bunlar yeni sunucuda dizin olarak BEKLENMEZ (proxy ile tasinir); "-app-v/-app-emb-v"
// kalibina uymayanlar ayri listede gosterilir, "eksik" sayilmaz.
'use strict';

const SPA_RE = /-app(-emb)?-v/i;

// SPA KALIBI GENISLETILDI (kullanici, 2026-09-28: "SPA olmayan hedefler" listesini
// gosterip "bu tanimlari da olusturmamiz lazim" dedi).
//
// Eski kural yalnizca "-app-v" / "-app-emb-v" iceren adlari SPA sayiyordu. Ekipteki
// on yuz uygulamalarinin bir kismi bu ara eki TASIMIYOR ama surum ekini tasiyor:
//   non-core-assets-v0, doc-acceptance-frontend-v0, digital-fast-limit-cf-v0,
//   disney-bonus-cfa-v0, dlyd-prdct-rstrctring-v0, investor-dps-mngmnt-v0
// Bunlar envanterde (ns, app) olarak COZULUYOR ama ad kalibina takildiklari icin
// "SPA olmayan" listesine dusuyor, yani yeni sunucuda dizin BEKLENMIYOR ve "Tanim
// olustur" dugmesi hic cikmiyordu.
//
// YENI KURAL: uygulama adi SURUM EKIYLE bitiyorsa (-v0, -v1, ...) SPA'dir. Eski kalip
// KALDIRILMADI, uzerine EKLENDI - boylece bugun SPA sayilan hicbir satir listeden
// dusmez (ornegin "x-app-v0-y" gibi surum ekiyle BITMEYEN adlar).
//
// KABUL EDILEN RISK: gercekten API olan ama "-v1" ile biten bir servis de artik SPA
// sayilir ve ekranda "dizin eksik" gorunur. Yanlis alarm, sessiz kayip degil: tanim
// ancak kullanici dugmeye basarsa olusur. Tersi (gercek bir SPA'yi listeden dusurmek)
// tasimanin unutulmasi demekti.
//
// BU KURAL YALNIZ TASIMA EKRANINA AITTIR. route-stats.cjs ve denetim.cjs'teki SPA_RE
// kopyalari BILEREK dar kaldi: oradaki soru "bu route bir SPA mi" (siniflandirma),
// burada ise "bu hedef yeni sunucuda DIZIN ister mi" (tasima islemi). Farkli sorular.
const SPA_VER_RE = /-v\d+$/i;
/** Cozulmus uygulama adi yeni sunucuda dizin ister mi? */
const isSpaApp = (app) => {
  const a = String(app || '');
  return SPA_RE.test(a) || SPA_VER_RE.test(a);
};
// FQDN'in ilk etiketinde ("<app>-<ns>") surum eki ORTADA kalir: non-core-assets-v0-front-architecture
const SPA_LABEL_VER_RE = /-v\d+-/i;
/** Cozulememis hedefin ilk etiketi SPA kalibinda mi? */
const isSpaLabel = (label) => {
  const s = String(label || '');
  return SPA_RE.test(s) || SPA_LABEL_VER_RE.test(s);
};

/** Sabit tasima gruplari (kullanici verdi, 2026-09-14). */
const MIGRATION_GROUPS = [
  {
    id: 'glomo',
    label: 'Glomo',
    oldHosts: [
      'GBRVPP07',
      'GBRVPP08',
      'GBRVPP09',
      'GBRVPP10',
      'GBRVPAP03',
      'GBRVPAP04',
      'GBRVPAP05',
      'GBRVPAP06',
    ],
    newHosts: ['GBNGXP40', 'GBNGXP41', 'GBNGXP48', 'GBNGXP49', 'GBNGXAP34', 'GBNGXAP35'],
  },
  {
    id: 'other',
    label: 'Openbanking / Saklama / Webforms vb.',
    oldHosts: ['GBRVPP01', 'GBRVPP02', 'GBRVPAP01', 'GBRVPAP02'],
    newHosts: ['GBNGXP44', 'GBNGXP45', 'GBNGXP58', 'GBNGXP59', 'GBNGXAP32', 'GBNGXAP33'],
  },
];

const H = (h) =>
  String(h || '')
    .trim()
    .toUpperCase();
const L = (s) =>
  String(s || '')
    .trim()
    .toLowerCase();
const bit = (v) => v === true || v === 1 || v === '1';

/** "https://x.y:443/" ya da "x.y" -> "x.y" */
function hostOf(url) {
  let s = L(url);
  s = s.replace(/^[a-z]+:\/\//, '');
  s = s.split('/')[0];
  s = s.replace(/:\d+$/, '');
  return s;
}

/**
 * Hedef host adini (namespace, uygulama)'ya cozer.
 * @returns {{namespace:string|null, application:string|null, how:'route'|'inventory'|'ambiguous'|'unresolved', candidates?:string[]}}
 */
const PROD_SUFFIX = '-prod';

function resolveTarget(host, routeByAddress, ocpByLabel, routeByLabel = new Map()) {
  const h = L(host);
  if (!h) return { namespace: null, application: null, how: 'unresolved', suffixAdded: false };
  const dot = h.indexOf('.');
  const label0 = dot >= 0 ? h.slice(0, dot) : h;
  const rest = dot >= 0 ? h.slice(dot) : '';

  // Once oldugu gibi, sonra "-prod" eklenmis hali (eski yazimda ek yok).
  const tries = [{ label: label0, suffixAdded: false }];
  if (!label0.endsWith(PROD_SUFFIX)) tries.push({ label: label0 + PROD_SUFFIX, suffixAdded: true });

  let ambiguous = null;
  for (const { label, suffixAdded } of tries) {
    // (1) FQDN birebir, (2) ciplak ad = route adresinin ilk etiketi
    const ns = routeByAddress.get(label + rest) || routeByLabel.get(label);
    if (ns) {
      const suf = '-' + ns;
      if (label.endsWith(suf) && label.length > suf.length) {
        return {
          namespace: ns,
          application: label.slice(0, -suf.length),
          how: 'route',
          suffixAdded,
        };
      }
    }
    const cands = ocpByLabel.get(label) || [];
    if (cands.length === 1) {
      return {
        namespace: cands[0].namespace,
        application: cands[0].application,
        how: 'inventory',
        suffixAdded,
      };
    }
    if (cands.length > 1 && !ambiguous) {
      ambiguous = {
        namespace: null,
        application: null,
        how: 'ambiguous',
        suffixAdded,
        candidates: cands.map((c) => c.namespace + '/' + c.application),
      };
    }
  }
  return ambiguous || { namespace: null, application: null, how: 'unresolved', suffixAdded: false };
}

/** "app-ns.apps.fw.garanti.com.tr" -> "app-ns" (ciplak ad zaten etikettir). */
const labelOf = (host) => L(host).split('.')[0];

/**
 * Etiketten (ns, app) CIKARIR — envanterde karsiligi olmayan hedefler icin SON CARE.
 *
 * NEDEN TAHMIN DEGIL: "<app>-<ns>" kalibinda nerede bolunecegi genelde belirsizdir
 * (hem app hem ns tire icerir) — resolveTarget bu yuzden bilerek tahmin etmez. Ama SURUM
 * EKI (-v0, -v1…) bolme noktasini KESIN verir: surumden sonrasi namespace'tir.
 *   non-core-assets-v0-front-architecture -> non-core-assets-v0 + front-architecture-prod
 * Bu kural, envanterde COZULEBILEN 6 hedefte (digital-fast-limit-cf-v0, disney-bonus-cfa-v0,
 * dlyd-prdct-rstrctring-v0, doc-acceptance-frontend-v0, investor-dps-mngmnt-v0,
 * non-core-assets-v0) envanterin verdigi cevabin AYNISINI uretiyor — testte kilitlendi.
 *
 * YINE DE ENVANTER DEGILDIR: sonuc `how: 'fromName'` ile isaretlenir ve tasinacaklar
 * listesine girmez. "Ad boyle diyor" ile "envanterde var" ayni sey degil.
 */
function deriveFromName(host) {
  const m = /^(.*?-v\d+)-(.+)$/i.exec(labelOf(host));
  if (!m) return null;
  const application = m[1];
  const ns = m[2];
  return { namespace: ns.endsWith(PROD_SUFFIX) ? ns : ns + PROD_SUFFIX, application };
}

/** Cozum haritalari: route adresi/etiketi -> ns, "<app>-<ns>" -> [(ns, app)].
 *  buildMigration ve Denetim kapsam ucu (PROD proxy satirlari) ayni haritayi kullanir. */
function buildResolverMaps(routeRows, ocpRows) {
  // route adresi -> namespace (birebir)
  const routeByAddress = new Map();
  const routeByLabel = new Map(); // ilk etiket -> ns (ciplak upstream adi icin)
  for (const r of routeRows || []) {
    const a = hostOf(r.route_address);
    const ns = L(r.namespace_name);
    if (!a || !ns) continue;
    if (!routeByAddress.has(a)) routeByAddress.set(a, ns);
    const lbl = a.split('.')[0];
    if (lbl && !routeByLabel.has(lbl)) routeByLabel.set(lbl, ns);
  }
  // "<app>-<ns>" etiketi -> [(ns, app)] (yedek cozum)
  const ocpByLabel = new Map();
  for (const r of ocpRows || []) {
    const ns = L(r.namespace);
    const app = L(r.application);
    if (!ns || !app) continue;
    const label = app + '-' + ns;
    if (!ocpByLabel.has(label)) ocpByLabel.set(label, []);
    const arr = ocpByLabel.get(label);
    if (!arr.some((c) => c.namespace === ns && c.application === app))
      arr.push({ namespace: ns, application: app });
  }
  return { routeByAddress, routeByLabel, ocpByLabel };
}

/**
 * @param proxyRows    Nginx_Config_Audit kind='proxy' (host, vhost, service, location, upstream_name, target_url)
 * @param upstreamRows Nginx_Audit_Upstreams (host, name, server)
 * @param routeRows    BMW_Openshift_Route_Inventory (namespace_name, route_address)
 * @param ocpRows      Openshift_Inventory (namespace, application)
 * @param dirRows      Nginx_Intranet_Audit (host, namespace, application, hys_deployed, app_deployed, conf_exists)
 * @param newLocRows   Nginx_Config_Audit YENI sunucu satirlari (host, service, vhost, location):
 *                     spa include'u ya da proxy - "bu location yeni sunucuda TANIMLI mi" (2026-09-17,
 *                     kullanici ilerlemeyi location uzerinden takip ediyor)
 */
// YUK ALIYOR MU (2026-09-27, kullanici): "yuk alip almama gostergesini Production
// Tasimalari sayfasina da ekler misin? yuk alimini GBRVPP07-08-09-10 sunucularindan
// kontrol etmelisin."
//
// NEDEN ESKI SUNUCULAR: trafik su an ORADAN geciyor (Pendik yuku halen GBRVP*'lerde).
// Yeni sunuculara bakmak yanlis cevap verirdi - oralarda tanim yeni olustugu icin log
// bos ya da cok kisa, "yuk yok" gibi gorunurdu. Olcum, isin GERCEKTEN aktigi yerden
// alinir. Kaynak dbo.Nginx_Spa_Traffic (bmw_nginx/nginx_config_audit/files/
// nginx_spa_traffic.sh, hc.jsp/hc.html HARIC sayar).
//
// ANAHTAR (service, location): ayni tanim mirror sunucularda durur, sayilar TOPLANIR.
// Log okunamayan sunucu sayiya KATILMAZ ama "bilinmiyor" bayragini kaldirir - "yuk yok"
// demek DEGILDIR.
function trafficIndex(trafficRows, oldHostSet) {
  const idx = new Map();
  for (const r of trafficRows || []) {
    const host = H(r.host);
    if (oldHostSet && oldHostSet.size && !oldHostSet.has(host)) continue;
    const k = String(r.service || '').toUpperCase() + '|' + String(r.location || '');
    if (!idx.has(k))
      idx.set(k, {
        req24: 0,
        req7: 0,
        hc24: 0,
        hosts: 0,
        unknownHosts: 0,
        lastSeen: null,
        firstSeen: null,
        sampled: false,
      });
    const c = idx.get(k);
    if (r.error) {
      c.unknownHosts += 1;
      continue;
    }
    c.hosts += 1;
    c.req24 += Number(r.req_24h) || 0;
    c.req7 += Number(r.req_7d) || 0;
    c.hc24 += Number(r.hc_24h) || 0;
    if (r.sampled) c.sampled = true;
    const ls = r.last_seen ? String(r.last_seen) : null;
    if (ls && (!c.lastSeen || ls > c.lastSeen)) c.lastSeen = ls;
    // OLCULEN PENCERENIN BASI: mirror sunucular arasinda EN ESKI olan alinir - kapsam,
    // en kotu sunucunun kapsamidir. En yenisini almak "7 gun olctuk" demek olurdu.
    const fs = r.first_seen ? String(r.first_seen) : null;
    if (fs && (!c.firstSeen || fs < c.firstSeen)) c.firstSeen = fs;
  }
  return idx;
}

/** UC DURUM: active / idle / unknown. Ikiye indirmek yaniltirdi - olcememek "yuk yok"
 *  degildir. `sampled` ise req7 ALT SINIRDIR, "atil" demeden once soylenir. */
function trafficState(c) {
  if (!c || (c.hosts === 0 && c.unknownHosts === 0)) return null;
  if (c.hosts === 0) {
    return {
      state: 'unknown',
      req24: null,
      req7: null,
      hc24: null,
      lastSeen: null,
      firstSeen: null,
      sampled: false,
      hosts: 0,
      unknownHosts: c.unknownHosts,
    };
  }
  return {
    state: c.req7 > 0 ? 'active' : c.sampled ? 'unknown' : 'idle',
    req24: c.req24,
    req7: c.req7,
    hc24: c.hc24,
    lastSeen: c.lastSeen,
    firstSeen: c.firstSeen,
    sampled: c.sampled,
    hosts: c.hosts,
    unknownHosts: c.unknownHosts,
  };
}

function buildMigration({
  proxyRows,
  upstreamRows,
  routeRows,
  ocpRows,
  dirRows,
  newLocRows,
  trafficRows,
  groups = MIGRATION_GROUPS,
}) {
  const { routeByAddress, routeByLabel, ocpByLabel } = buildResolverMaps(routeRows, ocpRows);
  // yeni sunuculardaki location tanimlari: "SERVICE|location" -> Set(host)
  const newLoc = new Map();
  const newLocHosts = new Set();
  const locKey = (svc, loc) => String(svc || '').toUpperCase() + '|' + String(loc || '');
  for (const r of newLocRows || []) {
    const host = H(r.host);
    if (!host) continue;
    newLocHosts.add(host);
    const k = locKey(r.service || r.vhost, r.location);
    if (!newLoc.has(k)) newLoc.set(k, new Set());
    newLoc.get(k).add(host);
  }
  // (host, upstream adi) -> server host (target_url bos kaldiysa)
  const upsServer = new Map();
  for (const r of upstreamRows || []) {
    const k = H(r.host) + '|' + L(r.name);
    if (!upsServer.has(k)) upsServer.set(k, hostOf(r.server));
  }
  // yeni sunucu dizinleri: host -> "ns/app" -> bayraklar
  const dirs = new Map();
  const scannedHosts = new Set();
  for (const r of dirRows || []) {
    const host = H(r.host);
    if (!host) continue;
    scannedHosts.add(host);
    if (!dirs.has(host)) dirs.set(host, new Map());
    dirs.get(host).set(L(r.namespace) + '/' + L(r.application), {
      hys: bit(r.hys_deployed),
      app: bit(r.app_deployed),
      conf: bit(r.conf_exists),
    });
  }

  const out = [];
  for (const g of groups) {
    const oldSet = new Set(g.oldHosts.map(H));
    // Trafik YALNIZ bu grubun ESKI sunucularindan okunur: is su an oradan akiyor.
    const trafIdx = trafficIndex(trafficRows, oldSet);
    const apps = new Map(); // "ns/app" -> satir
    const nonSpa = new Map(); // hedef host -> satir
    const unresolved = new Map(); // hedef host -> satir

    for (const r of proxyRows || []) {
      const host = H(r.host);
      if (!oldSet.has(host)) continue;
      // proxy_pass'te yazan ad (FQDN ya da ciplak upstream adi) - ekranda "yazim" olarak gorunur
      const written = hostOf(r.upstream_name);
      const form = written ? (written.includes('.') ? 'fqdn' : 'upstream') : 'none';
      // Gercek arka uc: upstream server satiri > proxy_ssl_name > yazilan ad
      let target = upsServer.get(host + '|' + written) || '';
      let targetSource = 'upstream-server';
      if (!target) {
        target = hostOf(r.target_url);
        targetSource = 'proxy_ssl_name';
      }
      if (!target) {
        target = written;
        targetSource = 'proxy_pass';
      }
      const loc = String(r.location || '');
      const svc = String(r.service || r.vhost || '');
      const res = resolveTarget(target, routeByAddress, ocpByLabel, routeByLabel);

      const push = (map, key, extra) => {
        if (!map.has(key)) {
          map.set(key, {
            ...extra,
            target,
            targetSource,
            suffixAdded: res.suffixAdded === true,
            services: new Set(),
            oldHosts: new Set(),
            locations: new Set(),
            forms: new Set(),
            written: new Set(),
            paths: new Map(), // "SERVICE|location" -> {service, location, hosts:Set}
          });
        }
        const row = map.get(key);
        row.services.add(svc);
        row.oldHosts.add(host);
        row.locations.add(loc);
        row.forms.add(form);
        if (written) row.written.add(written);
        // "Tanim olustur" icin: hangi vhost (servis) + hangi context path. Ayni uygulama
        // birden fazla location'dan sunuluyorsa kullanici birini secer.
        const pk = svc + '|' + loc;
        if (!row.paths.has(pk))
          row.paths.set(pk, { service: svc, location: loc, hosts: new Set() });
        row.paths.get(pk).hosts.add(host);
      };

      if (res.namespace && res.application) {
        const key = res.namespace + '/' + res.application;
        if (!isSpaApp(res.application)) {
          push(nonSpa, key, {
            namespace: res.namespace,
            application: res.application,
            how: res.how,
          });
        } else {
          push(apps, key, { namespace: res.namespace, application: res.application, how: res.how });
        }
      } else if (isSpaLabel(labelOf(target))) {
        // ENVANTERDE YOK AMA ADI KONUSUYOR: hedef SPA kalibinda, ne route ne OpenShift
        // envanterinde karsiligi var. Satiri bos birakmak "bu neyin nesi" sorusunu ekibe
        // birakiyordu; ad kurumsal kalipta oldugu icin (<app>-<ns>.apps…) ns/app buradan
        // CIKARILABILIR. Cikarim DOGRULANMIS BIR ESLESME DEGILDIR ve oyle gosterilmez:
        // `how: 'fromName'` ile isaretlenir, ekran "addan cikarildi (envanterde yok)" der
        // ve satir TASINACAKLAR listesine GIRMEZ - uygulama kaldirilmis olabilir, olmayan
        // bir uygulama icin yeni sunucuda dizin acmak yanlis olurdu.
        const ad = deriveFromName(target);
        push(unresolved, target, {
          how: ad ? 'fromName' : res.how,
          namespace: ad ? ad.namespace : null,
          application: ad ? ad.application : null,
          candidates: res.candidates || [],
        });
      } else {
        // SPA kalibina uymayan ve cozulemeyen: API/arka uc olabilir - SPA-disi listede
        push(nonSpa, target, { namespace: null, application: null, how: res.how });
      }
    }

    const newHosts = g.newHosts.map(H);
    // Location yeni sunucularda tanimli mi: defined = HER yeni sunucuda, partial = bazisinda,
    // none = hicbirinde. Sadece taranmis (config audit satiri olan ya da dizin taramasi
    // gecmis) sunucular bilinir; hicbiri taranmadiysa 'not-scanned'.
    const newLocStatus = (svc, loc) => {
      const have = newLoc.get(locKey(svc, loc)) || new Set();
      const on = newHosts.filter((h) => have.has(h));
      const known = newHosts.filter((h) => newLocHosts.has(h) || scannedHosts.has(h));
      const status =
        known.length === 0
          ? 'not-scanned'
          : on.length === newHosts.length
            ? 'defined'
            : on.length === 0
              ? 'none'
              : 'partial';
      return { newHosts: on, newStatus: status };
    };
    const finish = (row) => ({
      ...row,
      services: [...row.services].sort(),
      oldHosts: [...row.oldHosts].sort(),
      locations: [...row.locations].sort(),
      locationCount: row.locations.size,
      // proxy_pass yazim bicim(ler)i: 'fqdn' | 'upstream'; ve yazilan ad(lar)
      forms: [...row.forms].sort(),
      written: [...row.written].sort(),
      paths: [...row.paths.values()]
        .map((x) => ({
          service: x.service,
          location: x.location,
          hosts: [...x.hosts].sort(),
          ...newLocStatus(x.service, x.location),
          traffic: trafficState(
            trafIdx.get(String(x.service).toUpperCase() + '|' + String(x.location)),
          ),
        }))
        .sort((a, b) => a.service.localeCompare(b.service) || a.location.localeCompare(b.location)),
    });

    const appRows = [...apps.values()].map((row) => {
      const key = row.namespace + '/' + row.application;
      const perHost = {};
      let readyHosts = 0;
      let scanned = 0;
      for (const nh of newHosts) {
        if (!scannedHosts.has(nh)) {
          perHost[nh] = null; // taranmadi
          continue;
        }
        scanned++;
        const f = dirs.get(nh).get(key) || { hys: false, app: false, conf: false };
        perHost[nh] = f;
        if (f.hys && f.app) readyHosts++;
      }
      // hazir: TARANAN her yeni sunucuda hys+app var. Taranmamis sunucu (2026-09-21: AP32-35 yeni
      // eklendi, ilk tarama gelene kadar) hazirligi ENGELLEMEZ — aksi halde tum liste "kismi"ye
      // dusup ozet %0 gosteriyordu; taranmayanlar grupta ayrica (newHostsScanned) gorunur.
      const status =
        scanned === 0
          ? 'not-scanned'
          : readyHosts === scanned
            ? 'ready'
            : readyHosts === 0
              ? 'missing'
              : 'partial';
      return { ...finish(row), perHost, readyHosts, scannedHosts: scanned, status };
    });
    const order = { missing: 0, partial: 1, 'not-scanned': 2, ready: 3 };
    appRows.sort(
      (a, b) => order[a.status] - order[b.status] || a.application.localeCompare(b.application),
    );

    // Servis basina location sayisi (eski sunucular; ayni tanim birden fazla sunucuda
    // olsa da BIR kez). SPA-disi ve cozulemeyen hedefler de dahil - vhost'un tamami.
    // Location ilerlemesi (2026-09-17): her location yeni sunucularda tanimli mi
    // (defined/partial/none/notScanned) - kullanici tasimayi location uzerinden izler.
    const serviceLocations = (() => {
      const m = new Map();
      for (const r of proxyRows || []) {
        if (!oldSet.has(H(r.host))) continue;
        const svc = String(r.service || r.vhost || '').toUpperCase() || '(bilinmiyor)';
        if (!m.has(svc)) m.set(svc, new Set());
        m.get(svc).add(String(r.location || ''));
      }
      return [...m.entries()]
        .map(([service, set]) => {
          const c = { defined: 0, partial: 0, none: 0, notScanned: 0 };
          for (const loc of set) {
            const st = newLocStatus(service, loc).newStatus;
            c[st === 'not-scanned' ? 'notScanned' : st]++;
          }
          return { service, locations: set.size, ...c };
        })
        .sort((a, b) => b.locations - a.locations || a.service.localeCompare(b.service));
    })();
    const locationTotals = { total: 0, defined: 0, partial: 0, none: 0, notScanned: 0 };
    for (const sl of serviceLocations) {
      locationTotals.total += sl.locations;
      locationTotals.defined += sl.defined;
      locationTotals.partial += sl.partial;
      locationTotals.none += sl.none;
      locationTotals.notScanned += sl.notScanned;
    }

    out.push({
      id: g.id,
      label: g.label,
      oldHosts: g.oldHosts.map(H),
      newHosts,
      newHostsScanned: newHosts.filter((h) => scannedHosts.has(h)),
      oldHostsSeen: [
        ...new Set((proxyRows || []).map((r) => H(r.host)).filter((h) => oldSet.has(h))),
      ].sort(),
      serviceLocations,
      apps: appRows,
      nonSpa: [...nonSpa.values()].map(finish).sort((a, b) => a.target.localeCompare(b.target)),
      unresolved: [...unresolved.values()]
        .map(finish)
        .sort((a, b) => a.target.localeCompare(b.target)),
      totals: {
        // location ilerlemesi (SPA + SPA-disi + cozulemeyen; vhost'un tamami)
        locations: locationTotals,
        apps: appRows.length,
        ready: appRows.filter((r) => r.status === 'ready').length,
        partial: appRows.filter((r) => r.status === 'partial').length,
        missing: appRows.filter((r) => r.status === 'missing').length,
        notScanned: appRows.filter((r) => r.status === 'not-scanned').length,
        nonSpa: nonSpa.size,
        unresolved: unresolved.size,
      },
    });
  }
  return out;
}

/**
 * Veritabanindan tasima gorunumunu yukler (Denetim ucu + "Tanim olustur" anti-tamper).
 * Her tablo KENDI son tarama gunuyle okunur (config audit ile nginx_audit ayri isler).
 * @param query           mssql query(text, inputs)
 * @param sql             mssql tip nesnesi
 * @param hasProxyColumns async () => boolean  (Nginx_Config_Audit kind/target_url DDL'i)
 */
async function loadMigration({ query, sql, hasProxyColumns }) {
  const { loadNamespaceOwners, ownersFor } = require('./ns-owners.cjs');
  const oldHosts = [...new Set(MIGRATION_GROUPS.flatMap((g) => g.oldHosts))];
  const newHosts = [...new Set(MIGRATION_GROUPS.flatMap((g) => g.newHosts))];
  const inList = (prefix, arr) => ({
    sqlText: arr.map((_, i) => `@${prefix}${i}`).join(', '),
    params: arr.map((h, i) => ({ name: `${prefix}${i}`, type: sql.NVarChar(64), value: h })),
  });
  const oldIn = inList('o', oldHosts);
  const newIn = inList('n', newHosts);

  // kind/target_url kolonlari DDL ile geldi; yoksa proxy satirlari hic yazilmamistir.
  if (hasProxyColumns && !(await hasProxyColumns())) {
    return {
      ok: true,
      ownersReady: false,
      proxyReady: false,
      dirsReady: false,
      proxyScanDate: null,
      dirScanDate: null,
      groups: buildMigration({
        proxyRows: [],
        upstreamRows: [],
        routeRows: [],
        ocpRows: [],
        dirRows: [],
      }),
    };
  }

  const [proxyDate, dirDate] = await Promise.all([
    query(`SELECT CONVERT(varchar(10), MAX(scan_date), 23) AS d FROM dbo.Nginx_Config_Audit`)
      .then((r) => r.recordset?.[0]?.d || null)
      .catch(() => null),
    query(`SELECT CONVERT(varchar(10), MAX(scan_date), 23) AS d FROM dbo.Nginx_Intranet_Audit`)
      .then((r) => r.recordset?.[0]?.d || null)
      .catch(() => null),
  ]);

  const [proxy, ups, routes, ocp, dirs, newLocs, traffic] = await Promise.all([
    proxyDate
      ? query(
          `SELECT host, vhost, service, location_path AS location, upstream_name, target_url
             FROM dbo.Nginx_Config_Audit
            WHERE scan_date = (SELECT MAX(scan_date) FROM dbo.Nginx_Config_Audit)
              AND kind = 'proxy' AND host IN (${oldIn.sqlText})`,
          oldIn.params,
        ).then((r) => r.recordset || [])
      : Promise.resolve([]),
    // nginx_audit (nginx -T) upstream server host'u. Tablo yoksa yedek yok, is durmaz.
    query(
      `SELECT host, name, server FROM dbo.Nginx_Audit_Upstreams
        WHERE scan_date = (SELECT MAX(scan_date) FROM dbo.Nginx_Audit_Upstreams)
          AND host IN (${oldIn.sqlText})`,
      oldIn.params,
    )
      .then((r) => r.recordset || [])
      .catch(() => []),
    query(`SELECT DISTINCT namespace_name, route_address FROM dbo.BMW_Openshift_Route_Inventory`)
      .then((r) => r.recordset || [])
      .catch(() => []),
    query(`SELECT DISTINCT namespace, application FROM dbo.Openshift_Inventory`)
      .then((r) => r.recordset || [])
      .catch(() => []),
    dirDate
      ? query(
          `SELECT host, namespace, application, hys_deployed, app_deployed, conf_exists
             FROM dbo.Nginx_Intranet_Audit
            WHERE scan_date = (SELECT MAX(scan_date) FROM dbo.Nginx_Intranet_Audit)
              AND host IN (${newIn.sqlText})`,
          newIn.params,
        ).then((r) => r.recordset || [])
      : Promise.resolve([]),
    // YENI sunuculardaki location tanimlari (spa include'u ya da proxy) - ilerleme
    // location uzerinden izlenir (2026-09-17). kind kolonu yoksa satirlarin hepsi spa'dir.
    proxyDate
      ? query(
          `SELECT host, service, vhost, location_path AS location
             FROM dbo.Nginx_Config_Audit
            WHERE scan_date = (SELECT MAX(scan_date) FROM dbo.Nginx_Config_Audit)
              AND host IN (${newIn.sqlText})`,
          newIn.params,
        )
          .then((r) => r.recordset || [])
          .catch(() => [])
      : Promise.resolve([]),
    // YUK OLCUMU (2026-09-27): trafik ESKI sunuculardan okunur - is su an oradan akiyor.
    // Tablo yoksa ekran eskisi gibi calisir, gosterge gorunmez (uydurma yapmaz).
    query(
      `SELECT host, service, env, location, req_24h, req_7d, hc_24h, sampled, last_seen, error,
              CASE WHEN COL_LENGTH('dbo.Nginx_Spa_Traffic', 'first_seen') IS NULL
                   THEN NULL ELSE first_seen END AS first_seen
         FROM dbo.Nginx_Spa_Traffic
        WHERE scan_date = (SELECT MAX(scan_date) FROM dbo.Nginx_Spa_Traffic)
          AND host IN (${oldIn.sqlText})`,
      oldIn.params,
    )
      .then((r) => r.recordset || [])
      .catch(() => []),
  ]);

  const groups = buildMigration({
    proxyRows: proxy,
    upstreamRows: ups,
    routeRows: routes,
    ocpRows: ocp,
    dirRows: dirs,
    newLocRows: newLocs,
    trafficRows: traffic,
  });
  const owners = await loadNamespaceOwners(query);
  for (const g of groups) {
    for (const a of g.apps) a.owner = ownersFor(owners.byNs, [a.namespace]);
  }
  return {
    ok: true,
    ownersReady: owners.ready,
    proxyReady: !!proxyDate,
    trafficReady: (traffic || []).length > 0,
    dirsReady: !!dirDate,
    proxyScanDate: proxyDate,
    dirScanDate: dirDate,
    groups,
  };
}

module.exports = {
  buildMigration,
  loadMigration,
  resolveTarget,
  buildResolverMaps,
  deriveFromName,
  isSpaApp,
  isSpaLabel,
  MIGRATION_GROUPS,
  SPA_RE,
  _hostOf: hostOf,
};
