// server/smart/yeniden-tetikle.cjs - ZAMAN ASIMINA DUSMUS TALEBI ADMIN YENIDEN TETIKLER (2026-11-11).
//
// Kullanici: "bazi kayitlar onaylanmadigi icin zaman asimina ugruyor; admin olarak destek saglayip
// zaman asimina ugrayan kayitlari tetikletmek istiyorum."
//
// KARARLAR (kullanici, 2026-11-11):
//   * SMART: once Smart'taki kayda bakilir. REDDEDILDIYSE tetiklenmez. Onay yoksa admin gerekce
//     yazarak atlar (admin-smart-atla ile ayni denetim izi). Smart sorgusu BASARISIZSA tetiklenmez
//     (fail-closed): reddedilmis bir kaydi onaysiz sanip prod'a dokunmamak icin.
//   * OCO: kesinti penceresi zaten kapanmistir. Iki yol:
//       'oco'         -> admin YENI bir OCO numarasi girer; pencere acikse is hemen, henuz
//                        acilmadiysa pencere basina AWX'te zamanlanir, gecmisse reddedilir.
//       'pencereDisi' -> admin ayri bir onay kutusu + gerekce ile pencere disinda HEMEN kosturur.
//     OCO'suz talep (genel sure siniri / OpsX islem kurali) 'dogrudan' kosar.
//   * Yalniz TIMEOUT durumundaki talep. Crypto Hub node bileti (sifreli deger + kendi pencere
//     kancasi) bu yoldan TETIKLENMEZ.
// Bu dosya saf karar mantigidir (DB / ag yok); rota runner.cjs'te.
'use strict';

const NOT_EN_AZ = 10;
const NOT_EN_COK = 1000;

/** Talep bir OCO kesinti penceresine bagli mi? (pencere alanlari ya da gonderilen oco_number) */
function ocoKapsamli(ticket) {
  const pl = ticket?.pendingLaunch || {};
  if (pl.ocoWindowStartIso || pl.ocoWindowEndIso || pl.ocoRecordId) return true;
  const ev = pl.extraVars || {};
  return String(ev.oco_number ?? '').trim() !== '';
}

/** Bu talep yeniden tetiklenebilir mi? { ok, message } */
function uygunluk(ticket) {
  if (!ticket) return { ok: false, status: 404, message: 'Talep bulunamadı.' };
  if (ticket.status !== 'TIMEOUT') {
    return { ok: false, status: 409, message: `Yalnız zaman aşımına uğramış talep yeniden tetiklenebilir (durum: ${ticket.status}).` };
  }
  const pl = ticket.pendingLaunch;
  if (!pl || typeof pl !== 'object' || !pl.detail) {
    return { ok: false, status: 409, message: 'Talebin başlatma bilgisi kayıtlı değil; yeniden tetiklenemez. Kullanıcı yeni talep açmalı.' };
  }
  if (pl.launchOncesi) {
    return { ok: false, status: 409, message: 'Bu talep türü (Crypto Hub node) yeniden tetiklenemez; kendi ekranından yeni talep açılmalı.' };
  }
  return { ok: true };
}

/**
 * Smart durum sorgusunun sonucunu karara cevirir.
 * Girdi: { status } (client.checkTicketStatus donusu: completed/rejected/stateName/statusCode) ya da { hata }.
 * Donus: { durum: 'onayli'|'bekliyor'|'bilinmiyor'|'reddedildi'|'okunamadi', engel, stateName, statusCode, message }
 * DENETIM (2026-11-11 inceleme): eskiden "tamamlandi/reddedildi degil" olan HER kod 'bekliyor'
 * sayiliyordu (fail-open). Simdi: kod bos -> okunamadi (ENGEL); 2000 ya da adi iptal/red
 * cagristiran durum (kardes ekip "_CANCEL_" ile algiliyor) -> reddedildi (ENGEL); "50" -> bekliyor;
 * belgelenmemis baska bir kod -> 'bilinmiyor': ham kod + ad admin'e gosterilir ve denetime yazilir.
 * Bilinmeyeni ENGELLEMIYORUZ: kullanicinin ornek kaydi ("Calisiyor") belgelenmemis bir ara durum
 * ve tam da bu ozelligin kapsami; red/iptal adlari ayrica yakalaniyor.
 */
