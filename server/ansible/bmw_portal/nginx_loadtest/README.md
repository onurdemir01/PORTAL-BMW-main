# nginx_loadtest — Portal › Nginx Hub › Yük Testi (k6 | wrk)

Portal'ın "Yük Testi" sekmesi bir nginx TEST sunucusunun ya da izinli bir LB VIP'inin istek başına yükünü ve
yanıt sürelerini ölçmek için bu tek playbook'u üç kipte koşturur. Yük ayrı bir **yük makinesinden**, Portal'da
yazılan **hedef IP**'ye doğrudan ve yalnız HAR'dan türetilmiş **yol listesiyle** (sorgu, çerez, başlık, gövde yok)
gider. İki motor vardır (`yuk_motor`):

- **k6** (varsayılan): açık döngü, adım = sabit istek/sn (`yuk_hizlar`).
- **wrk**: kapalı döngü, adım = sabit bağlantı sayısı (`yuk_baglantilar`); her bağlantı her isteğinden önce en az
  sabit bir süre bekler: toplam hız ORTALAMADA koşunun tavanını (`yuk_tavan_rps`) aşmaz; bağlantılar birlikte başlar,
  ilk istekler rastgele yayılır ama istekler kümelenebilir ("Tuzaklar").

İki hedef türü vardır (`yuk_hedef_turu`):

- **sunucu**: IP bir DEV/TEST/QA nginx sunucusuna ait. Hedefte aynı anda `cpu_kaydedici.sh` worker CPU'sunu ve
  yalnız test isteklerinin access-log satırlarını kaydeder; IP'nin hedefte yerel olduğu ön kontrolde ve koşu
  başında yeniden ölçülür.

İki hedef türünde de koşu boyunca **yük makinesinin** toplam CPU'su `yuk_cpu_kaydedici.sh` ile saniyede bir
kaydedilir ("Yük makinesi CPU kaydı").
- **serbest**: IP hiçbir nginx sunucusuna ait değil (LB VIP'i, yönetilmeyen sunucu). Hedefe **bağlanılmaz** (SSH
  yok, kaydedici yok, nginx logu yok); yalnız istemci ölçümü yapılır ve yük makinesindeki izin dosyası
  (`/etc/portal_yuktesti/serbest_aglar`) IP'yi kapsamalıdır.

Sonuç dosyaları GBLABT02 üzerinden `/sw`'ye yazılır; Portal oradan okur, analiz eder ve kendi DB'sine yazar.

Yük araçları (k6 ve wrk) yük makinelerine **kurulmaz**. Admin, Portal'ın "Araçlar" panelinden bu playbook'u dördüncü
kipte (`yuk_islem: araclar`) bir kez koşturur: bir derleme makinesinde (varsayılan GBLABT02) kurumsal vekil üzerinden
resmî k6 arşivi indirilip doğrulanır, wrk 4.2.0 kaynağı indirilip derlenir ve ikisi `/sw`'de sürümlü bir araç seti
dizinine yazılır ("Araç seti (/sw)"). Her ön kontrol ve koşu seçilen motorun ikilisini o dizinden www'nin koşu dizinine
kopyalar, sha256'sını **yalnız Portal'ın verdiği değerle** doğrular, kopyadan çalıştırır ve iş sonunda siler.

Kaynak: el kiti `f5_rehber/har_yuk_testi` (kos.sh, yuk_k6.js, cpu_kaydedici.sh). Kit betikleri kopyalanmış, yalnız
aşağıda ("Betikler") sayılan Portal farkları eklenmiştir. wrk betikleri (`wrk_kos.sh`, `yuk_wrk.lua`), `on_kontrol.sh`,
`yuk_cpu_kaydedici.sh` ve `durdur.sh` Portal'a özgüdür. Portal tarafı sözleşmesi: Portal `docs/NGINX-YUK-TESTI.md` ve uygulama sözleşmesi.

## Dosyalar

| Dosya | İş |
|---|---|
| `nginx_loadtest.yml` | Tek playbook, dört kip (`yuk_islem`: `on_kontrol`, `kosu`, `durdur`, `araclar`), iki hedef türü, iki motor. On play (aşağıda). |
| `files/on_kontrol.sh` | Yük üretmeyen ön kontrol. `hedef` kipi hedefte (IP yerel mi, `nginx -T`'de server_name, nginx master sayısı, `/web_log` doluluğu ve okunabilirliği, log biçimi, statik sıkıştırma direktifi); `yollar` kipi yük makinesinde (senaryodaki her tekil yola TEK istek: HTTP/1.1, `yuk_protokol` h2 ise `curl --http2` ile ALPN; curl HTTP/2'siz derlenmişse yollar HTTP/1.1 ile denenir ve ALPN `openssl s_client` ile TEK bağlantıda ölçülür; h2'de `alpn_h2` ve `alpn_kaynak curl|openssl` satırları). |
| `files/kos.sh` | Kit kopyası: bir ADIM'ın (hız × tekrar) k6 koşularını sırayla çalıştırır (motor `k6`). |
| `files/yuk_k6.js` | Kit kopyası: açık döngü (constant-arrival-rate) k6 betiği, istek başına TEK GET. |
| `files/wrk_kos.sh` | Portal'a özgü: bir ADIM'ın (bağlantı × tekrar) wrk koşularını sırayla çalıştırır (motor `wrk`); dış sözleşmesi (çıkış kodları, `DUR:`/`HATA:` satırları, sonuç dosyaları, `kos.pid`) kos.sh ile aynı. |
| `files/yuk_wrk.lua` | Portal'a özgü wrk betiği: ağırlıklı yol seçimi, bağlantı başına bekleme ile ortalama hız tavanı, ilk 429 / 5xx'te iş parçacığını durdurma, tam sayılı özet dosyası. |
| `files/cpu_kaydedici.sh` | Kit kopyası: hedefte saniyede bir worker CPU örneği + yalnız test UA'lı log satırları (yalnız sunucu hedefte); Portal eki `bellek_*.csv` (worker RSS + MemAvailable, "Bellek ölçümü"), `ag_*.csv` / `ag_*.txt` (NIC, "Bant genişliği") ve `bdetay_*.csv` (Anon / Shmem / File / PSS + bağlantı, "Bellek artışı nasıl okunur"). |
| `files/yuk_cpu_kaydedici.sh` | Portal'a özgü: koşu boyunca **yük makinesinde** (www, dzdo/nginx yok) saniyede bir `/proc/stat` toplam CPU örneği; `sonuc/R<id>/yukcpu_R<id>_<host>.csv` + bitişte `.txt`; 2026-11-03 `ag_R<id>_<host>.csv` / `.txt` (hedefe giden arayüzün NIC sayaçları). |
| `files/durdur.sh` | Bir koşunun bir sunucuda kalan süreçlerini (pid dosyaları, k6, wrk, koşu dizinindeki araç kopyasından çalışan süreçler, kit ve Portal betikleri) TERM, 10 sn sonra KILL. |
| `files/hazirlik.sh` | Portal'a özgü (2026-11-04; hedefte www ile): koşu öncesi nginx ayarı. `uygula` (yedek, `http2 on;`, `comp_level`, `*_static`, `nginx -t`, reload), `dosyalar` (`.gz` / `.br` silme ve üretme, kanıt), `kanit` (dosyaların gerçekten diskten sunulduğu) ve `geri_al` ("Sunucu ayarı (koşu öncesi)"). |
| `files/arac_hazirla.sh` | Portal'a özgü (araclar kipi, derleme makinesinde www ile): k6 arşivinden yalnız ikiliyi çıkarır, wrk'yi derler, ikisini doğrular (sürüm satırı, kütüphaneler, glibc gereksinimi). Ağa çıkmaz; indirme Play 8'in `get_url` görevlerindedir. |

AWX zip'ine yeni `files/arac_hazirla.sh`, (2026-11-03) `files/yuk_cpu_kaydedici.sh` ve (2026-11-04) `files/hazirlik.sh` de girmelidir (ayrıca sayın): `yt_betik_adlari` her kipte on betiğin
hepsini denetler; biri eksikse her kip "files/ altindaki betiklerden biri yok (AWX proje kopyasi eksik); hicbir sey
yapilmadi" ile düşer.

Portal'daki birebir aynası: `server/ansible/bmw_portal/nginx_loadtest/**` (iki kopya **bayt bayt
aynı**; Portal testi `nginx-loadtest-ayna.test.cjs` sabit sha256 listesiyle ve
`NGINX_LOADTEST_ANSIBLE_DEPO` verilirse bu depoyla karşılaştırır).

## Yük makinesi CPU kaydı

`files/yuk_cpu_kaydedici.sh` (2026-11-03) koşu boyunca yük makinesinde (www; dzdo, nginx, root YOK; yalnız
`/proc/stat` okur) saniyede bir toplam CPU örneği alır. `cpu_kaydedici.sh` yeniden kullanılmaz: o nginx master ve
`/web_log` ister, ürettiği `sunucu_*` / `bilgi_*` adları da eski Portal'da ikinci bir hedef kesiti sayılırdı.

- Dosyalar (yük makinesinde `<koşu dizini>/sonuc/R<id>/`, Play 5 ile toplanır, /sw kopyası ve `SHA256SUMS` dahil):
  `yukcpu_R<id>_<host>.csv` başlık `epoch,cpu_user,cpu_nice,cpu_system,cpu_idle,cpu_iowait,cpu_irq,cpu_softirq,cpu_steal`
  (tik; `/proc/stat` ilk `cpu` satırı; `epoch` `EPOCHREALTIME`), bitişte (TERM / INT / `SURE`) `yukcpu_R<id>_<host>.txt`
  (`surum=1 adim host nproc clk_tck bas_epoch bit_epoch ornek_sayisi`).
- `yukcpu_` öneki hiçbir eski Portal desenine uymaz: eski Portal dosyayı yok sayar (adı tanınmayan dosyayı reddetmez,
  atlar). Eski playbook dosyayı üretmez: yeni Portal'da alan boş kalır, işaret yok.
- set_stats `kosu.yukm_cpu_basladi` (bool): kaydedici başlatma görevi koştuysa `true` (rc 0) ya da `false`, koşmadıysa
  `null`. `kosu.yukm_cpu_son_satir`: kaydedici çıktısının (`<koşu dizini>/yuk_cpu.out`) son satırı, kaydedici durduktan
  SONRA `tail -n 1` ile (başlamadıysa da okunur; yazdırılabilir ASCII dışı `?`, en çok 200 karakter; boşsa `null`).
  Bu alanlar ya da `yukcpu_*` dosyası varsa Portal kaydı **bekler**; ölçülemezse koşu notu "Yük makinesi CPU’su
  ölçülemedi (<neden>; kaydedicinin son çıktısı: …)" ve adım kolonunda "ölçülemedi" (eski playbook: alan yok, not ve
  kolon yok). Eski Portal iki anahtarı da okumaz (yok sayar).
- Başlık satırı `trap`'ten önce yazılır: TERM o aralığa düşerse başlıksız CSV kalmaz (bekçi L4). Portal bozuk /
  başlıksız / okunamayan dosyada koşuyu OKUNAMADI yapmaz, yalnız bu ölçümü boş sayar ("ölçülemedi").
- Portal adım başına ölçüm penceresinde (`zaman.csv`'den, ısınma + 3 sn .. bitiş − 2 sn) boşta CPU ortalamasını
  hesaplar; **%20'nin altında** adım `YUK_DOYDU` işaretlenir (geçerlilik DOYMA; p95 kararında kullanılmaz, hedefin
  CPU-ms/istek'i geçerli kalır; neden `doyma:yuk_cpu_bosta_%<x>(<%20)`, x tek ondalığa aşağı yuvarlanır). Bir ortak
  kademenin p95'i bu yüzden karşılaştırılamazsa karşılaştırma KALICI vermez (`DOYMA`; zarar varsa `RET`).
- wrk bekleme `GECIKME_MS = ceil(N × 1000 / TAVAN_RPS)`: N ≥ 1 ve TAVAN ≤ 5000 iken pay ≥ 0,2, sonuç hep ≥ 1 ms (0
  olmaz). Etkin tavan N × 1000 / D ≤ TAVAN; küçük N'de 5000'in altında kalır (N=2: D=1 → 2000/sn; N=8: 4000/sn).
- Sınır: makine geneli boşta oranı wrk'nin iş parçacığı doymasını göremez (8 çekirdekte T=2 ile 2 çekirdek dolu olsa
  bile boşta %75 görünür). k6 (Go, GOMAXPROCS = nproc) için sorun yok.
- Ön kontrol (`on_kontrol.sh yollar`) yük makinesinde salt okunur `port_araligi`, `tcp_tw_reuse`, `tcp_timestamps`,
  `nproc`, `mem_kb` satırlarını da basar; set_stats `on_kontrol` bölümünde `yukm_port_sayisi` (hi − lo + 1),
  `yukm_tw_reuse`, `yukm_tcp_ts`, `yukm_nproc`, `yukm_mem_kb` (bozuk ya da `-` → null; önek `yukm_`: `yuk_*` adları
  extra_vars sözleşmesine ayrılmıştır, bekçi L3). Portal `yeni` kipte yüksek k6 hızında yerel port
  uyarısı verir (yalnız k6: wrk'de `yuk_tavan_rps` hep 5000, gerçek hız değil; uyarı her koşuda çıkardı); hiçbir ayar
  değiştirilmez. TIME_WAIT'in hangi tarafta biriktiği (k6 `noConnectionReuse`; bağlantıyı kimin önce kapattığı
  ölçülmedi) **doğrulanmadı**: pilot koşuda iki tarafta `ss -tan state time-wait` ile ölçülecek.

## Bellek ölçümü

2026-11-03. Yalnız bilgi: geçerliliği ve kararı değiştirmez; onay istemez.

- Hedefte `cpu_kaydedici.sh` her örnekte (saniyede bir) worker pid'lerinin `/proc/<pid>/status` `VmRSS` toplamını ve
  `/proc/meminfo` `MemTotal` / `MemAvailable` değerlerini **ayrı dosyaya** yazar: `bellek_R<id>_<host>.csv`, başlık
  `epoch,nginx_rss_kb,isci_sayi,mem_total_kb,mem_available_kb` (okunamayan alan boş). `sunucu_*.csv` şemasına kolon
  EKLENMEZ: eski Portal ve karsilastir.py `bellek_` önekini tanımaz, dosyayı atlar (SHA256SUMS'ta listeli dosyanın
  yalnız özeti doğrulanır).
- Yük makinesinde `yuk_cpu_kaydedici.sh` `yukcpu_*.csv`'ye `mem_total_kb,mem_available_kb,arac_rss_kb` kolonlarını
  ekler (dosya 2026-11-03'te yeni; eski Portal okumaz). `arac_rss_kb`: argv0'ı `ARAC_DIZIN/` (varsayılan
  `<koşu dizini>/arac`) ile başlayan k6 / wrk sürecinin `VmRSS`'i; pid canlı kaldıkça yeniden aranmaz, yoksa en çok
  5 sn'de bir `/proc` taranır.
- Portal adım başına (ölçüm penceresi): nginx RSS ortalama / en yüksek (MB), hedef bellek kullanımı
  `1 − MemAvailable / MemTotal` (%), yük makinesi bellek kullanımı (%), araç RSS en yüksek (MB). Uyarılar (bilgi):
  boş bellek %10 altına indi (`bellek_bos_az(hedef|yuk,%x)`); nginx RSS adımlar boyunca monoton arttı, ilk-son farkı
  ≥ %20 ve ≥ 50 MB, koşu sonunda geri inmedi (son örnek ≥ son adım ortalamasının %90'ı) → "olası bellek sızıntısı"
  (`nginx_bellek_artisi(...)`). Eski playbook: dosya / kolon yok → "ölçülmedi", hesaplar birebir eskisi.

## Bant genişliği

2026-11-03. Yalnız bilgi: geçerliliği ve kararı değiştirmez. Birim ondalık (10^6): ekranda ≥ 1 Gbps "1,23 Gbps", ≥ 1 Mbps
"12,4 Mbps", altı "850 kbps".

- **Test trafiği** (yük makinesinin gözünden, ölçüm fazı): `yuk_k6.js` k6'nın `data_received{scenario:olcum}` /
  `data_sent{scenario:olcum}` sayaçlarını `istemci_<TUR>.json`'un yeni `ag_alinan_bayt` / `ag_gonderilen_bayt`
  anahtarlarına, ölçüm süresini `ag_sure_sn`'ye yazar (`kodlama`'dan hemen önce; ölçülmezse `null`, asla 0). `wrk_kos.sh`
  `ag_alinan_bayt` = wrk özetinin `bayt`'ı (wrk'nin `Transfer/sec` satırı bayt / süre), `ag_sure_sn` = `sure_us` / 10^6;
  wrk gönderilen baytı saymaz (`ag_gonderilen_bayt` `null`). Portal: ortalama bit/sn = bayt × 8 / süre. İstemci CSV'sinin
  32 kolonu değişmez.
- **NIC** (iki makine, saniyede bir, `/proc/net/dev` kümülatif sayaç): `ag_R<id>_<host>.csv`, başlık
  `epoch,arayuz,rx_bayt,tx_bayt` + `ag_R<id>_<host>.txt` (`rol=hedef|yuk`, `secim`, `arayuz`, `hiz_mbps`). Arayüz: hedefte
  `HEDEF_IP`'nin atalı olduğu (`ip -o -4 addr`; vlan `x@y` → `x`), yük makinesinde `ip route get <HEDEF_IP>` → `dev`.
  Bulunamazsa ya da IP `lo` üzerindeyse (DSR) lo dışı her arayüz (en çok 32) satır satır yazılır ve `secim=lo_disi_toplam(<neden>)`
  kaydedilir; `/proc/net/dev` okunamazsa csv yok, `secim=olculemedi(net_dev_okunamadi)`. Sayaç sarması Portal'da: geri
  giden 32 bit sayaç (+2^32), 2^63 üstü 64 bit sayaç; aksi "sıfırlandı" (o aralık 0 sayılır, özette `sifirlama`).
  `/sys/class/net/<if>/speed` > 0 ise `hiz_mbps`; Portal yön başına en yüksek / hız = kullanım %, > %70 adım uyarısı
  `ag_kullanim_yuksek(hedef|yuk,%x)`. `HEDEF_IP` Play 2 / Play 3 kaydedici satırından gelir (`yuk_hedef_ip`).
- 2026-11-04 (inceleme): "en yüksek" ≥ 5 sn kayan pencereden (ardışık örnek değil). Örnek epoch'u bash 5'te
  `EPOCHREALTIME` ile zaten kesirliydi; bash < 5'te (RHEL 7/8) artık `date +%s.%N` (aynı tek fork; `%N` yoksa tam saniye):
  tam saniyede ardışık fark 1 sn sayılıp gerçekte 1,4 sn olabiliyor, tepe ve kullanım % şişiyordu. Kaydedici bitişte ag
  txt'ye `kaydedici_cpu_ms` (kendi + çocuk süreç CPU'su, `/proc/$$/stat`) ve `kaydedici_sure_sn` ekler: kaydedicinin
  hedefe maliyeti gerçek koşuda ölçülür (`ozet.ag_kesitler`). Hedef boşta tabanı hedef saatinde kurulur (ilk adımın saat
  farkı kestirimiyle; kestirim yoksa hedef tabanı verilmez).
- **Boşta taban**: hedef kaydedicisinin ilk boş örnekleri (ilk adımdan önce, ≥ 5 sn) ayrı gösterilir. Hedef aynı zamanda
  internet RP ise (ör. GBNGXT34) arayüz toplamı test dışı trafiği de içerir: NIC değeri − boşta taban ≈ test payı; test
  trafiği satırı yalnız testi sayar.
- Karışık sürüm: `ag_` öneki hiçbir eski Portal / karsilastir.py desenine uymaz (eski okuyucu yalnız SHA256SUMS özetini
  doğrular); eski playbook: dosya / JSON anahtarı yok → "ölçülmedi", kolon gizli, analiz birebir eskisi.

Örnek: 2500 istek/sn, ortalama yanıt 6 KB (br) → test trafiği alınan ≈ 2500 × 6 × 1024 × 8 ≈ 123 Mbps, gönderilen
≈ 2500 × 350 B × 8 ≈ 7 Mbps; 10 Gbps arayüzde kullanım ~%1,2. 1 Gbps arayüzde 5000 istek/sn × 20 KB ≈ 819 Mbps → %82,
uyarı: ölçülen p95 ağı da içerir.

## Bellek artışı nasıl okunur

2026-11-03. Yalnız bilgi. Hedefte `cpu_kaydedici.sh` her örnekte ayrı dosyaya yazar: `bdetay_R<id>_<host>.csv`, başlık
`epoch,isci_sayi,kapanan_sayi,anon_kb,shmem_kb,file_kb,pss_kb,master_rss_kb,master_pss_kb,baglanti`:

