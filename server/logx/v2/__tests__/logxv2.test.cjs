// server/logx/v2/__tests__/logxv2.test.cjs — LogX v2'nin en guvenlik-kritik davranislari
// icin birim testleri. Node'un yerlesik `node:test` + `node:assert/strict` modulleri
// kullanilir (proje hicbir test framework'une bagimli degildi — bkz. plan dosyasi K
// bolumu — yeni bir dependency eklemeden calisir). `t.mock.method` ile require-cache'teki
// paylasilan modul nesneleri (db, runner, jobs) test basina izole ve otomatik geri
// yuklenecek sekilde sahtelendirilir; gercek MSSQL/AWX baglantisi GEREKMEZ.
//
// Calistirma: node --test server/logx/v2/__tests__/
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../../../db/index.cjs');
const runner = require('../../../ansible/runner.cjs');
const inventoryDb = require('../../../inventory/mssql.cjs');
const jobs = require('../jobs.cjs');
const legacy = require('../legacy.cjs');
const ocp = require('../ocp.cjs');
const restrictions = require('../restrictions.cjs');
const admin = require('../admin.cjs');
const downloads = require('../downloads.cjs');
const requests = require('../requests.cjs');

// ── legacy.cjs transfer() — Anti-TOCTOU ────────────────────────────────────────

test('legacy.transfer(): keşif sonucuyla eşleşmeyen bir path reddedilir, HİÇBİR job launch edilmez', async (t) => {
  const launchMock = t.mock.method(jobs, 'launchJob', async () => { throw new Error('launchJob ÇAĞRILMAMALIYDI'); });

  const discoveryResult = {
    overall_status: 'success',
    hosts: [{ host: 'GBJBOT22', status: 'ok', files: [{ path: '/vhosting8/APP-T.ear/logs/SystemOut.log' }] }],
  };
  const requestRow = { request_id: 'req-1', discovery_result_json: JSON.stringify(discoveryResult) };

  await assert.rejects(
    () => legacy.transfer(requestRow, [{ host: 'GBJBOT22', path: '/etc/passwd' }]),
    (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.code, 'toctou_mismatch');
      assert.deepEqual(err.invalid, [{ host: 'GBJBOT22', path: '/etc/passwd' }]);
      return true;
    }
  );
  assert.equal(launchMock.mock.callCount(), 0, 'geçersiz seçimde launchJob asla çağrılmamalı');
});

test('legacy.transfer(): boş seçim reddedilir', async () => {
  const discoveryResult = { overall_status: 'success', hosts: [] };
  const requestRow = { request_id: 'req-2', discovery_result_json: JSON.stringify(discoveryResult) };
  await assert.rejects(() => legacy.transfer(requestRow, []), (err) => { assert.equal(err.status, 400); return true; });
});

test('legacy.transfer(): keşif sonucuyla BİREBİR eşleşen path kabul edilir ve job doğru extra_vars ile launch edilir', async (t) => {
  const discoveryResult = {
    overall_status: 'success',
    hosts: [{ host: 'GBJBOT22', status: 'ok', files: [{ path: '/vhosting8/APP-T.ear/logs/SystemOut.log' }] }],
  };
  const requestRow = { request_id: 'req-3', discovery_result_json: JSON.stringify(discoveryResult) };

  let capturedArgs = null;
  t.mock.method(jobs, 'launchJob', async (requestId, jobType, extraVars) => {
    capturedArgs = { requestId, jobType, extraVars };
    return { id: 42, requestId, jobType, status: 'pending' };
  });
  t.mock.method(require('../requests.cjs'), 'updateRequest', async () => null);

  const job = await legacy.transfer(requestRow, [{ host: 'GBJBOT22', path: '/vhosting8/APP-T.ear/logs/SystemOut.log' }]);

  assert.equal(job.id, 42);
  assert.equal(capturedArgs.requestId, 'req-3');
  assert.equal(capturedArgs.jobType, 'legacy_transfer');
  assert.deepEqual(capturedArgs.extraVars.selected_files, [{ host: 'GBJBOT22', path: '/vhosting8/APP-T.ear/logs/SystemOut.log' }]);
  assert.match(capturedArgs.extraVars.archive_name, /^[a-f0-9]{32}\.zip$/, 'archive adı benzersiz/rastgele olmalı');
});

