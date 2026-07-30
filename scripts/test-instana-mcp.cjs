#!/usr/bin/env node
// scripts/test-instana-mcp.cjs — Instana MCP baglanti testi (initialize → tools/list)
//
// Kullanim (kurumsal agda/VPN'de):
//   node scripts/test-instana-mcp.cjs            # nonprod
//   node scripts/test-instana-mcp.cjs prod       # prod
//
// Portalin kendi Instana client'ini (server/instana/client.cjs) kullanir — ortam
// secimi dokumandaki gibi header ile yapilir (instana-api-token + instana-base-url).
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const instana = require('../server/instana/client.cjs');

const env = process.argv[2] === 'prod' ? 'prod' : 'nonprod';

async function main() {
  console.log('── Instana MCP baglanti testi ────────────────────────────');
  console.log('Ortam:            ', env);
  console.log('URL:              ', process.env.INSTANA_MCP_URL || '(fallback: https://instana-mcp.apps-3rd-t.fw.garanti.com.tr/mcp)');
  console.log('Token tanimli:    ', instana.isConfigured(env) ? 'evet' : 'HAYIR — .env.local INSTANA_API_TOKEN/BASE_URL kontrol edin');
  console.log('MCP_TLS_INSECURE: ', process.env.MCP_TLS_INSECURE || '(kapali)');
  console.log('CORP_CA_CERT_PATH:', process.env.CORP_CA_CERT_PATH || '(yok)');
  console.log('');

  console.log('[1/2] initialize (connect)...');
  const t0 = Date.now();
  const ok = await instana.checkConnect(env);
  const status = instana.getStatus(env);

  if (!ok) {
    console.error(`✗ BASARISIZ (${Date.now() - t0}ms)`);
    console.error('  Denenen URL :', status.lastError?.url);
    console.error('  Hata detayi :', status.lastError?.message);
    process.exit(1);
  }
  console.log(`✓ Baglandi (${Date.now() - t0}ms) → ${status.connectedUrl}`);

  console.log('\n[2/2] tools/list...');
  const t1 = Date.now();
  const tools = await instana.listTools(env);
  console.log(`✓ ${tools.length} tool listelendi (${Date.now() - t1}ms):`);
  for (const t of tools) {
    console.log(`  - ${t.name}${t.description ? ` — ${String(t.description).slice(0, 80)}` : ''}`);
  }

  console.log('\n✓ TEST BASARILI — Instana MCP akisi uyumlu.');
  process.exit(0);
}

main().catch((e) => {
  console.error('Beklenmeyen hata:', e.message);
  process.exit(1);
});
