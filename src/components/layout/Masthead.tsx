// src/components/layout/Masthead.tsx — PatternFly Masthead (OpenShift Console ust bandi).
//
// Yapi (soldan saga): nav toggle | logo + urun adi | ... | araclar (arama, yardim,
// tema, kullanici menusu). Renk/olculer index.css'teki --masthead-* token'larindan gelir.
import React, { useContext, useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  Bars3Icon,
  MagnifyingGlassIcon,
  QuestionMarkCircleIcon,
  SunIcon,
  MoonIcon,
  ArrowRightOnRectangleIcon,
  ChevronDownIcon,
  UserCircleIcon,
} from "@heroicons/react/24/outline";
import { AuthContext } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { PortalLogo } from "@/components/common/PortalLogo";

interface Props {
  onToggleNav: () => void;
}

export default function Masthead({ onToggleNav }: Props) {
  const { user, logout } = useContext(AuthContext);
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const displayName = user?.displayName || user?.username || "?";
  const initial = displayName[0]?.toUpperCase() ?? "?";

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Ctrl+K komut paletini acan mevcut global kisayolu tetikler.
  const openSearch = () =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));

  return (
    <header className="pf-masthead">
      <button className="pf-masthead-btn" onClick={onToggleNav} aria-label="Navigasyonu ac/kapat">
        <Bars3Icon className="h-5 w-5" />
      </button>

      <NavLink to="/dashboard" className="flex items-center gap-2 pl-1 pr-4 no-underline">
        <PortalLogo className="h-7 w-7" />
        <span
          className="hidden sm:block text-[1.0625rem] text-white"
          style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
        >
          BMW <span style={{ color: "#b8bbbe" }}>Portal</span>
        </span>
      </NavLink>

      <div className="flex-1" />

      <div className="flex items-center">
        <button className="pf-masthead-btn" onClick={openSearch} aria-label="Ara (Ctrl+K)" title="Ara (Ctrl+K)">
          <MagnifyingGlassIcon className="h-5 w-5" />
        </button>

        <button
          className="pf-masthead-btn"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Acik temaya gec" : "Koyu temaya gec"}
          title={theme === "dark" ? "Acik tema" : "Koyu tema"}
        >
          {theme === "dark" ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
        </button>

        <NavLink to="/important-links" className="pf-masthead-btn" aria-label="Yardim ve baglantilar" title="Yardim ve baglantilar">
          <QuestionMarkCircleIcon className="h-5 w-5" />
        </NavLink>

        {/* Kullanici menusu — PF masthead dropdown */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 h-10 px-3 text-[0.875rem] text-white/90 hover:bg-[#3c3f42] transition-colors"
            aria-expanded={menuOpen}
          >
            {user?.photoUrl ? (
              <img src={user.photoUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
            ) : (
              <span className="h-6 w-6 rounded-full bg-[#4f5255] text-white text-[0.6875rem] flex items-center justify-center">
                {initial}
              </span>
            )}
            <span className="hidden md:inline max-w-[11rem] truncate">{displayName}</span>
            <ChevronDownIcon className="h-3.5 w-3.5 opacity-70" />
          </button>

          {menuOpen && (
            <div
              className="absolute right-0 top-full min-w-[14rem] py-1 z-50"
              style={{ background: "var(--bg-surface)", boxShadow: "var(--shadow-lg)", border: "1px solid var(--border)" }}
            >
              <div className="px-4 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                <p className="text-[0.875rem] font-bold" style={{ color: "var(--text-primary)" }}>{displayName}</p>
                <p className="text-[0.75rem]" style={{ color: "var(--text-muted)" }}>{user?.role}</p>
              </div>
              <NavLink
                to="/duty-roster"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-4 py-2 text-[0.875rem] no-underline hover:bg-[var(--bg-elevated)]"
                style={{ color: "var(--text-primary)" }}
              >
                <UserCircleIcon className="h-4 w-4" /> Nobet listesi
              </NavLink>
              <button
                onClick={() => { setMenuOpen(false); logout(); }}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-[0.875rem] hover:bg-[var(--bg-elevated)]"
                style={{ color: "var(--text-primary)" }}
              >
                <ArrowRightOnRectangleIcon className="h-4 w-4" /> Oturumu kapat
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
