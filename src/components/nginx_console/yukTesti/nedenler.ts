// src/components/nginx_console/yukTesti/nedenler.ts — analiz neden / uyari kodlari -> duz Turkce cumle (2026-11-02).
//
// Kullanici geri bildirimi (R2, AWX 3474239): ekran "konf_degisti", "reload(worker_pid_degisti)", "doyma:dropped=63" gibi
// ham kodlar gosteriyordu. Her kod burada tek cumleye cevrilir; ham kod ekranda kucuk ve ikincil kalir (destek icin).
// Kod listesi server/nginx-loadtest/analiz.cjs'ten (NEDENLER onekleri, kosuHesapla gecersiz / uyari, kosuAnaliz kosu
// uyarilari) ve cpu_kaydedici.sh'in bilgi_*.txt gecersiz= / uyari= satirlarindan; testte her kod icin cumle kilitli.
// Bilinmeyen kod `bilinmiyor: true` ile oldugu gibi doner (ekran "kod" diye yazar; sessizce yutulmaz).
// HTTP/2 (2026-11-02, h2_sozlesme.md 5.2): h2_disi(N), protokol_farkli(beklenen=..,olculen=..) nedenleri ve h2 kosu uyarisi
// (bilgi); `http2` cumlesi DEGISMEZ (yalniz HTTP/1.1 kosusunda uretilir). Reload fazi `olcum_kenari`: olcume degdi ama
// CPU penceresinin disinda (olcum etkilenmedi).
// 2026-11-03: bellek uyarilari (bellek_bos_az, nginx_bellek_artisi; bilgi) ve kip dogrulamasi kodlari (gorunum.cjs
// KIP_KALIPLARI: kip_protokol, kip_ka_yeni_baglanti, kip_sikistirma_az, kip_sikistirma_beklenmeyen).
// 2026-11-13 (TEK HEDEF MODELI): nginx olmayan hedefin kosu uyarilari (nginx_yok(...), hedef_cpu_kaydi_yok / _bozuk,
// nginxsiz_kosuda_sunucu_dosyalari_yok_sayildi(n)) ve adim uyarisi hedef_cpu_olculemedi; karar satiri CPU-ms olculmedi (...).
import type { NlReloadAni } from '@/api/nginxLoadtestApi';
import { fmtNumber, fmtTimeSeconds } from '@/utils/datetime';

export type NedenTonu = 'hata' | 'uyari' | 'bilgi';
export interface NedenAciklamasi { cumle: string; kod: string; ton: NedenTonu; bilinmiyor?: boolean }

/** "12001" -> "12.001", "12.5" -> "12,5" (tr-TR); sayi degilse oldugu gibi. */
const sayiTr = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? fmtNumber(n) : s;
};
const ondalikTr = sayiTr;
type Kural = { re: RegExp; ton: NedenTonu; cumle: (m: RegExpExecArray) => string };
const PROTOKOL_ADI: Record<string, string> = { h1: 'HTTP/1.1', h2: 'HTTP/2', yok: 'bilinmiyor' };
/** analiz.cjs H2_UYARISI ('h2_vu_basina_tek_akis(tarayici_coklamasi_olculmez)'): HTTP/2 kosusunun olcum modeli (bilgi). */
export const H2_UYARI_KODU_RE = /^h2_vu_basina_tek_akis\(.*\)$/;
export const H2_UYARI_CUMLESI = 'HTTP/2 koşusu: k6 her sanal kullanıcıda tek bağlantı açar ve istekleri sırayla gönderir; tarayıcıdaki gibi tek bağlantıda çok sayıda eş zamanlı akış ölçülmez. Yalnız HTTP/2 koşularıyla karşılaştırın.';

