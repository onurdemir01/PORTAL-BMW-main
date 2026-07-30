// src/utils/statusColor.ts — durum/severity metinlerini tek bir semantik palete indirger.
//
// Dynatrace severityLevel, Instana status/severity, Splunk log level gibi farkli
// kaynaklardan gelen string'ler BU tek fonksiyonla PatternFly Label renklerine eslenir
// (bkz. index.css .pf-label--* siniflari). Bilinmeyen deger icin fail-open: "neutral".
export type StatusLevel = "critical" | "error" | "warning" | "info" | "success" | "neutral";

const KEYWORD_MAP: [RegExp, StatusLevel][] = [
  [/critical|fatal|down|unavailable|outage/i, "critical"],
  [/error|fail(ed|ure)?|exception|oomkilled|crash/i, "error"],
  [/warn(ing)?|degrad|resource_contention|slow/i, "warning"],
  [/info|custom_info|notice/i, "info"],
  [/success|ok|healthy|resolved|closed|active/i, "success"],
];

export function statusColor(input: string | null | undefined): StatusLevel {
  const s = String(input || "").trim();
  if (!s) return "neutral";
  for (const [re, level] of KEYWORD_MAP) {
    if (re.test(s)) return level;
  }
  return "neutral";
}

// PatternFly Label varyantlari — Tailwind renk siniflari yerine index.css'teki
// .pf-label--* siniflari (cerceve + acik zemin + koyu metin) kullanilir.
export function statusClasses(level: StatusLevel): string {
  const MAP: Record<StatusLevel, string> = {
    critical: "pf-label--red",
    error:    "pf-label--red",
    warning:  "pf-label--gold",
    info:     "pf-label--blue",
    success:  "pf-label--green",
    neutral:  "pf-label--grey",
  };
  return MAP[level];
}
