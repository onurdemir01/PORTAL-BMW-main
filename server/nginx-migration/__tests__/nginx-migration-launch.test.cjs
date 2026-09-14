// server/nginx-migration/__tests__/nginx-migration-launch.test.cjs
// "Tanim olustur": extra_vars sozlesmesi (playbook girdi kapisiyla ayni) ve anti-tamper.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildExtraVars, validateRequest } = require('../index.cjs');

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
