// src/components/nginx_console/yukTesti/hazirAyarlar.ts — Yeni koşu formunun hazır ayarları ve alan açıklamaları (2026-11-02).
//
// Kullanici geri bildirimi (R2, AWX 3474239): "cok parametre var, her birinin etkisi ne?". Formun ustunde yalniz hedef,
// senaryo, yuk (k6 hizlari / wrk baglantilari) ve olcum suresi; gerisi "Gelişmiş ayarlar" altinda, her alanin etkisini
// tek cumleyle soyleyen aciklamayla. Hazir ayar dugmeleri (Hızlı deneme / Standart / Kapasite) alanlari DOLDURUR, kullanici
// yine degistirebilir; kanonik govde ve sunucu denetimleri DEGISMEZ (dugme yalniz form metnini yazar).
//
// Kurallar (sunucu ile ayni sinirlar; hedefSinirlari'nin daralttigi `sinir`):
//  - k6 hizlari 1..maxHiz (hedefin olculmus limit_req'i, serbestte 200), wrk baglantilari 1..maxBaglanti (serbestte 50),
//    her baglanti is parcacigina tam bolunur ve is parcacigi en kucuk baglantiyi asmaz; kademeler tekil ve artan.
//  - Sureler [sureMin, sureMax], isinma [5, isinmaMax], tekrar [1, maxTekrar], bosta [30, 120], bosluk [0, 120].
//  - Butce (butceSn) <= maxButceSn: asarsa once tekrar, sonra olcum suresi, en son kademe sayisi azaltilir.
//  - Standart = sunucunun /hedefler varsayilani (serbestte serbest varsayilani); varsayilan hiz hedef sinirini asarsa
//    hizlar sinirin %25 / %50 / %85'ine olceklenir. Hizli deneme ~5 dk kucuk yuk, Kapasite sinira kadar 5 kademe.
//  - HTTP/2 (h2_sozlesme.md): hazir ayar protokolu DEGISTIRMEZ; h2'de kanonik parametrenin kipi 'ka' (h2 yalniz keep-alive).
import type { NlMotor, NlParametreler, NlProtokol, NlSinirlar, NlVarsayilanlar } from '@/api/nginxLoadtestApi';
import { butceSn, sinirlariTamamla } from './yukTestiOrtak';

export type HazirAyarAdi = 'hizli' | 'standart' | 'kapasite';
export const HAZIR_AYAR_SIRASI: HazirAyarAdi[] = ['hizli', 'standart', 'kapasite'];
export const HAZIR_AYAR_ETIKETI: Record<HazirAyarAdi, { ad: string; aciklama: string }> = {
  hizli: { ad: 'Hızlı deneme', aciklama: 'Küçük yükle iki kısa adım, tekrar yok: kurulumun ve senaryonun çalıştığını görmek için (yaklaşık 5 dakika).' },
  standart: { ad: 'Standart', aciklama: 'Üç yük kademesi, her biri iki kez: bir değişikliği öncesi / sonrası karşılaştırmak için önerilen ayar.' },
  kapasite: { ad: 'Kapasite', aciklama: 'Hedefin izin verdiği üst sınıra kadar beş kademe, her biri iki kez: sunucunun nerede zorlandığını bulmak için.' },
};

/** Hazir ayarin doldurdugu form alanlari (metin; form bunlari oldugu gibi yazar). Iki motorun alanlari birlikte:
 *  motor degisince de ayni ayar gecerli kalir. kip / ae / SNI / etiket hazir ayarin disindadir (kullanicinin secimi). */
export interface HazirAyarDegerleri {
  hizlar: string; maxvu: string; baglantilar: string; is_parcacigi: string;
  tekrar: string; isinma: string; sure: string; bosluk: string; bosta: string;
}
type Sinir = ReturnType<typeof sinirlariTamamla>;
const kirp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
/** Okunur yuvarlama: >= 100 onluga, >= 20 beşe, altinda tam sayiya; [1, tavan] icinde. */
export function guzelSayi(x: number, tavan: number): number {
  const r = x >= 100 ? Math.round(x / 10) * 10 : x >= 20 ? Math.round(x / 5) * 5 : Math.round(x);
  return kirp(r, 1, Math.max(1, Math.floor(tavan)));
}
const tekilArtan = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);
const oranlardan = (oranlar: number[], tavan: number) => tekilArtan(oranlar.map((o) => guzelSayi(tavan * o, tavan)));

