import { safeJson } from "./http";
// src/api/ansibleApi.ts — AWX runner API client

const BASE = "/api/ansible";

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(text || `HTTP ${r.status}`);
  }
  return safeJson(r);
}

export interface AwxTemplate {
  id: number;
  name: string;
  description: string;
  playbook: string;
  inventory: string;
  ask_variables: boolean;
  variables: string;
  labels: string[];
  isReadOnly: boolean;
  lastLaunch?: string | null;
  // actions.md #8 — AWX'in kendi yanitindan cikarilan ek alanlar (ayni cagri, ek istek yok).
  jobType?: string;
  project?: string;
  credentials?: string[];
  surveyEnabled?: boolean;
  modified?: string | null;
  hasInventory?: boolean;
}

export interface LaunchOptionFlag {
  enabled: boolean;
  current: string | number;
}

// AWX'in "prompt on launch" olarak işaretlediği built-in çalışma-zamanı parametreleri —
// credential/inventory BİLİNÇLİ OLARAK burada yok (kullanıcı hiçbir zaman hangi
// credential/inventory'nin kullanılacağını seçemez, güvenlik sınırı).
export interface LaunchOptions {
  limit: LaunchOptionFlag;
  forks: LaunchOptionFlag;
  jobTags: LaunchOptionFlag;
  skipTags: LaunchOptionFlag;
  verbosity: LaunchOptionFlag;
  jobType: LaunchOptionFlag;
}

export interface AwxTemplateDetail {
  id: number;
  name: string;
  description: string;
  jobType: string;
  playbook: string;
  inventory: string;
  project: string;
  credentials: { name: string; kind: string }[];
  extraVars: string;
  extraVarsParsed: Record<string, string>;
  limit: string;
  verbosity: number;
  askVariables: boolean;
  askLimit: boolean;
  askInventory: boolean;
  surveyEnabled: boolean;
  launchOptions: LaunchOptions;
  created: string | null;
  modified: string | null;
  recentJobs: { id: number; status: string; finished: string | null }[];
  surveyFields: {
    name: string; label: string; type: string; required: boolean;
    default: string; choices: string[]; description: string;
  }[];
}

export interface OcpCluster {
  id: string;
  name: string;
  display: string;
  env: "prod" | "test" | "qa" | "dev";
  apiUrl: string;
  consoleUrl?: string;
  token?: string;
  description: string;
  namespace: string;
  /** AWX inventory'de zaten "oc login" yapılmış bastion/jump host — canlı pod/node
   *  durumu sorguları (ocp_pod_status.yml) bunun üzerinden çalışır. */
  jumpHost?: string;
  /** Katalog birleştirme: LogX/OpsX/Telnet cluster ağacındaki platform (tenant). Boşsa
   *  kayıt ortak ağaca PASİF olarak aynalanır ve sihirbazlarda görünmez. */
  tenant?: string;
  isActive?: boolean;
  createdAt?: string | null;
  createdBy?: string | null;
  lastCheckedAt?: string | null;
  connectionStatus?: string | null;
}

export interface JobStatus {
  jobId: number;
  status: "pending" | "waiting" | "running" | "successful" | "failed" | "error" | "canceled";
  started?: string;
  finished?: string;
  elapsed?: number;
  failed: boolean;
  hasChanged: boolean;
  playbook: string;
  inventory: string;
  launchedBy: string;
}

export interface JobOutput {
  output: string;
  changedWarning: boolean;
}

export interface AwxServer {
  id: number;
  name: string;
  configured: boolean;
}

export interface AwxServerHealth {
  id: number; name: string; url: string; configured: boolean;
  reachable: boolean; authOk: boolean; checkedAt: string;
  responseTimeMs: number | null; awxVersion: string | null; error: string | null;
  connectionType?: "token" | "user_pass";
}

export interface RecentAwxJob {
  jobId: number;
  status: string;
  jobTemplate: string;
  executer: string;
  created: string | null;
}

export interface RecentAwxJobsServer {
  serverId: number;
  serverName: string;
  ok: boolean;
  jobs: RecentAwxJob[];
  error?: string;
}

