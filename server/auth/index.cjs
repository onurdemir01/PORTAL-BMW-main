// server/auth/index.cjs — session middleware + login/logout/me/prefs/session-debug
// route'lari + requireAuth/requireAdmin guard'lari (/api/auth). Rol-override CRUD'u
// (roles-routes.cjs → /api/roles), sayfa/element gorunurlugu (visibility-routes.cjs →
// /api/visibility) ve cevrimici-kullanici+avatar (presence-routes.cjs → /api/users) ayri
// router modullerine ayristirildi (SRP — kurumsal AI kod incelemesi, review.md #19): eskiden
// hepsi ayni ~430 satirlik dosyada, ayni /api/auth mount noktasinda yasiyordu. Disa donuk
// sozlesme (requireAuth/requireAdmin/getRequestUser/getRequestRole) DEGISMEDI — initAuth(app)
// hala TEK cagridir, yalniz kendi icinde 4 alt-router'i sirayla mount eder.
const express = require("express");
const session = require("express-session");
const { authenticate, clearCache } = require("./ldap.cjs");
const { getRequestUser, getRequestRole } = require("./utils.cjs");
const roleStore = require("./role-store.cjs");
const { initPresenceRoutes, removePresence } = require("./presence-routes.cjs");
const { initVisibilityRoutes } = require("./visibility-routes.cjs");
const { initRolesRoutes } = require("./roles-routes.cjs");

// Production'da bos SESSION_SECRET'i sessizce hardcoded degerle karsilamak guvenlik
// acigi olurdu (herkesce bilinen bir imza anahtariyla session sahteciligi) — bu yuzden
// production'da bossa acikca ve GURULTULU durur. Yerel gelistirmede (NODE_ENV != production)
// sifir-kurulum deneyimi icin sabit fallback korunur.
if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  console.error(
    "[Auth] FATAL: NODE_ENV=production ama SESSION_SECRET bos. " +
    "Guvensiz varsayilan anahtarla acilmaz. Cozum: `openssl rand -hex 32` ile " +
    "uretip ilgili .env.<ortam> dosyasina SESSION_SECRET=... olarak yazin."
  );
  process.exit(1);
}
const SESSION_SECRET  = process.env.SESSION_SECRET || "bmw-portal-dev-secret-change-in-prod";
const SESSION_MAX_AGE = 8 * 60 * 60 * 1000; // 8 hours

