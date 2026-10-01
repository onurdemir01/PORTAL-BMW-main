// server/ansible/__tests__/fixtures/scalex-kesif-senaryolar.cjs
//
// KESIF (`workloads`) ALTIN CIKTI senaryolari. Altin dosya
// (`scalex-kesif-altin.json`) satir basina alt kabuk acan ESKI betikle (paket
// v23) uretildi; alt kabuksuz satir yolu ayni senaryolarda BIREBIR ayni
// satirlari basmak zorunda (N2). Ekran bu satirlardan kuruluyor.
//
// Senaryolar bilerek "kirli" veri tasir: imajda bosluk/sekme/`;`, uzun detay,
// buyuk harfli ve eski onekli durum kayitlari, bozuk `previous_replicas`,
// ArgoCD/managed-by etiketleri — hizli yolun her dali eski yolun metin
// donusumlerini (sanitize, disc_val, safe_name) taklit etmek zorunda.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const RUNNER = path.join(
  ROOT,
  'server/ansible/bmw_portal/scalex/scalex_app/files/scalex_runner.sh',
);
const SAHTE_OC = path.join(__dirname, 'scalex-sahte-oc.cjs');

const ARGO = 'argocd.argoproj.io/instance';
const MGD = 'app.kubernetes.io/managed-by';

const TEMEL_MODEL = {
  nesneler: {
    deploy: [
      { name: 'odeme-api', spec: 3, image: 'reg/odeme:1.2' },
      { name: 'sifir-app', spec: 0, status: 0, ready: 0 },
      { name: 'yarim-app', spec: 4, status: 4, ready: 2, image: 'reg/a b\tc;d:1' },
      { name: 'argo-app', spec: 1, labels: { [ARGO]: 'odeme prod;x' } },
      { name: 'helm-app', spec: 2, labels: { [MGD]: 'Helm' } },
      { name: 'ikisi-app', spec: 1, labels: { [ARGO]: 'a1', [MGD]: 'Helm' } },
      { name: 'uzun-app', spec: 1, image: 'reg/' + 'x'.repeat(1700) + ':1' },
      { name: 'buyuk-kayit', spec: 0 },
      { name: 'data-app-eslesen', spec: 0 },
      { name: 'bozuk-prev', spec: 0 },
      { name: 'bos-faz', spec: 0 },
    ],
    sts: [
      { name: 'kafka', spec: 3 },
      { name: 'odeme-api', spec: 1 },
    ],
    dc: [{ name: 'eski-app', spec: 0, rev: 7 }],
    rollout: [{ name: 'canary-app', spec: 5, status: 5, ready: 5 }],
    ds: [
      {
        name: 'log-ajan',
        hamStatus: { desiredNumberScheduled: 6, currentNumberScheduled: 6, numberReady: 5 },
      },
      { name: 'bos-ds' },
    ],
    cronjob: [
      {
        name: 'gece-isi',
        hamSpec: {
          suspend: true,
          schedule: '0 2 * * *',
          jobTemplate: { spec: { template: { spec: { containers: [{ image: 'reg/job:3' }] } } } },
        },
      },
      { name: 'askisiz-is', hamSpec: { schedule: '*/5 * * * *' } },
    ],
  },
  hpa: [
    { name: 'odeme-hpa', target: 'odeme-api' },
    { name: 'kafka-hpa', kind: 'StatefulSet', target: 'kafka' },
  ],
  pdb: ['odeme-pdb', 'kafka-pdb'],
  cm: {
    'scalex-state-sifir-app': {
      app: 'sifir-app',
      kind: 'deploy',
      previous_replicas: '3',
      phase: 'scaled_down',
    },
    // Yeni onek ONCELIKLI: ayni uygulamanin eski kaydi da var.
    'chaos-scale-state-sifir-app': {
      app: 'sifir-app',
      kind: 'deploy',
      previous_replicas: '9',
      phase: 'eski',
    },
    'chaos-scale-state-eski-app': {
      app: 'eski-app',
      kind: 'dc',
      previous_replicas: '2',
      phase: 'scaled_down',
    },
    // Ad eslesmesi yok, `data.app` eslesir.
    'scalex-state-Data-App-X': {
      app: 'data-app-eslesen',
      kind: 'deploy',
      previous_replicas: '5',
      phase: 'scaled_down',
    },
    'scalex-state-bozuk-prev': {
      app: 'bozuk-prev',
      kind: 'deploy',
      previous_replicas: 'abc',
      phase: 'scaled_down',
    },
    'scalex-state-bos-faz': { app: 'bos-faz', kind: 'deploy', previous_replicas: '1' },
    'scalex-state-buyuk-kayit': {
      app: 'BUYUK-KAYIT',
      kind: 'deploy',
      previous_replicas: '4',
      phase: 'scaled down',
    },
    'ilgisiz-cm': { foo: 'bar' },
  },
};

