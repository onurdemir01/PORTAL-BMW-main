// server/links/index.cjs — Yardimci Araclar / Onemli Linkler (DB-tabanli).
// Kayitlar portal_links tablosunda tutulur; bellek cache'i senkron okumalar icindir.
// Eski server/data/important-links.json dosyasi ve 'links' config blob'u yalnizca
// tek seferlik ilk goc (import) kaynagi olarak okunur — artik yazilmaz.
const express = require("express");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const db = require("../db/index.cjs");

const LEGACY_LINKS_FILE = path.join(__dirname, "../data/important-links.json");
const LEGACY_DUTY_LINKS_FILE = path.join(__dirname, "../data/duty-roster-links.json");

// ── Seed data (tablo bos ve hicbir eski kaynak yoksa bir kez yazilir) ─────────
// visibleTo: hangi rollere gorunsun ("Admin","User") — page_visibility ile ayni
// mantik, ama link bazinda. isFavorite: true ise Dashboard'daki "One Cikan
// Baglanti" rotasyonuna dahil olur.
const SEED_LINKS = [
  { id: "1", label: "Connect", url: "https://connect.example.com", category: "Portal", description: "Connect sistemine erişim.", isActive: true, order: 0, openInNewTab: true, visibleTo: ["Admin", "User"], isFavorite: true },
  { id: "2", label: "Dynatrace", url: "https://dynatrace.example.com", category: "Monitoring", description: "Performans izleme aracına erişim.", isActive: true, order: 1, openInNewTab: true, visibleTo: ["Admin", "User"], isFavorite: true },
  { id: "3", label: "Jira", url: "https://jira.example.com", category: "DevOps", description: "Proje ve görev yönetimi.", isActive: true, order: 2, openInNewTab: true, visibleTo: ["Admin", "User"], isFavorite: false },
  { id: "4", label: "Confluence", url: "https://confluence.example.com", category: "DevOps", description: "Bilgi ve dokümantasyon merkezi.", isActive: true, order: 3, openInNewTab: true, visibleTo: ["Admin", "User"], isFavorite: false },
  { id: "5", label: "RedHat", url: "https://redhat.com", category: "Vendors", description: "Red Hat resmi kaynaklar.", isActive: true, order: 4, openInNewTab: true, visibleTo: ["Admin", "User"], isFavorite: false },
  { id: "6", label: "AWX/Ansible Tower", url: "https://maestro2", category: "Automation", description: "Ansible AWX job ve template yönetimi.", isActive: true, order: 5, openInNewTab: true, visibleTo: ["Admin"], isFavorite: false },
  { id: "7", label: "LogX Dashboard", url: "/logx", category: "Portal", description: "Sunucu log viewer.", isActive: true, order: 6, openInNewTab: false, visibleTo: ["Admin", "User"], isFavorite: false },
];

// Eski kayitlarda eksik olabilecek alanlari geriye-uyumlu varsayilanlarla tamamlar.
function normalizeLink(link) {
  return {
    ...link,
    visibleTo: Array.isArray(link.visibleTo) && link.visibleTo.length > 0 ? link.visibleTo : ["Admin", "User"],
    isFavorite: !!link.isFavorite,
  };
}

// ── DB satiri ↔ API nesnesi donusumleri ───────────────────────────────────────
function rowToLink(r) {
  return normalizeLink({
    id: r.id,
    label: r.label,
    url: r.url,
    category: r.category,
    description: r.description || "",
    isActive: !!r.is_active,
    order: r.sort_order ?? 0,
    openInNewTab: !!r.open_in_new_tab,
    icon: r.icon || "",
    visibleTo: String(r.visible_to || "Admin,User").split(",").map((s) => s.trim()).filter(Boolean),
    isFavorite: !!r.is_favorite,
  });
}

