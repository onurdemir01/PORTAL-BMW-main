// src/api/nginxLoadtestApi.ts — Nginx Hub › Yük Testi (server/nginx-loadtest, 2026-10-27).
//
// Sozlesme: /api/nginx-loadtest (ayri yonlendirici, nginxRedCevirici kapsaminda: 403/404 -> 409 nginxRed,
// GET disi 5xx -> 424). Is baslatan uclar ve /durum yalniz Admin; sunucu ve is numarasi ISTEMCIDEN ALINMAZ
// (koşu kaydindan turetilir). HAR dosyasi buraya hic gelmez: yalniz yol satirlari gonderilir.
//
// Liste/ayrinti uclari `okJson` (hata firlatir: ekran "yok" ile "okunamadi"yi karistirmasin); eylem uclari
// `safeJson` (409 is kodu - uyari_onayi, on_kontrol_eski ... - govdeden okunur).
// Adim satirlari ve on kontrol ozeti NORMALLESTIRILIR: sunucu alan adini camelCase ya da snake_case verse de,
// sayiyi metin olarak verse de ekran ayni sekli gorur; olculmeyen deger null kalir (asla 0'a donmez).
//
// TUR 3 (2026-10-28, kullanici: "bazen LB uzerinden bazen direkt sunucuya yuk basabilmek istiyorum ... wrk"):
// hedef IP'yi kullanici yazar; sunucu IP'yi siniflar (`/ip-sinifi`): bir DEV/TEST/QA nginx sunucusunun ise
// `sunucu` hedef (CPU + nginx logu), hicbir nginx sunucusunun degilse ve izinli agdaysa `serbest` hedef
// (yalniz istemci olcumu; hedefHost null). Yuk araci `k6` (acik dongu, istek/sn) ya da `wrk` (kapali dongu,
// baglanti; toplam hiz sunucunun hesapladigi tavanla sinirli). Eski kayitta tur / motor yok: sunucu / k6.
//
// TUR 4 (2026-11-02, kullanici: araclar bir kez /sw'ye, her kosu kopyalar, dogrular, siler): Admin "Araçları hazırla"
// (POST /araclar) k6'yi indirip wrk'yi derler ve /sw'ye yazar; Portal sha256'lari saklar, yuk makinesi kopyayi
// YALNIZ bu degerle dogrular. Iki arsiv ozeti Portal env'inde SABITTIR (onay toreni yok); Admin bir seti geri ceker
// (POST /araclar/:id/geri-cek). /hedefler `araclar` durumu tasir (alan yoksa fail-closed: hazir degil); on kontrol
// ozeti arac kopyasinin dogrulamasini (arac_*), kosu ayrintisi kullandigi seti (aracId / aracSeti) verir.
//
// SADELESTIRME (2026-11-02, R2 / AWX 3474239 geri bildirimi; sozlesme sade_sozlesme.md v1): adim satiri `cpuOlculemedi`
// (CPU-ms/istek ve kapasite neden null) ve `reloadlar` (adim araligina degen reload anlari), kosu `sonucOzeti` (toplam
// istek, en iyi / en kotu p95, 429 / 5xx toplamlari, kosu duzeyi reload olaylari). CPU-ms/istek ve kapasite istemcide de
// ASLA negatif / sifir gosterilmez (eski sunucu, eski satir): null + neden.
//
// HTTP/2 (2026-11-02, h2_sozlesme.md; kullanici: "gercek tarayicilar cogunlukla h2 kullanir"): kanonik parametrede
// `protokol` ('h1' | 'h2'; alani olmayan eski satir h1). h2 yalniz k6 ve kip 'ka'. /hedefler `protokoller` (alan yoksa
// yalniz h1: eski sunucu h2 kabul etmez). Kosu satiri `protokol` (liste ve ayrinti; yoksa parametrelerden, o da yoksa h1).
// On kontrol ozeti h2'de `protokol`, `curl_h2`, `alpn_h2`, `yollar_yanitli`, `yollar_h2` tasir (camelCase'e cevrilir).
// 2026-11-03 (AWX 3477866, curl HTTP/2'siz yuk makinesi): `alpn_kaynak` ('curl' | 'openssl'); openssl ise curl engeli yok.
// Reload fazi `olcum_kenari`: olay olcum penceresine degdi ama CPU penceresinin disinda (olcum etkilenmedi).
// 2026-11-03 (K1-K3): sunucu hedefinde hiz <= 5000, VU <= 1000, wrk tavani 5000 (`maxTavanRps`); hedefin olculmus
// limit_req / limit_conn'u (`limitReq` / `limitConn`) DARALTMAZ, asim plan uyarisidir. Yuk makinesi CPU'su: adim
// `yukCpuBosta` (bosta %, eski kosu null) ve `yukDoydu` (doyma:yuk_cpu_bosta_ nedeni); on kontrol `yukPortSayisi` ...
import { okJson, safeJson } from './http';

const BASE = '/api/nginx-loadtest';
const json = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export type NlDurum = 'QUEUED' | 'RUNNING' | 'FINALIZING' | 'DONE' | 'FAILED' | 'CANCELED' | 'OKUNAMADI';
export type NlGecerlilik = 'GECERLI' | 'KISMI' | 'GECERSIZ' | 'OKUNAMADI';
export type NlAdimGecerlilik = 'GECERLI' | 'DOYMA' | 'GECERSIZ' | 'HATALI';
export type NlKarar = 'KALICI' | 'NOTR' | 'RET' | 'GECERSIZ' | 'VERI_YOK' | 'DOYMA';
export type NlKip = 'yeni' | 'ka';
export type NlAe = 'br' | 'gzip' | 'identity';
export type NlIslem = 'on_kontrol' | 'kosu';
/** `sunucu`: IP bir DEV/TEST/QA nginx sunucusunun (CPU kaydedici + nginx logu); `serbest`: LB VIP'i ya da yonetilmeyen sunucu (yalniz istemci). */
export type NlHedefTuru = 'sunucu' | 'serbest';
/** `k6`: acik dongu (adim = istek/sn); `wrk`: kapali dongu (adim = baglanti sayisi, toplam hiz tavanli). */
export type NlMotor = 'k6' | 'wrk';
/** HTTP surumu: `h1` HTTP/1.1, `h2` HTTP/2 (yalniz k6 ve keep-alive). Alani olmayan eski kayit h1. */
export type NlProtokol = 'h1' | 'h2';

/** `neden` sunucunun mesaji, `kod` makine kodu. `hizSiniri` / `vuSiniri`: o hedefin limit_req / limit_conn'undan
 *  turetilen deger (veri yoksa null); 2026-11-03'ten beri DARALTMAZ, yalniz 0 hedefi kapatir. `limitReq` (r/s, kesirli
 *  olabilir) / `limitConn`: ham olculmus degerler; secilen hiz / VU asarsa ekran ve sunucu UYARIR (eski sunucu: yok).
 *  `vhostVerisi` false: server_name dokumu yok. */
export interface NlHedef {
  host: string; env: string | null; ipler: string[]; vhostlar: string[]; uygun: boolean; neden: string | null;
  kod?: string | null; hizSiniri?: number | null; vuSiniri?: number | null; limitReq?: number | null; limitConn?: number | null; vhostVerisi?: boolean;
}
export interface NlYukHost { host: string; env: string | null; uygun: boolean; neden: string | null }
/** Genel sinirlar (sunucunun SINIRLAR'i). wrk: baglanti kademeleri ve is parcacigi; serbest hedefte iki motorda en cok
 *  `serbestTavanRps` istek/sn ve `serbestMaxBaglanti` baglanti / VU. */
export interface NlSinirlar {
  maxHiz: number; maxTekrar: number; sureMin: number; sureMax: number; isinmaMax: number; maxVu: number; maxButceSn: number;
  baglantiMin: number; maxBaglanti: number; maxBaglantiSayisi: number; isParcacigiMin: number; maxIsParcacigi: number;
  serbestTavanRps: number; serbestMaxBaglanti: number;
  /** wrk toplam hiz tavani (sunucu hedefi, 2026-11-03: 5000). Eski sunucu vermez: maxHiz. */
  maxTavanRps?: number;
}
/** Sunucu bu alanlari vermezse (tur 3 oncesi) kullanilan degerler: sozlesmenin SINIRLAR sabitleri. */
export const EK_SINIRLAR = Object.freeze({
  baglantiMin: 1, maxBaglanti: 199, maxBaglantiSayisi: 5, isParcacigiMin: 1, maxIsParcacigi: 16, serbestTavanRps: 200, serbestMaxBaglanti: 50,
});
/**
 * Kanonik parametreler (DB `parametreler` JSON'u). k6: `hizlar` + `maxvu`; wrk: `baglantilar` + `is_parcacigi` (+ sunucunun
 * hesapladigi `tavan_rps`; istemci gondermez). Ilgisiz anahtarlar nesnede YOK: wrk kaydinda `hizlar` yoktur.
 * Eski kayitta `motor` yok -> k6 (motorOf).
 */
