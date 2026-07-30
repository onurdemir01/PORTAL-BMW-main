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
}
export interface TableUserOverride {
  username: string; override_type: "allow" | "deny"; created_by: string | null; created_at: string | null;
}

export interface TableAliasDetail {
  tableName: string;
  alias: string;
  schemaName: string;
  description: string;
  isActive: boolean;
  language: string;
  sortOrder: number;
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

  tableAliases: (): Promise<{ ok: boolean; aliases: Record<string, string> }> =>
    fetch(`${BASE}/table-aliases`).then(safeJson),

  // actions.md #13 — schema/description/is_active/language/sort_order dahil tam satirlar (admin).
  tableAliasesDetailed: (): Promise<{ ok: boolean; aliases: TableAliasDetail[] }> =>
    fetch(`${BASE}/table-aliases/detail`).then(safeJson),

  setTableAlias: (tableName: string, alias: string, extra?: Partial<Omit<TableAliasDetail, "tableName" | "alias">>) =>
    fetch(`${BASE}/table-aliases`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tableName, alias, ...extra }),
    }).then(safeJson),

  visibleTablesConfig: (): Promise<{ ok: boolean; config: Record<string, string | string[]> }> =>
    fetch(`${BASE}/visible-tables`).then(safeJson),

  setVisibleTables: (role: "User" | "Admin", tables: string[] | "*") =>
    fetch(`${BASE}/visible-tables`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, tables }),
    }).then(safeJson),

  // actions.md #12 (Bolum K) — her tablo icin bir satir (eski 2-satirlik CSV modeli yerine).
  tableVisibilityList: (): Promise<{ ok: boolean; tables: TableVisibilityRow[] }> =>
    fetch(`${BASE}/table-visibility`).then(safeJson),

  updateTableVisibility: (id: number, data: { isActive: boolean; displayName?: string; description?: string; sortOrder?: number }) =>
    fetch(`${BASE}/table-visibility/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
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
};
