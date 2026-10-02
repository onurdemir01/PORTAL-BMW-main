// server/auth/__tests__/aktif-oturumlar.test.cjs
//
// AKTIF OTURUMLAR (Faz D, 2026-10-02). Gercek initAuth + MemoryStore + HTTP.
//
//   AK1 kendi oturumlarini listeler; "bu oturum" isaretli; oturum anahtari (sid) YANITTA YOK
//   AK2 tek oturumu kapatir -> o cihaz 401; bu oturum kapatilamaz (400); bilinmeyen 404
//   AK3 BASKASININ oturumu kapatilamaz (kimlik yalnizca kendi listesinde aranir)
//   AK4 "digerlerinin hepsinden cik": bu oturum kalir
//   AK5 admin: User 403; Admin listeler ve sonlandirir; denetime by=admin yazilir
//   AK6 esanli sinir: en eski oturum kapanir, yanitta closedOthers
//   AK7 suresi dolan oturum denetime sebebiyle yazilir (session_expired reason=idle)
//   AK8 cihaz ozeti
//   AK9 suresi dolmus ama henuz silinmemis oturum listelenmez
'use strict';

const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_STORE = 'memory';
process.env.LOCAL_USER = 'yereluser';
process.env.LOCAL_USER_PASS = 'Guclu-Sifre-123!';
process.env.LOCAL_ADMIN_USER = 'yereladmin';
process.env.LOCAL_ADMIN_PASS = 'Guclu-Admin-456!';
delete process.env.LDAP_URL;

const db = require('../../db/index.cjs');
db.query = async () => ({ rows: [], rowCount: 0 });

const audit = require('../../audit/index.cjs');
let denetimler = [];
audit.auditPortal = (req, action, opts = {}) => denetimler.push({ action, ...opts });

const express = require('express');
const policy = require('../session-policy.cjs');
const throttle = require('../login-throttle.cjs');
const { initAuth } = require('../index.cjs');
const { cihazOzeti } = require('../sessions-routes.cjs');

const DK = 60 * 1000;
let simdi = Date.now();
policy._saatAyarla(() => simdi);

const app = express();
initAuth(app);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
after(() => {
  server.close();
  policy._saatAyarla(null);
});

beforeEach(() => {
  denetimler = [];
  delete process.env.SESSION_MAX_CONCURRENT;
  throttle._sifirla();
});

const UA = {
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
};

async function giris(username = 'yereluser', ua = UA.win) {
  const password = username === 'yereladmin' ? 'Guclu-Admin-456!' : 'Guclu-Sifre-123!';
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': ua },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(r.status, 200);
  return { cerez: (r.headers.get('set-cookie') || '').split(';')[0], body: await r.json() };
}

function iste(cerez, yol, method = 'GET') {
  return fetch(`${base}${yol}`, { method, headers: { cookie: cerez } });
}

async function hepsiniKapat() {
  // Onceki testlerin oturumlari karismasin: admin ile iki kullanicinin tum oturumlari.
  const a = await giris('yereladmin');
  await iste(a.cerez, '/api/auth/sessions/admin/yereluser', 'DELETE');
  await iste(a.cerez, '/api/auth/sessions?scope=others', 'DELETE');
  await iste(a.cerez, '/api/auth/logout', 'POST');
  denetimler = [];
}

test('AK1 kendi oturumlarini listeler; sid yanitta yok', async () => {
  await hepsiniKapat();
  const a = await giris('yereluser', UA.win);
  const b = await giris('yereluser', UA.mac);
  const r = await iste(a.cerez, '/api/auth/sessions');
  const ham = await r.text();
  const d = JSON.parse(ham);
  assert.equal(d.sessions.length, 2);
  assert.equal(d.sessions.filter((s) => s.current).length, 1);
  assert.equal(d.sessions[0].current, true, 'bu oturum basta degil');
  assert.equal(d.sessions[0].device, 'Chrome · Windows');
  assert.equal(d.sessions[1].device, 'Safari · macOS');
  for (const c of [a.cerez, b.cerez]) {
    const sid = decodeURIComponent(c.split('=')[1]).replace(/^s:/, '').split('.')[0];
    assert.ok(!ham.includes(sid), 'oturum anahtari istemciye sizdi');
  }
  assert.ok(d.sessions.every((s) => /^[0-9a-f]{8}$/.test(s.id)));
});

