// src/components/scalex/KatlanirPanel.tsx — sayaçlı, katlanır alt panel.
//
// ScaleX sayfasının altında iki liste hep açıktı ("Zamanlanmış işlemler", "Şu an
// durdurulmuş"). İkisi de gerekli ama çoğu ziyarette boş ya da ilgisiz; sihirbazın
// altında ekranı uzatıyor, asıl adımı yukarı itiyordu. Kullanıcı kararı (2026-10-13):
// paneller katlanır olsun, başlıkta SAYAÇ dursun, varsayılan kapalı.
//
// İÇERİK KAPALIYKEN DE MONTE: sayaç panelin kendi yüklemesinden gelir. Kapalıyken içerik
// `inert`tir — klavye odağı görünmeyen düğmelere düşmez, ekran okuyucu okumaz.
import React, { useState } from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';
import Collapse from '@/components/common/Collapse';

const anahtar = (id: string) => `scalex.panel.${id}`;

/**
 * Panelin açık/kapalı tercihi. `yaz` tercihi tarayıcıda saklar; `gecici` saklamadan açar
 * (ör. yeni bir kayıt oluştuğunda paneli göstermek kullanıcının tercihi değildir).
 * Depolama kapalıysa (gizli pencere, kota) tercih yalnızca bu ziyaret için geçerlidir.
 */
export function usePanelAcik(id: string): [boolean, (v: boolean) => void, (v: boolean) => void] {
  const [acik, setAcik] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(anahtar(id)) === '1';
    } catch {
      return false;
    }
  });
  const yaz = (v: boolean) => {
    setAcik(v);
    try {
      window.localStorage.setItem(anahtar(id), v ? '1' : '0');
    } catch {
      /* depolama yoksa tercih bu ziyaretle sinirli kalir */
    }
  };
  return [acik, yaz, setAcik];
}

/**
 * PANELİN KENDİ HATA SINIRI (2026-10-14 üretim olayı). Zamanlanmış işlemler paneli
 * beklenmeyen bir sunucu yanıtıyla render sırasında patladı ve ScaleX sayfasının
 * TAMAMINI düşürdü — sihirbaz da gitti. Alt paneller yardımcıdır: biri çizilemezse
 * yalnız o panel hata söyler, sihirbaz ayakta kalır.
 */
class PanelHataSiniri extends React.Component<
  { baslik: string; children: React.ReactNode },
  { hata: Error | null }
> {
  state: { hata: Error | null } = { hata: null };

  static getDerivedStateFromError(hata: Error) {
    return { hata };
  }

  componentDidCatch(hata: Error, info: React.ErrorInfo) {
    console.error(`[ScaleX] "${this.props.baslik}" paneli çizilemedi:`, hata, info.componentStack);
  }

  render() {
    if (!this.state.hata) return this.props.children;
    return (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700"
      >
        <span className="flex-1">
          Bu panel çizilemedi: {this.state.hata.message || String(this.state.hata)}
        </span>
        <button
          type="button"
          onClick={() => this.setState({ hata: null })}
          className="btn-secondary flex-shrink-0 !py-0.5 !px-2 text-xs"
        >
          Tekrar dene
        </button>
      </div>
    );
  }
}

interface Props {
  id: string;
  baslik: string;
  /** `null` = henüz bilinmiyor / okunamadı (sıfırdan AYRI gösterilir). */
  sayi: number | null;
  /** Sayının yanına yazılır: "2 bekliyor". */
  sayiEtiketi?: string;
  /** Sayaç dikkat rengiyle gösterilsin (ör. bekleyen zamanlama var). */
  vurgulu?: boolean;
  acik: boolean;
  onDegistir: (acik: boolean) => void;
  children: React.ReactNode;
}

const KatlanirPanel: React.FC<Props> = ({
  id,
  baslik,
  sayi,
  sayiEtiketi,
  vurgulu,
  acik,
  onDegistir,
  children,
}) => (
  <div className="card">
    <button
      type="button"
      onClick={() => onDegistir(!acik)}
      aria-expanded={acik}
      aria-controls={`scalex-panel-${id}`}
      className="flex w-full items-center gap-2 px-5 py-3 text-left"
    >
      <ChevronDownIcon
        aria-hidden="true"
        className={`w-4 h-4 flex-shrink-0 text-[var(--text-muted)] transition-transform ${acik ? 'rotate-180' : ''}`}
      />
      <span className="text-sm font-semibold text-[var(--text-primary)]">{baslik}</span>
      <span
        data-testid={`scalex-panel-sayac-${id}`}
        className={`pf-label ${sayi && vurgulu ? 'pf-label--gold' : 'pf-label--grey'} tabular-nums`}
      >
        {sayi === null ? '…' : sayiEtiketi ? `${sayi} ${sayiEtiketi}` : sayi}
      </span>
    </button>
    <Collapse open={acik}>
      <div id={`scalex-panel-${id}`} className="px-5 pb-5" {...(acik ? {} : { inert: true })}>
        <PanelHataSiniri baslik={baslik}>{children}</PanelHataSiniri>
      </div>
    </Collapse>
  </div>
);

export default KatlanirPanel;
