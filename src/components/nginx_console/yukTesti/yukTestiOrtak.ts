// src/components/nginx_console/yukTesti/yukTestiOrtak.ts — Yük Testi ekranlarinin SAF yardimcilari (2026-10-27).
//
// Etiket/ton tablolari, butce formulu, parametre denetimi, on kontrol degerlendirmesi, artimli cikti birlestirme
// ve hiz gruplamasi. Sunucu her kurali YENIDEN uygular (sozlesme 9: ekran aynalar ama ona guvenmez); buradaki
// amac kullaniciya dugmeye basmadan once nedenini soylemek.
//
// TUR 3 (2026-10-28): iki motor ve iki hedef turu. Adim degerleri motora gore `hizlar` (k6, istek/sn) ya da
// `baglantilar` (wrk, baglanti): adim sayisi, etiketler ve birimler YALNIZ `adimDegerleri` uzerinden okunur
// (wrk kaydinda `hizlar` yoktur; dogrudan `p.hizlar` okuyan ekran cokerdi). Serbest hedefte iki motorda en cok
// 200 istek/sn ve 50 baglanti / VU; hedef kurallari (IP hedefte yerel, server_name, log ...) degerlendirilmez.
// SADELESTIRME (2026-11-02): sonuc ozeti (sunucu `sonucOzeti` vermezse adimlardan ayni kuralla) - sonucOzetiHesapla.
// TUR 4 (2026-11-02): araclar /sw'den kopyalanir; aracli on kontrol satirinda (aracId != null) dogrulanmamis kopya
// ENGEL (sunucu degerlendirmesi yoksa); wrk surum metni arac setinin yeniden hazirlanmasini soyler.
// HTTP/2 (2026-11-02, h2_sozlesme.md): protokol h1 | h2 (eski kayit h1). h2 yalniz k6 ve keep-alive; parametreHatalari
// sunucunun 400 kurallarini aynalar. On kontrol degerlendirmesi (sunucu degerlendirmesi yoksa) h2'de motor maddesinden
// hemen sonra TEK engel: on kontrol h2 icin yapilmadi > curl h2'siz > hedef ALPN ile h2 sunmuyor > olculemedi.
// 2026-11-03 (K1-K3): sunucu hedefinde hiz <= 5000, VU <= 1000, wrk tavani 5000; hedefin olculmus limit_req /
// limit_conn'u DARALTMAZ (hedefSinirlari), asim formda UYARI (limitUyarilari; sunucu metniyle BIREBIR). Yuk makinesi
// doymus adim (yukDoydu) p95 en iyi / en kotuya girmez; yuk makinesi port / bellek uyarisi on kontrol aynasinda.
// GOSTERIM (2026-11-03, E1-E5): tekrar "1. tekrar" (r1 degil), metinlerde "90/sn adımının 2. tekrarında" (ham TUR kodu
// R<n>_..._r<k> da cozulur); CPU-ms/istek iki ondalik + birim ("3,92 ms"; "3,919" binlik gibi okunuyordu); kapasite ve
// host CPU ipuclari; bellek hucreleri (MB / %; eski kosu "ölçülmedi").
import type { Ton } from '@/components/server_hub/retirementStil';
import {
  EK_SINIRLAR, type NlAdim, type NlAdimGecerlilik, type NlDurum, type NlEylem, type NlGecerlilik, type NlHedef, type NlHedefTuru, type NlKarar, type NlKosu,
  type NlKosuAyrinti, type NlMotor, type NlOnKontrol, type NlParametreler, type NlProtokol, type NlSinirlar, type NlSonucOzeti,
} from '@/api/nginxLoadtestApi';
import { fmtNumber } from '@/utils/datetime';

export const KOSU_DURUM: Record<NlDurum, { etiket: string; ton: Ton; canli?: boolean }> = {
  QUEUED: { etiket: 'sırada', ton: 'notr', canli: true },
  RUNNING: { etiket: 'sürüyor', ton: 'aksan', canli: true },
  FINALIZING: { etiket: 'sonuçlar okunuyor', ton: 'aksan', canli: true },
  DONE: { etiket: 'bitti', ton: 'basari' },
  FAILED: { etiket: 'başarısız', ton: 'hata' },
  CANCELED: { etiket: 'durduruldu', ton: 'uyari' },
  OKUNAMADI: { etiket: 'sonuç okunamadı', ton: 'uyari' },
};
export const kosuDurumu = (d: string | null | undefined) => KOSU_DURUM[d as NlDurum] ?? { etiket: d || 'bilinmiyor', ton: 'notr' as Ton };
export const AKTIF_DURUMLAR = new Set<string>(['QUEUED', 'RUNNING', 'FINALIZING']);

/** Sonucu okunamayan kosu: poller en cok 3 kez dener, sonra durur (otomatik yeniden okuma YOK; Admin dugmesi var). */
export const OKUNAMADI_ACIKLAMASI = 'Portal sonucu 3 kez okumayı denedi ve okuyamadı. İş çıktısındaki /sw kopyalama adımını ve SHA256SUMS\'ı kontrol edip "Sonucu yeniden oku" ile tekrar deneyin.';
export const GECERLILIK: Record<NlGecerlilik, { etiket: string; ton: Ton; aciklama: string }> = {
  GECERLI: { etiket: 'geçerli', ton: 'basari', aciklama: 'Bütün adımlar geçerli; ölçüm karşılaştırmada kullanılabilir.' },
  KISMI: { etiket: 'kısmen geçerli', ton: 'uyari', aciklama: 'Bazı adımlar geçersiz; yalnız geçerli adımlar hesaba katılır.' },
  GECERSIZ: { etiket: 'geçersiz', ton: 'hata', aciklama: 'Ölçüm güvenilmez; karşılaştırmada kullanmayın, koşuyu yineleyin.' },
  OKUNAMADI: { etiket: 'okunamadı', ton: 'uyari', aciklama: OKUNAMADI_ACIKLAMASI },
};
/** Poller sonucu en cok bu kadar dener (sonra OKUNAMADI). FINALIZING'de "Sonuç okunuyor (deneme N/3)". */
export const SONUC_DENEME_SINIRI = 3;
export const sonucOkunuyorMetni = (deneme: number) => `Sonuç okunuyor${deneme >= 1 ? ` (deneme ${fmtNumber(deneme)}/${SONUC_DENEME_SINIRI})` : ''}`;
/** Admin'in "Sonucu yeniden oku" dugmesi (POST /kosular/:id/yeniden-oku) yalniz bu kayitlarda. */
export const yenidenOkunabilir = (k: Pick<NlKosu, 'islem' | 'durum' | 'gecerlilik'>) => k.islem === 'kosu' && (k.durum === 'OKUNAMADI' || k.gecerlilik === 'OKUNAMADI');
/** "Kalan süreçleri durdur": AWX iptali uzak k6 / kaydediciyi durdurmaz; iptal edilmis KOSUDA durdur kipi yeniden calistirilabilir. */
export const kalanSurecDurdurulabilir = (k: Pick<NlKosu, 'islem' | 'durum'>) => k.islem === 'kosu' && k.durum === 'CANCELED';
/** Kosunun durdurma isi baslamadi: sunucunun 424 durdur_baslatilamadi metniyle ayni kalip (mesaj gelmezse yedek).
 *  k6 + sunucu metni BIREBIR eskisi; serbestte kaydedici yoktur (hedefe baglanilmaz), wrk'de arac adi wrk. */
export function durdurBaslatilamadiMetni(r: Pick<NlEylem, 'iptal' | 'durdurHatasi'>, { hedefTuru = 'sunucu', motor = 'k6' }: { hedefTuru?: NlHedefTuru; motor?: NlMotor } = {}): string {
  const iptalOldu = !!(r.iptal && (r.iptal.canceled || r.iptal.alreadyTerminal));
  const suren = hedefTuru === 'serbest' ? motor : `${motor} / kaydedici`;
  return `AWX işi ${iptalOldu ? 'iptal edildi' : 'iptal edilemedi'}, ancak durdurma işi başlatılamadı: ${r.durdurHatasi || 'sunucu durdurma işini bildirmedi'}. Uzaktaki ${suren} sürüyor olabilir; Durdur'u yeniden deneyin. Kilitler koşunun süre sınırına kadar tutulur.`;
}
export const gecerlilikBilgisi = (g: string | null | undefined) => (g ? GECERLILIK[g as NlGecerlilik] ?? { etiket: g, ton: 'notr' as Ton, aciklama: '' } : null);

export const ADIM_GECERLILIK: Record<NlAdimGecerlilik, { etiket: string; ton: Ton }> = {
  GECERLI: { etiket: 'geçerli', ton: 'basari' },
  DOYMA: { etiket: 'doyma', ton: 'uyari' },
  GECERSIZ: { etiket: 'geçersiz', ton: 'hata' },
  HATALI: { etiket: 'hatalı', ton: 'hata' },
};
export const adimGecerliligi = (g: string | null | undefined) => ADIM_GECERLILIK[g as NlAdimGecerlilik] ?? { etiket: g || '—', ton: 'notr' as Ton };

