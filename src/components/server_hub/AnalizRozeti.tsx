// src/components/server_hub/AnalizRozeti.tsx — Retirement Analizi kararının küçük rozeti (2026-11-07).
//
// Uygulama 360 ve sunucu paneli (Sunucular satırı, Bulgular satırı, Ayrıntı penceresi, Uygulama 360
// sunucusu) Retirement Analizi sekmesiyle AYNI kararı gösterir: tek kaynak (/iliski/karar), iki giriş.
// Rozet hiçbir şey çalıştırmaz; düğme yalnız Retirement Analizi sekmesini o kayıt seçili açar.
// Okunamayan karar yeşil görünmez; grafikte olmayan kayıt "yok" diye ayrı yazılır.
import React, { createContext, useContext, useState } from 'react';
import { serverHubApi, type ShKararAyrinti, type ShNot } from '@/api/serverHubApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import Rozet from './DurumRozeti';
import { BTN, btnStil } from './RetireEtiketleri';
import { KARAR_KISA, KARAR_SIRA, KARAR_TON } from './RetirementAnaliziTab';

/** ServerHubPage verir: anahtar -> Retirement Analizi sekmesi o kayıt seçili. Verilmezse düğme yok. */
export const AnalizAcContext = createContext<((anahtar: string) => void) | null>(null);

// Grafik anahtarlarıyla birebir (iliski-grafigi.cjs `A`): sunucu kısa ad (IPv4 adı kısaltılmaz), büyük harf.
export const sunucuAnahtari = (host: string) => {
  const s = String(host || '').trim();
  return `sunucu:${/^\d+\.\d+\.\d+\.\d+$/.test(s) ? s : s.split('.')[0].toUpperCase()}`;
};
export const uygulamaAnahtari = (ad: string) =>
  `app:${String(ad || '')
    .trim()
    .toUpperCase()}`;

type Durum =
  | { tur: 'yukleniyor' }
  | { tur: 'yok'; mesaj: string }
  | { tur: 'hata'; mesaj: string }
  | { tur: 'tamam'; veri: ShKararAyrinti };

const MUTED: React.CSSProperties = { color: 'var(--text-muted)' };

function NotOzeti({ notlar }: { notlar: ShNot[] }) {
  if (!notlar.length) return null;
  return (
    <>
      <span style={MUTED}>{notlar.length} not</span>
      {notlar.some((n) => n.veriDegisti) && <Rozet metin="veri değişti" ton="uyari" />}
    </>
  );
}

function Govde({ veri }: { veri: ShKararAyrinti }) {
  if (veri.tur === 'app' && veri.uygulama) {
    const u = veri.uygulama;
    return (
      <>
        {/* Tek rozet: karar cümlesi kararın tonunda (kısa ad + cümle tekrar etmesin). */}
        <Rozet metin={u.kararMetni || KARAR_KISA[u.karar]} ton={KARAR_TON[u.karar]} />
        {u.bilinen && <Rozet metin="Bilinen" ton="notr" title={u.bilinen.metin} />}
        <NotOzeti notlar={u.notlar || []} />
      </>
    );
  }
  if (veri.tur === 'sunucu') {
    const kk = veri.kopyalar || [];
    return (
      <>
        {kk.length ? (
          KARAR_SIRA.map((k) => {
            const n = kk.filter((x) => x.karar === k).length;
            return n ? (
              <Rozet
                key={k}
                metin={`${n} kopya ${KARAR_KISA[k].toLowerCase()}`}
                ton={KARAR_TON[k]}
              />
            ) : null;
          })
        ) : (
          <span style={MUTED}>Bu sunucuda karar verilecek uygulama kopyası yok.</span>
        )}
        <NotOzeti notlar={veri.notlar || []} />
      </>
    );
  }
  if (veri.kopya) {
    const k = veri.kopya;
    return (
      <>
        <Rozet metin={k.kararMetni || KARAR_KISA[k.karar]} ton={KARAR_TON[k.karar]} />
        <NotOzeti notlar={k.notlar || []} />
      </>
    );
  }
  return <span style={MUTED}>Karar yok.</span>;
}

export default function AnalizRozeti({ anahtar }: { anahtar: string }) {
  const analizAc = useContext(AnalizAcContext);
  const [durum, setDurum] = useState<Durum>({ tur: 'yukleniyor' });
  useAsyncEffect(
    async (alive) => {
      setDurum({ tur: 'yukleniyor' });
      try {
        const r = await serverHubApi.iliskiKarar(anahtar);
        if (!alive()) return;
        // okJson boş / JSON olmayan 200'de null döner: "karar yok" sanılmasın, okunamadı.
        if (!r || typeof r !== 'object' || !r.tur)
          setDurum({ tur: 'hata', mesaj: 'Karar yanıtı okunamadı.' });
        else setDurum({ tur: 'tamam', veri: r });
      } catch (e) {
        if (!alive()) return;
        const mesaj = e instanceof Error ? e.message : String(e);
        // 409: kayıt grafikte yok (son taramada bu ad yok). Diğer her şey "okunamadı".
        setDurum(
          (e as { status?: number }).status === 409
            ? { tur: 'yok', mesaj }
            : { tur: 'hata', mesaj },
        );
      }
    },
    [anahtar],
  );
  return (
    <div
      className="flex flex-wrap items-center gap-2 text-xs rounded-lg border px-2.5 py-1.5"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
      data-testid="analiz-rozeti"
    >
      <span className="font-semibold">Retirement Analizi:</span>
      {durum.tur === 'yukleniyor' && <span style={MUTED}>okunuyor…</span>}
      {durum.tur === 'yok' && <span style={MUTED}>{durum.mesaj}</span>}
      {durum.tur === 'hata' && (
        <>
          <Rozet metin="okunamadı" ton="uyari" />
          <span style={MUTED}>{durum.mesaj}</span>
        </>
      )}
      {durum.tur === 'tamam' && <Govde veri={durum.veri} />}
      {analizAc && durum.tur === 'tamam' && (
        <button
          type="button"
          className={`${BTN} ml-auto`}
          style={btnStil()}
          onClick={() => analizAc(anahtar)}
        >
          Analizde aç
        </button>
      )}
    </div>
  );
}
