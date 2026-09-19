// src/api/nginxConsoleApi.ts — Nginx Hub (2026-09-19): sunucu listesi, konfigurasyon
// agaci/icerik (Ansible dokumundan, /sw), sertifika envanteri, dokum yenileme ve tek dosya push.
import { safeJson } from "./http";

const BASE = "/api/nginx-console";

export interface NcHost {
  host: string;
  env: string | null;
  location: string | null;
  service: string | null;
  services: string[];
  nginxVersion: string | null;
  prefix: string | null;
  configCount: number | null;
  ip: string | null;
  dumpedAt: string | null;
  nginxT: "ok" | "fail" | null;
  fileCount: number | null;
  certCount: number | null;
  certMinDays: number | null;
  inventoryMissing?: boolean;
}

export interface NcTreeFile { name: string; path: string; size: number; mtime: string; sha256: string }
export interface NcTreeDir { name: string; path: string; dirs: NcTreeDir[]; files: NcTreeFile[] }

export interface NcCert {
  path: string;
  exists: boolean;
  sha256: string | null;
  size: number;
  mtime: string | null;
  subject: string | null;
  cn: string | null;
  issuer: string | null;
  issuerCn: string | null;
  serial: string | null;
  notBefore: string | null;
  notAfter: string | null;
  fingerprint: string | null;
  sigalg: string | null;
  keybits: number | null;
  san: string[];
  chain: number;
  chainSubjects: string[];
  selfSigned: boolean;
  daysLeft: number | null;
}
export interface NcCertUse { conf: string; serverName: string; cert: string; key: string; keyState: string }

export interface NcTree {
  ok: boolean;
  host: string;
  dumped: boolean;
  dumpedAt?: string;
  time?: string;
  prefix?: string;
  nginxT?: { status: "ok" | "fail" | "unknown"; output: string };
  tree?: NcTreeDir;
  fileCount?: number;
  certs?: NcCert[];
  certUses?: NcCertUse[];
  message?: string;
}

export interface NcFile {
  ok: boolean;
  host: string;
  path: string;
  sha256: string;
  size: number;
  mtime: string | null;
  content: string | null;
  tooLarge: boolean;
  message?: string;
}

export interface NcAggCert extends Omit<NcCert, "path" | "sha256" | "size" | "mtime" | "exists"> {
  exists: boolean;
  hosts: { host: string; path: string; sha256: string | null; uses: { conf: string; serverName: string; key: string; keyState: string }[] }[];
  hostCount: number;
  useCount: number;
}
export interface NcCertsResult {
  ok: boolean;
  hostsScanned: number;
  certs: NcAggCert[];
  summary: { total: number; expired: number; within30: number; within90: number; missing: number; selfSigned: number; generatedAt: string };
}

export interface NcLaunch { ok: boolean; jobId: number | null; status: string | null; awxServerId: number; message?: string; newSha256?: string; currentSha256?: string | null; conflicts?: { host: string; reason: string; currentSha256?: string }[]; hosts?: string[] }
export interface NcJobStatus { ok: boolean; status: string; output: string; result?: unknown; message?: string }

const json = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const nginxConsoleApi = {
  hosts: (): Promise<{ ok: boolean; hosts: NcHost[]; consoleDir: string; inventoryError: string | null }> => fetch(`${BASE}/hosts`).then(safeJson),
  tree: (host: string): Promise<NcTree> => fetch(`${BASE}/tree/${encodeURIComponent(host)}`).then(safeJson),
  file: (host: string, path: string): Promise<NcFile> => fetch(`${BASE}/file/${encodeURIComponent(host)}?path=${encodeURIComponent(path)}`).then(safeJson),
  compare: (path: string, hosts?: string[]): Promise<{ ok: boolean; path: string; rows: { host: string; exists: boolean; sha256: string | null; size: number | null; mtime: string | null }[]; variants: number }> =>
    fetch(`${BASE}/compare?path=${encodeURIComponent(path)}${hosts?.length ? `&hosts=${encodeURIComponent(hosts.join(","))}` : ""}`).then(safeJson),
  certs: (host?: string): Promise<NcCertsResult> => fetch(`${BASE}/certs${host ? `?host=${encodeURIComponent(host)}` : ""}`).then(safeJson),
  // hosts bos + all:true -> playbook tum nginx filosunu envanterden kesfeder (30-40 dk)
  refresh: (hosts: string[], all = false): Promise<NcLaunch & { hosts: string[]; all?: boolean }> => fetch(`${BASE}/refresh`, json({ hosts, all })).then(safeJson),
  // Publish (NIM "Publish"): bir dosya, bir ya da daha fazla sunucu (instance group = servis).
  // expectedSha: host -> Portal'in gordugu sha (anti-TOCTOU); force ile atlanir.
  push: (body: { hosts: string[]; path: string; mode: "create" | "update"; content: string; expectedSha?: Record<string, string>; force?: boolean }): Promise<NcLaunch> =>
    fetch(`${BASE}/push`, json(body)).then(safeJson),
  jobStatus: (awxServerId: number, jobId: number): Promise<NcJobStatus> => fetch(`${BASE}/job-status/${awxServerId}/${jobId}`).then(safeJson),
};