export interface NlParametreler {
  motor: NlMotor;
  hizlar?: number[]; maxvu?: number;
  baglantilar?: number[]; is_parcacigi?: number; tavan_rps?: number;
  tekrar: number; isinma: number; sure: number; bosluk: number; bosta: number; kip: NlKip; ae: NlAe;
  /** Yoksa h1 (eski kayit). h2 yalniz k6 ve kip 'ka'. */
  protokol?: NlProtokol;
}
/** /hedefler varsayilanlari: iki motorun alanlari birlikte; serbest hedefte k6 hiz ve VU varsayilani ayri. */
export interface NlVarsayilanlar {
  motor: NlMotor; hizlar: number[]; maxvu: number; baglantilar: number[]; is_parcacigi: number;
  tekrar: number; isinma: number; sure: number; bosluk: number; bosta: number; kip: NlKip; ae: NlAe;
  serbest: { hizlar: number[]; maxvu: number };
  protokol?: NlProtokol;
}
export interface NlHedefler {
  ok: true; hedefler: NlHedef[]; yukHostlari: NlYukHost[]; sinirlar: NlSinirlar; varsayilan: NlVarsayilanlar;
  /** Serbest hedef acik mi (NGINX_LOADTEST_SERBEST_AGLAR); `aglar` yalniz Admin istegine dolu. */
  serbest: { acik: boolean; aglar: string[] };
  /** Sunucunun kabul ettigi yuk araclari; alan gelmezse yalniz k6 (eski sunucu wrk'yi kabul etmez). */
  motorlar: NlMotor[];
  /** Sunucunun kabul ettigi protokoller; alan gelmezse yalniz h1 (eski sunucu h2 kabul etmez: secim kapali). */
  protokoller?: NlProtokol[];
  /** Etkin arac seti (tur 4). Alan gelmezse hazir DEGIL (kod 'bilinmiyor'): on kontrol kapali kalir. */
  araclar: NlAracDurumu;
}

/** Bir 'araclar' AWX isi ve onun /sw arac seti (Portal DB nginx_loadtest_araclar satiri). sha256'lar yalniz DONE'da dolu;
 *  `swDizin` yalniz DONE iken. `ozetlerGuncel`: setin arsiv ozetleri su anki Portal sabitleriyle ayni (degilse set etkin
 *  olamaz). `geriCekildi`: Admin geri cekti. `calismaYasSn`: baslangictan bu yana saniye (suren is uyarisi icin). */
export interface NlAracSeti {
  id: number; durum: NlDurum; derlemeHost: string; k6Surum: string; wrkSurum: string;
  k6Sha256: string | null; wrkSha256: string | null; k6ArsivSha256: string | null; wrkKaynakSha256: string | null;
  ozetlerGuncel: boolean; geriCekildi: boolean; geriCeken: string | null; geriCekmeAt: string | null; calismaYasSn: number | null; swDizin: string | null;
  derlemeRhel: string | null; derlemeGlibc: string | null; wrkGlibcGerekli: string | null; wrkOpenssl: string | null;
  wrkLuajit: string | null; hata: string | null; awxServerId: number | null; awxJobId: number | null; awxUrl: string | null;
  createdBy: string | null; createdAt: string | null; startedAt: string | null; finishedAt: string | null;
}
/** GET /araclar `ayar`: `proxy` yalniz Admin isteginde dolu (Admin disina null). `k6ArsivSha256` / `wrkKaynakSha256`: Portal
 *  env'indeki sabit arsiv ozetleri (yoksa null); `ozetEksikleri` bos degilse hazirlama kapali. `isSuresiSn`: hazirlama isinin
 *  ust siniri + pay (suren is bunu asarsa "durum okunamiyor" uyarisi). */
export interface NlAracAyar {
  derlemeHostlari: string[]; varsayilanDerlemeHost: string; k6Surum: string; wrkSurum: string;
  proxyTanimli: boolean; proxy: string | null; proxyHatasi: string | null;
  k6ArsivSha256: string | null; wrkKaynakSha256: string | null; ozetEksikleri: string[]; isSuresiSn: number;
}
/** GET /araclar `kapi`: etkin set yoksa nedeni (/hedefler `araclar.kod` / `mesaj` ile ayni kurallar). */
export interface NlAracKapi { kod: string | null; mesaj: string | null }
export interface NlAraclar { ok: true; etkin: NlAracSeti | null; calisan: NlAracSeti | null; gecmis: NlAracSeti[]; ayar: NlAracAyar; kapi: NlAracKapi }
/** /hedefler `araclar`: kod null | 'araclar_ozet_sabit_yok' | 'araclar_hazir_degil' | 'araclar_ozet_degisti' |
 *  'araclar_geri_cekildi' | 'db_okunamadi' (istemci: 'bilinmiyor'). */
export interface NlAracDurumu { hazir: boolean; aracId: number | null; k6Surum: string | null; wrkSurum: string | null; kod: string | null; mesaj: string | null }
/** Kosu ayrintisinin kullandigi arac seti (satirin arac_id'siyle; durumundan bagimsiz). */
export type NlKosuAracSeti = Pick<NlAracSeti, 'id' | 'k6Surum' | 'wrkSurum' | 'k6Sha256' | 'wrkSha256' | 'derlemeHost'>;

export interface NlSenaryo {
  id: number; ad: string; aciklama: string | null; vhost: string | null; senaryoTur: 'K' | 'B'; yolSayisi: number;
  sha256: string; kaynak: 'har' | 'liste'; createdBy: string | null; createdAt: string | null;
}
export interface NlSenaryoAyrinti extends NlSenaryo { tsv: string; ozet: unknown }
export interface NlYeniSenaryo {
  ad: string; aciklama?: string; vhost?: string; senaryoTur: 'K' | 'B'; kaynak: 'har' | 'liste';
  satirlar: { agirlik: number; har: number; tur: string; boyut: string; yol: string }[]; ozet?: unknown;
}

/** set_stats `nginx_loadtest_result.on_kontrol` (surum 2); bilinmeyen = null. Serbest hedefte hedef alanlari (ilk yedi)
 *  null; `k6*` yalniz motor k6, `wrk*` yalniz motor wrk iken dolu. */
