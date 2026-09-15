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

// OLMAYAN OCO (kullanici bildirimi, 2026-09-15): OCO servisi bilinmeyen numaraya HTTP 404
// donuyor; ekranda "OCO servisi 404 dondu." gibi ham bir satir cikiyordu. Kullanicinin
// yapabilecegi tek sey numarayi kontrol etmek — mesaj bunu SOYLEMELI. Diger kodlar da
// ayni sekilde "ne oldu / ne yapmali" diliyle yazilir; HTTP kodu parantezde kalir ki
// yonetici izleyebilsin. Servis govdesinde okunur bir mesaj varsa eklenir.
function describeUpstreamError(statusCode, text, num) {
  const hint = upstreamHint(text);
  const suffix = hint ? ` (${hint})` : '';
  if (statusCode === 404) {
    return fail(
      `OCO ${num} bulunamadı. Numarayı kontrol edin — kayıt OCO sisteminde açılmış olmalı` +
        ` ve yalnızca rakamlardan oluşmalı (ör. 22502813).${suffix}`,
      404,
    );
  }
  if (statusCode === 401 || statusCode === 403) {
    return fail(
      `OCO servisi Portal'ın erişimini reddetti (HTTP ${statusCode}). Bu sizinle ilgili değil;` +
        ` yöneticiye bildirin.${suffix}`,
      502,
    );
  }
  if (statusCode === 400) {
    return fail(`OCO servisi ${num} numarasını kabul etmedi (HTTP 400). Numarayı kontrol edin.${suffix}`, 400);
  }
  if (statusCode >= 500) {
    return fail(
      `OCO servisi şu an yanıt veremiyor (HTTP ${statusCode}). Biraz sonra tekrar deneyin;` +
        ` sorun sürerse yöneticiye bildirin.${suffix}`,
      502,
    );
  }
  return fail(`OCO servisi beklenmeyen bir cevap döndü (HTTP ${statusCode}).${suffix}`, 502);
}

// Servis govdesinden kisa, okunur bir ipucu: JSON ise Message/ResultMessage/error alani;
// degilse ilk 120 karakter. HTML hata sayfasi ya da bos govde -> hicbir sey.
function upstreamHint(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  try {
    const j = JSON.parse(raw);
    const m = j?.ResultMessage || j?.Message || j?.message || j?.error || '';
    return String(m || '').trim().slice(0, 160);
  } catch {
    /* JSON degil */
  }
  // HTML hata sayfasi (IIS/ASP.NET 404 sayfasi gibi) kullaniciya gosterilecek bir sey degil.
  if (/^\s*<(!doctype|html)/i.test(raw)) return '';
  const plain = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.slice(0, 120);
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
    throw describeUpstreamError(statusCode, text, num);
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
    throw fail(`OCO ${num} bulunamadı. Numarayı kontrol edin — kayıt OCO sisteminde açılmış olmalı.${msg}`, 404);
  }

  return { payload, result: wrapper.Result, resultCode: wrapper.ResultCode };
}

module.exports = { getChangeOrder, normalizeOcoNumber, describeUpstreamError, upstreamHint };
