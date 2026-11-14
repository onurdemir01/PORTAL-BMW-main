// server/oco/search.cjs — ekibin OCO'larini listeler (OCO Takvimi).
//
// Kullanici (2026-09-28): "Ekibime ait production operational change order'lari listeleyen
// bir endpoint gonderecegim. Portal'da solda 'OCO Takvimi' diye bir sekme olustur ve
// buradaki OCO'lari tarihlere ve basliga isleyerek kronolojik listele."
//
// Uc (kullanicinin verdigi):
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
// ISTEK DESENI client.cjs ILE AYNI: undici dispatcher + kurumsal CA + boyut siniri.
// Ikinci bir istek yolu acmak, TLS/proxy/timeout kurallarinin bir gun ayrismasi demekti.
//
// DONUSTURME BURADA BITER: servis her kayit icin ~150 alan donduruyor, ekranin 10 tanesi
// isine yariyor. Hepsini tarayiciya tasimak 100 kayitta megabaytlara cikardi; ustelik
// kullanilmayan alanlar (CreateUserId, SRM kimlikleri…) gereksiz veri yayilimidir.
'use strict';

const { getConfig } = require('./config.cjs');
const { parseOcoDate } = require('./window.cjs');

const SEARCH_PATH =
  '/ChangeManagement/ChangeManagementServiceRepository.svc/Change/SearchChangeOrderWithOffset/';
// Tek sayfada istenecek kayit (servisin kendi ust siniri; kullanicinin verdigi cagrida 100).
const PAGE_SIZE = 100;
// SONSUZ DONGU KAPISI: servis TotalCount'u yanlis verirse ya da hep ayni sayfayi
// dondururse, sayfa dongusu sonsuza kadar surerdi.
const MAX_PAGES = 20;
const RESPONSE_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Ham OCO kaydini ekranin kullandigi alanlara indirger.
 *
 * TARIHLER parseOcoDate ile cozulur: servis WCF bicimi (`/Date(1791309600000+0300)/`)
 * kullaniyor. `new Date(dizgi)` bunu ya reddeder ya da platforma gore baska yorumlar;
 * paranteze yazilan `+0300` yalnizca bilgi amaclidir, epoch zaten mutlaktir (iki kez
 * uygulanirsa tarih uc saat kayar).
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
    // "Evet"/"Hayir" metni servis tarafindan geliyor; bayragi da tasiyoruz ki ekran
    // metne gore degil degere gore suzebilsin.
    pcabRequired: r.PcabRequired === true,
    plannedStart: iso(r.PlannedStartDate),
    plannedEnd: iso(r.PlannedEndDate),
    actualStart: iso(r.ActualStartDate),
    actualEnd: iso(r.ActualEndDate),
    openedAt: iso(r.OcoOpeningDate),
  };
}

/** Kronolojik sira: planlanan baslangica gore. Tarihsizler SONA, ama ATILMAZ. */
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
 * Arama ucunun KOKU — `OCO_API_URL` bir kok adres DEGIL.
 *
 * URETIMDE OLCULDU (kullanici, 2026-09-28): ayar su sekilde girilmis —
 *   https://servicerepository/ChangeManagement/…ServiceRepository.svc/Change/
 *   getChangeOrderByWfInstanceId/?wfInstanceId=
 * yani DETAY UCUNUN TAM URL'I, sorgu parametresi dahil (detay cagrisi numarayi sonuna
 * ekleyerek calisiyor). Arama yolunu bu dizginin sonuna eklemek, yolu `wfInstanceId`
 * degerinin ICINE gomdu:
 *   …getChangeOrderByWfInstanceId/?wfInstanceId=%2FChangeManagement%2F…%2F0%2F&count=100…
 * Servis bunu ayristiramayip HTTP 400 + "Request Error" donduruyordu. Adres mesaja
 * yazilmasaydi bu tek bakista gorulemezdi.
 *
 * COZUM: ayarin YOL ve SORGU kismina guvenilmez. Servis koku `.svc` segmentine kadar
 * kesilir; ayarda `.svc` yoksa yalniz origin alinir ve tam yol eklenir. Iki durumda da
 * kullanicinin tarayicida calistirdigi adresin AYNISI uretilir.
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
  // Kullanicinin verdigi cagrilardaki suzgecler: -1 = "hepsi".
  if (rol === 'acan') u.searchParams.set('pcabRequired', '-1');
  u.searchParams.set('isAgentPatch', '-1');
  u.searchParams.set('changeEnvironment', '-1');
  u.searchParams.set('parameterChange', '-1');
  u.searchParams.set(rol === 'acan' ? 'openningGroupId' : 'responsibleGroupId', String(groupId));
  return u.toString();
}

/**
 * Arama ucunun HTTP hatasini anlatir.
 *
 * NEDEN AYRI BIR FONKSIYON: burada client.cjs'in `describeUpstreamError`'i kullaniliyordu.
 * O metinler TEK BIR OCO KAYDI ceken uc icin yazilmis; 400 alinca "…numarasini kabul
 * etmedi, numarayi kontrol edin" diyor. Arama ucunda kullaniciya gosterilen sayi ise OCO
 * numarasi degil GRUP KIMLIGI (6203) ve kullanicinin onu "kontrol etmesi" hicbir ise
 * yaramiyor — mesaj, yanlis yere bakmayi ogutluyordu (kullanici bildirimi, 2026-09-28).
 *
 * CAGRILAN ADRES MESAJA YAZILIR: bu ucta sorunun iki apayri kaynagi var ve ikisi de ayni
 * HTTP kodunu uretiyor — (a) OCO_API_URL yanlis/eksik girilmis, (b) adres dogru ama servis
 * istegi reddediyor. Adres gorunmeden ikisi ayirt edilemiyordu; tarayicida ayni adresi
 * acmak farki bir bakista gosteriyor.
 */
function aramaHatasi(statusCode, text, url, grup) {
  const { upstreamHint } = require('./client.cjs');
  const ipucu = upstreamHint(text);
  const ek = ipucu ? ` Servis notu: ${ipucu}` : '';
  const nerede = ` Çağrılan adres: ${url}`;
  // Sunucu gunlugune HAM govdenin basi da duser: ekrana tasinmayan WCF/IIS hata
  // sayfalarinda sebep cogu zaman burada yaziyor.
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
 * @returns {Promise<{ rows: object[], total: number, fetched: number, truncated: boolean,
 *   kaynak: object, eksik: {rol: string, message: string}[] }>}
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
