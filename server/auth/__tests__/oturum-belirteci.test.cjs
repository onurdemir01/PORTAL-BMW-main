// server/auth/__tests__/oturum-belirteci.test.cjs
//
// OTURUM SESSION_SECRET'TEN BAGIMSIZ (2026-10-03). Kullanici: uretimde anahtar rastgele
// uretiliyor ve "her seferinde degisebilir, buna bagimli bir sey olmamali". Eskiden anahtar
// degisince tum cerezlerin imzasi gecersiz kaliyor, herkes atiliyordu.
//
// Gercek express-session ile, kaynak taramasi degil:
//   BT1 cerez rastgele belirtec tasir (v2.<...>); sunucudaki kimlik OZETIDIR, cerezde yoktur
//   BT2 ANAHTAR DEGISSE DE OTURUM BULUNUR (yeniden baslatma + yeni rastgele anahtar)
//   BT3 DB'deki deger (ozet) cereze KONAMAZ: ne belirtec gibi ne eski imzali bicimde —
//       gecerli anahtar bilinse bile
//   BT4 bu surumden once acilmis eski bicimli oturumlar ayni anahtarla calismaya devam eder
//   BT5 bozuk / uydurma cerez: cokme yok, istemcinin sectigi kimlik BENIMSENMEZ
//   BT6 giris (regenerate) yeni belirtec verir; eski belirtec artik gecersizdir
//   BT7 hiz siniri anahtari kullanici basina AYRI ve ham belirteci tasimaz
//   BT8 gercek initAuth: giris cerezi belirtec; oturum listesi, /me, cikis calisir;
//       req.sessionID (denetim ve LogX'e giden deger) ozettir, 32 karakterdir
//   BT9 uretimde bellek store'u acilista yuksek sesle soylenir
//   BT10 dagitim betigi / ornek ayar SESSION_SECRET'i sart kosmaz
'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const session = require('express-session');

const bel = require('../oturum-belirteci.cjs');
const cerez = require('../oturum-cerezi.cjs');

const sunucular = [];
after(() => sunucular.forEach((s) => s.close()));
function dinle(app) {
  const s = app.listen(0);
  sunucular.push(s);
  return `http://127.0.0.1:${s.address().port}`;
}

// Portalin oturum kurulumunun kucuk bir esi: ayni store, verilen anahtar.
function uygulama(store, secret, ad = 'connect.sid') {
  const app = express();
  app.use(bel.belirtecKatmani({ ad, secret }));
  app.use(session({ name: ad, store, secret, genid: bel.kimlikUret, resave: false, saveUninitialized: false, rolling: true }));
  app.post('/giris', (req, res) => {
    req.session.regenerate(() => {
      req.session.user = { username: 'ayse' };
      req.session.save(() => res.json({ ok: true, sid: req.sessionID }));
    });
  });
  app.get('/ben', (req, res) => res.json({ user: req.session.user || null, sid: req.sessionID }));
  return dinle(app);
}

const cerezDegeri = (r, ad = 'connect.sid') => {
  const c = r.headers.getSetCookie().find((x) => x.startsWith(`${ad}=`) && !x.startsWith(`${ad}=;`));
  return c ? c.split(';')[0] : null;
};
const ben = async (url, cookie) => {
  const r = await fetch(`${url}/ben`, { headers: cookie ? { cookie } : {} });
  return { r, body: await r.json() };
};

test('BT1 cerez rastgele belirtec; sunucudaki kimlik ozet ve cerezde yok', async () => {
  const url = uygulama(new session.MemoryStore(), 'anahtar-A');
  const g = await fetch(`${url}/giris`, { method: 'POST' });
  const c = cerezDegeri(g);
  const { sid } = await g.json();
  assert.match(c, /^connect\.sid=v2\.[A-Za-z0-9_-]{43}$/, `cerez belirtec bicimde degil: ${c}`);
  const belirtec = c.split('=')[1].slice(3);
  assert.match(sid, /^~[A-Za-z0-9_-]{31}$/, 'sunucu kimligi ozet bicimde degil');
  assert.equal(sid.length, 32, 'denetim tablosundaki session_id NVARCHAR(36) sinirini asar');
  assert.equal(sid, bel.kimlik(belirtec), 'kimlik belirtecin ozeti degil');
  // Yardimcidan BAGIMSIZ hesap: kimlik gercekten SHA-256 ozeti (belirtecin kendisi ya da
  // bir parcasi degil).
  const bagimsiz = `~${require('node:crypto').createHash('sha256').update(belirtec).digest('base64url').slice(0, 31)}`;
  assert.equal(sid, bagimsiz, 'kimlik belirtecin SHA-256 ozeti degil');
  assert.ok(!belirtec.includes(sid.slice(1, 12)) && !sid.includes(belirtec.slice(0, 12)), 'kimlik belirtecten kopyalanmis');
  assert.ok(!c.includes(sid.slice(1)), 'sunucudaki kimlik cereze sizmis');
  assert.ok(!c.includes('s%3A') && !c.includes('s:'), 'cerez hala imzali express bicimde');
  // Her giris ayri belirtec.
  const g2 = await fetch(`${url}/giris`, { method: 'POST' });
  assert.notEqual(cerezDegeri(g2), c);
});

