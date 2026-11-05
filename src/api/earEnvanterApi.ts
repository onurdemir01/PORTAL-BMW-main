// src/api/earEnvanterApi.ts — Server Hub › Uygulama Envanteri (EAR/WAR) istemcisi (2026-11-04).
//
// Uçlar server/server-hub/ear-envanter.cjs'te; Server Hub router'ı yalnız Admin'e açık. Tüm okumalar
// `okJson` ile: başarısız yanıt REDDEDİLİR, ekran "okunamadı"yı "kayıt yok"tan ayırır (LoadError).
// İndirmeler (CSV / ZIP / tree.txt / inventory.json) düz bağlantıdır: tarayıcı oturum çereziyle indirir.
import { okJson } from './http';

const BASE = '/api/server-hub/ear';

export type EarKip = 'OZET' | 'TAM';
export type EarKapsam = 'FILO' | 'SECILI' | 'ORTAM' | 'SORUNLU';

/** Otomatik tarama planı (P1 / P2). kapsam: FILO | SORUNLU | ORTAM:A,B */
export interface EarPlan {
  ad: 'P1' | 'P2';
  acik: boolean;
  kip: EarKip;
  kapsam: string;
  metin: string;
  /** Sonraki 3 çalışma (UTC ISO); plan kapalıysa boş. */
  sonraki: string[];
}
export type EarPlanAlani = 'acik' | 'birim' | 'aralik' | 'gun' | 'sira' | 'saat' | 'kip' | 'kapsam' | 'baslangic';
export interface EarOrtamSayisi {
  ortam: string;
  sunucu: number;
}
export type EarKosuDurum = 'CALISIYOR' | 'TAMAMLANDI' | 'KISMI' | 'BASARISIZ' | 'IPTAL';

export interface EarKosu {
  id: number;
  kip: EarKip;
  kaynak: 'ELLE' | 'ZAMANLAYICI' | 'AWX';
  kapsam: EarKapsam;
  durum: EarKosuDurum;
  beklenen: number;
  tam: number;
  kismi: number;
  kok_yok: number;
  basarisiz: number;
  parti_sayisi: number;
  baslatan: string;
  hata: string | null;
  created_at: string;
  finished_at: string | null;
  alinan?: number;
}

