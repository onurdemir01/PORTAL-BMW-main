// server/scalex/__tests__/scalex-validation.test.cjs — MERGE ONCESI DOGRULAMA SUITI.
//
// Amac: `server/scalex/*` ve ona bagli degisikliklerde, "calisiyor gibi gorunup sessizce
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
const codeOnly = (s) =>
  s
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

function withDb(handler, fn) {
  const orig = db.query;
  const calls = [];
  db.query = async (sql, params) => {
    calls.push({ sql, params });
    return handler(sql, params) || { rows: [], rowCount: 0 };
  };
  return Promise.resolve(fn(calls)).finally(() => {
    db.query = orig;
  });
}

// ── A. SONUC SOZLESMESI ─────────────────────────────────────────────────────

test('A1 artifact: dogrudan anahtar', () => {
  assert.equal(
    result.extractScaleXResult({ scalex_result: { overall_status: 'OK' } }).overallStatus,
    'OK',
  );
});
test('A2 artifact: data.<key>', () => {
  assert.equal(
    result.extractScaleXResult({ data: { scalex_result: { overall_status: 'OK' } } }).overallStatus,
    'OK',
  );
});
test('A3 artifact: ansible_stats.data.<key>', () => {
  assert.equal(
    result.extractScaleXResult({
      ansible_stats: { data: { scalex_result: { overall_status: 'OK' } } },
    }).overallStatus,
    'OK',
  );
});
test('A4 artifact: JSON string', () => {
  assert.equal(
    result.extractScaleXResult({ scalex_result: '{"overall_status":"WARN"}' }).overallStatus,
    'WARN',
  );
});
test('A5 artifact: <key>_json alani', () => {
  assert.equal(
    result.extractScaleXResult({ scalex_result_json: '{"overall_status":"FAIL"}' }).overallStatus,
    'FAIL',
  );
});
test('A6 artifact: bozuk JSON null doner, patlamaz', () => {
  assert.equal(result.extractScaleXResult({ scalex_result: '{bozuk' }), null);
});
test('A7 artifact: bos string null doner', () => {
  assert.equal(result.extractScaleXResult({ scalex_result: '   ' }), null);
});
test('A8 artifact: null/undefined girdi', () => {
  assert.equal(result.extractScaleXResult(null), null);
  assert.equal(result.extractScaleXResult(undefined), null);
});
test('A9 overall_status bosluklu + kucuk harf normalize', () => {
  assert.equal(
    result.extractScaleXResult({ scalex_result: { overall_status: '  warn ' } }).overallStatus,
    'WARN',
  );
});
test('A10 hedef durumlari da normalize', () => {
  const r = result.extractScaleXResult({ scalex_result: { targets: [{ status: ' fail ' }] } });
  assert.equal(r.targets[0].status, 'FAIL');
});
test('A11 sayaclar Jinja STRING gelse de sayiya cevrilir', () => {
  const r = result.extractScaleXResult({
    scalex_result: { counts: { planned: '6', ok: '5', fail: '1' } },
  });
  assert.deepEqual([r.counts.planned, r.counts.ok, r.counts.fail], [6, 5, 1]);
});
test('A12 sayac eksikse 0, NaN degil', () => {
  const r = result.extractScaleXResult({ scalex_result: {} });
  for (const [k, v] of Object.entries(r.counts)) assert.equal(v, 0, k);
});
test('A13 strict_blocked Jinja True/true/boolean ucu de tanini', () => {
  for (const v of [true, 'True', 'true']) {
    assert.equal(
      result.extractScaleXResult({ scalex_result: { strict_blocked: v } }).strictBlocked,
      true,
      String(v),
    );
  }
});
test('A14 strict_blocked False/false/eksik → false', () => {
  for (const v of [false, 'False', 'false', undefined]) {
    assert.equal(
      result.extractScaleXResult({ scalex_result: { strict_blocked: v } }).strictBlocked,
      false,
      String(v),
    );
  }
});
test('A15 truncated bayraklari Jinja True stringini de tanimali', () => {
  // Jinja bool'u `set_stats` uzerinden "True" olarak gelebilir; `=== true` bunu KACIRIR.
  const r = result.extractScaleXResult({
    scalex_result: { rows_truncated: 'True', targets_truncated: 'True' },
  });
  assert.equal(r.rowsTruncated, true, 'rows_truncated "True" tanninmali');
  assert.equal(r.targetsTruncated, true, 'targets_truncated "True" tanninmali');
});
test('A16 validation bicimi ayni sekle indirgenir', () => {
  const r = result.extractScaleXResult({
    scalex_result: { stage: 'validation', validation_error: 'x', failed_task: 't' },
  });
  assert.equal(r.stage, 'validation');
  assert.equal(r.validationError, 'x');
  assert.equal(r.failedTask, 't');
});
test('A17 stage yoksa varsayilan execution', () => {
  assert.equal(result.extractScaleXResult({ scalex_result: {} }).stage, 'execution');
});
test('A18 catalog_source varsayilani file (guvenli taraf)', () => {
  assert.equal(result.extractScaleXResult({ scalex_result: {} }).catalogSource, 'file');
});
test('A19 target_replicas bos string null olur', () => {
  assert.equal(
    result.extractScaleXResult({ scalex_result: { target_replicas: '' } }).targetReplicas,
    null,
  );
});
test('A20 diziler dizi olmayan degerle gelirse bos diziye duser', () => {
  const r = result.extractScaleXResult({
    scalex_result: { clusters: 'x', apps: null, targets: 'y', rows: 5 },
  });
  assert.deepEqual([r.clusters, r.apps, r.targets, r.rows], [[], [], [], []]);
});

// ── Kesif sozlesmesi ────────────────────────────────────────────────────────

const disc = (o) => result.extractDiscoveryResult({ scalex_discovery_result: o });

