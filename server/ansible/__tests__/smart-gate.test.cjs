// Ortam tespiti ve ortam-bazli Smart onay kapisi. Ikisi de saf fonksiyon.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { detectEnvironment } = require('../request-env.cjs');
const { isSmartRequired, resolveFlowKey } = require('../smart-gate.cjs');
const { isProductionRequest } = require('../../oco/prod-detect.cjs');

test('detectEnvironment: env/ortam anahtarlari, harf duyarsiz', () => {
  assert.strictEqual(detectEnvironment({ env: 'prod' }), 'prod');
  assert.strictEqual(detectEnvironment({ env: 'PRODUCTION' }), 'prod');
  assert.strictEqual(detectEnvironment({ ortam: ' Test ' }), 'test');
  assert.strictEqual(detectEnvironment({ ORTAM: 'QA' }), 'qa');
  assert.strictEqual(detectEnvironment({ Env: 'Development' }), 'dev');
});

test('detectEnvironment: taninmayan deger/alan -> null', () => {
  assert.strictEqual(detectEnvironment({ env: 'preprod' }), null);
  assert.strictEqual(detectEnvironment({ environment: 'prod' }), null);
  assert.strictEqual(detectEnvironment({}), null);
  assert.strictEqual(detectEnvironment(null), null);
});

test('kapali smartApproval hicbir ortamda onay istemez', () => {
  assert.strictEqual(isSmartRequired({ enabled: false, envs: ['prod'] }, { env: 'prod' }), false);
  assert.strictEqual(isSmartRequired(undefined, { env: 'prod' }), false);
});

test('envs BOS ise ESKI davranis: her ortamda onay', () => {
  const sa = { enabled: true, flowKey: 'F' };
  for (const e of ['dev', 'test', 'qa', 'prod']) {
    assert.strictEqual(isSmartRequired(sa, { env: e }), true, e);
  }
  // Ortam hic verilmese bile istenir - eski davranis buydu.
  assert.strictEqual(isSmartRequired(sa, {}), true);
});

test('envs doluysa yalnizca o ortamlarda onay istenir', () => {
  const sa = { enabled: true, flowKey: 'F', envs: ['prod'] };
  assert.strictEqual(isSmartRequired(sa, { env: 'prod' }), true);
  assert.strictEqual(isSmartRequired(sa, { env: 'test' }), false);
  assert.strictEqual(isSmartRequired(sa, { env: 'dev' }), false);
});

test('envs buyuk harfli yazilsa da calisir', () => {
  const sa = { enabled: true, flowKey: 'F', envs: ['PROD', ' Test '] };
  assert.strictEqual(isSmartRequired(sa, { env: 'prod' }), true);
  assert.strictEqual(isSmartRequired(sa, { env: 'test' }), true);
  assert.strictEqual(isSmartRequired(sa, { env: 'qa' }), false);
});

test('ORTAM BELIRLENEMEZSE guvenli taraf: onay ISTENIR', () => {
  const sa = { enabled: true, flowKey: 'F', envs: ['prod'] };
  // env alani hic yok / deger taninmiyor -> gecirmek yerine onay iste.
  assert.strictEqual(isSmartRequired(sa, {}), true);
  assert.strictEqual(isSmartRequired(sa, { env: 'preprod' }), true);
});

test('resolveFlowKey: ortam bazli override, yoksa varsayilana duser', () => {
  const sa = { enabled: true, flowKey: 'VARSAYILAN', flowKeyByEnv: { prod: 'PROD_FLOW' } };
  assert.strictEqual(resolveFlowKey(sa, { env: 'prod' }), 'PROD_FLOW');
  assert.strictEqual(resolveFlowKey(sa, { env: 'test' }), 'VARSAYILAN');
  assert.strictEqual(resolveFlowKey(sa, {}), 'VARSAYILAN');
  assert.strictEqual(resolveFlowKey({ enabled: true }, { env: 'prod' }), '');
});

test('OCO kurali Smart ayarindan BAGIMSIZ kaldi (yalniz production)', () => {
  assert.strictEqual(isProductionRequest({ env: 'prod' }), true);
  assert.strictEqual(isProductionRequest({ ortam: 'production' }), true);
  assert.strictEqual(isProductionRequest({ env: 'qa' }), false);
});
