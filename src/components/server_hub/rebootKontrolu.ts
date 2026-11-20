// src/components/server_hub/rebootKontrolu.ts — Reboot Kontrolü satır ayrıştırıcıları (2026-10-08).
//
// Kullanıcı kuralı ("mesele çok basit"): Nginx / Red Hat Apache / IBM Apache / CTG / JBoss 7 / JBoss 8 / WAS
// reboot öncesi çalışıyorduysa sonra da çalışmalı; JBoss ve WAS JVM'lerinde önce çalışıp kapanan açılır,
// önce yokken çalışan kapatılır. Python ve diğer her şey izlenmez.
// 2026-11-15 ("nasıl bulduysan öyle bırak"): reboot öncesi ÇALIŞMAYAN ürün de kapatılır; yalnız kapatma kapısı
// (BOOT'suz / eski sürüm önce görüntüsü — kapatmaKorunan) "dokunulmadı" der; v4: boş önce hiçbir ürünü korumaz.
//
// Playbook (patch_remediation/reboot_check.yml) sunucu başına düz metin satırları döndürür:
//   görüntü : BOOT|<boot_id>|| · URUN|<ürün>|| · JVM|<ürün>|<jvm>|<detay>
//   plan    : ISLEM|kullanıcı|baslat/durdur|ürün|jvm|detay · BILGI|tür|ürün|jvm|mesaj
//   işlemler: SONUC|baslat/durdur|ürün|jvm|OK/FAIL/SKIP|mesaj   (ürün işleminde jvm boş)
//   son_fark: FARK|DOWN/NEW|URUN/JVM|ürün|jvm|detay — kurala göre HÂLÂ düzelmemiş olanlar
//
// 2026-11-14 (ilk gerçek koşu: her şey "dokunulmadı" yazdı, sunucular "Sorunsuz" çıktı):
//   * Reboot öncesi ürün kümesi betikle aynı: URUN satırları + JVM'i görülen ürünler (çalışan JVM ürünün
//     çalıştığını kanıtlar). Önce görüntüsünde ürün satırı olmayıp JVM'i olan ürün işaretlenir.
//   * "dokunulmadı" etiketleri SON durumu söyler (şimdi çalışıyor / şu an KAPALI) ve nedenini yazar.
//   * Önce görüntüsü boşsa (izlenen satır yok) bu yeşil değil, uyarıdır (v4: reboot sonrası çalışan her ürün kapatılır, kontrol edilecek).
//   * İnceleme: "açıldı" / "kapatıldı" yalnız komut OK ise; FAIL ve komutsuz durum ayrı söylenir. Yalnız SONUC satırında
//     görülen JVM (durulma görüntüsünde açılıp kapatılan) da listelenir. Eski sürüm önce görüntüsünde JBoss hariç.

export const URUNLER = ['NGINX', 'RHA', 'IHS', 'CTG', 'JBOSS7', 'JBOSS8', 'WAS'] as const;
export const URUN_ADI: Record<string, string> = {
  NGINX: 'Nginx',
  RHA: 'Red Hat Apache',
  IHS: 'IBM Apache (IHS)',
  CTG: 'CTG',
  JBOSS7: 'JBoss 7',
  JBOSS8: 'JBoss 8',
  WAS: 'WebSphere (WAS)',
};
export const JVM_URUNLERI = new Set(['JBOSS7', 'JBOSS8', 'WAS']);

export interface Goruntu {
  boot: string | null;
  urunler: Set<string>;
  jvmler: Map<string, Set<string>>;
  bicimTamam: boolean;
}
export interface IslemSatiri {
  islem: string;
  urun: string;
  ad: string;
  sonuc: 'OK' | 'FAIL' | 'SKIP' | '?';
  mesaj: string;
}
export interface BilgiSatiri {
  tur: string;
  urun: string;
  ad: string;
  mesaj: string;
}

const satirlar = (x: unknown): string[] =>
  Array.isArray(x) ? x.map((s) => String(s ?? '')).filter(Boolean) : [];

/** Görüntü satırları → ürün kümesi + ürün başına JVM kümesi. BOOT satırı yoksa eski biçim (bicimTamam=false). */
export function goruntuAyristir(x: unknown): Goruntu {
  const g: Goruntu = { boot: null, urunler: new Set(), jvmler: new Map(), bicimTamam: false };
  for (const l of satirlar(x)) {
    const p = l.split('|');
    if (p[0] === 'BOOT') {
      g.boot = p[1] || null;
      g.bicimTamam = true;
    } else if (p[0] === 'URUN' && p[1]) g.urunler.add(p[1]);
    else if (p[0] === 'JVM' && p[1] && p[2]) {
      if (!g.jvmler.has(p[1])) g.jvmler.set(p[1], new Set());
      g.jvmler.get(p[1])!.add(p[2]);
    }
  }
  return g;
}

