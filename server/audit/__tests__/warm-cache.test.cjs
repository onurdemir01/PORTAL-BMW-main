// server/audit/__tests__/warm-cache.test.cjs — WC1..WC3 (2026-09-21).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWarmCache } = require('../warm-cache.cjs');
const quiet = { warn() {}, log() {} };

test('WC1: ilk istek hesabi bekler, sonrakiler aninda doner; ayni anda gelenler tek hesap paylasir', async () => {
  let n = 0;
  const c = createWarmCache({ name: 't', ttlMs: 60000, compute: async () => { n += 1; await new Promise((r) => setTimeout(r, 20)); return { ok: true, n }; }, log: quiet });
  const [a, b] = await Promise.all([c.get(), c.get()]);
  assert.equal(n, 1); assert.equal(a.n, 1); assert.equal(b.n, 1);
  assert.equal(a._cache.stale, false);
  const d = await c.get(); assert.equal(n, 1); assert.equal(d.n, 1);
});

test('WC2: suresi dolunca bayat deger ANINDA doner, arka planda yenilenir', async () => {
  let n = 0;
  const c = createWarmCache({ name: 't', ttlMs: 10, compute: async () => { n += 1; return { ok: true, n }; }, log: quiet });
  await c.get();
  await new Promise((r) => setTimeout(r, 25));
  const stale = await c.get();
  assert.equal(stale.n, 1); assert.equal(stale._cache.stale, true);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await c.get()).n, 2);
});

test('WC3: fresh=1 hesabi bekler ve yeni degeri doner', async () => {
  let n = 0;
  const c = createWarmCache({ name: 't', ttlMs: 60000, compute: async () => ({ ok: true, n: ++n }), log: quiet });
  await c.get();
  assert.equal((await c.get({ fresh: true })).n, 2);
});
