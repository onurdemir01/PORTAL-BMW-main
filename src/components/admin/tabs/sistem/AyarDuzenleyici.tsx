// src/components/admin/tabs/sistem/AyarDuzenleyici.tsx — tek ayarin satir ici duzenleyicisi.
//
// `ui/Form` Field KULLANILMAZ: ipucu ve hata icin id vermiyor, `aria-describedby` baglanamaz.
// Etiket, ipucu ve hata burada elle baglanir.
//
// GIZLI DEGER: `type="password"` + `autoComplete="new-password"`, kutu BOS baslar ve bos
// birakmak "degisiklik yok" demektir (Kaydet kapali). Silmek yalniz "Degeri sil…" yolundan ve
// onay penceresinden gecer. Eski ekranda bos + Enter sirri onaysiz siliyordu.
// Gizli kutu KONTROLSUZDUR: kontrollu input'ta (ve degisen defaultValue'da) React yazilan degeri
// `value` OZNITELIGINE de esitler; sir outerHTML'de ve MutationObserver'da okunurdu (SA1).
// Oznitelik hep bos; satir yeniden monte olursa (arama suzdu) taslak yalniz OZELLIGE yazilir.
//
// KAYIT SURERKEN Iptal ve Esc kapali (SA14): kapansaydi sunucu hatasi hicbir yerde
// gorunmezdi. Hata gelince odak kutuya doner (Kaydet yuklenirken kapanir, odak duserdi).
//
// "Bos" secenegi "varsayilana donmek" DEGILDIR: Portal veritabanina bos deger yazilir, ortam
// dosyasindaki deger yeniden baslatmadan sonra da gecersiz kalir; kodun kendi varsayilani
// (varsa) kullanilir. Etiket ve ipucu bunu soyler; onay penceresi ayni ayrimi yapar.
//
// "PORTAL'A SABITLE" (KARAR, bulgu 4; ayarKurallari.sabitlenebilir): degeri ortam dosyasindan
// gelen gizli olmayan anahtarda deger degismemisken de dugme etkin, adi "Portal'a sabitle",
// altinda ipucu. Sabitleme YALNIZ dugmeyle: dugme o durumda type="button", Enter (form
// gonderimi) yalniz degisiklik varken kaydeder — degismemis kutuda Enter'a basmak degeri
// sessizce sabitlemez. Kritik anahtarda onay penceresi aynen acilir (onayGerekce 'kritik').
import React, { useEffect, useRef } from 'react';
import { TrashIcon } from '@heroicons/react/24/outline';
import Button from '@/components/common/Button';
import { TextInput } from '@/components/ui/Form';
import type { EnvVarMeta } from './ortamDegiskenleri';
import { SABITLEME_IPUCU, kontrolTuru, sabitlenebilir, type ConfigValue } from './ayarKurallari';

interface Props {
  id: string;
  meta: EnvVarMeta;
  cv: ConfigValue;
  deger: string;
  kirli: boolean;
  kaydediliyor: boolean;
  hata?: string;
  bayatDeger?: string;
  /** Kullanici acti: odak kutuya gider. Depodan geri yuklenen taslak odak calmaz. */
  odakla: boolean;
  onChange: (v: string) => void;
  onGonder: () => void;
  onIptal: () => void;
  onSil?: () => void;
}

const IPUCU = {
  gizli:
    'Mevcut değer gösterilmez. Boş bırakırsanız değer değişmez. Bu sekmeden çıkarsanız gizli değer taslağı tutulmaz.',
  secim:
    '“Boş” Portal veritabanına boş değer yazar: ortam dosyasındaki değer geçersiz kalır, kodun kendi varsayılanı (varsa) kullanılır.',
  sayi: 'Yalnız sayı. Geçerli aralık açıklamada yazar; sunucu kaydetmeden önce denetler.',
  metin: 'Tek satır. Enter kaydeder, Esc düzenlemeyi kapatır.',
} as const;

