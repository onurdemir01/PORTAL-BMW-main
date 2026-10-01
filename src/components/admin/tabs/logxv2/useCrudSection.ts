// src/components/admin/tabs/logxv2/useCrudSection.ts — liste/olustur/guncelle/sil
// uclarini tek durumda toplayan ortak hook. OCP Yapilandirma ve LogX Yonetimi
// sekmeleri ayni deseni kullanir.
import { useState } from 'react';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';

export function useCrudSection<T extends { id: number }>(
  list: () => Promise<{ ok: boolean; rows: T[] }>,
  create: (data: Partial<T>) => Promise<{ ok: boolean; row: T }>,
  update: (id: number, data: Partial<T>) => Promise<{ ok: boolean; row: T }>,
  remove: (id: number) => Promise<{ ok: boolean }>,
) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await list();
      setRows(r.rows);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useAsyncEffect(async () => {
    await load();
  }, []);

  return {
    rows,
    loading,
    error,
    reload: load,
    onCreate: async (data: Partial<T>) => {
      const r = await create(data);
      setRows((prev) => [...prev, r.row]);
    },
    onUpdate: async (id: number, data: Partial<T>) => {
      const r = await update(id, data);
      setRows((prev) => prev.map((x) => (x.id === id ? r.row : x)));
    },
    onDelete: async (id: number) => {
      await remove(id);
      setRows((prev) => prev.filter((x) => x.id !== id));
    },
  };
}
