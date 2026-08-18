// server/selfservice/store.cjs — Self Service ust-seviye grup metadata'si (yalniz "Ansible").
// Eskiden burada Smart/Digerleri katalog agaci (tabs > subTabs > items, DB-tabanli) da
// tutulurdu; o katalog tamamen kaldirildi (bkz. SelfServicePage.tsx) — geriye yalnizca
// "Ansible" sekmesinin etiket/sira/aktiflik metadata'si (selfservice_groups tablosu) kaldi.
const db = require("../db/index.cjs");

function normalizeStr(x) {
  return String(x ?? "").trim();
}

let _groups = null;

async function reloadGroupsCache() {
  const { rows } = await db.query(
    `SELECT * FROM selfservice_groups WHERE group_key = 'ansible' ORDER BY sort_order, id`
  );
  _groups = rows.map((r) => ({
    id: r.id, groupKey: r.group_key, label: r.label, icon: r.icon || "",
    sortOrder: r.sort_order ?? 0, isActive: r.is_active === true || r.is_active === 1,
  }));
}

function readGroups() {
  return _groups ? _groups.slice() : [
    { id: "grp-ansible", groupKey: "ansible", label: "Ansible", icon: "CommandLineIcon", sortOrder: 1, isActive: true },
  ];
}

async function updateGroup(id, fields) {
  const existing = readGroups().find((g) => g.id === id);
  if (!existing) return null;
  const label = fields.label !== undefined ? normalizeStr(fields.label) || existing.label : existing.label;
  const icon = fields.icon !== undefined ? normalizeStr(fields.icon) : existing.icon;
  const sortOrder = fields.sortOrder !== undefined ? Number(fields.sortOrder) || 0 : existing.sortOrder;
  const isActive = fields.isActive !== undefined ? !!fields.isActive : existing.isActive;
  await db.query(
    `UPDATE selfservice_groups SET label = $1, icon = $2, sort_order = $3, is_active = $4, updated_at = GETUTCDATE() WHERE id = $5`,
    [label, icon, sortOrder, isActive, id]
  );
  await reloadGroupsCache();
  return readGroups().find((g) => g.id === id);
}

async function loadSelfServiceStore() {
  try {
    await reloadGroupsCache();
  } catch (e) {
    console.warn("[SelfService] gruplar DB'den yuklenemedi, sabit varsayilanlar aktif:", e.message);
  }
}

module.exports = {
  loadSelfServiceStore,
  readGroups,
  updateGroup,
};
