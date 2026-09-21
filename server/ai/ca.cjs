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

// ── ONBELLEK ────────────────────────────────────────────────────────────────
//
// OLCUM (uretim, 13,5 gun): `[CA] TLS guven deposu hazirlandi` 1.514 kez, yani
// ACILIS BASINA ~19. Sebep: dort ayri modul (`ai/provider`, `mcp/client`,
// `smart/client`, `oco/client`) bunu BAGIMSIZ cagiriyor ve MCP her baglanti
// denemesinde yeniden cagiriyor.
//
// Her cagri ~145 kok sertifikayi PEM olarak ayristirip her biri icin
// `X509Certificate` kuruyor ve parmak izi hesapliyor. Yani hem log gurultusu
// hem de bosuna is.
//
// ONBELLEK ANAHTARI dosyanin KENDISINI de kapsar (yol + mtime + boyut):
// sertifika DONUSUNDE (rotation) dosya degisir, anahtar degisir ve depo
// YENIDEN kurulur. Yalnizca yolu anahtar yapmak, donmus bir sertifikayi
// sureç omru boyunca ESKI haliyle kullanmak olurdu — TLS dogrulamasinin
// sessizce bozulmasi demek.
let _caCache = null; // { key, value }

function cacheKey(caPath) {
  if (!caPath) return 'yol-yok';
  try {
    const st = fs.statSync(caPath);
    return `${caPath}|${st.mtimeMs}|${st.size}`;
  } catch {
    // Dosya okunamiyorsa ONBELLEKLEME: asagidaki kod zaten anlamli bir hata
    // firlatacak ve o hata her cagrida GORUNMELI.
    return null;
  }
}

function buildCombinedCa() {
  const configuredPath = process.env.CORP_CA_CERT_PATH;
  const caPath = resolveCaPath(configuredPath);

  // ONBELLEK ISABETI: ayni yol + ayni dosya (mtime/boyut) ise yeniden kurma.
  const anahtar = cacheKey(caPath);
  if (anahtar && _caCache && _caCache.key === anahtar) return _caCache.value;

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

  // LOG YALNIZCA GERCEKTEN KURULDUGUNDA. Onbellek isabetinde buraya hic
  // gelinmez; acilis basina ~19 satir yerine 1 satir kalir.
  console.log('[CA] TLS guven deposu hazirlandi:', {
    caPath,
    publicRoots: rootCount,
    corporatePemBlocks: corporateFileCount,
    addedCorporateCertificates: corporateCount,
    totalCertificates: ca.length,
  });

  const sonuc = {
    ca,
    caPath,
    rootCount,
    corporateCount,
    corporateFileCount,
  };
  // HATA ONBELLEKLENMEZ: yukaridaki `throw`lar buraya hic gelmez, yani bozuk
  // bir yapilandirma her cagrida YENIDEN ve GORUNUR sekilde patlar. Hatayi
  // onbelleklemek, dosya duzeltildikten sonra bile surec omru boyunca
  // basarisiz kalmak demekti.
  if (anahtar) _caCache = { key: anahtar, value: sonuc };
  return sonuc;
}

/** Test icin: onbellegi sifirlar. Uretim yolunda CAGRILMAZ. */
function _resetCaCacheForTest() {
  _caCache = null;
}

module.exports = {
  buildCombinedCa,
  resolveCaPath,
  parsePemCertificates,
  _resetCaCacheForTest,
};
