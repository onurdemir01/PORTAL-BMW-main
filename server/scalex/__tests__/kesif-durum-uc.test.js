// server/scalex/__tests__/kesif-durum-uc.test.js - ScaleX kesif durumu ucu (GET /discover/:serverId/:jobId/status)
// gercek express ile (2026-11-24, kapsam PR-2). Uc 256 satir ve testsizdi: sonucu ekrana verir, is bitince "defter
// islerini" (denetim, sapma, RBAC bulgulari, kesif suresi, yetenek envanteri) BIR kez yapar. Sahte: AWX runner, Portal
// DB, kesif sonucu ayristirici ve defter modullerinin yazicilari.
//   KD1 sahiplik: Admin olmayan, gecmisi olmayan / baskasinin isine 403 + denetim; DB okunamazsa 503; sahibi okur
//   KD2 kosan is: sonuc doner, defter isi YOK
//   KD3 biten 'state' kesfi: sapma tazelenir (satirlar eslenir), denetim bir kez; ikinci yoklamada defter tekrarlanmaz
//   KD4 biten 'workloads' kesfi: RBAC bulgulari, kesif suresi, yetenek envanteri; yazici hatalari yaniti bozmaz
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
const DB = { sahip: null, hata: false };
sahte('db/index.cjs', {
  query: async (sql) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT TOP 1 username FROM ansible_job_history')) {
      if (DB.hata) throw new Error('DB erisilemiyor');
      return { rows: DB.sahip ? [{ username: DB.sahip }] : [] };
    }
    return { rows: [], rowCount: 0 };
  },
});
const denetim = [];
sahte('audit/index.cjs', {
  auditPortal: (req, olay, ek) =>
    denetim.push({ olay, sonuc: ek?.result, detay: JSON.parse(ek.detail) }),
});
sahte('auth/index.cjs', { requireAuth: (req, res, next) => next() });
sahte('auth/visibility.cjs', { requireVisiblePrefix: () => (req, res, next) => next() });
sahte('scalex/reconciler.cjs', { startReconciler() {} });
const AWX = { durum: null };
sahte('ansible/runner.cjs', {
  getJobStatusOnServer: async () => AWX.durum,
  getServers: () => [],
  getServerById: () => null,
});

const sonucMod = require('../result.cjs');
const state = require('../state.cjs');
const rbac = require('../rbac-findings.cjs');
const sure = require('../discovery-timing.cjs');
const yetenek = require('../caps-refresh.cjs');

let srv;
let base;
let jobNo = 100;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      user: { username: req.headers['x-kim'] || 'ornekkisi', role: req.headers['x-rol'] || 'User' },
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
  DB.sahip = 'OrnekKisi';
  DB.hata = false;
  jobNo += 1;
  t.mock.method(console, 'warn', () => {});
  t.mock.method(state, 'refreshDrift', async () => {});
  t.mock.method(rbac, 'record', async () => {});
  t.mock.method(sure, 'record', async () => {});
  t.mock.method(yetenek, 'kaydetYetenekler', async () => {});
});

async function durum(rol = 'User', job = jobNo) {
  const r = await fetch(`${base}/discover/2/${job}/status`, { headers: { 'x-rol': rol } });
  return { status: r.status, body: await r.json() };
}
const bosalt = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

test('KD1 sahiplik: gecmissiz / baskasinin isi 403, DB okunamazsa 503, sahibi okur', async (t) => {
  t.mock.method(sonucMod, 'extractDiscoveryResult', () => null);
  AWX.durum = { status: 'running', finished: null, failed: false, artifacts: {} };
  DB.sahip = null;
  let r = await durum();
  assert.equal(r.status, 409, 'ScaleX 403 reddi nginx cevirisiyle 409 doner');
  assert.equal(r.body.upstreamStatus, 403);
  assert.equal(r.body.message, 'Bu iş size ait değil.');
  assert.equal(denetim.at(-1).olay, 'scalex_access_denied');
  DB.sahip = 'baskasi';
  jobNo += 1;
  assert.equal((await durum()).body.upstreamStatus, 403);
  DB.hata = true;
  jobNo += 1;
  r = await durum();
  assert.equal(r.status, 503);
  assert.match(r.body.message, /sahipliği doğrulanamadı/);
  DB.hata = false;
  DB.sahip = 'OrnekKisi';
  jobNo += 1;
  assert.equal((await durum()).status, 200, 'harf farki sahipligi bozmamali');
  DB.sahip = null;
  jobNo += 1;
  assert.equal((await durum('Admin')).status, 200, 'Admin her isi okur');
});

test('KD2 kosan is: sonuc doner, defter isi yapilmaz', async (t) => {
  const parsed = {
    mode: 'workloads',
    overallStatus: 'ok',
    namespace: 'kart-prod',
    timing: [{ cluster: 'c1' }],
  };
  t.mock.method(sonucMod, 'extractDiscoveryResult', () => parsed);
  AWX.durum = { status: 'running', finished: null, failed: false, artifacts: {} };
  const r = await durum();
  assert.deepEqual(r.body, {
    ok: true,
    status: 'running',
    finished: false,
    failed: false,
    result: parsed,
  });
  await bosalt();
  assert.equal(denetim.length, 0);
  assert.equal(sure.record.mock.callCount(), 0);
});

