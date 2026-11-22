// src/components/nginx_console/rvpSecim.ts — "Uygulamam hangi Nginx sunucusundan reverse proxy
// hizmeti almali?" sihirbazinin VERISI ve KARAR TABLOSU (kullanici, 2026-10-05).
//
// Sunucu ustverisi kullanicinin ilettigi Nginx envanteri Excel'inden birebir alinmistir
// (kolonlar: Tip, Ortam, Lokasyon, Sunucu, Domain, Subnet, Nginx surumu, Amac). Subnet kurum ic agidir
// ve repoda TUTULMAZ (public repo, 2026-11-15): ekran onu NGINX_RVP_ALT_AGLARI ayarindan okur.
//
// ONERI MOTORU YALNIZ KULLANICININ SAYDIGI SUNUCULARI VERIR (karar, 2026-10-05). Excel'de olup
// burada OLMAYANLAR bilerek disaridadir:
//   - Edu asamasi (ORNGXT39/40/41/42, intranet ORNGXT51) ve Ankara QA intranet (ORNGXAQ50),
//   - Ankara'nin sunucu adi olmayan "Hazir degil" satirlari,
//   - Internet API tipi ORNGXT07 — 2026-10-01'de onayli reverse proxy listesinin DISINDA birakildi.
// Bir kutuya sunucu eklenecekse once kullaniciya sorulur; bu dosyaya kendiliginden sunucu eklenmez.
//
// AMAC KOLONU ILE KULLANICININ ETIKETI AYRISABILIR: ARK + internet + Non-Glomo'nun production
// karsiligi kullanicinin kararina gore ORNGXP44/45/58/59 + ORNGXAP32/33'tur (2026-11-12: kapatilan ORNGXAP28/29
// yerine kullanicinin onayiyla; alt ag Ankara DMZ blogu varsayildi); Excel bu sunuculari
// "Production -> CSO Internet" diye etiketler. Karar kullanicinindir, `amac` alani Excel'in kendi
// metnini AYNEN tasir (ekranda ikisi birden gorunur, biri digerini gizlemez).

/** Backend uygulamanin kostugu yer. */
export type RvpBackend = 'ark' | 'hosting' | 'hicbiri';
/** Uygulama kime hizmet edecek. */
export type RvpKitle = 'internet' | 'intranet';
/** ARK + internet dalinda Glomo ayrimi. */
export type RvpGlomo = 'glomo' | 'nonglomo';
/** Non-production ortami da internete acilacak mi. */
export type RvpNprAcik = 'evet' | 'hayir';

export interface RvpSunucu {
  host: string;
  lokasyon: 'Pendik' | 'Ankara';
  domain: string;
  surum: string;
  /** Excel "Amac" kolonu, AYNEN. */
  amac: string;
}

/**
 * Kurum ayari `nginx.rvp` (sunucu adlari ve ic alan adi repoda degil, K17; sunucu GET /rvp-alt-aglari ile
 * verir). `kutular` karar tablosunun her kutusunun sunuculari, `sunucular` Excel'den alinan ustveri.
 */
export type RvpKutu =
  | 'arkInternetNprAcik'
  | 'nprKapali'
  | 'arkInternetProd'
  | 'arkIntranetNpr'
  | 'arkIntranetProd'
  | 'hostingInternetNprAcik'
  | 'hostingInternetProd';
export interface RvpAyari {
  /** Iç domain (non-prod internete acilmayan havuz ve intranet RP'leri). */
  icAlan: string;
  sunucular: Record<string, Omit<RvpSunucu, 'host'>>;
  kutular: Partial<Record<RvpKutu, string[]>>;
}
export const BOS_RVP_AYARI: RvpAyari = { icAlan: '', sunucular: {}, kutular: {} };

/** Ustveriyi olmayan sunucu icin UYDURMAZ: bilinmeyen ad ekranda apacik gorunur. */
export function rvpSunucu(host: string, ayar: RvpAyari = BOS_RVP_AYARI): RvpSunucu {
  const u = ayar.sunucular[host];
  return u ? { host, ...u } : { host, lokasyon: 'Pendik', domain: '?', surum: '?', amac: '' };
}

