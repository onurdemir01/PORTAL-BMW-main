// server/audit/nginx-hosts.cjs - nginx sunucu adindan ORTAM ve LOKASYON turetme.
//
// NEDEN GEREKLI: dbo.NginxRateLimitInventory ortam kolonu TASIMAZ. Konfigurasyon dosya
// adlari da ortamdan bagimsiz olarak AYNIDIR (ornek: ayni "mobile.conf" hem DEV hem PROD
// sunucusunda bulunur). Dolayisiyla ortam bilgisinin tek kaynagi SUNUCU ADIDIR.
//
// Adlandirma (bmw_nginx playbook'larindaki host listeleriyle BIREBIR):
//   API gateway      ORNGWD.. dev | ORNGWT.. test | ORNGWQ.. qa | ORNGWP.. / ORNGWAP.. prod
//   Reverse proxy    ORNGXD.. dev | ORNGXT.. test | ORNGXQ.. qa | ORRVPP.. / ORRVPAP.. prod
//   Lokasyon         ...AP.. = Ankara, digerleri Pendik (yalniz production icin anlamli)
//
// FAIL-LOUD: kalibi tutmayan host SESSIZCE bir ortama atanmaz, 'BILINMIYOR' kovasina
// dusurulur ve arayuzde gorunur. Yanlis ortama saymak, hic saymamaktan daha kotudur -
// metrik dogru gorunur ama yanlis olur.
'use strict';

const ENV_ORDER = ['DEV', 'TEST', 'EDU', 'QA', 'PROD'];
const UNKNOWN_ENV = 'BILINMIYOR';

const LETTER_TO_ENV = { D: 'DEV', T: 'TEST', Q: 'QA', P: 'PROD' };

// KURUM LISTELERI KOD DISINDA (2026-11-20, kalite kapisi K17): sunucu adlari kurum ayarinda
// (server/util/kurum-ayari.cjs, KURUM_AYAR_DOSYASI; bicim deploy/kurum-ayari.ornek.json `nginx`).
//   ortamIstisnalari   {SUNUCU: ORTAM}  ad kalibi bu hostta YANILTIR (ornek: 'T' harfi tasiyan EDU sunucusu);
//                      kalibi zorlamak yerine ACIK istisna: sessizce TEST saymak edu uygulamalarini test
//                      rakamlarina karistirirdi.
//   intranetSunuculari [SUNUCU]  INTRANET SPA sunuculari. Kalipla turetilemez (ayni harfli iki sunucudan
//                      biri intranet, digeri internet olabilir). Burada OLMAYAN her nginx hostu internete
//                      acik kabul edilir; Denetim'deki internet/intranet kapsam ayrimi buna dayanir.
// Ayar yoksa listeler BOS doner; hata kurumAyarHatasi() ile ve acilista soylenir (bkz. kurum-ayari.cjs).
const { sunucuListesi, sunucuHaritasi, kurumAyari } = require('../util/kurum-ayari.cjs');

const ORTAMLAR = new Set([...ENV_ORDER, UNKNOWN_ENV]);
/** Kurum ayarindaki ortam istisnalari: {SUNUCU: ORTAM}; taninmayan ortam degeri atilir. */
function ortamIstisnalari() {
  const { veri } = kurumAyari();
  const ham = veri?.nginx?.ortamIstisnalari;
  const out = {};
  if (ham && typeof ham === 'object' && !Array.isArray(ham))
    for (const [k, v] of Object.entries(ham)) {
      const ortam = String(v).trim().toUpperCase();
      if (ORTAMLAR.has(ortam)) out[String(k).trim().toUpperCase()] = ortam;
    }
  return out;
}
const intranetKumesi = () => new Set(sunucuListesi('nginx.intranetSunuculari').liste);

/** Nginx filo ayarinin sorunu (yoksa null): ekranlar / acilis uyarisi icin. */
function kurumAyarHatasi() {
  return (
    sunucuListesi('nginx.intranetSunuculari').hata ||
    sunucuHaritasi('nginx.internetRpNonprod').hata ||
    null
  );
}

/** @returns {'DEV'|'TEST'|'QA'|'EDU'|'PROD'|'BILINMIYOR'} */
function envOfHost(host) {
  const h = String(host || '')
    .trim()
    .toUpperCase();
  if (!h) return UNKNOWN_ENV;
  const istisna = ortamIstisnalari()[h];
  if (istisna) return istisna;
  // Ad kurali: iki harfli kurum oneki + rol. Onek kalibin parcasi DEGIL (kurum oneki koda yazilmaz).
  // Reverse proxy production (..RVPP.. / ..RVPAP..) - ortam harfi tasimaz, hepsi prod.
  if (/^[A-Z]{2}RVP/.test(h)) return 'PROD';
  // ..NGW (API gateway) / ..NGX (reverse proxy) + istege bagli 'A' (Ankara) + ortam harfi.
  const m = /^[A-Z]{2}NG[WX](?:A)?([DTQP])/.exec(h);
  if (m) return LETTER_TO_ENV[m[1]] || UNKNOWN_ENV;
  return UNKNOWN_ENV;
}

/** Production lokasyonu: 'Ankara' | 'Pendik' | '' (non-prod'da anlamsiz). */
function siteOfHost(host) {
  const h = String(host || '')
    .trim()
    .toUpperCase();
  // ORNGXAP.. (intranet SPA, 2026-09-10) da Ankara'dir - eklenmeden once bu hostlar
  // lokasyonsuz gorunuyordu. 'AP' onceki desende yoktu, testle yakalandi.
  if (/^[A-Z]{2}(?:NGWAP|NGXAP|RVPAP)/.test(h)) return 'Ankara';
  if (/^[A-Z]{2}(?:NGWP|NGXP|RVPP)/.test(h)) return 'Pendik';
  return '';
}

