// src/components/nginx_console/RvpSecimTab.tsx — Nginx Hub "RP Seçimi" (kullanici, 2026-10-05).
//
// Kullanici: "Ekibimden arkadaslar olsun veya yeni bir tanim yaptirmak isteyen developerlar olsun,
// hangi sunucuya deployment yapacagini bilmiyor, hangi sunucuda Nginx konfigurasyonlarinin
// yapilacagini bilmiyor."
//
// Sihirbaz SALT OKUNURDUR: hicbir is baslatmaz, hicbir sunucuya dokunmaz, hicbir tanim yapmaz.
// Yalniz "hangi reverse proxy sunucusuna gitmelisin" sorusunu cevaplar. Karar tablosu ve sunucu
// ustverisi rvpSecim.ts'te (saf, bekcisi var); burasi YALNIZ ekran.
import React, { useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  ClipboardDocumentIcon,
  ExclamationTriangleIcon,
  QuestionMarkCircleIcon,
} from '@heroicons/react/24/outline';
import { Link } from 'react-router-dom';
import { toast } from '@/hooks/useToast';
import { Pill } from '@/components/denetim/ui';
import {
  rvpOner,
  rvpSiradakiSoru,
  GT_EKIP,
  type RvpBackend,
  type RvpBlok,
  type RvpGlomo,
  type RvpKitle,
  type RvpNprAcik,
  type RvpSecim,
  type RvpSunucu,
} from './rvpSecim';

type SoruSecenek = { deger: string; etiket: string; alt: string };
type Soru = { anahtar: 'backend' | 'kitle' | 'glomo' | 'nprAcik'; baslik: string; secenekler: SoruSecenek[] };

/** Sorular ve metinleri TEK YERDE: sihirbaz adimlari bunu okur, bekci de bunu sayar. */
export const RVP_SORULAR: readonly Soru[] = [
  {
    anahtar: 'backend',
    baslik: 'Backend uygulamanız nerede koşuyor?',
    secenekler: [
      { deger: 'ark', etiket: 'ARK', alt: 'OpenShift ARK cluster’ı' },
      { deger: 'hosting', etiket: 'Hosting', alt: 'Hosting ortamı' },
      { deger: 'hicbiri', etiket: 'Hiçbiri', alt: 'İkisi de değil / bilmiyorum' },
    ],
  },
  {
    anahtar: 'kitle',
    baslik: 'Uygulamanız kime hizmet edecek?',
    secenekler: [
      {
        deger: 'internet',
        etiket: 'İnternete açılacak',
        alt: 'Müşteri ortamı / dijital kanallar — mobil şube, internet şube, bonus flash, e-trader gibi',
      },
      {
        deger: 'intranet',
        etiket: 'Intranet servisi',
        alt: 'Kurum içi — Step, Connect, Corpus gibi',
      },
    ],
  },
  {
    anahtar: 'glomo',
    baslik: 'Uygulama Glomo mu?',
    secenekler: [
      { deger: 'glomo', etiket: 'Glomo', alt: 'Tanım RVP kaydıyla açılır' },
      { deger: 'nonglomo', etiket: 'Non-Glomo', alt: 'Sunucu seçimiyle devam' },
    ],
  },
  {
    anahtar: 'nprAcik',
    baslik: 'Non-production ortamı da internete açılacak mı?',
    secenekler: [
      { deger: 'evet', etiket: 'Evet, açılacak', alt: 'Non-prod da dış dünyadan erişilecek' },
      { deger: 'hayir', etiket: 'Hayır, açılmayacak', alt: 'Non-prod yalnız kurum içinden erişilecek' },
    ],
  },
] as const;

const ORTAM_BASLIK: Record<'nonProd' | 'prod', string> = {
  nonProd: 'Non-Production',
  prod: 'Production',
};

