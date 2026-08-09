import React, { useState, useEffect, useCallback, useContext, useRef } from "react";
import {
  MagnifyingGlassIcon,
  ArrowDownTrayIcon,
  AdjustmentsHorizontalIcon,
  CommandLineIcon,
  ArrowPathIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  StarIcon,
  BookmarkIcon,
  FunnelIcon,
  XMarkIcon,
  QuestionMarkCircleIcon,
  TableCellsIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { inventoryApi, type SavedQuery, type QueryResult, type FilterGroup } from "@/api/inventoryApi";
import { prefsApi } from "../api/prefsApi";
import { toast } from "@/hooks/useToast";
import { AuthContext } from "@/contexts/AuthContext";
import DynamicTable from "./envanter/DynamicTable";
import ColumnPicker from "./envanter/ColumnPicker";
import QueryPanel from "./envanter/QueryPanel";
import { FilterBar } from "./envanter/FilterBar";
import InventoryRefreshModal from "./envanter/InventoryRefreshModal";
import HelpModal, { type HelpSection } from "@/components/common/HelpModal";

const ENVANTER_HELP_SECTIONS: HelpSection[] = [
  {
    icon: TableCellsIcon,
    title: "Envanter Tablosu",
    body: "Üstteki sekmeler TBMWANS veritabanındaki farklı tabloları listeler. Bir tabloya tıklayınca kayıtları sayfalar halinde görürsünüz; filtre çubuğu ve sütun seçici ile görünümü kendinize göre daraltabilirsiniz.",
  },
  {
    icon: ArrowDownTrayIcon,
    title: "CSV Dışa Aktarma",
    body: "\"CSV\" butonu aktif filtrelerle eşleşen sonuçları (yalnızca ekrandaki sayfayı değil) indirir — denetim veya raporlama için kullanılabilir. Tek seferde en fazla 5.000 kayıt alınır; sonuç bu sınıra takılırsa uyarı gösterilir, filtre daraltarak tamamını alabilirsiniz.",
  },
  {
    icon: BookmarkIcon,
    title: "Yayınlanmış Sorgular",
    body: "Yıldızlı/rozetli kısayol butonları, bir admin tarafından önceden hazırlanıp yayınlanmış hazır sorgulardır — tek tıkla çalıştırıp sonucu görebilirsiniz.",
  },
  {
    icon: ShieldCheckIcon,
    title: "SQL Sorgu Paneli ve Tüm Tablolar Görünümü",
    body: "\"SQL\" butonu serbest metin SQL sorguları çalıştırmanızı sağlar; \"Tüm Tablolar (Admin)\" anahtarı, User rolüne tanımlı kısıtlı tablo görünürlüğünü aşıp veritabanındaki tüm tabloları gösterir. İkisi de yalnızca Admin'e görünür.",
    adminOnly: true,
  },
];

const COL_STORAGE_KEY = (table: string) => `inventory_cols_${table}`;

const LIMIT_OPTIONS_USER  = [200, 500, 1000];
const LIMIT_OPTIONS_ADMIN = [200, 500, 1000, 5000, 10000];

const EMPTY_FILTER_GROUP: FilterGroup = { mode: "AND", filters: [] };

function downloadCsv(columns: string[], rows: Record<string, unknown>[], tableName: string) {
  const header = columns.join(",");
  const body = rows.map((r) =>
    columns.map((c) => {
      const v = r[c] ?? "";
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(",")
  );
  const csv = [header, ...body].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${tableName}_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const EnvanterPage: React.FC = () => {
  const { user } = useContext(AuthContext);
  const isAdmin = user?.role === "Admin";
  const [showHelp, setShowHelp] = useState(false);

  // ── Table list + aliases ──────────────────────────────────────────────────
  const [availableTables, setAvailableTables] = useState<string[]>([]);
  const [tablesLoading, setTablesLoading] = useState(true);
  const [activeTable, setActiveTable] = useState("");
  const [tableAliases, setTableAliases] = useState<Record<string, string>>({});

  // Admin varsayılan olarak "User" için tanımlı tablo görünürlüğünü görür (ekran admin
  // olduğu için otomatik olarak her şeyi göstermez) — sadece admin'e özel küçük bir
  // butonla, istenirse "Tüm Tablolar" (kısıtlamasız Admin) görünümüne geçilebilir.
  const [viewAsRole, setViewAsRole] = useState<"User" | "Admin">("User");

  useEffect(() => {
    setTablesLoading(true);
    Promise.all([
      inventoryApi.tables(isAdmin ? viewAsRole : undefined),
      inventoryApi.tableAliases().catch(() => ({ ok: false, aliases: {} })),
    ])
      .then(([tableRes, aliasRes]) => {
        const list = tableRes.tables ?? [];
        setAvailableTables(list);
        if (list.length > 0 && !list.includes(activeTable)) setActiveTable(list[0]);
        if (aliasRes.ok) setTableAliases(aliasRes.aliases || {});
      })
      .catch(() => {
        setAvailableTables(["Inventory"]);
        setActiveTable("Inventory");
      })
      .finally(() => setTablesLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewAsRole]);

  // ── Published saved queries (preset bar) ─────────────────────────────────
  const [publishedQueries, setPublishedQueries] = useState<SavedQuery[]>([]);
  const [presetResult, setPresetResult] = useState<{ columns: string[]; rows: Record<string, unknown>[]; rowCount: number } | null>(null);
  const [presetName, setPresetName] = useState("");
  const [presetLoading, setPresetLoading] = useState(false);
  const [showPresetResult, setShowPresetResult] = useState(false);

  useEffect(() => {
    inventoryApi.savedQueries()
      .then((r) => {
        const published = (r.queries ?? []).filter((q) => q.isPublished);
        setPublishedQueries(published);
        const def = published.find((q) => q.isDefault);
        if (def) runPresetQuery(def);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runPresetQuery(q: SavedQuery) {
    setPresetLoading(true);
    setPresetName(q.name);
    setShowPresetResult(true);
    try {
      const r = await inventoryApi.runQuery(q.sql);
      if (r.ok) setPresetResult(r);
    } catch {}
    finally { setPresetLoading(false); }
  }

  // ── Table columns & data ──────────────────────────────────────────────────
  const [allColumns, setAllColumns] = useState<string[]>([]);
  const [visibleCols, setVisibleCols] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 200 });
  const [search, setSearch] = useState("");

  // Multi-select column filters — applied immediately when user clicks "Uygula" inside dropdown
  const [multiFilters, setMultiFilters] = useState<Record<string, string[]>>({});

  // Advanced FilterBar — two states: pending (editing) and applied (used for query)
  const [pendingFilterGroup, setPendingFilterGroup] = useState<FilterGroup>(EMPTY_FILTER_GROUP);
  const [appliedFilterGroup, setAppliedFilterGroup] = useState<FilterGroup>(EMPTY_FILTER_GROUP);
  const [showFilterBar, setShowFilterBar] = useState(false);

  const [limit, setLimit] = useState(200);
  const [orderBy, setOrderBy] = useState<string | null>(null);
  const [orderDir, setOrderDir] = useState<"ASC" | "DESC" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dbAvailable, setDbAvailable] = useState<boolean | null>(null);
  const [showColPicker, setShowColPicker] = useState(false);
  const [showQuery, setShowQuery] = useState(false);
  const [showRefreshModal, setShowRefreshModal] = useState(false);
  const colPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inventoryApi.health().then((r) => setDbAvailable(r.mssqlAvailable ?? false));
  }, []);

  // Reset state on table change
  useEffect(() => {
    if (!activeTable || dbAvailable === false) return;
    setMultiFilters({});
    setPendingFilterGroup(EMPTY_FILTER_GROUP);
    setAppliedFilterGroup(EMPTY_FILTER_GROUP);
    setSearch("");
    setRows([]);
    setPagination({ page: 1, pages: 1, total: 0, limit });
    setError(null);
    setOrderBy(null);
    setOrderDir(null);

    // Sunucu tercihleri kolonlardan once yuklenir ki prefsApi.get() dolu cache'ten okusun.
    Promise.all([inventoryApi.columns(activeTable), prefsApi.getAll().catch(() => ({}))]).then(([r]) => {
      if (r.ok) {
        const cols = r.columns.map((c) => c.COLUMN_NAME);
        setAllColumns(cols);
        // Kolon secimi: once sunucu tercihi (portal_user_preferences), yoksa localStorage.
        const saved = prefsApi.get(COL_STORAGE_KEY(activeTable)) ?? localStorage.getItem(COL_STORAGE_KEY(activeTable));
        if (saved) {
          try {
            const parsed: string[] = JSON.parse(saved);
            const valid = parsed.filter((c) => cols.includes(c));
            setVisibleCols(valid.length > 0 ? valid : cols.slice(0, 12));
          } catch {
            setVisibleCols(cols.slice(0, 12));
          }
        } else {
          setVisibleCols(cols.slice(0, 12));
        }
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTable, dbAvailable]);

  const fetchData = useCallback(
    async (page: number) => {
      if (dbAvailable === false || !activeTable) return;
      setLoading(true);
      setError(null);
      try {
        const r = await inventoryApi.data(activeTable, {
          page,
          limit,
          search,
          multiFilters,
          filterGroup: appliedFilterGroup.filters.length > 0 ? appliedFilterGroup : undefined,
          orderBy: orderBy ?? undefined,
          orderDir: orderDir ?? undefined,
        });
        if (!r.ok) throw new Error((r as unknown as { error: string }).error || "Veri alınamadı");
        setRows(r.rows);
        setPagination(r.pagination);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [activeTable, search, multiFilters, appliedFilterGroup, limit, orderBy, orderDir, dbAvailable]
  );

  // Initial fetch when columns load
  useEffect(() => {
    if (allColumns.length > 0) fetchData(1);
  }, [allColumns, fetchData]);

  // Re-fetch when multiFilters or appliedFilterGroup change
  useEffect(() => {
    if (allColumns.length > 0) fetchData(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiFilters, appliedFilterGroup]);

  // Re-fetch when limit or sort changes
  useEffect(() => {
    if (allColumns.length > 0) fetchData(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit, orderBy, orderDir]);

  // Search debounce
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => fetchData(1), 400);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, fetchData]);

  // Close col picker on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) {
        setShowColPicker(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function handleColsChange(cols: string[]) {
    setVisibleCols(cols);
    const json = JSON.stringify(cols);
    localStorage.setItem(COL_STORAGE_KEY(activeTable), json);
    // Sunucu tercihi — tarayici degisimi/restart sonrasi ayni gorunum (best-effort).
    prefsApi.set({ [COL_STORAGE_KEY(activeTable)]: json }).catch(() => {});
  }

  function handleSort(col: string, dir: "ASC" | "DESC" | null) {
    setOrderBy(dir ? col : null);
    setOrderDir(dir);
  }

  // Apply column multi-select filter immediately
  function handleApplyColumnFilter(col: string, values: string[]) {
    setMultiFilters((prev) => {
      const next = { ...prev };
      if (values.length === 0) delete next[col]; else next[col] = values;
      return next;
    });
  }

  // Apply advanced FilterBar
  function handleApplyFilterBar() {
    setAppliedFilterGroup(pendingFilterGroup);
    setShowFilterBar(false);
  }

  // Clear all filters
  function clearAllFilters() {
    setMultiFilters({});
    setPendingFilterGroup(EMPTY_FILTER_GROUP);
    setAppliedFilterGroup(EMPTY_FILTER_GROUP);
  }

  const multiFilterCount = Object.values(multiFilters).reduce((s, v) => s + v.length, 0);
  const advancedFilterCount = appliedFilterGroup.filters.length;
  const totalActiveFilters = multiFilterCount + advancedFilterCount;
  const limitOptions = isAdmin ? LIMIT_OPTIONS_ADMIN : LIMIT_OPTIONS_USER;

  // E-09: CSV export with all active filters (not just current page)
  const [csvExporting, setCsvExporting] = useState(false);
  // CSV tek seferde en fazla bu kadar satır çeker. Kullanıcıya "tümünü indirir" denildiği
  // için, sonuç bu sınırda kesildiyse AÇIKÇA uyarılır — sessizce eksik dosya vermeyiz.
  const CSV_MAX_ROWS = 5000;
  async function handleExportCsv() {
    if (!activeTable || csvExporting) return;
    setCsvExporting(true);
    try {
      const r = await inventoryApi.data(activeTable, {
        page: 1,
        limit: CSV_MAX_ROWS,
        search,
        multiFilters,
        filterGroup: appliedFilterGroup.filters.length > 0 ? appliedFilterGroup : undefined,
        orderBy: orderBy ?? undefined,
        orderDir: orderDir ?? undefined,
      });
      if (r.ok && r.rows.length > 0) {
        downloadCsv(visibleCols, r.rows, activeTable);
        if (r.rows.length >= CSV_MAX_ROWS) {
          toast.error(
            `CSV ilk ${CSV_MAX_ROWS.toLocaleString("tr-TR")} kayıtla sınırlandı. ` +
            `Tamamı için filtre uygulayarak sonucu daraltın.`
          );
        }
      } else if (r.ok) {
        toast.error("Dışa aktarılacak kayıt bulunamadı.");
      }
    } catch (e: unknown) {
      // Eskiden sessizce yutuluyordu: kullanıcı butona basıyor, hiçbir şey olmuyordu.
      toast.error(`CSV indirilemedi: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCsvExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Envanter</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            TBMWANS veritabanı — {pagination.total.toLocaleString("tr-TR")} kayıt
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHelp(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
          >
            <QuestionMarkCircleIcon className="w-4 h-4" />
            Yardım
          </button>
          <select
            value={limit}
            onChange={(e) => { setLimit(Number(e.target.value)); }}
            className="px-2 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-[#1C69D4] transition bg-white"
            title="Sayfa başına satır"
          >
            {limitOptions.map((l) => (
              <option key={l} value={l}>{l} satır</option>
            ))}
          </select>

          {isAdmin && (
            <button
              onClick={() => setShowQuery(!showQuery)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm border rounded-xl transition-colors
                ${showQuery ? "bg-black text-white border-black" : "border-gray-200 hover:bg-gray-50"}`}
            >
              <CommandLineIcon className="w-4 h-4" />
              SQL
            </button>
          )}
          <button
            onClick={() => fetchData(pagination.page)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
          >
            <ArrowPathIcon className="w-4 h-4" />
            Yenile
          </button>
          <button
            onClick={handleExportCsv}
            disabled={rows.length === 0 || csvExporting}
            title={totalActiveFilters > 0 ? `Aktif filtrelerle tüm sonuçları indir (${pagination.total} kayıt)` : "Tümünü CSV olarak indir"}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            {csvExporting ? (
              <ArrowPathIcon className="w-4 h-4 animate-spin" />
            ) : (
              <ArrowDownTrayIcon className="w-4 h-4" />
            )}
            CSV{totalActiveFilters > 0 ? ` (${pagination.total})` : ""}
          </button>
        </div>
      </div>

      {/* DB unavailable warning */}
      {dbAvailable === false && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0" />
          Veritabanı bağlantısı yok. MSSQL env değişkenlerini kontrol edin veya VPN bağlantınızı doğrulayın.
        </div>
      )}

      {/* Published saved query preset bar */}
      {publishedQueries.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <BookmarkIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
          {publishedQueries.map((q) => (
            <button
              key={q.name}
              onClick={() => runPresetQuery(q)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border transition-all
                ${presetName === q.name && showPresetResult
                  ? "bg-[#1C69D4] text-white border-[#1C69D4]"
                  : "bg-white text-gray-700 border-gray-200 hover:border-[#1C69D4] hover:text-[#1C69D4]"}`}
              title={q.description || q.name}
            >
              {q.isDefault && <StarIcon className="w-3 h-3" />}
              {q.name}
            </button>
          ))}
          {showPresetResult && (
            <button
              onClick={() => { setShowPresetResult(false); setPresetResult(null); }}
              className="text-xs text-gray-400 hover:text-gray-700"
            >
              Temizle
            </button>
          )}
        </div>
      )}

      {/* Preset query result */}
      {showPresetResult && (
        <div className="bg-white rounded-2xl border border-[#1C69D4]/20 shadow-sm p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">
              {presetName}
              {presetResult && (
                <span className="ml-2 text-xs font-normal text-gray-400">
                  {presetResult.rowCount} kayıt
                </span>
              )}
            </span>
            <button
              onClick={() => { setShowPresetResult(false); setPresetResult(null); }}
              className="text-xs text-gray-400 hover:text-gray-700"
            >
              Kapat
            </button>
          </div>
          {presetLoading ? (
            <div className="text-sm text-gray-400 py-4 text-center">Yükleniyor...</div>
          ) : presetResult ? (
            <DynamicTable
              table={activeTable}
              columns={presetResult.columns}
              rows={presetResult.rows}
              visibleCols={presetResult.columns}
              multiFilters={{}}
              onApplyColumnFilter={() => {}}
            />
          ) : null}
        </div>
      )}

      {/* Admin-only: kısıtlı (User) görünümden tüm tablolara geçiş — normal kullanıcı görmez */}
      {isAdmin && (
        <div className="flex justify-end">
          <button
            onClick={() => setViewAsRole((r) => (r === "User" ? "Admin" : "User"))}
            className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full border transition-colors"
            style={
              viewAsRole === "User"
                ? { background: "var(--bg-elevated)", color: "var(--text-muted)", borderColor: "var(--border)" }
                : { background: "rgba(79,142,255,0.08)", color: "var(--accent)", borderColor: "rgba(79,142,255,0.25)" }
            }
            title="Bu buton yalnızca admin'e görünür"
          >
            {viewAsRole === "User" ? "Kısıtlı Görünüm (User)" : "Tüm Tablolar (Admin)"}
          </button>
        </div>
      )}

      {/* Table tabs (dynamic) */}
      {tablesLoading ? (
        <div className="flex gap-2">
          {[1,2,3,4].map((i) => (
            <div key={i} className="h-8 w-24 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 flex-wrap">
          {availableTables.map((t) => (
            <button
              key={t}
              onClick={() => setActiveTable(t)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-all whitespace-nowrap
                ${activeTable === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
              title={tableAliases[t] ? `${t}` : undefined}
            >
              {tableAliases[t] || t}
            </button>
          ))}
        </div>
      )}

      {/* Custom SQL panel */}
      {showQuery && isAdmin && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <QueryPanel
            isAdmin={isAdmin}
            onClose={() => setShowQuery(false)}
            onQueriesChange={() => {
              inventoryApi.savedQueries().then((r) => {
                setPublishedQueries((r.queries ?? []).filter((q) => q.isPublished));
              });
            }}
          />
        </div>
      )}

      {/* "Ürün Envanteri" (Inventory) tablosu için: sunuculara bağlanıp runtime'daki
          gerçek durumu çekerek envanteri güncelleyen AWX job'ını tetikleyen bar. */}
      {activeTable === "Inventory" && (
        <button
          onClick={() => setShowRefreshModal(true)}
          className="flex items-center gap-2 w-full px-4 py-2.5 text-sm font-medium text-white rounded-xl transition-colors"
          style={{ background: "#1C69D4" }}
        >
          <ArrowPathIcon className="w-4 h-4" />
          Envanteri Yenile
        </button>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`${activeTable} içinde ara...`}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-[#1C69D4] transition"
          />
        </div>

        {/* Advanced FilterBar toggle */}
        <button
          onClick={() => setShowFilterBar(!showFilterBar)}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm border rounded-xl transition-colors
            ${showFilterBar || advancedFilterCount > 0
              ? "bg-[#1A56DB] text-white border-[#1A56DB]"
              : "border-gray-200 hover:bg-gray-50"}`}
        >
          <FunnelIcon className="w-4 h-4" />
          Gelişmiş Filtre
          {advancedFilterCount > 0 && (
            <span className="text-xs font-bold text-white/80 ml-0.5">
              ({advancedFilterCount})
            </span>
          )}
        </button>

        <div className="relative" ref={colPickerRef}>
          <button
            onClick={() => setShowColPicker(!showColPicker)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border rounded-xl transition-colors
              ${showColPicker ? "bg-black text-white border-black" : "border-gray-200 hover:bg-gray-50"}`}
          >
            <AdjustmentsHorizontalIcon className="w-4 h-4" />
            Sütunlar
            {allColumns.length > 0 && (
              <span className="text-xs opacity-70">({visibleCols.length}/{allColumns.length})</span>
            )}
          </button>
          {showColPicker && (
            <ColumnPicker
              allColumns={allColumns}
              visible={visibleCols}
              onChange={handleColsChange}
              onClose={() => setShowColPicker(false)}
            />
          )}
        </div>

        {orderBy && (
          <div className="flex items-center gap-1.5 px-3 py-2 text-xs bg-blue-50 text-[#1C69D4] border border-blue-100 rounded-xl">
            {orderBy} {orderDir === "ASC" ? "↑" : "↓"}
            <button
              onClick={() => { setOrderBy(null); setOrderDir(null); }}
              className="ml-1 text-blue-300 hover:text-blue-600"
            >
              ✕
            </button>
          </div>
        )}

        {totalActiveFilters > 0 && (
          <button
            onClick={clearAllFilters}
            className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 border border-red-100 bg-red-50 rounded-xl px-2.5 py-2"
          >
            <XMarkIcon className="w-3.5 h-3.5" />
            {totalActiveFilters} filtre temizle
          </button>
        )}

        <span className="text-xs text-gray-400 ml-auto">
          Toplam: {pagination.total.toLocaleString("tr-TR")} | Sayfa {pagination.page}/{pagination.pages} | {limit} satır/sayfa
        </span>
      </div>

      {/* Active multi-filter chips */}
      {Object.entries(multiFilters).filter(([, v]) => v.length > 0).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(multiFilters)
            .filter(([, v]) => v.length > 0)
            .map(([col, vals]) => (
              <div key={col} className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 border border-blue-100 rounded-full text-xs text-[#1A56DB]">
                <span className="font-semibold">{col}:</span>
                <span>{vals.length <= 2 ? vals.join(", ") : `${vals.slice(0, 2).join(", ")} +${vals.length - 2}`}</span>
                <button onClick={() => handleApplyColumnFilter(col, [])} className="ml-1 hover:text-red-500">
                  <XMarkIcon className="w-3 h-3" />
                </button>
              </div>
            ))}
        </div>
      )}

      {/* Advanced filter bar with pending/apply pattern */}
      {showFilterBar && allColumns.length > 0 && (
        <div className="space-y-2">
          <FilterBar
            filterGroup={pendingFilterGroup}
            onChange={setPendingFilterGroup}
            columns={allColumns}
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setPendingFilterGroup(EMPTY_FILTER_GROUP); setAppliedFilterGroup(EMPTY_FILTER_GROUP); }}
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Temizle
            </button>
            <button
              onClick={handleApplyFilterBar}
              className="px-4 py-1.5 text-xs bg-[#1A56DB] text-white rounded-lg hover:bg-blue-700"
            >
              Uygula ({pendingFilterGroup.filters.length} kural)
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-700">
          {error}
          <button onClick={() => fetchData(pagination.page)} className="ml-3 underline">
            Tekrar dene
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <DynamicTable
          table={activeTable}
          columns={allColumns}
          rows={rows}
          visibleCols={visibleCols}
          multiFilters={multiFilters}
          onApplyColumnFilter={handleApplyColumnFilter}
          loading={loading}
          sortBy={orderBy}
          sortDir={orderDir}
          onSort={handleSort}
        />
      </div>

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => fetchData(pagination.page - 1)}
            disabled={pagination.page <= 1 || loading}
            className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            <ChevronLeftIcon className="w-4 h-4" />
            Önceki
          </button>

          <div className="flex gap-1">
            {Array.from({ length: Math.min(5, pagination.pages) }, (_, i) => {
              let p: number;
              if (pagination.pages <= 5) {
                p = i + 1;
              } else if (pagination.page <= 3) {
                p = i + 1;
              } else if (pagination.page >= pagination.pages - 2) {
                p = pagination.pages - 4 + i;
              } else {
                p = pagination.page - 2 + i;
              }
              return (
                <button
                  key={p}
                  onClick={() => fetchData(p)}
                  disabled={loading}
                  className={`w-8 h-8 text-sm rounded-lg transition-colors ${
                    p === pagination.page
                      ? "bg-[#1C69D4] text-white"
                      : "border border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {p}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => fetchData(pagination.page + 1)}
            disabled={pagination.page >= pagination.pages || loading}
            className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            Sonraki
            <ChevronRightIcon className="w-4 h-4" />
          </button>
        </div>
      )}

      <HelpModal
        open={showHelp}
        onClose={() => setShowHelp(false)}
        title="Envanter — Nasıl Kullanılır?"
        sections={ENVANTER_HELP_SECTIONS}
      />

      {showRefreshModal && <InventoryRefreshModal onClose={() => setShowRefreshModal(false)} />}
    </div>
  );
};

export default EnvanterPage;
