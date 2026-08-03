// src/components/common/JobTrackerBar.tsx — AppLayout'ta sabit render edilen, tarayıcı
// sekmesi/indirme çubuğu benzeri iş takip arayüzü. En fazla bir iş her an "büyütülmüş"
// (floating pencere) olabilir; geri kalanı alt çubukta küçük sekmeler olarak durur.
//
// Pencere GERÇEK bir kayan pencere gibi davranır: başlık çubuğundan tutup HER YERE
// sürüklenebilir, sağ-alt köşesinden görünür bir tutamaçla boyutlandırılabilir.
// Küçültme YALNIZCA kullanıcı "küçült" butonuna basınca olur; job başlar başlamaz
// otomatik minimize etmiyoruz.
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
const MIN_SIZE = { w: 380, h: 240 };
const MARGIN = 16;

function defaultPos() {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  return {
    x: Math.max(MARGIN, window.innerWidth - DEFAULT_SIZE.w - MARGIN),
    y: Math.max(MARGIN, window.innerHeight - DEFAULT_SIZE.h - MARGIN),
  };
}

export default function JobTrackerBar() {
  const { jobs, expand, minimize, remove } = useJobTracker();
  // Satır filtresi salt-UI durumu — context'in polling sorumluluğuna karışmaması icin
  // burada, job id'sine göre yerel olarak tutulur (bkz. TrackedJob.filterable).
  const [filters, setFilters] = useState<Record<string, { enabled: boolean; prefix: string }>>({});

  const [pos, setPos] = useState(defaultPos);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const dragRef = useRef<{ mode: "move" | "resize"; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number } | null>(null);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.mode === "move") {
      const maxX = window.innerWidth - 120;   // en az başlığın bir kısmı görünür kalsın
      const maxY = window.innerHeight - 40;
      setPos({
        x: Math.min(maxX, Math.max(-size.w + 120, d.origX + dx)),
        y: Math.min(maxY, Math.max(0, d.origY + dy)),
      });
    } else {
      const maxW = window.innerWidth - pos.x - MARGIN;
      const maxH = window.innerHeight - pos.y - MARGIN;
      setSize({
        w: Math.min(maxW, Math.max(MIN_SIZE.w, d.origW + dx)),
        h: Math.min(maxH, Math.max(MIN_SIZE.h, d.origH + dy)),
      });
    }
  }, [pos.x, pos.y, size.w]);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, [onPointerMove]);

  function startMove(e: React.PointerEvent) {
    e.preventDefault();
    dragRef.current = { mode: "move", startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y, origW: size.w, origH: size.h };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { mode: "resize", startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y, origW: size.w, origH: size.h };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  useEffect(() => () => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, [onPointerMove, onPointerUp]);

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
          className="fixed z-[60] shadow-2xl rounded-xl animate-modal-pop flex flex-col"
          style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }}
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
            {/* Sağ-alt köşe: görünür, sürüklenebilir boyutlandırma tutamacı. */}
            <div
              onPointerDown={startResize}
              title="Boyutlandırmak için sürükleyin"
              className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize flex items-end justify-end p-0.5"
            >
              <svg viewBox="0 0 10 10" className="w-2.5 h-2.5 text-white/40">
                <path d="M9 1L1 9M9 5L5 9M9 9L9 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </div>
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
