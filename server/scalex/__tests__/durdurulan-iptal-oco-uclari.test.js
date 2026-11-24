// server/scalex/__tests__/durdurulan-iptal-oco-uclari.test.js - ScaleX durdurulanlar listesi, is iptali ve OCO
// zamanlamasi guncelleme uclari gercek express ile (2026-11-24, kapsam PR-2). Sahte: Portal DB, AWX runner, ayna /
// katalog / OCO yazicilari.
//   DO1 /stopped: kapsamli ayna, kapsamsiz (genel) okuma denetime yazilir; gorunurluk ve sahiplik suzgeci sayilari
//   DO2 /cancel: sahiplik; ScaleX islemi olmayan is 404; AWX iptali + islem satiri CANCELLED + denetim
//   DO3 /oco-schedules/:id/update: yok 404, ScaleX disi 404, yetkisiz 403 + denetim; yeni OCO numarasi (servis hatasi,
//       pencere yok, kapanmis pencere, gecerli pencere); yalniz beklemedeki kayit guncellenir (409)
'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

const KOK = path.join(__dirname, '..', '..');
function sahte(rel, exports) {
  const p = require.resolve(path.join(KOK, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
const DB = { sahip: 'ornekkisi', islem: true, yazim: [] };
sahte('db/index.cjs', {
  query: async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT TOP 1 username FROM ansible_job_history'))
      return { rows: DB.sahip ? [{ username: DB.sahip }] : [] };
    if (s.startsWith('SELECT TOP 1 id FROM scalex_operations'))
      return { rows: DB.islem ? [{ id: 4 }] : [] };
    if (s.startsWith('UPDATE scalex_operations')) {
      DB.yazim.push({ s, params });
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  },
});
const denetim = [];
sahte('audit/index.cjs', {
  auditPortal: (req, olay, ek) =>
    denetim.push({ olay, detay: ek?.detail ? JSON.parse(ek.detail) : null }),
});
sahte('auth/index.cjs', { requireAuth: (req, res, next) => next() });
sahte('auth/visibility.cjs', { requireVisiblePrefix: () => (req, res, next) => next() });
sahte('scalex/reconciler.cjs', { startReconciler() {} });
const AWX = { iptal: [] };
sahte('ansible/runner.cjs', {
  getJobStatusOnServer: async () => ({ status: 'running' }),
  cancelJobOnServer: async (...a) => {
    AWX.iptal.push(a);
    return { canceled: true, alreadyTerminal: false };
  },
  getServers: () => [],
  getServerById: () => null,
});

const state = require('../state.cjs');
const katalog = require('../catalog.cjs');
const ocoStore = require('../../oco/store.cjs');
const ocoClient = require('../../oco/client.cjs');

let srv;
let base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      user: {
        username: req.headers['x-kim'] || 'ornekkisi',
        role: req.headers['x-rol'] || 'User',
        groups: [],
      },
    };
    next();
  });
  const log = console.log;
  console.log = () => {};
  require('../index.cjs').initScaleX(app);
  console.log = log;
  await new Promise((r) => {
    srv = app.listen(0, '127.0.0.1', r);
  });
  base = `http://127.0.0.1:${srv.address().port}/api/scalex`;
});
after(() => srv.close());
beforeEach((t) => {
  denetim.length = 0;
  Object.assign(DB, { sahip: 'ornekkisi', islem: true, yazim: [] });
  AWX.iptal = [];
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
});
async function istek(yol, { method = 'GET', body, rol = 'User', kim } = {}) {
  const r = await fetch(base + yol, {
    method,
    headers: {
      'x-rol': rol,
      ...(kim ? { 'x-kim': kim } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
}

const ayna = (app, ek = {}) => ({
  env: 'prod',
  tenant: 'kart',
  clusterName: 'c1',
  namespace: 'kart-prod',
  appName: app,
  previousReplicas: 2,
  phase: 'stopped',
  stoppedBy: 'ornekkisi',
  ...ek,
});

test('DO1 /stopped: kapsamli ve genel okuma, suzgec sayilari', async (t) => {
  const kapsamli = t.mock.method(state, 'listMirror', async () => [
    ayna('a'),
    ayna('b'),
    ayna('c'),
  ]);
  const genel = t.mock.method(state, 'listMirrorAll', async () =>
    Object.assign([ayna('a'), ayna('b'), ayna('c')], { truncated: true }),
  );
  t.mock.method(katalog, 'filterStoppedForUser', async (rows) =>
    rows.filter((r) => r.appName !== 'c'),
  );
  t.mock.method(katalog, 'filterStoppedByOwnership', (rows) =>
    rows.filter((r) => r.appName !== 'b'),
  );
  let r = await istek('/stopped?env=prod&tenant=kart&cluster=c1');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(kapsamli.mock.calls[0].arguments[0], {
    env: 'prod',
    tenant: 'kart',
    clusterName: 'c1',
  });
  assert.deepEqual(
    r.body.items.map((x) => x.appName),
    ['a'],
  );
  assert.deepEqual([r.body.hiddenCount, r.body.hiddenByOwnership, r.body.truncated], [2, 1, false]);
  assert.equal(denetim.length, 0, 'kapsamli okuma genel okuma diye denetime yazildi');
  r = await istek('/stopped');
  assert.equal(genel.mock.callCount(), 1);
  assert.equal(r.body.truncated, true);
  assert.deepEqual(denetim.at(-1), {
    olay: 'scalex_stopped_global',
    detay: { rows: 3, truncated: true },
  });
});

test('DO2 /cancel: sahiplik, ScaleX disi is, iptal', async () => {
  DB.sahip = 'baskasi';
  let r = await istek('/cancel/2/900', { method: 'POST' });
  assert.equal(r.body.upstreamStatus, 403);
  assert.equal(AWX.iptal.length, 0);
  DB.sahip = 'ornekkisi';
  DB.islem = false;
  r = await istek('/cancel/2/900', { method: 'POST' });
  assert.equal(r.body.upstreamStatus, 404);
  assert.equal(r.body.message, 'Bu iş bir ScaleX işlemi değil.');
  assert.equal(AWX.iptal.length, 0, 'ScaleX disi is iptal edildi');
  DB.islem = true;
  r = await istek('/cancel/2/900', { method: 'POST' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(AWX.iptal[0], [2, 900]);
  assert.match(DB.yazim[0].s, /SET status = 'CANCELLED'.*AND status = 'RUNNING'/);
  assert.deepEqual(denetim.at(-1), { olay: 'scalex_cancel', detay: { serverId: 2, jobId: 900 } });
});

test('DO3 /oco-schedules/:id/update: denetimler, yeni OCO penceresi, yalniz bekleyen kayit', async (t) => {
  const kayit = (ek = {}) => ({
    id: 8,
    username: 'ornekkisi',
    ocoNumber: '22500001',
    status: 'SCHEDULED',
    ownerGroups: [],
    pendingLaunch: { templateName: 'ScaleX', extraVars: { env: 'prod' } },
    ...ek,
  });
  const al = t.mock.method(ocoStore, 'get', async () => null);
  const guncelle = t.mock.method(ocoStore, 'update', async (id, yama) => ({ ...kayit(), ...yama }));
  const yol = '/oco-schedules/8/update';
  let r = await istek(yol, { method: 'POST', body: {} });
  assert.equal(r.body.upstreamStatus, 404);
  al.mock.mockImplementation(async () =>
    kayit({ pendingLaunch: { templateName: 'Self Service' } }),
  );
  r = await istek(yol, { method: 'POST', body: {} });
  assert.equal(r.body.upstreamStatus, 404, 'ScaleX disi kayit gorundu');
  al.mock.mockImplementation(async () => kayit({ username: 'baskasi' }));
  r = await istek(yol, { method: 'POST', body: {} });
  assert.equal(r.body.upstreamStatus, 403);
  assert.equal(denetim.at(-1).olay, 'scalex_oco_schedule_forbidden');

  al.mock.mockImplementation(async () => kayit());
  t.mock.method(ocoClient, 'getChangeOrder', async () => {
    throw Object.assign(new Error('OCO servisi yanit vermedi'), { status: 503 });
  });
  t.mock.method(ocoClient, 'httpStatus', () => 424);
  r = await istek(yol, { method: 'POST', body: { ocoNumber: '22509999' } });
  assert.deepEqual([r.status, r.body.message], [424, 'OCO servisi yanit vermedi']);
  ocoClient.getChangeOrder.mock.mockImplementation(async () => ({ payload: {}, result: {} }));
  r = await istek(yol, { method: 'POST', body: { ocoNumber: '22509999' } });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /planlanan kesinti tarihi yok/);
  const tarih = (ms) => `/Date(${ms}+0300)/`;
  const pencere = (bas, son) => ({
    payload: {
      GetChangeOrderByWfInstanceIdResult: {
        Result: { PlannedStartDate: tarih(bas), PlannedEndDate: tarih(son) },
      },
    },
    result: { Subject: 'Yeni kesinti' },
  });
  const simdi = Date.now();
  ocoClient.getChangeOrder.mock.mockImplementation(async () =>
    pencere(simdi - 5 * 3600e3, simdi - 4 * 3600e3),
  );
  r = await istek(yol, { method: 'POST', body: { ocoNumber: '22509999' } });
  assert.equal(r.body.ocoExpired, true);
  assert.equal(guncelle.mock.callCount(), 0, 'kapanmis pencereyle guncellendi');

  ocoClient.getChangeOrder.mock.mockImplementation(async () =>
    pencere(simdi + 3600e3, simdi + 5 * 3600e3),
  );
  r = await istek(yol, { method: 'POST', body: { ocoNumber: '22509999' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const yama = guncelle.mock.calls[0].arguments[1];
  assert.equal(yama.ocoNumber, '22509999');
  assert.equal(yama.ocoSubject, 'Yeni kesinti');
  assert.ok(yama.runAt instanceof Date || typeof yama.runAt === 'string');
  assert.equal(r.body.record.ocoNumber, '22509999');
  assert.deepEqual(denetim.at(-1).detay, { id: 8, oncekiOco: '22500001', yeniOco: '22509999' });

  // Ayni numara: OCO servisi sorulmaz, bos yama.
  const once = ocoClient.getChangeOrder.mock.callCount();
  await istek(yol, { method: 'POST', body: { ocoNumber: '22500001' } });
  assert.equal(ocoClient.getChangeOrder.mock.callCount(), once);
  assert.deepEqual(guncelle.mock.calls.at(-1).arguments[1], {});
  guncelle.mock.mockImplementation(async () => null);
  r = await istek(yol, { method: 'POST', body: {} });
  assert.equal(r.status, 409);
  assert.match(r.body.message, /Yalnizca beklemedeki kayitlar guncellenebilir/);
});
