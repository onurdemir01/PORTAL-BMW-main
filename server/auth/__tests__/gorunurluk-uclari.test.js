// server/auth/__tests__/gorunurluk-uclari.test.js — /api/visibility HTTP YUZEYI (2026-11-27, kapsam PR-2).
//
// Gorunurluk motorunun kendisi (visibility.cjs) ve kural deposu (elements.cjs) ayri testlerde; Admin >
// Erisim ekranlarinin yazdigi uclar (sayfa haritasi, oge / kural, Denetim / Crypto Hub / Nginx Hub erisimi,
// /explain simulasyonu) ise hicbir testte HTTP uzerinden kosmuyordu. Gercek router; motor, depo, LDAP ve
// kimlik modullerinin disari acilan islevleri sahte (modul nesnesi uzerinde yerinde degistirilir).
//   VR1 erisim: okuma uclari oturum ister, yazma uclari Admin
//   VR2 sayfa haritasi: dogrulama, kismi kayit 207, motor hatasi 500, surum artar; ETag / 304
//   VR3 menu gruplari, oge listesi, LDAP arama (en az 3 karakter, 502)
//   VR4 oge / kural / kati / etkin / silme uclari
//   VR5 /explain: kendi gorunurlugu; Admin baskasini simule eder (LDAP gruplari, okunamadi / bulunamadi uyarisi)
//   VR6 Denetim erisimi: listeleme (kisi basina sayfa + sekmeler), verme (diger kurallar korunur), geri alma
//   VR7 Crypto Hub erisimi: e-posta ilkesi, uygulama -> oge eslemesi
//   VR8 Nginx Hub erisimi
'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const motor = require('../visibility.cjs');
const depo = require('../elements.cjs');
const ldap = require('../ldap.cjs');
const kullanicilar = require('../users.cjs');
// Denetim ara katmani testte etkisiz: gercegi DB'siz ortamda kaydi logs/ altina spool'luyordu.
const denetim = require('../../audit/index.cjs');
const asilDenetim = denetim.auditMutations;

const ADLAR = {
  motor: [
    'readVisibility',
    'writeVisibility',
    'bumpVersion',
    'getVersion',
    'resolveVisibilitySoft',
    'explainVisibility',
  ],
  depo: [
    'listElements',
    'listRules',
    'upsertElement',
    'deleteElement',
    'setElementRules',
    'propagateToStrictDescendants',
    'setElementEnabled',
    'setElementStrict',
  ],
  ldap: ['searchLdapUsers', 'searchLdapGroups', 'findLdapUserByUsername'],
  kullanicilar: ['getUserIdentity'],
};
const MODUL = { motor, depo, ldap, kullanicilar };
const asil = Object.fromEntries(
  Object.entries(ADLAR).map(([m, adlar]) => [
    m,
    Object.fromEntries(adlar.map((a) => [a, MODUL[m][a]])),
  ]),
);

let s; // sahte durum
beforeEach(() => {
  s = {
    surum: 7,
    kurallar: [],
    ogeler: [],
    yazilan: [],
    cagri: [],
    yaz: { ok: true, failed: [] },
    yazHatasi: null,
    ldapKullanici: null,
    ldapHatasi: null,
    kimlik: null,
    aciklama: { element: 'x', gorunur: true, neden: 'kural' },
    katiVar: true,
  };
});

let server;
let base;
let oturum = null;

