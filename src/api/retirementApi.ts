// src/api/retirementApi.ts — Uygulama Retirement (2026-09-21): kayit + kesif + STOP adimi.
import { safeJson } from './http';

const BASE = '/api/retirement';

export interface RtWeb { host: string; serverName: string; product: string; port: string; confFile: string }
export interface RtDiscoveredTarget {
  host: string; site: 'Pendik' | 'Ankara'; env: 'PROD' | 'QA' | 'TEST' | 'DEV'; appName: string; gen: number | null;
  appPath: string; inventoryStatus: string; domain: string; tier: string; web: RtWeb[]; webHow: string;
  hub: { running: boolean; autoStart: string; scanDate: string | null } | null;
}
export interface RtDiscovery { ok: boolean; message?: string; base: string; targets: RtDiscoveredTarget[]; summary: { total: number; bySite: { Pendik: number; Ankara: number }; byEnv: Record<string, number>; webMatched: number; prod: boolean } }
export type RtTargetStatus = 'pending' | 'planning' | 'planned' | 'stopping' | 'stopped' | 'failed' | 'skipped';
export interface RtTarget {
  id: number; recordId: number; host: string; site: string; env: string; appName: string; gen: number | null; appPath: string | null;
  web: RtWeb[]; status: RtTargetStatus; planText: string | null; resultText: string | null; lastJobId: number | null; stoppedAt: string | null; updatedAt: string;
}
export interface RtRecord {
  id: number; app: string; smartNo: string; ocoNo: string | null; ownerEmail: string | null; requestedBy: string;
  status: 'open' | 'stopping' | 'stopped' | 'deleted' | 'cancelled'; deleteAfterDays: number; plannedDeleteAt: string | null; stopAt: string | null;
  dnsReuse: boolean; lbReuse: boolean; sccNotifiedAt: string | null; notes: string | null; createdAt: string; updatedAt: string; effectiveDeleteAt: string | null;
  targets: RtTarget[]; events: { id: number; at: string; username: string | null; kind: string; text: string | null }[];
}
export interface RtRecordRow extends Omit<RtRecord, 'targets' | 'events'> { targets: number; stopped: number }
export interface RtLaunch { ok: boolean; message?: string; jobId: number | null; status: string | null; awxServerId: number; planOnly?: boolean; sccWarning?: string | null }

const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const retirementApi = {
  config: (): Promise<{ ok: boolean; defaultDays: number; sccMailConfigured: boolean; sccMailTo: string | null; smartFlows: Record<string, string> }> => fetch(`${BASE}/config`).then(safeJson),
  apps: (q: string): Promise<{ ok: boolean; apps: string[] }> => fetch(`${BASE}/apps?q=${encodeURIComponent(q)}`).then(safeJson),
  discover: (app: string): Promise<RtDiscovery> => fetch(`${BASE}/discover?app=${encodeURIComponent(app)}`).then(safeJson),
  list: (): Promise<{ ok: boolean; records: RtRecordRow[]; message?: string }> => fetch(BASE).then(safeJson),
  get: (id: number): Promise<{ ok: boolean; record: RtRecord; message?: string }> => fetch(`${BASE}/${id}`).then(safeJson),
  create: (p: { app: string; smartNo: string; ocoNo?: string; ownerEmail?: string; deleteAfterDays?: number; plannedDeleteAt?: string | null; dnsReuse?: boolean; lbReuse?: boolean; notes?: string; targets?: { host: string; appName: string }[] }): Promise<{ ok: boolean; id: number; record: RtRecord; message?: string }> =>
    fetch(BASE, json(p)).then(safeJson),
  cancel: (id: number, reason: string): Promise<{ ok: boolean; record: RtRecord; message?: string }> => fetch(`${BASE}/${id}/cancel`, json({ reason })).then(safeJson),
  note: (id: number, text: string): Promise<{ ok: boolean; record: RtRecord; message?: string }> => fetch(`${BASE}/${id}/note`, json({ text })).then(safeJson),
  stop: (id: number, tid: number, confirmed: boolean): Promise<RtLaunch> => fetch(`${BASE}/${id}/targets/${tid}/stop`, json({ confirmed })).then(safeJson),
  jobStatus: (id: number, tid: number, awxServerId: number, jobId: number): Promise<{ ok: boolean; status: string; output: string; result?: unknown; message?: string }> =>
    fetch(`${BASE}/${id}/targets/${tid}/job-status/${awxServerId}/${jobId}`).then(safeJson),
};
