// server/logx/v2/__tests__/resolve-terminal-hosts.test.cjs — cluster-bazli bastion cozumlemesi.
// Oncelik: ocp_cluster_index.terminal_host > ocp_terminal_host_map(tenant,env) fallback.
// db.query mock'lanir; SQL metnine gore hangi tabloya gidildigi ayirt edilir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../db/index.cjs');
const admin = require('../admin.cjs');

// clusterRows: ocp_cluster_index sorgusuna donen satirlar; mapHost: fallback map cevabi (null = yok).
function withMock(fn, { clusterRows = [], mapHost = null } = {}) {
  const orig = db.query;
  db.query = async (sql) => {
    if (/FROM ocp_cluster_index/i.test(sql)) return { rows: clusterRows };
    if (/FROM ocp_terminal_host_map/i.test(sql)) {
      return { rows: mapHost ? [{ terminal_host: mapHost }] : [] };
    }
    throw new Error(`beklenmeyen sorgu: ${sql}`);
  };
  return Promise.resolve(fn()).finally(() => { db.query = orig; });
}

test('resolveTerminalHosts(): cluster kolonu dolu ise map fallback yerine kolon kazanir', async () => {
  await withMock(async () => {
    const r = await admin.resolveTerminalHosts('dev', 'ark', ['c1']);
    assert.deepEqual(r, { hosts: { c1: 'jump01' }, missing: [] });
  }, { clusterRows: [{ cluster_name: 'c1', terminal_host: 'jump01' }], mapHost: 'gbaocp01' });
});

test('resolveTerminalHosts(): kolon NULL ise tenant/env map fallback kullanilir', async () => {
  await withMock(async () => {
    const r = await admin.resolveTerminalHosts('dev', 'ark', ['c1']);
    assert.deepEqual(r, { hosts: { c1: 'gbaocp01' }, missing: [] });
  }, { clusterRows: [{ cluster_name: 'c1', terminal_host: null }], mapHost: 'gbaocp01' });
});

test('resolveTerminalHosts(): karisik — bir cluster kolonlu, digeri fallback, ucuncusu missing', async () => {
  await withMock(async () => {
    const r = await admin.resolveTerminalHosts('dev', 'ark', ['c1', 'c2', 'c3']);
    assert.deepEqual(r.hosts, { c1: 'jump01', c2: 'gbaocp01', c3: 'gbaocp01' });
    assert.deepEqual(r.missing, []);
  }, {
    clusterRows: [
      { cluster_name: 'c1', terminal_host: 'jump01' },
      { cluster_name: 'c2', terminal_host: '' },
      // c3 satiri hic yok (agacta olmayan cluster) — yine fallback'e duser
    ],
    mapHost: 'gbaocp01',
  });
});

test('resolveTerminalHosts(): ne kolon ne map varsa cluster missing listesine girer (throw yok)', async () => {
  await withMock(async () => {
    const r = await admin.resolveTerminalHosts('dev', 'ark', ['c1', 'c2']);
    assert.deepEqual(r.hosts, { c1: 'jump01' });
    assert.deepEqual(r.missing, ['c2']);
  }, { clusterRows: [{ cluster_name: 'c1', terminal_host: 'jump01' }], mapHost: null });
});

test('resolveTerminalHosts(): bos/tekrarli cluster listesi normalize edilir', async () => {
  await withMock(async () => {
    const r = await admin.resolveTerminalHosts('dev', 'ark', [' c1 ', 'c1', '', null]);
    assert.deepEqual(r, { hosts: { c1: 'jump01' }, missing: [] });
  }, { clusterRows: [{ cluster_name: 'c1', terminal_host: 'jump01' }] });
});

test('createClusterIndexRow(): terminal_host trimlenir, bos deger NULL olarak yazilir', async () => {
  const captured = [];
  const orig = db.query;
  db.query = async (sql, params) => { captured.push(params); return { rows: [{ id: 1, is_active: 1 }] }; };
  try {
    await admin.createClusterIndexRow({ env: 'dev', tenant: 'ark', cluster_name: 'c1', terminal_host: '  jump01  ' });
    assert.equal(captured[0][3], 'jump01');
    await admin.createClusterIndexRow({ env: 'dev', tenant: 'ark', cluster_name: 'c2', terminal_host: '   ' });
    assert.equal(captured[1][3], null);
  } finally { db.query = orig; }
});
