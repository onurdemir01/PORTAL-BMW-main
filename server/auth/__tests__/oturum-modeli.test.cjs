// server/auth/__tests__/oturum-modeli.test.cjs
//
// OTURUM MODELI (Faz A, 2026-10-02 — kullanici: "login asamasinda cokca atiyor, ne
// kadar bagli kalabilsin ayarlanabilsin"). Kaynak taramasi DEGIL: gercek `initAuth`,
// gercek express-session (MemoryStore), sahte saat ve gercek HTTP istekleri.
//
//   OM1 bosta kalma: sinirdan 1 sn once gecer, sinirda imzali 401 + sebep=idle
//   OM2 mutlak sure: surekli etkin olsa da sinirda 401 + sebep=absolute
//   OM3 arka plan yoklamasi sureyi UZATMAZ; kullanici istegi uzatir; yazma kisitli
//   OM4 ayarlar DINAMIK: process.env degisince bir sonraki istek yeni sureyi kullanir
//   OM5 cerez: beni-hatirla KALICI (Expires), degilse tarayici-oturumu cerezi
//   OM6 Admin beni-hatirla'yi kapatinca istek yok sayilir
//   OM7 suresi dolan cerezle /login calisir (regenerate, cokme yok)
//   OM8 /session etkinlik saymaz; /session/extend kisitlamayi beklemeden uzatir
//   OM9 kunyesiz (eski) oturum ATILMAZ, kunye tamamlanir
//   OM10 bozuk/sinir disi ayar varsayilana duser
'use strict';

const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_STORE = 'memory';
process.env.LOCAL_USER = 'yereluser';
process.env.LOCAL_USER_PASS = 'Guclu-Sifre-123!';
process.env.LOCAL_ADMIN_USER = 'yereladmin';
process.env.LOCAL_ADMIN_PASS = 'Guclu-Admin-456!';

// DB'ye gidilmesin (rol override / giris kaydi / denetim): hepsi bos doner.
const db = require('../../db/index.cjs');
db.query = async () => ({ rows: [], rowCount: 0 });

const express = require('express');
const policy = require('../session-policy.cjs');
const { initAuth, requireAuth } = require('../index.cjs');

const DK = 60 * 1000;
const SA = 60 * DK;
let simdi = Date.UTC(2026, 9, 2, 8, 0, 0);
policy._saatAyarla(() => simdi);

const app = express();
initAuth(app);
app.get('/api/test/ping', requireAuth, (req, res) => res.json({ ok: true }));
app.get('/api/users/online', requireAuth, (req, res) => res.json({ ok: true }));

let base;
const server = app.listen(0);
base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

const ENV = ['SESSION_IDLE_MINUTES', 'SESSION_ABSOLUTE_HOURS', 'SESSION_REMEMBER_DAYS', 'SESSION_WARN_SECONDS'];
beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  simdi = Date.UTC(2026, 9, 2, 8, 0, 0);
});

async function giris(body = {}) {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'yereluser', password: 'Guclu-Sifre-123!', ...body }),
  });
  assert.equal(r.status, 200, `giris basarisiz: ${await r.clone().text()}`);
  const setCookie = r.headers.get('set-cookie') || '';
  const cerez = setCookie.split(';')[0];
  assert.match(cerez, /^connect\.sid=/, 'giriste cerez yok');
  return { cerez, setCookie, body: await r.json() };
}

function iste(cerez, yol = '/api/test/ping', opt = {}) {
  return fetch(`${base}${yol}`, { ...opt, headers: { cookie: cerez, ...(opt.headers || {}) } });
}

test('OM1 bosta kalma: sinirdan 1 sn once gecer, sinirda imzali 401 + sebep idle', async () => {
  const { cerez } = await giris();
  simdi += 60 * DK - 1000;
  const r1 = await iste(cerez);
  assert.equal(r1.status, 200, 'sinirdan once atildi');
  // r1 bir kullanici istegi: lastSeenAt ilerledi. Yeni sinir oradan 60 dk.
  simdi += 60 * DK;
  const r2 = await iste(cerez);
  assert.equal(r2.status, 401, 'bosta kalma suresi dolunca hala iceride');
  assert.equal(r2.headers.get('x-portal-session'), 'expired', '401 imzasiz — istemci kapisi ateslenmez');
  assert.equal(r2.headers.get('x-portal-session-reason'), 'idle');
  // Oturum gercekten SILINDI: sonraki istek de 401 (sebep artik bilinmez).
  const r3 = await iste(cerez);
  assert.equal(r3.status, 401);
});

