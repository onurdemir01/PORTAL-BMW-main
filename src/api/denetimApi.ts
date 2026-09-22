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
  /** PROD: eski GBRVP* sunucusundaki proxy_pass hedefi (status='PROXY') */
  proxyTarget?: string | null;
  /** proxy yaziminda -prod eksikti, eklenerek cozuldu */
  suffixAdded?: boolean;
  /** PROD proxy: tasima grubunun eski sunuculari ve proxy tanimi OLMAYANLAR (2026-09-17) */
  oldExpected?: string[];
  oldMissing?: string[];
  /** H/A/C dizin bayraklari (sunucu basina); flags null = o sunucuda dizin yok.
   *  PROD proxy hucrelerinde sunucular YENI prod SPA sunuculardir (tasima grubu). */
  dirs?: { host: string; flags: { hys: boolean; app: boolean; conf: boolean } | null }[];
}

/** Uygulamanin sorumlu ekibi = namespace'inin CMDB sahibi (dbo.Openshift_Namespace_Owners). */
export interface AppOwner {
  /** benzersiz AD grup adlari; bos = hicbir namespace icin sahip cozulmemis */
  groups: string[];
  emails: string[];
  /** sahibi bilinmeyen namespace'ler */
  unknownNs: string[];
  namespaces?: string[];
}

export interface NginxSpaRow {
  service: string;
  application: string;
  envs: Record<string, NginxSpaEnvCell>;
  owner?: AppOwner;
}

export interface NginxEnvStat {
  env: string;
  rows: number;
  hosts: string[];
  /** Bu env jetonunu ureten vhost dosyalari (env, dosya adindan turer). */
  vhosts: string[];
}

// ── Nginx SPA > Prod Tasima (eski GBRVP* -> yeni GBNGXP4x/5x) ───────────────────────
export interface NginxMigrationDirFlags {
  hys: boolean;
  app: boolean;
  conf: boolean;
}
export interface NginxMigrationApp {
  namespace: string;
  application: string;
  /** hedef nasil cozuldu: route (adres birebir) | inventory (envanter cifti) */
  how: string;
  target: string;
  /** gercek arka uc nereden: upstream-server | proxy_ssl_name | proxy_pass */
  targetSource: string;
  /** yazimda namespace "-prod" eksizdi; ek eklenerek cozuldu */
  suffixAdded: boolean;
  /** proxy_pass yazim bicimleri: 'fqdn' | 'upstream' */
  forms: string[];
  /** proxy_pass'te yazan ad(lar) */
  written: string[];
  services: string[];
  oldHosts: string[];
  locations: string[];
  locationCount: number;
  /** eski sunucudaki (vhost servisi, context path) ciftleri - "Tanim olustur" secimi icin.
   *  newHosts / newStatus (2026-09-17): bu location YENI sunucularda tanimli mi
   *  (defined = hepsinde, partial = bazisinda, none = hicbirinde, not-scanned). */
  paths: { service: string; location: string; hosts: string[]; newHosts: string[]; newStatus: 'defined' | 'partial' | 'none' | 'not-scanned' }[];
  /** yeni host -> bayraklar; null = o sunucu henuz taranmadi */
  perHost: Record<string, NginxMigrationDirFlags | null>;
  readyHosts: number;
  scannedHosts: number;
  status: 'ready' | 'partial' | 'missing' | 'not-scanned';
  owner?: AppOwner;
}
export interface NginxMigrationOther {
  target: string;
  namespace?: string | null;
  application?: string | null;
  how: string;
  candidates?: string[];
  targetSource?: string;
  forms?: string[];
  written?: string[];
  services: string[];
  oldHosts: string[];
  locations: string[];
  locationCount: number;
}
export interface NginxMigrationGroup {
  id: string;
  label: string;
  oldHosts: string[];
  newHosts: string[];
  newHostsScanned: string[];
  oldHostsSeen: string[];
  /** eski sunucularda servis basina location sayisi (SPA-disi dahil) ve yeni sunucudaki
   *  tanim durumu sayilari (location ilerlemesi, 2026-09-17) */
  serviceLocations: { service: string; locations: number; defined: number; partial: number; none: number; notScanned: number }[];
  apps: NginxMigrationApp[];
  nonSpa: NginxMigrationOther[];
  unresolved: NginxMigrationOther[];
  totals: {
    apps: number; ready: number; partial: number; missing: number; notScanned: number; nonSpa: number; unresolved: number;
    /** location ilerlemesi: eski sunuculardaki tum location'lar (SPA + SPA-disi + cozulemeyen) */
    locations: { total: number; defined: number; partial: number; none: number; notScanned: number };
  };
}
export interface NginxMigrationResult {
  ok: boolean;
  message?: string;
  ownersReady?: boolean;
  proxyReady: boolean;
  dirsReady: boolean;
  proxyScanDate: string | null;
  dirScanDate: string | null;
  groups: NginxMigrationGroup[];
}

