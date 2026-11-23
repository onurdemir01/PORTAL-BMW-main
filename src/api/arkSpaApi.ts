// src/api/arkSpaApi.ts — Nginx ARK SPA Raporu uçları.
import type { SpaYukOlcumu } from './denetimApi';

/** Yük ölçümü: Denetim > Nginx SPA ve Production Taşımaları ile AYNI biçim ve kural
 *  (server/audit/nginx-migration.cjs spaTrafikDurumu). 'idle' yalnız 7 günün tamamı ve
 *  tanımın her sunucusu ölçülmüşken gelir. */
export type ArkYuk = SpaYukOlcumu;

export interface ArkSatir {
  service: string;
  /** Tanımın tüm sunucuları 'Yerine geç' + tek elle etikete sahipse o etiket (Nginx Hub › Envanter). */
  serviceEtiket?: string;
  env: string;
  namespace: string;
  application: string;
  location: string;
  hosts: string[];
  vhosts: string[];
  team: string[];
  /** team ile AYNI SIRADA kaynak (SI51_AGILE … / NAMESPACE = namespace sahibi); boş = bilinmiyor. */
  teamKaynak?: string[];
  /** Namespace sahiplik tablosu okunamadı ve uygulamanın kendi sahibi yok: "veri yok" (≠ bilinmiyor). */
  teamVeriYok?: boolean;
  /** ÖLÇÜM. Beyandan ayrıdır ve biri diğerini ezmez. null = bu location hiç ölçülmedi. */
  traffic: ArkYuk | null;
  /** EKİBİN BEYANI. null = ekip beyan etmemiş ("kullanmıyor" DEĞİL). */
  inUse: string | null;
  inUseBy: string | null;
  /** Beyanın girildiği an (ISO). Eski bir beyan bugünkü kadar güvenilir değildir. */
  inUseAt: string | null;
  note: string;
  /**
   * Beyan HANGİ SEVİYEDEN geldi (2026-10-01):
   *   'location'    = bu satıra özel beyan
   *   'application' = SPA Taşımaları'ndaki uygulama beyanı DEVRALINDI
   *   null          = beyan yok
   * Devralınmış bir beyanı satırın kendi beyanı gibi göstermek, "birine yazdım hepsine
   * işlendi" izlenimini sürdürürdü.
   */
  inUseScope: 'location' | 'application' | null;
}

export interface ArkServis {
  service: string;
  rows: number;
  apps: number;
  declared: number;
}

export interface ArkRapor {
  ok: boolean;
  message?: string;
  notScanned?: boolean;
  scanDate?: string | null;
  ownersReady?: boolean;
  trafficReady?: boolean;
  rows?: ArkSatir[];
  services?: ArkServis[];
  skipped?: number;
  cached?: boolean;
}

/** Intranet SPA (2026-10-19): Gerçek SPA Keşfi'nin intranet SPA'sı + Dynatrace kullanımı + ekip beyanı.
 *  Dynatrace (BMW_Application_Usage, application_usage işi) beş durum, hiçbiri diğerine indirgenmez:
 *  var | yok (her cluster ölçüldü, 0) | servis-yok (sayılamaz) | olculemedi | olcum-yok. */
export type IntranetIstek = 'var' | 'yok' | 'servis-yok' | 'olculemedi' | 'olcum-yok';
export type IntranetDegerlendirme =
  | 'kapatma-adayi'
  | 'teyit-bekliyor'
  | 'celiski'
  | 'internet-route-da-var'
  | 'zayif-kanit'
  | 'eski-veri';
export interface IntranetSatir {
  env: string;
  namespace: string;
  application: string;
  /** 'intranet' (reencrypt route) | 'karisik' (intranet + internet route) */
  ag: 'intranet' | 'karisik';
  /** route adresleri */
  adresler: string[];
  clusters: string[];
  /** son koşusu başarısız / eski veriden gelen cluster'lar */
  eskiCluster: string[];
  kapsam: { durum: 'tam' | 'kismi' | 'yok' | 'olculemedi'; var: number; toplam: number };
  zayifKanit: boolean;
  adKalibi: boolean;
  /** ÖLÇÜM (Dynatrace). */
  istek: IntranetIstek;
  /** İstek sayısı — yalnız ölçüldüyse (null = ölçülemedi / ölçüm yok). */
  req: number | null;
  dynatrace: {
    scanDate: string | null;
    windowDays: number | null;
    services: number | null;
    note: string;
    /** yalnız bazı cluster'lar ölçüldüyse 'ölçülen/toplam' */
    olcum: string;
  } | null;
  ekip: string[];
  /** ekip ile AYNI SIRADA kaynak (SI51_AGILE … / NAMESPACE = namespace sahibi); boş = bilinmiyor. */
  ekipKaynak?: string[];
  /** Namespace sahiplik tablosu okunamadı ve uygulamanın kendi sahibi yok: "veri yok" (≠ bilinmiyor). */
  ekipVeriYok?: boolean;
  ekipEposta: string[];
  /** EKİBİN BEYANI — SPA Raporu ve SPA Taşımaları ile AYNI uygulama beyanı. */
  inUse: 'yes' | 'no' | 'unknown' | null;
  inUseBy: string | null;
  inUseAt: string | null;
  note: string;
  degerlendirme: IntranetDegerlendirme[];
  /** Kendi ortamının intranet nginx sunucularındaki kurulum (Nginx_Intranet_Audit). */
  kurulum: IntranetKurulum;
}
/** tamam = ortamın TARANAN her intranet sunucusunda paket + dosyalar + conf var; taranmayan sunucu
 *  eksik sayılmaz (taranmayan listesinde). */
