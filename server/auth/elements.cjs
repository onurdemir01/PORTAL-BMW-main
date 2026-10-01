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
    // SIKI OGE (2026-09-26): admin muafiyeti YOK, acik kural sart. Ekranin gostermesi ve
    // degistirebilmesi icin metadata icinden ayri bir alan olarak cikarilir.
    strict: (() => {
      try {
        const m = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
        return !!(m && m.strict);
      } catch { return false; }
    })(),
    description: row.description || null,
    createdAt: row.created_at || null,
  };
}

function normRule(row) {
  return {
    elementKey: row.element_key,
    principalType: row.principal_type,   // 'role' | 'user' | 'group' (AD grubu) | 'email' (2026-09-26)
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
// rules: [{ principalType:'role'|'user'|'group'|'email', principalId, allow }]
async function setElementRules(key, rules) {
  await db.query(`DELETE FROM portal_element_visibility WHERE element_key = $1`, [key]);
  for (const r of rules || []) {
    // 'email' (2026-09-26): LDAP kullanici adini bilmeden e-postayla yetki verebilmek icin.
    const pt = ['user', 'group', 'email'].includes(r.principalType) ? r.principalType : 'role';
    const pid = String(r.principalId || '').trim();
    if (!pid) continue;
    const allow = r.allow === false ? 0 : 1;
    await db.query(
      `INSERT INTO portal_element_visibility (element_key, principal_type, principal_id, allow)
       VALUES ($1,$2,$3,$4)`,
      // user ve group kucuk harf (motor kucuk harfle eslestirir; grup DN ya da CN olabilir)
      [key, pt, pt === 'role' ? pid : pid.toLowerCase(), allow]
    );
  }
  return true;
}

/** metadata'dan strict bayragi (string ya da nesne olabilir). */
function isStrict(el) {
  try {
    const m = el.metadata ? (typeof el.metadata === 'string' ? JSON.parse(el.metadata) : el.metadata) : null;
    return !!(m && m.strict);
  } catch {
    return false;
  }
}

/**
 * KISI KURALINI SIKI TORUNLARA DA YAZAR (2026-10-01).
 *
 * URETIM: "Crypto Hub'a halen osmankoz@garantibbva.com.tr giremiyor." Admin ekraninda
 * `navgroup:cryptohub` ogesine UC kisi kurali girilmisti ve ekran onlari gosteriyordu -
 * ama kullanici 403 aliyordu.
 *
 * SEBEP: `CryptoHub` SAYFASI `metadata.strict = true` (kullanicinin 2026-09-26 istegi:
 * "sadece istedigim kisiler goruntuleyebilsin"). Motorda ata kaskadi yalnizca KISITLAR,
 * asla YETKI VERMEZ; siki ogede ise varsayilan her zaman kapalidir. Yani ataya yazilan
 * kural siki cocuk icin HICBIR SEY YAPMIYOR - ve ekranda bunu soyleyen hicbir sey yoktu.
 * Ayni tuzaga birden fazla kez dusuldu.
 *
 * COZUM: ataya kisi kurali yazilinca ayni kural SIKI torunlara da yazilir ve HANGILERINE
 * yazildigi cagirana bildirilir (ekran soyler). Motorun anlambilimi DEGISMEDI; eksik olan
 * satir artik otomatik olusuyor.
 *
 * YALNIZ EKLER, SILMEZ: ata kuralini kaldirmak cocuktaki kurali silmez - cocuga DOGRUDAN
 * verilmis bir yetkiyi sessizce iptal etmek, bundan daha kotu bir surpriz olurdu. Kaldirma
 * ekranda iki yerden yapilir ve ikisi de gorunur.
 *
 * @returns {Promise<string[]>} kural yazilan siki torun anahtarlari
 */
async function propagateToStrictDescendants(key, rules) {
  const kisiKurallari = (rules || []).filter(
    (r) => ['user', 'email', 'group'].includes(r.principalType) && r.allow !== false,
  );
  if (!kisiKurallari.length) return [];

  const { rows: els } = await db.query(
    `SELECT element_key, parent_key, metadata FROM portal_elements`,
  );
  const cocuklar = new Map();
  for (const el of els) {
    const p = el.parent_key || '';
    if (!cocuklar.has(p)) cocuklar.set(p, []);
    cocuklar.get(p).push(el);
  }
  // TORUNLARI GEZ - DONGUYE KARSI `gorulen` (bozuk parent zinciri motorda da korunuyor).
  const siki = [];
  const gorulen = new Set([key]);
  const kuyruk = [key];
  while (kuyruk.length) {
    for (const el of cocuklar.get(kuyruk.shift()) || []) {
      if (gorulen.has(el.element_key)) continue;
      gorulen.add(el.element_key);
      kuyruk.push(el.element_key);
      if (isStrict(el)) siki.push(el.element_key);
    }
  }
  if (!siki.length) return [];

  const yazilan = [];
  for (const ck of siki) {
    const { rows: mevcut } = await db.query(
      `SELECT principal_type, principal_id FROM portal_element_visibility WHERE element_key = $1`,
      [ck],
    );
    const var_ = new Set(
      mevcut.map((r) => `${r.principal_type}|${String(r.principal_id || '').toLowerCase()}`),
    );
    let eklendi = false;
    for (const r of kisiKurallari) {
      const pid = String(r.principalId || '').trim().toLowerCase();
      if (!pid || var_.has(`${r.principalType}|${pid}`)) continue;
      await db.query(
        `INSERT INTO portal_element_visibility (element_key, principal_type, principal_id, allow)
         VALUES ($1,$2,$3,1)`,
        [ck, r.principalType, pid],
      );
      eklendi = true;
    }
    if (eklendi) yazilan.push(ck);
  }
  return yazilan;
}

// Yalnizca enabled bayragini degistirir (global kill-switch).
async function setElementEnabled(key, enabled) {
  const { rowCount } = await db.query(
    `UPDATE portal_elements SET enabled=$1, updated_at=GETUTCDATE() WHERE element_key=$2`,
    [enabled ? 1 : 0, key]
  );
  return rowCount > 0;
}

/** Sikilik bayragini degistirir. metadata icindeki DIGER alanlar korunur. */
async function setElementStrict(key, strict) {
  const { rows } = await db.query(`SELECT metadata FROM portal_elements WHERE element_key = $1`, [key]);
  if (!rows.length) return false;
  let meta = {};
  try {
    const m = rows[0].metadata;
    meta = (typeof m === 'string' ? JSON.parse(m) : m) || {};
  } catch { meta = {}; }
  if (strict) meta.strict = true; else delete meta.strict;
  const bos = Object.keys(meta).length === 0;
  const { rowCount } = await db.query(
    `UPDATE portal_elements SET metadata=$1, updated_at=GETUTCDATE() WHERE element_key=$2`,
    [bos ? null : JSON.stringify(meta), key],
  );
  return rowCount > 0;
}

module.exports = {
  listElements, listRules, upsertElement, deleteElement, setElementRules, setElementEnabled,
  propagateToStrictDescendants,
  setElementStrict,
};
