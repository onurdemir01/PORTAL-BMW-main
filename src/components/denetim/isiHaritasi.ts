// src/components/denetim/isiHaritasi.ts — Envanter ısı haritası hücre tonu ve metin rengi (2026-11-07).
//
// Eskiden zemin %8–86 sürekli aksan karışımıydı, metin 0.45 eşiğinde beyaza dönüyordu. Açık temada
// beyaz metin %60–86 karışım üzerinde 2.7–4.3:1, koyu temada %46–59 aralığında ne beyaz ne koyu metin
// 4.5:1'i geçiyordu (koyuda aksan AÇIK mavi). Ton artık KADEMELİ: iki temada da AA'yı geçen altı
// seviye; ara bölge atlanır. Alt seviyeler --text-primary (açıkta koyu, koyuda beyaz), üst seviyeler
// --isi-metin-koyu (iki temada koyu). Oranlar isi-haritasi.test.ts'te index.css token'larından ölçülür.

/** Aksan karışım yüzdeleri; ilk dördü --text-primary, son ikisi --isi-metin-koyu ile okunur. */
export const ISI_SEVIYELERI = [12, 22, 32, 42, 62, 72] as const;
export const KOYU_METIN_SEVIYESI = 4;

/** Karekök ölçekli seviye: tek büyük hücre diğerlerini görünmez kılmasın. */
export function isiSeviyesi(n: number, max: number): { yuzde: number; koyuMetin: boolean } {
  const t = max > 0 ? Math.sqrt(Math.max(0, n) / max) : 0;
  const i = Math.min(ISI_SEVIYELERI.length - 1, Math.floor(t * ISI_SEVIYELERI.length));
  return { yuzde: ISI_SEVIYELERI[i], koyuMetin: i >= KOYU_METIN_SEVIYESI };
}

export function isiStili(n: number, max: number): { backgroundColor: string; color: string } {
  const s = isiSeviyesi(n, max);
  return {
    backgroundColor: `color-mix(in srgb, var(--accent) ${s.yuzde}%, transparent)`,
    color: s.koyuMetin ? 'var(--isi-metin-koyu)' : 'var(--text-primary)',
  };
}
