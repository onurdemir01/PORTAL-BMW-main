// src/components/nginx_console/yukTesti/cokluKarsilastirma.ts — "Çoklu karşılaştırma" SAF yardimcilari (2026-11-04).
//
// Karar ve gurultu kurali SUNUCUDA (analiz.cjs kararVer / farkDurumu); burasi yalniz okunur hale getirir:
//   * kosuEtiketi: etiket on planda ("[K3] A3 brotli 4"), yoksa "#<id>".
//   * cumle: karar kademesindeki CPU-ms ve p95 farkindan duz cumle ("Referansa göre CPU %12 daha az, p95 değişmedi
//     (gürültü içinde) → kalıcı iyileşme").
//   * hucreTonu: YALNIZ gurultu disi farklar renkli (iyi -> basari, kotu -> hata); gurultu ici / kurali yok / olculmedi soluk.
//   * sirala: CPU iyilesmesi, p95, etiket, tarih (olculmeyen sona); ref her zaman ustte (cagiran ekler).
//   * farkParcalari: satirin "Fark" metni (HTTP/2 · keepalive · brotli 6 · static), referanstan farkli parcalar isaretli;
//     karsilastirmaNotlari: farkli ayar / tek tekrar sayfa notlari.
//   * csvMetni: ozet (fark kolonlari dahil) + secili olcu matrisi; Turkce basliklar, ';' ayirici, ondalik virgul, UTF-8 BOM (Excel); hucre
//     '=', '+', '-', '@' ile basliyorsa metin alanlari tek tirnakla korunur (CSV formul enjeksiyonu).
//   * urlDurumuOku / urlDurumuYaz: secim URL'de (?tab=yuktesti&yt=coklu&ref=&kosular=&olcu=&sira=); en cok 16 kosu.
//   * seriStili: 16 kosu icin ayirt edilebilir cizgi (8 ton x duz / kesikli; ref kalin ve koyu).
import type { NlCokluAday, NlCokluHiz, NlCokluKarsilastirma, NlCokluKosu, NlCokluOlcu, NlFark, NlKarar } from '@/api/nginxLoadtestApi';
import type { Ton } from '@/components/server_hub/retirementStil';
import { fmtNumber } from '@/utils/datetime';
import { bantMetni, cpuMsMetni, kararBilgisi, mbMetni, ondalik, yuzde } from './yukTestiOrtak';

export const MAX_COKLU = 16;

export type CokluSiralama = 'cpu' | 'p95' | 'etiket' | 'tarih';
export const SIRALAMALAR: { id: CokluSiralama; ad: string }[] = [
  { id: 'cpu', ad: 'CPU iyileşmesi' },
  { id: 'p95', ad: 'p95 iyileşmesi' },
  { id: 'etiket', ad: 'Etiket' },
  { id: 'tarih', ad: 'Tarih' },
];

