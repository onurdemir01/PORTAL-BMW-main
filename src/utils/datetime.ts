// src/utils/datetime.ts — TEK tarih/saat bicimlendirme kaynagi.
//
// SORUN: repoda ALTI ayri `formatDate`/`fmt` kopyasi ve 33 ciplak
// `toLocaleString("tr-TR")` cagrisi vardi. Kopyalar birbirinden SESSIZCE
// AYRILMISTI:
//   * bos deger  -> kimi "-", kimi "—", kimi hic bir sey
//   * gecersiz tarih -> kimi ham ISO metnini, kimi "Invalid Date" gosteriyordu
//   * SAAT DILIMI -> AuditLogTab `Europe/Istanbul`a SABITLIYOR, digerleri
//     tarayicinin yerel dilimini kullaniyordu
//
// Sonuncusu yalnizca tutarsizlik degil, DOGRULUK sorunu: baska bir saat diliminde
// duran bir makineden bakildiginda AYNI OLAY, denetim kaydinda bir saat, is
// gecmisinde baska bir saat gosteriyordu. Bir operasyon portalinda "olay ne zaman
// oldu" sorusunun ekrana gore degismesi kabul edilemez.
//
// KARAR: saat dilimi HER YERDE sunucularin dilimine sabitlenir. Bu portal Turkiye'deki
// altyapiyi yonetiyor; log satirlari, AWX job zamanlari ve OCO pencereleri hep o
// dilimde. Kullanicinin dizustunun nerede oldugu bu sorunun cevabini degistirmemeli.
// Degistirmek gerekirse tek satir: asagidaki PORTAL_TZ.
export const PORTAL_TZ = "Europe/Istanbul";
const LOCALE = "tr-TR";

/** Bos/gecersiz degerlerde gosterilen isaret. Tek yerde: kimi ekran "-", kimi "—"
 *  gosteriyordu ve tablolar hizasiz duruyordu. */
export const EMPTY_MARK = "—";

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Yalnizca tarih: 27.08.2026 */
export function fmtDate(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return EMPTY_MARK;
  return d.toLocaleDateString(LOCALE, {
    timeZone: PORTAL_TZ, day: "2-digit", month: "2-digit", year: "numeric",
  });
}

/** Tarih + saat: 27.08.2026 14:05 — tablolarda varsayilan. Saniye BILEREK yok:
 *  liste ekranlarinda gurultu yapiyor ve kolon genisligini sisiriyordu. */
export function fmtDateTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return EMPTY_MARK;
  return d.toLocaleString(LOCALE, {
    timeZone: PORTAL_TZ, day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/** Saniyeli surum — denetim/teshis icin: iki olayin sirasi saniyeye bagli olabilir. */
export function fmtDateTimeSeconds(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return EMPTY_MARK;
  return d.toLocaleString(LOCALE, {
    timeZone: PORTAL_TZ, day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

/** "2 saat önce" — mutlak tarihten daha hizli okunur, "en guncel hangisi" sorusunu
 *  tek bakista cevaplar. Mutlak deger `title` olarak verilmeli. */
export function fmtRelative(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "";
  const diff = Date.now() - d.getTime();
  if (diff < 0) return "az sonra";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "az önce";
  if (min < 60) return `${min} dk önce`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} saat önce`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} gün önce`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} ay önce`;
  return `${Math.floor(mo / 12)} yıl önce`;
}
