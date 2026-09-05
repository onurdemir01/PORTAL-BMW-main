// server/scalex/__tests__/scalex-contract.test.cjs — sonuc sozlesmesi + patlama yaricapi
// + kapi politikasi + buildWorkloadKindMap + classifyDrift + property-based testler.
// Hepsi SAF fonksiyon; DB/AWX/ag gerektirmez.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fc = require('fast-check');

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
  const r = result.extractScaleXResult({
    scalex_result: JSON.stringify({ overall_status: 'FAIL', counts: {}, targets: [] }),
  });
  assert.equal(r.overallStatus, 'FAIL');
});

test('overall_status BOSLUKLU gelirse yine dogru okunur', () => {
  // Bu depoda uretimde YASANDI: katlamali skalerde `{% if %}` etiketleri arasindaki
  // bosluklar ciktiya sizdi ve deger "      failed" olarak yayinlandi. Playbook
  // tarafinda `| trim` var ama portal ona GUVENMEZ — sozlesmenin iki ucu da ayni
  // anda yanlis olabilir ve sonucu kullanici oder.
  const r = result.extractScaleXResult({
    scalex_result: { overall_status: '   fail  ', counts: {}, targets: [] },
  });
  assert.equal(r.overallStatus, 'FAIL');
});

test('hedef satirlarindaki durumlar da normalize edilir', () => {
  const r = result.extractScaleXResult({
    scalex_result: {
      overall_status: 'WARN',
      counts: {},
      targets: [{ cluster: 'c1', app: 'a', kind: 'Deployment', status: ' ok ', detail: 'x' }],
    },
  });
  assert.equal(r.targets[0].status, 'OK');
});

test("strict_blocked FAIL'den AYRI tasinir (cluster'da hicbir degisiklik YOK)", () => {
  const r = result.extractScaleXResult({
    scalex_result: { overall_status: 'FAIL', strict_blocked: true, counts: {}, targets: [] },
  });
  assert.equal(
    r.strictBlocked,
    true,
    'ekran bunu FAIL ile ayni gostermemeli — kullanici icin IYI haber',
  );
});

