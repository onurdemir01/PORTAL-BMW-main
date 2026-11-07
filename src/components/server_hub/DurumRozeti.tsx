// src/components/server_hub/DurumRozeti.tsx — Server Hub'ın küçük durum rozeti (2026-11-07).
//
// Uygulama 360 matrisi, sunucu panelinin zincir kartları ve özet kartları aynı tonları kullanır. Metin HER
// ZAMAN metin tokenıyla (--status-*-text); --status-warning açık zeminde AA altında kalıyordu.
import React from 'react';

export type DurumTon = 'iyi' | 'uyari' | 'kotu' | 'notr';

export const DURUM_TON: Record<DurumTon, React.CSSProperties> = {
  iyi: {
    background: 'var(--status-success-bg)',
    color: 'color-mix(in srgb, var(--status-success) 55%, var(--text-primary))',
  },
  uyari: { background: 'var(--status-warning-bg)', color: 'var(--status-warning-text)' },
  kotu: { background: 'var(--status-danger-bg)', color: 'var(--status-danger-text)' },
  notr: { background: 'var(--bg-elevated)', color: 'var(--text-secondary)' },
};

export default function DurumRozeti({
  metin,
  ton,
  title,
}: {
  metin: string;
  ton: DurumTon;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-full px-2 text-[10px] font-semibold whitespace-nowrap"
      style={DURUM_TON[ton]}
    >
      {metin}
    </span>
  );
}
