# nginx_loadtest — Portal › Nginx Hub › Yük Testi (k6)

Portal'ın "Yük Testi" sekmesi bir nginx TEST sunucusunun (hedef) istek başına CPU'sunu ve yanıt
sürelerini ölçmek için bu tek playbook'u üç kipte koşturur. Yük, ayrı bir **yük makinesinden** k6
ile, hedefin IP'sine doğrudan (LB/F5 atlanarak) ve yalnız HAR'dan türetilmiş **yol listesiyle**
(sorgu, çerez, başlık, gövde yok) üretilir. Hedefte aynı anda `cpu_kaydedici.sh` worker CPU'sunu
ve yalnız test isteklerinin access-log satırlarını kaydeder. Sonuç dosyaları GBLABT02 üzerinden
`/sw`'ye yazılır; Portal oradan okur, analiz eder ve kendi DB'sine yazar.

Kaynak: el kiti `f5_rehber/har_yuk_testi` (kos.sh, yuk_k6.js, cpu_kaydedici.sh). Betikler kitten
kopyalanmış, yalnız aşağıda ("Betikler") sayılan Portal farkları eklenmiştir. Portal tarafı
sözleşmesi: Portal `docs/NGINX-YUK-TESTI.md` ve uygulama sözleşmesi.

## Dosyalar

| Dosya | İş |
|---|---|
| `nginx_loadtest.yml` | Tek playbook, üç kip (`yuk_islem`): `on_kontrol`, `kosu`, `durdur`. Sekiz play (aşağıda). |
| `files/on_kontrol.sh` | Yük üretmeyen ön kontrol. `hedef` kipi hedefte (IP yerel mi, `nginx -T`'de server_name, nginx master sayısı, `/web_log` doluluğu ve okunabilirliği, log biçimi, statik sıkıştırma direktifi); `yollar` kipi yük makinesinde (senaryodaki her tekil yola TEK HTTP/1.1 isteği). |
| `files/kos.sh` | Kit kopyası: bir ADIM'ın (hız × tekrar) k6 koşularını sırayla çalıştırır. |
| `files/yuk_k6.js` | Kit kopyası: açık döngü (constant-arrival-rate) k6 betiği, istek başına TEK GET. |
| `files/cpu_kaydedici.sh` | Kit kopyası: hedefte saniyede bir worker CPU örneği + yalnız test UA'lı log satırları. |
| `files/durdur.sh` | Bir koşunun bir sunucuda kalan süreçlerini (pid dosyaları, k6, kit betikleri) TERM, 10 sn sonra KILL. |

Portal'daki birebir aynası: `server/ansible/bmw_portal/nginx_loadtest/**` (iki kopya **bayt bayt
aynı**; Portal testi `nginx-loadtest-ayna.test.cjs` sabit sha256 listesiyle ve
`NGINX_LOADTEST_ANSIBLE_DEPO` verilirse bu depoyla karşılaştırır).

## Akış

Play sırası (strateji **linear**; `strategy: free`, `poll: 0`/`async_status` YOK):

1. **localhost — girdi kapısı** (`block`/`rescue`): her extra_var aşağıdaki kurala göre `assert`;
   senaryo base64'ten çözülür, **her satırı** yeniden denetlenir, sha256 karşılaştırılır;
   betiklerin kaynak sha1'leri alınır; hedef `yuk_hedef`, yük makinesi `yuk_makine` grubuna
   `add_host` ile eklenir (AWX `limit` KULLANILMAZ). Reddedilirse hiçbir hosta bağlanılmaz.
2. **yuk_hedef** (become www): `on_kontrol` → `on_kontrol.sh hedef`; `kosu` → koşu dizini,
   `cpu_kaydedici.sh` kopyası (kapı), kaydedici **ayrık** başlatılır
   (`setsid nohup timeout -k 300 <bütçe+120> env SURE=<bütçe+60> ... & echo $! > kaydedici.pid`),
   `wait_for` ile `YUKU SIMDI BASLATIN` ya da başlatıcının/kaydedicinin KENDİ hata satırı beklenir
   (en çok bosta+90 sn; desen "Tuzaklar"da).
