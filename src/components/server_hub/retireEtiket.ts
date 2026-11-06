// src/components/server_hub/retireEtiket.ts — Retirement etiketleri ve sunucu panelinin saf yardımcıları (2026-11-06).
//
// DURUM DİLİ: KESİN kırmızı değil "retire edilebilir, doğrulanmalı"dır (turuncu); ŞÜPHELİ sarı.
// Ölçülemeyen ya da doğrulanmamış hiçbir şey yeşil görünmez: yeşil yalnız "doğrulandı".
import type {
  ShDogrulama,
  ShEtiketTur,
  ShHostDetail,
  ShKontrolDurum,
  ShRetireEtiketHer,
  ShJvm,
} from '@/api/serverHubApi';

export type EtiketTon = 'kesin' | 'supheli' | 'iyi' | 'notr' | 'uyari' | 'bilgi';
export interface EtiketBilgi {
  etiket: string;
  ton: EtiketTon;
  aciklama: string;
}

export const ETIKET_SEVIYE: Record<'KESIN' | 'SUPHELI', EtiketBilgi> = {
  KESIN: {
    etiket: 'kesin',
    ton: 'kesin',
    aciklama: 'Kurallar retire edilebilir diyor. Elle doğrulanınca Retirement kaydı açılabilir.',
  },
  SUPHELI: {
    etiket: 'şüpheli',
    ton: 'supheli',
    aciklama: 'Retire şüphesi var; karar için elle inceleme gerekir.',
  },
};

export const KONTROL_DURUM: Record<ShKontrolDurum, EtiketBilgi> = {
  BEKLIYOR: { etiket: 'kontrol bekliyor', ton: 'notr', aciklama: 'Henüz kimse bakmadı.' },
  DOGRULANDI: { etiket: 'doğrulandı', ton: 'iyi', aciklama: 'Admin kanıtı elle doğruladı.' },
  YANLIS_ALARM: {
    etiket: 'yanlış alarm',
    ton: 'bilgi',
    aciklama: 'Admin yanlış alarm dedi; varsayılan listede gizlenir.',
  },
  VERI_DEGISTI: {
    etiket: 'veri değişti',
    ton: 'uyari',
    aciklama: 'Kontrolden sonra kanıt değişti; yeniden bakılmalı.',
  },
  BILINMIYOR: {
    etiket: 'kontrol okunamadı',
    ton: 'uyari',
    aciklama: 'Manuel kontrol kayıtları okunamadı; hiçbir etiket doğrulanmış sayılmaz.',
  },
};

export const TUR_ETIKET: Record<ShEtiketTur, string> = {
  JVM: 'JVM / uygulama',
  EAR: 'EAR',
  GIRDI: 'kök girdisi',
};

/** Etiketin okunur konusu: "oldapp (JBoss 7)", "BOS.ear (/vhosting)", "/vhosting/ESKI.war". */
export function konuMetni(
  e: Pick<ShRetireEtiketHer, 'tur' | 'ad' | 'gen' | 'nesil' | 'kok'>,
): string {
  if (e.tur === 'JVM') return `${e.ad}${e.gen ? ` (JBoss ${e.gen})` : ''}`;
  if (e.tur === 'EAR') return `${e.ad}${e.nesil && e.nesil !== '?' ? ` (JBoss ${e.nesil})` : ''}`;
  return `${e.kok || ''}/${e.ad}`;
}

export interface EtiketSuzgeci {
  q: string;
  seviye: 'all' | 'KESIN' | 'SUPHELI';
  /** 'acik': yanlış alarm HARİÇ hepsi (varsayılan) */
  durum: 'acik' | 'all' | ShKontrolDurum;
  tur: 'all' | ShEtiketTur;
  ortam: string;
}
export const BOS_SUZGEC: EtiketSuzgeci = {
  q: '',
  seviye: 'all',
  durum: 'acik',
  tur: 'all',
  ortam: 'all',
};

