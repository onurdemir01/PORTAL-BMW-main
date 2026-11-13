// server/nginx-loadtest/analiz.cjs -- Yuk Testi analizi: el kitinin karsilastir.py'sinin Node portu.
//
// KAYNAK: glomo_yuk_testi/f5_rehber/har_yuk_testi/karsilastir.py (sahada kanitli el kiti). Bu dosya
// onun `kosu_hesapla` (TUR basina), `grupla` (tekrar ortalamasi), `karar_ver` (iki kosu arasi
// KALICI/NOTR/RET/GECERSIZ/VERI_YOK) ve `ayristirma` adimlarini AYNI formul ve esiklerle tasir:
//   * yuzdelik = dogrusal ara degerleme ((n-1)*p/100), medyan = statistics.median (cift sayida iki
//     ortanin ortalamasi), toplam = CPython 3.12 sum() (Neumaier), esik karsilastirmalari EPS = 1e-9
//   * olcum penceresi: sunucu logundaki olcum damgalari [min+3, max-2]; log yoksa istemci saati
//   * worker CPU ms/sn = dtik*1000/clk/dt; arka plan = kosu disi >= 8 sn bloklarin medyani
//   * GECERSIZ: k6 rc, 429 (her faz), 5xx (olcum), http2, hata > %0.1, log/istemci farki > %2,
//     kayit:log_dondu, df >= 65, konf ozeti degisti, pencere < 30 sn, reload (pid kumesi/kapanan)
//   * DOYMA: dropped > 0 ya da host CPU ortalamasi > %90 (GECERSIZ > DOYMA > GECERLI); Portal 2026-11-03: yuk
//     makinesi bosta CPU ortalamasi < %20 (YUK_DOYDU; p95 kararinda kullanilmaz, hedefin CPU-ms/istek ve kapasite
//     tahmini kumesinde kalir: yuk_doyma_yalniz)
// Nedenlerdeki sayi bicimleri Python %-bicimiyle birebir (yarim-cifte yuvarlama, -0.0 isareti):
// testler Python'un ciktisini satir satir karsilastirir (__tests__/fixtures/karsilastir-beklenen.json).
//
// PORTAL FARKLARI (bilincli, testte acikca eslenir):
//   1. Bir kosu dizini = tek ADIM (R<id>). Karar iki kosunun ADIM satirlari arasinda verilir; T0/Son/
//      perf ozel adlari yok. Kademeler secilen hizlardan gelir: kademeCpu varsayilani ortak hizlarin
//      ortasi, kademeP95 varsayilani en yuksek ortak hiz (Python 250/400 sabitti).
//   2. Karsilastirilan senaryo/kip/ae: ikisinde de K/yeni/br varsa o (Python ile ayni); yoksa ortak
//      olan baska bir birlesim (Portal kosusu tek kip/ae ile kosar). Python bu durumda VERI_YOK derdi.
//   3. Kademede CPU olcusu yalniz doyma yuzunden yoksa karar DOYMA olur (Python VERI_YOK derdi).
//   4. kos.sh komut onerileri ("TEKRAR=3 ./kos.sh T0 K") Portal diline cevrildi ("tekrar=3 ile").
//   5. TLS mikro testi (tls_olcum.sh) Portal'da kosulmaz: saat farki duzeltmesi ve T3 kurali yok.
//   6. kos.sh'in hatali_ saydigi ya da hic bitmeyen TUR'lar HATALI satiri olarak raporlanir (Python
//      bunlari gormezdi); gruplara ve karara GIRMEZ.
//   7. TUR uyarilari (ham.uyarilar; Python tablo.md'de "uyarili kosular") kosu duzeyi `uyarilar`a da
//      "<tur>: <uyari>" olarak katilir (tekil, en cok MAX_ADIM_UYARI + tek ozet satiri). TUR alanlari,
//      rps_sunucu dahil, DEGISMEZ (Python esdegerligi).
//   8. Hedef turu ve yuk araci (kosuAnaliz secenekleri `hedefTuru` 'sunucu' | 'serbest', `motor`
//      'k6' | 'wrk'; varsayilanlar 'sunucu' / 'k6' ve onlarla cikti BUGUNKUYLE BIREBIR):
//      - serbest (LB VIP ya da yonetilmeyen sunucu; hedefe SSH yok, yalniz istemci olcumu): kesitler,
//        log ve diger trafik TAMAMEN yok sayilir (CPU, rps_sunucu, srt_*, istek_sunucu, host CPU,
//        kapasite null; dizinde yine de sunucu_/bilgi_/log_/diger_ dosyasi varsa tek uyari). Gecerlilik
//        yalniz istemci kurallarindan: rc, 429, 5xx, http2, hata > %0.1, k6'da dropped -> DOYMA. 429 /
//        5xx nedeninde sunucu sayisi YAZILMAZ (olculmedi; "sunucu=0" yanlis olurdu). Sunucu verisine
//        dayanan TUR uyarilari (log penceresi, sunucu kaydi, arka plan) uretilmez.
//      - wrk (kapali dongu: `hiz` kolonu baglanti sayisidir; p50/p95/p99 wrk'nin koordineli ihmal (CO)
//        duzeltmeli histogramindan): rc etiketi `wrk_rc=`; dropped olculmez (null) -> dropped DOYMA'si
//        yok, sunucuda host CPU > %90 DOYMA'si AYNEN. TLS payi yok: ayristirma ve cpu_tlsli_pay HER ZAMAN
//        null (wrk TLS surumunu sabitlemez; 'yeni' kipinde oturum devami / TLS 1.3 K/yeni - K/ka farkini
//        kucuk gosterir; 'yeni' adim varsa kosu uyarisi).
//   9. CPU'suz karar yolu (kararVer): taraflardan biri serbest ya da iki taraf wrk ve CPU kademesinde bir
//      tarafin CPU-ms/istek'i doyma DISI bir nedenle yok -> ortak kademelerde bugunku p95 zarar hesabi
//      (ayni esik / gurultu formulu ve satirlar); zarar RET, yoksa NOTR + "CPU olculmedi ...": ASLA
//      KALICI. Farkli yuk araci (k6 / wrk), farkli is parcacigi sayisi (wrk) ve farkli hiz tavani (wrk
//      tavan_rps; ayni N farkli yuk demektir) VERI_YOK. k6+k6 sunucu+sunucu BUGUNKU gibidir (CPU yoksa
//      VERI_YOK ya da DOYMA): sozlesmenin D4 kararinin
//      harfinden BILINCLI sapma (karsilastir.py esdegerligi korunur; "CPU yoksa asla KALICI" ozu orada
//      da gecerli; sozlesme K25, orkestrator onayli). Kademe birimi metinlerde k6 'istek/sn', wrk
//      'baglanti'; wrk'nin istemci bayt yedegi baslik + govde sayar, TLS haric.
//  10. CPU-ms/istek ASLA negatif degil (sade turu, ilk gercek kosu R2: reload sirasinda -1.372 ms/istek):
//      worker sayaci eski worker'lar cikinca duser. Pencerede reload (PID kumesi degisti / 'shutting down'
//      worker) varsa, ham fark negatifse ya da arka plan cikarilinca negatifse cpu_ms_istek, user_ms, sys_ms
//      (ilk ikisinde cpu_oran_ms_sn de) null; TUR uyarisi `cpu_olculemedi(reload|sayac_geriledi|net_negatif)`,
//      ham.cpu_olculemedi = kod. Kapasite yalniz cpu_ms_istek > 0 iken. DB'den gelen eski satirdaki negatif
//      CPU kararda null sayilir. karsilastir.py bu durumda sayi yazardi (AN2 acik esleme).
//  11. Reload ani: kaydedici orneklerinden olaylar (reloadOlaylari) ozet.reloadlar'a, TUR'a degenler
//      ham.reloadlar'a yazilir (yalniz gosterim; gecerlilik ve karar DEGISMEZ). Faz CPU penceresiyle KESIN
//      eslesir (h2_sozlesme 6): olayin kaniti (bitisik farkli-PID cifti ya da 'shutting down' ornegi) bir
//      TUR'un CPU penceresinin [w0, w1] (pencereCpu'nun baktigi aralik) icindeyse o TUR'un 'olcum'u (adim
//      reload nedeniyle GECERSIZ); yalniz [bas + isinma, bit] olcum fazina degiyorsa 'olcum_kenari' (olcumun
//      basinda ya da sonunda, CPU penceresi disinda; adim etkilenmez). Tek olay iki TUR'un penceresine kanit
//      birakirsa (bosluk 0) ilk TUR'a yazilir. konf_degisti'nin ani bilinmez (kaydedici ozeti yalniz basta ve
//      sonda alir).
//  12. Protokol (kosuAnaliz secenegi `protokol` 'h1' | 'h2', varsayilan 'h1'; h2 yalniz k6): istemci
//      satirinin `protokol` / `protokol_uyumsuz` kolonlari (yuk_k6.js 32 kolon) varsa karar
//      protokol_uyumsuz'dan (h1: 'http2', h2: 'h2_disi(n)'); kolon istenenden farkliysa
//      'protokol_farkli(beklenen=..,olculen=..)'. Kolonu olmayan eski satir: h1'de bugunku `http2 > 0`
//      kurali, h2'de protokol_farkli(olculen=yok) (eski playbook h1 kosmus). h2'de `http2` kolonu bilgi
//      (HTTP/2.0 yanit sayisi). h2 kosusuna kosu uyarisi: k6 v0.49 her VU'da tek baglantida istekleri
//      sirayla gonderir, tarayici coklamasi olculmez (MAKUL; sahada olculmedi). karsilastir.py'de protokol
//      yok: h1 + eski satirla cikti BIREBIR. kararVer: farkli protokol VERI_YOK (motor kuralindan sonra).
//  13. Bellek (2026-11-03, YALNIZ BILGI; gecerlilik ve karar DEGISMEZ): hedefte bellek_*.csv (kesit anahtari
//      sunucu_*.csv ile ayni; CPU penceresi [w0, w1]), yuk makinesinde yukcpu_*.csv'nin bellek kolonlari (yuk CPU
//      penceresi). ham.bellek yalniz olcum varsa (eski playbook: alan YOK). Bos bellek %10 altinda TUR uyarisi
//      `bellek_bos_az(hedef|yuk,%x)`; nginx RSS (adim ortalamalari, zaman sirasiyla) monoton artip ilk-son farki
//      >= %20 ve >= 50 MB ise ve kosu sonu ornegi son adim ortalamasinin %90'indan asagi inmediyse kosu uyarisi
//      `nginx_bellek_artisi(ilk=..MB,son=..MB,kosu_sonu=..MB)` (olasi sizinti).
//  14. Kip dogrulamasi (2026-11-03, YALNIZ BILGI): analiz yalniz istemci_<TUR>.json `kodlama` sayaclarini ham.kodlama'ya
//      tasir (yalniz yeni yuk_k6.js; eski kosu: anahtar YOK). Istenen / gerceklesen karsilastirmasi gorunum.cjs
//      kipDogrulama'dadir (ham.protokol / http2 / yeniden_baglanti_yuzde / kodlama'dan; DB'deki eski adimda da calisir):
//      analiz ciktisi ve TUR uyarilari eski kosuda BIREBIR.
//  15. Bant genisligi (2026-11-03, YALNIZ BILGI; gecerlilik ve karar DEGISMEZ): ham.ag yalniz olcum varsa (eski kosu: anahtar
//      YOK). Test trafigi istemci_<TUR>.json ag_alinan_bayt / ag_gonderilen_bayt / ag_sure_sn'den (bit/sn; yuk makinesinin
//      gozunden alinan / gonderilen). NIC: hedefte ag_<kesit>.csv (rol=hedef; CPU penceresi [w0, w1]), yuk makinesinde
//      rol=yuk kesiti (yukBostaCpu penceresi). Ortalama = pencere ucu farki / sure, en yuksek = ardisik ornek farki. Arayuz
//      hizi (ag_*.txt hiz_mbps) biliniyorsa kullanim % (yon basina en yuksek); > %70 TUR uyarisi
//      `ag_kullanim_yuksek(hedef|yuk,%x)`. Bosta NIC tabani ozet.ag_bosta (ilk adimdan once; hedef internet RP ise arayuz
//      toplami test disi trafigi de icerir).
//  16. Bellek ayrisimi (2026-11-03, YALNIZ BILGI): hedef bdetay_<kesit>.csv'den ham.bellek_detay: pencere ortalamalari
//      (Anon, Pss, baglanti), uc noktalar taban (adim basindan hemen once), son (pencere sonu), dinlenme (adimdan sonraki
//      bosluk bitmeden son ornek; >= 3 sn). Saat farki log penceresinden kestirilir (|fark| > 60 sn: taban / dinlenme yok).
//      "Olasi neden" kurallari gorunum.cjs'dedir (analiz ciktisi eski kosuda BIREBIR).
//  18. Sunucu ayari kaniti (2026-11-04, sunucuAyarKaniti; kosuAnaliz secenekleri sunucuAyar + ae): hazirlik_<ADIM>_*.txt
//      yoksa ya da http2 / ae / seviye / static / dizin istenenle uyusmuyorsa (static kosuda disk_kanit=ok ve dosya_seviye
//      da) kosu GECERSIZ, neden
//      'sunucu_ayari_kanitsiz(...)'; ozet.sunucu_ayar. Secenek verilmezse cikti BIREBIR eskisi.
//  17. Coklu karsilastirma (2026-11-04, coklu.cjs): kararVer'in gurultu x3 / esik kurali tek fonksiyonda (gurultuEsigi);
//      hizOzeti (kararVer ile ayni gruplar) ve farkDurumu (hucre basina AYNI kural: CPU-ms, p95, hata; digerleri
//      renklendirilmez) disari acildi. kararVer ciktisi BIREBIR (Python fikstur testleri).
//  18. Nginx olmayan sunucu hedefi (TEK HEDEF MODELI, 2026-11-13; kosuAnaliz secenegi `hedefNginx` false, yalniz sunucu):
//      playbook hedefte nginx bulamadi ve yuk_cpu_kaydedici.sh ROL=hedef calisti. Log, sunucu_ kesitleri, bellek ve bdetay
//      YOK SAYILIR (serbestteki gibi; `logsuz`); hedefcpu_* kesitlerinden (GENEL CPU, /proc/stat) adim penceresinde host
//      CPU ortalamasi / en yuksegi; ortalama > %90 DOYMA (sunucu kipindeki host CPU kurali). Pencere yuk makinesi saatiyle
//      (zaman.csv). Hedef NIC (ag_*.txt rol=hedef) ayni pencereyle olculur. cpu_ms_istek / kapasite / rps_sunucu null kalir
//      ve karar CPU'suz yoldan (kararVer refNginx / adayNginx false -> cpusuzKarar) verilir: genel host CPU'su nginx worker
//      CPU'su degildir. Secenek verilmezse (true) cikti BIREBIR eskisi.
// null = olculmedi (hicbir zaman 0 yerine gecmez). Fonksiyonlar saftir: G/C yok, saat yok.
'use strict';

const EPS = 1e-9;
const LOG_ESIK_GECERSIZ = 0.02;
const HATA_ESIK = 0.001;
const DF_ESIK = 65;
const DOYMA_HOST_CPU = 90.0;
// 2026-11-03 (K3): yuk makinesi olcum penceresi bosta CPU ortalamasi bunun altindaysa adim DOYMA (YUK_DOYDU):
// sonuc hedefin degil yuk makinesinin sinirini gosterebilir. Pencere 10 sn'den kisa ya da 2'den az ornek: olculmedi.
const YUK_BOSTA_ESIK = 20.0;
const YUK_PENCERE_MIN_SN = 10;
const YUK_DOYMA_ONEKI = 'doyma:yuk_cpu_bosta_';
// 2026-11-03 (bellek, bilgi): bos bellek esigi (%), olasi sizinti esikleri (ilk-son farki orani ve MB), kosu sonu orani.
const BELLEK_BOS_ESIK = 10.0;
const SIZINTI_ORAN = 0.2;
const SIZINTI_MB = 50;
const SIZINTI_GERI_ORAN = 0.9;
// 2026-11-03 (bant genisligi, bilgi): arayuz kullanim uyari esigi (%) ve bosta taban icin en kisa sure (sn).
const AG_KULLANIM_ESIK = 70.0;
const AG_BOSTA_MIN_SN = 5;
// 2026-11-03 (bellek ayrisimi, bilgi): dinlenme noktasi icin en kisa bosluk (sn) ve saat farki tavani (sn).
const DINLENME_MIN_SN = 3;
const SAAT_FARKI_TAVAN = 60;
// 2026-11-04 (inceleme B3): NIC en yuksek hizi en az bu kadar sn'lik kayan pencereden (tam saniyelik epoch'ta ardisik ornek
// farki 1 sn sayilip gercekte 1,4 sn olabilir: tepe ve kullanim % sisiyordu).
const AG_TEPE_SN = 5;
// Sozlesme: yuk_tekrar 1..3. Ek tekrar onerisi bu tavani asmaz.
const MAX_TEKRAR = 3;
const ADIM_RE = /^[A-Za-z0-9-]+$/;
// Kosu duzeyine katilan TUR uyarisi satiri tavani (poller kosu uyarilarinin ilk 100'unu saklar: KOSU_UYARI_TAVANI).
const MAX_ADIM_UYARI = 40;
// Secenek degerleri (PORTAL FARKLARI 8): hedef turu ve yuk araci; ilk deger varsayilandir.
const HEDEF_TURLERI = Object.freeze(['sunucu', 'serbest']);
const MOTORLAR = Object.freeze(['k6', 'wrk']);
const PROTOKOLLER = Object.freeze(['h1', 'h2']);
const PROTOKOL_ADI = Object.freeze({ h1: 'HTTP/1.1', h2: 'HTTP/2' });
// Serbest hedefte yok sayilan cpu_kaydedici.sh dosyalari (sunucu_*.csv, bilgi_*.txt, log_*, diger_*).
const SUNUCU_DOSYA_RE = /^(sunucu|bilgi|log|diger)_/;
const SERBEST_UYARISI = 'sunucu_olcumu_yok(serbest_hedef)';
// Nginx'siz hedef (kosu uyarilari): host CPU olculdu ama istek basina CPU / kapasite yok; kayit hic yok / hepsi bozuk.
const NGINX_YOK_UYARISI = 'nginx_yok(istek_basina_cpu_ve_kapasite_yok)';
const HEDEF_CPU_KAYDI_YOK = 'hedef_cpu_kaydi_yok';
const HEDEF_CPU_KAYDI_BOZUK = 'hedef_cpu_kaydi_bozuk';
const WRK_TLS_UYARISI = 'wrk_tls_payi_hesaplanmaz(oturum_devami_ya_da_tls13_olabilir)';
// PORTAL FARKLARI 12: k6 HTTP/2'de VU basina tek akis; tarayicidaki eszamanli akislar olculmez.
const H2_UYARISI = 'h2_vu_basina_tek_akis(tarayici_coklamasi_olculmez)';
const CPU_YOK_SERBEST = 'CPU olculmedi (serbest hedef): KALICI verilmez; karar p95 ve hata oranina gore';
const CPU_YOK_NGINXSIZ = 'CPU-ms olculmedi (nginx olmayan hedef): KALICI verilmez; karar p95 ve hata oranina gore';
const CPU_YOK_WRK = 'CPU olculmedi (wrk, sunucu kaydi eksik): KALICI verilmez; karar p95 ve hata oranina gore';

