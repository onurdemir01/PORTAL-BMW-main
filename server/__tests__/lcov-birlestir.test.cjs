// server/__tests__/lcov-birlestir.test.cjs
// Tests for scripts/lcov-birlestir.cjs (TASK-002 LCOV path normalization & merge).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  normalizeSfPath,
  mergeLcovTexts,
  mergeLcovFiles,
} = require('../../scripts/lcov-birlestir.cjs');

test('LC1 normalizeSfPath depo kokune gore goreli POSIX yola cevirir', () => {
  const root = '/workspace/bmw-portal';
  assert.equal(normalizeSfPath('/workspace/bmw-portal/server/log.cjs', root), 'server/log.cjs');
  assert.equal(normalizeSfPath('./src/utils/url.ts', root), 'src/utils/url.ts');
  assert.equal(normalizeSfPath('server\\util\\a.cjs', root), 'server/util/a.cjs');
});

test('LC2 mergeLcovTexts ayni dosyaya ait iki LCOV raporunu toplar ve ozetleri yeniden hesaplar', () => {
  const root = '/repo';
  const a = [
    'TN:',
    'SF:/repo/shared/ornek.cjs',
    'FN:1,f1',
    'FNDA:2,f1',
    'BRDA:3,0,0,1',
    'BRDA:3,0,1,-',
    'DA:1,2',
    'DA:2,0',
    'LF:2',
    'LH:1',
    'end_of_record',
  ].join('\n');

  const b = [
    'TN:',
    'SF:shared/ornek.cjs',
    'FN:1,f1',
    'FNDA:3,f1',
    'BRDA:3,0,0,0',
    'BRDA:3,0,1,4',
    'DA:1,1',
    'DA:2,5',
    'LF:2',
    'LH:2',
    'end_of_record',
  ].join('\n');

  const out = mergeLcovTexts([a, b], root);
  assert.match(out, /^TN:\nSF:shared\/ornek\.cjs/m);
  assert.match(out, /^FNDA:5,f1$/m);
  assert.match(out, /^BRDA:3,0,0,1$/m);
  assert.match(out, /^BRDA:3,0,1,4$/m);
  assert.match(out, /^BRF:2$/m);
  assert.match(out, /^BRH:2$/m);
  assert.match(out, /^DA:1,3$/m);
  assert.match(out, /^DA:2,5$/m);
  assert.match(out, /^LF:2$/m);
  assert.match(out, /^LH:2$/m);
});

test('LC3 mergeLcovFiles eksik girdi dosyasini atlar, mevcutlari diske yazar', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lcov-test-'));
  try {
    const in1 = path.join(tmp, 'a.info');
    const out = path.join(tmp, 'coverage', 'lcov.info');
    fs.writeFileSync(in1, 'SF:server/a.cjs\nDA:10,1\nend_of_record\n', 'utf8');

    const res = mergeLcovFiles([in1, path.join(tmp, 'yok.info')], out, tmp);
    assert.equal(res.inputCount, 1);
    assert.ok(fs.existsSync(out));
    const content = fs.readFileSync(out, 'utf8');
    assert.match(content, /SF:server\/a\.cjs/);
    assert.match(content, /LH:1/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