/** Kutunun sunuculari; ayarda yoksa kutu TANIMSIZ (bos liste "sunucu yok" demek olurdu). */
function kutu(ayar: RvpAyari, ad: RvpKutu, not?: string): RvpBlok {
  const hosts = ayar.kutular[ad] || [];
  if (!hosts.length)
    return {
      durum: 'tanimsiz',
      sunucular: [],
      not: `Kurum ayarında bu kutunun sunucuları yok (nginx.rvp.kutular.${ad}).`,
    };
  return {
    durum: 'sunucu',
    sunucular: hosts.map((h) => rvpSunucu(h, ayar)),
    ...(not ? { not } : {}),
  };
}
const icAlanMetni = (ayar: RvpAyari) => (ayar.icAlan ? ` (${ayar.icAlan})` : '');

/** Self Servis > "Nginx - RVP Operations" otomasyonu (RVP tanimlari YALNIZ ARK cluster'i icin). */
export const RVP_YOLU = '/self-service/nginx-rvp-operations';
export const GT_EKIP = 'GT Agile BMW';

export interface RvpBlok {
  /** 'sunucu' = liste dolu; 'tanimsiz' = bu kutunun karsiligi HENUZ YOK (bos liste DEGIL). */
  durum: 'sunucu' | 'tanimsiz';
  sunucular: RvpSunucu[];
  not?: string;
}
export interface RvpOneri {
  /** 'sunucu' = ortam bloklari dolu; 'rvp' = RVP kaydina yonlendir; 'ekip' = ekibe danis. */
  durum: 'sunucu' | 'rvp' | 'ekip';
  baslik: string;
  aciklama: string;
  nonProd?: RvpBlok;
  prod?: RvpBlok;
  /** durum 'rvp' iken Self Servis yolu. */
  rvpYolu?: string;
}

export interface RvpSecim {
  backend?: RvpBackend;
  kitle?: RvpKitle;
  glomo?: RvpGlomo;
  nprAcik?: RvpNprAcik;
}

/**
 * Sihirbazin SIRADAKI sorusu; null = karar verilebilir. Soru sirasi kararin kendisinin parcasi
 * oldugu icin burada (saf fonksiyon) yasar, ekranda degil.
 *
 * - 'kitle' yalniz backend secildiginde ve 'hicbiri' DEGILSE sorulur.
 * - 'glomo' yalniz ARK + internet'te sorulur (Hosting'de Glomo ayrimi yok).
 * - 'nprAcik' yalniz internet dalinda ve Glomo DISINDA sorulur: Glomo her halde RVP kaydina gider,
 *   intranet'te ise non-prod ortami zaten internete acilmaz.
 */
export function rvpSiradakiSoru(s: RvpSecim): 'backend' | 'kitle' | 'glomo' | 'nprAcik' | null {
  if (!s.backend) return 'backend';
  if (s.backend === 'hicbiri') return null;
  if (!s.kitle) return 'kitle';
  if (s.backend === 'ark' && s.kitle === 'internet' && !s.glomo) return 'glomo';
  if (s.kitle === 'internet' && !(s.backend === 'ark' && s.glomo === 'glomo') && !s.nprAcik)
    return 'nprAcik';
  return null;
}

