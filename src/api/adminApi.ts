// src/api/adminApi.ts
import type { InventoryHost } from "./logxApi";
import { safeJson } from "./http";

const BASE_LOGX = "/api/logx";

function headers(role = "Admin"): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-portal-user": "admin",
    "x-portal-role": role,
  };
}

async function json<T>(res: Response): Promise<T> {
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Inventory ────────────────────────────────────────────────────────────────

export const inventoryApi = {
  async list(): Promise<InventoryHost[]> {
    const res = await fetch(`${BASE_LOGX}/admin/inventory`, { headers: headers() });
    const d: { ok: boolean; hosts?: InventoryHost[] } = await json(res);
    return d.hosts ?? [];
  },

  async create(data: Partial<InventoryHost>): Promise<InventoryHost> {
    const res = await fetch(`${BASE_LOGX}/admin/inventory`, {
      method: "POST", headers: headers(), body: JSON.stringify(data),
    });
    const d: { ok: boolean; host: InventoryHost } = await json(res);
    return d.host;
  },

  async update(id: number, data: Partial<InventoryHost>): Promise<InventoryHost> {
    const res = await fetch(`${BASE_LOGX}/admin/inventory/${id}`, {
      method: "PUT", headers: headers(), body: JSON.stringify(data),
    });
    const d: { ok: boolean; host: InventoryHost } = await json(res);
    return d.host;
  },

  async remove(id: number): Promise<void> {
    const res = await fetch(`${BASE_LOGX}/admin/inventory/${id}`, {
      method: "DELETE", headers: headers(),
    });
    await json(res);
  },
};

// ── Page Visibility ───────────────────────────────────────────────────────────

let _pvCache: Record<string, string[]> | null = null;
let _pvCacheAt = 0;
const PV_TTL = 5 * 60_000;

export const pageVisibilityApi = {
  async get(): Promise<Record<string, string[]>> {
    if (_pvCache && Date.now() - _pvCacheAt < PV_TTL) return _pvCache;
    const res = await fetch("/api/visibility/pages");
    const d: { ok: boolean; visibility: Record<string, string[]> } = await safeJson(res);
    _pvCache = d.visibility ?? {};
    _pvCacheAt = Date.now();
    return _pvCache;
  },

  async update(visibility: Record<string, string[]>): Promise<void> {
    const res = await fetch("/api/visibility/pages", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility }),
    });
    if (!res.ok) {
      const d = await safeJson(res).catch(() => ({}));
      throw new Error((d as { error?: string }).error || `HTTP ${res.status}`);
    }
    _pvCache = null; // invalidate after update
  },
};

// ── Dinamik görünürlük motoru (element bazlı, per-user çözülmüş) ───────────────
// Kullanıcıya özel çözülmüş element→boolean haritası + versiyon. AuthContext bunu çeker;
// `version`'ı poll'leyip değişince haritayı reload'suz tazeler (bkz. server/auth/visibility.cjs).

export const visibilityApi = {
  // DİKKAT: burada `safeJson` DEĞİL `json` kullanılır — safeJson HTTP durumunu kontrol
  // etmez, yani 401/503 gövdesi de "başarılı" sayılırdı. Bu, AuthContext'in "harita
  // yüklendi" bayrağını yanlışlıkla true yapıp TÜM sayfaları varsayılan-açık bırakıyordu.
  // Motor okunamadığında (`ok_engine === false`) da hata fırlatılır ki istemci
  // fail-closed davransın (sunucudaki requireVisible zaten öyle).
  async getResolved(): Promise<{ version: number; visibility: Record<string, boolean> }> {
    const res = await fetch("/api/visibility/resolved");
    const d = await json<{ ok: boolean; ok_engine?: boolean; version: number; visibility: Record<string, boolean> }>(res);
    if (d.ok_engine === false) throw new Error("Görünürlük motoru şu an okunamıyor.");
    return { version: d.version ?? 0, visibility: d.visibility ?? {} };
  },

  /**
   * Görünürlük versiyonu. **401 SESSİZCE 0'A DÜŞMEZ.**
   *
   * Eski hali `safeJson` kullanıyordu; o, HTTP durumunu kontrol etmez. Oturum
   * düştüğünde (sunucu yeniden başladı, oturumlar bellekteydi) yanıt 401 olur,
   * `d.version` `undefined` gelir ve `?? 0` onu **0** yapardı. Çağıran taraf
   * `0 !== mevcutVersiyon` görüp haritayı yeniden çeker — yani her yoklama
   * turunda **İKİ** istek atılırdı. Üretim ölçümü bunu birebir gösteriyor:
   * `/version` 3.007, `/resolved` 3.683.
   *
   * Artık 401 ayrı bir sonuç olarak döner; çağıran yoklamayı DURDURUR.
   */
  async getVersion(): Promise<{ version: number; unauthorized: boolean }> {
    const res = await fetch("/api/visibility/version");
    if (res.status === 401) return { version: 0, unauthorized: true };
    const d: { ok: boolean; version: number } = await safeJson(res);
    return { version: d.version ?? 0, unauthorized: false };
  },

  // actions.md #19 (Bolum O.2) — ana menu grup YAPISI (DB-tabanli, eskiden Sidebar.tsx'te
  // sabit NAV_GROUPS idi). Admin-gated degil — herkes menuyu gormeli.
  async getNavGroups(): Promise<NavGroup[]> {
    const res = await fetch("/api/visibility/nav-groups");
    const d: { ok: boolean; groups: NavGroup[] } = await safeJson(res);
    return d.groups ?? [];
  },
};

