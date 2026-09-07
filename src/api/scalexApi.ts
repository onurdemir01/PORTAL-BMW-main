// src/api/scalexApi.ts — ScaleX (OCP replica durdurma / geri alma / ölçekleme).
//
// Sunucu karşılığı: server/scalex/index.cjs. Sözleşme bilinçli olarak DAR: ekran
// playbook'un survey alan adlarını (`execution_mode`, `allow_partial_execution`,
// `bulk_change_confirmation` …) HİÇ görmez — onları sunucu üretir.
import { safeJson } from './http';

const BASE = '/api/scalex';

export type ScaleXAction = 'stop' | 'restore' | 'scale';
export type ScaleXMode = 'dry_run' | 'apply';
export type DiscoveryMode = 'workloads' | 'state' | 'health';

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
  /**
   * OKUNAMAYAN kaynaklar ('inventory' / 'cache'). Katalog bir kaynak patladığında
   * diğerinden devam eder — dayanıklılık böyle olmalı — ama liste o zaman EKSİK
   * olur. Boş dizi "iki kaynak da okundu" demektir; dolu dizi geldiğinde ekran
   * "bulunamadı" DEMEMELİ, "eksik olabilir" demeli.
   */
  unreadableSources?: string[];
}

/** Keşfin bir workload tipi hakkında bildirdiği sonuç. */
export interface ScaleXKindReport {
  cluster: string;
  /** Kısa ad: deploy | sts | dc | rollout | ds | cronjob */
  kind: string;
  /** Cluster'daki TAM kaynak adı (`statefulsets.apps`). RBAC cümlesi bunu kullanır —
   *  kısa ad platform ekibine yanlış metin götürür. Sürüm bildirmeyen eski pakette null. */
  resource: string | null;
  /** Kullanıcıya gösterilen ad: Deployment, StatefulSet, ... */
  display: string;
  /** Bu tipe BAKILABİLDİ mi? */
  readable: boolean;
  found: number;
  scalable: boolean;
  /** `no_permission` — platformdan istenebilir; `api_absent` — bu cluster'da yok. */
  reason: string | null;
  verb: string | null;
}

/** Kesifte OKUNAMAYAN bir nesne tipinin BIRIKMIS kaydi (yalnizca Admin).
 *  `reason` iki degerden biri ve ayrim KRITIK:
 *    `no_permission` → platformdan ISTENEBILIR (genellikle `view` ClusterRole binding)
 *    `api_absent`    → o tip cluster'da kurulu DEGIL; yapilacak bir sey YOK.
 *  Ikisini karistirmak, asla cozulmeyecek bir RBAC talebi acmak demektir. */
