// server/logx/v2/admin.cjs — OCP cluster hiyerarsisi, terminal/bastion host eslemesi ve
// Legacy ortam-etiketi son-ek eslemesi icin admin CRUD veri erisimi. Route wiring
// server/logx/v2/index.cjs'de yapilir (bu dosya yalnizca veri katmani).
'use strict';

const db = require('../../db/index.cjs');

// MSSQL unique-constraint ihlali (2627 = PRIMARY/UNIQUE KEY, 2601 = unique index). Duplicate
// ekleme yakalanmazsa yakalanmamis hata → 500. Bunu dostca 409'a ceviririz.
function isUniqueViolation(err) {
  const n = err && (err.number ?? (err.originalError && err.originalError.info && err.originalError.info.number));
  return n === 2627 || n === 2601 || /duplicate key|cannot insert duplicate|unique/i.test((err && err.message) || '');
}
async function insertOrConflict(runQuery, dupMsg) {
  try {
    return await runQuery();
  } catch (err) {
    if (isUniqueViolation(err)) throw Object.assign(new Error(dupMsg), { status: 409, code: 'conflict' });
    throw err;
  }
}

// ── ocp_cluster_index ────────────────────────────────────────────────────────

async function listClusterIndex() {
  const { rows } = await db.query(
    `SELECT * FROM ocp_cluster_index ORDER BY env, tenant, cluster_name`
  );
  return rows.map(normalizeBit);
}

// Yalnizca aktif satirlardan, sihirbaz icin { env: { tenant: [cluster,...] } } agaci uretir.
async function getClusterTree() {
  const { rows } = await db.query(
    `SELECT env, tenant, cluster_name FROM ocp_cluster_index WHERE is_active = 1 ORDER BY env, tenant, cluster_name`
  );
  const tree = {};
  for (const row of rows) {
    tree[row.env] ??= {};
    tree[row.env][row.tenant] ??= [];
    tree[row.env][row.tenant].push(row.cluster_name);
  }
  return tree;
}

async function createClusterIndexRow(data) {
  const { env, tenant, cluster_name, is_active } = data;
  if (!env || !tenant || !cluster_name) {
    throw Object.assign(new Error('env, tenant ve cluster_name zorunlu.'), { status: 400 });
  }
  const { rows } = await insertOrConflict(
    () => db.query(
      `INSERT INTO ocp_cluster_index (env, tenant, cluster_name, is_active)
       OUTPUT INSERTED.*
       VALUES ($1,$2,$3,$4)`,
      [env, tenant, cluster_name, is_active !== false ? 1 : 0]
    ),
    `Bu kayıt zaten var: ${env}/${tenant}/${cluster_name}.`
  );
  return normalizeBit(rows[0]);
}

async function updateClusterIndexRow(id, data) {
  const { env, tenant, cluster_name, is_active } = data;
  const { rows } = await db.query(
    `UPDATE ocp_cluster_index SET env=$1, tenant=$2, cluster_name=$3, is_active=$4, updated_at=GETUTCDATE()
     OUTPUT INSERTED.*
     WHERE id=$5`,
    [env, tenant, cluster_name, is_active !== false ? 1 : 0, id]
  );
  return rows[0] ? normalizeBit(rows[0]) : null;
}

async function deleteClusterIndexRow(id) {
  const { rowCount } = await db.query(`DELETE FROM ocp_cluster_index WHERE id = $1`, [id]);
  return rowCount > 0;
}

// (env,tenant,cluster_name) uclusunun aktif olarak var olup olmadigini dogrular —
// discover-fetch/namespace-discover launch'lerinden once client'in gonderdigi secimin
// gercek bir admin-tanimli kaynaga karsilik geldigini garanti eder.
async function clusterExists(env, tenant, clusterName) {
  const { rows } = await db.query(
    `SELECT 1 FROM ocp_cluster_index WHERE env=$1 AND tenant=$2 AND cluster_name=$3 AND is_active=1`,
    [env, tenant, clusterName]
  );
  return rows.length > 0;
}

// ── ocp_terminal_host_map ────────────────────────────────────────────────────