export interface NginxSpaResult {
  ok: boolean;
  scanDate: string | null;
  availableDates: string[];
  services: string[];
  envs: string[];
  envStats?: NginxEnvStat[];
  rows: NginxSpaRow[];
  /** dbo.Openshift_Namespace_Owners okunabildi mi */
  ownersReady?: boolean;
  /** dbo.Nginx_Intranet_Audit (dizin taramasi) okunabildi mi -> hucrelerde H/A/C */
  dirsReady?: boolean;
  /** servis basina location sayisi, ortam kirilimiyla (mirror sunucular carpilmaz) */
  serviceStats?: { service: string; envs: Record<string, number> }[];
  /** PROD proxy satirlari matrise katildi: kac satir, kaci cozuldu */
  prodProxy?: { rows: number; resolved: number; unresolved: number } | null;
  message?: string;
}

export interface SpaCoverageRow {
  env: string;
  /** nginx tarafinda bu ortama ait hic satir yoksa false: kapsam OLCULEMEDI. */
  measured: boolean;
  /** Ortam ozeti (2026-09-17): ortamdaki TUM OpenShift uygulamalari ve TUM SPA'lar. */
  ocpApps: number;
  spaTotal: number;
  /** route tipi passthrough = internet; nginx'e CIKMASI BEKLENEN kume. */
  internetTotal: number;
  internetInNginx: number;
  /** nginx'te tanimli internet SPA'larinin SERVIS (vhost: GLOMO, WEBFORMS...) kirilimi (2026-09-17).
   *  Birden fazla serviste tanimli uygulama her serviste sayilir; internetMultiService kac tane. */
  internetServices?: { service: string; count: number }[];
  internetMultiService?: number;
  /** bir nginx servisinin altinda hizmet alan FARKLI internet SPA sayisi (servis toplami degil) */
  internetServiced?: number;
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
  /** Deploy olmamis uygulamalar + sahiplik (2026-09-17). internet: nginx'te tanimi yok;
   *  intranet: hic kurulmamis (missing) ya da yarim (partial: eksik dizinler sunucu basina). */
  missingDetail?: {
    internet: SpaMissingApp[]; intranet: SpaMissingApp[]; noRoute?: SpaMissingApp[];
    notDeployed?: SpaMissingApp[]; deployedNotDefined?: SpaMissingApp[]; definedNotDeployed?: SpaMissingApp[];
  };
  /** internet sunucularinda dizin taramasi (H+A) - 2026-09-18 */
  internetDirsMeasured?: boolean;
  internetDeployed?: number;
  internetServing?: number;
  internetNotDeployedCount?: number;
  internetDeployedNotDefinedCount?: number;
  internetDefinedNotDeployedCount?: number;
}
export interface SpaMissingApp {
  app: string;
  namespaces: string[];
  owner: AppOwner;
  kind: 'missing' | 'partial' | 'noroute' | 'notdeployed' | 'notdefined' | 'nopackage';
  /** notdeployed: konfigurasyon tanimi var mi (var ise 404 riski) */
  defined?: boolean;
  /** noroute: nginx'te yine de tanimli mi (eski sunucuda proxy / include) */
  inNginx?: boolean;
  namespace?: string;
  hosts?: { host: string; missing: string[] }[];
}

// ── Route istatistikleri (ortam basina route / SPA / IP) ─────────────────────────────
export interface RouteStatsIp {
  ip: string;
  count: number;
  samples: string[];
}
export interface RouteStatsEnv {
  env: string;
  routes: number;
  spa: number;
  nonSpa: number;
  unclassified: number;
  clusters: string[];
  namespaces: number;
  terminations: { type: string; count: number }[];
  spaIps: RouteStatsIp[];
  nonSpaIps: RouteStatsIp[];
  unresolvedIp: { spa: number; nonSpa: number };
}
export interface RouteOfIp {
  namespace: string;
  route: string;
  address: string;
  type: string;
  kind: 'spa' | 'nonSpa' | 'unclassified';
  cluster: string;
}
export interface RoutesOfIpResult {
  ok: boolean;
  message?: string;
  ip: string;
  env: string;
  kind: string;
  routeTableMissing: boolean;
  rows: RouteOfIp[];
}
export interface RouteStatsResult {
  ok: boolean;
  message?: string;
  platform: string;
  routeTableMissing: boolean;
  envs: RouteStatsEnv[];
  totals: { routes: number; spa: number; nonSpa: number; unclassified: number; noEnv: number };
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
  /** dbo.Openshift_Namespace_Owners okunabildi mi (sahiplik sutunu icin) */
  ownersReady?: boolean;
  /** PROD nginx kumesi eski GBRVP* proxy_pass satirlarindan cozulur (Production Tasimalari ile ayni cozum) */
  prodProxy?: { rows: number; resolved: number; spa: number; unresolved: number };
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
export interface NginxAuditAllowedValue { id: number; directive: string; value: string; note: string | null; created_by?: string | null; created_at?: string }
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
  byType: NginxLegacyType[];
  /** Ekran icin gruplu gorunum; yalnizca bulgusu OLAN gruplar. */
  groups: NginxLegacyGroup[];
  message?: string;
}

