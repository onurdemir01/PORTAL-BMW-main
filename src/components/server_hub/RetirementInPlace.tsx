// src/components/server_hub/RetirementInPlace.tsx — IN-PLACE hedef uyarisi (2026-10-26).
//
// Kullanici: "Ozellikle in place uygulamalari ozel uyariyla belirtmeni istiyorum. Eger JBoss ya da
// uygulamasi icin ayni sunucuda JBoss 8 de kesfedilirse giris yapan kisiyi uyaralim, dikkatli ol.
// Isi baslattiktan sonra sonucta yine her sey yolunda mi diye bir kontrol etmesi icin yonlendirme
// yapabiliriz. Hicbir sey engellemesin ama insanlar yine de bilincinde olsun."
//
// Kesif (discover.cjs inPlaceIsaretle) ayni sunucu + uygulama birden cok kurulumda ise hedefe
// `inPlace` + `digerSurumler` koyar ve yalniz ad/sertifika ile eslesen vhost'lari `elle` isaretler.
// Bu dosya YALNIZ BILGI verir: hicbir dugmeyi kapatmaz, kaydi acmayi ya da STOP'u engellemez.
//
// KAYIT AYRINTISI (2026-10-26): isaret kayit acilirken saklanir (retirement_targets.diger_surumler ->
// RtTarget.inPlace / digerSurumler). Bu alandan ONCE acilmis kayitta inPlace null (bilinmiyor): ekran
// bugunku kesiften bir kez, tembel olarak hesaplar (inPlaceHaritasi / inPlaceBilgisi); kesif duserse
// bilgi "bilinmiyor" kalir, ekran calismaya devam eder. Is sonrasi kontrol listesi (InPlaceKontrol)
// yalniz yonlendirme: isaretleme yok, hicbir adimi engellemez.
//
// DIGER KURULUM DA HEDEFSE (denetim B1): ayni sunucudaki diger kurulum da secili / bu kayitta hedefse o da
// durdurulacak; "hala calisiyor mu" diye kontrol ettirmek yanlis yonlendirme olur. Metin ve maddeler
// yalniz hedef OLMAYAN kurulumlar icin "calisiyor mu" der.
import React from 'react';
import type { RtTargetStatus } from '@/api/retirementApi';
import { Cip, UyariKutusu } from './RetirementUi';

/** inPlace: true = in-place; false / null / yok = degil ya da bilinmiyor (eski kayit). */
export interface InPlaceHedef { host: string; appName: string; gen: number | null; inPlace?: boolean | null; digerSurumler?: number[] | null; web?: { elle?: string }[]; id?: number; status?: string }
export interface InPlaceSatir { anahtar: string; host: string; appName: string; gen: number | null; diger: number[]; digerSecili: number[]; elle: number }

export const surumAdi = (g: number | null | undefined) => (g ? `JBoss ${g}` : 'sürümü bilinmeyen kurulum');
const digerMetni = (d?: number[] | null) => ((d || []).length ? `${(d || []).map((g) => (g ? `JBoss ${g}` : 'sürümü bilinmeyen')).join(', ')} kurulumunda` : 'başka bir JBoss kurulumunda');

/** Satirdaki 'in-place' cipinin ipucu. */
export const inPlaceIpucu = (d?: number[] | null) => `Bu sunucuda uygulama ${digerMetni(d)} da var. Yalnız seçtiğiniz kurulum işlenir: diğer kurulumun JVM’ine, paketine ve paylaşımlı /hysdeploy paketine DOKUNULMAZ; adı ya da sertifikasıyla eşleşen vhost’lar otomatik kapatılmaz, elle kapatılır.`;

const ayniUygulama = (a: InPlaceHedef, b: InPlaceHedef) => a.host.trim().toUpperCase() === b.host.trim().toUpperCase() && a.appName.trim().toUpperCase() === b.appName.trim().toUpperCase();

/** Secili hedeflerden in-place olanlar; diger kurulum(lar)dan `havuz`da (secim / kayittaki hedefler) olanlar
 *  ve elle kalacak vhost sayisi. Havuz verilmezse secimin kendisi. */
export function inPlaceOzeti(secili: InPlaceHedef[], havuz?: InPlaceHedef[]): InPlaceSatir[] {
  const h = havuz ?? secili ?? [];
  return (secili || []).filter((t) => t.inPlace === true).map((t) => {
    const diger = [...(t.digerSurumler || [])];
    const kardes = h.filter((x) => x !== t && ayniUygulama(x, t) && (x.gen ?? 0) !== (t.gen ?? 0));
    return {
      anahtar: `${t.host}|${t.appName}|${t.gen ?? ''}`, host: t.host, appName: t.appName, gen: t.gen, diger,
      digerSecili: diger.filter((g) => kardes.some((x) => (x.gen ?? 0) === g)),
      elle: (t.web || []).filter((w) => !!w.elle).length,
    };
  });
}