/** Adim gecersizlik / doyma / hatali nedenleri (adim.nedenler; kosu gecersizNedenleri'nin icindekiler). */
const NEDEN_KURALLARI: Kural[] = [
  { re: /^reload\(worker_pid_degisti\)$/, ton: 'hata', cumle: () => 'Test sırasında nginx yeniden yüklendi (reload): worker süreçleri değişti; bu adımın CPU ölçümü ve sonuçları güvenilir değil.' },
  { re: /^sunucu_ayari_kanitsiz\(([a-z0-9_,]+)\)$/, ton: 'hata', cumle: (m) => (m[1] === 'yok'
    ? 'Koşu öncesi sunucu ayarı istendi ama hazırlık kanıtı yok: ayar uygulanmamış olabilir (Ansible deposu eski olabilir); bu koşunun ölçümü geçerli sayılmaz.'
    : `Hazırlık kanıtı istenen sunucu ayarıyla uyuşmuyor (${m[1].split(',').join(', ')}); bu koşunun ölçümü geçerli sayılmaz.`) },
  { re: /^konf_degisti$/, ton: 'hata', cumle: () => 'Test sırasında nginx konfigürasyonu değişti; bu adımın sonuçları güvenilir değil (değişikliğin anı bilinmez: kaydedici konfigürasyonu yalnız başta ve sonda karşılaştırır). Deney süresince o sunucuya konfigürasyon dağıtılmamalı.' },
  { re: /^(k6|wrk)_rc=(.+)$/, ton: 'hata', cumle: (m) => `${m[1]} hata koduyla (${m[2]}) bitti; bu adımın ölçümü tamamlanmadı.` },
  { re: /^429\(istemci=(\d+)(?:,sunucu=(\d+))?\)$/, ton: 'hata', cumle: (m) => `Hedef ${sayiTr(m[1])} isteği 429 ile reddetti (hız sınırı: limit_req / limit_conn${m[2] != null ? `; sunucu logunda ${sayiTr(m[2])}` : ''}); ölçüm sınıra takıldı, hızı düşürün.` },
  { re: /^5xx\(istemci=(\d+)(?:,sunucu=(\d+))?\)$/, ton: 'hata', cumle: (m) => `Sunucu ${sayiTr(m[1])} isteğe 5xx hata yanıtı verdi${m[2] != null ? ` (sunucu logunda ${sayiTr(m[2])})` : ''}; nedenini error.log’da arayın.` },
  { re: /^http2$/, ton: 'hata', cumle: () => 'İstekler HTTP/2 ile gitti; ölçüm HTTP/1.1 için kurulu olduğundan bu adım karşılaştırılamaz.' },
  { re: /^h2_disi\((\d+)\)$/, ton: 'hata', cumle: (m) => `HTTP/2 koşusunda ${sayiTr(m[1])} yanıt HTTP/2 dışında geldi; bu adım HTTP/2 ölçümü sayılmaz.` },
  { re: /^protokol_farkli\(beklenen=(h1|h2),olculen=(h1|h2|yok)\)$/, ton: 'hata', cumle: (m) => `Yük aracı istenen protokolü kullanmadı (beklenen ${PROTOKOL_ADI[m[1]]}, ölçülen ${PROTOKOL_ADI[m[2]]}); Ansible deposu eski olabilir.` },
  { re: /^hata_%([\d.]+)\(>%([\d.]+)\)$/, ton: 'hata', cumle: (m) => `İsteklerin %${ondalikTr(m[1])}’i başarısız oldu (404, zaman aşımı …; eşik %${ondalikTr(m[2])}); senaryodaki yollar hâlâ 200 dönüyor mu bakın.` },
  { re: /^log_istemci_farki_%([\d.]+)$/, ton: 'hata', cumle: (m) => `Sunucu logundaki istek sayısı yük aracının gönderdiğinden %${ondalikTr(m[1])} farklı; isteklerin bir kısmı başka sunucuya gitmiş olabilir.` },
  { re: /^kayit:log_dondu:(.+)$/, ton: 'hata', cumle: (m) => `Ölçüm sırasında nginx logu döndürüldü ya da küçüldü (rotate: ${m[1]}); sunucu tarafı sayımlar eksik.` },
  { re: /^kayit:(.+)$/, ton: 'hata', cumle: (m) => `CPU kaydedicisi bu adımı geçersiz saydı (${m[1]}).` },
  { re: /^disk_%(\d+)$/, ton: 'hata', cumle: (m) => `/web_log diski %${m[1]} dolu (≥ %65); disk temizliği logları silebileceği için ölçüm güvenilir değil.` },
  { re: /^pencere_kisa\(([\d.]+)s\)$/, ton: 'hata', cumle: (m) => `CPU kaydedicisi ölçümün yalnız ${ondalikTr(m[1])} saniyesini gördü (en az 30 sn gerekir); kaydedici geç başlamış ya da erken durmuş.` },
  { re: /^hatali_kosu\(.*\)$/, ton: 'hata', cumle: () => 'Yük betiği bu adımı yarıda durdurdu (429, 5xx, soket hatası, yüksek hata oranı ya da beklenmeyen protokol).' },
  { re: /^tamamlanmadi\(.*\)$/, ton: 'hata', cumle: () => 'Adım başladı ama sonucu yazılmadı (koşu kesildi ya da durduruldu).' },
  { re: /^istemci_sonucu_yok$/, ton: 'hata', cumle: () => 'Hiçbir adımın sonucu yazılmadı; koşu ölçüm yapamadı.' },
  { re: /^doyma:dropped=(\d+)$/, ton: 'uyari', cumle: (m) => `Yük aracı istenen hızı tutturamadı: ${sayiTr(m[1])} istek zamanında gönderilemedi (dropped); bu adımın kapasite tahmini kullanılmaz.` },
  { re: /^doyma:host_cpu_%([\d.]+)\(>%90\)$/, ton: 'uyari', cumle: (m) => `Hedefin CPU’su bu adımda ortalama %${ondalikTr(m[1])} (> %90); sunucu doydu, kapasite tahmini kullanılmaz.` },
  { re: /^doyma:yuk_cpu_bosta_%([\d.]+)\(<%20\)$/, ton: 'uyari', cumle: (m) => `Yük makinesi doydu (boşta CPU %${ondalikTr(m[1])}): sonuç hedefin değil yük makinesinin sınırını gösterebilir.` },
];

