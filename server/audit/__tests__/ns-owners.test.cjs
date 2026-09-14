// server/audit/__tests__/ns-owners.test.cjs — uygulama -> sorumlu ekip (namespace sahibi).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { indexOwners, ownersFor, loadNamespaceOwners, _resetCache } = require('../ns-owners.cjs');

test('ekip ozeti: birden fazla namespace, ayni ekip tek kez, sahipsiz namespace gorunur', () => {
  const byNs = indexOwners([
    { namespace: 'glomo-dev', owner_group_name: 'GT-GLOMO-DEV', owner_email: 'glomo@x', lookup_status: 'OK' },
    { namespace: 'GLOMO-PROD', owner_group_name: 'GT-GLOMO-DEV', owner_email: 'glomo@x', lookup_status: 'OK' },
    { namespace: 'saklama-prod', owner_group_name: null, owner_email: null, lookup_status: 'SORUMLU_YOK' },
  ]);
  const o = ownersFor(byNs, ['glomo-dev', 'glomo-prod', 'saklama-prod', 'hic-yok', null]);
  assert.deepEqual(o.groups, ['GT-GLOMO-DEV']);
  assert.deepEqual(o.emails, ['glomo@x']);
  assert.deepEqual(o.unknownNs, ['saklama-prod', 'hic-yok']);
});

test('tablo yoksa ready=false ve bos harita (ekran "veri yok" der, "bilinmiyor" degil)', async () => {
  _resetCache();
  const r = await loadNamespaceOwners(async () => { throw new Error("Invalid object name 'dbo.Openshift_Namespace_Owners'"); });
  assert.equal(r.ready, false);
  assert.equal(r.byNs.size, 0);
  _resetCache();
});

test('Nginx_Config_Audit sutun adi location_path (job_3315997 sonrasi: "Invalid column name location")', () => {
  // Sorgu nginx-migration.cjs/loadMigration'a tasindi (2026-09-14); iki dosya da taranir.
  const src = ['denetim.cjs', 'nginx-migration.cjs']
    .map((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8'))
    .join('\n');
  // Nginx_Config_Audit'ten okuyan her SELECT'te ciplak "location" sutunu olmamali.
  const selects = src.split('FROM dbo.Nginx_Config_Audit').slice(0, -1).map((s) => s.slice(s.lastIndexOf('SELECT')));
  assert.ok(selects.length >= 3);
  for (const sel of selects) {
    assert.ok(!/(?<!AS\s)(?<=[\s,])location(?=[\s,])/.test(sel), 'Nginx_Config_Audit\'te "location" yok, "location_path" var:\n' + sel);
  }
  assert.ok(src.includes('location_path AS location'), 'tasima sorgusu location_path AS location kullanmali');
});
