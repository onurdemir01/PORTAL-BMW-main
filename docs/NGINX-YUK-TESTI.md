# Nginx Hub › Yük Testi

Non-prod bir nginx sunucusuna, izinli bir yük makinesinden **k6** ile sabit hızlı (açık döngü)
yük uygular; hedefte aynı anda CPU kaydedici çalışır. Sonuçta her hız kademesi için yanıt süresi,
istek başına CPU (CPU-ms/istek), hata ve kapasite; koşunun **geçerliliği** (nedenleriyle) ve iki
koşunun karşılaştırması (`KALICI` / `NOTR` / `RET` / `GECERSIZ` / `VERI_YOK` / `DOYMA`) çıkar.

Elle koşulan GLOMO kitinin (`kos.sh`, `yuk_k6.js`, `cpu_kaydedici.sh`, `karsilastir.py`) Portal'a
taşınmış hâlidir; ölçüm dosyaları ve hesaplar kitle aynıdır.

---

## 1. Parçalar

| Parça | Yer |
|---|---|
| Ekran | `src/components/nginx_console/YukTestiTab.tsx`, `src/components/nginx_console/yukTesti/` |
| API | `server/nginx-loadtest/index.cjs` → `/api/nginx-loadtest/*` |
| Kapılar (girdi, ortam, sınırlar) | `server/nginx-loadtest/dogrula.cjs` |
| Kilit (`nginx_loadtest_kilitleri`) | `server/nginx-loadtest/kilit.cjs` |
| AWX başlatma | `server/nginx-loadtest/baslat.cjs` |
| Sonuçlandırıcı (sunucu tarafı) | `server/nginx-loadtest/poller.cjs` |
| Sonuç dizini okuma / analiz | `server/nginx-loadtest/sonuc.cjs`, `server/nginx-loadtest/analiz.cjs` |
| Playbook | Ansible deposu `bmw_portal/nginx_loadtest/nginx_loadtest.yml` (+ `files/`, `README.md`); Portal aynası `server/ansible/bmw_portal/nginx_loadtest/` |
| Tablolar | `nginx_loadtest_senaryolar`, `_kosular`, `_adimlar`, `_kilitleri` — bkz. [DATABASE.md](DATABASE.md) |
| Bekçiler | `server/nginx-loadtest/__tests__/` (dogrula, kilit, kapi, poller, sonuc, analiz) |

---

## 2. Devreye alma

### 2.1 AWX job template'i

Tek template, üç kip: playbook `yuk_islem` ile `on_kontrol` (yük yok), `kosu` ve `durdur`
çalışır.

| Ayar | Değer |
|---|---|
| Playbook | `bmw_portal/nginx_loadtest/nginx_loadtest.yml` |
| Playbook Kayıtları anahtarı | `nginx_loadtest_run` (seed ile gelir; kategori `nginx`) |
| Template ID | Admin › Playbook Kayıtları › `nginx_loadtest_run`, ya da `.env` `NGINX_LOADTEST_RUN_TEMPLATE_ID` |
| AWX sunucusu | Kayıttaki sunucu; boşsa `NGINX_LOADTEST_AWX_SERVER_ID`; o da yoksa **#1**. Portal asla `0`'a düşmez. |
| **Prompt on launch → Variables** | **AÇIK** (zorunlu). Kapalıysa AWX gönderilen değişkenleri sessizce yutar. Portal başlatmadan önce bakar (409 `awx_prompt_on_launch_disabled`); AWX yine de yutarsa iş **hemen iptal edilir**. |
| Limit | Kullanılmaz. Portal her zaman boş gönderir; hedef ve yük makinesi playbook içinde `add_host` ile eklenir. |
| Survey | Kullanmayın. Hedef, hız, süre için **varsayılan değer olmamalı**: değişkenler yutulursa playbook girdi kapısında düşmeli, varsayılanla yük üretmemeli. |
| Timeout | **≤ 60 dk (3600 sn)**. Portal bu değeri okuyamaz; kilit süresi (75 dk) bunun üstüne kuruludur. |
| **Enable Concurrent Jobs** | **AÇIK**. "Durdur" koşu sürerken aynı template'le başlar; kapalıysa koşu bitene kadar kuyrukta bekler. |
| Kimlik / kullanıcı | `nginx_console_*` template'leriyle aynı makine kimliği; hedefte ve yük makinesinde `www` olarak çalışır, nginx komutları düz `dzdo <nginx>` ile. |

