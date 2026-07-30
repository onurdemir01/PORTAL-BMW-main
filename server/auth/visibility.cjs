// server/auth/visibility.cjs — Dinamik gorunurluk/modulerlik motoru.
//
// Tek gercek kaynagi iki tablodur (bkz. server/db/mssql-setup.cjs):
//   portal_elements            — her kontrol edilebilir oge (page/tab/button/admin_tab/...)
//   portal_element_visibility  — element basina rol/kullanici hedefleme kurallari
//
// Cozunurluk onceligi (tek bir element icin):
//   1) element.enabled === false          → HERKESE kapali (admin dahil; global kill-switch)
//   2) user.role === 'Admin'              → gorunur (adminler tum enabled ogeleri gorur)
//   3) user kurali (principal user=<name>) → allow degeri KAZANIR (deny dahil)
//   4) role kurali (principal role=<rol>)  → allow degeri
//   5) hic kural yoksa                     → element.default_visible
//
// Yayilim (propagation): her admin yazimi `bumpVersion()` cagirir; istemci hafif bir
// `version` numarasi poll'leyip degisince gorunurluk haritasini yeniden ceker (reload yok).
'use strict';

const db = require('../db/index.cjs');
const { getRequestUser } = require('./utils.cjs');

let _version = 1;         // her yazimda artar — istemci bunu izler
let _cache = null;        // { elements, rules } anlik goruntusu
let _cacheAt = 0;
const CACHE_TTL_MS = 15000;

// ── Legacy sayfa-gorunurlugu (DB: page_visibility — eskiden server/data/page-visibility.json) ──
// Yukaridaki element-bazli motordan AYRI, daha eski/kaba-taneli bir sistem (sayfa dusen 11
// sabit anahtar). server/auth/index.cjs'ten buraya tasindi (SRP — kurumsal AI kod incelemesi,
// review.md #14) — tum "gorunurluk" mantigi artik tek dosyada.
const DEFAULT_VISIBILITY = {
  "Dashboard":    ["Admin", "User"],
  "Envanter":     ["Admin", "User"],
  "LogX":         ["Admin", "User"],
  "Self Service": ["Admin", "User"],
  "Ansible":      ["Admin"],
  "Performance":  ["Admin", "User"],
  "AI Analist":   ["Admin", "User"],
  "Nöbet":        ["Admin", "User"],
  "Linkler":      ["Admin", "User"],
  "Admin":        ["Admin"],
};

async function readVisibility() {
  try {
    const { rows } = await db.query(`SELECT page_name, roles FROM page_visibility`);
    if (rows.length === 0) return { ...DEFAULT_VISIBILITY };
    const map = {};
    for (const r of rows) map[r.page_name] = String(r.roles).split(",").map((s) => s.trim()).filter(Boolean);
    return map;
  } catch { return { ...DEFAULT_VISIBILITY }; }
}

// Ayni UPDATE-once → 0 satir ise INSERT deseni — 11 sayfa icin 22 sorgu yerine yaygin
// durumda (sayfalar zaten var) 11 sorguya iner, TOCTOU yarisi da ortadan kalkar.
//
// Her sayfa per-row try/catch ile sarilir (kurumsal AI kod incelemesi, review.md #15):
// db/index.cjs'de transaction API'si yok, tam atomiklik bu turda kapsam disi — ama artik
// bir sayfanin basarisiz yazimi digerlerini engellemez VE hangi sayfalarin basarisiz oldugu
// caller'a raporlanir (eskiden hata sessizce ilk satirda tum donguyu kesiyordu).
async function writeVisibility(data) {
  const failed = [];
  for (const [pageName, roles] of Object.entries(data)) {
    const rolesStr = Array.isArray(roles) ? roles.join(",") : String(roles);
    try {
      const upd = await db.query(`UPDATE page_visibility SET roles = $1, updated_at = GETUTCDATE() WHERE page_name = $2`, [rolesStr, pageName]);
      if (!upd.rowCount) {
        await db.query(`INSERT INTO page_visibility (page_name, roles) VALUES ($1, $2)`, [pageName, rolesStr]);
      }
    } catch (err) {
      console.warn(`[visibility] '${pageName}' gorunurlugu kaydedilemedi:`, err.message);
      failed.push(pageName);
    }
  }
  return { ok: failed.length === 0, failed };
}

function getVersion() { return _version; }

// Admin bir gorunurluk/element degisikligi yaptiginda cagrilir — cache'i dusurur + versiyon++.
function bumpVersion() { _version++; _cache = null; _cacheAt = 0; }

