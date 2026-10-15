// src/components/admin/tabs/sistem/sistemOturumu.ts — Admin > Sistem icin MODUL DUZEYI depo.
//
// NEDEN: Admin sekmeleri arasinda gecince sekme bileseni sokulur ve state'i gider. Eski ekranda
// yazilmis ama kaydedilmemis bir deger ve "yeniden baslatma gerekiyor" bandi sessizce
// kayboluyordu. Bu depo modul degiskenidir: SPA oturumu boyunca (sayfa yenilenene kadar) yasar.
//
// BILINCLI SINIRLAR:
//   * localStorage / sessionStorage YOK: sayfa yenilenince sifirlanir ve ekran bunu soyler.
//   * GIZLI DEGER TASLAGI BURAYA HIC YAZILMAZ. Gizli taslak yalniz bilesen state'inde durur;
//     sekmeden cikinca kaybolur (duzenleyici ipucu bunu yazar). SistemAyarlari SA11 kilitler.
//   * KULLANICIYA BAGLI: cikis + baska admin girisi sayfayi yenilemez (AuthContext.logout
//     yalniz kullaniciyi sifirlar). Depo sahibini tutar; ekran farkli bir kullaniciyla
//     acilinca depo SIFIRLANIR — onceki adminin taslagi ve restart listesi gorunmez (SA19).
//   * `temel`: taslak acildigi andaki sunucu degeri. Geri yuklenen taslagin temeli sunucuda
//     degismisse ekran "Deger degisti" der (biri baska yerden kaydetmis olabilir).
import { useSyncExternalStore } from 'react';

export interface Taslak {
  deger: string;
  temel: string;
}

interface Durum {
  /** Deponun sahibi (kucuk harf kullanici adi); null = henuz bir ekran acilmadi. */
  sahip: string | null;
  taslaklar: ReadonlyMap<string, Taslak>;
  restartBekleyen: ReadonlyMap<string, string>;
}

const bosDurum = (sahip: string | null): Durum => ({ sahip, taslaklar: new Map(), restartBekleyen: new Map() });

let durum: Durum = bosDurum(null);
const dinleyiciler = new Set<() => void>();

function yay(yeni: Durum) {
  durum = yeni;
  for (const d of dinleyiciler) d();
}

function abone(d: () => void) {
  dinleyiciler.add(d);
  return () => {
    dinleyiciler.delete(d);
  };
}

/**
 * Ekran acilirken (ilk render, abonelikten ONCE) cagrilir. Sahip degistiyse depo sessizce
 * sifirlanir: render sirasinda dinleyici tetiklenmez; `useSyncExternalStore` yeni anlik
 * goruntuyu kendi render'inda okur.
 */
export function oturumSahibiniDogrula(kullanici: string) {
  const sahip = kullanici.trim().toLowerCase();
  if (durum.sahip === sahip) return;
  durum = durum.sahip === null ? { ...durum, sahip } : bosDurum(sahip);
}

/** Gizli OLMAYAN bir taslagi saklar. Cagiran gizli degeri buraya gondermemekle yukumlu. */
export function taslakSakla(key: string, deger: string, temel: string) {
  const t = new Map(durum.taslaklar);
  t.set(key, { deger, temel: durum.taslaklar.get(key)?.temel ?? temel });
  yay({ ...durum, taslaklar: t });
}

export function taslakSil(key: string) {
  if (!durum.taslaklar.has(key)) return;
  const t = new Map(durum.taslaklar);
  t.delete(key);
  yay({ ...durum, taslaklar: t });
}

export function saklananTaslaklar(): ReadonlyMap<string, Taslak> {
  return durum.taslaklar;
}

export function restartBekleyeneEkle(key: string, label: string) {
  const r = new Map(durum.restartBekleyen);
  r.set(key, label);
  yay({ ...durum, restartBekleyen: r });
}

export function restartListesiniTemizle() {
  yay({ ...durum, restartBekleyen: new Map() });
}

export function useRestartBekleyen(): ReadonlyMap<string, string> {
  return useSyncExternalStore(
    abone,
    () => durum.restartBekleyen,
    () => durum.restartBekleyen,
  );
}

/** Yalniz testler icin: modul durumunu sifirlar. */
export function sistemOturumunuSifirla() {
  yay(bosDurum(null));
}
