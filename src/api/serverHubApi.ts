// src/api/serverHubApi.ts — Server Hub (2026-09-21): reboot hazirligi / atil kaynak raporu.
import { safeJson } from './http';

const BASE = '/api/server-hub';

export type ShSeverity = 'ok' | 'info' | 'warning' | 'danger';
export interface ShFix {
  action: string;
  gen?: number;
  jvm?: string;
  product?: string;
  file?: string;
  line?: number;
  server_name?: string;
}
/** Bir bulgunun dayandigi log dosyalari (NO_LOAD / RETIRE_CANDIDATE). `read:false` =
 *  dosya HIC okunamadi; onu "0 istek" saymak olculemeyeni kanit yerine koymak olurdu. */
export interface ShFindingLog {
  host: string;
  serverName: string;
  path: string;
  confFile: string;
  req7d: number | null;
  req24h: number | null;
  sampled: boolean;
  shared: boolean;
  read: boolean;
}
/** EK-3 (sozlesme v3): TRAFFIC_UNATTRIBUTED bulgusunun ekindeki tek kayit. kind: PORT (bu
 *  sunucuya giden port hicbir JVM'e ait degil), HEDEF (hedef hicbir sunucuya cozulemedi:
 *  balancer, VIP, upstream adi), EKSIK (hedef listesi yukleyicide kesildi; target '~'). */
