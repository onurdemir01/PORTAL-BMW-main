// server/oco/search.cjs — ekibin OCO'larını listeler (OCO Takvimi).
//
// Kullanıcı (2026-09-28): "Ekibime ait production operational change order'ları listeleyen
// bir endpoint göndereceğim. Portal'da solda 'OCO Takvimi' diye bir sekme oluştur ve
// buradaki OCO'ları tarihlere ve başlığa işleyerek kronolojik listele."
//
// Uç (kullanıcının verdiği):
//   GET {OCO_API_URL}/ChangeManagement/ChangeManagementServiceRepository.svc/Change/
//       SearchChangeOrderWithOffset/{skip}/?count=100&pcabRequired=-1&isAgentPatch=-1
//       &changeEnvironment=-1&parameterChange=-1&openningGroupId={grup}
//
// İSTEK DESENİ client.cjs İLE AYNI: undici dispatcher + kurumsal CA + boyut sınırı.
// İkinci bir istek yolu açmak, TLS/proxy/timeout kurallarının bir gün ayrışması demekti.
//
// DÖNÜŞTÜRME BURADA BİTER: servis her kayıt için ~150 alan döndürüyor, ekranın 10 tanesi
// işine yarıyor. Hepsini tarayıcıya taşımak 100 kayıtta megabaytlara çıkardı; üstelik
// kullanılmayan alanlar (CreateUserId, SRM kimlikleri…) gereksiz veri yayılımıdır.
'use strict';

const { getConfig } = require('./config.cjs');
const { parseOcoDate } = require('./window.cjs');

const SEARCH_PATH =
  '/ChangeManagement/ChangeManagementServiceRepository.svc/Change/SearchChangeOrderWithOffset/';
// Tek sayfada istenecek kayıt (servisin kendi üst sınırı; kullanıcının verdiği çağrıda 100).
const PAGE_SIZE = 100;
// SONSUZ DÖNGÜ KAPISI: servis TotalCount'u yanlış verirse ya da hep aynı sayfayı
// döndürürse, sayfa döngüsü sonsuza kadar sürerdi.
const MAX_PAGES = 20;
const RESPONSE_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Ham OCO kaydını ekranın kullandığı alanlara indirger.
 *
 * TARİHLER parseOcoDate ile çözülür: servis WCF biçimi (`/Date(1791309600000+0300)/`)
 * kullanıyor. `new Date(dizgi)` bunu ya reddeder ya da platforma göre başka yorumlar;
 * paranteze yazılan `+0300` yalnızca bilgi amaçlıdır, epoch zaten mutlaktır (iki kez
 * uygulanırsa tarih üç saat kayar).
 */
function normalizeOrder(r) {
  if (!r || typeof r !== 'object') return null;
  const oco = Number(r.OcoWfInstanceId) || 0;
  if (!oco) return null;

  const iso = (v) => {
    const d = parseOcoDate(v);
    return d ? d.toISOString() : null;
  };

  return {
    oco,
    subject: String(r.Subject || '').trim(),
    explanation: String(r.Explanation || '').trim(),
    statusText: String(r.OcoStatusText || '').trim(),
    statusCode: Number(r.OcoStatus) || 0,
    impactText: String(r.ChangeImpactText || '').trim(),
    processText: String(r.ProcessTypeText || '').trim(),
    // "Evet"/"Hayır" metni servis tarafından geliyor; bayrağı da taşıyoruz ki ekran
    // metne göre değil değere göre süzebilsin.
    pcabRequired: r.PcabRequired === true,
    plannedStart: iso(r.PlannedStartDate),
    plannedEnd: iso(r.PlannedEndDate),
    actualStart: iso(r.ActualStartDate),
    actualEnd: iso(r.ActualEndDate),
    openedAt: iso(r.OcoOpeningDate),
  };
}

/** Kronolojik sıra: planlanan başlangıca göre. Tarihsizler SONA, ama ATILMAZ. */
function sortChronological(rows) {
  const t = (x) => (x.plannedStart ? Date.parse(x.plannedStart) : Number.POSITIVE_INFINITY);
  return [...rows].sort((a, b) => t(a) - t(b) || a.oco - b.oco);
}

