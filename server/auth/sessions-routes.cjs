// server/auth/sessions-routes.cjs — AKTIF OTURUMLAR (Faz D, 2026-10-02).
//
// Kullanici kendi acik oturumlarini gorur ve kapatir ("bu oturum" disindakilerden tek
// tek ya da hepsinden cik); Admin bir kullanicinin oturumlarini gorur ve sonlandirir.
// Her iptal denetime yazilir (session_revoked, by=self|admin).
//
// OTURUM ANAHTARI (sid) ISTEMCIYE ASLA GITMEZ: sid cerezin kendisidir, bilen o oturumu
// devralir. Disariya yalnizca giriste uretilen kisa gorunen kimlik (`meta.id`) verilir;
// iptal istegi bu kimligi SUNUCUDA kullanicinin kendi oturumlariyla eslestirir — baskasinin
// oturumu bu yoldan hic bulunamaz.
'use strict';

const express = require('express');
const sessionPolicy = require('./session-policy.cjs');
const { oturumYok } = require('./utils.cjs');

function denetim(req, action, opts) {
  try {
    require('../audit/index.cjs').auditPortal(req, action, opts);
  } catch {
    /* denetim yoksa yoksay */
  }
}

// Kullanicinin oturumlari: MSSQL store'da sutunla; bellek store'unda (gelistirme) tumu
// taranir. Ikisi de yoksa bos liste.
function oturumlariOku(store, username) {
  const u = String(username || '').toLowerCase();
  return new Promise((resolve, reject) => {
    if (store && typeof store.listByUser === 'function') {
      return store.listByUser(u, (err, list) => (err ? reject(err) : resolve(list || [])));
    }
    if (store && typeof store.all === 'function') {
      return store.all((err, all) => {
        if (err) return reject(err);
        const girdiler = Array.isArray(all)
          ? all.map((sess) => [sess && sess.id, sess])
          : Object.entries(all || {});
        resolve(
          girdiler
            .filter(([, sess]) => sess && sess.user && String(sess.user.username || '').toLowerCase() === u)
            .map(([sid, sess]) => ({ sid, sess })),
        );
      });
    }
    resolve([]);
  });
}

function sil(store, sid) {
  return new Promise((resolve) => store.destroy(sid, () => resolve()));
}

// UA'dan kisa cihaz ozeti ("Chrome · Windows"). Tam UA da doner (title olarak).
function cihazOzeti(ua) {
  const s = String(ua || '');
  const tarayici = /Edg\//.test(s)
    ? 'Edge'
    : /OPR\//.test(s)
      ? 'Opera'
      : /Firefox\//.test(s)
        ? 'Firefox'
        : /Chrome\//.test(s)
          ? 'Chrome'
          : /Safari\//.test(s)
            ? 'Safari'
            : s
              ? 'Tarayıcı'
              : 'Bilinmiyor';
  const isletim = /Windows/.test(s)
    ? 'Windows'
    : /Android/.test(s)
      ? 'Android'
      : /iPhone|iPad|iOS/.test(s)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(s)
          ? 'macOS'
          : /Linux/.test(s)
            ? 'Linux'
            : '';
  return isletim ? `${tarayici} · ${isletim}` : tarayici;
}

function satir(sid, sess, mevcutSid, p) {
  const m = sess.meta || {};
  const b = Number.isFinite(m.createdAt) && Number.isFinite(m.lastSeenAt) ? sessionPolicy.bitisler(m, p) : null;
  return {
    id: m.id || null,
    current: sid === mevcutSid,
    createdAt: Number.isFinite(m.createdAt) ? m.createdAt : null,
    lastSeenAt: Number.isFinite(m.lastSeenAt) ? m.lastSeenAt : null,
    idleExpiresAt: b ? b.idleExpiresAt : null,
    absoluteExpiresAt: b ? b.absoluteExpiresAt : null,
    remember: !!(m.remember && p.rememberEnabled),
    ip: m.ip || '',
    ua: m.ua || '',
    device: cihazOzeti(m.ua),
  };
}

async function liste(req, username) {
  const p = sessionPolicy.policy();
  const now = Date.now();
  const ham = await oturumlariOku(req.sessionStore, username);
  return ham
    .map(({ sid, sess }) => ({ sid, sess, r: satir(sid, sess, req.sessionID, p) }))
    // Suresi (yaptirim acisindan) dolmus ama henuz silinmemis satirlar "acik" degildir.
    .filter(({ r }) => !r.idleExpiresAt || (r.idleExpiresAt > now && r.absoluteExpiresAt > now))
    .sort((a, b) => (b.r.current - a.r.current) || ((b.r.lastSeenAt || 0) - (a.r.lastSeenAt || 0)));
}

/**
 * Esanli oturum ust siniri (SESSION_MAX_CONCURRENT > 0): yeni giristen sonra en eski
 * (son etkinligi en eski) oturumlar kapatilir. 0 = sinirsiz (varsayilan).
 */
