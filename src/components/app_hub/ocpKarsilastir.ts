// src/components/app_hub/ocpKarsilastir.ts — Application Hub OCP: ortam içinde cluster karşılaştırması (2026-11-23).
//
// Kullanıcı: "uygulama sahibi içeri girdiğinde tüm ortamlar için ayrı ayrı ve tüm cluster'lar için ayrı ayrı
// kaç pod'u var görülsün. JVM parametreleri, versiyonları vs her ortam için küme halinde her cluster için alt
// alta gözüksün ki insanlar kontrol ederken hemen bir fark var mı görebilsin."
//
// KURALLAR:
//   * Grup = ortam (cluster kataloğundaki env). Ortamlar ARASI karşılaştırma yapılmaz (dev ile prod farklı
//     olabilir); yalnız aynı ortamın cluster / namespace'leri birbirine karşılaştırılır.
//   * Karşılaştırılan alanlar: tür, istenen replika, imaj (sürüm = imaj etiketi), CPU / bellek istek-limit,
//     JVM env'leri (shared/jvmArg.cjs: Toplu JVM karşılaştır ile aynı ayrıştırma; sırasız, son değer etkin).
//   * Fark = çoğunluktan sapma. Çoğunluk yoksa (ör. 2 cluster, 2 değer) her iki taraf da fark sayılır ve
//     "diğerleri" yazılır; hangisinin doğru olduğu söylenmez.
//   * Ölçülemeyen (okuma yok / okunamadı / JVM ayrıntısı boyut sınırıyla atılmış) üye karşılaştırmaya girmez;
//     "ölçülemedi" fark DEĞİLDİR.
//   * Maskeli değer (***) metin olarak karşılaştırılır: maske belirleyicidir, *** kısımları eşit çıkar.
import type { OcpCanliNesne, OcpCanliOkuma, OcpYer } from '@/api/appHubApi';
import { argOzu } from '../../../shared/jvmArg.cjs';

/** Pod sayısı: hazır / toplam; okunamadıysa null (0 DEĞİL). Eski canlı okumada podOzet yoksa listeden sayılır. */
export function podSayisi(o?: OcpCanliOkuma): { hazir: number; toplam: number } | null {
  if (!o || !o.ok) return null;
  if (o.podOzet) {
    if (o.podOzet.okunamadi || o.podOzet.toplam == null) return null;
    return { hazir: o.podOzet.hazir ?? 0, toplam: o.podOzet.toplam };
  }
  // Eski kayıt (podOzet yok): pod listesi okunamadıysa sayı yok; liste en çok 200 olduğu için tam sayı da değil.
  if (!o.podlar || (o.hatalar || []).some((h) => /pod listesi okunamadi/i.test(h))) return null;
  const hazir = o.podlar.filter((p) => {
    const [r, t] = String(p.hazir || '')
      .split('/')
      .map(Number);
    return p.faz === 'Running' && t > 0 && r === t;
  }).length;
  return { hazir, toplam: o.podlar.length };
}

export type FarkAlani = 'tur' | 'replika' | 'surum' | 'kaynak' | 'jvm';
export type Fark = { alan: FarkAlani; metin: string; ipucu: string };

export type JvmDegiskeni = { ad: string; deger: string; referans: boolean };
export type ContainerOzeti = {
  ad: string;
  imaj: string | null;
  surum: string;
  kaynak: string;
  /** null: JVM ayrıntısı ölçülemedi (boyut sınırı); [] : tanımlı JVM env yok. */
  jvm: JvmDegiskeni[] | null;
};
export type UyeSatiri = {
  anahtar: string;
  yer: OcpYer;
  okuma?: OcpCanliOkuma;
  olculdu: boolean;
  tur: string | null;
  replika: { hazir: number; istenen: number } | null;
  pod: { hazir: number; toplam: number } | null;
  containerlar: ContainerOzeti[];
  farklar: Fark[];
};
export type OrtamGrubu = {
  ortam: string;
  /** Kataloğu olmayan cluster'lar (ortam bilinmiyor) ayrı grup: karşılaştırılmaz. */
  katalogDisi: boolean;
  uyeler: UyeSatiri[];
  olculen: number;
  farkliUye: number;
  farkSayilari: Partial<Record<FarkAlani, number>>;
  surumler: { surum: string; sayi: number }[];
  pod: { hazir: number; toplam: number; olculemeyen: number };
};

