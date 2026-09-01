// server/scalex/__tests__/scalex-contract.test.cjs — sonuc sozlesmesi + patlama yaricapi
// + kapi politikasi. Hepsi SAF fonksiyon; DB/AWX/ag gerektirmez.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const result = require('../result.cjs');
const launch = require('../launch.cjs');
const state = require('../state.cjs');

// ── Sonuc sozlesmesi ─────────────────────────────────────────────────────────

test('artifact UC farkli konumdan da okunur (AWX controller surumune gore degisiyor)', () => {
  const payload = { overall_status: 'OK', counts: {}, targets: [] };
  for (const shape of [
    { scalex_result: payload },
    { data: { scalex_result: payload } },
    { ansible_stats: { data: { scalex_result: payload } } },
  ]) {
    assert.equal(result.extractScaleXResult(shape)?.overallStatus, 'OK', JSON.stringify(shape));
  }
});

test('artifact JSON STRING olarak geldiyse de okunur', () => {
  const r = result.extractScaleXResult({ scalex_result: JSON.stringify({ overall_status: 'FAIL', counts: {}, targets: [] }) });
  assert.equal(r.overallStatus, 'FAIL');
});

test('overall_status BOSLUKLU gelirse yine dogru okunur', () => {
  // Bu depoda uretimde YASANDI: katlamali skalerde `{% if %}` etiketleri arasindaki
  // bosluklar ciktiya sizdi ve deger "      failed" olarak yayinlandi. Playbook
  // tarafinda `| trim` var ama portal ona GUVENMEZ — sozlesmenin iki ucu da ayni
  // anda yanlis olabilir ve sonucu kullanici oder.
  const r = result.extractScaleXResult({ scalex_result: { overall_status: '   fail  ', counts: {}, targets: [] } });
  assert.equal(r.overallStatus, 'FAIL');
});

test('hedef satirlarindaki durumlar da normalize edilir', () => {
  const r = result.extractScaleXResult({
    scalex_result: { overall_status: 'WARN', counts: {}, targets: [{ cluster: 'c1', app: 'a', kind: 'Deployment', status: ' ok ', detail: 'x' }] },
  });
  assert.equal(r.targets[0].status, 'OK');
});

test('strict_blocked FAIL\'den AYRI tasinir (cluster\'da hicbir degisiklik YOK)', () => {
  const r = result.extractScaleXResult({ scalex_result: { overall_status: 'FAIL', strict_blocked: true, counts: {}, targets: [] } });
  assert.equal(r.strictBlocked, true, 'ekran bunu FAIL ile ayni gostermemeli — kullanici icin IYI haber');
});

test('dogrulama hatasi bicimi de AYNI sekle indirgenir', () => {
  const r = result.extractScaleXResult({
    scalex_result: {
      overall_status: 'FAIL', stage: 'validation',
      validation_error: 'namespace gecersiz', failed_task: 'Validate inputs',
      counts: { fail: 1 }, targets: [], rows: [],
    },
  });
  assert.equal(r.stage, 'validation');
  assert.equal(r.validationError, 'namespace gecersiz');
  assert.equal(r.counts.fail, 1);
});

test('artifact YOKSA null doner (ekran "sonuc gelmedi" diyebilsin)', () => {
  assert.equal(result.extractScaleXResult({}), null);
  assert.equal(result.extractScaleXResult(null), null);
  assert.equal(result.extractScaleXResult({ scalex_result: 'bozuk-json{' }), null);
});

// ── Kesif sonucu ─────────────────────────────────────────────────────────────

test('workloads kesfi: geri alinabilirlik ekranin karar girdisidir', () => {
  const r = result.extractDiscoveryResult({
    scalex_discovery_result: {
      overall_status: 'ok', mode: 'workloads', counts: {}, clusters: ['c1'],
      items: [
        { cluster: 'c1', app: 'batch', kind: 'Deployment', step: 'WORKLOAD', status: 'OK',
          detail: 'resource=deploy spec=0 status=0 ready=0 hpa=no state_phase=scaled_down previous_replicas=2 image=reg/b:1' },
        { cluster: 'c1', app: 'pay', kind: 'Deployment', step: 'WORKLOAD', status: 'OK',
          detail: 'resource=deploy spec=3 status=3 ready=3 hpa=yes state_phase=- previous_replicas=- image=reg/p:2' },
      ],
    },
  });
  const [batch, pay] = r.workloads;
  // `Geri Al` YALNIZCA burasi true iken secilebilir olacak. Bugun bu bilgi ancak is
  // calistiktan SONRA `STATE;FAIL` olarak ogreniliyor.
  assert.equal(batch.restorable, true);
  assert.equal(batch.previousReplicas, 2);
  assert.equal(batch.specReplicas, 0);
  assert.equal(batch.image, 'reg/b:1', 'imaj status alanina kaymamali (omitempty sutun kaymasi)');
  assert.equal(pay.restorable, false);
  assert.equal(pay.hasHpa, true, 'HPA rozeti bu alandan geliyor — guvenlik sinyali');
});

