// src/hooks/useScaleXLimits.ts — ScaleX sinirlarini SUNUCUDAN okur.
//
// Sinirlar (dogrulama butcesi varsayilan/min/max, hedef tavani, sapma taramasi
// tavani) artik Admin > Sistem ekranindan degistirilebiliyor ve degisiklik ANINDA
// gecerli oluyor (server/scalex/config.cjs her istekte `process.env`i yeniden okur).
//
// Ekran bu degerleri ELDE tutarsa admin varsayilani 600 yaptiginda kullanici hala
// "30-3600 arasi bir deger girin" gorur, girdigi degeri sunucu reddeder ve neden
// reddedildigi hicbir yerde YAZMAZ. O yuzden tek dogru kaynak sunucudur.
//
// FALLBACK SESSIZ DEGIL: istek basarisiz olursa fabrika degerleriyle devam edilir
// ama `stale` bayragi doner; cagiran bunu kullaniciya soyleyebilir.
import { useState } from 'react';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { scalexApi } from '@/api/scalexApi';

export interface ScaleXLimits {
  timeoutDefault: string;
  timeoutMin: number;
  timeoutMax: number;
  failMultiplier: number;
  maxTargets: number;
  prodConfirmThreshold: number;
  maxAuditGroups: number;
  /** Sunucudan okunamadi — fabrika degerleri gosteriliyor. */
  stale: boolean;
  /** Admin tutarsiz bir ayar yazmis; sunucu fabrika degerine dusmus. */
  problems: string[];
}

// FABRIKA DEGERLERI — `server/scalex/config.cjs` icindeki `fallback`larla AYNI
// olmali. Bekci (scalex-dinamik-ayarlar.test.cjs) ikisini birden kilitler; ayrismak,
// sunucu henuz cevap vermeden once ekranin YANLIS bir aralik gostermesi demekti.
export const SCALEX_FALLBACK_LIMITS: ScaleXLimits = {
  timeoutDefault: '300',
  timeoutMin: 30,
  timeoutMax: 3600,
  failMultiplier: 2,
  maxTargets: 200,
  prodConfirmThreshold: 5,
  maxAuditGroups: 12,
  stale: false,
  problems: [],
};

export function useScaleXLimits(): ScaleXLimits {
  const [limits, setLimits] = useState<ScaleXLimits>(SCALEX_FALLBACK_LIMITS);

  useAsyncEffect(async (alive) => {
    try {
      const r = await scalexApi.config();
      if (!alive()) return;
      if (!r.ok) {
        setLimits((p) => ({ ...p, stale: true }));
        return;
      }
      setLimits({
        timeoutDefault: String(r.verificationTimeout.default),
        timeoutMin: r.verificationTimeout.min,
        timeoutMax: r.verificationTimeout.max,
        failMultiplier: r.verificationTimeout.failMultiplier,
        maxTargets: r.maxTargets,
        prodConfirmThreshold: r.prodConfirmThreshold,
        maxAuditGroups: r.maxAuditGroups,
        stale: false,
        problems: r.problems || [],
      });
    } catch {
      if (alive()) setLimits((p) => ({ ...p, stale: true }));
    }
  }, []);

  return limits;
}
