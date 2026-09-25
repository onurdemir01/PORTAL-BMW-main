// src/api/cryptoHubApi.ts — Crypto Hub (2026-09-25): Metaco / Wyden durum + sürüm.
// Sunucu karşılığı: server/crypto-hub/index.cjs
import { safeJson } from './http';

const BASE = '/api/crypto-hub';

export interface CryptoEnvOption {
  key: string;
  env: string;
  label: string;
  production: boolean;
  cluster: string;
  namespace: string;
  /** false = namespace/helm tanımı girilmemiş; tarama bu ortamı atlar */
  ready: boolean;
  /** false = ortam şimdilik kapalı (2026-09-26: production kapatıldı); seçilemez, API de reddeder */
  open: boolean;
}
export interface CryptoDomain { domain: string; label: string; envs: CryptoEnvOption[] }
export interface CryptoApp { app: string; label: string; domains: CryptoDomain[] }

export interface CryptoTenant {
  key: string; app: string; appLabel: string;
  domain: string; domainLabel: string;
  env: string; envLabel: string; production: boolean;
  bastion: string; cluster: string; apiUrl: string;
  namespace: string; helmRelease: string; chartRef: string;
}

export interface CryptoComponent {
  kind: string; name: string;
  want: number | null; ready: number | null;
  image: string; version: string;
  /** running = hazır ≥ istenen · stopped = istenen 0 · degraded = eksik replika */
  state: 'running' | 'stopped' | 'degraded';
}

export interface CryptoRelease {
  name: string; chart: string; chartVersion: string; appVersion: string;
  status: string; updatedAt: string;
}

export interface CryptoVersions {
  running: string;
  /** koşan sürümün okunduğu ANA helm release (Wyden: wydenapp, Metaco: hmz) */
  release: string;
  /**
   * false = registry sorgulanamadı (kimlik yok / skopeo yok / hata). Bu durumda `available`
   * boştur ama bu "yeni sürüm yok" DEMEK DEĞİLDİR — ekran "ölçülemedi" gösterir.
   */
  measured: boolean;
  available: string[];
  newer: string[];
  latest: string;
}

export interface CryptoOverview {
  ok: boolean;
  tenant?: CryptoTenant;
  notConfigured?: boolean;
  tableMissing?: boolean;
  cached?: boolean;
  scannedAt?: string | null;
  components?: CryptoComponent[];
  releases?: CryptoRelease[];
  versions?: CryptoVersions | null;
  notes?: { level: string; stage: string; message: string }[];
  summary?: { total: number; running: number; stopped: number; degraded: number };
  message?: string;
}

export const cryptoHubApi = {
  tenants: (): Promise<{ ok: boolean; apps: CryptoApp[]; message?: string }> =>
    fetch(`${BASE}/tenants`).then(safeJson),

  overview: (tenant: string, fresh = false): Promise<CryptoOverview> =>
    fetch(`${BASE}/overview?tenant=${encodeURIComponent(tenant)}${fresh ? '&fresh=1' : ''}`).then(safeJson),

  /** Taramayı şimdi koştur (salt okunur iş; yalnız seçili kiracı). */
  rescan: (tenant: string): Promise<{ ok: boolean; jobId?: number | null; awxServerId?: number; message?: string }> =>
    fetch(`${BASE}/rescan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant }),
    }).then(safeJson),

  jobStatus: (awxServerId: number, jobId: number): Promise<{ ok: boolean; status: string; output?: string; message?: string }> =>
    fetch(`${BASE}/job-status/${awxServerId}/${jobId}`).then(safeJson),
};
