// src/api/nginxExposeApi.ts — "API'yi internete aç".
//
// Test ortamındaki bir API tanımını, internete açık sunucuya (varsayılan GBNGXT07)
// kopyalayan AWX job'ını tetikler. Arkasındaki playbook:
//   gar_bmt_ansible_scripts/bmw_nginx/api_expose/api_expose.yml
import { safeJson } from "./http";

const BASE = "/api/nginx-expose";

export interface NginxExposeLocation {
  path: string;
  ipRateLimit: string | null;
  serverRateLimit: string | null;
}

/** Bir API = BİR DOSYA (`<api>.conf`); içindeki location blokları onun yollarıdır. */
export interface NginxExposeRow {
  configFile: string;
  /** Dosya adının `.conf` çıkarılmış hâli — playbook'un beklediği `api` değeri. */
  api: string;
  hosts: string[];
  locations: NginxExposeLocation[];
}

export interface NginxExposeConfig {
  awxServerId: number;
  templateId: number;
  targetHost: string;
}

export interface NginxExposeResult {
  ok: boolean;
  scanDate: string | null;
  hosts: string[];
  rows: NginxExposeRow[];
  config: NginxExposeConfig;
  message?: string;
}

export interface NginxExposeLaunchResult {
  ok: boolean;
  job?: { id?: number; [k: string]: unknown };
  targetHost?: string;
  message?: string;
}

export const nginxExposeApi = {
  apis: (): Promise<NginxExposeResult> => fetch(`${BASE}/apis`).then(safeJson),

  open: (api: string, sourceHost: string): Promise<NginxExposeLaunchResult> =>
    fetch(`${BASE}/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api, sourceHost }),
    }).then(safeJson),

  saveConfig: (cfg: NginxExposeConfig): Promise<{ ok: boolean; message?: string }> =>
    fetch(`${BASE}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    }).then(safeJson),
};