test('kesifte kismi basari AYRI bir durum (bir cluster dustu, digerleri gosterilmeli)', () => {
  const r = result.extractDiscoveryResult({
    scalex_discovery_result: {
      overall_status: 'partial', mode: 'workloads', clusters: ['c1', 'c2'],
      failed_clusters: ['c2'], counts: { fail: 1 },
      items: [{ cluster: 'c2', app: '-', kind: '-', step: 'RUNNER', status: 'FAIL', detail: 'SSH hatasi' }],
    },
  });
  assert.equal(r.overallStatus, 'partial');
  assert.deepEqual(r.failedClusters, ['c2']);
  assert.equal(r.problems.length, 1);
});

// ── Patlama yaricapi ─────────────────────────────────────────────────────────

test('hedef sayisi cluster x uygulama', () => {
  const r = launch.computeBlastRadius({ clusters: ['a', 'b', 'c'], apps: ['x', 'y'], environment: 'test', action: 'stop', executionMode: 'apply' });
  assert.equal(r.targets, 6);
});

test('prod + esik ustu → YAZILI onay; prod disi ISTEMEZ', () => {
  const many = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
  assert.equal(launch.computeBlastRadius({ clusters: ['c'], apps: many, environment: 'prod', action: 'stop', executionMode: 'apply' }).requiresWrittenConfirm, true);
  assert.equal(launch.computeBlastRadius({ clusters: ['c'], apps: many, environment: 'test', action: 'stop', executionMode: 'apply' }).requiresWrittenConfirm, false);
});

test('dry_run YAZILI ONAY ISTEMEZ (hicbir sey degistirmiyor)', () => {
  const r = launch.computeBlastRadius({ clusters: ['a', 'b'], apps: ['x', 'y', 'z', 'w'], environment: 'prod', action: 'stop', executionMode: 'dry_run' });
  assert.equal(r.requiresWrittenConfirm, false, 'guvenli yolu secmekten CAYDIRMAMALI');
  assert.equal(r.requiresSecondPerson, false);
});

test('prod + cok cluster → ikinci kisi onayi', () => {
  assert.equal(launch.computeBlastRadius({ clusters: ['a', 'b'], apps: ['x'], environment: 'prod', action: 'stop', executionMode: 'apply' }).requiresSecondPerson, true);
  assert.equal(launch.computeBlastRadius({ clusters: ['a'], apps: ['x'], environment: 'prod', action: 'stop', executionMode: 'apply' }).requiresSecondPerson, false);
});

// ── Kapi politikasi ──────────────────────────────────────────────────────────

test('dry_run HICBIR kapidan gecmez', () => {
  const p = launch.gatePolicyFor({ action: 'stop', executionMode: 'dry_run' });
  assert.deepEqual([p.oco, p.smart], ['skip', 'skip']);
});

test('restore: SMART acilir, OCO UYARIR ama ENGELLEMEZ', () => {
  // Geri alma bir ONARIM islemidir. Bir olay sirasinda OCO penceresi kapali diye
  // sistemi ayaga kaldiramamak, kapinin cozdugu sorundan buyuk olur.
  const p = launch.gatePolicyFor({ action: 'restore', executionMode: 'apply' });
  assert.equal(p.oco, 'warn');
  assert.equal(p.smart, 'require');
});

test('stop ve scale TAM kapidan gecer', () => {
  for (const action of ['stop', 'scale']) {
    const p = launch.gatePolicyFor({ action, executionMode: 'apply' });
    assert.deepEqual([p.oco, p.smart], ['require', 'require'], action);
  }
});

test('gateVars TAMAMEN sunucuda uretilir — client anahtari giremez', () => {
  const g = launch.buildGateVars({ env: 'prod', tenant: 'ark', action: 'stop', executionMode: 'apply', clusters: ['c1'], namespace: 'ns' });
  assert.deepEqual(Object.keys(g).sort(), ['action', 'cluster_count', 'env', 'execution_mode', 'namespace', 'ortam', 'tenant']);
  // `env` VE `ortam`: prod tespiti (server/oco/prod-detect.cjs) iki anahtari da kabul
  // ediyor; ikisini de gondermek tespitin sessizce kacirilmasini imkansiz kilar.
  assert.equal(g.env, 'prod');
  assert.equal(g.ortam, 'prod');
});

