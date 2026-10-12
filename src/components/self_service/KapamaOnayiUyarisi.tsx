// src/components/self_service/KapamaOnayiUyarisi.tsx — Smart "Kapama Onayı" uyarısı (2026-10-12).
//
// Kullanici: "insanlar hala kapama onayinda tamamla deyince otomasyonun tetiklenecegini anlayamiyor.
// Talep ilerliyor, kapama onayina dusuyor, Tamamla'ya basmadiklari icin otomasyon baslamiyor; bir
// sure sonra 'talep actim olmadi' diye yaziyorlar." Eski metin kucuk gri bir cumlenin icindeydi.
// Artik her Smart talebi acilan ekranda AYNI, buyuk ve adim adim anlatan kutu gorunur.
import React from 'react';
import { HandRaisedIcon } from '@heroicons/react/24/solid';

/** Smart durum adi "Kapama Onayı" adimini mi gosteriyor? (Smart adi aynen yaziliyor; buyuk/kucuk harf ve i/ı serbest.) */
export function kapamaOnayinda(stateName?: string | null): boolean {
  return /kapama/i.test(String(stateName || '').toLocaleLowerCase('tr-TR'));
}

const ADIMLAR = [
  'Talep Smart’ta onaylanır',
  'Talep “Kapama Onayı” adımına düşer',
  'Smart’ta talebi açıp TAMAMLA’ya basarsınız',
  'Otomasyon birkaç dakika içinde başlar',
];

export default function KapamaOnayiUyarisi({ smartNo, kompakt = false }: { smartNo?: string | null; kompakt?: boolean }) {
  if (kompakt) {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-lg border-2 px-2.5 py-2 text-[13px] leading-snug" style={{ borderColor: '#d97706', background: '#fff7ed', color: '#7c2d12' }}>
        <HandRaisedIcon className="w-5 h-5 flex-shrink-0 mt-0.5 motion-safe:animate-pulse" style={{ color: '#d97706' }} aria-hidden="true" />
        <span>
          <b>Sıra sizde:</b> Smart{smartNo ? <> <span className="font-mono">#{smartNo}</span></> : null} kaydında <b>TAMAMLA</b>’ya basın.
          Basılmadan otomasyon <b>başlamaz</b>.
        </span>
      </div>
    );
  }
  return (
    <div role="note" className="text-left rounded-xl border-2 px-4 py-3 mx-auto max-w-md space-y-2" style={{ borderColor: '#d97706', background: '#fff7ed', color: '#7c2d12' }}>
      <div className="flex items-center gap-2 text-base font-bold leading-snug">
        <HandRaisedIcon className="w-6 h-6 flex-shrink-0" style={{ color: '#d97706' }} aria-hidden="true" />
        Otomasyon, Smart’ta siz “Tamamla”ya basınca başlar
      </div>
      <ol className="space-y-1 text-[14px] leading-snug">
        {ADIMLAR.map((a, i) => (
          <li key={a} className="flex items-start gap-2">
            <span className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold text-white" style={{ background: i === 2 ? '#c2410c' : '#d97706' }}>{i + 1}</span>
            <span style={i === 2 ? { fontWeight: 700 } : undefined}>{a}</span>
          </li>
        ))}
      </ol>
      <p className="text-[13px] font-semibold">
        Talep “Kapama Onayı”nda beklerken <u>hiçbir iş çalışmaz</u>.
        {smartNo ? <> Smart kayıt no: <span className="font-mono">{smartNo}</span></> : null}
      </p>
    </div>
  );
}
