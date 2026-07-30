import { safeJson } from "./http";
// src/api/playbookRegistryApi.ts — AI'ın çağırabildiği salt-okunur tanılama
// playbook'larının DB-destekli kaydı (Admin > Playbook Kayıtları).
const BASE = "/api/ansible/playbooks";

export interface PlaybookRegistryEntry {
  id: number;
  keyName: string;
  displayName: string;
  description: string;
  category: string;
  handler: "host_target" | "ocp_cluster";
  playbookPath: string;
  awxTemplateId: number | null;
  // Bu playbook'un hangi AWX sunucusunda (1..9 yapılandırılmış) çalışacağı — null ise
  // varsayılan/env davranışı. LogX job'ları için 404'ü önleyen kritik alan.
  awxServerId: number | null;
  envVarName: string;
  enabled: boolean;
  // actions.md #11 (Bolum J) — eskiden yalnizca kod yorumunda belgeleniyordu.
  sourceType: string;
  isReadonly: boolean;
  // CSV rol listesi — page_visibility.roles ile ayni desen (ör. "User,Admin" | "Admin").
  visibility: string;
  sortOrder: number;
  effectiveTemplateId?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AvailablePlaybook {
  keyName: string;
  displayName: string;
  description: string;
  category: string;
  handler: "host_target" | "ocp_cluster";
}

export const playbookRegistryApi = {
  list: (): Promise<{ ok: boolean; playbooks?: PlaybookRegistryEntry[]; message?: string }> =>
    fetch(BASE).then(safeJson),

  // Admin gerekmez — LogX sayfasının dinamik buton listesi için (template ID sızdırılmaz).
  available: (): Promise<{ ok: boolean; playbooks?: AvailablePlaybook[]; message?: string }> =>
    fetch(`${BASE}/available`).then(safeJson),

  create: (data: {
    keyName: string; displayName: string; description?: string; category?: string;
    playbookPath?: string; awxTemplateId?: number | null; awxServerId?: number | null; enabled?: boolean;
    sourceType?: string; isReadonly?: boolean; visibility?: string; sortOrder?: number;
  }): Promise<{ ok: boolean; playbook?: PlaybookRegistryEntry; message?: string }> =>
    fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(safeJson),

  update: (id: number, data: Partial<Pick<PlaybookRegistryEntry, "displayName" | "description" | "category" | "awxTemplateId" | "awxServerId" | "enabled" | "sourceType" | "isReadonly" | "visibility" | "sortOrder">>): Promise<{ ok: boolean; playbook?: PlaybookRegistryEntry; message?: string }> =>
    fetch(`${BASE}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(safeJson),

  remove: (id: number): Promise<{ ok: boolean; message?: string }> =>
    fetch(`${BASE}/${id}`, { method: "DELETE" }).then(safeJson),
};
