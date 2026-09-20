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

/** OCO yaniti icin bayt tavani. Bir degisiklik kaydi birkac KB'dir. */
const OCO_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Govdeyi tavana kadar okur; tavan asilirsa akisi KESER ve hata firlatir.
 * `.text()` cagirip sonra uzunluga bakmak ise yaramazdi — o noktada veri ZATEN
 * bellekte olurdu.
 */
async function okuSinirli(body, tavan) {
  let bayt = 0;
  const parcalar = [];
  for await (const parca of body) {
    bayt += parca.length;
    if (bayt > tavan) {
      if (typeof body.destroy === 'function') body.destroy();
      throw fail(
        `OCO yaniti cok buyuk (> ${Math.round(tavan / (1024 * 1024))} MB) — beklenmeyen bir cevap.`,
        502,
      );
    }
    parcalar.push(parca);
  }
  return Buffer.concat(parcalar).toString('utf8');
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
    // BAYT KAPISI. `.text()` sinirsizdir; portal 2026-09'da sinirsiz tamponlama
    // yuzunden yedi kez OOM ile coktu. Bir degisiklik kaydi birkac KB'dir —
    // MB'larca gelen bir yanit ya bozuk ya da bizim beklemedigimiz bir seydir,
    // ikisinde de bellege almak yanlis.
    text = await okuSinirli(res.body, OCO_RESPONSE_MAX_BYTES);
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

// HTTP DURUM KODU (ekran goruntusu, 2026-09-16): Portal, nginx arkasinda calisiyor ve
// nginx `proxy_intercept_errors on` + `error_page 403 404 500 502 503 504` ile bu kodlu
// cevaplarin GOVDESINI kendi HTML hata sayfasiyla degistiriyor. Yani "OCO bulunamadi"
// mesajini JSON olarak 404 ile dondurmek, kullaniciya "<!doctype html>..." gostermek
// demek. Kullaniciya mesaj tasiyan OCO cevaplari bu yuzden 400 ile doner (nginx 400'e
// dokunmaz); err.status semantik olarak kalir, yalnizca HTTP katmanina cevrilir.
const NGINX_INTERCEPTED = new Set([403, 404, 500, 502, 503, 504]);
function httpStatus(err) {
  const s = Number((err && err.status) || 400);
  return NGINX_INTERCEPTED.has(s) ? 400 : s;
}

module.exports = { getChangeOrder, normalizeOcoNumber, describeUpstreamError, upstreamHint, httpStatus, NGINX_INTERCEPTED };
