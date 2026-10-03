// server/auth/__tests__/oturum-sertlestirme.test.cjs
//
// OTURUM SERTLESTIRME (Faz E, 2026-10-02).
//
//   OS1 cerez adi: production'da __Host-portal.sid; gelistirmede connect.sid; __Host-
//       production disinda SECILEMEZ (tarayici reddeder, kimse giremezdi)
//   OS2 gecis KIMSEYI ATMAZ: eski connect.sid ile gelen oturum bulunur, yeni ad yazilir,
//       eski cerez silinir
//   OS3 koken kontrolu: yabanci koken 403; ayni Host gecer; GET etkilenmez; basliksiz
//       (betik) gecer; Origin null reddedilir; Referer yedegi; ek izinli liste; mod log/off
//   OS4 koken kontrolu TUM /api route'larindan ONCE baglanir (service.cjs)
//   OS5b sistem ayari PUT gecersiz degeri yazmaz (HTTP)
//   OS6 initAuth cerez adini gercekten kullanir
//   OS5 oturum ayarlari kaydetmeden once dogrulanir; sicak yuklenir ve ekranda gorunur
'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const session = require('express-session');

const cerez = require('../oturum-cerezi.cjs');
const { originKontrolu, kokenUygunMu } = require('../origin-kontrolu.cjs');
const { oturumAyariHatasi, OTURUM_AYAR_ANAHTARLARI } = require('../oturum-ayarlari.cjs');

const ROOT = path.join(__dirname, '..', '..', '..');

function ortam(env, fn) {
  const eski = {};
  for (const k of Object.keys(env)) {
    eski[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (eski[k] === undefined) delete process.env[k];
      else process.env[k] = eski[k];
    }
  }
}

async function ortamA(env, fn) {
  const eski = {};
  for (const k of Object.keys(env)) {
    eski[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (eski[k] === undefined) delete process.env[k];
      else process.env[k] = eski[k];
    }
  }
}

test('OS1 cerez adi ortama gore; __Host- production disinda secilemez', () => {
  ortam({ NODE_ENV: 'production', SESSION_COOKIE_NAME: undefined }, () => assert.equal(cerez.cerezAdi(), '__Host-portal.sid'));
  ortam({ NODE_ENV: 'development', SESSION_COOKIE_NAME: undefined }, () => assert.equal(cerez.cerezAdi(), 'connect.sid'));
  ortam({ NODE_ENV: 'development', SESSION_COOKIE_NAME: '__Host-x' }, () => assert.equal(cerez.cerezAdi(), 'connect.sid'));
  ortam({ NODE_ENV: 'production', SESSION_COOKIE_NAME: '__Host-x' }, () => assert.equal(cerez.cerezAdi(), '__Host-x'));
  ortam({ NODE_ENV: 'production', SESSION_COOKIE_NAME: 'kotu;ad' }, () => assert.equal(cerez.cerezAdi(), '__Host-portal.sid'));
});

// Gercek express-session: eski adla imzalanmis cerez yeni adla okunabiliyor mu.
function uygulama(ad) {
  const store = new session.MemoryStore();
  const app = express();
  app.use(cerez.eskiCereziTasi(ad));
  app.use(session({ name: ad, store, secret: 's3cret', resave: false, saveUninitialized: false, rolling: true }));
  app.post('/giris', (req, res) => {
    req.session.user = { username: 'ayse' };
    res.json({ ok: true });
  });
  app.get('/ben', (req, res) => res.json({ user: req.session.user || null }));
  return app;
}

const sunucular = [];
after(() => sunucular.forEach((s) => s.close()));
function dinle(app) {
  const s = app.listen(0);
  sunucular.push(s);
  return `http://127.0.0.1:${s.address().port}`;
}

