// src/api/arkSpaApi.ts — Nginx ARK SPA Raporu uçları.
import type { SpaYukOlcumu } from './denetimApi';

/** Yük ölçümü: Denetim > Nginx SPA ve Production Taşımaları ile AYNI biçim ve kural
 *  (server/audit/nginx-migration.cjs spaTrafikDurumu). 'idle' yalnız 7 günün tamamı ve
 *  tanımın her sunucusu ölçülmüşken gelir. */
export type ArkYuk = SpaYukOlcumu;

export interface ArkSatir {
  service: string;
  /** Tanımın tüm sunucuları 'Yerine geç' + tek elle etikete sahipse o etiket (Nginx Hub › Envanter). */
  serviceEtiket?: string;
  env: string;
  namespace: string;
  application: string;
  location: string;
  hosts: string[];
  vhosts: string[];
  team: string[];
  /** team ile AYNI SIRADA kaynak (SI51_AGILE … / NAMESPACE = namespace sahibi); boş = bilinmiyor. */
  teamKaynak?: string[];
  /** Namespace sahiplik tablosu okunamadı ve uygulamanın kendi sahibi yok: "veri yok" (≠ bilinmiyor). */
  teamVeriYok?: boolean;
  /** ÖLÇÜM. Beyandan ayrıdır ve biri diğerini ezmez. null = bu location hiç ölçülmedi. */
  traffic: ArkYuk | null;
  /** EKİBİN BEYANI. null = ekip beyan etmemiş ("kullanmıyor" DEĞİL). */
  inUse: string | null;
  inUseBy: string | null;
  /** Beyanın girildiği an (ISO). Eski bir beyan bugünkü kadar güvenilir değildir. */
  inUseAt: string | null;
  note: string;
  /**
   * Beyan HANGİ SEVİYEDEN geldi (2026-10-01):
   *   'location'    = bu satıra özel beyan
   *   'application' = SPA Taşımaları'ndaki uygulama beyanı DEVRALINDI
   *   null          = beyan yok
   * Devralınmış bir beyanı satırın kendi beyanı gibi göstermek, "birine yazdım hepsine
   * işlendi" izlenimini sürdürürdü.
   */
  inUseScope: 'location' | 'application' | null;
}

export interface ArkServis {
  service: string;
  rows: number;
  apps: number;
  declared: number;
}

export interface ArkRapor {
  ok: boolean;
  message?: string;
  notScanned?: boolean;
  scanDate?: string | null;
  ownersReady?: boolean;
  trafficReady?: boolean;
  rows?: ArkSatir[];
  services?: ArkServis[];
  skipped?: number;
  cached?: boolean;
}

/** Intranet SPA geçiş takvimi (2026-11-27, server/spa-report/intranet-takvim.cjs). Takvim Portal
 *  DB'de, anahtar (set, namespace, uygulama): her uygulama DC başına bir satır. (namespace, uygulama)
 *  canlı Intranet SPA raporunda eşleşirse route / Dynatrace / açıklama canlıdan, ekip / e-posta
 *  listeden (boşsa canlıdan); eşleşmezse hepsi listeden (`kaynak`). Set başına tarih / DC / IP set
 *  planında (server/spa-report/intranet-set-plani.cjs). */