export interface EarParti {
  parti_no: number;
  host_sayisi: number;
  durum: 'BEKLIYOR' | 'CALISIYOR' | 'ALINIYOR' | 'BITTI' | 'HATA' | 'IPTAL';
  awx_server_id: number | null;
  awx_job_id: number | null;
  awx_durum: string | null;
  baslatma_denemesi: number;
  alim_denemesi: number;
  hata: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface EarAyarTanim {
  anahtar: string;
  ad: string;
  varsayilan: string;
}

export interface EarOzet {
  ok: boolean;
  ayarlar: {
    deger: Record<string, string>;
    kayitlar: Record<string, { updatedBy: string | null; updatedAt: string | null }>;
    okunamadi: boolean;
    hata: string;
    tanimlar: EarAyarTanim[];
  };
  zamanlayici: { acik: boolean; metin: string; sonraki: string | null };
  planlar: EarPlan[];
  template: { anahtar: string; tanimli: boolean };
  dizin: string;
  aktif: (EarKosu & { partiler: EarParti[] }) | null;
  son: EarKosu | null;
  sayilar: { host: number; uygulama: number; eksikUygulama: number; war: number } | null;
}

export interface EarUygulama {
  kosu_id: number;
  host: string;
  ortam: string | null;
  uyg_no: number;
  kip: EarKip;
  kok: string;
  jboss: '7' | '8' | '?';
  ad: string;
  bicim: string;
  durum: string;
  bag_hedefi: string | null;
  war_sayisi: number | null;
  giris: number | null;
  jsp: number | null;
  tld: number | null;
  jar: number | null;
  class_sayisi: number | null;
  application_xml: boolean | null;
  ear_kutuphane_sayisi: number | null;
  spring_boot: string | null;
  spring_framework: string | null;
  log4j: string | null;
  servlet: string | null;
  yapi_izi: string | null;
  kutuphane_izi: string | null;
  uyari_sayisi: number | null;
  taranma_utc: string | null;
}

export interface EarKutuphane {
  ad: string;
  surum: string;
  boyut: number | null;
}

export interface EarWar {
  war_no: number;
  yol: string | null;
  ad: string | null;
  bicim: string | null;
  durum: string | null;
  jsp: number | null;
  tld: number | null;
  jar: number | null;
  class_sayisi: number | null;
  tld_dizini: boolean | null;
  web_xml: boolean | null;
  web_varyantlari: string | null;
  jboss_web_xml: boolean | null;
  jboss_deployment_structure: boolean | null;
  kutuphane_sayisi: number | null;
  spring_boot: string | null;
  spring_framework: string | null;
  spring_security: string | null;
  log4j: string | null;
  logback: string | null;
  jackson: string | null;
  thymeleaf: string | null;
  struts: string | null;
  servlet: string | null;
  kutuphaneler: EarKutuphane[];
}

export interface EarKopya {
  host: string;
  ortam: string | null;
  kok: string;
  jboss: string;
  durum: string;
  kip: EarKip;
  yapi_izi: string | null;
  kutuphane_izi: string | null;
  kosu_id: number;
  uyg_no: number;
  taranma_utc: string | null;
}

export interface EarUygulamaDetay {
  ok: boolean;
  uygulama: EarUygulama & { uyarilar: string | null; host_durum: string };
  warlar: EarWar[];
  earKutuphaneleri: EarKutuphane[];
  kopyalar: EarKopya[];
}

/** Tarayıcının ağaç satırı: [yol, tip, mod, uid, gid, boyut, mtime, inode, bağ hedefi]. */
export type EarAgacSatiri = [
  string,
  string,
  string,
  number | string,
  number | string,
  number,
  number,
  number | string,
  string,
];

export interface EarAgac {
  ok: boolean;
  host: string;
  kosu: number;
  taranmaUtc: string | null;
  uygulama: Record<string, unknown>;
  satirlar: EarAgacSatiri[];
}

export type EarKarar =
  'AYNI' | 'FARKLI_KUTUPHANE' | 'FARKLI_YAPI' | 'EKSIK_TARAMA' | 'KARSILASTIRILAMAZ' | 'TEK';
export interface EarEslenik {
  uygulama: string;
  ortam: string;
  jboss: string;
  karar: EarKarar;
  host_sayisi: number;
  hostlar: string[];
  eksik: string[];
  gruplar: { iz: string; hostlar: string[] }[];
}
export interface EarIkiNesil {
  host: string;
  uygulama: string;
  ortam: string;
  ayni_kutuphane: boolean | null;
}
export interface EarEslenikFarki {
  ok: boolean;
  kopyalar: { host: string; durum: string; kip: EarKip; kutuphane_sayisi: number }[];
  farklar: { kutuphane: string; olan: string[]; olmayan: string[] }[];
}

export interface EarKutuphaneSatiri {
  ad: string;
  surum: string;
  host_sayisi: number;
  uygulama_sayisi: number;
  kopya: number;
}
export interface EarKullanan {
  host: string;
  ortam: string | null;
  kok: string;
  jboss: string;
  uygulama: string;
  kosu_id: number;
  uyg_no: number;
  durum: string;
}

export interface EarHost {
  host: string;
  kosu_id: number;
  parti_no: number;
  ortam: string | null;
  durum: string;
  playbook_durum: string | null;
  veri_var: boolean;
  uygulama_sayisi: number;
  war_sayisi: number;
  giris: number | null;
  sure_sn: number | null;
  python: string | null;
  kullanici: string | null;
  hata: string | null;
  taranma_utc: string | null;
  alindi_at: string | null;
  veri_kosu_id: number | null;
}

export interface EarUygulamaSuzgec {
  q?: string;
  ortam?: string;
  jboss?: string;
  durum?: string;
  servlet?: string;
  kosu?: number;
  limit?: number;
  offset?: number;
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const put = (body: unknown): RequestInit => ({
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** Boş olmayan alanlardan sorgu dizgisi. */
export function sorguDizgisi(
  p: Record<string, string | number | boolean | undefined | null>,
): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p))
    if (v !== undefined && v !== null && v !== '' && v !== false) s.set(k, String(v));
  const t = s.toString();
  return t ? `?${t}` : '';
}

const al = <T>(url: string, init?: RequestInit) => fetch(url, init).then((r) => okJson<T>(r));
const yol = (s: string | number) => encodeURIComponent(String(s));

export const earApi = {
  ozet: () => al<EarOzet>(`${BASE}/ozet`),
  kosular: (limit = 30) =>
    al<{ ok: boolean; kosular: EarKosu[] }>(`${BASE}/kosular${sorguDizgisi({ limit })}`),
  kosu: (id: number) =>
    al<{
      ok: boolean;
      kosu: EarKosu & { parametreler: Record<string, unknown> };
      partiler: EarParti[];
      hostlar: EarHost[];
    }>(`${BASE}/kosu/${yol(id)}`),
  tara: (p: { kip: EarKip; kapsam: EarKapsam; hostlar?: string; ortamlar?: string[] }) =>
    al<{ ok: boolean; id: number; beklenen: number; partiSayisi: number; ilkParti: unknown }>(
      `${BASE}/kosu`,
      post(p),
    ),
  iptal: (id: number) =>
    al<{ ok: boolean; durum: string }>(`${BASE}/kosu/${yol(id)}/iptal`, post({})),
  uygulamalar: (s: EarUygulamaSuzgec) =>
    al<{ ok: boolean; satirlar: EarUygulama[]; toplam: number }>(
      `${BASE}/uygulamalar${sorguDizgisi({ ...s })}`,
    ),
  uygulama: (kosu: number, host: string, uyg: number) =>
    al<EarUygulamaDetay>(`${BASE}/uygulama/${yol(kosu)}/${yol(host)}/${yol(uyg)}`),
  agac: (kosu: number, host: string, uyg: number) =>
    al<EarAgac>(`${BASE}/agac/${yol(kosu)}/${yol(host)}/${yol(uyg)}`),
  eslenikler: (ortam = '', tumu = false) =>
    al<{ ok: boolean; gruplar: EarEslenik[]; ikiNesil: EarIkiNesil[] }>(
      `${BASE}/eslenikler${sorguDizgisi({ ortam, tumu: tumu ? 1 : '' })}`,
    ),
  eslenik: (ad: string, ortam: string, jboss: string) =>
    al<EarEslenikFarki>(`${BASE}/eslenik${sorguDizgisi({ ad, ortam, jboss })}`),
  kutuphaneler: (q = '') =>
    al<{ ok: boolean; kutuphaneler: EarKutuphaneSatiri[] }>(
      `${BASE}/kutuphaneler${sorguDizgisi({ q })}`,
    ),
  kutuphane: (ad: string, surum: string) =>
    al<{ ok: boolean; kullananlar: EarKullanan[] }>(
      `${BASE}/kutuphane${sorguDizgisi({ ad, surum })}`,
    ),
  hostlar: () => al<{ ok: boolean; hostlar: EarHost[] }>(`${BASE}/hostlar`),
  ayarYaz: (anahtar: string, deger: string) =>
    al<{ ok: boolean; anahtar: string; eski: string; yeni: string }>(
      `${BASE}/ayar/${yol(anahtar)}`,
      put({ deger }),
    ),
  /** Bir planın alanları tek seferde (biri geçersizse hiçbiri yazılmaz). */
  planYaz: (plan: 'p1' | 'p2', alanlar: Partial<Record<EarPlanAlani, string>>) =>
    al<{
      ok: boolean;
      plan: string;
      degisen: { anahtar: string; eski: string; yeni: string }[];
      planlar: EarPlan[];
    }>(`${BASE}/plan/${yol(plan)}`, put(alanlar)),
  ortamlar: () => al<{ ok: boolean; ortamlar: EarOrtamSayisi[] }>(`${BASE}/ortamlar`),
  /** Başlatmadan önce kaç sunucu / parti (koşu açmaz). */
  kapsamOnizleme: (kapsam: Exclude<EarKapsam, 'SECILI'>, ortamlar: string[], kip: EarKip) =>
    al<{ ok: boolean; kapsam: string; sunucu: number; parti: number; ornek: string[] }>(
      `${BASE}/kapsam-onizleme${sorguDizgisi({ kapsam, ortamlar: ortamlar.join(','), kip })}`,
    ),
};

export type EarGorunum = 'uygulamalar' | 'warlar' | 'kutuphaneler' | 'sunucular' | 'eslenikler';

/** İndirme bağlantıları (GET; tarayıcı indirir). */
export const earIndir = {
  csv: (g: EarGorunum, kosu?: number) => `${BASE}/disa-aktar/${g}.csv${sorguDizgisi({ kosu })}`,
  zip: (kosu?: number, host?: string) => `${BASE}/disa-aktar-zip${sorguDizgisi({ kosu, host })}`,
  agacTxt: (kosu: number, host: string, uyg: number) =>
    `${BASE}/agac/${yol(kosu)}/${yol(host)}/${yol(uyg)}?bicim=txt`,
  inventory: (kosu: number, host: string, uyg: number) =>
    `${BASE}/agac/${yol(kosu)}/${yol(host)}/${yol(uyg)}?bicim=inventory`,
};
