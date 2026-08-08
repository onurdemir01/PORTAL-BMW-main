import { safeJson } from "./http";
// src/api/logxV2Api.ts — LogX v2 (güvenli dosya indirme yeniden tasarımı) API client.
// src/api/logxApi.ts (eski port-1111 proxy client'ı) ile İLGİSİZDİR — bu, tamamen ayrı,
// dosya-indirmeye dayalı yeni akışın client'ıdır.

const BASE = "/api/logx/v2";

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const contentType = r.headers.get("content-type") || "";
    // HTML govdesi = istek API'ye ULASMADI (ters-proxy/SPA fallback araya girdi).
    // Ham HTML'i kullaniciya basmak (eskiden oyle oluyordu) tum index.html'i
    // ekrana dokuyordu — hem okunaksiz hem de teshisi zorlastiriyordu.
    if (!contentType.includes("application/json")) {
      throw new Error(
        `Sunucu JSON yerine ${contentType.split(";")[0] || "bilinmeyen"} yanıt döndü ` +
        `(HTTP ${r.status}). İstek büyük olasılıkla uygulamaya ulaşmadan ters-proxy ` +
        `tarafından karşılandı — yöneticiye bildirin.`
      );
    }
    const text = await r.text().catch(() => "");
    let message = text;
    try {
      const parsed = JSON.parse(text);
      message = parsed.error || parsed.message || text;
    } catch { /* duz metin hata */ }
    throw new Error(String(message).slice(0, 300) || `HTTP ${r.status}`);
  }
  return safeJson(r);
}

function postJson<T>(path: string, body?: unknown): Promise<T> {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then((r) => json<T>(r));
}

function putJson<T>(path: string, body?: unknown): Promise<T> {
  return fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then((r) => json<T>(r));
}

function del<T>(path: string): Promise<T> {
  return fetch(`${BASE}${path}`, { method: "DELETE" }).then((r) => json<T>(r));
}

export type Platform = "legacy" | "openshift";

export type RequestState =
  | "draft" | "discovering" | "discovered"
  | "namespace_discovering" | "namespaces_discovered"
  | "transferring" | "ready" | "failed" | "expired";

export interface DiscoveredFile { path: string; size?: number; mtime?: string; environment?: string }
export interface DiscoveredHost { host: string; status: string; error?: string; files: DiscoveredFile[] }
export interface LegacyDiscoveryResult { overall_status: string; hosts: DiscoveredHost[] }

export interface DiscoveredCluster { cluster_name: string; status: string; error?: string; namespaces: string[] }
export interface OcpNamespaceDiscoveryResult { overall_status: string; clusters: DiscoveredCluster[] }

