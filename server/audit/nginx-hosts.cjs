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

const ENV_ORDER = ['DEV', 'TEST', 'QA', 'PROD'];
const UNKNOWN_ENV = 'BILINMIYOR';

const LETTER_TO_ENV = { D: 'DEV', T: 'TEST', Q: 'QA', P: 'PROD' };

/** @returns {'DEV'|'TEST'|'QA'|'PROD'|'BILINMIYOR'} */
function envOfHost(host) {
  const h = String(host || '').trim().toUpperCase();
  if (!h) return UNKNOWN_ENV;
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
  if (/^GBNGWAP|^GBRVPAP/.test(h)) return 'Ankara';
  if (/^GBNGWP|^GBRVPP/.test(h)) return 'Pendik';
  return '';
}

/** Ortamlari sabit sirada dondurur; taninmayanlar EN SONA eklenir (gizlenmez). */
function orderEnvs(seen) {
  const extra = [...seen].filter((e) => !ENV_ORDER.includes(e)).sort();
  return [...ENV_ORDER.filter((e) => seen.has(e)), ...extra];
}

module.exports = { envOfHost, siteOfHost, orderEnvs, ENV_ORDER, UNKNOWN_ENV };
