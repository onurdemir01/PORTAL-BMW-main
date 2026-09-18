// server/nginx-migration/__tests__/nginx-migration-launch.test.cjs
// "Tanim olustur": extra_vars sozlesmesi (playbook girdi kapisiyla ayni) ve anti-tamper.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildExtraVars, validateRequest } = require('../index.cjs');
const fs = require('node:fs');
const path = require('node:path');

test('extra_vars: playbookun bekledigi 4 alan + requester; env/action/app_type GONDERILMEZ (playbook sabitler)', () => {
  const v = buildExtraVars({
    service: 'glomo', application: 'base-app-v0', namespace: 'digital-banking-ch-prod', inputPath: '/base/',
    user: { displayName: 'Onur Demir', username: 'odemir', email: 'o@x' },
  });
  assert.deepEqual(v, {
    service: 'GLOMO', application: 'base-app-v0', namespace: 'digital-banking-ch-prod', input_path: '/base/',
    requester_name: 'Onur Demir', requester_email: 'o@x',
  });
  assert.ok(!('env' in v) && !('action' in v) && !('app_type' in v) && !('migration_mode' in v));
});

const groups = [{
  id: 'glomo',
  newHosts: ['GBNGXP40'],
  apps: [
    { namespace: 'digital-banking-ch-prod', application: 'base-app-v0', status: 'partial',
      paths: [{ service: 'GLOMO', location: '/base/', hosts: ['GBRVPP07'] }, { service: 'GLOMO', location: '/base2/', hosts: ['GBRVPP08'] }] },
    { namespace: 'glomo-prod', application: 'eksik-app-v1', status: 'missing', paths: [{ service: 'GLOMO', location: '/e/', hosts: [] }] },
    { namespace: 'glomo-prod', application: 'ns-app-v1', status: 'not-scanned', paths: [{ service: 'GLOMO', location: '/n/', hosts: [] }] },
  ],
}];

test('anti-tamper: yalnizca tasima gorunumundeki (grup, ns, app, servis, location) kabul edilir', () => {
  let r = validateRequest(groups, { group: 'glomo', namespace: 'digital-banking-ch-prod', application: 'base-app-v0', service: 'glomo', inputPath: '/base2/' });
  assert.equal(r.ok, true);
  assert.equal(r.path.location, '/base2/');
  r = validateRequest(groups, { group: 'other', namespace: 'digital-banking-ch-prod', application: 'base-app-v0', service: 'GLOMO', inputPath: '/base/' });
  assert.equal(r.ok, false); // yanlis grup
  r = validateRequest(groups, { group: 'glomo', namespace: 'digital-banking-ch-prod', application: 'base-app-v0', service: 'GLOMO', inputPath: '/uydurma/' });
  assert.equal(r.ok, false); // listede olmayan location
  r = validateRequest(groups, { group: 'glomo', namespace: 'hayalet', application: 'x', service: 'GLOMO', inputPath: '/base/' });
  assert.equal(r.ok, false); // listede olmayan uygulama
});

