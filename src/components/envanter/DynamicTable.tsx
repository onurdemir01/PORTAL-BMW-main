import React, { useState, useRef } from "react";
import {
  ChevronUpDownIcon, ChevronUpIcon, ChevronDownIcon, FunnelIcon,
} from "@heroicons/react/24/outline";
import { ColumnFilterDropdown } from "./ColumnFilterDropdown";
import { TableEmptyRow } from "@/components/common/EmptyState";
import { fmtDate } from "@/utils/datetime";

interface Props {
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
  visibleCols: string[];
  multiFilters: Record<string, string[]>;
  onApplyColumnFilter: (col: string, values: string[]) => void;
  loading?: boolean;
  sortBy?: string | null;
  sortDir?: "ASC" | "DESC" | null;
  onSort?: (col: string, dir: "ASC" | "DESC" | null) => void;
}

type SortDir = "asc" | "desc" | null;

function cellValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return fmtDate(v);
  return String(v);
}

function envBadge(val: string) {
  const map: Record<string, string> = {
    Production: "bg-red-100 text-red-700",
    Prod:       "bg-red-100 text-red-700",
    Test:       "bg-amber-100 text-amber-700",
    QA:         "bg-blue-100 text-blue-700",
    Alpha:      "bg-purple-100 text-purple-700",
    Dev:        "bg-green-100 text-green-700",
  };
  const cls = map[val];
  if (!cls) return <span>{val}</span>;
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{val}</span>;
}

