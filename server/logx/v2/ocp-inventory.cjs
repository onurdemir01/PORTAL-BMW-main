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
  const result = await req.query(
    `SELECT DISTINCT namespace FROM dbo.Openshift_Inventory WHERE cluster IN (${placeholders}) ORDER BY namespace`
  );
  const fetchedAt = await latestLoadedAt(pool, clusters);
  return {
    items: result.recordset.map((r) => String(r.namespace || '').trim()).filter(Boolean),
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
  const result = await req.query(
    `SELECT DISTINCT application FROM dbo.Openshift_Inventory WHERE namespace = @ns AND cluster IN (${placeholders}) ORDER BY application`
  );
  const fetchedAt = await latestLoadedAt(pool, clusters);
  return {
    items: result.recordset
      .map((r) => ({ kind: 'Unknown', name: String(r.application || '').trim(), replicas: null, image: null, labelApp: null }))
      .filter((i) => i.name),
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
