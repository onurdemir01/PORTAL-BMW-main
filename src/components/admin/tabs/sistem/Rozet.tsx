// src/components/admin/tabs/sistem/Rozet.tsx — Admin > Sistem durum etiketi.
//
// `.pf-label` dilinde (index.css); yalniz boyut kuculur. `.pf-label` katmansiz CSS oldugu icin
// Tailwind `text-xs` sinifi onu ezemez — boyut satir ici stille verilir.
// Uyari tonu icin `--gold` kullanilir: metni `--status-warning-text`tir (TK8). `denetim/ui`
// `Pill tone="warning"` burada KULLANILMAZ (sari metin acik temada ~2:1).
//
// YESIL / KIRMIZI METIN (SD6, denetim 2026-10-15): koyu temada `.pf-label--green` (#5ba352)
// acik grup basliginda 2.75:1, `--red` 3.70:1 olculdu; 11px metin icin AA 4.5 gerekir. Metin
// rengi durum token'inin ana metin token'iyla karisimidir: acik temada daha koyu, koyu temada
// daha acik olur, ton korunur. Hex yok; oran SD6'da en kotu zeminlerde hesaplanir.
import React from 'react';

export type RozetTonu = 'grey' | 'red' | 'gold' | 'green' | 'blue';

const METIN: Partial<Record<RozetTonu, string>> = {
  green: 'color-mix(in srgb, var(--status-success) 55%, var(--text-primary))',
  red: 'color-mix(in srgb, var(--status-danger-text) 65%, var(--text-primary))',
};

export default function Rozet({
  ton,
  ikon,
  children,
}: {
  ton: RozetTonu;
  ikon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`pf-label pf-label--${ton}`}
      style={{ fontSize: '0.6875rem', lineHeight: 1.5, padding: '0 0.5rem', color: METIN[ton] }}
    >
      {ikon}
      {children}
    </span>
  );
}