/** In-place uyari kutusu (ENGELLEMEZ). baglam: 'kayit' = yeni kayit penceresi, 'stop' = STOP onayi
 *  (`kayittakiler`: kaydin atlanmamis hedefleri; diger kurulum "bu kayitta hedef" mi). */
export function InPlaceUyari({ hedefler, baglam = 'kayit', kayittakiler }: { hedefler: InPlaceHedef[]; baglam?: 'kayit' | 'stop'; kayittakiler?: InPlaceHedef[] }) {
  const l = inPlaceOzeti(hedefler, kayittakiler);
  if (!l.length) return null;
  const birlikte = l.some((x) => x.digerSecili.length > 0);
  // Her in-place hedefin diger kurulum(lar)i da hedef: hicbiri calismaya devam etmeyecek.
  const hepsiBirlikte = l.every((x) => x.diger.length > 0 && x.diger.every((g) => x.digerSecili.includes(g)));
  const secimAdi = baglam === 'stop' ? 'bu kayıtta hedef' : 'seçili';
  const kontrol = baglam === 'stop' ? 'STOP bittikten sonra' : 'İşi başlattıktan sonra';
  return (
    <div data-rt-inplace>
      <UyariKutusu ton="uyari" vurgu baslik={<><Cip ton="uyari" cerceve>IN-PLACE</Cip> Dikkatli olun: seçili {l.length} hedef <b>in-place</b> — uygulama aynı sunucuda başka bir JBoss kurulumunda da var</>}>
        <ul className="space-y-0.5 font-mono text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }} data-rt-inplace-liste>
          {l.slice(0, 6).map((x) => {
            const m = `${x.host} · ${x.appName} — seçilen ${surumAdi(x.gen)}; aynı sunucuda: ${x.diger.length ? x.diger.map(surumAdi).join(', ') : 'başka bir kurulum'}${x.digerSecili.length ? ` (${x.digerSecili.map(surumAdi).join(', ')} de ${secimAdi}: ayrı hedef olarak işlenir)` : ` (${baglam === 'stop' ? 'bu kayıtta hedef değil' : 'seçili değil'}: dokunulmaz)`}${x.elle ? ` · ${x.elle} vhost elle` : ''}`;
            return <li key={x.anahtar} className="truncate" title={m}>{m}</li>;
          })}
          {l.length > 6 && <li>… +{l.length - 6} hedef</li>}
        </ul>
        <p className="mt-1">
          {hepsiBirlikte
            ? 'Her hedef yalnız kendi kurulumunun JVM’ini durdurur ve paketini yeniden adlandırır.'
            : <>Yalnız seçilen kurulumun JVM’i durdurulur ve paketi yeniden adlandırılır; diğer kurulumun JVM’ine ve paketine <b>dokunulmaz</b>.</>}
          {' '}Adı ya da sertifikasıyla eşleşen vhost’lar hangi kurulumun önünde durduğu doğrulanamadığı için <b>otomatik kapatılmaz</b>; satırda <b>elle</b> çipiyle kalır.
          {!hepsiBirlikte && birlikte ? ` Aynı sunucudaki diğer kurulum da ${secimAdi} ise o da ayrı bir hedef olarak işlenir.` : ''}
        </p>
        <p className="mt-1">
          {hepsiBirlikte
            ? `${kontrol} kontrol edin: aynı sunucudaki kurulumların hepsi ${secimAdi} — diğer kurulumun çalışmaya devam etmesi beklenmez; ‘elle’ çipli vhost’lar otomatik kapatılmaz, kurulumlar durduktan sonra elle kapatılmalı.`
            : `${kontrol} kontrol edin: ${birlikte ? `${secimAdi} olmayan ` : ''}diğer kurulumun JVM’i hâlâ çalışıyor mu (Server Hub), paketi yerinde mi, onun vhost’u trafik almaya devam ediyor mu, uygulamanın adresi açılıyor mu.`}
          <span style={{ color: 'var(--text-secondary)' }}> Bu uyarı hiçbir adımı engellemez.</span>
        </p>
      </UyariKutusu>
    </div>
  );
}