export interface NginxLegacyType {
  type: string;
  count: number;
  label: string;
  title: string;
  /** "Bu ne demek?" - tek cumle. */
  meaning: string;
  /** "Ne yapmali?" - tek cumle. */
  action: string;
  group: 'critical' | 'peer' | 'hygiene' | 'info' | string;
  severity: number;
}

export interface NginxLegacyGroup {
  id: string;
  title: string;
  blurb: string;
  tone: 'danger' | 'warning' | 'neutral' | 'muted' | string;
  types: NginxLegacyType[];
  count: number;
}

// ── Nginx Audit (tum sunucular, nginx -T) ────────────────────────────────────────────
export interface NginxAuditServer {
  file: string;
  filePath: string;
  seq: number;
  listen: string;
  serverName: string;
  ssl: boolean;
  /** ssl_certificate dosya adi (tam yol certPath'te). */
  cert: string;
  certPath: string;
  locations: number;
}

export interface NginxAuditFileLocations {
  file: string;
  filePath: string;
  total: number;
  proxy: number;
  /** proxy_pass hedefi TANIMLI bir upstream. */
  toUpstream: number;
  /** proxy_pass dogrudan DNS adina; calisir ama upstream katmani devre disi. */
  toFqdn: number;
  /** hedef ne upstream ne cozumlenebilir ad: nginx BASLAMAZ. */
  undefined: number;
  other: number;
  fqdnList: { location: string; target: string }[];
  undefinedList: { location: string; target: string }[];
}

export interface NginxAuditUpstream {
  file: string;
  name: string;
  server: string;
  resolve: boolean;
  keepalive: boolean;
  zone: boolean;
  used: boolean;
}

export interface NginxAuditSettingMismatch {
  directive: string;
  value: string;
  reference: string | null;
  file: string;
  /** referansta var, sunucuda HIC yok */
  missing: boolean;
}

export interface NginxAuditSettingOverride {
  context: string;
  directive: string;
  value: string;
  reference: string | null;
  count: number;
}

/** Kurulum dosyasi uyumu: nginx_installation/operations/files (licences haric) sunucuya
 *  oldugu gibi kopyalanir; sunucudaki kopya referansla birebir olmali. */
export interface NginxAuditRefFile {
  /** referans dosya adi (nginx.conf yerine nginx_plus.conf olabilir) */
  refFile: string;
  /** sunucudaki yol */
  path: string;
  exists: boolean;
  /** null: referans dosyasi bulunamadi, hukum yok */
  identical: boolean | null;
  /** referansta var, sunucuda yok */
  missing: number;
  /** ikisinde de var, deger farkli */
  changed: number;
  /** sunucuda var, referansta yok */
  extra: number;
  details: { kind: 'missing' | 'changed' | 'extra' | string; key: string; ref: string | null; server: string | null }[];
}

export interface NginxAuditHost {
  host: string;
  env: string;
  /** ortam nereden: name (ad kalibi) | inventory (dbo.Inventory.env) | inventory-unknown | none */
  envSource: string;
  site: string;
  tier: string;
  /** nginx -T: ok | fail. fail = konfigurasyon RELOAD EDILEMEZ. */
  status: string;
  statusMsg: string;
  files: number;
  serverBlocks: number;
  locations: number;
  locationsProxy: number;
  upstreams: number;
  upsNoResolve: number;
  upsNoKeepalive: number;
  upsNoZone: number;
  unusedUpstreams: number;
  proxyFqdn: number;
  proxyUndefined: number;
  /** Istisnada sifirlanan degerlerin ham hali (sunucu sayfasi / iyimser guncelleme). */
  proxyFqdnRaw?: number;
  proxyUndefinedRaw?: number;
  settingsMismatch: number;
  issues: number;
  servers: NginxAuditServer[];
  locationsByFile: NginxAuditFileLocations[];
  upstreamList: NginxAuditUpstream[];
  settingsMismatched: NginxAuditSettingMismatch[];
  settingsOverrides: NginxAuditSettingOverride[];
  /** TUM global referans direktifleri (uyumlular dahil) — "standart degerler" tablosu */
  settingsAll: NginxAuditSettingRow[];
  refFiles: NginxAuditRefFile[];
  /** Istisna kaydi (Portal DB): varsa metrikler gosterilmez, toplamlara girmez */
  exception: { note: string; by: string | null; at: string | null } | null;
  /** referanstan farkli (ya da eksik) kurulum dosyasi sayisi */
  refFilesDiff: number;
  refFilesMissing: number;
}

