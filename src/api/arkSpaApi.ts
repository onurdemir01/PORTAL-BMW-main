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
  gecis: (): Promise<GecisPlani> => fetch(`${BASE}/gecis`).then(safeJson),
  gecisApp: (p: { namespace: string; application: string; kullanimda: 'yes' | 'no' | null; katilimci: string }): Promise<{ ok: boolean; message?: string }> =>
    fetch(`${BASE}/gecis/app`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then(safeJson),
  gecisAppAdmin: (p: { namespace: string; application: string; setNo?: number; gecti?: boolean; gecisTarihi?: string | null }): Promise<{ ok: boolean; message?: string }> =>
    fetch(`${BASE}/gecis/app-admin`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then(safeJson),
  gecisSet: (p: { no: number; calismaAt: string | null; ocoNo: string }): Promise<{ ok: boolean; message?: string }> =>
    fetch(`${BASE}/gecis/set`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then(safeJson),
  gecisSetGecti: (no: number, tarih: string | null): Promise<{ ok: boolean; message?: string; guncellenen?: number }> =>
    fetch(`${BASE}/gecis/set/${no}/gecti`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tarih }) }).then(safeJson),
};