export interface ScaleXRbacFinding {
  id: number;
  env: string;
  tenant: string;
  cluster: string;
  namespace: string;
  kind: string;
  resource: string | null;
  reason: 'no_permission' | 'api_absent';
  verb: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
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
  /**
   * REPLICA İLE ÖLÇEKLENEBİLİR Mİ? DaemonSet düğüm sayısıyla ölçeklenir, CronJob
   * `spec.suspend` ile durdurulur — ikisi de replica semantiği TAŞIMAZ. Listede
   * görünürler (kullanıcı "namespace'imde var ama ScaleX'te yok" demesin) ama
   * SEÇİLEMEZLER. Sürüm bildirmeyen eski bir paket bu alanı hiç göndermez; o
   * paket zaten yalnızca ölçeklenebilir tipleri listeliyordu, `undefined` =
   * ölçeklenebilir sayılır.
   */
  scalable?: boolean;
  /** `node_scheduled` | `suspend_not_replicas` — neden ölçeklenemediği. */
  notScalableReason?: string | null;
  /** CronJob'a özgü: cron ifadesi ve askıya alınmış olup olmadığı. */
  schedule?: string | null;
  suspended?: boolean | null;
  /** DaemonSet'e özgü: kaç düğümde çalışması bekleniyor. */
  desired?: number | null;
  /**
   * Bu satır NEREDEN geldi?
   *   `discovery` — canlı keşiften; `specReplicas`/`readyReplicas`/`image`/`hasHpa`
   *                 GERÇEK değerler ve ekranda gösterilebilir.
   *   `mirror`    — portal aynasından türetilmiş sentetik satır (panelden ya da
   *                 sonuç ekranından gelen "Geri Al" kısayolu). O alanlar UYDURMA
   *                 (0/null) ve ASLA gösterilmemeli — prod'da tek tıkla apply'a
   *                 giden akışta ekran "0/0 hazır, imaj yok" diye yanlış bir
   *                 gerçeklik sunardı.
   *
   * ZORUNLU alan: opsiyonel olsaydı yeni bir sentetik yol eklendiğinde unutulur ve
   * uydurma metrikler sessizce ekrana düşerdi. TypeScript her kurulum yerini
   * karar vermeye zorlasın.
   */
  source: 'discovery' | 'mirror';
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
  overallStatus: 'ok' | 'warning' | 'partial' | 'error' | string;
  mode: DiscoveryMode | string;
  namespace: string;
  clusters: string[];
  failedClusters: string[];
  counts: { ok: number; warn: number; fail: number };
  problems: { cluster: string; step: string; status: string; detail: string }[];
  /** Namespace düzeyinde PDB uyarısı (hangi workload'u kapsadığı ucuza kanıtlanamaz). */
  pdbWarning: string | null;
  workloads?: ScaleXWorkload[];
  /** Keşfin BAKTIĞI her tip için ne olduğu: kaç tane bulundu, ya da neden
   *  bakılamadı. Bu ayrım olmadan ekran "StatefulSet yok" ile "StatefulSet'e
   *  bakamadım"ı ayırt edemiyordu. */
  kindReports?: ScaleXKindReport[];
  /** AWX'te KOŞAN paketin sürümü ("0" = sürüm bildirmeyen eski paket). */
  packageVersion?: string;
  /** Portalın BEKLEDİĞİ sürüm — uyuşmazlıkta ekran tahmin etmez, söyler. */
  expectedPackageVersion?: string;
  states?: ScaleXStateItem[];
  health?: { cluster: string; app: string; step: string; status: string; detail: string }[];
}

export interface ScaleXTargetResult {
  cluster: string;
  app: string;
  kind: string;
  status: 'OK' | 'WARN' | 'FAIL' | string;
  detail: string;
}

