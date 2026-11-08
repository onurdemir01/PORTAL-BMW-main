// src/api/bnvHubApi.ts — BNV Hub (2026-11-08): ekibin açık işleri.
// Sunucu karşılığı: server/bnv-hub/index.cjs · Kurallar: shared/bnvHub.cjs
import { okJson } from './http';

const BASE = '/api/bnv-hub';

export type BnvDurum = 'acik' | 'devam' | 'bekliyor' | 'tamam' | 'iptal';
export type BnvOncelik = 'yuksek' | 'orta' | 'dusuk';

export interface BnvIs {
  id: string;
  baslik: string;
  aciklama: string;
  durum: BnvDurum;
  oncelik: BnvOncelik;
  kategori: string;
  sahip: string;
  /** Ne / kimden bekleniyor (serbest metin). */
  beklenen: string;
  /** YYYY-MM-DD; boş = tarih yok */
  sonTarih: string;
  acanKullanici: string;
  acanAd: string;
  guncelleyenAd: string;
  olusturma: string | null;
  guncelleme: string | null;
  kapanis: string | null;
}

export interface BnvNot {
  id: number;
  /** not | olusturma | durum | sahip | tarih | oncelik */
  tur: string;
  metin: string;
  yazanKullanici: string;
  yazanAd: string;
  olusturma: string | null;
}

export interface BnvOzet {
  acik: number;
  gecikmis: number;
  sahipsiz: number;
  buHafta: number;
  tamamlanan30: number;
}

export type BnvIsGirdi = Partial<Pick<BnvIs, 'baslik' | 'aciklama' | 'durum' | 'oncelik' | 'kategori' | 'sahip' | 'beklenen' | 'sonTarih'>>;

const JSON_HDR = { 'Content-Type': 'application/json' };

export const bnvHubApi = {
  async liste(): Promise<{ isler: BnvIs[]; ozet: BnvOzet; bugun: string; tavan: number | null }> {
    const j = await okJson(await fetch(`${BASE}/isler`));
    if (j.ok === false) throw new Error(j.error || 'İşler okunamadı.');
    return j;
  },
  async detay(id: string): Promise<{ is: BnvIs; notlar: BnvNot[] }> {
    const j = await okJson(await fetch(`${BASE}/isler/${encodeURIComponent(id)}`));
    if (j.ok === false) throw new Error(j.error || 'İş okunamadı.');
    return j;
  },
  async ekle(girdi: BnvIsGirdi): Promise<BnvIs> {
    const j = await okJson(await fetch(`${BASE}/isler`, { method: 'POST', headers: JSON_HDR, body: JSON.stringify(girdi) }));
    if (j.ok === false) throw new Error(j.error || 'İş kaydedilemedi.');
    return j.is;
  },
  async guncelle(id: string, girdi: BnvIsGirdi, beklenenGuncelleme?: string | null): Promise<BnvIs> {
    const body = beklenenGuncelleme ? { ...girdi, beklenenGuncelleme } : girdi;
    const j = await okJson(
      await fetch(`${BASE}/isler/${encodeURIComponent(id)}`, { method: 'PATCH', headers: JSON_HDR, body: JSON.stringify(body) }),
    );
    if (j.ok === false) throw new Error(j.error || 'İş güncellenemedi.');
    return j.is;
  },
  async notEkle(id: string, metin: string): Promise<void> {
    const j = await okJson(
      await fetch(`${BASE}/isler/${encodeURIComponent(id)}/notlar`, { method: 'POST', headers: JSON_HDR, body: JSON.stringify({ metin }) }),
    );
    if (j.ok === false) throw new Error(j.error || 'Not kaydedilemedi.');
  },
  async sil(id: string): Promise<void> {
    const j = await okJson(await fetch(`${BASE}/isler/${encodeURIComponent(id)}`, { method: 'DELETE' }));
    if (j.ok === false) throw new Error(j.error || 'İş silinemedi.');
  },
  async toplu(metin: string): Promise<number> {
    const j = await okJson(await fetch(`${BASE}/toplu`, { method: 'POST', headers: JSON_HDR, body: JSON.stringify({ metin }) }));
    if (j.ok === false) throw new Error(j.error || 'Toplu ekleme yapılamadı.');
    return j.eklenen;
  },
};