async function insertLinkRow(l) {
  await db.query(
    `INSERT INTO portal_links (id, label, url, category, description, is_active, sort_order, open_in_new_tab, icon, visible_to, is_favorite)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      l.id, l.label, l.url, l.category, l.description || "",
      l.isActive !== false ? 1 : 0, l.order ?? 0, l.openInNewTab !== false ? 1 : 0,
      l.icon || "", (l.visibleTo || ["Admin", "User"]).join(","), l.isFavorite ? 1 : 0,
    ]
  );
}

// ── Bellek cache + yukleme ────────────────────────────────────────────────────
let _links = null; // null → DB henuz yuklenmedi (fallback: eski dosya/seed)

function readLinksFallback() {
  try {
    if (fs.existsSync(LEGACY_LINKS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(LEGACY_LINKS_FILE, "utf-8"));
      if (Array.isArray(raw)) return raw.map(normalizeLink);
    }
  } catch { /* dosya bozuksa seed'e dus */ }
  return SEED_LINKS.map(normalizeLink);
}

function readLinks() {
  return _links ? _links.slice() : readLinksFallback();
}

async function reloadCache() {
  const { rows } = await db.query(`SELECT * FROM portal_links ORDER BY sort_order, id`);
  _links = rows.map(rowToLink);
}

// Tek seferlik goc: tablo bossa eski JSON dosyasi > 'links' blob'u > SEED sirasiyla
// icaktarilir. Eski "Nobet Hizli Linkler" deposu (duty-roster-links.json) da ayni
// anda category="Nobet" ile tasinir (bkz. proje plani WS12).
async function importLegacyIfEmpty() {
  const { rows } = await db.query(`SELECT COUNT(*) AS n FROM portal_links`);
  if (Number(rows[0]?.n || 0) > 0) return;

  let source = null;
  try {
    if (fs.existsSync(LEGACY_LINKS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(LEGACY_LINKS_FILE, "utf-8"));
      if (Array.isArray(raw) && raw.length) source = raw;
    }
  } catch { /* dosya bozuk → blob dene */ }
  if (!source) {
    try {
      const blob = await db.query(`SELECT data FROM portal_config_blobs WHERE name = $1`, ["links"]);
      if (blob.rows.length) {
        const parsed = JSON.parse(blob.rows[0].data);
        if (Array.isArray(parsed) && parsed.length) source = parsed;
      }
    } catch { /* blob yok */ }
  }
  const links = (source || SEED_LINKS).map(normalizeLink);

  // Eski nobet hizli linkleri (varsa) tek listede birlestir.
  try {
    if (fs.existsSync(LEGACY_DUTY_LINKS_FILE)) {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_DUTY_LINKS_FILE, "utf-8"));
      if (Array.isArray(legacy)) {
        const existingKeys = new Set(links.map((l) => `${l.label}|${l.url}`));
        let order = links.length;
        for (const l of legacy) {
          if (!l.label || !l.url) continue;
          const key = `${l.label}|${l.url}`;
          if (existingKeys.has(key)) continue;
          links.push(normalizeLink({
            id: randomUUID(), label: String(l.label).trim(), url: String(l.url).trim(),
            category: "Nöbet", description: "", isActive: true, order: order++,
            openInNewTab: true, icon: l.icon || "",
          }));
          existingKeys.add(key);
        }
      }
      try { fs.renameSync(LEGACY_DUTY_LINKS_FILE, `${LEGACY_DUTY_LINKS_FILE}.migrated`); } catch { /* yoksay */ }
    }
  } catch (e) {
    console.warn("[Links] duty-roster-links import hatasi:", e.message);
  }

  for (const l of links) {
    try { await insertLinkRow(l); } catch (e) { console.warn(`[Links] import satiri eklenemedi (${l.label}):`, e.message); }
  }
  console.log(`[DB] migrated links (${links.length} satir)`);
}

async function loadLinksStore() {
  try {
    await importLegacyIfEmpty();
    await reloadCache();
    console.log(`[Links] ${_links.length} link DB'den yuklendi.`);
  } catch (e) {
    console.warn("[Links] DB yuklenemedi, dosya/seed fallback aktif:", e.message);
  }
}

const { getRequestRole } = require("../auth/index.cjs");

// Header'a dogrudan guvenmez — session veya secret'li guvenilir header (bkz. auth getRequestRole).
function isAdmin(req) {
  return getRequestRole(req) === "Admin";
}

function validate(body) {
  const errors = [];
  if (!body.label || !String(body.label).trim()) errors.push("label gerekli");
  if (!body.url || !String(body.url).trim()) errors.push("url gerekli");
  if (!body.category || !String(body.category).trim()) errors.push("category gerekli");
  return errors;
}

