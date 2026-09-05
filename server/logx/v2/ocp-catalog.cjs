// server/logx/v2/ocp-catalog.cjs — namespace/uygulama katalogunun TEK okuma noktasi.
//
// NEDEN VAR: portalda iki kaynak var ve ikisi de mesru:
//
//   1) dbo.Openshift_Inventory  — BIRINCIL. Portaldan bagimsiz, zamanlanmis bir Ansible
//      job'i besler; secim aninda doner, AWX job'i tetiklenmez.
//      (ONUR'UN KARARI — bkz. docs/OCP-NAMESPACE-KATALOGU-KARARI.md ve ocp-inventory.cjs)
//   2) ocp_namespace_cache / ocp_app_cache — kullanici-tetikli "Bu namespace'i tara"
//      sonuclari + periyodik sync (ocp-sync.cjs).
//
// KIRIK DONGU (bu modulun cozdugu sey): sihirbaz YALNIZCA (1)'i okuyordu, ama "tara"
// butonu sonucu (2)'ye yaziyordu. Yani taramayi tetikleyen kullanici bile sonucu
// goremiyordu; "A kullanicisi tarasin, B faydalansin" hic calismiyordu. Burada iki kaynak
// BIRLESTIRILIR: envanterde olan envanterden, olmayan taramadan gelir.
//
// SINIR — Onur'un karari korunur: bu modul `dbo.Openshift_Inventory`'yi YALNIZCA OKUR.
// Kullanici taramasi yalnizca ocp_*_cache'e yazilmaya devam eder (bkz. ocp.cjs
// finalizeNamespaceDiscovery / finalizeAppDiscovery). Envanter tablosuna portal YAZMAZ.
//
// KISITLAMA: bu modul yetki filtresi UYGULAMAZ. Filtre cagiran uctadir
// (server/logx/v2/index.cjs), cunku kisitlama anahtari tenant/env/cluster/namespace
// birlesiminden kurulur ve uca gore (liste mi, icerik mi) farkli uygulanir.
'use strict';

const inventory = require('./ocp-inventory.cjs');
const cache = require('./ocp-cache.cjs');

// Iki kaynagin tazelik bilgisini birlestirir: en YENI zaman damgasi gosterilir,
// bayatlik ise "herhangi biri bayatsa bayat" kuralindadir (iyimser gosterip kullaniciyi
// eski veriye guvendirmek yanlis olurdu).
function mergeFreshness(a, b) {
  const dates = [a?.fetchedAt, b?.fetchedAt].filter(Boolean).map((d) => new Date(d));
  const newest = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
  return {
    fetchedAt: newest ? newest.toISOString() : null,
    stale: Boolean((a?.cached && a?.stale) || (b?.cached && b?.stale)),
  };
}

// Bir kaynak PATLARSA digeri yine de donmeli — envanter DB'si erisilemezken kullanici
// taramasinin sonucunu gostermemek (ya da tersi) gereksiz bir kesinti olurdu.
async function safe(promise, fallback) {
  try {
    return await promise;
  } catch (e) {
    console.warn('[OcpCatalog] kaynak okunamadi:', e.message);
    return fallback;
  }
}

const EMPTY = { items: [], cached: false, fetchedAt: null, stale: false };

// Donus: { items[], sources: { [ad]: 'inventory'|'discovery' }, cached, fetchedAt, stale }
// `sources` onyuzun her satirin nereden geldigini rozetleyebilmesi icindir.
async function getNamespaces({ env, tenant, clusterNames }) {
  const clusters = [
    ...new Set((clusterNames || []).map((c) => String(c || '').trim()).filter(Boolean)),
  ];
  if (!clusters.length) return { ...EMPTY, items: [], sources: {} };

  const inv = await safe(inventory.getNamespaces({ clusterNames: clusters }), EMPTY);
  const cachedPerCluster = await Promise.all(
    clusters.map((clusterName) => safe(cache.getNamespaces({ env, tenant, clusterName }), EMPTY)),
  );

  const sources = {};
  // Ad → hangi cluster'larda VAR. Coklu cluster seciminde onyuz bunu rozetle gosterir
  // ("bu namespace yalnizca gbocpprod2'de") ve cluster suzgeci bunun uzerinden calisir.
  const clusterMap = {};
  const addCluster = (name, cluster) => {
    if (!cluster) return;
    if (!clusterMap[name]) clusterMap[name] = [];
    if (!clusterMap[name].includes(cluster)) clusterMap[name].push(cluster);
  };

  // ONCE envanter: ayni ad iki kaynakta da varsa envanter kazanir (birincil kaynak).
  for (const ns of inv.items || []) {
    sources[ns] = 'inventory';
    for (const c of inv.clusters?.[ns] || []) addCluster(ns, c);
  }
  cachedPerCluster.forEach((out, i) => {
    for (const ns of out.items || []) {
      if (!sources[ns]) sources[ns] = 'discovery';
      addCluster(ns, clusters[i]); // onbellek cluster BASINA okunur; indis = cluster
    }
  });

  // Namespace basina uygulama SAYISI: envanterden gelir (tek GROUP BY). Onbellekten gelen
  // namespace'ler icin sayi bilinmez — `undefined` kalir ve onyuz "bilinmiyor" gosterir;
  // 0 ile karistirilmamalidir ("uygulama yok" ile "sayilmadi" ayri seylerdir).
  const counts = { ...(inv.counts || {}) };

  const anyCache = cachedPerCluster.find((c) => c.cached) || EMPTY;
  const freshness = mergeFreshness(inv, anyCache);
  return {
    items: Object.keys(sources).sort(),
    sources,
    counts,
    clusters: clusterMap,
    cached: Boolean(inv.cached || cachedPerCluster.some((c) => c.cached)),
    ...freshness,
    // Onyuz rozeti icin: liste tamamen envanterden mi geliyor, karisik mi?
    source:
      inv.cached && cachedPerCluster.every((c) => !c.cached) ? 'openshift_inventory' : 'mixed',
  };
}

