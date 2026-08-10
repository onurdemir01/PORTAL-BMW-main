// server/smart/client.cjs — Smart/RFF REST istemcisi.
//
// 2026-08-10: SOS02-KL-001-EN "SMART Request Fulfillment (RFF) Services User Guide"
// (Onur'un servis ekibinden aldigi resmi dokuman) okunup DOGRULANDI. createTicket()
// artik TAHMIN degil — path, govde sekli, basari kriteri (resultCode) ve Basic Auth +
// RFF-Request-Token header'i dokumandaki "Request Flow Opening Service - REST" ve
// "Authentication"/"Integration Key" bolumleriyle BIREBIR eslesiyor.
//
// checkTicketStatus() ise HALA DOGRULANMADI: dokumanda talep durumu sorgulayan hicbir
// REST endpoint'i YOK. Referans kod tabanindaki (kardes ekip) durum sorgusu Smart'in
// kendisinden degil, ayri bir sistemden ("Servicerepository") geliyordu — bu dokumanin
// kapsami disinda. SMART_CHECK_TICKET_PATH bos oldugu surece bu fonksiyon ACIKCA hata
// firlatir (bkz. asagisi) — Onur o ayri sistemin dokumanini getirene kadar boyle kalmali.
'use strict';

const { getConfig, isConfigured } = require('./config.cjs');
// TLS icin server/ai/ca.cjs'teki (public kokler + kurumsal zincirler) birlesik CA
// yeniden kullanilir — yeni bir guven deposu icat edilmiyor. Proxy ise BILEREK
// server/mcp/client.cjs'teki GLOBAL HTTPS_PROXY'den bagimsiz: admin sadece Smart
// trafigini proxy'lemek istedi (SMART_PROXY_URL, Admin > Sistem > Smart), global
// HTTPS_PROXY MCP/Splunk/AI gibi diger TUM entegrasyonlari da etkiler.
const { buildCombinedCa } = require('../ai/ca.cjs');

function buildSmartDispatcher(targetUrl) {
  const cfg = getConfig();
  const { Agent, ProxyAgent } = require('undici');
  const target = new URL(targetUrl);
  const { ca } = buildCombinedCa();
  const tlsOpts = { ca, rejectUnauthorized: true, servername: target.hostname };
  if (cfg.proxyUrl) {
    console.log(`[Smart] Proxy uzerinden baglanilacak: ${cfg.proxyUrl} -> ${target.hostname}`);
    return new ProxyAgent({ uri: cfg.proxyUrl, requestTls: tlsOpts });
  }
  return new Agent({ connect: tlsOpts });
}