// ── restrictions.cjs — Varsayilan-acik yetkilendirme ───────────────────────────

test('restrictions.isAllowed(): Admin her zaman izinli, DB\'ye hiç sorulmaz', async (t) => {
  const queryMock = t.mock.method(db, 'query', async () => { throw new Error('DB sorgusu ÇAĞRILMAMALIYDI'); });
  const allowed = await restrictions.isAllowed('legacy_app', 'HERHANGI_BIR_APP', { username: 'admin1', role: 'Admin' });
  assert.equal(allowed, true);
  assert.equal(queryMock.mock.callCount(), 0);
});

test('restrictions.isAllowed(): kısıtlama satırı YOKSA varsayılan olarak herkese açık', async (t) => {
  t.mock.method(db, 'query', async () => ({ rows: [] }));
  const allowed = await restrictions.isAllowed('legacy_app', 'GBCEPPOSDASHBOARD', { username: 'user1', role: 'User' });
  assert.equal(allowed, true);
});

// isAllowed artik iki sirali sorgu yerine TEK LEFT JOIN sorgusu kullanir (kurumsal AI
// kod incelemesi, review.md #11) — kisitlama satiri var ama bu kullanici icin grant
// eslesmemisse LEFT JOIN 'g.username' NULL doner (satir yine de gelir, cunku WHERE
// yalniz 'r' tarafini filtreler).
test('restrictions.isAllowed(): kısıtlama VARSA ve kullanıcı grant listesinde DEĞİLSE reddedilir', async (t) => {
  const queryMock = t.mock.method(db, 'query', async () => ({ rows: [{ id: 7, username: null }] }));
  const allowed = await restrictions.isAllowed('legacy_app', 'GIZLI_APP', { username: 'user1', role: 'User' });
  assert.equal(allowed, false);
  assert.equal(queryMock.mock.callCount(), 1, 'tek JOIN sorgusu yeterli olmali (N+1 degil)');
});

test('restrictions.isAllowed(): kısıtlama VARSA ve kullanıcı grant listesindeyse izinlidir', async (t) => {
  const queryMock = t.mock.method(db, 'query', async () => ({ rows: [{ id: 7, username: 'user1' }] }));
  const allowed = await restrictions.isAllowed('legacy_app', 'GIZLI_APP', { username: 'user1', role: 'User' });
  assert.equal(allowed, true);
  assert.equal(queryMock.mock.callCount(), 1, 'tek JOIN sorgusu yeterli olmali (N+1 degil)');
});

test('restrictions.assertAllowed(): reddedilince 403 fırlatır', async (t) => {
  t.mock.method(db, 'query', async () => ({ rows: [{ id: 1, username: null }] })); // kisitlama var, grant yok
  await assert.rejects(() => restrictions.assertAllowed('ocp_namespace', 'x', { username: 'u', role: 'User' }),
    (err) => { assert.equal(err.status, 403); return true; });
});

// ── admin.cjs resolveEnvLabel() — EAR son-eki → ortam etiketi ─────────────────

test('admin.resolveEnvLabel(): -T sonekli klasör TEST olarak etiketlenir (EnvanterApps.env sütunundan BAĞIMSIZ)', async () => {
  const suffixRows = [
    { suffix: '-T', env_label: 'TEST' },
    { suffix: '-D', env_label: 'DEV' },
    { suffix: '', env_label: 'PROD' },
  ];
  assert.equal(await admin.resolveEnvLabel('GBCEPPOSDASHBOARD-T.ear', suffixRows), 'TEST');
  assert.equal(await admin.resolveEnvLabel('GBCEPPOSDASHBOARD-D.ear', suffixRows), 'DEV');
  assert.equal(await admin.resolveEnvLabel('GBCEPPOSDASHBOARD.ear', suffixRows), 'PROD');
});

test('admin.resolveEnvLabel(): eşleşen son-ek yoksa PROD\'a düşer', async () => {
  const suffixRows = [{ suffix: '', env_label: 'PROD' }];
  assert.equal(await admin.resolveEnvLabel('BILINMEYEN-X.ear', suffixRows), 'PROD');
});

