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
// ── AYIRICI NEDEN VARSAYILAN OLARAK `;` ─────────────────────────────────────
// Türkçe yerel ayarlı Excel liste ayırıcısı olarak `;` bekler; virgüllü bir
// dosyayı tek sütuna doldurur. Portalın en yeni ekranları bu yüzden `;`
// kullanıyor. Eski `denetim/*` dosyaları virgül kullanıyor ve onları çevirmek
// **kullanıcının indirdiği dosyanın biçimini değiştirmek** demek — bu ayrı bir
// karar, sessizce yapılmaz. Bu yüzden `separator` seçeneği var: eski ekranlar
// taşınırken kendi biçimlerini koruyabilir.
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

export interface CsvOptions {
  /** Liste ayırıcı. Türkçe Excel `;` bekler. */
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
  { separator = ';' }: CsvOptions = {},
): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(separator)).join('\r\n');
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
