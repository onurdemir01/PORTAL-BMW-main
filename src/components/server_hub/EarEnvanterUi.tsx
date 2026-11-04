// src/components/server_hub/EarEnvanterUi.tsx — Uygulama Envanteri ekranının küçük ortak parçaları.
import React from 'react';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { TON, type DurumBilgisi } from './earEnvanter';

export const BTN =
  'inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium leading-none rounded-lg border whitespace-nowrap disabled:opacity-40';
export const btnStil = (birincil = false): React.CSSProperties =>
  birincil
    ? {
        background: 'var(--accent)',
        borderColor: 'var(--accent)',
        color: 'var(--text-on-accent, #fff)',
      }
    : {
        background: 'var(--bg-surface)',
        borderColor: 'var(--border)',
        color: 'var(--text-primary)',
      };
export const GIRDI = 'h-7 px-2 text-xs rounded-lg border';
export const girdiStil: React.CSSProperties = {
  background: 'var(--bg-surface)',
  borderColor: 'var(--border)',
  color: 'var(--text-primary)',
};

/** Durum rozeti: renk + metin + açıklama (title). Renk tek başına anlam taşımaz. */
export function Rozet({ d, kucuk = false }: { d: DurumBilgisi; kucuk?: boolean }) {
  const t = TON[d.ton];
  return (
    <span
      title={d.aciklama}
      data-ton={d.ton}
      className={`inline-flex items-center gap-1 rounded-full px-2 ${kucuk ? 'py-0 text-[10px]' : 'py-0.5 text-[11px]'} font-semibold whitespace-nowrap`}
      style={{ background: t.zemin, color: t.metin }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.renk }} aria-hidden />
      {d.etiket}
    </span>
  );
}

/** Kırpılan hücre: tam değer title'da. */
export function Kirp({
  v,
  en = 'max-w-[16rem]',
  mono = false,
}: {
  v: string | null | undefined;
  en?: string;
  mono?: boolean;
}) {
  const s = v == null || v === '' ? '—' : String(v);
  return (
    <span className={`block truncate ${en} ${mono ? 'font-mono' : ''}`} title={s}>
      {s}
    </span>
  );
}

export function IndirBag({
  href,
  children,
  title,
}: {
  href: string;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <a href={href} download className={BTN} style={btnStil()} title={title}>
      <ArrowDownTrayIcon className="w-3.5 h-3.5" aria-hidden />
      {children}
    </a>
  );
}

export function Kart({
  baslik,
  deger,
  alt,
  ton,
}: {
  baslik: string;
  deger: React.ReactNode;
  alt?: React.ReactNode;
  ton?: keyof typeof TON;
}) {
  return (
    <div
      className="rounded-lg border px-3 py-2 min-w-[9rem]"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
    >
      <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {baslik}
      </div>
      <div
        className="text-lg font-semibold"
        style={{ color: ton ? TON[ton].metin : 'var(--text-primary)' }}
      >
        {deger}
      </div>
      {alt && (
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {alt}
        </div>
      )}
    </div>
  );
}

export const TABLO = 'w-full text-xs pf-table-sticky';
export const TH = 'px-2 py-1.5 text-left font-medium whitespace-nowrap';
export const TD = 'px-2 py-1.5 align-top';
export const thStil: React.CSSProperties = {
  color: 'var(--text-muted)',
  background: 'var(--bg-elevated)',
};
