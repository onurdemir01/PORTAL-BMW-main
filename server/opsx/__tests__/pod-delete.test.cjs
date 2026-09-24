// server/opsx/__tests__/pod-delete.test.cjs — "Calisan podlarimi silmek (restart etmek)
// istiyorum" (2026-09-18): OCP_OPERATIONS'ta poddelete acik, AYRI template anahtari
// (opsx_openshift_pod_delete), sonuc set_stats anahtari opsx_pod_delete_result,
// playbook bmw_portal agacinda kayitli. /api/opsx/run bu islemi KABUL ETMEZ (sadece restart).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { OCP_OPERATIONS, extractOpsxPodDeleteResult } = require('../index.cjs');
const { PLAYBOOKS } = require('../../ansible/paths.cjs');

test('OCP_OPERATIONS: poddelete acik ve etiketi kullanicinin istedigi metin', () => {
  const op = OCP_OPERATIONS.find((o) => o.key === 'poddelete');
  assert.ok(op, 'poddelete listede olmali');
  assert.equal(op.enabled, true);
  assert.match(op.label, /podlarımı silmek/);
  assert.match(op.label, /restart etmek/);
});

test('playbook bmw_portal/opsx_openshift_pod_delete altinda ve PLAYBOOKS ile kayitli', () => {
  assert.equal(PLAYBOOKS.opsxOpenshiftPodDelete, 'opsx_openshift_pod_delete/opsx_openshift_pod_delete.yaml');
  const abs = path.join(__dirname, '..', '..', 'ansible', 'bmw_portal', PLAYBOOKS.opsxOpenshiftPodDelete);
  assert.ok(fs.existsSync(abs), `playbook dosyasi yok: ${abs}`);
  const text = fs.readFileSync(abs, 'utf8');
  // Sozlesme: onay olmadan calismaz, sonuc opsx_pod_delete_result ile doner, --force ile siler
  assert.match(text, /pod_delete_consent/);
  assert.match(text, /opsx_pod_delete_result/);
  assert.match(text, /oc delete pod/);
  // 2026-09-24 (kullanici: "bazen takili kaliyor"): --force TEK BASINA yok sayilir
  // ("--force is ignored because --grace-period is not 0") ve komut zarif kapanmayi bekler.
  // Ikisi birlikte + zaman asimi olmali.
  assert.match(text, /--force --grace-period=0/);
  assert.match(text, /--timeout=/);
  // Teams webhook URL'si depoda ASLA sabit yazilmaz — opsiyonel degisken
  assert.match(text, /opsx_teams_webhook_url/);
  assert.doesNotMatch(text, /webhook\.office\.com|sig=/);
});

test('extractOpsxPodDeleteResult: top-level / data / ansible_stats.data sekilleri okunur', () => {
  const SAMPLE = {
    overall_status: 'partial',
    results: [
      { cluster: 'ocp-a', namespace: 'ns1', pod: 'app-1', existence: 'Exist', ok: true },
      { cluster: 'ocp-a', namespace: 'ns1', pod: 'app-2', existence: 'Not Exist', ok: false, error: 'bulunamadi' },
    ],
  };
  assert.deepEqual(extractOpsxPodDeleteResult({ opsx_pod_delete_result: SAMPLE }), SAMPLE);
  assert.deepEqual(extractOpsxPodDeleteResult({ data: { opsx_pod_delete_result: SAMPLE } }), SAMPLE);
  assert.deepEqual(extractOpsxPodDeleteResult({ ansible_stats: { data: { opsx_pod_delete_result: SAMPLE } } }), SAMPLE);
  assert.equal(extractOpsxPodDeleteResult({}), null);
  assert.equal(extractOpsxPodDeleteResult({ opsx_dump_result: SAMPLE }), null);
});

test('registry seed: opsx_openshift_pod_delete kaydi env_var ile tanimli', () => {
  const setup = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
  assert.match(setup, /key_name: 'opsx_openshift_pod_delete'/);
  assert.match(setup, /OPSX_OPENSHIFT_POD_DELETE_TEMPLATE_ID/);
});

test('/api/opsx/run kaynak kodu poddelete\'i restart-disi olarak reddeder (defence in depth)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  assert.match(src, /ocOp\.key !== 'restart'/);
  // poddelete kendi ucundan gider ve consent zorunlu
  assert.match(src, /\/api\/opsx\/poddelete\/openshift/);
  assert.match(src, /consent !== true/);
});
