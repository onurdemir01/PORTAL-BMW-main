// src/components/common/YardimDugmesi.tsx — sayfa basligindaki tek yardim dugmesi (2026-11-08).
//
// HelpModal'li alti sayfada alti ayri bicim vardi: "Bu sayfa nasıl kullanılır?" baglantisi,
// "Nasıl kullanılır?" ve "Yardım" dugmeleri; kose (lg / xl / full), yazi boyu (xs / sm) ve renk
// (ikincil / soluk / gri-600 / slate-600) sayfadan sayfaya degisiyordu. Gorunum Denetim ve
// Nginx Hub'daki (zaten ayni) bicimdir; metin "Nasıl kullanılır?".
import React from 'react';
import { QuestionMarkCircleIcon } from '@heroicons/react/24/outline';

export default function YardimDugmesi({
  onClick,
  etiket = 'Nasıl kullanılır?',
}: {
  onClick: () => void;
  etiket?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors flex-shrink-0 border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
    >
      <QuestionMarkCircleIcon className="w-4 h-4" aria-hidden="true" />
      {etiket}
    </button>
  );
}