3. **yuk_makine** (become www): `on_kontrol` → k6 var mı/sürüm/sha256 + `on_kontrol.sh yollar` — bu
   istekler YALNIZ hedefte ölçülen `ip_yerel` `1` iken gider (hedef IP hedefte yerel değilse ya da
   ölçülemediyse hiç istek gönderilmez; yük makinesi sonucu `FAIL`, neden `hedef IP hedefte yerel degil
   ya da olculemedi; istek gonderilmedi`); `kosu` (yalnız kaydedici hazırsa) → `kos.sh` + `yuk_k6.js` +
   senaryo kopyası (kapı), `timeout -k 30 <bütçe> env ... bash kos.sh R<id> <K|B>` (`async: bütçe+300`,
   `poll: 15`).
4. **yuk_hedef**: kaydediciye `kill -TERM <pid>` (pid'in komut satırı koşu dizinini içeriyorsa),
   bitmesi en çok 290 sn beklenir (trap `bitir` `bilgi_*.txt` yazar; sarmalayıcının KILL'i 300 sn'de),
   `log_*.tsv` gzip'lenir.
5. **yuk_hedef + yuk_makine**: sonuç dosyaları (toplam ≤ 200 MiB) kontrol düğümüne `fetch` (düz).
6. **localhost** (`ignore_unreachable: true`): dosyalar GBLABT02 üzerinden
   `<yuk_cikti_kok>/<yuk_run_id>/`'ye kopyalanır, `SHA256SUMS` yazılır; `istemci_*.json` özetleri okunur;
   kontrol düğümündeki geçici dizin silinir. GBLABT02'ye giden her görev `register` edilir ve hemen
   ardından `<kayıt> is unreachable` ise (döngülü dosya kopyasında öğeler de: `<kayıt>.results`'ta
   `unreachable`) `fail` → `rescue` (`/sw kopyasi: GBLABT02 erisilemedi (...)`); kopya o zaman asla
   "tamam" sayılmaz (`sw_dizin: null`).
7. **yuk_hedef + yuk_makine**: `kosu`/`durdur` → `durdur.sh` (kalan süreçler); koşu dizini silinir
   (`on_kontrol`: her zaman; `durdur`: süreçler durduysa; `kosu`: süreçler durduysa VE (/sw kopyası
   tamam YA DA `kos.sh` hiç başlamadı)). `kos.sh` başladı ama /sw kopyası yoksa (DUR'un ya da başarılı
   ama kopyalanamamış koşunun TEK kopyası) dizin iki sunucuda da kalır ve yerleri `hata` metninin
   sonuna eklenir: `kosu dizini silinmedi (/sw kopyasi yok, veri elle kurtarilabilir): <host>:<dizin>, ...`
   (metnin geri kalanı bu not sığsın diye tam ölçüyle kısaltılır; toplam en çok 300 karakter).
8. **localhost — sonuç**: `set_stats nginx_loadtest_result` **her yolda** (girdi reddi, erişilemeyen
   host, betik hatası, derleme hatası dahil; derleme düşerse `rescue` en küçük FAIL sonucunu yazar),
   ardından `durum` OK değilse job düşürülür (`DUR` dahil; Portal'ın okuyuşu aşağıda).

Her uzak play ve GBLABT02'ye delegate eden /sw play'i `ignore_unreachable: true` ve
`block`/`rescue` taşır: bir host (ya da GBLABT02) düşse de sonraki play'ler (durdurma, temizlik,
sonuç) koşar. localhost play'leri hiç extra_var gelmese de koşar (AWX'ten elle başlatma, Variables
prompt kapalı): her ifadede `(yuk_islem | default(''))`; girdi kapısı reddeder, Play 6 atlanır, Play 8
`girdi reddedildi` sonucunu yayınlar.

## Portal ↔ AWX sözleşmesi

