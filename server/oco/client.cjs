// server/oco/client.cjs — OCO (ChangeManagement ServiceRepository) REST istemcisi.
//
// TEK ISI VAR: bir OCO numarasi (wfInstanceId) icin degisiklik kaydini cekmek.
// GET {OCO_API_URL}{OCO_CHANGE_ORDER_PATH}?wfInstanceId=<numara>
//
// Istek deseni server/smart/client.cjs ile ayni gerekcelerle kuruldu:
//   * fetch() DEGIL, undici dispatcher.request(): fetch bazi Node surumlerinde eksik
//     olan bir ic yardimciyi (webidl.util.markAsUncloneable) sartsiz cagirabiliyor.
//   * TLS icin server/ai/ca.cjs'teki birlesik CA (public kokler + kurumsal zincirler)
//     yeniden kullanilir - yeni bir guven deposu icat edilmez.
'use strict';

const { getConfig } = require('./config.cjs');
const { buildCombinedCa } = require('../ai/ca.cjs');

function buildDispatcher(targetUrl) {
  const cfg = getConfig();
  const { Agent, ProxyAgent } = require('undici');
  const target = new URL(targetUrl);
  const { ca } = buildCombinedCa();
  const tlsOpts = { ca, rejectUnauthorized: true, servername: target.hostname };
  if (cfg.proxyUrl) return new ProxyAgent({ uri: cfg.proxyUrl, requestTls: tlsOpts });
  return new Agent({ connect: tlsOpts });
}

function fail(message, status) {
  const err = new Error(message);
  err.status = status || 502;
  return err;
}

// OCO numarasi: yalnizca rakam. Dogrudan URL'ye gomuldugu icin bu kontrol SART -
// serbest metin kabul etmek path/sorgu enjeksiyonuna acik kapi birakirdi.
function normalizeOcoNumber(raw) {
  const s = String(raw ?? '').trim();
  if (!/^\d{1,20}$/.test(s)) return null;
  return s;
}

async function getChangeOrder(ocoNumber) {
  const num = normalizeOcoNumber(ocoNumber);
  if (!num) throw fail('OCO numarası yalnızca rakamlardan oluşmalıdır.', 400);

  const cfg = getConfig();
  if (!cfg.baseUrl) throw fail('OCO servisi yapılandırılmamış (Admin > Sistem > OCO_API_URL).', 503);

  const url = new URL(`${cfg.baseUrl}${cfg.changeOrderPath}`);
  url.searchParams.set('wfInstanceId', num);

  const { request } = require('undici');
  let dispatcher = null;
  let statusCode, text;
  try {
    dispatcher = buildDispatcher(url.toString());
    const res = await request(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
      dispatcher,
      headersTimeout: cfg.timeoutMs,
      bodyTimeout: cfg.timeoutMs,
    });
    statusCode = res.statusCode;
    text = await res.body.text();
  } catch (err) {
    throw fail(`OCO servisine ulaşılamadı: ${err.message}`, 502);
  } finally {
    if (dispatcher && typeof dispatcher.close === 'function') dispatcher.close().catch(() => {});
  }

  if (statusCode < 200 || statusCode >= 300) {
    throw fail(`OCO servisi ${statusCode} döndü.`, 502);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw fail('OCO servisinden geçerli JSON dönmedi.', 502);
  }

  const wrapper = payload?.GetChangeOrderByWfInstanceIdResult;
  if (!wrapper) throw fail('OCO cevabı beklenen biçimde değil (GetChangeOrderByWfInstanceIdResult yok).', 502);
  // Ornek cevapta basari kodu 1000. Kod farkliysa ya da Result bos ise kayit
  // bulunamamis demektir - "bos kaydi gecerli say" YAPILMAZ, prod'a dokunuyoruz.
  if (!wrapper.Result) {
    const msg = wrapper.ResultMessage ? ` (${wrapper.ResultMessage})` : '';
    throw fail(`OCO kaydı bulunamadı: ${num}${msg}`, 404);
  }

  return { payload, result: wrapper.Result, resultCode: wrapper.ResultCode };
}

module.exports = { getChangeOrder, normalizeOcoNumber };