// ── Main export ──────────────────────────────────────────────────────────────
function initLinks(app) {
  loadLinksStore().catch((e) => console.warn("[Links] store yukleme hata:", e.message));

  const router = express.Router();
  router.use(express.json());

  // Linkler sayfasi gizliyse gercek 403 (kozmetik degil).
  try {
    const { requireVisiblePrefix } = require('../auth/visibility.cjs');
    router.use(requireVisiblePrefix('Linkler'));
  } catch { /* motor yoksa yoksay */ }
  // Tum mutasyonlar portal_audit_logs'a yazilir.
  try { router.use(require("../audit/index.cjs").auditMutations("links")); } catch { /* yoksay */ }

  // GET all links (sorted). Admin: hepsi. Digerleri: yalnizca aktif VE rolune acik.
  router.get("/", (req, res) => {
    const admin = isAdmin(req);
    const all = readLinks().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const visible = admin ? all : all.filter((l) => l.isActive && l.visibleTo.includes("User"));
    res.json({ ok: true, links: visible });
  });

  // Body'den visibleTo'yu guvenli cozer — gecersiz/eksikse tum rollere acik varsayilir.
  function resolveVisibleTo(body) {
    const raw = body.visibleTo;
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.filter((r) => r === "Admin" || r === "User");
    }
    return ["Admin", "User"];
  }

  // POST create (admin)
  router.post("/", async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ ok: false, error: "Admin yetkisi gerekli." });
    const errors = validate(req.body);
    if (errors.length) return res.status(400).json({ ok: false, error: errors.join(", ") });

    const newLink = normalizeLink({
      id: randomUUID(),
      label: String(req.body.label).trim(),
      url: String(req.body.url).trim(),
      category: String(req.body.category).trim(),
      description: String(req.body.description || "").trim(),
      isActive: req.body.isActive !== false,
      order: readLinks().length,
      openInNewTab: req.body.openInNewTab !== false,
      icon: req.body.icon ? String(req.body.icon).trim() : "",
      visibleTo: resolveVisibleTo(req.body),
      isFavorite: !!req.body.isFavorite,
    });
    try {
      await insertLinkRow(newLink);
      await reloadCache();
    } catch (e) {
      return res.status(500).json({ ok: false, error: `Kaydedilemedi: ${e.message}` });
    }
    res.json({ ok: true, link: newLink });
  });

  // PUT update (admin)
  router.put("/:id", async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ ok: false, error: "Admin yetkisi gerekli." });
    const existing = readLinks().find((l) => l.id === req.params.id);
    if (!existing) return res.status(404).json({ ok: false, error: "Link bulunamadı." });

    const errors = validate(req.body);
    if (errors.length) return res.status(400).json({ ok: false, error: errors.join(", ") });

    const updated = normalizeLink({
      ...existing,
      label: String(req.body.label).trim(),
      url: String(req.body.url).trim(),
      category: String(req.body.category).trim(),
      description: String(req.body.description || "").trim(),
      isActive: req.body.isActive !== false,
      openInNewTab: req.body.openInNewTab !== false,
      icon: req.body.icon !== undefined ? String(req.body.icon).trim() : existing.icon || "",
      visibleTo: resolveVisibleTo(req.body),
      isFavorite: !!req.body.isFavorite,
    });
    try {
      await db.query(
        `UPDATE portal_links SET label=$1, url=$2, category=$3, description=$4, is_active=$5,
           open_in_new_tab=$6, icon=$7, visible_to=$8, is_favorite=$9, updated_at=GETUTCDATE()
         WHERE id=$10`,
        [
          updated.label, updated.url, updated.category, updated.description,
          updated.isActive ? 1 : 0, updated.openInNewTab ? 1 : 0, updated.icon || "",
          updated.visibleTo.join(","), updated.isFavorite ? 1 : 0, req.params.id,
        ]
      );
      await reloadCache();
    } catch (e) {
      return res.status(500).json({ ok: false, error: `Kaydedilemedi: ${e.message}` });
    }
    res.json({ ok: true, link: updated });
  });

  // DELETE (admin)
  router.delete("/:id", async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ ok: false, error: "Admin yetkisi gerekli." });
    try {
      await db.query(`DELETE FROM portal_links WHERE id = $1`, [req.params.id]);
      await reloadCache();
    } catch (e) {
      return res.status(500).json({ ok: false, error: `Silinemedi: ${e.message}` });
    }
    res.json({ ok: true, links: readLinks() });
  });

  // POST reorder (admin) — body: { orderedIds: string[] }
  router.post("/reorder", async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ ok: false, error: "Admin yetkisi gerekli." });
    const { orderedIds } = req.body || {};
    if (!Array.isArray(orderedIds)) return res.status(400).json({ ok: false, error: "orderedIds array gerekli." });
    try {
      for (let i = 0; i < orderedIds.length; i++) {
        await db.query(`UPDATE portal_links SET sort_order=$1, updated_at=GETUTCDATE() WHERE id=$2`, [i, orderedIds[i]]);
      }
      await reloadCache();
    } catch (e) {
      return res.status(500).json({ ok: false, error: `Siralama kaydedilemedi: ${e.message}` });
    }
    res.json({ ok: true });
  });

  app.use("/api/links", router);
  console.log("[Links] module mounted at /api/links");
}

module.exports = { initLinks };