async function esanliSiniriUygula(req, username) {
  const n = Number(process.env.SESSION_MAX_CONCURRENT);
  const max = Number.isInteger(n) && n > 0 && n <= 100 ? n : 0;
  if (!max) return 0;
  const hepsi = await liste(req, username).catch(() => []);
  const digerleri = hepsi.filter((x) => !x.r.current);
  const fazla = digerleri.length - (max - 1);
  if (fazla <= 0) return 0;
  const kapanacak = digerleri.sort((a, b) => (a.r.lastSeenAt || 0) - (b.r.lastSeenAt || 0)).slice(0, fazla);
  for (const x of kapanacak) await sil(req.sessionStore, x.sid);
  denetim(req, 'session_revoked', {
    username,
    detail: `by=concurrency max=${max} count=${kapanacak.length}`,
  });
  return kapanacak.length;
}

function initSessionsRoutes(router, { requireAdmin }) {
  const sessionRouter = express.Router();

  const kimlikGerekli = (req, res, next) => {
    if (!req.session || !req.session.user) {
      return oturumYok(res).status(401).json({ ok: false, error: 'Oturum bulunamadı.' });
    }
    next();
  };

  // Kendi oturumlarim
  sessionRouter.get('/', kimlikGerekli, async (req, res) => {
    try {
      const l = await liste(req, req.session.user.username);
      res.json({ ok: true, sessions: l.map((x) => x.r) });
    } catch (e) {
      res.status(503).json({ ok: false, error: `Oturumlar okunamadı: ${e.message}` });
    }
  });

  // Digerlerinin hepsinden cik (bu oturum kalir)
  sessionRouter.delete('/', kimlikGerekli, async (req, res) => {
    if (req.query.scope !== 'others') {
      return res.status(400).json({ ok: false, error: 'scope=others gerekli (bu oturum için Çıkış kullanın).' });
    }
    try {
      const l = await liste(req, req.session.user.username);
      const hedef = l.filter((x) => !x.r.current);
      for (const x of hedef) await sil(req.sessionStore, x.sid);
      denetim(req, 'session_revoked', { detail: `by=self scope=others count=${hedef.length}` });
      res.json({ ok: true, revoked: hedef.length });
    } catch (e) {
      res.status(503).json({ ok: false, error: `Oturumlar kapatılamadı: ${e.message}` });
    }
  });

  // Tek oturumu kapat (kendi oturumlarindan biri)
  sessionRouter.delete('/:id', kimlikGerekli, async (req, res) => {
    try {
      const l = await liste(req, req.session.user.username);
      const x = l.find((y) => y.r.id && y.r.id === req.params.id);
      if (!x) return res.status(404).json({ ok: false, error: 'Oturum bulunamadı (kapanmış olabilir).' });
      if (x.r.current) {
        return res.status(400).json({ ok: false, error: 'Bu oturumu kapatmak için Çıkış kullanın.' });
      }
      await sil(req.sessionStore, x.sid);
      denetim(req, 'session_revoked', { detail: `by=self id=${x.r.id} device=${x.r.device}` });
      res.json({ ok: true, revoked: 1 });
    } catch (e) {
      res.status(503).json({ ok: false, error: `Oturum kapatılamadı: ${e.message}` });
    }
  });

  // ── Admin: bir kullanicinin oturumlari ─────────────────────────────────────
  sessionRouter.get('/admin/:username', requireAdmin, async (req, res) => {
    try {
      const l = await liste(req, req.params.username);
      res.json({ ok: true, username: req.params.username.toLowerCase(), sessions: l.map((x) => x.r) });
    } catch (e) {
      res.status(503).json({ ok: false, error: `Oturumlar okunamadı: ${e.message}` });
    }
  });

  sessionRouter.delete('/admin/:username', requireAdmin, async (req, res) => {
    const hedefKullanici = req.params.username.toLowerCase();
    try {
      const l = await liste(req, hedefKullanici);
      const id = req.query.id ? String(req.query.id) : null;
      const hedef = id ? l.filter((x) => x.r.id === id) : l.filter((x) => !x.r.current);
      if (id && !hedef.length) return res.status(404).json({ ok: false, error: 'Oturum bulunamadı (kapanmış olabilir).' });
      for (const x of hedef) await sil(req.sessionStore, x.sid);
      denetim(req, 'session_revoked', {
        detail: `by=admin target=${hedefKullanici} ${id ? `id=${id}` : 'scope=all'} count=${hedef.length}`,
      });
      res.json({ ok: true, revoked: hedef.length });
    } catch (e) {
      res.status(503).json({ ok: false, error: `Oturumlar kapatılamadı: ${e.message}` });
    }
  });

  router.use('/sessions', sessionRouter);
}

module.exports = { initSessionsRoutes, esanliSiniriUygula, cihazOzeti, oturumlariOku };
