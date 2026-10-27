// src/components/nginx_console/yukTesti/yukTestiOrtak.ts — Yük Testi ekranlarinin SAF yardimcilari (2026-10-27).
//
// Etiket/ton tablolari, butce formulu, parametre denetimi, on kontrol degerlendirmesi, artimli cikti birlestirme
// ve hiz gruplamasi. Sunucu her kurali YENIDEN uygular (sozlesme 9: ekran aynalar ama ona guvenmez); buradaki
// amac kullaniciya dugmeye basmadan once nedenini soylemek.
import type { Ton } from '@/components/server_hub/retirementStil';
import type { NlAdim, NlAdimGecerlilik, NlDurum, NlEylem, NlGecerlilik, NlHedef, NlKarar, NlKosu, NlKosuAyrinti, NlParametreler, NlSinirlar } from '@/api/nginxLoadtestApi';
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
/** Kosunun durdurma isi baslamadi: sunucunun 424 durdur_baslatilamadi metniyle ayni kalip (mesaj gelmezse yedek). */
export function durdurBaslatilamadiMetni(r: Pick<NlEylem, 'iptal' | 'durdurHatasi'>): string {
  const iptalOldu = !!(r.iptal && (r.iptal.canceled || r.iptal.alreadyTerminal));
  return `AWX işi ${iptalOldu ? 'iptal edildi' : 'iptal edilemedi'}, ancak durdurma işi başlatılamadı: ${r.durdurHatasi || 'sunucu durdurma işini bildirmedi'}. Uzaktaki k6 / kaydedici sürüyor olabilir; Durdur'u yeniden deneyin. Kilitler koşunun süre sınırına kadar tutulur.`;
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
  onay_metni: 'yazılan sunucu adı hedefle aynı değil',
  sablon_yok: 'AWX şablonu tanımlı değil (Admin > Playbook kayıtları)',
  awx_template_playbook_mismatch: 'AWX şablonu yük testi playbook’unu çalıştırmıyor',
  envanter_okunamadi: 'envanter okunamadı (geçici) — biraz sonra yeniden deneyin',
  awx_okunamadi: 'AWX’e ulaşılamadı (geçici) — biraz sonra yeniden deneyin',
  baslatiliyor: 'koşu başlatılıyor; birkaç saniye sonra yeniden deneyin',
  kosu_bitti: 'koşu tamamlanmış; durdurulacak bir şey yok',
  yeniden_okunamaz: 'yalnız sonucu okunamamış koşular yeniden okunabilir',
};
export const nedenMetni = (kod: string | null | undefined) => (kod ? NEDEN[kod] ?? kod : '');
/** Ret govdesi / firlatilan hata -> tek satir mesaj (sunucu mesaji varsa o, yoksa kodun metni). */
export function hataMetni(x: unknown, yedek = 'İstek başarısız.'): string {
  const r = (x && typeof x === 'object' ? x : {}) as { message?: string; code?: string };
  const m = typeof r.message === 'string' ? r.message.trim() : '';
  return m || nedenMetni(r.code) || yedek;
}

