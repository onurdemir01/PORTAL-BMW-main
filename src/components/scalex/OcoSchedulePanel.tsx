// src/components/scalex/OcoSchedulePanel.tsx — zamanlanmış OCO tetiklemeleri.
//
// NEDEN VAR: ScaleX'te OCO penceresi henüz açılmamışsa sunucu 200 OK dönüp
// SESSİZCE hiçbir şey yapmıyordu. Kullanıcı açısından: "numarayı girdim, hiçbir
// şey olmadı." Artık pencere açıldığında otomatik başlayacak bir kayıt
// oluşturuluyor ve o kayıt **her noktada** iptal edilebiliyor ya da
// güncellenebiliyor.
//
// GÖRÜNÜRLÜK: kullanıcı KENDİ ve GRUBUNUN kayıtlarını görür; Admin hepsini.
// Filtre sunucuda — istemciye fazla kayıt gönderip orada gizlemek, veriyi zaten
// sızdırmak olurdu.
import React, { useCallback, useState } from 'react';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { ClockIcon, XCircleIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import { scalexApi, type ScaleXOcoSchedule } from '@/api/scalexApi';
import { fmtDateTime } from '@/utils/datetime';

/** Beklemede olan — yani iptal/güncelleme yapılabilen durumlar. */
const ACIK = new Set(['SCHEDULED', 'AWX_SCHEDULED', 'PENDING_APPROVAL']);

const DURUM_ETIKET: Record<string, string> = {
  SCHEDULED: 'Zamanlandı',
  AWX_SCHEDULED: 'AWX zamanlaması',
  LAUNCHING: 'Başlatılıyor',
  PENDING_APPROVAL: 'Onay bekliyor',
  LAUNCHED: 'Başlatıldı',
  CANCELLED: 'İptal edildi',
  EXPIRED: 'Penceresi kapandı',
  FAILED: 'Başarısız',
};

interface Props {
  /** Artırıldığında liste yeniden okunur (yeni kayıt, iptal, güncelleme). */
  reloadKey?: number;
}

const OcoSchedulePanel: React.FC<Props> = ({ reloadKey = 0 }) => {
  const [items, setItems] = useState<ScaleXOcoSchedule[]>([]);
  const [scope, setScope] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [duzenlenen, setDuzenlenen] = useState<number | null>(null);
  const [yeniNumara, setYeniNumara] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await scalexApi.ocoSchedules();
      if (r.ok) {
        setItems(r.items || []);
        setScope(r.scope || '');
        setError(null);
      } else setError(r.message || 'Zamanlanmış işlemler okunamadı.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // `useAsyncEffect`: deponun bu is icin yazilmis hook'u. Yuklemeyi effect
  // flush'indan SONRAKI mikro-goreve erteler — yani `load`un ilk satirindaki
  // `setLoading(true)` effect govdesinde SENKRON degildir. Ayrica bilesen
  // sokulduysa `alive()` false doner ve cozulmus bir istek artik olmayan bir
  // bilesene yazmaz.
  useAsyncEffect(async (alive) => {
    if (alive()) await load();
  }, [load, reloadKey]);

  async function iptal(id: number) {
    setBusyId(id);
    setError(null);
    try {
      const r = await scalexApi.ocoScheduleCancel(id);
      // SUNUCU "İPTAL EDİLEMEDİ" DİYEBİLİR (409): kayıt bu arada tetiklenmiş
      // olabilir. Bunu başarı gibi göstermek, kullanıcıya YALAN söylemek olurdu.
      if (!r.ok) setError(r.message || 'İptal edilemedi.');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function guncelle(id: number) {
    if (!yeniNumara.trim()) return;
    setBusyId(id);
    setError(null);
    try {
      const r = await scalexApi.ocoScheduleUpdate(id, { ocoNumber: yeniNumara.trim() });
      if (!r.ok) setError(r.message || 'Güncellenemedi.');
      else {
        setDuzenlenen(null);
        setYeniNumara('');
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading && !items.length) {
    return <p className="text-sm text-[var(--text-muted)]">Zamanlanmış işlemler okunuyor…</p>;
  }
  if (!items.length && !error) return null;

  return (
    <section className="rounded-xl border border-[var(--border)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ClockIcon aria-hidden="true" className="w-4 h-4 text-[var(--text-secondary)]" />
        <p className="text-sm font-semibold text-[var(--text-primary)]">Zamanlanmış işlemler</p>
        <span className="text-xs text-[var(--text-muted)]">
          {scope === 'all' ? 'tüm kullanıcılar' : 'siz ve grubunuz'}
        </span>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="divide-y divide-[var(--border)]">
        {items.map((it) => {
          const acik = ACIK.has(it.status);
          return (
            <div key={it.id} className="py-2.5 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-[var(--text-primary)]">OCO {it.ocoNumber}</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    acik
                      ? 'bg-amber-100 text-amber-900'
                      : it.status === 'LAUNCHED'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-[var(--bg-inset)] text-[var(--text-muted)]'
                  }`}
                >
                  {DURUM_ETIKET[it.status] || it.status}
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  pencere {fmtDateTime(it.runAt)}
                </span>
                {/* SAHIBI HER ZAMAN YAZILIR: grubun kaydını görüyorsan kimin
                    açtığını bilmeden iptal etmek tehlikeli olurdu. */}
                <span className="text-xs text-[var(--text-muted)]">· {it.username}</span>
                {it.cancelledBy && it.cancelledBy !== it.username && (
                  <span className="text-xs text-[var(--text-muted)]">
                    · iptal: {it.cancelledBy}
                  </span>
                )}
              </div>

              {it.ocoSubject && (
                <p className="text-xs text-[var(--text-muted)] truncate" title={it.ocoSubject}>
                  {it.ocoSubject}
                </p>
              )}
              {it.errorMessage && (
                <p className="text-xs text-red-700">{it.errorMessage}</p>
              )}

              {acik && (
                <div className="flex flex-wrap items-center gap-2">
                  {duzenlenen === it.id ? (
                    <>
                      <input
                        value={yeniNumara}
                        onChange={(e) => setYeniNumara(e.target.value)}
                        inputMode="numeric"
                        placeholder="yeni OCO numarası"
                        className="w-44 px-2.5 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
                      />
                      <button
                        type="button"
                        className="btn-primary text-xs py-1.5"
                        disabled={busyId === it.id || !yeniNumara.trim()}
                        onClick={() => guncelle(it.id)}
                      >
                        Kaydet
                      </button>
                      <button
                        type="button"
                        className="text-xs text-[var(--text-muted)] underline decoration-dotted"
                        onClick={() => {
                          setDuzenlenen(null);
                          setYeniNumara('');
                        }}
                      >
                        vazgeç
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
                        onClick={() => {
                          setDuzenlenen(it.id);
                          setYeniNumara(it.ocoNumber);
                        }}
                      >
                        <PencilSquareIcon aria-hidden="true" className="w-3.5 h-3.5" /> OCO
                        numarasını değiştir
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs text-red-700 hover:underline disabled:opacity-50"
                        disabled={busyId === it.id}
                        onClick={() => iptal(it.id)}
                      >
                        <XCircleIcon aria-hidden="true" className="w-3.5 h-3.5" />
                        {busyId === it.id ? 'İptal ediliyor…' : 'İptal et'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default OcoSchedulePanel;