function buildDispatcher(targetUrl) {
  const cfg = getConfig();
  const { Agent, ProxyAgent } = require('undici');
  const target = new URL(targetUrl);
  const { ca } = require('../ai/ca.cjs').buildCombinedCa();
  const tlsOpts = { ca, rejectUnauthorized: true, servername: target.hostname };
  if (cfg.proxyUrl) return new ProxyAgent({ uri: cfg.proxyUrl, requestTls: tlsOpts });
  return new Agent({ connect: tlsOpts });
}

async function okuSinirli(body, max) {
  let n = 0;
  const parcalar = [];
  for await (const p of body) {
    n += p.length;
    if (n > max) throw new Error(`OCO arama yanıtı ${max} bayt sınırını aştı`);
    parcalar.push(p);
  }
  return Buffer.concat(parcalar).toString('utf8');
}

function fail(message, status) {
  const err = new Error(message);
  err.status = status || 502;
  return err;
}

function sayfaUrl(cfg, skip, groupId) {
  const u = new URL(`${cfg.baseUrl}${SEARCH_PATH}${Number(skip) || 0}/`);
  u.searchParams.set('count', String(PAGE_SIZE));
  // Kullanıcının verdiği çağrıdaki süzgeçler: -1 = "hepsi".
  u.searchParams.set('pcabRequired', '-1');
  u.searchParams.set('isAgentPatch', '-1');
  u.searchParams.set('changeEnvironment', '-1');
  u.searchParams.set('parameterChange', '-1');
  u.searchParams.set('openningGroupId', String(groupId));
  return u.toString();
}

/**
 * Grubun TÜM OCO'larını çeker (sayfalayarak) ve kronolojik döndürür.
 * @returns {{ rows: object[], total: number, fetched: number, truncated: boolean }}
 */
async function searchChangeOrders({ groupId, fetchPage } = {}) {
  const cfg = getConfig();
  if (!cfg.baseUrl) {
    throw fail('OCO servisi yapılandırılmamış (Admin > Sistem > OCO_API_URL).', 503);
  }
  const grup = String(groupId || cfg.searchGroupId || '').trim();
  if (!/^\d+$/.test(grup)) {
    throw fail('OCO arama grubu tanımlı değil (OCO_SEARCH_GROUP_ID).', 503);
  }

  const cek = fetchPage || ((skip) => httpPage(cfg, skip, grup));

  const rows = [];
  let total = 0;
  let sayfa = 0;
  let truncated = false;

  for (;;) {
    const payload = await cek(rows.length);
    const sonuc = payload && payload.SearchChangeOrderWithOffsetResult;
    if (!sonuc) throw fail('OCO arama servisinden beklenen yanıt gelmedi.', 502);

    const dilim = Array.isArray(sonuc.Result) ? sonuc.Result : [];
    total = Number(sonuc.TotalCount) || total;
    for (const r of dilim) {
      const n = normalizeOrder(r);
      if (n) rows.push(n);
    }

    sayfa += 1;
    // BOŞ SAYFA = DUR: aksi halde servis hep boş dönerse döngü TotalCount'a hiç ulaşamaz.
    if (!dilim.length) break;
    if (rows.length >= total) break;
    if (sayfa >= MAX_PAGES) {
      // SESSİZ KIRPMA YOK: eksik liste "bu kadar OCO var" diye okunurdu.
      truncated = true;
      break;
    }
  }

  return { rows: sortChronological(rows), total, fetched: rows.length, truncated };
}

async function httpPage(cfg, skip, grup) {
  const url = sayfaUrl(cfg, skip, grup);
  const { request } = require('undici');
  let dispatcher = null;
  let statusCode;
  let text;
  try {
    dispatcher = buildDispatcher(url);
    const res = await request(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      dispatcher,
      headersTimeout: cfg.timeoutMs,
      bodyTimeout: cfg.timeoutMs,
    });
    statusCode = res.statusCode;
    text = await okuSinirli(res.body, RESPONSE_MAX_BYTES);
  } catch (err) {
    throw fail(`OCO arama servisine ulaşılamadı: ${err.message}`, 502);
  } finally {
    if (dispatcher && typeof dispatcher.close === 'function') dispatcher.close().catch(() => {});
  }

  if (statusCode < 200 || statusCode >= 300) {
    const { describeUpstreamError } = require('./client.cjs');
    throw describeUpstreamError(statusCode, text, grup);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw fail('OCO arama servisinden geçerli JSON dönmedi.', 502);
  }
}

module.exports = {
  searchChangeOrders,
  normalizeOrder,
  sortChronological,
  SEARCH_PATH,
  PAGE_SIZE,
  MAX_PAGES,
};
