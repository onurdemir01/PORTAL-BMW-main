// src/api/nginxConsoleApi.ts — Nginx Hub (2026-09-19): sunucu listesi, konfigurasyon
// agaci/icerik (Ansible dokumundan, /sw), sertifika envanteri, dokum yenileme ve tek dosya push.
import { safeJson } from './http';

const BASE = '/api/nginx-console';

export interface NcHost {
  host: string;
  env: string | null;
  location: string | null;
  service: string | null;
  services: string[];
  nginxVersion: string | null;
  prefix: string | null;
  configCount: number | null;
  ip: string | null;
  /** Pendik | Ankara (envanter location ya da sunucu adi) */
  site?: string | null;
  /** dbo.Inventory cpu / memory (GB) / os — Dashboard Kaynaklar (2026-09-22) */
  cpu?: number | null;
  memoryGb?: number | null;
  os?: string | null;
  dumpedAt: string | null;
  /** fetch job'inin bu sunucuya son ulastigi an (_seen.json ya da dokum); Online bunun uzerinden */
  seenAt?: string | null;
  nginxT: 'ok' | 'fail' | null;
  fileCount: number | null;
  certCount: number | null;
  certMinDays: number | null;
  /** Dokum portal tavanini asiyor (MB): ozet var, dosya ICERIGI yok (2026-09-22) */
  dumpTooLarge?: number | null;
  inventoryMissing?: boolean;
}

export interface NcTreeFile {
  name: string;
  path: string;
  size: number;
  mtime: string;
  sha256: string;
}
export interface NcTreeDir {
  name: string;
  path: string;
  dirs: NcTreeDir[];
  files: NcTreeFile[];
}

export interface NcCert {
  path: string;
  exists: boolean;
  sha256: string | null;
  size: number;
  mtime: string | null;
  subject: string | null;
  cn: string | null;
  issuer: string | null;
  issuerCn: string | null;
  serial: string | null;
  notBefore: string | null;
  notAfter: string | null;
  fingerprint: string | null;
  sigalg: string | null;
  keybits: number | null;
  san: string[];
  chain: number;
  chainSubjects: string[];
  selfSigned: boolean;
  daysLeft: number | null;
}
export interface NcCertUse {
  conf: string;
  serverName: string;
  cert: string;
  key: string;
  keyState: string;
}

export interface NcTree {
  ok: boolean;
  host: string;
  dumped: boolean;
  dumpedAt?: string;
  time?: string;
  prefix?: string;
  nginxT?: { status: 'ok' | 'fail' | 'unknown'; output: string };
  tree?: NcTreeDir;
  fileCount?: number;
  certs?: NcCert[];
  certUses?: NcCertUse[];
  message?: string;
}

export interface NcFile {
  ok: boolean;
  host: string;
  path: string;
  sha256: string;
  size: number;
  mtime: string | null;
  content: string | null;
  tooLarge: boolean;
  message?: string;
}

export interface NcAggCert extends Omit<NcCert, 'path' | 'sha256' | 'size' | 'mtime' | 'exists'> {
  exists: boolean;
  hosts: {
    host: string;
    path: string;
    sha256: string | null;
    uses: {
      conf: string;
      serverName: string;
      key: string;
      keyState: string;
      loaded?: boolean | null;
    }[];
  }[];
  hostCount: number;
  useCount: number;
  /** yalniz nginx -T'nin YUKLEDIGI conf'lardaki kullanim (eski dokumda = useCount) */
  loadedUseCount?: number;
}
export interface NcCertsResult {
  ok: boolean;
  hostsScanned: number;
  certs: NcAggCert[];
  summary: {
    total: number;
    expired: number;
    within30: number;
    within90: number;
    missing: number;
    selfSigned: number;
    unused?: number;
    generatedAt: string;
  };
}