export const KARAR: Record<NlKarar, { etiket: string; ton: Ton; aciklama: string }> = {
  KALICI: { etiket: 'KALICI', ton: 'basari', aciklama: 'Aday, eşiği aşan bir kazanç gösterdi ve hiçbir kademede zarar yok — değişiklik kalabilir.' },
  NOTR: { etiket: 'NÖTR', ton: 'notr', aciklama: 'Fark gürültü ya da eşik içinde — değişiklik ölçülebilir bir kazanç getirmedi.' },
  RET: { etiket: 'RET', ton: 'hata', aciklama: 'Aday bir kademede kötüleşti (CPU, p95, hata ya da 429/5xx) — değişiklik geri alınmalı.' },
  GECERSIZ: { etiket: 'GEÇERSİZ', ton: 'uyari', aciklama: 'Bir tarafta yeterli geçerli koşu yok — karar verilemez; koşuyu yineleyin.' },
  VERI_YOK: { etiket: 'VERİ YOK', ton: 'notr', aciklama: 'Karşılaştırılacak ortak kademe ya da ölçüm yok.' },
  DOYMA: { etiket: 'DOYMA', ton: 'uyari', aciklama: 'Yük sunucusu ya da hedef doydu (dropped > 0, host CPU > %90 ya da yük makinesinin boşta CPU’su < %20) — sonuç sınırda.' },
};
export const kararBilgisi = (k: string | null | undefined) => KARAR[k as NlKarar] ?? { etiket: k || '—', ton: 'notr' as Ton, aciklama: '' };

export const ISLEM_ETIKETI: Record<string, string> = { on_kontrol: 'Ön kontrol', kosu: 'Koşu' };
export const KIP_ETIKETI: Record<string, string> = { yeni: 'yeni bağlantı', ka: 'keep-alive' };
export const AE_ETIKETI: Record<string, string> = { br: 'brotli (br)', gzip: 'gzip', identity: 'sıkıştırmasız' };
export const PROTOKOL_ETIKETI: Record<NlProtokol, string> = { h1: 'HTTP/1.1', h2: 'HTTP/2' };
/** Kanonik parametrenin protokolu: yalniz 'h2' HTTP/2'dir; alani olmayan eski kayit ve bilinmeyen deger h1. */
export const protokolOf = (p: { protokol?: unknown } | null | undefined): NlProtokol => (p?.protokol === 'h2' ? 'h2' : 'h1');
/** Kosunun protokolu: satirin normallestirilmis alani, yoksa kanonik parametre (eski kayit h1). */
export const kosuProtokolu = (k: { protokol?: unknown; parametreler?: { protokol?: unknown } | null }): NlProtokol => (k.protokol === 'h2' || k.protokol === 'h1' ? k.protokol : protokolOf(k.parametreler));

/** Hedef / yuk sunucusu uygunsuzluk kodlari (sozlesme 8) -> ekran metni; bilinmeyen kod oldugu gibi. */
const NEDEN: Record<string, string> = {
  hedef_uretim: 'üretim (PROD) sinyali var — yük testi yapılamaz',
  hedef_envanterde_yok: 'nginx envanterinde yok',
  yuk_host_izinsiz: 'yük sunucusu izin listesinde değil',
  ayni_host: 'hedef ile yük sunucusu aynı olamaz',
  ip_hedefte_yok: 'IP hedefin adaylarından biri değil',
  vhost_hedefte_yok: 'vhost hedefin server_name listesinde yok',
  sinir_asildi: 'parametre sınırı aşıldı',
  senaryo_yok: 'senaryo bulunamadı',
  kilit_dolu: 'hedefte, yük sunucusunda ya da genelde başka bir yük testi sürüyor',
  on_kontrol_eski: 'ön kontrol eski, başarısız ya da başka parametrelerle — yeniden çalıştırın',
  uyari_onayi: 'ön kontrol uyarıları onaylanmalı',
  onay_metni: 'yazılan ad / IP hedefle aynı değil',
  sablon_yok: 'AWX şablonu tanımlı değil (Admin > Playbook kayıtları)',
  awx_template_playbook_mismatch: 'AWX şablonu yük testi playbook’unu çalıştırmıyor',
  envanter_okunamadi: 'envanter okunamadı (geçici) — biraz sonra yeniden deneyin',
  awx_okunamadi: 'AWX’e ulaşılamadı (geçici) — biraz sonra yeniden deneyin',
  baslatiliyor: 'koşu başlatılıyor; birkaç saniye sonra yeniden deneyin',
  kosu_bitti: 'koşu tamamlanmış; durdurulacak bir şey yok',
  yeniden_okunamaz: 'yalnız sonucu okunamamış koşular yeniden okunabilir',
  // Tur 3: yazilan IP'nin sinifi (GET /ip-sinifi, on kontrol ve kosu kapisi ayni kodlari verir).
  ip_belirsiz: 'IP birden çok sunucuya ait — hedef sunucuyu listeden seçin',
  ip_sahibi_cozulemedi: 'IP’nin sahibi envanterde çözülemedi — yük testi yapılmaz',
  serbest_kapali: 'envanterde olmayan IP’ye yük testi kapalı (NGINX_LOADTEST_SERBEST_AGLAR tanımlı değil)',
  ip_izinli_agda_degil: 'IP izinli ağların (NGINX_LOADTEST_SERBEST_AGLAR) dışında',
  ip_yasakli_agda: 'IP yasaklı bir ağda (NGINX_LOADTEST_SERBEST_YASAK)',
  ip_yasak_listesi_gecersiz: 'yasak listesi (NGINX_LOADTEST_SERBEST_YASAK) okunamadı — yük testi kapalı',
  host_uretim: 'Host başlığı yalnız üretim sunucularında tanımlı',
  envanter_bayat: 'envanter / tarama bayat — yükleyici işlerini kontrol edin',
};
export const nedenMetni = (kod: string | null | undefined) => (kod ? NEDEN[kod] ?? kod : '');
/**
 * On kontrolun KENDI girdisine bagli kalici retler (POST /kosular/on-kontrol 409): ayni hedef / IP / vhost ile yeniden
 * denemek ayni reddi alir. Ekran bu imzayla dugmeyi kapatir; form degisince acilir. kilit_dolu / sablon_yok gibi
 * girdiden bagimsiz retler burada YOK (yeniden deneme mesrudur).
 */
export const GIRDIYE_BAGLI_RETLER = new Set([
  'hedef_uretim', 'hedef_envanterde_yok', 'yuk_host_izinsiz', 'ayni_host', 'ip_hedefte_yok', 'sinir_asildi', 'host_uretim',
  'ip_belirsiz', 'ip_sahibi_cozulemedi', 'serbest_kapali', 'ip_izinli_agda_degil', 'ip_yasakli_agda', 'ip_yasak_listesi_gecersiz',
]);
/** Ret govdesi / firlatilan hata -> tek satir mesaj (sunucu mesaji varsa o, yoksa kodun metni). */
export function hataMetni(x: unknown, yedek = 'İstek başarısız.'): string {
  const r = (x && typeof x === 'object' ? x : {}) as { message?: string; code?: string };
  const m = typeof r.message === 'string' ? r.message.trim() : '';
  return m || nedenMetni(r.code) || yedek;
}

// ── Motor ve adim degerleri ─────────────────────────────────────────────────────────
/** Kanonik parametrenin motoru: yalniz 'wrk' wrk'dir; eski (motor'suz) kayit ve bilinmeyen deger k6. */
export const motorOf = (p: { motor?: unknown } | null | undefined): NlMotor => (p?.motor === 'wrk' ? 'wrk' : 'k6');
export type AdimBirimi = 'istek/sn' | 'bağlantı';
/**
 * Adim degerleri motora gore: k6 `hizlar` (istek/sn), wrk `baglantilar` (baglanti). Alan yoksa bos liste (wrk kaydinda
 * `hizlar` yoktur; eski kayitta motor yoktur). Ekran adim sayisini, kademe etiketini ve birimi BURADAN okur.
 */
export function adimDegerleri(p: Partial<Pick<NlParametreler, 'motor' | 'hizlar' | 'baglantilar'>> | null | undefined): { motor: NlMotor; degerler: number[]; birim: AdimBirimi } {
  const motor = motorOf(p);
  const ham = motor === 'wrk' ? p?.baglantilar : p?.hizlar;
  return { motor, degerler: Array.isArray(ham) ? ham.filter((x) => Number.isFinite(x)) : [], birim: motor === 'wrk' ? 'bağlantı' : 'istek/sn' };
}
/** Kademe metni: k6 "250/sn" (eski metinler aynen), wrk "8 bağlantı". */
export const kademeMetni = (n: number | null | undefined, birim: AdimBirimi) => (n == null ? '—' : birim === 'bağlantı' ? `${n} bağlantı` : `${n}/sn`);

// ── Butce ve parametre denetimi (sunucu ile ayni formul) ─────────────────────────────
/** Adim basina ek pay (k6 acilisi, setup yoklamasi, gracefulStop); sunucudaki dogrula.cjs ADIM_EK_SN ile ayni. */
export const ADIM_EK_SN = 20;
/** Sozlesme 3: bosta + adim_sayisi * tekrar * (isinma + sure + bosluk + ADIM_EK_SN) + 120 sn; adim sayisi motora gore
 *  (k6 hiz, wrk baglanti kademesi; motor'suz = k6). Alan yoksa 0 adim: cokmez. */
