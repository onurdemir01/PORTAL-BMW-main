// src/api/spaPlanApi.ts — SPA Taşıma Planı (ekip ekranı), 2026-09-26.
// Sunucu karşılığı: server/spa-plan/index.cjs
import { safeJson } from './http';

const BASE = '/api/spa-plan';

export type SpaPlanInUse = 'yes' | 'no' | 'unknown';

export interface SpaPlanTraffic {
  /** active = 7 günde hc dışı istek var · idle = log okundu, istek yok · unknown = ölçülemedi */
  state: 'active' | 'idle' | 'unknown';
  req24: number | null;
  req7: number | null;
  lastSeen: string | null;
  /** true = log kuyruğu 7 günü kapsamıyor; req7 ALT SINIR, "yük yok" denemez */
  sampled: boolean;
  measuredPaths: number;
  unknownPaths: number;
}

export interface SpaPlanRow {
  group: string;
  groupLabel: string;
  namespace: string;
  application: string;
  status: 'ready' | 'partial' | 'missing' | 'not-scanned';
  services: string[];
  locations: string[];
  locationCount: number;
  owner: { groups: string[]; emails: string[] } | null;
  /** true = benim ekibim · false = başka ekip · null = sahibi çözülemedi */
  mine: boolean | null;
  /** ÖLÇÜM (access log) — ekibin beyanı değil */
  traffic: SpaPlanTraffic | null;
  /** BEYAN (ekip) */
  inUse: SpaPlanInUse | null;
  inUseBy: string | null;
  inUseAt: string | null;
  plannedDate: string | null;
  migratedDate: string | null;
  state: string;
  note: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface SpaPlanResult {
  ok: boolean;
  message?: string;
  isAdmin?: boolean;
  all?: boolean;
  /** kendi ekibine ait olmadığı için gizlenen satır sayısı */
  hiddenByOwner?: number;
  ownersReady?: boolean;
  /** false = trafik tablosu yok; ekran "ölçülemedi" der, "yük yok" DEMEZ */
  trafficReady?: boolean;
  scanDate?: string | null;
  groups?: { id: string; label: string }[];
  rows?: SpaPlanRow[];
}

export const spaPlanApi = {
  rows: (all = false, fresh = false): Promise<SpaPlanResult> =>
    fetch(`${BASE}/rows${all || fresh ? '?' : ''}${all ? 'all=1' : ''}${all && fresh ? '&' : ''}${fresh ? 'fresh=1' : ''}`).then(safeJson),

  /** Ekip beyanı: kullanımda mı + deployment/rollout tarihi (+ not). Başka alan yazılmaz. */
  declare: (body: {
    group: string; namespace: string; application: string;
    inUse: SpaPlanInUse | null; plannedDate: string | null; note?: string | null;
  }): Promise<{ ok: boolean; message?: string }> =>
    fetch(`${BASE}/declare`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(safeJson),
};