/** Olcu tanimlari: ekran adi, ipucu (teknik terim burada), deger metni, grafik birimi / olcegi. */
export const OLCU_TANIM: Record<NlCokluOlcu, { ad: string; ipucu: string; metin: (x: number | null) => string; birim: string; olcek: number; basamak: number; csvBasamak: number }> = {
  p95: { ad: 'Yanıt süresi (p95)', ipucu: 'İsteklerin %95’i bu sürede yanıtlandı (ms). Düşük iyi. Renk: kararın p95 kuralı (eşik ya da 3 × gürültü).', metin: (x) => (x == null ? '—' : `${ondalik(x, 1)} ms`), birim: 'ms', olcek: 1, basamak: 1, csvBasamak: 2 },
  p99: { ad: 'Yanıt süresi (p99)', ipucu: 'En yavaş %1’in eşiği (ms). Kararda kuralı yok: renklendirilmez.', metin: (x) => (x == null ? '—' : `${ondalik(x, 1)} ms`), birim: 'ms', olcek: 1, basamak: 1, csvBasamak: 2 },
  cpuMsIstek: { ad: 'İstek başına CPU', ipucu: 'Nginx worker CPU-ms/istek. Düşük iyi. Renk: kararın CPU kuralı (eşik ya da 3 × gürültü).', metin: cpuMsMetni, birim: 'ms', olcek: 1, basamak: 2, csvBasamak: 4 },
  hostCpu: { ad: 'Sunucu CPU', ipucu: 'Hedefin toplam CPU kullanımı (%). Kararda kuralı yok: renklendirilmez.', metin: (x) => (x == null ? '—' : `%${ondalik(x, 0)}`), birim: '%', olcek: 1, basamak: 0, csvBasamak: 1 },
  hata: { ad: 'Hata oranı', ipucu: 'Tekrarlar içindeki en yüksek hata oranı. Referans + %0,1’i aşan artış ya da 429 / 5xx kırmızı; iyileşme renklendirilmez.', metin: (x) => yuzde(x, 2), birim: '%', olcek: 100, basamak: 2, csvBasamak: 4 },
  kapasite: { ad: 'Tahmini kapasite', ipucu: 'CPU’ya göre tahmini üst sınır (istek/sn). Kararda ayrı kuralı yok: renklendirilmez.', metin: (x) => (x == null ? '—' : `${fmtNumber(Math.round(x))}/sn`), birim: 'istek/sn', olcek: 1, basamak: 0, csvBasamak: 0 },
  bantBps: { ad: 'Test trafiği', ipucu: 'Yük makinesinin aldığı test trafiği (Mbps, ölçüm fazı). Eski koşuda ölçülmedi. Renklendirilmez.', metin: bantMetni, birim: 'Mbps', olcek: 1e-6, basamak: 1, csvBasamak: 2 },
  bellekMb: { ad: 'Nginx belleği', ipucu: 'Worker PSS ortalaması (MB); PSS yoksa RSS. PSS ile RSS karşılaştırılmaz. Renklendirilmez.', metin: mbMetni, birim: 'MB', olcek: 1, basamak: 0, csvBasamak: 1 },
};
export const OLCU_SIRASI: NlCokluOlcu[] = ['p95', 'p99', 'cpuMsIstek', 'hostCpu', 'hata', 'bantBps', 'bellekMb', 'kapasite'];

/** Kosu adi: etiket on planda, yoksa numara. */
export const kosuEtiketi = (k: Pick<NlCokluKosu, 'id' | 'etiket'>) => (k.etiket && k.etiket.trim() ? k.etiket : `#${k.id}`);

// ── Fark metni (tek tabloda protokol / keepalive / sikistirma) ───────────────────────
export type FarkKosu = Pick<NlCokluKosu, 'protokol' | 'kip' | 'ae' | 'sunucuAyar'>;
export interface FarkParca { tur: 'protokol' | 'kip' | 'sikistirma' | 'static'; metin: string; farkli: boolean }
const PROTOKOL_METNI: Record<string, string> = { h1: 'HTTP/1.1', h2: 'HTTP/2' };
const KIP_METNI: Record<string, string> = { ka: 'keepalive', yeni: 'keepalive yok' };
const AE_METNI: Record<string, string> = { br: 'brotli', gzip: 'gzip', identity: 'sıkıştırmasız' };
function sikistirmaMetni(k: FarkKosu): string | null {
  if (!k.ae) return null;
  const seviye = k.sunucuAyar?.seviye;
  return seviye == null ? AE_METNI[k.ae] : `${AE_METNI[k.ae]} ${seviye}`;
}

/** Kosunun parcalari ve referanstan farkli olanlari. Bilinmeyen (eski kosu) parca yazilmaz, fark sayilmaz. */
export function farkParcalari(k: FarkKosu, ref: FarkKosu): FarkParca[] {
  const o: FarkParca[] = [{ tur: 'protokol', metin: PROTOKOL_METNI[k.protokol], farkli: k.protokol !== ref.protokol }];
  if (k.kip) o.push({ tur: 'kip', metin: KIP_METNI[k.kip], farkli: !!ref.kip && k.kip !== ref.kip });
  // Sunucu ayari iki kosuda da biliniyorsa seviye / static kiyaslanir; biri eskiyse (sunucuAyar yok) bilinmiyor demektir.
  const ayarBilinir = !!k.sunucuAyar && !!ref.sunucuAyar;
  const s = sikistirmaMetni(k);
  if (s) o.push({ tur: 'sikistirma', metin: s, farkli: !!ref.ae && (k.ae !== ref.ae || (ayarBilinir && k.sunucuAyar?.seviye !== ref.sunucuAyar?.seviye)) });
  const st = k.sunucuAyar?.static === true;
  const rst = ref.sunucuAyar?.static === true;
  if (st || (rst && k.sunucuAyar)) o.push({ tur: 'static', metin: st ? 'static' : 'static yok', farkli: ayarBilinir && st !== rst });
  return o;
}