// ── Auth init ────────────────────────────────────────────────────────────────
function initAuth(app) {
  // Session store: VARSAYILAN MSSQL (portal_sessions) — restart-dayanikli, kullanicilar
  // yeniden baslatmada logout OLMAZ. Yalniz SESSION_STORE=memory acikca verilirse
  // MemoryStore kullanilir (test/gelistirme). Store yuklenemezse guvenli sekilde
  // MemoryStore'a duser (uygulama calismaya devam eder).
  let sessionStore;
  if (process.env.SESSION_STORE !== "memory") {
    try {
      sessionStore = require("./mssql-session-store.cjs").createMssqlSessionStore(session);
      console.log("[Auth] MSSQL session store aktif (restart-dayanikli).");
    } catch (err) {
      console.warn("[Auth] MSSQL session store yuklenemedi — MemoryStore fallback:", err.message);
    }
  }

  app.use(
    session({
      ...(sessionStore ? { store: sessionStore } : {}),
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        maxAge: SESSION_MAX_AGE,
        sameSite: "lax",
      },
    })
  );

  const router = express.Router();
  router.use(express.json());

  // Rol/gorunurluk/element mutasyonlari portal_audit_logs'a yazilir. login/logout ayrica
  // ozel audit'lenir (body'de sifre var — generic middleware'e girmesin); prefs kisisel
  // UI durumu oldugu icin gurultu yaratmamak adina haric.
  try {
    router.use(require("../audit/index.cjs").auditMutations("auth", {
      exclude: ["/login", "/logout", "/prefs"],
    }));
  } catch { /* audit yoksa yoksay */ }

  // ── Login ──────────────────────────────────────────────────────────────────
  router.post("/login", async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: "Kullanıcı adı ve şifre gerekli." });
    }

    try {
      const trimmedPass = String(password);
      const user = await authenticate(String(username).trim(), trimmedPass);
      // NOT: eskiden burada LogX'in kendi LDAP oturumunu acabilmesi icin kullanicinin
      // sifresi bellekte (sifreli) 8 saat cache'leniyordu (server/auth/cred-cache.cjs) —
      // hicbir gercek tuketicisi olmadigi icin kaldirildi (kurumsal AI kod incelemesi,
      // review.md #15 — riski azaltmak yerine ortadan kaldirmak). LogX'in kendi LDAP
      // baglantisina ileride gercekten ihtiyac duyulursa, KULLANICI sifresini cache'lemek
      // yerine ayri bir servis hesabi (LOGX_LDAP_BIND_DN/LOGX_LDAP_BIND_PASS) kullanilmali.

      // Manuel role override kontrolu (admin panel uzerinden atanmis)
      const override = await roleStore.getRoleOverride(user.username);
      if (override) user.role = override;

      // Kullanici profili: portal_users'a MERGE (last_login/login_count) — best-effort,
      // login'i bloklamaz (bkz. server/auth/users.cjs).
      require('./users.cjs').recordLogin(user).catch(() => {});
      // Denetim kaydi: basarili giris (portal_audit_logs).
      try {
        require('../audit/index.cjs').auditPortal(req, 'login', {
          username: user.username, detail: `authSource=${user.authSource} role=${user.role}`,
        });
      } catch { /* audit yoksa yoksay */ }

      req.session.regenerate((err) => {
        if (err) return res.status(500).json({ ok: false, error: "Oturum başlatılamadı." });
        req.session.user = {
          username:   user.username,
          displayName: user.displayName,
          mail:       user.mail,
          role:       user.role,
          authSource: user.authSource,
          photoUrl:   user.photoUrl || null,
          loginAt:    new Date().toISOString(),
        };
        req.session.save((saveErr) => {
          if (saveErr) return res.status(500).json({ ok: false, error: "Oturum kaydedilemedi." });
          res.json({
            ok:          true,
            username:    user.username,
            role:        user.role,
            displayName: user.displayName,
            mail:        user.mail || "",
            authSource:  user.authSource || "local",
            photoUrl:    user.photoUrl || null,
          });
        });
      });
    } catch (err) {
      // Denetim kaydi: basarisiz giris denemesi.
      try {
        require('../audit/index.cjs').auditPortal(req, 'login_failed', {
          username: String(username).trim(), result: 'fail', detail: err.message,
        });
      } catch { /* yoksay */ }
      res.status(401).json({ ok: false, error: err.message });
    }
  });

  // ── Logout ─────────────────────────────────────────────────────────────────
  router.post("/logout", (req, res) => {
    const username = req.session?.user?.username;
    try { require('../audit/index.cjs').auditPortal(req, 'logout', { username }); } catch { /* yoksay */ }
    req.session.destroy(() => {
      if (username) {
        clearCache(username);
        removePresence(username);
      }
      res.clearCookie("connect.sid");
      res.json({ ok: true });
    });
  });

  // ── Me ─────────────────────────────────────────────────────────────────────
  router.get("/me", (req, res) => {
    if (!req.session?.user) {
      return res.status(401).json({ ok: false, error: "Oturum bulunamadı." });
    }
    res.json({ ok: true, user: req.session.user });
  });

  // ── Kullanici tercihleri (portal_user_preferences) ──────────────────────────
  // UI durumu (tema, envanter kolon secimi/filtre/siralama, aktif admin sekmesi...)
  // kullanici basina DB'de tutulur — restart ve tarayici degisiminde aynen korunur.
  const usersDb = require("./users.cjs");

  router.get("/prefs", async (req, res) => {
    const me = req.session?.user;
    if (!me) return res.status(401).json({ ok: false, error: "Oturum bulunamadı." });
    try {
      res.json({ ok: true, prefs: await usersDb.getPrefs(me.username) });
    } catch (e) {
      // DB yoksa bos tercih seti don — frontend localStorage fallback'iyle calisir.
      res.json({ ok: true, prefs: {}, degraded: true, error: e.message });
    }
  });

  // PUT /prefs — body: { prefs: { key: value, silinecek: null } } (null → tercihi siler)
  router.put("/prefs", async (req, res) => {
    const me = req.session?.user;
    if (!me) return res.status(401).json({ ok: false, error: "Oturum bulunamadı." });
    const prefs = req.body?.prefs;
    if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) {
      return res.status(400).json({ ok: false, error: "prefs objesi gerekli." });
    }
    try {
      const written = await usersDb.setPrefs(me.username, prefs);
      // Tema tercihi ILK HTML'e gomuluyor ve orada kisa omurlu bir onbellekten
      // okunuyor (bkz. server/index.cjs readThemePrefCached). Yazdiktan sonra
      // onbellegi ACIKCA dusur — aksi halde kullanici temayi degistirip TAM SAYFA
      // yenilerse 30 sn boyunca eski tema bir an gorunurdu.
      try { req.app?.locals?.invalidateThemePref?.(me.username); } catch { /* yoksay */ }
      res.json({ ok: true, written });
    } catch (e) {
      res.status(500).json({ ok: false, error: `Tercih kaydedilemedi: ${e.message}` });
    }
  });

  // ── Session diagnostics (401 kok neden teshisi — Faz 0) ─────────────────────
  // Kimlik sizdirmaz; yalnizca oturum/cookie/proxy durumunu doner. Prod'da secure-cookie'nin
  // neden set edilmedigini (X-Forwarded-Proto eksikligi) ve MemoryStore proses-izolasyonunu
  // (cookie VAR ama hasSession=false) teshis eder.
  router.get("/session-debug", requireAdmin, (req, res) => {
    const rawCookie = req.headers.cookie || "";
    res.json({
      ok: true,
      hasSession: !!req.session?.user,
      sessionUser: req.session?.user ? req.session.user.username : null,
      connectSidPresent: /connect\.sid=/.test(rawCookie),
      reqSecure: req.secure,                                   // trust proxy sonrasi
      xForwardedProto: req.headers["x-forwarded-proto"] || null,
      nodeEnv: process.env.NODE_ENV || null,
      sessionStore: process.env.SESSION_STORE === "mssql" ? "mssql" : "memory",
      cookieSecureConfigured: process.env.NODE_ENV === "production",
      hint: !req.session?.user && /connect\.sid=/.test(rawCookie)
        ? "Cookie var ama session yok → farklı proses/MemoryStore ya da store'da kayıt yok. SESSION_STORE=mssql önerilir."
        : (process.env.NODE_ENV === "production" && req.headers["x-forwarded-proto"] !== "https"
          ? "Prod'da X-Forwarded-Proto=https YOK → secure cookie set edilmez → login sonrası 401. Ters-proxy header'ı göndermeli."
          : "OK / ek teşhis gerekmez."),
    });
  });

  app.use("/api/auth", router);
  console.log("[Auth] module mounted at /api/auth");

  // Presence/avatar (/api/users), sayfa+element gorunurlugu (/api/visibility) ve rol
  // override CRUD'u (/api/roles) artik ayri router dosyalarinda yasiyor — requireAuth/
  // requireAdmin asagida tanimli (function hoisting sayesinde burada da erisilebilir).
  initPresenceRoutes(app);
  initVisibilityRoutes(app, { requireAuth, requireAdmin });
  initRolesRoutes(app, { requireAdmin });
}

