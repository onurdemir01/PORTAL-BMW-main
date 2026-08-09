// src/api/opsxApi.ts — OpsX (Güvenli Uygulama Operasyonları) istemcisi.
//
// LogX log İNDİRİR; OpsX uygulama üzerinde İŞLEM yapar (restart/stop/start).
// Uygulama listesi ve cluster kataloğu LogX ile AYNI kaynaktan gelir (backend
// server/opsx/index.cjs bunları yeniden kullanır) — burada ayrı bir gerçek yok.
import { safeJson } from "./http";

const BASE = "/api/opsx";

export type OpsxPlatform = "legacy" | "openshift";
export type OpsxOperation = "restart" | "stop" | "start" | "threaddump" | "heapdump";

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
}

// Openshift bacağındaki 4 işlem butonu — sadece "enabled: true" olan tıklanabilir.
export type OpsxOcpOperation = "restart" | "threaddump" | "heapdump" | "tcpdump";
export interface OpsxOcpOperationDef {
  key: OpsxOcpOperation;
  label: string;
  enabled: boolean;
}

// oc_input'a giden tek bir namespace/uygulama çifti.
export interface OpsxOcpPair {
  namespace: string;
  application: string;
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

  // OpenShift ortam/cluster ağacı — LogX'in kataloğunun aynısı. tree[env][tenant] = [cluster_name,...]
  // Openshift bacağında artık yalnız env + tenant (oc_cluster) seçilir, tek tek cluster_name değil —
  // gerçek playbook zaten tenant_env grubundaki TÜM cluster'ları geziyor.
  getClusters: (): Promise<{ ok: boolean; tree: Record<string, Record<string, string[]>> }> =>
    fetch(`${BASE}/clusters`).then(safeJson),

  // Desteklenen işlemler sunucudan gelir (ön yüz hardcode etmesin).
  getOperations: (): Promise<{ ok: boolean; operations: OpsxOperationDef[] }> =>
    fetch(`${BASE}/operations`).then(safeJson),

  // Openshift_Inventory'den, seçilen env/tenant'a ait cluster'larda görülmüş namespace'ler.
  // Kullanıcı bunlardan seçebilir ya da bilmiyorsa serbest metin girebilir.
  getOcpNamespaces: (env: string, tenant: string): Promise<{ ok: boolean; namespaces: string[] }> =>
    fetch(`${BASE}/ocp/namespaces?env=${encodeURIComponent(env)}&tenant=${encodeURIComponent(tenant)}`).then(safeJson),

  // Namespace seçildiğinde otomatik dolan, SADECE listeden seçilebilen uygulama dropdown'u.
  getOcpApps: (env: string, tenant: string, namespace: string): Promise<{ ok: boolean; apps: string[] }> =>
    fetch(`${BASE}/ocp/apps?env=${encodeURIComponent(env)}&tenant=${encodeURIComponent(tenant)}&namespace=${encodeURIComponent(namespace)}`).then(safeJson),

  // Openshift bacağındaki işlem butonları (restart/threaddump/heapdump/tcpdump) — hangisi aktif sunucudan gelir.
  getOcpOperations: (): Promise<{ ok: boolean; operations: OpsxOcpOperationDef[] }> =>
    fetch(`${BASE}/ocp/operations`).then(safeJson),

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
    pairs?: OpsxOcpPair[];
    ocOperation?: OpsxOcpOperation;
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
