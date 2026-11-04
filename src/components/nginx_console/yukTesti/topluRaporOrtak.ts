// src/components/nginx_console/yukTesti/topluRaporOrtak.ts — "Toplu rapor" SAF yardimcilari (2026-11-04).
//
// Hesap sunucuda (server/nginx-loadtest/rapor.cjs); burasi yalniz kolon tanimi, metin, CSV ve adres durumudur.
//   * RAPOR_KOLONLARI: ekran ve CSV ayni sirayla okur (kullanicinin ornegi once). `metin` ekran, `csv` hucre; CSV'de sayi
//     sayi kalir (ondalik virgul, birim baslikta; bant Mbps), olculmeyen bos, sunucu ayari olmayan kosuda '-'.
//   * csvMetni: cokluKarsilastirma.ts yardimcilari (BOM, ';', formul korumasi); yalniz gorunen kolon ve suzulmus satirlar.
//   * kolonSecimiOku / Yaz: localStorage (try/catch); bilinmeyen kolon atilir, kayit yoksa hepsi.
//   * urlDurumuOku / Yaz: ?tab=yuktesti&yt=rapor&kuyruk= ya da kosular= (en cok 100); ikisi birden gelirse kuyruk.
import { RAPOR_MAX_KOSU, type NlRaporAtlamaNedeni, type NlRaporSatir } from '@/api/nginxLoadtestApi';
import { fmtDateTime, fmtNumber } from '@/utils/datetime';
import { sureMetni } from '@/components/server_hub/retirementCikti';
import { csvMetinHucre, csvSayi, csvTarih } from './cokluKarsilastirma';
import { kosuNedenleriniTopla, nedenAcikla, uyariAcikla } from './nedenler';
import {
  BELLEK_NEDEN_METNI, PROTOKOL_ETIKETI, adimGecerliligi, bantMetni, bellekSizintiMetni, cpuMsMetni, gecerlilikBilgisi, kosuDurumu, mbMetni, ondalik, yukCpuMetni, yuzde,
} from './yukTestiOrtak';

const BOM = String.fromCharCode(0xfeff);
const SATIR = String.fromCharCode(13, 10);
const BOS = '—';
const YOK = '-';

const sayi = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? BOS : fmtNumber(Math.round(x)));
const ms = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? BOS : `${ondalik(x, 1)} ms`);
const yuzdeTek = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? BOS : `%${ondalik(x, 1)}`);
const seviye = (x: number | '-') => (x === YOK ? YOK : String(x));
const acikKapali = (x: boolean | '-') => (x === YOK ? YOK : x ? 'açık' : 'kapalı');
const mbps = (x: number | null | undefined) => csvSayi(x == null ? null : x / 1e6, 3);

export const KIP_ETIKETI: Record<string, string> = { ka: 'keep-alive', yeni: 'yeni bağlantı' };
const KIP_DOGRULAMA_ETIKETI: Record<string, string> = { tamam: 'tamam', uyari: 'uyarı', olculmedi: 'ölçülmedi' };

export const gecerlilikEtiketi = (g: string | null) => (g === 'DOYMA' ? adimGecerliligi(g).etiket : gecerlilikBilgisi(g)?.etiket ?? BOS);

/** Uyari / gecersizlik nedenleri: duz cumleler, ayni cumle bir kez. */
export function nedenCumleleri(s: Pick<NlRaporSatir, 'nedenler' | 'uyarilar' | 'kosuNedenleri'>): string[] {
  return [...new Set([
    ...kosuNedenleriniTopla(s.kosuNedenleri).map((x) => x.aciklama.cumle),
    ...s.nedenler.map((n) => nedenAcikla(n).cumle),
    ...s.uyarilar.map((u) => uyariAcikla(u).cumle),
  ])];
}
/** Olasi bellek nedeni: adim kurallari + kosu duzeyi sizinti metni. */
export function bellekNedenCumleleri(s: Pick<NlRaporSatir, 'bellekNedenleri' | 'bellekSizinti'>): string[] {
  const z = bellekSizintiMetni(s.bellekSizinti);
  return [...s.bellekNedenleri.map((n) => BELLEK_NEDEN_METNI[n] ?? n), ...(z ? [z.metin] : [])];
}