const DynamicTable: React.FC<Props> = ({
  table,
  columns,
  rows,
  visibleCols,
  multiFilters,
  onApplyColumnFilter,
  loading,
  sortBy: serverSortBy,
  sortDir: serverSortDir,
  onSort,
}) => {
  const [localSortCol, setLocalSortCol] = useState<string | null>(null);
  const [localSortDir, setLocalSortDir] = useState<SortDir>(null);
  const [openFilterCol, setOpenFilterCol] = useState<string | null>(null);
  const filterBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const serverMode = typeof onSort === "function";
  const displayed = visibleCols.filter((c) => columns.includes(c));

  function handleSort(col: string) {
    if (serverMode) {
      if (serverSortBy === col) {
        if (serverSortDir === "ASC") onSort(col, "DESC");
        else if (serverSortDir === "DESC") onSort(col, null);
        else onSort(col, "ASC");
      } else {
        onSort(col, "ASC");
      }
    } else {
      if (localSortCol === col) {
        setLocalSortDir((d) => (d === "asc" ? "desc" : d === "desc" ? null : "asc"));
        if (localSortDir === "desc") setLocalSortCol(null);
      } else {
        setLocalSortCol(col);
        setLocalSortDir("asc");
      }
    }
  }

  const sorted = serverMode
    ? rows
    : [...rows].sort((a, b) => {
        if (!localSortCol || !localSortDir) return 0;
        const av = cellValue(a[localSortCol]);
        const bv = cellValue(b[localSortCol]);
        return localSortDir === "asc" ? av.localeCompare(bv, "tr") : bv.localeCompare(av, "tr");
      });

  function SortIcon({ col }: { col: string }) {
    if (serverMode) {
      if (serverSortBy !== col) return <ChevronUpDownIcon className="w-3 h-3 opacity-40" />;
      if (serverSortDir === "ASC") return <ChevronUpIcon className="w-3 h-3" style={{ color: "var(--accent)" }} />;
      if (serverSortDir === "DESC") return <ChevronDownIcon className="w-3 h-3" style={{ color: "var(--accent)" }} />;
      return <ChevronUpDownIcon className="w-3 h-3 opacity-40" />;
    }
    if (localSortCol !== col) return <ChevronUpDownIcon className="w-3 h-3 opacity-40" />;
    if (localSortDir === "asc") return <ChevronUpIcon className="w-3 h-3" style={{ color: "var(--accent)" }} />;
    return <ChevronDownIcon className="w-3 h-3" style={{ color: "var(--accent)" }} />;
  }

  if (loading) {
    return (
      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "var(--bg-base)", borderBottom: "1px solid var(--border)" }}>
              {[1,2,3,4,5].map(i => (
                <th key={i} className="px-3 py-2.5">
                  <div className="skeleton h-3 rounded" style={{ width: `${40 + i * 10}px` }} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...Array(8)].map((_, i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                {[1,2,3,4,5].map(j => (
                  <td key={j} className="px-3 py-2.5">
                    <div className="skeleton h-3.5 rounded" style={{ width: `${j % 2 === 0 ? '75%' : j % 3 === 0 ? '50%' : '90%'}` }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const openFilterAnchor = openFilterCol
    ? { current: filterBtnRefs.current[openFilterCol] ?? null }
    : null;

  return (
    <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border)" }}>
      {/* Yapiskan baslik artik ortak `.pf-table-sticky` sinifindan (bkz. index.css).
          Eskiden buradaki zemin SABIT bir acik maviydi (rgba(242,246,255,.95)) ve
          koyu temada parlak bir bant olarak patliyordu. */}
      <table className="w-full text-sm pf-table-sticky" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
        <thead>
          <tr>
            {displayed.map((col) => {
              const activeVals = multiFilters[col] || [];
              const isFiltered = activeVals.length > 0;
              return (
                <th
                  key={col}
                  className="text-left px-3 py-3 whitespace-nowrap"
                  style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}
                >
                  <div className="flex items-center gap-1">
                    <button
                      className="flex items-center gap-1 hover:text-gray-900 select-none"
                      onClick={() => handleSort(col)}
                    >
                      <span>{col}</span>
                      <SortIcon col={col} />
                    </button>
                    {/* Filter trigger */}
                    <button
                      ref={(el) => { filterBtnRefs.current[col] = el; }}
                      onClick={(e) => { e.stopPropagation(); setOpenFilterCol(openFilterCol === col ? null : col); }}
                      className={`ml-1 p-0.5 rounded transition-colors ${
                        isFiltered
                          ? "bg-[rgb(var(--accent-rgb)_/_0.12)]"
                          : ""   /* hover ortak `.pf-table-sticky tbody tr:hover`tan */
                      }`}
                      style={{ color: isFiltered ? "var(--accent)" : "var(--text-muted)" }}
                      title={isFiltered ? `${activeVals.length} filtre aktif` : "Filtrele"}
                    >
                      <FunnelIcon className="w-3 h-3" />
                      {isFiltered && (
                        <span className="ml-0.5 text-[10px] font-bold" style={{ color: "var(--accent)" }}>
                          {activeVals.length}
                        </span>
                      )}
                    </button>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
<TableEmptyRow colSpan={displayed.length} />
          ) : (
            sorted.map((row, ri) => (
              <tr
                key={ri}
                /* Satir hover'i ARTIK CSS yapiyor (`.pf-table-sticky tbody tr:hover`).
                   Eskiden JS `onMouseEnter` ile INLINE yaziliyordu; inline stil CSS
                   kurallarini EZDIGI icin ortak sinif eklense bile hicbir etkisi
                   olmazdi. Ustelik her satirda iki olay dinleyicisi demekti. */
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                {displayed.map((col) => {
                  const val = cellValue(row[col]);
                  const isEnv = col.toLowerCase() === "env";
                  return (
                    <td
                      key={col}
                      className="px-3 py-3 whitespace-nowrap max-w-[200px] truncate text-sm"
                      style={{ color: "var(--text-primary)" }}
                      title={val}
                    >
                      {isEnv ? envBadge(val) : val || <span style={{ color: "var(--text-muted)" }}>—</span>}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Column filter dropdown (portal-mounted via fixed position) */}
      {openFilterCol && openFilterAnchor && (
        <ColumnFilterDropdown
          table={table}
          col={openFilterCol}
          selected={multiFilters[openFilterCol] || []}
          activeFilters={multiFilters}
          anchorRef={openFilterAnchor as React.RefObject<HTMLElement | null>}
          onApply={(vals) => onApplyColumnFilter(openFilterCol, vals)}
          onClose={() => setOpenFilterCol(null)}
        />
      )}
    </div>
  );
};

export default DynamicTable;
