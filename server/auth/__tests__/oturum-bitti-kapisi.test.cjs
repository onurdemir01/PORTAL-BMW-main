// Oturum-bitti imzasi (P1-3). Kapi, yalnizca OTURUM 401'lerinin istemciyi
// giris ekranina dusurmesini saglar; ust servisten yansiyan 401'ler (AWX
// token'i dusmesi gibi) kullaniciyi portaldan ATMAMALIDIR.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const KOK = path.join(__dirname, '..', '..', '..');
const oku = (p) => fs.readFileSync(path.join(KOK, p), 'utf8');

/** Yorumlari soyar — bekci KODA baksin, kendi aciklamasina degil. */
function kodOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Fail-closed dilim: sinir bulunamazsa testi DUSUR, sessizce bos dilim dondurme. */
function dilim(src, bas, son) {
  const i = src.indexOf(bas);
  assert.ok(i >= 0, `dilim baslangici bulunamadi: ${bas}`);
  const j = src.indexOf(son, i + bas.length);
  assert.ok(j > i, `dilim sonu bulunamadi: ${son}`);
  return src.slice(i, j);
}

async function istek(kurucu, yol) {
  const app = express();
  kurucu(app);
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}${yol}`);
    return { status: r.status, imza: r.headers.get('x-portal-session') };
  } finally {
    srv.close();
  }
}

test('OB1 — requireAuth 401i CANLI olarak imzalar', async () => {
  const { requireAuth } = require('../index.cjs');
  const r = await istek((app) => app.get('/x', requireAuth, (_q, s) => s.json({ ok: true })), '/x');
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.imza, 'expired', 'oturum 401i imzasiz cikti — istemci kapisi HIC ATESLENMEZ');
});

test('OB2 — requireAdmin: oturumsuz 401 imzali, YETKISIZ 403 imzasiz', async () => {
  const { requireAdmin } = require('../index.cjs');
  const yok = await istek((app) => app.get('/x', requireAdmin, (_q, s) => s.json({ ok: true })), '/x');
  assert.strictEqual(yok.status, 401);
  assert.strictEqual(yok.imza, 'expired');

  // Oturum VAR ama rol yetersiz → 403. Bu bitmis bir oturum DEGILDIR; imzalanirsa
  // admin olmayan bir kullanici bir admin ucuna dokundugunda portaldan atilirdi.
  const rolsuz = await istek((app) => {
    app.use((req, _s, next) => { req.session = { user: { username: 'u', role: 'User' } }; next(); });
    app.get('/x', requireAdmin, (_q, s) => s.json({ ok: true }));
  }, '/x');
  assert.strictEqual(rolsuz.status, 403);
  assert.strictEqual(rolsuz.imza, null, 'yetki reddi oturum-bitti sayildi');
});

test('OB3 — govdesiz 401 de imzalanir (avatar ucu)', () => {
  const src = kodOnly(oku('server/auth/presence-routes.cjs'));
  assert.match(
    src,
    /oturumYok\(res\)\.status\(401\)\.end\(\)/,
    'govdesiz 401 imzasiz — baslik yerine govdeye guvenen bir cozum bu ucu kacirirdi',
  );
});

test('OB4 — server/auth icindeki HER oturum 401i oturumYokdan gecer', () => {
  const dosyalar = fs.readdirSync(path.join(KOK, 'server/auth')).filter((f) => f.endsWith('.cjs'));
  const imzasiz = [];
  for (const f of dosyalar) {
    const src = kodOnly(oku(path.join('server/auth', f)));
    for (const satir of src.split('\n')) {
      if (!/\bres\.status\(401\)/.test(satir)) continue;
      if (/oturumYok\(res\)\.status\(401\)/.test(satir)) continue;
      imzasiz.push(`${f}: ${satir.trim()}`);
    }
  }
  // TEK istisna: GIRIS DENEMESININ basarisizligi. Ortada bitmis bir oturum yok;
  // imzalanirsa yanlis parola, giris ekranindaki istemciye "oturumun bitti" derdi.
  assert.strictEqual(imzasiz.length, 1, `beklenmeyen imzasiz 401:\n${imzasiz.join('\n')}`);
  assert.match(imzasiz[0], /index\.cjs.*err\.message/, 'imzasiz kalan tek 401 giris hatasi olmali');
});

test('OB5 — imza capraz kokende OKUNABILIR olsun diye expose edilir', () => {
  const src = kodOnly(oku('server/service.cjs'));
  // Dilim, CORS ara katmaninin `origin === allowedOrigin` DALIDIR: baslik orada
  // degil de disarida/olu bir dalda durursa bekci ateslenmeli.
  const cors = dilim(src, 'Access-Control-Allow-Origin', 'req.method === "OPTIONS"');
  assert.doesNotMatch(cors, /if\s*\(\s*(false|0|null|undefined)\s*\)/, 'CORS dali olu');
  assert.match(
    cors,
    /Access-Control-Expose-Headers[^)]*X-Portal-Session/,
    'expose edilmezse tarayici basligi istemci koduna vermez — kapi gelistirmede SESSIZCE olu kalir',
  );
});

test('OB6 — istemci ile sunucu AYNI baslik adini kullanir', () => {
  const { SESSION_HEADER } = require('../utils.cjs');
  const istemci = oku('src/api/sessionGuard.ts');
  const m = istemci.match(/export const SESSION_HEADER = '([^']+)'/);
  assert.ok(m, 'istemci tarafinda SESSION_HEADER bulunamadi');
  assert.strictEqual(m[1], SESSION_HEADER, 'iki taraf farkli baslik adi kullaniyor — kapi hic atesleyemez');
});
