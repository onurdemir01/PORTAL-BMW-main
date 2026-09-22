// src/components/common/LoadingLogo.tsx — "gercekten yukleniyor mu?" gostergesi (2026-09-22).
//
// Kullanici: Denetim sekmeleri dakikalarca "Yukleniyor…" yazip kaldi, sayfa mi calisiyor belli
// degil. Burada logo nabiz gibi atar/doner ve GECEN SURE sayilir: takilan sayfa ile agir sorgu
// birbirinden ayrilir. 20 sn sonra ipucu metni gorunur (ilk yukleme buyuk tablolarda uzun surer).
import React, { useEffect, useState } from 'react';
import { PortalLogo } from '@/components/common/PortalLogo';

// compact: satir ici / kucuk alanlar icin (tablo hucresi, panel kosesi) - ayni donen logo, kucuk boy.
export function LoadingLogo({ label = 'Yükleniyor…', hint, hintAfterSec = 20, compact = false }: { label?: string; hint?: string; hintAfterSec?: number; compact?: boolean }) {
  const [sec, setSec] = useState(0);
  useEffect(() => { const t = setInterval(() => setSec((s) => s + 1), 1000); return () => clearInterval(t); }, []);
  if (compact) {
    return (
      <div className="py-3 flex items-center justify-center gap-2 text-xs" role="status" aria-live="polite" style={{ color: 'var(--text-muted)' }}>
        <span className="portal-loading-logo inline-flex"><PortalLogo className="h-4 w-4" /></span>
        {label} <span className="tabular-nums">{sec} sn</span>
      </div>
    );
  }
  return (
    <div className="py-10 flex flex-col items-center gap-3 text-center" role="status" aria-live="polite">
      <div className="portal-loading-logo"><PortalLogo className="h-10 w-10" /></div>
      <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
        {label} <span className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>{sec} sn</span>
      </div>
      {sec >= hintAfterSec && (
        <div className="text-[11px] max-w-md" style={{ color: 'var(--text-muted)' }}>
          {hint || 'İlk yükleme büyük denetim tablolarını okuyor; sonraki açılışlar önbellekten anında gelir.'}
        </div>
      )}
    </div>
  );
}
