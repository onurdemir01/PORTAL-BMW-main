// src/utils/url.ts

/**
 * Dış link normalize eder:
 * - boşsa: ""
 * - "google.com" -> "https://google.com"
 * - "http://x" / "https://x" -> aynı döner
 * - "//x" -> "https://x"
 * - javascript:, data:, vb. -> "" (güvenlik)
 */
export function normalizeExternalUrl(raw: string): string {
  const v = String(raw || "").trim();
  if (!v) return "";

  const lower = v.toLowerCase();

  // güvenlik: asla izin verme
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:")
  ) {
    return "";
  }

  // protocol-relative
  if (v.startsWith("//")) return `https:${v}`;

  // zaten http/https ise aynen
  if (lower.startsWith("http://") || lower.startsWith("https://")) return v;

  // geri kalan her şeyi https ile tamamla
  return `https://${v}`;
}

// ✅ Eski component importları için alias
export const normalizeUrl = normalizeExternalUrl;

export function openExternalUrl(raw: string) {
  const url = normalizeExternalUrl(raw);
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}