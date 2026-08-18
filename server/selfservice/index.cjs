// server/selfservice/index.cjs
const express = require("express");
const { loadSelfServiceStore, readGroups, updateGroup } = require("./store.cjs");

function initSelfService(app) {
  loadSelfServiceStore().catch((e) => console.warn("[SelfService] store yukleme hata:", e.message));
  const { requireAuth, requireAdmin } = require("../auth/index.cjs");
  const router = express.Router();
  router.use(express.json({ limit: "2mb" }));

  // /health guard'siz kalir (probe). Asagidaki her sey en az authenticated; okuma (GET)
  // her kullaniciya, mutasyonlar (PUT /groups/:id) yalnizca admin'e.
  router.get("/health", async (req, res) => {
    res.json({ ok: true, service: "selfservice" });
  });

  router.use(requireAuth);
  // "/ip-check" (Check sekmesi) bir POST ama gercek bir MUTASYON DEGIL — salt-okunur bir
  // sorgu, herhangi bir authenticated kullanici kullanabilmeli (sadece admin degil). Bu
  // yuzden admin-gate'ten (asagida) ACIKCA MUAF tutuluyor; requireVisiblePrefix (Self
  // Service sayfa gorunurlugu) ve audit loglama ise NORMAL SEKILDE uygulanmaya devam eder
  // (asagida route TANIMI o middleware'lerden SONRA).
  router.use((req, res, next) => {
    if (req.method === "GET") return next();
    if (req.path === "/ip-check") return next();
    return requireAdmin(req, res, next);
  });
  // Tum mutasyonlar portal_audit_logs'a yazilir (bkz. server/audit/index.cjs) — /ip-check
  // de POST oldugu icin burada denetim kaydina girer (kim hangi IP'leri sorguladi).
  try { router.use(require("../audit/index.cjs").auditMutations("selfservice")); } catch { /* audit yoksa yoksay */ }

  // Self Service sayfasi gizliyse gercek 403.
  try {
    const { requireVisiblePrefix } = require("../auth/visibility.cjs");
    router.use(requireVisiblePrefix("Self Service"));
  } catch { /* motor yoksa yoksay */ }

  // POST /ip-check — Check sekmesi: yapistirilan IP listesini dbo.IPInventory'de arar.
  // Genel /api/inventory/data/:table ucu KULLANILMADI (o, tabloya rol-bazli gorunurluk
  // izni gerektiriyor ve tum tabloyu tarama/sayfalama gibi cok daha genis bir yetki
  // yuzeyi acar) - bunun yerine kucuk, amaca-ozel, salt-okunur bir sorgu.
  router.post("/ip-check", async (req, res) => {
    try {
      const raw = req.body?.ips;
      if (!Array.isArray(raw) || raw.length === 0) {
        return res.status(400).json({ ok: false, message: "En az bir IP girilmeli." });
      }
      const seen = new Set();
      const ips = [];
      for (const item of raw) {
        const v = String(item ?? "").trim();
        if (!v) continue;
        const key = v.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        ips.push(v);
        if (ips.length >= 1000) break;
      }
      if (ips.length === 0) {
        return res.status(400).json({ ok: false, message: "Geçerli bir IP bulunamadı." });
      }

      const { query, sql } = require("../inventory/mssql.cjs");
      const inputs = ips.map((ip, i) => ({ name: `ip${i}`, type: sql.NVarChar(64), value: ip }));
      const placeholders = ips.map((_, i) => `@ip${i}`).join(", ");
      const result = await query(
        `SELECT host, ip, created_at, updated_at, last_seen_at FROM dbo.IPInventory WHERE ip IN (${placeholders})`,
        inputs
      );
      const rows = result.recordset || [];

      // ip -> [dbo.IPInventory satiri, ...] (bir IP birden fazla host'ta gorunmus olabilir,
      // TRUNCATE+reload tarama modelinde teorik olarak tekrar etmemeli ama garanti degil).
      const byIp = new Map();
      for (const r of rows) {
        const key = String(r.ip || "").trim().toUpperCase();
        if (!byIp.has(key)) byIp.set(key, []);
        byIp.get(key).push(r);
      }

      const results = ips.map((ip) => {
        const matches = byIp.get(ip.toUpperCase()) || [];
        return { ip, found: matches.length > 0, matches };
      });

      res.json({
        ok: true,
        results,
        totalChecked: ips.length,
        totalFound: results.filter((r) => r.found).length,
      });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message || "Sorgulama başarısız." });
    }
  });

  // "Ansible" sekmesinin etiket/sira/aktiflik metadata'si (Smart/Digerleri katalogu
  // kaldirildigi icin geriye yalniz bu grup kaldi).
  router.get("/", async (req, res) => {
    const groups = readGroups().filter((g) => g.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
    res.json({ ok: true, groups });
  });

  router.put("/groups/:id", async (req, res) => {
    const { label, icon, sortOrder, isActive } = req.body || {};
    const updated = await updateGroup(req.params.id, { label, icon, sortOrder, isActive });
    if (!updated) return res.status(404).json({ ok: false, error: "Grup bulunamadı." });
    res.json({ ok: true, group: updated });
  });

  app.use("/api/selfservice", router);
  console.log("[SelfService] module mounted at /api/selfservice");
}

module.exports = { initSelfService };