interface Zamanlama { tekrar: number; isinma: number; sure: number; bosluk: number; bosta: number }
const ZAMANLAMA: Record<Exclude<HazirAyarAdi, 'standart'>, Zamanlama> = {
  hizli: { tekrar: 1, isinma: 10, sure: 40, bosluk: 10, bosta: 30 },
  kapasite: { tekrar: 2, isinma: 30, sure: 120, bosluk: 30, bosta: 60 },
};
function zamanKirp(z: Zamanlama, s: Sinir): Zamanlama {
  return {
    tekrar: kirp(z.tekrar, 1, s.maxTekrar), isinma: kirp(z.isinma, 5, s.isinmaMax), sure: kirp(z.sure, s.sureMin, s.sureMax),
    bosluk: kirp(z.bosluk, 0, 120), bosta: kirp(z.bosta, 30, 120),
  };
}

function k6Hizlari(ad: HazirAyarAdi, s: Sinir, v: { hizlar: number[] }): number[] {
  const tavan = s.maxHiz;
  if (tavan < 1) return [];
  if (ad === 'hizli') return oranlardan([0.1, 0.2], tavan);
  if (ad === 'kapasite') return oranlardan([0.2, 0.4, 0.6, 0.8, 1], tavan);
  const vars = tekilArtan(v.hizlar.filter((x) => Number.isInteger(x) && x >= 1));
  return vars.length && vars.length <= 5 && vars.every((x) => x <= tavan) ? vars : oranlardan([0.25, 0.5, 0.85], tavan);
}
/** wrk kademeleri ve is parcacigi: her kademe is parcacigina tam bolunur, is parcacigi en kucuk kademeyi asmaz. */
function wrkKademeleri(ad: HazirAyarAdi, s: Sinir, v: { baglantilar: number[]; is_parcacigi: number }): { baglantilar: number[]; is_parcacigi: number } {
  const tavan = s.maxBaglanti;
  if (tavan < 1) return { baglantilar: [], is_parcacigi: 1 };
  if (ad === 'standart') {
    const b = tekilArtan(v.baglantilar.filter((x) => Number.isInteger(x) && x >= 1));
    const t = v.is_parcacigi;
    if (b.length && b.length <= s.maxBaglantiSayisi && b.every((x) => x <= tavan && x % t === 0) && t >= 1 && t <= s.maxIsParcacigi && t <= b[0]) return { baglantilar: b, is_parcacigi: t };
  }
  const aday = ad === 'hizli' ? [2, 4] : ad === 'kapasite' ? [2, 4, 8, 16, 32] : [2, 4, 8];
  const b = aday.filter((x) => x <= tavan).slice(0, s.maxBaglantiSayisi);
  return b.length ? { baglantilar: b, is_parcacigi: Math.min(2, s.maxIsParcacigi) } : { baglantilar: [tavan], is_parcacigi: 1 };
}

/** Butce siniri asilirsa (ornek: sinir daraltilmis bir sunucu) once tekrar, sonra olcum suresi, en son kademe azalir. */
function butceyeSigdir(z: Zamanlama, kademeSayisi: number, s: Sinir): { z: Zamanlama; kademe: number } {
  const b = (zz: Zamanlama, n: number) => zz.bosta + n * zz.tekrar * (zz.isinma + zz.sure + zz.bosluk + 20) + 120;
  let x = { ...z };
  let n = kademeSayisi;
  for (let i = 0; i < 100 && b(x, n) > s.maxButceSn; i++) {
    if (x.tekrar > 1) x = { ...x, tekrar: x.tekrar - 1 };
    else if (x.sure > s.sureMin) x = { ...x, sure: Math.max(s.sureMin, x.sure - 20) };
    else if (n > 1) n -= 1;
    else break;
  }
  return { z: x, kademe: n };
}
/** Kademeyi azaltirken en kucuk ve en buyuk korunur (ortadan atilir): yukun alt ve ust ucu olculmeye devam eder. */
function kademeAzalt(xs: number[], n: number): number[] {
  const l = [...xs];
  while (l.length > Math.max(1, n)) l.splice(Math.floor(l.length / 2), 1);
  return l;
}

