// server/logx/v2/__tests__/ocp-cache-sweep.test.cjs
//
// Onbellekte "bu taramada gorulmeyenleri sil" adimi eskiden `namespace NOT IN ($4,$5,...)`
// ile yapiliyordu. Iki gercek arizasi vardi:
//   1) MSSQL tek sorguda EN FAZLA 2100 parametre kabul eder. 2097+ namespace'li bir
//      cluster'da tum yazim throw ediyordu; cagiran catch ile yutuyordu → onbellek
//      SESSIZCE bos kaliyor, kullanici hicbir hata gormuyordu.
//   2) Liste BOS geldiginde (`if (list.length)`) adim hic calismiyordu; tum objeleri
//      silinmis bir namespace, eski uygulamalari sonsuza dek listelemeye devam ediyordu.
// Cozum: olcut ad listesi degil, TUR BASLANGIC ZAMANI. Bu testler o sozlesmeyi korur.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../db/index.cjs');
const cache = require('../ocp-cache.cjs');
const cfgMod = require('../ocp-runtime-config.cjs');

// db.query'yi kaydeden bir sahte ile degistirir; SELECT GETUTCDATE() sabit bir zaman doner.
function withRecordingDb(fn, { updateRowCount = 1 } = {}) {
  const origQuery = db.query;
  const origCfg = cfgMod.getConfig;
  const calls = [];
  cfgMod.getConfig = async () => cfgMod.normalize({});
  db.query = async (sql, params) => {
    calls.push({ sql, params });
    if (/GETUTCDATE\(\) AS now_utc/i.test(sql)) return { rows: [{ now_utc: '2026-01-01T00:00:00.000Z' }] };
    if (/^\s*UPDATE/i.test(sql)) return { rows: [], rowCount: updateRowCount };
    return { rows: [], rowCount: 0 };
  };
  return Promise.resolve(fn(calls)).finally(() => { db.query = origQuery; cfgMod.getConfig = origCfg; });
}

const sweepOf = (calls, table) =>
  calls.find((c) => new RegExp(`UPDATE ${table} SET is_deleted=1`, 'i').test(c.sql));

test('putNamespaces(): silme taramasi PARAMETRE LISTESI degil ZAMAN DAMGASI kullanir', async () => {
  await withRecordingDb(async (calls) => {
    // 2500 namespace: eski `NOT IN` yaklasiminda 2503 parametre → MSSQL 2100 sinirini asardi.
    const namespaces = Array.from({ length: 2500 }, (_, i) => `ns-${i}`);
    await cache.putNamespaces({ env: 'prod', tenant: 'ark', clusterName: 'c1', namespaces });

    const sweep = sweepOf(calls, 'ocp_namespace_cache');
    assert.ok(sweep, 'silme taramasi calismali');
    assert.doesNotMatch(sweep.sql, /NOT IN/i, 'ad listesi ile filtreleme kalmamali');
    assert.match(sweep.sql, /fetched_at < \$4/, 'olcut tur baslangic zamani olmali');
    assert.equal(sweep.params.length, 4, `parametre sayisi namespace adedinden BAGIMSIZ olmali`);
    assert.equal(sweep.params[3], '2026-01-01T00:00:00.000Z', 'zaman DB sunucusundan alinmali');
  });
});

test('putNamespaces(): liste BOS gelse de silme taramasi calisir', async () => {
  await withRecordingDb(async (calls) => {
    await cache.putNamespaces({ env: 'prod', tenant: 'ark', clusterName: 'c1', namespaces: [] });
    assert.ok(sweepOf(calls, 'ocp_namespace_cache'), 'bosalan cluster icin de isaretleme yapilmali');
  });
});

test('putApps(): objesi kalmayan namespace icin de silme taramasi calisir', async () => {
  await withRecordingDb(async (calls) => {
    await cache.putApps({
      env: 'prod', tenant: 'ark',
      entries: [{ clusterName: 'c1', namespace: 'bosalan', status: 'ok', objects: [] }],
    });
    const sweep = sweepOf(calls, 'ocp_app_cache');
    assert.ok(sweep, 'bosalan namespace temizlenmeli');
    assert.match(sweep.sql, /fetched_at < \$5/);
  });
});

test('putApps(): kolona sigmayan uzun obje adi TUM yazimi dusurmez, sadece atlanir', async () => {
  await withRecordingDb(async (calls) => {
    const uzun = 'a'.repeat(200);   // app_name NVARCHAR(150)
    const r = await cache.putApps({
      env: 'prod', tenant: 'ark',
      entries: [{
        clusterName: 'c1', namespace: 'ns1', status: 'ok',
        objects: [
          { kind: 'Deployment', name: uzun, replicas: 1 },
          { kind: 'Deployment', name: 'normal-app', replicas: 2 },
        ],
      }],
    });
    assert.equal(r.written, 1, 'kisa adli obje yazilmali');
    assert.equal(r.skipped, 1, 'uzun adli obje atlanmali');
    const written = calls.filter((c) => /UPDATE ocp_app_cache\s+SET replicas/i.test(c.sql));
    assert.equal(written.length, 1);
    assert.equal(written[0].params[5], 'normal-app');
  });
});

test('putApps(): basarisiz namespace taramasi onbellege HIC yazilmaz', async () => {
  await withRecordingDb(async (calls) => {
    await cache.putApps({
      env: 'prod', tenant: 'ark',
      entries: [{ clusterName: 'c1', namespace: 'ns1', status: 'error', error: 'forbidden', objects: [] }],
    });
    // Yalniz GETUTCDATE() sorgusu calismali — yazim da silme taramasi da YOK.
    // (Aksi halde "bu namespace'te uygulama yok" gibi gorunur, kullanici yanilir.)
    assert.equal(sweepOf(calls, 'ocp_app_cache'), undefined, 'hatali tarama silme tetiklememeli');
    assert.equal(calls.filter((c) => /INSERT INTO ocp_app_cache/i.test(c.sql)).length, 0);
  });
});

test('putApps(): k8s creationTimestamp yazilir, bozuk tarih NULL olur', async () => {
  await withRecordingDb(async (calls) => {
    await cache.putApps({
      env: 'prod', tenant: 'ark',
      entries: [{
        clusterName: 'c1', namespace: 'ns1', status: 'ok',
        objects: [
          { kind: 'Deployment', name: 'a', created: '2025-03-04T10:00:00Z' },
          { kind: 'Deployment', name: 'b', created: 'bozuk-tarih' },
        ],
      }],
    });
    const writes = calls.filter((c) => /UPDATE ocp_app_cache\s+SET replicas/i.test(c.sql));
    assert.equal(writes.length, 2);
    assert.ok(writes[0].params[9] instanceof Date, 'gecerli tarih Date olarak baglanmali');
    assert.equal(writes[1].params[9], null, 'bozuk tarih NULL olmali (yazim dusmemeli)');
  });
});
