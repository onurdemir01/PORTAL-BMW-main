'use strict';
// MARKA (server/admin/branding.cjs) — sekme ikonu ve uygulama logosu: herkese acik sunum uclari ve
// Admin yukleme / sifirlama. Gercek express; DB bellek ici bir portal_config_blobs taklidi (db.query
// cagri aninda okunur). Modul durumu (bellek onbellegi, surum) her testte taze yuklenir.
//   MK1 ozel ikon yokken gomulu SVG (guvenlik basliklari, ETag, surum), logo 404, meta hasLogo=false.
//   MK2 favicon yukleme: once UPDATE yoksa INSERT; yuklenen bayt kendi turuyle, icerik ozetli ETag'le
//       sunulur; surum yuklemenin ARDINDAN hemen degisir (ilk HTML yeni surumu gomer); 304;
//       denetim kaydi.
//   MK3 logo yukleme ve varsayilana donus: meta, logo durumu, 404, denetim kaydi.
//   MK4 dogrulama: yalniz Admin; bilinmeyen alan; data URL bicimi; izinli turler (SVG / WEBP
//       degil); bos dosya; boyut ust siniri (413); icerik imzasi turle uyusmali.
//   MK5 Admin durum ucu: iki alanin bilgisi, onizleme data URL'i, sinirlar.
//   MK6 DB yoksa / bozuk kayitta varsayilana duser; yazma hatalari 500.
//   MK7 acilis isitmasi surumu ve logo durumunu DB'den kurar; DB yoksa varsayilan kalir.
//   MK8 denetim kaydi yazilamazsa yukleme ve sifirlama yine basarili.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { once } = require('node:events');

const db = require('../../db/index.cjs');
const denetim = require('../../audit/index.cjs');

const MODUL = require.resolve('../branding.cjs');

// Gecerli imzali kucuk gorseller (yalnizca bas baytlari onemli).
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPEG = Buffer.from('ffd8ffe000104a464946', 'hex');
const ICO = Buffer.from('0000010001001010', 'hex');
const veri = (mime, buf) => `data:${mime};base64,${buf.toString('base64')}`;
const ozet = (buf) => `"${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)}"`;

/** Bellek ici portal_config_blobs; `bozuk` bir desene uyan sorguda hata firlatir. */
function sahteDb(t, { kayit = {}, bozuk } = {}) {
  const tablo = new Map(Object.entries(kayit));
  const sorgular = [];
  t.mock.method(db, 'query', async (sql, p = []) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    sorgular.push({ q, p });
    if (bozuk && bozuk.test(q)) throw new Error('DB yok');
    if (q.startsWith('SELECT data, updated_at FROM portal_config_blobs')) {
      const v = tablo.get(p[0]);
      return { rows: v === undefined ? [] : [{ data: v, updated_at: 'u1' }] };
    }
    if (q.startsWith('UPDATE portal_config_blobs')) {
      if (!tablo.has(p[1])) return { rows: [], rowCount: 0 };
      tablo.set(p[1], p[0]);
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith('INSERT INTO portal_config_blobs')) {
      tablo.set(p[0], p[1]);
      return { rows: [], rowCount: 1 };
    }
    if (q.startsWith('DELETE FROM portal_config_blobs')) {
      tablo.delete(p[0]);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`beklenmeyen sorgu: ${q}`);
  });
  return { tablo, sorgular };
}

async function kur(t) {
  t.mock.method(console, 'log', () => {});
  const kayitlar = [];
  t.mock.method(denetim, 'auditPortal', (_req, olay, ek) => kayitlar.push([olay, ek]));
  delete require.cache[MODUL];
  const marka = require(MODUL);
  const app = express();
  app.use((req, _res, next) => {
    const rol = req.headers['x-rol'];
    req.session = rol ? { user: { username: 'yonetici', role: rol } } : {};
    next();
  });
  marka.initBranding(app);
  const s = app.listen(0, '127.0.0.1');
  await once(s, 'listening');
  t.after(() => new Promise((r) => s.close(r)));
  const iste = async (yol, { method = 'GET', govde, rol, basliklar = {} } = {}) => {
    const h = { ...basliklar };
    if (rol) h['x-rol'] = rol;
    if (govde !== undefined) h['content-type'] = 'application/json';
    const r = await fetch(`http://127.0.0.1:${s.address().port}${yol}`, {
      method,
      headers: h,
      body: govde === undefined ? undefined : JSON.stringify(govde),
    });
    const buf = Buffer.from(await r.arrayBuffer());
    let json = null;
    try {
      json = JSON.parse(buf.toString('utf8'));
    } catch {
      /* ikili */
    }
    return { status: r.status, h: r.headers, buf, json };
  };
  const yukle = (slot, dataUrl, rol = 'Admin') =>
    iste(`/api/admin/branding/${slot}`, { method: 'PUT', govde: { dataUrl }, rol });
  return { marka, iste, yukle, kayitlar };
}

