// src/api/selfServiceApi.ts
import { safeJson } from "./http";

const BASE = "/api/selfservice";

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(text || `HTTP ${r.status}`);
  }
  return safeJson(r);
}

export interface SelfServiceGroup {
  id: string; groupKey: "ansible"; label: string;
  icon: string; sortOrder: number; isActive: boolean;
}

export interface IpCheckMatch {
  host: string;
  ip: string;
  created_at: string | null;
  updated_at: string | null;
  last_seen_at: string | null;
}

export interface IpCheckResult {
  ip: string;
  found: boolean;
  matches: IpCheckMatch[];
}

export const selfServiceApi = {
  // "Ansible" sekmesinin DB'deki etiket/sira bilgisini dondurur (Smart/Diğerleri katalogu
  // kaldirildigi icin store artik yok — bkz. server/selfservice/store.cjs readGroups).
  async get(): Promise<{ ok: true; groups: SelfServiceGroup[] }> {
    const r = await fetch(`${BASE}`, { method: "GET" });
    return json(r);
  },

  // "Check" sekmesi — yapistirilan IP listesini dbo.IPInventory'de arar (bkz.
  // server/selfservice/index.cjs POST /ip-check).
  async ipCheck(ips: string[]): Promise<{ ok: true; results: IpCheckResult[]; totalChecked: number; totalFound: number }> {
    const r = await fetch(`${BASE}/ip-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ips }),
    });
    return json(r);
  },
};