Ayrıca:

* Ansible deposu AWX'e **zip ile** gider (`tools/ansible-zip.py`): `bmw_portal/nginx_loadtest/`
  altındaki yeni dosyalar zip'e girmeli. Portal aynası ile Ansible deposundaki kopya bayt bayt
  aynı olmalı (bekçi denetler).
* Template'i template-preflight'ın beklediği playbook'a bağlayın: başka bir playbook'u koşturan
  Template ID girilirse iş **başlatılmaz** (409 `awx_template_playbook_mismatch`).
* Uzun iş uyarısı (Teams, 30 dk) gelebilir; bu template'i otomatik iptal izin listesine
  **eklemeyin**. Koşu kendi süre sınırıyla biter; AWX iptali uzaktaki async görevi ve ayrık k6'yı
  durdurmaz — durdurmanın yolu ekrandaki **Durdur**'dur. AWX'ten iptal edilen (ya da `error` ile
  biten) bir koşunun kilitleri bu yüzden **bırakılmaz**, süre sınırına kadar tutulur (§4.1).

### 2.2 Yük makinesinde k6

* Varsayılan yol `/home/www/bin/k6` (`NGINX_LOADTEST_K6`). `www` kullanıcısı çalıştırabilmeli.
* En az **v0.45** (kos.sh denetler, eskiyse koşu başlamaz).
* Kurulum: kurumun onaylı kanalından tek ikili (`k6-vX.Y.Z-linux-amd64.tar.gz`) getirin,
  yayıncının sha256 listesiyle doğrulayın, `install -m 0755 k6 /home/www/bin/k6`. Sunucunun dnf
  aynası geride olabilir; paket yöneticisine güvenmeyin.
* Ön kontrol k6'nın **sürümünü ve sha256'sını** raporlar; koşular arasında değişmemeli.
* Yük makinesinden hedef IP'ye 443 erişimi olmalı; ön kontrol her yola bir istek atarak doğrular.
  Koşu sırasında proxy değişkenleri temizlenir, çerez ve ek başlık gönderilmez, istek HTTP/1.1'dir.
* **GBNGXT34 kendisi bir TEST internet reverse proxy'sidir.** Yük üretirken kendi trafiği
  etkilenebilir; düşük hızla başlayın, sonuçtaki "DOYMA"yı yük makinesinin de doyması olarak okuyun.

### 2.3 Ortam değişkenleri

| Değişken | Varsayılan | Anlam |
|---|---|---|
| `NGINX_LOADTEST_RUN_TEMPLATE_ID` | — | Template ID (Playbook Kayıtları satırında yoksa) |
| `NGINX_LOADTEST_AWX_SERVER_ID` | `1` | AWX sunucusu (kayıtta yoksa) |
| `NGINX_LOADTEST_YUK_HOSTLARI` | `GBNGXT34` | İzinli yük makineleri (virgülle). Listedeki makine de ad kuralına göre DEV/TEST/QA, üretim işaretsiz ve envanterde olmalı; liste kapıyı **gevşetemez**. Geçersiz giriş atılır. |
| `NGINX_LOADTEST_K6` | `/home/www/bin/k6` | Yük makinesinde k6 yolu |
| `NGINX_LOADTEST_DIR` | `/sw/BMW_PORTAL/nginx_loadtest` | Sonuç kökü; koşu dizini `<kök>/<koşu no>/`. Playbook (GBLABT02 üzerinden yazar) ve Portal (okur) **aynı yolu** görmeli. |
| `NGINX_LOADTEST_LOCK_TTL_MIN` | `75` | Kilit süresi, dk (65..720) |
| `NGINX_LOADTEST_POLL_SN` | `30` | Sonuçlandırıcı aralığı, sn (10..600) |
| `NGINX_LOADTEST_RETENTION_DAYS` | `365` | DB saklama, gün (30..3650) |

Sınırlar (hız, süre, bütçe) **kod sabitidir**; DB ya da env ile gevşetilmez.

### 2.4 Erişim

Sekme `tab:nginx:yuktesti` **varsayılan kapalıdır**. Admin › Nginx Hub Erişimi'nden kullanıcıya
ya da AD grubuna açılır. Admin olmayan kullanıcı yalnız **sonuçları okur** (hedefler, senaryolar,
koşular, karşılaştırma). Senaryo yazma/silme, ön kontrol, koşu, durdurma ve canlı iş çıktısı
**yalnız Admin**.

