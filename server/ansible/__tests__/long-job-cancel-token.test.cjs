// server/ansible/__tests__/long-job-cancel-token.test.cjs
//
// IPTAL TOKEN'I (kullanici, 2026-10-03): "Portal'in AWX servis kullanicisina yetki verme
// hakkim yok. Simdilik kendi onurdemir3 kullanicimin token'ini Portal admin panelinden
// vereyim; uzun suren isleri onunla iptal et."
//
// Bu dosya DAVRANIS olcer: gercek runner.cjs + long-job-cancel.cjs + long-job-cancel-token.cjs
// yerel bir SAHTE AWX'e (token -> kullanici eslemeli; /me, liste, detay, iptal, template),
// gercek Teams gonderimi yerel SAHTE webhook'a konusur; DB bellek-ici sahte (portal_config_blobs).
//
//   TK1  kayit: GET /api/v2/me/ ile dogrulanir; DB'de YALNIZ 'enc:v1:' sifreli deger; yanit,
//        GET ve denetim degeri (ne duz ne sifreli) TASIMAZ; kim/ne zaman/sahip/son dogrulama gorunur
//   TK2  ENV_OVERRIDES_ENCRYPTION_KEY yoksa kayit REDDEDILIR (NODE_ENV=test'te bile); AWX'e gidilmez
//   TK3  gecersiz token (401) kaydedilmez ("gecersiz"); AWX 500 -> "olculemedi" (gecersiz DENMEZ)
//   TK4  otomatik iptal token'la gider; tarama/durum okuma servis kullanicisiyla; Teams + denetim
//        "iptal onurdemir3 token'iyla yapildi"
//   TK5  ScaleX/LogX/Telnet bicimli cagrilar (authToken'siz) token tanimliyken de servis kullanicisi
//   TK6  token tanimli degilse eski davranis (servis kullanicisi; kart token'dan soz etmez)
//   TK7  401: Teams "IPTAL TOKEN'I GECERSIZ" + denetim + durum; is IPTAL EDILEMEDI (kalici);
//        yeni token kaydedilince yeniden denenir ve iptal edilir
//   TK8  403 (token'la): kalici red + "token sahibi onurdemir3 bu template'te Admin degil"
//   TK9  yetki on kontrolu token SAHIBINE gore (user_capabilities); token yoksa servis kullanicisi
//   TK10 SIZINTI YOK: sahte AWX Authorization'i (ham + Bearer) yansitsa bile token hicbir
//        log/denetim/Teams/HTTP yanitinda/DB'de duz metin gorunmez
//   TK11 token uclari yalniz Admin: reddedilirse DB'ye de AWX'e de gidilmez
//   TK12 Sil: tanimli degil olur, denetime DEGERSIZ yazilir, sonraki iptal servis kullanicisiyla;
//        silinen deger yine maskelenir
//   TK13 cozulemeyen token (anahtar degisti): IPTAL EDILEMEDI + Teams; servis kullanicisina
//        SESSIZCE dusulmez, AWX'e iptal istegi gitmez; yetki on kontrolu de OLCULEMEDI (servis
//        kullanicisina gore olculmez, template istegi gitmez)
//   TK14 DB'de onekisiz (duz metin) kayit YOK sayilir
//   TK15 "Dogrula": gecerli -> ok; 401 -> GECERSIZ; AWX 500 -> olculemedi (kayit degismez)
//   TK16 coklu Portal ornegi: token baska ornekte kaydedilirse iptal edilemeyen is yeniden denenir
//   TK17 runner sozlesmesi: authToken 401 -> cancelTokenInvalid/kalici; authToken siz cagri eski bicimde
//   TK18 token KAYDI okunamazsa (restart sonrasi, DB) OLCULEMEDI: servis kullanicisina DUSULMEZ, iptal
//        denenmez (gecici, MAX_ATTEMPTS sonra kart "OKUNAMADI"); yetki/kuru calistirma da soyler;
//        kayit okununca is token'la yeniden denenir
//   TK19 bozuk (JSON) token kaydi da OLCULEMEDI: token'siz sunucuda bile iptal denenmez; kayit
//        duzelince servis kullanicisiyla yeniden denenir
//   TK20 coklu AWX sunucusu: token YALNIZ kaydedildigi sunucuya gider (iptal + yetki); diger
//        sunucuya giden hicbir Authorization token degerini tasimaz
//   TK21 token kaydedildigi AWX ADRESINE bagli: sunucunun adresi degisirse token yeni adrese HIC
//        gitmez (iptal, yetki, Dogrula, kuru calistirma); kart/denetim/ekran soyler; kalici
//   TK22 adres baglamasi olmayan kayit kullanilmaz (ilk kullanimda baglanmaz)
//   TK23 gecici 401 sonrasi Dogrula GECERLI: bant kalkar, is token'la hemen yeniden denenir
//   TK24 kuru calistirma iptalin hangi token'la yapilacagini soyler; token yoksa soylemez
//   TK25 403 + isi token sahibi baslatmis: sebep Admin rolu DEGIL, token 'write' kapsami
//   TK26 runner sozlesmesi: JSON olmayan (vekil HTML) hata govdesi token'i yansitsa da hata metnine sizmaz
'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

for (const k of Object.keys(process.env)) {
  if (/^AWX_/.test(k) || /^(HTTPS?_PROXY|https?_proxy)$/.test(k)) delete process.env[k];
}
delete process.env.TEAMS_LONGJOB_THRESHOLD_MINUTES;
delete process.env.TEAMS_LONGJOB_POLL_INTERVAL_SECONDS;

const KEY_A = 'c'.repeat(64);
const KEY_B = 'd'.repeat(64);
process.env.ENV_OVERRIDES_ENCRYPTION_KEY = KEY_A;

const SVC = 'SVC-TOKEN-4b1d77aa90';
const KISISEL = 'KISISEL-onur-9e8d7c6b5a41';
const YENI = 'KISISEL-YENI-1a2b3c4d5e6f';
const YANLIS = 'YANLIS-TOKEN-0f9e8d7c';
const SIRLAR = [KISISEL, YENI, YANLIS];

const ACTIVE = ['new', 'pending', 'waiting', 'running'];
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const fold = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/’/g, "'");

// ── SAHTE AWX (token -> kullanici) ─────────────────────────────────────────────
const awx = {
  srv: null,
  port: 0,
  users: new Map(),
  jobs: new Map(), // id -> { id, tpl, tplName, status, started, created, createdBy }
  templates: new Map(), // id -> { name, admins: [] }
  istekler: [], // { method, path, user }
  echoAuth: false, // hata govdesi Authorization'i (Bearer + HAM deger) yansitir
  meStatus: 0, // /api/v2/me/ bu kodla reddedilir (or. 500)
  meHtml: false, // /api/v2/me/ JSON OLMAYAN (vekil HTML) 502 doner ve token'i yansitir
  readScope: new Set(), // 'read' kapsamli token degerleri (iptal POST'u 403)
};

// Ikinci AWX sunucusu (coklu sunucu / adres degisimi bekcileri): ayni sahte, ayri durum.
const SVC2 = 'SVC2-TOKEN-77ab01cd99';
const awx2 = {
  srv: null,
  port: 0,
  users: new Map(),
  jobs: new Map(),
  templates: new Map(),
  istekler: [],
  echoAuth: false,
  meStatus: 0,
  readScope: new Set(),
};

function awx2Sifirla() {
  awx2.users = new Map([[SVC2, 'portal_svc2']]);
  awx2.jobs.clear();
  awx2.templates.clear();
  awx2.istekler.length = 0;
  awx2.echoAuth = false;
  awx2.meStatus = 0;
  awx2.readScope = new Set();
}

/** AWX_2_* ortamini ikinci sahte AWX'e kurar; geri alma fonksiyonu doner. */
function ikinciSunucu() {
  process.env.AWX_2_URL = `http://127.0.0.1:${awx2.port}`;
  process.env.AWX_2_TOKEN = SVC2;
  process.env.AWX_2_NAME = 'ikinci-awx';
  return () => {
    delete process.env.AWX_2_URL;
    delete process.env.AWX_2_TOKEN;
    delete process.env.AWX_2_NAME;
  };
}

function awxSifirla() {
  awx.users = new Map([
    [SVC, 'portal_svc'],
    [KISISEL, 'onurdemir3'],
    [YENI, 'onurdemir3'],
  ]);
  awx.jobs.clear();
  awx.templates.clear();
  awx.istekler.length = 0;
  awx.echoAuth = false;
  awx.meStatus = 0;
  awx.meHtml = false;
  awx.readScope = new Set();
}

function isEkle(j) {
  awx.jobs.set(j.id, { status: 'running', created: j.started || ago(1), createdBy: 'ayse', tplName: `tpl-${j.tpl}`, ...j });
}

function awxJson(j) {
  return {
    id: j.id,
    name: j.tplName,
    status: j.status,
    started: j.started || null,
    created: j.created || null,
    job_template: j.tpl,
    summary_fields: { job_template: { id: j.tpl, name: j.tplName }, created_by: { username: j.createdBy } },
  };
}

