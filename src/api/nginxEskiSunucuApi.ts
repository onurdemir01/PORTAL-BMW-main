// src/api/nginxEskiSunucuApi.ts — Nginx Hub: kapatılmış (eski) sunucular (2026-11-12).
//
// Sunucu her Nginx Hub listesinde envanterde olmayan ve 14+ gündür hiçbir kaynakta görülmeyen
// sunucuları gizler ve yanıta `eskiGizli` yazar. Sekme verisini çeken API istemcileri bu alanı
// buraya kaydeder (`eskiGizliKaydet`); sayfa, açık sekmenin kaynağı için kısa notu gösterir.
// Admin temizliği: aday listesi + yazılı onaylı silme (sunucu silme anında adaylığı yeniden denetler).
import { useSyncExternalStore } from 'react';
import { safeJson } from './http';

export interface EskiGizli {
  sayi: number;
  hostlar: string[];
  gun: number;
  gosteriliyor?: boolean;
  olculemedi?: boolean;
}

export type EskiKaynak =
  | 'hosts'
  | 'certs'
  | 'orphans'
  | 'drift'
  | 'changes'
  | 'ratelimit'
  | 'cis'
  | 'audit'
  | 'api'
  | 'apiLocations'
  | 'envanter'
  | 'spa'
  | 'spaKesif';

const durum = new Map<EskiKaynak, EskiGizli>();
const dinleyiciler = new Set<() => void>();
let surum = 0;

function bildir() {
  surum += 1;
  dinleyiciler.forEach((f) => f());
}

/** `.then(eskiGizliKaydet('hosts'))`: yanıtı değiştirmeden `eskiGizli` alanını kaydeder. */
export function eskiGizliKaydet<T>(kaynak: EskiKaynak) {
  return (r: T): T => {
    const e = (r as { eskiGizli?: unknown } | null)?.eskiGizli;
    if (e && typeof e === 'object' && typeof (e as EskiGizli).sayi === 'number') {
      durum.set(kaynak, e as EskiGizli);
      bildir();
    }
    return r;
  };
}

/** Birden çok kaynağın birleşimi (aynı sunucu iki kez sayılmaz). Kayıt yoksa null. */
export function eskiGizliBirlesik(kaynaklar: readonly EskiKaynak[]): EskiGizli | null {
  const var_ = kaynaklar.map((k) => durum.get(k)).filter(Boolean) as EskiGizli[];
  if (!var_.length) return null;
  const hostlar = [...new Set(var_.flatMap((e) => e.hostlar || []))].sort();
  return {
    sayi: Math.max(hostlar.length, ...var_.map((e) => e.sayi || 0)),
    hostlar,
    gun: var_[0].gun,
    gosteriliyor: var_.some((e) => e.gosteriliyor),
    olculemedi: var_.some((e) => e.olculemedi),
  };
}

export function useEskiGizli(kaynaklar: readonly EskiKaynak[]): EskiGizli | null {
  useSyncExternalStore(
    (f) => {
      dinleyiciler.add(f);
      return () => dinleyiciler.delete(f);
    },
    () => surum,
  );
  return eskiGizliBirlesik(kaynaklar);
}

/** Testler için. */
export function _eskiGizliSifirla() {
  durum.clear();
  bildir();
}

// ── Admin temizliği ─────────────────────────────────────────────────────────────────
export interface EskiAday {
  host: string;
  sonGorulme: string | null;
  sonTarama: string | null;
  dosyalar: string[];
  tbmwans: Record<string, number>;
  portal: Record<string, number>;
  toplamSatir: number;
}
export interface EskiSinirlar {
  maksHost: number;
  maksSatir: number;
  parca: number;
}
export interface EskiAdaylarSonuc {
  ok: boolean;
  message?: string;
  gun: number;
  esik: string;
  hesaplandi: string;
  sinirlar: EskiSinirlar;
  adaylar: EskiAday[];
}
export interface EskiTemizlikHost {
  host: string;
  silinenSatir: Record<string, number>;
  dosyalar: string[];
  seen?: boolean;
  hatalar: { tablo: string; mesaj: string }[];
  tamam: boolean;
  islenmedi?: boolean;
}
export interface EskiTemizlikSonuc {
  ok: boolean;
  message?: string;
  reddedilen?: string[];
  gun?: number;
  hosts?: EskiTemizlikHost[];
  toplamSatir?: number;
  butceDoldu?: boolean;
  kalanVar?: boolean;
  sinirlar?: EskiSinirlar;
}

const BASE = '/api/nginx-console';

export const nginxEskiSunucuApi = {
  adaylar: (): Promise<EskiAdaylarSonuc> => fetch(`${BASE}/eski-sunucular`).then(safeJson),
  temizle: (hosts: string[], onay: string): Promise<EskiTemizlikSonuc> =>
    fetch(`${BASE}/eski-sunucular/temizle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hosts, onay }),
    }).then(safeJson),
};
