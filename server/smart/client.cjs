// server/smart/client.cjs — Smart/RFF REST istemcisi.
//
// SEKIL referans kod tabanindaki (kardes ekip) dashboard/smart.py::GBCA sinifindan
// AYNEN alindi: Basic Auth (base64 user:pass) + ozel "RFF-Request-Token" header'i,
// JSON govde. O kod tabani AYNI sirketin AYNI Smart sistemine baglaniyor, bu yuzden
// protokol sekli buyuk ihtimalle dogru — ama gercek endpoint path'leri, gonderilecek
// alan adlari (flowKey/metadataData vb.) ve durum-sorgulama cevabinin TAM sekli Onur'dan
// gelecek gercek ornek istek/yanitla DOGRULANMALI. Asagidaki iki fonksiyon o dogrulama
// icin TEK dokunulacak yer olacak sekilde izole edildi.
'use strict';

const { getConfig, isConfigured } = require('./config.cjs');

async function post(path, body, extraHeaders) {
  const cfg = getConfig();
  const auth = Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json;charset=UTF-8',
      ...(cfg.requestToken ? { 'RFF-Request-Token': cfg.requestToken } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
  if (!res.ok) {
    throw Object.assign(new Error(`Smart API hata verdi (HTTP ${res.status}): ${text.slice(0, 300)}`), { status: 502 });
  }
  return parsed;
}

// Talep acar. `flowKey` hangi is akisina ait oldugunu belirtir (admin, Self Service
// item'inin "Smart Flow Key" alanindan girer — kardes ekipteki AppSettings-tabanli
// esdegeri; burada DB yerine per-item override'da tutulur, bkz. FieldOverridesModal).
// `metadata` referanstaki "metadataData.metadatas" dizisine karsilik gelir: talebe
// eklenecek serbest key/value cift listesi (ör. uygulama adi, sunucu listesi, islem).
//
// DONUS: { ticketId, stateName, raw } — ticketId referans kod tabanindaki wfInstanceId
// karsiligidir, smart_tickets.external_ticket_id'ye yazilir. Gercek yanit sekli
// dogrulanana kadar `ticketId`/`stateName` cikarma mantigi TAHMINIDIR (asagida acikca
// isaretli) — Onur'dan ornek yanit gelince tek bu blok guncellenmeli.
async function createTicket({ flowKey, username, domain, metadata }) {
  if (!isConfigured()) {
    throw Object.assign(new Error('Smart entegrasyonu yapılandırılmamış (SMART_API_URL/SMART_API_USERNAME/SMART_API_PASSWORD eksik).'), { status: 503 });
  }
  const cfg = getConfig();
  const body = {
    logonName: username,
    domain: domain || '',
    flowKey,
    metaAttachmentsData: {},
    metadataData: {
      metadatas: Object.entries(metadata || {}).map(([key, value]) => ({ key, value: String(value) })),
    },
  };
  const result = await post(cfg.createTicketPath, body);
  // TAHMIN (dogrulanmadi): referans kod tabaninda result.result.wfInstanceId +
  // result.result.resultCode=="1000" basari kriteriydi.
  const ticketId = result?.result?.wfInstanceId || result?.wfInstanceId || result?.ticketId;
  if (!ticketId) {
    throw Object.assign(new Error(`Smart talep açma yanıtında ticket ID bulunamadı: ${JSON.stringify(result).slice(0, 300)}`), { status: 502 });
  }
  return { ticketId: String(ticketId), raw: result };
}

// Talebin GUNCEL durumunu sorgular. DONUS: { completed, rejected, stateName, blockName, raw }
//   completed = onaylanip is akisinin son adimina (FINISH_BLOCK esdegeri) ulasti
//   rejected  = talep reddedildi/iptal edildi (durum adinda "CANCEL"/"REJECT" geciyor)
// TAHMIN (dogrulanmadi) — referans kod tabanindaki ServiceRepository.check_state_ticket +
// get_block_state_in_ticket mantigi buraya tasindi; gercek Smart API'nizin yaniti farkli
// alan adlari kullaniyorsa SADECE bu fonksiyon guncellenmeli, cagiran kod (poller.cjs)
// degismez.
async function checkTicketStatus(ticketId) {
  if (!isConfigured()) {
    throw Object.assign(new Error('Smart entegrasyonu yapılandırılmamış.'), { status: 503 });
  }
  const cfg = getConfig();
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

module.exports = { createTicket, checkTicketStatus };