// ── jobs.cjs pollJob() — set_stats/artifacts sozlesmesi, ham stdout parse ETMEZ ──

test('jobs.pollJob(): zaten terminal durumdaki job AWX\'e tekrar sorulmaz (cache)', async (t) => {
  const statusMock = t.mock.method(runner, 'getJobStatusOnServer', async () => { throw new Error('ÇAĞRILMAMALIYDI'); });
  const job = { id: 1, status: 'successful', awxServerId: 1, awxJobId: 999 };
  const result = await jobs.pollJob(job);
  assert.equal(result, job);
  assert.equal(statusMock.mock.callCount(), 0);
});

test('jobs.pollJob(): terminal duruma ulaşınca artifacts.logx_result DB\'ye yazılır, ham stdout hiç okunmaz', async (t) => {
  t.mock.method(runner, 'getJobStatusOnServer', async () => ({
    status: 'successful',
    artifacts: { logx_result: { overall_status: 'success', hosts: [] } },
  }));
  t.mock.method(db, 'query', async () => ({
    rows: [{ id: 1, request_id: 'r1', job_type: 'legacy_discovery', awx_server_id: 1, awx_job_id: 999,
      status: 'successful', artifacts_json: JSON.stringify({ overall_status: 'success', hosts: [] }),
      finished_at: new Date().toISOString(), error_message: null }],
  }));
  const job = { id: 1, status: 'running', awxServerId: 1, awxJobId: 999 };
  const result = await jobs.pollJob(job);
  assert.equal(result.status, 'successful');
  assert.deepEqual(result.artifacts, { overall_status: 'success', hosts: [] });
});

test('jobs.pollJob(): job terminal ama artifacts.logx_result YOKSA hata mesajıyla işaretlenir (sessizce başarılı sayılmaz)', async (t) => {
  t.mock.method(runner, 'getJobStatusOnServer', async () => ({ status: 'successful', artifacts: {} }));
  let capturedParams = null;
  // NOT: pollJob ayrica audit.log() cagirir (teknik ayrinti kaydi) ve o da db.query
  // kullanir — bu yuzden YALNIZ job UPDATE sorgusunun parametreleri yakalanir.
  t.mock.method(db, 'query', async (sql, params) => {
    if (/UPDATE logx_v2_jobs/i.test(sql)) {
      capturedParams = params;
      return { rows: [{ id: 1, status: 'successful', artifacts_json: null, error_message: params[2] }] };
    }
    return { rows: [] };
  });
  const job = { id: 1, status: 'running', awxServerId: 1, awxJobId: 999 };
  const out = await jobs.pollJob(job);
  assert.ok(capturedParams[1] === null, 'artifacts_json null yazılmalı');
  // Kullanıcıya giden metin SADE; playbook/set_stats teşhisi artık teknik ayrıntıda.
  assert.match(capturedParams[2], /İş No: 999/, 'kullanıcı mesajı iş numarası taşımalı');
  assert.match(out.technicalDetail, /set_stats/, 'teknik ayrıntı playbook yapılandırma sorununa işaret etmeli');
});

// ── Kullaniciya gosterilen hata metni: teknik jargon YOK, is no VAR ──────────────
// Son kullanici Ansible/AWX bilmek zorunda degil; teknik ayrinti ayri alanda tasinir.

test('buildUserFacingJobError(): başarısız job — sade metin, iş no ve yöneticiye yönlendirme içerir', () => {
  const msg = jobs.buildUserFacingJobError({ awxJobId: 3203029 }, { status: 'failed' });
  assert.match(msg, /İş No: 3203029/);
  assert.match(msg, /yöneticinize başvurun/i);
  for (const jargon of ['artifacts', 'set_stats', 'playbook', 'inventory', 'AWX']) {
    assert.ok(!msg.includes(jargon), `kullanıcı mesajında teknik terim OLMAMALI: ${jargon}`);
  }
});

test('buildUserFacingJobError(): başarılı ama sonuçsuz job — farklı ama yine sade metin', () => {
  const msg = jobs.buildUserFacingJobError({ awxJobId: 42 }, { status: 'successful' });
  assert.match(msg, /İş No: 42/);
  assert.match(msg, /sonuç alınamadı/i);
  assert.ok(!msg.includes('set_stats'));
});

