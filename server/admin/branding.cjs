// server/admin/branding.cjs — Admin → Marka sekmesi: tarayici sekmesinde gorunen
// favicon'un VE giris/ana ekranda gorunen uygulama logosunun yuklenmesi/sunulmasi.
//
// NEDEN DB'DE SAKLANIYOR: deploy/release.sh uygulama agacini `unzip -o` ile ezer
// (bkz. release.sh:61). Diske yazilan bir logo HER DEPLOY'DA KAYBOLURDU. Gorseller bu
// yuzden portal_config_blobs tablosunda (name='branding:favicon' / 'branding:logo')
// base64 olarak tutulur — release/restart/redeploy hayatta kalir.
//
// Iki bagimsiz slot, AYNI deseni paylasir (favicon: sekme ikonu; logo: PortalLogo.tsx'in
// gosterdigi, giris ekrani + ana ekran ust bandindaki marka isareti):
//   GET    /api/branding/favicon        PUBLIC  — <link rel="icon"> bunu cagirir.
//   GET    /api/branding/logo           PUBLIC  — PortalLogo.tsx bunu dener, YOKSA (404)
//                                       kendi gomulu SVG'sine duser (giris ekrani da
//                                       kimlik dogrulamasi ONCESI gorundugu icin auth ARANMAZ).
//   GET    /api/branding/meta           PUBLIC  — hangi slotlarin ozellestirildigi (hafif,
//                                       PortalLogo'nun gereksiz 404 istegi atmasini onler).
//   GET    /api/admin/branding          Admin   — her iki logonun da ust verisi
//   PUT    /api/admin/branding/:slot    Admin   — yeni logo yukle (JSON dataUrl), slot=favicon|logo
//   DELETE /api/admin/branding/:slot    Admin   — varsayilana don
'use strict';

const express = require('express');
const crypto = require('crypto');

// SVG BILEREK DISARIDA: SVG calistirilabilir <script> icerebilir ve bu dosya
// portal ile AYNI ORIGIN'den sunulur — kullanici dogrudan gorsel adresine giderse
// script portal oturum cerezi baglaminda calisirdi (depolanmis XSS). Raster
// formatlarda bu risk yok.
// WEBP BILEREK DISARIDA: tarayicilar WebP'yi sayfa icinde destekler ama favicon
// isleme hatti AYRI bir kod yoludur ve WebP'yi guvenilir sekilde cozmez — dosya
// basariyla indirilir, sekme ikonu yine de degismez (sessiz basarisizlik). Logo
// icin de tutarlilik amaciyla ayni kisitlama uygulanir.
const ALLOWED_MIME = {
  'image/png': ['89504e47'],
  'image/x-icon': ['00000100'],
  'image/vnd.microsoft.icon': ['00000100'],
  'image/jpeg': ['ffd8ff'],
};

const SLOTS = {
  favicon: { blobName: 'branding:favicon', maxBytes: 512 * 1024 },
  logo:    { blobName: 'branding:logo',    maxBytes: 1024 * 1024 },
};

// Favicon icin: logo yuklenmemisken sunulan varsayilan. Kendi yazdigimiz sabit
// icerik (kullanici yuklemesi degil) — script icermez, XSS riski yoktur. Logo
// slotunun bunun karsiligi YOK — PortalLogo.tsx yuklenmemisse zaten kendi
// gomulu SVG'sini React icinde render eder, sunucudan ayrica bir varsayilan
// gorsel COMESI GEREKMEZ.
const DEFAULT_FAVICON_SVG = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
  `<rect width="32" height="32" rx="6" fill="#ee0000"/>` +
  `<text x="16" y="22" font-family="sans-serif" font-size="15" font-weight="700" ` +
  `fill="#ffffff" text-anchor="middle">B</text></svg>`,
  'utf-8'
);
const DEFAULT_FAVICON_ETAG = `"${crypto.createHash('sha1').update(DEFAULT_FAVICON_SVG).digest('hex').slice(0, 16)}"`;

// Bellek-ici kopya: her sekme yuklemesinde DB'ye gitmemek icin. Yukleme/silme
// aninda tazelenir; birden fazla process varsa ETag revalidation yakalar.
const cache = { favicon: null, logo: null }; // her biri: { mime, buf, etag, updatedAt, updatedBy } | null