/** Adim ve kosu uyarilari (gecerliligi dusurmez, olcumu sorgulatir): ham.uyarilar ve analiz.uyarilar. */
const UYARI_KURALLARI: Kural[] = [
  { re: /^dropped_iterations=(\d+)$/, ton: 'uyari', cumle: (m) => `${sayiTr(m[1])} istek zamanında gönderilemedi (dropped): yük aracı ya da hedef istenen hıza yetişemedi.` },
  { re: /^saat_farki~(-?[\d.]+)s\(sunucu-istemci\)$/, ton: 'bilgi', cumle: (m) => `Sunucu ile yük sunucusunun saati yaklaşık ${ondalikTr(m[1])} sn farklı; ölçüm penceresi logdan kuruldu.` },
  { re: /^log_satiri_yok:pencere_istemci_saatinden$/, ton: 'uyari', cumle: () => 'Sunucu logunda bu adımın satırı bulunamadı; ölçüm penceresi yük sunucusunun saatinden kuruldu, sunucu istek sayısı ölçülmedi.' },
  { re: /^sunucu_logunda_bu_tur_yok$/, ton: 'uyari', cumle: () => 'Sunucu logunda bu adıma ait hiç satır yok; istekler başka bir sunucuya gitmiş ya da log_format test isteklerini ayıramıyor olabilir.' },
  { re: /^yeni_kipinde_baglanti_yeniden_kullanilmis_%(\d+)$/, ton: 'uyari', cumle: (m) => `“Yeni bağlantı” kipinde isteklerin %${m[1]}’i açık bir bağlantıyı yeniden kullandı; TLS maliyeti eksik ölçülmüş olabilir.` },
  { re: /^sunucu_kaydi_yok\(cpu_olculmedi\)$/, ton: 'uyari', cumle: () => 'Hedef sunucunun CPU kaydı yok; CPU ve kapasite ölçülmedi.' },
  { re: /^sunucu_kaydi_yok$/, ton: 'uyari', cumle: () => 'Bu adımın zaman aralığında CPU kaydı yok; CPU ve kapasite ölçülmedi.' },
  { re: /^pencerede_ornek_yok$/, ton: 'uyari', cumle: () => 'Ölçüm penceresinde CPU örneği yok; CPU ve kapasite ölçülmedi.' },
  { re: /^arka_plan_yok\(0_kabul\)$/, ton: 'uyari', cumle: () => 'Arka plan CPU’su ölçülemedi (sıfır kabul edildi); CPU / istek değeri olduğundan yüksek çıkabilir.' },
  { re: /^arka_plan_yok:(.+?)\(.*\)$/, ton: 'uyari', cumle: (m) => `Kayıt ${m[1]}: yük olmayan boş bir aralık bulunamadı; arka plan CPU’su ölçülemedi.` },
  { re: /^arka_plan_az\((\d+)s\)$/, ton: 'uyari', cumle: (m) => `Arka plan CPU’su yalnız ${m[1]} sn ölçüldü (30 sn önerilir); adımlar arası beklemeyi artırın.` },
  { re: /^diger_trafik_%(\d+)$/, ton: 'uyari', cumle: (m) => `Ölçüm sırasında hedefe başka trafik de geldi (test isteklerinin %${m[1]}’i kadar); CPU ölçümüne karışmış olabilir.` },
  { re: /^perf_ek_yuku\(.*\)$/, ton: 'bilgi', cumle: () => 'perf ölçümü açık; ek yük nedeniyle bu adım karara katılmaz.' },
  { re: /^kayit:([^:]+):konf_degisti\(kayit_sirasinda\):([0-9a-f]+)->([0-9a-f]+)$/, ton: 'hata', cumle: (m) => `Kayıt sırasında hedefin nginx konfigürasyonu değişti (özet ${m[2].slice(0, 8)} → ${m[3].slice(0, 8)}); o sırada koşan adımlar geçersiz sayılır.` },
  { re: /^kayit:([^:]+):disk_%(\d+):.*$/, ton: 'uyari', cumle: (m) => `Hedefte /web_log %${m[2]} dolu; disk temizliği logları silebilir.` },
  { re: /^kayit:([^:]+):konf_okunamadi:.*$/, ton: 'uyari', cumle: () => 'CPU kaydedicisi nginx konfigürasyonunu okuyamadı; konfigürasyon değişikliği fark edilemez.' },
  { re: /^kayit:([^:]+):okunabilir_log_yok:.*$/, ton: 'uyari', cumle: () => 'CPU kaydedicisi okunabilir bir nginx logu bulamadı; sunucu tarafı istek sayımı yapılmadı.' },
  { re: /^kayit:([^:]+):test_satiri_yok.*$/, ton: 'uyari', cumle: () => 'Sunucu logunda hiç test isteği görülmedi; yanlış sunucu, yanlış log dizini ya da log_format user-agent yazmıyor olabilir.' },
  { re: /^kayit:([^:]+):(.+)$/, ton: 'uyari', cumle: (m) => `CPU kaydedicisi uyarısı (${m[1]}): ${m[2]}` },
  { re: /^kesit_baska_adimin:(.+)$/, ton: 'uyari', cumle: (m) => `Sonuç dizininde başka bir koşunun kaydı var (${m[1]}); yok sayıldı.` },
  { re: /^baska_adim_atlandi:(.+)$/, ton: 'bilgi', cumle: (m) => `Başka bir koşunun adımı (${m[1]}) bu koşuya katılmadı.` },
  { re: /^serbest_kosuda_sunucu_dosyalari_yok_sayildi\((\d+)\)$/, ton: 'bilgi', cumle: (m) => `Serbest hedefte sunucu ölçümü yok; dizindeki ${m[1]} sunucu dosyası yok sayıldı.` },
  { re: /^sunucu_olcumu_yok\(serbest_hedef\)$/, ton: 'bilgi', cumle: () => 'Serbest hedef: CPU ve sunucu logu ölçülmez; sonuçlar yalnız yük aracının ölçümüdür.' },
  // 2026-11-13 nginx olmayan hedef (analiz.cjs NGINX_YOK_UYARISI, HEDEF_CPU_KAYDI_YOK / _BOZUK, hedef_cpu_olculemedi).
  { re: /^nginx_yok\(istek_basina_cpu_ve_kapasite_yok\)$/, ton: 'bilgi', cumle: () => 'Hedefte nginx yok: istek başına CPU (CPU-ms) ve kapasite hesaplanmaz; hedefin genel CPU’su ölçülür, %90 üstü doyma sayılır.' },
  { re: /^hedef_cpu_kaydi_yok$/, ton: 'uyari', cumle: () => 'Hedefin genel CPU kaydı (hedefcpu_) bulunamadı; hedef CPU’su ölçülmedi.' },
  { re: /^hedef_cpu_kaydi_bozuk$/, ton: 'uyari', cumle: () => 'Hedefin genel CPU kaydı okunamadı (bozuk ya da boş); hedef CPU’su ölçülmedi.' },
  { re: /^hedef_cpu_olculemedi$/, ton: 'uyari', cumle: () => 'Bu adımın ölçüm penceresinde hedefin genel CPU örneği yok; hedefin doyup doymadığı denetlenemedi.' },
  { re: /^nginxsiz_kosuda_sunucu_dosyalari_yok_sayildi\((\d+)\)$/, ton: 'bilgi', cumle: (m) => `Nginx olmayan hedefte nginx ölçümü yok; dizindeki ${m[1]} sunucu dosyası yok sayıldı.` },
  { re: /^sunucu_logu_yok\(.*\)$/, ton: 'uyari', cumle: () => 'Hedefin nginx logu okunamadı; sunucu ile yük aracının istek sayıları karşılaştırılmadı.' },
  { re: /^h2_vu_basina_tek_akis\(.*\)$/, ton: 'bilgi', cumle: () => H2_UYARI_CUMLESI },
  { re: /^wrk_tls_payi_hesaplanmaz\(.*\)$/, ton: 'bilgi', cumle: () => 'wrk TLS sürümünü sabitlemez ve oturumu sürdürebilir; TLS payı hesaplanmaz.' },
  { re: /^tekrar_kosu_ayristirilamadi\(.*\)$/, ton: 'uyari', cumle: () => 'Adım yeniden denenmiş ama sunucu logunda denemeler ayırt edilemedi; sunucu sayımları iki denemeyi birlikte içerebilir.' },
  { re: /^tekrar_kosu:deneme_(\d+)_kullanildi\((\d+)_eski_satir_atildi\)$/, ton: 'bilgi', cumle: (m) => `Adım yeniden denendi; ${m[1]}. deneme kullanıldı, önceki denemenin ${sayiTr(m[2])} log satırı atıldı.` },
  { re: /^cpu_olculemedi\((.+)\)$/, ton: 'uyari', cumle: (m) => CPU_OLCULEMEDI[m[1]] ?? `CPU tüketimi hesaplanamadı (${m[1]}).` },
  { re: /^yuk_cpu_olculemedi$/, ton: 'uyari', cumle: () => 'Bu adımda yük makinesinin CPU’su ölçülemedi; yük makinesinin doyup doymadığı denetlenemedi.' },
  // 2026-11-03 bellek (bilgi; gecerlilik degismez).
  { re: /^bellek_bos_az\((hedef|yuk),%([\d.]+)\)$/, ton: 'bilgi', cumle: (m) => `${m[1] === 'hedef' ? 'Hedef sunucuda' : 'Yük makinesinde'} boş bellek en düşük %${ondalikTr(m[2])} (%10’un altında); bellek baskısı ölçümü etkileyebilir.` },
  { re: /^nginx_bellek_artisi\(ilk=(\d+)MB,son=(\d+)MB,kosu_sonu=(\d+)MB\)$/, ton: 'bilgi', cumle: (m) => `Olası bellek sızıntısı: nginx worker belleği adımlar boyunca sürekli arttı (${sayiTr(m[1])} MB → ${sayiTr(m[2])} MB) ve koşu sonunda geri inmedi (${sayiTr(m[3])} MB).` },
  // 2026-11-03 bant genisligi (bilgi; gecerlilik degismez).
  { re: /^ag_kullanim_yuksek\((hedef|yuk),%([\d.]+)\)$/, ton: 'bilgi', cumle: (m) => `${m[1] === 'hedef' ? 'Hedef sunucunun' : 'Yük makinesinin'} ağ arayüzü en yüksek %${ondalikTr(m[2])} dolu (%70’in üstünde); ölçülen yanıt süresi ağ sınırını da içerebilir.` },
  // Kip dogrulamasi (gorunum.cjs kipDogrulama; bilgi).
  { re: /^kip_protokol\(istenen=(h1|h2),olculen=(h1|h2),uyumsuz=(\d+)\)$/, ton: 'uyari', cumle: (m) => (m[1] === m[2]
    ? `${PROTOKOL_ADI[m[1]]} istendi ama ${sayiTr(m[3])} yanıt başka bir protokolle geldi.`
    : `${PROTOKOL_ADI[m[1]]} istendi ama yanıtlar ${PROTOKOL_ADI[m[2]]} ile geldi.`) },
  { re: /^kip_ka_yeni_baglanti_%(\d+)$/, ton: 'uyari', cumle: (m) => `Keep-alive istendi ama isteklerin %${m[1]}’i yeni bağlantıda gitti; bağlantı yeniden kullanılmıyor (sunucu keepalive_requests / keepalive_timeout?).` },
  { re: /^kip_sikistirma_az\(istenen=(br|gzip),%([\d.]+)\)$/, ton: 'uyari', cumle: (m) => `${m[1]} istendi ama 1 KB üstü yanıtların yalnız %${ondalikTr(m[2])}’i ${m[1]}; sunucu bu sıkıştırmayı uygulamıyor olabilir.` },
  { re: /^kip_sikistirma_beklenmeyen\(istenen=identity,%([\d.]+)\)$/, ton: 'uyari', cumle: (m) => `Sıkıştırmasız istendi ama yanıtların %${ondalikTr(m[1])}’i sıkıştırılmış geldi.` },
  // B1: kosu notu; '<neden>;son=<kaydedicinin son satiri>' (yeni playbook) ya da yalniz '<neden>'.
  { re: /^yuk_cpu_olculemedi\(([a-z_]+)(?:;son=(.*))?\)$/, ton: 'uyari', cumle: (m) => `Yük makinesi CPU’su ölçülemedi (${YUK_CPU_OLCULEMEDI[m[1]] ?? m[1]}${m[2] ? `; kaydedicinin son çıktısı: “${m[2]}”` : ''}); “yük makinesi doydu” denetimi yapılamadı, sonuç yük makinesinin sınırını gösteriyor olabilir.` },
];

