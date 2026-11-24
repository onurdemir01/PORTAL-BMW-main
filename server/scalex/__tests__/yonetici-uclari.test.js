// server/scalex/__tests__/yonetici-uclari.test.js - ScaleX yonetici uclari (OCO tanisi, RBAC bulgulari, kesif suresi)
// gercek express ile (2026-11-24, kapsam PR-2). oco/diagnose.cjs kendi testinde; burada ucun yetki, yapilandirma,
// servis hatasi ve kapi simulasyonu kablolamasi sinanir. Sahte: OCO istemci / ayar, DB, AWX runner.
//   YU1 oco-diagnose: Admin disi 403; numara zorunlu; servis yapilandirilmamis 503 (cokmusten ayri); sorgu denetime
//   YU2 oco-diagnose: kayit okunamazsa lookupFailed (200, okunan alan listesiyle); okunursa teshis + kapi simulasyonu
//   YU3 rbac-findings / discovery-timing: Admin disi 403; liste ve sinirlar
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
sahte('db/index.cjs', { query: async () => ({ rows: [], rowCount: 0 }) });
const denetim = [];
sahte('audit/index.cjs', {
  auditPortal: (req, olay, ek) =>
    denetim.push({ olay, detay: ek?.detail ? JSON.parse(ek.detail) : null }),
});
sahte('auth/index.cjs', { requireAuth: (req, res, next) => next() });
sahte('auth/visibility.cjs', { requireVisiblePrefix: () => (req, res, next) => next() });
sahte('scalex/reconciler.cjs', { startReconciler() {} });
sahte('ansible/runner.cjs', {
  getJobStatusOnServer: async () => ({ status: 'running' }),
  getServers: () => [],
  getServerById: () => null,
});

const ocoConfig = require('../../oco/config.cjs');
const ocoClient = require('../../oco/client.cjs');
const rbac = require('../rbac-findings.cjs');
const sure = require('../discovery-timing.cjs');

let srv;
let base;
before(async () => {
  const app = express();
  app.use((req, res, next) => {
    req.session = { user: { username: 'adm1', role: req.headers['x-rol'] || 'User' } };
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
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
});
async function al(yol, rol = 'Admin') {
  const r = await fetch(base + yol, { headers: { 'x-rol': rol } });
  return { status: r.status, body: await r.json() };
}

const tarih = (ms) => `/Date(${ms}+0300)/`;

test('YU1 oco-diagnose: yetki, numara, yapilandirma, denetim', async (t) => {
  let r = await al('/admin/oco-diagnose?number=1', 'User');
  assert.equal(r.body.upstreamStatus ?? r.status, 403);
  assert.equal(r.body.message, 'Bu ekran yalnizca yoneticilere acik.');
  r = await al('/admin/oco-diagnose?number=%20');
  assert.equal(r.status, 400);
  t.mock.method(ocoConfig, 'isConfigured', () => false);
  r = await al('/admin/oco-diagnose?number=22500001');
  assert.equal(r.status, 503);
  assert.equal(r.body.notConfigured, true);
  assert.equal(denetim.length, 0, 'yapilandirilmamis serviste sorgu denetime yazildi');
});

test('YU2 oco-diagnose: okunamayan kayit ve kapi simulasyonu', async (t) => {
  t.mock.method(ocoConfig, 'isConfigured', () => true);
  t.mock.method(ocoClient, 'getChangeOrder', async () => {
    throw Object.assign(new Error('Kayit bulunamadi'), { status: 404 });
  });
  t.mock.method(ocoClient, 'httpStatus', () => 404);
  let r = await al('/admin/oco-diagnose?number=22500001');
  assert.equal(r.status, 200);
  assert.deepEqual(
    [r.body.ok, r.body.lookupFailed, r.body.status, r.body.message],
    [false, true, 404, 'Kayit bulunamadi'],
  );
  assert.ok(
    Array.isArray(r.body.readFields) && r.body.readFields.length > 0,
    'okunan alan listesi yok',
  );
  assert.deepEqual(denetim.at(-1), { olay: 'scalex_oco_diagnose', detay: { oco: '22500001' } });

  const bas = Date.now() + 3600e3;
  ocoClient.getChangeOrder.mock.mockImplementation(async () => ({
    payload: {
      GetChangeOrderByWfInstanceIdResult: {
        Result: {
          PlannedStartDate: tarih(bas),
          PlannedEndDate: tarih(bas + 4 * 3600e3),
          Subject: 'Kesinti',
        },
      },
    },
    result: { Subject: 'Kesinti' },
  }));
  r = await al('/admin/oco-diagnose?number=22500001&env=prod&action=stop');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.equal(r.body.number, '22500001');
  assert.deepEqual(r.body.scope, { env: 'prod', action: 'stop', executionMode: 'apply' });
  assert.ok(r.body.gatePolicy, 'kapi politikasi yok');
  assert.ok(r.body.simulation && r.body.simulation.outcome, 'simulasyon sonucu yok');
  assert.ok(Array.isArray(r.body.fields), 'alan listesi yok');
});

test('YU3 rbac-findings ve discovery-timing: yetki ve liste', async (t) => {
  const yasak = await al('/admin/rbac-findings', 'User');
  assert.equal(yasak.body.upstreamStatus ?? yasak.status, 403, 'Admin olmayana acildi');
  assert.match(yasak.body.message, /yalnizca yoneticilere acik/);
  const liste = t.mock.method(rbac, 'list', async () => [{ id: 1, reason: 'no_permission' }]);
  let r = await al('/admin/rbac-findings?reason=api_absent');
  assert.deepEqual(liste.mock.calls[0].arguments[0], { reason: 'api_absent' });
  assert.deepEqual(r.body.findings, [{ id: 1, reason: 'no_permission' }]);
  assert.equal(r.body.limit, rbac.LIST_LIMIT);

  const yasak2 = await al('/admin/discovery-timing', 'User');
  assert.equal(yasak2.body.upstreamStatus ?? yasak2.status, 403, 'Admin olmayana acildi');
  assert.match(yasak2.body.message, /yalnizca yoneticilere acik/);
  const sureler = t.mock.method(sure, 'list', async () => [{ id: 3, elapsedMs: 1200 }]);
  r = await al('/admin/discovery-timing?limit=25');
  assert.deepEqual(sureler.mock.calls[0].arguments[0], { limit: '25' });
  assert.deepEqual(r.body.timings, [{ id: 3, elapsedMs: 1200 }]);
  assert.equal(r.body.limit, sure.LIST_LIMIT);
  assert.equal(r.body.retentionDays, sure.RETENTION_DAYS);
});
