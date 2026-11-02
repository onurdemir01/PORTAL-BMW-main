import { safeJson, okJson } from "./http";
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
  // Seed (PLAYBOOK_REGISTRY_SEED) satırı mı — silinirse iz tutulur, "Silinen varsayılanlar"dan geri yüklenir.
  varsayilan?: boolean;
  // Bu anahtarı kullanan Portal özelliği (sunucudaki statik harita); null = Portal kodu kullanmıyor.
  kullanan?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SilinenVarsayilan {
  keyName: string;
  displayName: string;
  category: string;
  deletedBy: string | null;
  deletedAt: string | null;
}

export interface AvailablePlaybook {
  keyName: string;
  displayName: string;
  description: string;
  category: string;
  handler: "host_target" | "ocp_cluster";
}

export const playbookRegistryApi = {
  // KATI: okunamayan liste "kayit yok" diye gosterilmesin (bkz. api/http.ts okJson).
  // silinenVarsayilanlar null + silinenHata dolu: o bölüm okunamadı (liste yine gelir).
  list: (): Promise<{
    ok: boolean; playbooks?: PlaybookRegistryEntry[]; message?: string;
    silinenVarsayilanlar?: SilinenVarsayilan[] | null; silinenHata?: string | null;
  }> =>
    fetch(BASE).then(okJson),

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

  remove: (id: number): Promise<{ ok: boolean; message?: string; varsayilan?: boolean; kullanan?: string | null }> =>
    fetch(`${BASE}/${id}`, { method: "DELETE" }).then(safeJson),

  // Silinen varsayılanı geri yükler: izi siler, satırı seed değerleriyle yeniden ekler.
  geriYukle: (keyName: string): Promise<{ ok: boolean; playbook?: PlaybookRegistryEntry; message?: string }> =>
    fetch(`${BASE}/silinen/${encodeURIComponent(keyName)}/geri-yukle`, { method: "POST" }).then(safeJson),
};