export default function AyarDuzenleyici({
  id,
  meta,
  cv,
  deger,
  kirli,
  kaydediliyor,
  hata,
  bayatDeger,
  odakla,
  onChange,
  onGonder,
  onIptal,
  onSil,
}: Props) {
  const tur = kontrolTuru(meta, cv);
  const ipucuId = `${id}-ipucu`;
  const hataId = `${id}-hata`;
  const sabitIpucuId = `${id}-sabit`;
  const sabitIpucu = sabitlenebilir(cv);
  const sabitle = !kirli && sabitIpucu;
  const aciklayan = hata ? `${ipucuId} ${hataId}` : ipucuId;
  const formRef = useRef<HTMLFormElement>(null);
  const gizliKuruldu = useRef(false);

  // Hata gelince odak kutuya (secimde secili radyoya) doner — yalniz odak dustuyse ya da hala
  // bu formdaysa; kullanici bu arada baska yere gectiyse odak calinmaz (SA24: PUT beklerken
  // arama kutusuna gecen odak 400'den sonra orada kalir).
  useEffect(() => {
    if (!hata || kaydediliyor) return;
    const form = formRef.current;
    if (!form) return;
    const etkin = document.activeElement;
    if (etkin && etkin !== document.body && !form.contains(etkin)) return;
    const hedef =
      form.querySelector<HTMLInputElement>('input[type="radio"]:checked') ?? form.querySelector<HTMLInputElement>('input');
    hedef?.focus();
  }, [hata, kaydediliyor]);

  const kontrol = (() => {
    if (tur === 'secim') {
      const secenekler = ['', ...(meta.secenekler ?? [])];
      return (
        <fieldset aria-describedby={aciklayan} aria-invalid={hata ? true : undefined}>
          <legend className="sr-only">{meta.label}</legend>
          <div className="flex flex-wrap gap-1">
            {secenekler.map((s) => {
              const aktif = deger === s;
              return (
                <label
                  key={s || '__bos'}
                  className={`pf-segment ${aktif ? 'is-active' : ''} relative !px-3 !py-1.5 !text-[13px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-[var(--accent)]`}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    name={id}
                    value={s}
                    checked={aktif}
                    onChange={() => onChange(s)}
                    autoFocus={odakla && aktif}
                  />
                  {s ? <span className="font-mono">{s}</span> : 'Boş (kod varsayılanı)'}
                </label>
              );
            })}
          </div>
        </fieldset>
      );
    }
    return (
      <TextInput
        id={id}
        sizeVariant="sm"
        className="font-mono"
        type={tur === 'gizli' ? 'password' : 'text'}
        autoComplete={tur === 'gizli' ? 'new-password' : 'off'}
        spellCheck={false}
        inputMode={tur === 'sayi' ? 'numeric' : undefined}
        {...(tur === 'gizli'
          ? {
              defaultValue: '',
              ref: (el: HTMLInputElement | null) => {
                if (!el || gizliKuruldu.current) return;
                gizliKuruldu.current = true;
                if (deger) el.value = deger;
              },
            }
          : { value: deger })}
        // Sunucu satir sonu iceren degeri reddeder ("Deger tek satir olmali"); yapistirilan
        // metindeki satir sonlari burada atilir.
        onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, ''))}
        error={!!hata}
        aria-describedby={aciklayan}
        autoFocus={odakla}
        placeholder={tur === 'gizli' ? 'Yeni gizli değer' : undefined}
      />
    );
  })();

  return (
    <form
      ref={formRef}
      noValidate
      className="mt-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (kirli) onGonder();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (!kaydediliyor) onIptal();
        }
      }}
    >
      {bayatDeger !== undefined && (
        <p className="text-xs text-[var(--status-warning-text)]">
          Siz düzenlerken sunucudaki değer değişti (şimdi: <span className="font-mono break-all">{bayatDeger || 'boş'}</span>).
          Kaydederseniz sizin değeriniz yazılır.
        </p>
      )}
      {tur === 'secim' ? (
        <p className="text-xs font-medium text-[var(--text-primary)]">Yeni değer</p>
      ) : (
        <label htmlFor={id} className="block text-xs font-medium text-[var(--text-primary)]">
          Yeni değer
        </label>
      )}
      {kontrol}
      <p id={ipucuId} className="text-[11px] leading-snug text-[var(--text-muted)]">
        {IPUCU[tur]}
      </p>
      {hata && (
        <p id={hataId} role="alert" className="text-xs text-[var(--status-danger-text)] break-words">
          {hata}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          type={sabitle ? 'button' : 'submit'}
          onClick={sabitle ? onGonder : undefined}
          variant="primary"
          size="sm"
          loading={kaydediliyor}
          disabled={(!kirli && !sabitle) || kaydediliyor}
          aria-describedby={sabitIpucu ? sabitIpucuId : undefined}
          className="flex-1 min-h-11 @md/sistem:flex-none @md/sistem:min-h-0"
        >
          {sabitle ? "Portal'a sabitle" : 'Kaydet'}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onIptal}
          disabled={kaydediliyor}
          className="flex-1 min-h-11 @md/sistem:flex-none @md/sistem:min-h-0"
        >
          İptal
        </Button>
      </div>
      {sabitIpucu && (
        <p id={sabitIpucuId} className="text-[11px] leading-snug text-[var(--text-muted)]">
          {SABITLEME_IPUCU}
        </p>
      )}
      {onSil && tur === 'gizli' && cv.defined && (
        <div className="pt-2 border-t border-[var(--border-subtle)]">
          <Button
            type="button"
            variant="danger"
            size="sm"
            icon={<TrashIcon aria-hidden="true" className="w-3.5 h-3.5" />}
            onClick={onSil}
            disabled={kaydediliyor}
            className="w-full min-h-11 @md/sistem:w-auto @md/sistem:min-h-0"
          >
            Değeri sil…
          </Button>
        </div>
      )}
    </form>
  );
}
