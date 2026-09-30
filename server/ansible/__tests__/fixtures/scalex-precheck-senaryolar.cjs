// server/ansible/__tests__/fixtures/scalex-precheck-senaryolar.cjs
//
// Precheck ALTIN CIKTI senaryolari. Altin dosya (`scalex-precheck-altin.json`)
// toplu okumaya gecilmeden ONCEKI betikle uretildi; toplu precheck ayni
// senaryolarda BIREBIR ayni satirlari basmak zorunda (J2). Kullaniciya giden
// rapor bu satirlardan kuruluyor — "hizlandi ama satirlar degisti" kabul
// edilemez.
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

const DURUM = (o) => ({
  version: '2',
  namespace: 'ns1',
  cluster: 'c1',
  phase: 'scaled_down',
  created_at: '2026-09-01T08:00:00Z',
  ...o,
});

const TEMEL_MODEL = {
  nesneler: {
    deploy: [
      { name: 'odeme-api', spec: 3 },
      { name: 'sifir-app', spec: 0 },
      { name: 'iki-tip', spec: 1 },
      { name: 'legacy-app', spec: 0 },
      { name: 'faz-app', spec: 0 },
    ],
    sts: [
      { name: 'kafka', spec: 3 },
      { name: 'iki-tip', spec: 1 },
    ],
    dc: [{ name: 'eski-app', spec: 0 }],
    rollout: [],
  },
  hpa: [{ name: 'odeme-hpa', target: 'odeme-api' }],
  cm: {
    'chaos-scale-state-eski-app': DURUM({
      app: 'eski-app',
      kind: 'dc',
      resource: 'dc',
      previous_replicas: '2',
    }),
    'scalex-state-kafka': DURUM({
      app: 'kafka',
      kind: 'sts',
      resource: 'sts',
      previous_replicas: '3',
      namespace: 'baska-ns',
    }),
    'scalex-state-legacy-app': { app: 'legacy-app', previous_replicas: '4' },
    'scalex-state-faz-app': DURUM({
      app: 'faz-app',
      kind: 'deploy',
      resource: 'deploy',
      previous_replicas: '5',
      phase: 'preparing',
    }),
    'alakasiz-cm': { foo: 'bar' },
  },
};

const HARITA =
  'odeme-api=deploy,kafka=sts,eski-app=dc,yok-app=deploy,sifir-app=deploy,legacy-app=deploy,faz-app=deploy';