export interface IntranetKurulum {
  durum: 'tamam' | 'kismi' | 'yok' | 'olculemedi' | 'sunucu-yok';
  tam: number;
  beklenen: number;
  sunucular: {
    host: string;
    site: string;
    /** /hysdeploy/<ns>/<app>/ */
    hys: boolean;
    /** /usr/nginx/applications/<ns>/<app>/ */
    app: boolean;
    /** application-confs/<app>-<ns>.conf */
    conf: boolean;
    /** OK | MISSING_CONF | MISSING_APP | MISSING_HYS | ONLY_* | YOK (o sunucuda hiç izi yok) */
    status: string;
  }[];
  eksik: string[];
  taranmayan: string[];
  /** 'kesin' | 'ek-prod' (dizin namespace'i '-prod' eksiz) | '' */
  eslesme: string;
}
export interface IntranetOrtam {
  env: string;
  uygulama: number;
  var: number;
  yok: number;
  servisYok: number;
  olculemedi: number;
  olcumYok: number;
  beyanli: number;
  kapatmaAdayi: number;
  celiski: number;
  kurulumTamam: number;
  kurulumKismi: number;
  kurulumYok: number;
}
export interface IntranetRapor {
  ok: boolean;
  message?: string;
  notScanned?: boolean;
  ownersReady?: boolean;
  kesifTarihi?: string | null;
  dynatraceTarihi?: string | null;
  dynatraceOkunamadi?: boolean;
  rows?: IntranetSatir[];
  envs?: IntranetOrtam[];
  sorunluCluster?: { cluster: string; durum: string; sebep: string }[];
  /** Intranet dizin taraması: 'var' | 'okunamadi' */
  dizinDurum?: 'var' | 'okunamadi';
  dizinTarihi?: string | null;
  /** Son dizin taramasında satırı olmayan intranet sunucuları */
  taranmayanSunucu?: string[];
  /** Satırlar bu platformun cluster'larından (Nginx Hub > Kapsam & Taşıma ile aynı küme). */
  platform?: string;
  /** Platform dışında kalan intranet SPA'lar: platform (ya da 'bilinmiyor' / 'cluster-yok') + cluster'lar. */
  platformDisi?: { platform: string; uygulama: number; clusters: string[] }[];
  hesaplandi?: string | null;
  cached?: boolean;
}

/** Intranet SPA paket kurulumu (2026-11-23): PROD intranet Nginx'e gelmeyen paketi Artifactory'den
 *  kurma; application.json uygulamanin route'undaki /config'ten (bastionsuz). Uyari kodlari sunucuda
 *  (engel olanlar kurulumu durdurur; 'bayat' 3 saatten eski PROD okumasi ve 'config-adresi-yok' ENGEL,
 *  'taranmayan' ve 'config-adresi-elendi' engel DEGIL). Liste server/spa-report/paket-kurulum.cjs UYARI_KODLARI ile birebir
 *  (sunucu testi PK13 karsilastirir). */
export const PAKET_UYARI_KODLARI = [
  'ad-gecersiz',
  'katalog-yok',
  'surum-yok',
  'surum-farkli',
  'imaj-yolu-farkli',
  'etiketsiz',
  'bayat',
  'config-adresi-yok',
  'config-adresi-elendi',
  'hedef-yok',
  'hedef-fazla',
  'taranmayan',
  'yakin-zamanda-kuruldu',
] as const;
export type PaketUyariKod = (typeof PAKET_UYARI_KODLARI)[number];

export interface PaketUyari {
  kod: PaketUyariKod;
  metin: string;
  engel: boolean;
}

export type PaketSunucuDurum = 'PLAN_OK' | 'OK' | 'SKIP' | 'FAIL';