export type TakvimKaynak = 'canli' | 'liste';
export interface TakvimSatir {
  set: string;
  /** Pilot = 0, Set N = N */
  setSira: number;
  /** ISO yyyy-mm-dd */
  gecisTarihi: string;
  sira: number;
  ekip: string;
  ekipEposta: string;
  namespace: string;
  uygulama: string;
  routeAdresleri: string;
  dynatraceDurumu: string;
  dynatraceIstek: string;
  aciklama: string;
  kaynak: {
    ekip: TakvimKaynak;
    ekipEposta: TakvimKaynak;
    routeAdresleri: TakvimKaynak;
    dynatrace: TakvimKaynak;
    aciklama: TakvimKaynak;
  };
  /** Canlı raporda eşleşti mi (açıklama yalnız o zaman ve yalnız Admin düzenler). */
  canli: boolean;
  /** Canlı uygulama notu (açıklama kutusunun değeri); eşleşmezse null. */
  canliNot: string | null;
  /** Yüklenen listedeki açıklama (kutuda yer tutucu). */
  listeAciklama: string;
  /** Not yazımı canlı raporun yazımıyla gider. */
  canliNamespace: string | null;
  canliUygulama: string | null;
  inUse: string | null;
  /** 409 kilidi: her yazımda +1 */
  surum: number;
  guncelleyen: string | null;
  guncelleme: string | null;
}
export interface TakvimYukleme {
  id: string;
  yukleyen: string | null;
  zaman: string | null;
  /** Yükleme kilidi (yükleme kimliği + satır sayısı + sürüm toplamı); yüklemede geri gönderilir. */
  kilit: string | null;
}
/** Set planı satırı: uygulama sayısı / pay / yüzde burada yok, ekran takvimden hesaplar. */
export interface TakvimPlanSatir {
  set: string;
  setSira: number;
  /** ISO yyyy-mm-dd */
  gecisTarihi: string;
  /** Boş = DC belirtilmemiş */
  dc: string;
  eskiIp: string;
  yeniIp: string;
  surum: number;
  guncelleyen: string | null;
  guncelleme: string | null;
}
export interface TakvimYanit {
  ok: boolean;
  message?: string;
  yukleme?: TakvimYukleme | null;
  rows?: TakvimSatir[];
  /** Set planı, set sırasıyla (aynı yanıtta; ayrı istek yok) */
  plan?: TakvimPlanSatir[];
  /** Canlı raporun PROD satırlarından takvimde olmayanlar */
  takvimdeYok?: { namespace: string; uygulama: string; ekip: string }[];
  canli?: {
    durum: 'var' | 'okunamadi' | 'taranmadi';
    message: string;
    kesifTarihi: string | null;
    dynatraceOkunamadi: boolean;
  };
}
/** Sunucunun döndürdüğü ham takvim satırı (tarih düzeltme yanıtı; birleştirme yok). */
export interface TakvimHamSatir {
  set: string;
  setSira: number;
  gecisTarihi: string;
  sira: number;
  namespace: string;
  uygulama: string;
  surum: number;
  guncelleyen: string | null;
  guncelleme: string | null;
}
export interface TakvimHata {
  satir: number;
  mesaj: string;
}
export interface TakvimOnizleme {
  ok: boolean;
  message?: string;
  gecerli?: boolean;
  satir?: number;
  toplam?: number;
  setler?: { set: string; satir: number; tarihler: string[] }[];
  hatalar?: TakvimHata[];
  hataSayisi?: number;
  yoksayilanSutun?: string[];
  /** Yüklemeyi engellemez: aynı DC'de iki set, plan tarihinden farklı satır, planda olmayan set */
  uyarilar?: string[];
  uyariSayisi?: number;
  fark?: {
    mevcut: number;
    yeni: number;
    kalkan: number;
    tarihDegisen: number;
    /** Elle düzeltilmiş tarihlerden yeni listenin değiştireceği / sileceği */
    elleKaybolan: number;
  };
  yukleme?: TakvimYukleme | null;
}
export interface TakvimYazYanit {
  ok: boolean;
  message?: string;
  code?: string;
  hatalar?: TakvimHata[];
  satir?: number;
  yukleme?: string;
  rows?: TakvimHamSatir[];
}
/** Tek satır tarih düzeltme; setin toplu tarihi set planından (TakvimSetIstek). */
export interface TakvimTarihIstek {
  set: string;
  namespace: string;
  uygulama: string;
  tarih: string;
  beklenenSurum: number;
}
/** Set planı düzeltmesi. Tarih değişince (ya da `topla`) setin satırları da o tarihe geçer:
 *  `beklenen` setin her satırının sürümü ("namespace/uygulama" -> sürüm). */
