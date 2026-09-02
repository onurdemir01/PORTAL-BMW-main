// server/scalex/catalog.cjs — cluster agaci, namespace listesi ve yetki suzgeci.
//
// YENI KOD YAZILMIYOR: cluster agaci LogX'in `ocp_cluster_index` okuyucusundan,
// namespace listesi `ocp-catalog` (dbo.Openshift_Inventory ∪ tarama onbellegi)
// birlesiminden geliyor. ScaleX'a ozel olan tek sey YETKI SUZGECI'nin uygulanma yeri.
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

// ── UYGULAMA LISTESI: ONCE DB, CANLI VERI SONRA ─────────────────────────────
//
// ScaleX bu katmanin YARISINI zaten kullaniyordu: namespace listesi
// `ocpCatalog.getNamespaces` ile ANINDA DB'den geliyor. Uygulama listesi ise tek
// yoldan, canli AWX kesfinden geliyordu ve `WorkloadStep` HER MOUNT'ta kosulsuz bir
// kesif isi aciyordu — sihirbazda ileri-geri gidildikce tekrar tekrar. Olcum: cluster
// basina ~10+3N `oc` cagrisi ve cluster'lar SIRALI, yani 3 cluster'li bir namespace'te
// 1.5-3 dakika.
//
// Artik ad/tip listesi ANINDA doner (`dbo.Openshift_Inventory` ∪ `ocp_app_cache` —
// bkz. docs/OCP-NAMESPACE-KATALOGU-KARARI.md, mimari ONUR'UN KARARI ve bu degisiklik
// onu DEGISTIRMIYOR, ScaleX'i ona BAGLIYOR). Replica/HPA/GitOps/durum gibi CANLI veri
// ONBELLEKLENMEZ: bayat bir `restorable` "Geri Al"i acar ve is `STATE;FAIL` ile duser,
// bayat bir `specReplicas` geri almayi yanlis sayiya dondurur. Onlari ekran canli
// kesiften bekler.
//
// YETKI: `ocp_app` kisiti LISTE yolunda da uygulanir — bugun yalnizca `resolveScope`
// ve `/adopt` yolunda calisiyordu, yani kullanici goremedigi bir uygulamayi listede
// GORUYOR, yalnizca calistiramiyordu.
async function listApps({ env, tenant, clusterNames, namespace, user }) {
  const cat = await ocpCatalog.getApps({ env, tenant, clusterNames, namespace });
  const items = Array.isArray(cat.items) ? cat.items : [];
  if (!items.length) {
    return { items: [], clusters: {}, sources: {}, hiddenCount: 0,
      cached: cat.cached, fetchedAt: cat.fetchedAt, stale: cat.stale,
      scannedAt: cat.scannedAt, scannedEmpty: cat.scannedEmpty, source: cat.source };
  }

  const clustersOf = (name) => {
    const c = cat.clusters && cat.clusters[name];
    return Array.isArray(c) && c.length ? c : clusterNames;
  };
  const keys = [];
  for (const it of items) {
    for (const c of clustersOf(it.name)) keys.push(appKey(tenant, env, c, namespace, it.name));
  }
  const allowed = new Set(await restrictions.filterAllowed('ocp_app', [...new Set(keys)], user));
  // Bir uygulama, gruptaki cluster'lardan HERHANGI BIRINDE aciksa listede kalir;
  // calistirma aninda her (cluster, uygulama) cifti AYRICA denetlenir
  // (bkz. assertAppsAllowed). Liste daha genis olabilir, kapi asla daha gevsek olamaz.
  const visible = items.filter((it) =>
    clustersOf(it.name).some((c) => allowed.has(appKey(tenant, env, c, namespace, it.name))));

  const pick = (obj) => {
    if (!obj || typeof obj !== 'object') return {};
    const out = {};
    for (const it of visible) if (it.name in obj) out[it.name] = obj[it.name];
    return out;
  };
  return {
    items: visible,
    clusters: pick(cat.clusters),
    sources: pick(cat.sources),
    // GIZLENEN SAYISI SOYLENIR: soylemeden "uygulama yok" demek yanlis bilgi olurdu
    // (ayni gerekce: getNamespaces).
    hiddenCount: items.length - visible.length,
    cached: cat.cached, fetchedAt: cat.fetchedAt, stale: cat.stale,
    scannedAt: cat.scannedAt, scannedEmpty: cat.scannedEmpty, source: cat.source,
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
// ANAHTAR SATIRIN KENDISINDEN kurulur, parametreden DEGIL. Kapsamsiz listede
// (hizli aksiyon paneli) satirlar farkli env/tenant'lardan gelir; parametreden kurmak
// hepsini tek bir kapsamin anahtariyla sorgular ve `filterAllowed` VARSAYILAN-ACIK
// oldugu icin hicbiri eslesmeyince HEPSI GORUNURDU — sessiz bir fail-open.
//
// ARGUMAN SIRASI: `nsKey(tenant, env, ...)` — tenant ONCE. Ters yazmak da ayni sessiz
// fail-open'i uretir (uretilen anahtar hicbir kisit satiriyla eslesmez), o yuzden
// kisitli bir satirin GERCEKTEN suzuldugunu dogrulayan bir test var.
function stoppedKey(r, fallback = {}) {
  return nsKey(r.tenant ?? fallback.tenant, r.env ?? fallback.env, r.clusterName, r.namespace);
}

async function filterStoppedForUser(rows, { env, tenant, user } = {}) {
  const keys = [...new Set(rows.map((r) => stoppedKey(r, { env, tenant })))];
  if (keys.length === 0) return rows;
  const allowed = new Set(await restrictions.filterAllowed('ocp_namespace', keys, user));
  return rows.filter((r) => allowed.has(stoppedKey(r, { env, tenant })));
}

module.exports = {
  listApps,
  nsKey, appKey, getClusterTree, getNamespaces,
  assertNamespaceAllowed, assertAppsAllowed, assertClustersExist,
  filterStoppedForUser,
};
