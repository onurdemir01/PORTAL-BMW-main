// server/audit/__tests__/audit-session-hash.test.cjs — audit_logs ham oturum kimligini saklamaz.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { hashSessionId } = require('../index.cjs');

test('AU1 hashSessionId bos oturumu null dondurur', () => {
  assert.equal(hashSessionId(null), null);
  assert.equal(hashSessionId(undefined), null);
  assert.equal(hashSessionId(''), null);
});

test('AU2 hashSessionId ham kimligi geri dondurulmez ozete cevirir ve tutarlidir', () => {
  const ham = 'sess_very_sensitive_cookie_value_12345';
  const h1 = hashSessionId(ham);
  const h2 = hashSessionId(ham);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{16}$/);
  assert.notEqual(h1, ham);
  assert.ok(!h1.includes('sensitive'));
});

test('AU3 auditPortal sessionId alanini hashSessionId uzerinden yazar', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  assert.match(src, /sessionId:\s*hashSessionId\(req\?\.sessionID\)/);
  assert.doesNotMatch(src, /sessionId:\s*req\?\.sessionID\s*\|\|\s*null/);
});