/** Karar tablosu (kullanici, 2026-10-05). Eksik secimde null doner — ekran soruyu sormaya devam eder. */
export function rvpOner(s: RvpSecim, ayar: RvpAyari = BOS_RVP_AYARI): RvpOneri | null {
  if (rvpSiradakiSoru(s) !== null) return null;

  if (s.backend === 'hicbiri')
    return {
      durum: 'ekip',
      baslik: `${GT_EKIP} ekibiyle iletişime geçin`,
      aciklama:
        'Backend uygulaması ARK ya da Hosting üzerinde koşmuyorsa reverse proxy hizmetinin nereden ' +
        'verileceği bu sayfadaki kutulardan birine düşmüyor. Uygulamanın nerede koştuğunu ve kime ' +
        `hizmet edeceğini yazarak ${GT_EKIP} ekibine danışın.`,
    };

  const internet = s.kitle === 'internet';

  if (s.backend === 'ark' && internet && s.glomo === 'glomo')
    return {
      durum: 'rvp',
      baslik: 'Glomo: RVP kaydı açılmalı',
      aciklama:
        'Glomo uygulamaları için bu sayfada sunucu seçilmez; tanım Self Servis üzerindeki ' +
        '"Nginx - RVP Operations" otomasyonuyla yapılır (RVP tanımları yalnız ARK cluster’ı içindir).',
      rvpYolu: RVP_YOLU,
    };

  if (s.backend === 'ark' && internet)
    return {
      durum: 'sunucu',
      baslik: 'ARK · internete açılacak · Non-Glomo',
      aciklama:
        'Uygulama müşteri ortamına / dijital kanallara hizmet edecek ve Glomo değil. Non-production ' +
        'sunucuları, o ortamın da internete açılıp açılmayacağına göre değişir.',
      nonProd:
        s.nprAcik === 'evet'
          ? kutu(ayar, 'arkInternetNprAcik')
          : kutu(
              ayar,
              'nprKapali',
              `Non-production ortamı internete açılmayacak: bu havuz iç domainde${icAlanMetni(ayar)} ` +
                'durur. Aşama sırası Dev → T14/T15, Test → T16/T17, QA → T18/T19, Edu → T20/T21.',
            ),
      prod: kutu(ayar, 'arkInternetProd'),
    };

  if (s.backend === 'ark')
    return {
      durum: 'sunucu',
      baslik: 'ARK · intranet',
      aciklama:
        'Uygulama kurum içine hizmet edecek (Step, Connect, Corpus gibi). Reverse proxy katmanı ' +
        `iç domainde${icAlanMetni(ayar)} durur.`,
      nonProd: kutu(ayar, 'arkIntranetNpr'),
      prod: kutu(ayar, 'arkIntranetProd'),
    };

  if (internet)
    return {
      durum: 'sunucu',
      baslik: 'Hosting · internete açılacak',
      aciklama:
        'Backend Hosting üzerinde koşuyor ve uygulama internete açılacak. Non-production sunucusu, ' +
        'o ortamın da internete açılıp açılmayacağına göre değişir.',
      nonProd:
        s.nprAcik === 'evet'
          ? kutu(ayar, 'hostingInternetNprAcik')
          : kutu(
              ayar,
              'nprKapali',
              `Non-production ortamı internete açılmayacak: iç domaindeki${icAlanMetni(ayar)} havuz ` +
                'kullanılır. Aşama sırası Dev → T14/T15, Test → T16/T17, QA → T18/T19, Edu → T20/T21.',
            ),
      prod: kutu(ayar, 'hostingInternetProd'),
    };

  // Hosting + intranet: PRODUCTION KARSILIGI HENUZ TANIMLI DEGIL (kullanici, 2026-10-05:
  // "suan bu sorunun karsiligi yok haber verecegim"). Bos liste basmak "sunucu yok" demek
  // olurdu; kutu AYRI bir durumla, sebebi yazili olarak gosterilir.
  return {
    durum: 'sunucu',
    baslik: 'Hosting · intranet',
    aciklama:
      'Backend Hosting üzerinde koşuyor ve uygulama kurum içine hizmet edecek. Non-production için ' +
      'iç domaindeki havuz kullanılır; production karşılığı henüz tanımlı değil.',
    nonProd: kutu(ayar, 'nprKapali'),
    prod: {
      durum: 'tanimsiz',
      sunucular: [],
      not:
        'Bu kutunun production karşılığı HENÜZ TANIMLI DEĞİL — "sunucu yok" demek değildir. ' +
        `Production tanımı gerekiyorsa ${GT_EKIP} ekibine danışın.`,
    },
  };
}
