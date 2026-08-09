// server/logx/v2/__tests__/ocp-app-parse.test.cjs — Uygulama kesfi cikti ayristirmasi.
// Ayristirma playbook'ta DEGIL burada yapildigi icin asil dogruluk garantisi bu testlerdedir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseObjectLine, parseAppDiscoveryResult } = require('../ocp-app-parse.cjs');

test('parseObjectLine(): is yuku satiri tam ayristirilir', () => {
  const o = parseObjectLine('Deployment|odeme-api|3|registry/odeme:1.4||odeme|2026-01-05T10:00:00Z');
  assert.deepEqual(o, {
    kind: 'Deployment', name: 'odeme-api', replicas: 3,
    image: 'registry/odeme:1.4', labelApp: 'odeme', created: '2026-01-05T10:00:00Z',
  });
});

test('parseObjectLine(): Pod\'da image spec.containers[0]\'dan gelir (podImage alani)', () => {
  const o = parseObjectLine('Pod|odeme-api-7c9|||registry/odeme:1.4|odeme|2026-01-05T10:00:00Z');
  assert.equal(o.kind, 'Pod');
  assert.equal(o.image, 'registry/odeme:1.4', 'is yuku image bosken pod image kullanilmali');
  assert.equal(o.replicas, null);
});

test('parseObjectLine(): Service/Route — replicas ve image YOK, null olmali (0 DEGIL)', () => {
  const svc = parseObjectLine('Service|odeme-svc|||||2026-01-05T10:00:00Z');
  assert.equal(svc.kind, 'Service');
  assert.equal(svc.replicas, null, 'replicas yoklugu 0 ile karistirilmamali');
  assert.equal(svc.image, null);
  assert.equal(svc.labelApp, null);
});

test('parseObjectLine(): replicas=0 GERCEK bir deger, null degil', () => {
  const o = parseObjectLine('Deployment|kapali-app|0|img||app|2026-01-05T10:00:00Z');
  assert.equal(o.replicas, 0, 'olceklendirmesi 0 olan uygulama null gorunmemeli');
});

test('parseObjectLine(): bos/bozuk/eksik alanli satirlar ATLANIR', () => {
  assert.equal(parseObjectLine(''), null);
  assert.equal(parseObjectLine('   '), null);
  assert.equal(parseObjectLine(null), null);
  assert.equal(parseObjectLine('Deployment|yarim|3'), null, 'eksik alanli satir obje sayilmamali');
  assert.equal(parseObjectLine('Deployment||3|img||app|t'), null, 'adsiz obje atlanmali');
});

test('parseAppDiscoveryResult(): sonuclar cluster bazinda gruplanir', () => {
  const out = parseAppDiscoveryResult({
    overall_status: 'success',
    results: [
      { cluster_name: 'c1', namespace: 'ns1', status: 'ok', lines: ['Deployment|a|1|img||a|t'] },
      { cluster_name: 'c1', namespace: 'ns2', status: 'ok', lines: ['Service|b|||||t'] },
      { cluster_name: 'c2', namespace: 'ns1', status: 'ok', lines: [] },
    ],
  });
  assert.equal(out.overallStatus, 'success');
  assert.equal(out.clusters.length, 2);
  const c1 = out.clusters.find((c) => c.clusterName === 'c1');
  assert.equal(c1.namespaces.length, 2);
  assert.equal(c1.namespaces[0].objects[0].name, 'a');
});

test('parseAppDiscoveryResult(): hatali namespace girdisi objesiz ama HATA MESAJIYLA korunur', () => {
  const out = parseAppDiscoveryResult({
    overall_status: 'partial',
    results: [
      { cluster_name: 'c1', namespace: 'ns1', status: 'error', error: 'login basarisiz', lines: [] },
      { cluster_name: 'c1', namespace: 'ns2', status: 'ok', lines: ['Pod|p|||img|x|t'] },
    ],
  });
  const c1 = out.clusters[0];
  assert.equal(c1.namespaces[0].status, 'error');
  assert.equal(c1.namespaces[0].error, 'login basarisiz', 'hata sebebi kaybolmamali');
  assert.equal(c1.namespaces[1].objects.length, 1);
});

test('parseAppDiscoveryResult(): bos/bozuk artifacts patlamaz', () => {
  assert.deepEqual(parseAppDiscoveryResult(null).clusters, []);
  assert.deepEqual(parseAppDiscoveryResult({}).clusters, []);
  assert.deepEqual(parseAppDiscoveryResult({ results: 'bozuk' }).clusters, []);
});
