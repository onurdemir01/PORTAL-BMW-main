// src/components/nginx_console/yukTesti/Grafik.tsx — kademe (k6: istek/sn, wrk: baglanti) -> olcu grafigi, ELLE SVG (2026-10-27).
//
// Yatay eksenin birimi `xBirimi` (2026-10-28): wrk kosusunda adim degeri baglanti sayisidir, istek/sn DEGIL.
// Grafik kutuphanesi YOK (NimTabs Donut/MiniBar ile ayni yol). Tek eksen; her adim (TUR) bir nokta, gecerli
// adimlarin hiz ortalamasi 2px cizgi. Nokta bicimi durumu da tasir (renk tek basina degil): gecerli = dolu
// daire, doyma = dolu baklava, gecersiz = bos daire. Ayni hizdaki tekrarlar hafif yana kaydirilir. Uzerine
// gelince ipucu; ekran okuyucu icin ozet aria-label (ayni veri adim tablosunda da var).
// Genislik ResizeObserver ile olculur: viewBox olceklemesi dar kartta yazilari okunmaz kucultuyordu.
import React, { useLayoutEffect, useRef, useState } from 'react';
import { ondalik, type AdimBirimi } from './yukTestiOrtak';

export interface GrafikNoktasi { x: number; y: number | null; durum: string | null; etiket: string }

const YUKSEKLIK = 196;
const KENAR = { sol: 46, sag: 14, ust: 12, alt: 30 };
const DURUM_ADI: Record<string, string> = { GECERLI: 'geçerli', DOYMA: 'doyma', GECERSIZ: 'geçersiz', HATALI: 'hatalı' };

/** 0'dan baslayan "guzel" eksen: adim 1 / 2 / 2,5 / 5 x 10^n, en cok ~5 cizgi. */
export function eksenAdimlari(enBuyuk: number): number[] {
  if (!(enBuyuk > 0)) return [0, 1];
  const kaba = (enBuyuk * 1.12) / 4;
  const us = 10 ** Math.floor(Math.log10(kaba));
  const adim = [1, 2, 2.5, 5, 10].map((k) => k * us).find((a) => a >= kaba) as number;
  const out: number[] = [];
  for (let v = 0; v <= enBuyuk * 1.12 + adim * 0.5 && out.length < 8; v += adim) out.push(Number(v.toPrecision(12)));
  if (out[out.length - 1] < enBuyuk) out.push(Number((out[out.length - 1] + adim).toPrecision(12)));
  return out;
}

