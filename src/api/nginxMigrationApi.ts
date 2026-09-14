// src/api/nginxMigrationApi.ts — "Production Taşımaları > Tanım oluştur".
//
// Eski GBRVP* sunucusundaki bir proxy_pass location'ını yeni prod SPA sunucularında SPA
// tanımı olarak oluşturan AWX job'ını tetikler. Playbook:
//   gar_bmt_ansible_scripts/bmw_nginx/nginx_ops/nginx_prod_migration.yml
import { safeJson } from "./http";

const BASE = "/api/nginx-migration";

export interface NginxMigrationConfig {
  awxServerId: number;
  /** nginx_ops/nginx_prod_migration.yml (Tanım oluştur) */
  templateId: number;
  /** nginx_ops/nginx_ops.yml (Eski tanımı kaldır: action=delete, env=prod — 23:00'e zamanlanır) */
  deleteTemplateId?: number;
}

export interface NginxMigrationCreateResult {
  ok: boolean;
  job?: { id?: number; [k: string]: unknown };
  extraVars?: Record<string, string>;
  targetHosts?: string[];
  message?: string;
}

export interface NginxMigrationDeleteResult {
  ok: boolean;
  job?: { id?: number; [k: string]: unknown };
  extraVars?: Record<string, string>;
  oldHosts?: string[];
  scheduled?: boolean;
  message?: string;
}

export const nginxMigrationApi = {
  config: (): Promise<{ ok: boolean; config: NginxMigrationConfig }> =>
    fetch(`${BASE}/config`).then(safeJson),

  remove: (body: {
    group: string;
    namespace: string;
    application: string;
    service: string;
    inputPath: string;
  }): Promise<NginxMigrationDeleteResult> =>
    fetch(`${BASE}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(safeJson),

  saveConfig: (cfg: NginxMigrationConfig): Promise<{ ok: boolean; message?: string }> =>
    fetch(`${BASE}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    }).then(safeJson),

  create: (body: {
    group: string;
    namespace: string;
    application: string;
    service: string;
    inputPath: string;
  }): Promise<NginxMigrationCreateResult> =>
    fetch(`${BASE}/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(safeJson),
};

// ── Gecis takibi ────────────────────────────────────────────────────────────────────
export type MigrationTrackState = 'none' | 'planned' | 'migrated' | 'cancelled';

export interface MigrationTracking {
  group: string;
  namespace: string;
  application: string;
  state: MigrationTrackState;
  plannedDate: string | null;
  migratedDate: string | null;
  note: string | null;
  /** "Tanım oluştur" ile başlatılan son job */
  configJobId: number | null;
  configCreatedAt: string | null;
  configCreatedBy: string | null;
  /** "Eski tanımı kaldır" ile başlatılan son job (23:00'e zamanlanır) */
  deleteJobId?: number | null;
  deleteRequestedAt?: string | null;
  deleteRequestedBy?: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export const nginxMigrationTrackingApi = {
  list: (): Promise<{ ok: boolean; rows: MigrationTracking[]; message?: string }> =>
    fetch(`${BASE}/tracking`).then(safeJson),

  save: (body: {
    group: string;
    namespace: string;
    application: string;
    state: MigrationTrackState;
    plannedDate?: string | null;
    migratedDate?: string | null;
    note?: string | null;
  }): Promise<{ ok: boolean; row?: MigrationTracking; message?: string }> =>
    fetch(`${BASE}/tracking`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(safeJson),
};