export interface NlOnKontrol {
  ipYerel: boolean | null; serverNameVar: boolean | null; masterSayisi: number | null; webLogDf: number | null;
  logDiziniOkunur: boolean | null; logFormatUa: boolean | null; statikDirektif: boolean | null;
  /** Hedef IP yuk sunucusunun kendi IP'si mi (iki kipte; true = istek gonderilmedi). */
  ipYukMakinesinde: boolean | null;
  /** Yuk sunucusundaki izin dosyasinda eslesen girdi (yalniz serbest). */
  serbestAg: string | null;
  k6Var: boolean | null; k6Surum: string | null; k6Sha256: string | null;
  /** `wrkCalisiyor` ama `wrkVar` degil: ikili calisiyor, surum satiri okunamadi ya da 4 altinda (VER'siz derleme). */
  wrkVar: boolean | null; wrkCalisiyor: boolean | null; wrkSurum: string | null; wrkSha256: string | null;
  yollarToplam: number | null; yollar200: number | null; ilkHatalar: { yol: string; status: string }[];
  sikistirma: { statik: number | null; dinamik: number | null; sikistirmasiz: number | null } | null;
  /** Tur 4: yuk sunucusundaki arac kopyasi Portal'in sha256'siyla dogrulandi mi (blok kosmadiysa null), kopyanin
   *  sha256'si, yuk sunucusunun glibc surumu ve kopya / calistirma hatasi (glibc uyumsuz ...). */
  aracDogrulandi: boolean | null; aracSha256: string | null; aracGlibc: string | null; aracHata: string | null;
  /** HTTP/2 on kontrolu (yalniz h2 isteginde dolu; h1 / eski playbook: null): on kontrolun yapildigi protokol, yuk
   *  sunucusundaki curl HTTP/2 destekliyor mu, ALPN ile h2 sunuldu mu (her yanitli yol h2: true; biri degil: false;
   *  yanitli yol yok: null), yanit veren ve h2 ile yanit veren yol sayisi. */
  protokol?: NlProtokol | null; curlH2?: boolean | null; alpnH2?: boolean | null; yollarYanitli?: number | null; yollarH2?: number | null;
  /** ALPN'i olcen arac: 'curl' (curl HTTP/2'li, yollar h2 ile) ya da 'openssl' (curl HTTP/2'siz: yollar HTTP/1.1 ile denendi,
   *  ALPN openssl s_client ile tek baglantida). Eski playbook / tanimsiz deger: null (curl h2'siz ise engel, fail-closed). */
  alpnKaynak?: 'curl' | 'openssl' | null;
  /** 2026-11-03: yuk makinesinin salt okunur olcumu (yeni playbook; eski: null): yerel port sayisi, tcp_tw_reuse,
   *  tcp_timestamps, cekirdek sayisi, bos bellek (kB). */
  yukPortSayisi?: number | null; yukTwReuse?: number | null; yukTcpTs?: number | null; yukNproc?: number | null; yukMemKb?: number | null;
}
export interface NlKosu {
  id: number; islem: NlIslem; etiket: string | null; adim: string | null;
  /** Serbest hedefte null: yuk bir IP'ye gider, hedef sunucu yok (etiket `hedefHost ?? hedefIp`). */
  hedefHost: string | null; hedefIp: string | null;
  vhost: string | null; yukHost: string | null; senaryoId: number | null; senaryoAd: string | null; durum: NlDurum;
  gecerlilik: NlGecerlilik | null; createdBy: string | null; createdAt: string | null; startedAt: string | null;
  finishedAt: string | null; awxJobId: number | null;
  /** Kosu satirindan (eski satir: sunucu / k6). */
  hedefTuru: NlHedefTuru; motor: NlMotor;
  /** Kosunun protokolu (liste kolonu, yoksa parametreler.protokol, yoksa h1). */
  protokol: NlProtokol;
  /** Serbest satirda Portal izin listesinde SU AN eslesen girdi (yalniz ayrinti). */
  serbestAg?: string | null;
  /** On kontrol satirinin plan uyarilari (Host basligi / yuk sunucusu havuzu; onay ister; yalniz ayrinti). */
  planUyarilari?: string[];
}
export interface NlKosuAyrinti extends NlKosu {
  parametreler: (NlParametreler & { sni?: boolean }) | null; onKontrol: NlOnKontrol | null;
  gecersizNedenleri: string[]; sonucOzet: Record<string, unknown> | null; onKontrolKosuId: number | null;
  /** Sunucunun on kontrol degerlendirmesi (POST /kosular ayni listeyle karar verir); alan yoksa null. */
  sunucuDegerlendirmesi: { engeller: string[]; uyarilar: string[] } | null;
  /** On kontrolun yasi (sn, SUNUCU saatiyle, okuma anindaki); yalniz on kontrol kaydinda. */
  onKontrolYasSn: number | null;
  /** set_stats `durum` (OK / FAIL / DUR) ve `hata`; is sonucu yoksa null. */
  isDurumu: string | null; isHatasi: string | null;
  /** Portal analizi (sonucOzet.portal_analiz): cekirdek sayisi, TLS payi, uyarilar ya da okuma hatasi. */
  analiz: { nproc: number | null; cpuTlsliPay: number | null; uyarilar: string[]; okumaHatasi: string | null };
  /** Bu kosu icin baslatilan "durdur" kipindeki AWX isi (kilitler o is basariyla bitince birakilir); yoksa null. */
  durdurIsi: { awxServerId: number | null; awxJobId: number } | null;
  /** Poller'in sonucu okuma denemesi (FINALIZING'de "deneme N/3"); alan yoksa 0. */
  sonuclandirmaDenemesi: number;
  /** Tur 4: satirin arac seti (eski satir: null; "Araç kopyası" satiri ve arac engeli YOK). */
  aracId: number | null; aracSeti: NlKosuAracSeti | null;
  /** Sadelestirme turu: sunucunun sonuc ozeti (eski sunucu: null; ekran adimlardan hesaplar). */
  sonucOzeti: NlSonucOzeti | null;
}
/** Bir TUR (adim) satiri. Sure ms, hata_orani oran (0..1), host_cpu yuzde. */
export interface NlAdim {
  tur: string; senaryo: string | null; kip: string | null; ae: string | null; hiz: number | null; deneme: number | null;
  /** Tekrar sirasi: TUR soneki `_rN` (yoksa ham.tekrar). `deneme` kos.sh'in yeniden deneme sayisidir (Portal'da hep 1). */
  tekrar: number | null;
  /** Adim uyarilari (ham.uyarilar: diger_trafik, log_satiri_yok ...); gecerliligi dusurmez ama olcumu sorgulatir. */
  uyarilar: string[];
  /** Olcum penceresinin kaynagi (ham.pencere_kaynak): 'log' disinda sunucu rps'i olculmedi (istemci saatinden). */
  pencereKaynak: string | null;
  gecerlilik: NlAdimGecerlilik | null; nedenler: string[];
  p50: number | null; p95: number | null; p99: number | null; ttfbP95: number | null; tlsP95: number | null; connectP95: number | null;
  hataOrani: number | null; gercekRps: number | null; baytIstek: number | null; nIstek: number | null; n429: number | null; n5xx: number | null;
  dropped: number | null; istekSunucu: number | null; rpsSunucu: number | null; cpuMsIstek: number | null; hostCpuOrt: number | null;
  kapasiteRps: number | null; srtP50: number | null; srtP95: number | null; srtP99: number | null; sikistirmaTuru: string | null;
  /** Sadelestirme turu (2026-11-02): CPU-ms/istek ve kapasite hesaplanamadiysa nedeni (`reload`, `sayac_geriledi`,
   *  `net_negatif`, `negatif_deger`); null = olculdu ya da olculmesi beklenmiyordu. Deger o zaman null'dir (asla negatif). */
  cpuOlculemedi: string | null;
  /** Bu adimin (isinma + olcum) araligina degen reload olaylari (eski satir: bos). */
  reloadlar: NlReloadAni[];
  /** 2026-11-03: yuk makinesinin olcum penceresi bosta CPU ortalamasi (%; eski kosu / kayit yok: null). */
  yukCpuBosta: number | null;
  /** Yuk makinesi doydu (bosta < %20; nedenlerde `doyma:yuk_cpu_bosta_`): gecerlilik DOYMA, p95 kararina girmez (hedefin
   *  CPU-ms/istek'i gecerli kalir). */
  yukDoydu: boolean;
  /** B1: yeni playbook yuk makinesi CPU kaydi bekliyordu ama bu adimda olcum yok (eski kosu / eski sunucu: false). */
  yukCpuOlculemedi: boolean;
  /** 2026-11-03: bellek olcumu (hedef nginx RSS / bos bellek, yuk makinesi bellegi, arac RSS); eski kosu null (olculmedi). */
  bellek: NlBellek | null;
  /** 2026-11-03: kip dogrulamasi (istenen / gerceklesen); eski sunucu null (blok gosterilmez). Gecerliligi DEGISTIRMEZ. */
  kipDogrulama: NlKipDogrulama | null;
}
export interface NlBellek {
  nginxRssOrtMb: number | null; nginxRssMaxMb: number | null; hedefBellekYuzde: number | null; hedefBosMinYuzde: number | null;
  yukBellekYuzde: number | null; yukBosMinYuzde: number | null; aracRssMaxMb: number | null;
}
export type NlKipDurumu = 'tamam' | 'uyari' | 'olculmedi';
export interface NlKipDogrulama {
  protokol: { istenen: NlProtokol; olculen: NlProtokol | null; uyumsuz: number | null; durum: NlKipDurumu };
  baglanti: { istenen: string | null; yeniBaglantiYuzde: number | null; istekBaglanti: number | null; durum: NlKipDurumu };
  sikistirma: {
    istenen: string | null; n: number | null; dagilim: Record<string, number> | null; yok1kbAlti: number | null; kucukYuzde: number | null;
    istenenYuzde: number | null; durum: NlKipDurumu;
  };
  uyarilar: string[];
  durum: NlKipDurumu;
}
/** Reload (worker PID kumesi degisimi) ani: epoch saniye; `tOnce` ile `t` arasinda oldu, `tSon`'a dek surdu. */
export interface NlReloadAni {
  t: number; tOnce: number | null; tSon: number; tur: string | null; faz: 'isinma' | 'olcum' | 'olcum_kenari' | 'bosluk' | 'kosu_oncesi' | string;
}
export interface NlReloadOlayi extends NlReloadAni {
  kesit: string; workerOnce: number | null; workerSonra: number | null; kapananEnCok: number; etkilenenTurlar: string[];
}
/** GET /kosular/:id `sonucOzeti` (sunucu adim satirlarindan hesaplar; alan yoksa ekran adimlardan hesaplar). */
export interface NlSonucOzeti {
  adimSayisi: number; gecerliAdimSayisi: number; toplamIstek: number | null;
  p95EnIyi: { deger: number; tur: string } | null; p95EnKotu: { deger: number; tur: string } | null; p95Kapsam: 'gecerli' | 'tum' | null;
  toplam429: number | null; toplam5xx: number | null; enYuksekHataOrani: number | null; hataVar: boolean;
  cpuOlculemeyenAdim: number; konfDegisti: boolean | null; reloadlar: NlReloadOlayi[];
  /** YUK_DOYDU isaretli adim sayisi (eski sunucu: 0). */
  yukDoyduAdim?: number;
}
/** Karar tablosu satiri (analiz.cjs tabloYap): ref / aday hiz grubunun ozeti (snake_case; o tarafta kademe yoksa null),
 *  fark_yuzde YUZDE cinsinden (aday / ref - 1) x 100. */
