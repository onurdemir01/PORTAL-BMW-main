// server/opsx/__tests__/dump-result.test.cjs — extractOpsxDumpResult(): AWX artifacts'ten
// dump playbook'unun set_stats ile yayınladığı opsx_dump_result'ı okur. LogX'in
// extractLogxResultFromArtifacts'iyle AYNI şekil-toleransı (top-level / data / ansible_stats.data).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractOpsxDumpResult, extractOpsxJvmResult } = require('../index.cjs');

const SAMPLE = {
  overall_status: 'ok',
  results: [{ host: 'GBJBOQ01', ok: true, staged_path: '/x/y.hprof', filename: 'y.hprof', size_bytes: 123 }],
};

test('artifacts.opsx_dump_result (top-level) doğrudan okunur', () => {
  const out = extractOpsxDumpResult({ opsx_dump_result: SAMPLE });
  assert.deepEqual(out, SAMPLE);
});

test('artifacts.data.opsx_dump_result (yaygın AWX set_stats şekli) okunur', () => {
  const out = extractOpsxDumpResult({ data: { opsx_dump_result: SAMPLE } });
  assert.deepEqual(out, SAMPLE);
});

test('artifacts.ansible_stats.data.opsx_dump_result (bazı controller sürümleri) okunur', () => {
  const out = extractOpsxDumpResult({ ansible_stats: { data: { opsx_dump_result: SAMPLE } } });
  assert.deepEqual(out, SAMPLE);
});

test('hiçbir bilinen şekilde yoksa null döner (sessizce yanlış davranmaz)', () => {
  assert.equal(extractOpsxDumpResult({}), null);
  assert.equal(extractOpsxDumpResult(null), null);
  assert.equal(extractOpsxDumpResult({ some_other_key: 1 }), null);
});

test('opsx_dump_result nesne değilse (ör. string/number) yok sayılır', () => {
  assert.equal(extractOpsxDumpResult({ opsx_dump_result: 'not-an-object' }), null);
});

// extractOpsxJvmResult — opsx_legacy_jvm_discover.yml'in set_stats çıktısı, AYNI
// extractStatsKey() toleransını kullanır (bkz. yukarısı) — tek fark anahtar adı.
const JVM_SAMPLE = {
  overall_status: 'ok',
  results: [{ host: 'GBJBOQ01', pid: '1234', cmd: 'java -jar app.jar' }],
};

test('artifacts.opsx_jvm_result (top-level) doğrudan okunur', () => {
  const out = extractOpsxJvmResult({ opsx_jvm_result: JVM_SAMPLE });
  assert.deepEqual(out, JVM_SAMPLE);
});

test('artifacts.data.opsx_jvm_result okunur', () => {
  const out = extractOpsxJvmResult({ data: { opsx_jvm_result: JVM_SAMPLE } });
  assert.deepEqual(out, JVM_SAMPLE);
});

test('opsx_jvm_result hiçbir bilinen şekilde yoksa null döner', () => {
  assert.equal(extractOpsxJvmResult({}), null);
  assert.equal(extractOpsxJvmResult(null), null);
});
