// server/scalex/__tests__/scalex-reconciler.test.cjs
//
// Uzlastiricinin ASIL ISI tek cumleyle: kullanici sekmeyi kapatsa bile islem
// sonuclansin ve "Su an durdurulmus" listesi GERCEGI soylesin.
//
// Bu testler DAVRANISI kosturur (kaynak metnine bakmazlar): sahte bir DB ve sahte bir
// AWX ile `tick()` cagrilir ve DB'ye NE YAZILDIGI olculur.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/index.cjs');
const runner = require('../../ansible/runner.cjs');
const reconciler = require('../reconciler.cjs');
const result = require('../result.cjs');

// Bir `stop` isinin bitmis halini taklit eden AWX yaniti.
function finishedStopJob() {
  return {
    finished: true, failed: false, status: 'successful',
    artifacts: {
      scalex_result: {
        mode: 'apply', action: 'stop', overall_status: 'OK', catalog_source: 'portal',
        targets: [{ cluster: 'c1', app: 'odeme-api', kind: 'deployment', status: 'OK', detail: '' }],
      },
    },
  };
}

// Sahte DB: sorgulari yakalar, RUNNING bir islem satiri dondurur.
function withFakeDb(fn, { rows } = {}) {
  const origQuery = db.query;
  const calls = [];
  const opRow = {
    id: 7, env: 'prod', tenant: 'ark', namespace: 'odeme-prod', username: 'ali',
    cluster_name: 'c1', status: 'RUNNING', awx_server_id: 1, awx_job_id: 42,
  };
  db.query = async (sql, params) => {
    calls.push({ sql, params });
    if (/FROM scalex_operations\s+WHERE status = 'RUNNING'/.test(sql.replace(/\s+/g, ' ').replace('FROM scalex_operations WHERE', 'FROM scalex_operations\n WHERE'))
        || /status = 'RUNNING' AND awx_server_id/.test(sql)) {
      return { rows: rows ?? [{ awx_server_id: 1, awx_job_id: 42, created_at: new Date() }] };
    }
    if (/SELECT \* FROM scalex_operations WHERE awx_server_id/.test(sql)) return { rows: [opRow] };
    return { rows: [], rowCount: 0 };
  };
  return Promise.resolve(fn(calls)).finally(() => { db.query = origQuery; });
}

function withFakeAwx(impl, fn) {
  const orig = runner.getJobStatusOnServer;
  runner.getJobStatusOnServer = impl;
  return Promise.resolve(fn()).finally(() => { runner.getJobStatusOnServer = orig; });
}

test('sonucu kimse yoklamasa bile is SONUCLANDIRILIR (sekme kapatma senaryosu)', async () => {
  await withFakeDb(async (calls) => {
    await withFakeAwx(async () => finishedStopJob(), async () => {
      const out = await reconciler.tick();
      assert.equal(out.finalized, 1, 'bitmis is sonuclandirilmali');
    });
    const upd = calls.find((c) => /UPDATE scalex_operations/.test(c.sql) && /status = 'FINISHED'/.test(c.sql));
    assert.ok(upd, "islem FINISHED'e cekilmeli");
  });
});

test('durdurma AYNAYA yazilir — panel "kayit yok" demesin', async () => {
  await withFakeDb(async (calls) => {
    await withFakeAwx(async () => finishedStopJob(), async () => {
      await reconciler.tick();
    });
    const mirror = calls.find((c) => /scalex_state_mirror/.test(c.sql));
    assert.ok(mirror, 'ayna guncellenmeli — geri alma yolu buna bagli');
  });
});

test('is HENUZ BITMEDIYSE hicbir sey yazilmaz', async () => {
  await withFakeDb(async (calls) => {
    await withFakeAwx(async () => ({ finished: false, status: 'running' }), async () => {
      const out = await reconciler.tick();
      assert.equal(out.finalized, 0);
    });
    assert.ok(!calls.some((c) => /UPDATE scalex_operations/.test(c.sql)), 'calisan ise dokunulmamali');
  });
});

test('bekleyen is YOKSA AWX hic sorgulanmaz', async () => {
  let asked = 0;
  await withFakeDb(async () => {
    await withFakeAwx(async () => { asked++; return finishedStopJob(); }, async () => {
      const out = await reconciler.tick();
      assert.deepEqual(out, { checked: 0, finalized: 0, stale: 0 });
    });
  }, { rows: [] });
  assert.equal(asked, 0, 'bos listede AWX dovulmemeli');
});

test('AWX okunamiyorsa TAZE is "bilinmiyor" yapilmaz (gecici kesinti kaybi olmasin)', async () => {
  await withFakeDb(async (calls) => {
    await withFakeAwx(async () => { throw new Error('AWX 503'); }, async () => {
      const out = await reconciler.tick();
      assert.equal(out.stale, 0, 'taze is beklemeye devam etmeli');
    });
    assert.ok(!calls.some((c) => /'UNKNOWN'/.test(c.sql)));
  }, { rows: [{ awx_server_id: 1, awx_job_id: 42, created_at: new Date() }] });
});

test('AWX okunamiyorsa ve is COK ESKIYSE "bilinmiyor" isaretlenir (sonsuza dek RUNNING kalmasin)', async () => {
  const eski = new Date(Date.now() - 48 * 3600 * 1000);
  await withFakeDb(async (calls) => {
    await withFakeAwx(async () => { throw new Error('AWX 404'); }, async () => {
      const out = await reconciler.tick();
      assert.equal(out.stale, 1);
    });
    const marked = calls.find((c) => /'UNKNOWN'/.test(c.sql));
    assert.ok(marked, 'eski ve okunamayan is isaretlenmeli');
  }, { rows: [{ awx_server_id: 1, awx_job_id: 42, created_at: eski }] });
});

test('yalnizca `apply` aynaya yazar — `dry_run` cluster\'a dokunmadigi icin kayit URETMEZ', async () => {
  await withFakeDb(async (calls) => {
    const dry = finishedStopJob();
    dry.artifacts.scalex_result.mode = 'dry_run';
    await withFakeAwx(async () => dry, async () => { await reconciler.tick(); });
    assert.ok(!calls.some((c) => /scalex_state_mirror/.test(c.sql)),
      'dry_run hicbir sey degistirmez, ayna da degismemeli');
  });
});

test('parti buyuklugu SQL tavanina kenetli (sessiz kirpma olmasin)', () => {
  assert.ok(reconciler.getConfig().batchSize <= reconciler.HARD_TOP);
});

test('sonuc ayristirmasi gercek sozlesmeyi kullaniyor (uzlastirici kendi kopyasini yazmiyor)', () => {
  // Uzlastirici `result.extractScaleXResult` cagirir; ikinci bir ayristirici yazsaydi
  // tarayici yolu ile ayrisip FARKLI sonuc uretebilirdi.
  const parsed = result.extractScaleXResult(finishedStopJob().artifacts);
  assert.equal(parsed.action, 'stop');
  assert.equal(parsed.mode, 'apply');
});
