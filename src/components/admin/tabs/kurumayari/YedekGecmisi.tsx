// src/components/admin/tabs/kurumayari/YedekGecmisi.tsx — Portal'dan her kayıtta alınan yedekler.
// Seçilen yedeğin farkı ön izlemede gösterilir; geri yükleme normal kayıt yolundan geçer (yedek
// alınır, 409 kilidi geçerli).
import React, { useCallback, useState } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { fmtDateTime, fmtNumber } from '@/utils/datetime';
import LoadError from '@/components/common/LoadError';
import {
  kurumAyariApi,
  type KurumAyariYedegi,
  type KurumAyariYedekIcerigi,
} from '@/api/kurumAyariApi';

interface Props {
  /** Değişince liste yeniden okunur (kayıttan sonra). */
  surum: number;
  maksYedek: number;
  onSec: (yedek: KurumAyariYedekIcerigi) => void;
  pasif: boolean;
}

export default function YedekGecmisi({ surum, maksYedek, onSec, pasif }: Props) {
  const [yedekler, setYedekler] = useState<KurumAyariYedegi[] | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [aciliyor, setAciliyor] = useState<string | null>(null);

  const yukle = useCallback(async () => {
    try {
      setYedekler((await kurumAyariApi.yedekler()).yedekler);
      setHata(null);
    } catch (e) {
      setHata((e as Error).message);
    }
  }, []);
  useAsyncEffect(
    async (alive) => {
      if (alive()) await yukle();
    },
    [yukle, surum],
  );

  const sec = async (ad: string) => {
    setAciliyor(ad);
    try {
      onSec(await kurumAyariApi.yedek(ad));
      setHata(null);
    } catch (e) {
      setHata((e as Error).message);
    } finally {
      setAciliyor(null);
    }
  };

  return (
    <section className="space-y-2" aria-label="Yedek geçmişi">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">Geçmiş ve geri dönüş</h3>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Her kayıtta dosyanın eski hali yedeklenir; en yeni {maksYedek} yedek tutulur.
        </span>
        <button
          type="button"
          onClick={() => void yukle()}
          className="btn-secondary text-xs ml-auto inline-flex items-center gap-1"
        >
          <ArrowPathIcon className="w-3.5 h-3.5" /> Yenile
        </button>
      </div>
      {hata && (
        <LoadError compact title="Yedekler okunamadı" message={hata} onRetry={() => void yukle()} />
      )}
      {!hata && yedekler?.length === 0 && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Henüz Portal'dan kaydedilmiş bir değişiklik yok.
        </p>
      )}
      {!!yedekler?.length && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs" style={{ color: 'var(--text-muted)' }}>
              <th
                className="py-1 pr-3 font-medium"
                title="Yedek, dosyanın bu zamanda değiştirilmeden önceki halidir."
              >
                Bu zamana kadar geçerli hal
              </th>
              <th className="py-1 pr-3 font-medium">Boyut</th>
              <th className="py-1 pr-3 font-medium">Özet (sha)</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {yedekler.map((y) => (
              <tr key={y.ad} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                <td className="py-1 pr-3">{fmtDateTime(y.zaman)}</td>
                <td className="py-1 pr-3">{fmtNumber(y.boyut)} bayt</td>
                <td className="py-1 pr-3" style={{ fontFamily: 'var(--font-mono)' }}>
                  {y.shaKisa}
                </td>
                <td className="py-1 text-right">
                  <button
                    type="button"
                    disabled={pasif || aciliyor !== null}
                    onClick={() => void sec(y.ad)}
                    className="btn-secondary !py-1 !px-2.5 !text-xs"
                  >
                    {aciliyor === y.ad ? 'Açılıyor…' : 'Farkı göster'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