export function etiketSuz(etiketler: ShRetireEtiketHer[], s: EtiketSuzgeci): ShRetireEtiketHer[] {
  const n = s.q.trim().toLowerCase();
  return etiketler.filter(
    (e) =>
      (s.seviye === 'all' || e.seviye === s.seviye) &&
      (s.durum === 'all'
        ? true
        : s.durum === 'acik'
          ? e.durum !== 'YANLIS_ALARM'
          : e.durum === s.durum) &&
      (s.tur === 'all' || e.tur === s.tur) &&
      (s.ortam === 'all' || e.ortam === s.ortam) &&
      (!n ||
        e.ad.toLowerCase().includes(n) ||
        e.hostlar.some((h) => h.toLowerCase().includes(n)) ||
        e.nedenler.some((x) => x.toLowerCase().includes(n))),
  );
}

/**
 * Hızlı süzgeç (özet düğmeleri): sütun süzgeçlerinden ÖNCE uygulanır. Varsayılan 'acik' yanlış alarmları
 * gizler; 'hepsi' ve 'yanlis' onları gösterir.
 */
export type HizliSuzgec =
  'acik' | 'kesin' | 'supheli' | 'bekleyen' | 'hazir' | 'dusen' | 'yanlis' | 'hepsi';
export const HIZLI_SUZGECLER: { id: HizliSuzgec; etiket: string }[] = [
  { id: 'acik', etiket: 'açık (yanlış alarm hariç)' },
  { id: 'kesin', etiket: 'kesin' },
  { id: 'supheli', etiket: 'şüpheli' },
  { id: 'bekleyen', etiket: 'kontrol bekleyen' },
  { id: 'hazir', etiket: 'Retirement’a hazır' },
  { id: 'dusen', etiket: 'kesinden şüpheliye inen' },
  { id: 'yanlis', etiket: 'yanlış alarm' },
  { id: 'hepsi', etiket: 'hepsi' },
];
export function hizliSuz<T extends ShRetireEtiketHer>(etiketler: T[], h: HizliSuzgec): T[] {
  const acik = (e: T) => e.durum !== 'YANLIS_ALARM';
  const f: Record<HizliSuzgec, (e: T) => boolean> = {
    acik,
    kesin: (e) => acik(e) && e.seviye === 'KESIN',
    supheli: (e) => acik(e) && e.seviye === 'SUPHELI',
    bekleyen: (e) => e.durum === 'BEKLIYOR' || e.durum === 'VERI_DEGISTI',
    hazir: (e) => e.retirementHazir,
    dusen: (e) => acik(e) && e.hamSeviye === 'KESIN' && e.seviye !== 'KESIN',
    yanlis: (e) => e.durum === 'YANLIS_ALARM',
    hepsi: () => true,
  };
  return etiketler.filter(f[h] || acik);
}

/** Zincir özeti (sütun süzgeci): kanıt tam / kesinden indi / şüpheli + neden. */
export function zincirDurumu(
  e: Pick<ShRetireEtiketHer, 'seviye' | 'hamSeviye' | 'nedenler'>,
): 'TAM' | 'DUSTU' | 'NEDENLI' {
  if (e.hamSeviye === 'KESIN' && e.seviye !== 'KESIN') return 'DUSTU';
  return e.nedenler.length ? 'NEDENLI' : 'TAM';
}

/** Bu sunucuyu kopyaları arasında taşıyan etiketler. */
export const hostEtiketleri = (etiketler: ShRetireEtiketHer[] | null | undefined, host: string) =>
  (etiketler || []).filter((e) => e.hostlar.includes(host));

/**
 * Retirement akışına gidecek uygulama adı: JVM adı; EAR için .ear'sız ad. Kök girdisi Retirement
 * konusu değildir (elle temizlenir): null. Yalnız KESİN + DOĞRULANDI etikette çağrılır.
 */
export function retirementUygulamasi(e: Pick<ShRetireEtiketHer, 'tur' | 'ad'>): string | null {
  if (e.tur === 'JVM') return e.ad;
  if (e.tur === 'EAR') return e.ad.replace(/\.ear$/i, '');
  return null;
}