export interface RaporKolon {
  id: string;
  /** Ekran basligi. */
  ad: string;
  /** CSV basligi (birimle); verilmezse `ad`. */
  csvAd?: string;
  ipucu?: string;
  /** Ekranda saga yasli sayi. */
  sayisal?: boolean;
  /** Ilk varsayilan kume (kullanicinin ornegi). */
  temel?: boolean;
  metin: (s: NlRaporSatir) => string;
  /** Hazir CSV hucresi; verilmezse `metin` korunarak yazilir. */
  csv?: (s: NlRaporSatir) => string;
}

const seviyeKolon = (id: string, ad: string, al: (s: NlRaporSatir) => number | '-'): RaporKolon => ({ id, ad, temel: true, sayisal: true, metin: (s) => seviye(al(s)), csv: (s) => seviye(al(s)) });
const acikKolon = (id: string, ad: string, al: (s: NlRaporSatir) => boolean | '-'): RaporKolon => ({ id, ad, temel: true, metin: (s) => acikKapali(al(s)), csv: (s) => acikKapali(al(s)) });
const msKolon = (id: string, ad: string, al: (s: NlRaporSatir) => number | null, temel = false, ipucu?: string): RaporKolon => ({
  id, ad, csvAd: `${ad} (ms)`, ipucu, sayisal: true, temel, metin: (s) => ms(al(s)), csv: (s) => csvSayi(al(s), 2),
});
const adetKolon = (id: string, ad: string, al: (s: NlRaporSatir) => number | null, temel = false, ipucu?: string): RaporKolon => ({
  id, ad, ipucu, sayisal: true, temel, metin: (s) => sayi(al(s)), csv: (s) => csvSayi(al(s), 0),
});
const bantKolon = (id: string, ad: string, al: (s: NlRaporSatir) => number | null, temel = false, ipucu?: string): RaporKolon => ({
  id, ad, csvAd: `${ad} (Mbps)`, ipucu, sayisal: true, temel, metin: (s) => bantMetni(al(s)), csv: (s) => mbps(al(s)),
});