function awxIstegi(req, res, a = awx) {
  const u = new URL(req.url, 'http://x');
  const auth = req.headers.authorization || '';
  const tok = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = a.users.get(tok) || null;
  // auth: HAM Authorization basligi (izolasyon/sizinti bekcileri icin).
  a.istekler.push({ method: req.method, path: u.pathname, user, auth });
  const send = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  // Hem "Bearer <deger>" hem HAM deger: Bearer kalibina dayanan maskeleme tek basina yetmesin.
  const echo = a.echoAuth ? ` (got ${auth}; raw ${tok})` : '';
  if (!user) return send(401, { detail: 'Authentication credentials were not provided.' + echo });
  let m;
  if (req.method === 'GET' && u.pathname === '/api/v2/me/') {
    if (a.meHtml) {
      // Vekil/gateway HTML hata sayfasi (JSON DEGIL) ve istegin token'ini HAM yansitir.
      res.writeHead(502, { 'content-type': 'text/html' });
      return res.end(`<html><body>Bad Gateway: upstream rejected Authorization ${auth} (raw ${tok})</body></html>`);
    }
    if (a.meStatus) return send(a.meStatus, { detail: 'gecici AWX hatasi' + echo });
    return send(200, { count: 1, results: [{ id: user === 'onurdemir3' ? 31 : 9, username: user, is_superuser: false }] });
  }
  if (req.method === 'GET' && (m = u.pathname.match(/^\/api\/v2\/(jobs|workflow_jobs)\/$/))) {
    if (m[1] === 'workflow_jobs') return send(200, { count: 0, next: null, results: [] });
    const st = (u.searchParams.get('status__in') || '').split(',').filter(Boolean);
    const rows = [...a.jobs.values()].filter((j) => !st.length || st.includes(j.status));
    return send(200, { count: rows.length, next: null, results: rows.map(awxJson) });
  }
  if (req.method === 'GET' && (m = u.pathname.match(/^\/api\/v2\/jobs\/(\d+)\/$/))) {
    const j = a.jobs.get(Number(m[1]));
    return j ? send(200, awxJson(j)) : send(404, { detail: 'Not found.' });
  }
  if (req.method === 'POST' && (m = u.pathname.match(/^\/api\/v2\/jobs\/(\d+)\/cancel\/$/))) {
    const j = a.jobs.get(Number(m[1]));
    if (!j) return send(404, { detail: 'Not found.' });
    const t = a.templates.get(j.tpl) || { admins: [] };
    const allowed = j.createdBy === user || t.admins.includes(user);
    // 'read' kapsamli token: isi kendisi baslatmis olsa bile yazma (iptal) 403.
    if (a.readScope && a.readScope.has(tok)) return send(403, { detail: 'You do not have permission to perform this action.' + echo });
    // GERCEK AWX (superuser degil): bitmis ise de 403; aktif ama yetkisiz 403.
    if (!ACTIVE.includes(j.status) || !allowed) {
      return send(403, { detail: 'You do not have permission to perform this action.' + echo });
    }
    j.status = 'canceled';
    return send(202);
  }
  if (req.method === 'GET' && (m = u.pathname.match(/^\/api\/v2\/job_templates\/(\d+)\/$/))) {
    const t = a.templates.get(Number(m[1]));
    if (!t) return send(404, { detail: 'Not found.' });
    return send(200, { id: Number(m[1]), name: t.name, summary_fields: { user_capabilities: { edit: t.admins.includes(user), start: true } } });
  }
  return send(404, { detail: 'Not found.' });
}

// ── SAHTE TEAMS ──────────────────────────────────────────────────────────────
const teams = { srv: null, url: '', kartlar: [] };
const kartBaslik = (k) => k?.attachments?.[0]?.content?.body?.[0]?.items?.[0]?.text || '';

before(async () => {
  awx.srv = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => awxIstegi(req, res));
  });
  await new Promise((r) => awx.srv.listen(0, '127.0.0.1', r));
  awx.port = awx.srv.address().port;
  process.env.AWX_1_URL = `http://127.0.0.1:${awx.port}`;
  process.env.AWX_1_TOKEN = SVC;
  process.env.AWX_1_NAME = 'maestro-test';

  awx2.srv = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => awxIstegi(req, res, awx2));
  });
  await new Promise((r) => awx2.srv.listen(0, '127.0.0.1', r));
  awx2.port = awx2.srv.address().port;

  teams.srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try {
        teams.kartlar.push(JSON.parse(b));
      } catch {
        teams.kartlar.push({ ham: b });
      }
      res.writeHead(200);
      res.end('1');
    });
  });
  await new Promise((r) => teams.srv.listen(0, '127.0.0.1', r));
  teams.url = `http://127.0.0.1:${teams.srv.address().port}/webhook`;
});

after(async () => {
  await new Promise((r) => awx.srv.close(r));
  await new Promise((r) => awx2.srv.close(r));
  await new Promise((r) => teams.srv.close(r));
});

const runner = require('../runner.cjs');
const ljc = require('../long-job-cancel.cjs');
const tokenStore = require('../long-job-cancel-token.cjs');

const CFG = (over = {}) => ({
  enabled: true,
  thresholdMinutes: 60,
  templates: [{ serverId: 1, templateId: 42, kind: 'job', name: 'nginx_config_audit' }],
  ...over,
});

/** Bellek-ici portal_config_blobs. `yazilan`: DB'ye giden her deger (sizinti bekcisi). */
function dbOf(cfg) {
  const d = { blobs: new Map([['longjob-cancel', JSON.stringify(cfg)]]), yazilan: [], sorgular: 0, fail: false };
  d.query = async (sql, params = []) => {
    d.sorgular++;
    if (d.fail) throw new Error('ConnectionError: Failed to connect to MSSQL TBMWPRT:1433');
    const s = String(sql).trim();
    if (/^SELECT data FROM portal_config_blobs/.test(s)) {
      const v = d.blobs.get(params[0]);
      return { rows: v == null ? [] : [{ data: v }] };
    }
    if (/^SELECT 1 FROM portal_config_blobs/.test(s)) return { rows: d.blobs.has(params[0]) ? [{ x: 1 }] : [] };
    if (/^(UPDATE|INSERT INTO) portal_config_blobs/.test(s)) {
      d.blobs.set(params[0], params[1]);
      d.yazilan.push(String(params[1]));
      return { rows: [], rowCount: 1 };
    }
    return { rows: [] };
  };
  return d;
}

/** Yalniz iptal token KAYDI sorgusunu dusuren DB (yapilandirma okunur): `tokFail`. */
function dbSecici(cfg) {
  const d = dbOf(cfg);
  const q = d.query;
  d.tokFail = false;
  d.query = async (sql, params = []) => {
    if (d.tokFail && params[0] === tokenStore.BLOB_NAME) {
      throw new Error('ConnectionError: Failed to connect to MSSQL TBMWPRT:1433 (gecici)');
    }
    return q(sql, params);
  };
  return d;
}

let audits = []; // { kaynak: 'tick'|'uc', action, result, detail }
const tickAudit = (action, opts) => audits.push({ kaynak: 'tick', action, ...opts });
const posts = () => awx.istekler.filter((r) => r.method === 'POST');

async function cycle(db) {
  const scan = await runner.listLongJobCandidatesAcrossServers();
  return ljc.runCycle(scan, { db, runner, webhookUrl: teams.url, audit: tickAudit });
}

