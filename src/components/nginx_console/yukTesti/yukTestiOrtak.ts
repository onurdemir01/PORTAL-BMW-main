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
import type { Ton } from '@/components/server_hub/retirementStil';
import {
  EK_SINIRLAR, type NlAdim, type NlAdimGecerlilik, type NlDurum, type NlEylem, type NlGecerlilik, type NlHedef, type NlHedefTuru, type NlKarar, type NlKosu,
  type NlKosuAyrinti, type NlMotor, type NlParametreler, type NlSinirlar,
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
  DOYMA: { etiket: 'DOYMA', ton: 'uyari', aciklama: 'Yük sunucusu ya da hedef doydu (dropped > 0 ya da host CPU > %90) — sonuç sınırda.' },
};
export const kararBilgisi = (k: string | null | undefined) => KARAR[k as NlKarar] ?? { etiket: k || '—', ton: 'notr' as Ton, aciklama: '' };

export const ISLEM_ETIKETI: Record<string, string> = { on_kontrol: 'Ön kontrol', kosu: 'Koşu' };
export const KIP_ETIKETI: Record<string, string> = { yeni: 'yeni bağlantı', ka: 'keep-alive' };
export const AE_ETIKETI: Record<string, string> = { br: 'brotli (br)', gzip: 'gzip', identity: 'sıkıştırmasız' };

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
  if (!parcalar.length || parcalar.some((p) => !/^\d{1,3}$/.test(p))) return null;
  return parcalar.map(Number);
};
/** "100 250 400" / "100,250" -> sayilar; gecersiz parca varsa null. */
export const hizlariAyristir = (metin: string): number[] | null => sayiListesi(metin);
/** "2 4 8" / "2,4,8" -> baglanti sayilari; gecersiz parca varsa null. */
export const baglantilariAyristir = (metin: string): number[] | null => sayiListesi(metin);
export type ParametreHatalari = Partial<Record<keyof NlParametreler | 'butce', string>>;
const aralik = (v: number | undefined, a: number, b: number) => Number.isInteger(v) && (v as number) >= a && (v as number) <= b;
/** Hedefin olculmus limit_req'i 2 r/s altinda (0,9 x limit < 1) ya da limit_conn <= 1: sunucu 409 sinir_asildi ile ayni metni verir. */
export const SINIR_SIFIR_METNI = "Hedefin ölçülmüş limit_req değeri 2 r/s'nin altında (ya da limit_conn ≤ 1); bu hedefe yük testi yapılamaz.";
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
    // Toplam hiz tavani (hizSiniri) ya da baglanti tavani (vuSiniri) olculmus 0: sunucu iki motorda sinir_asildi der.
    if (s.maxHiz < 1 || s.maxBaglanti < 1) h.baglantilar = SINIR_SIFIR_METNI;
    else if (!b.length || b.length > s.maxBaglantiSayisi) h.baglantilar = '1 ile 5 arası bağlantı kademesi girin.';
    else if (b.some((x) => !aralik(x, s.baglantiMin, s.maxBaglanti))) h.baglantilar = `Her bağlantı 1–${s.maxBaglanti} olmalı.`;
    else if (new Set(b).size !== b.length) h.baglantilar = 'Aynı bağlantı sayısı iki kez yazılmış.';
    const t = p.is_parcacigi;
    if (!aralik(t, s.isParcacigiMin, s.maxIsParcacigi)) h.is_parcacigi = 'İş parçacığı 1–16 olmalı.';
    // wrk baglantilari c / t tam sayi bolmesiyle dagitir: bolunmeyen sayi TUR adindaki baglanti sayisini yalanlar.
    else if (!h.baglantilar && (t as number) > Math.min(...b)) h.is_parcacigi = 'İş parçacığı en küçük bağlantı sayısından büyük olamaz.';
    else if (!h.baglantilar && b.some((x) => x % (t as number) !== 0)) h.is_parcacigi = 'Her bağlantı sayısı iş parçacığı sayısına tam bölünmeli.';
  } else {
    const hz = Array.isArray(p.hizlar) ? p.hizlar : [];
    if (s.maxHiz < 1) h.hizlar = SINIR_SIFIR_METNI;
    else if (!hz.length || hz.length > 5) h.hizlar = '1 ile 5 arası hız girin (ör. 100 250 400).';
    else if (hz.some((x) => !aralik(x, 1, s.maxHiz))) h.hizlar = `Her hız 1–${s.maxHiz} istek/sn olmalı.`;
    else if (new Set(hz).size !== hz.length) h.hizlar = 'Aynı hız iki kez yazılmış.';
    if (s.maxVu < 1) h.maxvu = SINIR_SIFIR_METNI;
    else if (!aralik(p.maxvu, 10, s.maxVu)) h.maxvu = `10–${s.maxVu}`;
  }
  if (!aralik(p.tekrar, 1, s.maxTekrar)) h.tekrar = `1–${s.maxTekrar}`;
  if (!aralik(p.isinma, 5, s.isinmaMax)) h.isinma = `5–${s.isinmaMax} sn`;
  if (!aralik(p.sure, s.sureMin, s.sureMax)) h.sure = `${s.sureMin}–${s.sureMax} sn`;
  if (!aralik(p.bosluk, 0, 120)) h.bosluk = '0–120 sn';
  if (!aralik(p.bosta, 30, 120)) h.bosta = '30–120 sn';
  if (p.kip !== 'yeni' && p.kip !== 'ka') h.kip = 'yeni ya da ka';
  if (!['br', 'gzip', 'identity'].includes(p.ae)) h.ae = 'br, gzip ya da identity';
  if (!Object.keys(h).length && butceSn(p) > s.maxButceSn) {
    h.butce = `Toplam süre ${Math.ceil(butceSn(p) / 60)} dk; üst sınır ${Math.floor(s.maxButceSn / 60)} dk. ${motorOf(p) === 'wrk' ? 'Bağlantı kademesi' : 'Hız'}, tekrar ya da süreyi azaltın.`;
  }
  return h;
}
/**
 * Genel sinirlar, hedefin limit_req / limit_conn'undan gelen sinirla DARALTILIR (genisletilmez): k6 hizi `hizSiniri`,
 * VU ve wrk baglantisi `vuSiniri` ile. Olculmus 0 GERCEK bir sinirdir (bu hedefe yuk yok; sunucu sinir_asildi der),
 * "deger yok" (null) DEGIL: genel ust sinira donmez. Serbest hedefte (limit_req'i bilinmeyen LB / sunucu) iki motorda
 * hiz `serbestTavanRps`, VU ve baglanti `serbestMaxBaglanti` ile daraltilir.
 */
