// server/mcp/client.cjs — Ortak MCP client factory (Dynatrace + Instana + gelecekteki sunucular)
//
// Sorumluluklar:
//  - Singleton baglanti + busy-lock (eszamanli ilk cagrilarda tek connect)
//  - onclose → otomatik reset, sonraki cagrida yeniden baglanma
//  - Baglanti hatasi takibi (getStatus().lastError) — health endpoint'leri gercek hatayi raporlayabilsin
//  - Path varyanti: verilen URL ile baglanilamazsa `/mcp` eki denenir (StreamableHTTP MCP
//    sunuculari genelde /mcp path'inde servis verir; or. Instana fallback'i :8080/mcp)
//  - Timeout: MCP_CONNECT_TIMEOUT_MS (varsayilan 10s)
//  - Kurumsal ag: HTTPS_PROXY/HTTP_PROXY tanimliysa undici ProxyAgent; https URL'lerde
//    CORP_CA_CERT_PATH varsa ozel CA, yoksa MCP_TLS_INSECURE=1 ile sertifika dogrulamasi kapatilabilir
'use strict';

const { buildCombinedCa } = require('../ai/ca.cjs');

const CONNECT_TIMEOUT_MS = Number(process.env.MCP_CONNECT_TIMEOUT_MS) || 10_000;

// ── NO_PROXY degerlendirmesi ──────────────────────────────────────────────────
// KRITIK DERS (kurum makinesindeki teshisten): global HTTPS_PROXY tanimliyken MCP
// route'lari da proxy'ye gidiyordu ve kurumsal proxy ic adres CONNECT'ini kesiyordu
// (ECONNRESET). Kurum ici MCP route'lari NO_PROXY ile proxy'den muaf tutulmalidir:
//   NO_PROXY=localhost,127.0.0.1,.fw.garanti.com.tr,...
// Basit kurallar: tam eslesme, ".domain" / "domain" suffix eslesmesi, "*" = hepsi.
function isNoProxyHost(hostname) {
  const raw = process.env.NO_PROXY || process.env.no_proxy || '';
  if (!raw.trim()) return false;
  const host = hostname.toLowerCase();
  for (const entry of raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if (entry === '*') return true;
    const e = entry.startsWith('.') ? entry.slice(1) : entry;
    if (host === e || host.endsWith('.' + e)) return true;
  }
  return false;
}

// ── Fetch dispatcher (proxy + TLS) — hedef URL'e gore kurulur ─────────────────
// Dispatcher artik modul-global degil: her MCP client kendi hedef host'una gore
// proxy kararini (NO_PROXY dahil) verir. TLS guven deposu her durumda
// "public kokler + kurumsal zincirler" birlesimidir (bkz. server/ai/ca.cjs).
function buildDispatcher(targetUrl, name) {
  let target;

  try {
    target = new URL(targetUrl);
  } catch (error) {
    throw new Error(
      `[MCP:${name}] Geçersiz MCP URL: ${targetUrl} — ${error.message}`
    );
  }

  let Agent;
  let ProxyAgent;

  try {
    ({ Agent, ProxyAgent } = require('undici'));
  } catch (error) {
    throw new Error(
      `[MCP:${name}] undici yüklenemedi: ${error.message}`
    );
  }

  const {
    ca,
    caPath,
    rootCount,
    corporateCount,
    corporateFileCount,
  } = buildCombinedCa();

  const tlsOpts = {
    ca,
    rejectUnauthorized: true,
    servername: target.hostname,
  };

  console.log(`[MCP:${name}] TLS guven deposu:`, {
    hostname: target.hostname,
    caPath,
    publicRoots: rootCount,
    corporatePemBlocks: corporateFileCount,
    addedCorporateCertificates: corporateCount,
    totalCertificates: ca.length,
    rejectUnauthorized: true,
  });

  /*
   * Guvensiz TLS modu yalnizca kurumsal CA hic yuklenmemisse,
   * gecici teshis amaciyla kullanilabilir.
   */
  if (
    process.env.MCP_TLS_INSECURE === '1' &&
    corporateFileCount === 0
  ) {
    tlsOpts.rejectUnauthorized = false;

    console.warn(
      `[MCP:${name}] TLS dogrulamasi KAPALI. Bu ayar yalnizca gecici teshis icin kullanilmalidir.`
    );
  } else if (process.env.MCP_TLS_INSECURE === '1') {
    console.warn(
      `[MCP:${name}] Kurumsal CA mevcut; MCP_TLS_INSECURE yok sayildi.`
    );
  }

  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    '';

  if (proxyUrl && !isNoProxyHost(target.hostname)) {
    console.log(
      `[MCP:${name}] Proxy uzerinden baglanilacak: ${proxyUrl} -> ${target.hostname}`
    );

    return new ProxyAgent({
      uri: proxyUrl,

      // Hedef MCP sunucusunun TLS dogrulamasi
      requestTls: tlsOpts,

      /*
       * Proxy HTTP ise proxyTls kullanilmaz.
       * HTTPS proxy kullanilirsa ayrica proxy CA yapilandirmasi gerekebilir.
       */
    });
  }

  if (proxyUrl) {
    console.log(
      `[MCP:${name}] ${target.hostname} NO_PROXY kapsaminda; dogrudan baglanti kullanilacak.`
    );
  }

  return new Agent({
    connect: tlsOpts,
  });
}