export function butceSn(p: Pick<NlParametreler, 'tekrar' | 'isinma' | 'sure' | 'bosluk' | 'bosta'> & Partial<Pick<NlParametreler, 'motor' | 'hizlar' | 'baglantilar'>>): number {
  return p.bosta + adimDegerleri(p).degerler.length * p.tekrar * (p.isinma + p.sure + p.bosluk + ADIM_EK_SN) + 120;
}
const sayiListesi = (metin: string): number[] | null => {
  const parcalar = String(metin || '').trim().split(/[\s,;]+/).filter(Boolean);
  if (!parcalar.length || parcalar.some((p) => !/^\d{1,4}$/.test(p))) return null;
  return parcalar.map(Number);
};
/** "100 250 400" / "100,250" -> sayilar; gecersiz parca varsa null. */
export const hizlariAyristir = (metin: string): number[] | null => sayiListesi(metin);
/** "2 4 8" / "2,4,8" -> baglanti sayilari; gecersiz parca varsa null. */
export const baglantilariAyristir = (metin: string): number[] | null => sayiListesi(metin);
export type ParametreHatalari = Partial<Record<keyof NlParametreler | 'butce', string>>;
const aralik = (v: number | undefined, a: number, b: number) => Number.isInteger(v) && (v as number) >= a && (v as number) <= b;
type TamSinirlar = NlSinirlar;
/** Tur 3 alanlari eksik sinir nesnesi (eski sunucu, test) sozlesme sabitleriyle tamamlanir; verilen deger korunur. */
export function sinirlariTamamla(s: NlSinirlar): TamSinirlar {
  const t = { ...s };
  for (const [k, v] of Object.entries(EK_SINIRLAR)) {
    const x = (s as unknown as Record<string, unknown>)[k];
    if (typeof x !== 'number' || !Number.isFinite(x)) (t as unknown as Record<string, number>)[k] = v;
  }
  return t;
}
/** Sozlesme 3 sinirlari (+ hedefin / serbest hedefin daralttigi ust sinirlar). Bos nesne = gecerli. */
export function parametreHatalari(p: NlParametreler, sinir: NlSinirlar): ParametreHatalari {
  const s = sinirlariTamamla(sinir);
  const h: ParametreHatalari = {};
  if (motorOf(p) === 'wrk') {
    const b = Array.isArray(p.baglantilar) ? p.baglantilar : [];
    if (!b.length || b.length > s.maxBaglantiSayisi) h.baglantilar = '1 ile 5 arası bağlantı kademesi girin.';
    else if (b.some((x) => !aralik(x, s.baglantiMin, s.maxBaglanti))) h.baglantilar = `Her bağlantı 1–${s.maxBaglanti} olmalı.`;
    else if (new Set(b).size !== b.length) h.baglantilar = 'Aynı bağlantı sayısı iki kez yazılmış.';
    const t = p.is_parcacigi;
    if (!aralik(t, s.isParcacigiMin, s.maxIsParcacigi)) h.is_parcacigi = 'İş parçacığı 1–16 olmalı.';
    // wrk baglantilari c / t tam sayi bolmesiyle dagitir: bolunmeyen sayi TUR adindaki baglanti sayisini yalanlar.
    else if (!h.baglantilar && (t as number) > Math.min(...b)) h.is_parcacigi = 'İş parçacığı en küçük bağlantı sayısından büyük olamaz.';
    else if (!h.baglantilar && b.some((x) => x % (t as number) !== 0)) h.is_parcacigi = 'Her bağlantı sayısı iş parçacığı sayısına tam bölünmeli.';
  } else {
    const hz = Array.isArray(p.hizlar) ? p.hizlar : [];
    if (!hz.length || hz.length > 5) h.hizlar = '1 ile 5 arası hız girin (ör. 100 250 400).';
    else if (hz.some((x) => !aralik(x, 1, s.maxHiz))) h.hizlar = `Her hız 1–${s.maxHiz} istek/sn olmalı.`;
    else if (new Set(hz).size !== hz.length) h.hizlar = 'Aynı hız iki kez yazılmış.';
    if (!aralik(p.maxvu, 10, s.maxVu)) h.maxvu = `10–${s.maxVu}`;
  }
  if (!aralik(p.tekrar, 1, s.maxTekrar)) h.tekrar = `1–${s.maxTekrar}`;
  if (!aralik(p.isinma, 5, s.isinmaMax)) h.isinma = `5–${s.isinmaMax} sn`;
  if (!aralik(p.sure, s.sureMin, s.sureMax)) h.sure = `${s.sureMin}–${s.sureMax} sn`;
  if (!aralik(p.bosluk, 0, 120)) h.bosluk = '0–120 sn';
  if (!aralik(p.bosta, 30, 120)) h.bosta = '30–120 sn';
  if (p.kip !== 'yeni' && p.kip !== 'ka') h.kip = 'yeni ya da ka';
  if (!['br', 'gzip', 'identity'].includes(p.ae)) h.ae = 'br, gzip ya da identity';
  // HTTP/2 (sunucu dogrula.parametreler ile ayni kurallar; alan yoksa h1).
  if (p.protokol !== undefined && p.protokol !== 'h1' && p.protokol !== 'h2') h.protokol = "protokol 'h1' ya da 'h2' olmalı.";
  else if (p.protokol === 'h2' && motorOf(p) === 'wrk') h.protokol = 'HTTP/2 yalnız k6 ile seçilebilir; wrk yalnız HTTP/1.1 konuşur.';
  else if (p.protokol === 'h2' && p.kip !== 'ka') h.kip = 'HTTP/2 yalnız keep-alive (ka) bağlantı kipiyle koşulur.';
  if (!Object.keys(h).length && butceSn(p) > s.maxButceSn) {
    h.butce = `Toplam süre ${Math.ceil(butceSn(p) / 60)} dk; üst sınır ${Math.floor(s.maxButceSn / 60)} dk. ${motorOf(p) === 'wrk' ? 'Bağlantı kademesi' : 'Hız'}, tekrar ya da süreyi azaltın.`;
  }
  return h;
}
/**
 * Genel sinirlar. 2026-11-03 (K2): hedefin limit_req / limit_conn'u DARALTMAZ (asim limitUyarilari ile uyari); B3:
 * olculmus cok kucuk limit (eski "sifir sinir", hizSiniri / vuSiniri 0) de DARALTMAZ, ayni uyari. Serbest hedefte (limit_req'i bilinmeyen LB / sunucu) iki motorda hiz `serbestTavanRps`, VU ve baglanti
 * `serbestMaxBaglanti` ile daraltilir.
 */
export function hedefSinirlari(s: NlSinirlar, _h: Pick<NlHedef, 'hizSiniri' | 'vuSiniri'> | null | undefined, { hedefTuru = 'sunucu' }: { hedefTuru?: NlHedefTuru | null } = {}): TamSinirlar {
  const t = sinirlariTamamla(s);
  if (hedefTuru !== 'serbest') return t;
  return { ...t, maxHiz: Math.min(t.maxHiz, t.serbestTavanRps), maxVu: Math.min(t.maxVu, t.serbestMaxBaglanti), maxBaglanti: Math.min(t.maxBaglanti, t.serbestMaxBaglanti) };
}
/**
 * wrk toplam hiz tavani (sozlesme 3 `yuk_tavan_rps`; sunucu ayni kuralla verir, kullanici girmez): sunucu hedefinde genel
 * ust sinir (`maxTavanRps`, 5000; eski sunucu: maxHiz), serbestte serbest tavani. 2026-11-03 (K2): olculmus limit_req
 * tavani DARALTMAZ. Ekranda yalniz gosterilir.
 */
