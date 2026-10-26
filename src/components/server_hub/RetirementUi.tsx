// src/components/server_hub/RetirementUi.tsx — Retirement tablolarinin ortak ogeleri (2026-10-26).
//
// Hap (durum, 20px), Cip (kucuk etiket, 16px, KIRILMAZ: 'in-/place' kirilmasi), UyariKutusu,
// Sayac, OzetHucre, TabloIskelet (colgroup + baslik), SonucMetni (2 satir + "tamamini goster").
// Renkler retirementStil.ts TON'dan; metin her zaman `metin` alanindan.
import React, { useLayoutEffect, useRef, useState } from 'react';
import { ExclamationCircleIcon, ExclamationTriangleIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { fmtNumber } from '@/utils/datetime';
import { LINK, TH_STIL, TON, type Ton } from './retirementStil';
import { sonucAyir } from './retirementSatir';

export function Hap({ label, ton, nabiz = false, ikon: Ikon, title }: { label: string; ton: Ton; nabiz?: boolean; ikon?: React.ComponentType<React.SVGProps<SVGSVGElement>>; title?: string }) {
  const v = TON[ton];
  return (
    <span className="inline-flex h-5 max-w-full items-center gap-1.5 rounded-full px-2 text-[11px] font-semibold leading-none whitespace-nowrap" style={{ background: v.zemin, color: v.metin, boxShadow: `inset 0 0 0 1px ${v.kenar}` }} title={title}>
      {Ikon ? <Ikon className="h-3 w-3 shrink-0" aria-hidden /> : <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${nabiz ? 'animate-status-pulse motion-reduce:animate-none' : ''}`} style={{ background: v.renk, color: v.renk }} />}
      <span className="truncate" title={label}>{label}</span>
    </span>
  );
}

export function Cip({ ton = 'notr', cerceve = false, title, children }: { ton?: Ton; cerceve?: boolean; title?: string; children: React.ReactNode }) {
  const v = TON[ton];
  return <span className="inline-flex h-4 shrink-0 items-center rounded px-1.5 text-[11px] font-semibold leading-none whitespace-nowrap tabular-nums" style={cerceve ? { color: v.metin, boxShadow: `inset 0 0 0 1px ${v.kenar}` } : { color: v.metin, background: v.zemin }} title={title}>{children}</span>;
}

/** `vurgu`: solda kalin ton cizgisi - ayni tondaki diger kutulardan ayrisan OZEL uyari (in-place). */
export function UyariKutusu({ ton, baslik, rol, eylem, vurgu = false, children }: { ton: 'hata' | 'uyari' | 'bilgi'; baslik: React.ReactNode; rol?: 'alert' | 'status'; eylem?: React.ReactNode; vurgu?: boolean; children?: React.ReactNode }) {
  // bilgi = aksan (mavi): PF6'da --status-info MOR.
  const v = TON[ton === 'bilgi' ? 'aksan' : ton];
  const Ikon = ton === 'bilgi' ? InformationCircleIcon : ton === 'hata' ? ExclamationCircleIcon : ExclamationTriangleIcon;
  return (
    <div role={rol} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2.5 rounded-lg px-3 py-2.5" style={{ background: v.zemin, boxShadow: vurgu ? `inset 4px 0 0 ${v.renk}, inset 0 0 0 1px ${v.kenar}` : `inset 0 0 0 1px ${v.kenar}` }}>
      <Ikon className="mt-0.5 h-4 w-4" style={{ color: v.metin }} aria-hidden />
      <div className="min-w-0 space-y-1.5">
        <div className="text-[13px] font-semibold leading-5" style={{ color: v.metin }}>{baslik}</div>
        {children && <div className="text-[12px] leading-5" style={{ color: 'var(--text-primary)' }}>{children}</div>}
        {eylem && <div className="flex flex-wrap items-center gap-2 pt-0.5">{eylem}</div>}
      </div>
    </div>
  );
}

export function Sayac({ etiket, n, ton }: { etiket: string; n: number; ton?: 'uyari' | 'hata' }) {
  const s = ton ? { background: TON[ton].zemin, color: TON[ton].metin, boxShadow: `inset 0 0 0 1px ${TON[ton].kenar}` } : { color: 'var(--text-secondary)', boxShadow: 'inset 0 0 0 1px var(--border-subtle)' };
  return <span className="inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] whitespace-nowrap" style={s}>{etiket} <b className="font-semibold tabular-nums">{fmtNumber(n)}</b></span>;
}

export function OzetHucre({ etiket, alt, eylem, children }: { etiket: string; alt?: React.ReactNode; eylem?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-3" style={{ background: 'var(--bg-surface)' }}>
      <dt className="text-[11px] font-medium leading-4" style={{ color: 'var(--text-secondary)' }}>{etiket}</dt>
      <dd className="mt-1.5 flex flex-wrap items-center gap-2 text-[14px] font-semibold leading-5 tabular-nums" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>{children}</dd>
      {alt && <dd className="mt-1 text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>{alt}</dd>}
      {eylem && <dd className="mt-1.5">{eylem}</dd>}
    </div>
  );
}

/** Kolon tanimi: genislik yoksa esnek kolon (kalan alani alir); `sag` basligin sag ucundaki ikinci etiket. */
export type Kolon = { anahtar: string; baslik: string; sag?: string; genislik?: string; ipucu?: string };
/** colgroup + thead. `table-fixed` ile kolon genislikleri burada sabitlenir; th'de leading-* yok (katmansiz CSS). */
export function TabloIskelet({ kolonlar, secimBasligi }: { kolonlar: Kolon[]; secimBasligi?: React.ReactNode }) {
  return (
    <>
      <colgroup>{kolonlar.map((k) => <col key={k.anahtar} style={k.genislik ? { width: k.genislik } : undefined} />)}</colgroup>
      <thead><tr>{kolonlar.map((k) => (
        <th key={k.anahtar} scope="col" className="px-2.5 py-1.5 text-left text-[11px] whitespace-nowrap" style={TH_STIL} title={k.ipucu}>
          {k.anahtar === 'sec' ? (secimBasligi ?? <span className="sr-only">Seçim</span>)
            : k.sag ? <div className="flex items-baseline justify-between gap-3"><span className="truncate" title={k.baslik}>{k.baslik}</span><span className="shrink-0 font-normal">{k.sag}</span></div>
            : k.baslik}
        </th>))}</tr></thead>
    </>
  );
}

/** Sonuc metni: 2 satir; tasarsa "tamamini goster". Tasma ResizeObserver geri cagrisinda olculur
 *  (effect govdesinde senkron setState yok: react-hooks/set-state-in-effect). */
export function SonucMetni({ metin, hata, onCikti }: { metin: string; hata: boolean; onCikti?: () => void }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [acik, setAcik] = useState(false);
  const [tasiyor, setTasiyor] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || acik || typeof ResizeObserver === 'undefined') return;
    // Yeni gozlemci gozleme baslarken bir kez bildirir: metin degisince de olculur.
    const ro = new ResizeObserver(() => setTasiyor(el.scrollHeight > el.clientHeight + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [metin, acik]);
  const { etiket, govde } = sonucAyir(metin);
  return (
    <div className="w-full min-w-0">
      <p ref={ref} className={`text-[11px] leading-4 wrap-anywhere ${acik ? 'whitespace-pre-wrap' : 'line-clamp-2'}`} style={{ color: hata ? 'var(--status-danger-text)' : 'var(--text-secondary)' }} title={acik ? undefined : metin}>
        {etiket && <><Cip ton={etiket === 'FAIL' ? 'hata' : etiket === 'OK' ? 'basari' : 'notr'}>{etiket}</Cip>{' '}</>}{govde}
      </p>
      {(tasiyor || acik || onCikti) && (
        <div className="mt-0.5 flex flex-wrap gap-x-2.5">
          {(tasiyor || acik) && <button type="button" onClick={() => setAcik((x) => !x)} aria-expanded={acik} className={LINK} style={{ color: 'var(--accent)' }}>{acik ? 'daralt' : 'tamamını göster'}</button>}
          {onCikti && <button type="button" onClick={onCikti} className={LINK} style={{ color: 'var(--accent)' }}>İş çıktısında gör</button>}
        </div>
      )}
    </div>
  );
}
