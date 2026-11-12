// server/selfservice/__tests__/sorgu-erisim.test.cjs - IP/Sunucu ve OCP sorgu uclari BMW Hub'dan da (2026-11-12).
//
// Kullanici: "IP Sorgu ve OpenShift sorgu sekmelerini Otomasyon'dan alip BMW Hub'a tasiyalim". Ekran BMW
// Hub'da; uclar /api/selfservice altinda kaldi. Self Service sayfasini GOREMEYEN ama BMW Hub'i goren
// kullanici sorgu uclarina ulasir; ikisini de goremeyen 403; diger Self Service uclari yine Self Service
// gorunurlugune bagli.
//   SE1 yalniz BMW Hub goren: sorgu uclari 403 DEGIL; diger uc 403
//   SE2 ikisini de goremeyen: sorgu uclari 403
//   SE3 yalniz Self Service goren: sorgu uclari 403 DEGIL
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');

function sahte(yol, exp) {
  const m = new Module(yol, null);
  m.loaded = true;
  m.exports = exp;
  require.cache[yol] = m;
}

const gorunur = { BmwHub: true, 'Self Service': true };
const kullanici = { username: 'ayse', role: 'User' };
sahte(require.resolve('../../auth/index.cjs'), {
  requireAuth: (_q, _s, n) => n(),
  requireAdmin: (_q, res) => res.status(403).json({ ok: false, error: 'admin' }),
  getRequestUser: () => kullanici,
});
const canSee = async (_u, k) => (k in gorunur ? gorunur[k] : true);
const requireVisible = (k) => async (req, res, next) => ((await canSee(null, k)) ? next() : res.status(403).json({ ok: false, error: 'gizli' }));
sahte(require.resolve('../../auth/visibility.cjs'), {
  canSee,
  requireVisible,
  requireVisiblePrefix: (k, opts = {}) => {
    const ex = new Set(opts.exempt || []);
    const rv = requireVisible(k);
    return (req, res, next) => (ex.has(req.path) ? next() : rv(req, res, next));
  },
});
sahte(require.resolve('../../audit/index.cjs'), { auditMutations: () => (_q, _s, n) => n() });
sahte(require.resolve('../store.cjs'), { loadSelfServiceStore: async () => {}, readGroups: async () => [], updateGroup: async () => {} });
sahte(require.resolve('../../inventory/mssql.cjs'), {
  sql: { NVarChar: () => 'nv', VarChar: () => 'v', Int: 'int' },
  query: async () => {
    throw new Error('test: veritabani yok');
  },
});

const { initSelfService } = require('../index.cjs');

async function durum(yol, govde) {
  const app = express();
  initSelfService(app);
  const srv = app.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/selfservice${yol}`, {
      method: govde ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json' },
      body: govde ? JSON.stringify(govde) : undefined,
    });
    return r.status;
  } finally {
    srv.close();
  }
}
const SORGULAR = [
  ['/ip-check', { ips: ['10.0.0.1'] }],
  ['/server-ip-check', { servers: ['GBJBOP07'] }],
  ['/openshift-check', { query: 'kart' }],
];

test('SE1 yalniz BMW Hub goren: sorgu uclari acik, diger Self Service ucu kapali', async () => {
  gorunur.BmwHub = true;
  gorunur['Self Service'] = false;
  for (const [y, g] of SORGULAR) assert.notEqual(await durum(y, g), 403, `${y} BMW Hub kullanicisina kapali`);
  assert.equal(await durum('/groups'), 403, 'Self Service gizliyken diger uc acildi');
});

test('SE2 ikisini de goremeyen: sorgu uclari 403', async () => {
  gorunur.BmwHub = false;
  gorunur['Self Service'] = false;
  for (const [y, g] of SORGULAR) assert.equal(await durum(y, g), 403, `${y} gorunurluk olmadan acildi`);
});

test('SE3 yalniz Self Service goren: sorgu uclari acik', async () => {
  gorunur.BmwHub = false;
  gorunur['Self Service'] = true;
  for (const [y, g] of SORGULAR) assert.notEqual(await durum(y, g), 403, `${y} Self Service kullanicisina kapali`);
});
