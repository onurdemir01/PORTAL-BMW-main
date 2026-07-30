import { safeJson } from "./http";
const BASE = "/api/links";

export interface PortalLink {
  id: string;
  label: string;
  url: string;
  category: string;
  description: string;
  isActive: boolean;
  order: number;
  openInNewTab: boolean;
  icon?: string;
  // Hangi rollere görünsün — page-visibility ile aynı mantık, link bazında.
  visibleTo: ("Admin" | "User")[];
  // true ise Dashboard'daki "Öne Çıkan Bağlantı" rotasyonuna dahil olur.
  isFavorite: boolean;
}

export const linksApi = {
  list: (): Promise<{ ok: boolean; links: PortalLink[] }> =>
    fetch(BASE).then(safeJson),

  create: (data: Omit<PortalLink, "id" | "order">) =>
    fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(safeJson),

  update: (id: string, data: Partial<Omit<PortalLink, "id">>) =>
    fetch(`${BASE}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(safeJson),

  delete: (id: string) =>
    fetch(`${BASE}/${id}`, { method: "DELETE" }).then(safeJson),

  reorder: (orderedIds: string[]) =>
    fetch(`${BASE}/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    }).then(safeJson),
};