/** Kontrol komutundaki yer tutucuları bilinen değerlerle doldurur; bilinmeyen yer tutucu kalır. */
export function komutDoldur(
  komut: string,
  d: {
    JVM?: string | null;
    EAR?: string | null;
    GIRDI?: string | null;
    ACCESS_LOG?: string | null;
  },
): string {
  return komut.replace(/<(JVM|EAR|GIRDI|ACCESS_LOG)>/g, (t, k: keyof typeof d) =>
    d[k] ? String(d[k]) : t,
  );
}

export interface DogrulamaAdimi {
  baslik: string;
  dogrulama: ShDogrulama;
  komutlar: string[];
}

/**
 * Sunucunun bulguları ve etiketlerinden doğrulama adımları: başlık başına bir kez (aynı kod iki
 * kez yazılmaz), komutlar konuyla doldurulmuş, tekrarlar atılmış.
 */
export function dogrulamaAdimlari(
  bulgular: {
    code: string;
    dogrulama?: ShDogrulama | null;
    ear?: { ad?: string; girdiler?: { ad: string }[] } | null;
    text?: string;
  }[],
  etiketler: ShRetireEtiketHer[],
  kurallar: { kural: string; ad: string; dogrulama: ShDogrulama | null }[],
  jvmAdi: (metin: string) => string | null = () => null,
): DogrulamaAdimi[] {
  const out = new Map<string, DogrulamaAdimi>();
  const ekle = (
    baslik: string,
    d: ShDogrulama | null | undefined,
    degerler: Parameters<typeof komutDoldur>[1],
  ) => {
    if (!d) return;
    const a = out.get(baslik) || { baslik, dogrulama: d, komutlar: [] };
    for (const k of d.kontrol) {
      const dolu = komutDoldur(k, degerler);
      if (!a.komutlar.includes(dolu)) a.komutlar.push(dolu);
    }
    out.set(baslik, a);
  };
  for (const f of bulgular)
    ekle(f.code, f.dogrulama, {
      JVM: f.text ? jvmAdi(f.text) : null,
      EAR: f.ear?.ad || null,
      GIRDI: f.ear?.girdiler?.[0]?.ad || null,
    });
  const kAd = new Map(kurallar.map((k) => [k.kural, k]));
  for (const e of etiketler)
    for (const r of e.kurallar) {
      const k = kAd.get(r);
      if (!k) continue;
      // Ozet etikette kopya yok: log bilinmiyorsa yer tutucu kalir (uydurulmaz).
      const log = (e.kopyalar || []).flatMap((c) => c.web || []).find((w) => w.log)?.log || null;
      ekle(`${r} · ${k.ad}`, k.dogrulama, {
        JVM: e.tur === 'JVM' ? e.ad : null,
        EAR: e.tur === 'EAR' ? e.ad : null,
        GIRDI: e.tur === 'GIRDI' ? e.ad : null,
        ACCESS_LOG: log,
      });
    }
  return [...out.values()];
}

/** Bulgu metninin başındaki "JBoss7 ad" kalıbından JVM adı (doğrulama komutunu doldurmak için). */
export function bulgudanJvm(metin: string): string | null {
  const m = /^JBoss\d+ (\S+)/.exec(metin || '');
  return m ? m[1] : null;
}

type JvmV = ShJvm & { runningKnown?: boolean | null };
export interface ZincirKarti {
  jvm: JvmV;
  /** Bu JVM'e domain.xml / host.xml ile bağlı EAR'lar (Uygulama Envanteri). */
  earlar: NonNullable<NonNullable<ShHostDetail['ear']>['uygulamalar']>;
  /** 2 katman (web aynı sunucuda) / 3 katman (ayrı web sunucusu) / eşlenemedi */
  katman: 'ayni-sunucu' | 'ayri-web' | 'eslenemedi';
}