test('MK1 ozel ikon yokken gomulu SVG; logo 404; meta hasLogo=false', async (t) => {
  sahteDb(t);
  const s = await kur(t);
  const v = s.marka.faviconVersion();
  assert.match(v, /^[0-9a-f]{16}$/);
  assert.deepEqual(s.marka.logoState(), { hasLogo: false, version: '' });

  let r = await s.iste('/api/branding/favicon');
  assert.equal(r.status, 200);
  assert.equal(r.h.get('content-type'), 'image/svg+xml');
  assert.equal(r.h.get('x-content-type-options'), 'nosniff');
  assert.equal(
    r.h.get('content-security-policy'),
    "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  );
  assert.equal(r.h.get('etag'), `"${v}"`);
  assert.equal(r.h.get('etag'), ozet(r.buf), 'ETag gomulu SVG icerigine bagli degil');
  assert.match(r.buf.toString('utf8'), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.ok(!/<script|<text/i.test(r.buf.toString('utf8')), 'gomulu ikonda betik ya da metin var');
  assert.equal(r.h.get('cache-control'), 'no-cache, must-revalidate');

  r = await s.iste(`/api/branding/favicon?v=${v}`);
  assert.equal(r.h.get('cache-control'), 'public, max-age=31536000, immutable');
  r = await s.iste('/api/branding/favicon', { basliklar: { 'if-none-match': `"${v}"` } });
  assert.equal(r.status, 304);

  r = await s.iste('/api/branding/logo');
  assert.equal(r.status, 404);
  r = await s.iste('/api/branding/meta');
  assert.deepEqual(r.json, { ok: true, hasLogo: false });
  assert.equal(r.h.get('cache-control'), 'no-cache, must-revalidate');
});

test('MK2 favicon yukleme, sunum, surum ve denetim', async (t) => {
  const { tablo, sorgular } = sahteDb(t);
  const s = await kur(t);
  const eskiSurum = s.marka.faviconVersion();

  let r = await s.yukle('favicon', veri('IMAGE/PNG', PNG));
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, mime: 'image/png', sizeBytes: PNG.length });
  const yazilan = JSON.parse(tablo.get('branding:favicon'));
  assert.equal(yazilan.mime, 'image/png');
  assert.equal(yazilan.base64, PNG.toString('base64'));
  assert.equal(yazilan.updatedBy, 'yonetici');
  assert.match(yazilan.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(
    sorgular.some((x) => x.q.startsWith('INSERT INTO portal_config_blobs')),
    'ilk yuklemede INSERT yok',
  );
  assert.equal(
    s.marka.faviconVersion(),
    ozet(PNG).replace(/"/g, ''),
    'surum yuklemeden hemen sonra degismedi',
  );
  assert.notEqual(s.marka.faviconVersion(), eskiSurum);
  assert.deepEqual(s.kayitlar, [
    ['branding_favicon_update', { detail: `mime=image/png size=${PNG.length}` }],
  ]);

  r = await s.iste('/api/branding/favicon');
  assert.equal(r.status, 200);
  assert.equal(r.h.get('content-type'), 'image/png');
  assert.deepEqual(r.buf, PNG);
  assert.equal(r.h.get('etag'), ozet(PNG));
  assert.equal(r.h.get('x-content-type-options'), 'nosniff');
  assert.match(r.h.get('content-security-policy'), /sandbox/);
  assert.equal(r.h.get('cache-control'), 'no-cache, must-revalidate');
  r = await s.iste('/api/branding/favicon?v=1');
  assert.equal(r.h.get('cache-control'), 'public, max-age=31536000, immutable');
  r = await s.iste('/api/branding/favicon', { basliklar: { 'if-none-match': ozet(PNG) } });
  assert.equal(r.status, 304);

  // Onbellek: ayni icerik icin DB'ye tekrar gidilmez.
  const once = sorgular.length;
  await s.iste('/api/branding/favicon');
  assert.equal(sorgular.length, once, 'yuklu ikon her istekte DB den okundu');

  // Ikinci yukleme mevcut satiri gunceller.
  r = await s.yukle('favicon', veri('image/x-icon', ICO));
  assert.equal(r.status, 200);
  assert.equal(
    sorgular.filter((x) => x.q.startsWith('INSERT')).length,
    1,
    'ikinci yuklemede yeni satir acildi',
  );
  r = await s.iste('/api/branding/favicon');
  assert.equal(r.h.get('content-type'), 'image/x-icon');
  assert.deepEqual(r.buf, ICO);
});

test('MK3 logo yukleme ve varsayilana donus', async (t) => {
  const { tablo } = sahteDb(t);
  const s = await kur(t);
  let r = await s.yukle('logo', veri('image/jpeg', JPEG));
  assert.equal(r.status, 200);
  assert.deepEqual(s.marka.logoState(), { hasLogo: true, version: ozet(JPEG).replace(/"/g, '') });
  r = await s.iste('/api/branding/meta');
  assert.deepEqual(r.json, { ok: true, hasLogo: true });
  r = await s.iste('/api/branding/logo?v=x');
  assert.equal(r.status, 200);
  assert.equal(r.h.get('content-type'), 'image/jpeg');
  assert.deepEqual(r.buf, JPEG);
  assert.equal(r.h.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(r.h.get('x-content-type-options'), 'nosniff');
  r = await s.iste('/api/branding/logo', { basliklar: { 'if-none-match': ozet(JPEG) } });
  assert.equal(r.status, 304);
  r = await s.iste('/api/branding/logo');
  assert.equal(r.h.get('cache-control'), 'no-cache, must-revalidate');

  r = await s.iste('/api/admin/branding/logo', { method: 'DELETE', rol: 'Admin' });
  assert.deepEqual(r.json, { ok: true });
  assert.equal(tablo.has('branding:logo'), false);
  assert.deepEqual(s.marka.logoState(), { hasLogo: false, version: '' });
  r = await s.iste('/api/branding/logo');
  assert.equal(r.status, 404);
  assert.deepEqual(s.kayitlar.at(-1), ['branding_logo_reset', { detail: '' }]);

  // Favicon sifirlaninca surum gomulu varsayilana doner.
  const varsayilan = s.marka.faviconVersion();
  await s.yukle('favicon', veri('image/png', PNG));
  assert.notEqual(s.marka.faviconVersion(), varsayilan);
  await s.iste('/api/admin/branding/favicon', { method: 'DELETE', rol: 'Admin' });
  assert.equal(s.marka.faviconVersion(), varsayilan);
});

test('MK4 yukleme dogrulamasi', async (t) => {
  const { tablo } = sahteDb(t);
  const s = await kur(t);
  for (const [yol, method] of [
    ['/api/admin/branding', 'GET'],
    ['/api/admin/branding/logo', 'PUT'],
    ['/api/admin/branding/logo', 'DELETE'],
  ]) {
    for (const rol of [undefined, 'User']) {
      const r = await s.iste(yol, { method, rol, govde: method === 'PUT' ? {} : undefined });
      assert.equal(r.status, 403, `${method} ${yol} rol=${rol}`);
    }
  }
  let r = await s.yukle('arkaplan', veri('image/png', PNG));
  assert.deepEqual([r.status, r.json.error], [404, 'Bilinmeyen logo alanı.']);
  r = await s.iste('/api/admin/branding/arkaplan', { method: 'DELETE', rol: 'Admin' });
  assert.equal(r.status, 404);

  const hata = async (dataUrl, kod = 400) => {
    const x = await s.yukle('favicon', dataUrl);
    assert.equal(x.status, kod, String(dataUrl).slice(0, 40));
    return x.json.error;
  };
  assert.equal(await hata(undefined), 'Geçersiz görsel verisi.');
  assert.equal(await hata('https://ornek.invalid/logo.png'), 'Geçersiz görsel verisi.');
  assert.equal(await hata('data:image/png,ham-veri'), 'Görsel base64 data URL olmalı.');
  for (const mime of ['image/svg+xml', 'image/webp', 'text/html'])
    assert.match(
      await hata(veri(mime, PNG)),
      /^Desteklenmeyen format\. PNG \(önerilen\), ICO veya JPEG/,
    );
  assert.equal(await hata('data:image/png;base64,='), 'Dosya boş.');
  assert.equal(await hata(veri('image/png', JPEG)), 'Dosya içeriği belirtilen formatla uyuşmuyor.');
  assert.equal(
    await hata(veri('image/jpeg', Buffer.from('<html>'))),
    'Dosya içeriği belirtilen formatla uyuşmuyor.',
  );
  // JPEG imzasi uc bayttir (ff d8 ff): yalniz ilk ikisi tutan dosya JPEG sayilmaz.
  assert.equal(
    await hata(veri('image/jpeg', Buffer.from('ffd800e0', 'hex'))),
    'Dosya içeriği belirtilen formatla uyuşmuyor.',
  );

  const buyuk = Buffer.concat([PNG, Buffer.alloc(512 * 1024)]);
  assert.equal(
    await hata(veri('image/png', buyuk), 413),
    `Dosya çok büyük (${Math.round(buyuk.length / 1024)} KB). Üst sınır 512 KB.`,
  );
  // Logo alaninin siniri daha genis (1 MB): ayni dosya kabul edilir.
  r = await s.yukle('logo', veri('image/png', buyuk));
  assert.equal(r.status, 200);
  r = await s.yukle('favicon', veri('image/vnd.microsoft.icon', ICO));
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(tablo.get('branding:favicon')).mime, 'image/vnd.microsoft.icon');
  assert.equal(s.kayitlar.length, 2, 'reddedilen yukleme denetime yazildi');
});

test('MK5 Admin durum ucu', async (t) => {
  sahteDb(t, {
    kayit: {
      'branding:favicon': JSON.stringify({
        mime: 'image/png',
        base64: PNG.toString('base64'),
        updatedBy: 'ali',
      }),
    },
  });
  const s = await kur(t);
  const r = await s.iste('/api/admin/branding', { rol: 'Admin' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, {
    ok: true,
    favicon: {
      mime: 'image/png',
      sizeBytes: PNG.length,
      updatedAt: 'u1',
      updatedBy: 'ali',
      dataUrl: veri('image/png', PNG),
    },
    logo: null,
    limits: {
      favicon: { maxBytes: 512 * 1024, allowedMime: ['image/png', 'image/x-icon', 'image/jpeg'] },
      logo: { maxBytes: 1024 * 1024, allowedMime: ['image/png', 'image/x-icon', 'image/jpeg'] },
    },
  });
});

test('MK6 DB yoksa ya da kayit bozuksa varsayilan; yazma hatalari 500', async (t) => {
  sahteDb(t, { bozuk: /./ });
  let s = await kur(t);
  let r = await s.iste('/api/branding/favicon');
  assert.equal(r.status, 200);
  assert.equal(r.h.get('content-type'), 'image/svg+xml');
  assert.equal((await s.iste('/api/branding/logo')).status, 404);
  assert.deepEqual((await s.iste('/api/branding/meta')).json, { ok: true, hasLogo: false });
  r = await s.iste('/api/admin/branding', { rol: 'Admin' });
  assert.deepEqual([r.status, r.json], [500, { ok: false, error: 'DB yok' }]);
  r = await s.yukle('favicon', veri('image/png', PNG));
  assert.deepEqual([r.status, r.json], [500, { ok: false, error: 'DB yok' }]);
  r = await s.iste('/api/admin/branding/favicon', { method: 'DELETE', rol: 'Admin' });
  assert.deepEqual([r.status, r.json], [500, { ok: false, error: 'DB yok' }]);
  assert.deepEqual(s.kayitlar, [], 'basarisiz yazma denetime yazildi');

  for (const bozukKayit of [
    '{bozuk',
    JSON.stringify({ mime: 'image/png' }),
    JSON.stringify({ base64: 'eA==' }),
  ]) {
    t.mock.restoreAll();
    sahteDb(t, { kayit: { 'branding:favicon': bozukKayit, 'branding:logo': bozukKayit } });
    s = await kur(t);
    r = await s.iste('/api/branding/favicon');
    assert.equal(r.h.get('content-type'), 'image/svg+xml', bozukKayit);
    assert.equal((await s.iste('/api/branding/logo')).status, 404, bozukKayit);
  }
});

test('MK7 acilis isitmasi', async (t) => {
  sahteDb(t, {
    kayit: {
      'branding:favicon': JSON.stringify({ mime: 'image/png', base64: PNG.toString('base64') }),
      'branding:logo': JSON.stringify({ mime: 'image/jpeg', base64: JPEG.toString('base64') }),
    },
  });
  let s = await kur(t);
  const varsayilan = s.marka.faviconVersion();
  await s.marka.warmFavicon();
  assert.equal(s.marka.faviconVersion(), ozet(PNG).replace(/"/g, ''));
  assert.deepEqual(s.marka.logoState(), { hasLogo: true, version: ozet(JPEG).replace(/"/g, '') });

  t.mock.restoreAll();
  sahteDb(t, { bozuk: /./ });
  s = await kur(t);
  await s.marka.warmFavicon();
  assert.equal(s.marka.faviconVersion(), varsayilan);
  assert.deepEqual(s.marka.logoState(), { hasLogo: false, version: '' });
});

test('MK8 denetim kaydi yazilamazsa yukleme ve sifirlama yine basarili', async (t) => {
  const { tablo } = sahteDb(t);
  const s = await kur(t);
  denetim.auditPortal.mock.mockImplementation(() => {
    throw new Error('denetim yok');
  });
  let r = await s.yukle('logo', veri('image/png', PNG));
  assert.equal(r.status, 200);
  assert.ok(tablo.has('branding:logo'));
  r = await s.iste('/api/admin/branding/logo', { method: 'DELETE', rol: 'Admin' });
  assert.deepEqual([r.status, r.json], [200, { ok: true }]);
});
