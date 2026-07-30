// src/api/selfServiceApi.ts
import type { SelfServiceStore, SelfServiceTab, SelfServiceSubTab, SelfServiceItem } from "@/types";
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
  id: string; groupKey: "smart" | "ansible" | "others"; label: string;
  icon: string; sortOrder: number; isActive: boolean;
}

export const selfServiceApi = {
  async get(): Promise<{ ok: true; store: SelfServiceStore; groups: SelfServiceGroup[] }> {
    const r = await fetch(`${BASE}`, { method: "GET" });
    return json(r);
  },

  // actions.md #5 (Bolum D) — grup metadata'si (label/icon/sira/aktiflik) admin duzenleyebilir.
  async updateGroup(id: string, data: { label?: string; icon?: string; sortOrder?: number; isActive?: boolean }) {
    const r = await fetch(`${BASE}/groups/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return json<{ ok: boolean; group: SelfServiceGroup }>(r);
  },

  async createTab(payload: Partial<SelfServiceTab>) {
    const r = await fetch(`${BASE}/tabs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return json<{ ok: true; store: SelfServiceStore; tab: SelfServiceTab }>(r);
  },

  async updateTab(tabId: string, payload: Partial<SelfServiceTab>) {
    const r = await fetch(`${BASE}/tabs/${encodeURIComponent(tabId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return json<{ ok: true; store: SelfServiceStore; tab: SelfServiceTab }>(r);
  },

  async deleteTab(tabId: string) {
    const r = await fetch(`${BASE}/tabs/${encodeURIComponent(tabId)}`, { method: "DELETE" });
    return json<{ ok: true; store: SelfServiceStore }>(r);
  },

  async createSubTab(tabId: string, payload: Partial<SelfServiceSubTab>) {
    const r = await fetch(`${BASE}/tabs/${encodeURIComponent(tabId)}/subtabs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return json<{ ok: true; store: SelfServiceStore; subTab: SelfServiceSubTab }>(r);
  },

  async updateSubTab(tabId: string, subTabId: string, payload: Partial<SelfServiceSubTab>) {
    const r = await fetch(`${BASE}/tabs/${encodeURIComponent(tabId)}/subtabs/${encodeURIComponent(subTabId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return json<{ ok: true; store: SelfServiceStore; subTab: SelfServiceSubTab }>(r);
  },

  async deleteSubTab(tabId: string, subTabId: string) {
    const r = await fetch(`${BASE}/tabs/${encodeURIComponent(tabId)}/subtabs/${encodeURIComponent(subTabId)}`, {
      method: "DELETE",
    });
    return json<{ ok: true; store: SelfServiceStore }>(r);
  },

  async createItem(tabId: string, subTabId: string, payload: Partial<SelfServiceItem>) {
    const r = await fetch(`${BASE}/tabs/${encodeURIComponent(tabId)}/subtabs/${encodeURIComponent(subTabId)}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return json<{ ok: true; store: SelfServiceStore; item: SelfServiceItem }>(r);
  },

  async updateItem(tabId: string, subTabId: string, itemId: string, payload: Partial<SelfServiceItem>) {
    const r = await fetch(
      `${BASE}/tabs/${encodeURIComponent(tabId)}/subtabs/${encodeURIComponent(subTabId)}/items/${encodeURIComponent(itemId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    return json<{ ok: true; store: SelfServiceStore; item: SelfServiceItem }>(r);
  },

  async deleteItem(tabId: string, subTabId: string, itemId: string) {
    const r = await fetch(
      `${BASE}/tabs/${encodeURIComponent(tabId)}/subtabs/${encodeURIComponent(subTabId)}/items/${encodeURIComponent(itemId)}`,
      { method: "DELETE" }
    );
    return json<{ ok: true; store: SelfServiceStore }>(r);
  },

  async reorder(payload: {
    kind: "tab" | "subTab" | "item";
    scope?: { tabId?: string; subTabId?: string };
    orderedIds: string[];
  }) {
    const r = await fetch(`${BASE}/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return json<{ ok: true; store: SelfServiceStore }>(r);
  },
};