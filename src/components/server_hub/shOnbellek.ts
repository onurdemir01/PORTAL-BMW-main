// src/components/server_hub/shOnbellek.ts — Server Hub sayfasına dönüşte anında veri (2026-11-05).
//
// Sayfadan çıkıp dönünce sekmeler yeniden kurulur; son yanıt modül düzeyinde tutulur ve ekran onu hemen
// gösterir (yükleme logosu yok), TAZE_MS'den eskiyse arkada sessizce tazelenir. Yalnız bu sekmenin
// belleğinde; tarayıcı depolamasına yazılmaz. Tarama bitince load(true) taze okur ve buraya yazar.
const kayit = new Map<string, { at: number; deger: unknown }>();

/** Bu süreden eski veri görünür olunca sessizce tazelenir. */
export const TAZE_MS = 60 * 1000;

export function oku<T>(anahtar: string): T | null {
  const k = kayit.get(anahtar);
  return k ? (k.deger as T) : null;
}

export function yaz(anahtar: string, deger: unknown): void {
  kayit.set(anahtar, { at: Date.now(), deger });
}

/** Son yazmadan beri geçen ms; hiç yazılmadıysa Infinity. */
export function yas(anahtar: string): number {
  const k = kayit.get(anahtar);
  return k ? Date.now() - k.at : Infinity;
}

export function _sifirlaForTest(): void {
  kayit.clear();
}