export interface TakvimSetIstek {
  set: string;
  gecisTarihi: string;
  dc: string;
  eskiIp: string;
  yeniIp: string;
  /** Plan satırının sürümü; plan yoksa 0 */
  beklenenSurum: number;
  beklenen: Record<string, number>;
  topla?: boolean;
}
export interface TakvimSetYanit {
  ok: boolean;
  message?: string;
  code?: string;
  plan?: TakvimPlanSatir | null;
  rows?: TakvimHamSatir[];
  tasinan?: number;
  /** Bu setin DC'sinde aynı uygulama başka sette de (yazımı engellemez) */
  uyarilar?: string[];
}
export interface PlanOnizleme {
  ok: boolean;
  message?: string;
  gecerli?: boolean;
  satir?: number;
  toplam?: number;
  setler?: Omit<TakvimPlanSatir, 'surum' | 'guncelleyen' | 'guncelleme'>[];
  hatalar?: TakvimHata[];
  hataSayisi?: number;
  yoksayilanSutun?: string[];
  fark?: { mevcut: number; yeni: number; kalkan: number; degisen: number } | null;
  /** Tarihi değişen setlerin taşınacak uygulama sayısı (elle düzeltilmiş olanlar `elle`) */
  tasima?: {
    set: string;
    eskiTarih: string | null;
    yeniTarih: string;
    uygulama: number;
    elle: number;
  }[];
  uyarilar?: string[];
  kilit?: string;
}
export interface PlanYazYanit {
  ok: boolean;
  message?: string;
  code?: string;
  hatalar?: TakvimHata[];
  satir?: number;
  tasinan?: number;
}

/** Intranet SPA paket kurulumu (2026-11-23): PROD intranet Nginx'e gelmeyen paketi Artifactory'den
 *  kurma; application.json uygulamanin route'undaki /config'ten (bastionsuz). Uyari kodlari sunucuda
 *  (engel olanlar kurulumu durdurur; 'bayat' 3 saatten eski PROD okumasi ve 'config-adresi-yok' ENGEL,
 *  'taranmayan' ve 'config-adresi-elendi' engel DEGIL). Liste server/spa-report/paket-kurulum.cjs UYARI_KODLARI ile birebir
 *  (sunucu testi PK13 karsilastirir). */
export const PAKET_UYARI_KODLARI = [
  'ad-gecersiz',
  'katalog-yok',
  'surum-yok',
  'surum-farkli',
  'imaj-yolu-farkli',
  'etiketsiz',
  'bayat',
  'config-adresi-yok',
  'config-adresi-elendi',
  'hedef-yok',
  'hedef-fazla',
  'taranmayan',
  'yakin-zamanda-kuruldu',
] as const;
export type PaketUyariKod = (typeof PAKET_UYARI_KODLARI)[number];

export interface PaketUyari {
  kod: PaketUyariKod;
  metin: string;
  engel: boolean;
}

export type PaketSunucuDurum = 'PLAN_OK' | 'OK' | 'SKIP' | 'FAIL';

export interface PaketSonDeneme {
  zaman: string;
  kullanici: string;
  mod: 'plan' | 'apply';
  jobId: number | string;
  serverId: number | string;
  sunucular: { host: string; status: PaketSunucuDurum | string; message: string }[];
}

export interface PaketAday {
  namespace: string;
  application: string;
  env: 'PROD';
  /** OCP imaj etiketi (paket surumu) */
  surum: string | null;
  /** Tam imaj adresi */
  imaj: string | null;
  cluster: string | null;
  clusters: string[];
  /** OCP okuma zamani */
  alinma: string | null;
  hedefler: string[];
  taranmayan: string[];
  uyarilar: PaketUyari[];
  kurulabilir: boolean;
  sonDeneme: PaketSonDeneme | null;
}

export interface PaketAdaylarYanit {
  ok: boolean;
  message?: string;
  error?: string;
  hesaplandi?: string;
  dizinTarihi?: string | null;
  ozet?: { toplam: number; kurulabilir: number };
  adaylar?: PaketAday[];
}

export interface PaketSecim {
  namespace: string;
  application: string;
}

export interface PaketKalem {
  id: string;
  namespace: string;
  application: string;
  version: string;
  cluster: string;
  hosts: string[];
}

export interface PaketKurYanit {
  ok: boolean;
  message?: string;
  error?: string;
  serverId?: number | string;
  jobId?: number | string;
  mod?: 'plan' | 'apply';
  items?: PaketKalem[];
  /** Is basladi ama is gecmisine yazilamadi: kapilar bu isi goremez. */
  uyari?: string;
}

export interface PaketSonucSunucu {
  host: string;
  status: PaketSunucuDurum | string;
  step: string;
  message: string;
}

/** set_stats kalemi: playbook OCP okumadigi icin 'ocp' / 'cluster' alani yok. */
export interface PaketSonucKalem {
  id: string;
  namespace: string;
  application: string;
  version: string;
  hosts: PaketSonucSunucu[];
}