// GECERSIZ / HATALI / DOYMA neden onekleri -> (anlami, ne yapilir). Ekran yalniz gorulenleri aciklar.
const NEDENLER = Object.freeze([
  { onek: 'k6_rc', anlam: 'k6 hata koduyla bitti.', cozum: 'Is ciktisindaki k6 mesajina bakin; kosuyu tekrarlayin.' },
  { onek: 'wrk_rc', anlam: 'wrk hata koduyla bitti.', cozum: 'Is ciktisindaki wrk mesajina bakin; kosuyu tekrarlayin.' },
  { onek: '429', anlam: 'Rate limit (limit_req / limit_conn) asildi.', cozum: "Hizlari dusurun; ayni IP'den baska yuk var mi bakin." },
  { onek: '5xx', anlam: 'Olcum fazinda sunucu hatasi (5xx).', cozum: "error.log'a bakin; nedeni giderip kosuyu tekrarlayin." },
  { onek: 'http2', anlam: 'HTTP/2 ile gidildi.', cozum: 'k6 surumunu ve GODEBUG=http2client=0 ayarini kontrol edin (HTTP/1.1 kosusu).' },
  { onek: 'h2_disi', anlam: 'HTTP/2 kosusunda HTTP/2 disi yanit geldi.', cozum: 'Hedefin bu Host icin h2 sundugunu (on kontrol) dogrulayin; ya da HTTP/1.1 ile kosun.' },
  { onek: 'protokol_farkli', anlam: 'Yuk araci istenen protokolu kullanmadi.', cozum: 'Ansible deposunu (yuk_k6.js) guncelleyin; kosuyu tekrarlayin.' },
  { onek: 'hata_', anlam: "Istek hatasi %0.1'i asti (404, zaman asimi ...).", cozum: 'Senaryodaki yollar hala 200 mu (deploy oldu mu)? Gerekirse senaryoyu yenileyin, kosuyu tekrarlayin.' },
  { onek: 'log_istemci_farki', anlam: "Sunucu logundaki istek sayisi k6'nin saydigindan %2'den fazla farkli.", cozum: 'Dogru sunucu ve IP mi? Isteklerin bir kismi baska sunucuya mi gidiyor?' },
  { onek: 'kayit:log_dondu', anlam: 'Kayit sirasinda log dondu ya da kuculdu (rotate).', cozum: 'Kosuyu tekrarlayin.' },
  { onek: 'disk_', anlam: '/web_log %65 ya da ustu dolu; disk_cleaner loglari sifirlayabilir.', cozum: 'Yer acilmasini bekleyin.' },
  { onek: 'konf_degisti', anlam: 'Kayit sirasinda nginx konfigurasyonu degisti.', cozum: 'Deney suresince o sunucuya konf dagitilmamali.' },
  { onek: 'pencere_kisa', anlam: "Kaydedici olcum fazinin 30 sn'den azini gordu (gec basladi / erken durdu).", cozum: 'Kosuyu tekrarlayin; kaydedici erken durduysa is ciktisina bakin.' },
  { onek: 'reload', anlam: 'Olcum penceresinde reload oldu (worker PID kumesi degisti).', cozum: "Eski worker'lar ('shutting down') bitene kadar bekleyip kosuyu tekrarlayin." },
  { onek: 'hatali_kosu', anlam: "kos.sh / wrk_kos.sh bu TUR'u durdurdu (429 / 5xx / soket / hata orani / http2 / protokol / hata kodu / olcum yok).", cozum: 'Nedeni giderip yeni kosu baslatin.' },
  { onek: 'tamamlanmadi', anlam: 'TUR baslatildi ama istemci sonucu yazilmadi (kosu kesildi ya da durduruldu).', cozum: 'Yeni kosu baslatin.' },
  { onek: 'sunucu_ayari_kanitsiz', anlam: 'Kosu oncesi sunucu ayari istendi ama hazirlik kaniti yok ya da istenenle uyusmuyor.', cozum: 'Ansible deposunu (hazirlik.sh) guncelleyin; is ciktisina bakip kosuyu tekrarlayin.' },
  { onek: 'doyma:', anlam: 'Istenen hiz tutturulamadi (dropped > 0), hedefin CPU ortalamasi %90 ustunde ya da yuk makinesi doydu (bosta CPU %20 altinda).', cozum: 'Daha dusuk hizla kosun; kapasite tahmini bu kademede gecerli degil.' },
]);

