// src/components/nginx_console/yukTesti/CokluGrafik.tsx — Çoklu karşılaştırma grafiği: seçili ölçü × hız, koşu başına çizgi (2026-11-04).
//
// Grafik.tsx kaliplari (ELLE SVG, ResizeObserver genisligi, eksenAdimlari, ipucu kutusu). 16 cizgi okunur kalsin diye:
// ref kalin ve koyu (metin rengi), adaylar 8 kategorik ton (index.css --yt-seri-*; dataviz dogrulayicisindan gecti) ve
// 9. adaydan sonra ayni tonlar kesikli (renk tek basina kimlik tasimaz); her noktada >= 8 px isaret, 2 px yuzey halkasi.
// Lejant tiklanir: o kosu vurgulanir (digerleri soluk), yeniden tik birakir; lejant / cizgi uzerine gelmek gecici vurgular.
// Ayni veri hiz x kosu matrisinde tablo olarak da var (kontrast uyarisi olan tonlarin karsiligi).
import React, { useState } from 'react';
import type { NlCokluOlcu } from '@/api/nginxLoadtestApi';
import { eksenAdimlari, useGenislik } from './Grafik';
import { ondalik } from './yukTestiOrtak';
import { OLCU_TANIM, seriStili } from './cokluKarsilastirma';

export interface CokluSeri { id: number; ad: string; ref: boolean; noktalar: { x: number; y: number | null }[] }

const YUKSEKLIK = 260;
const KENAR = { sol: 52, sag: 14, ust: 12, alt: 30 };

