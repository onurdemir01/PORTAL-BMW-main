// src/components/nginx_console/yukTesti/EtiketDuzenle.tsx — koşu etiketini sonradan düzenleme (2026-11-04).
//
// Kalem simgesi -> satir ici girdi + "Kaydet" / "İptal" (Esc iptal, Enter kaydet). Yalniz Admin'e cizilir (sunucu
// PUT /kosular/:id/etiket'i Admin disina 403 ile reddeder). Sunucunun girdi kapisi (120 karakter, kontrol karakteri)
// burada aynalanir; ret mesaji satirda gorunur. Bos etiket = etiketi kaldir.
import React, { useState } from 'react';
import { PencilSquareIcon } from '@heroicons/react/24/outline';
import { nginxLoadtestApi } from '@/api/nginxLoadtestApi';
import { TBL_BTN, smBtn } from '@/components/server_hub/retirementStil';
import { GIRDI_TABAN, girdiStili } from './YukUi';
import { hataMetni } from './yukTestiOrtak';

export const ETIKET_MAX = 120;
/** Sunucu kapisinin aynasi: null = gecerli, metin = neden. */
export function etiketHatasi(s: string): string | null {
  const t = s.trim();
  if (Array.from(t).length > ETIKET_MAX) return `En çok ${ETIKET_MAX} karakter.`;
  for (const ch of t) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029) return 'Satır sonu / kontrol karakteri olamaz.';
  }
  return null;
}

export default function EtiketDuzenle({ kosuId, etiket, onKaydedildi }: { kosuId: number; etiket: string | null; onKaydedildi: (etiket: string | null) => void }) {
  const [acik, setAcik] = useState(false);
  const [deger, setDeger] = useState(etiket ?? '');
  const [hata, setHata] = useState('');
  const [mesgul, setMesgul] = useState(false);
  const yerel = etiketHatasi(deger);
  const durdur = (e: React.SyntheticEvent) => e.stopPropagation();

  async function kaydet() {
    if (yerel || mesgul) return;
    setMesgul(true);
    setHata('');
    try {
      const r = await nginxLoadtestApi.etiketDegistir(kosuId, deger.trim());
      if (r.ok) {
        onKaydedildi(r.etiket ?? (deger.trim() || null));
        setAcik(false);
      } else setHata(hataMetni(r, 'Etiket kaydedilemedi.'));
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e));
    } finally {
      setMesgul(false);
    }
  }

  if (!acik) {
    return (
      <button type="button" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded" style={{ color: 'var(--text-secondary)' }}
        aria-label={`Koşu ${kosuId} etiketini düzenle`} title="Etiketi düzenle" onClick={(e) => { durdur(e); setDeger(etiket ?? ''); setHata(''); setAcik(true); }}>
        <PencilSquareIcon className="h-3.5 w-3.5" aria-hidden />
      </button>
    );
  }
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1" onClick={durdur} onKeyDown={durdur} role="group" aria-label={`Koşu ${kosuId} etiketi`}>
      <input autoFocus value={deger} onChange={(e) => setDeger(e.target.value)} aria-label="Yeni etiket" maxLength={ETIKET_MAX + 10} className={`${GIRDI_TABAN} h-7 w-56`} style={girdiStili(!!yerel || !!hata)}
        onKeyDown={(e) => { if (e.key === 'Enter') void kaydet(); if (e.key === 'Escape') setAcik(false); }} placeholder="ör. A3 brotli 4" />
      <button type="button" className={TBL_BTN} style={smBtn(true)} disabled={!!yerel || mesgul} onClick={() => void kaydet()}>Kaydet</button>
      <button type="button" className={TBL_BTN} style={smBtn()} onClick={() => setAcik(false)}>İptal</button>
      {(yerel || hata) && <span role="alert" className="w-full text-[11px]" style={{ color: 'var(--status-danger-text)' }}>{yerel || hata}</span>}
    </span>
  );
}
