// src/utils/scalexYoklama.ts — ScaleX keşif/sağlık yoklamalarının ORTAK ritmi.
//
// AWX işinin tabanı (kuyruk + SSH + `oc login`) birkaç saniyedir; iş çoğu zaman 5–10 sn
// içinde biter. Sabit 3 sn'lik aralık + "önce bekle, sonra sor" düzeni, bitmiş bir işin
// sonucunu ortalama 1,5 sn, en kötü 3 sn GEÇ gösteriyordu. `WorkloadStep` bunu 2026-09'da
// çözdü (ilk 12 sn saniyede bir, sonra 3 sn'de bir); sağlık kontrolü ve sapma taraması
// eski sabit aralıkta kalmıştı. Ritim artık tek yerde.
//
// Yoklama ucu çıktı İNDİRMEZ (yalnız iş durumunu sorar), yani sık yoklamanın maliyeti
// küçük bir AWX isteğidir.
export const YOKLAMA_HIZLI_MS = 1000;
export const YOKLAMA_YAVAS_MS = 3000;
export const YOKLAMA_HIZLI_PENCERE_MS = 12000;

/** `basladi` anından bu yana geçen süreye göre bir sonraki yoklamaya kadar beklenecek süre. */
export function yoklamaAraligi(basladi: number, simdi: number = Date.now()): number {
  return simdi - basladi < YOKLAMA_HIZLI_PENCERE_MS ? YOKLAMA_HIZLI_MS : YOKLAMA_YAVAS_MS;
}

/** Bir sonraki yoklamaya kadar bekler. */
export function yoklamaBekle(basladi: number): Promise<void> {
  return new Promise((r) => setTimeout(r, yoklamaAraligi(basladi)));
}

/** Toplam bekleme bütçesi dolana kadar kaç yoklama yapılacağı (döngü sınırı için). */
export function yoklamaSayisi(butceMs: number): number {
  const hizli = Math.min(butceMs, YOKLAMA_HIZLI_PENCERE_MS) / YOKLAMA_HIZLI_MS;
  const yavas = Math.max(0, butceMs - YOKLAMA_HIZLI_PENCERE_MS) / YOKLAMA_YAVAS_MS;
  return Math.ceil(hizli + yavas);
}