const RED_ADI = /cancel|reject|iptal|İptal|İPTAL|reddedil|REDDEDİL/i;
function smartKarari({ status, hata } = {}) {
  if (hata) {
    return {
      durum: 'okunamadi', engel: true, stateName: null, statusCode: null,
      message: `Smart kaydının durumu okunamadı (${hata}); reddedilmiş olabileceği için tetiklenmedi. Biraz sonra tekrar deneyin.`,
    };
  }
  const stateName = status?.stateName || null;
  const statusCode = String(status?.statusCode ?? '').trim() || null;
  if (status?.rejected || statusCode === '2000' || (stateName && RED_ADI.test(stateName))) {
    return { durum: 'reddedildi', engel: true, stateName, statusCode, message: 'Smart kaydı REDDEDİLMİŞ ya da İPTAL EDİLMİŞ; iş tetiklenmez.' };
  }
  if (status?.completed || statusCode === '1000') {
    return { durum: 'onayli', engel: false, stateName, statusCode, message: 'Smart kaydı sonradan onaylanmış.' };
  }
  if (!statusCode) {
    return { durum: 'okunamadi', engel: true, stateName, statusCode, message: 'Smart durum kodu boş döndü; reddedilmiş olabileceği için tetiklenmedi.' };
  }
  if (statusCode === '50') {
    return { durum: 'bekliyor', engel: false, stateName, statusCode, message: 'Smart onayı hâlâ yok; tetiklerseniz onay sizin gerekçenizle atlanır.' };
  }
  return {
    durum: 'bilinmiyor', engel: false, stateName, statusCode,
    message: `Smart belgelenmemiş bir durumda (kod ${statusCode}${stateName ? (", \"" + stateName + "\"") : ''}); onaylı değil. Tetiklerseniz onay sizin gerekçenizle atlanır.`,
  };
}

/**
 * Istek govdesini dogrular. Donus: { ok, mod, not, ocoNumber } ya da { ok:false, message }.
 * OCO'lu talepte mod 'oco' | 'pencereDisi' zorunlu; OCO'suz talepte mod her zaman 'dogrudan'.
 */
function istekDogrula(body, ticket) {
  const b = body && typeof body === 'object' ? body : {};
  const not = String(b.note ?? '').trim();
  if (not.length < NOT_EN_AZ) {
    return { ok: false, message: `Gerekçe zorunlu (en az ${NOT_EN_AZ} karakter): neden onaysız / pencere dışı tetiklendiği denetimde kalır.` };
  }
  if (not.length > NOT_EN_COK) return { ok: false, message: `Gerekçe en fazla ${NOT_EN_COK} karakter olabilir.` };
  if (!ocoKapsamli(ticket)) return { ok: true, mod: 'dogrudan', not, ocoNumber: '' };
  const mod = String(b.mode ?? '').trim();
  if (mod === 'oco') {
    const ocoNumber = String(b.ocoNumber ?? '').trim();
    if (!/^\d{4,12}$/.test(ocoNumber)) return { ok: false, message: 'Geçerli bir OCO numarası girin (yalnız rakam).' };
    const eski = String(ticket?.pendingLaunch?.extraVars?.oco_number ?? '').trim();
    if (eski && eski === ocoNumber) {
      return { ok: false, message: `OCO ${ocoNumber} talebin penceresi kapanmış kaydı; yeni bir OCO numarası girin ya da "pencere dışında çalıştır" seçin.` };
    }
    return { ok: true, mod, not, ocoNumber };
  }
  if (mod === 'pencereDisi') {
    if (b.outsideWindowConfirm !== true) {
      return { ok: false, message: 'Pencere dışında çalıştırmak için ayrıca onay kutusunu işaretleyin.' };
    }
    return { ok: true, mod, not, ocoNumber: '' };
  }
  return { ok: false, message: 'Bu talep bir OCO penceresine bağlı: yeni OCO numarası girin ya da "pencere dışında çalıştır" seçin.' };
}

/** extraVars kopyasina yeni OCO alanlarini yazar (kaynak nesneye dokunmaz). */
function yeniOcoDegiskenleri(extraVars, ocoNumber, w) {
  return {
    ...(extraVars || {}),
    oco_number: ocoNumber,
    oco_window_start: w?.windowStartText || '',
    oco_window_end: w?.windowEndText || '',
  };
}

const MOD_METNI = {
  dogrudan: 'hemen çalıştırıldı',
  oco: 'yeni OCO ile',
  pencereDisi: 'OCO penceresi DIŞINDA hemen çalıştırıldı',
};

/** Bilete yazilacak aciklama: kim, nasil, neden. */
function sonucMetni({ admin, mod, ocoNumber, smartDurum, not, zamanlandi }) {
  const nasil = (() => { if (mod === 'oco') return `yeni OCO ${ocoNumber} ile ${zamanlandi ? (String(zamanlandi) + " tarihine zamanlandı") : 'hemen çalıştırıldı'}`; return MOD_METNI[mod] || mod; })();
  const smart = smartDurum === 'onayli' ? 'Smart sonradan onaylamıştı' : 'Smart onayı admin tarafından atlandı';
  return `Zaman aşımından sonra admin ${admin} yeniden tetikledi: ${nasil}; ${smart}. Gerekçe: ${not}`.slice(0, 2000);
}

module.exports = { ocoKapsamli, uygunluk, smartKarari, istekDogrula, yeniOcoDegiskenleri, sonucMetni, NOT_EN_AZ };
