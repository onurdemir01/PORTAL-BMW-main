// server/oco/search.cjs — ekibin OCO'larını listeler (OCO Takvimi).
//
// Kullanıcı (2026-09-28): "Ekibime ait production operational change order'ları listeleyen
// bir endpoint göndereceğim. Portal'da solda 'OCO Takvimi' diye bir sekme oluştur ve
// buradaki OCO'ları tarihlere ve başlığa işleyerek kronolojik listele."
//
// Uç (kullanıcının verdiği):
//   GET {OCO_API_URL}/ChangeManagement/ChangeManagementServiceRepository.svc/Change/
//       SearchChangeOrderWithOffset/{skip}/?count=100&isAgentPatch=-1
//       &changeEnvironment=-1&parameterChange=-1&responsibleGroupId={grup}
//
// IKI SORGU BIRLESIK (kullanici, 2026-11-12): `openningGroupId` yalniz ekibin ACTIGI OCO'lari,
// `responsibleGroupId` degisikligi YAPACAK ekip biz olan OCO'lari getiriyor. Yalniz ikincisine
// gecilince acilanlar kayboldu ("hem bizim actigimiz hem bize acilan ayni anda"). Iki sorgu
// paralel cekilir, OCO numarasina gore birlestirilir; her satir hangi sorgudan geldigini
// (`iliski`: 'acan' | 'sorumlu') tasir. Her sorgu kullanicinin verdigi parametrelerle birebir:
// 'acan' pcabRequired=-1 tasir, 'sorumlu' tasimaz. Bir sorgu duserse digeri yine gosterilir ve
// eksik olan SOYLENIR (`eksik`); ikisi de duserse hata.
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

// KALICI DISPATCHER (2026-11-13): eskiden HER SAYFADA yeni Agent kurulup finally'de
// kapatiliyordu - her sayfa yeni TCP + TLS el sikismasi demekti (keep-alive yok). Artik modul
// duzeyinde tek dispatcher: anahtar = proxy + hedef host + CA deposu (ca.cjs onbellegi;
// sertifika donunce yeni dizi doner). Anahtar degisince eskisi kapatilir (ucustaki istekler
// biter), yenisi kurulur. headersTimeout/bodyTimeout istek basina aynen verilir.
const KEEPALIVE_MS = 30 * 1000;
const BAGLANTI = 4;
let _disp = null; // { anahtar, ca, dispatcher }

function undiciFabrika({ proxyUrl, tlsOpts }) {
  const { Agent, ProxyAgent } = require('undici');
  const ortak = { keepAliveTimeout: KEEPALIVE_MS, connections: BAGLANTI };
  if (proxyUrl) return new ProxyAgent({ uri: proxyUrl, requestTls: tlsOpts, ...ortak });
  return new Agent({ connect: tlsOpts, ...ortak });
}

