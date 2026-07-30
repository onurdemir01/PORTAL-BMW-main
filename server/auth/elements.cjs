// server/auth/elements.cjs — portal_elements + portal_element_visibility veri erisimi (admin
// CRUD). Gorunurluk motorunun (visibility.cjs) yazma tarafi; her mutasyon cagirani
// bumpVersion() ile versiyonu artirmalidir ki istemciler reload'suz tazelesin.
'use strict';

const db = require('../db/index.cjs');

function normElement(row) {
  return {
    key: row.element_key,
    type: row.element_type,
    parentKey: row.parent_key || null,
    label: row.label || null,
    route: row.route || null,
    sortOrder: row.sort_order != null ? Number(row.sort_order) : 0,
    enabled: row.enabled === true || row.enabled === 1,
    defaultVisible: row.default_visible === true || row.default_visible === 1,
    metadata: row.metadata || null,
    description: row.description || null,
    createdAt: row.created_at || null,
  };
}

function normRule(row) {
  return {
    elementKey: row.element_key,
    principalType: row.principal_type,   // 'role' | 'user'
    principalId: row.principal_id,
    allow: row.allow === true || row.allow === 1,
  };
}

async function listElements() {
  const { rows } = await db.query(
    `SELECT element_key, element_type, parent_key, label, route, sort_order, enabled, default_visible, metadata, description, created_at
       FROM portal_elements ORDER BY element_type, sort_order, element_key`
  );
  return rows.map(normElement);
}

async function listRules() {
  const { rows } = await db.query(
    `SELECT element_key, principal_type, principal_id, allow FROM portal_element_visibility`
  );
  return rows.map(normRule);
}

// Element olustur/guncelle (upsert by element_key). Dinamik "her seyi ekle/cikar" icin.
async function upsertElement(el) {
  const key = String(el.key || '').trim();
  if (!key) throw Object.assign(new Error('element_key gerekli.'), { status: 400 });
  const type = String(el.type || 'feature');
  const parentKey = el.parentKey || null;
  const label = el.label || null;
  const route = el.route || null;
  const sortOrder = Number.isFinite(Number(el.sortOrder)) ? Number(el.sortOrder) : 0;
  const enabled = el.enabled === false ? 0 : 1;
  const defaultVisible = el.defaultVisible === false ? 0 : 1;
  const metadata = el.metadata != null ? (typeof el.metadata === 'string' ? el.metadata : JSON.stringify(el.metadata)) : null;
  const description = el.description != null ? String(el.description).trim() || null : null;

  const exists = await db.query(`SELECT id FROM portal_elements WHERE element_key = $1`, [key]);
  if (exists.rows.length) {
    await db.query(
      `UPDATE portal_elements SET element_type=$1, parent_key=$2, label=$3, route=$4,
         sort_order=$5, enabled=$6, default_visible=$7, metadata=$8, description=$9, updated_at=GETUTCDATE()
       WHERE element_key=$10`,
      [type, parentKey, label, route, sortOrder, enabled, defaultVisible, metadata, description, key]
    );
  } else {
    await db.query(
      `INSERT INTO portal_elements (element_key, element_type, parent_key, label, route, sort_order, enabled, default_visible, metadata, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [key, type, parentKey, label, route, sortOrder, enabled, defaultVisible, metadata, description]
    );
  }
  return true;
}

async function deleteElement(key) {
  await db.query(`DELETE FROM portal_element_visibility WHERE element_key = $1`, [key]);
  const { rowCount } = await db.query(`DELETE FROM portal_elements WHERE element_key = $1`, [key]);
  return rowCount > 0;
}

// Bir elementin TUM hedefleme kurallarini verilen listeyle degistirir (idempotent replace).
// rules: [{ principalType:'role'|'user', principalId, allow }]
async function setElementRules(key, rules) {
  await db.query(`DELETE FROM portal_element_visibility WHERE element_key = $1`, [key]);
  for (const r of rules || []) {
    const pt = r.principalType === 'user' ? 'user' : 'role';
    const pid = String(r.principalId || '').trim();
    if (!pid) continue;
    const allow = r.allow === false ? 0 : 1;
    await db.query(
      `INSERT INTO portal_element_visibility (element_key, principal_type, principal_id, allow)
       VALUES ($1,$2,$3,$4)`,
      [key, pt, pt === 'user' ? pid.toLowerCase() : pid, allow]
    );
  }
  return true;
}

// Yalnizca enabled bayragini degistirir (global kill-switch).
async function setElementEnabled(key, enabled) {
  const { rowCount } = await db.query(
    `UPDATE portal_elements SET enabled=$1, updated_at=GETUTCDATE() WHERE element_key=$2`,
    [enabled ? 1 : 0, key]
  );
  return rowCount > 0;
}

module.exports = {
  listElements, listRules, upsertElement, deleteElement, setElementRules, setElementEnabled,
};