// ── FAVICON SURUMU (sekme ikonu "yanip sonme"sini onlemek icin) ───────────────
// SORUN: index.html sabit bir adrese bakiyordu (/api/branding/favicon). Adres hic
// degismedigi icin tarayici ONCEKI baytlari onbellekte tutuyor; sayfa acilirken once
// O ESKI ikonu boyuyor, revalidation cevabi gelince yenisiyle degistiriyor. Sonuc:
// yuklenmis logo yerine bir an icin gomulu VARSAYILAN (kirmizi "B") gorunuyor.
//
// COZUM: adrese icerige bagli bir surum eklemek (?v=<hash>). Icerik degisince adres
// de degisir; degismedikce tarayici kendi kopyasini kullanir ve HIC istek atmaz -
// dolayisiyla boyanacak eski/yeni ikili de olusmaz.
//
// Surum ETag'den turetilir (ayni hash), tirnaklar URL icin atilir. Baslangic degeri
// varsayilanin surumudur; DB'den logo yuklendigi anda guncellenir.
let _faviconVersion = DEFAULT_FAVICON_ETAG.replace(/"/g, '');

function faviconVersion() {
  return _faviconVersion;
}

function setFaviconVersion(etag) {
  _faviconVersion = String(etag || DEFAULT_FAVICON_ETAG).replace(/"/g, '');
}

// Sunucu acilisinda BIR KEZ cagrilir. Olmazsa ilk sayfa yuklemesi varsayilanin
// surumunu gomer, ikinci yukleme gercek surume gecer ve o gecis tam da onlemeye
// calistigimiz degisimi bir kez daha yasatirdi.
async function warmFavicon() {
  try {
    const fav = await getSlot('favicon');
    setFaviconVersion(fav ? fav.etag : DEFAULT_FAVICON_ETAG);
  } catch {
    /* DB yoksa varsayilan surumle devam - ikon yine dogru sunulur */
  }
}

function db() {
  return require('../db/index.cjs');
}

async function loadFromDb(blobName) {
  const { rows } = await db().query(
    `SELECT data, updated_at FROM portal_config_blobs WHERE name = $1`,
    [blobName]
  );
  if (!rows.length) return null;
  let parsed;
  try {
    parsed = JSON.parse(rows[0].data);
  } catch {
    return null; // bozuk kayit — varsayilana dus
  }
  if (!parsed?.base64 || !parsed?.mime) return null;
  const buf = Buffer.from(parsed.base64, 'base64');
  return {
    mime: parsed.mime,
    buf,
    etag: `"${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}"`,
    updatedAt: rows[0].updated_at,
    updatedBy: parsed.updatedBy || null,
  };
}

async function getSlot(slot) {
  if (cache[slot]) return cache[slot];
  cache[slot] = await loadFromDb(SLOTS[slot].blobName);
  // Favicon surumu DB'den gelen ETag'e baglanir; yukleme/silme sonrasi cache
  // sifirlandigi icin bir sonraki okumada burasi tekrar calisir.
  if (slot === 'favicon') setFaviconVersion(cache[slot] ? cache[slot].etag : DEFAULT_FAVICON_ETAG);
  return cache[slot];
}

// Yuklenen baytlarin gercekten iddia edilen turde olup olmadigini dogrular —
// yalnizca Content-Type'a guvenmek, .png adiyla HTML yuklemeye izin verirdi.
function magicMatches(mime, buf) {
  const sigs = ALLOWED_MIME[mime];
  if (!sigs) return false;
  const head = buf.subarray(0, 4).toString('hex');
  return sigs.some((sig) => head.startsWith(sig));
}

function initBranding(app) {
  // ── PUBLIC: favicon sunumu ─────────────────────────────────────────────────
  app.get('/api/branding/favicon', async (req, res) => {
    let fav = null;
    try {
      fav = await getSlot('favicon');
    } catch {
      /* DB erisilemezse varsayilana dus */
    }

    if (!fav) {
      // Yuklenmis logo YOK — 404 yerine gomulu varsayilani doneriz. Fallback'i
      // index.html'de ikinci bir <link> ile yapmak, tarayicinin iki ikon arasinda
      // KENDI secim yapmasina yol acar (Chrome SVG'yi tercih edip yuklenen logoyu
      // yok sayabiliyor) — bu yuzden secim sunucuda, tek adres uzerinde yapilir.
      res.set('Content-Type', 'image/svg+xml');
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      res.set('ETag', DEFAULT_FAVICON_ETAG);
      res.set('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache, must-revalidate');
      if (req.headers['if-none-match'] === DEFAULT_FAVICON_ETAG) return res.status(304).end();
      // Kendi yazdigimiz sabit SVG — kullanici yuklemesi degil, script icermez.
      return res.send(DEFAULT_FAVICON_SVG);
    }

    // nosniff + kisitlayici CSP: dosya raster olsa bile tarayicinin icerigi
    // baska bir tur olarak yorumlamasini engeller.
    res.set('Content-Type', fav.mime);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.set('ETag', fav.etag);
    // ?v=<surum> ILE gelindiyse adres zaten icerige bagli: icerik degisirse adres de
    // degisir, dolayisiyla uzun sureli/immutable onbellek GUVENLI ve sekme ikonunun
    // her acilista yeniden istenmesini (ve eski kopyanin bir an gorunmesini) onler.
    // ?v YOKSA eski davranis korunur: onbellekte tut ama her seferinde dogrula.
    res.set('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache, must-revalidate');

    if (req.headers['if-none-match'] === fav.etag) return res.status(304).end();
    return res.send(fav.buf);
  });

  // ── PUBLIC: uygulama logosu sunumu ─────────────────────────────────────────
  // Ozellestirilmemisse ACIKCA 404 doner — PortalLogo.tsx bunu meta'dan zaten
  // ONCEDEN bilir (bkz. asagisi), bu yuzden normal akiste bu 404'e hic dusulmez;
  // yine de dogrudan URL'e gidilirse dogru HTTP anlami korunur.
  app.get('/api/branding/logo', async (req, res) => {
    let logo = null;
    try {
      logo = await getSlot('logo');
    } catch {
      /* DB erisilemezse 404'e dus */
    }
    if (!logo) return res.status(404).end();

    res.set('Content-Type', logo.mime);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.set('ETag', logo.etag);
    res.set('Cache-Control', 'no-cache, must-revalidate');
    if (req.headers['if-none-match'] === logo.etag) return res.status(304).end();
    return res.send(logo.buf);
  });

  // ── PUBLIC: hafif meta (hangi slotlar ozellestirilmis) ─────────────────────
  // PortalLogo.tsx, /api/branding/logo'ya kor kor istek atip 404 karsilanmasi
  // yerine ONCE bunu sorar — boylece varsayilan (ozellestirilmemis) durumda
  // giris/ana ekranda gereksiz bir 404 istegi + gecici "yanip sonme" olmaz.
  app.get('/api/branding/meta', async (req, res) => {
    let hasLogo = false;
    try {
      hasLogo = !!(await getSlot('logo'));
    } catch {
      /* DB erisilemezse varsayilan (gomulu SVG) kullanilir */
    }
    res.set('Cache-Control', 'no-cache, must-revalidate');
    res.json({ ok: true, hasLogo });
  });

  // ── ADMIN: mevcut durum (iki slot birden) ──────────────────────────────────
  app.get('/api/admin/branding', async (req, res) => {
    if (req.session?.user?.role !== 'Admin') return res.status(403).json({ ok: false });
    try {
      const [fav, logo] = await Promise.all([getSlot('favicon'), getSlot('logo')]);
      const toInfo = (x) => x ? {
        mime: x.mime,
        sizeBytes: x.buf.length,
        updatedAt: x.updatedAt,
        updatedBy: x.updatedBy,
        // Onizleme icin data URL — admin ekraninda gosterilir.
        dataUrl: `data:${x.mime};base64,${x.buf.toString('base64')}`,
      } : null;
      res.json({
        ok: true,
        favicon: toInfo(fav),
        logo: toInfo(logo),
        limits: {
          favicon: { maxBytes: SLOTS.favicon.maxBytes, allowedMime: Object.keys(ALLOWED_MIME).filter((m) => m !== 'image/vnd.microsoft.icon') },
          logo:    { maxBytes: SLOTS.logo.maxBytes,    allowedMime: Object.keys(ALLOWED_MIME).filter((m) => m !== 'image/vnd.microsoft.icon') },
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── ADMIN: yukleme (slot=favicon|logo) ─────────────────────────────────────
  // multer/busboy EKLENMEDI — kapali kurumsal agda yeni bagimlilik riski var.
  // Tarayici dosyayi FileReader ile data URL'e cevirip JSON gonderir; mevcut
  // express.json({limit:"2mb"}) parser'i yeterli (asil limit slot bazinda asagida dusurulur).
  app.put('/api/admin/branding/:slot', express.json({ limit: '2mb' }), async (req, res) => {
    if (req.session?.user?.role !== 'Admin') return res.status(403).json({ ok: false });
    const slot = req.params.slot;
    if (!SLOTS[slot]) return res.status(404).json({ ok: false, error: 'Bilinmeyen logo alanı.' });

    const { dataUrl } = req.body || {};
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      return res.status(400).json({ ok: false, error: 'Geçersiz görsel verisi.' });
    }

    const m = dataUrl.match(/^data:([\w/.+-]+);base64,(.+)$/);
    if (!m) return res.status(400).json({ ok: false, error: 'Görsel base64 data URL olmalı.' });

    const mime = m[1].toLowerCase();
    if (!ALLOWED_MIME[mime]) {
      return res.status(400).json({
        ok: false,
        error: 'Desteklenmeyen format. PNG (önerilen), ICO veya JPEG yükleyin. SVG güvenlik, WEBP ise tarayıcı uyumsuzluğu nedeniyle kabul edilmez.',
      });
    }

    let buf;
    try {
      buf = Buffer.from(m[2], 'base64');
    } catch {
      return res.status(400).json({ ok: false, error: 'Base64 çözülemedi.' });
    }

    if (!buf.length) return res.status(400).json({ ok: false, error: 'Dosya boş.' });
    const maxBytes = SLOTS[slot].maxBytes;
    if (buf.length > maxBytes) {
      return res.status(413).json({
        ok: false,
        error: `Dosya çok büyük (${Math.round(buf.length / 1024)} KB). Üst sınır ${maxBytes / 1024} KB.`,
      });
    }
    if (!magicMatches(mime, buf)) {
      return res.status(400).json({ ok: false, error: 'Dosya içeriği belirtilen formatla uyuşmuyor.' });
    }

    const payload = JSON.stringify({
      mime,
      base64: buf.toString('base64'),
      updatedBy: req.session.user.username,
      updatedAt: new Date().toISOString(),
    });

    try {
      const upd = await db().query(
        `UPDATE portal_config_blobs SET data = $1, updated_at = GETUTCDATE() WHERE name = $2`,
        [payload, SLOTS[slot].blobName]
      );
      if (!upd.rowCount) {
        await db().query(
          `INSERT INTO portal_config_blobs (name, data) VALUES ($1, $2)`,
          [SLOTS[slot].blobName, payload]
        );
      }
      cache[slot] = null; // bir sonraki istekte DB'den tazelenir

      try {
        require('../audit/index.cjs').auditPortal(req, `branding_${slot}_update`, {
          detail: `mime=${mime} size=${buf.length}`,
        });
      } catch { /* yoksay */ }

      console.log(`[Branding] ${req.session.user.username} -> ${slot} guncellendi (${mime}, ${buf.length} bayt).`);
      res.json({ ok: true, mime, sizeBytes: buf.length });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── ADMIN: varsayilana don (slot=favicon|logo) ─────────────────────────────
  app.delete('/api/admin/branding/:slot', async (req, res) => {
    if (req.session?.user?.role !== 'Admin') return res.status(403).json({ ok: false });
    const slot = req.params.slot;
    if (!SLOTS[slot]) return res.status(404).json({ ok: false, error: 'Bilinmeyen logo alanı.' });
    try {
      await db().query(`DELETE FROM portal_config_blobs WHERE name = $1`, [SLOTS[slot].blobName]);
      cache[slot] = null;
      try {
        require('../audit/index.cjs').auditPortal(req, `branding_${slot}_reset`, { detail: '' });
      } catch { /* yoksay */ }
      console.log(`[Branding] ${req.session.user.username} -> ${slot} varsayilana dondu.`);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  console.log('[Branding] endpoints mounted at /api/branding + /api/admin/branding');
}

module.exports = { initBranding, faviconVersion, warmFavicon };