/** Kolon sirasi kullanicinin istegi: ornegi once, sonra ayrinti. */
export const RAPOR_KOLONLARI: RaporKolon[] = [
  { id: 'kosuNo', ad: 'Koşu no', temel: true, sayisal: true, metin: (s) => `#${s.kosuNo}`, csv: (s) => String(s.kosuNo) },
  { id: 'etiket', ad: 'Etiket', temel: true, metin: (s) => s.etiket || BOS, csv: (s) => csvMetinHucre(s.etiket) },
  { id: 'hiz', ad: 'Hız', temel: true, sayisal: true, ipucu: 'k6: istek/sn; wrk: bağlantı sayısı.', metin: (s) => fmtNumber(s.hiz), csv: (s) => String(s.hiz) },
  { id: 'protokol', ad: 'Protokol', temel: true, metin: (s) => PROTOKOL_ETIKETI[s.protokol] },
  { id: 'kip', ad: 'Keepalive', temel: true, metin: (s) => KIP_ETIKETI[s.kip] ?? s.kip },
  { id: 'ae', ad: 'Accept-Encoding', temel: true, metin: (s) => s.ae },
  seviyeKolon('brotliSeviye', 'Brotli seviye', (s) => s.brotliSeviye),
  seviyeKolon('gzipSeviye', 'Gzip seviye', (s) => s.gzipSeviye),
  { ...seviyeKolon('gzipStatikSeviye', 'Gzip static seviye', (s) => s.gzipStatikSeviye), ipucu: '.gz dosyalarının üretildiği seviye (hazırlık kanıtı). Seviye seçilmeyen sıkıştırmasız koşuda 9.' },
  acikKolon('gzipStatik', 'Gzip static', (s) => s.gzipStatik),
  { ...seviyeKolon('brotliStatikSeviye', 'Brotli static seviye', (s) => s.brotliStatikSeviye), ipucu: '.br dosyalarının üretildiği seviye (hazırlık kanıtı).' },
  acikKolon('brotliStatik', 'Brotli static', (s) => s.brotliStatik),
  adetKolon('toplamIstek', 'Toplam istek', (s) => s.toplamIstek, true, 'Ölçüm fazındaki istek; tekrar varsa toplamı.'),
  msKolon('p50', 'Medyan (p50)', (s) => s.p50, true),
  msKolon('p95', 'p95', (s) => s.p95, true),
  msKolon('p99', 'p99', (s) => s.p99, true),
  { id: 'hostCpu', ad: 'CPU %', csvAd: 'CPU %', temel: true, sayisal: true, ipucu: 'Hedef host CPU ortalaması, ölçüm penceresi.', metin: (s) => yuzdeTek(s.hostCpu), csv: (s) => csvSayi(s.hostCpu, 1) },
  bantKolon('bantBps', 'Bant', (s) => s.bantBps, true, 'Yük makinesinin aldığı test trafiği.'),
  { id: 'tarih', ad: 'Tarih', metin: (s) => (s.tarih ? fmtDateTime(s.tarih) : BOS), csv: (s) => csvTarih(s.tarih) },
  { id: 'sure', ad: 'Süre', csvAd: 'Süre (sn)', sayisal: true, ipucu: 'Koşunun tamamı (başlangıç – bitiş).', metin: (s) => (s.sureSn == null ? BOS : sureMetni(s.sureSn)), csv: (s) => csvSayi(s.sureSn, 0) },
  { id: 'durum', ad: 'Durum', metin: (s) => kosuDurumu(s.durum).etiket },
  { id: 'gecerlilik', ad: 'Geçerlilik', metin: (s) => gecerlilikEtiketi(s.gecerlilik) },
  { id: 'tekrar', ad: 'Tekrar', sayisal: true, ipucu: 'Geçerli / toplam tekrar. Ölçüler tekrarların ortalaması, sayaçlar toplamıdır.', metin: (s) => `${s.gecerliTekrar}/${s.tekrar}`, csv: (s) => String(s.tekrar) },
  { id: 'gercekRps', ad: 'Gerçekleşen istek/sn', sayisal: true, metin: (s) => (s.gercekRps == null ? BOS : ondalik(s.gercekRps, 1)), csv: (s) => csvSayi(s.gercekRps, 1) },
  { id: 'nedenler', ad: 'Uyarı / geçersizlik nedenleri', metin: (s) => nedenCumleleri(s).join(' · ') || BOS, csv: (s) => csvMetinHucre(nedenCumleleri(s).join(' | ')) },
  { id: 'kipDogrulama', ad: 'Kip doğrulaması', metin: (s) => KIP_DOGRULAMA_ETIKETI[s.kipDogrulama] ?? s.kipDogrulama },
  msKolon('ttfbP95', 'TTFB p95', (s) => s.ttfbP95),
  msKolon('tlsP95', 'TLS p95', (s) => s.tlsP95),
  msKolon('connectP95', 'Connect p95', (s) => s.connectP95),
  msKolon('sunucuP95', 'Sunucu p95', (s) => s.sunucuP95),
  { id: 'hataOrani', ad: 'Hata oranı', csvAd: 'Hata oranı %', sayisal: true, metin: (s) => yuzde(s.hataOrani, 2), csv: (s) => csvSayi(s.hataOrani == null ? null : s.hataOrani * 100, 3) },
  adetKolon('n429', '429', (s) => s.n429),
  adetKolon('n5xx', '5xx', (s) => s.n5xx),
  adetKolon('atilan', 'Atılan istek', (s) => s.atilan, false, 'k6’nın hız için gönderemediği istek (dropped).'),
  { id: 'cpuMsIstek', ad: 'CPU-ms/istek', sayisal: true, metin: (s) => cpuMsMetni(s.cpuMsIstek), csv: (s) => csvSayi(s.cpuMsIstek, 4) },
  { id: 'kapasite', ad: 'Kapasite', csvAd: 'Kapasite (istek/sn)', sayisal: true, metin: (s) => (s.kapasite == null ? BOS : `${fmtNumber(Math.round(s.kapasite))}/sn`), csv: (s) => csvSayi(s.kapasite, 0) },
  { id: 'bellekMb', ad: 'Nginx bellek', csvAd: 'Nginx bellek (MB)', sayisal: true, ipucu: 'Worker PSS ortalaması; PSS yoksa RSS.', metin: (s) => (s.bellekMb == null ? BOS : `${mbMetni(s.bellekMb)}${s.bellekKaynak === 'rss' ? ' (RSS)' : ''}`), csv: (s) => csvSayi(s.bellekMb, 1) },
  { id: 'bellekArtisiMb', ad: 'Bellek artışı', csvAd: 'Bellek artışı (MB)', sayisal: true, ipucu: 'Worker Anon: ölçüm sonu − taban.', metin: (s) => (s.bellekArtisiMb == null ? BOS : `${ondalik(s.bellekArtisiMb, 1)} MB`), csv: (s) => csvSayi(s.bellekArtisiMb, 1) },
  { id: 'olasiNeden', ad: 'Olası neden', metin: (s) => bellekNedenCumleleri(s).join(' · ') || BOS, csv: (s) => csvMetinHucre(bellekNedenCumleleri(s).join(' | ')) },
  bantKolon('testGonderilenBps', 'Test trafiği gönderilen', (s) => s.testGonderilenBps),
  bantKolon('nicOrtBps', 'NIC ortalama', (s) => s.nicOrtBps, false, 'Hedef NIC gönderim (tx) ortalaması; arayüzdeki test dışı trafik de içerir.'),
  bantKolon('nicMaxBps', 'NIC en yüksek', (s) => s.nicMaxBps, false, 'Hedef NIC gönderim (tx) en yükseği.'),
  { id: 'baytIstek', ad: 'İstek başına bayt', sayisal: true, metin: (s) => sayi(s.baytIstek), csv: (s) => csvSayi(s.baytIstek, 0) },
  { id: 'yukCpuBosta', ad: 'Yük makinesi CPU (boşta)', csvAd: 'Yük makinesi CPU boşta %', sayisal: true, metin: (s) => yukCpuMetni(s.yukCpuBosta), csv: (s) => csvSayi(s.yukCpuBosta, 1) },
  { id: 'yukBellekYuzde', ad: 'Yük makinesi bellek', csvAd: 'Yük makinesi bellek %', sayisal: true, metin: (s) => yuzdeTek(s.yukBellekYuzde), csv: (s) => csvSayi(s.yukBellekYuzde, 1) },
  { id: 'yukDoydu', ad: 'Yük doydu', metin: (s) => (s.yukDoydu ? 'evet' : 'hayır') },
  adetKolon('gzUretilen', 'gz üretilen dosya', (s) => s.gzUretilen),
  adetKolon('brUretilen', 'br üretilen dosya', (s) => s.brUretilen),
  { id: 'diskKanit', ad: 'Diskten sunulma kanıtı', metin: (s) => s.diskKanit || BOS, csv: (s) => csvMetinHucre(s.diskKanit) },
];
export const TEMEL_KOLONLAR = RAPOR_KOLONLARI.filter((k) => k.temel).map((k) => k.id);
const TUM_KOLONLAR = RAPOR_KOLONLARI.map((k) => k.id);