test('OS2 gecis kimseyi atmaz: eski cerezle oturum bulunur, yeni ad yazilir, eski silinir', async () => {
  // Ayni store'u paylasan "eski surum" (connect.sid) ve "yeni surum" (__Host-...).
  const store = new session.MemoryStore();
  const kur = (ad) => {
    const app = express();
    app.use(cerez.eskiCereziTasi(ad));
    app.use(session({ name: ad, store, secret: 's3cret', resave: false, saveUninitialized: false, rolling: true }));
    app.post('/giris', (req, res) => {
      req.session.user = { username: 'ayse' };
      res.json({ ok: true });
    });
    app.get('/ben', (req, res) => res.json({ user: req.session.user || null }));
    return dinle(app);
  };
  const eski = kur('connect.sid');
  const yeni = kur('__Host-portal.sid');
  const g = await fetch(`${eski}/giris`, { method: 'POST' });
  const eskiCerez = (g.headers.get('set-cookie') || '').split(';')[0];
  assert.match(eskiCerez, /^connect\.sid=/);

  const r = await fetch(`${yeni}/ben`, { headers: { cookie: eskiCerez } });
  assert.deepEqual((await r.json()).user, { username: 'ayse' }, 'gecis kullaniciyi atti');
  const yazilan = r.headers.getSetCookie();
  assert.ok(yazilan.some((c) => c.startsWith('__Host-portal.sid=')), 'yeni ad yazilmadi');
  assert.ok(yazilan.some((c) => /^connect\.sid=;/.test(c) && /Expires=Thu, 01 Jan 1970/.test(c)), 'eski cerez silinmedi');
  // Yeni adla devam.
  const yeniCerez = yazilan.find((c) => c.startsWith('__Host-portal.sid=')).split(';')[0];
  const r2 = await fetch(`${yeni}/ben`, { headers: { cookie: yeniCerez } });
  assert.deepEqual((await r2.json()).user, { username: 'ayse' });
  assert.ok(!r2.headers.getSetCookie().some((c) => c.startsWith('connect.sid')), 'gecis bittikten sonra hala eski cerezle ugrasiyor');
  // Iki ad birden gelirse YENI ad kazanir (eski cerez yeniyi ezemez).
  const r3 = await fetch(`${yeni}/ben`, { headers: { cookie: `connect.sid=s%3Asahte.x; ${yeniCerez}` } });
  assert.deepEqual((await r3.json()).user, { username: 'ayse' });
  assert.ok(
    r3.headers.getSetCookie().some((c) => /^connect\.sid=;/.test(c) && /Expires=Thu, 01 Jan 1970/.test(c)),
    'artakalan eski cerez silinmedi',
  );
  // Gelistirme (ayni ad): dokunulmaz.
  const dev = dinle(uygulama('connect.sid'));
  const d = await fetch(`${dev}/ben`, { headers: { cookie: 'connect.sid=x' } });
  assert.ok(!d.headers.getSetCookie().some((c) => /Expires=Thu, 01 Jan 1970/.test(c)));
});

function istek(method, headers) {
  return { method, headers: { host: 'portal.kurum', ...headers } };
}

test('OS3 koken kontrolu', () => {
  ortam({ PORTAL_ALLOWED_ORIGINS: undefined, CORS_ORIGIN: undefined }, () => {
    assert.equal(kokenUygunMu(istek('POST', { origin: 'https://portal.kurum' })).ok, true);
    assert.equal(kokenUygunMu(istek('POST', { origin: 'https://kotu.example' })).ok, false);
    assert.equal(kokenUygunMu(istek('DELETE', { origin: 'https://portal.kurum.kotu.example' })).ok, false, 'onek eslesmesi');
    assert.equal(kokenUygunMu(istek('GET', { origin: 'https://kotu.example' })).ok, true, 'GET etkilenmemeli');
    assert.equal(kokenUygunMu(istek('POST', {})).ok, true, 'basliksiz betik engellendi');
    assert.equal(kokenUygunMu(istek('POST', { origin: 'null' })).ok, false);
    assert.equal(kokenUygunMu(istek('PUT', { referer: 'https://kotu.example/x' })).ok, false, 'Referer yedegi yok');
    assert.equal(kokenUygunMu(istek('PUT', { referer: 'https://portal.kurum/admin?x=1' })).ok, true);
    assert.equal(kokenUygunMu(istek('POST', { origin: 'bozuk' })).ok, false);
  });
  ortam({ PORTAL_ALLOWED_ORIGINS: 'https://portal.kurum.com.tr/, https://ikinci' }, () => {
    assert.equal(kokenUygunMu(istek('POST', { origin: 'https://portal.kurum.com.tr' })).ok, true);
    assert.equal(kokenUygunMu(istek('POST', { origin: 'https://IKINCI' })).ok, true);
  });
  ortam({ CORS_ORIGIN: 'http://localhost:3000' }, () => {
    assert.equal(kokenUygunMu(istek('POST', { origin: 'http://localhost:3000' })).ok, true);
  });
});

