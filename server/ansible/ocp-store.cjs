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
    // Katalog birlestirme: LogX/OpsX/Telnet sihirbazlarinin cluster agaci
    // (ocp_cluster_index) env+tenant+cluster_name ile anahtarlanir; bu katalogda
    // `tenant` yoktu. Admin bunu doldurdukca kayit ortak agacta da gorunur hale gelir.
    tenant:      String(raw.tenant      || '').trim(),
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
    tenant: r.tenant || '',
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
    `INSERT INTO ansible_ocp_clusters (id, name, display, env, api_url, console_url, token, description, namespace, jump_host, is_active, created_by, tenant)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [c.id, c.name, c.display, c.env, c.apiUrl, c.consoleUrl, c.token, c.description, c.namespace, c.jumpHost, c.isActive !== false, c.createdBy || null, c.tenant || null]
  );
}

// ── Katalog birlestirme (ocp_cluster_index ile ayna) ─────────────────────────
//
// Portalda iki ayri OCP katalogu vardi ve ortak anahtarlari yoktu:
//   ansible_ocp_clusters : id/name/env/api_url/token/jump_host  (Ansible Info + AI)
//   ocp_cluster_index    : env/tenant/cluster_name              (LogX/OpsX/Telnet)
// Birlestirme AŞAMALI yapilir; bu surumde YAZMA iki tarafa da gider (dual-write),
// OKUMA hala eski tablodadir. Boylece her an eski davranisa donulebilir ve veri
// kaybi olmaz. Bir sonraki surumde okuma birlesik tabloya alinabilir.
//
// GUVENLIK NOTU: goc edilen satirlar `is_active = 0` ve tenant yoksa '_atanmadi' ile
// yazilir — getClusterTree/clusterExists yalnizca aktif satirlari okudugu icin admin
// tenant atayip aktive edene kadar sihirbaz agacini KIRLETMEZ.
const UNASSIGNED_TENANT = process.env.OCP_CATALOG_DEFAULT_TENANT || '_atanmadi';

// Bir ansible_ocp_clusters kaydini ocp_cluster_index'te olustur/guncelle (legacy_id ile eslesir).
async function mirrorToIndex(c) {
  const tenant = c.tenant || UNASSIGNED_TENANT;
  const isPlaceholderTenant = tenant === UNASSIGNED_TENANT;
  const { rows } = await db.query(
    `SELECT id FROM ocp_cluster_index WHERE legacy_id = $1`, [c.id]
  );
  if (rows.length) {
    await db.query(
      `UPDATE ocp_cluster_index SET env=$1, tenant=$2, cluster_name=$3, terminal_host=$4,
         display=$5, api_url=$6, console_url=$7, token=$8, description=$9,
         default_namespace=$10, updated_at=GETUTCDATE()
       WHERE legacy_id=$11`,
      [c.env, tenant, c.name, c.jumpHost || null, c.display, c.apiUrl, c.consoleUrl,
       c.token, c.description, c.namespace, c.id]
    );
    return;
  }
  await db.query(
    `INSERT INTO ocp_cluster_index
       (env, tenant, cluster_name, terminal_host, display, api_url, console_url, token,
        description, default_namespace, created_by, legacy_id, source, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'ansible',$13)`,
    [c.env, tenant, c.name, c.jumpHost || null, c.display, c.apiUrl, c.consoleUrl, c.token,
     c.description, c.namespace, c.createdBy || null, c.id,
     // Tenant atanmamissa PASIF gelir (sihirbaz agacina sizmasin).
     isPlaceholderTenant ? 0 : (c.isActive !== false ? 1 : 0)]
  );
}

// Dual-write yardimcisi: ayna yazimi ASLA ana islemi dusurmez (best-effort + log).
async function mirrorSafe(c, action) {
  try {
    await mirrorToIndex(c);
  } catch (e) {
    console.warn(`[OcpStore] ocp_cluster_index aynasi guncellenemedi (${action} ${c?.name}):`, e.message);
  }
}

async function mirrorDeleteSafe(id) {
  try {
    await db.query(`DELETE FROM ocp_cluster_index WHERE legacy_id = $1`, [id]);
  } catch (e) {
    console.warn('[OcpStore] ocp_cluster_index ayna silme hatasi:', e.message);
  }
}

// Tek seferlik/idempotent goc: henuz aynalanmamis TUM ansible_ocp_clusters satirlari
// ocp_cluster_index'e tasinir. Boot'ta calisir; `legacy_id` sayesinde tekrar calismasi
// zararsizdir (var olan satiri gunceller, yenisini olusturmaz).
async function syncClustersIntoIndex() {
  const { rows } = await db.query(`SELECT * FROM ansible_ocp_clusters`);
  let n = 0;
  for (const r of rows) {
    const c = rowToCluster(r);
    try { await mirrorToIndex(c); n++; } catch (e) {
      console.warn(`[OcpStore] '${c.name}' ocp_cluster_index'e tasinamadi:`, e.message);
    }
  }
  if (n) console.log(`[OcpStore] ${n} cluster ocp_cluster_index ile senkronlandi (katalog birlestirme).`);
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
    // Katalog birlestirme: mevcut satirlari ortak indekse aynala (idempotent).
    await syncClustersIntoIndex().catch((e) => console.warn("[OcpStore] indeks senkronu atlandi:", e.message));
    console.log(`[OcpStore] ${_clusters.length} cluster DB'den yuklendi.`);
  } catch (e) {
    console.warn('[OcpStore] DB yuklenemedi, dosya fallback aktif:', e.message);
  }
}

// ── Mutasyonlar (async — once DB, sonra cache) ───────────────────────────────
async function addOcpCluster(cluster) {
  const newCluster = normalizeCluster({ ...cluster, id: randomUUID() });
  await insertClusterRow(newCluster);
  await mirrorSafe(newCluster, "add");   // dual-write: birlesik katalog aynasi
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
    ...(fields.tenant      !== undefined ? { tenant:      fields.tenant }      : {}),
    id,
  });
  await db.query(
    `UPDATE ansible_ocp_clusters SET name=$1, display=$2, env=$3, api_url=$4, console_url=$5,
       token=$6, description=$7, namespace=$8, jump_host=$9, is_active=$10, tenant=$11, updated_at=GETUTCDATE()
     WHERE id=$12`,
    [merged.name, merged.display, merged.env, merged.apiUrl, merged.consoleUrl,
     merged.token, merged.description, merged.namespace, merged.jumpHost, merged.isActive !== false, merged.tenant || null, id]
  );
  await mirrorSafe(merged, "update");
  await reloadCache();
  return merged;
}

async function deleteOcpCluster(id) {
  const { rowCount } = await db.query(`DELETE FROM ansible_ocp_clusters WHERE id = $1`, [id]);
  if (!rowCount) return false;
  await mirrorDeleteSafe(id);
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
  syncClustersIntoIndex, _mirrorToIndex: mirrorToIndex, UNASSIGNED_TENANT,
};
