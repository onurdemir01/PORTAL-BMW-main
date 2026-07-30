// server/admin/branding.cjs — Admin → Marka sekmesi: tarayici sekmesinde gorunen
// favicon'un yuklenmesi/sunulmasi.
//
// NEDEN DB'DE SAKLANIYOR: deploy/release.sh uygulama agacini `unzip -o` ile ezer
// (bkz. release.sh:61). Diske yazilan bir logo HER DEPLOY'DA KAYBOLURDU. Gorsel bu
// yuzden portal_config_blobs tablosunda (name='branding:favicon') base64 olarak
// tutulur — release/restart/redeploy hayatta kalir.
//
// Uc endpoint:
//   GET    /api/branding/favicon        PUBLIC  — <link rel="icon"> bunu cagirir.
//                                       Giris ekraninda da gorunmesi gerektigi icin
//                                       kimlik dogrulamasi ARANMAZ.
//   GET    /api/admin/branding          Admin   — mevcut logonun ust verisi
//   PUT    /api/admin/branding/favicon  Admin   — yeni logo yukle (JSON dataUrl)
//   DELETE /api/admin/branding/favicon  Admin   — varsayilana don
'use strict';

const express = require('express');
const crypto = require('crypto');

const BLOB_NAME = 'branding:favicon';

// SVG BILEREK DISARIDA: SVG calistirilabilir <script> icerebilir ve bu dosya
// portal ile AYNI ORIGIN'den sunulur — kullanici dogrudan /api/branding/favicon
// adresine giderse script portal oturum cerezi baglaminda calisirdi (depolanmis XSS).
// Raster formatlarda bu risk yok.
// WEBP BILEREK DISARIDA: tarayicilar WebP'yi sayfa icinde destekler ama favicon
// isleme hatti AYRI bir kod yoludur ve WebP'yi guvenilir sekilde cozmez — dosya
// basariyla indirilir, sekme ikonu yine de degismez (sessiz basarisizlik).
const ALLOWED_MIME = {
  'image/png': ['89504e47'],
  'image/x-icon': ['00000100'],
  'image/vnd.microsoft.icon': ['00000100'],
  'image/jpeg': ['ffd8ff'],
};

const MAX_BYTES = 512 * 1024; // 512 KB — favicon icin fazlasiyla yeterli

// Logo yuklenmemisken sunulan varsayilan. Kendi yazdigimiz sabit icerik
// (kullanici yuklemesi degil) — script icermez, XSS riski yoktur.
const DEFAULT_SVG = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
  `<rect width="32" height="32" rx="6" fill="#ee0000"/>` +
  `<text x="16" y="22" font-family="sans-serif" font-size="15" font-weight="700" ` +
  `fill="#ffffff" text-anchor="middle">B</text></svg>`,
  'utf-8'
);
const DEFAULT_ETAG = `"${crypto.createHash('sha1').update(DEFAULT_SVG).digest('hex').slice(0, 16)}"`;

// Bellek-ici kopya: her sekme yuklemesinde DB'ye gitmemek icin. Yukleme/silme
// aninda tazelenir; birden fazla process varsa ETag revalidation yakalar.
let cache = null; // { mime, buf, etag, updatedAt, updatedBy }

function db() {
  return require('../db/index.cjs');
}

