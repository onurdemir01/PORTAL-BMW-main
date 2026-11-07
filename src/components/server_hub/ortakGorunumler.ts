// src/components/server_hub/ortakGorunumler.ts — Server Hub tablolarının ortak (Admin) görünümleri (2026-11-07).
//
// EarTablo'nun "Görünümler" menüsüne "Ortak" bölümünü verir: liste, ortak kaydet, sil. Server Hub yalnız
// Admin'e açık olduğundan kaydeden de gören de Admin'dir. Okunamazsa menü bunu söyler ("yok" demez);
// kaydet / sil hatası menüde metin olarak görünür (atılır, EarTablo yakalar).
import { useCallback, useMemo, useState } from 'react';
import { serverHubApi, type ShOrtakGorunum } from '@/api/serverHubApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import type { EarGorunum, EarOrtakGorunumler } from './EarTablo';

const gorunumOf = (g: ShOrtakGorunum): EarGorunum => ({
  ad: g.ad,
  aciklama: g.kaydeden ? `ortak · ${g.kaydeden}` : 'ortak',
  f: g.f,
  s: g.s,
  kolonlar: g.kolonlar,
});

export function useOrtakGorunumler(ekran: string, etkin = true): EarOrtakGorunumler {
  const [liste, setListe] = useState<EarGorunum[]>([]);
  const [okunamadi, setOkunamadi] = useState(false);
  const [yuklendi, setYuklendi] = useState(false);
  useAsyncEffect(
    async (alive) => {
      if (!etkin || yuklendi) return;
      try {
        const r = await serverHubApi.gorunumler(ekran);
        if (!alive()) return;
        setListe((r.gorunumler || []).map(gorunumOf));
        setOkunamadi(!r.ok || r.okunamadi === true);
      } catch {
        if (alive()) setOkunamadi(true);
      } finally {
        if (alive()) setYuklendi(true);
      }
    },
    [ekran, etkin, yuklendi],
  );
  const yanit = useCallback(
    (r: { ok: boolean; message?: string; gorunumler?: ShOrtakGorunum[]; okunamadi?: boolean }) => {
      if (!r.ok) throw new Error(r.message || 'Ortak görünüm kaydedilemedi.');
      setListe((r.gorunumler || []).map(gorunumOf));
      setOkunamadi(r.okunamadi === true);
    },
    [],
  );
  const kaydet = useCallback(
    async (g: EarGorunum) =>
      yanit(
        await serverHubApi.gorunumKaydet(ekran, g.ad, { f: g.f, s: g.s, kolonlar: g.kolonlar }),
      ),
    [ekran, yanit],
  );
  const sil = useCallback(
    async (ad: string) => yanit(await serverHubApi.gorunumSil(ekran, ad)),
    [ekran, yanit],
  );
  return useMemo(
    () => ({ gorunumler: liste, okunamadi, kaydet, sil }),
    [liste, okunamadi, kaydet, sil],
  );
}