export interface LogXv2Request {
  id: string;
  username: string;
  platform: Platform;
  state: RequestState;
  input: Record<string, unknown> | null;
  discoveryResult: LegacyDiscoveryResult | OcpNamespaceDiscoveryResult | Record<string, unknown> | null;
  selectedFiles: { host: string; path: string }[] | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface LogXv2Job {
  id: number;
  requestId: string;
  jobType: string;
  status: string;
  artifacts: Record<string, unknown> | null;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
}

export interface DownloadInfo { token: string; filename: string; sizeBytes: number | null; expiresAt: string }

export const logxV2Api = {
  createRequest: (platform: Platform) => postJson<{ ok: boolean; requestId: string }>("/requests", { platform }),

  getRequest: (requestId: string) =>
    fetch(`${BASE}/requests/${requestId}`).then((r) => json<{ ok: boolean; request: LogXv2Request; jobs: LogXv2Job[]; download: DownloadInfo | null; downloads?: DownloadInfo[] }>(r)),

  // ── Legacy ─────────────────────────────────────────────────────────────────
  searchLegacyApps: (search: string) =>
    fetch(`${BASE}/legacy/apps?search=${encodeURIComponent(search)}`).then((r) => json<{ ok: boolean; apps: string[]; fallbackMode: boolean }>(r)),

  discoverLegacy: (requestId: string, app: string) =>
    postJson<{ ok: boolean; jobId: number }>(`/legacy/${requestId}/discover`, { app }),

  discoverLegacyFallback: (requestId: string, hosts: string[]) =>
    postJson<{ ok: boolean; jobId: number }>(`/legacy/${requestId}/discover`, { hosts }),

  transferLegacy: (requestId: string, selected: { host: string; path: string }[]) =>
    postJson<{ ok: boolean; jobId: number }>(`/legacy/${requestId}/transfer`, { selected }),

  // ── OpenShift ──────────────────────────────────────────────────────────────
  getClusterTree: () => fetch(`${BASE}/ocp/cluster-index`).then((r) => json<{ ok: boolean; tree: Record<string, Record<string, string[]>> }>(r)),

  selectClusters: (requestId: string, env: string, tenant: string, clusters: string[]) =>
    postJson<{ ok: boolean; terminalHost: string }>(`/ocp/${requestId}/select`, { env, tenant, clusters }),

  discoverNamespaces: (requestId: string) =>
    postJson<{ ok: boolean; jobId: number }>(`/ocp/${requestId}/namespaces/discover`, {}),

  discoverFetchOcp: (requestId: string, namespace: string, appName: string) =>
    postJson<{ ok: boolean; jobId: number }>(`/ocp/${requestId}/discover-fetch`, { namespace, appName }),

  // ── Jobs / downloads ─────────────────────────────────────────────────────────
  jobStatus: (jobId: number) =>
    // `technicalDetail` YALNIZCA Admin rolüne gönderilir (bkz. server/logx/v2/index.cjs) —
    // normal kullanıcı Ansible/AWX jargonu görmemeli.
    fetch(`${BASE}/jobs/${jobId}/status`).then((r) => json<{ ok: boolean; status: string; jobType: string; elapsedSec: number; artifacts: Record<string, unknown> | null; errorMessage: string | null; technicalDetail?: string }>(r)),

  // Canlı AWX stdout — yalnızca görünürlük için, sonuç kaynağı değil (bkz. jobs.cjs).
  jobOutput: (jobId: number) =>
    fetch(`${BASE}/jobs/${jobId}/output`).then((r) => json<{ ok: boolean; output: string }>(r)),

  cancelJob: (jobId: number) =>
    postJson<{ ok: boolean; status: string }>(`/jobs/${jobId}/cancel`, {}),

  resetRequest: (requestId: string, to: "legacy_app" | "ocp_cluster_select" | "ocp_namespace_step") =>
    postJson<{ ok: boolean }>(`/requests/${requestId}/reset`, { to }),

  downloadUrl: (token: string) => `${BASE}/downloads/${token}`,

  // ── Admin: ocp_cluster_index ─────────────────────────────────────────────────
  admin: {
    listClusterIndex: () => fetch(`${BASE}/admin/ocp-cluster-index`).then((r) => json<{ ok: boolean; rows: OcpClusterIndexRow[] }>(r)),
    createClusterIndex: (data: Partial<OcpClusterIndexRow>) => postJson<{ ok: boolean; row: OcpClusterIndexRow }>("/admin/ocp-cluster-index", data),
    updateClusterIndex: (id: number, data: Partial<OcpClusterIndexRow>) => putJson<{ ok: boolean; row: OcpClusterIndexRow }>(`/admin/ocp-cluster-index/${id}`, data),
    deleteClusterIndex: (id: number) => del<{ ok: boolean }>(`/admin/ocp-cluster-index/${id}`),

    listTerminalHostMap: () => fetch(`${BASE}/admin/ocp-terminal-host-map`).then((r) => json<{ ok: boolean; rows: OcpTerminalHostRow[] }>(r)),
    createTerminalHost: (data: Partial<OcpTerminalHostRow>) => postJson<{ ok: boolean; row: OcpTerminalHostRow }>("/admin/ocp-terminal-host-map", data),
    updateTerminalHost: (id: number, data: Partial<OcpTerminalHostRow>) => putJson<{ ok: boolean; row: OcpTerminalHostRow }>(`/admin/ocp-terminal-host-map/${id}`, data),
    deleteTerminalHost: (id: number) => del<{ ok: boolean }>(`/admin/ocp-terminal-host-map/${id}`),

    // OCP çalışma zamanı ayarları: oc'nin aranacağı yollar + zaman aşımları. Deploy
    // gerektirmeden değişir; playbook bunları extra_vars olarak alır.
    getOcpRuntimeConfig: () =>
      fetch(`${BASE}/admin/ocp-runtime-config`).then((r) => json<{ ok: boolean; config: OcpRuntimeConfig; defaults: OcpRuntimeConfig }>(r)),
    saveOcpRuntimeConfig: (config: OcpRuntimeConfig) =>
      putJson<{ ok: boolean; config: OcpRuntimeConfig }>("/admin/ocp-runtime-config", config),

    listEnvSuffixMap: () => fetch(`${BASE}/admin/env-suffix-map`).then((r) => json<{ ok: boolean; rows: EnvSuffixRow[] }>(r)),
    createEnvSuffix: (data: Partial<EnvSuffixRow>) => postJson<{ ok: boolean; row: EnvSuffixRow }>("/admin/env-suffix-map", data),
    updateEnvSuffix: (id: number, data: Partial<EnvSuffixRow>) => putJson<{ ok: boolean; row: EnvSuffixRow }>(`/admin/env-suffix-map/${id}`, data),
    deleteEnvSuffix: (id: number) => del<{ ok: boolean }>(`/admin/env-suffix-map/${id}`),

    listRestrictions: () => fetch(`${BASE}/admin/restrictions`).then((r) => json<{ ok: boolean; restrictions: RestrictionRow[] }>(r)),
    createRestriction: (data: { resourceType: string; resourceKey: string; description?: string }) =>
      postJson<{ ok: boolean; restriction: RestrictionRow }>("/admin/restrictions", data),
    updateRestriction: (id: number, data: { description?: string }) =>
      putJson<{ ok: boolean; restriction: RestrictionRow }>(`/admin/restrictions/${id}`, data),
    deleteRestriction: (id: number) => del<{ ok: boolean }>(`/admin/restrictions/${id}`),
    addGrant: (restrictionId: number, username: string) =>
      postJson<{ ok: boolean }>(`/admin/restrictions/${restrictionId}/grants`, { username }),
    removeGrant: (restrictionId: number, username: string) =>
      del<{ ok: boolean }>(`/admin/restrictions/${restrictionId}/grants/${encodeURIComponent(username)}`),

    listRequests: (params: { state?: string; platform?: string } = {}) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return fetch(`${BASE}/admin/requests${qs ? `?${qs}` : ""}`).then((r) => json<{ ok: boolean; requests: LogXv2Request[] }>(r));
    },
  },
};

export interface OcpClusterIndexRow { id: number; env: string; tenant: string; cluster_name: string; terminal_host: string | null; is_active: boolean }
export interface OcpTerminalHostRow { id: number; tenant: string; env: string; terminal_host: string; is_active: boolean }
export interface EnvSuffixRow { id: number; suffix: string; env_label: string; sort_order: number; is_active: boolean }
export interface OcpRuntimeConfig {
  /** Boş = otomatik keşif (playbook adayları + PATH). Dolu = kesin yol, keşfin önüne geçer. */
  ocBinary: string;
  ocBinaryCandidates: string[];
  ocAsyncTimeout: number;
  ocListTimeout: number;
  ocLogTimeout: number;
}
export interface RestrictionRow { id: number; resourceType: string; resourceKey: string; description: string | null; grants: string[] }