- worker toplamları `/proc/<pid>/status` `RssAnon` / `RssShmem` / `RssFile` (çekirdek 4.5+; RHEL 7'de satır yok → boş),
  `/proc/<pid>/smaps_rollup` `Pss` (4.14+; bir worker'da okunamazsa boş: kısmi toplam yazılmaz); master ayrı (`VmRSS`,
  `Pss`; master root ise `smaps_rollup` www'ye kapalı → boş); `kapanan_sayi` "shutting down" worker; `baglanti` =
  `ss -Htn state established src <HEDEF_IP>:<HEDEF_PORT>` satırı (`-H` yoksa `-tn` + başlık atlanır; ss yoksa boş).
  `bellek_*.csv` / `sunucu_*.csv` şeması değişmez; `bdetay_` öneki eski okuyucuya görünmez.
- **RSS her worker'da paylaşılanı yeniden sayar**: 8 worker aynı 100 MB `ssl_session_cache` / `keys_zone` bölgesine
  dokunursa RSS toplamı 800 MB görünür. Ana ölçü **PSS** (paylaşılan sayfa, paylaşan süreç sayısına bölünür); PSS yoksa
  RSS. Anon = sürece özel yığın (istek / bağlantı tamponları, Lua, brotli/gzip çalışma alanı); Shmem = paylaşılan bellek
  bölgeleri; File = eşlenen dosyalar (ikili, modüller, `open_file_cache` / `sendfile` sayfaları).
- Portal adım başına üç nokta: **taban** (adım başlamadan hemen önce), **son** (ölçüm penceresi sonu), **dinlenme**
  (adımlar arası bekleme bitmeden son örnek, ≥ 3 sn). "Olası neden" kuralları ekranda (analiz değil):
  Anon taban→son ≥ 5 MB artıp dinlenmede artışın ≥ yarısı iniyor ve bağlantı yükte fazla → bağlantı / istek tamponları
  (yük kaynaklı, normal); Shmem ≥ 2 MB artıp dinlenmede inmiyor (plato) → paylaşılan bellek bölgeleri
  (`ssl_session_cache`, `limit_req` / `limit_conn`, cache `keys_zone`) ilk kez doluyor, sızıntı değil; File ≥ 2 MB →
  eşlenen dosyalar / açık dosya önbelleği; `kapanan_sayi` > 0 → reload: eski ve yeni worker aynı anda (RSS çift sayılır).
  Koşu düzeyi: dinlenme Anon'ları adım adım azalmadan artıyor (toplam ≥ 10 MB ve ≥ %10), her adımda dinlenme ≥ %90 × son,
  bağlantı ortalaması en çok / en az ≤ 1,5 → "olası sızıntı; aynı koşuyu tekrarlayın". Bugünkü `nginx_bellek_artisi`
  (RSS kuralı) Anon ölçümü yoksa aynı uyarıyı verir. 2026-11-04: "RSS artışı Anon kaynaklı değil" YALNIZ her adımda
  dinlenme ölçülüp her dinlenme Anon'u ilk taban + 5 MB'ı aşmıyorsa; aksi "kaynağı belirsiz" (dinlenme yok, taban yok,
  bağlantı sayısı değişti (1000/2500/5000 rampası), Anon inmedi). Anon ≥ 5 MB artıp dinlenme ölçülmediyse "Belirgin artış
  yok" DEĞİL "dinlenme ölçülmedi"; taban / dinlenme ile son arasında worker kümesi değiştiyse (reload, yeniden doğuş) o
  noktayla karşılaştırma yapılmaz. İnternet RP'de (GBNGXT34) bağlantı sayısı üretim bağlantılarını da içerir.
- Brotli / gzip yüksek seviye (`brotli_comp_level` 9-11, `gzip_comp_level` 9) istek başına geçici Anon ayırır (brotli
  pencere + hash tabloları yanıt başına MB mertebesi); eşzamanlı sıkıştırılan yanıt sayısıyla artar ve glibc arenaları
  hemen geri vermeyebilir: dinlenmede kısmen iner. Seviye 4-6 ile aynı koşu Anon artışını karşılaştırmanın yoludur.
  Sunucu ayarlı brotli static koşuda bu etki yük başlamadan da görülebilir: `.br`'yi ölçülen worker'ların kendisi üretir ("Tuzaklar"),
  taban Anon seviyeye göre şişmiş başlayabilir.

Örnek (2 adım): taban Anon 40 MB → son 95 MB → dinlenme 48 MB, bağlantı 4 → 900 → 6: tampon (normal). Shmem 10 → 74 MB
→ 74 MB: `ssl_session_cache shared:SSL:64m` doluyor (bir kez). Anon dinlenme 48 → 61 → 77 MB, bağlantı ~900 sabit:
olası sızıntı, aynı koşuyu tekrarlayın.

## Sunucu ayarı (koşu öncesi)

Gece kuyruğundaki senaryolar elle sunucu ayarı değiştirmeden koşsun diye: `yuk_srv_ayar` `1` iken hedefteki nginx koşudan
hemen önce istenen duruma getirilir, iş bitince geri alınır. Yalnız sunucu hedefte ve `on_kontrol` / `kosu` kipinde;
`0` (eski Portal dahil) iken hiçbir şey değişmez. Hedef non-prod (girdi kapısı ad kuralı).

Ne değişir:

| Dosya | Değişiklik |
|---|---|
| `/usr/nginx/conf.d/default.conf` | `http2 on;` satırı: `yuk_protokol` `h2` iken açık, `h1` iken yorumlu (seçim protokolden türetilir). Satır (açık ya da yorumlu) yoksa FAIL |
| `/usr/nginx/conf/gzip.conf` | `yuk_ae` `gzip` iken `gzip_comp_level <seviye>`; static açık ve `yuk_ae` `gzip` \| `identity` iken `gzip_static on`, değilse `gzip_static off` |
| `/usr/nginx/conf/brotli.conf` | `yuk_ae` `br` iken `brotli_comp_level <seviye>`; static açık ve `yuk_ae` `br` iken `brotli_static on`, değilse `brotli_static off` |

`*_static` satırı yoksa `*_comp_level` satırının ardına eklenir, varsa değiştirilir; bu yüzden iki `comp_level` satırı da
her koşuda gerekir. Seviye yalnız seçilen sıkıştırmanın konfunda değişir. `identity` seviye almaz. No-Keepalive
(`yuk_kip` `yeni`) ve istemci sıkıştırması (`yuk_ae`) zaten vardı. Dosyalar yerinde yazılır (sahip / izin korunur).

Dizin (`yuk_srv_dizin`) ayar açıkken **her zaman** zorunludur, static kapalıyken de: her koşu öncesi dizin istenen duruma
getirilir. Kullanıcı kuralı (2026-11-04): `.gz` yalnız gzip static koşusunda, `.br` yalnız brotli static koşusunda durur.
Static istenmiyorsa ikisi de silinir; gzip static koşusunda `.br`, brotli static koşusunda `.gz` silinir. Silme yalnız
kaynağı yanında duran dosyalar içindir (`x.js` varken `x.js.gz` / `x.js.br`; `*.js *.css *.svg *.txt`): kaynağı olmayan
`.gz` / `.br`'ye dokunulmaz, dizin dışına çıkılmaz, symlink izlenmez ve silinmez. Silinenler `geri_al` ile GERİ GETİRİLMEZ
(türetilmiş dosya).

`hazirlik.sh` kipleri:

- **uygula** (Play 2; ön kontrolde `on_kontrol.sh hedef`'ten, koşuda koşu kapısından ve kaydedici başlamadan ÖNCE): eski
  yedek varsa önce geri alır (`yarim_kalan 1`; başka koşunun yedeğini devralır, hedef kilidi bu işte). Yazma izni ya da
  beklenen satır yoksa, dizin yoksa, static'te dizin ya da bir alt dizini yazılamıyorsa (static kapalıyken UYARI), static'te
  `curl` yoksa, brotli static'te boş port bulunamıyorsa ya da `default.conf`'ta eski üretici bloğu varsa (`yuk_ae` / static fark etmez) hiçbir şey değişmeden FAIL. `<www ev>/.portal_yuktesti/hazirlik/` (koşu dizini
  DIŞINDA, 0700: koşu dizini silinse de yedek kalır) altına 3 dosyanın yedeği, özgün ve uygulanan sha256'ları, koşu no
  tek `mv -T` ile yayınlanır; sonra dosyalar yazılır, `nginx -t`, `nginx -T` ile doğrulama, reload,
  `worker process is shutting down` süzülene dek en çok 90 sn bekleme (bitmezse UYARI, devam). Brotli static'te `default.conf`'a
  üretici bloğu da eklenir (aşağıda **.br yöntemi**) ve reload sonrası porta 20 sn'ye dek (`BR_PORT_BEKLE`, saatle ölçülür: çok vhost
  ve sertifikalı hostta reload saniyeler sürer) bağlanılır: `-s reload` rc 0 bind'i kanıtlamaz; yanıt yoksa konf geri alınır (reload ile), FAIL. `nginx -t` düşerse dosyalar
  geri, FAIL (metinde hata satırı; ör. `brotli_static` modülü yoksa `unknown directive`). `-T`'de istenen seviye ya da
  `default.conf` http2 durumu görünmüyorsa da (dosya include edilmiyor) reload edilmeden geri, FAIL. Başka dosyada
  seçilen `*_comp_level`, `http2 on` ya da `listen ... http2` varsa UYARI (ayar etkisiz olabilir). `-T` çıktısı basılmaz.
- **dosyalar** (yalnız koşu, ayar açıkken static kapalıyken de): brotli static'te önce port / seviye denetimi (uyuşmazlıkta dizine
  dokunulmaz), sonra yukarıdaki silme, sonra static koşuda üretim. İlgili tür
  HER KOŞUDA yeniden üretilir (eksik / eski kontrolü yok: başka seviyeden kalan dosya ölçümü bozar, mtime seviyeyi görmez).
  Hiç olmayıp YENİ oluşturulanlar manifest'e yazılır (üretimden önce: yarıda kalan da silinsin); önceden duran bir `.gz` /
  `.br` yeniden üretilse de manifest'e GİRMEZ, `geri_al`'dan sonra yeni seviyeyle yerinde kalır. Static koşuda 0 dosya, her
  koşuda dizin yoksa FAIL. Dosya seviyesi kullanıcının seçtiği seviyedir (kullanıcı kuralı 2026-11-04, `-9` / `11` sabiti
  yok): `.gz` `gzip -<seviye> -n -k -f`, `.br` üretici blokta `brotli_comp_level <seviye>`; seviye boşsa (`yuk_ae` `identity` +
  `gzip_static`) `gzip -9`. Kanıt `<koşu dizini>/R<id>/hazirlik_R<id>_<host>.txt`.
- **kanit** (yalnız koşu; `dosyalar` ve reload'dan sonra, koşu kapısı ve kaydediciden ÖNCE; FAIL'de kaydedici ve yük BAŞLAMAZ,
  Play 7 geri alır): `brotli on` açık kaldığı için `.br` bulunamazsa nginx sessizce anlık sıkıştırmaya düşer, koşu "static" diye
  dinamik ölçerdi. Play 2 senaryoyu `<koşu dizini>/senaryo.tsv`'ye yazar. Static koşuda senaryodaki `.js .css .svg .txt` yollarının
  (son kolon, sorgu yok, yüzde kodu açılır, `..` / denetim karakteri atlanır) her biri için URL yolunun son parçaları kısaltılarak
  dizin altında dosya aranır (`/a/b/x.js` -> `<dizin>/a/b/x.js`, `<dizin>/b/x.js`, `<dizin>/x.js`; boş dosya ve symlink örnek
  olmaz), bulunanlardan en büyük 3 örnek `curl -sk -o /dev/null -D - --resolve <host>:443:<ip> -H 'Accept-Encoding: br|gzip'
  https://<host><yol>` ile istenir (`-q`, vekilsiz, 15 sn; `yuk_ae` `br` ise `br`, `gzip` ve `identity` + `gzip_static` ise
  `gzip`). Başarı: 200 + istenen `Content-Encoding` + `Content-Length` var ve diskteki `.br` / `.gz` boyutuna eşit (HTTP/1.1 ve
  HTTP/2; başlık adı büyük / küçük harf duyarsız). Aksi FAIL, metinde beklenen / gelen. Hiç örnek yoksa FAIL (`HAR yollari bu
  dizinden sunulmuyor, dizini kontrol edin`); `curl` yoksa FAIL (static koşunun `uygula`'sı da denetler: ön kontrol görsün).
  Static kapalıysa istek yok, `disk_kanit yok`, OK.
- **geri_al** (Play 7 `always`, hedefte): manifest'teki dosyaları siler (gzip_static açık üretimde yeni sürüm deploy edilince
  bayat `.gz` sunulmasın diye şart); konf dosyası hâlâ bizim yazdığımız sha256 ise yedeği yazar, değilse DOKUNMAZ, özgün
  kopyayı `<www ev>/.portal_yuktesti/hazirlik_dokunulmadi_<koşu>/` altına alır (son 5 koşu tutulur) ve UYARI basar (başkası
  değiştirmiş); `nginx -t`, reload, yedek dizini silinir. `-t` / reload düşerse yedek KORUNUR, durum `hata` (sonraki `uygula`
  ya da Durdur yeniden dener). Yedek yoksa no-op OK. Her konf yazımı sha256 ile doğrulanır; yazım yarıda kaldıysa `yaz<i>`
  işareti kalır ve sonraki deneme dosyayı "başkası değiştirmiş" saymadan yeniden yazar (disk dolu).
  **Sahiplik**: `KOSU_ID` yedekteki koşudan farklıysa ve `DEVRAL=1` değilse hiç dokunmaz (`geri_al_durum baska`, Play 7 `ok`).
  Portal Durdur'u kilitsizdir: eski bir koşunun Durdur'u süren koşunun konfunu geri alıp koşuyu yakmamalı. `DEVRAL=1` yalnız
  hedef kilidini tutan iş içindir (Play 7 `on_kontrol` / `kosu`); `durdur` kipi `0` gönderir.

Üç kip `<www ev>/.portal_yuktesti/hazirlik.lock` üzerinde `flock` ile sıralanır (en çok 60 sn; dolu ise FAIL, yedek durur;
`flock` yoksa UYARI, devam). Başka koşunun yedeğine bakan `geri_al` kilit beklemez.

Geri alma Play 7'de koşu, ön kontrol ve durdur için her yolda (`always`: ana blok düşse de) çalışır; karar yedeğin
varlığına ve sahibine göre verilir, `yuk_srv_ayar` değerine göre değil (Durdur `0` gönderir ama koşunun yedeğini geri alır). Kaydedici
(Play 4) ve `durdur.sh` DURDUKTAN sonra koşar: `konf_degisti` ve reload ölçüme girmez. Betik koşu dizininde olmayabilir
(durdur), bu yüzden `<www ev>/.portal_yuktesti/hazirlik_geri_<id>.sh`'e kopyalanır (sha1, sahip = yedek dizini sahibi,
düzenli dosya, grup/diğer yazamaz) ve iş sonunda silinir. Sonuç `sunucu_ayar.geri_alma`: `ok` | `uyari` | `hata`. `hata`
koşunun durumunu bozmaz (Portal ayrıntıda uyarı gösterir); ön kontrol ve durdurda job'u düşürür (Durdur yeniden denenebilir).

**Play 7 hiç koşmazsa** (AWX zaman aşımı, AWX'ten iptal, `error`, kontrol düğümü ölürse) yedek hedefte kalır ve set_stats
yayınlanmaz. Portal `sunucu_ayar.geri_alma` görmeyince otomatik `durdur` işi başlatır, kilidi ona bağlar, sonucu ayrıntıda
gösterir; başlatamazsa kilidi tutar ve Durdur düğmesini açık bırakır. Ayarsız bir sonraki işte `on_kontrol.sh hedef`
`hazirlik_yedek 1` yayınlar: Portal engel sayar, o ön kontrolün Play 7'si yedeği devralıp geri alır. Sunucu ayarlı koşuda
bütçe tavanı 1800 sn'dir (girdi kapısı): `uygula` 300 + `dosyalar` 600 + async payı 300 AWX'in 3600 sn sınırını aşmasın.

**.br yöntemi**: sunucuda `brotli` ikilisi yok. İkinci bir nginx örneği de açılmaz: NGINX Plus lisanssız başlamaz
(AWX 3483307, `[emerg] License file is required`; lisans `nginx.conf`'taki `mgmt { license_token ...; }` içinde) ve ikinci örnek
lisans / kullanım raporu açısından istenmez. Bu yüzden `yuk_ae` `br` + static iken `uygula`, `default.conf`'un SONUNA işaretli
bir server bloğu ekler; `.br`'yi çalışan nginx üretir:

```nginx
# portal_yuktesti br uretici
server {
    listen 127.0.0.1:<port>;
    root <dizin>;
    access_log off;
    gzip off;
    gzip_static off;
    brotli on;
    brotli_comp_level <seviye>;
    brotli_types *;
    brotli_min_length 0;
    brotli_static off;
    location / { }
}
```

Port 20000-60000 arasında, `/proc/net/tcp` ve `tcp6`'da görünmeyen bir porttur; `br_port` / `br_seviye` olarak yedek `meta`'sında
saklanır. `brotli_static off` şarttır: http düzeyindeki `on` önceki `.br`'yi okur, seçilen seviye üretilmezdi. Blok ön kontrolde de
eklenir (`nginx -t`, reload ve bağlantı erken doğrulanır; `.gz` / `.br` dosyaları yalnız koşuda). `default.conf` zaten yedekli
olduğundan yeni dosya, ek reload ve ayrı kapatma yoktur: blok `geri_al`'a dek durur (yalnız `127.0.0.1`, trafik yok), `geri_al`
özgün `default.conf`'la birlikte kaldırır. Modül yoksa `nginx -t` düşer (`unknown directive`), `uygula` FAIL. `-T` doğrulaması
işaretten dosya sonuna kadarını saymaz (blok seviyesi "başka dosyada" UYARI'sı üretmez; etkin seviye `brotli.conf`'tan okunur), blokta
`http2` satırı yoktur. `geri_al` başkasının değiştirdiği `default.conf`'a dokunmadıysa blok kalır: sonraki her `uygula` ikinci blok
eklemez, "eski blok" diye FAIL verir, elle silinmelidir. Bu denetim bilerek `yuk_ae` ve static'ten bağımsızdır: kalan blok gzip ve
static kapalı koşuları da durdurur, unutulmuş bir dinleyici `default.conf`'ta fark edilmeden kalmasın.

`dosyalar` her dosyayı `curl -H 'Accept-Encoding: br'` ile bu porttan (arka planda + `wait`: TERM trap'i `curl`'ü beklemesin)
alıp `<ad>.br.hazirlik_tmp`'ye yazar; bağlanamazsa, yanıt 200 değilse, `Content-Encoding: br` yoksa ya da gövde boşsa FAIL;
`touch -r` ile kaynağın mtime'ı verilip `.br` adına atomik taşınır. Boş kaynak dosya (nginx'te gövde yok, sıkıştırılamaz)
atlanır. Yedekte port yoksa ya da blok seviyesi istenen seviye değilse FAIL; bu denetim silmeden önce koşar, `.gz` / `.br`'ye
dokunulmaz (silinen dosya `geri_al` ile geri gelmez).

Sıkıştırma çalışan worker'da yapılır: iki yan etki "Tuzaklar"da (**`.br` üretimi canlı worker'da**, **brotli static koşuda taban Anon**).

Kanıt dosyası (`anahtar<TAB>değer`, Portal `hazirlik_*.txt`): `http2` (`acik` \| `kapali`), `ae`, `seviye`, `static`
(`acik` \| `kapali` \| `karisik`), `dizin` (bu beşi `uygula`'nın diskteki konftan OKUDUĞU değerdir, istenen değil: `uygula`'daki
bir hata Portal'a "uyumlu" dedirtmesin), `kaynak_dosya`, `gz_uretilen`, `br_uretilen`, `gz_silinen`, `br_silinen`, `atlanan`
(boş kaynak ya da symlink), `dosya_seviye` (dosyaların üretildiği seviye; static kapalıysa boş), `sure_dosyalar_sn`, `sure_uygula_sn`,
her uyarı için bir `uyari` satırı; `kanit`'ten `disk_kanit` (`ok` \| `yok`; FAIL'de ve static kapalıyken `yok`), `disk_ornek` (doğrulanan
örnek sayısı), `disk_yol` (ilk örnek).
Koşu sonunda sonuç dosyalarıyla `/sw`'ye gider. Portal: `parametreler.sunucuAyar` dolu koşuda kanıt yoksa ya da istenenle
uyuşmuyorsa koşu GEÇERSİZ (`sunucu_ayari_kanitsiz`). Static koşuda `disk_kanit` `ok` değilse ya da `dosya_seviye` seçilen
seviye (seviyesiz sıkıştırmasız koşuda 9) değilse de öyle: eski `hazirlik.sh` bu iki satırı yazmaz.

## Kip doğrulaması

Adım başına istenen / gerçekleşen (yalnız bilgi):

- Protokol: istemci satırının `protokol` / `protokol_uyumsuz` kolonları (yoksa `http2` sayacı); wrk ölçmez.
- Bağlantı: hedef nginx logunun `connection_request` alanı: yeni bağlantıdaki istek payı (`connection_request == 1`) ve
  bağlantı başına ortalama istek (istek / yeni bağlantı). `yeni` → ~%100 yeni, 1,0 istek/bağlantı; `ka` → düşük pay.
  `ka`'da pay > %20 uyarı; `yeni`'de bugünkü %5 yeniden kullanım uyarısı aynen. Serbest hedefte ölçülmez.
- Sıkıştırma: `yuk_k6.js` her ölçüm yanıtının `Content-Encoding` başlığını sayar (`br`, `gzip`, `deflate`, `zstd`,
  `yok`, `diger`; `yok_1kb_alti`: kodlamasız ve `Content-Length` < 1024). Sayaçlar `istemci_<TUR>.json`'un yeni
  `kodlama` anahtarındadır; **istemci CSV'sinin 32 kolonu değişmez** (eski Portal JSON'u okumaz, yalnız SHA256SUMS
  özetini doğrular; set_stats `istemci_ozet` içinde fazladan anahtar olarak taşınır). `br` / `gzip` istenip 1 KB
  üstü yanıtların %50'sinden azı o kodlamadaysa, `identity` istenip sıkıştırılmış yanıt varsa uyarı. wrk ve eski
  k6 betiği: "ölçülmedi".

## Akış

