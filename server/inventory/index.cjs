// server/inventory/index.cjs
const express = require("express");
const fs = require("fs");
const path = require("path");
const { getPool, isAvailable, query, sql, poolStats } = require("./mssql.cjs");
const { getRequestUser, getRequestRole } = require("../auth/index.cjs");

// actions.md #20 (Bolum P) — salt-okunur havuz tanimli degilse bu uyariyi SADECE BIR KEZ logla.
let _warnedSharedPoolFallback = false;

// ── Blocklist — system tables + internal portal tables (never exposed via API) ──
const BLOCKED_TABLES = [
  "sys", "sysdiagrams", "MSreplication_options", "dtproperties",
  // Internal portal tables — must not be visible in inventory UI
  "logx_sessions", "logx_audit_logs", "logx_permissions",
  "inventory_hosts", "servers",
];

// Fallback list used when DB is unavailable
const FALLBACK_TABLES = [
  "Inventory",
  "MWAppsInventory",
  "OpenshiftInventory",
  "WDS_CTG",
  "WDS_IHS",
  "WDS_JBOSS",
  "WDS_NGINX",
  "WDS_RHA",
  "ekip_infos",
];

// ── Table cache (60 s TTL) ────────────────────────────────────────────────────
let _tableCache = null;
let _tableCacheAt = 0;
const TABLE_CACHE_TTL = 60_000;

// ── Column LRU cache (5 min TTL, max 50 tables) ───────────────────────────────
// entry: { cols: string[], colTypes: Map<colName, DATA_TYPE>, at: number } — colTypes
// arama-kolonu filtrelemesi icin kullanilir (bkz. getSearchableColumns).
const COL_CACHE_MAX = 50;
const COL_CACHE_TTL = 5 * 60 * 1000;
const _colCache = new Map();

function colCacheGet(table) {
  const entry = _colCache.get(table);
  if (!entry) return null;
  if (Date.now() - entry.at > COL_CACHE_TTL) {
    _colCache.delete(table);
    return null;
  }
  // LRU: move to end
  _colCache.delete(table);
  _colCache.set(table, entry);
  return entry;
}

function colCacheSet(table, cols, colTypes) {
  if (_colCache.has(table)) _colCache.delete(table);
  if (_colCache.size >= COL_CACHE_MAX) {
    const firstKey = _colCache.keys().next().value;
    _colCache.delete(firstKey);
  }
  _colCache.set(table, { cols, colTypes: colTypes || new Map(), at: Date.now() });
}

// ── Table alias helpers (DB: inventory_table_aliases — eskiden
//    server/data/inventory-table-aliases.json) ─────────────────────────────────
async function readAliases() {
  try {
    // is_active=0 olan bir alias artik gorunmez (raw tablo adina duser) — actions.md #13.
    const result = await query(`SELECT table_name, alias FROM inventory_table_aliases WHERE is_active = 1`);
    const map = {};
    for (const r of result.recordset) map[r.table_name] = r.alias;
    return map;
  } catch {
    return {};
  }
}

// Admin ekrani icin TAM satirlari doner (schema/description/is_active/language/sort_order dahil).
async function readAliasesDetailed() {
  try {
    const result = await query(`SELECT * FROM inventory_table_aliases ORDER BY sort_order, table_name`);
    return result.recordset.map((r) => ({
      tableName: r.table_name,
      alias: r.alias,
      schemaName: r.schema_name || "",
      description: r.description || "",
      isActive: r.is_active === true || r.is_active === 1,
      language: r.language || "tr",
      sortOrder: r.sort_order ?? 0,
    }));
  } catch {
    return [];
  }
}

async function setAlias(tableName, alias, extra = {}) {
  const schemaName = extra.schemaName != null ? String(extra.schemaName) : null;
  const description = extra.description != null ? String(extra.description) : null;
  const isActive = extra.isActive !== false;
  const language = extra.language ? String(extra.language) : "tr";
  const sortOrder = Number.isFinite(Number(extra.sortOrder)) ? Number(extra.sortOrder) : 0;

  const exists = await query(`SELECT id FROM inventory_table_aliases WHERE table_name = @t`, [{ name: "t", type: sql.NVarChar(255), value: tableName }]);
  const params = [
    { name: "a", type: sql.NVarChar(255), value: alias },
    { name: "t", type: sql.NVarChar(255), value: tableName },
    { name: "schema", type: sql.NVarChar(128), value: schemaName },
    { name: "desc", type: sql.NVarChar(500), value: description },
    { name: "active", type: sql.Bit, value: isActive },
    { name: "lang", type: sql.NVarChar(10), value: language },
    { name: "sort", type: sql.Int, value: sortOrder },
  ];
  if (exists.recordset.length > 0) {
    await query(
      `UPDATE inventory_table_aliases
         SET alias = @a, schema_name = @schema, description = @desc, is_active = @active,
             language = @lang, sort_order = @sort, updated_at = GETUTCDATE()
       WHERE table_name = @t`,
      params
    );
  } else {
    await query(
      `INSERT INTO inventory_table_aliases (table_name, alias, schema_name, description, is_active, language, sort_order)
       VALUES (@t, @a, @schema, @desc, @active, @lang, @sort)`,
      params
    );
  }
}

async function removeAlias(tableName) {
  await query(`DELETE FROM inventory_table_aliases WHERE table_name = @t`, [{ name: "t", type: sql.NVarChar(255), value: tableName }]);
}

// ── Tablo gorunurlugu — YENI sema (actions.md #12, Bolum K) ───────────────────
// Eskiden inventory_visible_tables (2 satir: role_name→CSV) tek kaynakti. Artik HER
// fiziksel tablo icin inventory_table_visibility'de bir satir var; rol-bazli kural
// inventory_table_role_visibility'de cok-satirli tutulur. table_name='*' bir SENTINEL
// satirdir ("tum tablolar" — eski {tables:"*"} davranisini temsil eder). Kullanici-bazli
// override (inventory_table_user_override) ve kolon-gorunurlugu (inventory_column_visibility)
// TAMAMEN yeni katmanlardir. Bu bolumdeki DIS API sekli (readVisibleTables/
// writeVisibleTablesForRole/filterTablesByRole imzalari ve donus bicimi) BILEREK KORUNUR —
// /visible-tables route'u ve SystemConfigTab.tsx hic degismeden calismaya devam eder
// (adapter deseni).
const DEFAULT_VISIBLE = {
  User:  ["Inventory", "MWAppsInventory", "OpenshiftInventory"],
  Admin: "*",
};

let _visibleTablesCache = null;
let _visibleTablesCacheAt = 0;
const VISIBLE_TABLES_TTL = 60_000;

let _reconciledAt = 0;
const RECONCILE_TTL = 10 * 60 * 1000; // tablo semasi nadiren degisir — her istekte taramaya gerek yok
let _legacyMigrated = false;

// INFORMATION_SCHEMA'daki HER tablo icin bir inventory_table_visibility satiri garantiler
// (yoksa ekler, is_active=1); artik DB'de var olmayan bir tabloya ait eski satir varsa
// is_active=0 yapar (SILMEZ — gecmis kurallar kaybolmasin, soft-delete).
async function reconcileTableVisibility(liveTableNames) {
  if (Date.now() - _reconciledAt < RECONCILE_TTL) return;
  try {
    await query(
      `IF NOT EXISTS (SELECT 1 FROM inventory_table_visibility WHERE table_name = '*')
       INSERT INTO inventory_table_visibility (schema_name, table_name, display_name, is_active)
       VALUES ('*', '*', N'Tüm Tablolar (*)', 1)`
    );

    const existing = await query(`SELECT table_name, is_active FROM inventory_table_visibility`);
    const existingMap = new Map(existing.recordset.map((r) => [r.table_name, r.is_active === true || r.is_active === 1]));
    const liveSet = new Set(liveTableNames);

    for (const t of liveTableNames) {
      if (!existingMap.has(t)) {
        await query(`INSERT INTO inventory_table_visibility (table_name) VALUES (@t)`,
          [{ name: "t", type: sql.NVarChar(255), value: t }]).catch(() => {});
      } else if (existingMap.get(t) === false) {
        await query(`UPDATE inventory_table_visibility SET is_active = 1, updated_at = GETUTCDATE() WHERE table_name = @t`,
          [{ name: "t", type: sql.NVarChar(255), value: t }]).catch(() => {});
      }
    }
    for (const [name, active] of existingMap) {
      if (name === "*" || liveSet.has(name) || !active) continue;
      await query(`UPDATE inventory_table_visibility SET is_active = 0, updated_at = GETUTCDATE() WHERE table_name = @t`,
        [{ name: "t", type: sql.NVarChar(255), value: name }]).catch(() => {});
    }
    _reconciledAt = Date.now();
  } catch (e) {
    console.warn("[Inventory] tablo gorunurlugu uzlastirilamadi:", e.message);
  }
}

