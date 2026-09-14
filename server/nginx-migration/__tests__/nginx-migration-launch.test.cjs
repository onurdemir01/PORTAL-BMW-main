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