export function hedefSinirlari(s: NlSinirlar, h: Pick<NlHedef, 'hizSiniri' | 'vuSiniri'> | null | undefined, { hedefTuru = 'sunucu' }: { hedefTuru?: NlHedefTuru | null } = {}): TamSinirlar {
  const t = sinirlariTamamla(s);
  const dar = (genel: number, ozel: number | null | undefined) => (ozel != null && Number.isFinite(ozel) && ozel >= 0 ? Math.min(genel, Math.floor(ozel)) : genel);
  const d = { ...t, maxHiz: dar(t.maxHiz, h?.hizSiniri), maxVu: dar(t.maxVu, h?.vuSiniri), maxBaglanti: dar(t.maxBaglanti, h?.vuSiniri) };
  if (hedefTuru !== 'serbest') return d;
  return { ...d, maxHiz: Math.min(d.maxHiz, t.serbestTavanRps), maxVu: Math.min(d.maxVu, t.serbestMaxBaglanti), maxBaglanti: Math.min(d.maxBaglanti, t.serbestMaxBaglanti) };
}
/**
 * wrk toplam hiz tavani (sozlesme 3 `yuk_tavan_rps`; sunucu ayni formulle hesaplar, kullanici girmez): sunucu hedefinde
 * min(genel ust sinir, hizSiniri > 0 ? hizSiniri : genel), serbestte serbest tavani. Ekranda yalniz gosterilir.
 */