export interface NginxAuditSettingRow {
  directive: string;
  context: string;
  /** null: sunucuda hic tanimli degil */
  value: string | null;
  reference: string;
  matches: boolean;
  file: string;
}

/** Kurulum referansindaki (bmw_defaults.conf, proxy_settings.conf, rate_limits.conf,
 *  nginx.conf) standart degerler — tum sunucular icin ayni. */
export interface NginxAuditReferenceValue {
  directive: string;
  context: string;
  value: string;
}

export interface NginxAuditHostResult {
  ok: boolean;
  message?: string;
  schemaReady: boolean;
  filesReady: boolean;
  scanDate: string | null;
  /** null: son taramada bu sunucu yok */
  host: NginxAuditHost | null;
  reference?: NginxAuditReferenceValue[];
}

export interface NginxAuditResult {
  ok: boolean;
  /** dbo.Nginx_Audit_* yoksa false: DDL calistirilmamis. */
  schemaReady: boolean;
  /** dbo.Nginx_Audit_Files yoksa false: dosya uyumu DDL'i sonradan eklendi. */
  filesReady: boolean;
  scanDate: string | null;
  hosts: NginxAuditHost[];
  /** standart degerler (kurulum referansi), direktif bazinda */
  reference?: NginxAuditReferenceValue[];
  totals: {
    hosts: number;
    configInvalid: number;
    serverBlocks: number;
    locations: number;
    upstreams: number;
    proxyUndefined: number;
    proxyFqdn: number;
    unusedUpstreams: number;
    upsNoResolve: number;
    refFilesDiff: number;
    refFilesMissing: number;
    hostsWithFileDiff: number;
    hostsEnvUnknown: number;
    /** istisnali sunucu sayisi (toplamlarin disinda) */
    excepted: number;
    upsNoKeepalive: number;
    settingsMismatch: number;
    hostsWithMismatch: number;
  } | null;
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
  /** Deployment Scripts: son tarama gunu (uzun tablo scan_date) */
  scanDate?: string | null;
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

/** Route Trafigi (2026-09-21): dbo.BMW_Openshift_Route_Traffic (route_traffic job'i, Thanos). */
export type RouteTrafficStatus = 'active' | 'silent' | 'dead' | 'nodata';
export interface RouteTrafficRow {
  namespace: string;
  route: string;
  address: string;
  app: string;
  spa: boolean;
  env: string | null;
  clusters: string[];
  inInventory: boolean;
  req7: number;
  req30: number;
  req90: number;
  /** son 90 gunun gunluk ortalamasi (pencereye gore) */
  perDay: number;
  err4xxPct: number;
  err5xxPct: number;
  /** istek gorulen son gun (YYYY-MM-DD) */
  lastSeen: string | null;
  lastScan: string | null;
  status: RouteTrafficStatus;
}
export interface RouteTrafficResult {
  ok: boolean;
  message?: string;
  tableMissing: boolean;
  rows: RouteTrafficRow[];
  summary: { routes: number; active: number; silent: number; dead: number; nodata: number; spa: number; spaDead: number };
  latestScan: string | null;
  earliestScan: string | null;
  daysCovered: number;
  silentDays: number;
  deadDays: number;
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
  /** Sunucunun servis(ler)i = vhost dosyalari (mblcustomers, customers, mcustomers...);
   *  nginx_audit server bloklarindan. Bos = audit verisi yok. */
  services: string[];
  serverNames: string[];
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
    /** tablodaki env ile sunucu adi kalibinin celistigi sunucu (betik duzeltmesi yayilana kadar) */
    envCorrected?: number;
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

  // fresh=true: sunucu onbellegini atla (Yenile dugmesi). Varsayilan: 60 sn onbellek.
  nginxAudit: (fresh = false): Promise<NginxAuditResult> =>
    fetch(`${BASE}/nginx-audit${fresh ? '?fresh=1' : ''}`).then(safeJson),

