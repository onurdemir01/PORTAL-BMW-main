// server/logx/v2/restrictions.cjs — Varsayilan-acik yetkilendirme modeli. Bir kaynagin
// (Legacy app adi veya OCP namespace anahtari) logx_v2_restrictions'ta satiri YOKSA tum
// authenticated kullanicilara aciktir; satiri VARSA yalnizca logx_v2_restriction_grants'te
// kullanici adi bulunanlar (+ her zaman Admin) erisebilir. Mevcut logx_permissions'in
// (fail-closed, her host icin acik izin ZORUNLU) kasitli tersi — kullanici onayli karar.
'use strict';

const db = require('../../db/index.cjs');

// resourceType: 'legacy_app' | 'ocp_namespace'
// resourceKey: Legacy icin app adi (orn. "GBCEPPOSDASHBOARD"), OCP icin
//   "<tenant>/<env>/<cluster>/<namespace>" birlesik anahtari.
// Iki sirali sorgu yerine tek LEFT JOIN — kisitlama satiri yoksa r.id NULL doner (yani
// hic satir donmez, varsayilan-acik); satir varsa grant eslesmesi ayni sorguda gelir
// (kurumsal AI kod incelemesi, review.md #11).
async function isAllowed(resourceType, resourceKey, user) {
  if (user.role === 'Admin') return true;

  const { rows } = await db.query(
    `SELECT r.id, g.username
     FROM logx_v2_restrictions r
     LEFT JOIN logx_v2_restriction_grants g ON g.restriction_id = r.id AND g.username = $3
     WHERE r.resource_type = $1 AND r.resource_key = $2`,
    [resourceType, resourceKey, user.username]
  );
  if (rows.length === 0) return true; // kisitlama satiri yok → varsayilan acik
  return rows.some((r) => r.username);
}

async function assertAllowed(resourceType, resourceKey, user) {
  const allowed = await isAllowed(resourceType, resourceKey, user);
  if (!allowed) {
    throw Object.assign(
      new Error('Bu kaynağa erişim yetkiniz yok — ekibiniz bu kaynağı kısıtlamış olabilir.'),
      { status: 403 }
    );
  }
}

// ── Admin CRUD ─────────────────────────────────────────────────────────────────

async function listRestrictions() {
  const { rows } = await db.query(
    `SELECT r.id, r.resource_type, r.resource_key, r.description, r.created_by, r.created_at,
            g.username AS grant_username
     FROM logx_v2_restrictions r
     LEFT JOIN logx_v2_restriction_grants g ON g.restriction_id = r.id
     ORDER BY r.resource_type, r.resource_key`
  );
  const byId = new Map();
  for (const row of rows) {
    if (!byId.has(row.id)) {
      byId.set(row.id, {
        id: row.id, resourceType: row.resource_type, resourceKey: row.resource_key,
        description: row.description, createdBy: row.created_by, createdAt: row.created_at,
        grants: [],
      });
    }
    if (row.grant_username) byId.get(row.id).grants.push(row.grant_username);
  }
  return [...byId.values()];
}

async function createRestriction({ resourceType, resourceKey, description }, createdBy) {
  if (resourceType !== 'legacy_app' && resourceType !== 'ocp_namespace') {
    throw Object.assign(new Error('Geçersiz resourceType.'), { status: 400 });
  }
  if (!resourceKey || !String(resourceKey).trim()) {
    throw Object.assign(new Error('resourceKey zorunlu.'), { status: 400 });
  }
  const { rows } = await db.query(
    `INSERT INTO logx_v2_restrictions (resource_type, resource_key, description, created_by)
     OUTPUT INSERTED.*
     VALUES ($1,$2,$3,$4)`,
    [resourceType, String(resourceKey).trim(), description || null, createdBy]
  );
  return rows[0];
}

async function updateRestriction(id, { description }) {
  const { rows } = await db.query(
    `UPDATE logx_v2_restrictions SET description = $1 OUTPUT INSERTED.* WHERE id = $2`,
    [description || null, id]
  );
  return rows[0] || null;
}

async function deleteRestriction(id) {
  const { rowCount } = await db.query(`DELETE FROM logx_v2_restrictions WHERE id = $1`, [id]);
  return rowCount > 0;
}

async function addGrant(restrictionId, username, createdBy) {
  if (!username || !String(username).trim()) {
    throw Object.assign(new Error('username zorunlu.'), { status: 400 });
  }
  const { rows } = await db.query(
    `INSERT INTO logx_v2_restriction_grants (restriction_id, username, created_by)
     OUTPUT INSERTED.*
     VALUES ($1,$2,$3)`,
    [restrictionId, String(username).trim(), createdBy]
  );
  return rows[0];
}

async function removeGrant(restrictionId, username) {
  const { rowCount } = await db.query(
    `DELETE FROM logx_v2_restriction_grants WHERE restriction_id = $1 AND username = $2`,
    [restrictionId, username]
  );
  return rowCount > 0;
}

module.exports = { isAllowed, assertAllowed, listRestrictions, createRestriction, updateRestriction, deleteRestriction, addGrant, removeGrant };
