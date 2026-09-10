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
  'GBNGXD50', 'GBNGXT50', 'GBNGXT51', 'GBNGXQ50',
  'GBNGXP50', 'GBNGXP51', 'GBNGXP52', 'GBNGXP53', 'GBNGXAP50', 'GBNGXAP51',
]);

/** @returns {'DEV'|'TEST'|'QA'|'PROD'|'BILINMIYOR'} */
function envOfHost(host) {
  const h = String(host || '').trim().toUpperCase();
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
  const h = String(host || '').trim().toUpperCase();
  // GBNGXAP.. (intranet SPA, 2026-09-10) da Ankara'dir - eklenmeden once bu hostlar
  // lokasyonsuz gorunuyordu. 'AP' onceki desende yoktu, testle yakalandi.
  if (/^GBNGWAP|^GBNGXAP|^GBRVPAP/.test(h)) return 'Ankara';
  if (/^GBNGWP|^GBNGXP|^GBRVPP/.test(h)) return 'Pendik';
  return '';
}

/** Ortamlari sabit sirada dondurur; taninmayanlar EN SONA eklenir (gizlenmez). */
function orderEnvs(seen) {
  const extra = [...seen].filter((e) => !ENV_ORDER.includes(e)).sort();
  return [...ENV_ORDER.filter((e) => seen.has(e)), ...extra];
}

/** nginx sunucusunun AG KATMANI: 'intranet' | 'internet'.
 *  Listede olmayan her host internete acik sayilir (bkz. INTRANET_HOSTS notu). */
function tierOfHost(host) {
  return INTRANET_HOSTS.has(String(host || '').trim().toUpperCase()) ? 'intranet' : 'internet';
}

module.exports = {
  envOfHost,
  siteOfHost,
  tierOfHost,
  orderEnvs,
  ENV_ORDER,
  UNKNOWN_ENV,
  _INTRANET_HOSTS: INTRANET_HOSTS,
  _HOST_ENV_OVERRIDE: HOST_ENV_OVERRIDE,
};