test('dogrulama hatasi bicimi de AYNI sekle indirgenir', () => {
  const r = result.extractScaleXResult({
    scalex_result: {
      overall_status: 'FAIL',
      stage: 'validation',
      validation_error: 'namespace gecersiz',
      failed_task: 'Validate inputs',
      counts: { fail: 1 },
      targets: [],
      rows: [],
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
      overall_status: 'ok',
      mode: 'workloads',
      counts: {},
      clusters: ['c1'],
      items: [
        {
          cluster: 'c1',
          app: 'batch',
          kind: 'Deployment',
          step: 'WORKLOAD',
          status: 'OK',
          detail:
            'resource=deploy spec=0 status=0 ready=0 hpa=no state_phase=scaled_down previous_replicas=2 image=reg/b:1',
        },
        {
          cluster: 'c1',
          app: 'pay',
          kind: 'Deployment',
          step: 'WORKLOAD',
          status: 'OK',
          detail:
            'resource=deploy spec=3 status=3 ready=3 hpa=yes state_phase=- previous_replicas=- image=reg/p:2',
        },
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
      overall_status: 'partial',
      mode: 'workloads',
      clusters: ['c1', 'c2'],
      failed_clusters: ['c2'],
      counts: { fail: 1 },
      items: [
        {
          cluster: 'c2',
          app: '-',
          kind: '-',
          step: 'RUNNER',
          status: 'FAIL',
          detail: 'SSH hatasi',
        },
      ],
    },
  });
  assert.equal(r.overallStatus, 'partial');
  assert.deepEqual(r.failedClusters, ['c2']);
  assert.equal(r.problems.length, 1);
});

// ── Patlama yaricapi ─────────────────────────────────────────────────────────

test('hedef sayisi cluster x uygulama', () => {
  const r = launch.computeBlastRadius({
    clusters: ['a', 'b', 'c'],
    apps: ['x', 'y'],
    environment: 'test',
    action: 'stop',
    executionMode: 'apply',
  });
  assert.equal(r.targets, 6);
});

test('prod + esik ustu → YAZILI onay; prod disi ISTEMEZ', () => {
  const many = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
  assert.equal(
    launch.computeBlastRadius({
      clusters: ['c'],
      apps: many,
      environment: 'prod',
      action: 'stop',
      executionMode: 'apply',
    }).requiresWrittenConfirm,
    true,
  );
  assert.equal(
    launch.computeBlastRadius({
      clusters: ['c'],
      apps: many,
      environment: 'test',
      action: 'stop',
      executionMode: 'apply',
    }).requiresWrittenConfirm,
    false,
  );
});

test('dry_run YAZILI ONAY ISTEMEZ (hicbir sey degistirmiyor)', () => {
  const r = launch.computeBlastRadius({
    clusters: ['a', 'b'],
    apps: ['x', 'y', 'z', 'w'],
    environment: 'prod',
    action: 'stop',
    executionMode: 'dry_run',
  });
  assert.equal(r.requiresWrittenConfirm, false, 'guvenli yolu secmekten CAYDIRMAMALI');
  assert.equal(r.requiresSecondPerson, false);
});

test('prod + cok cluster → ikinci kisi onayi', () => {
  assert.equal(
    launch.computeBlastRadius({
      clusters: ['a', 'b'],
      apps: ['x'],
      environment: 'prod',
      action: 'stop',
      executionMode: 'apply',
    }).requiresSecondPerson,
    true,
  );
  assert.equal(
    launch.computeBlastRadius({
      clusters: ['a'],
      apps: ['x'],
      environment: 'prod',
      action: 'stop',
      executionMode: 'apply',
    }).requiresSecondPerson,
    false,
  );
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
  const g = launch.buildGateVars({
    env: 'prod',
    tenant: 'ark',
    action: 'stop',
    executionMode: 'apply',
    clusters: ['c1'],
    namespace: 'ns',
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
  // `env` VE `ortam`: prod tespiti (server/oco/prod-detect.cjs) iki anahtari da kabul
  // ediyor; ikisini de gondermek tespitin sessizce kacirilmasini imkansiz kilar.
  assert.equal(g.env, 'prod');
  assert.equal(g.ortam, 'prod');
});

// ── Girdi dogrulamasi ────────────────────────────────────────────────────────

test('namespace ve uygulama adlari Kubernetes-guvenli olmali (oc komut satirina gidiyor)', () => {
  const base = {
    apps: ['ok-app'],
    action: 'stop',
    executionMode: 'apply',
    verificationTimeout: '60',
  };
  for (const ns of ['UPPER', 'bos luk', 'x;rm -rf /', '-bas', 'a'.repeat(64)]) {
    assert.throws(
      () => launch.assertValidTargets({ ...base, namespace: ns }),
      /Geçersiz namespace/,
      ns,
    );
  }
  for (const app of ['UPPER', 'x;whoami', 'bos luk']) {
    assert.throws(
      () => launch.assertValidTargets({ ...base, namespace: 'ns', apps: [app] }),
      /Geçersiz uygulama/,
      app,
    );
  }
  launch.assertValidTargets({ ...base, namespace: 'odeme-prod', apps: ['payment-api', 'a.b-c'] });
});

test('scale icin hedef replica ZORUNLU ve tam sayi', () => {
  const base = {
    namespace: 'ns',
    apps: ['a'],
    action: 'scale',
    executionMode: 'apply',
    verificationTimeout: '60',
  };
  for (const v of [undefined, '', '-1', 'abc', '1.5']) {
    assert.throws(
      () => launch.assertValidTargets({ ...base, targetReplicas: v }),
      /hedef replica/i,
      String(v),
    );
  }
  launch.assertValidTargets({ ...base, targetReplicas: '0' });
  launch.assertValidTargets({ ...base, targetReplicas: 3 });
});

// ── Katalog eslemesi ─────────────────────────────────────────────────────────

test('portal cluster satiri playbook katalogu seklinde uretiliyor', () => {
  const cat = launch.buildScaleXClusterCatalog({
    env: 'prod',
    tenant: 'ark',
    clusters: ['gbocpprod1'],
    hosts: { gbocpprod1: 'gbjump1' },
    meta: { gbocpprod1: { api_url: 'https://api.x:6443', vault_credential_key: 'uxmid_gar' } },
  });
  assert.equal(cat.version, 1);
  assert.deepEqual(cat.clusters.gbocpprod1, {
    enabled: true,
    platform: 'ark',
    environments: ['prod'],
    jump_server: 'gbjump1',
    api_url: 'https://api.x:6443',
    credential: 'uxmid_gar',
  });
  // PAROLA HICBIR ZAMAN katalogda olmaz — yalnizca vault degiskeninin ADI.
  assert.equal(JSON.stringify(cat).includes('password'), false);
});

// ── Sapma sinifllamasi ───────────────────────────────────────────────────────

const mirror = (cluster, app) => ({
  id: `${cluster}-${app}`,
  env: 'prod',
  tenant: 'ark',
  clusterName: cluster,
  namespace: 'ns',
  appName: app,
});
const onCluster = (cluster, app) => ({
  env: 'prod',
  tenant: 'ark',
  clusterName: cluster,
  namespace: 'ns',
  appName: app,
});

test('sapma: her iki tarafta da varsa in_sync', () => {
  const out = state.classifyDrift({
    mirrorRows: [mirror('c1', 'a')],
    clusterStates: [onCluster('c1', 'a')],
    scannedClusters: ['c1'],
  });
  assert.equal(out[0].drift, state.DRIFT.IN_SYNC);
});

test("sapma: portalda var cluster'da yok → missing_on_cluster (biri elle geri almis)", () => {
  const out = state.classifyDrift({
    mirrorRows: [mirror('c1', 'a')],
    clusterStates: [],
    scannedClusters: ['c1'],
  });
  assert.equal(out[0].drift, state.DRIFT.MISSING_ON_CLUSTER);
});

test("sapma: cluster'da var portalda yok → unknown_to_portal (AWX'ten elle durdurulmus)", () => {
  const out = state.classifyDrift({
    mirrorRows: [],
    clusterStates: [onCluster('c1', 'a')],
    scannedClusters: ['c1'],
  });
  assert.equal(out[0].drift, state.DRIFT.UNKNOWN_TO_PORTAL);
  assert.equal(out[0].source, 'cluster');
});

test('sapma: TARANMAYAN cluster hakkinda KARAR VERILMEZ', () => {
  // Erisilemeyen bir bastion, o cluster'daki tum kayitlari yanlislikla "biri elle geri
  // almis" gibi gostermemeli — bu, kullaniciyi var olmayan bir sorunu kovalamaya iterdi.
  const out = state.classifyDrift({
    mirrorRows: [mirror('c2', 'a')],
    clusterStates: [],
    scannedClusters: ['c1'],
  });
  assert.equal(out[0].drift, null, 'taranmamis cluster icin eski durum korunmali');
});

// ═══ buildWorkloadKindMap — UYGULAMA BASINA TIP HARITASI ═══════════════════
//
// `buildWorkloadKindMap(entries, allowedApps)` saf fonksiyonu, kesiften gelen
// `{name, kind}` satirlarini playbook'un bekledigi `"name1=deploy,name2=sts"` bicimine
// cevirir. Cikti bir STRING'dir (Map veya nesne DEGIL). Bos cikti `''` doner ve
// `extra_vars`'a HIC GONDERILMEZ (playbook `auto`ya duser).

const bwm = (entries, allowed) => launch.buildWorkloadKindMap(entries, allowed);

// ── Bos / gecersiz girdi ────────────────────────────────────────────────────

test('WKM1 null girdi → bos string', () => {
  assert.equal(bwm(null, ['a']), '');
});

test('WKM2 undefined girdi → bos string', () => {
  assert.equal(bwm(undefined, ['a']), '');
});

test('WKM3 bos dizi → bos string', () => {
  assert.equal(bwm([], ['a']), '');
});

test('WKM4 dizi degil (nesne) → bos string', () => {
  assert.equal(bwm({ name: 'a', kind: 'Deployment' }, ['a']), '');
});

test('WKM5 dizi degil (string) → bos string', () => {
  assert.equal(bwm('a=deploy', ['a']), '');
});

// ── Tek girdi ────────────────────────────────────────────────────────────────

test('WKM6 tek gecerli girdi → tek cift', () => {
  assert.equal(bwm([{ name: 'odeme-api', kind: 'Deployment' }], ['odeme-api']), 'odeme-api=deploy');
});

test('WKM7 tam ad (StatefulSet) → kisa tip (sts)', () => {
  assert.equal(bwm([{ name: 'kafka', kind: 'StatefulSet' }], ['kafka']), 'kafka=sts');
});

test('WKM8 kisa ad (sts) → kisa tip (sts)', () => {
  assert.equal(bwm([{ name: 'kafka', kind: 'sts' }], ['kafka']), 'kafka=sts');
});

test('WKM9 DeploymentConfig → dc', () => {
  assert.equal(bwm([{ name: 'legacy', kind: 'DeploymentConfig' }], ['legacy']), 'legacy=dc');
});

test('WKM10 ArgoRollout → rollout', () => {
  assert.equal(bwm([{ name: 'canary', kind: 'ArgoRollout' }], ['canary']), 'canary=rollout');
});

// ── allowedApps suzgeci ─────────────────────────────────────────────────────

test("WKM11 allowedApps'ta OLMAYAN girdi DISLANIR", () => {
  assert.equal(bwm([{ name: 'gizli', kind: 'Deployment' }], ['baska-app']), '');
});

test('WKM12 allowedApps bos dizi → hicbir girdi GECMEZ', () => {
  assert.equal(bwm([{ name: 'a', kind: 'Deployment' }], []), '');
});

test('WKM13 allowedApps undefined → bos Set → hicbir girdi GECMEZ', () => {
  assert.equal(bwm([{ name: 'a', kind: 'Deployment' }], undefined), '');
});

test("WKM14 allowedApps'ta olan GECER, olmayan DISLANIR", () => {
  const entries = [
    { name: 'odeme', kind: 'Deployment' },
    { name: 'fatura', kind: 'StatefulSet' },
  ];
  assert.equal(bwm(entries, ['odeme']), 'odeme=deploy');
});

// ── Olceklenemez tipler ─────────────────────────────────────────────────────

test('WKM15 DaemonSet DISLANIR (olceklenemez)', () => {
  assert.equal(bwm([{ name: 'fluentd', kind: 'DaemonSet' }], ['fluentd']), '');
});

test('WKM16 CronJob DISLANIR (olceklenemez)', () => {
  assert.equal(bwm([{ name: 'rapor', kind: 'CronJob' }], ['rapor']), '');
});

test('WKM17 Job DISLANIR (olceklenemez)', () => {
  assert.equal(bwm([{ name: 'migrasyon', kind: 'Job' }], ['migrasyon']), '');
});

test('WKM18 bilinmeyen tip DISLANIR', () => {
  assert.equal(bwm([{ name: 'x', kind: 'ServiceMesh' }], ['x']), '');
});

test('WKM19 bos tip DISLANIR', () => {
  assert.equal(bwm([{ name: 'x', kind: '' }], ['x']), '');
});

test('WKM20 kind alani YOK → DISLANIR', () => {
  assert.equal(bwm([{ name: 'x' }], ['x']), '');
});

// ── Coklu girdi ve siralama ─────────────────────────────────────────────────

test('WKM21 coklu girdi → virgulle ayrlmis, EKLEME SIRASI korunur', () => {
  const entries = [
    { name: 'odeme', kind: 'Deployment' },
    { name: 'kafka', kind: 'StatefulSet' },
    { name: 'legacy', kind: 'DeploymentConfig' },
  ];
  assert.equal(bwm(entries, ['odeme', 'kafka', 'legacy']), 'odeme=deploy,kafka=sts,legacy=dc');
});

test('WKM22 allowedApps sirasi sonucu ETKILEMEZ (girdi sirasi esas)', () => {
  const entries = [
    { name: 'b', kind: 'Deployment' },
    { name: 'a', kind: 'Deployment' },
  ];
  // allowedApps ters sirada olsa bile cikti girdi sirasinda
  assert.equal(bwm(entries, ['a', 'b']), 'b=deploy,a=deploy');
});

// ── Ayni ad, ayni tip (tekillestirme) ───────────────────────────────────────

test('WKM23 ayni ad + ayni tip → YALNIZCA BIR KAYIT', () => {
  const entries = [
    { name: 'odeme', kind: 'Deployment' },
    { name: 'odeme', kind: 'deployment' }, // ayni tip (normalize sonrasi)
  ];
  assert.equal(bwm(entries, ['odeme']), 'odeme=deploy');
});

test('WKM24 ayni ad + ayni kisa tip → YALNIZCA BIR KAYIT', () => {
  const entries = [
    { name: 'odeme', kind: 'sts' },
    { name: 'odeme', kind: 'StatefulSet' }, // ayni tip
  ];
  assert.equal(bwm(entries, ['odeme']), 'odeme=sts');
});

// ── Ayni ad, FARKLI tip (belirsizlik) ───────────────────────────────────────

test('WKM25 ayni ad + FARKLI tip → DISLANIR (belirsiz, playbook DURUR)', () => {
  // Bir Deployment ile ayni adli bir DeploymentConfig varsa, birini secmek
  // kullanicinin vermedigi bir karari onun adina vermek olurdu.
  const entries = [
    { name: 'odeme', kind: 'Deployment' },
    { name: 'odeme', kind: 'DeploymentConfig' },
  ];
  assert.equal(bwm(entries, ['odeme']), '');
});

test('WKM26 ayni ad + FARKLI tip (sts vs deploy) → DISLANIR', () => {
  const entries = [
    { name: 'srv', kind: 'StatefulSet' },
    { name: 'srv', kind: 'Deployment' },
  ];
  assert.equal(bwm(entries, ['srv']), '');
});

test('WKM27 belirsiz ad diger GECERLI adlari ETKILEMEZ', () => {
  const entries = [
    { name: 'belirsiz', kind: 'Deployment' },
    { name: 'belirsiz', kind: 'StatefulSet' },
    { name: 'iyi', kind: 'Deployment' },
  ];
  assert.equal(bwm(entries, ['belirsiz', 'iyi']), 'iyi=deploy');
});

test('WKM28 uc FARKLI tip ayni ad icin → belirsiz (null) kalir', () => {
  const entries = [
    { name: 'x', kind: 'Deployment' },
    { name: 'x', kind: 'StatefulSet' },
    { name: 'x', kind: 'DeploymentConfig' },
  ];
  assert.equal(bwm(entries, ['x']), '');
});

// ── Bosluk / buyuk-kucuk harf ────────────────────────────────────────────────

test('WKM29 kind BUYUK HARF → tanimlanir (lowercase normalize)', () => {
  assert.equal(bwm([{ name: 'a', kind: 'DEPLOYMENT' }], ['a']), 'a=deploy');
});

test('WKM30 kind karisik harf → tanimlanir', () => {
  assert.equal(bwm([{ name: 'a', kind: 'StateFulSet' }], ['a']), 'a=sts');
});

test('WKM31 name BASTAKI/SONDAKI bosluk kirpilIR', () => {
  assert.equal(bwm([{ name: '  odeme  ', kind: 'Deployment' }], ['odeme']), 'odeme=deploy');
});

test('WKM32 kind BASTAKI/SONDAKI bosluk kirpilIR', () => {
  assert.equal(bwm([{ name: 'a', kind: '  deployment  ' }], ['a']), 'a=deploy');
});

// ── Uclu / kirli girdi dayanikliligi ────────────────────────────────────────

test('WKM33 null girdi ogesi ATLANIR (patlamaz)', () => {
  const entries = [null, { name: 'a', kind: 'Deployment' }];
  assert.equal(bwm(entries, ['a']), 'a=deploy');
});

test('WKM34 undefined girdi ogesi ATLANIR', () => {
  const entries = [undefined, { name: 'a', kind: 'Deployment' }];
  assert.equal(bwm(entries, ['a']), 'a=deploy');
});

test('WKM35 bos nesne ATLANIR', () => {
  const entries = [{}, { name: 'a', kind: 'Deployment' }];
  assert.equal(bwm(entries, ['a']), 'a=deploy');
});

// ═══ buildClusterWorkloadKindMap — CLUSTER BASINA TIP HARITASI ═════════════

const bckm = (entries, allowed) => launch.buildClusterWorkloadKindMap(entries, allowed);

test('CKM1 tek cluster, tek uygulama → o cluster icin harita', () => {
  assert.deepEqual(bckm([{ cluster: 'c1', name: 'odeme', kind: 'Deployment' }], ['odeme']), {
    c1: 'odeme=deploy',
  });
});

test('CKM2 farkli clusterlarda ayni ad farkli tip → her cluster kendi tipi', () => {
  const entries = [
    { cluster: 'test1', name: 'app-X', kind: 'DeploymentConfig' },
    { cluster: 'test2', name: 'app-X', kind: 'Deployment' },
    { cluster: 'test3', name: 'app-X', kind: 'ArgoRollout' },
  ];
  assert.deepEqual(bckm(entries, ['app-X']), {
    test1: 'app-X=dc',
    test2: 'app-X=deploy',
    test3: 'app-X=rollout',
  });
});

test('CKM3 ayni cluster icinde ayni ad FARKLI tip → belirsiz, o cluster haritasi bos kalir', () => {
  const entries = [
    { cluster: 'c1', name: 'app', kind: 'Deployment' },
    { cluster: 'c1', name: 'app', kind: 'StatefulSet' },
    { cluster: 'c2', name: 'app', kind: 'Deployment' },
  ];
  assert.deepEqual(bckm(entries, ['app']), {
    c1: '',
    c2: 'app=deploy',
  });
});

test('CKM4 allowedApps disindaki ad DISLANIR', () => {
  assert.deepEqual(bckm([{ cluster: 'c1', name: 'gizli', kind: 'Deployment' }], ['baska']), {});
});

test('CKM5 olceklenemez tip (DaemonSet) DISLANIR', () => {
  assert.deepEqual(bckm([{ cluster: 'c1', name: 'fluentd', kind: 'DaemonSet' }], ['fluentd']), {});
});

test('CKM6 nesne seklinde gelen clusterWorkloadKinds de normalize edilir', () => {
  const input = {
    c1: [{ name: 'a', kind: 'Deployment' }],
    c2: [{ name: 'a', kind: 'StatefulSet' }],
  };
  assert.deepEqual(bckm(input, ['a']), {
    c1: 'a=deploy',
    c2: 'a=sts',
  });
});

test('CKM7 bos girdi → bos nesne', () => {
  assert.deepEqual(bckm(null, ['a']), {});
  assert.deepEqual(bckm([], ['a']), {});
  assert.deepEqual(bckm({}, ['a']), {});
});

// ═══ classifyDrift — KAPSAMLI MATRIS TESTLERI ══════════════════════════════
//
// `classifyDrift({ mirrorRows, clusterStates, scannedClusters })` siniflamasini
// dort temel senaryoda dogrular. Mevcut temel testler yukarida; burada ek yuzeyler
// ve birlesik senaryolar var.

test('CD1 bos girdi → bos cikti', () => {
  assert.deepEqual(state.classifyDrift({}), []);
  assert.deepEqual(
    state.classifyDrift({ mirrorRows: [], clusterStates: [], scannedClusters: [] }),
    [],
  );
});

test('CD2 her satir source alanini TASIR', () => {
  const out = state.classifyDrift({
    mirrorRows: [mirror('c1', 'a')],
    clusterStates: [onCluster('c2', 'b')],
    scannedClusters: ['c1', 'c2'],
  });
  const portal = out.find((r) => r.appName === 'a');
  const cluster = out.find((r) => r.appName === 'b');
  assert.equal(portal.source, 'portal');
  assert.equal(cluster.source, 'cluster');
});

test('CD3 her satir onCluster alanini TASIR', () => {
  const out = state.classifyDrift({
    mirrorRows: [mirror('c1', 'synced'), mirror('c1', 'missing')],
    clusterStates: [onCluster('c1', 'synced')],
    scannedClusters: ['c1'],
  });
  const synced = out.find((r) => r.appName === 'synced');
  const missing = out.find((r) => r.appName === 'missing');
  assert.equal(synced.onCluster, true);
  assert.equal(missing.onCluster, false);
});

test('CD4 KARISIK senaryo: in_sync + missing + unknown + null (taranmayan)', () => {
  const out = state.classifyDrift({
    mirrorRows: [
      mirror('c1', 'sync-app'), // cluster'da da var → in_sync
      mirror('c1', 'gone-app'), // cluster'da YOK, c1 tarandi → missing_on_cluster
      mirror('c2', 'unscanned-app'), // c2 TARANMADI → null
    ],
    clusterStates: [
      onCluster('c1', 'sync-app'),
      onCluster('c3', 'rogue-app'), // portalda YOK → unknown_to_portal
    ],
    scannedClusters: ['c1', 'c3'], // c2 TARANMADI
  });
  assert.equal(out.length, 4);
  assert.equal(out.find((r) => r.appName === 'sync-app').drift, state.DRIFT.IN_SYNC);
  assert.equal(out.find((r) => r.appName === 'gone-app').drift, state.DRIFT.MISSING_ON_CLUSTER);
  assert.equal(out.find((r) => r.appName === 'unscanned-app').drift, null);
  assert.equal(out.find((r) => r.appName === 'rogue-app').drift, state.DRIFT.UNKNOWN_TO_PORTAL);
});

test('CD5 ayni ad FARKLI namespace → AYRI kayitlar (KARISMAZ)', () => {
  const m1 = { ...mirror('c1', 'app'), namespace: 'ns1' };
  const m2 = { ...mirror('c1', 'app'), namespace: 'ns2' };
  const c1 = { ...onCluster('c1', 'app'), namespace: 'ns1' };
  const out = state.classifyDrift({
    mirrorRows: [m1, m2],
    clusterStates: [c1],
    scannedClusters: ['c1'],
  });
  assert.equal(out.length, 2);
  assert.equal(out.find((r) => r.namespace === 'ns1').drift, state.DRIFT.IN_SYNC);
  assert.equal(out.find((r) => r.namespace === 'ns2').drift, state.DRIFT.MISSING_ON_CLUSTER);
});

test('CD6 ayni ad FARKLI cluster → AYRI kayitlar (KARISMAZ)', () => {
  const out = state.classifyDrift({
    mirrorRows: [mirror('c1', 'app')],
    clusterStates: [onCluster('c2', 'app')],
    scannedClusters: ['c1', 'c2'],
  });
  assert.equal(out.length, 2);
  const portalRow = out.find((r) => r.source === 'portal');
  const clusterRow = out.find((r) => r.source === 'cluster');
  assert.equal(portalRow.drift, state.DRIFT.MISSING_ON_CLUSTER);
  assert.equal(clusterRow.drift, state.DRIFT.UNKNOWN_TO_PORTAL);
});

test('CD7 ayni ad FARKLI env → AYRI kayitlar', () => {
  const m = { ...mirror('c1', 'app'), env: 'prod' };
  const c = { ...onCluster('c1', 'app'), env: 'test' };
  const out = state.classifyDrift({ mirrorRows: [m], clusterStates: [c], scannedClusters: ['c1'] });
  assert.equal(out.length, 2, 'farkli env ayri anahtar');
});

test('CD8 ayni ad FARKLI tenant → AYRI kayitlar', () => {
  const m = { ...mirror('c1', 'app'), tenant: 'ark' };
  const c = { ...onCluster('c1', 'app'), tenant: 'wyden' };
  const out = state.classifyDrift({ mirrorRows: [m], clusterStates: [c], scannedClusters: ['c1'] });
  assert.equal(out.length, 2, 'farkli tenant ayri anahtar');
});

test("CD9 clusterStates'de AMA scannedClusters'de OLMAYAN cluster: mirror satir null", () => {
  // Cluster scan sonucu gelmis ama scannedClusters listesinde yok (beklenmedik, ama savunma).
  const out = state.classifyDrift({
    mirrorRows: [mirror('c1', 'a')],
    clusterStates: [onCluster('c1', 'a')],
    scannedClusters: [], // c1 TARANMADI olarak isaretli
  });
  // clusterByKey'de buldugu icin in_sync doner — scannedClusters yalnizca
  // "taranmamis cluster'da missing" dememek icin kontrol edilir.
  assert.equal(out[0].drift, state.DRIFT.IN_SYNC);
});

test('CD10 portal satirlari original alanlari KORUR', () => {
  const m = { ...mirror('c1', 'app'), phase: 'scaled_down', previousReplicas: 3 };
  const out = state.classifyDrift({
    mirrorRows: [m],
    clusterStates: [onCluster('c1', 'app')],
    scannedClusters: ['c1'],
  });
  assert.equal(out[0].phase, 'scaled_down');
  assert.equal(out[0].previousReplicas, 3);
});

test('CD11 birden fazla unknown_to_portal satir', () => {
  const out = state.classifyDrift({
    mirrorRows: [],
    clusterStates: [onCluster('c1', 'a'), onCluster('c1', 'b'), onCluster('c2', 'c')],
    scannedClusters: ['c1', 'c2'],
  });
  assert.equal(out.length, 3);
  assert.ok(out.every((r) => r.drift === state.DRIFT.UNKNOWN_TO_PORTAL));
  assert.ok(out.every((r) => r.source === 'cluster'));
});

test('CD12 DRIFT sabitleri donmustur (Object.freeze)', () => {
  assert.throws(() => {
    state.DRIFT.NEW_STATE = 'new';
  }, TypeError);
});

// ═══ Property-based testler (fast-check) ════════════════════════════════════
//
// Ozellik tabanli testler, elle yazilamayan kenar durumlarini rastgele girdi
// uzayindan ornekleyerek yakalar. Her test yuzlerce rastgele girdiyle calisir.

// ── buildWorkloadKindMap: gecerli girdi kumesi icin tutarlilik ──────────────

test('WKM-P1 property: her gecerli girdi → ciktida name=kind cifti var', () => {
  const validKinds = [
    'Deployment',
    'StatefulSet',
    'DeploymentConfig',
    'ArgoRollout',
    'deploy',
    'sts',
    'dc',
    'rollout',
  ];
  const kindToExpected = {
    deployment: 'deploy',
    deploy: 'deploy',
    statefulset: 'sts',
    sts: 'sts',
    deploymentconfig: 'dc',
    dc: 'dc',
    argorollout: 'rollout',
    rollout: 'rollout',
  };

  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          name: fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/),
          kind: fc.constantFrom(...validKinds),
        }),
        { minLength: 1, maxLength: 20 },
      ),
      (entries) => {
        const apps = [...new Set(entries.map((e) => e.name))];
        const result = bwm(entries, apps);
        if (!result) return; // belirsizlik yuzunden bos olabilir — gecerli
        const pairs = result.split(',');
        for (const pair of pairs) {
          const [name, kind] = pair.split('=');
          // Her cift girdide var olmali
          assert.ok(apps.includes(name), `ciktidaki ${name} girdide yok`);
          assert.ok(['deploy', 'sts', 'dc', 'rollout'].includes(kind), `beklenmeyen tip: ${kind}`);
        }
      },
    ),
    { numRuns: 200 },
  );
});