/** Kosu uyarisi `yuk_cpu_olculemedi(<neden>)` (analiz.cjs yukOlcumuDenetle) -> duz Turkce neden. */
export const YUK_CPU_OLCULEMEDI: Record<string, string> = {
  kaydedici_baslamadi: 'kaydedici başlatılamadı',
  kayit_yok: 'kayıt dosyası yok',
  kayit_bozuk: 'kayıt dosyası okunamadı',
  pencerede_ornek_yok: 'ölçüm penceresinde yeterli örnek yok',
};

/** Adimin `cpuOlculemedi` kodu -> cumle (CPU-ms/istek ve kapasite "—" iken neden). */
export const CPU_OLCULEMEDI: Record<string, string> = {
  reload: 'Bu adımda nginx işçi süreçleri değiştiği (reload) için CPU tüketimi hesaplanamadı.',
  sayac_geriledi: 'CPU sayacı geriye gitti; CPU tüketimi hesaplanamadı.',
  net_negatif: 'Arka plan CPU’su ölçülenden büyük çıktı; CPU tüketimi hesaplanamadı.',
  negatif_deger: 'Kayıtlı CPU değeri geçersizdi (sıfır ya da negatif); CPU tüketimi gösterilmiyor.',
};
export const cpuOlculemediMetni = (kod: string | null | undefined) => (kod ? CPU_OLCULEMEDI[kod] ?? `CPU tüketimi hesaplanamadı (${kod}).` : '');