test('OM2 mutlak sure: surekli etkin olsa da 12 sa sinirinda 401 + sebep absolute', async () => {
  const { cerez } = await giris();
  // Her 30 dk bir kullanici istegi: bosta kalma hic dolmaz.
  for (let t = 30 * DK; t < 12 * SA; t += 30 * DK) {
    simdi = Date.UTC(2026, 9, 2, 8, 0, 0) + t;
    const r = await iste(cerez);
    assert.equal(r.status, 200, `etkin kullanici ${t / DK}. dakikada atildi`);
  }
  simdi = Date.UTC(2026, 9, 2, 8, 0, 0) + 12 * SA - 1000;
  assert.equal((await iste(cerez)).status, 200, 'mutlak sinirdan 1 sn once atildi');
  simdi += 1000;
  const r = await iste(cerez);
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('x-portal-session-reason'), 'absolute');
});

test('OM3 arka plan yoklamasi UZATMAZ, kullanici istegi uzatir, yazma kisitli', async () => {
  const { cerez } = await giris();
  const t0 = simdi;
  // 59 dk boyunca yalnizca yoklama (Dashboard / basligi isaretli istek).
  for (let t = 5 * DK; t < 60 * DK; t += 5 * DK) {
    simdi = t0 + t;
    assert.equal((await iste(cerez, '/api/users/online')).status, 200);
    assert.equal(
      (await iste(cerez, '/api/test/ping', { headers: { 'x-portal-activity': 'background' } })).status,
      200,
    );
  }
  const r0 = await iste(cerez, '/api/users/online');
  assert.equal(Number(r0.headers.get('x-portal-session-expires')), t0 + 60 * DK, 'yoklama sureyi uzatti');
  simdi = t0 + 60 * DK;
  const r = await iste(cerez, '/api/users/online');
  assert.equal(r.status, 401, 'yalnizca yoklama yapan sekme oturumu acik tuttu');
  assert.equal(r.headers.get('x-portal-session-reason'), 'idle');

  // Kullanici istegi uzatir — ama 60 sn'den sik YAZILMAZ.
  const { cerez: c2 } = await giris();
  const t1 = simdi;
  simdi = t1 + 30 * 1000;
  const a = await iste(c2);
  assert.equal(Number(a.headers.get('x-portal-session-expires')), t1 + 60 * DK, '60 sn icinde yeniden yazildi');
  simdi = t1 + 61 * 1000;
  const b = await iste(c2);
  assert.equal(Number(b.headers.get('x-portal-session-expires')), simdi + 60 * DK, 'kullanici istegi uzatmadi');
});

test('OM4 ayarlar dinamik: env degisince bir sonraki istek yeni sureyi kullanir', async () => {
  const { cerez } = await giris();
  const t0 = simdi;
  process.env.SESSION_IDLE_MINUTES = '5';
  simdi = t0 + 5 * DK - 1000;
  const r1 = await iste(cerez, '/api/users/online');
  assert.equal(r1.status, 200);
  assert.equal(Number(r1.headers.get('x-portal-session-expires')), t0 + 5 * DK, 'yeni sure okunmadi (boot`ta donmus)');
  simdi = t0 + 5 * DK;
  assert.equal((await iste(cerez, '/api/users/online')).status, 401, '5 dk ayari uygulanmadi');

  process.env.SESSION_IDLE_MINUTES = '';
  process.env.SESSION_ABSOLUTE_HOURS = '1';
  const { cerez: c2 } = await giris();
  const t1 = simdi;
  simdi = t1 + SA;
  const r = await iste(c2);
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('x-portal-session-reason'), 'absolute');
});

test('OM5 cerez: beni-hatirla KALICI (Expires = mutlak sinir), degilse oturum cerezi', async () => {
  const normal = await giris();
  assert.doesNotMatch(normal.setCookie, /Expires=|Max-Age=/i, 'beni-hatirla yokken cerez kalici');
  assert.match(normal.setCookie, /HttpOnly/i);
  assert.equal(normal.body.session.remember, false);

  const t0 = simdi;
  const hatirla = await giris({ remember: true });
  const m = hatirla.setCookie.match(/Expires=([^;]+)/i);
  assert.ok(m, 'beni-hatirla cerezi kalici degil');
  assert.equal(Date.parse(m[1]), Math.floor((t0 + 7 * 24 * SA) / 1000) * 1000, 'kalici cerez 7 gun degil');
  assert.equal(hatirla.body.session.remember, true);
  assert.equal(hatirla.body.session.absoluteExpiresAt, t0 + 7 * 24 * SA);

  // rolling: sonraki yanitta da gelir ve sinir KAYMAZ (her istekte 7 gun ileri gitmez).
  simdi = t0 + 30 * DK;
  const r = await iste(hatirla.cerez);
  const m2 = (r.headers.get('set-cookie') || '').match(/Expires=([^;]+)/i);
  assert.ok(m2, 'rolling yok — eski kalici cerezler yeni modele gecmez');
  assert.equal(Date.parse(m2[1]), Math.floor((t0 + 7 * 24 * SA) / 1000) * 1000, 'kalici cerezin siniri kaydi');

  // Beni-hatirla da BOSTA KALMA kuralina tabidir.
  simdi += 60 * DK;
  const r2 = await iste(hatirla.cerez);
  assert.equal(r2.status, 401);
  assert.equal(r2.headers.get('x-portal-session-reason'), 'idle');
});

