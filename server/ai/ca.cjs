// server/ai/ca.cjs
'use strict';

const fs = require('fs');
const path = require('path');
const tls = require('tls');
const crypto = require('crypto');

const PEM_PATTERN =
  /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

function resolveCaPath(configuredPath) {
  if (!configuredPath) {
    return null;
  }

  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(__dirname, '../..', configuredPath);
}

function normalizePemContent(content) {
  return String(content || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function parsePemCertificates(content) {
  const normalized = normalizePemContent(content);
  const matches = normalized.match(PEM_PATTERN) || [];

  return matches.map((certificate) => `${certificate.trim()}\n`);
}

function getFingerprint(pem) {
  try {
    return new crypto.X509Certificate(pem).fingerprint256;
  } catch {
    return null;
  }
}

function buildCombinedCa() {
  const configuredPath = process.env.CORP_CA_CERT_PATH;
  const caPath = resolveCaPath(configuredPath);

  const uniqueCertificates = new Map();

  // Node.js public root CA sertifikalari
  for (const pem of tls.rootCertificates) {
    const fingerprint = getFingerprint(pem);

    if (fingerprint) {
      uniqueCertificates.set(fingerprint, pem);
    }
  }

  const rootCount = uniqueCertificates.size;
  let corporateFileCount = 0;

  if (caPath) {
    if (!fs.existsSync(caPath)) {
      throw new Error(`CORP_CA_CERT_PATH bulunamadı: ${caPath}`);
    }

    const content = fs.readFileSync(caPath, 'utf8');
    const corporateCertificates = parsePemCertificates(content);

    if (corporateCertificates.length === 0) {
      throw new Error(
        `CA dosyasında geçerli PEM sertifikası bulunamadı: ${caPath}`
      );
    }

    corporateFileCount = corporateCertificates.length;

    for (const pem of corporateCertificates) {
      const fingerprint = getFingerprint(pem);

      if (!fingerprint) {
        console.warn('[CA] Gecersiz sertifika blogu atlandi.');
        continue;
      }

      if (!uniqueCertificates.has(fingerprint)) {
        uniqueCertificates.set(fingerprint, pem);
      }
    }
  }

  const ca = Array.from(uniqueCertificates.values());
  const corporateCount = ca.length - rootCount;

  console.log('[CA] TLS guven deposu hazirlandi:', {
    caPath,
    publicRoots: rootCount,
    corporatePemBlocks: corporateFileCount,
    addedCorporateCertificates: corporateCount,
    totalCertificates: ca.length,
  });

  return {
    ca,
    caPath,
    rootCount,
    corporateCount,
    corporateFileCount,
  };
}

module.exports = {
  buildCombinedCa,
  resolveCaPath,
  parsePemCertificates,
};