// AbortSignal.timeout + opsiyonel dispatcher ile sarilmis fetch — transport'a verilir.
// Dispatcher varken npm-undici'nin kendi fetch'i kullanilir: Node'un yerlesik fetch'i
// (bundled undici) ile npm-undici Agent'i arasinda surum uyumsuzlugu riski var.
// Dispatcher hedef URL'e gore kurulur (NO_PROXY karari host bazli).
function buildFetch(targetUrl, name) {
  const dispatcher = buildDispatcher(targetUrl, name);

  let fetchImpl;

  try {
    fetchImpl = require('undici').fetch;
  } catch (error) {
    throw new Error(
      `[MCP:${name}] undici fetch yüklenemedi: ${error.message}`
    );
  }

  return async (url, init = {}) => {
    const options = {
      ...init,
      dispatcher,
    };

    if (!options.signal) {
      options.signal = AbortSignal.timeout(
        CONNECT_TIMEOUT_MS + 20_000
      );
    }

    try {
      return await fetchImpl(url, options);
    } catch (error) {
      console.error(`[MCP:${name}] Fetch hatasi:`, {
        url: String(url),
        message: error.message,
        code: error.code || null,
        causeMessage: error.cause?.message || null,
        causeCode: error.cause?.code || null,
      });

      throw error;
    }
  };
}

// Node fetch hatalari gercek sebebi `cause` zincirinde gizler ("fetch failed" →
// cause: UNABLE_TO_VERIFY_LEAF_SIGNATURE / ECONNREFUSED / ENOTFOUND ...).
// Teshis icin zinciri duzlestirip tek mesajda topla.
function describeError(err) {
  const parts = [];
  let cur = err;
  let depth = 0;
  while (cur && depth < 5) {
    const code = cur.code ? ` [${cur.code}]` : '';
    const msg = cur.message || String(cur);
    if (!parts.includes(msg + code)) parts.push(msg + code);
    // AggregateError (or. Happy Eyeballs coklu baglanti denemesi) → ilk alt hata
    cur = cur.cause || (Array.isArray(cur.errors) ? cur.errors[0] : null);
    depth++;
  }
  return parts.join(' → ');
}

