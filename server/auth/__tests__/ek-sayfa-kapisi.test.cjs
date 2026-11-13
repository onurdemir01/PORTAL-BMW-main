// server/auth/__tests__/ek-sayfa-kapisi.test.cjs - EK1..EK6 (2026-11-13).
//
// Reboot Kontrolu ve Retirement BMW Hub menusunde AYRI sayfa oldu (RebootKontrolu, Retirement). Uclarin eski kapisi
// (ServerHub gorunurlugu) kalir, yeni sayfa anahtari EK olarak gecer: kimse erisimini kaybetmez, Server Hub'in
// diger uclari yeni anahtarla acilmaz.
//   EK1 eslesmeyen istek: yeni anahtar gorunur olsa da karar eski kapinin
//   EK2 eslesen istek + yeni anahtar gorunur: eski kapi reddetse de gecer
//   EK3 eslesen istek + yeni anahtar gorunmez: eski kapi karar verir (eski izin calismaya devam eder)
//   EK4 motor hatasi / oturum yok / canSee yok: eski kapi (401 / fail-closed) karar verir
//   EK5 Server Hub'da yalniz Reboot Kontrolu sayfasinin kullandigi uclar eslesir
//   EK6 gercek Server Hub router'i: yalniz RebootKontrolu goren reboot ucuna ulasir, /overview'a ulasamaz
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const { ekSayfaKapisi } = require('../ek-sayfa-kapisi.cjs');

function kos(mw, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ ne: 'yanit', kod: this.statusCode, body: b }); return this; },
    };
    Promise.resolve(mw(req, res, () => resolve({ ne: 'gecti' }))).catch((e) => resolve({ ne: 'hata', e }));
  });
}

const reddeden = (req, res) => res.status(403).json({ ok: false, eski: true });
const gecen = (req, res, next) => next();
const oturum = (user = { username: 'u', role: 'User' }) => ({ path: '/x', method: 'GET', session: { user } });

test('EK1 eslesmeyen istek eski kapiya gider', async () => {
  const mw = ekSayfaKapisi({ anahtar: 'Yeni', ana: reddeden, canSee: async () => true, eslesir: () => false });
  assert.deepEqual(await kos(mw, oturum()), { ne: 'yanit', kod: 403, body: { ok: false, eski: true } });
});

test('EK2 eslesen istek + yeni anahtar gorunur: gecer', async () => {
  const sorulan = [];
  const mw = ekSayfaKapisi({ anahtar: 'Yeni', ana: reddeden, canSee: async (u, k) => (sorulan.push(k), k === 'Yeni') });
  assert.deepEqual(await kos(mw, oturum()), { ne: 'gecti' });
  assert.deepEqual(sorulan, ['Yeni']);
});

test('EK3 yeni anahtar gorunmez: eski kapi karar verir', async () => {
  const gizli = async () => false;
  assert.equal((await kos(ekSayfaKapisi({ anahtar: 'Yeni', ana: reddeden, canSee: gizli }), oturum())).kod, 403);
  assert.deepEqual(await kos(ekSayfaKapisi({ anahtar: 'Yeni', ana: gecen, canSee: gizli }), oturum()), { ne: 'gecti' });
  // canSee yalniz true ile gecirir (truthy deger degil).
  assert.equal((await kos(ekSayfaKapisi({ anahtar: 'Yeni', ana: reddeden, canSee: async () => 1 }), oturum())).kod, 403);
});