export interface ShUnattributed {
  host?: string;
  serverName?: string;
  port?: number | null;
  target?: string | null;
  kind?: string;
  req7d?: number | null;
  trafficState?: string | null;
}
export interface ShFinding {
  severity: Exclude<ShSeverity, 'ok'>;
  area: 'init' | 'jboss' | 'jvm' | 'web' | 'ip' | 'ssh' | 'scan';
  code: string;
  text: string;
  fix: ShFix | null;
  logs?: ShFindingLog[];
  scanDate?: string | null;
  matchKind?: string | null;
  /** EK-3: yalniz TRAFFIC_UNATTRIBUTED; en fazla 20 kayit (sunucu keser). */
  unattributed?: ShUnattributed[];
  /** AUTOSTART_UNKNOWN sebebi (cli-okunamadi | envanterde-yok | envanter-celiskili | tanimsiz-surec). */
  autoStartReason?: string;
}
export interface ShHostRow {
  env?: string;
  envGroup?: string;
  /** 2026-09-24: 'ozel' = GBEVM / GBPRV onekli sunucular (genel envanterden ayri listelenir) */
  hostClass?: 'genel' | 'ozel';
  host: string;
  scanDate: string | null;
  products: string[];
  status: ShSeverity;
  counts: { danger: number; warning: number; info: number };
  wallS: number | null;
  cpuS: number | null;
  jvms: number;
  jvmsRunning: number;
  vhosts: number;
  unusedIps: number;
  topFinding: string | null;
}
export interface ShJvm {
  gen: number;
  name: string;
  group: string;
  running: boolean;
  autoStart: 'true' | 'false' | 'unknown';
  serverState: string;
  ports: number[];
  /** 2026-09-22: 'cli' (JBoss CLI taramasi) | 'envanter' (dbo.MWAppsInventory) */
  source?: string;
  autoStartSource?: string;
  invStatus?: string | null;
  invAutoStart?: string;
  invJvmCount?: number;
  mismatch?: string[];
  req24h: number | null;
  req7d: number | null;
  matchKind: 'proxy' | 'name' | null;
  vhosts: {
    host: string;
    product: string;
    serverName: string;
    req24h: number | null;
    req7d: number | null;
    hc24h: number | null;
    sampled: boolean;
  }[];
}
export interface ShVhost {
  product: string;
  listen: string;
  serverName: string;
  aliases: string;
  accessLog: string;
  proxyTargets: string;
  req24h: number | null;
  req7d: number | null;
  hc24h: number | null;
  shared: boolean;
  sampled: boolean;
  confFile: string;
  jvm: string | null;
  /** C4: proxy hedef listesi yukleyicide kesildi (~); kesilen kisimdaki sunucu:port bilinmez. */
  targetsTruncated?: boolean;
}
export interface ShHostDetail extends Omit<ShHostRow, 'jvms' | 'vhosts'> {
  /** C3: sys.columns okunamadi - tarayici sema surumu bilinmiyor, bu sunucuda eylem yok. */
  schemaUnknown?: boolean;
  findings: ShFinding[];
  init: { root: string; file: string; status: string }[];
  jboss: { gen: number; hostName: string; hostState: string; cli: string; note: string }[];
  jvms: ShJvm[];
  web: { product: string; running: boolean; syntax: string; detail: string }[];
  vhosts: ShVhost[];
  ips: { ip: string; iface: string; usedBy: string; primary: boolean }[];
  sshd: { maxSessions: number | null; maxStartups: string; activeSessions: number | null } | null;
}
export interface ShEnvBlock {
  hosts: number;
  danger: number;
  warning: number;
  ok: number;
  jvms: number;
  jvmRunning: number;
  autoOff: number;
  rebootRisk: number;
  initDiff: number;
  web: Record<string, { hosts: number; syntaxFail: number; notRunning: number }>;
}
export interface ShSummary {
  /** Ortam kirilimi (2026-09-22): Production / Non-Production / Bilinmiyor */
  byEnv?: Record<string, ShEnvBlock>;
  hosts: { total: number; ok: number; info: number; warning: number; danger: number };
  /** 2026-09-24: envanter (dbo.Inventory) kac sunucuda diyor / tarama kacinda gordu */
  coverage?: Record<string, { inventory: number; scanned: number; scannedNotInInventory: number }>;
  /** 2026-09-24: genel envanter disi sunucular (GBEVM / GBPRV) */
  special?: {
    hosts: number;
    danger: number;
    warning: number;
    info: number;
    ok: number;
    byPrefix: Record<string, number>;
    jvms: number;
  };
  init: {
    hosts: number;
    compliant: number;
    diffFiles: number;
    missingFiles?: number;
    refDiffFiles?: { file: string; hosts: number }[];
  };
  jvm: {
    total: number;
    running: number;
    stopped: number;
    autoOn: number;
    autoOff: number;
    autoUnknown: number;
    restartRequired: number;
    rebootRisk: number;
    retireCandidates: number;
    noLoad: number;
    mapped: number;
    autoUnknownBy?: Record<string, number>;
    fromInventory?: number;
    autoStartFromInventory?: number;
    mismatched?: number;
    invApps?: number;
  };
  web: Record<
    string,
    {
      hosts: number;
      syntaxOk: number;
      syntaxFail: number;
      notRunning: number;
      vhosts: number;
      idleVhosts: number;
    }
  >;
  ips: { total: number; unused: number };
  ssh: { hosts: number; lowMaxSessions: number; near: number };
  scan: { avgCpuS: number | null; maxCpuS: number | null; maxCpuHost: string | null };
  /**
   * TARAMA KAPSAMASI (2026-10-01): envanterde kaç var, tarama kaçına erişebildi.
   *
   * Yukarıdaki `coverage` ile KARIŞTIRILMAMALI: o yalnız TARANAN sunucular içinde ürün
   * eşleşmesine bakar, erişilemeyen sunucular orada hiç görünmez. Bu alan envanterin
   * TAMAMINI payda alır.
   *
   * Bu ekranın bütün sayıları TARANAN sunuculardan hesaplanır; erişilemeyen bir sunucu
   * hiçbir bulgu üretmez. Kapsama yazılmazsa "sorun yok" ile "bakamadık" aynı görünür.
   */
  scanCoverage?: {
    hosts: {
      inventory: number;
      scanned: number;
      scannedNotInInventory: number;
      missing: number;
    };
    products: Record<
      'JBOSS' | 'RHA' | 'IHS' | 'NGINX',
      {
        /** true = dbo.Inventory'de bu ürünün sürüm sütunu YOK; sayı 0 değil BİLİNMİYOR. */
        inventoryUnknown?: boolean;
        inventory: number;
        scanned: number;
        scannedNotInInventory: number;
        missing: number;
        missingHosts: string[];
      }
    >;
    jvm: { inventory: number; scanned: number; fromInventory: number };
  };
}
/** EK-2: son basarili yukleme FRESH_MAX_DAYS'ten eskiyse /overview ve /findings bunu tasir. */
export type ShStaleFleet = { lastLoad?: string | null; ageDays?: number | null } | null;
/** EK-1: /overview geri alma kapisi. allowed=false: v3 tarayici verisi var ya da (schemaUnknown)
 *  sema okunamadigi icin v3 sayimi yapilamadi (v3Hosts null). */
