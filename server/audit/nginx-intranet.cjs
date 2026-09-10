// server/audit/nginx-intranet.cjs - INTRANET SPA sunucularinda uygulama bazli kapsam.
//
// NEDEN AYRI HESAP: internete acik nginx sunucularinda bir SPA'nin "tanimli" olmasi
// demek, vhost dosyasinda o uygulamaya giden bir location/include cifti bulunmasi
// demektir. Intranet SPA sunucularinda ise <SERVICE>-<ENV>.conf gibi bir servis
// vhost'u HIC YOKTUR - oraya yalnizca OpenShift'teki intranet uygulamalari dagitilir.
// Dolayisiyla oradaki soru "location dogru mu" degil, "uygulama inmis mi"dir ve
// cevabi UC DIZINDEN okunur (bkz. nginx_config_scan.sh):
//
//   /hysdeploy/<ns>/<app>/                              -> hys_deployed
//   /usr/nginx/applications/<ns>/<app>/                  -> app_deployed
//   conf.d/application-confs/<app>-<ns>.conf             -> conf_exists
//
// Ucu birden varsa kurulum TAMDIR. Biri eksikse uygulama pratikte 404 doner ama
// "hic yok"tan farklidir - yarim kalmis bir kurulum, hic baslamamis bir kurulumdan
// BASKA bir istir. Bu yuzden "tam / eksik / yok" UC AYRI kova olarak tutulur;
// ikisini birlestirmek, nerede mudahale gerektigini gizlerdi.
//
// ORTAM: intranet satirinda vhost olmadigi icin ortam DOSYA ADINDAN turetilemez;
// SUNUCU ADINDAN turetilir (nginx-hosts.cjs envOfHost, GBNGXT51 -> EDU istisnasi dahil).
'use strict';

const { envOfHost, tierOfHost, UNKNOWN_ENV } = require('./nginx-hosts.cjs');

/** Uc bayragin hepsi 1 mi? */
function isFull(row) {
  return !!(row.hys && row.app && row.conf);
}

/** Eksik olan kontrol noktalarinin Turkce adlari - ekranda dogrudan gosterilir. */
function missingParts(row) {
  const out = [];
  if (!row.hys) out.push('hysdeploy');
  if (!row.app) out.push('applications');
  if (!row.conf) out.push('conf');
  return out;
}

/**
 * dbo.Nginx_Intranet_Audit satirlarini ortam -> uygulama -> sunucu seklinde indeksler.
 *
 * @param {Array<{host,namespace,application,hys_deployed,app_deployed,conf_exists,status}>} rows
 * @returns {Map<string, Map<string, {name, namespace, hosts: Array}>>}
 */
function indexIntranetRows(rows) {
  const byEnv = new Map();
  for (const r of rows || []) {
    const host = String(r.host || '')
      .trim()
      .toUpperCase();
    const app = String(r.application || '').trim();
    const ns = String(r.namespace || '').trim();
    if (!host || !app) continue;
    // INTRANET OLMAYAN bir host bu tabloya dusmemeli; dustuyse SESSIZCE saymak
    // yerine atlanir - internet sunucusunun dizinlerini intranet kapsamina katmak
    // orani oldugundan iyi gosterirdi.
    if (tierOfHost(host) !== 'intranet') continue;
    const env = envOfHost(host);
    if (!byEnv.has(env)) byEnv.set(env, new Map());
    const bucket = byEnv.get(env);
    const key = app.toLowerCase();
    if (!bucket.has(key)) bucket.set(key, { name: app, namespace: ns, hosts: [] });
    bucket.get(key).hosts.push({
      host,
      namespace: ns,
      hys: !!r.hys_deployed,
      app: !!r.app_deployed,
      conf: !!r.conf_exists,
      status: String(r.status || '').trim(),
    });
  }
  return byEnv;
}

/**
 * Bir ortam icin intranet kapsamini cikarir.
 *
 * @param {string[]} expected  o ortamda OpenShift'te INTRANET (reencrypt) olan SPA adlari
 * @param {Map} found          indexIntranetRows'un o ortama ait kovasi (yoksa undefined)
 * @param {number} cap         listelerin en fazla kac ad tasiyacagi
 */
function coverageForEnv(expected, found, cap = 300) {
  const sortTr = (a, b) => a.localeCompare(b, 'tr');
  const bucket = found || new Map();
  // OLCULEBILIRLIK: o ortamda hic intranet satiri yoksa kapsam OLCULEMEZ. "%0" demek
  // ile "olculemedi" demek ayni sey degildir - biri alarm, digeri eksik veridir.
  const measured = bucket.size > 0;

  const full = [];
  const partial = [];
  const missing = [];

  for (const name of expected) {
    const hit = bucket.get(String(name).toLowerCase());
    if (!hit) {
      missing.push(name);
      continue;
    }
    // TEK BIR sunucuda tam kurulum varsa uygulama "tam" sayilir; ayni ortamda birden
    // cok intranet sunucusu var (prod'da dort tane) ve bunlar birbirinin aynasi degil.
    // Hangi sunucuda eksik oldugu 'hosts' icinde duruyor, ekranda gosteriliyor.
    if (hit.hosts.some(isFull)) full.push(hit.name);
    else
      partial.push({
        app: hit.name,
        namespace: hit.namespace,
        hosts: hit.hosts.map((h) => ({ host: h.host, missing: missingParts(h) })),
      });
  }

  // Sunucuda var ama OpenShift'in intranet listesinde yok: retire olmus ya da
  // route tipi degismis olabilir. Bulgu degil, BILGI.
  const expectedSet = new Set(expected.map((a) => String(a).toLowerCase()));
  const onlyOnServer = [];
  for (const [k, v] of bucket) if (!expectedSet.has(k)) onlyOnServer.push(v.name);

  const hosts = new Set();
  for (const v of bucket.values()) for (const h of v.hosts) hosts.add(h.host);

  return {
    measured,
    total: expected.length,
    fullCount: full.length,
    partialCount: partial.length,
    missingCount: missing.length,
    full: full.sort(sortTr).slice(0, cap),
    partial: partial.sort((a, b) => sortTr(a.app, b.app)).slice(0, cap),
    missing: missing.sort(sortTr).slice(0, cap),
    onlyOnServerCount: onlyOnServer.length,
    onlyOnServer: onlyOnServer.sort(sortTr).slice(0, cap),
    hosts: [...hosts].sort(),
    // Kapsam YALNIZCA TAM kurulumlar uzerinden. Yarim kurulumu "kapsandi" saymak,
    // 404 donen bir uygulamayi yesil gostermek olurdu.
    coverage:
      measured && expected.length
        ? Math.round((full.length / expected.length) * 1000) / 10
        : null,
  };
}

module.exports = {
  indexIntranetRows,
  coverageForEnv,
  _isFull: isFull,
  _missingParts: missingParts,
  _UNKNOWN_ENV: UNKNOWN_ENV,
};
