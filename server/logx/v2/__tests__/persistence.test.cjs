// server/logx/v2/__tests__/persistence.test.cjs — "Her kritik adim DB'ye yaziliyor mu?"
// guvencesi (Sprint 2). db.query t.mock.method ile sahtelenip yazilan SQL/paramlar dogrulanir
// — gercek MSSQL GEREKMEZ. Kapsam: download token, request state gecisi, namespace finalize
// (normalize + persist), job cancel.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../../db/index.cjs');
const runner = require('../../../ansible/runner.cjs');
const downloads = require('../downloads.cjs');
const requests = require('../requests.cjs');
const ocp = require('../ocp.cjs');
const jobs = require('../jobs.cjs');

// ── issueDownloadToken → logx_v2_downloads INSERT ──────────────────────────────
test('issueDownloadToken(): token + filename + staged_path + size logx_v2_downloads\'a INSERT edilir', async (t) => {
  let captured = null;
  t.mock.method(db, 'query', async (sql, params) => { captured = { sql, params }; return { rows: [], rowCount: 1 }; });

  await downloads.issueDownloadToken({
    requestId: 'req-1', username: 'jdoe', sessionToken: 'sess', stagedPath: '/nfs/legacy/x.zip',
    filename: 'x.zip', sizeBytes: 4096, isFallback: false,
  });

  assert.match(captured.sql, /INSERT INTO logx_v2_downloads/i);
  assert.match(captured.params[0], /^[a-f0-9]{64}$/);   // token (256-bit hex)
  assert.equal(captured.params[1], 'req-1');            // request_id
  assert.equal(captured.params[2], 'jdoe');             // username
  assert.equal(captured.params[4], '/nfs/legacy/x.zip'); // staged_path
  assert.equal(captured.params[5], 'x.zip');            // filename
  assert.equal(captured.params[6], 4096);               // size_bytes (safe int)
  assert.equal(captured.params[7], 0);                  // is_fallback
});

test('issueDownloadToken(): bozuk sizeBytes NULL yazılır (nvarchar→bigint 500 önlenir)', async (t) => {
  let captured = null;
  t.mock.method(db, 'query', async (sql, params) => { captured = { sql, params }; return { rows: [], rowCount: 1 }; });
  await downloads.issueDownloadToken({
    requestId: 'r', username: 'u', sessionToken: 's', stagedPath: '/x', filename: 'x.zip',
    sizeBytes: { junk: true }, isFallback: true,
  });
  assert.equal(captured.params[6], null); // size_bytes → null
  assert.equal(captured.params[7], 1);    // is_fallback → 1
});

// ── requests.updateRequest → state gecisi persist ──────────────────────────────
test('updateRequest(): state geçişi logx_v2_requests\'e yazılır (OUTPUT INSERTED ile döner)', async (t) => {
  let captured = null;
  t.mock.method(db, 'query', async (sql, params) => { captured = { sql, params }; return { rows: [{ request_id: 'r', state: 'ready' }] }; });

  await requests.updateRequest('r', { state: 'ready', errorMessage: null });

  assert.match(captured.sql, /UPDATE logx_v2_requests SET/i);
  assert.match(captured.sql, /state = /i);
  assert.match(captured.sql, /OUTPUT INSERTED/i);
  assert.ok(captured.params.includes('ready'), 'state değeri paramlarda olmalı');
  assert.equal(captured.params[captured.params.length - 1], 'r', 'son param request_id (WHERE)');
});

// ── ocp.finalizeNamespaceDiscovery → normalize + persist ───────────────────────
test('finalizeNamespaceDiscovery(): namespace önekleri temizlenir + state=namespaces_discovered yazılır', async (t) => {
  let captured = null;
  t.mock.method(requests, 'updateRequest', async (id, fields) => { captured = { id, fields }; return null; });

  await ocp.finalizeNamespaceDiscovery({ request_id: 'r' }, {
    artifacts: {
      overall_status: 'success',
      clusters: [{ cluster_name: 'c', status: 'ok', namespaces: [
        'project.project.openshift.io/hkn-lab', 'project/foo', 'bar', '',
      ] }],
    },
  });

  assert.equal(captured.fields.state, 'namespaces_discovered');
  // Onekler kirpilir, boslar atilir, tekillestirilip siralanir.
  assert.deepEqual(captured.fields.discoveryResult.clusters[0].namespaces, ['bar', 'foo', 'hkn-lab']);
});

test('finalizeNamespaceDiscovery(): artifacts yoksa state=failed yazılır', async (t) => {
  let captured = null;
  t.mock.method(requests, 'updateRequest', async (id, fields) => { captured = { id, fields }; return null; });
  await ocp.finalizeNamespaceDiscovery({ request_id: 'r' }, { artifacts: null, errorMessage: 'boom' });
  assert.equal(captured.fields.state, 'failed');
  assert.equal(captured.fields.errorMessage, 'boom');
});

// ── jobs.cancelJob → AWX cancel + DB canceled ──────────────────────────────────
test('cancelJob(): çalışan job AWX\'te iptal edilir ve logx_v2_jobs canceled yazılır', async (t) => {
  const awxMock = t.mock.method(runner, 'cancelJobOnServer', async () => ({ canceled: true }));
  let captured = null;
  t.mock.method(db, 'query', async (sql, params) => { captured = { sql, params }; return { rows: [{ id: 5, status: 'canceled', request_id: 'r', job_type: 'legacy_transfer' }] }; });

  const result = await jobs.cancelJob({ id: 5, status: 'running', awxServerId: 2, awxJobId: 100 });

  assert.equal(awxMock.mock.callCount(), 1);
  assert.match(captured.sql, /UPDATE logx_v2_jobs/i);
  assert.match(captured.sql, /status = 'canceled'/i);
  assert.equal(result.status, 'canceled');
});

test('cancelJob(): zaten terminal job AWX\'e dokunmadan aynen döner (idempotent)', async (t) => {
  const awxMock = t.mock.method(runner, 'cancelJobOnServer', async () => { throw new Error('ÇAĞRILMAMALIYDI'); });
  const job = { id: 9, status: 'successful', awxServerId: 1, awxJobId: 7 };
  const result = await jobs.cancelJob(job);
  assert.equal(awxMock.mock.callCount(), 0);
  assert.equal(result, job);
});
