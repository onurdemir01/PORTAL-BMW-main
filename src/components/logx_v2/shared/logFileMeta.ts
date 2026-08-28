// src/components/logx_v2/shared/logFileMeta.ts — log dosyasi ust verisi: ZAMAN, TIP ve
// SECIM SINIRLARI. Sunucu tarafindaki karsiligi server/logx/v2/legacy.cjs'tir; sinir
// sabitleri IKI TARAFTA DA ayni gerekceyle turetilir.

// ── ZAMAN (D1) ───────────────────────────────────────────────────────────────
// SORUN: `mtime` tip tanimda vardi ama HIC KULLANILMIYORDU — liste keşif sirasindaydi,
// yani "en guncel log" ekranin ortasinda ya da altinda kalabiliyordu. Ustelik tip
// YANLISTI: `string` yaziyordu, oysa `ansible.builtin.find` epoch **sayi** dondurur
// (FileX ayni alani `number` olarak dogru yazmis — src/api/filexApi.ts).
//
// Bu yuzden normalize edici HER BICIMI kabul eder: saniye epoch, milisaniye epoch,
// ISO metin, sayi-metin. Hicbiri yoksa DOSYA ADINDAKI tarihe duser
// (`SystemOut_25.08.27.log`, `app-2026-08-27.log`, `server.log.20260827` gibi
// uretimde gercekten gorulen kaliplar).
export function normalizeMtime(mtime: unknown, path?: string): number | null {
  const fromValue = parseMtimeValue(mtime);
  if (fromValue !== null) return fromValue;
  return path ? parseDateFromFilename(path) : null;
}

function parseMtimeValue(mtime: unknown): number | null {
  if (mtime === null || mtime === undefined || mtime === "") return null;

  if (typeof mtime === "number" && Number.isFinite(mtime)) return epochToMs(mtime);

  if (typeof mtime === "string") {
    const t = mtime.trim();
    if (!t) return null;
    // Saf sayi metni: "1756300000" ya da "1756300000.5" — epoch, ISO degil.
    if (/^-?\d+(\.\d+)?$/.test(t)) return epochToMs(Number(t));
    const parsed = Date.parse(t);           // ISO 8601 ve benzerleri
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

// Saniye mi milisaniye mi? Esik olarak 10^11 kullanilir: bu deger saniye olarak
// yorumlandiginda MS 5138 yilidir, milisaniye olarak 1973. Yani 10^11'in altindaki
// her sey saniye, ustundeki her sey milisaniyedir — belirsizlik yok.
function epochToMs(n: number): number | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e11 ? n * 1000 : n;
}

// Dosya adindaki tarih — `mtime` hic gelmediginde tek ipucu bu.
// Desteklenen kaliplar (uretimde gorulenler):
//   SystemOut_25.08.27.log        -> YY.AA.GG
//   app-2026-08-27.log            -> YYYY-AA-GG
//   server.log.20260827           -> YYYYAAGG
//   audit_2026_08_27_14.log       -> YYYY_AA_GG
export function parseDateFromFilename(path: string): number | null {
  const name = path.slice(path.lastIndexOf("/") + 1);

  let m = name.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/);
  if (m) return safeUtc(Number(m[1]), Number(m[2]), Number(m[3]));

  // Iki haneli yil: yalnizca ayirici ILE kabul edilir. Ayiricisiz "250827" gibi bir
  // dizi, dosya adindaki herhangi bir sayiyla karisirdi.
  m = name.match(/(?:^|[^0-9])(\d{2})[-_.](\d{2})[-_.](\d{2})(?:[^0-9]|$)/);
  if (m) return safeUtc(2000 + Number(m[1]), Number(m[2]), Number(m[3]));

  return null;
}

function safeUtc(y: number, mo: number, d: number): number | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  return Number.isFinite(ms) ? ms : null;
}

// ZAMAN METNI ORTAK MODULDE (2026-08-28): `fmtRelative` / `fmtDateTime`
// src/utils/datetime.ts icindedir. Burada YENIDEN yazilmasi, repodaki alti ayri
// tarih bicimlendirme kopyasindan biri olmak demekti; o kopyalar birbirinden
// sessizce ayrilmisti (bos deger isareti, gecersiz tarih davranisi, SAAT DILIMI).
// Bu dosya artik yalnizca LOG'A OZEL olani tutar: mtime normalize etme ve log tipi.