test('KD3 biten state kesfi: sapma tazelenir, defter bir kez', async (t) => {
  t.mock.method(sonucMod, 'extractDiscoveryResult', () => ({
    mode: 'state',
    overallStatus: 'error',
    environment: 'prod',
    platform: 'kart',
    namespace: 'kart-prod',
    namespaces: ['kart-prod'],
    clusters: ['c1', 'c2'],
    failedClusters: ['c2'],
    counts: { ok: 1, warn: 0, fail: 1 },
    states: [
      {
        cluster: 'c1',
        appName: 'odeme',
        previousReplicas: 3,
        phase: 'stopped',
        createdBy: 'ali',
        kind: 'Deployment',
        legacy: false,
      },
    ],
    live: [
      {
        cluster: 'c1',
        namespace: 'diger-ns',
        appName: 'odeme',
        readyReplicas: 0,
        workloadAbsent: false,
      },
    ],
  }));
  AWX.durum = { status: 'failed', finished: '2026-11-24T10:00:00Z', failed: true, artifacts: {} };
  const r = await durum();
  assert.equal(r.body.finished, true);
  assert.equal(r.body.failed, true);
  const girdi = state.refreshDrift.mock.calls[0].arguments[0];
  assert.deepEqual(
    [girdi.env, girdi.tenant, girdi.scannedClusters],
    ['prod', 'kart', ['c1', 'c2']],
  );
  assert.deepEqual(girdi.clusterStates[0], {
    env: 'prod',
    tenant: 'kart',
    clusterName: 'c1',
    namespace: 'kart-prod',
    appName: 'odeme',
    previousReplicas: 3,
    phase: 'stopped',
    stoppedBy: 'ali',
    workloadKind: 'Deployment',
    legacy: false,
  });
  assert.equal(girdi.liveStates[0].namespace, 'diger-ns', 'satir namespace i korunmadi');
  await bosalt();
  assert.equal(denetim.length, 1);
  assert.equal(denetim[0].olay, 'scalex_discovery_result');
  assert.equal(denetim[0].sonuc, 'fail');
  assert.deepEqual(denetim[0].detay.failedClusters, ['c2']);
  await durum();
  await bosalt();
  assert.equal(denetim.length, 1, 'ikinci yoklamada defter tekrarlandi');
  // Sapma yazilamazsa yanit bozulmaz.
  state.refreshDrift.mock.mockImplementation(async () => {
    throw new Error('ayna yazilamadi');
  });
  jobNo += 1;
  assert.equal((await durum()).status, 200);
});

test('KD4 biten workloads kesfi: RBAC, sure, yetenek; yazici hatalari yaniti bozmaz', async (t) => {
  t.mock.method(sonucMod, 'extractDiscoveryResult', () => ({
    mode: 'workloads',
    overallStatus: 'ok',
    environment: 'prod',
    platform: 'kart',
    namespace: 'kart-prod',
    namespaces: ['kart-prod'],
    clusters: ['c1'],
    failedClusters: [],
    workloads: [{ cluster: 'c1', name: 'odeme', kind: 'Deployment' }],
    kindReports: [{ cluster: 'c1', kind: 'KafkaConnect', reason: 'no_permission' }],
    timing: [{ cluster: 'c1', elapsedMs: 1200 }],
    playbookTiming: { prepMs: 100 },
    capabilities: [{ cluster: 'c1', kinds: ['KafkaConnect'] }],
  }));
  AWX.durum = {
    status: 'successful',
    created: '2026-11-24T09:59:00Z',
    started: '2026-11-24T09:59:10Z',
    finished: '2026-11-24T10:00:00Z',
    failed: false,
    artifacts: {},
  };
  const r = await durum();
  assert.equal(r.status, 200);
  await bosalt();
  assert.equal(state.refreshDrift.mock.callCount(), 0, 'workloads kesfi sapma tazeledi');
  const kayit = rbac.record.mock.calls[0].arguments[0];
  assert.deepEqual(kayit.kindReports[0].namespace, 'kart-prod', 'satir namespace i doldurulmadi');
  const s = sure.record.mock.calls[0].arguments[0];
  assert.deepEqual(
    [s.awxJobId, s.job.started, s.playbookTiming.prepMs],
    [jobNo, '2026-11-24T09:59:10Z', 100],
  );
  const y = yetenek.kaydetYetenekler.mock.calls[0].arguments[1];
  assert.deepEqual([y.scannedBy, y.awxJobId], ['ornekkisi', jobNo]);
  assert.equal(denetim[0].detay.workloads, 1);

  rbac.record.mock.mockImplementation(async () => {
    throw new Error('rbac yok');
  });
  sure.record.mock.mockImplementation(async () => {
    throw new Error('sure yok');
  });
  yetenek.kaydetYetenekler.mock.mockImplementation(async () => {
    throw new Error('envanter yok');
  });
  jobNo += 1;
  assert.equal((await durum()).status, 200);
  await bosalt();
  assert.equal(console.warn.mock.callCount() >= 3, true, 'yazici hatalari loglanmadi');
});