export function islemAyristir(x: unknown): IslemSatiri[] {
  return satirlar(x)
    .filter((l) => l.startsWith('SONUC|'))
    .map((l) => {
      const p = l.split('|');
      const s = p[4] === 'OK' || p[4] === 'FAIL' || p[4] === 'SKIP' ? p[4] : '?';
      return {
        islem: p[1] || '?',
        urun: p[2] || '?',
        ad: p[3] || '',
        sonuc: s,
        mesaj: p.slice(5).join('|'),
      };
    });
}

export function bilgiAyristir(x: unknown): BilgiSatiri[] {
  return satirlar(x)
    .filter((l) => l.startsWith('BILGI|'))
    .map((l) => {
      const p = l.split('|');
      return { tur: p[1] || '?', urun: p[2] || '', ad: p[3] || '', mesaj: p.slice(4).join('|') };
    });
}

export type Durum = 'ok' | 'sorun' | 'bilgi';
export interface JvmDegisimi {
  ad: string;
  durum: Durum;
  metin: string;
  islem?: IslemSatiri;
}
export interface UrunSatiri {
  urun: string;
  ad: string;
  durum: Durum;
  metin: string;
  islem?: IslemSatiri;
  jvmAyni: number;
  jvmDegisim: JvmDegisimi[];
  /** Önce görüntüsünde ürün satırı yoktu; JVM'i çalıştığı için çalışıyor sayıldı. */
  onceCikarim?: boolean;
}

/** Reboot öncesi çalışıyor muydu: URUN satırı ya da JVM'i (reboot_duzelt.sh once_norm ile aynı kural). */
export function onceCalisiyordu(g: Goruntu, u: string): boolean {
  return g.urunler.has(u) || (g.jvmler.get(u)?.size || 0) > 0;
}

/**
 * Eski sürüm önce görüntüsü (SURUM satırı yok, JBoss satırı var) yeni sürüm görüntüyle JBoss bazında karşılaştırılamaz
 * (JBoss nesil kuralı 2026-11-14'te değişti). Betik, sunucu (reboot-check.cjs) ve rapor aynı kuralı kullanır.
 */
export function nesilKarsilastirilamaz(once: unknown, diger: unknown): boolean {
  const o = satirlar(once);
  return (
    !o.some((l) => l.startsWith('SURUM|')) &&
    o.some((l) => /^(URUN|JVM)\|JBOSS[78]\|/.test(l)) &&
    satirlar(diger).some((l) => l.startsWith('SURUM|'))
  );
}

/**
 * Eski sürüm önce görüntüsünün JBoss satırları yeni nesil kuralına ÇEVRİLİR (2026-11-15; reboot_duzelt.sh nesil_cevir ve
 * sunucu reboot-check.cjs onceNesilCevir ile BİREBİR): JVM nesli = aynı jboss_home'lu diğer-görüntü JVM'inin nesli; yoksa
 * home'da jboss8/vhosting8 → JBOSS8; yoksa eski etiket. URUN|JBOSS7 yalnız çevrilmiş bir JBOSS7 JVM'i ya da diğer
 * görüntüde JBOSS7 ürünü varsa kalır; yoksa çıkarılır ve 'belirsiz' (dokunulmadı, kontrol gerekli).
 */
export function onceNesilCevir(
  once: unknown,
  diger: unknown,
): { satirlar: string[]; cevrildi: boolean; belirsiz: string[] } {
  const o = satirlar(once);
  if (!nesilKarsilastirilamaz(o, diger)) return { satirlar: o, cevrildi: false, belirsiz: [] };
  const ev = (d: string | undefined) =>
    String(d || '').startsWith('jboss_home=') ? String(d).slice(11) : '';
  const harita = new Map<string, string>();
  let d7 = false;
  for (const l of satirlar(diger)) {
    const q = l.split('|');
    if (q[0] === 'JVM' && /^JBOSS[78]$/.test(q[1])) {
      const h = ev(q[3]);
      if (h) harita.set(h, q[1]);
    }
    if (q[0] === 'URUN' && q[1] === 'JBOSS7') d7 = true;
  }
  let j7 = false;
  const cev = o.map((l) => {
    const q = l.split('|');
    if (q[0] !== 'JVM' || !/^JBOSS[78]$/.test(q[1])) return l;
    const h = ev(q[3]);
    const g = h && harita.has(h) ? harita.get(h)! : /jboss8|vhosting8/.test(h) ? 'JBOSS8' : q[1];
    if (g === 'JBOSS7') j7 = true;
    return [q[0], g, ...q.slice(2)].join('|');
  });
  const belirsiz = !j7 && !d7 && cev.some((l) => l.startsWith('URUN|JBOSS7|'));
  return {
    satirlar: belirsiz ? cev.filter((l) => !l.startsWith('URUN|JBOSS7|')) : cev,
    cevrildi: true,
    belirsiz: belirsiz ? ['JBOSS7'] : [],
  };
}

