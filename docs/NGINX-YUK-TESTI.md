# Nginx Hub › Yük Testi

İzinli bir yük makinesinden, yazılan bir **hedef IP**'ye **k6** (açık döngü, sabit istek/sn) ya da
**wrk** (kapalı döngü, sabit bağlantı sayısı, toplam hızı tavanlı) ile yük uygular. Hedef IP iki
türden biridir:

* **sunucu** — IP envanterdeki bir DEV / TEST / QA nginx sunucusunun (paylaşılan VIP dahil). Hedefte
  aynı anda CPU kaydedici çalışır; sonuçta her kademe için yanıt süresi, istek başına CPU
  (CPU-ms/istek), hata ve kapasite çıkar.
* **serbest** — IP hiçbir nginx sunucusunun değil (LB VIP'i ya da yönetilmeyen bir sunucu), Portal izin
  listesindeki bir ağda. Hedefe bağlanılmaz (SSH yok); yalnız **istemci ölçümü** (p50/p95/p99, hata,
  429/5xx) yapılır.

Sonuçta koşunun **geçerliliği** (nedenleriyle) ve iki koşunun karşılaştırması (`KALICI` / `NOTR` /
`RET` / `GECERSIZ` / `VERI_YOK` / `DOYMA`) çıkar.

Elle koşulan GLOMO kitinin (`kos.sh`, `yuk_k6.js`, `cpu_kaydedici.sh`, `karsilastir.py`) Portal'a
taşınmış hâlidir; k6 ölçüm dosyaları ve hesaplar kitle aynıdır. wrk yolu (`wrk_kos.sh`, `yuk_wrk.lua`)
Portal'a özgüdür ve aynı istemci dosya şemasını yazar.

---

## 1. Parçalar

| Parça | Yer |
|---|---|
| Ekran | `src/components/nginx_console/YukTestiTab.tsx`, `src/components/nginx_console/yukTesti/` |
| API | `server/nginx-loadtest/index.cjs` → `/api/nginx-loadtest/*` |
| Kapılar (girdi, IP sınıflandırması, ortam, sınırlar) | `server/nginx-loadtest/dogrula.cjs` |
| Kilit (`nginx_loadtest_kilitleri`) | `server/nginx-loadtest/kilit.cjs` |
| AWX başlatma | `server/nginx-loadtest/baslat.cjs` |
| Sonuçlandırıcı (sunucu tarafı) | `server/nginx-loadtest/poller.cjs` |
| Sonuç dizini okuma / analiz | `server/nginx-loadtest/sonuc.cjs`, `server/nginx-loadtest/analiz.cjs` |
| Playbook | Ansible deposu `bmw_portal/nginx_loadtest/nginx_loadtest.yml` (+ `files/`: `kos.sh`, `yuk_k6.js`, `cpu_kaydedici.sh`, `on_kontrol.sh`, `durdur.sh`, `wrk_kos.sh`, `yuk_wrk.lua`; `README.md`); Portal aynası `server/ansible/bmw_portal/nginx_loadtest/` |
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
| Limit | Kullanılmaz. Portal her zaman boş gönderir; hedef ve yük makinesi playbook içinde `add_host` ile eklenir (serbest hedefte yalnız yük makinesi). |
| Survey | Kullanmayın. Hedef, hız, süre için **varsayılan değer olmamalı**: değişkenler yutulursa playbook girdi kapısında düşmeli, varsayılanla yük üretmemeli. |
| Timeout | **≤ 60 dk (3600 sn)**. Portal bu değeri okuyamaz; kilit süresi (75 dk) bunun üstüne kuruludur. |
| **Enable Concurrent Jobs** | **AÇIK**. "Durdur" koşu sürerken aynı template'le başlar; kapalıysa koşu bitene kadar kuyrukta bekler. |
| Kimlik / kullanıcı | `nginx_console_*` template'leriyle aynı makine kimliği; hedefte ve yük makinesinde `www` olarak çalışır, nginx komutları düz `dzdo <nginx>` ile. |
| **Execute / Admin rolü** | **yalnız Portal servis hesabı** (§4.0). Şablonu AWX'ten başlatabilen biri extra_vars'la playbook kapılarını da ezebilir; kapılar bunun yerine geçmez. |

Ayrıca:

* Ansible deposu AWX'e **zip ile** gider (`tools/ansible-zip.py`): `bmw_portal/nginx_loadtest/`
  altındaki yeni dosyalar zip'e girmeli. Portal aynası ile Ansible deposundaki kopya bayt bayt
  aynı olmalı (bekçi denetler). Playbook her kipte `files/` altındaki yedi betiğin hepsini arar:
  zip'te `wrk_kos.sh` ya da `yuk_wrk.lua` eksikse **k6 koşuları da** "betiklerden biri yok" ile düşer.
* Template'i template-preflight'ın beklediği playbook'a bağlayın: başka bir playbook'u koşturan
  Template ID girilirse iş **başlatılmaz** (409 `awx_template_playbook_mismatch`).
* Uzun iş uyarısı (Teams, 30 dk) gelebilir; bu template'i otomatik iptal izin listesine
  **eklemeyin**. Koşu kendi süre sınırıyla biter; AWX iptali uzaktaki async görevi ve ayrık k6 / wrk'yi
  durdurmaz — durdurmanın yolu ekrandaki **Durdur**'dur. AWX'ten iptal edilen (ya da `error` ile
  biten) bir koşunun kilitleri bu yüzden **bırakılmaz**, süre sınırına kadar tutulur (§4.1).
* **AWX'ten yeniden başlatma (Relaunch) yapmayın.** Portal her işe bir geçerlilik süresi
  (`yuk_son_epoch` = başlatma anı + 15 dk) koyar; playbook süresi dolmuş işi girdi kapısında reddeder
  ("is gecerlilik suresi dolmus ya da gecersiz"). AWX kuyruğunda 15 dk'dan uzun bekleyen iş de aynı
  nedenle reddedilir (fail-closed; Portal `FAILED` gösterir).

### 2.2 Yük makinesi: k6, wrk ve serbest hedef izin dosyası

**k6**

* Varsayılan yol `/home/www/bin/k6` (`NGINX_LOADTEST_K6`). `www` kullanıcısı çalıştırabilmeli.
* En az **v0.45** (kos.sh denetler, eskiyse koşu başlamaz).
* Kurulum: kurumun onaylı kanalından tek ikili (`k6-vX.Y.Z-linux-amd64.tar.gz`) getirin,
  yayıncının sha256 listesiyle doğrulayın, `install -m 0755 k6 /home/www/bin/k6`. Sunucunun dnf
  aynası geride olabilir; paket yöneticisine güvenmeyin.
* Ön kontrol k6'nın **sürümünü ve sha256'sını** raporlar; koşular arasında değişmemeli.

**wrk** (yalnız wrk koşusu için gerekir)

* Varsayılan yol `/home/www/bin/wrk` (`NGINX_LOADTEST_WRK`). Asgari **4.0** (`delay()`,
  `wrk.thread:stop()`), önerilen **4.2.0**. Resmî ikili yoktur: kurumun onaylı kaynağından
  (sürüm etiketli arşiv ya da etiketli klon) operatör derler.
* Bağımlılıklar: `gcc`, `make`, `tar` / `unzip`, klon ise `git`; wrk'nin paketli OpenSSL'i derlenecekse
  `perl`. Tercihen dağıtımın bakımlı OpenSSL'i: `openssl-devel` kurulu iken

  ```
  make VER=4.2.0 WITH_OPENSSL=/usr
  install -m 0755 wrk /home/www/bin/wrk
  /home/www/bin/wrk -v | head -1        # "wrk 4." ile başlamalı
  sha256sum /home/www/bin/wrk           # değeri kurulum kaydına yazın
  ```

* **`VER=4.2.0` zorunludur.** Makefile sürümü `git describe`'dan alır: `.git`'siz arşivden derlenen
  ikili `wrk  [epoll] ...`, etiketsiz klon kısa bir hash basar. Bu ikililer çalışır ama sürüm satırı
  okunamaz; ön kontrol "wrk yük makinesinde çalışıyor ama sürümü okunamadı ya da 4 altında" engeliyle
  durur.
* Ön kontrol yalnız **seçili motorun** ikilisini ölçer (wrk koşusunda k6 aranmaz ve tersi); sürüm ve
  sha256 raporlanır.

**Serbest hedef izin dosyası** (yalnız serbest hedef isteniyorsa; her yük makinesinde)

Portal'ın izin listesi (`NGINX_LOADTEST_SERBEST_AGLAR`) playbook'a **gönderilmez** (extra_var olarak
ezilebilirdi). Playbook yük makinesindeki kendi dosyasını okur; yol playbook'ta sabittir:
`/etc/portal_yuktesti/serbest_aglar`. Unix ekibi, **www dışında** bir hesapla:

```
install -d -m 0755 /etc/portal_yuktesti
install -m 0644 serbest_aglar /etc/portal_yuktesti/serbest_aglar
```

* Dizin ve dosyanın sahibi **www değil**, grup / diğer **yazamaz**, www **okur** ("root sahipli" şartı
  aranmaz; aranan özellik "www yazamaz"dır).
* En çok 16 KB ve 64 girdi; satır başına `a.b.c.d/n` (n **24..32**; tek IP için `/32`). `#` ile
  başlayan ve boş satır atlanır; CRLF zararsız. Host bitli girdi (`10.20.30.5/24`) geçersizdir.
* Dosya Portal listesinin **alt kümesi** olmalı ve yük makinesi başına tutulur. Yoksa, boşsa ya da tek
  bir geçersiz satır varsa serbest ön kontrol ve koşu **reddedilir** ("serbest izin listesi: ..."
  nedeniyle); sunucu hedefi etkilenmez.

**Genel**

* Yük makinesinden hedef IP'ye 443 erişimi olmalı; ön kontrol her yola bir istek atarak doğrular.
  Koşu sırasında proxy değişkenleri temizlenir, çerez ve ek başlık gönderilmez, istek HTTP/1.1'dir.
* **GBNGXT34 kendisi bir TEST internet reverse proxy'sidir.** Yük üretirken kendi trafiği
  etkilenebilir; düşük hızla başlayın, sonuçtaki "DOYMA"yı yük makinesinin de doyması olarak okuyun.
  Serbest hedefte bu yüzden her zaman "Yük sunucusu ... bir internet reverse proxy’si" plan uyarısı
  çıkar (§4.3).

### 2.3 Ortam değişkenleri

| Değişken | Varsayılan | Anlam |
|---|---|---|
| `NGINX_LOADTEST_RUN_TEMPLATE_ID` | — | Template ID (Playbook Kayıtları satırında yoksa) |
| `NGINX_LOADTEST_AWX_SERVER_ID` | `1` | AWX sunucusu (kayıtta yoksa) |
| `NGINX_LOADTEST_YUK_HOSTLARI` | `GBNGXT34` | İzinli yük makineleri (virgülle). Listedeki makine de ad kuralına göre DEV/TEST/QA, üretim işaretsiz ve envanterde olmalı; liste kapıyı **gevşetemez**. Geçersiz giriş atılır. |
| `NGINX_LOADTEST_K6` | `/home/www/bin/k6` | Yük makinesinde k6 yolu |
| `NGINX_LOADTEST_WRK` | `/home/www/bin/wrk` | Yük makinesinde wrk yolu (`make VER=4.2.0` ile derlenmiş). Geçersiz yol varsayılana düşer. |
| `NGINX_LOADTEST_SERBEST_AGLAR` | boş = **serbest hedef KAPALI** | Serbest hedef izin listesi: virgül / boşluk / `;` ayrık `a.b.c.d/n` (n **24..32**) ya da tek IP (= /32). Biçimsiz, /24'ten geniş, host bitli ya da özel aralık (0/8, 127/8, 169.254/16, 224+) girdisi **atılır** (liste daralır, log'a bir kez yazılır); en çok 64 girdi. Dar tutun: tek VIP `/32` ya da yalnız VIP alt ağı `/24`. Örnek: `10.20.30.0/24,10.20.31.15` |
| `NGINX_LOADTEST_SERBEST_YASAK` | boş | İsteğe bağlı yasak liste (ör. PROD VIP aralıkları): aynı biçim, her önek (geniş yasak güvenlidir). **İki kipte** ve izin listesinden **önce** uygulanır. Tek geçersiz girdi **tüm yük testini** kapatır (409 `ip_yasak_listesi_gecersiz`): yasak listesinde girdi atmak fail-open olurdu. |
| `NGINX_LOADTEST_DIR` | `/sw/BMW_PORTAL/nginx_loadtest` | Sonuç kökü; koşu dizini `<kök>/<koşu no>/`. Playbook (GBLABT02 üzerinden yazar) ve Portal (okur) **aynı yolu** görmeli. |
| `NGINX_LOADTEST_LOCK_TTL_MIN` | `75` | Kilit süresi, dk (65..720) |
| `NGINX_LOADTEST_POLL_SN` | `30` | Sonuçlandırıcı aralığı, sn (10..600) |
| `NGINX_LOADTEST_RETENTION_DAYS` | `365` | DB saklama, gün (30..3650) |