// ── KAYIT AYRINTISI ──────────────────────────────────────────────────────────────────────────────
const hedefAnahtari = (t: { host: string; appName: string; gen: number | null }) => `${String(t.host || '').trim().toUpperCase()}|${String(t.appName || '').trim().toUpperCase()}|${t.gen ?? ''}`;
export type InPlaceHarita = Map<string, { inPlace: boolean; digerSurumler: number[] }>;
/** Bugunku kesiften (host|uygulama|surum) -> in-place. Kesif yoksa / basarisizsa null (bilinmiyor). */
export function inPlaceHaritasi(d: { ok?: boolean; targets?: InPlaceHedef[] } | null | undefined): InPlaceHarita | null {
  if (!d || d.ok !== true || !Array.isArray(d.targets)) return null;
  const m: InPlaceHarita = new Map();
  for (const t of d.targets) m.set(hedefAnahtari(t), t.inPlace === true ? { inPlace: true, digerSurumler: [...(t.digerSurumler || [])] } : { inPlace: false, digerSurumler: [] });
  return m;
}
/** kayitta: diger kurulum(lar)dan bu kayitta (atlanmamis) hedef olanlar - onlar da durdurulacak. */
export interface InPlaceBilgi { inPlace: boolean | null; digerSurumler: number[] | null; kaynak: 'kayit' | 'kesif' | null; kayitta?: number[] }
/** Diger kurulum(lar)dan kaydin atlanmamis hedefleri arasinda olanlar (ayni sunucu + uygulama, o surum). */
export function kayittakiDigerleri(t: InPlaceHedef, hedefler: InPlaceHedef[] | null | undefined, diger: number[] | null | undefined): number[] {
  return (diger || []).filter((g) => (hedefler || []).some((x) => x !== t && (t.id == null || x.id !== t.id) && x.status !== 'skipped' && ayniUygulama(x, t) && (x.gen ?? 0) === g));
}
/** Kayittaki isaret (boolean) ONCELIKLI; eski kayitta (null / alan yok) bugunku kesif; o da yoksa bilinmiyor. */
export function inPlaceBilgisi(t: InPlaceHedef, harita?: InPlaceHarita | null, kayittakiler?: InPlaceHedef[] | null): InPlaceBilgi {
  const ile = (inPlace: boolean | null, digerSurumler: number[] | null, kaynak: InPlaceBilgi['kaynak']): InPlaceBilgi =>
    ({ inPlace, digerSurumler, kaynak, kayitta: inPlace ? kayittakiDigerleri(t, kayittakiler, digerSurumler) : [] });
  if (typeof t.inPlace === 'boolean') return ile(t.inPlace, [...(t.digerSurumler || [])], 'kayit');
  const k = harita?.get(hedefAnahtari(t));
  return k ? ile(k.inPlace, k.digerSurumler, 'kesif') : ile(null, null, null);
}

/** Kurulum koku (discover.cjs: 7 = /vhosting, 8 = /vhosting8); bilinmiyorsa null. */
export const kurulumKoku = (g: number | null | undefined): string | null => (g === 8 ? '/vhosting8' : g === 7 ? '/vhosting' : null);

/** Is sonrasi kontrolun asamasi: suren STOP / silme / geri alma, durdurulmus, silinmis, geri alinmis, basarisiz is. */
export type InPlaceAsama = 'suruyor' | 'durdu' | 'silindi' | 'geriAlindi' | 'hata';
export interface AsamaHedefi { status: RtTargetStatus; deletedAt?: string | null; webSonuc?: { status: string }[] | null; awxIsleri?: { adim: string }[] | null }
export function inPlaceAsamasi(t: AsamaHedefi): InPlaceAsama | null {
  const s = t.status;
  if (s === 'stopping' || s === 'rolling_back' || s === 'deleting') return 'suruyor';
  if (s === 'deleted' || (s === 'stopped' && t.deletedAt)) return 'silindi';
  if (s === 'stopped') return 'durdu';
  if (s === 'active') return 'geriAlindi';
  if (s === 'rollback_failed') return 'hata';
  // failed: yalniz sunucuda bir sey yapildiysa (onayli STOP / silme / geri alma kostu); basarisiz ON KONTROL bir sey degistirmez.
  if (s === 'failed' && ((t.webSonuc || []).length > 0 || (t.awxIsleri || []).some((x) => x.adim === 'stop' || x.adim === 'delete' || x.adim === 'rollback'))) return 'hata';
  return null;
}
const digerAdi = (d?: number[] | null) => ((d || []).length ? (d || []).map(surumAdi).join(', ') : 'diğer kurulum');
const ayir = (diger?: number[] | null, kayitta: number[] = []) => {
  const d = diger || [];
  const kalan = d.filter((g) => !kayitta.includes(g));
  return { kalan, birlikte: d.length > 0 && kalan.length === 0, ad: digerAdi(kalan.length ? kalan : d) };
};