/**
 * KAPATMA KAPISI (2026-11-15, "nasıl bulduysan öyle bırak"; betik kapatma_kapisi ve sunucu kapatmaKapisi ile BİREBİR,
 * YALNIZ ham önce görüntüsünden): reboot öncesi çalışmayan ürün kapatılır, şu ürünler HARİÇ (dokunulmaz): önce
 * görüntüsünde BOOT yoksa hepsi (v4: izlenen satır yoksa hiçbiri — BOS_KORUNAN boş); önce görüntüsü eski sürümse (SURUM yok, JBoss satırı var) JBoss 7
 * ve JBoss 8 (nesil kesin değil; reboot öncesi çalışan domain "yeni" sanılıp kapatılmasın — inceleme R1 B1).
 */
// v3 (2026-11-15 akşam, kullanıcı: "Nginx, apache, ihs ürünlerini hâlâ kapatmamışsın … Kapatıp, kontrol edilecek yaz"):
// boş önce görüntüsünde web ürünleri (Nginx/RHA/IHS) artık KAPATILIR; CTG/JBoss/WAS korunur. BOOT'suz önce: betik planı
// HATA yazar, hiçbir şey yapılmaz → hepsi korunur (sunucu kapiKorur 'bootsuz' ile BİREBİR).
// v4 (2026-11-16, kullanıcı GBTDST01, seçim "Her yerde kapat"): boş önce görüntüsü HİÇBİR ürünü korumaz (prod dahil);
// reboot sonrası çalışan her ürün kapatılır ve "kontrol edilecek" der. Sunucu kapiKorur ve betik korunur() ile BİREBİR.
export const BOS_KORUNAN: readonly string[] = [];
export function kapatmaKorunan(once: unknown): Set<string> {
  const o = satirlar(once);
  if (!o.some((l) => l.startsWith('BOOT|'))) return new Set<string>(URUNLER);
  if (!o.some((l) => /^(URUN|JVM)\|/.test(l))) return new Set<string>(BOS_KORUNAN);
  return !o.some((l) => l.startsWith('SURUM|')) && o.some((l) => /^(URUN|JVM)\|JBOSS[78]\|/.test(l))
    ? new Set<string>(['JBOSS7', 'JBOSS8'])
    : new Set<string>();
}

/**
 * SÜRÜM İŞARETİ (v3): playbook her sunucu sonucuna betik_surum yazar. Yoksa ya da GEREKLİ'den küçükse AWX'teki betik eski:
 * o koşuda ürün kapatma ve yeniden deneme YOKTU. Sunucu betikSurumu ile BİREBİR; sürüm bilinince dil kesindir.
 * 2026-11-16: "betik eski" notu SUNUCU BAZINDA ve ETKİYE göre verilir (betikEtkisi): sürüm < 3 her sunucuda; sürüm 3 yalnız
 * boş önce + son kontrolde hâlâ çalışan CTG/JBoss/WAS olan sunucuda. betikSurumu().guncel yalnız ham sürüm bilgisidir.
 */
export const BETIK_SURUM_GEREKLI = 4;
export interface BetikSurumu {
  guncel: boolean;
  etiket: string;
}
export function betikSurumu(r: { betik_surum?: number | string } | null | undefined): BetikSurumu {
  const ham = r?.betik_surum;
  const yazili = ham !== undefined && ham !== null && String(ham).trim() !== '';
  const n = Number(ham);
  return {
    guncel: yazili && Number.isFinite(n) && n >= BETIK_SURUM_GEREKLI,
    etiket: yazili ? `sürüm ${String(ham).trim()}` : 'sürüm yok',
  };
}
/**
 * İnceleme B1 (2026-11-16): sürüm 3 betiğinde ürün kapatma ve yeniden deneme VARDI; eksiği yalnız boş önce görüntüsünde
 * CTG/JBoss/WAS'ı kapatmamasıydı. Sunucu reboot-check.cjs eskiSurumNedeni ile BİREBİR.
 */
const ESKI_SURUM_GENEL = 'bu koşuda ürün kapatma ve yeniden deneme YOKTU';
const ESKI_SURUM_3 =
  "bu koşudaki betik (sürüm 3) ürün kapatıp yeniden deniyordu, ancak reboot öncesi görüntüsü boş sunucuda yalnız web ürünlerini (Nginx/Apache/IHS) kapatırdı, CTG/JBoss/WAS'a dokunmazdı; sürüm 4 reboot sonrası çalışan her ürünü kapatır";
