import { safeJson } from "./http";
// src/api/prefsApi.ts — Kullanici tercihleri (portal_user_preferences) API istemcisi.
// UI durumu (tema, envanter kolon secimi, aktif admin sekmesi...) sunucuda kullanici
// basina saklanir — restart ve tarayici degisiminde korunur. localStorage yalnizca
// anlik-acilis (FOUC) cache'i olarak kalir; login sonrasi sunucu degeri kazanir.

export type PrefValue = string | null;

async function json<T>(res: Response): Promise<T> {
  const data = await safeJson(res);
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data as T;
}

let _cache: Record<string, string> | null = null;
let _inflight: Promise<Record<string, string>> | null = null;

export const prefsApi = {
  // Tum tercihleri getirir (oturum basina bir kez; cache'lenir).
  async getAll(force = false): Promise<Record<string, string>> {
    if (_cache && !force) return _cache;
    if (_inflight && !force) return _inflight;
    _inflight = (async () => {
      try {
        const res = await fetch("/api/auth/prefs", { credentials: "include" });
        const d = await json<{ ok: boolean; prefs?: Record<string, string> }>(res);
        _cache = d.prefs ?? {};
      } catch {
        _cache = {};
      } finally {
        _inflight = null;
      }
      return _cache!;
    })();
    return _inflight;
  },

  get(key: string): string | undefined {
    return _cache?.[key];
  },

  // Tek/coklu tercih yazar (null → siler). Fire-and-forget kullanim icin catch'li cagrilmali.
  async set(prefs: Record<string, PrefValue>): Promise<void> {
    if (_cache) {
      for (const [k, v] of Object.entries(prefs)) {
        if (v === null) delete _cache[k];
        else _cache[k] = v;
      }
    }
    await fetch("/api/auth/prefs", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefs }),
    });
  },
};