async function listTerminalHostMap() {
  const { rows } = await db.query(`SELECT * FROM ocp_terminal_host_map ORDER BY tenant, env`);
  return rows.map(normalizeBit);
}

async function getTerminalHost(tenant, env) {
  const { rows } = await db.query(
    `SELECT terminal_host FROM ocp_terminal_host_map WHERE tenant=$1 AND env=$2 AND is_active=1`,
    [tenant, env]
  );
  return rows[0]?.terminal_host || null;
}

async function createTerminalHostRow(data) {
  const { tenant, env, terminal_host, is_active } = data;
  if (!tenant || !env || !terminal_host) {
    throw Object.assign(new Error('tenant, env ve terminal_host zorunlu.'), { status: 400 });
  }
  const { rows } = await insertOrConflict(
    () => db.query(
      `INSERT INTO ocp_terminal_host_map (tenant, env, terminal_host, is_active)
       OUTPUT INSERTED.*
       VALUES ($1,$2,$3,$4)`,
      [tenant, env, terminal_host, is_active !== false ? 1 : 0]
    ),
    `Bu tenant/env için terminal host zaten tanımlı: ${tenant}/${env}.`
  );
  return normalizeBit(rows[0]);
}

async function updateTerminalHostRow(id, data) {
  const { tenant, env, terminal_host, is_active } = data;
  const { rows } = await db.query(
    `UPDATE ocp_terminal_host_map SET tenant=$1, env=$2, terminal_host=$3, is_active=$4, updated_at=GETUTCDATE()
     OUTPUT INSERTED.*
     WHERE id=$5`,
    [tenant, env, terminal_host, is_active !== false ? 1 : 0, id]
  );
  return rows[0] ? normalizeBit(rows[0]) : null;
}

async function deleteTerminalHostRow(id) {
  const { rowCount } = await db.query(`DELETE FROM ocp_terminal_host_map WHERE id = $1`, [id]);
  return rowCount > 0;
}

// ── logx_env_suffix_map ──────────────────────────────────────────────────────

async function listEnvSuffixMap() {
  const { rows } = await db.query(`SELECT * FROM logx_env_suffix_map ORDER BY sort_order, suffix`);
  return rows.map(normalizeBit);
}

async function createEnvSuffixRow(data) {
  const { suffix, env_label, sort_order, is_active } = data;
  if (env_label === undefined || env_label === null || !String(env_label).trim()) {
    throw Object.assign(new Error('env_label zorunlu.'), { status: 400 });
  }
  const { rows } = await insertOrConflict(
    () => db.query(
      `INSERT INTO logx_env_suffix_map (suffix, env_label, sort_order, is_active)
       OUTPUT INSERTED.*
       VALUES ($1,$2,$3,$4)`,
      [suffix ?? '', env_label, sort_order ?? 0, is_active !== false ? 1 : 0]
    ),
    `Bu son-ek zaten tanımlı: "${suffix ?? ''}".`
  );
  return normalizeBit(rows[0]);
}

async function updateEnvSuffixRow(id, data) {
  const { suffix, env_label, sort_order, is_active } = data;
  const { rows } = await db.query(
    `UPDATE logx_env_suffix_map SET suffix=$1, env_label=$2, sort_order=$3, is_active=$4, updated_at=GETUTCDATE()
     OUTPUT INSERTED.*
     WHERE id=$5`,
    [suffix ?? '', env_label, sort_order ?? 0, is_active !== false ? 1 : 0, id]
  );
  return rows[0] ? normalizeBit(rows[0]) : null;
}

async function deleteEnvSuffixRow(id) {
  const { rowCount } = await db.query(`DELETE FROM logx_env_suffix_map WHERE id = $1`, [id]);
  return rowCount > 0;
}