---

## 3. Kullanım

1. **Senaryo** — HAR dosyasından ya da yol listesinden. HAR **tarayıcıda** ayrıştırılır ve
   sunucuya hiç gitmez; yalnız yol satırları (`ağırlık, har, tür, boyut, yol`) gönderilir. Sunucu
   her satırı yeniden denetler: beyaz liste, sorgu (`?`) / parça (`#`) / ters eğik çizgi yok, `//`
   ile başlamaz, `..` parçası yok, kodlanmış nokta / eğik çizgi yok, kişisel veri şüphesi
   (6+ haneli parça, e-posta, 11 haneli numara) yok; en çok 400 satır, 200 KB.
   * **`;` yasak**: yolunda `;` olan satır reddedilir (`yolda ";" parametresi var (ör.
     ;jsessionid) — oturum bilgisi senaryoya giremez`). JBoss/JSF ilk yanıtta oturum kimliğini
     yola yazar (`/a.jsf;jsessionid=...`); HAR ayrıştırıcısı `;` ve sonrasını tekilleştirmeden önce
     atar, sunucu yine de reddeder (eski istemci, elle yapıştırılan liste).
   * Satır sayısı ve toplam bayt sınırı, satırlar tek tek denetlenmeden **önce** uygulanır
     (sınırı aşan gövde hiç taranmaz). E-posta şüphesi doğrusal çalışır (uzun `@`'li yol olay
     döngüsünü kilitlemez); kararı eski düzenli ifadeyle birebir aynıdır.
