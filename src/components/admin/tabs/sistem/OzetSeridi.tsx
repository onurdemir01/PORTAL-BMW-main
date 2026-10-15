// src/components/admin/tabs/sistem/OzetSeridi.tsx — ustteki durum kutulari (ayni zamanda suzgec).
//
// Degerler okunamadiysa ya da yukleniyorsa sayi "—" olur ve kutu kapanir: hata aninda
// "Zorunlu ayarlarin hepsi tanimli" demek yalan olurdu (SA12). Hicbir metin tek basina
// "okunamadı" degildir (HY4 o metni satir sayisi icin sayar).
import React from 'react';
import type { Ozet, Suzgec } from './ayarKurallari';
import type { YuklemeDurumu } from './useSistemAyarlari';

interface Kutu {
  suzgec: Suzgec;
  etiket: string;
  sayi: number;
  alt: string;
  tehlike?: boolean;
}

export default function OzetSeridi({
  durum,
  ozet,
  aktif,
  onSec,
}: {
  durum: YuklemeDurumu;
  ozet: Ozet;
  aktif: Suzgec;
  onSec: (s: Suzgec) => void;
}) {
  const hazir = durum === 'tamam';
  const kutular: Kutu[] = [
    {
      suzgec: 'eksik',
      etiket: 'Eksik zorunlu',
      sayi: ozet.eksik,
      alt: ozet.eksik === 0 ? 'Zorunlu ayarların hepsi tanımlı' : `${ozet.eksik} zorunlu ayar boş`,
      tehlike: ozet.eksik > 0,
    },
    {
      suzgec: 'tanimsiz',
      etiket: 'Tanımsız',
      sayi: ozet.tanimsiz,
      // "Varsayilanla calisiyor" DENMEZ: zorunlu ve fail-closed anahtarlarin varsayilani yok (SA15).
      alt: `${ozet.toplam - ozet.tanimsiz}/${ozet.toplam} tanımlı`,
    },
    { suzgec: 'portalda', etiket: "Portal'da ayarlı", sayi: ozet.portalda, alt: 'Bu ekrandan kaydedilmiş' },
    { suzgec: 'restart', etiket: 'Restart bekleyen', sayi: ozet.restart, alt: 'Bu sayfa açıkken kaydedilen' },
  ];
  return (
    <div className="grid grid-cols-2 @xl/sistem:grid-cols-4 gap-3">
      {kutular.map((k) => {
        const secili = hazir && aktif === k.suzgec;
        const tehlike = hazir && k.tehlike;
        return (
          <button
            key={k.suzgec}
            type="button"
            aria-pressed={secili}
            aria-controls="sistem-ayar-listesi"
            disabled={!hazir}
            onClick={() => onSec(secili ? 'tumu' : k.suzgec)}
            className={`min-w-0 rounded-md border p-3 text-left transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)] disabled:cursor-default ${
              secili
                ? 'border-[var(--accent)] bg-[var(--accent-bg)]'
                : tehlike
                  ? 'border-[var(--status-danger)] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] enabled:hover:border-[var(--border)] enabled:hover:bg-[var(--bg-elevated)]'
            }`}
          >
            <span className="block text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
              {k.etiket}
            </span>
            <span
              className={`mt-1 block text-2xl font-semibold leading-none tabular-nums ${
                tehlike ? 'text-[var(--status-danger-text)]' : 'text-[var(--text-primary)]'
              }`}
            >
              {hazir ? k.sayi : '—'}
            </span>
            <span className="mt-1.5 block text-xs leading-snug text-[var(--text-secondary)]">
              {hazir ? k.alt : durum === 'hata' ? 'Değerler okunamadı' : 'Yükleniyor'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