export interface PaketSonDeneme {
  zaman: string;
  kullanici: string;
  mod: 'plan' | 'apply';
  jobId: number | string;
  serverId: number | string;
  sunucular: { host: string; status: PaketSunucuDurum | string; message: string }[];
}

export interface PaketAday {
  namespace: string;
  application: string;
  env: 'PROD';
  /** OCP imaj etiketi (paket surumu) */
  surum: string | null;
  /** Tam imaj adresi */
  imaj: string | null;
  cluster: string | null;
  clusters: string[];
  /** OCP okuma zamani */
  alinma: string | null;
  hedefler: string[];
  taranmayan: string[];
  uyarilar: PaketUyari[];
  kurulabilir: boolean;
  sonDeneme: PaketSonDeneme | null;
}

export interface PaketAdaylarYanit {
  ok: boolean;
  message?: string;
  error?: string;
  hesaplandi?: string;
  dizinTarihi?: string | null;
  ozet?: { toplam: number; kurulabilir: number };
  adaylar?: PaketAday[];
}

export interface PaketSecim {
  namespace: string;
  application: string;
}

export interface PaketKalem {
  id: string;
  namespace: string;
  application: string;
  version: string;
  cluster: string;
  hosts: string[];
}

export interface PaketKurYanit {
  ok: boolean;
  message?: string;
  error?: string;
  serverId?: number | string;
  jobId?: number | string;
  mod?: 'plan' | 'apply';
  items?: PaketKalem[];
  /** Is basladi ama is gecmisine yazilamadi: kapilar bu isi goremez. */
  uyari?: string;
}

export interface PaketSonucSunucu {
  host: string;
  status: PaketSunucuDurum | string;
  step: string;
  message: string;
}

/** set_stats kalemi: playbook OCP okumadigi icin 'ocp' / 'cluster' alani yok. */
export interface PaketSonucKalem {
  id: string;
  namespace: string;
  application: string;
  version: string;
  hosts: PaketSonucSunucu[];
}

/** set_stats spa_package_install_result */
export interface PaketSonuc {
  mode: 'plan' | 'apply';
  overall: 'ok' | 'partial' | 'failed';
  items: PaketSonucKalem[];
}

export interface PaketIsYanit {
  ok: boolean;
  status?: string;
  finished?: boolean;
  sonuc?: PaketSonuc;
  error?: string;
  message?: string;
}

const BASE = '/api/spa-report';
const safeJson = (r: Response) =>
  r.json().catch(() => ({ ok: false, message: 'Yanıt okunamadı.' }));

export const arkSpaApi = {
  report: (fresh = false): Promise<ArkRapor> =>
    fetch(`${BASE}${fresh ? '?fresh=1' : ''}`).then(safeJson),
  // LOCATION ZORUNLU GÖNDERİLİR: beyan artık satır bazında. Gönderilmezse sunucu eski
  // davranışa (uygulama seviyesi) düşer ve aynı uygulamanın TÜM location'larını etkiler.
  declare: (p: {
    namespace: string;
    application: string;
    location: string;
    inUse: string | null;
    note: string;
  }): Promise<{
    ok: boolean;
    message?: string;
    inUseBy?: string | null;
    scope?: 'location' | 'application';
  }> =>
    fetch(`${BASE}/declare`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    }).then(safeJson),
  intranet: (fresh = false): Promise<IntranetRapor> =>
    fetch(`${BASE}/intranet${fresh ? '?fresh=1' : ''}`).then(safeJson),
  intranetBeyan: (p: {
    namespace: string;
    application: string;
    inUse: string | null;
    note: string;
  }): Promise<{
    ok: boolean;
    message?: string;
    inUseBy?: string | null;
    inUseAt?: string | null;
  }> =>
    fetch(`${BASE}/intranet/declare`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    }).then(safeJson),
  paketAdaylari: (fresh = false): Promise<PaketAdaylarYanit> =>
    fetch(`${BASE}/intranet/paket/adaylar${fresh ? '?fresh=1' : ''}`).then(safeJson),
  paketKur: (p: {
    secim: PaketSecim[];
    apply: boolean;
    onayMetni?: string;
    /** apply icin zorunlu: dayandigi bitmis plan isi */
    plan?: { serverId: number | string; jobId: number | string };
  }): Promise<PaketKurYanit> =>
    fetch(`${BASE}/intranet/paket/kur`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    }).then(safeJson),
  paketIs: (serverId: number | string, jobId: number | string): Promise<PaketIsYanit> =>
    fetch(
      `${BASE}/intranet/paket/is/${encodeURIComponent(String(serverId))}/${encodeURIComponent(String(jobId))}`,
    ).then(safeJson),
};