/** set_stats spa_package_install_result */
export interface PaketSonuc {
  mode: 'plan' | 'apply';
  overall: 'ok' | 'partial' | 'failed';
  items: PaketSonucKalem[];
}

export interface PaketIsYanit {
  ok: boolean;
  status?: string;
  finished?: boolean;
  sonuc?: PaketSonuc;
  error?: string;
  message?: string;
}

const BASE = '/api/spa-report';
const safeJson = (r: Response) =>
  r.json().catch(() => ({ ok: false, message: 'Yanıt okunamadı.' }));
/** Takvim yazma uçları: yetki hatası `error` taşır (requireAdmin), gövde sınırı 413 HTML döner. */
const takvimJson = async (r: Response) => {
  if (r.status === 413) return { ok: false, message: 'Dosya çok büyük (sunucu gövde sınırı).' };
  const j = await safeJson(r);
  return j && !j.message && j.error ? { ...j, message: j.error } : j;
};

export const arkSpaApi = {
  report: (fresh = false): Promise<ArkRapor> =>
    fetch(`${BASE}${fresh ? '?fresh=1' : ''}`).then(safeJson),
  // LOCATION ZORUNLU GÖNDERİLİR: beyan artık satır bazında. Gönderilmezse sunucu eski
  // davranışa (uygulama seviyesi) düşer ve aynı uygulamanın TÜM location'larını etkiler.
  declare: (p: {
    namespace: string;
    application: string;
    location: string;
    inUse: string | null;
    note: string;
  }): Promise<{
    ok: boolean;
    message?: string;
    inUseBy?: string | null;
    scope?: 'location' | 'application';
  }> =>
    fetch(`${BASE}/declare`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    }).then(safeJson),
  intranetBeyan: (p: {
    namespace: string;
    application: string;
    inUse: string | null;
    note: string;
  }): Promise<{
    ok: boolean;
    message?: string;
    inUseBy?: string | null;
    inUseAt?: string | null;
  }> =>
    fetch(`${BASE}/intranet/declare`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    }).then(safeJson),
  takvim: (fresh = false): Promise<TakvimYanit> =>
    fetch(`${BASE}/intranet/takvim${fresh ? '?fresh=1' : ''}`).then(safeJson),
  takvimOnizle: (metin: string): Promise<TakvimOnizleme> =>
    fetch(`${BASE}/intranet/takvim/onizle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metin }),
    }).then(takvimJson),
  takvimYukle: (metin: string, beklenenKilit: string | null): Promise<TakvimYazYanit> =>
    fetch(`${BASE}/intranet/takvim/yukle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metin, beklenenKilit }),
    }).then(takvimJson),
  takvimTarih: (p: TakvimTarihIstek): Promise<TakvimYazYanit> =>
    fetch(`${BASE}/intranet/takvim/tarih`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    }).then(takvimJson),
  takvimSet: (p: TakvimSetIstek): Promise<TakvimSetYanit> =>
    fetch(`${BASE}/intranet/takvim/set`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    }).then(takvimJson),
  planOnizle: (metin: string): Promise<PlanOnizleme> =>
    fetch(`${BASE}/intranet/takvim/plan/onizle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metin }),
    }).then(takvimJson),
  planYukle: (metin: string, beklenenKilit: string | null): Promise<PlanYazYanit> =>
    fetch(`${BASE}/intranet/takvim/plan/yukle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metin, beklenenKilit }),
    }).then(takvimJson),
  paketAdaylari: (fresh = false): Promise<PaketAdaylarYanit> =>
    fetch(`${BASE}/intranet/paket/adaylar${fresh ? '?fresh=1' : ''}`).then(safeJson),
  paketKur: (p: {
    secim: PaketSecim[];
    apply: boolean;
    onayMetni?: string;
    /** apply icin zorunlu: dayandigi bitmis plan isi */
    plan?: { serverId: number | string; jobId: number | string };
  }): Promise<PaketKurYanit> =>
    fetch(`${BASE}/intranet/paket/kur`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    }).then(safeJson),
  paketIs: (serverId: number | string, jobId: number | string): Promise<PaketIsYanit> =>
    fetch(
      `${BASE}/intranet/paket/is/${encodeURIComponent(String(serverId))}/${encodeURIComponent(String(jobId))}`,
    ).then(safeJson),
};
