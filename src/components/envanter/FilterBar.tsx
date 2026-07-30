import React from "react";
import { XMarkIcon, FunnelIcon } from "@heroicons/react/24/outline";
import type { FilterGroup, ColumnFilter, FilterOp } from "@/api/inventoryApi";

interface Props {
  filterGroup: FilterGroup;
  onChange: (fg: FilterGroup) => void;
  columns: string[];
}

const OP_LABELS: Record<FilterOp, string> = {
  contains:    "İçerir",
  notContains: "İçermez",
  equals:      "Eşittir",
  notEquals:   "Eşit Değil",
  startsWith:  "Başlar",
  endsWith:    "Biter",
  isNull:      "Boş",
  isNotNull:   "Dolu",
  gt:          ">",
  gte:         ">=",
  lt:          "<",
  lte:         "<=",
};

const NO_VALUE_OPS: FilterOp[] = ["isNull", "isNotNull"];

export function FilterBar({ filterGroup, onChange, columns }: Props) {
  function setMode(mode: "AND" | "OR") {
    onChange({ ...filterGroup, mode });
  }

  function addFilter() {
    onChange({
      ...filterGroup,
      filters: [
        ...filterGroup.filters,
        { col: columns[0] || "", op: "contains", value: "" },
      ],
    });
  }

  function updateFilter(idx: number, patch: Partial<ColumnFilter>) {
    const filters = filterGroup.filters.map((f, i) =>
      i === idx ? { ...f, ...patch } : f
    );
    onChange({ ...filterGroup, filters });
  }

  function removeFilter(idx: number) {
    onChange({
      ...filterGroup,
      filters: filterGroup.filters.filter((_, i) => i !== idx),
    });
  }

  function clearAll() {
    onChange({ mode: filterGroup.mode, filters: [] });
  }

  const hasFilters = filterGroup.filters.length > 0;

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 space-y-3 animate-slide-up">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <FunnelIcon className="w-4 h-4 text-[#1A56DB]" />
        <span className="text-sm font-semibold text-gray-700">Gelişmiş Filtre</span>

        {/* AND / OR toggle */}
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5 ml-2">
          {(["AND", "OR"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                filterGroup.mode === m
                  ? "bg-[#1A56DB] text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-800"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={addFilter}
            className="px-3 py-1.5 text-xs font-medium bg-[#1A56DB] text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            + Filtre Ekle
          </button>
          {hasFilters && (
            <button
              onClick={clearAll}
              className="px-3 py-1.5 text-xs font-medium border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Temizle
            </button>
          )}
        </div>
      </div>

      {/* Filter rows */}
      {filterGroup.filters.map((f, idx) => (
        <div key={idx} className="flex items-center gap-2 flex-wrap">
          {idx > 0 && (
            <span className="text-xs font-bold text-[#1A56DB] w-8 text-center">
              {filterGroup.mode}
            </span>
          )}
          {idx === 0 && <span className="text-xs text-gray-400 w-8 text-center">—</span>}

          {/* Column selector */}
          <select
            value={f.col}
            onChange={(e) => updateFilter(idx, { col: e.target.value })}
            className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-[#1A56DB] bg-white max-w-[160px]"
          >
            {columns.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          {/* Operator selector */}
          <select
            value={f.op}
            onChange={(e) => updateFilter(idx, { op: e.target.value as FilterOp })}
            className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-[#1A56DB] bg-white"
          >
            {(Object.keys(OP_LABELS) as FilterOp[]).map((op) => (
              <option key={op} value={op}>{OP_LABELS[op]}</option>
            ))}
          </select>

          {/* Value input (hidden for isNull/isNotNull) */}
          {!NO_VALUE_OPS.includes(f.op) && (
            <input
              type="text"
              value={f.value}
              onChange={(e) => updateFilter(idx, { value: e.target.value })}
              placeholder="Değer..."
              className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-[#1A56DB] flex-1 min-w-[100px]"
            />
          )}

          <button
            onClick={() => removeFilter(idx)}
            className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
        </div>
      ))}

      {!hasFilters && (
        <p className="text-xs text-gray-400 text-center py-2">
          Henüz filtre eklenmedi. "+ Filtre Ekle" butonuna tıklayın.
        </p>
      )}
    </div>
  );
}
