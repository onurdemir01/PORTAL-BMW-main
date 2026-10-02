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

// SPA KALIBI TEK YERDE (2026-09-28): kural bes dosyada ayri ayri yaziliydi; genisletirken
// birini unutmak, ayni uygulamanin bir ekranda SPA, otekinde "SPA degil" gorunmesi demekti.
// Kuralin kendisi ve gerekcesi: server/audit/spa-pattern.cjs.
const { SPA_RE, isSpaApp, isSpaLabel, labelOf } = require('./spa-pattern.cjs');

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
// ── YUK OLCUMU: UC TUKETICININ ORTAK KURALI (2026-10-02) ──────────────────────────────
// Denetim > Nginx SPA (denetim.cjs /nginx-spa), Nginx ARK SPA Raporu (spa-report/index.cjs)
// ve Production Tasimalari (asagida buildMigration) dbo.Nginx_Spa_Traffic'i BU kuralla
// okur. Kural tek yerde: bir ekran "yuk almiyor", oteki "olculemedi" demesin.
//
// KESIN KURAL: "olculemedi" ile "yok" ASLA karismaz. Durum UC degerdir:
//   active   7 gun icinde hc DISI istek goruldu (bir sunucuda bile: yuk VAR)
//   idle     YALNIZ su dort kosulun HEPSI tutarsa: (1) tanimin durdugu HER sunucu olculdu
//            (log okunamayan ya da o gun satiri olmayan sunucu yok), (2) hicbirinde
//            sampled=1 yok, (3) olculen pencere HER sunucuda >= 7 gun, (4) pencere biliniyor
//   unknown  kalan her sey. req7 = 0 iken `kismi` NEDENI soyler:
//              pencere             olculen pencere < 7 gun ("son N gunde istek yok")
//              pencere-bilinmiyor  first_seen yok (eski analyzer: kolon yok / eski betik)
//              sampled             okunan veri 7 gunu kapsamiyor (butce / donmus dosya)
//              okunamayan-sunucu   bir sunucunun logu okunamadi (LOADERR)
//              satirsiz-sunucu     tanimin bir sunucusunun o gun olcum satiri yok
//
// NEDEN PENCERE: gunluk rotasyonlu hostlarda (bmw_disk_jobs nginx_log_rotate 'rotate 3')
// okuyucu TUM donmus dosyalari okur, veri yine 1-4 gun kalir ve sampled=0 basar (butce
// bitmedi). Eskiden durum `req7 > 0 ? active : sampled ? unknown : idle` idi: 1-4 gunluk
// olcum 7 gunluk "yuk yok" (atil / emekli adayi) gorunuyordu. Pencere = scan_date 00:00 -
// first_seen (spa-rp.cjs pencereSaat ile AYNI hesap; bekci: spa-traffic-pencere.test.cjs).
// Mirror sunucularda pencere EN DAR olanidir (en YENI first_seen): bir sunucu 1 gun
// gorduyse oteki 6 gun gormus olsa da kalan 5 gunde o sunucuya gelen istek bilinmez.
//
// SATIR TURLERI: host kipi satirlari (location '@...': uygulama basina vhost olcumu ve
// vhost '_' kovalari @_/@ip/@-) bu uc ekranin konusu DEGILDIR - burada tanim location
// yoludur ('/...'). O satirlar spa-rp.cjs'te (Gercek SPA Kesfi) dizin tanimlarina baglanir.
// SQL'de (spaTrafikSorgusu) ve JS'te (spaTrafikIndeksi) AYRI AYRI suzulur.
// Hata satiri (LOADERR) analyzer'da service/env/location NULL yazilir: (HOST, VHOST) ya da
// (HOST, '*' = betik basinda tarih hatasi) anahtariyla tutulur ve tanimin O sunucusunu
// olculemedi yapar. Eskiden SERVICE|ENV|location anahtarina yaziliyordu: anahtar '||' olup
// hicbir tanima ulasmiyor, okunamayan mirror sessizce yok sayiliyordu.

/** 7 gun: 'idle' (istek yok) diyebilmek icin olculen pencerenin alt siniri (saat). */
const PENCERE_TAM_SA = 7 * 24;