test('BT2 anahtar degisse de oturum bulunur (yeniden baslatma + yeni rastgele anahtar)', async () => {
  const store = new session.MemoryStore(); // DB'deki oturum tablosu gibi: surecler arasi ortak
  const once = uygulama(store, 'ilk-rastgele-anahtar');
  const g = await fetch(`${once}/giris`, { method: 'POST' });
  const c = cerezDegeri(g);

  // "Yeniden baslatma": ayni store, BAMBASKA bir anahtar.
  const sonra = uygulama(store, 'yeniden-baslatmada-uretilen-baska-anahtar');
  const { r, body } = await ben(sonra, c);
  assert.deepEqual(body.user, { username: 'ayse' }, 'anahtar degisince kullanici atildi');
  // Cerez AYNI belirtecle yenilenir (rolling) — istemci tarafinda hicbir sey degismez.
  assert.equal(cerezDegeri(r), c);
  // Ucuncu bir anahtarla da.
  const { body: b3 } = await ben(uygulama(store, 'ucuncu'), c);
  assert.deepEqual(b3.user, { username: 'ayse' });
});

test('BT3 DB`deki ozet cereze konamaz — gecerli anahtar bilinse bile', async () => {
  const store = new session.MemoryStore();
  const secret = 'saldirganin-da-bildigi-anahtar';
  const url = uygulama(store, secret);
  const g = await fetch(`${url}/giris`, { method: 'POST' });
  const { sid } = await g.json(); // DB / denetim kaydindan okunabilen deger

  // 1) Ozeti belirtec gibi sunmak.
  for (const deneme of [`v2.${sid}`, `v2.${sid.slice(1)}`, `v2.${sid}${'A'.repeat(11)}`, sid]) {
    const { body } = await ben(url, `connect.sid=${encodeURIComponent(deneme)}`);
    assert.equal(body.user, null, `ozet "${deneme.slice(0, 8)}..." ile oturum acildi`);
  }
  // 2) Eski imzali bicimde, DOGRU anahtarla imzalayip sunmak.
  const imzali = `s:${bel.imzala(sid, secret)}`;
  const { body: b2 } = await ben(url, `connect.sid=${encodeURIComponent(imzali)}`);
  assert.equal(b2.user, null, 'DB`deki ozet + anahtar ile eski kapidan girildi');
  // Kontrol: imzalama gercekten express-session'in kabul ettigi bicimde (eski tur kimlikle calisir).
  const eskiSid = 'A'.repeat(32);
  await new Promise((res) => store.set(eskiSid, { cookie: { path: '/' }, user: { username: 'eski' } }, res));
  const { body: b3 } = await ben(url, `connect.sid=${encodeURIComponent(`s:${bel.imzala(eskiSid, secret)}`)}`);
  assert.deepEqual(b3.user, { username: 'eski' }, 'imzalama yardimcisi express-session ile uyumsuz — BT3 hicbir sey olcmuyor');
});

test('BT4 eski bicimli oturumlar ayni anahtarla surer; anahtar degisirse (eskisi gibi) biter', async () => {
  const store = new session.MemoryStore();
  const eskiSid = 'Zx9'.padEnd(32, 'q');
  await new Promise((res) => store.set(eskiSid, { cookie: { path: '/' }, user: { username: 'onceki' } }, res));
  const c = `connect.sid=${encodeURIComponent(`s:${bel.imzala(eskiSid, 'degismeyen')}`)}`;
  const ayni = uygulama(store, 'degismeyen');
  const { r, body } = await ben(ayni, c);
  assert.deepEqual(body.user, { username: 'onceki' }, 'gecis mevcut oturumu dusurdu');
  assert.equal(body.sid, eskiSid);
  // Eski tur oturumun cerezi eski bicimde kalir (belirtece cevrilemez: belirteci yok).
  assert.match(cerezDegeri(r) || '', /^connect\.sid=s%3A/);
  const { body: b2 } = await ben(uygulama(store, 'degisen'), c);
  assert.equal(b2.user, null);
});

