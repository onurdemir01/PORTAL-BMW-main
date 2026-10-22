// shared/nginxApiClusters.cjs — API gateway sunucu kümeleri ve kapsam hesabı.
//
// NEDEN PAYLAŞILAN DOSYA: "bu API hangi sunucularda var, hangilerinde yok?" sorusunu
// geliştiriciler Nginx Hub > API Envanteri > API Bazlı ekranından soruyor (kullanıcı,
// 2026-09-23). Listeler kurum tanımıdır ve `bmw_nginx/api_generator` playbook'undaki
// production sunucu listesiyle aynı olmalıdır; tek bir yerde durması, ekran ile job'ın
// birbirinden ayrışmasını önler. Saf fonksiyon olduğu için node ile doğrudan test edilir.
//
// Burada YALNIZCA production gateway kümeleri vardır; dev/test/qa sunucuları ekranda
// zaten ortam kırılımında görünür.
'use strict';

/** @typedef {{ key: string, label: string, hosts: string[] }} ApiCluster */

/** @type {ApiCluster[]} */
const API_CLUSTERS = [
  {
    key: 'mblcustomers',
    label: 'mblcustomers',
    hosts: [
      'GBNGWP01', 'GBNGWP02', 'GBNGWP03', 'GBNGWP04', 'GBNGWP05', 'GBNGWP06', 'GBNGWP07', 'GBNGWP08',
      'GBNGWP09', 'GBNGWP10', 'GBNGWP11', 'GBNGWP12', 'GBNGWP13', 'GBNGWP14', 'GBNGWP15', 'GBNGWP16',
      'GBNGWAP01', 'GBNGWAP02', 'GBNGWAP03', 'GBNGWAP04', 'GBNGWAP05', 'GBNGWAP06', 'GBNGWAP07', 'GBNGWAP08',
    ],
  },
  {
    key: 'customers',
    label: 'customers',
    hosts: [
      'GBNGWP25', 'GBNGWP26', 'GBNGWP27', 'GBNGWP28', 'GBNGWP29', 'GBNGWP30', 'GBNGWP31', 'GBNGWP32',
      'GBNGWAP22', 'GBNGWAP23', 'GBNGWAP24', 'GBNGWAP25',
    ],
  },
  {
    key: 'mcustomers',
    label: 'mcustomers',
    hosts: [
      'GBNGWAP10', 'GBNGWAP11', 'GBNGWAP12', 'GBNGWAP13',
      'GBNGWP17', 'GBNGWP18', 'GBNGWP19', 'GBNGWP20', 'GBNGWP21', 'GBNGWP22', 'GBNGWP23', 'GBNGWP24',
      'GBNGXAP30', 'GBNGXAP31', 'GBNGXP60', 'GBNGXP61', 'GBNGXP62', 'GBNGXP63',
    ],
  },
];

const UP = (s) => String(s || '').trim().toUpperCase();

/**
 * Bir API'nin bulunduğu sunucuları kümelere göre ayırır.
 *
 * @param {string[]} hosts API'nin bulunduğu sunucular (tüm ortamların birleşimi)
 * @returns {{ rows: { cluster: ApiCluster, present: string[], missing: string[] }[], outside: string[] }}
 *
 * `outside`: hiçbir kümede olmayan sunucular. Yeni bir gateway eklendiğinde burada görünür;
 * yani listelerin bayatladığının işaretidir (sessizce yanlış sayı göstermek yerine).
 */
function clusterCoverage(hosts) {
  const set = new Set((hosts || []).map(UP));
  const known = new Set(API_CLUSTERS.reduce((a, c) => a.concat(c.hosts.map(UP)), []));
  return {
    rows: API_CLUSTERS.map((cluster) => ({
      cluster,
      present: cluster.hosts.filter((h) => set.has(UP(h))),
      missing: cluster.hosts.filter((h) => !set.has(UP(h))),
    })),
    outside: [...set].filter((h) => !known.has(h)).sort(),
  };
}

// API Generator job'unun (bmw_nginx/api_generator/api_generator.yaml) dev / test / qa play'lerinin
// sunuculari. Production play'i yukaridaki uc kumenin TAMAMIDIR. Self Servis'teki rate limit
// API listesi yalnizca job'in o ortamda GERCEKTEN calistigi sunuculardaki konfigurasyonlari sunar
// (choice-sources 'nginx-api-gateway-confs'); liste job'la ayrisirsa secilen API job'un
// sunucularinda bulunmaz.
const API_GENERATOR_NONPROD = {
  DEV: ['GBNGWD01', 'GBNGWD02'],
  TEST: ['GBNGWT03', 'GBNGWT04'],
  QA: ['GBNGWQ01', 'GBNGWQ02'],
};

/**
 * API Generator'ın bir ortam (+ production'da `site`) için çalıştığı sunucular — playbook'taki
 * play listeleri ve `site_ok` kuralıyla aynı: boş / all / hepsi / tumu / tümü = hepsi, pendik =
 * GBNGWP*, ankara = GBNGWAP* (GBNGX* yalnız "hepsi"de). Tanınmayan site boş liste döner (job da durur).
 * @param {string} env dev / test / qa / prod (harf duyarsız; production = prod)
 * @param {string} [site]
 * @returns {string[]}
 */
function apiGeneratorHosts(env, site, channel) {
  const e = UP(env) === 'PRODUCTION' ? 'PROD' : UP(env);
  if (e !== 'PROD') return (API_GENERATOR_NONPROD[e] || []).slice();
  const s = String(site || '').trim().toLowerCase();
  // Kanal (mblcustomers / customers / mcustomers) production'da kumeyi belirler: o kanalin API'leri
  // yalniz o kumenin sunucularindadir. Tanınmayan / boş kanal daraltmaz.
  const kume = apiCluster(channel);
  const all = (kume ? [kume] : API_CLUSTERS).reduce((a, c) => a.concat(c.hosts.map(UP)), []);
  if (['', 'all', 'hepsi', 'tumu', 'tümü'].includes(s)) return all;
  if (s === 'pendik') return all.filter((h) => /^GBNGWP/.test(h));
  if (s === 'ankara') return all.filter((h) => /^GBNGWAP/.test(h));
  return [];
}

/** Kanal adına (harf duyarsız) karşılık gelen production kümesi; yoksa null. */
function apiCluster(channel) {
  const k = String(channel || '').trim().toLowerCase();
  return (k && API_CLUSTERS.find((c) => c.key === k)) || null;
}

module.exports = { API_CLUSTERS, API_GENERATOR_NONPROD, apiGeneratorHosts, apiCluster, clusterCoverage };
