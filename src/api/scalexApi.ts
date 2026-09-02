// src/api/scalexApi.ts — ScaleX (OCP replica durdurma / geri alma / ölçekleme).
//
// Sunucu karşılığı: server/scalex/index.cjs. Sözleşme bilinçli olarak DAR: ekran
// playbook'un survey alan adlarını (`execution_mode`, `allow_partial_execution`,
// `bulk_change_confirmation` …) HİÇ görmez — onları sunucu üretir.
import { safeJson } from "./http";

const BASE = "/api/scalex";

export type ScaleXAction = "stop" | "restore" | "scale";
export type ScaleXMode = "dry_run" | "apply";
export type DiscoveryMode = "workloads" | "state" | "health";

export interface ScaleXClusterTree {
  [env: string]: { [tenant: string]: string[] };
}

export interface ScaleXNamespaceList {
  items: string[];
  counts: Record<string, number>;
  sources: Record<string, string>;
  clusters: Record<string, string[]>;
  cached: boolean;
  fetchedAt: string | null;
  stale: boolean;
  source: string | null;
  /** Yetki kısıtı yüzünden listeden düşen namespace sayısı. Gizlemek yerine sayısını söylüyoruz. */
  hiddenCount: number;
}

export interface ScaleXWorkload {
  cluster: string;
  name: string;
  kind: string;
  resource: string;
  specReplicas: number;
  statusReplicas: number;
  readyReplicas: number;
  hasHpa: boolean;
  image: string | null;
  statePhase: string | null;
  previousReplicas: number | null;
  /** `Geri Al`ın seçilebilir olup olmadığını BU alan belirler. */
  restorable: boolean;
  /** `argocd:<app>` ya da `managed_by:<x>`; GitOps yönetimindeyse dolu. */
  gitops: string | null;
}

export interface ScaleXStateItem {
  cluster: string;
  appName: string;
  kind: string;
  configMap: string;
  previousReplicas: number | null;
  phase: string | null;
  createdAt: string | null;
  createdBy: string | null;
  jobId: string | null;
  /** Eski (`chaos-scale-state-`) önekli kayıt — ilk geri almadan sonra kaybolur. */
  legacy: boolean;
}

export interface ScaleXDiscoveryResult {
  overallStatus: "ok" | "warning" | "partial" | "error" | string;
  mode: DiscoveryMode | string;
  namespace: string;
  clusters: string[];
  failedClusters: string[];
  counts: { ok: number; warn: number; fail: number };
  problems: { cluster: string; step: string; status: string; detail: string }[];
  /** Namespace düzeyinde PDB uyarısı (hangi workload'u kapsadığı ucuza kanıtlanamaz). */
  pdbWarning: string | null;
  workloads?: ScaleXWorkload[];
  states?: ScaleXStateItem[];
  health?: { cluster: string; app: string; step: string; status: string; detail: string }[];
}

export interface ScaleXTargetResult {
  cluster: string;
  app: string;
  kind: string;
  status: "OK" | "WARN" | "FAIL" | string;
  detail: string;
}

export interface ScaleXRunResult {
  overallStatus: "OK" | "WARN" | "FAIL" | string;
  /** `validation` = girdi doğrulaması düştü, cluster'a hiç dokunulmadı. */
  stage: "execution" | "validation" | string;
  mode: string;
  action: string;
  namespace: string;
  clusters: string[];
  apps: string[];
  catalogSource: "portal" | "file" | string;
  /** Hiçbir şey uygulanmadı çünkü ön kontrol düştü — FAIL'den AYRI gösterilmeli. */
  strictBlocked: boolean;
  counts: {
    planned: number; ok: number; warn: number; fail: number;
    precheckFail: number; verifyOk: number; verifyFail: number; blocked: number; hpaSeen: number;
  };
  targets: ScaleXTargetResult[];
  targetsTruncated: boolean;
  targetsTotal: number;
  rows: string[];
  rowsTruncated: boolean;
  rowsTotal: number;
  validationError: string | null;
  failedTask: string | null;
  jobId: string;
}

export interface ScaleXBlastRadius {
  clusterCount: number;
  appCount: number;
  targets: number;
  isProd: boolean;
  action: string;
  multiCluster: boolean;
  requiresWrittenConfirm: boolean;
  requiresSecondPerson: boolean;
  exceedsMaxTargets: boolean;
}

export interface ScaleXGatePolicy {
  oco: "require" | "warn" | "skip";
  smart: "require" | "skip";
  reason: string | null;
}

export interface ScaleXPreview {
  ok: boolean;
  blastRadius: ScaleXBlastRadius;
  gatePolicy: ScaleXGatePolicy;
  /** HPA sabitleme bu işlem için sunulabilir mi (stop'ta asla). */
  hpaPinAllowed: boolean;
  targets: { env: string; tenant: string; namespace: string; clusters: string[]; apps: string[] };
}

export interface ScaleXJobRef { serverId: number; templateId: number; jobId: number; status: string }

export interface ScaleXStoppedItem {
  id: number;
  env: string; tenant: string; clusterName: string; namespace: string; appName: string;
  workloadKind: string | null;
  previousReplicas: number | null;
  phase: string | null;
  stoppedBy: string | null;
  stoppedAt: string | null;
  lastSeenAt: string | null;
  driftStatus: "in_sync" | "missing_on_cluster" | "unknown_to_portal" | string;
}

export interface ScaleXScope {
  env: string; tenant: string; namespace: string; clusters: string[]; apps?: string[];
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return safeJson(r);
}

