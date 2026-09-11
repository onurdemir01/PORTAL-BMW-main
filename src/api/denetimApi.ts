// src/api/denetimApi.ts — "Denetim" sayfasinin veri istemcisi
// (bkz. server/audit/denetim.cjs).
import { safeJson } from "./http";

const BASE = "/api/denetim";

export interface NginxSpaEnvCell {
  present: boolean;
  status: string;
  namespace: string | null;
  deployMode: string | null;
  includeExists: boolean;
  appDeployed: boolean;
  inOcpInventory: boolean;
  locationPath: string;
  hosts: string[];
}

export interface NginxSpaRow {
  service: string;
  application: string;
  envs: Record<string, NginxSpaEnvCell>;
}

export interface NginxEnvStat {
  env: string;
  rows: number;
  hosts: string[];
  /** Bu env jetonunu ureten vhost dosyalari (env, dosya adindan turer). */
  vhosts: string[];
}

export interface NginxSpaResult {
  ok: boolean;
  scanDate: string | null;
  availableDates: string[];
  services: string[];
  envs: string[];
  envStats?: NginxEnvStat[];
  rows: NginxSpaRow[];
  message?: string;
}

export interface SpaCoverageRow {
  env: string;
  /** nginx tarafinda bu ortama ait hic satir yoksa false: kapsam OLCULEMEDI. */
  measured: boolean;
  /** route tipi passthrough = internet; nginx'e CIKMASI BEKLENEN kume. */
  internetTotal: number;
  internetInNginx: number;
  internetMissingCount: number;
  internetMissing: string[];
  /** route tipi reencrypt = intranet; INTRANET SPA sunucularina dagitilir. */
  intranetTotal: number;
  /** Intranet SPA sunucularinda bu ortama ait HIC satir var mi. false ise
   *  "hicbiri deploy olmamis" DEGIL, "olculemedi" demektir. */
  measuredIntranet: boolean;
  /** Uc dizinin UCU DE yerinde: /hysdeploy, /usr/nginx/applications ve
   *  application-confs/<app>-<ns>.conf. Kapsam orani YALNIZCA bunlar uzerinden. */
  intranetFull: number;
  /** Uc dizinden en az biri eksik. 404 doner ama "hic kurulmamis"tan AYRI bir
   *  istir; ikisini birlestirmek nerede mudahale gerektigini gizlerdi. */
  intranetPartialCount: number;
  intranetPartial: { app: string; namespace: string; hosts: { host: string; missing: string[] }[] }[];
  /** Hicbir intranet sunucusunda izi yok. */
  intranetMissingCount: number;
  intranetMissing: string[];
  /** Sunucuda var ama OpenShift intranet listesinde yok - BILGI, bulgu degil. */
  intranetOnlyOnServerCount: number;
  intranetOnlyOnServer: string[];
  /** Bu ortamda satir uretilen intranet sunuculari. */
  intranetHosts: string[];
  intranetCoverage: number | null;
  /** BULGU: intranet uygulamasi INTERNETE ACIK sunucuda tanimli. Intranet
   *  sunucusunda olmasi normaldir, bulgu degildir. */
  intranetInNginx: number;
  intranetInNginxList: string[];
  /** passthrough/reencrypt disindaki route tipleri (edge, tls yok). */
  otherTotal: number;
  otherInNginx: number;
  /** Route bilgisi bulunamayanlar - siniflandirilamadi. */
  unknownTotal: number;
  unknownInNginx: number;
  onlyNginxCount: number;
  onlyNginx: string[];
  /** YALNIZCA internet kumesi uzerinden. Olculemediyse null. */
  coverage: number | null;
}

