// src/api/appHubApi.ts — Application Hub (2026-11-08): uygulama adıyla JBoss / WAS / OpenShift görünümü.
// Sunucu karşılığı: server/app-hub/index.cjs, veri.cjs, canli.cjs
import { okJson } from './http';

const BASE = '/api/app-hub';

export type AppTip = 'jboss' | 'was' | 'ocp';

export interface AppAramaSonucu {
  ad: string;
  tip: AppTip;
  ozet: string;
  varyantlar?: string[];
}

export interface Kapasite {
  cpu: number | null;
  bellekGb: number | null;
  os: string | null;
  osSurum: string | null;
  ip: string | null;
  ortam: string | null;
}

export interface Trafik {
  durum: 'var' | 'yok' | 'olculemedi';
  req7?: number;
  req24?: number;
  sampled?: boolean;
}

export interface WebBag {
  host: string;
  serverName: string | null;
  product: string | null;
  port?: string | number | null;
  kaynak?: string | null;
  trafik?: Trafik | null;
}

export interface JbossJvm {
  host: string;
  ad: string;
  nesil: number | null;
  grup: string | null;
  calisiyor: boolean | null;
  autoStart: string;
  durum: string | null;
  portlar: (string | number)[];
  jvmArgs: string | null;
  yapilandirilanJvmArgs: string | null;
  jvmArgFarki: string | null;
  jvmArgDurumu: string | null;
  jvmArgKaynagi: string | null;
  istek24s: number | null;
  istek7g: number | null;
  taze: boolean;
  taramaTarihi: string | null;
}

export interface JbossSunucu {
  host: string;
  uygulama: string;
  ortam: string | null;
  site: string | null;
  jbossSurum: string | null;
  nesil: number | null;
  jdk: string | null;
  jre: string | null;
  envanterDurumu: string | null;
  uygulamaYolu: string | null;
  tier: string | null;
  jvmSayisi: number | null;
  minHeap: string | null;
  maxHeap: string | null;
  jvmler: JbossJvm[];
  web: WebBag[];
  webUyari: string | null;
  kapasite: Kapasite | null;
}

export interface WebSunucusu {
  host: string;
  urun: string | null;
  vhostlar: string[];
  uygulamaSunuculari: string[];
  istek7g: number | null;
}

export interface KaynakDurumu {
  hata: string | null;
  [k: string]: unknown;
}

export interface JbossDetay {
  tip: 'jboss';
  ad: string;
  varyantlar: string[];
  ozet: {
    sunucuSayisi: number;
    ortamlar: string[];
    surumler: string[];
    jvmSayisi: number;
    calisanJvm: number;
    webSunucuSayisi: number;
    toplamCpu: number | null;
    toplamBellekGb: number | null;
    yuk: { vhost: number; var: number; yok: number; olculemedi: number; req7Toplam: number; altSinir: boolean; okunamadi: string | null } | null;
  };
  sunucular: JbossSunucu[];
  webSunuculari: WebSunucusu[];
  kaynaklar: Record<string, KaynakDurumu>;
}

export interface WasSunucu {
  host: string;
  ortam: string | null;
  wasSurum: string | null;
  jdk: string | null;
  jre: string | null;
  os: string | null;
  envanterDurumu: string | null;
  alan: string | null;
  kapasite: Kapasite | null;
  jvm: {
    profil: string | null;
    hucre: string | null;
    dugum: string | null;
    minHeap: string | null;
    maxHeap: string | null;
    jvmArgs: string | null;
    /** server.xml okuma durumu: OKUNDU | YOK | IZIN | BOZUK | JVM_YOK …; null = eski tarayıcı (ölçülmedi) */
    jvmDurumu: string | null;
    sistemOzellikleri: { ad: string; deger: string | null }[];
    ozellikKesildi: boolean;
    taranma: string | null;
  } | null;
  jvmToplandi: boolean;
  web: WebBag[];
  tier: string | null;
}

export interface WasDetay {
  tip: 'was';
  ad: string;
  ozet: { sunucuSayisi: number; ortamlar: string[]; surumler: string[]; webSunucuSayisi: number; toplamCpu: number | null; toplamBellekGb: number | null };
  sunucular: WasSunucu[];
  webSunuculari: WebSunucusu[];
  kaynaklar: Record<string, KaynakDurumu>;
}

export interface OcpRoute {
  adres: string;
  ad: string | null;
  tls: string | null;
  kanit: string;
}