/** @param {{ db?: any, requireAdmin?: any }} [o] */
async function uygulama({ db, requireAdmin } = {}) {
  const express = require('express');
  const app = express();
  app.use(express.json());
  const kayit = [];
  const sarmal = {};
  for (const m of ['get', 'put', 'post', 'delete']) {
    sarmal[m] = (p, ...h) => (kayit.push({ m, p, h }), app[m](p, ...h));
  }
  const requireAuth = (req, _s, n) => {
    req.session = { user: { username: 'admin_ayse' } };
    n();
  };
  const adm = requireAdmin || ((_q, _s, n) => n());
  ljc.registerRoutes(sarmal, {
    requireAuth,
    requireAdmin: adm,
    getRunner: () => runner,
    getDb: () => db,
    getWatcherInfo: () => null,
    audit: (_req, action, opts) => audits.push({ kaynak: 'uc', action, ...opts }),
  });
  const srv = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (method, p, body) => {
    const r = await fetch(`${base}${p}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: r.status, text, json };
  };
  return { base, kayit, requireAuth, requireAdmin: adm, call, kapat: () => new Promise((r) => srv.close(r)) };
}

/** console.* ciktisini yakalar (sizinti bekcisi icin). */
function konsolYakala(t) {
  const satirlar = [];
  for (const m of ['error', 'warn', 'log', 'info', 'debug']) {
    t.mock.method(console, m, (...a) => satirlar.push(a.map((x) => (x instanceof Error ? x.stack || x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')));
  }
  return satirlar;
}

function sizintiYok(metin, etiket) {
  for (const s of SIRLAR) assert.ok(!String(metin).includes(s), `${etiket}: token degeri sizdi`);
}

beforeEach(() => {
  awxSifirla();
  awx2Sifirla();
  ljc._reset();
  teams.kartlar.length = 0;
  audits = [];
  process.env.ENV_OVERRIDES_ENCRYPTION_KEY = KEY_A;
});

async function tokenKaydet(app, token = KISISEL) {
  const r = await app.call('PUT', '/api/ansible/longjob-cancel/tokens/1', { token });
  assert.equal(r.status, 200, `token kaydedilemedi: ${r.text}`);
  return r;
}

// ── TK1 ──────────────────────────────────────────────────────────────────────
test('TK1 kayit /me ile dogrulanir; DB de yalniz enc:v1: sifreli deger; yanit/GET/denetim degeri tasimaz', async (t) => {
  const kons = konsolYakala(t);
  const db = dbOf(CFG());
  const app = await uygulama({ db });
  try {
    const r = await tokenKaydet(app);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.owner, 'onurdemir3', 'token sahibi /me ten okunmadi');
    const me = awx.istekler.filter((x) => x.path === '/api/v2/me/');
    assert.deepEqual(me.map((x) => x.user), ['onurdemir3'], 'dogrulama verilen token ile yapilmadi');

    const blob = db.blobs.get(tokenStore.BLOB_NAME);
    assert.ok(blob, 'DB ye yazilmadi');
    const kayit = JSON.parse(blob).servers['1'];
    assert.match(kayit.tokenEnc, /^enc:v1:/, 'DB deki deger sifreli degil');
    for (const y of db.yazilan) assert.ok(!y.includes(KISISEL), 'DB ye duz metin yazildi');

    const g = await app.call('GET', '/api/ansible/longjob-cancel/tokens');
    const s1 = g.json.servers.find((x) => x.serverId === 1);
    assert.equal(s1.defined, true);
    assert.equal(s1.owner, 'onurdemir3');
    assert.equal(s1.setBy, 'admin_ayse', 'kim girdi gorunmuyor');
    assert.ok(s1.setAt, 'ne zaman girdi gorunmuyor');
    assert.equal(s1.lastVerify.ok, true, 'son dogrulama sonucu yok');
    assert.equal(g.json.encryptionKeyConfigured, true);
    for (const x of [r.text, g.text]) {
      sizintiYok(x, 'HTTP yaniti');
      assert.ok(!x.includes('enc:v1:'), 'sifreli deger bile yanita girmemeli (yalniz yazilir alan)');
    }
    const den = audits.filter((a) => a.action === 'awx_long_job_cancel_token');
    assert.equal(den.length, 1, 'kayit denetime yazilmadi');
    assert.equal(den[0].result, 'ok');
    const d = JSON.parse(den[0].detail);
    assert.equal(d.op, 'set');
    assert.equal(d.owner, 'onurdemir3');
    assert.ok(!den[0].detail.includes('enc:v1:'));
    sizintiYok(JSON.stringify(audits), 'denetim');
    sizintiYok(kons.join('\n'), 'log');
  } finally {
    await app.kapat();
  }
});

// ── TK2 ──────────────────────────────────────────────────────────────────────
test('TK2 ENV_OVERRIDES_ENCRYPTION_KEY yoksa kayit REDDEDILIR (NODE_ENV=test te bile duz metne dusulmez); AWX e gidilmez', async (t) => {
  konsolYakala(t);
  const savedEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  delete process.env.ENV_OVERRIDES_ENCRYPTION_KEY;
  const db = dbOf(CFG());
  const app = await uygulama({ db });
  try {
    const r = await app.call('PUT', '/api/ansible/longjob-cancel/tokens/1', { token: KISISEL });
    assert.equal(r.status, 400);
    assert.equal(r.json.ok, false);
    assert.match(r.json.message, /ENV_OVERRIDES_ENCRYPTION_KEY tanımlı değil/);
    assert.equal(r.json.reason, 'no_key');
    assert.equal(db.blobs.has(tokenStore.BLOB_NAME), false, 'anahtarsiz kayit yazildi');
    assert.equal(db.yazilan.length, 0);
    assert.equal(awx.istekler.length, 0, 'anahtar yokken token AWX e gonderildi');
    const g = await app.call('GET', '/api/ansible/longjob-cancel/tokens');
    assert.equal(g.json.encryptionKeyConfigured, false, 'ekran anahtar eksikligini bilmiyor');
    const den = audits.filter((a) => a.action === 'awx_long_job_cancel_token');
    assert.equal(den.length, 1);
    assert.equal(den[0].result, 'fail', 'reddedilen kayit denetime yazilmadi');
    sizintiYok(JSON.stringify(audits) + r.text, 'yanit/denetim');
  } finally {
    await app.kapat();
    if (savedEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedEnv;
  }
});

// ── TK3 ──────────────────────────────────────────────────────────────────────
test('TK3 gecersiz token (AWX 401) kaydedilmez ve "gecersiz" denir; AWX 500 -> "olculemedi" (gecersiz DENMEZ)', async (t) => {
  const kons = konsolYakala(t);
  awx.echoAuth = true;
  const db = dbOf(CFG());
  const app = await uygulama({ db });
  try {
    const r = await app.call('PUT', '/api/ansible/longjob-cancel/tokens/1', { token: YANLIS });
    assert.equal(r.status, 400);
    assert.match(fold(r.json.message), /Token gecersiz \(AWX 401\)/);
    assert.equal(r.json.reason, 'invalid');
    assert.equal(db.blobs.has(tokenStore.BLOB_NAME), false, 'gecersiz token kaydedildi');

    awx.meStatus = 500;
    const r2 = await app.call('PUT', '/api/ansible/longjob-cancel/tokens/1', { token: KISISEL });
    assert.equal(r2.status, 502);
    assert.equal(r2.json.reason, 'unverified');
    assert.match(fold(r2.json.message), /olculemedi/);
    assert.doesNotMatch(fold(r2.json.message), /^Token gecersiz/, 'AWX 500 "gecersiz" diye raporlandi');
    assert.equal(db.blobs.has(tokenStore.BLOB_NAME), false);

    // bicim: bos / bosluklu deger AWX e gitmeden reddedilir
    const once = awx.istekler.length;
    const r3 = await app.call('PUT', '/api/ansible/longjob-cancel/tokens/1', { token: 'abc def ghi jkl' });
    assert.equal(r3.status, 400);
    assert.equal(awx.istekler.length, once, 'bicimi bozuk token AWX e gonderildi');

    sizintiYok(r.text + r2.text + r3.text, 'HTTP yaniti');
    sizintiYok(JSON.stringify(audits), 'denetim');
    sizintiYok(kons.join('\n'), 'log');
    assert.ok(kons.some((l) => l.includes('/api/v2/me/')), 'test kurgusu: AWX hata logu yazilmadi');
  } finally {
    await app.kapat();
  }
});

// ── TK4 ──────────────────────────────────────────────────────────────────────
test('TK4 otomatik iptal token la gider (tarama + durum okuma servis kullanicisi); Teams + denetim iz birakir', async (t) => {
  konsolYakala(t);
  isEkle({ id: 700, tpl: 42, tplName: 'nginx_config_audit', started: ago(120) });
  awx.templates.set(42, { name: 'nginx_config_audit', admins: ['onurdemir3'] });
  const db = dbOf(CFG());
  const app = await uygulama({ db });
  try {
    await tokenKaydet(app);
  } finally {
    await app.kapat();
  }
  awx.istekler.length = 0;
  const s = await cycle(db);

  assert.deepEqual(
    posts().map((p) => [p.path, p.user]),
    [['/api/v2/jobs/700/cancel/', 'onurdemir3']],
    'iptal iptal token i ile gitmedi',
  );
  assert.equal(awx.jobs.get(700).status, 'canceled');
  const listeler = awx.istekler.filter((x) => x.method === 'GET' && x.path === '/api/v2/jobs/');
  assert.ok(listeler.length > 0 && listeler.every((x) => x.user === 'portal_svc'), 'tarama servis kullanicisiyla yapilmadi');
  const row = s.jobs.find((j) => j.jobId === 700);
  assert.equal(row.decision, 'cancel_requested');
  assert.match(fold(row.reason), /iptal onurdemir3 token'iyla yapildi/);

  const kart = teams.kartlar.find((k) => fold(kartBaslik(k)).includes('Portal tarafindan iptal edildi'));
  assert.ok(kart, 'iptal karti gitmedi');
  assert.match(fold(JSON.stringify(kart)), /Iptal onurdemir3 token'iyla yapildi/, 'Teams kartinda iz yok');
  const ok = audits.filter((a) => a.action === 'awx_long_job_cancel' && a.result === 'ok');
  assert.equal(ok.length, 1);
  const d = JSON.parse(ok[0].detail);
  assert.equal(d.via, 'cancel_token');
  assert.equal(d.tokenOwner, 'onurdemir3');
  assert.match(fold(d.credential), /Iptal onurdemir3 token'iyla yapildi/, 'denetimde iz yok');
  assert.equal(ljc.getStatus().attempts[0].via, 'cancel_token');
});

// ── TK5 ──────────────────────────────────────────────────────────────────────
test('TK5 ScaleX/LogX/Telnet bicimli cagrilar (authToken siz) token tanimliyken de SERVIS kullanicisiyla gider', async (t) => {
  konsolYakala(t);
  isEkle({ id: 800, tpl: 42, started: ago(5), createdBy: 'portal_svc' });
  awx.templates.set(42, { name: 'nginx_config_audit', admins: ['onurdemir3'] });
  const db = dbOf(CFG());
  const app = await uygulama({ db });
  try {
    await tokenKaydet(app);
  } finally {
    await app.kapat();
  }
  awx.istekler.length = 0;
  await runner.getJobStateOnServer(1, 800);
  await runner.getTemplateCapabilitiesOnServer(1, 42, 'job');
  await runner.listLongJobCandidatesAcrossServers();
  const r = await runner.cancelJobOnServer(1, 800); // ScaleX/LogX/Telnet: iki arguman
  assert.equal(r.canceled, true);
  assert.equal(r.via, undefined, 'eski cagri bicimine yeni alan eklendi');
  assert.ok(awx.istekler.length >= 4);
  for (const x of awx.istekler) assert.equal(x.user, 'portal_svc', `${x.method} ${x.path} iptal token i ile gitti`);
});

// ── TK6 ──────────────────────────────────────────────────────────────────────
test('TK6 token tanimli degilse eski davranis: servis kullanicisi; 403 karti token dan soz etmez', async (t) => {
  konsolYakala(t);
  isEkle({ id: 900, tpl: 42, started: ago(120) });
  awx.templates.set(42, { name: 'nginx_config_audit', admins: ['onurdemir3'] });
  const db = dbOf(CFG());
  const s = await cycle(db);
  assert.deepEqual(posts().map((p) => p.user), ['portal_svc']);
  assert.equal(s.jobs.find((j) => j.jobId === 900).decision, 'cancel_failed');
  const kart = teams.kartlar.find((k) => fold(kartBaslik(k)).includes('IPTAL EDILEMEDI'));
  assert.ok(kart);
  assert.doesNotMatch(fold(JSON.stringify(kart)), /token'iyla|IPTAL TOKEN/);
  const f = audits.find((a) => a.action === 'awx_long_job_cancel' && a.result === 'fail');
  assert.equal(JSON.parse(f.detail).via, 'service');
  assert.equal(ljc.getStatus().cancelTokens.tokens.length, 0);
});

// ── TK7 ──────────────────────────────────────────────────────────────────────
test('TK7 401: Teams "IPTAL TOKEN I GECERSIZ" + denetim + durum; is IPTAL EDILEMEDI (kalici); yeni token la yeniden denenir', async (t) => {
  konsolYakala(t);
  isEkle({ id: 1000, tpl: 42, started: ago(120) });
  awx.templates.set(42, { name: 'nginx_config_audit', admins: ['onurdemir3'] });
  const db = dbOf(CFG());
  const app = await uygulama({ db });
  try {
    await tokenKaydet(app);
    awx.users.delete(KISISEL); // AWX te token iptal edildi / suresi doldu
    awx.istekler.length = 0;
    let s = await cycle(db);

    assert.deepEqual(posts().map((p) => p.path), ['/api/v2/jobs/1000/cancel/']);
    const kart = teams.kartlar.filter((k) => fold(kartBaslik(k)).includes("IPTAL TOKEN'I GECERSIZ"));
    assert.equal(kart.length, 1, 'IPTAL TOKEN I GECERSIZ karti gitmedi');
    assert.match(fold(kartBaslik(kart[0])), /IPTAL EDILEMEDI/);
    assert.match(fold(JSON.stringify(kart[0])), /yeni token girin/);
    const f = audits.filter((a) => a.action === 'awx_long_job_cancel' && a.result === 'fail');
    assert.equal(f.length, 1);
    const d = JSON.parse(f[0].detail);
    assert.equal(d.tokenInvalid, true);
    assert.equal(d.httpStatus, 401);
    assert.equal(d.tokenOwner, 'onurdemir3');
    const row = s.jobs.find((j) => j.jobId === 1000);
    assert.equal(row.decision, 'cancel_failed', 'is IPTAL EDILEMEDI sayilmadi');
    assert.equal(row.problem, true);
    assert.match(fold(row.reason), /IPTAL TOKEN'I GECERSIZ/);
    const st = ljc.getStatus();
    assert.equal(st.open.tokenInvalid, 1, 'durumda IPTAL TOKEN I GECERSIZ yok');
    assert.equal(st.cancelTokens.tokens[0].invalid, true);
    assert.equal(st.attempts[0].outcome, 'token_invalid');
    const g = await app.call('GET', '/api/ansible/longjob-cancel/tokens');
    const s1 = g.json.servers.find((x) => x.serverId === 1);
    assert.equal(s1.invalid, true, 'ekran token in gecersiz oldugunu bilmiyor');
    assert.equal(s1.lastVerify.result, 'gecersiz', 'son dogrulama sonucu kalici yazilmadi');

    // kalici: ikinci tur tekrar denemez, ikinci kart gitmez
    await cycle(db);
    assert.equal(posts().length, 1, 'gecersiz token la tekrar denendi');
    assert.equal(teams.kartlar.length, 1);

    // yeni token kaydedilir -> yeniden denenir ve iptal edilir
    await tokenKaydet(app, YENI);
    assert.equal(ljc.getStatus().open.tokenInvalid, 0, 'yeni token sonrasi hala GECERSIZ gorunuyor');
    // writeConfig emsali: Kaydet aninda bu sunucunun "iptal edilemedi" kayitlari yeniden denemeye acilir.
    assert.equal(ljc.getStatus().open.failed, 0, 'token kaydi iptal edilemeyen isi yeniden denemeye acmadi');
    s = await cycle(db);
    assert.deepEqual(posts().map((p) => p.user), [null, 'onurdemir3']);
    assert.equal(awx.jobs.get(1000).status, 'canceled');
    assert.equal(s.jobs.find((j) => j.jobId === 1000).decision, 'cancel_requested');
  } finally {
    await app.kapat();
  }
});

// ── TK8 ──────────────────────────────────────────────────────────────────────
test('TK8 403 (token la): kalici red; mesaj "token sahibi onurdemir3 bu template te Admin degil"; durum servis kullanicisiyla okunur', async (t) => {
  konsolYakala(t);
  isEkle({ id: 1100, tpl: 42, started: ago(120), createdBy: 'ayse' });
  awx.templates.set(42, { name: 'nginx_config_audit', admins: [] });
  const db = dbOf(CFG());
  const app = await uygulama({ db });
  try {
    await tokenKaydet(app);
  } finally {
    await app.kapat();
  }
  awx.istekler.length = 0;
  const s = await cycle(db);
  assert.deepEqual(posts().map((p) => p.user), ['onurdemir3']);
  const detay = awx.istekler.filter((x) => x.method === 'GET' && x.path === '/api/v2/jobs/1100/');
  assert.ok(detay.length && detay.every((x) => x.user === 'portal_svc'), 'is durumu servis kullanicisiyla okunmadi');
  const row = s.jobs.find((j) => j.jobId === 1100);
  assert.equal(row.decision, 'cancel_failed');
  assert.match(fold(row.reason), /token sahibi onurdemir3 bu template'te Admin degil/);
  const kart = teams.kartlar.find((k) => fold(kartBaslik(k)).includes('IPTAL EDILEMEDI'));
  const metin = fold(JSON.stringify(kart));
  assert.match(metin, /token sahibi onurdemir3 bu template'te Admin degil/);
  assert.match(metin, /onurdemir3 kullanicisina bu template'te Admin rolu verin/);
  assert.match(metin, /Iptal onurdemir3 token'iyla denendi/);
  const f = audits.find((a) => a.action === 'awx_long_job_cancel' && a.result === 'fail');
  const d = JSON.parse(f.detail);
  assert.equal(d.permanent, true);
  assert.equal(d.via, 'cancel_token');
  assert.match(fold(d.error), /token sahibi onurdemir3 bu template'te Admin degil/);
  await cycle(db);
  assert.equal(posts().length, 1, 'kalici 403 tekrar denendi');
});

// ── TK9 ──────────────────────────────────────────────────────────────────────
test('TK9 yetki on kontrolu token SAHIBINE gore (user_capabilities); token yoksa servis kullanicisi', async (t) => {
  konsolYakala(t);
  awx.templates.set(42, { name: 'nginx_config_audit', admins: ['onurdemir3'] });
  awx.templates.set(43, { name: 'baska', admins: [] });
  const db = dbOf(CFG({ templates: [
    { serverId: 1, templateId: 42, kind: 'job', name: 'nginx_config_audit' },
    { serverId: 1, templateId: 43, kind: 'job', name: 'baska' },
  ] }));
  const app = await uygulama({ db });
  try {
    let p = await app.call('GET', '/api/ansible/longjob-cancel/permissions');
    assert.deepEqual(p.json.permissions.map((x) => [x.state, x.via]), [['no_admin', 'service'], ['no_admin', 'service']]);
    await tokenKaydet(app);
    awx.istekler.length = 0;
    p = await app.call('GET', '/api/ansible/longjob-cancel/permissions');
    const [a, b] = p.json.permissions;
    assert.equal(a.state, 'admin', 'token sahibinin Admin rolu olculmedi');
    assert.equal(a.via, 'cancel_token');
    assert.equal(a.tokenOwner, 'onurdemir3');
    assert.equal(a.tokenScope, 'unknown', 'kisisel token in kapsami olculemez; write DENMEZ');
    assert.equal(b.state, 'no_admin');
    assert.match(fold(b.message), /Iptal token'inin sahibi onurdemir3 bu template'te Admin degil/);
    const tpl = awx.istekler.filter((x) => /^\/api\/v2\/job_templates\//.test(x.path));
    assert.deepEqual([...new Set(tpl.map((x) => x.user))], ['onurdemir3'], 'yetki token ile okunmadi');
    // Kaydet (PUT) yaniti da ayni olcumu yapar
    const put = await app.call('PUT', '/api/ansible/longjob-cancel', db.blobs.get('longjob-cancel') ? JSON.parse(db.blobs.get('longjob-cancel')) : CFG());
    assert.equal(put.json.permissions[0].via, 'cancel_token');
    assert.match(fold(put.json.warnings.join(' ')), /iptal token'i sahibi onurdemir3/);
    sizintiYok(p.text + put.text, 'yetki yaniti');
  } finally {
    await app.kapat();
  }
});

// ── TK10 ─────────────────────────────────────────────────────────────────────
test('TK10 SIZINTI YOK: AWX Authorization i (Bearer + ham) yansitsa bile token log/denetim/Teams/HTTP/DB de gorunmez', async (t) => {
  const kons = konsolYakala(t);
  awx.echoAuth = true;
  isEkle({ id: 1200, tpl: 42, started: ago(120) });
  isEkle({ id: 1201, tpl: 43, started: ago(120) });
  awx.templates.set(42, { name: 'a', admins: [] }); // 403 (yansitmali)
  awx.templates.set(43, { name: 'b', admins: [] });
  const db = dbOf(CFG({ templates: [
    { serverId: 1, templateId: 42, kind: 'job', name: 'a' },
    { serverId: 1, templateId: 43, kind: 'job', name: 'b' },
  ] }));
  const app = await uygulama({ db });
  try {
    await app.call('PUT', '/api/ansible/longjob-cancel/tokens/1', { token: YANLIS }); // 401 yansitmali
    await tokenKaydet(app);
    await cycle(db); // 1200 + 1201: 403 yansitmali
    awx.users.delete(KISISEL);
    isEkle({ id: 1202, tpl: 42, started: ago(120) });
    await cycle(db); // 1202: 401 yansitmali
    const yanitlar = [
      await app.call('GET', '/api/ansible/longjob-cancel/status'),
      await app.call('GET', '/api/ansible/longjob-cancel/tokens'),
      await app.call('GET', '/api/ansible/longjob-cancel/permissions'),
      await app.call('POST', '/api/ansible/longjob-cancel/tokens/1/verify'),
      await app.call('POST', '/api/ansible/longjob-cancel/dry-run'),
    ];
    const hepsi = JSON.stringify({ st: ljc.getStatus(), audits, kartlar: teams.kartlar });
    assert.ok(/You do not have permission/.test(hepsi), 'test kurgusu: 403 kayda gecmedi');
    assert.ok(fold(hepsi).includes("IPTAL TOKEN'I GECERSIZ"), 'test kurgusu: 401 kayda gecmedi');
    assert.ok(kons.some((l) => l.includes('raw ***')), 'test kurgusu: yansitilan govde loga hic dusmedi');
    sizintiYok(hepsi, 'durum/denetim/Teams');
    for (const y of yanitlar) sizintiYok(y.text, 'HTTP yaniti');
    sizintiYok(kons.join('\n'), 'log');
    for (const y of db.yazilan) sizintiYok(y, 'DB');
    // katman: runner.redactSecrets token i (silinmis olsa bile) tanir
    assert.ok(!runner.redactSecrets(`x ${KISISEL} y`).includes(KISISEL), 'runner.redactSecrets iptal token ini maskelemiyor');
  } finally {
    await app.kapat();
  }
});

// ── TK11 ─────────────────────────────────────────────────────────────────────
test('TK11 token uclari yalniz Admin: reddedilirse DB ye de AWX e de gidilmez', async () => {
  const db = dbOf(CFG());
  const red = (_q, res) => res.status(403).json({ ok: false, message: 'Admin gerekli' });
  const app = await uygulama({ db, requireAdmin: red });
  try {
    const tokenUclari = app.kayit.filter((k) => /\/tokens/.test(k.p));
    assert.deepEqual(
      tokenUclari.map((k) => `${k.m} ${k.p}`).sort(),
      [
        'delete /api/ansible/longjob-cancel/tokens/:serverId',
        'get /api/ansible/longjob-cancel/tokens',
        'post /api/ansible/longjob-cancel/tokens/:serverId/verify',
        'put /api/ansible/longjob-cancel/tokens/:serverId',
      ],
    );
    for (const k of tokenUclari) {
      assert.equal(k.h[0], app.requireAuth, `${k.m} ${k.p}: ilk bekci requireAuth degil`);
      assert.equal(k.h[1], app.requireAdmin, `${k.m} ${k.p}: ikinci bekci requireAdmin degil`);
      const r = await app.call(k.m.toUpperCase(), k.p.replace(':serverId', '1'), k.m === 'get' ? undefined : { token: KISISEL });
      assert.equal(r.status, 403, `${k.m} ${k.p} Admin olmadan acik`);
    }
    assert.equal(db.sorgular, 0, 'yetkisiz istek DB ye ulasti');
    assert.equal(awx.istekler.length, 0, 'yetkisiz istek AWX e ulasti');
  } finally {
    await app.kapat();
  }
});

// ── TK12 ─────────────────────────────────────────────────────────────────────
test('TK12 Sil: tanimli degil olur, denetime DEGERSIZ yazilir, sonraki iptal servis kullanicisiyla; silinen deger yine maskelenir', async (t) => {
  konsolYakala(t);
  isEkle({ id: 1300, tpl: 42, started: ago(120), createdBy: 'portal_svc' });
  const db = dbOf(CFG());
  const app = await uygulama({ db });
  try {
    await tokenKaydet(app);
    const del = await app.call('DELETE', '/api/ansible/longjob-cancel/tokens/1');
    assert.equal(del.status, 200);
    assert.equal(del.json.deleted, true);
    const g = await app.call('GET', '/api/ansible/longjob-cancel/tokens');
    assert.equal(g.json.servers.find((x) => x.serverId === 1).defined, false);
    const den = audits.filter((a) => a.action === 'awx_long_job_cancel_token').map((a) => JSON.parse(a.detail));
    assert.deepEqual(den.map((d) => d.op), ['set', 'delete']);
    assert.equal(den[1].owner, 'onurdemir3');
    sizintiYok(JSON.stringify(audits) + del.text + g.text, 'silme');
    awx.istekler.length = 0;
    await cycle(db);
    assert.deepEqual(posts().map((p) => p.user), ['portal_svc'], 'silinen token la iptal denendi');
    assert.ok(!runner.redactSecrets(`x ${KISISEL}`).includes(KISISEL), 'silinen token artik maskelenmiyor');
  } finally {
    await app.kapat();
  }
});

// ── TK13 ─────────────────────────────────────────────────────────────────────
test('TK13 cozulemeyen token (anahtar degisti): IPTAL EDILEMEDI + Teams; servis kullanicisina SESSIZCE dusulmez', async (t) => {
  konsolYakala(t);
  isEkle({ id: 1400, tpl: 42, started: ago(120), createdBy: 'portal_svc' });
  // Servis kullanicisi Admin: sessizce ona dusulse iptal de yetki olcumu de "basarili" gorunurdu.
  awx.templates.set(42, { name: 'nginx_config_audit', admins: ['portal_svc'] });
  const db = dbOf(CFG());
  const app = await uygulama({ db });
  try {
    await tokenKaydet(app);
    ljc._reset(); // bellekteki cozulmus deger gider (restart benzeri)
    process.env.ENV_OVERRIDES_ENCRYPTION_KEY = KEY_B;
    awx.istekler.length = 0;
    const s = await cycle(db);
    assert.equal(posts().length, 0, 'cozulemeyen token yerine servis kullanicisiyla iptal denendi');
    const row = s.jobs.find((j) => j.jobId === 1400);
    assert.equal(row.decision, 'cancel_failed');
    assert.match(fold(row.reason), /COZULEMEDI/);
    const kart = teams.kartlar.filter((k) => fold(kartBaslik(k)).includes('IPTAL EDILEMEDI'));
    assert.equal(kart.length, 1);
    assert.match(fold(kartBaslik(kart[0])), /COZULEMEDI/);
    const f = audits.find((a) => a.action === 'awx_long_job_cancel' && a.result === 'fail');
    assert.equal(JSON.parse(f.detail).tokenUndecryptable, true);

    // Yetki on kontrolu (GET /permissions ve Kaydet yaniti): OLCULEMEDI, token sahibi yazilir;
    // servis kullanicisina gore OLCULMEZ ("Admin YOK"/"Admin" denmez), AWX'e template istegi gitmez.
    awx.istekler.length = 0;
    const p = await app.call('GET', '/api/ansible/longjob-cancel/permissions');
    const put = await app.call('PUT', '/api/ansible/longjob-cancel', CFG());
    for (const [etiket, perms] of [['GET /permissions', p.json.permissions], ['PUT yaniti', put.json.permissions]]) {
      assert.deepEqual(
        perms.map((x) => [x.state, x.via, x.tokenOwner]),
        [['unknown', 'cancel_token', 'onurdemir3']],
        `${etiket}: cozulemeyen token servis kullanicisina gore olculdu`,
      );
      assert.match(fold(perms[0].message), /Olculemedi/);
    }
    assert.equal(
      awx.istekler.filter((x) => /job_templates/.test(x.path)).length,
      0,
      'cozulemeyen token yerine servis kullanicisiyla yetki olculdu',
    );
  } finally {
    await app.kapat();
  }
});

// ── TK14 ─────────────────────────────────────────────────────────────────────
test('TK14 DB de onekisiz (duz metin) kayit YOK sayilir: kullanilmaz, ekranda tanimli gorunmez', async (t) => {
  konsolYakala(t);
  isEkle({ id: 1500, tpl: 42, started: ago(120), createdBy: 'portal_svc' });
  const db = dbOf(CFG());
  db.blobs.set(tokenStore.BLOB_NAME, JSON.stringify({ servers: { 1: { tokenEnc: KISISEL, owner: 'onurdemir3' } } }));
  const app = await uygulama({ db });
  try {
    const g = await app.call('GET', '/api/ansible/longjob-cancel/tokens');
    assert.equal(g.json.servers.find((x) => x.serverId === 1).defined, false);
    awx.istekler.length = 0;
    await cycle(db);
    assert.deepEqual(posts().map((p) => p.user), ['portal_svc'], 'duz metin kayit iptal icin kullanildi');
  } finally {
    await app.kapat();
  }
});

// ── TK15 ─────────────────────────────────────────────────────────────────────
test('TK15 Dogrula: gecerli -> ok; AWX 500 -> olculemedi (kayit degismez); 401 -> GECERSIZ', async (t) => {
  konsolYakala(t);
  const db = dbOf(CFG());
  const app = await uygulama({ db });
  try {
    await tokenKaydet(app);
    let v = await app.call('POST', '/api/ansible/longjob-cancel/tokens/1/verify');
    assert.equal(v.json.result.ok, true);
    assert.equal(v.json.result.owner, 'onurdemir3');

    awx.meStatus = 500;
    v = await app.call('POST', '/api/ansible/longjob-cancel/tokens/1/verify');
    assert.equal(v.json.result.ok, false);
    assert.equal(v.json.result.measured, false, 'AWX 500 olculmus sayildi');
    assert.equal(v.json.token.invalid, false, 'AWX 500 token i GECERSIZ yapti');
    assert.equal(v.json.token.lastVerify.ok, true, 'olculemeyen dogrulama kaydi degistirdi');

    awx.meStatus = 0;
    awx.users.delete(KISISEL);
    v = await app.call('POST', '/api/ansible/longjob-cancel/tokens/1/verify');
    assert.equal(v.json.result.ok, false);
    assert.equal(v.json.result.httpStatus, 401);
    assert.equal(v.json.token.invalid, true);
    assert.equal(v.json.token.lastVerify.result, 'gecersiz');
    const den = audits.filter((a) => a.action === 'awx_long_job_cancel_token').map((a) => [JSON.parse(a.detail).op, a.result]);
    assert.deepEqual(den, [['set', 'ok'], ['verify', 'ok'], ['verify', 'fail'], ['verify', 'fail']]);
  } finally {
    await app.kapat();
  }
});

// ── TK16 ─────────────────────────────────────────────────────────────────────
test('TK16 coklu Portal ornegi: token BASKA ornekte kaydedilirse bu ornekte iptal edilemeyen is yeniden denenir', async (t) => {
  konsolYakala(t);
  isEkle({ id: 1600, tpl: 42, started: ago(120) });
  awx.templates.set(42, { name: 'nginx_config_audit', admins: ['onurdemir3'] });
  const db = dbOf(CFG());
  let s = await cycle(db); // servis kullanicisi: 403 -> kalici
  assert.equal(s.jobs.find((j) => j.jobId === 1600).decision, 'cancel_failed');
  await cycle(db);
  assert.equal(posts().length, 1, 'kalici 403 tekrar denendi');
  // Baska ornek dogrudan depoya yazar: bu ornegin resetFailuresForServer'i CAGRILMAZ.
  await tokenStore.saveToken(db, {
    serverId: 1,
    server: runner.getServerById(1),
    token: KISISEL,
    by: 'diger_ornek',
    verify: (tok) => runner.whoAmIWithTokenOnServer(1, tok),
  });
  tokenStore._expireCache();
  s = await cycle(db);
  assert.deepEqual(posts().map((p) => p.user), ['portal_svc', 'onurdemir3'], 'yeni token la yeniden denenmedi');
  assert.equal(awx.jobs.get(1600).status, 'canceled');
  assert.equal(s.jobs.find((j) => j.jobId === 1600).decision, 'cancel_requested');
});

// ── TK17 ─────────────────────────────────────────────────────────────────────
test('TK17 runner sozlesmesi: authToken 401 -> cancelTokenInvalid + kalici + "IPTAL TOKEN I GECERSIZ"; deger mesajda yok', async (t) => {
  konsolYakala(t);
  awx.echoAuth = true;
  isEkle({ id: 1700, tpl: 42, started: ago(120) });
  await assert.rejects(
    () => runner.cancelJobOnServer(1, 1700, { kind: 'job', authToken: 'IPTAL-EDILMIS-TOKEN-77', authOwner: 'onurdemir3' }),
    /** @param {any} e */ (e) => {
      assert.equal(e.status, 401);
      assert.equal(e.cancelTokenInvalid, true);
      assert.equal(e.permanent, true);
      assert.match(fold(e.message), /IPTAL TOKEN'I GECERSIZ \(AWX 401; token sahibi onurdemir3\)/);
      assert.ok(!e.message.includes('IPTAL-EDILMIS-TOKEN-77'), 'token degeri hata mesajina sizdi');
      return true;
    },
  );
  // authToken'siz cagri (ScaleX/LogX/Telnet) 401'i eski bicimde firlatir: cancelTokenInvalid YOK.
  awx.users.delete(SVC);
  await assert.rejects(
    () => runner.cancelJobOnServer(1, 1700),
    /** @param {any} e */ (e) => e.status === 401 && e.cancelTokenInvalid === undefined,
  );
});

// ── TK18 ─────────────────────────────────────────────────────────────────────
test('TK18 token KAYDI okunamazsa (olculemedi) servis kullanicisina DUSULMEZ: iptal denenmez, kart "OKUNAMADI"; kayit okununca token la iptal', async (t) => {
  konsolYakala(t);
  isEkle({ id: 1800, tpl: 42, started: ago(120), createdBy: 'ayse' });
  // Servis kullanicisi Admin DEGIL (uretimdeki durum): ona dusulse 403 alip isi kalici "edilemedi" sayardi.
  awx.templates.set(42, { name: 'nginx_config_audit', admins: ['onurdemir3'] });
  const db = dbSecici(CFG());
  const app = await uygulama({ db });
  try {
    await tokenKaydet(app);
    ljc._reset(); // restart: bellekte son gecerli token kaydi YOK
    db.tokFail = true; // yalniz 'longjob-cancel-tokens' okumasi duser; yapilandirma okunur
    awx.istekler.length = 0;

    // Kuru calistirma: gercek taramada iptalin DENENMEYECEGINI soyler (token var/yok DENMEZ).
    const dry = await app.call('POST', '/api/ansible/longjob-cancel/dry-run');
    const dRow = dry.json.result.jobs.find((j) => j.jobId === 1800);
    assert.equal(dRow.decision, 'would_cancel');
    assert.match(fold(dRow.reason), /iptal token kaydi OKUNAMADI: gercek taramada iptal DENENMEZ/);

    let s;
    for (let i = 1; i <= ljc.MAX_ATTEMPTS; i++) {
      s = await cycle(db);
      assert.equal(posts().length, 0, `tur ${i}: kayit okunamazken iptal denendi (servis kullanicisina dusuldu)`);
      const row = s.jobs.find((j) => j.jobId === 1800);
      assert.equal(row.decision, 'cancel_failed', `tur ${i}`);
      assert.match(fold(row.reason), /IPTAL TOKEN KAYDI OKUNAMADI/, `tur ${i}: durum satiri okunamadi demiyor`);
      // Kisa neden (ipucu) da ayni seyi soyler: "iptal token kaydi OKUNAMADI — iptal denenmedi".
      assert.match(fold(row.reason), /iptal token kaydi OKUNAMADI — iptal denenmedi/, `tur ${i}: durum satiri ipucu yok`);
      if (i < ljc.MAX_ATTEMPTS) assert.match(fold(row.reason), /tekrar denenecek/, `tur ${i}: gecici sayilmadi`);
    }
    // Son denemede (SESSIZ degil) TEK kart: "OKUNAMADI"; servis kullanicisina Admin rolu ONERMEZ.
    const kart = teams.kartlar.filter((k) => fold(kartBaslik(k)).includes('IPTAL EDILEMEDI'));
    assert.equal(kart.length, 1, 'kayit okunamadi karti gitmedi (ya da her turda gitti)');
    assert.match(fold(kartBaslik(kart[0])), /IPTAL TOKEN KAYDI OKUNAMADI/);
    const km = fold(JSON.stringify(kart[0]));
    assert.match(km, /DB erisimini kontrol edin/);
    assert.doesNotMatch(km, /Admin rolu/, 'kart yanlis duzeltme (servis kullanicisina Admin rolu) oneriyor');
    const f = audits
      .filter((a) => a.action === 'awx_long_job_cancel' && a.result === 'fail')
      .map((a) => JSON.parse(a.detail));
    assert.equal(f.length, ljc.MAX_ATTEMPTS, 'her denenmeyen tur denetime yazilmadi');
    for (const d of f) {
      assert.equal(d.tokenStoreUnreadable, true);
      assert.equal(d.via, 'unknown', 'kimlik olculemedi yerine bir kimlik yazildi');
      assert.equal(d.permanent, false, 'okunamayan kayit kalici sayildi');
      assert.match(fold(d.credential), /Iptal denenmedi/);
    }

    // Yetki on kontrolu: OLCULEMEDI; servis kullanicisina gore olculmez, AWX'e gidilmez.
    awx.istekler.length = 0;
    const p = await app.call('GET', '/api/ansible/longjob-cancel/permissions');
    assert.deepEqual(p.json.permissions.map((x) => [x.state, x.via]), [['unknown', 'unknown']]);
    assert.match(fold(p.json.permissions[0].message), /iptal token kaydi OKUNAMADI/);
    assert.equal(awx.istekler.length, 0, 'kayit okunamazken yetki AWX te (servis kullanicisiyla) olculdu');

    // Kayit okunur hale gelince is token'la YENIDEN denenir ve iptal edilir.
    db.tokFail = false;
    s = await cycle(db);
    assert.deepEqual(posts().map((x) => x.user), ['onurdemir3'], 'kayit okununca token la yeniden denenmedi');
    assert.equal(awx.jobs.get(1800).status, 'canceled');
    assert.equal(s.jobs.find((j) => j.jobId === 1800).decision, 'cancel_requested');
    sizintiYok(JSON.stringify({ audits, kartlar: teams.kartlar, st: ljc.getStatus() }), 'durum/denetim/Teams');
  } finally {
    await app.kapat();
  }
});

// ── TK19 ─────────────────────────────────────────────────────────────────────
test('TK19 bozuk (JSON) token kaydi da OLCULEMEDI: token tanimsiz sunucuda bile iptal denenmez; kayit duzelince servis kullanicisiyla yeniden denenir', async (t) => {
  konsolYakala(t);
  isEkle({ id: 1900, tpl: 42, started: ago(120), createdBy: 'ayse' });
  awx.templates.set(42, { name: 'nginx_config_audit', admins: ['portal_svc'] });
  const db = dbOf(CFG());
  db.blobs.set(tokenStore.BLOB_NAME, '{"servers": {"1": {"tokenEnc": "enc:v1:'); // yarim yazilmis
  for (let i = 1; i <= ljc.MAX_ATTEMPTS; i++) {
    const s = await cycle(db);
    assert.equal(posts().length, 0, `tur ${i}: bozuk kayitta servis kullanicisiyla iptal denendi`);
    assert.match(fold(s.jobs.find((j) => j.jobId === 1900).reason), /IPTAL TOKEN KAYDI OKUNAMADI/);
  }
  assert.equal(ljc.getStatus().open.failed, 1);
  // DBA kaydi duzeltti (bu sunucuda token YOK): is servis kullanicisiyla yeniden denenir.
  db.blobs.set(tokenStore.BLOB_NAME, JSON.stringify({ servers: {} }));
  tokenStore._expireCache();
  const s = await cycle(db);
  assert.deepEqual(posts().map((x) => x.user), ['portal_svc'], 'kayit duzelince is yeniden denenmedi');
  assert.equal(awx.jobs.get(1900).status, 'canceled');
  assert.equal(s.jobs.find((j) => j.jobId === 1900).decision, 'cancel_requested');
});

// ── TK20 ─────────────────────────────────────────────────────────────────────
test('TK20 coklu AWX sunucusu: token YALNIZ kaydedildigi sunucuya gider; diger sunucuda iptal ve yetki servis kullanicisiyla', async (t) => {
  konsolYakala(t);
  const geriAl = ikinciSunucu();
  try {
    isEkle({ id: 2000, tpl: 42, started: ago(120) });
    awx.templates.set(42, { name: 'nginx_config_audit', admins: ['onurdemir3'] });
    awx2.jobs.set(77, { id: 77, tpl: 42, tplName: 'nginx_config_audit', status: 'running', started: ago(120), created: ago(120), createdBy: 'x' });
    awx2.templates.set(42, { name: 'nginx_config_audit', admins: ['portal_svc2'] });
    const cfg = CFG({
      templates: [
        { serverId: 1, templateId: 42, kind: 'job', name: 'nginx_config_audit' },
        { serverId: 2, templateId: 42, kind: 'job', name: 'nginx_config_audit' },
      ],
    });
    const db = dbOf(cfg);
    const app = await uygulama({ db });
    try {
      await tokenKaydet(app); // yalniz sunucu 1
      const p = await app.call('GET', '/api/ansible/longjob-cancel/permissions');
      const put = await app.call('PUT', '/api/ansible/longjob-cancel', cfg);
      const g = await app.call('GET', '/api/ansible/longjob-cancel/tokens');
      const s = await cycle(db);

      for (const [etiket, perms] of [['GET /permissions', p.json.permissions], ['PUT yaniti', put.json.permissions]]) {
        assert.deepEqual(
          perms.map((x) => [x.serverId, x.state, x.via, x.tokenOwner]),
          [
            [1, 'admin', 'cancel_token', 'onurdemir3'],
            [2, 'admin', 'service', null],
          ],
          `${etiket}: yetki yanlis kimlikle olculdu`,
        );
      }
      assert.equal(g.json.servers.find((x) => x.serverId === 2).defined, false);
      assert.deepEqual(posts().map((x) => [x.path, x.user]), [['/api/v2/jobs/2000/cancel/', 'onurdemir3']]);
      assert.deepEqual(
        awx2.istekler.filter((x) => x.method === 'POST').map((x) => [x.path, x.user]),
        [['/api/v2/jobs/77/cancel/', 'portal_svc2']],
        'ikinci sunucudaki is servis kullanicisiyla iptal edilmedi',
      );
      assert.equal(awx2.jobs.get(77).status, 'canceled');
      assert.doesNotMatch(fold(s.jobs.find((j) => j.jobId === 77).reason), /token'iyla/);
      assert.ok(awx2.istekler.length > 0, 'test kurgusu: ikinci sunucuya hic istek gitmedi');
      for (const r of awx2.istekler) {
        assert.ok(!r.auth.includes(KISISEL), `${r.method} ${r.path}: kisisel token IKINCI sunucuya gitti`);
        assert.equal(r.user, 'portal_svc2', `${r.method} ${r.path}: ikinci sunucuda servis kullanicisi kullanilmadi`);
      }
    } finally {
      await app.kapat();
    }
  } finally {
    geriAl();
  }
});

// ── TK21 ─────────────────────────────────────────────────────────────────────
test('TK21 token kaydedildigi AWX ADRESINE bagli: adres degisirse token yeni adrese HIC gitmez (iptal, yetki, Dogrula, kuru calistirma); kart/denetim/ekran soyler', async (t) => {
  konsolYakala(t);
  awx.templates.set(42, { name: 'nginx_config_audit', admins: ['onurdemir3'] });
  const db = dbOf(CFG());
  const app = await uygulama({ db });
  const eskiUrl = process.env.AWX_1_URL;
  const eskiTok = process.env.AWX_1_TOKEN;
  try {
    await tokenKaydet(app);
    const once = (await app.call('GET', '/api/ansible/longjob-cancel/tokens')).json.servers.find((x) => x.serverId === 1);
    assert.equal(once.boundTo, `http://127.0.0.1:${awx.port}/api/v2`, 'kayit adrese baglanmadi');
    assert.equal(once.addressChanged, false);
    assert.equal(once.invalid, false);

    // Sunucu 1'in adresi BASKA bir AWX'e cevrildi (ansible_awx_servers / env). Yeni adres token'i
    // TANISA bile gonderilmemeli (kisisel token baska host'un loglarina/vekillerine dusmesin).
    process.env.AWX_1_URL = `http://127.0.0.1:${awx2.port}`;
    process.env.AWX_1_TOKEN = SVC2;
    awx2.users.set(KISISEL, 'onurdemir3');
    awx2.jobs.set(88, { id: 88, tpl: 42, tplName: 'nginx_config_audit', status: 'running', started: ago(120), created: ago(120), createdBy: 'x' });
    awx2.templates.set(42, { name: 'nginx_config_audit', admins: ['onurdemir3', 'portal_svc2'] });

    const dry = await app.call('POST', '/api/ansible/longjob-cancel/dry-run');
    const s = await cycle(db);
    const p = await app.call('GET', '/api/ansible/longjob-cancel/permissions');
    const v = await app.call('POST', '/api/ansible/longjob-cancel/tokens/1/verify');
    const g = await app.call('GET', '/api/ansible/longjob-cancel/tokens');
    const st = ljc.getStatus();
    await cycle(db); // kalici: tekrar denenmez

    assert.ok(awx2.istekler.length > 0, 'test kurgusu: yeni adrese hic istek gitmedi');
    for (const r of awx2.istekler) assert.ok(!r.auth.includes(KISISEL), `${r.method} ${r.path}: kisisel token YENI adrese gitti`);
    assert.equal(awx2.istekler.filter((x) => x.method === 'POST').length, 0, 'adres degisince iptal yine denendi');
    assert.equal(awx2.jobs.get(88).status, 'running');

    assert.match(fold(dry.json.result.jobs.find((j) => j.jobId === 88).reason), /bu AWX adresi icin kaydedilmedi: gercek taramada iptal DENENMEZ/);
    const row = s.jobs.find((j) => j.jobId === 88);
    assert.equal(row.decision, 'cancel_failed');
    assert.match(fold(row.reason), /BU AWX ADRESI ICIN KAYDEDILMEDI/);
    assert.match(fold(row.reason), /tekrar denenmiyor/);
    const kart = teams.kartlar.filter((k) => fold(kartBaslik(k)).includes('IPTAL EDILEMEDI'));
    assert.equal(kart.length, 1);
    assert.match(fold(kartBaslik(kart[0])), /BU AWX ADRESI ICIN KAYDEDILMEDI \(onurdemir3\)/);
    const f = audits.filter((a) => a.action === 'awx_long_job_cancel' && a.result === 'fail').map((a) => JSON.parse(a.detail));
    assert.equal(f.length, 1);
    assert.equal(f[0].tokenServerMismatch, true);
    assert.equal(f[0].permanent, true);
    assert.equal(f[0].via, 'cancel_token');

    assert.deepEqual(p.json.permissions.map((x) => [x.state, x.via, x.tokenOwner]), [['unknown', 'cancel_token', 'onurdemir3']]);
    assert.equal(v.json.result.ok, false);
    assert.equal(v.json.result.addressChanged, true);
    assert.match(fold(v.json.result.message), /BU AWX ADRESI ICIN KAYDEDILMEDI/);
    const s1 = g.json.servers.find((x) => x.serverId === 1);
    assert.equal(s1.addressChanged, true, 'ekran adres degisimini bilmiyor');
    assert.equal(s1.invalid, true);
    assert.match(fold(s1.addressMessage), /sunucu simdi http:\/\/127\.0\.0\.1:\d+\/api\/v2 adresini gosteriyor/);
    assert.equal(st.open.tokenInvalid, 1, 'durum ekraninda token kullanilamiyor bandi yok');
    for (const y of [dry.text, p.text, v.text, g.text]) sizintiYok(y, 'HTTP yaniti');
  } finally {
    process.env.AWX_1_URL = eskiUrl;
    process.env.AWX_1_TOKEN = eskiTok;
    await app.kapat();
  }
});

