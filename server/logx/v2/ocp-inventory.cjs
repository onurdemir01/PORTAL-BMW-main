// server/logx/v2/ocp-inventory.cjs — dbo.Openshift_Inventory'nin salt-okunur portal ucu.
//
// BU MODUL PORTALDAN BAGIMSIZ BIR ANSIBLE JOB'INA BAGLIDIR: gunluk/periyodik olarak
// TUM cluster'lara baglanip dbo.Openshift_Inventory (cluster, namespace, application)
// tablosunu YENIDEN YAZAN playbook, portal disinda, AWX'te zamanlanmis olarak calisir
// (bkz. openshift_inventory.yml — bu repo'nun DISINDA, middleware_inventory.yml ile
// ayni konvansiyonla tutulur). Portal burada SADECE OKUR — kendi ayrica bir AWX job'i
// TETIKLEMEZ, bu yuzden namespace/uygulama secimi HER ZAMAN aninda doner.
//
// NEDEN VAR (ONUR'UN KARARI — bkz. proje notlari): daha once OpsX ve LogX'in her ikisi
// de aynı sorunu (namespace/uygulama katalogu) FARKLI mekanizmalarla cozmeye
// calisiyordu — biri kullanici-tetikli AWX kesif + paylasimli TTL onbellek
// (server/logx/v2/ocp-cache.cjs), digeri (bu dosya) bagimsiz zamanlanmis toplu tarama.
// Onur, portaldan bagimsiz zamanlanmis is + tek okuma noktasi modelini SECTI. ocp-cache.cjs
// SILINMEDI (LogX'in canli-kesif fallback yolu hala onu kullanir, bkz. LogXWizardPage.tsx
// onRediscover/onDiscover), ama artik birincil kaynak DEGIL. Bu dosyayi/mimariyi
// degistirmeden once ONUR ile konusulmasi gerekir.
'use strict';

const inventoryDb = require('../../inventory/mssql.cjs');

async function getNamespaces({ clusterNames }) {
  const clusters = [...new Set((clusterNames || []).map((c) => String(c || '').trim()).filter(Boolean))];
  if (!clusters.length) return { items: [], cached: false, fetchedAt: null, stale: false, source: null };

  const pool = await inventoryDb.getPool();
  if (!pool) return { items: [], cached: false, fetchedAt: null, stale: false, source: null };

  const req = pool.request();
  clusters.forEach((c, i) => req.input(`c${i}`, c));
  const placeholders = clusters.map((_, i) => `@c${i}`).join(', ');
  // Uygulama SAYISI da alinir: sihirbaz "bu namespace'te kac uygulama var" bilgisini
  // listede rozetle gosterir. Kullanici bos bir namespace'i secip bir dakika beklemek
  // yerine daha secim ekraninda gorur (2026-08-10 kullanici geri bildirimi). Ek maliyet
  // yok — ayni tablo, ayni WHERE, yalnizca bir GROUP BY.
  // CLUSTER kirilimi da alinir: coklu cluster seciminde kullanici bir namespace'in
  // hangi cluster'larda VAR oldugunu gormeli (2026-08-10 kullanici karari: birlesik liste
  // + rozet). `counts` cluster'lar arasi TOPLAM degil, namespace basina ayri ayri
  // toplanir — ayni uygulama iki cluster'da varsa iki kez sayilmaz.
  const result = await req.query(
    `SELECT cluster, namespace, COUNT(DISTINCT application) AS app_count
       FROM dbo.Openshift_Inventory
      WHERE cluster IN (${placeholders})
      GROUP BY cluster, namespace
      ORDER BY namespace`
  );
  const fetchedAt = await latestLoadedAt(pool, clusters);
  const counts = {};
  const clusterMap = {};
  const items = [];
  for (const r of result.recordset) {
    const ns = String(r.namespace || '').trim();
    if (!ns) continue;
    if (!(ns in counts)) { counts[ns] = 0; clusterMap[ns] = []; items.push(ns); }
    // Cluster'lar arasi en YUKSEK sayi: "bu namespace'te kac uygulama var" sorusunun
    // cevabi, cluster'larin toplami degil (ayni uygulama her cluster'da tekrar eder).
    counts[ns] = Math.max(counts[ns], Number(r.app_count || 0));
    const cluster = String(r.cluster || '').trim();
    if (cluster && !clusterMap[ns].includes(cluster)) clusterMap[ns].push(cluster);
  }
  return {
    items,
    counts,
    clusters: clusterMap,
    cached: result.recordset.length > 0,
    fetchedAt,
    stale: false, // tazelik zamanlanmis job'un periyoduyla belirlenir, TTL-bazli degil
    source: 'openshift_inventory',
  };
}

async function getApps({ clusterNames, namespace }) {
  const ns = String(namespace || '').trim();
  const clusters = [...new Set((clusterNames || []).map((c) => String(c || '').trim()).filter(Boolean))];
  if (!ns || !clusters.length) return { items: [], cached: false, fetchedAt: null, stale: false, source: null };

  const pool = await inventoryDb.getPool();
  if (!pool) return { items: [], cached: false, fetchedAt: null, stale: false, source: null };

  const req = pool.request();
  req.input('ns', ns);
  clusters.forEach((c, i) => req.input(`c${i}`, c));
  const placeholders = clusters.map((_, i) => `@c${i}`).join(', ');
  // Cluster kirilimi: ayni uygulama her cluster'da olmayabilir; onyuz farki rozetle
  // gosterir. `kind: 'Unknown'` bilincli — envanter tablosu yalnizca UYGULAMA ADI tutar,
  // obje tipi (Deployment/Pod/Service) yalnizca canli taramadan gelir.
  const result = await req.query(
    `SELECT DISTINCT cluster, application FROM dbo.Openshift_Inventory
      WHERE namespace = @ns AND cluster IN (${placeholders})
      ORDER BY application`
  );
  const fetchedAt = await latestLoadedAt(pool, clusters);
  const clusterMap = {};
  const items = [];
  for (const r of result.recordset) {
    const name = String(r.application || '').trim();
    if (!name) continue;
    if (!(name in clusterMap)) {
      clusterMap[name] = [];
      items.push({ kind: 'Unknown', name, replicas: null, image: null, labelApp: null });
    }
    const cluster = String(r.cluster || '').trim();
    if (cluster && !clusterMap[name].includes(cluster)) clusterMap[name].push(cluster);
  }
  return {
    items,
    clusters: clusterMap,
    cached: result.recordset.length > 0,
    fetchedAt,
    stale: false,
    source: 'openshift_inventory',
  };
}

async function latestLoadedAt(pool, clusters) {
  try {
    const req = pool.request();
    clusters.forEach((c, i) => req.input(`c${i}`, c));
    const placeholders = clusters.map((_, i) => `@c${i}`).join(', ');
    const result = await req.query(
      `SELECT MAX(loaded_at) AS latest FROM dbo.Openshift_Inventory WHERE cluster IN (${placeholders})`
    );
    return result.recordset[0]?.latest || null;
  } catch {
    return null;
  }
}

module.exports = { getNamespaces, getApps };
