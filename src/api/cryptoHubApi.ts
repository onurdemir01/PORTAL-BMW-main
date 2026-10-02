// src/api/cryptoHubApi.ts — Crypto Hub (2026-09-25): Metaco / Wyden durum + sürüm.
// Sunucu karşılığı: server/crypto-hub/index.cjs
import { safeJson } from './http';

const BASE = '/api/crypto-hub';

export interface CryptoEnvOption {
  key: string;
  env: string;
  label: string;
  production: boolean;
  cluster: string;
  namespace: string;
  /** false = namespace/helm tanımı girilmemiş; tarama bu ortamı atlar */
  ready: boolean;
  /** false = ortam şimdilik kapalı (2026-09-26: production kapatıldı); seçilemez, API de reddeder */
  open: boolean;
}
export interface CryptoDomain {
  domain: string;
  label: string;
  envs: CryptoEnvOption[];
}
export interface CryptoApp {
  app: string;
  label: string;
  domains: CryptoDomain[];
}

export interface CryptoTenant {
  key: string;
  app: string;
  appLabel: string;
  domain: string;
  domainLabel: string;
  env: string;
  envLabel: string;
  production: boolean;
  bastion: string;
  cluster: string;
  apiUrl: string;
  namespace: string;
  helmRelease: string;
  chartRef: string;
  /** klasik helm deposu chart'ı (Wyden); boş = Metaco yerel dizin chart'ı (upgrade kapalı) */
  chartName?: string;
  /** CPU/bellek için values dosyası (katalog). Boş = tanımlı değil: önizleme/uygulama kapalı,
   *  yol tahmin EDİLMEZ ve istemciden ALINMAZ. */
  resValuesPath?: string;
  /** canlı release'in bu dosyadan uygulandığı ölçüldü mü (bugün hepsi false) */
  resValuesVerified?: boolean;
  resValuesEvidence?: string;
  /** aktif-pasif eş kiracılar: aynı düzenleme eş dosyaya YALNIZ yazılır (upgrade yok) */
  resPeerTenants?: string[];
}

export interface CryptoComponent {
  kind: string;
  name: string;
  want: number | null;
  ready: number | null;
  image: string;
  version: string;
  /** running = hazır ≥ istenen · stopped = istenen 0 · degraded = eksik replika */
  state: 'running' | 'stopped' | 'degraded';
}

export interface CryptoRelease {
  name: string;
  chart: string;
  chartVersion: string;
  appVersion: string;
  status: string;
  updatedAt: string;
}

export interface CryptoArchive {
  version: string;
  dir: string;
  /** indirilmiş chart paketi (harmonize-1.34.4.tgz); boş = dizinde .tgz yok */
  chart: string;
  /** values dosyaları — yalnızca ad/boyut/tarih; İÇERİK TUTULMAZ (parola barındırabilir).
   *  `file` cluster alt dizinini de taşır: "cldev1/garanti_values.yaml". */
  values: { file: string; size: number; mtime: string }[];
}

export interface CryptoVersions {
  running: string;
  /** koşan sürümün okunduğu ANA helm release (Wyden: wydenapp, Metaco: hmz) */
  release: string;
  /**
   * false = registry sorgulanamadı (kimlik yok / skopeo yok / hata). Bu durumda `available`
   * boştur ama bu "yeni sürüm yok" DEMEK DEĞİLDİR — ekran "ölçülemedi" gösterir.
   */
  measured: boolean;
  /**
   * false = bu uygulamada sürüm listesi HİÇ SORGULANMAZ (Metaco'nun chart deposu listeleme
   * desteklemiyor; yeni sürüm elle bildirilir). `measured: false` ile KARIŞTIRILMAMALI:
   * biri "deneyip başaramadık", öteki "denemiyoruz, gerek yok".
   */
  listing: boolean;
  available: string[];
  newer: string[];
  latest: string;
}

export interface CryptoOverview {
  ok: boolean;
  tenant?: CryptoTenant;
  notConfigured?: boolean;
  tableMissing?: boolean;
  cached?: boolean;
  scannedAt?: string | null;
  components?: CryptoComponent[];
  releases?: CryptoRelease[];
  archives?: CryptoArchive[];
  versions?: CryptoVersions | null;
  notes?: { level: string; stage: string; message: string }[];
  summary?: { total: number; running: number; stopped: number; degraded: number };
  message?: string;
}

