// src/components/common/IsCiktisiParcalari.tsx — canli AWX is ciktisi goruntuleyicilerinin ORTAK parcalari
// (2026-11-24). Retirement "Is ciktisi" (server_hub/RetirementIsCiktisi.tsx) ve Yuk Testi kosu ciktisi
// (nginx_console/yukTesti/KosuCiktisi.tsx) ayni goruntuleyiciyi iki kopya olarak tasiyordu (Sonar CPD ~360
// satir). Veri kancalari (hangi uctan, nasil yoklanir) modullerde kalir; burada yalniz gorunum: buyutme katmani
// ve odak tuzagi, canli sayac, serit dugmeleri, "AWX okunamadi" bandi, hata ozeti.
import React, { useEffect, useRef, useState } from 'react';
import { ArrowPathIcon, ArrowsPointingOutIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { TBL_BTN, smBtn } from '@/components/server_hub/retirementStil';
import { EN_COK_DENEME, type hataOzeti } from '@/components/server_hub/retirementCikti';

/**
 * Goruntuleyici durumu: takip (otomatik kaydirma), buyutme katmani, saniyelik sayac. Sayac yalniz is surerken
 * ve sekme gorunurken isler. Odak yonetimi dugme ve katman bilesenlerinin kendisinde (CiktiDugmeleri, BuyukKatman).
 */
export function useCiktiGorunumu({ suruyor, gizli }: { suruyor: boolean; gizli: boolean }) {
  const [takip, setTakip] = useState(true);
  const [buyuk, setBuyuk] = useState(false);
  const [simdi, setSimdi] = useState(() => Date.now());
  useEffect(() => {
    if (!suruyor || gizli) return;
    const z = window.setInterval(() => setSimdi(Date.now()), 1000);
    return () => window.clearInterval(z);
  }, [suruyor, gizli]);
  return { takip, setTakip, buyuk, setBuyuk, simdi };
}
export type CiktiGorunumu = ReturnType<typeof useCiktiGorunumu>;

/** Seritteki canli gosterge: son okumadan bu yana gecen sure; sekme gizliyse duraklatildi notu. */
export function CanliGosterge({
  g,
  suruyor,
  sonOkuma,
  gizli,
}: {
  g: CiktiGorunumu;
  suruyor: boolean;
  sonOkuma: number | null;
  gizli: boolean;
}) {
  return (
    <>
      {suruyor && sonOkuma != null && (
        <span className="font-semibold tabular-nums" style={{ color: 'var(--accent)' }}>
          <span aria-hidden>●</span> canlı · son okuma{' '}
          {Math.max(0, Math.round((g.simdi - sonOkuma) / 1000))} sn önce
        </span>
      )}
      {gizli && <span>sekme gizli — duraklatıldı</span>}
    </>
  );
}

/** Serit dugmeleri: takip (is surerken), Yenile, modulun ek baglantilari, Buyut / Kapat. */
export function CiktiDugmeleri({
  g,
  suruyor,
  yenile,
  yenileIpucu,
  katmanda,
  ek,
}: {
  g: CiktiGorunumu;
  suruyor: boolean;
  yenile: () => void;
  yenileIpucu: string;
  katmanda: boolean;
  ek?: React.ReactNode;
}) {
  // Buyut: katmandaki serit acilinca odak Kapat'a; katman kapaninca satir icindeki Buyut'a doner.
  const buyutRef = useRef<HTMLButtonElement>(null);
  const kapatRef = useRef<HTMLButtonElement>(null);
  const acildi = useRef(false);
  useEffect(() => {
    if (katmanda) kapatRef.current?.focus();
  }, [katmanda]);
  useEffect(() => {
    if (katmanda) return;
    if (g.buyuk) acildi.current = true;
    else if (acildi.current) {
      acildi.current = false;
      buyutRef.current?.focus();
    }
  }, [katmanda, g.buyuk]);
  return (
    <span className="ml-auto flex flex-wrap items-center gap-1.5">
      {suruyor && (
        // Durum etiketin kendisinde (aria-pressed YOK: degisen etiketle celisirdi, denetim B10).
        <button
          type="button"
          onClick={() => g.setTakip((x) => !x)}
          className={TBL_BTN}
          style={smBtn()}
        >
          {g.takip ? 'Takibi durdur' : 'Sona git · takip et'}
        </button>
      )}
      <button
        type="button"
        onClick={yenile}
        className={TBL_BTN}
        style={smBtn()}
        title={yenileIpucu}
      >
        <ArrowPathIcon className="h-3.5 w-3.5" aria-hidden /> Yenile
      </button>
      {ek}
      {katmanda ? (
        <button
          ref={kapatRef}
          type="button"
          onClick={() => g.setBuyuk(false)}
          className={TBL_BTN}
          style={smBtn()}
          aria-label="Büyütmeyi kapat"
          title="Kapat (Esc)"
        >
          <XMarkIcon className="h-3.5 w-3.5" aria-hidden /> Kapat
        </button>
      ) : (
        <button
          ref={buyutRef}
          type="button"
          onClick={() => g.setBuyuk(true)}
          className={TBL_BTN}
          style={smBtn()}
          title="Çıktıyı tam ekranda göster"
        >
          <ArrowsPointingOutIcon className="h-3.5 w-3.5" aria-hidden /> Büyüt
        </button>
      )}
    </span>
  );
}

/** Gecici okuma hatasi bandi: kalan sure ve deneme; deneme bitince durdu + "Yeniden dene". */
export function OkumaHatasiBandi({
  hata,
  durdu,
  yenile,
}: {
  hata: { deneme: number; sonraSn: number | null; mesaj: string } | null;
  durdu: boolean;
  yenile: () => void;
}) {
  if (!hata) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-2 text-[11px] leading-4"
      style={{ color: 'var(--status-warning-text)' }}
      role="status"
    >
      {durdu ? (
        <>
          <span>
            AWX okunamadı — otomatik deneme durdu ({hata.deneme}/{EN_COK_DENEME})
            {hata.mesaj ? `: ${hata.mesaj}` : ''}
          </span>
          <button type="button" onClick={yenile} className={TBL_BTN} style={smBtn()}>
            Yeniden dene
          </button>
        </>
      ) : (
        <span>
          AWX okunamadı — {hata.sonraSn} sn sonra yeniden denenecek ({hata.deneme}/{EN_COK_DENEME})
        </span>
      )}
    </div>
  );
}