export interface SpaCoverageResult {
  ok: boolean;
  platform: string;
  platforms: string[];
  clusters: string[];
  scanDate: string | null;
  spaPatternLabel: string;
  /** Route envanteri okunamadiysa true: internet/intranet ayrimi yapilamaz. */
  routeTableMissing: boolean;
  /** Route eslesme kalitesi - route adi ile uygulama adi ayni olmayabilir. */
  routeMatch: { address: number; name: number; ns: number; conflict: number; none: number };
  ocpNonSpaExcluded: number;
  nginxOutsidePattern: string[];
  ocpSkippedNoEnv: number;
  intranetScanned?: boolean;
  /** dbo.Nginx_Intranet_Audit yoksa true: DDL henuz calistirilmamis. "Hicbiri
   *  deploy edilmemis" ile KARISTIRILMAMALI. */
  intranetTableMissing?: boolean;
  /** Beklenmeyen durum: intranet sunucusunda servis vhost'u tanimi bulundu. */
  intranetVhostRows?: number;
  rows: SpaCoverageRow[];
  message?: string;
}

// ── Nginx Legacy (PROD, proxy_pass + upstream) ────────────────────────────────────────
export interface NginxLegacyFinding {
  type: string;
  /** Tip kodunun okunabilir karsiligi; bilinmeyen tip KODUYLA gosterilir. */
  label: string;
  severity: number;
  item: string;
  detail: string;
}

export interface NginxLegacyHost {
  host: string;
  vhostFiles: string;
  upstreamFiles: string;
  serverBlocks: number;
  locationsTotal: number;
  locationsProxy: number;
  /** deny / return / rewrite / static - KASITLI olarak proxy'siz olanlar. */
  locationsOther: number;
  upstreamsTotal: number;
  /** ANA conf dosyasinda tanimli upstream sayisi. */
  upstreamsInVhost: number;
  upstreamsInFile: number;
  /** Hedefi tanimli bir upstream OLMAYAN location - upstream katmanini atliyor. */
  proxyWithoutUpstream: number;
  unusedUpstreams: number;
  upsNoResolve: number;
  upsNoKeepalive: number;
  upsNoZone: number;
  findings: NginxLegacyFinding[];
}

export interface NginxLegacyService {
  service: string;
  peerGroup: string;
  hostCount: number;
  hosts: NginxLegacyHost[];
  findings: number;
  /** Eslenik sunucularin sayilari AYNI mi. */
  consistent: boolean;
  signatures: string[];
  locationsTotal: number;
  locationsProxy: number;
  upstreamsTotal: number;
  upstreamsInVhost: number;
  proxyWithoutUpstream: number;
  unusedUpstreams: number;
  upsNoResolve: number;
  upsNoKeepalive: number;
  upsNoZone: number;
}

export interface NginxLegacyResult {
  ok: boolean;
  /** dbo.Nginx_Legacy_Audit yoksa false: DDL calistirilmamis. "Bulgu yok" DEGIL. */
  schemaReady: boolean;
  scanDate: string | null;
  services: NginxLegacyService[];
  totals: {
    services: number;
    hosts: number;
    locations: number;
    upstreams: number;
    proxyWithoutUpstream: number;
    unusedUpstreams: number;
    inconsistent: number;
    findings: number;
  } | null;
  byType: { type: string; count: number; label: string; severity: number }[];
  message?: string;
}

export interface OcpCoverageRow {
  application: string;
  envs: Record<string, { cluster: string; namespace: string }[]>;
  present: string[];
  missing: string[];
  missingCount: number;
}

export interface OcpCoverageResult {
  ok: boolean;
  platform: string;
  platforms: string[];
  clusters: string[];
  envs: string[];
  totalApplications: number;
  completeCount: number;
  skippedNoEnv: number;
  patterns: { missing: string[]; count: number }[];
  /** Ortam basina GERCEKTE kullanilan cluster'lar + her birindeki uygulama sayisi.
   *  Sabit bir liste DEGIL, veriden cikarilir: platformun cluster listesi ortam ayrimi
   *  tasimaz (bkz. server/audit/ocp-platforms.cjs). */
  envClusters: Record<string, { cluster: string; apps: number }[]>;
  rows: OcpCoverageRow[];
  message?: string;
}