// Kullanilmayan dosyalar (2026-09-22): nginx -T'nin yuklemedigi conf'lar, yalniz onlarda gecen
// sertifikalar, ssl/ altinda referanssiz dosyalar. Sunucu bazinda.
export interface NcOrphanFile {
  path: string;
  size: number;
  mtime: string | null;
  owner?: string | null;
}
export interface NcOrphanHost {
  host: string;
  known: boolean;
  reason: string | null;
  unloaded: NcOrphanFile[];
  backups: NcOrphanFile[];
  certs: {
    path: string;
    exists: boolean;
    cn: string | null;
    issuerCn: string | null;
    notAfter: string | null;
    daysLeft: number | null;
    usedBy: string[];
  }[];
  ssl: { path: string; size: number; mtime: string | null; isKey: boolean }[];
}
// Tutarlilik (2026-09-22): servis+ortam gruplarinda dosya bazinda sha farki
export interface NcDriftFile {
  path: string;
  status: 'differ' | 'missing' | 'local' | 'same';
  variants: { sha: string; hosts: string[]; size: number; mtime: string | null }[];
  missing: string[];
  majority: string | null;
}
export interface NcDriftGroup {
  key: string;
  service: string;
  env: string;
  hosts: string[];
  dumped: string[];
  dumpMissing: string[];
  files: NcDriftFile[];
  counts: { same: number; differ: number; missing: number; local: number };
}
export interface NcDriftResult {
  ok: boolean;
  message?: string;
  groups: NcDriftGroup[];
  services: string[];
  generatedAt: string;
}
export interface NcOrphansResult {
  ok: boolean;
  hosts: NcOrphanHost[];
  summary: {
    hostsScanned: number;
    hostsUnknown: number;
    unloaded: number;
    backups: number;
    certs: number;
    ssl: number;
    generatedAt: string;
  };
}

// Gecmis (Git benzeri, 2026-09-19): yalniz degisiklikte satir; icerik blob deposunda (sha256)
export type NcChangeSource = 'first-seen' | 'server' | 'portal-publish' | 'deleted';
export interface NcChange {
  id: number;
  host: string;
  path: string;
  oldSha256: string | null;
  newSha256: string | null;
  size: number | null;
  fileMtime: string | null;
  fileOwner: string | null;
  source: NcChangeSource;
  requester: string | null;
  jobId: number | null;
  seenAt: string | null;
  dumpTime: string | null;
  pending: boolean;
  hasOld: boolean;
  hasNew: boolean;
}