const gunu = (v) => {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

/** 'yyyymmddHHMMSS' -> epoch ms (spa-rp.cjs zamanMs ile ayni). */
function zamanMs(v) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(String(v == null ? '' : v).trim());
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/**
 * OLCULEN PENCERE (saat): scan_date 00:00 - first_seen. spa-rp.cjs pencereSaat ile BIREBIR
 * (oradan require EDILEMEZ: spa-rp.cjs bu dosyayi yukler, dongu olurdu). Bilinmiyorsa null.
 */
function pencereSaat(scanDate, firstSeen) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(gunu(scanDate));
  const ilk = zamanMs(firstSeen);
  if (!m || ilk == null) return null;
  const bas = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Math.max(0, Math.floor((bas - ilk) / 36e5));
}

/**
 * Tanim anahtari: SERVICE|ENV|location (Denetim + ARK). Config ve trafik satiri AYNI fonksiyon.
 * Location '^~ /x/' yaziliysa trafik betigi onu '/x/' olarak olcer (nginx_spa_traffic.sh onekleri
 * atar; spa-rp.cjs normLoc ile ayni): anahtar da oneksiz kurulur, yoksa o tanim HER GUN
 * "olcum yok" kalirdi (2026-10-02 dogrulama bulgusu). '=' / '~' location'lari betik olcmez.
 */
const spaTrafikAnahtari = (service, env, location) =>
  `${String(service || '').toUpperCase()}|${String(env || '').toUpperCase()}|${String(location || '').replace(/^\^~\s+(?=\/)/, '')}`;

/** Sema sorgusu: tablo var mi, first_seen kolonu var mi (tek gidis-donus). */
const SPA_TRAFIK_SEMA_SQL = `SELECT OBJECT_ID('dbo.Nginx_Spa_Traffic') AS trf,
       COL_LENGTH('dbo.Nginx_Spa_Traffic', 'first_seen') AS fs`;

/**
 * Nginx_Spa_Traffic okuma sorgusu (uc tuketici AYNI govde).
 *   - first_seen kolonu YOKSA NULL secilir. Kolonun adini yazmak sorguyu DERLEME aninda
 *     dusurur ('Invalid column name'); CASE WHEN COL_LENGTH(...) kalibi bunu ONLEMEZ.
 *   - scan_date pencere hesabi icin 'yyyy-mm-dd' olarak secilir.
 *   - host kipi satirlari ('@...') ALINMAZ (bkz. dosya ustu SATIR TURLERI).
 * @param {boolean} firstSeenVar  COL_LENGTH sonucu
 * @param {string} [ekKosul]      ' AND host IN (...)' gibi
 */
function spaTrafikSorgusu(firstSeenVar, ekKosul = '') {
  return `SELECT host, vhost, service, env, location, req_24h, req_7d, hc_24h, sampled, last_seen, error,
              ${firstSeenVar ? 'first_seen' : 'CAST(NULL AS NVARCHAR(20)) AS first_seen'},
              CONVERT(varchar(10), scan_date, 23) AS scan_date
         FROM dbo.Nginx_Spa_Traffic
        WHERE scan_date = (SELECT MAX(scan_date) FROM dbo.Nginx_Spa_Traffic)
          AND (location IS NULL OR location NOT LIKE '@%')${ekKosul}`;
}

/**
 * Trafik indeksi (location kipi).
 * @param {object[]} rows    Nginx_Spa_Traffic satirlari
 * @param {(r:object)=>string} keyOf  tuketicinin tanim anahtari (olcum satirindan)
 * @param {(host:string)=>boolean} [hostOk]  yalniz bu sunucular (Tasimalar: eski sunucular)
 * @returns {{ olcum: Map<string, Map<string, object>>, anahtarHata: Map<string, Map<string,string>>,
 *             hata: Map<string,string>, satir: number, hostKipi: number }}
 *   olcum        anahtar -> HOST -> o sunucunun toplami (pencereSaat: o sunucunun penceresi)
 *   anahtarHata  location'i DOLU hata satiri (anahtara ozel)
 *   hata         location'i BOS hata satiri (LOADERR): HOST|VHOST ya da HOST|*
 *   satir        alinan (location kipi) satir sayisi - "olcum var mi" bayragi buradan
 *   hostKipi     ATLANAN host kipi / kova satiri sayisi
 */