/** Satirdaki kisa not (yonlendirme). */
export function inPlaceSatirNotu(asama: InPlaceAsama, diger?: number[] | null, kayitta: number[] = []): string {
  const { birlikte, ad } = ayir(diger, kayitta);
  if (birlikte) return `in-place: diğer kurulum (${ad}) da bu kayıtta hedef — ${asama === 'geriAlindi' ? 'bu kurulumu kontrol edin' : 'onun satırını izleyin'}`;
  if (asama === 'suruyor') return `in-place: iş bitince diğer kurulumu (${ad}) kontrol edin`;
  if (asama === 'geriAlindi') return `in-place: geri alındı — bu kurulumu ve diğer kurulumu (${ad}) kontrol edin`;
  if (asama === 'silindi') return `in-place: silindi — diğer kurulumu (${ad}) kontrol edin`;
  if (asama === 'hata') return `in-place: iş başarısız — diğer kurulumu (${ad}) kontrol edin`;
  return `in-place: diğer kurulumu (${ad}) kontrol edin`;
}

/** Kontrol listesi maddeleri (yalniz yonlendirme, isaretleme yok). */
export function inPlaceKontrolMaddeleri(asama: InPlaceAsama, diger?: number[] | null, kayitta: number[] = []): string[] {
  const { kalan, birlikte, ad } = ayir(diger, kayitta);
  const bas = asama === 'geriAlindi' ? ['Bu kurulumun JVM’i yeniden çalışıyor ve paketi geri adlandırıldı mı']
    : asama === 'hata' ? ['Bu kurulumda hangi adımın yapıldığını İş çıktısında inceleyin'] : [];
  if (birlikte)
    return [...bas,
      `Diğer kurulum (${ad}) da bu kayıtta hedef: o da durdurulacak — çalışmaya devam etmesi beklenmez; onun satırını izleyin`,
      'Adı ya da sertifikasıyla eşleşen ‘elle’ vhost’lar otomatik kapatılmaz: kurulumlar durunca elle kapatın'];
  const koklar = [...new Set((kalan.length ? kalan : diger || []).map(kurulumKoku).filter((x): x is string => !!x))];
  const kok = koklar.length ? `${koklar.join(', ')} altında` : 'kendi kökünde';
  const ek = kayitta.length ? [`${kayitta.map(surumAdi).join(', ')} de bu kayıtta hedef: o da durdurulacak`] : [];
  return [...bas,
    `Diğer kurulumun JVM’i (${ad}) hâlâ çalışıyor mu — Server Hub’da bakın`,
    `Diğer kurulumun paketi (${kok}) yerinde mi — ${asama === 'silindi' ? 'silinmemiş' : 'yeniden adlandırılmamış'} olmalı`,
    'Diğer kurulumun vhost’u trafik almaya devam ediyor mu (Server Hub trafik / access log)',
    'Uygulamanın adresi açılıyor mu',
    ...ek];
}

/** Ayrinti panelindeki kontrol listesi kutusu (ENGELLEMEZ; isaretleme zorunlu degil). */
export function InPlaceKontrol({ asama, diger, kayitta = [], kaynak }: { asama: InPlaceAsama; diger?: number[] | null; kayitta?: number[]; kaynak?: 'kayit' | 'kesif' | null }) {
  const baslik = ayir(diger, kayitta).birlikte ? 'In-place: diğer kurulum da bu kayıtta hedef'
    : asama === 'suruyor' ? 'In-place: iş bitince diğer kurulumu kontrol edin'
      : asama === 'geriAlindi' ? 'In-place: geri alma sonrası iki kurulumu da kontrol edin'
        : asama === 'silindi' ? 'In-place: silme sonrası diğer kurulumu kontrol edin'
          : asama === 'hata' ? 'In-place: iş başarısız — diğer kurulumu kontrol edin'
            : 'In-place: her şey yolunda mı? Diğer kurulumu kontrol edin';
  return (
    <UyariKutusu ton="uyari" baslik={baslik}>
      <ol className="list-decimal space-y-0.5 pl-4 text-[12px] leading-5" data-rt-inplace-kontrol>
        {inPlaceKontrolMaddeleri(asama, diger, kayitta).map((m) => <li key={m}>{m}</li>)}
      </ol>
      <p className="mt-1 text-[11px] leading-4" style={{ color: 'var(--text-secondary)' }}>
        Yalnız yönlendirme: işaretlemeniz gerekmez, hiçbir adımı engellemez.{kaynak === 'kesif' ? ' In-place bilgisi kayıtta yoktu; bugünkü keşiften hesaplandı.' : ''}
      </p>
    </UyariKutusu>
  );
}
