// src/components/server_hub/EarEnvanterGorunumler.tsx — Uygulama Envanteri listeleri (2026-11-04; tablo arayüzü
// 2026-11-05).
//
// Uygulamalar · WAR'lar · Eşlenikler · Kütüphaneler · Sunucular · Koşular. Hepsi "son durum"u okur: her sunucunun
// veri taşıyan EN SON taraması (bir hafta düşen sunucunun önceki verisi görünür, yaşıyla birlikte).
// Tablolar EarTablo ile: sütun süzgeci (açılır değer listesi + arama + çoklu seçim), sıralama, kolon seçici,
// sayfalama ve kesin sayaç, satır seçimi. Büyük listeler sunucuda süzülür ve sayfalanır; hiçbiri sessizce kesilmez.
// Okunamadı ile kayıt yok ayrıdır (LoadError / TableEmptyRow). Kısmi / ölçülemeyen hiçbir şey yeşil değil.
import React, { useState } from 'react';
import {
  earApi,
  earIndir,
  type EarUygulama,
  type EarWarSatiri,
  type EarEslenik,
  type EarIkiNesil,
  type EarOrtamYok,
  type EarOrtamlarArasi,
  type EarEslenikFarki,
  type EarEslenikTuru,
  type EarFarkSatiri,
  type EarKutuphaneSatiri,
  type EarKullanan,
  type EarHost,
  type EarKosu,
  type EarParti,
  type EarYapiFarki,
} from '@/api/earEnvanterApi';
import { useAsyncEffect } from '@/hooks/useAsyncEffect';
import { fmtNumber, fmtDateTime } from '@/utils/datetime';
import LoadError from '@/components/common/LoadError';
import { LoadingLogo } from '@/components/common/LoadingLogo';
import {
  uygulamaDurumu,
  hostDurumu,
  kosuDurumu,
  kararDurumu,
  partiDurumu,
  veriYasiGun,
  kaynakEtiketi,
  boyutMetni,
  DURUM_TABLOLARI,
  type DurumBilgisi,
} from './earEnvanter';
import {
  Rozet,
  Kirp,
  IndirBag,
  BTN,
  btnStil,
  GIRDI,
  girdiStil,
  TABLO,
  TH,
  TD,
  thStil,
} from './EarEnvanterUi';
import { EarTablo, type EarKolon, type Suzgec, type GetirParam } from './EarTablo';

export type DetayAc = (kosu: number, host: string, uyg: number) => void;
export type TaraAc = (hostlar: string[]) => void;
const say = (n: number | null | undefined) => (n == null ? '—' : fmtNumber(n));
const json = (f: Suzgec[]) => (f.length ? JSON.stringify(f) : undefined);

function Yukleniyor() {
  return (
    <div className="py-10 flex justify-center">
      <LoadingLogo />
    </div>
  );
}

/** Görünümün tek satırlık "ne nedir" açıklaması. */
function NeNedir({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
      {children}
    </p>
  );
}

const yasMetni = (utc: string | null | undefined) => {
  const y = veriYasiGun(utc);
  return y == null ? '—' : y === 0 ? 'bugün' : `${y} gün önce`;
};
const evetHayir = (v: boolean | number | null | undefined) =>
  v === true || v === 1 ? 'evet' : v === false || v === 0 ? 'hayır' : '—';
const secenekleri = (tablo: Record<string, DurumBilgisi>) =>
  Object.entries(tablo).map(([deger, d]) => ({ deger, etiket: d.etiket }));
const JBOSS = [
  { deger: '7', etiket: 'JBoss 7 (/vhosting)' },
  { deger: '8', etiket: 'JBoss 8 (/vhosting8)' },
  { deger: '?', etiket: 'başka kök' },
];
const KUTUPHANE_SONUC = [
  { deger: 'AYNI', etiket: 'aynı' },
  { deger: 'FARKLI', etiket: 'farklı' },
  { deger: 'AYNI_SURUM_FARKLI_DOSYA', etiket: 'aynı sürüm, farklı dosya' },
  { deger: 'KARSILASTIRILAMADI', etiket: 'karşılaştırılamadı' },
];
const YAPI_SONUC = [
  { deger: 'AYNI', etiket: 'aynı' },
  { deger: 'FARKLI', etiket: 'farklı' },
  { deger: 'KARSILASTIRILAMADI', etiket: 'karşılaştırılamadı' },
];
const sonucEtiketi = (l: { deger: string; etiket: string }[], v: string | null | undefined) =>
  (v && l.find((x) => x.deger === v)?.etiket) || '—';
const kararHucresi = (k: string | null | undefined) =>
  k ? (
    <Rozet d={kararDurumu(k)} kucuk />
  ) : (
    <span style={{ color: 'var(--text-muted)' }}>eşleniği yok</span>
  );

