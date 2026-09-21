// server/service.cjs
const express = require("express");
const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");
const compression = require("compression");

function createApp() {
  const app = express();

  // L-01: Remove Express fingerprint header
  app.disable("x-powered-by");

  // Nginx bir 5xx yanitinin govdesini kendi hata sayfasiyla degistirebiliyor (bu host'ta
  // dogrulandi — bkz. git log) — yani istemci tarafinda gercek hata mesaji hicbir zaman
  // gorunmuyor. Bu yuzden 400+ donen her /api yanitinin GERCEK govdesini burada, en
  // erken noktada (express.json/session'dan once) yakalayip logluyoruz; aksi halde bir
  // sonraki "500 aliyorum ama sebebini bilmiyorum" turunu tekrar yasariz.
  // OTURUMSUZ ISTEK BIR HATA DEGIL — TOPLANIR, TEK TEK YAZILMAZ.
  //
  // OLCUM (uretim, 13,5 gun): 17.280 WARN'in 10.211'i 401. Bunun 6.690'i tek
  // basina iki yoklama ucundan (`visibility/resolved` 3.683, `visibility/version`
  // 3.007). Kok neden ayri (oturum deposu bellekte, her yeniden baslatmada tum
  // oturumlar siliniyor) ama SONUC su: logun ucte biri "oturum yok" diyor ve
  // GERCEK hatalar bu gurultunun altinda kayboluyor.
  //
  // SUSTURMUYORUZ, OZETLIYORUZ: dakikada bir uc bazinda sayilar yazilir. Boylece
  // "401 firtinasi var mi, hangi ucta" sorusu hala cevaplanabilir — ki bir
  // sonraki oturum deposu degisikliginin ise yarayip yaramadigi ancak boyle
  // olculur.
  //
  // 401 DISINDAKI her sey ESKISI GIBI tek tek yazilir.
  const _401Sayac = new Map();
  let _401Toplam = 0;
  const OZET_MS = 60000;
  const _401Ozet = setInterval(() => {
    if (!_401Toplam) return;
    // Yalnizca en yogun 5 uc — sinirsiz bir ozet, gurultuyu baska bicimde
    // geri getirirdi.
    const ilk = [..._401Sayac.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.warn(
      `[API 401 ozet] son ${OZET_MS / 1000} sn: ${_401Toplam} oturumsuz istek · ` +
        ilk.map(([u, n]) => `${u}=${n}`).join(' '),
    );
    _401Sayac.clear();
    _401Toplam = 0;
  }, OZET_MS);
  // `unref()`: dagitimda kapanmayi geciktirmez.
  _401Ozet.unref();

  app.use("/api", (req, res, next) => {
    const origJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode === 401) {
        // Uc adi SORGU DIZESINDEN ARINDIRILIR: `?id=123` gibi parametreler
        // sayaci sinirsiz buyuturdu (bu depoda kullanici anahtarli sinirsiz
        // Map'ler bir OOM sinifiydi).
        const yol = String(req.originalUrl || '').split('?')[0];
        if (_401Sayac.size < 50) _401Sayac.set(yol, (_401Sayac.get(yol) || 0) + 1);
        _401Toplam++;
      } else if (res.statusCode >= 400) {
        console.warn(`[API hata] ${res.statusCode} ${req.method} ${req.originalUrl}:`, JSON.stringify(body));
      }
      return origJson(body);
    };
    next();
  });

  // L-06: Gzip compression — nobetci/list 55KB → ~8KB
  app.use(compression());

  // common middlewares
  app.use(express.json({ limit: "2mb" }));

  // L-02: CORS — allow Vite dev origin or env-configured origin
  const allowedOrigin = process.env.CORS_ORIGIN || "http://localhost:3000";
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin === allowedOrigin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,x-portal-user,x-portal-role");
      // Oturum-bitti imzasi CAPRAZ KOKENDE de okunabilmeli. Expose edilmezse
      // tarayici `X-Portal-Session`i istemci koduna HIC vermez ve kapi yalnizca
      // ayni-kokende calisir — yani uretimde calisip gelistirmede sessizce olur.
      res.setHeader("Access-Control-Expose-Headers", "X-Portal-Session");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  // L-03: Rate limiting
  const loginLimiter = rateLimit({
    windowMs: 60_000,     // 1 minute
    max: 10,              // 10 login attempts per IP per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: "Çok fazla giriş denemesi. 1 dakika sonra tekrar deneyin." },
  });
  app.use("/api/auth/login", loginLimiter);

  // Rate-limit anahtari: IP yerine SESSION (kullanici) bazli. Kurumsal agda binlerce kullanici
  // ayni NAT/proxy IP'sinden gelir → salt-IP limiti hepsini birlikte banlar (yanlis pozitif).
  // apiLimiter session middleware'inden ONCE calistigi icin `connect.sid` cookie'sini ham
  // header'dan okuruz (her oturum benzersiz) → kullanici basina ayri butce. Cookie yoksa
  // (login oncesi) IP'ye duser; login'in kendi limiti zaten var.
  function sessionOrIpKey(req) {
    const cookie = req.headers.cookie || "";
    const m = /connect\.sid=s%3A([^;.]+)/.exec(cookie) || /connect\.sid=([^;.]+)/.exec(cookie);
    if (m && m[1]) return `sid:${m[1].slice(0, 48)}`;
    const hdrUser = req.headers["x-portal-user"];
    if (hdrUser) return `usr:${String(hdrUser).slice(0, 64)}`;
    // IPv6-guvenli IP anahtari (express-rate-limit helper'i — ERR_ERL_KEY_GEN_IPV6 onler).
    return ipKeyGenerator(req.ip || req.socket?.remoteAddress || "unknown");
  }

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    max: parseInt(process.env.API_RATE_LIMIT_PER_MIN || "300", 10), // kullanici(oturum) basina
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: sessionOrIpKey,
    skip: (req) => req.path === "/api/health",
    message: { ok: false, error: "İstek limiti aşıldı. Lütfen bekleyin." },
  });
  app.use("/api", apiLimiter);

  // N-01: API response time logging
  app.use("/api", (req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - start;
      if (ms > 500) console.warn(`[slow] ${req.method} ${req.path} ${ms}ms`);
    });
    next();
  });

  // Hafif metrik toplayici (istek/hata/latency) — /api/metrics-lite ile okunur (Sprint 5).
  try { app.use("/api", require("./metrics.cjs").middleware); } catch { /* metrics yoksa yoksay */ }

  // L-04: Sensitive API responses must not be cached by proxies/browsers
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  // health
  app.get("/api/health", (req, res) => res.json({ ok: true, service: "api" }));

  return app;
}

module.exports = { createApp };
