// server/dynatrace/client.cjs — Dynatrace MANAGED MCP baglantisi
// Ortak MCP factory (server/mcp/client.cjs) uzerinden: path varyanti (/mcp),
// timeout, proxy/TLS destegi ve lastError takibi oradan gelir.
//
// ONEMLI: Kurumdaki sunucu dynatrace-managed-mcp'dir (SaaS dynatrace-mcp DEGIL) —
// tum tool adlari `dynatrace_managed_` oneklidir ve `environment_alias` her tool'da
// ZORUNLUDUR (get_environments_info haric). Gecerli alias'lar sunucu config'inden
// gelir; `ALL_ENVIRONMENTS` tum ortamlari tek istekte sorgular.
// Referans: https://github.com/dynatrace-oss/dynatrace-managed-mcp
'use strict';

const net = require('net');
const { createMcpClient } = require('../mcp/client.cjs');

// Dogrulanmis calisan adres (curl initialize testi, 2026-07-10): https + /mcp path.
const DT_MANAGED_MCP_URL = process.env.DT_MANAGED_MCP_URL || 'https://dynatrace-mcp.apps-3rd-t.fw.garanti.com.tr/mcp';

const mcp = createMcpClient({ name: 'dynatrace', url: DT_MANAGED_MCP_URL });

// environment_alias gerektirmeyen tek tool
const NO_ALIAS_TOOLS = new Set(['dynatrace_managed_get_environments_info']);

// ── Environment alias kesfi + varsayilan ─────────────────────────────────────
let _envCache = null;      // { aliases: string[], raw: string }
let _envCacheAt = 0;
const ENV_TTL = 10 * 60 * 1000;

async function getEnvironments(refresh = false) {
  if (!refresh && _envCache && Date.now() - _envCacheAt < ENV_TTL) return _envCache;
  const result = await mcp.callTool('dynatrace_managed_get_environments_info', {});
  const raw = typeof result === 'string' ? result : (result.text || JSON.stringify(result));
  // Formatli metinden alias'lari cek: "- Environment Alias: <alias>" satirlari
  const aliases = [...raw.matchAll(/Environment Alias:\s*(\S+)/gi)].map((m) => m[1]);
  _envCache = { aliases, raw };
  _envCacheAt = Date.now();
  return _envCache;
}

async function getDefaultAlias() {
  const fromEnv = (process.env.DT_DEFAULT_ENV_ALIAS || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const { aliases } = await getEnvironments();
    if (aliases.length > 0) return aliases[0];
  } catch { /* kesif basarisizsa jokere dus */ }
  return 'ALL_ENVIRONMENTS';
}

function isConfigured() {
  return true; // URL always available; real check happens on first connect
}

// Gercek ag erisilebilirligini test eder — hafif TCP el sikismasi, kisa timeout.
function checkReachable(timeoutMs = 3000) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(DT_MANAGED_MCP_URL); } catch { return resolve(false); }
    const port = Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80);
    const socket = net.createConnection({ host: parsed.hostname, port, timeout: timeoutMs });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

// callTool: environment_alias zorunlu — verilmemisse varsayilan alias otomatik eklenir
async function callTool(name, args = {}, envAlias) {
  const finalArgs = { ...args };
  if (!NO_ALIAS_TOOLS.has(name)) {
    finalArgs.environment_alias = envAlias || finalArgs.environment_alias || (await getDefaultAlias());
  }
  return mcp.callTool(name, finalArgs);
}

module.exports = {
  isConfigured,
  checkReachable,
  callTool,
  getEnvironments,
  getDefaultAlias,
  disconnect: mcp.disconnect,
  listTools: mcp.listTools,
  listToolsFull: mcp.listToolsFull,
  getServerInstructions: mcp.getServerInstructions,
  getStatus: mcp.getStatus,
  checkConnect: mcp.checkConnect,
};
