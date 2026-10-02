// server/nginx-console/spa-rp.cjs - Gercek SPA Kesfi: "internet ise BIZIM reverse proxy
// sunucularimizda tanimli mi, o tanim istek aliyor mu?" (kullanici, 2026-10-01).
//
// SAF MODUL: veritabani yok. index.cjs sorgulari kosar, burasi eslestirir ve karar verir.
//
// KAYNAKLAR (hepsi mevcut tablolar):
//   dbo.Nginx_Config_Audit    LOC satirlari (kind spa/NULL: include -> application-confs)
//                             PRX satirlari (kind proxy: eski PROD proxy_pass -> route)
//   dbo.Nginx_Intranet_Audit  yeni PROD (GBNGXP4x/AP3x) dizin kurulumu (conf_exists)
//   dbo.Nginx_Audit_Upstreams upstream takma adinin gercek server'i (eski PROD)
//   dbo.Nginx_Spa_Traffic     RP access log sayimi, IKI KIP (nginx_spa_traffic.sh):
//     location kipi  location '/' ile baslar; anahtar (host, vhost, location)
//     host kipi      location '@' ile baslar (2026-10-02, yeni PROD): uygulama basina vhost
//                    (conf.d/<app>-<ns>.conf) ortak log'da Host/SNI ile sayilir; anahtar
//                    (host, vhost=<app>-<ns>); location = '@' + birincil server_name.
//                    vhost '_' satirlari KOVADIR (@_ eslesmeyen Host, @ip, @- alansiz) ve
//                    hicbir uygulamaya EKLENMEZ.
//
// KESIN KURAL: "olculemedi" ile "tanimsiz/yok" ASLA karismaz.
//   - 'tanimsiz' ancak ortamin beklenen RP hostlarinin TAMAMI o gunun taramasinda
//     goruldu, gerekli tablolar OKUNDU ve (PROD) proxy kolonlari VAR ise soylenir.
//   - sorgu dustu (null) -> 'olculemedi'; [] gibi davranip 'tanimsiz' uretmek YASAK.
//   - RP istegi 'yok' ancak olculebilir tanimlarin HEPSI olculmus, pencere >= 7 gun,
//     sampled=0 ve toplam 0 ise; kismi pencere 'kismi', olcum kaynagi olmayan 'kaynak-yok'.
//   - host kipinde tanimin vhost satiri YOKSA olculemedi (0 DEGIL); sunucuda hicbir
//     uygulamaya yazilamayan istek (kova) varsa 0 bir ALT SINIRDIR ('eslesmeyen-host').
//   - dizin tanimi yalniz KENDI '<app>-<ns>' vhost'una (ya da '-N' ekli conf_name'ine)
//     baglanir; ayni conf.d adina iki dizin satiri duserse tanim 'belirsiz' (ayrilamaz).
//
// ORTAM (kullanici karari K1, 2026-10-02): uygulama YALNIZ baska ortamin RP'sinde tanimliysa
// KENDI ortaminda tanimsiz sayilir (ortamin RP hostlari taranmadiysa olculemedi);
// 'baska ortamda tanimli' bilgisi rpSorun ORTAM_DISI + rpOrtamDisi (ortamlar) uyarisidir.
// KARISIK DURUM (K3, K1'in dogal uzantisi, 2026-10-02): uygulama hem kendi ortaminin hem
// baska ortamin RP'sinde tanimliysa satirdaki her karar ve sayi (rp, rpYol, rpHost, rpEsles,
// rpSorun durum kodlari, rpIstek, rpIstekNeden, rpReq7/24, rpSon, rpPencereSa, rpOlcum)
// YALNIZ kendi ortaminin tanimlarindan hesaplanir. Baska ortamin tanimi yalniz sunlari
// verir: rpSorun ORTAM_DISI + rpOrtamDisi uyarisi ve (olculmusse) rpReq7Disi BILGISI -
// rpReq7'ye EKLENMEZ, rpIstek kararini DEGISTIRMEZ (kendi tanimi olculemediyse 900 istek de
// 'olculemedi'yi kurtarmaz). Kendi ortaminda tanim yoksa rpIstek 'uygulanamaz' (gerekce:
// kendi ortaminin RP'sinde tanim yok); baska ortamin olculmus istegi yine rpReq7Disi'dir.
//
// KAPSAM (kullanici karari K4): RP kolonlari YALNIZ spa='evet' VE ag internet/karisik
// uygulamalar icin hesaplanir; digerleri 'uygulanamaz'.
//
// NEDEN MEVCUT COZUMLER YENIDEN KULLANILMIYOR: denetim.cjs ve nginx-migration.cjs proxy
// hedeflerini isSpaApp (ad kalibi) ile suzer; bu sayfanin asil bulgusu tam da ad kalibina
// UYMAYAN SPA'lar. Ayrica trafik anahtarlari (service|env|location) LOADERR satirini hic
// bulamaz: analyzer o satira service/env/location NULL yazar (nginx_audit_analyze.py).
// Burada anahtar (host, vhost, location); hata (host, vhost) ve (host, '*').
'use strict';

const { internetRpHosts, envOfHost } = require('../audit/nginx-hosts.cjs');
const { envOfNamespace, platformOfCluster } = require('../audit/ocp-platforms.cjs');
const {
  resolveTarget,
  buildResolverMaps,
  _hostOf: hostOf,
} = require('../audit/nginx-migration.cjs');

const L = (s) =>
  String(s == null ? '' : s)
    .trim()
    .toLowerCase();
const U = (s) =>
  String(s == null ? '' : s)
    .trim()
    .toUpperCase();
