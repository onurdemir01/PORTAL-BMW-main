// server/auth/__tests__/visibility-cascade.test.cjs — G11 (parent→child kaskadi) ve
// G6 (motor hatasinda fail-CLOSED) davranislari.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vis = require('../visibility.cjs');
const db = require('../../db/index.cjs');

const { _applyParentCascade: applyParentCascade } = vis;

test('kaskad: ata gorunmezse cocuk da gorunmez (belgelenen kural artik gercek)', () => {
  const elements = [
    { element_key: 'Performance', parent_key: null },
    { element_key: 'Perf:instana', parent_key: 'Performance' },
  ];
  const out = applyParentCascade({ 'Performance': false, 'Perf:instana': true }, elements);
  assert.equal(out['Perf:instana'], false, 'ata kapaliysa cocuk da kapanmali');
});

test('kaskad: ata gorunuyorsa cocugun kendi karari korunur', () => {
  const elements = [
    { element_key: 'Performance', parent_key: null },
    { element_key: 'Perf:instana', parent_key: 'Performance' },
    { element_key: 'Perf:splunk', parent_key: 'Performance' },
  ];
  const out = applyParentCascade(
    { 'Performance': true, 'Perf:instana': false, 'Perf:splunk': true }, elements
  );
  assert.equal(out['Perf:instana'], false);
  assert.equal(out['Perf:splunk'], true);
});

test('kaskad: cok seviyeli zincir (navgroup > page > tab) bastan sona tasinir', () => {
  const elements = [
    { element_key: 'navgroup:otomasyon', parent_key: null },
    { element_key: 'OpsX', parent_key: 'navgroup:otomasyon' },
    { element_key: 'btn:opsx:run', parent_key: 'OpsX' },
  ];
  const out = applyParentCascade(
    { 'navgroup:otomasyon': false, 'OpsX': true, 'btn:opsx:run': true }, elements
  );
  assert.equal(out['OpsX'], false);
  assert.equal(out['btn:opsx:run'], false);
});

test('kaskad: bozuk/dongusel parent zinciri sonsuz donguye girmez', () => {
  const elements = [
    { element_key: 'a', parent_key: 'b' },
    { element_key: 'b', parent_key: 'a' },
  ];
  const out = applyParentCascade({ a: true, b: true }, elements);
  assert.equal(typeof out.a, 'boolean');
  assert.equal(typeof out.b, 'boolean');
});

test('kaskad: registry disi parent (kayitsiz anahtar) cocugu kilitlemez', () => {
  const elements = [{ element_key: 'X', parent_key: 'olmayan-ata' }];
  const out = applyParentCascade({ X: true }, elements);
  assert.equal(out.X, true);
});

// ── G6: requireVisible motor hatasinda fail-CLOSED ───────────────────────────
function fakeRes() {
  return {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}
const REQ_USER = { session: { user: { username: 'ayse', role: 'User' } } };
const REQ_ADMIN = { session: { user: { username: 'admin', role: 'Admin' } } };

function withBrokenDb(fn) {
  const orig = db.query;
  db.query = async () => { throw new Error('DB erisilemez'); };
  vis.bumpVersion();  // memo/cache dusur ki gercekten DB'ye gidilsin
  return Promise.resolve(fn()).finally(() => { db.query = orig; vis.bumpVersion(); });
}

test('requireVisible: motor okunamazsa normal kullanici 503 ile REDDEDILIR (fail-closed)', async () => {
  await withBrokenDb(async () => {
    const res = fakeRes();
    let nextCalled = false;
    await vis.requireVisible('OpsX')(REQ_USER, res, () => { nextCalled = true; });
    assert.equal(nextCalled, false, 'erisim acilmamali');
    assert.equal(res.statusCode, 503);
  });
});

test('requireVisible: motor okunamasa da ADMIN gecebilir (kesintide portal onarilabilsin)', async () => {
  await withBrokenDb(async () => {
    const res = fakeRes();
    let nextCalled = false;
    await vis.requireVisible('OpsX')(REQ_ADMIN, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null);
  });
});

test('requireVisible: VISIBILITY_FAIL_OPEN=1 acil kacisi eski davranisa dondurur', async () => {
  const prev = process.env.VISIBILITY_FAIL_OPEN;
  process.env.VISIBILITY_FAIL_OPEN = '1';
  try {
    await withBrokenDb(async () => {
      const res = fakeRes();
      let nextCalled = false;
      await vis.requireVisible('OpsX')(REQ_USER, res, () => { nextCalled = true; });
      assert.equal(nextCalled, true);
    });
  } finally {
    if (prev === undefined) delete process.env.VISIBILITY_FAIL_OPEN;
    else process.env.VISIBILITY_FAIL_OPEN = prev;
  }
});

test('resolveVisibilitySoft(): motor okunamazsa UI icin bos harita doner (throw etmez)', async () => {
  await withBrokenDb(async () => {
    const out = await vis.resolveVisibilitySoft({ username: 'ayse', role: 'User' });
    assert.deepEqual(out.visibility, {});
  });
});