async function post(path, body, extraHeaders) {
  const cfg = getConfig();
  const auth = Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
  const targetUrl = new URL(`${cfg.baseUrl}${path}`);
  // fetch() DEGIL — undici'nin dusuk seviyeli dispatcher.request() API'si kullanilir.
  // fetch(), WHATWG spec'ine uygun Response/Request nesneleri kurarken bazi Node
  // surumlerinde eksik olan bir ic yardimciyi (webidl.util.markAsUncloneable, normalde
  // node:worker_threads'ten gelir) sartsiz cagirabiliyor. dispatcher.request() bu WHATWG
  // sarmalamasina girmez. Dispatcher KURULUMU da (ProxyAgent/Agent, buildSmartDispatcher)
  // BILEREK try icinde: hata orada da olusabilir, disaridaysa asagidaki tani loglari
  // hic calismazdi.
  let dispatcher = null;
  let statusCode, text;
  try {
    dispatcher = buildSmartDispatcher(targetUrl.toString());
    const result = await dispatcher.request({
      origin: targetUrl.origin,
      path: targetUrl.pathname + targetUrl.search,
      method: 'POST',
      headers: {
        authorization: `Basic ${auth}`,
        'content-type': 'application/json;charset=UTF-8',
        ...(cfg.requestToken ? { 'rff-request-token': cfg.requestToken } : {}),
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      headersTimeout: 20_000,
      bodyTimeout: 20_000,
    });
    statusCode = result.statusCode;
    text = await result.body.text();
  } catch (err) {
    // Tani icin: node surumu + kurulu undici surumu + TAM stack (sadece mesaj degil) —
    // "webidl.util.markAsUncloneable is not a function" gibi ic-kutuphane hatalarinda
    // hangi dosya/satirdan geldigini gormeden kaynagi bulmak imkansiz.
    let undiciVersion = 'bilinmiyor';
    try { undiciVersion = require('undici/package.json').version; } catch { /* yoksay */ }
    console.error('[Smart] Baglanti hatasi:', {
      url: targetUrl.toString(),
      nodeVersion: process.version,
      undiciVersion,
      message: err.message,
      code: err.code || null,
      causeMessage: err.cause?.message || null,
      causeCode: err.cause?.code || null,
      stack: err.stack,
      causeStack: err.cause?.stack || null,
    });
    throw err;
  } finally {
    // Her cagrida taze dispatcher yaratiliyor (config canli — admin panelinden
    // degisebilir) — havuzu acik birakmamak icin kapatilir.
    if (dispatcher) dispatcher.close().catch(() => {});
  }
  let parsed;
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
  if (statusCode < 200 || statusCode >= 300) {
    throw Object.assign(new Error(`Smart API hata verdi (HTTP ${statusCode}): ${text.slice(0, 300)}`), { status: 502 });
  }
  return parsed;
}

// Talep acar — DOGRULANDI (SOS02-KL-001-EN, "Request Flow Opening Service - REST").
// `flowKey` hangi is akisina ait oldugunu belirtir (admin, Self Service item'inin "Smart
// Flow Key" alanindan girer — dokumandaki Designer > "Integration Information" ile
// alinan deger, bkz. FieldOverridesModal.tsx). `metadata` dokumandaki
// "metadataData.metadatas" dizisine karsilik gelir: talebe eklenecek serbest
// key/value cift listesi (ör. uygulama adi, sunucu listesi, islem) — hangi key'lerin
// beklendigini ogrenmek icin bkz. getFlowMetadata().
//
// DONUS: { ticketId, stateInstanceId, raw }. ticketId = dokumandaki wfInstanceId
// (smart_tickets.external_ticket_id'ye yazilir). resultCode "1000" DISINDAKI her
// deger basarisizliktir (dokuman: "if the value is 1000, the operation is successful,
// if 9000, it is unsuccessful") — resultMessage varsa hataya eklenir.
async function createTicket({ flowKey, username, domain, metadata }) {
  if (!isConfigured()) {
    throw Object.assign(new Error('Smart entegrasyonu yapılandırılmamış (SMART_API_URL/SMART_API_USERNAME/SMART_API_PASSWORD eksik).'), { status: 503 });
  }
  const cfg = getConfig();
  const body = {
    logonName: username,
    domain: domain || cfg.domain,
    flowKey,
    metaAttachmentsData: {},
    metadataData: {
      metadatas: Object.entries(metadata || {}).map(([key, value]) => ({ key, value: String(value) })),
    },
  };
  const result = await post(cfg.createTicketPath, body);
  const resultCode = String(result?.result?.resultCode ?? '');
  if (resultCode !== '1000') {
    const msg = result?.result?.resultMessage || `resultCode=${resultCode || 'yok'}`;
    throw Object.assign(new Error(`Smart talebi reddedildi: ${msg}`), { status: 502 });
  }
  const ticketId = result?.result?.wfInstanceId;
  if (!ticketId) {
    throw Object.assign(new Error(`Smart yanıtında wfInstanceId bulunamadı: ${JSON.stringify(result).slice(0, 300)}`), { status: 502 });
  }
  return { ticketId: String(ticketId), stateInstanceId: result?.result?.stateInstanceId ?? null, raw: result };
}

// Bir flowKey'in bekledigi metadata alanlarini (ElementName/IsRequired/DataType/...)
// sorgular — DOGRULANDI (SOS02-KL-001-EN, "Metadata Service Required to Start Request
// Flow - REST"). Su an hicbir yerden cagrilmiyor; createTicket()'a hangi `metadata`
// key'lerinin gecmesi gerektigini ELLE bulmak yerine admin arac-kutusuna eklemek icin
// hazir tutulur.
async function getFlowMetadata(flowName) {
  if (!isConfigured()) {
    throw Object.assign(new Error('Smart entegrasyonu yapılandırılmamış.'), { status: 503 });
  }
  const cfg = getConfig();
  const result = await post(cfg.getMetadataPath, { flowName });
  const resultCode = String(result?.result?.resultCode ?? '');
  if (resultCode !== '1000') {
    throw Object.assign(new Error(`Smart metadata sorgusu başarısız: ${result?.result?.resultMessage || `resultCode=${resultCode || 'yok'}`}`), { status: 502 });
  }
  return result?.result?.result || [];
}

// Talebin GUNCEL durumunu sorgular — DOGRULANMADI, bkz. dosya basi notu. SMART_CHECK_TICKET_PATH
// (Admin > Sistem > Smart) bos oldugu surece BILEREK hata firlatir: bir Smart API'si
// TAHMIN edip sessizce yanlis "hicbir zaman onaylanmadi" sonucuna dusmek, hicbir sonuca
// dusmemekten (poller sadece "henuz kontrol edilemedi" der, talep PENDING kalir) daha
// tehlikelidir.
async function checkTicketStatus(ticketId) {
  const cfg = getConfig();
  if (!cfg.checkTicketPath) {
    throw Object.assign(
      new Error('Smart talep durumu sorgulama endpoint\'i tanımlı değil (SMART_CHECK_TICKET_PATH) — bu, Smart RFF REST dokümanının kapsamı dışında, ayrı bir sistem olabilir.'),
      { status: 501 }
    );
  }
  if (!isConfigured()) {
    throw Object.assign(new Error('Smart entegrasyonu yapılandırılmamış.'), { status: 503 });
  }
  const result = await post(cfg.checkTicketPath, { wfInstanceId: ticketId, languageCode: 'TR' });
  const blocks = result?.result?.Blocks || result?.Blocks || [];
  const currentBlock = Array.isArray(blocks) ? blocks.find((b) => b?.IsCurrentBlock === true) : null;
  const currentState = currentBlock?.States?.find((s) => s?.StateStage) || null;
  const stateName = currentState?.StateName || '';
  const blockName = currentBlock?.Name || '';
  return {
    completed: blockName === 'FINISH_BLOCK',
    rejected: /CANCEL/i.test(stateName) || /REJECT/i.test(stateName),
    stateName,
    blockName,
    raw: result,
  };
}

module.exports = { createTicket, getFlowMetadata, checkTicketStatus };
