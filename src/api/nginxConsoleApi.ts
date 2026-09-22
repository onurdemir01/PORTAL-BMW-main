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
  /** Pendik | Ankara (envanter location ya da sunucu adi) */
  site?: string | null;
  /** dbo.Inventory cpu / memory (GB) / os — Dashboard Kaynaklar (2026-09-22) */
  cpu?: number | null;
  memoryGb?: number | null;
  os?: string | null;
  dumpedAt: string | null;
  /** fetch job'inin bu sunucuya son ulastigi an (_seen.json ya da dokum); Online bunun uzerinden */
  seenAt?: string | null;
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
  hosts: { host: string; path: string; sha256: string | null; uses: { conf: string; serverName: string; key: string; keyState: string; loaded?: boolean | null }[] }[];
  hostCount: number;
  useCount: number;
  /** yalniz nginx -T'nin YUKLEDIGI conf'lardaki kullanim (eski dokumda = useCount) */
  loadedUseCount?: number;
}
export interface NcCertsResult {
  ok: boolean;
  hostsScanned: number;
  certs: NcAggCert[];
  summary: { total: number; expired: number; within30: number; within90: number; missing: number; selfSigned: number; unused?: number; generatedAt: string };
}

// Kullanilmayan dosyalar (2026-09-22): nginx -T'nin yuklemedigi conf'lar, yalniz onlarda gecen
// sertifikalar, ssl/ altinda referanssiz dosyalar. Sunucu bazinda.
export interface NcOrphanFile { path: string; size: number; mtime: string | null; owner?: string | null }
export interface NcOrphanHost {
  host: string;
  known: boolean;
  reason: string | null;
  unloaded: NcOrphanFile[];
  backups: NcOrphanFile[];
  certs: { path: string; exists: boolean; cn: string | null; issuerCn: string | null; notAfter: string | null; daysLeft: number | null; usedBy: string[] }[];
  ssl: { path: string; size: number; mtime: string | null; isKey: boolean }[];
}
// Tutarlilik (2026-09-22): servis+ortam gruplarinda dosya bazinda sha farki
export interface NcDriftFile { path: string; status: 'differ' | 'missing' | 'local' | 'same'; variants: { sha: string; hosts: string[]; size: number; mtime: string | null }[]; missing: string[]; majority: string | null }
export interface NcDriftGroup { key: string; service: string; env: string; hosts: string[]; dumped: string[]; dumpMissing: string[]; files: NcDriftFile[]; counts: { same: number; differ: number; missing: number; local: number } }
export interface NcDriftResult { ok: boolean; message?: string; groups: NcDriftGroup[]; services: string[]; generatedAt: string }
export interface NcOrphansResult {
  ok: boolean;
  hosts: NcOrphanHost[];
  summary: { hostsScanned: number; hostsUnknown: number; unloaded: number; backups: number; certs: number; ssl: number; generatedAt: string };
}

// Gecmis (Git benzeri, 2026-09-19): yalniz degisiklikte satir; icerik blob deposunda (sha256)
export type NcChangeSource = "first-seen" | "server" | "portal-publish" | "deleted";
export interface NcChange {
  id: number;
  host: string;
  path: string;
  oldSha256: string | null;
  newSha256: string | null;
  size: number | null;
  fileMtime: string | null;
  fileOwner: string | null;
  source: NcChangeSource;
  requester: string | null;
  jobId: number | null;
  seenAt: string | null;
  dumpTime: string | null;
  pending: boolean;
  hasOld: boolean;
  hasNew: boolean;
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
  drift: (service?: string, env?: string): Promise<NcDriftResult> => { const u = new URLSearchParams(); if (service) u.set("service", service); if (env) u.set("env", env); const qs = u.toString(); return fetch(`${BASE}/drift${qs ? "?" + qs : ""}`).then(safeJson); },
  orphans: (host?: string): Promise<NcOrphansResult> => fetch(`${BASE}/orphans${host ? `?host=${encodeURIComponent(host)}` : ""}`).then(safeJson),
  // hosts bos + all:true -> playbook tum nginx filosunu envanterden kesfeder (30-40 dk)
  refresh: (hosts: string[], all = false): Promise<NcLaunch & { hosts: string[]; all?: boolean }> => fetch(`${BASE}/refresh`, json({ hosts, all })).then(safeJson),
  // Publish (NIM "Publish"): bir dosya, bir ya da daha fazla sunucu (instance group = servis).
  // expectedSha: host -> Portal'in gordugu sha (anti-TOCTOU); force ile atlanir.
  push: (body: { hosts: string[]; path: string; mode: "create" | "update"; content: string; expectedSha?: Record<string, string>; force?: boolean }): Promise<NcLaunch> =>
    fetch(`${BASE}/push`, json(body)).then(safeJson),
  jobStatus: (awxServerId: number, jobId: number): Promise<NcJobStatus> => fetch(`${BASE}/job-status/${awxServerId}/${jobId}`).then(safeJson),
  // Gecmis
  history: (host: string, path: string): Promise<{ ok: boolean; versions: NcChange[]; message?: string }> =>
    fetch(`${BASE}/history/${encodeURIComponent(host)}?path=${encodeURIComponent(path)}`).then(safeJson),
  changes: (q: { host?: string; path?: string; source?: string; since?: string; limit?: number } = {}): Promise<{ ok: boolean; changes: NcChange[]; message?: string }> => {
    const u = new URLSearchParams();
    Object.entries(q).forEach(([k, v]) => { if (v != null && v !== "") u.set(k, String(v)); });
    return fetch(`${BASE}/changes?${u.toString()}`).then(safeJson);
  },
  blob: (sha: string): Promise<{ ok: boolean; sha256: string; content: string; message?: string }> => fetch(`${BASE}/blob/${encodeURIComponent(sha)}`).then(safeJson),
};
