// src/components/server_hub/KarsilastirmaRaporu.tsx — Retirement etiketleri ile Analiz kararı nerede ayrışıyor
// (Faz 4, 2026-11-11; docs/RETIREMENT-MOTOR-BIRLESTIRME.md). Salt okunur gözlem raporu: etiket motoru
// kaldırılmadan önce "kritik" ve "Analiz aday, etiket engelli" satırları sıfıra inmeli.
import React, { useCallback, useState } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { serverHubApi, type ShKarsilastirma, type ShKarsilastirmaSinif } from '@/api/serverHubApi';
import LoadError from '@/components/common/LoadError';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { fmtNumber } from '@/utils/datetime';
import Rozet, { type DurumTon } from './DurumRozeti';
import { BTN, btnStil } from './RetireEtiketleri';

const SINIF: Record<ShKarsilastirmaSinif, { ad: string; aciklama: string; ton: DurumTon }> = {
  KRITIK_A_KESIN_B_KULLANIMDA: { ad: 'Kritik ayrışma', aciklama: 'Etiket “kesin retire” diyor, Analiz kullanım görüyor.', ton: 'kotu' },
  A_KESIN_B_KARARSIZ: { ad: 'Etiket kesin, Analiz emin değil', aciklama: 'Analiz şüpheli / karar verilemez / sorun yok diyor.', ton: 'uyari' },
  B_ADAY_A_ENGEL: { ad: 'Analiz aday, etiket engelli', aciklama: 'Etiket zincir nedeniyle şüpheliye inmiş.', ton: 'uyari' },
  B_ADAY_A_YOK: { ad: 'Yalnız Analiz aday', aciklama: 'Etiket kuralı bu grubu işaretlemiyor; elle inceleyin.', ton: 'uyari' },
  ANAHTAR_ESLENEMEDI: { ad: 'Eşlenemedi', aciklama: 'Etiketin Analiz grubu bulunamadı (ad / ortam / nesil).', ton: 'notr' },
  A_ONLY_EAR_GIRDI: { ad: 'Disk temizliği', aciklama: 'EAR / kök girdi etiketi; Analiz’de karşılığı yok, Retirement kaydı açmaz.', ton: 'notr' },
  UYUM: { ad: 'Uyumlu', aciklama: 'İki taraf aynı yönde.', ton: 'iyi' },
};
const SIRA = Object.keys(SINIF) as ShKarsilastirmaSinif[];
const MUTED: React.CSSProperties = { color: 'var(--text-muted)' };

export default function KarsilastirmaRaporu() {
  const [veri, setVeri] = useState<ShKarsilastirma | null>(null);
  const [hata, setHata] = useState('');
  const [yukleniyor, setYukleniyor] = useState(false);
  const [secili, setSecili] = useState<ShKarsilastirmaSinif | null>(null);
  const yukle = useCallback(async (fresh: boolean) => {
    setYukleniyor(true);
    try {
      setVeri(await serverHubApi.iliskiKarsilastirma(fresh));
      setHata('');
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e));
    } finally {
      setYukleniyor(false);
    }
  }, []);
  useAsyncEffect(async () => {
    await yukle(false);
  }, [yukle]);
  if (hata && !veri) return <LoadError title="Karşılaştırma yapılamadı" message={hata} onRetry={() => yukle(true)} retrying={yukleniyor} />;
  if (!veri) return <LoadingLogo />;
  const satirlar = veri.satirlar.filter((x) => (secili ? x.sinif === secili : x.sinif !== 'UYUM'));
  return (
    <div className="space-y-3" data-testid="karsilastirma">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs" style={MUTED}>
          Retirement etiketleri (R1–R12) ile Analiz’in ortam/kurulum kararı. Etiket motoru kaldırılmadan önce kritik ve
          “Analiz aday, etiket engelli” satırları sıfır olmalı.{veri.latestScan ? ` Son tarama ${veri.latestScan}.` : ''}
        </p>
        <button type="button" className={`${BTN} ml-auto`} style={btnStil()} onClick={() => yukle(true)} disabled={yukleniyor}>
          <ArrowPathIcon className={`w-3.5 h-3.5 ${yukleniyor ? 'animate-spin' : ''}`} /> Yenile
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {SIRA.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={secili === s}
            onClick={() => setSecili(secili === s ? null : s)}
            className="rounded-lg border px-3 py-2 text-left"
            style={{ borderColor: secili === s ? 'var(--accent)' : 'var(--border-subtle)', background: 'var(--bg-surface)' }}
            title={SINIF[s].aciklama}
          >
            <div className="text-[11px]" style={MUTED}>
              {SINIF[s].ad}
            </div>
            <div className="text-lg font-semibold tabular-nums" style={{ color: veri.sayilar[s] && SINIF[s].ton === 'kotu' ? 'var(--status-danger)' : 'var(--text-primary)' }}>
              {fmtNumber(veri.sayilar[s] || 0)}
            </div>
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-subtle)' }}>
        <table className="w-full text-xs">
          <thead>
            <tr style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}>
              <th className="px-3 py-2 text-left">Sınıf</th>
              <th className="px-3 py-2 text-left">Uygulama / konu</th>
              <th className="px-3 py-2 text-left">Ortam · nesil</th>
              <th className="px-3 py-2 text-left">Etiket</th>
              <th className="px-3 py-2 text-left">Analiz</th>
              <th className="px-3 py-2 text-left">Not</th>
            </tr>
          </thead>
          <tbody>
            {satirlar.map((x, i) => (
              <tr key={`${x.etiket || x.grup}-${i}`} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                <td className="px-3 py-1.5">
                  <Rozet metin={SINIF[x.sinif].ad} ton={SINIF[x.sinif].ton} />
                </td>
                <td className="px-3 py-1.5 font-mono">{x.konu}</td>
                <td className="px-3 py-1.5">
                  {x.ortam || '?'} · {x.nesil ?? '?'}
                </td>
                <td className="px-3 py-1.5">{x.etiketSeviye ? `${x.etiketSeviye === 'KESIN' ? 'kesin' : 'şüpheli'} (${x.kurallar.join(', ')})` : '—'}</td>
                <td className="px-3 py-1.5">{x.grupKarar || '—'}</td>
                <td className="px-3 py-1.5" style={MUTED}>
                  {(x.nedenler || []).join('; ')}
                </td>
              </tr>
            ))}
            {!satirlar.length && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center" style={MUTED}>
                  {secili ? 'Bu sınıfta satır yok.' : 'Ayrışma yok: iki taraf her yerde uyumlu.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