// ── TK22 ─────────────────────────────────────────────────────────────────────
test('TK22 adres baglamasi olmayan kayit KULLANILMAZ (ilk kullanimda baglanmaz): iptal denenmez, neden yazilir', async (t) => {
  konsolYakala(t);
  isEkle({ id: 2200, tpl: 42, started: ago(120) });
  awx.templates.set(42, { name: 'nginx_config_audit', admins: ['onurdemir3', 'portal_svc'] });
  const db = dbOf(CFG());
  const enc = require('../../db/env-overrides.cjs').encryptSecretValue(KISISEL);
  assert.match(enc, /^enc:v1:/);
  db.blobs.set(tokenStore.BLOB_NAME, JSON.stringify({ servers: { 1: { tokenEnc: enc, owner: 'onurdemir3' } } }));
  const s = await cycle(db);
  assert.equal(posts().length, 0, 'baglamasiz kayitla (ya da servis kullanicisiyla) iptal denendi');
  assert.ok(awx.istekler.every((x) => !x.auth.includes(KISISEL)), 'baglamasiz kaydin token i AWX e gitti');
  assert.match(fold(s.jobs.find((j) => j.jobId === 2200).reason), /kayitta token'in hangi AWX adresi icin girildigi yok/);
  // Baglanan adres: origin (kullanici:sifre@ YOK, kucuk harf) + API tabani; AAP 2.5 gateway yolu
  // (ayni host, farkli taban) da ayri adres sayilir.
  assert.equal(
    tokenStore.serverFingerprint({ url: 'https://u:p@AWX.Example:8443/eski/yol', apiBase: 'api/controller/v2/' }),
    'https://awx.example:8443/api/controller/v2',
  );
  assert.notEqual(
    tokenStore.serverFingerprint({ url: 'https://awx.example' }),
    tokenStore.serverFingerprint({ url: 'https://awx.example', apiBase: '/api/controller/v2' }),
  );
});

// ── TK23 ─────────────────────────────────────────────────────────────────────
test('TK23 gecici 401 sonrasi Dogrula GECERLI: kirmizi bant kalkar, iptal edilemeyen is token la hemen yeniden denenir', async (t) => {
  konsolYakala(t);
  isEkle({ id: 2300, tpl: 42, started: ago(120) });
  awx.templates.set(42, { name: 'nginx_config_audit', admins: ['onurdemir3'] });
  const db = dbOf(CFG());
  const app = await uygulama({ db });
  try {
    await tokenKaydet(app);
    awx.users.delete(KISISEL); // gecici 401 (or. AWX/LDAP aksakligi)
    await cycle(db);
    assert.equal(ljc.getStatus().open.tokenInvalid, 1, 'test kurgusu: 401 bandi olusmadi');
    assert.equal(ljc.getStatus().open.failed, 1);
    awx.users.set(KISISEL, 'onurdemir3'); // AWX duzeldi
    const v = await app.call('POST', '/api/ansible/longjob-cancel/tokens/1/verify');
    assert.equal(v.json.result.ok, true);
    const st = ljc.getStatus();
    assert.equal(st.open.tokenInvalid, 0, "Dogrula gecerli dedi ama IPTAL TOKEN'I GECERSIZ bandi kalkmadi");
    assert.equal(st.open.failed, 0, 'Dogrula sonrasi iptal edilemeyen is yeniden denemeye acilmadi');
    assert.equal(v.json.token.invalid, false);
    awx.istekler.length = 0;
    const s = await cycle(db);
    assert.deepEqual(posts().map((x) => x.user), ['onurdemir3'], 'Dogrula sonrasi is token la yeniden denenmedi');
    assert.equal(awx.jobs.get(2300).status, 'canceled');
    assert.equal(s.jobs.find((j) => j.jobId === 2300).decision, 'cancel_requested');
  } finally {
    await app.kapat();
  }
});

// ── TK24 ─────────────────────────────────────────────────────────────────────
test('TK24 kuru calistirma iptalin hangi token la yapilacagini soyler; token yoksa soylemez; hicbir sey iptal edilmez', async (t) => {
  konsolYakala(t);
  isEkle({ id: 2400, tpl: 42, started: ago(120) });
  const db = dbOf(CFG());
  const app = await uygulama({ db });
  try {
    let r = await app.call('POST', '/api/ansible/longjob-cancel/dry-run');
    let row = r.json.result.jobs.find((j) => j.jobId === 2400);
    assert.equal(row.decision, 'would_cancel');
    assert.doesNotMatch(fold(row.reason), /token'iyla/, 'token yokken kuru calistirma token dan soz etti');
    await tokenKaydet(app);
    r = await app.call('POST', '/api/ansible/longjob-cancel/dry-run');
    row = r.json.result.jobs.find((j) => j.jobId === 2400);
    assert.equal(row.decision, 'would_cancel');
    assert.match(fold(row.reason), /iptal onurdemir3 token'iyla yapilir/, 'kuru calistirma iptal kimligini soylemiyor');
    assert.equal(posts().length, 0, 'kuru calistirma iptal istegi gonderdi');
    sizintiYok(r.text, 'kuru calistirma yaniti');
  } finally {
    await app.kapat();
  }
});

// ── TK25 ─────────────────────────────────────────────────────────────────────
test("TK25 403 + isi token sahibi baslatmis: sebep template Admin rolu DEGIL, token 'write' kapsami (durum + kart + denetim)", async (t) => {
  konsolYakala(t);
  isEkle({ id: 2500, tpl: 42, started: ago(120), createdBy: 'onurdemir3' });
  awx.templates.set(42, { name: 'nginx_config_audit', admins: [] });
  awx.readScope = new Set([KISISEL]); // 'read' kapsamli kisisel token: iptal POST'u 403
  const db = dbOf(CFG());
  const app = await uygulama({ db });
  try {
    await tokenKaydet(app);
  } finally {
    await app.kapat();
  }
  awx.istekler.length = 0;
  const s = await cycle(db);
  assert.deepEqual(posts().map((x) => x.user), ['onurdemir3']);
  const row = s.jobs.find((j) => j.jobId === 2500);
  assert.equal(row.decision, 'cancel_failed');
  const r = fold(row.reason);
  assert.match(r, /isi iptal token'inin sahibi onurdemir3 baslatmis/i, 'durum satiri isi token sahibinin baslattigini soylemiyor');
  assert.match(r, /'write' kapsamli/);
  assert.doesNotMatch(r, /token sahibi onurdemir3 bu template'te Admin degil/i, 'yanlis sebep: Admin rolu');
  const kart = teams.kartlar.find((k) => fold(kartBaslik(k)).includes('IPTAL EDILEMEDI'));
  const km = fold(JSON.stringify(kart));
  assert.match(km, /Bu isi iptal token'inin sahibi onurdemir3 baslatmis/);
  assert.match(km, /sebep template Admin rolu DEGIL/);
  assert.doesNotMatch(km, /kullanicisina bu template'te Admin rolu verin/, 'kart yanlis duzeltme (Admin rolu) oneriyor');
  const d = JSON.parse(audits.find((a) => a.action === 'awx_long_job_cancel' && a.result === 'fail').detail);
  assert.equal(d.createdByPortal, true);
  assert.equal(d.permanent, true);
  assert.match(fold(d.error), /baslatmis/);
});

// ── TK26 ─────────────────────────────────────────────────────────────────────
test('TK26 runner sozlesmesi: JSON OLMAYAN hata govdesi (vekil HTML) istegin token ini yansitsa da hata metnine ve loga sizmaz', async (t) => {
  const kons = konsolYakala(t);
  awx.meHtml = true;
  try {
    await assert.rejects(
      () => runner.whoAmIWithTokenOnServer(1, KISISEL),
      /** @param {any} e */ (e) => {
        assert.match(String(e.message), /JSON değil \(502\)/, 'test kurgusu: JSON-olmayan yol calismadi');
        assert.ok(!String(e.message).includes(KISISEL), 'token degeri JSON-olmayan hata metnine sizdi');
        return true;
      },
    );
  } finally {
    awx.meHtml = false;
  }
  sizintiYok(kons.join('\n'), 'log');
});
