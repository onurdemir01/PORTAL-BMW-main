// server/audit/nginx-hosts.cjs - nginx sunucu adindan ORTAM ve LOKASYON turetme.
//
// NEDEN GEREKLI: dbo.NginxRateLimitInventory ortam kolonu TASIMAZ. Konfigurasyon dosya
// adlari da ortamdan bagimsiz olarak AYNIDIR (ornek: ayni "mobile.conf" hem DEV hem PROD
// sunucusunda bulunur). Dolayisiyla ortam bilgisinin tek kaynagi SUNUCU ADIDIR.
//
// Adlandirma (bmw_nginx playbook'larindaki host listeleriyle BIREBIR):
//   API gateway      GBNGWD.. dev | GBNGWT.. test | GBNGWQ.. qa | GBNGWP.. / GBNGWAP.. prod
//   Reverse proxy    GBNGXD.. dev | GBNGXT.. test | GBNGXQ.. qa | GBRVPP.. / GBRVPAP.. prod
//   Lokasyon         ...AP.. = Ankara, digerleri Pendik (yalniz production icin anlamli)
//
// FAIL-LOUD: kalibi tutmayan host SESSIZCE bir ortama atanmaz, 'BILINMIYOR' kovasina
// dusurulur ve arayuzde gorunur. Yanlis ortama saymak, hic saymamaktan daha kotudur -
// metrik dogru gorunur ama yanlis olur.
'use strict';

const ENV_ORDER = ['DEV', 'TEST', 'EDU', 'QA', 'PROD'];
const UNKNOWN_ENV = 'BILINMIYOR';

const LETTER_TO_ENV = { D: 'DEV', T: 'TEST', Q: 'QA', P: 'PROD' };

// ISTISNA: ad kalibi bu hostta YANILTIR. GBNGXT51'in 'T'si test der ama ortami EDU'dur
// (2026-09-10, kullanici bildirimi). Kalibi zorlamak yerine ACIK bir istisna tutuluyor -
// sessizce TEST saymak, edu uygulamalarini test rakamlarina karistirirdi.
const HOST_ENV_OVERRIDE = { GBNGXT51: 'EDU' };

// INTRANET SPA sunuculari (2026-09-10). Kalibla turetilemez: GBNGXT50 intranet,
// GBNGXT34 internet - ikisi de "GBNGXT". Bu yuzden ACIK LISTE.
// Burada OLMAYAN her nginx hostu internete acik kabul edilir; liste degisirse BURASI
// guncellenmeli (Denetim'deki internet/intranet kapsam ayrimi buna dayanir).
const INTRANET_HOSTS = new Set([
  'GBNGXD50',
  'GBNGXT50',
  'GBNGXT51',
  'GBNGXQ50',
  'GBNGXP50',
  'GBNGXP51',
  'GBNGXP52',
  'GBNGXP53',
  'GBNGXAP50',
  'GBNGXAP51',
]);

/** @returns {'DEV'|'TEST'|'QA'|'PROD'|'BILINMIYOR'} */
function envOfHost(host) {
  const h = String(host || '')
    .trim()
    .toUpperCase();
  if (!h) return UNKNOWN_ENV;
  if (HOST_ENV_OVERRIDE[h]) return HOST_ENV_OVERRIDE[h];
  // Reverse proxy production (GBRVPP.. / GBRVPAP..) - ortam harfi tasimaz, hepsi prod.
  if (h.startsWith('GBRVP')) return 'PROD';
  // GBNGW (API gateway) / GBNGX (reverse proxy) + istege bagli 'A' (Ankara) + ortam harfi.
  const m = /^GBNG[WX](?:A)?([DTQP])/.exec(h);
  if (m) return LETTER_TO_ENV[m[1]] || UNKNOWN_ENV;
  return UNKNOWN_ENV;
}

/** Production lokasyonu: 'Ankara' | 'Pendik' | '' (non-prod'da anlamsiz). */
function siteOfHost(host) {
  const h = String(host || '')
    .trim()
    .toUpperCase();
  // GBNGXAP.. (intranet SPA, 2026-09-10) da Ankara'dir - eklenmeden once bu hostlar
  // lokasyonsuz gorunuyordu. 'AP' onceki desende yoktu, testle yakalandi.
  if (/^GBNGWAP|^GBNGXAP|^GBRVPAP/.test(h)) return 'Ankara';
  if (/^GBNGWP|^GBNGXP|^GBRVPP/.test(h)) return 'Pendik';
  return '';
}

