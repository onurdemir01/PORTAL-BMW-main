#!/usr/bin/env node
// scripts/test-tls.cjs — CA bundle ile hedef host'lara TLS dogrulama testi.
//
// KULLANIM:
//   node scripts/test-tls.cjs                                   # varsayilan hedefler
//   node scripts/test-tls.cjs --host api.openai.com             # tek hedef
//   node scripts/test-tls.cjs --ca server/certs/combined-ca-chain.pem
//
// Her hedef icin: authorized / issuer / gecerlilik VEYA hata kodu basar.
// CORP_CA_CERT_PATH .env.local'dan okunur; --ca ile ezilebilir.
// Tam rehber: docs/TLS-SETUP.md
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

const tlsMod = require('tls');
const { buildCombinedCa } = require('../server/ai/ca.cjs');

// Argumanlar
const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const caOverride = getArg('--ca');
if (caOverride) process.env.CORP_CA_CERT_PATH = caOverride;

const singleHost = getArg('--host');
const DEFAULT_TARGETS = [
  'api.openai.com',
  'api.anthropic.com',
  (process.env.DT_MANAGED_MCP_URL && new URL(process.env.DT_MANAGED_MCP_URL).hostname) || 'dynatrace-mcp.apps-3rd-t.fw.garanti.com.tr',
  (process.env.INSTANA_MCP_URL && new URL(process.env.INSTANA_MCP_URL).hostname) || 'instana-mcp.apps-3rd-t.fw.garanti.com.tr',
];
const targets = singleHost ? [singleHost] : DEFAULT_TARGETS;

const { ca, rootCount, corporateCount } = buildCombinedCa();
console.log('── TLS dogrulama testi ───────────────────────────────');
console.log(`Guven deposu: ${rootCount} public kok + ${corporateCount} kurumsal zincir`);
console.log(`CORP_CA_CERT_PATH: ${process.env.CORP_CA_CERT_PATH || '(yok — sadece public kokler)'}`);
console.log('');

function testHost(host, port = 443) {
  return new Promise((resolve) => {
    const socket = tlsMod.connect({
      host, port,
      servername: host,
      ca,
      rejectUnauthorized: false, // el sikismayi bitir, authorized bayragindan oku
      timeout: 8000,
    }, () => {
      const cert = socket.getPeerCertificate();
      const result = {
        host,
        ok: socket.authorized,
        error: socket.authorizationError || null,
        issuer: cert?.issuer ? Object.entries(cert.issuer).map(([k, v]) => `${k}=${v}`).join(', ') : null,
        validTo: cert?.valid_to || null,
      };
      socket.destroy();
      resolve(result);
    });
    socket.on('timeout', () => { socket.destroy(); resolve({ host, ok: false, error: 'TIMEOUT' }); });
    socket.on('error', (e) => resolve({ host, ok: false, error: e.code || e.message }));
  });
}

(async () => {
  let failures = 0;
  for (const host of targets) {
    const r = await testHost(host);
    if (r.ok) {
      console.log(`✓ ${r.host}`);
      console.log(`    issuer : ${r.issuer}`);
      console.log(`    validTo: ${r.validTo}`);
    } else {
      failures++;
      console.log(`✗ ${r.host} — ${r.error}`);
      if (r.issuer) console.log(`    sunulan issuer: ${r.issuer}`);
      if (/UNABLE_TO_GET_ISSUER|SELF_SIGNED/.test(String(r.error))) {
        console.log('    → Zincir eksik: fetch-ca ile bu hostun zincirini cekip build-ca-bundle calistirin.');
      } else if (/ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|TIMEOUT/.test(String(r.error))) {
        console.log('    → Ag/DNS erisimi yok (VPN/kurumsal ag gerekebilir) — sertifika sorunu DEGIL.');
      }
    }
    console.log('');
  }
  console.log(failures === 0 ? '✓ TUM HEDEFLER DOGRULANDI' : `⚠ ${failures}/${targets.length} hedef basarisiz`);
  process.exit(failures === 0 ? 0 : 1);
})();
