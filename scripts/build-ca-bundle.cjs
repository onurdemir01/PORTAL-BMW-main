#!/usr/bin/env node
// scripts/build-ca-bundle.cjs — Birlesik CA bundle uretici (cross-platform).
//
// NE YAPAR:
//  1) Node'a gomulu TAM global kok seti (tls.rootCertificates) — dunyadaki kamu
//     kok CA'larinin tamami (~145-155 adet; Mozilla guven deposu kaynaklidir.
//     Not: "300+ kok" diye bir evren yok — global kok sayisi gercekte bu kadardir;
//     geri kalan her sertifika bu koklerin ALTINDAKI intermediate'lerdir).
//  2) server/certs/**/*-ca-chain.pem kurumsal zincirleri (MCP route CA'lari,
//     Blue Coat SSL inspection zinciri vb. — fetch-ca.{sh,ps1} ciktilari)
//  → tekrarlari (SHA-256 fingerprint) ayiklayip tek dosyada birlestirir:
//     server/certs/combined-ca-chain.pem
//
// KULLANIM:
//   node scripts/build-ca-bundle.cjs
//   node scripts/build-ca-bundle.cjs --no-roots     # yalniz kurumsal zincirler
//
// Sonrasi: .env.local → CORP_CA_CERT_PATH=server/certs/combined-ca-chain.pem
// Dogrulama: node scripts/test-tls.cjs   · Tam rehber: docs/TLS-SETUP.md
'use strict';

const fs = require('fs');
const path = require('path');
const tls = require('tls');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const CERTS_DIR = path.join(ROOT, 'server', 'certs');
const OUT = path.join(CERTS_DIR, 'combined-ca-chain.pem');
const includeRoots = !process.argv.includes('--no-roots');

function splitPems(text) {
  return [...String(text).matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)]
    .map((m) => m[0]);
}

function fingerprint(pem) {
  const body = pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
  return crypto.createHash('sha256').update(Buffer.from(body, 'base64')).digest('hex');
}

// Kurumsal zincir dosyalarini bul (*-ca-chain.pem, combined haric)
function findCorporateChains() {
  const found = [];
  if (!fs.existsSync(CERTS_DIR)) return found;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/-ca-chain\.pem$/i.test(entry.name) && full !== OUT) found.push(full);
    }
  };
  walk(CERTS_DIR);
  return found;
}

const seen = new Set();
const out = [];
let rootCount = 0, corpCount = 0, dupCount = 0;

if (includeRoots) {
  for (const pem of tls.rootCertificates) {
    const fp = fingerprint(pem);
    if (seen.has(fp)) { dupCount++; continue; }
    seen.add(fp);
    out.push(pem.trim());
    rootCount++;
  }
}

const chainFiles = findCorporateChains();
for (const file of chainFiles) {
  const rel = path.relative(ROOT, file);
  const pems = splitPems(fs.readFileSync(file, 'utf8'));
  let added = 0;
  for (const pem of pems) {
    const fp = fingerprint(pem);
    if (seen.has(fp)) { dupCount++; continue; }
    seen.add(fp);
    out.push(`# kaynak: ${rel}\n${pem.trim()}`);
    added++;
    corpCount++;
  }
  console.log(`  + ${rel}: ${pems.length} sertifika (${added} yeni)`);
}

fs.mkdirSync(CERTS_DIR, { recursive: true });
fs.writeFileSync(OUT, out.join('\n') + '\n', 'utf8');

console.log('');
console.log('── Ozet ─────────────────────────────────────────');
console.log(`  Global public kok : ${rootCount}  (Node tls.rootCertificates — dunyadaki tam set)`);
console.log(`  Kurumsal sertifika: ${corpCount}  (${chainFiles.length} zincir dosyasindan)`);
console.log(`  Tekrar ayiklanan  : ${dupCount}`);
console.log(`  TOPLAM            : ${out.length}`);
console.log(`  Cikti             : ${path.relative(ROOT, OUT)}`);
console.log('');
console.log('Sonraki adimlar:');
console.log('  .env.local → CORP_CA_CERT_PATH=server/certs/combined-ca-chain.pem');
console.log('  Dogrulama  → node scripts/test-tls.cjs');
if (chainFiles.length === 0) {
  console.log('');
  console.log('⚠ Hic kurumsal zincir bulunamadi — once fetch-ca.{sh,ps1} ile zincirleri cekin:');
  console.log('  bash scripts/fetch-ca.sh api.openai.com          (Linux/macOS)');
  console.log('  powershell -File scripts\\fetch-ca.ps1 -TargetHost api.openai.com   (Windows)');
}