// dbo.Inventory.env degerleri (middleware_inventory, checkEnv): Production | Test | QA |
// Alpha | ODM. Ad kalibi tutmayan nginx hostlari (Nginx Audit TUM filoyu tarar:
// ORNGX/ORNGW/ORRVP disinda adlar da var) icin ortam BURADAN alinir.
// Kalip tutuyorsa kalip kazanir: envanter kurali daha kaba (D.. -> Test, harf yoksa
// Production) ve ORNGXT51=EDU gibi istisnalari bilmez.
const INVENTORY_ENV = {
  PRODUCTION: 'PROD',
  PROD: 'PROD',
  TEST: 'TEST',
  QA: 'QA',
  ALPHA: 'ALPHA',
  ODM: 'ODM',
  DEV: 'DEV',
  EDU: 'EDU',
};

/** dbo.Inventory.env -> Portal ortam etiketi; taninmayan deger BILINMIYOR. */
function envFromInventory(v) {
  const k = String(v || '')
    .trim()
    .toUpperCase();
  return INVENTORY_ENV[k] || UNKNOWN_ENV;
}

/** Ortamlari sabit sirada dondurur; taninmayanlar EN SONA eklenir (gizlenmez). */
function orderEnvs(seen) {
  const extra = [...seen]
    .filter((e) => !ENV_ORDER.includes(e))
    .sort((a, b) => Number(a > b) - Number(a < b));
  return [...ENV_ORDER.filter((e) => seen.has(e)), ...extra];
}

/** nginx sunucusunun AG KATMANI: 'intranet' | 'internet'.
 *  Listede olmayan her host internete acik sayilir (bkz. intranetSunuculari notu). */
function tierOfHost(host) {
  return intranetKumesi().has(
    String(host || '')
      .trim()
      .toUpperCase(),
  )
    ? 'intranet'
    : 'internet';
}

// INTERNET REVERSE PROXY sunuculari (kullanici onayi, 2026-10-01: "liste AYNEN dogru,
// ORNGXT07 SAYILMAZ"). Gercek SPA Kesfi "RP'de tanimli mi" kararini YALNIZ bu listeye
// dayandirir; "tanimsiz" ancak ortamin bu hostlarinin TAMAMI taranmissa soylenir.
//
// NEDEN tierOfHost DEGIL: o fonksiyon FAIL-OPEN - listede olmayan her host'u (ORNGW* API
// gateway'leri, ORNGXT07) internet sayar. "Tanimsiz" karari icin ACIK liste gerekir.
//
// TEK KAYNAK: non-prod listesi kurum ayarinda (`nginx.internetRpNonprod` {DEV|TEST|QA: [SUNUCU]});
// PROD eski/yeni listesi nginx-migration.cjs migrationGroups()'tan OKUNUR (kopyalanmaz). Dongusel
// yukleme olmasin diye tembel require. EDU icin internet RP yok: o ortamdaki uygulamalar "kapsam disi"
// kalir. Sonuc ayar dosyasi degisene kadar onbellekte (ayar nesnesinin kimligi anahtar).
const NONPROD_ORTAMLAR = ['DEV', 'TEST', 'QA'];
let _rpHosts = null;
let _rpAnahtar = null;
/**
 * @returns {{ byEnv: Record<string, string[]>, prodOld: Set<string>, prodNew: Set<string>,
 *             nonProd: Set<string>, all: Set<string>,
 *             groups: {id:string, label:string, oldHosts:string[], newHosts:string[]}[] }}
 */
function internetRpHosts() {
  const anahtar = kurumAyari().veri;
  if (_rpHosts && _rpAnahtar === anahtar) return _rpHosts;
  const gruplar = require('./nginx-migration.cjs').migrationGroups();
  const { harita } = sunucuHaritasi('nginx.internetRpNonprod');
  const INTERNET_RP_NONPROD = Object.fromEntries(
    NONPROD_ORTAMLAR.map((e) => [e, Object.freeze([...(harita[e] || [])])]),
  );
  const U = (h) =>
    String(h || '')
      .trim()
      .toUpperCase();
  const prodOld = [...new Set(gruplar.flatMap((g) => g.oldHosts.map(U)))];
  const prodNew = [...new Set(gruplar.flatMap((g) => g.newHosts.map(U)))];
  const nonProd = Object.values(INTERNET_RP_NONPROD).flat();
  _rpHosts = Object.freeze({
    byEnv: Object.freeze({ ...INTERNET_RP_NONPROD, PROD: Object.freeze([...prodOld, ...prodNew]) }),
    prodOld: new Set(prodOld),
    prodNew: new Set(prodNew),
    nonProd: new Set(nonProd),
    all: new Set([...nonProd, ...prodOld, ...prodNew]),
    groups: gruplar.map((g) => ({
      id: g.id,
      label: g.label,
      oldHosts: g.oldHosts.map(U),
      newHosts: g.newHosts.map(U),
    })),
  });
  _rpAnahtar = anahtar;
  return _rpHosts;
}

/** Intranet SPA sunuculari, sirali kopya (Nginx ARK SPA > Intranet SPA kurulum durumu, 2026-10-19). */
function intranetHosts() {
  return [...intranetKumesi()].sort((a, b) => Number(a > b) - Number(a < b));
}

module.exports = {
  intranetHosts,
  envOfHost,
  envFromInventory,
  siteOfHost,
  tierOfHost,
  internetRpHosts,
  orderEnvs,
  ENV_ORDER,
  UNKNOWN_ENV,
  ortamIstisnalari,
  kurumAyarHatasi,
};