function useGenislik(varsayilan = 420) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(varsayilan);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(Math.max(240, Math.round(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function Isaret({ durum, x, y }: { durum: string | null; x: number; y: number }) {
  const halka = { stroke: 'var(--bg-surface)', strokeWidth: 2 };
  if (durum === 'GECERSIZ' || durum === 'HATALI') return <circle cx={x} cy={y} r={4.5} fill="var(--bg-surface)" stroke="var(--status-danger)" strokeWidth={2} />;
  if (durum === 'DOYMA') return <path d={`M${x} ${y - 6}L${x + 6} ${y}L${x} ${y + 6}L${x - 6} ${y}Z`} fill="var(--status-warning)" {...halka} />;
  return <circle cx={x} cy={y} r={5} fill="var(--accent)" {...halka} />;
}

export default function HizGrafigi({ baslik, birim, noktalar, cizgi, basamak = 1, bos = 'Ölçülmüş değer yok.', xBirimi = 'istek/sn' }: {
  baslik: string; birim: string; noktalar: GrafikNoktasi[]; cizgi: { x: number; y: number | null }[]; basamak?: number; bos?: string;
  xBirimi?: AdimBirimi;
}) {
  const [ref, genislik] = useGenislik();
  const [uzerinde, setUzerinde] = useState<number | null>(null);
  const olcu = noktalar.filter((n) => n.y != null && Number.isFinite(n.y));
  const xler = [...new Set(noktalar.map((n) => n.x))].sort((a, b) => a - b);
  const enX = xler.length ? xler[xler.length - 1] : 1;
  const xUst = xler.length > 1 ? enX * 1.08 : enX * 1.25 || 1;
  const yAdim = eksenAdimlari(Math.max(0, ...olcu.map((n) => n.y as number)));
  const yUst = yAdim[yAdim.length - 1] || 1;
  const cizimG = genislik - KENAR.sol - KENAR.sag;
  const cizimY = YUKSEKLIK - KENAR.ust - KENAR.alt;
  const px = (x: number) => KENAR.sol + (x / xUst) * cizimG;
  const py = (y: number) => KENAR.ust + cizimY - (y / yUst) * cizimY;
  // Ayni hizdaki tekrarlar yan yana (iki tekrar +-5,5 px; isaretler ust uste binmez).
  const sira = new Map<number, number>();
  const yerler = noktalar.map((n) => {
    const i = sira.get(n.x) ?? 0;
    sira.set(n.x, i + 1);
    return i;
  });
  const ayni = (x: number) => noktalar.filter((n) => n.x === x).length;
  const kaydir = (k: number) => {
    const n = ayni(noktalar[k].x);
    return n > 1 ? (yerler[k] - (n - 1) / 2) * Math.min(11, 22 / (n - 1)) : 0;
  };
  const yol = cizgi.filter((c) => c.y != null).sort((a, b) => a.x - b.x).map((c, i) => `${i ? 'L' : 'M'}${px(c.x).toFixed(1)} ${py(c.y as number).toFixed(1)}`).join('');
  const ozet = olcu.length
    ? `${baslik}: ${xler.map((x) => `${x} ${xBirimi} ${cizgi.find((c) => c.x === x)?.y != null ? `${ondalik(cizgi.find((c) => c.x === x)?.y, basamak)} ${birim}` : 'ölçülmedi'}`).join(', ')}`
    : `${baslik}: ${bos}`;
  const u = uzerinde != null ? noktalar[uzerinde] : null;
  const yIpucu = (n: GrafikNoktasi) => `${n.etiket}: ${n.y == null ? 'ölçülmedi' : `${ondalik(n.y, basamak)} ${birim}`}${n.durum ? ` · ${DURUM_ADI[n.durum] || n.durum}` : ''}`;
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{baslik}</span>
        <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{birim} · yatay: {xBirimi}</span>
      </figcaption>
      <div ref={ref} className="relative w-full">
        {!olcu.length ? (
          <div className="flex items-center justify-center rounded-lg border border-dashed text-[12px]" style={{ height: YUKSEKLIK, borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>{bos}</div>
        ) : (
          <svg width={genislik} height={YUKSEKLIK} role="img" aria-label={ozet} className="block max-w-full" onMouseLeave={() => setUzerinde(null)}>
            {yAdim.map((v) => (
              <g key={v}>
                <line x1={KENAR.sol} x2={genislik - KENAR.sag} y1={py(v)} y2={py(v)} stroke={v === 0 ? 'var(--border)' : 'var(--border-subtle)'} strokeWidth={1} />
                <text x={KENAR.sol - 6} y={py(v)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-secondary)" style={{ fontVariantNumeric: 'tabular-nums' }}>{ondalik(v, v % 1 ? 1 : 0)}</text>
              </g>
            ))}
            {xler.map((x) => (
              <text key={x} x={px(x)} y={YUKSEKLIK - KENAR.alt + 16} textAnchor="middle" fontSize={11} fill="var(--text-secondary)" style={{ fontVariantNumeric: 'tabular-nums' }}>{x}</text>
            ))}
            {yol && <path d={yol} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />}
            {noktalar.map((n, k) => (n.y == null ? null : <Isaret key={k} durum={n.durum} x={px(n.x) + kaydir(k)} y={py(n.y)} />))}
            {noktalar.map((n, k) => (n.y == null ? null : (
              <circle key={`h${k}`} cx={px(n.x) + kaydir(k)} cy={py(n.y)} r={11} fill="transparent" onMouseEnter={() => setUzerinde(k)}>
                <title>{yIpucu(n)}</title>
              </circle>
            )))}
          </svg>
        )}
        {u && u.y != null && (
          <div role="presentation" className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] leading-4 shadow-sm"
            style={{ left: Math.min(Math.max(px(u.x) - 60, 0), genislik - 150), top: Math.max(py(u.y) - 44, 0), background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
            {yIpucu(u)}
          </div>
        )}
      </div>
      {olcu.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]" style={{ color: 'var(--text-secondary)' }} aria-hidden>
          <span className="inline-flex items-center gap-1"><svg width="12" height="12"><Isaret durum="GECERLI" x={6} y={6} /></svg>geçerli</span>
          <span className="inline-flex items-center gap-1"><svg width="14" height="14"><Isaret durum="DOYMA" x={7} y={7} /></svg>doyma</span>
          <span className="inline-flex items-center gap-1"><svg width="12" height="12"><Isaret durum="GECERSIZ" x={6} y={6} /></svg>geçersiz</span>
          <span className="inline-flex items-center gap-1"><svg width="16" height="8"><line x1="1" x2="15" y1="4" y2="4" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" /></svg>ortalama</span>
        </div>
      )}
    </figure>
  );
}