export interface NlKarsilastirmaSatiri { hiz: number | null; ref: Record<string, unknown> | null; aday: Record<string, unknown> | null; farkYuzde: Record<string, number | null> }
/** Karsilastirmanin bir tarafi; `motor` / `hedefTuru` kosu satirindan (eski sunucu vermez). */
export interface NlKarsilastirmaTarafi { id: number; etiket: string | null; createdAt: string | null; motor?: NlMotor; hedefTuru?: NlHedefTuru; protokol?: NlProtokol }
export interface NlKarsilastirma {
  ok: true; karar: NlKarar; nedenler: string[]; tablo: NlKarsilastirmaSatiri[];
  ref: NlKarsilastirmaTarafi; aday: NlKarsilastirmaTarafi;
  kademe?: { cpu: number | null; p95: number | null } | null;
}
/** Eylem yaniti: basari ya da ret govdesi (`code`, 409 uyari_onayi'nda `uyarilar`). Durdur: `iptal` (AWX iptal
 *  sonucu), `durdurIsi` (durdur kipindeki is) ve hatalari; 424 durdur_baslatilamadi govdesi de bunlari tasir. */
export interface NlEylem {
  ok: boolean; message?: string; code?: string; kosuId?: number; jobId?: number | null; awxServerId?: number; id?: number; uyarilar?: string[]; _httpStatus?: number;
  iptal?: { canceled?: boolean; alreadyTerminal?: boolean } | null; iptalHatasi?: string | null;
  durdurIsi?: { jobId: number; awxServerId: number } | null; durdurHatasi?: string | null;
  /** POST /araclar: baslatilan arac seti; POST /araclar/:id/geri-cek: geri cekilen set (ham, aracSetiNormalle ile okunur)
   *  ve yeni kapi durumu. */
  aracId?: number; arac?: unknown; kapi?: { hazir?: boolean; aracId?: number | null; kod?: string | null; mesaj?: string | null };
}
/** GET /kosular suzgeci: `onceki` = yalniz bu numaradan kucuk kayitlar (sayfalama), `limit` 1..200 (sunucu varsayilani 50).
 *  `ip` hedef IP (IPv4), `hedefTuru` / `motor` kosu satirindan. */
export interface NlKosuSuzgeci {
  limit?: number; hedef?: string; islem?: NlIslem; durum?: NlDurum; onceki?: number; ip?: string; hedefTuru?: NlHedefTuru; motor?: NlMotor;
}
/** IP'nin sahibi (ret govdesindeki `sahipler`, en cok 10). */
export interface NlIpSahibi { host: string; env: string | null; nginx: boolean; kaynaklar: string[] }
/** GET /ip-sinifi: IP bir non-prod nginx sunucusunun (sunucu hedefi; `/hedefler` satiriyla ayni alanlar; `uygun:false`
 *  da 200'dur ve ON KONTROLU KAPATIR) ya da izinli agdaki sahipsiz / nginx disi bir IP (serbest hedef). */
export interface NlIpSinifiSunucu {
  ok: true; tur: 'sunucu'; ip: string; host: string; env: string | null; vhostlar: string[]; vhostVerisi: boolean;
  hizSiniri: number | null; vuSiniri: number | null; limitReq?: number | null; limitConn?: number | null; uygun: boolean; neden: string | null; kod: string | null; kaynaklar: string[];
}
export interface NlIpSinifiSerbest { ok: true; tur: 'serbest'; ip: string; host: null; ag: string; digerSahipler: { host: string; env: string | null }[] }
export type NlIpSinifi = NlIpSinifiSunucu | NlIpSinifiSerbest;
/** Ret: 400 (gecersiz IP / host), 409 (ip_belirsiz, ip_sahibi_cozulemedi, serbest_kapali, ip_izinli_agda_degil,
 *  ip_yasakli_agda, ip_yasak_listesi_gecersiz, hedef_uretim, ayni_host, ip_hedefte_yok ...) ya da 424 (gecici). */
export type NlIpSinifiRet = NlRet & { sahipler?: NlIpSahibi[] };
/** `output` = maskeli ciktinin `outputOffset`'ten sonrasi (`since` gecersizse 0'dan, yani tamami). */
export interface NlDurumYaniti {
  ok: true; status: string; finished: boolean; output: string; outputOffset?: number; outputLength?: number; kaynak?: 'awx' | 'arsiv';
  result: unknown; kosuDurum: NlDurum | null;
}
export type NlRet = { ok: false; message?: string; code?: string; kalici?: boolean; _httpStatus?: number };

// ── normallestirme ─────────────────────────────────────────────────────────────────
type Ham = Record<string, unknown>;
const nesne = (x: unknown): Ham => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Ham) : {});
/** Ilk tanimli alan (camelCase, sonra snake_case). */
const alan = (r: Ham, ...adlar: string[]): unknown => {
  for (const a of adlar) if (r[a] !== undefined) return r[a];
  return undefined;
};
/** Sayi ya da null. Bos metin / null / NaN = olculmedi (0 DEGIL). */
export function sayiVeya(x: unknown): number | null {
  if (x == null || x === '' || typeof x === 'boolean') return null;
  const n = typeof x === 'number' ? x : Number(String(x).trim());
  return Number.isFinite(n) ? n : null;
}
/** Ansible'dan metin olarak da gelebilir ('True', 'false', '1'). */
export function mantikVeya(x: unknown): boolean | null {
  if (typeof x === 'boolean') return x;
  if (typeof x === 'number') return x !== 0;
  if (typeof x === 'string') {
    const s = x.trim().toLowerCase();
    if (['true', 'yes', '1', 'evet'].includes(s)) return true;
    if (['false', 'no', '0', 'hayir', 'hayır'].includes(s)) return false;
  }
  return null;
}
const metinVeya = (x: unknown): string | null => (x == null || x === '' ? null : String(x));
/** JSON dizi metni ya da dizi -> metin dizisi. */
export function metinDizisi(x: unknown): string[] {
  let v = x;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    try { v = JSON.parse(s); } catch { return [s]; }
  }
  return Array.isArray(v) ? v.filter((e) => e != null && e !== '').map(String) : [];
}
const jsonNesne = (x: unknown): Ham | null => {
  if (typeof x === 'string') { try { return nesne(JSON.parse(x)); } catch { return null; } }
  return x && typeof x === 'object' ? nesne(x) : null;
};