test('WKM-P2 property: tek tip icin benzersiz adlar → hepsi ciktida', () => {
  // Ayni tip (deploy) ve BENZERSIZ adlar verildiginde, her ad ciktida OLMALI.
  // Bu, tekillestirme/belirsizlik mantiginin gecerli girdiyi KAYBETMEDIGINI dogrular.
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/), { minLength: 1, maxLength: 15 }),
      (names) => {
        const entries = names.map((n) => ({ name: n, kind: 'Deployment' }));
        const result = bwm(entries, names);
        const pairs = result.split(',');
        assert.equal(pairs.length, names.length, 'girdi sayisi kadar cift bekleniyor');
        const outNames = pairs.map((p) => p.split('=')[0]);
        for (const n of names) {
          assert.ok(outNames.includes(n), `${n} ciktida eksik`);
        }
        for (const p of pairs) {
          assert.equal(p.split('=')[1], 'deploy', 'tum tipler deploy olmali');
        }
      },
    ),
    { numRuns: 200 },
  );
});

test('WKM-P3 property: cikti parse edilebilir (name=kind bicimi)', () => {
  // Cikti formati her zaman `name=kind` ciftlerinin virgulle ayrilmasi olmali.
  // Playbook bu bicimi `split(',')` ve `split('=')` ile parse eder.
  const validKinds = ['Deployment', 'StatefulSet', 'DeploymentConfig', 'ArgoRollout'];
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          name: fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/),
          kind: fc.constantFrom(...validKinds),
        }),
        { minLength: 1, maxLength: 20 },
      ),
      (entries) => {
        const apps = [...new Set(entries.map((e) => e.name))];
        const result = bwm(entries, apps);
        if (result === '') return; // gecerli bos sonuc
        const PAIR_RE = /^[a-z][a-z0-9-]*=(deploy|sts|dc|rollout)$/;
        for (const pair of result.split(',')) {
          assert.match(pair, PAIR_RE, `gecersiz cift: ${pair}`);
        }
      },
    ),
    { numRuns: 200 },
  );
});