export interface NcLaunch {
  ok: boolean;
  jobId: number | null;
  status: string | null;
  awxServerId: number;
  message?: string;
  newSha256?: string;
  currentSha256?: string | null;
  conflicts?: { host: string; reason: string; currentSha256?: string }[];
  hosts?: string[];
}
export interface NcJobStatus {
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

export interface NcOrphanCleanupResult {
  ok: boolean;
  message?: string;
  job?: { jobId?: number | null; status?: string | null; awxServerId?: number };
  host?: string;
  mode?: 'plan' | 'apply';
  paths?: string[];
  /** sunucunun "kullanılmayan" listesinde bulunmayan yollar (döküm bayatsa dolar) */
  rejected?: string[];
}

/** Gerçek SPA keşfi satırı — keşif + route envanteri + Dynatrace ölçümü bir arada. */
export interface NgSpaDiscoveryRow {
  cluster: string;
  namespace: string;
  route: string;
  host: string;
  /** Route TLS termination'ı: passthrough | reencrypt | edge | '' (TLS yok) | null (bilinmiyor). */
  termination: string | null;
  /** Route envanterindeki termination_type (route envanterde bulunmadıysa yok). */
  invTermination?: string;
  /** Keşifteki termination ile envanterdeki farklı (yalnız uyarı; Ağ'ı ezmez). */
  agCelisik: boolean;
  workloadKind: string;
  workload: string;
  application: string;
  env: string | null;
  /** Kabinde gerçekten nginx koşuyor mu (ada BAKMADAN). */
  isSpa: boolean;
  /** `nginx-start.sh` (güçlü) ya da `image` (zayıf) — hangi kanıtla işaretlendi. */
  signal: string;
  image: string;
  /** Eşleşme kurulamadıysa sebebi. Satır yine listede durur. */
  note: string;
  /**
   * Eşleşme kanıtı: `selector` (servis selector'u pod etiketlerine uydu) ya da `ad`
   * (servis OKUNAMADI, servisle aynı adlı iş yüküne düşüldü — daha zayıf kanıt). Boş: eşleşmedi.
   */
  matchBy: string;
  /** Bu satırın geldiği tarama (cluster başına en yeni tarama gösterilir). */
  scanDate: string;
  /** Route, route envanterinde kayıtlı mı. `null` = envanter OKUNAMADI. */
  inInventory: boolean | null;
  /** Eski yöntem (`-app-v` / `-app-emb-v`) bunu SPA sayar mıydı. */
  patternMatch: boolean;
  /** ASIL BULGU: gerçekten SPA ama ad kalıbına uymuyor. */
  patternMiss: boolean;
  /** Ad kalıbına uyuyor ama kabinde nginx yok. */
  patternFalse: boolean;
  usage: {
    scanDate: string;
    windowDays: number;
    req: number;
    measured: boolean;
    services: number;
    note: string;
  } | null;
  /** `null` = ölçülemedi ya da ölçüm yok — "istek yok" DEĞİL. */
  reqShown: number | null;
}
/** Uygulama başına tek satır — route'lar, adresler ve cluster'lar birleşik. */
export interface NgSpaApp {
  application: string;
  namespace: string;
  env: string | null;
  /** evet: en az bir route'un ardında nginx var · hayir · bilinmiyor: hiçbir route eşleşmedi */
  spa: 'evet' | 'hayir' | 'bilinmiyor';
  signals: string[];
  /** Yalnız ad eşleşmesiyle bulundu (servis okunamadı) — zayıf kanıt. */
  weakEvidence: boolean;
  /** Ad -app-v / -app-emb-v kuralına uyuyor mu. */
  pattern: 'uyuyor' | 'uymuyor';
  /** Gerçekten SPA ama adı kurala uymuyor (eski yöntem bulamıyordu). */
  patternMiss: boolean;
  /** Adı kurala uyuyor ama nginx yok. */
  patternFalse: boolean;
  /**
   * Uygulama isteği (Dynatrace). `servis-yok`: Dynatrace'te servis oluşmamış (measured=1,
   * services_total=0) — "istek yok" DEĞİL. `olculemedi`: ölçüm düştü ya da tablo okunamadı.
   */
  istek: 'var' | 'yok' | 'servis-yok' | 'olculemedi' | 'olcum-yok';
  reqShown: number | null;
  usage: NgSpaAppUsage | null;
  /** Ağ: route TLS termination'ından (passthrough=internet, reencrypt=intranet). */
  ag: NgSpaAg;
  /** Route sayıları (yalnız sıfırdan büyükler): passthrough, reencrypt, edge, tlsYok, bos (NULL). */
  agSay: Partial<Record<'passthrough' | 'reencrypt' | 'edge' | 'tlsYok' | 'bos', number>>;
  /** Route envanteriyle çapraz kontrol — Ağ değerini EZMEZ, yalnız uyarır. */
  agEnvanter: 'uyumlu' | 'celisik' | 'envanterde-yok' | 'olculemedi';
  agCelisikRoute?: number;
  /** Intranet (reencrypt) SPA internet RP'de tanımlı: kural ile tanım çelişiyor. */
  agCelisme?: boolean;
  /** Reverse proxy'de tanımlı mı (yalnız SPA + internet/karışık; diğerleri uygulanamaz). */
  rp: NgSpaRp;
  /** proxy: eski PROD proxy_pass · include: servis vhost location · dizin: yeni PROD kurulumu */
  rpYol?: ('proxy' | 'include' | 'dizin')[];
  /** 'bulunan/beklenen' RP host sayısı. */
  rpHost?: string;
  /**
   * En zayıf eşleşme yolu (yoksa kesin). `paylasimli`: hedef adresi farklı route'lar paylaşıyor;
   * `belirsiz`: ad birden çok uygulamaya çözülüyor — ikisinde de tanımın trafiği bu uygulamaya
   * AYRILAMAZ.
   */
  rpEsles?: 'ek-prod' | 'ad' | 'envanter' | 'zayif' | 'paylasimli' | 'belirsiz';
  rpSorun?: string[];
  /** olculemedi / kapsam-disi nedeni: kod[:ayrıntı] */
  rpNeden?: string;
  /** RP tanımı istek alıyor mu (access log; yalnız rp=tanimli). */
  rpIstek: NgSpaRpIstek;
  /** rpIstek='kismi' iken 0'ın neden ALT SINIR olduğu (birden çok olabilir). */
  rpIstekNeden?: NgSpaRpIstekNeden[];
  rpReq7?: number;
  rpReq24?: number;
  /** En yeni istek (yyyymmddHHMMSS). */
  rpSon?: string;
  /** Ölçülen tanımlar arasındaki EN KISA pencere (saat). */
  rpPencereSa?: number;
  /** 'ölçülen/ölçülebilir' tanım sayısı. */
  rpOlcum?: string;
  inventory: 'kayitli' | 'kayitli-degil' | 'kismen' | 'olculemedi';
  /** Yalnız inventory='kismen' iken gelir (yanıt boyutu). */
  invRoutes?: number;
  routeCount?: number;
  hosts: string[];
  routes: string[];
  clusters: string[];
  staleClusters: string[];
  notes: string[];
}
export interface NgSpaAppSummary {
  apps: number;
  spa: number;
  notSpa: number;
  unknown: number;
  patternMiss: number;
  patternFalse: number;
  spaRequestActive: number;
  spaRequestIdle: number;
  spaRequestNoService?: number;
  spaRequestUnknown: number;
  spaNotInInventory: number;
  /** SPA'lar için Ağ / RP / RP isteği kırılımları. */
  spaAg?: Record<string, number>;
  spaRp?: Record<string, number>;
  spaRpIstek?: Record<string, number>;
}

/** Uygulama satırındaki kısa Dynatrace özeti (yalnız ipucunda gösterilen alanlar). */
export interface NgSpaAppUsage {
  scanDate: string;
  windowDays: number;
  services: number;
  note?: string;
}
export type NgSpaAg = 'internet' | 'intranet' | 'karisik' | 'diger' | 'bilinmiyor';
export type NgSpaRp = 'tanimli' | 'tanimsiz' | 'olculemedi' | 'kapsam-disi' | 'uygulanamaz';
/** `ayrilamaz`: yalnız uygulamaya ayrılamayan (paylaşımlı / belirsiz) tanım var. */
export type NgSpaRpIstek =
  'var' | 'yok' | 'kismi' | 'olculemedi' | 'kaynak-yok' | 'ayrilamaz' | 'uygulanamaz';
/**
 * 0 isteğin neden ALT SINIR olduğu: pencere < 7 gün / örnekleme / first_seen yok · ölçüm kaynağı
 * olmayan (yeni PROD) tanım da var · ayrılamayan tanım da var · ortamın bir RP sunucusu taranmadı.
 */
export type NgSpaRpIstekNeden = 'pencere' | 'kaynak-yok' | 'ayrilamaz' | 'host-taranmadi';
export type NgSpaTabloDurumu = 'var' | 'yok' | 'okunamadi';

/** Internet RP sunucusu ve o günkü durumu. */
export interface NgSpaRpHost {
  host: string;
  env: string;
  rol: 'nonprod' | 'prod-eski' | 'prod-yeni' | '';
  /** O günün Nginx_Config_Audit / Nginx_Intranet_Audit taramasında satırı var mı. */
  taranan: boolean;
  trafik: 'var' | 'hata' | 'satir-yok' | 'kaynak-yok' | 'olculemedi';
  trafikHata?: number;
}
/** Üst bant: RP kaynaklarının tarihleri ve kapsamı ("ölçülemedi"nin nereden geldiği). */
export interface NgSpaRpKapsam {
  configTarih: string;
  dizinTarih: string;
  trafikTarih: string;
  upsTarih: string;
  proxyKolonu: boolean | null;
  tablolar: Record<'cfg' | 'dir' | 'trf' | 'ups', NgSpaTabloDurumu>;
  hostlar: NgSpaRpHost[];
  /** Ortam -> o gün taranmamış beklenen RP host'ları (o ortamda "tanımsız" denmez). */
  taranmayan: Record<string, string[]>;
  /** Keşifteki hiçbir uygulamaya bağlanamayan RP tanımı sayısı (ortam başına). */
  cozulemeyen: Record<string, number>;
  /**
   * Ortam başına gerçek arka ucu BULUNAMAYAN takma adlı proxy tanımı (upstream tablosu
   * okunamadı/yok ya da adı içermiyor) — o ortamda "tanımsız" denmez.
   */
  hedefCozulemeyen?: Record<string, number>;
  belirsiz: number;
  /** Dizin taraması config taramasından FARKLI günden — PROD için "tanımsız" denmez. */
  dizinFarkli?: boolean;
  envanterOkunamadi: boolean;
  dynatraceOkunamadi: boolean;
}
/** Bir RP tanımı (ayrıntı paneli). */
export interface NgSpaRpTanim {
  host: string;
  rol: string;
  env: string;
  vhost: string;
  location: string;
  status: string;
  yol: 'proxy' | 'include' | 'dizin';
  esles: string;
  hedef?: string;
  hedefKaynak?: string;
  conf?: string;
  /** null: bu tanım için ölçüm kaynağı yok (yeni PROD / dizin). */
  trafik: {
    durum: 'var' | 'sifir' | 'sifir-kismi' | 'olculemedi';
    neden?: string;
    hata?: string;
    req7?: number;
    req24?: number;
    hc24?: number;
    sampled?: boolean;
    pencereSa?: number | null;
    son?: string | null;
    ilk?: string | null;
    tarih?: string;
  } | null;
}
export interface NgSpaRpDetay {
  ok: boolean;
  message?: string;
  /** Sunucunun bellekteki kısa özeti (tam satır istemcide zaten var). */
  app?: Pick<NgSpaApp, 'namespace' | 'application' | 'env' | 'rp' | 'rpNeden' | 'rpIstek'>;
  tanimlar?: NgSpaRpTanim[];
  beklenen?: NgSpaRpHost[];
  kapsam?: Pick<
    NgSpaRpKapsam,
    'configTarih' | 'dizinTarih' | 'trafikTarih' | 'upsTarih' | 'proxyKolonu' | 'tablolar'
  >;
  hesaplandi?: string;
}

export interface NgSpaDiscovery {
  ok: boolean;
  message?: string;
  tableMissing?: boolean;
  scanDate?: string | null;
  rows?: NgSpaDiscoveryRow[];
  apps?: NgSpaApp[];
  appSummary?: NgSpaAppSummary | null;
  /** OpenShift platform namespace'leri (openshift-*, kube-*, default) kapsam dışı. */
  platformHidden?: { routes: number; namespaces: number } | null;
  namespaces?: string[];
  clusters?: string[];
  envs?: string[];
  summary?: {
    routes: number;
    spa: number;
    notSpa: number;
    patternMiss: number;
    patternFalse: number;
    spaNotInInventory: number;
    bySignal: Record<string, number>;
    trafficActive: number;
    trafficIdle: number;
    trafficNoService?: number;
    trafficUnmeasured: number;
    trafficNone: number;
    unmatched: number;
    /** Eşleşmeme sebebi kovaları ("servis okunamadi" = yetki, "servis bulunamadi" = bulgu). */
    unmatchedReasons?: Record<string, number>;
    /** Eşleşme kanıtı kırılımı: selector / ad. */
    byMatch?: Record<string, number>;
  } | null;
  /** Cluster kapsamı: "taranamadı" ile "SPA'sı yok" AYRI. */
  coverage?: NgSpaCoverage | null;
  /** Reverse proxy kaynaklarının tarihleri, tablo durumları ve taranan host'lar. */
  rpKapsam?: NgSpaRpKapsam | null;
  /** Bu yanıtın geldiği sunucu hesabının anı (ayrıntı paneli kendi hesabıyla karşılaştırır). */
  hesaplandi?: string;
}

/**
 * SUNUCUNUN YANIT GÖVDESİNE YAZMADIĞI VARSAYILANLAR (8 MB önbellek sınırı, 2026-10-01).
 * server/nginx-console/spa-discovery.cjs YANIT_VARSAYILAN / YANIT_BOS_DIZI ile BİREBİR aynı
 * olmalı — bekçi: spa-rp.test.cjs SR27. Eksik alan doldurulmazsa ekran `staleClusters.includes`
 * üzerinde çöker ve `rp` alanı olmayan satır "ölçülemedi" görünür (uygulanamaz ≠ ölçülemedi).
 */
export const SPA_YANIT_VARSAYILAN = {
  rp: 'uygulanamaz',
  rpIstek: 'uygulanamaz',
  agEnvanter: 'uyumlu',
  weakEvidence: false,
  patternMiss: false,
  patternFalse: false,
  usage: null,
  reqShown: null,
} as const satisfies Partial<NgSpaApp>;
/** Boşken gövdeye yazılmayan diziler. */
export const SPA_YANIT_BOS_DIZI = ['signals', 'staleClusters', 'notes', 'routes', 'hosts'] as const;

/** Kısaltılmış uygulama satırını tam hale getirir (varsayılanlar + boş diziler + boş agSay). */
export function spaUygulamaDoldur(a: Partial<NgSpaApp>): NgSpaApp {
  const o: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(SPA_YANIT_VARSAYILAN)) if (o[k] === undefined) o[k] = v;
  for (const k of SPA_YANIT_BOS_DIZI) if (!Array.isArray(o[k])) o[k] = [];
  if (!o.agSay) o.agSay = {};
  return o as unknown as NgSpaApp;
}

