// server/splunk/client.cjs — Splunk REST API baglantisi (basitlestirilmis, kesif-mantiksiz)
//
// Splunk'ta hangi alanin "urun/host" oldugu KESFEDILMEZ — admin SPLUNK_PRODUCT_FIELD ile
// bunu env'de tanimlar (or. "product", "sourcetype", "host"). Sabit tek bir SPL sablonu
// kullanilir. TLS/proxy icin server/mcp/client.cjs'teki CA/NO_PROXY-farkinda dispatcher
// (buildDispatcher) yeniden kullanilir — yeni bir TLS yaklasimi icat edilmiyor.
'use strict';

const net = require('net');
const { buildDispatcher } = require('../mcp/client.cjs');

function getConfig() {
  return {
    baseUrl: (process.env.SPLUNK_BASE_URL || '').trim(),
    token: (process.env.SPLUNK_TOKEN || '').trim(),
    authScheme: process.env.SPLUNK_AUTH_SCHEME || 'Bearer',
    index: process.env.SPLUNK_INDEX || 'main',
    productField: process.env.SPLUNK_PRODUCT_FIELD || 'product',
    products: (process.env.SPLUNK_PRODUCTS || 'httpd,nginx,jboss,websphere,ctg,hazelcast,provenir')
      .split(',').map((s) => s.trim()).filter(Boolean),
  };
}

function isConfigured() {
  const { baseUrl, token } = getConfig();
  return !!(baseUrl && token);
}

function listProducts() {
  return getConfig().products;
}

// Gercek ag erisilebilirligini test eder — dynatrace/client.cjs'teki TCP-probe deseniyle ayni.
function checkReachable(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const { baseUrl } = getConfig();
    let parsed;
    try { parsed = new URL(baseUrl); } catch { return resolve(false); }
    const port = Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80);
    const socket = net.createConnection({ host: parsed.hostname, port, timeout: timeoutMs });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

// /services/search/jobs/export?output_mode=json ciktisi satir-satir JSON'dur — her satir
// ya bir sonuc (`result`) ya da bir ilerleme mesajidir; yalnizca gercek sonuclar toplanir.
function parseExportLines(raw) {
  const results = [];
  for (const line of String(raw || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t);
      if (obj && obj.result) results.push(obj.result);
    } catch { /* JSON olmayan satir atlanir */ }
  }
  return results;
}

async function search({ product, windowMinutes = 15, limit = 50 }) {
  const { baseUrl, token, authScheme, index, productField, products } = getConfig();
  if (!baseUrl || !token) throw new Error('Splunk yapılandırılmamış (SPLUNK_BASE_URL/SPLUNK_TOKEN).');
  if (!product || !products.includes(product)) {
    throw new Error(`Geçersiz ürün: ${product}. İzin verilenler: ${products.join(', ')}`);
  }

  const safeWindow = Math.min(Math.max(Number(windowMinutes) || 15, 1), 60);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const spl = `search index=${index} ${productField}=${product} earliest=-${safeWindow}m latest=now | head ${safeLimit}`;

  const target = new URL('/services/search/jobs/export', baseUrl);
  const dispatcher = buildDispatcher(target.toString(), 'splunk');
  const body = new URLSearchParams({ search: spl, output_mode: 'json' });

  let res;
  try {
    res = await fetch(target, {
      method: 'POST',
      headers: {
        Authorization: `${authScheme} ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      dispatcher,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    console.error('[Splunk] Baglanti hatasi:', {
      url: target.toString(),
      message: err.message,
      code: err.code || null,
      causeMessage: err.cause?.message || null,
      causeCode: err.cause?.code || null,
    });
    throw err;
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Splunk HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const results = parseExportLines(text);
  return {
    eventCount: results.length,
    sample: results.slice(0, 10).map((r) => JSON.stringify(r)),
    query: spl,
  };
}

module.exports = { isConfigured, checkReachable, listProducts, search };