export const scalexApi = {
  async clusters(): Promise<{ ok: boolean; tree: ScaleXClusterTree; message?: string }> {
    return safeJson(await fetch(`${BASE}/clusters`));
  },

  async namespaces(env: string, tenant: string, clusters: string[]): Promise<ScaleXNamespaceList & { ok: boolean; message?: string }> {
    const q = new URLSearchParams({ env, tenant, clusters: clusters.join(",") });
    return safeJson(await fetch(`${BASE}/namespaces?${q}`));
  },

  discover(scope: ScaleXScope, mode: DiscoveryMode = "workloads") {
    return post<ScaleXJobRef & { ok: boolean; mode: string; message?: string }>("/discover", { ...scope, mode });
  },

  async discoverStatus(serverId: number, jobId: number) {
    return safeJson(await fetch(`${BASE}/discover/${serverId}/${jobId}/status`)) as Promise<{
      ok: boolean; status: string; finished: boolean; failed: boolean;
      output: string; result: ScaleXDiscoveryResult | null; message?: string;
    }>;
  },

  /** HİÇBİR ŞEY TETİKLEMEZ. Yalnızca önizleme ekranını besler. */
  preview(scope: ScaleXScope & { action: ScaleXAction; executionMode: ScaleXMode; targetReplicas?: number | string; verificationTimeout?: string }) {
    return post<ScaleXPreview & { message?: string }>("/preview", scope);
  },

  run(body: ScaleXScope & {
    action: ScaleXAction; executionMode: ScaleXMode;
    targetReplicas?: number | string; verificationTimeout?: string;
    allowPartial?: boolean; reason?: string; mailCc?: string; hpaPin?: boolean;
    /** Geri almada hedef replica sayilari — HPA sabitlemesini yalnizca KISITLAR. */
    restoreTargets?: (number | null)[];
    // `ocoAction` BILEREK YOK: ScaleX zamanlama yapmaz, sunucu tek gecerli cevabi
    // ('later') kendisi verir. Alani burada tutmak, ekranin dolduramadigi bir
    // sozlesme alani birakmak olurdu (bkz. server/scalex/index.cjs kapi blogu).
    ocoNumber?: string;
    writtenConfirm?: string;
  }) {
    return post<ScaleXJobRef & {
      ok: boolean; message?: string; blastRadius?: ScaleXBlastRadius;
      writtenConfirmRequired?: boolean; reasonRequired?: boolean;
      ocoRequired?: boolean; ocoExpired?: boolean; ocoDecisionRequired?: boolean;
      ocoDeferred?: boolean; ocoScheduled?: boolean;
      pendingApproval?: boolean; ticketId?: number; externalTicketId?: string;
      oco?: { ocoNumber: string; subject: string; windowStartText: string; windowEndText: string; phase: string };
    }>("/run", body);
  },

  async runStatus(serverId: number, jobId: number) {
    return safeJson(await fetch(`${BASE}/run/${serverId}/${jobId}/status`)) as Promise<{
      ok: boolean; status: string; finished: boolean; failed: boolean;
      output: string; result: ScaleXRunResult | null; catalogWarning: string | null; message?: string;
    }>;
  },

  cancel(serverId: number, jobId: number) {
    return post<{ ok: boolean; canceled?: boolean; message?: string }>(`/cancel/${serverId}/${jobId}`, {});
  },

  /**
   * Kapsam OPSIYONEL: verilmezse kullanicinin gorebildigi TUM durdurulmus kayitlar
   * doner ("hizli aksiyon" paneli sihirbazin ilk adiminda da gorunuyor).
   */
  async stopped(env?: string, tenant?: string, cluster?: string) {
    const scoped = !!(env && tenant);
    const q = new URLSearchParams({
      ...(scoped ? { env: env as string, tenant: tenant as string } : {}),
      ...(scoped && cluster ? { cluster } : {}),
    });
    return safeJson(await fetch(`${BASE}/stopped?${q}`)) as Promise<{ ok: boolean; items: ScaleXStoppedItem[]; message?: string;
      /** Yetki nedeniyle gizlenen kayit sayisi — panel bunu SOYLEMELI, yoksa "kayit yok" yalan olur. */
      hiddenCount?: number; truncated?: boolean; limit?: number }>;
  },

  restoreAll(body: { env: string; tenant: string; reason: string }) {
    return post<{
      ok: boolean; message?: string; reasonRequired?: boolean; code?: string;
      launched?: { serverId: number; jobId: number; cluster: string; namespace: string; apps: string[] }[];
      /**
       * Prod'da toplu geri alma da SMART onayindan gecer (tekil `Geri Al` ile ayni
       * politika). Bu gruplar icin AWX'te HENUZ IS YOKTUR — onay geldiginde sunucu
       * tarafi baslatir. Panel bunu `launched` ile KARISTIRMAMALI.
       */
      pendingApproval?: { cluster: string; namespace: string; apps: string[]; ticketId?: number; externalTicketId?: string }[];
      /** Kapinin reddettigi ya da baslatilamayan gruplar — sessizce yutulmamali. */
      blocked?: { cluster: string; namespace: string; message: string }[];
    }>("/restore-all", body);
  },

  adopt(body: ScaleXScope & { appName: string; workloadKind?: string; previousReplicas?: number; stoppedBy?: string }) {
    return post<{ ok: boolean; message?: string }>("/adopt", body);
  },

  async history() {
    return safeJson(await fetch(`${BASE}/history`)) as Promise<{ ok: boolean; items: Record<string, unknown>[]; message?: string }>;
  },
};