const T = (s) => String(s == null ? '' : s).trim();
const bit = (v) => v === true || v === 1 || v === '1';
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const ilkEtiket = (h) => L(h).split('.')[0];
const gunu = (v) => {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

/** 7 gun: RP isteginin 'yok' sayilabilmesi icin olculen pencerenin alt siniri (saat). */
const PENCERE_TAM_SA = 7 * 24;

/** Eslesme kaniti, GUCLUDEN ZAYIFA. Satirda en ZAYIF kullanilan yazilir. */
const ESLES_SIRA = ['kesin', 'ek-prod', 'ad', 'envanter', 'zayif', 'paylasimli', 'belirsiz'];

/**
 * UYGULAMAYA AYRILAMAYAN eslesmeler (dogrulama bulgusu, 2026-10-01):
 *   paylasimli  hedef host'u FARKLI route'lar paylasiyor (path tabanli route); tanim hangi
 *               route'a gidiyor bilinmez.
 *   belirsiz    ayni ad birden cok uygulamaya cozuluyor ('<app>-<ns>' bolme carpismasi).
 * Tanim baglanir ve satirda isaretlenir, ama trafigi bu uygulamanin "istek var/yok" kararina
 * KESIN olarak katilmaz: yalniz bu tur tanimlari olan uygulamada RP istegi 'ayrilamaz' olur;
 * baska tanimlar da varsa onlarin 0'i bir ALT SINIRDIR ('kismi').
 */
const AYRILAMAZ = new Set(['paylasimli', 'belirsiz']);

/** '-prod' eki denemesi YALNIZ PROD RP'lerinde yapilir (eski PROD yazim kurali; non-prod RP'de
 *  ciplak ad bir TEST/DEV uygulamasidir, PROD uygulamasina baglanmamali). */
const PROD_ROL = new Set(['prod-eski', 'prod-yeni']);

/**
 * Proxy hedefi bir UPSTREAM TAKMA ADI mi ('onur', 'pblc-cfa', '<app>-<ns>' upstream blogu):
 * nokta yok. Gercek arka uc ancak Nginx_Audit_Upstreams'ten bulunur; bulunamadiysa o tanim
 * kesifteki herhangi bir uygulamaya gidiyor olabilir. 'localhost' bizim uygulamamiz olamaz.
 */
const takmaAdMi = (h) => !!h && !h.includes('.') && h !== 'localhost';

/** Tanim var ama sorunlu: satirda rozet olarak gosterilir, 'tanimli'yi DUSURMEZ. */
const SORUNLU = new Set(['BROKEN_INCLUDE', 'NOT_DEPLOYED', 'NON_PROD_TARGET', 'MISSING_APP']);

/**
 * SATIRA YAZILABILEN KODLARIN TAMAMI (arayuz sozlugu). Ekran her kod icin KENDI etiketini
 * gostermeli: eksik etiket ya 'undefined' basar ya da yedek etikete ('olculemedi') duser ve
 * "uygulanamaz" bir satiri olculemedi diye gosterir (dogrulama bulgusu, 2026-10-01).
 * Bekci (spa-rp.test.cjs SR35): fixture'larda URETILEN her kod bu listede, listedeki her kod
 * en az bir fixture'da uretiliyor ve NginxSpaDiscovery.tsx sozluklerinde etiketi var.
 * rpNeden 'kod' ya da 'kod:ek' (ek: config | dizin | upstream) bicimindedir.
 */
const KODLAR = Object.freeze({
  rp: Object.freeze(['tanimli', 'tanimsiz', 'olculemedi', 'kapsam-disi', 'uygulanamaz']),
  rpIstek: Object.freeze([
    'var',
    'yok',
    'kismi',
    'olculemedi',
    'kaynak-yok',
    'ayrilamaz',
    'uygulanamaz',
  ]),
  rpNeden: Object.freeze([
    'ortam-yok',
    'rp-listesi-yok',
    'platform',
    'tablo-yok',
    'okunamadi',
    'tarih-farkli',
    'proxy-kolonu-yok',
    'host-taranmadi',
    'hedef-cozulemedi',
    'belirsiz',
  ]),
  rpIstekNeden: Object.freeze([
    'pencere',
    'eslesmeyen-host',
    'kaynak-yok',
    'ayrilamaz',
    'host-taranmadi',
  ]),
  // Satira yalniz 'kesin' DISINDAKILER yazilir (kesin = alan yok).
  rpEsles: ESLES_SIRA.slice(1),
  // Ayrinti paneli: tanim basina trafik 'olculemedi' nedeni (NginxSpaDiscovery.tsx TRAFIK_NEDEN).
  trafikNeden: Object.freeze([
    'tablo-yok',
    'okunamadi',
    'log',
    'location-tipi',
    'host',
    'satir-yok',
    'host-kipi-yok',
  ]),
});

/** Host kipi kova isaretleri (vhost '_'): uygulamaya EKLENMEZ, tanilama ve alt sinir icindir. */
const KOVA = Object.freeze({ '@_': 'eslesmeyen', '@ip': 'ip', '@-': 'alansiz' });

/**
 * Location'i trafik betiginin yazdigi bicime cevirir (nginx_spa_traffic.sh ile BIREBIR):
 *   '^~ /x/'                 -> '/x/'   (onek atilir, olculur)
 *   '= /x', '~ re', '~* re'  -> null    (betik bunlari HIC olcmez; '=' silme satiri olu kod)
 *   '^~/x' (bosluksuz), '@ad' -> null
 * null = "bu location tipi olculmuyor" - 'istek yok' DEGIL.
 */
function normLoc(p) {
  const s = T(p);
  if (/^\^~\s/.test(s)) {
    const r = s.replace(/^\^~\s+/, '');
    return r.startsWith('/') ? r : null;
  }
  if (/^[~^=]/.test(s)) return null;
  return s.startsWith('/') ? s : null;
}

/** 'yyyymmddHHMMSS' -> epoch ms (yerel saat, UTC gibi okunur; scan_date ile tutarli). */
function zamanMs(v) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(T(v));
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/**
 * OLCULEN PENCERE (saat): scan_date 00:00 - first_seen. ALT SINIRDIR (tarama gun icinde
 * kosar). first_seen location'in ilk gorulmesi DEGIL, okunan log kuyrugunun en eski kaydi.
 * Gunluk log rotasyonunda sampled=0 iken bile pencere < 1 gun olabilir; 'yok' demeden once
 * bu yuzden pencereye bakilir. Bilinmiyorsa null.
 */
function pencereSaat(scanDate, firstSeen) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(gunu(scanDate));
  const ilk = zamanMs(firstSeen);
  if (!m || ilk == null) return null;
  const bas = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Math.max(0, Math.floor((bas - ilk) / 36e5));
}

/** Adres kalibindan uygulama: '<app>-<ns>.apps...' -> app (namespace satirdan bilinir). */
function appFromAddress(addr, nsLower) {
  const label = ilkEtiket(addr);
  if (!label || !nsLower) return null;
  const suf = '-' + nsLower;
  return label.endsWith(suf) && label.length > suf.length ? label.slice(0, -suf.length) : null;
}

/** RP host'unun rolu: 'nonprod' | 'prod-eski' | 'prod-yeni' | '' (listede yok). */
function rolOf(host, RP) {
  const h = U(host);
  if (RP.prodOld.has(h)) return 'prod-eski';
  if (RP.prodNew.has(h)) return 'prod-yeni';
  if (RP.nonProd.has(h)) return 'nonprod';
  return '';
}

/** RP host'unun ortami: liste uzerinden (envOfHost yalniz yedek). */
function rpEnvOf(host, RP) {
  const h = U(host);
  for (const [env, list] of Object.entries(RP.byEnv)) if (list.includes(h)) return env;
  return envOfHost(h);
}

/** Tablo durumu: 'var' | 'yok' | 'okunamadi'. Satir dizisi yoksa 'var' SAYILMAZ. */
function tabloDurumu(kaynak, ad) {
  const t = kaynak && kaynak.tablolar ? kaynak.tablolar[ad] : null;
  if (t === 'yok') return 'yok';
  if (t === 'var' && Array.isArray(kaynak[ad])) return 'var';
  return 'okunamadi';
}

/**
 * Trafik indeksi (Nginx_Spa_Traffic, o gunun satirlari). IKI KIP AYRI haritalarda tutulur:
 * host kipi hata satiri location kipinin (host, vhost) hatasini zehirlemez, tersi de olmaz.
 * Kovalar (vhost '_') hicbir haritaya girmez; yalniz sunucu basina toplam olarak tutulur.
 * hostKipi: o gunun taramasinda HERHANGI bir '@' satiri var mi. Yoksa host kipi hic
 * uretilmemistir (eski betik/analyzer ya da SPA_HOST_MODE kapali) -> dizin tanimlarinin
 * olcum kaynagi yok ('kaynak-yok'; eski davranisla ayni).
 */