export interface ScaleXRunResult {
  overallStatus: 'OK' | 'WARN' | 'FAIL' | string;
  /** `validation` = girdi doğrulaması düştü, cluster'a hiç dokunulmadı. */
  stage: 'execution' | 'validation' | string;
  mode: string;
  action: string;
  namespace: string;
  clusters: string[];
  apps: string[];
  catalogSource: 'portal' | 'file' | string;
  /** Hiçbir şey uygulanmadı çünkü ön kontrol düştü — FAIL'den AYRI gösterilmeli. */
  strictBlocked: boolean;
  counts: {
    planned: number;
    ok: number;
    warn: number;
    fail: number;
    precheckFail: number;
    verifyOk: number;
    verifyFail: number;
    blocked: number;
    hpaSeen: number;
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
  oco: 'require' | 'warn' | 'skip';
  smart: 'require' | 'skip';
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

export interface ScaleXJobRef {
  serverId: number;
  templateId: number;
  jobId: number;
  status: string;
}

export interface ScaleXStoppedItem {
  id: number;
  env: string;
  tenant: string;
  clusterName: string;
  namespace: string;
  appName: string;
  workloadKind: string | null;
  previousReplicas: number | null;
  phase: string | null;
  stoppedBy: string | null;
  stoppedAt: string | null;
  lastSeenAt: string | null;
  driftStatus: 'in_sync' | 'missing_on_cluster' | 'unknown_to_portal' | string;
  /**
   * Kaç kez geri alınmaya ÇALIŞILDI. `0` = hiç denenmedi, `>0` = denendi ve OLMADI.
   * Başarılı geri almada satır zaten silinir, yani bu alan yalnızca başarısız
   * denemeleri sayar. Bu ayrım olmadan "hiç denenmemiş" ile "denendi, olmadı"
   * ekranda AYNI görünüyordu.
   */
  restoreAttempts?: number;
  lastRestoreAt?: string | null;
  /** Son başarısız denemenin sebebi — kullanıcı neden olmadığını görebilsin. */
  lastRestoreError?: string | null;
}

export interface ScaleXScope {
  env: string;
  tenant: string;
  namespace: string;
  clusters: string[];
  apps?: string[];
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return safeJson(r);
}

export const scalexApi = {
  async clusters(): Promise<{ ok: boolean; tree: ScaleXClusterTree; message?: string }> {
    return safeJson(await fetch(`${BASE}/clusters`));
  },

  async namespaces(
    env: string,
    tenant: string,
    clusters: string[],
  ): Promise<ScaleXNamespaceList & { ok: boolean; message?: string }> {
    const q = new URLSearchParams({ env, tenant, clusters: clusters.join(',') });
    return safeJson(await fetch(`${BASE}/namespaces?${q}`));
  },

  discover(scope: ScaleXScope, mode: DiscoveryMode = 'workloads') {
    return post<ScaleXJobRef & { ok: boolean; mode: string; message?: string }>('/discover', {
      ...scope,
      mode,
    });
  },

  /**
   * Canlı namespace taraması. Katalogda (envanter ∪ önbellek) olmayan bir namespace'e
   * ulaşmanın TEK yolu — LogX'te bu düğme vardı, ScaleX'te yoktu.
   * Sonuç PAYLAŞILAN önbelleğe yazılır: LogX de aynı taramadan faydalanır.
   */
  async discoverNamespaces(env: string, tenant: string, clusters: string[]) {
    return safeJson(
      await fetch(`${BASE}/namespaces/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ env, tenant, clusters }),
      }),
    ) as Promise<{
      ok: boolean;
      serverId: number;
      jobId: number;
      status: string;
      message?: string;
    }>;
  },

  async discoverNamespacesStatus(serverId: number, jobId: number, env: string, tenant: string) {
    const q = new URLSearchParams({ env, tenant });
    return safeJson(
      await fetch(`${BASE}/namespaces/discover/${serverId}/${jobId}/status?${q}`),
    ) as Promise<{
      ok: boolean;
      status: string;
      finished: boolean;
      failed: boolean;
      /** Cluster başına sonuç — "hiçbiri taranamadı" ile "namespace yok" ayrı şeyler. */
      clusters: { cluster: string; status: string; count: number; error: string }[];
      message?: string;
    }>;
  },

  async discoverStatus(serverId: number, jobId: number) {
    return safeJson(await fetch(`${BASE}/discover/${serverId}/${jobId}/status`)) as Promise<{
      ok: boolean;
      status: string;
      finished: boolean;
      failed: boolean;
      output: string;
      result: ScaleXDiscoveryResult | null;
      message?: string;
    }>;
  },

  /** HİÇBİR ŞEY TETİKLEMEZ. Yalnızca önizleme ekranını besler. */
  preview(
    scope: ScaleXScope & {
      action: ScaleXAction;
      executionMode: ScaleXMode;
      targetReplicas?: number | string;
      verificationTimeout?: string;
    },
  ) {
    return post<ScaleXPreview & { message?: string }>('/preview', scope);
  },

  run(
    body: ScaleXScope & {
      action: ScaleXAction;
      executionMode: ScaleXMode;
      targetReplicas?: number | string;
      verificationTimeout?: string;
      allowPartial?: boolean;
      reason?: string;
      mailCc?: string;
      hpaPin?: boolean;
      /** Geri almada hedef replica sayilari — HPA sabitlemesini yalnizca KISITLAR. */
      restoreTargets?: (number | null)[];
      /** KESIFTE gorulen workload tipleri. Playbook tipi tahmin etmek yerine bunu
       *  kullanir; "ayni ad hem Deployment hem DeploymentConfig" belirsizligi isi
       *  dusurmez. Sunucu listeyi `apps` ve bilinen tiplere karsi suzer. Aynadan
       *  turetilen (bayat) satirlar GONDERILMEZ. */
      workloadKinds?: { name: string; kind: string }[];
      /** CLUSTER BASINA TIP HARITASI: ayni uygulama adi farkli cluster'larda farkli
       *  tipte olabilir. Her cluster icin "app=kind,app=kind" biciminde bir harita
       *  gonderilir; playbook o cluster icin kendi haritasini kullanir. */
      clusterWorkloadKinds?: { cluster: string; name: string; kind: string }[];
      // `ocoAction` BILEREK YOK: ScaleX zamanlama yapmaz, sunucu tek gecerli cevabi
      // ('later') kendisi verir. Alani burada tutmak, ekranin dolduramadigi bir
      // sozlesme alani birakmak olurdu (bkz. server/scalex/index.cjs kapi blogu).
      ocoNumber?: string;
      writtenConfirm?: string;
    },
  ) {
    return post<
      ScaleXJobRef & {
        ok: boolean;
        message?: string;
        blastRadius?: ScaleXBlastRadius;
        writtenConfirmRequired?: boolean;
        reasonRequired?: boolean;
        ocoRequired?: boolean;
        ocoExpired?: boolean;
        ocoDecisionRequired?: boolean;
        ocoDeferred?: boolean;
        ocoScheduled?: boolean;
        pendingApproval?: boolean;
        ticketId?: number;
        externalTicketId?: string;
        oco?: {
          ocoNumber: string;
          subject: string;
          windowStartText: string;
          windowEndText: string;
          phase: string;
        };
      }
    >('/run', body);
  },

  async runStatus(serverId: number, jobId: number) {
    return safeJson(await fetch(`${BASE}/run/${serverId}/${jobId}/status`)) as Promise<{
      ok: boolean;
      status: string;
      finished: boolean;
      failed: boolean;
      output: string;
      result: ScaleXRunResult | null;
      catalogWarning: string | null;
      message?: string;
    }>;
  },

  cancel(serverId: number, jobId: number) {
    return post<{ ok: boolean; canceled?: boolean; message?: string }>(
      `/cancel/${serverId}/${jobId}`,
      {},
    );
  },

  /**
   * Kapsam OPSIYONEL: verilmezse kullanicinin gorebildigi TUM durdurulmus kayitlar
   * doner ("hizli aksiyon" paneli sihirbazin ilk adiminda da gorunuyor).
   */
  /**
   * Uygulama ADI/TIPI listesi — ANINDA, AWX'e hiç dokunmadan (paylaşılan katalog).
   * CANLI veri (replica, HPA, GitOps, durum) BU UÇTAN GELMEZ; onlar `discover` ile
   * gelir ve ekran sütunları sonradan doldurur. Bayat bir replica sayısı ya da
   * `restorable` bayrağı YANLIŞ İŞLEM demek olurdu.
   */
  async apps(scope: { env: string; tenant: string; namespace: string; clusters: string[] }) {
    const q = new URLSearchParams({
      env: scope.env,
      tenant: scope.tenant,
      namespace: scope.namespace,
      clusters: scope.clusters.join(','),
    });
    return safeJson(await fetch(`${BASE}/apps?${q}`)) as Promise<{
      ok: boolean;
      message?: string;
      items: { name: string; kind?: string | null }[];
      clusters: Record<string, string[]>;
      sources: Record<string, string>;
      /** Yetki nedeniyle gizlenen uygulama sayısı — söylenmeden "yok" demek yalan olur. */
      hiddenCount?: number;
      /** Bunlarin kaci SAHIPLIK yuzunden gizlendi (yetki degil) — kullanici
       *  "listede yok" ile "sana gosterilmiyor"u ayirt edebilmeli. */
      hiddenByOwnership?: number;
      cached?: boolean;
      fetchedAt?: string | null;
      stale?: boolean;
      scannedAt?: string | null;
      scannedEmpty?: boolean;
      source?: string;
    }>;
  },

  async stopped(env?: string, tenant?: string, cluster?: string) {
    const scoped = !!(env && tenant);
    const q = new URLSearchParams({
      ...(scoped ? { env: env as string, tenant: tenant as string } : {}),
      ...(scoped && cluster ? { cluster } : {}),
    });
    return safeJson(await fetch(`${BASE}/stopped?${q}`)) as Promise<{
      ok: boolean;
      items: ScaleXStoppedItem[];
      message?: string;
      /** Yetki nedeniyle gizlenen kayit sayisi — panel bunu SOYLEMELI, yoksa "kayit yok" yalan olur. */
      hiddenCount?: number;
      /** Bunlarin kaci SAHIPLIK yuzunden gizlendi (yetki degil) — kullanici
       *  "listede yok" ile "sana gosterilmiyor"u ayirt edebilmeli. */
      hiddenByOwnership?: number;
      truncated?: boolean;
      limit?: number;
    }>;
  },

  restoreAll(body: { env: string; tenant: string; reason: string }) {
    return post<{
      ok: boolean;
      message?: string;
      reasonRequired?: boolean;
      code?: string;
      launched?: {
        serverId: number;
        jobId: number;
        cluster: string;
        namespace: string;
        apps: string[];
      }[];
      /**
       * Prod'da toplu geri alma da SMART onayindan gecer (tekil `Geri Al` ile ayni
       * politika). Bu gruplar icin AWX'te HENUZ IS YOKTUR — onay geldiginde sunucu
       * tarafi baslatir. Panel bunu `launched` ile KARISTIRMAMALI.
       */
      pendingApproval?: {
        cluster: string;
        namespace: string;
        apps: string[];
        ticketId?: number;
        externalTicketId?: string;
      }[];
      /** Kapinin reddettigi ya da baslatilamayan gruplar — sessizce yutulmamali. */
      blocked?: { cluster: string; namespace: string; message: string }[];
    }>('/restore-all', body);
  },

  adopt(
    body: ScaleXScope & {
      appName: string;
      workloadKind?: string;
      previousReplicas?: number;
      stoppedBy?: string;
    },
  ) {
    return post<{ ok: boolean; message?: string }>('/adopt', body);
  },

  async history() {
    return safeJson(await fetch(`${BASE}/history`)) as Promise<{
      ok: boolean;
      items: Record<string, unknown>[];
      message?: string;
    }>;
  },

  /** Admin: kesifte OKUNAMAYAN tiplerin birikmis listesi. Kullanici ekraninda yalnizca
   *  tek satirlik bir ozet var; platform ekibine goturulecek tam liste BURADA. */
  async rbacFindings(reason?: 'no_permission' | 'api_absent') {
    const qs = reason ? `?reason=${encodeURIComponent(reason)}` : '';
    return safeJson(await fetch(`${BASE}/admin/rbac-findings${qs}`)) as Promise<{
      ok: boolean;
      findings: ScaleXRbacFinding[];
      limit: number;
      message?: string;
    }>;
  },

  /** Admin: cozulen bir eksigi listeden dusur. Silme BILEREK var — platform ekibi
   *  yetkiyi verdiginde satir bir sonraki kesife kadar "cozulmemis" gorunurdu. */
  async clearRbacFinding(id: number) {
    return safeJson(
      await fetch(`${BASE}/admin/rbac-findings/${id}`, { method: 'DELETE' }),
    ) as Promise<{ ok: boolean; message?: string }>;
  },
};
