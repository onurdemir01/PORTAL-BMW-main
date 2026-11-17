'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function sahte(yol, exp) {
  const m = new Module(yol, null);
  m.loaded = true;
  m.exports = exp;
  require.cache[yol] = m;
}

test('DB transaction: request timeout rollback yapar, sonraki transaction bagimsiz commit olur', async () => {
  const dbYolu = require.resolve('../index.cjs');
  const mssqlYolu = require.resolve('mssql');
  const portalYolu = require.resolve('../portal-mssql.cjs');
  const metricsYolu = require.resolve('../../metrics.cjs');
  const yedekler = new Map([dbYolu, mssqlYolu, portalYolu, metricsYolu].map((p) => [p, require.cache[p]]));
  const olay = [];
  let timeout = true;
  class Transaction {
    async begin() { olay.push('begin'); }
    async commit() { olay.push('commit'); }
    async rollback() { olay.push('rollback'); }
  }
  class Request {
    input() { return this; }
    async query() {
      olay.push('query');
      if (timeout) throw Object.assign(new Error('fixture request timeout'), { code: 'ETIMEOUT' });
      return { recordset: [{ ok: 1 }], rowsAffected: [1] };
    }
  }
  try {
    sahte(mssqlYolu, { Transaction, Request, NVarChar: () => 'nvarchar', MAX: -1, Bit: 'bit', Int: 'int', Float: 'float', DateTime2: 'datetime2' });
    sahte(portalYolu, { getPool: async () => ({}) });
    sahte(metricsYolu, { timeQuery: async (_db, _wait, _sql, run) => run() });
    delete require.cache[dbYolu];
    const db = require('../index.cjs');

    await assert.rejects(db.transaction((tx) => tx.query('SELECT $1 AS x', [1])), /fixture request timeout/);
    assert.deepEqual(olay, ['begin', 'query', 'rollback'], 'timeout acik transaction birakti');

    timeout = false;
    const r = await db.transaction((tx) => tx.query('SELECT $1 AS x', [1]));
    assert.deepEqual(r.rows, [{ ok: 1 }]);
    assert.deepEqual(olay.slice(3), ['begin', 'query', 'commit'], 'sonraki transaction bagimsiz commit olmadi');
  } finally {
    for (const [p, onceki] of yedekler) {
      if (onceki) require.cache[p] = onceki;
      else delete require.cache[p];
    }
  }
});
