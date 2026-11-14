import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prefsApi } from '../prefsApi';
import { visibilityApi } from '../adminApi';

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('prefsApi coalescing debounce and no-op deduplication', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    prefsApi._resetForTests();
  });

  afterEach(() => {
    prefsApi._resetForTests();
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it('coalesces rapid consecutive set() calls into a single PUT /api/auth/prefs', async () => {
    const fetchMock = vi.fn(async () => jsonRes({ ok: true, written: 2 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const p1 = prefsApi.set({ theme: 'dark', cols: 'a' });
    const p2 = prefsApi.set({ cols: 'b' });
    const p3 = prefsApi.set({ pageSize: '50' });

    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(260);
    await Promise.all([p1, p2, p3]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      prefs: { theme: 'dark', cols: 'b', pageSize: '50' },
    });
  });

  it('skips redundant PUT requests when cached values match unchanged writes', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return jsonRes({ ok: true, written: 1 });
      }
      return jsonRes({ ok: true, prefs: { theme: 'light' } });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await prefsApi.getAll();
    expect(prefsApi.get('theme')).toBe('light');

    await prefsApi.set({ theme: 'light', absentKey: null });
    await vi.advanceTimersByTimeAsync(300);

    // Only GET /api/auth/prefs was called, zero PUTs.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Deleting an existing cached key sends a PUT and clears it from _cache on flush().
    const delPromise = prefsApi.set({ theme: null });
    await prefsApi.flush();
    await delPromise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(prefsApi.get('theme')).toBeUndefined();
  });

  it('propagates HTTP error to coalesced callers without mutating _cache', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return jsonRes({ ok: false, error: 'db locked' }, 500);
      }
      return jsonRes({ ok: true, prefs: { theme: 'light' } });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await prefsApi.getAll();

    const p1 = prefsApi.set({ theme: 'dark' });
    const p2 = prefsApi.set({ cols: 'v2' });
    p1.catch(() => {});
    p2.catch(() => {});

    await expect(prefsApi.flush()).rejects.toThrow(/db locked/);
    await expect(p1).rejects.toThrow(/db locked/);
    await expect(p2).rejects.toThrow(/db locked/);
    expect(prefsApi.get('theme')).toBe('light');
  });

  it('deduplicates simultaneous overlapping visibilityApi.getVersion() calls', async () => {
    let releaseFetch!: () => void;
    const gate = new Promise<void>((r) => {
      releaseFetch = r;
    });
    const fetchMock = vi.fn(async () => {
      await gate;
      return jsonRes({ ok: true, version: 7 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const a = visibilityApi.getVersion();
    const b = visibilityApi.getVersion();
    releaseFetch();
    const [r1, r2] = await Promise.all([a, b]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r1).toEqual({ version: 7, unauthorized: false });
    expect(r2).toEqual({ version: 7, unauthorized: false });
  });
});
