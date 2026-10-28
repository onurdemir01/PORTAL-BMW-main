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
- **serbest**: IP hiçbir nginx sunucusuna ait değil (LB VIP'i, yönetilmeyen sunucu). Hedefe **bağlanılmaz** (SSH
  yok, kaydedici yok, nginx logu yok); yalnız istemci ölçümü yapılır ve yük makinesindeki izin dosyası
  (`/etc/portal_yuktesti/serbest_aglar`) IP'yi kapsamalıdır.

Sonuç dosyaları GBLABT02 üzerinden `/sw`'ye yazılır; Portal oradan okur, analiz eder ve kendi DB'sine yazar.

Kaynak: el kiti `f5_rehber/har_yuk_testi` (kos.sh, yuk_k6.js, cpu_kaydedici.sh). Kit betikleri kopyalanmış, yalnız
aşağıda ("Betikler") sayılan Portal farkları eklenmiştir. wrk betikleri (`wrk_kos.sh`, `yuk_wrk.lua`), `on_kontrol.sh`
ve `durdur.sh` Portal'a özgüdür. Portal tarafı sözleşmesi: Portal `docs/NGINX-YUK-TESTI.md` ve uygulama sözleşmesi.

## Dosyalar

| Dosya | İş |
|---|---|
| `nginx_loadtest.yml` | Tek playbook, üç kip (`yuk_islem`: `on_kontrol`, `kosu`, `durdur`), iki hedef türü, iki motor. Sekiz play (aşağıda). |
| `files/on_kontrol.sh` | Yük üretmeyen ön kontrol. `hedef` kipi hedefte (IP yerel mi, `nginx -T`'de server_name, nginx master sayısı, `/web_log` doluluğu ve okunabilirliği, log biçimi, statik sıkıştırma direktifi); `yollar` kipi yük makinesinde (senaryodaki her tekil yola TEK HTTP/1.1 isteği). |
| `files/kos.sh` | Kit kopyası: bir ADIM'ın (hız × tekrar) k6 koşularını sırayla çalıştırır (motor `k6`). |
| `files/yuk_k6.js` | Kit kopyası: açık döngü (constant-arrival-rate) k6 betiği, istek başına TEK GET. |
| `files/wrk_kos.sh` | Portal'a özgü: bir ADIM'ın (bağlantı × tekrar) wrk koşularını sırayla çalıştırır (motor `wrk`); dış sözleşmesi (çıkış kodları, `DUR:`/`HATA:` satırları, sonuç dosyaları, `kos.pid`) kos.sh ile aynı. |
| `files/yuk_wrk.lua` | Portal'a özgü wrk betiği: ağırlıklı yol seçimi, bağlantı başına bekleme ile ortalama hız tavanı, ilk 429 / 5xx'te iş parçacığını durdurma, tam sayılı özet dosyası. |
| `files/cpu_kaydedici.sh` | Kit kopyası: hedefte saniyede bir worker CPU örneği + yalnız test UA'lı log satırları (yalnız sunucu hedefte). |
| `files/durdur.sh` | Bir koşunun bir sunucuda kalan süreçlerini (pid dosyaları, k6, wrk, kit ve Portal betikleri) TERM, 10 sn sonra KILL. |

AWX zip'ine yeni iki dosya da girmelidir: `yt_betik_adlari` her kipte yedi betiğin hepsini denetler; biri eksikse k6
koşuları da "betiklerden biri yok" ile düşer.

Portal'daki birebir aynası: `server/ansible/bmw_portal/nginx_loadtest/**` (iki kopya **bayt bayt
aynı**; Portal testi `nginx-loadtest-ayna.test.cjs` sabit sha256 listesiyle ve
`NGINX_LOADTEST_ANSIBLE_DEPO` verilirse bu depoyla karşılaştırır).

## Akış

Play sırası (strateji **linear**; `strategy: free`, `poll: 0`/`async_status` YOK; yeni play yok):

1. **localhost — girdi kapısı** (`block`/`rescue`): üç `assert` (1. her kip: işlem, koşu kimliği, hedef türü, hedef
   ve yük makinesi; 2. on_kontrol/kosu: parametreler, motor, sınırlar, bütçe; 3. on_kontrol/kosu: iş geçerlilik süresi
   `yuk_son_epoch`); senaryo base64'ten çözülür, **her satırı** yeniden denetlenir, sha256 karşılaştırılır;
   betiklerin kaynak sha1'leri alınır; yük makinesi `yuk_makine` grubuna `add_host` ile eklenir; hedef `yuk_hedef`
   grubuna **yalnız sunucu hedefte** eklenir (AWX `limit` KULLANILMAZ). Reddedilirse hiçbir hosta bağlanılmaz.
