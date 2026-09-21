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

/**
 * MCP arac sonucu tavani. Uzak sunucu portalin denetiminde DEGIL.
 * Bu deger `ai-analyst` tarafindaki `TOOL_RESULT_MAX` kirpmasindan ONCE
 * uygulanir — o kirpma parse`tan sonra calistigi icin bellegi kurtarmiyordu.
 */
const MCP_RESULT_MAX_BYTES = 4 * 1024 * 1024;

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

  // ── GERI CEKILME (backoff) ────────────────────────────────────────────────
  //
  // OLCUM (uretim, 13,5 gun): `[MCP:dynatrace] Baglanti hatasi` 845 kez —
  // gunde ~62, 13,5 gunun HER gununde. Hata hep ayni:
  // `Unauthorized: no valid Dynatrace token supplied [401]`. Yani entegrasyon
  // HIC calismadi ve portal bunu 845 kez yeniden denedi.
  //
  // Her deneme yalnizca log satiri degil: TLS guven deposu kurulumu (PR #121'e
  // kadar her cagride ~145 sertifika), proxy/agent kurulumu ve bir ag turu.
  //
  // GERI CEKILME SORUNU GIZLEMEZ, GORUNUR KILAR: 845 ayni satir yerine ilk
  // birkaci tam, sonrasinda yalnizca KADEME DEGISIMINDE bir satir ve her
  // satirda "kacinci ardisik hata, ne zamandir" bilgisi. `getStatus()` da
  // durumu tasir; saglik uclari "entegrasyon N saattir basarisiz" diyebilir.
  //
  // TAVAN 5 DAKIKA: admin token'i duzelttiginde en gec 5 dakika icinde
  // toparlanir. Sinirsiz buyuyen bir bekleme, duzeltmeyi saatlerce gorunmez
  // kilardi.
  const BACKOFF_BASE_MS = 5_000;
  const BACKOFF_MAX_MS = 5 * 60_000;
  const TAM_LOG_ESIGI = 3; // ilk 3 hata tam yazilir
  let _ardArda = 0;        // ardisik basarisiz deneme sayisi
  let _sonrakiDeneme = 0;  // bu ana kadar yeni deneme YAPILMAZ
  let _ilkHataAt = null;   // kesintisiz basarisizligin baslangici
  let _sonKademe = 0;      // en son loglanan bekleme suresi

  function setError(err, attemptedUrl) {
    const detail = describeError(err);
    _lastError = { message: detail, at: new Date().toISOString(), url: attemptedUrl };
    // LOG KADEMELI: ilk birkac hata tam yazilir; sonrasinda yalnizca bekleme
    // suresi DEGISTIGINDE. Ayni satiri 845 kez yazmak, gercek hatalari
    // gurultuye gomuyordu (uretimde ERROR hacminin %35'i bu tek entegrasyondu).
    if (_ardArda < TAM_LOG_ESIGI) {
      console.error(`[MCP:${name}] Baglanti hatasi (${attemptedUrl}):`, detail);
    }
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

    // GERI CEKILME PENCERESI: bu ana kadar yeni deneme YAPILMAZ. Son hata
    // aynen firlatilir — cagiran acisindan davranis DEGISMEZ, yalnizca ag
    // turu ve log satiri harcanmaz.
    if (_sonrakiDeneme && Date.now() < _sonrakiDeneme) {
      const kalan = Math.ceil((_sonrakiDeneme - Date.now()) / 1000);
      throw Object.assign(
        new Error(
          `MCP bağlantısı geri çekilmede (${name}): ${_ardArda} ardışık hata, ` +
            `${kalan} sn sonra yeniden denenecek. Son hata: ${_lastError?.message || 'bilinmiyor'}`,
        ),
        { mcpBackoff: true, consecutiveFailures: _ardArda, retryInSeconds: kalan },
      );
    }

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
          // BASARIDA GERI CEKILME SIFIRLANIR. Ayrica kesintinin ne kadar
          // surdugu YAZILIR — "ne zaman duzeldi" sorusu loglardan cevaplanabilsin.
          if (_ardArda > 0) {
            const sure = _ilkHataAt ? Math.round((Date.now() - _ilkHataAt) / 60000) : 0;
            console.log(
              `[MCP:${name}] Baglandi: ${variant} — ${_ardArda} ardisik hatadan sonra ` +
                `(kesinti ~${sure} dk).`,
            );
          } else {
            console.log(`[MCP:${name}] Baglandi: ${variant}`);
          }
          _ardArda = 0;
          _sonrakiDeneme = 0;
          _ilkHataAt = null;
          _sonKademe = 0;
          return _client;
        } catch (err) {
          lastErr = err;
          setError(err, variant);
        }
      }
      // BASARISIZ: geri cekilmeyi buyut.
      if (!_ilkHataAt) _ilkHataAt = Date.now();
      _ardArda++;
      const bekle = Math.min(BACKOFF_BASE_MS * 2 ** (_ardArda - 1), BACKOFF_MAX_MS);
      _sonrakiDeneme = Date.now() + bekle;
      // KADEME DEGISTIGINDE bir ozet. Boylece "hala basarisiz" bilgisi kaybolmaz
      // ama ayni satir 845 kez yazilmaz.
      if (bekle !== _sonKademe) {
        _sonKademe = bekle;
        const sure = Math.round((Date.now() - _ilkHataAt) / 60000);
        console.error(
          `[MCP:${name}] ${_ardArda} ardisik baglanti hatasi (~${sure} dk). ` +
            `Yeniden deneme ${Math.round(bekle / 1000)} sn sonra. Son hata: ${_lastError?.message || 'bilinmiyor'}`,
        );
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
    // SIRA ONEMLI: ONCE SINIRLA, SONRA PARSE ET.
    //
    // `JSON.parse` metnin 3-6 kati buyuklukte bir nesne grafigi uretir. Cagiran
    // taraf (`ai-analyst/orchestrator.cjs`) sonucu `truncate(8000)` ile kirpiyor
    // ama o kirpma PARSE'TAN SONRA calisiyor: 100 MB'lik bir arac yaniti once
    // TAM OLARAK parse edilip nesne grafigine donusuyor, sonra kirpiliyor.
    // Kirpma belleği HIC kurtarmiyor — zarar o noktada zaten olusmus oluyor.
    //
    // Uzak MCP sunucusu (Dynatrace/Instana/Splunk) portalin denetiminde DEGIL.
    if (Buffer.byteLength(textContent, 'utf8') > MCP_RESULT_MAX_BYTES) {
      // ATMIYORUZ, KIRPIYORUZ: arac yaniti genelde teshis icin okunuyor ve bas
      // kismi cogu zaman yeterli. Ama kirpildigi ACIKCA soyleniyor.
      return {
        text: textContent.slice(0, MCP_RESULT_MAX_BYTES),
        truncated: true,
        originalBytes: Buffer.byteLength(textContent, 'utf8'),
      };
    }
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
      // GERI CEKILME DURUMU saglik uclarina tasinir: "entegrasyon N saattir
      // basarisiz" demek, "su an bir hata aldim" demekten cok daha kullanisli.
      consecutiveFailures: _ardArda,
      failingSince: _ilkHataAt ? new Date(_ilkHataAt).toISOString() : null,
      retryAfter: _sonrakiDeneme ? new Date(_sonrakiDeneme).toISOString() : null,
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
