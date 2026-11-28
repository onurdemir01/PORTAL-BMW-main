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
const path0 = require('path');
const APP_ENV = String(process.env.APP_ENV || process.argv[2] || '')
  .trim()
  .toLowerCase();
if (APP_ENV) {
  process.env.APP_ENV = APP_ENV;
  require('dotenv').config({ path: path0.resolve(__dirname, `../.env.${APP_ENV}`) });
}
require('dotenv').config({ path: path0.resolve(__dirname, '../.env.local') });
require('dotenv').config({ path: path0.resolve(__dirname, '../.env') });

// SUREC ICI LOG ROTASYONU — dotenv'den HEMEN SONRA, her seyden ONCE.
//
// Yukaridaki dotenv siralamasinin ardindan kurulur cunku `LOG_DIR`/`LOG_MAX_BYTES`
// gibi ayarlar `.env` dosyalarindan gelir. Bundan SONRAKI her `console.*` cagrisi
// (348 tanesi) rotasyonlu dosyaya da yazilir; oncekiler yalnizca stdout'a gider ve
// `deploy/run.sh`in `<env>.out` dosyasinda kalir.
//
// NEDEN BURADA: rotasyon eskiden yalnizca surec BASLARKEN calisiyordu (`run.sh`
// icinde bir kabuk fonksiyonu) ve haftalarca ayakta kalan bir prod sureci log
// dosyasini sinirsiz buyutuyordu. Kabuktan cozulemez: fd'yi surec tutar, disaridan
// `mv` yapmak surecin yazdigi inode'u degistirmez.
//
// KURULUM BASARISIZ OLURSA UYGULAMA YINE ACILIR: modul kendini kapatir, bir kez
// uyarir ve `console.*` dokunulmamis kalir. Log kaybi, hizmet kaybindan iyidir.
require('./log.cjs').install({ root: path0.resolve(__dirname, '..'), envName: APP_ENV });

// KURUM AYARI (2026-11-20): kurumun sunucu / cluster listeleri ve varsayilan istekci kod disinda
// (server/util/kurum-ayari.cjs, KURUM_AYAR_DOSYASI; PORTAL_DEFAULT_REQUESTER_EMAIL). Eksikse uygulama
// acilir ama nginx / OCP / Crypto Hub listeleri bos kalir: bunu acilista acikca soyle (ekranda da bant).
{
  const { hata } = require('./util/kurum-ayari.cjs').kurumAyari();
  if (hata)
    console.error(
      `[kurum-ayari] ${hata}: nginx, OCP ve Crypto Hub listeleri BOS (deploy/kurum-ayari.ornek.json bicimi).`,
    );
  if (!String(process.env.PORTAL_DEFAULT_REQUESTER_EMAIL || '').trim())
    console.warn(
      '[kurum-ayari] PORTAL_DEFAULT_REQUESTER_EMAIL tanimli degil: tetikleyicisi bilinmeyen isin bildirim adresi bos gider.',
    );
}

// YAMASIZ NODE ICIN TELAFI KORUMALARI (2026-10-23) — log kurulumundan HEMEN sonra, diger
// moduller yuklenmeden ONCE: `undici.fetch`i sonradan okuyan modul sarilmis halini alir.
// Yalniz calisan surum guvenlik tabaninin altindaysa kurulur (bkz. node-guvenlik.cjs).
const { nodeGuvenlikDurumu, telafiKorumalariniKur } = require('./node-guvenlik.cjs');
const TELAFI = telafiKorumalariniKur();

const path = require('path');
const { resolveTrustProxy, globalErrorMiddleware } = require('./util/guvenlik-yardimci.cjs');

// A0: yakalanmamis promise reddi / istisna GUARD'i — Express'in kendi hata-yakalama
// zincirinin (asagidaki A1) GORMEDIGI hatalar icindir: bir middleware/route disinda
// (or. bir "fire-and-forget" async cagri, ya da bir Store callback'i) reddedilen
// bir promise. Node 15+'ta varsayilan davranis boyle bir reddi SESSIZCE surecin
// cokmesine (ve genelde hicbir sey loglanmadan) yol acabilir — nginx istemciye HTML
// hata sayfasi dondururken app logunda HICBIR IZ kalmamasinin en olasi aciklamasi budur.
// Burada sadece LOGLUYORUZ, surec sonlandirilmiyor (repo genelindeki "fail-open/devam et"
// felsefesiyle tutarli — cokup yeniden baslamak zaten mevcut watchdog'a birakilmis durumda).
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Yakalanmamis promise reddi:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Server] Yakalanmamis istisna:', err);
});

