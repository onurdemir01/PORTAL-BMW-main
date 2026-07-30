// server/selfservice/store.cjs — Self-service agaci (tabs > subTabs > items), DB-tabanli.
// Kayitlar selfservice_tabs / selfservice_subtabs / selfservice_items tablolarinda tutulur;
// bellek cache'i senkron okumalar icindir. Eski server/data/selfservice.json dosyasi ve
// 'selfservice' config blob'u yalnizca tek seferlik ilk goc kaynagi olarak okunur.
const fs = require("fs");
const path = require("path");
const db = require("../db/index.cjs");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "selfservice.json");

// bump when schema changes
const SCHEMA_VERSION = 1;

function safeParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeStr(x) {
  return String(x ?? "").trim();
}

/**
 * Security: normalize url and block javascript:, data: etc.
 */
function normalizeExternalUrl(raw) {
  const v = normalizeStr(raw);
  if (!v) return "";

  const lower = v.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:")
  ) {
    return "";
  }

  if (v.startsWith("//")) return `https:${v}`;
  if (lower.startsWith("http://") || lower.startsWith("https://")) return v;
  return `https://${v}`;
}

/**
 * Backwards compatibility / migrations
 * - If file is array => interpret as legacy flat items list (rare), convert into one tab/subtab.
 * - Field renames:
 *    - linkUrl -> goUrl
 *    - requestTemplate -> requestExample
 *    - sampleLink/sampleText -> sample
 */
function migrateToV1(data) {
  // already good
  if (data && typeof data === "object" && Array.isArray(data.tabs) && data.version === 1) {
    return data;
  }

  // legacy: missing version but object
  if (data && typeof data === "object" && Array.isArray(data.tabs)) {
    return { version: 1, tabs: data.tabs };
  }

  // legacy: flat array
  if (Array.isArray(data)) {
    const tabId = uid();
    const subTabId = uid();

    const items = data.map((x, i) => normalizeItem({ ...x, tabId, subTabId, order: i + 1 }));
    return {
      version: 1,
      tabs: [
        normalizeTab({
          id: tabId,
          name: "Legacy",
          order: 1,
          subTabs: [
            normalizeSubTab({
              id: subTabId,
              name: "Legacy Items",
              order: 1,
              items,
            }),
          ],
        }),
      ],
    };
  }

  // empty fallback
  return { version: 1, tabs: [] };
}

function normalizeSample(raw) {
  // required: { type: "link"|"text", value: string }
  const type = normalizeStr(raw?.type);
  const value = normalizeStr(raw?.value);

  // legacy helpers
  const sampleLink = normalizeStr(raw?.sampleLink);
  const sampleText = normalizeStr(raw?.sampleText);

  if (!type && (sampleLink || sampleText)) {
    if (sampleLink) return { type: "link", value: normalizeExternalUrl(sampleLink) };
    return { type: "text", value: sampleText };
  }

  if (type === "link") return { type: "link", value: normalizeExternalUrl(value) };
  if (type === "text") return { type: "text", value };
  // default (still invalid if empty - validation will catch)
  return { type: "text", value };
}

function normalizeItem(raw) {
  // required fields: goUrl, requestExample, sample, tabId, subTabId
  const legacyLink = normalizeStr(raw?.linkUrl);
  const goUrl = normalizeExternalUrl(raw?.goUrl || legacyLink);

  const legacyReq = normalizeStr(raw?.requestTemplate);
  const requestExample = normalizeStr(raw?.requestExample || legacyReq);

  const item = {
    id: normalizeStr(raw?.id) || uid(),
    title: normalizeStr(raw?.title || raw?.name || "Untitled"),
    order: Number(raw?.order ?? 0) || 0,

    // indexes required
    tabId: normalizeStr(raw?.tabId),
    subTabId: normalizeStr(raw?.subTabId),

    info: normalizeStr(raw?.info),
    goUrl,
    requestExample,
    details: normalizeStr(raw?.details),
    sample: normalizeSample(raw?.sample || raw),
    extra: normalizeStr(raw?.extra),
  };

  return item;
}

function normalizeSubTab(raw) {
  const items = Array.isArray(raw?.items) ? raw.items.map(normalizeItem) : [];
  return {
    id: normalizeStr(raw?.id) || uid(),
    name: normalizeStr(raw?.name),
    order: Number(raw?.order ?? 0) || 0,
    items,
  };
}

function normalizeTab(raw) {
  const subTabs = Array.isArray(raw?.subTabs) ? raw.subTabs.map(normalizeSubTab) : [];
  const sectionRaw = normalizeStr(raw?.section);
  const section = sectionRaw === "others" ? "others" : "smart";
  return {
    id: normalizeStr(raw?.id) || uid(),
    name: normalizeStr(raw?.name),
    order: Number(raw?.order ?? 0) || 0,
    section,
    subTabs,
  };
}