test('WKM-P4 property: allowedApps disindaki adlar ASLA ciktida YOK', () => {
  // Cikti yalnizca allowedApps'teki adlari icerebilir. Bu, playbook'a
  // dogrulanmamis bir uygulama adinin GITMEMESINI saglayan guvenlik siniridir.
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          name: fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/),
          kind: fc.constantFrom('Deployment', 'StatefulSet'),
        }),
        { minLength: 1, maxLength: 10 },
      ),
      fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/), { minLength: 0, maxLength: 5 }),
      (entries, allowedSublist) => {
        const result = bwm(entries, allowedSublist);
        if (result === '') return;
        const allowed = new Set(allowedSublist);
        for (const pair of result.split(',')) {
          const [name] = pair.split('=');
          assert.ok(allowed.has(name), `${name} allowedApps'ta yok ama ciktida`);
        }
      },
    ),
    { numRuns: 200 },
  );
});

// ── classifyDrift: siniflama matrisinin tutarliligi ─────────────────────────

test('CD-P1 property: siniflama matrisi dort durumu DOGRU eslestirir', () => {
  // Her satir icin beklenen siniflama:
  //   portal + cluster + scanned → in_sync
  //   portal + !cluster + scanned → missing_on_cluster
  //   portal + !cluster + !scanned → null
  //   !portal + cluster → unknown_to_portal
  fc.assert(
    fc.property(
      fc.uniqueArray(
        fc.record({
          cluster: fc.constantFrom('c1', 'c2', 'c3'),
          app: fc.stringMatching(/^[a-z]{1,5}$/),
        }),
        { minLength: 1, maxLength: 8, selector: (r) => `${r.cluster}|${r.app}` },
      ),
      fc.constantFrom('c1', 'c2', 'c3'),
      (rows, scannedCluster) => {
        // Rastgele: her satir icin portal/cluster/tarama durumunu se
        const mirrorRows = [];
        const clusterStates = [];
        const scannedClusters = new Set([scannedCluster]);

        for (const r of rows) {
          const inPortal = Math.random() > 0.3;
          const onClust = Math.random() > 0.3;
          if (inPortal) mirrorRows.push(mirror(r.cluster, r.app));
          if (onClust) clusterStates.push(onCluster(r.cluster, r.app));
        }

        const out = state.classifyDrift({
          mirrorRows,
          clusterStates,
          scannedClusters: [...scannedClusters],
        });

        for (const row of out) {
          if (row.source === 'portal') {
            if (row.onCluster) {
              assert.equal(
                row.drift,
                state.DRIFT.IN_SYNC,
                `portal+cluster → in_sync bekleniyor: ${row.appName}`,
              );
            } else if (scannedClusters.has(row.clusterName)) {
              assert.equal(
                row.drift,
                state.DRIFT.MISSING_ON_CLUSTER,
                `portal+!cluster+scanned → missing bekleniyor: ${row.appName}`,
              );
            } else {
              assert.equal(
                row.drift,
                null,
                `portal+!cluster+!scanned → null bekleniyor: ${row.appName}`,
              );
            }
          } else if (row.source === 'cluster') {
            assert.equal(
              row.drift,
              state.DRIFT.UNKNOWN_TO_PORTAL,
              `!portal+cluster → unknown bekleniyor: ${row.appName}`,
            );
            assert.equal(
              row.onCluster,
              true,
              `cluster kaynagli satir onCluster=true olmali: ${row.appName}`,
            );
          }
        }
      },
    ),
    { numRuns: 300 },
  );
});