Play sırası (strateji **linear**; `strategy: free`, `poll: 0`/`async_status` YOK; tur 4'te Play 8 ve Play 9 eklendi,
sonuç play'i Play 10):

1. **localhost — girdi kapısı** (`block`/`rescue`): yedi `assert`, sırayla: (1) araclar dışı her kip: işlem, koşu
   kimliği, hedef türü, hedef ve yük makinesi; (2) yalnız araclar: derleme makinesi, k6 / wrk sürümleri, vekil, /sw
   kökü; (3) yalnız araclar: iki arşiv özeti (`yuk_k6_arsiv_sha256`, `yuk_wrk_kaynak_sha256`) ZORUNLU 64 küçük hex —
   boş ya da eksikse `araclar girdileri gecersiz (arsiv ozetleri sabit degil): Portal'da NGINX_LOADTEST_K6_ARSIV_SHA256
   ve NGINX_LOADTEST_WRK_KAYNAK_SHA256 ...` ile hiçbir şey indirilmez ("Arşiv özetlerini sabitleme"); (4)
   on_kontrol/kosu: araç değişkenleri (`yuk_arac_dizin`, iki sha256, iki işaret yolu; parametre assert'inden ÖNCE: eski
   Portal ilk bu iletiyi görür); (5) on_kontrol/kosu: parametreler, motor, sınırlar, bütçe; (6) araclar dışı her kip:
   sunucu ayarı (`yuk_srv_*`; `1` yalnız sunucu hedefte ve on_kontrol/kosu); (7) durdur dışı her kip:
   iş geçerlilik süresi `yuk_son_epoch`; senaryo base64'ten çözülür, **her satırı** yeniden
   denetlenir, sha256 karşılaştırılır (araclar ve durdur'da senaryo yok); betiklerin kaynak sha1'leri alınır; yük
   makinesi `yuk_makine` grubuna `add_host` ile eklenir; hedef `yuk_hedef` grubuna **yalnız sunucu hedefte** eklenir;
   araclar kipinde YALNIZ derleme makinesi `yuk_derleme` grubuna eklenir ve kontrol düğümünde geçici araç toplama dizini
   açılır (AWX `limit` KULLANILMAZ). Reddedilirse hiçbir hosta bağlanılmaz.
2. **yuk_hedef** (become www; serbestte host yok, play "no hosts matched" ile atlanır): `yuk_srv_ayar` `1` ise önce
   `hazirlik.sh uygula` (koşuda ardından `dosyalar` ve `kanit`; FAIL'de kaydedici ve yük BAŞLAMAZ, ön kontrolde engel; "Sunucu ayarı
   (koşu öncesi)"); `on_kontrol` → `on_kontrol.sh hedef`; `kosu` → koşu dizini, `cpu_kaydedici.sh` + `on_kontrol.sh` kopyası (kapı), önce **koşu
   kapısı**: `on_kontrol.sh hedef` yeniden koşar (yük üretmez) ve `ip_yerel` `1` değilse kaydedici ve yük BAŞLAMAZ
   (`hedef <H>: kosu kapisi: ...`; Portal dışı başlatma, paylaşılan VIP'in ön kontrolden sonra başka hosta geçmesi);
   sonra kaydedici **ayrık** başlatılır (`setsid nohup timeout -k 300 <bütçe+120> env SURE=<bütçe+60> ... & echo $! >
   kaydedici.pid`), `wait_for` ile `YUKU SIMDI BASLATIN` ya da başlatıcının/kaydedicinin KENDİ hata satırı beklenir
   (en çok bosta+90 sn; desen "Tuzaklar"da).
3. **yuk_makine** (become www):
   - Hazırlık (`on_kontrol`; `kosu`ta serbest hedefte her zaman, sunucu hedefte yalnız kaydedici hazırsa): koşu
     dizini, betik kopyası (motora göre `kos.sh` + `yuk_k6.js` ya da `wrk_kos.sh` + `yuk_wrk.lua`, ikisinde de
     `yuk_cpu_kaydedici.sh`; ön kontrolde `on_kontrol.sh`), senaryo kopyası (kapı). Ardından **araç kopyası**: seçili motorun ikilisi
     `<yuk_arac_dizin>/<k6|wrk>`'den `copy remote_src` ile `<koşu dizini>/arac/<k6|wrk>`'ye (dizin ve dosya 0700, www)
     alınır; sha256'sı YALNIZ Portal'ın verdiği `yuk_k6_sha256` / `yuk_wrk_sha256` ile karşılaştırılır (/sw'deki
     `SHA256SUMS` / `manifest.json`'a güvenilmez), sahip ve izinler denetlenir. Doğrulanmayan kopya hiç çalıştırılmadan
     silinir; `kosu`'da `arac kopyasi dogrulanamadi: <neden>; yuk gonderilmedi` ile durulur, `on_kontrol`'de neden
     sonuca gider (engel). Hazırlığın başında **eski araç kopyaları süpürülür**: `~/.portal_yuktesti` altında 1 günden
     eski (mtime) `<rakam>/arac` dizinleri silinir (AWX iptalinde Play 7 koşmaz ve kopya kalırdı); YALNIZ `arac/` alt
     dizini: koşu dizinleri, korunan sonuçlar (`kosu dizini silinmedi (/sw kopyasi yok ...)`) ve `arac_<id>` derleme
     dizinleri dokunulmaz, bu koşunun `arac/`'ı hariçtir. Süpürme hatası işi düşürmez.
   - Serbest hedefte **izin dosyası**: `/etc/portal_yuktesti/serbest_aglar` (yol playbook'ta LİTERAL; extra_vars ile
     yönlendirilemez) okunur ve hedef IP'yi kapsayan girdi aranır (biçim ve ret nedenleri "Serbest izin dosyası"nda).
     Blok `fail` etmez: ret, yollar ve koşu görevlerinin `when`'iyle uygulanır ve neden set_stats'a gider.
   - `on_kontrol` → seçili motorun koşu dizinindeki kopyası (k6: var mı/`version`/sha256; wrk: var mı/`-v` sürüm
     satırı/sha256; ikisi de yalnız kopya doğrulandıysa çalıştırılır), yük makinesinin glibc'si (`getconf
     GNU_LIBC_VERSION`; `version`/`-v` yükleyici hatası `GLIBC_x.y` derse `glibc uyumsuz: ...`; başka bir nedenle
     çalışmazsa — noexec, SELinux, `Exec format error` — `rc <n>: <stderr'in ilk dolu satırı>`, rc 126'da
     `(calistirma izni yok: noexec ya da SELinux?)` ipucuyla; wrk'de `-v`'nin rc 1'i normaldir, yalnız sürüm satırı
     yoksa `rc <n>, surum satiri yok: ...`) +
     `on_kontrol.sh yollar`. Bu istekler sunucu hedefte YALNIZ hedefte ölçülen `ip_yerel` `1` iken, serbest hedefte
     YALNIZ izin dosyası IP'yi kapsarken gider; aksi halde hiç istek gönderilmez ve yük makinesi sonucu `FAIL`
     (`hedef IP hedefte yerel degil ya da olculemedi; istek gonderilmedi` ya da `serbest izin listesi: <neden>;
     istek gonderilmedi`).
   - `kosu` → önce yük makinesi CPU kaydedicisi ayrık başlatılır (`setsid nohup timeout -k 30 <bütçe+120> env
     SURE=<bütçe+60> ARALIK=1 SONUC=<koşu dizini>/sonuc bash yuk_cpu_kaydedici.sh R<id> ... & echo $! > yuk_cpu.pid`;
     `failed_when: false`: başlamazsa koşu yine çalışır, yalnız yük CPU'su ölçülmez); sonra TEK async görev:
     `timeout -k 30 <bütçe> env -u LIMIT_MUAF ... bash kos.sh|wrk_kos.sh R<id> <K|B>`
     (`async: bütçe+300`, `poll: 15`); iki betiğe de aynı ortam gider (`HIZLAR`, `BAGLANTILAR`, `IS_PARCACIGI`,
     `TAVAN_RPS`, `MAXVU`, `K6=<koşu dizini>/arac/k6`, `WRK=<koşu dizini>/arac/wrk` ...); her betik kendine ait
     olmayanları yok sayar. Koşu bitince (aynı blok, yeni play AÇILMAZ: bekçi ve Portal aynası play sırasını
     sayar) yük CPU kaydedicisi Play 4'ün sırasıyla durdurulur: `yuk_cpu.pid` → `/proc/<pid>/cmdline` içinde
     `<koşu dizini>/yuk_cpu_kaydedici.sh` → `kill -TERM` → `wait_for /proc/<pid> absent` en çok 25 sn (`-k 30`'dan
     küçük). Ardından (kaydedici başlamadıysa da) `tail -n 1 <koşu dizini>/yuk_cpu.out` → `yt_yk_cpu_son` (ASCII,
     200; set_stats `kosu.yukm_cpu_son_satir`). Play 3 kurtarma yoluna düşerse kaydedici `SURE` ile kendisi biter;
     Play 7 (`durdur.sh`) onu da öldürür.
4. **yuk_hedef** (serbestte atlanır): kaydediciye `kill -TERM <pid>` (pid'in komut satırı koşu dizinini içeriyorsa),
   bitmesi en çok 290 sn beklenir (trap `bitir` `bilgi_*.txt` yazar; sarmalayıcının KILL'i 300 sn'de),
   `log_*.tsv` gzip'lenir.
5. **yuk_hedef + yuk_makine** (serbestte yalnız yük makinesi): sonuç dosyaları (toplam ≤ 200 MiB) kontrol düğümüne
   `fetch` (düz). Sonuç dizini hedefte `<dizin>/R<id>`, yük makinesinde `<dizin>/sonuc/R<id>`
   (`groups['yuk_hedef']` kullanılmaz: serbestte grup yoktur, bkz. "Tuzaklar").
6. **localhost** (`ignore_unreachable: true`): dosyalar GBLABT02 üzerinden
   `<yuk_cikti_kok>/<yuk_run_id>/`'ye kopyalanır, `SHA256SUMS` yazılır; `istemci_*.json` özetleri okunur;
   kontrol düğümündeki geçici dizin silinir. GBLABT02'ye giden her görev `register` edilir ve hemen
   ardından `<kayıt> is unreachable` ise (döngülü dosya kopyasında öğeler de: `<kayıt>.results`'ta
   `unreachable`) `fail` → `rescue` (`/sw kopyasi: GBLABT02 erisilemedi (...)`); kopya o zaman asla
   "tamam" sayılmaz (`sw_dizin: null`). Koşu başarısı serbestte yalnız yük makinesinden (kaydedici yok).
7. **yuk_hedef + yuk_makine** (serbestte yalnız yük makinesi): `kosu`/`durdur` → `durdur.sh` (kalan süreçler; motor
   bağımsız); koşu dizini silinir (`on_kontrol`: her zaman; `durdur`: süreçler durduysa; `kosu`: süreçler durduysa VE
   (/sw kopyası tamam YA DA koşu betiği hiç başlamadı)). Koşu betiği başladı ama /sw kopyası yoksa (DUR'un ya da
   başarılı ama kopyalanamamış koşunun TEK kopyası) dizin kalır ve yerleri `hata` metninin sonuna eklenir:
   `kosu dizini silinmedi (/sw kopyasi yok, veri elle kurtarilabilir): <host>:<dizin>, ...`
   (metnin geri kalanı bu not sığsın diye tam ölçüyle kısaltılır; toplam en çok 300 karakter). Süreçler durdurulamadığı
   ya da durdurma doğrulanamadığı için silinmeyen dizin de (`kosu` ve `durdur`) aynı yere yazılır: `kosu dizini silinmedi
   (durdurma tamamlanmadi; elle silin): <host>:<dizin>`; `kosu`'da ayrıca `durdurma <H>: <neden>` ve durum FAIL
   (/sw kopyası tamam olsa da: süreç kalmış olabilir). `always`'te `<koşu dizini>/arac` HER YOLDA silinir (koşu dizini
   korunsa da; `ignore_errors`: silinemezse Play 10 `temizlik <Y>: arac kopyasi silinemedi`). **Temizlikte makineye
   erişilemezse** (ignore_unreachable altında kayıt `failed` değil `unreachable`dır ve Play 7'nin yerel `set_fact`'leri
   `yt_p7_bitti`'yi yine yazar) sessiz geçilmez: `temizlik <H>: kosu dizini silinemedi (erisilemedi): <dizin>`,
   `temizlik <Y>: arac kopyasi silinemedi (erisilemedi)`, durum FAIL. Koşu dizini açılmış bir hostta Play 7 hiç
   tamamlanmadıysa (`yt_p7_bitti` yok, `yt_p7_hata` yok): `temizlik <H>: play tamamlanmadi (erisilemedi ya da dustu)`.
8. **yuk_derleme — araclar: indirme ve derleme** (yalnız araclar; become www; diğer kiplerde grup yok, atlanır):
   www ev dizininde `~/.portal_yuktesti/arac_<id>/` (`/tmp` noexec: kullanılmaz) altında `indir/`, `derleme/`,
   `cikti/`, `tmp/` (önce aynı id'nin yarım denemesi silinir); 1 günden eski başka `arac_<id>` derleme dizinleri
   (iptal edilmiş işler) silinir, bu işinki hariç; `arac_hazirla.sh` kopyası (sha1, sahip, izin kapısı); üç `get_url`
   (k6 `checksums.txt` — arşivin satırı TAM bir kez ve Portal'ın sabit `yuk_k6_arsiv_sha256`'sıyla AYNI olmalı; k6
   linux-amd64 arşivi `checksum: sha256:<yuk_k6_arsiv_sha256>`; wrk 4.2.0 kaynak arşivi `checksum:
   sha256:<yuk_wrk_kaynak_sha256>`) — vekil ortamı YALNIZ bu üç görevde (`environment: "{{ yt_proxy_ortam }}"`),
   `validate_certs: true`, `tmp_dest` derleme dizini; ardından diskteki iki arşivin sha256'sı sabit değerlerle bir kez
   daha karşılaştırılır (`arsiv ozeti sabit degerden farkli (...); hicbir sey acilmadi, derlenmedi ya da
   calistirilmadi`) — **hiçbir arşiv sabit özetle doğrulanmadan açılmaz, derlenmez, çalıştırılmaz**; `arac_hazirla.sh`
   vekilsiz (`env -u ...`, `timeout -k 30 1800`, `TMPDIR=<dizin>/tmp`); iki ikilinin sha256'sı ve `fetch` ile kontrol
   düğümüne aktarım. `always`'te derleme dizini her yolda silinir.
9. **localhost — araclar: /sw yayını** (`ignore_unreachable: true`; Play 6 yapısı): kontrol düğümündeki kopyalar
   derlenenle aynı mı; GBLABT02 üzerinden (bağlanan kullanıcı) `<yuk_cikti_kok>/araclar/` dizini (yoksa `0755` ile
   oluşturulur, varsa moduna dokunulmaz; dizin değilse `araclar yolu dizin degil`, oluşturulamazsa `araclar dizini
   olusturulamadi (GBLABT02, 0755): ...`), hedef `<id>/` zaten varsa DUR, `.<id>.yarim/` (0755) altına `k6`, `wrk` (0644), `SHA256SUMS`, `manifest.json`; `mv -T` ile son ada;
   geri okuma (sha256, düzenli dosya, 0644). Her GBLABT02 görevinin hemen ardından `is unreachable` fail'i; `rescue`
   yarım dizini siler (erişilemezse kalır), `always` kontrol düğümü dizinini siler.
10. **localhost — sonuç**: `set_stats nginx_loadtest_result` **her yolda** (girdi reddi, erişilemeyen
   host, betik hatası, derleme hatası dahil; derleme düşerse `rescue` en küçük FAIL sonucunu yazar),
   ardından `durum` OK değilse job düşürülür (`DUR` dahil; Portal'ın okuyuşu aşağıda). Serbestte hedefin
   hostvars'ına HİÇ erişilmez (her erişim `sunucu` dalında ya da kısa devreyle korunur).

**araclar kipi**: Play 1 → Play 8 → Play 9 → Play 10; Play 2-7'nin grubu yoktur ve atlanır. Koşu kiplerinde Play 8'in
grubu yoktur, Play 9 atlanır.

Her uzak play ve GBLABT02'ye delegate eden /sw play'leri `ignore_unreachable: true` ve
`block`/`rescue` taşır: bir host (ya da GBLABT02) düşse de sonraki play'ler (durdurma, temizlik,
sonuç) koşar. Play 2, Play 3 ve Play 8'in ilk görevi (`getent`, become'suz) register edilir; host ssh ile
erişilemezse hemen ardındaki `is unreachable` fail'i rescue'ya `erisilemedi (ssh): <ssh iletisi>` verir
ve Play 10 `hedef <H>: erisilemedi (ssh): ...` / `yuk makinesi <Y>: erisilemedi (ssh): ...` / `derleme makinesi <D>:
erisilemedi (ssh): ...` yazar ("Tuzaklar"). localhost play'leri hiç extra_var gelmese de koşar (AWX'ten elle başlatma,
Variables prompt kapalı): üç ad (işlem, hedef türü, motor) localhost play'lerinde her yerde `| default(...)` ile geçer;
girdi kapısı reddeder, Play 6 ve Play 9 atlanır, Play 10 `girdi reddedildi` sonucunu yayınlar. Uzak play'lerde hedef türü ve
motor yalnız `on_kontrol`/`kosu` dallarında ve işlem karşılaştırmasıyla kısa devre korunarak geçer: eski Portal'ın
hedef türü ve motor göndermeyen durdurması uzak play'lerde hiçbir ifadeyi patlatmaz.

## Portal ↔ AWX sözleşmesi

Katalog anahtarı `nginx_loadtest_run` (kategori `nginx`, env `NGINX_LOADTEST_RUN_TEMPLATE_ID`),
Portal `BEKLENEN_PLAYBOOK.nginx_loadtest_run = 'nginx_loadtest.yml'`. **`limit` her zaman boş**;
`LIMIT_MUAF` hiç gönderilmez; vekil (`yuk_proxy`) YALNIZ araclar işinde gider. Değerler string beklenir (Portal sayı
da gönderebilir; playbook `| string` ile denetler). Koşu kiplerinde (on_kontrol, kosu, durdur) Portal HER ZAMAN 34
değişkenin hepsini gönderir; motora ait olmayan adım değişkenleri boş metindir (`''`), durdurda araç değişkenleri
`''`. araclar işinde TAM 10 değişken gider (`yuk_islem`, `yuk_run_id`, `yuk_derleme_host`, `yuk_k6_surum`,
`yuk_wrk_surum`, `yuk_k6_arsiv_sha256`, `yuk_wrk_kaynak_sha256`, `yuk_proxy`, `yuk_cikti_kok`, `yuk_son_epoch`; bu sıra).
Tablo 40 değişken: 34 koşu + 6 yalnız araclar.

| Değişken | Tip | Denetlendiği kip | Kural |
|---|---|---|---|
| `yuk_islem` | string | her kip | `on_kontrol` \| `kosu` \| `durdur` \| `araclar` |
| `yuk_run_id` | string | her kip | `^[0-9]{1,10}$` (Portal koşu id'si; ADIM `R<id>`, koşu dizini `~www/.portal_yuktesti/<id>`; araclar: araç seti id'si, /sw dizini `<kök>/araclar/<id>`) |
| `yuk_hedef_turu` | string | on_kontrol, kosu (durdurda yoksa `sunucu`) | `sunucu` \| `serbest` |
| `yuk_hedef_host` | string | on_kontrol, kosu, durdur | sunucu: `^[A-Z0-9][A-Z0-9-]{1,30}$`, ad kuralına göre DEV/TEST/QA (`GBNG[WX][A][DTQ]...`), EDU istisnası (GBNGXT51) değil; serbest: `''` (dolu ise red) |
| `yuk_yuk_host` | string | on_kontrol, kosu, durdur | aynı ad kuralı; hedeften FARKLI |
| `yuk_motor` | string | on_kontrol, kosu | `k6` \| `wrk` |
| `yuk_hedef_ip` | string | on_kontrol, kosu | IPv4; 0/127/169.254/224+ değil; sunucuda hedefte yerel olduğu ön kontrolde ve koşu başında ölçülür |
| `yuk_host_basligi` | string | on_kontrol, kosu | RFC1123 küçük harf, port/joker yok, ≤ 253 (yalnız biçim; hedefin server_name listesinde olması ŞART değil) |
| `yuk_sni` | string | on_kontrol, kosu | `0` (Host başlığı, URL IP) \| `1` (URL host + `--resolve`/k6 `hosts`); motor wrk ise yalnız `0` |
| `yuk_senaryo_tur` | string | on_kontrol, kosu | `K` \| `B` |
| `yuk_senaryo_b64` | string | on_kontrol, kosu | TSV'nin base64'ü; çözülmüş ≤ 200 KB, 1..400 veri satırı + isteğe bağlı tek `#` başlık |
| `yuk_senaryo_sha256` | string | on_kontrol, kosu | çözülmüş baytların sha256'sı (64 hex) |
| `yuk_hizlar` | string | on_kontrol, kosu | k6: `^[0-9]{1,4}( [0-9]{1,4}){0,4}$`, her biri 1..5000 (serbest 1..200); wrk: `''` |
| `yuk_maxvu` | string | on_kontrol, kosu | k6: 10..1000 (serbest 10..50); wrk: `''` |
| `yuk_baglantilar` | string | on_kontrol, kosu | wrk: hızlarla aynı biçim, her biri 1..199 (serbest 1..50), tam sayı olarak tekil; k6: `''` |
| `yuk_is_parcacigi` | string | on_kontrol, kosu | wrk: 1..16, en küçük bağlantı sayısından büyük değil ve her bağlantı sayısını tam böler; k6: `''` |
| `yuk_tavan_rps` | string | on_kontrol, kosu | wrk: 1..5000 (serbest 1..200); Portal verir (sunucu: 5000, serbest: 200), kullanıcı girmez; k6: `''` |
| `yuk_son_epoch` | string | on_kontrol, kosu, araclar | `^[0-9]{10}$`; şimdi ≤ değer ≤ şimdi + 1800 (AWX EE saati; Portal şimdi + 900 gönderir); durdurda denetlenmez |
| `yuk_tekrar` | string | on_kontrol, kosu | 1..3 |
| `yuk_kip` | string | on_kontrol, kosu | `yeni` (her istek yeni bağlantı) \| `ka` (keep-alive) |
| `yuk_protokol` | string | on_kontrol, kosu | `h1` (HTTP/1.1) \| `h2` (HTTP/2); YOKSA `h1` (eski Portal); `h2` yalnız motor `k6` ve `yuk_kip` `ka` ile; durdurda denetlenmez. 34. koşu değişkeni (bkz. "Protokol") |
| `yuk_ae` | string | on_kontrol, kosu | `br` \| `gzip` \| `identity` |
| `yuk_srv_ayar` | string | on_kontrol, kosu | `0` \| `1`; YOKSA `0` (eski Portal). `1` yalnız `yuk_hedef_turu` `sunucu` ve on_kontrol \| kosu; durdur ve serbest hedefte red. 35. koşu değişkeni ("Sunucu ayarı (koşu öncesi)") |
| `yuk_srv_seviye` | string | on_kontrol, kosu | `''` ya da rakam: `br` 1..11, `gzip` 1..9; `identity` ve ayar `0` iken `''`; ayar `1` ve `br` / `gzip` iken zorunlu |
| `yuk_srv_static` | string | on_kontrol, kosu | `0` \| `1`; ayar `0` iken `0` |
| `yuk_srv_dizin` | string | on_kontrol, kosu | `''` ya da `^/usr/nginx/applications/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$`, `..` yok; ayar `1` iken HER ZAMAN zorunlu (static kapalı da: silme için), ayar `0` iken `''` |
| `yuk_isinma_sn` | string | on_kontrol, kosu | 5..60 |
| `yuk_sure_sn` | string | on_kontrol, kosu | 30..300 |
| `yuk_bosluk_sn` | string | on_kontrol, kosu | 0..120 |
| `yuk_bosta_bas_sn` | string | on_kontrol, kosu | 30..120 (kaydedicinin yük öncesi boşta örneği; serbestte kaydedici yok, yalnız bütçeye girer) |
| `yuk_butce_sn` | string | on_kontrol, kosu | ≤ 2700 (`yuk_srv_ayar` `1` iken ≤ 1800) ve ≥ `bosta + adım_sayısı × tekrar × (isinma + sure + bosluk) + 120` (adım sayısı: k6'da hız, wrk'de bağlantı sayısı) |
| `yuk_k6_yolu` | string | on_kontrol, kosu | SABİT işaret `/yeni-playbook-gerekli/k6` (tur 4; ikili artık koşu dizinindeki araç kopyasıdır). Eski playbook bu yolu kabul eder ama bulamaz: yeni Portal + eski playbook ön kontrolü "k6 yok ya da calistirilamiyor" ile düşer, eski `/home/www/bin` ikilisi SESSİZCE kullanılmaz |
| `yuk_wrk_yolu` | string | on_kontrol, kosu | SABİT işaret `/yeni-playbook-gerekli/wrk` (aynı gerekçe) |
| `yuk_arac_dizin` | string | on_kontrol, kosu | Etkin araç setinin /sw dizini: `^/sw/BMW_PORTAL(_DEV)?(/...)+/araclar/[0-9]{1,10}$`, `..` yok, `<yuk_cikti_kok>/araclar/` ile başlar; durdurda `''` (denetlenmez) |
| `yuk_k6_sha256` | string | on_kontrol, kosu | Etkin setin k6 sha256'sı (64 küçük hex; iki motorda da); yük makinesi kopyayı YALNIZ bununla doğrular; durdurda `''` |
| `yuk_wrk_sha256` | string | on_kontrol, kosu | Etkin setin wrk sha256'sı (64 küçük hex; motor k6'da da denetlenir); durdurda `''` |
| `yuk_ua_onek` | string | on_kontrol, kosu | `^[a-z][a-z0-9-]{2,30}$` (Portal: `portal-yuktesti`) |
| `yuk_cikti_kok` | string | on_kontrol, kosu, araclar | `^/sw/BMW_PORTAL(_DEV)?/...`, `..` yok (Portal: `NGINX_LOADTEST_DIR`, varsayılan `/sw/BMW_PORTAL/nginx_loadtest`) |
| `yuk_derleme_host` | string | araclar | `^[A-Z0-9][A-Z0-9-]{1,30}$` ve (playbook listesi `yt_derleme_hostlari`: GBLABT02, ya da ad kuralına göre DEV/TEST/QA nginx makinesi, EDU değil); Portal ayrıca `NGINX_LOADTEST_DERLEME_HOSTLARI` listesini ister |
| `yuk_k6_surum` | string | araclar | `^v0[.](4[5-9]\|5[0-9])[.][0-9]{1,2}$` (Portal varsayılanı `v0.49.0`; 1.x desteklenmez) |
| `yuk_wrk_surum` | string | araclar | tam `4.2.0` |
| `yuk_k6_arsiv_sha256` | string | araclar | ZORUNLU 64 küçük hex (Portal `NGINX_LOADTEST_K6_ARSIV_SHA256`; boş kabul edilmez): resmî checksums satırı bununla aynı olmalı, arşiv `get_url checksum:` ve diskte yeniden sha256 ile doğrulanır |
| `yuk_wrk_kaynak_sha256` | string | araclar | ZORUNLU 64 küçük hex (Portal `NGINX_LOADTEST_WRK_KAYNAK_SHA256`; boş kabul edilmez, ilk kullanımda güven YOK): kaynak arşivi `get_url checksum:` ve diskte yeniden sha256 ile doğrulanmadan açılmaz / derlenmez |
| `yuk_proxy` | string | araclar | `''` (vekilsiz) ya da `^http://[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?:[0-9]{1,5}$` (kimlik bilgisi, yol, büyük harf YOK); YALNIZ Play 8'in üç `get_url` görevine ortam olarak gider |

`durdur` kipinde yalnız ilk assert (işlem, koşu kimliği, hedef türü, hedef, yük makinesi) denetlenir; diğerleri gelse
de kullanılmaz (araç değişkenleri dahil). **Durdur kipinde `yuk_hedef_turu` yoksa `sunucu` sayılır**: eski Portal'ın 4,
23 ya da 30 değişkenli durdurması yeni playbook'la çalışır. on_kontrol/kosu'da `yuk_hedef_turu`, `yuk_motor` ve beş araç
değişkeni ZORUNLUDUR: eski Portal'ın (tur 3) 30 değişkenli on_kontrol/kosu isteği araç assert'inin iletisiyle
reddedilir ("arac degiskenleri eksik ya da gecersiz ... Portal surumu playbook ile uyumsuz ya da araclar hazirlanmadi;
hicbir sey yapilmadi"); hiçbir host eklenmez. Teslim sırası (tur 4): önce bu deponun zip'i (yeni `files/arac_hazirla.sh`
ayrıca sayılır), sonra Portal, sonra Admin "Araçları hazırla"; arada ön kontrol/koşu reddedilir, durdur çalışır.

### Karışık sürüm penceresi

| Durum | Sonuç |
|---|---|
| Eski Portal (`yuk_protokol` yok) + yeni playbook | `default('h1')`: bugünkü HTTP/1.1 davranışı, set_stats `protokol: 'h1'` |
| Yeni Portal (h2) + eski playbook | Eski playbook `yuk_protokol`'ü tanımaz, HTTP/1.1 koşar; ön kontrolde `alpn_h2` gelmez (Portal engeli "ölçülemedi"), set_stats'ta `protokol` yankısı yok, istemci satırında `protokol` kolonu yok (analiz `protokol_farkli(beklenen=h2,olculen=yok)`) |
| Yeni Portal + eski playbook, ön kontrol | Eski kapı işaret yolunu kabul eder; eski Play 3 ikiliyi bulamaz: "k6 yok ya da calistirilamiyor: /yeni-playbook-gerekli/k6" (wrk'de "wrk yok ..."), FAIL; koşu başlamaz |
| Yeni Portal + eski playbook, araclar | Eski 1. assert `yuk_islem`'i reddeder; set_stats `islem: araclar` yankısıyla gelir, Portal "Ansible deposu güncel değil" der |
| Eski Portal (`alpn_kaynak`'ı tanımaz) + yeni playbook, h2 ön kontrol, curl HTTP/2'siz yük makinesi | Betik artık reddetmez (yollar HTTP/1.1, ALPN openssl ile); eski Portal `curl_h2 false`'u engel sayar ve koşuyu bugünkü gibi başlatmaz (fail-closed). curl HTTP/2'li makinede davranış aynı |
| Yeni Portal + eski playbook, h2 ön kontrol, curl HTTP/2'siz yük makinesi | Eski betik istek atmadan `SONUC FAIL` verir, `alpn_kaynak` gelmez; Portal bugünkü "curl HTTP/2 desteklemiyor" engelini gösterir |
| Eski Portal (`yuk_srv_*` yok) + yeni playbook | `default('0')` / `default('')`: ayar kapalı, bugünkü davranış; `sunucu_ayar: null` |
| Yeni Portal (sunucu ayarı) + eski playbook | Eski playbook `yuk_srv_*`'ı tanımaz, ayarı UYGULAMADAN koşar; `on_kontrol.srv_hazirlik` gelmez, Portal koşuyu BAŞLATMAZ (ön kontrol engeli: yük basılmaz, gece kuyruğu boşa gitmez); eski ön kontrolden koşu başlamış olsa `hazirlik_*.txt` gelmez, GEÇERSİZ (`sunucu_ayari_kanitsiz`): sessiz yanlış ölçüm olmaz |
| Eski Portal + yeni playbook, ön kontrol / koşu | Araç assert'i (2. assert'ten önce) reddeder; hiçbir host eklenmez |
| Durdur (her iki pencere) | Çalışır (araç değişkenleri durdurda denetlenmez) |
| Zip'te `files/arac_hazirla.sh` eksik | Her kip "betiklerden biri yok" ile düşer |

### Senaryo satırı

`agirlik<TAB>har<TAB>tur<TAB>boyut<TAB>yol` — kos.sh / yuk_k6.js / har_senaryo.py ile aynı beyaz
liste: `^[0-9.]+\t[0-9]+\t[a-z]+\t[a-z]+\t/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$`. Ek olarak `//` ile
başlayan ya da `..` parçalı yol, `;` içeren yol (ör. `;jsessionid=...`: oturum bilgisi senaryoya
giremez; `yt_re_kotu_yol`), CR ve ikinci bir `#` satırı reddedilir. Yük makinesine yalnız bu dosya
gider (`~www/.portal_yuktesti/<id>/senaryo/<K|B>.tsv`, 0600) ve sha256'sı yeniden doğrulanır. wrk_kos.sh ve
yuk_wrk.lua aynı beyaz listeyi yeniden uygular.

### set_stats: `nginx_loadtest_result` (surum 2)

Tek yazar localhost, `per_host: false`, `aggregate: false`, `fail`'den ÖNCE ve koşulsuz. Toplam < 16 KB.

```
{ surum: 2, run_id, islem, hedef_turu: 'sunucu'|'serbest'|null, motor: 'k6'|'wrk'|null, protokol: 'h1'|'h2'|null,
  durum: 'OK'|'FAIL'|'DUR', hata: <≤300 karakter|null>,
  sunucu_ayar: null | { istendi (bool), hazirlik: 'ok'|'fail'|null, hazirlik_metin (str|null), gz_uretilen, br_uretilen,
                gz_silinen, br_silinen, atlanan (int|null; yalnız koşu), uyarilar ([str]), geri_alma: 'ok'|'uyari'|'hata',
                geri_alma_metin (str) },
  on_kontrol: { ip_yerel (bool|null), server_name_var (bool|null), master_sayisi (int|null), web_log_df (int|null),
                log_dizini_okunur (bool|null), log_format_ua (bool|null), statik_direktif (bool|null),
                hazirlik_yedek (bool|null; hedefte geri alınmamış yedek), srv_hazirlik ('ok'|'fail'|null; `uygula` sonucu),
                ip_yuk_makinesinde (bool|null), serbest_ag (str|null),
                k6_var (bool|null), k6_surum (str|null), k6_sha256 (str|null),
                wrk_var (bool|null), wrk_calisiyor (bool|null), wrk_surum (str|null), wrk_sha256 (str|null),
                arac_dogrulandi (bool|null), arac_sha256 (str|null), arac_glibc (str|null), arac_hata (str|null),
                yollar_toplam, yollar_200, ilk_hatalar: [{yol, status}] (≤20),
                sikistirma: {statik, dinamik, sikistirmasiz},
                protokol ('h1'|'h2'|null), curl_h2 (bool|null), alpn_h2 (bool|null),
                alpn_kaynak ('curl'|'openssl'|null), yollar_yanitli (int|null), yollar_h2 (int|null) } | null,
  kosu: { kos_rc (int|null), kaydedici_rc (int|null), bas_epoch, bit_epoch,
          istemci_ozet: [istemci_<TUR>.json içerikleri], dosyalar: [{ad, bayt}], sw_dizin (str|null),
          yukm_cpu_basladi (bool|null), yukm_cpu_son_satir (str ≤ 200 ASCII|null) } | null,
  durdur: { durdurulan: ["<HOST> <ad> pid <pid> <TERM|KILL|KALDI>"] } | null,
  araclar: { arac_id (int), derleme_host, derleme_rhel, derleme_glibc, derleme_os, k6_surum, k6_surum_satiri,
             k6_sha256, k6_arsiv_sha256, k6_statik (bool|null), wrk_surum, wrk_surum_satiri, wrk_sha256,
             wrk_kaynak_sha256, wrk_kaynak_sabit (bool), wrk_glibc_gerekli, wrk_openssl, wrk_luajit,
             wrk_kutuphaneler, sw_dizin (str|null) } | null }
```

Üst düzey anahtarlar her yolda aynıdır (12; `surum` 2 kalır, `araclar` ve `protokol` eklemelidir). araclar işinde `hedef_turu`,
`motor`, `on_kontrol`, `kosu`, `durdur` `null`; `araclar` girdi reddinde `null`, aksi hâlde doludur (derleme ya da
yayın düşse de; ölçülemeyen alan `null`, `-` de `null`). `sw_dizin` YALNIZ /sw yayını ve geri okuma tamamsa dolu.
Koşu kiplerinde `araclar: null`. araclar hata metinleri: `girdi reddedildi, hicbir sey yapilmadi: <ileti>`,
`derleme makinesi <D>: erisilemedi (ssh): ...`, `derleme makinesi <D>: indirme basarisiz (k6 checksums | k6 arsivi |
wrk kaynagi): <get_url iletisi>`, `derleme makinesi <D>: derleme: <SONUC mesajı>`, `derleme makinesi <D>: play
tamamlanmadi (erisilemedi ya da dustu)`, `/sw yayini: <...>` (`arac dizini zaten var: ...`, `GBLABT02 erisilemedi
(...)`, `/sw okuma dogrulamasi tutmadi: ...`).

- `hedef_turu` / `motor`: geçerli girdinin yankısı (geçersiz ya da yoksa, ör. girdi reddi ya da eski Portal'ın
  durdurması, `null`). Portal yankıyı yalnız metinse koşu satırıyla karşılaştırır.
- `sunucu_ayar`: sunucu hedefte `yuk_srv_ayar` `1` ise ya da Play 7 bir yedek geri aldıysa dolu (durdur: `istendi false`);
  aksi `null` (rescue'daki yedek sonuçta da). Play 7 koşmadıysa `geri_alma` `hata`. Ön kontrolde `hazirlik` `fail` ise
  `sunucu ayari: <metin>` engeli. `geri_alma` `hata` ön kontrol ve durdurda `sunucu ayari geri alinamadi <H>: <metin>` ile
  job'u düşürür, koşuda düşürmez. `geri_al_durum baska` (yedek başka koşunun) `ok` yayınlanır, metin sahibini söyler.
- `on_kontrol.srv_hazirlik`: Portal sunucu ayarlı koşuyu yalnız `ok` ise başlatır (eski playbook yayınlamaz). `on_kontrol.hazirlik_yedek`
  `true` ve ön kontrol ayarsızsa Portal engel sayar (değişmiş konf ölçülürdü).
- `protokol`: `yuk_protokol | default('h1')` yankısı (yoksa `h1`, geçersizse `null`; rescue'daki yedek sonuçta da).
  Eski playbook bu anahtarı hiç yazmaz; Portal yalnız metinse satırın protokolüyle karşılaştırır.
- on_kontrol `protokol` / `curl_h2` / `alpn_h2` / `alpn_kaynak` / `yollar_yanitli` / `yollar_h2`: `on_kontrol.sh
  yollar`'ın satırları. `protokol` her yeni ölçümde dolu; diğerleri YALNIZ h2'de (h1'de `null`). `alpn_kaynak`
  ALPN'in nereden ölçüldüğü: `'curl'` (curl HTTP/2'li: `alpn_h2` true = yanıt veren her yol HTTP/2 ile yanıt verdi,
  false = en az biri HTTP/1.1, `null` = yanıtlı yol yok) ya da `'openssl'` (curl HTTP/2'siz: yollar HTTP/1.1 ile
  denendi, `yollar_h2` `null`; `alpn_h2` TEK `openssl s_client -alpn h2,http/1.1` bağlantısından: true = sunucu h2
  seçti, false = h2 dışı protokol ya da ALPN yok, `null` = openssl yok / bağlantı ya da el sıkışma kurulamadı).
  Başka her değer `null`; eski betik bu satırı basmaz (`null`: curl h2'siz yük makinesinde bugünkü gibi
  "ölçülemedi").
- `arac_*` (on_kontrol, iki türde): `arac_dogrulandi` koşu dizinindeki kopya Portal'ın sha256'sıyla doğrulandı mı
  (blok hiç koşmadıysa `null`), `arac_sha256` kopyanın ölçülen sha256'sı, `arac_glibc` yük makinesinin glibc'si,
  `arac_hata` kopya nedeni ya da `glibc uyumsuz: makinede glibc <g>, arac GLIBC_<x.y> istiyor`.
- Hedef alanları (`ip_yerel` ... `statik_direktif`) sunucuda bugünkü anlamda (ölçülmediyse bool alanlar `false`),
  serbestte yedisi `null`. `ip_yuk_makinesinde`: `on_kontrol.sh yollar`'ın ölçümü (iki türde; ölçülmediyse `null`).
  `serbest_ag`: yük makinesi izin dosyasında hedef IP'yi kapsayan girdi (yalnız serbest; aksi `null`).
- `k6_*` yalnız motor k6'da, `wrk_*` yalnız motor wrk'te dolu; diğerleri `null`; ikisi de koşu dizinindeki araç
  kopyasının ölçümüdür. `wrk_calisiyor` true ama `wrk_var` false: ikili çalışıyor, ama sürüm satırı okunamadı ya da 4
  altında (`make VER=4.2.0`'sız derleme; araç seti yeniden hazırlanır).
- `durum`:
  - `on_kontrol`: `OK` yalnız ölçülen taraflarda **engel** yoksa. Engeller (Portal koşuyu başlatmaz): sunucu
    hedefte hedefin sonucu OK değil, hedef IP hedefte yerel değil (ya da ölçülemedi: o zaman yük makinesinden HİÇ
    istek gitmez ve yük makinesi tarafı da `FAIL`), `/web_log` okunamıyor; iki türde yük makinesi sonucu OK değil
    (serbestte izin dosyası reddi dahil), araç kopyası doğrulanamadı (`arac kopyasi dogrulanamadi: <neden|olculmedi>`)
    ya da doğrulandı ama çalıştırılamadı (`arac calistirilamadi: glibc uyumsuz: ...`), h2 istendi ve hedef ALPN ile h2
    sunmuyor (`HTTP/2: hedef bu Host icin ALPN ile h2 sunmuyor (<n2>/<ny> yol h2)`; `alpn_kaynak` openssl ise
    `... sunmuyor (openssl ile olculdu; curl h2 desteklemiyor, yollar HTTP/1.1 ile denendi)`) ya da ölçülemedi
    (`HTTP/2 olculemedi (curl h2 desteklemiyor ya da yanitli yol yok)`; openssl ise `HTTP/2 olculemedi (curl h2
    desteklemiyor, openssl ile ALPN olculemedi)`; h1'de bu iki engel YOK; `curl_h2` false TEK BAŞINA engel değildir:
    openssl ALPN'i h2 ise engel yok), seçili motorun kopyası
    çalışmıyor ("k6 kopyasi calistirilamiyor: <dizin>/arac/k6"; wrk'de iki ayrı metin: "wrk kopyasi calistirilamiyor:
    <dizin>/arac/wrk" / "wrk calisiyor ama surumu okunamadi ya da 4 altinda (...); arac setini yeniden hazirlayin
    (Portal Arac paneli)"), hiç yol denenmedi, hedef IP yük makinesinde yerel (istek gönderilmez). **server_name `nginx -T`'de yok engel
    DEĞİLDİR**: `server_name_var` aynen yayınlanır, Portal onay isteyen bir uyarı gösterir (joker / regex ad olabilir).
    Uyarılar `durum`'u bozmaz: `yollar_200 < yollar_toplam`, `sikistirma.statik > 0`, `web_log_df ≥ 65` ya da
    `null`, `log_format_ua false`. `master_sayisi` ölçülemediyse `null` (0 değil: 0 bir ölçümdür, hidepid ya da
    nginx yok); Portal ölçülmüş ≠ 1'i engel (kaydedici koşuda zaten `HATA` ile durur), `null`'u uyarı sayar.
  - `kosu`: `OK` = `kos_rc 0` + (sunucuda `kaydedici_rc 0` ve hedef toplandı) + yük makinesi toplandı + /sw kopyası
    tamam; `DUR` = koşu betiği bir adımda durdu (`kos_rc` 4: kos.sh'de 429/protokol farkı/HTTP sürüm uyumsuzluğu/k6 hatası/boş özet, wrk_kos.sh'de
    429/5xx/soket/hata oranı/sayaç tutarsızlığı/wrk hatası/boş özet, ikisinde de TERM; 130: boşlukta kesildi) ve o
    ana kadarki veri /sw'de (sunucuda ayrıca `kaydedici_rc 0`; serbestte kaydedici yok); diğer her şey `FAIL`.
    Serbest koşuda izin dosyası reddi: `yuk makinesi <Y>: serbest izin listesi: <neden>; yuk gonderilmedi`.
  - `durdur`: `OK` = yük makinesinde ve (sunucuda) hedefte `durdur.sh` "kalan süreç yok" dedi; aksi `FAIL` (job düşer).
  - `araclar`: `OK` = /sw yayını ve geri okuma tamam ve hata yok; aksi `FAIL`.
- **DUR sözleşmesi**: `OK` dışındaki her `durum`'da (DUR dahil) son görev job'ı düşürür, AWX `failed`
  der. Portal kararı set_stats'tan verir: `durum: DUR` + AWX `failed` koşusu **başarılı** sayılır
  (`DONE`, geçerlilik en iyi `KISMI`; veri /sw'de), `durum: FAIL` her zaman başarısız, AWX `canceled`
  her şeyden önce gelir. Serbest hedefte DUR yalnız yük makinesinin `kos_rc`'sine (4/130) ve /sw kopyasına bakar.
- `kaydedici_rc`: kaydedici ayrık koştuğu için gerçek çıkış kodu alınamaz; `bilgi_*.txt` varsa `0`,
  `kaydedici.out`'ta `HATA:` varsa `2`, yoksa `null`; serbestte her zaman `null`.
- `bas_epoch`: sunucuda kaydedicinin başlatıldığı an, serbestte koşu betiğinin başladığı an; `bit_epoch`: /sw
  kopyasından hemen önce (kontrol düğümü saati). Ölçüm penceresinin asıl sınırları `bilgi_*.txt` ve `zaman.csv`'dedir.
- `istemci_ozet`: yalnız başarılı adımlar (`hatali_istemci_*` dahil DEĞİL; dosyalar /sw'de).
- `sw_dizin`: yalnız /sw kopyası (dosyalar + `SHA256SUMS`) tamamsa dolu; `null` iken Portal /sw'yi okumaz.
- Eksik artifact Portal'da başarı sayılmaz; değerler string de gelebilir (Portal hoşgörülü okur).

### Portal kilitleri ve Durdur

AWX iptali uzaktaki async koşu betiğini (kos.sh/k6 ya da wrk_kos.sh/wrk) ve ayrık kaydediciyi DURDURMAZ ("iş
bitti" ≠ "yük bitti"). Portal kilitleri bu yüzden işe bağlıdır ve işin türüne göre bırakılır. Anahtarlar: sunucu
hedefte `G|global` (yalnız koşu) + `T|<HOST>` + `L|<YUK>`; serbest hedefte `G|global` (ön kontrol DAHİL: serbest ön
kontrolün trafiği VIP arkasındaki bir hostun ölçüm penceresine girmesin) + `T|IP:<ip>` + `L|<YUK>`. VIP arkasındaki
hostlar `T` kilidiyle korunmaz (Portal VIP havuzunu bilmez; asıl koruma izin listesi ve G kilidi). araclar işi:
`A|araclar` (aynı anda tek araç hazırlama) + `L|<derleme makinesi>` (derleme bir yük makinesinde yapılırsa ölçümü
bozmasın), bağ türü `araclar`: `successful`/`failed` bitince bırakılır, `canceled`/`error` bitince süresiyle düşer
(uzakta `timeout -k 30 1800` ile biten derleme sürebilir).

- Bağlı iş `successful` biterse kilit hemen bırakılır. `durdur` kipindeki iş ancak ölçülen sunucular
  "kalan süreç yok" derse `successful` biter (aksi halde `durum: FAIL` ve job düşer).
- `kosu` işi `canceled`/`error` biterse, ya da `durdur` işi `failed`/`canceled`/`error` biterse kilit
  DOLU kalır ve yalnız süresiyle (koşunun süre sınırı + 180 sn) düşer: uzakta süreç kalmış olabilir.
- Sunucu ayarlı ön kontrol bağ türü `onk_srv`: `canceled`/`error` bitince kilit tutulur (koşu sütunu), temizlik play'i koşmadıysa
  hedef değişmiş kalmış olabilir. Portal geri alma sonucu görmezse otomatik durdurma işi başlatır ve kilidi ona bağlar.
- Portal "Durdur": koşan `kosu` işini iptal eder ve bu playbook'u `durdur` kipiyle başlatır; koşunun
  kilitleri durdurma işine bağlanır. Durdurma işi başlatılamazsa Portal hata döner ve kilitler süre
  sınırına kadar tutulur; Durdur yeniden denenebilir (`durdur.sh` idempotent: kalan yoksa `OK 0`).

### /sw düzeni

`<yuk_cikti_kok>/<yuk_run_id>/` (GBLABT02 üzerinden, `nginx_console_fetch.yml` ile aynı yazar: bağlanan
kullanıcı, `delegate_to: GBLABT02`, dizin 0777, dosya 0666; Portal aynı mount'u doğrudan okur):

- yük makinesinden: `istemci_<TUR>.json|csv`, `hatali_istemci_<TUR>.json|csv`, `zaman.csv`, `baslatilan.csv`
  (wrk'nin ara dosyaları `wrk_ara/` sonuç dizininin DIŞINDA kalır, toplanmaz, Play 7 siler)
- hedeften (yalnız sunucu): `sunucu_R<id>_<host>.csv`, `log_R<id>_<host>.tsv.gz`, `diger_R<id>_<host>.tsv`,
  `bilgi_R<id>_<host>.txt`, `konf_R<id>_<host>.txt`, `NOT.txt`, (2026-11-03) `bellek_R<id>_<host>.csv`
- `SHA256SUMS` (`sha256sum -c` biçimi; kontrol düğümündeki kopyalardan)

Kök: PROD `/sw/BMW_PORTAL/nginx_loadtest`, DEV `/sw/BMW_PORTAL_DEV/nginx_loadtest` (Portal
`docs/DEV-PROD.md` ile aynı ayrım). /sw koşu dizinlerinin saklama süresi bu playbook'ta yoktur. Araç setleri aynı kökün
`araclar/` alt dizinindedir ("Araç seti (/sw)").

## Betikler (kitten farklar ve Portal'a özgü betikler)

- `yuk_k6.js`: User-Agent öneki `UA_ONEK` (varsayılan `portal-yuktesti`, `^[a-z][a-z0-9-]{2,30}$`);
  `HOST_BASLIGI` zorunlu (GLOMO varsayılanı kaldırıldı, yoksa init'te hata); `PROTOKOL` (`h1` | `h2`, bkz.
  "Protokol"): `http2_kullanildi` eşiği yerine `protokol_uyumsuz` eşiği, setup her kontrol yolunun sürümüne bakar,
  CSV/JSON'a `protokol` ve `protokol_uyumsuz` eklenir. `HIZ` üst sınırı 5000 (kitte 450), `MAXVU` 1..1000 (kitte
  1..199): hedefin limit_req / limit_conn'u artık sınır değil, Portal'da UYARI (ön kontrol onayı). Önceden ayrılan VU
  (`preAllocatedVUs`) HIZ ≤ 450'de kitle aynı (`max(20, HIZ/5)`), üstünde `max(90, HIZ/20)` (5000 → 250; 1000 VU'yu
  baştan ayırmak bellek ve TUR başı init süresi ister, gerekirse k6 `maxVUs`'a kadar büyütür); ikisi de `MAXVU` ile
  sınırlı. Diğer eşikler, iptal mantığı ve çıktılar kitle aynı.
- `kos.sh`: `UA_ONEK` ve `PROTOKOL` k6'ya geçer (GODEBUG `http2client=0` yalnız h1'de); `HOST_BASLIGI` varsayılansız; `LIMIT_MUAF` YASAK (verilirse hata,
  k6'ya hep `0`); `HIZ` en çok 5000 (kitte 450); kendi pid'i `$SONUC/../kos.pid`; INT/TERM trap'i çalışan k6'yı (ve boşluk
  beklemesini) TERM ile sonlandırır — k6 ve `sleep` arka planda + `wait` ile koşar, trap ertelenmez;
  TERM'de adım `hatali_` önekiyle saklanır, `DUR: ... durduruldu (TERM ...)`, çıkış 4. wrk değişkenlerini yok sayar.
- `cpu_kaydedici.sh`: iki awk eşleşmesinde (`user-agent=<UA>/<ADIM>_` ve tırnaklı `"<UA>/<ADIM>_`)
  önek `UA_ONEK` (regex metakarakteri olamaz: aynı desen denetlenir) ve kaydın ADIM'i (`R<id>`, awk'a
  `-v ADIM`): test satırı YALNIZ bu koşunun TUR'larıdır; başka ADIM'ın satırı (ör. iptal edilmiş eski
  bir koşudan yetim kalmış k6, `R90` gibi önek çakışması dahil) `diger` trafiktir. Çıktılar kitle aynı.
- `on_kontrol.sh`: Portal'a özgü (dosya başında ayrıntı); hedefte koşu kapısı için de koşar.
- `durdur.sh`: Portal'a özgü. Adaylar: koşu dizinindeki `*.pid`'ler, `k6 run` (`[k]6`), wrk (`$2` adı `[w]rk...`
  VE komut satırında ` -s <kosu_dizini>/yuk_wrk.lua`; wrk_kos.sh wrk'yi bu argüman sırasıyla çağırır), argv[0]'ı
  `<kosu_dizini>/arac/` altında olan her süreç (araç kopyası: `k6 version`, wrk yükleme sınaması, takılmış `-v`; adı
  `arac`) ve `bash <kosu_dizini>/kos.sh|wrk_kos.sh|cpu_kaydedici.sh|yuk_cpu_kaydedici.sh|on_kontrol.sh`. Başka koşunun wrk'sine ve araç
  kopyasına dokunulmaz. Kopyadan çalışan `k6 run` / wrk yükü `<kosu_dizini>/arac/k6|wrk` yoluyla k6 / wrk kuralına da
  uyar.
- `arac_hazirla.sh` (araclar kipi, Play 8): kullanım `arac_hazirla.sh <dizin>` (`<www ev>/.portal_yuktesti/arac_<id>`),
  ortam `K6_SURUM`, `WRK_SURUM`, `TMPDIR`. Sıra: vekil ortamını siler (`unset ... http_proxy ...`) → girdi (dizin
  biçimi, sürümler, iki arşiv; çıkış 2) → derleme araçları (`tar gzip gcc make perl objdump ldd getconf sha256sum
  strings nproc`; eksik ilk ad, çıkış 3) → derleme makinesi bilgisi (`/etc/os-release`, `getconf GNU_LIBC_VERSION`) →
  k6: arşiv listesi (her üye `k6-<v>-linux-amd64/` altında, `..` ve mutlak üye yok) → yalnız `k6` üyesi
  `--no-same-owner --no-same-permissions` ile çıkarılır → `install -m 0700` → `k6 version` ilk satırı `k6 <v>` →
  `ldd` (statik mi) → wrk: arşiv listesi (`wrk-4.2.0/`) → çıkarma → `deps/` altında `openssl-*` ve LuaJIT var mı →
  `make -C ... -j <min(nproc, 4)> VER=4.2.0` (`derleme.log`) → `install -m 0700` → `wrk -v` satırı `wrk 4.2.0 ` →
  `ldd` (libssl / libcrypto / libluajit / liblua varsa ret) → `strings` (OpenSSL / LuaJIT sürümü) → `objdump -T`
  (gereken en yüksek `GLIBC_` sürümü). Çıktı `anahtar<TAB>değer` satırları (`derleme_rhel derleme_glibc derleme_os
  k6_surum_satiri k6_statik k6_glibc_gerekli wrk_surum_satiri wrk_kutuphaneler wrk_glibc_gerekli wrk_openssl
  wrk_luajit`; ölçülemeyen `-`) ve son satır `SONUC<TAB>OK|FAIL<TAB><mesaj>`; çıkış 0 / 2 / 3 / 4. `derleme/` ve
  `tmp/` çıkışta silinir. Ağ aracı, vekil ataması, işlemciye özgü bayrak ve sistem OpenSSL'i YOK.
- `wrk_kos.sh` (motor wrk): dış sözleşme kos.sh ile aynı; kullanım `wrk_kos.sh <ADIM> <K|B> [--kuru]`, çıkış 0 /
  2 (girdi ya da ön koşul, yük YOK) / 4 (DUR) / 130. Sıra: girdi denetimi (`BAGLANTILAR` ≤ 199 tekil en çok 5,
  `IS_PARCACIGI` 1..16 en küçük bağlantıdan büyük değil ve her bağlantıyı böler, `TAVAN_RPS` zorunlu 1..5000, `SNI`
  yalnız 0, `LIMIT_MUAF` yalnız 0, senaryo beyaz listesi) → plan (`--kuru` burada biter; dizin/pid yazılmaz) →
  `HEDEF` (`https://<IPv4>`, yol/port yok) ve `HOST_BASLIGI` → **hedef IP yük makinesinde yerel mi** (yerel ya da
  ölçülemediyse wrk `-v` dahil HİÇ çağrılmaz) → curl → `wrk -v` sürüm satırı (≥ 4) → `yuk_wrk.lua` yükleme
  sınaması → her TUR: 200 kapısı (kontrol yolu + senaryodaki tekil yollar, SIRALI tek curl isteği, istek başına 5
  sn, toplam 180 sn; sıkıştırma türü kontrol yolundan) → ısınma → ölçüm. TUR adı
  `R<id>_<SEN>_<KIP>_<AE>_<N>_r<r>` (N = bağlantı). Ara dosyalar `<kosu_dizini>/wrk_ara/`.
- `yuk_wrk.lua`: istek başlıkları yuk_k6.js ile aynı (Host, Accept-Encoding, `<UA_ONEK>/<TUR>/<faz>/<deneme>`; yalnız
  `yeni` kipinde `Connection: close`); ağırlıklı seçim yuk_k6.js `sec()` ile aynı ikili arama; `delay()` her çağrıda
  EN AZ `D = ceil(N * 1000 / TAVAN_RPS)` ms: iş parçacığı başına ilk `N / T` çağrı `D + math.random(0, D - 1)` (ilk
  istekler `[D, 2D)` aralığına yayılır), sonrakiler `D` (`T` = wrk_kos.sh'in wrk ortamına verdiği `IS_PARCACIGI`;
  init'te 1..16 ve N'yi tam böler); ilk 429 ya da ≥ 500 yanıtta `wrk.thread:stop()`; sayaçlar ayrı global sayılar;
  `done()` özet dosyasını yazar. Doğrulama `init()`'te, değerler ortamdan.

### wrk özet dosyası (yuk_wrk.lua → wrk_kos.sh)

`<kosu_dizini>/wrk_ara/ozet_<isinma|olcum>_<TUR>.tsv`: tam 21 satır `anahtar<TAB>tamsayı`, bu sırayla (`surum` = 1,
gecikmeler mikrosaniye):

```
surum istek bayt sure_us e_connect e_read e_write e_timeout e_status s1xx s2xx s3xx s429 s4xx s5xx sdiger
lat_max_us p50_us p95_us p99_us is_parcacigi
```

Eksik / fazla / biçimsiz anahtar = okunamadı. Tutarlılık (ısınma ve ölçüm özetinin ikisinde de): istek = s1xx + s2xx +
s3xx + s429 + s4xx + s5xx + sdiger, e_status = s429 + s4xx + s5xx + sdiger, is_parcacigi = `IS_PARCACIGI`. Tutarsızlık
429/5xx'ten ÖNCE denetlenir (Lua sayaçları güvenilmezse 429/5xx sayısı da güvenilmez; `e_status` wrk'nin C tarafında,
Lua'dan bağımsız sayılır).

DUR koşulları (wrk_kos.sh; ilk tutan, çıkış 4): TERM/INT; 200 kapısı; ısınmada (ölçüm KOŞULMAZ) özet yok, sayaç
tutarsızlığı, 429, 5xx, soket hatası toplamı > `SOKET_HATA_ESIGI` (10), hata oranı > `HATA_ORANI_ESIGI` (%1); ölçümde
özet yok ya da okunamadı, sayaç tutarsızlığı, 429, 5xx, soket, hata oranı, wrk rc ≠ 0, ölçüm isteği yok. http2 ve
dropped denetimi yoktur (wrk yalnız HTTP/1.1 konuşur, kapalı döngüde düşen iterasyon yoktur).

### wrk istemci dosyası eşlemesi (`istemci_<TUR>.csv` / `.json`)

Şema yuk_k6.js ile AYNI (32 kolon, JSON anahtar sırası `ozet_hesapla` ile aynı; wrk yalnız HTTP/1.1, `PROTOKOL=h2` rc 2). I = ısınma özeti, O = ölçüm özeti
(yoksa ısınma-DUR yolu: n_olcum 0). Ölçülemeyen istemci alanı boş / `null`, asla 0.

| alan | değer |
|---|---|
| tur, adim, senaryo, kip, ae | TUR, ADIM, SEN, KIP, AE |
| hiz | N (bağlantı sayısı) |
| n_olcum | O.istek (O yoksa 0) |
| rps_gercek | n_olcum / SURE (nominal süre, k6 gibi) |
| p50, p95, p99 | O.pXX_us / 1000 (ms; koordineli ihmal düzeltmeli); O yoksa, istek 0 ya da lat_max_us 0 ise null |
| ttfb_p95, tls_p95, connect_p95 | null (wrk ölçmez) |
| hata_orani | min(1, (s1xx + s4xx + s429 + s5xx + sdiger + e_connect + e_read + e_write + e_timeout) / (istek + e_connect + e_read + e_write)) (O'dan; payda 0 ya da O yok → null) |
| n_429 | I.s429 + O.s429 (her faz, k6 gibi) |
| n_5xx | O.s5xx (yalnız ölçüm; O yoksa 0) |
| dropped | null |
| http2 | 0 (wrk yalnız HTTP/1.1; ölçülmüş 0) |
| bayt_istek | O.bayt / O.istek — TLS HARİÇ başlık + gövde (k6'nın data_received'ından farklı anlam) |
| p95_js, p95_css, p95_html, p95_json, p95_config, p95_buyuk | null |
| sikistirma_turu | 200 kapısının sonucu (STATIK / DINAMIK / YOK / boş) |
| isinma_sn, sure_sn, deneme | ISINMA, SURE, DENEME |
| protokol | `h1` (metin) |
| protokol_uyumsuz | 0 (sayı) |

Biçim: CSV = başlık + TEK veri satırı; sayı `int(v*1000+0.5)/1000` (yuk_k6.js `hucre`), null boş. JSON 2 boşluk
girintili, sayı yuvarlanmamış, null `null`; NaN/sonsuz asla. İkisi de `.tmp` + `mv` (`LC_ALL=C`).

Çıktı adları ve biçimleri (istemci_*, zaman.csv, baslatilan.csv, sunucu_*, log_*, diger_*, bilgi_*,
konf_*) kitle **aynıdır**; Portal'ın analizi (karsilastir.py portu) bunlara dayanır. Portal'a özgü ek dosyalar
(`yukcpu_*`, `bellek_*`) ve `istemci_<TUR>.json`'daki `kodlama` anahtarı kitte yoktur; kit ve eski Portal onları atlar.

## Protokol (HTTP/1.1 | HTTP/2)

Tarayıcılar çoğunlukla HTTP/2 kullanır; `yuk_protokol` `h2` seçilirse k6 hedefle ALPN üzerinden HTTP/2 konuşur.

- Değerler `h1` | `h2`; değişken yoksa `h1` (eski Portal ve eski satırlar bugünkü HTTP/1.1 davranışıdır). `h2` YALNIZ
  motor `k6` ve kip `ka` ile: wrk yalnız HTTP/1.1 konuşur (`wrk_kos.sh` `PROTOKOL=h2`'yi rc 2 ile reddeder); tarayıcı
  HTTP/2'de bağlantıyı açık tutar, "her isteğe yeni bağlantı" h2'de temsil edici değildir. Ret her katmanda: Portal,
  playbook kapısı (`fail_msg` "protokol h1|h2 (h2 yalniz k6 ve kip ka)"), kos.sh (`PROTOKOL=h2 yalniz KIP=ka ile`),
  yuk_k6.js init.
- `PROTOKOL` ortamı playbook → kos.sh / wrk_kos.sh / on_kontrol.sh; kos.sh → k6 `-e PROTOKOL`. kos.sh miras
  `GODEBUG`'daki `http2client=` girdilerini siler; h1'de `http2client=0` ekler, h2'de eklemez (boş kalırsa `unset`).
- k6 denetimi: beklenen sürüm h1'de `HTTP/1.1`, h2'de `HTTP/2.0` (`res.proto`). setup() HER kontrol yolunun sürümüne
  bakar (200 denetiminden sonra; h2'de ileti "Hedef bu Host icin ALPN ile h2 sunmuyor; HTTP/1.1 ile kosun ya da SNI=1
  deneyin."). Isınma ve ölçümde beklenen dışı her yanıt `protokol_uyumsuz` sayacını artırır; eşik `count<1`
  abortOnFail. `http2_kullanildi` eşiksiz bilgidir (HTTP/2.0 yanıt sayısı). Boş `proto` (başarısız istek) uyumsuz
  sayılmaz, hata oranına girer.
- CSV/JSON şeması: 30 kolon AYNEN + sona `protokol` (`h1`|`h2`) ve `protokol_uyumsuz` (tam sayı) = 32. `http2`
  kolonunun anlamı yeni satırlarda "HTTP/2.0 yanıt sayısı (ısınma + ölçüm)": h2 koşusunda her yanıtta doludur, karar
  `protokol_uyumsuz`'dan verilir. Kolonu olmayan eski satırda bugünkü kural sürer (`http2 > 0` geçersiz).
- kos.sh DUR sırası: 429 → protokol → rc → `n_olcum` → dropped. Nedenler: `protokol farkli: istenen <p>, k6 ozeti
  '<p|yok>' (yuk_k6.js eski olabilir)`; h1 `HTTP/1.1 disi yanit (<n>): GODEBUG=http2client=0 tutmadi; k6 surumunu
  kontrol edin.`; h2 `HTTP/2 disi yanit (<n>): hedef bu Host icin h2 sunmuyor ya da baglanti HTTP/1.1'e dustu.`
  Eski `http2` kolonu DUR için okunmaz.
- Ön kontrol (`on_kontrol.sh yollar`): her ölçümde `protokol h1|h2` satırı. h2'de curl `--http2` (h1'de `--http1.1`,
  curl HTTP/2'siz ise bayraksız: bugünkü gibi); her zaman `curl_h2 1|0`. curl_h2 1: OZET'ten sonra `yollar_yanitli`,
  `yollar_h2`, `alpn_h2 1|0|-` (yollardan), `alpn_kaynak curl`. curl_h2 0 (ör. RHEL 7 curl'ü; AWX 3477866'da
  GBNGXT34 böyle reddedilmişti): ARTIK RED YOK; yollar h1 yolu gibi bayraksız denenir (200 / sıkıştırma ölçümü
  aynı), OZET'ten sonra `yollar_yanitli <n>`, `yollar_h2 -`, `alpn_h2 1|0|-`, `alpn_kaynak openssl`. ALPN TEK
  bağlantıda: `timeout <ZAMAN> openssl s_client -connect <HEDEF_IP>:443 -alpn h2,http/1.1` + SNI=1 `-servername
  <host>` / SNI=0 `-noservername` (k6 IP'ye SNI göndermez, aynı varsayılan sunucu seçilir; 1.1.1 öncesi openssl
  `-noservername`'i tanımaz ama SNI'yi zaten göndermez: seçeneksiz bir kez daha denenir), stdin `/dev/null`, çıktı
  yalnız geçici dosyada (BASILMAZ). k6 gibi `h2,http/1.1` sunulur: yalnız `h2` sunulsaydı http2'siz nginx el
  sıkışmayı `no_application_protocol` ile keserdi ve sonuç "sunmuyor" yerine "ölçülemedi" olurdu. `ALPN protocol:
  h2` → 1; `ALPN protocol: <başka>` / `No ALPN negotiated` → 0; openssl / timeout yok, bağlantı ya da el sıkışma
  kurulamadı (`Cipher is (NONE)`), seçenek desteklenmiyor ya da satır yok → `-` (fail-closed). Yanıtlı yol yoksa
  (`yollar_yanitli 0`, yollar denendi ama hepsi 000) ALPN yine ölçülür: ön kontrol h2 engeli koymaz (Portal ve
  playbook yalnız `yollar_toplam 0`'da "hiç yol denenmedi" ile engeller; burada yalnız "n/n yol 200 dönmedi"
  uyarısı çıkar). curl kaynağında aynı durum `alpn_h2 -` → "ölçülemedi" engelidir; iki kaynak bu noktada
  farklıdır, koşu güvenliğini k6 setup() (her kontrol yolunun sürümü) korur. Playbook engeli: h2 + `alpn_h2` false → `HTTP/2: hedef bu
  Host icin ALPN ile h2 sunmuyor (<n2>/<ny> yol h2)` (openssl: `(openssl ile olculdu; curl h2 desteklemiyor, yollar
  HTTP/1.1 ile denendi)`); h2 + `null` → `HTTP/2 olculemedi (...)`. `SONUC` OK/FAIL anlamı değişmez. Ön kontrolde
  k6'nın kendisi istek atmaz: h2 kanıtı curl ya da openssl ALPN'idir, k6'nın kanıtı koşu başındaki setup() ve her
  yanıtı sayan `protokol_uyumsuz` (başarısızsa ilk TUR yük üretilmeden DUR); koşu güvenliği curl'e bağlı değildir.
- ALPN notu: SNI kapalıyken nginx ALPN'i IP:443'ün varsayılan sunucusunun http2 ayarıyla seçer; `listen ... http2`
  (eski biçim) dinleme soketi geneli, `http2 on;` (1.25.1+) SNI ile seçilen server bloğu. Hedef h2 sunmuyorsa `SNI=1`
  ile yeniden denenebilir.
- h2 ölçüm modeli (MAKUL, sahada ölçülmedi): k6 v0.49 her sanal kullanıcıda kendi bağlantısında istekleri SIRAYLA
  gönderir (VU başına tek akış); tarayıcıdaki tek bağlantıda çok sayıda eş zamanlı akış ölçülmez. İlk gerçek h2
  koşusunda nginx `connection_request` ile doğrulanır. Sonuçlar yalnız aynı protokolle koşulan koşularla karşılaştırılır.
- Sunucu logu ayrıştırması (cpu_kaydedici.sh) HTTP sürümüne bağlı değildir: h2 satırları da sayılır. TUR adı değişmez.

## AWX template ayarları

| Ayar | Değer |
|---|---|
| Playbook | `bmw_portal/nginx_loadtest/nginx_loadtest.yml` (bu klasör `bmw_nginx` ile aynı AWX projesinde) |
| Envanter | hedef/yük makinesi adlarını (kısa, büyük harf) ve GBLABT02'yi çözen envanter |
| Credential | makine credential'ı (uxmid; dzdo → www). Ek credential yok (DB'ye yazılmaz) |
| Variables — Prompt on launch | **AÇIK** (kapalıysa AWX extra_vars'ı sessizce yutar; Portal başlatmadan önce sınar) |
| Limit — Prompt on launch | kapalı (Portal `limit` göndermez; hedef add_host ile) |
| Execute / Admin rolü | **yalnız Portal servis hesabı**: extra_vars her değişkenden önce gelir (bkz. "Güvenlik"); şablonu AWX'te başlatabilen biri playbook kapılarını da ezebilir |
| Concurrent jobs (allow_simultaneous) | **AÇIK**: `durdur` kipi aynı şablonla, koşan `kosu` işi hâlâ canlıyken (AWX iptali 403 dönebilir) başlayabilmeli; kapalıysa durdurma işi koşunun bitmesini bekler. Eşzamanlı koşuları Portal kilitleri (hedef, yük makinesi, global) engeller |
| Timeout | **3600 sn**. Sınırlı beklemeler: koşu kapısı ≤ 130 + kaydedici hazırlığı ≤ 210 + koşu ≤ 2745 (bütçe ≤ 2700 + `-k 30` + poll 15) + kaydedici durdurma ≤ 290 + durdur.sh ≤ 100 = ≤ 3475 sn, üstüne toplama/kopya/temizlik görevleri: **en kötü durum ~3600 sn, sınırda** (sunucu ayarlı koşuda `hazirlik.sh` ≤ 310 + 610 + 130 + 250 sn daha, bu yüzden bütçe tavanı 1800: 3475 - 900 + 1300 = 3875 yalnız her bekleme birden tavana vurursa aşılır, o zaman yedek kalır ve Portal otomatik durdurma işiyle geri alır). Bu yalnız bu beklemelerin HEPSİ aynı koşuda tavana vurursa olur; o zaman AWX işi 3600. sn'de keser: set_stats yayınlanmaz (Portal FAILED + AWX açıklaması gösterir), Play 7 temizliği koşmaz, uzak süreçler kendi `timeout`'larıyla biter. Normal koşuda bütçeye ek süre birkaç dakikadır. Portal kilit TTL'si 75 dk bundan uzun |
| Forks | varsayılan (en çok iki uzak host) |
| Uzun iş otomatik iptali | listeye EKLENMEZ: AWX iptali uzak async koşuyu durdurmaz; Portal "Durdur" bu playbook'u `durdur` kipiyle koşturur |

Portal tarafı: `NGINX_LOADTEST_RUN_TEMPLATE_ID`, `NGINX_LOADTEST_AWX_SERVER_ID`,
`NGINX_LOADTEST_DIR`, `NGINX_LOADTEST_DERLEME_HOSTLARI`, `NGINX_LOADTEST_ARAC_PROXY`, `NGINX_LOADTEST_K6_SURUM`,
`NGINX_LOADTEST_K6_ARSIV_SHA256`, `NGINX_LOADTEST_WRK_KAYNAK_SHA256` ("Araç seti (/sw)"; `NGINX_LOADTEST_K6` ve
`NGINX_LOADTEST_WRK` ARTIK KULLANILMAZ), `NGINX_LOADTEST_YUK_HOSTLARI` (izinli yük makineleri), `NGINX_LOADTEST_SERBEST_AGLAR` (serbest hedef izin listesi:
virgüllü `a.b.c.d/n`, en küçük /24 ya da tek IP; boşsa serbest KAPALI), `NGINX_LOADTEST_SERBEST_YASAK` (isteğe bağlı
yasak ağlar, iki türde izin listesinden önce; tek geçersiz girdi tüm yük testini kapatır). Portal listeleri
playbook'a GÖNDERİLMEZ (extra_var olarak ezilebilirdi); playbook'un kendi listesi yük makinesindeki izin dosyasıdır.

## Araç seti (/sw)

Bu playbook yük makinelerine hiçbir şey KURMAZ. k6 ve wrk, Admin'in Portal › Yük Testi › Araçlar › "Araçları hazırla"
düğmesiyle başlattığı `araclar` işinde bir kez hazırlanır ve `/sw`'de saklanır; tüm makinelerde `/sw` bağlıdır.

Düzen (kök = koşu sonuçlarıyla AYNI `yuk_cikti_kok`, Portal `NGINX_LOADTEST_DIR`):

```
<kök>/araclar/                    yoksa Play 9 0755 ile oluşturur (varsa moduna dokunulmaz)
<kök>/araclar/.<id>.yarim/        yalnız yayın sırasında; başarıda mv -T ile <id>/ olur, hatada silinir
<kök>/araclar/<id>/               0755, sahibi AWX'in GBLABT02'ye bağlanan kullanıcısı
    k6                            0644 (çalıştırılabilir DEĞİL: /sw'den doğrudan koşulmaz)
    wrk                           0644
    SHA256SUMS                    iki satır ("<sha>  k6", "<sha>  wrk"; sha256sum -c biçimi)
    manifest.json                 sürümler, özetler, derleme makinesi bilgisi (to_nice_json)
```

- `<id>` Portal'ın araç seti satırıdır (`nginx_loadtest_araclar.id`); aynı dizine iki kez yazılmaz (hedef varsa iş
  `arac dizini zaten var` ile düşer). Sürüm adı dizine yazılmaz; sürümler `manifest.json`'da ve Portal DB'de.
- `manifest.json` alanları: `surum` (1), `arac_id`, `olusturma_epoch`, `awx_job_id`; `k6` {`surum`, `sha256`, `arsiv`,
  `arsiv_sha256`, `surum_satiri`, `statik`}; `wrk` {`surum`, `sha256`, `kaynak`, `kaynak_sha256`, `kaynak_sabit`,
  `surum_satiri`, `glibc_gerekli`, `openssl`, `luajit`, `kutuphaneler`}; `derleme` {`host`, `rhel`, `glibc`, `os`}.
- **Güven kökü Portal'dır**: yük makinesi `/sw`'deki `SHA256SUMS`'a ve `manifest.json`'a GÜVENMEZ; iki dosya insan
  içindir. Her ön kontrol / koşu kopyanın sha256'sını yalnız Portal'ın extra var ile verdiği değerle
  (`yuk_k6_sha256` / `yuk_wrk_sha256`) karşılaştırır. Doğrulanmamış ikili ASLA çalıştırılmaz (ne `version`/`-v`, ne yük)
  ve hemen silinir.
- Koşu kopyası: `<www ev>/.portal_yuktesti/<koşu id>/arac/<k6|wrk>` (dizin ve dosya 0700, sahibi www). `/tmp`
  KULLANILMAZ (`/tmp` noexec bağlıdır; derleme de www ev dizininde yapılır, `TMPDIR=<derleme dizini>/tmp`). Play 7 koşu
  dizinini korusa da `arac/`'ı her yolda siler; erişilemeyen makinede kopya kalır (sonraki Portal Durdur ya da elle
  silme).
- **k6** (`yuk_k6_surum`, Portal `NGINX_LOADTEST_K6_SURUM`, varsayılan `v0.49.0`; izinli `v0.45.0`..`v0.59.x`; 1.x
  desteklenmez: uç özet davranışı değişti, `handleSummary`/`data.metrics` biçimi sınanmadı): resmî
  `k6-<v>-checksums.txt` ve `k6-<v>-linux-amd64.tar.gz` indirilir; arşivin satırı checksums dosyasında TAM bir kez
  olmalı ve Portal'ın sabit `NGINX_LOADTEST_K6_ARSIV_SHA256` değeriyle AYNI olmalı; arşiv `get_url checksum:
  sha256:<sabit değer>` ile indirilir ve açılmadan önce diskte yeniden karşılaştırılır. Resmî Go ikilisi statiktir
  (`k6_statik`): RHEL 8 / 9 farkı k6'yı etkilemez. Sürüm değişirse (`NGINX_LOADTEST_K6_SURUM`) özet de yeniden
  sabitlenir ("Arşiv özetlerini sabitleme").
- **wrk** 4.2.0 SABİT: kaynak `github.com/wg/wrk` 4.2.0 etiket arşivi (üst dizin `wrk-4.2.0/`), derleme arşivdeki
  varsayılan Makefile ile `make VER=4.2.0` (`VER` ZORUNLU: arşivde `.git` yok, `VER`'siz derleme `wrk -v`'de sürümsüz
  satır basar). `deps/` altındaki paketli OpenSSL 1.1.1 ve LuaJIT 2.1 statik bağlanır: ikili yalnız glibc'ye (libc,
  libm, libdl, libpthread, ld-linux; libgcc_s olabilir) bağlıdır. Sistem OpenSSL'i verilmez (RHEL 8 OpenSSL 1.1 /
  RHEL 9 OpenSSL 3.0 farkı ikiliyi taşınamaz yapardı) ve `-march` gibi işlemciye özgü bayrak yoktur; `ldd` çıktısında
  libssl / libcrypto / libluajit / liblua görülürse iş düşer.
- **İki arşiv özeti de SABİT (ilk kullanımda güven yok)**: wrk kaynak arşivi ve k6 arşivi YALNIZ Portal env'inde
  sabitlenmiş sha256 ile (`NGINX_LOADTEST_WRK_KAYNAK_SHA256`, `NGINX_LOADTEST_K6_ARSIV_SHA256`) indirilir ve açılmadan,
  derlenmeden, çalıştırılmadan önce doğrulanır; özet yoksa Portal işi başlatmaz (409) ve playbook girdi kapısı da
  reddeder. "İlk iş özeti kaydeder, Admin onaylar" yolu KALDIRILDI: `make` (Makefile, OpenSSL `Configure`, LuaJIT
  derlemesi) keyfi kabuk kodudur ve onaydan önce derleme makinesinde www olarak koşardı. `wrk_kaynak_sabit` /
  `kaynak_sabit` artık her başarılı işte `true`dur (alan geriye uyum için kalır).

- **glibc kuralı**: derleme makinesinin glibc'si (`derleme_glibc`) ve wrk'nin istediği en yüksek glibc sembol sürümü
  (`objdump -T`, `wrk_glibc_gerekli`) kaydedilir. RHEL 9'da (glibc 2.34) derlenen wrk RHEL 8'de (glibc 2.28)
  çalışmayabilir: ön kontrol `version`/`-v` yükleyici hatasını `arac calistirilamadi: glibc uyumsuz: makinede glibc
  2.28, arac GLIBC_2.34 istiyor` olarak bildirir ve Portal Araçlar paneli önceden uyarır. RHEL 8 bir DEV/TEST/QA nginx
  makinesi Portal `NGINX_LOADTEST_DERLEME_HOSTLARI` listesine eklenip orada hazırlanırsa ikili iki sürümde de çalışır.
  GBLABT02'nin RHEL sürümünü ilk iş kaydeder.
- **Vekil yalnız indirmede**: kurumsal vekil (Portal `NGINX_LOADTEST_ARAC_PROXY`; yalnız `http://<ad>:<port>`, kimlik
  bilgisi yok; `yok` = vekilsiz) YALNIZ Play 8'in üç `get_url` görevine görev düzeyi `environment` olarak gider.
  `arac_hazirla.sh` vekilsiz koşar (`env -u` + betik içinde `unset`); başka hiçbir görevde `environment` yoktur.
- **TLS doğrulaması kapatılmaz**: `validate_certs: true`. Vekil TLS'i açıyorsa (kurum CA'sı) derleme makinesinin sistem
  güven deposunda olmalıdır; değilse iş `indirme basarisiz (...): ... CERTIFICATE_VERIFY_FAILED` ile düşer.
- **Eski elle kurulumlar kullanılmaz**: yük makinelerinde elle kurulmuş k6
  (`install -m 0755 k6 /home/www/bin/k6` ile) ve GBLABT02'deki eski wrk yerinde kalır, hiçbir iş onları çalıştırmaz. `yuk_k6_yolu` /
  `yuk_wrk_yolu` artık sabit işaret yolları taşır (`/yeni-playbook-gerekli/k6`, `/yeni-playbook-gerekli/wrk`): yeni
  Portal + eski playbook penceresinde eski ikili SESSİZCE kullanılmaz (fail-closed).
- **Eski set dizinleri silinmez**: Portal etkin seti DB'den bilir; eski `<kök>/araclar/<id>/` dizinlerini Admin elle
  siler (etkin seti silmeyin: o set yeniden hazırlanana dek her ön kontrol "kopya basarisiz" ile düşer).

### Arşiv özetlerini sabitleme

Bir kez (ve k6 sürümü değişince), Portal'ın kullandığı kurumsal vekili (Portal `NGINX_LOADTEST_ARAC_PROXY` değeri)
kullanabilen bir Linux makinesinde, boş bir dizinde, playbook'un indirdiği dosyaların AYNISI indirilir:

```
VEKIL='<Portal NGINX_LOADTEST_ARAC_PROXY degeri>'
curl -fsSL -x "$VEKIL" -o wrk-4.2.0.tar.gz https://github.com/wg/wrk/archive/refs/tags/4.2.0.tar.gz
sha256sum wrk-4.2.0.tar.gz
curl -fsSL -x "$VEKIL" -o k6-v0.49.0-linux-amd64.tar.gz https://github.com/grafana/k6/releases/download/v0.49.0/k6-v0.49.0-linux-amd64.tar.gz
curl -fsSL -x "$VEKIL" -o k6-v0.49.0-checksums.txt https://github.com/grafana/k6/releases/download/v0.49.0/k6-v0.49.0-checksums.txt
sha256sum k6-v0.49.0-linux-amd64.tar.gz
grep ' k6-v0.49.0-linux-amd64.tar.gz$' k6-v0.49.0-checksums.txt
sha256sum -c --ignore-missing k6-v0.49.0-checksums.txt
```

- k6: `sha256sum` çıktısındaki değer resmî `k6-v0.49.0-checksums.txt` satırıyla AYNI olmalı (son komut
  `k6-v0.49.0-linux-amd64.tar.gz: OK` der); değilse DURUN, değeri kullanmayın. Mümkünse resmî değeri bir de sürüm
  sayfasından (github.com/grafana/k6/releases, v0.49.0) ya da vekil dışı bir ağdan karşılaştırın.
- wrk: GitHub etiket arşivini isteğe göre üretir; resmî bir checksums dosyası yoktur. Değeri mümkünse ikinci, bağımsız
  bir ağdan (vekil dışı) da hesaplayıp karşılaştırın; aynıysa kullanın.
- Değerler Portal sunucusunun `.env` dosyasına (64 küçük hex) yazılır ve Portal yeniden başlatılır:

```
NGINX_LOADTEST_K6_ARSIV_SHA256=<k6-v0.49.0-linux-amd64.tar.gz sha256>
NGINX_LOADTEST_WRK_KAYNAK_SHA256=<wrk-4.2.0.tar.gz sha256>
```

- k6 sürümü `NGINX_LOADTEST_K6_SURUM` ile değiştirilirse komutlardaki `v0.49.0` yeni sürümle değiştirilip k6 özeti
  yeniden sabitlenir. Sabit değerler değişince, eski değerlerle hazırlanmış setler Portal'da etkin sayılmaz (yeniden
  "Araçları hazırla").
- Arşiv sonradan değişirse (GitHub sıkıştırması değişti, vekil içeriği değiştirdi) iş indirmede `indirme basarisiz
  (wrk kaynagi): The checksum ... did not match` ya da açmadan önce `arsiv ozeti sabit degerden farkli` ile düşer ve
  hiçbir şey açılmaz / derlenmez; yeni değer yukarıdaki gibi BAĞIMSIZ doğrulanmadan env'e yazılmaz.

## Serbest izin dosyası (yük makinesi başına, operatör)

Serbest hedef yalnız yük makinesindeki `/etc/portal_yuktesti/serbest_aglar` hedef IP'yi kapsıyorsa kullanılabilir
(dosya yoksa serbest kip o yük makinesinde KAPALIDIR). Dosyayı www DIŞINDA bir hesap (Unix ekibi) kurar:

```
install -d -m 0755 /etc/portal_yuktesti
install -m 0644 serbest_aglar /etc/portal_yuktesti/serbest_aglar
```

- Dizin ve dosyanın sahibi www DEĞİL, grup/diğer yazamaz, dosyayı www okur (0644), en çok 16 KB ve 64 girdi.
  ("root sahipli" şartı aranmaz; aranan özellik "www yazamaz"dır.)
- Biçim: satır başına `a.b.c.d/n` (n 24..32; tek IP için `/32`); `#` ile başlayan ve boş satır atlanır; CRLF
  tolere edilir. Kodlama ASCII ya da BOM'suz UTF-8 (BOM ilk girdiyi geçersiz kılar); satır sonu yorumu YOK
  (`10.1.2.0/24 # vip` satırın tamamını geçersiz kılar). Host bitleri dolu girdi (`10.1.2.3/24`) ve tek bir geçersiz
  satır tüm listeyi geçersiz kılar (fail-closed). /30 ve altında ağ ve yayın adresi hedef olamaz (/31 ve /32 serbest).
- Bu liste Portal `NGINX_LOADTEST_SERBEST_AGLAR` listesinin ALT KÜMESİ olmalıdır ve dar tutulur (tek VIP `/32` ya da
  yalnız VIP alt ağı `/24`). Yasak liste yalnız Portal'dadır; PROD/EDU sahipliğini yalnız Portal bilir.
- Ret nedeni (ilk tutan) set_stats'a gider: `dizin /etc/portal_yuktesti yok, www sahibi ya da grup/diger yazabilir`
  (www'nin uid'i ölçülemediyse de: sahiplik doğrulanamaz, fail-closed), `dosya ... yok, duzenli dosya degil, www
  sahibi, grup/diger yazabilir ya da 16 KB uzeri`, `dosya okunamadi`, `liste bos`, `en cok 64 girdi`,
  `gecersiz girdi: <girdi>`, `hedef IP <ip> listede degil`.
  `<girdi>` en çok 40 karakter (daha uzunsa ilk 37 karakter + `...`) ve yalnız yazdırılabilir ASCII'dir: BOM, CR ve
  ASCII dışı bayt (Latin-5 not gibi) `?` olarak görünür (`gecersiz girdi: ?10.1.2.0/24`). Kesme
  `truncate(40, true, '...', 0)` ile kesindir (Jinja varsayılanı 5 karakter pay bırakır ve kelime sınırında keser:
  41-45 karakterlik girdi kesilmeden görünürdü).
- Dosya metni okunduğu anda temizlenir (Play 3 `yt_re_yazdirilamaz: '[^\s!-~]'`, `b64decode`'dan hemen sonra): Ansible
  UTF-8 dışı baytı tek vekil karakterle çözer ve bu karakter set_fact sonuçlarında (AWX iş olayları: `yt_ag_metin`,
  `yt_ag_satirlar`, `yt_ag_gecersiz`) UTF-8'e kodlanamazdı; ret nedeni ve set_stats zaten temizdi. Artık vekil, BOM, NUL
  ve boşluk dışı her yazdırılamayan karakter `?` olur. Boşluk sayılan karakterler (`\s`: SEKME, CR, LF, NBSP, form feed;
  `trim` bunları satır başında ve sonunda zaten siler) olduğu gibi kalır; bu yüzden davranış aynıdır: `?` CIDR
  deseninde olmadığından kirli veri satırı yine geçersiz, yorum satırı yine yorumdur. `[^\t\n\r -~]` deseni NBSP ya da
  form feed taşıyan, bugün kabul edilen listeyi reddederdi (gerçek ansible-core 2.16.19 ile ölçüldü).

## Zaman bütçesi

| | Değer |
|---|---|
| `yuk_butce_sn` (Portal hesaplar) | `bosta + adım_sayısı × tekrar × (isinma + sure + bosluk) + 120`, ≤ 2700, sunucu ayarlı koşuda ≤ 1800 (Portal adım başına 20 sn pay ekler) |
| koşu betiği dış sınırı | `timeout -k 30 <bütçe>` (async `bütçe + 300`, poll 15) |
| kaydedici (sunucu) | `SURE=<bütçe+60>` (kendi biter) ve `timeout -k 300 <bütçe+120>` |
| kaydedici hazır bekleme | `bosta + 90` sn |
| kaydedici TERM sonrası bekleme | 290 sn (`bitir`: `LOG_BEKLE` 6 sn + tüm log büyümesinin awk ayrıştırması; gawk 5.1 ölçümü ~400k test satırı ~25 sn, 800k test + 200k diğer ~48 sn); sarmalayıcının KILL'i 300 sn'de, beklemeden sonra |
| on_kontrol.sh hedef / yollar | `timeout -k 10 120` / `timeout -k 10 600` (≤400 yol × 5 sn / 4 paralel); koşu kapısı `timeout -k 10 120` |
| wrk_kos.sh | yükleme sınaması `timeout -k 5 30`; TUR başına 200 kapısı ≤ 180 sn (bütçe formülünde yok, Portal'ın adım payına girer) |
| durdur.sh | TERM → 10 sn → KILL; dış `timeout -k 10 90` |
| hazirlik.sh | `uygula` `timeout -k 10 300` (reload sonrası ≤ 90 sn bekleme; yarım yedek varsa bir kez daha), `dosyalar` `timeout -k 10 600` (Portal kuyruğu static koşuya +180 sn pay ayırır), `kanit` `timeout -k 10 120` (3 örnek, örnek başına `curl --max-time 15`), `geri_al` `timeout -k 10 240` |
| araclar (Play 8) | get_url `timeout` 120 / 300 / 300 sn; `arac_hazirla.sh` `timeout -k 30 1800` (wrk + paketli OpenSSL/LuaJIT derlemesi birkaç dakika) |

## Güvenlik: tehdit modeli ve katmanlar

- **Playbook kapıları AWX yetkilisine karşı sınır DEĞİLDİR.** Şablonda "Variables — Prompt on launch" açık olmak
  zorunda ve extra_vars Ansible'da HER değişkenden önce gelir (play `vars:`, `set_fact`, `register` dahil): şablonu
  AWX'te Execute yetkisiyle başlatabilen biri `yt_*` regex'lerini ve hesaplanan fact'leri de ezebilir. Bu yüzden
  playbook kapıları Portal hatasına ve AWX'ten yeniden başlatmaya (Relaunch) karşı **savunma derinliğidir**; asıl
  sınır AWX RBAC'tır: şablonun Execute / Admin rolü yalnız Portal servis hesabında (AWX tablosu, Kanarya).
- Katmanlar: (1) Portal — IP sınıflandırması, sahiplik, yasak / izin listesi, envanter tazeliği, Host üretim kapısı,
  tavanlar, kilitler, onay metni; (2) playbook — ad kuralı, IP biçimi, iş geçerlilik süresi (`yuk_son_epoch`: Portal
  her işi en çok 15 dk geçerli başlatır, Relaunch 15 dk sonra reddedilir), sunucu kipinde hedefte `ip_yerel` (ön
  kontrolde VE koşu başında), serbest kipte yük makinesindeki izin dosyası (literal yol, sahibi www olmayan dosya),
  tavanlar; (3) betikler — yük makinesinde yerel IP reddi (on_kontrol.sh, wrk_kos.sh), 429 / 5xx / soket DUR'u.
- Hedef (sunucu) ve yük makinesi ad kuralına göre DEV/TEST/QA, EDU istisnası değil, birbirinden farklı. Serbest
  hedefe SSH ile bağlanılmaz; "sahipsiz IP" PROD olmadığının kanıtı değildir (LB VIP'leri envanterde yok): asıl
  koruma dar tutulan izin listeleridir.
- Hedef IP özel aralıkta değil; sunucuda hedefte yerel olduğu (`ip -o -4 addr`), iki türde yük makinesinde yerel
  OLMADIĞI ölçülür (yerelse istek hiç gönderilmez).
- Tavanlar (2026-11-03): sunucu hedefte k6 hız ≤ 5000, VU ≤ 1000; wrk bağlantı ≤ 199, toplam hız ORTALAMADA ≤
  `yuk_tavan_rps` ≤ 5000; serbest hedefte iki motorda ≤ 200 istek/sn (wrk'de ortalamada) ve ≤ 50 bağlantı/VU (hedefte
  limit_req olmayabilir: yükün tek freni Portal tavanıdır). Hedefin ölçülmüş limit_req / limit_conn'u playbook'ta
  okunmaz; Portal'da yalnız UYARIDIR (ön kontrol / plan onayı). Estate'teki `limit_req 500 r/s/IP` olan hedefte 500'ün
  üstündeki her hız ilk saniyede 429 ile durur (k6 eşiği, wrk DUR). Yük bir LB üzerinden gidiyorsa
  nginx isteği (realip yoksa) LB'nin IP'sinden görür: IP başına 500 r/s ve 200 bağlantı sınırı LB arkasındaki
  herkesle, vhost başına 5000 r/s sınırı tüm istemcilerle paylaşılır. `LIMIT_MUAF` yok; k6 eşikleri 429 ve HTTP/2'de, wrk_kos.sh 429/5xx/soket/hata
  oranında koşuyu keser.
- wrk kapalı döngüdür: her bağlantı yanıtı alınca yeni istek gönderir; yuk_wrk.lua her isteğe bağlantı başına en az
  `D` bekleme ekler (ilk istekler `[D, 2D)` aralığına rastgele yayılır) ve ilk 429 / 5xx'te iş parçacığını durdurur.
  Toplam hız ORTALAMADA tavanı aşmaz ama istekler kümelenebilir ("Tuzaklar").
- Senaryo yalnız yol: satır satır beyaz liste + sha256; çerez/sorgu/başlık/gövde yok; vekil yok.
- Betik kopyaları: www'nin 0700 koşu dizinine; çalıştırmadan önce sha1 (kontrol düğümündeki
  kaynakla), sahip uid (www), düzenli dosya, grup/diğer yazamaz ve dizin 0700/www doğrulanır.
  `durdur.sh` opsx_was deseniyle bağlanan kullanıcı adına `/var/tmp` mktemp dosyasına kopyalanır
  (sahip uid = bağlanan kullanıcı), `always` ile silinir. `ansible.builtin.script` YOK.
- Araç kopyası: `/sw`'deki ikililer 0644'tür (çalıştırılamaz); tek çalışma yolu koşu dizinindeki doğrulanmış kopyadır.
  Kopyanın sha256'sı yalnız Portal'ın değeriyle karşılaştırılır (/sw'deki `SHA256SUMS` / `manifest.json`'a güvenilmez),
  sahip www ve 0700 denetlenir; doğrulanmayan kopya çalıştırılmadan silinir. Derleme betiği de koşu betikleri gibi sha1 /
  sahip / izin kapısından geçer. /sw'ye www yazmaz: ikililer kontrol düğümüne `fetch` edilir ve Play 6'nın kanıtlanmış
  yoluyla (GBLABT02, bağlanan kullanıcı) yazılır.
- `nginx -T` estate komutuyla (`dzdo <nginx> -p /usr/nginx/ -c /usr/nginx/nginx.conf -e /web_log/error.log -T`,
  `nginx_console_dump.sh` ile aynı; dzdo reddederse dzdo'suz); çıktı yalnız geçici dosyada aranır, basılmaz.

## Tuzaklar

- Playbook'ta `#` satırı yok; açıklamalar burada. `{{ }}` içinde `\"` yok; `\t`/`\n` gereken her
  ifade ÇİFT tırnaklı YAML'da (YAML gerçek SEKME/satır sonuna çevirir; Ansible `{{ }}` içindeki
  ters eğik çizgiyi ikiler). Regex'ler play `vars:`'ında tek tırnaklı YAML'da (`\Z`:
  Python `$` sondaki satır sonunu kabul eder, değer enjeksiyonu kapanır).
- **Koşul tuzağı (iki Ansible yolu)**: `when`, `failed_when`, `changed_when` ve `assert.that` aynı yoldan
  değerlendirilir. ansible-core 2.16.19'un varsayılan yolu (`{% set __cres = <ifade> %}`) dış düzeyde `a if b else c`'yi
  çalıştırır ama sonuç bool değilse uyarır (2.19'da HATA); eski yol (`{% if <ifade> %} True {% else %} False {% endif %}`;
  geri taşıma öncesi sürümler ve `_ANSIBLE_DISABLE_BACKPORTED_INSPECTIONS=1`) dış düzeydeki koşullu ifadede
  TemplateSyntaxError verir. AWX EE'nin sürümü bilinmediği için kural ikisini de sağlar: her koşullu ifade
  `((x) if (y) else (z))` biçiminde DIŞTAN parantezli ve her ifadenin sonucu bool. Bekçinin `kosul()`'u iki yolu da
  sınar ve ayrıca bu anahtarların METNİNDE parantez derinliği 0'da ` if ` arar (`failed_when`/`changed_when` sahte
  koşuda hiç değerlendirilmez).
- **extra_vars önceliği**: extra_vars `vars:`/`set_fact`/`register`'ı da ezer; playbook kapıları AWX yetkilisine
  karşı sınır değildir ("Güvenlik"). İş geçerlilik süresi (`yuk_son_epoch`) yalnız Relaunch'u ve elle başlatmayı
  15 dk sonra reddeder; AWX işi kuyrukta 15 dk'dan uzun bekletirse iş de reddedilir (fail-closed).
- **Play 5 groups tuzağı**: serbestte `yuk_hedef` grubu hiç oluşmaz; `inventory_hostname in groups['yuk_hedef']`
  StrictUndefined ile patlar, Play 5 rescue'ya düşer ve hiç dosya toplanmaz (her serbest koşu FAIL). Sonuç dizini bu
  yüzden hedef türü ve host adı karşılaştırmasıyla seçilir.
- **wrk betik yükleme hatası sessizdir**: wrk betik yükleme / üst düzey hatasını YALNIZ stderr'e yazar ve VARSAYILAN
  istekle (betiksiz `GET /`) yük basmaya devam eder. wrk_kos.sh bu yüzden ilk TUR'dan önce istek göndermeyen bir
  **yükleme sınaması** yapar (`env -i`, `LUA_YUKLEME_ISARETI`, hedef `https://127.0.0.1:1/`): betik sonuna kadar
  yüklenip çalıştıysa son blok işaret dosyasını yazar; işaret yoksa `HATA: yuk_wrk.lua wrk ile yuklenemedi`.
  Dayanılan varsayım: wrk betiği bağlantı denemesinden (`wrk.resolve`) ÖNCE yükler; yanlışsa her wrk koşusu HATA
  ile durur (fail-closed) ve kanaryada görülür. yuk_wrk.lua'da üst düzeyde yalnız tanım ve sondaki tek `do ... end`
  bloğu vardır.
- **`wrk -v` rc 1 döner** (sürüm satırı + kullanım metni): rc'ye bakılmaz, `^wrk ` satırı okunur. `make VER=...`'siz
  derleme `wrk  [epoll] ...` (çift boşluk) ya da kısa hash basar: "çalışıyor ama sürümü okunamadı".
- **c / t tam bölme**: wrk bağlantıları iş parçacıklarına `c / t` tam sayı bölmesiyle dağıtır; bölünmeyen bağlantı
  sayısı eksik bağlantıyla koşar ve TUR adı yanlış olurdu. Girdi kapısı (ve wrk_kos.sh) `N % T ≠ 0`'ı reddeder.
- **wrk: toplam hız ORTALAMADA tavanı aşmaz, istekler kümelenebilir**: wrk bütün bağlantıları aynı anda açar ve
  kapalı döngüde sabit bekleme fazları korur; `N × 1000 / D ≤ TAVAN_RPS` yalnız ortalamayı sınırlar, anlık küme N
  isteğe çıkabilir (Portal tavanı limit_req `burst`'ünü okumaz). Bağlantılar birlikte başlar; yuk_wrk.lua iş parçacığı
  başına ilk `N / T` beklemeyi rastgele `[D, 2D)` aralığına yayar (her bekleme ≥ D kalır, ortalama tavan geçerli). Yine
  de limit_req `burst`'ü bağlantı sayısından küçük (`burst=10 nodelay` gibi) ya da burst'süz (`limit_req zone=X;`)
  yollarda 429 alınır ve koşu durur (DUR; ortalama hız tavanın altındayken de): böyle yollarda k6 kullanın (açık
  döngü, sabit hız) ya da bağlantı sayısını düşük tutun.
- **SNI = IP literal**: wrk SNI olarak URL'deki host'u (IP) gönderir (RFC 6066 dışı; katı LB TLS profilleri
  reddedebilir) ve Host başlığına göre SNI seçemez: motor wrk'te `yuk_sni` yalnız `0`. curl ve k6 IP literal'de SNI
  göndermez: 200 kapısı geçip wrk el sıkışması düşebilir (soket hatası DUR'u yakalar; kanarya 9).
- **TLS**: k6 1.2'ye sabittir; wrk'de sürüm sabitlenemez (TLS 1.3 seçilebilir) ve istemci oturum önbelleği açık
  olduğu için yeniden bağlanırken oturum devamı olabilir: `yeni` kipinde tam el sıkışma garanti değildir, TLS payı
  hesaplanmaz ve wrk sonuçları k6 sonuçlarıyla karşılaştırılmaz.
- **Koordineli ihmal düzeltmesi (stats_correct)**: wrk yüzdelikleri, ortalama aralığın iki katını aşan örnekler
  için sentetik örnek eklenmiş dağılımdır; k6'nın ham trendinden farklıdır.
- **thread:stop sonrası boşta bağlantılar**: 429 / 5xx'te durdurulan iş parçacığının soketleri kapanmaz, `-d` bitene
  kadar boşta açık kalır; süre en çok `SURE` boşa gider, ardından DUR.
- **`--timeout` belleği**: etkin istek zaman aşımı yoktur; `--timeout 10s` yalnız geç gelen yanıtı `e_timeout`
  sayar ve gecikme histogramının boyunu belirler (~80 MB sanal bellek, çoğu dokunulmaz).
- **response() gövde tamponlama**: `response()` tanımlı olduğu için wrk her yanıtın başlık ve gövdesini tamponlar;
  büyük gövdeli senaryoda yük makinesi darboğaz olabilir (yük makinesi CPU'su kanaryada izlenir).
- **SIGTERM'de done() yoktur**: Portal durdur / timeout TERM'i wrk'yi özetsiz bitirir (o TUR `hatali_`/DUR); SIGINT
  erken durdurur ve done() çalışır.
- **`yeni` kipinde geçici port tükenmesi**: her istek yeni TCP bağlantısıdır; yüksek bağlantı / kısa gecikmede TIME_WAIT
  birikebilir (`e_connect` artar, soket DUR'u). Hangi tarafta (yük makinesi mi hedef mi) biriktiği doğrulanmadı;
  pilot koşuda iki tarafta `ss -tan state time-wait` ile ölçülecek.
- `ps | awk` kendine eşleşir: `durdur.sh` dizini awk'a ORTAM değişkeniyle verir, k6'yı ve wrk'yi alan
  bazında (`$2` adı `[k]6...` ve `$3 == "run"`; `$2` adı `[w]rk...` ve ` -s <kosu_dizini>/yuk_wrk.lua`) tanır; kendi
  pid'ini ve ebeveynini dışlar. Gerçek procps `ps` ile bekçide sınanır (WSL/Linux).
- Kaydedici ayrık (setsid) koşar; `$!` timeout'un pid'idir. TERM timeout'a gider, timeout çocuğa ve
  gruba iletir ve `-k` KILL sayacını başlatır: `bitir` bu sürede bitmeli. Sayaç 300 sn (eski 30 sn,
  büyük koşuda `bitir`'i log ayrıştırırken kesiyordu: `bilgi_*.txt` yazılmaz, koşu `FAIL`); Play 4
  290 sn bekler, yani kendi KILL'imizi "durdu" saymaz. Bekçi bunu GERÇEK Play 2 satırı ve `timeout -k`
  ile, `bitir`'i 30 sn'den uzun süren (`LOG_BEKLE=40`) bir kaydediciyle sınar.
- Kaydedicinin hazır beklemesi (`wait_for`, `re.MULTILINE`) yalnız `YUKU SIMDI BASLATIN`'ı ya da
  başlatıcının/kaydedicinin kendi hata satırını tanır:
  `^HATA: .*$` ve `^(?:/bin/sh: line [0-9]+: )?(?:setsid|nohup|timeout|env|bash): .*$`. Kaydedici
  `/proc`'u tararken biten bir sürecin `<betik>: line N: /proc/<pid>/cmdline: No such file or directory`
  satırı (bash `< dosya`'yı `2>/dev/null`'dan önce uygular) bu yüzden kaydediciyi bozmaz; eski desen onu
  hata sayıp sağlıklı kaydediciyle koşuyu düşürüyordu. Satır numarasız "komut yok" biçimi
  (`/bin/sh: setsid: command not found`; bash 5.1+ `/bin/sh: line 1: ...` basar, RHEL 7/8'in bash 4.x'i
  numarasız basar) desende yok: o durumda bekleme süresi dolar ve koşu yine `FAIL`
  (`kaydedici hazir olmadi: Timeout ...`); kanaryada `setsid`/`nohup`/`timeout` varlığı ayrıca görülür.
- `delegate_to: GBLABT02` erişilemezse (sshd MaxSessions/MaxStartups, DNS, kapalı) görevi koşturan
  inventory host'u (localhost) UNREACHABLE sayılır: `ignore_unreachable` yoksa Ansible onu play'den
  çıkarır, rescue/always koşmaz ve tek host'lu play bittiği için sonraki play'ler (temizlik, set_stats)
  atlanır. `ignore_unreachable` ile host kalır ama sonraki görevler de koşar; bu yüzden her delegate
  görevinin hemen ardından `is unreachable` denetimi var. Döngülü görevde Ansible üst düzeye
  `unreachable` YAZMAZ (yalnız `results` öğelerine; ansible-core 2.16'da ölçüldü), `is unreachable`
  döngüyü yakalamaz: dosya kopyasının denetimi öğelere de bakar
  (`<kayıt>.results | selectattr('unreachable', 'defined') | selectattr('unreachable')`). Yoksa bir
  öğe kopyalanamadığı halde SHA256SUMS yazılır ve kopya "tamam" sayılırdı.
- **Erişilemeyen hedef / yük makinesi**: uzak play'ler `ignore_unreachable: true` taşır; erişilemeyen hostta ilk görev
  (`getent`) UNREACHABLE olur ve YOK SAYILIR, sonraki görevler koşar. Eskiden sonraki `set_fact` tanımsız
  `ansible_facts.getent_passwd` ile düşüyor ve operatör `The task includes an option with an undefined variable ...
  'getent_passwd'` görüyordu. Şimdi getent register edilir ve hemen ardından `<kayıt> is unreachable` fail'i ssh
  iletisini `trim` + yazdırılabilir ASCII (`yt_re_ascii_disi: '[^ -~]'`; satır sonu dahil diğer her karakter `?`) +
  en çok 160 karakter (uzunsa ilk 157 + `...`) olarak `erisilemedi (ssh): ...` ile rescue'ya verir. O hostta başka
  görev çalışmaz (`yt_dizin` tanımsız kalır: Play 4, 5 ve 7 atlanır, durdur.sh orada koşmaz); erişilen host
  etkilenmez. Gerçek ansible-core 2.16.19 ile (127.0.0.1:1, bağlantı reddi) iki koşul yolunda ölçüldü.
- Kaydedici `/proc`'u www olarak okur. `/proc` hidepid ile bağlıysa nginx master görünmez:
  ön kontrol `master_sayisi 0` der, koşuda kaydedici `HATA: nginx master bulunamadi` ile durur
  (betiğin "dzdo ile çalıştırın" ipucu estate kuralı gereği UYGULANMAZ).
- AWX iptali uzak async görevleri (koşu betiği, k6, wrk) ve ayrık kaydediciyi DURDURMAZ; hepsi kendi
  `timeout`'larıyla sınırlıdır ve Portal "Durdur" `durdur` kipini koşturur. Portal kilitleri bu yüzden
  iptal/hata sonrası süre sınırına kadar tutulur ("Portal kilitleri ve Durdur").
- Bütçe formülünde adım başına k6 başlatma/setup (≤400 yol ön kontrolü) ya da wrk 200 kapısı payı yok; çok adımlı ve
  çok yollu koşu `timeout`'a takılabilir (rc 124 → `FAIL`). Portal formülü adım başına 20 sn pay ekler.
- `log_*.tsv` adım başına büyük (~25-30 MB); hedefte gzip'lenir, toplam 200 MiB'ı aşan sonuç toplanmaz.
- Koşu sırasında log rotate, reload ya da deploy olursa kaydedici bunu `bilgi_*.txt`'ye yazar; Portal
  analizi koşuyu GECERSIZ sayar.
- **GitHub etiket arşivinin sha256'sı değişebilir**: GitHub etiket arşivlerini isteğe göre üretir; sıkıştırma değişince
  (2023-01'de oldu) aynı etiketin arşiv özeti değişir. Özet yine de Portal'da SABİTTİR (ilk kullanımda güven yok):
  değişirse iş `indirme basarisiz (wrk kaynagi): The checksum ... did not match` ile düşer, hiçbir şey açılmaz /
  derlenmez; yeni değer "Arşiv özetlerini sabitleme"deki gibi bağımsız doğrulanıp env'e yazılır (değişen arşiv bir
  tedarik zinciri saldırısı da olabilir: doğrulamadan yazmayın).
- **Release indirmesi yönlendirilir**: `github.com/.../releases/download/...` ve etiket arşivleri
  `objects.githubusercontent.com` / `codeload.github.com` gibi başka adlara yönlenir; vekil bunlara da izin vermelidir
  (yoksa 403 / 407 ile `indirme basarisiz (...)`).
- **fetch + become iki kat aktarım**: become ile `fetch` dosyayı önce slurp ile okur (base64); iki ikili (toplam ~60 MB)
  derleme makinesinden kontrol düğümüne bellekte iki kat yük olarak gelir, sonra GBLABT02'ye yazılır. Bilinçli bedel
  (www'nin /sw'ye yazma izni bilinmiyor).
- **`copy remote_src` /sw okunamıyorsa**: yük makinesinde /sw bağlı değilse ya da www okuyamıyorsa kopya düşer ve ön
  kontrol `arac kopyasi dogrulanamadi: kopya basarisiz: <ileti>` der (koşu başlamaz).
- **Derleme süresi sınırlı**: `arac_hazirla.sh` `timeout -k 30 1800` ile koşar (rc 124: `betik sonuc satiri basmadi`).
  AWX'ten iptal edilen araclar işinde uzaktaki derleme sürebilir; Portal kilidi (`A|araclar`) bu yüzden iptal / hata
  sonrası süresiyle düşer. Aynı `arac_<id>` dizini her denemede önce silinir.
- **Paketli OpenSSL 1.1.1 desteği bitti (EOL)**: kabul edilen risk — yalnız iç TEST hedeflerine (ve izinli LB
  VIP'lerine) giden, sunucu olarak dinlemeyen bir istemcide kullanılır; sürüm `wrk_openssl` olarak kaydedilir; sistem
  OpenSSL'i bilinçli olarak bağlanmaz (RHEL 8 / 9 arasında taşınabilirlik).
- **`mv -T` boş hedefin üzerine yazar**: dolu hedefte reddeder, boş `<id>/` dizinine ise taşır; asıl kapı mv'den önceki
  `stat` (`arac dizini zaten var`) ve sonraki geri okumadır (sha256 Portal değeriyle).
- **`*_static` satırı modül ister**: static kapalı koşuda da `brotli_static off;` yazılır; `ngx_http_brotli_static_module`
  yüklü olmayan sunucuda `nginx -t` `unknown directive` ile düşer ve dosyalar geri alınır (koşu başlamaz).
- **Yedek kalırsa sonraki ayarsız koşu kirli ölçer**: AWX Play 7'den önce keserse sunucu ayarlı kalır. Sonraki `uygula` ya da
  Durdur geri alır; ama `yuk_srv_ayar` `0` olan koşu başta bakmaz, geri alma ancak onun Play 7'sinde olur.
- **Bayat `.gz` / `.br`**: `gzip_static` kaynağa bakmadan `.gz`'i sunar ve mtime seviyeyi görmez: seviye 9'dan kalan dosya seviye 1
  koşusunu sessizce bozardı. Bu yüzden yeni üretilenler `geri_al`'da silinir (manifest) ve `dosyalar` ilgili türü her koşuda yeniden
  üretir (static koşu süresi her seferinde üretim kadar uzar; yüksek brotli seviyesi `timeout 600`'e yaklaşabilir).
- **`.br` sessizce anlık sıkıştırmaya düşer**: `brotli on` açıkken `.br` bulunamazsa ya da istek başka `location` / `root`'a giderse
  yanıt yine `Content-Encoding: br` taşır; farkı yalnız `Content-Length` gösterir (anlık sıkıştırmada yok ya da farklı). Bu yüzden
  `kanit` boyutu diskle karşılaştırır, başlığa güvenmez. Sonek araması URL önekini bilmez: `/x/a.js`, dizindeki başka bir `a.js`'e
  eşleşirse boyutlar tutmaz ve FAIL olur; metindeki yol ve boyutlar bunu gösterir.
- **`nginx -T` reload'dan önce**: `-T` diskteki konfu okur; doğrulama reload'dan önce yapılır, dosya include edilmiyorsa
  sunucuya hiç yüklenmeden geri alınır.
- **Kapanan worker**: reload'tan hemen sonra eski worker henüz `shutting down` değildir; `worker_bekle` önce 1 sn bekler.
  `ps | awk` deseni `[n]ginx`: awk'ın argüman metni ps'te görünür.
- **`mkdir -m` Git Bash'te düşer**: `hazirlik.sh` `umask 077` ile açar (aynı sonuç, araya pencere girmez).
- **Eski koşunun Durdur'u**: Durdur kilit almaz. `geri_al` `KOSU_ID` tutmazsa dokunmaz; yoksa geceden kalan bir satıra basmak süren
  koşunun ortasında reload yapardı. Yedeği yalnız `uygula` ve hedef kilidini tutan iş (`DEVRAL=1`) devralır.
- **`cat > dosya` yarım yazabilir**: disk dolunca `cat` birkaç bayt yazıp düşer; özet tutmayan dosya ikinci `geri_al`'da "başkası
  değiştirmiş" sayılırdı ve tek yedek silinirdi. Bu yüzden yazım `yaz<i>` işareti ve sha256 denetimiyle yapılır.
- **Ön planda `curl` TERM'i bekletir**: bash trap'i ön plandaki komut bitene dek çalışmaz; durdur.sh 10 sn sonra KILL atar, temizlik
  atlanır. `curl` arka planda koşar, `wait` edilir.
- **flock fd'si çocuklara geçer**: `curl` `9>&-` ile başlar; yoksa KILL'den sonra yetim kalan `curl` bitene dek kilit dolu kalırdı.
- **NGINX Plus ikinci örnek açmaz**: aynı ikiliyle ayrı konf `[emerg] License file is required` ile düşer (AWX 3483307, GBNGXT33);
  `.br` çalışan nginx'e eklenen `127.0.0.1` bloğundan üretilir.
- **`nginx -t` bind denemez, `-s reload` rc 0 döner**: dolu porttaki blok ikisinden de geçer, hata yalnız error log'a düşer; `uygula`
  porta bağlanarak doğrular. 20 sn'yi aşan reload bind olmuş olsa da aynı FAIL'i verir (güvenli: konf geri alınır; metin iki olasılığı da yazar).
- **`.br` üretimi canlı worker'da** (ölçülmedi, koddan): ngx_brotli sıkıştırmayı worker'ın olay döngüsünde eşzamanlı yapar. `dosyalar`
  sırasında seviye 9-11'de büyük bir JS dosyası sıkıştırılırken aynı worker'daki diğer bağlantılar bekler. Hedef aynı zamanda üretim
  trafiği alıyorsa (internet RP, GBNGXT34) etki gerçek bağlantılara değer: yüksek seviyeli brotli static koşusu trafiğin az olduğu saate
  alınmalı. Betik bunun için UYARI vermez, seviyeyi de sınırlamaz.
- **Brotli static koşuda taban Anon** (ölçülmedi, koddan): sıra `uygula` (reload) → `dosyalar` → `kanit` → kaydedici; `.br`'yi üreten
  worker'lar ölçülen worker'ların kendisidir ve "Bellek artışı nasıl okunur"daki gibi çalışma alanını hemen geri vermeyebilir. `.gz`
  dışarıda `gzip` ile üretildiği için gzip static'te bu etki yoktur: bellek değerleri brotli static ile gzip static arasında
  karşılaştırılmamalı, brotli static koşular kendi aralarında aynı seviyeyle karşılaştırılmalı. `dosyalar` sonrasına worker tazeleyen ek reload
  konulmadı. Bellek ekranı yalnız bilgidir: geçerlilik ve karar etkilenmez.
- **CRLF kopya betiğin yanında**: `/tmp`'deki kopya `durdur.sh` eşleşmesine girmez; `<betik>.lf` kullanılır, `durdur.sh` `hazirlik.sh.lf`'yi tanır.
- **Kanıt canlı durumu ölçmez**: `uygula` diskteki konfu okur; `-s reload` rc 0 yeni konfun yüklendiğini kanıtlamaz. http2 için ön
  kontrolün ALPN ölçümü, sıkıştırma için kip doğrulaması canlı kanıttır.
- **Sunucu geneli**: seviye ve static tüm uygulamaları, `http2` `default.conf`'taki server bloklarını etkiler; Portal'da "başka ekip
  kullanıyor" kapısı yok. 30 senaryoluk kuyruk en az 120 reload yapar (her öğede ön kontrol ve koşu, ikişer), her biri 90 sn'ye
  kadar bekleyebilir; bu pay kuyruk tahminine girmez.
- **AWX iptali temizliği atlar**: iptal edilen ön kontrol / koşuda Play 7, iptal edilen araclar işinde Play 8'in
  `always`'i koşmaz; kalan `<id>/arac` ve `arac_<id>` dizinleri 1 gün sonra bir sonraki ön kontrol / koşu / araclar
  işi tarafından süpürülür (yalnız bu alt dizinler; korunan koşu sonuçlarına dokunulmaz).

## Bekçiler

- Ansible deposu: `python -B bmw_nginx/tests/check_nginx_loadtest_job.py` (Git Bash ya da Linux, PyYAML, jinja2, node).
  L1 metin (CRLF, `#`, SEKME, ters eğik çizgi, yasak modüller; koşul metninde derinlik 0'da ` if ` yok; tur 4: vekil
  ortamı yalnız Play 8'in üç get_url görevinde, `validate_certs: false` yok, Play 3 / 8'de `/tmp` yok), L2 yapı
  (10 play sırası, rescue, delegate/unreachable, Play 2 / 3 / 8'de getent register + hemen ardından `is unreachable`
  fail'i, localhost play'lerinde korumasız işlem / hedef türü / motor adı yok, kaydedici süreleri ve hazır deseni,
  set_stats), L3 girdi sözleşmesi (38 koşu + 10 araclar değişkeni; README tablosu 44; `yuk_proxy` ve eski yol
  değişkenleri yalnız izinli yerlerde; tek async görev iki betiğin ortamını taşır, K6 / WRK araç kopyası), L4 betik
  başvuruları, L5 girdi kapısı (dört kip × motor birleşimi, eski Portal'ın durdurmaları, §4'ün ihlal durumlarının
  hepsi), L6 sonuç derlemesi ve play'ler (serbest/wrk dalları, patlayan hedef hostvars'ı ile serbest, D7, Play 2 koşu
  kapısı ve reddinden sonraki Play 3-10 zinciri, erişilemeyen hedef / yük makinesi (Play 2-10: yalnız getent,
  `erisilemedi (ssh): ...`), Play 3 izin dosyası (ret nedeni en çok 40 karakter; set_fact sonuçlarında vekil yok,
  davranış aynı), wrk `-v` sürüm satırı, değişkensiz durdur; tur 4: araclar girdisi ve ihlalleri, eski Portal'ın 30
  değişkenli isteği, Play 3 araç kopyası kapısı, Play 7 `arac/` silmesi, Play 8 / 9 sahte modüllerle, Play 10 araclar
  sonucu), L7 betik davranışı (sahte k6/wrk/curl/ps/ip/proc ile; wrk_kos.sh sırası, DUR koşulları, istemci dosyası
  şeması, wrk ortamında `IS_PARCACIGI`; durdur.sh wrk ve `arac/` kuralları; gerçek procps ile `[k]6`/`[w]rk`;
  `arac_hazirla.sh` sahte derleme araçları ve Python `tarfile` arşivleriyle; `make` yoksa küçük sahte make), L8 k6 mantığı, L9 README, L10 Portal aynası, L11 yuk_wrk.lua (metin, her zaman:
  `delay()`'in her dönüşü ≥ D ve ilk `N / T` çağrıda `[D, 2D)`, init `IS_PARCACIGI`, wrk_kos.sh wrk ortamı, iş
  parçacığına özgü tohum: init'te `math.randomseed(os.time() + (tonumber(id) or 0) * 7919)`, setup'ta
  `thread:set('id', #threads)`, başka randomseed yok; isteğe bağlı Lua yorumlayıcısıyla mantık, iki iş parçacığının
  ilk `N / T` jitter dizisi farklı), L12 (isteğe bağlı) Portal `dogrula.cjs` ve `araclar.cjs`'nin ürettiği
  extra_vars'ın girdi kapısından geçmesi (anahtar sıraları, işaret yolları), L13 `arac_hazirla.sh` / `durdur.sh` metni. Sunucu ayarı: L5 `l5_srv` (1800 bütçe tavanı dahil), L6 `l6_srv` (Play 2 sırası uygula -> dosyalar -> kanit, Play 7 `always`, `KOSU_ID` / `DEVRAL`, `baska`, Play 10 `sunucu_ayar`, `srv_hazirlik`, `hazirlik_yedek`), L7 `hazirlik` = `bmw_nginx/tests/check_nginx_loadtest_hazirlik.sh` (sahte dzdo / nginx / curl / ps, gerçek gzip; tek başına da koşar; `HAZIRLIK_SENARYO=<regex>`, mutasyon kopyası `HAZIRLIK_BETIK`; Git Bash'te izin biti, symlink ve CR iddiaları atlanır, WSL'de koşar). KÖR: gerçek nginx + ngx_brotli, gerçek dzdo kuralı (kanarya). `kosul()` Ansible'ın iki koşul yolunu da sınar (derleme + bool sonuç). Mutasyon kopyaları:
  `NGINX_LOADTEST_YML`, `NGINX_LOADTEST_FILES`, `NGINX_LOADTEST_README`; yalnız bazı bölümler:
  `NGINX_LOADTEST_ONLY='L[1-79]'`; kabuk testinden yalnız biri: `NGINX_LOADTEST_KABUK=wrk|durdur|hazirlik|...`; Portal
  deposu: `NGINX_LOADTEST_PORTAL_DEPO` (L10, L12); Lua: `NGINX_LOADTEST_LUA` (yorumlayıcı ya da sarmalayıcı;
  kurulumsuz yol: bir LuaJIT `lua51.dll`'ini ctypes ile yükleyen `.cmd`) ya da PATH'te `luajit`/`lua5.1`/`lua`.
  Gerçek procps `ps` için WSL/Linux:
  `NGINX_LOADTEST_ONLY='L[1-79]' python3 -B ...` (node yoksa L8 hariç). KÖR alanlar: gerçek Ansible, gerçek wrk / Lua
  / k6 / nginx koşmaz (sahteleri sözleşmeyi taklit eder; kanarya); gerçek indirme ve derleme koşmaz (`arac_hazirla.sh`
  sahte tar arşivleri ve sahte gcc / make / objdump / ldd ile sınanır; gerçek wrk Makefile'ı, vekil, GitHub
  yönlendirmesi ve RHEL 8 / 9 glibc farkı kanaryada).
- Gerçek Ansible ile (isteğe bağlı, WSL'de ansible-core 2.16): `ansible-playbook --syntax-check`, hiç extra_var olmadan
  koşu (localhost; diğer hostlar ulaşılamaz adrese eşlenmiş): girdi reddi, Play 6 ve 9 atlanır, Play 10 `set_stats`
  yayınlar ve job `girdi reddedildi` ile düşer; araclar girdisi + erişilemeyen derleme makinesi Play 10'a ulaşır ve
  `derleme makinesi <D>: erisilemedi (ssh): ...` der; serbest durdur ve serbest ön kontrol (yük makinesi erişilemez) Play 10'a
  ulaşır ve `yuk makinesi <Y>: erisilemedi (ssh): ...` der (sunucu ön kontrol / koşu, iki host erişilemezken:
  `hedef <H>: erisilemedi (ssh): ...; yuk makinesi <Y>: ...`). Girdi kapısının maddeleri gerçek `Conditional` ile
  varsayılan ve eski yolda (`_ANSIBLE_DISABLE_BACKPORTED_INSPECTIONS=1`), 2.19 davranışı
  `ANSIBLE_ALLOW_BROKEN_CONDITIONALS=False` ile.
- `bmw_nginx/tests/check_readme_sync.py`: bu README'deki değişken tablosu ve sunucu adları koddan. İlk hücresi ters
  tırnaklı küçük harf tanımlayıcı olan tablo satırı YALNIZ `yuk_*` değişkenleri içindir (özet anahtarları, istemci
  eşlemesi ve set_stats alanları ters tırnaksız tablo ya da kod bloğu).
- Portal: `server/ansible/__tests__/nginx-loadtest-ayna.test.cjs` (ayna + kayıt; NA5 delegate ve Play 2 / 3 getent
  erişilemezlik fail'i; NA7 Portal `EKSTRA_ANAHTARLAR` + `ARAC_EKSTRA_ANAHTARLAR` = bu README'nin değişken tablosu, 44),
  `nginx-loadtest-arac.test.cjs` (NA8: vekil ortamı yalnız Play 8 get_url'lerinde, TLS doğrulaması, Play 3 araç kopyası,
  `/tmp` yok, Play 7 `arac/` silmesi, Play 9 `mv -T` / 0644 / SHA256SUMS / manifest, `arac_hazirla.sh` metni, 10 play), `nginx-loadtest-wrk.test.cjs`
  (NA6: yuk_wrk.lua / wrk_kos.sh / durdur.sh / playbook metin kuralları; (i) tohum satırları, (m) ret nedeni kesmesi ve
  dosya metni temizliği), `nginx-loadtest-k6.test.cjs` (k6 mantığı; K7 `ozet_hesapla` anahtar sırası =
  wrk_kos.sh `JSON_ANAHTARLARI`), genel playbook bekçileri.

## Kanarya (ilk gerçek koşudan önce, bir kez)

k6 / sunucu hedef (ilk kurulum):

1. www'nin ev dizini ve `~/.portal_yuktesti` hem hedefte hem yük makinesinde yazılabilir mi;
   `getent passwd www` ev dizini.
2. become www ile `copy` (betik kopyası) ve `async` + `poll: 15` yük makinesinde çalışıyor mu
   (`nginx_config_audit` deseni).
3. Hedefte `setsid`, `nohup`, `timeout`, `gzip`, `ip`; yük makinesinde `curl`, `xargs -P`.
4. `dzdo -n /usr/nginx/sbin/nginx ... -T` www olarak çalışıyor mu (yoksa `server_name_var` ölçülemez).
5. Hedefte `/proc` hidepid var mı (`master_sayisi`).
6. Bir dakikalık deneme koşusu: tek hız, tekrar 1, `yuk_sure_sn` 40 (Portal'ın alt sınırı; playbook
   30'u da kabul eder ama analiz penceresi 30 sn'den kısa kalır); /sw'de dosyalar ve SHA256SUMS,
   `bilgi_*.txt`'de `test_satiri > 0`.
7. Koşu sırasında Portal "Durdur": k6, kos.sh ve kaydedici iki sunucuda da biter mi; durdurma işi
   `successful` bitince Portal kilitleri bırakır mı.
8. HTTP/2 (`yuk_protokol` h2, kip `ka`): h2 sunan bir TEST vhost'ta ön kontrol `alpn_h2 true`, h2 sunmayan birinde
   `HTTP/2: hedef bu Host icin ALPN ile h2 sunmuyor` engeli; 1 adımlık h2 koşusunda istemci CSV'sinde `protokol` h2,
   `protokol_uyumsuz` 0, `http2` ≈ istek sayısı; nginx logunda `connection_request` ile VU başına bağlantı modeli not edilir.
   curl'ü HTTP/2'siz yük makinesinde (GBNGXT34: `curl --version`'da `HTTP2` yok) aynı iki vhost: `curl_h2 0`,
   `alpn_kaynak openssl`, `yollar_h2 -`, OZET bugünkü h1 ön kontrolüyle aynı; h2'li vhost'ta `alpn_h2 1` (engel yok),
   h2'siz vhost'ta `alpn_h2 0` ve openssl metinli engel; `openssl version` ve SNI=0 / SNI=1 ikisi de not edilir.

9. Sunucu ayarı (TEST hedef, bir kez): ön kontrol `ayar 1` + brotli static: `default.conf`'taki üretici bloğu `nginx -t` ve reload'dan geçiyor mu, porta bağlanılıyor mu,
   `brotli_static` server düzeyinde kabul ediliyor mu; iş bitince üç konf dosyası sha256 ile aynı ve
   `<www ev>/.portal_yuktesti/hazirlik` yok. 1 adımlık brotli static koşusu: `.br` dosyaları seçilen seviyeyle üretildi, `curl --compressed`
   gerçek sıkıştırılmış içerik döndü, `kanit` gerçek nginx'te `Content-Length` ile geçti (h1 ve h2 birer koşu), `hazirlik_R<id>_<host>.txt` `/sw`'de, iş bitince manifest silindi. `dzdo` kuralı `-t`,
   `-T`, `-s reload` için geçerli mi; www `conf.d/default.conf`, `conf/gzip.conf`, `conf/brotli.conf` ve dizine yazabiliyor mu.

wrk ve serbest hedef:

1. Yük makinesinde `/home/www/bin/wrk -v | head -1` `wrk 4.` ile başlar ve
   `wrk_kos.sh --kuru` planı yazar (`TAVAN_RPS` verilerek).
2. wrk ön kontrolü (TEST hedef): `wrk_var` / `wrk_calisiyor` / sürüm / sha256 kayıttakiyle aynı.
3. 1 adımlık wrk koşusu (N=1, T=1, tekrar 1, süre 40, `ka`) limit_req payı olan TEST hedefte: istemci CSV/JSON'da
   `n_olcum > 0`, p50/p95/p99 dolu, `http2` 0, `protokol` h1, `protokol_uyumsuz` 0, `n_429` 0, gerçek /sn ≤ tavan,
   Portal analizi geçerli.
4. Aynısı `yeni` kipinde: p95 DOLU beklenir (wrk gecikmeyi keep-alive denetiminden önce kaydeder); boşsa bu README'ye
   not düşülür (analiz null kalır).
5. Aynı ayarla iki wrk tekrarının p95 farkı not edilir (wrk eşikleri için veri).
6. nginx log_format'ta `$ssl_session_reused` varsa `yeni` kipinde oturum devamı oranı not edilir (yoksa atlanır).
7. wrk koşusu sürerken Portal "Durdur": wrk ve wrk_kos.sh durur, kilitler bırakılır.
8. `/etc/portal_yuktesti/serbest_aglar` (sahip, izin, içerik) ve `NGINX_LOADTEST_SERBEST_AGLAR` tanımlandıktan sonra
   izinli bir LB VIP'ine serbest ön kontrol: yalnız yük makinesi play'leri koşar, `serbest_ag` dolu; dosya
   kaldırılınca aynı ön kontrol `serbest izin listesi: dosya /etc/portal_yuktesti/serbest_aglar yok, ...` ile, dizin de
   kaldırılırsa `serbest izin listesi: dizin /etc/portal_yuktesti yok, ...` ile reddedilir.
9. Serbest LB hedefinde wrk ısınması soket hatasız (SNI=IP ile TLS el sıkışması geçer).
10. AWX'te şablonun Execute rolü yalnız Portal servis hesabında; eski bir ön kontrol işini 15 dk sonra Relaunch →
    `is gecerlilik suresi` ile red.
11. Sunucu koşusunda Play 2 koşu kapısı `ip_yerel 1` görür (iş çıktısında `Kosu kapisi` görevi).

Araç seti (tur 4; ilk ön kontrolden önce):

0. İki arşiv özeti "Arşiv özetlerini sabitleme"deki gibi bağımsız hesaplanıp Portal `.env`'ine yazıldı; özetsiz
   "Araçları hazırla" Portal'da 409 ile, bir özeti bilerek bozulmuş iş `indirme basarisiz (...): The checksum ...` ile
   düşer ve derleme makinesinde `~/.portal_yuktesti/arac_<id>` kalmaz.
1. `araclar` işi (GBLABT02): set_stats `araclar` bölümünde `derleme_rhel`, `derleme_glibc`, `wrk_glibc_gerekli`,
   `wrk_openssl` (`OpenSSL 1.1.1...`), `wrk_luajit`, `k6_statik true`; `wrk_kutuphaneler`'de libssl / libcrypto yok;
   `/sw` dizini 0755, dosyalar 0644, `SHA256SUMS` dizinde `sha256sum -c SHA256SUMS` ile OK.
2. Aynı iş vekilsiz (Portal `NGINX_LOADTEST_ARAC_PROXY=yok`) denenirse açık `indirme basarisiz (...)` iletisi.
3. Bir yük makinesinde k6 ön kontrolü: "Araç kopyası" geçti, `arac_sha256` = setin k6 sha256'sı; iş bitince
   `<www ev>/.portal_yuktesti/` altında `arac/` kalmaz.
4. wrk ön kontrolü bir RHEL 8 ve bir RHEL 9 yük makinesinde (`arac_glibc` satırı; RHEL 9'da derlenmiş wrk RHEL 8'de
   `glibc uyumsuz` engeli verirse araçları RHEL 8 bir derleme makinesinde yeniden hazırlayın).
5. 1 adımlık k6 ve wrk koşusu sürerken `ps` çıktısında ikili yolu `<koşu dizini>/arac/...`; Portal "Durdur" ikisini de
   durdurur ve `arac/` silinir.
6. `/sw`'deki `k6` dosyasına bir bayt eklenip ön kontrol koşulursa `arac kopyasi dogrulanamadi: sha256 farkli (...)`
   engeli; sonra araçlar yeniden hazırlanır.
7. Eski elle kurulum (`/home/www/bin/k6`) silinmeden kalır ve hiçbir iş çıktısında geçmez.
