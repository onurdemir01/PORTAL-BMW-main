// server/auth/roles-routes.cjs — Rol override CRUD route'lari (server/auth/role-store.cjs'in
// HTTP yuzeyi). server/auth/index.cjs'ten ayristirildi (SRP — kurumsal AI kod incelemesi,
// review.md #19); /api/roles mount noktasinda yasar.
'use strict';

const express = require('express');
const roleStore = require('./role-store.cjs');
const { clearCache } = require('./ldap.cjs');
const sessionPolicy = require('./session-policy.cjs');

// Faz D: rol nedeniyle kapanan oturumlar denetime sebebiyle yazilir.
function oturumIptaliDenetimi(req, target, count, sebep) {
  if (!count) return;
  try {
    require("../audit/index.cjs").auditPortal(req, "session_revoked", {
      detail: `by=role reason=${sebep} target=${target} count=${count}`,
    });
  } catch { /* denetim yoksa yoksay */ }
}

function initRolesRoutes(app, { requireAdmin }) {
  const router = express.Router();
  router.use(express.json());
  try {
    router.use(require("../audit/index.cjs").auditMutations("roles"));
  } catch { /* audit yoksa yoksay */ }

  // Eskiden hand-rolled `role !== 'Admin'` kontrolu vardi (elements route'larindan farkli
  // desen); tutarlilik icin paylasilan requireAdmin guard'ina gecirildi.
  router.get("/", requireAdmin, async (req, res) => {
    res.json({ ok: true, roles: await roleStore.readRoles() });
  });

  // Admin ekrani icin TAM satirlar (kaynak/aciklama/olusturan/son-uygulanma dahil).
  router.get("/detail", requireAdmin, async (req, res) => {
    res.json({ ok: true, roles: await roleStore.readRolesDetailed() });
  });

  router.put("/:username", requireAdmin, async (req, res) => {
    const target = req.params.username.toLowerCase();
    const { role, description } = req.body || {};
    if (!["Admin", "User"].includes(role)) {
      return res.status(400).json({ ok: false, error: "role: Admin veya User olmalı." });
    }
    try {
      await roleStore.setRoleOverride(target, role, {
        createdBy: req.session?.user?.username || null,
        description: description !== undefined ? String(description) : null,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "Rol kaydedilemedi: " + err.message });
    }
    // Cache'i temizle ki sonraki login'de yeni rol gecerli olsun
    clearCache(target);
    const store = require("./mssql-session-store.cjs");
    // YUKSELTME (Admin) oturumu DUSURMEZ, yerinde yansir (2026-10-02): eskiden her rol
    // degisikligi kullaniciyi atiyordu — "sik atiyor" sikayetinin bir kaynagi. Hem acik
    // oturum satirlari yeniden yazilir hem bellege kayit duser (o an suren bir istegin
    // eski rolle geri yazmasina karsi).
    if (role === "Admin") {
      sessionPolicy.rolYukseltmesiKaydet(target, role);
      const refreshed = await store.rewriteRoleForUser(target, role).catch(() => 0);
      return res.json({ ok: true, username: target, role, sessionsRevoked: 0, sessionsRefreshed: refreshed });
    }
    // DUSURME: guvenlik — kullanici ESKI (yuksek) rolle tek istek bile yapamamali.
    // Aktif oturumlar sonlandirilir; yeniden giriste yeni rol gecerli olur.
    sessionPolicy.rolKaydiniSil(target);
    const revoked = await store.revokeSessionsForUser(target).catch(() => 0);
    oturumIptaliDenetimi(req, target, revoked, "role_downgrade");
    res.json({ ok: true, username: target, role, sessionsRevoked: revoked });
  });

  router.delete("/:username", requireAdmin, async (req, res) => {
    const target = req.params.username.toLowerCase();
    await roleStore.removeRoleOverride(target);
    clearCache(target);
    // Override kaldirilinca rol LDAP'a doner — yukari mi asagi mi bilinemez: guvenli
    // yon, oturumlari sonlandirmak.
    sessionPolicy.rolKaydiniSil(target);
    const { revokeSessionsForUser } = require("./mssql-session-store.cjs");
    const revoked = await revokeSessionsForUser(target).catch(() => 0);
    oturumIptaliDenetimi(req, target, revoked, "role_removed");
    res.json({ ok: true, username: target, removed: true, sessionsRevoked: revoked });
  });

  app.use("/api/roles", router);
  console.log("[Auth] roles routes mounted at /api/roles");
}

module.exports = { initRolesRoutes };