function spaTrafikIndeksi(rows, keyOf, hostOk) {
  const olcum = new Map();
  const anahtarHata = new Map();
  const hata = new Map();
  let satir = 0;
  let hostKipi = 0;
  for (const r of rows || []) {
    const host = H(r.host);
    if (!host) continue;
    if (hostOk && !hostOk(host)) continue;
    const loc = String(r.location == null ? '' : r.location).trim();
    // HOST KIPI / KOVA: hicbir location tanimina yazilmaz.
    if (loc.startsWith('@') || H(r.vhost) === '_') {
      hostKipi += 1;
      continue;
    }
    satir += 1;
    const err = String(r.error == null ? '' : r.error).trim();
    if (err && !loc) {
      const k = `${host}|${H(r.vhost) || '*'}`;
      if (!hata.has(k)) hata.set(k, err);
      continue;
    }
    const key = keyOf(r);
    if (err) {
      if (!anahtarHata.has(key)) anahtarHata.set(key, new Map());
      if (!anahtarHata.get(key).has(host)) anahtarHata.get(key).set(host, err);
      continue;
    }
    if (!olcum.has(key)) olcum.set(key, new Map());
    const m = olcum.get(key);
    const ls = r.last_seen ? String(r.last_seen) : null;
    const fs = r.first_seen ? String(r.first_seen).trim() || null : null;
    const p = pencereSaat(r.scan_date, fs);
    const o = m.get(host);
    if (!o) {
      m.set(host, {
        req24: Number(r.req_24h) || 0,
        req7: Number(r.req_7d) || 0,
        hc24: Number(r.hc_24h) || 0,
        sampled: bit(r.sampled),
        lastSeen: ls,
        firstSeen: p == null ? null : fs,
        pencereSaat: p,
      });
      continue;
    }
    // Ayni sunucuda ayni anahtara ikinci satir (iki vhost dosyasi): TOPLANIR, pencere EN DAR.
    o.req24 += Number(r.req_24h) || 0;
    o.req7 += Number(r.req_7d) || 0;
    o.hc24 += Number(r.hc_24h) || 0;
    o.sampled = o.sampled || bit(r.sampled);
    if (ls && (!o.lastSeen || ls > o.lastSeen)) o.lastSeen = ls;
    if (o.pencereSaat == null || p == null) {
      o.pencereSaat = null;
      o.firstSeen = null;
    } else if (p < o.pencereSaat) {
      o.pencereSaat = p;
      o.firstSeen = fs;
    }
  }
  return { olcum, anahtarHata, hata, satir, hostKipi };
}

/**
 * Bir tanimin yuk durumu (bkz. dosya ustu ORTAK KURAL).
 * @param {object} idx   spaTrafikIndeksi ciktisi (null = tablo yok/okunamadi -> null)
 * @param {string} key   tanim anahtari
 * @param {{host:string, vhost?:string}[]} [defs]  tanimin DURDUGU (host, vhost) ciftleri
 *        (config satirlari). Olcum satiri olmayan tanim sunucusu 'satirsiz-sunucu' olur;
 *        verilmezse yalniz satiri olan sunucular bilinir.
 * @returns {null|object} null = bu tanim icin HIC olcum yok (ekran "olcum yok" der)
 */
