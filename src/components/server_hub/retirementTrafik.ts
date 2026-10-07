// src/components/server_hub/retirementTrafik.ts — STOP onayinda vhost trafigi (2026-10-08).
//
// Kullanici: "uygulama stop edilmeden once plan asamasinda Apache loglarini okuyabilir miyiz?"
// "Retirement'i baslat" on kontrolle birlikte hedefin web sunucularinda Server Hub taramasi
// baslatir (yukleyici yalniz o sunucularin BUGUNKU satirlarini yeniler). Onay penceresi
// kesifi yeniden okur ve DONDURULMUS vhost listesini (STOP'un kapatacagi vhost'lar) taze
// trafikle eslestirir.
//
// UC KOVA AYRI (ayni disiplin: kayit acma ekrani, Server Hub): 'var' / 'yok' / 'olculemedi'.
// "olculemedi" ASLA "yok" sayilmaz. Onay KAPISI: en az bir vhost'ta istek VARSA onay kutusu
// zorunlu. Tarama SURERKEN onay kilitli - kullanici "olcumu bekleme" demedikce.
import type { RtDiscovery, RtTarget, RtVhostTrafik } from '@/api/retirementApi';

export type TrafikIsDurumu = 'suruyor' | 'bitti' | 'hata';
export interface TrafikSatiri { host: string; serverName: string; trafik: RtVhostTrafik | null }
export interface TrafikOzeti {
  satirlar: TrafikSatiri[];
  var: number;
  yok: number;
  olculemedi: number;
}

const k = (host: string, sn: string) => `${String(host || '').trim().toUpperCase()}|${String(sn || '').trim().toLowerCase()}`;

/** Hedefin dondurulmus vhost'larini kesifteki trafikle eslestirir. Kesif yoksa / eslesme
 *  yoksa satirin trafigi null -> 'olculemedi' sayilir. */
export function stopTrafikOzeti(t: Pick<RtTarget, 'host' | 'appName' | 'web'>, disc: RtDiscovery | null): TrafikOzeti {
  const dt = disc?.targets?.find((x) => x.host.toUpperCase() === t.host.toUpperCase() && x.appName.toUpperCase() === t.appName.toUpperCase());
  const idx = new Map((dt?.web || []).map((w) => [k(w.host, w.serverName), w.trafik || null]));
  // Ayni host+server_name (ornegin :80 ve :443) TEK satir: trafik vhost adina gore sayiliyor.
  const goruldu = new Set<string>();
  const satirlar: TrafikSatiri[] = [];
  for (const w of t.web || []) {
    const kk = k(w.host, w.serverName);
    if (goruldu.has(kk)) continue;
    goruldu.add(kk);
    satirlar.push({ host: w.host, serverName: w.serverName, trafik: idx.get(kk) ?? null });
  }
  const say = (d: string) => satirlar.filter((s) => (s.trafik?.durum ?? 'olculemedi') === d).length;
  return { satirlar, var: say('var'), yok: say('yok'), olculemedi: say('olculemedi') };
}

/** Onay dugmesi acik mi? Istek varsa onay kutusu sart; tarama surerken kilitli (beklemeyi
 *  bilerek atlamadikca). Web katmani yoksa trafik kapisi yoktur. */
export function stopOnayAcikMi(o: TrafikOzeti, is: TrafikIsDurumu | undefined, trafikOnay: boolean, beklemeyiAtla: boolean): boolean {
  if (is === 'suruyor' && !beklemeyiAtla) return false;
  if (o.var > 0 && !trafikOnay) return false;
  return true;
}
