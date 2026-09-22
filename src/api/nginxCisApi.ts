// src/api/nginxCisApi.ts — Nginx Hub › CIS (2026-09-22).
// Skor Portal'da hesaplanir: istisna ve kurum referansi job beklemeden etkili olur; "Skoru tazele"
// AWX'teki nginx_cis_scan job'ini tetikler (canli skor).
import { safeJson } from './http';

const BASE = '/api/nginx-cis';

export interface NcCisCell {
  id: string; title: string; section: string; level: number; scored: boolean;
  rationale?: string | null; check?: string | null;
  status: 'PASS' | 'FAIL' | 'EXCEPTED' | 'NA' | 'MANUAL' | 'NODATA';
  source: string; observed: string; detail: string;
  expected: string | null; expectedSource: 'kurum' | 'CIS' | null;
  exceptionNote: string | null; counts: boolean; fix: string;
}
export interface NcCisHostRow { host: string; nginxVersion: string | null; tState: string | null; scanDate: string | null; score: number | null; passed: number; failed: number; excepted: number; skipped: number }
export interface NcCisHostDetail extends NcCisHostRow { items: NcCisCell[]; msg?: string | null }
export interface NcCisItemHost { host: string; status: NcCisCell['status']; observed: string; detail: string; exceptionNote: string | null }
export interface NcCisItemRow {
  id: string; title: string; section: string; level: number; scored: boolean;
  pass: number; fail: number; excepted: number; other: number; fix: string;
  /** Neden onemli / nasil olculuyor (madde detay penceresi) */
  rationale?: string | null; check?: string | null;
  hosts?: NcCisItemHost[];
  /** Kurum referansi birden fazla olabilir (2026-09-22); CIS onerisi varsa tek elemanli */
  expectedValues?: string[];
  expected: string | null; expectedSource: 'kurum' | 'CIS' | null;
  exception: { scope: string; note: string } | null;
}
export interface NcCisException { id: number; item_id: string; host: string | null; note: string; created_by?: string | null; created_at?: string }
export interface NcCisOverride { id: number; item_id: string; expected: string; note: string | null; created_by?: string | null; created_at?: string }
export interface NcCisOverview {
  ok: boolean; message?: string; tableMissing: boolean;
  summary: { hosts: number; scanDate: string | null; avgScore: number | null; under80: number; perfect: number; failCells: number; exceptedCells: number; items: number; tFail: number } | null;
  hosts: NcCisHostRow[]; perItem: NcCisItemRow[]; catalog: { id: string; title: string; section: string }[];
  exceptions: NcCisException[]; overrides: NcCisOverride[];
}

const json = (body: unknown) => ({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const nginxCisApi = {
  overview: (fresh = false): Promise<NcCisOverview> => fetch(`${BASE}/overview${fresh ? '?fresh=1' : ''}`).then(safeJson),
  host: (host: string, fresh = false): Promise<{ ok: boolean; host: NcCisHostDetail; message?: string }> =>
    fetch(`${BASE}/host/${encodeURIComponent(host)}${fresh ? '?fresh=1' : ''}`).then(safeJson),
  setException: (itemId: string, host: string | null, note: string): Promise<{ ok: boolean; message?: string }> =>
    fetch(`${BASE}/exceptions`, json({ itemId, host, note })).then(safeJson),
  clearException: (id: number): Promise<{ ok: boolean; message?: string }> => fetch(`${BASE}/exceptions/${id}`, { method: 'DELETE' }).then(safeJson),
  setOverride: (itemId: string, expected: string, note: string): Promise<{ ok: boolean; message?: string }> =>
    fetch(`${BASE}/overrides`, json({ itemId, expected, note })).then(safeJson),
  clearOverride: (id: number): Promise<{ ok: boolean; message?: string }> => fetch(`${BASE}/overrides/${id}`, { method: 'DELETE' }).then(safeJson),
  rescan: (hosts: string[]): Promise<{ ok: boolean; message?: string; jobId: number | null; status: string | null; awxServerId: number }> =>
    fetch(`${BASE}/rescan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hosts }) }).then(safeJson),
  jobStatus: (awxServerId: number, jobId: number): Promise<{ ok: boolean; status: string; output: string; message?: string }> =>
    fetch(`${BASE}/job-status/${awxServerId}/${jobId}`).then(safeJson),
};
