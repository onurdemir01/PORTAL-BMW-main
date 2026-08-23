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

export interface NginxEnvStat {
  env: string;
  rows: number;
  hosts: string[];
  /** Bu env jetonunu ureten vhost dosyalari (env, dosya adindan turer). */
  vhosts: string[];
}

export interface NginxSpaResult {
  ok: boolean;
  scanDate: string | null;
  availableDates: string[];
  services: string[];
  envs: string[];
  envStats?: NginxEnvStat[];
  rows: NginxSpaRow[];
  message?: string;
}

export interface SpaCoverageRow {
  env: string;
  ocpTotal: number;
  nginxTotal: number;
  bothCount: number;
  onlyOcpCount: number;
  onlyNginxCount: number;
  /** OpenShift'tekilerin yuzde kaci nginx'e tanimli. OCP'de hic yoksa null. */
  coverage: number | null;
  onlyOcp: string[];
  onlyNginx: string[];
  truncated: boolean;
}

export interface SpaCoverageResult {
  ok: boolean;
  platform: string;
  platforms: string[];
  clusters: string[];
  scanDate: string | null;
  ocpSkippedNoEnv: number;
  rows: SpaCoverageRow[];
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

export interface InitScriptVariant {
  hash: string;
  count: number;
  hosts: string[];
}

export interface InitScriptStat {
  key: string;
  label: string;
  /** startCustom.sh gibi sunucuya OZEL olmasi beklenen dosyalar; sapma sayilmaz. */
  perServer: boolean;
  present: number;
  missing: number;
  missingHosts: string[];
  variantCount: number;
  majorityHash: string | null;
  majorityCount: number;
  deviatingCount: number;
  variants: InitScriptVariant[];
}

export interface InitScriptHostRow {
  host: string;
  deviations: string[];
  deviationCount: number;
  missing: string[];
  missingCount: number;
  hasCustom: boolean;
  customHash: string | null;
}

export interface InitScriptsResult {
  ok: boolean;
  root: string;
  roots: string[];
  hosts: number;
  scriptCount: number;
  identicalHosts: number;
  totalVariants: number;
  customHosts: number;
  missingColumns: string[];
  scripts: InitScriptStat[];
  hostRows: InitScriptHostRow[];
  message?: string;
}

export interface EnvanterDistRow {
  value: string;
  /** Satir sayisi (Sunucular icin = sunucu, uygulama tablolari icin = uygulama kaydi). */
  count: number;
  /** Bu degere sahip FARKLI sunucu sayisi. */
  hosts: number;
}

export interface EnvanterProduct {
  key: string;
  label: string;
  /** Surum alani DOLU olan sunucu sayisi. */
  installed: number;
  versionCount: number;
  versions: EnvanterDistRow[];
}

export interface EnvanterSummary {
  ok: boolean;
  source: string;
  label: string;
  unit: string;
  totals: {
    rows: number;
    hosts: number;
    apps: number;
    numerics: { key: string; label: string; value: number }[];
  };
  dims: { key: string; label: string }[];
  products: EnvanterProduct[];
  distributions: Record<string, EnvanterDistRow[]>;
  message?: string;
}

export interface EnvanterPivot {
  ok: boolean;
  source: string;
  metric: "rows" | "hosts";
  x: { key: string; label: string; values: { value: string; count: number }[] };
  y: { key: string; label: string; values: { value: string; count: number }[] };
  /** Anahtar: `${sutunDegeri}\u0001${satirDegeri}` — ayirici sunucu tarafiyla AYNI. */
  cells: Record<string, number>;
  total: number;
  message?: string;
}

export const denetimApi = {
  nginxSpa: (scanDate?: string): Promise<NginxSpaResult> =>
    fetch(`${BASE}/nginx-spa${scanDate ? `?scanDate=${encodeURIComponent(scanDate)}` : ""}`).then(safeJson),

  spaCoverage: (platform: string): Promise<SpaCoverageResult> =>
    fetch(`${BASE}/nginx-spa-coverage?platform=${encodeURIComponent(platform)}`).then(safeJson),

  ocpCoverage: (platform: string): Promise<OcpCoverageResult> =>
    fetch(`${BASE}/ocp-coverage?platform=${encodeURIComponent(platform)}`).then(safeJson),

  initScripts: (root: string): Promise<InitScriptsResult> =>
    fetch(`${BASE}/init-scripts?root=${encodeURIComponent(root)}`).then(safeJson),

  envanterSummary: (source: string): Promise<EnvanterSummary> =>
    fetch(`${BASE}/envanter/summary?source=${encodeURIComponent(source)}`).then(safeJson),

  envanterPivot: (p: {
    source: string; x: string; y: string; metric: string; hideEmpty: boolean;
  }): Promise<EnvanterPivot> =>
    fetch(`${BASE}/envanter/pivot?source=${encodeURIComponent(p.source)}`
      + `&x=${encodeURIComponent(p.x)}&y=${encodeURIComponent(p.y)}`
      + `&metric=${encodeURIComponent(p.metric)}&hideEmpty=${p.hideEmpty ? "1" : "0"}`).then(safeJson),
};