Sınırlar (hız, bağlantı, süre, bütçe, serbest tavanları, tazelik eşikleri) **kod sabitidir**; DB ya da
env ile gevşetilmez.

### 2.4 Erişim

Sekme `tab:nginx:yuktesti` **varsayılan kapalıdır**. Admin › Nginx Hub Erişimi'nden kullanıcıya
ya da AD grubuna açılır. Admin olmayan kullanıcı yalnız **sonuçları okur** (hedefler, senaryolar,
koşular, karşılaştırma). Senaryo yazma/silme, IP sınıflandırması (`/ip-sinifi`), ön kontrol, koşu,
durdurma ve canlı iş çıktısı **yalnız Admin**. Serbest izin listesindeki ağlar `/hedefler`'de yalnız
Admin'e gösterilir (diğerleri yalnız açık / kapalı bilgisini görür).

### 2.5 Teslim sırası

1. **Önce Portal** (DB kolonları — `hedef_turu`, `motor`, `plan_uyarilari` — açılışta ALTER ile
   kendiliğinden eklenir; mevcut satırlar sunucu / k6 olur).
2. **Sonra Ansible deposu zip'i.** Yeni dosyalar `bmw_portal/nginx_loadtest/files/wrk_kos.sh` ve
   `files/yuk_wrk.lua` zip listesinde **ayrıca** sayılmalı; değişenler `nginx_loadtest.yml`,
   `README.md`, `files/durdur.sh`, `bmw_nginx/tests/check_nginx_loadtest_job.py`.
3. Operatör: yük makinesine wrk (§2.2; gerekirse `NGINX_LOADTEST_WRK`); serbest hedef isteniyorsa
   `NGINX_LOADTEST_SERBEST_AGLAR` (+ isteğe bağlı `NGINX_LOADTEST_SERBEST_YASAK`) **ve** her yük
   makinesine `/etc/portal_yuktesti/serbest_aglar`; AWX'te şablonun Execute / Admin rolü yalnız Portal
   servis hesabında.
4. Kanarya: Ansible deposundaki `bmw_portal/nginx_loadtest/README.md` "Kanarya" listesi (wrk sürümü,
   1 adımlık wrk koşusu, serbest ön kontrol ve izin dosyasının kaldırılınca reddi, Relaunch reddi,
   koşu kapısı).

Ara dönem: Portal yeni, playbook eski iken k6 + sunucu koşuları çalışır (eski playbook yeni yedi
değişkeni yok sayar); serbest ve wrk istekleri eski girdi kapısında reddedilir (yük üretilmez).
Playbook yeni, Portal eski iken eski Portal'ın ön kontrol / koşu istekleri reddedilir (yeni
değişkenler zorunlu), durdurma isteği kabul edilir.

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
2. **Hedef IP** — IP'yi yazın ya da envanterden bir nginx sunucusu seçin (host seçici isteğe bağlı;
   seçilirse IP o hostun aday IP'lerinden gelir ve paylaşılan bir VIP de kabul edilir). Ekran yazılan
   IP'yi `/ip-sinifi` ile sınıflandırıp **gösterir**; kesin karar ön kontrolde ve koşu başlatılırken
   sunucuda **yeniden** verilir (§4.2).

   | | sunucu | serbest |
   |---|---|---|
   | Ne zaman | IP tam bir non-prod nginx sunucusunun (ya da seçili hostun) | IP hiçbir nginx sunucusunun değil, izin listesinde, yasak listede değil, hiçbir PROD / EDU / bilinmeyen sahibe ait değil, envanter taze |
   | Hedefe SSH | var (CPU kaydedici + nginx logu) | **yok** (yalnız istemci ölçümü) |
   | Ön kontrol | hedef + yük makinesi | yalnız yük makinesi: izin dosyası, IP yük makinesinde yerel değil, yollar 200, motor ikilisi |
   | Koşu başında | playbook hedefte `ip_yerel`'i **yeniden** ölçer; 1 değilse kaydedici ve yük başlamaz | playbook yük makinesindeki izin dosyasını **yeniden** denetler |
   | Tavanlar | k6 hız ≤ min(450, ölçülmüş `limit_req` × 0,9), VU ≤ min(199, `limit_conn` − 1); wrk bağlantı ≤ min(199, `limit_conn` − 1), toplam hız ≤ min(450, ölçülmüş `limit_req` × 0,9) | iki motorda **≤ 200 istek/sn** ve **≤ 50 bağlantı / VU** |
   | Kilit | `T\|<HOST>` + `L\|<YUK>` (koşuda + `G\|global`) | `G\|global` (**ön kontrol dahil**) + `T\|IP:<ip>` + `L\|<YUK>` |
   | Onay metni | hedef host adı | hedef IP |
   | Analiz | bugünkü (istemci + sunucu) | yalnız istemci; CPU alanları boş; `KALICI` verilmez |

