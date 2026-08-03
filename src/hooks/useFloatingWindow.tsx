// src/hooks/useFloatingWindow.tsx — Gercek bir kayan pencere gibi davranan herhangi bir
// panel/modal icin ortak surukle-tasi + koseden-boyutlandir mantigi (JobTrackerBar ve
// Self Service SurveyModal tarafindan paylasilir).
//
// PERFORMANS: surukleme/boyutlandirma sirasinda React state'i GUNCELLENMEZ (buyuk bir
// log ciktisi icin her piksel hareketinde tum agaci yeniden render etmek gozle gorulur
// takilmaya yol acar) — DOM stilini `ref` uzerinden dogrudan mutasyonla guncelleriz,
// state'e yalnizca birakildiginda (pointerup) yaziriz.
//
// autoHeight SECENEGI: form gibi degisken/kisa icerikli pencereler (Self Service
// SurveyModal) icin yukseklik BASTAN sabit bir piksel degeri DEGIL, icerige gore
// kendiliginden buyur ("auto") — aksi halde kisa bir formda pencerenin altinda
// gereksiz bosluk kalirdi. Kullanici koseden SURUKLEYEREK boyutlandirinca (yalnizca
// resize, sadece tasima degil) o andan itibaren sabit bir piksel degerine gecer;
// cagiran taraf bunu (size.h === "auto" mi degil mi) kullanarak icerideki terminali
// "compact" (sabit) ya da "fill" (kalan alani doldur) modunda gosterebilir.
import React, { useCallback, useEffect, useRef, useState } from "react";

export interface FloatingSize { w: number; h: number | "auto" }
export interface FloatingPos { x: number; y: number }

const MARGIN = 16;

export function centeredPos(w: number, h: number): FloatingPos {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  return {
    x: Math.max(MARGIN, Math.round((window.innerWidth - w) / 2)),
    y: Math.max(MARGIN, Math.round((window.innerHeight - h) / 2)),
  };
}

export function useFloatingWindow(
  defaultSize: { w: number; h: number },
  minSize: { w: number; h: number } = { w: 380, h: 240 },
  opts: { autoHeight?: boolean } = {}
) {
  const autoHeight = !!opts.autoHeight;
  const initialH: number | "auto" = autoHeight ? "auto" : defaultSize.h;
  const [pos, setPos] = useState<FloatingPos>(() => centeredPos(defaultSize.w, autoHeight ? defaultSize.h : defaultSize.h));
  const [size, setSize] = useState<FloatingSize>({ w: defaultSize.w, h: initialH });
  const ref = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: "move" | "resize"; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number } | null>(null);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    const el = ref.current;
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
      const nw = Math.min(maxW, Math.max(minSize.w, d.origW + dx));
      const nh = Math.min(maxH, Math.max(minSize.h, d.origH + dy));
      el.style.width = `${nw}px`;
      el.style.height = `${nh}px`;
    }
  }, [minSize.w, minSize.h]);

  const onPointerUp = useCallback(() => {
    const d = dragRef.current;
    const el = ref.current;
    if (d && el) {
      const rect = el.getBoundingClientRect();
      if (d.mode === "move") {
        // Sadece tasima — boyut NE ISE (auto ya da sabit) OYLE kalir.
        setPos({ x: rect.left, y: rect.top });
      } else {
        // Gercek bir boyutlandirma oldu — bundan sonra sabit piksel degerine gecer.
        setPos({ x: rect.left, y: rect.top });
        setSize({ w: rect.width, h: rect.height });
      }
    }
    dragRef.current = null;
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, [onPointerMove]);

  const startMove = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = { mode: "move", startX: e.clientX, startY: e.clientY, origX: rect.left, origY: rect.top, origW: rect.width, origH: rect.height };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }, [onPointerMove, onPointerUp]);

  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = { mode: "resize", startX: e.clientX, startY: e.clientY, origX: rect.left, origY: rect.top, origW: rect.width, origH: rect.height };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }, [onPointerMove, onPointerUp]);

  const recenter = useCallback(() => {
    setSize({ w: defaultSize.w, h: initialH });
    setPos(centeredPos(defaultSize.w, autoHeight ? minSize.h : defaultSize.h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultSize.w, defaultSize.h, initialH, autoHeight, minSize.h]);

  useEffect(() => () => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    document.body.style.userSelect = "";
  }, [onPointerMove, onPointerUp]);

  return { ref, pos, size, startMove, startResize, recenter };
}

// Sağ-alt köşe için görünür, ortak boyutlandırma tutamacı JSX'i — hem JobTrackerBar
// hem SurveyModal aynı görseli kullanır.
export function ResizeHandle({ onPointerDown }: { onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <div
      onPointerDown={onPointerDown}
      title="Boyutlandırmak için sürükleyin"
      className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize flex items-end justify-end p-1 z-10"
    >
      <svg viewBox="0 0 10 10" className="w-3 h-3 text-current opacity-40">
        <path d="M9 1L1 9M9 5L5 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    </div>
  );
}