// İnceleme B5: etiket metniyle değil SAYIYLA karar verilir ("sürüm 3.0" betikEtkisi'nde de sürüm 3; iki metin çelişmez).
export function eskiSurumNedeni(etiket: string): string {
  const m = /^sürüm (.+)$/.exec(String(etiket || ''));
  const n = m ? Number(m[1]) : Number.NaN;
  return Number.isFinite(n) && n >= 3 ? ESKI_SURUM_3 : ESKI_SURUM_GENEL;
}
/** Kayıt düzeyindeki bant metni; etiketler: farklı sürüm etiketleri ("sürüm yok", "sürüm 2"). */
export function betikEskiMetni(etiketler: readonly string[]): string {
  // Tek sürümse onun nedeni; karışıksa her sürümün nedeni ayrı yazılır (sürüm 3'e "YOKTU" denmez).
  const nedenler = [...new Set(etiketler.map(eskiSurumNedeni))];
  const neden =
    nedenler.length === 1
      ? nedenler[0]
      : etiketler.map((x) => `${x}: ${eskiSurumNedeni(x)}`).join('; ');
  return `AWX'teki reboot_check betiği eski (${etiketler.join(' / ')}, gerekli ${BETIK_SURUM_GEREKLI}): ${neden}. ZIP'i AWX'e yükleyip projeyi Sync edin, sonra "Reboot sonrası kontrol et ve düzelt"i yeniden çalıştırın.`;
}

/** Kayıt düzeyindeki bant + etkili sunucu sayısı (sunucu reboot-check.cjs betikEskiBandi ile BİREBİR). */
export function betikEskiBandi(etiketler: readonly string[], n: number): string {
  return `${betikEskiMetni(etiketler)} (${n} sunucuda etkili)`;
}

/**
 * BETİK ETKİSİ (2026-11-16 üretim, 104 sunuculu kayıt: AWX'te sürüm 3 koştu, GEREKLİ=4 olduğu için HER sunucu "kontrol gerekli"
 * oldu). Sürüm 3 ile 4 arasındaki TEK davranış farkı: önce görüntüsü BOŞ sunucuda reboot sonrası çalışan CTG/JBoss/WAS'ın
 * kapatılması. "Betik eski" sunucu bazında ve etkiye göre (sunucu reboot-check.cjs betikEtkisi ile BİREBİR):
 *   sürüm yok / < 3 → her sunucuda eski, kapatmaz = her ürün;
 *   sürüm 3         → yalnız boş önce + SON görüntüde (JVM'inden çıkarım dahil) hâlâ CTG/JBoss/WAS çalışan sunucuda eski,
 *                     kapatmaz = CTG/JBoss/WAS; diğer sunucularda güncel sayılır;
 *   sürüm ≥ 4       → güncel.
 * İnceleme B2: yalnız ilk görüntüde çalışıp son kontrolde kendiliğinden kapanan CTG/JBoss/WAS (gecti) "betik eski" sayılmaz
 * (son durum sürüm 4'ünkiyle aynı; bant sayısına girmez); yalnız nötr gectiNotu döner.
 * önce verilmezse boşluk plandaki BILGI|BOS satırından anlaşılır. Çağıran önce'yi onceTamamGoruntu ile verir (inceleme B1).
 */
export interface BetikEtkisi extends BetikSurumu {
  eski: boolean;
  urunler: string[];
  gecti: string[];
  kapatmaz: ReadonlySet<string>;
  metin: string;
  gectiNotu: string;
}
const V3_BOS_KAPATMAZ = ['CTG', 'JBOSS7', 'JBOSS8', 'WAS'];
// Sunucu metniyle birebir olsun diye sunucunun ürün adları (ekran URUN_ADI farklı: "Red Hat Apache" vb.).
const SUNUCU_URUN_ADI: Record<string, string> = {
  CTG: 'CTG',
  JBOSS7: 'JBoss 7',
  JBOSS8: 'JBoss 8',
  WAS: 'WebSphere',
};
export function betikEtkisi(
  once: unknown,
  r:
    | { betik_surum?: number | string; plan?: unknown; goruntu?: unknown; son_goruntu?: unknown }
    | null
    | undefined,
): BetikEtkisi {
  const surum = betikSurumu(r);
  const yok: BetikEtkisi = {
    ...surum,
    eski: false,
    urunler: [],
    gecti: [],
    kapatmaz: new Set(),
    metin: '',
    gectiNotu: '',
  };
  if (!r || surum.guncel) return yok;
  const n = Number(r.betik_surum);
  if (!(Number.isFinite(n) && n >= 3)) {
    return {
      ...yok,
      eski: true,
      kapatmaz: new Set(URUNLER),
      metin: betikEskiMetni([surum.etiket]),
    };
  }
  const o = satirlar(once);
  const bos = o.some((l) => l.startsWith('BOOT|'))
    ? !o.some((l) => /^(URUN|JVM)\|/.test(l))
    : satirlar(r.plan).some((l) => l.startsWith('BILGI|BOS|'));
  if (!bos) return yok;
  // Önce boş: ürün kümesi boş, JVM'i çalışan ürün de çalışıyor sayılır (sunucu sonKume ile aynı).
  const calisan = (x: unknown) => {
    const g = goruntuAyristir(x);
    return new Set([...g.urunler, ...g.jvmler.keys()]);
  };
  const ilk = calisan(r.goruntu);
  const son = calisan(r.son_goruntu);
  const hala = V3_BOS_KAPATMAZ.filter((u) => son.has(u));
  const gecti = V3_BOS_KAPATMAZ.filter((u) => !son.has(u) && ilk.has(u));
  if (!hala.length && !gecti.length) return yok;
  const ad = (x: string[]) => x.map((u) => SUNUCU_URUN_ADI[u]).join(', ');
  return {
    ...surum,
    eski: hala.length > 0,
    urunler: hala,
    gecti,
    kapatmaz: new Set(V3_BOS_KAPATMAZ),
    metin: hala.length
      ? `AWX'teki reboot_check betiği eski (${surum.etiket}, gerekli ${BETIK_SURUM_GEREKLI}): ${ad(hala)} reboot öncesi çalışmıyordu ve hâlâ çalışıyor; reboot öncesi görüntüsü boş sunucuda AWX'teki betik sürüm 3 bunları kapatmaz (sürüm 4 kapatır). ZIP'i AWX'e yükleyip projeyi Sync edin, sonra "Reboot sonrası kontrol et ve düzelt"i yeniden çalıştırın.`
      : '',
    gectiNotu: gecti.length
      ? `${ad(gecti)} reboot öncesi çalışmıyordu, reboot sonrası çalıştı ve son kontrolde kendiliğinden kapanmıştı; ${surum.etiket} betik reboot öncesi görüntüsü boş sunucuda bunlara dokunmaz. Son durum reboot öncesiyle aynı (yeniden çalıştırmak bir şey değiştirmez) — beklenen durum mu kontrol edin.`
      : '',
  };
}

