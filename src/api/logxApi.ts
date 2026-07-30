import { safeJson } from "./http";
// src/api/logxApi.ts — LogX (v1) kalıntı client'ı. Faz 7 kesiminde port-1111 proxy
// akışı (test-access, session/*, proxyUrl) ve eski logx_permissions API'si (permissionsApi)
// KALDIRILDI — bkz. src/api/logxV2Api.ts. Geriye yalnızca hâlâ kullanılan inventory_hosts
// okuma fonksiyonu ve tipi bırakıldı (AppContext.tsx dashboard sayacı, InventoryHost tipi
// adminApi.ts'in inventoryApi'si tarafından kullanılıyor).

export interface InventoryHost {
  id: number;
  hostname: string;
  fqdn?: string;
  ip: string;
  environment?: string;
  product_type?: string;
  middleware_type?: string;
  middleware_version?: string;
  server_type?: string;
  port: number;
  is_active: boolean;
  notes?: string;
}

const BASE = '/api/logx';

// 30-second inventory cache — LogX inventory is fetched 8x per mount without it
let _inventoryCache: InventoryHost[] | null = null;
let _inventoryCacheAt = 0;
const INVENTORY_TTL = 30_000;

async function json<T>(res: Response): Promise<T> {
  if (!res.ok && res.status !== 200) {
    const text = await res.text();
    let msg = `HTTP ${res.status}`;
    try { msg = JSON.parse(text).error || msg; } catch {}
    throw new Error(msg);
  }
  return safeJson(res);
}

export const logxApi = {
  async health(): Promise<{ ok: boolean; db: boolean }> {
    const res = await fetch(`${BASE}/health`);
    return json(res);
  },

  async inventory(forceRefresh = false): Promise<InventoryHost[]> {
    if (!forceRefresh && _inventoryCache && Date.now() - _inventoryCacheAt < INVENTORY_TTL) {
      return _inventoryCache;
    }
    const res = await fetch(`${BASE}/inventory`);
    const data: { ok: boolean; hosts?: InventoryHost[]; error?: string } = await json(res);
    _inventoryCache = data.hosts ?? [];
    _inventoryCacheAt = Date.now();
    return _inventoryCache;
  },

  async adminInventory(): Promise<InventoryHost[]> {
    const res = await fetch(`${BASE}/admin/inventory`);
    const data: { ok: boolean; hosts?: InventoryHost[]; error?: string } = await json(res);
    return data.hosts ?? [];
  },
};