export const ORTAM_SIRA = ['PROD', 'PRP', 'PREPROD', 'UAT', 'QA', 'TEST', 'DEV', 'EDU'];
const JVM_ATILDI = /JVM ayrıntısı boyut sınırı/;

export const yerAnahtari = (c: string, n: string) => `${c.toLowerCase()}|${n.toLowerCase()}`;

/** İmaj → görünen sürüm: etiket (registry/yol atılır), digest ise kısa özet; etiket yoksa "latest (etiketsiz)". */
export function imajSurumu(imaj: string | null | undefined): string {
  const s = String(imaj || '').trim();
  if (!s) return '—';
  const at = s.indexOf('@');
  if (at >= 0) {
    const d = s.slice(at + 1);
    const [alg, ozet = ''] = d.split(':');
    return ozet ? `${alg}:${ozet.slice(0, 12)}` : d;
  }
  const son = s.slice(s.lastIndexOf('/') + 1);
  const ik = son.lastIndexOf(':');
  return ik >= 0 ? son.slice(ik + 1) : 'latest (etiketsiz)';
}

/** Aynı adda Deployment (workloadRef, 0'a ölçekli) + Rollout varsa replikası olan nesne asıl nesnedir. */
export function anaNesne(o?: OcpCanliOkuma): OcpCanliNesne | null {
  return (o?.nesneler || []).reduce<OcpCanliNesne | null>(
    (a, n) => (!a || (n.istenen || 0) > (a.istenen || 0) ? n : a),
    null,
  );
}

const kaynakMetni = (c: OcpCanliNesne['containerlar'][number]) =>
  `istek ${c.istek.cpu || '—'} CPU · ${c.istek.bellek || '—'} / limit ${c.limit.cpu || '—'} CPU · ${c.limit.bellek || '—'}`;

function uyeKur(yer: OcpYer, okuma?: OcpCanliOkuma): UyeSatiri {
  const n = okuma?.ok ? anaNesne(okuma) : null;
  const jvmAtildi = (okuma?.notlar || []).some((x) => JVM_ATILDI.test(x));
  const onbellek = yer.onbellek?.kayitlar?.[0];
  return {
    anahtar: yerAnahtari(yer.cluster, yer.namespace),
    yer,
    okuma,
    olculdu: !!n,
    tur: n
      ? n.tur
      : onbellek && onbellek.kind && onbellek.kind !== 'Unknown'
        ? onbellek.kind
        : null,
    replika: n ? { hazir: n.hazir ?? 0, istenen: n.istenen ?? 0 } : null,
    pod: podSayisi(okuma),
    containerlar: (n?.containerlar || []).map((c) => ({
      ad: c.ad,
      imaj: c.imaj,
      surum: imajSurumu(c.imaj),
      kaynak: kaynakMetni(c),
      jvm: jvmAtildi
        ? null
        : c.jvmEnv.map((e) => ({
            ad: e.ad,
            deger: e.deger || '',
            referans: e.kaynak === 'referans',
          })),
    })),
    farklar: [],
  };
}

type Deger = { uye: UyeSatiri; deger: string };

/** Değerleri gruplar; çoğunluk = tek başına en kalabalık değer (beraberlikte null). */
function cogunluk(liste: Deger[]): { cog: string | null; gruplar: Map<string, UyeSatiri[]> } {
  const gruplar = new Map<string, UyeSatiri[]>();
  for (const { uye, deger } of liste) gruplar.set(deger, [...(gruplar.get(deger) || []), uye]);
  const sirali = [...gruplar.entries()].sort((a, b) => b[1].length - a[1].length);
  const cog = sirali.length && (sirali.length === 1 || sirali[0][1].length > sirali[1][1].length);
  return { cog: cog ? sirali[0][0] : null, gruplar };
}