const ADIM_ALANLARI: [keyof NlAdim, string][] = [
  ['p50', 'p50'], ['p95', 'p95'], ['p99', 'p99'], ['ttfbP95', 'ttfb_p95'], ['tlsP95', 'tls_p95'], ['connectP95', 'connect_p95'],
  ['hataOrani', 'hata_orani'], ['gercekRps', 'gercek_rps'], ['baytIstek', 'bayt_istek'], ['nIstek', 'n_istek'], ['n429', 'n_429'],
  ['n5xx', 'n_5xx'], ['dropped', 'dropped'], ['istekSunucu', 'istek_sunucu'], ['rpsSunucu', 'rps_sunucu'], ['cpuMsIstek', 'cpu_ms_istek'],
  ['hostCpuOrt', 'host_cpu_ort'], ['kapasiteRps', 'kapasite_rps'], ['srtP50', 'srt_p50'], ['srtP95', 'srt_p95'], ['srtP99', 'srt_p99'],
];
/** TUR soneki `_rN` -> tekrar sirasi (kos.sh adlandirmasi R<id>_<SEN>_<KIP>_<AE>_<hiz>_r<tekrar>). */
const TEKRAR_SONEKI = /_r(\d+)$/;
export function adimNormalle(x: unknown): NlAdim {
  const r = nesne(x);
  // ham: analiz.cjs adimSatiri'nin ham nesnesi (sunucu JSON'u cozer; metin gelirse burada cozulur).
  const ham = jsonNesne(alan(r, 'ham')) ?? {};
  const tur = String(alan(r, 'tur') ?? '');
  const sonek = TEKRAR_SONEKI.exec(tur);
  const a = {
    tur, senaryo: metinVeya(alan(r, 'senaryo')), kip: metinVeya(alan(r, 'kip')), ae: metinVeya(alan(r, 'ae')),
    hiz: sayiVeya(alan(r, 'hiz')), deneme: sayiVeya(alan(r, 'deneme')),
    tekrar: sonek ? Number(sonek[1]) : sayiVeya(ham.tekrar),
    uyarilar: metinDizisi(ham.uyarilar),
    pencereKaynak: metinVeya(alan(ham, 'pencere_kaynak', 'pencereKaynak')),
    gecerlilik: (metinVeya(alan(r, 'gecerlilik')) as NlAdimGecerlilik | null), nedenler: metinDizisi(alan(r, 'nedenler')),
    sikistirmaTuru: metinVeya(alan(r, 'sikistirmaTuru', 'sikistirma_turu')),
  } as NlAdim;
  for (const [k, s] of ADIM_ALANLARI) (a as unknown as Record<string, number | null>)[k] = sayiVeya(alan(r, k, s));
  // CPU-ms/istek ve kapasite ASLA negatif / sifir degildir: sayac sifirlanan (reload) ya da arka plani asan adimda
  // sunucu null + neden verir; eski sunucuya / eski satira karsi ayni kural burada da (deger null, neden negatif_deger
  // ya da reload). Karar ve ortalama bu degerleri kullanmaz.
  a.cpuOlculemedi = metinVeya(alan(r, 'cpuOlculemedi', 'cpu_olculemedi'));
  a.reloadlar = reloadlarNormalle(alan(r, 'reloadlar'));
  a.yukCpuBosta = sayiVeya(alan(r, 'yukCpuBosta')) ?? sayiVeya(ham.yuk_cpu_bosta);
  a.yukDoydu = a.nedenler.some((n) => n.startsWith('doyma:yuk_cpu_bosta_'));
  a.yukCpuOlculemedi = alan(r, 'yukCpuOlculemedi') === true || ham.yuk_cpu_olculemedi === true;
  a.bellek = bellekNormalle(alan(r, 'bellek') ?? ham.bellek);
  a.kipDogrulama = kipNormalle(alan(r, 'kipDogrulama'));
  const reloadNedeni = a.nedenler.some((n) => n.startsWith('reload('));
  const kotu = (x: number | null) => x != null && !(x > 0);
  if (reloadNedeni || kotu(a.cpuMsIstek) || kotu(a.kapasiteRps)) {
    if (!a.cpuOlculemedi && (a.cpuMsIstek != null || a.kapasiteRps != null)) a.cpuOlculemedi = reloadNedeni ? 'reload' : 'negatif_deger';
    a.cpuMsIstek = null;
    a.kapasiteRps = null;
  }
  return a;
}
/** Bellek: sunucu camelCase (gorunum.cjs) ya da ham.bellek snake_case; hic olcum yoksa null. */
function bellekNormalle(x: unknown): NlBellek | null {
  const o = nesne(x);
  const b: NlBellek = {
    nginxRssOrtMb: sayiVeya(alan(o, 'nginxRssOrtMb', 'nginx_rss_ort_mb')), nginxRssMaxMb: sayiVeya(alan(o, 'nginxRssMaxMb', 'nginx_rss_max_mb')),
    hedefBellekYuzde: sayiVeya(alan(o, 'hedefBellekYuzde', 'hedef_bellek_yuzde')), hedefBosMinYuzde: sayiVeya(alan(o, 'hedefBosMinYuzde', 'hedef_bos_min_yuzde')),
    yukBellekYuzde: sayiVeya(alan(o, 'yukBellekYuzde', 'yuk_bellek_yuzde')), yukBosMinYuzde: sayiVeya(alan(o, 'yukBosMinYuzde', 'yuk_bos_min_yuzde')),
    aracRssMaxMb: sayiVeya(alan(o, 'aracRssMaxMb', 'arac_rss_max_mb')),
  };
  return Object.values(b).some((v) => v != null) ? b : null;
}
const KIP_DURUMLARI = new Set(['tamam', 'uyari', 'olculmedi']);
const kipDurumu = (x: unknown): NlKipDurumu => (KIP_DURUMLARI.has(x as string) ? (x as NlKipDurumu) : 'olculmedi');
const kipProtokolu = (x: unknown): NlProtokol | null => (x === 'h1' || x === 'h2' ? x : null);
/** Kip dogrulamasi (gorunum.cjs kipDogrulama): alan yoksa null (eski sunucu). */
function kipNormalle(x: unknown): NlKipDogrulama | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const o = nesne(x);
  const p = nesne(o.protokol);
  const b = nesne(o.baglanti);
  const k = nesne(o.sikistirma);
  const dg = nesne(k.dagilim);
  const dagilim: Record<string, number> = {};
  for (const [ad, v] of Object.entries(dg)) { const n = sayiVeya(v); if (n != null) dagilim[ad] = n; }
  return {
    protokol: { istenen: kipProtokolu(p.istenen) ?? 'h1', olculen: kipProtokolu(p.olculen), uyumsuz: sayiVeya(p.uyumsuz), durum: kipDurumu(p.durum) },
    baglanti: { istenen: metinVeya(b.istenen), yeniBaglantiYuzde: sayiVeya(b.yeniBaglantiYuzde), istekBaglanti: sayiVeya(b.istekBaglanti), durum: kipDurumu(b.durum) },
    sikistirma: {
      istenen: metinVeya(k.istenen), n: sayiVeya(k.n), dagilim: k.dagilim && typeof k.dagilim === 'object' ? dagilim : null, yok1kbAlti: sayiVeya(k.yok1kbAlti),
      kucukYuzde: sayiVeya(k.kucukYuzde), istenenYuzde: sayiVeya(k.istenenYuzde), durum: kipDurumu(k.durum),
    },
    uyarilar: metinDizisi(o.uyarilar),
    durum: kipDurumu(o.durum),
  };
}
function reloadAniNormalle(x: unknown): NlReloadAni | null {
  const o = nesne(x);
  const t = sayiVeya(o.t);
  if (t == null) return null;
  return {
    t, tOnce: sayiVeya(alan(o, 'tOnce', 't_once')), tSon: sayiVeya(alan(o, 'tSon', 't_son')) ?? t,
    tur: metinVeya(o.tur), faz: metinVeya(o.faz) ?? 'olcum',
  };
}
function reloadlarNormalle(x: unknown): NlReloadAni[] {
  return (Array.isArray(x) ? x : []).map(reloadAniNormalle).filter((r): r is NlReloadAni => r != null);
}
function reloadOlayiNormalle(x: unknown): NlReloadOlayi | null {
  const a = reloadAniNormalle(x);
  if (!a) return null;
  const o = nesne(x);
  return {
    ...a, kesit: metinVeya(o.kesit) ?? '', workerOnce: sayiVeya(alan(o, 'workerOnce', 'worker_once')), workerSonra: sayiVeya(alan(o, 'workerSonra', 'worker_sonra')),
    kapananEnCok: sayiVeya(alan(o, 'kapananEnCok', 'kapanan_en_cok')) ?? 0, etkilenenTurlar: metinDizisi(alan(o, 'etkilenenTurlar', 'etkilenen_turlar')),
  };
}
/** `sonucOzeti` nesnesi (camel ya da snake); alan yoksa null (ekran adimlardan hesaplar). */
export function sonucOzetiNormalle(x: unknown): NlSonucOzeti | null {
  const o = jsonNesne(x);
  if (!o || !Object.keys(o).length) return null;
  const p95 = (v: unknown) => {
    const n = jsonNesne(v);
    const d = n ? sayiVeya(n.deger) : null;
    return n && d != null ? { deger: d, tur: String(n.tur ?? '') } : null;
  };
  const kapsam = alan(o, 'p95Kapsam', 'p95_kapsam');
  return {
    adimSayisi: sayiVeya(alan(o, 'adimSayisi', 'adim_sayisi')) ?? 0, gecerliAdimSayisi: sayiVeya(alan(o, 'gecerliAdimSayisi', 'gecerli_adim_sayisi')) ?? 0,
    toplamIstek: sayiVeya(alan(o, 'toplamIstek', 'toplam_istek')),
    p95EnIyi: p95(alan(o, 'p95EnIyi', 'p95_en_iyi')), p95EnKotu: p95(alan(o, 'p95EnKotu', 'p95_en_kotu')),
    p95Kapsam: kapsam === 'gecerli' || kapsam === 'tum' ? kapsam : null,
    toplam429: sayiVeya(alan(o, 'toplam429', 'toplam_429')), toplam5xx: sayiVeya(alan(o, 'toplam5xx', 'toplam_5xx')),
    enYuksekHataOrani: sayiVeya(alan(o, 'enYuksekHataOrani', 'en_yuksek_hata_orani')),
    hataVar: mantikVeya(alan(o, 'hataVar', 'hata_var')) === true,
    cpuOlculemeyenAdim: sayiVeya(alan(o, 'cpuOlculemeyenAdim', 'cpu_olculemeyen_adim')) ?? 0,
    yukDoyduAdim: sayiVeya(alan(o, 'yukDoyduAdim', 'yuk_doydu_adim')) ?? 0,
    konfDegisti: mantikVeya(alan(o, 'konfDegisti', 'konf_degisti')),
    reloadlar: (Array.isArray(o.reloadlar) ? o.reloadlar : []).map(reloadOlayiNormalle).filter((r): r is NlReloadOlayi => r != null),
  };
}
/** GET /kosular/:id `durdurIsi` ({ awxServerId, awxJobId }; durdur yanitindaki `jobId` de kabul) -> is numarasi yoksa null. */
function durdurIsiNormalle(x: unknown): NlKosuAyrinti['durdurIsi'] {
  const o = jsonNesne(x);
  const jobId = o ? sayiVeya(alan(o, 'awxJobId', 'jobId', 'awx_job_id')) : null;
  if (!o || jobId == null || jobId <= 0) return null;
  return { awxServerId: sayiVeya(alan(o, 'awxServerId', 'awx_server_id')), awxJobId: jobId };
}
/** alpn_kaynak yalniz 'curl' ya da 'openssl' (birebir); digeri null. */
function alpnKaynakDegeri(v: unknown): 'curl' | 'openssl' | null {
  return v === 'curl' || v === 'openssl' ? v : null;
}
export function onKontrolNormalle(x: unknown): NlOnKontrol | null {
  const ham = jsonNesne(x);
  if (!ham || !Object.keys(ham).length) return null;
  const sik = jsonNesne(alan(ham, 'sikistirma'));
  const hatalar = alan(ham, 'ilkHatalar', 'ilk_hatalar');
  return {
    ipYerel: mantikVeya(alan(ham, 'ipYerel', 'ip_yerel')), serverNameVar: mantikVeya(alan(ham, 'serverNameVar', 'server_name_var')),
    masterSayisi: sayiVeya(alan(ham, 'masterSayisi', 'master_sayisi')), webLogDf: sayiVeya(alan(ham, 'webLogDf', 'web_log_df')),
    logDiziniOkunur: mantikVeya(alan(ham, 'logDiziniOkunur', 'log_dizini_okunur')), logFormatUa: mantikVeya(alan(ham, 'logFormatUa', 'log_format_ua')),
    statikDirektif: mantikVeya(alan(ham, 'statikDirektif', 'statik_direktif')),
    ipYukMakinesinde: mantikVeya(alan(ham, 'ipYukMakinesinde', 'ip_yuk_makinesinde')), serbestAg: metinVeya(alan(ham, 'serbestAg', 'serbest_ag')),
    k6Var: mantikVeya(alan(ham, 'k6Var', 'k6_var')),
    k6Surum: metinVeya(alan(ham, 'k6Surum', 'k6_surum')), k6Sha256: metinVeya(alan(ham, 'k6Sha256', 'k6_sha256')),
    wrkVar: mantikVeya(alan(ham, 'wrkVar', 'wrk_var')), wrkCalisiyor: mantikVeya(alan(ham, 'wrkCalisiyor', 'wrk_calisiyor')),
    wrkSurum: metinVeya(alan(ham, 'wrkSurum', 'wrk_surum')), wrkSha256: metinVeya(alan(ham, 'wrkSha256', 'wrk_sha256')),
    yollarToplam: sayiVeya(alan(ham, 'yollarToplam', 'yollar_toplam')), yollar200: sayiVeya(alan(ham, 'yollar200', 'yollar_200')),
    ilkHatalar: (Array.isArray(hatalar) ? hatalar : []).map((h) => { const o = nesne(h); return { yol: String(o.yol ?? ''), status: String(o.status ?? '') }; }),
    sikistirma: sik ? { statik: sayiVeya(sik.statik), dinamik: sayiVeya(sik.dinamik), sikistirmasiz: sayiVeya(sik.sikistirmasiz) } : null,
    aracDogrulandi: mantikVeya(alan(ham, 'aracDogrulandi', 'arac_dogrulandi')), aracSha256: metinVeya(alan(ham, 'aracSha256', 'arac_sha256')),
    aracGlibc: metinVeya(alan(ham, 'aracGlibc', 'arac_glibc')), aracHata: metinVeya(alan(ham, 'aracHata', 'arac_hata')),
    protokol: protokolDegeri(alan(ham, 'protokol')),
    curlH2: mantikVeya(alan(ham, 'curlH2', 'curl_h2')), alpnH2: mantikVeya(alan(ham, 'alpnH2', 'alpn_h2')),
    yollarYanitli: sayiVeya(alan(ham, 'yollarYanitli', 'yollar_yanitli')), yollarH2: sayiVeya(alan(ham, 'yollarH2', 'yollar_h2')),
    alpnKaynak: alpnKaynakDegeri(alan(ham, 'alpnKaynak', 'alpn_kaynak')),
    yukPortSayisi: sayiVeya(alan(ham, 'yukPortSayisi', 'yukm_port_sayisi')), yukTwReuse: sayiVeya(alan(ham, 'yukTwReuse', 'yukm_tw_reuse')),
    yukTcpTs: sayiVeya(alan(ham, 'yukTcpTs', 'yukm_tcp_ts')), yukNproc: sayiVeya(alan(ham, 'yukNproc', 'yukm_nproc')),
    yukMemKb: sayiVeya(alan(ham, 'yukMemKb', 'yukm_mem_kb')),
  };
}
/** Arac seti satiri (camel ya da snake; eksik alan null, bayrak false). id yoksa null (gecersiz satir listeye girmez). */
export function aracSetiNormalle(x: unknown): NlAracSeti | null {
  const r = nesne(x);
  const id = sayiVeya(alan(r, 'id'));
  if (id == null) return null;
  const m = (...a: string[]) => metinVeya(alan(r, ...a));
  return {
    id, durum: (m('durum') ?? 'FAILED') as NlDurum, derlemeHost: m('derlemeHost', 'derleme_host') ?? '', k6Surum: m('k6Surum', 'k6_surum') ?? '',
    wrkSurum: m('wrkSurum', 'wrk_surum') ?? '', k6Sha256: m('k6Sha256', 'k6_sha256'), wrkSha256: m('wrkSha256', 'wrk_sha256'),
    k6ArsivSha256: m('k6ArsivSha256', 'k6_arsiv_sha256'), wrkKaynakSha256: m('wrkKaynakSha256', 'wrk_kaynak_sha256'),
    ozetlerGuncel: mantikVeya(alan(r, 'ozetlerGuncel', 'ozetler_guncel')) === true, geriCekildi: mantikVeya(alan(r, 'geriCekildi', 'geri_cekildi')) === true,
    geriCeken: m('geriCeken', 'geri_ceken'), geriCekmeAt: m('geriCekmeAt', 'geri_cekme_at'), calismaYasSn: sayiVeya(alan(r, 'calismaYasSn', 'calisma_yas_sn')),
    swDizin: m('swDizin', 'sw_dizin'),
    derlemeRhel: m('derlemeRhel', 'derleme_rhel'), derlemeGlibc: m('derlemeGlibc', 'derleme_glibc'), wrkGlibcGerekli: m('wrkGlibcGerekli', 'wrk_glibc_gerekli'),
    wrkOpenssl: m('wrkOpenssl', 'wrk_openssl'), wrkLuajit: m('wrkLuajit', 'wrk_luajit'), hata: m('hata'),
    awxServerId: sayiVeya(alan(r, 'awxServerId', 'awx_server_id')), awxJobId: sayiVeya(alan(r, 'awxJobId', 'awx_job_id')), awxUrl: m('awxUrl', 'awx_url'),
    createdBy: m('createdBy', 'created_by'), createdAt: m('createdAt', 'created_at'), startedAt: m('startedAt', 'started_at'), finishedAt: m('finishedAt', 'finished_at'),
  };
}
/** Hazirlama isinin ust siniri + pay (sunucu ARAC_IS_SURESI_SN + YOK_PAYI_SN); `ayar.isSuresiSn` gelmezse. */
export const ARAC_IS_SURESI_SN = 2400;
/** GET /araclar: listeler dizi (gecersiz satir atilir), ayar alanlari tipli; derleme listesi bossa varsayilan tek eleman.
 *  `ozetEksikleri` alani gelmezse (eski sunucu) bos; `kapi` gelmezse kod / mesaj null. */
