// src/components/nginx_console/rvpSecim.ts — "Uygulamam hangi Nginx sunucusundan reverse proxy
// hizmeti almali?" sihirbazinin VERISI ve KARAR TABLOSU (kullanici, 2026-10-05).
//
// Sunucu ustverisi kullanicinin ilettigi Nginx envanteri Excel'inden birebir alinmistir
// (kolonlar: Tip, Ortam, Lokasyon, Sunucu, Domain, Subnet, Nginx surumu, Amac).
//
// ONERI MOTORU YALNIZ KULLANICININ SAYDIGI SUNUCULARI VERIR (karar, 2026-10-05). Excel'de olup
// burada OLMAYANLAR bilerek disaridadir:
//   - Edu asamasi (GBNGXT39/40/41/42, intranet GBNGXT51) ve Ankara QA intranet (GBNGXAQ50),
//   - Ankara'nin sunucu adi olmayan "Hazir degil" satirlari,
//   - Internet API tipi GBNGXT07 — 2026-10-01'de onayli reverse proxy listesinin DISINDA birakildi.
// Bir kutuya sunucu eklenecekse once kullaniciya sorulur; bu dosyaya kendiliginden sunucu eklenmez.
//
// AMAC KOLONU ILE KULLANICININ ETIKETI AYRISABILIR: ARK + internet + Non-Glomo'nun production
// karsiligi kullanicinin kararina gore GBNGXP44/45/58/59 + GBNGXAP28/29'dur; Excel bu alti sunucuyu
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
  subnet: string;
  surum: string;
  /** Excel "Amac" kolonu, AYNEN. */
  amac: string;
}

/** Excel'den alinan ustveri. Anahtar = sunucu adi. */
const ENV: Record<string, RvpSunucu> = {};
const ekle = (
  host: string,
  lokasyon: 'Pendik' | 'Ankara',
  domain: string,
  subnet: string,
  surum: string,
  amac: string,
) => {
  ENV[host] = { host, lokasyon, domain, subnet, surum, amac };
};

const V129 = '1.29.0 (nginx-plus-r35-p1)';
const DMZ = 'gtdmz.com.tr';
const FW = 'fw.garanti.com.tr';

// ARK / Non-Production / internet SPA + Non-Glomo (non-prod ortami da internete acik)
ekle('GBNGXD02', 'Pendik', DMZ, '192.168.133.0/24', V129, 'Dev → Internet SPA + Non-Glomo Dev');
ekle('GBNGXT34', 'Pendik', DMZ, '192.168.133.0/24', V129, 'Test -> İnternet SPA + Non-Glomo Test');
ekle('GBNGXQ02', 'Pendik', DMZ, '192.168.133.0/24', V129, 'QA -> İnternet SPA + Non-Glomo QA');

// ARK / Non-Production / non-prod ortami internete ACILMAYAN havuz (ic domain)
ekle('GBNGXT14', 'Pendik', FW, '10.230.140.0/22', '1.30.1', 'Internet SPA → Development');
ekle('GBNGXT15', 'Pendik', FW, '10.230.140.0/22', '1.30.1', 'Internet SPA → Development');
ekle('GBNGXT16', 'Pendik', FW, '10.230.140.0/22', '1.30.1', 'Internet SPA → Test');
ekle('GBNGXT17', 'Pendik', FW, '10.230.140.0/22', '1.30.1', 'Internet SPA → Test');
ekle('GBNGXT18', 'Pendik', FW, '10.230.140.0/22', '1.30.1', 'Internet SPA → QA');
ekle('GBNGXT19', 'Pendik', FW, '10.230.140.0/22', '1.30.1', 'Internet SPA → QA');
ekle('GBNGXT20', 'Pendik', FW, '10.230.140.0/22', '1.30.1', 'Internet SPA → Edu');
ekle('GBNGXT21', 'Pendik', FW, '10.230.140.0/22', '1.30.1', 'Internet SPA → Edu');

// ARK / Production / internet (kullanicinin verdigi liste; Excel etiketi "CSO Internet")
ekle('GBNGXP44', 'Pendik', DMZ, '192.168.200.0/23', V129, 'Production -> CSO Internet');
ekle('GBNGXP45', 'Pendik', DMZ, '192.168.200.0/23', V129, 'Production -> CSO Internet');
ekle('GBNGXP58', 'Pendik', DMZ, '192.168.200.0/23', V129, 'Production -> CSO Internet');
ekle('GBNGXP59', 'Pendik', DMZ, '192.168.200.0/23', V129, 'Production -> CSO Internet');
ekle('GBNGXAP28', 'Ankara', DMZ, '192.168.236.0/23', V129, 'Production -> CSO Internet');
ekle('GBNGXAP29', 'Ankara', DMZ, '192.168.236.0/23', V129, 'Production -> CSO Internet');