test('EK4 motor hatasi / oturum yok / canSee yok: eski kapi', async () => {
  const patlar = async () => { throw new Error('db yok'); };
  assert.equal((await kos(ekSayfaKapisi({ anahtar: 'Yeni', ana: reddeden, canSee: patlar }), oturum())).kod, 403);
  let sorgu = 0;
  const say = async () => (sorgu++, true);
  assert.equal((await kos(ekSayfaKapisi({ anahtar: 'Yeni', ana: reddeden, canSee: say }), { path: '/x', method: 'GET', headers: {} })).kod, 403);
  assert.equal(sorgu, 0, 'oturumsuz istek icin gorunurluk sorulmamali');
  assert.equal((await kos(ekSayfaKapisi({ anahtar: 'Yeni', ana: reddeden, canSee: undefined }), oturum())).kod, 403);
  assert.throws(() => ekSayfaKapisi({ anahtar: 'Yeni', ana: null }), /ana kapi/);
  assert.throws(() => ekSayfaKapisi({ anahtar: '', ana: gecen }), /anahtar/);
});

test('EK5 Server Hub: yalniz Reboot Kontrolu uclari eslesir', () => {
  const { rebootKontroluUcu } = require('../../server-hub/index.cjs');
  const evet = [
    ['GET', '/reboot-check'], ['POST', '/reboot-check'], ['GET', '/reboot-check/12'], ['GET', '/reboot-check/12/rapor'],
    ['POST', '/reboot-check/12/sonra'], ['GET', '/host-adlari'], ['GET', '/limitler'], ['GET', '/job-status/1/77'],
  ];
  const hayir = [
    ['GET', '/overview'], ['POST', '/fix'], ['POST', '/scan'], ['GET', '/reboot-checkx'], ['PUT', '/limitler'],
    ['POST', '/host-adlari'], ['GET', '/job-status/1'], ['GET', '/job-status/1/2/3'], ['GET', '/kurallar'], ['POST', '/reboot-readiness'],
  ];
  for (const [method, p] of evet) assert.equal(rebootKontroluUcu({ method, path: p }), true, `${method} ${p}`);
  for (const [method, p] of hayir) assert.equal(rebootKontroluUcu({ method, path: p }), false, `${method} ${p}`);
});

test('EK6 Server Hub router: RebootKontrolu reboot ucunu acar, diger uclari acmaz', async () => {
  const yol = Module._resolveFilename(path.join(__dirname, '..', 'visibility.cjs'), module);
  const eski = require.cache[yol];
  const gorunen = new Set(['RebootKontrolu']);
  require.cache[yol] = {
    id: yol, filename: yol, loaded: true,
    exports: {
      requireVisiblePrefix: (k) => (req, res, next) => (gorunen.has(k) ? next() : res.status(403).json({ ok: false, kapi: k })),
      canSee: async (_u, k) => gorunen.has(k),
    },
  };
  const shYol = require.resolve('../../server-hub/index.cjs');
  delete require.cache[shYol];
  try {
    const { initServerHub } = require('../../server-hub/index.cjs');
    let router = null;
    initServerHub({ use: (p, r) => { if (p === '/api/server-hub') router = r; } });
    assert.ok(router, 'router baglanmadi');
    const istek = (method, url) => new Promise((resolve) => {
      const res = {
        statusCode: 200, headers: {},
        status(c) { this.statusCode = c; return this; },
        json(b) { resolve({ kod: this.statusCode, body: b }); return this; },
        setHeader() {}, getHeader() {}, set() { return this; },
      };
      router.handle({ method, url, headers: {}, session: { user: { username: 'a', role: 'Admin' } }, query: {} }, res, () => resolve({ kod: 'sonraki' }));
    });
    const kapali = await istek('GET', '/overview');
    assert.deepEqual([kapali.kod, kapali.body.kapi], [403, 'ServerHub'], 'ServerHub gormeyen /overview a ulasti');
    const job = await istek('GET', '/job-status/abc/def');
    assert.notEqual(job.body && job.body.kapi, 'ServerHub', 'reboot sayfasinin kullandigi uc kapida kaldi');
    gorunen.clear();
    const hic = await istek('GET', '/job-status/abc/def');
    assert.deepEqual([hic.kod, hic.body.kapi], [403, 'ServerHub'], 'iki anahtar da yokken uc acildi');
  } finally {
    delete require.cache[shYol];
    if (eski) require.cache[yol] = eski; else delete require.cache[yol];
  }
});