export function araclarNormalle(x: unknown): NlAraclar {
  const r = nesne(x);
  const a = nesne(r.ayar);
  const kapi = nesne(r.kapi);
  const isSuresi = sayiVeya(alan(a, 'isSuresiSn', 'is_suresi_sn'));
  const hostlar = metinDizisi(alan(a, 'derlemeHostlari', 'derleme_hostlari'));
  const varsayilan = metinVeya(alan(a, 'varsayilanDerlemeHost', 'varsayilan_derleme_host')) ?? hostlar[0] ?? '';
  return {
    ok: true, etkin: aracSetiNormalle(r.etkin), calisan: aracSetiNormalle(r.calisan),
    gecmis: (Array.isArray(r.gecmis) ? r.gecmis : []).map(aracSetiNormalle).filter((s): s is NlAracSeti => s != null),
    ayar: {
      derlemeHostlari: hostlar.length ? hostlar : varsayilan ? [varsayilan] : [], varsayilanDerlemeHost: varsayilan,
      k6Surum: metinVeya(alan(a, 'k6Surum', 'k6_surum')) ?? '', wrkSurum: metinVeya(alan(a, 'wrkSurum', 'wrk_surum')) ?? '4.2.0',
      proxyTanimli: mantikVeya(alan(a, 'proxyTanimli', 'proxy_tanimli')) === true, proxy: metinVeya(alan(a, 'proxy')),
      proxyHatasi: metinVeya(alan(a, 'proxyHatasi', 'proxy_hatasi')),
      k6ArsivSha256: metinVeya(alan(a, 'k6ArsivSha256', 'k6_arsiv_sha256')), wrkKaynakSha256: metinVeya(alan(a, 'wrkKaynakSha256', 'wrk_kaynak_sha256')),
      ozetEksikleri: metinDizisi(alan(a, 'ozetEksikleri', 'ozet_eksikleri')), isSuresiSn: isSuresi != null && isSuresi > 0 ? isSuresi : ARAC_IS_SURESI_SN,
    },
    kapi: { kod: metinVeya(kapi.kod), mesaj: metinVeya(kapi.mesaj) },
  };
}
/** /hedefler `araclar` alani yoksa (eski sunucu) fail-closed: hazir degil, on kontrol kapali. */
export const ARAC_DURUMU_YOK: Readonly<NlAracDurumu> = Object.freeze({ hazir: false, aracId: null, k6Surum: null, wrkSurum: null, kod: 'bilinmiyor', mesaj: 'Sunucu araç durumunu bildirmedi.' });
/** `hazir` YALNIZ boolean true ise true ('true' metni, 1 ... hazir DEGIL). */
function aracDurumuNormalle(x: unknown): NlAracDurumu {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return { ...ARAC_DURUMU_YOK };
  const r = x as Ham;
  return {
    hazir: r.hazir === true, aracId: sayiVeya(alan(r, 'aracId', 'arac_id')), k6Surum: metinVeya(alan(r, 'k6Surum', 'k6_surum')),
    wrkSurum: metinVeya(alan(r, 'wrkSurum', 'wrk_surum')), kod: metinVeya(r.kod), mesaj: metinVeya(r.mesaj),
  };
}
function kosuAracSetiNormalle(x: unknown): NlKosuAracSeti | null {
  const s = aracSetiNormalle(jsonNesne(x));
  return s ? { id: s.id, k6Surum: s.k6Surum, wrkSurum: s.wrkSurum, k6Sha256: s.k6Sha256, wrkSha256: s.wrkSha256, derlemeHost: s.derlemeHost } : null;
}
const hedefTuruVeya = (x: unknown): NlHedefTuru => (x === 'serbest' ? 'serbest' : 'sunucu');
const motorVeya = (...xs: unknown[]): NlMotor => (xs.find((x) => x === 'k6' || x === 'wrk') as NlMotor | undefined) ?? 'k6';
/** 'h1' | 'h2' ya da null (bilinmeyen deger protokol SAYILMAZ). */
const protokolDegeri = (x: unknown): NlProtokol | null => (x === 'h1' || x === 'h2' ? x : null);
/** Ilk gecerli protokol; hicbiri yoksa h1 (eski kayit). */
export const protokolVeya = (...xs: unknown[]): NlProtokol => (xs.map(protokolDegeri).find((x) => x != null) ?? 'h1');
/**
 * Liste satiri (GET /kosular): tur ve motor kosu satirindan; eski satirda yok -> sunucu / k6. Serbest satirda
 * `hedefHost` bos metin gelebilir (DB `''`): null'a cevrilir (etiket `hedefHost ?? hedefIp` bos kalmasin).
 */