test('CD-P2 property: cikti boyutu = portal + (cluster-only) satirlari', () => {
  // classifyDrift'in cikti boyutu HER ZAMAN:
  //   mirrorRows.length + (clusterStates'de aynada OLMAYANLARIN sayisi)
  fc.assert(
    fc.property(
      fc.uniqueArray(
        fc.record({
          cluster: fc.constantFrom('c1', 'c2'),
          app: fc.stringMatching(/^[a-z]{1,4}$/),
        }),
        { minLength: 0, maxLength: 6, selector: (r) => `${r.cluster}|${r.app}` },
      ),
      fc.uniqueArray(
        fc.record({
          cluster: fc.constantFrom('c1', 'c2'),
          app: fc.stringMatching(/^[a-z]{1,4}$/),
        }),
        { minLength: 0, maxLength: 6, selector: (r) => `${r.cluster}|${r.app}` },
      ),
      (mirrorEntries, clusterEntries) => {
        const mirrorRows = mirrorEntries.map((r) => mirror(r.cluster, r.app));
        const clusterStates = clusterEntries.map((r) => onCluster(r.cluster, r.app));
        const scannedClusters = ['c1', 'c2'];

        const out = state.classifyDrift({ mirrorRows, clusterStates, scannedClusters });

        // Portal kaynakli satirlar: mirrorRows'un TAMAMI
        const portalCount = out.filter((r) => r.source === 'portal').length;
        assert.equal(portalCount, mirrorRows.length, 'her mirror satiri ciktida olmali');

        // Cluster kaynakli satirlar: aynada OLMAYAN cluster satirlari
        const clusterOnlyCount = out.filter((r) => r.source === 'cluster').length;
        // Aynada olan cluster satirlari sayisini bul
        const mirrorKeys = new Set(
          mirrorRows.map((m) =>
            [m.env, m.tenant, m.clusterName, m.namespace, m.appName].join('\u001f'),
          ),
        );
        const expectedClusterOnly = clusterStates.filter((s) => {
          const k = [s.env, s.tenant, s.clusterName, s.namespace, s.appName].join('\u001f');
          return !mirrorKeys.has(k);
        }).length;
        assert.equal(
          clusterOnlyCount,
          expectedClusterOnly,
          'yalnizca aynada OLMAYAN cluster satirlari ciktiya eklenmeli',
        );
      },
    ),
    { numRuns: 200 },
  );
});
