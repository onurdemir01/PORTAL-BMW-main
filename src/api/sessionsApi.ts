// src/api/sessionsApi.ts — aktif oturumlar (Faz D). Oturum anahtari (sid) istemciye
// hic gelmez; `id` girişte uretilen kisa gorunen kimliktir.
import { safeJson } from './http';

export interface OturumSatiri {
  id: string | null;
  current: boolean;
  createdAt: number | null;
  lastSeenAt: number | null;
  idleExpiresAt: number | null;
  absoluteExpiresAt: number | null;
  remember: boolean;
  ip: string;
  ua: string;
  device: string;
}

async function oku<T>(res: Response): Promise<T> {
  const d = await safeJson(res);
  if (!res.ok || !d?.ok) throw new Error(d?.error || `HTTP ${res.status}`);
  return d as T;
}

export const sessionsApi = {
  async list(): Promise<OturumSatiri[]> {
    return (await oku<{ sessions: OturumSatiri[] }>(await fetch('/api/auth/sessions'))).sessions ?? [];
  },
  async revoke(id: string): Promise<number> {
    const r = await oku<{ revoked: number }>(
      await fetch(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    );
    return r.revoked;
  },
  async revokeOthers(): Promise<number> {
    const r = await oku<{ revoked: number }>(await fetch('/api/auth/sessions?scope=others', { method: 'DELETE' }));
    return r.revoked;
  },
  admin: {
    async list(username: string): Promise<OturumSatiri[]> {
      return (
        await oku<{ sessions: OturumSatiri[] }>(
          await fetch(`/api/auth/sessions/admin/${encodeURIComponent(username)}`),
        )
      ).sessions ?? [];
    },
    async revoke(username: string, id?: string): Promise<number> {
      const q = id ? `?id=${encodeURIComponent(id)}` : '';
      const r = await oku<{ revoked: number }>(
        await fetch(`/api/auth/sessions/admin/${encodeURIComponent(username)}${q}`, { method: 'DELETE' }),
      );
      return r.revoked;
    },
  },
};