export interface NavGroup {
  key: string;
  label: string;
  sortOrder: number;
  pageKeys: string[];
}

// ── Element yönetimi (admin) — dinamik ekle/çıkar/gizle ────────────────────────
export interface PortalElement {
  key: string;
  type: string;
  parentKey: string | null;
  label: string | null;
  route: string | null;
  sortOrder: number;
  enabled: boolean;
  defaultVisible: boolean;
  metadata: string | null;
  // actions.md #15 — eskiden yalniz kullanilmayan metadata JSON blob'unda gizliydi.
  description: string | null;
  createdAt: string | null;
}
export interface ElementRule {
  elementKey: string;
  // "email" (2026-09-26): LDAP kullanici adini bilmeden e-postayla yetki verebilmek icin.
  principalType: "role" | "user" | "group" | "email";
  principalId: string;
  allow: boolean;
}

async function okJson(res: Response) {
  const d = await safeJson(res).catch(() => ({}));
  if (!res.ok || (d as { ok?: boolean }).ok === false) {
    throw new Error((d as { error?: string }).error || `HTTP ${res.status}`);
  }
  return d;
}

// Denetim Erisimi (Admin, 2026-09-17): kullanici / AD grubu -> Denetim sekmeleri
export interface DenetimAccessGrant { principalType: 'user' | 'group'; principalId: string; page: boolean; tabs: string[] }
export const denetimAccessApi = {
  async list(): Promise<{ tabs: string[]; grants: DenetimAccessGrant[] }> {
    const d: { ok: boolean; tabs: string[]; grants: DenetimAccessGrant[] } = await okJson(await fetch("/api/visibility/denetim-access")) as never;
    return { tabs: d.tabs ?? [], grants: d.grants ?? [] };
  },
  async set(body: { principalType: 'user' | 'group'; principalId: string; tabs: string[] | 'all' }): Promise<void> {
    await okJson(await fetch("/api/visibility/denetim-access", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  },
  async remove(principalType: 'user' | 'group', principalId: string): Promise<void> {
    await okJson(await fetch(`/api/visibility/denetim-access?principalType=${principalType}&principalId=${encodeURIComponent(principalId)}`, { method: "DELETE" }));
  },
};

// Nginx Hub Erisimi (Admin, 2026-09-23): kullanici / AD grubu -> Nginx Hub sekmeleri.
// Denetim'den farki sunucuda: secilmeyen sekmeye DENY yazilir (sekmeler varsayilan ACIK).
export const nginxAccessApi = {
  async list(): Promise<{ tabs: string[]; grants: DenetimAccessGrant[] }> {
    const d: { ok: boolean; tabs: string[]; grants: DenetimAccessGrant[] } = await okJson(await fetch("/api/visibility/nginx-access")) as never;
    return { tabs: d.tabs ?? [], grants: d.grants ?? [] };
  },
  async set(body: { principalType: 'user' | 'group'; principalId: string; tabs: string[] | 'all' }): Promise<void> {
    await okJson(await fetch("/api/visibility/nginx-access", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  },
  async remove(principalType: 'user' | 'group', principalId: string): Promise<void> {
    await okJson(await fetch(`/api/visibility/nginx-access?principalType=${principalType}&principalId=${encodeURIComponent(principalId)}`, { method: "DELETE" }));
  },
};

export const elementsApi = {
  async list(): Promise<{ elements: PortalElement[]; rules: ElementRule[] }> {
    const res = await fetch("/api/visibility/elements");
    const d: { ok: boolean; elements: PortalElement[]; rules: ElementRule[] } = await okJson(res) as never;
    return { elements: d.elements ?? [], rules: d.rules ?? [] };
  },
  async create(el: Partial<PortalElement>): Promise<void> {
    await okJson(await fetch("/api/visibility/elements", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(el),
    }));
  },
  async update(key: string, el: Partial<PortalElement>): Promise<void> {
    await okJson(await fetch(`/api/visibility/elements/${encodeURIComponent(key)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(el),
    }));
  },
  async setEnabled(key: string, enabled: boolean): Promise<void> {
    await okJson(await fetch(`/api/visibility/elements/${encodeURIComponent(key)}/enabled`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }),
    }));
  },
  async setRules(key: string, rules: { principalType: "role" | "user" | "group" | "email"; principalId: string; allow: boolean }[]): Promise<void> {
    await okJson(await fetch(`/api/visibility/elements/${encodeURIComponent(key)}/rules`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules }),
    }));
  },
  async remove(key: string): Promise<void> {
    await okJson(await fetch(`/api/visibility/elements/${encodeURIComponent(key)}`, { method: "DELETE" }));
  },
};

// ── Role Overrides ────────────────────────────────────────────────────────────

export interface RoleOverrideDetail {
  username: string; role: string; sourceType: string; ldapRole: string | null;
  isActive: boolean; createdBy: string | null; createdAt: string | null;
  description: string; lastAppliedAt: string | null;
}

export const roleApi = {
  async list(): Promise<Record<string, string>> {
    const res = await fetch("/api/roles");
    const d: { ok: boolean; roles: Record<string, string> } = await safeJson(res);
    return d.roles ?? {};
  },

  // actions.md #14 — kaynak/aciklama/olusturan/son-uygulanma dahil tam satirlar.
  async detail(): Promise<RoleOverrideDetail[]> {
    const res = await fetch("/api/roles/detail");
    const d: { ok: boolean; roles: RoleOverrideDetail[] } = await safeJson(res);
    return d.roles ?? [];
  },

  // sessionsRevoked: bu degisiklik sonrasi zorla sonlandirilan aktif oturum sayisi.
  async set(username: string, role: "Admin" | "User", description?: string): Promise<{ sessionsRevoked: number }> {
    const res = await fetch(`/api/roles/${encodeURIComponent(username)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, description }),
    });
    if (!res.ok) {
      const d = await safeJson(res).catch(() => ({}));
      throw new Error((d as { error?: string }).error || `HTTP ${res.status}`);
    }
    const d: { sessionsRevoked?: number } = await safeJson(res);
    return { sessionsRevoked: d.sessionsRevoked || 0 };
  },

  async remove(username: string): Promise<{ sessionsRevoked: number }> {
    const res = await fetch(`/api/roles/${encodeURIComponent(username)}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await safeJson(res).catch(() => ({}));
      throw new Error((d as { error?: string }).error || `HTTP ${res.status}`);
    }
    const d: { sessionsRevoked?: number } = await safeJson(res);
    return { sessionsRevoked: d.sessionsRevoked || 0 };
  },
};

// ── Audit Logs ───────────────────────────────────────────────────────────────

export interface AuditLog {
  id: number;
  session_id?: string;
  username: string;
  auth_source?: string;
  role?: string;
  target_host?: string;
  target_ip?: string;
  action: string;
  result?: string;
  detail?: string;
  client_ip?: string;
  created_at: string;
}

export const auditApi = {
  async list(params?: { username?: string; targetHost?: string; action?: string; limit?: number; offset?: number }): Promise<AuditLog[]> {
    const q = new URLSearchParams();
    if (params?.username) q.set("username", params.username);
    if (params?.targetHost) q.set("targetHost", params.targetHost);
    if (params?.action) q.set("action", params.action);
    if (params?.limit)  q.set("limit",  String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));

    const url = `${BASE_LOGX}/admin/audit${q.toString() ? "?" + q : ""}`;
    const res = await fetch(url, { headers: headers() });
    const d: { ok: boolean; logs?: AuditLog[] } = await json(res);
    return d.logs ?? [];
  },
};