export function kosuSatiriNormalle(x: unknown): NlKosu {
  const r = nesne(x);
  const p = jsonNesne(alan(r, 'parametreler'));
  return {
    ...(r as unknown as NlKosu),
    hedefHost: metinVeya(alan(r, 'hedefHost', 'hedef_host')),
    hedefTuru: hedefTuruVeya(alan(r, 'hedefTuru', 'hedef_turu')),
    motor: motorVeya(alan(r, 'motor'), p?.motor),
    protokol: protokolVeya(alan(r, 'protokol'), p?.protokol),
  };
}
export function kosuNormalle(x: unknown): NlKosuAyrinti {
  const r = nesne(x);
  const p = jsonNesne(alan(r, 'parametreler'));
  // sonuc = maskeli set_stats + portal_analiz { ozet, uyarilar } (poller) ya da { hata } (okunamadi).
  const sonuc = jsonNesne(alan(r, 'sonucOzet'));
  const pa = sonuc ? jsonNesne(sonuc.portal_analiz) : null;
  const oz = pa ? jsonNesne(pa.ozet) : null;
  return {
    ...kosuSatiriNormalle(r),
    id: Number(r.id), awxJobId: sayiVeya(alan(r, 'awxJobId', 'awx_job_id')),
    serbestAg: metinVeya(alan(r, 'serbestAg', 'serbest_ag')),
    planUyarilari: metinDizisi(alan(r, 'planUyarilari', 'plan_uyarilari')),
    // Eski (motor'suz) parametre nesnesi k6'dir: ekran motorOf ile okur, nesne oldugu gibi kalir.
    parametreler: p ? (p as unknown as NlKosuAyrinti['parametreler']) : null,
    onKontrol: onKontrolNormalle(alan(r, 'onKontrol', 'on_kontrol_ozet')),
    gecersizNedenleri: metinDizisi(alan(r, 'gecersizNedenleri', 'gecersiz_nedenleri')),
    sonucOzet: sonuc,
    onKontrolKosuId: sayiVeya(alan(r, 'onKontrolKosuId', 'on_kontrol_kosu_id')),
    sunucuDegerlendirmesi: Array.isArray(r.onKontrolEngelleri) || Array.isArray(r.onKontrolUyarilari)
      ? { engeller: metinDizisi(r.onKontrolEngelleri), uyarilar: metinDizisi(r.onKontrolUyarilari) } : null,
    onKontrolYasSn: sayiVeya(r.onKontrolYasSn),
    isDurumu: metinVeya(sonuc?.durum), isHatasi: metinVeya(sonuc?.hata),
    analiz: {
      nproc: sayiVeya(oz?.nproc ?? sonuc?.nproc), cpuTlsliPay: sayiVeya(oz?.cpu_tlsli_pay ?? sonuc?.cpu_tlsli_pay),
      uyarilar: metinDizisi(pa?.uyarilar ?? sonuc?.uyarilar), okumaHatasi: metinVeya(pa?.hata),
    },
    durdurIsi: durdurIsiNormalle(alan(r, 'durdurIsi')),
    sonuclandirmaDenemesi: sayiVeya(alan(r, 'sonuclandirmaDenemesi', 'sonuclandirma_denemesi')) ?? 0,
    aracId: sayiVeya(alan(r, 'aracId', 'arac_id')),
    aracSeti: kosuAracSetiNormalle(alan(r, 'aracSeti', 'arac_seti')),
    sonucOzeti: sonucOzetiNormalle(alan(r, 'sonucOzeti', 'sonuc_ozeti')),
  };
}
const sayiDizisi = (x: unknown): number[] | null => (Array.isArray(x) && x.length && x.every((v) => Number.isInteger(v)) ? (x as number[]) : null);
/** Tur 3 oncesi sunucu wrk / serbest alanlarini vermez: eksik sinir sozlesme sabitinden, eksik varsayilan sozlesme
 *  degerinden; `motorlar` yoksa yalniz k6 (o sunucu wrk'yi kabul etmez), `serbest` yoksa kapali. */
export function hedeflerNormalle(x: unknown): NlHedefler {
  const r = nesne(x);
  const s = nesne(r.sinirlar);
  const sinirlar = { ...s } as unknown as NlSinirlar;
  for (const [k, v] of Object.entries(EK_SINIRLAR)) if (sayiVeya(s[k]) == null) (sinirlar as unknown as Record<string, number>)[k] = v;
  const v = nesne(r.varsayilan);
  const sv = nesne(v.serbest);
  const serbest = nesne(r.serbest);
  const motorlar = (Array.isArray(r.motorlar) ? r.motorlar : []).filter((m): m is NlMotor => m === 'k6' || m === 'wrk');
  const protokoller = (Array.isArray(r.protokoller) ? r.protokoller : []).filter((m): m is NlProtokol => m === 'h1' || m === 'h2');
  return {
    ...(r as unknown as NlHedefler),
    hedefler: Array.isArray(r.hedefler) ? (r.hedefler as NlHedef[]) : [],
    yukHostlari: Array.isArray(r.yukHostlari) ? (r.yukHostlari as NlYukHost[]) : [],
    sinirlar,
    varsayilan: {
      ...(v as unknown as NlVarsayilanlar),
      motor: motorVeya(v.motor),
      protokol: protokolVeya(v.protokol),
      baglantilar: sayiDizisi(v.baglantilar) ?? [2, 4, 8],
      is_parcacigi: sayiVeya(v.is_parcacigi) ?? 2,
      serbest: { hizlar: sayiDizisi(sv.hizlar) ?? [50, 100, 200], maxvu: sayiVeya(sv.maxvu) ?? 50 },
    },
    serbest: { acik: serbest.acik === true, aglar: metinDizisi(serbest.aglar) },
    motorlar: motorlar.length ? [...new Set(motorlar)] : ['k6'],
    // h1 her sunucuda gecerlidir (alani olmayan eski sunucu yalniz h1 konusur).
    protokoller: [...new Set<NlProtokol>(['h1', ...protokoller])],
    araclar: aracDurumuNormalle(r.araclar),
  };
}
/** /ip-sinifi 200 govdesi: listeler dizi, sinirlar sayi ya da null; tur bilinmiyorsa RET (fail-closed). */
function ipSinifiNormalle(x: Ham): NlIpSinifi | NlIpSinifiRet {
  const ip = String(x.ip ?? '');
  if (x.tur === 'serbest') {
    const diger = (Array.isArray(x.digerSahipler) ? x.digerSahipler : []).map((d) => { const o = nesne(d); return { host: String(o.host ?? ''), env: metinVeya(o.env) }; });
    return { ok: true, tur: 'serbest', ip, host: null, ag: String(x.ag ?? ''), digerSahipler: diger.filter((d) => d.host) };
  }
  if (x.tur === 'sunucu' && typeof x.host === 'string' && x.host) {
    return {
      ok: true, tur: 'sunucu', ip, host: x.host, env: metinVeya(x.env), vhostlar: metinDizisi(x.vhostlar), vhostVerisi: x.vhostVerisi === true,
      hizSiniri: sayiVeya(x.hizSiniri), vuSiniri: sayiVeya(x.vuSiniri), limitReq: sayiVeya(x.limitReq), limitConn: sayiVeya(x.limitConn), uygun: x.uygun === true, neden: metinVeya(x.neden), kod: metinVeya(x.kod),
      kaynaklar: metinDizisi(x.kaynaklar),
    };
  }
  return { ok: false, code: 'beklenmeyen', message: 'Sunucu IP’nin sınıfını bildirmedi; yeniden deneyin.' };
}
function karsilastirmaNormalle(x: NlKarsilastirma & { tablo?: unknown[] }): NlKarsilastirma {
  const sayilar = (o: unknown) => Object.fromEntries(Object.entries(nesne(o)).map(([k, v]) => [k, sayiVeya(v)]));
  // Taraf protokolu yalniz 'h1' / 'h2' ise tasinir (eski sunucu vermez: ekran kosu satirindan okur).
  const tarafNormalle = (t: NlKarsilastirmaTarafi): NlKarsilastirmaTarafi => {
    const o = { ...nesne(t) } as Ham;
    const pr = protokolDegeri(o.protokol);
    delete o.protokol;
    return (pr ? { ...o, protokol: pr } : o) as unknown as NlKarsilastirmaTarafi;
  };
  return {
    ...x, ref: tarafNormalle(x.ref), aday: tarafNormalle(x.aday), nedenler: metinDizisi(x.nedenler),
    tablo: (Array.isArray(x.tablo) ? x.tablo : []).map((t) => {
      const r = nesne(t);
      const taraf = (o: unknown) => (o && typeof o === 'object' && !Array.isArray(o) ? (o as Ham) : null);
      return { hiz: sayiVeya(r.hiz), ref: taraf(r.ref), aday: taraf(r.aday), farkYuzde: sayilar(alan(r, 'farkYuzde', 'fark_yuzde')) };
    }),
  };
}

