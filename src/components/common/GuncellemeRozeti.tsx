// src/components/common/GuncellemeRozeti.tsx — verinin tarihi ("son tarama", "son güncelleme"), hafif vurgulu.
//
// Kullanici (2026-10-14): "sayfalarin son guncelleme tarihini biraz daha belirgin highlight edebilirsen
// sevinirim. Cok vurucu renklere gerek yok, cok hafif." Onceden tarih soluk yardimci metnin icinde
// kayboluyordu. Yumusak aksan zemini (--accent-bg, PF blue-10) + ince kenar; tarih bir ton koyu ve
// tabular. Renkler token'dan: iki temada da ayni hafiflikte.
import React from 'react';
import { ClockIcon } from '@heroicons/react/24/outline';

export function GuncellemeRozeti({
  etiket = 'son güncelleme',
  tarih,
  title,
}: {
  etiket?: string;
  tarih: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] whitespace-nowrap align-middle"
      style={{
        background: 'var(--accent-bg)',
        borderColor: 'var(--accent-light)',
        color: 'var(--text-secondary)',
      }}
      title={title}
    >
      <ClockIcon className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true" />
      {etiket}{' '}
      <span className="font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
        {tarih}
      </span>
    </span>
  );
}

export default GuncellemeRozeti;