function normalizeStore(raw) {
  const migrated = migrateToV1(raw);

  const tabs = Array.isArray(migrated.tabs) ? migrated.tabs.map(normalizeTab) : [];

  // ensure orders stable: if order missing, assign based on position
  tabs.forEach((t, i) => {
    if (!t.order) t.order = i + 1;
    t.subTabs.forEach((st, j) => {
      if (!st.order) st.order = j + 1;
      st.items.forEach((it, k) => {
        if (!it.order) it.order = k + 1;
      });
    });
  });

  return { version: 1, tabs };
}

function sortStore(store) {
  const tabs = [...store.tabs].sort((a, b) => a.order - b.order);
  for (const t of tabs) {
    t.subTabs = [...t.subTabs].sort((a, b) => a.order - b.order);
    for (const st of t.subTabs) {
      st.items = [...st.items].sort((a, b) => a.order - b.order);
    }
  }
  return { ...store, tabs };
}

// ── DB satirlari ↔ agac donusumleri ──────────────────────────────────────────
function rowsToStore(tabRows, subRows, itemRows) {
  const tabs = tabRows.map((t) => ({
    id: t.id,
    name: t.name,
    order: t.sort_order ?? 0,
    section: t.section === "others" ? "others" : "smart",
    subTabs: [],
  }));
  const tabById = new Map(tabs.map((t) => [t.id, t]));
  const subById = new Map();
  for (const s of subRows) {
    const sub = { id: s.id, name: s.name, order: s.sort_order ?? 0, items: [] };
    subById.set(s.id, sub);
    const parent = tabById.get(s.tab_id);
    if (parent) parent.subTabs.push(sub);
  }
  for (const it of itemRows) {
    const item = {
      id: it.id,
      title: it.title,
      order: it.sort_order ?? 0,
      tabId: it.tab_id,
      subTabId: it.subtab_id,
      info: it.info || "",
      goUrl: it.go_url || "",
      requestExample: it.request_example || "",
      details: it.details || "",
      sample: { type: it.sample_type === "link" ? "link" : "text", value: it.sample_value || "" },
      extra: it.extra || "",
    };
    const parent = subById.get(it.subtab_id);
    if (parent) parent.items.push(item);
  }
  return sortStore(normalizeStore({ version: 1, tabs }));
}