2. **yuk_hedef** (become www; serbestte host yok, play "no hosts matched" ile atlanır): `on_kontrol` →
   `on_kontrol.sh hedef`; `kosu` → koşu dizini, `cpu_kaydedici.sh` + `on_kontrol.sh` kopyası (kapı), önce **koşu
   kapısı**: `on_kontrol.sh hedef` yeniden koşar (yük üretmez) ve `ip_yerel` `1` değilse kaydedici ve yük BAŞLAMAZ
   (`hedef <H>: kosu kapisi: ...`; Portal dışı başlatma, paylaşılan VIP'in ön kontrolden sonra başka hosta geçmesi);
   sonra kaydedici **ayrık** başlatılır (`setsid nohup timeout -k 300 <bütçe+120> env SURE=<bütçe+60> ... & echo $! >
   kaydedici.pid`), `wait_for` ile `YUKU SIMDI BASLATIN` ya da başlatıcının/kaydedicinin KENDİ hata satırı beklenir
   (en çok bosta+90 sn; desen "Tuzaklar"da).
3. **yuk_makine** (become www):
   - Hazırlık (`on_kontrol`; `kosu`ta serbest hedefte her zaman, sunucu hedefte yalnız kaydedici hazırsa): koşu
     dizini, betik kopyası (motora göre `kos.sh` + `yuk_k6.js` ya da `wrk_kos.sh` + `yuk_wrk.lua`; ön kontrolde
     `on_kontrol.sh`), senaryo kopyası (kapı).
   - Serbest hedefte **izin dosyası**: `/etc/portal_yuktesti/serbest_aglar` (yol playbook'ta LİTERAL; extra_vars ile
     yönlendirilemez) okunur ve hedef IP'yi kapsayan girdi aranır (biçim ve ret nedenleri "Serbest izin dosyası"nda).
     Blok `fail` etmez: ret, yollar ve koşu görevlerinin `when`'iyle uygulanır ve neden set_stats'a gider.
   - `on_kontrol` → seçili motorun ikilisi (k6: var mı/`version`/sha256; wrk: var mı/`-v` sürüm satırı/sha256) +
     `on_kontrol.sh yollar`. Bu istekler sunucu hedefte YALNIZ hedefte ölçülen `ip_yerel` `1` iken, serbest hedefte
     YALNIZ izin dosyası IP'yi kapsarken gider; aksi halde hiç istek gönderilmez ve yük makinesi sonucu `FAIL`
     (`hedef IP hedefte yerel degil ya da olculemedi; istek gonderilmedi` ya da `serbest izin listesi: <neden>;
     istek gonderilmedi`).
   - `kosu` → TEK async görev: `timeout -k 30 <bütçe> env -u LIMIT_MUAF ... bash kos.sh|wrk_kos.sh R<id> <K|B>`
     (`async: bütçe+300`, `poll: 15`); iki betiğe de aynı ortam gider (`HIZLAR`, `BAGLANTILAR`, `IS_PARCACIGI`,
     `TAVAN_RPS`, `MAXVU`, `K6`, `WRK` ...); her betik kendine ait olmayanları yok sayar.
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
   (metnin geri kalanı bu not sığsın diye tam ölçüyle kısaltılır; toplam en çok 300 karakter).
8. **localhost — sonuç**: `set_stats nginx_loadtest_result` **her yolda** (girdi reddi, erişilemeyen
   host, betik hatası, derleme hatası dahil; derleme düşerse `rescue` en küçük FAIL sonucunu yazar),
   ardından `durum` OK değilse job düşürülür (`DUR` dahil; Portal'ın okuyuşu aşağıda). Serbestte hedefin
   hostvars'ına HİÇ erişilmez (her erişim `sunucu` dalında ya da kısa devreyle korunur).

Her uzak play ve GBLABT02'ye delegate eden /sw play'i `ignore_unreachable: true` ve
`block`/`rescue` taşır: bir host (ya da GBLABT02) düşse de sonraki play'ler (durdurma, temizlik,
sonuç) koşar. Play 2 ve Play 3'ün ilk görevi (`getent`, become'suz) register edilir; host ssh ile
erişilemezse hemen ardındaki `is unreachable` fail'i rescue'ya `erisilemedi (ssh): <ssh iletisi>` verir
ve Play 8 `hedef <H>: erisilemedi (ssh): ...` / `yuk makinesi <Y>: erisilemedi (ssh): ...` yazar
("Tuzaklar"). localhost play'leri hiç extra_var gelmese de koşar (AWX'ten elle başlatma, Variables
prompt kapalı): üç ad (işlem, hedef türü, motor) localhost play'lerinde her yerde `| default(...)` ile geçer;
girdi kapısı reddeder, Play 6 atlanır, Play 8 `girdi reddedildi` sonucunu yayınlar. Uzak play'lerde hedef türü ve
motor yalnız `on_kontrol`/`kosu` dallarında ve işlem karşılaştırmasıyla kısa devre korunarak geçer: eski Portal'ın
hedef türü ve motor göndermeyen durdurması uzak play'lerde hiçbir ifadeyi patlatmaz.

## Portal ↔ AWX sözleşmesi