/** Sayfa notlari: farkli ayarlar karsilastiriliyorsa ve tek tekrarli kosu varsa (gurultu olculmedi). */
export function karsilastirmaNotlari(v: Pick<NlCokluKarsilastirma, 'ref' | 'adaylar'>): string[] {
  const n: string[] = [];
  if (v.adaylar.some((a) => farkParcalari(a, v.ref).some((p) => p.farkli))) n.push('Farklı protokol / sıkıştırma karşılaştırılıyor; karar yalnız referansa göredir.');
  if ([v.ref, ...v.adaylar].some((k) => k.hizlar.some((h) => h.tekrar === 1))) n.push('Tek tekrarlı koşularda gürültü ölçülmedi: yüzde birkaçlık fark kesin değildir.');
  return n;
}

/** Yalniz gurultu disi farklar renkli; digerleri soluk (null). */
export function hucreTonu(f: NlFark | null | undefined): Extract<Ton, 'basari' | 'hata'> | null {
  if (!f) return null;
  if (f.durum === 'iyi') return 'basari';
  if (f.durum === 'kotu') return 'hata';
  return null;
}

/** Fark yuzdesinin metni: "−12 %" / "+3,4 %"; 10 ve ustu tam sayi. */
export function farkYuzdeMetni(y: number | null | undefined): string {
  if (y == null || !Number.isFinite(y)) return '—';
  const m = Math.abs(y);
  const r = m >= 10 ? Math.round(m) : Math.round(m * 10) / 10;
  if (r === 0) return '±0 %';
  return `${y > 0 ? '+' : '−'}${fmtNumber(r)} %`;
}
const yuzdeSade = (y: number) => {
  const m = Math.abs(y);
  return `%${fmtNumber(m >= 10 ? Math.round(m) : Math.round(m * 10) / 10)}`;
};

const KARAR_SONUCU: Record<NlKarar, string> = {
  KALICI: 'kalıcı iyileşme',
  NOTR: 'anlamlı fark yok',
  RET: 'kötüleşme, değişikliği geri alın',
  GECERSIZ: 'karar verilemedi (yeterli geçerli tekrar yok)',
  VERI_YOK: 'karşılaştırılamadı',
  DOYMA: 'sınırda (doyma), daha düşük hızla yineleyin',
};

/** Bir olcunun cumle parcasi ("CPU %12 daha az" / "p95 değişmedi (gürültü içinde)" / "CPU ölçülmedi"). */
function parca(ad: string, f: NlFark | null | undefined, az: string, cok: string): string {
  if (!f || f.durum === 'yok' || f.yuzde == null) return `${ad} ölçülmedi`;
  if (f.durum === 'gurultu_ici' || f.durum === 'renklendirilmez') return `${ad} değişmedi (gürültü içinde)`;
  return `${ad} ${yuzdeSade(f.yuzde)} daha ${f.yuzde < 0 ? az : cok}`;
}

/** Duz cumle: karar kademesindeki CPU ve p95 farki + kararin sonucu. */
export function cumle(a: Pick<NlCokluAday, 'karar' | 'kademeFarki'>): string {
  const kf = a.kademeFarki;
  const parcalar = [parca('CPU', kf.cpu, 'az', 'fazla'), parca('p95', kf.p95, 'düşük', 'yüksek')];
  if (kf.hata && kf.hata.durum === 'kotu') parcalar.push('hata arttı');
  return `Referansa göre ${parcalar.join(', ')} → ${KARAR_SONUCU[a.karar] ?? kararBilgisi(a.karar).etiket}`;
}

const sonaNull = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? Number.POSITIVE_INFINITY : x);
/** Adaylari siralar (yeni dizi). cpu / p95: en buyuk iyilesme (en negatif fark) once; olculmeyen sona. */
export function sirala(adaylar: NlCokluAday[], s: CokluSiralama): NlCokluAday[] {
  const l = adaylar.slice();
  const tarih = (k: NlCokluKosu) => sonaNull(k.createdAt ? Date.parse(k.createdAt) : null);
  if (s === 'cpu') l.sort((x, y) => sonaNull(x.kademeFarki.cpu?.yuzde) - sonaNull(y.kademeFarki.cpu?.yuzde) || x.id - y.id);
  else if (s === 'p95') l.sort((x, y) => sonaNull(x.kademeFarki.p95?.yuzde) - sonaNull(y.kademeFarki.p95?.yuzde) || x.id - y.id);
  else if (s === 'etiket') l.sort((x, y) => kosuEtiketi(x).localeCompare(kosuEtiketi(y), 'tr', { numeric: true }) || x.id - y.id);
  else l.sort((x, y) => tarih(x) - tarih(y) || x.id - y.id);
  return l;
}

