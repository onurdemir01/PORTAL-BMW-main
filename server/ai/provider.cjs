// server/ai/provider.cjs — Ortak AI saglayici cekirdegi
//
// Portaldaki TUM AI ozellikleri (LogX log analizi, AI Analist MCP sohbeti) bu
// katmani kullanir: tek saglayici secimi (AI_PROVIDER), tek model config'i,
// tek TLS/proxy agent'i ve ozellik-bazli birlesik rate limit.
// Katmanlama: logx/ai-analyzer.cjs ve ai-analyst/* buradan import eder —
// onceki ters bagimlilik (ai-analyst → logx) boylece giderildi.
'use strict';

const https = require('https');

// ── Provider config ───────────────────────────────────────────────────────────

function getProvider() {
  const p = (process.env.AI_PROVIDER || '').toLowerCase().trim();
  if (p === 'openai') return 'openai';
  return 'anthropic'; // default
}

function isConfigured() {
  const p = getProvider();
  if (p === 'openai') return !!process.env.OPENAI_API_KEY;
  return !!process.env.ANTHROPIC_API_KEY;
}

function activeModel() {
  const p = getProvider();
  if (p === 'openai') return process.env.OPENAI_MODEL || 'gpt-4o-mini';
  return process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
}

// Saglayiciya gore dogru kimlik-dogrulama header'larini doner. Eskiden ai-analyst/
// orchestrator.cjs VE server/logx/ai-analyzer.cjs, API anahtarlarini (process.env.
// ANTHROPIC_API_KEY/OPENAI_API_KEY) getProvider() ile ayni dallanmayi TEKRARLAYARAK
// dogrudan okuyup kendi header nesnelerini kuruyordu — anahtar yonetimi burada (tek
// dogruluk kaynagi) ama gercek kullanim iki ayri yerde ikiye bolunmustu (kurumsal AI
// kod incelemesi, review.md #22). Artik her iki cagiran da bu fonksiyonu kullanir.
function getApiHeaders() {
  return getProvider() === 'openai'
    ? { authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
    : { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' };
}

// ── TLS agent (kurumsal SSL inspection / Blue Coat destegi) ──────────────────
// Public kokler + kurumsal zincirler BIRLESIMI ile dogrulama ACIK tutulur.
// Eski davranistaki iki hata duzeltildi:
//  1) `ca` verildiginde varsayilan kokler eziliyordu → OpenAI (Blue Coat zinciri)
//     dogrulanamiyordu (UNABLE_TO_GET_ISSUER_CERT_LOCALLY).
//  2) CA okunamayinca rejectUnauthorized:false'a dusuluyordu → artik DUSULMEZ;
//     yuksek sesle uyarilir ve sadece public koklerle (guvenli) devam edilir.
const { buildCombinedCa } = require('./ca.cjs');

function buildHttpsAgent() {
  const {
    ca,
    rootCount,
    corporateCount,
    corporateFileCount,
    caPath,
  } = buildCombinedCa();

  console.log('[AI] TLS guven deposu:', {
    caPath,
    publicRoots: rootCount,
    corporatePemBlocks: corporateFileCount,
    addedCorporateCertificates: corporateCount,
    rejectUnauthorized: true,
  });

  return new https.Agent({
    ca,
    rejectUnauthorized: true,
    keepAlive: true,
    maxSockets: 20,
    timeout: 30_000,
  });
}
const _tlsAgent = buildHttpsAgent();

// ── Raw HTTPS helper ──────────────────────────────────────────────────────────

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const raw = JSON.stringify(body);
    const req = https.request(
      {
        hostname,
        port: 443,
        servername: hostname,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(raw),
          ...headers,
        },
        timeout: 30_000,
        agent: _tlsAgent,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              const msg = parsed.error?.message || parsed.error?.code || data.slice(0, 200);
              reject(Object.assign(new Error(`AI API ${res.statusCode}: ${msg}`), { status: res.statusCode }));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`AI API yanıtı JSON değil: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    // Teshis: TLS/ag hatalarinda gercek sebep (code + cause zinciri) gorunur olsun —
    // "unable to get local issuer certificate" gibi hatalar hedef host ile loglanir
    req.on('error', (error) => {
      console.error('[AI] HTTPS baglanti hatasi:', {
        hostname, path,
        message: error.message,
        code: error.code || null,
        cause: error.cause?.message || null,
      });
      reject(error);
    });
    req.on('timeout', () => {
      req.destroy(new Error('AI API isteği zaman aşımına uğradı.'));
    });
    req.write(raw);
    req.end();
  });
}

// ── Ozellik-bazli birlesik rate limit ─────────────────────────────────────────
// Tek Map, "feature:username" anahtarli — ozellikler bagimsiz kotalara sahiptir.

const FEATURE_LIMITS = {
  logs: { max: 10, windowMs: 60 * 60_000 }, // LogX log analizi
  chat: { max: 20, windowMs: 60 * 60_000 }, // AI Analist MCP sohbeti
};

const _rateMap = new Map();

// true → limit ASILDI (istek reddedilmeli); false → sayac guncellendi, devam
function checkRateLimit(username, feature) {
  const cfg = FEATURE_LIMITS[feature] || FEATURE_LIMITS.chat;
  const key = `${feature}:${username}`;
  const now = Date.now();
  const prev = (_rateMap.get(key) || []).filter((t) => now - t < cfg.windowMs);
  if (prev.length >= cfg.max) return true;
  _rateMap.set(key, [...prev, now]);
  return false;
}

// Sinirsiz buyume onlemi: kullanici sayisi arttikca ve yeni feature:username anahtarlari
// eklendikce _rateMap hicbir zaman kucuk kalmiyordu — pencere disina dusen zaman damgalari
// yalniz checkRateLimit AYNI anahtar icin TEKRAR cagrildiginda filtreleniyordu; kullanici bir
// daha o ozelligi kullanmazsa anahtar (bos bir dizi bile olsa) sonsuza dek Map'te kaliyordu.
// Periyodik supurme (bkz. server/auth/index.cjs _onlineUsers ile ayni desen) tum pencereleri
// bosalmis anahtarlari duzenli olarak temizler.
const RATE_SWEEP_INTERVAL_MS = 60_000;
const MAX_WINDOW_MS = Math.max(...Object.values(FEATURE_LIMITS).map((c) => c.windowMs));

function sweepRateMap() {
  const now = Date.now();
  for (const [key, timestamps] of _rateMap) {
    if (!timestamps.some((t) => now - t < MAX_WINDOW_MS)) _rateMap.delete(key);
  }
}

setInterval(sweepRateMap, RATE_SWEEP_INTERVAL_MS).unref();

function getFeatureLimits() {
  return Object.fromEntries(
    Object.entries(FEATURE_LIMITS).map(([k, v]) => [k, { maxPerHour: v.max }])
  );
}

module.exports = {
  getProvider, isConfigured, activeModel, getApiHeaders,
  buildHttpsAgent, httpsPost,
  checkRateLimit, getFeatureLimits,
  // test-only: gercek 60s'i beklemeden supurmeyi tetikler + Map'e dogrudan erisim
  _sweepRateMap: sweepRateMap, _rateMap,
};