async function loadFromDb() {
  const { rows } = await db().query(
    `SELECT data, updated_at FROM portal_config_blobs WHERE name = $1`,
    [BLOB_NAME]
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

async function getFavicon() {
  if (cache) return cache;
  cache = await loadFromDb();
  return cache;
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
      fav = await getFavicon();
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
      res.set('ETag', DEFAULT_ETAG);
      res.set('Cache-Control', 'no-cache, must-revalidate');
      if (req.headers['if-none-match'] === DEFAULT_ETAG) return res.status(304).end();
      // Kendi yazdigimiz sabit SVG — kullanici yuklemesi degil, script icermez.
      return res.send(DEFAULT_SVG);
    }

    // nosniff + kisitlayici CSP: dosya raster olsa bile tarayicinin icerigi
    // baska bir tur olarak yorumlamasini engeller.
    res.set('Content-Type', fav.mime);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.set('ETag', fav.etag);
    // no-cache = "onbellekte tut ama HER SEFERINDE dogrula". Logo degisince
    // kullanici sert yenileme yapmadan yeni gorseli alir.
    res.set('Cache-Control', 'no-cache, must-revalidate');

    if (req.headers['if-none-match'] === fav.etag) return res.status(304).end();
    return res.send(fav.buf);
  });

  // ── ADMIN: mevcut durum ────────────────────────────────────────────────────
  app.get('/api/admin/branding', async (req, res) => {
    if (req.session?.user?.role !== 'Admin') return res.status(403).json({ ok: false });
    try {
      const fav = await getFavicon();
      res.json({
        ok: true,
        favicon: fav
          ? {
              mime: fav.mime,
              sizeBytes: fav.buf.length,
              updatedAt: fav.updatedAt,
              updatedBy: fav.updatedBy,
              // Onizleme icin data URL — admin ekraninda gosterilir.
              dataUrl: `data:${fav.mime};base64,${fav.buf.toString('base64')}`,
            }
          : null,
        limits: {
          maxBytes: MAX_BYTES,
          allowedMime: Object.keys(ALLOWED_MIME).filter((m) => m !== 'image/vnd.microsoft.icon'),
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── ADMIN: yukleme ─────────────────────────────────────────────────────────
  // multer/busboy EKLENMEDI — kapali kurumsal agda yeni bagimlilik riski var.
  // Tarayici dosyayi FileReader ile data URL'e cevirip JSON gonderir; mevcut
  // express.json({limit:"2mb"}) parser'i yeterli (limit 512 KB'a burada dusurulur).
  app.put('/api/admin/branding/favicon', express.json({ limit: '2mb' }), async (req, res) => {
    if (req.session?.user?.role !== 'Admin') return res.status(403).json({ ok: false });

    const { dataUrl } = req.body || {};
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      return res.status(400).json({ ok: false, error: 'Gecersiz gorsel verisi.' });
    }

    const m = dataUrl.match(/^data:([\w/.+-]+);base64,(.+)$/);
    if (!m) return res.status(400).json({ ok: false, error: 'Gorsel base64 data URL olmali.' });

    const mime = m[1].toLowerCase();
    if (!ALLOWED_MIME[mime]) {
      return res.status(400).json({
        ok: false,
        error: 'Desteklenmeyen format. PNG (onerilen), ICO veya JPEG yukleyin. SVG guvenlik, WEBP ise tarayici uyumsuzlugu nedeniyle kabul edilmez.',
      });
    }

    let buf;
    try {
      buf = Buffer.from(m[2], 'base64');
    } catch {
      return res.status(400).json({ ok: false, error: 'Base64 cozulemedi.' });
    }

    if (!buf.length) return res.status(400).json({ ok: false, error: 'Dosya bos.' });
    if (buf.length > MAX_BYTES) {
      return res.status(413).json({
        ok: false,
        error: `Dosya cok buyuk (${Math.round(buf.length / 1024)} KB). Ust sinir ${MAX_BYTES / 1024} KB.`,
      });
    }
    if (!magicMatches(mime, buf)) {
      return res.status(400).json({ ok: false, error: 'Dosya icerigi belirtilen formatla uyusmuyor.' });
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
        [payload, BLOB_NAME]
      );
      if (!upd.rowCount) {
        await db().query(
          `INSERT INTO portal_config_blobs (name, data) VALUES ($1, $2)`,
          [BLOB_NAME, payload]
        );
      }
      cache = null; // bir sonraki istekte DB'den tazelenir

      try {
        require('../audit/index.cjs').auditPortal(req, 'branding_favicon_update', {
          detail: `mime=${mime} size=${buf.length}`,
        });
      } catch { /* yoksay */ }

      console.log(`[Branding] ${req.session.user.username} -> favicon guncellendi (${mime}, ${buf.length} bayt).`);
      res.json({ ok: true, mime, sizeBytes: buf.length });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── ADMIN: varsayilana don ─────────────────────────────────────────────────
  app.delete('/api/admin/branding/favicon', async (req, res) => {
    if (req.session?.user?.role !== 'Admin') return res.status(403).json({ ok: false });
    try {
      await db().query(`DELETE FROM portal_config_blobs WHERE name = $1`, [BLOB_NAME]);
      cache = null;
      try {
        require('../audit/index.cjs').auditPortal(req, 'branding_favicon_reset', { detail: '' });
      } catch { /* yoksay */ }
      console.log(`[Branding] ${req.session.user.username} -> favicon varsayilana dondu.`);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  console.log('[Branding] endpoints mounted at /api/branding + /api/admin/branding');
}

module.exports = { initBranding };
