import { safeJson } from "./http";
// src/api/dynatraceApi.ts — Dynatrace MANAGED MCP proxy API client
//
// Not: Kurumdaki sunucu dynatrace-managed-mcp — DQL/Grail yok; yetenekler:
// problems, events, entities, metrics, logs. Doğal dil analizi /api/ai-analyst'te.

const BASE = '/api/dynatrace';

export interface DtHealth {
  ok: boolean;
  configured: boolean;
  reachable?: boolean;
  // Gerçek MCP el sıkışması başarılı mı (TCP açık ama MCP konuşamama durumunu ayırt eder)
  mcpConnected?: boolean;
  environment: string | null;
  defaultAlias?: string | null;
  lastError?: { message: string; at: string; url: string } | null;
  message?: string;
}

// 5-minute health cache — prevents duplicate calls across components
let _healthCache: DtHealth | null = null;
let _healthCacheAt = 0;
const HEALTH_TTL = 5 * 60 * 1000;

// Ham hata mesajlarını kullanıcıya anlamlı Türkçe mesaja çevirir
const NETWORK_ERROR_PATTERNS = /fetch failed|timeout|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i;
export function friendlyDtError(rawMessage?: string): string {
  if (!rawMessage) return 'Dynatrace sunucusuna ulaşılamadı.';
  if (NETWORK_ERROR_PATTERNS.test(rawMessage)) {
    return 'Dynatrace MCP sunucusuna ulaşılamıyor (ağ/VPN erişimi gerekli olabilir).';
  }
  return rawMessage;
}

export interface DtProblem {
  problemId: string;
  displayId?: string;
  title: string;
  status: string;
  severityLevel: string;
  impactLevel?: string;
  startTime?: string | null;
  endTime?: string | null;
}

export interface DtEvent {
  eventId: string;
  eventType: string;
  status: string;
  title: string;
  startTime?: string | null;
  endTime?: string | null;
}

export interface DtEntity {
  entityId: string;
  displayName: string;
  type: string;
  tags?: string;
  owningTeam?: string | null;
}

export const dynatraceApi = {
  health: (): Promise<DtHealth> => {
    if (_healthCache && Date.now() - _healthCacheAt < HEALTH_TTL) return Promise.resolve(_healthCache);
    return fetch(`${BASE}/health`).then(safeJson).then(d => {
      _healthCache = d; _healthCacheAt = Date.now(); return d;
    });
  },

  environments: (): Promise<{ ok: boolean; aliases?: string[]; defaultAlias?: string; text?: string; message?: string }> =>
    fetch(`${BASE}/environments`).then(safeJson),

  problems: (opts: { env?: string; status?: string; host?: string; refresh?: boolean } = {}): Promise<{ ok: boolean; problems?: DtProblem[]; text?: string; source?: string; message?: string }> => {
    const qs = new URLSearchParams();
    if (opts.env) qs.set('env', opts.env);
    if (opts.status) qs.set('status', opts.status);
    if (opts.host) qs.set('host', opts.host);
    if (opts.refresh) qs.set('refresh', '1');
    return fetch(`${BASE}/problems?${qs}`).then(safeJson);
  },

  problemDetails: (id: string, env?: string): Promise<{ ok: boolean; text?: string; message?: string }> =>
    fetch(`${BASE}/problems/${encodeURIComponent(id)}${env ? `?env=${encodeURIComponent(env)}` : ''}`).then(safeJson),

  events: (opts: { env?: string; from?: string; to?: string; eventType?: string; host?: string; tag?: string; managementZone?: string; refresh?: boolean } = {}): Promise<{ ok: boolean; events?: DtEvent[]; text?: string; message?: string }> => {
    const qs = new URLSearchParams();
    if (opts.env) qs.set('env', opts.env);
    if (opts.from) qs.set('from', opts.from);
    if (opts.to) qs.set('to', opts.to);
    if (opts.eventType) qs.set('eventType', opts.eventType);
    if (opts.host) qs.set('host', opts.host);
    if (opts.tag) qs.set('tag', opts.tag);
    if (opts.managementZone) qs.set('managementZone', opts.managementZone);
    if (opts.refresh) qs.set('refresh', '1');
    return fetch(`${BASE}/events?${qs}`).then(safeJson);
  },

  entities: (opts: { name?: string; host?: string; type?: string; tag?: string; managementZone?: string; env?: string }): Promise<{ ok: boolean; text?: string; entitySelector?: string; entities?: DtEntity[]; message?: string }> => {
    const qs = new URLSearchParams();
    if (opts.name) qs.set('name', opts.name);
    if (opts.host) qs.set('host', opts.host);
    if (opts.type) qs.set('type', opts.type);
    if (opts.tag) qs.set('tag', opts.tag);
    if (opts.managementZone) qs.set('managementZone', opts.managementZone);
    if (opts.env) qs.set('env', opts.env);
    return fetch(`${BASE}/entities?${qs}`).then(safeJson);
  },

  entityDetails: (id: string, env?: string): Promise<{ ok: boolean; text?: string; message?: string }> =>
    fetch(`${BASE}/entities/${encodeURIComponent(id)}${env ? `?env=${encodeURIComponent(env)}` : ''}`).then(safeJson),

  metrics: (opts: { search?: string; env?: string } = {}): Promise<{ ok: boolean; text?: string; message?: string }> => {
    const qs = new URLSearchParams();
    if (opts.search) qs.set('search', opts.search);
    if (opts.env) qs.set('env', opts.env);
    return fetch(`${BASE}/metrics?${qs}`).then(safeJson);
  },

  metricsQuery: (body: { metricSelector: string; from?: string; to?: string; entitySelector?: string; env?: string }): Promise<{ ok: boolean; text?: string; message?: string }> =>
    fetch(`${BASE}/metrics/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(safeJson),

  logs: (body: { query?: string; from?: string; to?: string; limit?: number; env?: string }): Promise<{ ok: boolean; text?: string; message?: string }> =>
    fetch(`${BASE}/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(safeJson),

  invalidateCache: () => {
    _healthCache = null;
    _healthCacheAt = 0;
  },
};