test('BT5 bozuk / uydurma cerez: cokme yok, istemcinin sectigi kimlik benimsenmez', async () => {
  const store = new session.MemoryStore();
  const url = uygulama(store, 'k');
  for (const v of ['v2.kisa', 'v2.', 'v2.%E0%A4%A', 's%3A', 's%3Aabc', 'duz-metin', `v2.${'!'.repeat(43)}`, '%']) {
    const r = await fetch(`${url}/ben`, { headers: { cookie: `connect.sid=${v}` } });
    assert.equal(r.status, 200, `"${v}" sunucuyu dusurdu`);
    assert.equal((await r.json()).user, null);
  }
  // Gecerli BICIMDE ama var olmayan belirtec: oturum yok; giris yapilinca kimlik
  // istemcinin gonderdiginden TUREMEZ (oturum sabitleme).
  const uydurma = `v2.${'B'.repeat(43)}`;
  const g = await fetch(`${url}/giris`, { method: 'POST', headers: { cookie: `connect.sid=${uydurma}` } });
  const yeni = cerezDegeri(g);
  assert.notEqual(yeni, `connect.sid=${uydurma}`, 'sunucu istemcinin sectigi belirteci benimsedi');
  assert.notEqual((await g.json()).sid, bel.kimlik('B'.repeat(43)));
  // Baska cerezlere dokunulmaz; ayni adla iki cerez gelirse gecerli olan bulunur.
  const { body } = await ben(url, `tema=koyu; connect.sid=bozuk; ${yeni}; dil=tr`);
  assert.deepEqual(body.user, { username: 'ayse' });
});

test('BT6 giris yeni belirtec verir; eski belirtec gecersizdir', async () => {
  const url = uygulama(new session.MemoryStore(), 'k');
  const c1 = cerezDegeri(await fetch(`${url}/giris`, { method: 'POST' }));
  const g2 = await fetch(`${url}/giris`, { method: 'POST', headers: { cookie: c1 } });
  const c2 = cerezDegeri(g2);
  assert.notEqual(c2, c1, 'giriste belirtec yenilenmedi (oturum sabitleme)');
  assert.equal((await ben(url, c1)).body.user, null, 'eski belirtec hala gecerli');
  assert.deepEqual((await ben(url, c2)).body.user, { username: 'ayse' });
});

test('BT7 hiz siniri anahtari kullanici basina ayri; ham belirteci tasimaz', () => {
  const istek = (c) => ({ headers: { cookie: c } });
  const t1 = bel.yeniBelirtec();
  const t2 = bel.yeniBelirtec();
  const a1 = cerez.oturumHizAnahtari(istek(`connect.sid=v2.${t1}`));
  const a2 = cerez.oturumHizAnahtari(istek(`connect.sid=v2.${t2}`));
  assert.match(a1, /^sid:[0-9a-f]{32}$/);
  assert.notEqual(a1, a2, 'tum kullanicilar tek hiz siniri butcesini paylasiyor');
  assert.equal(a1, cerez.oturumHizAnahtari(istek(`connect.sid=v2.${t1}`)));
  assert.ok(!a1.includes(t1.slice(0, 12)), 'ham belirtec bellekte anahtar olarak tutuluyor');
  assert.equal(cerez.oturumHizAnahtari({ headers: {} }), null);
  // Gercek hiz siniri bu yardimciyi kullanir (eski yazim "ilk noktaya kadar"i aliyordu:
  // `v2.<...>` cerezinde bu HERKES icin "v2" olur, tum kullanicilar tek butceyi paylasirdi).
  const servis = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'service.cjs'), 'utf8');
  assert.match(servis, /const oturum = oturumHizAnahtari\(req\);\s*if \(oturum\) return oturum;/, 'hiz siniri ortak yardimciyi kullanmiyor');
});

