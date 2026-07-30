#!/usr/bin/env node
// scripts/test-dt-mcp.cjs — Dynatrace Managed MCP baglanti testi (initialize → tools/list)
//
// Kullanim (kurumsal agda/VPN'de):
//   node scripts/test-dt-mcp.cjs
//   DT_MANAGED_MCP_URL=https://... node scripts/test-dt-mcp.cjs   (farkli adres denemek icin)
//
// Portalin kendi MCP factory'sini (server/mcp/client.cjs) kullanir — yani bu test
// gecerse portal icindeki baglanti da gecer; hata verirse lastError'da gercek sebep
// (TLS/DNS/HTTP kodu) gorunur.
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { createMcpClient } = require('../server/mcp/client.cjs');

const url = process.env.DT_MANAGED_MCP_URL || 'https://dynatrace-mcp.apps-3rd-t.fw.garanti.com.tr/mcp';

async function main() {
  let undiciOk = true;
  try { require('undici'); } catch { undiciOk = false; }

  console.log('── Dynatrace MCP baglanti testi ──────────────────────────');
  console.log('URL:              ', url);
  console.log('MCP_TLS_INSECURE: ', process.env.MCP_TLS_INSECURE || '(kapali — TLS dogrulamasi ACIK)');
  console.log('CORP_CA_CERT_PATH:', process.env.CORP_CA_CERT_PATH || '(yok)');
  console.log('HTTPS_PROXY:      ', process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '(yok)');
  console.log('undici paketi:    ', undiciOk ? 'kurulu' : 'KURULU DEGIL → npm install calistirin!');
  console.log('');

  if (process.env.MCP_TLS_INSECURE !== '1' && !process.env.CORP_CA_CERT_PATH) {
    console.warn('⚠ Ne MCP_TLS_INSECURE=1 ne de CORP_CA_CERT_PATH tanimli — kurumsal (self-signed');
    console.warn('  kok CA imzali) sertifikalarda baglanti SELF_SIGNED_CERT_IN_CHAIN ile duser.');
    console.warn('  Not: .env.local git\'e dahil DEGIL — bu ayarlari bu makinedeki .env.local\'a ekleyin.\n');
  }

  const mcp = createMcpClient({ name: 'dt-test', url });

  console.log('[1/2] initialize (connect)...');
  const t0 = Date.now();
  const ok = await mcp.checkConnect();
  const status = mcp.getStatus();

  if (!ok) {
    console.error(`✗ BASARISIZ (${Date.now() - t0}ms)`);
    console.error('  Denenen URL :', status.lastError?.url);
    console.error('  Hata detayi :', status.lastError?.message);
    console.error('\nIpuclari:');
    console.error('  - SELF_SIGNED_CERT_IN_CHAIN / UNABLE_TO_VERIFY → bu makinenin .env.local dosyasina');
    console.error('    MCP_TLS_INSECURE=1 ekleyin (gecici) veya bash scripts/fetch-mcp-ca.sh ile zinciri');
    console.error('    cikarip CORP_CA_CERT_PATH ayarlayin (kalici). .env.local git ile gelmez!');
    console.error('  - undici "KURULU DEGIL" gorunuyorsa → once npm install');
    console.error('  - ENOTFOUND/ECONNREFUSED/ETIMEDOUT → ag/VPN erisimi veya yanlis adres');
    console.error('  - 406/404 → Accept header/path (SDK surumu: package.json @modelcontextprotocol/sdk)');
    process.exit(1);
  }
  console.log(`✓ Baglandi (${Date.now() - t0}ms) → ${status.connectedUrl}`);

  console.log('\n[2/4] tools/list...');
  const t1 = Date.now();
  const tools = await mcp.listTools();
  console.log(`✓ ${tools.length} tool listelendi (${Date.now() - t1}ms):`);
  for (const t of tools) {
    console.log(`  - ${t.name}${t.description ? ` — ${String(t.description).slice(0, 80)}` : ''}`);
  }

  // Managed sunucu dogrulamasi: tool adlari dynatrace_managed_* olmali
  const managed = tools.filter((t) => t.name.startsWith('dynatrace_managed_'));
  if (managed.length === 0) {
    console.warn('\n⚠ Bu sunucu dynatrace_managed_* tool\'lari sunmuyor — portal route\'lari Managed varsayar!');
  }

  console.log('\n[3/4] get_environments_info (alias kesfi)...');
  try {
    const envResult = await mcp.callTool('dynatrace_managed_get_environments_info', {});
    const raw = typeof envResult === 'string' ? envResult : (envResult.text || JSON.stringify(envResult));
    const aliases = [...raw.matchAll(/Environment Alias:\s*(\S+)/gi)].map((m) => m[1]);
    console.log(`✓ Alias'lar: ${aliases.join(', ') || '(parse edilemedi — ham cikti asagida)'}`);
    if (aliases.length === 0) console.log(raw.slice(0, 600));

    console.log('\n[4/4] list_problems (ilk alias ile, uctan uca)...');
    const alias = process.env.DT_DEFAULT_ENV_ALIAS || aliases[0] || 'ALL_ENVIRONMENTS';
    const probs = await mcp.callTool('dynatrace_managed_list_problems', {
      status: 'OPEN', from: 'now-24h', to: 'now', environment_alias: alias,
    });
    const ptext = typeof probs === 'string' ? probs : (probs.text || JSON.stringify(probs));
    console.log(`✓ list_problems yaniti (${alias}, ilk 800 karakter):\n${ptext.slice(0, 800)}`);
  } catch (e) {
    console.error('✗ Managed tool cagrisi basarisiz:', e.message);
    process.exit(1);
  }

  await mcp.disconnect();
  console.log('\n✓ TEST BASARILI — sunucu ve istemci akisi uctan uca uyumlu.');
  process.exit(0);
}

main().catch((e) => {
  console.error('Beklenmeyen hata:', e.message);
  process.exit(1);
});
