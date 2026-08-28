// src/components/layout/Masthead.tsx — PatternFly Masthead (OpenShift Console ust bandi).
//
// Yapi (soldan saga): nav toggle | logo + urun adi | AYIRICI | ... | araclar (arama,
// tema, kullanici menusu). Renk/olculer index.css'teki --masthead-*/--nav-* token'larindan
// gelir.
//
// TEMAYI IZLER (2026-08-28): PF6'da masthead artik sabit siyah DEGIL, tema ile birlikte
// degisir (acik #f2f2f2, koyu #151515 — masthead.css: background--color--secondary).
// Bu yuzden buradaki sabit renkler (text-white, #b8bbbe, #3c3f42, #4f5255) token'a
// cevrildi; kalsalardi acik temada beyaz uzerine beyaz metin cikardi.
import React, { useContext, useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  Bars3Icon,
  MagnifyingGlassIcon,
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

      {/* MARKA BLOGU. Logo 28px -> 36px (PF6 masthead__logo--MaxHeight = 38px, sinir
          icinde) ve saginda ince bir dikey AYIRICI var (OpenShift Console deseni):
          marka alani arac ikonlarindan gorsel olarak ayrisir, logo kalabalikta
          kaybolmaz. */}
      <NavLink to="/dashboard" className="flex items-center gap-2.5 pl-1 pr-4 no-underline">
        <PortalLogo className="h-9 w-9" />
        <span
          className="hidden sm:block text-[1.0625rem]"
          style={{ fontFamily: "var(--font-display)", fontWeight: 500, color: "var(--nav-text)" }}
        >
          BMW <span style={{ color: "var(--nav-text-muted)" }}>Portal</span>
        </span>
      </NavLink>
      <span aria-hidden="true" className="hidden sm:block h-8 w-px" style={{ background: "var(--masthead-border)" }} />

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

        {/* Kullanici menusu — PF masthead dropdown */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 h-10 px-3 text-[0.875rem] transition-colors hover:bg-[var(--nav-hover-bg)]"
            style={{ color: "var(--nav-text)", borderRadius: "var(--radius-sm)" }}
            aria-expanded={menuOpen}
          >
            {user?.photoUrl ? (
              <img src={user.photoUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
            ) : (
              <span
                className="h-6 w-6 rounded-full text-[0.6875rem] flex items-center justify-center"
                style={{ background: "var(--accent)", color: "var(--text-on-accent)" }}
              >
                {initial}
              </span>
            )}
            <span className="hidden md:inline max-w-[11rem] truncate" title={displayName}>{displayName}</span>
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