/** Basarisiz isin hata ozeti: AWX aciklamasi (varsa), ciktidaki hata satirlari, sonuc traceback'i (varsa). */
export function HataOzeti({
  ozet,
  aciklama,
  traceback,
}: {
  ozet: ReturnType<typeof hataOzeti>;
  aciklama?: string | null;
  traceback?: string | null;
}) {
  return (
    <div
      role="alert"
      className="border-l-[3px] px-3 py-2 text-[11px] leading-4"
      style={{ background: 'var(--status-danger-bg)', borderColor: 'var(--status-danger)' }}
    >
      <div className="font-semibold" style={{ color: 'var(--status-danger-text)' }}>
        Hata özeti
      </div>
      {aciklama && <div style={{ color: 'var(--text-primary)' }}>{aciklama}</div>}
      {ozet.length > 0 && (
        <ol className="mt-1 space-y-0.5 font-mono">
          {ozet.map((x) => (
            <li key={x.satir} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2">
              <span
                className="w-12 text-right tabular-nums"
                style={{ color: 'var(--text-secondary)' }}
              >
                {x.satir}
              </span>
              <span className="wrap-anywhere" style={{ color: 'var(--text-primary)' }}>
                {x.metin}
              </span>
            </li>
          ))}
        </ol>
      )}
      {!ozet.length && !aciklama && (
        <div style={{ color: 'var(--text-secondary)' }}>
          Çıktıda hata satırı bulunamadı — tamamı aşağıda.
        </div>
      )}
      {traceback && (
        <pre
          className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono"
          style={{ color: 'var(--text-primary)' }}
        >
          {traceback}
        </pre>
      )}
    </div>
  );
}

/** Govde alani: buyutme acikken yer tutucu (cikti katmanda), degilse govde. */
export function CiktiAlani({
  g,
  yukseklik,
  enAz,
  govde,
}: {
  g: CiktiGorunumu;
  yukseklik: string;
  enAz: string;
  govde: React.ReactNode;
}) {
  return (
    <div style={{ height: yukseklik, minHeight: enAz }}>
      {g.buyuk ? (
        <div
          className="flex h-full items-center justify-center rounded-xl border border-dashed text-[12px]"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
        >
          Çıktı büyütülmüş görünümde açık.
        </div>
      ) : (
        govde
      )}
    </div>
  );
}

/**
 * Tam ekran katman: serit, bantlar ve govde (buyut acikken bantlar YALNIZ burada: Hata ozeti role=alert iki kez
 * duyurulmasin, denetim B3). Arka plan bir kontrol degil (role="presentation"): tiklama fare kisayolu, klavyede
 * ESC katmanTusu'nda.
 */
export function BuyukKatman({
  g,
  etiket,
  serit,
  bantlar,
  govde,
  isaret,
}: {
  g: CiktiGorunumu;
  etiket: string;
  serit: React.ReactNode;
  bantlar: React.ReactNode;
  govde: React.ReactNode;
  /** Testlerin katmani bulmasi icin data-* nitelikleri. */
  isaret?: Record<string, string>;
}) {
  const katmanRef = useRef<HTMLDivElement>(null);
  if (!g.buyuk) return null;
  // ODAK TUZAGI (denetim B2): katman acikken Tab / Shift+Tab katmanin icinde doner; olay Modal'in window
  // dinleyicisine ulasmaz (o tum panelde dolasip odagi katmanin ARKASINA tasirdi, sonra Esc kaydi kapatirdi).
  const katmanTusu = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      g.setBuyuk(false);
      return;
    }
    if (e.key !== 'Tab') return;
    e.stopPropagation();
    const l = Array.from(
      katmanRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (!l.length) {
      e.preventDefault();
      return;
    }
    const ilk = l[0];
    const son = l[l.length - 1];
    const aktifOge = document.activeElement as HTMLElement | null;
    const icerde = !!aktifOge && !!katmanRef.current?.contains(aktifOge);
    if (!icerde || (e.shiftKey && aktifOge === ilk)) {
      e.preventDefault();
      (e.shiftKey ? son : ilk).focus();
    } else if (!e.shiftKey && aktifOge === son) {
      e.preventDefault();
      ilk.focus();
    }
  };
  return (
    <div
      className="fixed inset-0 z-[60] flex p-4"
      style={{ background: 'rgba(0,0,0,.45)' }}
      role="presentation"
      onClick={() => g.setBuyuk(false)}
      {...isaret}
    >
      <div
        ref={katmanRef}
        role="dialog"
        aria-modal="true"
        aria-label={`İş çıktısı — ${etiket}`}
        className="flex h-full w-full flex-col gap-2 rounded-2xl border p-4"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={katmanTusu}
      >
        {serit}
        {bantlar}
        <div className="min-h-0 flex-1">{govde}</div>
      </div>
    </div>
  );
}