/** /spa-discovery yanıtı: uygulama satırları sunucunun yazmadığı varsayılanlarla doldurulur. */
export function spaYanitDoldur(d: NgSpaDiscovery): NgSpaDiscovery {
  if (!d || !Array.isArray(d.apps)) return d;
  return { ...d, apps: d.apps.map((a) => spaUygulamaDoldur(a)) };
}

export interface NgSpaCoverageCluster {
  cluster: string;
  /** ok | kismi | login | hata | erisilemedi | bilinmiyor */
  status: string;
  /** Ayrık kova: taranamadi | kismi | bilinmiyor | onceki | guncel */
  bucket: 'taranamadi' | 'kismi' | 'bilinmiyor' | 'onceki' | 'guncel';
  runDate: string;
  dataDate: string;
  routes: number | null;
  spa: number | null;
  unmatched: number | null;
  svcMode: string;
  svcUnreadableNs: number | null;
  reason: string;
  /** Ekrandaki veri bu cluster'ın son koşusundan değil (önceki bir koşudan). */
  stale: boolean;
  /** Son koşuya dahil değildi (hata değil; tek cluster'a koşulan iş ötekileri hedeflemez). */
  notInLastRun: boolean;
  noData: boolean;
}
export interface NgSpaCoverage {
  /** Durum tablosu hiç yoksa kapsam ÖLÇÜLMEMİŞTİR. */
  measured: boolean;
  /** Durum tablosu okunamadıysa sebebi (boş değilse kapsam bilinmiyor). */
  error: string;
  lastRun: string;
  clusters: NgSpaCoverageCluster[];
  /** Kovalar ayrıktır: ok + older + partial + failed + unknown = total. */
  total: number;
  ok: number;
  older: number;
  partial: number;
  failed: number;
  unknown: number;
  /** Kova değil, alt bilgi: ekranda hiç satırı olmayan cluster sayısı. */
  noData: number;
}

