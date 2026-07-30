// server/instana/client.cjs — Instana MCP client, two env instances (nonprod + prod)
// Ortak MCP factory (server/mcp/client.cjs) uzerinden: baglanti yonetimi, yeniden
// baglanma, timeout, proxy/TLS destegi ve lastError takibi oradan gelir.
'use strict';

const { createMcpClient } = require('../mcp/client.cjs');

// Dogru adres (Instana MCP Confluence dokumani): https + route hostname, port YOK.
// 8080 container-internal port — OpenShift route 443'ten servis veriyor;
// eski http://...:8080/mcp adresi disaridan erisilemezdi.
const INSTANA_MCP_URL = process.env.INSTANA_MCP_URL
  || 'https://instana-mcp.apps-3rd-t.fw.garanti.com.tr/mcp';

function getEnvConfig(env) {
  if (env === 'prod') {
    return {
      token:   process.env.INSTANA_API_TOKEN_PROD  || '',
      baseUrl: process.env.INSTANA_BASE_URL_PROD   || '',
    };
  }
  return {
    token:   process.env.INSTANA_API_TOKEN_NONPROD || '',
    baseUrl: process.env.INSTANA_BASE_URL_NONPROD  || '',
  };
}

function isConfigured(env = 'nonprod') {
  const { token, baseUrl } = getEnvConfig(env);
  return !!(token && baseUrl);
}

// Env basina ayri MCP instance'i (header'lar farkli) — lazy olusturulur ki
// env degiskenleri boot sonrasi set edilse bile ilk kullanimda okunsun
const _instances = { nonprod: null, prod: null };

function getInstance(env = 'nonprod') {
  const key = env === 'prod' ? 'prod' : 'nonprod';
  if (!_instances[key]) {
    const { token, baseUrl } = getEnvConfig(key);
    _instances[key] = createMcpClient({
      name: `instana-${key}`,
      url: INSTANA_MCP_URL,
      headers: {
        'instana-api-token': token,
        'instana-base-url':  baseUrl,
      },
    });
  }
  return _instances[key];
}

async function callTool(name, args = {}, env = 'nonprod') {
  return getInstance(env).callTool(name, args);
}

async function listTools(env = 'nonprod') {
  return getInstance(env).listTools();
}

async function listToolsFull(env = 'nonprod') {
  return getInstance(env).listToolsFull();
}

async function getServerInstructions(env = 'nonprod') {
  return getInstance(env).getServerInstructions();
}

function getStatus(env = 'nonprod') {
  return getInstance(env).getStatus();
}

async function checkConnect(env = 'nonprod') {
  return getInstance(env).checkConnect();
}

module.exports = { isConfigured, callTool, listTools, listToolsFull, getServerInstructions, getStatus, checkConnect };
