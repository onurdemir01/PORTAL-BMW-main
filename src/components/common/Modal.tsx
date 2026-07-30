import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { XMarkIcon } from "@heroicons/react/24/outline";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  children: React.ReactNode;
}

const SIZE_MAP = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
};

// PatternFly Modal: duz beyaz kutu (3px kose), 20px Red Hat Display baslik,
// sag ustte kapat butonu, altta SOLA hizali aksiyon barı (PF konvansiyonu).
export function Modal({ open, onClose, title, subtitle, icon: Icon, footer, size = "md", children }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] overflow-y-auto p-4"
      style={{ background: "rgba(3,3,3,0.62)" }}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={overlayRef}
        className="min-h-full flex items-center justify-center"
        onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      >
        <div
          className={`relative w-full ${SIZE_MAP[size]} flex flex-col max-h-[calc(100dvh-2rem)] my-4`}
          style={{ background: "var(--bg-surface)", boxShadow: "var(--shadow-lg)", borderRadius: "var(--radius-sm)" }}
        >
          <div className="flex items-start gap-3 px-6 pt-6 pb-4 flex-shrink-0">
            {Icon && (
              <span className="flex-shrink-0 mt-0.5" style={{ color: "var(--accent)" }}>
                <Icon className="w-5 h-5" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              {title && (
                <h2
                  className="truncate"
                  style={{ fontFamily: "var(--font-display)", fontSize: "1.25rem", fontWeight: 500, color: "var(--text-primary)" }}
                >
                  {title}
                </h2>
              )}
              {subtitle && <p className="text-[0.875rem] mt-1" style={{ color: "var(--text-muted)" }}>{subtitle}</p>}
            </div>
            <button
              onClick={onClose}
              aria-label="Kapat"
              className="ml-auto -mt-1 -mr-2 p-2 flex-shrink-0 transition-colors"
              style={{ color: "var(--text-muted)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; }}
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
          <div className="px-6 pb-2 overflow-y-auto flex-1 text-[0.875rem]" style={{ color: "var(--text-primary)" }}>
            {children}
          </div>
          {footer && (
            <div className="flex items-center gap-2 px-6 py-5 flex-shrink-0">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