/** Basit alan: çoğunluktan sapan üyeye fark yazar (görünen metin `goster` ile). */
function alanKarsilastir(
  alan: FarkAlani,
  liste: Deger[],
  goster: (d: string) => string,
  onEk = '',
) {
  if (liste.length < 2) return;
  const { cog, gruplar } = cogunluk(liste);
  if (gruplar.size < 2) return;
  for (const { uye, deger } of liste) {
    if (deger === cog) continue;
    const digerleri = [...gruplar.keys()].filter((k) => k !== deger).map(goster);
    uye.farklar.push({
      alan,
      metin: `${onEk}${goster(deger)}`,
      ipucu: cog !== null ? `çoğunluk: ${goster(cog)}` : `diğerleri: ${digerleri.join(', ')}`,
    });
  }
}

/** (anahtar, değer) → yeniden okunur belirteç. */
export function belirtec(k: string, v: string): string {
  if (v === '') return k;
  if (k.startsWith('-XX:') && (v === '+' || v === '-')) return `-XX:${v}${k.slice(4)}`;
  if (/^-X(ms|mx|ss|mn)$/.test(k)) return `${k}${v}`;
  if (k.startsWith('-D') || k.startsWith('-XX:') || k.startsWith('--')) return `${k}=${v}`;
  if (k.startsWith('-')) return `${k}:${v}`;
  return `${k}=${v}`;
}

/** Tek JVM env değeri → (anahtar → değer). Argüman olmayan değer (ör. JAVA_MAX_MEM_RATIO=80) tek anahtardır. */
function envHaritasi(e: JvmDegiskeni): Map<string, string> {
  if (e.referans) return new Map([[e.ad, `(${e.deger})`]]);
  const d = e.deger.trim();
  if (!d.startsWith('-')) return new Map([[e.ad, d]]);
  return argOzu(d).h as Map<string, string>;
}

function jvmKarsilastir(uyeler: UyeSatiri[], container: string, envAd: string, onEk: string) {
  const katilan = uyeler
    .map((u) => ({ u, c: u.containerlar.find((c) => c.ad === container) }))
    .filter((x) => x.c && x.c.jvm !== null);
  if (katilan.length < 2) return;
  const haritalar = katilan.map(({ u, c }) => {
    const e = (c?.jvm || []).find((j) => j.ad === envAd);
    return { u, h: e ? envHaritasi(e) : new Map<string, string>() };
  });
  const n = haritalar.length;
  const anahtarlar = [...new Set(haritalar.flatMap((x) => [...x.h.keys()]))];
  for (const k of anahtarlar) {
    const tutan = haritalar.filter((x) => x.h.has(k));
    const degerler = tutan.map((x) => ({ uye: x.u, deger: x.h.get(k) as string }));
    const { cog } = cogunluk(degerler);
    if (tutan.length * 2 > n) {
      const ornek = belirtec(k, cog ?? degerler[0].deger);
      for (const x of haritalar.filter((y) => !y.h.has(k)))
        x.u.farklar.push({
          alan: 'jvm',
          metin: `${onEk}eksik: ${k}`,
          ipucu: `diğerlerinde: ${ornek}`,
        });
    } else {
      for (const d of degerler)
        d.uye.farklar.push({
          alan: 'jvm',
          metin: `${onEk}${tutan.length * 2 < n ? 'fazla' : 'yalnız bazılarında'}: ${belirtec(k, d.deger)}`,
          ipucu: `${n - tutan.length} cluster'da yok`,
        });
      continue;
    }
    alanKarsilastir('jvm', degerler, (v) => belirtec(k, v), onEk);
  }
}

