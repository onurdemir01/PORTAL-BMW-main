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
export type OpsxOcpOperation = "restart" | "threaddump" | "heapdump" | "tcpdump" | "poddelete";
export interface OpsxOcpOperationDef {
  key: OpsxOcpOperation;
  label: string;
  enabled: boolean;
  /** PRODUCTION ONAYI (2026-10-06): production cluster seçiliyse bu işlem Smart
   *  onayından geçer — düğme KAPANMAZ, ama tıklandığında iş hemen başlamaz: talep
   *  açılır ve onay akışı bitince Ansible tetiklenir. Karar SUNUCUDA verilir
   *  (server/opsx/prod-approval.cjs); kural onyüze kopyalanmaz, yoksa iki kopyadan
   *  biri zamanla kayar. Alan gelmezse (env/tenant sorguya eklenmemişse ya da eski
   *  sunucu) işlem onaysız sanılmaz — gerçek kapı POST uçlarındadır ve orada
   *  yine Smart talebi açılır. */
  needsApproval?: boolean;
  approvalMessage?: string;
  approvalReason?: string;
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
  /** PRODUCTION ONAYI (2026-10-06): `ok:true` AMA İŞ BAŞLAMADI — Smart talebi açıldı,
   *  onay akışı bitince Ansible tetiklenir. `jobId` null gelir. ÇAĞIRAN BUNU AYIRMALI:
   *  "İşlem başlatıldı" demek yanlış olur, kullanıcı işin koştuğunu sanar. */
  pendingApproval?: boolean;
  ticketId?: number;
  externalTicketId?: string;
  /** Pod silmede: pod adları donduruldu, onay gecikirse bulunamayabilir (kullanıcı kararı). */
  staleWarning?: string;
  /** Üretim tespitini hangi alan tetikledi (ör. "ortam=prod"). */
  reason?: string;
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

// Pod silme/restart sonucu (opsx_openshift_pod_delete.yaml set_stats)
export interface OpsxPodDeleteResultItem {
  cluster: string;
  namespace: string;
  pod: string;
  existence: "Exist" | "Not Exist";
  ok: boolean;
  error?: string;
}
export interface OpsxPodDeleteStatus {
  ok: boolean;
  status: string;
  overallStatus?: "ok" | "partial" | "failed" | null;
  message?: string;
  results?: OpsxPodDeleteResultItem[];
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

// restart/stop/start için: aynı uygulamaya birden fazla JVM (server-config) bağlı olabilir —
// eskiden `application`'ın TEK bir server-config/server-group adı olduğu varsayılıp
// GRUBUN TAMAMI hedefleniyordu. Artık dump'ın JVM keşfiyle AYNI desen: anlık bir AWX job'ı
// (bmw_portal/java_app_check/java_app_check.yml) application adına uyan server-config'leri
// VE her birinin STARTED/STOPPED durumunu host başına listeler, kullanıcı bir/birden
// fazla/tümünü seçer.
export interface OpsxServerConfig {
  host: string;
  serverConfig: string;
  status: string; // "running" | "stopped"
  jbossMajor: string; // "7" | "8"
}

export interface OpsxServerConfigDiscoveryLaunch {
  ok: boolean;
  jobId: number | null;
  status: string | null;
  awxServerId: number;
  message?: string;
}

export interface OpsxServerConfigDiscoveryStatus {
  ok: boolean;
  status: string;
  message?: string;
  serverConfigs?: OpsxServerConfig[];
}

// run()'ın serverConfigMap'inde host başına gönderilen her JVM seçimi.
export interface OpsxServerConfigSelection {
  name: string;
  jbossMajor: string;
}

// ── WAS (WebSphere) — 2026-10-02 ─────────────────────────────────────────────
// JBoss akışından AYRI uçlar (server/opsx/was.cjs). Kurallar: TEK host + TEK JVM,
// işlem öncesi canlı keşif (en çok 15 dk geçerli), JVM adı elle yazılarak onay.
// "Ölçülemedi" ile "durmuş" ASLA karışmaz: OLCULEMEDI ayrı bir durumdur ve işlem yapılmaz.
export type WasState = "RUNNING" | "STOPPED" | "ASKIDA" | "COKLU_SUREC" | "OLCULEMEDI";
export type WasOperation = "restart" | "stop" | "start";
export type WasOpResultCode = "OK" | "SKIP" | "FAIL" | "OLCULEMEDI";

export interface WasHost {
  host: string;
  env: string;     // normalize edilmiş: PROD → Production
  envRaw: string;  // envanterdeki ham değer
  os: string;
  wasVersion: string;
  status: string;  // envanterdeki (gece taraması) durum — canlı DEĞİL
  selectable: boolean; // yalnız Linux
  reason: string;
}

export interface WasWarning {
  code: string; // "ASKIDA" | "SON_CALISAN"
  message: string;
}

export interface WasTarget {
  host: string;
  profile: string;
  cell: string;
  node: string;
  server: string;
  cluster: string;
  state: WasState;
  pids: number;
  ss: string;
  reason: string;
  kimlik: "var" | "yok" | "olculemedi";
  hostOverall: "ok" | "olculemedi";
  selectable: boolean;
  allowedOps: WasOperation[];
  // clusterKnown=false: küme bilgisi ölçülemedi (cluster "?") — "son çalışan" uyarısı her zaman sorulur.
  peers: { total: number; running: number; unknown: number; clusterKnown?: boolean };
  warnings: Record<WasOperation, WasWarning[]>;
}

export interface WasHostResult {
  host: string;
  overall: "ok" | "olculemedi";
  reason: string;
  hasApp: boolean;
}

export interface WasDiscoverLaunch {
  ok: boolean;
  jobId?: number | null;
  status?: string | null;
  awxServerId?: number;
  hosts?: string[];
  message?: string;
  code?: string;
}

export interface WasDiscoverStatus {
  ok: boolean;
  status: string;
  message?: string;
  app?: string;
  hosts?: WasHostResult[];
  targets?: WasTarget[];
  finishedAt?: string | null;
  validUntil?: string | null;
  appLock?: { holder: string | null; target: string | null; jobId: number | null } | null;
}

export interface WasRunBody {
  app: string;
  host: string; // TEK sunucu — dizi gönderilirse sunucu 400 döner
  profile: string;
  cell: string;
  node: string;
  server: string;
  operation: WasOperation;
  confirmed: boolean;
  confirmText: string; // JVM adı, elle yazılır
  discoverJobId: number;
  discoverServerId: number;
  ackWarnings?: boolean;
}

export interface WasRunResult {
  ok: boolean;
  jobId?: number | null;
  status?: string | null;
  awxServerId?: number;
  templateId?: number;
  requestId?: string;
  // false: iş başladı ama Portal kaydı yazılamadı — sonuç bu ekrandan izlenemeyebilir (warning metni).
  historyWritten?: boolean;
  warning?: string;
  sentBody?: { extra_vars: Record<string, unknown> };
  message?: string;
  code?: string;
  warnings?: WasWarning[];
  lock?: { scope: "app" | "target"; holder: string | null; target: string | null; jobId: number | null };
}

// status = adımın HEDEFİNE ulaşıp ulaşmadığı. warning: OK ama mesajı "UYARI:" ile başlıyor
// (adım tamam, dikkat gerektiren durum var) — yeşil "Başarılı" değil, sarı "Uyarı" gösterilir.
export interface WasOpStep {
  step: string;
  status: WasOpResultCode;
  msg: string;
  warning?: boolean;
}

export interface WasOpResult {
  host: string;
  profile: string;
  cell: string;
  node: string;
  server: string;
  op: string;
  requestId?: string;
  before: string;
  after: string;
  result: WasOpResultCode;
  steps: WasOpStep[];
  line: string;
}

export interface WasRunStatus {
  ok: boolean;
  status: string;
  output?: string;
  result?: WasOpResult;
  severity?: "ok" | "skip" | "fail" | "unknown";
  message?: string;
}

const WAS = `${BASE}/was`;

export const opsxWasApi = {
  // NOAPP satırları ve (Admin değilseniz) kısıtlı uygulamalar listelenmez.
  searchApps: (search: string): Promise<{ ok: boolean; apps?: string[]; truncated?: boolean; message?: string }> =>
    fetch(`${WAS}/apps?search=${encodeURIComponent(search)}`).then(safeJson),

  getHosts: (app: string): Promise<{ ok: boolean; hosts?: WasHost[]; maxDiscoverHosts?: number; message?: string }> =>
    fetch(`${WAS}/hosts?app=${encodeURIComponent(app)}`).then(safeJson),

  // Salt okunur keşif. `hosts` verilmezse uygulamanın tüm Linux sunucuları (en çok 10).
  discover: (app: string, hosts?: string[]): Promise<WasDiscoverLaunch> =>
    fetch(`${WAS}/discover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(hosts ? { app, hosts } : { app }),
    }).then(safeJson),

  discoverStatus: (awxServerId: number, jobId: number): Promise<WasDiscoverStatus> =>
    fetch(`${WAS}/discover/${awxServerId}/${jobId}/status`).then(safeJson),

  run: (body: WasRunBody): Promise<WasRunResult> =>
    fetch(`${WAS}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(safeJson),

  runStatus: (awxServerId: number, jobId: number): Promise<WasRunStatus> =>
    fetch(`${WAS}/run/${awxServerId}/${jobId}/status`).then(safeJson),
};

// ── Smart onay yapilandirmasi (admin, OpsX sayfasinin kendi icinde) ─────────────────
// `integrationKey` DEGERI sunucudan HIC DONMEZ (bir RFF token'idir); yalnizca tanimli mi
// bayragi gelir. Kaydederken bos birakilirsa mevcut deger KORUNUR, silinmez.
export type OpsxSmartPlatform = "legacy" | "was" | "openshift";

export interface OpsxSmartPlatformConfig {
  /** Kapali ise bu platformda production islem ONAYSIZ kosar (denetime yazilir). */
  enabled: boolean;
  flowKey: string;
  metadataFields: string;
  integrationKeySet: boolean;
}

export interface OpsxSmartConfigResponse {
  ok: boolean;
  smart?: Record<OpsxSmartPlatform, OpsxSmartPlatformConfig>;
  // Panel bos ama ortam degiskeni dolu olabilir: admin "bos" gorup calisan degeri
  // ezmesin diye hangi platformun env'den geldigi ayrica bildirilir (deger DEGIL).
  envFallback?: Record<OpsxSmartPlatform, { envName: string; flowKeySet: boolean }>;
  metadataEnvSet?: boolean;
  integrationEnvSet?: boolean;
  message?: string;
}

export interface OpsxSmartConfigSave {
  enabled: boolean;
  flowKey: string;
  metadataFields: string;
  /** Bos string = "degistirmedim". Silmek icin ayri bir eylem YOK (bilincli). */
  integrationKey?: string;
}

export const opsxApi = {
  // Smart onay yapilandirmasi — ADMIN. OpsX sayfasinin sag ustundeki pencere kullanir.
  getSmartConfig: (): Promise<OpsxSmartConfigResponse> =>
    fetch(`${BASE}/smart-config`).then(safeJson),

  // `reddedilen`: desene uymadigi icin KAYDEDILMEYEN alanlar ("legacy.flowKey" gibi).
  // Sessiz atlama olmaz — admin "kaydettim" sanip production'in reddedilmeye devam
  // etmesi, en bastaki sorunun aynisi olurdu.
  saveSmartConfig: (
    smart: Partial<Record<OpsxSmartPlatform, OpsxSmartConfigSave>>,
  ): Promise<OpsxSmartConfigResponse & { reddedilen?: string[] }> =>
    fetch(`${BASE}/smart-config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ smart }),
    }).then(safeJson),

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
  // env/tenant verilirse sunucu her işleme `blocked` ekler (geçici production kapısı).
  getOcpOperations: (
    env?: string,
    tenant?: string,
  ): Promise<{ ok: boolean; operations: OpsxOcpOperationDef[] }> => {
    const q = new URLSearchParams();
    if (env) q.set('env', env);
    if (tenant) q.set('tenant', tenant);
    const qs = q.toString();
    return fetch(`${BASE}/ocp/operations${qs ? `?${qs}` : ''}`).then(safeJson);
  },

  // İşlemi tetikler. AWX job template'i tanımlı değilse sunucu 501 + açıklayıcı
  // mesaj döner (sessizce yanlış job tetiklenmez).
  run: (body: {
    platform: OpsxPlatform;
    // Legacy alanları
    application?: string;
    operation?: OpsxOperation;
    hosts?: string[];
    // Kullanicinin sunucu secim ekraninda ISARETLEDIGI JBoss majorleri ("7" / "8").
    // Backend `jboss_version` extra_var'ini bundan turetir. Gonderilmezse eski
    // davranis (envanterden turetme) surer — eski istemci kirilmaz.
    hostMajors?: string[];
    // restart/stop/start için ZORUNLU: kullanıcının server-config keşfinden seçtiği
    // {HOST: [{name,jbossMajor}, ...]} eşlemesi — pidMap ile AYNI desen (bkz.
    // OpsxServerConfigSelection). threaddump/heapdump'ta kullanılmaz (ayrı route).
    serverConfigMap?: Record<string, OpsxServerConfigSelection[]>;
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
  discoverLegacyJvms: (application: string, hosts: string[], hostMajors?: string[]): Promise<OpsxJvmDiscoveryLaunch> =>
    fetch(`${BASE}/legacy/jvm/discover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ application, hosts, hostMajors }),
    }).then(safeJson),

