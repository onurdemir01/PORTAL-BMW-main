// src/components/nginx_console/yukTesti/YukUi.tsx — Yük Testi ekranlarinin ortak ogeleri (2026-10-27).
//
// Kart (Bolum), etiketli alan (Alan), girdi stilleri ve durum haplari. Renkler retirementStil.ts TON'dan
// (metin her zaman `metin` alanindan; koyu temada AA). Hub'in yerel smBtn'i ('#fff') KULLANILMAZ.
import React from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import type { NlHedefTuru, NlMotor } from '@/api/nginxLoadtestApi';
import { Cip, Hap } from '@/components/server_hub/RetirementUi';
import { SERBEST_CIP_IPUCU, WRK_CIP_IPUCU, gecerlilikBilgisi, kosuDurumu, ISLEM_ETIKETI } from './yukTestiOrtak';

/** Metin / sayi girdisi ve secim kutusu: token renkli; hata varsa tehlike kenari. GIRDI 32px ve tam genislik;
 *  baska boy / genislik isteyen yer GIRDI_TABAN + kendi h-* w-* siniflarini kullanir (iki h-* / w-* carpismasin). */
export const GIRDI_TABAN = 'min-w-0 rounded-lg border px-2.5 text-[12px] leading-none outline-none transition-[border-color] duration-150 focus:border-[var(--accent)] disabled:opacity-60';
export const GIRDI = `${GIRDI_TABAN} h-8 w-full`;
export const girdiStili = (hatali = false): React.CSSProperties => ({
  borderColor: hatali ? 'var(--status-danger)' : 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)',
});

export function Bolum({ baslik, aciklama, eylem, children, className = '', govdeSinifi = 'p-4' }: {
  baslik?: React.ReactNode; aciklama?: React.ReactNode; eylem?: React.ReactNode; children: React.ReactNode; className?: string; govdeSinifi?: string;
}) {
  return (
    <section className={`min-w-0 rounded-xl border ${className}`} style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
      {(baslik || eylem) && (
        <header className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b px-4 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="min-w-0 flex-1">
            {baslik && <h3 className="text-[13px] font-semibold leading-5" style={{ color: 'var(--text-primary)' }}>{baslik}</h3>}
            {aciklama && <p className="mt-0.5 text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>{aciklama}</p>}
          </div>
          {eylem && <div className="flex flex-wrap items-center gap-1.5">{eylem}</div>}
        </header>
      )}
      <div className={govdeSinifi}>{children}</div>
    </section>
  );
}

/** Etiket + denetim + yardim / not / hata satiri. `id` denetime verilir (label htmlFor). `not`: engel olmayan ama
 *  bilinmesi gereken durum (uyari tonu; hata varsa hata, yoksa not, yoksa yardim gorunur).
 *  Inceleme UI4 (2026-10-28): gorunen satirin id'si (hata > not > yardim) id'si `id` olan denetime aria-describedby ile
 *  baglanir (ekran okuyucu odakta okur). Cocuk birden cok olabilir (Host basligi: input + datalist): Children.map ile
 *  yalniz eslesen cocuk klonlanir; map her zaman uygulanir (aciklama gelip gidince denetim yeniden kurulmaz, odak kalir). */
export function Alan({ id, etiket, yardim, not, hata, children, className = '' }: {
  id: string; etiket: React.ReactNode; yardim?: React.ReactNode; not?: React.ReactNode; hata?: string | null; children: React.ReactNode; className?: string;
}) {
  const aciklamaId = hata ? `${id}-hata` : not ? `${id}-not` : yardim ? `${id}-yardim` : undefined;
  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={id} className="mb-1 block text-[11px] font-semibold leading-4" style={{ color: 'var(--text-secondary)' }}>{etiket}</label>
      {React.Children.map(children, (c) => (React.isValidElement<{ id?: string }>(c) && c.props.id === id
        ? React.cloneElement(c as React.ReactElement<React.HTMLAttributes<HTMLElement>>, { 'aria-describedby': aciklamaId })
        : c))}
      {hata
        ? <p id={`${id}-hata`} className="mt-1 text-[11px] leading-4" style={{ color: 'var(--status-danger-text)' }}>{hata}</p>
        : not ? (
          <p id={`${id}-not`} className="mt-1 flex items-start gap-1 text-[11px] leading-4" style={{ color: 'var(--status-warning-text)' }}>
            <ExclamationTriangleIcon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /><span className="min-w-0">{not}</span>
          </p>
        ) : yardim ? <p id={`${id}-yardim`} className="mt-1 text-[11px] leading-4" style={{ color: 'var(--text-muted)' }}>{yardim}</p> : null}
    </div>
  );
}

/** Serbest hedef ve wrk cipleri (k6 + sunucu varsayilandir: cip YOK). Tur / motor kosu satirindan. */
export function TurMotorCipleri({ hedefTuru, motor }: { hedefTuru?: NlHedefTuru | null; motor?: NlMotor | null }) {
  if (hedefTuru !== 'serbest' && motor !== 'wrk') return null;
  return (
    <>
      {hedefTuru === 'serbest' && <Cip ton="uyari" cerceve title={SERBEST_CIP_IPUCU}>serbest</Cip>}
      {motor === 'wrk' && <Cip cerceve title={WRK_CIP_IPUCU}>wrk</Cip>}
    </>
  );
}

/** Tanim listesi hucresi: kucuk etiket, deger. */
export function Tanim({ etiket, children, title }: { etiket: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>{etiket}</dt>
      <dd className="mt-0.5 truncate text-[12px] font-medium leading-5" style={{ color: 'var(--text-primary)' }} title={title}>{children}</dd>
    </div>
  );
}

export function KosuDurumHapi({ durum }: { durum: string }) {
  const d = kosuDurumu(durum);
  return <Hap label={d.etiket} ton={d.ton} nabiz={!!d.canli} />;
}
export function GecerlilikHapi({ gecerlilik }: { gecerlilik: string | null | undefined }) {
  const g = gecerlilikBilgisi(gecerlilik);
  return g ? <Hap label={g.etiket} ton={g.ton} title={g.aciklama} /> : <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>—</span>;
}
export const islemEtiketi = (islem: string) => ISLEM_ETIKETI[islem] || islem;
