// server/opsx/__tests__/downloads.test.cjs — OpsX dump indirme resolver'i: logx/v2/downloads.cjs
// ile AYNI desen (staging kökünde filename ile ara, path traversal reddi) ama tek bir
// staging kökü (OPSX_DUMP_STAGING_DIR) ile. Gerçek tmp FS kullanır.
'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const downloads = require('../downloads.cjs');

let tmpRoot, stagingDir;
const savedEnv = {};

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opsx-dl-'));
  stagingDir = path.join(tmpRoot, 'staging');
  fs.mkdirSync(stagingDir, { recursive: true });
  savedEnv.OPSX_DUMP_STAGING_DIR = process.env.OPSX_DUMP_STAGING_DIR;
  process.env.OPSX_DUMP_STAGING_DIR = stagingDir;
});

afterEach(() => {
  if (savedEnv.OPSX_DUMP_STAGING_DIR === undefined) delete process.env.OPSX_DUMP_STAGING_DIR;
  else process.env.OPSX_DUMP_STAGING_DIR = savedEnv.OPSX_DUMP_STAGING_DIR;
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* yoksay */ }
});

test('stagingRoot(): OPSX_DUMP_STAGING_DIR ayarlanmışsa onu döner', () => {
  assert.equal(downloads.stagingRoot(), path.resolve(stagingDir));
});

test('staged_path yanlış/erişilemez olsa da dosya, staging kökünde filename ile bulunur', () => {
  const filename = `${crypto.randomBytes(8).toString('hex')}.hprof`;
  fs.writeFileSync(path.join(stagingDir, filename), 'heap-bytes');
  const bogus = '/some/source-host/local/path/' + filename;
  const resolved = downloads.resolveStagedFile({ stagedPath: bogus, filename });
  assert.equal(resolved, path.join(stagingDir, filename));
});

test('staged_path doğrudan mevcutsa (staging kökü altında) o kullanılır', () => {
  const filename = `${crypto.randomBytes(8).toString('hex')}-thread.txt`;
  const direct = path.join(stagingDir, filename);
  fs.writeFileSync(direct, 'thread-dump');
  const resolved = downloads.resolveStagedFile({ stagedPath: direct, filename });
  assert.equal(resolved, path.resolve(direct));
});

test('hiçbir yerde yoksa null (→ route 404 döner)', () => {
  const filename = `${crypto.randomBytes(8).toString('hex')}.hprof`;
  const resolved = downloads.resolveStagedFile({ stagedPath: '/nope/' + filename, filename });
  assert.equal(resolved, null);
});

test('güvenlik: filename içindeki path-traversal basename ile kırpılır, kökten kaçılamaz', () => {
  const outside = path.join(tmpRoot, 'secret.hprof');
  fs.writeFileSync(outside, 'secret');
  const resolved = downloads.resolveStagedFile({ stagedPath: '', filename: '../secret.hprof' });
  assert.equal(resolved, null);
});

test('güvenlik: staged_path staging kökü DIŞINDA var olan gerçek bir dosyaya işaret ederse reddedilir', () => {
  const outsideFile = path.join(tmpRoot, 'not-a-staging-root', 'evil.hprof');
  fs.mkdirSync(path.dirname(outsideFile), { recursive: true });
  fs.writeFileSync(outsideFile, 'hassas-icerik');
  const filename = `${crypto.randomBytes(8).toString('hex')}.hprof`; // hicbir kokte yok
  const resolved = downloads.resolveStagedFile({ stagedPath: outsideFile, filename });
  assert.equal(resolved, null, 'staging kökü dışındaki dosya asla servis edilmemeli');
});

test('isUnderStagingRoot(): staging kökünün kendisi ve altındaki yollar true, dışı false döner', () => {
  assert.equal(downloads.isUnderStagingRoot(stagingDir), true);
  assert.equal(downloads.isUnderStagingRoot(path.join(stagingDir, 'a', 'b.hprof')), true);
  assert.equal(downloads.isUnderStagingRoot(path.join(tmpRoot, 'elsewhere.hprof')), false);
});
