// server/oco/diagnose.cjs — "bir OCO numarasi girince NE geliyor, portal NEYI okuyor?"
//
// NEDEN VAR
// ─────────
// Portal, OCO servisinin dondurdugu govdeden YALNIZCA UC SEY okuyor:
//   1) kayit var mi              (client.cjs — `Result` bos degil mi)
//   2) planlanan kesinti saatleri(window.cjs — Planned* / PlannedInterruption.*)
//   3) baslik                    (change-gates.cjs — OcoWfIdSubject | Subject)
//
// Onay durumu, OCO statusu, hedef sistemler, talep eden... HICBIRI OKUNMUYOR.
// Yani bugunku "OCO kontrolu" gercekte bir TAKVIM KONTROLUDUR; "bu OCO onayli
// mi?" ya da "bu kayit bu sisteme mi ait?" hic sorulmuyor.
//
// Bu modul o gercegi GORUNUR yapar: bir numara girilir, servisin dondurdugu HER
// alan listelenir ve her biri "OKUNUYOR" / "YOK SAYILIYOR" diye isaretlenir.
// Amac, alan kurallarini TAHMINLE degil GERCEK CIKTIYLA yazabilmek.
//
// HICBIR SEY BASLATMAZ. Salt okunurdur.
'use strict';

const { evaluateWindow, extractPlannedInterruption } = require('./window.cjs');

/**
 * Portalin GERCEKTEN okudugu alanlar — TEK KAYNAK.
 *
 * Bu liste ile kodun ayrismasi, ekranin YALAN soylemesi demek olurdu ("bu alan
 * okunuyor" yazar, kod okumaz). `__tests__/oco-diagnose.test.cjs` her girdinin
 * ilgili dosyada GERCEKTEN geciyor olmasini zorunlu kiliyor.
 */
const READ_FIELDS = Object.freeze([
  {
    path: 'GetChangeOrderByWfInstanceIdResult.ResultCode',
    reader: 'client.cjs',
    why: 'Servis sonuc kodu — kayit bulunamadiginda mesajla birlikte doner.',
  },
  {
    path: 'GetChangeOrderByWfInstanceIdResult.Result',
    reader: 'client.cjs',
    why: 'Bos ise "kayit bulunamadi" sayilir ve is BASLATILMAZ.',
  },
  {
    path: 'GetChangeOrderByWfInstanceIdResult.Result.PlannedStartDate',
    reader: 'window.cjs',
    why: 'Kesinti penceresinin BASLANGICI (birincil kaynak).',
  },
  {
    path: 'GetChangeOrderByWfInstanceIdResult.Result.PlannedEndDate',
    reader: 'window.cjs',
    why: 'Kesinti penceresinin BITISI (birincil kaynak).',
  },
  {
    path: 'GetChangeOrderByWfInstanceIdResult.Result.PlannedInterruption.InterruptionStartDate',
    reader: 'window.cjs',
    why: 'Planned* yoksa YEDEK baslangic.',
  },
  {
    path: 'GetChangeOrderByWfInstanceIdResult.Result.PlannedInterruption.InterruptionEndDate',
    reader: 'window.cjs',
    why: 'Planned* yoksa YEDEK bitis.',
  },
  {
    path: 'GetChangeOrderByWfInstanceIdResult.Result.OcoWfIdSubject',
    reader: 'change-gates.cjs',
    why: 'SMART kaydina ve denetime yazilan baslik (birincil).',
  },
  {
    path: 'GetChangeOrderByWfInstanceIdResult.Result.Subject',
    reader: 'change-gates.cjs',
    why: 'Baslik icin YEDEK alan.',
  },
]);

const READ_SET = new Set(READ_FIELDS.map((f) => f.path));

/** Gezilecek en fazla alan — bozuk/dev bir govde tani ekranini bogmasin. */
const MAX_FIELDS = 500;
/** Tek bir degerin ekranda gosterilecek en fazla uzunlugu. */
const MAX_VALUE_LEN = 300;

function kisalt(v) {
  if (v === null) return { type: 'null', value: null };
  if (Array.isArray(v)) return { type: 'array', value: `[${v.length} oge]` };
  if (typeof v === 'object') return { type: 'object', value: '{…}' };
  const s = String(v);
  return {
    type: typeof v,
    value: s.length > MAX_VALUE_LEN ? `${s.slice(0, MAX_VALUE_LEN)}…` : s,
    truncated: s.length > MAX_VALUE_LEN,
  };
}