export const nginxConsoleApi = {
  // Gercek SPA kesfi (2026-10-01): ad kalibina bakmadan, kabinde nginx kosan uygulamalar.
  // Sunucu 60 sn onbellekler; "Yenile" fresh=1 ile onbellegi atlar. Govdede yazilmayan
  // varsayilanlar BURADA geri doldurulur (spaYanitDoldur).
  spaDiscovery: (fresh = false): Promise<NgSpaDiscovery> =>
    fetch(`${BASE}/spa-discovery${fresh ? '?fresh=1' : ''}`)
      .then((r) => r.json())
      .then(spaYanitDoldur),
  /** Bir uygulamanın RP tanımları ve tanım başına trafik (satıra tıklayınca açılan panel). */
  spaRp: (ns: string, app: string, fresh = false): Promise<NgSpaRpDetay> =>
    fetch(
      `${BASE}/spa-discovery/rp?ns=${encodeURIComponent(ns)}&app=${encodeURIComponent(app)}${fresh ? '&fresh=1' : ''}`,
    ).then(safeJson),
  /** Tüm Nginx sunucularının rate limit dökümü (satır düzeyinde). */
  rateLimit: (scanDate?: string): Promise<NginxRateLimitResult> =>
    fetch(`${BASE}/ratelimit${scanDate ? `?scanDate=${encodeURIComponent(scanDate)}` : ''}`).then(
      safeJson,
    ),

  hosts: (): Promise<{
    ok: boolean;
    hosts: NcHost[];
    consoleDir: string;
    inventoryError: string | null;
  }> => fetch(`${BASE}/hosts`).then(safeJson),
  tree: (host: string): Promise<NcTree> =>
    fetch(`${BASE}/tree/${encodeURIComponent(host)}`).then(safeJson),
  file: (host: string, path: string): Promise<NcFile> =>
    fetch(`${BASE}/file/${encodeURIComponent(host)}?path=${encodeURIComponent(path)}`).then(
      safeJson,
    ),
  compare: (
    path: string,
    hosts?: string[],
  ): Promise<{
    ok: boolean;
    path: string;
    rows: {
      host: string;
      exists: boolean;
      sha256: string | null;
      size: number | null;
      mtime: string | null;
    }[];
    variants: number;
  }> =>
    fetch(
      `${BASE}/compare?path=${encodeURIComponent(path)}${hosts?.length ? `&hosts=${encodeURIComponent(hosts.join(','))}` : ''}`,
    ).then(safeJson),
  certs: (host?: string): Promise<NcCertsResult> =>
    fetch(`${BASE}/certs${host ? `?host=${encodeURIComponent(host)}` : ''}`).then(safeJson),
  drift: (service?: string, env?: string): Promise<NcDriftResult> => {
    const u = new URLSearchParams();
    if (service) u.set('service', service);
    if (env) u.set('env', env);
    const qs = u.toString();
    return fetch(`${BASE}/drift${qs ? '?' + qs : ''}`).then(safeJson);
  },
  orphans: (host?: string): Promise<NcOrphansResult> =>
    fetch(`${BASE}/orphans${host ? `?host=${encodeURIComponent(host)}` : ''}`).then(safeJson),
  /** Kullanılmayan dosyaları karantinaya alır. mode=plan hiçbir şeye dokunmaz. */
  orphansCleanup: (body: {
    host: string;
    paths: string[];
    mode: 'plan' | 'apply';
  }): Promise<NcOrphanCleanupResult> =>
    fetch(`${BASE}/orphans/cleanup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(safeJson),
  // hosts bos + all:true -> playbook tum nginx filosunu envanterden kesfeder (30-40 dk)
  refresh: (hosts: string[], all = false): Promise<NcLaunch & { hosts: string[]; all?: boolean }> =>
    fetch(`${BASE}/refresh`, json({ hosts, all })).then(safeJson),
  // Publish (NIM "Publish"): bir dosya, bir ya da daha fazla sunucu (instance group = servis).
  // expectedSha: host -> Portal'in gordugu sha (anti-TOCTOU); force ile atlanir.
  push: (body: {
    hosts: string[];
    path: string;
    mode: 'create' | 'update';
    content: string;
    expectedSha?: Record<string, string>;
    force?: boolean;
  }): Promise<NcLaunch> => fetch(`${BASE}/push`, json(body)).then(safeJson),
  jobStatus: (awxServerId: number, jobId: number): Promise<NcJobStatus> =>
    fetch(`${BASE}/job-status/${awxServerId}/${jobId}`).then(safeJson),
  // Gecmis
  history: (
    host: string,
    path: string,
  ): Promise<{ ok: boolean; versions: NcChange[]; message?: string }> =>
    fetch(`${BASE}/history/${encodeURIComponent(host)}?path=${encodeURIComponent(path)}`).then(
      safeJson,
    ),
  changes: (
    q: { host?: string; path?: string; source?: string; since?: string; limit?: number } = {},
  ): Promise<{ ok: boolean; changes: NcChange[]; message?: string }> => {
    const u = new URLSearchParams();
    Object.entries(q).forEach(([k, v]) => {
      if (v != null && v !== '') u.set(k, String(v));
    });
    return fetch(`${BASE}/changes?${u.toString()}`).then(safeJson);
  },
  blob: (
    sha: string,
  ): Promise<{ ok: boolean; sha256: string; content: string; message?: string }> =>
    fetch(`${BASE}/blob/${encodeURIComponent(sha)}`).then(safeJson),
};

// ── Rate Limit sekmesi (v2, 2026-09-26) ──────────────────────────────────────────────
// Kaynak dbo.Nginx_Audit_Settings: nginx_audit her sunucuda `nginx -T` koşar, yani
// ÇALIŞAN konfigürasyon. Satır = SUNUCU (location değil) — ilk sürüm ~50.000 satırı
// tarayıcıya yığıp sayfayı OOM'a düşürmüştü.

export interface NginxRateLimitZone {
  key: string;
  kind: 'req' | 'conn';
  rate?: string;
  conn?: number;
  burst?: number;
  nodelay?: boolean;
  variable: string;
  size: string;
  label: string;
  desc: string;
}

export interface NginxRateLimitHost {
  host: string;
  env: string;
  /** rate_limits.conf'taki request_limit oranı (nginx -T'den) */
  requestRate: string | null;
  serverRate: string | null;
  connLimit: number | null;
  /** gerçekten UYGULANAN zone adları (limit_req / limit_conn) */
  applied: string[];
  zoneCount: number;
  /** nginx -T çıktısında rate_limits.conf görünüyor mu */
  fileLoaded: boolean;
  /** audit'in referans dosyayla karşılaştırmasında uyuşmayan direktif sayısı */
  mismatch: number;
  /** eksik = zone yok YA DA tanımlı ama uygulanmıyor */
  /** bilinmiyor = ölçülmedi; kurulumyok/calismiyor/configbozuk = sunucunun kendi durumu.
   *  Hiçbiri EKSİK ile karıştırılmaz: eksik olan limit değil, ölçümdür. */
  durum:
    'standart' | 'farkli' | 'eksik' | 'bilinmiyor' | 'kurulumyok' | 'calismiyor' | 'configbozuk';
  /** null = ölçülmedi */
  kurulu: boolean | null;
  /** null = ölçülmedi. false iken değerler DOSYADA yazandır, şu an uygulanmıyor. */
  calisiyor: boolean | null;
  hostDurum: string;
  hostDurumLabel: string;
  hostDurumHint: string;
  hostDurumMsg: string | null;
  eksikler: string[];
  farklar: string[];
  detay: { file: string; context: string; directive: string; value: string; matches: boolean }[];
}

export interface NginxRateLimitSummary {
  hosts: number;
  standart: number;
  farkli: number;
  eksik: number;
  bilinmiyor: number;
  kurulumyok: number;
  calismiyor: number;
  configbozuk: number;
  dosyaYuklenmemis: number;
  byEnv: Record<string, { hosts: number; standart: number; farkli: number; eksik: number }>;
  /** filodaki farklı limit kombinasyonları: "filo tek tip mi" sorusunun cevabı */
  rates: { combo: string; hosts: number }[];
}

export interface NginxRateLimitResult {
  ok: boolean;
  message?: string;
  tableMissing?: boolean;
  /** true = bu taramada limit direktifleri yok (eski nginx_audit sürümü) */
  directivesMissing?: boolean;
  scanDate: string | null;
  availableDates: string[];
  hosts: NginxRateLimitHost[];
  summary: NginxRateLimitSummary | null;
  catalog?: { file: string; zones: NginxRateLimitZone[] };
}