  // Keşif job'ının durumu — terminal + başarılıysa `jvms` dolu döner.
  legacyJvmStatus: (awxServerId: number, jobId: number): Promise<OpsxJvmDiscoveryStatus> =>
    fetch(`${BASE}/legacy/jvm/${awxServerId}/${jobId}/status`).then(safeJson),

  // restart/stop/start için: application adına uyan server-config'leri (JVM'leri) VE
  // her birinin o anki STARTED/STOPPED durumunu listelemek için anlık bir AWX keşif
  // job'ı tetikler (bkz. OpsxServerConfig) — PID-bazlı dump keşfinden AYRI bir uç.
  discoverLegacyServerConfigs: (application: string, hosts: string[], hostMajors?: string[]): Promise<OpsxServerConfigDiscoveryLaunch> =>
    fetch(`${BASE}/legacy/serverconfig/discover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ application, hosts, hostMajors }),
    }).then(safeJson),

  // Keşif job'ının durumu — terminal + başarılıysa `serverConfigs` dolu döner.
  legacyServerConfigStatus: (awxServerId: number, jobId: number): Promise<OpsxServerConfigDiscoveryStatus> =>
    fetch(`${BASE}/legacy/serverconfig/${awxServerId}/${jobId}/status`).then(safeJson),

  // Legacy thread/heap dump başlatır — AYRI bir AWX template'e (opsx_legacy_dump) gider,
  // template tanımlı değilse 501 döner. pidMap: kullanıcının JVM keşfinde seçtiği
  // {HOST: [{pid,jbossMajor}, ...]} eşlemesi — bir host'ta birden fazla JVM seçilmişse o
  // host için birden fazla dump üretilir; jbossMajor playbook'un hangi SABİT JDK yolunu
  // (/usr/jboss/ | /usr/jboss8/) kullanacağını belirler.
  dumpLegacy: (
    application: string, hosts: string[], dumpType: OpsxDumpType, pidMap: Record<string, OpsxPidSelection[]>,
    hostMajors?: string[],
  ): Promise<OpsxDumpLaunchResult> =>
    fetch(`${BASE}/dump/legacy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ application, hosts, dumpType, pidMap, hostMajors }),
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

  // Pod silme/restart (2026-09-18): dump ile AYNI kesif + pod secimi; `consent` zorunlu.
  podDeleteOpenshift: (
    env: string,
    tenant: string,
    pairs: OpsxOcpPair[],
    pods: { cluster: string; namespace: string; pod: string }[],
    consent: boolean,
  ): Promise<OpsxDumpLaunchResult> =>
    fetch(`${BASE}/poddelete/openshift`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ env, tenant, pairs, pods, consent }),
    }).then(safeJson),
  podDeleteStatus: (awxServerId: number, jobId: number): Promise<OpsxPodDeleteStatus> =>
    fetch(`${BASE}/poddelete/${awxServerId}/${jobId}/status`).then(safeJson),

  // Dump job'ının durumu — terminal + başarılıysa `results` her başarılı öge için
  // bir `downloadToken` taşır (bkz. dumpDownloadUrl).
  dumpStatus: (awxServerId: number, jobId: number): Promise<OpsxDumpStatus> =>
    fetch(`${BASE}/dump/${awxServerId}/${jobId}/status`).then(safeJson),

  // İndirme URL'i — doğrudan <a href> olarak kullanılır, ayrı bir fetch gerekmez.
  dumpDownloadUrl: (token: string): string => `${BASE}/dump/download/${token}`,
};
