// src/components/admin/tabs/sistem/YenidenBaslatmaBandi.tsx — restart bekleyen degisiklikler.
//
// Eski bant hangi ayarin restart istedigini soylemiyor, kapatilamiyor ve sekme degisince
// kayboluyordu. Liste sistemOturumu deposunda (modul degiskeni): admin sekmeleri arasinda
// korunur, SAYFA YENILENINCE kaybolur — bant bunu acikca yazar ("tarayici oturumu" DEGIL:
// o ifade yenilemeden etkilenmeyen sessionStorage'i cagristirir). Sunucu bu bilgiyi saklamaz.
//
// CANLI BOLGE HEP DOM'DA (SA21): role=status kabi icerikle birlikte eklenirse ekran
// okuyucular cogu zaman duyurmaz; kap bos da olsa durur, icerik kosullu yazilir.
//
// DAR KAP (SD7): "Listeyi temizle" icerik sutununun ALTINDA; ayar adlari sarar (375px'te yan
// sutun icerigi 115px'e sikistiriyor, nowrap adlar bandin kenarini asiyordu).
import React from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';

export default function YenidenBaslatmaBandi({
  liste,
  onAyaraGit,
  onTemizle,
}: {
  liste: ReadonlyMap<string, string>;
  onAyaraGit: (key: string) => void;
  onTemizle: () => void;
}) {
  return (
    <div role="status" data-bolge="restart-bandi">
      {liste.size > 0 && (
        <div className="pf-alert pf-alert--warning rounded-md">
          <ArrowPathIcon aria-hidden="true" className="w-5 h-5 flex-shrink-0 text-[var(--status-warning-text)]" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="font-medium">{liste.size} değişiklik sunucu yeniden başlatılınca geçerli olacak:</p>
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              {[...liste.entries()].map(([key, label]) => (
                <li key={key} className="min-w-0">
                  <button
                    type="button"
                    className="pf-btn-link !p-0 !text-[13px] !whitespace-normal !justify-start text-left"
                    onClick={() => onAyaraGit(key)}
                  >
                    {label}
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-xs text-[var(--text-secondary)]">
              Bu liste yalnız bu sayfada tutulur; sayfayı yenilerseniz kaybolur. Sunucu yeniden başlatıldıysa
              listeyi temizleyin.
            </p>
            <button type="button" className="btn-secondary !py-1 !px-2.5 !text-xs" onClick={onTemizle}>
              Listeyi temizle
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
