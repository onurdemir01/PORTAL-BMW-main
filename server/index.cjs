// server/index.cjs
//
// REQUIRED PACKAGES NOT YET IN package.json — install before running:
//   npm install compression express-rate-limit
//
// Ortam degiskenlerini yukle (herhangi bir process.env okuyan require'dan ONCE).
// Yukleme sirasi = ONCELIK sirasi (dotenv ilk-yukleneni korur, sonrakiler ezmez):
//   1) .env.<APP_ENV>  → ortam-ozel (dev/test/qa/prod) — OTORITER
//   2) .env.local      → geriye donuk yerel gelistirme override'i (varsa)
//   3) .env            → ortak/varsayilan fallback
// APP_ENV `APP_ENV` env'inden veya ilk CLI argumanindan gelir (or. `node server/index.cjs prod`).
// APP_ENV bossa davranis eskisiyle BIREBIR aynidir (geriye donuk uyum).
const path0 = require("path");
const APP_ENV = String(process.env.APP_ENV || process.argv[2] || "").trim().toLowerCase();
if (APP_ENV) {
  process.env.APP_ENV = APP_ENV;
  require("dotenv").config({ path: path0.resolve(__dirname, `../.env.${APP_ENV}`) });
}
require("dotenv").config({ path: path0.resolve(__dirname, "../.env.local") });
require("dotenv").config({ path: path0.resolve(__dirname, "../.env") });

const express = require("express");
const fs = require("fs");
const path = require("path");

// A0: yakalanmamis promise reddi / istisna GUARD'i — Express'in kendi hata-yakalama
// zincirinin (asagidaki A1) GORMEDIGI hatalar icindir: bir middleware/route disinda
// (ör. bir "fire-and-forget" async cagri, ya da bir Store callback'i) reddedilen
// bir promise. Node 15+'ta varsayilan davranis boyle bir reddi SESSIZCE surecin
// cokmesine (ve genelde hicbir sey loglanmadan) yol acabilir — nginx istemciye HTML
// hata sayfasi dondururken app logunda HICBIR IZ kalmamasinin en olasi aciklamasi budur.
// Burada sadece LOGLUYORUZ, surec sonlandirilmiyor (repo genelindeki "fail-open/devam et"
// felsefesiyle tutarli — cokup yeniden baslamak zaten mevcut watchdog'a birakilmis durumda).
process.on("unhandledRejection", (reason) => {
  console.error("[Server] Yakalanmamis promise reddi:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[Server] Yakalanmamis istisna:", err);
});

const { createApp } = require("./service.cjs");
const { initAuth } = require("./auth/index.cjs");
const { initAnsible } = require("./ansible/index.cjs");
const { initSelfService } = require("./selfservice/index.cjs");
const { initLogX } = require("./logx/index.cjs");
const { initLogXv2 } = require("./logx/v2/index.cjs");
const { initInventory } = require("./inventory/index.cjs");
const { initLinks } = require("./links/index.cjs");
const { initDutyRoster } = require("./duty-roster/index.cjs");
const { initNobetci } = require("./nobetci/index.cjs");
const { initDynatrace } = require("./dynatrace/index.cjs");
const { initInstana }   = require("./instana/index.cjs");
const { initSplunk }    = require("./splunk/index.cjs");
const { initKibana }    = require("./kibana/index.cjs");
const { initMcp }       = require("./mcp/index.cjs");
const { initAiAnalyst } = require("./ai-analyst/index.cjs");
const { setupTables } = require("./db/mssql-setup.cjs");
// PORT main() icinde, DB env-override'lari uygulandiktan SONRA cozulur (let — const degil).
let PORT = Number(process.env.PORT || 5055);

