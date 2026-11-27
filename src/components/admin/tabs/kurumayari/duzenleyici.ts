// src/components/admin/tabs/kurumayari/duzenleyici.ts — Admin > Kurum Ayarı düzenleyicisinin saf
// yardımcıları: bölüm / tüm dosya metni, kaydedilecek hedef metin ve kaydetmeden önceki ön izleme.
// Fark hesabı, onay isteyen silmeler ve sunucu adı kuralı sunucuyla ortak: shared/kurumAyari.cjs.
import {
  derinlikAsildi,
  farkBosMu,
  farkHesapla,
  MAKS_DERINLIK,
  onayliSilmeler,
  yeniSunucuIhlalleri,
} from '../../../../../shared/kurumAyari.cjs';

export type AyarNesnesi = Record<string, unknown>;
export type Fark = ReturnType<typeof farkHesapla>;

export interface Onizleme {
  baslik: string;
  fark: Fark;
  /** Anlamsal fark yok. */
  bos: boolean;
  /** Anlamsal fark yok ama dosya metni değişiyor (girinti, anahtar sırası): kaydedilebilir. */
  yalnizBicim: boolean;
  /** Kaydedilecek dosya metninin tamamı. */
  hedefMetin: string;
  /** Silinen ya da boşaltılan üst düzey bölümler (sunucu 428 ile onay ister). */
  silinenBolumler: string[];
  /** Silinen dolu sunucu adı alanları (aynı onay). */
  silinenSunucuAlanlari: string[];
  /** Sunucunun reddedeceği yeni sunucu adı ihlalleri (yalnız yol). */
  ihlaller: { yol: string; neden: string }[];
  /** Çakışmadan sonra: başkasının değiştirdiği yollardan bu kaydın geri alacakları / ezecekleri. */
  cakisanYollar: string[];
  /** Kaydedilecek metin sunucu sınırını aşıyor (bayt). */
  boyutAsimi: boolean;
  geriYuklenenYedek?: string;
}

export type Hedef = { ok: true; metin: string; veri: AyarNesnesi } | { ok: false; hata: string };

const nesneMi = (v: unknown): v is AyarNesnesi =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Dosya metni geçerli bir JSON nesnesiyse nesne, değilse null. */
export function ayarVerisi(icerik: string | null | undefined): AyarNesnesi | null {
  if (!icerik) return null;
  try {
    const n: unknown = JSON.parse(icerik);
    return nesneMi(n) ? n : null;
  } catch {
    return null;
  }
}

/** Editöre konacak metin: bölüm seçiliyse o bölüm, değilse dosyanın kendisi. */
export function bolumMetni(veri: AyarNesnesi | null, bolum: string, icerik: string | null): string {
  if (bolum && veri && Object.hasOwn(veri, bolum)) return JSON.stringify(veri[bolum], null, 2);
  return icerik ?? '';
}

/**
 * JSON.parse hatasının Türkçe ve konumlu metni. Tarayıcının (İngilizce) mesajı gösterilmez; konum
 * mesajdaki `position N`den ya da `line X column Y`den çıkarılır, yoksa yalnız "Geçersiz JSON".
 */
export function jsonHataMetni(e: unknown, metin: string): string {
  const mesaj = String((e as Error)?.message ?? '');
  const sc = /line (\d+) column (\d+)/.exec(mesaj);
  if (sc) return `Geçersiz JSON (satır ${sc[1]}, sütun ${sc[2]})`;
  const p = /position (\d+)/.exec(mesaj);
  if (!p) return 'Geçersiz JSON';
  const once = metin.slice(0, Number(p[1])).split('\n');
  return `Geçersiz JSON (satır ${once.length}, sütun ${(once.at(-1) ?? '').length + 1})`;
}

