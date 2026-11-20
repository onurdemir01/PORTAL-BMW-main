'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  isLicenseAllowed,
  normalizeLicenseText,
  buildCycloneDxSbom,
  auditAndWriteSbom,
} = require('../../scripts/sbom-uretim.cjs');

test('sbom generator validates SPDX license policy and produces CycloneDX 1.5', (t) => {
  assert.equal(normalizeLicenseText({ type: 'MIT' }), 'MIT');
  assert.equal(normalizeLicenseText([{ type: 'MIT' }, { type: 'ISC' }]), 'MIT OR ISC');
  assert.equal(isLicenseAllowed('MIT', false), true);
  assert.equal(isLicenseAllowed('MPL-2.0', false), false);
  assert.equal(isLicenseAllowed('MPL-2.0', true), true);
  assert.equal(isLicenseAllowed('GPL-3.0-only', true), false);
  // LGPL yalniz gelistirme (eslint-plugin-sonarjs, is #52); calisma zamani paketinde YASAK.
  assert.equal(isLicenseAllowed('LGPL-3.0-only', true), true);
  assert.equal(isLicenseAllowed('LGPL-3.0-only', false), false);
  assert.equal(isLicenseAllowed('LGPL-2.1-only', true), false, 'yalniz LGPL-3.0-only acildi');
  assert.equal(isLicenseAllowed('(MIT OR GPL-3.0)', false), true);
  assert.equal(isLicenseAllowed('(MIT AND GPL-3.0)', true), false);

  const syntheticLock = {
    name: 'demo-app',
    version: '1.2.3',
    packages: {
      '': { name: 'demo-app', version: '1.2.3' },
      'node_modules/express': {
        version: '5.2.1',
        license: 'MIT',
        integrity: 'sha512-YWJj',
      },
      'node_modules/bad-copyleft': {
        version: '1.0.0',
        license: 'GPL-3.0',
        dev: false,
      },
    },
  };

  const built = buildCycloneDxSbom(syntheticLock);
  assert.equal(built.sbom.bomFormat, 'CycloneDX');
  assert.equal(built.sbom.specVersion, '1.5');
  assert.equal(built.componentsCount, 2);
  assert.equal(built.licenseViolations.length, 1);
  assert.equal(built.licenseViolations[0].name, 'bad-copyleft');

  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'sbom-out-'));
  t.after(() => fs.rmSync(tmpOut, { recursive: true, force: true }));

  const reports = auditAndWriteSbom(path.resolve(__dirname, '../..'), tmpOut);
  assert.equal(reports.length, 2);
  for (const r of reports) {
    assert.equal(r.licenseViolations.length, 0);
    assert.ok(r.componentsCount > 50);
    assert.ok(fs.existsSync(r.dest));
  }
});