test('buildTechnicalJobDetail(): yönetici metni teşhis için gereken tüm alanları taşır', () => {
  const detail = jobs.buildTechnicalJobDetail(
    { awxJobId: 999, awxServerId: 2 },
    { status: 'failed', playbook: 'p.yml', inventory: 'inv' },
    { top: [], data: [], ansibleStatsData: [] }
  );
  assert.match(detail, /jobId=999/);
  assert.match(detail, /serverId=2/);
  assert.match(detail, /playbook=p\.yml/);
  assert.match(detail, /set_stats/);
});

// ── downloads.cjs — IDOR-direncli token uretimi ────────────────────────────────

test('downloads.issueDownloadToken(): token crypto-random 256-bit hex (64 karakter), NEWID()/UUID DEĞİL', async (t) => {
  let insertedToken = null;
  t.mock.method(db, 'query', async (_sql, params) => { insertedToken = params[0]; return { rows: [] }; });
  const { token, expiresInMinutes } = await downloads.issueDownloadToken({
    requestId: 'r1', username: 'user1', sessionToken: 'sess1',
    stagedPath: '/sw/BMW_PORTAL/logs/legacy/x.zip', filename: 'x.zip', sizeBytes: 100, isFallback: false,
  });
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(insertedToken, token);
  assert.equal(expiresInMinutes, 15);
});

test('downloads.issueDownloadToken(): iki ardışık çağrı ASLA aynı token\'ı üretmez', async (t) => {
  t.mock.method(db, 'query', async () => ({ rows: [] }));
  const a = await downloads.issueDownloadToken({ requestId: 'r1', username: 'u', sessionToken: 's', stagedPath: '/x', filename: 'x.zip' });
  const b = await downloads.issueDownloadToken({ requestId: 'r1', username: 'u', sessionToken: 's', stagedPath: '/x', filename: 'x.zip' });
  assert.notEqual(a.token, b.token);
});

// ── legacy.cjs searchApps() — DB-down otomatik fallback (kullanici karari §2) ──

test('legacy.searchApps(): Envanter DB erişilemezse son bilinen snapshot\'a otomatik düşer', async (t) => {
  const snapshotPath = path.join(__dirname, '..', '..', '..', 'data', 'logx-legacy-snapshot.json');
  const dir = path.dirname(snapshotPath);
  fs.mkdirSync(dir, { recursive: true });
  const hadExisting = fs.existsSync(snapshotPath);
  const backup = hadExisting ? fs.readFileSync(snapshotPath, 'utf-8') : null;
  fs.writeFileSync(snapshotPath, JSON.stringify({
    apps: ['GBCEPPOSDASHBOARD', 'GBSVCCOMPASS'], appHosts: { GBCEPPOSDASHBOARD: ['GBJBOT22'] }, generatedAt: new Date().toISOString(),
  }));

  t.mock.method(inventoryDb, 'getPool', async () => { throw new Error('MSSQL bağlantısı yok (simüle DB kesintisi).'); });

  try {
    const result = await legacy.searchApps('COMPASS');
    assert.equal(result.fallbackMode, true);
    assert.deepEqual(result.apps, ['GBSVCCOMPASS']);
  } finally {
    if (hadExisting) fs.writeFileSync(snapshotPath, backup);
    else fs.rmSync(snapshotPath, { force: true });
  }
});

// ── ocp.cjs — cluster secimi admin verisine karsi dogrulanir ───────────────────

test('ocp.selectClusters(): admin tarafından tanımlanmamış bir cluster reddedilir', async (t) => {
  t.mock.method(admin, 'clusterExists', async () => false);
  const requestRow = { request_id: 'r1' };
  await assert.rejects(
    () => ocp.selectClusters(requestRow, 'dev', 'ark', ['uydurma-cluster']),
    (err) => { assert.equal(err.status, 400); return true; }
  );
});

