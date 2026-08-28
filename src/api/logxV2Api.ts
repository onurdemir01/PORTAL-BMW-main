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
      // Durum kodu HATAYA ILISTIRILIR: cagiran 503 (hazir degil) ile 403'u ayirt
      // edebilsin. Eskiden bu dalda `status` yoktu ve hepsi ayni genel hataya donusuyordu.
      throw Object.assign(
        new Error(
          `Sunucu JSON yerine ${contentType.split(";")[0] || "bilinmeyen"} yanıt döndü ` +
          `(HTTP ${r.status}). İstek büyük olasılıkla uygulamaya ulaşmadan ters-proxy ` +
          `tarafından karşılandı — yöneticiye bildirin.`
        ),
        { status: r.status },
      );
    }
    const text = await r.text().catch(() => "");
    let message = text;
    try {
      const parsed = JSON.parse(text);
      message = parsed.error || parsed.message || text;
    } catch { /* duz metin hata */ }
    // HTTP durumu hataya iliştirilir: çağıranın "yetkin yok" (403) ile "sunucu hatası"nı
    // ayırt edebilmesi için tek yol bu — aksi halde ikisi de aynı boş ekranı gösterir.
    throw Object.assign(
      new Error(String(message).slice(0, 300) || `HTTP ${r.status}`),
      { status: r.status },
    );
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
  | "app_discovering" | "apps_discovered"
  | "transferring" | "ready" | "failed" | "expired";

/** `mtime` TIPI (2026-08-28 duzeltmesi): burada `string` yaziyordu ama gercek kaynak
 *  `ansible.builtin.find`'dir ve o epoch **sayi** dondurur (FileX ayni alani dogru
 *  yazmis — src/api/filexApi.ts). Yanlis tip, alanin yillarca HIC kullanilmamasinin
 *  sebeplerinden biriydi. Uretimde iki bicim de gorulebilecegi ve eski keşif
 *  kayitlari DB'de durdugu icin ikisi de kabul edilir; normalize etme isi
 *  `logFileMeta.normalizeMtime` icindedir (saniye/milisaniye epoch, ISO metin,
 *  hicbiri yoksa dosya adindaki tarih). */
export interface DiscoveredFile { path: string; size?: number; mtime?: number | string; environment?: string }
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

/** Envanterden gelen sunucu satırı (canlı sorgu değil). */
export interface LegacyHost { host: string; env: string; jbossVersion: string; status: string }

export interface DownloadInfo {
  token: string;
  filename: string;
  sizeBytes: number | null;
  expiresAt: string;
  /** Arşiv paylaşımlı staging yerine kaynak host'un YEREL yedek dizinine düştüyse true —
   *  portal o dizini göremiyorsa indirme 404 verir, kullanıcı önceden uyarılır. */
  isFallback?: boolean;
}

/** Sihirbazın gördüğü sadeleştirilmiş hazırlık kaydı. `reason` yalnızca ready=false iken dolu. */
export interface PlaybookReadiness {
  keyName: string;
  ready: boolean;
  reason: "disabled" | "template_missing" | "prompt_on_launch_disabled" | null;
}

