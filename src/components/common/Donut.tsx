// src/components/common/Donut.tsx — kucuk halka grafik (SVG, kutuphane yok): dilimler, ortada etiket ve alt
// yazi, yaninda renk / ad / deger listesi. Server Hub ve Nginx Console ayni bileseni kopya tasiyordu (2026-11-24).
import React from 'react';
import { fmtNumber } from '@/utils/datetime';

const nf = (n: number) => fmtNumber(n);

export default function Donut({
  parts,
  size = 112,
  label,
  sub,
}: {
  parts: { value: number; color: string; title: string }[];
  size?: number;
  label: React.ReactNode;
  sub?: string;
}) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const r = 40,
    c = 2 * Math.PI * r;
  const activeParts = parts.filter((p) => p.value > 0);
  const slices = activeParts.reduce<
    Array<{ part: (typeof parts)[number]; len: number; offset: number }>
  >((list, p) => {
    const prev = list[list.length - 1];
    const offset = prev ? prev.offset + prev.len : 0;
    const len = (p.value / total) * c;
    list.push({ part: p, len, offset });
    return list;
  }, []);
  return (
    <div className="flex items-center gap-3">
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        role="img"
        aria-label={typeof label === 'string' ? label : undefined}
      >
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--bg-elevated)" strokeWidth="12" />
        {slices.map((s, i) => (
          <circle
            key={i}
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={s.part.color}
            strokeWidth="12"
            strokeDasharray={`${s.len} ${c - s.len}`}
            strokeDashoffset={-s.offset}
            transform="rotate(-90 50 50)"
          >
            <title>
              {s.part.title}: {s.part.value}
            </title>
          </circle>
        ))}
        <text
          x="50"
          y="47"
          textAnchor="middle"
          fontSize="18"
          fontWeight="700"
          fill="var(--text-primary)"
        >
          {typeof label === 'string' ? label : ''}
        </text>
        {sub && (
          <text x="50" y="62" textAnchor="middle" fontSize="8" fill="var(--text-muted)">
            {sub}
          </text>
        )}
      </svg>
      <ul className="text-[11px] space-y-0.5">
        {parts.map((p, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />{' '}
            <span style={{ color: 'var(--text-secondary)' }}>{p.title}</span>{' '}
            <b className="tabular-nums">{nf(p.value)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
