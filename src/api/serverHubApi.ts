// src/api/serverHubApi.ts — Server Hub (2026-09-21): reboot hazirligi / atil kaynak raporu.
import { okJson, safeJson } from './http';

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
 *  sunucuya giden port hicbir JVM'e ait degil), HEDEF (hedefi bilinmeyen proxy; neden `reason`'da),
 *  EKSIK (hedef listesi yukleyicide kesildi; target '~'). */
export interface ShUnattributed {
  host?: string;
  serverName?: string;
  port?: number | null;
  target?: string | null;
  kind?: string;
  /** EK-7.5 (tur 3/4): HEDEF girdisinin nedeni - COZULEMEDI (hicbir sunucuya cozulemedi),
   *  DINAMIK ('~DYNAMIC': conf'ta hedef kaydi yok), JVMSIZ (hedef sunucuda trafigi alacak JVM ya da
   *  olculmus vhost yok), TARANMAMIS (hedef sunucu taranmamis), CONF_OKUNAMADI (vhost conf'u
   *  okunamadi, hedefleri gorulmedi). PORT ve EKSIK'te null. */
  reason?: string | null;
  req7d?: number | null;
  trafficState?: string | null;
}
export interface ShFinding {
  /** 'ok' yalniz Admin seviyeyi "sorun yok"a cektiyse (Kurallar & Limitler): listede kalir, sayilmaz. */
  severity: ShSeverity;
  /** Admin seviyeyi degistirdiyse kodun varsayilan seviyesi. */
  defaultSeverity?: ShSeverity;
  area: 'init' | 'jboss' | 'jvm' | 'web' | 'ip' | 'ssh' | 'scan' | 'ear';
  code: string;
  text: string;
  fix: ShFix | null;
  /** Yalniz sunucu ayrintisinda: neden / eksik olabilir / nasil kontrol edilir (katalogdan). */
  dogrulama?: ShDogrulama | null;
  /** EAR alani bulgularinin konusu (Uygulama Envanteri). */
  ear?: { kok?: string; ad?: string; jboss?: string; neden?: string; girdiler?: ShKokGirdisi[]; uygulamalar?: string[] };
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
  /** v3 tazelik kapisi: false = tarama bayat ya da son yuklemede disarida kaldi (yazma eylemi yok). */
  fresh?: boolean;
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
  /** v3 JVM.cfg_src: CLI_WILDCARD | XML | PS_ONLY | UNAVAILABLE (tanim kaynagi okundu, JVM orada
   *  tanimli degil - auto-start'i yok, /jvm-autostart 400). */
  cfgSrc?: string | null;
  autoStartSource?: string;
  /** MWAppsInventory tier (2026-11-06; zincir: 2 katman ayni makine, 3 katman ayri web sunucusu). */
  tier?: string | null;
  /** Parametre farki isareti: 0 yok, 1 var, 2 olculemedi; eski semada yok. */
  argFark?: number | null;
  /** v3 esleme ve trafik (assess). */
  mapping?: string | null;
  trafficState?: string | null;
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
    kind?: string | null;
    trafficState?: string | null;
    trafficReason?: string | null;
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
  /** EK-7.4/7.5: proxy_targets '~DYNAMIC' tasiyor - trafik conf'ta hedef kaydi birakmayan bir
   *  mekanizmayla tasiniyor ya da vhost conf'u okunamadi / blogu bulunamadi (hedefler gorulmedi). */
  targetsDynamic?: boolean;
  /** v3 trafik alanlari (eski satirda null): ACTIVE | NO_RECENT_TRAFFIC | UNVERIFIED | UNREADABLE */
  trafficState?: string | null;
  /** v3 trafik sebebi (OK, CONF_UNREADABLE, LOCATION_LOG, CONDITIONAL_LOG, INCLUDE_UNRESOLVED, ...) */
  trafficReason?: string | null;
}
/** Katalogdaki dogrulama metni (2026-11-06): kontrol komutlarinda <JVM>, <EAR>, <GIRDI>, <ACCESS_LOG>. */
export interface ShDogrulama {
  neden: string;
  eksik: string;
  kontrol: string[];
}
export interface ShKokGirdisi {
  kok: string;
  ad: string;
  tip: 'D' | 'F' | 'L' | '?';
  boyut?: number | null;
  mtime?: number | null;
  hedef?: string | null;
}
/** Uygulama Envanteri'nin bu sunucudaki son durumu. VAR disindaki durumlarda EAR bulgusu uretilmez. */
export interface ShEarDurumu {
  durum: 'VAR' | 'ESKI' | 'YOK' | 'OKUNAMADI';
  taranma?: string | null;
  yasGun?: number | null;
  kosuId?: number;
  uygulamalar?: {
    kok: string;
    ad: string;
    jboss: string;
    durum: string;
    warSayisi: number | null;
    xml: { durum: 'VAR' | 'JVM_YOK' | 'OLCULEMEDI'; neden?: string | null; jvmler?: { ad: string; grup?: string; auto_start?: boolean }[] } | null;
  }[];
  /** Faz 2: calisan JVM'lerin deployment durumu (JBoss CLI). null = kontrol kapali / olculmedi. */
  deployment?: {
    kesik: boolean;
    jvmler: {
      nesil: string;
      ad: string;
      /** OK | CLI_YOK | ZAMAN_ASIMI | HATA | GECERSIZ_AD | BUTCE_DOLDU | BASH_YOK | AYRISTIRILAMADI */
      durum: string;
      rc: number | null;
      hata: string | null;
      deploymentlar: { ad: string; calisma_adi: string | null; etkin: boolean | null; durum: string | null }[] | null;
    }[];
  } | null;
}
export interface ShHostDetail extends Omit<ShHostRow, 'jvms' | 'vhosts'> {
  /** Uygulama Envanteri durumu ve retirement adaylari (2026-11-06). */
  ear?: ShEarDurumu | null;
  retireAdaylari?: { kural: string; tur: ShEtiketTur; ad: string; host: string; gen?: number; kok?: string }[];
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
  /** Admin'in degistirdigi bulgu seviyesi sayisi; okunamadi = varsayilanlar uygulandi. */
  ayar?: { okunamadi: boolean; seviyeDegisen: number } | null;
}
export interface ShFindingRow {
  host: string;
  hostClass?: 'genel' | 'ozel';
  products: string[];
  env?: string;
  envGroup?: string;
  scanDate: string | null;
  severity: ShSeverity;
  defaultSeverity?: ShSeverity;
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
  /** Son tam taramada gorulmeyen sunucular - bulgulara girmez, ayri gosterilir (2026-10-08). */
  taramadanDusen?: { sayi: number; sunucular: { host: string; scanDate: string | null; env: string | null; products: string[] }[] } | null;
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

// ── Kurallar & Limitler (2026-10-20) ─────────────────────────────────────────────────
/** Bir tarama maddesinin bir ciktisi. kod null = "sorun yok" (bulgu uretilmez, degistirilemez). */
export interface ShKuralCikti {
  kod: string | null;
  kosul: string;
  dogrulama?: ShDogrulama | null;
  varsayilan: ShSeverity;
  gecerli: ShSeverity;
  degistiren?: string | null;
  zaman?: string | null;
  aciklama?: string;
  /** son taramada bu kodla kac bulgu / kac sunucu; null = OLCULEMEDI (0 degil) */
  bulgu?: number | null;
  sunucu?: number | null;
}
export interface ShKuralMadde {
  id: string;
  alan: string;
  alanAd: string;
  ad: string;
  neTaranir: string;
  ciktilar: ShKuralCikti[];
}
export type ShLimitAd = 'tara' | 'reboot' | 'hazirlik';
export interface ShLimit {
  ad: ShLimitAd;
  etiket: string;
  aciklama: string;
  varsayilan: number;
  ust: number;
  gecerli: number;
  degistiren: string | null;
  zaman: string | null;
  not: string;
}
export interface ShAyarGecmis {
  anahtar: string;
  eski: string | null;
  yeni: string | null;
  aciklama: string;
  degistiren: string;
  zaman: string | null;
}
export interface ShKurallar {
  ok: boolean;
  message?: string;
  okunamadi: boolean;
  hata?: string;
  taramaTarihi: string | null;
  sayimOlculdu: boolean;
  alanlar: Record<string, string>;
  maddeler: ShKuralMadde[];
  limitler: ShLimit[];
  /** Retirement etiket kurallari ve kokte yok sayilan girdiler (2026-11-06). */
  etiketKurallari?: ShEtiketKurali[];
  kokYoksay?: { gecerli: string[]; varsayilan: string[]; degistiren: string | null; zaman: string | null; not: string };
  /** null = gecmis okunamadi */
  gecmis: ShAyarGecmis[] | null;
}

// ── Retirement etiketleri (2026-11-06) ── bulgudan ayri; KESIN / SUPHELI, Admin kural seviyesi,
// kayitli manuel kontrol. Yalniz KESIN + DOGRULANDI retirement'a hazir.
export type ShEtiketSeviye = 'KESIN' | 'SUPHELI' | 'KAPALI';
export type ShEtiketTur = 'JVM' | 'EAR' | 'GIRDI';
export type ShKontrolDurum = 'BEKLIYOR' | 'DOGRULANDI' | 'YANLIS_ALARM' | 'VERI_DEGISTI' | 'BILINMIYOR';
export interface ShEtiketKurali {
  kural: string;
  tur: ShEtiketTur;
  ad: string;
  kosul: string;
  varsayilan: ShEtiketSeviye;
  gecerli: ShEtiketSeviye;
  degistiren: string | null;
  zaman: string | null;
  aciklama: string;
  dogrulama: ShDogrulama | null;
}
/** Retirement baglami (2026-11-06): kopyanin Retirement hedefi; durum retirement_targets.status. */
export interface ShRetirementBaglam {
  kayit: number;
  hedef: number;
  durum: string;
  host?: string;
}
/** Capraz kontrol kaynaklari: okunamayan kaynaga dayanan bulgu / etiket uretilmez. */
export interface ShCaprazDurumu {
  ocp: { okunamadi: boolean; hata?: string; uygulama: number };
  kullanim: { okunamadi: boolean; hata?: string; olcum: number };
  retirement: { okunamadi: boolean; hata?: string; hedef: number };
}
/** Ortak kayitli gorunum (gorunumler.cjs): suzgec + siralama + kolonlar; Admin kaydeder. */
export interface ShOrtakGorunum {
  ad: string;
  f: { k: string; op: string; v?: unknown }[];
  s?: string;
  kolonlar?: string[];
  kaydeden?: string | null;
  zaman?: string | null;
}
export interface ShOrtakGorunumYanit {
  ok: boolean;
  message?: string;
  okunamadi?: boolean;
  gorunumler?: ShOrtakGorunum[];
  _httpStatus?: number;
}
// ── UYGULAMA 360 (2026-11-07): taban uygulama adi basina tek satir (uygulama-360.cjs) ──
export interface Sh360Ortam {
  ortam: string;
  toplam: number;
  acik: number;
  kapali: number;
  olculemedi: number;
}
export type Sh360Deployment = 'OK' | 'FAILED' | 'YOK' | 'KAPALI' | 'OLCULEMEDI';
export interface Sh360Ocp {
  yerler: { namespace: string; cluster: string; uygulama?: string }[];
  yerSayisi: number;
  istek: number | null;
  tasinmisOlabilir: boolean;
}
export interface Sh360Ozet {
  anahtar: string;
  ad: string;
  ortamlar: Sh360Ortam[];
  kopyaSayisi: number;
  sunucuSayisi: number;
  nesiller: number[];
  tier: string[];
  calisan: number;
  kapali: number;
  olculemeyen: number;
  autostartUyumsuz: number;
  kopyaTutarsiz: number;
  kalinti: number;
  celiski: number;
  riskliKopya: number;
  trafik: 'ACTIVE' | 'NO_RECENT_TRAFFIC' | 'OLCULEMEDI';
  istek7g: number | null;
  ear: { sayi: number; war: number; olculmeyenKopya: number } | null;
  deployment: Sh360Deployment | null;
  ocp: Sh360Ocp | null;
  retirement: ShRetirementBaglam[];
  etiket: {
    seviye: 'KESIN' | 'SUPHELI' | null;
    kurallar: string[];
    sayi: number;
    bekleyen: number;
    hazir: number;
  } | null;
  sonTarama: string | null;
  bayatKopya: number;
}
export interface Sh360Kopya {
  host: string;
  ortam: string;
  gen: number;
  ad: string;
  calisiyor: boolean | null;
  autoStart: string;
  autostartUyumsuz: 'REBOOT_RISK' | 'STOPPED_AUTOSTART_ON' | null;
  trafik: string | null;
  istek7g: number | null;
  tier: string | null;
  taze: boolean;
  taramaTarihi: string | null;
  hostClass: string;
  retirement: ShRetirementBaglam[];
  capraz: {
    kopya: { nedenler: string[]; digerleri: { host: string; calisiyor: boolean | null; autoStart: string }[]; kopyaSayisi: number } | null;
    kalinti: { neden: 'PROD_YOK' | 'PROD_KAPALI' | 'PROD_RETIRE'; taban: string } | null;
    ocp: (Sh360Ocp & { eslesme: { namespace: string; cluster: string; uygulama: string }[]; ad: { jboss: string; taban: string; ocp: string } }) | null;
    celiski: { kayit: number; hedef: number; durum: string; nedenler: string[] }[];
  } | null;
  ear: { ad: string; kok: string; warSayisi: number | null }[] | null;
  deployment: Sh360Deployment | null;
}
export interface Sh360Ayrinti extends Sh360Ozet {
  kopyalar: Sh360Kopya[];
  etiketler: ShRetireEtiketOzet[];
}
export interface Sh360Sonuc {
  ok: boolean;
  message?: string;
  tableMissing?: boolean;
  latestScan?: string | null;
  ear?: { okunamadi: boolean; hata?: string; hostSayisi: number } | null;
  capraz?: ShCaprazDurumu | null;
  uygulamalar: Sh360Ozet[];
}
export interface ShEtiketKopyasi {
  host: string;
  kurallar: string[];
  retirement?: ShRetirementBaglam[];
  // JVM
  gen?: number;
  calisiyor?: boolean | null;
  autoStart?: string;
  trafik?: string | null;
  esleme?: string;
  tier?: string | null;
  taze?: boolean;
  taramaTarihi?: string | null;
  web?: { host: string; vhost: string; trafik: string | null; istek7g: number | null; log: string; tur: string | null }[];
  engel?: string | null;
  // EAR / GIRDI
  kok?: string;
  durum?: string;
  warSayisi?: number | null;
  xml?: string | null;
  xmlNeden?: string | null;
  jvmler?: { ad: string; autoStart: boolean; calisiyor: boolean | null }[];
  taranma?: string | null;
  tip?: string;
  hedef?: string | null;
}
export interface ShRetireEtiket {
  anahtar: string;
  tur: ShEtiketTur;
  ad: string;
  ortam: string;
  gen: number | null;
  nesil: string | null;
  kok: string | null;
  seviye: 'KESIN' | 'SUPHELI';
  hamSeviye: 'KESIN' | 'SUPHELI';
  kurallar: string[];
  nedenler: string[];
  notlar: string[];
  tier: string[];
  hostlar: string[];
  kopyalar: ShEtiketKopyasi[];
  imza: string;
  kontrol: { sonuc: 'DOGRULANDI' | 'YANLIS_ALARM'; aciklama: string; isaretleyen: string | null; zaman: string | null } | null;
  durum: ShKontrolDurum;
  retirementHazir: boolean;
  /** Kopyalarin Retirement hedefleri (hedef basina bir kez); eski sunucuda yok. */
  retirement?: ShRetirementBaglam[];
}
/** Liste ogesi: kopyalar (zincir) TASINMAZ, sayisi tasinir; ayrinti retireEtiketAyrinti ile tam gelir. */
export type ShRetireEtiketOzet = Omit<ShRetireEtiket, 'kopyalar'> & { kopyaSayisi: number; kopyalar?: undefined };
/** Ozet ya da tam etiket (yardimcilar ikisiyle de calisir). */
export type ShRetireEtiketHer = ShRetireEtiketOzet | ShRetireEtiket;
export interface ShRetireSonuc {
  ok: boolean;
  message?: string;
  tableMissing?: boolean;
  latestScan?: string | null;
  ear?: { okunamadi: boolean; hata?: string; hostSayisi: number } | null;
  capraz?: ShCaprazDurumu | null;
  kontrolOkunamadi?: boolean;
  ayarOkunamadi?: boolean;
  kurallar: ShEtiketKurali[];
  etiketler: ShRetireEtiketOzet[];
  ozet: {
    toplam: number;
    kesin: number;
    supheli: number;
    dusurulen: number;
    bekliyor: number;
    dogrulandi: number;
    yanlisAlarm: number;
    retirementHazir: number;
  };
}
export interface ShKontrolYanit {
  ok: boolean;
  message?: string;
  etiket?: ShRetireEtiket | null;
  /** 409: etiketin GUNCEL imzasi */
  imza?: string;
  _httpStatus?: number;
}
export interface ShAyarYazim {
  ok: boolean;
  message?: string;
  eski?: string;
  yeni?: string;
  degismedi?: boolean;
}

const put = (body: unknown) => ({
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});


// ── RETIREMENT ANALIZI (2026-11-07): iliski grafigi, karar motoru, kalici notlar ──────────────────
export type ShKarar = 'KULLANIMDA' | 'RETIRE_ADAYI' | 'SUPHELI' | 'KARAR_VERILEMEZ' | 'SORUN_YOK';
export type ShMaddeEtki = 'ENGELLER' | 'DESTEKLER' | 'NOTR' | 'EKSIK';
export interface ShNotOzeti {
  id: number;
  sinif: string;
  metin: string;
  konu: string;
  dogrudan: boolean;
}
export interface ShMadde {
  kod: string;
  katman: 'app' | 'web' | 'ip' | 'zincir' | 'dis';
  etki: ShMaddeEtki;
  baslik: string;
  metin: string;
  elle: string;
  kanit: string | null;
  bilinen?: ShNotOzeti | null;
}
export interface ShNot {
  id: number;
  konu: string;
  konu_tur: string;
  supheli_kod: string | null;
  sinif: string;
  etiketler: string[];
  metin: string;
  yayilim: 'YALNIZ' | 'ASAGI' | 'ZINCIR';
  durum: 'AKTIF' | 'ARSIV';
  surum: number;
  olusturan: string | null;
  olusturuldu: string | null;
  guncelleyen: string | null;
  guncellendi: string | null;
  yol?: string[];
  dogrudan?: boolean;
  veriDegisti?: boolean;
  yetim?: boolean | null;
}
export interface ShSinif {
  ad: string;
  baslik: string;
  renk: 'notr' | 'bilgi' | 'aksan' | 'uyari' | 'basari' | 'hata';
  etki: 'BILINEN' | 'BILGI';
  aciklama: string;
  sira: number;
  varsayilan?: boolean;
}
export interface ShKararSayilari {
  KULLANIMDA: number;
  RETIRE_ADAYI: number;
  SUPHELI: number;
  KARAR_VERILEMEZ: number;
  SORUN_YOK: number;
}
export interface ShKararOzet {
  anahtar: string;
  ad: string;
  karar: ShKarar;
  kararMetni: string;
  ozet: string;
  sayilar: ShKararSayilari;
  notSayisi: number;
  siniflar: string[];
  veriDegisti: boolean;
  bilinen: ShNotOzeti | null;
}
export interface ShKararlarSonuc {
  ok: boolean;
  sayilar: ShKararSayilari;
  bilinenSayisi: number;
  notOkunamadi: boolean;
  siniflar: ShSinif[];
  yetimNotSayisi: number;
  uygulamalar: ShKararOzet[];
}
export interface ShYapilabilecek {
  tur: 'yonlendir' | 'elle' | 'bilgi';
  metin: string;
  hedef?: string;
}
export interface ShKopyaKarar {
  anahtar: string;
  tur: 'jvm' | 'was';
  ad: string;
  host: string;
  env: string | null;
  calisiyor: boolean | null;
  karar: ShKarar;
  kararMetni: string;
  maddeler: ShMadde[];
  eksikler: { ne: string; nasil: string }[];
  celiskiler: { anahtar: string; kod: string; metin: string }[];
  notlar?: ShNot[];
  bilinen?: ShNotOzeti | null;
  uygulamalar?: string[];
}
export interface ShUygulamaKarar {
  anahtar: string;
  ad: string;
  karar: ShKarar;
  kararMetni: string;
  ozet: string;
  sayilar: ShKararSayilari;
  kopyalar: string[];
  yapilabilecekler: ShYapilabilecek[];
  notlar?: ShNot[];
  bilinen?: ShNotOzeti | null;
}
export interface ShKararAyrinti {
  ok: boolean;
  tur: 'app' | 'sunucu' | 'kopya';
  siniflar: ShSinif[];
  notOkunamadi: boolean;
  uygulama?: ShUygulamaKarar;
  kopyalar?: ShKopyaKarar[];
  kopya?: ShKopyaKarar;
  sunucu?: { anahtar: string; ad: string; veri: { env?: string | null; tarama?: string | null } };
  web?: { anahtar: string; ad: string; vhost: number }[];
  notlar?: ShNot[];
}
export interface ShAraSonuc {
  anahtar: string;
  tur: 'app' | 'sunucu' | 'vhost' | 'dns' | 'jvm' | 'was' | 'web' | 'ip';
  ad: string;
  host: string | null;
}
export interface ShKenarYontem {
  ad: string;
  aile: string;
  guven: 'KESIN' | 'GUCLU' | 'ZAYIF';
  kanit: string;
}
export interface ShVarlik {
  ok: boolean;
  dugum: { anahtar: string; tur: string; ad: string; veri: Record<string, unknown>; kaynaklar: string[] };
  kenarlar: {
    yon: 'giris' | 'cikis';
    tur: string;
    guven: 'KESIN' | 'GUCLU' | 'ZAYIF' | null;
    durum: 'DOGRULANDI' | 'TEK_KAYNAK' | 'CELISKI' | null;
    celiski: string | null;
    yontemler: ShKenarYontem[];
    karsi: { anahtar: string; tur: string; ad: string } | null;
  }[];
  bilesen: { boyut: number; kesildi: boolean };
  dogrulamalar: Record<string, { kod: string; durum: 'UYUM' | 'CELISKI' | 'OLCULMEDI'; kaynaklar: string[]; metin: string }[]>;
}
export interface ShNotGovde {
  konu: string;
  supheli_kod?: string | null;
  sinif: string;
  etiketler: string[];
  metin: string;
  yayilim: 'YALNIZ' | 'ASAGI' | 'ZINCIR';
  surum?: number;
}

export const serverHubApi = {
  /** Taranmis sunucu adlari (filo degerlendirmesini indirmeden). */
  hostAdlari: (): Promise<{ ok: boolean; hosts: string[]; message?: string }> =>
    fetch(`${BASE}/host-adlari`).then(safeJson),
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
  // KURALLAR & LIMITLER (2026-10-20): tarama maddeleri + seviyeler (Admin degistirir), limitler.
  kurallar: (fresh = false): Promise<ShKurallar> =>
    fetch(`${BASE}/kurallar${fresh ? '?fresh=1' : ''}`).then(safeJson),
  limitler: (): Promise<{ ok: boolean; okunamadi?: boolean; limitler: ShLimit[]; message?: string }> =>
    fetch(`${BASE}/limitler`).then(safeJson),
  seviyeDegistir: (kod: string, seviye: ShSeverity, aciklama: string): Promise<ShAyarYazim> =>
    fetch(`${BASE}/kurallar/seviye/${encodeURIComponent(kod)}`, put({ seviye, aciklama })).then(safeJson),
  limitDegistir: (ad: ShLimitAd, deger: number, aciklama: string): Promise<ShAyarYazim> =>
    fetch(`${BASE}/kurallar/limit/${encodeURIComponent(ad)}`, put({ deger, aciklama })).then(safeJson),
  // RETIREMENT ETIKETLERI (2026-11-06)
  // ORTAK GORUNUMLER (2026-11-07): tablolarin Admin'in kaydettigi suzgec / siralama / kolonlari
  gorunumler: (ekran: string): Promise<ShOrtakGorunumYanit> =>
    fetch(`${BASE}/gorunumler?ekran=${encodeURIComponent(ekran)}`).then(safeJson),
  gorunumKaydet: (
    ekran: string,
    ad: string,
    gorunum: { f: unknown[]; s?: string; kolonlar?: string[] },
  ): Promise<ShOrtakGorunumYanit> => fetch(`${BASE}/gorunumler`, put({ ekran, ad, gorunum })).then(safeJson),
  gorunumSil: (ekran: string, ad: string): Promise<ShOrtakGorunumYanit> =>
    fetch(`${BASE}/gorunumler?ekran=${encodeURIComponent(ekran)}&ad=${encodeURIComponent(ad)}`, {
      method: 'DELETE',
    }).then(safeJson),
  // RETIREMENT ANALIZI (2026-11-07). Okuma uclari okJson: hata "okunamadi" olarak yakalanir (bos sanilmaz).
  iliskiKararlar: (fresh = false): Promise<ShKararlarSonuc> =>
    fetch(`${BASE}/iliski/kararlar${fresh ? '?fresh=1' : ''}`).then((r) => okJson<ShKararlarSonuc>(r)),
  iliskiKarar: (anahtar: string): Promise<ShKararAyrinti> =>
    fetch(`${BASE}/iliski/karar?anahtar=${encodeURIComponent(anahtar)}`).then((r) => okJson<ShKararAyrinti>(r)),
  iliskiAra: (q: string): Promise<{ ok: boolean; sonuclar: ShAraSonuc[] }> =>
    fetch(`${BASE}/iliski/ara?q=${encodeURIComponent(q)}`).then((r) => okJson(r)),
  iliskiVarlik: (anahtar: string): Promise<ShVarlik> =>
    fetch(`${BASE}/iliski/varlik?anahtar=${encodeURIComponent(anahtar)}`).then((r) => okJson<ShVarlik>(r)),
  notEkle: (g: ShNotGovde): Promise<{ ok: boolean; id: number; yetim: boolean | null }> =>
    fetch(`${BASE}/notlar`, json(g)).then((r) => okJson(r)),
  notGuncelle: (id: number, g: ShNotGovde): Promise<{ ok: boolean; id: number }> =>
    fetch(`${BASE}/notlar/${id}`, put(g)).then((r) => okJson(r)),
  notArsivle: (id: number): Promise<{ ok: boolean }> =>
    fetch(`${BASE}/notlar/${id}`, { method: 'DELETE' }).then((r) => okJson(r)),
  notGeriAl: (id: number): Promise<{ ok: boolean }> =>
    fetch(`${BASE}/notlar/${id}/geri-al`, json({})).then((r) => okJson(r)),
  // UYGULAMA 360 (2026-11-07)
  uygulamalar360: (fresh = false): Promise<Sh360Sonuc> =>
    fetch(`${BASE}/uygulamalar-360${fresh ? '?fresh=1' : ''}`).then(safeJson),
  uygulama360: (
    ad: string,
  ): Promise<{ ok: boolean; uygulama?: Sh360Ayrinti; message?: string; _httpStatus?: number }> =>
    fetch(`${BASE}/uygulama-360/${encodeURIComponent(ad)}`).then(safeJson),
  retireEtiketleri: (fresh = false): Promise<ShRetireSonuc> =>
    fetch(`${BASE}/retire-etiketleri${fresh ? '?fresh=1' : ''}`).then(safeJson),
  retireEtiketAyrinti: (
    anahtar: string,
  ): Promise<{ ok: boolean; etiket?: ShRetireEtiket; message?: string; _httpStatus?: number }> =>
    fetch(`${BASE}/retire-etiketleri/ayrinti?anahtar=${encodeURIComponent(anahtar)}`).then(safeJson),
  retireKontrol: (p: {
    anahtar: string;
    sonuc: 'DOGRULANDI' | 'YANLIS_ALARM' | 'GERI_AL';
    aciklama: string;
    imza: string;
  }): Promise<ShKontrolYanit> => fetch(`${BASE}/retire-kontrol`, put(p)).then(safeJson),
  etiketSeviyesi: (kural: string, seviye: ShEtiketSeviye, aciklama: string): Promise<ShAyarYazim> =>
    fetch(`${BASE}/kurallar/etiket/${encodeURIComponent(kural)}`, put({ seviye, aciklama })).then(safeJson),
  kokYoksay: (liste: string[], aciklama: string): Promise<ShAyarYazim> =>
    fetch(`${BASE}/kurallar/kok-yoksay`, put({ liste, aciklama })).then(safeJson),
};