/** "Durumlar ne demek?" — bütün durum ve karar etiketleri kısa açıklamalarıyla. */
export function DurumSozlugu() {
  const tablolar: [string, Record<string, DurumBilgisi>][] = [
    ['Uygulama', DURUM_TABLOLARI.UYGULAMA],
    ['Sunucu', DURUM_TABLOLARI.HOST],
    ['Eşlenik kararı', DURUM_TABLOLARI.KARAR],
    ['Koşu', DURUM_TABLOLARI.KOSU],
  ];
  return (
    <details className="text-[11px]">
      <summary className="cursor-pointer select-none" style={{ color: 'var(--text-secondary)' }}>
        Durumlar ne demek?
      </summary>
      <div className="grid gap-2 sm:grid-cols-2 mt-1">
        {tablolar.map(([ad, t]) => (
          <div key={ad}>
            <div className="font-semibold">{ad}</div>
            {Object.entries(t).map(([k, d]) => (
              <div key={k} className="flex items-start gap-1 py-0.5">
                <Rozet d={d} kucuk />
                <span style={{ color: 'var(--text-muted)' }}>{d.aciklama}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}

function SeciliTara({ hostlar, onTara }: { hostlar: string[]; onTara?: TaraAc }) {
  if (!onTara) return null;
  const tekil = [...new Set(hostlar)].sort((a, b) => a.localeCompare(b));
  return (
    <button type="button" className={BTN} style={btnStil(true)} onClick={() => onTara(tekil)}>
      Seçili sunucuları tara ({fmtNumber(tekil.length)})
    </button>
  );
}

// ── UYGULAMALAR ─────────────────────────────────────────────────────────────────────────────────
const UYG_KOLONLARI: EarKolon<EarUygulama>[] = [
  {
    anahtar: 'host',
    baslik: 'Sunucu',
    aciklama: 'Uygulamanın bulunduğu sunucu.',
    suzgec: 'secim',
    sirala: true,
    hucre: (u) => u.host,
    deger: (u) => u.host,
  },
  {
    anahtar: 'ortam',
    baslik: 'Ortam',
    aciklama: 'Sunucunun envanterdeki ortamı.',
    suzgec: 'secim',
    sirala: true,
    hucre: (u) => <Kirp v={u.ortam} en="max-w-[7rem]" />,
    deger: (u) => u.ortam,
  },
  {
    anahtar: 'jboss',
    baslik: 'JBoss',
    aciklama: '7: /vhosting, 8: /vhosting8 altında.',
    suzgec: 'secim',
    secenekler: JBOSS,
    sirala: true,
    hucre: (u) => u.jboss,
    deger: (u) => u.jboss,
  },
  {
    anahtar: 'kok',
    baslik: 'Kök',
    aciklama: 'Taranan kök dizin.',
    suzgec: 'secim',
    sirala: true,
    varsayilan: false,
    hucre: (u) => u.kok,
    deger: (u) => u.kok,
  },
  {
    anahtar: 'ad',
    baslik: 'Uygulama',
    aciklama: 'EAR adı (kökteki dizin ya da arşiv).',
    suzgec: 'secim',
    sirala: true,
    hucre: (u) => <Kirp v={u.ad} en="max-w-[18rem]" />,
    deger: (u) => u.ad,
  },
  {
    anahtar: 'durum',
    baslik: 'Durum',
    aciklama: 'Tarama eksiksiz mi; kısmi olan hiçbir zaman "tam" sayılmaz.',
    suzgec: 'secim',
    secenekler: secenekleri(DURUM_TABLOLARI.UYGULAMA),
    sirala: true,
    hucre: (u) => <Rozet d={uygulamaDurumu(u.durum)} kucuk />,
    deger: (u) => u.durum,
  },
  {
    anahtar: 'bicim',
    baslik: 'Biçim',
    aciklama: 'ACIK: açık dizin, ARSIV: .ear dosyası, BAG: sürüm dizinine bağ.',
    suzgec: 'secim',
    sirala: true,
    varsayilan: false,
    hucre: (u) => u.bicim,
    deger: (u) => u.bicim,
  },
  {
    anahtar: 'bag_hedefi',
    baslik: 'Bağ hedefi',
    aciklama: 'BAG biçiminde bağın gösterdiği sürüm dizini.',
    suzgec: 'metin',
    sirala: true,
    varsayilan: false,
    hucre: (u) => <Kirp v={u.bag_hedefi} en="max-w-[14rem]" mono />,
    deger: (u) => u.bag_hedefi,
  },
  {
    anahtar: 'kip',
    baslik: 'Kip',
    aciklama: 'Verinin hangi kipte toplandığı (ÖZET / TAM).',
    suzgec: 'secim',
    secenekler: [
      { deger: 'OZET', etiket: 'ÖZET' },
      { deger: 'TAM', etiket: 'TAM' },
    ],
    sirala: true,
    varsayilan: false,
    hucre: (u) => (u.kip === 'TAM' ? 'TAM' : 'ÖZET'),
    deger: (u) => u.kip,
  },
  {
    anahtar: 'war_sayisi',
    baslik: 'WAR',
    aciklama: 'İçindeki WAR modülü sayısı.',
    suzgec: 'sayi',
    sirala: true,
    hucre: (u) => say(u.war_sayisi),
    deger: (u) => u.war_sayisi,
  },
  {
    anahtar: 'spring_boot',
    baslik: 'Spring Boot',
    aciklama: 'Spring Boot sürüm(ler)i.',
    suzgec: 'secim',
    sirala: true,
    hucre: (u) => <Kirp v={u.spring_boot} en="max-w-[7rem]" />,
    deger: (u) => u.spring_boot,
  },
  {
    anahtar: 'spring_framework',
    baslik: 'Spring FW',
    aciklama: 'Spring Framework (spring-core) sürüm(ler)i.',
    suzgec: 'secim',
    sirala: true,
    hucre: (u) => <Kirp v={u.spring_framework} en="max-w-[7rem]" />,
    deger: (u) => u.spring_framework,
  },
  {
    anahtar: 'spring_security',
    baslik: 'Spring Security',
    aciklama: "WAR'lardaki spring-security-core sürümleri.",
    suzgec: 'secim',
    varsayilan: false,
    hucre: (u) => <Kirp v={u.spring_security} en="max-w-[7rem]" />,
    deger: (u) => u.spring_security,
  },
  {
    anahtar: 'servlet',
    baslik: 'Servlet',
    aciklama: 'jakarta.* ya da javax.* (ikisi: karışık).',
    suzgec: 'secim',
    sirala: true,
    hucre: (u) => u.servlet || '—',
    deger: (u) => u.servlet,
  },
  {
    anahtar: 'log4j',
    baslik: 'log4j',
    aciklama: 'log4j-core / log4j sürüm(ler)i.',
    suzgec: 'secim',
    sirala: true,
    hucre: (u) => <Kirp v={u.log4j} en="max-w-[7rem]" />,
    deger: (u) => u.log4j,
  },
  {
    anahtar: 'logback',
    baslik: 'logback',
    aciklama: "WAR'lardaki logback sürümleri.",
    suzgec: 'secim',
    varsayilan: false,
    hucre: (u) => <Kirp v={u.logback} en="max-w-[7rem]" />,
    deger: (u) => u.logback,
  },
  {
    anahtar: 'jackson',
    baslik: 'Jackson',
    aciklama: "WAR'lardaki jackson-databind sürümleri.",
    suzgec: 'secim',
    varsayilan: false,
    hucre: (u) => <Kirp v={u.jackson} en="max-w-[7rem]" />,
    deger: (u) => u.jackson,
  },
  {
    anahtar: 'thymeleaf',
    baslik: 'Thymeleaf',
    aciklama: "WAR'lardaki thymeleaf sürümleri.",
    suzgec: 'secim',
    varsayilan: false,
    hucre: (u) => <Kirp v={u.thymeleaf} en="max-w-[7rem]" />,
    deger: (u) => u.thymeleaf,
  },
  {
    anahtar: 'struts',
    baslik: 'Struts',
    aciklama: "WAR'lardaki Struts sürümleri.",
    suzgec: 'secim',
    varsayilan: false,
    hucre: (u) => <Kirp v={u.struts} en="max-w-[7rem]" />,
    deger: (u) => u.struts,
  },
  {
    anahtar: 'jsp',
    baslik: 'JSP',
    aciklama: 'JSP / JSPX dosyası sayısı.',
    suzgec: 'sayi',
    sirala: true,
    hucre: (u) => say(u.jsp),
    deger: (u) => u.jsp,
  },
  {
    anahtar: 'tld',
    baslik: 'TLD',
    aciklama: 'TLD (etiket kitaplığı) dosyası sayısı.',
    suzgec: 'sayi',
    sirala: true,
    hucre: (u) => say(u.tld),
    deger: (u) => u.tld,
  },
  {
    anahtar: 'jar',
    baslik: 'JAR',
    aciklama: 'Toplam jar dosyası sayısı.',
    suzgec: 'sayi',
    sirala: true,
    varsayilan: false,
    hucre: (u) => say(u.jar),
    deger: (u) => u.jar,
  },
  {
    anahtar: 'class_sayisi',
    baslik: 'CLASS',
    aciklama: '.class dosyası sayısı.',
    suzgec: 'sayi',
    sirala: true,
    varsayilan: false,
    hucre: (u) => say(u.class_sayisi),
    deger: (u) => u.class_sayisi,
  },
  {
    anahtar: 'ear_kutuphane_sayisi',
    baslik: 'EAR lib',
    aciklama: "EAR'ın kendi lib/ dizinindeki jar sayısı.",
    suzgec: 'sayi',
    sirala: true,
    varsayilan: false,
    hucre: (u) => say(u.ear_kutuphane_sayisi),
    deger: (u) => u.ear_kutuphane_sayisi,
  },
  {
    anahtar: 'application_xml',
    baslik: 'application.xml',
    aciklama: 'META-INF/application.xml var mı.',
    suzgec: 'bit',
    sirala: true,
    varsayilan: false,
    hucre: (u) => evetHayir(u.application_xml),
    deger: (u) => u.application_xml,
  },
  {
    anahtar: 'giris',
    baslik: 'Giriş',
    aciklama: 'Taranan dosya ve dizin sayısı.',
    suzgec: 'sayi',
    sirala: true,
    varsayilan: false,
    hucre: (u) => say(u.giris),
    deger: (u) => u.giris,
  },
  {
    anahtar: 'uyari_sayisi',
    baslik: 'Uyarı',
    aciklama: 'Taramadaki uyarı sayısı; üzerine gelince ilk uyarı.',
    suzgec: 'sayi',
    sirala: true,
    varsayilan: false,
    hucre: (u) => {
      let ilk = '';
      try {
        ilk = (JSON.parse(u.uyarilar || '[]') as string[])[0] || '';
      } catch {
        ilk = '';
      }
      return <span title={ilk}>{say(u.uyari_sayisi)}</span>;
    },
    deger: (u) => u.uyari_sayisi,
  },
  {
    anahtar: 'war_adlari',
    baslik: 'WAR adları',
    aciklama: 'İçindeki WAR modüllerinin adları.',
    suzgec: null,
    varsayilan: false,
    hucre: (u) => <Kirp v={u.war_adlari} en="max-w-[16rem]" mono />,
    deger: (u) => u.war_adlari,
  },
  {
    anahtar: 'eslenik_ortam_ici',
    baslik: 'Eşlenik (ortam içi)',
    aciklama: 'Aynı ortamdaki öteki sunuculardaki kopyalarla karşılaştırma.',
    suzgec: 'secim',
    secenekler: secenekleri(DURUM_TABLOLARI.KARAR),
    hucre: (u) => kararHucresi(u.eslenik_ortam_ici),
    deger: (u) => u.eslenik_ortam_ici,
  },
  {
    anahtar: 'eslenik_ortamlar_arasi',
    baslik: 'Eşlenik (ortamlar arası)',
    aciklama: 'Aynı uygulamanın başka ortamlardaki kopyalarıyla karşılaştırma.',
    suzgec: 'secim',
    secenekler: secenekleri(DURUM_TABLOLARI.KARAR),
    varsayilan: false,
    hucre: (u) => kararHucresi(u.eslenik_ortamlar_arasi),
    deger: (u) => u.eslenik_ortamlar_arasi,
  },
  {
    anahtar: 'eslenik_nesil',
    baslik: 'JBoss 7 ↔ 8',
    aciklama: 'Aynı sunucuda öteki JBoss neslindeki kopyayla karşılaştırma.',
    suzgec: 'secim',
    secenekler: secenekleri(DURUM_TABLOLARI.KARAR),
    varsayilan: false,
    hucre: (u) => kararHucresi(u.eslenik_nesil),
    deger: (u) => u.eslenik_nesil,
  },
  {
    anahtar: 'taranma_utc',
    baslik: 'Taranma',
    aciklama: 'Verinin toplandığı tarama ne kadar önce.',
    suzgec: 'tarih',
    sirala: true,
    hucre: (u) => (
      <span title={u.taranma_utc ? fmtDateTime(u.taranma_utc) : ''}>{yasMetni(u.taranma_utc)}</span>
    ),
    deger: (u) => u.taranma_utc,
  },
];

const tabloIstegi = (p: GetirParam) => ({
  f: json(p.f),
  s: p.s || undefined,
  q: p.q || undefined,
  limit: p.limit,
  offset: p.offset,
});
const degerOf =
  (gorunum: 'uygulamalar' | 'warlar' | 'kutuphaneler') =>
  async (kolon: string, ara: string, f: Suzgec[], q: string) => {
    const r = await earApi.degerler(gorunum, kolon, {
      ara: ara || undefined,
      f: json(f),
      q: q || undefined,
    });
    return { degerler: r.degerler, farkli: r.farkli };
  };
const csvBagi =
  (g: 'uygulamalar' | 'warlar' | 'kutuphaneler') => (p: { f: Suzgec[]; s: string; q: string }) =>
    earIndir.csv(g, { f: json(p.f), s: p.s || undefined, q: p.q || undefined });

export function UygulamalarGorunum({ onAc, onTara }: { onAc: DetayAc; onTara?: TaraAc }) {
  return (
    <div className="space-y-2">
      <NeNedir>
        Her sunucudaki EAR uygulamaları (sunucunun veri taşıyan son taraması). Satıra tıklayınca
        WAR'lar, kütüphaneler, aynı adlı kopyalar ve dosya ağacı açılır. Başlıktaki huni ile süzün;
        Kolonlar'dan daha fazla bilgi açın.
      </NeNedir>
      <EarTablo<EarUygulama>
        kimlik="ear-uygulamalar"
        kolonlar={UYG_KOLONLARI}
        getir={async (p) => {
          const r = await earApi.uygulamalar(tabloIstegi(p));
          return { satirlar: r.satirlar, toplam: r.toplam };
        }}
        degerler={degerOf('uygulamalar')}
        satirAnahtari={(u) => `${u.kosu_id}-${u.host}-${u.uyg_no}`}
        onSatir={(u) => onAc(u.kosu_id, u.host, u.uyg_no)}
        secimEylemleri={(l) => <SeciliTara hostlar={l.map((u) => u.host)} onTara={onTara} />}
        csvAdi="ear-envanter_uygulamalar_secili"
        indirBag={csvBagi('uygulamalar')}
        araEtiketi="uygulama / sunucu ara"
      />
    </div>
  );
}

// ── WAR'LAR ─────────────────────────────────────────────────────────────────────────────────────
const WAR_KOLONLARI: EarKolon<EarWarSatiri>[] = [
  {
    anahtar: 'host',
    baslik: 'Sunucu',
    aciklama: "WAR'ın bulunduğu sunucu.",
    suzgec: 'secim',
    sirala: true,
    hucre: (w) => w.host,
    deger: (w) => w.host,
  },
  {
    anahtar: 'ortam',
    baslik: 'Ortam',
    aciklama: 'Sunucunun envanterdeki ortamı.',
    suzgec: 'secim',
    sirala: true,
    hucre: (w) => <Kirp v={w.ortam} en="max-w-[7rem]" />,
    deger: (w) => w.ortam,
  },
  {
    anahtar: 'jboss',
    baslik: 'JBoss',
    aciklama: '7: /vhosting, 8: /vhosting8 altında.',
    suzgec: 'secim',
    secenekler: JBOSS,
    sirala: true,
    varsayilan: false,
    hucre: (w) => w.jboss,
    deger: (w) => w.jboss,
  },
  {
    anahtar: 'uygulama',
    baslik: 'Uygulama',
    aciklama: "WAR'ın içinde olduğu EAR.",
    suzgec: 'secim',
    sirala: true,
    hucre: (w) => <Kirp v={w.uygulama} en="max-w-[14rem]" />,
    deger: (w) => w.uygulama,
  },
  {
    anahtar: 'ad',
    baslik: 'WAR',
    aciklama: 'WAR modülünün adı.',
    suzgec: 'secim',
    sirala: true,
    hucre: (w) => <Kirp v={w.ad} en="max-w-[14rem]" />,
    deger: (w) => w.ad,
  },
  {
    anahtar: 'yol',
    baslik: 'Yol',
    aciklama: 'EAR içindeki yolu.',
    suzgec: 'metin',
    sirala: true,
    varsayilan: false,
    hucre: (w) => <Kirp v={w.yol} en="max-w-[14rem]" mono />,
    deger: (w) => w.yol,
  },
  {
    anahtar: 'bicim',
    baslik: 'Biçim',
    aciklama: 'ACIK: açık dizin, ARSIV: paketli .war.',
    suzgec: 'secim',
    sirala: true,
    varsayilan: false,
    hucre: (w) => w.bicim || '—',
    deger: (w) => w.bicim,
  },
  {
    anahtar: 'durum',
    baslik: 'Durum',
    aciklama: 'WAR eksiksiz tarandı mı.',
    suzgec: 'secim',
    secenekler: secenekleri(DURUM_TABLOLARI.UYGULAMA),
    sirala: true,
    hucre: (w) => <Rozet d={uygulamaDurumu(w.durum)} kucuk />,
    deger: (w) => w.durum,
  },
  {
    anahtar: 'spring_boot',
    baslik: 'Spring Boot',
    aciklama: 'Spring Boot sürümü.',
    suzgec: 'secim',
    sirala: true,
    hucre: (w) => w.spring_boot || '—',
    deger: (w) => w.spring_boot,
  },
  {
    anahtar: 'spring_framework',
    baslik: 'Spring FW',
    aciklama: 'spring-core sürümü.',
    suzgec: 'secim',
    sirala: true,
    hucre: (w) => w.spring_framework || '—',
    deger: (w) => w.spring_framework,
  },
  {
    anahtar: 'spring_security',
    baslik: 'Spring Security',
    aciklama: 'spring-security-core sürümü.',
    suzgec: 'secim',
    sirala: true,
    hucre: (w) => w.spring_security || '—',
    deger: (w) => w.spring_security,
  },
  {
    anahtar: 'log4j',
    baslik: 'log4j',
    aciklama: 'log4j-core / log4j sürümü.',
    suzgec: 'secim',
    sirala: true,
    hucre: (w) => w.log4j || '—',
    deger: (w) => w.log4j,
  },
  {
    anahtar: 'logback',
    baslik: 'logback',
    aciklama: 'logback sürümü.',
    suzgec: 'secim',
    sirala: true,
    varsayilan: false,
    hucre: (w) => w.logback || '—',
    deger: (w) => w.logback,
  },
  {
    anahtar: 'jackson',
    baslik: 'Jackson',
    aciklama: 'jackson-databind sürümü.',
    suzgec: 'secim',
    sirala: true,
    varsayilan: false,
    hucre: (w) => w.jackson || '—',
    deger: (w) => w.jackson,
  },
  {
    anahtar: 'thymeleaf',
    baslik: 'Thymeleaf',
    aciklama: 'thymeleaf sürümü.',
    suzgec: 'secim',
    sirala: true,
    varsayilan: false,
    hucre: (w) => w.thymeleaf || '—',
    deger: (w) => w.thymeleaf,
  },
  {
    anahtar: 'struts',
    baslik: 'Struts',
    aciklama: 'Struts sürümü.',
    suzgec: 'secim',
    sirala: true,
    varsayilan: false,
    hucre: (w) => w.struts || '—',
    deger: (w) => w.struts,
  },
  {
    anahtar: 'servlet',
    baslik: 'Servlet',
    aciklama: 'jakarta.* ya da javax.* (ikisi: karışık).',
    suzgec: 'secim',
    sirala: true,
    hucre: (w) => w.servlet || '—',
    deger: (w) => w.servlet,
  },
  {
    anahtar: 'jsp',
    baslik: 'JSP',
    aciklama: 'JSP / JSPX dosyası sayısı.',
    suzgec: 'sayi',
    sirala: true,
    hucre: (w) => say(w.jsp),
    deger: (w) => w.jsp,
  },
  {
    anahtar: 'tld',
    baslik: 'TLD',
    aciklama: 'TLD dosyası sayısı.',
    suzgec: 'sayi',
    sirala: true,
    hucre: (w) => say(w.tld),
    deger: (w) => w.tld,
  },
  {
    anahtar: 'tld_dizini',
    baslik: 'tld dizini',
    aciklama: 'WEB-INF/tld dizini var mı.',
    suzgec: 'bit',
    sirala: true,
    varsayilan: false,
    hucre: (w) => evetHayir(w.tld_dizini),
    deger: (w) => w.tld_dizini,
  },
  {
    anahtar: 'jar',
    baslik: 'JAR',
    aciklama: 'WEB-INF/lib altındaki jar sayısı.',
    suzgec: 'sayi',
    sirala: true,
    varsayilan: false,
    hucre: (w) => say(w.jar),
    deger: (w) => w.jar,
  },
  {
    anahtar: 'class_sayisi',
    baslik: 'CLASS',
    aciklama: '.class dosyası sayısı.',
    suzgec: 'sayi',
    sirala: true,
    varsayilan: false,
    hucre: (w) => say(w.class_sayisi),
    deger: (w) => w.class_sayisi,
  },
  {
    anahtar: 'kutuphane_sayisi',
    baslik: 'Kütüphane',
    aciklama: 'Tanınan kütüphane (jar) sayısı.',
    suzgec: 'sayi',
    sirala: true,
    hucre: (w) => say(w.kutuphane_sayisi),
    deger: (w) => w.kutuphane_sayisi,
  },
  {
    anahtar: 'web_xml',
    baslik: 'web.xml',
    aciklama: 'WEB-INF/web.xml var mı.',
    suzgec: 'bit',
    sirala: true,
    varsayilan: false,
    hucre: (w) => evetHayir(w.web_xml),
    deger: (w) => w.web_xml,
  },
  {
    anahtar: 'web_varyantlari',
    baslik: 'web.<ortam>.xml',
    aciklama: 'Ortama özel web.xml varyantları.',
    suzgec: 'metin',
    sirala: true,
    varsayilan: false,
    hucre: (w) => w.web_varyantlari || '—',
    deger: (w) => w.web_varyantlari,
  },
  {
    anahtar: 'jboss_web_xml',
    baslik: 'jboss-web.xml',
    aciklama: 'WEB-INF/jboss-web.xml var mı.',
    suzgec: 'bit',
    sirala: true,
    varsayilan: false,
    hucre: (w) => evetHayir(w.jboss_web_xml),
    deger: (w) => w.jboss_web_xml,
  },
  {
    anahtar: 'jboss_deployment_structure',
    baslik: 'jboss-deployment-structure',
    aciklama: 'jboss-deployment-structure.xml var mı.',
    suzgec: 'bit',
    sirala: true,
    varsayilan: false,
    hucre: (w) => evetHayir(w.jboss_deployment_structure),
    deger: (w) => w.jboss_deployment_structure,
  },
];

export function WarlarGorunum({ onAc, onTara }: { onAc: DetayAc; onTara?: TaraAc }) {
  return (
    <div className="space-y-2">
      <NeNedir>
        EAR'ların içindeki WAR modülleri: teknoloji sürümleri ve tanımlayıcılar (web.xml,
        jboss-web.xml …). Satıra tıklayınca uygulamanın ayrıntısı açılır.
      </NeNedir>
      <EarTablo<EarWarSatiri>
        kimlik="ear-warlar"
        kolonlar={WAR_KOLONLARI}
        getir={async (p) => {
          const r = await earApi.warlar(tabloIstegi(p));
          return { satirlar: r.satirlar, toplam: r.toplam };
        }}
        degerler={degerOf('warlar')}
        satirAnahtari={(w) => `${w.kosu_id}-${w.host}-${w.uyg_no}-${w.war_no}`}
        onSatir={(w) => onAc(w.kosu_id, w.host, w.uyg_no)}
        secimEylemleri={(l) => <SeciliTara hostlar={l.map((w) => w.host)} onTara={onTara} />}
        csvAdi="ear-envanter_warlar_secili"
        indirBag={csvBagi('warlar')}
        araEtiketi="WAR / uygulama / sunucu ara"
      />
    </div>
  );
}

// ── ESLENIKLER ──────────────────────────────────────────────────────────────────────────────────
const FARK_ETIKETI: Record<EarFarkSatiri['kategori'], string> = {
  WAR: 'WAR yalnız bazılarında',
  EKSIK: 'yalnız bazılarında var',
  SURUM: 'sürüm farklı',
  BOYUT: 'aynı sürüm, boyut farklı',
};

/** [[sürüm, boyut], ...] -> "6.1.0 (1.2 MB)"; null -> "yok". */
function surumMetni(
  v: [string, number | null][] | null,
  kategori: EarFarkSatiri['kategori'],
): string {
  if (v == null) return 'yok';
  if (kategori === 'WAR') return 'var';
  return v.map(([s, b]) => (kategori === 'BOYUT' ? `${s} (${boyutMetni(b)})` : s)).join(', ');
}

/** İki TAM kopyanın dosya farkı (ham ağaçtan). */
function YapiFarki({ kopyalar }: { kopyalar: EarEslenikFarki['kopyalar'] }) {
  const tamlar = kopyalar.filter((k) => k.kip === 'TAM' && k.durum === 'TAM');
  const anah = (k: (typeof kopyalar)[number]) => `${k.kosu_id}:${k.host}:${k.uyg_no}`;
  const [a, setA] = useState(tamlar[0] ? anah(tamlar[0]) : '');
  const [b, setB] = useState(tamlar[1] ? anah(tamlar[1]) : '');
  const [istek, setIstek] = useState<string | null>(null);
  const [sonuc, setSonuc] = useState<{ istek: string; f: EarYapiFarki } | null>(null);
  const [hata, setHata] = useState('');
  useAsyncEffect(
    async (alive) => {
      if (!istek) return;
      try {
        const [x, y] = istek.split('|');
        const f = await earApi.yapiFarki(x, y);
        if (alive()) setSonuc({ istek, f });
      } catch (e) {
        if (alive()) setHata(e instanceof Error ? e.message : String(e));
      }
    },
    [istek],
  );
  if (tamlar.length < 2)
    return (
      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        Dosya farkı için TAM kipte ve eksiksiz taranmış en az iki kopya gerekir.
      </div>
    );
  const sec = (v: string, set: (x: string) => void, ad: string) => (
    <select
      aria-label={ad}
      className={GIRDI}
      style={girdiStil}
      value={v}
      onChange={(e) => set(e.target.value)}
    >
      {tamlar.map((k) => (
        <option key={anah(k)} value={anah(k)}>
          {k.host} ({k.kok})
        </option>
      ))}
    </select>
  );
  const f = sonuc && sonuc.istek === istek ? sonuc.f : null;
  const liste = (baslik: string, l: string[]) =>
    l.length > 0 && (
      <div>
        <div className="font-semibold">
          {baslik} ({fmtNumber(l.length)})
        </div>
        <pre
          className="max-h-48 overflow-auto text-[11px] font-mono px-2 py-1 rounded"
          style={{ background: 'var(--bg-surface)' }}
        >
          {l.join('\n')}
        </pre>
      </div>
    );
  return (
    <div className="space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-1">
        <b>Dosya farkı:</b> {sec(a, setA, 'A kopyası')} ile {sec(b, setB, 'B kopyası')}
        <button
          type="button"
          className={BTN}
          style={btnStil()}
          disabled={!a || !b || a === b}
          onClick={() => setIstek(`${a}|${b}`)}
        >
          Karşılaştır
        </button>
      </div>
      {hata && <LoadError title="Dosya farkı okunamadı" message={hata} compact />}
      {istek && !f && !hata && <div style={{ color: 'var(--text-muted)' }}>Ağaçlar okunuyor…</div>}
      {f && f.hesaplanamadi && (
        <div style={{ color: 'var(--status-warning-text)' }}>{f.hesaplanamadi}</div>
      )}
      {f && !f.hesaplanamadi && (
        <>
          <div style={{ color: 'var(--text-secondary)' }}>
            {f.ayni
              ? 'Dosya yapısı aynı (log / tmp / work hariç).'
              : 'Dosya yapısı farklı (log / tmp / work hariç).'}
          </div>
          {liste('Yalnız A’da', f.yalnizA || [])}
          {liste('Yalnız B’de', f.yalnizB || [])}
          {liste(
            'Tipi farklı',
            (f.tipFarkli || []).map((x) => `${x.yol}  ${x.a} / ${x.b}`),
          )}
          {liste(
            'Bilgi: boyutu farklı (yapı kararına girmez)',
            (f.boyutFarkli || []).map((x) => `${x.yol}  ${x.a} / ${x.b}`),
          )}
        </>
      )}
    </div>
  );
}

/** Eşlenik grubunun ayrıntısı: kopyalar, kategorili kütüphane farkı (tamamı, parça parça) ve dosya farkı. */
function EslenikDetay({
  tur,
  ad,
  ortam,
  jboss,
  host,
  kutuphane,
}: {
  tur: EarEslenikTuru;
  ad: string;
  ortam: string;
  jboss: string;
  host?: string;
  kutuphane?: string | null;
}) {
  const [sayfalar, setSayfalar] = useState<EarEslenikFarki[]>([]);
  const [hata, setHata] = useState('');
  const [offset, setOffset] = useState(0);
  useAsyncEffect(
    async (alive) => {
      try {
        const r = await earApi.eslenik(ad, ortam, jboss, { tur, host, limit: 500, offset });
        if (alive()) setSayfalar((x) => (offset === 0 ? [r] : [...x, r]));
      } catch (e) {
        if (alive()) setHata(e instanceof Error ? e.message : String(e));
      }
    },
    [ad, ortam, jboss, tur, host, offset],
  );
  if (hata) return <LoadError title="Kütüphane farkı okunamadı" message={hata} compact />;
  if (!sayfalar.length) return <Yukleniyor />;
  const f = sayfalar[0];
  const farklar = sayfalar.flatMap((x) => x.farklar);
  return (
    <div className="space-y-2 py-2">
      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        {f.kopyalar
          .map(
            (k) =>
              `${k.host}${k.ortam && tur !== 'ORTAM_ICI' ? ` [${k.ortam}]` : ''}${k.degisken ? ` ${k.degisken}` : ''} (${uygulamaDurumu(k.durum).etiket}, ${k.kip === 'TAM' ? 'TAM' : 'ÖZET'}, ${yasMetni(k.taranma_utc)})`,
          )
          .join(' · ')}
      </div>
      {f.toplam === 0 ? (
        <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {kutuphane === 'KARSILASTIRILAMADI'
            ? 'Kütüphaneler karşılaştırılmadı: kopyalardan biri tam taranmadı.'
            : 'Kütüphane listeleri birebir aynı (ad, sürüm ve dosya boyutu).'}
        </div>
      ) : (
        <>
          <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            {fmtNumber(f.toplam)} fark ·{' '}
            {(Object.keys(FARK_ETIKETI) as EarFarkSatiri['kategori'][])
              .filter((k) => f.sayilar[k])
              .map((k) => `${FARK_ETIKETI[k]}: ${f.sayilar[k]}`)
              .join(' · ')}
          </div>
          <div className="overflow-auto max-h-96">
            <table className={TABLO}>
              <thead>
                <tr>
                  {['Fark', 'Yer', 'Kütüphane', ...f.kopyalar.map((k) => k.host)].map((b, i) => (
                    <th key={`${b}-${i}`} className={`${TH} sticky top-0`} style={thStil}>
                      {b}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {farklar.map((x) => (
                  <tr
                    key={`${x.kategori}|${x.konum}|${x.kutuphane}`}
                    className="border-t"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <td className={TD}>{FARK_ETIKETI[x.kategori]}</td>
                    <td className={TD}>
                      <Kirp v={x.konum || 'EAR lib/'} en="max-w-[12rem]" mono />
                    </td>
                    <td className={TD}>
                      <Kirp v={x.kutuphane || '—'} en="max-w-[14rem]" mono />
                    </td>
                    {f.kopyalar.map((k) => (
                      <td key={k.anahtar} className={TD}>
                        <Kirp
                          v={surumMetni(x.degerler[k.anahtar] ?? null, x.kategori)}
                          en="max-w-[10rem]"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {farklar.length < f.toplam && (
            <button
              type="button"
              className={BTN}
              style={btnStil()}
              onClick={() => setOffset(farklar.length)}
            >
              {fmtNumber(f.toplam - farklar.length)} fark daha göster
            </button>
          )}
        </>
      )}
      <YapiFarki kopyalar={f.kopyalar} />
    </div>
  );
}

const TURLER: { id: EarEslenikTuru; etiket: string; aciklama: string }[] = [
  {
    id: 'ORTAM_ICI',
    etiket: 'Ortam içi',
    aciklama:
      'Aynı uygulama, aynı ortam ve aynı JBoss neslinde birden çok sunucuda: kopyalar birebir aynı mı.',
  },
  {
    id: 'ORTAMLAR_ARASI',
    etiket: 'Ortamlar arası',
    aciklama:
      'Aynı uygulama farklı ortamlarda (ör. TEST ↔ PROD): harf aynıysa kütüphaneler aynıdır; farklı harf taşıyan ortam ayrılır.',
  },
  {
    id: 'NESIL',
    etiket: 'JBoss 7 ↔ 8',
    aciklama: 'Aynı sunucuda aynı EAR hem /vhosting hem /vhosting8 altında.',
  },
  {
    id: 'ORTAM_YOK',
    etiket: 'Ortam bilinmiyor',
    aciklama:
      'Envanterde ortamı boş sunucular: farklı ortamlar karışmasın diye karşılaştırılmaz; ortam girilince kendiliğinden eşlenir.',
  },
];

/** Eşlenik süzgeçleri -> /ear/eslenikler parametreleri (desteklenmeyen işlem sessizce atılmaz: tablo yalnız bunları sunar). */
function eslenikParam(tur: EarEslenikTuru, p: GetirParam) {
  const al = (k: string, op = 'in') => p.f.find((x) => x.k === k && x.op === op);
  const liste = (k: string) => {
    const s = al(k);
    return s ? ((s.v as (string | null)[]) || []).filter((x) => x != null).join(',') : undefined;
  };
  const tf = al('tarih_farki_gun', 'min');
  const tfm = al('tarih_farki_gun', 'max');
  return {
    tur,
    q: p.q || undefined,
    karar: liste('karar'),
    kutuphane: liste('kutuphane'),
    yapi: liste('yapi'),
    ortam: liste('ortam'),
    jboss: liste('jboss'),
    tarihFarki: tf ? Number(tf.v) : undefined,
    tarihFarkiMax: tfm ? Number(tfm.v) : undefined,
    limit: p.limit,
    offset: p.offset,
  };
}

const ortamDegerleri = async (kolon: string, ara: string) => {
  if (kolon !== 'ortam') return { degerler: [], farkli: 0 };
  const r = await earApi.ortamlar();
  const l = r.ortamlar.filter((o) => !ara || o.ortam.toLowerCase().includes(ara.toLowerCase()));
  return { degerler: l.map((o) => ({ deger: o.ortam, sayi: o.sunucu })), farkli: l.length };
};

const ortakKarar = <
  T extends { karar: string | null; kutuphane?: string | null; yapi?: string | null },
>(): EarKolon<T>[] => [
  {
    anahtar: 'karar',
    baslik: 'Sonuç',
    aciklama: 'Kütüphane ve yapı sonuçlarının en kötüsü.',
    suzgec: 'secim',
    secenekler: secenekleri(DURUM_TABLOLARI.KARAR),
    hucre: (g) => (g.karar ? <Rozet d={kararDurumu(g.karar)} kucuk /> : '—'),
    deger: (g) => g.karar,
  },
  {
    anahtar: 'kutuphane',
    baslik: 'Kütüphane',
    aciklama: 'Jar adı, sürümü ve boyutu bütün kopyalarda aynı mı.',
    suzgec: 'secim',
    secenekler: KUTUPHANE_SONUC,
    hucre: (g) => sonucEtiketi(KUTUPHANE_SONUC, g.kutuphane),
    deger: (g) => g.kutuphane,
  },
  {
    anahtar: 'yapi',
    baslik: 'Yapı',
    aciklama: 'Dosya yapısı (yol + tip; log / tmp hariç) aynı mı.',
    suzgec: 'secim',
    secenekler: YAPI_SONUC,
    hucre: (g) => sonucEtiketi(YAPI_SONUC, g.yapi),
    deger: (g) => g.yapi,
  },
];
const tarihKolonu = <T extends { tarih_farki_gun?: number }>(): EarKolon<T> => ({
  anahtar: 'tarih_farki_gun',
  baslik: 'Tarama farkı',
  aciklama: 'Kopyaların tarandığı günler arasındaki fark; karar yine verilir.',
  suzgec: 'sayi',
  hucre: (g) => {
    const d = g.tarih_farki_gun || 0;
    return d > 1 ? (
      <span style={{ color: d > 7 ? 'var(--status-warning-text)' : undefined }}>{d} gün</span>
    ) : (
      '—'
    );
  },
  deger: (g) => g.tarih_farki_gun,
});

const ICI_KOLONLARI: EarKolon<EarEslenik>[] = [
  {
    anahtar: 'uygulama',
    baslik: 'Uygulama',
    aciklama: 'EAR adı.',
    suzgec: null,
    hucre: (g) => <Kirp v={g.uygulama} en="max-w-[18rem]" />,
    deger: (g) => g.uygulama,
  },
  {
    anahtar: 'ortam',
    baslik: 'Ortam',
    aciklama: 'Kopyaların ortamı (birebir).',
    suzgec: 'secim',
    hucre: (g) => g.ortam,
    deger: (g) => g.ortam,
  },
  {
    anahtar: 'jboss',
    baslik: 'JBoss',
    aciklama: 'JBoss nesli.',
    suzgec: 'secim',
    secenekler: JBOSS,
    hucre: (g) => g.jboss,
    deger: (g) => g.jboss,
  },
  ...ortakKarar<EarEslenik>(),
  tarihKolonu<EarEslenik>(),
  {
    anahtar: 'hostlar',
    baslik: 'Sunucular',
    aciklama: 'Kopyaların bulunduğu sunucular.',
    suzgec: null,
    hucre: (g) => <Kirp v={`${g.host_sayisi}: ${g.hostlar.join(', ')}`} en="max-w-[18rem]" />,
    deger: (g) => g.hostlar.join(' '),
  },
  {
    anahtar: 'degiskenler',
    baslik: 'Değişkenler',
    aciklama: 'Aynı harfi taşıyan kopyalar birebir aynıdır.',
    suzgec: null,
    hucre: (g) => (
      <Kirp
        v={(g.degiskenler || []).map((x) => `${x.harf}: ${x.hostlar.join(',')}`).join(' | ')}
        en="max-w-[22rem]"
        mono
      />
    ),
    deger: (g) => (g.degiskenler || []).map((x) => `${x.harf}=${x.hostlar.join(',')}`).join(' '),
  },
];
const ARASI_KOLONLARI: EarKolon<EarOrtamlarArasi>[] = [
  {
    anahtar: 'uygulama',
    baslik: 'Uygulama',
    aciklama: 'EAR adı.',
    suzgec: null,
    hucre: (g) => <Kirp v={g.uygulama} en="max-w-[18rem]" />,
    deger: (g) => g.uygulama,
  },
  {
    anahtar: 'jboss',
    baslik: 'JBoss',
    aciklama: 'JBoss nesli.',
    suzgec: 'secim',
    secenekler: JBOSS,
    hucre: (g) => g.jboss,
    deger: (g) => g.jboss,
  },
  {
    anahtar: 'ortam',
    baslik: 'Ortamlar',
    aciklama: 'Ortam ve kütüphane değişkeni (harf); süzgeç: bu ortamı içerenler.',
    suzgec: 'secim',
    hucre: (g) => (
      <Kirp
        v={g.ortamlar.map((o) => `${o.ortam}: ${o.harfler.join('+')}`).join(' · ')}
        en="max-w-[22rem]"
        mono
      />
    ),
    deger: (g) => g.ortamlar.map((o) => o.ortam).join(' '),
  },
  {
    anahtar: 'farkli_ortamlar',
    baslik: 'Farklı olan',
    aciklama: 'Çoğunluk değişkeninden ayrılan ortamlar.',
    suzgec: null,
    hucre: (g) => (g.farkli_ortamlar.length ? <b>{g.farkli_ortamlar.join(', ')}</b> : '—'),
    deger: (g) => g.farkli_ortamlar.join(' '),
  },
  ...ortakKarar<EarOrtamlarArasi>(),
  tarihKolonu<EarOrtamlarArasi>(),
];
const NESIL_KOLONLARI: EarKolon<EarIkiNesil & { tarih_farki_gun?: number }>[] = [
  {
    anahtar: 'host',
    baslik: 'Sunucu',
    aciklama: 'İki nesli de taşıyan sunucu.',
    suzgec: null,
    hucre: (x) => x.host,
    deger: (x) => x.host,
  },
  {
    anahtar: 'uygulama',
    baslik: 'Uygulama',
    aciklama: 'EAR adı.',
    suzgec: null,
    hucre: (x) => <Kirp v={x.uygulama} en="max-w-[18rem]" />,
    deger: (x) => x.uygulama,
  },
  {
    anahtar: 'ortam',
    baslik: 'Ortam',
    aciklama: 'Sunucunun ortamı.',
    suzgec: 'secim',
    hucre: (x) => x.ortam || '—',
    deger: (x) => x.ortam,
  },
  ...ortakKarar<EarIkiNesil>(),
  tarihKolonu<EarIkiNesil & { tarih_farki_gun?: number }>(),
];
const YOK_KOLONLARI: EarKolon<EarOrtamYok>[] = [
  {
    anahtar: 'uygulama',
    baslik: 'Uygulama',
    aciklama: 'EAR adı.',
    suzgec: null,
    hucre: (x) => <Kirp v={x.uygulama} en="max-w-[18rem]" />,
    deger: (x) => x.uygulama,
  },
  {
    anahtar: 'jboss',
    baslik: 'JBoss',
    aciklama: 'JBoss nesli.',
    suzgec: 'secim',
    secenekler: JBOSS,
    hucre: (x) => x.jboss,
    deger: (x) => x.jboss,
  },
  {
    anahtar: 'karar',
    baslik: 'Sonuç',
    aciklama: 'Karşılaştırılmadı: ortam bilinmiyor.',
    suzgec: null,
    hucre: () => (
      <Rozet
        d={{ etiket: 'ortam bilinmiyor', ton: 'notr', aciklama: 'Envanterde ortam boş.' }}
        kucuk
      />
    ),
    deger: () => 'ortam bilinmiyor',
  },
  {
    anahtar: 'hostlar',
    baslik: 'Sunucular',
    aciklama: 'Ortamı boş sunucular.',
    suzgec: null,
    hucre: (x) => <Kirp v={`${x.host_sayisi}: ${x.hostlar.join(', ')}`} en="max-w-[22rem]" />,
    deger: (x) => x.hostlar.join(' '),
  },
];

export function EsleniklerGorunum() {
  const [tur, setTur] = useState<EarEslenikTuru>('ORTAM_ICI');
  const t = TURLER.find((x) => x.id === tur)!;
  const ortak = {
    degerler: ortamDegerleri,
    araEtiketi: 'uygulama / sunucu ara',
    ustSag: <IndirBag href={earIndir.csv('eslenikler', { tur })}>Bu listenin tamamı CSV</IndirBag>,
  };
  const getir =
    <T,>() =>
    async (p: GetirParam) => {
      const r = await earApi.eslenikListesi<T>(eslenikParam(tur, p));
      return { satirlar: r.satirlar, toplam: r.toplam };
    };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Eşlenik türü">
        {TURLER.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={tur === x.id}
            className={`${BTN} ${tur === x.id ? 'shadow-sm' : ''}`}
            style={btnStil(tur === x.id)}
            onClick={() => setTur(x.id)}
          >
            {x.etiket}
          </button>
        ))}
      </div>
      <NeNedir>
        {t.aciklama} Kütüphane ve yapı ayrı karşılaştırılır; kopyalardan biri bile tam taranmadıysa
        karar verilmez.
      </NeNedir>
      {tur === 'ORTAM_ICI' && (
        <EarTablo<EarEslenik>
          key={tur}
          kimlik="ear-eslenik-ici"
          kolonlar={ICI_KOLONLARI}
          getir={getir<EarEslenik>()}
          satirAnahtari={(g) => `${g.uygulama}|${g.ortam}|${g.jboss}`}
          acilir={(g) => (
            <EslenikDetay
              tur="ORTAM_ICI"
              ad={g.uygulama}
              ortam={g.ortam}
              jboss={g.jboss}
              kutuphane={g.kutuphane}
            />
          )}
          {...ortak}
        />
      )}
      {tur === 'ORTAMLAR_ARASI' && (
        <EarTablo<EarOrtamlarArasi>
          key={tur}
          kimlik="ear-eslenik-arasi"
          kolonlar={ARASI_KOLONLARI}
          getir={getir<EarOrtamlarArasi>()}
          satirAnahtari={(g) => `${g.uygulama}|${g.jboss}`}
          acilir={(g) => (
            <EslenikDetay
              tur="ORTAMLAR_ARASI"
              ad={g.uygulama}
              ortam=""
              jboss={g.jboss}
              kutuphane={g.kutuphane}
            />
          )}
          {...ortak}
        />
      )}
      {tur === 'NESIL' && (
        <EarTablo<EarIkiNesil & { tarih_farki_gun?: number }>
          key={tur}
          kimlik="ear-eslenik-nesil"
          kolonlar={NESIL_KOLONLARI}
          getir={getir<EarIkiNesil & { tarih_farki_gun?: number }>()}
          satirAnahtari={(g) => `${g.host}|${g.uygulama}`}
          acilir={(g) => (
            <EslenikDetay
              tur="NESIL"
              ad={g.uygulama}
              ortam=""
              jboss=""
              host={g.host}
              kutuphane={g.kutuphane}
            />
          )}
          {...ortak}
        />
      )}
      {tur === 'ORTAM_YOK' && (
        <EarTablo<EarOrtamYok>
          key={tur}
          kimlik="ear-eslenik-yok"
          kolonlar={YOK_KOLONLARI}
          getir={getir<EarOrtamYok>()}
          satirAnahtari={(g) => `${g.uygulama}|${g.jboss}`}
          {...ortak}
        />
      )}
    </div>
  );
}

// ── KUTUPHANELER ────────────────────────────────────────────────────────────────────────────────
const KULLANAN_KOLONLARI: EarKolon<EarKullanan>[] = [
  {
    anahtar: 'host',
    baslik: 'Sunucu',
    aciklama: 'Kullanan sunucu.',
    hucre: (k) => k.host,
    deger: (k) => k.host,
  },
  {
    anahtar: 'ortam',
    baslik: 'Ortam',
    aciklama: 'Sunucunun ortamı.',
    hucre: (k) => k.ortam || '—',
    deger: (k) => k.ortam,
  },
  {
    anahtar: 'kok',
    baslik: 'Kök',
    aciklama: 'Kök dizin.',
    hucre: (k) => k.kok,
    deger: (k) => k.kok,
  },
  {
    anahtar: 'uygulama',
    baslik: 'Uygulama',
    aciklama: 'Kullanan EAR.',
    hucre: (k) => <Kirp v={k.uygulama} en="max-w-[18rem]" />,
    deger: (k) => k.uygulama,
  },
  {
    anahtar: 'durum',
    baslik: 'Durum',
    aciklama: 'Uygulamanın tarama durumu.',
    hucre: (k) => <Rozet d={uygulamaDurumu(k.durum)} kucuk />,
    deger: (k) => k.durum,
  },
];

function Kullananlar({ ad, surum, onAc }: { ad: string; surum: string; onAc: DetayAc }) {
  return (
    <div className="py-2">
      <EarTablo<EarKullanan>
        kimlik="ear-kullananlar"
        kolonlar={KULLANAN_KOLONLARI}
        getir={async (p) => {
          const r = await earApi.kutuphane(ad, surum, { limit: p.limit, offset: p.offset });
          return { satirlar: r.kullananlar, toplam: r.toplam };
        }}
        satirAnahtari={(k) => `${k.kosu_id}-${k.host}-${k.uyg_no}`}
        onSatir={(k) => onAc(k.kosu_id, k.host, k.uyg_no)}
        araEtiketi="(bu listede arama yok)"
      />
    </div>
  );
}

const KUTUPHANE_KOLONLARI: EarKolon<EarKutuphaneSatiri>[] = [
  {
    anahtar: 'ad',
    baslik: 'Kütüphane',
    aciklama: 'Jar adından çıkarılan kütüphane adı.',
    suzgec: 'secim',
    sirala: true,
    hucre: (k) => <span className="font-mono">{k.ad}</span>,
    deger: (k) => k.ad,
  },
  {
    anahtar: 'surum',
    baslik: 'Sürüm',
    aciklama: 'Jar adından çıkarılan sürüm.',
    suzgec: 'secim',
    sirala: true,
    hucre: (k) => k.surum || '—',
    deger: (k) => k.surum,
  },
  {
    anahtar: 'host_sayisi',
    baslik: 'Sunucu',
    aciklama: 'Bu sürümü taşıyan sunucu sayısı.',
    suzgec: 'sayi',
    sirala: true,
    hucre: (k) => say(k.host_sayisi),
    deger: (k) => k.host_sayisi,
  },
  {
    anahtar: 'uygulama_sayisi',
    baslik: 'Uygulama',
    aciklama: 'Bu sürümü taşıyan uygulama sayısı.',
    suzgec: 'sayi',
    sirala: true,
    hucre: (k) => say(k.uygulama_sayisi),
    deger: (k) => k.uygulama_sayisi,
  },
  {
    anahtar: 'kopya',
    baslik: 'Kopya',
    aciklama: 'Toplam jar kopyası (WAR ve EAR lib).',
    suzgec: 'sayi',
    sirala: true,
    hucre: (k) => say(k.kopya),
    deger: (k) => k.kopya,
  },
];

export function KutuphanelerGorunum({ onAc }: { onAc: DetayAc }) {
  return (
    <div className="space-y-2">
      <NeNedir>
        Jar kütüphaneleri sürüm sürüm: kaç sunucuda, kaç uygulamada kullanılıyor. Satırı açınca
        kullanan uygulamalar (tamamı, sayfalı) gelir.
      </NeNedir>
      <EarTablo<EarKutuphaneSatiri>
        kimlik="ear-kutuphaneler"
        kolonlar={KUTUPHANE_KOLONLARI}
        getir={async (p) => {
          const r = await earApi.kutuphaneler(tabloIstegi(p));
          return { satirlar: r.kutuphaneler, toplam: r.toplam };
        }}
        degerler={degerOf('kutuphaneler')}
        satirAnahtari={(k) => `${k.ad}@${k.surum}`}
        acilir={(k) => <Kullananlar ad={k.ad} surum={k.surum} onAc={onAc} />}
        indirBag={csvBagi('kutuphaneler')}
        araEtiketi="kütüphane ara (log4j, spring …)"
      />
    </div>
  );
}

// ── SUNUCULAR ───────────────────────────────────────────────────────────────────────────────────
const veriDurumu = (h: EarHost) =>
  h.veri_kosu_id == null ? 'hiç veri yok' : h.veri_kosu_id !== h.kosu_id ? 'eski' : 'güncel';

const SUNUCU_KOLONLARI: EarKolon<EarHost>[] = [
  {
    anahtar: 'host',
    baslik: 'Sunucu',
    aciklama: 'Taranan sunucu.',
    suzgec: 'metin',
    sirala: true,
    hucre: (h) => h.host,
    deger: (h) => h.host,
  },
  {
    anahtar: 'ortam',
    baslik: 'Ortam',
    aciklama: 'Envanterdeki ortam.',
    suzgec: 'secim',
    sirala: true,
    hucre: (h) => <Kirp v={h.ortam} en="max-w-[7rem]" />,
    deger: (h) => h.ortam,
  },
  {
    anahtar: 'durum',
    baslik: 'Durum',
    aciklama: 'Son taramanın sonucu.',
    suzgec: 'secim',
    secenekler: secenekleri(DURUM_TABLOLARI.HOST),
    sirala: true,
    hucre: (h) => <Rozet d={hostDurumu(h.durum)} kucuk />,
    deger: (h) => h.durum,
  },
  {
    anahtar: 'neden',
    baslik: 'Neden',
    aciklama: 'Durumun açıklaması; tam taramada "başarılı".',
    suzgec: 'metin',
    sirala: true,
    hucre: (h) => <Kirp v={h.neden || h.hata} en="max-w-[26rem]" />,
    deger: (h) => h.neden,
  },
  {
    anahtar: 'playbook_etiket',
    baslik: 'Playbook',
    aciklama: 'AWX işinin bu sunucu için bildirdiği sonuç.',
    suzgec: 'secim',
    sirala: true,
    hucre: (h) => (
      <span title={h.playbook_durum || ''}>{h.playbook_etiket || h.playbook_durum || '—'}</span>
    ),
    deger: (h) => h.playbook_etiket,
  },
  {
    anahtar: 'uygulama_sayisi',
    baslik: 'Uygulama',
    aciklama: 'Bulunan uygulama sayısı.',
    suzgec: 'sayi',
    sirala: true,
    hucre: (h) => (h.veri_var ? say(h.uygulama_sayisi) : '—'),
    deger: (h) => (h.veri_var ? h.uygulama_sayisi : null),
  },
  {
    anahtar: 'eksik_uygulama',
    baslik: 'Eksik',
    aciklama: 'Tam taranamayan uygulama sayısı.',
    suzgec: 'sayi',
    sirala: true,
    hucre: (h) => (h.eksik_uygulama ? <b>{say(h.eksik_uygulama)}</b> : '0'),
    deger: (h) => h.eksik_uygulama,
  },
  {
    anahtar: 'war_sayisi',
    baslik: 'WAR',
    aciklama: 'Bulunan WAR sayısı.',
    suzgec: 'sayi',
    sirala: true,
    varsayilan: false,
    hucre: (h) => (h.veri_var ? say(h.war_sayisi) : '—'),
    deger: (h) => (h.veri_var ? h.war_sayisi : null),
  },
  {
    anahtar: 'sure_sn',
    baslik: 'Süre (sn)',
    aciklama: 'Taramanın sürdüğü saniye.',
    suzgec: 'sayi',
    sirala: true,
    hucre: (h) => (h.sure_sn == null ? '—' : h.sure_sn.toFixed(1)),
    deger: (h) => h.sure_sn,
  },
  {
    anahtar: 'python',
    baslik: 'Python',
    aciklama: 'Hedefteki Python sürümü.',
    suzgec: 'secim',
    sirala: true,
    varsayilan: false,
    hucre: (h) => h.python || '—',
    deger: (h) => h.python,
  },
  {
    anahtar: 'kullanici',
    baslik: 'Kimlik',
    aciklama: 'Taramanın okuduğu kullanıcı (dzdo).',
    suzgec: 'secim',
    sirala: true,
    varsayilan: false,
    hucre: (h) => h.kullanici || '—',
    deger: (h) => h.kullanici,
  },
  {
    anahtar: 'veri',
    baslik: 'Veri',
    aciklama: 'Ekrandaki veri bu koşudan mı, öncekinden mi.',
    suzgec: 'secim',
    sirala: true,
    secenekler: [
      { deger: 'güncel', etiket: 'güncel' },
      { deger: 'eski', etiket: 'eski (önceki koşu)' },
      { deger: 'hiç veri yok', etiket: 'hiç veri yok' },
    ],
    hucre: (h) =>
      h.veri_kosu_id == null ? (
        <span style={{ color: 'var(--status-danger-text)' }}>hiç veri yok</span>
      ) : h.veri_kosu_id !== h.kosu_id ? (
        <span
          style={{ color: 'var(--status-warning-text)' }}
          title="Son taramada veri gelmedi; ekranda önceki koşunun verisi var."
        >
          eski · koşu #{h.veri_kosu_id}
        </span>
      ) : (
        `koşu #${h.kosu_id}`
      ),
    deger: veriDurumu,
  },
  {
    anahtar: 'taranma_utc',
    baslik: 'Taranma',
    aciklama: 'Son verinin toplandığı zaman.',
    suzgec: 'tarih',
    sirala: true,
    hucre: (h) => (
      <span title={h.taranma_utc ? fmtDateTime(h.taranma_utc) : ''}>{yasMetni(h.taranma_utc)}</span>
    ),
    deger: (h) => h.taranma_utc,
  },
];

export function SunucularGorunum({
  hostlar: verilen,
  onTara,
}: {
  hostlar?: EarHost[];
  onTara?: TaraAc;
}) {
  const [l, setL] = useState<EarHost[] | null>(verilen || null);
  const [hata, setHata] = useState('');
  const [tazele, setTazele] = useState(0);
  useAsyncEffect(
    async (alive) => {
      if (verilen) return setL(verilen);
      setHata('');
      try {
        const r = await earApi.hostlar();
        if (alive()) setL(r.hostlar);
      } catch (e) {
        if (alive()) setHata(e instanceof Error ? e.message : String(e));
      }
    },
    [verilen, tazele],
  );
  if (hata)
    return (
      <LoadError
        title="Sunucu listesi okunamadı"
        message={hata}
        onRetry={() => setTazele((n) => n + 1)}
        compact
      />
    );
  if (!l) return <Yukleniyor />;
  return (
    <div className="space-y-2">
      {!verilen && (
        <NeNedir>
          Taranan her sunucunun son durumu ve nedeni. Sorunlu olanları seçip yeniden
          tarayabilirsiniz.
        </NeNedir>
      )}
      <EarTablo<EarHost>
        kimlik={verilen ? 'ear-kosu-sunuculari' : 'ear-sunucular'}
        kolonlar={SUNUCU_KOLONLARI}
        satirlar={l}
        satirAnahtari={(h) => `${h.kosu_id}-${h.host}`}
        secimEylemleri={
          onTara ? (s) => <SeciliTara hostlar={s.map((h) => h.host)} onTara={onTara} /> : undefined
        }
        csvAdi="ear-envanter_sunucular_secili"
        araEtiketi="sunucu / neden ara"
        ustSag={
          !verilen ? <IndirBag href={earIndir.csv('sunucular')}>Sunucular CSV</IndirBag> : undefined
        }
      />
    </div>
  );
}

// ── KOSULAR ─────────────────────────────────────────────────────────────────────────────────────
function KosuAyrinti({ id, onTara }: { id: number; onTara?: TaraAc }) {
  const [d, setD] = useState<{ partiler: EarParti[]; hostlar: EarHost[] } | null>(null);
  const [hata, setHata] = useState('');
  useAsyncEffect(
    async (alive) => {
      try {
        const r = await earApi.kosu(id);
        if (alive()) setD({ partiler: r.partiler, hostlar: r.hostlar });
      } catch (e) {
        if (alive()) setHata(e instanceof Error ? e.message : String(e));
      }
    },
    [id],
  );
  if (hata) return <LoadError title="Koşu ayrıntısı okunamadı" message={hata} compact />;
  if (!d) return <Yukleniyor />;
  return (
    <div className="space-y-2 py-2">
      <div className="flex flex-wrap gap-1">
        {d.partiler.map((p) => (
          <span
            key={p.parti_no}
            className="inline-flex items-center gap-1 text-[11px]"
            title={p.hata || ''}
          >
            #{p.parti_no} <Rozet d={partiDurumu(p.durum)} kucuk />
            {p.awx_job_id != null && (
              <span style={{ color: 'var(--text-muted)' }}>AWX {p.awx_job_id}</span>
            )}
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <IndirBag href={earIndir.zip(id)}>Bu koşunun ZIP'i</IndirBag>
      </div>
      <SunucularGorunum hostlar={d.hostlar} onTara={onTara} />
    </div>
  );
}

const kaynakOf = (k: EarKosu) => kaynakEtiketi(k.kaynak, k.zamanlayici_anahtari);
const KOSU_KOLONLARI: EarKolon<EarKosu>[] = [
  {
    anahtar: 'id',
    baslik: '#',
    aciklama: 'Koşu numarası.',
    suzgec: 'sayi',
    sirala: true,
    hucre: (k) => k.id,
    deger: (k) => k.id,
  },
  {
    anahtar: 'kaynak',
    baslik: 'Kaynak',
    aciklama: 'Plan 1 / plan 2 (otomatik), elle ya da AWX (Limit) ile başlatıldı.',
    suzgec: 'secim',
    sirala: true,
    hucre: kaynakOf,
    deger: kaynakOf,
  },
  {
    anahtar: 'kip',
    baslik: 'Kip',
    aciklama: 'ÖZET ya da TAM.',
    suzgec: 'secim',
    sirala: true,
    hucre: (k) => (k.kip === 'TAM' ? 'TAM' : 'ÖZET'),
    deger: (k) => (k.kip === 'TAM' ? 'TAM' : 'ÖZET'),
  },
  {
    anahtar: 'kapsam',
    baslik: 'Kapsam',
    aciklama: 'Hangi sunucular istendi.',
    suzgec: 'secim',
    sirala: true,
    hucre: (k) =>
      (
        ({ FILO: 'filo', SECILI: 'seçili', ORTAM: 'ortam', SORUNLU: 'sorunlular' }) as Record<
          string,
          string
        >
      )[k.kapsam] || k.kapsam,
    deger: (k) =>
      (
        ({ FILO: 'filo', SECILI: 'seçili', ORTAM: 'ortam', SORUNLU: 'sorunlular' }) as Record<
          string,
          string
        >
      )[k.kapsam] || k.kapsam,
  },
  {
    anahtar: 'durum',
    baslik: 'Durum',
    aciklama: 'Koşunun sonucu.',
    suzgec: 'secim',
    secenekler: secenekleri(DURUM_TABLOLARI.KOSU),
    sirala: true,
    hucre: (k) => (
      <span title={k.hata || ''}>
        <Rozet d={kosuDurumu(k.durum)} kucuk />
      </span>
    ),
    deger: (k) => k.durum,
  },
  {
    anahtar: 'beklenen',
    baslik: 'Beklenen',
    aciklama: 'Taranması istenen sunucu sayısı.',
    suzgec: 'sayi',
    sirala: true,
    hucre: (k) => say(k.beklenen),
    deger: (k) => k.beklenen,
  },
  {
    anahtar: 'tam',
    baslik: 'Tam',
    aciklama: 'Eksiksiz taranan sunucu.',
    suzgec: 'sayi',
    sirala: true,
    hucre: (k) => say(k.tam),
    deger: (k) => k.tam,
  },
  {
    anahtar: 'kismi',
    baslik: 'Kısmi',
    aciklama: 'Eksik taranan sunucu.',
    suzgec: 'sayi',
    sirala: true,
    hucre: (k) => say(k.kismi),
    deger: (k) => k.kismi,
  },
  {
    anahtar: 'kok_yok',
    baslik: 'Kök yok',
    aciklama: '/vhosting ve /vhosting8 olmayan sunucu.',
    suzgec: 'sayi',
    sirala: true,
    hucre: (k) => say(k.kok_yok),
    deger: (k) => k.kok_yok,
  },
  {
    anahtar: 'basarisiz',
    baslik: 'Başarısız',
    aciklama: 'Sonuç vermeyen sunucu.',
    suzgec: 'sayi',
    sirala: true,
    hucre: (k) => say(k.basarisiz),
    deger: (k) => k.basarisiz,
  },
  {
    anahtar: 'baslatan',
    baslik: 'Başlatan',
    aciklama: 'Koşuyu başlatan.',
    suzgec: 'secim',
    sirala: true,
    hucre: (k) => <Kirp v={k.baslatan} en="max-w-[9rem]" />,
    deger: (k) => k.baslatan,
  },
  {
    anahtar: 'created_at',
    baslik: 'Başladı',
    aciklama: 'Başlama zamanı.',
    suzgec: 'tarih',
    sirala: true,
    hucre: (k) => fmtDateTime(k.created_at),
    deger: (k) => k.created_at,
  },
  {
    anahtar: 'finished_at',
    baslik: 'Bitti',
    aciklama: 'Bitiş zamanı.',
    suzgec: 'tarih',
    sirala: true,
    hucre: (k) => (k.finished_at ? fmtDateTime(k.finished_at) : '—'),
    deger: (k) => k.finished_at,
  },
];

export function KosularGorunum({ tazeleme, onTara }: { tazeleme: number; onTara?: TaraAc }) {
  const [l, setL] = useState<EarKosu[] | null>(null);
  const [hata, setHata] = useState('');
  const [tazele, setTazele] = useState(0);
  useAsyncEffect(
    async (alive) => {
      setHata('');
      try {
        const r = await earApi.kosular(100);
        if (alive()) setL(r.kosular);
      } catch (e) {
        if (alive()) setHata(e instanceof Error ? e.message : String(e));
      }
    },
    [tazeleme, tazele],
  );
  if (hata)
    return (
      <LoadError
        title="Koşular okunamadı"
        message={hata}
        onRetry={() => setTazele((n) => n + 1)}
        compact
      />
    );
  if (!l) return <Yukleniyor />;
  return (
    <div className="space-y-2">
      <NeNedir>
        Tarama geçmişi (son 100 koşu): otomatik plan, elle ya da AWX'ten başlatılan koşular. Satırı
        açınca partiler ve sunucular gelir.
      </NeNedir>
      <EarTablo<EarKosu>
        kimlik="ear-kosular"
        kolonlar={KOSU_KOLONLARI}
        satirlar={l}
        satirAnahtari={(k) => String(k.id)}
        acilir={(k) => <KosuAyrinti id={k.id} onTara={onTara} />}
        araEtiketi="koşu ara"
      />
    </div>
  );
}