/**
 * İnceleme B1: betikEtkisi'ne giden önce görüntüsü, sunucu onceGirdisi/goruntuTamam ile aynı süzgeçten geçer (goruntu_ok ve
 * BOOT satırı); alınamamış önce görüntüsü (goruntu_ok=false) ham haliyle kullanılmaz → undefined (plan BILGI|BOS'a bakılır).
 */
export function onceTamamGoruntu(
  r: { goruntu_ok?: boolean; goruntu?: unknown } | null | undefined,
): string[] | undefined {
  if (!r?.goruntu_ok || !Array.isArray(r.goruntu)) return undefined;
  return r.goruntu.some((l) => String(l).startsWith('BOOT|')) ? r.goruntu.map(String) : undefined;
}

/** Önce görüntüsü alınmış (BOOT var) ama izlenen ürün/JVM yok: v4'ten beri reboot sonrası çalışan her ürün kapatılır. */
export function onceBos(g: Goruntu): boolean {
  return g.bicimTamam && g.urunler.size === 0 && g.jvmler.size === 0;
}

/**
 * Sunucu başına ürün tablosu. once: reboot öncesi; ilk: reboot sonrası düzeltmeden önce; son: düzeltmeden sonra
 * (null = ölçülemedi). Yalnız önce ya da sonra görülen ürünler listelenir. korunan: kapatma kapısının koruduğu ürünler
 * (kapatmaKorunan) — yalnız onlar "dokunulmadı" der; diğer önce çalışmayan ürün kapatılmış olmalıdır (2026-11-15).
 */
