'use strict';
// SPA SUNUMU (server/spa-sunum.cjs) — uretimde Node'un on yuz paketini servis etmesi. Gercek express,
// gecici dist dizini; katmanlar server/index.cjs'teki sirayla kurulur (statik -> oturum -> /api ->
// /api 404 -> SPA). Marka, kurum ayari ve kullanici tercihi modulleri cagri aninda okunur: yerinde
// sahtelenir.
//   SS1 uretim degilse ya da dist/index.html yoksa hicbir sey kurulmaz; spaSunumunuKur uyarir.
//   SS2 varliklar oturumsuz, bir yillik degismez onbellekle; dist_prev varsa eski dosyalar da.
//   SS3 index.html surumlu: favicon ve logo adresi surumlu, kurum ayari hatasi gomulu, no-store + Vary.
//   SS4 gomulu JSON script blogunu kapatamaz (</script>, <!--, &).
//   SS5 tema ve renk tercihi oturum sahibinin kaydindan; gecersiz deger gomulmez; oturumsuz sorgu yok.
//   SS6 tema onbellegi 30 sn, kullanici adi harf duyarsiz; tercih yazilinca dusurulur.
//   SS7 okunamayan tercih onbelleklenmez; onbellek 500 kullaniciyi asinca bosaltilir.
//   SS8 surumleme duserse ham index.html gider; dosya surec basina bir kez okunur.
//   SS9 bulunamayan varlik HTML degil duz 404; uzantisiz derin baglanti SPA'ya, /api ayri.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const express = require('express');

const branding = require('../admin/branding.cjs');
const users = require('../auth/users.cjs');
const kurumAyariModulu = require('../util/kurum-ayari.cjs');
const { statikVarliklariKur, spaSunumunuKur } = require('../spa-sunum.cjs');

const HAM_INDEX =
  '<!doctype html><link rel="icon" href="/api/branding/favicon">' +
  '<script>window.__BMW_BOOT__ = {};</script><div id="root"></div>';
const ESKI_DOSYA = 'Not found (eski surum dosyasi olabilir; sayfayi yenileyin)';

function distKur(t, { prev = false, index = true } = {}) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-sunum-'));
  t.after(() => fs.rmSync(kok, { recursive: true, force: true }));
  const dist = path.join(kok, 'dist');
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  if (index) fs.writeFileSync(path.join(dist, 'index.html'), HAM_INDEX);
  fs.writeFileSync(path.join(dist, 'assets', 'app-abc.js'), 'YENI');
  if (prev) {
    fs.mkdirSync(path.join(kok, 'dist_prev', 'assets'), { recursive: true });
    fs.writeFileSync(path.join(kok, 'dist_prev', 'assets', 'eski-xyz.js'), 'ESKI');
  }
  return dist;
}

async function sunucuKur(t, distDir, { uretim = true } = {}) {
  const app = express();
  app.disable('x-powered-by');
  const prodDist = statikVarliklariKur(app, { distDir, uretim });
  const sayac = { oturum: 0 };
  app.use((req, _res, next) => {
    sayac.oturum++;
    const u = req.headers['x-kullanici'];
    req.session = u ? { user: { username: u } } : {};
    next();
  });
  app.get('/api/canli', (_req, res) => res.json({ ok: true }));
  app.use('/api', (_req, res) => res.status(404).json({ ok: false, error: 'Not Found' }));
  if (uretim) spaSunumunuKur(app, { distDir, prodDist });
  const sunucu = app.listen(0, '127.0.0.1');
  await once(sunucu, 'listening');
  t.after(() => new Promise((r) => sunucu.close(r)));
  return { app, prodDist, sayac, port: sunucu.address().port };
}

