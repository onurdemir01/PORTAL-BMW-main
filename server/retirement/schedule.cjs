// server/retirement/schedule.cjs — Retirement zamanlama kurallari. SAF FONKSIYONLAR:
// ne ag ne DB dokunur, bu yuzden kural birebir test edilebilir.
//
// ── IKI AYRI ZAMANLAMA, IKI AYRI KURAL ──────────────────────────────────────────────
//
// 1. STOP — OCO KESINTI PENCERESI (kullanici karari 2026-10-06): "Production icin OCO
//    talebi girisi zorunlu olacak, OCO'daki tarih ve saate gore uygulama stop adimi
//    baslar." Onay verildiginde is HEMEN kosmaz; pencere acilinca poller tetikler.
//    Pencere hesabi `server/oco/window.cjs`tan gelir - ayni kural Self Service ve ScaleX
//    icin de gecerli, ikinci bir yorum yazilmaz.
//
// 2. DELETE — TARIH (ayni karar): "delete kismi icin ekstra talep olmaz, otomatik olarak
//    is scheduled edilir ve tarih geldiginde is yapilir." Tarih kaydin KENDISINDEN
//    turetilir: `planned_delete_at` verilmisse o, degilse `stop_at + delete_after_days`.
//    AYRI BIR ZAMANLAMA TABLOSU YOK - veri zaten kayitta; `oco_scheduled_launches`a
//    yazmak yanlis olurdu (o tablo `window_end` zorunlu tutuyor ve poller'i Self Service
//    yoluna oynatiyor).
'use strict';

/** Kaydin ETKIN silme gunu (YYYY-MM-DD) ya da null. Saf: girdiden baska hicbir sey okumaz.
 *
 * `planned_delete_at` ACANIN KESIN TARIHIDIR ve `delete_after_days`i EZER - kullanici
 * ekranda "...ya da kesin silme tarihi" diye ayri bir alan doldurdu, o alanin dolu olmasi
 * bilincli bir karardir.
 *
 * STOP HENUZ YAPILMADIYSA null: "stop + 45 gun" bir tarih vermez. Burada bugunu baslangic
 * saymak, hic durdurulmamis bir uygulamayi 45 gun sonra silmeye zamanlamak olurdu.
 */
function etkinSilmeGunu({ plannedDeleteAt, stopAt, deleteAfterDays }) {
  if (plannedDeleteAt) return new Date(plannedDeleteAt).toISOString().slice(0, 10);
  if (!stopAt) return null;
  // EKSIK DEGER "HEMEN SIL" DEMEK DEGIL. `Number(null)` ve `Number('')` SIFIR doner; o
  // yolla null bir `delete_after_days` "stop + 0 gun" = BUGUN silme anlamina geliyordu.
  // Sema NOT NULL DEFAULT 45 ama kod buna guvenmez: tek bir bozuk satir, hic beklemeden
  // silme tetiklerdi. Acik bir SAYI (ya da sayisal dizge) sart; 0 mesru bir degerdir
  // (ayni gun), null DEGILDIR. (Testle yakalandi: RZ4.)
  if (deleteAfterDays === null || deleteAfterDays === undefined || deleteAfterDays === '')
    return null;
  const gun = Number(deleteAfterDays);
  if (!Number.isFinite(gun) || gun < 0) return null;
  return new Date(new Date(stopAt).getTime() + gun * 86400000).toISOString().slice(0, 10);
}

/** Silme zamani GELDI mi? Gun bazinda karsilastirilir (saat yok: is o gun icinde kosar). */
function silmeZamaniGeldi({ plannedDeleteAt, stopAt, deleteAfterDays }, now = new Date()) {
  const g = etkinSilmeGunu({ plannedDeleteAt, stopAt, deleteAfterDays });
  if (!g) return false;
  return g <= new Date(now).toISOString().slice(0, 10);
}

/**
 * Zamanlanmis bir STOP SIMDI kosmali mi?
 *
 * UC DURUM VE UCU DE AYRI:
 *   'wait'    pencere henuz acilmadi -> bekle
 *   'run'     pencere acik -> kostur
 *   'expired' pencerenin SONU gecti -> is BASLATILMAZ. OCO kaydi kacirildi; sessizce
 *             kosturmak, onaylanmis olmayan bir saatte uretimi durdurmak olurdu.
 */
function stopZamani({ scheduledAt, windowEnd }, now = new Date()) {
  if (!scheduledAt) return { durum: 'wait', sebep: 'zamanlama yok' };
  const t = new Date(now).getTime();
  const basla = new Date(scheduledAt).getTime();
  const bitis = windowEnd ? new Date(windowEnd).getTime() : null;
  if (!Number.isFinite(basla)) return { durum: 'wait', sebep: 'zamanlama okunamadi' };
  if (bitis != null && Number.isFinite(bitis) && t > bitis)
    return {
      durum: 'expired',
      sebep:
        'OCO kesinti penceresi kapandi; STOP baslatilmadi. Yeni bir OCO kaydiyla tekrar ' +
        'planlayin.',
    };
  if (t < basla) return { durum: 'wait', sebep: 'kesinti penceresi henuz acilmadi' };
  return { durum: 'run', sebep: 'kesinti penceresi acik' };
}

module.exports = { etkinSilmeGunu, silmeZamaniGeldi, stopZamani };