3. **Yük aracı (motor)**

   | | k6 (varsayılan) | wrk |
   |---|---|---|
   | Model | açık döngü: adım = istek/sn (`hizlar`) | kapalı döngü: adım = bağlantı sayısı (`baglantilar`); her bağlantı yanıtı alınca, bağlantı başına sabit beklemeden sonra yeni istek gönderir |
   | Ek parametre | `maxvu` 10..199 | `is_parcacigi` 1..16 (en küçük bağlantı sayısını aşamaz ve **her** bağlantı sayısını tam bölmeli; ör. 2 → 2 4 8); en çok 5 bağlantı kademesi, her biri 1..199, tekil |
   | Hız tavanı | — (adım hızı zaten sınırlı) | `tavan_rps` **sunucuda hesaplanır** (kullanıcı girmez, gönderilen değer yok sayılır): sunucuda min(450, ölçülmüş `limit_req` × 0,9), serbestte 200. Bağlantı başına bekleme `d = ceil(N × 1000 / tavan_rps)` ms, toplam hız **ortalamada** ≤ tavan (anlık kümelenme olabilir, aşağıya bakın) |
   | SNI | açık / kapalı | **yalnız kapalı** (wrk SNI olarak URL'deki IP'yi gönderir, Host başlığına göre seçemez; SNI açık gönderilirse 400) |
   | Erken durma (DUR) | 429 / HTTP2 / k6 hatası / boş özet (kit) | ilk 429 ya da 5xx yanıtta iş parçacığı yük üretmeyi keser; 429, 5xx, 10'dan fazla soket hatası, %1 üstü hata oranı, sayaç tutarsızlığı, wrk hatası ya da boş özette koşu durur |
   | Gecikme | k6 ölçümü | wrk histogramı, **koordineli ihmal (CO) düzeltmeli** |
   | TLS | 1.2'ye sabit; `yeni` = her bağlantıda tam el sıkışma | sürüm sabitlenemez (1.3 olabilir), oturum devamı olabilir: TLS payı hesaplanmaz |
   | Ölçülmeyen istemci alanı | — | `ttfb_p95`, `tls_p95`, `connect_p95`, `p95_js`..`p95_config`, `p95_buyuk`, `dropped` boş (asla 0) |

   Düşük gecikmede wrk'nin her adımı tavana yakın yük üretir; adımlar eşzamanlılığı (bağlantı
   sayısını) değiştirir. wrk sonuçları k6 sonuçlarıyla karşılaştırılmaz.

   **Tavan ORTALAMA hızı sınırlar, anlık hızı değil.** Bağlantılar birlikte başlar; Lua betiği her
   bağlantının ilk isteğini `[d, 2d)` aralığında rastgele yayar (`d` = bağlantı başına bekleme), yine de
   istekler kümelenebilir. `limit_req` burst'ü bağlantı sayısından küçük olan ya da burst'süz
   (`burst=` tanımsız) yollar bu yüzden ortalama tavanın altında da 429 alabilir ve koşu durur (DUR). Böyle yollarda k6 kullanın (açık döngü, istekler zamana yayılır) ya da daha az
   bağlantıyla koşun. Ekrandaki wrk uyarısı aynı şeyi söyler.

