// src/components/admin/tabs/sistem/OnbellekPaneli.tsx — onbellek temizleme eylemleri.
//
// DURUSTLUK (eski ekranin sessiz basarisizligi): Nobet onbellegi icin sunucu yaniti HIC
// okunmuyordu; 403/404/500 gelse de "temizlendi" deniyordu. Iki sunucu ucu da nobet modulunun
// icinde (server/nobetci/index.cjs) — modul yuklenmezse 404 doner. Simdi yanit `okJson` ile
// okunur ve sonuc kartin icinde yazar. "Yalniz bu tarayici" eylemleri diger kullanicilari
// etkilemez; bu da acikca yazar.
import React, { useRef, useState } from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { okJson } from '@/api/http';
import { inventoryApi } from '@/api/inventoryApi';
import { nobetciApi } from '@/api/nobetciApi';
import { dynatraceApi } from '@/api/dynatraceApi';
import { toast } from '@/hooks/useToast';
import { fmtTime } from '@/utils/datetime';
import Rozet from './Rozet';

type Kapsam = 'sunucu+tarayici' | 'sunucu' | 'tarayici';

interface Eylem {
  id: string;
  etiket: string;
  aciklama: string;
  kapsam: Kapsam;
  uc: string | null;
  istemci?: () => void;
}

export const ONBELLEK_EYLEMLERI: Eylem[] = [
  {
    id: 'nobetci',
    etiket: 'Nöbet listesi önbelleği',
    aciklama: 'Bugünkü nöbetçi listesi sunucuda 5 dk tutulur.',
    kapsam: 'sunucu+tarayici',
    uc: '/api/admin/cache/nobetci',
    istemci: () => nobetciApi.invalidate(),
  },
  {
    id: 'awx-tokens',
    etiket: "AWX oturum token'ları",
    aciklama: "AWX sunucuları için saklanan token'lar; bir sonraki istekte yeniden alınır.",
    kapsam: 'sunucu',
    uc: '/api/admin/cache/awx-tokens',
  },
  {
    id: 'inventory',
    etiket: 'Envanter tablo önbelleği',
    aciklama: 'Tablo ve sütun listesi; diğer kullanıcıları etkilemez.',
    kapsam: 'tarayici',
    uc: null,
    istemci: () => inventoryApi.invalidateCache?.(),
  },
  {
    id: 'dt-health',
    etiket: 'Dynatrace sağlık önbelleği',
    aciklama: 'Sağlık durumu önbelleği; diğer kullanıcıları etkilemez.',
    kapsam: 'tarayici',
    uc: null,
    istemci: () => dynatraceApi.invalidateCache?.(),
  },
];

const KAPSAM_ETIKETI: Record<Kapsam, string> = {
  'sunucu+tarayici': 'Sunucu + bu tarayıcı',
  sunucu: 'Sunucu',
  tarayici: 'Yalnız bu tarayıcı',
};

interface Sonuc {
  ok: boolean;
  metin: string;
  zaman: string;
}

export default function OnbellekPaneli() {
  const [calisan, setCalisan] = useState<ReadonlySet<string>>(new Set());
  const [sonuclar, setSonuclar] = useState<Record<string, Sonuc>>({});
  const calisanRef = useRef<Set<string>>(new Set());

  async function temizle(e: Eylem) {
    if (calisanRef.current.has(e.id)) return;
    calisanRef.current.add(e.id);
    setCalisan(new Set(calisanRef.current));
    let sonuc: Sonuc;
    try {
      e.istemci?.();
      if (e.uc) {
        const r = await okJson<{ ok?: boolean; error?: string; message?: string }>(
          await fetch(e.uc, { method: 'POST' }),
        );
        if (r && r.ok === false) throw new Error(r.message || r.error || 'Sunucu temizlemeyi reddetti.');
      }
      sonuc = { ok: true, metin: 'Temizlendi', zaman: fmtTime(new Date()) };
      toast.success(`${e.etiket} temizlendi.`);
    } catch (err: unknown) {
      const durumKodu = (err as { status?: number } | null)?.status;
      let metin =
        durumKodu === 404
          ? 'Sunucu bu ucu tanımıyor (HTTP 404); nöbet modülü bu sunucuda etkin olmayabilir.'
          : err instanceof Error && err.message
            ? err.message
            : `Temizlenemedi${durumKodu ? ` (HTTP ${durumKodu})` : ''}.`;
      if (e.kapsam === 'sunucu+tarayici') metin += ' Bu tarayıcının önbelleği temizlendi.';
      sonuc = { ok: false, metin, zaman: fmtTime(new Date()) };
      toast.error(`${e.etiket} temizlenemedi.`);
    } finally {
      calisanRef.current.delete(e.id);
      setCalisan(new Set(calisanRef.current));
    }
    setSonuclar((s) => ({ ...s, [e.id]: sonuc }));
  }

  return (
    <section aria-labelledby="sistem-onbellek" className="space-y-3">
      <div>
        <h3 id="sistem-onbellek" className="text-sm !font-semibold !text-[var(--text-primary)]">
          Önbellekler
        </h3>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
          Önbelleği temizlemek veri silmez; bir sonraki istek kaynağı yeniden okur.
        </p>
      </div>
      <ul className="grid gap-2 @xl/sistem:grid-cols-2">
        {ONBELLEK_EYLEMLERI.map((e) => {
          const yuk = calisan.has(e.id);
          const s = sonuclar[e.id];
          return (
            <li
              key={e.id}
              className="flex items-start gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 min-w-0"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[13px] font-medium text-[var(--text-primary)]">{e.etiket}</span>
                  <Rozet ton={e.kapsam === 'tarayici' ? 'grey' : 'blue'}>{KAPSAM_ETIKETI[e.kapsam]}</Rozet>
                </div>
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{e.aciklama}</p>
                {/* Canli bolge hep DOM'da (icerikle eklenen bolge cogu zaman duyurulmaz). */}
                <p role="status" className={s ? 'mt-1.5 flex flex-wrap items-center gap-1.5 text-xs' : 'sr-only'}>
                  {s &&
                    (s.ok ? (
                      <>
                        <Rozet ton="green">{s.metin}</Rozet>
                        <span className="text-[var(--text-muted)] tabular-nums">{s.zaman}</span>
                      </>
                    ) : (
                      <span className="text-[var(--status-danger-text)]">
                        {s.metin} <span className="text-[var(--text-muted)] tabular-nums">{s.zaman}</span>
                      </span>
                    ))}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void temizle(e)}
                disabled={yuk}
                aria-label={`${e.etiket}: temizle`}
                className="btn-secondary flex-shrink-0 !py-1 !px-2.5 !text-xs min-h-11 @md/sistem:min-h-0"
              >
                <ArrowPathIcon
                  aria-hidden="true"
                  className={`w-3.5 h-3.5 ${yuk ? 'animate-spin motion-reduce:animate-none' : ''}`}
                />
                Temizle
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
