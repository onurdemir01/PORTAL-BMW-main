// server/chaos/__tests__/chaos-validation.test.cjs — MERGE ONCESI DOGRULAMA SUITI.
//
// Amac: `server/chaos/*` ve ona bagli degisikliklerde, "calisiyor gibi gorunup sessizce
// yanlis davranan" seyleri yakalamak. Her test bir SORU sorar ve cevabini kaynaktan ya da
// gercek fonksiyondan alir — hicbiri "kod boyle yazilmis" demez.
//
// Bolumler: A) sozlesme  B) yetki/guvenlik  C) SQL  D) kapi  E) girdi dogrulamasi
//           F) durum/sapma  G) uc yuzeyi  H) portal↔playbook sozlesmesi
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const db = require('../../db/index.cjs');
const result = require('../result.cjs');
const launch = require('../launch.cjs');
const state = require('../state.cjs');

const SRC_DIR = path.join(__dirname, '..');
const src = (f) => fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
const INDEX = src('index.cjs');
const CATALOG = src('catalog.cjs');
const LAUNCH = src('launch.cjs');
const STATE = src('state.cjs');

// Yorum satirlarini at: testler kendi ACIKLAMALARIYLA eslesmemeli (bu depoda daha once
// tam olarak bu hata yapildi).
const codeOnly = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

function withDb(handler, fn) {
  const orig = db.query;
  const calls = [];
  db.query = async (sql, params) => { calls.push({ sql, params }); return handler(sql, params) || { rows: [], rowCount: 0 }; };
  return Promise.resolve(fn(calls)).finally(() => { db.query = orig; });
}

// ── A. SONUC SOZLESMESI ─────────────────────────────────────────────────────

test('A1 artifact: dogrudan anahtar', () => {
  assert.equal(result.extractChaosResult({ chaos_scale_result: { overall_status: 'OK' } }).overallStatus, 'OK');
});
test('A2 artifact: data.<key>', () => {
  assert.equal(result.extractChaosResult({ data: { chaos_scale_result: { overall_status: 'OK' } } }).overallStatus, 'OK');
});
test('A3 artifact: ansible_stats.data.<key>', () => {
  assert.equal(result.extractChaosResult({ ansible_stats: { data: { chaos_scale_result: { overall_status: 'OK' } } } }).overallStatus, 'OK');
});
test('A4 artifact: JSON string', () => {
  assert.equal(result.extractChaosResult({ chaos_scale_result: '{"overall_status":"WARN"}' }).overallStatus, 'WARN');
});
test('A5 artifact: <key>_json alani', () => {
  assert.equal(result.extractChaosResult({ chaos_scale_result_json: '{"overall_status":"FAIL"}' }).overallStatus, 'FAIL');
});
test('A6 artifact: bozuk JSON null doner, patlamaz', () => {
  assert.equal(result.extractChaosResult({ chaos_scale_result: '{bozuk' }), null);
});
test('A7 artifact: bos string null doner', () => {
  assert.equal(result.extractChaosResult({ chaos_scale_result: '   ' }), null);
});
test('A8 artifact: null/undefined girdi', () => {
  assert.equal(result.extractChaosResult(null), null);
  assert.equal(result.extractChaosResult(undefined), null);
});
test('A9 overall_status bosluklu + kucuk harf normalize', () => {
  assert.equal(result.extractChaosResult({ chaos_scale_result: { overall_status: '  warn ' } }).overallStatus, 'WARN');
});
test('A10 hedef durumlari da normalize', () => {
  const r = result.extractChaosResult({ chaos_scale_result: { targets: [{ status: ' fail ' }] } });
  assert.equal(r.targets[0].status, 'FAIL');
});
test('A11 sayaclar Jinja STRING gelse de sayiya cevrilir', () => {
  const r = result.extractChaosResult({ chaos_scale_result: { counts: { planned: '6', ok: '5', fail: '1' } } });
  assert.deepEqual([r.counts.planned, r.counts.ok, r.counts.fail], [6, 5, 1]);
});
test('A12 sayac eksikse 0, NaN degil', () => {
  const r = result.extractChaosResult({ chaos_scale_result: {} });
  for (const [k, v] of Object.entries(r.counts)) assert.equal(v, 0, k);
});
test('A13 strict_blocked Jinja True/true/boolean ucu de tanini', () => {
  for (const v of [true, 'True', 'true']) {
    assert.equal(result.extractChaosResult({ chaos_scale_result: { strict_blocked: v } }).strictBlocked, true, String(v));
  }
});
test('A14 strict_blocked False/false/eksik → false', () => {
  for (const v of [false, 'False', 'false', undefined]) {
    assert.equal(result.extractChaosResult({ chaos_scale_result: { strict_blocked: v } }).strictBlocked, false, String(v));
  }
});
test('A15 truncated bayraklari Jinja True stringini de tanimali', () => {
  // Jinja bool'u `set_stats` uzerinden "True" olarak gelebilir; `=== true` bunu KACIRIR.
  const r = result.extractChaosResult({ chaos_scale_result: { rows_truncated: 'True', targets_truncated: 'True' } });
  assert.equal(r.rowsTruncated, true, 'rows_truncated "True" tanninmali');
  assert.equal(r.targetsTruncated, true, 'targets_truncated "True" tanninmali');
});
test('A16 validation bicimi ayni sekle indirgenir', () => {
  const r = result.extractChaosResult({ chaos_scale_result: { stage: 'validation', validation_error: 'x', failed_task: 't' } });
  assert.equal(r.stage, 'validation');
  assert.equal(r.validationError, 'x');
  assert.equal(r.failedTask, 't');
});
test('A17 stage yoksa varsayilan execution', () => {
  assert.equal(result.extractChaosResult({ chaos_scale_result: {} }).stage, 'execution');
});
test('A18 catalog_source varsayilani file (guvenli taraf)', () => {
  assert.equal(result.extractChaosResult({ chaos_scale_result: {} }).catalogSource, 'file');
});
test('A19 target_replicas bos string null olur', () => {
  assert.equal(result.extractChaosResult({ chaos_scale_result: { target_replicas: '' } }).targetReplicas, null);
});
test('A20 diziler dizi olmayan degerle gelirse bos diziye duser', () => {
  const r = result.extractChaosResult({ chaos_scale_result: { clusters: 'x', apps: null, targets: 'y', rows: 5 } });
  assert.deepEqual([r.clusters, r.apps, r.targets, r.rows], [[], [], [], []]);
});