/** Editör metninden kaydedilecek dosyanın tamamı. Bölüm kipinde diğer bölümler aynen kalır. */
export function hedefOlustur(veri: AyarNesnesi | null, bolum: string, metin: string): Hedef {
  let ayrik: unknown;
  try {
    ayrik = JSON.parse(metin);
  } catch (e) {
    return { ok: false, hata: jsonHataMetni(e, metin) };
  }
  if (derinlikAsildi(ayrik))
    return { ok: false, hata: `En çok ${MAKS_DERINLIK} düzey iç içe olabilir.` };
  if (!bolum) {
    if (!nesneMi(ayrik)) return { ok: false, hata: 'Dosya bir JSON nesnesi olmalı: { ... }' };
    return { ok: true, metin, veri: ayrik };
  }
  if (!veri) return { ok: false, hata: 'Bölüm düzenlemek için dosyanın geçerli olması gerekir.' };
  const yeni = { ...veri, [bolum]: ayrik };
  return { ok: true, metin: JSON.stringify(yeni, null, 2) + '\n', veri: yeni };
}

/** a, b'nin kendisi, atası ya da torunu mu (`x.y` ile `x.y.z`, `x.y[0]`). */
function yolIliskili(a: string, b: string): boolean {
  const altMi = (u: string, k: string) => u === k || u.startsWith(`${k}.`) || u.startsWith(`${k}[`);
  return altMi(a, b) || altMi(b, a);
}

export interface OnizlemeSecenekleri {
  geriYuklenenYedek?: string;
  /** Dosyanın şu anki metni: anlamsal fark yokken metin farkı "yalnız biçim" sayılır. */
  mevcutMetin?: string | null;
  /** Çakışmadan sonra yeniden yüklemede başkasının değiştirdiği anahtar yolları. */
  baskasininYollari?: string[];
  maksBayt?: number;
}

/** Kaydetmeden önceki ön izleme: fark, onay isteyen silmeler, yeni sunucu adı ihlalleri. */
export function onizlemeOlustur(
  baslik: string,
  eski: AyarNesnesi | null,
  hedefMetin: string,
  yeni: AyarNesnesi,
  secenek: OnizlemeSecenekleri = {},
): Onizleme {
  const temel = eski ?? {};
  const fark = farkHesapla(temel, yeni);
  const bos = farkBosMu(fark);
  const { bolumler, sunucuAlanlari } = onayliSilmeler(temel, yeni);
  const benimYollarim = [...fark.eklenen, ...fark.silinen, ...fark.degisen, ...fark.listeler].map(
    (x) => x.yol,
  );
  const baskasi = secenek.baskasininYollari ?? [];
  return {
    baslik,
    fark,
    bos,
    yalnizBicim: bos && secenek.mevcutMetin != null && secenek.mevcutMetin !== hedefMetin,
    hedefMetin,
    silinenBolumler: bolumler,
    silinenSunucuAlanlari: sunucuAlanlari,
    ihlaller: yeniSunucuIhlalleri(temel, yeni).map(({ yol, neden }) => ({ yol, neden })),
    cakisanYollar: baskasi.filter((q) => benimYollarim.some((p) => yolIliskili(p, q))),
    boyutAsimi:
      !!secenek.maksBayt && new TextEncoder().encode(hedefMetin).length > secenek.maksBayt,
    geriYuklenenYedek: secenek.geriYuklenenYedek,
  };
}

/** İki dosya hali arasında değişen anahtar yolları (çakışmada başkasının değiştirdikleri). */
export function degisenYollar(eski: AyarNesnesi | null, yeni: AyarNesnesi | null): string[] {
  const f = farkHesapla(eski ?? {}, yeni ?? {});
  return [...f.eklenen, ...f.silinen, ...f.degisen, ...f.listeler].map((x) => x.yol);
}

/** Değeri tek satırda kısa göster (tam hali `title`da). */
export function kisaDeger(v: unknown, sinir = 120): string {
  const s = JSON.stringify(v) ?? String(v);
  return s.length > sinir ? `${s.slice(0, sinir - 1)}…` : s;
}

/** Liste değerlerine kararlı React anahtarı (aynı değer tekrar ederse sırası eklenir). */
export function anahtarli(l: unknown[]): { k: string; v: unknown }[] {
  const sayac = new Map<string, number>();
  return l.map((v) => {
    const s = JSON.stringify(v) ?? String(v);
    const n = (sayac.get(s) ?? 0) + 1;
    sayac.set(s, n);
    return { k: `${s}#${n}`, v };
  });
}

export const IHLAL_METNI: Record<string, string> = {
  'gecersiz-ad': 'sunucu adı kuralına uymuyor',
  'liste-degil': 'liste olmalı',
  'nesne-degil': 'nesne olmalı',
};
