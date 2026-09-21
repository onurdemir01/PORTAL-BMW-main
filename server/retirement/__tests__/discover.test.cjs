// server/retirement/__tests__/discover.test.cjs — RD1..RD5 (2026-09-21).
// Retirement kesfi: tum ortamlar (base, base-D/T/Q), Ankara siteleri, web sunucusu Web-App kuraliyla,
// JBoss nesli jboss_version'dan, Server Hub JVM durumu varsa eklenir.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildTargets, siteOf, parseAppName, genOf } = require('../discover.cjs');

test('RD1: site kurali ...AP<n> = Ankara, aksi Pendik', () => {
  assert.equal(siteOf('GBNGXAP34'), 'Ankara');
  assert.equal(siteOf('GBCJAAP02'), 'Ankara');
  assert.equal(siteOf('GBNGXP40'), 'Pendik');
  assert.equal(siteOf('DACRAAP01'), 'Ankara');
  assert.equal(siteOf('GBCJAP01'), 'Pendik'); // tier A, site harfi yok (cepsube restart Pendik seti)
  assert.equal(siteOf('GBCJAAP02'), 'Ankara'); // cepsube restart Ankara seti
  assert.equal(siteOf('GBCRAT01'), 'Pendik');
});

test('RD2: uygulama adi kurali ve JBoss nesli', () => {
  assert.deepEqual(parseAppName('CRM-T'), { base: 'CRM', env: 'TEST' });
  assert.deepEqual(parseAppName('CRM'), { base: 'CRM', env: 'PROD' });
  assert.equal(genOf('EAP 7.4.0'), 7);
  assert.equal(genOf('8.0.1'), 8);
  assert.equal(genOf(''), null);
});

test('RD3: kesif tum ortamlari ve iki siteyi toplar; web sunucusu 5. harf A->W + server_name', () => {
  const inv = [
    { app: 'CRM', host: 'GBCRAAP01', env: 'Production', domain: 'x', jboss_version: '7.4', app_path: '/vhosting/crm/crm.ear', status: 'running' },
    { app: 'CRM', host: 'GBCRAP01', env: 'Production', domain: 'x', jboss_version: '7.4', app_path: '/vhosting/crm/crm.ear', status: 'running' },
    { app: 'CRM-T', host: 'GBCRAT01', env: 'Test', domain: 'x', jboss_version: '8.0', app_path: '', status: 'stopped' },
    { app: 'CRMX', host: 'GBZZAP01', env: 'Production', domain: 'x', jboss_version: '7', app_path: '', status: 'running' }, // baska uygulama
  ];
  const certs = [{ host: 'GBCRWAP01', ip: '1', port: '443', server_name: 'crm.fw.local', conf_file: '/c', product: 'RHA', env: 'P' }];
  const r = buildTargets('CRM', inv, certs, [{ host: 'GBCRAAP01', jvm: 'CRM', running: 1, auto_start: 'true', scan_date: '2026-09-21' }]);
  assert.equal(r.summary.total, 3);
  assert.deepEqual(r.summary.bySite, { Pendik: 2, Ankara: 1 });
  assert.equal(r.summary.prod, true);
  const ank = r.targets.find((t) => t.host === 'GBCRAAP01');
  assert.equal(ank.site, 'Ankara');
  assert.equal(ank.gen, 7);
  assert.equal(ank.web.length, 1);
  assert.equal(ank.web[0].host, 'GBCRWAP01');
  assert.equal(ank.hub.running, true);
  const t = r.targets.find((t) => t.appName === 'CRM-T');
  assert.equal(t.env, 'TEST'); assert.equal(t.gen, 8); assert.equal(t.hub, null);
  assert.equal(r.targets[0].env, 'PROD', 'prod once');
});

test('RD4: ayni host+app tekrar satirlari tek hedef', () => {
  const inv = [{ app: 'A', host: 'H1', jboss_version: '7' }, { app: 'A', host: 'h1', jboss_version: '7', app_path: '/x' }];
  assert.equal(buildTargets('A', inv, [], []).targets.length, 1);
});

test('RD5: taban adi farkli olan uygulama disarida', () => {
  assert.equal(buildTargets('CRM', [{ app: 'CRM2', host: 'H' }, { app: 'CRM-Q', host: 'H2' }], [], []).targets.length, 1);
});
