// src/api/arkSpaApi.ts — Nginx ARK SPA Raporu uçları.
export interface ArkYuk {
  state: 'active' | 'idle' | 'unknown';
  req7: number | null;
  req24: number | null;
  sampled: boolean;
  lastSeen: string | null;
  hosts: number;
  unknownHosts: number;
}

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
};