function iste(port, yol, { method = 'GET', kullanici } = {}) {
  return new Promise((resolve, reject) => {
    const headers = kullanici ? { 'x-kullanici': kullanici } : {};
    const req = http.request(
      { host: '127.0.0.1', port, path: yol, method, headers, agent: false },
      (res) => {
        let govde = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (govde += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, govde }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function sahteler(t, { prefs = async () => ({}) } = {}) {
  return {
    favicon: t.mock.method(branding, 'faviconVersion', () => 'f v1'),
    logo: t.mock.method(branding, 'logoState', () => ({ hasLogo: false, version: '' })),
    kurum: t.mock.method(kurumAyariModulu, 'kurumAyari', () => ({ veri: {} })),
    getPrefs: t.mock.method(users, 'getPrefs', prefs),
  };
}

function bootOku(html) {
  const m = /window\.__BMW_BOOT__ = (.*?);<\/script>/.exec(html);
  assert.ok(m, `acilis durumu gomulmemis: ${html}`);
  return JSON.parse(m[1]);
}

test('SS1 uretim degilse ya da dist/index.html yoksa hicbir sey kurulmaz', async (t) => {
  const uyari = t.mock.method(console, 'warn', () => {});
  sahteler(t);

  let s = await sunucuKur(t, distKur(t), { uretim: false });
  assert.equal(s.prodDist, false);
  let r = await iste(s.port, '/assets/app-abc.js');
  assert.equal(r.status, 404);
  assert.notEqual(r.govde, 'YENI', 'uretim disinda dist servis edildi');
  assert.equal(uyari.mock.callCount(), 0);

  s = await sunucuKur(t, distKur(t, { index: false }));
  assert.equal(s.prodDist, false);
  r = await iste(s.port, '/assets/app-abc.js');
  assert.equal(r.status, 404);
  assert.notEqual(r.govde, ESKI_DOSYA, 'dist yokken 404 bekcisi kuruldu');
  r = await iste(s.port, '/');
  assert.equal(r.status, 404);
  assert.equal(uyari.mock.callCount(), 1);
  assert.match(uyari.mock.calls[0].arguments[0], /NODE_ENV=production ama dist\/index\.html yok/);
});

test('SS2 varliklar oturumsuz ve degismez onbellekle; dist_prev eski dosyalari da verir', async (t) => {
  const bilgi = t.mock.method(console, 'log', () => {});
  sahteler(t);
  const s = await sunucuKur(t, distKur(t, { prev: true }));
  assert.equal(s.prodDist, true);
  let r = await iste(s.port, '/assets/app-abc.js');
  assert.equal(r.status, 200);
  assert.equal(r.govde, 'YENI');
  assert.equal(r.headers['cache-control'], 'public, max-age=31536000, immutable');
  r = await iste(s.port, '/assets/eski-xyz.js');
  assert.equal(r.govde, 'ESKI');
  assert.equal(r.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal(s.sayac.oturum, 0, 'varlik istekleri oturum katmanindan gecti');
  const satirlar = bilgi.mock.calls.map((c) => c.arguments[0]);
  assert.ok(satirlar.includes('[Server] onceki surum dosyalari da servis ediliyor (dist_prev)'));
  assert.ok(satirlar.includes('[Server] production static serving aktif (dist/)'));

  const yeni = await sunucuKur(t, distKur(t));
  r = await iste(yeni.port, '/assets/eski-xyz.js');
  assert.equal(r.status, 404, 'dist_prev yokken eski dosya bulundu');
  assert.equal(r.govde, ESKI_DOSYA);
});

test('SS3 index.html surumlu adreslerle ve acilis durumuyla; paylasimli onbellege dusmez', async (t) => {
  t.mock.method(console, 'log', () => {});
  const m = sahteler(t);
  m.logo.mock.mockImplementation(() => ({ hasLogo: true, version: 'l/2' }));
  m.kurum.mock.mockImplementation(() => ({ veri: {}, hata: 'KURUM_AYAR_DOSYASI tanimli degil' }));
  const s = await sunucuKur(t, distKur(t));
  for (const yol of ['/', '/index.html', '/derin/sayfa?sekme=1']) {
    const once = s.sayac.oturum;
    const r = await iste(s.port, yol);
    assert.equal(r.status, 200, yol);
    assert.match(r.headers['content-type'], /^text\/html/);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers.vary, 'Cookie');
    assert.ok(r.govde.includes('href="/api/branding/favicon?v=f%20v1"'), 'favicon surumsuz');
    assert.deepEqual(bootOku(r.govde), {
      logoUrl: '/api/branding/logo?v=l%2F2',
      kurumAyarHatasi: 'KURUM_AYAR_DOSYASI tanimli degil',
    });
    assert.equal(s.sayac.oturum, once + 1, `${yol} oturumdan gecmedi`);
  }

  m.logo.mock.mockImplementation(() => ({ hasLogo: false, version: 'x' }));
  m.kurum.mock.mockImplementation(() => ({ veri: {} }));
  const r = await iste(s.port, '/');
  assert.deepEqual(bootOku(r.govde), { logoUrl: null, kurumAyarHatasi: null });
});

test('SS4 gomulu JSON script blogunu erken kapatamaz', async (t) => {
  t.mock.method(console, 'log', () => {});
  const m = sahteler(t);
  const kotu = '</script><!--x-->&amp;<img src=x>';
  m.kurum.mock.mockImplementation(() => ({ veri: {}, hata: kotu }));
  const s = await sunucuKur(t, distKur(t));
  const r = await iste(s.port, '/');
  assert.equal(r.govde.split('</script>').length, 2, 'gomulen deger script blogunu kapatti');
  assert.ok(!r.govde.includes('<!--'), 'HTML yorum acilisi gomuldu');
  assert.ok(r.govde.includes('\\u003c/script\\u003e\\u003c!--x--\\u003e\\u0026amp;'));
  assert.equal(bootOku(r.govde).kurumAyarHatasi, kotu, 'kacis degeri bozdu');
});

test('SS5 tema ve renk tercihi oturum sahibinin kaydindan; gecersiz deger gomulmez', async (t) => {
  t.mock.method(console, 'log', () => {});
  const kayit = {
    ali: { 'bmw-theme': 'dark', 'bmw-renk': 'cvd' },
    veli: { 'bmw-theme': 'light' },
    ayse: { 'bmw-theme': 'mavi', 'bmw-renk': 'gri' },
  };
  const m = sahteler(t, { prefs: async (u) => kayit[u] });
  const s = await sunucuKur(t, distKur(t));

  let boot = bootOku((await iste(s.port, '/', { kullanici: 'ali' })).govde);
  assert.equal(boot.theme, 'dark');
  assert.equal(boot.renk, 'cvd');
  boot = bootOku((await iste(s.port, '/', { kullanici: 'veli' })).govde);
  assert.equal(boot.theme, 'light');
  assert.equal('renk' in boot, false);
  boot = bootOku((await iste(s.port, '/', { kullanici: 'ayse' })).govde);
  assert.equal('theme' in boot, false, 'gecersiz tema gomuldu');
  assert.equal('renk' in boot, false, 'gecersiz renk gomuldu');
  assert.deepEqual(
    m.getPrefs.mock.calls.map((c) => c.arguments[0]),
    ['ali', 'veli', 'ayse'],
  );

  boot = bootOku((await iste(s.port, '/')).govde);
  assert.equal('theme' in boot, false);
  assert.equal(m.getPrefs.mock.callCount(), 3, 'oturumsuz istekte tercih okundu');
});

test('SS6 tema onbellegi 30 sn, harf duyarsiz; tercih yazilinca dusurulur', async (t) => {
  t.mock.method(console, 'log', () => {});
  let tema = 'dark';
  const m = sahteler(t, { prefs: async () => ({ 'bmw-theme': tema }) });
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const s = await sunucuKur(t, distKur(t));
  const temaAl = async (kullanici) => bootOku((await iste(s.port, '/', { kullanici })).govde).theme;

  assert.equal(await temaAl('Ali'), 'dark');
  tema = 'light';
  assert.equal(await temaAl('ALI'), 'dark', 'onbellek kullanici adini harf duyarli tutuyor');
  t.mock.timers.tick(29_999);
  assert.equal(await temaAl('ali'), 'dark');
  assert.equal(m.getPrefs.mock.callCount(), 1);
  t.mock.timers.tick(1);
  assert.equal(await temaAl('ali'), 'light', '30 sn sonra tercih yeniden okunmadi');
  assert.equal(m.getPrefs.mock.callCount(), 2);

  tema = 'dark';
  assert.equal(await temaAl('ali'), 'light');
  assert.equal(s.app.locals.invalidateThemePref('ALI'), true);
  assert.equal(await temaAl('ali'), 'dark', 'dusurulen tercih yeniden okunmadi');
  assert.equal(m.getPrefs.mock.callCount(), 3);
  assert.equal(s.app.locals.invalidateThemePref(undefined), false);
});

test('SS7 okunamayan tercih onbelleklenmez; onbellek 500 kullaniciyi asinca bosaltilir', async (t) => {
  t.mock.method(console, 'log', () => {});
  let bozuk = true;
  const okunan = [];
  sahteler(t, {
    prefs: async (u) => {
      okunan.push(u);
      if (bozuk) throw new Error('DB yok');
      return { 'bmw-theme': 'dark' };
    },
  });
  const s = await sunucuKur(t, distKur(t));
  let r = await iste(s.port, '/', { kullanici: 'ali' });
  assert.equal(r.status, 200);
  assert.equal('theme' in bootOku(r.govde), false);
  bozuk = false;
  r = await iste(s.port, '/', { kullanici: 'ali' });
  assert.equal(bootOku(r.govde).theme, 'dark', 'basarisiz okuma onbelleklendi');
  assert.deepEqual(okunan, ['ali', 'ali']);

  okunan.length = 0;
  for (let i = 0; i < 500; i++) await iste(s.port, '/', { kullanici: `k${i}` }); // ali + 500 = 501
  await iste(s.port, '/', { kullanici: 'ali' });
  assert.equal(okunan.includes('ali'), false, '501 kullanicida onbellek bosaltildi');
  await iste(s.port, '/', { kullanici: 'k500' }); // 502. kullanici: once bosaltilir
  await iste(s.port, '/', { kullanici: 'ali' });
  assert.equal(okunan.at(-1), 'ali', 'sinir asilinca onbellek bosaltilmadi');
});

test('SS8 surumleme duserse ham index.html gider; dosya surec basina bir kez okunur', async (t) => {
  t.mock.method(console, 'log', () => {});
  const uyari = t.mock.method(console, 'warn', () => {});
  const m = sahteler(t);
  const dist = distKur(t);
  const s = await sunucuKur(t, dist);
  let r = await iste(s.port, '/');
  assert.ok(r.govde.includes('favicon?v='));

  const yeni = HAM_INDEX.replace('<div id="root">', '<div id="root" data-surum="2">');
  fs.writeFileSync(path.join(dist, 'index.html'), yeni);
  r = await iste(s.port, '/');
  assert.ok(!r.govde.includes('data-surum'), 'index.html her istekte yeniden okundu');

  m.favicon.mock.mockImplementation(() => {
    throw new Error('marka okunamadi');
  });
  r = await iste(s.port, '/derin');
  assert.equal(r.status, 200);
  assert.equal(r.govde, yeni, 'ham dosya gonderilmedi');
  assert.equal(uyari.mock.callCount(), 1);
  assert.deepEqual(uyari.mock.calls[0].arguments, [
    '[Server] index.html surumlenemedi, ham dosya gonderiliyor:',
    'marka okunamadi',
  ]);
});

test('SS9 bulunamayan varlik duz 404; uzantisiz derin baglanti SPA, /api ayri', async (t) => {
  t.mock.method(console, 'log', () => {});
  sahteler(t);
  const s = await sunucuKur(t, distKur(t));
  const varliklar = [
    '/assets/olmayan.js',
    '/assets/klasor/',
    '/m.mjs',
    '/x.css',
    '/a/b.map',
    '/veri.json',
    '/r.png',
    '/r.jpg',
    '/r.jpeg',
    '/r.svg',
    '/r.gif',
    '/favicon.ico',
    '/f.woff',
    '/f.woff2',
    '/f.ttf',
    '/f.eot',
    '/robots.txt',
    '/site.webmanifest',
  ];
  for (const yol of varliklar) {
    const r = await iste(s.port, yol);
    assert.equal(r.status, 404, yol);
    assert.match(r.headers['content-type'], /^text\/plain/, yol);
    assert.equal(r.govde, ESKI_DOSYA, yol);
  }
  let r = await iste(s.port, '/rapor/2026.11');
  assert.equal(r.status, 200);
  assert.ok(bootOku(r.govde));
  r = await iste(s.port, '/api/olmayan');
  assert.equal(r.status, 404);
  assert.deepEqual(JSON.parse(r.govde), { ok: false, error: 'Not Found' });
  r = await iste(s.port, '/api/canli');
  assert.deepEqual(JSON.parse(r.govde), { ok: true });
  r = await iste(s.port, '/', { method: 'POST' });
  assert.equal(r.status, 404, 'POST SPA fallback aldi');
});