// Uygulama listesi. Ayni uygulama iki kaynakta da varsa ONBELLEK kazanir: envanter
// yalnizca ADI biliyor (kind='Unknown', replicas=null), onbellek kind/replica/image de
// tasir — daha zengin kaydi atmak kullaniciyi bilgisiz birakirdi.
async function getApps({ env, tenant, clusterNames, namespace }) {
  const ns = String(namespace || '').trim();
  const clusters = [
    ...new Set((clusterNames || []).map((c) => String(c || '').trim()).filter(Boolean)),
  ];
  if (!ns || !clusters.length) return { ...EMPTY, items: [], sources: {} };

  const inv = await safe(inventory.getApps({ clusterNames: clusters, namespace: ns }), EMPTY);
  const cachedPerCluster = await Promise.all(
    clusters.map((clusterName) =>
      safe(cache.getApps({ env, tenant, clusterName, namespace: ns }), EMPTY),
    ),
  );

  const byName = new Map();
  const sources = {};
  // Ad → cluster listesi (bkz. getNamespaces'teki ayni harita). Pod adlari cluster'a gore
  // FARKLI oldugu icin bu bilgi uygulama ekraninda ozellikle degerli.
  const clusterMap = {};
  const addCluster = (name, cluster) => {
    if (!cluster) return;
    if (!clusterMap[name]) clusterMap[name] = [];
    if (!clusterMap[name].includes(cluster)) clusterMap[name].push(cluster);
  };

  for (const it of inv.items || []) {
    if (!it?.name) continue;
    byName.set(it.name, it);
    sources[it.name] = 'inventory';
    for (const c of inv.clusters?.[it.name] || []) addCluster(it.name, c);
  }
  cachedPerCluster.forEach((out, i) => {
    for (const it of out.items || []) {
      if (!it?.name) continue;
      // Onbellek kaydi daha zengin — envanterin yalin kaydinin UZERINE yazar.
      byName.set(it.name, it);
      if (sources[it.name] !== 'inventory') sources[it.name] = 'discovery';
      addCluster(it.name, clusters[i]);
    }
  });

  const anyCache = cachedPerCluster.find((c) => c.cached) || EMPTY;
  const freshness = mergeFreshness(inv, anyCache);
  // TARAMA KAYDI: cluster'lardan HERHANGI biri "tarandi ve bos cikti" diyorsa sihirbaz
  // otomatik taramayi TEKRARLAMAZ (aksi halde bos bir namespace her girişte yeni bir
  // AWX job'i aciyordu). En yeni tarama zamani gosterilir.
  const scanned = cachedPerCluster.filter((c) => c.scannedAt);
  const scannedAt = scanned.length
    ? new Date(Math.max(...scanned.map((c) => new Date(c.scannedAt).getTime()))).toISOString()
    : null;
  return {
    items: [...byName.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))),
    sources,
    clusters: clusterMap,
    scannedAt,
    scannedEmpty:
      Boolean(scannedAt) &&
      cachedPerCluster.every((c) => c.scannedEmpty !== false) &&
      [...byName.values()].length === 0,
    // Cluster'lardan HERHANGI birinin tarama kaydi OKUNAMADIYSA sihirbaz otomatik
    // tarama yapmaz: kayit okunamadigi surece tarama sonrasi da ayni belirsizlik
    // surer ve her giriş yeni bir AWX job'i acardi (sonsuz dongu).
    scanUnknown: cachedPerCluster.some((c) => c.scanUnknown),
    cached: Boolean(inv.cached || cachedPerCluster.some((c) => c.cached)),
    ...freshness,
    source:
      inv.cached && cachedPerCluster.every((c) => !c.cached) ? 'openshift_inventory' : 'mixed',
  };
}

module.exports = { getNamespaces, getApps };