async function persistStoreToDb(store) {
  // Kucuk, admin-only veri seti: delete-all + re-insert (FK CASCADE alt kayitlari temizler).
  await db.query(`DELETE FROM selfservice_tabs`);
  for (const t of store.tabs) {
    await db.query(
      `INSERT INTO selfservice_tabs (id, name, section, sort_order) VALUES ($1, $2, $3, $4)`,
      [t.id, t.name, t.section === "others" ? "others" : "smart", t.order ?? 0]
    );
    for (const s of t.subTabs) {
      await db.query(
        `INSERT INTO selfservice_subtabs (id, tab_id, name, sort_order) VALUES ($1, $2, $3, $4)`,
        [s.id, t.id, s.name, s.order ?? 0]
      );
      for (const it of s.items) {
        await db.query(
          `INSERT INTO selfservice_items
             (id, subtab_id, tab_id, title, sort_order, info, go_url, request_example, details, sample_type, sample_value, extra)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            it.id, s.id, t.id, it.title, it.order ?? 0, it.info || "", it.goUrl || "",
            it.requestExample || "", it.details || "",
            it.sample?.type === "link" ? "link" : "text", it.sample?.value || "", it.extra || "",
          ]
        );
      }
    }
  }
}

// ── Ust-seviye gruplar (actions.md #5, Bolum D) ──────────────────────────────
// Smart/Ansible/Digerleri ARTIK VERI — eskiden SelfServicePage.tsx'teki TOP_TABS sabitiydi.
// Sabit 3 grup_key (smart/ansible/others) yapisi frontend render mantigina (hangi bolumun
// nasil cizilecegini) baglidir — bu yuzden admin yalniz METADATA'yi (label/icon/sira/aktiflik)
// duzenleyebilir, yeni bir grup_key EKLEYEMEZ (bkz. selfservice/index.cjs PUT /groups/:id).
let _groups = null;

async function reloadGroupsCache() {
  const { rows } = await db.query(`SELECT * FROM selfservice_groups ORDER BY sort_order, id`);
  _groups = rows.map((r) => ({
    id: r.id, groupKey: r.group_key, label: r.label, icon: r.icon || "",
    sortOrder: r.sort_order ?? 0, isActive: r.is_active === true || r.is_active === 1,
  }));
}

function readGroups() {
  return _groups ? _groups.slice() : [
    { id: "grp-smart", groupKey: "smart", label: "Smart", icon: "SparklesIcon", sortOrder: 1, isActive: true },
    { id: "grp-ansible", groupKey: "ansible", label: "Ansible", icon: "CommandLineIcon", sortOrder: 2, isActive: true },
    { id: "grp-others", groupKey: "others", label: "Diğerleri", icon: "EllipsisHorizontalIcon", sortOrder: 3, isActive: true },
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

// ── Bellek cache + yukleme ───────────────────────────────────────────────────
let _store = null; // null → DB henuz yuklenmedi (fallback: eski dosya/bos)

function readStoreFallback() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      return sortStore(normalizeStore(safeParse(raw, { version: 1, tabs: [] })));
    }
  } catch { /* dosya bozuksa bos store */ }
  return { version: 1, tabs: [] };
}

function readStore() {
  return _store ? sortStore(normalizeStore(_store)) : readStoreFallback();
}

async function reloadCache() {
  const [tabs, subs, items] = await Promise.all([
    db.query(`SELECT * FROM selfservice_tabs ORDER BY sort_order, id`),
    db.query(`SELECT * FROM selfservice_subtabs ORDER BY sort_order, id`),
    db.query(`SELECT * FROM selfservice_items ORDER BY sort_order, id`),
  ]);
  _store = rowsToStore(tabs.rows, subs.rows, items.rows);
}

// Yazma: once DB'ye kalici yaz, sonra cache'i guncelle. DB hatasi cagirana firlatilir
// (handler 500 doner) — sessiz veri kaybi olmaz.
async function writeStore(store) {
  const normalized = sortStore(normalizeStore(store));
  try {
    await persistStoreToDb(normalized);
    _store = normalized;
  } catch (e) {
    // Yarim yazma olasiligina karsi cache'i DB'deki gercek durumdan tazele.
    try { await reloadCache(); } catch { /* DB tamamen yoksa cache eski haliyle kalir */ }
    throw e;
  }
  return normalized;
}

// Tek seferlik goc: tablolar bossa eski JSON dosyasi > 'selfservice' blob'u sirasiyla.
async function importLegacyIfEmpty() {
  const { rows } = await db.query(`SELECT COUNT(*) AS n FROM selfservice_tabs`);
  if (Number(rows[0]?.n || 0) > 0) return;

  let source = null;
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = safeParse(fs.readFileSync(DATA_FILE, "utf-8"), null);
      if (parsed && (Array.isArray(parsed) || Array.isArray(parsed.tabs))) source = parsed;
    }
  } catch { /* dosya bozuk → blob dene */ }
  if (!source) {
    try {
      const blob = await db.query(`SELECT data FROM portal_config_blobs WHERE name = $1`, ["selfservice"]);
      if (blob.rows.length) source = safeParse(blob.rows[0].data, null);
    } catch { /* blob yok */ }
  }
  if (!source) return; // bos kurulum — tablo bos kalir

  const store = sortStore(normalizeStore(source));
  if (!store.tabs.length) return;
  await persistStoreToDb(store);
  console.log(`[DB] migrated selfservice (${store.tabs.length} tab)`);
}

async function loadSelfServiceStore() {
  try {
    await importLegacyIfEmpty();
    await reloadCache();
    console.log(`[SelfService] store DB'den yuklendi (${_store.tabs.length} tab).`);
  } catch (e) {
    console.warn("[SelfService] DB yuklenemedi, dosya fallback aktif:", e.message);
  }
  try {
    await reloadGroupsCache();
  } catch (e) {
    console.warn("[SelfService] gruplar DB'den yuklenemedi, sabit varsayilanlar aktif:", e.message);
  }
}

function validateTab(tab) {
  const e = [];
  if (!normalizeStr(tab.name)) e.push("tab.name required");
  return e;
}

function validateSubTab(subTab) {
  const e = [];
  if (!normalizeStr(subTab.name)) e.push("subTab.name required");
  return e;
}

function validateItem(item) {
  const e = [];
  if (!normalizeStr(item.title)) e.push("item.title required");

  if (!normalizeStr(item.tabId)) e.push("item.tabId required");
  if (!normalizeStr(item.subTabId)) e.push("item.subTabId required");

  if (!normalizeStr(item.goUrl)) e.push("item.goUrl required");
  if (!normalizeStr(item.requestExample)) e.push("item.requestExample required");

  if (!item.sample || !normalizeStr(item.sample.type) || !normalizeStr(item.sample.value)) {
    e.push("item.sample required");
  } else {
    const t = String(item.sample.type);
    if (t !== "link" && t !== "text") e.push("item.sample.type must be link|text");
    if (t === "link" && !normalizeExternalUrl(item.sample.value)) e.push("item.sample.link invalid");
  }

  return e;
}

module.exports = {
  DATA_FILE,
  SCHEMA_VERSION,
  readStore,
  writeStore,
  loadSelfServiceStore,
  normalizeStore,
  normalizeTab,
  normalizeSubTab,
  normalizeItem,
  validateTab,
  validateSubTab,
  validateItem,
  uid,
  normalizeExternalUrl,
  sortStore,
  readGroups,
  updateGroup,
};