// ── Kesif sozlesmesi ────────────────────────────────────────────────────────

const disc = (o) => result.extractDiscoveryResult({ chaos_discovery_result: o });

test('A21 kesif: workload alanlari ayrisir', () => {
  const r = disc({ mode: 'workloads', items: [{ app: 'a', kind: 'Deployment', step: 'WORKLOAD', status: 'OK',
    detail: 'resource=deploy spec=3 status=3 ready=2 hpa=yes state_phase=- previous_replicas=- image=reg/x:1' }] });
  assert.deepEqual(
    [r.workloads[0].specReplicas, r.workloads[0].readyReplicas, r.workloads[0].hasHpa, r.workloads[0].image],
    [3, 2, true, 'reg/x:1']
  );
});
test('A22 kesif: imaj `/` ve `:` iceriyor — parseDetailPairs bozulmamali', () => {
  const p = result.parseDetailPairs('image=registry.gar.com.tr:5000/team/app:1.2.3-rc');
  assert.equal(p.image, 'registry.gar.com.tr:5000/team/app:1.2.3-rc');
});
test('A23 kesif: ISO zaman damgasi `:` iceriyor', () => {
  const p = result.parseDetailPairs('created_at=2026-08-28T10:00:00Z created_by=ali');
  assert.equal(p.created_at, '2026-08-28T10:00:00Z');
  assert.equal(p.created_by, 'ali');
});
test('A24 kesif: restorable yalnizca sayisal previous_replicas ile true', () => {
  const yes = disc({ mode: 'workloads', items: [{ app: 'a', step: 'WORKLOAD', status: 'OK', detail: 'previous_replicas=2' }] });
  const no = disc({ mode: 'workloads', items: [{ app: 'b', step: 'WORKLOAD', status: 'OK', detail: 'previous_replicas=-' }] });
  assert.equal(yes.workloads[0].restorable, true);
  assert.equal(no.workloads[0].restorable, false);
});
test('A25 kesif: previous_replicas=0 GECERLI bir geri alma hedefidir', () => {
  // 0 falsy'dir; `prev !== null` yerine truthiness kullanilsa bu kayit "geri alinamaz"
  // gorunur ve kullanici gercekten kayitli bir durumu geri ALAMAZ.
  const r = disc({ mode: 'workloads', items: [{ app: 'a', step: 'WORKLOAD', status: 'OK', detail: 'previous_replicas=0' }] });
  assert.equal(r.workloads[0].restorable, true);
  assert.equal(r.workloads[0].previousReplicas, 0);
});
test('A26 kesif: FAIL satirlari workloads listesine GIRMEZ', () => {
  const r = disc({ mode: 'workloads', items: [{ app: 'a', step: 'WORKLOAD', status: 'FAIL', detail: 'x' }] });
  assert.equal((r.workloads || []).length, 0);
});
test('A27 kesif: problems FAIL ve WARN satirlarini toplar', () => {
  const r = disc({ mode: 'workloads', items: [
    { cluster: 'c1', step: 'RUNNER', status: 'FAIL', detail: 'ssh' },
    { cluster: 'c1', step: 'RBAC', status: 'WARN', detail: 'izin' },
    { cluster: 'c1', step: 'WORKLOAD', status: 'OK', detail: 'x' },
  ] });
  assert.equal(r.problems.length, 2);
});
test('A28 kesif: state modu alanlari', () => {
  const r = disc({ mode: 'state', items: [{ app: 'a', kind: 'Deployment', step: 'STATE', status: 'OK',
    detail: 'cm=chaos-scale-state-a previous_replicas=2 phase=scaled_down created_at=2026-08-28T10:00:00Z created_by=ali job_id=5' }] });
  assert.deepEqual(
    [r.states[0].previousReplicas, r.states[0].phase, r.states[0].createdBy, r.states[0].jobId],
    [2, 'scaled_down', 'ali', '5']
  );
});
test('A29 kesif: durumlar KUCUK harf (mutasyon sonucundan farkli)', () => {
  assert.equal(disc({ overall_status: ' Partial ' }).overallStatus, 'partial');
});
test('A30 kesif: artifact yoksa null', () => {
  assert.equal(result.extractDiscoveryResult({}), null);
});

