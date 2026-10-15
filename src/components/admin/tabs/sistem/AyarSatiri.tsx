// src/components/admin/tabs/sistem/AyarSatiri.tsx — tek ayarin satiri: okuma ve duzenleme.
//
// HY4 (src/components/__tests__/HataYokDegil.test.tsx) KILITLER:
//   * Deger metin olarak kendi ogesinde durur ('3000' tek basina bir span'da).
//   * Hata aninda her satir AYRI bir ogede tam olarak "okunamadı" yazar; "yükleniyor…" yazmaz.
//   * Ayrintilar KOSULLU cizilir (Collapse ile hep monte EDILMEZ): aksi halde PORT'un ornegi
//     '3000' DOM'a ikinci kez girer ve `findByText('3000')` iki oge bulup patlar.
//
// GIZLI DEGER: sunucunun maskeli onizlemesi duz span'da; title YOK, kopyalama YOK, truncate YOK.
//
// TANIMSIZ DEGER "varsayilan kullanilir" DEMEZ (SA15): zorunlu anahtarlarin (MSSQL_*, LDAP_URL)
// ve fail-closed anahtarlarin (OPSX flow key, Teams webhook) kod varsayilani yok; tanimsizsa
// ilgili islev kapanir. Varsayilan varsa aciklama metni soyler.
//
// KIRILIMLAR gercek kabuga gore (SD5): 1366x900'de sekme kabi ~640px. Uc sutun @xl (36rem),
// dokunma boyutlari @md (28rem) altinda.
import React, { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { LockClosedIcon, PencilIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { CodeChip } from '@/components/common/CodeChip';
import { SkeletonBar } from '@/components/common/Skeleton';
import type { EnvVarMeta } from './ortamDegiskenleri';
import type { Grup } from './gruplar';
import { uygulanma, type ConfigValue } from './ayarKurallari';
import type { YuklemeDurumu } from './useSistemAyarlari';
import AyarDuzenleyici from './AyarDuzenleyici';
import Rozet from './Rozet';

interface Props {
  meta: EnvVarMeta;
  grup: Grup;
  cv?: ConfigValue;
  durum: YuklemeDurumu;
  /** Duzenleyici aciksa taslak degeri (yoksa undefined). */
  taslak?: string;
  kirli: boolean;
  bayatDeger?: string;
  kaydediliyor: boolean;
  hata?: string;
  yeniKaydedildi: boolean;
  restartBekliyor: boolean;
  odakla: boolean;
  duzenleRef: (el: HTMLButtonElement | null) => void;
  onDuzenle: () => void;
  onTaslak: (v: string) => void;
  onIptal: () => void;
  onGonder: (v: string) => void;
  onSil: () => void;
}

function AyarDegeri({ meta, cv, durum }: { meta: EnvVarMeta; cv?: ConfigValue; durum: YuklemeDurumu }) {
  const soluk = 'text-xs text-[var(--text-muted)]';
  if (meta.saltOkunur === 'ortam') return <span className={soluk}>Bu ekranda gösterilmez</span>;
  if (!cv) {
    if (durum === 'yukleniyor') return <SkeletonBar className="h-4 w-32" />;
    if (durum === 'hata') return <span className={soluk}>okunamadı</span>;
    return <span className={soluk}>sunucu bu anahtarı bildirmedi</span>;
  }
  if (!cv.defined) {
    return (
      <span className={soluk}>
        {cv.source === 'db' ? "Portal'da boş bırakıldı" : 'Tanımsız'}
      </span>
    );
  }
  if (cv.masked) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="font-mono text-xs text-[var(--text-secondary)]">{cv.value}</span>
        <span className="sr-only">Gizli değer tanımlı</span>
      </span>
    );
  }
  return <CodeChip value={cv.value} wrap="break" copyable className="!text-[11px]" />;
}