function spaTrafikDurumu(idx, key, defs) {
  if (!idx) return null;
  const olc = idx.olcum.get(key) || new Map();
  const kh = idx.anahtarHata.get(key) || new Map();
  const tanim = new Map(); // HOST -> Set(VHOST)
  for (const d of defs || []) {
    const h = H(d && d.host);
    if (!h) continue;
    if (!tanim.has(h)) tanim.set(h, new Set());
    tanim.get(h).add(H(d.vhost) || '*');
  }
  const hostlar = new Set([...tanim.keys(), ...olc.keys(), ...kh.keys()]);
  let hosts = 0;
  let unknownHosts = 0;
  let missingHosts = 0;
  let req24 = 0;
  let req7 = 0;
  let hc24 = 0;
  let sampled = false;
  let lastSeen = null;
  let firstSeen = null;
  let pencere = Infinity;
  for (const h of hostlar) {
    // OLCULEMEDI KAZANIR: ayni sunucu icin hem hata hem olcum gelirse emin olunmayan taraf.
    let err = kh.get(h) || idx.hata.get(`${h}|*`) || null;
    for (const v of tanim.get(h) || []) err = err || idx.hata.get(`${h}|${v}`) || null;
    if (err) {
      unknownHosts += 1;
      continue;
    }
    const o = olc.get(h);
    if (!o) {
      missingHosts += 1;
      continue;
    }
    hosts += 1;
    req24 += o.req24;
    req7 += o.req7;
    hc24 += o.hc24;
    sampled = sampled || o.sampled;
    if (o.lastSeen && (!lastSeen || o.lastSeen > lastSeen)) lastSeen = o.lastSeen;
    if (pencere === null || o.pencereSaat == null) {
      pencere = null;
      firstSeen = null;
    } else if (o.pencereSaat < pencere) {
      pencere = o.pencereSaat;
      firstSeen = o.firstSeen;
    }
  }
  if (!hosts) {
    if (!unknownHosts) return null;
    return {
      state: 'unknown',
      req24: null,
      req7: null,
      hc24: null,
      lastSeen: null,
      firstSeen: null,
      pencereSaat: null,
      sampled: false,
      hosts: 0,
      unknownHosts,
      missingHosts,
    };
  }
  const kismi = [];
  if (req7 === 0) {
    if (unknownHosts) kismi.push('okunamayan-sunucu');
    if (missingHosts) kismi.push('satirsiz-sunucu');
    if (sampled) kismi.push('sampled');
    if (pencere == null) kismi.push('pencere-bilinmiyor');
    else if (pencere < PENCERE_TAM_SA) kismi.push('pencere');
  }
  const o = {
    state: req7 > 0 ? 'active' : kismi.length ? 'unknown' : 'idle',
    req24,
    req7,
    hc24,
    lastSeen,
    firstSeen,
    pencereSaat: pencere,
    sampled,
    hosts,
    unknownHosts,
    missingHosts,
  };
  if (kismi.length) o.kismi = kismi;
  return o;
}

/**
 * Birden cok tanimin (ayni hucredeki location'lar) yuk durumu: bir location bile yuk
 * aliyorsa ACTIVE; biri olculemediyse UNKNOWN; ancak HEPSI idle ise IDLE. Sayilar olculen
 * tanimlardan toplanir, pencere en dar olanidir. Tek tanimda girdiyi aynen dondurur.
 *
 * OLCULMEYEN LOCATION (2026-10-02 dogrulama bulgusu): listedeki null = trafik tablosu VAR ama
 * o tanimin hicbir sunucusundan o gun satir ya da hata yok (trafik adimi o sunucuda kosmadi /
 * async zaman asimi / location yazimi farkli, or. '^~ /b/'). Eskiden null ATILIYORDU: /a/ 7
 * gun olculmus 0 + /b/ hic olculmemis hucre "yuk yok - atil aday" gorunuyordu ("olculemedi"
 * ile "yok" karisiyordu). Artik en az bir location olculmusken null, hicbiri active degilse
 * sonucu UNKNOWN yapar (kismi 'satirsiz-sunucu', missingHosts o tanimin sunucu sayisi kadar
 * artar). HEPSI null ise null kalir (bu hucre icin hic olcum yok; tablo yoksa da boyle).
 * @param {(object|null)[]} list
 * @param {number[]} [tanimSunucu]  list[i] null ise o tanimin sunucu sayisi (en az 1 sayilir)
 */
