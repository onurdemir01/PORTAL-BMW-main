import { safeJson } from "./http";
export type DutyRosterItem = {
  id: string;
  date: string; // YYYY-MM-DD
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  // actions.md #6 — opsiyonel, henuz admin formunda duzenlenmiyor (yalniz okuma/gelecek genisleme icin).
  dutyGroup?: string | null;
  team?: string | null;
  service?: string | null;
  isActive?: boolean;
  dataSource?: string;
};

const DEFAULT_BASE = "/api"; // <-- bunu "http://localhost:5055/api" yerine yap

// Vite ise: import.meta.env.VITE_DUTY_API_BASE
// CRA ise: process.env.REACT_APP_DUTY_API_BASE
function getBase(): string {
  // @ts-ignore
  const viteVal = typeof import.meta !== "undefined" ? (import.meta as any).env?.VITE_DUTY_API_BASE : undefined;
  // @ts-ignore
  const craVal = typeof process !== "undefined" ? (process as any).env?.REACT_APP_DUTY_API_BASE : undefined;
  return (viteVal || craVal || DEFAULT_BASE).replace(/\/$/, "");
}

async function json<T>(r: Response): Promise<T> {
  const data = await safeJson(r).catch(() => ({}));
  if (!r.ok) {
    const msg = (data && (data.error || data.message)) || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export async function getDutyRoster(): Promise<DutyRosterItem[]> {
  const r = await fetch(`${getBase()}/duty-roster`);
  return await json<DutyRosterItem[]>(r);
}

export async function upsertDutyRoster(item: DutyRosterItem): Promise<DutyRosterItem[]> {
  const r = await fetch(`${getBase()}/duty-roster/upsert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
  const res = await json<{ ok: boolean; items: DutyRosterItem[] }>(r);
  return res.items || [];
}

export async function importDutyRoster(items: DutyRosterItem[]): Promise<DutyRosterItem[]> {
  const r = await fetch(`${getBase()}/duty-roster/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  const res = await json<{ ok: boolean; items: DutyRosterItem[] }>(r);
  return res.items || [];
}

export async function deleteDutyRoster(id: string): Promise<DutyRosterItem[]> {
  const r = await fetch(`${getBase()}/duty-roster/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  const res = await json<{ ok: boolean; items: DutyRosterItem[] }>(r);
  return res.items || [];
}