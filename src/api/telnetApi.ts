// src/api/telnetApi.ts — Telnet (Uygulama Sunucularında Bağlantı Testi) istemcisi.
//
// OpsX'in aynı Legacy/Openshift + uygulama/sunucu seçim akışının birebir kopyası —
// uygulama listesi/host listesi/cluster kataloğu OpsX/LogX ile AYNI kaynaktan gelir
// (backend server/telnet/index.cjs OpsX'in hostsForApp'ini yeniden kullanır).
import { safeJson } from "./http";

const BASE = "/api/telnet";

export type TelnetPlatform = "legacy" | "openshift";

export interface TelnetHost {
  host: string;
  env: string;
  jbossVersion: string;
  status: string;
}

export interface TelnetRunResult {
  ok: boolean;
  jobId: number | null;
  status: string | null;
  awxServerId: number;
  templateId: number;
  sentBody: { limit?: string; extra_vars: Record<string, unknown> };
}

export interface TelnetJobStatus {
  ok: boolean;
  status: string;
  output: string;
  finished?: string;
  failed?: boolean;
}

export const telnetApi = {
  searchApps: (search: string): Promise<{ ok: boolean; apps: string[]; fallbackMode: boolean }> =>
    fetch(`${BASE}/apps?search=${encodeURIComponent(search)}`).then(safeJson),

  getHosts: (app: string): Promise<{ ok: boolean; hosts: TelnetHost[] }> =>
    fetch(`${BASE}/hosts?app=${encodeURIComponent(app)}`).then(safeJson),

  getClusters: (): Promise<{ ok: boolean; tree: Record<string, Record<string, string[]>> }> =>
    fetch(`${BASE}/clusters`).then(safeJson),

  // Testi tetikler. AWX job template'i tanımlı değilse sunucu 501 + açıklayıcı mesaj döner.
  run: (body: {
    platform: TelnetPlatform;
    // Legacy alanları
    application?: string;
    hosts?: string[];
    // Openshift alanları
    env?: string;
    tenant?: string;
    clusters?: string[];
    namespace?: string;
    // Ortak
    ip: string;
    port: string;
  }): Promise<TelnetRunResult> =>
    fetch(`${BASE}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(safeJson),

  jobStatus: (serverId: number, jobId: number): Promise<TelnetJobStatus> =>
    fetch(`${BASE}/job-status/${serverId}/${jobId}`).then(safeJson),
};
