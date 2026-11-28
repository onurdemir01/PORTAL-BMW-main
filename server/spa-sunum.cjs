// server/spa-sunum.cjs — uretimde on yuz paketini (dist/) Node'un kendisinin servis etmesi.
//
// server/index.cjs'ten AYRILDI (2026-11-28, PR-2): kod aynen tasindi, davranis degismedi. Giris
// noktasi `main()`i yuklenir yuklenmez calistirir ve dist dizini sabittir; bu yuzden surumlu
// index.html, tema onbellegi ve varlik 404 bekcisi yalniz kaynak metnine bakan bekcilerle
// korunuyordu. Burada dist dizini parametre: testler gecici bir dist ile gercek express'te kosar
// (server/__tests__/spa-sunum.test.js).
//
// Iki adim; ARALARINDA oturum katmani ve tum /api rotalari kayitli olmali (sira server/index.cjs'te,
// bekci: server/__tests__/statik-oturum-oncesi.test.js):
//   1) statikVarliklariKur: duz dosya varliklari OTURUMDAN ONCE;
//   2) spaSunumunuKur: surumlu index.html, 404 bekcisi ve SPA fallback /api'den ve oturumdan SONRA.
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

// STATIK VARLIKLAR OTURUMDAN ONCE (2026-11-12). express.static'i saran kapi: oturum
// katmanindan (initAuth) ONCE kayitli oldugu icin YALNIZ duz dosya varliklarini
// (dist/assets/*, dist/fonts/*, dist_prev) servis etmeye izinlidir. Asagidakiler
// ASLA burada servis edilmez, oturumdan SONRAKI zincire birakilir (next):
//   - /api ve altindaki her sey (buyuk/kucuk harf farketmez; Express rotalari da
//     harf duyarsizdir) - API'yi golgeleyemez, her API isteginde fs stat da yapilmaz;
//   - "/" ve "/" ile biten yollar (dizin istekleri);
//   - .html/.htm ile biten her yol (cozulmus haliyle; "/%69ndex.html" dahil) -
//     index.html surumlu/kullaniciya ozel haliyle sendIndexHtml'den gitmeli.
// Yalniz GET/HEAD; cozulemeyen adres de sonraki zincire gider (eskiden de 4xx'te
// fallthrough idi).
function statikOnceKatman(statikMw) {
  return function statikOnce(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let yol;
    try {
      yol = decodeURIComponent(req.path || '');
    } catch {
      return next();
    }
    const kucuk = yol.toLowerCase();
    if (kucuk === '/api' || kucuk.startsWith('/api/')) return next();
    if (kucuk.endsWith('/')) return next();
    if (/\.html?$/.test(kucuk)) return next();
    return statikMw(req, res, next);
  };
}

/**
 * Oturumdan ONCE: dist/ (ve varsa dist_prev/) duz dosya varliklari.
 * @param {import('express').Express} app
 * @param {{ distDir: string, uretim: boolean }} secenek
 * @returns {boolean} dist kullanilabilir mi (uretim ve dist/index.html var)
 */