/** Matris sutunlari: hizlarin birlesimi (artan). */
export function hizlarBirlesimi(v: Pick<NlCokluKarsilastirma, 'ref' | 'adaylar'>): number[] {
  return [...new Set([...v.ref.hizlar, ...v.adaylar.flatMap((a) => a.hizlar)].map((h) => h.hiz))].sort((a, b) => a - b);
}
export const hizBul = (hizlar: NlCokluHiz[], hiz: number) => hizlar.find((h) => h.hiz === hiz) ?? null;

// ── CSV ──────────────────────────────────────────────────────────────────────────────
const BOM = String.fromCharCode(0xfeff);
const SATIR = String.fromCharCode(13, 10);
/** Metin hucresi: formul enjeksiyonuna karsi koruma + tirnaklama. */
export function csvMetinHucre(s: string | null | undefined): string {
  let v = s ?? '';
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
/** Sayi hucresi: ondalik virgul, binlik ayiricisiz; olculmedi bos. */
export function csvSayi(x: number | null | undefined, basamak = 2): string {
  if (x == null || !Number.isFinite(x)) return '';
  const k = 10 ** basamak;
  return String(Math.round(x * k) / k).replace('.', ',');
}
/** Yerel saatle "YYYY-MM-DD HH:MM" (Excel tarih olarak tanir); gecersiz / yok bos. */
export function csvTarih(s: string | null): string {
  const d = s ? new Date(s) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const iki = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${iki(d.getMonth() + 1)}-${iki(d.getDate())} ${iki(d.getHours())}:${iki(d.getMinutes())}`;
}

/** Fark kolonlari: Fark, Protokol, Keepalive, Sıkıştırma, Seviye, Static, Referanstan farklı. */
function csvFark(k: FarkKosu, ref: FarkKosu): string[] {
  const p = farkParcalari(k, ref);
  const evetHayir = (x: boolean | null) => (x == null ? '' : x ? 'evet' : 'hayır');
  return [
    csvMetinHucre(p.map((x) => x.metin).join(' · ')), PROTOKOL_METNI[k.protokol], evetHayir(k.kip ? k.kip === 'ka' : null), k.ae ? AE_METNI[k.ae] : '',
    k.sunucuAyar?.seviye != null ? String(k.sunucuAyar.seviye) : '', evetHayir(k.sunucuAyar ? k.sunucuAyar.static : null),
    csvMetinHucre(p.filter((x) => x.farkli).map((x) => x.metin).join(', ')),
  ];
}

/** Ozet + secili olcu matrisi (siralanmis adaylarla). */
export function csvMetni(v: NlCokluKarsilastirma, olcu: NlCokluOlcu, adaylar: NlCokluAday[] = v.adaylar): string {
  const o = OLCU_TANIM[olcu];
  const st: string[][] = [];
  st.push(['Koşu', 'Etiket', 'Rol', 'Tarih', 'Karar', 'Açıklama', 'CPU kademesi', 'CPU-ms/istek farkı %', 'p95 kademesi', 'p95 farkı %', 'Test trafiği farkı %', 'Bellek farkı %',
    'Fark', 'Protokol', 'Keepalive', 'Sıkıştırma', 'Seviye', 'Static', 'Referanstan farklı']);
  st.push([`#${v.ref.id}`, csvMetinHucre(v.ref.etiket), 'Referans', csvTarih(v.ref.createdAt), '', '', '', '', '', '', '', '', ...csvFark(v.ref, v.ref)]);
  for (const a of adaylar) {
    const kf = a.kademeFarki;
    st.push([`#${a.id}`, csvMetinHucre(a.etiket), 'Aday', csvTarih(a.createdAt), csvMetinHucre(kararBilgisi(a.karar).etiket), csvMetinHucre(cumle(a)),
      kf.cpu ? String(kf.cpu.hiz) : '', csvSayi(kf.cpu?.yuzde, 1), kf.p95 ? String(kf.p95.hiz) : '', csvSayi(kf.p95?.yuzde, 1), csvSayi(kf.bant?.yuzde, 1), csvSayi(kf.bellek?.yuzde, 1), ...csvFark(a, v.ref)]);
  }
  for (const k of v.karsilastirilamaz) st.push([`#${k.id}`, csvMetinHucre(k.etiket), 'Karşılaştırılamaz', csvTarih(k.createdAt), '', csvMetinHucre(k.nedenler.map((n) => n.metin).join(' ')), '', '', '', '', '', '', ...csvFark(k, v.ref)]);
  st.push([]);
  const birim = olcu === 'hata' ? 'oran' : olcu === 'bantBps' ? 'bit/sn' : o.birim;
  st.push([csvMetinHucre(`${o.ad} (${birim})`)]);
  const hizlar = hizlarBirlesimi(v);
  st.push(['Hız', ...[v.ref, ...adaylar].flatMap((k, i) => (i === 0 ? [csvMetinHucre(`#${k.id} ${kosuEtiketi(k)} (referans)`)] : [csvMetinHucre(`#${k.id} ${kosuEtiketi(k)}`), 'Fark %']))]);
  for (const h of hizlar) {
    const r = hizBul(v.ref.hizlar, h);
    const satir = [String(h), csvSayi(r ? r[olcu] : null, o.csvBasamak)];
    for (const a of adaylar) {
      const x = hizBul(a.hizlar, h);
      satir.push(csvSayi(x ? x[olcu] : null, o.csvBasamak), csvSayi(x?.fark?.[olcu]?.yuzde, 1));
    }
    st.push(satir);
  }
  return BOM + st.map((s) => s.join(';')).join(SATIR) + SATIR;
}

// ── URL durumu ───────────────────────────────────────────────────────────────────────
export interface CokluUrl { ref: number | null; kosular: number[]; olcu: NlCokluOlcu; sira: CokluSiralama }
const numara = (s: string) => (/^\d{1,10}$/.test(s) && Number(s) > 0 ? Number(s) : null);
export function urlDurumuOku(sp: URLSearchParams): CokluUrl {
  const kosular: number[] = [];
  for (const p of (sp.get('kosular') || '').split(',')) {
    const n = numara(p.trim());
    if (n != null && !kosular.includes(n) && kosular.length < MAX_COKLU) kosular.push(n);
  }
  const ref = numara(sp.get('ref') || '');
  const o = sp.get('olcu') as NlCokluOlcu | null;
  const s = sp.get('sira') as CokluSiralama | null;
  return {
    ref: ref != null && kosular.includes(ref) ? ref : kosular[0] ?? null,
    kosular,
    // Kendi anahtari mi (`in` degil): ?olcu=toString / __proto__ / constructor prototipten gecip ekrani cokertirdi.
    olcu: o && Object.prototype.hasOwnProperty.call(OLCU_TANIM, o) ? o : 'p95',
    sira: s && SIRALAMALAR.some((x) => x.id === s) ? s : 'cpu',
  };
}
/** Mevcut parametreleri koruyarak (tab vb.) coklu durumunu yazar. */
export function urlDurumuYaz(sp: URLSearchParams, d: CokluUrl): URLSearchParams {
  const n = new URLSearchParams(sp);
  n.set('tab', 'yuktesti');
  n.set('yt', 'coklu');
  const kosular = d.kosular.slice(0, MAX_COKLU);
  if (kosular.length) n.set('kosular', kosular.join(','));
  else n.delete('kosular');
  if (d.ref != null && kosular.includes(d.ref)) n.set('ref', String(d.ref));
  else n.delete('ref');
  n.set('olcu', d.olcu);
  n.set('sira', d.sira);
  return n;
}

// ── Grafik seri stili ────────────────────────────────────────────────────────────────
/** i: aday sirasi (0..14). 8 ton (index.css --yt-seri-*), 9. kosudan itibaren ayni tonlar kesikli. */
export function seriStili(i: number, ref = false): { renk: string; kalinlik: number; kesik: string | undefined } {
  if (ref) return { renk: 'var(--text-primary)', kalinlik: 3.5, kesik: undefined };
  return { renk: `var(--yt-seri-${(i % 8) + 1})`, kalinlik: 2, kesik: i >= 8 ? '6 4' : undefined };
}
