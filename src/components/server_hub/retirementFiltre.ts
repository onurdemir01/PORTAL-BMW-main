// src/components/server_hub/retirementFiltre.ts — Retirement kayit listesi kolon filtreleri.
import type { RtRecordRow } from '@/api/retirementApi';

// KOLON FILTRELERI (2026-10-13, kullanici: "kolonlari filtreleyebilmek istiyorum, ornegin uygulama adina
// veya acan kisi ismine gore"). Metin filtreleri buyuk/kucuk harf ve '_' / '-' / bosluk farkina
// duyarsiz (GFY_INTERNET_SERVICES 'gfy internet' ya da 'gfy-int' ile de bulunur).
export type KayitFiltre = { app: string; smart: string; oco: string; durum: string; ortam: string; acan: string };
export const BOS_FILTRE: KayitFiltre = { app: '', smart: '', oco: '', durum: '', ortam: '', acan: '' };
// TURKCE I TUZAGI: tr-TR'de 'I' -> 'ı' (noktasiz); envanter adlari Ingilizce buyuk harf (INTERNET),
// aranan Turkce klavyeden ('internet'). Noktasiz ı da i sayilir ki iki yon eslessin.
const fNorm = (v: unknown) => String(v ?? '').toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').replace(/[\s_\-.]+/g, '');
const fIcerir = (deger: unknown, aranan: string) => !aranan.trim() || fNorm(deger).includes(fNorm(aranan));
export function kayitFiltrele(rows: RtRecordRow[], f: KayitFiltre): RtRecordRow[] {
  return rows.filter((r) =>
    (fIcerir(r.app, f.app) || (r.envs || []).some((e) => e.uygulamalar.some((u) => fIcerir(u, f.app)))) &&
    fIcerir(r.smartNo, f.smart) &&
    fIcerir(r.ocoNo, f.oco) &&
    (!f.durum || r.status === f.durum) &&
    (!f.ortam || (r.envs || []).some((e) => e.env === f.ortam)) &&
    fIcerir(r.requestedBy, f.acan));
}