function kapatSessiz(d) {
  try {
    const r = d && typeof d.close === 'function' ? d.close() : null;
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch {
    /* yoksay */
  }
}

/** @param {{fabrika?:Function, caOku?:Function}} [bag] testler sahte fabrika/CA verir */
function getDispatcher(targetUrl, bag = {}) {
  const fabrika = bag.fabrika || undiciFabrika;
  const caOku = bag.caOku || (() => require('../ai/ca.cjs').buildCombinedCa());
  const cfg = getConfig();
  const host = new URL(targetUrl).hostname;
  const { ca } = caOku();
  const anahtar = `${cfg.proxyUrl || ''}|${host}`;
  if (_disp && _disp.anahtar === anahtar && _disp.ca === ca) return _disp.dispatcher;
  if (_disp) kapatSessiz(_disp.dispatcher);
  const tlsOpts = { ca, rejectUnauthorized: true, servername: host };
  const dispatcher = fabrika({ proxyUrl: cfg.proxyUrl, tlsOpts });
  _disp = { anahtar, ca, dispatcher };
  return dispatcher;
}

function _resetDispatcher() {
  if (_disp) kapatSessiz(_disp.dispatcher);
  _disp = null;
}

/** Bir rolde ayni anda en fazla kac sayfa (OCO_SAYFA_ESZAMAN, varsayilan 3; 1 = eski sirali). */
function sayfaEszaman() {
  const n = Number.parseInt(process.env.OCO_SAYFA_ESZAMAN, 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 6) : 3;
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

/**
 * Arama ucunun KÖKÜ — `OCO_API_URL` bir kök adres DEĞİL.
 *
 * ÜRETİMDE ÖLÇÜLDÜ (kullanıcı, 2026-09-28): ayar şu şekilde girilmiş —
 *   https://servicerepository/ChangeManagement/…ServiceRepository.svc/Change/
 *   getChangeOrderByWfInstanceId/?wfInstanceId=
 * yani DETAY UCUNUN TAM URL'İ, sorgu parametresi dahil (detay çağrısı numarayı sonuna
 * ekleyerek çalışıyor). Arama yolunu bu dizginin sonuna eklemek, yolu `wfInstanceId`
 * değerinin İÇİNE gömdü:
 *   …getChangeOrderByWfInstanceId/?wfInstanceId=%2FChangeManagement%2F…%2F0%2F&count=100…
 * Servis bunu ayrıştıramayıp HTTP 400 + "Request Error" döndürüyordu. Adres mesaja
 * yazılmasaydı bu tek bakışta görülemezdi.
 *
 * ÇÖZÜM: ayarın YOL ve SORGU kısmına güvenilmez. Servis kökü `.svc` segmentine kadar
 * kesilir; ayarda `.svc` yoksa yalnız origin alınır ve tam yol eklenir. İki durumda da
 * kullanıcının tarayıcıda çalıştırdığı adresin AYNISI üretilir.
 */
function aramaKoku(baseUrl) {
  const u = new URL(baseUrl);
  const m = /^(.*?\.svc)(\/|$)/i.exec(u.pathname);
  if (m) return `${u.origin}${m[1]}/Change/SearchChangeOrderWithOffset/`;
  return `${u.origin}${SEARCH_PATH}`;
}

const ROLLER = ['acan', 'sorumlu'];
const ROL_ADI = { acan: 'açtığımız', sorumlu: 'bize açılan (sorumlu ekip)' };

function sayfaUrl(cfg, skip, groupId, rol = 'sorumlu') {
  const u = new URL(`${aramaKoku(cfg.baseUrl)}${Number(skip) || 0}/`);
  u.searchParams.set('count', String(PAGE_SIZE));
  // Kullanıcının verdiği çağrılardaki süzgeçler: -1 = "hepsi".
  if (rol === 'acan') u.searchParams.set('pcabRequired', '-1');
  u.searchParams.set('isAgentPatch', '-1');
  u.searchParams.set('changeEnvironment', '-1');
  u.searchParams.set('parameterChange', '-1');
  u.searchParams.set(rol === 'acan' ? 'openningGroupId' : 'responsibleGroupId', String(groupId));
  return u.toString();
}

/**
 * Arama ucunun HTTP hatasını anlatır.
 *
 * NEDEN AYRI BİR FONKSİYON: burada client.cjs'in `describeUpstreamError`'ı kullanılıyordu.
 * O metinler TEK BİR OCO KAYDI çeken uç için yazılmış; 400 alınca "…numarasını kabul
 * etmedi, numarayı kontrol edin" diyor. Arama ucunda kullanıcıya gösterilen sayı ise OCO
 * numarası değil GRUP KİMLİĞİ (6203) ve kullanıcının onu "kontrol etmesi" hiçbir işe
 * yaramıyor — mesaj, yanlış yere bakmayı öğütlüyordu (kullanıcı bildirimi, 2026-09-28).
 *
 * ÇAĞRILAN ADRES MESAJA YAZILIR: bu uçta sorunun iki apayrı kaynağı var ve ikisi de aynı
 * HTTP kodunu üretiyor — (a) OCO_API_URL yanlış/eksik girilmiş, (b) adres doğru ama servis
 * isteği reddediyor. Adres görünmeden ikisi ayırt edilemiyordu; tarayıcıda aynı adresi
 * açmak farkı bir bakışta gösteriyor.
 */
function aramaHatasi(statusCode, text, url, grup) {
  const { upstreamHint } = require('./client.cjs');
  const ipucu = upstreamHint(text);
  const ek = ipucu ? ` Servis notu: ${ipucu}` : '';
  const nerede = ` Çağrılan adres: ${url}`;
  // Sunucu günlüğüne HAM gövdenin başı da düşer: ekrana taşınmayan WCF/IIS hata
  // sayfalarında sebep çoğu zaman burada yazıyor.
  console.warn(
    `[OCO] arama HTTP ${statusCode} — ${url} — gövde: ${String(text || '')
      .slice(0, 300)
      .replace(/\s+/g, ' ')}`,
  );

  if (statusCode === 400) {
    return fail(
      `OCO arama servisi isteği reddetti (HTTP 400). Bu bir yapılandırma/servis sorunudur,` +
        ` girdiğiniz bir değerden kaynaklanmıyor. Grup kimliği: ${grup}.${nerede}${ek}`,
      502,
    );
  }
  if (statusCode === 401 || statusCode === 403) {
    return fail(
      `OCO arama servisi Portal'ın erişimini reddetti (HTTP ${statusCode}). Servis bu çağrı` +
        ` için kimlik doğrulaması bekliyor olabilir; yöneticiye bildirin.${nerede}${ek}`,
      502,
    );
  }
  if (statusCode === 404) {
    return fail(
      `OCO arama ucu bulunamadı (HTTP 404). OCO_API_URL yanlış olabilir (Admin > Sistem).${nerede}${ek}`,
      502,
    );
  }
  if (statusCode >= 500) {
    return fail(
      `OCO arama servisi şu an yanıt veremiyor (HTTP ${statusCode}). Biraz sonra tekrar` +
        ` deneyin; sorun sürerse yöneticiye bildirin.${nerede}${ek}`,
      502,
    );
  }
  return fail(
    `OCO arama servisi beklenmeyen bir cevap döndü (HTTP ${statusCode}).${nerede}${ek}`,
    502,
  );
}

/**
 * Grubun actigi VE sorumlu oldugu TUM OCO'lari ceker (iki sorgu, sayfalayarak), OCO numarasina
 * gore birlestirir ve kronolojik dondurur. fetchPage(skip, rol) testler icindir.
 * @returns {{ rows: object[], total: number, fetched: number, truncated: boolean,
 *   kaynak: object, eksik: {rol: string, message: string}[] }}
 */
async function searchChangeOrders({ groupId, fetchPage, roller = ROLLER } = {}) {
  const cfg = getConfig();
  if (!cfg.baseUrl) {
    throw fail('OCO servisi yapılandırılmamış (Admin > Sistem > OCO_API_URL).', 503);
  }
  const grup = String(groupId || cfg.searchGroupId || '').trim();
  if (!/^\d+$/.test(grup)) {
    throw fail('OCO arama grubu tanımlı değil (OCO_SEARCH_GROUP_ID).', 503);
  }

  const sonuclar = await Promise.allSettled(
    roller.map((rol) =>
      tekSorgu(fetchPage ? (skip) => fetchPage(skip, rol) : (skip) => httpPage(cfg, skip, grup, rol)),
    ),
  );
  const basarili = sonuclar.filter((s) => s.status === 'fulfilled');
  if (!basarili.length) throw sonuclar[0].reason;

  const birlesik = new Map();
  const kaynak = {};
  const eksik = [];
  let truncated = false;
  sonuclar.forEach((s, i) => {
    const rol = roller[i];
    if (s.status !== 'fulfilled') {
      eksik.push({ rol, message: `${ROL_ADI[rol] || rol} OCO'lar alınamadı: ${s.reason?.message || s.reason}` });
      return;
    }
    const r = s.value;
    kaynak[rol] = { total: r.total, fetched: r.fetched, truncated: r.truncated };
    if (r.truncated) truncated = true;
    for (const row of r.rows) {
      const var_ = birlesik.get(row.oco);
      if (var_) {
        if (!var_.iliski.includes(rol)) var_.iliski.push(rol);
      } else birlesik.set(row.oco, { ...row, iliski: [rol] });
    }
  });
  const rows = sortChronological([...birlesik.values()]);
  // total: birlesik benzersiz OCO sayisi (iki sorguda da gelen OCO bir kez). Kirpma varsa
  // servisin sayilari kaynak[rol].total'da.
  return { rows, total: rows.length, fetched: rows.length, truncated, kaynak, eksik };
}

/** Sayfa yanitini dogrular: { dilim: ham kayitlar, total }. */
function sayfaCoz(payload, oncekiTotal) {
  const sonuc = payload && payload.SearchChangeOrderWithOffsetResult;
  if (!sonuc) throw fail('OCO arama servisinden beklenen yanıt gelmedi.', 502);
  const dilim = Array.isArray(sonuc.Result) ? sonuc.Result : [];
  return { dilim, total: Number(sonuc.TotalCount) || oncekiTotal || 0 };
}

/**
 * Tek sorgunun TUM sayfalari.
 *
 * PARALEL SAYFA (2026-11-13): ilk sayfa sirali cekilir (TotalCount ogrenilir). Ilk sayfa TAM
 * doluysa (PAGE_SIZE kayit) kalan sayfalar skip = i * PAGE_SIZE ile en fazla `eszaman` paralel
 * cekilir ve skip sirasina gore birlestirilir. Ilk sayfa kisa geldiyse (servis istenenden az
 * dondu) sayfa boyu bilinmez: eski SIRALI yol (ofset = alinan HAM kayit sayisi) kullanilir.
 * Kurallar iki yolda da ayni: bos sayfa = dur (sonraki indeksler yok sayilir), MAX_PAGES ust
 * siniri + truncated, herhangi bir sayfa hatasi rolun hatasi. Rol icinde OCO numarasina gore
 * tekillestirilir (paralel cekimde kayan kayit iki sayfada gorunebilir).
 */
async function tekSorgu(cek, { eszaman = sayfaEszaman() } = {}) {
  const ilk = sayfaCoz(await cek(0), 0);
  let total = ilk.total;
  const dilimler = [ilk.dilim];
  let truncated = false;

  if (ilk.dilim.length === PAGE_SIZE && ilk.dilim.length < total && eszaman > 1) {
    const toplamSayfa = Math.ceil(total / PAGE_SIZE);
    const sinir = Math.min(toplamSayfa, MAX_PAGES);
    let siradaki = 1;
    let bosIndeks = Number.POSITIVE_INFINITY;
    let hata = null;
    const isci = async () => {
      for (;;) {
        const i = siradaki++;
        if (i >= sinir || i > bosIndeks || hata) return;
        try {
          // OFSET sayfa INDEKSINDEN (ham kayit), ekrana cikan satir sayisindan DEGIL.
          const p = sayfaCoz(await cek(i * PAGE_SIZE), total);
          dilimler[i] = p.dilim;
          if (!p.dilim.length) bosIndeks = Math.min(bosIndeks, i);
        } catch (e) {
          hata = hata || e;
          return;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(eszaman, sinir - 1) }, isci));
    if (hata) throw hata;
    dilimler.length = Math.min(sinir, bosIndeks + 1);
    // SESSIZ KIRPMA YOK: sinira takildiysak (ve bos sayfayla bitmediyse) soylenir.
    truncated = toplamSayfa > MAX_PAGES && bosIndeks === Number.POSITIVE_INFINITY;
  } else if (ilk.dilim.length && ilk.dilim.length < total) {
    // SIRALI YOL. OFSET HAM KAYIT SAYISIDIR, ekrana cikan satir sayisi DEGIL. `rows.length`
    // kullanmak sinsi bir hataydi: normalizeOrder numarasiz bir kaydi dusururse ofset geride
    // kalir, sonraki sayfa ayni kayitlari tekrar getirir ve liste ya tekrarlar ya da hic bitmez.
    let alinan = ilk.dilim.length;
    let sayfa = 1;
    for (;;) {
      if (sayfa >= MAX_PAGES) {
        // SESSIZ KIRPMA YOK: eksik liste "bu kadar OCO var" diye okunurdu.
        truncated = true;
        break;
      }
      const p = sayfaCoz(await cek(alinan), total);
      total = p.total;
      alinan += p.dilim.length;
      dilimler.push(p.dilim);
      sayfa += 1;
      // BOS SAYFA = DUR: aksi halde servis hep bos donerse dongu TotalCount'a hic ulasamaz.
      if (!p.dilim.length) break;
      if (alinan >= total) break;
    }
  }

  const tekil = new Map();
  for (const d of dilimler) {
    for (const r of d || []) {
      const n = normalizeOrder(r);
      if (n && !tekil.has(n.oco)) tekil.set(n.oco, n);
    }
  }
  const rows = [...tekil.values()];
  return { rows: sortChronological(rows), total, fetched: rows.length, truncated };
}

function slowHttpEsik() {
  try {
    return require('../metrics.cjs').slowHttpThresholdMs();
  } catch {
    return 1500;
  }
}

async function httpPage(cfg, skip, grup, rol) {
  const url = sayfaUrl(cfg, skip, grup, rol);
  const { request } = require('undici');
  let statusCode;
  let text;
  const t0 = process.hrtime.bigint();
  try {
    const dispatcher = getDispatcher(url);
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
    // OLCUM: sayfa basina sure ve bayt (URL / grup YAZILMAZ). Dispatcher KAPATILMAZ (kalici).
    try {
      const ms = Math.round(Number(process.hrtime.bigint() - t0) / 1e6);
      if (ms > slowHttpEsik()) {
        console.warn(
          `[SlowHttp] svc=oco rol=${rol} skip=${Number(skip) || 0} ms=${ms} ` +
            `bytes=${text == null ? '-' : Buffer.byteLength(text)} status=${statusCode == null ? '-' : statusCode}`,
        );
      }
    } catch {
      /* gozlem cekimi bozmamali */
    }
  }

  if (statusCode < 200 || statusCode >= 300) {
    throw aramaHatasi(statusCode, text, url, grup);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw fail('OCO arama servisinden geçerli JSON dönmedi.', 502);
  }
}

module.exports = {
  searchChangeOrders,
  tekSorgu,
  getDispatcher,
  _resetDispatcher,
  sayfaEszaman,
  aramaHatasi,
  aramaKoku,
  sayfaUrl,
  normalizeOrder,
  sortChronological,
  ROLLER,
  SEARCH_PATH,
  PAGE_SIZE,
  MAX_PAGES,
};
