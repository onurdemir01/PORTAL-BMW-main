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
  // AWX'e gönderilen gövdenin aynısı — son ekranda gösterilir. `limit` YALNIZCA
  // Legacy'de bulunur; Openshift'te hiç gönderilmez (bkz. server/opsx/index.cjs).
  sentBody: { limit?: string; extra_vars: Record<string, unknown> };
  // ok:false ise backend'in ürettiği insanın okuyabileceği hata metni (bkz. server/opsx/index.cjs
  // route'larındaki `res.status(err.status||500).json({ok:false, message: err.message})`).
  // ÇAĞIRAN BUNU KONTROL ETMELİ — safeJson() 4xx/5xx'te fetch reddetmez, sadece JSON'u döner.
  message?: string;
}

export interface OpsxJobStatus {
  ok: boolean;
  status: string;
  output: string;
  finished?: string;
  failed?: boolean;
}

// Thread/Heap dump — restart/stop/start'tan AYRI bir akış: iş bitince bir dosya üretir
// ve kullanıcı onu indirir (bkz. server/opsx/downloads.cjs).
export type OpsxDumpType = "threaddump" | "heapdump";

// Backend'in playbook set_stats çıktısını (opsx_dump_result.results) OLDUĞU GİBİ
// ilettiği alan adları — host bazlı (Legacy) veya namespace/application/pod bazlı
// (Openshift). İkisi de AYNI teslimat deseni: staged_path/filename doluysa portal
// üzerinden indirilir (downloadToken üretilir) — bkz. opsx_legacy_dump.yml ve
// opsx_get_dump.yaml (ikisi de `oc rsync`/`cp` ile paylaşılan staging dizinine yazar).
export interface OpsxDumpResultItem {
  host?: string;
  pid?: string;    // Legacy: dump'ın alındığı JVM (bkz. LegacyJvmSelectStep)
  namespace?: string;
  application?: string;
  cluster?: string; // Openshift: kaydın ait olduğu gerçek cluster (birden fazlaysa "," ile)
  namespaces?: string[]; // Openshift: arşiv kaydının kapsadığı namespace'ler
  pod?: string;   // Openshift: BAŞARISIZ tek pod kaydı
  pods?: string[]; // Openshift: arşiv kaydının kapsadığı pod'lar
  ok: boolean;
  staged_path?: string;
  filename?: string;
  size_bytes?: number;
  downloadToken?: string;
  error?: string;
}

export interface OpsxDumpLaunchResult {
  ok: boolean;
  jobId: number | null;
  status: string | null;
  awxServerId: number;
  sentBody: { limit?: string; extra_vars: Record<string, unknown> };
  // ok:false ise backend'in ürettiği hata metni — bkz. OpsxRunResult.message notu.
  message?: string;
}

export interface OpsxDumpStatus {
  ok: boolean;
  status: string;
  message?: string;
  results?: OpsxDumpResultItem[];
}

// Openshift dump artık POD seviyesinde çalışır. Pod adları efemeraldir (her deploy'da
// değişir) — envanterde tutulamaz, bu yüzden sihirbaz anlık bir AWX keşif job'ı
// tetikleyip TÜM seçili namespace'lerdeki pod'ları listeler (bkz. opsx_openshift_pods.yaml).
// Bir tenant'a birden fazla gerçek cluster bağlı olabilir VE kullanıcı birden fazla
// namespace seçebilir — keşif ARTIK HEPSİNİN ÇAPRAZ ÇARPIMINA bakıyor, bu yüzden her pod
// HANGİ cluster'dan VE HANGİ namespace'ten geldiğini taşır.
export interface OpsxPod {
  name: string;
  cluster: string;   // gerçek cluster adı (ocp_cluster_index.cluster_name)
  namespace: string;
  ready: string;    // "1/1"
  status: string;   // "Running" | "Pending" | ...
  restarts: string; // "0" veya "2 (3d ago)"
  age: string;      // "5d"
}

export interface OpsxPodDiscoveryLaunch {
  ok: boolean;
  jobId: number | null;
  status: string | null;
  awxServerId: number;
  // ok:false ise backend'in ürettiği hata metni — bkz. OpsxRunResult.message notu.
  message?: string;
}

export interface OpsxPodDiscoveryStatus {
  ok: boolean;
  status: string;
  message?: string;
  namespaces?: string[];
  pods?: OpsxPod[];
}

// Legacy dump için: aynı uygulamaya ait bir host'ta BİRDEN FAZLA JVM çalışıyor olabilir —
// eskiden dump playbook'u PID'i körlemesine (ilk eşleşen JBoss/WildFly/EAP prosesi) alıyordu.
// Artık OCP pod keşfiyle AYNI desen: anlık bir AWX job'ı (opsx_legacy_jvm_discover.yml)
// application adına çalışan JVM'leri host başına listeler, kullanıcı bir/birden fazla
// (host,pid) çifti seçer.
export interface OpsxJvm {
  host: string;
  pid: string;
  cmd: string; // kısaltılmış komut satırı — aynı host'taki birden fazla JVM'i ayırt etmek için
  // "7" | "8" — backend'in komut satırındaki SABİT kurulum yoluna (/usr/jboss/ | /usr/jboss8/)
  // bakarak belirlediği majör; dump playbook'u JDK yolunu (jmap/jstack) buna göre seçer.
  jbossMajor: string;
}

export interface OpsxJvmDiscoveryLaunch {
  ok: boolean;
  jobId: number | null;
  status: string | null;
  awxServerId: number;
  message?: string;
}