export function urunTablosu(
  once: Goruntu,
  ilk: Goruntu,
  son: Goruntu | null,
  islemler: IslemSatiri[],
  haric: ReadonlySet<string> = new Set(),
  korunan: ReadonlySet<string> = new Set(),
  betik?: BetikSurumu & { kapatmaz?: ReadonlySet<string> },
): UrunSatiri[] {
  // Komutsuz kalan yeni ürünün nedeni: sürüm biliniyorsa kesin, bilinmiyorsa (eski çağıran) "olabilir". 2026-11-16: betikEtkisi
  // verildiyse ürün bazında — yalnız eski betiğin gerçekten kapatmadığı ürün (kapatmaz) "betik eski" der.
  const kapatmadi = (u: string) => {
    if (!betik)
      return 'otomasyon kapatmadı (eski betik sürümü olabilir; güncel betikle yeniden çalıştırın)';
    const eski = betik.kapatmaz ? betik.kapatmaz.has(u) : !betik.guncel;
    return eski
      ? `otomasyon kapatmadı — AWX'teki betik eski (${betik.etiket}); güncel betikle yeniden çalıştırın`
      : 'otomasyon kapatma komutu çalıştırmadı (plandan sonra kalkmış olabilir; yeniden çalıştırın)';
  };
  const out: UrunSatiri[] = [];
  const bul = (u: string, ad: string) => islemler.find((x) => x.urun === u && x.ad === ad);
  // "açıldı" / "kapatıldı" YALNIZ o öğe için komut OK döndüyse (rapor ile aynı; inceleme 2026-11-14 B3/B5).
  const acildi = (x: IslemSatiri | undefined, onek: string) =>
    x?.islem === 'baslat' && x.sonuc === 'OK'
      ? `${onek}, açıldı`
      : x?.islem === 'baslat' && x.sonuc === 'FAIL'
        ? `${onek} — açma komutu başarısız döndü, sonra kalktı`
        : `${onek}, kendiliğinden kalktı`;
  for (const u of URUNLER) {
    if (haric.has(u)) continue;
    const o = onceCalisiyordu(once, u);
    const onceCikarim = o && !once.urunler.has(u);
    // Çıkarım (betik simdi_dosya / sunucu sonKume): önce çalışmayan ürünün yalnız JVM'i görülüyorsa ürün de çalışıyor.
    const calisir = (g: Goruntu) => g.urunler.has(u) || (!o && (g.jvmler.get(u)?.size || 0) > 0);
    const i = calisir(ilk);
    const s = son ? calisir(son) : null;
    const islem = bul(u, '');
    if (!o && !i && !s && !islem) continue;
    const kor = korunan.has(u);
    const durdur = islem?.islem === 'durdur' ? islem.sonuc : undefined;
    let durum: Durum;
    let metin: string;
    if (o) {
      if (s === null) {
        durum = 'sorun';
        metin = 'son durum ölçülemedi';
      } else if (s) {
        durum = 'ok';
        metin = i ? 'çalışıyordu, çalışıyor' : acildi(islem, 'reboot sonrası kapalıydı');
      } else {
        durum = 'sorun';
        metin = 'çalışıyordu, hâlâ KAPALI';
      }
    } else if (kor) {
      // Kapatma kapısı (BOOT'suz / eski sürüm önce görüntüsü; v4: boş önce korumaz): ürüne gerçekten dokunulmadı.
      durum = 'bilgi';
      metin =
        s === null
          ? 'reboot öncesi çalışmıyordu — son durum ölçülemedi, dokunulmadı'
          : s
            ? 'reboot öncesi çalışmıyordu, şimdi çalışıyor — önce görüntüsü eski sürüm / BOOT yok, kapatılmadı (dokunulmadı)'
            : 'reboot öncesi çalışmıyordu, şu an KAPALI — dokunulmadı';
    } else if (s === null) {
      durum = 'sorun';
      metin = 'reboot öncesi çalışmıyordu — son durum ölçülemedi';
    } else if (s) {
      // "Nasıl bulduysan öyle bırak": kapatılması gerekirken hâlâ çalışıyor.
      durum = 'sorun';
      metin =
        durdur === 'FAIL'
          ? 'reboot öncesi çalışmıyordu — kapatma komutu başarısız, hâlâ ÇALIŞIYOR'
          : durdur === 'OK'
            ? 'reboot öncesi çalışmıyordu — kapatma komutu başarılı döndü ama hâlâ ÇALIŞIYOR'
            : durdur === 'SKIP'
              ? 'reboot öncesi çalışmıyordu — kapatma anında kapalıydı, sonra yeniden kalktı; hâlâ ÇALIŞIYOR'
              : `reboot öncesi çalışmıyordu, hâlâ ÇALIŞIYOR — ${kapatmadi(u)}`;
    } else if (durdur === 'OK') {
      // v3 B2 ("kapatıp, kontrol edilecek yaz"): otomasyonun kapattığı ürün sarı — beklenen durum mu bakılmalı.
      durum = 'bilgi';
      metin = i
        ? 'reboot öncesi çalışmıyordu, reboot sonrası çalışıyordu — otomasyonla kapatıldı — kontrol edilecek'
        : 'reboot öncesi çalışmıyordu, durulma beklemesinde kalkmıştı — otomasyonla kapatıldı — kontrol edilecek';
    } else {
      durum = 'ok';
      metin =
        durdur === 'FAIL'
          ? 'reboot öncesi çalışmıyordu — kapatma komutu başarısız döndü, sonra kapandı'
          : i
            ? 'reboot öncesi çalışmıyordu, kendiliğinden kapandı'
            : 'reboot öncesi çalışmıyordu, şu an KAPALI';
    }

    let jvmAyni = 0;
    const jvmDegisim: JvmDegisimi[] = [];
    if (JVM_URUNLERI.has(u)) {
      const oj = once.jvmler.get(u) || new Set<string>();
      const ij = ilk.jvmler.get(u) || new Set<string>();
      const sj = son ? son.jvmler.get(u) || new Set<string>() : null;
      // SONUC satırındaki adlar da: yalnız durulma görüntüsünde görülüp JVM planıyla kapatılan JVM ilk/son görüntüde yok.
      const xj = islemler.filter((x) => x.urun === u && x.ad).map((x) => x.ad);
      const adlar = [...new Set([...oj, ...ij, ...(sj || []), ...xj])].sort((a, b) =>
        a.localeCompare(b),
      );
      for (const ad of adlar) {
        const jo = oj.has(ad);
        const ji = ij.has(ad);
        const js = sj ? sj.has(ad) : null;
        const jx = bul(u, ad);
        if (jo && ji && js && !jx) {
          jvmAyni++;
          continue;
        }
        let d: Durum;
        let m: string;
        if (js === null) {
          d = 'sorun';
          m = 'son durum ölçülemedi';
        } else if (jo) {
          d = js ? 'ok' : 'sorun';
          m = js
            ? ji
              ? 'çalışıyordu, çalışıyor'
              : acildi(jx, 'kapalıydı')
            : 'çalışıyordu, hâlâ KAPALI';
        } else if (!o && kor) {
          d = 'bilgi';
          m = js
            ? 'şimdi çalışıyor — ürün reboot öncesi görüntüde yoktu, kapatma kapısı gereği dokunulmadı'
            : 'şu an KAPALI — ürün reboot öncesi görüntüde yoktu, dokunulmadı';
        } else if (!o) {
          // Ürün kapatılınca JVM'leri de kapanır; JVM'e tek tek işlem yapılmaz (komutu ürünün SONUC|durdur satırı).
          d = js ? 'sorun' : 'ok';
          m = js
            ? 'şimdi çalışıyor — ürün reboot öncesi çalışmıyordu, ürünle birlikte kapanması gerekiyordu'
            : durdur === 'OK'
              ? 'ürün reboot öncesi çalışmıyordu — ürünle birlikte kapatıldı'
              : 'ürün reboot öncesi çalışmıyordu — şu an KAPALI';
        } else if (js) {
          d = 'sorun';
          m = 'önce çalışmıyordu, hâlâ ÇALIŞIYOR';
        } else {
          d = 'ok';
          m =
            jx?.islem === 'durdur' && jx.sonuc === 'OK'
              ? ji
                ? 'önce çalışmıyordu, açılmıştı — kapatıldı'
                : 'önce çalışmıyordu, durulma beklemesinde kalkmıştı — kapatıldı'
              : jx?.islem === 'durdur' && jx.sonuc === 'FAIL'
                ? 'önce çalışmıyordu — kapatma komutu başarısız döndü, sonra kapandı'
                : 'önce çalışmıyordu, kendiliğinden kapandı';
        }
        jvmDegisim.push({ ad, durum: d, metin: m, islem: jx });
      }
    }
    out.push({
      urun: u,
      ad: URUN_ADI[u] || u,
      durum,
      metin,
      islem,
      jvmAyni,
      jvmDegisim,
      ...(onceCikarim ? { onceCikarim: true } : {}),
    });
  }
  return out;
}

