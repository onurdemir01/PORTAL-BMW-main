'use strict';
// STATIK VARLIKLAR OTURUMDAN ONCE (2026-11-12) - bekci.
//
// Hash'li chunk/font istekleri express-session'dan gecmemeli (her dosya icin
// portal_sessions SELECT + lastSeen). AMA index.html (kullaniciya ozel tema, surumlu
// favicon), 404 bekcisi ve SPA fallback oturumdan SONRA kalmali; /api asla statik
// katmandan servis edilmemeli.
//
// Iki katman:
//   1) Kaynak sirasi (server/index.cjs okunur, require EDILMEZ - main() calisirdi).
//   2) Davranis: index.cjs'teki GERCEK statikOnceKatman govdesi isaretler arasindan
//      cikarilip gercek express + express.static ile kosulur.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const KAYNAK = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
// Bicim degil kural: bosluk/tirnak normalize (prettier'a dayanikli).
const NORM = KAYNAK.replace(/\s+/g, ' ').replace(/'/g, '"');

function konum(desen, ad) {
  const m = desen.exec(NORM);
  assert.ok(m, `${ad} bulunamadi`);
  return m.index;
}

test('kaynak: express.static yalniz statikOnceKatman icinde ve initAuth ONCESINDE', () => {
  const auth = konum(/initAuth\(app\)/, 'initAuth(app)');
  const statikler = [...NORM.matchAll(/express\.static\(/g)].map((m) => m.index);
  assert.ok(statikler.length >= 2, 'dist ve dist_prev statik katmanlari yok');
  for (const i of statikler) {
    assert.ok(i < auth, 'oturumdan SONRA kayitli bir express.static var');
    const once = NORM.slice(Math.max(0, i - 40), i);
    assert.match(once, /statikOnceKatman\( ?$/, 'express.static statikOnceKatman ile sarilmamis');
  }
  assert.ok(/express\.static\(distDir/.test(NORM), 'dist statigi yok');
  assert.ok(/express\.static\(prevDir/.test(NORM), 'dist_prev statigi yok');
});

test('kaynak: index.html, 404 bekcisi ve SPA fallback modul dongusunden (oturum) SONRA', () => {
  const dongu = konum(/for \(const \{ name, init, optional \} of modules\)/, 'modul dongusu');
  const authKayit = konum(/\{ name: "auth", init: \(\) => initAuth\(app\)/, 'auth modulu');
  assert.ok(authKayit < dongu);
  const index = konum(/app\.get\(\["\/", "\/index\.html"\], sendIndexHtml\)/, 'index.html rotasi');
  const bekci = konum(/\.status\(404\) \.type\("text\/plain"\)/, '404 bekcisi');
  const fallback = konum(/app\.get\(\/\^\\\/\(\?!api\\\/\)\.\*\/, sendIndexHtml\)/, 'SPA fallback');
  assert.ok(index > dongu, 'index.html rotasi oturumdan once');
  assert.ok(bekci > index, '404 bekcisi index.html rotasindan once');
  assert.ok(fallback > bekci, 'SPA fallback 404 bekcisinden once');
});

test('kaynak: cache basliklari korunur', () => {
  assert.match(NORM, /express\.static\(distDir, \{ maxAge: "1y", immutable: true, index: false,/);
  assert.match(NORM, /express\.static\(prevDir, \{ maxAge: "1y", immutable: true, index: false \}\)/);
});

// ── Davranis ────────────────────────────────────────────────────────────────
function katmaniYukle() {
  const m = /\/\/ <statik-once-katman>([\s\S]*?)\/\/ <\/statik-once-katman>/.exec(KAYNAK);
  assert.ok(m, 'statik-once-katman isaretleri yok');
  return new Function(`${m[1]}\nreturn statikOnceKatman;`)();
}

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
  const statikOnceKatman = katmaniYukle();
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
