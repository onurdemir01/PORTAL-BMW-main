// server/logx/v2/__tests__/admin-conflict.test.cjs — Admin CRUD unique-ihlali → 409 (500 degil).
// db.query mock'lanip MSSQL unique hatasi simule edilir (Faz 2).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../db/index.cjs');
const admin = require('../admin.cjs');

function withMock(fn, impl) {
  const orig = db.query;
  db.query = impl;
  return Promise.resolve(fn()).finally(() => { db.query = orig; });
}

test('createClusterIndexRow(): duplicate (MSSQL 2627) → status 409 dostça mesaj', async () => {
  await withMock(
    () => assert.rejects(
      () => admin.createClusterIndexRow({ env: 'lab', tenant: 'ark', cluster_name: 'gbocplab2' }),
      (err) => { assert.equal(err.status, 409); assert.match(err.message, /zaten var/i); return true; }
    ),
    async () => { throw Object.assign(new Error('Violation of UNIQUE KEY constraint'), { number: 2627 }); }
  );
});

test('createClusterIndexRow(): unique-DIŞI hata olduğu gibi yükselir (409 DEĞİL)', async () => {
  await withMock(
    () => assert.rejects(
      () => admin.createClusterIndexRow({ env: 'lab', tenant: 'ark', cluster_name: 'x' }),
      (err) => { assert.notEqual(err.status, 409); assert.match(err.message, /connection lost/i); return true; }
    ),
    async () => { throw new Error('connection lost'); }
  );
});

test('createTerminalHostRow(): duplicate (2601 unique index) → 409', async () => {
  await withMock(
    () => assert.rejects(
      () => admin.createTerminalHostRow({ tenant: 'ark', env: 'lab', terminal_host: 'gbaocp01' }),
      (err) => { assert.equal(err.status, 409); return true; }
    ),
    async () => { throw Object.assign(new Error('duplicate key'), { number: 2601 }); }
  );
});