// ── Factory ───────────────────────────────────────────────────────────────────
// createMcpClient({ name, url, headers }) → { callTool, listTools, disconnect, getStatus }
function createMcpClient({ name, url, headers = {} }) {
  let _client = null;
  let _transport = null;
  let _connecting = null;     // baglanma devam ediyorsa paylasilan in-flight Promise
  let _lastError = null;      // { message, at, url }
  let _connectedUrl = null;   // basarili varyant (orijinal ya da /mcp ekli)

  function setError(err, attemptedUrl) {
    const detail = describeError(err);
    _lastError = { message: detail, at: new Date().toISOString(), url: attemptedUrl };
    console.error(`[MCP:${name}] Baglanti hatasi (${attemptedUrl}):`, detail);
  }

  async function tryConnect(targetUrl) {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');

    const transport = new StreamableHTTPClientTransport(new URL(targetUrl), {
      requestInit: { headers },
      fetch: buildFetch(targetUrl, name),
    });
    const client = new Client({ name: 'bmw-portal', version: '1.0' }, { capabilities: {} });

    // client.connect kendi icinde asili kalabilir — acik timeout ile yaristir
    await Promise.race([
      client.connect(transport),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`MCP connect timeout (${CONNECT_TIMEOUT_MS}ms)`)), CONNECT_TIMEOUT_MS)),
    ]);

    transport.onclose = () => {
      console.warn(`[MCP:${name}] Baglanti kapandi, sonraki istekte yeniden baglanilacak.`);
      _client = null;
      _transport = null;
    };
    return { client, transport };
  }

  // Eszamanli cagirlar busy-wait polling yerine AYNI in-flight promise'i paylasir —
  // event-loop'u 100ms araliklarla mesgul etmeden bekler (kurumsal AI kod incelemesi,
  // review.md #8).
  async function getClient() {
    if (_client) return _client;
    if (_connecting) return _connecting;

    _connecting = (async () => {
      // Varyantlar: baglanilmis URL biliniyorsa once o; yoksa verilen URL, sonra /mcp eki
      const base = url.replace(/\/+$/, '');
      const variants = _connectedUrl
        ? [_connectedUrl]
        : (base.endsWith('/mcp') ? [base] : [base, `${base}/mcp`]);

      let lastErr = null;
      for (const variant of variants) {
        try {
          const { client, transport } = await tryConnect(variant);
          _client = client;
          _transport = transport;
          _connectedUrl = variant;
          _lastError = null;
          console.log(`[MCP:${name}] Baglandi: ${variant}`);
          return _client;
        } catch (err) {
          lastErr = err;
          setError(err, variant);
        }
      }
      throw lastErr || new Error('MCP bağlantısı kurulamadı');
    })().finally(() => { _connecting = null; });

    return _connecting;
  }

  async function callTool(toolName, args = {}) {
    const client = await getClient();
    const result = await client.callTool({ name: toolName, arguments: args });
    const textContent = (result?.content ?? []).find((c) => c.type === 'text')?.text;
    if (!textContent) return result ?? {};
    try { return JSON.parse(textContent); }
    catch { return { text: textContent }; }
  }

  async function listTools() {
    const client = await getClient();
    const { tools } = await client.listTools();
    return tools.map((t) => ({ name: t.name, description: t.description }));
  }

  // AI orkestrasyonu icin: inputSchema dahil tam tool tanimlari
  // (LLM tool-use API'sine dogrudan verilebilir formatta)
  async function listToolsFull() {
    const client = await getClient();
    const { tools } = await client.listTools();
    return tools.map((t) => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
    }));
  }

  // Sunucunun initialize'da LLM'e verdigi kullanim talimatlari (varsa) —
  // AI Analist sistem promptuna enjekte edilir
  async function getServerInstructions() {
    const client = await getClient();
    try { return client.getInstructions() || ''; }
    catch { return ''; }
  }

  async function disconnect() {
    if (_client) {
      await _client.close().catch(() => {});
      _client = null;
      _transport = null;
    }
  }

  function getStatus() {
    return {
      name,
      configuredUrl: url,
      connectedUrl: _connectedUrl,
      connected: !!_client,
      lastError: _lastError,
    };
  }

  // Health check icin: baglanmayi dener, sonucu boolean doner (hata firlatmaz)
  async function checkConnect() {
    try { await getClient(); return true; }
    catch { return false; }
  }

  return { callTool, listTools, listToolsFull, getServerInstructions, disconnect, getStatus, checkConnect };
}

// buildDispatcher disa acik: MCP-disi dis servis client'lari (or. server/splunk/client.cjs)
// ayni CA/NO_PROXY-farkinda undici dispatcher'i yeniden kullanabilsin — yeni bir TLS/proxy
// yaklasimi icat etmek yerine (bkz. docs/TLS-SETUP.md, docs/NETWORK-HARDENING-BACKLOG.md).
module.exports = { createMcpClient, buildDispatcher };