export const ansibleApi = {
  // Gercek AWX /api/v2/ping/ sonucu (actions.md #8) — her yapilandirilmis sunucu icin.
  health: (): Promise<{
    ok: boolean; configured: boolean; serverCount: number; servers: AwxServerHealth[];
    url?: string; version?: string; message?: string;
  }> => fetch(`${BASE}/awx/health`).then(safeJson),

  servers: (): Promise<{ ok: boolean; servers: AwxServer[] }> =>
    fetch(`${BASE}/servers`).then(safeJson),

  templates: (serverId: number): Promise<{ ok: boolean; templates: AwxTemplate[]; message?: string }> =>
    fetch(`${BASE}/templates/${serverId}`).then(safeJson),

  awxTemplates: (): Promise<{ ok: boolean; templates: AwxTemplate[]; message?: string }> =>
    fetch(`${BASE}/awx/templates`).then(safeJson),

  awxTemplatesAll: (): Promise<{ ok: boolean; total: number; summary: { serverId: number; serverName: string; ok: boolean; templates: AwxTemplate[]; error?: string }[] }> =>
    fetch(`${BASE}/awx/templates/all`).then(safeJson),

  clusters: (): Promise<{ ok: boolean; clusters: OcpCluster[] }> =>
    fetch(`${BASE}/clusters`).then(safeJson),

  // Dashboard "Kuyruktaki Ansible İşleri" karti — Maestro/Maestro2'de su an
  // kuyrukta/calisan job'lar (pending|waiting|running).
  recentJobs: (): Promise<{ ok: boolean; servers: RecentAwxJobsServer[] }> =>
    fetch(`${BASE}/awx/recent-jobs`).then(safeJson),

  addCluster: (data: Omit<OcpCluster, "id">): Promise<{ ok: boolean; cluster: OcpCluster; message?: string }> =>
    fetch(`${BASE}/clusters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(safeJson),

  updateCluster: (id: string, data: Partial<Omit<OcpCluster, "id">>): Promise<{ ok: boolean; cluster: OcpCluster; message?: string }> =>
    fetch(`${BASE}/clusters/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(safeJson),

  deleteCluster: (id: string): Promise<{ ok: boolean; clusters: OcpCluster[]; message?: string }> =>
    fetch(`${BASE}/clusters/${id}`, { method: "DELETE" }).then(safeJson),

  // Hafif erişilebilirlik testi (jump-host GEREKMEZ, "Pod Durumu"ndan bağımsız) — bkz. actions.md #9
  testClusterConnection: (id: string): Promise<{ ok: boolean; message?: string; responseTimeMs?: number; status?: string }> =>
    fetch(`${BASE}/clusters/${id}/test-connection`, { method: "POST" }).then(safeJson),

  // Canlı pod/node durumu (salt-okunur `oc get`, jump host üzerinden) — bkz. OcpCluster.jumpHost
  clusterPodStatus: (id: string, namespace?: string, labelSelector?: string): Promise<{ ok: boolean; output?: string; message?: string; jobId?: number }> =>
    fetch(`${BASE}/clusters/${id}/pod-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ namespace, labelSelector }),
    }).then(safeJson),

  run: (templateId: number, extraVars: Record<string, string> = {}, limit = ""): Promise<{ ok: boolean; jobId: number; status: string; message?: string }> =>
    fetch(`${BASE}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId, extraVars, limit }),
    }).then(safeJson),

  jobStatus: (jobId: number): Promise<{ ok: boolean } & JobStatus> =>
    fetch(`${BASE}/job/${jobId}/status`).then(safeJson),

  jobOutput: (jobId: number): Promise<{ ok: boolean } & JobOutput> =>
    fetch(`${BASE}/job/${jobId}/output`).then(safeJson),

  // Self-Service Ansible
  ssItems: (): Promise<{ ok: boolean; items: AnsibleSsItem[] }> =>
    fetch(`${BASE}/ss/items`).then(safeJson),

  saveSsItem: (item: Partial<AnsibleSsItem>): Promise<{ ok: boolean; item?: AnsibleSsItem; items: AnsibleSsItem[]; message?: string }> =>
    fetch(`${BASE}/ss/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    }).then(safeJson),

  deleteSsItem: (id: string): Promise<{ ok: boolean; items: AnsibleSsItem[] }> =>
    fetch(`${BASE}/ss/items/${id}`, { method: "DELETE" }).then(safeJson),

  surveySpec: (serverId: number, templateId: number): Promise<{ ok: boolean; fields: SurveyField[]; surveyEnabled: boolean; launchOptions: LaunchOptions; askVariables: boolean; message?: string }> =>
    fetch(`${BASE}/survey/${serverId}/${templateId}`).then(safeJson),

  // Admin-only: gizlenmiş (hidden) alanlar dahil TÜM survey alanlarını döner —
  // "Alanları Yönet" panelinin veri kaynağı. Sunucu, ?admin=1'i yalnızca gerçekten
  // Admin rolündeki oturumlarda onurlandırır (client bayrağına güvenilmez).
  surveySpecAdmin: (serverId: number, templateId: number): Promise<{ ok: boolean; fields: SurveyField[]; surveyEnabled: boolean; launchOptions: LaunchOptions; askVariables: boolean; message?: string }> =>
    fetch(`${BASE}/survey/${serverId}/${templateId}?admin=1`).then(safeJson),

  templateDetail: (serverId: number, templateId: number): Promise<{ ok: boolean; template?: AwxTemplateDetail; message?: string }> =>
    fetch(`${BASE}/template-detail/${serverId}/${templateId}`).then(safeJson),

  // pendingApproval=true ise iş HENÜZ tetiklenmedi — Smart'ta bir talep açıldı, jobId
  // YOK, ticketId ile smartTicketStatus() poll edilmeli (bkz. server/ansible/runner.cjs
  // POST /launch-ss). Bu servis için Smart onayı gerekmiyorsa jobId doğrudan gelir,
  // önceki davranış birebir korunur.
  launchSs: (
    serverId: number,
    templateId: number,
    extraVars: Record<string, string>,
    templateName: string,
    options: { limit?: string; forks?: number; jobTags?: string; skipTags?: string; verbosity?: number; jobType?: string } = {}
  ): Promise<{ ok: boolean; jobId?: number; status?: string; pendingApproval?: boolean; ticketId?: number; message?: string; field?: string }> =>
    fetch(`${BASE}/launch-ss/${serverId}/${templateId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extraVars, templateName, ...options }),
    }).then(safeJson),

  ssJobStatus: (serverId: number, jobId: number): Promise<{ ok: boolean; status: string; output: string; resultTraceback?: string; jobExplanation?: string; finished?: string; failed?: boolean }> =>
    fetch(`${BASE}/ss/job-status/${serverId}/${jobId}`).then(safeJson),

  // Smart onayı bekleyen bir talebin durumu. status: PENDING | LAUNCHED | REJECTED |
  // TIMEOUT | ERROR — LAUNCHED olunca jobId dolar ve çağıran normal ssJobStatus
  // takibine geçebilir.
  smartTicketStatus: (ticketId: number): Promise<{ ok: boolean; status: string; smartStateName?: string; jobId?: number | null; errorMessage?: string | null; message?: string }> =>
    fetch(`${BASE}/ss/smart-ticket/${ticketId}/status`).then(safeJson),

  history: (days = 30): Promise<{ ok: boolean; history: JobHistoryRecord[] }> =>
    fetch(`${BASE}/history?days=${days}`).then(safeJson),

  getCustomization: (serverId: number, templateId: number): Promise<{ ok: boolean; customization: FieldCustomization }> =>
    fetch(`${BASE}/ss/custom/${serverId}/${templateId}`).then(safeJson),

  saveCustomization: (serverId: number, templateId: number, data: FieldCustomization): Promise<{ ok: boolean; message?: string }> =>
    fetch(`${BASE}/ss/custom/${serverId}/${templateId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(safeJson),

  // Smart RFF'in bir flowKey icin BEKLEDIGI metadata alanlarini (ElementName/IsRequired/
  // DataType) sorgular — createTicket() su an SABIT {application, requestedBy} govdesi
  // gonderiyor; flow farkli/ek alan bekliyorsa bu, tahmin yerine GERCEGI gosterir.
  smartFlowMetadata: (flowKey: string): Promise<{ ok: boolean; fields?: Array<Record<string, unknown>>; message?: string }> =>
    fetch(`${BASE}/ss/smart-flow-metadata/${encodeURIComponent(flowKey)}`).then(safeJson),
};

export interface FieldOverride {
  fieldName: string;
  label?: string;
  required?: boolean;
  defaultValue?: string;
  hidden?: boolean;
}

// Built-in launch seçeneği (limit/forks/job_tags/skip_tags/verbosity/job_type) için
// add-time admin override'ı — survey field'ların hidden/defaultValue mantığıyla aynı.
export interface LaunchOptionOverride {
  default?: string;
  hidden?: boolean;
}

// Self-Service çalıştırma/geçmiş ekranında AWX stdout'unun nasıl gösterileceği.
// enabled=false (veya tanımsız) → mevcut davranış: stdout OLDUĞU GİBİ gösterilir.
// enabled=true → yalnızca "contains" alt-dizesini İÇEREN satırlar gösterilir
// (ör. yalnızca ayırıcı satırları basan bir playbook'ta "——" verilirse tüm
// gürültü elenip yalnızca o özet satırlar alt alta kalır). Ham stdout DB'ye
// (ansible_job_output) HER ZAMAN tam yazılır — bu yalnızca EKRAN görünümüdür.
export interface OutputFilter {
  enabled: boolean;
  contains: string;
}

export interface FieldCustomization {
  fieldOverrides: FieldOverride[];
  // Survey/extra_vars fallback alanlarında karşılığı olmayan ek key:value'lar (YAML
  // satır formatı, "key: value" — bkz. server/ansible/runner.cjs parseSimpleYaml).
  // Kullanıcıya ASLA gösterilmez, her launch'a otomatik enjekte edilir.
  rawExtraVars?: string;
  launchOptionOverrides?: Partial<Record<"limit" | "forks" | "jobTags" | "skipTags" | "verbosity" | "jobType", LaunchOptionOverride>>;
  outputFilter?: OutputFilter;
  // AWX'te Survey KAPALIYSA (survey_enabled=false) admin'in portal arayüzünden
  // baştan tasarladığı "sahte" survey — SurveyField ile AYNI şekli kullanır ki
  // SurveyModal'ın mevcut render/doğrulama kodu AWX-native survey ile bunun
  // arasında hiçbir fark gözetmesin. Boşsa (tanımsız/[]) mevcut davranış
  // korunur: survey kapalı template'lerde kullanıcıya hiçbir alan sorulmaz.
  customSurveyFields?: SurveyField[];
  // İşi başlatan kullanıcının oturumdaki e-posta/kullanıcı adını extra_vars'a
  // OTOMATİK ve DEĞİŞTİRİLEMEZ şekilde ekler — kullanıcı arayüzünde hiç
  // gösterilmez, submit edilen değerler bu alanlara ASLA yazamaz (sunucu her
  // zaman oturumdan okuyup en SON adımda enjekte eder). Anahtar adları
  // (varsayılan "email"/"username") playbook'un beklediği isme göre değiştirilebilir.
  injectUserInfo?: { enabled: boolean; emailKey?: string; usernameKey?: string };
  // Etkinse bu servis çalıştırıldığında AWX job'ı hemen tetiklenmez — önce Smart'ta
  // flowKey ile bir talep açılır (bkz. server/smart/*, server/ansible/runner.cjs
  // POST /launch-ss). Kullanıcı talep onaylanana/reddedilene kadar bekler.
  // "key: value" satırları (parseSimpleYaml ile AYNI format, rawExtraVars gibi) — Smart'a
  // acilan talebin metadataData.metadatas[] listesini KURAR. SOS02-KL-001-EN'e gore `key`
  // Smart'in flowKey icin GetMetaDataOperationalRequestByFlowName'in dondurdugu
  // `ComponentType` degeriyle BIREBIR eslesmeli (ElementName DEGIL) - flowKey'in girdisi
  // yaninda "Alanlari Getir" ile bu degerler sorgulanabilir. Deger icinde {{username}}/
  // {{email}}/{{templateName}} yer tutucular sunucu tarafinda cozulur. Bos ise eski
  // varsayilan (SABIT application/requestedBy) davranisina duser.
  smartApproval?: { enabled: boolean; flowKey?: string; metadataFields?: string };
}

export interface AnsibleSsItem {
  id: string;
  title: string;
  description: string;
  awxServerId: number;
  awxTemplateId: number;
  enabled: boolean;
  order: number;
}

export interface SurveyField {
  name: string;
  label: string;
  type: string;
  required: boolean;
  defaultValue: string;
  choices: string[];
  hidden: boolean;
  description: string;
  min?: number;
  max?: number;
  // Yalnızca Survey Tasarımcısı (özel alanlar) için: seçim alanlarında AWX'e/extra_vars'a
  // giden HAM değer (choices[i]) ile kullanıcıya gösterilen metin farklı olabilir.
  choiceLabels?: Record<string, string>;
  // Yalnızca Survey Tasarımcısı için: bu alan yalnızca aşağıdaki koşul(lar) sağlanırsa
  // kullanıcıya sorulur (koşullu alan). mode="any" → koşullardan HERHANGİ BİRİ yeterli
  // (VEYA — ör. op_selection=deactive VEYA op_selection=activate); mode="all" → koşulların
  // TÜMÜ sağlanmalı (VE — farklı alanlar üzerinde birden fazla şart).
  dependsOn?: { mode: "all" | "any"; conditions: SurveyFieldCondition[] };
}

export interface SurveyFieldCondition {
  field: string;
  equals: string;
}

export interface JobHistoryRecord {
  id: number;
  username: string;
  awx_server_id: number;
  template_id: number;
  template_name: string;
  job_id: number;
  status: string;
  started_at: string;
  finished_at?: string;
  params?: string;
}