// ARK / intranet
ekle('GBNGXD50', 'Pendik', FW, '10.175.15.0/24', V129, 'Dev → Intranet');
ekle('GBNGXT50', 'Pendik', FW, '192.168.133.0/24', V129, 'Test -> Intranet');
ekle('GBNGXQ50', 'Pendik', FW, '10.175.15.0/24', V129, 'QA -> Intranet');
ekle('GBNGXP50', 'Pendik', FW, '10.175.96.0/19', V129, 'Production -> Intranet');
ekle('GBNGXP51', 'Pendik', FW, '10.175.96.0/19', V129, 'Production -> Intranet');
ekle('GBNGXP52', 'Pendik', FW, '10.175.96.0/19', V129, 'Production -> Intranet');
ekle('GBNGXP53', 'Pendik', FW, '10.175.96.0/19', V129, 'Production -> Intranet');
ekle('GBNGXAP50', 'Ankara', FW, '10.185.96.0/19', V129, 'Production -> Intranet');
ekle('GBNGXAP51', 'Ankara', FW, '10.185.96.0/19', V129, 'Production -> Intranet');

// Hosting (Excel'de amac kolonu BOS — uydurma etiket yazilmaz)
ekle('GBRNAT01', 'Pendik', DMZ, '192.168.133.0/24', '1.29.3 (nginx-plus-r36-p4)', '');
ekle('GBRNAP01', 'Pendik', DMZ, '192.168.68.0/24', '1.30.1', '');
ekle('GBRNAP02', 'Pendik', DMZ, '192.168.68.0/24', '1.30.1', '');
ekle('GBRNAAP01', 'Ankara', DMZ, '192.168.236.0/23', '1.30.1', '');
ekle('GBRNAAP02', 'Ankara', DMZ, '192.168.236.0/23', '1.30.1', '');

/** Ustveriyi olmayan sunucu icin UYDURMAZ: bilinmeyen ad ekranda apacik gorunur. */
export function rvpSunucu(host: string): RvpSunucu {
  return ENV[host] || { host, lokasyon: 'Pendik', domain: '?', subnet: '?', surum: '?', amac: '' };
}
const liste = (...h: string[]) => h.map(rvpSunucu);

const NPR_KAPALI = [
  'GBNGXT14',
  'GBNGXT15',
  'GBNGXT16',
  'GBNGXT17',
  'GBNGXT18',
  'GBNGXT19',
  'GBNGXT20',
  'GBNGXT21',
];

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
export function rvpOner(s: RvpSecim): RvpOneri | null {
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
          ? { durum: 'sunucu', sunucular: liste('GBNGXD02', 'GBNGXT34', 'GBNGXQ02') }
          : {
              durum: 'sunucu',
              sunucular: liste(...NPR_KAPALI),
              not:
                'Non-production ortamı internete açılmayacak: bu havuz iç domainde ' +
                '(fw.garanti.com.tr) durur. Aşama sırası Dev → T14/T15, Test → T16/T17, ' +
                'QA → T18/T19, Edu → T20/T21.',
            },
      prod: { durum: 'sunucu', sunucular: liste('GBNGXP44', 'GBNGXP45', 'GBNGXP58', 'GBNGXP59', 'GBNGXAP28', 'GBNGXAP29') },
    };

  if (s.backend === 'ark')
    return {
      durum: 'sunucu',
      baslik: 'ARK · intranet',
      aciklama:
        'Uygulama kurum içine hizmet edecek (Step, Connect, Corpus gibi). Reverse proxy katmanı ' +
        'iç domainde (fw.garanti.com.tr) durur.',
      nonProd: { durum: 'sunucu', sunucular: liste('GBNGXD50', 'GBNGXT50', 'GBNGXQ50') },
      prod: { durum: 'sunucu', sunucular: liste('GBNGXP50', 'GBNGXP51', 'GBNGXP52', 'GBNGXP53', 'GBNGXAP50', 'GBNGXAP51') },
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
          ? { durum: 'sunucu', sunucular: liste('GBRNAT01') }
          : {
              durum: 'sunucu',
              sunucular: liste(...NPR_KAPALI),
              not:
                'Non-production ortamı internete açılmayacak: iç domaindeki (fw.garanti.com.tr) ' +
                'havuz kullanılır. Aşama sırası Dev → T14/T15, Test → T16/T17, QA → T18/T19, ' +
                'Edu → T20/T21.',
            },
      prod: { durum: 'sunucu', sunucular: liste('GBRNAP01', 'GBRNAP02', 'GBRNAAP01', 'GBRNAAP02') },
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
    nonProd: { durum: 'sunucu', sunucular: liste(...NPR_KAPALI) },
    prod: {
      durum: 'tanimsiz',
      sunucular: [],
      not:
        'Bu kutunun production karşılığı HENÜZ TANIMLI DEĞİL — "sunucu yok" demek değildir. ' +
        `Production tanımı gerekiyorsa ${GT_EKIP} ekibine danışın.`,
    },
  };
}