test('A21 kesif: workload alanlari ayrisir', () => {
  const r = disc({
    mode: 'workloads',
    items: [
      {
        app: 'a',
        kind: 'Deployment',
        step: 'WORKLOAD',
        status: 'OK',
        detail:
          'resource=deploy spec=3 status=3 ready=2 hpa=yes state_phase=- previous_replicas=- image=reg/x:1',
      },
    ],
  });
  assert.deepEqual(
    [
      r.workloads[0].specReplicas,
      r.workloads[0].readyReplicas,
      r.workloads[0].hasHpa,
      r.workloads[0].image,
    ],
    [3, 2, true, 'reg/x:1'],
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
  const yes = disc({
    mode: 'workloads',
    items: [{ app: 'a', step: 'WORKLOAD', status: 'OK', detail: 'previous_replicas=2' }],
  });
  const no = disc({
    mode: 'workloads',
    items: [{ app: 'b', step: 'WORKLOAD', status: 'OK', detail: 'previous_replicas=-' }],
  });
  assert.equal(yes.workloads[0].restorable, true);
  assert.equal(no.workloads[0].restorable, false);
});
test('A25 kesif: previous_replicas=0 GECERLI bir geri alma hedefidir', () => {
  // 0 falsy'dir; `prev !== null` yerine truthiness kullanilsa bu kayit "geri alinamaz"
  // gorunur ve kullanici gercekten kayitli bir durumu geri ALAMAZ.
  const r = disc({
    mode: 'workloads',
    items: [{ app: 'a', step: 'WORKLOAD', status: 'OK', detail: 'previous_replicas=0' }],
  });
  assert.equal(r.workloads[0].restorable, true);
  assert.equal(r.workloads[0].previousReplicas, 0);
});
test('A26 kesif: FAIL satirlari workloads listesine GIRMEZ', () => {
  const r = disc({
    mode: 'workloads',
    items: [{ app: 'a', step: 'WORKLOAD', status: 'FAIL', detail: 'x' }],
  });
  assert.equal((r.workloads || []).length, 0);
});
test('A27 kesif: problems FAIL ve WARN satirlarini toplar', () => {
  const r = disc({
    mode: 'workloads',
    items: [
      { cluster: 'c1', step: 'RUNNER', status: 'FAIL', detail: 'ssh' },
      { cluster: 'c1', step: 'RBAC', status: 'WARN', detail: 'izin' },
      { cluster: 'c1', step: 'WORKLOAD', status: 'OK', detail: 'x' },
    ],
  });
  assert.equal(r.problems.length, 2);
});
test('A28 kesif: state modu alanlari', () => {
  const r = disc({
    mode: 'state',
    items: [
      {
        app: 'a',
        kind: 'Deployment',
        step: 'STATE',
        status: 'OK',
        detail:
          'cm=scalex-state-a previous_replicas=2 phase=scaled_down created_at=2026-08-28T10:00:00Z created_by=ali job_id=5',
      },
    ],
  });
  assert.deepEqual(
    [r.states[0].previousReplicas, r.states[0].phase, r.states[0].createdBy, r.states[0].jobId],
    [2, 'scaled_down', 'ali', '5'],
  );
});
test('A29 kesif: durumlar KUCUK harf (mutasyon sonucundan farkli)', () => {
  assert.equal(disc({ overall_status: ' Partial ' }).overallStatus, 'partial');
});
test('A30 kesif: artifact yoksa null', () => {
  assert.equal(result.extractDiscoveryResult({}), null);
});

// ── B. YETKI / GUVENLIK ─────────────────────────────────────────────────────

test("B1 her mutasyon ucu resolveScope'tan geciyor", () => {
  // `resolveScope` cluster varligi + namespace + uygulama yetkisini DOGRULAR. Bir uc
  // onu atlarsa, client istedigi namespace'i gonderip yetki kapisini bypass eder.
  const code = codeOnly(INDEX);
  for (const route of ['/discover', '/preview', '/run', '/adopt']) {
    const i =
      code.indexOf(`router.post('${route}'`) >= 0
        ? code.indexOf(`router.post('${route}'`)
        : code.indexOf(`router.post("${route}"`);
    assert.ok(i > 0, `${route} bulunamadi`);
    const body = code.slice(i, i + 1800);
    assert.match(
      body,
      /resolveScope\(req/,
      `${route} resolveScope cagirmiyor — yetki kapisi atlanir`,
    );
  }
});

test('B2 is-durumu uclari denyIfNotOwner tasiyor (IDOR)', () => {
  const code = codeOnly(INDEX);
  for (const route of [
    '/discover/:serverId/:jobId/status',
    '/run/:serverId/:jobId/status',
    '/cancel/:serverId/:jobId',
  ]) {
    const i = Math.max(code.indexOf(`'${route}'`), code.indexOf(`"${route}"`));
    assert.ok(i > 0, `${route} bulunamadi`);
    assert.match(code.slice(i, i + 900), /denyIfNotOwner/, `${route} sahiplik denetimi yapmiyor`);
  }
});

test('B3 denyIfNotOwner DB hatasinda FAIL-CLOSED (503)', () => {
  assert.match(
    codeOnly(INDEX),
    /catch[\s\S]{0,220}status:\s*503/,
    'sahiplik sorgusu dusunce erisim ACILMAMALI',
  );
});

test('B4 router requireAuth ve gorunurluk kapisi tasiyor', () => {
  const code = codeOnly(INDEX);
  assert.match(code, /router\.use\(requireAuth\)/);
  assert.match(code, /requireVisiblePrefix\('ScaleX'\)/);
});

test('B5 auth modulu yuklenemezse varsayilan DENY', () => {
  assert.match(codeOnly(INDEX), /requireAuth\s*=\s*\(req,\s*res\)\s*=>\s*res\.status\(401\)/);
});

test('B6 /stopped ve /history yetki suzgeci tasiyor', () => {
  const code = codeOnly(INDEX);
  const stopped = code.slice(code.indexOf("'/stopped'"), code.indexOf("'/stopped'") + 900);
  // `/stopped` yalnizca env+tenant aliyor; namespace bazli kisit UYGULANMIYORSA
  // kisitli bir namespace'in ADI ve durdurulmus uygulamalari sizar.
  assert.match(
    stopped,
    /filterAllowed|assertAllowed|isAllowed|filterStoppedForUser/,
    '/stopped yetki suzgeci uygulamiyor — kisitli namespace adlari sizar',
  );
  const hist = code.slice(code.indexOf("'/history'"), code.indexOf("'/history'") + 700);
  assert.match(
    hist,
    /isAdmin/,
    '/history admin olmayan kullaniciyi kendi kayitlariyla sinirlamali',
  );
});

test("B7 gateVars yalnizca sunucu ureticisinden gelir, req.body'den DEGIL", () => {
  const code = codeOnly(INDEX);
  assert.match(code, /gateVars\s*=\s*launch\.buildGateVars\(/);
  assert.ok(!/gateVars:\s*req\.body/.test(code), 'client gateVars gonderemez');
});

test("B8 onay kutulari sunucuda uretilir, client'tan alinmaz", () => {
  const code = codeOnly(LAUNCH) + codeOnly(INDEX);
  for (const key of ['change_confirmation', 'bulk_change_confirmation']) {
    assert.ok(
      !new RegExp(`${key}:\\s*(req\\.body|body\\.)`).test(code),
      `${key} client'tan aliniyor`,
    );
  }
  assert.match(codeOnly(LAUNCH), /change_confirmation:\s*executionMode === 'apply'/);
});

test('B9 yazili onay namespace ile BIREBIR eslesmeli', () => {
  assert.match(
    codeOnly(INDEX),
    /writtenConfirm[^\n]*\.trim\(\)\s*!==\s*namespace/,
    'yazili onay serbest metin kabul ediyorsa hicbir sey dogrulamiyor',
  );
});

test("B10 mail adresi oturumdan, client'tan DEGIL", () => {
  const code = codeOnly(INDEX);
  assert.match(code, /mailTo\s*=\s*String\(user\.mail/);
  assert.ok(!/mailTo\s*=\s*String\(req\.body/.test(code), 'client rapor alicisini secemez');
});

test('B11 katalogda PAROLA yok, yalnizca vault degisken ADI', () => {
  const cat = launch.buildScaleXClusterCatalog({
    env: 'prod',
    tenant: 'ark',
    clusters: ['c1'],
    hosts: { c1: 'j1' },
    meta: { c1: { api_url: 'https://a:6443', vault_credential_key: 'uxmid_gar' } },
  });
  const s = JSON.stringify(cat);
  for (const bad of ['password', 'parola', 'secret'])
    assert.ok(!s.toLowerCase().includes(bad), bad);
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

test('C1 scalex_operations INSERT: yer tutucu sayisi = parametre sayisi', () => {
  const code = codeOnly(INDEX);
  const i = code.indexOf('INSERT INTO scalex_operations');
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
  const argsBlock = code.slice(
    code.indexOf('[requestKey', i),
    code.indexOf(']\n', code.indexOf('[requestKey', i)),
  );
  const argCount = argsBlock.split(',').filter((x) => x.trim()).length;
  assert.equal(argCount, ph, `${ph} yer tutucu ama ${argCount} parametre`);
});

test('C2 tum sorgularda yer tutucular 1..N kesintisiz', () => {
  for (const [name, code] of [
    ['index', INDEX],
    ['state', STATE],
    ['catalog', CATALOG],
  ]) {
    for (const m of codeOnly(code).matchAll(/`([^`]*\$\d[^`]*)`/g)) {
      const sql = m[1];
      // Bazi sorgular parca parca kuruluyor (`listMirror` kosullu ` AND ... = $3`
      // ekliyor). Yalnizca TAM ifadeleri denetle — parca zaten $1'den baslamaz.
      if (!/\b(SELECT|INSERT|UPDATE|DELETE|MERGE)\b/i.test(sql)) continue;
      const nums = [...new Set((sql.match(/\$(\d+)/g) || []).map((x) => Number(x.slice(1))))].sort(
        (a, b) => a - b,
      );
      if (!nums.length) continue;
      assert.deepEqual(
        nums,
        Array.from({ length: nums.length }, (_, i) => i + 1),
        `${name}: yer tutucular kesintisiz degil → ${sql.slice(0, 80)}`,
      );
    }
  }
});

test('C3 MERGE ifadesi parametre sayisiyla tutarli', async () => {
  await withDb(
    () => ({
      rows: [{ id: 1, env: 'e', tenant: 't', cluster_name: 'c', namespace: 'n', app_name: 'a' }],
    }),
    async (calls) => {
      await state.upsertStopped({
        env: 'e',
        tenant: 't',
        clusterName: 'c',
        namespace: 'n',
        appName: 'a',
        workloadKind: 'Deployment',
        previousReplicas: 3,
        stoppedBy: 'ali',
        operationId: 7,
      });
      const { sql, params } = calls[0];
      assert.equal(
        maxParam(sql),
        params.length,
        `MERGE ${maxParam(sql)} yer tutucu, ${params.length} parametre`,
      );
    },
  );
});

test('C4 upsertStopped: gecersiz previousReplicas null yazilir (NaN degil)', async () => {
  await withDb(
    () => ({ rows: [{ id: 1 }] }),
    async (calls) => {
      await state.upsertStopped({
        env: 'e',
        tenant: 't',
        clusterName: 'c',
        namespace: 'n',
        appName: 'a',
        previousReplicas: undefined,
        stoppedBy: 'x',
      });
      assert.equal(calls[0].params[6], null);
    },
  );
});

test('C5 listMirror: cluster verilmezse 2, verilirse 3 parametre', async () => {
  await withDb(
    () => ({ rows: [] }),
    async (calls) => {
      await state.listMirror({ env: 'e', tenant: 't' });
      assert.equal(calls[0].params.length, 2);
      assert.equal(maxParam(calls[0].sql), 2);
    },
  );
  await withDb(
    () => ({ rows: [] }),
    async (calls) => {
      await state.listMirror({ env: 'e', tenant: 't', clusterName: 'c' });
      assert.equal(calls[0].params.length, 3);
      assert.equal(maxParam(calls[0].sql), 3);
    },
  );
});

test('C6 clearRestored 5 parametre', async () => {
  await withDb(
    () => ({ rowCount: 1 }),
    async (calls) => {
      await state.clearRestored({
        env: 'e',
        tenant: 't',
        clusterName: 'c',
        namespace: 'n',
        appName: 'a',
      });
      assert.equal(calls[0].params.length, 5);
      assert.equal(maxParam(calls[0].sql), 5);
    },
  );
});

test("C7 SQL'de string birlestirme YOK (enjeksiyon)", () => {
  for (const [name, code] of [
    ['index', INDEX],
    ['state', STATE],
    ['catalog', CATALOG],
  ]) {
    for (const m of codeOnly(code).matchAll(
      /`([^`]*(?:SELECT|INSERT|UPDATE|DELETE|MERGE)[^`]*)`/gi,
    )) {
      assert.ok(
        !/\$\{/.test(m[1]),
        `${name}: SQL icinde template interpolasyonu → ${m[1].slice(0, 70)}`,
      );
    }
  }
});

// ── D. KAPI ─────────────────────────────────────────────────────────────────

test('D1 dry_run hicbir kapidan gecmez', () => {
  const p = launch.gatePolicyFor({ action: 'stop', executionMode: 'dry_run' });
  assert.deepEqual([p.oco, p.smart], ['skip', 'skip']);
});
test('D2 restore: oco warn, smart require (prod)', () => {
  const p = launch.gatePolicyFor({
    action: 'restore',
    executionMode: 'apply',
    environment: 'prod',
  });
  assert.deepEqual([p.oco, p.smart], ['warn', 'require']);
});
test('D3 stop/scale tam kapi (prod)', () => {
  for (const a of ['stop', 'scale']) {
    const p = launch.gatePolicyFor({ action: a, executionMode: 'apply', environment: 'prod' });
    assert.deepEqual([p.oco, p.smart], ['require', 'require'], a);
  }
});
test('D4 bilinmeyen islem TAM kapiya duser (guvenli taraf)', () => {
  const p = launch.gatePolicyFor({
    action: 'her-neyse',
    executionMode: 'apply',
    environment: 'prod',
  });
  assert.deepEqual([p.oco, p.smart], ['require', 'require']);
});
test('D5 kapi karari FAIL-CLOSED tuketiliyor', () => {
  const code = codeOnly(INDEX);
  // 1) Ortak kapi govdesi taninmayan karari 500'e cevirir.
  assert.match(
    code,
    /decision\?\.outcome !== 'proceed'[\s\S]{0,400}status: 500/,
    'taninmayan kapi karari akisa birakiliyorsa is sessizce calisir',
  );
  // 2) HER cagiran `error` ve `respond` dallarini tuketmek ZORUNDA. Kapi artik
  //    `res`e dokunmayan bir karar nesnesi donduruyor; bir cagiran dallardan
  //    birini ele almazsa is SESSIZCE calisir (kapinin cikarilmasindaki asil risk).
  const callers = code.match(/await runScaleXGates\(\{[\s\S]{0,600}?\}\);([\s\S]{0,400})/g) || [];
  assert.ok(
    callers.length >= 2,
    `runScaleXGates cagirani sayisi beklenenden az: ${callers.length}`,
  );
  for (const c of callers) {
    assert.match(c, /outcome === 'error'/, `kapi 'error' dali tuketilmemis:\n${c}`);
    assert.match(c, /outcome === 'respond'/, `kapi 'respond' dali tuketilmemis:\n${c}`);
  }
});
test('D6 gateVars prod tespiti icin env VE ortam tasiyor', () => {
  const g = launch.buildGateVars({
    env: 'prod',
    tenant: 'ark',
    action: 'stop',
    executionMode: 'apply',
    clusters: ['c'],
    namespace: 'n',
  });
  assert.equal(g.env, 'prod');
  assert.equal(g.ortam, 'prod');
});
test('D7 gateVars client anahtari TASIMAZ', () => {
  const g = launch.buildGateVars({
    env: 'e',
    tenant: 't',
    action: 'stop',
    executionMode: 'apply',
    clusters: ['c'],
    namespace: 'n',
  });
  assert.deepEqual(Object.keys(g).sort(), [
    'action',
    'cluster_count',
    'env',
    'execution_mode',
    'namespace',
    'ortam',
    'tenant',
  ]);
});
test('D8 restore gerekcesiz calistirilamaz', () => {
  assert.match(codeOnly(INDEX), /policy\.oco === 'warn' && !reason[\s\S]{0,300}reasonRequired/);
});
test('D9 OCO zamanlama ScaleX icin KAPALI (schedule hook throw eder)', () => {
  assert.match(codeOnly(INDEX), /createOcoAwxSchedule:\s*async \(\) => \{[\s\S]{0,220}throw/);
});

// ── E. GIRDI DOGRULAMASI ────────────────────────────────────────────────────

const okBase = {
  namespace: 'ns-1',
  apps: ['app-a'],
  action: 'stop',
  executionMode: 'apply',
  verificationTimeout: '60',
};

test('E1 gecerli girdi kabul', () => {
  launch.assertValidTargets(okBase);
});
test('E2 namespace: buyuk harf red', () => {
  assert.throws(() => launch.assertValidTargets({ ...okBase, namespace: 'NS' }), /namespace/i);
});
test('E3 namespace: 63 karakter siniri', () => {
  launch.assertValidTargets({ ...okBase, namespace: 'a'.repeat(63) });
  assert.throws(
    () => launch.assertValidTargets({ ...okBase, namespace: 'a'.repeat(64) }),
    /namespace/i,
  );
});
test('E4 namespace: kabuk metakarakteri red', () => {
  for (const ns of ['a;b', 'a$b', 'a`b', 'a|b', 'a b', 'a&b', "a'b", 'a"b', 'a\\b', 'a/b']) {
    assert.throws(() => launch.assertValidTargets({ ...okBase, namespace: ns }), /namespace/i, ns);
  }
});
test('E5 namespace: bas/son tire red', () => {
  for (const ns of ['-a', 'a-'])
    assert.throws(() => launch.assertValidTargets({ ...okBase, namespace: ns }), /namespace/i, ns);
});
test('E6 namespace: nokta KABUL EDILMEZ (k8s ns kurali)', () => {
  assert.throws(() => launch.assertValidTargets({ ...okBase, namespace: 'a.b' }), /namespace/i);
});
test('E7 uygulama: nokta KABUL EDILIR', () => {
  launch.assertValidTargets({ ...okBase, apps: ['a.b-c'] });
});
test('E8 uygulama: 253 karakter siniri', () => {
  launch.assertValidTargets({ ...okBase, apps: ['a'.repeat(253)] });
  assert.throws(
    () => launch.assertValidTargets({ ...okBase, apps: ['a'.repeat(254)] }),
    /uygulama/i,
  );
});
test('E9 uygulama: metakarakter red', () => {
  for (const a of ['a;b', 'a b', 'a$b', 'A'])
    assert.throws(() => launch.assertValidTargets({ ...okBase, apps: [a] }), /uygulama/i, a);
});
test('E10 bos uygulama listesi red', () => {
  assert.throws(() => launch.assertValidTargets({ ...okBase, apps: [] }), /uygulama/i);
});
test('E11 gecersiz islem red', () => {
  assert.throws(() => launch.assertValidTargets({ ...okBase, action: 'delete' }), /işlem/i);
});
test('E12 gecersiz mod red', () => {
  assert.throws(() => launch.assertValidTargets({ ...okBase, executionMode: 'force' }), /mod/i);
});
test('E13 gecersiz timeout red', () => {
  for (const t of ['45', '0', '', 'abc'])
    assert.throws(
      () => launch.assertValidTargets({ ...okBase, verificationTimeout: t }),
      /süre/i,
      t,
    );
});
test('E14 scale: negatif/ondalik/bos red, 0 ve pozitif kabul', () => {
  const b = { ...okBase, action: 'scale' };
  for (const v of ['-1', '1.5', '', undefined, 'abc', '1e3'])
    assert.throws(
      () => launch.assertValidTargets({ ...b, targetReplicas: v }),
      /replica/i,
      String(v),
    );
  launch.assertValidTargets({ ...b, targetReplicas: '0' });
  launch.assertValidTargets({ ...b, targetReplicas: 12 });
});
test('E15 hatalar HTTP 400 tasir', () => {
  try {
    launch.assertValidTargets({ ...okBase, namespace: 'BAD' });
    assert.fail('atmali');
  } catch (e) {
    assert.equal(e.status, 400);
  }
});

// ── F. PATLAMA YARICAPI ─────────────────────────────────────────────────────

const radius = (o) => launch.computeBlastRadius({ action: 'stop', executionMode: 'apply', ...o });

test('F1 hedef = cluster x app', () => {
  assert.equal(
    radius({ clusters: ['a', 'b'], apps: ['x', 'y', 'z'], environment: 'test' }).targets,
    6,
  );
});
test('F2 bos secim 0 hedef', () => {
  assert.equal(radius({ clusters: [], apps: [], environment: 'test' }).targets, 0);
});
test('F3 prod tespiti prod ve production', () => {
  for (const e of ['prod', 'PROD', 'production', ' Production '])
    assert.equal(launch.isProdEnv(e), true, e);
  for (const e of ['test', 'preprod', 'prodx', '']) assert.equal(launch.isProdEnv(e), false, e);
});
test('F4 esik: tam esikte yazili onay ISTEMEZ, ustunde ister', () => {
  const at = radius({
    clusters: ['c'],
    apps: Array.from({ length: 5 }, (_, i) => `a${i}`),
    environment: 'prod',
  });
  const over = radius({
    clusters: ['c'],
    apps: Array.from({ length: 6 }, (_, i) => `a${i}`),
    environment: 'prod',
  });
  assert.equal(at.requiresWrittenConfirm, false);
  assert.equal(over.requiresWrittenConfirm, true);
});
test('F5 prod disi yazili onay istemez', () => {
  assert.equal(
    radius({
      clusters: ['a', 'b', 'c'],
      apps: Array.from({ length: 10 }, (_, i) => `a${i}`),
      environment: 'test',
    }).requiresWrittenConfirm,
    false,
  );
});
test('F6 dry_run hicbir onay istemez', () => {
  const r = launch.computeBlastRadius({
    clusters: ['a', 'b'],
    apps: Array.from({ length: 10 }, (_, i) => `x${i}`),
    environment: 'prod',
    action: 'stop',
    executionMode: 'dry_run',
  });
  assert.equal(r.requiresWrittenConfirm, false);
  assert.equal(r.requiresSecondPerson, false);
});
test('F7 ikinci kisi: prod + >1 cluster', () => {
  assert.equal(
    radius({ clusters: ['a', 'b'], apps: ['x'], environment: 'prod' }).requiresSecondPerson,
    true,
  );
  assert.equal(
    radius({ clusters: ['a'], apps: ['x'], environment: 'prod' }).requiresSecondPerson,
    false,
  );
  assert.equal(
    radius({ clusters: ['a', 'b'], apps: ['x'], environment: 'test' }).requiresSecondPerson,
    false,
  );
});
test('F8 MAX_TARGETS asimi isaretlenir', () => {
  const r = radius({
    clusters: Array.from({ length: 11 }, (_, i) => `c${i}`),
    apps: Array.from({ length: 20 }, (_, i) => `a${i}`),
    environment: 'test',
  });
  assert.equal(r.targets, 220);
  assert.equal(r.exceedsMaxTargets, true);
});
test('F9 MAX_TARGETS sunucuda GERCEKTEN uygulaniyor', () => {
  assert.match(codeOnly(INDEX), /exceedsMaxTargets[\s\S]{0,300}status:\s*400/);
});

// ── G. SAPMA ────────────────────────────────────────────────────────────────

const M = (c, a) => ({
  id: `${c}-${a}`,
  env: 'e',
  tenant: 't',
  clusterName: c,
  namespace: 'n',
  appName: a,
});
const C = (c, a) => ({ env: 'e', tenant: 't', clusterName: c, namespace: 'n', appName: a });

test('G1 in_sync', () => {
  assert.equal(
    state.classifyDrift({
      mirrorRows: [M('c', 'a')],
      clusterStates: [C('c', 'a')],
      scannedClusters: ['c'],
    })[0].drift,
    state.DRIFT.IN_SYNC,
  );
});
test('G2 missing_on_cluster', () => {
  assert.equal(
    state.classifyDrift({ mirrorRows: [M('c', 'a')], clusterStates: [], scannedClusters: ['c'] })[0]
      .drift,
    state.DRIFT.MISSING_ON_CLUSTER,
  );
});
test('G3 unknown_to_portal', () => {
  const o = state.classifyDrift({
    mirrorRows: [],
    clusterStates: [C('c', 'a')],
    scannedClusters: ['c'],
  })[0];
  assert.equal(o.drift, state.DRIFT.UNKNOWN_TO_PORTAL);
  assert.equal(o.source, 'cluster');
});
test('G4 taranmayan cluster: karar YOK', () => {
  assert.equal(
    state.classifyDrift({
      mirrorRows: [M('c2', 'a')],
      clusterStates: [],
      scannedClusters: ['c1'],
    })[0].drift,
    null,
  );
});
test('G5 ayni ad farkli namespace KARISMAZ', () => {
  const m = { ...M('c', 'a'), namespace: 'ns1' };
  const cl = { ...C('c', 'a'), namespace: 'ns2' };
  const out = state.classifyDrift({ mirrorRows: [m], clusterStates: [cl], scannedClusters: ['c'] });
  assert.equal(out.length, 2, 'farkli namespace ayri kayit olmali');
  assert.equal(out[0].drift, state.DRIFT.MISSING_ON_CLUSTER);
});
test('G6 ayni ad farkli cluster KARISMAZ', () => {
  const out = state.classifyDrift({
    mirrorRows: [M('c1', 'a')],
    clusterStates: [C('c2', 'a')],
    scannedClusters: ['c1', 'c2'],
  });
  assert.equal(out.length, 2);
});
test('G7 bos girdi bos cikti', () => {
  assert.deepEqual(state.classifyDrift({}), []);
});
test('G8 DRIFT sabitleri DB varsayilaniyla uyumlu', () => {
  assert.deepEqual(Object.values(state.DRIFT).sort(), [
    'in_sync',
    'missing_on_cluster',
    'unknown_to_portal',
  ]);
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
  assert.deepEqual(
    keys.sort(),
    [
      'allow_partial_execution',
      'bulk_change_confirmation',
      'scalex_clusters_override',
      'scalex_target_clusters',
      'change_confirmation',
      'cluster_selection_mode',
      'execution_mode',
      'mail_to',
      'operation_action',
      'target_app_names',
      'target_cluster_name',
      'target_environment',
      'target_namespace',
      'target_platform',
      'verification_timeout',
    ].sort(),
    'extra_vars kumesi degisti — scale/PORTAL.md ve playbook ile birlikte guncelle',
  );
});

test('H2 kesif extra_vars anahtar kumesi SABIT', () => {
  const code = codeOnly(INDEX);
  const i = code.indexOf('const extraVars = {');
  const block = code.slice(i, code.indexOf('};', i));
  for (const k of [
    'scalex_clusters_override',
    'target_platform',
    'target_environment',
    'target_namespace',
    'scalex_target_clusters',
    'discovery_mode',
  ]) {
    assert.ok(block.includes(`${k}:`), `kesif ${k} gondermiyor`);
  }
});

test("H3 katalog playbook assert'inin istedigi TUM alanlari tasir", () => {
  const c = launch.buildScaleXClusterCatalog({
    env: 'prod',
    tenant: 'ark',
    clusters: ['c1'],
    hosts: { c1: 'j1' },
    meta: { c1: { api_url: 'https://api.x:6443', vault_credential_key: 'k' } },
  }).clusters.c1;
  // `02_select_targets.yml` "Validate selected cluster records" bunlari ZORUNLU tutuyor.
  for (const f of ['enabled', 'platform', 'environments', 'jump_server', 'api_url', 'credential']) {
    assert.ok(f in c, `katalogda ${f} yok — playbook assert'i duser`);
  }
  assert.equal(c.version, undefined);
});

test("H4 api_url playbook regex'ini saglar", () => {
  const RE = /^https:\/\/[^/]+:[0-9]+\/?$/; // 02_select_targets.yml ile AYNI
  const c = launch.buildScaleXClusterCatalog({
    env: 'e',
    tenant: 't',
    clusters: ['c1'],
    hosts: { c1: 'j' },
    meta: {
      c1: { api_url: 'https://api.gbocpprod1.fw.garanti.com.tr:6443', vault_credential_key: 'k' },
    },
  }).clusters.c1;
  assert.match(c.api_url, RE);
});

test('H5 katalog version 1 (playbook bunu assert ediyor)', () => {
  assert.equal(
    launch.buildScaleXClusterCatalog({ env: 'e', tenant: 't', clusters: [], hosts: {}, meta: {} })
      .version,
    1,
  );
});

test('H6 environments DIZI (playbook `in` operatoru kullaniyor)', () => {
  const c = launch.buildScaleXClusterCatalog({
    env: 'prod',
    tenant: 'ark',
    clusters: ['c'],
    hosts: { c: 'j' },
    meta: { c: {} },
  }).clusters.c;
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
  const published = [
    'overall_status',
    'mode',
    'action',
    'namespace',
    'platform',
    'environment',
    'catalog_source',
    'cluster_mode',
    'clusters',
    'apps',
    'target_replicas',
    'strict_blocked',
    'counts',
    'targets',
    'targets_truncated',
    'targets_total',
    'rows',
    'rows_truncated',
    'rows_total',
    'job_id',
  ];
  const code = codeOnly(fs.readFileSync(path.join(SRC_DIR, 'result.cjs'), 'utf8'));
  for (const f of published) assert.ok(code.includes(`raw.${f}`), `result.cjs raw.${f} okumuyor`);
});

test('H11 kesif sonuc okuyucusu playbook alanlariyla eslesir', () => {
  const published = [
    'overall_status',
    'mode',
    'namespace',
    'platform',
    'environment',
    'catalog_source',
    'clusters',
    'failed_clusters',
    'counts',
    'items',
  ];
  const code = codeOnly(fs.readFileSync(path.join(SRC_DIR, 'result.cjs'), 'utf8'));
  for (const f of published) assert.ok(code.includes(`raw.${f}`), `result.cjs raw.${f} okumuyor`);
});

test("H12 playbook registry anahtarlari kodda ve seed'de AYNI", () => {
  const setup = fs.readFileSync(path.join(SRC_DIR, '..', 'db', 'mssql-setup.cjs'), 'utf8');
  for (const key of ['scalex_run', 'scalex_discovery']) {
    assert.ok(INDEX.includes(`'${key}'`), `index.cjs ${key} kullanmiyor`);
    assert.ok(setup.includes(`key_name: '${key}'`), `seed'de ${key} yok`);
  }
});

test('H13 element anahtari ekran/route/seed uclusunde AYNI', () => {
  const setup = fs.readFileSync(path.join(SRC_DIR, '..', 'db', 'mssql-setup.cjs'), 'utf8');
  const elements = fs.readFileSync(
    path.join(SRC_DIR, '..', '..', 'src', 'config', 'elements.ts'),
    'utf8',
  );
  assert.ok(setup.includes("element_key: 'ScaleX'"));
  assert.ok(elements.includes('id: "ScaleX"'));
  assert.ok(INDEX.includes("requireVisiblePrefix('ScaleX')"));
});

test('H14 tablolar semada tanimli', () => {
  const setup = fs.readFileSync(path.join(SRC_DIR, '..', 'db', 'mssql-setup.cjs'), 'utf8');
  for (const t of [
    'scalex_operations',
    'scalex_state_mirror',
    'logx_v2_restriction_group_grants',
  ]) {
    assert.ok(setup.includes(`name: '${t}'`), `${t} semada yok`);
    assert.ok(setup.includes(`CREATE TABLE ${t}`), `${t} CREATE TABLE yok`);
  }
});

test('H15 kodun yazdigi her sutun semada VAR', () => {
  const setup = fs.readFileSync(path.join(SRC_DIR, '..', 'db', 'mssql-setup.cjs'), 'utf8');
  const ddl = setup.slice(
    setup.indexOf('CREATE TABLE scalex_operations'),
    setup.indexOf(')`', setup.indexOf('CREATE TABLE scalex_operations')),
  );
  const i = codeOnly(INDEX).indexOf('INSERT INTO scalex_operations');
  const cols =
    (codeOnly(INDEX)
      .slice(i, i + 500)
      .match(/\(([^)]*)\)\s*\n?\s*VALUES/) || [])[1] || '';
  for (const c of cols
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)) {
    assert.ok(new RegExp(`\\b${c}\\s`).test(ddl), `scalex_operations.${c} semada yok`);
  }
});

// ═══ I. YENIDEN ADLANDIRMA + YENI DAVRANIS (merge oncesi ikinci tur) ═══════

// Bu UC dosya eski adi ARAMAK zorunda oldugu icin muaf; baska hicbir dosya degil.
// `scalex-awx-package.test.cjs` P8 bekcisi raporun eski urun adini tasimadigini
// dogruluyor — bunu yapabilmek icin metni icermek ZORUNDA.
const RENAME_GUARD_FILES = [
  'scalex-validation.test.cjs',
  'scalex-ui-validation.test.cjs',
  'scalex-awx-package.test.cjs',
];

test('I1 portal kaynaginda HIC "chaos" kalmadi (yorumlar dahil)', () => {
  // Ad degisikligi mekanikti; unutulan tek bir gecis, calisma aninda 404 ya da
  // "tablo yok" olarak ortaya cikardi. Yorumlar da taranir: yanlis ad tasiyan bir
  // yorum, sonraki okuyucuyu yanlis yere gonderir.
  const roots = [path.join(SRC_DIR, '..'), path.join(SRC_DIR, '..', '..', 'src')];
  const offenders = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist'].includes(e.name)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(cjs|ts|tsx)$/.test(e.name)) continue;
      // ADI ARAYAN BEKCILER kendileri o kelimeyi zorunlu olarak icerir (arama deseni,
      // eski onek ornekleri). Kendi metniyle eslesen test bu depoda birkac kez yapilan
      // bir hata; iki bekci dosyasi ACIKCA ve gerekcesiyle disarida birakiliyor.
      // Baska hicbir dosya muaf DEGIL.
      if (RENAME_GUARD_FILES.includes(e.name)) continue;
      const txt = fs.readFileSync(full, 'utf8');
      // IKI ESKI AD BILEREK duruyor; aramadan cikariliyor ki mesru kullanim yanlis
      // alarm vermesin:
      //   * `chaos-scale-state-` — durum kaydinin eski oneki. Cift-okuma tasimasi onu
      //     okumak ZORUNDA, yoksa bugun durdurulmus uygulamalar geri alinamaz.
      //   * `chaos-scale-job`    — bastion'daki gecici calisma dizini. Yeniden
      //     adlandirmak, ust dizinde yazma izni olmayan bir host'ta isi dusururdu
      //     (bkz. scalex_file/README.md). Sozlesmenin parcasi degil, gecici alan.
      const cleaned = txt.replace(/chaos-scale-state-|chaos-scale-job/g, '');
      if (/chaos/i.test(cleaned)) offenders.push(path.relative(process.cwd(), full));
    }
  };
  for (const r of roots) walk(r);
  assert.deepEqual(offenders, [], `eski ad kalmis:\n${offenders.join('\n')}`);
});

test('I2 route / element / registry / tablo adlari DORT yerde de tutarli', () => {
  const setup = fs.readFileSync(path.join(SRC_DIR, '..', 'db', 'mssql-setup.cjs'), 'utf8');
  const elements = fs.readFileSync(
    path.join(SRC_DIR, '..', '..', 'src', 'config', 'elements.ts'),
    'utf8',
  );
  const app = fs.readFileSync(path.join(SRC_DIR, '..', '..', 'src', 'App.tsx'), 'utf8');
  assert.ok(setup.includes("element_key: 'ScaleX'"));
  assert.ok(elements.includes('id: "ScaleX"') && elements.includes('route: "/scalex"'));
  assert.ok(app.includes('pageId="ScaleX"') && app.includes('path="/scalex"'));
  assert.ok(INDEX.includes("requireVisiblePrefix('ScaleX')"));
  assert.ok(INDEX.includes("'/api/scalex'"));
  for (const t of ['scalex_operations', 'scalex_state_mirror'])
    assert.ok(setup.includes(`CREATE TABLE ${t}`), t);
  for (const k of ['scalex_run', 'scalex_discovery'])
    assert.ok(setup.includes(`key_name: '${k}'`), k);
});

// ── HPA sabitleme kurallari ─────────────────────────────────────────────────

test('I3 HPA sabitleme `stop`ta ASLA sunulmaz', () => {
  // Replica 0'da HPA kendiliginden devre disi kalir; ustelik `minReplicas` 0 olamaz.
  assert.equal(launch.isHpaPinAllowed({ action: 'stop', targetReplicas: '0' }), false);
  assert.equal(launch.isHpaPinAllowed({ action: 'stop', targetReplicas: '5' }), false);
});

test('I4 HPA sabitleme hedef 0 olan `scale`de reddedilir', () => {
  assert.equal(launch.isHpaPinAllowed({ action: 'scale', targetReplicas: '0' }), false);
  assert.equal(launch.isHpaPinAllowed({ action: 'scale', targetReplicas: '1' }), true);
  assert.equal(launch.isHpaPinAllowed({ action: 'scale', targetReplicas: 3 }), true);
});

test('I5 HPA sabitleme `restore`de YALNIZCA hedef bilinip >= 1 iken sunulur', () => {
  // ESKIDEN kosulsuz `true` idi ve bu YANLISTI: `previous_replicas = 0` bilerek gecerli
  // bir geri alma hedefi (bkz. A25). Hedef 0 iken sabitleme ya API tarafindan reddedilir
  // (HPAScaleToZero kapali) ya da uygulamayi 0'da KILITLER — "geri al" hicbir seyi
  // ayaga kaldirmaz. Bilgi yoklugu artik "izin verme"ye cozunuyor.
  assert.equal(launch.isHpaPinAllowed({ action: 'restore', restoreTargets: [3, 2] }), true);
  assert.equal(launch.isHpaPinAllowed({ action: 'restore' }), false, 'hedef bildirilmediyse HAYIR');
  assert.equal(launch.isHpaPinAllowed({ action: 'restore', restoreTargets: [] }), false);
  assert.equal(
    launch.isHpaPinAllowed({ action: 'restore', restoreTargets: [3, 0] }),
    false,
    'tek bir 0 yeter',
  );
  assert.equal(
    launch.isHpaPinAllowed({ action: 'restore', restoreTargets: [null] }),
    false,
    'bilinmeyen hedef',
  );
});

test('I6 `hpa_pin` extra_var yalnizca izinli durumda gonderilir', () => {
  const code = codeOnly(LAUNCH);
  assert.match(
    code,
    /hpaPin && action !== 'stop'[\s\S]{0,80}hpa_pin: 'true'/,
    '`stop`ta hpa_pin gonderilirse playbook minReplicas=0 denemeye calisir',
  );
});

test('I7 client `hpaPin` gonderse bile kural SUNUCUDA uygulanir', () => {
  // KURALI olcer, SATIR DUZENINI degil: eski hali `=== true && launch.` ifadesinin
  // ayni satirda olmasini sarta bagliyordu ve kural aynen dururken bir satir kaydirmasi
  // yuzunden kirmizi oluyordu.
  const code = codeOnly(INDEX).replace(/\s+/g, ' ');
  assert.match(
    code,
    /req\.body\?\.hpaPin === true && launch\.isHpaPinAllowed\(/,
    'client kendi kapisini yapilandiramamali',
  );
});

test('I8 HPA sabitleme denetim kaydina yaziliyor', () => {
  // HPA'ya dokunmak mevcut politikanin tersi — izinin kalmasi sart.
  assert.match(codeOnly(INDEX), /'scalex_operation'[\s\S]{0,400}hpaPin/);
});

// ── SMART/OCO kaynagi ───────────────────────────────────────────────────────

test('I9 SMART ayarlari URETIMDEKI tablodan okunuyor, env degiskeninden DEGIL', () => {
  const code = codeOnly(INDEX);
  assert.match(
    code,
    /ss-customizations\.cjs'\)\.readCustom\(/,
    'ayarlar ansible_ss_customizations tablosundan gelmeli (nginx isleriyle ayni yapi)',
  );
  assert.ok(
    !/SCALEX_SMART_FLOW_KEY|process\.env\.[A-Z_]*SMART/.test(code),
    'SMART ayari icin ikinci bir yapilandirma yuzeyi (env) olmamali',
  );
  assert.ok(!/smartApproval:\s*req\.body/.test(code), 'client kendi SMART ayarini gonderemez');
});

test('I10 ayar okuyucusu DB hatasinda BOS nesne doner (onay GEREKLI kalir)', async () => {
  const mod = require('../../ansible/ss-customizations.cjs');
  mod.invalidate();
  const orig = db.query;
  db.query = async () => {
    throw new Error('DB dustu');
  };
  try {
    assert.deepEqual(
      await mod.readCustom(1, 2),
      {},
      'bos smartApproval → smart-gate istisna listesinde hicbir kural tutmaz → onay gerekli',
    );
  } finally {
    db.query = orig;
    mod.invalidate();
  }
});

// ── Kesif sozlesmesinin yeni alanlari ───────────────────────────────────────

test("I11 GitOps etiketi ayrisiyor ve `no` null'a cevriliyor", () => {
  const withGit = disc({
    mode: 'workloads',
    items: [{ app: 'a', step: 'WORKLOAD', status: 'OK', detail: 'gitops=argocd:odeme-app' }],
  });
  const without = disc({
    mode: 'workloads',
    items: [{ app: 'b', step: 'WORKLOAD', status: 'OK', detail: 'gitops=no' }],
  });
  assert.equal(withGit.workloads[0].gitops, 'argocd:odeme-app');
  assert.equal(without.workloads[0].gitops, null, "'no' bir uyari DEGIL — rozet gosterilmemeli");
});

test('I12 PDB uyarisi namespace duzeyinde tasiniyor', () => {
  const r = disc({
    mode: 'workloads',
    items: [{ cluster: 'c', step: 'PDB', status: 'WARN', detail: 'PDB var: x(1/)' }],
  });
  assert.match(r.pdbWarning, /PDB var/);
  const none = disc({ mode: 'workloads', items: [] });
  assert.equal(none.pdbWarning, null);
});

test('I13 eski onekli durum kaydi `legacy` bayragiyla geliyor', () => {
  const r = disc({
    mode: 'state',
    items: [
      {
        app: 'a',
        step: 'STATE',
        status: 'OK',
        detail: 'cm=scalex-state-a legacy=no previous_replicas=1',
      },
      {
        app: 'b',
        step: 'STATE',
        status: 'OK',
        detail: 'cm=chaos-scale-state-b legacy=yes previous_replicas=2',
      },
    ],
  });
  assert.equal(r.states[0].legacy, false);
  assert.equal(r.states[1].legacy, true);
  // ESKI kayit da geri alinabilir olmali — tasimanin tum amaci bu.
  assert.equal(r.states[1].previousReplicas, 2);
});

// ═══ J. OLU KOD — "test edildi ama HICBIR YERDEN CAGRILMIYOR" ═════════════
//
// GERCEK OLAY: sapma tespiti (`classifyDrift` + `refreshDrift`) yazildi, birim testleri
// yesil geciyordu ve HICBIR UCTAN CAGRILMIYORDU. Ekran `driftStatus` gosteriyor ama
// deger asla `in_sync` disina cikamiyordu — "biri elle geri almis" mesaji ULASILAMAZ
// koddu. Birim testi saf fonksiyonu dogruluyor, onu KIMSENIN CAGIRMADIGINI gormuyor.
//
// Bu, bu oturumda ucuncu kez ayni sinif: fail-open kapi sozlesmesi, korlesen bekci ve
// simdi olu ozellik. Uc kez tekrarlanan bir hata mekanik olarak yakalanmali.

test('J1 scalex modullerinin disa actigi HER fonksiyon en az bir yerden cagriliyor', () => {
  const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.cjs'));
  // TANIMLAYAN DOSYA HARIC tarama. Ilk yazimda tum dosyalar tek metinde birlestiriliyor
  // ve "1'den fazla gecis" araniyordu; ama tanim dosyasi zaten IKI gecis uretir
  // (`function X` + `module.exports = { X }`), yani gercekten olu bir export 2 sayip
  // bekciden GECIYORDU. Nitekim `refreshDrift` tam olarak boyle kacmisti.
  const byFile = new Map();
  const collect = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', '__tests__'].includes(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        collect(full);
        continue;
      }
      // YORUMLAR ELENIR. Aksi halde bir sembolun ADINI yalnizca ANLATAN bir yorum
      // (ornegin "refreshDrift yazildi ama cagrilmiyordu" notu) kullanim sayilir ve
      // bekci kendi aciklamasini kanit sanar. Bu oturumda ayni tuzaga ucuncu dususum.
      if (/\.(cjs|ts|tsx)$/.test(e.name)) byFile.set(full, codeOnly(fs.readFileSync(full, 'utf8')));
    }
  };
  collect(path.join(SRC_DIR, '..'));
  collect(path.join(SRC_DIR, '..', '..', 'src'));

  // ASIL KURAL: bir sembol YALNIZCA tanimi ve export satirinda geciyorsa OLUDUR.
  // "Kendi dosyasi disinda kullanilmali" demek fazla kati olurdu — `nsKey`,
  // `classifyDrift` gibi ic yardimcilar kendi modullerinde kullanilip test icin
  // disa aciliyor; onlar olu DEGIL. `refreshDrift` ise hicbir yerde, kendi dosyasinda
  // bile cagrilmiyordu — yakalanmasi gereken tam olarak bu.
  const dead = [];
  for (const f of files) {
    const defPath = path.join(SRC_DIR, f);
    const mod = require(defPath);
    const own = byFile.get(defPath) || '';
    const others = [...byFile.entries()]
      .filter(([q]) => q !== defPath)
      .map(([, t]) => t)
      .join('\n');
    for (const name of Object.keys(mod)) {
      if (typeof mod[name] !== 'function') continue;
      const re = new RegExp(`\\b${name}\\b`);
      if (re.test(others)) continue; // baska dosya kullaniyor
      const stripped = own
        .split('\n')
        .filter((l) => !new RegExp(`^\\s*(async\\s+)?function\\s+${name}\\b`).test(l))
        .join('\n')
        .replace(/module\.exports\s*=\s*\{[\s\S]*?\};?/g, '');
      if (!re.test(stripped)) dead.push(`${f} → ${name}`); // yalnizca tanim + export
    }
  }
  assert.deepEqual(
    dead,
    [],
    `disa acilmis ama HICBIR YERDEN cagrilmiyor (test disinda):\n${dead.join('\n')}`,
  );
});

test('J2 sapma tazeleme GERCEKTEN bir uctan cagriliyor', () => {
  // J1 genel; bu ozel. Sapma, bu araciun "portal disindan is yapilmis" sinyalini veren
  // TEK mekanizmasi — kaybolursa ekran sessizce yalan soyler.
  assert.match(
    codeOnly(INDEX),
    /state\.refreshDrift\(\{/,
    'refreshDrift hicbir uctan cagrilmiyorsa drift_status asla in_sync disina cikmaz',
  );
  assert.match(
    codeOnly(INDEX),
    /parsed\.mode === 'state'/,
    'tazeleme `state` kesfinin bitisine bagli olmali',
  );
});

test('J3 `Olcekle` ile hedef 0 SUNUCUDA reddediliyor', () => {
  // Playbook durumu YALNIZCA `stop` dalinda saklar; "Olcekle -> 0" geri alinacak kayit
  // birakmaz ve uygulama portal icinden geri getirilemez hale gelir.
  assert.match(
    codeOnly(INDEX),
    /action === 'scale' && Number\(targetReplicas\) === 0[\s\S]{0,400}status: 400/,
  );
  assert.match(INDEX, /use_stop_for_zero/);
});

test('J4 toplu geri alma: gerekce ZORUNLU ve yetki suzgecinden geciyor', () => {
  const code = codeOnly(INDEX);
  const i = code.indexOf("'/restore-all'");
  assert.ok(i > 0, '/restore-all ucu yok');
  const body = code.slice(i, i + 2600);
  assert.match(body, /reasonRequired/, 'gerekcesiz toplu geri alma yapilabiliyor');
  assert.match(body, /filterStoppedForUser/, 'kullanicinin goremedigi namespace geri alinabiliyor');
  assert.match(
    body,
    /driftStatus === 'in_sync'/,
    'sapmis kayit geri alinmaya calisilirsa STATE;FAIL ile duser — kullaniciya yalanci bir "denendi" verir',
  );
});

// ── K: OCO kapisi ScaleX'te GERCEKTEN atesleniyor mu ────────────────────────
//
// Bu bolum, denetimde bulunan en ciddi acigi kilitler: kapi KODDA vardi, testte
// "gerekli" gorunuyordu, ama ScaleX icin HIC calismiyordu. `gatePolicyFor`in
// 'require' dondugunu dogrulamak yeterli DEGIL — kapinin uygulanabilir sayilmasi
// ayri bir kosula bagli ve kirilan yer orasiydi.

test('K1 ScaleX prod istegi PRODUCTION olarak taninir (extraVars `env` TASIMAZ)', () => {
  const { isProductionRequest } = require('../../oco/prod-detect.cjs');

  // ScaleX'in playbook sozlesmesi: ortam `target_environment` adiyla gider.
  // `env`/`ortam` YOK — prod tespiti tek basina buna bakarsa KOR kalir.
  const scalexExtraVars = {
    target_platform: 'ocp',
    target_environment: 'prod',
    target_namespace: 'ns',
    target_app_names: 'api',
    scalex_action: 'stop',
    execution_mode: 'apply',
  };
  assert.equal(
    isProductionRequest(scalexExtraVars),
    false,
    'sozlesme degismis: bu test artik korudugu seyi olcmuyor, K2 ile birlikte gozden gecir',
  );

  const gateVars = launch.buildGateVars({
    env: 'prod',
    tenant: 'ocp',
    action: 'stop',
    executionMode: 'apply',
    clusters: [{}],
    namespace: 'ns',
  });
  assert.equal(
    isProductionRequest(gateVars),
    true,
    'buildGateVars `env`/`ortam` tasimali — OCO prod tespitinin TEK kaynagi bu',
  );
});

test('K2 OCO kapisi ScaleX prod istegi icin UYGULANABILIR sayilir', () => {
  const gates = require('../../ansible/change-gates.cjs');
  const scalexExtraVars = { target_environment: 'prod', scalex_action: 'stop' };
  const gateVars = launch.buildGateVars({
    env: 'prod',
    tenant: 'ocp',
    action: 'stop',
    executionMode: 'apply',
    clusters: [{}],
    namespace: 'ns',
  });

  // ESKI KOD BURADA DUSER: `isOcoGateApplicable(overrides, extraVars)` yalnizca
  // extraVars'e bakiyordu ve ScaleX'te false donuyordu → prod'da kesinti penceresi
  // dogrulanmadan replica 0'a inilebiliyordu.
  assert.equal(
    gates.isOcoGateApplicable({ ocoCheck: { enabled: true } }, scalexExtraVars, gateVars),
    true,
    'OCO kapisi ScaleX prod isteginde ATESLENMIYOR — kesinti penceresi hic dogrulanmaz',
  );
});

test('K3 birlesim kapiyi yalnizca ACAR: prod olmayan istek etkilenmez', () => {
  const gates = require('../../ansible/change-gates.cjs');
  const gateVars = launch.buildGateVars({
    env: 'test',
    tenant: 'ocp',
    action: 'stop',
    executionMode: 'apply',
    clusters: [{}],
    namespace: 'ns',
  });
  assert.equal(
    gates.isOcoGateApplicable(
      { ocoCheck: { enabled: true } },
      { target_environment: 'test' },
      gateVars,
    ),
    false,
    'prod olmayan istek OCO kapisina takiliyor',
  );

  // Self Service davranisi KORUNUR: `extraVars`te prod varsa, `gateVars` bos olsa
  // bile kapi calismali (guvenilmez kaynaktan gelen env `gateVars`ten atiliyor).
  assert.equal(
    gates.isOcoGateApplicable({ ocoCheck: { enabled: true } }, { env: 'prod' }, {}),
    true,
    'Self Service OCO davranisi ZAYIFLADI — extraVars prod yolu kapanmis',
  );

  // Admin kapiyi kapattiysa hicbir kaynak onu acmaz.
  assert.equal(
    gates.isOcoGateApplicable({ ocoCheck: { enabled: false } }, { env: 'prod' }, gateVars),
    false,
    'kapali OCO ayari gorusmezden geliniyor',
  );
});

// ── L. KAPI ORTAMA BAGLI (2026-09-01 kullanici karari) ──────────────────────
//
// KURAL: onay kapilari (OCO + SMART) YALNIZCA production'da. Prod disinda hicbir
// onay istenmez — ama degisiklik IZI gevsemez (audit + `scalex_operations`).
//
// Bu bekçiler bir EKRAN hatasini kilitliyor: sunucu tarafi zaten dogruydu
// (`change-gates.isOcoGateApplicable` prod degilse kapiyi hic acmiyordu, bkz. K3),
// ama `gatePolicyFor` ortami GORMEDIGI icin `/preview` test ortaminda da
// `oco: 'require'` donuyor, `PreviewStep.tsx` OCO numarasi isteyip "Calistir"
// butonunu kilitliyordu. Kullanici sunucunun HIC KULLANMAYACAGI bir numara
// yazmaya zorlaniyordu.

test('L1 prod disi apply: HICBIR kapi (oco ve smart skip)', () => {
  for (const env of ['test', 'dev', 'qa', 'lab', 'edu', 'cicd']) {
    for (const a of ['stop', 'scale', 'restore']) {
      const p = launch.gatePolicyFor({ action: a, executionMode: 'apply', environment: env });
      assert.deepEqual(
        [p.oco, p.smart],
        ['skip', 'skip'],
        `${env}/${a}: prod disi ortamda onay kapisi aciliyor`,
      );
    }
  }
});

test('L2 prod apply: kapilar AYNEN duruyor (gevsememeli)', () => {
  const stop = launch.gatePolicyFor({
    action: 'stop',
    executionMode: 'apply',
    environment: 'prod',
  });
  assert.deepEqual([stop.oco, stop.smart], ['require', 'require'], 'prod stop kapisi gevsemis');
  const rest = launch.gatePolicyFor({
    action: 'restore',
    executionMode: 'apply',
    environment: 'production',
  });
  assert.deepEqual([rest.oco, rest.smart], ['warn', 'require'], 'prod restore kapisi gevsemis');
  // Buyuk harf / bosluk: `isProdEnv` normalize eder. Etmezse prod korumasi kacar.
  const upper = launch.gatePolicyFor({
    action: 'stop',
    executionMode: 'apply',
    environment: '  PROD ',
  });
  assert.deepEqual(
    [upper.oco, upper.smart],
    ['require', 'require'],
    'PROD buyuk harfle prod sayilmiyor',
  );
});

test('L3 ORTAM BILINMIYORSA prod sayilir (bilgi yoklugu kapiyi ACAR)', () => {
  // Yeni bir cagiran `environment` gecirmeyi unutursa prod korumasi SESSIZCE
  // kaybolmamali. `isProdEnv(undefined)` false doner — o yola dusulurse kapi kapanirdi.
  for (const env of [undefined, null, '', '   ']) {
    const p = launch.gatePolicyFor({ action: 'stop', executionMode: 'apply', environment: env });
    assert.deepEqual(
      [p.oco, p.smart],
      ['require', 'require'],
      `environment=${JSON.stringify(env)}: bilinmeyen ortamda kapi kapanmis`,
    );
  }
});

test('L4 dry_run her ortamda kapisiz (prod dahil)', () => {
  for (const env of ['prod', 'test', undefined]) {
    const p = launch.gatePolicyFor({ action: 'stop', executionMode: 'dry_run', environment: env });
    assert.deepEqual([p.oco, p.smart], ['skip', 'skip'], String(env));
  }
});

test('L5 kapi politikasini soran HER uc ortami GERCEKTEN geciriyor', () => {
  // Saf fonksiyon dogru olsa bile cagiran `environment`i gecirmezse o uc yine
  // yanlis kapi uygular (`gatePolicyFor` ortam bilinmiyorken prod'a duser, yani
  // prod disi bir istekte gereksiz onay ISTER). `/preview`, `/run` ve
  // `/restore-all` — ucu de.
  const code = codeOnly(INDEX);
  const calls = code.match(/gatePolicyFor\(\{[^}]*\}\)/g) || [];
  assert.equal(calls.length, 3, `gatePolicyFor cagrisi sayisi degismis: ${calls.length}`);
  for (const c of calls) {
    assert.match(c, /environment:\s*env/, `ortam gecirilmeyen gatePolicyFor cagrisi: ${c}`);
  }
});

// ── M. PLAYBOOK KAYDI COZUMLEME (2026-09-01) ────────────────────────────────
//
// `resolveByKey` uzun sure `async` DEGILDI ve `playbookRegistry.getByKey()`i
// `await` ETMIYORDU. `getByKey` bir Promise doner:
//   * Promise TRUTHY'dir → `!row` kontrolu gecer
//   * `row.enabled` `undefined`'dir → `=== false` DEGIL, o kontrol de gecer
//   * `getEffectiveTemplateId(promise)` hem `awxTemplateId` hem `envVarName` icin
//     `undefined` gorur → HER ZAMAN `null` doner
// Sonuc: Admin > Playbook Kayitlari'ndan Template ID girilse de, `.env` doldurulsa
// da HER `/run` ve `/discover` cagrisi 501 "Template ID girilmemis" ile duserdi —
// yani ScaleX hic calismiyordu. Dogru desen OpsX'te zaten var
// (`server/opsx/index.cjs` `async resolveByKey` + `await getByKey`).

const REGISTRY_PATH = require.resolve('../../ansible/playbook-registry.cjs');
const SCALEX_INDEX_PATH = require.resolve('../index.cjs');

// Registry'yi PROMISE DONEN sahte bir modulle degistirip index.cjs'i tazeden yukler.
async function withStubbedRegistry(row, fn) {
  const savedReg = require.cache[REGISTRY_PATH];
  const savedIdx = require.cache[SCALEX_INDEX_PATH];
  const real = require('../../ansible/playbook-registry.cjs');

  const mod = new Module(REGISTRY_PATH, null);
  mod.exports = {
    ...real,
    // GERCEK IMZA: `async` — yani Promise doner. Testin degeri burada.
    getByKey: async (keyName) => (row && row.keyName === keyName ? row : null),
  };
  mod.loaded = true;
  require.cache[REGISTRY_PATH] = mod;
  delete require.cache[SCALEX_INDEX_PATH];
  const scalex = require(SCALEX_INDEX_PATH);
  try {
    return await fn(scalex);
  } finally {
    if (savedReg) require.cache[REGISTRY_PATH] = savedReg;
    else delete require.cache[REGISTRY_PATH];
    delete require.cache[SCALEX_INDEX_PATH];
    if (savedIdx) require.cache[SCALEX_INDEX_PATH] = savedIdx;
  }
}

test('M1 resolveByKey DB satirindaki Template ID ile cozuluyor (await eksikse 501 duser)', async () => {
  await withStubbedRegistry(
    {
      keyName: 'scalex_run',
      enabled: true,
      awxTemplateId: 4711,
      awxServerId: 2,
      envVarName: 'SCALEX_TEMPLATE_ID',
    },
    async (scalex) => {
      const out = await scalex.resolveByKey('scalex_run');
      assert.deepEqual(
        out,
        { templateId: 4711, serverId: 2, keyName: 'scalex_run' },
        'Template ID cozulemedi — `getByKey` await edilmiyor olabilir (ScaleX hic calismaz)',
      );
    },
  );
});

test('M2 DB bos ise .env yedegine duser', async () => {
  const saved = process.env.SCALEX_TEMPLATE_ID;
  const savedSrv = process.env.SCALEX_AWX_SERVER_ID;
  process.env.SCALEX_TEMPLATE_ID = '9090';
  delete process.env.SCALEX_AWX_SERVER_ID;
  try {
    await withStubbedRegistry(
      {
        keyName: 'scalex_run',
        enabled: true,
        awxTemplateId: null,
        awxServerId: null,
        envVarName: 'SCALEX_TEMPLATE_ID',
      },
      async (scalex) => {
        const out = await scalex.resolveByKey('scalex_run');
        assert.equal(out.templateId, 9090, 'env yedegi okunmuyor');
        assert.equal(out.serverId, 1, 'sunucu yedegi 1 olmali');
      },
    );
  } finally {
    if (saved === undefined) delete process.env.SCALEX_TEMPLATE_ID;
    else process.env.SCALEX_TEMPLATE_ID = saved;
    if (savedSrv !== undefined) process.env.SCALEX_AWX_SERVER_ID = savedSrv;
  }
});

test('M3 kayit yok / pasif / ID bos → 501 (fail-closed, sessizce calismaz)', async () => {
  const cases = [
    [null, 'kayit yok'],
    [{ keyName: 'scalex_run', enabled: false, awxTemplateId: 5 }, 'pasif kayit'],
    [
      {
        keyName: 'scalex_run',
        enabled: true,
        awxTemplateId: null,
        envVarName: 'SCALEX_YOK_BOYLE_BIR_DEGISKEN',
      },
      'ID bos',
    ],
  ];
  for (const [row, label] of cases) {
    await withStubbedRegistry(row, async (scalex) => {
      await assert.rejects(
        () => scalex.resolveByKey('scalex_run'),
        (e) => e.status === 501,
        `${label}: 501 beklenirken baska sonuc dondu`,
      );
    });
  }
});

test('M4 resolveByKey ASYNC olmali (imza bekcisi)', () => {
  const code = codeOnly(INDEX);
  assert.match(
    code,
    /async function resolveByKey\(/,
    "resolveByKey async degil — getByKey Promise doner, senkron okumak templateId'yi hep null yapar",
  );
  // Her cagirma yeri de await almali; biri unutulursa o yol yine 501 doner.
  for (const m of code.match(/[^\n]*resolveByKey\([A-Za-z_]/g) || []) {
    if (/function resolveByKey/.test(m)) continue;
    assert.match(m, /await resolveByKey\(/, `await'siz resolveByKey cagrisi: ${m.trim()}`);
  }
});

// ── N. TOPLU GERI ALMA DA KAPIDAN GECER (2026-09-01) ────────────────────────
//
// `/restore-all` uzun sure kapisizdi: yorumu "`Geri Al`in kapi politikasini
// devralir" DIYORDU ama kod dogrudan `launchOnAwx` cagiriyordu. Prod'da tekil
// geri alma SMART kaydi acarken toplu geri alma hicbir onay olmadan calisiyordu —
// yani kapi tek bir dugmeyle atlanabiliyordu.

test('N1 `/restore-all` ortak kapi govdesinden geciyor', () => {
  const code = codeOnly(INDEX);
  const bulk = code.slice(code.indexOf("router.post('/restore-all'"));
  assert.ok(bulk.length > 0, '/restore-all ucu bulunamadi');
  const body = bulk.slice(
    0,
    bulk.indexOf('router.post(', 10) >= 0 ? bulk.indexOf('router.post(', 10) : bulk.length,
  );
  assert.match(body, /await runScaleXGates\(/, 'toplu geri alma kapiyi HIC cagirmiyor');
  assert.match(
    body,
    /gatePolicyFor\(\{[^}]*action: 'restore'/,
    'toplu geri alma kendi politikasini uretmiyor',
  );
});

test('N2 kapi govdesi TEK — ikinci bir kopya yazilmamis', () => {
  const code = codeOnly(INDEX);
  // `runChangeGates` (ortak modul) yalnizca ORTAK govdeden cagrilmali. Ikinci bir
  // cagri, iki kapinin zamanla ayrismasi demek — `/restore-all` tam boyle kalmisti.
  const n = (code.match(/gates\.runChangeGates\(/g) || []).length;
  assert.equal(n, 1, `runChangeGates ${n} yerden cagriliyor — kapi govdesi cogalmis`);
});

test('N3 onay bekleyen is icin `scalex_operations` satiri YAZILIYOR', () => {
  const code = codeOnly(INDEX);
  assert.match(
    code,
    /pendingApproval && decision\.body\?\.ticketId[\s\S]{0,500}status: 'PENDING_APPROVAL'/,
    'SMART bileti acildiginda kayit yazilmiyor — onay gelince is calisir ama portal ogrenemez, ' +
      'ayna guncellenmez ve GERI ALMA YOLU KAPANIR',
  );
  assert.match(
    code,
    /smartTicketId: Number\(decision\.body\.ticketId\)/,
    'kayit bilete baglanmamis — uzlastirici onay sonucunu satira yazamaz',
  );
});

test('N4 kapi karari her durumda denetime yaziliyor (iz her ortamda)', () => {
  const code = codeOnly(INDEX);
  assert.match(
    code,
    /decision\?\.outcome !== 'proceed'[\s\S]{0,300}scalex_gate_decision/,
    'kapida duran calistirma ScaleX adina audit satiri birakmiyor',
  );
});

test('N5 admin kategori listesi seed ile AYRISMIYOR', () => {
  // Kategorisi ekrandaki listede olmayan bir registry satirini admin duzenleyip
  // kaydettiginde Select mevcut degeri gosteremez ve kategori SESSIZCE "genel"e
  // duser. `scalex_run`/`scalex_discovery` satirlari `category: 'scalex'` ile
  // seed ediliyor ve liste onu tanimiyordu.
  const setup = fs.readFileSync(path.join(SRC_DIR, '..', 'db', 'mssql-setup.cjs'), 'utf8');
  const tab = fs.readFileSync(
    path.join(SRC_DIR, '..', '..', 'src', 'components', 'admin', 'tabs', 'PlaybookRegistryTab.tsx'),
    'utf8',
  );

  const seeded = new Set((setup.match(/category: '([a-z_]+)'/g) || []).map((m) => m.slice(11, -1)));
  const listed = new Set(
    JSON.parse((tab.match(/const CATEGORIES = (\[[^\]]*\])/) || [])[1].replace(/"/g, '"')),
  );

  const missing = [...seeded].filter((c) => !listed.has(c)).sort();
  assert.deepEqual(
    missing,
    [],
    `Playbook Kayitlari ekranindaki kategori listesi eksik: ${missing.join(', ')} — bu satirlari duzenleyen admin kategoriyi "genel"e dusurur`,
  );
});

// ═══ O. KAPSAMSIZ "HIZLI AKSIYON" LISTESI (2026-09-02) ═════════════════════
//
// Panel artik sihirbazin ILK adiminda da gorunuyor, yani kapsam secilmeden TUM
// durdurulmus kayitlar listeleniyor. Yetki suzgeci bu yuzden anahtarlari SATIRIN
// KENDISINDEN kurmak zorunda; parametreden kurmak, farkli kapsamlardan gelen
// satirlarin hepsini tek bir kapsamin anahtariyla sorgulamak demekti ve
// `filterAllowed` VARSAYILAN-ACIK oldugu icin hicbiri eslesmeyince HEPSI gorunurdu.
// Sessiz bir fail-open; bu yuzden davranis testi sart.

const restrictionsMod = require('../../logx/v2/restrictions.cjs');
const catalogMod = require('../catalog.cjs');

async function withFilterAllowed(impl, fn) {
  const orig = restrictionsMod.filterAllowed;
  restrictionsMod.filterAllowed = impl;
  try {
    return await fn();
  } finally {
    restrictionsMod.filterAllowed = orig;
  }
}

const mirrorRow = (over = {}) => ({
  id: 1,
  env: 'prod',
  tenant: 'ark',
  clusterName: 'c1',
  namespace: 'odeme',
  appName: 'odeme-api',
  driftStatus: 'in_sync',
  phase: 'scaled_down',
  ...over,
});

test('O1 anahtar SATIRIN kendi env/tenant degerinden kuruluyor', async () => {
  let seen = null;
  await withFilterAllowed(
    async (_t, keys) => {
      seen = keys;
      return keys;
    },
    async () => {
      await catalogMod.filterStoppedForUser(
        [
          mirrorRow({ env: 'prod', tenant: 'ark' }),
          mirrorRow({ id: 2, env: 'test', tenant: 'wyden', namespace: 'kart' }),
        ],
        { user: { role: 'User', username: 'u' } }, // KAPSAM PARAMETRESI YOK
      );
    },
  );
  // `nsKey(tenant, env, cluster, ns)` — tenant ONCE. Ters sira da sessiz bir
  // fail-open uretirdi (uretilen anahtar hicbir kisit satiriyla eslesmez).
  assert.deepEqual(seen.sort(), ['ark/prod/c1/odeme', 'wyden/test/c1/kart'].sort());
});

test('O2 KISITLI bir satir GERCEKTEN suzuluyor (fail-open degil)', async () => {
  // `filterAllowed` yalnizca izinli anahtarlari geri dondurur. Suzgec anahtari
  // yanlis kurarsa donen liste bos olur ama satir yine de ekranda kalirdi.
  const rows = [mirrorRow({ id: 1, namespace: 'odeme' }), mirrorRow({ id: 2, namespace: 'gizli' })];
  const out = await withFilterAllowed(
    async (_t, keys) => keys.filter((k) => !k.endsWith('/gizli')),
    () => catalogMod.filterStoppedForUser(rows, { user: { role: 'User', username: 'u' } }),
  );
  assert.deepEqual(
    out.map((r) => r.namespace),
    ['odeme'],
    'kisitli namespace listede kaldi — yetki suzgeci anahtari yanlis kuruyor',
  );
});

test('O3 kapsam VERILDIGINDE eski davranis korunuyor', async () => {
  let seen = null;
  await withFilterAllowed(
    async (_t, keys) => {
      seen = keys;
      return keys;
    },
    async () => {
      // Satirda env/tenant OLMASA bile parametre yedek olarak kullanilir.
      await catalogMod.filterStoppedForUser([{ clusterName: 'c1', namespace: 'odeme' }], {
        env: 'prod',
        tenant: 'ark',
        user: { role: 'User', username: 'u' },
      });
    },
  );
  assert.deepEqual(seen, ['ark/prod/c1/odeme']);
});

test('O4 kapsamsiz liste AYRI ve SABIT bir SQL kullaniyor', () => {
  // `listMirror`a opsiyonel parametre eklemek hem C5 bekcisini bozar hem
  // `(($1 = '') OR env = $1)` gibi SARGable olmayan bir kosul uretirdi
  // (IX_scalexmirror_scope kullanilamaz).
  const code = codeOnly(STATE);
  assert.match(code, /async function listMirrorAll\(\)/, 'kapsamsiz okuyucu yok');
  const fn = code.slice(code.indexOf('async function listMirrorAll()'));
  assert.doesNotMatch(fn.slice(0, 400), /\$\{/, 'SQL icinde template interpolasyonu');
  assert.doesNotMatch(fn.slice(0, 400), /\$1/, 'kapsamsiz sorgu parametre almamali');
  // Tavan yetki suzgecinden ONCE uygulaniyor; siralama env/tenant ile baslamazsa
  // kullanicinin kaydi alfabetik olarak listeden dusebilir.
  assert.match(
    fn.slice(0, 400),
    /ORDER BY env, tenant/,
    'kapsamsiz listede siralama env/tenant ile baslamali',
  );
});

test('O5 kapsamsiz listeleme DENETIME yaziliyor', () => {
  // Varsayilan gorunurluk kapsaminin genislemesi bir politika karari — izlenmeli.
  assert.match(codeOnly(INDEX), /scalex_stopped_global/, 'kapsamsiz listeleme iz birakmiyor');
});

// ═══ P. IZ DUSUMU (2026-09-02) ════════════════════════════════════════════
//
// ScaleX yalnizca BASLATMA ANINI denetliyordu. Isin gercekten calisip calismadigi,
// uzlastiricinin verdigi kararlar, aynanin degismesi, sapma tespiti, kesfin sonucu
// ve baskasinin isine erisim denemesi denetim kaydinda HIC YOKTU.

test('P1 isin GERCEK SONUCU denetime yaziliyor', () => {
  const code = codeOnly(INDEX);
  assert.match(code, /scalex_finalize/, 'is sonucu iz birakmiyor');
  // `apply` kontrolunden ONCE olmali: "on kontrol kostu ve ne dedi" de denetlenebilir
  // olmali. Sonra yazilsaydi dry_run calistirmalari hic iz birakmazdi.
  const fin = code.slice(code.indexOf('async function finalizeOperation'));
  assert.ok(
    fin.indexOf('scalex_finalize') < fin.indexOf("parsed.mode !== 'apply'"),
    'sonuc izi `apply` kontrolunden SONRA — dry_run calistirmalari iz birakmaz',
  );
});

test('P2 ayna degisikligi, kesif sonucu ve yetkisiz erisim denemesi denetime yaziliyor', () => {
  const code = codeOnly(INDEX);
  for (const a of ['scalex_mirror_update', 'scalex_discovery_result', 'scalex_access_denied']) {
    assert.match(code, new RegExp(a), `${a} izi yok`);
  }
  // 403 donen yol iz BIRAKMALI: baskasinin prod kesinti isini gormeye calismak,
  // denetim kaydinda gorunmesi gereken tam olarak bu tur bir olay.
  const deny = code.slice(
    code.indexOf('async function denyIfNotOwner'),
    code.indexOf('async function resolveByKey'),
  );
  assert.match(deny, /scalex_access_denied/, 'yetkisiz erisim denemesi iz birakmiyor');
});

test('P3 uzlastiricinin KARARLARI denetime yaziliyor', () => {
  const rec = codeOnly(fs.readFileSync(path.join(SRC_DIR, 'reconciler.cjs'), 'utf8'));
  for (const a of [
    'scalex_reconcile_stale',
    'scalex_approval_adopted',
    'scalex_approval_resolved',
    'scalex_lock_released',
  ]) {
    assert.match(rec, new RegExp(a), `${a} izi yok`);
  }
  // Uzlastirici HTTP baglamı olmadan calisir; `auditPortal(null, ...)` desteklenir ve
  // kullanici adi acikca verilmeli, yoksa kayit 'system' olarak duser ve kimin isi
  // oldugu kaybolur.
  assert.match(rec, /username: 'system:scalex-reconciler'/, 'sistem aktoru isaretlenmemis');
});

test('P4 SAPMA yalnizca GERCEKTEN DEGISTIGINDE denetime yaziliyor', () => {
  const st = codeOnly(STATE);
  assert.match(st, /scalex_drift_detected/, 'sapma tespiti iz birakmiyor');
  // Her taramada ayni durumu tekrar yazmak, gercek degisimi gurultunun icinde
  // kaybederdi. `UPDATE ... AND drift_status <> $1` bunu SQL'de saglar.
  assert.match(st, /drift_status <> \$1/, 'degismeyen satirlar da yaziliyor');
});

test("P5 `result_json` 1 MB'i asinca da GECERLI JSON kalir", async () => {
  // Onceki hali `JSON.stringify(parsed).slice(0, 1_000_000)` idi: kirpma JSON-farkinda
  // DEGILDI, yani 1 MB'i asan bir sonucta alan `JSON.parse` edilemez hale geliyordu ve
  // bu SESSIZDI. Bu test GERCEK yolu kosturur ve DB'ye NE YAZILDIGINI olcer.
  const scalex = require('../index.cjs');

  // 1 MB'i acik ara asan bir sonuc: ~4000 satir x ~300 karakter.
  const parsed = {
    overallStatus: 'OK',
    stage: 'execution',
    mode: 'apply',
    action: 'stop',
    namespace: 'odeme',
    jobId: '1',
    counts: { ok: 1 },
    targets: Array.from({ length: 200 }, (_, i) => ({
      cluster: 'c1',
      app: `app-${i}`,
      kind: 'Deployment',
      status: 'OK',
      detail: 'x'.repeat(300),
    })),
    rows: Array.from(
      { length: 4000 },
      (_, i) => `c1;j1;app-${i};Deployment;VERIFY;OK;${'y'.repeat(300)}`,
    ),
  };

  const orig = db.query;
  const writes = [];
  db.query = async (sql, params) => {
    writes.push({ sql, params });
    if (/^\s*SELECT \* FROM scalex_operations/.test(sql)) {
      return {
        rows: [
          {
            id: 1,
            env: 'test',
            tenant: 'ark',
            namespace: 'odeme',
            username: 'u',
            cluster_name: 'c1',
            status: 'RUNNING',
            action: 'stop',
            execution_mode: 'apply',
          },
        ],
      };
    }
    return { rows: [], rowCount: 0 };
  };
  try {
    await scalex.finalizeOperation({
      serverId: 1,
      jobId: 42,
      status: { status: 'successful' },
      parsed,
    });
  } finally {
    db.query = orig;
  }

  const upd = writes.find(
    (w) => /UPDATE scalex_operations/.test(w.sql) && /result_json/.test(w.sql),
  );
  assert.ok(upd, 'sonuc kaydi hic yazilmadi');
  const stored = upd.params[3];
  assert.ok(stored.length <= 1000000, `kayit sinirin ustunde: ${stored.length}`);

  // ASIL OLCUT: gecerli JSON mu?
  const back = JSON.parse(stored); // eski kod BURADA patlardi
  assert.equal(back.overallStatus, 'OK', 'ozet alanlar kaybolmus');
  // Neyin atildigi SOYLENMELI — sessiz eksiklik, eksik veriden kotu.
  assert.equal(back.rowsDroppedForStorage, true, 'atilan alan bildirilmemis');
  assert.deepEqual(back.rows, [], 'ham satirlar hala icinde');
});

test('P5b sinirin ALTINDAKI sonuc oldugu gibi saklanir', async () => {
  const scalex = require('../index.cjs');
  const parsed = { overallStatus: 'OK', mode: 'dry_run', action: 'stop', rows: ['a'], targets: [] };
  const orig = db.query;
  const writes = [];
  db.query = async (sql, params) => {
    writes.push({ sql, params });
    if (/^\s*SELECT \* FROM scalex_operations/.test(sql)) {
      return {
        rows: [
          {
            id: 1,
            env: 'test',
            tenant: 'ark',
            namespace: 'n',
            username: 'u',
            cluster_name: 'c1',
            status: 'RUNNING',
            action: 'stop',
            execution_mode: 'dry_run',
          },
        ],
      };
    }
    return { rows: [], rowCount: 0 };
  };
  try {
    await scalex.finalizeOperation({
      serverId: 1,
      jobId: 7,
      status: { status: 'successful' },
      parsed,
    });
  } finally {
    db.query = orig;
  }
  const upd = writes.find((w) => /result_json/.test(w.sql));
  const back = JSON.parse(upd.params[3]);
  assert.deepEqual(back.rows, ['a'], 'kucuk sonuc gereksiz yere kirpilmis');
  assert.equal(back.rowsDroppedForStorage, undefined, 'gereksiz bayrak eklenmis');
});

test('P6 denetim sorgusu MODUL izini getirebiliyor', () => {
  // Onceden yalnizca TAM ESITLIK vardi: bir modulun izine bakmak icin aksiyon
  // adlarini tek tek ve ezberden yazmak gerekiyordu.
  const audit = codeOnly(fs.readFileSync(path.join(SRC_DIR, '..', 'audit', 'index.cjs'), 'utf8'));
  assert.match(audit, /actionPrefix/, 'modul izi filtresi yok');
  assert.match(audit, /action LIKE \$/, 'LIKE parametreli kullanilmiyor');
  assert.match(audit, /dateFrom/, 'tarih araligi filtresi yok');
  // Ekranda kutu vardi ama uc tarafinda HIC OKUNMUYORDU — olu bir filtre.
  assert.match(audit, /targetHost: req\.query\.targetHost/, 'targetHost filtresi hala olu');
});

// ═══ R. UYGULAMA LISTESI: ONCE DB, CANLI VERI SONRA (2026-09-02) ══════════

test("R1 uygulama listesi paylasilan katalogdan geliyor (AWX job'i ACMADAN)", () => {
  const cat = codeOnly(CATALOG);
  assert.match(cat, /async function listApps/, 'anlik uygulama listesi yok');
  assert.match(cat, /ocpCatalog\.getApps/, 'katalog okunmuyor — liste yine canli kesfi bekler');
  // `docs/OCP-NAMESPACE-KATALOGU-KARARI.md`: mimari ONUR'un karari. Bu degisiklik
  // onu DEGISTIRMIYOR, ScaleX'i ona BAGLIYOR — yani ScaleX kendi AWX kesfini
  // katalogun yerine koymuyor.
  const idx = codeOnly(INDEX);
  const ep = idx.slice(idx.indexOf("router.get('/apps'"), idx.indexOf("router.post('/discover'"));
  assert.doesNotMatch(ep, /launchOnAwx/, 'liste ucu AWX isi aciyor — anlik olmaz');
});

test('R2 CANLI veri onbelleklenmiyor', () => {
  // Bayat bir `restorable` "Geri Al"i ACAR ve is `STATE;FAIL` ile duser; bayat bir
  // `specReplicas` geri almayi YANLIS sayiya dondurur. Liste ucu yalnizca ad/tip
  // dondurmeli.
  const api = fs.readFileSync(path.join(SRC_DIR, '..', '..', 'src', 'api', 'scalexApi.ts'), 'utf8');
  const block = api.slice(api.indexOf('async apps('), api.indexOf('async stopped('));
  for (const alan of [
    'specReplicas',
    'readyReplicas',
    'hasHpa',
    'gitops',
    'restorable',
    'previousReplicas',
  ]) {
    assert.ok(!block.includes(alan), `liste ucu CANLI alan donduruyor: ${alan}`);
  }
});

test('R3 `ocp_app` kisiti LISTE yolunda da uygulaniyor', () => {
  // Bugune kadar uygulama bazli yetki yalnizca `resolveScope` ve `/adopt` yolunda
  // calisiyordu: kullanici goremedigi bir uygulamayi LISTEDE goruyor, yalnizca
  // calistiramiyordu.
  const cat = codeOnly(CATALOG);
  const fn = cat.slice(
    cat.indexOf('async function listApps'),
    cat.indexOf('async function assertClustersExist'),
  );
  assert.match(fn, /filterAllowed\('ocp_app'/, 'uygulama bazli yetki suzgeci yok');
  // Gizlenen sayisi SOYLENMELI: soylemeden "uygulama yok" demek yanlis bilgi olurdu.
  assert.match(fn, /hiddenCount/, 'gizlenen kayit sayisi bildirilmiyor');
});

test('R4 liste ucu namespace yetkisini ONCE dogruluyor', () => {
  // Goremedigi bir namespace'in uygulama ADLARINI listelemek, adlarin kendisini
  // sizdirmak olurdu.
  const idx = codeOnly(INDEX);
  const ep = idx.slice(idx.indexOf("router.get('/apps'"), idx.indexOf("router.post('/discover'"));
  assert.match(ep, /assertNamespaceAllowed/, 'namespace yetkisi dogrulanmiyor');
  assert.ok(
    ep.indexOf('assertNamespaceAllowed') < ep.indexOf('listApps'),
    'yetki kontrolu listeden SONRA — adlar once uretiliyor',
  );
});

// ═══ S. ADMIN EKRANI (2026-09-02) ═════════════════════════════════════════

test('S1 ScaleX SMART/OCO ayari KENDI sayfasindan yonetilebiliyor', () => {
  // Bugune kadar admin, ScaleX'in SMART ayarini yapabilmek icin ScaleX'in AWX
  // template'ini SELF SERVICE KATALOGUNA item olarak eklemek zorundaydi —
  // `FieldOverridesModal` yalnizca oradan ve Ansible sayfasindan aciliyordu.
  const tab = fs.readFileSync(
    path.join(SRC_DIR, '..', '..', 'src', 'components', 'admin', 'tabs', 'ScaleXAdminTab.tsx'),
    'utf8',
  );
  assert.match(tab, /FieldOverridesModal/, 'ayar modali acilmiyor');
  // YENI TABLO YOK: ayni `(awx_server_id, template_id)` satiri, template kimligi
  // `scalex_run` kaydindan cozuluyor.
  assert.match(tab, /scalex_run/, 'template kimligi registry kaydindan cozulmuyor');
  assert.match(tab, /awxServerId.*awxTemplateId/s, 'modal dogru satira baglanmamis');
});

test('S2 ScaleX sayfasi cluster/vault/bastion tablolarini KOPYALAMIYOR', () => {
  // Ikinci bir dogruluk kaynagi acmak, ayni prod cluster'in jump server'inin iki
  // yerde tutulmasi ve biri guncellenip digeri unutuldugunda ScaleX'in sessizce
  // yanlis bastion'a gitmesi demek olurdu.
  const tab = fs.readFileSync(
    path.join(SRC_DIR, '..', '..', 'src', 'components', 'admin', 'tabs', 'ScaleXAdminTab.tsx'),
    'utf8',
  );
  for (const t of ['ocp_cluster_index', 'ocp_vault_key_catalog', 'ocp_terminal_host_map']) {
    assert.ok(!tab.includes(t), `ScaleX sayfasi ${t} tablosuna dokunuyor`);
  }
});

test('S3 admin sekmeleri elements/seed ile AYRISMIYOR', () => {
  // Kayitsiz bir anahtar VARSAYILAN-GORUNUR sayilir: sekme goruntyor ama Sayfa
  // Erisimi ekranindan yonetilemiyor. `smarttickets`/`testscenarios`/`dbbackup`/
  // `flowtests` tam olarak bu durumdaydi.
  const page = fs.readFileSync(
    path.join(SRC_DIR, '..', '..', 'src', 'components', 'admin', 'AdminPage.tsx'),
    'utf8',
  );
  const elements = fs.readFileSync(
    path.join(SRC_DIR, '..', '..', 'src', 'config', 'elements.ts'),
    'utf8',
  );
  const seed = fs.readFileSync(path.join(SRC_DIR, '..', 'db', 'mssql-setup.cjs'), 'utf8');

  const tabIds = [...page.matchAll(/\{ id: "([a-z]+)",\s+label:/g)].map((m) => m[1]);
  assert.ok(tabIds.length >= 12, `sekme listesi okunamadi (${tabIds.length})`);
  const eksikElements = tabIds.filter((id) => !elements.includes(`admintab:${id}`));
  const eksikSeed = tabIds.filter((id) => !seed.includes(`admintab:${id}`));
  assert.deepEqual(
    eksikElements,
    [],
    `elements.ts'te eksik sekme(ler): ${eksikElements.join(', ')}`,
  );
  assert.deepEqual(eksikSeed, [], `seed'de eksik sekme(ler): ${eksikSeed.join(', ')}`);
});

test('S4 ortak sekmenin ANAHTARI korunmus, yalnizca ETIKETI degismis', () => {
  // Anahtar degisseydi kayitli gorunurluk kurallari ve kullanicinin sekme sirasi
  // tercihi sessizce gecersiz olurdu.
  const page = fs.readFileSync(
    path.join(SRC_DIR, '..', '..', 'src', 'components', 'admin', 'AdminPage.tsx'),
    'utf8',
  );
  assert.match(page, /\{ id: "logxv2",\s+label: "OCP Yapılandırma"/, 'ortak sekme adlandirilmamis');
  const seed = fs.readFileSync(path.join(SRC_DIR, '..', 'db', 'mssql-setup.cjs'), 'utf8');
  assert.match(
    seed,
    /admintab:logxv2/,
    'gorunurluk anahtari degismis — kayitli kurallar gecersiz olur',
  );
});

test('S5 denetim ekrani modul izi, tarih araligi ve CSV tasiyor', () => {
  const tab = fs.readFileSync(
    path.join(SRC_DIR, '..', '..', 'src', 'components', 'admin', 'tabs', 'AuditLogTab.tsx'),
    'utf8',
  );
  assert.match(tab, /actionPrefix/, 'modul izi filtresi gonderilmiyor');
  assert.match(tab, /dateFrom/, 'tarih araligi yok');
  assert.match(tab, /exportCsv/, 'CSV disari verme yok');
  // Kutu ekranda vardi ama deger sorguya HIC girmiyordu.
  assert.match(tab, /qs\.set\("targetHost"/, 'targetHost filtresi hala olu');
  // Bitis GUNUN SONUNU kapsamali: "2 Eylul" diyen kullanici o gunun kayitlarini ister.
  assert.match(tab, /T23:59:59/, 'bitis tarihi gunun sonunu kapsamiyor');
});

test('S6 SMART/OCO ekranlari modulu AYIRT EDIYOR', () => {
  // Iki tabloda da modulu ayirt eden bir KOLON YOK; ayirt edici
  // `(awx_server_id, awx_template_id)` cifti. Sunucu bunu playbook kayit
  // tablosundan cozuyor — `pendingLaunch.templateName` de bir ipucu ama STRING
  // ESLESMESI kirilgan.
  const runner = fs.readFileSync(path.join(SRC_DIR, '..', 'ansible', 'runner.cjs'), 'utf8');
  assert.match(runner, /async function resolveModuleTagger/, 'modul cozumleyicisi yok');
  assert.match(runner, /playbookRegistry\.getByKey/, 'kaynak playbook kayit tablosu degil');
  // HER IKI ekran da etiketlenmeli.
  const tickets = runner.slice(runner.indexOf('/api/ansible/ss/smart-tickets/all'));
  assert.match(tickets.slice(0, 3000), /module: moduleOf\(/, 'Smart Talepleri etiketlenmiyor');
  const oco = runner.slice(runner.indexOf('/api/ansible/ss/oco/scheduled/all'));
  assert.match(oco.slice(0, 2000), /module: moduleOf\(/, 'OCO Zamanlamalari etiketlenmiyor');

  // YENI KOLON EKLENMEDI: sema degismemeli.
  const setup = fs.readFileSync(path.join(SRC_DIR, '..', 'db', 'mssql-setup.cjs'), 'utf8');
  const smart = setup.slice(
    setup.indexOf("name: 'smart_tickets'"),
    setup.indexOf("name: 'smart_tickets'") + 1600,
  );
  assert.ok(!/\bmodule\s+NVARCHAR/i.test(smart), 'smart_tickets tablosuna gereksiz kolon eklenmis');
});

test('S7 ortak CRUD tablosu ARANABILIR', () => {
  // ~60 satirlik cluster listesinde filtre OLMAMASI en cok acitan eksikti.
  const t = fs.readFileSync(
    path.join(
      SRC_DIR,
      '..',
      '..',
      'src',
      'components',
      'admin',
      'tabs',
      'logxv2',
      'SimpleCrudTable.tsx',
    ),
    'utf8',
  );
  assert.match(t, /searchable/, 'arama destegi yok');
  // Arama TUM kolonlarda: kullanici aradiginin hangi kolonda oldugunu bilmek
  // zorunda kalmamali.
  assert.match(t, /columns\.some\(\(c\) => String\(r\[c\.key\]/, 'arama tum kolonlarda calismiyor');
  // Kisa listede kutu gosterilmemeli.
  assert.match(t, /rows\.length >= SEARCH_MIN_ROWS/, 'kisa listede de arama kutusu cikiyor');
  // Bos sonucta "kayit yok" demek yaniltici olurdu — arama yuzunden bos oldugu
  // SOYLENMELI.
  assert.match(t, /Aramaya uyan kayıt yok/, 'bos arama sonucu "kayit yok" gibi gosteriliyor');
});

// ── I. TOPLU GERI ALMA SOZLESMESI ───────────────────────────────────────────

test('I1 /restore-all buildRunExtraVars cagrisi hpaPin ve workloadKinds geciriyor', () => {
  // /run endpoint'i bu iki parametreyi GECIRIYORDU ama /restore-all UZUN SURE
  // atlamisti: toplu geri almada HPA pin uygulanmasi ve tip haritasi gonderilmesi
  // unutulmustu. Sonuc: bulk restore'da HPA minReplicas sabitlenmiyordu (risk) ve
  // "ayni ad iki tipte var" belirsizligi isi dusuruyordu (2026-09 TUR 1 tespiti).
  // Source-assertion: /restore-all handler blogunu bul ve icindeki buildRunExtraVars
  // cagrisinin her iki parametreyi de icerdigini dogrula.
  const restoreAllStart = INDEX.indexOf("router.post('/restore-all'");
  assert.ok(restoreAllStart >= 0, '/restore-all route bulunamadi');
  // Handler blogunun sonu: bir sonraki router.* tanimina kadar.
  const nextRoute = INDEX.indexOf('router.', restoreAllStart + 30);
  const block = INDEX.slice(restoreAllStart, nextRoute > 0 ? nextRoute : restoreAllStart + 5000);

  assert.match(
    block,
    /buildRunExtraVars/,
    '/restore-all buildRunExtraVars cagirmiyor — extra_vars hic olusmuyor',
  );
  assert.match(
    block,
    /hpaPin/,
    '/restore-all hpaPin gecirmiyor — toplu geri almada HPA pin uygulanmiyor',
  );
  assert.match(
    block,
    /workloadKinds/,
    '/restore-all workloadKinds gecirmiyor — tip haritasi eksik, auto belirsizligi riski',
  );
});

// ── T. SAPMA TAZELEME — CLUSTER-ONLY SATIRLAR (B4) ─────────────────────────
//
// GERCEK HATA: `refreshDrift`'teki `row.source !== 'portal'` filtresi, yalnizca
// cluster'da bulunan (`unknown_to_portal`) satirlari TUMUYLE atliyordu. Bu
// satirlarin `last_seen_at` degeri hicbir zaman guncellenmiyordu; StoppedPanel'in
// 7 gunluk "eski" esigi onlari haksiz yere "terk edilmis" gibi gosteriyordu.

test('T1 refreshDrift: cluster-only satirlar icin last_seen_at UPDATE atesi', async () => {
  // `listMirror` bir satir donecek (portal kaynakli), ayrica clusterStates'de
  // aynada OLMAYAN bir is yukusu var (cluster-only → unknown_to_portal).
  const portalRow = {
    id: 10,
    env: 'prod',
    tenant: 'ark',
    cluster_name: 'c1',
    clusterName: 'c1',
    namespace: 'odeme',
    app_name: 'odeme-api',
    appName: 'odeme-api',
    workload_kind: 'Deployment',
    previous_replicas: 2,
    phase: 'scaled_down',
    stopped_by: 'admin',
    stopped_at: null,
    operation_id: null,
    last_seen_at: new Date(),
    drift_status: 'in_sync',
  };
  const clusterOnly = {
    env: 'prod',
    tenant: 'ark',
    clusterName: 'c2',
    namespace: 'fatura',
    appName: 'fatura-svc',
    previousReplicas: 1,
    phase: 'running',
    stoppedBy: null,
    workloadKind: 'Deployment',
  };

  await withDb(
    (sql) => {
      // listMirror SELECT'i — portal satirini dondur.
      if (/SELECT.*scalex_state_mirror/i.test(sql)) {
        return { rows: [portalRow], rowCount: 1 };
      }
      // Tum UPDATE'ler basariyla donsun (rowCount önemli degil, sorgu ATESI onemli).
      return { rows: [], rowCount: 0 };
    },
    async (calls) => {
      await state.refreshDrift({
        env: 'prod',
        tenant: 'ark',
        scannedClusters: ['c1', 'c2'],
        clusterStates: [
          // c1/odeme aynada var → in_sync (portal kaynakli)
          {
            env: 'prod',
            tenant: 'ark',
            clusterName: 'c1',
            namespace: 'odeme',
            appName: 'odeme-api',
          },
          // c2/fatura aynada YOK → unknown_to_portal (cluster kaynakli)
          clusterOnly,
        ],
      });

      // ── BEKLENTI 1: portal satiri icin drift_status UPDATE ──
      const portalUpdates = calls.filter(
        (c) => /drift_status/i.test(c.sql) && c.params.includes(10),
      );
      assert.ok(
        portalUpdates.length >= 1,
        'portal kaynakli satir icin drift_status UPDATE atesi bekleniyor',
      );

      // ── BEKLENTI 2: cluster-only satiri icin last_seen_at UPDATE ──
      const clusterLastSeen = calls.filter(
        (c) =>
          /last_seen_at/i.test(c.sql) &&
          /cluster_name\s*=\s*\$3/i.test(c.sql) &&
          c.params.includes('c2') &&
          c.params.includes('fatura') &&
          c.params.includes('fatura-svc'),
      );
      assert.ok(
        clusterLastSeen.length >= 1,
        'cluster-only (unknown_to_portal) satiri icin last_seen_at UPDATE atesi bekleniyor — B4 hatasi',
      );
    },
  );
});

test('T2 refreshDrift: cluster-only satiri onCluster=false ise UPDATE ATESLENMEZ', async () => {
  // Eger classifyDrift cluster satirini onCluster=false yaparsa (bu senaryo
  // su an kodda yok, ama gelecekte eklenirse diye savunma testi).
  await withDb(
    (sql) => {
      if (/SELECT.*scalex_state_mirror/i.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    },
    async (calls) => {
      // Bos clusterStates → hic cluster-only satir uretilmez.
      await state.refreshDrift({
        env: 'prod',
        tenant: 'ark',
        scannedClusters: ['c1'],
        clusterStates: [],
      });
      const naturalKeyUpdates = calls.filter((c) => /cluster_name\s*=\s*\$3/i.test(c.sql));
      assert.equal(
        naturalKeyUpdates.length,
        0,
        'cluster-only satir yokken dogal anahtarli UPDATE ateslenmemeli',
      );
    },
  );
});

test('T3 refreshDrift: drift_status=null portal satirlari ATLANIR (taranmayan cluster)', async () => {
  // Taranmayan bir cluster'daki portal satirinin drift'i null olur; bu satir
  // icin UPDATE ateslenmemeli (eski davranis korunmali).
  const unscannedRow = {
    id: 20,
    env: 'prod',
    tenant: 'ark',
    cluster_name: 'c3',
    clusterName: 'c3',
    namespace: 'ns',
    app_name: 'app',
    appName: 'app',
    workload_kind: 'Deployment',
    previous_replicas: 1,
    phase: 'scaled_down',
    stopped_by: 'x',
    stopped_at: null,
    operation_id: null,
    last_seen_at: new Date(),
    drift_status: 'in_sync',
  };
  await withDb(
    (sql) => {
      if (/SELECT.*scalex_state_mirror/i.test(sql)) return { rows: [unscannedRow], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    async (calls) => {
      await state.refreshDrift({
        env: 'prod',
        tenant: 'ark',
        scannedClusters: [], // c3 TARANMADI
        clusterStates: [],
      });
      const driftUpdates = calls.filter(
        (c) => /drift_status/i.test(c.sql) && c.params.includes(20),
      );
      assert.equal(
        driftUpdates.length,
        0,
        'taranmayan cluster satiri icin drift_status UPDATE ateslenmemeli',
      );
    },
  );
});
