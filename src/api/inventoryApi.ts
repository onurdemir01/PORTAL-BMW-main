import { safeJson } from "./http";
const BASE = "/api/inventory";

// Short-lived caches to prevent duplicate fetches on tab switches
const _tablesCache = { data: null as string[] | null, at: 0 };
const TABLES_TTL = 60_000;
const _colCache = new Map<string, { data: unknown; at: number }>();
const COL_TTL = 5 * 60_000;

export interface TableVisibilityRow {
  id: number; schemaName: string; tableName: string; displayName: string | null;
  isActive: boolean; sortOrder: number; description: string | null; overrideCount: number;
  // Bu tablo User/Admin rolüne görünür mü — ilgili rol için "Tüm tabloları göster" açıksa
  // (bkz. allTablesVisible) her satırda true gelir, ayrı ayrı düzenlenemez.
  roleVisible: Record<"User" | "Admin", boolean>;
  // Takma adın (displayName) KENDİ aktif/pasif durumu — tablonun isActive'inden AYRI bir
  // kavram: pasif bir takma ad tabloyu gizlemez, sadece ham tablo adına düşürür (eskiden
  // Admin > Sistem > "Tablo Takma Adları" ekranındaki "Aktif/Pasif" anahtarı).
  aliasActive: boolean;
}
export interface TableUserOverride {
  username: string; override_type: "allow" | "deny"; created_by: string | null; created_at: string | null;
}

export type FilterOp =
  | "contains" | "notContains" | "equals" | "notEquals"
  | "startsWith" | "endsWith" | "isNull" | "isNotNull"
  | "gt" | "gte" | "lt" | "lte";

export interface ColumnFilter {
  col: string;
  op: FilterOp;
  value: string;
}

export interface FilterGroup {
  mode: "AND" | "OR";
  filters: ColumnFilter[];
}