export interface InitScriptVariant {
  hash: string;
  count: number;
  hosts: string[];
}

export interface InitScriptStat {
  key: string;
  label: string;
  /** startCustom.sh gibi sunucuya OZEL olmasi beklenen dosyalar; sapma sayilmaz. */
  perServer: boolean;
  present: number;
  missing: number;
  missingHosts: string[];
  variantCount: number;
  majorityHash: string | null;
  majorityCount: number;
  deviatingCount: number;
  variants: InitScriptVariant[];
}

export interface InitScriptHostRow {
  host: string;
  deviations: string[];
  deviationCount: number;
  missing: string[];
  missingCount: number;
  hasCustom: boolean;
  customHash: string | null;
}

export interface InitScriptsResult {
  ok: boolean;
  root: string;
  roots: string[];
  hosts: number;
  scriptCount: number;
  identicalHosts: number;
  totalVariants: number;
  customHosts: number;
  missingColumns: string[];
  scripts: InitScriptStat[];
  hostRows: InitScriptHostRow[];
  message?: string;
}

export interface EnvanterDistRow {
  value: string;
  /** Satir sayisi (Sunucular icin = sunucu, uygulama tablolari icin = uygulama kaydi). */
  count: number;
  /** Bu degere sahip FARKLI sunucu sayisi. */
  hosts: number;
}

export interface EnvanterProduct {
  key: string;
  label: string;
  /** Surum alani DOLU olan sunucu sayisi. */
  installed: number;
  versionCount: number;
  versions: EnvanterDistRow[];
}

export interface EnvanterSummary {
  ok: boolean;
  source: string;
  label: string;
  unit: string;
  totals: {
    rows: number;
    hosts: number;
    apps: number;
    numerics: { key: string; label: string; value: number }[];
  };
  dims: { key: string; label: string }[];
  products: EnvanterProduct[];
  distributions: Record<string, EnvanterDistRow[]>;
  message?: string;
}

export interface EnvanterPivot {
  ok: boolean;
  source: string;
  metric: "rows" | "hosts";
  x: { key: string; label: string; values: { value: string; count: number }[] };
  y: { key: string; label: string; values: { value: string; count: number }[] };
  /** Anahtar: `${sutunDegeri}\u0001${satirDegeri}` — ayirici sunucu tarafiyla AYNI. */
  cells: Record<string, number>;
  total: number;
  message?: string;
}

export interface AppEnvCell {
  hosts: string[];
  rows: number;
}

export interface AppEnvRow {
  /** Son ek atilmis taban ad; matris satirlari buna gore gruplanir. */
  base: string;
  envs: Record<string, AppEnvCell | null>;
  present: string[];
  missing: string[];
  missingCount: number;
}

export interface AppEnvsResult {
  ok: boolean;
  source: string;
  label: string;
  sources: { key: string; label: string }[];
  envs: string[];
  totalRows: number;
  totalApps: number;
  completeCount: number;
  patterns: { missing: string[]; count: number }[];
  rows: AppEnvRow[];
  /** Ad kuralina uymayan uygulamalar (kucuk harf, taninmayan son ek, ortam sozcugu). */
  nonStandard: { app: string; reason: string; hosts: string[]; envColumn: string[] }[];
  /** Ad kuralinin sordugu ortam ile env sutunu celisen kayitlar. */
  conflicts: { app: string; base: string; nameEnv: string; envColumn: string; hosts: string[] }[];
  /** Ad kuralinda karsiligi olmayan env degerleri (Alpha, ODM ...). */
  outOfScopeEnvColumns: { envColumn: string; appCount: number; known: boolean }[];
  message?: string;
}

export interface WebAppVhost {
  host: string;
  ip: string;
  port: string;
  serverName: string;
  confFile: string;
  product: string;
}