// Bastion cozumlemesi artik CLUSTER seviyesinde (cluster kolonu > tenant/env yedegi):
// ikisi de yoksa cluster `missing` doner ve istek job launch EDILMEDEN 400 ile reddedilir.
test('ocp.selectClusters(): hicbir jump server cozulemezse job hic launch edilmeden reddedilir', async (t) => {
  t.mock.method(admin, 'clusterExists', async () => true);
  t.mock.method(admin, 'resolveTerminalHosts', async (env, tenant, names) => ({ hosts: {}, missing: [...names] }));
  const requestRow = { request_id: 'r1' };
  await assert.rejects(
    () => ocp.selectClusters(requestRow, 'dev', 'ark', ['gbocptest1']),
    (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /gbocptest1/, 'hangi cluster(lar)in bastion\'siz oldugu mesajda gecmeli');
      return true;
    }
  );
});

// ── requests.cjs expireOldRequests() — N+1 UPDATE yerine tek toplu UPDATE ─────
// (kurumsal AI kod incelemesi, review.md #9)

test('requests.expireOldRequests(): 3 suresi dolmus istek icin dosya silme per-row, state UPDATE TEK sorgu', async (t) => {
  const queryMock = t.mock.method(db, 'query', async (sql) => {
    if (/^SELECT/.test(sql)) {
      return { rows: [
        { request_id: 'r1', staged_path: '/staging/a.zip' },
        { request_id: 'r2', staged_path: '/staging/b.zip' },
        { request_id: 'r3', staged_path: null },
      ] };
    }
    return { rows: [] };
  });
  const deleteCalls = [];
  const count = await requests.expireOldRequests(async (p) => { deleteCalls.push(p); });

  assert.equal(count, 3);
  assert.deepEqual(deleteCalls, ['/staging/a.zip', '/staging/b.zip'], 'yalniz staged_path OLAN satirlar icin silme cagrilir');
  const updateCalls = queryMock.mock.calls.filter((c) => /^UPDATE/.test(c.arguments[0]));
  assert.equal(updateCalls.length, 1, 'state UPDATE TEK toplu sorguda olmali (N+1 degil)');
  assert.match(updateCalls[0].arguments[0], /WHERE expires_at < GETUTCDATE\(\) AND state <> 'expired'/);
});

test('requests.expireOldRequests(): hic suresi dolmus istek yoksa UPDATE hic calismaz', async (t) => {
  const queryMock = t.mock.method(db, 'query', async () => ({ rows: [] }));
  const count = await requests.expireOldRequests(async () => {});
  assert.equal(count, 0);
  assert.equal(queryMock.mock.callCount(), 1, 'yalniz SELECT calismali, UPDATE hic tetiklenmemeli');
});

// ── downloads.cjs cleanupExpiredDownloads() — token-hedefli DELETE (TOCTOU fix) ─
// (kurumsal AI kod incelemesi, review.md #10)

test('downloads.cleanupExpiredDownloads(): SELECT ile gorulen token\'lar DELETE...IN(...) ile hedeflenir', async (t) => {
  const queryMock = t.mock.method(db, 'query', async (sql) => {
    if (/^SELECT/.test(sql)) {
      return { rows: [{ token: 'tok1', staged_path: '/staging/x.zip' }, { token: 'tok2', staged_path: null }] };
    }
    return { rowCount: 2 };
  });
  // deleteStagedFile gercek dosya-sistemi cagrisi yapar ama var-olmayan/staging-disi yollar
  // icin sessizce no-op eder (fail-safe) — test icin ayrica mock'lanmasina gerek yok.
  const count = await downloads.cleanupExpiredDownloads();

  assert.equal(count, 2);
  const deleteCall = queryMock.mock.calls.find((c) => /^DELETE/.test(c.arguments[0]));
  assert.ok(deleteCall, 'DELETE sorgusu calismali');
  assert.match(deleteCall.arguments[0], /token IN \(\$1,\$2\)/);
  assert.deepEqual(deleteCall.arguments[1], ['tok1', 'tok2']);
});

test('downloads.cleanupExpiredDownloads(): hic suresi dolmus indirme yoksa DELETE hic calismaz', async (t) => {
  const queryMock = t.mock.method(db, 'query', async () => ({ rows: [] }));
  const count = await downloads.cleanupExpiredDownloads();
  assert.equal(count, 0);
  assert.equal(queryMock.mock.callCount(), 1);
});