/**
 * Govdeyi gezer ve HER yaprak alani "okunuyor mu" bilgisiyle dondurur.
 *
 * Neden statik bir liste degil de GEZINTI: amac tam olarak "bizim BILMEDIGIMIZ
 * hangi alanlar geliyor" sorusunu cevaplamak. Sabit bir liste yalnizca zaten
 * bildiklerimizi gosterirdi ve ekran bir kesif araci olmaktan cikardi.
 */
function walkFields(payload) {
  const out = [];
  let kirpildi = false;
  const gez = (node, prefix) => {
    if (out.length >= MAX_FIELDS) {
      kirpildi = true;
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (out.length >= MAX_FIELDS) {
        kirpildi = true;
        return;
      }
      const path = prefix ? `${prefix}.${k}` : k;
      const bilgi = kisalt(v);
      out.push({
        path,
        ...bilgi,
        read: READ_SET.has(path),
        // Dizilerin ICINE girilmez: bir OCO kaydinda dizi alanlari (CI listesi,
        // onay adimlari) onlarca oge tasiyabilir ve ekrani okunmaz hale getirir.
        // Uzunluk gosterilir; icerigi gerekirse ham JSON'dan bakilir.
      });
      if (v && typeof v === 'object' && !Array.isArray(v)) gez(v, path);
    }
  };
  gez(payload, '');
  return { fields: out, truncated: kirpildi };
}

/**
 * Bir OCO yanitini TANILAR. Hicbir sey baslatmaz, hicbir sey kaydetmez.
 *
 * @param {object} order `client.getChangeOrder` sonucu `{ payload, result, resultCode }`
 * @param {Date}   now   pencere karari bu ana gore verilir (test edilebilirlik)
 */
function diagnose(order, now = new Date()) {
  const { fields, truncated } = walkFields(order?.payload ?? {});

  const planned = extractPlannedInterruption(order?.payload ?? {});
  const window = planned
    ? evaluateWindow({ startDate: planned.startDate, endDate: planned.endDate, now })
    : null;

  // Beklenen ama GELMEYEN alanlar: portalin okudugu bir alan yanitta yoksa
  // bu, kapinin neden "calismadiginin" dogrudan cevabi olabilir.
  const mevcut = new Set(fields.map((f) => f.path));
  const missing = READ_FIELDS.filter((f) => !mevcut.has(f.path));

  return {
    // Portalin NE OKUDUGU — koddaki tek kaynak.
    readFields: READ_FIELDS,
    // Yanitta GERCEKTEN ne geldi, hangisi okunuyor hangisi yok sayiliyor.
    fields,
    fieldsTruncated: truncated,
    ignoredCount: fields.filter((f) => !f.read && f.type !== 'object').length,
    missing,
    // Pencere karari.
    plannedSource: planned ? planned.source : null,
    window,
    resultCode: order?.resultCode ?? null,
  };
}

/**
 * "Bu numarayla su kapsamda `apply` denesen ne olurdu?" — SIMULASYON.
 *
 * Gercek kapiyi cagirmaz (o AWX isi acabilir, SMART kaydi yaratabilir); kapinin
 * KARAR AGACINI birebir tekrarlar. Agac `change-gates.evaluateOcoGate` icindedir
 * ve bekci `oco-diagnose.test.cjs` ikisinin ayni sirada kalmasini zorluyor.
 */
function simulateGate({ diagnosis, ocoApplies }) {
  if (!ocoApplies) {
    return { outcome: 'skip', message: 'Bu kapsamda OCO kapisi uygulanmiyor — numara sorulmaz.' };
  }
  if (!diagnosis.window) {
    return {
      outcome: 'error',
      message: 'Kayitta planlanan kesinti tarihi YOK — is BASLATILMAZ.',
    };
  }
  if (!diagnosis.window.ok) {
    return {
      outcome: 'error',
      message: `Pencere okunamadi (${diagnosis.window.reason || 'bilinmiyor'}) — is BASLATILMAZ.`,
    };
  }
  if (diagnosis.window.phase === 'expired') {
    return { outcome: 'error', message: 'Pencere KAPANMIS — is BASLATILMAZ.' };
  }
  if (diagnosis.window.phase === 'before') {
    return {
      outcome: 'deferred',
      message: `Pencere HENUZ ACILMADI (${diagnosis.window.windowStartText}) — is simdi baslatilmaz.`,
    };
  }
  return { outcome: 'proceed', message: 'Pencere ACIK — is normal akisina devam eder.' };
}

module.exports = { diagnose, simulateGate, walkFields, READ_FIELDS, MAX_FIELDS, MAX_VALUE_LEN };
