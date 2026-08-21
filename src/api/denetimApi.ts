// src/api/denetimApi.ts — "Denetim" sayfasinin veri istemcisi
// (bkz. server/audit/denetim.cjs).
import { safeJson } from "./http";

const BASE = "/api/denetim";

export interface NginxSpaEnvCell {
  present: boolean;
  status: string;
  namespace: string | null;
  deployMode: string | null;
  includeExists: boolean;
  appDeployed: boolean;
  inOcpInventory: boolean;
  locationPath: string;
  hosts: string[];
}

export interface NginxSpaRow {
  service: string;
  application: string;
  envs: Record<string, NginxSpaEnvCell>;
}

export interface NginxSpaResult {
  ok: boolean;
  scanDate: string | null;
  availableDates: string[];
  services: string[];
  envs: string[];
  rows: NginxSpaRow[];
  message?: string;
}

export interface OcpCoverageRow {
  application: string;
  envs: Record<string, { cluster: string; namespace: string }[]>;
  present: string[];
  missing: string[];
  missingCount: number;
}

export interface OcpCoverageResult {
  ok: boolean;
  platform: string;
  platforms: string[];
  clusters: string[];
  envs: string[];
  totalApplications: number;
  completeCount: number;
  skippedNoEnv: number;
  patterns: { missing: string[]; count: number }[];
  rows: OcpCoverageRow[];
  message?: string;
}

export const denetimApi = {
  nginxSpa: (scanDate?: string): Promise<NginxSpaResult> =>
    fetch(`${BASE}/nginx-spa${scanDate ? `?scanDate=${encodeURIComponent(scanDate)}` : ""}`).then(safeJson),

  ocpCoverage: (platform: string): Promise<OcpCoverageResult> =>
    fetch(`${BASE}/ocp-coverage?platform=${encodeURIComponent(platform)}`).then(safeJson),
};