export interface WebAppRow {
  app: string;
  appHost: string;
  env: string;
  domain: string;
  /** "3-tier" | "2-tier" | "bilinmiyor" - domain'den turer. */
  tier: string;
  /** Eslesmenin NASIL kuruldugu; guvenilirlik buna bagli. */
  how: string;
  matched: boolean;
  web: WebAppVhost[];
  /** Eslesme kurulamadiysa kurala gore BEKLENEN web sunucusu. */
  webHostCandidate: string;
  vhostCountOnHost: number;
}

export interface WebAppResult {
  ok: boolean;
  source: string;
  label: string;
  sources: { key: string; label: string }[];
  certMissing: boolean;
  total: number;
  shown: number;
  capped: boolean;
  matchSummary: { how: string; count: number }[];
  tierSummary: { tier: string; count: number }[];
  rows: WebAppRow[];
  message?: string;
}

export interface NginxLocationRow {
  service: string;
  env: string;
  locationPath: string;
  includeName: string;
  application: string;
  namespace: string;
  deployMode: string;
  includeExists: boolean;
  appDeployed: boolean;
  inOcpInventory: boolean;
  status: string;
  vhosts: string[];
  hosts: string[];
  /** Location yolu uygulama adini iceriyor mu? Damga degil, dikkat cekici isaret. */
  pathMatchesApp: boolean;
}

export interface NginxLocationsResult {
  ok: boolean;
  scanDate: string | null;
  services: string[];
  envs: string[];
  statusCounts: { status: string; count: number }[];
  total: number;
  shown: number;
  capped: boolean;
  /** Location blogunun HAM govdesi taraniyor mu (su an hayir). */
  bodyAvailable: boolean;
  rows: NginxLocationRow[];
  message?: string;
}

/** Nginx API Envanteri (dbo.NginxRateLimitInventory) - ortam SUNUCU ADINDAN turetilir,
 *  konfigurasyon dosya adlari ortamdan bagimsiz olarak AYNIDIR. */
export interface NginxApiEnvRow {
  env: string;
  hosts: number;
  configs: number;
  locations: number;
  noLimitLocations: number;
  configsWithoutLimit: number;
}

export interface NginxApiHostRow {
  host: string;
  env: string;
  /** Yalnizca production icin anlamli: "Ankara" | "Pendik" | "". */
  site: string;
  configs: number;
  locations: number;
  noLimitLocations: number;
}

export interface NginxApiConfigHost {
  host: string;
  env: string;
  site: string;
  locations: number;
  noLimit: number;
}

export interface NginxApiEnvCell {
  hosts: number;
  locations: number;
  /** Ayni ortamdaki sunucularin en az/en cok location sayisi; farkliysa SURUKLENME var. */
  minLoc: number;
  maxLoc: number;
}

export interface NginxApiConfigRow {
  config: string;
  envs: Record<string, NginxApiEnvCell>;
  presentEnvs: string[];
  missingEnvs: string[];
  /** Ayni ortamin sunuculari birbirinden farkli. */
  hostInconsistent: boolean;
  /** Ortamlarin beklenen location sayisi birbirinden farkli. */
  envInconsistent: boolean;
  totalLocations: number;
  noLimitLocations: number;
  noLimitEverywhere: boolean;
  hosts: NginxApiConfigHost[];
}

export interface NginxApiResult {
  ok: boolean;
  scanDate: string | null;
  availableDates: string[];
  envs: string[];
  totals: {
    hosts: number;
    configs: number;
    locations: number;
    noLimitLocations: number;
    configsWithoutLimit: number;
    inconsistentConfigs: number;
  };
  byEnv: NginxApiEnvRow[];
  byHost: NginxApiHostRow[];
  byConfig: NginxApiConfigRow[];
  noLimitConfigs: string[];
  message?: string;
}

