// src/components/denetim/EkipKaynak.tsx — ekip (sorumlu grup) adlarını KAYNAĞIYLA gösterir.
//
// 2026-11-02 (kullanıcı): namespace sahibini uygulamanın sahibi gibi yazmak geri dönüş almada sorun
// çıkarıyor; sahip UYGULAMA başına bulunur (dbo.Openshift_App_Owners), bulunamazsa namespace sahibi
// gösterilir ve bu AYRICA işaretlenir: "(namespace sahibi)".
// Kaynak dizisi grup dizisiyle AYNI SIRADADIR; boş dizi / boş öğe = kaynak bilinmiyor (uygulama
// tablosu henüz yok) — o durumda ekran eskisi gibi yalnız grup adını yazar.
import React from 'react';

const ETIKET: Record<string, string> = {
  SI51_AGILE: 'CMDB Code Repository kaydı — Agile Takım',
  SI51_YAZILIM: 'CMDB Code Repository kaydı — Yazılım Geliştirme Sorumlusu',
  ARK997_AGILE: 'CMDB ARK Application kaydı — Agile Takım',
  ARK997_YAZILIM: 'CMDB ARK Application kaydı — Yazılım Geliştirme Sorumlusu',
  NAMESPACE:
    'Namespace sahibi — uygulama düzeyinde sahip bulunamadı ya da aranmadı (CMDB’de yalnız ARK cluster’larında aranır)',
};

/** Kaynak kodunun okunur açıklaması ('' = bilinmiyor). */
export function kaynakEtiketi(kaynak?: string | null): string {
  const k = String(kaynak || '').trim().toUpperCase();
  if (!k) return '';
  return ETIKET[k] || `kaynak: ${k}`;
}

/** Grup namespace yedeğinden mi geldi? */
export const nsSahibiMi = (kaynak?: string | null) => String(kaynak || '').trim().toUpperCase() === 'NAMESPACE';

/** "(namespace sahibi)" işareti — grup adının hemen yanında, ipucunda açıklama. */
export function NsSahibiIsareti() {
  return (
    <span
      className="text-[10px] italic whitespace-nowrap"
      style={{ color: 'var(--text-muted)' }}
      title={ETIKET.NAMESPACE}
      data-ns-sahibi="1"
    >
      (namespace sahibi)
    </span>
  );
}

/** Namespace sahiplik tablosu okunamadığında "veri yok" ipucu (bilinmiyor ≠ veri yok). */
export const VERI_YOK_IPUCU =
  'Namespace sahiplik tablosu (dbo.Openshift_Namespace_Owners) okunamadı ve uygulamanın kendi sahibi yok — sahip bilinmiyor değil, veri yok';

/** Grup listesi, her grubun yanında gerekiyorsa namespace işareti; boşsa `bos` metni
 *  (`veriYok` ise "veri yok" — namespace tablosu okunamadı). */
export function EkipListesi({
  groups,
  kaynaklar,
  bos = 'bilinmiyor',
  veriYok = false,
}: {
  groups: string[];
  kaynaklar?: string[];
  bos?: React.ReactNode;
  veriYok?: boolean;
}) {
  if (!groups.length && veriYok)
    return (
      <span style={{ color: 'var(--text-muted)' }} title={VERI_YOK_IPUCU} data-veri-yok="1">
        veri yok
      </span>
    );
  if (!groups.length) return <span style={{ color: 'var(--text-muted)' }}>{bos}</span>;
  return (
    <span>
      {groups.map((g, i) => {
        const k = kaynaklar?.[i];
        const et = kaynakEtiketi(k);
        return (
          <React.Fragment key={g}>
            {i > 0 && ', '}
            <span title={et ? `${g}\n${et}` : g}>{g}</span>
            {nsSahibiMi(k) && (
              <>
                {' '}
                <NsSahibiIsareti />
              </>
            )}
          </React.Fragment>
        );
      })}
    </span>
  );
}
