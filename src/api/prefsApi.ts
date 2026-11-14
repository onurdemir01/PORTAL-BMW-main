import { okJson } from './http';
// src/api/prefsApi.ts — Kullanici tercihleri (portal_user_preferences) API istemcisi.
// UI durumu (tema, envanter kolon secimi, aktif admin sekmesi...) sunucuda kullanici
// basina saklanir — restart ve tarayici degisiminde korunur. localStorage yalnizca
// anlik-acilis (FOUC) cache'i olarak kalir; login sonrasi sunucu degeri kazanir.

export type PrefValue = string | null;

async function json<T>(res: Response): Promise<T> {
  return okJson<T>(res);
}

let _cache: Record<string, string> | null = null;
let _inflight: Promise<Record<string, string>> | null = null;
let _queued: Record<string, PrefValue> = {};
let _waiters: Array<{ resolve: () => void; reject: (err: unknown) => void }> = [];
let _timer: ReturnType<typeof setTimeout> | null = null;
let _debounceMs = 250;

function isNoopChange(key: string, val: PrefValue): boolean {
  if (Object.prototype.hasOwnProperty.call(_queued, key)) {
    return _queued[key] === val;
  }
  if (_cache === null) return false;
  if (val === null) return !Object.prototype.hasOwnProperty.call(_cache, key);
  return _cache[key] === val;
}

function applyBatchToCache(batch: Record<string, PrefValue>): void {
  if (!_cache) return;
  for (const [k, v] of Object.entries(batch)) {
    if (v === null) delete _cache[k];
    else _cache[k] = v;
  }
}

async function flushQueuedPrefs(): Promise<void> {
  if (_timer !== null) {
    clearTimeout(_timer);
    _timer = null;
  }
  const batch = { ..._queued };
  const waiters = _waiters.slice();
  _queued = {};
  _waiters = [];

  if (Object.keys(batch).length === 0) {
    for (const w of waiters) w.resolve();
    return;
  }

  try {
    const res = await fetch('/api/auth/prefs', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefs: batch }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(
        (body as { error?: string } | null)?.error || `Tercih kaydedilemedi (HTTP ${res.status}).`,
      );
    }
    applyBatchToCache(batch);
    for (const w of waiters) w.resolve();
  } catch (err) {
    for (const w of waiters) w.reject(err);
    throw err;
  }
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', () => {
    void flushQueuedPrefs().catch(() => {});
  });
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void flushQueuedPrefs().catch(() => {});
    }
  });
}

export const prefsApi = {
  // Tum tercihleri getirir (oturum basina bir kez; cache'lenir).
  async getAll(force = false): Promise<Record<string, string>> {
    if (_cache && !force) return _cache;
    if (_inflight && !force) return _inflight;
    _inflight = (async () => {
      try {
        const res = await fetch('/api/auth/prefs', { credentials: 'include' });
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

  // Tek/coklu tercih yazar (null -> siler). Ardisik degisiklikleri tek PUT isteginde
  // birlestirir ve yerel cache ile ayni olan yazimlari sunucuya hic gondermez.
  set(prefs: Record<string, PrefValue>): Promise<void> {
    let hasChange = false;
    for (const [k, v] of Object.entries(prefs)) {
      if (!isNoopChange(k, v)) {
        _queued[k] = v;
        hasChange = true;
      }
    }
    if (!hasChange && _waiters.length === 0) {
      return Promise.resolve();
    }
    if (_debounceMs <= 0) {
      return flushQueuedPrefs();
    }
    return new Promise<void>((resolve, reject) => {
      _waiters.push({ resolve, reject });
      if (_timer !== null) clearTimeout(_timer);
      _timer = setTimeout(() => {
        void flushQueuedPrefs().catch(() => {});
      }, _debounceMs);
    });
  },

  flush(): Promise<void> {
    return flushQueuedPrefs();
  },

  _setDebounceMs(ms: number): void {
    _debounceMs = ms;
  },

  _resetForTests(): void {
    if (_timer !== null) {
      clearTimeout(_timer);
      _timer = null;
    }
    _cache = null;
    _inflight = null;
    _queued = {};
    _waiters = [];
    _debounceMs = 250;
  },
};
