// src/components/oco/takvimVurgu.ts — OCO takviminin VURGU KURALI (saf fonksiyonlar).
//
// NEDEN AYRI MODUL: bu kurallar OcoTakvimiPage.tsx icinde yasiyordu ve testi onlari
// kaynaktan REGEX ile cikarip calistirmaya calisiyordu - TS tip ekleri soyulurken
// `gunVurgu`un govdesi mahvoldu (2026-10-08). Saf mantik bilesenin icinde kalirsa ya
// kirilgan bir ayiklayici ya da hic test olur; ikisi de yanlis. Modul olarak vitest
// dogrudan import ediyor.
/** Gunun akista nerede durdugu (kullanici, 2026-10-08: "bugunun OCO'larini parlatir
 *  misin, gecmis calismalari kirmizi highlight edebilirsen sevinirim").
 *
 *  SAF ve ihrac edilmis: vurgu kurali ekrandan ayri test edilebilsin. Karsilastirma GUN
 *  bazinda (gunAnahtari ile ayni biçim) - saat karsilastirmasi, gece yarisini asan OCO
 *  pencerelerinde gunu yanlis tarafa atardi. */
export type GunSinifi = 'gecmis' | 'bugun' | 'gelecek' | 'tarihsiz';

export function gunSinifi(gun: string, bugun: string): GunSinifi {
  if (!gun) return 'tarihsiz';
  if (gun === bugun) return 'bugun';
  return gun < bugun ? 'gecmis' : 'gelecek';
}

/** Gun blogunun vurgu rengi/etiketi. `null` = vurgu YOK (gelecek gunler sade kalir;
 *  her satiri boyamak vurguyu anlamsizlastirirdi). */
export function gunVurgu(sinif: GunSinifi): { renk: string; etiket: string } | null {
  switch (sinif) {
    case 'bugun':
      return { renk: 'var(--accent)', etiket: 'BUGÜN' };
    case 'gecmis':
      return { renk: 'var(--status-danger)', etiket: 'GEÇMİŞ' };
    default:
      return null;
  }
}

/** OCO penceresi KAPANDI mi? `plannedEnd` yoksa null - "kapandi" DEMEK DEGIL.
 *  Bugunun bloguna dusen ama penceresi bitmis bir OCO'yu "bugun yapilacak" diye
 *  gostermek yanlis olurdu. */
export function pencereKapandi(plannedEnd: string | null, simdi = new Date()): boolean | null {
  if (!plannedEnd) return null;
  const t = new Date(plannedEnd).getTime();
  if (!Number.isFinite(t)) return null;
  return t < new Date(simdi).getTime();
}
