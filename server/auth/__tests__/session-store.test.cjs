// server/auth/__tests__/session-store.test.cjs — MSSQL session store'un get/set/destroy
// davranisi (db.query mock'lanir — gercek MSSQL gerekmez). Opt-in store'un SQL/serilestirme
// dogrulugunu kilitler (Sprint 4/D1 — hassas parca).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const session = require('express-session');
const db = require('../../db/index.cjs');
const { createMssqlSessionStore } = require('../mssql-session-store.cjs');

function withMock(fn, impl) {
  const orig = db.query;
  db.query = impl;
  return Promise.resolve(fn()).finally(() => { db.query = orig; });
}

test('get(): DB satırındaki sess JSON parse edilip callback\'e verilir', async () => {
  const store = createMssqlSessionStore(session);
  await withMock(
    () => new Promise((resolve, reject) => {
      store.get('sid-1', (err, sess) => {
        try {
          assert.equal(err, null);
          assert.deepEqual(sess, { user: { username: 'jdoe' }, cookie: {} });
          resolve();
        } catch (e) { reject(e); }
      });
    }),
    async (sql, params) => {
      assert.match(sql, /SELECT sess FROM portal_sessions WHERE sid = \$1 AND expires > GETUTCDATE\(\)/);
      assert.equal(params[0], 'sid-1');
      return { rows: [{ sess: JSON.stringify({ user: { username: 'jdoe' }, cookie: {} }) }] };
    }
  );
});

test('get(): satır yoksa null döner', async () => {
  const store = createMssqlSessionStore(session);
  await withMock(
    () => new Promise((resolve, reject) => {
      store.get('nope', (err, sess) => { try { assert.equal(err, null); assert.equal(sess, null); resolve(); } catch (e) { reject(e); } });
    }),
    async () => ({ rows: [] })
  );
});

test('set(): önce UPDATE, satır yoksa INSERT (upsert) — sess JSON serileştirilir', async () => {
  const store = createMssqlSessionStore(session);
  const calls = [];
  await withMock(
    () => new Promise((resolve, reject) => {
      store.set('sid-2', { user: { username: 'u' }, cookie: { expires: new Date(Date.now() + 3600e3).toISOString() } }, (err) => {
        try { assert.equal(err, null); resolve(); } catch (e) { reject(e); }
      });
    }),
    async (sql, params) => {
      calls.push({ sql, params });
      if (/^UPDATE portal_sessions/.test(sql.trim())) return { rowCount: 0 }; // satir yok → INSERT tetiklensin
      return { rows: [] };
    }
  );
  assert.equal(calls.length, 2, 'UPDATE (0 satır) + INSERT');
  assert.match(calls[0].sql, /UPDATE portal_sessions SET sess = \$1, expires = \$2 WHERE sid = \$3/);
  assert.match(calls[1].sql, /INSERT INTO portal_sessions \(sid, sess, expires\)/);
  // INSERT paramlari: [sid, json, expires] — json icinde user olmali.
  assert.equal(calls[1].params[0], 'sid-2');
  assert.match(calls[1].params[1], /"username":"u"/);
});

test('set(): UPDATE satır bulursa INSERT YAPILMAZ', async () => {
  const store = createMssqlSessionStore(session);
  const calls = [];
  await withMock(
    () => new Promise((resolve) => { store.set('sid-3', { cookie: {} }, () => resolve()); }),
    async (sql) => { calls.push(sql); return { rowCount: 1 }; }
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0], /UPDATE portal_sessions/);
});

test('destroy(): sid için DELETE çalışır', async () => {
  const store = createMssqlSessionStore(session);
  let captured = null;
  await withMock(
    () => new Promise((resolve) => { store.destroy('sid-4', () => resolve()); }),
    async (sql, params) => { captured = { sql, params }; return { rows: [] }; }
  );
  assert.match(captured.sql, /DELETE FROM portal_sessions WHERE sid = \$1/);
  assert.equal(captured.params[0], 'sid-4');
});
