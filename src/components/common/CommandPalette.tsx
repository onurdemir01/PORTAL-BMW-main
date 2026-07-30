import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { MagnifyingGlassIcon, ArrowRightIcon } from "@heroicons/react/24/outline";
import { useCommandPalette } from "@/hooks/useCommandPalette";

interface PaletteItem {
  label: string;
  description: string;
  to: string;
  keywords?: string;
}

const PAGES: PaletteItem[] = [
  { label: "Dashboard",      description: "Ana sayfa",                    to: "/dashboard",       keywords: "home ana" },
  { label: "Envanter",       description: "Sunucu ve uygulama envanteri", to: "/envanter",        keywords: "server sunucu liste" },
  { label: "LogX",           description: "Güvenli log dosyası indirme",  to: "/logx",            keywords: "log analiz sunucu openshift indirme" },
  { label: "Self Service",   description: "Ansible servis istekleri",     to: "/self-service",    keywords: "ansible servis self" },
  { label: "Ansible",        description: "Template ve job yönetimi",     to: "/ansible",         keywords: "playbook template awx" },
  { label: "Performance",    description: "Dynatrace metrikler",          to: "/performance",     keywords: "dynatrace metric alarm" },
  { label: "Nöbet",          description: "Nöbet çizelgesi",              to: "/duty-roster",     keywords: "nobet roster" },
  { label: "Önemli Linkler", description: "Sık kullanılan bağlantılar",   to: "/important-links", keywords: "link url" },
  { label: "Admin",          description: "Sistem yönetimi",              to: "/admin",           keywords: "admin yonetim" },
];

export function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const filtered = PAGES.filter((p) => {
    const q = query.toLowerCase();
    return (
      p.label.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      (p.keywords || "").toLowerCase().includes(q)
    );
  });

  function go(item: PaletteItem) {
    navigate(item.to);
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      setActiveIdx((i) => Math.max(i - 1, 0));
      e.preventDefault();
    } else if (e.key === "Enter" && filtered[activeIdx]) {
      go(filtered[activeIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  useEffect(() => { setActiveIdx(0); }, [query]);

  if (!open || typeof document === "undefined") return null;

  // Kendine özgü "üstte hizalı" (pt-[15vh]) konumlandırma korunur — merkezde
  // hizalanan diğer modallerden farklı, bilinçli bir tasarım tercihi. Yalnızca
  // dış katmana overflow-y-auto + kutuya max-h eklenir ki çok kısa bir
  // viewport'ta sonuç listesi kaybolmadan kaydırılabilsin.
  return createPortal(
    <div
      className="fixed inset-0 z-[2000] flex items-start justify-center pt-[15vh] px-4 pb-4 bg-black/50 backdrop-blur-sm animate-fade-in overflow-y-auto"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-gray-100 flex flex-col max-h-[75dvh] animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-100 flex-shrink-0">
          <MagnifyingGlassIcon className="w-5 h-5 text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Sayfa ara..."
            className="flex-1 text-sm text-gray-900 placeholder-gray-400 outline-none bg-transparent"
          />
          <kbd className="hidden sm:inline-flex items-center px-2 py-0.5 text-xs text-gray-400 border border-gray-200 rounded-md font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-400">Sonuç bulunamadı.</p>
          ) : (
            filtered.map((item, idx) => (
              <button
                key={item.to}
                onClick={() => go(item)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  idx === activeIdx ? "bg-blue-50" : "hover:bg-gray-50"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${idx === activeIdx ? "text-[#1A56DB]" : "text-gray-900"}`}>
                    {item.label}
                  </p>
                  <p className="text-xs text-gray-400 truncate">{item.description}</p>
                </div>
                <ArrowRightIcon className={`w-3.5 h-3.5 flex-shrink-0 ${idx === activeIdx ? "text-[#1A56DB]" : "text-gray-300"}`} />
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 py-2.5 border-t border-gray-100 bg-gray-50/50 flex-shrink-0">
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 text-xs border border-gray-200 rounded font-mono bg-white">↑↓</kbd>
            Gezin
          </span>
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 text-xs border border-gray-200 rounded font-mono bg-white">↵</kbd>
            Aç
          </span>
          <span className="ml-auto text-xs text-gray-400">
            <kbd className="px-1.5 py-0.5 text-xs border border-gray-200 rounded font-mono bg-white">Ctrl K</kbd>
            {" "}aç/kapat
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}