/** Production proxy tanimi (kind='proxy'). SPA'ya ozgu alanlar burada YOKTUR. */
export interface NginxProxyRow {
  service: string;
  env: string;
  vhost: string;
  locationPath: string;
  upstreamName: string | null;
  targetUrl: string | null;
  /** proxy_pass hedefi AYNI dosyada upstream olarak tanimli mi (tek basina hata degil). */
  upstreamDefined: boolean;
  inOcpInventory: boolean;
  status: string;
  /** Ayni tanimin goruldugu sunucular - eksik kalan bir sunucu buradan farkedilir. */
  hosts: string[];
}

export interface NginxProxyResult {
  ok: boolean;
  /** DDL (kind/upstream_name/target_url/upstream_defined) uygulanmis mi?
   *  false ise "hic tanim yok" DEGIL, "henuz olculemiyor" demektir. */
  schemaReady: boolean;
  scanDate: string | null;
  envs: string[];
  services: string[];
  totals: {
    rows: number;
    vhosts: number;
    hosts: number;
    nonProdTarget: number;
    undefinedUpstream: number;
  };
  rows: NginxProxyRow[];
  message?: string;
}

/** API (location) bazinda kirilim: her yol hangi ORTAMDA, hangi SUNUCULARDA? */
export interface NginxApiLocationCell {
  hosts: string[];
  /** O ortamda gorulen FARKLI limit degerleri; birden fazlaysa surukleme var. */
  ipRateLimits: string[];
  serverRateLimits: string[];
}

export interface NginxApiLocationRow {
  config: string;
  location: string;
  envs: Record<string, NginxApiLocationCell>;
  presentEnvs: string[];
  missingEnvs: string[];
  totalHosts: number;
  /** AYNI ortamdaki sunucular farkli limit tasiyor - genelde HATA. */
  limitDrift: boolean;
  /** Ortamlar arasi limit farki - kasitli olabilir ama gorunur olmali. */
  envLimitDrift: boolean;
}

export interface NginxApiLocationsResult {
  ok: boolean;
  scanDate: string | null;
  envs: string[];
  rows: NginxApiLocationRow[];
  message?: string;
}

/** Bir alanin deger dagilimi (cok gorulen once). */
export interface NginxInvDist {
  value: string;
  count: number;
}

/** GiB toplami; cozulemeyen degerler `unparsed` altinda AYRICA bildirilir -
 *  uydurulmus bir sayi toplamlari sessizce bozardi. */
export interface NginxInvSize {
  totalGiB: number;
  parsed: number;
  unparsed: number;
}

export interface NginxInvHost {
  hostname: string;
  fqdn: string | null;
  env: string;
  location: string | null;
  service: string | null;
  services: string | null;
  service_count: string | number | null;
  domain: string | null;
  ip: string | null;
  subnet: string | null;
  os: string | null;
  kernel: string | null;
  architecture: string | null;
  cpu: string | number | null;
  memory: string | null;
  nginx_version: string | null;
  nginx_user: string | null;
  nginx_prefix: string | null;
  config_count: string | number | null;
  disk_usr_nginx: string | null;
  disk_web_log: string | null;
  source_last_update: string | null;
  metadata_version: string | number | null;
}

export interface NginxInventoryResult {
  ok: boolean;
  /** Tabloda scan_date YOK (her kosuda TRUNCATE+yeniden yazim); tazelik gostergesi budur. */
  lastUpdate: string | null;
  totals: {
    hosts: number;
    envs: number;
    services: number;
    nginxVersions: number;
    osVersions: number;
    cpuTotal: number;
    memory: NginxInvSize;
    diskNginx: NginxInvSize;
    diskWebLog: NginxInvSize;
  };
  byEnv: { env: string; hosts: number; locations: { location: string; hosts: number }[] }[];
  byService: { service: string; hosts: number; envs: string[] }[];
  versions: {
    nginx: NginxInvDist[];
    os: NginxInvDist[];
    kernel: NginxInvDist[];
    architecture: NginxInvDist[];
    metadata: NginxInvDist[];
  };
  resources: {
    cpu: NginxInvDist[];
    memory: NginxInvDist[];
    diskNginx: NginxInvDist[];
    diskWebLog: NginxInvDist[];
    configCount: NginxInvDist[];
    serviceCount: NginxInvDist[];
  };
  other: {
    domain: NginxInvDist[];
    subnet: NginxInvDist[];
    nginxUser: NginxInvDist[];
  };
  hosts: NginxInvHost[];
  message?: string;
}

