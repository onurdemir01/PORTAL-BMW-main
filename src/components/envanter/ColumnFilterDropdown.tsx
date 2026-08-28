import React, { useState, useEffect, useRef } from "react";
import { MagnifyingGlassIcon, XMarkIcon, CheckIcon } from "@heroicons/react/24/outline";
import { inventoryApi } from "@/api/inventoryApi";

interface Props {
  table: string;
  col: string;
  selected: string[];
  /** Tablodaki TUM aktif kolon filtreleri; secenekler bunlara gore daralir. */
  activeFilters?: Record<string, string[]>;
  anchorRef: React.RefObject<HTMLElement | null>;
  onApply: (values: string[]) => void;
  onClose: () => void;
}

export function ColumnFilterDropdown({ table, col, selected, activeFilters, anchorRef, onApply, onClose }: Props) {
  const [search, setSearch]       = useState("");
  const [values, setValues]       = useState<{ value: string; count: number }[]>([]);
  const [loading, setLoading]     = useState(true);
  const [pending, setPending]     = useState<Set<string>>(new Set(selected));
  const panelRef                  = useRef<HTMLDivElement>(null);

  // Position dropdown below anchor
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
  }, [anchorRef]);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, anchorRef]);

  // Secenekleri getir. DIGER kolonlardaki aktif filtreler de gonderilir ki liste onlara
  // gore daralsin (product=IHS secildikten sonra host listesinde nginx sunuculari
  // gorunmesin). Kendi kolonunun secimi sunucuda haric tutulur - aksi halde listede
  // yalnizca zaten secili degerler kalir ve secim genisletilemezdi.
  const filterKey = JSON.stringify(activeFilters || {});
  useEffect(() => {
    setLoading(true);
    inventoryApi.distinct(table, col, search || undefined, activeFilters)
      .then((r) => { if (r.ok) setValues(r.values); })
      .catch(() => {})
      .finally(() => setLoading(false));
    // filterKey: nesne kimligi her render'da degisecegi icin ICERIGE gore bagimlilik.
  }, [table, col, search, filterKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(val: string) {
    setPending((prev) => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val); else next.add(val);
      return next;
    });
  }

  function selectAll() { setPending(new Set(values.map((v) => v.value))); }
  function clearAll()  { setPending(new Set()); }

  function handleSearchChange(s: string) {
    setSearch(s);
  }

  return (
    <div
      ref={panelRef}
      style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
      className="w-72 bg-white border border-gray-200 rounded-xl shadow-xl flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="text-xs font-semibold text-gray-700 truncate max-w-[180px]" title={col}>{col}</span>
        <button onClick={onClose} className="p-0.5 text-gray-400 hover:text-gray-700 rounded">
          <XMarkIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <MagnifyingGlassIcon className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            autoFocus
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Ara..."
            className="w-full pl-7 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-[#1A56DB]"
          />
        </div>
      </div>

      {/* Select all / clear */}
      <div className="flex gap-3 px-3 pb-2">
        <button onClick={selectAll} className="text-xs text-[#1A56DB] hover:underline">Tümü</button>
        <button onClick={clearAll}  className="text-xs text-gray-400 hover:text-gray-700">Temizle</button>
        {pending.size > 0 && (
          <span className="ml-auto text-xs text-gray-500">{pending.size} seçili</span>
        )}
      </div>

      {/* Values list */}
      <div className="overflow-y-auto max-h-52 border-t border-gray-100">
        {loading ? (
          <div className="py-4 text-center text-xs text-gray-400">Yükleniyor...</div>
        ) : values.length === 0 ? (
          <div className="py-4 text-center text-xs text-gray-400">Değer bulunamadı.</div>
        ) : (
          values.map(({ value, count }) => (
            <button
              key={value}
              onClick={() => toggle(value)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50 transition-colors text-left ${
                pending.has(value) ? "bg-blue-50/50" : ""
              }`}
            >
              <span className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                pending.has(value)
                  ? "bg-[#1A56DB] border-[#1A56DB] text-white"
                  : "border-gray-300 bg-white"
              }`}>
                {pending.has(value) && <CheckIcon className="w-3 h-3" />}
              </span>
              <span className="flex-1 truncate text-gray-700">{value || <span className="italic text-gray-400">(boş)</span>}</span>
              <span className="text-gray-400 flex-shrink-0">{count}</span>
            </button>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="flex gap-2 px-3 py-2.5 border-t border-gray-100">
        <button
          onClick={() => { onApply([]); onClose(); }}
          className="flex-1 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          Sıfırla
        </button>
        <button
          onClick={() => { onApply(Array.from(pending)); onClose(); }}
          className="flex-1 py-1.5 text-xs bg-[#1A56DB] text-white rounded-lg hover:bg-blue-700"
        >
          Uygula {pending.size > 0 && `(${pending.size})`}
        </button>
      </div>
    </div>
  );
}
