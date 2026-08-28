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

// Durum noktalari terminal paletinden (bkz. index.css --term-*): alt cubuk, AWX
// job ciktisinin ozeti oldugu icin ayni renk dilini konusur.
const STATUS_DOT: Record<string, string> = {
  successful: "var(--term-success)",
  failed: "var(--term-danger)",
  error: "var(--term-danger)",
  canceled: "var(--term-warning)",
  running: "var(--term-info)",
  pending: "var(--term-muted)",
  waiting: "var(--term-muted)",
};

// Ekran okuyucuya okunacak metin. Renkli bir nokta gormeyene durum ADIYLA soylenir.
const STATUS_LABEL: Record<string, string> = {
  successful: "başarılı",
  failed: "başarısız",
  error: "hata",
  canceled: "iptal edildi",
  running: "çalışıyor",
  pending: "kuyrukta",
  waiting: "kuyrukta",
};

const DEFAULT_SIZE = { w: 760, h: 560 };

export default function JobTrackerBar() {
  const { jobs, expand, minimize, remove } = useJobTracker();
  // Satır filtresi salt-UI durumu.
  const [filters, setFilters] = useState<Record<string, { enabled: boolean; prefix: string }>>({});

  const { ref, style, startMove, startResize, recenter } = useFloatingWindow(DEFAULT_SIZE);
  const expanded = jobs.find((j) => !j.minimized);
  const prevExpandedIdRef = useRef<string | null>(null);

  // ── EKRAN OKUYUCU DUYURUSU (2026-08-28) ──────────────────────────────────────
  // Repoda `aria-live` HIC kullanilmiyordu. Bir isin bitmesi TAMAMEN gorsel bir
  // olaydi: alt cubuktaki nokta renk degistiriyor, baska hicbir sey olmuyordu.
  // Ekrani goremeyen bir kullanici, isinin bitip bitmedigini anlamak icin sekmeye
  // tekrar tekrar odaklanmak zorundaydi.
  //
  // Yalnizca SONUCLANAN isler duyurulur — her yoklamada "calisiyor" demek gurultu
  // olurdu. Duyurulanlar `announcedRef`te tutulur ki ayni is iki kez okunmasin.
  const [announcement, setAnnouncement] = useState("");
  const announcedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const justDone = jobs.filter((j) => j.done && !announcedRef.current.has(j.id));
    if (justDone.length === 0) return;
    for (const j of justDone) announcedRef.current.add(j.id);
    setAnnouncement(
      justDone.map((j) => `${j.title}: ${STATUS_LABEL[j.status] || j.status}`).join(". ")
    );
  }, [jobs]);

  // Yeni bir iş "büyütülmüş" duruma geçince (yeni tetiklenen job ya da alt çubuktan
  // farklı bir sekme açılınca) pencereyi HER ZAMAN ortala — önceki job'ın nereye
  // sürüklendiği yeni job'ı etkilemesin.
  useEffect(() => {
    const id = expanded?.id ?? null;
    if (id && id !== prevExpandedIdRef.current) recenter();
    prevExpandedIdRef.current = id;
  }, [expanded?.id, recenter]);

  // CANLI BOLGE HER ZAMAN DOM'DA. Ekran okuyucular bir bolgeyi izlemeye BASLAMAK
  // icin onun ONCEDEN var olmasini bekler; mesajla birlikte olusan bir bolge
  // genellikle hic okunmaz. Bu yuzden `jobs.length === 0` erken donusunden ONCE
  // ve ondan BAGIMSIZ olarak render edilir.
  const liveRegion = (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {announcement}
    </div>
  );

  if (jobs.length === 0) return liveRegion;

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
      {liveRegion}
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
                style={{ background: STATUS_DOT[j.status] || "var(--term-muted)" }}
              />
              <span className="truncate max-w-[180px] font-mono" title={j.title}>{j.title}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
