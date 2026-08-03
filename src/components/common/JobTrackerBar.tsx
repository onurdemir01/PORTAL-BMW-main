// src/components/common/JobTrackerBar.tsx — AppLayout'ta sabit render edilen, tarayıcı
// sekmesi/indirme çubuğu benzeri iş takip arayüzü. En fazla bir iş her an "büyütülmüş"
// (floating pencere) olabilir; geri kalanı alt çubukta küçük sekmeler olarak durur.
//
// Sürükle-taşı + köşeden-boyutlandır mantığı useFloatingWindow hook'undan gelir (Self
// Service SurveyModal ile PAYLAŞILIR — bkz. src/hooks/useFloatingWindow.tsx).
//
// Küçültme YALNIZCA kullanıcı "küçült" butonuna basınca olur; yeni bir iş başlayınca
// pencere her zaman ekranın ORTASINDA açılır (önceki job'ın konumundan bağımsız).
import React, { useEffect, useRef, useState } from "react";
import { useJobTracker } from "@/contexts/JobTrackerContext";
import { useFloatingWindow, ResizeHandle } from "@/hooks/useFloatingWindow";
import AnsibleLogTerminal from "./AnsibleLogTerminal";

const STATUS_DOT: Record<string, string> = {
  successful: "#3fb950",
  failed: "#f85149",
  error: "#f85149",
  canceled: "#d29922",
  running: "#58a6ff",
  pending: "#8b949e",
  waiting: "#8b949e",
};

const DEFAULT_SIZE = { w: 760, h: 560 };

export default function JobTrackerBar() {
  const { jobs, expand, minimize, remove } = useJobTracker();
  // Satır filtresi salt-UI durumu.
  const [filters, setFilters] = useState<Record<string, { enabled: boolean; prefix: string }>>({});

  const { ref, style, startMove, startResize, recenter } = useFloatingWindow(DEFAULT_SIZE);
  const expanded = jobs.find((j) => !j.minimized);
  const prevExpandedIdRef = useRef<string | null>(null);

  // Yeni bir iş "büyütülmüş" duruma geçince (yeni tetiklenen job ya da alt çubuktan
  // farklı bir sekme açılınca) pencereyi HER ZAMAN ortala — önceki job'ın nereye
  // sürüklendiği yeni job'ı etkilemesin.
  useEffect(() => {
    const id = expanded?.id ?? null;
    if (id && id !== prevExpandedIdRef.current) recenter();
    prevExpandedIdRef.current = id;
  }, [expanded?.id, recenter]);

  if (jobs.length === 0) return null;

  const minimized = jobs.filter((j) => j.minimized);
  const filter = expanded ? (filters[expanded.id] || { enabled: false, prefix: "" }) : { enabled: false, prefix: "" };

  function setFilter(id: string, patch: Partial<{ enabled: boolean; prefix: string }>) {
    setFilters((prev) => ({ ...prev, [id]: { ...(prev[id] || { enabled: false, prefix: "" }), ...patch } }));
  }

  const displayedOutput = expanded && filter.enabled && filter.prefix
    ? expanded.output.split("\n").filter((l) => l.startsWith(filter.prefix)).join("\n")
    : expanded?.output || "";

  return (
    <>
      {expanded && (
        <div
          ref={ref}
          className="z-[60] shadow-2xl rounded-xl animate-modal-pop flex flex-col"
          style={style}
        >
          {expanded.filterable && (
            <div className="flex items-center gap-2 flex-wrap px-3 py-2 bg-[var(--bg-surface)] border border-b-0 border-[var(--border)] rounded-t-xl flex-shrink-0">
              <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={filter.enabled}
                  onChange={(e) => setFilter(expanded.id, { enabled: e.target.checked })}
                  className="rounded"
                />
                Sadece şu karakterle başlayan satırları göster:
              </label>
              <input
                value={filter.prefix}
                onChange={(e) => setFilter(expanded.id, { prefix: e.target.value })}
                disabled={!filter.enabled}
                placeholder="ör: >"
                className="w-20 px-2 py-1 text-xs font-mono border border-[var(--border)] rounded-lg outline-none focus:border-[var(--accent)] disabled:opacity-50"
              />
            </div>
          )}
          <div className="flex-1 min-h-0 relative">
            <AnsibleLogTerminal
              output={displayedOutput}
              status={expanded.status}
              title={expanded.title}
              size="fill"
              className={expanded.filterable ? "rounded-t-none" : ""}
              onMinimize={() => minimize(expanded.id)}
              onClose={() => remove(expanded.id)}
              onHeaderPointerDown={startMove}
            />
            <ResizeHandle onPointerDown={startResize} />
          </div>
          {expanded.pollErr && (
            <div className="bg-amber-50 text-amber-700 text-xs px-3 py-1.5 rounded-b-xl border border-t-0 border-amber-100 flex-shrink-0">
              {expanded.pollErr}
            </div>
          )}
        </div>
      )}

      {minimized.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center gap-2 px-3 py-2 bg-[var(--bg-surface)] border-t border-[var(--border)] overflow-x-auto">
          {minimized.map((j) => (
            <button
              key={j.id}
              onClick={() => expand(j.id)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)] transition-colors flex-shrink-0"
              title="Büyütmek için tıklayın"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${j.done ? "" : "animate-status-pulse"}`}
                style={{ background: STATUS_DOT[j.status] || "#8b949e" }}
              />
              <span className="truncate max-w-[180px] font-mono">{j.title}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
