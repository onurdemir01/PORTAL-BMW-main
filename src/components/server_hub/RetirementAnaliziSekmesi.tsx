// src/components/server_hub/RetirementAnaliziSekmesi.tsx — Retirement Analizi + Retirement etiketleri (2026-11-11).
//
// Kullanıcı: "Retirement etiketleri ile Retirement Analizi birbirinin aynısı ise etiketlerdeki
// feature'ları Analiz'e yükleyebiliriz; Bulgular sayfası tek başına olsun." Etiket listesi Bulgular'ın
// alt görünümüyken buraya taşındı: retirement ile ilgili iki görünüm tek sekmede.
// İKİ MOTOR HÂLÂ AYRI: Analiz (senaryo.cjs, uygulama/kopya kararı) ve etiketler (retire-etiket.cjs, R1–R12,
// Admin kural seviyesi, kanıt imzalı elle kontrol, KESIN + DOĞRULANDI kapısı). Motorların birleşmesi
// ayrı bir iş; bu dosya yalnız yerleşimi birleştirir, hiçbir karar değiştirmez.
import React, { useCallback, useState } from 'react';
import { serverHubApi, type ShRetireSonuc } from '@/api/serverHubApi';
import { toast } from '@/hooks/useToast';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { fmtNumber } from '@/utils/datetime';
import RetirementAnaliziTab from './RetirementAnaliziTab';
import RetireEtiketleriGorunum from './RetireEtiketleri';
import KarsilastirmaRaporu from './KarsilastirmaRaporu';
import { useSekmeGorunur } from './sekmeGorunurlugu';

type Gorunum = 'analiz' | 'etiketler' | 'karsilastirma';

export default function RetirementAnaliziSekmesi({
  onRetirementAc,
  baslangic,
}: {
  onRetirementAc?: (uygulama: string, not: string) => void;
  baslangic?: { anahtar: string; no: number } | null;
}) {
  const gorunur = useSekmeGorunur();
  const [gorunum, setGorunum] = useState<Gorunum>('analiz');
  // "Analizde aç" geldiğinde karar görünümüne dön (render sırasında, effect yok).
  const [sonNo, setSonNo] = useState(baslangic ? baslangic.no : 0);
  if (baslangic && baslangic.no !== sonNo) {
    setSonNo(baslangic.no);
    setGorunum('analiz');
  }
  const [retire, setRetire] = useState<ShRetireSonuc | null>(null);
  const [retireYuk, setRetireYuk] = useState(false);
  const retireYukle = useCallback(async (fresh = false) => {
    setRetireYuk(true);
    try {
      const r = await serverHubApi.retireEtiketleri(fresh);
      if (r.ok) setRetire(r);
      else toast.error(r.message || 'Retirement etiketleri alınamadı.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRetireYuk(false);
    }
  }, []);
  // Etiket verisi yalnız etiket görünümü açılınca (ve sekme görünürken) indirilir.
  useAsyncEffect(async () => {
    if (gorunur && gorunum === 'etiketler' && !retire) await retireYukle();
  }, [gorunur, gorunum, retire, retireYukle]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1" role="tablist" aria-label="Retirement görünümü">
        {(
          [
            ['analiz', 'Karar analizi'],
            ['etiketler', `Retirement etiketleri${retire ? ` (${fmtNumber(retire.ozet.toplam)})` : ''}`],
            ['karsilastirma', 'Karşılaştırma'],
          ] as const
        ).map(([id, ad]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={gorunum === id}
            onClick={() => setGorunum(id)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border"
            style={{
              borderColor: gorunum === id ? 'var(--accent)' : 'var(--border-subtle)',
              background: gorunum === id ? 'var(--bg-elevated)' : 'var(--bg-surface)',
              color: gorunum === id ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
          >
            {ad}
          </button>
        ))}
        <span className="ml-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {gorunum === 'analiz'
            ? 'Tek uygulama / sunucu / IP için app + web + IP katmanlarını birlikte okuyan karar.'
            : gorunum === 'etiketler'
              ? 'R1–R12 kurallarıyla işaretlenen adaylar; elle kontrol ve Retirement kaydı buradan.'
              : 'İki motor nerede ayrışıyor (birleştirme gözlem raporu).'}
        </span>
      </div>
      <div hidden={gorunum !== 'analiz'}>
        <RetirementAnaliziTab onRetirementAc={onRetirementAc} baslangic={baslangic} />
      </div>
      {gorunum === 'karsilastirma' && <KarsilastirmaRaporu />}
      {gorunum === 'etiketler' && (
        <RetireEtiketleriGorunum veri={retire} yukleniyor={retireYuk} onYenile={retireYukle} onRetirementAc={onRetirementAc} />
      )}
    </div>
  );
}
