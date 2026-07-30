// server/ansible/playbook-registry.cjs — AI'in sohbette cagirabildigi salt-okunur
// tanilama playbook'larinin DB-destekli kaydi.
//
// Her satir bir playbook'u tanimlar (anahtar adi, gorunen ad, aciklama, kategori,
// handler) ve o playbook'u calistiran gercek AWX job template ID'sinin IKI olasi
// kaynagini tasir: admin ekranindan set edilen `awx_template_id` VEYA `.env`'deki
// `env_var_name` degiskeni. getEffectiveTemplateId() ikisini de kontrol eder —
// hicbiri set degilse null doner ve o playbook hicbir yerde (AI toolset, LogX
// butonlari) gorunmez; bu, "yapilandirilmamissa kullanici sorun gormemeli"
// gereksinimini karsilayan asil mekanizmadir.
'use strict';

const db = require('../db/index.cjs');

function parseRow(row) {
  return {
    id: row.id,
    keyName: row.key_name,
    displayName: row.display_name,
    description: row.description || '',
    category: row.category || 'genel',
    handler: row.handler || 'host_target',
    playbookPath: row.playbook_path || '',
    awxTemplateId: row.awx_template_id ?? null,
    // Job-tipi basina hangi AWX sunucusu (1..9) kullanilacagi — null ise LogX v2
    // cagiranlari varsayilan sunucuya (id=1) duser (bkz. server/logx/v2/jobs.cjs).
    awxServerId: row.awx_server_id ?? null,
    envVarName: row.env_var_name || '',
    enabled: row.enabled === true || row.enabled === 1,
    sourceType: row.source_type || 'awx_template',
    isReadonly: row.is_readonly === true || row.is_readonly === 1,
    visibility: row.visibility || 'User,Admin',
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listAll() {
  const { rows } = await db.query(
    `SELECT * FROM ansible_playbook_registry ORDER BY sort_order, category, display_name`
  );
  return rows.map(parseRow);
}

async function listEnabled() {
  const { rows } = await db.query(
    `SELECT * FROM ansible_playbook_registry WHERE enabled = true ORDER BY sort_order, category, display_name`
  );
  return rows.map(parseRow);
}

async function getByKey(keyName) {
  const { rows } = await db.query(
    `SELECT * FROM ansible_playbook_registry WHERE key_name = $1`,
    [keyName]
  );
  return rows[0] ? parseRow(rows[0]) : null;
}

// key_name yalnizca olustururken belirlenir, sonra degismez (arac adi olarak
// kullanildigi icin tutarlilik gerekir — bkz. portal-tools.cjs makeHostTargetTool).
async function create(data) {
  const keyName = String(data.keyName || '').trim();
  if (!keyName) throw new Error('keyName zorunlu.');
  if (!/^[a-z0-9_]+$/.test(keyName)) {
    throw new Error('keyName yalnızca küçük harf, rakam ve alt çizgi içerebilir.');
  }
  const envVarName = data.envVarName?.trim() || `AWX_${keyName.toUpperCase()}_TEMPLATE_ID`;
  const { rows } = await db.query(
    `INSERT INTO ansible_playbook_registry
       (key_name, display_name, description, category, handler, playbook_path, awx_template_id, awx_server_id, env_var_name, enabled, source_type, is_readonly, visibility, sort_order)
     OUTPUT INSERTED.*
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      keyName,
      String(data.displayName || keyName).trim(),
      data.description ? String(data.description) : '',
      data.category || 'genel',
      'host_target', // admin ekranindan yalnizca host_target olusturulabilir — ocp_cluster yalnizca seed satirinda
      data.playbookPath ? String(data.playbookPath) : '',
      data.awxTemplateId ? Number(data.awxTemplateId) : null,
      data.awxServerId ? Number(data.awxServerId) : null,
      envVarName,
      data.enabled !== false,
      data.sourceType ? String(data.sourceType) : 'awx_template',
      data.isReadonly !== false,
      data.visibility ? String(data.visibility) : 'User,Admin',
      Number.isFinite(Number(data.sortOrder)) ? Number(data.sortOrder) : 0,
    ]
  );
  return parseRow(rows[0]);
}

// key_name ve handler kasitli olarak guncellenemez (bkz. create() yorumu).
async function update(id, fields) {
  const current = await db.query(`SELECT * FROM ansible_playbook_registry WHERE id = $1`, [id]);
  if (!current.rows[0]) return null;
  const row = current.rows[0];

  const displayName = fields.displayName !== undefined ? String(fields.displayName).trim() : row.display_name;
  const description = fields.description !== undefined ? String(fields.description) : row.description;
  const category = fields.category !== undefined ? String(fields.category) : row.category;
  const awxTemplateId = fields.awxTemplateId !== undefined
    ? (fields.awxTemplateId === null || fields.awxTemplateId === '' ? null : Number(fields.awxTemplateId))
    : row.awx_template_id;
  const awxServerId = fields.awxServerId !== undefined
    ? (fields.awxServerId === null || fields.awxServerId === '' ? null : Number(fields.awxServerId))
    : row.awx_server_id;
  const enabled = fields.enabled !== undefined ? !!fields.enabled : row.enabled;
  const sourceType = fields.sourceType !== undefined ? String(fields.sourceType) : row.source_type;
  const isReadonly = fields.isReadonly !== undefined ? !!fields.isReadonly : row.is_readonly;
  const visibility = fields.visibility !== undefined ? String(fields.visibility) : row.visibility;
  const sortOrder = fields.sortOrder !== undefined ? Number(fields.sortOrder) || 0 : row.sort_order;

  const { rows } = await db.query(
    `UPDATE ansible_playbook_registry
       SET display_name = $1, description = $2, category = $3, awx_template_id = $4,
           enabled = $5, awx_server_id = $6, source_type = $7, is_readonly = $8,
           visibility = $9, sort_order = $10, updated_at = GETUTCDATE()
     OUTPUT INSERTED.*
     WHERE id = $11`,
    [displayName, description, category, awxTemplateId, enabled, awxServerId, sourceType, isReadonly, visibility, sortOrder, id]
  );
  return rows[0] ? parseRow(rows[0]) : null;
}

async function remove(id) {
  const { rowCount } = await db.query(`DELETE FROM ansible_playbook_registry WHERE id = $1`, [id]);
  return rowCount > 0;
}

// Yalnizca awx_server_id sutununu key uzerinden gunceller — LogX v2 404-telafisi dogru
// AWX sunucusunu bulunca bu degeri kalici yazar ki sonraki launch'lar telafi turu (yavas
// cok-sunuculu tarama) yapmadan dogrudan dogru sunucuya gitsin (bkz. jobs.cjs launchJob).
async function updateServerId(keyName, awxServerId) {
  const n = Number(awxServerId);
  if (!Number.isInteger(n) || n <= 0) return false;
  const { rowCount } = await db.query(
    `UPDATE ansible_playbook_registry SET awx_server_id = $1, updated_at = GETUTCDATE() WHERE key_name = $2`,
    [n, keyName]
  );
  return rowCount > 0;
}

// DB'deki awx_template_id varsa o kullanilir; yoksa env_var_name uzerinden .env'e
// bakilir. Ikisi de yoksa null doner (cagiran taraf bunu "yapilandirilmamis" olarak
// ele almali — hata degil, sessiz yokluk).
function getEffectiveTemplateId(row) {
  if (row.awxTemplateId) return row.awxTemplateId;
  if (row.envVarName && process.env[row.envVarName]) {
    const n = Number(process.env[row.envVarName]);
    if (!isNaN(n) && n > 0) return n;
  }
  return null;
}

module.exports = { listAll, listEnabled, getByKey, create, update, remove, updateServerId, getEffectiveTemplateId };
