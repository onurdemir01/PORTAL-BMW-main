// src/utils/lazyWithRetry.ts — "Failed to fetch dynamically imported module" (2026-09-22).
//
// SEBEP: Portal bir sayfayi React.lazy ile ayri chunk olarak indirir (assets/EnvanterPage-<hash>.js).
// Yeni surum yayinlaninca hash degisir ve ESKI dosya sunucudan silinir; tarayicidaki acik sekme hala
// eski index.html'i tuttugu icin olmayan adresi ister. Kullanici "Bu sayfa yuklenemedi" gorur,
// F5'te duzelir (yeni index.html gelir) — yani hata degil, SURUM ATLAMASI.
//
// COZUM: import basarisiz olursa sayfa BIR KEZ kendiliginden yenilenir (yeni index.html + yeni
// chunk adlari). sessionStorage'daki damga sonsuz dongu yapmayi engeller: ayni chunk icin ikinci
// kez basarisiz olursa hata yukari birakilir (gercek bir arizayi gizlememek icin).
import React from 'react';

const KEY = 'bmw:chunk-reload';
const WINDOW_MS = 30_000;

/** Chunk indirilemedi hatasi mi? (tarayicilar farkli metin uretir) */
export function isChunkLoadError(err: unknown): boolean {
  const msg = String((err as Error)?.message || err || '');
  const name = String((err as Error)?.name || '');
  return (
    name === 'ChunkLoadError' ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Loading chunk \d+ failed/i.test(msg) ||
    /expected a JavaScript(?:-or-Wasm)? module/i.test(msg)
  );
}

/** Son 30 sn icinde bu sebeple yenilenmis miyiz? (dongu korumasi) */
function reloadedRecently(): boolean {
  try {
    const at = Number(sessionStorage.getItem(KEY) || 0);
    return at > 0 && Date.now() - at < WINDOW_MS;
  } catch {
    return false; // sessionStorage kapali: tek denemeyle birak
  }
}

/** Yeni surum geldi: sayfayi bir kez yenile. Yenilenemiyorsa false doner. */
export function reloadForNewVersion(): boolean {
  if (reloadedRecently()) return false;
  try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* onemsiz */ }
  window.location.reload();
  return true;
}

/**
 * React.lazy yerine: chunk indirilemezse once bir kez yeniden dener (agda anlik hata),
 * o da olmazsa sayfayi yeniler (yeni surum). Yenileme yapildiysa bilesen hic cizilmez.
 */
export function lazyWithRetry<T extends React.ComponentType<unknown>>(factory: () => Promise<{ default: T }>) {
  return React.lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      if (!isChunkLoadError(err)) throw err;
      // 1) anlik ag hatasi olabilir: kisa bekleyip bir kez daha dene
      await new Promise((r) => setTimeout(r, 400));
      try {
        return await factory();
      } catch (err2) {
        if (isChunkLoadError(err2) && reloadForNewVersion()) {
          // Yenileme basladi; bu promise'i asili birak ki hata ekrani parlamasin.
          return await new Promise<{ default: T }>(() => {});
        }
        throw err2;
      }
    }
  });
}