test('OS3b mod: enforce 403 (oturum 401 DEGIL), log gecirir, off gecirir', () => {
  const mw = originKontrolu();
  const calistir = () => {
    let durum = 0;
    let gecti = false;
    const res = { status: (s) => ((durum = s), res), json: () => res };
    mw({ ...istek('POST', { origin: 'https://kotu.example' }), originalUrl: '/api/x', path: '/x' }, res, () => (gecti = true));
    return { durum, gecti };
  };
  ortam({ CSRF_ORIGIN_CHECK: undefined }, () => assert.deepEqual(calistir(), { durum: 403, gecti: false }));
  ortam({ CSRF_ORIGIN_CHECK: 'log' }, () => assert.deepEqual(calistir(), { durum: 0, gecti: true }));
  ortam({ CSRF_ORIGIN_CHECK: 'off' }, () => assert.deepEqual(calistir(), { durum: 0, gecti: true }));
});

test('OS4 koken kontrolu tum /api route`larindan once baglanir', () => {
  const s = fs.readFileSync(path.join(ROOT, 'server/service.cjs'), 'utf8');
  const i = s.indexOf('app.use("/api", originKontrolu());');
  assert.ok(i > 0, 'koken kontrolu baglanmamis');
  const route = /app\.(get|post|put|delete|use)\("\/api\/(?!health)/g;
  let m;
  while ((m = route.exec(s))) {
    if (m.index < i && !s.slice(m.index, m.index + 40).includes('Limiter')) {
      assert.fail(`koken kontrolunden ONCE baglanan route: ${s.slice(m.index, m.index + 60)}`);
    }
  }
  const idx = fs.readFileSync(path.join(ROOT, 'server/index.cjs'), 'utf8');
  assert.ok(idx.indexOf('createApp(') < idx.indexOf('initAuth(app)'), 'moduller service.cjs`ten once baglaniyor');
});

test('OS5b sistem ayari PUT: gecersiz oturum degeri 400 ve YAZILMAZ; gecerli deger yazilir', async () => {
  const db = require('../../db/index.cjs');
  const asil = db.query;
  const yazilan = [];
  db.query = async (sql, params) => {
    if (/portal_env_overrides/.test(sql) && /INSERT|UPDATE|MERGE/i.test(sql)) yazilan.push(params);
    return { rows: [], rowCount: 1 };
  };
  const eskiDeger = process.env.SESSION_IDLE_MINUTES;
  try {
    const app = express();
    app.use((req, _res, next) => {
      req.session = { user: { username: 'adm', role: 'Admin' } };
      next();
    });
    require('../../admin/system-config.cjs').initSystemConfig(app);
    const url = dinle(app);
    const put = (key, value) =>
      fetch(`${url}/api/admin/system-config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
    const kotu = await put('SESSION_IDLE_MINUTES', '3');
    assert.equal(kotu.status, 400);
    assert.match((await kotu.json()).error, /5 ile 720/);
    assert.equal(yazilan.length, 0, 'gecersiz deger yazildi');
    assert.notEqual(process.env.SESSION_IDLE_MINUTES, '3');
    const iyi = await put('SESSION_IDLE_MINUTES', '90');
    assert.equal(iyi.status, 200);
    assert.equal((await iyi.json()).restartRequired, false, 'sicak anahtar icin restart deniyor');
    assert.equal(process.env.SESSION_IDLE_MINUTES, '90');
  } finally {
    db.query = asil;
    if (eskiDeger === undefined) delete process.env.SESSION_IDLE_MINUTES;
    else process.env.SESSION_IDLE_MINUTES = eskiDeger;
  }
});

test('OS6 initAuth cerez adini express-session`a verir', async () => {
  const db = require('../../db/index.cjs');
  const asil = db.query;
  db.query = async () => ({ rows: [], rowCount: 0 });
  try {
    await ortamA(
      {
        SESSION_STORE: 'memory',
        SESSION_COOKIE_NAME: 'portal-test.sid',
        LOCAL_USER: 'yereluser',
        LOCAL_USER_PASS: 'Guclu-Sifre-123!',
        LDAP_URL: undefined,
      },
      async () => {
        const app = express();
        require('../index.cjs').initAuth(app);
        const url = dinle(app);
        const r = await fetch(`${url}/api/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: 'yereluser', password: 'Guclu-Sifre-123!' }),
        });
        assert.equal(r.status, 200);
        assert.match(r.headers.get('set-cookie') || '', /^portal-test\.sid=/, 'cerez adi kullanilmadi');
      },
    );
  } finally {
    db.query = asil;
  }
});

test('OS5 oturum ayarlari dogrulanir; beyaz listede, sicak ve ekranda', () => {
  assert.equal(oturumAyariHatasi('SESSION_IDLE_MINUTES', ''), null, 'bos = varsayilan');
  assert.equal(oturumAyariHatasi('SESSION_IDLE_MINUTES', '60'), null);
  assert.match(oturumAyariHatasi('SESSION_IDLE_MINUTES', '4'), /5 ile 720/);
  assert.match(oturumAyariHatasi('SESSION_IDLE_MINUTES', '1.5'), /tam sayı/);
  assert.match(oturumAyariHatasi('SESSION_ABSOLUTE_HOURS', '73'), /1 ile 72/);
  assert.equal(oturumAyariHatasi('SESSION_REMEMBER_DAYS', '0'), null, '0 = kapali gecerli');
  assert.match(oturumAyariHatasi('LOGIN_USER_MAX_FAILS', '2'), /3 ile 20/);
  assert.equal(oturumAyariHatasi('AUTH_ALLOWED_DOMAINS', 'KURUM, TEST'), null);
  assert.match(oturumAyariHatasi('AUTH_ALLOWED_DOMAINS', 'KURUM, kotu ad'), /kotu ad/);
  assert.match(oturumAyariHatasi('PORTAL_ALLOWED_ORIGINS', 'portal.kurum'), /geçersiz/);
  assert.equal(oturumAyariHatasi('PORTAL_ALLOWED_ORIGINS', 'https://portal.kurum:8443'), null);
  assert.match(oturumAyariHatasi('CSRF_ORIGIN_CHECK', 'kapat'), /enforce \| log \| off/);
  assert.equal(oturumAyariHatasi('BASKA_ANAHTAR', 'x'), null);

  const { SYSTEM_CONFIG_KEYS, HOT_RELOADABLE_KEYS } = require('../../db/env-overrides.cjs');
  const ekran = fs.readFileSync(path.join(ROOT, 'src/components/admin/tabs/SystemConfigTab.tsx'), 'utf8');
  for (const k of OTURUM_AYAR_ANAHTARLARI) {
    assert.ok(SYSTEM_CONFIG_KEYS.includes(k), `${k} beyaz listede yok`);
    assert.ok(HOT_RELOADABLE_KEYS.includes(k), `${k} sicak degil — ekran bosuna restart der`);
    assert.match(ekran, new RegExp(`key: '${k}',\\s*label:[^\\n]+\\n\\s*group: 'Oturum ve Giriş'`), `${k} ekranda yok`);
  }
  const sc = fs.readFileSync(path.join(ROOT, 'server/admin/system-config.cjs'), 'utf8');
  const put = sc.slice(sc.indexOf('app.put("/api/admin/system-config"'));
  assert.ok(put.indexOf('oturumAyariHatasi(key, strValue)') < put.indexOf('await setEnvOverride('), 'dogrulama kayittan once degil');
});
