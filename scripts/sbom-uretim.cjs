#!/usr/bin/env node
// scripts/sbom-uretim.cjs - CycloneDX 1.5 SBOM ureticisi ve SPDX lisans uyum kapisi.
// Runtime (package-lock.json) ve tam agac (gelistirme/package-lock.json) kilitlerinden
// Sifir dis bagimlilikla SBOM uretir ve yasakli/eksik lisanslarda exit 1 doner.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');

const RUNTIME_ALLOWED_LICENSES = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'ISC',
  'MIT',
  'Unlicense',
]);

const DEV_ALLOWED_LICENSES = new Set([
  ...RUNTIME_ALLOWED_LICENSES,
  'BlueOak-1.0.0',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'MPL-2.0',
  'Python-2.0',
  'WTFPL',
  'Zlib',
]);

function normalizeLicenseText(raw) {
  if (!raw) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'object' && !Array.isArray(raw) && raw.type) {
    return String(raw.type).trim();
  }
  if (Array.isArray(raw)) {
    return raw
      .map((item) =>
        typeof item === 'object' && item && item.type ? item.type : String(item || ''),
      )
      .filter(Boolean)
      .join(' OR ');
  }
  return String(raw).trim();
}

function isLicenseAllowed(licenseExpr, isDevOnly) {
  const expr = normalizeLicenseText(licenseExpr);
  if (!expr) return false;
  const allowSet = isDevOnly ? DEV_ALLOWED_LICENSES : RUNTIME_ALLOWED_LICENSES;
  if (allowSet.has(expr)) return true;

  // Compound SPDX OR expressions: allowed if at least one branch is allowlisted.
  const stripped = expr.replace(/^\((.*)\)$/, '$1').trim();
  if (/\bOR\b/.test(stripped)) {
    const parts = spdxBol(stripped, 'OR');
    return parts.some((p) => allowSet.has(p));
  }
  // Compound SPDX AND expressions: allowed only if every branch is allowlisted.
  if (/\bAND\b/.test(stripped)) {
    const parts = spdxBol(stripped, 'AND');
    return parts.length > 0 && parts.every((p) => allowSet.has(p));
  }
  return false;
}

const BOSLUK = /\s/;

/**
 * SPDX ifadesini `op` (OR / AND) sozcugunde boler; parcalar kirpilir. `split(/\s+OR\s+/)` ile
 * birebir ayni sonuc, tek gecis (o desen geri izlemede karesel, Sonar S8786): bosluk dizisinin
 * hemen ardindan `op` ve yine bosluk gelirse bolunur, bosluklar ayraca dahildir.
 */
function spdxBol(ifade, op) {
  const out = [];
  let bas = 0;
  let i = 0;
  while (i < ifade.length) {
    if (!BOSLUK.test(ifade[i])) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < ifade.length && BOSLUK.test(ifade[j])) j += 1;
    const sonra = j + op.length;
    if (ifade.startsWith(op, j) && sonra < ifade.length && BOSLUK.test(ifade[sonra])) {
      let k = sonra;
      while (k < ifade.length && BOSLUK.test(ifade[k])) k += 1;
      out.push(ifade.slice(bas, i));
      bas = k;
      i = k;
    } else i = j;
  }
  out.push(ifade.slice(bas));
  return out.map((p) => p.trim());
}

function packageNameFromLockKey(lockKey) {
  const idx = lockKey.lastIndexOf('node_modules/');
  return idx >= 0 ? lockKey.slice(idx + 'node_modules/'.length) : lockKey;
}

function buildCycloneDxSbom(lockData, options = {}) {
  const pkgMap = (lockData && lockData.packages) || {};
  const components = [];
  const licenseViolations = [];
  const licenseCounts = {};

  for (const [lockKey, meta] of Object.entries(pkgMap)) {
    if (!lockKey || !meta || typeof meta !== 'object') continue;
    const name = packageNameFromLockKey(lockKey);
    const version = String(meta.version || '0.0.0');
    const isDevOnly = Boolean(meta.dev || meta.devOptional);
    const license = normalizeLicenseText(meta.license);
    const licKey = license || '<MISSING>';
    licenseCounts[licKey] = (licenseCounts[licKey] || 0) + 1;

    if (!isLicenseAllowed(license, isDevOnly)) {
      licenseViolations.push({
        name,
        version,
        scope: isDevOnly ? 'dev' : 'runtime',
        license: licKey,
      });
    }

    const purl = `pkg:npm/${name.startsWith('@') ? name.replace('/', '%2F') : name}@${version}`;
    const component = {
      type: 'library',
      name,
      version,
      scope: isDevOnly ? 'optional' : 'required',
      purl,
      'bom-ref': purl,
    };
    if (license) {
      component.licenses = [{ license: { id: license } }];
    }
    if (meta.integrity) {
      const [alg, digest] = String(meta.integrity).split('-', 2);
      if (alg && digest) {
        component.hashes = [{ alg: alg.toUpperCase().replace('SHA', 'SHA-'), content: digest }];
      }
    }
    components.push(component);
  }

  components.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

  const rootPkg = pkgMap[''] || {};
  const sbom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: options.timestamp || new Date().toISOString(),
      component: {
        type: 'application',
        name: options.appName || rootPkg.name || lockData.name || 'bmw-portal',
        version: options.appVersion || rootPkg.version || lockData.version || '1.0.0',
      },
    },
    components,
  };

  return { sbom, componentsCount: components.length, licenseCounts, licenseViolations };
}

function auditAndWriteSbom(rootDir = ROOT, outDir = path.join(ROOT, 'coverage')) {
  fs.mkdirSync(outDir, { recursive: true });
  const targets = [
    { lockPath: path.join(rootDir, 'package-lock.json'), outFile: 'sbom-runtime.cdx.json' },
    {
      lockPath: path.join(rootDir, 'gelistirme', 'package-lock.json'),
      outFile: 'sbom-full.cdx.json',
    },
  ];

  const reports = [];
  for (const t of targets) {
    const lockData = JSON.parse(fs.readFileSync(t.lockPath, 'utf8'));
    const res = buildCycloneDxSbom(lockData);
    const dest = path.join(outDir, t.outFile);
    fs.writeFileSync(dest, JSON.stringify(res.sbom, null, 2) + '\n', 'utf8');
    reports.push({ target: t.outFile, dest, ...res });
  }
  return reports;
}

function main() {
  const reports = auditAndWriteSbom();
  const allViolations = [];
  for (const r of reports) {
    console.log(
      `[sbom] ${r.target}: ${r.componentsCount} bilesen yazildi (${Object.keys(r.licenseCounts).length} benzersiz lisans) -> ${path.relative(ROOT, r.dest)}`,
    );
    for (const v of r.licenseViolations) {
      allViolations.push(`${r.target}: ${v.name}@${v.version} (${v.scope}) -> ${v.license}`);
    }
  }
  if (allViolations.length > 0) {
    console.error(
      `[sbom] LISANS KAPISI BASARISIZ (${allViolations.length} ihlal):\n  ${allViolations.join('\n  ')}`,
    );
    process.exit(1);
  }
  console.log('[sbom] OK - Tum runtime ve gelistirme bagimliliklari lisans politikasina uygun.');
}

module.exports = {
  RUNTIME_ALLOWED_LICENSES,
  DEV_ALLOWED_LICENSES,
  normalizeLicenseText,
  isLicenseAllowed,
  spdxBol,
  buildCycloneDxSbom,
  auditAndWriteSbom,
};

if (require.main === module) {
  main();
}