// ── LOG TIPI ─────────────────────────────────────────────────────────────────
// Dosya adindan kaba bir tip cikarilir. Amac siniflandirma degil, GOZLE TARAMA:
// 200 dosyalik bir listede "hangisi hata logu" sorusunun cevabi renkli bir rozetle
// bir bakista gorulsun. (Yoldan sinyal turetmenin calisan ornegi zaten var —
// server/logx/v2/legacy.cjs ortam cikarimi.)
export type LogKind = "error" | "access" | "gc" | "audit" | "output" | "trace" | "archive" | "other";

const KIND_RULES: { kind: LogKind; re: RegExp }[] = [
  { kind: "archive", re: /\.(gz|zip|bz2|xz|[0-9]+)$/i },
  { kind: "error",   re: /(err|error|stderr|systemerr|fatal|exception)/i },
  { kind: "gc",      re: /(^|[^a-z])gc([^a-z]|$)|garbage/i },
  { kind: "access",  re: /(access|request|http)/i },
  { kind: "audit",   re: /(audit|security|auth)/i },
  { kind: "trace",   re: /(trace|debug|verbose)/i },
  { kind: "output",  re: /(systemout|stdout|server|console|app|out)/i },
];

export function logKind(path: string): LogKind {
  const name = path.slice(path.lastIndexOf("/") + 1);
  for (const r of KIND_RULES) if (r.re.test(name)) return r.kind;
  return "other";
}

export const KIND_LABEL: Record<LogKind, string> = {
  error: "hata", access: "erişim", gc: "GC", audit: "denetim",
  output: "çıktı", trace: "izleme", archive: "arşiv", other: "diğer",
};

// Rozet renkleri token uzerinden: koyu temada da dogru calisir.
export const KIND_CLASS: Record<LogKind, string> = {
  error:   "bg-[var(--status-danger-bg)] text-[var(--status-danger)]",
  access:  "bg-[var(--status-info-bg)] text-[var(--accent)]",
  gc:      "bg-[var(--bg-elevated)] text-[var(--text-secondary)]",
  audit:   "bg-[var(--status-warning-bg)] text-[var(--status-warning)]",
  output:  "bg-[var(--bg-elevated)] text-[var(--text-secondary)]",
  trace:   "bg-[var(--bg-elevated)] text-[var(--text-muted)]",
  archive: "bg-[var(--bg-elevated)] text-[var(--text-muted)]",
  other:   "bg-[var(--bg-elevated)] text-[var(--text-muted)]",
};

// ── SECIM SINIRI (D3) ────────────────────────────────────────────────────────
// Legacy transferde HICBIR ust sinir yoktu ama GERCEK bir tavan vardi ve fark
// edilmeden carpiliyordu: istek govdesi `express.json({ limit: "2mb" })` parser'indan
// geciyor. Secim buyudugunde istek handler'a HIC ULASMIYOR, body-parser 413 firlatiyor
// ve kullanici yalnizca "transfer basarisiz" goruyordu.
//
// Esik UYDURULMADI: gonderilecek govdenin `selected` kismi GERCEKTEN olculur ve ayni
// turetilmis sinirla karsilastirilir. Sunucu da ayni hesabi yapar
// (server/logx/v2/legacy.cjs TRANSFER_SELECTION_MAX_BYTES).
export const EXPRESS_JSON_LIMIT_BYTES = 2 * 1024 * 1024;
export const SELECTION_MAX_BYTES = Math.floor(EXPRESS_JSON_LIMIT_BYTES / 2);

export function selectionPayloadBytes(selected: { host: string; path: string }[]): number {
  // Sunucunun olctugu seyin AYNISI: `selected` dizisinin JSON gosterimi.
  return new Blob([JSON.stringify(selected)]).size;
}

export type SelectionPressure = "ok" | "warn" | "danger" | "over";

// Kademeli uyari: sessizce sinira dayanip 400 yemek yerine kullanici yaklastigini
// GORUR. Esikler sinirin kesirleridir — sabit dosya sayisi degil, cunku dosya
// yollarinin uzunlugu kuruluma gore cok degisir.
export function selectionPressure(bytes: number): SelectionPressure {
  const r = bytes / SELECTION_MAX_BYTES;
  if (r > 1) return "over";
  if (r > 0.9) return "danger";
  if (r > 0.6) return "warn";
  return "ok";
}

export function fmtSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes, i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