2. **Yeni koşu** — senaryo, hedef (uygun olmayanlar gerekçesiyle gri), IP (sunucunun türettiği
   aday listesinden), vhost (son nginx taramasındaki `server_name`'ler), yük makinesi,
   parametreler ve etiket (ör. `T0`, `F5 ayarları`).
3. **Ön kontrol** (yük üretmez) — seçilen IP hedefte yerel mi, vhost `nginx -T`'de var mı, tek nginx
   master, `/web_log` doluluğu ve okunabilirliği, etkin `log_format`'ta `user-agent=` var mı, k6 var
   mı (sürüm, sha256), senaryodaki her yol 200 dönüyor mu, sıkıştırma (statik / dinamik / yok).
4. **Başlat** — son **15 dk** içinde **sizin** çalıştırdığınız, tamamlanmış ve OK ön kontrol
   gerekir; parametreler ön kontroldekinin aynısıdır (istemci değiştiremez). Onay penceresinde
   hedef sunucu adını birebir yazın. Uyarı varsa (200 dönmeyen yol, ön-sıkıştırılmış dosya,
   `/web_log` ≥ %65 ya da ölçülemedi, `user-agent=` yok, master sayısı ölçülemedi) kutuyu
   işaretleyin. Ölçülmüş nginx master sayısı 1 değilse ya da `/web_log` okunamıyorsa
   (`log dizini /web_log okunamıyor`) bu bir **engeldir** (CPU kaydedici başlamaz / sunucu tarafı
   ölçüm olmaz), onayla geçilmez; playbook da aynı engelleri sayar.
5. **İzleme** — canlı iş çıktısı (maskeli). Sekme kapansa da sunucudaki sonuçlandırıcı işi bitirir,
   sonucu yazar, kilidi kurala göre bırakır ya da tutar (§4.1).
6. **Sonuç** — geçerlilik `GECERLI` / `KISMI` / `GECERSIZ` / `OKUNAMADI` ve nedenleri; adım tablosu
   (p50/p95/p99, TTFB, hata, 429/5xx, dropped, istemci/sunucu istek hızı, CPU-ms/istek, host CPU,
   kapasite). Erken duran koşu (`DUR`: 429 / HTTP/2 / k6 hatası, tamamlanan adımlar `/sw`'de)
   AWX'te `failed` görünse de **`DONE`** olur ve geçerliliği en iyi `KISMI`'dir (Karşılaştır'da
   seçilebilir).
7. **Karşılaştır** — iki koşu; karar, nedenleri ve hız kademesi tablosu.
8. **Durdur** — AWX işini iptal eder **ve** (koşu için) aynı template'i `durdur` kipinde başlatır
   (koşu dizinindeki pid'leri ve o dizine bağlı k6'yı sonlandırır). Durdurma ortam kapısından
   geçmez. Ayrıntı ve kilitler: §4.1.
   * Koşu henüz başlatılıyorsa (QUEUED, AWX iş numarası yok, 120 sn'den yeni) **409
     `baslatiliyor`**: "Koşu başlatılıyor; birkaç saniye sonra yeniden deneyin."
   * Koşu için durdurma işi **başlatılamazsa** (AWX iptali başarılı olsa da) **424
     `durdur_baslatilamadi`** döner; gövdede `iptal`, `iptalHatasi`, `durdurHatasi`. Uzaktaki k6 /
     kaydedici sürüyor olabilir: Durdur'u yeniden deneyin. Kilitler koşunun süre sınırına kadar
     tutulur.
   * Durdurma işi başlarsa iş numarası koşuya yazılır (`durdurIsi`) ve koşunun kilitleri o işe
     bağlanır; iş başarıyla biterse (iki sunucu da "kalan süreç yok") kilitler hemen bırakılır.
   * Ön kontrolde durdurma işi yoktur; yalnız AWX işi iptal edilir (`durdurIsi: null`).
   * `CANCELED` / `FAILED` koşuya yeniden Durdur serbesttir (kalan süreç temizliği); `DONE` koşu
     409 `kosu_bitti`.

Toplam süre (bütçe) sunucuda hesaplanır ve en çok **2700 sn** olabilir:

```
bütçe = boşta + hız_sayısı × tekrar × (ısınma + süre + boşluk + 20) + 120
```

`20`: adım başına ek pay (k6 açılışı, setup'taki yol yoklaması, `gracefulStop`). Playbook yalnız
ek paysız formülün altına inilmediğini denetler; pay olmadan 15 adımlı bir koşu `kos.sh` zaman
sınırına (rc 124) düşebiliyordu.

Varsayılanlar (`100 250 400` istek/sn, tekrar 2, ısınma 30, süre 120, boşluk 30, boşta 60) ile
1380 sn = 23 dk.

Ölçüm süresi (`süre`) en az **40 sn**'dir: analiz penceresi ilk ölçüm saniyesinden 3 sn sonra
başlar, son ölçüm saniyesinden 2 sn önce biter ve CPU örnekleri 1 sn aralıklıdır; pencere en az
30 sn olmalıdır. 30..36 sn'lik ölçüm her adımı `GECERSIZ` (`pencere_kisa`) yapıyordu.

---

## 4. Korkuluklar (sunucu tarafı)

Ekran aynı kuralları yalnız kolaylık için gösterir; karar sunucudadır, playbook da yeniden assert
eder. İş hataları **409** (kalıcı) ya da **424** (geçici) döner; 5xx yok.

| Kural | Kod |
|---|---|
| Hedef **ad kuralına** göre DEV/TEST/QA olmalı; PROD, EDU, BILINMIYOR reddedilir. `dbo.nginx_inventory.env`, `dbo.Inventory.env` ya da PROD RP listesinden gelen **her** üretim işareti de reddettirir (bu kaynaklar kapıyı gevşetemez). | `hedef_uretim` |
| Hedef `dbo.nginx_inventory`'de olmalı | `hedef_envanterde_yok` |
| Envanter / tarama tablosu boş ya da okunamıyor ("yok" sayılmaz) | `envanter_okunamadi` (424) |
| Yük makinesi izin listesinde, ad kuralına göre non-prod, üretim işaretsiz, envanterde | `yuk_host_izinsiz` |
| Yük makinesi hedefle aynı olamaz | `ayni_host` |
| IP, hedefin aday listesinde (tarama `listen` IP'leri + envanter IP'si; geri dönüş / joker değil) | `ip_hedefte_yok` |
| vhost, hedefin son taramadaki `server_name`'lerinde (tarama verisi varsa) | `vhost_hedefte_yok` |
| Hız ≤ 450 ve ≤ ölçülen `limit_req`'in %90'ı; maxvu ≤ 199 ve ≤ `limit_conn` − 1; süre **40**..300; ısınma 5..60; boşluk 0..120; boşta 30..120; tekrar 1..3; en çok 5 farklı hız; bütçe ≤ 2700 sn | `sinir_asildi` |
| Ölçülmüş tavan **0** (IP anahtarlı `limit_req` < 2 r/s, ör. `1r/s` / `30r/m`, ya da `limit_conn` ≤ 1): "Hedefin ölçülmüş limit_req değeri 2 r/s'nin altında (ya da limit_conn ≤ 1); bu hedefe yük testi yapılamaz." Ölçüm yoksa (null) global tavan geçerlidir; 0 asla global tavana düşmez. `/hedefler` bu hedefi aynı metinle `uygun: false` gösterir. | `sinir_asildi` |
| Senaryo yolunda `;` (yol parametresi, ör. `;jsessionid=`) | `gecersiz_istek` (400) |
| Kilit: koşu `G\|global` + `T\|hedef` + `L\|yük`, ön kontrol `T` + `L` | `kilit_dolu` |
| Ön kontrol: bulunamadı, başkasının, DONE/OK değil, 15 dk'dan eski, engel var (IP yerel değil, vhost yok, k6 yok, `/web_log` okunamıyor, master sayısı ölçülmüş ve 1 değil) | `on_kontrol_eski` |
| Uyarılar açıkça onaylanmadı (`uyariOnay: true`) | `uyari_onayi` |
| Onay metni hedef sunucu adıyla birebir değil | `onay_metni` |
| Senaryo yok / silinmiş / içeriği sha256 ile uyuşmuyor | `senaryo_yok` |
| Template tanımlı değil / kayıt kapalı | `sablon_yok` |
| Template başka playbook koşturuyor | `awx_template_playbook_mismatch` |
| AWX okunamadı / başlatılamadı | `awx_okunamadi` (424) |
| Durdur: koşu henüz başlatılıyor (QUEUED, iş numarası yok, < 120 sn) | `baslatiliyor` |
| Durdur: koşunun durdurma işi başlatılamadı (iptal başarılı olsa da) | `durdur_baslatilamadi` (424) |
| Yeniden oku: koşu değil, iş numarası yok ya da sonucu okunamamış değil | `yeniden_okunamaz` |

Diğerleri: AWX sunucu / iş numarası **istemciden alınmaz** (koşu satırından okunur); `LIMIT_MUAF` ve
proxy değişkenleri hiç gönderilmez (son kapı fazladan anahtarı reddeder); iş geçmişine senaryo
gövdesi yerine boyut izi (`<n b64>`) yazılır; iş çıktısı ve set_stats her yanıtta maskelenir; her
başlatma, durdurma, yeniden okuma ve reddedilen deneme `nginx_loadtest_*` eylemiyle
`targetHost`/`targetIp` dolu olarak denetime yazılır. İşe bağlı tutulan kilit ya da süren koşu,
AWX sunucusunu devre dışı bırakmayı engeller (işten çözülmüş, yalnız süreyle tutulan kilit
engellemez).

### 4.1 Kilitler: iş bitti ≠ yük bitti

AWX iptali (`canceled`) ya da hatası (`error`, ör. execution node kaybı) uzaktaki async
`kos.sh`/k6'yı ve ayrık CPU kaydediciyi **durdurmaz**. Kilit bu yüzden yalnız "AWX işi bitti" diye
bırakılmaz; bağlı işin türüne (`bag_turu`) ve AWX durumuna göre karar verilir (`kilit.cjs`
`bagliIsKarari`, tek kural; sonuçlandırıcı, kilit süpürmesi ve yeni kilit alma aynı kuralı
kullanır):

| AWX durumu | ön kontrol (yük yok) | koşu | durdurma işi |
|---|---|---|---|
| `successful` | bırak | bırak | bırak |
| `failed` | bırak | bırak (playbook temizledi) | **tut** (kalan süreç olabilir) |
| `canceled`, `error` | bırak | **tut** | **tut** |
| bitmemiş / okunamadı | tutulur (değişmez) | | |

* **tut**: kilit dolu kalır ama işten çözülür (AWX sunucu/iş numarası silinir); yalnız süre
  (`locked_until`) dolunca düşer. Sonuçlandırıcı bir koşu işini tutarken süreyi en az
  `bütçe + 180 sn` yapar (bütçe okunamazsa 2700).
* Süresi dolmuş kilit yalnız **bir işe bağlı değilse** devralınır. İşe bağlı süresi dolmuş kilit
  AWX'e sorularak kurala göre geçer (uzun AWX bekleme kuyruğunda süren iş korunur); süresi 12
  saatten fazla önce dolmuş kilit AWX okunamasa da devralınır (sonsuz kilit olmasın).
* **Durdur** başlayınca koşunun kilitleri (koşu satırındaki `kilit_id`) durdurma işine bağlanır ve
  süre en az `bütçe + 180 sn` olur. Durdurma işi yalnız iki sunucu da "kalan süreç yok" derse
  başarılı biter; o zaman kilitler hemen bırakılır, aksi halde süre dolunca. AWX iptali başarısızsa
  (koşu işi hâlâ çalışıyor olabilir) kilitler koşu işinde kalır.
* Koşu başlatılırken satır bu arada `CANCELED` (eski yarım satırı durduran istek) ya da `FAILED`
  (bayat kuyruk) olduysa başlatılan iş hemen iptal edilir; kilitler o işe bağlı kaldığı için kural
  süreyi bekler.

---

## 5. Durumlar

```
QUEUED → RUNNING → FINALIZING → DONE | FAILED | CANCELED | OKUNAMADI
```

* **OKUNAMADI başarı değildir.** AWX "successful" dese de set_stats sonucu yoksa, sonuç başka bir
  koşuya aitse ya da `/sw` koşu dizini okunamıyorsa koşu `OKUNAMADI` olur.
* AWX'e ulaşılamazsa satır olduğu gibi kalır; sonuçlandırıcı bir sonraki turda yeniden bakar
  ("okunamadı ≠ başarısız").
* **AWX 404** ("iş yok") yalnız koşu `COALESCE(started_at, created_at)` + bütçe + 600 sn'den
  eskiyse kabul edilir (`AWX iş #N artık yok`, `OKUNAMADI`). Daha genç koşuda tek bir 404 (geçit,
  yeni AWX URL'i) kanıt değildir: satır ve kilit değişmez, sonraki tur yeniden bakar.
* İş bittiği hâlde AWX **olay işlemesi** (`event_processing_finished`) tamamlanmadıysa iş
  bitişinden sonra 10 dk beklenir; sonra yine sonuçlandırılır ve nedenlere "AWX olay işlemesi
  tamamlanmadı; arşivlenen çıktı eksik olabilir" eklenir (satır sonsuza dek `RUNNING` kalmaz).
* **DUR sözleşmesi**: playbook `DUR`'da da işi düşürür (AWX `failed`). Karar set_stats'a göre
  verilir: `durum !== FAIL` ve (AWX `successful` ya da AWX `failed` + `DUR`) → başarılı. DUR koşusu
  `DONE` olur, `GECERLI` analiz `KISMI`'ye iner (neden: "koşu erken durdu (DUR)"). `canceled` her
  zaman `CANCELED`'dır.
* Başarısız bir işin okunabilen sonucu yazılır ama geçerliliği en iyi `KISMI` olur.
* Playbook koşu bölümünü yayımladı ama `sw_dizin` bildirmediyse `/sw`'ye hiç veri kopyalanmamıştır
  (yük başlamadı ya da kopya düştü): dizin **okunmaz**, koşu `FAILED` + `GECERSIZ` olur
  ("yük başlamadı ya da sonuçlar /sw'ye kopyalanmadı (playbook sw_dizin bildirmedi)").
* Koşu dizini **sunucuda** kurulur (`<NGINX_LOADTEST_DIR>/<koşu no>`); playbook'un bildirdiği yol
  farklıysa kullanılmaz, geçerlilik `KISMI`'ye düşer. Okuyucu yalnız bu koşunun adımına
  (`R<koşu no>_`) ait log satırlarını kabul eder; diğerleri depoya girmez, sayıları tek uyarıda
  yazılır: `log_baska_adim_satiri:<n>`.
* **Okuyucu tavanları** (bellek kalkanı; aşılırsa okuma hatası → deneme sayacı, sonunda `OKUNAMADI`,
  mesaj dosya adıyla): bir log deposunda en çok 64 farklı TUR ("log dosyasinda 64'ten fazla farkli
  TUR (Portal kosusu gibi gorunmuyor)"); `zaman.csv` ve `baslatilan.csv` en çok 2000, her
  `istemci_*.csv` / `hatali_istemci_*.csv` en çok 100, her `sunucu_*.csv` en çok 20000 satır;
  `diger_*.tsv` dosyalarında toplam en çok 20000 farklı saniye; `bilgi_*.txt`'te `uyari=` ve
  `gecersiz=` satırları ayrı ayrı en çok 2000 (`<dosya>: satir tavani asildi (en cok N satir)`).
  `log=` satırları **tavansızdır**: kaydedici `/web_log` altındaki her `*.log` için bir satır yazar
  (çok vhost'lu hedefte yüzlerce) ve okuyucu yalnız son değeri tutar.
* Adım uyarıları (`ham.uyarilar`) koşu uyarılarına `<TUR>: <uyarı>` olarak da eklenir
  (tekilleştirilir; en çok 40, fazlası tek satır "… ve N adım uyarısı daha"). Sonuçlandırıcı koşu
  uyarılarının ilk 100'ünü saklar; ekran bu satırları genel uyarılardan ayırıp katlanmış listeler.
* **Deneme sayacı** (`sonuclandirma_denemesi`, çökme döngüsü kalkanı): sonuçlandırıcı satırı
  `FINALIZING`'e alırken sayacı aynı ifadede artırır. `/sw` okuması ya da analiz hata verirse ve
  deneme < 3 ise satır `FINALIZING` kalır, sonraki tur yeniden dener (geçici NFS hatası); 3.
  denemede son karar yazılır. Sayaç 3'ü geçmişse (önceki denemeler son yazıma ulaşamadı, ör. Portal
  süreci okuma sırasında yeniden başladı) `/sw` **hiç okunmaz**: `OKUNAMADI`, neden "sonuç 3
  denemede okunamadı (Portal süreci okuma sırasında yeniden başlamış olabilir)".
* **Sonucu yeniden oku**: `OKUNAMADI` otomatik yeniden okunmaz. Admin, iş numarası olan ve
  `durum = OKUNAMADI` ya da `gecerlilik = OKUNAMADI` olan bir **koşuyu** `POST
  /kosular/:id/yeniden-oku` ile yeniden sonuçlandırmaya alır (satır `FINALIZING`, sayaç 0,
  sonuçlandırıcı hemen tetiklenir; `/sw` kopyasını ve SHA256SUMS'ı düzelttikten sonra).

---

## 6. API

Taban `/api/nginx-loadtest`. Yanıt `{ ok: true, ... }` ya da `{ ok: false, message, code }`.

| Uç | Erişim | Not |
|---|---|---|
| `GET /hedefler` | okuma | hedefler (uygun / değil + neden, aday IP, vhost, ölçülen tavanlar), yük makineleri, sınırlar, varsayılanlar |
| `GET /senaryolar`, `GET /senaryolar/:id` | okuma | `:id` TSV'yi ve özeti de döner |
| `POST /senaryolar`, `DELETE /senaryolar/:id` | Admin | silme yumuşaktır |
| `POST /kosular/on-kontrol` | Admin | `{ kosuId, jobId, awxServerId }` |
| `POST /kosular` | Admin | `{ onKontrolKosuId, confirmText, uyariOnay }` |
| `GET /kosular?islem=&durum=&hedef=&onceki=&limit=` | okuma | `islem` ∈ `kosu`, `on_kontrol`; `durum` ∈ `QUEUED`, `RUNNING`, `FINALIZING`, `DONE`, `FAILED`, `CANCELED`, `OKUNAMADI`; `onceki` = koşu no (yalnız `id < onceki`, "daha eski" sayfası); `limit` 1..200 (varsayılan 50). Sıra `id` azalan. Yanıtta `dahaVar` (limit + 1 satır çekilir). Geçersiz değer (ya da tekrarlanan parametre) → 400 `gecersiz_istek` |
| `GET /kosular/:id` | okuma | ayrıntı: parametreler, ön kontrol özeti + engel/uyarı listesi, geçerlilik nedenleri, adımlar; `durdurIsi: { awxServerId, awxJobId } \| null` (son durdurma işi), `sonuclandirmaDenemesi` (sonuçlandırma deneme sayısı) |
| `GET /kosular/:id/durum?since=` | Admin | maskeli iş çıktısı; `since` = elinizdeki metnin uzunluğu → yalnız devamı (`outputOffset`, `outputLength`) |
| `POST /kosular/:id/durdur` | Admin | AWX iptali + (koşu) `durdur` kipi. Başarı: `{ ok, iptal, iptalHatasi, durdurIsi: { jobId, awxServerId } \| null, durdurHatasi: null }`. 409 `baslatiliyor`, 409 `kosu_bitti`, 424 `durdur_baslatilamadi` (gövdede `iptal`, `iptalHatasi`, `durdurHatasi`), 424 `awx_okunamadi` (ön kontrol iptal edilemedi) |
| `POST /kosular/:id/yeniden-oku` | Admin | sonucu okunamamış koşuyu yeniden sonuçlandırır → `{ ok: true }`; değilse 409 `yeniden_okunamaz` |
| `GET /karsilastir?ref=&aday=&esikCpu=&esikP95=` | okuma | karar, nedenler, tablo, kademe, kombinasyon |

---

## 7. Sorun giderme

| Belirti | Neden / yapılacak |
|---|---|
| 409 `awx_prompt_on_launch_disabled` | Template'te "Prompt on launch → Variables" kutusunu işaretleyin. |
| 409 `sablon_yok` | Admin › Playbook Kayıtları › `nginx_loadtest_run`: satır var mı, açık mı, Template ID dolu mu. |
| 409 `kilit_dolu` uzun süre | Kilidin işi başarıyla bitmişse bir sonraki denemede bayat kilit devralınır. Koşu AWX'ten iptal edildiyse ya da `error` ile bittiyse kilit **bilerek** süre dolana kadar (en az bütçe + 180 sn) tutulur: uzaktaki k6 sürüyor olabilir. Koşuda **Durdur**'a basın; durdurma işi başarıyla biterse kilit hemen bırakılır. AWX okunamıyorsa kilit TTL (75 dk) dolunca düşer. Mesaj kimin hangi işi tuttuğunu söyler. |
| 424 `durdur_baslatilamadi` | Koşunun AWX işi iptal edildi (ya da edilemedi) ama durdurma işi başlamadı (template, preflight, AWX 5xx). Uzaktaki k6 / kaydedici sürüyor olabilir: Durdur'u yeniden deneyin. |
| 409 `baslatiliyor` | Koşu AWX'e gönderiliyor; birkaç saniye sonra Durdur'u yeniden deneyin. |
| 424 `envanter_okunamadi` | TBMWANS erişimi ya da `dbo.nginx_inventory` yeniden yükleniyor (TRUNCATE + yükleme); birkaç dakika sonra deneyin. |
| Koşu `OKUNAMADI` | `/sw/.../nginx_loadtest/<koşu>/` dizinini, `SHA256SUMS`'ı ve AWX'te `nginx_loadtest_result` set_stats'ını kontrol edin (playbook toplama adımı). Düzelttikten sonra ekranda **Sonucu yeniden oku** (`POST /kosular/:id/yeniden-oku`). Yeniden okuma önce AWX işine bakar: iş AWX'ten silinmişse (saklama süresi) koşu "AWX iş #N artık yok" ile yine `OKUNAMADI` kalır. |
| Koşu uzun süre `FINALIZING` | `/sw` okuması hata veriyor; sonuçlandırıcı en çok 3 kez dener (ekranda "deneme N/3"), sonra son kararı yazar. |
| Koşu `OKUNAMADI`: "satir tavani asildi" ya da "64'ten fazla farkli TUR" | Koşu dizininde Portal koşusuna benzemeyen veri var (§5 okuyucu tavanları): `/sw` dizinine dışarıdan yazılmış ya da bozulmuş dosya. `bilgi_*.txt`'teki `log=` satırları sayılmaz (hedefte yüzlerce log dosyası olabilir). |
| Hedef "limit_req 2 r/s'nin altında" diye gri | Hedefte IP anahtarlı çok sıkı bir `limit_req` (ör. giriş sayfası için `1r/s`) ya da `limit_conn 1` uygulanıyor; bu hedefe yük testi yapılamaz. |
| "Durdur" iş kuyrukta bekliyor | Template'te "Enable Concurrent Jobs" kapalı. |
| `ip_hedefte_yok` ama IP doğru | IP son nginx taramasında (Nginx_Audit_Servers `listen`) ya da `dbo.nginx_inventory.ip`'de olmalı; tarama eskiyse önce taramayı tazeleyin. |
| `vhost_hedefte_yok` | vhost son taramadaki `server_name`'lerde yok; yeni eklendiyse tarama tazelenmeli. |
