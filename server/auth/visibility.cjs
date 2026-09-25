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
//   3b) group kurali (principal group=<AD grubu DN ya da CN>) → herhangi biri allow ise
//       gorunur, yalniz deny varsa gizli (2026-09-17: Denetim erisimi grup bazli verilebilsin)
//   4) role kurali (principal role=<rol>)  → allow degeri
//   5) hic kural yoksa                     → element.default_visible
//
// Yayilim (propagation): her admin yazimi `bumpVersion()` cagirir; istemci hafif bir
// `version` numarasi poll'leyip degisince gorunurluk haritasini yeniden ceker (reload yok).
'use strict';

const db = require('../db/index.cjs');
const { getRequestUser, oturumYok } = require('./utils.cjs');

let _version = 1;         // her yazimda artar — istemci bunu izler
let _cache = null;        // { elements, rules } anlik goruntusu
let _cacheAt = 0;
const CACHE_TTL_MS = 15000;

// ── Legacy sayfa-gorunurlugu (DB: page_visibility — eskiden server/data/page-visibility.json) ──
// Yukaridaki element-bazli motordan AYRI, daha eski/kaba-taneli bir sistem (sayfa dusen 11
// sabit anahtar). server/auth/index.cjs'ten buraya tasindi (SRP — kurumsal AI kod incelemesi,
// review.md #14) — tum "gorunurluk" mantigi artik tek dosyada.
// NOT (G8): bu legacy tablo artik yalnizca YEDEK'tir — hicbir admin ekrani buraya yazmaz
// (PageVisibilityTab element-bazli motoru kullanir) ve `canViewPage` bunu okumaz. Yeni
// sayfalar eklendiginde yine de senkron tutulur ki eski istemci/probe yollari sasmasin.
const DEFAULT_VISIBILITY = {
  "Dashboard":    ["Admin", "User"],
  "Envanter":     ["Admin", "User"],
  "Denetim":      ["Admin", "User"],
  "LogX":         ["Admin", "User"],
  "Self Service": ["Admin", "User"],
  "Ansible":      ["Admin"],
  "OpsX":         ["Admin", "User"],
  "FileX":        ["Admin", "User"],
  "Telnet":       ["Admin", "User"],
  "ScaleX":       ["Admin", "User"],
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

// Oturumdaki AD gruplari (memberOf DN'leri) -> eslesme anahtarlari: tam DN (kucuk harf)
// ve CN parcasi (kucuk harf). Admin panelinde grup "CN=..." tam DN ile de yalin adla da
// girilebilsin (ldap.cjs determineRole ile ayni tolerans).
function groupKeysOf(user) {
  const out = new Set();
  for (const g of Array.isArray(user && user.groups) ? user.groups : []) {
    const dn = String(g || '').trim().toLowerCase();
    if (!dn) continue;
    out.add(dn);
    const m = /^cn=([^,]+)/.exec(dn);
    if (m) out.add(m[1].trim());
  }
  return out;
}

function decide(el, ruleIndex, role, usernameLower, groupKeys, mailLower, iz) {
  const not = (sebep, kural) => { if (iz) { iz.sebep = sebep; iz.kural = kural || null; } };
  if (!truthy(el.enabled)) { not('kill-switch: oge kapali (enabled=false)'); return false; }

  // SIKI ELEMENT (2026-09-26, kullanici: "sadece istedigim kisiler goruntuleyebilsin"):
  // metadata.strict=true olan ogede ADMIN MUAFIYETI YOKTUR - yonetici de acikca
  // yetkilendirilmis olmali. Kill-switch'ten farki: oge kapanmiyor, yalnizca listeye
  // girenlere aciliyor. Varsayilan davranis DEGISMEDI (strict yoksa admin yine gorur).
  let strict = false;
  try {
    const m = el.metadata ? (typeof el.metadata === 'string' ? JSON.parse(el.metadata) : el.metadata) : null;
    strict = !!(m && m.strict);
  } catch { strict = false; }

  if (iz) iz.strict = strict;
  if (role === 'Admin' && !strict) { not('admin muafiyeti (oge siki degil)'); return true; }
  const uKey = `${el.element_key}|user|${usernameLower}`;
  if (ruleIndex.has(uKey)) {
    const v = ruleIndex.get(uKey);
    not(`kullanici kurali: ${usernameLower} -> ${v ? 'gorur' : 'gizli'}`, uKey);
    return v;
  }
  // 3a) E-POSTA kurali: LDAP'ta kullanici adini bilmeden, e-postayla yetki verebilmek icin
  // (kullanici istegi). Kullanici adi kuralindan SONRA, grup kurallarindan ONCE gelir.
  if (mailLower) {
    const eKey = `${el.element_key}|email|${mailLower}`;
    if (ruleIndex.has(eKey)) {
      const v = ruleIndex.get(eKey);
      not(`e-posta kurali: ${mailLower} -> ${v ? 'gorur' : 'gizli'}`, eKey);
      return v;
    }
  }
  if (groupKeys && groupKeys.size) {                     // 3b) grup kurali: bir allow yeter
    let seen = false, allow = false, eslesen = null;
    for (const g of groupKeys) {
      const gKey = `${el.element_key}|group|${g}`;
      if (ruleIndex.has(gKey)) { seen = true; if (ruleIndex.get(gKey)) { allow = true; eslesen = gKey; break; } }
    }
    if (seen) { not(`grup kurali -> ${allow ? 'gorur' : 'gizli'}`, eslesen); return allow; }
  }
  const rKey = `${el.element_key}|role|${role.toLowerCase()}`;
  if (ruleIndex.has(rKey)) {
    const v = ruleIndex.get(rKey);
    not(`rol kurali: ${role} -> ${v ? 'gorur' : 'gizli'}`, rKey);
    return v;
  }
  // SIKI ogede varsayilan HER ZAMAN kapalidir: acik bir kural yoksa erisim yok.
  if (strict) { not('SIKI oge ve eslesen kural YOK -> kapali'); return false; }
  not(`varsayilan: default_visible=${truthy(el.default_visible) ? 1 : 0}`);
  return truthy(el.default_visible);                     // 5) varsayilan
}

// Parent → child kaskadi (G11): admin ekraninda belgelenen "bir menu/sayfa kapatilirsa
// altindaki tab/buton da gizlenir" kurali artik GERCEKTEN uygulanir. Bir ogenin ATA
// zincirinde gorunmeyen tek bir halka varsa oge de gorunmez.
//
// SIKI OGE NOTU: metadata.strict=true olan ogede admin muafiyeti yoktur; erisim yalnizca
// acik kurallarla (user / email / group / role) verilir. Seed, roles: ['Admin'] verildiginde
// bir ROL kurali yazar - yani ilk kurulumda yoneticiler gorur; listeyi daraltmak isteyen o
// rol kuralini Admin ekranindan kaldirir.
//
// Admin muafiyeti KASITLI olarak kaskadin da USTUNDEDIR: decide() Admin'e her enabled
// ogeyi acar; ata `enabled=false` ise decide zaten false doner ve kaskad da onu tasir
// (kill-switch adminde de calisir).
function applyParentCascade(map, elements) {
  const byKey = new Map(elements.map((el) => [el.element_key, el]));
  const resolved = new Map();

  function visible(key, seen) {
    if (resolved.has(key)) return resolved.get(key);
    if (seen.has(key)) return map[key] ?? true;   // dongu korumasi (bozuk parent zinciri)
    seen.add(key);
    const el = byKey.get(key);
    let out = map[key] ?? true;
    if (out && el && el.parent_key && byKey.has(el.parent_key)) {
      out = visible(el.parent_key, seen);
    }
    resolved.set(key, out);
    return out;
  }

  const cascaded = {};
  for (const key of Object.keys(map)) cascaded[key] = visible(key, new Set());
  return cascaded;
}

// Cozulmus harita, (versiyon + rol + kullanici) basina memo'lanir (G12): requireVisible
// her istekte tum haritayi yeniden kuruyordu. bumpVersion() cache'i dusurur.
let _resolvedMemo = new Map();
let _resolvedMemoVersion = _version;

// Bir kullanici icin TUM elementlerin cozulmus gorunurluk haritasini doner.
async function resolveVisibility(user) {
  const role = (user && user.role) || 'User';
  const usernameLower = ((user && user.username) || '').toLowerCase();
  const mailLower = ((user && user.mail) || '').trim().toLowerCase();

  if (_resolvedMemoVersion !== _version) { _resolvedMemo = new Map(); _resolvedMemoVersion = _version; }
  const groupKeys = groupKeysOf(user);
  const memoKey = `${role}|${usernameLower}|${mailLower}|${[...groupKeys].sort().join(',')}`;
  const hit = _resolvedMemo.get(memoKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { version: _version, visibility: hit.visibility };

  let elements = [];
  let rules = [];
  try {
    ({ elements, rules } = await loadAll());
  } catch (err) {
    // Harita kurulamadi. UI tarafi icin bos harita "bilinmiyor" demektir (istemci
    // varsayilan-acik davranir); GERCEK erisim karari requireVisible'da verilir ve
    // orasi fail-CLOSED'dir (bkz. asagisi) — bu yuzden burada throw ETMEYIZ.
    console.warn('[visibility] loadAll hata (bos harita donuluyor):', err.message);
    const e = new Error('visibility_unavailable');
    e.code = 'VISIBILITY_UNAVAILABLE';
    throw e;
  }
  const ruleIndex = buildRuleIndex(rules);
  const map = {};
  for (const el of elements) map[el.element_key] = decide(el, ruleIndex, role, usernameLower, groupKeys, mailLower);
  const visibility = applyParentCascade(map, elements);
  _resolvedMemo.set(memoKey, { visibility, at: Date.now() });
  return { version: _version, visibility };
}

/**
 * TEK BIR OGE ICIN KARARI VE GEREKCESINI ACIKLAR (2026-09-26).
 *
 * Neden var: "e-postasini ekledim ama hala 403 aliyor" sorusunu TAHMINLE degil OLCUMLE
 * cevaplamak icin. Cogu zaman sebep kuralin yanlis olmasi degildir; oturumdaki e-posta
 * bos ya da farklidir (LDAP'taki mail baska yazilmistir). Bu uc, motorun GERCEKTEN hangi
 * degerlerle karar verdigini gosterir.
 */
async function explainVisibility(user, elementKey) {
  const { elements, rules } = await loadAll();
  const el = elements.find((e) => e.element_key === elementKey);
  const role = (user && user.role) || 'User';
  const usernameLower = ((user && user.username) || '').toLowerCase();
  const mailLower = ((user && user.mail) || '').trim().toLowerCase();
  const groupKeys = groupKeysOf(user);
  if (!el) {
    return {
      element: elementKey, bulundu: false, gorunur: true,
      sebep: 'oge kayitli degil - kayitsiz oge varsayilan olarak GORUNUR',
      kullanici: { username: usernameLower, mail: mailLower, role, grupSayisi: groupKeys.size },
    };
  }
  const ruleIndex = buildRuleIndex(rules);
  const iz = {};
  const kendi = decide(el, ruleIndex, role, usernameLower, groupKeys, mailLower, iz);

  // Ata zinciri: bir ust oge gorunmuyorsa cocuk da gorunmez (kaskad).
  const byKey = new Map(elements.map((e) => [e.element_key, e]));
  const zincir = [];
  let p = el.parent_key;
  const gorulen = new Set([el.element_key]);
  while (p && byKey.has(p) && !gorulen.has(p)) {
    gorulen.add(p);
    const ata = byKey.get(p);
    const ataIz = {};
    zincir.push({
      element: p,
      gorunur: decide(ata, ruleIndex, role, usernameLower, groupKeys, mailLower, ataIz),
      sebep: ataIz.sebep || null,
    });
    p = ata.parent_key;
  }
  const ataEngeli = zincir.find((z) => !z.gorunur) || null;

  return {
    element: elementKey,
    bulundu: true,
    siki: !!iz.strict,
    gorunur: kendi && !ataEngeli,
    sebep: ataEngeli ? `ust oge gizli: ${ataEngeli.element} (${ataEngeli.sebep})` : (iz.sebep || null),
    eslesenKural: iz.kural || null,
    atalar: zincir,
    kullanici: { username: usernameLower, mail: mailLower, role, grupSayisi: groupKeys.size },
    // Bu ogeye tanimli kurallar: "kural var mi, hangi principal ile" sorusunu kapatir.
    kurallar: rules
      .filter((r) => r.element_key === elementKey)
      .map((r) => ({ tip: r.principal_type, kim: r.principal_id, izin: truthy(r.allow) })),
  };
}

// UI icin yumusak surum: motor okunamazsa bos harita doner (istemci varsayilan-acik
// davranir, ekran bos kalmaz). Gercek yetki karari her zaman sunucuda requireVisible'dadir.
async function resolveVisibilitySoft(user) {
  try {
    return await resolveVisibility(user);
  } catch {
    return { version: _version, visibility: {} };
  }
}

// Tek element kontrolu. Registry'de OLMAYAN element → varsayilan gorunur (kayitsiz ogeyi
// yanlislikla kilitlememek icin — kayit admin tarafindan eklenene kadar acik kalir).
async function canSee(user, elementKey) {
  const { visibility } = await resolveVisibility(user);
  return elementKey in visibility ? visibility[elementKey] : true;
}

// Express middleware fabrikasi — element kullaniciya gorunmezse 403. GERCEK server-side deny.
//
// FAIL-CLOSED (G6): motor okunamazsa (DB anlik erisilemez) eskiden `next()` denip erisim
// ACILIYORDU — yani bir DB kesintisi tum gorunurluk sistemini sessizce devre disi
// birakiyordu. Artik 503 ile reddedilir. Admin rolu bu karardan MUAF tutulur ki bir
// kesintide yoneticiler portali onaramaz hale gelmesin.
// Acil kacis: VISIBILITY_FAIL_OPEN=1 (eski davranisa doner, kullanimi loglanir).
function requireVisible(elementKey) {
  return async (req, res, next) => {
    let user = null;
    try {
      user = getRequestUser(req);
      if (!user) return oturumYok(res).status(401).json({ ok: false, error: 'Oturum bulunamadı.' });
      const ok = await canSee(user, elementKey);
      if (!ok) return res.status(403).json({ ok: false, error: 'Bu kaynağa erişiminiz kapalı.' });
      return next();
    } catch (err) {
      if (user && user.role === 'Admin') {
        console.warn(`[visibility] motor okunamadi, Admin muafiyeti ile devam (${elementKey}):`, err.message);
        return next();
      }
      if (process.env.VISIBILITY_FAIL_OPEN === '1') {
        console.warn(`[visibility] motor okunamadi, VISIBILITY_FAIL_OPEN=1 ile ACILDI (${elementKey}):`, err.message);
        return next();
      }
      console.error(`[visibility] motor okunamadi, erisim REDDEDILDI (${elementKey}):`, err.message);
      return res.status(503).json({
        ok: false,
        error: 'Görünürlük servisi geçici olarak kullanılamıyor, erişim güvenlik gereği reddedildi.',
      });
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
  explainVisibility,
  resolveVisibility, resolveVisibilitySoft, canSee, requireVisible, requireVisiblePrefix, getVersion, bumpVersion,
  _applyParentCascade: applyParentCascade,
  // Legacy sayfa-gorunurlugu (DEFAULT_VISIBILITY tablosu) — element-bazli motordan ayri.
  readVisibility, writeVisibility, DEFAULT_VISIBILITY,
  // saf yardimcilar — birim testleri icin acildi (DB gerektirmez)
  _decide: decide, _buildRuleIndex: buildRuleIndex,
};
