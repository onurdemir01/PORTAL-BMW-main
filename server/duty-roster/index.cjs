// server/duty-roster/index.cjs — Nobet cizelgesi (DB-tabanli).
// Eskiden server/index.cjs icinde inline JSON-dosya deposuydu (server/data/duty-roster.json
// + 'duty-roster' config blob'u); artik duty_roster tablosunda tutulur. Merge anahtari
// (duty_date, lower(email)) — eski stableKey `date::lower(email)` semantigiyle birebir ayni.
const express = require("express");
const fs = require("fs");
const path = require("path");
const db = require("../db/index.cjs");

const LEGACY_FILE = path.join(__dirname, "..", "data", "duty-roster.json");

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeItem(x) {
  return {
    id: x.id || uid(),
    date: String(x.date || "").slice(0, 10),
    firstName: String(x.firstName || "").trim(),
    lastName: String(x.lastName || "").trim(),
    phone: String(x.phone || "").trim(),
    email: String(x.email || "").trim(),
  };
}

function validateItem(x) {
  const e = [];
  if (!x.date || !/^\d{4}-\d{2}-\d{2}$/.test(x.date)) e.push("date invalid");
  if (!x.firstName) e.push("firstName required");
  if (!x.lastName) e.push("lastName required");
  if (!x.phone) e.push("phone required");
  if (!x.email) e.push("email required");
  if (x.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.email)) e.push("email invalid");
  return e;
}

function rowToItem(r) {
  // mssql surucusu DATE'i Date nesnesi dondurur → YYYY-MM-DD'ye normalle.
  const d = r.duty_date instanceof Date
    ? r.duty_date.toISOString().slice(0, 10)
    : String(r.duty_date || "").slice(0, 10);
  return {
    id: r.id,
    date: d,
    firstName: r.first_name || "",
    lastName: r.last_name || "",
    phone: r.phone || "",
    email: r.email || "",
    dutyGroup: r.duty_group || null,
    team: r.team || null,
    service: r.service || null,
    isActive: r.is_active !== false && r.is_active !== 0,
    dataSource: r.data_source || 'manual',
  };
}

// ── Bellek cache + yukleme ───────────────────────────────────────────────────
let _items = null; // null → DB henuz yuklenmedi (fallback: eski dosya/bos)

function readFallback() {
  try {
    if (fs.existsSync(LEGACY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(LEGACY_FILE, "utf-8"));
      if (Array.isArray(parsed)) return parsed.map(normalizeItem);
    }
  } catch { /* dosya bozuksa bos liste */ }
  return [];
}

function readDutyRoster() {
  return _items ? _items.slice() : readFallback();
}

async function reloadCache() {
  const { rows } = await db.query(`SELECT * FROM duty_roster ORDER BY duty_date, email`);
  _items = rows.map(rowToItem);
}

