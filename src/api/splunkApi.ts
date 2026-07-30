import { safeJson } from "./http";
// src/api/splunkApi.ts — Splunk REST API proxy client
//
// dynatraceApi.ts ile aynı şekli takip eder (health/friendly-error deseni).
const BASE = '/api/splunk';

export interface SplunkHealth {
  ok: boolean;
  configured: boolean;
  reachable?: boolean;
  message?: string;
}

export interface SplunkSearchResult {
  ok: boolean;
  source?: string;
  eventCount?: number;
  sample?: string[];
  query?: string;
  message?: string;
}

const NETWORK_ERROR_PATTERNS = /fetch failed|timeout|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i;
export function friendlySplunkError(rawMessage?: string): string {
  if (!rawMessage) return 'Splunk sunucusuna ulaşılamadı.';
  if (NETWORK_ERROR_PATTERNS.test(rawMessage)) {
    return 'Splunk sunucusuna ulaşılamıyor (ağ/VPN erişimi veya port 8089 kontrol edilmeli).';
  }
  return rawMessage;
}

export const splunkApi = {
  health: (): Promise<SplunkHealth> => fetch(`${BASE}/health`).then(safeJson),

  products: (): Promise<{ ok: boolean; products?: string[]; message?: string }> =>
    fetch(`${BASE}/products`).then(safeJson),

  search: (opts: { product: string; windowMinutes?: number; refresh?: boolean }): Promise<SplunkSearchResult> => {
    const qs = new URLSearchParams({ product: opts.product });
    if (opts.windowMinutes) qs.set('windowMinutes', String(opts.windowMinutes));
    if (opts.refresh) qs.set('refresh', '1');
    return fetch(`${BASE}/search?${qs}`).then(safeJson);
  },
};