export function tavanRps(s: NlSinirlar, _h: Pick<NlHedef, 'hizSiniri'> | null | undefined, hedefTuru: NlHedefTuru | null | undefined): number {
  const t = sinirlariTamamla(s);
  if (hedefTuru === 'serbest') return Math.min(t.maxHiz, t.serbestTavanRps);
  return typeof t.maxTavanRps === 'number' && Number.isFinite(t.maxTavanRps) ? t.maxTavanRps : t.maxHiz;
}
/** Tavanin nereden geldigi (ekran metni). */
export function tavanNedeni(_s: NlSinirlar, _h: Pick<NlHedef, 'hizSiniri'> | null | undefined, hedefTuru: NlHedefTuru | null | undefined): string {
  return hedefTuru === 'serbest' ? 'serbest hedef tavanı' : 'genel üst sınır';
}
/** Olculmus limit metni (sunucu dogrula.limitMetni ile BIREBIR): tam sayiysa tam, degilse tek ondalik, virgul. */
export function limitMetni(y: number): string {
  const r = Math.round(y * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace('.', ',');
}
/**
 * Hedefin olculmus limit_req / limit_conn asimi uyarilari (sunucu dogrula.limitUyarilari ile AYNI metin ve sira; sunucu
 * kosu planinda yeniden kurar ve onaylatir). Olcum yoksa bos. Esitlik asim degil. Serbest hedefte cagrilmaz. B5: wrk'de
 * hiz uyarisi yok (tavan_rps hep 5000; gercek hiz degil), yalniz baglanti uyarisi.
 */
export function limitUyarilari(p: Partial<NlParametreler> | null | undefined, h: Pick<NlHedef, 'limitReq' | 'limitConn'> | null | undefined): string[] {
  const u: string[] = [];
  if (!p || !h) return u;
  const wrk = p.motor === 'wrk';
  const req = typeof h.limitReq === 'number' && Number.isFinite(h.limitReq) && h.limitReq > 0 ? h.limitReq : null;
  const conn = typeof h.limitConn === 'number' && Number.isInteger(h.limitConn) && h.limitConn > 0 ? h.limitConn : null;
  if (req !== null && !wrk && Array.isArray(p.hizlar) && p.hizlar.length) {
    const x = Math.max(...p.hizlar);
    if (x > req) u.push(`Seçilen hız (${x}/sn) hedefin ölçülmüş limit_req değerini (${limitMetni(req)} r/s) aşıyor; 429 alınırsa koşu durur.`);
  }
  if (conn !== null) {
    if (wrk && Array.isArray(p.baglantilar) && p.baglantilar.length) {
      const x = Math.max(...p.baglantilar);
      if (x > conn) u.push(`Seçilen en çok bağlantı (${x}) hedefin ölçülmüş limit_conn değerini (${conn}) aşıyor; fazla bağlantılar reddedilir (429 ya da 503) ve koşu durur.`);
    } else if (!wrk && Number.isInteger(p.maxvu) && (p.maxvu as number) > conn) {
      u.push(`Seçilen en çok VU (${p.maxvu}) hedefin ölçülmüş limit_conn değerini (${conn}) aşıyor; bu kadar bağlantı aynı anda açılırsa fazlası reddedilir (429 ya da 503) ve koşu durur ya da adım geçersiz sayılır.`);
    }
  }
  return u;
}
/** Yuk makinesi port / bellek uyarilari (sunucu dogrula.yukMakinesiUyarilari ile BIREBIR); alan yoksa bos. B5: port uyarisi yalniz k6. */
export function yukMakinesiUyarilari(o: Partial<NlOnKontrol> | null | undefined, p: Partial<NlParametreler> | null | undefined, motor: NlMotor): string[] {
  const u: string[] = [];
  if (!o || !p) return u;
  const wrk = motor === 'wrk';
  const hiz = !wrk && Array.isArray(p.hizlar) && p.hizlar.length ? Math.max(...p.hizlar) : null;
  const port = o.yukPortSayisi ?? null;
  if (p.kip === 'yeni' && hiz !== null && port !== null && port > 0) {
    const tavan = Math.floor(port / 60);
    if (hiz > tavan) {
      const tw = o.yukTwReuse ?? null;
      const ts = o.yukTcpTs ?? null;
      u.push(`Yük makinesinin yerel port aralığı ${port} port (tcp_tw_reuse ${tw === null ? '?' : tw}, tcp_timestamps ${ts === null ? '?' : ts}): "yeni" kipte istemci bağlantıyı önce kapatırsa saniyede yaklaşık ${tavan} yeni bağlantıya yeter; seçilen hız (${hiz}/sn) bunu aşıyor. Bağlantıyı hangi tarafın önce kapattığı (TIME_WAIT'in nerede biriktiği) doğrulanmadı; bağlantı hatası görürseniz hızı düşürün ya da "ka" kipini seçin.`);
    }
  }
  const mem = o.yukMemKb ?? null;
  if (!wrk && Number.isInteger(p.maxvu) && mem !== null && mem < (p.maxvu as number) * 8192) {
    u.push(`Yük makinesinde boş bellek ${Math.floor(mem / 1024)} MB; en çok ${p.maxvu} VU için önerilen en az ${(p.maxvu as number) * 8} MB. k6 bellek yetmezliğinden düşebilir; en çok VU'yu azaltın.`);
  }
  return u;
}
/** Baglanti basina bekleme (ms): yuk_wrk.lua `GECIKME_MS = ceil(N * 1000 / tavan)`. */
export const baglantiBeklemesiMs = (n: number, tavan: number) => (tavan > 0 && n > 0 ? Math.ceil((n * 1000) / tavan) : null);
/** RFC1123 kucuk harf host (port / joker yok) — sunucu ve playbook ayni kurali uygular. */
export const vhostGecerli = (v: string) => /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(v);
/** Noktali IPv4 (bastaki sifir yok) — sunucunun gecerliIpv4 deseni. 0/8, 127/8 ... reddini sunucu verir (400). */
export const ipGecerli = (v: string) => /^(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])){3}$/.test(v);
/** D7: Host basligi her iki kipte serbest metin. Sunucu kipinde listede olmayan ad ENGEL degil; ekran bu notu gosterir. */
export const VHOST_LISTEDE_YOK_NOTU = 'Bu ad sunucunun server_name listesinde yok; ön kontrol bunu onay isteyen bir uyarı olarak gösterir (joker / regex ad olabilir).';
export const SERBEST_VHOST_YARDIMI = 'Serbest hedefte server_name listesi yok; istekler bu Host başlığıyla gider. Yalnız üretim sunucularında tanımlı bir ad reddedilir.';

// ── Hedef etiketi ve cipler ─────────────────────────────────────────────────────────
/** Liste / karsilastirma etiketi: sunucu hedefinde host adi, serbestte IP (`hedefHost ?? hedefIp`). */
export const hedefEtiketi = (k: Pick<NlKosu, 'hedefHost' | 'hedefIp'>) => k.hedefHost || k.hedefIp || '';
export const SERBEST_CIP_IPUCU = 'Serbest hedef: yalnız istemci ölçümü (CPU ve nginx logu yok)';
export const H2_CIP_IPUCU = 'HTTP/2 koşusu: yalnız HTTP/2 koşularıyla karşılaştırılır';
export const WRK_CIP_IPUCU = 'Kapalı döngü: hız sütunu bağlantı sayısıdır; gecikme CO düzeltmeli; TLS 1.2’ye sabit değildir ve oturum devamı olabilir (TLS payı hesaplanmaz)';

// ── On kontrol ──────────────────────────────────────────────────────────────────────
/** wrk'nin istedigi glibc RHEL 8'in glibc'sinden (2.28) YENI mi (sayisal; "2.34" > "2.28", "2.28" degil). Bicimsiz /
 *  bos deger false (uyari yalniz olculmus gereksinimde). */
export const RHEL8_GLIBC = '2.28';
export function glibcRhel8Ustu(g: string | null | undefined): boolean {
  const m = /^(\d+)\.(\d+)/.exec(String(g ?? '').trim());
  if (!m) return false;
  const [maj, min] = [Number(m[1]), Number(m[2])];
  const [rMaj, rMin] = RHEL8_GLIBC.split('.').map(Number);
  return maj > rMaj || (maj === rMaj && min > rMin);
}
/** sha256 kisa gosterim: ilk `n` hane + "…" (tamami title'da). */
export const shaKisa = (sha: string | null | undefined, n = 16) => (sha ? `${sha.slice(0, n)}…` : '—');

/** On kontrol bu kadar sure gecerli (sunucu 15 dk'dan eski on kontrole dayanan kosuyu reddeder). */
export const ON_KONTROL_OMRU_MS = 15 * 60 * 1000;
export interface OnKontrolDegerlendirmesi {
  /** Kosuyu imkansiz kilan (playbook da ayni noktada durur): "Başlat" kapali. */
  engeller: string[];
  /** Acik onay isteyen (sozlesme 9.5): onay kutusu zorunlu. Okunamayan log dizini ENGELDIR (playbook FAIL der). */
  uyarilar: string[];
  /** Bilgi: k6 / wrk surumu, sikistirma dagilimi, serbest hedefte denetlenmeyenler. */
  bilgiler: string[];
}
type DegerlendirmeGirdisi = Pick<NlKosuAyrinti, 'durum' | 'onKontrol'>
  & Partial<Pick<NlKosuAyrinti, 'sunucuDegerlendirmesi' | 'isDurumu' | 'isHatasi' | 'hedefTuru' | 'motor' | 'parametreler' | 'aracId' | 'protokol'>>;