// (duty_date, lower(email)) uzerinden upsert — ayni gun+email varsa yenisi kazanir.
// UPDATE-once → 0 satir etkilenirse INSERT deseni (bkz. server/auth/users.cjs recordLogin/
// setPref ile ayni desen — kurumsal AI kod incelemesi Finding 22). Eskiden her cagri DELETE+
// INSERT (2 sorgu) yapiyordu; toplu import (/api/duty-roster/import, en fazla 2MB JSON) N
// kayit icin N×2 sirali sorguya cikiyordu. Yaygin durumda (kayit zaten var — tekrar import/
// guncelleme) artik TEK sorgu yeterli; yalniz gercekten yeni kayitlar 2 sorgu gerektirir
// (UPDATE 0 satir + INSERT). Ayrica mevcut satirin id/created_at'ini korur (DELETE+INSERT
// eskiden bunlari implicit olarak sifirliyordu).
async function upsertItem(item) {
  const upd = await db.query(
    `UPDATE duty_roster SET first_name = $1, last_name = $2, phone = $3, updated_at = GETUTCDATE()
     WHERE duty_date = $4 AND LOWER(email) = LOWER($5)`,
    [item.firstName, item.lastName, item.phone, item.date, item.email]
  );
  if (!upd.rowCount) {
    await db.query(
      `INSERT INTO duty_roster (id, duty_date, first_name, last_name, phone, email)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [item.id, item.date, item.firstName, item.lastName, item.phone, item.email]
    );
  }
}

// Tek seferlik goc: tablo bossa eski JSON dosyasi > 'duty-roster' blob'u sirasiyla.
async function importLegacyIfEmpty() {
  const { rows } = await db.query(`SELECT COUNT(*) AS n FROM duty_roster`);
  if (Number(rows[0]?.n || 0) > 0) return;

  let source = null;
  try {
    if (fs.existsSync(LEGACY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(LEGACY_FILE, "utf-8"));
      if (Array.isArray(parsed) && parsed.length) source = parsed;
    }
  } catch { /* dosya bozuk → blob dene */ }
  if (!source) {
    try {
      const blob = await db.query(`SELECT data FROM portal_config_blobs WHERE name = $1`, ["duty-roster"]);
      if (blob.rows.length) {
        const parsed = JSON.parse(blob.rows[0].data);
        if (Array.isArray(parsed) && parsed.length) source = parsed;
      }
    } catch { /* blob yok */ }
  }
  if (!source) return;

  let count = 0;
  for (const raw of source) {
    const item = normalizeItem(raw);
    if (validateItem(item).length) continue;
    try { await upsertItem(item); count++; } catch (e) {
      console.warn(`[DutyRoster] import satiri eklenemedi (${item.date}):`, e.message);
    }
  }
  console.log(`[DB] migrated duty-roster (${count} satir)`);
}

async function loadDutyRosterStore() {
  try {
    await importLegacyIfEmpty();
    await reloadCache();
    console.log(`[DutyRoster] ${_items.length} kayit DB'den yuklendi.`);
  } catch (e) {
    console.warn("[DutyRoster] DB yuklenemedi, dosya fallback aktif:", e.message);
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────
function initDutyRoster(app) {
  loadDutyRosterStore().catch((e) => console.warn("[DutyRoster] store yukleme hata:", e.message));

  // Nobet sayfasi gizliyse gercek 403. Dashboard nobetci widget'i /api/nobetci/*
  // kullanir ve MUAF kalir (tum kullanicilara acik).
  try {
    const { requireVisiblePrefix } = require("../auth/visibility.cjs");
    app.use("/api/duty-roster", requireVisiblePrefix("Nöbet"));
  } catch { /* motor yoksa yoksay */ }
  // Tum mutasyonlar portal_audit_logs'a yazilir.
  try { app.use("/api/duty-roster", require("../audit/index.cjs").auditMutations("duty_roster")); } catch { /* yoksay */ }

  app.get("/api/duty-roster", (req, res) => res.json(readDutyRoster()));

  app.post("/api/duty-roster/upsert", express.json(), async (req, res) => {
    const item = normalizeItem(req.body || {});
    const errors = validateItem(item);
    if (errors.length) return res.status(400).json({ ok: false, error: errors.join(", ") });
    try {
      await upsertItem(item);
      await reloadCache();
    } catch (e) {
      return res.status(500).json({ ok: false, error: `Kaydedilemedi: ${e.message}` });
    }
    res.json({ ok: true, items: readDutyRoster() });
  });

  app.post("/api/duty-roster/import", express.json({ limit: "2mb" }), async (req, res) => {
    const incoming = (Array.isArray(req.body?.items) ? req.body.items : []).map(normalizeItem);
    const valid = incoming.filter((it) => validateItem(it).length === 0);
    if (!valid.length) return res.status(400).json({ ok: false, error: "No valid rows" });
    try {
      for (const item of valid) await upsertItem(item);
      await reloadCache();
    } catch (e) {
      return res.status(500).json({ ok: false, error: `Import kaydedilemedi: ${e.message}` });
    }
    res.json({ ok: true, items: readDutyRoster() });
  });

  app.delete("/api/duty-roster/:id", async (req, res) => {
    try {
      await db.query(`DELETE FROM duty_roster WHERE id = $1`, [String(req.params.id)]);
      await reloadCache();
    } catch (e) {
      return res.status(500).json({ ok: false, error: `Silinemedi: ${e.message}` });
    }
    res.json({ ok: true, items: readDutyRoster() });
  });
}

module.exports = {
  initDutyRoster, readDutyRoster,
  // test-only: gercek upsert SQL desenini dogrulamak icin acildi (bkz. db/index.cjs
  // _adaptSql deseni) — DB gerektirmez, db.query mock'lanir.
  _upsertItem: upsertItem,
};
