// src/api/opsxApi.ts — OpsX (Güvenli Uygulama Operasyonları) istemcisi.
//
// LogX log İNDİRİR; OpsX uygulama üzerinde İŞLEM yapar (restart/stop/start).
// Uygulama listesi ve cluster kataloğu LogX ile AYNI kaynaktan gelir (backend
// server/opsx/index.cjs bunları yeniden kullanır) — burada ayrı bir gerçek yok.
import { safeJson } from "./http";
import type { CachedList, OcpAppItem } from "./logxV2Api";

const BASE = "/api/opsx";

export type OpsxPlatform = "legacy" | "openshift";
/** Legacy platformun işlem kümesi. */
export type OpsxLegacyOperation = "restart" | "stop" | "start" | "threaddump" | "heapdump";
/** OpenShift'in genişletilmiş kümesi: legacy karşılıkları + salt-okunur teşhis + pod silme.
 *  Yalnızca "portal" playbook modunda kullanılır (bkz. Admin > OpsX Yapılandırma). */
export type OpsxOcpOperation =
  | OpsxLegacyOperation
  | "scale"
  | "podlist"
  | "describe"
  | "events"
  | "rolloutstatus"
  | "podrestart";
export type OpsxOperation = OpsxLegacyOperation | OpsxOcpOperation;

export interface OpsxHost {
  host: string;
  env: string;
  jbossVersion: string;
  // "running" | "stopped" | "" — MWAppsInventory.status'tan dogrudan okunur (kucuk
  // harfe cevrilir). Canli bir Ansible sorgusu YOK; bu deger envanterde hazir.
  status: string;
}

export interface OpsxOperationDef {
  key: OpsxOperation;
  label: string;
  /** Hangi `oc` komutuna karşılık geldiği — kullanıcı ne olacağını görsün. */
  hint?: string;
  /** true ise ön yüz EK ONAY ister (durdurma, pod silme, heap dump…). */
  destructive?: boolean;
  /** Hiçbir şeyi değiştirmeyen teşhis adımları. */
  readOnly?: boolean;
}

export interface OpsxRunResult {
  ok: boolean;
  jobId: number | null;
  status: string | null;
  awxServerId: number;
  templateId: number;
  // AWX'e gönderilen gövdenin aynısı — son ekranda gösterilir. Legacy'de üst
  // seviyede `limit` bulunur; Openshift'te bulunmaz (her şey extra_vars içinde).
  sentBody: { limit?: string; extra_vars: Record<string, unknown> };
}

export interface OpsxJobStatus {
  ok: boolean;
  status: string;
  output: string;
  finished?: string;
  failed?: boolean;
}

export const opsxApi = {
  // Uygulama arama — LogX legacy ile aynı kaynak; DB erişilemezse fallbackMode=true
  // ile son bilinen snapshot döner.
  searchApps: (search: string): Promise<{ ok: boolean; apps: string[]; fallbackMode: boolean }> =>
    fetch(`${BASE}/apps?search=${encodeURIComponent(search)}`).then(safeJson),

  // Seçilen uygulamanın bulunduğu sunucular (host + ortam).
  getHosts: (app: string): Promise<{ ok: boolean; hosts: OpsxHost[] }> =>
    fetch(`${BASE}/hosts?app=${encodeURIComponent(app)}`).then(safeJson),

  // OpenShift ortam/cluster ağacı — LogX'in kataloğunun aynısı.
  getClusters: (): Promise<{ ok: boolean; tree: Record<string, Record<string, string[]>> }> =>
    fetch(`${BASE}/clusters`).then(safeJson),

  // Desteklenen işlemler sunucudan gelir (ön yüz hardcode etmesin). Küme platforma
  // göre değişir: OpenShift'te legacy karşılıkları + teşhis adımları + pod silme.
  getOperations: (platform: OpsxPlatform = "legacy"): Promise<{ ok: boolean; platform: OpsxPlatform; operations: OpsxOperationDef[] }> =>
    fetch(`${BASE}/operations?platform=${encodeURIComponent(platform)}`).then(safeJson),

  // OCP keşif önbelleği — LogX ile AYNI veri, ayrı HTTP kapısı. LogX router'ı
  // `requireVisiblePrefix('LogX')` arkasında olduğu için OpsX kendi ucunu kullanır.
  cachedNamespaces: (env: string, tenant: string, cluster: string) =>
    fetch(`${BASE}/ocp/cache/namespaces?env=${encodeURIComponent(env)}&tenant=${encodeURIComponent(tenant)}&cluster=${encodeURIComponent(cluster)}`)
      .then(safeJson) as Promise<CachedList<string>>,

  cachedApps: (env: string, tenant: string, cluster: string, namespace: string) =>
    fetch(`${BASE}/ocp/cache/apps?env=${encodeURIComponent(env)}&tenant=${encodeURIComponent(tenant)}&cluster=${encodeURIComponent(cluster)}&namespace=${encodeURIComponent(namespace)}`)
      .then(safeJson) as Promise<CachedList<OcpAppItem>>,

  // İşlemi tetikler. AWX job template'i tanımlı değilse sunucu 501 + açıklayıcı
  // mesaj döner (sessizce yanlış job tetiklenmez).
  run: (body: {
    platform: OpsxPlatform;
    // Legacy alanları
    application?: string;
    operation?: OpsxOperation;
    hosts?: string[];
    // Openshift alanları
    env?: string;
    tenant?: string;
    clusters?: string[];
    namespace?: string;
    appName?: string;
    /** "portal" playbook modunda gönderilir; boşsa playbook kind'i kendisi çözer. */
    objectKind?: string;
    podName?: string;
    replicas?: number | null;
  }): Promise<OpsxRunResult> =>
    fetch(`${BASE}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(safeJson),

  // Tetiklenen job'ın canlı durumu + stdout'u. Self Service'in ss/job-status'uyla
  // aynı desen — kendini-zamanlayan adaptif polling ile çağrılması beklenir
  // (bkz. OpsXWizardPage.tsx).
  jobStatus: (serverId: number, jobId: number): Promise<OpsxJobStatus> =>
    fetch(`${BASE}/job-status/${serverId}/${jobId}`).then(safeJson),
};
