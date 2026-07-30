// server/auth/presence-routes.cjs — Cevrimici kullanici takibi + avatar servisi.
//
// server/auth/index.cjs'ten ayristirildi (SRP — kurumsal AI kod incelemesi, review.md #19):
// eskiden tum bu mantik session/login/roller/gorunurluk ile ayni 430+ satirlik dosyada, ayni
// /api/auth mount noktasinda yasiyordu. Presence + avatar artik ayri bir mount noktasinda
// (/api/users), kendi dosyasinda, kendi Map'inde yasar — _onlineUsers ARTIK photoUrl
// TASIMIYOR (bkz. avatar-cache.cjs, review.md #18).
'use strict';

const express = require('express');
const avatarCache = require('./avatar-cache.cjs');

const ONLINE_WINDOW_MS = 3 * 60 * 1000;
const _onlineUsers = new Map(); // username → { displayName, role, lastSeen }

// server/auth/index.cjs login handler'i her basarili giriste bunu cagirir.
function trackLogin(user) {
  if (!user?.username) return;
  _onlineUsers.set(user.username, {
    displayName: user.displayName || user.username,
    role: user.role || "User",
    lastSeen: Date.now(),
  });
  if (user.photoUrl) avatarCache.cacheAvatar(user.username, user.photoUrl);
}

// server/auth/index.cjs logout handler'i cagirir.
function removePresence(username) {
  if (username) _onlineUsers.delete(username);
}

function initPresenceRoutes(app) {
  // Her authenticated istekte lastSeen guncellenir; /online son 3 dk icinde gorulen
  // kullanicilari doner (istek yapan + Admin'ler haric).
  app.use((req, _res, next) => {
    const u = req.session?.user;
    if (u?.username) trackLogin(u);
    next();
  });

  // Suresi gecmis kayitlari periyodik temizler — eskiden yalniz GET /online cagrildiginda
  // (lazy) siliniyordu; kimse poll etmezse Map sinirsiz buyuyordu.
  setInterval(() => {
    const cutoff = Date.now() - ONLINE_WINDOW_MS;
    for (const [u, info] of _onlineUsers) {
      if (info.lastSeen < cutoff) _onlineUsers.delete(u);
    }
  }, 60_000).unref();

  const router = express.Router();

  // ── Online kullanicilar (dashboard baloncuklari) ────────────────────────────
  router.get("/online", (req, res) => {
    const me = req.session?.user;
    if (!me) return res.status(401).json({ ok: false, error: "Oturum bulunamadı." });
    const now = Date.now();
    const users = [];
    for (const [username, info] of _onlineUsers) {
      if (now - info.lastSeen > ONLINE_WINDOW_MS) { _onlineUsers.delete(username); continue; }
      if (username === me.username) continue; // kendisi haric
      if (info.role === "Admin") continue;    // admin'ler haric
      users.push({ username, displayName: info.displayName, hasAvatar: !!avatarCache.getAvatar(username) });
    }
    users.sort((a, b) => a.displayName.localeCompare(b.displayName, "tr"));
    res.json({ ok: true, users });
  });

  // ── Kullanici avatari (ayri avatar-cache.cjs'ten binary serve) ──────────────
  router.get("/avatar/:username", (req, res) => {
    if (!req.session?.user) return res.status(401).end();
    const dataUrl = avatarCache.getAvatar(req.params.username);
    if (!dataUrl) return res.status(404).end();
    const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return res.status(404).end();
    const [, mime, data] = match;
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.end(Buffer.from(data, "base64"));
  });

  app.use("/api/users", router);
  console.log("[Auth] presence routes mounted at /api/users");
}

module.exports = { initPresenceRoutes, trackLogin, removePresence };
