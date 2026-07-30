// server/ansible/ocp-store.cjs — OCP cluster kayit deposu (DB-tabanli).
// Sema: { id, name, display, env, apiUrl, consoleUrl, token, description, namespace, jumpHost }
// env: "prod" | "test" | "qa" | "dev". Kayitlar ansible_ocp_clusters tablosunda tutulur;
// bellek cache'i senkron okumalar (getOcpClusters) icindir. Eski server/ansible/
// ocp-clusters.json dosyasi ve 'ocp-clusters' blob'u yalnizca tek seferlik goc kaynagidir.
'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const db = require('../db/index.cjs');

const LEGACY_OCP_FILE = path.join(__dirname, 'ocp-clusters.json');

function normalizeCluster(raw) {
  return {
    id: raw.id || randomUUID(),
    name:        String(raw.name        || '').trim(),
    display:     String(raw.display     || raw.name || '').trim(),
    env:         ['prod', 'test', 'qa', 'dev'].includes(raw.env) ? raw.env : 'prod',
    apiUrl:      String(raw.apiUrl      || '').trim(),
    consoleUrl:  String(raw.consoleUrl  || '').trim(),
    token:       String(raw.token       || '').trim(),
    description: String(raw.description || '').trim(),
    namespace:   String(raw.namespace   || '').trim(),
    // AWX inventory'de zaten "oc login" yapilmis bastion/jump host — canli pod/node
    // durumu sorgulari (ocp_pod_status.yml) bunun uzerinden calisir.
    jumpHost:    String(raw.jumpHost    || '').trim(),
    isActive:    raw.isActive !== false,
    createdBy:   raw.createdBy ? String(raw.createdBy).trim() : null,
  };
}

function rowToCluster(r) {
  return {
    id: r.id,
    name: r.name || '',
    display: r.display || r.name || '',
    env: r.env || 'prod',
    apiUrl: r.api_url || '',
    consoleUrl: r.console_url || '',
    token: r.token || '',
    description: r.description || '',
    namespace: r.namespace || '',
    jumpHost: r.jump_host || '',
    isActive: r.is_active === true || r.is_active === 1,
    createdAt: r.created_at || null,
    createdBy: r.created_by || null,
    lastCheckedAt: r.last_checked_at || null,
    connectionStatus: r.connection_status || null,
  };
}

async function insertClusterRow(c) {
  await db.query(
    `INSERT INTO ansible_ocp_clusters (id, name, display, env, api_url, console_url, token, description, namespace, jump_host, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [c.id, c.name, c.display, c.env, c.apiUrl, c.consoleUrl, c.token, c.description, c.namespace, c.jumpHost, c.isActive !== false, c.createdBy || null]
  );
}

// ── Bellek cache + yukleme ───────────────────────────────────────────────────
let _clusters = null; // null → DB henuz yuklenmedi (fallback: eski dosya/bos)

function readFallback() {
  try {
    if (fs.existsSync(LEGACY_OCP_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(LEGACY_OCP_FILE, 'utf-8'));
      if (Array.isArray(parsed?.clusters)) return parsed.clusters.map(normalizeCluster);
    }
  } catch { /* dosya bozuksa bos liste */ }
  return [];
}

function getOcpClusters() {
  return _clusters ? _clusters.slice() : readFallback();
}

async function reloadCache() {
  const { rows } = await db.query(`SELECT * FROM ansible_ocp_clusters ORDER BY name, id`);
  _clusters = rows.map(rowToCluster);
}

// Tek seferlik goc: tablo bossa eski JSON dosyasi > 'ocp-clusters' blob'u sirasiyla.
async function importLegacyIfEmpty() {
  const { rows } = await db.query(`SELECT COUNT(*) AS n FROM ansible_ocp_clusters`);
  if (Number(rows[0]?.n || 0) > 0) return;

  let source = null;
  try {
    if (fs.existsSync(LEGACY_OCP_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(LEGACY_OCP_FILE, 'utf-8'));
      if (Array.isArray(parsed?.clusters) && parsed.clusters.length) source = parsed.clusters;
    }
  } catch { /* dosya bozuk → blob dene */ }
  if (!source) {
    try {
      const blob = await db.query(`SELECT data FROM portal_config_blobs WHERE name = $1`, ['ocp-clusters']);
      if (blob.rows.length) {
        const parsed = JSON.parse(blob.rows[0].data);
        if (Array.isArray(parsed?.clusters) && parsed.clusters.length) source = parsed.clusters;
      }
    } catch { /* blob yok */ }
  }
  if (!source) return;

  let count = 0;
  for (const raw of source) {
    try { await insertClusterRow(normalizeCluster(raw)); count++; } catch (e) {
      console.warn(`[OcpStore] import satiri eklenemedi (${raw?.name}):`, e.message);
    }
  }
  console.log(`[DB] migrated ocp-clusters (${count} satir)`);
}

async function loadOcpStore() {
  try {
    await importLegacyIfEmpty();
    await reloadCache();
    console.log(`[OcpStore] ${_clusters.length} cluster DB'den yuklendi.`);
  } catch (e) {
    console.warn('[OcpStore] DB yuklenemedi, dosya fallback aktif:', e.message);
  }
}