async function loadAll() {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL_MS) return _cache;
  const [elementsRes, rulesRes] = await Promise.all([
    db.query(`SELECT element_key, element_type, parent_key, label, route, sort_order, enabled, default_visible, metadata FROM portal_elements`),
    db.query(`SELECT element_key, principal_type, principal_id, allow FROM portal_element_visibility`),
  ]);
  _cache = { elements: elementsRes.rows || [], rules: rulesRes.rows || [] };
  _cacheAt = Date.now();
  return _cache;
}

function truthy(v) { return v === true || v === 1 || v === '1'; }

function buildRuleIndex(rules) {
  // key: `${element_key}|${principal_type}|${principal_id_lower}` → boolean allow
  const idx = new Map();
  for (const r of rules) {
    idx.set(`${r.element_key}|${r.principal_type}|${String(r.principal_id).toLowerCase()}`, truthy(r.allow));
  }
  return idx;
}

function decide(el, ruleIndex, role, usernameLower) {
  if (!truthy(el.enabled)) return false;                 // 1) global kill-switch
  if (role === 'Admin') return true;                     // 2) admin her enabled ogeyi gorur
  const uKey = `${el.element_key}|user|${usernameLower}`;
  if (ruleIndex.has(uKey)) return ruleIndex.get(uKey);   // 3) user kurali kazanir
  const rKey = `${el.element_key}|role|${role.toLowerCase()}`;
  if (ruleIndex.has(rKey)) return ruleIndex.get(rKey);   // 4) role kurali
  return truthy(el.default_visible);                     // 5) varsayilan
}

// Bir kullanici icin TUM elementlerin cozulmus gorunurluk haritasini doner.
async function resolveVisibility(user) {
  const role = (user && user.role) || 'User';
  const usernameLower = ((user && user.username) || '').toLowerCase();
  let elements = [];
  let rules = [];
  try {
    ({ elements, rules } = await loadAll());
  } catch (err) {
    console.warn('[visibility] loadAll hata (bos harita donuluyor):', err.message);
    return { version: _version, visibility: {} };
  }
  const ruleIndex = buildRuleIndex(rules);
  const map = {};
  for (const el of elements) map[el.element_key] = decide(el, ruleIndex, role, usernameLower);
  return { version: _version, visibility: map };
}

// Tek element kontrolu. Registry'de OLMAYAN element → varsayilan gorunur (kayitsiz ogeyi
// yanlislikla kilitlememek icin — kayit admin tarafindan eklenene kadar acik kalir).
async function canSee(user, elementKey) {
  const { visibility } = await resolveVisibility(user);
  return elementKey in visibility ? visibility[elementKey] : true;
}

// Express middleware fabrikasi — element kullaniciya gorunmezse 403. GERCEK server-side deny.
// Motor hatasinda (DB anlik erisilemez) fail-open: mevcut sistemin default-open durusuyla
// tutarli, availability'yi korur; normal yol dogru sekilde reddeder.
function requireVisible(elementKey) {
  return async (req, res, next) => {
    try {
      const user = getRequestUser(req);
      if (!user) return res.status(401).json({ ok: false, error: 'Oturum bulunamadı.' });
      const ok = await canSee(user, elementKey);
      if (!ok) return res.status(403).json({ ok: false, error: 'Bu kaynağa erişiminiz kapalı.' });
      return next();
    } catch (err) {
      console.warn('[visibility] requireVisible hata (fail-open):', err.message);
      return next();
    }
  };
}

// Prefix (mount) seviyesinde gate — bir router/app.use onune konur, verilen element'e
// gorunmeyen kullaniciya 403 doner. `exempt` listesindeki (mount'a goreli) yollar (or.
// '/health', '/count') muaf tutulur; bunlar dashboard KPI/probe icin tum authenticated
// kullanicilara acik kalir. requireVisible zaten auth'u da zorlar (session yoksa 401).
function requireVisiblePrefix(elementKey, opts = {}) {
  const exempt = new Set(opts.exempt || []);
  const rv = requireVisible(elementKey);
  return (req, res, next) => {
    if (exempt.has(req.path)) return next();
    return rv(req, res, next);
  };
}

module.exports = {
  resolveVisibility, canSee, requireVisible, requireVisiblePrefix, getVersion, bumpVersion,
  // Legacy sayfa-gorunurlugu (DEFAULT_VISIBILITY tablosu) — element-bazli motordan ayri.
  readVisibility, writeVisibility, DEFAULT_VISIBILITY,
  // saf yardimcilar — birim testleri icin acildi (DB gerektirmez)
  _decide: decide, _buildRuleIndex: buildRuleIndex,
};
