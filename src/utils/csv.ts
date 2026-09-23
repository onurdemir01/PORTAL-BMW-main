// src/utils/csv.ts — tek CSV dışa aktarma yardımcısı.
//
// NEDEN VAR
// ─────────
// Aynı 8-10 satır portalda **20'den fazla** ekranda yeniden yazılmıştı
// (`denetim/*`, `admin/tabs/*`, `envanter/*`, `nginx_console/*`, `server_hub/*`).
// Fiilî imza zaten ortaktı — `(name, header, rows)` — ama ayrıntılar ayrışmıştı:
//
//   ayırıcı     : `denetim/*` virgül, yeni modüller noktalı virgül
//   BOM         : kimi dosya gorunmez literal karakter, kimi U+FEFF kacisi
//   satır sonu  : `\n` ↔ `\r\n`
//
// ── AYIRICI SABİT DEĞİL, KULLANICI TERCİHİ ──────────────────────────────────
// Ayırıcı portalda ikiye bölünmüştü: `denetim/` içinde bile 6 ekran virgül,
// 5 ekran noktalı virgül kullanıyordu. Birini seçip hepsini ona çevirmek
// **kullanıcının indirdiği dosyanın biçimini değiştirmek** demekti ve iki
// meşru ihtiyaç var:
//
//   * Türkçe yerel ayarlı Excel liste ayırıcısı olarak `;` bekler; virgüllü
//     dosyayı tek sütuna doldurur → "portal bozuk CSV veriyor".
//   * Dosyayı bir script/araca besleyen için RFC 4180 virgülü doğru olan.
//
// Bu yüzden ayırıcı **kullanıcı başına** bir tercih (`csv_separator`,
// `portal_user_preferences`). Varsayılan `;` — portalın kullanıcıları Excel'de
// açıyor. Tercih okunamazsa (DB yok, oturum yok) varsayılana düşer; CSV
// indirmek asla bir tercih okumasına BAĞIMLI olmamalı.
//
// KAÇIŞ: her hücre tırnaklanır ve içindeki `"` ikilenir (RFC 4180). Böylece
// ayırıcı, satır sonu ve tırnak içeren değerler bozulmadan geçer — hücreden
// ayırıcıyı "temizlemek" veriyi sessizce değiştirmek olurdu.

/**
 * Excel'in dosyayi UTF-8 sayabilmesi icin gereken bayt-sirasi isareti.
 *
 * KACIS DIZISI OLARAK yazilir: kaynakta GORUNMEZ bir karakter tasimak, bu
 * dosyanin kapatmak istedigi tutarsizligin ta kendisidir (kimi ekran literal
 * karakter, kimi kacis kullaniyordu) ve ESLint `no-irregular-whitespace`
 * uyarisi verir.
 */
const BOM = '\uFEFF';

import { prefsApi } from '@/api/prefsApi';

/** Tercih anahtarı — `portal_user_preferences`. */
export const CSV_SEPARATOR_PREF = 'csv_separator';

/** Desteklenen ayırıcılar. Serbest metin KABUL EDİLMEZ: bir harf ya da tırnak
 *  ayırıcı olarak yazılırsa üretilen dosya sessizce bozulurdu. */
export const CSV_SEPARATORS = [';', ','] as const;
export type CsvSeparator = (typeof CSV_SEPARATORS)[number];

const VARSAYILAN_AYIRICI: CsvSeparator = ';';

/**
 * Kullanıcının seçtiği ayırıcı. Tercih yoksa/geçersizse varsayılana düşer —
 * CSV indirmek bir tercih okumasına BAĞIMLI olmamalı.
 */
export function csvSeparator(): CsvSeparator {
  try {
    const v = prefsApi.get(CSV_SEPARATOR_PREF);
    return (CSV_SEPARATORS as readonly string[]).includes(v || '')
      ? (v as CsvSeparator)
      : VARSAYILAN_AYIRICI;
  } catch {
    return VARSAYILAN_AYIRICI;
  }
}

export interface CsvOptions {
  /**
   * Liste ayırıcı. VERİLMEZSE kullanıcının tercihi okunur — çağıran tarafın
   * sabit bir değer yazması, tercihi işlevsiz kılardı.
   */
  separator?: string;
  /** Dosya adına tarih eklensin mi (`ad_2026-09-23.csv`). */
  withDate?: boolean;
}

/** Tek bir hücreyi RFC 4180'e göre kaçırır. `null`/`undefined` boş dizgedir. */
export function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

/** Satırları CSV metnine çevirir (indirme YOK — test edilebilir saf fonksiyon). */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly unknown[])[],
  { separator }: CsvOptions = {},
): string {
  const sep = separator ?? csvSeparator();
  return [header, ...rows].map((r) => r.map(csvCell).join(sep)).join('\r\n');
}

/**
 * CSV üretir ve tarayıcıya indirtir.
 *
 * BOM (U+FEFF) ZORUNLU: olmadan Excel dosyayı Windows-1252 sanır ve Türkçe
 * karakterler bozulur (ş → Å). Bu, kullanıcıya "portal bozuk veri veriyor"
 * dedirten klasik hata.
 */
export function downloadCsv(
  name: string,
  header: readonly string[],
  rows: readonly (readonly unknown[])[],
  opts: CsvOptions = {},
): void {
  const { withDate = true } = opts;
  const body = toCsv(header, rows, opts);
  const blob = new Blob([BOM + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = withDate ? `${name}_${new Date().toISOString().slice(0, 10)}.csv` : `${name}.csv`;
    a.click();
  } finally {
    // SIZINTIYI ONLE: `createObjectURL` revoke edilmezse blob sekme kapanana
    // kadar bellekte kalir. Buyuk bir dokum + tekrarlanan indirme = sessiz sisme.
    URL.revokeObjectURL(url);
  }
}
