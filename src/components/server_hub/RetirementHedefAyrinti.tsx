// src/components/server_hub/RetirementHedefAyrinti.tsx — kayit tablosunda hedefin AYRINTI satiri (2026-10-26).
//
// Tiklanan satirin HEMEN ALTINDA, tablo genisliginde (colSpan = kolon sayisi) iki sekme: Akış | İş çıktısı.
// Eskiden akis satiri tbody'nin sonuna, sabit colSpan={7} ile basiliyordu (tablo 10 kolon). Tek acik satir:
// tek yoklayici. In-place hedefte is sonrasi kontrol listesi Akis panelinde (yalniz yonlendirme).
// ARIA: role="tablist" YALNIZ sekmeleri sarar (baslik metni ve kapat dugmesi disarida); ←/→ yalniz sekmelerde.
import React, { useRef } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import type { RtRecord, RtTarget } from '@/api/retirementApi';
import RetirementAkis from './RetirementAkis';
import RetirementIsCiktisi, { type CiktiOnbellegi } from './RetirementIsCiktisi';
import { InPlaceKontrol, inPlaceAsamasi, type InPlaceBilgi } from './RetirementInPlace';
import { LINK } from './retirementStil';
import type { IsIpucu } from './retirementCikti';

export type AyrintiSekme = 'akis' | 'cikti';

export default function RetirementHedefAyrinti({ rec, t, sekme, ipucu, onSekme, onKapat, onIsBitti, onbellek, inPlace }: {
  rec: RtRecord; t: RtTarget; sekme: AyrintiSekme; ipucu?: IsIpucu;
  onSekme: (s: AyrintiSekme) => void; onKapat: () => void; onIsBitti: () => void;
  onbellek?: CiktiOnbellegi; inPlace?: InPlaceBilgi;
}) {
  // Alan yoksa (eski sunucu) "İş çıktısı" sekmesi gosterilmez; bos liste ise sekme kendi bos metnini soyler.
  const ciktiVar = t.awxIsleri !== undefined;
  const sekmeler: { k: AyrintiSekme; ad: string }[] = ciktiVar ? [{ k: 'akis', ad: 'Akış' }, { k: 'cikti', ad: 'İş çıktısı' }] : [{ k: 'akis', ad: 'Akış' }];
  const aktif: AyrintiSekme = sekme === 'cikti' && ciktiVar ? 'cikti' : 'akis';
  const dugmeler = useRef<Record<string, HTMLButtonElement | null>>({});
  const tus = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = sekmeler.findIndex((s) => s.k === aktif);
    const yeni = sekmeler[(i + (e.key === 'ArrowRight' ? 1 : sekmeler.length - 1)) % sekmeler.length].k;
    onSekme(yeni);
    dugmeler.current[yeni]?.focus();
  };
  const sonuc = t.resultText || t.planText || '—';
  const asama = inPlace?.inPlace ? inPlaceAsamasi(t) : null;
  const panelId = `rt-ayrinti-panel-${t.id}`;
  return (
    <div className="rounded-lg border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
      <div className="flex items-center gap-1 border-b px-2" style={{ borderColor: 'var(--border-subtle)' }}>
        <div role="tablist" aria-label={`${t.host} ayrıntısı`} className="flex items-center gap-1" onKeyDown={tus}>
          {sekmeler.map((s) => {
            const secili = s.k === aktif;
            return (
              <button key={s.k} ref={(el) => { dugmeler.current[s.k] = el; }} type="button" role="tab" id={`rt-sekme-${t.id}-${s.k}`} aria-selected={secili} aria-controls={panelId} tabIndex={secili ? 0 : -1}
                onClick={() => onSekme(s.k)} className="px-3 py-2 text-[12px] font-semibold focus-visible:outline-offset-2!"
                style={secili ? { color: 'var(--text-primary)', boxShadow: 'inset 0 -2px 0 var(--accent)' } : { color: 'var(--text-secondary)' }}>
                {s.ad}
              </button>
            );
          })}
        </div>
        <span className="ml-auto min-w-0 truncate text-[11px]" style={{ color: 'var(--text-secondary)' }} title={`${t.appName} @ ${t.host}`}>{`${t.appName} @ ${t.host}`}</span>
        <button type="button" onClick={onKapat} aria-label="Ayrıntıyı kapat" className="shrink-0 rounded p-1 focus-visible:outline-offset-2!" style={{ color: 'var(--text-secondary)' }}><XMarkIcon className="h-4 w-4" aria-hidden /></button>
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={`rt-sekme-${t.id}-${aktif}`} tabIndex={0} className="rounded-b-lg">
        {aktif === 'akis' ? (
          <div className="grid gap-4 p-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <RetirementAkis rec={rec} t={t} />
            <div className="min-w-0 space-y-2">
              <div className="text-[11px] font-semibold leading-4" style={{ color: 'var(--text-secondary)' }}>Son sonuç</div>
              <div className="rounded-md border px-2.5 py-2 text-[11px] leading-4 whitespace-pre-wrap wrap-anywhere" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}>{sonuc}</div>
              {(t.awxIsleri || []).length > 0 && <button type="button" onClick={() => onSekme('cikti')} className={LINK} style={{ color: 'var(--accent)' }}>İş çıktısını aç</button>}
              {asama && <InPlaceKontrol asama={asama} diger={inPlace?.digerSurumler} kayitta={inPlace?.kayitta} kaynak={inPlace?.kaynak} />}
            </div>
          </div>
        ) : (
          <RetirementIsCiktisi kayitId={rec.id} t={t} ipucu={ipucu} onIsBitti={onIsBitti} onbellek={onbellek} />
        )}
      </div>
    </div>
  );
}