before(async () => {
  motor.readVisibility = async () => ({ Dashboard: ['Admin', 'User'] });
  motor.writeVisibility = async (v) => {
    s.cagri.push(['writeVisibility', v]);
    if (s.yazHatasi) throw s.yazHatasi;
    return s.yaz;
  };
  motor.bumpVersion = () => {
    s.surum += 1;
  };
  motor.getVersion = () => s.surum;
  motor.resolveVisibilitySoft = async (u) => ({
    version: s.surum,
    visibility: u.role === 'Admin' ? { Dashboard: true } : {},
  });
  motor.explainVisibility = async (hedef, key) => {
    s.cagri.push(['explain', hedef, key]);
    if (key === 'patla') throw new Error('motor hatasi');
    return s.aciklama;
  };
  depo.listElements = async () => s.ogeler;
  depo.listRules = async () => {
    if (s.kuralHatasi) throw new Error('kural deposu yok');
    return s.kurallar;
  };
  depo.upsertElement = async (el) => {
    s.cagri.push(['upsert', el]);
    if (!el.label) throw Object.assign(new Error('label zorunlu'), { status: 400 });
  };
  depo.deleteElement = async (k) => (s.cagri.push(['delete', k]), 3);
  depo.setElementRules = async (k, r) => {
    s.yazilan.push([k, r]);
  };
  depo.propagateToStrictDescendants = async (k) => [`${k}:alt`];
  depo.setElementEnabled = async (k, e) => s.cagri.push(['enabled', k, e]);
  depo.setElementStrict = async (k, v) => (s.cagri.push(['strict', k, v]), s.katiVar);
  ldap.searchLdapUsers = async (q, l) => {
    s.cagri.push(['ldapUsers', q, l]);
    if (q === 'patla') throw new Error('dizin kapali');
    return [{ username: 'ali' }];
  };
  ldap.searchLdapGroups = async (q, l) => {
    s.cagri.push(['ldapGroups', q, l]);
    if (q === 'patla') throw new Error('dizin kapali');
    return [{ dn: 'CN=G' }];
  };
  ldap.findLdapUserByUsername = async () => {
    if (s.ldapHatasi) throw s.ldapHatasi;
    return s.ldapKullanici;
  };
  kullanicilar.getUserIdentity = async () => s.kimlik;

  const app = express();
  app.use((req, _res, next) => {
    if (oturum) req.session = { user: oturum };
    next();
  });
  const requireAuth = (req, res, next) =>
    req.session?.user ? next() : res.status(401).json({ ok: false, error: 'oturum yok' });
  const requireAdmin = (req, res, next) =>
    req.session?.user?.role === 'Admin'
      ? next()
      : res.status(403).json({ ok: false, error: 'Admin' });
  denetim.auditMutations = () => (_req, _res, next) => next();
  const k = console.log;
  console.log = () => {};
  require('../visibility-routes.cjs').initVisibilityRoutes(app, { requireAuth, requireAdmin });
  console.log = k;
  await new Promise((r) => {
    server = app.listen(0, '127.0.0.1', r);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  for (const [m, adlar] of Object.entries(asil)) Object.assign(MODUL[m], adlar);
  denetim.auditMutations = asilDenetim;
  server && server.close();
});

const ADMIN = { username: 'yonetici', role: 'Admin', mail: 'y@ornek.invalid', groups: [] };
const USER = { username: 'ali', role: 'User', mail: 'a@ornek.invalid', groups: ['CN=Ekip'] };

function istek(yontem, yol, { kim = ADMIN, govde, basliklar = {} } = /** @type {any} */ ({})) {
  oturum = kim;
  return new Promise((resolve, reject) => {
    const r = http.request(
      `${base}/api/visibility${yol}`,
      { method: yontem, headers: { 'content-type': 'application/json', ...basliklar } },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: b ? JSON.parse(b) : null }),
        );
      },
    );
    r.on('error', reject);
    if (govde !== undefined) r.write(JSON.stringify(govde));
    r.end();
  });
}

test('VR1 erişim: okuma uçları oturum ister, yazma uçları Admin', async () => {
  for (const yol of ['/pages', '/resolved', '/version', '/nav-groups', '/explain?element=x']) {
    assert.equal((await istek('GET', yol, { kim: null })).status, 401, yol);
  }
  for (const [y, yol] of [
    ['PUT', '/pages'],
    ['GET', '/elements'],
    ['GET', '/ldap-users?q=abc'],
    ['POST', '/elements'],
    ['PUT', '/elements/x/rules'],
    ['DELETE', '/elements/x'],
    ['GET', '/denetim-access'],
    ['PUT', '/crypto-access'],
    ['DELETE', '/nginx-access?principalId=a'],
  ]) {
    const govde = y === 'PUT' || y === 'POST' ? {} : undefined; // GET / DELETE govdesiz
    assert.equal((await istek(y, yol, { kim: USER, govde })).status, 403, `${y} ${yol}`);
  }
  assert.deepEqual(s.yazilan, []);
  const r = await istek('GET', '/resolved', { kim: USER });
  assert.deepEqual(r.body, { ok: true, version: 7, visibility: {}, ok_engine: false });
  assert.equal((await istek('GET', '/resolved')).body.ok_engine, true);
  assert.deepEqual((await istek('GET', '/pages', { kim: USER })).body, {
    ok: true,
    visibility: { Dashboard: ['Admin', 'User'] },
  });
});