// Bir kerelik goc: eski 2-satirlik CSV modelini yeni semaya tasir. Tablo (rol-gorunurluk)
// zaten doluysa (daha once gocmus veya admin yeni semayi elle duzenlemisse) DOKUNMAZ.
// Eski tablo da tamamen bossa (hic yapilandirilmamis taze kurulum) DEFAULT_VISIBLE'i
// yeni semaya yazar — eski varsayilan davranis korunur.
async function migrateLegacyVisibleTablesIfNeeded() {
  if (_legacyMigrated) return;
  try {
    const roleRows = await query(`SELECT COUNT(*) AS n FROM inventory_table_role_visibility`);
    if (Number(roleRows.recordset[0]?.n || 0) > 0) { _legacyMigrated = true; return; }

    const legacy = await query(`SELECT role_name, tables FROM inventory_visible_tables`);
    const sourceRows = legacy.recordset.length
      ? legacy.recordset.map((r) => ({ role_name: r.role_name, tables: r.tables }))
      : Object.entries(DEFAULT_VISIBLE).map(([role_name, tables]) => ({ role_name, tables }));

    const tvRows = await query(`SELECT id, table_name FROM inventory_table_visibility`);
    const idByName = new Map(tvRows.recordset.map((r) => [r.table_name, r.id]));

    for (const row of sourceRows) {
      const role = row.role_name;
      if (row.tables === "*") {
        const sentinelId = idByName.get("*");
        if (sentinelId) {
          await query(
            `INSERT INTO inventory_table_role_visibility (table_visibility_id, role_name, can_view) VALUES (@id, @r, 1)`,
            [{ name: "id", type: sql.Int, value: sentinelId }, { name: "r", type: sql.NVarChar(50), value: role }]
          ).catch(() => {});
        }
        continue;
      }
      const names = String(row.tables || "").split(",").map((s) => s.trim()).filter(Boolean);
      for (const n of names) {
        const id = idByName.get(n);
        if (!id) continue; // uzlastirma henuz calismamis/tablo artik yok — sessizce atla
        await query(
          `INSERT INTO inventory_table_role_visibility (table_visibility_id, role_name, can_view) VALUES (@id, @r, 1)`,
          [{ name: "id", type: sql.Int, value: id }, { name: "r", type: sql.NVarChar(50), value: role }]
        ).catch(() => {});
      }
    }
    console.log("[Inventory] Eski gorunurluk verisi yeni semaya gocuruldu.");
    _legacyMigrated = true;
  } catch (e) {
    console.warn("[Inventory] Eski gorunurluk verisi gocurulemedi:", e.message);
  }
}

async function readVisibleTables() {
  if (_visibleTablesCache && Date.now() - _visibleTablesCacheAt < VISIBLE_TABLES_TTL) {
    return _visibleTablesCache;
  }
  try {
    await migrateLegacyVisibleTablesIfNeeded();
    const { recordset } = await query(
      `SELECT rv.role_name, tv.table_name
         FROM inventory_table_role_visibility rv
         JOIN inventory_table_visibility tv ON tv.id = rv.table_visibility_id
        WHERE rv.can_view = 1 AND (tv.table_name = '*' OR tv.is_active = 1)`
    );
    const config = {};
    for (const r of recordset) {
      if (r.table_name === "*") { config[r.role_name] = "*"; continue; }
      if (config[r.role_name] === "*") continue; // sentinel her zaman kazanir
      (config[r.role_name] ??= []).push(r.table_name);
    }
    if (!("User" in config)) config.User = DEFAULT_VISIBLE.User;
    if (!("Admin" in config)) config.Admin = DEFAULT_VISIBLE.Admin;
    _visibleTablesCache = config;
    _visibleTablesCacheAt = Date.now();
    return config;
  } catch {
    return _visibleTablesCache || DEFAULT_VISIBLE;
  }
}

async function writeVisibleTablesForRole(role, tables) {
  const tvRows = await query(`SELECT id, table_name FROM inventory_table_visibility`);
  const idByName = new Map(tvRows.recordset.map((r) => [r.table_name, r.id]));

  await query(`DELETE FROM inventory_table_role_visibility WHERE role_name = @r`,
    [{ name: "r", type: sql.NVarChar(50), value: role }]);

  if (tables === "*") {
    const sentinelId = idByName.get("*");
    if (sentinelId) {
      await query(`INSERT INTO inventory_table_role_visibility (table_visibility_id, role_name, can_view) VALUES (@id, @r, 1)`,
        [{ name: "id", type: sql.Int, value: sentinelId }, { name: "r", type: sql.NVarChar(50), value: role }]);
    }
  } else if (Array.isArray(tables)) {
    for (const t of tables) {
      const id = idByName.get(t);
      if (!id) continue; // bilinmeyen tablo adi sessizce atlanir (eski CSV davranisiyla ayni)
      await query(`INSERT INTO inventory_table_role_visibility (table_visibility_id, role_name, can_view) VALUES (@id, @r, 1)`,
        [{ name: "id", type: sql.Int, value: id }, { name: "r", type: sql.NVarChar(50), value: role }]).catch(() => {});
    }
  }
  _visibleTablesCache = null; // sonraki okuma taze veriyi ceksin
}

// Kullanici-bazli override haritasi (actions.md #12) — allow rol kuralinin USTUNE gecer
// (gormedigi bir tabloyu ACAR), deny rol kuralinin USTUNE gecer (gordugu bir tabloyu KAPAR).
async function getUserOverridesForUser(username) {
  const { recordset } = await query(
    `SELECT tv.table_name, o.override_type
       FROM inventory_table_user_override o
       JOIN inventory_table_visibility tv ON tv.id = o.table_visibility_id
      WHERE o.username = @u`,
    [{ name: "u", type: sql.NVarChar(255), value: String(username || "").toLowerCase() }]
  );
  const map = new Map();
  for (const r of recordset) map.set(r.table_name, r.override_type);
  return map;
}

// "*" rolu icin bile is_active=0 (admin tarafindan aciktan gizlenmis) tablolari haric tutar —
// aksi halde "*" (tum tablolar) kurali fetchTableList()'in canli sonucunu FILTRESIZ gecirirdi,
// admin'in bir tabloyu Pasif yapmasinin "*" rolleri icin hicbir etkisi olmazdi.
let _inactiveCache = null;
let _inactiveCacheAt = 0;

async function getInactiveTableNames() {
  if (_inactiveCache && Date.now() - _inactiveCacheAt < VISIBLE_TABLES_TTL) return _inactiveCache;
  try {
    const { recordset } = await query(`SELECT table_name FROM inventory_table_visibility WHERE is_active = 0 AND table_name <> '*'`);
    _inactiveCache = new Set(recordset.map((r) => r.table_name));
  } catch {
    _inactiveCache = _inactiveCache || new Set();
  }
  _inactiveCacheAt = Date.now();
  return _inactiveCache;
}

// username verilmisse kullanici-override katmani da uygulanir; verilmemisse (geriye
// donuk uyumluluk) yalniz rol kurali uygulanir — mevcut cagiranlar KIRILMAZ.
async function filterTablesByRole(tables, role, username) {
  const config = await readVisibleTables();
  const roleKey = role === "Admin" ? "Admin" : "User";
  const allowed = config[roleKey];
  let base = allowed === "*" ? tables.slice() : (Array.isArray(allowed) ? tables.filter((t) => allowed.includes(t)) : tables.slice());

  const inactive = await getInactiveTableNames();
  if (inactive.size) base = base.filter((t) => !inactive.has(t));

  if (!username) return base;
  try {
    const overrides = await getUserOverridesForUser(username);
    if (!overrides.size) return base;
    const baseSet = new Set(base);
    for (const t of tables) {
      const ov = overrides.get(t);
      if (ov === "allow") baseSet.add(t);
      else if (ov === "deny") baseSet.delete(t);
    }
    return tables.filter((t) => baseSet.has(t)); // orijinal sirayi koru
  } catch {
    return base;
  }
}