// Analizin urettigi TUM neden / uyari kodlari (sabit liste; arayuz bunlari duz Turkce cumleye esler,
// sozlesme sade_sozlesme.md 3). tur: 'neden' = adim `nedenler` (GECERSIZ / HATALI / DOYMA), 'uyari' =
// adim ham.uyarilar. Yeni bir kod eklenirse buraya da eklenir (AN23 fikstur ciktisinin her satirini sinar).
const NEDEN_KALIPLARI = Object.freeze([
  { kod: 'k6_rc', tur: 'neden', re: /^k6_rc=(.+)$/ },
  { kod: 'wrk_rc', tur: 'neden', re: /^wrk_rc=(.+)$/ },
  { kod: '429', tur: 'neden', re: /^429\(istemci=(\d+)(?:,sunucu=(\d+))?\)$/ },
  { kod: '5xx', tur: 'neden', re: /^5xx\(istemci=(\d+)(?:,sunucu=(\d+))?\)$/ },
  { kod: 'http2', tur: 'neden', re: /^http2$/ },
  { kod: 'h2_disi', tur: 'neden', re: /^h2_disi\((\d+)\)$/ },
  { kod: 'protokol_farkli', tur: 'neden', re: /^protokol_farkli\(beklenen=(h1|h2),olculen=(h1|h2|yok)\)$/ },
  { kod: 'hata', tur: 'neden', re: /^hata_%([0-9.]+)\(>%0\.1\)$/ },
  { kod: 'log_istemci_farki', tur: 'neden', re: /^log_istemci_farki_%([0-9.]+)$/ },
  { kod: 'kayit', tur: 'neden', re: /^kayit:(.+)$/ },
  { kod: 'disk', tur: 'neden', re: /^disk_%(\d+)$/ },
  { kod: 'konf_degisti', tur: 'neden', re: /^konf_degisti$/ },
  { kod: 'pencere_kisa', tur: 'neden', re: /^pencere_kisa\(([0-9.]+)s\)$/ },
  { kod: 'reload', tur: 'neden', re: /^reload\(worker_pid_degisti\)$/ },
  { kod: 'hatali_kosu', tur: 'neden', re: /^hatali_kosu\(kos\.sh_durdurdu\)$/ },
  { kod: 'tamamlanmadi', tur: 'neden', re: /^tamamlanmadi\(istemci_sonucu_yok\)$/ },
  { kod: 'sunucu_ayari_kanitsiz', tur: 'neden', re: /^sunucu_ayari_kanitsiz\(([a-z0-9_,]+)\)$/ },
  { kod: 'doyma_dropped', tur: 'neden', re: /^doyma:dropped=(\d+)$/ },
  { kod: 'doyma_host_cpu', tur: 'neden', re: /^doyma:host_cpu_%([0-9.]+)\(>%90\)$/ },
  { kod: 'doyma_yuk_cpu', tur: 'neden', re: /^doyma:yuk_cpu_bosta_%([0-9.]+)\(<%20\)$/ },
  { kod: 'saat_farki', tur: 'uyari', re: /^saat_farki~(-?\d+)s\(sunucu-istemci\)$/ },
  { kod: 'log_satiri_yok', tur: 'uyari', re: /^log_satiri_yok:pencere_istemci_saatinden$/ },
  { kod: 'sunucu_logunda_bu_tur_yok', tur: 'uyari', re: /^sunucu_logunda_bu_tur_yok$/ },
  { kod: 'yeni_kipinde_yeniden_kullanim', tur: 'uyari', re: /^yeni_kipinde_baglanti_yeniden_kullanilmis_%(\d+)$/ },
  { kod: 'dropped_iterations', tur: 'uyari', re: /^dropped_iterations=(\d+)$/ },
  { kod: 'sunucu_kaydi_yok', tur: 'uyari', re: /^sunucu_kaydi_yok$/ },
  { kod: 'pencerede_ornek_yok', tur: 'uyari', re: /^pencerede_ornek_yok$/ },
  { kod: 'arka_plan_yok', tur: 'uyari', re: /^arka_plan_yok\(0_kabul\)$/ },
  { kod: 'arka_plan_az', tur: 'uyari', re: /^arka_plan_az\(([0-9.]+)s\)$/ },
  { kod: 'diger_trafik', tur: 'uyari', re: /^diger_trafik_%(\d+)$/ },
  { kod: 'perf_ek_yuku', tur: 'uyari', re: /^perf_ek_yuku\(kararda_kullanilmaz\)$/ },
  { kod: 'tekrar_kosu_ayristirilamadi', tur: 'uyari', re: /^tekrar_kosu_ayristirilamadi\(log'da_deneme_kolonu_yok\)$/ },
  { kod: 'tekrar_kosu_deneme', tur: 'uyari', re: /^tekrar_kosu:deneme_(\d+)_kullanildi\((\d+)_eski_satir_atildi\)$/ },
  { kod: 'cpu_olculemedi', tur: 'uyari', re: /^cpu_olculemedi\((reload|sayac_geriledi|net_negatif)\)$/ },
  { kod: 'yuk_cpu_olculemedi', tur: 'uyari', re: /^yuk_cpu_olculemedi$/ },
  // 2026-11-13 nginx'siz hedef: kesit var ama bu TUR'un penceresinde hedef CPU ornegi yok.
  { kod: 'hedef_cpu_olculemedi', tur: 'uyari', re: /^hedef_cpu_olculemedi$/ },
  // 2026-11-03 bellek (bilgi): TUR uyarisi bellek_bos_az, kosu uyarisi nginx_bellek_artisi.
  { kod: 'bellek_bos_az', tur: 'uyari', re: /^bellek_bos_az\((hedef|yuk),%([0-9.]+)\)$/ },
  { kod: 'nginx_bellek_artisi', tur: 'uyari', re: /^nginx_bellek_artisi\(ilk=(\d+)MB,son=(\d+)MB,kosu_sonu=(\d+)MB\)$/ },
  // 2026-11-03 bant genisligi (bilgi): TUR uyarisi.
  { kod: 'ag_kullanim_yuksek', tur: 'uyari', re: /^ag_kullanim_yuksek\((hedef|yuk),%([0-9.]+)\)$/ },
]);

// istemci_<TUR>.csv'den sayi olarak alinan alanlar (karsilastir.py kosu_hesapla ile ayni liste).
const ISTEMCI_SAYI = Object.freeze([
  'n_olcum', 'rps_gercek', 'p50', 'p95', 'p99', 'ttfb_p95', 'tls_p95', 'connect_p95', 'hata_orani',
  'n_429', 'n_5xx', 'dropped', 'http2', 'bayt_istek', 'p95_js', 'p95_css', 'p95_html', 'p95_json',
  'p95_config', 'p95_buyuk', 'isinma_sn', 'sure_sn',
]);
const GRUP_ORTALAMA = Object.freeze([
  'rps_gercek', 'p50', 'p95', 'p99', 'ttfb_p95', 'tls_p95', 'hata_orani', 'sunucu_rt_p95', 'bayt_istek',
  'govde_bayt_istek', 'host_cpu_ort', 'p95_buyuk', 'diger_rps',
]);
const FARK_ALANLARI = Object.freeze([
  'cpu_ms_istek', 'p50', 'p95', 'p99', 'ttfb_p95', 'hata_orani', 'rps_gercek', 'host_cpu_ort', 'bayt_istek',
  'govde_bayt_istek', 'sunucu_rt_p95',
]);

// ---------------------------------------------------------------------------------------------
// Python uyumlu ilkel islemler
// ---------------------------------------------------------------------------------------------

const PY_FLOAT_RE = /^[+-]?(?:[0-9](?:_?[0-9])*(?:\.(?:[0-9](?:_?[0-9])*)?)?|\.[0-9](?:_?[0-9])*)(?:[eE][+-]?[0-9](?:_?[0-9])*)?$/;

/**
 * karsilastir.py `sayi`: bos, nan, -, none, null -> null; sonlu olmayan -> null. JS sayisi da kabul
 * eder (DB satiri). sonuc.cjs'teki kopyasiyla esdegerligi testte kilitlidir (modul bagimliligi yok).
 */
function sayi(x) {
  if (x === null || x === undefined) return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  const s = String(x).trim();
  const k = s.toLowerCase();
  if (s === '' || k === 'nan' || k === '-' || k === 'none' || k === 'null') return null;
  if (!PY_FLOAT_RE.test(s)) return null;
  const v = Number(s.replace(/_/g, ''));
  return Number.isFinite(v) ? v : null;
}

/** CPython 3.12 sum() (float listesi): Neumaier telafili toplam. */
function pyToplam(xs) {
  if (!xs.length) return 0;
  let f = 0 + xs[0];
  let c = 0;
  for (let i = 1; i < xs.length; i++) {
    const x = xs[i];
    const t = f + x;
    if (Math.abs(f) >= Math.abs(x)) c += (f - t) + x;
    else c += (x - t) + f;
    f = t;
  }
  if (c !== 0 && Number.isFinite(c)) f += c;
  return f;
}

/** Python max(a, b): esitlikte ILKI (isaretli sifirda fark eder). */
function pyMax(a, b) {
  return b > a ? b : a;
}

function esikGecti(deger, esik) {
  return deger >= esik - EPS;
}

function yuzdelik(degerler, p) {
  if (!degerler.length) return null;
  const d = Float64Array.from(degerler).sort();
  const k = ((d.length - 1) * p) / 100.0;
  const a = Math.floor(k);
  const b = Math.ceil(k);
  return d[a] + (d[b] - d[a]) * (k - a);
}

/** statistics.median */
function medyan(xs) {
  const d = Float64Array.from(xs).sort();
  const n = d.length;
  if (!n) return null;
  if (n % 2 === 1) return d[(n - 1) / 2];
  return (d[n / 2 - 1] + d[n / 2]) / 2;
}

function ortalama(xs) {
  const v = xs.filter((x) => x !== null && x !== undefined);
  return v.length ? pyToplam(v) / v.length : null;
}

function gurultu(xs) {
  const v = xs.filter((x) => x !== null && x !== undefined);
  if (v.length < 2) return null;
  const m = pyToplam(v) / v.length;
  return m ? (Math.max(...v) - Math.min(...v)) / m : null;
}

function oran(a, b) {
  if (a === null || a === undefined || b === null || b === undefined || b === 0) return null;
  return (a - b) / b;
}

/** Python round(float) -> int (yarim-cifte). */
function pyYuvarla(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/**
 * Python '%.nf': ikili degerin TAM ondalik acilimina gore yuvarlar, tam yarida cifte gider
 * (toFixed yukari gider: 0.125 -> '0.13', Python '0.12'). Negatif sifir isaretini korur ('-0.0').
 */
function fx(x, n) {
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
  const neg = x < 0 || Object.is(x, -0);
  const a = Math.abs(x);
  let s;
  if (a >= 1e21) {
    s = BigInt(a).toString() + (n > 0 ? '.' + '0'.repeat(n) : '');
  } else {
    s = a.toFixed(n);
    const tam = a.toFixed(100);
    const nokta = tam.indexOf('.');
    const kalan = tam.slice(nokta + 1 + n);
    if (/^50*$/.test(kalan)) {
      const kesik = n > 0 ? tam.slice(0, nokta + 1 + n) : tam.slice(0, nokta);
      if (Number(kesik[kesik.length - 1]) % 2 === 0) s = kesik;
    }
  }
  return (neg ? '-' : '') + s;
}

/** Python '%+.nf' */
function fxs(x, n) {
  const s = fx(x, n);
  return s.startsWith('-') ? s : '+' + s;
}

/** Python '%d' (float -> int: sifira dogru keser). */
function fd(x) {
  const t = Math.trunc(x);
  return Math.abs(t) >= 1e21 ? BigInt(t).toString() : String(t === 0 ? 0 : t);
}

// ---------------------------------------------------------------------------------------------
// TUR hesaplari (karsilastir.py kosu_hesapla ve yardimcilari)
// ---------------------------------------------------------------------------------------------

function kesitSec(kesitler, w0, w1) {
  let enIyi = null;
  let enCok = 0;
  for (const k of kesitler) {
    let c = 0;
    for (const o of k.ornekler) if (w0 <= o.t && o.t <= w1) c++;
    if (c > enCok) {
      enIyi = k;
      enCok = c;
    }
  }
  return enIyi;
}

function clkAl(kesit) {
  const v = sayi(kesit.bilgi ? kesit.bilgi.clk_tck : null);
  return v && v > 0 ? v : 100.0;
}

function pencereCpu(ornekler, w0, w1, clk) {
  const ic = ornekler.filter((o) => w0 <= o.t && o.t <= w1);
  if (ic.length < 2) return null;
  const a = ic[0];
  const b = ic[ic.length - 1];
  const dt = b.t - a.t;
  if (dt <= 0) return null;
  const reload = new Set(ic.map((o) => o.p)).size > 1 || ic.some((o) => o.k > 0);
  const hostOrt = b.tot > a.tot ? (100.0 * (b.busy - a.busy)) / (b.tot - a.tot) : null;
  let hostMax = null;
  for (let i = 0; i < ic.length - 5; i++) {
    const x = ic[i];
    const y = ic[i + 5];
    if (y.tot > x.tot) {
      const v = (100.0 * (y.busy - x.busy)) / (y.tot - x.tot);
      hostMax = hostMax === null ? v : pyMax(hostMax, v);
    }
  }
  if (hostMax === null) hostMax = hostOrt;
  return {
    t0: a.t, t1: b.t, dt, reload,
    user: ((b.u - a.u) * 1000.0) / clk / dt,
    sys: ((b.s - a.s) * 1000.0) / clk / dt,
    host_ort: hostOrt, host_max: hostMax,
  };
}

/**
 * Yuk makinesi bosta CPU ortalamasi (%): pencere [bas + isinma + 3, bit - 2] (zaman.csv, yuk makinesi saati; yuk
 * kaydedicisi ayni makinede: saat kaymasi yok). Kesit yoksa, pencere < 10 sn ya da 2'den az ornek: null.
 */
function yukBostaCpu(yukKesitler, zaman, isinmaSn) {
  if (!Array.isArray(yukKesitler) || !yukKesitler.length || !zaman) return null;
  const w0 = zaman[0] + (isinmaSn || 0) + 3;
  const w1 = zaman[1] - 2;
  if (!(w1 - w0 >= YUK_PENCERE_MIN_SN)) return null;
  const kesit = kesitSec(yukKesitler, w0, w1);
  if (kesit === null) return null;
  const ic = kesit.ornekler.filter((o) => w0 <= o.t && o.t <= w1);
  if (ic.length < 2) return null;
  const a = ic[0];
  const b = ic[ic.length - 1];
  if (!(b.tot > a.tot)) return null;
  const mesgul = (100.0 * (b.busy - a.busy)) / (b.tot - a.tot);
  return Math.min(100, Math.max(0, 100.0 - mesgul));
}

/**
 * Nginx'siz sunucu hedefinin genel pencere CPU'su (%). Pencere yukBostaCpu ile ayni ([bas + isinma +
 * 3, bit - 2], zaman.csv = yuk makinesi saati; hedef saati ile fark NTP kadar). Ortalama ilk-son ornekten, en yuksek 5
 * orneklik kayan pencereden (pencereCpu ile ayni kural). Pencere < 10 sn, 2'den az ornek ya da sayac ilerlemedi: null.
 */
function hedefHostCpu(kesitler, zaman, isinmaSn) {
  if (!Array.isArray(kesitler) || !kesitler.length || !zaman) return null;
  const w0 = zaman[0] + (isinmaSn || 0) + 3;
  const w1 = zaman[1] - 2;
  if (!(w1 - w0 >= YUK_PENCERE_MIN_SN)) return null;
  const kesit = kesitSec(kesitler, w0, w1);
  if (kesit === null) return null;
  const ic = kesit.ornekler.filter((o) => w0 <= o.t && o.t <= w1);
  if (ic.length < 2) return null;
  const a = ic[0];
  const b = ic[ic.length - 1];
  if (!(b.tot > a.tot)) return null;
  const yuzde = (x, y) => Math.min(100, Math.max(0, (100.0 * (y.busy - x.busy)) / (y.tot - x.tot)));
  const ort = yuzde(a, b);
  let max = null;
  for (let i = 0; i < ic.length - 5; i++) {
    if (ic[i + 5].tot > ic[i].tot) {
      const v = yuzde(ic[i], ic[i + 5]);
      max = max === null ? v : pyMax(max, v);
    }
  }
  return { ort, max: max === null ? ort : max, kesit: kesit.anahtar };
}

const MB = (kb) => kb / 1024;
const enKucuk = (xs) => (xs.length ? xs.reduce((a, b) => (b < a ? b : a)) : null);
const enBuyuk = (xs) => (xs.length ? xs.reduce((a, b) => (b > a ? b : a)) : null);
/** Ornekler -> bos bellek yuzdeleri (MemAvailable / MemTotal; ikisi de olculmus ve MemTotal > 0). */
const bosYuzdeleri = (ic) => ic.filter((o) => o.mt !== null && o.mt !== undefined && o.mt > 0 && o.ma !== null && o.ma !== undefined)
  .map((o) => Math.min(100, Math.max(0, (100.0 * o.ma) / o.mt)));

/**
 * 2026-11-03 (bellek, YALNIZ BILGI). Hedef: `kesitAdi`'nin bellek kesiti, CPU penceresi [w0, w1] (log saati). Yuk
 * makinesi: yukBostaCpu ile ayni pencere (zaman.csv). Olcum yoksa null (eski playbook). Bos bellek %10 altindaysa
 * `uyari`ya `bellek_bos_az(<taraf>,%x)` (x tek ondaliga asagi).
 */
function bellekOlc(ctx, kesitAdi, w0, w1, zaman, isinmaSn, uyari) {
  const o = {
    nginx_rss_ort_mb: null, nginx_rss_max_mb: null, hedef_bellek_yuzde: null, hedef_bos_min_yuzde: null,
    yuk_bellek_yuzde: null, yuk_bos_min_yuzde: null, arac_rss_max_mb: null,
  };
  let olculdu = false;
  let kesit = null;
  let t0 = null;
  if (kesitAdi && w0 !== null && w1 !== null && w1 > w0) {
    const k = ctx.bellekKesitler.find((x) => x.anahtar === kesitAdi);
    const ic = k ? k.ornekler.filter((x) => w0 <= x.t && x.t <= w1) : [];
    const rss = ic.map((x) => x.rss).filter((v) => v !== null && v !== undefined);
    if (rss.length) {
      o.nginx_rss_ort_mb = MB(pyToplam(rss) / rss.length);
      o.nginx_rss_max_mb = MB(enBuyuk(rss));
      kesit = k.anahtar;
      t0 = ic[0].t;
      olculdu = true;
    }
    const bos = bosYuzdeleri(ic);
    if (bos.length) {
      o.hedef_bos_min_yuzde = enKucuk(bos);
      o.hedef_bellek_yuzde = 100 - o.hedef_bos_min_yuzde;
      olculdu = true;
    }
  }
  if (Array.isArray(ctx.yukKesitler) && ctx.yukKesitler.length && zaman) {
    const y0 = zaman[0] + (isinmaSn || 0) + 3;
    const y1 = zaman[1] - 2;
    const k = y1 > y0 ? kesitSec(ctx.yukKesitler, y0, y1) : null;
    const ic = k ? k.ornekler.filter((x) => y0 <= x.t && x.t <= y1) : [];
    const bos = bosYuzdeleri(ic);
    if (bos.length) {
      o.yuk_bos_min_yuzde = enKucuk(bos);
      o.yuk_bellek_yuzde = 100 - o.yuk_bos_min_yuzde;
      olculdu = true;
    }
    const ar = ic.map((x) => x.ar).filter((v) => v !== null && v !== undefined && v > 0);
    if (ar.length) {
      o.arac_rss_max_mb = MB(enBuyuk(ar));
      olculdu = true;
    }
  }
  if (!olculdu) return null;
  if (o.hedef_bos_min_yuzde !== null && o.hedef_bos_min_yuzde < BELLEK_BOS_ESIK) uyari.push(`bellek_bos_az(hedef,%${fx(asagiOndalik(o.hedef_bos_min_yuzde), 1)})`);
  if (o.yuk_bos_min_yuzde !== null && o.yuk_bos_min_yuzde < BELLEK_BOS_ESIK) uyari.push(`bellek_bos_az(yuk,%${fx(asagiOndalik(o.yuk_bos_min_yuzde), 1)})`);
  return { ...o, _kesit: kesit, _t0: t0 };
}

/**
 * 2026-11-03 (olasi bellek sizintisi, bilgi). Her bellek kesitinde, o kesitten nginx RSS'i olculmus TUR'larin
 * ortalamalari pencere baslangicina gore siralanir: >= 2 nokta, monoton artan (azalmayan), ilk-son farki >= %20 ve
 * >= 50 MB, kosu sonu (kesitin son RSS ornegi) son ortalamanin %90'indan asagi inmedi -> kosu uyarisi. Yoksa null.
 */
function bellekSizintisi(ctx, hesaplar) {
  for (const k of ctx.bellekKesitler) {
    const nokta = hesaplar.map((h) => h.r._bellek)
      .filter((b) => b && b._kesit === k.anahtar && b.nginx_rss_ort_mb !== null && b._t0 !== null)
      .sort((a, b) => a._t0 - b._t0)
      .map((b) => b.nginx_rss_ort_mb);
    if (nokta.length < 2) continue;
    if (nokta.some((v, i) => i > 0 && v < nokta[i - 1])) continue;
    const ilk = nokta[0];
    const son = nokta[nokta.length - 1];
    if (!(ilk > 0) || son - ilk < SIZINTI_MB || son - ilk < SIZINTI_ORAN * ilk) continue;
    const rss = k.ornekler.map((x) => x.rss).filter((v) => v !== null && v !== undefined);
    if (!rss.length) continue;
    const kosuSonu = MB(rss[rss.length - 1]);
    if (kosuSonu < SIZINTI_GERI_ORAN * son) continue;
    return `nginx_bellek_artisi(ilk=${fd(pyYuvarla(ilk))}MB,son=${fd(pyYuvarla(son))}MB,kosu_sonu=${fd(pyYuvarla(kosuSonu))}MB)`;
  }
  return null;
}

/**
 * 2026-11-03 (bant genisligi). Kumulatif { t, rx, tx } ornekleri, pencere [a, b] -> { rx_ort_bps, tx_ort_bps, rx_max_bps,
 * tx_max_bps, sn } (bit/sn). 2'den az ornek ya da sure 0: null. En yuksek (2026-11-04): her ornek icin en az AG_TEPE_SN
 * geriye giden en yakin ornekle fark (kayan pencere); pencere AG_TEPE_SN'den kisaysa null (cagiran ortalamayi kullanir).
 */
function nicPencere(ornekler, a, b) {
  const ic = ornekler.filter((o) => a <= o.t && o.t <= b);
  if (ic.length < 2) return null;
  const x = ic[0];
  const y = ic[ic.length - 1];
  const dt = y.t - x.t;
  if (!(dt > 0)) return null;
  let rxMax = null;
  let txMax = null;
  let j = 0;
  for (let i = 1; i < ic.length; i++) {
    while (j + 1 < i && ic[i].t - ic[j + 1].t >= AG_TEPE_SN) j++;
    const d = ic[i].t - ic[j].t;
    if (!(d >= AG_TEPE_SN)) continue;
    const r = ((ic[i].rx - ic[j].rx) * 8) / d;
    const t = ((ic[i].tx - ic[j].tx) * 8) / d;
    rxMax = rxMax === null ? r : Math.max(rxMax, r);
    txMax = txMax === null ? t : Math.max(txMax, t);
  }
  return { rx_ort_bps: ((y.rx - x.rx) * 8) / dt, tx_ort_bps: ((y.tx - x.tx) * 8) / dt, rx_max_bps: rxMax, tx_max_bps: txMax, sn: dt };
}

/** ag kesitinin bilgi alanlari (ag_*.txt): arayuz, secim, hiz_mbps (> 0 sayi ya da null). */
function agKesitBilgisi(k) {
  const b = k && k.bilgi ? k.bilgi : {};
  const hiz = sayi(b.hiz_mbps);
  return {
    arayuz: typeof b.arayuz === 'string' && b.arayuz ? b.arayuz.slice(0, 32) : null,
    secim: typeof b.secim === 'string' && b.secim ? b.secim.slice(0, 80) : null,
    hiz_mbps: hiz !== null && hiz > 0 ? hiz : null,
  };
}

/** 2026-11-04 (inceleme B4): kaydedicinin kendi CPU maliyeti (ag_*.txt bitiste; >= 0 sayi ya da null). */
function kaydediciSayi(k, ad) {
  const v = sayi(k && k.bilgi ? k.bilgi[ad] : null);
  return v !== null && v >= 0 ? v : null;
}

/** NIC olcumu + arayuz bilgisi + kullanim % (yon basina en yuksek / hiz). */
function nicOlc(k, a, b) {
  const p = k ? nicPencere(k.ornekler, a, b) : null;
  if (!p) return null;
  const bilgi = agKesitBilgisi(k);
  const enCok = Math.max(p.rx_max_bps ?? p.rx_ort_bps, p.tx_max_bps ?? p.tx_ort_bps);
  const kullanim = bilgi.hiz_mbps ? (100.0 * enCok) / (bilgi.hiz_mbps * 1e6) : null;
  return { ...p, ...bilgi, kullanim_max_yuzde: kullanim };
}

/**
 * 2026-11-03 (bant genisligi, YALNIZ BILGI). Test trafigi (istemci JSON) + hedef NIC (kesitAdi'nin ag kesiti, [w0, w1]) + yuk
 * makinesi NIC (rol=yuk, yukBostaCpu penceresi). Hicbiri yoksa null (eski kosu). Kullanim > %70: `uyari`ya ag_kullanim_yuksek.
 */
function agOlc(ctx, tur, kesitAdi, w0, w1, zaman, isinmaSn, uyari, genelKesit = null) {
  const o = { test_alinan_bps: null, test_gonderilen_bps: null, hedef: null, yuk: null };
  const ia = ctx.istemciAg.get(tur);
  if (ia && ia.sure !== null && ia.sure > 0) {
    if (ia.alinan !== null) o.test_alinan_bps = (ia.alinan * 8) / ia.sure;
    if (ia.gonderilen !== null) o.test_gonderilen_bps = (ia.gonderilen * 8) / ia.sure;
  }
  if (kesitAdi && w0 !== null && w1 !== null && w1 > w0) {
    o.hedef = nicOlc(ctx.agHedef.find((k) => k.anahtar === kesitAdi), w0, w1);
  } else if (genelKesit && zaman) {
    // Nginx'siz hedef: genel CPU kesitiyle ayni anahtar ve yuk makinesi penceresi (log saati yok).
    const g0 = zaman[0] + (isinmaSn || 0) + 3;
    const g1 = zaman[1] - 2;
    if (g1 > g0) o.hedef = nicOlc(ctx.agHedef.find((k) => k.anahtar === genelKesit), g0, g1);
  }
  if (ctx.agYuk.length && zaman) {
    const y0 = zaman[0] + (isinmaSn || 0) + 3;
    const y1 = zaman[1] - 2;
    if (y1 > y0) o.yuk = nicOlc(kesitSec(ctx.agYuk, y0, y1), y0, y1);
  }
  if (o.test_alinan_bps === null && o.test_gonderilen_bps === null && !o.hedef && !o.yuk) return null;
  for (const taraf of ['hedef', 'yuk']) {
    const v = o[taraf] ? o[taraf].kullanim_max_yuzde : null;
    if (v !== null && v > AG_KULLANIM_ESIK) uyari.push(`ag_kullanim_yuksek(${taraf},%${fx(asagiOndalik(v), 1)})`);
  }
  return o;
}

/** bdetay ornegi -> nokta (MB; adet). */
function bdNokta(x) {
  if (!x) return null;
  const mb = (v) => (v === null || v === undefined ? null : MB(v));
  return { t: x.t, anon_mb: mb(x.an), shmem_mb: mb(x.sh), file_mb: mb(x.fi), pss_mb: mb(x.pss), baglanti: x.bg ?? null };
}
const ortVeyaNull = (xs) => (xs.length ? pyToplam(xs) / xs.length : null);
const dolu = (ic, a) => ic.map((x) => x[a]).filter((v) => v !== null && v !== undefined);

/**
 * 2026-11-03 (bellek ayrisimi, YALNIZ BILGI). kesitAdi'nin bdetay kesiti; pencere [w0, w1] (log saati). `ofs` = hedef saati -
 * yuk makinesi saati (kestirim; null: taban / dinlenme kurulmaz). Taban: adim baslangicindan (zaman.csv bas + ofs) once son
 * ornek. Dinlenme: adim bitisinden (bit + ofs) en az DINLENME_MIN_SN sonra ve sonraki adim baslamadan once son ornek.
 */
/**
 * 2026-11-04 (inceleme B5): hedef sunucu_ kesitinde [a, b] (hedef saati) arasinda worker kumesi degisti mi: 'shutting down'
 * worker (k > 0) ya da pid kumesi farkli ornek. Kesit / ornek yoksa null (olculmedi).
 */
function isciDegisti(ctx, kesitAdi, a, b) {
  const k = ctx.kesitler.find((x) => x.anahtar === kesitAdi);
  if (!k) return null;
  const lo = Math.min(a, b) - 0.5;
  const hi = Math.max(a, b) + 0.5;
  const ic = k.ornekler.filter((o) => lo <= o.t && o.t <= hi);
  if (!ic.length) return null;
  return ic.some((o) => o.k > 0 || o.p !== ic[0].p);
}

function bdetayOlc(ctx, kesitAdi, w0, w1, zaman, ofs) {
  if (!kesitAdi || w0 === null || w1 === null || !(w1 > w0)) return null;
  const k = ctx.bdetayKesitler.find((x) => x.anahtar === kesitAdi);
  if (!k || !k.ornekler.length) return null;
  const ic = k.ornekler.filter((x) => w0 <= x.t && x.t <= w1);
  if (!ic.length) return null;
  const bg = dolu(ic, 'bg');
  const o = {
    t0: ic[0].t,
    anon_ort_mb: ortVeyaNull(dolu(ic, 'an').map(MB)),
    pss_ort_mb: ortVeyaNull(dolu(ic, 'pss').map(MB)),
    baglanti_ort: ortVeyaNull(bg),
    baglanti_max: enBuyuk(bg),
    isci_max: enBuyuk(dolu(ic, 'n')),
    kapanan_max: enBuyuk(dolu(ic, 'k')),
    taban: null,
    son: bdNokta(ic[ic.length - 1]),
    dinlenme: null,
    dinlenme_sn: null,
    taban_isci_degisti: null,
    dinlenme_isci_degisti: null,
  };
  if (zaman && ofs !== null) {
    const bas = zaman[0] + ofs;
    const bit = zaman[1] + ofs;
    let taban = null;
    for (const x of k.ornekler) if (x.t <= bas) taban = x;
    o.taban = bdNokta(taban);
    if (taban) {
      const td = isciDegisti(ctx, kesitAdi, taban.t, o.son.t);
      o.taban_isci_degisti = (taban.k ?? 0) > 0 || td === true ? true : td;
    }
    let sonraki = null;
    for (const z of ctx.zamanTum) if (z[1] > zaman[1] && (sonraki === null || z[1] < sonraki)) sonraki = z[1];
    let din = null;
    for (const x of k.ornekler) {
      if (x.t < bit + DINLENME_MIN_SN) continue;
      if (sonraki !== null && x.t >= sonraki + ofs) break;
      din = x;
    }
    if (din) {
      o.dinlenme = bdNokta(din);
      o.dinlenme_sn = din.t - bit;
      const dd = isciDegisti(ctx, kesitAdi, o.son.t, din.t);
      o.dinlenme_isci_degisti = (din.k ?? 0) > 0 || dd === true ? true : dd;
    }
  }
  return o;
}

/**
 * 2026-11-03 (bant genisligi, bilgi): bosta NIC tabani (ilk adim baslamadan once; >= AG_BOSTA_MIN_SN). Kesit yoksa null.
 * 2026-11-04 (inceleme B6): hedef kesiti hedef saatinde: sinir ilkBas + ofs (ilk adimin saat farki kestirimi); ofs null ise
 * hedef tabani verilmez (saat farki bilinmeden pencere ilk adimin yukune tasabilir). Yuk kesiti yuk makinesi saatinde.
 */
function agBosta(ctx, ilkBas, ofs = null) {
  if (ilkBas === null) return null;
  const olc = (k, kay) => {
    if (!k || kay === null) return null;
    const p = nicPencere(k.ornekler, -Infinity, ilkBas + kay - 2);
    if (!p || p.sn < AG_BOSTA_MIN_SN) return null;
    return { rx_bps: p.rx_ort_bps, tx_bps: p.tx_ort_bps, sn: p.sn, ...agKesitBilgisi(k) };
  };
  const enUzun = (ks) => ks.reduce((a, k) => (a && a.ornekler.length >= k.ornekler.length ? a : k), null);
  const o = { hedef: olc(enUzun(ctx.agHedef), ofs), yuk: olc(enUzun(ctx.agYuk), 0) };
  return o.hedef || o.yuk ? o : null;
}

/** Kosu disi (dislama araliklari disi, kapanan worker yok, ayni pid kumesi) >= 8 sn bloklarin medyani. */
function arkaPlan(ornekler, dislama, clk) {
  const disarida = (o) => o.k === 0 && !dislama.some(([a, b]) => a <= o.t && o.t <= b);
  const bloklar = [];
  let cur = [];
  for (const o of ornekler) {
    const d = disarida(o);
    if (d && (!cur.length || cur[cur.length - 1].p === o.p)) {
      cur.push(o);
      continue;
    }
    if (cur.length >= 2) bloklar.push(cur);
    cur = d ? [o] : [];
  }
  if (cur.length >= 2) bloklar.push(cur);
  const us = [];
  const ss = [];
  let sure = 0.0;
  for (const b of bloklar) {
    const dt = b[b.length - 1].t - b[0].t;
    if (dt < 8) continue;
    us.push(((b[b.length - 1].u - b[0].u) * 1000.0) / clk / dt);
    ss.push(((b[b.length - 1].s - b[0].s) * 1000.0) / clk / dt);
    sure += dt;
  }
  if (!us.length) return null;
  return { user: medyan(us), sys: medyan(ss), blok: us.length, sn: sure };
}

/** DB'den gelen eski satirdaki negatif CPU-ms/istek (sayac sifirlanmasi) karara girmez. */
function negatifseNull(x) {
  return x !== null && x < 0 ? null : x;
}

/**
 * Reload olaylari (PORTAL FARKLARI 11): kaydedici orneklerinde worker PID kumesinin degistigi ya da
 * 'shutting down' worker goruldugu ardisik ornek dizileri. Her olay: ilk goruldugu ornek (t), ondan
 * onceki degismemis ornek (t_once; kayit olayin icinde basladiysa null), son ornek (t_son), worker
 * sayilari, TUR ve faz, [t, t_son] araligina (gozlenen olay) degen TUR'lar. Faz (ilk tutan):
 *   a. olayin kaniti (bitisik farkli-PID cifti [a.t, b.t] ya da k > 0 ornegi) ayni kesitte bir TUR'un CPU
 *      penceresinin [w0, w1] icinde -> o TUR (w0'a gore ilk) ve 'olcum' (pencereCpu.reload ile esdeger)
 *   b. [t, t_son] bir TUR'un olcum fazina [bas + isinma, bit] degiyor -> o TUR ve 'olcum_kenari'
 *   c. aksi o an suren TUR ve fazi (isinma) ya da onceki TUR'un 'bosluk'u ya da 'kosu_oncesi'.
 * `pencereler`: Map(tur -> { w0, w1, kesit }) (kosuHesapla r._cpu_pencere; yalniz CPU penceresi kurulan
 * TUR'lar). Kesit basina en cok MAX_RELOAD_KESIT, toplamda MAX_RELOAD olay; zamana gore sirali. Serbest
 * hedefte kesit yok -> [].
 */
const MAX_RELOAD_KESIT = 20;
const MAX_RELOAD = 50;
function reloadOlaylari(ctx, pencereler = new Map()) {
  const turlar = ctx.zamanTum.slice().sort((a, b) => a[1] - b[1]);
  const isinma = (tur) => {
    const ist = ctx.istemci.get(tur) || ctx.hatali.get(tur);
    const v = ist ? sayi(ist.isinma_sn) : null;
    return v === null ? 0 : v;
  };
  const yerlestir = (t) => {
    let onceki = null;
    for (const [tur, b, e] of turlar) {
      if (b <= t && t <= e) return { tur, faz: t < b + isinma(tur) ? 'isinma' : 'olcum_kenari' };
      if (e < t) onceki = tur;
    }
    return onceki ? { tur: onceki, faz: 'bosluk' } : { tur: null, faz: 'kosu_oncesi' };
  };
  const tum = [];
  for (const k of ctx.kesitler) {
    const o = k.ornekler || [];
    const olaylar = [];
    let cur = null;
    const kapat = () => {
      if (cur && olaylar.length < MAX_RELOAD_KESIT) olaylar.push(cur);
      cur = null;
    };
    for (let i = 0; i < o.length; i++) {
      const b = o[i];
      const a = i > 0 ? o[i - 1] : null;
      const pidDegisti = a !== null && a.p !== b.p;
      const degisti = pidDegisti || b.k > 0;
      if (!degisti) {
        kapat();
        continue;
      }
      if (!cur) {
        cur = {
          kesit: k.anahtar, t: b.t, t_once: a ? a.t : null, t_son: b.t,
          worker_once: a ? a.n : null, worker_sonra: b.n, kapanan_en_cok: b.k || 0, _kanit: [],
        };
      } else {
        cur.t_son = b.t;
        cur.worker_sonra = b.n;
        if (b.k > cur.kapanan_en_cok) cur.kapanan_en_cok = b.k;
      }
      if (pidDegisti) cur._kanit.push({ t0: a.t, t1: b.t });
      if (b.k > 0) cur._kanit.push({ t0: b.t, t1: b.t });
    }
    kapat();
    tum.push(...olaylar);
  }
  tum.sort((x, y) => x.t - y.t);
  // CPU pencereleri baslangica (w0) gore; esitlikte TUR adi (kararli sira).
  const pencereListesi = [...pencereler].filter(([, p]) => p && Number.isFinite(p.w0) && Number.isFinite(p.w1))
    .sort(([ta, a], [tb, b]) => a.w0 - b.w0 || (ta < tb ? -1 : ta > tb ? 1 : 0));
  return tum.slice(0, MAX_RELOAD).map((x) => {
    const { _kanit: kanit, ...olay } = x;
    // a. Kanit bir TUR'un CPU penceresinde: pencereCpu o adimi reload'la dusurdu -> 'olcum'.
    const cpu = pencereListesi.find(([, p]) => p.kesit === x.kesit && kanit.some((k) => p.w0 <= k.t0 && k.t1 <= p.w1));
    // b. Olcum fazina degiyor ama CPU penceresinin disinda (ilk / son saniyeler) -> 'olcum_kenari'.
    const kenar = cpu ? null : turlar.find(([tur, b, e]) => b + isinma(tur) <= x.t_son && x.t <= e);
    let y;
    if (cpu) y = { tur: cpu[0], faz: 'olcum' };
    else if (kenar) y = { tur: kenar[0], faz: 'olcum_kenari' };
    else y = yerlestir(x.t);
    const etkilenen = [...new Set(turlar.filter(([, b, e]) => b <= x.t_son && x.t <= e).map(([tur]) => tur))];
    return { ...olay, tur: y.tur, faz: y.faz, etkilenen_turlar: etkilenen };
  });
}

function kosuAyir(tur, ist) {
  const p = tur.split('_');
  const alti = p.length >= 6;
  return {
    adim: ist.adim || (alti ? p[0] : ''),
    senaryo: ist.senaryo || (alti ? p[1] : ''),
    kip: ist.kip || (alti ? p[2] : ''),
    ae: ist.ae || (alti ? p[3] : ''),
    hiz: Math.trunc(sayi(ist.hiz) || (alti ? sayi(p[4]) : 0) || 0),
  };
}

/** Kosu araliklari (+ -2/+8 sn): log denemeleri ve zaman.csv satirlari. TLS saat farki Portal'da yok. */
function dislamaListesi(ctx) {
  const d = [];
  for (const k of ctx.log.values()) {
    const denemeler = new Map();
    for (let i = 0; i < k.n; i++) {
      const anahtar = Number.isNaN(k.d[i]) ? 'yok' : k.d[i];
      const t = k.t[i];
      const x = denemeler.get(anahtar);
      if (!x) denemeler.set(anahtar, [t, t]);
      else {
        if (t < x[0]) x[0] = t;
        if (t > x[1]) x[1] = t;
      }
    }
    for (const [a, b] of denemeler.values()) d.push([a - 2, b + 8]);
  }
  for (const [, b, e] of ctx.zamanTum) d.push([b - 2, e + 8]);
  return d;
}

/**
 * Ayni TUR durup tekrar kosulduysa logda iki denemenin satirlari olur: yalniz istemci csv'sinin
 * denemesi (yoksa en son deneme) kullanilir. Deneme kolonu yoksa hepsi. Doner: { idx, hedef }.
 */
function denemeSec(ctx, tur, ist, uyari) {
  const k = ctx.log.get(tur);
  const n = k ? k.n : 0;
  const kume = new Set();
  for (let i = 0; i < n; i++) if (!Number.isNaN(k.d[i])) kume.add(k.d[i]);
  const denemeler = [...kume].sort((a, b) => a - b);
  if (!denemeler.length) {
    if (n && (ctx.zamanN.get(tur) || 0) > 1) uyari.push("tekrar_kosu_ayristirilamadi(log'da_deneme_kolonu_yok)");
    const idx = new Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    return { idx, hedef: null };
  }
  const istD = sayi(ist.deneme);
  const hedef = istD !== null ? Math.trunc(istD) : denemeler[denemeler.length - 1];
  const idx = [];
  for (let i = 0; i < n; i++) if (k.d[i] === hedef) idx.push(i);
  if (idx.length < n) uyari.push(`tekrar_kosu:deneme_${fd(hedef)}_kullanildi(${n - idx.length}_eski_satir_atildi)`);
  return { idx, hedef };
}

/**
 * karsilastir.py `kosu_hesapla`. Python'un `r` sozlugu + Portal icin birkac ek alan (_ onekli).
 * Serbest hedefte (ctx.serbest; ctx'te kesit / log zaten bos) olcum penceresi kurulmaz, sunucu
 * verisine dayanan alanlar null, ilgili TUR uyarilari yok (PORTAL FARKLARI 8). rc etiketi ctx.rcEtiketi.
 */
function kosuHesapla(ctx, tur, ist, arkaKesit) {
  const r = { tur };
  Object.assign(r, kosuAyir(tur, ist));
  for (const k of ISTEMCI_SAYI) r[k] = sayi(ist[k]);
  r.sikistirma_turu = ist.sikistirma_turu !== undefined ? ist.sikistirma_turu : '';
  const gecersiz = [];
  const uyari = [];
  const sec = denemeSec(ctx, tur, ist, uyari);
  r.deneme = sec.hedef;
  const kayit = ctx.log.get(tur);
  const satirlar = sec.idx;
  const olcum = kayit ? satirlar.filter((i) => kayit.faz[i] === ctx.olcumKod) : [];
  const zaman = ctx.zaman.get(tur);
  if (zaman && zaman[2] !== '' && zaman[2] !== '0') gecersiz.push(`${ctx.rcEtiketi}=${zaman[2]}`);
  let w0 = null;
  let w1 = null;
  let kaynak;
  // 2026-11-03 (bellek ayrisimi, bilgi): hedef saati - yuk makinesi saati kestirimi (log penceresi; istemci saati: 0).
  let saatFarki = null;
  if (olcum.length >= 10) {
    let mn = Infinity;
    let mx = -Infinity;
    for (const i of olcum) {
      const t = kayit.t[i];
      if (t < mn) mn = t;
      if (t > mx) mx = t;
    }
    w0 = mn + 3;
    w1 = mx - 2;
    kaynak = 'log';
    if (zaman && r.isinma_sn !== null) {
      const fark = mn - (zaman[0] + r.isinma_sn);
      if (Math.abs(fark - 2) > 10) uyari.push(`saat_farki~${fd(pyYuvarla(fark))}s(sunucu-istemci)`);
      if (Math.abs(fark - 2) <= SAAT_FARKI_TAVAN) saatFarki = fark - 2;
    }
  } else if (zaman && !ctx.logsuz) {
    const isinma = r.isinma_sn || 30;
    w0 = zaman[0] + isinma + 5;
    w1 = zaman[1] - 5;
    kaynak = 'istemci_saati';
    uyari.push('log_satiri_yok:pencere_istemci_saatinden');
    saatFarki = 0;
  } else {
    // Ne log ne zaman satiri var ya da serbest / nginx'siz hedef (sunucu logu yok): pencere kurulmaz.
    kaynak = '-';
  }
  r.pencere_kaynak = kaynak;
  for (const k of ['rps_sunucu', 'cpu_ms_istek', 'user_ms', 'sys_ms', 'cpu_oran_ms_sn', 'arka_ms_sn', 'host_cpu_ort',
    'host_cpu_max', 'pencere_sn', 'diger_rps']) r[k] = null;
  r._cpu_yok = null;
  r._cpu_pencere = null;
  const rts = [];
  const bls = [];
  const crs = [];
  let s5xx = 0;
  for (const i of olcum) {
    if (!Number.isNaN(kayit.rt[i])) rts.push(kayit.rt[i] * 1000.0);
    if (!Number.isNaN(kayit.bl[i])) bls.push(kayit.bl[i]);
    if (!Number.isNaN(kayit.cr[i])) crs.push(kayit.cr[i]);
    const dr = kayit.durum[i];
    if (dr >= 500 && dr < 600) s5xx++;
  }
  r.sunucu_rt_p50 = yuzdelik(rts, 50);
  r.sunucu_rt_p95 = yuzdelik(rts, 95);
  r.sunucu_rt_p99 = yuzdelik(rts, 99);
  r.n_log_olcum = ctx.logsuz ? null : olcum.length;
  r.govde_bayt_istek = bls.length ? pyToplam(bls) / bls.length : null;
  r['yeniden_baglanti_%'] = crs.length ? (100.0 * crs.filter((c) => c > 1).length) / crs.length : null;
  // 429 her fazda sayilir (k6 ilk 429'da kosuyu keser); 5xx yalniz olcum fazinda (istemci sayaci da oyle)
  let s429 = 0;
  for (const i of satirlar) if (kayit.durum[i] === 429) s429++;
  // Serbest / nginx'siz hedefte sunucu sayilmadi: nedende sunucu sayisi YOK (olculmedi, 0 degil).
  const sunucuda = (n) => (ctx.logsuz ? '' : `,sunucu=${n}`);
  if ((r.n_429 || 0) > 0 || s429) gecersiz.push(`429(istemci=${fd(r.n_429 || 0)}${sunucuda(s429)})`);
  if ((r.n_5xx || 0) > 0 || s5xx) gecersiz.push(`5xx(istemci=${fd(r.n_5xx || 0)}${sunucuda(s5xx)})`);
  // PORTAL FARKLARI 12: protokol kolonu varsa karar protokol_uyumsuz'dan; yoksa (eski satir) h1'de bugunku kural.
  const hamProt = typeof ist.protokol === 'string' ? ist.protokol.trim() : '';
  const prot = hamProt === 'h1' || hamProt === 'h2' ? hamProt : null;
  r.protokol = prot;
  r.protokol_uyumsuz = prot ? sayi(ist.protokol_uyumsuz) || 0 : null;
  if (prot === null) {
    // Bos istemci satiri (tamamlanmadi: hic sonuc yok) protokol hakkinda bir sey soylemez.
    if (ctx.protokol === 'h2') {
      if (Object.keys(ist).length) gecersiz.push('protokol_farkli(beklenen=h2,olculen=yok)');
    } else if ((r.http2 || 0) > 0) gecersiz.push('http2');
  } else if (prot !== ctx.protokol) {
    gecersiz.push(`protokol_farkli(beklenen=${ctx.protokol},olculen=${prot})`);
  } else if (r.protokol_uyumsuz > 0) {
    gecersiz.push(prot === 'h1' ? 'http2' : `h2_disi(${fd(r.protokol_uyumsuz)})`);
  }
  if ((r.hata_orani || 0) > HATA_ESIK + EPS) gecersiz.push(`hata_%${fx(100 * r.hata_orani, 2)}(>%${fx(100 * HATA_ESIK, 1)})`);
  if (r.n_olcum && !ctx.logsuz) {
    const fark = Math.abs(olcum.length - r.n_olcum) / r.n_olcum;
    r['log_istemci_fark_%'] = 100.0 * fark;
    if (satirlar.length && fark > LOG_ESIK_GECERSIZ) gecersiz.push(`log_istemci_farki_%${fx(100 * fark, 1)}`);
    if (!satirlar.length) uyari.push('sunucu_logunda_bu_tur_yok');
  } else {
    r['log_istemci_fark_%'] = null;
  }
  if (r.kip === 'yeni' && r['yeniden_baglanti_%'] !== null && r['yeniden_baglanti_%'] > 5) {
    uyari.push(`yeni_kipinde_baglanti_yeniden_kullanilmis_%${fx(r['yeniden_baglanti_%'], 0)}`);
  }
  if ((r.dropped || 0) > 0) uyari.push(`dropped_iterations=${fd(r.dropped)}`);
  let doyma = (r.dropped || 0) > 0;
  let kesitAdi = null;
  if (w0 !== null && w1 !== null && w1 > w0) {
    const kesit = kesitSec(ctx.kesitler, w0, w1);
    if (kesit === null) {
      uyari.push('sunucu_kaydi_yok');
    } else {
      kesitAdi = kesit.anahtar;
      const clk = clkAl(kesit);
      const pc = pencereCpu(kesit.ornekler, w0, w1, clk);
      if (pc !== null) r._cpu_pencere = { w0, w1, kesit: kesit.anahtar };
      const b = kesit.bilgi || {};
      for (const g of b.gecersiz || []) gecersiz.push('kayit:' + g);
      for (const nm of ['df_bas', 'df_bit']) {
        const v = sayi(b[nm]);
        if (v !== null && v >= DF_ESIK) {
          gecersiz.push(`disk_%${fd(v)}`);
          break;
        }
      }
      if (b.konf_hash_bas && b.konf_hash_bit && b.konf_hash_bas !== b.konf_hash_bit) gecersiz.push('konf_degisti');
      if (pc === null) {
        uyari.push('pencerede_ornek_yok');
      } else {
        r.pencere_sn = pc.dt;
        if (pc.dt < 30) gecersiz.push(`pencere_kisa(${fd(pc.dt)}s)`);
        if (pc.reload) gecersiz.push('reload(worker_pid_degisti)');
        r.host_cpu_ort = pc.host_ort;
        r.host_cpu_max = pc.host_max;
        if (pc.host_ort !== null && pc.host_ort > DOYMA_HOST_CPU) doyma = true;
        let ap = arkaKesit.get(kesit.anahtar);
        if (ap === null || ap === undefined) {
          uyari.push('arka_plan_yok(0_kabul)');
          ap = { user: 0.0, sys: 0.0, sn: 0 };
        } else if (ap.sn < 30) {
          uyari.push(`arka_plan_az(${fd(ap.sn)}s)`);
        }
        // PORTAL FARKLARI 10: worker sayaci pencere icinde sifirlandiysa (reload / kapanan worker) ya da
        // geriye gittiyse CPU hesaplanmaz (null + uyari); karsilastir.py negatif deger yazardi.
        let cpuYok = pc.reload ? 'reload' : pc.user < 0 || pc.sys < 0 ? 'sayac_geriledi' : null;
        r.cpu_oran_ms_sn = cpuYok ? null : pc.user + pc.sys;
        r.arka_ms_sn = ap.user + ap.sys;
        const f0 = Math.floor(pc.t0);
        const f1 = Math.floor(pc.t1);
        let rps;
        if (kaynak === 'log' && f1 > f0) {
          let n = 0;
          for (const i of olcum) {
            const t = kayit.t[i];
            if (f0 <= t && t < f1) n++;
          }
          rps = n / (f1 - f0);
          // range(f0, f1) uzerinden toplam; bozuk bir damga dev bir araliga yol acmasin diye kisa yoldan.
          let toplam = 0;
          if (f1 - f0 > ctx.diger.size) {
            for (const [t, adet] of ctx.diger) if (f0 <= t && t < f1) toplam += adet;
          } else {
            for (let t = f0; t < f1; t++) toplam += ctx.diger.get(t) || 0;
          }
          r.diger_rps = toplam / (f1 - f0);
        } else {
          rps = r.rps_gercek;
        }
        r.rps_sunucu = rps;
        if (rps && !cpuYok) {
          const netUser = pc.user - ap.user;
          const netSys = pc.sys - ap.sys;
          if (netUser + netSys < 0) {
            cpuYok = 'net_negatif';
          } else {
            r.user_ms = netUser / rps;
            r.sys_ms = netSys / rps;
            r.cpu_ms_istek = (netUser + netSys) / rps;
          }
        }
        r._cpu_yok = cpuYok;
        if (cpuYok) uyari.push(`cpu_olculemedi(${cpuYok})`);
        if (r.diger_rps && rps && r.diger_rps > 0.02 * rps) uyari.push(`diger_trafik_%${fx((100 * r.diger_rps) / rps, 0)}`);
      }
    }
  }
  if (r.adim.toLowerCase().includes('perf')) uyari.push('perf_ek_yuku(kararda_kullanilmaz)');
  // Nginx'siz sunucu hedefi: genel CPU (hedefcpu_*). Yalniz host CPU ve DOYMA (> %90); cpu_ms_istek / kapasite null kalir.
  // Kesit penceresi hedef NIC olcumune de gider (agOlc `genelKesit`).
  let genelKesit = null;
  if (ctx.genelCpu && ctx.hedefCpuKesitler.length) {
    const hc = hedefHostCpu(ctx.hedefCpuKesitler, zaman, r.isinma_sn);
    if (hc === null) {
      if (Object.keys(ist).length) uyari.push('hedef_cpu_olculemedi');
    } else {
      r.host_cpu_ort = hc.ort;
      r.host_cpu_max = hc.max;
      genelKesit = hc.kesit;
      if (hc.ort > DOYMA_HOST_CPU) doyma = true;
    }
  }
  // 2026-11-03 (K3): yuk makinesi CPU'su (serbest hedefte de; yuk makinesi ayni makine). Kayit yoksa null, isaret yok.
  r.yuk_cpu_bosta = yukBostaCpu(ctx.yukKesitler, zaman, r.isinma_sn);
  r.yuk_doydu = r.yuk_cpu_bosta !== null && r.yuk_cpu_bosta < YUK_BOSTA_ESIK;
  // B2: yalniz yuk makinesi doymussa (hedef tarafi doyma yok) hedefin CPU-ms/istek'i gecerli kalir (grupHesapla).
  r.yuk_doyma_yalniz = r.yuk_doydu && !doyma;
  if (r.yuk_doydu) doyma = true;
  // 2026-11-03 (bilgi): bellek (yalniz olcum varsa; uyarisi TUR uyarisi) ve istemci JSON kodlama sayaclari.
  r._bellek = bellekOlc(ctx, kesitAdi, w0, w1, zaman, r.isinma_sn, uyari);
  r._kodlama = ctx.kodlama.get(tur) || null;
  // 2026-11-03 (bilgi): bant genisligi (uyarisi TUR uyarisi) ve bellek ayrisimi (yalniz olcum varsa).
  r._ag = agOlc(ctx, tur, kesitAdi, w0, w1, zaman, r.isinma_sn, uyari, genelKesit);
  r._bdetay = bdetayOlc(ctx, kesitAdi, w0, w1, zaman, saatFarki);
  r._saatFarki = saatFarki;
  r.durum = gecersiz.length ? 'GECERSIZ' : doyma ? 'DOYMA' : 'GECERLI';
  r.gecersiz_nedeni = gecersiz.join(';');
  r.uyari = uyari.join(';');
  r._gecersiz = gecersiz;
  r._uyari = uyari;
  r._s429 = ctx.logsuz ? null : s429;
  r._s5xx = ctx.logsuz ? null : s5xx;
  r._kesit = kesitAdi;
  return r;
}

// ---------------------------------------------------------------------------------------------
// Gruplama (tekrar ortalamasi) ve karar
// ---------------------------------------------------------------------------------------------

/** karsilastir.py `grupla`nin tek grup hesabi. `rs` = ayni (adim, senaryo, kip, ae, hiz) kosulari. */
function grupHesapla(rs) {
  const gecerli = rs.filter((r) => r.durum !== 'GECERSIZ');
  // 2026-11-03 (B2): yalniz yuk makinesi doymus adim (hedef tarafi doyma yok) CPU kumesinde KALIR: CPU-ms/istek hedefin
  // olcusudur. Isaretsiz kosularda yuk_doyma_yalniz hic yok (cikti BIREBIR eskisi).
  const cpuKume = gecerli.filter((r) => (r.durum === 'GECERLI' || r.yuk_doyma_yalniz === true) && !String(r.adim).toLowerCase().includes('perf'));
  // 2026-11-03 (K3): yuk makinesi doymus adim (YUK_DOYDU) p95 / gecikme ortalamasina girmez. Isaretsiz kosularda
  // olcumKume === gecerli (cikti BIREBIR eskisi).
  const olcumKume = gecerli.some((r) => r.yuk_doydu) ? gecerli.filter((r) => !r.yuk_doydu) : gecerli;
  const o = { n_kosu: rs.length, n_gecerli: gecerli.length };
  for (const k of GRUP_ORTALAMA) o[k] = ortalama(olcumKume.map((r) => r[k]));
  const hm = gecerli.map((r) => r.host_cpu_max).filter((x) => x !== null && x !== undefined);
  o.host_cpu_max = hm.length ? hm.reduce((a, b) => pyMax(a, b)) : null;
  for (const k of ['cpu_ms_istek', 'user_ms', 'sys_ms']) o[k] = ortalama(cpuKume.map((r) => r[k]));
  o.gurultu_cpu = gurultu(cpuKume.map((r) => r.cpu_ms_istek));
  o.gurultu_p95 = gurultu(olcumKume.map((r) => r.p95));
  o.n_429 = rs.reduce((t, r) => t + (r.n_429 || 0), 0);
  o.n_5xx = rs.reduce((t, r) => t + (r.n_5xx || 0), 0);
  o.hata_max = rs.length ? rs.map((r) => r.hata_orani || 0).reduce((a, b) => pyMax(a, b)) : 0;
  o.gecersizler = rs.filter((r) => r.durum === 'GECERSIZ').map((r) => r.gecersiz_nedeni);
  o.doyma = rs.some((r) => r.durum === 'DOYMA');
  if (olcumKume !== gecerli) o.yuk_doydu = gecerli.length - olcumKume.length;
  o.kosular = rs;
  if (!gecerli.length) o.durum = `GECERSIZ(${rs.length}/${rs.length})`;
  else if (gecerli.length < rs.length) o.durum = `KISMI(${gecerli.length}/${rs.length} gecerli)`;
  else o.durum = o.doyma ? 'DOYMA' : 'GECERLI';
  return o;
}

/** karsilastir.py `grupla`: anahtar (adim, senaryo, kip, ae, hiz), ilk gorulme sirasi. */
function grupla(kosular) {
  const gruplar = new Map();
  for (const r of kosular) {
    const anahtar = JSON.stringify([r.adim, r.senaryo, r.kip, r.ae, r.hiz]);
    if (!gruplar.has(anahtar)) gruplar.set(anahtar, { adim: r.adim, senaryo: r.senaryo, kip: r.kip, ae: r.ae, hiz: r.hiz, rs: [] });
    gruplar.get(anahtar).rs.push(r);
  }
  return [...gruplar.values()].map((g) => ({ adim: g.adim, senaryo: g.senaryo, kip: g.kip, ae: g.ae, hiz: g.hiz, o: grupHesapla(g.rs) }));
}

/** Tek kosunun (adimin) bir senaryo/kip/ae birlesimindeki gruplari: hiz -> grup (ilk gorulme sirasi). */
function hizGruplari(kosular, kombo) {
  const secili = kosular.filter((r) => r.senaryo === kombo.senaryo && r.kip === kombo.kip && r.ae === kombo.ae);
  const m = new Map();
  for (const g of grupla(secili)) if (!m.has(g.hiz)) m.set(g.hiz, g.o);
  return m;
}

function yeterliMi(g) {
  return g.n_gecerli >= Math.min(2, g.n_kosu);
}

function nedenMetni(kosular) {
  return kosular.filter((k) => k.durum === 'GECERSIZ').map((k) => `${k.tur}(${k.gecersiz_nedeni})`).join('; ');
}

const KOMBO_SIRA = { senaryo: ['K', 'B'], kip: ['yeni', 'ka'], ae: ['br', 'gzip', 'identity'] };
function komboSirasi(a, b) {
  for (const k of ['senaryo', 'kip', 'ae']) {
    const ia = KOMBO_SIRA[k].indexOf(a[k]);
    const ib = KOMBO_SIRA[k].indexOf(b[k]);
    const x = (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    if (x) return x;
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  }
  return 0;
}

function komboSec(ref, ady) {
  const kombo = (r) => ({ senaryo: r.senaryo, kip: r.kip, ae: r.ae });
  const ad = (k) => `${k.senaryo}|${k.kip}|${k.ae}`;
  const rk = new Map(ref.map((r) => [ad(r), kombo(r)]));
  const ak = new Map(ady.map((r) => [ad(r), kombo(r)]));
  const varsayilan = { senaryo: 'K', kip: 'yeni', ae: 'br' };
  const v = ad(varsayilan);
  if (rk.has(v) && ak.has(v)) return varsayilan;
  const ortak = [...rk.keys()].filter((k) => ak.has(k)).map((k) => rk.get(k));
  if (ortak.length) return ortak.sort(komboSirasi)[0];
  if (rk.has(v) || ak.has(v) || (!rk.size && !ak.size)) return varsayilan;
  return [...ak.values(), ...rk.values()].sort(komboSirasi)[0];
}

function jsonNesne(x) {
  if (x && typeof x === 'object' && !Array.isArray(x)) return x;
  if (typeof x === 'string' && x.trim()) {
    try {
      const v = JSON.parse(x);
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch {
      return {};
    }
  }
  return {};
}

function jsonDizi(x) {
  if (Array.isArray(x)) return x;
  if (typeof x === 'string' && x.trim()) {
    try {
      const v = JSON.parse(x);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** DOYMA nedenlerinin HEPSI yuk makinesi (doyma:yuk_cpu_bosta_): hedef tarafi doyma yok. */
function yukDoymaYalniz(nedenler) {
  const d = nedenler.filter((n) => typeof n === 'string' && n.startsWith('doyma:'));
  return d.length > 0 && d.every((n) => n.startsWith(YUK_DOYMA_ONEKI));
}

function al(s, k) {
  if (s[k] !== undefined) return s[k];
  return s[k.replace(/_([a-z0-9])/g, (_m, c) => c.toUpperCase())];
}

/**
 * Adim satirlarini (kosuAnaliz ciktisi ya da nginx_loadtest_adimlar DB satiri; snake_case ya da
 * camelCase; ham/nedenler JSON metni olabilir) Python `r` bicimine cevirir. HATALI satirlar
 * (ve bilinmeyen gecerlilik) karara girmez: Python onlari hic gormezdi.
 */
function kosulariHazirla(satirlar) {
  if (!Array.isArray(satirlar)) return [];
  const out = [];
  for (const s of satirlar) {
    if (!s || typeof s !== 'object') continue;
    const durum = String(al(s, 'gecerlilik') || '');
    if (durum !== 'GECERLI' && durum !== 'DOYMA' && durum !== 'GECERSIZ') continue;
    const ham = jsonNesne(al(s, 'ham'));
    const nedenler = jsonDizi(al(s, 'nedenler'));
    const tur = String(al(s, 'tur') || '');
    const p = tur.split('_');
    const gecersizNedeni = typeof ham.gecersiz_nedeni === 'string'
      ? ham.gecersiz_nedeni
      : nedenler.filter((n) => typeof n === 'string' && !n.startsWith('doyma:')).join(';');
    out.push({
      tur,
      adim: String(ham.adim || (p.length >= 6 ? p[0] : '')),
      senaryo: String(al(s, 'senaryo') || ''),
      kip: String(al(s, 'kip') || ''),
      ae: String(al(s, 'ae') || ''),
      hiz: Math.trunc(sayi(al(s, 'hiz')) || 0),
      durum,
      gecersiz_nedeni: gecersizNedeni,
      rps_gercek: sayi(al(s, 'gercek_rps')),
      p50: sayi(al(s, 'p50')),
      p95: sayi(al(s, 'p95')),
      p99: sayi(al(s, 'p99')),
      ttfb_p95: sayi(al(s, 'ttfb_p95')),
      tls_p95: sayi(al(s, 'tls_p95')),
      hata_orani: sayi(al(s, 'hata_orani')),
      sunucu_rt_p95: sayi(al(s, 'srt_p95')),
      bayt_istek: sayi(al(s, 'bayt_istek')),
      govde_bayt_istek: sayi(ham.govde_bayt_istek),
      host_cpu_ort: sayi(al(s, 'host_cpu_ort')),
      p95_buyuk: sayi(ham.p95_buyuk),
      diger_rps: sayi(ham.diger_rps),
      host_cpu_max: sayi(ham.host_cpu_max),
      cpu_ms_istek: negatifseNull(sayi(al(s, 'cpu_ms_istek'))),
      user_ms: sayi(ham.user_ms),
      sys_ms: sayi(ham.sys_ms),
      n_429: sayi(al(s, 'n_429')),
      n_5xx: sayi(al(s, 'n_5xx')),
      yuk_doydu: durum === 'DOYMA' && nedenler.some((n) => typeof n === 'string' && n.startsWith(YUK_DOYMA_ONEKI)),
      yuk_doyma_yalniz: durum === 'DOYMA' && yukDoymaYalniz(nedenler),
    });
  }
  return out;
}

function grupOzeti(o) {
  const x = {};
  for (const [k, v] of Object.entries(o)) if (k !== 'kosular') x[k] = Array.isArray(v) ? v.slice() : v;
  x.turlar = o.kosular.map((r) => r.tur);
  return x;
}

function tabloYap(rG, aG) {
  const hizlar = [...new Set([...rG.keys(), ...aG.keys()])].sort((a, b) => a - b);
  return hizlar.map((h) => {
    const r = rG.get(h) || null;
    const a = aG.get(h) || null;
    const fark = {};
    for (const k of FARK_ALANLARI) {
      const v = r && a ? oran(a[k], r[k]) : null;
      fark[k] = v === null ? null : 100 * v;
    }
    return { hiz: h, ref: r && grupOzeti(r), aday: a && grupOzeti(a), fark_yuzde: fark };
  });
}

function secenekSayi(x, varsayilan) {
  const v = sayi(x);
  return v === null ? varsayilan : v;
}

function kademeSec(x, varsayilan) {
  const v = sayi(x);
  return v === null ? varsayilan : Math.trunc(v);
}

/** Metin secenegi (motor / hedef turu): verilmediyse varsayilan; izinli degil ise TypeError (sessiz varsayim yok). */
function secenekDegeri(x, varsayilan, izinli, ad) {
  if (x === undefined) return varsayilan;
  if (izinli.includes(x)) return x;
  throw new TypeError(`kararVer: ${ad} gecersiz (${izinli.join(' | ')})`);
}

/**
 * wrk is parcacigi sayisi ve hiz tavani (tavan_rps): null / verilmedi = bilinmiyor (karsilastirilmaz);
 * pozitif tam sayi degilse TypeError.
 */
function isParcacigiDegeri(x, ad) {
  if (x === undefined || x === null) return null;
  const v = sayi(x);
  if (v === null || !Number.isInteger(v) || v < 1) throw new TypeError(`kararVer: ${ad} gecersiz (pozitif tam sayi ya da null)`);
  return v;
}

/**
 * kararVer'in gurultu kurali (TEK kaynak; 2026-11-04 coklu karsilastirma da bunu kullanir): esik = max(esik% / 100,
 * 3 x referans gurultusu); gurultu bilinmiyorsa (tek tekrar) 0 kabul edilir. Python: max(esik / 100.0, 3 * g).
 */
function gurultuEsigi(esikYuzde, gurultuRef) {
  return pyMax(esikYuzde / 100.0, 3 * (gurultuRef || 0));
}

/**
 * Bir ortak kademenin p95 satiri ve zarari (zarar esigi = max(esikZarar, 3 x referans p95 gurultusu)).
 * 2026-11-03 (B2): taraflardan birinin p95'i yalniz YUK_DOYDU yuzunden yoksa (gecerli tekrarlarin hepsi yuk
 * makinesi doymus) kademe SESSIZ atlanmaz: satir yazilir ve kademe `yukAtlanan`a eklenir (cagiran KALICI vermez:
 * zarar yoksa DOYMA).
 */
function p95Satiri(sat, zarar, rg, ag, h, esikZarar, yukAtlanan) {
  const rp = rg.p95;
  const ap = ag.p95;
  if (rp && ap !== null) {
    const kotu = oran(ap, rp);
    const ez = gurultuEsigi(esikZarar, rg.gurultu_p95);
    sat.push(`p95 @${fd(h)}: ref=${fx(rp, 1)} aday=${fx(ap, 1)} degisim=%${fxs(100 * kotu, 1)} (zarar esigi %${fx(100 * ez, 1)})`);
    if (kotu > ez + EPS) zarar.push(`p95 @${fd(h)} %${fxs(100 * kotu, 1)}`);
    return;
  }
  if (((rg.yuk_doydu || 0) > 0 && rg.p95 === null) || ((ag.yuk_doydu || 0) > 0 && ag.p95 === null)) {
    sat.push(`p95 @${fd(h)}: yük makinesi doydu, karşılaştırılmadı`);
    if (yukAtlanan) yukAtlanan.push(h);
  }
}

/** B2: YUK_DOYDU yuzunden p95'i karsilastirilamayan kademe varsa karar KALICI OLAMAZ: zarar yoksa DOYMA (RET degismez). */
const YUK_DOYDU_KARARI = 'Yük makinesi doydu: p95 karşılaştırılamadı; yük makinesini rahatlatın ya da hızı düşürüp yeniden koşun';

/**
 * CPU kademesinin bayt/istek satiri. Ag maliyeti sunucu logundaki govde baytindan ($body_bytes_sent); yoksa
 * istemci yedegi: k6 data_received yeni kipte her istegin TLS el sikismasini (sertifika zinciri) ve
 * basliklarini da sayar, sikistirma farkini kucuk gosterir; wrk baslik + govde sayar, TLS haric.
 */
function baytSatiri(sat, notlar, rKc, aKc, kc, motor) {
  let rb = rKc.govde_bayt_istek;
  let ab = aKc.govde_bayt_istek;
  let kaynak = 'govde, sunucu logu';
  if (!rb || ab === null) {
    rb = rKc.bayt_istek;
    ab = aKc.bayt_istek;
    kaynak = motor === 'wrk' ? 'istemci (wrk): baslik + govde, TLS haric' : 'istemci data_received: TLS + baslik dahil, fark kucuk gorunur';
  }
  if (rb && ab !== null) {
    const bd = oran(ab, rb);
    sat.push(`bayt/istek @${fd(kc)} [${kaynak}]: ref=${fx(rb, 0)} aday=${fx(ab, 0)} degisim=%${fxs(100 * bd, 1)}`);
    if (bd > 0.12 + EPS) notlar.push(`ag maliyeti: bayt/istek %${fxs(100 * bd, 1)} (> %12)`);
  }
}

/** B (buyuk dosya) senaryosunun ortak kademelerinde TTFB p95 satirlari (bilgi; karara girmez). */
function bTtfbSatirlari(sat, ref, ady) {
  const bKombo = { senaryo: 'B', kip: 'yeni', ae: 'br' };
  const rB = hizGruplari(ref, bKombo);
  const aB = hizGruplari(ady, bKombo);
  for (const h of [...rB.keys()].filter((x) => aB.has(x)).sort((a, b) => a - b)) {
    const rt = rB.get(h).ttfb_p95;
    const at = aB.get(h).ttfb_p95;
    if (rt && at !== null) sat.push(`B (buyuk dosya) TTFB p95 @${fd(h)}: ref=${fx(rt, 1)} aday=${fx(at, 1)} degisim=%${fxs(100 * oran(at, rt), 1)}`);
  }
}

/**
 * CPU'suz karar yolu (PORTAL FARKLARI 9): ortak kademelerde bugunku p95 zarar hesabi (ayni esik, ayni
 * `p95 @..` satirlari) + bilgi satirlari (bayt, B TTFB). Zarar RET; yoksa NOTR + `cpuNotu`. CPU kazanci ve
 * p95 kazanci kurallari CPU olcusu ister: bu yol ASLA KALICI vermez.
 */
function cpusuzKarar(bitir, b, cpuNotu) {
  const { sat, notlar, ortak, rG, aG, kc, ref, ady, esikZarar, motor, birim } = b;
  if (!ortak.length) return bitir('VERI_YOK', [...sat, `ortak ${birim} kademesi yok`]);
  const zarar = [];
  const yukAtlanan = [];
  for (const h of ortak) p95Satiri(sat, zarar, rG.get(h), aG.get(h), h, esikZarar, yukAtlanan);
  const rKc = kc === null ? undefined : rG.get(kc);
  const aKc = kc === null ? undefined : aG.get(kc);
  if (rKc && aKc) baytSatiri(sat, notlar, rKc, aKc, kc, motor);
  bTtfbSatirlari(sat, ref, ady);
  const not = notlar.map((n) => 'not: ' + n);
  if (zarar.length) return bitir('RET', [...sat, 'zarar: ' + zarar.join('; '), ...not]);
  if (yukAtlanan.length) return bitir('DOYMA', [...sat, YUK_DOYDU_KARARI, ...not]);
  return bitir('NOTR', [...sat, cpuNotu, ...not]);
}

/**
 * Iki kosunun adim satirlari arasinda karar (karsilastir.py `karar_ver`). Motor / hedef turu / is
 * parcacigi / hiz tavani secenekleri kosu satirlarindan gelir (PORTAL FARKLARI 9); verilmezse k6 / sunucu /
 * null / null ve cikti bugunkuyle BIREBIR. Gecersiz motor / hedef turu / is parcacigi / tavan TypeError.
 * wrk'de ayni baglanti kademesi farkli tavanla (tavan_rps: hedefin olculmus limit_req'i ya da serbest 200)
 * farkli yuk demektir (Lua delay = N * 1000 / tavan): iki tavan biliniyor ve farkliysa VERI_YOK.
 * Protokol (PORTAL FARKLARI 12): farkli protokol (HTTP/1.1 / HTTP/2) VERI_YOK, motor kuralindan hemen sonra;
 * verilmezse 'h1' (eski satir), gecersiz deger TypeError.
 * @param {object[]} refAdimlar  referans kosunun adim satirlari
 * @param {object[]} adayAdimlar aday kosunun adim satirlari
 * @param {{esikCpu?: number, esikP95?: number, esikZarar?: number, kademeCpu?: number, kademeP95?: number,
 *   refMotor?: 'k6'|'wrk', adayMotor?: 'k6'|'wrk', refHedefTuru?: 'sunucu'|'serbest',
 *   adayHedefTuru?: 'sunucu'|'serbest', refIsParcacigi?: number|null, adayIsParcacigi?: number|null,
 *   refTavanRps?: number|null, adayTavanRps?: number|null, refProtokol?: 'h1'|'h2',
 *   adayProtokol?: 'h1'|'h2', refNginx?: boolean, adayNginx?: boolean}} [secenek]
 *   refNginx / adayNginx false (nginx olmayan sunucu hedefi): serbest kuralindan hemen sonra CPU'suz karar (CPU_YOK_NGINXSIZ).
 */
function kararVer(refAdimlar, adayAdimlar, secenek = {}) {
  const s = secenek || {};
  const esikCpu = secenekSayi(s.esikCpu, 10);
  const esikP95 = secenekSayi(s.esikP95, 10);
  const esikZarar = secenekSayi(s.esikZarar, 5);
  const refMotor = secenekDegeri(s.refMotor, 'k6', MOTORLAR, 'refMotor');
  const adayMotor = secenekDegeri(s.adayMotor, 'k6', MOTORLAR, 'adayMotor');
  const refTur = secenekDegeri(s.refHedefTuru, 'sunucu', HEDEF_TURLERI, 'refHedefTuru');
  const adayTur = secenekDegeri(s.adayHedefTuru, 'sunucu', HEDEF_TURLERI, 'adayHedefTuru');
  // TEK HEDEF MODELI (2026-11-13): nginx olmayan sunucu hedefinde CPU-ms yok (varsayilan true: cikti BIREBIR eskisi).
  const refNginx = s.refNginx === undefined ? true : s.refNginx;
  const adayNginx = s.adayNginx === undefined ? true : s.adayNginx;
  if (typeof refNginx !== 'boolean') throw new TypeError('kararVer: refNginx true | false olmali');
  if (typeof adayNginx !== 'boolean') throw new TypeError('kararVer: adayNginx true | false olmali');
  const refProtokol = secenekDegeri(s.refProtokol, 'h1', PROTOKOLLER, 'refProtokol');
  const adayProtokol = secenekDegeri(s.adayProtokol, 'h1', PROTOKOLLER, 'adayProtokol');
  const refIp = isParcacigiDegeri(s.refIsParcacigi, 'refIsParcacigi');
  const adayIp = isParcacigiDegeri(s.adayIsParcacigi, 'adayIsParcacigi');
  const refTavan = isParcacigiDegeri(s.refTavanRps, 'refTavanRps');
  const adayTavan = isParcacigiDegeri(s.adayTavanRps, 'adayTavanRps');
  const ref = kosulariHazirla(refAdimlar);
  const ady = kosulariHazirla(adayAdimlar);
  const refAd = (ref.find((r) => r.adim) || {}).adim || 'referans';
  const adyAd = (ady.find((r) => r.adim) || {}).adim || 'aday';
  const kombo = komboSec(ref, ady);
  const rG = hizGruplari(ref, kombo);
  const aG = hizGruplari(ady, kombo);
  const ortak = [...rG.keys()].filter((h) => aG.has(h)).sort((a, b) => a - b);
  const kc = kademeSec(s.kademeCpu, ortak.length ? ortak[Math.floor(ortak.length / 2)] : null);
  const kp = kademeSec(s.kademeP95, ortak.length ? ortak[ortak.length - 1] : null);
  const tablo = tabloYap(rG, aG);
  const bitir = (karar, satirlar) => ({ karar, nedenler: satirlar, tablo, kademe: { cpu: kc, p95: kp }, kombinasyon: kombo });
  // Kademe birimi: k6 acik dongu (istek/sn), wrk kapali dongu (baglanti sayisi). Motorlar asagida esit.
  const birim = refMotor === 'wrk' ? 'baglanti' : 'istek/sn';

  const sat = [];
  const adyKosular = [...aG.values()].flatMap((g) => g.kosular);
  sat.push(`referans=${refAd} aday=${adyAd} senaryo=${kombo.senaryo} kip=${kombo.kip} ae=${kombo.ae}`);
  if (refMotor !== adayMotor) {
    return bitir('VERI_YOK', [...sat, `farkli yuk araci: referans ${refMotor}, aday ${adayMotor}; k6 (acik dongu, istek/sn) ve wrk (kapali dongu, baglanti) sonuclari karsilastirilmaz`]);
  }
  if (refProtokol !== adayProtokol) {
    return bitir('VERI_YOK', [...sat, `farkli protokol: referans ${PROTOKOL_ADI[refProtokol]}, aday ${PROTOKOL_ADI[adayProtokol]}; ayni protokolle yeniden kosun`]);
  }
  if (refMotor === 'wrk' && refIp !== null && adayIp !== null && refIp !== adayIp) {
    return bitir('VERI_YOK', [...sat, `farkli is parcacigi sayisi: referans ${fd(refIp)}, aday ${fd(adayIp)}; ayni is parcacigi sayisiyla yeniden kosun`]);
  }
  // Ayni N, farkli tavan: kademe ayni sayida baglanti ama farkli sunulan yuk (dusuk tavanda p95 dusuk
  // cikar -> sahte KALICI / RET). CPU'suz (serbest) yoldan da ONCE: karisik kipte de gecerli.
  if (refMotor === 'wrk' && refTavan !== null && adayTavan !== null && refTavan !== adayTavan) {
    return bitir('VERI_YOK', [...sat, `farkli hiz tavani: referans ${fd(refTavan)} istek/sn, aday ${fd(adayTavan)} istek/sn; ayni tavanla yeniden kosun`]);
  }
  if (!aG.size || !rG.size) {
    return bitir('VERI_YOK', [...sat, `${kombo.senaryo}/${kombo.kip}/${kombo.ae} kosusu eksik (referans ${rG.size} kademe, aday ${aG.size} kademe)`]);
  }
  // Hata referansa gore kiyaslanir: ayni kademedeki referans kosularinin en yuksek hata orani + %0.1.
  // (Bayat bir yolun 404'u referansta da varsa aday RET olmaz; referansin kendisi asagida GECERSIZ olur.)
  const hata = [];
  for (const k of adyKosular) {
    const rg = rG.get(k.hiz);
    const refHata = rg ? rg.kosular.map((x) => x.hata_orani || 0).reduce((a, b) => pyMax(a, b)) : 0;
    if ((k.n_429 || 0) > 0 || (k.n_5xx || 0) > 0 || k.gecersiz_nedeni.includes('429(') || k.gecersiz_nedeni.includes('5xx(')
      || (k.hata_orani || 0) > refHata + HATA_ESIK + EPS) hata.push([k, refHata]);
  }
  if (hata.length) {
    return bitir('RET', [...sat,
      'hata artti: ' + hata.map(([k, rh]) => `${k.tur} 429=${fd(k.n_429 || 0)} 5xx=${fd(k.n_5xx || 0)} hata=%${fx(100 * (k.hata_orani || 0), 2)} (referans %${fx(100 * rh, 2)})`).join('; '),
      'not: 429 = rate limit (yuk ayari) olabilir; nedeni giderip adimi tekrar kosun.']);
  }
  const ekTekrar = (gruplar, hizlar) => Math.min(MAX_TEKRAR, Math.max(...hizlar.map((h) => gruplar.get(h).n_kosu)) + 1);
  const eksikR = ortak.filter((h) => !yeterliMi(rG.get(h)));
  if (eksikR.length) {
    return bitir('GECERSIZ', [...sat,
      `referans ${refAd} kullanilamaz: ${eksikR.join(',')} ${birim} kademesinde yeterli gecerli kosu yok (en az 2): ${nedenMetni(eksikR.flatMap((h) => rG.get(h).kosular))}`,
      `once referansi duzeltin (hata_ ise: yollar hala 200 mu?), sonra referansi tekrar=${ekTekrar(rG, eksikR)} ile yeniden kosun`]);
  }
  const eksikA = [...aG.keys()].sort((a, b) => a - b).filter((h) => !yeterliMi(aG.get(h)));
  if (eksikA.length) {
    return bitir('GECERSIZ', [...sat,
      'tekrar kosun: ' + nedenMetni(adyKosular),
      `${eksikA.join(',')} ${birim} kademesinde yeterli gecerli kosu yok (en az 2). Adayi tekrar=${ekTekrar(aG, eksikA)} ile yeniden kosun (GECERSIZ kosu kararda dislanir)`]);
  }
  const notlar = [];
  const dislanan = nedenMetni(adyKosular);
  if (dislanan) notlar.push(`dislanan GECERSIZ kosu: ${dislanan} (her kademede en az 2 gecerli kosu kaldi)`);
  const cpusuz = { sat, notlar, ortak, rG, aG, kc, ref, ady, esikZarar, motor: refMotor, birim };
  // Serbest hedefte CPU hic olculmez (kaydedici yok): CPU blogundan ONCE CPU'suz yol.
  if (refTur === 'serbest' || adayTur === 'serbest') return cpusuzKarar(bitir, cpusuz, CPU_YOK_SERBEST);
  if (!refNginx || !adayNginx) return cpusuzKarar(bitir, cpusuz, CPU_YOK_NGINXSIZ);
  const rKc = kc === null ? undefined : rG.get(kc);
  const aKc = kc === null ? undefined : aG.get(kc);
  if (!rKc || !aKc || !rKc.cpu_ms_istek || rKc.cpu_ms_istek <= 0 || aKc.cpu_ms_istek === null) {
    if (rKc && aKc) {
      const doyan = [];
      if (rKc.doyma && rKc.cpu_ms_istek === null) doyan.push(`referans ${refAd}`);
      if (aKc.doyma && aKc.cpu_ms_istek === null) doyan.push(`aday ${adyAd}`);
      // Yalniz yuk makinesi doymus tekrar CPU kumesinde kalir (B2): buraya hedef tarafi doyma ile gelinir.
      if (doyan.length) {
        return bitir('DOYMA', [...sat, `${fd(kc)} ${birim} kademesinde CPU-ms/istek yok: ${doyan.join(' ve ')} doydu (dropped>0 ya da host CPU>%90); daha dusuk bir kademeyle tekrar kosun`]);
      }
      // wrk + wrk: CPU doyma disi bir nedenle yok (kaydedici eksik) -> CPU'suz yol. k6 + k6 BUGUNKU gibi
      // VERI_YOK (karsilastir.py esdegerligi; sozlesme K25).
      if (refMotor === 'wrk') return cpusuzKarar(bitir, cpusuz, CPU_YOK_WRK);
    }
    return bitir('VERI_YOK', [...sat, kc === null ? `ortak ${birim} kademesi yok` : `${fd(kc)} ${birim} kademesinde CPU-ms/istek yok (sunucu kaydi?)`]);
  }
  let gCpu = rKc.gurultu_cpu;
  if (gCpu === null) {
    notlar.push('referansta tek tekrar: gurultu bilinmiyor (0 kabul)');
    gCpu = 0.0;
  }
  const esik1 = gurultuEsigi(esikCpu, gCpu);
  const cpuKazanc = -oran(aKc.cpu_ms_istek, rKc.cpu_ms_istek);
  sat.push(`CPU-ms/istek @${fd(kc)}: ref=${fx(rKc.cpu_ms_istek, 3)} aday=${fx(aKc.cpu_ms_istek, 3)} kazanc=%${fx(100 * cpuKazanc, 1)} esik=%${fx(100 * esik1, 1)} (gurultu %${fx(100 * gCpu, 1)})`);
  const zarar = [];
  const yukAtlanan = [];
  let cpuKotuMax = null;
  for (const h of ortak) {
    p95Satiri(sat, zarar, rG.get(h), aG.get(h), h, esikZarar, yukAtlanan);
    const rc = rG.get(h).cpu_ms_istek;
    const ac = aG.get(h).cpu_ms_istek;
    if (rc && ac !== null) {
      const v = oran(ac, rc);
      cpuKotuMax = cpuKotuMax === null ? v : pyMax(cpuKotuMax, v);
    }
  }
  const ezCpu = gurultuEsigi(esikZarar, gCpu);
  if (-cpuKazanc > ezCpu + EPS) zarar.push(`CPU-ms/istek @${fd(kc)} %${fxs(-100 * cpuKazanc, 1)}`);
  const kosul1 = esikGecti(cpuKazanc, esik1) && !zarar.length;
  let kosul2 = false;
  const rKp = kp === null ? undefined : rG.get(kp);
  const aKp = kp === null ? undefined : aG.get(kp);
  if (rKp && aKp && rKp.p95 && aKp.p95 !== null) {
    const esik2 = gurultuEsigi(esikP95, rKp.gurultu_p95);
    const p95Kazanc = -oran(aKp.p95, rKp.p95);
    kosul2 = esikGecti(p95Kazanc, esik2) && (cpuKotuMax === null || cpuKotuMax <= 0.05 + EPS);
    sat.push(`p95 kazanci @${fd(kp)}: %${fx(100 * p95Kazanc, 1)} esik=%${fx(100 * esik2, 1)}`);
  }
  if (Math.abs(cpuKazanc - esik1) <= 0.03) notlar.push('CPU kazanci esige 3 puandan yakin: 3. tekrar onerilir');
  baytSatiri(sat, notlar, rKc, aKc, kc, refMotor);
  bTtfbSatirlari(sat, ref, ady);
  let karar;
  if (zarar.length) {
    karar = 'RET';
    sat.push('zarar: ' + zarar.join('; '));
  } else if (yukAtlanan.length) {
    karar = 'DOYMA';
    sat.push(YUK_DOYDU_KARARI);
  } else if (kosul1 || kosul2) {
    karar = 'KALICI';
    sat.push('kural: ' + (kosul1 ? 'CPU kazanci esigi gecti ve zarar yok' : "p95 kazanci esigi gecti ve CPU %5'ten fazla kotulesmedi"));
  } else {
    karar = 'NOTR';
  }
  return bitir(karar, [...sat, ...notlar.map((n) => 'not: ' + n)]);
}

/**
 * 2026-11-04 coklu karsilastirma: bir kosunun adim satirlarindan (DB ya da analiz ciktisi) senaryo/kip/ae birlesimindeki
 * hiz gruplari (kararVer ile AYNI grupHesapla: ortalama, gurultu, n_kosu, hata_max ...). `kombo` verilmezse kosunun kendi
 * varsayilani (komboSec(k, k): K/yeni/br varsa o).
 * @returns {{ kombo: {senaryo: string, kip: string, ae: string}, gruplar: Map<number, object> }}
 */
function hizOzeti(adimlar, kombo = null) {
  const k = kosulariHazirla(adimlar);
  const kb = kombo || komboSec(k, k);
  return { kombo: kb, gruplar: hizGruplari(k, kb) };
}

/** farkDurumu'nun renklendirdigi olculer: yalniz kararVer'de kurali olanlar. */
const FARK_KURALLI = Object.freeze(['cpu_ms_istek', 'p95', 'hata_orani']);

/**
 * 2026-11-04 coklu karsilastirma: ayni hizdaki iki grubun (ref, aday; hizOzeti gruplari) bir olcudeki farki ve farkin
 * gurultu disi olup olmadigi. YENI KURAL YOK, kararVer'in kurallari hucre basina:
 *  - cpu_ms_istek: iyi = kazanc >= max(esikCpu, 3 x ref gurultu_cpu) (kosul1), kotu = artis > max(esikZarar, 3 x
 *    gurultu_cpu) (zarar); ref <= 0 ya da aday yok -> 'yok'.
 *  - p95: kotu = artis > max(esikZarar, 3 x gurultu_p95) (p95Satiri zarari), iyi = kazanc >= max(esikP95, 3 x gurultu_p95)
 *    (kosul2'nin esigi); ref p95 yok / 0 ya da aday yok -> 'yok'.
 *  - hata_orani: kotu = aday en yuksek hata > ref en yuksek hata + %0.1 ya da adayda 429 / 5xx (hata artti RET kurali:
 *    istemci sayaclari n_429 / n_5xx YA DA tekrarlardan birinin gecersiz_nedeni'nde sunucu tarafi '429(' / '5xx(' -
 *    kararVer ile birebir); aksi 'gurultu_ici' (kararVer'de hata iyilesmesi kurali yok: iyi rengi verilmez).
 *  - diger olculer: 'renklendirilmez' (kararVer'de kurali yok).
 * yuzde = (aday / ref - 1) x 100 (ref 0 / yok ise null). Gurultu bilinmiyorsa (tek tekrar) kararVer gibi 0 kabul edilir.
 * @returns {{ yuzde: number|null, durum: 'iyi'|'kotu'|'gurultu_ici'|'renklendirilmez'|'yok', esikYuzde: number|null,
 *   gurultuBilinmiyor: boolean }}
 */
function farkDurumu(olcu, rg, ag, secenek = {}) {
  const s = secenek || {};
  const esikCpu = secenekSayi(s.esikCpu, 10);
  const esikP95 = secenekSayi(s.esikP95, 10);
  const esikZarar = secenekSayi(s.esikZarar, 5);
  const alan = olcu === 'hata_orani' ? 'hata_max' : olcu;
  const r = rg ? sayi(rg[alan]) : null;
  const a = ag ? sayi(ag[alan]) : null;
  const v = oran(a, r);
  const sonuc = (durum, esik = null, gurultuBilinmiyor = false) => ({ yuzde: v === null ? null : 100 * v, durum, esikYuzde: esik === null ? null : 100 * esik, gurultuBilinmiyor });
  if (!rg || !ag) return sonuc('yok');
  if (olcu === 'cpu_ms_istek') {
    if (!r || r <= 0 || a === null) return sonuc('yok');
    const g = rg.gurultu_cpu;
    const kazanc = -v;
    const esik = gurultuEsigi(esikCpu, g);
    if (-kazanc > gurultuEsigi(esikZarar, g) + EPS) return sonuc('kotu', gurultuEsigi(esikZarar, g), g === null || g === undefined);
    if (esikGecti(kazanc, esik)) return sonuc('iyi', esik, g === null || g === undefined);
    return sonuc('gurultu_ici', esik, g === null || g === undefined);
  }
  if (olcu === 'p95') {
    if (!r || a === null) return sonuc('yok');
    const g = rg.gurultu_p95;
    const ez = gurultuEsigi(esikZarar, g);
    if (v > ez + EPS) return sonuc('kotu', ez, g === null || g === undefined);
    const esik = gurultuEsigi(esikP95, g);
    if (esikGecti(-v, esik)) return sonuc('iyi', esik, g === null || g === undefined);
    return sonuc('gurultu_ici', esik, g === null || g === undefined);
  }
  if (olcu === 'hata_orani') {
    if (r === null && a === null) return sonuc('yok');
    // kararVer gibi: sunucu tarafi 429 / 5xx (istemci sayaci 0 olsa da) gecersiz_nedeni'nde gorunur.
    const nedenler = Array.isArray(ag.kosular) ? ag.kosular.map((k) => k && k.gecersiz_nedeni) : (ag.gecersizler || []);
    const sunucuHata = nedenler.some((n) => typeof n === 'string' && (n.includes('429(') || n.includes('5xx(')));
    const kotu = (ag.n_429 || 0) > 0 || (ag.n_5xx || 0) > 0 || sunucuHata || (a || 0) > (r || 0) + HATA_ESIK + EPS;
    return sonuc(kotu ? 'kotu' : 'gurultu_ici', HATA_ESIK);
  }
  if (r === null || a === null) return sonuc('yok');
  return sonuc('renklendirilmez');
}

/**
 * T0 ayristirmasi (karsilastir.py `ayristirma`): ayni kademede K/yeni/br, K/ka/br ve K/yeni/identity
 * varsa CPU'yu TLS + TCP, sikistirma ve kalan olarak boler. Satirlar birden cok kosudan gelebilir.
 */
function ayristirma(adimlar, { kademe } = {}) {
  const k = kosulariHazirla(adimlar);
  const y = hizGruplari(k, { senaryo: 'K', kip: 'yeni', ae: 'br' });
  const ka = hizGruplari(k, { senaryo: 'K', kip: 'ka', ae: 'br' });
  const idn = hizGruplari(k, { senaryo: 'K', kip: 'yeni', ae: 'identity' });
  return ayristirmaGruplardan(y, ka, idn, kademe);
}

function ayristirmaGruplardan(y, ka, idn, kademe) {
  const ortak = [...y.keys()].filter((h) => ka.has(h) && idn.has(h)).sort((a, b) => a - b)
    .filter((h) => [y, ka, idn].every((g) => g.get(h).cpu_ms_istek !== null));
  if (!ortak.length) return null;
  const h = ortak.includes(kademe) ? kademe : ortak[Math.floor(ortak.length / 2)];
  const top = y.get(h).cpu_ms_istek;
  const tls = top - ka.get(h).cpu_ms_istek;
  const sik = top - idn.get(h).cpu_ms_istek;
  return { hiz: h, toplam: top, tls, sik, kalan: top - tls - sik, user: y.get(h).user_ms, sys: y.get(h).sys_ms };
}

// ---------------------------------------------------------------------------------------------
// Kosu analizi (Portal): KosuVerisi -> adim satirlari + kosu gecerliligi + ozet
// ---------------------------------------------------------------------------------------------

/**
 * KosuVerisi -> hesap baglami. Serbest hedefte kesit ve log TAMAMEN yok sayilir (bos gecer; PORTAL
 * FARKLARI 8); diger trafik yalniz kesit + log penceresi olan CPU hesabinda okunur, serbestte o hesap hic
 * kurulmaz. `rcEtiketi`: zaman.csv rc nedeninin oneki (k6_rc / wrk_rc).
 */
function adimHazirla(veri, { serbest = false, motor = 'k6', genelCpu = false } = {}) {
  // Sunucu logu / sunucu_ kesitleri / bellek / bdetay yok sayilir: serbest hedef ve nginx'siz sunucu hedefi.
  const logsuz = serbest || genelCpu;
  const istemci = new Map();
  for (const x of veri.istemci || []) if (x && x.satir && x.satir.tur) istemci.set(x.satir.tur, x.satir);
  const hatali = new Map();
  for (const x of veri.hataliIstemci || []) if (x && x.satir && x.satir.tur) hatali.set(x.satir.tur, x.satir);
  const zaman = new Map();
  const zamanTum = [];
  const zamanN = new Map();
  for (const s of veri.zaman || []) {
    const b = sayi(s.bas_epoch);
    const e = sayi(s.bit_epoch);
    if (s.tur && b !== null && e !== null) {
      zaman.set(s.tur, [b, e, s.rc !== undefined ? s.rc : '']);
      zamanTum.push([s.tur, b, e]);
      zamanN.set(s.tur, (zamanN.get(s.tur) || 0) + 1);
    }
  }
  const log = !logsuz && veri.log && veri.log.turlar instanceof Map ? veri.log : { fazlar: [], turlar: new Map() };
  return {
    istemci, hatali, zaman, zamanTum, zamanN,
    kesitler: !logsuz && Array.isArray(veri.kesitler) ? veri.kesitler : [],
    yukKesitler: Array.isArray(veri.yukKesitler) ? veri.yukKesitler : [],
    // Nginx'siz sunucu hedefi: genel CPU kesitleri; bozuk (sorun'lu, ornegi olmayan) kesit pencere hesabina girmez.
    hedefCpuKesitler: genelCpu && Array.isArray(veri.hedefCpuKesitler) ? veri.hedefCpuKesitler.filter((k) => k && Array.isArray(k.ornekler) && k.ornekler.length) : [],
    hedefCpuTum: genelCpu && Array.isArray(veri.hedefCpuKesitler) ? veri.hedefCpuKesitler : [],
    // 2026-11-03 (bilgi): hedef bellek kesitleri (serbestte yok sayilir) ve istemci JSON kodlama sayaclari.
    bellekKesitler: !logsuz && Array.isArray(veri.bellekKesitler) ? veri.bellekKesitler : [],
    kodlama: veri.istemciKodlama instanceof Map ? veri.istemciKodlama : new Map(),
    // 2026-11-03 (bilgi): bant genisligi (hedef NIC serbestte yok sayilir; rol ag_*.txt'den) ve bellek ayrisimi.
    istemciAg: veri.istemciAg instanceof Map ? veri.istemciAg : new Map(),
    agHedef: !serbest && Array.isArray(veri.agKesitler) ? veri.agKesitler.filter((k) => k && k.bilgi && k.bilgi.rol === 'hedef') : [],
    agYuk: Array.isArray(veri.agKesitler) ? veri.agKesitler.filter((k) => k && k.bilgi && k.bilgi.rol === 'yuk') : [],
    agKesitler: Array.isArray(veri.agKesitler) ? veri.agKesitler : [],
    bdetayKesitler: !logsuz && Array.isArray(veri.bdetayKesitler) ? veri.bdetayKesitler : [],
    log: log.turlar,
    olcumKod: log.fazlar.indexOf('olcum'),
    diger: veri.diger instanceof Map ? veri.diger : new Map(),
    serbest,
    logsuz,
    genelCpu,
    rcEtiketi: motor === 'wrk' ? 'wrk_rc' : 'k6_rc',
  };
}

/**
 * Serbest hedefte yok sayilan sunucu tarafi dosya sayisi: dizin listesindeki (veri.dosyalar)
 * sunucu_/bilgi_/log_/diger_ dosyalari; listesi olmayan (bellekte kurulmus) veride en az kesit, log
 * ve diger trafik kaynagi kadar.
 */
function sunucuDosyaSayisi(veri) {
  const listede = Array.isArray(veri.dosyalar)
    ? veri.dosyalar.filter((d) => d && typeof d.ad === 'string' && SUNUCU_DOSYA_RE.test(d.ad)).length
    : 0;
  const loglar = Array.isArray(veri.loglar) ? veri.loglar.length : 0;
  const logTuru = veri.log && veri.log.turlar instanceof Map && veri.log.turlar.size ? 1 : 0;
  const kaynak = (Array.isArray(veri.kesitler) ? veri.kesitler.length : 0) + Math.max(loglar, logTuru)
    + (veri.diger instanceof Map && veri.diger.size ? 1 : 0);
  return Math.max(listede, kaynak);
}

function tamVeyaNull(x) {
  const v = sayi(x);
  return v === null ? null : Math.trunc(v);
}

/** ham.bellek: ic alanlar (_kesit, _t0) disarida kalir. */
function bellekHam(b) {
  const o = {};
  for (const [k, v] of Object.entries(b)) if (!k.startsWith('_')) o[k] = v;
  return o;
}

/** Python `r` -> nginx_loadtest_adimlar satiri (sozlesme 6/7). */
function adimSatiri(r, gecerlilik, nedenler, nproc, logVar, ist, reloadlar = []) {
  const tekrar = /_r([0-9]+)$/.exec(r.tur);
  const kapasite = nproc && r.cpu_ms_istek > 0 ? (nproc * 1000 * 0.8) / r.cpu_ms_istek : null;
  return {
    tur: r.tur,
    senaryo: r.senaryo,
    kip: r.kip,
    ae: r.ae,
    hiz: r.hiz,
    deneme: r.deneme !== null ? r.deneme : tamVeyaNull(ist.deneme),
    gecerlilik,
    nedenler,
    p50: r.p50,
    p95: r.p95,
    p99: r.p99,
    ttfb_p95: r.ttfb_p95,
    tls_p95: r.tls_p95,
    connect_p95: r.connect_p95,
    hata_orani: r.hata_orani,
    gercek_rps: r.rps_gercek,
    bayt_istek: r.bayt_istek,
    n_istek: r.n_olcum,
    n_429: r.n_429,
    n_5xx: r.n_5xx,
    dropped: r.dropped,
    istek_sunucu: logVar ? r.n_log_olcum : null,
    rps_sunucu: r.rps_sunucu,
    cpu_ms_istek: r.cpu_ms_istek,
    host_cpu_ort: r.host_cpu_ort,
    kapasite_rps: kapasite,
    srt_p50: r.sunucu_rt_p50,
    srt_p95: r.sunucu_rt_p95,
    srt_p99: r.sunucu_rt_p99,
    sikistirma_turu: r.sikistirma_turu ? String(r.sikistirma_turu) : null,
    ham: {
      adim: r.adim,
      tekrar: tekrar ? Number(tekrar[1]) : null,
      deneme_log: r.deneme,
      gecersiz_nedeni: r.gecersiz_nedeni,
      uyarilar: r._uyari.slice(),
      pencere_kaynak: r.pencere_kaynak,
      pencere_sn: r.pencere_sn,
      kesit: r._kesit,
      user_ms: r.user_ms,
      sys_ms: r.sys_ms,
      cpu_oran_ms_sn: r.cpu_oran_ms_sn,
      arka_ms_sn: r.arka_ms_sn,
      host_cpu_max: r.host_cpu_max,
      diger_rps: r.diger_rps,
      govde_bayt_istek: r.govde_bayt_istek,
      yeniden_baglanti_yuzde: r['yeniden_baglanti_%'],
      log_istemci_fark_yuzde: r['log_istemci_fark_%'],
      n_log_olcum: r.n_log_olcum,
      n_429_sunucu: r._s429,
      n_5xx_sunucu: r._s5xx,
      http2: r.http2,
      ...(r.protokol !== null ? { protokol: r.protokol, protokol_uyumsuz: r.protokol_uyumsuz } : {}),
      ...(r.yuk_cpu_bosta !== null && r.yuk_cpu_bosta !== undefined ? { yuk_cpu_bosta: r.yuk_cpu_bosta } : {}),
      ...(r.yuk_cpu_olculemedi === true ? { yuk_cpu_olculemedi: true } : {}),
      // 2026-11-03 (bilgi): bellek ve kodlama yalniz olcum varsa (eski playbook / wrk: anahtar YOK).
      ...(r._bellek ? { bellek: bellekHam(r._bellek) } : {}),
      ...(r._kodlama ? { kodlama: { ...r._kodlama } } : {}),
      ...(r._ag ? { ag: r._ag } : {}),
      ...(r._bdetay ? { bellek_detay: r._bdetay } : {}),
      p95_js: r.p95_js,
      p95_css: r.p95_css,
      p95_html: r.p95_html,
      p95_json: r.p95_json,
      p95_config: r.p95_config,
      p95_buyuk: r.p95_buyuk,
      isinma_sn: r.isinma_sn,
      sure_sn: r.sure_sn,
      cpu_olculemedi: r._cpu_yok,
      reloadlar: reloadlar.filter((o) => o.etkilenen_turlar.includes(r.tur))
        .map((o) => ({ t: o.t, t_once: o.t_once, t_son: o.t_son, tur: o.tur, faz: o.faz })),
    },
  };
}

/**
 * 2026-11-03 (K3): yuk makinesi CPU kaydi BEKLENIYOR mu (yeni playbook: set_stats kosu.yukm_cpu_basladi ya da
 * dizinde yukcpu_* dosyasi) ve olculemedi mi. Eski kosu / eski playbook (ikisi de yok): null, hicbir sey
 * eklenmez (cikti BIREBIR eskisi). Gecerli (GECERLI / DOYMA) adimlarin HICBIRINDE olcum yoksa kosu nedeni
 * doner (kaydedici_baslamadi | kayit_yok | kayit_bozuk | pencerede_ornek_yok); bazilarinda varsa olcumsuz
 * gecerli adimlara `yuk_cpu_olculemedi` uyarisi eklenir ve null doner. YUK_DOYDU korumasi sessizce dusmez.
 * B1: bekleniyorsa olcumu olmayan her HATALI disi adima `r.yuk_cpu_olculemedi = true` (ham alani; arayuz o adimin
 * kolonunda 'olculemedi' yazar). Eski playbook: alan hic yazilmaz.
 */
function yukOlcumuDenetle(ctx, hesaplar, yukKaydedici) {
  const bekleniyor = ctx.yukKesitler.length > 0 || yukKaydedici === 'basladi' || yukKaydedici === 'baslamadi';
  if (!bekleniyor) return null;
  const olcumYok = (h) => h.r.yuk_cpu_bosta === null || h.r.yuk_cpu_bosta === undefined;
  for (const h of hesaplar) if (h.gecerlilik !== 'HATALI' && olcumYok(h)) h.r.yuk_cpu_olculemedi = true;
  const gecerli = hesaplar.filter((h) => h.gecerlilik === 'GECERLI' || h.gecerlilik === 'DOYMA');
  if (!gecerli.length) return null;
  const olcumsuz = gecerli.filter(olcumYok);
  if (olcumsuz.length === gecerli.length) {
    if (yukKaydedici === 'baslamadi') return 'kaydedici_baslamadi';
    if (!ctx.yukKesitler.length) return 'kayit_yok';
    if (ctx.yukKesitler.every((k) => k.sorun)) return 'kayit_bozuk';
    return 'pencerede_ornek_yok';
  }
  for (const h of olcumsuz) {
    h.r._uyari.push('yuk_cpu_olculemedi');
    h.r.uyari = h.r._uyari.join(';');
  }
  return null;
}

/** Kaydedici son satiri: yazdirilabilir ASCII disi '?', en cok 200 karakter, kenar bosluk yok; bos / metin degil: null. */
function yukSonSatirTemizle(x) {
  if (typeof x !== 'string') return null;
  const t = x.replace(/[^ -~]/g, '?').trim().slice(0, 200);
  return t || null;
}

/** Tek ondaliga asagi (19.96 -> 19.9; 19.9 -> 19.9: kayan nokta payi 1e-9). */
const asagiOndalik = (x) => Math.floor(x * 10 + 1e-9) / 10;

/** DOYMA'nin nedeni Python'da nedenlere yazilmaz (yalniz uyari); Portal satirinda acikca gorunsun. */
function doymaNedenleri(r) {
  const n = [];
  if ((r.dropped || 0) > 0) n.push(`doyma:dropped=${fd(r.dropped)}`);
  if (r.host_cpu_ort !== null && r.host_cpu_ort > DOYMA_HOST_CPU) n.push(`doyma:host_cpu_%${fx(r.host_cpu_ort, 1)}(>%90)`);
  // B6: tek ondaliga ASAGI yuvarlanir: 19.96 '%20.0(<%20)' yazmasin (metin esikle celismesin; arayuz ayni kural).
  if (r.yuk_doydu) n.push(`${YUK_DOYMA_ONEKI}%${fx(asagiOndalik(r.yuk_cpu_bosta), 1)}(<%20)`);
  return n;
}

/**
 * TUR uyarilarini (adim satirlarinin ham.uyarilar'i, HATALI dahil, adim sirasiyla) kosu duzeyi listeye
 * "<tur>: <uyari>" olarak ekler: tekillestirilir, en cok MAX_ADIM_UYARI satir; fazlasi tek ozet satiri.
 * Yalniz `uyarilar`i degistirir (sona ekler); adim satirlari ve karar girdileri ayni kalir.
 */
function adimUyarilariniKat(uyarilar, adimlar) {
  const tekil = [];
  const gorulen = new Set();
  for (const a of adimlar) {
    for (const u of (a && a.ham && Array.isArray(a.ham.uyarilar) ? a.ham.uyarilar : [])) {
      const s = `${a.tur}: ${u}`;
      if (gorulen.has(s)) continue;
      gorulen.add(s);
      tekil.push(s);
    }
  }
  for (const s of tekil.slice(0, MAX_ADIM_UYARI)) uyarilar.push(s);
  if (tekil.length > MAX_ADIM_UYARI) uyarilar.push(`… ve ${tekil.length - MAX_ADIM_UYARI} adım uyarısı daha`);
  return uyarilar;
}

/** NaN/Infinity/undefined -> null (JSON ve DB FLOAT icin). */
function temizle(x) {
  if (x === undefined) return null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (Array.isArray(x)) return x.map(temizle);
  if (x && typeof x === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(x)) o[k] = temizle(v);
    return o;
  }
  return x;
}

// hazirlik.sh kaniti: acik / kapali degerleri (betik 'acik'|'kapali' ya da 1|0 yazabilir; bilinmeyen deger kanit degildir).
const KANIT_ACIK = new Set(['1', 'acik', 'on', 'true', 'evet']);
const KANIT_KAPALI = new Set(['0', 'kapali', 'off', 'false', 'hayir', 'yorum']);
const kanitBool = (v) => {
  const m = String(v ?? '').trim().toLowerCase();
  return KANIT_ACIK.has(m) ? true : KANIT_KAPALI.has(m) ? false : null;
};
const kanitTam = (v) => (/^[0-9]{1,9}$/.test(String(v ?? '').trim()) ? Number(v) : null);
/** hazirlik.sh `${SEVIYE:-9}`: seviye secilmeyen static kosu (identity + gzip_static) .gz'yi bununla uretir. */
const STATIK_VARSAYILAN_SEVIYE = 9;

/**
 * Sunucu ayarli kosunun kaniti (hazirlik_<ADIM>_*.txt) istenenle ayni mi? null: kosuda sunucu ayari yok (cikti BIREBIR
 * eskisi). Eski playbook + yeni Portal ayari UYGULAMADAN kosar: kanit yoksa ya da uyusmuyorsa olcum yanlis ayarin
 * olcumudur, kosu GECERSIZ. Static kosuda diskten sunulma (disk_kanit=ok) ve dosyalarin seviyesi (dosya_seviye = secilen,
 * seviyesiz identity'de STATIK_VARSAYILAN_SEVIYE) da kanittir: eski hazirlik.sh dosyayi sabit seviyeyle uretir, ikisini yazmaz.
 * Donus: { durum: 'uyumlu'|'kanitsiz', sapmalar, http2, ae, seviye, static, dizin, gz_uretilen, br_uretilen, atlanan,
 * dosya_seviye, disk_kanit, uyarilar, dosya }.
 */
function sunucuAyarKaniti(veri, { adim, sunucuAyar, protokol, ae }) {
  if (!sunucuAyar) return null;
  const k = (Array.isArray(veri.hazirliklar) ? veri.hazirliklar : []).find((x) => x && String(x.anahtar).startsWith(`${adim}_`));
  if (!k || !k.bilgi) return { durum: 'kanitsiz', sapmalar: ['yok'], uyarilar: [] };
  const b = k.bilgi;
  const seviye = kanitTam(b.seviye);
  const gz = kanitTam(b.gz_uretilen);
  const br = kanitTam(b.br_uretilen);
  const atlanan = kanitTam(b.atlanan);
  const statik = kanitBool(b.static);
  const sapmalar = [];
  if (kanitBool(b.http2) !== (protokol === 'h2')) sapmalar.push('http2');
  if (b.ae !== ae) sapmalar.push('ae');
  if (sunucuAyar.seviye == null ? String(b.seviye ?? '').trim() !== '' : seviye !== sunucuAyar.seviye) sapmalar.push('seviye');
  if (statik !== sunucuAyar.static) sapmalar.push('static');
  if (b.dizin !== sunucuAyar.dizin) sapmalar.push('dizin');
  // Static kosu dosyasiz olmaz (betik 0 dosyada FAIL der); sayilar okunabiliyorsa ayrica denetlenir.
  const dosya = (ae === 'br' ? br : gz) === null || atlanan === null ? null : (ae === 'br' ? br : gz) + atlanan;
  if (sunucuAyar.static && dosya === 0) sapmalar.push('dosya');
  const dosyaSeviye = kanitTam(b.dosya_seviye);
  const diskKanit = String(b.disk_kanit ?? '').trim().slice(0, 16);
  if (sunucuAyar.static && diskKanit !== 'ok') sapmalar.push('disk_kanit');
  if (sunucuAyar.static && dosyaSeviye !== (sunucuAyar.seviye ?? STATIK_VARSAYILAN_SEVIYE)) sapmalar.push('dosya_seviye');
  return {
    durum: sapmalar.length ? 'kanitsiz' : 'uyumlu',
    sapmalar,
    http2: kanitBool(b.http2),
    ae: String(b.ae ?? '').slice(0, 16),
    seviye,
    static: statik,
    dizin: String(b.dizin ?? '').slice(0, 300),
    gz_uretilen: gz,
    br_uretilen: br,
    atlanan,
    dosya_seviye: dosyaSeviye,
    disk_kanit: diskKanit || null,
    uyarilar: (Array.isArray(b.uyarilar) ? b.uyarilar : []).slice(0, 20).map((u) => String(u).slice(0, 300)),
    dosya: k.dosya,
  };
}

/**
 * Bir kosu dizininin (tek ADIM) analizi. Kosu `uyarilar`i: okuma uyarilari, kesit/kayit uyarilari
 * (serbest hedefte yerine yok sayilan sunucu dosyasi + sunucu_olcumu_yok), wrk TLS payi uyarisi,
 * atlanan baska ADIM TUR'lari, sonra TUR uyarilari ("<tur>: <uyari>", bkz. adimUyarilariniKat).
 * Serbest hedefte sunucu tarafi yok sayilir, wrk'de TLS payi hesaplanmaz (PORTAL FARKLARI 8); `ozet`
 * semasi iki secenekte de ayni. Gecersiz hedefTuru / motor / protokol (ya da wrk + h2) TypeError (cagiran:
 * poller, kosu satirindan). Protokol h2 ise kosu uyarisi H2_UYARISI (PORTAL FARKLARI 12).
 * @param {object} veri  sonuc.cjs kosuDiziniOku ciktisi
 * @param {{adim: string, hedefTuru?: 'sunucu'|'serbest', motor?: 'k6'|'wrk', protokol?: 'h1'|'h2'}} secenek
 *   adim ornek 'R17'; bu ADIM'a ait olmayan TUR'lar atlanir (uyari). Varsayilanlar 'sunucu' / 'k6' / 'h1'
 *   (bugunku cikti). yukKaydedici ('basladi' | 'baslamadi' | null) ve yukSonSatir (kaydedici ciktisinin son satiri,
 *   yalniz yeni playbook): verilmezse cikti BIREBIR eskisi. sunucuAyar (parametreler.sunucuAyar) ve ae (parametreler.ae)
 *   verilirse hazirlik kaniti denetlenir (sunucuAyarKaniti): yok / uyumsuz -> kosu GECERSIZ, neden sunucu_ayari_kanitsiz.
 */
function kosuAnaliz(veri, { adim, hedefTuru = 'sunucu', motor = 'k6', protokol = 'h1', yukKaydedici = null, yukSonSatir = null, sunucuAyar = null, ae = null, hedefNginx = true } = {}) {
  if (!veri || typeof veri !== 'object') throw new TypeError('kosuAnaliz: veri yok');
  if (typeof adim !== 'string' || !ADIM_RE.test(adim)) throw new TypeError('kosuAnaliz: adim gecersiz');
  if (!HEDEF_TURLERI.includes(hedefTuru)) throw new TypeError('kosuAnaliz: hedefTuru gecersiz (sunucu | serbest)');
  if (!MOTORLAR.includes(motor)) throw new TypeError('kosuAnaliz: motor gecersiz (k6 | wrk)');
  if (!PROTOKOLLER.includes(protokol)) throw new TypeError('kosuAnaliz: protokol gecersiz (h1 | h2)');
  if (motor === 'wrk' && protokol === 'h2') throw new TypeError('kosuAnaliz: wrk yalniz h1');
  const serbest = hedefTuru === 'serbest';
  if (typeof hedefNginx !== 'boolean') throw new TypeError('kosuAnaliz: hedefNginx gecersiz (true | false)');
  // Serbest hedefte anlamsiz (sunucu tarafi zaten yok): yok sayilir.
  const genelCpu = !serbest && hedefNginx === false;
  const ctx = adimHazirla(veri, { serbest, motor, genelCpu });
  ctx.protokol = protokol;
  const uyarilar = Array.isArray(veri.uyarilar) ? veri.uyarilar.slice() : [];
  const dislama = dislamaListesi(ctx);
  const arka = new Map();
  for (const k of ctx.kesitler) {
    const ap = arkaPlan(k.ornekler || [], dislama, clkAl(k));
    arka.set(k.anahtar, ap);
    if (ap === null) uyarilar.push(`arka_plan_yok:${k.anahtar}(kosu_disi_bosluk_bulunamadi)`);
    for (const u of (k.bilgi && k.bilgi.uyari) || []) uyarilar.push(`kayit:${k.anahtar}:${u}`);
    if (!k.anahtar.startsWith(adim + '_')) uyarilar.push(`kesit_baska_adimin:${k.anahtar}`);
  }
  let nproc = null;
  // Nginx'siz hedefte sunucu_ kesiti yok: nproc genel CPU kaydinin bilgi dosyasindan (yalniz ozet; kapasite yine null).
  for (const k of ctx.genelCpu ? ctx.hedefCpuTum : ctx.kesitler) {
    const v = sayi(k.bilgi ? k.bilgi.nproc : null);
    if (v) {
      nproc = v;
      break;
    }
  }
  const logVar = Array.isArray(veri.loglar) ? veri.loglar.length > 0 : ctx.log.size > 0;
  if (serbest) {
    // Serbest hedefte kaydedici yok: dizinde yine de sunucu dosyasi varsa (karisiklik) yok sayildigi soylenir.
    const yokSayilan = sunucuDosyaSayisi(veri);
    if (yokSayilan) uyarilar.push(`serbest_kosuda_sunucu_dosyalari_yok_sayildi(${yokSayilan})`);
    uyarilar.push(SERBEST_UYARISI);
  } else if (genelCpu) {
    // Nginx'siz hedef: cpu_kaydedici.sh calismadi; dizinde yine de sunucu dosyasi varsa (karisiklik) yok sayilir.
    const yokSayilan = sunucuDosyaSayisi(veri);
    if (yokSayilan) uyarilar.push(`nginxsiz_kosuda_sunucu_dosyalari_yok_sayildi(${yokSayilan})`);
    if (!ctx.hedefCpuTum.length) uyarilar.push(HEDEF_CPU_KAYDI_YOK);
    else if (!ctx.hedefCpuKesitler.length) uyarilar.push(HEDEF_CPU_KAYDI_BOZUK);
    uyarilar.push(NGINX_YOK_UYARISI);
  } else {
    if (!ctx.kesitler.length) uyarilar.push('sunucu_kaydi_yok(cpu_olculmedi)');
    if (!logVar) uyarilar.push('sunucu_logu_yok(log_istemci_karsilastirmasi_yapilmadi)');
  }

  // Once TUM kosuHesapla (normal + HATALI adaylar, bu sirayla), sonra CPU pencereleriyle reload olaylari,
  // sonra adim satirlari (reload fazi CPU penceresine bagli; PORTAL FARKLARI 11).
  const kosular = [];
  const hesaplar = [];
  const atlanan = [];
  for (const [tur, ist] of ctx.istemci) {
    const r = kosuHesapla(ctx, tur, ist, arka);
    if (r.adim !== adim) {
      atlanan.push(tur);
      continue;
    }
    kosular.push(r);
    hesaplar.push({ r, ist, gecerlilik: r.durum, nedenler: r.durum === 'DOYMA' ? doymaNedenleri(r) : r._gecersiz.slice() });
  }
  // kos.sh'in DUR dedigi (hatali_) ya da baslayip hic istemci sonucu yazmayan TUR'lar: HATALI.
  const gorulen = new Set(ctx.istemci.keys());
  const hataliEkle = (tur, ist, neden) => {
    if (gorulen.has(tur)) return;
    gorulen.add(tur);
    const r = kosuHesapla(ctx, tur, ist, arka);
    if (r.adim !== adim) {
      atlanan.push(tur);
      return;
    }
    hesaplar.push({ r, ist, gecerlilik: 'HATALI', nedenler: [neden, ...r._gecersiz] });
  };
  for (const [tur, ist] of ctx.hatali) hataliEkle(tur, ist, 'hatali_kosu(kos.sh_durdurdu)');
  const baslayanlar = [...(veri.baslatilan || []).map((s) => s.tur), ...ctx.zamanTum.map((z) => z[0])];
  for (const tur of baslayanlar) if (tur) hataliEkle(tur, Object.create(null), 'tamamlanmadi(istemci_sonucu_yok)');
  const pencereler = new Map();
  for (const h of hesaplar) if (h.r._cpu_pencere) pencereler.set(h.r.tur, h.r._cpu_pencere);
  const reloadlar = reloadOlaylari(ctx, pencereler);
  const yukOlculemedi = yukOlcumuDenetle(ctx, hesaplar, yukKaydedici);
  // B1: kaydedicinin son satiri (ASCII, 200) olculemedi notuna eklenir: '<neden>;son=<satir>'.
  const sonSatir = yukSonSatirTemizle(yukSonSatir);
  if (yukOlculemedi) uyarilar.push(`yuk_cpu_olculemedi(${yukOlculemedi}${sonSatir ? `;son=${sonSatir}` : ''})`);
  // 2026-11-03 (bilgi): olasi nginx bellek sizintisi (yalniz bellek kaydi varsa).
  const sizinti = bellekSizintisi(ctx, hesaplar);
  if (sizinti) uyarilar.push(sizinti);
  const adimlar = hesaplar.map((h) => adimSatiri(h.r, h.gecerlilik, h.nedenler, nproc, logVar, h.ist, reloadlar));
  // wrk TLS surumunu sabitlemez ve oturumu devam ettirebilir: 'yeni' kipi her istekte tam el sikismasi demek degil.
  if (motor === 'wrk' && adimlar.some((a) => a.kip === 'yeni')) uyarilar.push(WRK_TLS_UYARISI);
  // PORTAL FARKLARI 12: HTTP/2 olcum modeli (k6 VU basina tek akis) kosu duzeyinde soylenir.
  if (protokol === 'h2') uyarilar.push(H2_UYARISI);
  for (const tur of atlanan) uyarilar.push(`baska_adim_atlandi:${tur}`);
  adimUyarilariniKat(uyarilar, adimlar);

  const gruplar = grupla(kosular).map((g) => {
    const x = grupOzeti(g.o);
    x.kapasite_tahmini_rps = nproc && g.o.cpu_ms_istek > 0 ? (nproc * 1000 * 0.8) / g.o.cpu_ms_istek : null;
    return { senaryo: g.senaryo, kip: g.kip, ae: g.ae, hiz: g.hiz, ...x };
  });
  // TLS payi (K/yeni/br - K/ka/br) wrk'de anlamsiz: ayristirma ve cpu_tlsli_pay HER ZAMAN null.
  let ayr = null;
  if (motor !== 'wrk') {
    const yG = hizGruplari(kosular, { senaryo: 'K', kip: 'yeni', ae: 'br' });
    const yHiz = [...yG.keys()].sort((a, b) => a - b);
    ayr = ayristirmaGruplardan(
      yG,
      hizGruplari(kosular, { senaryo: 'K', kip: 'ka', ae: 'br' }),
      hizGruplari(kosular, { senaryo: 'K', kip: 'yeni', ae: 'identity' }),
      yHiz.length ? yHiz[Math.floor(yHiz.length / 2)] : null,
    );
  }

  const sayac = { GECERLI: 0, DOYMA: 0, GECERSIZ: 0, HATALI: 0 };
  for (const a of adimlar) sayac[a.gecerlilik]++;
  const gecerli = sayac.GECERLI + sayac.DOYMA;
  let gecerlilik;
  const nedenler = [];
  if (!adimlar.length) {
    gecerlilik = 'GECERSIZ';
    nedenler.push('istemci_sonucu_yok');
  } else {
    gecerlilik = gecerli === 0 ? 'GECERSIZ' : gecerli < adimlar.length ? 'KISMI' : 'GECERLI';
    for (const a of adimlar) {
      if (a.gecerlilik === 'GECERSIZ' || a.gecerlilik === 'HATALI') nedenler.push(`${a.tur}(${a.nedenler.join(';')})`);
    }
  }
  const srvKanit = sunucuAyarKaniti(veri, { adim, sunucuAyar, protokol, ae });
  if (srvKanit && srvKanit.durum === 'kanitsiz') {
    gecerlilik = 'GECERSIZ';
    nedenler.unshift(`sunucu_ayari_kanitsiz(${srvKanit.sapmalar.join(',')})`);
  }
  const ozet = {
    adim,
    nproc,
    not: typeof veri.not === 'string' ? veri.not : '',
    turlar: { toplam: adimlar.length, ...sayac },
    kesitler: ctx.kesitler.map((k) => {
      const b = k.bilgi || {};
      const ap = arka.get(k.anahtar);
      return {
        anahtar: k.anahtar,
        ornek: (k.ornekler || []).length,
        bilgi_var: k.bilgiVar !== false,
        nproc: sayi(b.nproc),
        clk_tck: sayi(b.clk_tck),
        df_bas: sayi(b.df_bas),
        df_bit: sayi(b.df_bit),
        konf_degisti: !!(b.konf_hash_bas && b.konf_hash_bit && b.konf_hash_bas !== b.konf_hash_bit),
        test_satiri: sayi(b.test_satiri),
        diger_satiri: sayi(b.diger_satiri),
        bozuk_ua_satiri: sayi(b.bozuk_ua_satiri),
        gecersiz: (b.gecersiz || []).slice(),
        uyari: (b.uyari || []).slice(),
        arka_plan: ap ? { user: ap.user, sys: ap.sys, blok: ap.blok, sn: ap.sn } : null,
      };
    }),
    gruplar,
    reloadlar,
    ayristirma: ayr,
    cpu_tlsli_pay: ayr && ayr.toplam ? ayr.tls / ayr.toplam : null,
    loglar: !ctx.logsuz && Array.isArray(veri.loglar) ? veri.loglar.map((l) => ({ dosya: l.dosya, satir: l.satir, atlanan: l.atlanan })) : [],
    sha256: veri.sha256 || null,
    okunan_bayt: typeof veri.okunanBayt === 'number' ? veri.okunanBayt : null,
  };
  if (yukOlculemedi) ozet.yuk_cpu_olculemedi = yukOlculemedi;
  // 2026-11-04: yalniz sunucu ayarli kosuda (eski kosunun ozeti BIREBIR eskisi).
  if (srvKanit) ozet.sunucu_ayar = srvKanit;
  // 2026-11-03: hedef bellek kesitleri yalniz varsa (eski kosunun ozeti BIREBIR eskisi).
  if (ctx.bellekKesitler.length) {
    ozet.bellek_kesitler = ctx.bellekKesitler.map((k) => ({
      anahtar: k.anahtar, ornek: (k.ornekler || []).length, ...(k.sorun ? { sorun: String(k.sorun).slice(0, 200) } : {}),
    }));
  }
  if (sonSatir) ozet.yuk_cpu_son_satir = sonSatir;
  // 2026-11-03 (bilgi): ag ve bellek ayrisimi kesitleri yalniz varsa (eski kosunun ozeti BIREBIR eskisi).
  if (ctx.agKesitler.length) {
    ozet.ag_kesitler = ctx.agKesitler.map((k) => ({
      anahtar: k.anahtar, rol: k.bilgi && (k.bilgi.rol === 'hedef' || k.bilgi.rol === 'yuk') ? k.bilgi.rol : null,
      ornek: (k.ornekler || []).length, ...agKesitBilgisi(k), arayuz_sayisi: k.arayuzSayisi || 0, sarma: k.sarma || 0,
      kaydedici_cpu_ms: kaydediciSayi(k, 'kaydedici_cpu_ms'), kaydedici_sure_sn: kaydediciSayi(k, 'kaydedici_sure_sn'),
      sifirlama: k.sifirlama || 0, ...(k.sorun ? { sorun: String(k.sorun).slice(0, 200) } : {}),
    }));
    const baslar = ctx.zamanTum.map((z) => z[1]).concat((veri.baslatilan || []).map((x) => sayi(x.bas_epoch)).filter((v) => v !== null));
    const ilkTur = ctx.zamanTum.length ? ctx.zamanTum.reduce((a, z) => (z[1] < a[1] ? z : a))[0] : null;
    const ilkH = hesaplar.find((h) => h.r.tur === ilkTur);
    const bosta = agBosta(ctx, baslar.length ? enKucuk(baslar) : null, ilkH && ilkH.r._saatFarki !== undefined ? ilkH.r._saatFarki : null);
    if (bosta) ozet.ag_bosta = bosta;
  }
  if (ctx.bdetayKesitler.length) {
    ozet.bdetay_kesitler = ctx.bdetayKesitler.map((k) => ({
      anahtar: k.anahtar, ornek: (k.ornekler || []).length, ...(k.sorun ? { sorun: String(k.sorun).slice(0, 200) } : {}),
    }));
  }
  // 2026-11-03: yuk makinesi CPU kesitleri yalniz varsa (eski kosunun ozeti BIREBIR eskisi).
  // Nginx'siz hedef: yalniz bu kipte (eski / nginx kosusunun ozeti BIREBIR eskisi).
  if (genelCpu) {
    ozet.hedef_nginx = false;
    ozet.hedef_cpu_kesitler = ctx.hedefCpuTum.map((k) => ({
      anahtar: k.anahtar,
      ornek: (k.ornekler || []).length,
      bilgi_var: k.bilgiVar === true,
      nproc: sayi(k.bilgi ? k.bilgi.nproc : null),
      ...(k.sorun ? { sorun: String(k.sorun).slice(0, 200) } : {}),
    }));
  }
  if (ctx.yukKesitler.length) {
    ozet.yuk_kesitler = ctx.yukKesitler.map((k) => ({
      anahtar: k.anahtar,
      ornek: (k.ornekler || []).length,
      bilgi_var: k.bilgiVar === true,
      nproc: sayi(k.bilgi ? k.bilgi.nproc : null),
      ...(k.sorun ? { sorun: String(k.sorun).slice(0, 200) } : {}),
    }));
  }
  return temizle({ gecerlilik, nedenler, uyarilar, adimlar, ozet });
}

module.exports = {
  kosuAnaliz,
  kararVer,
  ayristirma,
  // 2026-11-04 coklu karsilastirma (coklu.cjs): kararVer'in gruplari ve hucre basina gurultu kurali.
  hizOzeti,
  farkDurumu,
  gurultuEsigi,
  FARK_KURALLI,
  HATA_ESIK,
  NEDENLER,
  NEDEN_KALIPLARI,
  YUK_BOSTA_ESIK,
  BELLEK_BOS_ESIK,
  AG_KULLANIM_ESIK,
  PROTOKOLLER,
  H2_UYARISI,
  WRK_TLS_UYARISI,
  NGINX_YOK_UYARISI,
  CPU_YOK_NGINXSIZ,
  HEDEF_CPU_KAYDI_YOK,
  HEDEF_CPU_KAYDI_BOZUK,
  EPS,
  _pyForTest: { sayi, pyToplam, pyMax, esikGecti, yuzdelik, medyan, ortalama, gurultu, oran, pyYuvarla, fx, fxs, fd },
  _kosulariHazirlaForTest: kosulariHazirla,
  _adimUyarilariniKatForTest: adimUyarilariniKat,
  // 2026-11-04: bant genisligi / bellek ayrisimi ic islevleri (yalniz test; elle kurulan ctx ile).
  _agBellekForTest: { nicPencere, nicOlc, agOlc, agBosta, bdetayOlc, isciDegisti, agKesitBilgisi, AG_TEPE_SN },
};