4. **Host başlığı (vhost)** — iki kipte serbest metindir ve yalnız biçimle (RFC 1123, küçük harf,
   port / joker / regex yok) denetlenir. Sunucu kipinde öneriler hedefin `server_name`'leridir;
   listede olmayan ad **engel değildir** (joker / regex `server_name`'li siteler de test edilebilir),
   ön kontrolde `nginx -T` ölçümü bulamazsa onay isteyen bir uyarı çıkar. Yalnız üretim / EDU / ortamı
   bilinmeyen sunucularda tanımlı bir ad iki kipte reddedilir (409 `host_uretim`, §4.3).
5. **Ön kontrol** (yük üretmez) — sunucu: seçilen IP hedefte yerel mi, Host başlığı `nginx -T`'de var
   mı (uyarı), tek nginx master, `/web_log` doluluğu ve okunabilirliği, etkin `log_format`'ta
   `user-agent=` var mı; serbest: IP yük makinesinde yerel değil mi ve yük makinesindeki izin dosyası
   (eşleşen girdi raporlanır). İki kipte: seçili motor var mı (sürüm, sha256), senaryodaki her yol 200
   dönüyor mu, sıkıştırma (statik / dinamik / yok).
6. **Başlat** — son **15 dk** içinde **sizin** çalıştırdığınız, tamamlanmış ve OK ön kontrol
   gerekir; parametreler ön kontroldekinin aynısıdır (istemci değiştiremez). Onay penceresinde
   sunucu hedefinde hedef sunucu adını, serbest hedefte **hedef IP'yi** birebir yazın. Uyarı varsa
   kutuyu işaretleyin: ön kontrol uyarıları (200 dönmeyen yol, ön-sıkıştırılmış dosya, `/web_log` ≥
   %65 ya da ölçülemedi, `user-agent=` yok, master sayısı ölçülemedi, Host başlığı `nginx -T`'de yok),
   **plan uyarıları** (serbest hedef, §4.3) ve sabit uyarılar (serbest hedef, wrk). Ölçülmüş nginx
   master sayısı 1 değilse, `/web_log` okunamıyorsa, IP hedefte (serbestte: yük makinesinde) yerel
   değilse ya da motor yoksa bu bir **engeldir**, onayla geçilmez. Koşu kapısı sınıflandırmayı ve
   Host başlığı denetimini yeniden yapar: IP'nin sınıfı değiştiyse ya da yeni bir plan uyarısı
   çıktıysa 409 `on_kontrol_eski` (ön kontrolü yeniden çalıştırın).
7. **İzleme** — canlı iş çıktısı (maskeli). Sekme kapansa da sunucudaki sonuçlandırıcı işi bitirir,
   sonucu yazar, kilidi kurala göre bırakır ya da tutar (§4.1).
8. **Sonuç** — geçerlilik `GECERLI` / `KISMI` / `GECERSIZ` / `OKUNAMADI` ve nedenleri; adım tablosu
   (p50/p95/p99, TTFB, hata, 429/5xx, dropped, istemci/sunucu istek hızı, CPU-ms/istek, host CPU,
   kapasite; serbestte sunucu alanları boş, wrk'de hız sütunu bağlantı sayısıdır). Erken duran koşu
   (`DUR`, tamamlanan adımlar `/sw`'de) AWX'te `failed` görünse de **`DONE`** olur ve geçerliliği en
   iyi `KISMI`'dir (Karşılaştır'da seçilebilir).
9. **Karşılaştır** — iki koşu; karar, nedenleri ve kademe tablosu (§5.1).
10. **Durdur** — AWX işini iptal eder **ve** (koşu için) aynı template'i `durdur` kipinde başlatır
    (koşu dizinindeki pid'leri ve o dizine bağlı k6 / wrk / `wrk_kos.sh`'i sonlandırır; serbest
    hedefte yalnız yük makinesinde). Durdurma ortam kapısından ve sınıflandırmadan geçmez (tür ve
    motor koşu satırından). Ayrıntı ve kilitler: §4.1.
    * Koşu henüz başlatılıyorsa (QUEUED, AWX iş numarası yok, 120 sn'den yeni) **409
      `baslatiliyor`**: "Koşu başlatılıyor; birkaç saniye sonra yeniden deneyin."
    * Koşu için durdurma işi **başlatılamazsa** (AWX iptali başarılı olsa da) **424
      `durdur_baslatilamadi`** döner; gövdede `iptal`, `iptalHatasi`, `durdurHatasi`. Metin motora ve
      türe göredir: "Uzaktaki k6 / kaydedici sürüyor olabilir" (sunucu), "Uzaktaki wrk sürüyor olabilir"
      (serbest, wrk) … Durdur'u yeniden deneyin. Kilitler koşunun süre sınırına kadar tutulur.
    * Durdurma işi başlarsa iş numarası koşuya yazılır (`durdurIsi`) ve koşunun kilitleri o işe
      bağlanır; iş başarıyla biterse (sunucu hedefinde iki sunucu, serbestte yük makinesi "kalan
      süreç yok" derse) kilitler hemen bırakılır.
    * Ön kontrolde durdurma işi yoktur; yalnız AWX işi iptal edilir (`durdurIsi: null`).
    * `CANCELED` / `FAILED` koşuya yeniden Durdur serbesttir (kalan süreç temizliği); `DONE` koşu
      409 `kosu_bitti`.

Toplam süre (bütçe) sunucuda hesaplanır ve en çok **2700 sn** olabilir:

```
bütçe = boşta + adım_sayısı × tekrar × (ısınma + süre + boşluk + 20) + 120
adım_sayısı = hız sayısı (k6) | bağlantı kademesi sayısı (wrk)
```

`20`: adım başına ek pay (k6 / wrk açılışı, yol yoklaması, `gracefulStop`). Playbook yalnız ek paysız
formülün altına inilmediğini denetler; pay olmadan 15 adımlı bir koşu `kos.sh` zaman sınırına (rc
124) düşebiliyordu. Serbest hedefte CPU kaydedici olmadığı için `boşta` beklenmez, yalnız bütçeye
girer.

Varsayılanlar: k6 sunucu `100 250 400` istek/sn, maxvu 150; k6 serbest `50 100 200` istek/sn, maxvu 50;
wrk `2 4 8` bağlantı, 2 iş parçacığı; ortak tekrar 2, ısınma 30, süre 120, boşluk 30, boşta 60 → 1380
sn = 23 dk.

Ölçüm süresi (`süre`) en az **40 sn**'dir: analiz penceresi ilk ölçüm saniyesinden 3 sn sonra
başlar, son ölçüm saniyesinden 2 sn önce biter ve CPU örnekleri 1 sn aralıklıdır; pencere en az
30 sn olmalıdır. 30..36 sn'lik ölçüm her adımı `GECERSIZ` (`pencere_kisa`) yapıyordu.

---

## 4. Korkuluklar (sunucu tarafı)

Ekran aynı kuralları yalnız kolaylık için gösterir; karar sunucudadır, playbook da yeniden assert
eder. İş hataları **409** (kalıcı) ya da **424** (geçici) döner; 5xx yok.

### 4.0 Tehdit modeli ve katmanlar

* AWX şablonunda "Variables — Prompt on launch" açık olmak zorunda (Portal extra_vars gönderir) ve
  extra_vars Ansible'da **her** değişkenden önce gelir (play `vars:`, set_fact, register dahil):
  şablonu AWX'te Execute yetkisiyle başlatabilen biri playbook'un regex'lerini ve hesaplanan
  değerlerini de ezebilir. Playbook kapıları bu yüzden **Portal hatasına ve AWX'ten yeniden
  başlatmaya (Relaunch) karşı savunma derinliğidir; kötü niyetli bir AWX kullanıcısına karşı sınır
  DEĞİLDİR.** Asıl sınır AWX RBAC'tir: şablonun Execute / Admin rolü yalnız Portal servis hesabında.
* Katmanlar: (1) **Portal** — IP sınıflandırması, sahiplik, yasak / izin listesi, envanter tazeliği,
  Host başlığı üretim kapısı, tavanlar, kilitler, onay metni; (2) **playbook** — ad kuralı, IP
  biçimi, iş geçerlilik süresi (`yuk_son_epoch`: Relaunch 15 dk sonra reddedilir), sunucu kipinde
  hedefte `ip_yerel` (ön kontrolde **ve** koşu başında), serbest kipte yük makinesindeki izin dosyası
  (sabit yol, sahibi www olmayan dosya), tavanlar; (3) **betikler** — yük makinesinde yerel IP reddi,
  429 / 5xx / soket hatası DUR'u.
* **"Sahipsiz" yalnız "bilinen bir host değil" demektir, PROD olmadığının kanıtı DEĞİLDİR**: LB
  VIP'leri hiçbir envanterde yoktur. Serbest hedefte asıl koruma izin listesidir; dar tutun (tek VIP
  `/32` ya da yalnız VIP alt ağı `/24`).

### 4.1 Kurallar ve kodlar

| Kural | Kod |
|---|---|
| Hedef **ad kuralına** göre DEV/TEST/QA olmalı; PROD, EDU, BILINMIYOR reddedilir. `dbo.nginx_inventory.env`, `dbo.Inventory.env` ya da PROD RP listesinden gelen **her** üretim işareti de reddettirir (bu kaynaklar kapıyı gevşetemez). | `hedef_uretim` |
| Yazılan IP'nin **sahiplerinden** biri PROD / EDU / ortamı bilinmeyen (ALPHA, ODM dahil) ya da üretim işaretli (iki kipte; nginx olmayan sahip de) | `hedef_uretim` |
| Hedef (host seçici) `dbo.nginx_inventory`'de olmalı | `hedef_envanterde_yok` |
| Envanter / tarama tablosu boş ya da okunamıyor ("yok" sayılmaz); serbest hedefte son tarama ya da dolu `dbo.IPInventory` yok | `envanter_okunamadi` (424) |
| Serbest hedefte envanter bayat: `dbo.IPInventory` son yükleme > 48 saat ya da son nginx taraması > 2 gün (metinde tarih ve yaş) | `envanter_bayat` (424) |
| Elle yazılan IP birden çok nginx sunucusunda ya da bir nginx sunucusu + başka bir kayıtta → hedef sunucuyu listeden seçin (paylaşılan VIP host seçiciyle kabul) | `ip_belirsiz` |
| IP'nin sahibi adı çözülemeyen bir envanter kaydı (iki yolda — host seçici dahil; fail-closed) | `ip_sahibi_cozulemedi` |
| Sahipsiz IP ve serbest hedef kapalı (`NGINX_LOADTEST_SERBEST_AGLAR` tanımlı değil) | `serbest_kapali` |
| Sahipsiz IP izinli ağların dışında; /30 ve altı ağlarda ağ / yayın adresi de dışarıda sayılır | `ip_izinli_agda_degil` |
| IP yasak listesinde (`NGINX_LOADTEST_SERBEST_YASAK`; iki kipte, izin listesinden önce) | `ip_yasakli_agda` |
| Yasak listesinde geçersiz girdi: liste düzeltilene kadar **tüm** yük testi kapalı | `ip_yasak_listesi_gecersiz` |
| Yük makinesi izin listesinde, ad kuralına göre non-prod, üretim işaretsiz, envanterde | `yuk_host_izinsiz` |
| Yük makinesi hedefle aynı / IP yük makinesinin kendi IP'si | `ayni_host` |
| IP, (seçili ya da sınıflandırılan) hedefin aday listesinde (hostun en son tarama gününün `listen` IP'leri — bir `server` bloğundaki **her** `listen` — + envanter IP'si; geri dönüş / joker değil) | `ip_hedefte_yok` |
| Host başlığı son taramada **yalnız** üretim / EDU / ortamı bilinmeyen sunucularda tanımlı (iki kipte) | `host_uretim` |
| Hız ≤ 450 ve ≤ ölçülen `limit_req`'in %90'ı; maxvu ≤ 199 ve ≤ `limit_conn` − 1; wrk bağlantı 1..199 ve ≤ `limit_conn` − 1, en çok 5 kademe, tekil; iş parçacığı 1..16, en küçük bağlantıyı aşmaz, her bağlantıyı tam böler; serbestte hız / tavan ≤ 200, VU / bağlantı ≤ 50 (`serbest hedef tavanı`); süre **40**..300; ısınma 5..60; boşluk 0..120; boşta 30..120; tekrar 1..3; bütçe ≤ 2700 sn | `sinir_asildi` |
| Ölçülmüş tavan **0** (IP anahtarlı `limit_req` < 2 r/s, ör. `1r/s` / `30r/m`, ya da `limit_conn` ≤ 1): "Hedefin ölçülmüş limit_req değeri 2 r/s'nin altında (ya da limit_conn ≤ 1); bu hedefe yük testi yapılamaz." Ölçüm yoksa (null) global tavan geçerlidir; 0 asla global tavana düşmez. İki motorda. `/hedefler` ve `/ip-sinifi` bu hedefi aynı metinle `uygun: false` gösterir. | `sinir_asildi` |
| wrk + SNI açık ("wrk SNI'yi Host başlığına göre seçemez (IP adresi SNI olarak gider); SNI kutusunu kapatın."), geçersiz `motor` | `gecersiz_istek` (400) |
| Senaryo yolunda `;` (yol parametresi, ör. `;jsessionid=`) | `gecersiz_istek` (400) |
| Kilit (§4.4) | `kilit_dolu` |
| Ön kontrol: bulunamadı, başkasının, DONE/OK değil, 15 dk'dan eski, engel var, IP'nin sınıfı değişti, yeni plan uyarısı çıktı, parametreler değişti | `on_kontrol_eski` |
| Uyarılar (plan uyarıları dahil) açıkça onaylanmadı (`uyariOnay: true`) | `uyari_onayi` |
| Onay metni: sunucu hedefinde hedef sunucu adı, serbest hedefte **hedef IP** ile birebir değil | `onay_metni` |
| Senaryo yok / silinmiş / içeriği sha256 ile uyuşmuyor | `senaryo_yok` |
| Template tanımlı değil / kayıt kapalı | `sablon_yok` |
| Template başka playbook koşturuyor | `awx_template_playbook_mismatch` |
| AWX okunamadı / başlatılamadı | `awx_okunamadi` (424) |
| Durdur: koşu henüz başlatılıyor (QUEUED, iş numarası yok, < 120 sn) | `baslatiliyor` |
| Durdur: koşunun durdurma işi başlatılamadı (iptal başarılı olsa da) | `durdur_baslatilamadi` (424) |
| Yeniden oku: koşu değil, iş numarası yok ya da sonucu okunamamış değil | `yeniden_okunamaz` |

`vhost_hedefte_yok` artık üretilmez (Host başlığı serbest metin, §3 adım 4). Ret gövdesinde IP'nin
bilinen sahipleri `sahipler: [{ host, env, nginx, kaynaklar }]` (en çok 10) döner.

Diğerleri: AWX sunucu / iş numarası **istemciden alınmaz** (koşu satırından okunur); `LIMIT_MUAF` ve
proxy değişkenleri hiç gönderilmez (son kapı fazladan ve eksik anahtarı reddeder: her iş tam 30
değişkenle gider; playbook kurallarının aynası); iş geçmişine senaryo gövdesi yerine boyut izi
(`<n b64>`) yazılır; iş çıktısı ve set_stats her yanıtta maskelenir; her başlatma, durdurma, yeniden
okuma ve reddedilen deneme `nginx_loadtest_*` eylemiyle `targetHost` (serbestte boş) / `targetIp`
dolu olarak denetime yazılır (ayrıntıda `hedefTuru`, `motor`, `hedefHost`, `hedefIp`, `serbestAg`,
`vhostListede`, `planUyarilari`, `onaylananUyarilar`). Denetim modülü ayrıntıyı 2000 karakterde keser;
yük testi ayrıntısı bu yüzden **her zaman geçerli JSON ve en çok 2000 karakter** kurulur (metin ortadan
kesilmez): sığmazsa önce uyarı dizilerinin her öğesi kısa önek + `…` olur (`kirpildi: true`, öğe sayısı
korunur), yetmezse diziler atılır (`kirpilan: { ad: öğe sayısı }`), sonra anahtar dışı uzun metinler
kısaltılır ve gerekirse anahtar dışı alanlar atılır (`atilan: <sayı>`). Koşu no, işlem, tür, motor, hedef,
yük makinesi, vhost ve AWX kimlikleri her zaman kalır (serbest + wrk koşusunun dört onaylanan uyarısı
~2200 karakterdi). İşe bağlı tutulan kilit ya da süren koşu, AWX sunucusunu devre dışı bırakmayı
engeller (işten çözülmüş, yalnız süreyle tutulan kilit engellemez).

### 4.2 IP sınıflandırması

Sunucu, yazılan IP'nin sahiplerini şu kaynaklardan bulur (hepsi parametreli sorgu; IP SQL metnine
gömülmez): `dbo.nginx_inventory` `ip` kolonu, `dbo.Inventory` `ip`, `dbo.IPInventory` (tüm Ansible
hostlarının IPv4'leri, günlük yeniden yükleme) ve son iki nginx tarama gününün `listen` IP'leri.
Tarayıcı bir `server` bloğundaki **tüm** `listen` direktiflerini tek alanda boşlukla birleştirir
(`listen 10.9.0.1:443 ssl http2; listen 10.20.30.40:443 ssl;` → `10.9.0.1:443 ssl http2 10.20.30.40:443
ssl`); bloğun **her** `listen` adresi sahiplik ve aday IP için sayılır (ilk belirtece bakmak, PROD
nginx'in ikinci `listen`'deki VIP'ini sahipsiz gösterir ve serbest sınıflardı). Ad
normalleştirilir (FQDN'in alanı atılır, büyük harf). **IPInventory onarımı**: yükleyici satırı ilk
`-`'den böldüğü için tireli host adları bozuk gelir (`GB-PRODDB01` → host `GB`, ip
`PRODDB01-10.20.30.45`); Portal `host + '-' + ip`'yi son `-`'den yeniden böler. Adı yine
çözülemeyen satır `ip_sahibi_cozulemedi` ile durdurur (host seçici yolunda da).

Sıra bağlayıcıdır: IP biçimi → yasak listesi (geçersiz girdi, yasaklı ağ; iki kipte) → adı çözülemeyen
sahip → yük makinesinin kendi IP'si (`ayni_host`) → PROD / EDU / bilinmeyen ortamlı ya da üretim
işaretli sahip (`hedef_uretim`) → nginx sahipleri: host seçicide seçili host sahiplerden biriyse
**sunucu** (paylaşılan VIP'te diğer non-prod sahipler kabul; playbook IP'nin hostta yerel olduğunu ön
kontrolde ve koşu başında ölçer), elle IP'de tek nginx sahibi ve tek sahip varsa **sunucu**, aksi
`ip_belirsiz` → nginx sahibi yoksa **serbest** adayı: izin listesi açık mı, tarama ve dolu
IPInventory var mı, envanter taze mi, IP izinli bir ağda mı (ağ / yayın adresi değil). Nginx olmayan
non-prod sahip (ör. bir uygulama sunucusu) serbest hedefte kabul edilir ve `digerSahipler`'de
gösterilir. Tazelik yalnız yükleyicinin koştuğunu gösterir (o gün erişilemeyen hostlar listede
olmayabilir).

#### Tarama günü: yarım yükleme

Nginx tarama analizcisi (`nginx_audit_analyze.py`) günü önce temizler, sonra 5000 satırlık,
her biri ayrı commit edilen partilerle yazar (Hosts → Servers → Locations → Upstreams → Settings →
Files); saklama bugün + dündür. Yükleme sürerken (birkaç dakika; yükleme yarıda düştüyse **bütün
gün**) en son gün (`MAX(scan_date)`) yarımdır, bir önceki gün tamdır. Portal tarama tablolarını bu
yüzden şöyle okur (TBMWANS'ta şema / indeks değişikliği yok; sorgular `(scan_date, host)` indeksinde
seek, Settings'te tam tablo taraması yok):

* **Sahiplik ve Host başlığı adları**: son **iki** tarama gününün birleşimi. Fazladan sahip ya da
  üretim adı tutucu yöndür (dün bir PROD sunucusunun dinlediği IP bugün henüz yazılmamışsa yine
  `hedef_uretim`). Host başlığı kapısında non-prod sunucunun adı ise yalnız o sunucunun **en son**
  gününden sayılır: dün kaldırılmış bir non-prod ad, yalnız üretimde kalan bir adın engelini kaldırmaz.
* **Aday IP'ler, vhost önerileri ve ölçülmüş limitler** (`limit_req` / `limit_conn`, wrk tavanı):
  her hostun son iki gün içindeki **en son** gününden; bugün henüz yazılmamış host dünün tam verisini
  kullanır, iki günün satırları karıştırılmaz. Limitlerde hostun günü, o gün **herhangi bir** Settings
  satırı olan en son gündür (`limit_req`'i olmayan host meşru olarak limitsizdir; dünün limiti ona
  uygulanmaz).
* **Tazelik** (`envanter_bayat`, en çok 2 gün) en son gün (`MAX(scan_date)`) üzerinden kalır.

Kalan sınır: yükleme düştüğünde son commit edilen partinin sınırına denk gelen **tek** hostun bugünkü
satırları eksik kalabilir (o host için en son gün yine bugündür; tam okuma ancak analizcinin bir
"gün tamamlandı" işareti yazmasıyla mümkün olur, bu tur kapsam dışı).

### 4.3 Host başlığı: üretim kapısı ve plan uyarıları

Son iki tarama gününün tüm `server_name`'lerinde Host başlığı aranır (§4.2 "Tarama günü"): tam
eşitlik, `*.alan` (son ek), `.alan` (alanın kendisi ya da son ek), `önek.*`. `_` ve `~` ile başlayan
**regex** `server_name` değerlendirilmez (zaman aşımsız regex olay döngüsünü kilitleyebilir; bilinen
boşluk, asıl koruma izin listesi). Eşleşen sunucuların **hepsi** üretim / EDU / ortamı bilinmeyen (ya da
üretim işaretli) ise iki kipte 409 `host_uretim`. Tarama tablosu yoksa sunucu kipinde denetim atlanır.

**Bilinen boşluk (tarayıcı)**: tarayıcı (`nginx_audit_scan.sh`) bir `server` bloğundaki birden çok
`server_name` direktifinden yalnız **sonuncusunu** saklar (`listen`'leri birleştirir, `server_name`'i
ezer). nginx aynı bloktaki direktiflerin adlarını biriktirir; önceki direktiflerdeki adları
(`server_name www.ornek; server_name odeme.ornek;` → yalnız `odeme.ornek`) Host başlığı üretim kapısı
**görmez**: yalnız PROD'da tanımlı böyle bir ad 409 yerine serbestte "taramada yok" uyarısına düşer,
sunucu kipinde hiç uyarı çıkmaz. Düzeltme tarayıcıdadır (Portal tek başına göremez); ayrı tarayıcı
görevi olarak izleniyor.

Yalnız serbest hedefte, ön kontrolde üretilip satıra yazılan (`plan_uyarilari`) ve koşuda **onay
isteyen** plan uyarıları:

* Host başlığı son taramada hiçbir sunucunun `server_name` listesinde yok (LB / yönetilmeyen sunucu bu
  adı nereye yönlendirecek bilinmiyor);
* Host başlığı üretim / EDU / bilinmeyen sunucularda **da** tanımlı (LB ya da reverse proxy adı üretim
  havuzuna yönlendirebilir; VIP'in havuzunu doğrulayın);
* Host başlığı yük sunucusunun kendi `server_name` listesinde (VIP'in havuzunda yük sunucusu da
  olabilir; yükün bir kısmı kendi nginx'ine döner — mümkünse başka yük sunucusu seçin);
* Yük sunucusu bir internet reverse proxy'si (hedef VIP'in havuzunda kendisi de olabilir).

Ekran ve onay aynı listeyi görür (`GET /kosular/:id` plan uyarılarını ön kontrol uyarılarının
başına koyar). Koşu anında yeniden kurulan planda saklanmayan bir uyarı varsa 409 `on_kontrol_eski`:
"Ön kontrolden bu yana yeni uyarı çıktı (…); ön kontrolü yeniden çalıştırın." Kaybolan uyarı engel
değildir.

Sabit uyarılar (her zaman onay ister): serbest hedefte "Serbest hedef: sunucu tarafı ölçüm (CPU,
nginx logu) yapılmaz; … başka kullanıcılar 429 alabilir." (LB arkasında nginx isteği LB'nin IP'sinden
görür: IP başına 500 istek/sn ve 200 bağlantı sınırı LB arkasındaki herkesle, vhost başına 5000
istek/sn sınırı tüm istemcilerle paylaşılır); wrk'de "wrk kapalı döngüdür: … wrk sonuçları k6
sonuçlarıyla karşılaştırılmaz."

### 4.4 Kilitler: iş bitti ≠ yük bitti

Anahtarlar: `G|global` (aynı anda tek koşu), `T|<HEDEF>` (sunucu hedefi), `T|IP:<ip>` (serbest hedef),
`L|<YUK>` (yük makinesi). Sunucu hedefinde ön kontrol `T` + `L`, koşu `G` + `T` + `L`; **serbest
hedefte ön kontrol de** `G` alır (`G` + `T|IP:` + `L`): serbest ön kontrolün istekleri VIP
arkasındaki bir hostun ölçüm penceresine girmesin. **VIP arkasındaki hostlar `T` kilidiyle
korunmaz** (Portal VIP'in havuzunu bilmez). Dolu kilit mesajı kimin hangi işi tuttuğunu söyler
(`ön kontrol 10.20.30.40 (serbest) <- GBNGXT34 (wrk)`).

AWX iptali (`canceled`) ya da hatası (`error`, ör. execution node kaybı) uzaktaki async
`kos.sh`/k6'yı, `wrk_kos.sh`/wrk'yi ve ayrık CPU kaydediciyi **durdurmaz**. Kilit bu yüzden yalnız "AWX
işi bitti" diye bırakılmaz; bağlı işin türüne (`bag_turu`) ve AWX durumuna göre karar verilir
(`kilit.cjs` `bagliIsKarari`, tek kural; sonuçlandırıcı, kilit süpürmesi ve yeni kilit alma aynı
kuralı kullanır):

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
  süre en az `bütçe + 180 sn` olur. Durdurma işi yalnız kalan süreç yoksa başarılı biter; o zaman
  kilitler hemen bırakılır, aksi halde süre dolunca. AWX iptali başarısızsa (koşu işi hâlâ
  çalışıyor olabilir) kilitler koşu işinde kalır.
* Koşu başlatılırken satır bu arada `CANCELED` (eski yarım satırı durduran istek) ya da `FAILED`
  (bayat kuyruk) olduysa başlatılan iş hemen iptal edilir; kilitler o işe bağlı kaldığı için kural
  süreyi bekler.
* Kilit alınırken Portal DB hatası (deadlock kurbanı, bağlantı kopması; ör. `G|global` alındıktan
  sonra `T|…` satırında) 424 `db_okunamadi` "İş kilidi alınamadı; iş başlatılmadı, lütfen tekrar
  deneyin." döner ve istek o ana kadar aldığı kilitleri **bırakır** (yalnız kendi `lock_id`'li dolu
  satırlar; başka işin kilidine dokunulmaz). Bırakma da DB hatası alırsa (DB hâlâ erişilemiyorsa)
  kilit, kilit süresi (varsayılan 75 dk) dolunca düşer; o süre içinde tekrar deneyen istek
  `kilit_dolu` alır ve Portal günlüğüne uyarı yazılır.

---

## 5. Durumlar ve analiz

```
QUEUED → RUNNING → FINALIZING → DONE | FAILED | CANCELED | OKUNAMADI
```

* **OKUNAMADI başarı değildir.** AWX "successful" dese de set_stats sonucu yoksa, sonuç başka bir
  koşuya aitse (`run_id` / `islem`, ya da metin olarak yayınlanmış `hedef_turu` / `motor` satırdan
  farklıysa) ya da `/sw` koşu dizini okunamıyorsa koşu `OKUNAMADI` olur. Yayınlanmamış (null) tür /
  motor yankısı denetlenmez: girdi reddinde playbook'un "girdi reddedildi ..." metni kaybolmaz.
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
  `DONE` olur, `GECERLI` analiz `KISMI`'ye iner (neden: "koşu erken durdu (DUR)", ve sıfır olmayan
  çıkış kodu `kos.sh rc=<n>` ya da wrk'de `wrk_kos.sh rc=<n>`). `canceled` her zaman `CANCELED`'dır.
* Başarısız bir işin okunabilen sonucu yazılır ama geçerliliği en iyi `KISMI` olur.
* Playbook koşu bölümünü yayımladı ama `sw_dizin` bildirmediyse `/sw`'ye hiç veri kopyalanmamıştır
  (yük başlamadı ya da kopya düştü): dizin **okunmaz**, koşu `FAILED` + `GECERSIZ` olur
  ("yük başlamadı ya da sonuçlar /sw'ye kopyalanmadı (playbook sw_dizin bildirmedi)"). Sunucu
  kipinde koşu kapısı ("kosu kapisi: hedef IP ... hedefte yerel degil ya da olculemedi") ve serbest
  kipte izin dosyası reddi ("serbest izin listesi: ...; yuk gonderilmedi") bu yoldan görünür.
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

### 5.1 Serbest hedef ve wrk analizi

Analiz koşunun türünü ve motorunu **koşu satırından** alır (set_stats yankısından değil).

* **Serbest hedef**: sunucu kesitleri ve nginx logu yok sayılır; CPU-ms/istek, sunucu istek hızı,
  sunucu yanıt süreleri, host CPU ve kapasite boştur (asla 0). Ölçüm penceresi kurulmaz
  (`pencere_kaynak` `-`). Geçerlilik yalnız istemci kurallarından (çıkış kodu, 429, 5xx, HTTP/2, hata
  oranı; k6'da düşen istek → DOYMA).
* **wrk**: yüzdelikler wrk'nin koordineli ihmal düzeltmeli dağılımıdır; `dropped` ölçülmez (DOYMA
  yalnız sunucu kipinde host CPU > %90'dan). TLS 1.2'ye sabitlenemediği ve oturum devamı olabildiği
  için TLS payı / ayrıştırma (`ozet.ayristirma`, `ozet.cpu_tlsli_pay`) wrk'te her zaman boştur.
  `bayt_istek` TLS hariç başlık + gövdedir (k6'nın `data_received`'ından farklı anlam). Kademe birimi
  bağlantıdır.

**Yeni koşu uyarıları** (koşu düzeyi; ekran ham kodla, genel uyarı listesinde gösterir):

| Uyarı | Anlamı |
|---|---|
| `sunucu_olcumu_yok(serbest_hedef)` | Serbest hedef: sunucu tarafı ölçüm (CPU kaydedici, nginx logu) yapılmadı; sonuçlar yalnız istemci ölçümü. Sunucu kipindeki `sunucu_kaydi_yok(cpu_olculmedi)` ve `sunucu_logu_yok(...)` uyarılarının **yerine** yazılır. |
| `serbest_kosuda_sunucu_dosyalari_yok_sayildi(<n>)` | Serbest koşunun dizininde yine de `<n>` sunucu dosyası (`sunucu_*`, `bilgi_*`, `log_*`, `diger_*`) bulundu ve analizde **yok sayıldı** (serbest koşu sunucu ölçümü kullanmaz). |
| `wrk_tls_payi_hesaplanmaz(oturum_devami_ya_da_tls13_olabilir)` | wrk koşusunda en az bir adımın kipi `yeni`: wrk TLS sürümünü sabitleyemez (1.3 olabilir) ve oturumu devam ettirebilir; `K/yeni/br − K/ka/br` farkı TLS payını küçük gösterirdi, hesaplanmaz. |

Serbest koşuda sunucu verisine dayanan adım uyarıları (`log_satiri_yok:pencere_istemci_saatinden`,
`sunucu_kaydi_yok`, `sunucu_logunda_bu_tur_yok`, `pencerede_ornek_yok`, `arka_plan_*`) **yazılmaz**.

**Geçersizlik nedeni biçimleri** (adım `nedenler`; ekran ham gösterir):

| Neden | Anlamı |
|---|---|
| `wrk_rc=<rc>` | wrk hata koduyla bitti (zaman.csv çıkış kodu; k6'da aynen `k6_rc=<rc>`). İş çıktısındaki wrk mesajına bakın; koşuyu tekrarlayın. |
| `429(istemci=<n>)`, `5xx(istemci=<n>)` | Serbest hedefte yalnız istemci sayısı: sunucu sayısı **ölçülmedi** (0 değil), nedende `sunucu=` yoktur. Sunucu kipinde biçim değişmez: `429(istemci=<n>,sunucu=<m>)`. |
| `hatali_kosu(kos.sh_durdurdu)` | Metin wrk'te de aynen: TUR'u `wrk_kos.sh` durdurduysa da (429 / 5xx / soket / hata oranı / hata kodu / ölçüm yok). |

**Karşılaştırma (kararVer)** — ilk satır (`referans=.. aday=.. senaryo=.. kip=.. ae=..`) değişmez; hemen ardından:

* motorlar farklıysa `VERI_YOK`: `farkli yuk araci: referans <m>, aday <m>; k6 (acik dongu, istek/sn) ve wrk (kapali dongu, baglanti) sonuclari karsilastirilmaz`;
* iki wrk koşusunun iş parçacığı sayısı farklıysa (ikisi de biliniyorsa) `VERI_YOK`: `farkli is parcacigi sayisi: referans <t>, aday <t>; ayni is parcacigi sayisiyla yeniden kosun`;
* iki wrk koşusunun hız tavanı (`parametreler.tavan_rps`) farklıysa (ikisi de biliniyorsa; CPU'suz yolda da) `VERI_YOK`: `farkli hiz tavani: referans <a> istek/sn, aday <b> istek/sn; ayni tavanla yeniden kosun`. Aynı bağlantı kademesi farklı tavanla farklı sunulan yük demektir (bekleme `d = ceil(N × 1000 / tavan)`): düşük tavanlı koşunun p95'i düşük çıkar ve sahte `KALICI` / `RET` doğardı. Tavan, hedefin ölçülmüş `limit_req`'i değişince, tarama verisi eksik olunca (450'ye çıkar) ya da sunucu (≤ 450) ile serbest (200) hedef karşılaştırılınca farklılaşır.

Sonra bugünkü sıra: kademe grubu yoksa `VERI_YOK`; adayda hata / 429 / 5xx artışı `RET` ("hata artti");
yeterli geçerli koşu yoksa `GECERSIZ`. wrk'te metinlerin kademe birimi `baglanti` (`<n> baglanti
kademesinde ...`, `ortak baglanti kademesi yok`); bayt satırının istemci yedeğinde etiket `istemci (wrk):
baslik + govde, TLS haric`.

**CPU'suz karar yolu (K25)** şu iki durumda girilir:

1. taraflardan biri **serbest** hedefte (CPU bloğundan önce);
2. iki taraf da **wrk** ve CPU kademesinde bir tarafın CPU-ms/istek'i **doyma dışı** bir nedenle (sunucu
   kaydı eksik) yok. Doyma yüzünden yoksa bugünkü gibi `DOYMA` ("daha düşük bir kademeyle tekrar koşun").

Bu yolda ortak kademelerde bugünkü p95 zarar hesabı yapılır (aynı eşik ve gürültü formülü, aynı `p95 @..`
satırları; bayt ve B TTFB satırları bilgi amaçlı): zarar varsa `RET` (`zarar: ...`), yoksa `NOTR` +
`CPU olculmedi (serbest hedef): KALICI verilmez; karar p95 ve hata oranina gore` ya da `CPU olculmedi (wrk,
sunucu kaydi eksik): KALICI verilmez; karar p95 ve hata oranina gore`. CPU kazancı ve p95 kazancı
kuralları CPU ölçüsü istediği için bu yol **ASLA `KALICI`** ve CPU kaynaklı `VERI_YOK` vermez (ortak
kademe yoksa yalnız `VERI_YOK` `ortak <birim> kademesi yok`). Ekran bu yolda karar başlığında "CPU
kademesi" yazmaz.

**k6 + k6, sunucu + sunucu** karşılaştırması tur 2 ile **birebir** aynıdır: CPU eksikse `VERI_YOK` ya
da `DOYMA` (karsilastir.py diferansiyel eşdeğerliği korunur; D4'ün "CPU yoksa asla KALICI" özü burada
da geçerlidir — `VERI_YOK` KALICI değildir).

---

## 6. API

Taban `/api/nginx-loadtest`. Yanıt `{ ok: true, ... }` ya da `{ ok: false, message, code }` (IP
retlerinde ayrıca `sahipler`).

| Uç | Erişim | Not |
|---|---|---|
| `GET /hedefler` | okuma | hedefler (uygun / değil + neden, aday IP, vhost önerileri, ölçülen tavanlar), yük makineleri, sınırlar (`baglantiMin`, `maxBaglanti`, `maxBaglantiSayisi`, `isParcacigiMin`, `maxIsParcacigi`, `serbestTavanRps`, `serbestMaxBaglanti` dahil), varsayılanlar (`motor`, `baglantilar`, `is_parcacigi`, `serbest: { hizlar, maxvu }` dahil), `serbest: { acik, aglar }` (`aglar` yalnız Admin'e dolu), `motorlar: ['k6', 'wrk']` |
| `GET /ip-sinifi?ip=&yukHost=&hedefHost=` | Admin | yazılan IP'nin sınıfı; DB'ye ve denetime **yazmaz**. `ip` zorunlu, iki host isteğe bağlı (verilmiş ama geçersizse 400; `yukHost` yoksa `ayni_host` denetimi atlanır). Sunucu: `{ ok, tur: 'sunucu', ip, host, env, vhostlar, vhostVerisi, hizSiniri, vuSiniri, uygun, neden, kod, kaynaklar }` (`uygun: false` da 200'dür: ön kontrol yapılamaz); serbest: `{ ok, tur: 'serbest', ip, host: null, ag, digerSahipler: [{ host, env }] }`; ret: §4.1 kodları (400 / 409 / 424) + `sahipler` |
| `GET /senaryolar`, `GET /senaryolar/:id` | okuma | `:id` TSV'yi ve özeti de döner |
| `POST /senaryolar`, `DELETE /senaryolar/:id` | Admin | silme yumuşaktır |
| `POST /kosular/on-kontrol` | Admin | `{ senaryoId, hedefHost?, hedefIp, vhost, yukHost, sni, parametreler, etiket? }` → `{ kosuId, jobId, awxServerId }`. `hedefHost` isteğe bağlı (`undefined` / `null` / `''` = yazılan IP sınıflandırılır). `parametreler.motor` `'k6'` (varsayılan) ya da `'wrk'`; k6: `hizlar`, `maxvu`; wrk: `baglantilar`, `is_parcacigi`; ortak `tekrar`, `isinma`, `sure`, `bosluk`, `bosta`, `kip`, `ae`. `tavan_rps` gönderilse de yok sayılır (sunucu hesaplar). |
| `POST /kosular` | Admin | `{ onKontrolKosuId, confirmText, uyariOnay }` — `confirmText` sunucu hedefinde host adı, serbest hedefte hedef IP |
| `GET /kosular?islem=&durum=&hedef=&ip=&hedefTuru=&motor=&onceki=&limit=` | okuma | `islem` ∈ `kosu`, `on_kontrol`; `durum` ∈ `QUEUED`, `RUNNING`, `FINALIZING`, `DONE`, `FAILED`, `CANCELED`, `OKUNAMADI`; `hedef` = sunucu adı; `ip` = hedef IPv4; `hedefTuru` ∈ `sunucu`, `serbest`; `motor` ∈ `k6`, `wrk`; `onceki` = koşu no (yalnız `id < onceki`, "daha eski" sayfası); `limit` 1..200 (varsayılan 50). Sıra `id` azalan. Yanıtta `dahaVar` (limit + 1 satır çekilir). Satırlarda `hedefTuru`, `motor`, `hedefHost` (serbestte `null`). Geçersiz değer (ya da tekrarlanan parametre) → 400 `gecersiz_istek` |
| `GET /kosular/:id` | okuma | ayrıntı: parametreler, `hedefTuru`, `motor`, ön kontrol özeti + engel / uyarı listesi (`onKontrolUyarilari` = plan uyarıları başta + ön kontrol uyarıları), `planUyarilari` (ön kontrol satırınınki), `serbestAg` (serbest satırda Portal izin listesinde **şu an** eşleşen ağ ya da `null`), geçerlilik nedenleri, adımlar; `durdurIsi: { awxServerId, awxJobId } \| null` (son durdurma işi), `sonuclandirmaDenemesi` (sonuçlandırma deneme sayısı) |
| `GET /kosular/:id/durum?since=` | Admin | maskeli iş çıktısı; `since` = elinizdeki metnin uzunluğu → yalnız devamı (`outputOffset`, `outputLength`) |
| `POST /kosular/:id/durdur` | Admin | AWX iptali + (koşu) `durdur` kipi. Başarı: `{ ok, iptal, iptalHatasi, durdurIsi: { jobId, awxServerId } \| null, durdurHatasi: null }`. 409 `baslatiliyor`, 409 `kosu_bitti`, 424 `durdur_baslatilamadi` (gövdede `iptal`, `iptalHatasi`, `durdurHatasi`; metin motor ve türe göre), 424 `awx_okunamadi` (ön kontrol iptal edilemedi) |
| `POST /kosular/:id/yeniden-oku` | Admin | sonucu okunamamış koşuyu yeniden sonuçlandırır → `{ ok: true }`; değilse 409 `yeniden_okunamaz` |
| `GET /karsilastir?ref=&aday=&esikCpu=&esikP95=` | okuma | karar, nedenler, tablo, kademe, kombinasyon; `ref` / `aday` özetinde `motor`, `hedefTuru` |

---

## 7. Sorun giderme

| Belirti | Neden / yapılacak |
|---|---|
| 409 `awx_prompt_on_launch_disabled` | Template'te "Prompt on launch → Variables" kutusunu işaretleyin. |
| 409 `sablon_yok` | Admin › Playbook Kayıtları › `nginx_loadtest_run`: satır var mı, açık mı, Template ID dolu mu. |
| 409 `kilit_dolu` uzun süre | Kilidin işi başarıyla bitmişse bir sonraki denemede bayat kilit devralınır. Koşu AWX'ten iptal edildiyse ya da `error` ile bittiyse kilit **bilerek** süre dolana kadar (en az bütçe + 180 sn) tutulur: uzaktaki k6 / wrk sürüyor olabilir. Koşuda **Durdur**'a basın; durdurma işi başarıyla biterse kilit hemen bırakılır. AWX okunamıyorsa kilit TTL (75 dk) dolunca düşer. Mesaj kimin hangi işi tuttuğunu söyler; mesajda AWX iş numarası yoksa ve Portal günlüğünde `kilit birakilamadi (TTL ile dusecek)` satırı varsa, iş hiç başlamadı ama kilit DB hatası yüzünden bırakılamadı: TTL dolunca düşer. Serbest ön kontrol de `G|global` aldığı için başka bir koşu ya da serbest ön kontrol sürerken bekler. |
| 424 `durdur_baslatilamadi` | Koşunun AWX işi iptal edildi (ya da edilemedi) ama durdurma işi başlamadı (template, preflight, AWX 5xx). Uzaktaki k6 / wrk / kaydedici sürüyor olabilir: Durdur'u yeniden deneyin. |
| 409 `baslatiliyor` | Koşu AWX'e gönderiliyor; birkaç saniye sonra Durdur'u yeniden deneyin. |
| 424 `envanter_okunamadi` | TBMWANS erişimi ya da `dbo.nginx_inventory` yeniden yükleniyor (TRUNCATE + yükleme); birkaç dakika sonra deneyin. Serbest hedefte son nginx taraması (`dbo.Nginx_Audit_Servers`) ya da dolu `dbo.IPInventory` de gerekir. |
| 424 `envanter_bayat` | `dbo.IPInventory` son yükleme 48 saatten ya da son nginx taraması 2 günden eski: IPInventory yükleyicisini ve nginx tarama işini kontrol edin (metinde son tarihler var). |
| 409 `serbest_kapali` | IP envanterdeki bir nginx sunucusuna ait değil ve `NGINX_LOADTEST_SERBEST_AGLAR` boş (ya da hiç geçerli girdisi yok — log'daki "girdisi kullanilmadi" satırlarına bakın). |
| 409 `ip_izinli_agda_degil` | IP izinli ağların dışında, ya da /30 ve altı bir ağın ağ / yayın adresi. Listeye IP'yi `/32` olarak ya da VIP alt ağını `/24` olarak ekleyin; /24'ten geniş girdi atılır. |
| 409 `ip_yasakli_agda` / `ip_yasak_listesi_gecersiz` | IP `NGINX_LOADTEST_SERBEST_YASAK`'taki bir ağda; ya da yasak listesinde geçersiz bir girdi var ve liste düzeltilene kadar **hiçbir** yük testi yapılamaz (mesajda ilk geçersiz girdi). |
| 409 `ip_belirsiz` | Yazılan IP birden çok nginx sunucusunda (paylaşılan VIP) ya da nginx sunucusu + başka bir envanter kaydında görünüyor: hedef sunucuyu host seçiciden seçin. |
| 409 `ip_sahibi_cozulemedi` | IP'nin sahiplerinden birinin adı envanterde çözülemiyor (ör. `dbo.IPInventory`'de boş ya da kurala uymayan host). Host seçici yolu da kapanır; envanter satırını düzeltin. |
| 409 `hedef_uretim` (IP sahibi) | IP'yi bir PROD / EDU / ortamı bilinmeyen kayıt da kullanıyor (nginx olmayan bir sunucu da olabilir); mesaj hangi host olduğunu söyler. Yük testi yapılmaz. |
| 409 `host_uretim` | Host başlığı son taramada yalnız üretim / EDU / bilinmeyen sunucularda tanımlı. Non-prod bir adla deneyin. |
| 409 `on_kontrol_eski`: "Hedef IP'nin sınıfı ön kontrolden bu yana değişti" / "Ön kontrolden bu yana yeni uyarı çıktı" | Ön kontrolden sonra envanter, tarama ya da izin listesi değişti (IP bir sunucuya atandı, Host başlığı başka yerde tanımlandı). Ön kontrolü yeniden çalıştırın; yeni uyarıları onay penceresinde görürsünüz. |
| 409 `on_kontrol_eski`: "Parametreler ön kontrolden bu yana değişti" dağıtımdan hemen sonra | Dağıtımdan önce alınmış (motor'suz) ön kontrol; bir kez yeniden çalıştırın. Hedefin ölçülmüş `limit_req`'i değiştiyse wrk tavanı da değişir — aynı mesaj. |
| Karşılaştırma `VERI_YOK`: "farkli hiz tavani: referans … istek/sn, aday … istek/sn; ayni tavanla yeniden kosun" | İki wrk koşusu farklı tavanla alınmış (limit_req değişikliği, eksik tarama verisi, farklı hedef ya da sunucu ↔ serbest): aynı bağlantı kademesi farklı yük demektir. Referansı ya da adayı aynı tavanla (aynı hedef sınırı / aynı hedef türü) yeniden koşun; koşu ayrıntısındaki parametrelerde `tavan_rps` görünür. |
| Ön kontrol FAIL: "serbest izin listesi: …" | Yük makinesindeki `/etc/portal_yuktesti/serbest_aglar` yok, sahibi www, grup / diğer yazabiliyor, 16 KB / 64 girdi üstü, geçersiz satır var ya da IP listede değil (§2.2). Dosya Portal listesinin alt kümesi olmalı. |
| Ön kontrol engeli "hedef IP yük makinesinde yerel ya da ölçülemedi" | Serbest hedef IP yük makinesinin kendi adresi ya da yük makinesi IP'leri okunamadı; başka bir yük makinesi seçin. |
| Ön kontrol engeli "wrk yük makinesinde çalışıyor ama sürümü okunamadı ya da 4 altında" | wrk `VER`'siz derlenmiş (`wrk  [epoll] ...`) ya da eski: `make VER=4.2.0 WITH_OPENSSL=/usr` ile yeniden derleyin (§2.2). |
| Ön kontrol engeli "wrk yük makinesinde bulunamadı ya da çalıştırılamıyor" | `/home/www/bin/wrk` (ya da `NGINX_LOADTEST_WRK`) yok ya da www çalıştıramıyor (`install -m 0755`). |
| wrk koşusu DUR "soket hatasi esigi asildi" | Hedef ya da LB bağlantıları reddediyor / kesiyor. wrk SNI olarak IP gönderir; katı bir TLS profili el sıkışmayı reddedebilir (ön kontroldeki curl IP'de SNI göndermediği için geçer). |
| wrk koşusu DUR "429 alindi" / "sunucu hatasi alindi" | IP başına rate limit aşıldı ya da hedef 5xx dönüyor: bağlantı sayılarını düşürün; aynı IP'den başka yük var mı bakın. Ortalama hız tavanın altındayken 429 geliyorsa yolun `limit_req` burst'ü bağlantı sayısından küçük ya da burst'süz: istekler anlık kümelenir (§3 adım 3). O yolda k6 kullanın ya da daha az bağlantıyla koşun. |
| İş "is gecerlilik suresi dolmus ya da gecersiz" ile reddedildi | İş AWX'ten yeniden başlatıldı (Relaunch) ya da AWX kuyruğunda 15 dk'dan uzun bekledi. Portal'dan yeniden başlatın; AWX'ten Relaunch yapmayın. |
| Koşu FAILED: "kosu kapisi: hedef IP ... hedefte yerel degil" | IP ön kontrolden sonra hedeften ayrıldı (paylaşılan VIP başka hosta geçti — keepalived) ya da hedef değişti; kaydedici ve yük başlatılmadı. Ön kontrolü yeniden çalıştırın. |
| Koşu `OKUNAMADI` | `/sw/.../nginx_loadtest/<koşu>/` dizinini, `SHA256SUMS`'ı ve AWX'te `nginx_loadtest_result` set_stats'ını kontrol edin (playbook toplama adımı). Düzelttikten sonra ekranda **Sonucu yeniden oku** (`POST /kosular/:id/yeniden-oku`). Yeniden okuma önce AWX işine bakar: iş AWX'ten silinmişse (saklama süresi) koşu "AWX iş #N artık yok" ile yine `OKUNAMADI` kalır. "yayınlanan sonuç bu koşuya ait değil (hedef_turu …)" ise playbook başka bir tür / motor yayınlamış: iş başka bir koşunun. |
| Koşu uzun süre `FINALIZING` | `/sw` okuması hata veriyor; sonuçlandırıcı en çok 3 kez dener (ekranda "deneme N/3"), sonra son kararı yazar. |
| Koşu `OKUNAMADI`: "satir tavani asildi" ya da "64'ten fazla farkli TUR" | Koşu dizininde Portal koşusuna benzemeyen veri var (§5 okuyucu tavanları): `/sw` dizinine dışarıdan yazılmış ya da bozulmuş dosya. `bilgi_*.txt`'teki `log=` satırları sayılmaz (hedefte yüzlerce log dosyası olabilir). |
| Hedef "limit_req 2 r/s'nin altında" diye gri | Hedefte IP anahtarlı çok sıkı bir `limit_req` (ör. giriş sayfası için `1r/s`) ya da `limit_conn 1` uygulanıyor; bu hedefe yük testi yapılamaz (iki motorda). |
| "Durdur" iş kuyrukta bekliyor | Template'te "Enable Concurrent Jobs" kapalı. |
| `ip_hedefte_yok` ama IP doğru | IP hostun en son nginx tarama gününde (Nginx_Audit_Servers `listen`; bir bloktaki **her** `listen` sayılır) ya da `dbo.nginx_inventory.ip`'de olmalı; yalnız `dbo.IPInventory`'de görünen ikincil IP sunucu hedefi olarak kabul edilmez. IP dün bu hostta dinlenip bugünkü taramada yoksa (taşındı) aday değildir. Tarama eskiyse önce taramayı tazeleyin. |
| Host başlığı uyarısı "server_name'ler arasında yok ya da ölçülemedi" | Ad hedefin `nginx -T` çıktısında yok: joker / regex `server_name` olabilir (beklenen) ya da istek `default_server`'a düşer — ön kontroldeki 200 sonuçlarına bakın; uygunsa onaylayıp başlatın. |