function SunucuSatiri({ s }: { s: RvpSunucu }) {
  return (
    <tr className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
      <td className="px-2.5 py-1.5 font-medium whitespace-nowrap">{s.host}</td>
      <td className="px-2.5 py-1.5 whitespace-nowrap">
        <Pill tone="neutral">{s.lokasyon}</Pill>
      </td>
      <td className="px-2.5 py-1.5 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
        {s.domain}
      </td>
      <td className="px-2.5 py-1.5 whitespace-nowrap tabular-nums" style={{ color: 'var(--text-muted)' }}>
        {s.subnet}
      </td>
      <td className="px-2.5 py-1.5 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
        {s.surum || '—'}
      </td>
      <td className="px-2.5 py-1.5" style={{ color: 'var(--text-muted)' }}>
        {s.amac || '—'}
      </td>
    </tr>
  );
}

/** Ortam blogu. `tanimsiz` BOS TABLO olarak basilmaz: sebebi yazili ayri bir kutu olur. */
function OrtamBlogu({ tur, blok }: { tur: 'nonProd' | 'prod'; blok: RvpBlok }) {
  const kopyala = async () => {
    try {
      await navigator.clipboard.writeText(blok.sunucular.map((s) => s.host).join('\n'));
      toast.success(`${blok.sunucular.length} sunucu adı kopyalandı`);
    } catch {
      toast.error('Kopyalanamadı — sunucu adlarını tablodan alabilirsiniz');
    }
  };
  if (blok.durum === 'tanimsiz')
    return (
      <div
        className="rounded-xl border p-3"
        style={{ borderColor: 'var(--status-warning)', background: 'var(--bg-surface)' }}
      >
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ExclamationTriangleIcon className="w-4 h-4" style={{ color: 'var(--status-warning)' }} />
          {ORTAM_BASLIK[tur]} — tanımlı değil
        </div>
        {blok.not && (
          <p className="mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {blok.not}
          </p>
        )}
      </div>
    );
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="text-sm font-semibold">
          {ORTAM_BASLIK[tur]}{' '}
          <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
            · {blok.sunucular.length} sunucu
          </span>
        </div>
        <button
          onClick={kopyala}
          className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium rounded-lg border"
          style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
        >
          <ClipboardDocumentIcon className="w-3.5 h-3.5" /> adları kopyala
        </button>
      </div>
      {blok.not && (
        <p className="px-3 pt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {blok.not}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              <th className="px-2.5 py-1.5 text-left font-medium">Sunucu</th>
              <th className="px-2.5 py-1.5 text-left font-medium">Lokasyon</th>
              <th className="px-2.5 py-1.5 text-left font-medium">Domain</th>
              <th className="px-2.5 py-1.5 text-left font-medium">Subnet</th>
              <th className="px-2.5 py-1.5 text-left font-medium">Nginx</th>
              <th className="px-2.5 py-1.5 text-left font-medium">Amaç (envanter)</th>
            </tr>
          </thead>
          <tbody>
            {blok.sunucular.map((s) => (
              <SunucuSatiri key={s.host} s={s} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RvpSecimTab() {
  const [secim, setSecim] = useState<RvpSecim>({});
  const siradaki = useMemo(() => rvpSiradakiSoru(secim), [secim]);
  const oneri = useMemo(() => rvpOner(secim), [secim]);

  const sec = (anahtar: Soru['anahtar'], deger: string) => {
    setSecim((eski) => {
      // Bir soru DEGISTIRILDIGINDE sonraki cevaplar silinir: eski cevapla yeni dalin
      // karismasi "ARK + Glomo" secilip sonra Hosting'e donuldugunde yanlis sunucu gosterirdi.
      const sira: Soru['anahtar'][] = ['backend', 'kitle', 'glomo', 'nprAcik'];
      const i = sira.indexOf(anahtar);
      const yeni: RvpSecim = { ...eski };
      for (const k of sira.slice(i)) delete yeni[k];
      if (anahtar === 'backend') yeni.backend = deger as RvpBackend;
      if (anahtar === 'kitle') yeni.kitle = deger as RvpKitle;
      if (anahtar === 'glomo') yeni.glomo = deger as RvpGlomo;
      if (anahtar === 'nprAcik') yeni.nprAcik = deger as RvpNprAcik;
      return yeni;
    });
  };

  const sorulanlar = RVP_SORULAR.filter((q) => secim[q.anahtar] !== undefined || q.anahtar === siradaki);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <QuestionMarkCircleIcon className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          Uygulamam hangi Nginx sunucusundan reverse proxy hizmeti almalı?
        </h2>
        <p className="mt-1 text-sm max-w-4xl" style={{ color: 'var(--text-muted)' }}>
          Soruları yanıtlayın; hangi reverse proxy sunucularına gideceğinizi non-production ve
          production olarak gösterir. Bu ekran salt okunurdur — hiçbir tanım yapmaz, hiçbir iş
          başlatmaz.
        </p>
      </div>

      {sorulanlar.map((q) => {
        const secili = secim[q.anahtar] as string | undefined;
        return (
          <div key={q.anahtar} className="rounded-xl border p-4" style={{ borderColor: secili ? 'var(--border-subtle)' : 'var(--accent)', background: 'var(--bg-surface)' }}>
            <div className="text-sm font-semibold mb-2.5">{q.baslik}</div>
            <div className="flex flex-wrap gap-2">
              {q.secenekler.map((o) => {
                const aktif = secili === o.deger;
                return (
                  <button
                    key={o.deger}
                    onClick={() => sec(q.anahtar, o.deger)}
                    className="text-left rounded-lg border px-3 py-2 min-w-[200px] max-w-[340px] transition-colors"
                    style={{
                      borderColor: aktif ? 'var(--accent)' : 'var(--border)',
                      background: aktif ? 'var(--bg-elevated)' : 'transparent',
                    }}
                  >
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      {aktif && <CheckCircleIcon className="w-4 h-4" style={{ color: 'var(--accent)' }} />}
                      {o.etiket}
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {o.alt}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {oneri && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-sm font-semibold">{oneri.baslik}</h3>
            <button
              onClick={() => setSecim({})}
              className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium rounded-lg border"
              style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            >
              <ArrowPathIcon className="w-3.5 h-3.5" /> baştan sor
            </button>
          </div>
          <p className="text-xs max-w-4xl" style={{ color: 'var(--text-secondary)' }}>
            {oneri.aciklama}
          </p>

          {oneri.durum === 'ekip' && (
            <div className="rounded-xl border p-4" style={{ borderColor: 'var(--status-warning)', background: 'var(--bg-surface)' }}>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ExclamationTriangleIcon className="w-4 h-4" style={{ color: 'var(--status-warning)' }} />
                {GT_EKIP} ekibiyle iletişime geçin
              </div>
            </div>
          )}

          {oneri.durum === 'rvp' && oneri.rvpYolu && (
            <div className="rounded-xl border p-4" style={{ borderColor: 'var(--accent)', background: 'var(--bg-surface)' }}>
              <div className="text-sm font-semibold">RVP kaydı açın</div>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                Glomo tanımları Self Servis üzerindeki “Nginx - RVP Operations” otomasyonuyla yapılır.
              </p>
              <Link
                to={oneri.rvpYolu}
                className="mt-2.5 inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                Nginx - RVP Operations’a git <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
              </Link>
            </div>
          )}

          {oneri.durum === 'sunucu' && (
            <div className="space-y-3">
              {oneri.nonProd && <OrtamBlogu tur="nonProd" blok={oneri.nonProd} />}
              {oneri.prod && <OrtamBlogu tur="prod" blok={oneri.prod} />}
            </div>
          )}

          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Kaynak: GT Agile BMW Nginx sunucu envanteri (Excel, 2026-10-05). Listede göremediğiniz
            bir aşama ya da sunucu varsa {GT_EKIP} ekibine danışın — bu ekran yalnız onaylı
            reverse proxy sunucularını önerir.
          </p>
        </div>
      )}
    </div>
  );
}

export default RvpSecimTab;
