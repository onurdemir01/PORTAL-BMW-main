// src/components/admin/tabs/sistem/AyarGrubu.tsx — ikonlu, sayacli, katlanir ayar grubu karti.
//
// KAPALIYKEN DE MONTE (KatlanirPanel sozlesmesi): satirlar her zaman DOM'dadir — HY4 hata
// aninda butun satirlarin "okunamadı" yazdigini sayar, sanal liste ya da kosullu cizim onu
// kirar. Kapali icerik `inert`tir: klavye odagi gorunmeyen dugmelere dusmez, ekran okuyucu
// okumaz.
//
// BASLIK (SD8): rozetler ve sayac dugmenin ICINDE, ok dugmenin SON ogesi — ok her kartta ayni
// yerde (sag kenar). "Asil yeri" baglantisi dugmenin icine giremeyecegi icin (etkilesimli oge
// ic ice olamaz) acik icerigin basinda; satir Ayrintilar'inda da var.
import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import Collapse from '@/components/common/Collapse';
import type { Grup } from './gruplar';
import Rozet from './Rozet';

export interface GrupOzeti {
  tanimli: number;
  toplam: number;
  eksik: number;
  kirli: number;
}

interface Props {
  grup: Grup;
  acik: boolean;
  onAcKapat: () => void;
  ozet: GrupOzeti;
  uygulanma: 'canli' | 'restart' | 'karisik' | null;
  baslikRef: (el: HTMLButtonElement | null) => void;
  children: React.ReactNode;
}

export default function AyarGrubu({ grup, acik, onAcKapat, ozet, uygulanma, baslikRef, children }: Props) {
  const Ikon = grup.ikon;
  const icerikId = `sistem-grup-${grup.id}`;
  return (
    <div
      className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-xs)] min-w-0"
      data-grup={grup.id}
    >
      <h4
        className={`m-0 rounded-t-md ${acik ? 'border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]' : ''}`}
      >
        <button
          ref={baslikRef}
          type="button"
          aria-expanded={acik}
          aria-controls={icerikId}
          onClick={onAcKapat}
          className="scroll-mt-40 group flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] min-h-11"
        >
          <span className="w-7 h-7 rounded-md bg-[var(--accent-bg)] text-[var(--accent)] flex items-center justify-center flex-shrink-0">
            <Ikon aria-hidden="true" className="w-4 h-4" />
          </span>
          <span className="min-w-0 flex-1 flex flex-col gap-y-1 @lg/sistem:flex-row @lg/sistem:items-center @lg/sistem:gap-x-3">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent)]">
                {grup.ad}
              </span>
              <span className="hidden @lg/sistem:block text-xs font-normal text-[var(--text-muted)] leading-snug">
                {grup.aciklama}
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-1.5 font-normal @lg/sistem:justify-end">
              <span className="text-xs tabular-nums text-[var(--text-muted)]">
                {ozet.tanimli}/{ozet.toplam} tanımlı
              </span>
              {ozet.eksik > 0 && <Rozet ton="red">{ozet.eksik} zorunlu boş</Rozet>}
              {ozet.kirli > 0 && <Rozet ton="gold">{ozet.kirli} kaydedilmedi</Rozet>}
              {uygulanma === 'canli' && <Rozet ton="green">Canlı uygulanır</Rozet>}
              {uygulanma === 'restart' && <Rozet ton="grey">Yeniden başlatma gerekir</Rozet>}
            </span>
          </span>
          <ChevronDownIcon
            aria-hidden="true"
            className={`w-4 h-4 flex-shrink-0 text-[var(--text-muted)] transition-transform duration-200 motion-reduce:transition-none ${
              acik ? 'rotate-180' : ''
            }`}
          />
        </button>
      </h4>
      <Collapse open={acik}>
        <div id={icerikId} {...(acik ? {} : { inert: true })}>
          {grup.asilYeri && (
            <p className="px-4 pt-2.5 text-xs text-[var(--text-muted)]">
              Asıl yeri:{' '}
              <Link to={grup.asilYeri} className="pf-btn-link !p-0 !text-xs">
                {grup.asilYeriEtiketi} →
              </Link>
            </p>
          )}
          <ul className="divide-y divide-[var(--border-subtle)]">{children}</ul>
        </div>
      </Collapse>
    </div>
  );
}