// ── Butce ve parametre denetimi (sunucu ile ayni formul) ─────────────────────────────
/** Adim basina ek pay (k6 acilisi, setup yoklamasi, gracefulStop); sunucudaki dogrula.cjs ADIM_EK_SN ile ayni. */
export const ADIM_EK_SN = 20;
/** Sozlesme 3: bosta + hiz_sayisi * tekrar * (isinma + sure + bosluk + ADIM_EK_SN) + 120 sn. */
export function butceSn(p: Pick<NlParametreler, 'hizlar' | 'tekrar' | 'isinma' | 'sure' | 'bosluk' | 'bosta'>): number {
  return p.bosta + p.hizlar.length * p.tekrar * (p.isinma + p.sure + p.bosluk + ADIM_EK_SN) + 120;
}
/** "100 250 400" / "100,250" -> sayilar; gecersiz parca varsa null. */
export function hizlariAyristir(metin: string): number[] | null {
  const parcalar = String(metin || '').trim().split(/[\s,;]+/).filter(Boolean);
  if (!parcalar.length || parcalar.some((p) => !/^\d{1,3}$/.test(p))) return null;
  return parcalar.map(Number);
}
export type ParametreHatalari = Partial<Record<keyof NlParametreler | 'butce', string>>;
const aralik = (v: number, a: number, b: number) => Number.isInteger(v) && v >= a && v <= b;
/** Hedefin olculmus limit_req'i 2 r/s altinda (0,9 x limit < 1) ya da limit_conn <= 1: sunucu 409 sinir_asildi ile ayni metni verir. */
export const SINIR_SIFIR_METNI = "Hedefin ölçülmüş limit_req değeri 2 r/s'nin altında (ya da limit_conn ≤ 1); bu hedefe yük testi yapılamaz.";
/** Sozlesme 3 sinirlari (+ /hedefler'in daralttigi ust sinirlar). Bos nesne = gecerli. */
export function parametreHatalari(p: NlParametreler, s: NlSinirlar): ParametreHatalari {
  const h: ParametreHatalari = {};
  if (s.maxHiz < 1) h.hizlar = SINIR_SIFIR_METNI;
  else if (!p.hizlar.length || p.hizlar.length > 5) h.hizlar = '1 ile 5 arası hız girin (ör. 100 250 400).';
  else if (p.hizlar.some((x) => !aralik(x, 1, s.maxHiz))) h.hizlar = `Her hız 1–${s.maxHiz} istek/sn olmalı.`;
  else if (new Set(p.hizlar).size !== p.hizlar.length) h.hizlar = 'Aynı hız iki kez yazılmış.';
  if (!aralik(p.tekrar, 1, s.maxTekrar)) h.tekrar = `1–${s.maxTekrar}`;
  if (!aralik(p.isinma, 5, s.isinmaMax)) h.isinma = `5–${s.isinmaMax} sn`;
  if (!aralik(p.sure, s.sureMin, s.sureMax)) h.sure = `${s.sureMin}–${s.sureMax} sn`;
  if (!aralik(p.bosluk, 0, 120)) h.bosluk = '0–120 sn';
  if (!aralik(p.bosta, 30, 120)) h.bosta = '30–120 sn';
  if (s.maxVu < 1) h.maxvu = SINIR_SIFIR_METNI;
  else if (!aralik(p.maxvu, 10, s.maxVu)) h.maxvu = `10–${s.maxVu}`;
  if (p.kip !== 'yeni' && p.kip !== 'ka') h.kip = 'yeni ya da ka';
  if (!['br', 'gzip', 'identity'].includes(p.ae)) h.ae = 'br, gzip ya da identity';
  if (!Object.keys(h).length && butceSn(p) > s.maxButceSn) h.butce = `Toplam süre ${Math.ceil(butceSn(p) / 60)} dk; üst sınır ${Math.floor(s.maxButceSn / 60)} dk. Hız, tekrar ya da süreyi azaltın.`;
  return h;
}
/** Genel sinirlar, hedefin limit_req / limit_conn'undan gelen sinirla DARALTILIR (genisletilmez). Olculmus 0 GERCEK
 *  bir sinirdir (bu hedefe yuk yok; sunucu sinir_asildi der), "deger yok" (null) DEGIL: genel ust sinira donmez. */
export function hedefSinirlari(s: NlSinirlar, h: Pick<NlHedef, 'hizSiniri' | 'vuSiniri'> | null | undefined): NlSinirlar {
  const dar = (genel: number, ozel: number | null | undefined) => (ozel != null && Number.isFinite(ozel) && ozel >= 0 ? Math.min(genel, Math.floor(ozel)) : genel);
  return { ...s, maxHiz: dar(s.maxHiz, h?.hizSiniri), maxVu: dar(s.maxVu, h?.vuSiniri) };
}
/** Taranmis hedef (vhostVerisi) ama adlandirilmis server_name yok: sunucu her vhost'u vhost_hedefte_yok ile reddeder. */
export const VHOST_YOK_METNI = 'Son taramada bu hedefte adlandırılmış server_name yok (yalnız _ / joker / regex) — bu hedefe yük testi yapılamaz.';
/** RFC1123 kucuk harf host (port / joker yok) — sunucu ve playbook ayni kurali uygular. */
export const vhostGecerli = (v: string) => /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(v);

// ── On kontrol ──────────────────────────────────────────────────────────────────────
/** On kontrol bu kadar sure gecerli (sunucu 15 dk'dan eski on kontrole dayanan kosuyu reddeder). */
export const ON_KONTROL_OMRU_MS = 15 * 60 * 1000;
export interface OnKontrolDegerlendirmesi {
  /** Kosuyu imkansiz kilan (playbook da ayni noktada durur): "Başlat" kapali. */
  engeller: string[];
  /** Acik onay isteyen (sozlesme 9.5): onay kutusu zorunlu. Okunamayan log dizini ENGELDIR (playbook FAIL der). */
  uyarilar: string[];
  /** Bilgi: k6 surumu, sikistirma dagilimi. */
  bilgiler: string[];
}
type DegerlendirmeGirdisi = Pick<NlKosuAyrinti, 'durum' | 'onKontrol'> & Partial<Pick<NlKosuAyrinti, 'sunucuDegerlendirmesi' | 'isDurumu' | 'isHatasi'>>;
const buyukBasla = (x: string) => x.charAt(0).toLocaleUpperCase('tr-TR') + x.slice(1);
/**
 * Sunucu kendi degerlendirmesini dondurduyse (onKontrolEngelleri / onKontrolUyarilari) engel ve uyari listesi
 * ODUR: POST /kosular ayni listeyle karar verir, onay penceresi de ayni listeyi onaylatir. Alan yoksa (eski
 * sunucu) ayni kurallar burada uygulanir.
 */
