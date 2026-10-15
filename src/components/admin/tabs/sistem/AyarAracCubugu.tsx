// src/components/admin/tabs/sistem/AyarAracCubugu.tsx — yapiskan arama / gezinme cubugu.
//
// Arama gizli degerin icinde aramaz (ayarKurallari.eslesir). Ozel klavye kisayolu YOK: form
// alanlari ve ekran okuyucu kisayollariyla cakisma riski (bilincli olarak alinmadi).
import React from 'react';
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { TextInput, Select } from '@/components/ui/Form';
import type { Bolum, Grup } from './gruplar';
import { SUZGEC_ETIKETI, type Suzgec } from './ayarKurallari';
import Rozet from './Rozet';

interface Props {
  arama: string;
  onArama: (v: string) => void;
  suzgec: Suzgec;
  onSuzgecKaldir: () => void;
  bolumler: Bolum[];
  gruplar: Grup[];
  onGrubaGit: (id: string) => void;
  kirliSayisi: number;
  onTaslaklariGoster: () => void;
  gorunenSayi: number;
  suzmeVar: boolean;
  tumuAcik: boolean;
  onTumunuAcKapat: () => void;
  /** Ogeye kaydirirken cubugun yuksekligi pay olarak birakilir (sistem/kaydir.ts). */
  kokRef?: React.Ref<HTMLDivElement>;
}

export default function AyarAracCubugu({
  arama,
  onArama,
  suzgec,
  onSuzgecKaldir,
  bolumler,
  gruplar,
  onGrubaGit,
  kirliSayisi,
  onTaslaklariGoster,
  gorunenSayi,
  suzmeVar,
  tumuAcik,
  onTumunuAcKapat,
  kokRef,
}: Props) {
  return (
    <div
      ref={kokRef}
      className="sticky top-0 z-10 -mx-5 px-5 py-3 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] space-y-2"
    >
      <div className="flex flex-col gap-2 @xl/sistem:flex-row @xl/sistem:items-center">
        <div className="relative min-w-0 flex-1">
          <MagnifyingGlassIcon
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]"
          />
          <TextInput
            type="search"
            sizeVariant="sm"
            aria-label="Ayarlarda ara"
            placeholder="Ayar adı, anahtar ya da açıklama ara…"
            value={arama}
            onChange={(e) => onArama(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && arama) {
                e.preventDefault();
                onArama('');
              }
            }}
            className="!pl-9"
          />
        </div>
        <div className="min-w-0 @xl/sistem:w-56">
          <Select
            sizeVariant="sm"
            aria-label="Gruba git"
            value=""
            onChange={(e) => {
              if (e.target.value) onGrubaGit(e.target.value);
            }}
          >
            <option value="">Gruba git…</option>
            {bolumler.map((b) => (
              <optgroup key={b.id} label={b.ad}>
                {gruplar
                  .filter((g) => g.bolum === b.id)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.ad}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        {suzgec !== 'tumu' && (
          <span className="inline-flex items-center gap-1 rounded-md border border-[var(--accent)] bg-[var(--accent-bg)] pl-2 pr-0.5 text-[var(--text-primary)]">
            Süzgeç: {SUZGEC_ETIKETI[suzgec]}
            <button
              type="button"
              aria-label="Süzgeci kaldır"
              onClick={onSuzgecKaldir}
              className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
            >
              <XMarkIcon aria-hidden="true" className="w-3.5 h-3.5" />
            </button>
          </span>
        )}
        {kirliSayisi > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <Rozet ton="gold">{kirliSayisi} kaydedilmemiş değişiklik</Rozet>
            {suzgec !== 'taslak' && (
              <button type="button" className="pf-btn-link !p-0 !text-xs" onClick={onTaslaklariGoster}>
                Göster
              </button>
            )}
          </span>
        )}
        <p aria-live="polite" className="text-[var(--text-muted)] tabular-nums">
          {suzmeVar ? `${gorunenSayi} ayar gösteriliyor` : ''}
        </p>
        <button type="button" className="pf-btn-link !p-0 !text-xs ml-auto" onClick={onTumunuAcKapat}>
          {tumuAcik ? 'Tümünü kapat' : 'Tümünü aç'}
        </button>
      </div>
    </div>
  );
}