export interface ShRollback {
  allowed?: boolean;
  v3Hosts?: number | null;
  message?: string;
  schemaUnknown?: boolean;
}
export interface ShOverview {
  ok: boolean;
  message?: string;
  tableMissing: boolean;
  latestScan: string | null;
  summary: ShSummary | null;
  hosts: ShHostRow[];
  staleFleet?: ShStaleFleet;
  rollback?: ShRollback;
  /** C3: sys.columns okunamadi - tum eylemler kapali, sonuc onbellekte degil. */
  schemaUnknown?: boolean;
}
export interface ShFindingRow {
  host: string;
  hostClass?: 'genel' | 'ozel';
  products: string[];
  env?: string;
  envGroup?: string;
  scanDate: string | null;
  severity: Exclude<ShSeverity, 'ok'>;
  area: ShFinding['area'];
  code: string;
  text: string;
  fixable: boolean;
  /** Düzeltme hedefi (gen, jvm…) — satır bazında işlem için gerekli. */
  fix?: ShFix | null;
}
export interface ShFindingsResult {
  ok: boolean;
  message?: string;
  tableMissing: boolean;
  latestScan: string | null;
  findings: ShFindingRow[];
  staleFleet?: ShStaleFleet;
  schemaUnknown?: boolean;
}
export interface ShLaunch {
  ok: boolean;
  message?: string;
  jobId: number | null;
  status: string | null;
  awxServerId: number;
  planOnly?: boolean;
}
/** Açılış hazırlığı satırı. `notScanned` ASLA "sorunsuz" sayılmaz. */
export interface ShReadinessRow {
  host: string;
  verdict: 'ok' | 'risk' | 'blocked' | 'unknown' | 'notScanned';
  scanDate: string | null;
  reasons: { code: string; tip: 'blocker' | 'risk' | 'unknown'; aciklama: string; text: string; area: string | null }[];
  note: string;
}
export interface ShReadiness {
  ok: boolean;
  message?: string;
  latestScan?: string | null;
  summary?: {
    requested: number;
    scanned: number;
    notScanned: number;
    ok: number;
    risk: number;
    blocked: number;
    unknown: number;
  };
  rows?: ShReadinessRow[];
  topReasons?: { code: string; tip: string; aciklama: string; hostCount: number; hosts: string[] }[];
}

export interface ShJobStatus {
  ok: boolean;
  status: string;
  output: string;
  result?: unknown;
  message?: string;
}

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});


export const serverHubApi = {
  overview: (fresh = false): Promise<ShOverview> =>
    fetch(`${BASE}/overview${fresh ? '?fresh=1' : ''}`).then(safeJson),
  findings: (fresh = false): Promise<ShFindingsResult> =>
    fetch(`${BASE}/findings${fresh ? '?fresh=1' : ''}`).then(safeJson),
  host: (
    host: string,
    fresh = false,
  ): Promise<{ ok: boolean; host: ShHostDetail; message?: string }> =>
    fetch(`${BASE}/host/${encodeURIComponent(host)}${fresh ? '?fresh=1' : ''}`).then(safeJson),
  scan: (hosts: string[]): Promise<ShLaunch> =>
    fetch(`${BASE}/scan`, json({ hosts })).then(safeJson),
  fix: (p: {
    host: string;
    code: string;
    fix: ShFix;
    confirmed: boolean;
    reload?: boolean;
  }): Promise<ShLaunch> =>
    fetch(
      `${BASE}/fix`,
      json({
        host: p.host,
        code: p.code,
        fixKey: JSON.stringify(p.fix),
        confirmed: p.confirmed,
        reload: !!p.reload,
      }),
    ).then(safeJson),
  // TOPLU AUTO-START: once plan (hicbir is baslatmaz), sonra onayli uygulama.
  // SATIR BAZINDA JVM auto-start (2026-10-01). Toplu uc kaldirildi; bu uc TEK (host, jvm)
  // alir ve sunucuda hedef son taramadan DOGRULANIR.
  jvmAutoStart: (p: {
    host: string;
    gen: number;
    jvm: string;
    enable: boolean;
  }): Promise<{
    ok: boolean;
    message?: string;
    jobId?: number;
    awxServerId?: number;
    action?: string;
  }> => fetch(`${BASE}/jvm-autostart`, json({ ...p, confirmed: true })).then(safeJson),
  // ACILIS HAZIRLIGI (2026-10-01): "bu sunucular sorunsuz acilir mi" - SALT OKUNUR,
  // hicbir is baslatmaz. Mevcut taramanin bulgularini yeniden baslatma sorusuna gore
  // siniflar.
  rebootReadiness: (hosts: string): Promise<ShReadiness> =>
    fetch(`${BASE}/reboot-readiness`, json({ hosts })).then(safeJson),
  jobStatus: (awxServerId: number, jobId: number): Promise<ShJobStatus> =>
    fetch(`${BASE}/job-status/${awxServerId}/${jobId}`).then(safeJson),
};