/**
 * Hazir ayarin form degerleri. `sinir`: hedefSinirlari'nin daralttigi sinirlar (hedef / serbest); `varsayilan`: /hedefler
 * varsayilani; `serbest`: serbest hedefte k6 varsayilani serbest varsayilanidir. Donen degerler `parametreHatalari`ndan
 * gecer (testte kilitli); sinir sifirsa (olculmus limit_req < 2 r/s) kademe bos kalir ve form alanin hatasini gosterir.
 */
export function hazirAyar(ad: HazirAyarAdi, sinir: NlSinirlar, varsayilan: NlVarsayilanlar, { serbest = false }: { serbest?: boolean } = {}): HazirAyarDegerleri {
  const s = sinirlariTamamla(sinir);
  const k6v = serbest ? varsayilan.serbest : { hizlar: varsayilan.hizlar, maxvu: varsayilan.maxvu };
  const ham = ad === 'standart'
    ? { tekrar: varsayilan.tekrar, isinma: varsayilan.isinma, sure: varsayilan.sure, bosluk: varsayilan.bosluk, bosta: varsayilan.bosta }
    : ZAMANLAMA[ad];
  let hizlar = k6Hizlari(ad, s, k6v);
  let wrk = wrkKademeleri(ad, s, varsayilan);
  const z0 = zamanKirp(ham, s);
  const enCok = Math.max(hizlar.length, wrk.baglantilar.length);
  const { z, kademe } = butceyeSigdir(z0, enCok, s);
  hizlar = kademeAzalt(hizlar, kademe);
  wrk = { ...wrk, baglantilar: kademeAzalt(wrk.baglantilar, kademe) };
  // VU: kapasitede sinirin tamami (yuksek hizda doyma olmasin), digerlerinde varsayilan; her zaman [10, maxVu].
  const vu = ad === 'kapasite' ? s.maxVu : Math.min(s.maxVu, k6v.maxvu);
  return {
    hizlar: hizlar.join(' '), maxvu: String(Math.max(Math.min(10, s.maxVu), vu)),
    baglantilar: wrk.baglantilar.join(' '), is_parcacigi: String(wrk.is_parcacigi),
    tekrar: String(z.tekrar), isinma: String(z.isinma), sure: String(z.sure), bosluk: String(z.bosluk), bosta: String(z.bosta),
  };
}

/** Hazir ayarin motora gore kanonik parametresi (butce ve parametreHatalari icin; kip / ae / protokol disaridan). wrk her
 *  zaman h1; h2'de kip 'ka' (HTTP/2 yalniz keep-alive). */
export function hazirAyarParametresi(d: HazirAyarDegerleri, motor: NlMotor, kip: NlParametreler['kip'] = 'yeni', ae: NlParametreler['ae'] = 'br', protokol: NlProtokol = 'h1'): NlParametreler {
  const sayilar = (x: string) => x.split(/\s+/).filter(Boolean).map(Number);
  const h2 = protokol === 'h2' && motor !== 'wrk';
  return {
    motor,
    ...(motor === 'wrk' ? { baglantilar: sayilar(d.baglantilar), is_parcacigi: Number(d.is_parcacigi) } : { hizlar: sayilar(d.hizlar), maxvu: Number(d.maxvu) }),
    tekrar: Number(d.tekrar), isinma: Number(d.isinma), sure: Number(d.sure), bosluk: Number(d.bosluk), bosta: Number(d.bosta), kip: h2 ? 'ka' : kip, ae,
    protokol: h2 ? 'h2' : 'h1',
  };
}
export const hazirAyarSuresiSn = (d: HazirAyarDegerleri, motor: NlMotor) => butceSn(hazirAyarParametresi(d, motor));

/** Formun su anki degerleri hangi hazir ayara birebir esit (motorun alanlari + sureler); hicbiri degilse null ("Özel"). */
export function hangiHazirAyar(form: HazirAyarDegerleri, motor: NlMotor, ayarlar: Record<HazirAyarAdi, HazirAyarDegerleri>): HazirAyarAdi | null {
  const norm = (x: string) => x.trim().split(/[\s,;]+/).filter(Boolean).join(' ');
  const alanlar: (keyof HazirAyarDegerleri)[] = [...(motor === 'wrk' ? ['baglantilar', 'is_parcacigi'] as const : ['hizlar', 'maxvu'] as const), 'tekrar', 'isinma', 'sure', 'bosluk', 'bosta'];
  for (const ad of HAZIR_AYAR_SIRASI) if (alanlar.every((k) => norm(form[k]) === norm(ayarlar[ad][k]))) return ad;
  return null;
}