test('AK2 tek oturumu kapatir; bu oturum kapatilamaz; bilinmeyen 404', async () => {
  await hepsiniKapat();
  const a = await giris();
  const b = await giris('yereluser', UA.mac);
  const l = (await (await iste(a.cerez, '/api/auth/sessions')).json()).sessions;
  const bId = l.find((s) => !s.current).id;
  const aId = l.find((s) => s.current).id;
  assert.equal((await iste(a.cerez, `/api/auth/sessions/${aId}`, 'DELETE')).status, 400);
  assert.equal((await iste(a.cerez, '/api/auth/sessions/deadbeef', 'DELETE')).status, 404);
  const r = await iste(a.cerez, `/api/auth/sessions/${bId}`, 'DELETE');
  assert.equal(r.status, 200);
  assert.equal((await iste(b.cerez, '/api/auth/me')).status, 401, 'kapatilan cihaz hala iceride');
  assert.equal((await iste(a.cerez, '/api/auth/me')).status, 200);
  assert.ok(denetimler.some((x) => x.action === 'session_revoked' && /by=self id=/.test(x.detail)));
});

test('AK3 baskasinin oturumu kapatilamaz', async () => {
  await hepsiniKapat();
  const kurban = await giris('yereladmin');
  const kurbanId = (await (await iste(kurban.cerez, '/api/auth/sessions')).json()).sessions[0].id;
  const saldirgan = await giris('yereluser');
  const r = await iste(saldirgan.cerez, `/api/auth/sessions/${kurbanId}`, 'DELETE');
  assert.equal(r.status, 404);
  // Hedef kullanici HICBIR istek parametresinden alinmaz (yalnizca oturumdaki kimlik).
  for (const q of ['?u=yereladmin', '?username=yereladmin', '?user=yereladmin']) {
    assert.equal((await iste(saldirgan.cerez, `/api/auth/sessions/${kurbanId}${q}`, 'DELETE')).status, 404, q);
  }
  const liste = await (await iste(saldirgan.cerez, '/api/auth/sessions?u=yereladmin&username=yereladmin')).json();
  assert.ok(liste.sessions.every((x) => x.id !== kurbanId), 'baskasinin oturumu listede');
  assert.equal((await iste(kurban.cerez, '/api/auth/me')).status, 200, 'baskasinin oturumu kapandi');
  // Admin uclari da User'a kapali.
  assert.equal((await iste(saldirgan.cerez, '/api/auth/sessions/admin/yereladmin')).status, 403);
  assert.equal((await iste(saldirgan.cerez, '/api/auth/sessions/admin/yereladmin', 'DELETE')).status, 403);
  assert.equal((await iste(kurban.cerez, '/api/auth/me')).status, 200);
});

test('AK4 digerlerinin hepsinden cik: bu oturum kalir', async () => {
  await hepsiniKapat();
  const a = await giris();
  const b = await giris();
  const c = await giris();
  const r = await (await iste(a.cerez, '/api/auth/sessions?scope=others', 'DELETE')).json();
  assert.equal(r.revoked, 2);
  assert.equal((await iste(a.cerez, '/api/auth/me')).status, 200);
  assert.equal((await iste(b.cerez, '/api/auth/me')).status, 401);
  assert.equal((await iste(c.cerez, '/api/auth/me')).status, 401);
  assert.equal((await iste(a.cerez, '/api/auth/sessions', 'DELETE')).status, 400, 'scope olmadan toplu silme');
});

