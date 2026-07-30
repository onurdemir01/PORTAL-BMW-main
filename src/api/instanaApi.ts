import { safeJson } from "./http";
const BASE = '/api/instana';

export type InstanaEnv = 'nonprod' | 'prod';

export interface InstanaHealth {
  ok:         boolean;
  configured: boolean;
  env:        InstanaEnv;
  mcpUrl:     string;
}

export interface InstanaTool {
  name:        string;
  description: string;
}

// Instana tool şemaları repo'da bilinmediği için (canlı MCP sunucusundan gelir)
// tam bir tip tanımlanamıyor — yalnızca sunucunun eklediği owningTeam garantili.
export interface InstanaItem {
  owningTeam?: string | null;
  [key: string]: unknown;
}

export type InstanaListResponse = { ok: boolean; source?: string; message?: string; [key: string]: unknown };

// Yanıttaki (ok/source/env/message dışındaki) ilk dizi alanını bulur — backend
// hangi anahtar altında döndürürse dönsün (issues/problems/events/services/...).
export function firstArrayField(resp: InstanaListResponse | null | undefined): InstanaItem[] {
  if (!resp) return [];
  const SKIP = new Set(['ok', 'source', 'env', 'message']);
  for (const [key, value] of Object.entries(resp)) {
    if (!SKIP.has(key) && Array.isArray(value)) return value as InstanaItem[];
  }
  return [];
}

export const instanaApi = {
  health: (env: InstanaEnv = 'nonprod'): Promise<InstanaHealth> =>
    fetch(`${BASE}/health?env=${env}`).then(safeJson),

  tools: (env: InstanaEnv = 'nonprod'): Promise<{ ok: boolean; tools?: InstanaTool[]; message?: string }> =>
    fetch(`${BASE}/tools?env=${env}`).then(safeJson),

  // q: serbest-metin arama — dönen listedeki (issues/events/services) elemanlar
  // üzerinde sunucu tarafında uygulanır (bkz. server/instana/index.cjs filterByFreeText).
  problems: (env: InstanaEnv = 'nonprod', refresh = false, q?: string): Promise<{ ok: boolean; source?: string; [key: string]: unknown }> =>
    fetch(`${BASE}/problems?env=${env}${refresh ? '&refresh=1' : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`).then(safeJson),

  events: (env: InstanaEnv = 'nonprod', q?: string): Promise<{ ok: boolean; source?: string; [key: string]: unknown }> =>
    fetch(`${BASE}/events?env=${env}${q ? `&q=${encodeURIComponent(q)}` : ''}`).then(safeJson),

  services: (env: InstanaEnv = 'nonprod', refresh = false, q?: string): Promise<{ ok: boolean; source?: string; [key: string]: unknown }> =>
    fetch(`${BASE}/services?env=${env}${refresh ? '&refresh=1' : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`).then(safeJson),
};
