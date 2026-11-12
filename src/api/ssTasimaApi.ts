// src/api/ssTasimaApi.ts — Admin > Self Servis Taşıma (maestro2 → maestro3, 2026-11-10).
// Sunucu: server/ansible/ss-tasima-rotalari.cjs. Hepsi Admin.
//
// Okuma uçları `okJson` (KATI): okunamayan rapor "servis yok" diye gösterilmesin.
// İşlem uçları `safeJson`: 409 gövdesi (`onayGerekli`, `degisiklikler`, `nedenler`) ekrana lazım.
import { okJson, safeJson } from './http';

const BASE = '/api/ansible/ss/tasima';

export type SsTasimaDurumu =
  | 'TASINDI'
  | 'GERI_ALINDI'
  | 'ESLESME_YOK'
  | 'ENGEL'
  | 'SURVEY_BOS'
  | 'SURVEY_FARKLI'
  | 'OZELLESTIRME_UYUMSUZ'
  | 'HAZIR';

export type SurveyModu = 'AWX' | 'TASARIMCI' | 'EXTRA_VARS' | 'OLCULEMEDI';

export interface SsTasimaKalemi {
  anahtar: string;
  baslik: string;
  adet?: number;
  ipucu?: string;
  hata?: string;
}

export interface SsTasimaKaydi {
  id: number;
  itemId: string;
  fromServer: number;
  fromTemplate: number;
  fromTemplateName: string;
  toServer: number;
  toTemplate: number;
  toTemplateName: string;
  status: 'HAZIRLIK' | 'TASINDI' | 'GERI_ALINDI' | 'IPTAL' | 'KAPANDI';
  eslesme: 'ad' | 'elle' | null;
  surveyYazildi: boolean;
  denemeJobId: number | null;
  denemeAt: string | null;
  denemesizGerekce: string | null;
  createdBy: string | null;
  createdAt: string | null;
  tasiyan: string | null;
  tasindiAt: string | null;
  geriAlan: string | null;
  geriAlindiAt: string | null;
  /** Ayar JSON'ları istemciye gelmez; yalnız alan adları ve hash'ler. */
  ozet?: {
    hedefOncekiAyarAlanlari: string[];
    uygulananAyarAlanlari: string[];
    kaynakCustomHash: string | null;
    hedefCustomHash: string | null;
    hedefSurveyOncekiVar: boolean;
  };
}

export interface SsTasimaDeneme {
  jobId: number;
  at: string | null;
  status: string | null;
  gecerli: boolean;
  neden: string | null;
}

export interface SsTasimaSatiri {
  itemId: string;
  title: string;
  enabled: boolean;
  accessMode: string | null;
  kaynakTemplate: { id: number; name: string };
  hedefTemplate: { id: number; name: string } | null;
  eslesme: 'ad' | 'elle' | null;
  eslesmeNedeni: string | null;
  adaylar: { id: number; name: string }[];
  durum: SsTasimaDurumu;
  cipler: SsTasimaDurumu[];
  nedenler: string[];
  uyarilar: string[];
  engeller: SsTasimaKalemi[];
  okunamayan: SsTasimaKalemi[];
  surveyEylemi: 'yaz' | 'kapat' | null;
  kaynakSurveyModu: SurveyModu | null;
  hedefSurveyModu: SurveyModu | null;
  tahminSurveyYazilirsa: 'HAZIR' | 'OZELLESTIRME_UYUMSUZ' | null;
  /** Survey yazımı bu hash'i zorunlu ister (admin'in gördüğü hedef survey'i). */
  hedefSurveyHash: string | null;
  /** Survey yazılırsa hedefte silinecek soru sayısı. */
  hedefteSilinecekSoru?: number;
  planHash: string | null;
  deneme: SsTasimaDeneme | null;
  kayit: SsTasimaKaydi | null;
  sonKayitDurumu: string | null;
}

export interface SsTasimaPlani {
  ok: boolean;
  kaynak: { id: number; name: string };
  hedef: { id: number; name: string };
  izinListesiDolu: boolean;
  /** Kaynak sunucu Portal'da devre dışı: yalnız taşınmış satırlar, yalnız geri alma. */
  saltOkunur?: boolean;
  sunucuHatalari: { sunucu: string; hata: string }[];
  kayitHatasi: string | null;
  hedefTemplateleri: { id: number; name: string }[];
  satirlar: SsTasimaSatiri[];
}