/**
 * Her alanin etkisi, tek cumle, duz Turkce (kullanici: "her birinin etkisi ne?"). Alanin altinda yardim satiri olarak
 * gorunur; aralik ve hata ayri satirda (alan hatasi). Serbest hedefte bosluk / bosta metni ayri (CPU olculmez).
 */
export const ALAN_ACIKLAMASI = {
  hizlar: 'Saniyede gönderilecek istek sayısı; her sayı ayrı bir adımdır ve hızlar küçükten büyüğe sırayla denenir.',
  baglantilar: 'Aynı anda açık tutulacak bağlantı sayısı; her sayı ayrı bir adımdır, her bağlantı yanıtı alınca yeni istek gönderir.',
  sure: 'Her adımın ölçülen bölümü; uzadıkça sonuç daha kararlı olur, koşu da o kadar uzar.',
  tekrar: 'Her adımın kaç kez koşulacağı; 2 ve üstü, iki ölçüm arasındaki farkla sonucun ne kadar güvenilir olduğunu gösterir.',
  isinma: 'Her adımın başında ölçüme katılmayan yük süresi; bağlantılar ve önbellekler oturur, ilk saniyelerin sapması sonucu bozmaz.',
  bosluk: 'İki adım arasındaki bekleme; sunucu bu sürede dinlenir ve arka plan CPU’su ölçülüp sonuçtan çıkarılır.',
  boslukSerbest: 'İki adım arasındaki bekleme; serbest hedefte CPU ölçülmez, yalnız hedefin dinlenmesi için beklenir.',
  bosta: 'Yük başlamadan önce sunucunun boşta CPU’su bu kadar ölçülür; adımların CPU’sundan bu taban düşülür.',
  bostaSerbest: 'Serbest hedefte CPU kaydedici yok; bu süre beklenmez, yalnız süre bütçesine eklenir.',
  maxvu: 'k6’nın aynı anda kullanabileceği en çok sanal kullanıcı; hız tutturulamazsa adım “doyma” sayılır, gerekirse artırın.',
  is_parcacigi: 'wrk’nin bağlantıları paylaştırdığı iş parçacığı sayısı; yükün miktarını değil, yük sunucusunun çekirdek kullanımını değiştirir.',
  kip: 'Yeni bağlantı: her istek yeni TCP + TLS el sıkışması yapar (TLS maliyeti ölçülür); keep-alive: bağlantı açık kalır, yalnız isteğin maliyeti ölçülür.',
  // wrk TLS oturumunu yeniden kullanabilir: analiz wrk'de TLS payini hesaplamaz (WRK_TLS_UYARISI).
  kipWrk: 'wrk TLS oturumunu sürdürebilir; TLS payı hesaplanmaz.',
  ae: 'Tarayıcının hangi sıkıştırmayı istediği (Accept-Encoding); sunucunun sıkıştırma CPU’sunu ve yanıt boyutunu doğrudan değiştirir.',
  sni: 'TLS el sıkışmasında Host başlığındaki adı gönderir; sunucu sertifikayı ada göre seçiyorsa açın, bağlantı yine seçilen IP’ye gider.',
  sniWrk: 'wrk SNI’yi Host başlığına göre seçemez (IP adresi SNI olarak gider).',
  etiket: 'Karşılaştırmada bu koşuyu tanımak için kısa not; ör. “T0 — F5 öncesi” ya da “gzip_static açık”.',
  // HTTP/2 (h2_sozlesme.md 5.2; metinler AYNEN).
  protokol: 'Tarayıcılar çoğunlukla HTTP/2 kullanır; HTTP/2 sunucunun CPU’sunu ve yanıt süresini HTTP/1.1’den farklı etkiler, bu yüzden sonuçlar yalnız aynı protokolle koşulan koşularla karşılaştırılır.',
  protokolWrk: 'wrk yalnız HTTP/1.1 konuşur; HTTP/2 için yük aracı olarak k6’yı seçin.',
  protokolYok: 'Sunucu bu sürümde HTTP/2 koşusunu kabul etmiyor.',
  kipH2: 'HTTP/2 yalnız keep-alive ile koşulur: tarayıcılar HTTP/2’de bağlantıyı açık tutar, her isteğe yeni bağlantı açmaz.',
} as const;
