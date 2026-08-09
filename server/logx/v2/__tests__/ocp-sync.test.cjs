// server/logx/v2/__tests__/ocp-sync.test.cjs — Periyodik onbellek besleme job'i.
// EN KRITIK GARANTI: job VARSAYILAN KAPALI. Yanlislikla acik gelirse portal her acilista
// AWX'te job kosturmaya baslar — bu, kimsenin istemedigi bir yan etkidir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../db/index.cjs');
const cfgMod = require('../ocp-runtime-config.cjs');
const sync = require('../ocp-sync.cjs');

function withConfig(cfg, fn) {
  const orig = cfgMod.getConfig;
  cfgMod.getConfig = async () => cfg;
  return Promise.resolve(fn()).finally(() => { cfgMod.getConfig = orig; });
}

test('runOnce(): varsayilan yapilandirmada CALISMAZ (opt-in)', async () => {
  await withConfig(cfgMod.normalize({}), async () => {
    const r = await sync.runOnce();
    assert.equal(r.skipped, true);
    assert.equal(r.reason, 'disabled', 'varsayilan periodicSyncEnabled=false olmali');
  });
});

test('runOnce(): LOGX_OCP_SYNC_DISABLED=1 acil kacisi acik yapilandirmayi da durdurur', async () => {
  const prev = process.env.LOGX_OCP_SYNC_DISABLED;
  process.env.LOGX_OCP_SYNC_DISABLED = '1';
  try {
    await withConfig(cfgMod.normalize({ periodicSyncEnabled: true }), async () => {
      const r = await sync.runOnce();
      assert.equal(r.reason, 'disabled');
    });
  } finally {
    if (prev === undefined) delete process.env.LOGX_OCP_SYNC_DISABLED;
    else process.env.LOGX_OCP_SYNC_DISABLED = prev;
  }
});

test('runOnce(): acikken taranacak cluster yoksa sessizce biter', async () => {
  const orig = db.query;
  db.query = async () => ({ rows: [] });
  try {
    await withConfig(cfgMod.normalize({ periodicSyncEnabled: true }), async () => {
      const r = await sync.runOnce();
      assert.equal(r.skipped, true);
      assert.equal(r.reason, 'no_clusters');
    });
  } finally { db.query = orig; }
});

test('listSyncableClusters(): metadata\'si EKSIK cluster\'lari sorguya dahil etmez', async () => {
  let captured = '';
  const orig = db.query;
  db.query = async (sql) => { captured = sql; return { rows: [] }; };
  try {
    await sync.listSyncableClusters(10);
    assert.match(captured, /is_active = 1/, 'yalniz aktif cluster taranmali');
    assert.match(captured, /api_url IS NOT NULL/, 'api_url eksikse taranmamali');
    assert.match(captured, /vault_credential_key IS NOT NULL/, 'credential anahtari eksikse taranmamali');
    assert.match(captured, /last_synced_at ASC/, 'en eski senkronlanan once gelmeli');
  } finally { db.query = orig; }
});