// ── Mutasyonlar (async — once DB, sonra cache) ───────────────────────────────
async function addOcpCluster(cluster) {
  const newCluster = normalizeCluster({ ...cluster, id: randomUUID() });
  await insertClusterRow(newCluster);
  await reloadCache();
  return newCluster;
}

async function updateOcpCluster(id, fields) {
  const existing = getOcpClusters().find((c) => c.id === id);
  if (!existing) return null;
  const merged = normalizeCluster({
    ...existing,
    ...(fields.name        !== undefined ? { name:        fields.name }        : {}),
    ...(fields.display     !== undefined ? { display:     fields.display }     : {}),
    ...(fields.env         !== undefined ? { env:         fields.env }         : {}),
    ...(fields.apiUrl      !== undefined ? { apiUrl:      fields.apiUrl }      : {}),
    ...(fields.consoleUrl  !== undefined ? { consoleUrl:  fields.consoleUrl }  : {}),
    ...(fields.token       !== undefined ? { token:       fields.token }       : {}),
    ...(fields.description !== undefined ? { description: fields.description } : {}),
    ...(fields.namespace   !== undefined ? { namespace:   fields.namespace }   : {}),
    ...(fields.jumpHost    !== undefined ? { jumpHost:    fields.jumpHost }    : {}),
    ...(fields.isActive    !== undefined ? { isActive:    fields.isActive }    : {}),
    id,
  });
  await db.query(
    `UPDATE ansible_ocp_clusters SET name=$1, display=$2, env=$3, api_url=$4, console_url=$5,
       token=$6, description=$7, namespace=$8, jump_host=$9, is_active=$10, updated_at=GETUTCDATE()
     WHERE id=$11`,
    [merged.name, merged.display, merged.env, merged.apiUrl, merged.consoleUrl,
     merged.token, merged.description, merged.namespace, merged.jumpHost, merged.isActive !== false, id]
  );
  await reloadCache();
  return merged;
}

async function deleteOcpCluster(id) {
  const { rowCount } = await db.query(`DELETE FROM ansible_ocp_clusters WHERE id = $1`, [id]);
  if (!rowCount) return false;
  await reloadCache();
  return true;
}

// Hafif "Baglantiyi Test Et" sonucunu kalici hale getirir (bkz. runner.cjs
// /api/ansible/clusters/:id/test-connection). AWX-playbook tetikleyen "Pod Durumu"
// ozelliginden BAGIMSIZDIR — jump-host gerektirmez.
async function setClusterConnectionStatus(id, status) {
  await db.query(
    `UPDATE ansible_ocp_clusters SET connection_status=$1, last_checked_at=GETUTCDATE() WHERE id=$2`,
    [status, id]
  );
  await reloadCache();
}

module.exports = {
  getOcpClusters, addOcpCluster, updateOcpCluster, deleteOcpCluster, loadOcpStore, setClusterConnectionStatus,
};