test('BT8 gercek initAuth: belirtec cerezi, /me, oturum listesi, cikis', async () => {
  const db = require('../../db/index.cjs');
  const asil = db.query;
  db.query = async () => ({ rows: [], rowCount: 0 });
  const eski = {};
  const env = { SESSION_STORE: 'memory', LOCAL_USER: 'yereluser', LOCAL_USER_PASS: 'Guclu-Sifre-123!', LDAP_URL: undefined, SESSION_SECRET: undefined, SESSION_COOKIE_NAME: undefined };
  for (const k of Object.keys(env)) {
    eski[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    const app = express();
    require('../index.cjs').initAuth(app);
    app.get('/api/test/sid', (req, res) => res.json({ sid: req.sessionID }));
    const url = dinle(app);
    const g = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'yereluser', password: 'Guclu-Sifre-123!' }),
    });
    assert.equal(g.status, 200);
    const c = cerezDegeri(g);
    assert.match(c, /^connect\.sid=v2\.[A-Za-z0-9_-]{43}$/, `initAuth belirtec cerezi vermiyor: ${c}`);
    const belirtec = c.split('=')[1].slice(3);
    const h = { cookie: c };
    assert.equal((await fetch(`${url}/api/auth/me`, { headers: h })).status, 200);
    const { sid } = await (await fetch(`${url}/api/test/sid`, { headers: h })).json();
    assert.equal(sid, bel.kimlik(belirtec), 'req.sessionID belirtecin ozeti degil');
    const liste = await (await fetch(`${url}/api/auth/sessions`, { headers: h })).text();
    assert.equal(JSON.parse(liste).sessions.filter((s) => s.current).length, 1);
    assert.ok(!liste.includes(belirtec) && !liste.includes(sid), 'belirtec ya da kimlik oturum listesine sizdi');
    // Sonraki yanitlarda cerez AYNI belirtecle yenilenir.
    const r2 = await fetch(`${url}/api/auth/session`, { headers: h });
    assert.equal(cerezDegeri(r2), c);
    await fetch(`${url}/api/auth/logout`, { method: 'POST', headers: h });
    assert.equal((await fetch(`${url}/api/auth/me`, { headers: h })).status, 401, 'cikistan sonra belirtec hala gecerli');
  } finally {
    db.query = asil;
    for (const k of Object.keys(env)) {
      if (eski[k] === undefined) delete process.env[k];
      else process.env[k] = eski[k];
    }
  }
});

test('BT9 uretimde oturumlar bellekte tutuluyorsa acilista YUKSEK SESLE soylenir', () => {
  // Bellek store'unda her yeniden baslatma herkesi atar. Anahtar bagimliligi kalkti; geriye
  // kalan tek "yeniden baslatmada atilma" sebebi budur ve sessiz kalmamali.
  const db = require('../../db/index.cjs');
  const asil = db.query;
  db.query = async () => ({ rows: [], rowCount: 0 });
  const eskiHata = console.error;
  const eski = { NODE_ENV: process.env.NODE_ENV, SESSION_STORE: process.env.SESSION_STORE };
  const yazilan = [];
  console.error = (...a) => yazilan.push(a.join(' '));
  try {
    process.env.NODE_ENV = 'production';
    process.env.SESSION_STORE = 'memory';
    require('../index.cjs').initAuth(express());
    assert.ok(yazilan.some((m) => /oturumlar BELLEKTE/.test(m) && /yeniden baslatmada/.test(m)), `uyari yok: ${yazilan.join(' | ')}`);
    yazilan.length = 0;
    process.env.NODE_ENV = 'development';
    require('../index.cjs').initAuth(express());
    assert.ok(!yazilan.some((m) => /BELLEKTE/.test(m)), 'gelistirmede de uyariyor (gurultu)');
  } finally {
    console.error = eskiHata;
    db.query = asil;
    for (const k of Object.keys(eski)) {
      if (eski[k] === undefined) delete process.env[k];
      else process.env[k] = eski[k];
    }
  }
});

test('BT10 dagitim betigi ve ornek ayar SESSION_SECRET`i SART KOSMAZ', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const kok = path.join(__dirname, '..', '..', '..');
  const run = fs.readFileSync(path.join(kok, 'deploy/run.sh'), 'utf8');
  const kod = run.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(kod, /SESSION_SECRET/, 'run.sh hala SESSION_SECRET`e bakiyor — bos ise baslatmayi reddeder');
  const ornek = fs.readFileSync(path.join(kok, '.env.example'), 'utf8');
  assert.match(ornek, /^SESSION_SECRET=$/m, '.env.example bos birakilabildigini gostermiyor');
  assert.match(ornek, /SESSION_SECRET ZORUNLU DEGIL/);
});