function statikVarliklariKur(app, { distDir, uretim }) {
  // Hash'li chunk/font istekleri eskiden express-session'dan geciyordu: her dosya icin
  // portal_sessions SELECT + lastSeen guncellemesi. Bu dosyalar herkese acik SPA
  // paketidir (dist/: assets/, fonts/, index.html - korumali icerik yok), oturum
  // gerektirmez. Yalniz duz dosya servisi buraya alinir (statikOnceKatman kapisi);
  // "/" + "/index.html" (sendIndexHtml), 404 bekcisi ve SPA fallback ASAGIDA,
  // oturumdan SONRA aynen kalir. Cache basliklari degismedi.
  const prodDist = uretim && fs.existsSync(path.join(distDir, 'index.html'));
  if (prodDist) {
    // Hash'li asset dosyalari degismez — agresif cache. index:false: "/" istegi
    // sendIndexHtml'e kalsin.
    app.use(
      statikOnceKatman(
        express.static(distDir, {
          maxAge: '1y',
          immutable: true,
          index: false,
          setHeaders: (res, filePath) => {
            if (filePath.endsWith('index.html')) {
              res.setHeader('Cache-Control', 'no-cache');
            }
          },
        }),
      ),
    );
    // ONCEKI SURUMUN DOSYALARI (2026-09-22): release sirasinda dist degisince eski hash'li
    // chunk'lar silinir; acik sekmeler onlari isteyince "Failed to fetch dynamically imported
    // module" alir. release betigi eski dizini dist_prev olarak birakirsa buradan servis edilir
    // ve kullanici hic hata gormez (istemci tarafinda ayrica otomatik yenileme var).
    const prevDir = path.join(path.dirname(distDir), 'dist_prev');
    if (fs.existsSync(prevDir)) {
      app.use(
        statikOnceKatman(express.static(prevDir, { maxAge: '1y', immutable: true, index: false })),
      );
      console.log('[Server] onceki surum dosyalari da servis ediliyor (dist_prev)');
    }
  }
  return prodDist;
}

/**
 * Tum /api rotalarindan ve oturumdan SONRA (yalniz uretimde): surumlu index.html, varlik 404
 * bekcisi ve SPA fallback. dist yoksa yalniz uyarir.
 * @param {import('express').Express} app
 * @param {{ distDir: string, prodDist: boolean }} secenek
 */
