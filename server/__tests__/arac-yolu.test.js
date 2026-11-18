// server/__tests__/arac-yolu.test.js — dis araclar PATH'te ARANMAZ, sabit dizinden mutlak yolla
// (scripts/arac-yolu.cjs; kurumsal Sonar taklidi K15, kural S4036). Ayrica S8786 icin dogrusal
// yazilan iki ayristiricinin (repo-hijyeni uzantiliYollar, sbom spdxBol) uc durumlari: beklenenler
// eski desenle (`[\w.@-]+(?:\/[\w.@-]+)*\.[A-Za-z0-9]{1,8}\b`, `split(/\s+OR\s+/)`) uretildi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { aracYolu, dizinler, kabukIcin } = require('../../scripts/arac-yolu.cjs');

test('AY1 dizinler: node dizini once, sonra sistemin yonettigi sabit dizinler; PATH okunmaz', () => {
  const env = { PATH: '/tmp/kotu:./node_modules/.bin' };
  const linux = dizinler({ platform: 'linux', env, node: '/opt/node/bin/node' });
  assert.deepEqual(linux, [
    '/opt/node/bin',
    '/usr/bin',
    '/bin',
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ]);
  assert.ok(!linux.some((d) => d.includes('kotu') || d.includes('node_modules')), 'PATH okundu');
  const win = dizinler({
    platform: 'win32',
    env: { ...env, ProgramFiles: 'D:\\PF', SystemRoot: 'D:\\Win' },
    node: 'C:\\n\\node.exe',
  });
  assert.equal(win[0], 'C:\\n');
  assert.deepEqual(win.slice(1), [
    'D:\\PF\\Git\\cmd',
    'D:\\PF\\Git\\usr\\bin',
    'D:\\PF\\Docker\\Docker\\resources\\bin',
    'D:\\Win\\System32',
  ]);
});

test('AY2 aracYolu: ilk bulunan sabit dizin; node = process.execPath; yoksa hata ya da null', () => {
  const var_ = (set) => (y) => set.has(y);
  const o = { platform: 'linux', env: {}, node: '/opt/node/bin/node' };
  assert.equal(
    aracYolu('npm', { ...o, var_: var_(new Set(['/opt/node/bin/npm', '/usr/bin/npm'])) }),
    '/opt/node/bin/npm',
  );
  assert.equal(
    aracYolu('git', { ...o, var_: var_(new Set(['/usr/local/bin/git', '/usr/bin/git'])) }),
    '/usr/bin/git',
  );
  assert.equal(aracYolu('node', { ...o, var_: () => false }), '/opt/node/bin/node');
  assert.throws(
    () => aracYolu('gitleaks', { ...o, var_: () => false }),
    /gitleaks guvenli dizinlerde bulunamadi \(\/opt\/node\/bin, \/usr\/bin, /,
  );
  assert.equal(aracYolu('gitleaks', { ...o, zorunlu: false, var_: () => false }), null);
  for (const kotu of ['../git', 'git;rm', '/usr/bin/git', 'Git', '', 'a b'])
    assert.throws(() => aracYolu(kotu, o), /gecersiz arac adi/, kotu);
  // Windows: .exe, sonra .cmd.
  const w = { platform: 'win32', env: { ProgramFiles: 'C:\\PF' }, node: 'C:\\n\\node.exe' };
  assert.equal(
    aracYolu('npm', { ...w, var_: var_(new Set(['C:\\n\\npm.cmd'])) }),
    'C:\\n\\npm.cmd',
  );
  assert.equal(
    aracYolu('git', {
      ...w,
      var_: var_(new Set(['C:\\PF\\Git\\cmd\\git.exe', 'C:\\PF\\Git\\cmd\\git.cmd'])),
    }),
    'C:\\PF\\Git\\cmd\\git.exe',
  );
  // Gercek makine: git ve npm sabit dizinlerde (CI, gelistirici, kurumsal pod).
  assert.ok(path.isAbsolute(aracYolu('git')), 'git bulunamadi');
  assert.ok(path.isAbsolute(aracYolu('npm')), 'npm bulunamadi');
});

test('AY3 kabukIcin: yalniz Windows + bosluklu yol tirnaklanir', () => {
  assert.equal(
    kabukIcin('C:\\Program Files\\nodejs\\npm.cmd', 'win32'),
    '"C:\\Program Files\\nodejs\\npm.cmd"',
  );
  assert.equal(kabukIcin('C:\\n\\npm.cmd', 'win32'), 'C:\\n\\npm.cmd');
  assert.equal(kabukIcin('/opt/my node/bin/npm', 'linux'), '/opt/my node/bin/npm');
});

test('AY4 dogrusal ayristiricilar eski desenle ayni (uc durumlar)', () => {
  const { uzantiliYollar } = require('../../scripts/repo-hijyeni.cjs');
  for (const [girdi, beklenen] of [
    ['foo.cjs.map', ['foo.cjs.map']],
    ['a//b.js', ['b.js']],
    ['/usr/bin.x', ['usr/bin.x']],
    ['a.js-foo', ['a.js']],
    ['file.abcdefghij', []],
    ['a.js_x', []],
    ['@scope/pkg.json', ['@scope/pkg.json']],
    ['a.b/c', ['a.b']],
    ['x.cjs-y.md docs/A.md', ['x.cjs-y.md', 'docs/A.md']],
    [
      'scripts/teslim.cjs: ve `deploy/jenkins/DVL.groovy`',
      ['scripts/teslim.cjs', 'deploy/jenkins/DVL.groovy'],
    ],
  ])
    assert.deepEqual(uzantiliYollar(girdi), beklenen, girdi);
  const { spdxBol } = require('../../scripts/sbom-uretim.cjs');
  assert.deepEqual(spdxBol('MIT OR Apache-2.0', 'OR'), ['MIT', 'Apache-2.0']);
  assert.deepEqual(spdxBol('A OR OR B', 'OR'), ['A', 'OR B']);
  assert.deepEqual(spdxBol('A  AND\tB AND  C', 'AND'), ['A', 'B', 'C']);
  assert.deepEqual(spdxBol('MIT', 'OR'), ['MIT']);
  // Kotu girdi dogrusal: 200 bin bosluk + sozcuk aninda biter.
  const t0 = Date.now();
  spdxBol(`A${' '.repeat(200000)}x`, 'OR');
  uzantiliYollar(`${'a.'.repeat(100000)}`);
  assert.ok(Date.now() - t0 < 2000, 'ayristirici yavas');
});
