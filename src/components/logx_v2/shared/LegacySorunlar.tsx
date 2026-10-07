// src/components/logx_v2/shared/LegacySorunlar.tsx — "ne alınamadı ve neden" listesi.
//
// Üç ekran aynı listeyi gösterir (özet `legacySonuc.ts`'ten gelir):
//   - Dosya seçimi : kısmi keşifte taranamayan sunucular
//   - Hata ekranı  : keşif ya da aktarım tümüyle başarısızsa sunucu / dosya sebepleri
//   - İndirme      : arşiv üretildi ama içinde olmayan sunucular ve dosyalar
//
// Her satır bir cümlelik özet + playbook'un HAM sebebini taşır. Ham metin gizlenmez: yolu,
// asıl hatayı ve hangi kullanıcıyla denendiğini o söyler; sorunu çözecek kişi ona bakar.
import React from 'react';
import { legacySebep } from '@/utils/legacySebep';
import type { LegacySorunlar as Sorunlar } from './legacySonuc';

// DOM SINIRI: yüzlerce dosyalı bir seçimde hepsi düşerse ekran binlerce satır basmasın.
const SATIR_SINIRI = 20;
const HAM_SINIRI = 400;

const DURUM_ETIKETI: Record<'unreachable' | 'error', string> = {
  unreachable: 'erişilemedi',
  error: 'hata',
};

const Sebep: React.FC<{ ham: string }> = ({ ham }) => {
  const s = legacySebep(ham);
  // Ham metin ozetle ayni seyi soyluyorsa ikinci satir olarak TEKRAR edilmez.
  if (!s.cevrildi || !s.hamEkBilgi) return <span className="break-words">{s.ozet}</span>;
  const kisa = s.ham.length > HAM_SINIRI ? `${s.ham.slice(0, HAM_SINIRI)}…` : s.ham;
  return (
    <>
      <span>{s.ozet}</span>
      <span
        className="block text-[var(--text-muted)] break-words"
        title={s.ham}
        data-testid="logx-ham-sebep"
      >
        {kisa}
      </span>
    </>
  );
};

type Props = {
  sorunlar: Sorunlar;
  /** Sunucu listesinin başlığı (ör. "Taranamayan sunucular"). */
  sunucuBasligi: string;
  /** Envanterde OLMAYAN, elle eklenmiş sunucular — en olası sebep adın yanlış yazılmasıdır. */
  manualHosts?: string[];
  testId?: string;
  /** Listenin altına eklenecek eylem (ör. "Sunucu seçimine dön"). */
  children?: React.ReactNode;
};

const LegacySorunlar: React.FC<Props> = ({
  sorunlar,
  sunucuBasligi,
  manualHosts = [],
  testId,
  children,
}) => {
  const elle = new Set(manualHosts.map((x) => x.toUpperCase()));
  const sunucular = sorunlar.sunucular.slice(0, SATIR_SINIRI);
  const dosyalar = sorunlar.dosyalar.slice(0, SATIR_SINIRI);
  const fazlaSunucu = sorunlar.sunucular.length - sunucular.length;
  const fazlaDosya = sorunlar.dosyalar.length - dosyalar.length;

  return (
    <div className="text-xs space-y-2 text-left" data-testid={testId}>
      {sorunlar.genel && (
        <p className="text-[var(--text-secondary)]">
          <Sebep ham={sorunlar.genel} />
        </p>
      )}

      {sunucular.length > 0 && (
        <div className="space-y-1">
          <p className="text-[var(--text-muted)]">{sunucuBasligi}:</p>
          <ul className="space-y-1">
            {sunucular.map((h) => (
              <li key={h.host} className="text-[var(--text-secondary)]">
                <span className="font-mono font-semibold">{h.host}</span>{' '}
                <span className="text-[var(--text-muted)]">({DURUM_ETIKETI[h.durum]})</span>
                {elle.has(h.host.toUpperCase()) && (
                  <span className="ml-1 text-amber-700">(envanterde yok — adı doğru mu?)</span>
                )}
                {h.dosyaSayisi > 0 && (
                  <span className="ml-1 text-[var(--text-muted)]">
                    · {h.dosyaSayisi} dosya alınamadı
                  </span>
                )}
                {': '}
                <Sebep ham={h.sebep} />
              </li>
            ))}
          </ul>
          {fazlaSunucu > 0 && (
            <p className="text-[var(--text-muted)]">… ve {fazlaSunucu} sunucu daha</p>
          )}
        </div>
      )}

      {dosyalar.length > 0 && (
        <div className="space-y-1">
          <p className="text-[var(--text-muted)]">Arşive girmeyen dosyalar:</p>
          <ul className="space-y-1">
            {dosyalar.map((f) => (
              <li key={`${f.host}::${f.path}`} className="text-[var(--text-secondary)]">
                {f.host && <span className="font-mono font-semibold">{f.host} · </span>}
                <span className="font-mono break-all">{f.path}</span>
                {': '}
                <Sebep ham={f.sebep} />
              </li>
            ))}
          </ul>
          {fazlaDosya > 0 && (
            <p className="text-[var(--text-muted)]">… ve {fazlaDosya} dosya daha</p>
          )}
        </div>
      )}

      {children}
    </div>
  );
};

export default LegacySorunlar;
