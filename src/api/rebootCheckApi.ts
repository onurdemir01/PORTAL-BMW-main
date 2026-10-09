// src/api/rebootCheckApi.ts — Server Hub > Reboot Kontrolü (server/server-hub/reboot-check.cjs).
import { safeJson } from './http';

const BASE = '/api/server-hub/reboot-check';
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export interface RcSunucuSonuc {
  faz?: string;
  goruntu_ok?: boolean;
  goruntu_hata?: string;
  goruntu?: string[];
  once_var?: boolean;
  plan?: string[];
  islemler?: string[];
  son_goruntu?: string[];
  son_fark?: string[];
  son_olculdu?: boolean;
  sonuc_yok?: boolean;
}
export interface RcDegerlendirme { durum: 'sorunsuz' | 'sorunlu' | 'olculemedi'; sebep?: string; kalan?: number; islem?: number; hatali?: number }
export interface RcKayit {
  id: number;
  hosts: string[];
  not: string;
  durum: string;
  olusturan: string;
  olusturuldu: string;
  once: { jobId: number | null; serverId: number | null; at: string | null; sonuc?: { faz?: string; sunucular?: Record<string, RcSunucuSonuc> } | null };
  sonra: { jobId: number | null; serverId: number | null; at: string | null; sonuc?: { faz?: string; sunucular?: Record<string, RcSunucuSonuc> } | null };
  ozet: {
    once?: { alinan: number; toplam: number; job: string };
    sonra?: { sorunsuz: number; toplam: number; job: string; sunucu: Record<string, RcDegerlendirme> };
  } | null;
  /** Kosan fazda AWX'in anlik is durumu (pending / waiting / running / okunamadi); yalniz ayrintida. */
  awxDurum?: string | null;
  /** Kosan fazin baslatildigi an (ISO). */
  fazBasladi?: string | null;
}
export interface RcLaunch { ok: boolean; message?: string; id?: number | null; jobId?: number | null; awxServerId?: number; hedef?: string[]; disarida?: string[] }

export const rebootCheckApi = {
  list: (): Promise<{ ok: boolean; message?: string; kayitlar?: RcKayit[] }> => fetch(BASE).then(safeJson),
  get: (id: number): Promise<{ ok: boolean; message?: string; kayit?: RcKayit }> => fetch(`${BASE}/${id}`).then(safeJson),
  once: (hosts: string[], not: string): Promise<RcLaunch> => fetch(BASE, json({ hosts, not })).then(safeJson),
  sonra: (id: number): Promise<RcLaunch> => fetch(`${BASE}/${id}/sonra`, json({ onay: true })).then(safeJson),
};