test('AK5 admin listeler ve sonlandirir; denetime by=admin', async () => {
  await hepsiniKapat();
  const u1 = await giris();
  const u2 = await giris('yereluser', UA.mac);
  const admin = await giris('yereladmin');
  const l = (await (await iste(admin.cerez, '/api/auth/sessions/admin/YerelUser')).json()).sessions;
  assert.equal(l.length, 2);
  assert.ok(l.every((s) => !s.current));
  const tek = await iste(admin.cerez, `/api/auth/sessions/admin/yereluser?id=${l[0].id}`, 'DELETE');
  assert.equal((await tek.json()).revoked, 1);
  const r = await (await iste(admin.cerez, '/api/auth/sessions/admin/yereluser', 'DELETE')).json();
  assert.equal(r.revoked, 1);
  assert.equal((await iste(u1.cerez, '/api/auth/me')).status, 401);
  assert.equal((await iste(u2.cerez, '/api/auth/me')).status, 401);
  assert.equal((await iste(admin.cerez, '/api/auth/me')).status, 200);
  assert.ok(denetimler.some((x) => x.action === 'session_revoked' && /by=admin target=yereluser/.test(x.detail)));
});

test('AK6 esanli sinir: en eski oturum kapanir, closedOthers soylenir', async () => {
  await hepsiniKapat();
  process.env.SESSION_MAX_CONCURRENT = '2';
  const a = await giris();
  simdi += 2 * DK;
  const b = await giris();
  simdi += 2 * DK;
  await iste(a.cerez, '/api/test-yok'); // a daha yeni etkinlik — b en eski olmali
  simdi += 2 * DK;
  await iste(a.cerez, '/api/auth/session/extend', 'POST');
  const c = await giris();
  assert.equal(c.body.closedOthers, 1);
  assert.equal((await iste(b.cerez, '/api/auth/me')).status, 401, 'en eski (son etkinligi en eski) kapanmadi');
  assert.equal((await iste(a.cerez, '/api/auth/me')).status, 200);
  assert.equal((await iste(c.cerez, '/api/auth/me')).status, 200);
  assert.ok(denetimler.some((x) => x.action === 'session_revoked' && /by=concurrency max=2 count=1/.test(x.detail)));
  delete process.env.SESSION_MAX_CONCURRENT;
  const d = await giris();
  assert.equal(d.body.closedOthers, 0, 'sinir kapaliyken oturum kapandi');
});

test('AK7 suresi dolan oturum denetime sebebiyle yazilir', async () => {
  await hepsiniKapat();
  const a = await giris();
  simdi += 61 * DK;
  assert.equal((await iste(a.cerez, '/api/auth/me')).status, 401);
  const k = denetimler.find((x) => x.action === 'session_expired');
  assert.ok(k, 'session_expired yazilmadi');
  assert.equal(k.username, 'yereluser');
  assert.match(k.detail, /reason=idle id=[0-9a-f]{8} ageMin=61/);
});

test('AK9 bosta kalma suresi dolmus (henuz silinmemis) oturum acik listelenmez', async () => {
  await hepsiniKapat();
  const a = await giris();
  await giris('yereluser', UA.mac); // bu oturum bir daha kullanilmayacak
  simdi += 50 * DK;
  await iste(a.cerez, '/api/auth/session/extend', 'POST');
  simdi += 11 * DK; // ikinci oturum 61 dk bosta: yaptirim acisindan bitti, store'da duruyor
  const l = (await (await iste(a.cerez, '/api/auth/sessions')).json()).sessions;
  assert.equal(l.length, 1, 'bitmis oturum "acik" diye listelendi');
  assert.equal(l[0].current, true);
});

test('AK8 cihaz ozeti', () => {
  assert.equal(cihazOzeti(UA.win), 'Chrome · Windows');
  assert.equal(cihazOzeti(UA.mac), 'Safari · macOS');
  assert.equal(cihazOzeti('Mozilla/5.0 (Windows NT 10.0) Chrome/129 Safari/537.36 Edg/129'), 'Edge · Windows');
  assert.equal(cihazOzeti('Mozilla/5.0 (Linux; Android 14) Chrome/129 Mobile Safari/537.36'), 'Chrome · Android');
  assert.equal(cihazOzeti('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17 Mobile Safari/604.1'), 'Safari · iOS');
  assert.equal(cihazOzeti('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko Firefox/130.0'), 'Firefox · Linux');
  assert.equal(cihazOzeti(''), 'Bilinmiyor');
});
