// server/logx/v2/__tests__/playbook-readiness.test.cjs — sihirbaza donen hazirlik bilgisi.
//
// GERCEK ARIZA (2026-08-10, uretim): `BMW Portal - LogX_OCP_App_Discovery` (template 2193)
// uzerinde Variables > "Prompt on launch" KAPALIYDI. O kutu kapaliyken AWX, portalin
// gonderdigi extra_vars'i sessizce yok sayar. Portal bunu launch oncesi yakaliyordu ama
// hata 503 dondugu icin ters-proxy govdeyi SPA index.html'i ile degistiriyor, kullanici
// gercek sebebi HIC gormuyordu. Artik sihirbaz bu ucu okuyup doomed job'i HIC acmiyor.
//
// SINIR: sihirbaz ucu altyapi ayrintisi (template adi/ID, AWX sunucu no) SIZDIRMAZ —
// onlar admin ucunda kalir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const readiness = require('../playbook-readiness.cjs');

const ROW = {
  keyName: 'logx_ocp_app_discovery',
  displayName: 'LogX — OCP Uygulama/Obje Keşfi',
  enabled: true,
  templateId: 2193,
  awxServerId: 2,
  foundOnAwx: true,
  templateName: 'BMW Portal - LogX_OCP_App_Discovery',
  promptOnLaunch: true,
};

test('promptOnLaunch=false → ready:false + sebep', () => {
  const [out] = readiness.toPublic([{ ...ROW, promptOnLaunch: false }]);
  assert.deepEqual(out, {
    keyName: 'logx_ocp_app_discovery', ready: false, reason: 'prompt_on_launch_disabled',
  });
});

test('promptOnLaunch=null (AWX okunamadi) → HAZIR sayilir (fail-open)', () => {
  const [out] = readiness.toPublic([{ ...ROW, promptOnLaunch: null, foundOnAwx: null }]);
  assert.equal(out.ready, true, 'metadata eksikligi mesru bir isi DURDURMAMALI');
});

test('template tanimsiz / kayit kapali → ready:false', () => {
  assert.equal(readiness.toPublic([{ ...ROW, templateId: null }])[0].reason, 'template_missing');
  assert.equal(readiness.toPublic([{ ...ROW, enabled: false }])[0].reason, 'disabled');
});

test('sihirbaz yaniti altyapi ayrintisi SIZDIRMAZ', () => {
  const [out] = readiness.toPublic([ROW]);
  assert.deepEqual(Object.keys(out).sort(), ['keyName', 'ready', 'reason']);
  const serialized = JSON.stringify(out);
  for (const secret of ['2193', 'BMW Portal', 'awxServerId']) {
    assert.ok(!serialized.includes(secret), `sihirbaz yanitinda ${secret} olmamali`);
  }
});

test('LogX bagimliligi olan bes playbook da kapsanir', () => {
  assert.deepEqual(readiness.LOGX_KEYS, [
    'logx_legacy_discovery', 'logx_legacy_transfer',
    'logx_ocp_namespace_discovery', 'logx_ocp_app_discovery', 'logx_ocp_discover_fetch',
  ]);
});