function trafikIndeksi(rows) {
  const satir = new Map(); // location kipi: HOST|VHOST|location -> satir
  const hata = new Map(); // location kipi: HOST|VHOST ya da HOST|* -> mesaj
  const hSatir = new Map(); // host kipi: HOST|VHOST -> satir
  const hHata = new Map(); // host kipi: HOST|VHOST -> { hata, vhost, ad }
  const kova = new Map(); // HOST -> { eslesmeyen, ip, alansiz } (7 gun istek)
  const host = new Map(); // HOST -> { satir, hata, hk (host kipi satir sayisi) }
  let hostKipi = 0;
  let tarih = '';
  for (const r of rows || []) {
    const h = U(r.host);
    if (!h) continue;
    const g = gunu(r.scan_date);
    if (g > tarih) tarih = g;
    let hs = host.get(h);
    if (!hs) host.set(h, (hs = { satir: 0, hata: 0, hk: 0 }));
    const loc = T(r.location);
    if (loc.startsWith('@')) {
      // HOST KIPI (sozlesme: location LIKE '@%'; location kipi daima '/' ile baslar).
      hostKipi += 1;
      hs.hk += 1;
      const vh = U(r.vhost);
      const err = T(r.error);
      if (vh === '_') {
        if (err) continue;
        hs.satir += 1;
        const ad = KOVA[L(loc)];
        if (!ad) continue;
        let kv = kova.get(h);
        if (!kv) kova.set(h, (kv = { eslesmeyen: 0, ip: 0, alansiz: 0 }));
        kv[ad] += num(r.req_7d);
        continue;
      }
      if (!vh) continue;
      const k = `${h}|${vh}`;
      if (err) {
        hs.hata += 1;
        if (!hHata.has(k)) hHata.set(k, { hata: err, vhost: T(r.vhost), ad: loc.slice(1) });
        continue;
      }
      hs.satir += 1;
      if (!hSatir.has(k)) hSatir.set(k, r);
      continue;
    }
    const vh = U(r.vhost) || '*';
    if (T(r.error)) {
      hs.hata += 1;
      const k = `${h}|${vh}`;
      if (!hata.has(k)) hata.set(k, T(r.error));
      continue;
    }
    hs.satir += 1;
    const k = `${h}|${vh}|${loc}`;
    if (!satir.has(k)) satir.set(k, r);
  }
  return { satir, hata, hSatir, hHata, kova, host, hostKipi, tarih };
}

/**
 * Olculmus bir trafik satirinin durumu (iki kip ayni kural). 0 istek bir ALT SINIRDIR, eger:
 *   pencere          sampled=1 / pencere < 7 gun / first_seen yok
 *   eslesmeyen-host  (yalniz host kipi) sunucuda hicbir uygulamaya yazilamayan istek var:
 *                    eslesmeyen Host / IP / alansiz satirlar nginx'te varsayilan sunucuya
 *                    (bilinmeyen bir uygulama vhost'u olabilir) duser.
 * HOST KIPINDE sampled=1 IKI SEY demektir (nginx_spa_traffic.sh, 2026-10-02): daha eski veri
 * okunamadi (pencere) YA DA logda uygulamaya yazilamayan istek var (@-, @_, @ip). kovaVar:
 * sunucuda kova > 0. Pencere tam (>= 7 gun) ve kova varken sampled'in sebebi kovadir: neden
 * 'pencere' DEGIL, yalniz 'eslesmeyen-host' yazilir (ipucu kendisiyle celismesin).
 */
function olcumDurumu(r, ekKismi, kovaVar) {
  const req7 = num(r.req_7d);
  const sampled = bit(r.sampled);
  const pencereSa = pencereSaat(r.scan_date, r.first_seen);
  const kismi = [];
  if (req7 === 0) {
    const kisa = pencereSa == null || pencereSa < PENCERE_TAM_SA;
    if (kisa || (sampled && !kovaVar)) kismi.push('pencere');
    for (const n of ekKismi || []) kismi.push(n);
  }
  const o = {
    durum: req7 > 0 ? 'var' : kismi.length ? 'sifir-kismi' : 'sifir',
    req7,
    req24: num(r.req_24h),
    hc24: num(r.hc_24h),
    sampled,
    pencereSa,
    son: T(r.last_seen) || null,
    ilk: T(r.first_seen) || null,
    tarih: gunu(r.scan_date),
  };
  if (kismi.length) o.kismi = kismi;
  return o;
}

/**
 * Trafik: location / proxy tanimi basina durum (location kipi). Eski PROD, non-prod VE yeni
 * PROD'un servis vhost'lari (<SERVICE>-PROD.conf) location kipinde olculur. Dizin tanimlari
 * host kipindedir (dizinTrafigi).
 */
function tanimTrafigi(d, trfTablo, idx) {
  if (trfTablo !== 'var')
    return { durum: 'olculemedi', neden: trfTablo === 'yok' ? 'tablo-yok' : 'okunamadi' };
  const vh = U(d.vhost) || '*';
  const hata = idx.hata.get(`${d.host}|${vh}`) || idx.hata.get(`${d.host}|*`);
  if (hata) return { durum: 'olculemedi', neden: 'log', hata };
  const loc = normLoc(d.location);
  if (loc == null) return { durum: 'olculemedi', neden: 'location-tipi' };
  const r = idx.satir.get(`${d.host}|${vh}|${loc}`);
  if (!r) return { durum: 'olculemedi', neden: idx.host.has(d.host) ? 'satir-yok' : 'host' };
  return olcumDurumu(r);
}

/**
 * YENI PROD DIZIN TANIMININ TRAFIGI (host kipi, sozlesme 2026-10-02). Tanim
 * Nginx_Intranet_Audit'ten (host, namespace, application, conf_name) gelir; trafik satiri
 * ayni host'ta vhost = '<application>-<namespace>' (conf.d dosya adi; harf duyarsiz) olan
 * '@' satiridir. Yedek aday YALNIZ '<application>-<namespace>-N' bicimli conf_name govdesi
 * (bkz. rpUygula: cekirdek eslesmesiyle gelen baska uygulamanin dosyasi aday OLMAZ).
 *   null          o gun HICBIR sunucuda host kipi satiri yok -> olcum kaynagi yok
 *   olculemedi    tablo yok/okunamadi | HOST|* LOADERR | HLOADERR | sunucunun hic satiri yok
 *                 ('host') | sunucuda host kipi satiri yok ('host-kipi-yok') | bu vhost'un
 *                 satiri yok ('satir-yok')  -- HICBIRI 0 DEGIL.
 */