/** Sunucunun JVM'leri için zincir kartları + hiçbir JVM'e bağlanmayan EAR'lar. */
export function zincirKartlari(h: ShHostDetail): {
  kartlar: ZincirKarti[];
  bagsizEarlar: ZincirKarti['earlar'];
} {
  const uyg = (h.ear && h.ear.durum === 'VAR' && h.ear.uygulamalar) || [];
  const kullanilan = new Set<string>();
  const kartlar = (h.jvms || []).map((j) => {
    const earlar = uyg.filter((u) =>
      (u.xml?.jvmler || []).some((x) => x.ad.toLowerCase() === String(j.name).toLowerCase()),
    );
    for (const u of earlar) kullanilan.add(`${u.kok}/${u.ad}`);
    const webHostlari = new Set((j.vhosts || []).map((v) => v.host));
    const katman: ZincirKarti['katman'] = !webHostlari.size
      ? 'eslenemedi'
      : webHostlari.has(h.host) && webHostlari.size === 1
        ? 'ayni-sunucu'
        : 'ayri-web';
    return { jvm: j as JvmV, earlar, katman };
  });
  return { kartlar, bagsizEarlar: uyg.filter((u) => !kullanilan.has(`${u.kok}/${u.ad}`)) };
}

type DepJvm = NonNullable<NonNullable<ShHostDetail['ear']>['deployment']>['jvmler'][number];
/**
 * Faz 2: JVM'in deployment satiri (JBoss CLI). ton: kotu (yok / FAILED), uyari (devre disi /
 * olculemedi), notr (kontrol kapali / JVM kapali), iyi DEGIL (yesil yalniz dogrulama). Metin kisa.
 */
export function deploymentMetni(
  h: ShHostDetail,
  j: { name: string; gen: number; running: boolean; runningKnown?: boolean | null },
): { metin: string; ton: 'kotu' | 'uyari' | 'notr' | 'bilgi' } {
  const dep = h.ear && h.ear.durum === 'VAR' ? h.ear.deployment : null;
  if (!dep)
    return {
      metin: 'kontrol kapalı (Uygulama Envanteri ayarı “Deployment kontrolü”)',
      ton: 'notr',
    };
  if (j.runningKnown === false || !j.running)
    return { metin: 'JVM kapalı — deployment okunmaz', ton: 'notr' };
  const x: DepJvm | undefined = dep.jvmler.find(
    (d) => d.ad.toLowerCase() === String(j.name).toLowerCase() && Number(d.nesil) === Number(j.gen),
  );
  if (!x) return { metin: 'ölçülmedi (tarama anında çalışmıyordu)', ton: 'uyari' };
  if (x.durum !== 'OK')
    return { metin: `ölçülemedi (${x.durum}${x.hata ? `: ${x.hata}` : ''})`, ton: 'uyari' };
  const l = x.deploymentlar || [];
  if (!l.length) return { metin: 'hiçbir deployment yok', ton: 'kotu' };
  const kotu = l.some((d) => d.durum === 'FAILED');
  const uyari = l.some((d) => d.etkin === false);
  return {
    metin: l
      .map((d) => `${d.ad} ${d.durum || '?'}${d.etkin === false ? ' (devre dışı)' : ''}`)
      .join(' · '),
    ton: kotu ? 'kotu' : uyari ? 'uyari' : 'bilgi',
  };
}

/** Uygulama Envanteri durumunun okunur metni (EAR bulgusu yoksa NEDEN yok). */
export function earDurumMetni(e: ShHostDetail['ear'] | null | undefined): string {
  if (!e || e.durum === 'OKUNAMADI')
    return 'Uygulama Envanteri okunamadı — EAR bulguları üretilmedi (“temiz” demek değil).';
  if (e.durum === 'YOK')
    return 'Bu sunucu Uygulama Envanteri’nde taranmamış — EAR bulguları yok (“temiz” demek değil).';
  if (e.durum === 'ESKI')
    return `Uygulama Envanteri taraması eski (${e.yasGun ?? '?'} gün) — EAR bulguları üretilmedi; yeni tarama gerekir.`;
  return `Uygulama Envanteri: ${e.yasGun === 0 ? 'bugün' : `${e.yasGun} gün önce`} tarandı.`;
}