test('deploy edilmemis (missing) ve taranmamis uygulama icin job KOSTURULMAZ (409, acik mesaj)', () => {
  let r = validateRequest(groups, { group: 'glomo', namespace: 'glomo-prod', application: 'eksik-app-v1', service: 'GLOMO', inputPath: '/e/' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.match(r.message, /deploy/);
  r = validateRequest(groups, { group: 'glomo', namespace: 'glomo-prod', application: 'ns-app-v1', service: 'GLOMO', inputPath: '/n/' });
  assert.equal(r.status, 409);
  assert.match(r.message, /taranmadı/);
});

// ── Gecis takibi (2026-09-14): planlandi / gecti / iptal + tarihler ─────────────────
const { normalizeTracking, rowToTracking } = require('../index.cjs');

test('takip kaydi: durumlar ve tarih zorunluluklari', () => {
  const ok = normalizeTracking({ group: 'glomo', namespace: 'Glomo-Prod', application: 'X-App-V1', state: 'planned', plannedDate: '2026-09-20', note: ' oco 1234 ' });
  assert.deepEqual(ok, { group: 'glomo', namespace: 'glomo-prod', application: 'x-app-v1', state: 'planned', plannedDate: '2026-09-20', migratedDate: null, note: 'oco 1234' });
  assert.throws(() => normalizeTracking({ group: 'glomo', namespace: 'a', application: 'b', state: 'planned' }), /planlanan tarih/i);
  assert.throws(() => normalizeTracking({ group: 'glomo', namespace: 'a', application: 'b', state: 'migrated' }), /gecis tarihi/i);
  assert.throws(() => normalizeTracking({ group: 'glomo', namespace: 'a', application: 'b', state: 'migrated', migratedDate: '20.09.2026' }), /YYYY-AA-GG/);
  assert.throws(() => normalizeTracking({ group: 'glomo', namespace: 'a', application: 'b', state: 'bilinmez' }), /Gecersiz durum/);
  assert.throws(() => normalizeTracking({ group: '', namespace: 'a', application: 'b' }), /zorunlu/);
  // durum 'none' tarihsiz olabilir; not 500 ile kesilir
  const n = normalizeTracking({ group: 'g', namespace: 'a', application: 'b', note: 'x'.repeat(600) });
  assert.equal(n.state, 'none');
  assert.equal(n.note.length, 500);
});

test('DB satiri -> API sekli (tarihler YYYY-AA-GG, Date nesnesi de string de olsa)', () => {
  const r = rowToTracking({ group_id: 'glomo', namespace: 'ns', application: 'app', state: 'migrated', planned_date: new Date('2026-09-20T00:00:00Z'), migrated_date: '2026-09-25', note: null, config_job_id: '77', config_created_at: '2026-09-14T10:00:00Z', updated_at: null });
  assert.equal(r.plannedDate, '2026-09-20');
  assert.equal(r.migratedDate, '2026-09-25');
  assert.equal(r.configJobId, 77);
  assert.equal(r.updatedAt, null);
});

// ── Eski sunucudan silme (2026-09-14): nginx_ops action=delete env=prod ─────────────
const { buildDeleteExtraVars } = require('../index.cjs');

test('silme extra_vars: nginx_ops sozlesmesi (action=delete, env=prod, service, input_path, email)', () => {
  const v = buildDeleteExtraVars({ service: 'glomo', inputPath: '/base/', user: { displayName: 'Onur', username: 'od', email: 'o@x' } });
  assert.deepEqual(v, { action: 'delete', env: 'prod', service: 'GLOMO', input_path: '/base/', email: 'o@x', requester_name: 'Onur', requester_email: 'o@x' });
});

test('silme dogrulamasi: yeni sunucu hazirligi ONEMSIZ (eksik/taranmadi satir da silinebilir), listede olmayan yine reddedilir', () => {
  let r = validateRequest(groups, { group: 'glomo', namespace: 'glomo-prod', application: 'eksik-app-v1', service: 'GLOMO', inputPath: '/e/' }, { ignoreStatus: true });
  assert.equal(r.ok, true);
  r = validateRequest(groups, { group: 'glomo', namespace: 'glomo-prod', application: 'eksik-app-v1', service: 'GLOMO', inputPath: '/yok/' }, { ignoreStatus: true });
  assert.equal(r.ok, false);
});

// ── Job izleme + ekrana yansima (2026-09-18) ────────────────────────────────────────
// launchJobOnServer { jobId, status } dondurur; onceki kod job.id okuyup damgayi NULL
// birakiyordu. Simdi jobShape ile { id, status, awxServerId }; job-status ucu terminal
// durumu takip tablosuna isler; /tracking canli job'lari AWX'ten uzlastirir.
test('JT1 jobShape: launchJobOnServer ciktisindan id/status/awxServerId', () => {
  const { jobShape } = require('../index.cjs');
  assert.deepEqual(jobShape({ jobId: 4242, status: 'pending' }, 3), { id: 4242, status: 'pending', awxServerId: 3 });
  assert.deepEqual(jobShape(null, 3), { id: null, status: 'pending', awxServerId: 3 });
});

test('JT2 syncJobStatusToTracking: config_job_id ve delete_job_id eslesen satirlar, terminalde bitis zamani', async () => {
  const { syncJobStatusToTracking } = require('../index.cjs');
  const calls = [];
  const db = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1 }; } };
  await syncJobStatusToTracking(db, 77, 'successful');
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /config_job_status = \$2/);
  assert.match(calls[0].sql, /config_job_finished_at = COALESCE/);
  assert.match(calls[1].sql, /delete_job_status = \$2/);
  assert.deepEqual(calls[0].params, [77, 'successful']);
  calls.length = 0;
  await syncJobStatusToTracking(db, 77, 'running');
  assert.doesNotMatch(calls[0].sql, /config_job_finished_at/); // canli durumda bitis yazilmaz
  calls.length = 0;
  await syncJobStatusToTracking(db, null, 'running');
  assert.equal(calls.length, 0);
});

test('JT3 kaynak sozlesme: job.id okunmaz, job-status ucu var, /tracking uzlastirir, kolonlar seed\'de', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  assert.doesNotMatch(src, /job\?\.id \|\| null/);
  assert.match(src, /router\.get\('\/job-status\/:jobId'/);
  assert.match(src, /config_job_status IS NULL OR config_job_status IN \('pending','waiting','running','new'\)/);
  const setup = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
  for (const c of ['config_job_status', 'config_job_finished_at', 'config_service', 'config_location', 'delete_job_status']) {
    assert.match(setup, new RegExp(`ALTER TABLE nginx_migration_tracking ADD ${c} `), `${c} kolonu seed'de yok`);
  }
  const ui = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'denetim', 'NginxProdMigration.tsx'), 'utf8');
  assert.match(ui, /useJobTracker/);
  assert.match(ui, /trackMigrationJob\(/);
  assert.match(ui, /configJobStatus === 'successful'/);
});