/** Sunucu metni cumle basi buyuk harfle; "wrk" arac adidir (sozlesme metni kucuk harfle baslar), oldugu gibi kalir. */
const buyukBasla = (x: string) => (/^wrk\b/.test(x) ? x : x.charAt(0).toLocaleUpperCase('tr-TR') + x.slice(1));
/** Sunucu metinleri (dogrula.cjs, sozlesme 8.4 / 19): geri donus degerlendirmesi ayni uyarilari onaylatir. */
export const HOST_LISTEDE_YOK_UYARISI = "Host başlığı (vhost) hedefin nginx -T çıktısındaki server_name'ler arasında yok ya da ölçülemedi (joker / regex ad olabilir; değilse istek default_server'a düşer). Ön kontroldeki 200 sonuçlarına bakın.";
export const SERBEST_UYARISI = 'Serbest hedef: sunucu tarafı ölçüm (CPU, nginx logu) yapılmaz; sonuçlar yalnız istemci ölçümüdür. Hedefte limit_req olmayabilir: yükün tek freni Portal tavanıdır (en çok 200 istek/sn ve 50 bağlantı). Yük bir yük dengeleyici (LB) üzerinden gidiyorsa nginx isteği (realip yoksa) LB\'nin IP\'sinden görür: IP başına 500 istek/sn ve 200 bağlantı sınırı LB arkasındaki herkesle, vhost başına 5000 istek/sn sınırı tüm istemcilerle paylaşılır; başka kullanıcılar 429 alabilir.';
// Inceleme WR2 (2026-10-28): tavan yalniz ORTALAMA hizi sinirlar (kapali dongu + sabit bekleme istekleri kumeler;
// Portal burst'u okumaz): metin "aşamaz" demez, burst'u kucuk / burst'suz yolda 429 -> DUR oldugunu soyler.
export const WRK_UYARISI = 'wrk kapalı döngüdür: her bağlantı yanıtı alınca yeni istek gönderir. Portal her isteğe bağlantı başına sabit bekleme ekler; toplam hız ORTALAMADA koşunun tavanını (sunucu hedefinde en çok 5000; serbest hedefte 200 istek/sn) aşmaz; bağlantılar birlikte başlar, ilk istekler rastgele yayılır ama istekler kümelenebilir. limit_req burst\'ü bağlantı sayısından küçük ya da burst\'süz yollarda 429 alınır ve koşu durur; böyle yollarda k6 kullanın ya da bağlantı sayısını düşük tutun. Sunucu hedefinde tavan hedefin ölçülmüş limit_req değerine göre düşürülmez ve bunun için ayrıca uyarı çıkmaz: ölçülmüş limit_req\'i olan hedefte gerçek hız onu aşabilir; böyle hedefte k6 kullanın. İlk 429 ya da 5xx yanıtta iş parçacığı yük üretmeyi keser; 429, 5xx, 10\'dan fazla soket hatası ya da %1 üstü hata oranında koşu durur (DUR). Gecikme yüzdelikleri wrk\'nin koordineli ihmal düzeltmesiyle hesaplanır; wrk sonuçları k6 sonuçlarıyla karşılaştırılmaz.';
export const SERBEST_ON_KONTROL_BILGISI = 'Serbest hedef: hedef sunucu denetlenmedi (SSH yok); yalnız yük sunucusu ve yollar denetlendi.';
/** "wrk 4.2.0 [epoll] Copyright ..." -> "4.2.0 [epoll] ..." (bilgi satiri "wrk ..." ile baslar; ad iki kez yazilmasin). */
const wrkSurumu = (s: string) => s.replace(/^wrk\s+/i, '');
/**
 * Sunucu kendi degerlendirmesini dondurduyse (onKontrolEngelleri / onKontrolUyarilari; plan uyarilari dahil) engel ve
 * uyari listesi ODUR: POST /kosular ayni listeyle karar verir, onay penceresi de ayni listeyi onaylatir. Alan yoksa
 * (eski sunucu) ayni kurallar burada uygulanir - tur ve motor KOSU SATIRINDAN (set_stats yankisindan degil):
 *  - sunucu: hedef kurallari; D7: server_name olculmedi ya da yok -> UYARI (listenin basinda), engel DEGIL.
 *  - serbest: hedef kurallari YOK (hedefe baglanilmaz); IP yuk sunucusunda yerel ya da olculemedi -> engel; sabit uyari.
 *  - motor engeli secili motorun ikilisinden; wrk iki durumlu (calisiyor ama surum okunamadi / bulunamadi); wrk sabit uyarisi.
 */
export function onKontrolDegerlendir(k: DegerlendirmeGirdisi | null): OnKontrolDegerlendirmesi {
  const d: OnKontrolDegerlendirmesi = { engeller: [], uyarilar: [], bilgiler: [] };
  if (!k) return d;
  if (AKTIF_DURUMLAR.has(k.durum)) return d;
  const o = k.onKontrol;
  const serbest = k.hedefTuru === 'serbest';
  const motor: NlMotor = k.motor === 'wrk' || k.motor === 'k6' ? k.motor : motorOf(k.parametreler);
  // Basarisiz on kontrolun ASIL nedeni (set_stats hata: playbook engeli, girdi reddi ...) once; yoksa genel metin.
  if (k.durum !== 'DONE') d.engeller.push(k.isHatasi ? `Ön kontrol başarısız: ${k.isHatasi}` : `Ön kontrol ${kosuDurumu(k.durum).etiket} — iş çıktısına bakın, düzeltip yeniden çalıştırın.`);
  else if (k.isDurumu && k.isDurumu.toUpperCase() !== 'OK') d.engeller.push(`Ön kontrol sonucu ${k.isDurumu}${k.isHatasi ? `: ${k.isHatasi}` : ''}.`);
  if (!o) {
    if (k.durum === 'DONE') d.engeller.push('Ön kontrol sonucu okunamadı (set_stats yok) — yeniden çalıştırın.');
    return d;
  }
  if (o.k6Surum) d.bilgiler.push(`k6 ${o.k6Surum}${o.k6Sha256 ? ` · sha256 ${o.k6Sha256.slice(0, 12)}…` : ''}`);
  if (o.wrkSurum) d.bilgiler.push(`wrk ${wrkSurumu(o.wrkSurum)}${o.wrkSha256 ? ` · sha256 ${o.wrkSha256.slice(0, 12)}…` : ''}`);
  if (o.aracGlibc) d.bilgiler.push(`yük sunucusu glibc ${o.aracGlibc}`);
  // Hic yol denenmediyse (0 / 0) sikistirma sifirlari OLCULMEDI: olculmus gibi yazilmaz.
  if (o.sikistirma && (o.yollarToplam ?? 0) > 0) d.bilgiler.push(`Sıkıştırma: statik ${fmtNumber(o.sikistirma.statik)}, dinamik ${fmtNumber(o.sikistirma.dinamik)}, sıkıştırmasız ${fmtNumber(o.sikistirma.sikistirmasiz)}`);
  if (serbest) d.bilgiler.push(SERBEST_ON_KONTROL_BILGISI);
  if (k.sunucuDegerlendirmesi) {
    d.engeller.push(...k.sunucuDegerlendirmesi.engeller.map(buyukBasla));
    d.uyarilar.push(...k.sunucuDegerlendirmesi.uyarilar.map(buyukBasla));
    return d;
  }
  if (serbest) {
    if (o.ipYukMakinesinde !== false) d.engeller.push('Hedef IP yük sunucusunda yerel ya da ölçülemedi — istek gönderilmedi.');
  } else {
    if (o.ipYerel === false) d.engeller.push('Seçilen IP hedef sunucuda yerel değil.');
    // D7: Host basligi listede olmamak (ya da olculememek) olcum dogrulugu sorunudur: onay isteyen UYARI, listenin basinda.
    if (o.serverNameVar !== true) d.uyarilar.unshift(HOST_LISTEDE_YOK_UYARISI);
  }
  // Tur 4: aracli satirda (eski satir aracId null: kural YOK) dogrulanmamis kopya engeldir; motor maddesinden once.
  if (k.aracId != null && o.aracDogrulandi !== true) d.engeller.push(`Yük aracı kopyası doğrulanamadı: ${o.aracHata ?? 'ölçülemedi'}.`);
  if (motor === 'wrk') {
    if (o.wrkVar !== true) {
      d.engeller.push(o.wrkCalisiyor === true
        ? `Yük sunucusunda wrk çalışıyor ama sürümü okunamadı ya da 4 altında (${o.wrkSurum || '-'}); araç setini yeniden hazırlayın (Yük Testi › Araçlar).`
        : 'Yük sunucusunda wrk bulunamadı ya da çalıştırılamıyor.');
    }
  } else if (o.k6Var === false) d.engeller.push('Yük sunucusunda k6 bulunamadı.');
  // HTTP/2: hedef h2 sunmuyorsa ya da olculemediyse kosu baslatilamaz (fail-closed); sunucunun metinleri ve sirasi.
  if (motor !== 'wrk' && kosuProtokolu(k) === 'h2') {
    const h2 = h2Engeli(o);
    if (h2) d.engeller.push(h2);
  }
  if (o.yollarToplam != null && o.yollar200 != null && o.yollar200 < o.yollarToplam) {
    d.uyarilar.push(`${fmtNumber(o.yollarToplam - o.yollar200)} / ${fmtNumber(o.yollarToplam)} yol 200 dönmedi — HAR alındıktan sonra deploy olmuş olabilir; k6 kurulum adımında bu yollarla koşu durur.`);
  }
  if (o.sikistirma?.statik != null && o.sikistirma.statik > 0) d.uyarilar.push(`Hedefte ön-sıkıştırılmış dosyalar var (${fmtNumber(o.sikistirma.statik)} yol statik .br/.gz ile dönüyor) — CPU ölçümü sıkıştırma maliyetini içermez.`);
  if (!serbest) {
    if (o.webLogDf != null && o.webLogDf >= 65) d.uyarilar.push(`/web_log doluluğu %${fmtNumber(o.webLogDf)} (≥ %65) — koşu geçersiz sayılır.`);
    if (o.logFormatUa === false) d.uyarilar.push('Etkin log_format “user-agent=” alanını yazmıyor — sunucu tarafı ölçüm test satırlarını ayıramaz.');
    if (o.masterSayisi != null && o.masterSayisi !== 1) d.engeller.push(`Hedefte ${fmtNumber(o.masterSayisi)} nginx master süreci var (1 bekleniyordu) — CPU kaydedici bu durumda başlamaz.`);
    // Playbook bunu ENGEL sayar (durum FAIL); sunucu da (onKontrolDegerlendir) - ekran uyari demez.
    if (o.logDiziniOkunur === false) d.engeller.push('Log dizini /web_log okunamıyor — sunucu tarafı istek sayısı ve süreleri ölçülemez.');
  }
  // 2026-11-03: yuk makinesi port / bellek olcumu (sunucu ile ayni yer: sabit uyarilardan once).
  d.uyarilar.push(...yukMakinesiUyarilari(o, k.parametreler, motor));
  if (serbest) d.uyarilar.push(SERBEST_UYARISI);
  if (motor === 'wrk') d.uyarilar.push(WRK_UYARISI);
  return d;
}
/** HTTP/2 on kontrol engeli (ilk tutan TEK madde; sunucu dogrula.onKontrolDegerlendir ile ayni metin ve sira); yoksa null. */
export function h2Engeli(o: Pick<NlOnKontrol, 'protokol' | 'curlH2' | 'alpnH2' | 'yollarYanitli' | 'yollarH2' | 'alpnKaynak'>): string | null {
  if (typeof o.protokol === 'string' && o.protokol !== 'h2') return 'Ön kontrol HTTP/2 için yapılmadı; ön kontrolü yeniden çalıştırın.';
  // curl HTTP/2'siz: yeni playbook ALPN'i openssl ile olcer (alpnKaynak 'openssl'); kaynak yoksa eski engel (fail-closed).
  const opensslAlpn = o.alpnKaynak === 'openssl';
  if (o.curlH2 === false && !opensslAlpn) return 'Yük sunucusundaki curl HTTP/2 desteklemiyor; HTTP/2 ön kontrolü yapılamadı.';
  if (o.alpnH2 === false) {
    if (opensslAlpn) return 'Hedef bu Host için HTTP/2 sunmuyor (ALPN, openssl ile ölçüldü; yük makinesindeki curl HTTP/2 desteklemediği için yollar HTTP/1.1 ile denendi). nginx’te bu server bloğunda http2 açık değil ya da SNI kapalıyken IP:443’ün varsayılan sunucusu HTTP/2 sunmuyor; HTTP/1.1 ile koşun ya da SNI’yi açın.';
    const s = (v: number | null | undefined) => (v == null ? '?' : String(v));
    return `Hedef bu Host için HTTP/2 sunmuyor (ALPN): ${s(o.yollarH2)}/${s(o.yollarYanitli)} yol HTTP/2 ile yanıt verdi. nginx’te bu server bloğunda http2 açık değil ya da SNI kapalıyken IP:443’ün varsayılan sunucusu HTTP/2 sunmuyor; HTTP/1.1 ile koşun ya da SNI’yi açın.`;
  }
  if (o.alpnH2 !== true) return 'HTTP/2 desteği ölçülemedi (playbook HTTP/2 ön kontrolünü desteklemiyor olabilir; Ansible deposunu güncelleyin).';
  return null;
}
/** On kontrolun kalan gecerlilik suresi (ms). Sunucu yasi verdiyse (onKontrolYasSn, `alindi` anindaki) o esas
 *  alinir - istemci saati kaymis olabilir; yoksa bitis anindan. Ikisi de yoksa null. */