function spaTrafikBirlesik(list, tanimSunucu) {
  const girdi = list || [];
  const xs = girdi.filter(Boolean);
  if (!xs.length) return null;
  let olculmeyen = 0;
  let olculmeyenSunucu = 0;
  girdi.forEach((t, i) => {
    if (t) return;
    olculmeyen += 1;
    olculmeyenSunucu += Math.max(1, Number(tanimSunucu && tanimSunucu[i]) || 0);
  });
  if (xs.length === 1 && !olculmeyen) return xs[0];
  const olculen = xs.filter((t) => t.hosts > 0);
  const top = (f) => (olculen.length ? olculen.reduce((a, t) => a + (Number(t[f]) || 0), 0) : null);
  const enCok = (f) => xs.reduce((a, t) => Math.max(a, Number(t[f]) || 0), 0);
  let pencere = olculen.length ? Infinity : null;
  let firstSeen = null;
  for (const t of olculen) {
    if (pencere === null || t.pencereSaat == null) {
      pencere = null;
      firstSeen = null;
    } else if (t.pencereSaat < pencere) {
      pencere = t.pencereSaat;
      firstSeen = t.firstSeen || null;
    }
  }
  const state = xs.some((t) => t.state === 'active')
    ? 'active'
    : olculmeyen || xs.some((t) => t.state === 'unknown')
      ? 'unknown'
      : 'idle';
  const o = {
    state,
    req24: top('req24'),
    req7: top('req7'),
    hc24: top('hc24'),
    lastSeen: xs.reduce((a, t) => (t.lastSeen && (!a || t.lastSeen > a) ? t.lastSeen : a), null),
    firstSeen,
    pencereSaat: pencere,
    sampled: xs.some((t) => t.sampled),
    hosts: enCok('hosts'),
    unknownHosts: enCok('unknownHosts'),
    missingHosts: enCok('missingHosts') + olculmeyenSunucu,
    locations: girdi.length,
  };
  if (state === 'unknown') {
    const k = new Set(xs.flatMap((t) => t.kismi || []));
    // Tamamen okunamayan bir location (hosts 0) da bu hucrenin 0'ini alt sinir yapar.
    if (xs.some((t) => t.state === 'unknown' && !t.hosts)) k.add('okunamayan-sunucu');
    // Hic olculmeyen location: tanimin sunucusunun o gun olcum satiri yok.
    if (olculmeyen) k.add('satirsiz-sunucu');
    if (k.size) o.kismi = [...k];
  }
  return o;
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
    // ANAHTAR (service, location): ayni tanim mirror sunucularda durur, sayilar TOPLANIR.
    // Kural (pencere, okunamayan/satirsiz sunucu): spaTrafikDurumu.
    const trafIdx = spaTrafikIndeksi(
      trafficRows,
      (r) => String(r.service || '').toUpperCase() + '|' + String(r.location || ''),
      (h) => !oldSet.size || oldSet.has(h),
    );
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
          row.paths.set(pk, { service: svc, location: loc, hosts: new Set(), defs: [] });
        row.paths.get(pk).hosts.add(host);
        // Yuk olcumu icin tanimin (host, vhost) ciftleri: o sunucunun logu okunamadiysa
        // (LOADERR host|vhost) ya da o gun satiri yoksa "istek yok" DENMEZ.
        row.paths.get(pk).defs.push({ host, vhost: r.vhost });
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
      } else if (isSpaLabel(target)) {
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
          traffic: spaTrafikDurumu(
            trafIdx,
            String(x.service).toUpperCase() + '|' + String(x.location),
            x.defs,
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

  const [proxyDate, dirDate, trfSema] = await Promise.all([
    query(`SELECT CONVERT(varchar(10), MAX(scan_date), 23) AS d FROM dbo.Nginx_Config_Audit`)
      .then((r) => r.recordset?.[0]?.d || null)
      .catch(() => null),
    query(`SELECT CONVERT(varchar(10), MAX(scan_date), 23) AS d FROM dbo.Nginx_Intranet_Audit`)
      .then((r) => r.recordset?.[0]?.d || null)
      .catch(() => null),
    // TRAFIK SEMASI: first_seen kolonu yoksa sorgu NULL secer (eskiden CASE WHEN COL_LENGTH
    // kalibi vardi; kolon yokken SQL Server onu da derleme aninda dusuruyor, catch [] donuyor
    // ve gosterge SESSIZCE kayboluyordu).
    query(SPA_TRAFIK_SEMA_SQL)
      .then((r) => r.recordset?.[0] || {})
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
    trfSema && trfSema.trf
      ? query(spaTrafikSorgusu(!!trfSema.fs, ` AND host IN (${oldIn.sqlText})`), oldIn.params)
          .then((r) => r.recordset || [])
          .catch(() => [])
      : Promise.resolve([]),
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
    // Host kipi / kova satirlari "olcum var" SAYILMAZ (bu ekranin tanimlari location yolu).
    trafficReady: spaTrafikIndeksi(traffic, () => '').satir > 0,
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
  // Yuk olcumu ortak kurali (denetim.cjs + spa-report/index.cjs + bu dosya).
  PENCERE_TAM_SA,
  pencereSaat,
  spaTrafikAnahtari,
  SPA_TRAFIK_SEMA_SQL,
  spaTrafikSorgusu,
  spaTrafikIndeksi,
  spaTrafikDurumu,
  spaTrafikBirlesik,
};
