// src/utils/url.ts

/** Allowed URL schemes for outbound links opened from the portal UI. */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** Reject ASCII C0 control characters and DEL inside raw URL input. */
function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Normalizes a user/inventory-supplied external URL and enforces strict
 * `http:` / `https:` protocol allowlisting via the WHATWG URL parser:
 * - empty or control characters: `""`
 * - "google.com" or "//x" -> "https://google.com/", "https://x/"
 * - "http://x" / "https://x" -> validated http/https URL
 * - javascript:, data:, vbscript:, file:, etc. -> `""`
 */
export function normalizeExternalUrl(raw: string): string {
  const v = String(raw || "").trim();
  if (!v || hasControlChars(v)) return "";

  let candidate: string;
  if (v.startsWith("//")) {
    candidate = `https:${v}`;
  } else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v)) {
    candidate = v;
  } else {
    candidate = `https://${v}`;
  }

  try {
    const parsed = new URL(candidate);
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol) || !parsed.hostname) return "";
    return parsed.href;
  } catch {
    return "";
  }
}

// ✅ Eski component importları için alias
export const normalizeUrl = normalizeExternalUrl;

export function openExternalUrl(raw: string) {
  const url = normalizeExternalUrl(raw);
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}