// ── Girdi dogrulamasi ────────────────────────────────────────────────────────

test('namespace ve uygulama adlari Kubernetes-guvenli olmali (oc komut satirina gidiyor)', () => {
  const base = { apps: ['ok-app'], action: 'stop', executionMode: 'apply', verificationTimeout: '60' };
  for (const ns of ['UPPER', 'bos luk', 'x;rm -rf /', '-bas', 'a'.repeat(64)]) {
    assert.throws(() => launch.assertValidTargets({ ...base, namespace: ns }), /Geçersiz namespace/, ns);
  }
  for (const app of ['UPPER', 'x;whoami', 'bos luk']) {
    assert.throws(() => launch.assertValidTargets({ ...base, namespace: 'ns', apps: [app] }), /Geçersiz uygulama/, app);
  }
  launch.assertValidTargets({ ...base, namespace: 'odeme-prod', apps: ['payment-api', 'a.b-c'] });
});

test('scale icin hedef replica ZORUNLU ve tam sayi', () => {
  const base = { namespace: 'ns', apps: ['a'], action: 'scale', executionMode: 'apply', verificationTimeout: '60' };
  for (const v of [undefined, '', '-1', 'abc', '1.5']) {
    assert.throws(() => launch.assertValidTargets({ ...base, targetReplicas: v }), /hedef replica/i, String(v));
  }
  launch.assertValidTargets({ ...base, targetReplicas: '0' });
  launch.assertValidTargets({ ...base, targetReplicas: 3 });
});

// ── Katalog eslemesi ─────────────────────────────────────────────────────────

test('portal cluster satiri playbook katalogu seklinde uretiliyor', () => {
  const cat = launch.buildScaleXClusterCatalog({
    env: 'prod', tenant: 'ark', clusters: ['gbocpprod1'],
    hosts: { gbocpprod1: 'gbjump1' },
    meta: { gbocpprod1: { api_url: 'https://api.x:6443', vault_credential_key: 'uxmid_gar' } },
  });
  assert.equal(cat.version, 1);
  assert.deepEqual(cat.clusters.gbocpprod1, {
    enabled: true, platform: 'ark', environments: ['prod'],
    jump_server: 'gbjump1', api_url: 'https://api.x:6443', credential: 'uxmid_gar',
  });
  // PAROLA HICBIR ZAMAN katalogda olmaz — yalnizca vault degiskeninin ADI.
  assert.equal(JSON.stringify(cat).includes('password'), false);
});

// ── Sapma sinifllamasi ───────────────────────────────────────────────────────

const mirror = (cluster, app) => ({ id: `${cluster}-${app}`, env: 'prod', tenant: 'ark', clusterName: cluster, namespace: 'ns', appName: app });
const onCluster = (cluster, app) => ({ env: 'prod', tenant: 'ark', clusterName: cluster, namespace: 'ns', appName: app });

test('sapma: her iki tarafta da varsa in_sync', () => {
  const out = state.classifyDrift({ mirrorRows: [mirror('c1', 'a')], clusterStates: [onCluster('c1', 'a')], scannedClusters: ['c1'] });
  assert.equal(out[0].drift, state.DRIFT.IN_SYNC);
});

test('sapma: portalda var cluster\'da yok → missing_on_cluster (biri elle geri almis)', () => {
  const out = state.classifyDrift({ mirrorRows: [mirror('c1', 'a')], clusterStates: [], scannedClusters: ['c1'] });
  assert.equal(out[0].drift, state.DRIFT.MISSING_ON_CLUSTER);
});

test('sapma: cluster\'da var portalda yok → unknown_to_portal (AWX\'ten elle durdurulmus)', () => {
  const out = state.classifyDrift({ mirrorRows: [], clusterStates: [onCluster('c1', 'a')], scannedClusters: ['c1'] });
  assert.equal(out[0].drift, state.DRIFT.UNKNOWN_TO_PORTAL);
  assert.equal(out[0].source, 'cluster');
});

test('sapma: TARANMAYAN cluster hakkinda KARAR VERILMEZ', () => {
  // Erisilemeyen bir bastion, o cluster'daki tum kayitlari yanlislikla "biri elle geri
  // almis" gibi gostermemeli — bu, kullaniciyi var olmayan bir sorunu kovalamaya iterdi.
  const out = state.classifyDrift({ mirrorRows: [mirror('c2', 'a')], clusterStates: [], scannedClusters: ['c1'] });
  assert.equal(out[0].drift, null, 'taranmamis cluster icin eski durum korunmali');
});