// EAR klasor adindan ("-T","-D", son-ek-yok) en uzun eslesen son-eke gore ortam etiketini
// doner (orn. "GBCEPPOSDASHBOARD-T.ear" -> "-T" -> "TEST"). Eslesme yoksa "PROD" varsayilan.
async function resolveEnvLabel(folderName, suffixRows) {
  const upper = String(folderName || '').replace(/\.ear$/i, '');
  const activeRows = suffixRows.filter((r) => r.is_active !== false && r.is_active !== 0);
  const candidates = activeRows.filter((r) => r.suffix && upper.endsWith(r.suffix));
  candidates.sort((a, b) => b.suffix.length - a.suffix.length);
  if (candidates.length > 0) return candidates[0].env_label;
  const noSuffixRow = activeRows.find((r) => !r.suffix);
  return noSuffixRow ? noSuffixRow.env_label : 'PROD';
}

function normalizeBit(row) {
  return { ...row, is_active: row.is_active === true || row.is_active === 1 };
}

// ── PII maskeleme kurallari (logx_mask_rules) — admin CRUD ───────────────────
// Kural sirasi (sort_order) regex calisma sirasidir; PHONE_GEN, TCKN'den sonra kalmali.
async function listMaskRules() {
  const { rows } = await db.query(`SELECT * FROM logx_mask_rules ORDER BY sort_order, id`);
  return rows.map(normalizeBit);
}

function validateMaskRule(data) {
  const name = String(data.name || '').trim();
  const pattern = String(data.pattern || '').trim();
  const flags = String(data.flags || 'g').trim() || 'g';
  const replacement = String(data.replacement ?? '').trim();
  if (!name) throw Object.assign(new Error('name zorunlu.'), { status: 400 });
  if (!pattern) throw Object.assign(new Error('pattern zorunlu.'), { status: 400 });
  if (!replacement) throw Object.assign(new Error('replacement zorunlu.'), { status: 400 });
  if (!/^[gimsuy]*$/.test(flags)) throw Object.assign(new Error('flags gecersiz.'), { status: 400 });
  try { new RegExp(pattern, flags); } catch (e) {
    throw Object.assign(new Error(`pattern derlenemedi: ${e.message}`), { status: 400 });
  }
  return { name, pattern, flags, replacement };
}

async function createMaskRule(data) {
  const v = validateMaskRule(data);
  const sortOrder = Number(data.sort_order ?? data.sortOrder ?? 0) || 0;
  const enabled = data.enabled === false || data.enabled === 0 ? 0 : 1;
  return insertOrConflict(
    () => db.query(
      `INSERT INTO logx_mask_rules (name, pattern, flags, replacement, sort_order, enabled)
       OUTPUT INSERTED.* VALUES ($1, $2, $3, $4, $5, $6)`,
      [v.name, v.pattern, v.flags, v.replacement, sortOrder, enabled]
    ).then((r) => normalizeBit(r.rows[0])),
    'Bu isimde bir kural zaten var.'
  );
}

async function updateMaskRule(id, data) {
  const v = validateMaskRule(data);
  const sortOrder = Number(data.sort_order ?? data.sortOrder ?? 0) || 0;
  const enabled = data.enabled === false || data.enabled === 0 ? 0 : 1;
  const { rows } = await db.query(
    `UPDATE logx_mask_rules SET name=$1, pattern=$2, flags=$3, replacement=$4, sort_order=$5, enabled=$6, updated_at=GETUTCDATE()
     OUTPUT INSERTED.* WHERE id=$7`,
    [v.name, v.pattern, v.flags, v.replacement, sortOrder, enabled, Number(id)]
  );
  return rows.length ? normalizeBit(rows[0]) : null;
}

async function deleteMaskRule(id) {
  const { rowCount } = await db.query(`DELETE FROM logx_mask_rules WHERE id = $1`, [Number(id)]);
  return rowCount > 0;
}

module.exports = {
  listClusterIndex, getClusterTree, createClusterIndexRow, updateClusterIndexRow, deleteClusterIndexRow, clusterExists,
  listTerminalHostMap, getTerminalHost, createTerminalHostRow, updateTerminalHostRow, deleteTerminalHostRow,
  listEnvSuffixMap, createEnvSuffixRow, updateEnvSuffixRow, deleteEnvSuffixRow, resolveEnvLabel,
  listMaskRules, createMaskRule, updateMaskRule, deleteMaskRule,
};
