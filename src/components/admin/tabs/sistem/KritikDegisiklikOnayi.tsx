// src/components/admin/tabs/sistem/KritikDegisiklikOnayi.tsx — riskli ayar degisikligi onayi.
//
// Tek ortak pencere: kritik anahtar (veritabani, dizin, giris guvenligi), dolu bir degeri
// bosaltma, gizli degeri silme ve guvenlik korumasini kapatan deger. Eski ekranda hepsi tek
// tikla gidiyordu. Arka plana tiklamak pencereyi KAPATMAZ (dismissOnBackdrop={false}).
//
// GIZLI DEGER bu pencerede de ASLA gosterilmez: "Tanimli (gizli)" / "Yeni gizli deger" /
// "Silinecek" yazar.
//
// KAYIT SURERKEN KAPANMAZ (SA20): Iptal kapali, Esc ve X etkisiz. Kapansaydi kullanici iptal
// ettigini sanarken kayit arka planda tamamlanirdi (olculdu: CSRF 'off' yazildi).
// X ortak Modal'da (common/* DEGISMEZ) devre disi birakilamiyor: etkin gorunup hicbir sey
// yapmiyordu. Govdedeki "Kaydediliyor…" satiri (role=status; pencere acikken hep DOM'da,
// ekran okuyucu degisikligi duyursun) kaydi gorunur kilar; X ya da Esc denenince satir kalir
// ve pencerenin kayit bitmeden kapanmayacagini ekler (SA25).
import React, { useState } from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { Modal } from '@/components/common/Modal';
import Button from '@/components/common/Button';
import type { EnvVarMeta } from './ortamDegiskenleri';
import {
  SABITLEME_IPUCU,
  sabitlenebilir,
  tehlikeliDeger,
  type ConfigValue,
  type Gerekce,
  type TehlikeliDeger,
} from './ayarKurallari';

export interface OnayIstegi {
  meta: EnvVarMeta;
  cv: ConfigValue;
  yeni: string;
  gerekceler: Gerekce[];
  tehlikeli: boolean;
}

const BOSALTMA_METNI =
  'Boş kaydetmek ortam dosyasındaki değere dönmek değildir: Portal veritabanına boş değer yazılır; sunucu ortam dosyasındaki değeri yeniden başlatmadan sonra da kullanmaz, kodun kendi varsayılanı (varsa) geçerli olur. Geri almak için değeri yeniden girmeniz gerekir.';

const TEHLIKE_METNI: Record<TehlikeliDeger, string> = {
  csrfOff: 'Kaynak (CSRF) denetimi kapanır; başka sitelerden gelen istekler engellenmez.',
  csrfLog: 'Kaynak denetimi yalnız kayıt tutar, isteği engellemez.',
  frameYildiz: 'Portal her sitede çerçeve içinde açılabilir (tıklama korsanlığı riski).',
  frameSonek:
    'Joker alan adı bir kamu sonekini kapsıyor (ör. *.com.tr): Portal o uzantıdaki her sitede çerçeve içinde açılabilir (tıklama korsanlığı riski).',
};

function gosterim(cv: ConfigValue, deger: string, yeniMi: boolean): React.ReactNode {
  if (cv.masked) {
    if (!yeniMi) return cv.defined ? 'Tanımlı (gizli)' : 'Tanımsız';
    return deger === '' ? 'Silinecek' : 'Yeni gizli değer';
  }
  if (deger.trim() === '') return <span className="italic text-[var(--text-muted)]">boş</span>;
  return <span className="font-mono break-all">{deger}</span>;
}

export default function KritikDegisiklikOnayi({
  istek,
  kaydediliyor,
  onIptal,
  onOnayla,
}: {
  istek: OnayIstegi | null;
  kaydediliyor: boolean;
  onIptal: () => void;
  onOnayla: () => void;
}) {
  const g = istek?.gerekceler ?? [];
  const tehlike = istek ? tehlikeliDeger(istek.meta.key, istek.yeni) : null;
  const canli = istek?.cv.hotReloadable === true;
  const sabitleme = !!istek && istek.yeni === istek.cv.value && sabitlenebilir(istek.cv);
  // Kayit surerken X / Esc denendi mi: istek nesnesine bagli, yeni pencerede kendiliginden sifir.
  const [kapatmaDenenen, setKapatmaDenenen] = useState<OnayIstegi | null>(null);
  const kapatmaDenendi = kaydediliyor && !!istek && kapatmaDenenen === istek;
  const kapat = () => {
    if (kaydediliyor) setKapatmaDenenen(istek);
    else onIptal();
  };
  return (
    <Modal
      open={!!istek}
      onClose={kapat}
      title="Değişikliği onaylayın"
      subtitle={istek ? `${istek.meta.label} (${istek.meta.key})` : undefined}
      icon={ExclamationTriangleIcon}
      size="md"
      dismissOnBackdrop={false}
      footer={
        <>
          <Button
            type="button"
            variant={istek?.tehlikeli ? 'danger' : 'primary'}
            loading={kaydediliyor}
            onClick={onOnayla}
          >
            {istek?.tehlikeli ? 'Yine de kaydet' : 'Kaydet'}
          </Button>
          <Button type="button" onClick={kapat} disabled={kaydediliyor}>
            İptal
          </Button>
        </>
      }
    >
      {istek && (
        <div className="space-y-3">
          <table className="w-full text-left text-[13px] border border-[var(--border-subtle)]">
            <thead className="bg-[var(--bg-elevated)] text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-medium">Şimdiki</th>
                <th scope="col" className="px-3 py-1.5 font-medium">Yeni</th>
              </tr>
            </thead>
            <tbody>
              <tr className="align-top">
                <td className="px-3 py-2">{gosterim(istek.cv, istek.cv.value, false)}</td>
                <td className="px-3 py-2 font-medium">{gosterim(istek.cv, istek.yeni, true)}</td>
              </tr>
            </tbody>
          </table>
          <ul className="space-y-2 text-[13px] leading-relaxed">
            {g.includes('kritik') && (
              <li>
                Bu ayar Portal&apos;ın veritabanı, dizin ya da giriş güvenliği bağlantısını belirler.
                Yanlış değer girişleri engelleyebilir ya da Portal&apos;ın açılmasını durdurabilir.{' '}
                {canli ? 'Kaydettiğiniz anda geçerli olur.' : 'Sunucu yeniden başlatılınca geçerli olur.'}
              </li>
            )}
            {sabitleme && <li>{SABITLEME_IPUCU}</li>}
            {(g.includes('bosaltma') || g.includes('gizliSilme')) && <li>{BOSALTMA_METNI}</li>}
            {tehlike && (
              <li className="font-medium text-[var(--status-danger-text)]">{TEHLIKE_METNI[tehlike]}</li>
            )}
          </ul>
          <p
            role="status"
            className={
              kaydediliyor
                ? `text-[13px] font-medium ${kapatmaDenendi ? 'text-[var(--status-warning-text)]' : 'text-[var(--text-secondary)]'}`
                : 'sr-only'
            }
          >
            {kaydediliyor && 'Kaydediliyor…'}
            {kapatmaDenendi && ' Kayıt bitmeden pencere kapanmaz.'}
          </p>
        </div>
      )}
    </Modal>
  );
}