export interface CryptoActionDef {
  key: string;
  label: string;
  hint: string;
  writes: boolean;
  params: { key: string; label: string; required?: boolean; placeholder?: string }[];
}

export interface CryptoPlanStep {
  n: number;
  /** command = koşulacak komut · check = doğrulama · manual = Portal dışı (LinuxOne, Jenkins, iş birimi) */
  kind: 'command' | 'check' | 'manual';
  /** true = kümede DEĞİŞİKLİK yapar */
  writes: boolean;
  title: string;
  command?: string;
  note?: string;
  /** true = runbook'ta kesinleşmemiş bir değer var; ekran "doğrulanmalı" der */
  unknown?: boolean;
  source?: string;
}

export interface CryptoPlan {
  action: string;
  label: string;
  tenantKey: string;
  params: Record<string, string>;
  scannedAt: string | null;
  steps: CryptoPlanStep[];
  writeCount: number;
  unknownCount: number;
  warnings: string[];
  /** false = işlem Portal'dan henüz ÇALIŞTIRILMIYOR; ekran yalnızca komutları gösterir */
  runnable: boolean;
  runnableNote: string;
}

export const cryptoHubApi = {
  tenants: (): Promise<{ ok: boolean; apps: CryptoApp[]; message?: string }> =>
    fetch(`${BASE}/tenants`).then(safeJson),

  overview: (tenant: string, fresh = false): Promise<CryptoOverview> =>
    fetch(`${BASE}/overview?tenant=${encodeURIComponent(tenant)}${fresh ? '&fresh=1' : ''}`).then(
      safeJson,
    ),

  /** Taramayı şimdi koştur (salt okunur iş; yalnız seçili kiracı). */
  rescan: (
    tenant: string,
  ): Promise<{ ok: boolean; jobId?: number | null; awxServerId?: number; message?: string }> =>
    fetch(`${BASE}/rescan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant }),
    }).then(safeJson),

  actions: (): Promise<{ ok: boolean; actions: CryptoActionDef[]; message?: string }> =>
    fetch(`${BASE}/actions`).then(safeJson),

  /** Ön onay planı: uygulanacak komutlar (salt okunur; hiçbir şey çalıştırmaz). */
  plan: (
    tenant: string,
    action: string,
    version = '',
  ): Promise<{ ok: boolean; plan?: CryptoPlan; message?: string }> =>
    fetch(
      `${BASE}/plan?tenant=${encodeURIComponent(tenant)}&action=${encodeURIComponent(action)}` +
        (version ? `&version=${encodeURIComponent(version)}` : ''),
    ).then(safeJson),

  jobStatus: (
    awxServerId: number,
    jobId: number,
  ): Promise<{ ok: boolean; status: string; output?: string; message?: string }> =>
    fetch(`${BASE}/job-status/${awxServerId}/${jobId}`).then(safeJson),
};

// ── İşlemler (log / pod silme / rollout / replika), 2026-09-26 ────────────────────────
export type CryptoOpsAction =
  | 'pods'
  | 'logs'
  | 'values_get'
  | 'pod_delete'
  | 'rollout'
  | 'scale'
  | 'values_put'
  | 'values_files'
  | 'values_diff'
  | 'helm_template'
  | 'helm_upgrade'
  | 'values_backups'
  | 'values_restore'
  | 'configmaps'
  | 'configmap_get'
  | 'configmap_put'
  | 'resources_get'
  | 'resources_plan'
  | 'resources_apply';

// ── CPU / bellek (2026-10-02) ─────────────────────────────────────────────────────────
// Sunucu karşılığı: server/crypto-hub/resources.cjs (RES* satırları). Values İÇERİĞİ hiç
// gelmez: yalnız resources değerleri, yollar, sayılar ve sha256 özetleri.
export type CryptoResAlan = 'requests.cpu' | 'requests.memory' | 'limits.cpu' | 'limits.memory';
export interface CryptoResChange {
  alan: CryptoResAlan;
  /** dosyadaki değer; '' = dosyada yok (değer chart varsayılanından gelir) */
  eski: string;
  /** standart biçim: cpu 1500m / 2, bellek 512Mi / 4Gi */
  yeni: string;
}
export interface CryptoResLive {
  kind: string;
  ad: string;
  kap: string;
  /** kap | init */
  tur: string;
  /** spec'teki ham değer; null = spec'te YOK (LimitRange varsayılanı uygulanır) */
  'requests.cpu': string | null;
  'requests.memory': string | null;
  'limits.cpu': string | null;
  'limits.memory': string | null;
}
export interface CryptoResLimitKural {
  ad: string;
  tur: string;
  ozellik: string;
  kaynak: string;
  deger: string;
}
export interface CryptoResCheck {
  kontrol: string;
  /** gecti | dur | uyari | bilgi | olculemedi — "ölçülemedi" "geçti" DEĞİLDİR */
  durum: string;
  mesaj: string;
}
export interface CryptoResources {
  tools: { arac: string; durum: string; surum: string }[];
  release: { ad: string; surum: string; olculdu: boolean } | null;
  src: {
    yol: string;
    /** okundu | tanimsiz | olculemedi */
    durum: string;
    dogrulama: string;
    sha256: string;
    bayt: number | null;
    yazilabilir: string;
    aciklama: string;
  } | null;
  /** RESFILE: deger 'YOK' = dosyada yok · 'OKUNAMADI' / 'GECERSIZ' = ölçülemedi */
  files: { bilesen: string; alan: string; deger: string; satir: number | null }[];
  workloads: {
    kind: string;
    ad: string;
    replika: number | null;
    hazir: number;
    strateji: string;
    release: string;
  }[];
  live: CryptoResLive[];
  /** durum: olculdu | yok (ölçüldü, LimitRange yok) | olculemedi */
  limitRange: { durum: 'olculdu' | 'yok' | 'olculemedi'; kurallar: CryptoResLimitKural[] };
  quota: {
    durum: 'olculdu' | 'yok' | 'olculemedi';
    satirlar: { ad: string; kaynak: string; hard: string; used: string }[];
  };
  peers: { kiraci: string; yol: string; durum: string; sha256: string; mesaj: string }[];
  checks: CryptoResCheck[];
  edits: { rol: string; bilesen: string; alan: string; eski: string; yeni: string; islem: string }[];
  diffs: { kind: string; ad: string; kap: string; alan: string; eski: string; yeni: string }[];
  /** `bekleyen`: iş yükü istenen değişiklik yüzünden değil, dosyadaki canlıya uygulanmamış
   *  kaynak farkı yüzünden yeniden başlıyor (riskli onay ve kontroller onu da kapsar). */
  affect: { kind: string; ad: string; strateji: string; replika: string; riskli: boolean; bekleyen?: boolean }[];
  /** bekleyen farklar: `kaynak_disi` satırlarda DEĞER YOK (gösterilmez) */
  pending: { tur: string; kind: string; ad: string; yer: string; canli: string; dosya: string }[];
  drift: { kind: string; ad: string; kap: string; alan: string; canli: string; manifest: string }[];
  repl: { kind: string; ad: string; canli: string; manifest: string }[];
  plan: {
    durum: 'ok' | 'dur';
    kod: string;
    dosyaSha: string;
    yeniSha: string;
    chartSha: string;
    bekleyen: string;
    riskli: boolean;
    jeton: string;
  } | null;
  steps: { adim: string; durum: string; mesaj: string }[];
  obs: { kontrol: string; durum: string; mesaj: string }[];
  errors: { asama: string; mesaj: string }[];
  end: { islem: string; sonuc: string; kod: string } | null;
  /** Portal plan jetonu: YALNIZ planı başlatan kullanıcıya, YALNIZ temiz plana; 15 dk */
  planJetonu?: string | null;
  planBitis?: number | null;
  planJetonDurumu?: string;
}
export interface CryptoResDogrulama {
  ok: boolean;
  hatalar: { kod: string; mesaj: string; asilabilir: boolean }[];
  uyarilar: { kod: string; durum: string; mesaj: string }[];
  kontroller: { kontrol: string; durum: string }[];
  asimKullanildi: boolean;
  politikaIhlali: boolean;
}

export interface CryptoPod {
  name: string;
  phase: string;
  /** tüm kaplar hazır mı */
  ready: boolean;
  containers: number;
  restarts: number;
  startedAt: string;
  node: string;
}

export interface CryptoOpsResult {
  action?: string | null;
  /** values_get: satırlar maskeli mi (varsayılan evet) */
  masked?: boolean;
  /** values.yaml satırları (values_get) */
  values?: string[];
  pods: CryptoPod[];
  logs: { target: string; line: string }[];
  results: { target: string; ok: boolean; message: string }[];
  errors: { stage: string; message: string }[];
  /** values_files: cluster başına okunan dosya. `lines` VARSAYILAN OLARAK MASKELİ gelir.
   *  `error` doluysa o dosya okunamadı: "fark yok" DEMEK DEĞİL. */
  files?: { path: string; size: number; lines: string[]; error: string | null }[];
  /** values_files: cluster karşılaştırması. Sunucuda, HAM satırlar üzerinde hesaplanır —
   *  maskeleme her sırrı `****` yaptığı için maskeli veride iki FARKLI parola AYNI görünür
   *  ve gerçek bir fark sessizce kaybolurdu. `sirli` satırlarda fark bildirilir ama değer
   *  gösterilmez (server/crypto-hub/values-compare.cjs). */
  compare?: {
    okunan: { path: string; cluster: string }[];
    okunamayan: { path: string; cluster: string; error: string }[];
    /** yalnızca FARKLI olan ayarlar; `degerler` dizisi `okunan` ile aynı sıradadır */
    satirlar: {
      anahtar: string;
      degerler: (string | null)[];
      ayni: boolean;
      sirli: boolean;
      eksikVar: boolean;
    }[];
    farkliSayi: number;
    anahtarSayi: number;
    /** iki dosyadan az okunduysa false — "uyumlu" demek yanlış olurdu */
    karsilastirilabilir: boolean;
  };
  /** helm_upgrade: upgrade ÖNCESİ ve SONRASI route listesi. Runbook "upgrade bazen
   *  route'ları siliyor" diyor; bu bir uyarı olarak kalmasın diye ÖLÇÜLÜYOR. */
  routes?: { once: string[]; sonra: string[] };
  /** helm_template: uygulanınca oluşacak nesneler (özet) ve ham manifest.
   *  `--validate` KULLANILMAZ: önizleme küme erişimine bağlı değildir, dolayısıyla
   *  "kümenin bunu kabul edeceği" GARANTİSİ DEĞİL, "ne üretileceği"nin gösterimidir. */
  template?: {
    objects: { kind: string; name: string }[];
    lines: string[];
    /** Secret data/stringData ve sır adlı anahtarlar maskeli */
    masked?: boolean;
    /** maske uygulanamadı: satırlar GÖNDERİLMEDİ (ham manifest dönmez) */
    maskeHatasi?: boolean;
  };
  /** resources_get / resources_plan / resources_apply çıktısı */
  resources?: CryptoResources | null;
  /** values_backups: dosyanın `.bak` sürümleri, EN YENİSİ BAŞTA. values_put her yazmadan
   *  önce yedek bıraktığı için geçmiş zaten diskte duruyordu; bu onu görünür kılar. */
  backups?: { path: string; size: number; mtime: string }[];
  /** configmaps: namespace'teki config map özetleri. `managedBy` doluysa (örn. "Helm")
   *  nesne bir chart'a ait — elle değiştirilen alan bir sonraki `helm upgrade`de geri alınır. */
  configMaps?: {
    name: string;
    keys: number;
    createdAt: string;
    managedBy: string;
    /** Config map değişince NE rollout edilmeli — SUNUCUDA çözülür.
     *  `kaynak`: 'kayitli' (doğrulanmış eşleşme) · 'tahmin' (addan çıkarıldı, doğrulanmalı)
     *  · 'yok' (kayıtlı değil — uydurulmaz). */
    rollout?: { kaynak: 'kayitli' | 'tahmin' | 'yok'; targets: string[]; note: string };
  }[];
  /** configmap_get: anahtar → değer (değerler çok satırlı olabilir) */
  configMapData?: { key: string; value: string }[];
}

export const cryptoOpsApi = {
  /** Yazan işlemlerde `confirmed` şart; sunucu onaysız çalıştırmaz (HTTP 428). */
  run: (body: {
    tenant: string;
    action: CryptoOpsAction;
    targets: string[];
    tail?: number;
    container?: string;
    previous?: boolean;
    replicas?: number;
    confirmed?: boolean;
    release?: string;
    valuesAll?: boolean;
    valuesPath?: string;
    content?: string;
    /** values_files: karşılaştırılacak cluster dosyalarının TAM yolları (/vhosting altı) */
    valuesPaths?: string[];
    /** values_restore: geri yüklenecek yedek — hedef dosyanın KENDİ yedeği olmalı */
    backupPath?: string;
    /** configmap_get / configmap_put: config map adı */
    cmName?: string;
    /** configmap_put: yazılacak `data` alanları. null = anahtarı SİL (merge patch). */
    data?: Record<string, string | null>;
    /** values_diff / helm_template / helm_upgrade: chart ve koşan sürüm SUNUCUDA çözülür;
     *  gövdeye yazılan chart/sürüm dikkate ALINMAZ (aksi halde "yalnız values değişecek"
     *  diyen bir istek sessizce başka bir sürüm uygulayabilirdi). */
    /** resources_plan: values bileşen yolu (KAYITLI olmalı), kap, iş yükü ve değişiklik.
     *  Dosya yolu / release GÖNDERİLMEZ — sunucu katalogdan çözer. */
    component?: string;
    kind?: string;
    name?: string;
    changes?: CryptoResChange[];
    /** yalnız Admin + gerekçe: oran/tavan/taban sınırını aşar (K8S kuralı ve LimitRange aşılamaz) */
    policyOverride?: boolean;
    reason?: string;
    /** ekranın gördüğü canlı değerler (yalnız ön eleme; sunucu kendi ölçümünü tercih eder) */
    live?: Partial<Record<CryptoResAlan, string | null>>;
    /** resources_apply: yalnız Portal plan jetonu (AWX sha/jeton sunucuda saklı) */
    planToken?: string;
    riskyAck?: boolean;
    acceptPending?: boolean;
  }): Promise<{
    ok: boolean;
    jobId?: number | null;
    awxServerId?: number;
    needsConfirm?: boolean;
    needsRiskyAck?: boolean;
    needsPendingAck?: boolean;
    code?: string;
    dogrulama?: CryptoResDogrulama;
    canliKaynagi?: 'sunucu' | 'istemci' | 'olculemedi';
    message?: string;
  }> =>
    fetch(`${BASE}/ops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(safeJson),

  /** reveal=true: values satırları MASKESİZ döner ve bu istek denetim kaydına yazılır. */
  result: (
    awxServerId: number,
    jobId: number,
    reveal = false,
  ): Promise<{ ok: boolean; status: string; result: CryptoOpsResult | null; message?: string }> =>
    fetch(`${BASE}/ops-result/${awxServerId}/${jobId}${reveal ? '?reveal=1' : ''}`).then(safeJson),

  /** Seçilen ayarları hedef dosya içeriğine uygular ve YENİ İÇERİĞİ döndürür — HİÇBİR ŞEY
   *  YAZMAZ. Gerçek yazma `values_put` ile olur (yedek alır, denetime yazar): tek yazma
   *  yolu kalsın diye burada ikinci bir yol açılmadı. Maskeli içerik reddedilir (HTTP 409):
   *  maskeli metni geri yazmak gerçek parolayı `****` ile değiştirmek olurdu. */
  valuesApply: (body: {
    tenant: string;
    lines: string[];
    secimler: { anahtar: string; deger: string }[];
  }): Promise<{
    ok: boolean;
    content?: string;
    degisen?: { anahtar: string; eski: string; yeni: string }[];
    atlanan?: { anahtar: string; sebep: string }[];
    message?: string;
  }> =>
    fetch(`${BASE}/values-apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(safeJson),
};