Katalog anahtarı `nginx_loadtest_run` (kategori `nginx`, env `NGINX_LOADTEST_RUN_TEMPLATE_ID`),
Portal `BEKLENEN_PLAYBOOK.nginx_loadtest_run = 'nginx_loadtest.yml'`. **`limit` her zaman boş**;
`LIMIT_MUAF` ve vekil sunucu değişkenleri hiç gönderilmez. Değerler string beklenir (Portal sayı
da gönderebilir; playbook `| string` ile denetler). Portal HER ZAMAN 30 değişkenin hepsini gönderir; motora ait
olmayan adım değişkenleri boş metindir (`''`).

| Değişken | Tip | Zorunlu | Kural |
|---|---|---|---|
| `yuk_islem` | string | her kip | `on_kontrol` \| `kosu` \| `durdur` |
| `yuk_run_id` | string | her kip | `^[0-9]{1,10}$` (Portal koşu id'si; ADIM `R<id>`, koşu dizini `~www/.portal_yuktesti/<id>`) |
| `yuk_hedef_turu` | string | on_kontrol, kosu (durdurda yoksa `sunucu`) | `sunucu` \| `serbest` |
| `yuk_hedef_host` | string | her kip | sunucu: `^[A-Z0-9][A-Z0-9-]{1,30}$`, ad kuralına göre DEV/TEST/QA (`GBNG[WX][A][DTQ]...`), EDU istisnası (GBNGXT51) değil; serbest: `''` (dolu ise red) |
| `yuk_yuk_host` | string | her kip | aynı ad kuralı; hedeften FARKLI |
| `yuk_motor` | string | on_kontrol, kosu | `k6` \| `wrk` |
| `yuk_hedef_ip` | string | on_kontrol, kosu | IPv4; 0/127/169.254/224+ değil; sunucuda hedefte yerel olduğu ön kontrolde ve koşu başında ölçülür |
| `yuk_host_basligi` | string | on_kontrol, kosu | RFC1123 küçük harf, port/joker yok, ≤ 253 (yalnız biçim; hedefin server_name listesinde olması ŞART değil) |
| `yuk_sni` | string | on_kontrol, kosu | `0` (Host başlığı, URL IP) \| `1` (URL host + `--resolve`/k6 `hosts`); motor wrk ise yalnız `0` |
| `yuk_senaryo_tur` | string | on_kontrol, kosu | `K` \| `B` |
| `yuk_senaryo_b64` | string | on_kontrol, kosu | TSV'nin base64'ü; çözülmüş ≤ 200 KB, 1..400 veri satırı + isteğe bağlı tek `#` başlık |
| `yuk_senaryo_sha256` | string | on_kontrol, kosu | çözülmüş baytların sha256'sı (64 hex) |
| `yuk_hizlar` | string | on_kontrol, kosu | k6: `^[0-9]{1,3}( [0-9]{1,3}){0,4}$`, her biri 1..450 (serbest 1..200); wrk: `''` |
| `yuk_maxvu` | string | on_kontrol, kosu | k6: 10..199 (`limit_conn` 200/IP; serbest 10..50); wrk: `''` |
| `yuk_baglantilar` | string | on_kontrol, kosu | wrk: hızlarla aynı biçim, her biri 1..199 (serbest 1..50), tam sayı olarak tekil; k6: `''` |
| `yuk_is_parcacigi` | string | on_kontrol, kosu | wrk: 1..16, en küçük bağlantı sayısından büyük değil ve her bağlantı sayısını tam böler; k6: `''` |
| `yuk_tavan_rps` | string | on_kontrol, kosu | wrk: 1..450 (serbest 1..200); Portal hesaplar (sunucu: hedefin ölçülmüş limit_req tavanı, en çok 450; serbest: 200), kullanıcı girmez; k6: `''` |
| `yuk_son_epoch` | string | on_kontrol, kosu | `^[0-9]{10}$`; şimdi ≤ değer ≤ şimdi + 1800 (AWX EE saati; Portal şimdi + 900 gönderir); durdurda denetlenmez |
| `yuk_tekrar` | string | on_kontrol, kosu | 1..3 |
| `yuk_kip` | string | on_kontrol, kosu | `yeni` (her istek yeni bağlantı) \| `ka` (keep-alive) |
| `yuk_ae` | string | on_kontrol, kosu | `br` \| `gzip` \| `identity` |
| `yuk_isinma_sn` | string | on_kontrol, kosu | 5..60 |
| `yuk_sure_sn` | string | on_kontrol, kosu | 30..300 |
| `yuk_bosluk_sn` | string | on_kontrol, kosu | 0..120 |
| `yuk_bosta_bas_sn` | string | on_kontrol, kosu | 30..120 (kaydedicinin yük öncesi boşta örneği; serbestte kaydedici yok, yalnız bütçeye girer) |
| `yuk_butce_sn` | string | on_kontrol, kosu | ≤ 2700 ve ≥ `bosta + adım_sayısı × tekrar × (isinma + sure + bosluk) + 120` (adım sayısı: k6'da hız, wrk'de bağlantı sayısı) |
| `yuk_k6_yolu` | string | on_kontrol, kosu | `^/[A-Za-z0-9._/-]{1,200}$`, `..` yok, iki motorda da (varsayılan Portal'da `/home/www/bin/k6`) |
| `yuk_wrk_yolu` | string | on_kontrol, kosu | `yuk_k6_yolu` ile aynı kural, iki motorda da (Portal `NGINX_LOADTEST_WRK`, varsayılan `/home/www/bin/wrk`) |
| `yuk_ua_onek` | string | on_kontrol, kosu | `^[a-z][a-z0-9-]{2,30}$` (Portal: `portal-yuktesti`) |
| `yuk_cikti_kok` | string | on_kontrol, kosu | `^/sw/BMW_PORTAL(_DEV)?/...`, `..` yok (Portal: `NGINX_LOADTEST_DIR`, varsayılan `/sw/BMW_PORTAL/nginx_loadtest`) |

`durdur` kipinde yalnız ilk assert (işlem, koşu kimliği, hedef türü, hedef, yük makinesi) denetlenir; diğerleri gelse
de kullanılmaz. **Durdur kipinde `yuk_hedef_turu` yoksa `sunucu` sayılır**: eski Portal'ın 4 ya da 23 değişkenli
durdurması yeni playbook'la çalışır. on_kontrol/kosu'da `yuk_hedef_turu` ve `yuk_motor` ZORUNLUDUR (eski Portal'ın
on_kontrol/kosu isteği reddedilir; zararsız). Teslim sırası: önce Portal, sonra bu deponun zip'i.

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
{ surum: 2, run_id, islem, hedef_turu: 'sunucu'|'serbest'|null, motor: 'k6'|'wrk'|null,
  durum: 'OK'|'FAIL'|'DUR', hata: <≤300 karakter|null>,
  on_kontrol: { ip_yerel (bool|null), server_name_var (bool|null), master_sayisi (int|null), web_log_df (int|null),
                log_dizini_okunur (bool|null), log_format_ua (bool|null), statik_direktif (bool|null),
                ip_yuk_makinesinde (bool|null), serbest_ag (str|null),
                k6_var (bool|null), k6_surum (str|null), k6_sha256 (str|null),
                wrk_var (bool|null), wrk_calisiyor (bool|null), wrk_surum (str|null), wrk_sha256 (str|null),
                yollar_toplam, yollar_200, ilk_hatalar: [{yol, status}] (≤20),
                sikistirma: {statik, dinamik, sikistirmasiz} } | null,
  kosu: { kos_rc (int|null), kaydedici_rc (int|null), bas_epoch, bit_epoch,
          istemci_ozet: [istemci_<TUR>.json içerikleri], dosyalar: [{ad, bayt}], sw_dizin (str|null) } | null,
  durdur: { durdurulan: ["<HOST> <ad> pid <pid> <TERM|KILL|KALDI>"] } | null }
```

- `hedef_turu` / `motor`: geçerli girdinin yankısı (geçersiz ya da yoksa, ör. girdi reddi ya da eski Portal'ın
  durdurması, `null`). Portal yankıyı yalnız metinse koşu satırıyla karşılaştırır.
- Hedef alanları (`ip_yerel` ... `statik_direktif`) sunucuda bugünkü anlamda (ölçülmediyse bool alanlar `false`),
  serbestte yedisi `null`. `ip_yuk_makinesinde`: `on_kontrol.sh yollar`'ın ölçümü (iki türde; ölçülmediyse `null`).
  `serbest_ag`: yük makinesi izin dosyasında hedef IP'yi kapsayan girdi (yalnız serbest; aksi `null`).
- `k6_*` yalnız motor k6'da, `wrk_*` yalnız motor wrk'te dolu; diğerleri `null`. `wrk_calisiyor` true ama
  `wrk_var` false: ikili çalışıyor, ama sürüm satırı okunamadı ya da 4 altında (`make VER=4.2.0`'sız derleme).
- `durum`:
  - `on_kontrol`: `OK` yalnız ölçülen taraflarda **engel** yoksa. Engeller (Portal koşuyu başlatmaz): sunucu
    hedefte hedefin sonucu OK değil, hedef IP hedefte yerel değil (ya da ölçülemedi: o zaman yük makinesinden HİÇ
    istek gitmez ve yük makinesi tarafı da `FAIL`), `/web_log` okunamıyor; iki türde yük makinesi sonucu OK değil
    (serbestte izin dosyası reddi dahil), seçili motorun ikilisi yok/çalışmıyor (wrk'de iki ayrı metin: "wrk yok ya
    da calistirilamiyor" / "wrk calisiyor ama surumu okunamadi ya da 4 altinda ... make VER=4.2.0 ile derleyin"),
    hiç yol denenmedi, hedef IP yük makinesinde yerel (istek gönderilmez). **server_name `nginx -T`'de yok engel
    DEĞİLDİR**: `server_name_var` aynen yayınlanır, Portal onay isteyen bir uyarı gösterir (joker / regex ad olabilir).
    Uyarılar `durum`'u bozmaz: `yollar_200 < yollar_toplam`, `sikistirma.statik > 0`, `web_log_df ≥ 65` ya da
    `null`, `log_format_ua false`. `master_sayisi` ölçülemediyse `null` (0 değil: 0 bir ölçümdür, hidepid ya da
    nginx yok); Portal ölçülmüş ≠ 1'i engel (kaydedici koşuda zaten `HATA` ile durur), `null`'u uyarı sayar.
  - `kosu`: `OK` = `kos_rc 0` + (sunucuda `kaydedici_rc 0` ve hedef toplandı) + yük makinesi toplandı + /sw kopyası
    tamam; `DUR` = koşu betiği bir adımda durdu (`kos_rc` 4: kos.sh'de 429/HTTP2/k6 hatası/boş özet, wrk_kos.sh'de
    429/5xx/soket/hata oranı/sayaç tutarsızlığı/wrk hatası/boş özet, ikisinde de TERM; 130: boşlukta kesildi) ve o
    ana kadarki veri /sw'de (sunucuda ayrıca `kaydedici_rc 0`; serbestte kaydedici yok); diğer her şey `FAIL`.
    Serbest koşuda izin dosyası reddi: `yuk makinesi <Y>: serbest izin listesi: <neden>; yuk gonderilmedi`.
  - `durdur`: `OK` = yük makinesinde ve (sunucuda) hedefte `durdur.sh` "kalan süreç yok" dedi; aksi `FAIL` (job düşer).
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
hostlar `T` kilidiyle korunmaz (Portal VIP havuzunu bilmez; asıl koruma izin listesi ve G kilidi).

- Bağlı iş `successful` biterse kilit hemen bırakılır. `durdur` kipindeki iş ancak ölçülen sunucular
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
  (wrk'nin ara dosyaları `wrk_ara/` sonuç dizininin DIŞINDA kalır, toplanmaz, Play 7 siler)
- hedeften (yalnız sunucu): `sunucu_R<id>_<host>.csv`, `log_R<id>_<host>.tsv.gz`, `diger_R<id>_<host>.tsv`,
  `bilgi_R<id>_<host>.txt`, `konf_R<id>_<host>.txt`, `NOT.txt`
- `SHA256SUMS` (`sha256sum -c` biçimi; kontrol düğümündeki kopyalardan)

Kök: PROD `/sw/BMW_PORTAL/nginx_loadtest`, DEV `/sw/BMW_PORTAL_DEV/nginx_loadtest` (Portal
`docs/DEV-PROD.md` ile aynı ayrım). /sw koşu dizinlerinin saklama süresi bu playbook'ta yoktur.

## Betikler (kitten farklar ve Portal'a özgü betikler)

- `yuk_k6.js`: User-Agent öneki `UA_ONEK` (varsayılan `portal-yuktesti`, `^[a-z][a-z0-9-]{2,30}$`);
  `HOST_BASLIGI` zorunlu (GLOMO varsayılanı kaldırıldı, yoksa init'te hata). Eşikler, iptal mantığı,
  setup ön kontrolü ve çıktılar kitle aynı.
- `kos.sh`: `UA_ONEK` k6'ya geçer; `HOST_BASLIGI` varsayılansız; `LIMIT_MUAF` YASAK (verilirse hata,
  k6'ya hep `0`); kendi pid'i `$SONUC/../kos.pid`; INT/TERM trap'i çalışan k6'yı (ve boşluk
  beklemesini) TERM ile sonlandırır — k6 ve `sleep` arka planda + `wait` ile koşar, trap ertelenmez;
  TERM'de adım `hatali_` önekiyle saklanır, `DUR: ... durduruldu (TERM ...)`, çıkış 4. wrk değişkenlerini yok sayar.
- `cpu_kaydedici.sh`: iki awk eşleşmesinde (`user-agent=<UA>/<ADIM>_` ve tırnaklı `"<UA>/<ADIM>_`)
  önek `UA_ONEK` (regex metakarakteri olamaz: aynı desen denetlenir) ve kaydın ADIM'i (`R<id>`, awk'a
  `-v ADIM`): test satırı YALNIZ bu koşunun TUR'larıdır; başka ADIM'ın satırı (ör. iptal edilmiş eski
  bir koşudan yetim kalmış k6, `R90` gibi önek çakışması dahil) `diger` trafiktir. Çıktılar kitle aynı.
- `on_kontrol.sh`: Portal'a özgü (dosya başında ayrıntı); hedefte koşu kapısı için de koşar.
- `durdur.sh`: Portal'a özgü. Adaylar: koşu dizinindeki `*.pid`'ler, `k6 run` (`[k]6`), wrk (`$2` adı `[w]rk...`
  VE komut satırında ` -s <kosu_dizini>/yuk_wrk.lua`; wrk_kos.sh wrk'yi bu argüman sırasıyla çağırır) ve
  `bash <kosu_dizini>/kos.sh|wrk_kos.sh|cpu_kaydedici.sh|on_kontrol.sh`. Başka koşunun wrk'sine dokunulmaz.
- `wrk_kos.sh` (motor wrk): dış sözleşme kos.sh ile aynı; kullanım `wrk_kos.sh <ADIM> <K|B> [--kuru]`, çıkış 0 /
  2 (girdi ya da ön koşul, yük YOK) / 4 (DUR) / 130. Sıra: girdi denetimi (`BAGLANTILAR` ≤ 199 tekil en çok 5,
  `IS_PARCACIGI` 1..16 en küçük bağlantıdan büyük değil ve her bağlantıyı böler, `TAVAN_RPS` zorunlu 1..450, `SNI`
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

Şema yuk_k6.js ile AYNI (30 kolon, JSON anahtar sırası `ozet_hesapla` ile aynı). I = ısınma özeti, O = ölçüm özeti
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

Biçim: CSV = başlık + TEK veri satırı; sayı `int(v*1000+0.5)/1000` (yuk_k6.js `hucre`), null boş. JSON 2 boşluk
girintili, sayı yuvarlanmamış, null `null`; NaN/sonsuz asla. İkisi de `.tmp` + `mv` (`LC_ALL=C`).

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
| Execute / Admin rolü | **yalnız Portal servis hesabı**: extra_vars her değişkenden önce gelir (bkz. "Güvenlik"); şablonu AWX'te başlatabilen biri playbook kapılarını da ezebilir |
| Concurrent jobs (allow_simultaneous) | **AÇIK**: `durdur` kipi aynı şablonla, koşan `kosu` işi hâlâ canlıyken (AWX iptali 403 dönebilir) başlayabilmeli; kapalıysa durdurma işi koşunun bitmesini bekler. Eşzamanlı koşuları Portal kilitleri (hedef, yük makinesi, global) engeller |
| Timeout | **3600 sn**. Sınırlı beklemeler: koşu kapısı ≤ 130 + kaydedici hazırlığı ≤ 210 + koşu ≤ 2745 (bütçe ≤ 2700 + `-k 30` + poll 15) + kaydedici durdurma ≤ 290 + durdur.sh ≤ 100 = ≤ 3475 sn, üstüne toplama/kopya/temizlik görevleri: **en kötü durum ~3600 sn, sınırda**. Bu yalnız bu beklemelerin HEPSİ aynı koşuda tavana vurursa olur; o zaman AWX işi 3600. sn'de keser: set_stats yayınlanmaz (Portal FAILED + AWX açıklaması gösterir), Play 7 temizliği koşmaz, uzak süreçler kendi `timeout`'larıyla biter. Normal koşuda bütçeye ek süre birkaç dakikadır. Portal kilit TTL'si 75 dk bundan uzun |
| Forks | varsayılan (en çok iki uzak host) |
| Uzun iş otomatik iptali | listeye EKLENMEZ: AWX iptali uzak async koşuyu durdurmaz; Portal "Durdur" bu playbook'u `durdur` kipiyle koşturur |

Portal tarafı: `NGINX_LOADTEST_RUN_TEMPLATE_ID`, `NGINX_LOADTEST_AWX_SERVER_ID`,
`NGINX_LOADTEST_DIR`, `NGINX_LOADTEST_K6`, `NGINX_LOADTEST_WRK` (wrk ikilisi, varsayılan `/home/www/bin/wrk`),
`NGINX_LOADTEST_YUK_HOSTLARI` (izinli yük makineleri), `NGINX_LOADTEST_SERBEST_AGLAR` (serbest hedef izin listesi:
virgüllü `a.b.c.d/n`, en küçük /24 ya da tek IP; boşsa serbest KAPALI), `NGINX_LOADTEST_SERBEST_YASAK` (isteğe bağlı
yasak ağlar, iki türde izin listesinden önce; tek geçersiz girdi tüm yük testini kapatır). Portal listeleri
playbook'a GÖNDERİLMEZ (extra_var olarak ezilebilirdi); playbook'un kendi listesi yük makinesindeki izin dosyasıdır.

## k6 kurulumu (yük makinesi, bir kez, elle)

Bu playbook k6 KURMAZ; yalnız varlığını, sürümünü ve sha256'sını ölçer (`on_kontrol`, motor k6).

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

## wrk kurulumu (yük makinesi, bir kez, elle)

Bu playbook wrk KURMAZ ve derlemez; yalnız varlığını, `-v` sürüm satırını ve sha256'sını ölçer (`on_kontrol`, motor
wrk). Resmî ikili yok: operatör kurumun onaylı kaynağından (iç ayna ya da onaylı arşiv) derler. Asgari 4.0
(`delay()`, `wrk.thread:stop()`), önerilen **4.2.0**.

1. Bağımlılıklar (derleme makinesinde): `gcc`, `make`, `tar`/`unzip`, klon ise `git`, paketli OpenSSL'i derlemek için
   `perl`. Tercihen dağıtımın bakımlı OpenSSL'i: `openssl-devel` (paketli 1.1.1'in desteği bitti).
2. Kaynağı açıp derleyin: `make VER=4.2.0 WITH_OPENSSL=/usr` (dağıtım OpenSSL'i) ya da `make VER=4.2.0` (paketli).
   `VER` ZORUNLU: wrk sürüm satırını `git describe`'dan alır; .git'siz arşivden `VER`'siz derleme `wrk  [epoll] ...`,
   etiketsiz klon kısa hash basar ve ön kontrol "wrk calisiyor ama surumu okunamadi" der.
3. Yalnız ikiliyi www'nin dizinine koyun: `install -m 0755 wrk /home/www/bin/wrk` (sahibi www; grup/diğer YAZAMAZ).
   Başka yol kullanılırsa Portal'da `NGINX_LOADTEST_WRK`.
4. `/home/www/bin/wrk -v | head -1` çıktısının `wrk 4.` ile başladığını doğrulayın (`wrk -v` kullanım metniyle
   birlikte 1 ile çıkar; normaldir) ve `sha256sum /home/www/bin/wrk` çıktısını kayda geçirin. Her wrk ön kontrolü
   `wrk_surum` ve `wrk_sha256`'yı gösterir; kayıttakiyle aynı olmalı.

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
| `yuk_butce_sn` (Portal hesaplar) | `bosta + adım_sayısı × tekrar × (isinma + sure + bosluk) + 120`, ≤ 2700 (Portal adım başına 20 sn pay ekler) |
| koşu betiği dış sınırı | `timeout -k 30 <bütçe>` (async `bütçe + 300`, poll 15) |
| kaydedici (sunucu) | `SURE=<bütçe+60>` (kendi biter) ve `timeout -k 300 <bütçe+120>` |
| kaydedici hazır bekleme | `bosta + 90` sn |
| kaydedici TERM sonrası bekleme | 290 sn (`bitir`: `LOG_BEKLE` 6 sn + tüm log büyümesinin awk ayrıştırması; gawk 5.1 ölçümü ~400k test satırı ~25 sn, 800k test + 200k diğer ~48 sn); sarmalayıcının KILL'i 300 sn'de, beklemeden sonra |
| on_kontrol.sh hedef / yollar | `timeout -k 10 120` / `timeout -k 10 600` (≤400 yol × 5 sn / 4 paralel); koşu kapısı `timeout -k 10 120` |
| wrk_kos.sh | yükleme sınaması `timeout -k 5 30`; TUR başına 200 kapısı ≤ 180 sn (bütçe formülünde yok, Portal'ın adım payına girer) |
| durdur.sh | TERM → 10 sn → KILL; dış `timeout -k 10 90` |

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
- Tavanlar: k6 hız ≤ 450 (IP başına `limit_req` 500 r/s), VU ≤ 199 (`limit_conn` 200); wrk bağlantı ≤ 199, toplam hız
  ORTALAMADA ≤ `yuk_tavan_rps` ≤ 450; serbest hedefte iki motorda ≤ 200 istek/sn (wrk'de ortalamada) ve ≤ 50
  bağlantı/VU (hedefte limit_req olmayabilir: yükün tek freni Portal tavanıdır). Yük bir LB üzerinden gidiyorsa
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
- **`yeni` kipinde geçici port tükenmesi**: her istek yeni TCP bağlantısıdır; yüksek bağlantı / kısa gecikmede yük
  makinesinde TIME_WAIT birikir (`e_connect` artar, soket DUR'u).
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

## Bekçiler

- Ansible deposu: `python -B bmw_nginx/tests/check_nginx_loadtest_job.py` (Git Bash ya da Linux, PyYAML, jinja2, node).
  L1 metin (CRLF, `#`, SEKME, ters eğik çizgi, yasak modüller; koşul metninde derinlik 0'da ` if ` yok), L2 yapı
  (play sırası, rescue, delegate/unreachable, Play 2 / 3'te getent register + hemen ardından `is unreachable` fail'i,
  localhost play'lerinde korumasız işlem / hedef türü / motor adı yok, kaydedici süreleri ve hazır deseni, set_stats),
  L3 girdi sözleşmesi (30 değişken = README tablosu; tek async görev iki betiğin ortamını taşır), L4 betik
  başvuruları, L5 girdi kapısı (dört kip × motor birleşimi, eski Portal'ın durdurmaları, §4'ün ihlal durumlarının
  hepsi), L6 sonuç derlemesi ve play'ler (serbest/wrk dalları, patlayan hedef hostvars'ı ile serbest, D7, Play 2 koşu
  kapısı ve reddinden sonraki Play 3-8 zinciri, erişilemeyen hedef / yük makinesi (Play 2-8: yalnız getent,
  `erisilemedi (ssh): ...`), Play 3 izin dosyası (ret nedeni en çok 40 karakter; set_fact sonuçlarında vekil yok,
  davranış aynı), wrk `-v` sürüm satırı, değişkensiz durdur), L7 betik davranışı (sahte k6/wrk/curl/ps/ip/proc ile;
  wrk_kos.sh sırası, DUR koşulları, istemci dosyası şeması, wrk ortamında `IS_PARCACIGI`; durdur.sh wrk kuralı; gerçek
  procps ile `[k]6`/`[w]rk`), L8 k6 mantığı, L9 README, L10 Portal aynası, L11 yuk_wrk.lua (metin, her zaman:
  `delay()`'in her dönüşü ≥ D ve ilk `N / T` çağrıda `[D, 2D)`, init `IS_PARCACIGI`, wrk_kos.sh wrk ortamı, iş
  parçacığına özgü tohum: init'te `math.randomseed(os.time() + (tonumber(id) or 0) * 7919)`, setup'ta
  `thread:set('id', #threads)`, başka randomseed yok; isteğe bağlı Lua yorumlayıcısıyla mantık, iki iş parçacığının
  ilk `N / T` jitter dizisi farklı), L12 (isteğe bağlı) Portal `dogrula.cjs`'nin ürettiği extra_vars'ın girdi
  kapısından geçmesi. `kosul()` Ansible'ın iki koşul yolunu da sınar (derleme + bool sonuç). Mutasyon kopyaları:
  `NGINX_LOADTEST_YML`, `NGINX_LOADTEST_FILES`, `NGINX_LOADTEST_README`; yalnız bazı bölümler:
  `NGINX_LOADTEST_ONLY='L[1-79]'`; kabuk testinden yalnız biri: `NGINX_LOADTEST_KABUK=wrk|durdur|...`; Portal
  deposu: `NGINX_LOADTEST_PORTAL_DEPO` (L10, L12); Lua: `NGINX_LOADTEST_LUA` (yorumlayıcı ya da sarmalayıcı;
  kurulumsuz yol: bir LuaJIT `lua51.dll`'ini ctypes ile yükleyen `.cmd`) ya da PATH'te `luajit`/`lua5.1`/`lua`.
  Gerçek procps `ps` için WSL/Linux:
  `NGINX_LOADTEST_ONLY='L[1-79]' python3 -B ...` (node yoksa L8 hariç). KÖR alanlar: gerçek Ansible, gerçek wrk / Lua
  / k6 / nginx koşmaz (sahteleri sözleşmeyi taklit eder; kanarya).
- Gerçek Ansible ile (isteğe bağlı, WSL'de ansible-core 2.16): `ansible-playbook --syntax-check`, hiç extra_var olmadan
  koşu (localhost; diğer hostlar ulaşılamaz adrese eşlenmiş): girdi reddi, Play 6 atlanır, Play 8 `set_stats`
  yayınlar ve job `girdi reddedildi` ile düşer; serbest durdur ve serbest ön kontrol (yük makinesi erişilemez) Play 8'e
  ulaşır ve `yuk makinesi <Y>: erisilemedi (ssh): ...` der (sunucu ön kontrol / koşu, iki host erişilemezken:
  `hedef <H>: erisilemedi (ssh): ...; yuk makinesi <Y>: ...`). Girdi kapısının maddeleri gerçek `Conditional` ile
  varsayılan ve eski yolda (`_ANSIBLE_DISABLE_BACKPORTED_INSPECTIONS=1`), 2.19 davranışı
  `ANSIBLE_ALLOW_BROKEN_CONDITIONALS=False` ile.
- `bmw_nginx/tests/check_readme_sync.py`: bu README'deki değişken tablosu ve sunucu adları koddan. İlk hücresi ters
  tırnaklı küçük harf tanımlayıcı olan tablo satırı YALNIZ `yuk_*` değişkenleri içindir (özet anahtarları, istemci
  eşlemesi ve set_stats alanları ters tırnaksız tablo ya da kod bloğu).
- Portal: `server/ansible/__tests__/nginx-loadtest-ayna.test.cjs` (ayna + kayıt; NA5 delegate ve Play 2 / 3 getent
  erişilemezlik fail'i; NA7 Portal `EKSTRA_ANAHTARLAR` = bu README'nin değişken tablosu), `nginx-loadtest-wrk.test.cjs`
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

wrk ve serbest hedef:

1. Yük makinesinde `/home/www/bin/wrk -v | head -1` `wrk 4.` ile başlar ve
   `wrk_kos.sh --kuru` planı yazar (`TAVAN_RPS` verilerek).
2. wrk ön kontrolü (TEST hedef): `wrk_var` / `wrk_calisiyor` / sürüm / sha256 kayıttakiyle aynı.
3. 1 adımlık wrk koşusu (N=1, T=1, tekrar 1, süre 40, `ka`) limit_req payı olan TEST hedefte: istemci CSV/JSON'da
   `n_olcum > 0`, p50/p95/p99 dolu, `http2` 0, `n_429` 0, gerçek /sn ≤ tavan, Portal analizi geçerli.
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
