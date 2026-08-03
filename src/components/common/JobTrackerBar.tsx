// src/components/common/JobTrackerBar.tsx — AppLayout'ta sabit render edilen, tarayıcı
// sekmesi/indirme çubuğu benzeri iş takip arayüzü. En fazla bir iş her an "büyütülmüş"
// (floating pencere) olabilir; geri kalanı alt çubukta küçük sekmeler olarak durur.
//
// Pencere GERÇEK bir kayan pencere gibi davranır: başlık çubuğundan tutup HER YERE
// sürüklenebilir, sağ-alt köşesindeki görünür bir tutamaçla boyutlandırılabilir.
// PERFORMANS: sürükleme/boyutlandırma sırasında React state'i GÜNCELLENMEZ (her piksel
// hareketinde büyük log çıktısını yeniden render etmek gözle görülür takılmaya yol açardı)
// — DOM stilini ref üzerinden doğrudan mutasyonla güncelliyoruz, state'e yalnızca
// bırakıldığında (pointerup) yazılır.
//
// Küçültme YALNIZCA kullanıcı "küçült" butonuna basınca olur; yeni bir iş başlayınca
// pencere her zaman ekranın ORTASINDA açılır (önceki job'ın konumundan bağımsız).
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

function centeredPos(w: number, h: number) {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  return {
    x: Math.max(MARGIN, Math.round((window.innerWidth - w) / 2)),
    y: Math.max(MARGIN, Math.round((window.innerHeight - h) / 2)),
  };
}

export default function JobTrackerBar() {
  const { jobs, expand, minimize, remove } = useJobTracker();
  // Satır filtresi salt-UI durumu.
  const [filters, setFilters] = useState<Record<string, { enabled: boolean; prefix: string }>>({});

  const [pos, setPos] = useState(() => centeredPos(DEFAULT_SIZE.w, DEFAULT_SIZE.h));
  const [size, setSize] = useState(DEFAULT_SIZE);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: "move" | "resize"; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number } | null>(null);

  const expanded = jobs.find((j) => !j.minimized);
  const prevExpandedIdRef = useRef<string | null>(null);

  // Yeni bir iş "büyütülmüş" duruma geçince (yeni tetiklenen job ya da alt çubuktan
  // farklı bir sekme açılınca) pencereyi HER ZAMAN ortala — önceki job'ın nereye
  // sürüklendiği yeni job'ı etkilemesin.
  useEffect(() => {
    const id = expanded?.id ?? null;
    if (id && id !== prevExpandedIdRef.current) {
      setSize(DEFAULT_SIZE);
      setPos(centeredPos(DEFAULT_SIZE.w, DEFAULT_SIZE.h));
    }
    prevExpandedIdRef.current = id;
  }, [expanded?.id]);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    const el = panelRef.current;
    if (!d || !el) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.mode === "move") {
      const maxX = window.innerWidth - 120;
      const maxY = window.innerHeight - 40;
      const nx = Math.min(maxX, Math.max(-d.origW + 120, d.origX + dx));
      const ny = Math.min(maxY, Math.max(0, d.origY + dy));
      el.style.left = `${nx}px`;
      el.style.top = `${ny}px`;
    } else {
      const maxW = window.innerWidth - d.origX - MARGIN;
      const maxH = window.innerHeight - d.origY - MARGIN;
      const nw = Math.min(maxW, Math.max(MIN_SIZE.w, d.origW + dx));
      const nh = Math.min(maxH, Math.max(MIN_SIZE.h, d.origH + dy));
      el.style.width = `${nw}px`;
      el.style.height = `${nh}px`;
    }
  }, []);

  const onPointerUp = useCallback(() => {
    const d = dragRef.current;
    const el = panelRef.current;
    if (d && el) {
      // Suruklemenin SONUNDA React state'ine yaz — boylece sonraki re-render'larda
      // (ör. yeni log ciktisi geldiginde) konum/boyut SIFIRLANMAZ.
      const rect = el.getBoundingClientRect();
      setPos({ x: rect.left, y: rect.top });
      setSize({ w: rect.width, h: rect.height });
    }
    dragRef.current = null;
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, [onPointerMove]);

  function startMove(e: React.PointerEvent) {
    e.preventDefault();
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = { mode: "move", startX: e.clientX, startY: e.clientY, origX: rect.left, origY: rect.top, origW: rect.width, origH: rect.height };
    document.body.style.userSelect = "none"; // surukleme sirasinda sayfa metnini secmesin
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = { mode: "resize", startX: e.clientX, startY: e.clientY, origX: rect.left, origY: rect.top, origW: rect.width, origH: rect.height };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  useEffect(() => () => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    document.body.style.userSelect = "";
  }, [onPointerMove, onPointerUp]);

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
          ref={panelRef}
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
              className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize flex items-end justify-end p-1"
            >
              <svg viewBox="0 0 10 10" className="w-3 h-3 text-white/40">
                <path d="M9 1L1 9M9 5L5 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
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