function Ayrintilar({ meta, grup, cv, durum }: { meta: EnvVarMeta; grup: Grup; cv?: ConfigValue; durum: YuklemeDurumu }) {
  const [acik, setAcik] = useState(false);
  const panelId = useId();
  const u = uygulanma(cv);
  const satir = 'grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5';
  return (
    <div>
      <button
        type="button"
        aria-expanded={acik}
        aria-controls={panelId}
        // 89 satirda ayni "Ayrintilar" adi ekran okuyucunun dugme listesinde ayirt edilemezdi.
        aria-label={`${acik ? 'Ayrıntıları gizle' : 'Ayrıntılar'}: ${meta.label}`}
        onClick={() => setAcik((a) => !a)}
        className="pf-btn-link !p-0 !text-xs inline-flex items-center !gap-1 min-h-11 @md/sistem:min-h-0"
      >
        <ChevronDownIcon
          aria-hidden="true"
          className={`w-3.5 h-3.5 transition-transform motion-reduce:transition-none ${acik ? 'rotate-180' : ''}`}
        />
        {acik ? 'Ayrıntıları gizle' : 'Ayrıntılar'}
      </button>
      {acik && (
        <dl
          id={panelId}
          className="mt-2 space-y-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-xs"
        >
          <div>
            <dt className="sr-only">Açıklama</dt>
            <dd className="whitespace-pre-line leading-relaxed text-[var(--text-secondary)]">{meta.description}</dd>
          </div>
          {meta.example && (
            <div className={satir}>
              <dt className="text-[var(--text-muted)]">Örnek</dt>
              <dd className="min-w-0">
                {cv?.masked || meta.saltOkunur ? (
                  <span className="font-mono break-all">{meta.example}</span>
                ) : (
                  <CodeChip value={meta.example} wrap="break" copyable />
                )}
              </dd>
            </div>
          )}
          <div className={satir}>
            <dt className="text-[var(--text-muted)]">Kullanıldığı yer</dt>
            <dd className="min-w-0">
              <CodeChip value={meta.usedIn} wrap="break" />
            </dd>
          </div>
          {meta.saltOkunur !== 'ortam' && (
            <div className={satir}>
              <dt className="text-[var(--text-muted)]">Uygulanma</dt>
              <dd className="text-[var(--text-secondary)]">
                {u === 'canli'
                  ? 'Kaydedince hemen geçerli olur.'
                  : u === 'restart'
                    ? 'Sunucu yeniden başlatılınca geçerli olur.'
                    : durum === 'tamam'
                      ? 'Bilinmiyor — sunucu bildirmedi.'
                      : 'Bilinmiyor — değerler okunamadı.'}
              </dd>
            </div>
          )}
          {cv?.defined && (
            <div className={satir}>
              <dt className="text-[var(--text-muted)]">Kaynak</dt>
              <dd className="text-[var(--text-secondary)]">
                {cv.source === 'db' ? 'Portal veritabanı (bu ekrandan kaydedilmiş)' : 'Sunucu ortam dosyası'}
              </dd>
            </div>
          )}
          {grup.asilYeri && (
            <div className={satir}>
              <dt className="text-[var(--text-muted)]">Asıl yeri</dt>
              <dd>
                <Link to={grup.asilYeri} className="pf-btn-link !p-0 !text-xs">
                  {grup.asilYeriEtiketi} →
                </Link>
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

export default function AyarSatiri({
  meta,
  grup,
  cv,
  durum,
  taslak,
  kirli,
  bayatDeger,
  kaydediliyor,
  hata,
  yeniKaydedildi,
  restartBekliyor,
  odakla,
  duzenleRef,
  onDuzenle,
  onTaslak,
  onIptal,
  onGonder,
  onSil,
}: Props) {
  const duzenleyiciId = useId();
  const duzenleniyor = taslak !== undefined && !!cv;
  const serit = hata ? 'var(--status-danger)' : kirli ? 'var(--accent)' : null;
  const zorunluBos = meta.required && !!cv && !cv.defined;

  return (
    <li
      id={`ayar-${meta.key}`}
      className={`scroll-mt-40 px-4 py-3 transition-colors duration-700 motion-reduce:transition-none ${
        yeniKaydedildi ? 'bg-[var(--status-success-bg)]' : ''
      } @xl/sistem:grid @xl/sistem:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_auto] @xl/sistem:gap-x-4 @xl/sistem:items-start`}
      style={serit ? { boxShadow: `inset 3px 0 0 ${serit}` } : undefined}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] font-medium text-[var(--text-primary)]">{meta.label}</span>
          {zorunluBos ? (
            <Rozet ton="red">Zorunlu · boş</Rozet>
          ) : (
            meta.required && <Rozet ton="grey">Zorunlu</Rozet>
          )}
          {cv?.masked && (
            <Rozet ton="grey" ikon={<LockClosedIcon aria-hidden="true" className="w-3 h-3" />}>
              Gizli
            </Rozet>
          )}
          {cv?.source === 'db' && <Rozet ton="blue">Portal&apos;da ayarlı</Rozet>}
          {meta.saltOkunur === 'ortam' && <Rozet ton="grey">Yalnız sunucu ortamı</Rozet>}
          {meta.saltOkunur === 'opsx' && <Rozet ton="grey">OpsX&apos;te yönetilir</Rozet>}
          {kirli && <Rozet ton="gold">Kaydedilmedi</Rozet>}
          {bayatDeger !== undefined && <Rozet ton="gold">Değer değişti</Rozet>}
          {restartBekliyor && <Rozet ton="gold">Restart bekliyor</Rozet>}
          {yeniKaydedildi && <Rozet ton="green">Kaydedildi</Rozet>}
        </div>
        <p className="mt-0.5 font-mono text-[11px] text-[var(--text-muted)] break-all">{meta.key}</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)] line-clamp-2">{meta.description}</p>
      </div>

      <div className="min-w-0 mt-2 @xl/sistem:mt-0 @xl/sistem:pt-0.5">
        {duzenleniyor && cv ? (
          <AyarDuzenleyici
            id={duzenleyiciId}
            meta={meta}
            cv={cv}
            deger={taslak}
            kirli={kirli}
            kaydediliyor={kaydediliyor}
            hata={hata}
            bayatDeger={bayatDeger}
            odakla={odakla}
            onChange={onTaslak}
            onGonder={() => onGonder(taslak)}
            onIptal={onIptal}
            onSil={onSil}
          />
        ) : (
          <AyarDegeri meta={meta} cv={cv} durum={durum} />
        )}
        {meta.saltOkunur === 'opsx' && (
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            Değiştirmek için{' '}
            <Link to="/opsx" className="pf-btn-link !p-0 !text-[11px]">
              OpsX › Smart Onayı
            </Link>{' '}
            penceresini kullanın.
          </p>
        )}
        <div className="mt-1">
          <Ayrintilar meta={meta} grup={grup} cv={cv} durum={durum} />
        </div>
      </div>

      <div className="mt-2 @xl/sistem:mt-0">
        {!meta.saltOkunur && !duzenleniyor && (
          // Ortak Button ref iletmiyor; odak geri donusu icin yerel dugme (ayni pf-btn-link dili).
          <button
            ref={duzenleRef}
            type="button"
            onClick={onDuzenle}
            disabled={durum !== 'tamam' || !cv}
            aria-label={`${meta.label} (${meta.key}) ayarını düzenle`}
            className="pf-btn-link disabled:opacity-50 !text-[0.875rem] !px-3 !py-1 inline-flex items-center !justify-center !gap-1.5 w-full min-h-11 !rounded-md @max-xl/sistem:!border-[var(--border-subtle)] @md/sistem:w-auto @md/sistem:min-h-0"
          >
            <PencilIcon aria-hidden="true" className="w-3.5 h-3.5" />
            Düzenle
          </button>
        )}
      </div>
    </li>
  );
}