export const nginxLoadtestApi = {
  hedefler: async (): Promise<NlHedefler> => hedeflerNormalle(await okJson<unknown>(await fetch(`${BASE}/hedefler`))),
  senaryolar: (): Promise<{ ok: true; senaryolar: NlSenaryo[] }> => fetch(`${BASE}/senaryolar`).then((r) => okJson(r)),
  senaryo: (id: number): Promise<{ ok: true; senaryo: NlSenaryoAyrinti }> => fetch(`${BASE}/senaryolar/${id}`).then((r) => okJson(r)),
  senaryoKaydet: (body: NlYeniSenaryo): Promise<NlEylem> => fetch(`${BASE}/senaryolar`, json(body)).then(safeJson),
  senaryoSil: (id: number): Promise<NlEylem> => fetch(`${BASE}/senaryolar/${id}`, { method: 'DELETE' }).then(safeJson),
  /** `hedefHost` null: yazilan IP sunucuda siniflanir (sunucu ya da serbest); host secildiyse o host (paylasilan VIP). */
  onKontrol: (body: {
    senaryoId: number; hedefHost: string | null; hedefIp: string; vhost: string; yukHost: string; sni: boolean; parametreler: NlParametreler; etiket?: string;
  }): Promise<NlEylem> => fetch(`${BASE}/kosular/on-kontrol`, json(body)).then(safeJson),
  baslat: (body: { onKontrolKosuId: number; confirmText: string; uyariOnay: boolean }): Promise<NlEylem> => fetch(`${BASE}/kosular`, json(body)).then(safeJson),
  /**
   * Admin, salt okunur (DB'ye ve denetime yazmaz): yazilan IP'nin sinifi. `hedefHost` host secicinin yolu (paylasilan
   * VIP'te o host kabul edilir; verilmezse IP birden cok nginx sunucusundaysa 409 ip_belirsiz). `yukHost` verilirse
   * IP'nin yuk sunucusunun kendisi olmadigi da denetlenir. Kesin karar yine on kontrol / kosu kapisinda.
   */
  ipSinifi: async (ip: string, o: { yukHost?: string | null; hedefHost?: string | null } = {}): Promise<NlIpSinifi | NlIpSinifiRet> => {
    const q = new URLSearchParams({ ip });
    if (o.yukHost) q.set('yukHost', o.yukHost);
    if (o.hedefHost) q.set('hedefHost', o.hedefHost);
    const r = await safeJson(await fetch(`${BASE}/ip-sinifi?${q}`));
    return r && typeof r === 'object' && r.ok === true ? ipSinifiNormalle(r as Ham) : (r as NlIpSinifiRet);
  },
  /** Liste (id azalan). `dahaVar`: bu sayfadan daha eski kayit var (`onceki` = sayfadaki en kucuk id ile devam). */
  kosular: async (o: NlKosuSuzgeci = {}): Promise<{ ok: true; kosular: NlKosu[]; dahaVar: boolean }> => {
    const q = new URLSearchParams();
    if (o.islem) q.set('islem', o.islem);
    if (o.durum) q.set('durum', o.durum);
    if (o.hedef) q.set('hedef', o.hedef);
    if (o.ip) q.set('ip', o.ip);
    if (o.hedefTuru) q.set('hedefTuru', o.hedefTuru);
    if (o.motor) q.set('motor', o.motor);
    if (o.onceki != null) q.set('onceki', String(o.onceki));
    if (o.limit) q.set('limit', String(o.limit));
    const s = q.toString();
    const r = await okJson<{ ok: true; kosular?: unknown[]; dahaVar?: unknown }>(await fetch(`${BASE}/kosular${s ? `?${s}` : ''}`));
    return { ...r, kosular: Array.isArray(r.kosular) ? r.kosular.map(kosuSatiriNormalle) : [], dahaVar: r.dahaVar === true };
  },
  kosu: async (id: number): Promise<{ ok: true; kosu: NlKosuAyrinti; adimlar: NlAdim[] }> => {
    const r = await okJson<{ ok: true; kosu: unknown; adimlar?: unknown[] }>(await fetch(`${BASE}/kosular/${id}`));
    return { ok: true, kosu: kosuNormalle(r.kosu), adimlar: (Array.isArray(r.adimlar) ? r.adimlar : []).map(adimNormalle) };
  },
  /** Admin. `since`: istemcide olan cikti uzunlugu (artimli okuma); ekran gelen metni `ciktiBirlestir` ile ekler. */
  durum: (id: number, since: number, signal?: AbortSignal): Promise<NlDurumYaniti | NlRet> =>
    fetch(`${BASE}/kosular/${id}/durum?since=${Math.max(0, Math.floor(since))}`, { signal }).then(safeJson),
  /** Admin. 409 `baslatiliyor` (koşu henuz AWX isini almadi), 424 `durdur_baslatilamadi` (kosu: durdur isi baslamadi). */
  durdur: (id: number): Promise<NlEylem> => fetch(`${BASE}/kosular/${id}/durdur`, json({})).then(safeJson),
  /** Admin. Sonucu okunamamis kosuyu yeniden FINALIZING'e alir (poller okur); 409 `yeniden_okunamaz`. */
  yenidenOku: (id: number): Promise<NlEylem> => fetch(`${BASE}/kosular/${id}/yeniden-oku`, json({})).then(safeJson),
  karsilastir: async (o: { ref: number; aday: number; esikCpu?: number; esikP95?: number }): Promise<NlKarsilastirma> => {
    const q = new URLSearchParams({ ref: String(o.ref), aday: String(o.aday) });
    if (o.esikCpu != null) q.set('esikCpu', String(o.esikCpu));
    if (o.esikP95 != null) q.set('esikP95', String(o.esikP95));
    return karsilastirmaNormalle(await okJson<NlKarsilastirma>(await fetch(`${BASE}/karsilastir?${q}`)));
  },
  /** Arac setleri (okuma Admin disina acik; `ayar.proxy` yalniz Admin'e dolu). */
  araclar: async (): Promise<NlAraclar> => araclarNormalle(await okJson<unknown>(await fetch(`${BASE}/araclar`))),
  /** Admin. 409 derleme_host_izinsiz / arac_proxy_gecersiz / arac_ozet_sabit_yok / kilit_dolu / sinir_asildi; 424 db_okunamadi. */
  araclariHazirla: (body: { derlemeHost: string }): Promise<NlEylem> => fetch(`${BASE}/araclar`, json(body)).then(safeJson),
  /** Admin. DONE bir seti geri ceker; 409 arac_yok / arac_geri_cekilemez / zaten_geri_cekildi; 424 db_okunamadi. */
  aracGeriCek: (id: number): Promise<NlEylem> => fetch(`${BASE}/araclar/${id}/geri-cek`, json({})).then(safeJson),
};
