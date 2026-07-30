// server/auth/role-store.cjs — Rol override deposu (DB: user_role_overrides — eskiden
// server/data/user-roles.json). LDAP/local kimlik dogrulamasindan gelen rolu admin panelinden
// manuel gecersiz kilmak icin (bkz. server/auth/index.cjs router.put("/roles/:username")).
//
// server/auth/index.cjs'ten ayristirildi (SRP — kurumsal AI kod incelemesi, review.md #14):
// bu dosya yalnizca db/index.cjs'e bagimlidir.
'use strict';

const db = require('../db/index.cjs');

async function readRoles() {
  try {
    // is_active=0 satirlar admin listesinde ARTIK gorunmez (login'de de uygulanmaz) —
    // pasife alma, silmeden "gecici olarak devre disi birak" imkani verir (actions.md #14).
    const { rows } = await db.query(`SELECT username, role FROM user_role_overrides WHERE is_active = 1`);
    const map = {};
    for (const r of rows) map[r.username] = r.role;
    return map;
  } catch { return {}; }
}

// Admin ekrani icin TAM satirlar (source_type/ldap_role/is_active/created_by/description/last_applied_at dahil).
async function readRolesDetailed() {
  try {
    const { rows } = await db.query(`SELECT * FROM user_role_overrides ORDER BY username`);
    return rows.map((r) => ({
      username: r.username,
      role: r.role,
      sourceType: r.source_type || 'manual',
      ldapRole: r.ldap_role || null,
      isActive: r.is_active === true || r.is_active === 1,
      createdBy: r.created_by || null,
      createdAt: r.created_at || null,
      description: r.description || '',
      lastAppliedAt: r.last_applied_at || null,
    }));
  } catch { return []; }
}

// UPDATE-once, INSERT-only-if-0-rows deseni (bkz. server/auth/users.cjs recordLogin/setPref) —
// eski SELECT+kosullu UPDATE/INSERT ikilisi yerine yaygin durumda (satir zaten var) TEK
// round-trip; ayrica SELECT ile UPDATE arasindaki TOCTOU yarisini ortadan kaldirir.
async function setRoleOverride(username, role, { createdBy = null, description = null, ldapRole = null } = {}) {
  const upd = await db.query(
    `UPDATE user_role_overrides SET role = $1, is_active = 1, description = COALESCE($2, description), updated_at = GETUTCDATE() WHERE username = $3`,
    [role, description, username]
  );
  if (!upd.rowCount) {
    await db.query(
      `INSERT INTO user_role_overrides (username, role, source_type, ldap_role, created_by, description) VALUES ($1, $2, 'manual', $3, $4, $5)`,
      [username, role, ldapRole, createdBy, description]
    );
  }
}

async function removeRoleOverride(username) {
  await db.query(`DELETE FROM user_role_overrides WHERE username = $1`, [username]);
}

async function getRoleOverride(username) {
  try {
    const { rows } = await db.query(`SELECT role FROM user_role_overrides WHERE username = $1 AND is_active = 1`, [username.toLowerCase()]);
    if (!rows[0]) return null;
    // Best-effort — son uygulanma zamanini kaydeder, login akisini bloklamaz.
    db.query(`UPDATE user_role_overrides SET last_applied_at = GETUTCDATE() WHERE username = $1`, [username.toLowerCase()]).catch(() => {});
    return rows[0].role;
  } catch { return null; }
}

module.exports = { readRoles, readRolesDetailed, setRoleOverride, removeRoleOverride, getRoleOverride };