function grupKarsilastir(uyeler: UyeSatiri[]) {
  const olcu = uyeler.filter((u) => u.olculdu);
  alanKarsilastir(
    'tur',
    olcu.map((u) => ({ uye: u, deger: u.tur || '' })),
    (d) => d,
  );
  alanKarsilastir(
    'replika',
    olcu.map((u) => ({ uye: u, deger: String(u.replika?.istenen ?? '') })),
    (d) => `istenen ${d}`,
  );
  const containerAdlari = [...new Set(olcu.flatMap((u) => u.containerlar.map((c) => c.ad)))];
  const cokContainer = containerAdlari.length > 1;
  for (const ad of containerAdlari) {
    const onEk = cokContainer ? `${ad}: ` : '';
    const sahip = olcu
      .map((u) => ({ u, c: u.containerlar.find((c) => c.ad === ad) }))
      .filter((x) => x.c);
    // İmaj tam yoluyla karşılaştırılır; görünen sürüm etiket (aynı etiket farklı yolsa yol da yazılır).
    const surumGoster = (imaj: string) => {
      const s = imajSurumu(imaj);
      const ayniEtiketFarkliYol = sahip.some((x) => x.c?.imaj !== imaj && x.c?.surum === s);
      return ayniEtiketFarkliYol ? imaj : s;
    };
    alanKarsilastir(
      'surum',
      sahip.map((x) => ({ uye: x.u, deger: x.c?.imaj || '' })),
      surumGoster,
      onEk,
    );
    alanKarsilastir(
      'kaynak',
      sahip.map((x) => ({ uye: x.u, deger: x.c?.kaynak || '' })),
      (d) => d,
      onEk,
    );
    const envAdlari = [...new Set(sahip.flatMap((x) => (x.c?.jvm || []).map((j) => j.ad)))].sort(
      (a, b) => a.localeCompare(b),
    );
    for (const e of envAdlari)
      jvmKarsilastir(
        sahip.map((x) => x.u),
        ad,
        e,
        `${onEk}${envAdlari.length > 1 ? `${e} ` : ''}`,
      );
  }
}

function ortamSirasi(a: string, b: string) {
  const ia = ORTAM_SIRA.indexOf(a.toUpperCase());
  const ib = ORTAM_SIRA.indexOf(b.toUpperCase());
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
}

/** Yerleri ortama göre gruplar, okumalarla birleştirir ve ortam içi farkları hesaplar. */
export function ortamGruplari(yerler: OcpYer[], okumalar: OcpCanliOkuma[]): OrtamGrubu[] {
  const ix = new Map(okumalar.map((o) => [yerAnahtari(o.cluster, o.namespace), o]));
  const gruplar = new Map<string, UyeSatiri[]>();
  for (const y of yerler) {
    const k = y.ortam ? y.ortam.toUpperCase() : '';
    gruplar.set(k, [
      ...(gruplar.get(k) || []),
      uyeKur(y, ix.get(yerAnahtari(y.cluster, y.namespace))),
    ]);
  }
  const sonuc: OrtamGrubu[] = [];
  for (const [ortam, uyeler] of gruplar) {
    uyeler.sort(
      (a, b) =>
        a.yer.cluster.localeCompare(b.yer.cluster) ||
        a.yer.namespace.localeCompare(b.yer.namespace),
    );
    const katalogDisi = !ortam;
    if (!katalogDisi) grupKarsilastir(uyeler);
    const farkSayilari: Partial<Record<FarkAlani, number>> = {};
    for (const u of uyeler)
      for (const a of new Set(u.farklar.map((f) => f.alan)))
        farkSayilari[a] = (farkSayilari[a] || 0) + 1;
    const surumSay = new Map<string, number>();
    for (const u of uyeler)
      for (const c of u.containerlar) surumSay.set(c.surum, (surumSay.get(c.surum) || 0) + 1);
    sonuc.push({
      ortam,
      katalogDisi,
      uyeler,
      olculen: uyeler.filter((u) => u.olculdu).length,
      farkliUye: uyeler.filter((u) => u.farklar.length).length,
      farkSayilari,
      surumler: [...surumSay.entries()]
        .map(([surum, sayi]) => ({ surum, sayi }))
        .sort((a, b) => b.sayi - a.sayi || a.surum.localeCompare(b.surum)),
      pod: uyeler.reduce(
        (a, u) =>
          u.pod
            ? { ...a, hazir: a.hazir + u.pod.hazir, toplam: a.toplam + u.pod.toplam }
            : { ...a, olculemeyen: a.olculemeyen + 1 },
        { hazir: 0, toplam: 0, olculemeyen: 0 },
      ),
    });
  }
  return sonuc.sort((a, b) =>
    a.katalogDisi !== b.katalogDisi
      ? Number(a.katalogDisi) - Number(b.katalogDisi)
      : ortamSirasi(a.ortam, b.ortam),
  );
}