// ── Advanced filter WHERE builder ─────────────────────────────────────────────
// Onceden "WHERE " onekli string donuyordu; caller .startsWith("WHERE ")/.slice(6) ile
// bunu tekrar cikariyordu — kirilgan coupling (kurumsal AI kod incelemesi, review.md #8).
// Artik yalniz kosul metnini (onek YOK) veya bos string doner; WHERE eklemek TEK yerde
// (buildWhere) yapilir. filterGroup gecerliligi burada kontrol edilir; caller tekrar
// kontrol ETMEZ (tek dogruluk kaynagi burasi).
function buildAdvancedWhereClause(filterGroup, allCols, req) {
  if (!filterGroup || !Array.isArray(filterGroup.filters) || filterGroup.filters.length === 0) {
    return "";
  }
  const mode = filterGroup.mode === "OR" ? " OR " : " AND ";
  const parts = [];
  let idx = 0;
  for (const f of filterGroup.filters) {
    if (!f.col || !allCols.includes(f.col)) continue;
    const p = `af${idx++}`;
    const colExpr = `CAST([${f.col}] AS NVARCHAR(MAX))`;
    switch (f.op) {
      case "contains":
        req.input(p, sql.NVarChar(512), `%${f.value}%`);
        parts.push(`${colExpr} LIKE @${p}`);
        break;
      case "notContains":
        req.input(p, sql.NVarChar(512), `%${f.value}%`);
        parts.push(`${colExpr} NOT LIKE @${p}`);
        break;
      case "equals":
        req.input(p, sql.NVarChar(512), f.value);
        parts.push(`${colExpr} = @${p}`);
        break;
      case "notEquals":
        req.input(p, sql.NVarChar(512), f.value);
        parts.push(`${colExpr} <> @${p}`);
        break;
      case "startsWith":
        req.input(p, sql.NVarChar(512), `${f.value}%`);
        parts.push(`${colExpr} LIKE @${p}`);
        break;
      case "endsWith":
        req.input(p, sql.NVarChar(512), `%${f.value}`);
        parts.push(`${colExpr} LIKE @${p}`);
        break;
      case "isNull":
        parts.push(`${quoteIdent(f.col)} IS NULL`);
        break;
      case "isNotNull":
        parts.push(`${quoteIdent(f.col)} IS NOT NULL`);
        break;
      case "gt":
        req.input(p, sql.NVarChar(256), f.value);
        parts.push(`${colExpr} > @${p}`);
        break;
      case "gte":
        req.input(p, sql.NVarChar(256), f.value);
        parts.push(`${colExpr} >= @${p}`);
        break;
      case "lt":
        req.input(p, sql.NVarChar(256), f.value);
        parts.push(`${colExpr} < @${p}`);
        break;
      case "lte":
        req.input(p, sql.NVarChar(256), f.value);
        parts.push(`${colExpr} <= @${p}`);
        break;
      default:
        break;
    }
  }
  return parts.join(mode);
}

// ── Saved queries helpers ─────────────────────────────────────────────────────
// Kayitli sorgular artik DB'de (inventory_saved_queries); eski server/data/
// inventory-saved-queries.json yalnizca tek seferlik goc kaynagidir.
const SAVED_QUERIES_FILE = path.join(__dirname, "../data/inventory-saved-queries.json");
const portalDb = require("../db/index.cjs");

// In-memory cache — senkron okumalar icin (DB yuklenene kadar dosya fallback).
let _sqCache = null;

function normalizeSavedQuery(q) {
  return {
    name: q.name || "",
    sql: q.sql || "",
    isPublished: typeof q.isPublished === "undefined" ? true : !!q.isPublished,
    isDefault: !!q.isDefault,
    publishedBy: q.publishedBy || "",
    savedAt: q.savedAt || new Date().toISOString(),
    description: q.description || "",
  };
}

