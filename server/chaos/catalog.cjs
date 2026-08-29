// server/chaos/catalog.cjs — cluster agaci, namespace listesi ve yetki suzgeci.
//
// YENI KOD YAZILMIYOR: cluster agaci LogX'in `ocp_cluster_index` okuyucusundan,
// namespace listesi `ocp-catalog` (dbo.Openshift_Inventory ∪ tarama onbellegi)
// birlesiminden geliyor. Chaos'a ozel olan tek sey YETKI SUZGECI'nin uygulanma yeri.
'use strict';

const adminData = require('../logx/v2/admin.cjs');
const ocpCatalog = require('../logx/v2/ocp-catalog.cjs');
const restrictions = require('../logx/v2/restrictions.cjs');

// Kisitlama anahtarlari LogX ile AYNI bicimde — tablo PAYLASILIYOR. "Log cekemedigi bir
// namespace'te replica durdurabiliyor" celiskisi olusamasin diye bilincli.
const nsKey = (tenant, env, cluster, namespace) => `${tenant}/${env}/${cluster}/${namespace}`;
const appKey = (tenant, env, cluster, namespace, app) => `${nsKey(tenant, env, cluster, namespace)}/${app}`;

async function getClusterTree() {
  return adminData.getClusterTree();
}

// Namespace listesi + yetki suzgeci.
//
// SIZINTIYA DIKKAT: yalnizca `items` degil, `counts`/`sources`/`clusters` haritalari da
// suzuluyor. Aksi halde kisitli bir namespace'in ADI listede gorunmese bile VARLIGI
// sayaclardan sizardi — LogX'te bu ayni sebeple duzeltilmisti.
async function getNamespaces({ env, tenant, clusterNames, user }) {
  const cat = await ocpCatalog.getNamespaces({ env, tenant, clusterNames });
  const items = Array.isArray(cat.items) ? cat.items : [];

  // Bir namespace, gruptaki cluster'lardan HERHANGI BIRINDE aciksa listede kalir;
  // calistirma aninda her (cluster, namespace) cifti AYRICA denetlenir (bkz.
  // assertNamespaceAllowed). Liste ekrani ile calistirma kapisi ayni katiliga sahip
  // olmak zorunda degil — liste daha genis olabilir, kapi asla daha gevsek olamaz.
  const allowedSet = new Set();
  for (const cluster of clusterNames) {
    const keys = items.map((ns) => nsKey(tenant, env, cluster, ns));
    const allowed = await restrictions.filterAllowed('ocp_namespace', keys, user);
    for (const k of allowed) allowedSet.add(k.split('/').pop());
  }

  const filtered = items.filter((ns) => allowedSet.has(ns));
  const pick = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    const out = {};
    for (const ns of filtered) if (ns in obj) out[ns] = obj[ns];
    return out;
  };
  return {
    items: filtered,
    counts: pick(cat.counts),
    sources: pick(cat.sources),
    clusters: pick(cat.clusters),
    cached: cat.cached, fetchedAt: cat.fetchedAt, stale: cat.stale, source: cat.source,
    hiddenCount: items.length - filtered.length,
  };
}

// Calistirma kapisi. Her (cluster x namespace) cifti icin ayri ayri; gruptaki TEK bir
// cluster'da kisit varsa istegin TAMAMI reddedilir (fail-safe — kismi calistirmak,
// kullanicinin yetkisi olmadigi bir yere dokunmasi demek olurdu).
async function assertNamespaceAllowed({ env, tenant, clusters, namespace, user }) {
  for (const cluster of clusters) {
    await restrictions.assertAllowed('ocp_namespace', nsKey(tenant, env, cluster, namespace), user);
  }
}

// Uygulama bazli kisit — `ocp_app` kaynak tipi (2026-08-29'da eklendi).
// Namespace kisiti GECSE BILE ayrica degerlendirilir: "bu namespace'te yalnizca su
// uygulamalara dokunabilsin" demek mumkun olsun diye.
async function assertAppsAllowed({ env, tenant, clusters, namespace, apps, user }) {
  for (const cluster of clusters) {
    for (const app of apps) {
      await restrictions.assertAllowed('ocp_app', appKey(tenant, env, cluster, namespace, app), user);
    }
  }
}

// Cluster'in gercekten bu env/tenant altinda ve AKTIF oldugunu dogrular.
// ANTI-TOCTOU: client'in gonderdigi listeye asla guvenilmez, her calistirmada taze cozulur.
async function assertClustersExist({ env, tenant, clusters }) {
  for (const c of clusters) {
    const ok = await adminData.clusterExists(env, tenant, c);
    if (!ok) throw Object.assign(new Error(`Cluster tanımlı/aktif değil: ${c}`), { status: 400 });
  }
}

// "Su an durdurulmus" listesini kullanicinin yetkisine gore suzer.
//
// NEDEN GEREKLI: `/stopped` yalnizca env+tenant aliyor, namespace ALMIYOR — yani
// resolveScope'tan gecmiyor. Suzgec olmadan, kisitli bir namespace'in ADI ve orada
// durdurulmus uygulamalar, o namespace'i GOREMEYEN bir kullaniciya listeleniyordu.
// Namespace listesinde adin sizmasini onlemek icin ozenle ugrasip (bkz. getNamespaces'teki
// `pick`) burada sizdirmak tutarsizlik olurdu.
//
// TEK sorgu: `filterAllowed` tum kisitlama satirlarini bir kerede okur (dongude
// `isAllowed` cagirmak 500 kayitta 500 sorgu demekti).
async function filterStoppedForUser(rows, { env, tenant, user }) {
  const keys = [...new Set(rows.map((r) => nsKey(tenant, env, r.clusterName, r.namespace)))];
  if (keys.length === 0) return rows;
  const allowed = new Set(await restrictions.filterAllowed('ocp_namespace', keys, user));
  return rows.filter((r) => allowed.has(nsKey(tenant, env, r.clusterName, r.namespace)));
}

module.exports = {
  nsKey, appKey, getClusterTree, getNamespaces,
  assertNamespaceAllowed, assertAppsAllowed, assertClustersExist,
  filterStoppedForUser,
};
