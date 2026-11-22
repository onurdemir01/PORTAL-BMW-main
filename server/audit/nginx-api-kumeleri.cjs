// server/audit/nginx-api-kumeleri.cjs — API gateway production kumeleri, sunuculariyla (2026-11-20).
//
// "Bu API hangi sunucularda var, hangilerinde yok?" (Nginx Hub > API Envanteri > API Bazli, kullanici
// 2026-09-23) ve API Generator job'unun hedef sunuculari. Listeler kurum tanimidir ve
// `bmw_nginx/api_generator` playbook'undaki sunucu listeleriyle ayni olmalidir (bekciler: Portal AG9,
// Ansible check_rate_limit_kanal_kumesi.py K7).
//
// Kume kimligi / etiketi shared/nginxApiClusters.cjs'te (ekranla paylasilir); SUNUCULAR kurum ayarinda
// (server/util/kurum-ayari.cjs, K17):
//   nginx.apiKumeleri          {<kanal>: [SUNUCU]}      production kumeleri
//   nginx.apiGeneratorNonprod  {DEV|TEST|QA: [SUNUCU]}  job'un dev / test / qa play'leri
// Her cagrida ayardan okunur. Ayar yoksa kumeler BOS doner (sessizce eski liste kullanilmaz).
'use strict';

const { API_CLUSTERS } = require('../../shared/nginxApiClusters.cjs');
const { sunucuHaritasi } = require('../util/kurum-ayari.cjs');

const UP = (s) =>
  String(s || '')
    .trim()
    .toUpperCase();

/** @returns {{ key: string, label: string, hosts: string[] }[]} production kumeleri, ayardaki sunucularla */
function apiKumeleri() {
  const { harita } = sunucuHaritasi('nginx.apiKumeleri');
  return API_CLUSTERS.map((c) => ({ key: c.key, label: c.label, hosts: harita[UP(c.key)] || [] }));
}

/** API Generator'in dev / test / qa sunuculari: { DEV, TEST, QA }. */
function apiGeneratorNonprod() {
  const { harita } = sunucuHaritasi('nginx.apiGeneratorNonprod');
  return { DEV: harita.DEV || [], TEST: harita.TEST || [], QA: harita.QA || [] };
}

/** Kume ayarinin sorunu (yoksa null). */
function apiKumeAyarHatasi() {
  return (
    sunucuHaritasi('nginx.apiKumeleri').hata || sunucuHaritasi('nginx.apiGeneratorNonprod').hata
  );
}

/**
 * Bir API'nin bulundugu sunuculari kumelere gore ayirir.
 *
 * @param {string[]} hosts API'nin bulundugu sunucular (tum ortamlarin birlesimi)
 * @returns {{ rows: { cluster: { key: string, label: string, hosts: string[] }, present: string[], missing: string[] }[], outside: string[] }}
 *
 * `outside`: hicbir kumede olmayan sunucular. Yeni bir gateway eklendiginde burada gorunur; yani
 * listelerin bayatladiginin isaretidir (sessizce yanlis sayi gostermek yerine).
 */
function clusterCoverage(hosts) {
  const kumeler = apiKumeleri();
  const set = new Set((hosts || []).map(UP));
  const known = new Set(kumeler.flatMap((c) => c.hosts.map(UP)));
  return {
    rows: kumeler.map((cluster) => ({
      cluster,
      present: cluster.hosts.filter((h) => set.has(UP(h))),
      missing: cluster.hosts.filter((h) => !set.has(UP(h))),
    })),
    outside: [...set].filter((h) => !known.has(h)).sort((a, b) => Number(a > b) - Number(a < b)),
  };
}

/** Kanal adina (harf duyarsiz) karsilik gelen production kumesi (sunuculariyla); yoksa null. */
function apiCluster(channel) {
  const k = String(channel || '')
    .trim()
    .toLowerCase();
  return (k && apiKumeleri().find((c) => c.key === k)) || null;
}

/**
 * API Generator'in bir ortam (+ production'da `site`) icin calistigi sunucular — playbook'taki play
 * listeleri ve `site_ok` kuraliyla ayni: bos / all / hepsi / tumu (u-umlautlu yazimi da) = hepsi, pendik = ..NGWP*,
 * ankara = ..NGWAP* (..NGX* yalniz "hepsi"de). Taninmayan site bos liste doner (job da durur).
 * @param {string} env dev / test / qa / prod (harf duyarsiz; production = prod)
 * @param {string} [site]
 * @param {string} [channel] production'da kumeyi secer; taninmayan / bos kanal DARALTMAZ (tum kumeler).
 *   Rate limit listesi icin kanalin zorunlulugu cagiranda (choice-sources `apiGatewayKumesi`).
 * @returns {string[]}
 */
function apiGeneratorHosts(env, site, channel) {
  const e = UP(env) === 'PRODUCTION' ? 'PROD' : UP(env);
  if (e !== 'PROD') return (apiGeneratorNonprod()[e] || []).slice();
  const s = String(site || '')
    .trim()
    .toLowerCase();
  // Kanal (mblcustomers / customers / mcustomers) production'da kumeyi belirler: o kanalin API'leri
  // yalniz o kumenin sunucularindadir. Taninmayan / bos kanal daraltmaz.
  const kume = apiCluster(channel);
  const all = (kume ? [kume] : apiKumeleri()).flatMap((c) => c.hosts.map(UP));
  if (['', 'all', 'hepsi', 'tumu', 'tümü'].includes(s)) return all;
  // Ad kurali: iki harfli kurum oneki + NGW (gateway) + [A (Ankara)] + P (production).
  if (s === 'pendik') return all.filter((h) => /^[A-Z]{2}NGWP/.test(h));
  if (s === 'ankara') return all.filter((h) => /^[A-Z]{2}NGWAP/.test(h));
  return [];
}

module.exports = {
  API_CLUSTERS,
  apiKumeleri,
  apiGeneratorNonprod,
  apiKumeAyarHatasi,
  apiGeneratorHosts,
  apiCluster,
  clusterCoverage,
};