/** Poller'in Turkce ek nedenleri zaten cumledir (bosluk ve harf iceren metin): kod sayilmaz, oldugu gibi gosterilir. */
const CUMLE_RE = /\s/;
function eslestir(k: string, kurallar: Kural[]): NedenAciklamasi {
  for (const kural of kurallar) {
    const m = kural.re.exec(k);
    if (m) return { cumle: kural.cumle(m), kod: k, ton: kural.ton };
  }
  if (CUMLE_RE.test(k)) return { cumle: k, kod: '', ton: 'hata' };
  return { cumle: k, kod: k, ton: 'uyari', bilinmiyor: true };
}
/** Adim / kosu GECERSIZLIK nedeni -> cumle: once neden kurallari (kayit:log_dondu ...), sonra uyari kurallari. */
export function nedenAcikla(kod: string): NedenAciklamasi {
  return eslestir(String(kod ?? '').trim(), [...NEDEN_KURALLARI, ...UYARI_KURALLARI]);
}

/** UYARI kodu -> cumle: once uyari kurallari ("kayit:<kesit>:<uyari>" kaydedici uyarisi, neden degil), sonra neden
 *  kurallari. Kosu duzeyine katlanmis "<TUR>: <uyari>" satirlarinda TUR ayrilir. */
export function uyariAcikla(u: string): NedenAciklamasi & { tur: string | null } {
  const s = String(u ?? '').trim();
  const sira = [...UYARI_KURALLARI, ...NEDEN_KURALLARI];
  const m = /^(R\d+_[A-Za-z0-9_-]+): (.+)$/.exec(s);
  if (m) return { ...eslestir(m[2], sira), tur: m[1] };
  if (/^… ve \d+ adım uyarısı daha$/.test(s)) return { cumle: s, kod: '', ton: 'bilgi', tur: null };
  return { ...eslestir(s, sira), tur: null };
}