export default function CokluGrafik({ seriler, olcu, xBirimi, vurgu, setVurgu }: {
  seriler: CokluSeri[]; olcu: NlCokluOlcu; xBirimi: string; vurgu: number | null; setVurgu: (id: number | null) => void;
}) {
  const t = OLCU_TANIM[olcu];
  const [ref, genislik] = useGenislik(640);
  const [gecici, setGecici] = useState<number | null>(null);
  const [ipucu, setIpucu] = useState<{ seri: CokluSeri; x: number; y: number } | null>(null);
  const etkin = gecici ?? vurgu;
  const olc = (y: number) => y * t.olcek;
  const tum = seriler.flatMap((s) => s.noktalar.filter((n) => n.y != null && Number.isFinite(n.y)).map((n) => olc(n.y as number)));
  const xler = [...new Set(seriler.flatMap((s) => s.noktalar.map((n) => n.x)))].sort((a, b) => a - b);
  const enX = xler.length ? xler[xler.length - 1] : 1;
  const xUst = xler.length > 1 ? enX * 1.08 : enX * 1.25 || 1;
  const yAdim = eksenAdimlari(Math.max(0, ...tum));
  const yUst = yAdim[yAdim.length - 1] || 1;
  const cizimG = genislik - KENAR.sol - KENAR.sag;
  const cizimY = YUKSEKLIK - KENAR.ust - KENAR.alt;
  const px = (x: number) => KENAR.sol + (x / xUst) * cizimG;
  const py = (y: number) => KENAR.ust + cizimY - (olc(y) / yUst) * cizimY;
  const stil = (s: CokluSeri, i: number) => seriStili(i, s.ref);
  // Aday sirasi (renk kosuya baglidir, siralamaya degil): ref haric giris sirasi.
  const sira = new Map(seriler.filter((s) => !s.ref).map((s, i) => [s.id, i]));
  const yol = (s: CokluSeri) => s.noktalar.filter((n) => n.y != null).sort((a, b) => a.x - b.x).map((n, i) => `${i ? 'L' : 'M'}${px(n.x).toFixed(1)} ${py(n.y as number).toFixed(1)}`).join('');
  const soluk = (s: CokluSeri) => etkin != null && etkin !== s.id;
  const deger = (y: number) => `${t.metin(y)}`;
  const ozet = tum.length ? `${t.ad} / ${xBirimi}: ${seriler.map((s) => `${s.ad}${s.ref ? ' (referans)' : ''} ${s.noktalar.map((n) => `${n.x} ${n.y == null ? 'ölçülmedi' : deger(n.y)}`).join(', ')}`).join('; ')}` : `${t.ad}: ölçülmüş değer yok`;
  // Vurgulanan seri en ustte cizilir.
  const cizimSirasi = [...seriler].sort((a, b) => Number(a.id === etkin) - Number(b.id === etkin) || Number(a.ref) - Number(b.ref));

  return (
    <figure className="min-w-0" data-coklu-grafik>
      <figcaption className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{t.ad}</span>
        <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{t.birim} · yatay: {xBirimi}</span>
      </figcaption>
      <div ref={ref} className="relative w-full">
        {!tum.length ? (
          <div className="flex items-center justify-center rounded-lg border border-dashed text-[12px]" style={{ height: YUKSEKLIK, borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>Bu ölçü seçili koşularda ölçülmedi.</div>
        ) : (
          <svg width={genislik} height={YUKSEKLIK} role="img" aria-label={ozet} className="block max-w-full" onMouseLeave={() => { setIpucu(null); setGecici(null); }}>
            {yAdim.map((v) => (
              <g key={v}>
                <line x1={KENAR.sol} x2={genislik - KENAR.sag} y1={KENAR.ust + cizimY - (v / yUst) * cizimY} y2={KENAR.ust + cizimY - (v / yUst) * cizimY} stroke={v === 0 ? 'var(--border)' : 'var(--border-subtle)'} strokeWidth={1} />
                <text x={KENAR.sol - 6} y={KENAR.ust + cizimY - (v / yUst) * cizimY} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-secondary)" style={{ fontVariantNumeric: 'tabular-nums' }}>{ondalik(v, v % 1 ? 1 : 0)}</text>
              </g>
            ))}
            {xler.map((x) => (
              <text key={x} x={px(x)} y={YUKSEKLIK - KENAR.alt + 16} textAnchor="middle" fontSize={11} fill="var(--text-secondary)" style={{ fontVariantNumeric: 'tabular-nums' }}>{x}</text>
            ))}
            {cizimSirasi.map((s) => {
              const st = stil(s, sira.get(s.id) ?? 0);
              const d = yol(s);
              return (
                <g key={s.id} data-seri={s.id} opacity={soluk(s) ? 0.18 : 1}>
                  {d && <path d={d} fill="none" stroke={st.renk} strokeWidth={s.id === etkin && !s.ref ? 3 : st.kalinlik} strokeDasharray={st.kesik} strokeLinejoin="round" strokeLinecap="round" />}
                  {d && <path d={d} fill="none" stroke="transparent" strokeWidth={12} onMouseEnter={() => setGecici(s.id)} />}
                  {s.noktalar.map((n) => (n.y == null ? null : (
                    <circle key={n.x} cx={px(n.x)} cy={py(n.y)} r={s.ref ? 5 : 4} fill={st.renk} stroke="var(--bg-surface)" strokeWidth={2}
                      onMouseEnter={() => { setGecici(s.id); setIpucu({ seri: s, x: n.x, y: n.y as number }); }}>
                      <title>{`${s.ad}${s.ref ? ' (referans)' : ''} · ${n.x} ${xBirimi}: ${deger(n.y)}`}</title>
                    </circle>
                  )))}
                </g>
              );
            })}
          </svg>
        )}
        {ipucu && (
          <div role="presentation" className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] leading-4 shadow-sm"
            style={{ left: Math.min(Math.max(px(ipucu.x) - 70, 0), genislik - 180), top: Math.max(py(ipucu.y) - 46, 0), background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
            <div className="font-semibold">{ipucu.seri.ad}{ipucu.seri.ref ? ' (referans)' : ''}</div>
            <div className="tabular-nums">{`${ipucu.x} ${xBirimi}: ${deger(ipucu.y)}`}</div>
          </div>
        )}
      </div>
      {seriler.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-1 gap-y-1 text-[11px]" aria-label="Lejant: tıklayınca koşuyu vurgular">
          {seriler.map((s) => {
            const st = stil(s, sira.get(s.id) ?? 0);
            const secili = vurgu === s.id;
            return (
              <li key={s.id}>
                <button type="button" aria-pressed={secili} onClick={() => setVurgu(secili ? null : s.id)} onMouseEnter={() => setGecici(s.id)} onMouseLeave={() => setGecici(null)} onFocus={() => setGecici(s.id)} onBlur={() => setGecici(null)}
                  className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-md px-1.5 py-0.5" style={{ color: 'var(--text-primary)', background: secili ? 'var(--bg-elevated)' : undefined, boxShadow: secili ? 'inset 0 0 0 1px var(--border)' : undefined, opacity: soluk(s) ? 0.55 : 1 }}>
                  <svg width="22" height="8" aria-hidden><line x1="1" x2="21" y1="4" y2="4" stroke={st.renk} strokeWidth={s.ref ? 3.5 : 2} strokeDasharray={st.kesik} strokeLinecap="round" /></svg>
                  <span className="truncate">{s.ad}{s.ref ? ' (referans)' : ''}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </figure>
  );
}