export function onKontrolKalanMs(k: (Pick<NlKosuAyrinti, 'finishedAt'> & Partial<Pick<NlKosuAyrinti, 'onKontrolYasSn'>>) | null, simdi = Date.now(), alindi?: number | null): number | null {
  if (k?.onKontrolYasSn != null && alindi != null) return ON_KONTROL_OMRU_MS - k.onKontrolYasSn * 1000 - (simdi - alindi);
  const t = k?.finishedAt ? Date.parse(k.finishedAt) : NaN;
  return Number.isFinite(t) ? t + ON_KONTROL_OMRU_MS - simdi : null;
}

// ── Artimli cikti ───────────────────────────────────────────────────────────────────
/**
 * `/durum?since=n` gelen metni onceki ciktiya ekler. Sunucu `outputOffset` verdiyse metin o noktadan yerlestirilir
 * (since gecersiz sayildiysa 0: tamami gelir ve DEGISTIRIR). Ofset yoksa: gelen metin onceki ciktiyla basliyorsa
 * tamamidir (degistirir), degilse yeni parcadir (eklenir) - cikti iki durumda da yinelenmez.
 */
export function ciktiBirlestir(onceki: string, gelen: string, since: number, ofset?: number | null): string {
  const g = String(gelen ?? '');
  if (typeof ofset === 'number' && Number.isInteger(ofset) && ofset >= 0 && ofset <= onceki.length) return onceki.slice(0, ofset) + g;
  if (!since || !onceki) return g;
  if (g.length >= onceki.length && g.startsWith(onceki)) return g;
  return onceki + g;
}

// ── Hiz gruplamasi (karsilastir.py grupla() ile ayni kural) ──────────────────────────
export interface HizGrubu {
  anahtar: string; seri: string; hiz: number; n: number; nGecerli: number;
  /** GECERSIZ / HATALI disindaki adimlarin ortalamasi. */
  p95: number | null; hataOrani: number | null; hostCpuOrt: number | null; gercekRps: number | null;
  /** Yalniz GECERLI adimlarin ortalamasi (CPU kumesi). */
  cpuMsIstek: number | null;
  kapasiteRps: number | null;
  durum: 'GECERLI' | 'DOYMA' | 'KISMI' | 'GECERSIZ';
}
const ortalama = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
export const seriAdi = (a: Pick<NlAdim, 'senaryo' | 'kip' | 'ae'>) => [a.senaryo || '?', a.kip || '?', a.ae || '?'].join('/');
/** Tekrar metni: "1. tekrar" (tekrar bilinmiyorsa "? tekrar"). */
export const tekrarMetni = (n: number | null | undefined) => (n == null ? '? tekrar' : `${fmtNumber(n)}. tekrar`);
/** Adim etiketi: tekrar sirasi ("2. tekrar"); kos.sh'in yeniden denemesi (deneme > 1) varsa " · deneme N" eklenir. */
export const adimEtiketi = (a: Pick<NlAdim, 'tekrar' | 'deneme'>) => `${tekrarMetni(a.tekrar)}${a.deneme != null && a.deneme > 1 ? ` · deneme ${fmtNumber(a.deneme)}` : ''}`;
/** Adim / tekrar sutununun ipucu (E1): her kademe Tekrar sayisi kadar kosulur. */
export const tekrarIpucu = (birim: AdimBirimi) => `${birim === 'bağlantı' ? 'Her bağlantı sayısı' : 'Her hız'}, Tekrar sayısı kadar koşulur; tekrarlar arasındaki fark ölçümün tutarlılığını gösterir.`;
/** Ham TUR kodu R<n>_<SEN>_<KIP>_<AE>_<deger>_r<k> -> { hiz, tekrar }; bicim tutmazsa null. */
const TUR_KODU_RE = /^R\d+_[A-Za-z]+_(?:yeni|ka)_(?:br|gzip|identity)_(\d+)_r(\d+)$/;
export function turKodunuCoz(tur: string): { hiz: number; tekrar: number } | null {
  const m = TUR_KODU_RE.exec(String(tur ?? ''));
  return m ? { hiz: Number(m[1]), tekrar: Number(m[2]) } : null;
}
/** Metin icindeki adim: "90/sn adımının 2. tekrarında" (wrk: "8 bağlantı adımının ..."). Adim yoksa ham kod cozulur, o da
 *  olmazsa TUR adi oldugu gibi. */
export function turCumlesi(tur: string, adimlar: NlAdim[], birim: AdimBirimi): string {
  const a = adimlar.find((x) => x.tur === tur);
  const c = a && a.hiz != null ? { hiz: a.hiz, tekrar: a.tekrar } : turKodunuCoz(tur);
  if (!c) return tur;
  const deneme = a && a.deneme != null && a.deneme > 1 ? ` (deneme ${fmtNumber(a.deneme)})` : '';
  return `${kademeMetni(c.hiz, birim)} adımının ${c.tekrar == null ? '?' : fmtNumber(c.tekrar)}. tekrarında${deneme}`;
}
/**
 * Kosu uyarilarini ikiye ayirir: analiz.cjs'in kosu duzeyine katladigi adim uyarilari ("<TUR>: <uyari>" ve
 * "… ve N adım uyarısı daha") adim tablosunda ciple de gorunur; kutuda ayri, katlanmis listelenir.
 */
const ADIM_UYARISI_RE = /^R\d+_[A-Za-z0-9_-]+: /;
const ADIM_UYARISI_OZET_RE = /^… ve \d+ adım uyarısı daha$/;
export function uyarilariAyir(uyarilar: string[]): { genel: string[]; adim: string[] } {
  const genel: string[] = [];
  const adim: string[] = [];
  for (const u of uyarilar) (ADIM_UYARISI_RE.test(u) || ADIM_UYARISI_OZET_RE.test(u) ? adim : genel).push(u);
  return { genel, adim };
}
/** Tablo ve grafik sirasi: seri, hiz, tekrar, deneme (yeni dizi; girdi degismez). */
export function adimSirala(adimlar: NlAdim[]): NlAdim[] {
  return [...adimlar].sort((a, b) => {
    const sa = seriAdi(a);
    const sb = seriAdi(b);
    if (sa !== sb) return sa < sb ? -1 : 1;
    return (a.hiz ?? 0) - (b.hiz ?? 0) || (a.tekrar ?? 0) - (b.tekrar ?? 0) || (a.deneme ?? 0) - (b.deneme ?? 0);
  });
}
const gecersizMi = (g: string | null) => g === 'GECERSIZ' || g === 'HATALI';
/** DOYMA nedenlerinin HEPSI yuk makinesi (doyma:yuk_cpu_bosta_): hedef tarafi doyma yok (sunucu analiz.yukDoymaYalniz). */
export function yukDoymaYalniz(a: NlAdim): boolean {
  if (a.gecerlilik !== 'DOYMA') return false;
  const d = a.nedenler.filter((n) => n.startsWith('doyma:'));
  return d.length > 0 && d.every((n) => n.startsWith('doyma:yuk_cpu_bosta_'));
}
/**
 * Adimlari (senaryo, kip, ae, hiz) ile gruplar. Kapasite: `nproc` biliniyorsa nproc x 1000 x 0,8 / ortalama
 * CPU-ms/istek (karsilastir.py), yoksa gecerli adimlarin kapasite_rps ortalamasi.
 */