export function onKontrolDegerlendir(k: DegerlendirmeGirdisi | null): OnKontrolDegerlendirmesi {
  const d: OnKontrolDegerlendirmesi = { engeller: [], uyarilar: [], bilgiler: [] };
  if (!k) return d;
  if (AKTIF_DURUMLAR.has(k.durum)) return d;
  const o = k.onKontrol;
  // Basarisiz on kontrolun ASIL nedeni (set_stats hata: playbook engeli, girdi reddi ...) once; yoksa genel metin.
  if (k.durum !== 'DONE') d.engeller.push(k.isHatasi ? `Ön kontrol başarısız: ${k.isHatasi}` : `Ön kontrol ${kosuDurumu(k.durum).etiket} — iş çıktısına bakın, düzeltip yeniden çalıştırın.`);
  else if (k.isDurumu && k.isDurumu.toUpperCase() !== 'OK') d.engeller.push(`Ön kontrol sonucu ${k.isDurumu}${k.isHatasi ? `: ${k.isHatasi}` : ''}.`);
  if (!o) {
    if (k.durum === 'DONE') d.engeller.push('Ön kontrol sonucu okunamadı (set_stats yok) — yeniden çalıştırın.');
    return d;
  }
  if (o.k6Surum) d.bilgiler.push(`k6 ${o.k6Surum}${o.k6Sha256 ? ` · sha256 ${o.k6Sha256.slice(0, 12)}…` : ''}`);
  if (o.sikistirma) d.bilgiler.push(`Sıkıştırma: statik ${fmtNumber(o.sikistirma.statik)}, dinamik ${fmtNumber(o.sikistirma.dinamik)}, sıkıştırmasız ${fmtNumber(o.sikistirma.sikistirmasiz)}`);
  if (k.sunucuDegerlendirmesi) {
    d.engeller.push(...k.sunucuDegerlendirmesi.engeller.map(buyukBasla));
    d.uyarilar.push(...k.sunucuDegerlendirmesi.uyarilar.map(buyukBasla));
    return d;
  }
  if (o.ipYerel === false) d.engeller.push('Seçilen IP hedef sunucuda yerel değil.');
  if (o.serverNameVar === false) d.engeller.push('vhost (server_name) hedefin nginx -T çıktısında yok.');
  if (o.k6Var === false) d.engeller.push('Yük sunucusunda k6 bulunamadı.');
  if (o.yollarToplam != null && o.yollar200 != null && o.yollar200 < o.yollarToplam) {
    d.uyarilar.push(`${fmtNumber(o.yollarToplam - o.yollar200)} / ${fmtNumber(o.yollarToplam)} yol 200 dönmedi — HAR alındıktan sonra deploy olmuş olabilir; k6 kurulum adımında bu yollarla koşu durur.`);
  }
  if (o.sikistirma?.statik != null && o.sikistirma.statik > 0) d.uyarilar.push(`Hedefte ön-sıkıştırılmış dosyalar var (${fmtNumber(o.sikistirma.statik)} yol statik .br/.gz ile dönüyor) — CPU ölçümü sıkıştırma maliyetini içermez.`);
  if (o.webLogDf != null && o.webLogDf >= 65) d.uyarilar.push(`/web_log doluluğu %${fmtNumber(o.webLogDf)} (≥ %65) — koşu geçersiz sayılır.`);
  if (o.logFormatUa === false) d.uyarilar.push('Etkin log_format “user-agent=” alanını yazmıyor — sunucu tarafı ölçüm test satırlarını ayıramaz.');
  if (o.masterSayisi != null && o.masterSayisi !== 1) d.engeller.push(`Hedefte ${fmtNumber(o.masterSayisi)} nginx master süreci var (1 bekleniyordu) — CPU kaydedici bu durumda başlamaz.`);
  // Playbook bunu ENGEL sayar (durum FAIL); sunucu da (onKontrolDegerlendir) - ekran uyari demez.
  if (o.logDiziniOkunur === false) d.engeller.push('Log dizini /web_log okunamıyor — sunucu tarafı istek sayısı ve süreleri ölçülemez.');
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