test('VR2 sayfa haritası: doğrulama, kısmi kayıt 207, motor hatası 500, sürüm; ETag / 304', async () => {
  let r = await istek('PUT', '/pages', { govde: {} });
  assert.equal(r.status, 400);
  r = await istek('PUT', '/pages', { govde: { visibility: 'Dashboard' } });
  assert.equal(r.status, 400);
  const v = { Dashboard: ['Admin'] };
  r = await istek('PUT', '/pages', { govde: { visibility: v } });
  assert.deepEqual(r.body, { ok: true, visibility: v });
  assert.equal(s.surum, 8);
  s.yaz = { ok: false, failed: ['Ansible', 'LogX'] };
  r = await istek('PUT', '/pages', { govde: { visibility: v } });
  assert.equal(r.status, 207);
  assert.deepEqual(r.body, {
    ok: false,
    error: 'Bazı sayfalar kaydedilemedi: Ansible, LogX',
    failed: ['Ansible', 'LogX'],
  });
  assert.equal(s.surum, 8); // kismi kayitta surum artmaz
  s.yazHatasi = new Error('DB yok');
  r = await istek('PUT', '/pages', { govde: { visibility: v } });
  assert.equal(r.status, 500);
  assert.equal(r.body.error, 'Görünürlük kaydedilemedi: DB yok');
  // surum: ETag, ayni ETag 304
  r = await istek('GET', '/version', { kim: USER });
  assert.equal(r.status, 200);
  assert.equal(r.headers.etag, 'W/"vis-v8"');
  assert.equal(r.headers['cache-control'], 'private, no-cache');
  assert.deepEqual(r.body, { ok: true, version: 8 });
  r = await istek('GET', '/version', { kim: USER, basliklar: { 'if-none-match': 'W/"vis-v8"' } });
  assert.equal(r.status, 304);
  r = await istek('GET', '/version', { kim: USER, basliklar: { 'if-none-match': 'W/"vis-v7"' } });
  assert.equal(r.status, 200);
});

test('VR3 menü grupları, öğe listesi, LDAP arama', async () => {
  s.ogeler = [
    { key: 'g2', type: 'nav_group', enabled: true, label: 'Iki', sortOrder: 2 },
    { key: 'g1', type: 'nav_group', enabled: true, label: 'Bir', sortOrder: 1 },
    { key: 'g0', type: 'nav_group', enabled: false, label: 'Kapali', sortOrder: 0 },
    { key: 'p2', type: 'page', parentKey: 'g1', sortOrder: 2 },
    { key: 'p1', type: 'page', parentKey: 'g1', sortOrder: 1 },
    { key: 'p3', type: 'page', parentKey: 'g0', sortOrder: 1 },
    { key: 't1', type: 'tab', parentKey: 'g1', sortOrder: 0 },
  ];
  let r = await istek('GET', '/nav-groups', { kim: USER });
  assert.deepEqual(r.body.groups, [
    { key: 'g1', label: 'Bir', sortOrder: 1, pageKeys: ['p1', 'p2'] },
    { key: 'g2', label: 'Iki', sortOrder: 2, pageKeys: [] },
  ]);
  const eski = depo.listElements;
  depo.listElements = async () => {
    throw new Error('oge deposu yok');
  };
  r = await istek('GET', '/nav-groups', { kim: USER });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'oge deposu yok');
  depo.listElements = eski;
  s.kurallar = [{ elementKey: 'p1', principalType: 'role', principalId: 'User', allow: true }];
  r = await istek('GET', '/elements');
  assert.deepEqual(r.body, { ok: true, elements: s.ogeler, rules: s.kurallar, version: 7 });
  // LDAP arama: en az 3 karakter, varsayilan / verilen tavan, dizin hatasi 502
  r = await istek('GET', '/ldap-users?q=%20ab%20');
  assert.deepEqual(r.body, { ok: true, users: [], message: 'En az 3 karakter yazın.' });
  r = await istek('GET', '/ldap-users?q=ali');
  assert.deepEqual(r.body, { ok: true, users: [{ username: 'ali' }] });
  r = await istek('GET', '/ldap-groups?q=gt-&limit=5');
  assert.deepEqual(r.body, { ok: true, groups: [{ dn: 'CN=G' }] });
  r = await istek('GET', '/ldap-groups?q=ab');
  assert.deepEqual(r.body, { ok: true, groups: [], message: 'En az 3 karakter yazın.' });
  assert.deepEqual(
    s.cagri.filter((c) => c[0].startsWith('ldap')),
    [
      ['ldapUsers', 'ali', 25],
      ['ldapGroups', 'gt-', 5],
    ],
  );
  r = await istek('GET', '/ldap-users?q=patla');
  assert.equal(r.status, 502);
  assert.equal(r.body.error, 'dizin kapali');
  r = await istek('GET', '/ldap-groups?q=patla');
  assert.equal(r.status, 502);
});

