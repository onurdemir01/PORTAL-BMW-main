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
  // requireAuth (G7): bu uc eskiden KIMLIKSIZ okunabiliyordu ve sayfa→rol haritasini
  // login olmadan sizdiriyordu (hangi modullerin var oldugu + hangi rollere acik).
  router.get("/pages", requireAuth, async (req, res) => {
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
  // Soft surum: motor okunamazsa 500 yerine bos harita doner (UI kilitlenmez). Gercek
  // erisim karari her zaman sunucudaki requireVisible'dadir ve orasi fail-CLOSED'dir.
  router.get("/resolved", requireAuth, async (req, res) => {
    const user = getRequestUser(req);
    const { version, visibility } = await visibilityEngine.resolveVisibilitySoft(user);
    res.json({ ok: true, version, visibility, ok_engine: Object.keys(visibility).length > 0 });
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

  // ── Denetim Erisimi (2026-09-17): kullanici / AD grubu -> sekme listesi ─────────────
  // Ayni motorun uzerinde ince bir yuz: bir principal icin 'Denetim' sayfasina allow +
  // secilen 'tab:denetim:<id>' elementlerine allow yazar; silmek tum bu kurallari kaldirir.
  // nginx sekmeleri 2026-09-22'de Nginx Hub'a tasindi (Admin); burada yok.
  const DENETIM_TAB_KEYS = ['ocp', 'init', 'deploy', 'routetraffic', 'envanter', 'degisim', 'appenvs', 'webapp'];
  const denetimKeys = () => ['Denetim', ...DENETIM_TAB_KEYS.map((t) => 'tab:denetim:' + t)];

  router.get("/denetim-access", requireAdmin, async (_req, res) => {
    try {
      const rules = (await elementsStore.listRules()).filter((r) => denetimKeys().includes(r.elementKey) && r.principalType !== 'role');
      const byP = new Map();
      for (const r of rules) {
        const k = r.principalType + '|' + r.principalId;
        if (!byP.has(k)) byP.set(k, { principalType: r.principalType, principalId: r.principalId, page: false, tabs: [] });
        const e = byP.get(k);
        if (r.elementKey === 'Denetim') e.page = r.allow;
        else if (r.allow) e.tabs.push(r.elementKey.replace('tab:denetim:', ''));
      }
      res.json({ ok: true, tabs: DENETIM_TAB_KEYS, grants: [...byP.values()].sort((a, b) => a.principalType.localeCompare(b.principalType) || a.principalId.localeCompare(b.principalId)) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // body: { principalType: 'user'|'group', principalId, tabs: string[] | 'all' }
  router.put("/denetim-access", requireAdmin, async (req, res) => {
    try {
      const pt = req.body?.principalType === 'group' ? 'group' : req.body?.principalType === 'user' ? 'user' : null;
      const pid = String(req.body?.principalId || '').trim().toLowerCase();
      if (!pt || !pid) return res.status(400).json({ ok: false, error: 'principalType (user|group) ve principalId zorunlu.' });
      const want = req.body?.tabs === 'all' ? DENETIM_TAB_KEYS : (Array.isArray(req.body?.tabs) ? req.body.tabs : []).filter((t) => DENETIM_TAB_KEYS.includes(t));
      if (want.length === 0) return res.status(400).json({ ok: false, error: 'En az bir sekme secilmeli.' });
      const all = await elementsStore.listRules();
      for (const key of denetimKeys()) {
        const others = all.filter((r) => r.elementKey === key && !(r.principalType === pt && r.principalId.toLowerCase() === pid));
        const tab = key.replace('tab:denetim:', '');
        const allow = key === 'Denetim' ? true : want.includes(tab);
        // sekme kurali: secilmeyen sekme icin kural YAZILMAZ (default_visible=0 zaten kapali)
        const mine = (key === 'Denetim' || allow) ? [{ principalType: pt, principalId: pid, allow: true }] : [];
        await elementsStore.setElementRules(key, [...others, ...mine]);
      }
      visibilityEngine.bumpVersion();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.delete("/denetim-access", requireAdmin, async (req, res) => {
    try {
      const pt = req.query.principalType === 'group' ? 'group' : 'user';
      const pid = String(req.query.principalId || '').trim().toLowerCase();
      if (!pid) return res.status(400).json({ ok: false, error: 'principalId zorunlu.' });
      const all = await elementsStore.listRules();
      for (const key of denetimKeys()) {
        const others = all.filter((r) => r.elementKey === key && !(r.principalType === pt && r.principalId.toLowerCase() === pid));
        await elementsStore.setElementRules(key, others);
      }
      visibilityEngine.bumpVersion();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
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