// ── Reload ani ──────────────────────────────────────────────────────────────────────
const FAZ_METNI: Record<string, string> = {
  isinma: 'ısınma sırasında', olcum: 'ölçüm sırasında', olcum_kenari: 'ölçümün başında ya da sonunda, CPU penceresi dışında', bosluk: 'adımlar arası beklemede',
  kosu_oncesi: 'koşu başlamadan önce',
};
/** Epoch saniye -> "SS:DD:ss", portalin saat diliminde (PORTAL_TZ; kaydedici ve AWX ciktisi da o dilimde). */
export function saatMetni(t: number): string {
  return Number.isFinite(t) ? fmtTimeSeconds(t * 1000) : '—';
}
/** Reload olayinin yeri ve zamani: "saat 14:59:12 civarında (14:59:10 – 14:59:12 arasında), R2_..._r2 ölçüm sırasında". */
export function reloadZamanMetni(r: Pick<NlReloadAni, 't' | 'tOnce' | 'tur' | 'faz'>): string {
  const aralik = r.tOnce != null && r.tOnce < r.t ? ` (${saatMetni(r.tOnce)} – ${saatMetni(r.t)} arasında)` : '';
  const yer = r.faz === 'kosu_oncesi' ? FAZ_METNI.kosu_oncesi : r.tur ? `${r.tur} ${FAZ_METNI[r.faz] ?? ''}`.trim() : FAZ_METNI[r.faz] ?? '';
  return `saat ${saatMetni(r.t)} civarında${aralik}${yer ? `, ${yer}` : ''}`;
}

