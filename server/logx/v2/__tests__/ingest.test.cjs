// server/logx/v2/__tests__/ingest.test.cjs — A4 fetch-back ingest: token uretimi (INSERT) +
// upload route'un dogrulama dallari (gecersiz/eksik/tukenmis/suresi-dolmus token). db.query
// mock'lanir; streaming basari yolu entegrasyon testine birakilir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../../db/index.cjs');
const ingest = require('../ingest.cjs');

function withMock(fn, impl) {
  const orig = db.query;
  db.query = impl;
  return Promise.resolve(fn()).finally(() => { db.query = orig; });
}
function mockRes() {
  return { statusCode: 0, body: null, headersSent: false,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; this.headersSent = true; return this; } };
}
function mockReq(token) {
  return { params: { token }, on() {}, pipe() {}, destroy() {} };
}

test('issueIngestToken(): logx_v2_ingest\'e token + request_id + basename(filename) INSERT eder', async () => {
  let captured = null;
  await withMock(
    () => ingest.issueIngestToken({ requestId: 'req-9', filename: '/kaynak/host/path/abc123.zip' }),
    async (sql, params) => { captured = { sql, params }; return { rows: [], rowCount: 1 }; }
  ).then((info) => {
    assert.match(info.token, /^[a-f0-9]{64}$/);
    assert.match(info.url, /\/api\/logx\/v2\/ingest\/[a-f0-9]{64}$/);
  });
  assert.match(captured.sql, /INSERT INTO logx_v2_ingest/i);
  assert.match(captured.params[0], /^[a-f0-9]{64}$/); // token
  assert.equal(captured.params[1], 'req-9');          // request_id
  assert.equal(captured.params[2], 'abc123.zip');     // basename(filename) — path siyrildi
});

test('handleIngestRoute(): geçersiz token formatı → 400', async () => {
  const res = mockRes();
  await ingest.handleIngestRoute(mockReq('kısa'), res);
  assert.equal(res.statusCode, 400);
});

test('handleIngestRoute(): token DB\'de yok → 404', async () => {
  const res = mockRes();
  const t = 'a'.repeat(64);
  await withMock(() => ingest.handleIngestRoute(mockReq(t), res), async () => ({ rows: [] }));
  assert.equal(res.statusCode, 404);
});

test('handleIngestRoute(): token zaten tüketilmiş → 409', async () => {
  const res = mockRes();
  const t = 'b'.repeat(64);
  await withMock(() => ingest.handleIngestRoute(mockReq(t), res),
    async () => ({ rows: [{ token: t, consumed: 1, expires_at: new Date(Date.now() + 3600e3), filename: 'x.zip', fallback_dir: '/tmp' }] }));
  assert.equal(res.statusCode, 409);
});

test('handleIngestRoute(): token süresi dolmuş → 410', async () => {
  const res = mockRes();
  const t = 'c'.repeat(64);
  await withMock(() => ingest.handleIngestRoute(mockReq(t), res),
    async () => ({ rows: [{ token: t, consumed: 0, expires_at: new Date(Date.now() - 1000), filename: 'x.zip', fallback_dir: '/tmp' }] }));
  assert.equal(res.statusCode, 410);
});
