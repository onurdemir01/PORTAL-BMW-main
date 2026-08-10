// server/logx/v2/__tests__/ocp-app-scan-log.test.cjs — "tarandi ama BOS cikti" kaydi.
//
// GERCEK SIKAYET (2026-08-10, kullanici): bazi namespace'lerin ICI GERCEKTEN BOS. Sihirbaz
// envanterde/onbellekte uygulama gormedigi icin SORMADAN tarama baslatiyordu; tarama bos
// donunce `ocp_app_cache`'e HICBIR satir yazilmiyor, `getApps` de "onbellekte var mi"yi
// `rows.length > 0` ile olctugu icin sonuc "hic taranmamis"tan ayirt edilemiyordu. Boylece
// ayni namespace'e her girişte (ve HER kullanici icin) yeniden ~1 dk'lik AWX job'i
// aciliyor, kullaniciya hep ayni "kayit yok" cumlesi gosteriliyordu.
//
// Cozum: taramanin KENDISI kaydedilir (ocp_app_scan_log), bos sonuc da bir kayittir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../db/index.cjs');
const cache = require('../ocp-cache.cjs');
const cfgMod = require('../ocp-runtime-config.cjs');

function withDb(handler, fn) {
  const origQuery = db.query;
  const origCfg = cfgMod.getConfig;
  const calls = [];
  cfgMod.getConfig = async () => cfgMod.normalize({});
  db.query = async (sql, params) => {
    calls.push({ sql, params });
    if (/GETUTCDATE\(\) AS now_utc/i.test(sql)) return { rows: [{ now_utc: '2026-01-01T00:00:00.000Z' }] };
    return handler(sql, params) ?? { rows: [], rowCount: 0 };
  };
  return Promise.resolve(fn(calls)).finally(() => { db.query = origQuery; cfgMod.getConfig = origCfg; });
}

test('putAppScan(): BOS sonuc da yazilir (app_count = 0)', async () => {
  await withDb(() => ({ rows: [], rowCount: 0 }), async (calls) => {
    await cache.putAppScan({
      env: 'prod', tenant: 'ark',
      entries: [{ clusterName: 'c1', namespace: 'bos-ns', status: 'ok', objects: [] }],
    });
    const insert = calls.find((c) => /INSERT INTO ocp_app_scan_log/i.test(c.sql));
    assert.ok(insert, 'bos tarama da KAYDEDILMELI — aksi halde her girişte yeniden taranir');
    assert.equal(insert.params[3], 'bos-ns');
    assert.equal(insert.params[4], 0);
  });
});

test('putAppScan(): BASARISIZ tarama kaydedilmez ("bos" demek yaniltici olurdu)', async () => {
  await withDb(() => ({ rows: [], rowCount: 0 }), async (calls) => {
    await cache.putAppScan({
      env: 'prod', tenant: 'ark',
      entries: [{ clusterName: 'c1', namespace: 'ns1', status: 'error', objects: [] }],
    });
    assert.equal(calls.filter((c) => /ocp_app_scan_log/i.test(c.sql)).length, 0);
  });
});

test('getApps(): tarandi + bos → scannedEmpty true (sihirbaz otomatik taramaz)', async () => {
  await withDb((sql) => {
    if (/FROM ocp_app_cache/i.test(sql)) return { rows: [] };
    if (/FROM ocp_app_scan_log/i.test(sql)) {
      return { rows: [{ app_count: 0, scanned_at: '2026-08-10T09:00:00.000Z' }] };
    }
    return { rows: [], rowCount: 0 };
  }, async () => {
    const out = await cache.getApps({ env: 'prod', tenant: 'ark', clusterName: 'c1', namespace: 'bos-ns' });
    assert.deepEqual(out.items, []);
    assert.equal(out.cached, false, 'cached sozlesmesi DEGISMEMELI (mevcut akislar buna bakiyor)');
    assert.equal(out.scannedEmpty, true);
    assert.equal(new Date(out.scannedAt).toISOString(), '2026-08-10T09:00:00.000Z');
  });
});

test('getApps(): HIC taranmamis namespace scannedEmpty=false (otomatik tarama surer)', async () => {
  await withDb((sql) => {
    if (/FROM ocp_app_scan_log/i.test(sql)) return { rows: [] };
    return { rows: [], rowCount: 0 };
  }, async () => {
    const out = await cache.getApps({ env: 'prod', tenant: 'ark', clusterName: 'c1', namespace: 'yeni-ns' });
    assert.equal(out.scannedEmpty, false);
    assert.equal(out.scannedAt, null);
  });
});

test('getApps(): tarama kaydi tablosu YOKSA (eski kurulum) akis durmaz', async () => {
  await withDb((sql) => {
    if (/FROM ocp_app_scan_log/i.test(sql)) throw new Error("Invalid object name 'ocp_app_scan_log'.");
    if (/FROM ocp_app_cache/i.test(sql)) return { rows: [{ kind: 'Deployment', app_name: 'a', replicas: 1, fetched_at: null, expires_at: null, source: 'discovery' }] };
    return { rows: [], rowCount: 0 };
  }, async () => {
    const out = await cache.getApps({ env: 'prod', tenant: 'ark', clusterName: 'c1', namespace: 'ns1' });
    assert.equal(out.items.length, 1, 'uygulama listesi tarama kaydi olmadan da donmeli');
    assert.equal(out.scannedAt, null);
  });
});