export function hizGrupla(adimlar: NlAdim[], nproc?: number | null): HizGrubu[] {
  const m = new Map<string, NlAdim[]>();
  for (const a of adimlar) {
    if (a.hiz == null) continue;
    const k = `${seriAdi(a)}|${a.hiz}`;
    const l = m.get(k);
    if (l) l.push(a);
    else m.set(k, [a]);
  }
  const out: HizGrubu[] = [];
  for (const [anahtar, rs] of m) {
    const gecerli = rs.filter((r) => !gecersizMi(r.gecerlilik));
    // B2: yalniz yuk makinesi doymus adim (hedef tarafi doyma yok) CPU kumesinde kalir (sunucu grupHesapla ile ayni).
    const cpuKume = gecerli.filter((r) => r.gecerlilik === 'GECERLI' || yukDoymaYalniz(r));
    // 2026-11-03: yuk makinesi doymus adim p95 / gecikme ortalamasina girmez (sunucu analiz.cjs grupHesapla ile ayni).
    const olcumKume = gecerli.some((r) => r.yukDoydu) ? gecerli.filter((r) => !r.yukDoydu) : gecerli;
    const cpu = ortalama(cpuKume.map((r) => r.cpuMsIstek));
    const kap = nproc && cpu ? (nproc * 1000 * 0.8) / cpu : ortalama(cpuKume.map((r) => r.kapasiteRps));
    out.push({
      anahtar, seri: seriAdi(rs[0]), hiz: rs[0].hiz as number, n: rs.length, nGecerli: gecerli.length,
      p95: ortalama(olcumKume.map((r) => r.p95)), hataOrani: ortalama(olcumKume.map((r) => r.hataOrani)),
      hostCpuOrt: ortalama(olcumKume.map((r) => r.hostCpuOrt)), gercekRps: ortalama(olcumKume.map((r) => r.gercekRps)),
      cpuMsIstek: cpu, kapasiteRps: kap,
      durum: !gecerli.length ? 'GECERSIZ' : gecerli.length < rs.length ? 'KISMI' : gecerli.some((r) => r.gecerlilik === 'DOYMA') ? 'DOYMA' : 'GECERLI',
    });
  }
  return out.sort((a, b) => (a.seri === b.seri ? a.hiz - b.hiz : a.seri < b.seri ? -1 : 1));
}

// ── Bicim ───────────────────────────────────────────────────────────────────────────
/** Ondalikli sayi (tr-TR); olculmedi = '—'. */
export function ondalik(x: number | null | undefined, basamak = 1): string {
  if (x == null || !Number.isFinite(x)) return '—';
  const k = 10 ** basamak;
  return fmtNumber(Math.round(x * k) / k);
}
/** Yuk makinesi bosta CPU % metni: tek ondaliga ASAGI yuvarlanir (sunucu doymaNedenleri ile ayni kural; 19,96 '%20'
 *  yazip YUK DOYDU rozetiyle celismesin). */