// ── B. YETKI / GUVENLIK ─────────────────────────────────────────────────────

test('B1 her mutasyon ucu resolveScope\'tan geciyor', () => {
  // `resolveScope` cluster varligi + namespace + uygulama yetkisini DOGRULAR. Bir uc
  // onu atlarsa, client istedigi namespace'i gonderip yetki kapisini bypass eder.
  const code = codeOnly(INDEX);
  for (const route of ['/discover', '/preview', '/run', '/adopt']) {
    const i = code.indexOf(`router.post('${route}'`) >= 0 ? code.indexOf(`router.post('${route}'`) : code.indexOf(`router.post("${route}"`);
    assert.ok(i > 0, `${route} bulunamadi`);
    const body = code.slice(i, i + 1800);
    assert.match(body, /resolveScope\(req/, `${route} resolveScope cagirmiyor — yetki kapisi atlanir`);
  }
});

test('B2 is-durumu uclari denyIfNotOwner tasiyor (IDOR)', () => {
  const code = codeOnly(INDEX);
  for (const route of ['/discover/:serverId/:jobId/status', '/run/:serverId/:jobId/status', '/cancel/:serverId/:jobId']) {
    const i = Math.max(code.indexOf(`'${route}'`), code.indexOf(`"${route}"`));
    assert.ok(i > 0, `${route} bulunamadi`);
    assert.match(code.slice(i, i + 900), /denyIfNotOwner/, `${route} sahiplik denetimi yapmiyor`);
  }
});

test('B3 denyIfNotOwner DB hatasinda FAIL-CLOSED (503)', () => {
  assert.match(codeOnly(INDEX), /catch[\s\S]{0,220}status:\s*503/, 'sahiplik sorgusu dusunce erisim ACILMAMALI');
});

test('B4 router requireAuth ve gorunurluk kapisi tasiyor', () => {
  const code = codeOnly(INDEX);
  assert.match(code, /router\.use\(requireAuth\)/);
  assert.match(code, /requireVisiblePrefix\('Chaos Scale'\)/);
});

test('B5 auth modulu yuklenemezse varsayilan DENY', () => {
  assert.match(codeOnly(INDEX), /requireAuth\s*=\s*\(req,\s*res\)\s*=>\s*res\.status\(401\)/);
});

test('B6 /stopped ve /history yetki suzgeci tasiyor', () => {
  const code = codeOnly(INDEX);
  const stopped = code.slice(code.indexOf("'/stopped'"), code.indexOf("'/stopped'") + 900);
  // `/stopped` yalnizca env+tenant aliyor; namespace bazli kisit UYGULANMIYORSA
  // kisitli bir namespace'in ADI ve durdurulmus uygulamalari sizar.
  assert.match(stopped, /filterAllowed|assertAllowed|isAllowed|filterStoppedForUser/,
    '/stopped yetki suzgeci uygulamiyor — kisitli namespace adlari sizar');
  const hist = code.slice(code.indexOf("'/history'"), code.indexOf("'/history'") + 700);
  assert.match(hist, /isAdmin/, '/history admin olmayan kullaniciyi kendi kayitlariyla sinirlamali');
});

test('B7 gateVars yalnizca sunucu ureticisinden gelir, req.body\'den DEGIL', () => {
  const code = codeOnly(INDEX);
  assert.match(code, /gateVars\s*=\s*launch\.buildGateVars\(/);
  assert.ok(!/gateVars:\s*req\.body/.test(code), 'client gateVars gonderemez');
});

test('B8 onay kutulari sunucuda uretilir, client\'tan alinmaz', () => {
  const code = codeOnly(LAUNCH) + codeOnly(INDEX);
  for (const key of ['change_confirmation', 'bulk_change_confirmation']) {
    assert.ok(!new RegExp(`${key}:\\s*(req\\.body|body\\.)`).test(code), `${key} client'tan aliniyor`);
  }
  assert.match(codeOnly(LAUNCH), /change_confirmation:\s*executionMode === 'apply'/);
});

test('B9 yazili onay namespace ile BIREBIR eslesmeli', () => {
  assert.match(codeOnly(INDEX), /writtenConfirm[^\n]*\.trim\(\)\s*!==\s*namespace/,
    'yazili onay serbest metin kabul ediyorsa hicbir sey dogrulamiyor');
});

test('B10 mail adresi oturumdan, client\'tan DEGIL', () => {
  const code = codeOnly(INDEX);
  assert.match(code, /mailTo\s*=\s*String\(user\.mail/);
  assert.ok(!/mailTo\s*=\s*String\(req\.body/.test(code), 'client rapor alicisini secemez');
});

test('B11 katalogda PAROLA yok, yalnizca vault degisken ADI', () => {
  const cat = launch.buildChaosClusterCatalog({
    env: 'prod', tenant: 'ark', clusters: ['c1'], hosts: { c1: 'j1' },
    meta: { c1: { api_url: 'https://a:6443', vault_credential_key: 'uxmid_gar' } },
  });
  const s = JSON.stringify(cat);
  for (const bad of ['password', 'parola', 'secret']) assert.ok(!s.toLowerCase().includes(bad), bad);
  assert.equal(cat.clusters.c1.credential, 'uxmid_gar');
});

test('B12 vault anahtari on kontrolu calistirma yolunda cagriliyor', () => {
  assert.match(codeOnly(LAUNCH), /assertVaultKeysKnownOrThrow\(meta\)/);
});

test('B13 JOB_OWNER_CACHE sinirli ve FIFO siliyor', () => {
  const code = codeOnly(INDEX);
  assert.match(code, /JOB_OWNER_MAX/);
  assert.match(code, /JOB_OWNER_CACHE\.delete\(JOB_OWNER_CACHE\.keys\(\)\.next\(\)\.value\)/);
});

// ── C. SQL ──────────────────────────────────────────────────────────────────

function paramCount(sql) {
  const m = sql.match(/\$\d+/g) || [];
  return new Set(m).size;
}
function maxParam(sql) {
  const m = sql.match(/\$(\d+)/g) || [];
  return m.reduce((a, x) => Math.max(a, Number(x.slice(1))), 0);
}

test('C1 chaos_scale_operations INSERT: yer tutucu sayisi = parametre sayisi', () => {
  const code = codeOnly(INDEX);
  const i = code.indexOf('INSERT INTO chaos_scale_operations');
  assert.ok(i > 0);
  const stmt = code.slice(i, code.indexOf(');', i));
  const cols = (stmt.match(/\(([^)]*)\)\s*\n?\s*VALUES/) || [])[1] || '';
  const colCount = cols.split(',').filter((c) => c.trim()).length;
  // VALUES listesinde her sutunun karsiligi var mi? Bir sutun SABIT deger de alabilir
  // (`status` icin 'RUNNING'), o yuzden yer tutucu sayisi degil OGE sayisi olculur.
  const values = (stmt.match(/VALUES\s*\(([^)]*)\)/) || [])[1] || '';
  const valueCount = values.split(',').filter((v) => v.trim()).length;
  assert.equal(valueCount, colCount, `sutun ${colCount} vs VALUES ogesi ${valueCount}`);
  // Yer tutucular kesintisiz 1..N ve N = parametre dizisi uzunlugu olmali.
  const ph = maxParam(stmt);
  assert.equal(paramCount(stmt), ph, 'yer tutucular kesintisiz degil');
  const argsBlock = code.slice(code.indexOf('[requestKey', i), code.indexOf(']\n', code.indexOf('[requestKey', i)));
  const argCount = argsBlock.split(',').filter((x) => x.trim()).length;
  assert.equal(argCount, ph, `${ph} yer tutucu ama ${argCount} parametre`);
});

test('C2 tum sorgularda yer tutucular 1..N kesintisiz', () => {
  for (const [name, code] of [['index', INDEX], ['state', STATE], ['catalog', CATALOG]]) {
    for (const m of codeOnly(code).matchAll(/`([^`]*\$\d[^`]*)`/g)) {
      const sql = m[1];
      // Bazi sorgular parca parca kuruluyor (`listMirror` kosullu ` AND ... = $3`
      // ekliyor). Yalnizca TAM ifadeleri denetle — parca zaten $1'den baslamaz.
      if (!/\b(SELECT|INSERT|UPDATE|DELETE|MERGE)\b/i.test(sql)) continue;
      const nums = [...new Set((sql.match(/\$(\d+)/g) || []).map((x) => Number(x.slice(1))))].sort((a, b) => a - b);
      if (!nums.length) continue;
      assert.deepEqual(nums, Array.from({ length: nums.length }, (_, i) => i + 1),
        `${name}: yer tutucular kesintisiz degil → ${sql.slice(0, 80)}`);
    }
  }
});

test('C3 MERGE ifadesi parametre sayisiyla tutarli', async () => {
  await withDb(() => ({ rows: [{ id: 1, env: 'e', tenant: 't', cluster_name: 'c', namespace: 'n', app_name: 'a' }] }), async (calls) => {
    await state.upsertStopped({ env: 'e', tenant: 't', clusterName: 'c', namespace: 'n', appName: 'a',
      workloadKind: 'Deployment', previousReplicas: 3, stoppedBy: 'ali', operationId: 7 });
    const { sql, params } = calls[0];
    assert.equal(maxParam(sql), params.length, `MERGE ${maxParam(sql)} yer tutucu, ${params.length} parametre`);
  });
});

test('C4 upsertStopped: gecersiz previousReplicas null yazilir (NaN degil)', async () => {
  await withDb(() => ({ rows: [{ id: 1 }] }), async (calls) => {
    await state.upsertStopped({ env: 'e', tenant: 't', clusterName: 'c', namespace: 'n', appName: 'a', previousReplicas: undefined, stoppedBy: 'x' });
    assert.equal(calls[0].params[6], null);
  });
});

test('C5 listMirror: cluster verilmezse 2, verilirse 3 parametre', async () => {
  await withDb(() => ({ rows: [] }), async (calls) => {
    await state.listMirror({ env: 'e', tenant: 't' });
    assert.equal(calls[0].params.length, 2);
    assert.equal(maxParam(calls[0].sql), 2);
  });
  await withDb(() => ({ rows: [] }), async (calls) => {
    await state.listMirror({ env: 'e', tenant: 't', clusterName: 'c' });
    assert.equal(calls[0].params.length, 3);
    assert.equal(maxParam(calls[0].sql), 3);
  });
});

test('C6 clearRestored 5 parametre', async () => {
  await withDb(() => ({ rowCount: 1 }), async (calls) => {
    await state.clearRestored({ env: 'e', tenant: 't', clusterName: 'c', namespace: 'n', appName: 'a' });
    assert.equal(calls[0].params.length, 5);
    assert.equal(maxParam(calls[0].sql), 5);
  });
});

test('C7 SQL\'de string birlestirme YOK (enjeksiyon)', () => {
  for (const [name, code] of [['index', INDEX], ['state', STATE], ['catalog', CATALOG]]) {
    for (const m of codeOnly(code).matchAll(/`([^`]*(?:SELECT|INSERT|UPDATE|DELETE|MERGE)[^`]*)`/gi)) {
      assert.ok(!/\$\{/.test(m[1]), `${name}: SQL icinde template interpolasyonu → ${m[1].slice(0, 70)}`);
    }
  }
});

// ── D. KAPI ─────────────────────────────────────────────────────────────────

test('D1 dry_run hicbir kapidan gecmez', () => {
  const p = launch.gatePolicyFor({ action: 'stop', executionMode: 'dry_run' });
  assert.deepEqual([p.oco, p.smart], ['skip', 'skip']);
});
test('D2 restore: oco warn, smart require', () => {
  const p = launch.gatePolicyFor({ action: 'restore', executionMode: 'apply' });
  assert.deepEqual([p.oco, p.smart], ['warn', 'require']);
});
test('D3 stop/scale tam kapi', () => {
  for (const a of ['stop', 'scale']) {
    const p = launch.gatePolicyFor({ action: a, executionMode: 'apply' });
    assert.deepEqual([p.oco, p.smart], ['require', 'require'], a);
  }
});
test('D4 bilinmeyen islem TAM kapiya duser (guvenli taraf)', () => {
  const p = launch.gatePolicyFor({ action: 'her-neyse', executionMode: 'apply' });
  assert.deepEqual([p.oco, p.smart], ['require', 'require']);
});
test('D5 kapi karari FAIL-CLOSED tuketiliyor', () => {
  const code = codeOnly(INDEX);
  assert.match(code, /decision\?\.outcome !== 'proceed'[\s\S]{0,400}status\(500\)/,
    'taninmayan kapi karari akisa birakiliyorsa is sessizce calisir');
});
test('D6 gateVars prod tespiti icin env VE ortam tasiyor', () => {
  const g = launch.buildGateVars({ env: 'prod', tenant: 'ark', action: 'stop', executionMode: 'apply', clusters: ['c'], namespace: 'n' });
  assert.equal(g.env, 'prod');
  assert.equal(g.ortam, 'prod');
});
test('D7 gateVars client anahtari TASIMAZ', () => {
  const g = launch.buildGateVars({ env: 'e', tenant: 't', action: 'stop', executionMode: 'apply', clusters: ['c'], namespace: 'n' });
  assert.deepEqual(Object.keys(g).sort(), ['action', 'cluster_count', 'env', 'execution_mode', 'namespace', 'ortam', 'tenant']);
});
test('D8 restore gerekcesiz calistirilamaz', () => {
  assert.match(codeOnly(INDEX), /policy\.oco === 'warn' && !reason[\s\S]{0,300}reasonRequired/);
});
test('D9 OCO zamanlama Chaos icin KAPALI (schedule hook throw eder)', () => {
  assert.match(codeOnly(INDEX), /createOcoAwxSchedule:\s*async \(\) => \{[\s\S]{0,220}throw/);
});

// ── E. GIRDI DOGRULAMASI ────────────────────────────────────────────────────

const okBase = { namespace: 'ns-1', apps: ['app-a'], action: 'stop', executionMode: 'apply', verificationTimeout: '60' };

test('E1 gecerli girdi kabul', () => { launch.assertValidTargets(okBase); });
test('E2 namespace: buyuk harf red', () => { assert.throws(() => launch.assertValidTargets({ ...okBase, namespace: 'NS' }), /namespace/i); });
test('E3 namespace: 63 karakter siniri', () => {
  launch.assertValidTargets({ ...okBase, namespace: 'a'.repeat(63) });
  assert.throws(() => launch.assertValidTargets({ ...okBase, namespace: 'a'.repeat(64) }), /namespace/i);
});
test('E4 namespace: kabuk metakarakteri red', () => {
  for (const ns of ['a;b', 'a$b', 'a`b', 'a|b', 'a b', 'a&b', "a'b", 'a"b', 'a\\b', 'a/b']) {
    assert.throws(() => launch.assertValidTargets({ ...okBase, namespace: ns }), /namespace/i, ns);
  }
});
test('E5 namespace: bas/son tire red', () => {
  for (const ns of ['-a', 'a-']) assert.throws(() => launch.assertValidTargets({ ...okBase, namespace: ns }), /namespace/i, ns);
});
test('E6 namespace: nokta KABUL EDILMEZ (k8s ns kurali)', () => {
  assert.throws(() => launch.assertValidTargets({ ...okBase, namespace: 'a.b' }), /namespace/i);
});
test('E7 uygulama: nokta KABUL EDILIR', () => { launch.assertValidTargets({ ...okBase, apps: ['a.b-c'] }); });
test('E8 uygulama: 253 karakter siniri', () => {
  launch.assertValidTargets({ ...okBase, apps: ['a'.repeat(253)] });
  assert.throws(() => launch.assertValidTargets({ ...okBase, apps: ['a'.repeat(254)] }), /uygulama/i);
});
test('E9 uygulama: metakarakter red', () => {
  for (const a of ['a;b', 'a b', 'a$b', 'A']) assert.throws(() => launch.assertValidTargets({ ...okBase, apps: [a] }), /uygulama/i, a);
});
test('E10 bos uygulama listesi red', () => { assert.throws(() => launch.assertValidTargets({ ...okBase, apps: [] }), /uygulama/i); });
test('E11 gecersiz islem red', () => { assert.throws(() => launch.assertValidTargets({ ...okBase, action: 'delete' }), /işlem/i); });
test('E12 gecersiz mod red', () => { assert.throws(() => launch.assertValidTargets({ ...okBase, executionMode: 'force' }), /mod/i); });
test('E13 gecersiz timeout red', () => {
  for (const t of ['45', '0', '', 'abc']) assert.throws(() => launch.assertValidTargets({ ...okBase, verificationTimeout: t }), /süre/i, t);
});
test('E14 scale: negatif/ondalik/bos red, 0 ve pozitif kabul', () => {
  const b = { ...okBase, action: 'scale' };
  for (const v of ['-1', '1.5', '', undefined, 'abc', '1e3']) assert.throws(() => launch.assertValidTargets({ ...b, targetReplicas: v }), /replica/i, String(v));
  launch.assertValidTargets({ ...b, targetReplicas: '0' });
  launch.assertValidTargets({ ...b, targetReplicas: 12 });
});
test('E15 hatalar HTTP 400 tasir', () => {
  try { launch.assertValidTargets({ ...okBase, namespace: 'BAD' }); assert.fail('atmali'); }
  catch (e) { assert.equal(e.status, 400); }
});

// ── F. PATLAMA YARICAPI ─────────────────────────────────────────────────────

const radius = (o) => launch.computeBlastRadius({ action: 'stop', executionMode: 'apply', ...o });

test('F1 hedef = cluster x app', () => { assert.equal(radius({ clusters: ['a', 'b'], apps: ['x', 'y', 'z'], environment: 'test' }).targets, 6); });
test('F2 bos secim 0 hedef', () => { assert.equal(radius({ clusters: [], apps: [], environment: 'test' }).targets, 0); });
test('F3 prod tespiti prod ve production', () => {
  for (const e of ['prod', 'PROD', 'production', ' Production ']) assert.equal(launch.isProdEnv(e), true, e);
  for (const e of ['test', 'preprod', 'prodx', '']) assert.equal(launch.isProdEnv(e), false, e);
});
test('F4 esik: tam esikte yazili onay ISTEMEZ, ustunde ister', () => {
  const at = radius({ clusters: ['c'], apps: Array.from({ length: 5 }, (_, i) => `a${i}`), environment: 'prod' });
  const over = radius({ clusters: ['c'], apps: Array.from({ length: 6 }, (_, i) => `a${i}`), environment: 'prod' });
  assert.equal(at.requiresWrittenConfirm, false);
  assert.equal(over.requiresWrittenConfirm, true);
});
test('F5 prod disi yazili onay istemez', () => {
  assert.equal(radius({ clusters: ['a', 'b', 'c'], apps: Array.from({ length: 10 }, (_, i) => `a${i}`), environment: 'test' }).requiresWrittenConfirm, false);
});
test('F6 dry_run hicbir onay istemez', () => {
  const r = launch.computeBlastRadius({ clusters: ['a', 'b'], apps: Array.from({ length: 10 }, (_, i) => `x${i}`), environment: 'prod', action: 'stop', executionMode: 'dry_run' });
  assert.equal(r.requiresWrittenConfirm, false);
  assert.equal(r.requiresSecondPerson, false);
});
test('F7 ikinci kisi: prod + >1 cluster', () => {
  assert.equal(radius({ clusters: ['a', 'b'], apps: ['x'], environment: 'prod' }).requiresSecondPerson, true);
  assert.equal(radius({ clusters: ['a'], apps: ['x'], environment: 'prod' }).requiresSecondPerson, false);
  assert.equal(radius({ clusters: ['a', 'b'], apps: ['x'], environment: 'test' }).requiresSecondPerson, false);
});
test('F8 MAX_TARGETS asimi isaretlenir', () => {
  const r = radius({ clusters: Array.from({ length: 11 }, (_, i) => `c${i}`), apps: Array.from({ length: 20 }, (_, i) => `a${i}`), environment: 'test' });
  assert.equal(r.targets, 220);
  assert.equal(r.exceedsMaxTargets, true);
});
test('F9 MAX_TARGETS sunucuda GERCEKTEN uygulaniyor', () => {
  assert.match(codeOnly(INDEX), /exceedsMaxTargets[\s\S]{0,300}status:\s*400/);
});

// ── G. SAPMA ────────────────────────────────────────────────────────────────

const M = (c, a) => ({ id: `${c}-${a}`, env: 'e', tenant: 't', clusterName: c, namespace: 'n', appName: a });
const C = (c, a) => ({ env: 'e', tenant: 't', clusterName: c, namespace: 'n', appName: a });

test('G1 in_sync', () => {
  assert.equal(state.classifyDrift({ mirrorRows: [M('c', 'a')], clusterStates: [C('c', 'a')], scannedClusters: ['c'] })[0].drift, state.DRIFT.IN_SYNC);
});
test('G2 missing_on_cluster', () => {
  assert.equal(state.classifyDrift({ mirrorRows: [M('c', 'a')], clusterStates: [], scannedClusters: ['c'] })[0].drift, state.DRIFT.MISSING_ON_CLUSTER);
});
test('G3 unknown_to_portal', () => {
  const o = state.classifyDrift({ mirrorRows: [], clusterStates: [C('c', 'a')], scannedClusters: ['c'] })[0];
  assert.equal(o.drift, state.DRIFT.UNKNOWN_TO_PORTAL);
  assert.equal(o.source, 'cluster');
});
test('G4 taranmayan cluster: karar YOK', () => {
  assert.equal(state.classifyDrift({ mirrorRows: [M('c2', 'a')], clusterStates: [], scannedClusters: ['c1'] })[0].drift, null);
});
test('G5 ayni ad farkli namespace KARISMAZ', () => {
  const m = { ...M('c', 'a'), namespace: 'ns1' };
  const cl = { ...C('c', 'a'), namespace: 'ns2' };
  const out = state.classifyDrift({ mirrorRows: [m], clusterStates: [cl], scannedClusters: ['c'] });
  assert.equal(out.length, 2, 'farkli namespace ayri kayit olmali');
  assert.equal(out[0].drift, state.DRIFT.MISSING_ON_CLUSTER);
});
test('G6 ayni ad farkli cluster KARISMAZ', () => {
  const out = state.classifyDrift({ mirrorRows: [M('c1', 'a')], clusterStates: [C('c2', 'a')], scannedClusters: ['c1', 'c2'] });
  assert.equal(out.length, 2);
});
test('G7 bos girdi bos cikti', () => {
  assert.deepEqual(state.classifyDrift({}), []);
});
test('G8 DRIFT sabitleri DB varsayilaniyla uyumlu', () => {
  assert.deepEqual(Object.values(state.DRIFT).sort(), ['in_sync', 'missing_on_cluster', 'unknown_to_portal']);
});

// ── H. PORTAL ↔ PLAYBOOK SOZLESMESI ─────────────────────────────────────────
// Playbook AYRI bir depoda; uyusmazlik ancak uretimde ortaya cikar. Bu testler
// portalin GONDERDIGI ve OKUDUGU alan adlarini kilitler — biri degisirse kirmizi olur
// ve `scale/PORTAL.md` ile birlikte guncellenmesi gerekir.

test('H1 calistirma extra_vars anahtar kumesi SABIT', () => {
  const code = codeOnly(LAUNCH);
  const i = code.indexOf('return {', code.indexOf('async function buildRunExtraVars'));
  const block = code.slice(i, code.indexOf('\n}', i));
  const keys = [...block.matchAll(/^\s{4}([a-z_]+):/gm)].map((m) => m[1]);
  assert.deepEqual(keys.sort(), [
    'allow_partial_execution', 'bulk_change_confirmation', 'chaos_clusters_override',
    'chaos_target_clusters', 'change_confirmation', 'cluster_selection_mode',
    'execution_mode', 'mail_to', 'operation_action', 'target_app_names', 'target_cluster_name',
    'target_environment', 'target_namespace', 'target_platform', 'verification_timeout',
  ].sort(), 'extra_vars kumesi degisti — scale/PORTAL.md ve playbook ile birlikte guncelle');
});

test('H2 kesif extra_vars anahtar kumesi SABIT', () => {
  const code = codeOnly(INDEX);
  const i = code.indexOf('const extraVars = {');
  const block = code.slice(i, code.indexOf('};', i));
  for (const k of ['chaos_clusters_override', 'target_platform', 'target_environment', 'target_namespace', 'chaos_target_clusters', 'discovery_mode']) {
    assert.ok(block.includes(`${k}:`), `kesif ${k} gondermiyor`);
  }
});

test('H3 katalog playbook assert\'inin istedigi TUM alanlari tasir', () => {
  const c = launch.buildChaosClusterCatalog({
    env: 'prod', tenant: 'ark', clusters: ['c1'], hosts: { c1: 'j1' },
    meta: { c1: { api_url: 'https://api.x:6443', vault_credential_key: 'k' } },
  }).clusters.c1;
  // `02_select_targets.yml` "Validate selected cluster records" bunlari ZORUNLU tutuyor.
  for (const f of ['enabled', 'platform', 'environments', 'jump_server', 'api_url', 'credential']) {
    assert.ok(f in c, `katalogda ${f} yok — playbook assert'i duser`);
  }
  assert.equal(c.version, undefined);
});

test('H4 api_url playbook regex\'ini saglar', () => {
  const RE = /^https:\/\/[^/]+:[0-9]+\/?$/;   // 02_select_targets.yml ile AYNI
  const c = launch.buildChaosClusterCatalog({
    env: 'e', tenant: 't', clusters: ['c1'], hosts: { c1: 'j' },
    meta: { c1: { api_url: 'https://api.gbocpprod1.fw.garanti.com.tr:6443', vault_credential_key: 'k' } },
  }).clusters.c1;
  assert.match(c.api_url, RE);
});

test('H5 katalog version 1 (playbook bunu assert ediyor)', () => {
  assert.equal(launch.buildChaosClusterCatalog({ env: 'e', tenant: 't', clusters: [], hosts: {}, meta: {} }).version, 1);
});

test('H6 environments DIZI (playbook `in` operatoru kullaniyor)', () => {
  const c = launch.buildChaosClusterCatalog({ env: 'prod', tenant: 'ark', clusters: ['c'], hosts: { c: 'j' }, meta: { c: {} } }).clusters.c;
  assert.ok(Array.isArray(c.environments));
  assert.deepEqual(c.environments, ['prod']);
});

test('H7 bool degerler Ansible `| bool` icin STRING olarak gonderiliyor', () => {
  const code = codeOnly(LAUNCH);
  assert.match(code, /allow_partial_execution:\s*allowPartial \? 'true' : 'false'/);
  assert.match(code, /change_confirmation:\s*executionMode === 'apply' \? 'true' : 'false'/);
});

test('H8 target_replicas YALNIZCA scale islemi icin gonderilir', () => {
  assert.match(codeOnly(LAUNCH), /\.\.\.\(action === 'scale' \? \{ target_replicas/);
});

test('H9 mail_cc yalnizca doluyken gonderilir', () => {
  assert.match(codeOnly(LAUNCH), /\.\.\.\(mailCc \? \{ mail_cc/);
});

test('H10 sonuc okuyucusu playbook alan adlariyla eslesir', () => {
  // `25_publish_result.yml`in yayinladigi TUM ust seviye alanlar okunmali; biri
  // eklenip okunmazsa ekran sessizce eksik gosterir.
  const published = ['overall_status', 'mode', 'action', 'namespace', 'platform', 'environment',
    'catalog_source', 'cluster_mode', 'clusters', 'apps', 'target_replicas', 'strict_blocked',
    'counts', 'targets', 'targets_truncated', 'targets_total', 'rows', 'rows_truncated',
    'rows_total', 'job_id'];
  const code = codeOnly(fs.readFileSync(path.join(SRC_DIR, 'result.cjs'), 'utf8'));
  for (const f of published) assert.ok(code.includes(`raw.${f}`), `result.cjs raw.${f} okumuyor`);
});

test('H11 kesif sonuc okuyucusu playbook alanlariyla eslesir', () => {
  const published = ['overall_status', 'mode', 'namespace', 'platform', 'environment',
    'catalog_source', 'clusters', 'failed_clusters', 'counts', 'items'];
  const code = codeOnly(fs.readFileSync(path.join(SRC_DIR, 'result.cjs'), 'utf8'));
  for (const f of published) assert.ok(code.includes(`raw.${f}`), `result.cjs raw.${f} okumuyor`);
});

test('H12 playbook registry anahtarlari kodda ve seed\'de AYNI', () => {
  const setup = fs.readFileSync(path.join(SRC_DIR, '..', 'db', 'mssql-setup.cjs'), 'utf8');
  for (const key of ['chaos_scale_portal', 'chaos_scale_discovery']) {
    assert.ok(INDEX.includes(`'${key}'`), `index.cjs ${key} kullanmiyor`);
    assert.ok(setup.includes(`key_name: '${key}'`), `seed'de ${key} yok`);
  }
});

test('H13 element anahtari ekran/route/seed uclusunde AYNI', () => {
  const setup = fs.readFileSync(path.join(SRC_DIR, '..', 'db', 'mssql-setup.cjs'), 'utf8');
  const elements = fs.readFileSync(path.join(SRC_DIR, '..', '..', 'src', 'config', 'elements.ts'), 'utf8');
  assert.ok(setup.includes("element_key: 'Chaos Scale'"));
  assert.ok(elements.includes('id: "Chaos Scale"'));
  assert.ok(INDEX.includes("requireVisiblePrefix('Chaos Scale')"));
});

test('H14 tablolar semada tanimli', () => {
  const setup = fs.readFileSync(path.join(SRC_DIR, '..', 'db', 'mssql-setup.cjs'), 'utf8');
  for (const t of ['chaos_scale_operations', 'chaos_scale_state_mirror', 'logx_v2_restriction_group_grants']) {
    assert.ok(setup.includes(`name: '${t}'`), `${t} semada yok`);
    assert.ok(setup.includes(`CREATE TABLE ${t}`), `${t} CREATE TABLE yok`);
  }
});

test('H15 kodun yazdigi her sutun semada VAR', () => {
  const setup = fs.readFileSync(path.join(SRC_DIR, '..', 'db', 'mssql-setup.cjs'), 'utf8');
  const ddl = setup.slice(setup.indexOf('CREATE TABLE chaos_scale_operations'), setup.indexOf(')`', setup.indexOf('CREATE TABLE chaos_scale_operations')));
  const i = codeOnly(INDEX).indexOf('INSERT INTO chaos_scale_operations');
  const cols = (codeOnly(INDEX).slice(i, i + 500).match(/\(([^)]*)\)\s*\n?\s*VALUES/) || [])[1] || '';
  for (const c of cols.split(',').map((x) => x.trim()).filter(Boolean)) {
    assert.ok(new RegExp(`\\b${c}\\s`).test(ddl), `chaos_scale_operations.${c} semada yok`);
  }
});