export const logxV2Api = {
  createRequest: (platform: Platform) => postJson<{ ok: boolean; requestId: string }>("/requests", { platform }),

  getRequest: (requestId: string) =>
    fetch(`${BASE}/requests/${requestId}`).then((r) => json<{ ok: boolean; request: LogXv2Request; jobs: LogXv2Job[]; download: DownloadInfo | null; downloads?: DownloadInfo[] }>(r)),

  // ── Legacy ─────────────────────────────────────────────────────────────────
  // Uygulamanın sunucuları (envanterden: ortam, JBoss sürümü, durum). Sunucu seçimi
  // adımı bunu okur — canlı sorgu YOK, `status` envanterde hazır.
  legacyHosts: (app: string) =>
    fetch(`${BASE}/legacy/hosts?app=${encodeURIComponent(app)}`)
      .then((r) => json<{ ok: boolean; hosts: LegacyHost[] }>(r)),

  searchLegacyApps: (search: string) =>
    fetch(`${BASE}/legacy/apps?search=${encodeURIComponent(search)}`).then((r) => json<{ ok: boolean; apps: string[]; fallbackMode: boolean }>(r)),

  /** `hosts` verilirse YALNIZ o sunucular taranır; boşsa uygulamanın tüm sunucuları
   *  (eski davranış). Sunucular sunucu tarafında envantere karşı yeniden doğrulanır. */
  discoverLegacy: (requestId: string, app: string, hosts?: string[]) =>
    postJson<{ ok: boolean; jobId: number }>(`/legacy/${requestId}/discover`, { app, hosts }),

  discoverLegacyFallback: (requestId: string, hosts: string[]) =>
    postJson<{ ok: boolean; jobId: number }>(`/legacy/${requestId}/discover`, { hosts }),

  transferLegacy: (requestId: string, selected: { host: string; path: string }[]) =>
    postJson<{ ok: boolean; jobId: number }>(`/legacy/${requestId}/transfer`, { selected }),

  // ── OpenShift ──────────────────────────────────────────────────────────────
  getClusterTree: () => fetch(`${BASE}/ocp/cluster-index`).then((r) => json<{ ok: boolean; tree: Record<string, Record<string, string[]>> }>(r)),

  selectClusters: (requestId: string, env: string, tenant: string, clusters: string[]) =>
    postJson<{ ok: boolean; terminalHost: string }>(`/ocp/${requestId}/select`, { env, tenant, clusters }),

  // ── Keşif önbelleği (kullanıcılar arası paylaşımlı) ────────────────────────
  // Sihirbaz ÖNCE buradan okur: liste anında gelir. `stale` bayrağı verinin bayat
  // olduğunu söyler — kullanıcı isterse "Burada keşfet" ile yeniden tarar.
  cachedNamespaces: (env: string, tenant: string, cluster: string) =>
    fetch(`${BASE}/ocp/cache/namespaces?env=${encodeURIComponent(env)}&tenant=${encodeURIComponent(tenant)}&cluster=${encodeURIComponent(cluster)}`)
      .then((r) => json<CachedList<string>>(r)),

  cachedApps: (env: string, tenant: string, cluster: string, namespace: string) =>
    fetch(`${BASE}/ocp/cache/apps?env=${encodeURIComponent(env)}&tenant=${encodeURIComponent(tenant)}&cluster=${encodeURIComponent(cluster)}&namespace=${encodeURIComponent(namespace)}`)
      .then((r) => json<CachedList<OcpAppItem>>(r)),

  // ── Bağımsız zamanlanmış envanter (dbo.Openshift_Inventory) — BİRİNCİL kaynak ──
  // Portaldan ayrı, zamanlanmış bir Ansible job'ı besler; portal burada sadece okur,
  // hiçbir AWX job'ı tetiklemez — bu yüzden yanıt her zaman anındadır (bkz. server
  // ocp-inventory.cjs başlığı). cachedNamespaces/cachedApps yukarıda hâlâ dururlar
  // (sihirbazın canlı-keşif fallback'i onları kullanır) ama artık ikincil.
  inventoryNamespaces: (env: string, tenant: string, clusters: string[]) =>
    fetch(`${BASE}/ocp/inventory/namespaces?env=${encodeURIComponent(env)}&tenant=${encodeURIComponent(tenant)}&clusters=${encodeURIComponent(clusters.join(","))}`)
      .then((r) => json<CachedList<string>>(r)),

  inventoryApps: (env: string, tenant: string, clusters: string[], namespace: string) =>
    fetch(`${BASE}/ocp/inventory/apps?env=${encodeURIComponent(env)}&tenant=${encodeURIComponent(tenant)}&clusters=${encodeURIComponent(clusters.join(","))}&namespace=${encodeURIComponent(namespace)}`)
      .then((r) => json<CachedList<OcpAppItem>>(r)),

  /** LogX'in bağlı olduğu AWX template'leri launch'a hazır mı? Sihirbaz, başarısız
   *  olacağı belli bir job'ı hiç başlatmamak için okur (bkz. server playbook-readiness.cjs).
   *  Yanıt bilerek sade: altyapı ayrıntısı (template adı/ID) admin ucunda kalır. */
  playbookReadiness: () =>
    fetch(`${BASE}/playbook-readiness`).then((r) => json<{ ok: boolean; rows: PlaybookReadiness[] }>(r)),

  // Namespace içindeki uygulama/objeleri tarar (AWX job'ı başlatır).
  discoverApps: (requestId: string, namespaces: string[]) =>
    postJson<{ ok: boolean; jobId: number }>(`/ocp/${requestId}/apps/discover`, { namespaces }),

  discoverNamespaces: (requestId: string) =>
    postJson<{ ok: boolean; jobId: number }>(`/ocp/${requestId}/namespaces/discover`, {}),

  /** Tek çalıştırmada birden fazla (namespace, uygulama) çifti. Her çift için ayrı bir
   *  arşiv üretilir: `<cluster>__<namespace>__<uygulama>__<id>.zip`. */
  discoverFetchOcp: (requestId: string, targets: OcpFetchTarget[]) =>
    postJson<{ ok: boolean; jobId: number }>(`/ocp/${requestId}/discover-fetch`, { targets }),

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

    // Envanter tohumlaması BİR KERE çalışır; bu iki uç durumu gösterir ve gerekirse
    // (yanlış veri girildiyse) yeniden çalıştırır. Yeniden çalıştırma var olan satırlara
    // DOKUNMAZ, yalnızca eksik olanları pasif (is_active=0) olarak ekler.
    getBootstrapSeed: () =>
      fetch(`${BASE}/admin/ocp/bootstrap-seed`).then((r) =>
        json<{ ok: boolean; seeded: boolean; summary: Record<string, unknown> | null }>(r)),
    rerunBootstrapSeed: () =>
      postJson<{ ok: boolean; result: { inserted?: number; skipped?: number; failed?: number } }>(
        "/admin/ocp/bootstrap-seed/rerun"),

    // Cluster satırının CANLI kontrolü. Eskiden Admin > Ansible Yapılandırma'daki AYRI
    // OCP kataloğundaydı; o katalog boş kaldığı için aksiyonlar hiç kullanılamıyordu.
    testClusterConnection: (id: number) =>
      postJson<{ ok: boolean; message?: string; responseTimeMs?: number; status?: string }>(
        `/admin/ocp-cluster-index/${id}/test-connection`, {}),
    clusterPodStatus: (id: number, body: { namespace?: string; labelSelector?: string } = {}) =>
      postJson<{ ok: boolean; output?: string; jobId?: number; jumpHost?: string }>(
        `/admin/ocp-cluster-index/${id}/pod-status`, body),

    // Vault anahtar kataloğu: credentials.yaml içindeki DEĞİŞKEN ADLARI (parola DEĞİL).
    // Cluster satırındaki "Vault Anahtarı" alanının önerileri buradan gelir.
    listVaultKeys: () => fetch(`${BASE}/admin/ocp-vault-keys`).then((r) => json<{ ok: boolean; rows: OcpVaultKeyRow[] }>(r)),
    createVaultKey: (data: Partial<OcpVaultKeyRow>) => postJson<{ ok: boolean; row: OcpVaultKeyRow }>("/admin/ocp-vault-keys", data),
    updateVaultKey: (id: number, data: Partial<OcpVaultKeyRow>) => putJson<{ ok: boolean; row: OcpVaultKeyRow }>(`/admin/ocp-vault-keys/${id}`, data),
    deleteVaultKey: (id: number) => del<{ ok: boolean }>(`/admin/ocp-vault-keys/${id}`),

    // LogX'in kullandığı 5 playbook kaydının hazırlık durumu: template ID tanımlı mı,
    // AWX'te bulunuyor mu, "Prompt on launch" açık mı. Üretimde bir keşif 503 döndüğünde
    // sebebi tek bakışta görülsün diye (AWX'e girip job incelemeye gerek kalmasın).
    getPlaybookReadiness: () =>
      fetch(`${BASE}/admin/playbook-readiness`).then((r) => json<{ ok: boolean; rows: PlaybookReadinessRow[] }>(r)),

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

export interface OcpClusterIndexRow {
  id: number; env: string; tenant: string; cluster_name: string;
  terminal_host: string | null;
  /** OpenShift API adresi. Boşsa playbook eski AWX envanter dosyasına düşer. */
  api_url: string | null;
  /** credentials.yaml içindeki değişkenin ADI — parola PORTALDA TUTULMAZ. */
  vault_credential_key: string | null;
  /** `oc login --username` değeri. Boşsa OCP Çalıştırma Ayarları'ndaki genel varsayılan
   *  kullanılır; o da boşsa cluster keşifte anlaşılır bir hatayla elenir. */
  ocp_username: string | null;
  is_active: boolean;
  source?: string | null;
  last_synced_at?: string | null;
  sync_status?: string | null;
}
/** credentials.yaml içindeki vault DEĞİŞKEN ADI. PAROLA DEĞİL — parola portalda tutulmaz. */
export interface OcpVaultKeyRow {
  id: number;
  key_name: string;
  /** Yeni cluster satırı eklenirken "OCP Kullanıcı Adı" alanını ön-doldurmak için. */
  default_username: string | null;
  description: string | null;
  is_active: boolean;
}
export interface PlaybookReadinessRow {
  keyName: string;
  displayName: string;
  enabled: boolean;
  templateId: number | null;
  awxServerId: number;
  /** null = AWX'e sorulamadı (ağ/yetki) — "kapalı" ile karıştırılmamalı. */
  foundOnAwx: boolean | null;
  templateName: string | null;
  /** null = bilinmiyor. false ise AWX gönderilen extra_vars'ı SESSİZCE yok sayar. */
  promptOnLaunch: boolean | null;
}
export interface OcpTerminalHostRow { id: number; tenant: string; env: string; terminal_host: string; is_active: boolean }
export interface EnvSuffixRow { id: number; suffix: string; env_label: string; sort_order: number; is_active: boolean }
/** Önbellekten dönen liste + tazelik bilgisi. `stale` true ise veri TTL'ini geçmiştir
 *  ama yine de gösterilir (bayat liste, hiç liste olmamasından iyidir). */
export interface CachedList<T> {
  ok: boolean;
  items: T[];
  cached: boolean;
  fetchedAt: string | null;
  stale: boolean;
  /** `openshift_inventory` = yalnızca zamanlanmış envanter; `mixed` = envanter +
   *  kullanıcı taramalarının birleşimi (bkz. server/logx/v2/ocp-catalog.cjs). */
  source: string | null;
  /** Öğe adı → geldiği kaynak. Envanterde olmayanı kullanıcıya rozetlemek için. */
  sources?: Record<string, "inventory" | "discovery">;
  /** SADECE namespace listesinde: namespace → içindeki uygulama sayısı (envanterden).
   *  Anahtar yoksa sayı BİLİNMİYOR demektir — 0 ("uygulama yok") ile karıştırılmamalı. */
  counts?: Record<string, number>;
  /** Ad → hangi cluster'larda var. Çoklu cluster seçiminde liste BİRLEŞİK gösterilir,
   *  fark rozetle belirtilir; cluster süzgeci de bunun üzerinden çalışır. Anahtar yoksa
   *  üyelik bilinmiyor demektir — süzgeç o satırı GİZLEMEZ (bilgisizlik ≠ yokluk). */
  clusters?: Record<string, string[]>;
  /** SADECE uygulama listesinde: bu namespace en son ne zaman tarandı (hiç taranmadıysa null). */
  scannedAt?: string | null;
  /** Tarandı ve GERÇEKTEN boş çıktı. Sihirbaz bu durumda otomatik tarama yapmaz —
   *  aksi halde boş bir namespace her girişte yeni bir AWX job'ı açıyordu. */
  scannedEmpty?: boolean;
}

/** Log çekilecek bir (namespace, uygulama) çifti. */
export interface OcpFetchTarget { namespace: string; appName: string }

export interface OcpAppItem {
  kind: string;
  name: string;
  replicas: number | null;
  image: string | null;
  labelApp: string | null;
}

export interface OcpRuntimeConfig {
  /** Boş = otomatik keşif (playbook adayları + PATH). Dolu = kesin yol, keşfin önüne geçer. */
  ocBinary: string;
  ocBinaryCandidates: string[];
  ocAsyncTimeout: number;
  ocListTimeout: number;
  ocLogTimeout: number;
  /** `oc login --username` genel varsayılanı. Cluster satırındaki değer varsa O kazanır.
   *  Boş bırakılırsa playbook AWX'teki eski `username` değişkenine düşer. */
  defaultOcpUsername: string;
}
export interface RestrictionRow { id: number; resourceType: string; resourceKey: string; description: string | null; grants: string[] }