export const denetimApi = {
  nginxProxy: (scanDate?: string): Promise<NginxProxyResult> =>
    fetch(`${BASE}/nginx-proxy${scanDate ? `?scanDate=${encodeURIComponent(scanDate)}` : ""}`).then(safeJson),

  nginxInventory: (): Promise<NginxInventoryResult> =>
    fetch(`${BASE}/nginx-inventory`).then(safeJson),

  nginxApiLocations: (scanDate?: string): Promise<NginxApiLocationsResult> =>
    fetch(`${BASE}/nginx-api-locations${scanDate ? `?scanDate=${encodeURIComponent(scanDate)}` : ""}`).then(safeJson),

  nginxApi: (scanDate?: string): Promise<NginxApiResult> =>
    fetch(`${BASE}/nginx-api${scanDate ? `?scanDate=${encodeURIComponent(scanDate)}` : ""}`).then(safeJson),

  nginxLegacy: (): Promise<NginxLegacyResult> =>
    fetch(`${BASE}/nginx-legacy`).then(safeJson),

  nginxSpa: (scanDate?: string): Promise<NginxSpaResult> =>
    fetch(`${BASE}/nginx-spa${scanDate ? `?scanDate=${encodeURIComponent(scanDate)}` : ""}`).then(safeJson),

  spaCoverage: (platform: string): Promise<SpaCoverageResult> =>
    fetch(`${BASE}/nginx-spa-coverage?platform=${encodeURIComponent(platform)}`).then(safeJson),

  ocpCoverage: (platform: string): Promise<OcpCoverageResult> =>
    fetch(`${BASE}/ocp-coverage?platform=${encodeURIComponent(platform)}`).then(safeJson),

  initScripts: (root: string): Promise<InitScriptsResult> =>
    fetch(`${BASE}/init-scripts?root=${encodeURIComponent(root)}`).then(safeJson),

  nginxLocations: (p: { service?: string; env?: string; status?: string; q?: string }): Promise<NginxLocationsResult> => {
    const qs = new URLSearchParams();
    if (p.service) qs.set("service", p.service);
    if (p.env) qs.set("env", p.env);
    if (p.status) qs.set("status", p.status);
    if (p.q) qs.set("q", p.q);
    return fetch(`${BASE}/nginx-locations?${qs.toString()}`).then(safeJson);
  },

  webApp: (source: string, q?: string, onlyUnmatched?: boolean): Promise<WebAppResult> =>
    fetch(`${BASE}/web-app?source=${encodeURIComponent(source)}`
      + (q ? `&q=${encodeURIComponent(q)}` : "")
      + (onlyUnmatched ? "&onlyUnmatched=1" : "")).then(safeJson),

  appEnvs: (source: string): Promise<AppEnvsResult> =>
    fetch(`${BASE}/app-envs?source=${encodeURIComponent(source)}`).then(safeJson),

  envanterSummary: (source: string): Promise<EnvanterSummary> =>
    fetch(`${BASE}/envanter/summary?source=${encodeURIComponent(source)}`).then(safeJson),

  envanterPivot: (p: {
    source: string; x: string; y: string; metric: string; hideEmpty: boolean;
  }): Promise<EnvanterPivot> =>
    fetch(`${BASE}/envanter/pivot?source=${encodeURIComponent(p.source)}`
      + `&x=${encodeURIComponent(p.x)}&y=${encodeURIComponent(p.y)}`
      + `&metric=${encodeURIComponent(p.metric)}&hideEmpty=${p.hideEmpty ? "1" : "0"}`).then(safeJson),
};