async function main() {
  // Portal tablolarini MSSQL'de olustur/migre et. Modul init'leri store cache'lerini
  // DB'den yukledigi icin BEKLENIR (await) — tablolar hazir olmadan yukleme baslamasin.
  // DB tamamen erisilemezse setupTables kendi icinde uyarip doner (boot bloklanmaz).
  try {
    await setupTables();
  } catch (e) {
    console.warn("[DB] setupTables hata:", e.message);
  }
  // Admin'in Sistem sekmesinden yaptigi kalici env override'lari (portal_env_overrides)
  // dotenv SONRASI, modul init'leri ONCESI uygula — restart'ta degisiklik kaybolmaz.
  try {
    await require("./db/env-overrides.cjs").loadEnvOverrides();
    PORT = Number(process.env.PORT || PORT);
  } catch (e) {
    console.warn("[EnvOverrides] yukleme hata:", e.message);
  }
  const app = createApp();
  // x-powered-by ve express.json global parser'i zaten service.cjs'in createApp()'inda
  // kayitli (app.disable("x-powered-by") + express.json({limit:"2mb"})) — burada TEKRAR
  // kaydetmek hem gereksiz (x-powered-by) hem OLU KOD idi: body-parser bir kez tuketilen
  // stream'i tekrar okumadigi icin buradaki (eskiden 5mb) limit HICBIR ZAMAN devreye
  // girmiyordu, gercek limit her zaman service.cjs'teki 2mb'di (kurumsal AI kod incelemesi,
  // review.md #7 — dogrulandi, hicbir route 2mb'yi asan govde talep etmiyor; duty-roster
  // import zaten kendi route-seviyesi 2mb limitini tasiyor).
  //
  // Prod'da nginx arkasinda calisir — X-Forwarded-* header'larina guven (secure cookie ve
  // dogru client IP icin gerekli). Tek-hop, ayni-host topoloji (bkz. deploy/BMW_Portal-D.conf:
  // nginx 10.151.162.147:443 → 127.0.0.1:3000/10.151.162.147:3000) topolojik olarak `1`
  // (tek-hop guven) ile de yanlis degildi, ama IP-pinli hale getirmek Node'a nginx'i atlayan
  // bir istek gelme ihtimaline karsi savunma-derinligi saglar (review.md #1).
  app.set("trust proxy", "loopback, 10.151.162.147");

  // Her initX(app) kendi try/catch'i ile izole edilir — eskiden yalniz initMetrics/
  // initPortalAudit korunuyordu, digerlerinin (13+) beklenmedik hatasi butun main() zincirini
  // durduruyordu (kurumsal AI kod incelemesi, review.md #9). auth HARIC hepsi "optional":
  // auth basarisiz olursa oturum/yetki temeli olmadan hicbir route guvenli calismaz, bu
  // yuzden fatal kalir; digerleri (dynatrace/instana/splunk/kibana gibi harici entegrasyonlar
  // dahil) basarisiz olursa uygulamanin geri kalani acilmaya devam eder.
  const modules = [
    { name: "auth", init: () => initAuth(app), optional: false },
    { name: "dutyRoster", init: () => initDutyRoster(app), optional: true },
    { name: "nobetci", init: () => initNobetci(app), optional: true },
    { name: "systemConfig", init: () => require("./admin/system-config.cjs").initSystemConfig(app), optional: true },
    {
      name: "branding",
      init: () => {
        const b = require("./admin/branding.cjs");
        b.initBranding(app);
        // Favicon surumunu acilista BIR KEZ isit. Yapilmazsa ilk sayfa yuklemesi
        // varsayilanin surumunu gomer, ikinci yukleme gercek surume gecer - ve o
        // gecis tam da onlemeye calistigimiz "ikon degisti" anini bir kez daha
        // yasatirdi. Basarisiz olursa sessizce varsayilanla devam edilir.
        b.warmFavicon().catch(() => {});
      },
      optional: true,
    },
    { name: "dbFullBackup", init: () => require("./db/full-backup.cjs").initDbFullBackup(app), optional: true },
    { name: "ansible", init: () => initAnsible(app), optional: true },
    { name: "selfService", init: () => initSelfService(app), optional: true },
    { name: "logX", init: () => initLogX(app), optional: true },
    { name: "logXv2", init: () => initLogXv2(app), optional: true },
    { name: "opsX", init: () => require("./opsx/index.cjs").initOpsX(app), optional: true },
    { name: "fileX", init: () => require("./filex/index.cjs").initFileX(app), optional: true },
    { name: "telnet", init: () => require("./telnet/index.cjs").initTelnet(app), optional: true },
    { name: "chaos", init: () => require("./chaos/index.cjs").initChaos(app), optional: true },
    { name: "inventory", init: () => initInventory(app), optional: true },
    { name: "links", init: () => initLinks(app), optional: true },
    { name: "dynatrace", init: () => initDynatrace(app), optional: true },
    { name: "instana", init: () => initInstana(app), optional: true },
    { name: "splunk", init: () => initSplunk(app), optional: true },
    { name: "kibana", init: () => initKibana(app), optional: true },
    { name: "mcp", init: () => initMcp(app), optional: true },
    { name: "aiAnalyst", init: () => initAiAnalyst(app), optional: true },
    { name: "metrics", init: () => require("./metrics.cjs").initMetrics(app), optional: true },
    { name: "portalAudit", init: () => require("./audit/index.cjs").initPortalAudit(app), optional: true },
    { name: "denetim", init: () => require("./audit/denetim.cjs").initDenetim(app), optional: true },
  ];
  for (const { name, init, optional } of modules) {
    try {
      await init();
    } catch (e) {
      if (!optional) throw e;
      console.warn(`[Server] ${name} baslatilamadi (atlandi):`, e.message);
    }
  }

  // A1: /api/* icin JSON 404 — eslesen route yoksa Express'in varsayilan HTML
  // "Cannot GET ..." govdesi yerine tutarli JSON doner (frontend'in safeJson
  // yardimcisi bunu guvenle parse edebilir). Tum modul route'larindan SONRA,
  // static/SPA fallback'ten ONCE kayitli — yalniz /api altinda eslesmeyenleri yakalar.
  app.use("/api", (req, res) => {
    res.status(404).json({ ok: false, error: "Not Found" });
  });

  /* ===================== STATIC (production) ===================== */
  // Prod'da frontend build'i (dist/) app tarafindan da servis edilebilir —
  // minimal topolojide (nginx'siz) tek basina calisir; nginx'li topolojide nginx
  // statigi kendisi servis eder, bu blok sadece yedek olarak kalir.
  // Tum /api route'larindan SONRA kayitli oldugu icin API'yi golgelemez.
  if (process.env.NODE_ENV === "production") {
    const distDir = path.join(__dirname, "../dist");
    if (fs.existsSync(path.join(distDir, "index.html"))) {
      // index.html DOGRUDAN gonderilmez: sekme ikonunun adresine icerige bagli bir
      // surum (?v=<hash>) enjekte edilir. Sabit adres, tarayicinin ONCEKI ikonu
      // onbellekten boyayip sonra degistirmesine yol aciyordu - acilista bir an
      // gomulu varsayilan (kirmizi "B") gorunuyordu. Surumlu adres degismedikce
      // tarayici hic istek atmaz, dolayisiyla degisecek bir goruntu de olusmaz.
      const indexPath = path.join(distDir, "index.html");
      let indexRaw = null;

      // ── TEMA TERCIHI ONBELLEGI ───────────────────────────────────────────────
      // ILK YAZIMDA GOZDEN KACAN MALIYET: tema tercihi HER HTML istegi icin DB'den
      // okunuyordu. Bu route SPA yedegidir (`/api/` disindaki TUM yollar) — yani her
      // derin baglanti, her yenileme, her sekme acilisi bir SELECT demekti. Islevsel
      // olarak dogruydu ama ilk bayta gereksiz gecikme ve DB'ye gereksiz yuk ekliyordu.
      //
      // Kullanici basina kisa omurlu bir onbellek yeterli: tema tercihi nadiren
      // degisir ve degistiginde istemci ZATEN kendi uyguluyor (localStorage + DOM),
      // yani onbellegin bayat kalmasinin tek sonucu "bir sonraki TAM SAYFA
      // yuklemesinde eski tema bir an gorunebilir" olurdu — TTL bunu 30 sn'ye
      // sinirlar. Tercih yazildiginda ayrica ACIKCA dusurulur (bkz. auth/index.cjs).
      const THEME_CACHE_TTL_MS = 30_000;
      const themeCache = new Map();   // username -> { value, at }

      async function readThemePrefCached(username) {
        const key = String(username).toLowerCase();
        const hit = themeCache.get(key);
        if (hit && Date.now() - hit.at < THEME_CACHE_TTL_MS) return hit.value;
        let value = null;
        try {
          const prefs = await require("./auth/users.cjs").getPrefs(username);
          const t = prefs["bmw-theme"];
          value = t === "light" || t === "dark" ? t : null;
        } catch {
          /* tercih okunamadi — istemci localStorage/OS tercihine duser */
          return null;   // BASARISIZLIGI ONBELLEKLEME: gecici bir DB hatasi 30 sn boyunca
                         // tercihi "yok" saydirmasin.
        }
        // Sinirsiz buyume olmasin (uzun omurlu surecte binlerce kullanici).
        if (themeCache.size > 500) themeCache.clear();
        themeCache.set(key, { value, at: Date.now() });
        return value;
      }
      // Tercih yazma yolu bunu dusurebilsin diye disari acilir.
      app.locals.invalidateThemePref = (u) => themeCache.delete(String(u || "").toLowerCase());

      // ── ACILIS DURUMU ILK HTML'E GOMULUR (2026-08-28) ────────────────────────
      // Favicon icin zaten uygulanan "surumu HTML'e goem" fikri iki yere daha
      // tasindi, cunku ayni sinif hatayi uretiyorlardi:
      //
      //   * TEMA: kullanicinin sunucudaki tercihi ancak /api/auth/prefs yaniti
      //     gelince uygulaniyordu. Baska bir tarayicidan giren kullanici sayfayi
      //     ONCE yanlis temada goruyor, sonra ekran komple TEMA DEGISTIRIYORDU.
      //   * LOGO: PortalLogo.tsx once GOMULU kirmizi BMW SVG'sini cizip
      //     /api/branding/meta yaniti gelince yuklenen logoyla degistiriyordu —
      //     ozel logo yuklemis her kurulumda her acilista gorunur bir flas.
      //
      // Ikisi de artik ILK boyamada dogru. Tema tercihi oturum sahibinin kaydidir;
      // oturum yoksa (giris ekrani) hic sorgulanmaz.
      const escapeForScript = (json) =>
        // </script> ve HTML yorum acilislari script blogunu erken kapatabilir.
        json.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");

      const sendIndexHtml = async (req, res) => {
        try {
          if (indexRaw === null) indexRaw = fs.readFileSync(indexPath, "utf-8");
          const branding = require("./admin/branding.cjs");
          const v = branding.faviconVersion();
          let html = indexRaw.replace(
            'href="/api/branding/favicon"',
            `href="/api/branding/favicon?v=${encodeURIComponent(v)}"`
          );

          const boot = {};
          const logo = branding.logoState();
          if (logo && logo.hasLogo) {
            // Surumlu adres: icerik degismedikce tarayici HIC istek atmaz, dolayisiyla
            // boyanacak eski/yeni ikili de olusmaz (favicon ile ayni gerekce).
            boot.logoUrl = `/api/branding/logo?v=${encodeURIComponent(logo.version)}`;
          } else {
            boot.logoUrl = null;   // acikca "gomulu varsayilani ciz" — istek bekleme
          }

          const username = req.session?.user?.username;
          if (username) {
            const t = await readThemePrefCached(username);
            if (t === "light" || t === "dark") boot.theme = t;
          }

          html = html.replace(
            "window.__BMW_BOOT__ = {};",
            `window.__BMW_BOOT__ = ${escapeForScript(JSON.stringify(boot))};`
          );

          // HTML'in KENDISI onbeleklenmemeli: surum degistiginde kullanicinin
          // yeni adresi gorebilmesi buna bagli. Ustelik artik KULLANICIYA OZEL
          // (tema tercihi) — paylasimli bir ara onbellege dusmesi yanlis olurdu.
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("Vary", "Cookie");
          res.type("html").send(html);
        } catch (e) {
          console.warn("[Server] index.html surumlenemedi, ham dosya gonderiliyor:", e.message);
          res.sendFile(indexPath);
        }
      };

      // Statikten ONCE: "/" ve "/index.html" surumlu halden gecsin.
      app.get(["/", "/index.html"], sendIndexHtml);

      // Hash'li asset dosyalari degismez — agresif cache. index:false, "/" istegini
      // yukaridaki handler'a birakmak icin.
      app.use(express.static(distDir, {
        maxAge: "1y",
        immutable: true,
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith("index.html")) {
            res.setHeader("Cache-Control", "no-cache");
          }
        },
      }));
      // SPA fallback: /api disi tum GET'ler index.html'e (client-side routing)
      app.get(/^\/(?!api\/).*/, sendIndexHtml);
      console.log("[Server] production static serving aktif (dist/)");
    } else {
      console.warn("[Server] NODE_ENV=production ama dist/index.html yok — once `npm run build` calistirin.");
    }
  }

  // A1: global Express hata-yakalama middleware — HER route/middleware zincirinde
  // (sync throw veya next(err) ile) kacan bir hata artik HTML stack-trace/Vite-shell
  // DEGIL, JSON doner. Repo genelinde boyle bir (err, req, res, next) middleware'i
  // daha once yoktu (HAR kaniti: /api/ansible/ss/items 500'de istemci Vite dev-sunucu
  // proxy'sinin index.html govdesini almisti — istek Express'e hic ulasmamisti; ama
  // gercek bir route-ici uncaught hatasi ayni sekilde HTML sizdirabilirdi, bu artik
  // engellenir). Tum route'lardan SONRA kayitlidir (Express hata-middleware kurali).
  app.use((err, req, res, next) => {
    console.error(`[Server] ${req.method} ${req.originalUrl} hata:`, err);
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ ok: false, error: "Sunucu hatası", detail: err.message });
  });

  /* ===================== LISTEN ===================== */
  const server = app.listen(PORT, () => {
    const envLabel = APP_ENV || "(APP_ENV yok — .env.local/.env)";
    console.log(`[Server] listening on :${PORT}  ·  ortam=${envLabel}  ·  NODE_ENV=${process.env.NODE_ENV || "(unset)"}`);
  });

  // Node'un varsayilan keepAliveTimeout'u (5s) nginx'in upstream keep-alive suresinden
  // KISA olabilir — bu durumda nginx bir soketi hala acik sanip uzerinden yeni istek
  // gonderirken Node tam o an kapatmaya karar vermisse, istek Express'e hic ulasmadan
  // baglanti duser. Bu host'ta yasanan asil 500 sorunu baska bir yerde (bkz. AnsiblePage.tsx
  // addToSelfService — sort_order icin Date.now() kullanimi, INT32 tasmasi) bulundu, yani
  // BU olayin sebebi degildi — ama bu ayar genel iyi pratik oldugu ve zarari olmadigi icin
  // korunuyor (nginx'in olasi upstream timeout'undan BUYUK: 310s; headersTimeout Node'un
  // kendi kuralinca bundan buyuk olmak zorunda).
  server.keepAliveTimeout = 310_000;
  server.headersTimeout = 311_000;

  // 'clientError', Express'in hicbir zaman goremeyecegi bir olaydir — soket/HTTP-parse
  // seviyesinde (ör. ECONNRESET, bozuk istek satiri) olusur, 'request' event'i hic
  // tetiklenmeden. Dusuk gurultulu (yalniz gercek baglanti hatalarinda tetiklenir) ve
  // ileride benzer bir "istemci 500 aliyor, uygulama logunda hicbir iz yok" tekrarinda
  // hizli teshis saglar diye kalici olarak tutuluyor.
  server.on("clientError", (err, socket) => {
    console.error(
      `[Server] clientError remotePort=${socket?.remotePort} ` +
      `(Express'e ulasmadan, soket seviyesinde):`, err.code || err.message
    );
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });
}

main().catch((e) => {
  console.error("[Server] baslatma hatasi:", e);
  process.exit(1);
});