Katalog anahtarı `nginx_loadtest_run` (kategori `nginx`, env `NGINX_LOADTEST_RUN_TEMPLATE_ID`),
Portal `BEKLENEN_PLAYBOOK.nginx_loadtest_run = 'nginx_loadtest.yml'`. **`limit` her zaman boş**;
`LIMIT_MUAF` ve vekil sunucu değişkenleri hiç gönderilmez. Değerler string beklenir (Portal sayı
da gönderebilir; playbook `| string` ile denetler).

| Değişken | Tip | Zorunlu | Kural |
|---|---|---|---|
| `yuk_islem` | string | her kip | `on_kontrol` \| `kosu` \| `durdur` |
| `yuk_run_id` | string | her kip | `^[0-9]{1,10}$` (Portal koşu id'si; ADIM `R<id>`, koşu dizini `~www/.portal_yuktesti/<id>`) |
| `yuk_hedef_host` | string | her kip | `^[A-Z0-9][A-Z0-9-]{1,30}$`; ad kuralına göre DEV/TEST/QA (`GBNG[WX][A][DTQ]...`); EDU istisnası (GBNGXT51) değil |
| `yuk_yuk_host` | string | her kip | hedefle aynı kural; hedeften FARKLI |
| `yuk_hedef_ip` | string | on_kontrol, kosu | IPv4; 0/127/169.254/224+ değil; hedefte yerel olduğu ön kontrolde ölçülür |
| `yuk_host_basligi` | string | on_kontrol, kosu | RFC1123 küçük harf, port/joker yok, ≤ 253 |
| `yuk_sni` | string | on_kontrol, kosu | `0` (Host başlığı, URL IP) \| `1` (URL host + `--resolve`/k6 `hosts`) |
| `yuk_senaryo_tur` | string | on_kontrol, kosu | `K` \| `B` |
| `yuk_senaryo_b64` | string | on_kontrol, kosu | TSV'nin base64'ü; çözülmüş ≤ 200 KB, 1..400 veri satırı + isteğe bağlı tek `#` başlık |
| `yuk_senaryo_sha256` | string | on_kontrol, kosu | çözülmüş baytların sha256'sı (64 hex) |
| `yuk_hizlar` | string | on_kontrol, kosu | `^[0-9]{1,3}( [0-9]{1,3}){0,4}$`, her biri 1..450 |
| `yuk_tekrar` | string | on_kontrol, kosu | 1..3 |
| `yuk_kip` | string | on_kontrol, kosu | `yeni` (her istek yeni bağlantı) \| `ka` (keep-alive) |
| `yuk_ae` | string | on_kontrol, kosu | `br` \| `gzip` \| `identity` |
| `yuk_isinma_sn` | string | on_kontrol, kosu | 5..60 |
| `yuk_sure_sn` | string | on_kontrol, kosu | 30..300 |
| `yuk_bosluk_sn` | string | on_kontrol, kosu | 0..120 |
| `yuk_bosta_bas_sn` | string | on_kontrol, kosu | 30..120 (kaydedicinin yük öncesi boşta örneği) |
| `yuk_maxvu` | string | on_kontrol, kosu | 10..199 (`limit_conn` 200/IP) |
| `yuk_butce_sn` | string | on_kontrol, kosu | ≤ 2700 ve ≥ `bosta + hız_sayısı × tekrar × (isinma + sure + bosluk) + 120` |
| `yuk_k6_yolu` | string | on_kontrol, kosu | `^/[A-Za-z0-9._/-]{1,200}$`, `..` yok (varsayılan Portal'da `/home/www/bin/k6`) |
| `yuk_ua_onek` | string | on_kontrol, kosu | `^[a-z][a-z0-9-]{2,30}$` (Portal: `portal-yuktesti`) |
| `yuk_cikti_kok` | string | on_kontrol, kosu | `^/sw/BMW_PORTAL(_DEV)?/...`, `..` yok (Portal: `NGINX_LOADTEST_DIR`, varsayılan `/sw/BMW_PORTAL/nginx_loadtest`) |

`durdur` kipinde yalnız ilk dört değişken gerekir ve denetlenir; diğerleri gelse de kullanılmaz.

### Senaryo satırı

`agirlik<TAB>har<TAB>tur<TAB>boyut<TAB>yol` — kos.sh / yuk_k6.js / har_senaryo.py ile aynı beyaz
liste: `^[0-9.]+\t[0-9]+\t[a-z]+\t[a-z]+\t/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$`. Ek olarak `//` ile
başlayan ya da `..` parçalı yol, `;` içeren yol (ör. `;jsessionid=...`: oturum bilgisi senaryoya
giremez; `yt_re_kotu_yol`), CR ve ikinci bir `#` satırı reddedilir. Yük makinesine yalnız bu dosya
gider (`~www/.portal_yuktesti/<id>/senaryo/<K|B>.tsv`, 0600) ve sha256'sı yeniden doğrulanır.

### set_stats: `nginx_loadtest_result`

Tek yazar localhost, `per_host: false`, `aggregate: false`, `fail`'den ÖNCE ve koşulsuz.

```
{ surum: 1, run_id, islem, durum: 'OK'|'FAIL'|'DUR', hata: <≤300 karakter|null>,
  on_kontrol: { ip_yerel, server_name_var, master_sayisi (int|null), web_log_df (int|null), log_dizini_okunur,
                log_format_ua (bool|null), statik_direktif (bool|null), k6_var, k6_surum (str|null),
                k6_sha256 (str|null), yollar_toplam, yollar_200, ilk_hatalar: [{yol, status}] (≤20),
                sikistirma: {statik, dinamik, sikistirmasiz} } | null,
  kosu: { kos_rc (int|null), kaydedici_rc (int|null), bas_epoch, bit_epoch,
          istemci_ozet: [istemci_<TUR>.json içerikleri], dosyalar: [{ad, bayt}], sw_dizin (str|null) } | null,
  durdur: { durdurulan: ["<HOST> <ad> pid <pid> <TERM|KILL|KALDI>"] } | null }
```

- `durum`:
  - `on_kontrol`: `OK` yalnız iki taraf da ölçüldüyse ve **engel** yoksa. Engeller (Portal koşuyu
    başlatmaz): hedef IP hedefte yerel değil (ya da ölçülemedi: o zaman yük makinesinden HİÇ istek
    gitmez ve yük makinesi tarafı da `FAIL`); server_name `nginx -T`'de yok ya da `nginx -T`
    okunamadı; `/web_log` okunamıyor; k6 yok/çalışmıyor; hiç yol denenmedi; hedef IP yük
    makinesinde yerel (istek gönderilmez). Uyarılar `durum`'u bozmaz: `yollar_200 < yollar_toplam`,
    `sikistirma.statik > 0`, `web_log_df ≥ 65` ya da `null`, `log_format_ua false`. `master_sayisi`
    ölçülemediyse `null` (0 değil: 0 bir ölçümdür, hidepid ya da nginx yok); Portal ölçülmüş ≠ 1'i
    engel (kaydedici koşuda zaten `HATA` ile durur), `null`'u uyarı sayar.
  - `kosu`: `OK` = `kos_rc 0` + `kaydedici_rc 0` + iki taraf toplandı + /sw kopyası tamam;
    `DUR` = kit bir adımda durdu (`kos_rc` 4: 429/HTTP2/k6 hatası/boş özet ya da TERM; 130: boşlukta
    kesildi) ama o ana kadarki veri /sw'de; diğer her şey `FAIL`.
  - `durdur`: `OK` = iki sunucuda da `durdur.sh` "kalan süreç yok" dedi; aksi `FAIL` (job düşer).
- **DUR sözleşmesi**: `OK` dışındaki her `durum`'da (DUR dahil) son görev job'ı düşürür, AWX `failed`
  der. Portal kararı set_stats'tan verir: `durum: DUR` + AWX `failed` koşusu **başarılı** sayılır
  (`DONE`, geçerlilik en iyi `KISMI`; veri /sw'de), `durum: FAIL` her zaman başarısız, AWX `canceled`
  her şeyden önce gelir.
- `kaydedici_rc`: kaydedici ayrık koştuğu için gerçek çıkış kodu alınamaz; `bilgi_*.txt` varsa `0`,
  `kaydedici.out`'ta `HATA:` varsa `2`, yoksa `null`.
- `bas_epoch`: kaydedicinin başlatıldığı an, `bit_epoch`: /sw kopyasından hemen önce (kontrol
  düğümü saati). Ölçüm penceresinin asıl sınırları `bilgi_*.txt` ve `zaman.csv`'dedir.
- `istemci_ozet`: yalnız başarılı adımlar (`hatali_istemci_*` dahil DEĞİL; dosyalar /sw'de).
- `sw_dizin`: yalnız /sw kopyası (dosyalar + `SHA256SUMS`) tamamsa dolu; `null` iken Portal /sw'yi okumaz.
- Eksik artifact Portal'da başarı sayılmaz; değerler string de gelebilir (Portal hoşgörülü okur).

### Portal kilitleri ve Durdur

AWX iptali uzaktaki async `kos.sh`/k6'yı ve ayrık kaydediciyi DURDURMAZ ("iş bitti" ≠ "yük bitti").
Portal kilitleri (hedef, yük makinesi, global) bu yüzden işe bağlıdır ve işin türüne göre bırakılır:

- Bağlı iş `successful` biterse kilit hemen bırakılır. `durdur` kipindeki iş ancak iki sunucu da
  "kalan süreç yok" derse `successful` biter (aksi halde `durum: FAIL` ve job düşer).
- `kosu` işi `canceled`/`error` biterse, ya da `durdur` işi `failed`/`canceled`/`error` biterse kilit
  DOLU kalır ve yalnız süresiyle (koşunun süre sınırı + 180 sn) düşer: uzakta süreç kalmış olabilir.
- Portal "Durdur": koşan `kosu` işini iptal eder ve bu playbook'u `durdur` kipiyle başlatır; koşunun
  kilitleri durdurma işine bağlanır. Durdurma işi başlatılamazsa Portal hata döner ve kilitler süre
  sınırına kadar tutulur; Durdur yeniden denenebilir (`durdur.sh` idempotent: kalan yoksa `OK 0`).

### /sw düzeni

`<yuk_cikti_kok>/<yuk_run_id>/` (GBLABT02 üzerinden, `nginx_console_fetch.yml` ile aynı yazar: bağlanan
kullanıcı, `delegate_to: GBLABT02`, dizin 0777, dosya 0666; Portal aynı mount'u doğrudan okur):

- yük makinesinden: `istemci_<TUR>.json|csv`, `hatali_istemci_<TUR>.json|csv`, `zaman.csv`, `baslatilan.csv`
- hedeften: `sunucu_R<id>_<host>.csv`, `log_R<id>_<host>.tsv.gz`, `diger_R<id>_<host>.tsv`,
  `bilgi_R<id>_<host>.txt`, `konf_R<id>_<host>.txt`, `NOT.txt`
- `SHA256SUMS` (`sha256sum -c` biçimi; kontrol düğümündeki kopyalardan)

Kök: PROD `/sw/BMW_PORTAL/nginx_loadtest`, DEV `/sw/BMW_PORTAL_DEV/nginx_loadtest` (Portal
`docs/DEV-PROD.md` ile aynı ayrım). /sw koşu dizinlerinin saklama süresi bu playbook'ta yoktur.

## Betikler (kitten farklar)

- `yuk_k6.js`: User-Agent öneki `UA_ONEK` (varsayılan `portal-yuktesti`, `^[a-z][a-z0-9-]{2,30}$`);
  `HOST_BASLIGI` zorunlu (GLOMO varsayılanı kaldırıldı, yoksa init'te hata). Eşikler, iptal mantığı,
  setup ön kontrolü ve çıktılar kitle aynı.
- `kos.sh`: `UA_ONEK` k6'ya geçer; `HOST_BASLIGI` varsayılansız; `LIMIT_MUAF` YASAK (verilirse hata,
  k6'ya hep `0`); kendi pid'i `$SONUC/../kos.pid`; INT/TERM trap'i çalışan k6'yı (ve boşluk
  beklemesini) TERM ile sonlandırır — k6 ve `sleep` arka planda + `wait` ile koşar, trap ertelenmez;
  TERM'de adım `hatali_` önekiyle saklanır, `DUR: ... durduruldu (TERM ...)`, çıkış 4.
- `cpu_kaydedici.sh`: iki awk eşleşmesinde (`user-agent=<UA>/<ADIM>_` ve tırnaklı `"<UA>/<ADIM>_`)
  önek `UA_ONEK` (regex metakarakteri olamaz: aynı desen denetlenir) ve kaydın ADIM'i (`R<id>`, awk'a
  `-v ADIM`): test satırı YALNIZ bu koşunun TUR'larıdır; başka ADIM'ın satırı (ör. iptal edilmiş eski
  bir koşudan yetim kalmış k6, `R90` gibi önek çakışması dahil) `diger` trafiktir. Çıktılar kitle aynı.
- `on_kontrol.sh`, `durdur.sh`: Portal'a özgü (dosya başlarında ayrıntı).

Çıktı adları ve biçimleri (istemci_*, zaman.csv, baslatilan.csv, sunucu_*, log_*, diger_*, bilgi_*,
konf_*) kitle **aynıdır**; Portal'ın analizi (karsilastir.py portu) bunlara dayanır.

## AWX template ayarları

| Ayar | Değer |
|---|---|
| Playbook | `bmw_portal/nginx_loadtest/nginx_loadtest.yml` (bu klasör `bmw_nginx` ile aynı AWX projesinde) |
| Envanter | hedef/yük makinesi adlarını (kısa, büyük harf) ve GBLABT02'yi çözen envanter |
| Credential | makine credential'ı (uxmid; dzdo → www). Ek credential yok (DB'ye yazılmaz) |
| Variables — Prompt on launch | **AÇIK** (kapalıysa AWX extra_vars'ı sessizce yutar; Portal başlatmadan önce sınar) |
| Limit — Prompt on launch | kapalı (Portal `limit` göndermez; hedef add_host ile) |
| Concurrent jobs (allow_simultaneous) | **AÇIK**: `durdur` kipi aynı şablonla, koşan `kosu` işi hâlâ canlıyken (AWX iptali 403 dönebilir) başlayabilmeli; kapalıysa durdurma işi koşunun bitmesini bekler. Eşzamanlı koşuları Portal kilitleri (hedef, yük makinesi, global) engeller |
| Timeout | **3600 sn** (bütçe ≤ 2700 + kaydedici hazırlığı ≤ 210 + kaydedici durdurma ≤ 290 + toplama/kopya/temizlik; en kötü ~3450 sn; Portal kilit TTL'si 75 dk bundan uzun) |
| Forks | varsayılan (en çok iki uzak host) |
| Uzun iş otomatik iptali | listeye EKLENMEZ: AWX iptali uzak async k6'yı durdurmaz; Portal "Durdur" bu playbook'u `durdur` kipiyle koşturur |

Portal tarafı: `NGINX_LOADTEST_RUN_TEMPLATE_ID`, `NGINX_LOADTEST_AWX_SERVER_ID`,
`NGINX_LOADTEST_DIR`, `NGINX_LOADTEST_K6`, `NGINX_LOADTEST_YUK_HOSTLARI` (izinli yük makineleri).

## k6 kurulumu (yük makinesi, bir kez, elle)

Bu playbook k6 KURMAZ; yalnız varlığını, sürümünü ve sha256'sını ölçer (`on_kontrol`).

1. Kurumun onaylı kanalından k6 **linux-amd64** arşivini ve aynı sürümün `k6-v<sürüm>-checksums.txt`
   dosyasını alın (en az v0.45; ikisi de aynı kaynaktan).
2. Arşivi doğrulayın, doğrulanmadan açmayın:
   `sha256sum -c --ignore-missing k6-v<sürüm>-checksums.txt` → arşiv satırı `OK` olmalı.
3. Açın ve yalnız ikiliyi www'nin dizinine koyun: `install -m 0755 k6 /home/www/bin/k6`
   (sahibi www; grup/diğer YAZAMAZ). Başka yol kullanılırsa Portal'da `NGINX_LOADTEST_K6`.
4. `/home/www/bin/k6 version` ilk satırı ve `sha256sum /home/www/bin/k6` çıktısını kayda geçirin.
   Her ön kontrol `k6_surum` ve `k6_sha256`'yı gösterir; kayıttakiyle aynı olmalı (farklıysa ikili
   değişmiştir: koşu başlatmayın, kaynağını araştırın).
5. Yük makinesinden hedefin 443'üne erişim (firewall) ve `curl` varlığı ön kontrolle görülür.

## Zaman bütçesi

| | Değer |
|---|---|
| `yuk_butce_sn` (Portal hesaplar) | `bosta + hız × tekrar × (isinma + sure + bosluk) + 120`, ≤ 2700 |
| kos.sh dış sınırı | `timeout -k 30 <bütçe>` (async `bütçe + 300`, poll 15) |
| kaydedici | `SURE=<bütçe+60>` (kendi biter) ve `timeout -k 300 <bütçe+120>` |
| kaydedici hazır bekleme | `bosta + 90` sn |
| kaydedici TERM sonrası bekleme | 290 sn (`bitir`: `LOG_BEKLE` 6 sn + tüm log büyümesinin awk ayrıştırması; gawk 5.1 ölçümü ~400k test satırı ~25 sn, 800k test + 200k diğer ~48 sn); sarmalayıcının KILL'i 300 sn'de, beklemeden sonra |
| on_kontrol.sh hedef / yollar | `timeout -k 10 120` / `timeout -k 10 600` (≤400 yol × 5 sn / 4 paralel) |
| durdur.sh | TERM → 10 sn → KILL; dış `timeout -k 10 90` |

## Güvenlik sınırları (Portal'dan bağımsız, playbook'ta yeniden)

- Hedef ve yük makinesi ad kuralına göre DEV/TEST/QA, EDU istisnası değil, birbirinden farklı.
- Hedef IP özel aralıkta değil; hedefte yerel olduğu (`ip -o -4 addr`), yük makinesinde yerel
  OLMADIĞI ölçülür (yerelse istek hiç gönderilmez).
- Hız ≤ 450 (IP başına `limit_req` 500 r/s), VU ≤ 199 (`limit_conn` 200), `LIMIT_MUAF` yok; k6
  eşikleri 429 ve HTTP/2'de koşuyu keser (kit).
- Senaryo yalnız yol: satır satır beyaz liste + sha256; çerez/sorgu/başlık/gövde yok; vekil yok.
- Betik kopyaları: www'nin 0700 koşu dizinine; çalıştırmadan önce sha1 (kontrol düğümündeki
  kaynakla), sahip uid (www), düzenli dosya, grup/diğer yazamaz ve dizin 0700/www doğrulanır.
  `durdur.sh` opsx_was deseniyle bağlanan kullanıcı adına `/var/tmp` mktemp dosyasına kopyalanır
  (sahip uid = bağlanan kullanıcı), `always` ile silinir. `ansible.builtin.script` YOK.
- `nginx -T` estate komutuyla (`dzdo <nginx> -p /usr/nginx/ -c /usr/nginx/nginx.conf -e /web_log/error.log -T`,
  `nginx_console_dump.sh` ile aynı; dzdo reddederse dzdo'suz); çıktı yalnız geçici dosyada aranır, basılmaz.

## Tuzaklar

- Playbook'ta `#` satırı yok; açıklamalar burada. `{{ }}` içinde `\"` yok; `\t`/`\n` gereken her
  ifade ÇİFT tırnaklı YAML'da (YAML gerçek SEKME/satır sonuna çevirir; Ansible `{{ }}` içindeki
  ters eğik çizgiyi ikiler). Regex'ler girdi play'inin `vars:`'ında tek tırnaklı YAML'da (`\Z`:
  Python `$` sondaki satır sonunu kabul eder, değer enjeksiyonu kapanır).
- `ps | awk` kendine eşleşir: `durdur.sh` dizini awk'a ORTAM değişkeniyle verir, k6'yı alan
  bazında (`$2` adı `[k]6...`, `$3 == "run"`) tanır; kendi pid'ini ve ebeveynini dışlar. Gerçek
  procps `ps` ile bekçide sınanır (WSL/Linux).
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
- Kaydedici `/proc`'u www olarak okur. `/proc` hidepid ile bağlıysa nginx master görünmez:
  ön kontrol `master_sayisi 0` der, koşuda kaydedici `HATA: nginx master bulunamadi` ile durur
  (betiğin "dzdo ile çalıştırın" ipucu estate kuralı gereği UYGULANMAZ).
- AWX iptali uzak async görevleri (kos.sh/k6) ve ayrık kaydediciyi DURDURMAZ; hepsi kendi
  `timeout`'larıyla sınırlıdır ve Portal "Durdur" `durdur` kipini koşturur. Portal kilitleri bu yüzden
  iptal/hata sonrası süre sınırına kadar tutulur ("Portal kilitleri ve Durdur").
- Bütçe formülünde adım başına k6 başlatma/setup (≤400 yol ön kontrolü) payı yok; çok adımlı ve
  çok yollu koşu `timeout`'a takılabilir (kos.sh rc 124 → `FAIL`). Gerekirse Portal formülüne adım
  başına pay eklenmeli.
- `log_*.tsv` adım başına büyük (~25-30 MB); hedefte gzip'lenir, toplam 200 MiB'ı aşan sonuç toplanmaz.
- Koşu sırasında log rotate, reload ya da deploy olursa kaydedici bunu `bilgi_*.txt`'ye yazar; Portal
  analizi koşuyu GECERSIZ sayar.

## Bekçiler

- Ansible deposu: `python -B bmw_nginx/tests/check_nginx_loadtest_job.py` (Git Bash ya da Linux,
  PyYAML, jinja2, node). Metin/yapı (delegate eden play'de `ignore_unreachable` + her delegate
  görevinin ardından `is unreachable` fail'i; localhost play'lerinde korumasız `yuk_islem` yok;
  kaydedici bekleme/KILL süreleri; kaydedici hazır deseni), her extra_var'ın girdi kapısında
  denetlendiği, set_stats'in her yolda fail'den önce olduğu, betik başvuruları, girdi kapısının, sonuç
  derlemesinin ve localhost play'lerinin (hiç extra_var olmadan play 1 + 6-8; GBLABT02 erişilemez) Jinja2
  ile koşulması, Play 7 silme kararı, Play 3 `yollar` kapısı, betik davranışları (sahte k6/curl/ps/proc
  ile; kaydedicinin GERÇEK Play 2 satırı + `timeout -k` ile durdurulması, ADIM süzgeci) ve k6 mantığı.
  `NGINX_LOADTEST_PORTAL_DEPO` verilirse Portal aynası bayt bayt karşılaştırılır. Mutasyon kopyaları:
  `NGINX_LOADTEST_YML`, `NGINX_LOADTEST_FILES`, `NGINX_LOADTEST_README`. Gerçek procps `ps` için
  WSL/Linux: `NGINX_LOADTEST_ONLY='L[1-79]' python3 -B ...` (node yoksa L8 hariç).
- Gerçek Ansible ile (isteğe bağlı, WSL'de ansible-core 2.16): `ansible-playbook --syntax-check` ve
  hiç extra_var olmadan koşu (localhost; diğer hostlar ulaşılamaz adrese eşlenmiş): girdi reddi,
  Play 6 atlanır, Play 8 `set_stats` yayınlar ve job `girdi reddedildi` ile düşer. Play 6 GBLABT02'ye
  ulaşamazken `rescue` + `set_stats` de aynı yolla görülür.
- `bmw_nginx/tests/check_readme_sync.py`: bu README'deki değişken tablosu ve sunucu adları koddan.
- Portal: `server/ansible/__tests__/nginx-loadtest-ayna.test.cjs` (ayna + kayıt),
  `nginx-loadtest-k6.test.cjs` (k6 mantığı, aynadaki yuk_k6.js), genel playbook bekçileri.

## Kanarya (ilk gerçek koşudan önce, bir kez)

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