  nginxAuditExceptionSet: (host: string, note: string): Promise<{ ok: boolean; message?: string; by?: string | null }> =>
    fetch(`${BASE}/nginx-audit/exceptions/${encodeURIComponent(host)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    }).then(safeJson),

  nginxAuditExceptionClear: (host: string): Promise<{ ok: boolean; message?: string }> =>
    fetch(`${BASE}/nginx-audit/exceptions/${encodeURIComponent(host)}`, { method: 'DELETE' }).then(safeJson),

  // Kabul edilen degerler (2026-09-22): referans disinda da gecerli sayilan direktif degerleri
  nginxAuditAllowed: (): Promise<{ ok: boolean; rows: NginxAuditAllowedValue[]; message?: string }> =>
    fetch(`${BASE}/nginx-audit/allowed`).then(safeJson),
  nginxAuditAllowedAdd: (directive: string, value: string, note: string): Promise<{ ok: boolean; message?: string }> =>
    fetch(`${BASE}/nginx-audit/allowed`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ directive, value, note }) }).then(safeJson),
  nginxAuditAllowedRemove: (id: number): Promise<{ ok: boolean; message?: string }> =>
    fetch(`${BASE}/nginx-audit/allowed/${id}`, { method: 'DELETE' }).then(safeJson),

  nginxAuditHost: (host: string): Promise<NginxAuditHostResult> =>
    fetch(`${BASE}/nginx-audit/host/${encodeURIComponent(host)}`).then(safeJson),

  nginxLegacy: (fresh = false): Promise<NginxLegacyResult> =>
    fetch(`${BASE}/nginx-legacy${fresh ? '?fresh=1' : ''}`).then(safeJson),

  nginxMigration: (fresh = false): Promise<NginxMigrationResult> =>
    fetch(`${BASE}/nginx-migration${fresh ? '?fresh=1' : ''}`).then(safeJson),

  nginxSpa: (scanDate?: string, fresh = false): Promise<NginxSpaResult> => {
    const q = new URLSearchParams();
    if (scanDate) q.set("scanDate", scanDate);
    if (fresh) q.set("fresh", "1");
    const qs = q.toString();
    return fetch(`${BASE}/nginx-spa${qs ? `?${qs}` : ""}`).then(safeJson);
  },

  spaCoverage: (platform: string): Promise<SpaCoverageResult> =>
    fetch(`${BASE}/nginx-spa-coverage?platform=${encodeURIComponent(platform)}`).then(safeJson),

  routeStats: (platform = 'ark'): Promise<RouteStatsResult> =>
    fetch(`${BASE}/route-stats?platform=${encodeURIComponent(platform)}`).then(safeJson),
  /** Bir IP'ye cozen route'lar (ortam ve tur suzgeciyle). */
  routesOfIp: (p: { ip: string; env?: string; kind?: 'spa' | 'nonSpa' | 'all'; platform?: string }): Promise<RoutesOfIpResult> =>
    fetch(`${BASE}/route-stats/ip?ip=${encodeURIComponent(p.ip)}&env=${encodeURIComponent(p.env || '')}&kind=${p.kind || 'all'}&platform=${encodeURIComponent(p.platform || 'ark')}`).then(safeJson),

  ocpCoverage: (platform: string): Promise<OcpCoverageResult> =>
    fetch(`${BASE}/ocp-coverage?platform=${encodeURIComponent(platform)}`).then(safeJson),

  initScripts: (root: string): Promise<InitScriptsResult> =>
    fetch(`${BASE}/init-scripts?root=${encodeURIComponent(root)}`).then(safeJson),
  // Deployment Scripts (2026-09-18): /vhosting[8]/HYSUXSCRIPTS/*.sh sha512 sapmasi - Init ile AYNI sekil
  deployScripts: (root: string): Promise<InitScriptsResult> =>
    fetch(`${BASE}/deploy-scripts?root=${encodeURIComponent(root)}`).then(safeJson),

  nginxLocations: (p: { service?: string; env?: string; status?: string; q?: string }): Promise<NginxLocationsResult> => {
    const qs = new URLSearchParams();
    if (p.service) qs.set("service", p.service);
    if (p.env) qs.set("env", p.env);
    if (p.status) qs.set("status", p.status);
    if (p.q) qs.set("q", p.q);
    return fetch(`${BASE}/nginx-locations?${qs.toString()}`).then(safeJson);
  },

  routeTraffic: (fresh = false): Promise<RouteTrafficResult> =>
    fetch(`${BASE}/route-traffic${fresh ? '?fresh=1' : ''}`).then(safeJson),
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
