// src/components/oco/takvimIzgara.ts — OCO Takvimi "takvim yaprağı" görünümünün SAF hesapları.
//
// Kullanıcı (2026-11-13): "OCO Takvimi sayfasını mevcut halinin dışında istek halinde gerçek bir
// takvim yaprağı şeklinde gösterebilir miyiz? bazı arkadaşlar o şekilde görmek istiyor".
//
// NEDEN AYRI MODÜL: ızgara matematiği (ayın ilk günü, Pazartesi başlangıcı, artık Şubat, 6 satır)
// ve çok günlü OCO yayılımı bileşenden bağımsız test edilsin (bkz. takvimVurgu.ts gerekçesi).
//
// YEREL SAAT TEK KURAL: liste görünümü günleri `gunAnahtari` ile (tarayıcının yerel saatinde)
// grupluyor. Takvim aynı fonksiyonu kullanır; bir OCO iki görünümde farklı güne düşmemeli.

/** Gün anahtarı (YYYY-AA-GG) — yerel saatte. OCO pencereleri gece yarısını aşabildiği
 *  için liste gruplamayı BAŞLANGIÇ gününe göre yapar; bitiş satırda ayrıca yazar. */
export function gunAnahtari(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return tarihAnahtari(d);
}

/** Date -> YYYY-AA-GG (yerel alanlardan; ISO'ya çevirip UTC gününe kaymaz). */
export function tarihAnahtari(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** YYYY-AA-GG -> yerel gece yarısı. */
export function anahtardanTarih(gun: string): Date {
  const [y, m, d] = gun.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Yerel takvimde gün ekler (yaz saati geçişinde 24 saat eklemek günü kaydırabilirdi). */
export function gunEkle(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export const AY_ADLARI = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
] as const;
/** Pazartesi'den başlar. */
export const GUN_ADLARI = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'] as const;
export const GUN_KISA = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'] as const;

/** Haftanın Pazartesi'si (yerel). */
export function haftaBasi(d: Date): Date {
  const fark = (d.getDay() + 6) % 7; // Pazar=6, Pazartesi=0
  return gunEkle(d, -fark);
}

/** Hafta sonu mu (Cumartesi/Pazar)? */
export function haftaSonuMu(d: Date): boolean {
  return d.getDay() === 0 || d.getDay() === 6;
}

/** Ay yaprağı: HER ZAMAN 6x7 = 42 gün, Pazartesi başlar. Ay dışı günler `ayIci: false`. */
export function ayIzgarasi(yil: number, ay0: number): { gun: string; tarih: Date; ayIci: boolean }[] {
  const bas = haftaBasi(new Date(yil, ay0, 1));
  return Array.from({ length: 42 }, (_, i) => {
    const t = gunEkle(bas, i);
    return { gun: tarihAnahtari(t), tarih: t, ayIci: t.getMonth() === ay0 && t.getFullYear() === yil };
  });
}

/** Hafta: Pazartesi'den Pazar'a 7 gün. */
export function haftaGunleri(d: Date): { gun: string; tarih: Date }[] {
  const bas = haftaBasi(d);
  return Array.from({ length: 7 }, (_, i) => {
    const t = gunEkle(bas, i);
    return { gun: tarihAnahtari(t), tarih: t };
  });
}

/** Çok günlü OCO'nun yayılım üst sınırı: bozuk bir plannedEnd (ör. yıllar sonrası) takvimi
 *  yüzlerce hücreye boyamasın. Sınır aşılırsa ilk SINIR gün gösterilir. */
export const YAYILIM_SINIRI = 62;

/** Yerel saatte tam gece yarısı mı (00:00:00.000)? Gece yarısı biten pencere o güne DEĞİL,
 *  bir önceki güne aittir (o günün 24:00'ü). ocoGunleri ve hafta etiketi AYNI kuralı kullanır. */
export function geceYarisiMi(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;
}

/** OCO'nun takvimde göründüğü günler (yerel) ve YAYILIM_SINIRI'na takılıp kırpılıp kırpılmadığı.
 *  Bitiş, başlangıçtan sonraki bir güne düşüyorsa aradaki her gün dahil. Bitiş tam gece yarısıysa
 *  (00:00) o gün DAHİL DEĞİL: pencere bir önceki gün bitmiştir. plannedStart yoksa boş dizi (tarihsiz).
 *  `kirpildi`: gerçek bitiş günü sınırın ötesinde; son gösterilen gün BİTİŞ GÜNÜ DEĞİL. */
export function ocoYayilimi(
  plannedStart: string | null,
  plannedEnd: string | null,
): { gunler: string[]; kirpildi: boolean } {
  const basKey = gunAnahtari(plannedStart);
  if (!basKey) return { gunler: [], kirpildi: false };
  const bitis = plannedEnd ? new Date(plannedEnd) : null;
  if (!bitis || isNaN(bitis.getTime())) return { gunler: [basKey], kirpildi: false };
  const bas = new Date(plannedStart!);
  if (bitis.getTime() <= bas.getTime()) return { gunler: [basKey], kirpildi: false };
  let sonKey = tarihAnahtari(bitis);
  if (geceYarisiMi(plannedEnd) && sonKey > basKey) sonKey = tarihAnahtari(gunEkle(bitis, -1));
  const gunler: string[] = [];
  let t = anahtardanTarih(basKey);
  while (gunler.length < YAYILIM_SINIRI) {
    const k = tarihAnahtari(t);
    if (k > sonKey) break;
    gunler.push(k);
    t = gunEkle(t, 1);
  }
  return { gunler, kirpildi: gunler.length > 0 && gunler[gunler.length - 1] < sonKey };
}

/** Yalnız gün listesi (bkz. ocoYayilimi). */
export function ocoGunleri(plannedStart: string | null, plannedEnd: string | null): string[] {
  return ocoYayilimi(plannedStart, plannedEnd).gunler;
}

export interface TakvimOgesi<R> {
  row: R;
  /** Önceki günden süren parça (başlangıç günü değil). */
  devam: boolean;
  /** Sonraki güne süren parça (kırpılmış yayılımın son parçası da SÜRER). */
  surer: boolean;
  /** Yayılım YAYILIM_SINIRI'nda kesildi ve bu son gösterilen parça: bitiş takvim sınırının ötesinde. */
  sinirda?: boolean;
}

/** Satırları yayıldıkları her güne dağıtır. Gün içi sıra: önce önceki günden sürenler,
 *  sonra başlangıç saatine göre. Tarihsizler ayrı döner. */
export function gunlereYay<R extends { oco: number; plannedStart: string | null; plannedEnd: string | null }>(
  rows: R[],
): { gunler: Map<string, TakvimOgesi<R>[]>; tarihsiz: R[] } {
  const gunler = new Map<string, TakvimOgesi<R>[]>();
  const tarihsiz: R[] = [];
  for (const r of rows) {
    const { gunler: g, kirpildi } = ocoYayilimi(r.plannedStart, r.plannedEnd);
    if (!g.length) {
      tarihsiz.push(r);
      continue;
    }
    g.forEach((k, i) => {
      if (!gunler.has(k)) gunler.set(k, []);
      const son = i === g.length - 1;
      gunler.get(k)!.push({
        row: r,
        devam: i > 0,
        surer: !son || kirpildi,
        ...(son && kirpildi ? { sinirda: true } : {}),
      });
    });
  }
  const zaman = (o: TakvimOgesi<R>) => {
    const t = o.row.plannedStart ? Date.parse(o.row.plannedStart) : NaN;
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  for (const liste of gunler.values()) {
    liste.sort((a, b) => Number(b.devam) - Number(a.devam) || zaman(a) - zaman(b) || a.row.oco - b.row.oco);
  }
  return { gunler, tarihsiz };
}

/** Hücrede en çok kaç öğe; fazlası "+N daha". */
export const HUCRE_SINIRI = 3;

export function tasmaBol<T>(liste: T[], sinir = HUCRE_SINIRI): { gorunen: T[]; fazla: number } {
  if (liste.length <= sinir) return { gorunen: liste, fazla: 0 };
  return { gorunen: liste.slice(0, sinir), fazla: liste.length - sinir };
}
