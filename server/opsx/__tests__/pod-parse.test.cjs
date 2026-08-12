// server/opsx/__tests__/pod-parse.test.cjs — `oc get pods --no-headers` ayristirmasi.
//
// EN KRITIK TEST: RESTARTS sutunu bosluk icerebilir ("2 (3d ago)") — naif bir
// split()[3]/split()[4] bu satirlarda AGE'i "(3d" olarak okurdu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePodLine, parsePodDiscoveryResult } = require('../pod-parse.cjs');

test('duz satir: NAME READY STATUS RESTARTS AGE dogru ayristirilir', () => {
  const out = parsePodLine('my-app-7d8f9c5b4-x2k9p   1/1     Running   0          5d');
  assert.deepEqual(out, {
    name: 'my-app-7d8f9c5b4-x2k9p',
    ready: '1/1',
    status: 'Running',
    restarts: '0',
    age: '5d',
  });
});

test('RESTARTS bosluk iceriyorsa ("2 (3d ago)") AGE yine dogru okunur', () => {
  const out = parsePodLine('another-pod-abc   0/1   Pending   2 (3d ago)   10m');
  assert.equal(out.name, 'another-pod-abc');
  assert.equal(out.status, 'Pending');
  assert.equal(out.restarts, '2 (3d ago)');
  assert.equal(out.age, '10m', 'AGE son alandan okunmali, RESTARTS bosluklu olsa bile');
});

test('bos/eksik alanli satirlar null doner (cagiran filtreler)', () => {
  assert.equal(parsePodLine(''), null);
  assert.equal(parsePodLine('   '), null);
  assert.equal(parsePodLine(null), null);
  assert.equal(parsePodLine('sadece-ad 1/1 Running'), null, '5 alandan az satir kabul edilmemeli');
});

test('parsePodDiscoveryResult: tek cluster - lines -> pods, bozuk satirlar elenir', () => {
  const out = parsePodDiscoveryResult({
    overall_status: 'ok',
    namespace: 'deneme-test',
    results: [{
      cluster: 'gbocpqa1',
      ok: true,
      lines: [
        'pod-a-1   1/1   Running   0   5d',
        '',
        'bozuk satir',
        'pod-b-2   0/1   CrashLoopBackOff   7 (2m ago)   1h',
      ],
    }],
  });
  assert.equal(out.overallStatus, 'ok');
  assert.equal(out.namespace, 'deneme-test');
  assert.equal(out.pods.length, 2);
  assert.deepEqual(out.pods.map((p) => p.name), ['pod-a-1', 'pod-b-2']);
  assert.equal(out.pods[1].restarts, '7 (2m ago)');
  assert.equal(out.pods[0].cluster, 'gbocpqa1', 'her pod HANGI cluster\'dan geldigini tasimali');
});

test('parsePodDiscoveryResult: coklu cluster - HER cluster kendi pod\'larini katkilar', () => {
  const out = parsePodDiscoveryResult({
    overall_status: 'ok',
    namespace: 'deneme-test',
    results: [
      { cluster: 'gbocpqa1', ok: true, lines: ['pod-a-1   1/1   Running   0   5d'] },
      { cluster: 'gbocpqa2', ok: true, lines: ['pod-b-1   1/1   Running   0   2d'] },
    ],
  });
  assert.equal(out.pods.length, 2);
  assert.deepEqual(out.pods.map((p) => `${p.cluster}/${p.name}`), ['gbocpqa1/pod-a-1', 'gbocpqa2/pod-b-1']);
});

test('parsePodDiscoveryResult: bir cluster basarisiz olsa da digerleri etkilenmez', () => {
  const out = parsePodDiscoveryResult({
    overall_status: 'partial',
    namespace: 'deneme-test',
    results: [
      { cluster: 'gbocpqa1', ok: true, lines: ['pod-a-1   1/1   Running   0   5d'] },
      { cluster: 'gbocpqa2', ok: false, error: 'oc login basarisiz' },
    ],
  });
  assert.equal(out.pods.length, 1);
  assert.equal(out.pods[0].cluster, 'gbocpqa1');
  assert.match(out.error, /gbocpqa2.*oc login basarisiz/);
});

test('overall_status katlamali skalerden bosluklu gelse de trimlenir', () => {
  // Playbook `>-` kullandiginda Jinja blok etiketleri deger basina bosluk birakabiliyor
  // (logx tarafinda birebir bu hata yasandi).
  const out = parsePodDiscoveryResult({ overall_status: '  ok  ', results: [] });
  assert.equal(out.overallStatus, 'ok');
});

test('bos/yok artifacts guvenli varsayilanlara duser (500 atmaz)', () => {
  const out = parsePodDiscoveryResult(null);
  assert.equal(out.overallStatus, 'unknown');
  assert.deepEqual(out.pods, []);
  assert.equal(out.namespace, '');
});