const { createApp } = require('./service.cjs');
const { initAuth } = require('./auth/index.cjs');
const { initAnsible } = require('./ansible/index.cjs');
const { initSelfService } = require('./selfservice/index.cjs');
const { initLogX } = require('./logx/index.cjs');
const { initLogXv2 } = require('./logx/v2/index.cjs');
const { initInventory } = require('./inventory/index.cjs');
const { initLinks } = require('./links/index.cjs');
const { initDutyRoster } = require('./duty-roster/index.cjs');
const { initNobetci } = require('./nobetci/index.cjs');
const { initDynatrace } = require('./dynatrace/index.cjs');
const { initInstana } = require('./instana/index.cjs');
const { initSplunk } = require('./splunk/index.cjs');
const { initKibana } = require('./kibana/index.cjs');
const { initMcp } = require('./mcp/index.cjs');
const { initAiAnalyst } = require('./ai-analyst/index.cjs');
const { setupTables } = require('./db/mssql-setup.cjs');
const { statikVarliklariKur, spaSunumunuKur } = require('./spa-sunum.cjs');
// PORT main() icinde, DB env-override'lari uygulandiktan SONRA cozulur (let — const degil).
let PORT = Number(process.env.PORT || 5055);

async function main() {
  // Portal tablolarini MSSQL'de olustur/migre et. Modul init'leri store cache'lerini
  // DB'den yukledigi icin BEKLENIR (await) — tablolar hazir olmadan yukleme baslamasin.
  // DB tamamen erisilemezse setupTables kendi icinde uyarip doner (boot bloklanmaz).
  try {
    await setupTables();
  } catch (e) {
    console.warn('[DB] setupTables hata:', e.message);
  }
  // Admin'in Sistem sekmesinden yaptigi kalici env override'lari (portal_env_overrides)
  // dotenv SONRASI, modul init'leri ONCESI uygula — restart'ta degisiklik kaybolmaz.
  try {
    await require('./db/env-overrides.cjs').loadEnvOverrides();
    PORT = Number(process.env.PORT || PORT);
  } catch (e) {
    console.warn('[EnvOverrides] yukleme hata:', e.message);
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
  // Prod'da nginx arkasinda calisir - X-Forwarded-* header'larina guven (secure cookie ve
  // dogru client IP icin gerekli). Sabit ic IP kaynak kodda tutulmaz; TRUST_PROXY env
  // uzerinden yapilandirilir. Tanimsizsa uretimde TEK ATLAMA (1), gelistirmede 'loopback':
  // nginx Node'a makinenin loopback OLMAYAN adresinden baglanir; 'loopback' varsayilani
  // uretimde oturum cerezinin hic verilmemesi demekti (server/util/guvenlik-yardimci.cjs).
  app.set('trust proxy', resolveTrustProxy(process.env.TRUST_PROXY).deger);
  if (process.env.NODE_ENV === 'production' && !String(process.env.TRUST_PROXY || '').trim()) {
    console.warn(
      "[Guvenlik] TRUST_PROXY tanimli degil: tek atlama (1) varsayiliyor. nginx'i atlayan " +
        'isteklere karsi ters vekil adresini TRUST_PROXY ile sabitleyin (.env.example).',
    );
  }

  // Her initX(app) kendi try/catch'i ile izole edilir — eskiden yalniz initMetrics/
  // initPortalAudit korunuyordu, digerlerinin (13+) beklenmedik hatasi butun main() zincirini
  // durduruyordu (kurumsal AI kod incelemesi, review.md #9). auth HARIC hepsi "optional":
  // auth basarisiz olursa oturum/yetki temeli olmadan hicbir route guvenli calismaz, bu
  // yuzden fatal kalir; digerleri (dynatrace/instana/splunk/kibana gibi harici entegrasyonlar
  // dahil) basarisiz olursa uygulamanin geri kalani acilmaya devam eder.

  /* ============ STATIK VARLIKLAR (production) - OTURUMDAN ONCE ============ */
  // Hash'li chunk/font istekleri oturum katmanindan gecmez (her dosya icin portal_sessions
  // SELECT + lastSeen guncellemesi olurdu). Yalniz duz dosya servisi burada; surumlu index.html,
  // 404 bekcisi ve SPA fallback asagida, oturumdan SONRA (server/spa-sunum.cjs).
  const distDir = path.join(__dirname, '../dist');
  const prodDist = statikVarliklariKur(app, {
    distDir,
    uretim: process.env.NODE_ENV === 'production',
  });

  const modules = [
    { name: 'auth', init: () => initAuth(app), optional: false },
    { name: 'dutyRoster', init: () => initDutyRoster(app), optional: true },
    { name: 'nobetci', init: () => initNobetci(app), optional: true },
    {
      name: 'systemConfig',
      init: () => require('./admin/system-config.cjs').initSystemConfig(app),
      optional: true,
    },
    {
      name: 'kurumAyari',
      init: () => require('./admin/kurum-ayari-duzenle.cjs').initKurumAyariDuzenle(app),
      optional: true,
    },
    {
      name: 'branding',
      init: () => {
        const b = require('./admin/branding.cjs');
        b.initBranding(app);
        // Favicon surumunu acilista BIR KEZ isit. Yapilmazsa ilk sayfa yuklemesi
        // varsayilanin surumunu gomer, ikinci yukleme gercek surume gecer - ve o
        // gecis tam da onlemeye calistigimiz "ikon degisti" anini bir kez daha
        // yasatirdi. Basarisiz olursa sessizce varsayilanla devam edilir.
        b.warmFavicon().catch(() => {});
      },
      optional: true,
    },
    {
      name: 'dbFullBackup',
      init: () => require('./db/full-backup.cjs').initDbFullBackup(app),
      optional: true,
    },
    {
      // Doluluk gozlemi + Teams esik uyarisi + logx_v2 gece temizligi (2026-09-18)
      name: 'dbHousekeeping',
      init: () => require('./db/housekeeping.cjs').initDbHousekeeping(app),
      optional: true,
    },
    { name: 'ansible', init: () => initAnsible(app), optional: true },
    { name: 'selfService', init: () => initSelfService(app), optional: true },
    { name: 'logX', init: () => initLogX(app), optional: true },
    { name: 'logXv2', init: () => initLogXv2(app), optional: true },
    { name: 'opsX', init: () => require('./opsx/index.cjs').initOpsX(app), optional: true },
    {
      name: 'nginxConsole',
      init: () => require('./nginx-console/index.cjs').initNginxConsole(app),
      optional: true,
    },
    {
      name: 'serverHub',
      init: () => require('./server-hub/index.cjs').initServerHub(app),
      optional: true,
    },
    {
      // Server Hub > Uygulama Envanteri (2026-11-04): kosu yurutucusu (parti baslatma, /sw alimi,
      // haftalik zamanlayici, saklama). Uclar serverHub router'inda; launch oradan verilir.
      name: 'earEnvanter',
      init: () => require('./server-hub/ear-envanter-poller.cjs').startPoller(),
      optional: true,
    },
    {
      // Server Hub > Toplu Auto-Start (2026-11-14): plan / uygulama yurutucusu (host basina tek is, sirayla).
      // Uclar serverHub router'inda; launch oradan verilir. Kirasi dusmus is DEVAM ETTIRILMEZ (YARIM_KALDI).
      name: 'topluAutoStart',
      init: () => require('./server-hub/toplu-autostart.cjs').startPoller(),
      optional: true,
    },
    {
      // Server Hub > EAR Temizligi (2026-11-16): silme kuyrugu yurutucusu (sunucu basina tek silme; onaylanan
      // toplu silmeler sekme kapansa da siradan baslar). Uclar serverHub router'inda; launch oradan verilir.
      name: 'earTemizlik',
      init: () => require('./server-hub/ear-temizlik.cjs').startPoller(),
      optional: true,
    },
    {
      // Server Hub > Reboot Kontrolu (2026-11-17): AWX'te (workflow ya da elle) kosan reboot_check islerini Portal'a alir
      // (reboot-check-awx.cjs). Portal'in kendi baslattigi is atlanir.
      name: 'rebootCheckAwx',
      init: () => require('./server-hub/reboot-check-awx.cjs').startPoller(),
      optional: true,
    },
    {
      // Application Hub (2026-11-18): saatlik OpenShift filo taramasi (filo-poller.cjs). Sablon tanimli degilse bekler.
      name: 'appHubFilo',
      init: () => require('./app-hub/filo-poller.cjs').startPoller(),
      optional: true,
    },
    {
      // Server Hub > Toplu Restart (2026-11-14): onizleme / tek tek restart / dogrulama taramasi yurutucusu.
      // Uclar serverHub router'inda. Kirasi dusmus is DEVAM ETTIRILMEZ (YARIM_KALDI).
      name: 'topluRestart',
      init: () => require('./server-hub/toplu-restart.cjs').startPoller(),
      optional: true,
    },
    {
      name: 'cryptoHub',
      init: () => require('./crypto-hub/index.cjs').initCryptoHub(app),
      optional: true,
    },
    { name: 'bmwHub', init: () => require('./bmw-hub/index.cjs').initBmwHub(app), optional: true },
    { name: 'appHub', init: () => require('./app-hub/index.cjs').initAppHub(app), optional: true },
    { name: 'oco', init: () => require('./oco/index.cjs').initOco(app), optional: true },
    {
      name: 'spa-report',
      init: () => require('./spa-report/index.cjs').initSpaReport(app),
      optional: true,
    },
    {
      name: 'nginxCis',
      init: () => require('./nginx-cis/index.cjs').initNginxCis(app),
      optional: true,
    },
    {
      // Nginx Hub > Yuk Testi (2026-10-27): ayri router /api/nginx-loadtest + sonuclandirici poller.
      name: 'nginxLoadtest',
      init: () => require('./nginx-loadtest/index.cjs').initNginxLoadtest(app),
      optional: true,
    },
    {
      name: 'retirement',
      init: () => require('./retirement/index.cjs').initRetirement(app),
      optional: true,
    },
    { name: 'fileX', init: () => require('./filex/index.cjs').initFileX(app), optional: true },
    { name: 'telnet', init: () => require('./telnet/index.cjs').initTelnet(app), optional: true },
    { name: 'scalex', init: () => require('./scalex/index.cjs').initScaleX(app), optional: true },
    { name: 'inventory', init: () => initInventory(app), optional: true },
    { name: 'links', init: () => initLinks(app), optional: true },
    { name: 'dynatrace', init: () => initDynatrace(app), optional: true },
    { name: 'instana', init: () => initInstana(app), optional: true },
    { name: 'splunk', init: () => initSplunk(app), optional: true },
    { name: 'kibana', init: () => initKibana(app), optional: true },
    { name: 'mcp', init: () => initMcp(app), optional: true },
    { name: 'aiAnalyst', init: () => initAiAnalyst(app), optional: true },
    { name: 'metrics', init: () => require('./metrics.cjs').initMetrics(app), optional: true },
    {
      name: 'portalAudit',
      init: () => require('./audit/index.cjs').initPortalAudit(app),
      optional: true,
    },
    {
      name: 'denetim',
      init: () => require('./audit/denetim.cjs').initDenetim(app),
      optional: true,
    },
    {
      name: 'nginxExpose',
      init: () => require('./nginx-expose/index.cjs').initNginxExpose(app),
      optional: true,
    },
    {
      name: 'nginxMigration',
      init: () => require('./nginx-migration/index.cjs').initNginxMigration(app),
      optional: true,
    },
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
  app.use('/api', (req, res) => {
    res.status(404).json({ ok: false, error: 'Not Found' });
  });

  /* ===================== STATIC (production) ===================== */
  // Prod'da frontend build'i (dist/) app tarafindan da servis edilebilir (nginx'siz minimal
  // topoloji). Tum /api rotalarindan SONRA kayitli: API'yi golgelemez (server/spa-sunum.cjs).
  if (process.env.NODE_ENV === 'production') spaSunumunuKur(app, { distDir, prodDist });

  // A1: global Express hata-yakalama middleware — HER route/middleware zincirinde
  // (sync throw veya next(err) ile) kacan bir hata artik HTML stack-trace/Vite-shell
  // DEGIL, JSON doner. Repo genelinde boyle bir (err, req, res, next) middleware'i
  // daha once yoktu (HAR kaniti: /api/ansible/ss/items 500'de istemci Vite dev-sunucu
  // proxy'sinin index.html govdesini almisti — istek Express'e hic ulasmamisti; ama
  // gercek bir route-ici uncaught hatasi ayni sekilde HTML sizdirabilirdi, bu artik
  // engellenir). Tum route'lardan SONRA kayitlidir (Express hata-middleware kurali).
  app.use(globalErrorMiddleware());

  /* ===================== LISTEN ===================== */
  const server = app.listen(PORT, () => {
    const envLabel = APP_ENV || '(APP_ENV yok — .env.local/.env)';
    console.log(
      `[Server] listening on :${PORT}  ·  ortam=${envLabel}  ·  NODE_ENV=${process.env.NODE_ENV || '(unset)'}  ·  node=${process.version}`,
    );
    // Calisan Node guvenlik tabaninin altindaysa tek satir uyari (davranis degismez).
    const nodeDurumu = nodeGuvenlikDurumu();
    if (!nodeDurumu.ok) console.warn(`[Guvenlik] ${nodeDurumu.mesaj}`);
    if (TELAFI.length)
      console.warn(
        `[Guvenlik] Yamasiz Node icin telafi korumalari devrede: ${TELAFI.join(', ')} ` +
          '(giden Brotli yaniti reddi, NUL bayti olan konak adi reddi). TLS kimlik dogrulamasi ' +
          'duzeltmeleri yalniz Node yukseltmesiyle gelir.',
      );
  });

  // ── BELLEK NABZI — "OOM kapandi mi?" sorusunu OLCULEBILIR yapar ────────────
  //
  // 2026-09-19'da uretimde 7 OOM yasandi (`FATAL ERROR: Reached heap limit`).
  // Duzeltmeler yazildi, AMA elimizdeki loglar duzeltmelerden ONCE bitiyor:
  // "kapandi" diyebilmek icin tek bir veri noktasi bile yok. Daha kotusu,
  // yapilandirilmis logger cokmeyi HIC gormuyor — surec V8 ile birlikte oluyor
  // ve `FATAL ERROR` yalnizca stdout'a dusuyor. Yalnizca app.log'a bakan biri
  // "cokme yok" der ve yanilir.
  //
  // Bu satir dakikada bir heap'i yaziyor. Bir sonraki log turunda:
  //   - heap zamanla tirmaniyorsa SIZINTI,
  //   - aniden zirve yapip kayboluyorsa TEK BIR ISTEK 2 GB yiyor (bugunku desen),
  //   - duz gidiyorsa duzeltmeler TUTMUS.
  // Ucunu de ayirt edecek veri bugun YOK; bu satir onu uretir.
  const HEAP_NABIZ_MS = 60000;
  const _heapNabiz = setInterval(() => {
    const m = process.memoryUsage();
    const mb = (n) => Math.round(n / (1024 * 1024));
    console.log(
      `[Server] heap=${mb(m.heapUsed)}/${mb(m.heapTotal)}MB rss=${mb(m.rss)}MB ` +
        `ext=${mb(m.external)}MB uptime=${Math.round(process.uptime())}s`,
    );
  }, HEAP_NABIZ_MS);
  // `unref()`: bu zamanlayici surecin kapanmasini ENGELLEMEZ — aksi halde
  // dagitim sirasinda portal bir dakika gec kapanirdi.
  _heapNabiz.unref();

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
  // seviyesinde (or. ECONNRESET, bozuk istek satiri) olusur, 'request' event'i hic
  // tetiklenmeden. Dusuk gurultulu (yalniz gercek baglanti hatalarinda tetiklenir) ve
  // ileride benzer bir "istemci 500 aliyor, uygulama logunda hicbir iz yok" tekrarinda
  // hizli teshis saglar diye kalici olarak tutuluyor.
  server.on('clientError', (err, socket) => {
    console.error(
      `[Server] clientError remotePort=${socket?.remotePort} ` +
        `(Express'e ulasmadan, soket seviyesinde):`,
      err.code || err.message,
    );
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
}

main().catch((e) => {
  console.error('[Server] baslatma hatasi:', e);
  process.exit(1);
});