/** Hucre: `csv` yoksa ekran metni korumayla; olculmeyen '—' CSV'de bos. */
function csvHucre(k: RaporKolon, s: NlRaporSatir): string {
  if (k.csv) return k.csv(s);
  const m = k.metin(s);
  return m === BOS ? '' : csvMetinHucre(m);
}

/** Yalniz verilen kolonlar ve satirlar; bos secimde yalniz BOM + satir sonu degil, hic kolon yok demektir (cagiran engeller). */
export function csvMetni(satirlar: NlRaporSatir[], kolonlar: RaporKolon[] = RAPOR_KOLONLARI): string {
  const st = [kolonlar.map((k) => csvMetinHucre(k.csvAd ?? k.ad)), ...satirlar.map((s) => kolonlar.map((k) => csvHucre(k, s)))];
  return BOM + st.map((x) => x.join(';')).join(SATIR) + SATIR;
}

/** Veride gecen hizlar (artan). */
export const raporHizlari = (satirlar: Pick<NlRaporSatir, 'hiz'>[]) => [...new Set(satirlar.map((s) => s.hiz))].sort((a, b) => a - b);

export const ATLAMA_METNI: Record<NlRaporAtlamaNedeni, string> = {
  bulunamadi: 'bulunamadı (silinmiş olabilir)',
  on_kontrol: 'ön kontrol kaydı',
  bitmemis: 'henüz bitmedi',
  olcum_yok: 'ölçüm yok',
  hesaplanamadi: 'hesaplanamadı',
  kosu_baslamadi: 'koşu başlamadı',
};

