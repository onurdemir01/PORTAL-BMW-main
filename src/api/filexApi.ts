// src/api/filexApi.ts — FileX (Self Servis dosya listeleme) istemcisi.
//
// OpsX ile AYNI uygulama/sunucu kaynağını kullanır (backend bunları yeniden kullanır —
// bkz. server/filex/index.cjs) ama FileX hiçbir İŞLEM yapmaz, yalnızca seçilen
// uygulamanın .ear dizinini (logs hariç) salt-okunur listeler.
import { safeJson } from "./http";

const BASE = "/api/filex";

export interface FilexHost {
  host: string;
  env: string;
  jbossVersion: string;
  status: string;
}

export interface FilexFileEntry {
  path: string;
  size: number;
  mtime: number;   // UNIX epoch saniye (ansible.builtin.stat çıktısı, ISO değil)
  mode: string;
  owner: string;
  group: string;
  sha512: string;
}

export interface FilexHostResult {
  host: string;
  status: "ok" | "unreachable" | "error";
  error?: string;
  ear_dirs: string[];
  files: FilexFileEntry[];
}

export interface FilexResult {
  overall_status: "success" | "partial" | "failed";
  hosts: FilexHostResult[];
}

export interface FilexRunResult {
  ok: boolean;
  jobId: number | null;
  status: string | null;
  awxServerId: number;
  // ok:false ise backend'in ürettiği hata metni (bkz. OpsX/Telnet'teki AYNI desen/opsxApi.ts) —
  // ÇAĞIRAN BUNU KONTROL ETMELİ, safeJson() 4xx/5xx'te reddetmez.
  message?: string;
}

export interface FilexJobStatus {
  ok: boolean;
  status: string;
  finished: string | null;
  failed: boolean;
  result: FilexResult | null;
  message?: string;
}

export const filexApi = {
  searchApps: (search: string): Promise<{ ok: boolean; apps: string[]; fallbackMode: boolean }> =>
    fetch(`${BASE}/apps?search=${encodeURIComponent(search)}`).then(safeJson),

  getHosts: (app: string): Promise<{ ok: boolean; hosts: FilexHost[] }> =>
    fetch(`${BASE}/hosts?app=${encodeURIComponent(app)}`).then(safeJson),

  run: (application: string, hosts: string[]): Promise<FilexRunResult> =>
    fetch(`${BASE}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ application, hosts }),
    }).then(safeJson),

  jobStatus: (serverId: number, jobId: number): Promise<FilexJobStatus> =>
    fetch(`${BASE}/job-status/${serverId}/${jobId}`).then(safeJson),
};
