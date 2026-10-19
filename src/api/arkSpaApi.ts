// src/api/arkSpaApi.ts — Nginx ARK SPA Raporu uçları.
import type { SpaYukOlcumu } from './denetimApi';

/** Yük ölçümü: Denetim > Nginx SPA ve Production Taşımaları ile AYNI biçim ve kural
 *  (server/audit/nginx-migration.cjs spaTrafikDurumu). 'idle' yalnız 7 günün tamamı ve
 *  tanımın her sunucusu ölçülmüşken gelir. */
export type ArkYuk = SpaYukOlcumu;

export interface ArkSatir {
  service: string;
  env: string;
  namespace: string;
  application: string;
  location: string;
  hosts: string[];
  vhosts: string[];
  team: string[];
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

/** Glomo Geçiş Planı (2026-10-13): set = çalışma (Excel'deki Çalışma-N). */
export interface GecisSet {
  no: number;
  /** 'YYYY-MM-DDTHH:mm' (TR saati, girildiği gibi) ya da null. */
  calismaAt: string | null;
  ocoNo: string;
}
export interface GecisUygulama {
  namespace: string;
  application: string;
  setNo: number;
  /** 'excel' = takvimden; 'portal' = canlı Glomo envanterinde olup Excel'de olmayan (Set 7'ye eklendi). */
  kaynak: 'excel' | 'portal' | string;
  kullanimda: 'yes' | 'no' | null;
  /** Çalışmaya katılacak kişi(ler). Tabloyu dolduranın adı TUTULMAZ. */
  katilimci: string;
  gecti: boolean;
  /** 'YYYY-MM-DD' ya da null. */
  gecisTarihi: string | null;
  /** "Kontrol Ettim" anı (ISO, UTC) ya da null. Kimin bastığı TUTULMAZ. */
  kontrolAt: string | null;
  ekip: string[];
  /** Ekip e-postalari (namespace sahibi tablosundan; yoksa bos). */
  ekipEposta?: string[];
  locations: string[];
  yuk: { state: 'active' | 'idle' | 'unknown'; req7: number } | null;
  /** Canlı Glomo envanterinde görülmüyor (rapor okunduysa). */
  taramadaYok: boolean;
}
export interface GecisPlani {
  ok: boolean;
  message?: string;
  raporVar?: boolean;
  raporTarihi?: string | null;
  /** Namespace sahibi (e-posta) tablosu okunabildi mi. */
  epostaVar?: boolean;
  sets?: GecisSet[];
  apps?: GecisUygulama[];
  admin?: boolean;
  /** Set 7 talep listesinde olup planda bulunamayanlar (2026-10-16; ekranda yalnız Admin'e). */
  talepEslesmeyen?: { namespace: string; application: string }[];
  /** Tek seferlik Set 7 taşımasının durumu; `hata` yalnız Admin yanıtında. */
  goc?: { ad: string; uygulandi: boolean; hata?: string | null };
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
  hesaplandi?: string | null;
  cached?: boolean;
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
  }): Promise<{ ok: boolean; message?: string; inUseBy?: string | null; inUseAt?: string | null }> =>
    fetch(`${BASE}/intranet/declare`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    }).then(safeJson),
  gecis: (): Promise<GecisPlani> => fetch(`${BASE}/gecis`).then(safeJson),
  gecisApp: (p: { namespace: string; application: string; kullanimda: 'yes' | 'no' | null; katilimci: string }): Promise<{ ok: boolean; message?: string }> =>
    fetch(`${BASE}/gecis/app`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then(safeJson),
  gecisKontrol: (p: { namespace: string; application: string; kontrol: boolean }): Promise<{ ok: boolean; message?: string; kontrolAt?: string | null }> =>
    fetch(`${BASE}/gecis/app-kontrol`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then(safeJson),
  gecisSet: (p: { no: number; calismaAt: string | null; ocoNo: string }): Promise<{ ok: boolean; message?: string }> =>
    fetch(`${BASE}/gecis/set`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then(safeJson),
};
