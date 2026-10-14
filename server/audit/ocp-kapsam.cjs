// server/audit/ocp-kapsam.cjs - OpenShift ortam kapsami: Uygulama ve Route ekranlarinin ORTAK kurucusu.
//
// Denetim > OpenShift (dbo.Openshift_Inventory, satir = uygulama) ve Denetim > OpenShift Route
// (dbo.BMW_Openshift_Route_Inventory, satir = namespace tabani + route adi; kullanici 2026-10-14:
// "bunun aynisini Route envanteri icinde yapabilir miyiz?") AYNI soruyu sorar: bu satir hangi
// ortamda var, o ortamin kac cluster'inda. Iki ekranin sayilari ayni kuraldan cikmali; bu yuzden
// gruplama, desen ozeti ve resmi kume burada TEK yerde.
//
// Ortam NAMESPACE son ekinden gelir (ocp-platforms.envOfNamespace) - cluster'dan DEGIL. Eki
// olmayan namespace (operator/altyapi) sayilmaz, `skippedNoEnv` olarak SOYLENIR.
//
// OLCULEMEDI != YOK: resmi listedeki bir cluster'in sorgu sonucunda HIC satiri yoksa (o platformun
// hicbir namespace'i yok) bu buyuk olasilikla o cluster'a o kosuda girilemedi demektir (route job'i
// cluster basina `oc login`; basarisizsa satir yazilmaz, tablo her kosuda bastan yazilir). Boyle bir
// cluster `veriYok: true` ile isaretlenir; ekran onu n'ye katmaz, "veri yok" diye ayrica gosterir.
'use strict';

const { ENVS, envOfNamespace } = require('./ocp-platforms.cjs');
const { envClustersResmi } = require('./ocp-clusters.cjs');

/**
 * @param {Iterable<{cluster: string, namespace: string, application: string, key?: string, alt?: string}>} kayitlar
 * @param {Record<string, string[]>|undefined} resmi platformun resmi ortam -> cluster listesi (yoksa veriden)
 * @param {{ envs?: string[] }} [secenek] yalniz bu ortamlar (Route ekrani: ['prod']). Disarida kalan
 *   ortamin kaydi satir uretmez ama o cluster'in OLCULDUGUNU gosterir (veriYok hesabina girer).
 */
function kapsamKur(kayitlar, resmi, { envs = ENVS } = {}) {
  const apps = new Map();
  const gorulen = new Set();
  let skippedNoEnv = 0;
  for (const r of kayitlar || []) {
    if (r.cluster) gorulen.add(String(r.cluster).toLowerCase());
    const env = envOfNamespace(r.namespace);
    if (!env) {
      skippedNoEnv++;
      continue;
    }
    if (!envs.includes(env)) continue;
    const key = r.key || r.application;
    if (!apps.has(key)) {
      apps.set(key, {
        application: r.application,
        ...(r.key ? { key: r.key } : {}),
        ...(r.alt ? { alt: r.alt } : {}),
        envs: {},
      });
    }
    const e = apps.get(key).envs;
    if (!e[env]) e[env] = [];
    e[env].push({ cluster: r.cluster, namespace: r.namespace });
  }

  const rows = [...apps.values()]
    .map((a) => {
      const present = envs.filter((e) => a.envs[e]?.length);
      const missing = envs.filter((e) => !a.envs[e]?.length);
      return { ...a, present, missing, missingCount: missing.length };
    })
    .sort((a, b) => a.application.localeCompare(b.application) || String(a.alt || '').localeCompare(String(b.alt || '')));

  // Kismi kapsam BIR HUKUM DEGIL GOZLEMDIR (bkz. ocp-clusters.cjs): cluster basina sayi verilir,
  // "eksik" damgasi vurulmaz.
  const { kumeler: envClusters, kaynak: envClusterKaynagi } = envClustersResmi(apps.values(), envs, resmi, gorulen);

  // Ozet: hangi "eksik ortam" deseni kac satirda goruluyor (en sik 10).
  const patternCount = new Map();
  for (const r of rows) {
    if (!r.missing.length) continue;
    const k = r.missing.join(',');
    patternCount.set(k, (patternCount.get(k) || 0) + 1);
  }
  const patterns = [...patternCount.entries()]
    .map(([k, n]) => ({ missing: k.split(','), count: n }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalApplications: rows.length,
    completeCount: rows.filter((r) => !r.missing.length).length,
    skippedNoEnv,
    patterns,
    envClusters,
    envClusterKaynagi,
    rows,
  };
}

/**
 * Route envanteri satiri -> kapsam kaydi. Satir kimligi NAMESPACE TABANI + ROUTE ADI: ayni uygulamanin
 * ayni route'u dev/test/qa/prod namespace'lerinde (`<taban>-<ortam>`) ayni satirda bulusur. Yalniz
 * route adiyla gruplamak "api", "web" gibi genel adlari yuzlerce namespace'ten tek satira toplar ve
 * her yerde VAR gibi gosterirdi.
 */
function routeKaydi(r) {
  const ns = String(r.namespace_name || '');
  const env = envOfNamespace(ns);
  const taban = env ? ns.slice(0, ns.length - env.length - 1) : ns;
  const route = String(r.route_name || '');
  return {
    key: `${taban.toLowerCase()}/${route.toLowerCase()}`,
    application: route,
    alt: taban,
    cluster: r.cluster_name,
    namespace: ns,
  };
}

module.exports = { kapsamKur, routeKaydi };
