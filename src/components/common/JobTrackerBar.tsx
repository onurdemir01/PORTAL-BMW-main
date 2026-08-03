// src/components/common/JobTrackerBar.tsx — AppLayout'ta sabit render edilen, tarayıcı
// sekmesi/indirme çubuğu benzeri iş takip arayüzü. En fazla bir iş her an "büyütülmüş"
// (floating panel) olabilir; geri kalanı alt çubukta küçük sekmeler olarak durur.
//
// Panel elle boyutlandırılabilir (sol-üst köşeden sürükle) — kullanıcı isterse büyütüp
// küçültebilsin istendi. Küçültme YALNIZCA kullanıcı "küçült" butonuna basınca olur;
// job başlar başlamaz otomatik minimize etmiyoruz.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useJobTracker } from "@/contexts/JobTrackerContext";
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
const MIN_SIZE = { w: 420, h: 280 };

export default function JobTrackerBar() {
  const { jobs, expand, minimize, remove } = useJobTracker();
  // Satır filtresi salt-UI durumu — context'in polling sorumluluğuna karışmaması icin
  // burada, job id'sine göre yerel olarak tutulur (bkz. TrackedJob.filterable).
  const [filters, setFilters] = useState<Record<string, { enabled: boolean; prefix: string }>>({});

  // Panel boyutu — kullanıcı sol-üst köşeden sürükleyerek değiştirir, oturum boyunca
  // hatırlanır (panel sağ-alta sabit kalır, büyüme sola/yukarı doğru olur).
  const [size, setSize] = useState(DEFAULT_SIZE);
  const dragRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  const onResizeMove = useCallback((e: PointerEvent) => {
    const start = dragRef.current;
    if (!start) return;
    const dx = start.x - e.clientX;
    const dy = start.y - e.clientY;
    const maxW = window.innerWidth - 32;
    const maxH = window.innerHeight - 96;
    setSize({
      w: Math.min(maxW, Math.max(MIN_SIZE.w, start.w + dx)),
      h: Math.min(maxH, Math.max(MIN_SIZE.h, start.h + dy)),
    });
  }, []);

  const onResizeEnd = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", onResizeEnd);
  }, [onResizeMove]);

  function onResizeStart(e: React.PointerEvent) {
    e.preventDefault();
    dragRef.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
    window.addEventListener("pointermove", onResizeMove);
    window.addEventListener("pointerup", onResizeEnd);
  }

  useEffect(() => () => {
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", onResizeEnd);
  }, [onResizeMove, onResizeEnd]);

  if (jobs.length === 0) return null;

  const expanded = jobs.find((j) => !j.minimized);
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
          className="fixed bottom-4 right-4 z-[60] shadow-2xl rounded-xl animate-modal-pop flex flex-col relative"
          style={{ width: size.w, height: size.h, maxWidth: "calc(100vw - 2rem)", maxHeight: "calc(100vh - 6rem)" }}
        >
          {/* Sol-üst köşe: sürükleyerek boyutlandırma tutamacı. */}
          <div
            onPointerDown={onResizeStart}
            title="Boyutlandırmak için sürükleyin"
            className="absolute -top-1.5 -left-1.5 w-4 h-4 cursor-nwse-resize z-10 group"
          >
            <div className="w-full h-full rounded-full bg-[var(--accent)] opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>

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
          <div className="flex-1 min-h-0">
            <AnsibleLogTerminal
              output={displayedOutput}
              status={expanded.status}
              title={expanded.title}
              size="fill"
              className={expanded.filterable ? "rounded-t-none" : ""}
              onMinimize={() => minimize(expanded.id)}
              onClose={() => remove(expanded.id)}
            />
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