function savedQueriesFileFallback() {
  try {
    if (!fs.existsSync(SAVED_QUERIES_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(SAVED_QUERIES_FILE, "utf-8"));
    return Array.isArray(raw) ? raw.map(normalizeSavedQuery) : [];
  } catch {
    return [];
  }
}

function readSavedQueries() {
  return _sqCache ? _sqCache.slice() : savedQueriesFileFallback();
}

function sqRowToQuery(r) {
  return {
    name: r.name,
    sql: r.sql_text || "",
    isPublished: !!r.is_published,
    isDefault: !!r.is_default,
    publishedBy: r.published_by || "",
    savedAt: r.saved_at instanceof Date ? r.saved_at.toISOString() : String(r.saved_at || ""),
    description: r.description || "",
  };
}

async function reloadSavedQueriesCache() {
  const { rows } = await portalDb.query(`SELECT * FROM inventory_saved_queries ORDER BY name`);
  _sqCache = rows.map(sqRowToQuery);
}

// JSON.stringify anahtar EKLEME SIRASINA duyarlidir — iki farkli uretici (sqRowToQuery /
// normalizeSavedQuery) bugun ayni sirada alan tanimliyor olsa da, bu SESSIZCE kirilabilecek
// bir varsayimdir. writeSavedQueries'in "degisti mi?" karsilastirmasi bu yuzden anahtarlari
// once siralayip stringify eder — alan tanimlama sirasindan tamamen bagimsiz.
function stableStringify(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

// UPDATE-once → 0 satirsa INSERT deseni (kod tabaninda zaten yerlesik — bkz. setAlias/
// writeVisibleTablesForRole yukarida). Tek bir kaydin yazimidir; atomiklik disaridaki
// writeSavedQueries'in per-row cagrisindan gelir.
async function upsertSavedQuery(q) {
  const upd = await portalDb.query(
    `UPDATE inventory_saved_queries SET sql_text=$1, is_published=$2, is_default=$3, published_by=$4, description=$5, saved_at=$6 WHERE name=$7`,
    [q.sql, q.isPublished ? 1 : 0, q.isDefault ? 1 : 0, q.publishedBy, q.description, q.savedAt, q.name]
  );
  if (!upd.rowCount) {
    await portalDb.query(
      `INSERT INTO inventory_saved_queries (name, sql_text, is_published, is_default, published_by, description, saved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [q.name, q.sql, q.isPublished ? 1 : 0, q.isDefault ? 1 : 0, q.publishedBy, q.description, q.savedAt]
    );
  }
}

// Eskiden delete-all + N adet INSERT dongusu (N+1, atomik degil — DELETE basarili olup
// bir INSERT basarisiz olursa TUM liste kaybolurdu). Artik _sqCache'teki bilinen ONCEKI
// durumla FARK alinir: yalniz DEGISEN kayitlar UPSERT edilir, yalniz KALDIRILAN kayitlar
// silinir. Tipik tek-satir mutasyonlarda (publish toggle, set-default, tek kayit) N yerine
// 1-2 DB yazimi olur; hicbir asamada mevcut veri once silinip sonra yeniden eklenmiyor —
// yarida kesilen bir cagri en kotu ihtimalle bazi satirlari guncellemeden birakir, hicbir
// zaman tum listeyi kaybettirmez (kurumsal AI kod incelemesi, review.md #12/#13).
async function writeSavedQueries(data) {
  const queries = (data || []).map(normalizeSavedQuery);
  const prevByName = new Map((_sqCache || []).map((q) => [q.name, q]));
  const nextNames = new Set(queries.map((q) => q.name));

  for (const q of queries) {
    const prev = prevByName.get(q.name);
    if (!prev || stableStringify(prev) !== stableStringify(q)) {
      await upsertSavedQuery(q);
    }
  }
  const removed = [...prevByName.keys()].filter((n) => !nextNames.has(n));
  if (removed.length > 0) {
    await portalDb.query(
      `DELETE FROM inventory_saved_queries WHERE name IN (${removed.map((_, i) => `$${i + 1}`).join(",")})`,
      removed
    );
  }
  _sqCache = queries;
}

// Tek seferlik goc: tablo bossa eski JSON dosyasindan icaktar.
async function importSavedQueriesIfEmpty() {
  const { rows } = await portalDb.query(`SELECT COUNT(*) AS n FROM inventory_saved_queries`);
  if (Number(rows[0]?.n || 0) > 0) return;
  const legacy = savedQueriesFileFallback();
  if (!legacy.length) return;
  await writeSavedQueries(legacy);
  console.log(`[DB] migrated inventory-saved-queries (${legacy.length} satir)`);
}

async function loadSavedQueriesStore() {
  try {
    await importSavedQueriesIfEmpty();
    await reloadSavedQueriesCache();
    console.log(`[Inventory] ${_sqCache.length} kayitli sorgu DB'den yuklendi.`);
  } catch (e) {
    console.warn("[Inventory] kayitli sorgular DB'den yuklenemedi, dosya fallback aktif:", e.message);
  }
}

// ── Security ─────────────────────────────────────────────────────────────────
function isSelectOnly(sqlText) {
  const cleaned = sqlText.replace(/\s+/g, " ").trim().toUpperCase();
  if (!cleaned.startsWith("SELECT")) return false;
  // Tek-ifade zorunlulugu: mesru SELECT'ler ';' gerektirmez, coklu-ifade injection'ini
  // (bir sonraki ifade banned-list disi bir sey olsa bile) engeller.
  if (cleaned.replace(/;\s*$/, "").includes(";")) return false;
  const banned =
    /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|EXEC|EXECUTE|TRUNCATE|MERGE|GRANT|REVOKE|WAITFOR|OPENROWSET|OPENQUERY|OPENDATASOURCE|BULK|DBCC|SHUTDOWN|BACKUP|RESTORE|KILL)\b/;
  if (banned.test(cleaned)) return false;
  // 4-parcali linked-server adlandirmasi (sunucu.veritabani.sema.tablo) — OPENQUERY/
  // OPENDATASOURCE disindaki tek linked-server erisim yolu; extractReferencedTables'in
  // tablo-whitelist'i bunu yakalayamaz (son segment tesaduefen izinli bir tabloyla
  // eslesebilir). Yerel referanslar en fazla tek nokta icerir (dbo.Tablo) — 3+ nokta
  // hep linked-server'dir (kurumsal AI kod incelemesi, review.md #6).
  if (/\b(?:FROM|JOIN)\s+\[?\w+\]?(?:\s*\.\s*\[?\w*\]?){3,}/.test(cleaned)) return false;
  return true;
}

// sqlText icinde FROM/JOIN sonrasi referans edilen tablo adlarini cikarir (basit regex,
// tam SQL parser degil). Schema-onekli (dbo.Table) veya koseli parantezli ([dbo].[Table])
// bicimlerde son segmenti tablo adi olarak alir.
function extractReferencedTables(sqlText) {
  const names = new Set();
  const re = /\b(?:FROM|JOIN)\s+\[?(?:\w+\]?\.\[?)?(\w+)\]?/gi;
  let m;
  while ((m = re.exec(sqlText))) {
    if (m[1]) names.add(m[1]);
  }
  return [...names];
}

// ── Admin helper ──────────────────────────────────────────────────────────────
// Header'a dogrudan guvenmez — session veya secret'li guvenilir header (auth getRequestRole).
function isAdmin(req) {
  return getRequestRole(req) === "Admin";
}

// ── Table list helpers ────────────────────────────────────────────────────────
async function fetchTableList() {
  if (_tableCache && Date.now() - _tableCacheAt < TABLE_CACHE_TTL) {
    return _tableCache;
  }
  if (!isAvailable()) return FALLBACK_TABLES;
  try {
    const result = await query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
      []
    );
    const tables = result.recordset
      .map((r) => r.TABLE_NAME)
      .filter((t) => !BLOCKED_TABLES.includes(t));
    _tableCache = tables;
    _tableCacheAt = Date.now();
    reconcileTableVisibility(tables).catch(() => {}); // best-effort, kendi TTL'iyle sinirli
    return tables;
  } catch {
    return _tableCache || FALLBACK_TABLES;
  }
}

async function isAllowedTable(tableName) {
  if (BLOCKED_TABLES.includes(tableName)) return false;
  const tables = await fetchTableList();
  return tables.includes(tableName);
}

// Tablo/kolon adlarini SQL kimlik-tirnagi ile sarar — bu dosyadaki tum `[${name}]`
// interpolasyon siteleri (isAllowedTable/allCols.includes kontrolunden SONRA cagrilir)
// tek bir yerden gecsin diye (kopyala-yapistir riski — kurumsal AI kod incelemesi,
// review.md #10). MSSQL tablo/kolon adini parametrize edemedigi icin whitelist kontrolu
// (isAllowedTable / allCols.includes) TEK savunma katmanidir; bu fonksiyon yalniz
// bicimlendirme yapar, kendisi bir guvenlik kontrolu DEGILDIR.
function quoteIdent(name) {
  return `[${name}]`;
}

// ── Column list helper ────────────────────────────────────────────────────────
async function getColumns(table) {
  const cached = colCacheGet(table);
  if (cached) return cached.cols;
  const result = await query(
    `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @table ORDER BY ORDINAL_POSITION`,
    [{ name: "table", type: sql.VarChar(128), value: table }]
  );
  const cols = result.recordset.map((r) => r.COLUMN_NAME);
  const colTypes = new Map(result.recordset.map((r) => [r.COLUMN_NAME, r.DATA_TYPE]));
  colCacheSet(table, cols, colTypes);
  return cols;
}

// Kolon-seviyesi gorunurluk (actions.md #12) — tablo_adi → gizli kolon isimleri Set'i.
// Admin bu kontrolu BYPASS eder (yonetim ekrani tum kolonlari gorebilmeli); User icin
// hem /columns hem /data yanitlarindan bu kolonlar tamamen cikarilir.
const _hiddenColumnsCache = new Map(); // table_visibility_id → { cols: Set, at: number }
const HIDDEN_COLUMNS_TTL = 60_000;

async function getHiddenColumnsForTable(tableName) {
  try {
    const tv = await query(`SELECT id FROM inventory_table_visibility WHERE table_name = @t`, [{ name: "t", type: sql.NVarChar(255), value: tableName }]);
    const id = tv.recordset[0]?.id;
    if (!id) return new Set();
    const cached = _hiddenColumnsCache.get(id);
    if (cached && Date.now() - cached.at < HIDDEN_COLUMNS_TTL) return cached.cols;
    const { recordset } = await query(
      `SELECT column_name FROM inventory_column_visibility WHERE table_visibility_id = @id AND role_name = 'ALL' AND is_visible = 0`,
      [{ name: "id", type: sql.Int, value: id }]
    );
    const cols = new Set(recordset.map((r) => r.column_name));
    _hiddenColumnsCache.set(id, { cols, at: Date.now() });
    return cols;
  } catch {
    return new Set();
  }
}

const TEXT_COLUMN_TYPES = new Set(["char", "varchar", "nchar", "nvarchar", "text", "ntext"]);

// search parametresi artik TUM kolonlara degil, yalniz metin-tipi kolonlara CAST+LIKE
// uygular (kurumsal AI kod incelemesi, review.md #5) — sayisal/tarih kolonlarda CAST+LIKE
// index kullanamayan, anlamsiz bir tarama zaten (ayrica yanlis-pozitif riski de tasir).
// Tip bilgisi getColumns() ile ayni cache girdisinde tutulur, ek sorgu gerekmez.
async function getSearchableColumns(table) {
  await getColumns(table); // cache'i (colTypes dahil) doldurur, yoksa
  const entry = colCacheGet(table);
  if (!entry) return [];
  return entry.cols.filter((c) => TEXT_COLUMN_TYPES.has(String(entry.colTypes.get(c) || "").toLowerCase()));
}

// ── Ekip sahipligi lookup (Dynatrace/Instana entity zenginlestirme icin) ──────
// `ekip_infos` semasi sabit degil (generic inventory browser) — host/ekip
// kolonlari isim oruntusuyle kesfedilir. Eslesme bulunamazsa bos Map doner
// (fail-open: takim bilgisi gosterilmez, istek basarisiz olmaz).
const HOST_COL_HINTS = ["host", "sunucu", "server", "hostname", "makine"];
const TEAM_COL_HINTS = ["ekip", "takim", "takım", "team", "sahip", "owner"];

let _teamColsCache = null; // { hostCol, teamCol } | false (bulunamadi) | null (henuz denenmedi)

async function resolveTeamColumns() {
  if (_teamColsCache !== null) return _teamColsCache || null;
  try {
    if (!isAvailable() || !(await isAllowedTable("ekip_infos"))) {
      _teamColsCache = false;
      return null;
    }
    const cols = await getColumns("ekip_infos");
    const hostCol = cols.find((c) => HOST_COL_HINTS.some((h) => c.toLowerCase().includes(h)));
    const teamCol = cols.find((c) => TEAM_COL_HINTS.some((h) => c.toLowerCase().includes(h)));
    if (!hostCol || !teamCol) {
      console.warn("[Inventory] ekip_infos icinde host/ekip kolonu bulunamadi — takim sahipligi devre disi.", { cols });
      _teamColsCache = false;
      return null;
    }
    _teamColsCache = { hostCol, teamCol };
    return _teamColsCache;
  } catch (err) {
    console.warn("[Inventory] ekip_infos kolon kesfi basarisiz:", err.message);
    _teamColsCache = false;
    return null;
  }
}

// hostnames: string[] → Map<hostname.toLowerCase(), teamName>
async function getTeamOwnership(hostnames) {
  const result = new Map();
  const names = (hostnames || []).map((h) => String(h || "").trim()).filter(Boolean);
  if (names.length === 0) return result;

  const resolved = await resolveTeamColumns();
  if (!resolved) return result;
  const { hostCol, teamCol } = resolved;

  try {
    const placeholders = names.map((_, i) => `@h${i}`).join(", ");
    const inputs = names.map((v, i) => ({ name: `h${i}`, type: sql.NVarChar(256), value: v }));
    const rows = await query(
      `SELECT ${quoteIdent(hostCol)} AS host_, ${quoteIdent(teamCol)} AS team_ FROM ${quoteIdent("ekip_infos")} WHERE ${quoteIdent(hostCol)} IN (${placeholders})`,
      inputs
    );
    for (const r of rows.recordset || []) {
      if (r.host_ && r.team_) result.set(String(r.host_).toLowerCase(), String(r.team_));
    }
  } catch (err) {
    console.warn("[Inventory] getTeamOwnership sorgusu basarisiz:", err.message);
  }
  return result;
}

// ── Main export ───────────────────────────────────────────────────────────────
function initInventory(app) {
  loadSavedQueriesStore().catch((e) => console.warn("[Inventory] store yukleme hata:", e.message));
  // Tum mutasyonlar (sorgu calistirma/kaydetme/yayinlama, alias/gorunurluk) audit'lenir.
  try { app.use("/api/inventory", require("../audit/index.cjs").auditMutations("inventory")); } catch { /* yoksay */ }
  const router = express.Router();
  router.use(express.json({ limit: "1mb" }));

  // Envanter sayfasi gizliyse gercek 403. /health muaf (probe). Not: envanter tablolari
  // ayrica rol-bazli ACL (filterTablesByRole) ile korunur — bu, sayfa-seviyesi ek katman.
  try {
    const { requireVisiblePrefix } = require("../auth/visibility.cjs");
    router.use(requireVisiblePrefix("Envanter", { exempt: ["/health"] }));
  } catch { /* motor yoksa yoksay */ }

  // ── Health ──────────────────────────────────────────────────────────────────
  // E-08: server/port/db (no password); N-03: pool stats
  router.get("/health", (req, res) => {
    const server   = process.env.MSSQL_SERVER   || null;
    const port     = process.env.MSSQL_PORT     || "1433";
    const database = process.env.MSSQL_DATABASE || null;
    res.json({
      ok: true,
      service: "inventory",
      mssqlAvailable: isAvailable(),
      server,
      port,
      database,
      pool: poolStats(),
    });
  });

  // ── Table list (60 s cache, fallback on DB unavailability) ──────────────────
  // E-02: includes blocklisted and visibleToRole metadata (admin only)
  router.get("/tables", async (req, res) => {
    const role = getRequestRole(req) || "User";
    const admin = role === "Admin";
    // "Farkli rol gibi goruntule" — sadece gercek rolu Admin olan istekler icin gecerli,
    // client'in kendini Admin olarak beyan etmesiyle bypass edilemez.
    const viewAsRole = req.query.viewAsRole;
    const effectiveRole = admin && (viewAsRole === "User" || viewAsRole === "Admin") ? viewAsRole : role;
    const username = getRequestUser(req)?.username;
    try {
      const allTables = await fetchTableList();
      const tables = await filterTablesByRole(allTables, effectiveRole, username);
      const usingFallback = !isAvailable();
      if (admin) {
        const visibleConfig = await readVisibleTables();
        const userVisible = visibleConfig["User"] || [];
        const tablesMeta = tables.map((t) => ({
          name: t,
          blocklisted: false,
          visibleToUser: userVisible === "*" || (Array.isArray(userVisible) && userVisible.includes(t)),
        }));
        return res.json({ ok: true, tables, tablesMeta, cached: !!_tableCache, fallback: usingFallback, effectiveRole });
      }
      res.json({ ok: true, tables, cached: !!_tableCache, fallback: usingFallback });
    } catch {
      const fallback = await filterTablesByRole(FALLBACK_TABLES, effectiveRole, username);
      res.json({ ok: true, tables: fallback, fallback: true });
    }
  });

  // ── Visible tables config (admin CRUD) ───────────────────────────────────────
  router.get("/visible-tables", async (req, res) => {
    res.json({ ok: true, config: await readVisibleTables() });
  });

  router.put("/visible-tables", async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ ok: false, error: "Admin yetkisi gerekli." });
    const { role, tables } = req.body || {};
    if (!role || !["User", "Admin"].includes(role)) {
      return res.status(400).json({ ok: false, error: "role: 'User' veya 'Admin' olmalı." });
    }
    const config = await readVisibleTables();
    const resolved = tables === "*" ? "*" : Array.isArray(tables) ? tables : config[role];
    await writeVisibleTablesForRole(role, resolved);
    config[role] = resolved;
    res.json({ ok: true, config });
  });

  // ── Tablo gorunurlugu admin ekrani (actions.md #12) ──────────────────────────
  // Her tablonun tam satiri (aktif/pasif, sira, aciklama) + o tabloya bagli rol/kullanici
  // override sayilari — sentinel ('*') satiri listeye dahil edilmez (gercek bir tablo degil).
  router.get("/table-visibility", async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ ok: false, error: "Admin yetkisi gerekli." });
    try {
      const { recordset } = await query(
        `SELECT tv.*,
                (SELECT COUNT(*) FROM inventory_table_user_override o WHERE o.table_visibility_id = tv.id) AS override_count
           FROM inventory_table_visibility tv
          WHERE tv.table_name <> '*'
          ORDER BY tv.sort_order, tv.table_name`
      );
      res.json({
        ok: true,
        tables: recordset.map((r) => ({
          id: r.id, schemaName: r.schema_name, tableName: r.table_name,
          displayName: r.display_name, isActive: r.is_active === true || r.is_active === 1,
          sortOrder: r.sort_order, description: r.description, overrideCount: r.override_count,
        })),
      });
    } catch (err) {
      res.status(503).json({ ok: false, error: err.message });
    }
  });

  router.put("/table-visibility/:id", async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ ok: false, error: "Admin yetkisi gerekli." });
    const id = Number(req.params.id);
    const { isActive, displayName, description, sortOrder } = req.body || {};
    try {
      await query(
        `UPDATE inventory_table_visibility
            SET is_active = @a, display_name = @d, description = @desc, sort_order = @s, updated_at = GETUTCDATE()
          WHERE id = @id`,
        [
          { name: "a", type: sql.Bit, value: isActive !== false },
          { name: "d", type: sql.NVarChar(255), value: displayName || null },
          { name: "desc", type: sql.NVarChar(500), value: description || null },
          { name: "s", type: sql.Int, value: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0 },
          { name: "id", type: sql.Int, value: id },
        ]
      );
      // Envanter sayfasindaki sekme basliklari bu "Gorunen Ad"i DEGIL,
      // inventory_table_aliases'i okur (bkz. EnvanterPage.tsx / Admin > Sistem > Tablo
      // Takma Adlari) — buradaki alan onceden BURADA kaydedilip hicbir yerde
      // gosterilmiyordu ("islem yaptigimda bir ise yaramadi"). Iki ekranin ayni sonucu
      // vermesi icin buradaki degisiklik de aynen alias tablosuna yazilir.
      const tvRow = await query(`SELECT table_name FROM inventory_table_visibility WHERE id = @id`, [{ name: "id", type: sql.Int, value: id }]);
      const tableName = tvRow.recordset[0]?.table_name;
      if (tableName && tableName !== "*") {
        if (displayName && String(displayName).trim()) {
          await setAlias(tableName, String(displayName).trim(), { description });
        } else {
          await removeAlias(tableName);
        }
      }
      _visibleTablesCache = null;
      _inactiveCache = null;
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Kullanici-bazli tablo override (actions.md #12) ──────────────────────────
  router.get("/table-visibility/:id/user-overrides", async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ ok: false, error: "Admin yetkisi gerekli." });
    try {
      const { recordset } = await query(
        `SELECT username, override_type, created_by, created_at FROM inventory_table_user_override WHERE table_visibility_id = @id ORDER BY username`,
        [{ name: "id", type: sql.Int, value: Number(req.params.id) }]
      );
      res.json({ ok: true, overrides: recordset });
    } catch (err) {
      res.status(503).json({ ok: false, error: err.message });
    }
  });

  router.post("/table-visibility/:id/user-overrides", async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ ok: false, error: "Admin yetkisi gerekli." });
    const id = Number(req.params.id);
    const { username, overrideType } = req.body || {};
    if (!username || !["allow", "deny"].includes(overrideType)) {
      return res.status(400).json({ ok: false, error: "username ve overrideType ('allow'|'deny') gerekli." });
    }
    const uname = String(username).trim().toLowerCase();
    const createdBy = getRequestUser(req)?.username || null;
    try {
      const upd = await query(
        `UPDATE inventory_table_user_override SET override_type = @t WHERE table_visibility_id = @id AND username = @u`,
        [{ name: "t", type: sql.NVarChar(10), value: overrideType }, { name: "id", type: sql.Int, value: id }, { name: "u", type: sql.NVarChar(255), value: uname }]
      );
      if (!upd.rowsAffected?.[0]) {
        await query(
          `INSERT INTO inventory_table_user_override (table_visibility_id, username, override_type, created_by) VALUES (@id, @u, @t, @c)`,
          [{ name: "id", type: sql.Int, value: id }, { name: "u", type: sql.NVarChar(255), value: uname },
           { name: "t", type: sql.NVarChar(10), value: overrideType }, { name: "c", type: sql.NVarChar(255), value: createdBy }]
        );
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.delete("/table-visibility/:id/user-overrides/:username", async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ ok: false, error: "Admin yetkisi gerekli." });
    try {
      await query(
        `DELETE FROM inventory_table_user_override WHERE table_visibility_id = @id AND username = @u`,
        [{ name: "id", type: sql.Int, value: Number(req.params.id) }, { name: "u", type: sql.NVarChar(255), value: req.params.username.toLowerCase() }]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Kolon-seviyesi gorunurluk (actions.md #12 — tamamen yeni) ────────────────
  // role_name='ALL' — su an tum roller icin tek bir kural seti yonetiliyor (per-rol
  // kolon-gorunurlugu gelecekte bu tabloya role_name ekleyerek genisletilebilir).
  router.get("/table-visibility/:id/columns", async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ ok: false, error: "Admin yetkisi gerekli." });
    const id = Number(req.params.id);
    try {
      const tv = await query(`SELECT table_name FROM inventory_table_visibility WHERE id = @id`, [{ name: "id", type: sql.Int, value: id }]);
      const tableName = tv.recordset[0]?.table_name;
      if (!tableName) return res.status(404).json({ ok: false, error: "Tablo bulunamadı." });

      const liveCols = await getColumns(tableName);
      const { recordset } = await query(
        `SELECT column_name, is_visible FROM inventory_column_visibility WHERE table_visibility_id = @id AND role_name = 'ALL'`,
        [{ name: "id", type: sql.Int, value: id }]
      );
      const hiddenSet = new Set(recordset.filter((r) => r.is_visible === false || r.is_visible === 0).map((r) => r.column_name));
      res.json({ ok: true, columns: liveCols.map((c) => ({ name: c, isVisible: !hiddenSet.has(c) })) });
    } catch (err) {
      res.status(503).json({ ok: false, error: err.message });
    }
  });

  router.put("/table-visibility/:id/columns/:columnName", async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ ok: false, error: "Admin yetkisi gerekli." });
    const id = Number(req.params.id);
    const columnName = req.params.columnName;
    const isVisible = req.body?.isVisible !== false;
    try {
      const upd = await query(
        `UPDATE inventory_column_visibility SET is_visible = @v, updated_at = GETUTCDATE() WHERE table_visibility_id = @id AND column_name = @c AND role_name = 'ALL'`,
        [{ name: "v", type: sql.Bit, value: isVisible }, { name: "id", type: sql.Int, value: id }, { name: "c", type: sql.NVarChar(255), value: columnName }]
      );
      if (!upd.rowsAffected?.[0]) {
        await query(
          `INSERT INTO inventory_column_visibility (table_visibility_id, column_name, is_visible, role_name) VALUES (@id, @c, @v, 'ALL')`,
          [{ name: "id", type: sql.Int, value: id }, { name: "c", type: sql.NVarChar(255), value: columnName }, { name: "v", type: sql.Bit, value: isVisible }]
        );
      }
      _hiddenColumnsCache.delete(id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Discover tables — admin only, always live ────────────────────────────────
  router.get("/tables/discover", async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ ok: false, error: "Admin yetkisi gerekli." });
    }
    try {
      const result = await query(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
        []
      );
      const tables = result.recordset
        .map((r) => r.TABLE_NAME)
        .filter((t) => !BLOCKED_TABLES.includes(t));
      // Refresh shared cache
      _tableCache = tables;
      _tableCacheAt = Date.now();
      res.json({ ok: true, tables });
    } catch (err) {
      res.status(503).json({ ok: false, error: err.message });
    }
  });

  // ── Distinct values for a column (used by multi-select filter dropdown) ─────
  router.get("/distinct/:table/:col", async (req, res) => {
    const { table, col } = req.params;
    if (!(await isAllowedTable(table))) {
      return res.status(403).json({ ok: false, error: "İzin verilmeyen tablo." });
    }
    const allCols = await getColumns(table);
    if (!allCols.includes(col)) {
      return res.status(400).json({ ok: false, error: "Geçersiz kolon adı." });
    }
    const search = String(req.query.search || "").trim();
    const limitVal = Math.min(300, Math.max(1, parseInt(req.query.limit || "200", 10)));
    try {
      const pool = await getPool();
      if (!pool) return res.status(503).json({ ok: false, error: "Veritabanı bağlantısı yok." });
      const req2 = pool.request();
      req2.input("limitVal", sql.Int, limitVal);
      let whereClause = "";
      if (search) {
        req2.input("search", sql.NVarChar(256), `%${search}%`);
        whereClause = `WHERE CAST(${quoteIdent(col)} AS NVARCHAR(MAX)) LIKE @search`;
      }
      const result = await req2.query(
        `SELECT TOP (@limitVal) CAST(${quoteIdent(col)} AS NVARCHAR(MAX)) AS val, COUNT(*) AS cnt
         FROM ${quoteIdent(table)}
         ${whereClause}
         GROUP BY CAST(${quoteIdent(col)} AS NVARCHAR(MAX))
         ORDER BY cnt DESC`
      );
      const values = result.recordset
        .map((r) => ({ value: r.val ?? "", count: r.cnt }))
        .filter((r) => r.value !== "");
      res.json({ ok: true, values });
    } catch (err) {
      res.status(503).json({ ok: false, error: err.message });
    }
  });

  // ── Columns ─────────────────────────────────────────────────────────────────
  router.get("/columns/:table", async (req, res) => {
    const table = req.params.table;
    if (!(await isAllowedTable(table))) {
      return res.status(403).json({ ok: false, error: "İzin verilmeyen tablo." });
    }
    try {
      const result = await query(
        `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_NAME = @table
         ORDER BY ORDINAL_POSITION`,
        [{ name: "table", type: sql.VarChar(128), value: table }]
      );
      // E-03: Normalize column keys for frontend compatibility
      let normalized = result.recordset.map((r) => ({
        columnName:            r.COLUMN_NAME,
        dataType:              r.DATA_TYPE,
        isNullable:            r.IS_NULLABLE,
        characterMaximumLength: r.CHARACTER_MAXIMUM_LENGTH,
        // Keep uppercase originals for backward compat
        COLUMN_NAME:           r.COLUMN_NAME,
        DATA_TYPE:             r.DATA_TYPE,
      }));
      const cols = result.recordset.map((r) => r.COLUMN_NAME);
      const colTypes = new Map(result.recordset.map((r) => [r.COLUMN_NAME, r.DATA_TYPE]));
      colCacheSet(table, cols, colTypes);

      // actions.md #12 — kolon-seviyesi gorunurluk; Admin yonetim ekrani icin BYPASS eder.
      if (!isAdmin(req)) {
        const hidden = await getHiddenColumnsForTable(table);
        if (hidden.size) normalized = normalized.filter((c) => !hidden.has(c.columnName));
      }
      res.json({ ok: true, columns: normalized });
    } catch (err) {
      res.status(503).json({ ok: false, error: err.message });
    }
  });

  // ── Table aliases ────────────────────────────────────────────────────────────
  router.get("/table-aliases", async (req, res) => {
    res.json({ ok: true, aliases: await readAliases() });
  });

  // Admin ekrani icin TAM satirlar (schema/description/is_active/language/sort_order) — actions.md #13.
  router.get("/table-aliases/detail", async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ ok: false, error: "Admin yetkisi gerekli." });
    res.json({ ok: true, aliases: await readAliasesDetailed() });
  });

  router.put("/table-aliases", async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ ok: false, error: "Admin yetkisi gerekli." });
    const { tableName, alias, schemaName, description, isActive, language, sortOrder } = req.body || {};
    if (!tableName) return res.status(400).json({ ok: false, error: "tableName gerekli." });
    if (alias && String(alias).trim()) {
      await setAlias(tableName, String(alias).trim(), { schemaName, description, isActive, language, sortOrder });
    } else {
      await removeAlias(tableName);
    }
    res.json({ ok: true, aliases: await readAliases(), detail: await readAliasesDetailed() });
  });

  // ── Data (pagination + search + advanced filterGroup + sorting) ──────────────
  router.get("/data/:table", async (req, res) => {
    const table = req.params.table;
    if (!(await isAllowedTable(table))) {
      return res.status(403).json({ ok: false, error: "İzin verilmeyen tablo." });
    }
    // Rol-bazli ACL (inventory_visible_tables): eskiden yalniz /tables LISTELEMESI bunu
    // uyguluyordu; /data/:table dogrudan okuma BLOCKED_TABLES disinda kalan ama role
    // kapali birakilmis bir tabloyu koruyordu — kesif bulgusu (ai_review_3 planinda "ek
    // gozlem"). filterTablesByRole artik cache'li oldugu icin (bkz. readVisibleTables)
    // bu kontrolun maliyeti dusuk.
    const requesterRole = getRequestRole(req) || "User";
    const visibleForRole = await filterTablesByRole([table], requesterRole, getRequestUser(req)?.username);
    if (visibleForRole.length === 0) {
      return res.status(403).json({ ok: false, error: "Bu tabloya erişim izniniz yok." });
    }

    // I-02: countOnly=true → return just the row count (fast KPI fetch, avoids 92KB payload)
    if (req.query.countOnly === "true") {
      try {
        const pool = await getPool();
        if (!pool) return res.json({ ok: true, table, total: null, fallback: true });
        const result = await pool.request().query(`SELECT COUNT(*) AS total FROM ${quoteIdent(table)}`);
        return res.json({ ok: true, table, total: result.recordset[0].total });
      } catch (err) {
        return res.status(503).json({ ok: false, error: err.message });
      }
    }

    const admin = isAdmin(req);
    const maxLimit = admin ? 10000 : 1000;
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(maxLimit, Math.max(1, parseInt(req.query.limit || "200", 10)));
    const offset = (page - 1) * limit;
    const search = String(req.query.search || "").trim();

    // Sorting
    const orderByRaw = String(req.query.orderBy || "").trim();
    const orderDirRaw = String(req.query.orderDir || "").trim().toUpperCase();
    const orderDir = orderDirRaw === "DESC" ? "DESC" : "ASC";

    // Advanced filterGroup (JSON encoded in query param)
    let filterGroup = null;
    if (req.query.filterGroup) {
      try { filterGroup = JSON.parse(String(req.query.filterGroup)); } catch {}
    }

    // Multi-select column filters: { colName: ["val1","val2"] }
    let multiFilters = {};
    if (req.query.multiFilters) {
      try { multiFilters = JSON.parse(String(req.query.multiFilters)); } catch {}
    }

    // Legacy per-column filters: ?filters[colName]=value (still supported)
    const colFilters = {};
    if (req.query.filters && typeof req.query.filters === "object") {
      for (const [col, val] of Object.entries(req.query.filters)) {
        if (val) colFilters[col] = String(val);
      }
    }

    try {
      const allCols = await getColumns(table);
      // search yalniz metin-tipi kolonlara uygulanir + minimum 3 karakter zorunlu —
      // kucuk aramalar (1-2 karakter) her satirda TUM kolonlarda CAST+LIKE tetikleyip
      // indexsiz full-scan yaratiyordu (kurumsal AI kod incelemesi, review.md #5).
      const searchCols = search.length >= 3 ? await getSearchableColumns(table) : [];

      const orderBy = orderByRaw && allCols.includes(orderByRaw) ? orderByRaw : null;
      const orderClause = orderBy
        ? `ORDER BY ${quoteIdent(orderBy)} ${orderDir}`
        : `ORDER BY (SELECT NULL)`;

      const pool = await getPool();
      if (!pool) return res.status(503).json({ ok: false, error: "Veritabanı bağlantısı yok." });

      const buildWhere = (req2) => {
        const parts = [];
        if (search.length >= 3 && searchCols.length > 0) {
          req2.input("search", sql.NVarChar(256), `%${search}%`);
          parts.push(
            `(${searchCols.map((c) => `CAST(${quoteIdent(c)} AS NVARCHAR(MAX)) LIKE @search`).join(" OR ")})`
          );
        }
        // Legacy simple filters
        let idx = 0;
        for (const [col, val] of Object.entries(colFilters)) {
          if (!allCols.includes(col)) continue;
          const p = `filter${idx++}`;
          req2.input(p, sql.NVarChar(256), `%${val}%`);
          parts.push(`CAST(${quoteIdent(col)} AS NVARCHAR(MAX)) LIKE @${p}`);
        }
        // Multi-select column filters: col IN (v1, v2, ...)
        let mfIdx = 0;
        for (const [col, vals] of Object.entries(multiFilters)) {
          if (!allCols.includes(col) || !Array.isArray(vals) || vals.length === 0) continue;
          const params = vals.map((v) => {
            const p = `mf${mfIdx++}`;
            req2.input(p, sql.NVarChar(512), String(v));
            return `@${p}`;
          });
          parts.push(`CAST(${quoteIdent(col)} AS NVARCHAR(MAX)) IN (${params.join(",")})`);
        }
        // Advanced filterGroup — buildAdvancedWhereClause artik onek-siz kosul metni doner
        // (bkz. yukarida fonksiyon tanimi); WHERE eklemek burada, tek yerde yapilir.
        if (filterGroup && Array.isArray(filterGroup.filters) && filterGroup.filters.length > 0) {
          const advancedWhere = buildAdvancedWhereClause(filterGroup, allCols, req2);
          if (advancedWhere) parts.push(`(${advancedWhere})`);
        }
        return parts.length ? `WHERE ${parts.join(" AND ")}` : "";
      };

      // COUNT + veri TEK sorguda: COUNT(*) OVER() WHERE'e uyan TUM satir sayisini,
      // OFFSET/FETCH'ten BAGIMSIZ olarak dondurur (T-SQL mantiksal sorgu sirasinda
      // pencere fonksiyonlari OFFSET/FETCH'ten ONCE hesaplanir) — onceden countReq/dataReq
      // icin AYRI iki sorgu (iki full-scan) calisiyordu (kurumsal AI kod incelemesi,
      // review.md #2). Istisna: OFFSET, eslesen tum satirlari asarsa (var-olmayan bir
      // sayfa istenirse) FETCH NEXT sifir satir doner ve __total okunacak satir kalmaz —
      // bu nadir durumda dogru toplami almak icin ayri, ucuz bir COUNT sorgusuna dusulur.
      const dataReq = pool.request();
      const whereClause = buildWhere(dataReq);
      dataReq.input("limit", sql.Int, limit);
      dataReq.input("offset", sql.Int, offset);
      const combined = await dataReq.query(
        `SELECT COUNT(*) OVER() AS __total, * FROM ${quoteIdent(table)} ${whereClause} ${orderClause} OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`
      );

      let total;
      let rows;
      if (combined.recordset.length > 0) {
        total = combined.recordset[0].__total;
        rows = combined.recordset.map(({ __total, ...rest }) => rest);
      } else {
        const countReq = pool.request();
        const countWhere = buildWhere(countReq);
        const countResult = await countReq.query(`SELECT COUNT(*) AS total FROM ${quoteIdent(table)} ${countWhere}`);
        total = countResult.recordset[0]?.total ?? 0;
        rows = [];
      }

      // actions.md #12 — kolon-seviyesi gorunurluk; Admin BYPASS eder. Hem donen kolon
      // listesinden HEM her satirdan hedeflenen alanlar cikarilir (yalniz UI'da gizleme
      // degil, gercek veri sizintisini de onler).
      let responseCols = allCols;
      let responseRows = rows;
      if (!admin) {
        const hidden = await getHiddenColumnsForTable(table);
        if (hidden.size) {
          responseCols = allCols.filter((c) => !hidden.has(c));
          responseRows = rows.map((row) => {
            const out = {};
            for (const c of responseCols) out[c] = row[c];
            return out;
          });
        }
      }

      res.json({
        ok: true,
        table,
        columns: responseCols,
        rows: responseRows,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } catch (err) {
      res.status(503).json({ ok: false, error: err.message });
    }
  });

  // ── Custom query (SELECT-only, limit-capped, Admin-only) ─────────────────────
  // Onceden herhangi bir oturum-acmis kullanici (User rolu dahil) ham SQL calistirabiliyordu;
  // sadece SORGU KAYDETME Admin-only'idi. isSelectOnly + tablo-whitelist'i (asagida) atlatmanin
  // teorik bir yolu bulunursa bile bu, saldiri yuzeyini onemli olcude daraltir (kurumsal AI
  // kod incelemesi, review.md #3).
  router.post("/query", async (req, res) => {
    const startedAt = Date.now();
    const username = (getRequestUser(req) && getRequestUser(req).username) || "system";
    // actions.md #20 — TAM audit: genel auditMutations middleware'i (dosya basi) yalniz
    // 2xx yanitlarda ve yalniz URL+redakte-body yakalar; sorgu suresi/satir-sayisi/basarili-
    // basarisiz/hata-mesaji/kullanilan-tablolari YAKALAMAZ. Bu route kendi ozel audit girisini
    // (hem basarili hem basarisiz durumlarda) auditQuery() ile ayrica atar.
    function auditQuery(sqlText, extra) {
      try {
        require("../audit/index.cjs").auditPortal(req, "inventory_custom_query", {
          username,
          result: extra.ok ? "ok" : "failed",
          detail: JSON.stringify({
            sqlText: String(sqlText || "").slice(0, 2000),
            durationMs: Date.now() - startedAt,
            ...extra,
          }),
        });
      } catch { /* audit modulu yoksa yoksay */ }
    }

    const admin = isAdmin(req);
    if (!admin) {
      auditQuery(req.body?.sqlText, { ok: false, error: "Admin yetkisi gerekli.", httpStatus: 403 });
      return res.status(403).json({ ok: false, error: "Ham SQL çalıştırmak için Admin yetkisi gerekli." });
    }
    const { sqlText, save, queryName, description, limit: limitParam } = req.body || {};

    if (!sqlText) return res.status(400).json({ ok: false, error: "sqlText gerekli." });
    if (!isSelectOnly(sqlText)) {
      auditQuery(sqlText, { ok: false, error: "Sadece SELECT sorguları çalıştırılabilir.", httpStatus: 403 });
      return res
        .status(403)
        .json({ ok: false, error: "Sadece SELECT sorguları çalıştırılabilir." });
    }
    // /data/:table, /columns/:table gibi diger route'larla ayni tablo whitelist'i:
    // referans edilen tum tablolar BLOCKED_TABLES/mevcut-tablo listesinden gecmeli
    // (kurumsal AI kod incelemesi, review.md #3 — onceden bu route whitelist'i atliyordu).
    const referencedTables = extractReferencedTables(sqlText);
    const allowedFlags = await Promise.all(referencedTables.map((t) => isAllowedTable(t)));
    const blockedTable = referencedTables.find((_, i) => !allowedFlags[i]);
    if (blockedTable) {
      auditQuery(sqlText, { ok: false, error: `'${blockedTable}' tablosuna erisim izni yok.`, httpStatus: 403, referencedTables });
      return res
        .status(403)
        .json({ ok: false, error: `'${blockedTable}' tablosuna erisim izni yok.` });
    }

    const limit = Math.min(10000, Math.max(1, parseInt(limitParam || "200", 10)));

    try {
      // actions.md #20.1 — AYRI salt-okunur havuz tercih edilir; tanimli degilse (DBA henuz
      // GRANT SELECT-only kullanicisini olusturmadiysa) PAYLASILAN havuza duser — davranis
      // KIRILMAZ, sadece bir kez guvenlik onerisi loglanir.
      const readOnlyDb = require("./mssql-readonly.cjs");
      let pool = await readOnlyDb.getReadOnlyPool();
      let usedPool = "readonly";
      if (!pool) {
        if (readOnlyDb.isConfigured()) {
          console.warn("[Inventory] Salt-okunur MSSQL havuzuna ulasilamadi, paylasilan havuza dusuluyor.");
        } else if (!_warnedSharedPoolFallback) {
          console.warn("[Inventory] Custom SQL salt-okunur kimlik bilgisi tanimli degil (MSSQL_RO_USER/MSSQL_RO_PASSWORD), paylasilan havuz kullaniliyor — GUVENLIK ONERISI: ayri, GRANT SELECT-only bir DB kullanicisi tanimlayin.");
          _warnedSharedPoolFallback = true;
        }
        pool = await getPool();
        usedPool = "shared";
      }
      if (!pool) {
        auditQuery(sqlText, { ok: false, error: "Veritabanı bağlantısı yok.", httpStatus: 503, referencedTables });
        return res.status(503).json({ ok: false, error: "Veritabanı bağlantısı yok." });
      }

      const req2 = pool.request();
      req2.input("limit", sql.Int, limit);
      const wrapped = `SELECT TOP (@limit) * FROM (${sqlText}) AS __q`;
      const result = await req2.query(wrapped);
      const columns = result.recordset.length > 0 ? Object.keys(result.recordset[0]) : [];

      if (save && queryName) {
        // Route zaten Admin-only (yukarida) — ayrica kontrole gerek yok.
        const queries = readSavedQueries();
        const existing = queries.findIndex((q) => q.name === queryName);
        const entry = {
          name: queryName,
          sql: sqlText,
          isPublished: false,
          isDefault: false,
          publishedBy: username,
          savedAt: new Date().toISOString(),
          description: description || "",
        };
        if (existing >= 0) {
          // Preserve publish/default state on re-save
          entry.isPublished = queries[existing].isPublished || false;
          entry.isDefault = queries[existing].isDefault || false;
          queries[existing] = entry;
        } else {
          queries.push(entry);
        }
        try { await writeSavedQueries(queries); } catch (e) {
          auditQuery(sqlText, { ok: false, error: `Sorgu kaydedilemedi: ${e.message}`, httpStatus: 500, referencedTables });
          return res.status(500).json({ ok: false, error: `Sorgu kaydedilemedi: ${e.message}` });
        }
      }

      auditQuery(sqlText, { ok: true, rowCount: result.recordset.length, referencedTables, usedPool });
      res.json({ ok: true, columns, rows: result.recordset, rowCount: result.recordset.length });
    } catch (err) {
      auditQuery(sqlText, { ok: false, error: err.message, httpStatus: 503, referencedTables });
      res.status(503).json({ ok: false, error: err.message });
    }
  });

  // ── Saved queries — list ─────────────────────────────────────────────────────
  // Users see only published; admins see all
  router.get("/saved-queries", (req, res) => {
    const admin = isAdmin(req);
    const all = readSavedQueries();
    const visible = admin ? all : all.filter((q) => q.isPublished);
    res.json({ ok: true, queries: visible });
  });

  // ── Saved queries — publish / unpublish (toggle) — admin only ────────────────
  router.post("/saved-queries/:name/publish", async (req, res) => {
    if (!isAdmin(req))
      return res.status(403).json({ ok: false, error: "Admin yetkisi gerekli." });
    const name = decodeURIComponent(req.params.name);
    const queries = readSavedQueries();
    const idx = queries.findIndex((q) => q.name === name);
    if (idx < 0) return res.status(404).json({ ok: false, error: "Sorgu bulunamadı." });
    const username = (getRequestUser(req) && getRequestUser(req).username) || "";
    queries[idx].isPublished = !queries[idx].isPublished;
    if (queries[idx].isPublished) queries[idx].publishedBy = username;
    try { await writeSavedQueries(queries); } catch (e) {
      return res.status(500).json({ ok: false, error: `Kaydedilemedi: ${e.message}` });
    }
    res.json({ ok: true, query: queries[idx] });
  });

  // ── Saved queries — set default — admin only ─────────────────────────────────
  router.post("/saved-queries/:name/set-default", async (req, res) => {
    if (!isAdmin(req))
      return res.status(403).json({ ok: false, error: "Admin yetkisi gerekli." });
    const name = decodeURIComponent(req.params.name);
    const queries = readSavedQueries();
    const idx = queries.findIndex((q) => q.name === name);
    if (idx < 0) return res.status(404).json({ ok: false, error: "Sorgu bulunamadı." });
    // Unset isDefault on all others, then set the target
    for (const q of queries) q.isDefault = false;
    queries[idx].isDefault = true;
    try { await writeSavedQueries(queries); } catch (e) {
      return res.status(500).json({ ok: false, error: `Kaydedilemedi: ${e.message}` });
    }
    res.json({ ok: true, query: queries[idx] });
  });

  // ── Saved queries — delete — admin only ──────────────────────────────────────
  router.delete("/saved-queries/:name", async (req, res) => {
    if (!isAdmin(req))
      return res.status(403).json({ ok: false, error: "Admin yetkisi gerekli." });
    const name = decodeURIComponent(req.params.name);
    const queries = readSavedQueries().filter((q) => q.name !== name);
    try { await writeSavedQueries(queries); } catch (e) {
      return res.status(500).json({ ok: false, error: `Silinemedi: ${e.message}` });
    }
    res.json({ ok: true, queries });
  });

  app.use("/api/inventory", router);
  console.log("[Inventory] module mounted at /api/inventory");
}

// AI Analist portal-tools.cjs icin: uygulama envanteri tablosundan (env, host, app)
// ham satirlari doner. Tablo adi env'den okunur — bkz. server/config/apps-table.cjs.
// Eskiden ai-analyst/portal-tools.cjs bu tabloyu inventory katmanini atlayip dogrudan
// mssql.cjs'in pool'una `pool.request().query(...)` ile erisiyordu — katman ihlali
// (kurumsal AI kod incelemesi, review.md #16). AI araclari artik yalnizca bu fonksiyonu cagirir.
async function getHostsForAiTools() {
  const result = await query(`SELECT env, host, app FROM ${require('../config/apps-table.cjs').getAppsTable()}`);
  return result.recordset || [];
}

module.exports = {
  initInventory, getTeamOwnership, getHostsForAiTools,
  // test-only: /query'nin SQL-injection sertlestirmesini, kayitli-sorgu upsert desenini ve
  // WHERE-builder arayuzunu (ai_review_3 fazi) DB gerektirmeden dogrulamak icin acildi.
  _isSelectOnly: isSelectOnly, _extractReferencedTables: extractReferencedTables,
  _writeSavedQueries: writeSavedQueries, _buildAdvancedWhereClause: buildAdvancedWhereClause,
  _setSqCache: (v) => { _sqCache = v; }, _getSqCache: () => _sqCache,
  // test-only: Bolum K (kullanici tablo gorunurlugu) yeni sema adaptorunu DB gerektirmeden
  // dogrulamak icin acildi (bkz. __tests__/visible-tables.test.cjs).
  _readVisibleTables: readVisibleTables, _writeVisibleTablesForRole: writeVisibleTablesForRole,
  _filterTablesByRole: filterTablesByRole, _reconcileTableVisibility: reconcileTableVisibility,
  _migrateLegacyVisibleTablesIfNeeded: migrateLegacyVisibleTablesIfNeeded,
  _getUserOverridesForUser: getUserOverridesForUser,
  _resetVisibleTablesTestState: () => {
    _visibleTablesCache = null; _visibleTablesCacheAt = 0; _reconciledAt = 0; _legacyMigrated = false;
    _inactiveCache = null; _inactiveCacheAt = 0;
  },
};