// ── Sutun secimi ──────────────────────────────────────────────────────────────────────────────────
export const KOLON_ANAHTARI = 'yukTesti.topluRapor.kolonlar';
export function kolonSecimiOku(): string[] {
  try {
    const d: unknown = JSON.parse(window.localStorage.getItem(KOLON_ANAHTARI) ?? 'null');
    if (Array.isArray(d)) {
      const secili = TUM_KOLONLAR.filter((id) => d.includes(id));
      if (secili.length) return secili;
    }
  } catch { /* bozuk kayit ya da kapali depolama: varsayilan */ }
  return TUM_KOLONLAR;
}
export function kolonSecimiYaz(idler: string[]): void {
  try {
    window.localStorage.setItem(KOLON_ANAHTARI, JSON.stringify(idler));
  } catch { /* kapali depolama: secim oturumda kalir */ }
}

// ── URL durumu ────────────────────────────────────────────────────────────────────────────────────
export interface RaporUrl { kuyruk: number | null; kosular: number[] }
const numara = (s: string) => (/^\d{1,10}$/.test(s) && Number(s) > 0 && Number(s) <= 2147483647 ? Number(s) : null);
export function urlDurumuOku(sp: URLSearchParams): RaporUrl {
  const kuyruk = numara((sp.get('kuyruk') || '').trim());
  if (kuyruk != null) return { kuyruk, kosular: [] };
  const kosular: number[] = [];
  for (const p of (sp.get('kosular') || '').split(',')) {
    const n = numara(p.trim());
    if (n != null && !kosular.includes(n) && kosular.length < RAPOR_MAX_KOSU) kosular.push(n);
  }
  return { kuyruk: null, kosular };
}
/** Mevcut parametreleri koruyarak yazar; kuyruk ile kosular birbirini siler. */
export function urlDurumuYaz(sp: URLSearchParams, d: RaporUrl): URLSearchParams {
  const n = new URLSearchParams(sp);
  n.set('tab', 'yuktesti');
  n.set('yt', 'rapor');
  n.delete('kuyruk');
  n.delete('kosular');
  if (d.kuyruk != null) n.set('kuyruk', String(d.kuyruk));
  else if (d.kosular.length) n.set('kosular', d.kosular.slice(0, RAPOR_MAX_KOSU).join(','));
  return n;
}