/** Reboot gerçekten oldu mu: boot id önce ve reboot sonrası farklıysa evet; aynıysa hayır; bilinmiyorsa null. */
export function rebootOldu(once: Goruntu, ilk: Goruntu): boolean | null {
  if (!once.boot || !ilk.boot || once.boot === 'bilinmiyor' || ilk.boot === 'bilinmiyor')
    return null;
  return once.boot !== ilk.boot;
}

/**
 * Önce görüntüsünün kısa özeti: çalışan ürünler ve JVM sayıları. Ürün satırı olmayıp JVM'i görülen ürün de
 * sayılır ve urunSatiriYok ile işaretlenir (betik onu çalışıyor sayar).
 */
export function onceOzeti(
  g: Goruntu,
): { urun: string; ad: string; jvm: number | null; urunSatiriYok?: boolean }[] {
  return URUNLER.filter((u) => onceCalisiyordu(g, u)).map((u) => ({
    urun: u,
    ad: URUN_ADI[u] || u,
    jvm: JVM_URUNLERI.has(u) ? g.jvmler.get(u)?.size || 0 : null,
    ...(g.urunler.has(u) ? {} : { urunSatiriYok: true }),
  }));
}

/**
 * Planın BILGI satırları (HATA hariç) → plan notları ("neden dokunulmadı / nasıl sayıldı"). Betik ASCII yazar; bilinen
 * türler Türkçe karşılığıyla, bilinmeyenler olduğu gibi gösterilir. haricTur: ekranda zaten başka yerde söylenen türler.
 */