test('OM6 Admin beni-hatirla`yi kapatinca istek yok sayilir', async () => {
  process.env.SESSION_REMEMBER_DAYS = '0';
  const g = await giris({ remember: true });
  assert.doesNotMatch(g.setCookie, /Expires=/i);
  assert.equal(g.body.session.remember, false);
  assert.equal(g.body.session.absoluteExpiresAt - simdi, 12 * SA);
  const p = await (await fetch(`${base}/api/auth/session-policy`)).json();
  assert.equal(p.rememberEnabled, false);
});

test('OM7 suresi dolan cerezle /login calisir', async () => {
  const { cerez } = await giris();
  simdi += 61 * DK;
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cerez },
    body: JSON.stringify({ username: 'yereluser', password: 'Guclu-Sifre-123!' }),
  });
  assert.equal(r.status, 200, 'suresi dolan oturum yeniden girisi engelledi');
  const yeni = (r.headers.get('set-cookie') || '').split(';')[0];
  assert.equal((await iste(yeni)).status, 200);
});

test('OM8 /session etkinlik saymaz; /session/extend kisitlamayi beklemeden uzatir', async () => {
  const { cerez } = await giris();
  const t0 = simdi;
  simdi = t0 + 10 * DK;
  const s = await (await iste(cerez, '/api/auth/session')).json();
  assert.equal(s.idleExpiresAt, t0 + 60 * DK, 'saat sorgusu oturumu uzatti');
  assert.equal(s.warnSeconds, 120);
  simdi = t0 + 10 * DK + 5000;
  // Bir kullanici istegi az once yazdi; extend YINE yazmali (kisitlama ona uygulanmaz).
  await iste(cerez);
  simdi += 20 * 1000;
  const e = await (await iste(cerez, '/api/auth/session/extend', { method: 'POST' })).json();
  assert.equal(e.idleExpiresAt, simdi + 60 * DK, 'extend sureyi uzatmadi');
  const yok = await fetch(`${base}/api/auth/session`);
  assert.equal(yok.status, 401);
  assert.equal(yok.headers.get('x-portal-session'), 'expired');
});

test('OM9 kunyesiz (eski) oturum ATILMAZ, kunye tamamlanir', () => {
  const now = Date.UTC(2026, 9, 2, 12, 0, 0);
  const sess = { user: { username: 'u', loginAt: new Date(now - 7 * SA).toISOString() } };
  assert.equal(policy.eksikMetaTamamla(sess, now), true);
  assert.equal(sess.meta.createdAt, now - 7 * SA, 'mutlak sure girisin kendisinden sayilmali');
  assert.equal(sess.meta.lastSeenAt, now, 'bosta kalma simdiden baslamali — eski oturum hemen atilir');
  const { idleExpiresAt, absoluteExpiresAt } = policy.bitisler(sess.meta, policy.policy());
  assert.ok(idleExpiresAt > now && absoluteExpiresAt > now);
  // Gelecekteki / bozuk loginAt guvenle "simdi"ye duser.
  const s2 = { user: { username: 'u', loginAt: 'bozuk' } };
  policy.eksikMetaTamamla(s2, now);
  assert.equal(s2.meta.createdAt, now);
  // Kunyesi tam olan oturuma dokunulmaz.
  assert.equal(policy.eksikMetaTamamla(sess, now + 1000), false);
});

test('OM10 bozuk / sinir disi ayar varsayilana duser', () => {
  process.env.SESSION_IDLE_MINUTES = '1';
  process.env.SESSION_ABSOLUTE_HOURS = 'abc';
  process.env.SESSION_REMEMBER_DAYS = '90';
  const p = policy.policy();
  assert.equal(p.idleMs, 60 * DK);
  assert.equal(p.absoluteMs, 12 * SA);
  assert.equal(p.rememberMs, 7 * 24 * SA);
  process.env.SESSION_IDLE_MINUTES = '720';
  assert.equal(policy.policy().idleMs, 720 * DK, 'ust sinir kabul edilmeli');
});