const CRDLER = {
  'kafkas.kafka.strimzi.io': {
    kind: 'Kafka',
    nesneler: [{ name: 'olay-kafka', spec: 3, status: 3, ready: 2 }],
  },
  'conjurfollowers.conjur.cyberark.com': {
    kind: 'ConjurFollower',
    nesneler: [{ name: 'conjur-f', spec: 2 }],
  },
  'prometheuses.metrics.example.com': { kind: 'Prometheus', nesneler: [] },
};

const SENARYOLAR = [
  { ad: 'temel', env: {} },
  { ad: 'filtre', env: { APP_RAW: 'odeme-api, eski-app;log-ajan,yok-app' } },
  { ad: 'rollout-yok', model: { yokTipler: ['rollout'] } },
  { ad: 'sts-yasak', model: { yasakTipler: ['sts'] } },
  { ad: 'hpa-yok', model: { hpa: [], pdb: [], cm: {} } },
  { ad: 'kind-yok', model: { kindYok: true } },
  {
    ad: 'crd',
    model: { crdler: CRDLER, yasakTipler: ['conjurfollowers.conjur.cyberark.com'] },
    env: {
      SCALEX_EXTRA_KINDS:
        'kafkas.kafka.strimzi.io,conjurfollowers.conjur.cyberark.com,prometheuses.metrics.example.com,otel.yok.example.com,statefulsets.apps',
    },
  },
  {
    ad: 'crd-filtre',
    model: { crdler: CRDLER },
    env: {
      APP_RAW: 'olay-kafka,odeme-api',
      SCALEX_EXTRA_KINDS: 'kafkas.kafka.strimzi.io,conjurfollowers.conjur.cyberark.com',
    },
  },
  { ad: 'cok-ns', env: { NS_LIST: 'ns1,ns2' } },
  {
    // `safe_name` 180 karakterde keser: durum kaydinin ADI uzun uygulama adinin
    // ilk 180 karakteri. `data.app` BILEREK farkli (ad eslesmesini kurtarmasin).
    ad: 'uzun-ad',
    model: {
      nesneler: { deploy: [{ name: 'u'.repeat(200), spec: 0 }] },
      cm: {
        ['scalex-state-' + 'u'.repeat(180)]: {
          app: 'baska',
          previous_replicas: '6',
          phase: 'scaled_down',
        },
      },
    },
  },
  {
    // Bos namespace + TEK tip yetkisiz: birlesik cagri SATIRSIZ ve rc=1 doner.
    // v23 bunu `call_failed` ile tekil cagrilara dusuruyordu (bkz. N3 —
    // v24'te bilincli fark).
    ad: 'bos-ns-yasak',
    model: {
      nesneler: { deploy: [], sts: [], dc: [], rollout: [], ds: [], cronjob: [] },
      yasakTipler: ['rollout'],
    },
    bilinenFark: true,
  },
  {
    ad: 'hepsi-yasak',
    model: { yasakTipler: ['deploy', 'sts', 'dc', 'rollout', 'ds', 'cronjob'] },
    bilinenFark: true,
  },
];

// Zaman olcumleri ve ortama bagli degerler dondurulur.
function normalle(l) {
  return l
    .replace(/package_version=\d+/, 'package_version=N')
    .replace(/oc_path=\S+/, 'oc_path=OC')
    .replace(/workdir=\S+/, 'workdir=W')
    .replace(/(_ms)=\d+/g, '$1=T');
}

function kostur(senaryo, { runner = RUNNER, pathEk = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scalex-ks-'));
  const modelYolu = path.join(dir, 'model.json');
  const log = path.join(dir, 'calls.log');
  const model = JSON.parse(JSON.stringify({ ...TEMEL_MODEL, ...(senaryo.model || {}) }));
  fs.writeFileSync(modelYolu, JSON.stringify(model));
  fs.writeFileSync(
    path.join(dir, 'oc'),
    `#!/bin/bash\nexec node ${JSON.stringify(SAHTE_OC)} "$@"\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(dir, 'curl'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  const cikti = execFileSync('bash', [runner], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${pathEk ? pathEk + ':' : ''}${dir}:${process.env.PATH}`,
      SAHTE_OC_MODEL: modelYolu,
      SAHTE_OC_LOG: log,
      SCALEX_PHASE: 'discover',
      DISCOVERY_MODE: 'workloads',
      CLUSTER: 'c1',
      JUMP_SERVER: 'j1',
      API_URL: 'https://api.lab:6443',
      OCP_USERNAME: 'u',
      OCP_PASSWORD: 'x',
      OCP_OC_PATHS: path.join(dir, 'oc'),
      NS: 'ns1',
      APP_RAW: '',
      TLS_VERIFY: 'false',
      JOB_ID: '42',
      ...senaryo.env,
    },
  });
  const satirlar = cikti
    .split('\n')
    .filter((l) => /^[^;]*;[^;]*;[^;]*;[^;]*;[^;]*;[^;]*;.*$/.test(l))
    .map(normalle);
  const cagrilar = fs.existsSync(log)
    ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)
    : [];
  fs.rmSync(dir, { recursive: true, force: true });
  return { satirlar, cagrilar };
}

module.exports = { SENARYOLAR, TEMEL_MODEL, CRDLER, kostur, RUNNER };