const SENARYOLAR = {
  'stop-harita': {
    env: {
      ACTION: 'stop',
      WORKLOAD_KINDS: HARITA,
      APP_RAW: 'odeme-api,kafka,eski-app,yok-app,sifir-app',
    },
  },
  'stop-auto-rollout-yok': {
    env: { ACTION: 'stop', APP_RAW: 'odeme-api,kafka,iki-tip,yok-app' },
    model: { yokTipler: ['rollout'] },
  },
  'restore-harita': {
    env: {
      ACTION: 'restore',
      WORKLOAD_KINDS: HARITA,
      APP_RAW: 'eski-app,kafka,odeme-api,legacy-app,faz-app',
    },
  },
  'scale-buyuk': {
    env: { ACTION: 'scale', TARGET: '150', WORKLOAD_KINDS: HARITA, APP_RAW: 'odeme-api,kafka' },
  },
  'stop-sts-patch-yok': {
    env: { ACTION: 'stop', WORKLOAD_KINDS: HARITA, APP_RAW: 'kafka,odeme-api' },
    model: { canIRed: ['patch sts'] },
  },
  'stop-sts-okunamaz': {
    env: { ACTION: 'stop', WORKLOAD_KINDS: HARITA, APP_RAW: 'kafka,odeme-api' },
    model: { yasakTipler: ['sts'] },
  },
  'stop-cm-listesi-yasak': {
    env: { ACTION: 'stop', WORKLOAD_KINDS: HARITA, APP_RAW: 'odeme-api,eski-app,sifir-app' },
    model: { cmListeYasak: true },
  },
  'restore-cm-listesi-yasak': {
    env: { ACTION: 'restore', WORKLOAD_KINDS: HARITA, APP_RAW: 'eski-app,faz-app,odeme-api' },
    model: { cmListeYasak: true },
  },
  'stop-istenen-tip': { env: { ACTION: 'stop', WORKLOAD_KIND: 'sts', APP_RAW: 'kafka,odeme-api' } },
  'restore-auto': { env: { ACTION: 'restore', APP_RAW: 'eski-app,kafka,iki-tip' } },
  // Listelenemeyen ama adiyla okunabilen tip: dizin YETKISIZ, eski yol bulur;
  // OBJECT satiri da tekil okumadan gelmeli.
  'stop-sts-liste-yasak': {
    env: { ACTION: 'stop', WORKLOAD_KINDS: HARITA, APP_RAW: 'kafka,odeme-api' },
    model: { listeYasakTipler: ['sts'] },
  },
  'stop-hpa-listesi-yasak': {
    env: { ACTION: 'stop', WORKLOAD_KINDS: HARITA, APP_RAW: 'odeme-api,kafka' },
    model: { hpaListeYasak: true, hpa: [{ name: 'odeme-api', target: 'odeme-api' }] },
  },
  'stop-kind-yazilmiyor': {
    env: { ACTION: 'stop', WORKLOAD_KINDS: HARITA, APP_RAW: 'odeme-api,kafka,yok-app' },
    model: { kindYok: true },
  },
  // MUTASYON TURUNDA EKLENDI (J-M14): `auto` tespiti dort tipin DORDUNU de
  // yetkili ister. StatefulSet listelenemezken `iki-tip` yalnizca dizindeki
  // Deployment'ta gorunur; o sart gevsetilirse belirsizlik ("ambiguous")
  // SESSIZCE "Deployment bulundu"ya donerdi — yanlis nesneye islem.
  'stop-auto-sts-liste-yasak': {
    env: { ACTION: 'stop', APP_RAW: 'iki-tip,odeme-api' },
    model: { listeYasakTipler: ['sts'] },
  },
  'stop-auto-iki-tip-yok': {
    env: { ACTION: 'stop', APP_RAW: 'odeme-api,kafka,yok-app' },
    model: { yokTipler: ['rollout', 'dc'] },
  },
};

/** Betigi precheck fazinda kosturur; satirlari ve `oc` cagrilarini dondurur. */
function kostur(senaryo, { runner = RUNNER, faz = 'precheck', modelEk = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scalex-pc-'));
  const modelYolu = path.join(dir, 'model.json');
  const log = path.join(dir, 'calls.log');
  const model = JSON.parse(
    JSON.stringify({ ...TEMEL_MODEL, ...(senaryo.model || {}), ...(modelEk || {}) }),
  );
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
      PATH: `${dir}:${process.env.PATH}`,
      SAHTE_OC_MODEL: modelYolu,
      SAHTE_OC_LOG: log,
      SCALEX_PHASE: faz,
      CLUSTER: 'c1',
      JUMP_SERVER: 'j1',
      API_URL: 'https://api.lab:6443',
      OCP_USERNAME: 'u',
      OCP_PASSWORD: 'x',
      OCP_OC_PATHS: path.join(dir, 'oc'),
      NS: 'ns1',
      TLS_VERIFY: 'false',
      JOB_ID: '42',
      CREATED_BY: 'tester',
      VERIFY_WARN_SECONDS: '4',
      VERIFY_FAIL_SECONDS: '8',
      ...senaryo.env,
    },
  });
  const satirlar = cikti
    .split('\n')
    .filter((l) => /^[^;]*;[^;]*;[^;]*;[^;]*;[^;]*;[^;]*;.*$/.test(l))
    .map((l) =>
      l
        .replace(/package_version=\d+/, 'package_version=N')
        .replace(/oc_path=\S+/, 'oc_path=OC')
        .replace(/workdir=\S+/, 'workdir=W'),
    );
  const cagrilar = fs.existsSync(log)
    ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)
    : [];
  const sonModel = JSON.parse(fs.readFileSync(modelYolu, 'utf8'));
  fs.rmSync(dir, { recursive: true, force: true });
  return { satirlar, cagrilar, model: sonModel };
}

module.exports = { SENARYOLAR, TEMEL_MODEL, HARITA, kostur, RUNNER };