/** "a;b(c;d);e" -> ["a", "b(c;d)", "e"] (parantez icindeki ';' bolmez). */
export function nedenleriBol(metin: string): string[] {
  const out: string[] = [];
  let derinlik = 0;
  let bas = 0;
  for (let i = 0; i < metin.length; i++) {
    const c = metin[i];
    if (c === '(') derinlik++;
    else if (c === ')') derinlik = Math.max(0, derinlik - 1);
    else if (c === ';' && derinlik === 0) {
      out.push(metin.slice(bas, i));
      bas = i + 1;
    }
  }
  out.push(metin.slice(bas));
  return out.map((x) => x.trim()).filter(Boolean);
}

/**
 * Kosu duzeyi gecersizlik nedeni "<TUR>(<neden;neden>)" -> { tur, nedenler }. TUR bicimi tutmazsa (istemci_sonucu_yok,
 * okuma hatasi ...) tur null ve satirin tamami tek neden.
 */
export function kosuNedeniniAyir(satir: string): { tur: string | null; nedenler: string[] } {
  const s = String(satir ?? '').trim();
  const m = /^(R\d+_[A-Za-z0-9_-]+?)\((.*)\)$/.exec(s);
  if (!m) return { tur: null, nedenler: [s] };
  return { tur: m[1], nedenler: nedenleriBol(m[2]) };
}

/**
 * Kosu gecersizlik nedenlerini AYNI neden altinda toplar (R2'de iki adim ayni reload'la dusmustu: kullanici iki kez ayni
 * cumleyi okumasin). Sira: ilk gorulme; her nedenin hangi adimlarda goruldugu (TUR adlari) listelenir.
 */
export function kosuNedenleriniTopla(satirlar: string[]): { aciklama: NedenAciklamasi; turlar: string[] }[] {
  const m = new Map<string, { aciklama: NedenAciklamasi; turlar: string[] }>();
  for (const satir of satirlar) {
    const { tur, nedenler } = kosuNedeniniAyir(satir);
    for (const n of nedenler) {
      const a = nedenAcikla(n);
      // Ayni kok (ornek: 429 sayilari farkli) ayri satir kalir: sayi cumlenin parcasi.
      const anahtar = a.cumle;
      const v = m.get(anahtar) ?? { aciklama: a, turlar: [] };
      if (tur && !v.turlar.includes(tur)) v.turlar.push(tur);
      m.set(anahtar, v);
    }
  }
  return [...m.values()];
}
