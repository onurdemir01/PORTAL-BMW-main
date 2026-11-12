// src/api/bmwHubApi.ts — BMW Hub (2026-11-08): ekibin açık işleri.
// Sunucu karşılığı: server/bmw-hub/index.cjs · Kurallar: shared/bmwHub.cjs
import { okJson } from './http';

const BASE = '/api/bmw-hub';

export type BmwDurum = 'acik' | 'devam' | 'bekliyor' | 'tamam' | 'iptal';
export type BmwOncelik = 'yuksek' | 'orta' | 'dusuk';

export interface BmwIs {
  id: string;
  baslik: string;
  aciklama: string;
  durum: BmwDurum;
  oncelik: BmwOncelik;
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

export interface BmwNot {
  id: number;
  /** not | olusturma | durum | sahip | tarih | oncelik */
  tur: string;
  metin: string;
  yazanKullanici: string;
  yazanAd: string;
  olusturma: string | null;
}

export interface BmwOzet {
  acik: number;
  gecikmis: number;
  sahipsiz: number;
  buHafta: number;
  tamamlanan30: number;
}

export type BmwIsGirdi = Partial<Pick<BmwIs, 'baslik' | 'aciklama' | 'durum' | 'oncelik' | 'kategori' | 'sahip' | 'beklenen' | 'sonTarih'>>;

const JSON_HDR = { 'Content-Type': 'application/json' };

export const bmwHubApi = {
  async liste(): Promise<{ isler: BmwIs[]; ozet: BmwOzet; bugun: string; tavan: number | null }> {
    const j = await okJson(await fetch(`${BASE}/isler`));
    if (j.ok === false) throw new Error(j.error || 'İşler okunamadı.');
    return j;
  },
  async detay(id: string): Promise<{ is: BmwIs; notlar: BmwNot[] }> {
    const j = await okJson(await fetch(`${BASE}/isler/${encodeURIComponent(id)}`));
    if (j.ok === false) throw new Error(j.error || 'İş okunamadı.');
    return j;
  },
  async ekle(girdi: BmwIsGirdi): Promise<BmwIs> {
    const j = await okJson(await fetch(`${BASE}/isler`, { method: 'POST', headers: JSON_HDR, body: JSON.stringify(girdi) }));
    if (j.ok === false) throw new Error(j.error || 'İş kaydedilemedi.');
    return j.is;
  },
  async guncelle(id: string, girdi: BmwIsGirdi, beklenenGuncelleme?: string | null): Promise<BmwIs> {
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