// trustedHeaderUser/getRequestUser/getRequestRole artik server/auth/utils.cjs'de tanimli —
// bu, server/auth/visibility.cjs'in bunlari dongusel bagimlilik OLUSTURMADAN import edebilmesi
// icindir (eskiden visibility.cjs bu dosyayi lazy-require ediyordu, bu dosya da visibility.cjs'i
// require ediyordu — yapisal dongu). Geriye donuk uyumluluk icin ayni isimlerle re-export edilir
// (server/tasks, server/links, server/inventory bunlari `require("../auth/index.cjs")` ile cekiyor).
function requireAuth(req, res, next) {
  if (getRequestUser(req)) return next();
  res.status(401).json({ ok: false, error: "Oturum bulunamadı. Lütfen giriş yapın." });
}

// Tek, paylasilan admin guard'i — moduller kendi `role==='Admin'` kontrollerini yeniden
// yazmak yerine bunu kullanir (tutarli + secret-kapili header ile guvenli).
function requireAdmin(req, res, next) {
  const u = getRequestUser(req);
  if (!u) return res.status(401).json({ ok: false, error: "Oturum bulunamadı. Lütfen giriş yapın." });
  if (u.role !== "Admin") return res.status(403).json({ ok: false, error: "Bu işlem için yönetici yetkisi gerekli." });
  next();
}

module.exports = { initAuth, requireAuth, requireAdmin, getRequestUser, getRequestRole };
