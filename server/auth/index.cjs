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
const { getRequestUser, getRequestRole, oturumYok } = require("./utils.cjs");
const roleStore = require("./role-store.cjs");
const { initPresenceRoutes, removePresence } = require("./presence-routes.cjs");
const { initVisibilityRoutes } = require("./visibility-routes.cjs");
const { initRolesRoutes } = require("./roles-routes.cjs");
const sessionPolicy = require("./session-policy.cjs");
const { normalizeLoginInput, checkPassword } = require("./login-input.cjs");
const loginThrottle = require("./login-throttle.cjs");
const { initSessionsRoutes, esanliSiniriUygula } = require("./sessions-routes.cjs");

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

  // Sureler (bosta kalma / mutlak / beni hatirla) burada DEGIL: session-policy.cjs her
  // istekte process.env'den okur ve asagidaki yaptirim katmani uygular. Eskiden cerez
  // giristen 8 sa sonra kesin bitiyordu ve etkinlik sureyi uzatmiyordu ("sik atiyor").
  // `rolling`: cerez her yanitta yeniden yazilir (kalici/oturum cerezi karari orada).
  app.use(
    session({
      ...(sessionStore ? { store: sessionStore } : {}),
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
        sameSite: "lax",
      },
    })
  );
  app.use(sessionPolicy.oturumYaptirimi());

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
    const { username, password, remember } = req.body || {};
    // Faz C (2026-10-02): girdi TEK yerde normalize edilir (login-input.cjs) —
    // `KURUM\ad`, `ad@kurum`, Turkce I, gorunmez karakter. Hata mesaji kullaniciya aynen.
    const girdi = normalizeLoginInput(username, { searchAttr: process.env.AUTH_LDAP_SEARCH_ATTR || "sAMAccountName" });
    if (!girdi.ok) return res.status(400).json({ ok: false, code: girdi.code, error: girdi.message });
    const sifreDurumu = checkPassword(password);
    if (!sifreDurumu.ok) return res.status(400).json({ ok: false, code: sifreDurumu.code, error: sifreDurumu.message });

    // Kullanici basina geri cekilme: esik asildiysa AD'ye HIC gidilmez (AD kilidi korunur).
    const kilit = loginThrottle.kontrol(girdi.username);
    if (!kilit.ok) {
      res.setHeader("Retry-After", String(kilit.retryAfter));
      return res.status(429).json({
        ok: false,
        code: "cok_deneme",
        retryAfter: kilit.retryAfter,
        error: `Çok fazla hatalı deneme. ${kilit.retryAfter} saniye sonra tekrar deneyin.`,
      });
    }

    try {
      // Sifre KIRPILMAZ: bosluk sifrenin parcasi olabilir.
      const user = await authenticate(girdi.username, password, girdi.lookup);
      loginThrottle.basariKaydet(girdi.username);
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
          // AD GRUP UYELIKLERI (`memberOf`, normalize + 200 ile sinirli — bkz. ldap.cjs).
          // Yetki katmani (`logx/v2/restrictions.cjs`) grup grant'larini BURADAN okur;
          // oturuma yazilmadigi surece `normalizedGroups` her istekte bos Set doner ve
          // hicbir grup grant'i eslesmezdi — ozellik bastan sona olu kalirdi.
          // LDAP kapaliysa / yerel kullanicida bos dizi: kullanici adi grant'lari
          // etkilenmez, mevcut davranis birebir korunur.
          groups:     Array.isArray(user.groups) ? user.groups : [],
          loginAt:    new Date().toISOString(),
        };
        // Oturum kunyesi: bosta kalma / mutlak sure buradan sayilir. "Beni hatirla"
        // yalnizca Admin acik biraktiysa (SESSION_REMEMBER_DAYS > 0) gecerlidir.
        const pol = sessionPolicy.policy();
        req.session.meta = sessionPolicy.yeniMeta(req, { remember: remember === true && pol.rememberEnabled });
        sessionPolicy.cerezAyarla(req.session, pol);
        req.session.save(async (saveErr) => {
          if (saveErr) return res.status(500).json({ ok: false, error: "Oturum kaydedilemedi." });
          // Esanli oturum siniri (Admin acarsa): en eski oturumlar kapatilir, kullaniciya soylenir.
          const closedOthers = await esanliSiniriUygula(req, user.username).catch(() => 0);
          res.json({
            ok:          true,
            closedOthers,
            session:     sessionPolicy.oturumOzeti(req.session, pol),
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
      const code = err.code && typeof err.code === "string" && !/^E[A-Z]+$/.test(err.code) ? err.code : "kimlik";
      const status = Number.isInteger(err.status) ? err.status : 401;
      // Yalnizca KIMLIK hatasi sayilir: sunucuya ulasilamamasi ya da kilitli hesap
      // kullanicinin deneme hakkini yememeli.
      let sayac = null;
      if (code === "kimlik") sayac = loginThrottle.hataKaydet(girdi.username);
      // Denetim kaydi: basarisiz giris denemesi (sebep kodu; sifre ASLA yazilmaz).
      try {
        require('../audit/index.cjs').auditPortal(req, 'login_failed', {
          username: girdi.username, result: 'fail', detail: `code=${code} ${err.message}`,
        });
      } catch { /* yoksay */ }
      let mesaj = err.message;
      if (sayac && sayac.retryAfter) {
        res.setHeader("Retry-After", String(sayac.retryAfter));
        mesaj += ` Çok fazla hatalı deneme: ${sayac.retryAfter} saniye bekleyin.`;
      } else if (sayac && sayac.kalan > 0 && sayac.kalan <= 2) {
        mesaj += ` (${sayac.kalan} deneme hakkınız kaldı, sonra kısa bir bekleme uygulanır.)`;
      }
      res.status(status).json({
        ok: false,
        code,
        error: mesaj,
        ...(sayac && sayac.retryAfter ? { retryAfter: sayac.retryAfter } : {}),
      });
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
      return oturumYok(res).status(401).json({ ok: false, error: "Oturum bulunamadı." });
    }
    res.json({ ok: true, user: req.session.user });
  });

  // ── Oturum saati (istemci geri sayimi) ──────────────────────────────────────
  // GET etkinlik SAYILMAZ (session-policy ARKA_PLAN_YOLLARI): istemcinin saatini
  // tazelemesi oturumu sonsuza dek acik tutmamali. "Surdur" POST /session/extend'dir.
  router.get("/session", (req, res) => {
    if (!req.session?.user) {
      return oturumYok(res).status(401).json({ ok: false, error: "Oturum bulunamadı." });
    }
    res.json(sessionPolicy.oturumOzeti(req.session));
  });

  router.post("/session/extend", (req, res) => {
    if (!req.session?.user) {
      return oturumYok(res).status(401).json({ ok: false, error: "Oturum bulunamadı." });
    }
    res.json(sessionPolicy.uzat(req, res));
  });

  // Giris ekrani "beni hatirla" kutusunu gostermeli mi (oturumsuz okunur; sir yok).
  router.get("/session-policy", (_req, res) => {
    const p = sessionPolicy.policy();
    res.json({
      ok: true,
      rememberEnabled: p.rememberEnabled,
      rememberDays: Math.round(p.rememberMs / 86400000),
      idleMinutes: Math.round(p.idleMs / 60000),
      absoluteHours: Math.round(p.absoluteMs / 3600000),
    });
  });

  // ── Aktif oturumlar (Faz D) ───────────────────────────────────────────────
  initSessionsRoutes(router, { requireAdmin });

  // ── Kullanici tercihleri (portal_user_preferences) ──────────────────────────
  // UI durumu (tema, envanter kolon secimi/filtre/siralama, aktif admin sekmesi...)
  // kullanici basina DB'de tutulur — restart ve tarayici degisiminde aynen korunur.
  const usersDb = require("./users.cjs");

  router.get("/prefs", async (req, res) => {
    const me = req.session?.user;
    if (!me) return oturumYok(res).status(401).json({ ok: false, error: "Oturum bulunamadı." });
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
    if (!me) return oturumYok(res).status(401).json({ ok: false, error: "Oturum bulunamadı." });
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
      // Eskiden `SESSION_STORE === "mssql"` soruluyordu: varsayilan (bos) MSSQL iken de
      // "memory" diyordu — teshis ekrani yanlis yola gonderiyordu.
      sessionStore: sessionStore ? "mssql" : "memory",
      sessionPolicy: sessionPolicy.policy(),
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
  oturumYok(res).status(401).json({ ok: false, error: "Oturum bulunamadı. Lütfen giriş yapın." });
}

// Tek, paylasilan admin guard'i — moduller kendi `role==='Admin'` kontrollerini yeniden
// yazmak yerine bunu kullanir (tutarli + secret-kapili header ile guvenli).
function requireAdmin(req, res, next) {
  const u = getRequestUser(req);
  if (!u) return oturumYok(res).status(401).json({ ok: false, error: "Oturum bulunamadı. Lütfen giriş yapın." });
  if (u.role !== "Admin") return res.status(403).json({ ok: false, error: "Bu işlem için yönetici yetkisi gerekli." });
  next();
}

module.exports = { initAuth, requireAuth, requireAdmin, getRequestUser, getRequestRole };