function dizinTrafigi(host, adaylar, trfTablo, idx) {
  if (trfTablo !== 'var')
    return { durum: 'olculemedi', neden: trfTablo === 'yok' ? 'tablo-yok' : 'okunamadi' };
  if (!idx.hostKipi) return null;
  const genel = idx.hata.get(`${host}|*`);
  if (genel) return { durum: 'olculemedi', neden: 'log', hata: genel };
  for (const vh of adaylar) {
    const k = `${host}|${vh}`;
    const e = idx.hHata.get(k);
    if (e) {
      const o = { durum: 'olculemedi', neden: 'log', hata: e.hata, vhost: e.vhost };
      if (e.ad) o.ad = e.ad;
      return o;
    }
    const r = idx.hSatir.get(k);
    if (!r) continue;
    const kv = idx.kova.get(host);
    const atanmamis = kv ? kv.eslesmeyen + kv.ip + kv.alansiz : 0;
    const o = olcumDurumu(r, atanmamis > 0 ? ['eslesmeyen-host'] : [], atanmamis > 0);
    o.vhost = T(r.vhost);
    o.ad = T(r.location).slice(1);
    if (atanmamis > 0) o.atanmamis = atanmamis;
    return o;
  }
  const hs = idx.host.get(host);
  return { durum: 'olculemedi', neden: !hs ? 'host' : !hs.hk ? 'host-kipi-yok' : 'satir-yok' };
}

const OLCULDU = new Set(['var', 'sifir', 'sifir-kismi']);

/**
 * Uygulama satirlarini RP kolonlariyla YERINDE zenginlestirir.
 *
 * @param {object}   p
 * @param {object[]} p.rows       kesif route satirlari (platform namespace'leri HARIC; yalniz
 *                                SPA'lar degil TUM route'lar - indeks tum adres uzayindan kurulur)
 * @param {object[]} p.apps       uygulamalar() ciktisi (ag alani dolu olmali)
 * @param {object[]|null} p.inventory  route envanteri: proxy hedefi icin resolveTarget yedegi
 * @param {object}  [p.kaynak]    { tablolar:{cfg,dir,trf,ups}, prxKolon, cfg, dir, ups, trf }
 *                                verilmezse TUM tablolar 'okunamadi' sayilir (asla 'tanimsiz').
 * @returns {{ kapsam: object, detay: Map<string, object[]> }}
 */
