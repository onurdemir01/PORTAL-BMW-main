// server/logx/v2/owners.cjs — LogX KAYNAK SAHIPLERI (L4, 2026-10-01).
//
// Kullanici karari: kisitlamalari Admin yonetir; istenirse bir kaynaga (Legacy
// uygulama / OCP namespace / ortam) SAHIP atanir ve sahip YALNIZCA o kaynagin
// LogX kisitini ve izinlerini yonetir. Baslangicta HIC sahip yok; her sey DB'de.
//
// YETKI SINIRI:
//   * sahip ekle/sil       → yalnizca Admin
//   * kisit + izin yonetimi → Admin ya da o kaynagin sahibi (`canManage`)
// Sahiplik kisitlama SATIRINA degil (tip, anahtar) ciftine bagli: kaynak henuz
// kisitli degilken de sahip atanabilir ve sahip kaynagini kisitlayabilir.
//
// Sahip bir kullanici adi ya da AD grubu (DN) olabilir; grup eslesmesi
// `restrictions.cjs` ile AYNI normalizasyonla (buyuk/kucuk harf, bosluk).
'use strict';

const db = require('../../db/index.cjs');
const restrictions = require('./restrictions.cjs');

const TIPLER = new Set(restrictions.RESOURCE_TYPES);

function anahtar(resourceType, resourceKey) {
  const k = String(resourceKey || '').trim();
  return resourceType === 'env' ? restrictions.envKey(k) : k;
}

function gruplar(user) {
  const raw = Array.isArray(user?.groups) ? user.groups : [];
  return new Set(
    raw
      .map((g) =>
        String(g || '')
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean),
  );
}

function sahipEslesir(row, user) {
  if (row.principal_type === 'user')
    return String(row.principal).toLowerCase() === String(user?.username || '').toLowerCase();
  return gruplar(user).has(String(row.principal).trim().toLowerCase());
}

function satir(r) {
  return {
    id: r.id,
    resourceType: r.resource_type,
    resourceKey: r.resource_key,
    principalType: r.principal_type,
    principal: r.principal,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

async function listOwners(resourceType, resourceKey) {
  const { rows } = await db.query(
    `SELECT * FROM logx_v2_restriction_owners
      WHERE resource_type = $1 AND resource_key = $2
      ORDER BY principal_type, principal`,
    [resourceType, anahtar(resourceType, resourceKey)],
  );
  return rows.map(satir);
}

async function listAllOwners() {
  const { rows } = await db.query(
    `SELECT * FROM logx_v2_restriction_owners ORDER BY resource_type, resource_key, principal`,
  );
  return rows.map(satir);
}

async function addOwner({ resourceType, resourceKey, username, groupDn }, createdBy) {
  if (!TIPLER.has(resourceType))
    throw Object.assign(new Error(`Geçersiz resourceType: ${resourceType}`), { status: 400 });
  const k = anahtar(resourceType, resourceKey);
  if (!k) throw Object.assign(new Error('resourceKey zorunlu.'), { status: 400 });
  const u = String(username || '').trim();
  const g = String(groupDn || '').trim();
  if (!!u === !!g)
    throw Object.assign(
      new Error('Sahip için username YA DA groupDn verilmeli (ikisi birden değil).'),
      {
        status: 400,
      },
    );
  if (g.length > 500)
    throw Object.assign(new Error('groupDn çok uzun (en fazla 500).'), { status: 400 });
  const { rows } = await db.query(
    `INSERT INTO logx_v2_restriction_owners
       (resource_type, resource_key, principal_type, principal, created_by)
     OUTPUT INSERTED.*
     VALUES ($1,$2,$3,$4,$5)`,
    [resourceType, k, u ? 'user' : 'group', u || g, createdBy],
  );
  return satir(rows[0]);
}

async function removeOwner(id) {
  const { rowCount } = await db.query(`DELETE FROM logx_v2_restriction_owners WHERE id = $1`, [id]);
  return rowCount > 0;
}

// Admin ya da o kaynagin sahibi. DB okunamazsa KAPALI (yonetim yetkisi bir yazma
// yetkisidir; "bilmiyorum" = "hayir").
async function canManage(user, resourceType, resourceKey) {
  if (user?.role === 'Admin') return true;
  try {
    const owners = await listOwners(resourceType, resourceKey);
    return owners.some((o) =>
      sahipEslesir({ principal_type: o.principalType, principal: o.principal }, user),
    );
  } catch {
    return false;
  }
}

async function assertCanManage(user, resourceType, resourceKey) {
  if (!(await canManage(user, resourceType, resourceKey))) {
    throw Object.assign(
      new Error(
        'Bu kaynağın LogX izinlerini yönetme yetkiniz yok (yalnızca Admin ve kaynak sahipleri).',
      ),
      { status: 403 },
    );
  }
}

// Kullanicinin SAHIBI oldugu kaynaklar (Admin icin cagrilmaz — admin hepsini gorur).
async function ownedBy(user) {
  const all = await listAllOwners();
  const seen = new Map();
  for (const o of all) {
    if (!sahipEslesir({ principal_type: o.principalType, principal: o.principal }, user)) continue;
    seen.set(`${o.resourceType}\u0000${o.resourceKey}`, {
      resourceType: o.resourceType,
      resourceKey: o.resourceKey,
    });
  }
  return [...seen.values()];
}

module.exports = {
  listOwners,
  listAllOwners,
  addOwner,
  removeOwner,
  canManage,
  assertCanManage,
  ownedBy,
};