export interface OcpCanliNesne {
  tur: string;
  kind: string;
  ad: string;
  istenen: number | null;
  hazir: number | null;
  guncel: number | null;
  mevcut: number | null;
  strateji: string | null;
  gitops: string | null;
  olusturma: string | null;
  containerlar: {
    ad: string;
    imaj: string | null;
    istek: { cpu: string | null; bellek: string | null };
    limit: { cpu: string | null; bellek: string | null };
    jvmEnv: { ad: string; kaynak: 'deger' | 'referans'; deger: string }[];
  }[];
}

export interface OcpCanliOkuma {
  cluster: string;
  namespace: string;
  ok: boolean;
  hata: string | null;
  alanAd: string | null;
  alinma: string | null;
  isNo: number | null;
  nesneler?: OcpCanliNesne[];
  podlar?: { ad: string; faz: string | null; node: string | null; hazir: string | null; restart: number | null; baslama: string | null }[];
  nodelar?: { ad: string; pod: number }[];
  hpa?: { ad: string; hedef: string | null; min: number | null; max: number | null; guncel: number | null }[];
  notlar?: string[];
}

export interface OcpYer {
  cluster: string;
  namespace: string;
  ortam: string | null;
  tenant: string | null;
  konsol: string | null;
  katalogda: boolean;
  onbellek: { kayitlar: { kind: string; name: string; replicas: number | null; image: string | null }[]; alinma: string | null; bayat: boolean } | null;
  routelar: OcpRoute[];
  routeEslesme: string | null;
  atfedilmeyenRoute: number;
  istek: { toplam: number | null; gun: number | null; olculdu: boolean; tarih: string | null } | null;
}

export interface OcpDetay {
  tip: 'ocp';
  ad: string;
  ozet: { clusterSayisi: number; namespaceSayisi: number; ortamlar: string[]; routeSayisi: number };
  yerler: OcpYer[];
  canli: OcpCanliOkuma[] | { hata: string };
  kaynaklar: Record<string, KaynakDurumu>;
}

export type AppDetay = JbossDetay | WasDetay | OcpDetay;

export interface JvmParamYaniti {
  ok?: boolean;
  serverId?: number;
  jobId?: number | null;
  plan?: boolean;
  parametre?: string;
  /** Production: Smart talebi açıldı, iş onaydan sonra başlar. */
  pendingApproval?: boolean;
  externalTicketId?: string;
  message?: string;
}
export interface JvmParamDurum {
  status: string;
  finished: boolean;
  /** OK | PLAN | SKIP | FAIL | BILINMIYOR */
  sonuc?: string;
  mesaj?: string;
  plan?: boolean | null;
}

export const appHubApi = {
  async ara(q: string): Promise<{ sonuclar: AppAramaSonucu[]; okunamayan: { tip: AppTip; hata: string }[]; mesaj?: string; kesildi?: boolean }> {
    return okJson(await fetch(`${BASE}/ara?q=${encodeURIComponent(q)}`));
  },
  async detay(tip: AppTip, ad: string, fresh = false): Promise<{ uygulama: AppDetay; okundu: string }> {
    return okJson(await fetch(`${BASE}/uygulama/${tip}/${encodeURIComponent(ad)}${fresh ? '?fresh=1' : ''}`));
  },
  async ocpCanliBaslat(ad: string, hedefler?: { cluster: string; namespace: string }[]): Promise<{ serverId: number; jobId: number; hedefler: { cluster: string; namespace: string }[]; atlanan: string[] }> {
    return okJson(
      await fetch(`${BASE}/ocp/${encodeURIComponent(ad)}/canli`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hedefler ? { hedefler } : {}),
      }),
    );
  },
  /** JBoss JVM parametresi (2026-11-11): apply=false plan (hiçbir şey değişmez), apply=true uygula (prod: Smart onayı). */
  async jvmParam(g: { host: string; gen: number; jvm: string; parametre: string; uygulama: string; apply?: boolean; onayMetni?: string }): Promise<JvmParamYaniti> {
    return okJson(
      await fetch(`${BASE}/jboss/jvm-param`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(g),
      }),
    );
  },
  async jvmParamDurum(serverId: number, jobId: number): Promise<JvmParamDurum> {
    return okJson(await fetch(`${BASE}/jboss/jvm-param/${serverId}/${jobId}`));
  },
  async ocpCanliDurum(serverId: number, jobId: number, ad: string): Promise<{ status: string; finished: boolean; error?: string; genel?: string; okumalar?: OcpCanliOkuma[] }> {
    return okJson(await fetch(`${BASE}/ocp/canli/${serverId}/${jobId}?ad=${encodeURIComponent(ad)}`));
  },
};