export const yukCpuMetni = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '—' : `%${(Math.floor(x * 10 + 1e-9) / 10).toFixed(1).replace('.', ',')}`);
/** B1: yuk makinesi CPU kolonu gorunur mu: bir adim olculmus ya da yeni playbook kaydi bekleyip olculememis (eski kosu: hayir). */
export const yukCpuKolonuVar = (adimlar: NlAdim[]) => adimlar.some((a) => a.yukCpuBosta != null || a.yukCpuOlculemedi === true);
/** Yuk makinesi CPU hucresi: olcum yoksa ve kayit bekleniyorduysa 'ölçülemedi', yoksa yukCpuMetni. */
export const yukCpuHucre = (a: Pick<NlAdim, 'yukCpuBosta' | 'yukCpuOlculemedi'>) => (a.yukCpuBosta == null && a.yukCpuOlculemedi === true ? 'ölçülemedi' : yukCpuMetni(a.yukCpuBosta));
/** Oran (0..1) -> yuzde metni. */
export const yuzde = (oran: number | null | undefined, basamak = 2) => (oran == null || !Number.isFinite(oran) ? '—' : `%${ondalik(oran * 100, basamak)}`);
/** Isaretli fark yuzdesi: "+4,2 %" / "−3,1 %". */
export function farkMetni(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return '—';
  const r = Math.round(x * 10) / 10;
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${fmtNumber(Math.abs(r))} %`;
}

// ── Sonuc ozeti (sade_sozlesme 2; sunucu alani yoksa ayni kural istemcide) ───────────────
const gecerliMi = (g: string | null) => g === 'GECERLI' || g === 'DOYMA';
const topla = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
};
/**
 * Adimlardan kosu ozeti: toplam istek (olcum fazi, nIstek), en iyi / en kotu p95 (gecerli + doyma adimlardan, yuk
 * makinesi doymus adim HARIC; hic yoksa tum satirlardan, `p95Kapsam` 'tum'), 429 / 5xx toplamlari, en yuksek hata orani. Reload olaylari ve konf bilgisi
 * yalniz sunucudan gelir (burada bos / null).
 */
export function sonucOzetiHesapla(adimlar: NlAdim[]): NlSonucOzeti {
  const gecerli = adimlar.filter((a) => gecerliMi(a.gecerlilik));
  const p95Gecerli = gecerli.filter((a) => !a.yukDoydu);
  const p95Kume = (p95Gecerli.some((a) => a.p95 != null) ? p95Gecerli : adimlar).filter((a) => a.p95 != null && Number.isFinite(a.p95));
  const kapsam: NlSonucOzeti['p95Kapsam'] = !p95Kume.length ? null : p95Gecerli.some((a) => a.p95 != null) ? 'gecerli' : 'tum';
  let iyi: NlAdim | null = null;
  let kotu: NlAdim | null = null;
  for (const a of p95Kume) {
    if (!iyi || (a.p95 as number) < (iyi.p95 as number)) iyi = a;
    if (!kotu || (a.p95 as number) > (kotu.p95 as number)) kotu = a;
  }
  const hatalar = adimlar.map((a) => a.hataOrani).filter((x): x is number => x != null && Number.isFinite(x));
  return {
    adimSayisi: adimlar.length, gecerliAdimSayisi: gecerli.length, toplamIstek: topla(adimlar.map((a) => a.nIstek)),
    p95EnIyi: iyi ? { deger: iyi.p95 as number, tur: iyi.tur } : null, p95EnKotu: kotu ? { deger: kotu.p95 as number, tur: kotu.tur } : null, p95Kapsam: kapsam,
    toplam429: topla(adimlar.map((a) => a.n429)), toplam5xx: topla(adimlar.map((a) => a.n5xx)),
    enYuksekHataOrani: hatalar.length ? Math.max(...hatalar) : null,
    hataVar: adimlar.some((a) => (a.n429 ?? 0) > 0 || (a.n5xx ?? 0) > 0 || (a.hataOrani ?? 0) > 0),
    cpuOlculemeyenAdim: adimlar.filter((a) => a.cpuOlculemedi != null).length, konfDegisti: null, reloadlar: [],
    yukDoyduAdim: adimlar.filter((a) => a.yukDoydu).length,
  };
}
/** TUR adi -> okunur adim etiketi ("250/sn · 2. tekrar"); adim bulunamazsa ham kod cozulur, o da olmazsa TUR adi. */
export function turEtiketi(tur: string, adimlar: NlAdim[], birim: AdimBirimi): string {
  const a = adimlar.find((x) => x.tur === tur);
  if (a) return `${kademeMetni(a.hiz, birim)} · ${adimEtiketi(a)}`;
  const c = turKodunuCoz(tur);
  return c ? `${kademeMetni(c.hiz, birim)} · ${tekrarMetni(c.tekrar)}` : tur;
}

// ── 2026-11-03 gosterim: CPU-ms, kapasite / host CPU ipuclari, bellek ───────────────────
const IKI_ONDALIK = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** E2: CPU-ms/istek "3,92 ms" (iki ondalik + birim; binlik ayirici gibi okunmaz); olculmedi '—'. */
export const cpuMsMetni = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '—' : `${IKI_ONDALIK.format(x)} ms`);
/** E3: kapasite sutun / kutu ipucu. */
export const KAPASITE_IPUCU = 'CPU’ya göre tahmini üst sınır: çekirdek × 1000 × 0,8 ÷ CPU-ms (%80 kullanım). Yük testiyle ölçülmedi; yalnız Nginx CPU’su sayıldığı için iyimserdir. En güvenilir değer en yüksek geçerli hızdakidir.';
/** E4: host CPU sutun ipucu; cekirdek sayisi kosudan (yoksa genel metin). */
export const hostCpuIpucu = (nproc: number | null | undefined) => `${nproc != null && nproc > 0 ? `${fmtNumber(nproc)} çekirdeğin toplamı` : 'Tüm çekirdeklerin toplamı'} (%100 = tüm çekirdekler dolu); Nginx + işletim sistemi + diğer süreçler.`;
/** E5: bellek kolonlari yalniz olculmus adim varsa (eski kosuda tablo BIREBIR eskisi). */
export const bellekKolonuVar = (adimlar: NlAdim[]) => adimlar.some((a) => a.bellek != null);
/** MB metni (tam sayi, tr-TR); olculmedi '—'. */
export const mbMetni = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '—' : `${fmtNumber(Math.round(x))} MB`);
/** Bellek kullanim yuzdesi (tam sayi); olculmedi '—'. */
export const bellekYuzdeMetni = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '—' : `%${fmtNumber(Math.round(x))}`);
/** Kosunun en yuksek nginx RSS'i (MB) ve hangi adimda; olcum yoksa null. */
export function enYuksekNginxBellek(adimlar: NlAdim[]): { mb: number; tur: string } | null {
  let en: { mb: number; tur: string } | null = null;
  for (const a of adimlar) {
    const v = a.bellek?.nginxRssMaxMb;
    if (v != null && Number.isFinite(v) && (!en || v > en.mb)) en = { mb: v, tur: a.tur };
  }
  return en;
}

// ── 2026-11-03 gosterim: bant genisligi ve bellek ayrisimi (YALNIZ BILGI) ──────────────────
const BIR_ONDALIK = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** Bit/sn -> ondalik (10^6) birim: >= 1 Gbps "1,23 Gbps", >= 1 Mbps "12,4 Mbps", alti "850 kbps"; 0 < x < 500 bps "<1 kbps"; olculmedi '—'.
 *  2026-11-04 (inceleme B9): birim YUVARLAMADAN SONRA secilir (999.600 bps "1,0 Mbps", 999,96 Mbps "1,00 Gbps"; "1.000 kbps" yok). */
export function bantMetni(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps) || bps < 0) return '—';
  if (bps > 0 && bps < 500) return '<1 kbps';
  const k = Math.round(bps / 1e3);
  if (k < 1000) return `${fmtNumber(k)} kbps`;
  const m = Math.round(bps / 1e5) / 10;
  if (m < 1000) return `${BIR_ONDALIK.format(m)} Mbps`;
  return `${IKI_ONDALIK.format(bps / 1e9)} Gbps`;
}
/** Bant genisligi kolonu / kutusu yalniz olculmus adim varsa (eski kosu: kolon gizli, tablo BIREBIR eskisi). */
export const agKolonuVar = (adimlar: NlAdim[]) => adimlar.some((a) => a.ag != null);
/** Bellek ayrisimi blogu yalniz olculmus adim varsa. */
export const bellekDetayVar = (adimlar: NlAdim[]) => adimlar.some((a) => a.bellekDetay != null);
/** Arayuz kullanim uyari esigi (analiz.cjs AG_KULLANIM_ESIK ile ayni). */
export const AG_KULLANIM_ESIK = 70;
/** Test trafigi ipucu (tablo / grafik). */
export const TEST_TRAFIGI_IPUCU = 'Yük makinesinin gözünden ölçüm fazının ortalaması: alınan (yanıtlar) / gönderilen (istekler); bayt × 8 ÷ süre. wrk gönderileni saymaz.';
/** NIC ipucu: hedef internet RP ise arayuz toplami test disi trafigi icerir. */
export const NIC_IPUCU = 'Arayüz sayacı (/proc/net/dev) bu makinenin TÜM trafiğini sayar: hedef aynı zamanda internet RP ise (ör. GBNGXT34) test dışı trafik de içerir; boşta taban (ilk adımdan önce) ile karşılaştırın.';
/** 2026-11-04 (inceleme B8): baglanti satiri ipucu; internet RP'de test disi baglantilar da sayilir. */
export const BAGLANTI_IPUCU = 'hedef IP:443 ESTABLISHED bağlantı sayısı. Hedef aynı zamanda internet RP ise (ör. GBNGXT34) üretim bağlantıları da sayılır: sızıntı kuralının “bağlantı sabit” koşulu etkilenebilir.';
/** Kosunun en yuksek test trafigi (alinan, bit/sn) ve hangi adimda; olcum yoksa null. */
export function enYuksekTestTrafigi(adimlar: NlAdim[]): { bps: number; tur: string } | null {
  let en: { bps: number; tur: string } | null = null;
  for (const a of adimlar) {
    const v = a.ag?.testAlinanBps ?? null;
    if (v != null && Number.isFinite(v) && (!en || v > en.bps)) en = { bps: v, tur: a.tur };
  }
  return en;
}
/** NIC secim kodu (ag_*.txt secim=) -> kisa Turkce aciklama. */
export function nicSecimMetni(secim: string | null | undefined): string {
  if (!secim) return 'arayüz bilinmiyor';
  if (secim === 'hedef_ip') return 'hedef IP’nin arayüzü';
  if (secim === 'ip_route') return 'hedefe giden yolun arayüzü';
  const m = /^lo_disi_toplam\(([a-z_]+)\)$/.exec(secim);
  if (m) {
    const neden: Record<string, string> = {
      hedef_ip_yok: 'hedef IP verilmedi', ip_komutu_yok: 'ip komutu yok', arayuz_bulunamadi: 'arayüz bulunamadı',
      hedef_ip_lo_uzerinde: 'hedef IP lo üzerinde (DSR)', arayuz_net_dev_de_yok: 'arayüz sayaçta yok',
    };
    return `lo dışı tüm arayüzlerin toplamı (${neden[m[1]] ?? m[1]}); test dışı trafik de içerir`;
  }
  return secim;
}
/** Bellek ayrisimi neden kodu -> cumle (gorunum.cjs bellekNedenleri). */
export const BELLEK_NEDEN_METNI: Record<string, string> = {
  tampon: 'Bağlantı / istek tamponları (yük kaynaklı, normal): Anon yükte arttı, dinlenmede geri indi.',
  anon_kalici: 'Anon yükte arttı ama dinlenmede inmedi; tek başına sızıntı değil, adımlar boyunca sürerse koşu uyarısına bakın.',
  paylasilan: 'Paylaşılan bellek bölgeleri (ssl_session_cache, limit_req / limit_conn, cache keys_zone) ilk kez doluyor; plato, sızıntı değil.',
  dosya: 'Eşlenen dosyalar / açık dosya önbelleği (File) arttı.',
  reload: 'Reload: eski ve yeni worker aynı anda (shutting down); RSS çift sayılır.',
  artis_yok: 'Belirgin artış yok.',
  anon_artti_dinlenme_yok: 'Anon yükte arttı; dinlenme ölçülmedi (adımlar arası boşluk kısa ya da kayıt erken durdu): tampon mu kalıcı mı ayrılamadı.',
  isci_degisti: 'Worker süreçleri taban / dinlenme ile ölçüm sonu arasında değişti (reload ya da yeniden doğuş): o noktayla karşılaştırma yapılmadı.',
};
/** bellekSizinti 'belirsiz' nedeni -> cumle parcasi (gorunum.cjs). */
const SIZINTI_BELIRSIZ_NEDENI: Record<string, string> = {
  dinlenme_yok: 'bir adımda dinlenme ölçülmedi',
  taban_yok: 'ilk adımın tabanı ölçülmedi',
  baglanti_degisti: 'bağlantı sayısı adımlar arasında değişti (rampa)',
  anon_inmedi: 'Anon dinlenmede tabana inmedi ama sürekli artış da yok',
};
/** Kosu duzeyi sizinti metni (gorunum.cjs bellekSizinti); yoksa null. */
export function bellekSizintiMetni(s: { durum: string; kaynak: string | null; neden?: string | null } | null | undefined): { ton: 'uyari' | 'bilgi'; metin: string } | null {
  if (!s) return null;
  if (s.durum === 'olasi_sizinti') {
    return { ton: 'uyari', metin: s.kaynak === 'anon'
      ? 'Olası sızıntı: worker Anon belleği adımlar boyunca sürekli arttı, bağlantı sayısı sabitken dinlenmede inmedi. Aynı koşuyu tekrarlayın.'
      : 'Olası sızıntı: nginx RSS adımlar boyunca arttı ve geri inmedi (Anon ölçümü yok: paylaşılan / dosya ayrımı yapılamadı). Aynı koşuyu tekrarlayın.' };
  }
  if (s.durum === 'rss_artisi_anon_degil') return { ton: 'bilgi', metin: 'RSS artışı Anon kaynaklı değil (paylaşılan bölge / eşlenen dosya); dinlenmede Anon iniyor: sızıntı olasılığı düşük.' };
  if (s.durum === 'belirsiz') {
    const n = (s.neden && SIZINTI_BELIRSIZ_NEDENI[s.neden]) || 'Anon kuralı değerlendirilemedi';
    return { ton: 'uyari', metin: `RSS adımlar boyunca arttı; kaynağı belirsiz (${n}): sızıntı ne doğrulandı ne dışlandı. Aynı koşuyu sabit bağlantıyla tekrarlayın.` };
  }
  return null;
}
/** Ana bellek olcusu: PSS (paylasilani bolustur), yoksa RSS bilesenleri toplami. */
export const BELLEK_PSS_IPUCU = 'RSS toplamı paylaşılan sayfaları her worker’da yeniden sayar (8 worker × 100 MB paylaşılan = 800 MB görünür); PSS paylaşılanı süreç sayısına böler: ana ölçü PSS (yoksa RSS).';
