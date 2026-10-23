// src/components/server_hub/sunucuLimiti.tsx — tek seferde girilebilecek sunucu sayısı (2026-10-20).
//
// Kullanıcı: "Tek seferde kaç sunucu yazılabileceğini oraya göstermeni rica ediyorum ve isteğim
// dahilinde bu limitin arttırılabilmesi için de adminlere yetki vermeni istiyorum." Değer sunucudan
// (/api/server-hub/limitler); Admin Server Hub › Kurallar & Limitler'den değiştirir. Sunucu aynı
// sınırı ayrıca uygular — buradaki gösterge yalnız kullanıcıyı önceden uyarır.
import React, { useState } from 'react';
import { serverHubApi, type ShLimitAd } from '@/api/serverHubApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { fmtNumber } from '@/utils/datetime';

/** Sunucunun kod varsayılanları (server/server-hub/ayarlar.cjs LIMITLER ile aynı). */
export const VARSAYILAN_LIMIT: Record<ShLimitAd, number> = { tara: 50, reboot: 50, hazirlik: 500 };

export interface SunucuLimiti {
  /** null = henüz okunmadı (engelleme yapılmaz; sunucu yine uygular) */
  enCok: number | null;
  /** güncel değer okunamadı: varsayılan gösteriliyor */
  tahmini: boolean;
}

export function useSunucuLimiti(ad: ShLimitAd): SunucuLimiti {
  const [s, setS] = useState<SunucuLimiti>({ enCok: null, tahmini: false });
  useAsyncEffect(
    async (alive) => {
      try {
        const r = await serverHubApi.limitler();
        const l = r.ok ? r.limitler.find((x) => x.ad === ad) : undefined;
        if (!alive()) return;
        setS(l ? { enCok: l.gecerli, tahmini: !!r.okunamadi } : { enCok: VARSAYILAN_LIMIT[ad], tahmini: true });
      } catch {
        if (alive()) setS({ enCok: VARSAYILAN_LIMIT[ad], tahmini: true });
      }
    },
    [ad],
  );
  return s;
}

/** Serbest metindeki sunucu adları (virgül / boşluk / satır; FQDN ve port eki kırpılır), tekil. */
export function sunucuAdlari(metin: string): string[] {
  return [
    ...new Set(
      String(metin || '')
        .split(/[\s,;]+/)
        .map((t) => t.trim().replace(/:\d+$/, '').split('.')[0].toUpperCase())
        .filter(Boolean),
    ),
  ];
}

export const limitAsildi = (l: SunucuLimiti, sayi: number) => l.enCok != null && sayi > l.enCok;

/** "12 / 50 sunucu · tek seferde en fazla 50" göstergesi; sınır aşılınca kırmızı ve neden yazar. */
export function LimitNotu({ limit, sayi }: { limit: SunucuLimiti; sayi: number }) {
  if (limit.enCok == null) return null;
  const asti = sayi > limit.enCok;
  return (
    <span
      className="text-[11px] tabular-nums"
      style={{ color: asti ? 'var(--status-danger-text)' : 'var(--text-muted)' }}
      data-testid="sunucu-limiti"
      title="Admin bu sınırı Server Hub › Kurallar & Limitler'den değiştirebilir."
    >
      {fmtNumber(sayi)} / {fmtNumber(limit.enCok)} sunucu · tek seferde en fazla {fmtNumber(limit.enCok)}
      {limit.tahmini ? ' (varsayılan; güncel limit okunamadı)' : ''}
      {asti ? ` — ${fmtNumber(sayi - limit.enCok)} fazla; listeyi bölün ya da Admin Kurallar & Limitler'den artırsın` : ''}
    </span>
  );
}