export interface OpsxJvmDiscoveryStatus {
  ok: boolean;
  status: string;
  message?: string;
  jvms?: OpsxJvm[];
}

// dumpLegacy'nin pidMap'inde host başına gönderilen her JVM seçimi — OpsxJvm'in
// pid+jbossMajor'ının aynısı (cmd/host burada gereksiz, backend zaten host'u anahtardan bilir).
export interface OpsxPidSelection {
  pid: string;
  jbossMajor: string;
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
    // Openshift restart/rollout: `oc_cluster`/`env`'in çözdüğü gruptaki GERÇEK cluster'lardan
    // (bkz. getClusters) TEK birinin adı — YA DA "" (boş, "Tüm cluster'lar" seçilirse; bkz.
    // OcpClusterPickStep.tsx). AWX `limit` production'da sessizce yutulduğu için tek cluster
    // hedeflemek SADECE bunun playbook'un `hosts:` satırına doğrudan geçmesiyle mümkün —
    // boşsa target_cluster hiç gönderilmez, playbook grubun TAMAMINI hedefler (bkz.
    // server/opsx/index.cjs dosya başı notu).
    cluster?: string;
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

  // application adına host başında çalışan JVM'leri listelemek için anlık bir AWX
  // keşif job'ı tetikler (bkz. OpsxJvm) — OCP pod keşfiyle AYNI desen.
  discoverLegacyJvms: (application: string, hosts: string[]): Promise<OpsxJvmDiscoveryLaunch> =>
    fetch(`${BASE}/legacy/jvm/discover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ application, hosts }),
    }).then(safeJson),

  // Keşif job'ının durumu — terminal + başarılıysa `jvms` dolu döner.
  legacyJvmStatus: (awxServerId: number, jobId: number): Promise<OpsxJvmDiscoveryStatus> =>
    fetch(`${BASE}/legacy/jvm/${awxServerId}/${jobId}/status`).then(safeJson),

  // Legacy thread/heap dump başlatır — AYRI bir AWX template'e (opsx_legacy_dump) gider,
  // template tanımlı değilse 501 döner. pidMap: kullanıcının JVM keşfinde seçtiği
  // {HOST: [{pid,jbossMajor}, ...]} eşlemesi — bir host'ta birden fazla JVM seçilmişse o
  // host için birden fazla dump üretilir; jbossMajor playbook'un hangi SABİT JDK yolunu
  // (/usr/jboss/ | /usr/jboss8/) kullanacağını belirler.
  dumpLegacy: (
    application: string, hosts: string[], dumpType: OpsxDumpType, pidMap: Record<string, OpsxPidSelection[]>,
  ): Promise<OpsxDumpLaunchResult> =>
    fetch(`${BASE}/dump/legacy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ application, hosts, dumpType, pidMap }),
    }).then(safeJson),

  // Seçili namespace'lerdeki (birden fazla olabilir) pod'ları listelemek için anlık bir
  // AWX keşif job'ı tetikler — `pairs`, OcpTargetStep'in ürettiği (namespace,uygulama)
  // çiftlerinin AYNISI (artık tek bir namespace'e zorlanmıyor).
  discoverOcpPods: (env: string, tenant: string, pairs: OpsxOcpPair[]): Promise<OpsxPodDiscoveryLaunch> =>
    fetch(`${BASE}/ocp/pods/discover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ env, tenant, pairs }),
    }).then(safeJson),

  // Keşif job'ının durumu — terminal + başarılıysa `pods` dolu döner.
  ocpPodsStatus: (awxServerId: number, jobId: number): Promise<OpsxPodDiscoveryStatus> =>
    fetch(`${BASE}/ocp/pods/${awxServerId}/${jobId}/status`).then(safeJson),

  // Openshift thread/heap dump başlatır — AYRI bir AWX template'e (opsx_openshift_dump)
  // gider. Hedefleme POD seviyesindedir (yukarıdaki keşif adımından seçilir); her pod
  // HANGİ gerçek cluster'dan VE HANGİ namespace'ten geldiğini taşır (bkz. OpsxPod) —
  // playbook o pod'u sadece kendi cluster'ına login olarak dump alır. `pairs`, anti-TOCTOU
  // için gönderilir (seçilen pod'ların namespace'i bu çiftlerden biri OLMALI).
  // threadDumpCount/threadDumpInterval YALNIZ thread dump için anlamlıdır.
  dumpOpenshift: (
    env: string,
    tenant: string,
    pairs: OpsxOcpPair[],
    pods: { cluster: string; namespace: string; pod: string }[],
    dumpType: OpsxDumpType,
    threadDumpCount?: number,
    threadDumpInterval?: number,
  ): Promise<OpsxDumpLaunchResult> =>
    fetch(`${BASE}/dump/openshift`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ env, tenant, pairs, pods, dumpType, threadDumpCount, threadDumpInterval }),
    }).then(safeJson),

  // Dump job'ının durumu — terminal + başarılıysa `results` her başarılı öge için
  // bir `downloadToken` taşır (bkz. dumpDownloadUrl).
  dumpStatus: (awxServerId: number, jobId: number): Promise<OpsxDumpStatus> =>
    fetch(`${BASE}/dump/${awxServerId}/${jobId}/status`).then(safeJson),

  // İndirme URL'i — doğrudan <a href> olarak kullanılır, ayrı bir fetch gerekmez.
  dumpDownloadUrl: (token: string): string => `${BASE}/dump/download/${token}`,
};
