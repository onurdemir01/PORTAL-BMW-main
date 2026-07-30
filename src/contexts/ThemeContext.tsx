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
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme(): ThemeCtx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme, <ThemeProvider> içinde kullanılmalı.");
  return ctx;
}
