import { safeJson } from "./http";
// src/api/aiAnalystApi.ts — AI Analist API client (SSE stream tüketimi)

const BASE = "/api/ai-analyst";

export interface AiAnalystHealth {
  ok: boolean;
  configured: boolean;
  provider?: string;
  model?: string;
  message?: string;
}

export type AnalystEvent =
  | { type: "status"; text: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; ok: boolean; preview: string }
  | { type: "text"; text: string }
  | { type: "error"; message: string }
  | { type: "conversation"; id: number }
  | { type: "done" };

// Sohbet gecmisi (ai_conversations / ai_messages — DB'de kalici)
export interface AiConversation {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface AiMessage {
  id: number;
  role: "user" | "assistant" | "tool";
  content: string;
  tool_name: string | null;
  created_at: string;
}

export interface ChatSources {
  dynatrace: boolean;
  instana: boolean;
}

// Log Analizi modu (tek atımlık, PII maskeli) sonucu — LogX'ten taşındı
export interface LogAnalysisResult {
  ok: boolean;
  message?: string;
  summary: string;
  severity: "info" | "warning" | "error" | "critical";
  possibleCauses: string[];
  recommendations: string[];
  patterns: string[];
  maskedCount: number;
  maskingDetail: Record<string, number>;
  inputLines: number;
  model: string;
  provider?: string;
}

// 5 dk health cache — sayfa/mount başına tekrar çağrıyı önler (HAR'da 8x görülmüştü)
let _healthCache: AiAnalystHealth | null = null;
let _healthCacheAt = 0;
const HEALTH_TTL = 5 * 60 * 1000;

export const aiAnalystApi = {
  health: (): Promise<AiAnalystHealth> => {
    if (_healthCache && Date.now() - _healthCacheAt < HEALTH_TTL) return Promise.resolve(_healthCache);
    return fetch(`${BASE}/health`).then(safeJson).then((d) => {
      _healthCache = d; _healthCacheAt = Date.now(); return d;
    });
  },

  analyzeLogs: (lines: string[], context: string): Promise<LogAnalysisResult> =>
    fetch(`${BASE}/analyze-logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines, context }),
    }).then(safeJson),

  // Sohbet gecmisi — DB'de kalici (restart/refresh sonrasi devam edilebilir)
  listConversations: (): Promise<AiConversation[]> =>
    fetch(`${BASE}/conversations`).then(safeJson).then((d) => d.conversations ?? []),

  getConversation: (id: number): Promise<{ conversation: AiConversation; messages: AiMessage[] } | null> =>
    fetch(`${BASE}/conversations/${id}`).then((r) => (r.ok ? safeJson(r) : null)),

  deleteConversation: (id: number): Promise<boolean> =>
    fetch(`${BASE}/conversations/${id}`, { method: "DELETE" }).then((r) => r.ok),

  // SSE akışını tüketir; her event için onEvent çağrılır. AbortSignal ile iptal edilebilir.
  async chat(
    body: {
      messages: { role: "user" | "assistant"; content: string }[];
      sources: ChatSources;
      instanaEnv?: "nonprod" | "prod";
      conversationId?: number | null;
    },
    onEvent: (e: AnalystEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await fetch(`${BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok || !res.body) {
      // SSE başlamadan hata (503 anahtar yok, 429 limit, 400 ...)
      const data = await safeJson(res).catch(() => ({ message: `HTTP ${res.status}` }));
      onEvent({ type: "error", message: data.message || `HTTP ${res.status}` });
      onEvent({ type: "done" });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE çerçeveleri "\n\n" ile ayrılır; "data: {...}" satırlarını parse et
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        try { onEvent(JSON.parse(line.slice(6)) as AnalystEvent); }
        catch { /* bozuk çerçeve — atla */ }
      }
    }
  },
};
