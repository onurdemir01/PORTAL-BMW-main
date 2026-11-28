'use strict';
// STATIK VARLIKLAR OTURUMDAN ONCE (2026-11-12) - bekci.
//
// Hash'li chunk/font istekleri express-session'dan gecmemeli (her dosya icin
// portal_sessions SELECT + lastSeen). AMA index.html (kullaniciya ozel tema, surumlu
// favicon), 404 bekcisi ve SPA fallback oturumdan SONRA kalmali; /api asla statik
// katmandan servis edilmemeli.
//
// Iki katman:
//   1) Kaynak sirasi: katmanlar server/spa-sunum.cjs'te; KAYIT SIRASI server/index.cjs'te (giris
//      noktasi okunur, require EDILMEZ - main() calisirdi; acilis davranisi: sunucu-acilis.test.js).
//   2) Davranis: GERCEK statikOnceKatman, gercek express + express.static ile kosulur (surumlu
//      index.html ve tema onbellegi: spa-sunum.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const { statikOnceKatman } = require('../spa-sunum.cjs');

// Bicim degil kural: bosluk/tirnak normalize (prettier'a dayanikli).
const normal = (ad) =>
  fs
    .readFileSync(path.join(__dirname, '..', ad), 'utf8')
    .replace(/\s+/g, ' ')
    .replace(/'/g, '"');
const NORM = normal('index.cjs');
const SPA = normal('spa-sunum.cjs');

function konum(desen, ad, metin = NORM) {
  const m = desen.exec(metin);
  assert.ok(m, `${ad} bulunamadi`);
  return m.index;
}

test('kaynak: express.static yalniz statikOnceKatman icinde; statik katman initAuth ONCESINDE', () => {
  assert.doesNotMatch(
    NORM,
    /express\.static\(/,
    'giris noktasinda statikOnceKatman disi statik var',
  );
  const statikler = [...SPA.matchAll(/express\.static\(/g)].map((m) => m.index);
  assert.ok(statikler.length >= 2, 'dist ve dist_prev statik katmanlari yok');
  const statikFn = konum(/function statikVarliklariKur\(/, 'statikVarliklariKur', SPA);
  const spaFn = konum(/function spaSunumunuKur\(/, 'spaSunumunuKur', SPA);
  for (const i of statikler) {
    assert.ok(i > statikFn && i < spaFn, 'express.static statikVarliklariKur disinda');
    const once = SPA.slice(Math.max(0, i - 40), i);
    assert.match(once, /statikOnceKatman\( ?$/, 'express.static statikOnceKatman ile sarilmamis');
  }
  assert.ok(/express\.static\(distDir/.test(SPA), 'dist statigi yok');
  assert.ok(/express\.static\(prevDir/.test(SPA), 'dist_prev statigi yok');
  const auth = konum(/initAuth\(app\)/, 'initAuth(app)');
  const statik = konum(/statikVarliklariKur\(app, \{/, 'statikVarliklariKur cagrisi');
  assert.ok(statik < auth, 'statik varliklar oturumdan SONRA kayitli');
});

test("kaynak: index.html, 404 bekcisi ve SPA fallback modul dongusunden (oturum) ve /api 404'unden SONRA", () => {
  const dongu = konum(/for \(const \{ name, init, optional \} of modules\)/, 'modul dongusu');
  const authKayit = konum(/\{ name: "auth", init: \(\) => initAuth\(app\)/, 'auth modulu');
  assert.ok(authKayit < dongu);
  const api404 = konum(/app\.use\("\/api", \(req, res\) =>/, '/api 404');
  const spa = konum(/spaSunumunuKur\(app, \{ distDir, prodDist \}\)/, 'spaSunumunuKur cagrisi');
  assert.ok(spa > dongu, 'SPA sunumu oturumdan once kayitli');
  assert.ok(spa > api404, 'SPA sunumu /api 404 bekcisinden once kayitli');
  const spaFn = konum(/function spaSunumunuKur\(/, 'spaSunumunuKur', SPA);
  const index = konum(
    /app\.get\(\["\/", "\/index\.html"\], sendIndexHtml\)/,
    'index.html rotasi',
    SPA,
  );
  const bekci = konum(/\.status\(404\) \.type\("text\/plain"\)/, '404 bekcisi', SPA);
  const fallback = konum(
    /app\.get\(\/\^\\\/\(\?!api\\\/\)\.\*\/, sendIndexHtml\)/,
    'SPA fallback',
    SPA,
  );
  assert.ok(index > spaFn, 'index.html rotasi spaSunumunuKur disinda');
  assert.ok(bekci > index, '404 bekcisi index.html rotasindan once');
  assert.ok(fallback > bekci, 'SPA fallback 404 bekcisinden once');
});

test('kaynak: cache basliklari korunur', () => {
  assert.match(SPA, /express\.static\(distDir, \{ maxAge: "1y", immutable: true, index: false,/);
  assert.match(
    SPA,
    /express\.static\(prevDir, \{ maxAge: "1y", immutable: true, index: false \}\)/,
  );
});

// ── Davranis ────────────────────────────────────────────────────────────────
function iste(port, yol, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: yol, method }, (res) => {
      let govde = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (govde += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, govde }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('davranis: varlik oturumsuz servis edilir; html/api/eksik varlik oturumdan gecer', async () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'statik-oturum-'));
  const dist = path.join(kok, 'dist');
  const prev = path.join(kok, 'dist_prev');
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(dist, 'api'), { recursive: true });
  fs.mkdirSync(path.join(prev, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), 'HAM-INDEX');
  fs.writeFileSync(path.join(dist, 'assets', 'app-abc.js'), 'YENI');
  fs.writeFileSync(path.join(dist, 'api', 'gizli'), 'STATIK-API');
  fs.writeFileSync(path.join(prev, 'assets', 'eski-xyz.js'), 'ESKI');
  fs.writeFileSync(path.join(prev, 'index.html'), 'ESKI-INDEX');

  const app = express();
  app.disable('x-powered-by');
  app.use(statikOnceKatman(express.static(dist, { maxAge: '1y', immutable: true, index: false })));
  app.use(statikOnceKatman(express.static(prev, { maxAge: '1y', immutable: true, index: false })));
  let oturum = 0;
  app.use((req, _res, next) => {
    oturum++;
    next();
  });
  app.get('/api/gizli', (_req, res) => res.json({ ok: true, kaynak: 'rota' }));
  app.get(['/', '/index.html'], (_req, res) => res.type('html').send('SURUMLU-INDEX'));
  app.get(/^\/(?:assets\/|.*\.(?:js|css)$)/, (_req, res) => res.status(404).send('YOK'));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.type('html').send('SURUMLU-INDEX'));

  const sunucu = app.listen(0, '127.0.0.1');
  await new Promise((r) => sunucu.once('listening', r));
  const { port } = sunucu.address();
  try {
    let r = await iste(port, '/assets/app-abc.js');
    assert.equal(r.status, 200);
    assert.equal(r.govde, 'YENI');
    assert.match(r.headers['cache-control'], /max-age=31536000/);
    assert.match(r.headers['cache-control'], /immutable/);
    r = await iste(port, '/assets/eski-xyz.js');
    assert.equal(r.govde, 'ESKI');
    r = await iste(port, '/assets/app-abc.js', 'HEAD');
    assert.equal(r.status, 200);
    assert.equal(oturum, 0, 'varlik istekleri oturum katmanindan gecti');

    for (const yol of ['/', '/index.html', '/INDEX.HTML', '/%69ndex.html', '/derin/sayfa']) {
      const once = oturum;
      r = await iste(port, yol);
      assert.equal(r.govde, 'SURUMLU-INDEX', `${yol} ham/eski index.html dondu`);
      assert.equal(oturum, once + 1, `${yol} oturumdan gecmedi`);
    }

    for (const yol of ['/api/gizli', '/API/gizli', '/%61pi/gizli']) {
      const once = oturum;
      r = await iste(port, yol);
      assert.notEqual(r.govde, 'STATIK-API', `${yol} statik katmandan servis edildi`);
      assert.equal(oturum, once + 1, `${yol} oturumdan gecmedi`);
    }

    const once = oturum;
    r = await iste(port, '/assets/olmayan.js');
    assert.equal(r.status, 404);
    assert.equal(r.govde, 'YOK');
    assert.equal(oturum, once + 1, 'eksik varlik 404 bekcisine oturumdan gecerek ulasmali');

    r = await iste(port, '/%E0%A4%A');
    assert.equal(r.govde, 'SURUMLU-INDEX', 'cozulemeyen adres sonraki zincire gitmeli');
  } finally {
    await new Promise((r) => sunucu.close(r));
    fs.rmSync(kok, { recursive: true, force: true });
  }
});