test('VR4 öğe / kural / katı / etkin / silme uçları', async () => {
  let r = await istek('POST', '/elements', { govde: { key: 'yeni', label: 'Yeni' } });
  assert.deepEqual(r.body, { ok: true });
  assert.equal(s.surum, 8);
  r = await istek('POST', '/elements', { govde: { key: 'yeni' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'label zorunlu');
  // PUT: yoldaki anahtar govdedekini ezer
  r = await istek('PUT', '/elements/asil', { govde: { key: 'baska', label: 'L' } });
  assert.deepEqual(s.cagri.at(-1), ['upsert', { key: 'asil', label: 'L' }]);
  r = await istek('PUT', '/elements/asil', { govde: {} });
  assert.equal(r.status, 400);
  // etkin: varsayilan acik, yalniz false kapatir
  await istek('PUT', '/elements/x/enabled', { govde: {} });
  await istek('PUT', '/elements/x/enabled', { govde: { enabled: false } });
  await istek('PUT', '/elements/x/enabled', { govde: { enabled: 'false' } });
  assert.deepEqual(
    s.cagri.filter((c) => c[0] === 'enabled').map((c) => c[2]),
    [true, false, true],
  );
  // kati: yalniz true acar; oge yoksa 404 ve surum artmaz
  await istek('PUT', '/elements/x/strict', { govde: { strict: 'true' } });
  assert.deepEqual(s.cagri.at(-1), ['strict', 'x', false]);
  const surum = s.surum;
  s.katiVar = false;
  r = await istek('PUT', '/elements/yok/strict', { govde: { strict: true } });
  assert.equal(r.status, 404);
  assert.equal(s.surum, surum);
  // kurallar: kati alt ogelere yayilim doner
  const kural = [{ principalType: 'user', principalId: 'ali', allow: true }];
  r = await istek('PUT', '/elements/Ust/rules', { govde: { rules: kural } });
  assert.deepEqual(r.body, { ok: true, strictChildren: ['Ust:alt'] });
  assert.deepEqual(s.yazilan.at(-1), ['Ust', kural]);
  await istek('PUT', '/elements/Ust/rules', { govde: {} });
  assert.deepEqual(s.yazilan.at(-1), ['Ust', []]);
  r = await istek('DELETE', '/elements/eski');
  assert.deepEqual(r.body, { ok: true, removed: 3 });
});

test('VR5 /explain: kendi görünürlüğü; Admin başkasını simüle eder', async () => {
  let r = await istek('GET', '/explain', { kim: USER });
  assert.equal(r.status, 400);
  r = await istek('GET', '/explain?element=LogX', { kim: USER });
  assert.deepEqual(r.body, {
    ok: true,
    simulasyon: false,
    kimlikKaynagi: null,
    kimlikUyarisi: null,
    gruplar: 1,
    ...s.aciklama,
  });
  assert.deepEqual(s.cagri.at(-1), ['explain', USER, 'LogX']);
  // Admin olmayan baskasini sorgulayamaz
  r = await istek('GET', '/explain?element=LogX&username=veli', { kim: USER });
  assert.equal(r.status, 403);
  // e-postayla simulasyon
  r = await istek('GET', '/explain?element=LogX&email=v@ornek.invalid');
  assert.equal(r.body.simulasyon, true);
  assert.deepEqual(s.cagri.at(-1)[1], {
    username: '',
    mail: 'v@ornek.invalid',
    role: 'User',
    groups: [],
  });
  // kullanici adiyla: yerel kimlikten posta, LDAP'tan ad / gruplar
  s.kimlik = { mail: 'yerel@ornek.invalid' };
  s.ldapKullanici = { username: 'veli', mail: 'ldap@ornek.invalid', groups: ['CN=A', 'CN=B'] };
  r = await istek('GET', '/explain?element=LogX&username=Veli');
  assert.equal(r.body.kimlikKaynagi, 'ldap');
  assert.equal(r.body.kimlikUyarisi, null);
  assert.equal(r.body.gruplar, 2);
  assert.deepEqual(s.cagri.at(-1)[1], {
    username: 'veli',
    mail: 'yerel@ornek.invalid',
    role: 'User',
    groups: ['CN=A', 'CN=B'],
    kimlikKaynagi: 'ldap',
  });
  // yerel posta yoksa LDAP postasi; LDAP gruplari dizi degilse bos
  s.kimlik = null;
  s.ldapKullanici = { username: '', mail: 'ldap@ornek.invalid', groups: 'CN=A' };
  r = await istek('GET', '/explain?element=LogX&username=veli');
  assert.deepEqual(s.cagri.at(-1)[1], {
    username: 'veli',
    mail: 'ldap@ornek.invalid',
    role: 'User',
    groups: [],
    kimlikKaynagi: 'ldap',
  });
  // LDAP'ta yok: uyari; LDAP okunamadi: uyari ve sebep
  s.ldapKullanici = null;
  r = await istek('GET', '/explain?element=LogX&username=hayalet');
  assert.match(r.body.kimlikUyarisi, /LDAP’ta bulunamadi — gruplar BOS varsayildi/);
  assert.equal(r.body.gruplar, 0);
  s.ldapHatasi = new Error('zaman asimi');
  r = await istek('GET', '/explain?element=LogX&username=veli');
  assert.match(r.body.kimlikUyarisi, /^LDAP kimligi okunamadi \(zaman asimi\)/);
  // motor hatasi 500
  r = await istek('GET', '/explain?element=patla', { kim: USER });
  assert.equal(r.status, 500);
  assert.equal(r.body.error, 'motor hatasi');
});

const kural = (elementKey, principalType, principalId, allow = true) => ({
  elementKey,
  principalType,
  principalId,
  allow,
});

test('VR6 Denetim erişimi: listeleme, verme (diğer kurallar korunur), geri alma', async () => {
  s.kurallar = [
    kural('Denetim', 'role', 'Admin'),
    kural('Denetim', 'user', 'ali'),
    kural('tab:denetim:ocp', 'user', 'ali'),
    kural('tab:denetim:init', 'user', 'ali', false),
    kural('tab:denetim:deploy', 'group', 'cn=mw'),
    kural('Denetim', 'user', 'baska'),
    kural('LogX', 'user', 'ali'),
    kural('tab:denetim:katalog', 'user', 'ALI'), // eski (buyuk harfli) kayit
    kural('tab:denetim:webapp', 'group', 'ali'), // ayni ad, BASKA tur
  ];
  let r = await istek('GET', '/denetim-access');
  assert.equal(r.body.tabs.length, 10);
  assert.deepEqual(r.body.grants, [
    { principalType: 'group', principalId: 'ali', page: false, tabs: ['webapp'] },
    { principalType: 'group', principalId: 'cn=mw', page: false, tabs: ['deploy'] },
    { principalType: 'user', principalId: 'ALI', page: false, tabs: ['katalog'] },
    { principalType: 'user', principalId: 'ali', page: true, tabs: ['ocp'] },
    { principalType: 'user', principalId: 'baska', page: true, tabs: [] },
  ]);
  // verme: dogrulama
  for (const govde of [
    {},
    { principalType: 'email', principalId: 'a@b', tabs: 'all' },
    { principalType: 'user', principalId: ' ', tabs: 'all' },
  ]) {
    assert.equal((await istek('PUT', '/denetim-access', { govde })).status, 400);
  }
  r = await istek('PUT', '/denetim-access', {
    govde: { principalType: 'user', principalId: 'ali', tabs: ['yok'] },
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'En az bir sekme secilmeli.');
  assert.deepEqual(s.yazilan, []);
  // verme: kisi kucuk harfe iner, eski kurallari degisir, digerlerinin kurallari korunur
  r = await istek('PUT', '/denetim-access', {
    govde: { principalType: 'user', principalId: ' ALI ', tabs: ['init', 'yok'] },
  });
  assert.deepEqual(r.body, { ok: true });
  const yaz = Object.fromEntries(s.yazilan);
  assert.equal(s.yazilan.length, 11);
  assert.deepEqual(yaz.Denetim, [
    kural('Denetim', 'role', 'Admin'),
    kural('Denetim', 'user', 'baska'),
    { principalType: 'user', principalId: 'ali', allow: true },
  ]);
  assert.deepEqual(yaz['tab:denetim:init'], [
    { principalType: 'user', principalId: 'ali', allow: true },
  ]);
  assert.deepEqual(yaz['tab:denetim:ocp'], []);
  assert.deepEqual(yaz['tab:denetim:deploy'], [kural('tab:denetim:deploy', 'group', 'cn=mw')]);
  assert.deepEqual(yaz['tab:denetim:katalog'], []); // buyuk harfli eski kayit da ayni kisi
  assert.deepEqual(yaz['tab:denetim:webapp'], [kural('tab:denetim:webapp', 'group', 'ali')]); // grup korunur
  assert.equal(s.surum, 8);
  s.yazilan = [];
  await istek('PUT', '/denetim-access', {
    govde: { principalType: 'group', principalId: 'CN=MW', tabs: 'all' },
  });
  assert.ok(
    s.yazilan
      .filter(([k]) => k.startsWith('tab:denetim:'))
      .every(([, r]) => r.some((x) => x.principalType === 'group' && x.principalId === 'cn=mw')),
  );
  // geri alma: zorunlu kimlik; tum Denetim ogelerinden temizlenir, grup / kullanici ayrimi
  assert.equal((await istek('DELETE', '/denetim-access')).status, 400);
  s.yazilan = [];
  r = await istek('DELETE', '/denetim-access?principalId=ALI');
  assert.deepEqual(r.body, { ok: true });
  assert.deepEqual(Object.fromEntries(s.yazilan).Denetim, [
    kural('Denetim', 'role', 'Admin'),
    kural('Denetim', 'user', 'baska'),
  ]);
  s.yazilan = [];
  await istek('DELETE', '/denetim-access?principalType=group&principalId=cn=mw');
  assert.deepEqual(Object.fromEntries(s.yazilan)['tab:denetim:deploy'], []);
  // depo hatasi: 500
  s.kuralHatasi = true;
  for (const [y, yol, govde] of [
    ['GET', '/denetim-access'],
    ['PUT', '/denetim-access', { principalType: 'user', principalId: 'a', tabs: 'all' }],
    ['DELETE', '/denetim-access?principalId=a'],
  ]) {
    const x = await istek(y, yol, { govde });
    assert.equal(x.status, 500, `${y} ${yol}`);
    assert.equal(x.body.error, 'kural deposu yok');
  }
});

test('VR7 Crypto Hub erişimi: e-posta ilkesi, uygulama -> öğe eşlemesi', async () => {
  s.kurallar = [
    kural('CryptoHub', 'email', 'a@ornek.invalid'),
    kural('cryptohub:app:metaco', 'email', 'a@ornek.invalid'),
    kural('cryptohub:node:degistir', 'email', 'a@ornek.invalid'),
    kural('cryptohub:app:wyden', 'email', 'a@ornek.invalid', false),
    kural('cryptohub:bilinmeyen', 'email', 'a@ornek.invalid'),
    kural('CryptoHub', 'role', 'Admin'),
  ];
  let r = await istek('GET', '/crypto-access');
  assert.deepEqual(r.body.tabs, ['metaco', 'wyden', 'node']);
  assert.deepEqual(r.body.grants, [
    {
      principalType: 'email',
      principalId: 'a@ornek.invalid',
      page: true,
      tabs: ['metaco', 'node'],
    },
  ]);
  assert.equal(
    (
      await istek('PUT', '/crypto-access', {
        govde: { principalType: 'role', principalId: 'x', tabs: 'all' },
      })
    ).status,
    400,
  );
  r = await istek('PUT', '/crypto-access', {
    govde: { principalType: 'email', principalId: 'a@ornek.invalid', tabs: [] },
  });
  assert.equal(r.body.error, 'En az bir uygulama secilmeli.');
  r = await istek('PUT', '/crypto-access', {
    govde: { principalType: 'email', principalId: 'A@Ornek.Invalid', tabs: ['wyden'] },
  });
  assert.deepEqual(r.body, { ok: true });
  const yaz = Object.fromEntries(s.yazilan);
  assert.deepEqual(Object.keys(yaz), [
    'CryptoHub',
    'cryptohub:app:metaco',
    'cryptohub:app:wyden',
    'cryptohub:node:degistir',
  ]);
  const ben = { principalType: 'email', principalId: 'a@ornek.invalid', allow: true };
  assert.deepEqual(yaz.CryptoHub, [kural('CryptoHub', 'role', 'Admin'), ben]);
  assert.deepEqual(yaz['cryptohub:app:wyden'], [ben]);
  assert.deepEqual(yaz['cryptohub:app:metaco'], []);
  assert.deepEqual(yaz['cryptohub:node:degistir'], []);
  s.yazilan = [];
  await istek('PUT', '/crypto-access', {
    govde: { principalType: 'user', principalId: 'veli', tabs: 'all' },
  });
  assert.equal(Object.fromEntries(s.yazilan)['cryptohub:node:degistir'].at(-1).principalId, 'veli');
  // geri alma: gecersiz tur kullaniciya duser
  assert.equal((await istek('DELETE', '/crypto-access')).status, 400);
  s.yazilan = [];
  await istek('DELETE', '/crypto-access?principalType=email&principalId=A@ORNEK.INVALID');
  assert.deepEqual(Object.fromEntries(s.yazilan).CryptoHub, [kural('CryptoHub', 'role', 'Admin')]);
  s.yazilan = [];
  await istek('DELETE', '/crypto-access?principalType=rol&principalId=a@ornek.invalid');
  assert.equal(Object.fromEntries(s.yazilan).CryptoHub.length, 2); // email kurali korunur (tur user'a dustu)
  s.kuralHatasi = true;
  assert.equal((await istek('GET', '/crypto-access')).status, 500);
  assert.equal(
    (
      await istek('PUT', '/crypto-access', {
        govde: { principalType: 'user', principalId: 'a', tabs: 'all' },
      })
    ).status,
    500,
  );
  assert.equal((await istek('DELETE', '/crypto-access?principalId=a')).status, 500);
});

test('VR8 Nginx Hub erişimi', async () => {
  s.kurallar = [
    kural('NginxConsole', 'user', 'ali'),
    kural('tab:nginx:spa', 'user', 'ali'),
    kural('tab:nginx:cis', 'user', 'ali', false),
    kural('NginxConsole', 'user', 'veli', false),
  ];
  let r = await istek('GET', '/nginx-access');
  assert.equal(r.body.tabs.length, 16);
  assert.deepEqual(r.body.grants, [
    { principalType: 'user', principalId: 'ali', page: true, tabs: ['spa'] },
    { principalType: 'user', principalId: 'veli', page: false, tabs: [] },
  ]);
  assert.equal(
    (
      await istek('PUT', '/nginx-access', {
        govde: { principalType: 'email', principalId: 'a', tabs: 'all' },
      })
    ).status,
    400,
  );
  r = await istek('PUT', '/nginx-access', {
    govde: { principalType: 'user', principalId: 'ali', tabs: ['x'] },
  });
  assert.equal(r.status, 400);
  r = await istek('PUT', '/nginx-access', {
    govde: { principalType: 'group', principalId: 'CN=Web', tabs: ['audit', 'spa'] },
  });
  assert.deepEqual(r.body, { ok: true });
  const yaz = Object.fromEntries(s.yazilan);
  assert.equal(s.yazilan.length, 17);
  const g = { principalType: 'group', principalId: 'cn=web', allow: true };
  assert.deepEqual(yaz.NginxConsole, [
    kural('NginxConsole', 'user', 'ali'),
    kural('NginxConsole', 'user', 'veli', false),
    g,
  ]);
  assert.deepEqual(yaz['tab:nginx:audit'], [g]);
  assert.deepEqual(yaz['tab:nginx:spa'], [kural('tab:nginx:spa', 'user', 'ali'), g]);
  assert.deepEqual(yaz['tab:nginx:cis'], [kural('tab:nginx:cis', 'user', 'ali', false)]);
  s.yazilan = [];
  r = await istek('DELETE', '/nginx-access?principalId=Ali');
  assert.deepEqual(Object.fromEntries(s.yazilan).NginxConsole, [
    kural('NginxConsole', 'user', 'veli', false),
  ]);
  assert.equal((await istek('DELETE', '/nginx-access')).status, 400);
  s.kuralHatasi = true;
  assert.equal((await istek('GET', '/nginx-access')).status, 500);
  assert.equal(
    (
      await istek('PUT', '/nginx-access', {
        govde: { principalType: 'user', principalId: 'a', tabs: 'all' },
      })
    ).status,
    500,
  );
  assert.equal((await istek('DELETE', '/nginx-access?principalId=a')).status, 500);
});