function rpUygula({ rows, apps, inventory, kaynak }) {
  const RP = internetRpHosts();
  const k = kaynak || {};
  const tablolar = {
    cfg: tabloDurumu(k, 'cfg'),
    dir: tabloDurumu(k, 'dir'),
    trf: tabloDurumu(k, 'trf'),
    ups: tabloDurumu(k, 'ups'),
  };
  const satirlar = (ad) => (tablolar[ad] === 'var' ? k[ad] : []);
  const prxKolon = k.prxKolon == null ? null : Number(k.prxKolon);

  // ── KESIF INDEKSLERI: platform haric TUM route satirlarindan ─────────────────────────
  const hostIdx = new Map(); // fqdn -> Set(appKey)
  const hostRoute = new Map(); // fqdn -> Set('ns|route')  (paylasilan host tespiti)
  const labelIdx = new Map(); // ilk DNS etiketi ('-<ns>' ile biten) -> Set(appKey)
  const adIdx = new Map(); // '<app>-<ns>' -> Set(appKey)   (conf adi / proxy etiketi kalibi)
  const nsAppIdx = new Map(); // 'ns|app' -> Set(appKey)
  const nsAdresIdx = new Map(); // 'ns|<adresten cikan app>' -> Set(appKey)
  const appEnvIdx = new Map(); // 'app|env' -> Set(appKey)    (zayif eslesme)
  const ekle = (m, key, v) => {
    if (!key) return;
    let s = m.get(key);
    if (!s) m.set(key, (s = new Set()));
    s.add(v);
  };
  for (const r of rows || []) {
    const ns = L(r.namespace);
    const app = L(r.application);
    if (!ns || !app) continue;
    const key = `${ns}|${app}`;
    const h = L(r.host);
    if (h) {
      ekle(hostIdx, h, key);
      ekle(hostRoute, h, `${ns}|${L(r.route)}`);
      // ETIKET KORUNAGI (resolveTarget ile ayni kural): etiket '-<ns>' ile bitmeli. Ozel alan
      // adinin genel etiketi ('mobil.garanti.com.tr' -> 'mobil') kesifte OLMAYAN yabanci bir
      // hedefle ('mobil.vendor-cdn.net') eslesip uygulamaya 'kesin' baglanmasin.
      const lbl = ilkEtiket(h);
      const suf = '-' + ns;
      if (lbl.endsWith(suf) && lbl.length > suf.length) ekle(labelIdx, lbl, key);
      const adr = appFromAddress(h, ns);
      if (adr && adr !== app) ekle(nsAdresIdx, `${ns}|${adr}`, key);
    }
    ekle(adIdx, `${app}-${ns}`, key);
    ekle(nsAppIdx, key, key);
    const env = envOfNamespace(ns);
    if (env) ekle(appEnvIdx, `${app}|${env}`, key);
  }
  // ENVANTER YEDEGI: route envanterindeki adres -> ns; uygulama = etiket - '-ns'.
  // Openshift_Inventory (~70 bin satir) YUKLENMEZ: ad yedegi zaten adIdx'te denendi.
  const maps = buildResolverMaps(inventory || [], []);

  /** Ad ile bulunan aday kumesi: birden cok uygulamaysa ('<app>-<ns>' bolme carpismasi)
   *  baglanir ama 'belirsiz' isaretlenir (trafigi uygulamaya ayrilamaz). */
  const adAday = (keys, esles) => ({ keys, esles: keys.size > 1 ? 'belirsiz' : esles });

  /**
   * Proxy hedefini uygulamaya bagla. null = cozulemedi.
   * @param {string} hedef  gercek arka uc (FQDN ya da ciplak ad)
   * @param {string} rol    tanimin bulundugu RP host'unun rolu ('-prod' denemesi yalniz PROD'da)
   */
  const hedefBagla = (hedef, rol) => {
    const h = L(hedef);
    if (!h) return null;
    const lbl = ilkEtiket(h);
    let keys = hostIdx.get(h);
    if (keys) {
      // PAYLASILAN HOST: FARKLI route'lar (path tabanli) ayni adresi kullaniyor; tanimin
      // hangi route'a gittigi location'dan bilinemez. Ayni route'un birden cok is yuku
      // (blue/green, v1/v2) tanimi GERCEKTEN paylasir: KESIN kalir.
      const paylasim = keys.size > 1 && (hostRoute.get(h) || new Set()).size > 1;
      return { keys, esles: paylasim ? 'paylasimli' : 'kesin' };
    }
    keys = labelIdx.get(lbl) || adIdx.get(lbl);
    if (keys) return adAday(keys, 'kesin');
    // ESKI YAZIM: namespace '-prod' eksiz (proxy_pass https://x-app-v1-digital-banking-ch/).
    // YALNIZ PROD RP'DE: nginx-migration.cjs ayni kurali yalniz eski PROD hostlarina uygular.
    // Non-prod RP'deki ciplak 'kart-ui-app-v1-kart' bir TEST/DEV adidir; PROD uygulamasina
    // baglanirsa PROD'da tanimi olmayan uygulama 'tanimli' gorunurdu.
    const prodRp = PROD_ROL.has(rol);
    if (prodRp && !lbl.endsWith('-prod')) {
      keys = labelIdx.get(lbl + '-prod') || adIdx.get(lbl + '-prod');
      if (keys) return adAday(keys, 'ek-prod');
    }
    // resolveTarget de '-prod'u kendi icinde dener: non-prod RP'de o yoldan gelen sonuc
    // (suffixAdded) KABUL EDILMEZ - ayni kural, ikinci kapi.
    const res = resolveTarget(h, maps.routeByAddress, new Map(), maps.routeByLabel);
    if (res.namespace && res.application && (prodRp || !res.suffixAdded)) {
      keys = nsAppIdx.get(`${L(res.namespace)}|${L(res.application)}`);
      if (keys) return { keys, esles: 'envanter' };
    }
    return null;
  };

  /** LOC satirini uygulamaya bagla. null = cozulemedi; { aday } = birden cok aday (baglanmaz). */
  const locBagla = (r, host) => {
    const ns = L(r.namespace);
    const app = L(r.application);
    if (!app) return null;
    if (ns) {
      let keys = nsAppIdx.get(`${ns}|${app}`);
      if (keys) return { keys, esles: 'kesin' };
      keys = nsAdresIdx.get(`${ns}|${app}`);
      if (keys) return adAday(keys, 'ad');
      return null;
    }
    // FLAT ya da NOT_IN_INVENTORY: application = '<app>-<ns>' govdesi olabilir.
    let keys = adIdx.get(app);
    if (keys) return adAday(keys, 'ad');
    const env = L(envOfHost(host));
    const c = appEnvIdx.get(`${app}|${env}`);
    if (c && c.size === 1) return { keys: c, esles: 'zayif' };
    // AYNI AD birden cok namespace'te: tanim hangisine ait bilinmez. Baglanmaz, ama adaylar
    // 'tanimsiz' da DEGILDIR - o ortamda onlara ait olabilecek bir tanim BILINIYOR.
    if (c && c.size > 1) return { aday: c };
    return null;
  };

  // ── TRAFIK INDEKSI (dizin tanimlari olusurken host kipi satirina baglanir) ────────────
  const tIdx = trafikIndeksi(satirlar('trf'));

  // ── TANIMLAR ─────────────────────────────────────────────────────────────────────────
  const upsServer = new Map();
  let upsTarih = '';
  for (const r of satirlar('ups')) {
    const key = `${U(r.host)}|${L(r.name)}`;
    if (!upsServer.has(key)) upsServer.set(key, hostOf(r.server));
    const g = gunu(r.scan_date);
    if (g > upsTarih) upsTarih = g;
  }

  const detay = new Map(); // appKey -> Map(defKey -> tanim)
  const taranan = new Set(); // o gunun taramasinda satiri olan RP host'lari
  const cozulemeyen = {};
  // ORTAM BASINA gercek arka ucu BULUNAMAYAN takma adli proxy tanimi: o ortamda "tanimsiz"
  // denemez (tanim, tanimi olmayan herhangi bir uygulamaya gidiyor olabilir).
  const hedefCozulemeyen = {};
  let belirsiz = 0;
  const belirsizAday = new Set(); // birden cok adayli LOC tanimlarinin aday uygulamalari
  const bagla = (keys, d) => {
    const dk = `${d.host}|${d.yol}|${d.vhost}|${d.location}`;
    for (const key of keys) {
      let m = detay.get(key);
      if (!m) detay.set(key, (m = new Map()));
      if (!m.has(dk)) m.set(dk, d);
    }
  };
  const cozulmedi = (host) => {
    const e = rpEnvOf(host, RP);
    cozulemeyen[e] = (cozulemeyen[e] || 0) + 1;
  };

  let configTarih = '';
  for (const r of satirlar('cfg')) {
    const host = U(r.host);
    if (!host || !RP.all.has(host)) continue;
    taranan.add(host);
    const g = gunu(r.scan_date);
    if (g > configTarih) configTarih = g;
    const base = {
      host,
      rol: rolOf(host, RP),
      env: rpEnvOf(host, RP),
      vhost: T(r.vhost),
      location: T(r.location_path),
      status: U(r.status) || 'OK',
    };
    let bag;
    let d;
    if (L(r.kind) === 'proxy') {
      // GERCEK ARKA UC: upstream server satiri > proxy_ssl_name > proxy_pass'teki ad.
      const yazilan = hostOf(r.upstream_name);
      let hedef = upsServer.get(`${host}|${yazilan}`) || '';
      let hedefKaynak = 'upstream-server';
      if (!hedef) {
        hedef = hostOf(r.target_url);
        hedefKaynak = 'proxy_ssl_name';
      }
      if (!hedef) {
        hedef = yazilan;
        hedefKaynak = 'proxy_pass';
      }
      bag = hedefBagla(hedef, base.rol);
      d = { ...base, yol: 'proxy', hedef, hedefKaynak };
      // TAKMA AD COZULEMEDI (upstream tablosu okunamadi / yok / bu adi icermiyor): bu tanimin
      // nereye gittigi BILINMIYOR - ortamin "tanimsiz" karari olculemedi'ye doner.
      if (!bag && hedefKaynak !== 'upstream-server' && takmaAdMi(L(hedef)))
        hedefCozulemeyen[base.env] = (hedefCozulemeyen[base.env] || 0) + 1;
    } else {
      bag = locBagla(r, host);
      d = { ...base, yol: 'include' };
    }
    if (bag && bag.aday) {
      belirsiz += 1;
      for (const key of bag.aday) belirsizAday.add(key);
      continue;
    }
    if (!bag) {
      cozulmedi(host);
      continue;
    }
    d.esles = bag.esles;
    bagla(bag.keys, d);
  }

  let dizinTarih = '';
  const tarananDizin = new Set();
  // CONF.D ADININ SAHIPLERI (dogrulama bulgusu, 2026-10-02): HOST|U(<app>-<ns>) -> dizin
  // satirlari ('ns|app'). '<app>-<ns>' bolmesi carpisabilir (kart-ui/x-prod ile kart/ui-x-prod
  // ayni 'kart-ui-x-prod.conf'u yazar; nginx yalniz sonuncuyu sunar): o vhost'un trafigi iki
  // uygulamadan hangisinin bilinmez. Uygulamaya cozulemeyen satir da adi isgal eder.
  const dizinSahip = new Map();
  for (const r of satirlar('dir')) {
    const host = U(r.host);
    if (!host || !RP.prodNew.has(host) || !bit(r.conf_exists)) continue;
    ekle(dizinSahip, `${host}|${U(`${L(r.application)}-${L(r.namespace)}`)}`, `${L(r.namespace)}|${L(r.application)}`);
  }
  for (const r of satirlar('dir')) {
    const host = U(r.host);
    if (!host || !RP.prodNew.has(host)) continue;
    tarananDizin.add(host);
    const g = gunu(r.scan_date);
    if (g > dizinTarih) dizinTarih = g;
    // TANIM KOSULU: application-confs/<app>-<ns>.conf var. Dizin var ama conf yoksa nginx
    // bu uygulamayi SUNMAZ - tanim sayilmaz.
    if (!bit(r.conf_exists)) continue;
    const ns = L(r.namespace);
    const app = L(r.application);
    let keys = nsAppIdx.get(`${ns}|${app}`);
    let esles = 'kesin';
    if (!keys && ns && !ns.endsWith('-prod')) {
      keys = nsAppIdx.get(`${ns}-prod|${app}`);
      esles = 'ek-prod';
    }
    if (!keys) {
      cozulmedi(host);
      continue;
    }
    // RP ISTEGI (host kipi): vhost = conf.d dosya adi = '<application>-<namespace>' (dizin
    // satirinin KENDI ns'i; ek-prod eslesmesi uygulamaya baglar, dosya adini degistirmez).
    const vhAd = U(`${app}-${ns}`);
    // Ayni conf.d adina BASKA bir dizin satiri da dusuyor: trafik bu uygulamaya AYRILAMAZ.
    if ((dizinSahip.get(`${host}|${vhAd}`) || new Set()).size > 1) esles = 'belirsiz';
    // conf_name YEDEGI yalniz '<app>-<ns>-N' (nginx_ops'un -N eki) ve o ad baska bir dizin
    // satirinin '<app>-<ns>'i DEGILSE. Analyzer conf_name'i cekirdek eslesmesiyle (servis
    // oneki atilarak) yazar: 'ui/odeme-prod' satirina 'kart-ui-odeme-prod.conf' dusebilir -
    // kosulsuz yedek, kendi vhost satiri olmayan uygulamaya BASKA uygulamanin istegini
    // 'kesin var' diye yaziyordu (dogrulama bulgusu, 2026-10-02).
    const conf = T(r.conf_name);
    const confAd = U(conf.replace(/\.conf$/i, ''));
    const confYedek =
      confAd.startsWith(`${vhAd}-`) &&
      /^\d+$/.test(confAd.slice(vhAd.length + 1)) &&
      !dizinSahip.has(`${host}|${confAd}`);
    const adaylar = confYedek ? [vhAd, confAd] : [vhAd];
    const trafik = dizinTrafigi(host, adaylar, tablolar.trf, tIdx);
    bagla(keys, {
      host,
      rol: 'prod-yeni',
      env: 'PROD',
      // Eslesen trafik satirinin vhost'u (diskteki ad); eslesmediyse bos.
      vhost: (trafik && trafik.vhost) || '',
      location: `${ns}/${app}`,
      status: bit(r.app_deployed) ? 'OK' : 'MISSING_APP',
      yol: 'dizin',
      esles,
      conf,
      trafik,
    });
  }

  // TARIH KORUNAGI (dogrulama bulgusu): her tablo KENDI MAX(scan_date)'iyle okunur. Analyzer
  // Nginx_Intranet_Audit'i yalniz dizin satiri urettiginde yeniler; dizin satiri uretmeyen bir
  // kosu (or. yalniz eski PROD hostlarini kapsayan limitli kosu) config'i bugune tasirken
  // dizin tablosunu ESKI gunde birakir. Farkli gunlerin satirlari birlestirilip "o gun
  // taranmis" DENMEZ: yeni PROD hostlari dizin satirlariyla taranmis sayilmaz ve PROD icin
  // "tanimsiz" yerine olculemedi yazilir. Eski gunun dizin TANIMLARI yine gosterilir (bilinen
  // en son durum; 'tanimli' kanittir).
  const dizinFarkli = !!(dizinTarih && configTarih && dizinTarih !== configTarih);
  if (!dizinFarkli) for (const h of tarananDizin) taranan.add(h);

  // ── TRAFIK: tanim basina BIR KEZ hesaplanir (ayni tanim birden cok uygulamaya bagliysa) ─
  // Dizin tanimlarinin trafigi olusturulurken (host kipi) hesaplandi.
  const islendi = new Set();
  for (const m of detay.values()) {
    for (const d of m.values()) {
      if (islendi.has(d) || d.yol === 'dizin') continue;
      islendi.add(d);
      d.trafik = tanimTrafigi(d, tablolar.trf, tIdx);
    }
  }

  // ── KAPSAM: ortam basina taranmayan beklenen hostlar ────────────────────────────────
  const taranmayan = {};
  for (const [env, list] of Object.entries(RP.byEnv)) {
    const eksik = list.filter((h) => !taranan.has(h));
    if (eksik.length) taranmayan[env] = eksik;
  }

  /** Beklenen hostlar: PROD'da tanimin bulundugu tasima grubu(lari), yoksa tum liste. */
  const beklenenHostlar = (ENV, bulunan) => {
    if (ENV !== 'PROD') return RP.byEnv[ENV] ? [...RP.byEnv[ENV]] : [];
    const gr = RP.groups.filter((g) => [...g.oldHosts, ...g.newHosts].some((h) => bulunan.has(h)));
    if (!gr.length) return [...RP.byEnv.PROD];
    return [...new Set(gr.flatMap((g) => [...g.oldHosts, ...g.newHosts]))];
  };

  /** Tanim YOKKEN karar: kapsam-disi > olculemedi > tanimsiz. Asla sessizce 'tanimsiz'. */
  const tanimYokKarari = (a, ENV) => {
    if (!ENV) return { rp: 'kapsam-disi', neden: 'ortam-yok' };
    if (!RP.byEnv[ENV]) return { rp: 'kapsam-disi', neden: 'rp-listesi-yok' };
    // ARK DISI platformlar (hosting, wyden, metaco, ...) bizim RP'lerden gecmeyebilir:
    // tanim bulunamazsa yanlis alarm yerine 'kapsam disi' (varsayilan, kullaniciya sorulacak).
    if (!(a.clusters || []).some((c) => platformOfCluster(c) === 'ark'))
      return { rp: 'kapsam-disi', neden: 'platform' };
    if (tablolar.cfg !== 'var')
      return {
        rp: 'olculemedi',
        neden: `${tablolar.cfg === 'yok' ? 'tablo-yok' : 'okunamadi'}:config`,
      };
    if (ENV === 'PROD') {
      // K3: PROD'da eski proxy_pass YA DA yeni dizin kurulumu yeter; ikisinden biri
      // okunamadiysa "hicbiri yok" denemez.
      if (tablolar.dir !== 'var')
        return {
          rp: 'olculemedi',
          neden: `${tablolar.dir === 'yok' ? 'tablo-yok' : 'okunamadi'}:dizin`,
        };
      // Dizin taramasi config taramasindan FARKLI gunden: yeni PROD'un o gunku durumu bilinmez.
      if (dizinFarkli) return { rp: 'olculemedi', neden: 'tarih-farkli:dizin' };
      // kind/upstream_name/target_url/upstream_defined yoksa analyzer proxy satiri HIC yazmaz.
      if (prxKolon !== 4) return { rp: 'olculemedi', neden: 'proxy-kolonu-yok' };
    }
    if (taranmayan[ENV]) return { rp: 'olculemedi', neden: 'host-taranmadi' };
    // TAKMA AD: ortamda gercek arka ucu bulunamayan proxy tanimi var. Upstream tablosu
    // okunamadiysa / yoksa nedeni o; okunduysa takma ad orada yok.
    if (hedefCozulemeyen[ENV]) {
      if (tablolar.ups !== 'var')
        return {
          rp: 'olculemedi',
          neden: `${tablolar.ups === 'yok' ? 'tablo-yok' : 'okunamadi'}:upstream`,
        };
      return { rp: 'olculemedi', neden: 'hedef-cozulemedi' };
    }
    return { rp: 'tanimsiz' };
  };

  for (const a of apps || []) {
    const key = `${L(a.namespace)}|${L(a.application)}`;
    const m = detay.get(key);
    const defs = m ? [...m.values()] : [];
    if (!(a.spa === 'evet' && (a.ag === 'internet' || a.ag === 'karisik'))) {
      a.rp = 'uygulanamaz';
      a.rpIstek = 'uygulanamaz';
      // AG CELISKISI: reencrypt (intranet) bir SPA internet RP'de tanimli - kural ile tanim
      // celisiyor. RP kolonu yine 'uygulanamaz' (K4); celiski Ag hucresinde uyari olur.
      if (a.spa === 'evet' && a.ag === 'intranet' && defs.length) a.agCelisme = true;
      continue;
    }
    const env = envOfNamespace(a.namespace);
    const ENV = env ? env.toUpperCase() : '';
    // ORTAM DISI (kullanici karari, 2026-10-02): tanim uygulamanin ortamina ait olmayan bir
    // RP'de (ornek: PROD RP test adresine proxy ediyor). Ortamsiz namespace'te (ENV yok)
    // "kendi ortami" bilinmez; tum tanimlar kendi sayilir.
    const disi = ENV ? defs.filter((d) => d.env !== ENV) : [];
    const kendi = ENV ? defs.filter((d) => d.env === ENV) : defs;
    if (disi.length) a.rpOrtamDisi = [...new Set(disi.map((d) => d.env || '?'))].sort();
    // BASKA ORTAMIN OLCULMUS ISTEGI (K3): YALNIZ BILGI - rpReq7'ye eklenmez, rpIstek kararina
    // girmez. Yalniz uygulamaya AYRILABILEN ve OLCULMUS tanimlar: olculemeyen tanima 0
    // yazilmaz; paylasimli/belirsiz tanimin istegi bu uygulamaninki diye yazilmaz.
    // 0 YAZILMAZ: bilgi alanidir ve karar tasimaz; olculmus 0 bile pencere kisaysa "7 gunde
    // yok" DEGILDIR. Yalniz GORULEN istek (> 0, bir alt sinir) yazilir.
    const disiReq7 = disi
      .filter((d) => !AYRILAMAZ.has(d.esles) && d.trafik && OLCULDU.has(d.trafik.durum))
      .reduce((t, d) => t + d.trafik.req7, 0);
    if (disiReq7 > 0) a.rpReq7Disi = disiReq7;
    if (!kendi.length) {
      // YALNIZ BASKA ORTAMIN RP'SINDE TANIMLI ya da hic tanim yok: karar KENDI ortamin
      // kapsamiyla verilir - ortamin tum RP hostlari taranmis ve tablolar okunmussa
      // 'tanimsiz', degilse 'olculemedi' (neden ile). Eskiden baska ortamdaki tanim 'tanimli'
      // sayiliyordu: yalniz PROD RP'de tanimi olan bir TEST uygulamasi rp=tanimli, rpHost=0/2
      // gorunup 'tanimsiz' suzgecinde CIKMIYORDU (dogrulama probu P5). Baska ortamdaki tanim
      // rpSorun ORTAM_DISI + rpOrtamDisi uyarisi olarak kalir; ayrinti panelinde listelenir.
      // BELIRSIZ ADAY: bu uygulamaya ait OLABILECEK bir tanim biliniyor (ayni adli birden cok
      // namespace) - "tanimsiz" denmez.
      const kr = belirsizAday.has(key)
        ? { rp: 'olculemedi', neden: 'belirsiz' }
        : tanimYokKarari(a, ENV);
      a.rp = kr.rp;
      if (kr.neden) a.rpNeden = kr.neden;
      if (disi.length) a.rpSorun = ['ORTAM_DISI'];
      // Kendi ortaminda tanim yok: RP istegi sorulmaz ('uygulanamaz'; gerekce ekranda: kendi
      // ortaminin RP'sinde tanim yok). rp 'olculemedi' iken de ayni: tanim bulunamadi, istek
      // sorulamaz. Baska ortamin olculmus istegi yukarida rpReq7Disi (bilgi) olarak yazildi.
      a.rpIstek = 'uygulanamaz';
      continue;
    }
    // K3: bundan sonraki her alan YALNIZ kendi ortaminin tanimlarindan. Eskiden rpYol, rpEsles,
    // rpSorun ve RP istegi TUM tanimlardan (kendi + baska ortam) hesaplaniyordu: TEST RP'de
    // olculmus gercek 0 alan TEST uygulamasi, PROD RP'nin test adresine proxy'sinin 900
    // istegiyle "istek var 900" gorunuyordu (dogrulama bulgusu, 2026-10-02).
    a.rp = 'tanimli';
    a.rpYol = [...new Set(kendi.map((d) => d.yol))].sort();
    // rpHost: pay ve payda KENDI ortaminin hostlari (baska ortamin hostu paya girmez).
    const bulunan = new Set(kendi.map((d) => d.host));
    const beklenen = beklenenHostlar(ENV, bulunan);
    a.rpHost = beklenen.length
      ? `${beklenen.filter((h) => bulunan.has(h)).length}/${beklenen.length}`
      : String(bulunan.size);
    const enZayif = kendi.reduce((z, d) => Math.max(z, ESLES_SIRA.indexOf(d.esles)), 0);
    if (enZayif > 0) a.rpEsles = ESLES_SIRA[enZayif];
    const sorun = new Set(kendi.map((d) => d.status).filter((s) => SORUNLU.has(s)));
    // Kendi ortaminda da tanim var: 'tanimli' kalir, baska ortamdaki tanim YALNIZ uyaridir
    // (o tanimin durum kodlari ayrinti panelinde, tanim satirinda gorunur).
    if (disi.length) sorun.add('ORTAM_DISI');
    if (sorun.size) a.rpSorun = [...sorun].sort();

    // RP ISTEGI (yalniz tanimli). Karar UYGULAMAYA AYRILABILEN tanimlardan verilir; paylasimli
    // ya da belirsiz tanimin trafigi "istek var" demeye yetmez, 0'i da "yok" demeye.
    // YALNIZ KENDI ORTAMININ TANIMLARI (K3): baska ortamin istegi kararin hicbir dalina
    // (var / yok / kismi / olculemedi / kaynak-yok / ayrilamaz) ve sayilara girmez.
    const ayrilir = kendi.filter((d) => !AYRILAMAZ.has(d.esles));
    const ayrilamaz = kendi.length - ayrilir.length;
    const olculebilir = ayrilir.filter((d) => d.trafik);
    const kaynakYok = ayrilir.length - olculebilir.length;
    if (!olculebilir.length) {
      a.rpIstek = ayrilamaz ? 'ayrilamaz' : 'kaynak-yok';
      continue;
    }
    const olculen = olculebilir.filter((d) => OLCULDU.has(d.trafik.durum));
    // 0 ISTEK BIR ALT SINIRDIR (KESIN KURAL: olculemedi ile yok karismaz), eger:
    //   pencere     en az bir tanimin penceresi < 7 gun / sampled / first_seen yok
    //   eslesmeyen-host  bir dizin taniminin sunucusunda hicbir uygulamaya yazilamayan istek
    //               var (kova: eslesmeyen Host / IP / alansiz) - varsayilan sunucuya duser
    //   kaynak-yok  olcum kaynagi olmayan tanim da var (host kipi hic uretilmemis dizin)
    //   ayrilamaz   uygulamaya ayrilamayan tanim da var (trafigi bu uygulamanin olabilir)
    //   host-taranmadi  ortamin bir RP host'u o gun taranmadi: orada gorulmeyen bir tanim
    //               trafik aliyor olabilir (or. Ankara ulasilamadi, trafik Ankara'da)
    // KAPSAM ORTAMIN TAMAMI (dogrulama bulgusu P6b, 2026-10-01): eskiden yalniz tanimin
    // BULUNDUGU tasima grubunun hostlarina bakiliyordu; tanim 'other' grubunda (GBRVPP01) 0
    // istekle bulunup Glomo Ankara taranmadiginda 'yok' yaziliyordu - oysa uygulama Ankara'da da
    // proxy ediliyor olabilir. 'tanimsiz' karari da ortamin TUM hostlarina bakar (tanimYokKarari);
    // "istek yok" ondan gevsek olamaz. rpHost paydasi (bilgi) tasima grubuyla kalir.
    const eksikHost = taranmayan[ENV] || [];
    const altSinir = [];
    const kismiNeden = new Set(olculen.flatMap((d) => d.trafik.kismi || []));
    for (const n of ['pencere', 'eslesmeyen-host']) if (kismiNeden.has(n)) altSinir.push(n);
    if (kaynakYok > 0) altSinir.push('kaynak-yok');
    if (ayrilamaz > 0) altSinir.push('ayrilamaz');
    if (eksikHost.length) altSinir.push('host-taranmadi');
    if (olculen.some((d) => d.trafik.durum === 'var')) a.rpIstek = 'var';
    else if (olculen.length < olculebilir.length) a.rpIstek = 'olculemedi';
    else if (altSinir.length) {
      a.rpIstek = 'kismi';
      a.rpIstekNeden = altSinir;
    } else a.rpIstek = 'yok';
    a.rpOlcum = `${olculen.length}/${olculebilir.length}`;
    if (olculen.length) {
      // OLCULEMEYEN HUCREYE 0 YAZILMAZ: sayilar yalniz olculen tanimlarin toplamidir.
      // Yalniz kendi ortaminin olculen tanimlari (K3); baska ortaminki rpReq7Disi (bilgi).
      a.rpReq7 = olculen.reduce((t, d) => t + d.trafik.req7, 0);
      a.rpReq24 = olculen.reduce((t, d) => t + d.trafik.req24, 0);
      const son = olculen
        .map((d) => d.trafik.son)
        .filter(Boolean)
        .sort();
      if (son.length) a.rpSon = son[son.length - 1];
      const pen = olculen.map((d) => d.trafik.pencereSa).filter((x) => x != null);
      // EN KISA pencere: kapsam, en kotu olculen tanimin kapsamidir.
      if (pen.length) a.rpPencereSa = Math.min(...pen);
    }
  }

  // SUNUCU TRAFIK DURUMU: yeni PROD da artik olculur (servis vhost'lari location kipinde,
  // uygulama vhost'lari host kipinde). 'kaynak-yok' yalniz o gun HIC satir uretmemis bir yeni
  // PROD sunucusunda ve HICBIR sunucuda host kipi satiri yokken (eski betik/analyzer) yazilir;
  // location kipi satiri olan sunucu 'var'dir (servis vhost tanimlari olculur).
  const hostlar = [...RP.all].map((h) => {
    const rol = rolOf(h, RP);
    const hs = tIdx.host.get(h);
    const trafik =
      tablolar.trf !== 'var'
        ? 'olculemedi'
        : !hs
          ? rol === 'prod-yeni' && !tIdx.hostKipi
            ? 'kaynak-yok'
            : 'satir-yok'
          : hs.satir > 0
            ? 'var'
            : 'hata';
    const o = { host: h, env: rpEnvOf(h, RP), rol, taranan: taranan.has(h), trafik };
    if (hs && hs.hata) o.trafikHata = hs.hata;
    if (rol === 'prod-yeni' && hs) o.hostKipi = hs.hk;
    // KOVA (7 gun): hicbir uygulamaya yazilmayan istekler; sifirdan buyukse yazilir.
    const kv = tIdx.kova.get(h);
    if (kv && kv.eslesmeyen + kv.ip + kv.alansiz > 0) o.kova = { ...kv };
    return o;
  });

  return {
    kapsam: {
      configTarih,
      dizinTarih,
      trafikTarih: tIdx.tarih,
      upsTarih,
      proxyKolonu: prxKolon == null ? null : prxKolon === 4,
      tablolar,
      hostlar,
      taranmayan,
      cozulemeyen,
      // Ortam -> gercek arka ucu bulunamayan takma adli proxy tanimi (o ortamda tanimsiz denmez).
      hedefCozulemeyen,
      belirsiz,
      // Dizin taramasi config taramasindan farkli gunden (PROD icin tanimsiz denmez).
      dizinFarkli,
      // O gunun trafik taramasinda host kipi ('@') satiri var mi: yoksa yeni PROD dizin
      // tanimlarinin olcum kaynagi yok (eski betik/analyzer ya da SPA_HOST_MODE kapali).
      hostKipi: tIdx.hostKipi > 0,
    },
    detay,
  };
}

/** Ayrinti paneli icin bir uygulamanin tanimlari (sirali, JSON'a hazir). */
function rpTanimlari(detay, ns, app) {
  const m = detay && detay.get(`${L(ns)}|${L(app)}`);
  if (!m) return [];
  const ROL = { 'prod-eski': 0, nonprod: 1, 'prod-yeni': 2 };
  return [...m.values()]
    .map((d) => ({ ...d }))
    .sort(
      (a, b) =>
        (ROL[a.rol] ?? 9) - (ROL[b.rol] ?? 9) ||
        a.host.localeCompare(b.host) ||
        a.vhost.localeCompare(b.vhost) ||
        a.location.localeCompare(b.location),
    );
}

module.exports = {
  rpUygula,
  rpTanimlari,
  normLoc,
  pencereSaat,
  PENCERE_TAM_SA,
  ESLES_SIRA,
  KODLAR,
};
