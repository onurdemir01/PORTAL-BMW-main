// src/api/nginxMigrationApi.ts — "Production Taşımaları > Tanım oluştur".
//
// Eski GBRVP* sunucusundaki bir proxy_pass location'ını yeni prod SPA sunucularında SPA
// tanımı olarak oluşturan AWX job'ını tetikler. Playbook:
//   gar_bmt_ansible_scripts/bmw_nginx/nginx_ops/nginx_prod_migration.yml
import { safeJson } from "./http";

const BASE = "/api/nginx-migration";

export interface NginxMigrationConfig {
  awxServerId: number;
  templateId: number;
}

export interface NginxMigrationCreateResult {
  ok: boolean;
  job?: { id?: number; [k: string]: unknown };
  extraVars?: Record<string, string>;
  targetHosts?: string[];
  message?: string;
}

export const nginxMigrationApi = {
  config: (): Promise<{ ok: boolean; config: NginxMigrationConfig }> =>
    fetch(`${BASE}/config`).then(safeJson),

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