export function tavanRps(s: NlSinirlar, h: Pick<NlHedef, 'hizSiniri'> | null | undefined, hedefTuru: NlHedefTuru | null | undefined): number {
  const t = sinirlariTamamla(s);
  if (hedefTuru === 'serbest') return Math.min(t.maxHiz, t.serbestTavanRps);
  const hs = h?.hizSiniri;
  return Math.min(t.maxHiz, hs != null && Number.isFinite(hs) && hs > 0 ? Math.floor(hs) : t.maxHiz);
}
/** Tavanin nereden geldigi (ekran metni). */
export function tavanNedeni(s: NlSinirlar, h: Pick<NlHedef, 'hizSiniri'> | null | undefined, hedefTuru: NlHedefTuru | null | undefined): string {
  if (hedefTuru === 'serbest') return 'serbest hedef tavanı';
  return tavanRps(s, h, hedefTuru) < sinirlariTamamla(s).maxHiz ? 'hedefin ölçülmüş limit_req’inin %90’ı' : 'genel üst sınır';
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
export const WRK_CIP_IPUCU = 'Kapalı döngü: hız sütunu bağlantı sayısıdır; gecikme CO düzeltmeli; TLS 1.2’ye sabit değildir ve oturum devamı olabilir (TLS payı hesaplanmaz)';

// ── On kontrol ──────────────────────────────────────────────────────────────────────
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
  & Partial<Pick<NlKosuAyrinti, 'sunucuDegerlendirmesi' | 'isDurumu' | 'isHatasi' | 'hedefTuru' | 'motor' | 'parametreler'>>;
/** Sunucu metni cumle basi buyuk harfle; "wrk" arac adidir (sozlesme metni kucuk harfle baslar), oldugu gibi kalir. */
const buyukBasla = (x: string) => (/^wrk\b/.test(x) ? x : x.charAt(0).toLocaleUpperCase('tr-TR') + x.slice(1));
/** Sunucu metinleri (dogrula.cjs, sozlesme 8.4 / 19): geri donus degerlendirmesi ayni uyarilari onaylatir. */
export const HOST_LISTEDE_YOK_UYARISI = "Host başlığı (vhost) hedefin nginx -T çıktısındaki server_name'ler arasında yok ya da ölçülemedi (joker / regex ad olabilir; değilse istek default_server'a düşer). Ön kontroldeki 200 sonuçlarına bakın.";
export const SERBEST_UYARISI = 'Serbest hedef: sunucu tarafı ölçüm (CPU, nginx logu) yapılmaz; sonuçlar yalnız istemci ölçümüdür. Hedefte limit_req olmayabilir: yükün tek freni Portal tavanıdır (en çok 200 istek/sn ve 50 bağlantı). Yük bir yük dengeleyici (LB) üzerinden gidiyorsa nginx isteği (realip yoksa) LB\'nin IP\'sinden görür: IP başına 500 istek/sn ve 200 bağlantı sınırı LB arkasındaki herkesle, vhost başına 5000 istek/sn sınırı tüm istemcilerle paylaşılır; başka kullanıcılar 429 alabilir.';
// Inceleme WR2 (2026-10-28): tavan yalniz ORTALAMA hizi sinirlar (kapali dongu + sabit bekleme istekleri kumeler;
// Portal burst'u okumaz): metin "aşamaz" demez, burst'u kucuk / burst'suz yolda 429 -> DUR oldugunu soyler.
export const WRK_UYARISI = 'wrk kapalı döngüdür: her bağlantı yanıtı alınca yeni istek gönderir. Portal her isteğe bağlantı başına sabit bekleme ekler; toplam hız ORTALAMADA koşunun tavanını (hedefin ölçülmüş limit_req\'inin %90\'ı, en çok 450; serbest hedefte 200 istek/sn) aşmaz; bağlantılar birlikte başlar, ilk istekler rastgele yayılır ama istekler kümelenebilir. limit_req burst\'ü bağlantı sayısından küçük ya da burst\'süz yollarda 429 alınır ve koşu durur; böyle yollarda k6 kullanın ya da bağlantı sayısını düşük tutun. İlk 429 ya da 5xx yanıtta iş parçacığı yük üretmeyi keser; 429, 5xx, 10\'dan fazla soket hatası ya da %1 üstü hata oranında koşu durur (DUR). Gecikme yüzdelikleri wrk\'nin koordineli ihmal düzeltmesiyle hesaplanır; wrk sonuçları k6 sonuçlarıyla karşılaştırılmaz.';
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
  if (motor === 'wrk') {
    if (o.wrkVar !== true) {
      d.engeller.push(o.wrkCalisiyor === true
        ? `Yük sunucusunda wrk çalışıyor ama sürümü okunamadı ya da 4 altında (${o.wrkSurum || '-'}); wrk’yi make VER=4.2.0 ile yeniden derleyin.`
        : 'Yük sunucusunda wrk bulunamadı ya da çalıştırılamıyor.');
    }
  } else if (o.k6Var === false) d.engeller.push('Yük sunucusunda k6 bulunamadı.');
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
  if (serbest) d.uyarilar.push(SERBEST_UYARISI);
  if (motor === 'wrk') d.uyarilar.push(WRK_UYARISI);
  return d;
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
/** Adim etiketi: tekrar sirasi ("r2"); kos.sh'in yeniden denemesi (deneme > 1) varsa " · deneme N" eklenir. */
export const adimEtiketi = (a: Pick<NlAdim, 'tekrar' | 'deneme'>) => `r${a.tekrar ?? '?'}${a.deneme != null && a.deneme > 1 ? ` · deneme ${fmtNumber(a.deneme)}` : ''}`;
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
    const cpuKume = gecerli.filter((r) => r.gecerlilik === 'GECERLI');
    const cpu = ortalama(cpuKume.map((r) => r.cpuMsIstek));
    const kap = nproc && cpu ? (nproc * 1000 * 0.8) / cpu : ortalama(cpuKume.map((r) => r.kapasiteRps));
    out.push({
      anahtar, seri: seriAdi(rs[0]), hiz: rs[0].hiz as number, n: rs.length, nGecerli: gecerli.length,
      p95: ortalama(gecerli.map((r) => r.p95)), hataOrani: ortalama(gecerli.map((r) => r.hataOrani)),
      hostCpuOrt: ortalama(gecerli.map((r) => r.hostCpuOrt)), gercekRps: ortalama(gecerli.map((r) => r.gercekRps)),
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
/** Oran (0..1) -> yuzde metni. */
export const yuzde = (oran: number | null | undefined, basamak = 2) => (oran == null || !Number.isFinite(oran) ? '—' : `%${ondalik(oran * 100, basamak)}`);
/** Isaretli fark yuzdesi: "+4,2 %" / "−3,1 %". */
export function farkMetni(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return '—';
  const r = Math.round(x * 10) / 10;
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${fmtNumber(Math.abs(r))} %`;
}