// dbo.Inventory.env degerleri (middleware_inventory, checkEnv): Production | Test | QA |
// Alpha | ODM. Ad kalibi tutmayan nginx hostlari (Nginx Audit TUM filoyu tarar:
// GBNGX/GBNGW/GBRVP disinda adlar da var) icin ortam BURADAN alinir.
// Kalip tutuyorsa kalip kazanir: envanter kurali daha kaba (D.. -> Test, harf yoksa
// Production) ve GBNGXT51=EDU gibi istisnalari bilmez.
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
  const extra = [...seen].filter((e) => !ENV_ORDER.includes(e)).sort();
  return [...ENV_ORDER.filter((e) => seen.has(e)), ...extra];
}

/** nginx sunucusunun AG KATMANI: 'intranet' | 'internet'.
 *  Listede olmayan her host internete acik sayilir (bkz. INTRANET_HOSTS notu). */
function tierOfHost(host) {
  return INTRANET_HOSTS.has(
    String(host || '')
      .trim()
      .toUpperCase(),
  )
    ? 'intranet'
    : 'internet';
}

// INTERNET REVERSE PROXY sunuculari (kullanici onayi, 2026-10-01: "liste AYNEN dogru,
// GBNGXT07 SAYILMAZ"). Gercek SPA Kesfi "RP'de tanimli mi" kararini YALNIZ bu listeye
// dayandirir; "tanimsiz" ancak ortamin bu hostlarinin TAMAMI taranmissa soylenir.
//
// NEDEN tierOfHost DEGIL: o fonksiyon FAIL-OPEN - listede olmayan her host'u (GBNGW* API
// gateway'leri, GBNGXT07) internet sayar. "Tanimsiz" karari icin ACIK liste gerekir.
//
// TEK KAYNAK: non-prod listesi BURADA; PROD eski/yeni listesi nginx-migration.cjs
// MIGRATION_GROUPS'tan OKUNUR (kopyalanmaz). Dongusel yukleme olmasin diye tembel require.
// EDU icin internet RP yok: o ortamdaki uygulamalar "kapsam disi" kalir.
const INTERNET_RP_NONPROD = Object.freeze({
  DEV: Object.freeze(['GBNGXD01', 'GBNGXD02']),
  TEST: Object.freeze(['GBNGXT33', 'GBNGXT34']),
  QA: Object.freeze(['GBNGXQ01', 'GBNGXQ02']),
});

let _rpHosts = null;
/**
 * @returns {{ byEnv: Record<string, string[]>, prodOld: Set<string>, prodNew: Set<string>,
 *             nonProd: Set<string>, all: Set<string>, groups: {oldHosts:string[], newHosts:string[]}[] }}
 */
function internetRpHosts() {
  if (_rpHosts) return _rpHosts;
  const { MIGRATION_GROUPS } = require('./nginx-migration.cjs');
  const U = (h) =>
    String(h || '')
      .trim()
      .toUpperCase();
  const prodOld = [...new Set(MIGRATION_GROUPS.flatMap((g) => g.oldHosts.map(U)))];
  const prodNew = [...new Set(MIGRATION_GROUPS.flatMap((g) => g.newHosts.map(U)))];
  const nonProd = Object.values(INTERNET_RP_NONPROD).flat();
  _rpHosts = Object.freeze({
    byEnv: Object.freeze({ ...INTERNET_RP_NONPROD, PROD: Object.freeze([...prodOld, ...prodNew]) }),
    prodOld: new Set(prodOld),
    prodNew: new Set(prodNew),
    nonProd: new Set(nonProd),
    all: new Set([...nonProd, ...prodOld, ...prodNew]),
    groups: MIGRATION_GROUPS.map((g) => ({
      oldHosts: g.oldHosts.map(U),
      newHosts: g.newHosts.map(U),
    })),
  });
  return _rpHosts;
}

module.exports = {
  envOfHost,
  envFromInventory,
  siteOfHost,
  tierOfHost,
  internetRpHosts,
  orderEnvs,
  ENV_ORDER,
  UNKNOWN_ENV,
  _INTRANET_HOSTS: INTRANET_HOSTS,
  _HOST_ENV_OVERRIDE: HOST_ENV_OVERRIDE,
};
