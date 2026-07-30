// server/auth/visibility-routes.cjs — Sayfa/element gorunurlugu route'lari
// (server/auth/visibility.cjs + elements.cjs'in HTTP yuzeyi). server/auth/index.cjs'ten
// ayristirildi (SRP — kurumsal AI kod incelemesi, review.md #19); /api/visibility mount
// noktasinda yasar.
'use strict';

const express = require('express');
const visibilityEngine = require('./visibility.cjs');
const { getRequestUser } = require('./utils.cjs');

function initVisibilityRoutes(app, { requireAuth, requireAdmin }) {
  const router = express.Router();
  router.use(express.json());
  try {
    router.use(require("../audit/index.cjs").auditMutations("visibility"));
  } catch { /* audit yoksa yoksay */ }

  // ── Page Visibility (herkes okuyabilir, admin yazabilir) ──────────────────
  // Mount /api/visibility altinda oldugu icin path yalniz "/pages" — eskiden /api/auth/
  // page-visibility idi, "/api/visibility/page-visibility" gibi tekrarli olmasin diye kisaltildi.
  router.get("/pages", async (req, res) => {
    res.json({ ok: true, visibility: await visibilityEngine.readVisibility() });
  });

  router.put("/pages", requireAdmin, async (req, res) => {
    const { visibility } = req.body || {};
    if (!visibility || typeof visibility !== "object") {
      return res.status(400).json({ ok: false, error: "visibility objesi gerekli." });
    }
    let result;
    try {
      result = await visibilityEngine.writeVisibility(visibility);
    } catch (err) {
      return res.status(500).json({ ok: false, error: "Görünürlük kaydedilemedi: " + err.message });
    }
    if (!result.ok) {
      return res.status(207).json({
        ok: false,
        error: `Bazı sayfalar kaydedilemedi: ${result.failed.join(", ")}`,
        failed: result.failed,
      });
    }
    try { visibilityEngine.bumpVersion(); } catch { /* motor yoksa yoksay */ }
    res.json({ ok: true, visibility });
  });

  // ── Dinamik gorunurluk motoru (element bazli) ──────────────────────────────
  // Kullanicinin cozulmus element haritasi + versiyon. Frontend AuthContext bunu ceker;
  // `version`'i poll'leyip degisince yeniden ceker (reload'suz yayilim). Ayni "tekrar" kaygisi
  // ile path "/resolved" (eskiden /api/auth/visibility → /api/visibility/resolved).
  router.get("/resolved", requireAuth, async (req, res) => {
    const user = getRequestUser(req);
    const { version, visibility } = await visibilityEngine.resolveVisibility(user);
    res.json({ ok: true, version, visibility });
  });

  // Hafif versiyon ucu — istemci bunu sik poll'ler, degisince /resolved'i tazeler.
  router.get("/version", requireAuth, (req, res) => {
    res.json({ ok: true, version: visibilityEngine.getVersion() });
  });

  // ── Element CRUD (admin) — dinamik "her seyi ekle/cikar/gizle" yonetim yuzeyi ──
  // Her mutasyon bumpVersion() cagirir → acik oturumdaki kullanicilar reload'suz tazeler.
  const elementsStore = require("./elements.cjs");

  // actions.md #19 (Bolum O.2) — ana menu grup YAPISI (hangi sayfa hangi grupta, hangi
  // sirada). Admin-gated DEGIL (herkes menuyu gormeli) — kill-switch/rol/kullanici
  // gorunurlugu zaten ayri ayri /resolved uzerinden (canSee) uygulanir; bu uc sadece
  // YAPIYI (grup->sayfa iliskisini) doner, boolean karar vermez.
  router.get("/nav-groups", requireAuth, async (req, res) => {
    try {
      const elements = await elementsStore.listElements();
      const groups = elements
        .filter((e) => e.type === "nav_group" && e.enabled)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const pages = elements.filter((e) => e.type === "page");
      const result = groups.map((g) => ({
        key: g.key,
        label: g.label,
        sortOrder: g.sortOrder,
        pageKeys: pages
          .filter((p) => p.parentKey === g.key)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((p) => p.key),
      }));
      res.json({ ok: true, groups: result });
    } catch (err) {
      res.status(503).json({ ok: false, error: err.message });
    }
  });

  router.get("/elements", requireAdmin, async (req, res) => {
    const [elements, rules] = await Promise.all([elementsStore.listElements(), elementsStore.listRules()]);
    res.json({ ok: true, elements, rules, version: visibilityEngine.getVersion() });
  });

  router.post("/elements", requireAdmin, async (req, res) => {
    try {
      await elementsStore.upsertElement(req.body || {});
      visibilityEngine.bumpVersion();
      res.json({ ok: true });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, error: err.message });
    }
  });

  router.put("/elements/:key", requireAdmin, async (req, res) => {
    try {
      await elementsStore.upsertElement({ ...(req.body || {}), key: req.params.key });
      visibilityEngine.bumpVersion();
      res.json({ ok: true });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, error: err.message });
    }
  });

  router.put("/elements/:key/enabled", requireAdmin, async (req, res) => {
    await elementsStore.setElementEnabled(req.params.key, req.body?.enabled !== false);
    visibilityEngine.bumpVersion();
    res.json({ ok: true });
  });

  // Bir elementin tum rol/kullanici kurallarini degistirir (idempotent replace).
  router.put("/elements/:key/rules", requireAdmin, async (req, res) => {
    await elementsStore.setElementRules(req.params.key, req.body?.rules || []);
    visibilityEngine.bumpVersion();
    res.json({ ok: true });
  });

  router.delete("/elements/:key", requireAdmin, async (req, res) => {
    const removed = await elementsStore.deleteElement(req.params.key);
    visibilityEngine.bumpVersion();
    res.json({ ok: true, removed });
  });

  app.use("/api/visibility", router);
  console.log("[Auth] visibility routes mounted at /api/visibility");
}

module.exports = { initVisibilityRoutes };