export interface ColumnMeta {
  COLUMN_NAME: string;
  DATA_TYPE: string;
  IS_NULLABLE: string;
  CHARACTER_MAXIMUM_LENGTH: number | null;
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface TableDataResult {
  ok: boolean;
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
  pagination: PaginationInfo;
}

export interface QueryResult {
  ok: boolean;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface SavedQuery {
  name: string;
  sql: string;
  savedAt: string;
  isPublished: boolean;
  isDefault: boolean;
  publishedBy: string;
  description: string;
}

export type InventoryRefreshChoice = "all" | "nginx" | "ihs" | "rha" | "jboss" | "was" | "ctg";

export interface InventoryRefreshRunResult {
  ok: boolean;
  jobId: number | null;
  status: string | null;
  awxServerId: number;
  choices: InventoryRefreshChoice[];
  message?: string;
}

export interface InventoryRefreshJobStatus {
  ok: boolean;
  status: string;
  output: string;
  finished?: string;
  failed?: boolean;
  message?: string;
}

export const inventoryApi = {
  health: () => fetch(`${BASE}/health`).then(safeJson),

  // viewAsRole: sadece gerçek rolü Admin olan kullanıcılar için sunucu tarafında geçerli
  // olur (bkz. server/inventory/index.cjs) — "farklı rol gibi görüntüle" önizlemesi içindir.
  tables: (viewAsRole?: "User" | "Admin"): Promise<{ ok: boolean; tables: string[]; effectiveRole?: string }> => {
    if (!viewAsRole && _tablesCache.data && Date.now() - _tablesCache.at < TABLES_TTL) {
      return Promise.resolve({ ok: true, tables: _tablesCache.data });
    }
    const qs = viewAsRole ? `?viewAsRole=${viewAsRole}` : "";
    return fetch(`${BASE}/tables${qs}`).then(safeJson).then((d) => {
      if (d.ok && !viewAsRole) { _tablesCache.data = d.tables; _tablesCache.at = Date.now(); }
      return d;
    });
  },

  columns: (table: string): Promise<{ ok: boolean; columns: ColumnMeta[] }> => {
    const cached = _colCache.get(table);
    if (cached && Date.now() - cached.at < COL_TTL) return Promise.resolve(cached.data as { ok: boolean; columns: ColumnMeta[] });
    return fetch(`${BASE}/columns/${encodeURIComponent(table)}`).then(safeJson).then((d) => {
      _colCache.set(table, { data: d, at: Date.now() });
      return d;
    });
  },

  distinct: (
    table: string,
    col: string,
    search?: string
  ): Promise<{ ok: boolean; values: { value: string; count: number }[] }> => {
    const qs = new URLSearchParams({ limit: "200" });
    if (search) qs.set("search", search);
    return fetch(`${BASE}/distinct/${encodeURIComponent(table)}/${encodeURIComponent(col)}?${qs}`).then(safeJson);
  },

  data: (
    table: string,
    params: {
      page?: number;
      limit?: number;
      search?: string;
      filters?: Record<string, string>;
      multiFilters?: Record<string, string[]>;
      filterGroup?: FilterGroup;
      orderBy?: string;
      orderDir?: "ASC" | "DESC";
    } = {}
  ): Promise<TableDataResult> => {
    const qs = new URLSearchParams();
    if (params.page) qs.set("page", String(params.page));
    if (params.limit) qs.set("limit", String(params.limit));
    if (params.search) qs.set("search", params.search);
    if (params.orderBy) qs.set("orderBy", params.orderBy);
    if (params.orderDir) qs.set("orderDir", params.orderDir);
    if (params.filters) {
      for (const [col, val] of Object.entries(params.filters)) {
        if (val) qs.set(`filters[${col}]`, val);
      }
    }
    if (params.multiFilters) {
      const active = Object.fromEntries(
        Object.entries(params.multiFilters).filter(([, v]) => v.length > 0)
      );
      if (Object.keys(active).length > 0) {
        qs.set("multiFilters", JSON.stringify(active));
      }
    }
    if (params.filterGroup && params.filterGroup.filters.length > 0) {
      qs.set("filterGroup", JSON.stringify(params.filterGroup));
    }
    return fetch(`${BASE}/data/${encodeURIComponent(table)}?${qs}`).then(safeJson);
  },

  // Basit ad->alias haritasi (salt-okunur, kullanici-yuzlu ekranlar icin — ör. QueryHelpPanel.tsx).
  // Admin-duzenleme ucu (eskiden tableAliasesDetailed/setTableAlias) KALDIRILDI; ayni
  // duzenleme artik updateTableVisibility'nin aliasActive alani uzerinden yapilir.
  tableAliases: (): Promise<{ ok: boolean; aliases: Record<string, string> }> =>
    fetch(`${BASE}/table-aliases`).then(safeJson),

  // actions.md #12 (Bolum K) — her tablo icin bir satir (eski 2-satirlik CSV modeli yerine).
  // Rol-bazli gorunurluk (Admin > Sistem'deki eski "Kullanici Tablo Gorunurlugu" ekraninin
  // yerini alir) artik BURADA, tablo satirinin bir parcasi olarak gelir/duzenlenir.
  tableVisibilityList: (): Promise<{ ok: boolean; tables: TableVisibilityRow[]; allTablesVisible: Record<"User" | "Admin", boolean> }> =>
    fetch(`${BASE}/table-visibility`).then(safeJson),

  updateTableVisibility: (id: number, data: { isActive: boolean; displayName?: string; description?: string; sortOrder?: number; aliasActive?: boolean }) =>
    fetch(`${BASE}/table-visibility/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(safeJson),

  // Tek bir tablonun bir role gore gorunurlugunu acar/kapatir. "Tum tablolari goster"
  // (setAllTablesVisible) o rol icin AÇIKKEN 400 doner — once o kapatilmali.
  setTableRoleVisibility: (id: number, role: "User" | "Admin", visible: boolean) =>
    fetch(`${BASE}/table-visibility/${id}/role`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, visible }),
    }).then(safeJson),

  // Bir rol icin toplu "tum tablolar gorunur / hicbiri gorunmez" anahtari.
  setAllTablesVisible: (role: "User" | "Admin", allVisible: boolean) =>
    fetch(`${BASE}/table-visibility/role-all`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, allVisible }),
    }).then(safeJson),

  listTableUserOverrides: (id: number): Promise<{ ok: boolean; overrides: TableUserOverride[] }> =>
    fetch(`${BASE}/table-visibility/${id}/user-overrides`).then(safeJson),

  addTableUserOverride: (id: number, username: string, overrideType: "allow" | "deny") =>
    fetch(`${BASE}/table-visibility/${id}/user-overrides`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, overrideType }),
    }).then(safeJson),

  removeTableUserOverride: (id: number, username: string) =>
    fetch(`${BASE}/table-visibility/${id}/user-overrides/${encodeURIComponent(username)}`, { method: "DELETE" }).then(safeJson),

  listTableColumnVisibility: (id: number): Promise<{ ok: boolean; columns: { name: string; isVisible: boolean }[] }> =>
    fetch(`${BASE}/table-visibility/${id}/columns`).then(safeJson),

  setColumnVisibility: (id: number, columnName: string, isVisible: boolean) =>
    fetch(`${BASE}/table-visibility/${id}/columns/${encodeURIComponent(columnName)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isVisible }),
    }).then(safeJson),

  runQuery: (
    sqlText: string,
    opts: { save?: boolean; queryName?: string; description?: string } = {}
  ): Promise<QueryResult> =>
    fetch(`${BASE}/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-portal-role": "Admin",
      },
      body: JSON.stringify({ sqlText, ...opts }),
    }).then(safeJson),

  savedQueries: (): Promise<{ ok: boolean; queries: SavedQuery[] }> =>
    fetch(`${BASE}/saved-queries`).then(safeJson),

  deleteSavedQuery: (name: string) =>
    fetch(`${BASE}/saved-queries/${encodeURIComponent(name)}`, {
      method: "DELETE",
      headers: { "x-portal-role": "Admin" },
    }).then(safeJson),

  publishQuery: (name: string) =>
    fetch(`${BASE}/saved-queries/${encodeURIComponent(name)}/publish`, {
      method: "POST",
    }).then(safeJson),

  setDefaultQuery: (name: string) =>
    fetch(`${BASE}/saved-queries/${encodeURIComponent(name)}/set-default`, {
      method: "POST",
    }).then(safeJson),

  invalidateCache: () => {
    _tablesCache.data = null;
    _tablesCache.at = 0;
    _colCache.clear();
  },

  // "Envanteri Yenile" — Ürün Envanteri (Inventory) tablosu için AWX job'ını tetikler.
  refreshRun: (choices: InventoryRefreshChoice[]): Promise<InventoryRefreshRunResult> =>
    fetch(`${BASE}/refresh/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choices }),
    }).then(safeJson),

  refreshJobStatus: (jobId: number): Promise<InventoryRefreshJobStatus> =>
    fetch(`${BASE}/refresh/job-status/${jobId}`).then(safeJson),
};