export interface SurveyFarkSatiri {
  variable: string;
  etiket: 'yalniz_kaynakta' | 'yalniz_hedefte' | 'farkli' | 'ayni';
  kritik: boolean;
  farklar: string[];
  kaynak: SurveyAlani | null;
  hedef: SurveyAlani | null;
}

export interface SurveyAlani {
  variable: string;
  question_name: string;
  type: string;
  required: boolean;
  default: string | null;
  choices: string[];
  min: number | null;
  max: number | null;
  parola: boolean;
}

export interface TemplateKarsilastirmaSatiri {
  alan: string;
  etiket: string;
  kaynak: unknown;
  hedef: unknown;
  kaynakOlculemedi: boolean;
  hedefOlculemedi: boolean;
  farkli: boolean;
}

export interface SsTasimaDetay {
  ok: boolean;
  tasindi: boolean;
  /** TAŞINDI kaydı var ama kart hedefte değil. */
  tutarsiz?: boolean;
  satir?: SsTasimaSatiri;
  templateKarsilastirma?: TemplateKarsilastirmaSatiri[];
  surveyFarki?: SurveyFarkSatiri[];
  surveyOzet?: { kaynakSoru: number; hedefSoru: number; parolaSoru: number; kritikVar: boolean } | null;
  hedefSurveyHash?: string | null;
  uyum?: { hatalar: string[]; uyarilar: string[] } | null;
  uyumTahmin?: { hatalar: string[]; uyarilar: string[] } | null;
  hedefAyarVar?: boolean;
  hedefAyarFarkli?: boolean;
  kayit: SsTasimaKaydi | null;
  kayitlar: SsTasimaKaydi[];
  kayitHatasi?: string | null;
}

export interface AlanFarki {
  alan: string;
  once: unknown;
  simdi: unknown;
}

export interface GeriAlOnizleme {
  ok: boolean;
  kayit: SsTasimaKaydi;
  kaynakSunucuAdi: string | null;
  bagUygun: boolean;
  bilgiDegisiklikleri: AlanFarki[];
  onayGerekenDegisiklikler: { tur: string; baslik: string; farklar: AlanFarki[] }[];
  engeller: SsTasimaKalemi[];
  okunamayan: SsTasimaKalemi[];
  uyarilar: string[];
}

/** İşlem yanıtı: `ok:false` gövdeleri (409 vb.) fırlatılmaz, `_httpStatus` taşır. */
export interface IslemYaniti {
  ok: boolean;
  message?: string;
  _httpStatus?: number;
  [k: string]: unknown;
}

const post = (url: string, body: unknown): Promise<IslemYaniti> =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then(safeJson);

const yol = (itemId: string) => `${BASE}/${encodeURIComponent(itemId)}`;

export const ssTasimaApi = {
  plan: (from: number, to: number, signal?: AbortSignal): Promise<SsTasimaPlani> =>
    fetch(`${BASE}/plan?from=${from}&to=${to}`, { signal }).then(okJson),

  detay: (itemId: string, to: number, toT: number): Promise<SsTasimaDetay> =>
    fetch(`${yol(itemId)}/detay?to=${to}&toT=${toT}`).then(okJson),

  hedefSec: (itemId: string, to: number, toT: number) => post(`${yol(itemId)}/hedef`, { to, toT }),

  surveyYaz: (itemId: string, to: number, toT: number, beklenenHedefHash: string) =>
    post(`${yol(itemId)}/survey-yaz`, { to, toT, beklenenHedefHash, onay: true }),

  deneme: (
    itemId: string,
    body: { to: number; toT: number; extraVars: Record<string, unknown>; sadeceDogrula: boolean; confirm?: boolean; hedefAyarUzerineYaz?: boolean },
  ) => post(`${yol(itemId)}/deneme`, body),

  tasi: (itemId: string, body: { to: number; toT: number; planHash: string; denemesizGerekce?: string }) =>
    post(`${yol(itemId)}/tasi`, body),

  geriAlOnizleme: (itemId: string): Promise<GeriAlOnizleme> => fetch(`${yol(itemId)}/geri-al-onizleme`).then(okJson),

  geriAl: (itemId: string, migrationId: number, degisiklikleriOnayla: boolean, kaydiKapat = false) =>
    post(`${yol(itemId)}/geri-al`, { migrationId, degisiklikleriOnayla, ...(kaydiKapat ? { kaydiKapat: true } : {}) }),

  hazirlikIptal: (itemId: string) => post(`${yol(itemId)}/hazirlik-iptal`, {}),
};