export function nedenListesi(plan: unknown, haricTur: readonly string[] = []): string[] {
  return bilgiAyristir(plan)
    .filter((b) => b.tur !== 'HATA' && !haricTur.includes(b.tur))
    .map((b) => {
      const ad = URUN_ADI[b.urun] || b.urun;
      if (b.tur === 'BOS')
        return 'Reboot öncesi görüntüde izlenen ürün/JVM yoktu — reboot sonrası çalışan her ürün (Nginx/Apache/IHS/CTG/JBoss/WAS) reboot öncesi haline (kapalı) döndürülür ve kontrol edilecek.';
      if (b.tur === 'ESKI')
        return "Önce görüntüsü eski betik sürümüyle alınmış — JBoss ürün/JVM'leri karşılaştırılmadı ve dokunulmadı.";
      if (b.tur === 'NESIL')
        return 'Önce görüntüsü eski betik sürümüyle alınmış — JBoss satırları jboss_home ile yeni nesil kuralına çevrilerek karşılaştırıldı.';
      if (b.tur === 'BELIRSIZ')
        return `${ad}: önce görüntüsü eski sürüm, ürün satırının nesli belirlenemedi (JBoss 8 olabilir) — dokunulmadı, elle kontrol edin.`;
      if (b.tur === 'CIKARIM')
        return `${ad}: önce görüntüsünde ürün satırı yoktu; JVM'i çalıştığı için reboot öncesi çalışıyor sayıldı.`;
      if (b.tur === 'YENI_CIKARIM')
        return `${ad}: şimdiki görüntüde ürün satırı yok ama JVM'i çalışıyor — ürün çalışıyor sayıldı (reboot öncesi çalışmıyordu, kapatılır).`;
      if (b.ad && /urun asamasinda kapatilir/.test(b.mesaj))
        return `${ad} / ${b.ad}: ürün reboot öncesi çalışmıyordu — JVM'ine tek tek işlem yapılmadı, ürünle birlikte kapatılır.`;
      // Kapının koruduğu her not 'kapatilmadi' içerir; yalnız 'dokunulmadi' diyen not eski betik sürümündendir (inceleme R2 #5).
      // İnceleme B3: sürüm 3 betiği JVM notunda "once goruntusu bos / eski surum" yazardı (hangisi olduğu ayrılmaz).
      if (b.ad && /goruntusu bos/.test(b.mesaj))
        return `${ad} / ${b.ad}: ürün reboot öncesi görüntüde yoktu — o koşudaki betik (sürüm 3) önce görüntüsü boş ya da eski sürüm olduğu için ürünü kapatmadı, JVM'ine dokunmadı; sürüm 4 boş önce görüntüsünde ürünü kapatır.`;
      if (b.ad && /kapatilmadi/.test(b.mesaj))
        return `${ad} / ${b.ad}: ürün reboot öncesi görüntüde yoktu — önce görüntüsü eski sürüm olduğu için ürün kapatılmadı, JVM'ine dokunulmadı.`;
      if (b.ad && /dokunulmadi/.test(b.mesaj))
        return `${ad} / ${b.ad}: ürün reboot öncesi görüntüde yoktu — eski betik sürümü JVM'ine dokunmadı; güncel betik ürünü (JVM'leriyle) kapatır, yeniden çalıştırın.`;
      // 2026-11-15: yeni betik önce çalışmayan ürünü KAPATIR; BILGI|NEW yalnız kapatma kapısında (v4: yalnız eski sürüm önce) gelir.
      // İnceleme B3: sürüm 3 betiğinin boş önce notu ("reboot oncesi goruntu bos - calisan urun kapatilmadi") eski sürüm DEĞİLDİR.
      if (b.tur === 'NEW' && !b.ad && /goruntu bos/.test(b.mesaj))
        return `${ad}: reboot öncesi çalışmıyordu — önce görüntüsü boştu; o koşudaki betik (sürüm 3) bu durumda yalnız web ürünlerini kapatırdı, bu ürüne dokunmadı. Sürüm 4 kapatır; "Reboot sonrası kontrol et ve düzelt"i yeniden çalıştırın.`;
      if (b.tur === 'NEW' && !b.ad && /kapatilmadi/.test(b.mesaj))
        return `${ad}: reboot öncesi çalışmıyordu — önce görüntüsü eski sürüm olduğu için kapatılmadı (dokunulmadı).`;
      if (b.tur === 'NEW' && !b.ad)
        return `${ad}: reboot öncesi çalışmıyordu — eski betik sürümü ürüne dokunmadı; güncel betik bu ürünü kapatır, "Reboot sonrası kontrol et ve düzelt"i yeniden çalıştırın.`;
      return `${b.urun}${b.ad ? ` / ${b.ad}` : ''}: ${b.mesaj}`;
    });
}

/** "Reboot sonrası kontrol et ve düzelt" (yeniden) çalıştırılabilen kayıt durumları (sunucu SONRA_ACIK ile aynı). */
export const SONRA_ACIK = ['once_hazir', 'tamam', 'sorunlu', 'sonra_hata', 'kontrol'];

/** Kullanıcının yazdığı sunucu listesi: virgül / boşluk / satır; büyük harf, tekil. */
export function sunucuListesi(metin: string): string[] {
  return [
    ...new Set(
      String(metin || '')
        .split(/[\s,;]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}

export const DURUM: Record<
  string,
  { etiket: string; ton: 'ok' | 'warning' | 'danger' | 'info' | 'muted' }
> = {
  once_kosuyor: { etiket: 'Önce görüntüsü alınıyor', ton: 'info' },
  once_hazir: { etiket: 'Önce kaydedildi — reboot bekleniyor', ton: 'info' },
  once_hata: { etiket: 'Önce görüntüsü alınamadı', ton: 'danger' },
  sonra_kosuyor: { etiket: 'Reboot sonrası kontrol/düzeltme sürüyor', ton: 'info' },
  tamam: { etiket: 'Sorunsuz', ton: 'ok' },
  sorunlu: { etiket: 'Sorun kaldı', ton: 'danger' },
  kontrol: { etiket: 'Kontrol gerekli', ton: 'warning' },
  sonra_hata: { etiket: 'Reboot sonrası iş sonuç vermedi', ton: 'danger' },
};
