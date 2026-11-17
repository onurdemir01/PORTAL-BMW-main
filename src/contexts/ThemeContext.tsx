// src/contexts/ThemeContext.tsx — Portal geneli light/dark tema.
// Tema `<html data-theme="light|dark">` ile taşınır (index.css bu attribute'a göre token
// değerlerini değiştirir). İlk tema index.html'deki senkron init script'iyle FOUC'suz set
// edilir; bu context onu okuyup React state'ine bağlar, değişiklikte data-theme + localStorage'ı
// günceller ve (kullanıcı açık seçim yapmadıysa) OS tercih değişimini dinler.
import React, { createContext, useContext, useCallback, useEffect, useState } from "react";
import { prefsApi } from "../api/prefsApi";

export type Theme = "light" | "dark";
const STORAGE_KEY = "bmw-theme";

interface ThemeCtx {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  /** Renk korlugu modu (2026-11-17): kirmizi/yesil yerine turuncu/mavi; temadan bagimsiz. */
  renkKoru: boolean;
  setRenkKoru: (acik: boolean) => void;
}
const RENK_KEY = "bmw-renk";

function currentDomRenk(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute("data-renk") === "cvd";
}

function applyRenk(acik: boolean) {
  if (typeof document === "undefined") return;
  if (acik) document.documentElement.setAttribute("data-renk", "cvd");
  else document.documentElement.removeAttribute("data-renk");
}

const ThemeContext = createContext<ThemeCtx | undefined>(undefined);

function currentDomTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function applyTheme(t: Theme) {
  if (typeof document !== "undefined") document.documentElement.setAttribute("data-theme", t);
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Başlangıç: index.html init script'inin zaten <html>'e yazdığı değeri kullan (senkron).
  const [theme, setThemeState] = useState<Theme>(currentDomTheme);
  const [renkKoru, setRenkKoruState] = useState<boolean>(currentDomRenk);

  const setRenkKoru = useCallback((acik: boolean) => {
    setRenkKoruState(acik);
    applyRenk(acik);
    try { localStorage.setItem(RENK_KEY, acik ? "cvd" : "yok"); } catch { /* storage yoksa yok say */ }
    // Sunucu tercihi: baska tarayicida da ayni mod ve ilk boyamada (server/index.cjs __BMW_BOOT__.renk).
    prefsApi.set({ [RENK_KEY]: acik ? "cvd" : "yok" }).catch(() => { /* DB yoksa localStorage yeter */ });
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    applyTheme(t);
    try { localStorage.setItem(STORAGE_KEY, t); } catch { /* storage yoksa yok say */ }
    // Sunucu tercihi (portal_user_preferences) — tarayici degisiminde de ayni tema gelir.
    prefsApi.set({ [STORAGE_KEY]: t }).catch(() => { /* DB yoksa localStorage yeter */ });
  }, []);

  // Login sonrasi sunucudaki tema tercihi kazanir (localStorage yalnizca FOUC cache'i).
  useEffect(() => {
    let cancelled = false;
    prefsApi.getAll().then((prefs) => {
      // Renk korlugu: sunucuda acik bir secim varsa (cvd / yok) o kazanir.
      const renk = prefs[RENK_KEY];
      if (!cancelled && (renk === "cvd" || renk === "yok")) {
        const acik = renk === "cvd";
        if (acik !== currentDomRenk()) {
          setRenkKoruState(acik);
          applyRenk(acik);
          try { localStorage.setItem(RENK_KEY, renk); } catch { /* yok say */ }
        }
      }
      const server = prefs[STORAGE_KEY];
      if (cancelled || (server !== "light" && server !== "dark")) return;
      if (server !== currentDomTheme()) {
        setThemeState(server);
        applyTheme(server);
        try { localStorage.setItem(STORAGE_KEY, server); } catch { /* yok say */ }
      }
    }).catch(() => { /* oturum yoksa/DB yoksa localStorage devam */ });
    return () => { cancelled = true; };
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  // Kullanıcı AÇIK seçim yapmadıysa (localStorage boş) OS tercih değişimini izle.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      let stored: string | null = null;
      try { stored = localStorage.getItem(STORAGE_KEY); } catch { /* yok say */ }
      if (stored !== "light" && stored !== "dark") {
        const next: Theme = e.matches ? "dark" : "light";
        setThemeState(next);
        applyTheme(next);
      }
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, renkKoru, setRenkKoru }}>
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme(): ThemeCtx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme, <ThemeProvider> içinde kullanılmalı.");
  return ctx;
}
