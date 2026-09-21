// src/api/serverHubApi.ts — Server Hub (2026-09-21): reboot hazirligi / atil kaynak raporu.
import { safeJson } from './http';

const BASE = '/api/server-hub';

export type ShSeverity = 'ok' | 'info' | 'warning' | 'danger';
export interface ShFix { action: string; gen?: number; jvm?: string; product?: string; file?: string; line?: number; server_name?: string }
export interface ShFinding { severity: Exclude<ShSeverity, 'ok'>; area: 'init' | 'jboss' | 'jvm' | 'web' | 'ip' | 'ssh' | 'scan'; code: string; text: string; fix: ShFix | null }
export interface ShHostRow {
  host: string; scanDate: string | null; products: string[]; status: ShSeverity;
  counts: { danger: number; warning: number; info: number };
  wallS: number | null; cpuS: number | null;
  jvms: number; jvmsRunning: number; vhosts: number; unusedIps: number; topFinding: string | null;
}
export interface ShJvm {
  gen: number; name: string; group: string; running: boolean; autoStart: 'true' | 'false' | 'unknown'; serverState: string; ports: number[];
  req24h: number | null; req7d: number | null; matchKind: 'proxy' | 'name' | null;
  vhosts: { host: string; product: string; serverName: string; req24h: number | null; req7d: number | null; hc24h: number | null; sampled: boolean }[];
}
export interface ShVhost {
  product: string; listen: string; serverName: string; aliases: string; accessLog: string; proxyTargets: string;
  req24h: number | null; req7d: number | null; hc24h: number | null; shared: boolean; sampled: boolean; confFile: string; jvm: string | null;
}
export interface ShHostDetail extends Omit<ShHostRow, 'jvms' | 'vhosts'> {
  findings: ShFinding[];
  init: { root: string; file: string; status: string }[];
  jboss: { gen: number; hostName: string; hostState: string; cli: string; note: string }[];
  jvms: ShJvm[];
  web: { product: string; running: boolean; syntax: string; detail: string }[];
  vhosts: ShVhost[];
  ips: { ip: string; iface: string; usedBy: string; primary: boolean }[];
  sshd: { maxSessions: number | null; maxStartups: string; activeSessions: number | null } | null;
}
export interface ShSummary {
  hosts: { total: number; ok: number; info: number; warning: number; danger: number };
  init: { hosts: number; compliant: number; diffFiles: number };
  jvm: { total: number; running: number; stopped: number; autoOn: number; autoOff: number; autoUnknown: number; restartRequired: number; rebootRisk: number; retireCandidates: number; noLoad: number; mapped: number };
  web: Record<string, { hosts: number; syntaxOk: number; syntaxFail: number; notRunning: number; vhosts: number; idleVhosts: number }>;
  ips: { total: number; unused: number };
  ssh: { hosts: number; lowMaxSessions: number; near: number };
  scan: { avgCpuS: number | null; maxCpuS: number | null; maxCpuHost: string | null };
}
export interface ShOverview { ok: boolean; message?: string; tableMissing: boolean; latestScan: string | null; summary: ShSummary | null; hosts: ShHostRow[] }
export interface ShLaunch { ok: boolean; message?: string; jobId: number | null; status: string | null; awxServerId: number; planOnly?: boolean }
export interface ShJobStatus { ok: boolean; status: string; output: string; result?: unknown; message?: string }

const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const serverHubApi = {
  overview: (fresh = false): Promise<ShOverview> => fetch(`${BASE}/overview${fresh ? '?fresh=1' : ''}`).then(safeJson),
  host: (host: string, fresh = false): Promise<{ ok: boolean; host: ShHostDetail; message?: string }> =>
    fetch(`${BASE}/host/${encodeURIComponent(host)}${fresh ? '?fresh=1' : ''}`).then(safeJson),
  scan: (hosts: string[]): Promise<ShLaunch> => fetch(`${BASE}/scan`, json({ hosts })).then(safeJson),
  fix: (p: { host: string; code: string; fix: ShFix; confirmed: boolean; reload?: boolean }): Promise<ShLaunch> =>
    fetch(`${BASE}/fix`, json({ host: p.host, code: p.code, fixKey: JSON.stringify(p.fix), confirmed: p.confirmed, reload: !!p.reload })).then(safeJson),
  jobStatus: (awxServerId: number, jobId: number): Promise<ShJobStatus> => fetch(`${BASE}/job-status/${awxServerId}/${jobId}`).then(safeJson),
};