function spaSunumunuKur(app, { distDir, prodDist }) {
  // Prod'da frontend build'i (dist/) app tarafindan da servis edilebilir —
  // minimal topolojide (nginx'siz) tek basina calisir; nginx'li topolojide nginx
  // statigi kendisi servis eder, bu blok sadece yedek olarak kalir.
  // Tum /api route'larindan SONRA kayitli oldugu icin API'yi golgelemez. Duz dosya
  // varliklari (express.static) statikVarliklariKur'da, oturumdan ONCE kayitli.
  if (prodDist) {
    // index.html DOGRUDAN gonderilmez: sekme ikonunun adresine icerige bagli bir
    // surum (?v=<hash>) enjekte edilir. Sabit adres, tarayicinin ONCEKI ikonu
    // onbellekten boyayip sonra degistirmesine yol aciyordu - acilista bir an
    // gomulu varsayilan (kirmizi "B") gorunuyordu. Surumlu adres degismedikce
    // tarayici hic istek atmaz, dolayisiyla degisecek bir goruntu de olusmaz.
    const indexPath = path.join(distDir, 'index.html');
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
    const themeCache = new Map(); // username -> { value, at }

    async function readThemePrefCached(username) {
      const key = String(username).toLowerCase();
      const hit = themeCache.get(key);
      if (hit && Date.now() - hit.at < THEME_CACHE_TTL_MS) return hit.value;
      let value = null;
      try {
        const prefs = await require('./auth/users.cjs').getPrefs(username);
        const t = prefs['bmw-theme'];
        // Renk korlugu modu (2026-11-17): ayni tercih okumasindan; tema gibi ILK boyamada uygulanir.
        value = {
          theme: t === 'light' || t === 'dark' ? t : null,
          renk: prefs['bmw-renk'] === 'cvd' ? 'cvd' : null,
        };
      } catch {
        /* tercih okunamadi — istemci localStorage/OS tercihine duser */
        return null; // BASARISIZLIGI ONBELLEKLEME: gecici bir DB hatasi 30 sn boyunca
        // tercihi "yok" saydirmasin.
      }
      // Sinirsiz buyume olmasin (uzun omurlu surecte binlerce kullanici).
      if (themeCache.size > 500) themeCache.clear();
      themeCache.set(key, { value, at: Date.now() });
      return value;
    }
    // Tercih yazma yolu bunu dusurebilsin diye disari acilir.
    app.locals.invalidateThemePref = (u) => themeCache.delete(String(u || '').toLowerCase());

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
      json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

    const sendIndexHtml = async (req, res) => {
      try {
        if (indexRaw === null) indexRaw = fs.readFileSync(indexPath, 'utf-8');
        const branding = require('./admin/branding.cjs');
        const v = branding.faviconVersion();
        let html = indexRaw.replace(
          'href="/api/branding/favicon"',
          `href="/api/branding/favicon?v=${encodeURIComponent(v)}"`,
        );

        const boot = {};
        const logo = branding.logoState();
        if (logo?.hasLogo) {
          // Surumlu adres: icerik degismedikce tarayici HIC istek atmaz, dolayisiyla
          // boyanacak eski/yeni ikili de olusmaz (favicon ile ayni gerekce).
          boot.logoUrl = `/api/branding/logo?v=${encodeURIComponent(logo.version)}`;
        } else {
          boot.logoUrl = null; // acikca "gomulu varsayilani ciz" — istek bekleme
        }

        // Kurum ayari eksik / bozuksa ekran bant gosterir (sebep metni sir icermez).
        boot.kurumAyarHatasi = require('./util/kurum-ayari.cjs').kurumAyari().hata || null;

        const username = req.session?.user?.username;
        if (username) {
          const p = await readThemePrefCached(username);
          const t = p ? p.theme : null;
          if (t === 'light' || t === 'dark') boot.theme = t;
          if (p?.renk === 'cvd') boot.renk = 'cvd';
        }

        html = html.replace(
          'window.__BMW_BOOT__ = {};',
          `window.__BMW_BOOT__ = ${escapeForScript(JSON.stringify(boot))};`,
        );

        // HTML'in KENDISI onbeleklenmemeli: surum degistiginde kullanicinin
        // yeni adresi gorebilmesi buna bagli. Ustelik artik KULLANICIYA OZEL
        // (tema tercihi) — paylasimli bir ara onbellege dusmesi yanlis olurdu.
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Vary', 'Cookie');
        res.type('html').send(html);
      } catch (e) {
        console.warn('[Server] index.html surumlenemedi, ham dosya gonderiliyor:', e.message);
        res.sendFile(indexPath);
      }
    };

    // "/" ve "/index.html" surumlu halden gecsin (oturumdan SONRA: tema tercihi
    // req.session'dan okunur). Duz dosya varliklari yukarida, oturumdan ONCE.
    app.get(['/', '/index.html'], sendIndexHtml);

    // VARLIK ISTEKLERI ICIN SPA FALLBACK YOK: /assets/... ya da uzantili bir dosya bulunamazsa
    // index.html (HTML) donmek, tarayiciya "modul bekliyordum, HTML geldi" hatasi verdirir ve
    // sebebi gizler. Duz 404 doner; istemci bunu surum atlamasi sayip sayfayi yeniler.
    app.get(
      new RegExp(
        '^/(?:assets/|.*\\.(?:' +
          [
            'js',
            'mjs',
            'css',
            'map',
            'json',
            'png',
            'jpg',
            'jpeg',
            'svg',
            'gif',
            'ico',
            'woff2?',
            'ttf',
            'eot',
            'txt',
            'webmanifest',
          ].join('|') +
          ')$)',
      ),
      (req, res) => {
        res
          .status(404)
          .type('text/plain')
          .send('Not found (eski surum dosyasi olabilir; sayfayi yenileyin)');
      },
    );

    // SPA fallback: /api disi tum GET'ler index.html'e (client-side routing)
    app.get(/^\/(?!api\/).*/, sendIndexHtml);
    console.log('[Server] production static serving aktif (dist/)');
  } else {
    console.warn(
      '[Server] NODE_ENV=production ama dist/index.html yok — once `npm run build` calistirin.',
    );
  }
}

module.exports = { statikOnceKatman, statikVarliklariKur, spaSunumunuKur };
