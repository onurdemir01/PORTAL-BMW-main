// server/ansible/__tests__/ocp-catalog-merge.test.cjs — Katalog birlestirme (dual-write).
// EN KRITIK GARANTI: tenant'i olmayan kayitlar ortak agaca PASIF aynalanir; aksi halde
// LogX/OpsX/Telnet sihirbazlarinda '_atanmadi' altinda sahte cluster'lar belirirdi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../db/index.cjs');
const store = require('../ocp-store.cjs');

// db.query'yi yakalayan basit bir kayit defteri. `existing` true ise legacy_id
// sorgusu dolu doner (UPDATE yolu), aksi halde bos (INSERT yolu).
function withCapture(fn, { existing = false } = {}) {
  const calls = [];
  const orig = db.query;
  db.query = async (sql, params) => {
    calls.push({ sql, params });
    if (/SELECT id FROM ocp_cluster_index WHERE legacy_id/i.test(sql)) {
      return { rows: existing ? [{ id: 7 }] : [] };
    }
    return { rows: [], rowCount: 1 };
  };
  return Promise.resolve(fn(calls)).finally(() => { db.query = orig; });
}

const BASE = {
  id: 'abc-123', name: 'gbocpqa1', display: 'QA 1', env: 'qa',
  apiUrl: 'https://api', consoleUrl: '', token: 't', description: '', namespace: 'ns',
  jumpHost: 'jump01', isActive: true, createdBy: 'admin',
};

test('tenant YOKSA ayna satiri PASIF (is_active=0) ve _atanmadi tenant ile yazilir', async () => {
  await withCapture(async (calls) => {
    await store._mirrorToIndex({ ...BASE, tenant: '' });
    const ins = calls.find((c) => /INSERT INTO ocp_cluster_index/i.test(c.sql));
    assert.ok(ins, 'INSERT calismali');
    assert.equal(ins.params[1], store.UNASSIGNED_TENANT);
    assert.equal(ins.params[ins.params.length - 1], 0, 'is_active 0 olmali (sihirbaz agacina sizmasin)');
  });
});

test('tenant VARSA ayna satiri aktif yazilir ve jump_host terminal_host olur', async () => {
  await withCapture(async (calls) => {
    await store._mirrorToIndex({ ...BASE, tenant: 'ark' });
    const ins = calls.find((c) => /INSERT INTO ocp_cluster_index/i.test(c.sql));
    assert.equal(ins.params[1], 'ark');
    assert.equal(ins.params[2], 'gbocpqa1');
    assert.equal(ins.params[3], 'jump01', 'jumpHost -> terminal_host olarak tasinmali');
    assert.equal(ins.params[ins.params.length - 1], 1);
  });
});

test('ayni legacy_id ikinci kez aynalanirsa INSERT degil UPDATE yapilir (idempotent)', async () => {
  await withCapture(async (calls) => {
    await store._mirrorToIndex({ ...BASE, tenant: 'ark' });
    assert.ok(calls.some((c) => /UPDATE ocp_cluster_index/i.test(c.sql)), 'UPDATE bekleniyor');
    assert.ok(!calls.some((c) => /INSERT INTO ocp_cluster_index/i.test(c.sql)), 'INSERT olmamali');
  }, { existing: true });
});

test('jumpHost bossa terminal_host NULL yazilir (tenant/env yedegi devrede kalsin)', async () => {
  await withCapture(async (calls) => {
    await store._mirrorToIndex({ ...BASE, tenant: 'ark', jumpHost: '' });
    const ins = calls.find((c) => /INSERT INTO ocp_cluster_index/i.test(c.sql));
    assert.equal(ins.params[3], null);
  });
});
