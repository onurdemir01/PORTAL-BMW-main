// server/service.cjs
const express = require("express");
const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");
const compression = require("compression");

function createApp() {
  const app = express();

  // L-01: Remove Express fingerprint header
  app.disable("x-powered-by");

  // TANI (gecici): en erken noktada, kosulsuz, HER /api istegini logla — express.json,
  // CORS, rate-limit, session'dan bile ONCE. Amac: nginx'te "istemci 500 aliyor ama
  // app logunda SIFIR iz yok" seklinde tekrarlayan bir sorunu ayiklamak. Eger sorunlu
  // istek bu satirda bile GORUNMUYORSA, istegin Express'e/Node'a hic ulasmadigi (TCP
  // seviyesinde nginx-Node arasinda dustugu) kesinlesir — o zaman sorun app kodunda
  // degil, ag/nginx katmanindadir. Gorunuyorsa, sorunu daha asagi middleware'lere
  // daraltmak icin ayni desen orada da tekrarlanir. Teshis bitince kaldirilabilir.
  app.use("/api", (req, res, next) => {
    // ms hassasiyetli zaman damgasi + soketin uzak portu: bir sonraki olayda bu
    // satiri [Server] clientError logundakiyle (o da ayni damgayi kullanir) kesin
    // eslestirebilmek icin — iki log birbirine yakin gorunse de FARKLI baglantilara
    // ait olabilir (sayfa acilirken pek cok istek ayni anda gider).
    const tag = `${req.method} ${req.originalUrl} remotePort=${req.socket?.remotePort}`;
    console.log(`[REQ] ${new Date().toISOString()} ${tag}`);
    // Bu ISTEGIN soketi, yanit TAMAMLANMADAN kapanirsa/hata verirse acikca logla —
    // boylece "hangi istek nginx tarafindan yarida kesildi" sorusuna tahminle degil
    // KESIN cevap veririz (remotePort ile clientError'a birebir eslesir).
    req.socket?.once("close", () => {
      if (!res.writableEnded) console.warn(`[REQ] SOKET YANIT TAMAMLANMADAN KAPANDI: ${tag}`);
    });
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
