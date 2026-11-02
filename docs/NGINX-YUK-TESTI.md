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
| Ekran | `src/components/nginx_console/YukTestiTab.tsx`, `src/components/nginx_console/yukTesti/` (Araçlar paneli: `yukTesti/Araclar.tsx`) |
| API | `server/nginx-loadtest/index.cjs` → `/api/nginx-loadtest/*` |
| Kapılar (girdi, IP sınıflandırması, ortam, sınırlar) | `server/nginx-loadtest/dogrula.cjs` |
| Kilit (`nginx_loadtest_kilitleri`) | `server/nginx-loadtest/kilit.cjs` |
| AWX başlatma | `server/nginx-loadtest/baslat.cjs` |
| Sonuçlandırıcı (sunucu tarafı) | `server/nginx-loadtest/poller.cjs` |
| Yük araçları (k6 + wrk arac setleri: sabit arşiv özetleri, hazırlama, geri çekme, etkin set kapısı, sonuçlandırma) | `server/nginx-loadtest/araclar.cjs` |
| Sonuç dizini okuma / analiz | `server/nginx-loadtest/sonuc.cjs`, `server/nginx-loadtest/analiz.cjs` |
| Playbook | Ansible deposu `bmw_portal/nginx_loadtest/nginx_loadtest.yml` (+ `files/`: `kos.sh`, `yuk_k6.js`, `cpu_kaydedici.sh`, `on_kontrol.sh`, `durdur.sh`, `wrk_kos.sh`, `yuk_wrk.lua`, `arac_hazirla.sh`; `README.md`); Portal aynası `server/ansible/bmw_portal/nginx_loadtest/` |
| Tablolar | `nginx_loadtest_senaryolar`, `_kosular`, `_adimlar`, `_kilitleri`, `_araclar` — bkz. [DATABASE.md](DATABASE.md) |
| Bekçiler | `server/nginx-loadtest/__tests__/` (dogrula, kilit, kapi, poller, sonuc, analiz, araclar) |

---

## 2. Devreye alma

### 2.1 AWX job template'i

Tek template, dört kip: playbook `yuk_islem` ile `on_kontrol` (yük yok), `kosu`, `durdur` ve
`araclar` (yük araçlarını /sw'ye hazırlar, yalnız Admin; §2.2) çalışır.

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
  aynı olmalı (bekçi denetler). Playbook her kipte `files/` altındaki sekiz betiğin hepsini arar:
  zip'te `wrk_kos.sh`, `yuk_wrk.lua` ya da `arac_hazirla.sh` eksikse **her kip** "files/ altindaki
  betiklerden biri yok (AWX proje kopyasi eksik); hicbir sey yapilmadi" ile düşer.
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

### 2.2 Yük araçları (k6, wrk) ve serbest hedef izin dosyası

**Yük araçları: elle kurulum YOK**

k6 ve wrk yük makinelerine **kurulmaz**. Admin, Yük Testi › **Araçlar** bölümünden **"Araçları
hazırla"** ile aynı AWX şablonunu `yuk_islem='araclar'` kipinde başlatır (§3 "Araçlar"):

1. Derleme makinesi (varsayılan **GBLABT02**; Admin `NGINX_LOADTEST_DERLEME_HOSTLARI` listesinden seçer)
   `www` olarak, www ev dizinindeki geçici bir derleme dizininde (`/tmp` **değil**: `/tmp` noexec)
   çalışır. Kurumsal vekil (`NGINX_LOADTEST_ARAC_PROXY`, kimlik bilgisi yok) **yalnız üç indirme
   görevinde** kullanılır; derleme vekilsiz koşar. TLS doğrulaması kapatılmaz: vekil TLS'i açıyorsa
   kurum CA'sı derleme makinesinin güven deposunda olmalı.
2. **k6** — resmî sürüm arşivi (`k6-<sürüm>-linux-amd64.tar.gz`) ve resmî `k6-<sürüm>-checksums.txt`
   indirilir; arşiv, açılmadan önce Portal'da **sabitlenen** `NGINX_LOADTEST_K6_ARSIV_SHA256` ile
   (ve checksums satırıyla) doğrulanır; tutmazsa hiçbir şey açılmaz ya da çalışmaz. Sürüm varsayılan **v0.49.0**
   (`yuk_k6.js` ve kitin yazıldığı sürüm; `kos.sh` alt sınırı v0.45; resmî Go ikilisi statiktir, RHEL
   8 / 9 farkı etkilemez). `NGINX_LOADTEST_K6_SURUM` ile v0.45.0..v0.59.x seçilebilir; **1.x
   desteklenmez** (uç özet biçimi değişti, burada doğrulanamaz).
3. **wrk 4.2.0** — `github.com/wg/wrk` 4.2.0 etiket arşivi indirilir, açılmadan / derlenmeden önce
   Portal'da **sabitlenen** `NGINX_LOADTEST_WRK_KAYNAK_SHA256` ile doğrulanır (tutmazsa iş düşer,
   hiçbir şey derlenmez) ve varsayılan Makefile ile
   `make VER=4.2.0` derlenir: paketli OpenSSL 1.1.1 ve LuaJIT 2.1 **statik** bağlanır, ikili yalnız
   glibc'ye bağlıdır (`WITH_OPENSSL` verilmez; `-march` yok). Betik ikilinin sistem `libssl` /
   `libcrypto` / `libluajit`'e bağlı olmadığını `ldd` ile doğrular. **Kabul edilen risk:** paketli
   OpenSSL 1.1.1'in desteği bitti (EOL, 2023-09); yalnız iç TEST hedeflerine giden bir istemcide
   kullanılır (sunucu tarafı yok), sürüm dizesi set kaydında (`wrk_openssl`) görünür.
4. İki ikili `<NGINX_LOADTEST_DIR>/araclar/<id>/` altına yazılır (`k6`, `wrk` **0644**, yani /sw'den
   doğrudan çalıştırılamaz; ayrıca insan için `SHA256SUMS` ve `manifest.json`). Yazım `www` ile
   değil, bugünkü sonuç kopyası gibi kontrol düğümünden GBLABT02 üzerinden yapılır; önce `.<id>.yarim`
   dizinine yazılır, `mv -T` ile adı değiştirilir ve geri okunup sha256 ile doğrulanır.
5. Portal iki sha256'yı (ve arşiv / kaynak özetlerini, derleme makinesinin RHEL ve glibc sürümünü,
   wrk'nin gerektirdiği en yüksek glibc sembolünü) `nginx_loadtest_araclar` tablosuna yazar. **Güven
   kökü Portal'dır**: yük makinesi /sw'deki `SHA256SUMS` / `manifest.json`'a güvenmez.

Her **ön kontrol ve koşu** seçilen motorun ikilisini /sw'deki etkin setten koşu dizinine
(`<www ev>/.portal_yuktesti/<koşu>/arac/<k6|wrk>`, 0700) kopyalar, sha256'sını **yalnız Portal'ın
gönderdiği değerle** karşılaştırır; doğrulanmayan kopya **hiç çalıştırılmadan** silinir. İş bitince
(Durdur dahil) `arac/` dizini silinir. Yük makinelerine kalıcı bir şey kurulmaz.

* **Eski elle kurulumlar** (`/home/www/bin/k6`, GBLABT02'deki wrk) yerinde kalır ama **kullanılmaz**;
  `NGINX_LOADTEST_K6` / `NGINX_LOADTEST_WRK` artık okunmaz.
* **Derleme makinesi ve RHEL 8 / 9:** RHEL 9'da derlenen wrk glibc ≥ 2.34 sembolleri isteyebilir ve
  RHEL 8 (glibc 2.28) yük makinelerinde **çalışmaz**. Panel bunu önceden uyarır; ön kontrol "glibc
  uyumsuz" engeliyle bildirir. Tüm yük makinelerinde çalışması için listeye bir RHEL 8 DEV / TEST / QA
  nginx makinesi ekleyip araçları orada hazırlayın. GBLABT02'nin RHEL sürümü ilk işte kaydedilir.
* **Arşiv özetleri sabittir (ilk kullanımda güven YOK):** iki arşivin sha256'sı Portal ortamında
  (`NGINX_LOADTEST_K6_ARSIV_SHA256`, `NGINX_LOADTEST_WRK_KAYNAK_SHA256`; tam 64 hex) **verilmek
  zorundadır**; nasıl hesaplanacağı aşağıda ("Arşiv özetlerini sabitleme"). Biri eksik ya da geçersizse
  "Araçları hazırla" 409 `arac_ozet_sabit_yok` ile reddedilir (iş, kilit, kayıt yok) ve **hiçbir set
  kullanılmaz** (ön kontrol / koşu 409 `araclar_ozet_sabit_yok`). Panelde Admin onayı yoktur.
* **Etkin set** Portal DB'dendir: en yeni başarılı (DONE), **geri çekilmemiş** ve arşiv özetleri **şu
  anki** env değerleriyle aynı olan set. Env'deki özetler değişirse eski setler kendiliğinden devre
  dışı kalır (409 `araclar_ozet_degisti`: araçları yeniden hazırlayın). k6 sürümünü
  (`NGINX_LOADTEST_K6_SURUM`) değiştirirseniz o sürümün arşiv özetini de sabitleyin; aksi halde
  hazırlama düşer, mevcut set etkin kalır.
* **Geri çekme:** Admin, Araçlar bölümünden bir DONE seti **"Geri çek"** ile devre dışı bırakır (onay
  penceresi; denetime `nginx_loadtest_araclar_geri_cek` yazılır; kayıt silinmez, geri alınamaz). Etkin
  set kurala uyan bir önceki sete düşer; öyle bir set yoksa araçlar yeniden hazırlanana dek ön kontrol
  ve koşu reddedilir (409 `araclar_geri_cekildi`). Süren koşular durdurulmaz; geri çekilen setle
  yapılmış ön kontrol koşuya izin vermez (409 `on_kontrol_eski`).
* Eski set dizinleri silinmez (Admin elle siler).

**Arşiv özetlerini sabitleme** (bir kez; k6 sürümü değişince yeniden)

Operatör, **kurum vekili dışında** (vekil TLS'i açıyorsa aynı içerik görülebilir) ya da yayınlanmış
değerle karşılaştırarak iki özeti hesaplar. Playbook'un indirdiği adresler (v0.49.0 için):

```bash
# wrk 4.2.0 kaynak arşivi (GitHub etiket arşivi)
curl -fsSL -x http://tekprxv2.fw.garanti.com.tr:80 -o wrk-4.2.0.tar.gz \
  https://github.com/wg/wrk/archive/refs/tags/4.2.0.tar.gz
sha256sum wrk-4.2.0.tar.gz

# k6 v0.49.0 linux-amd64 arşivi ve resmî checksums dosyası
curl -fsSL -x http://tekprxv2.fw.garanti.com.tr:80 -o k6-v0.49.0-linux-amd64.tar.gz \
  https://github.com/grafana/k6/releases/download/v0.49.0/k6-v0.49.0-linux-amd64.tar.gz
curl -fsSL -x http://tekprxv2.fw.garanti.com.tr:80 -o k6-v0.49.0-checksums.txt \
  https://github.com/grafana/k6/releases/download/v0.49.0/k6-v0.49.0-checksums.txt
sha256sum k6-v0.49.0-linux-amd64.tar.gz
grep '  k6-v0.49.0-linux-amd64.tar.gz$' k6-v0.49.0-checksums.txt   # ayni deger olmali
```

(Vekilsiz bir ağda `-x ...` bölümünü çıkarın.) k6 değeri resmî checksums dosyasındaki satırla ve
mümkünse GitHub sürüm sayfasında yayınlanan değerle aynı olmalı; farklıysa **sabitlemeyin**. İki
değeri Portal sunucusunun `.env` dosyasına yazıp Portal'ı yeniden başlatın:

```bash
NGINX_LOADTEST_K6_ARSIV_SHA256=<sha256sum çıktısının ilk sütunu, 64 hex>
NGINX_LOADTEST_WRK_KAYNAK_SHA256=<sha256sum çıktısının ilk sütunu, 64 hex>
```

Değerler herkese açıktır (gizli değildir) ve Araçlar panelinde gösterilir. Arşiv sonradan değişirse
(GitHub etiket arşivleri geçmişte değişti) hazırlama işi "arşiv sabitlenen özetle uyuşmuyor" notuyla
düşer ve hiçbir şey derlenmez: arşivi yeniden bağımsız doğrulayın, gerçekten değiştiyse env değerini
güncelleyin. Aynı metin playbook README'sinde de vardır.

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
| `NGINX_LOADTEST_K6`, `NGINX_LOADTEST_WRK` | — | **Artık kullanılmaz** (tur 4): araçlar /sw'deki arac setinden kopyalanır; playbook'a `yuk_k6_yolu` / `yuk_wrk_yolu` olarak sabit işaret değeri (`/yeni-playbook-gerekli/k6`, `/yeni-playbook-gerekli/wrk`) gider. |
| `NGINX_LOADTEST_DERLEME_HOSTLARI` | `GBLABT02` | Araç derleme makineleri (virgül / boşluk / `;`). Her girdi `GBLABT02` ya da ad kuralına göre DEV / TEST / QA nginx adı (EDU değil); geçersiz girdi atılır (log'a bir kez); liste boş kalırsa `GBLABT02`. İlk eleman varsayılan. |
| `NGINX_LOADTEST_ARAC_PROXY` | `http://tekprxv2.fw.garanti.com.tr:80` | İndirme vekili. `yok` = vekilsiz. Yalnız `http://<ad>:<port>` (küçük harfe çevrilir); kimlik bilgisi (`@`), `https://`, yol **geçersizdir** → "Araçları hazırla" 409 `arac_proxy_gecersiz`. Adres yalnız Admin'e gösterilir. |
| `NGINX_LOADTEST_K6_SURUM` | `v0.49.0` | k6 sürümü; `v0.45.0`..`v0.59.x` dışı uyarıyla varsayılana düşer (1.x desteklenmez). |
| `NGINX_LOADTEST_K6_ARSIV_SHA256` | — (**zorunlu**) | `k6-<NGINX_LOADTEST_K6_SURUM>-linux-amd64.tar.gz` arşivinin sha256'sı; tam 64 hex (büyük harf küçültülür). Yok / geçersiz → "Araçları hazırla" 409 `arac_ozet_sabit_yok`, hiçbir set etkin değil (§2.2 "Arşiv özetlerini sabitleme"). Önceki setten devralınmaz. |
| `NGINX_LOADTEST_WRK_KAYNAK_SHA256` | — (**zorunlu**) | wrk 4.2.0 kaynak arşivinin (`https://github.com/wg/wrk/archive/refs/tags/4.2.0.tar.gz`) sha256'sı; aynı kural. Değişirse eski setler etkin olmaz (yeniden hazırlayın). |
| `NGINX_LOADTEST_SERBEST_AGLAR` | boş = **serbest hedef KAPALI** | Serbest hedef izin listesi: virgül / boşluk / `;` ayrık `a.b.c.d/n` (n **24..32**) ya da tek IP (= /32). Biçimsiz, /24'ten geniş, host bitli ya da özel aralık (0/8, 127/8, 169.254/16, 224+) girdisi **atılır** (liste daralır, log'a bir kez yazılır); en çok 64 girdi. Dar tutun: tek VIP `/32` ya da yalnız VIP alt ağı `/24`. Örnek: `10.20.30.0/24,10.20.31.15` |
| `NGINX_LOADTEST_SERBEST_YASAK` | boş | İsteğe bağlı yasak liste (ör. PROD VIP aralıkları): aynı biçim, her önek (geniş yasak güvenlidir). **İki kipte** ve izin listesinden **önce** uygulanır. Tek geçersiz girdi **tüm yük testini** kapatır (409 `ip_yasak_listesi_gecersiz`): yasak listesinde girdi atmak fail-open olurdu. |
| `NGINX_LOADTEST_DIR` | `/sw/BMW_PORTAL/nginx_loadtest` | Sonuç kökü; koşu dizini `<kök>/<koşu no>/`, arac setleri `<kök>/araclar/<id>/`. Playbook (GBLABT02 üzerinden yazar) ve Portal (okur) **aynı yolu** görmeli. Araç hazırlama `/sw/BMW_PORTAL(_DEV)/...` dışındaki köke yazmaz (409 `sinir_asildi`). |
| `NGINX_LOADTEST_LOCK_TTL_MIN` | `75` | Kilit süresi, dk (65..720) |
| `NGINX_LOADTEST_POLL_SN` | `30` | Sonuçlandırıcı aralığı, sn (10..600) |
| `NGINX_LOADTEST_RETENTION_DAYS` | `365` | DB saklama, gün (30..3650) |

Sınırlar (hız, bağlantı, süre, bütçe, serbest tavanları, tazelik eşikleri) **kod sabitidir**; DB ya da
env ile gevşetilmez.

### 2.4 Erişim

Sekme `tab:nginx:yuktesti` **varsayılan kapalıdır**. Admin › Nginx Hub Erişimi'nden kullanıcıya
ya da AD grubuna açılır. Admin olmayan kullanıcı yalnız **sonuçları okur** (hedefler, senaryolar,
koşular, karşılaştırma, araç setleri — vekil adresi hariç). Araç hazırlama ve araç setini geri çekme **yalnız
Admin**. Senaryo yazma/silme, IP sınıflandırması (`/ip-sinifi`), ön kontrol, koşu,
durdurma ve canlı iş çıktısı **yalnız Admin**. Serbest izin listesindeki ağlar `/hedefler`'de yalnız
Admin'e gösterilir (diğerleri yalnız açık / kapalı bilgisini görür).

### 2.5 Teslim sırası

Tur 4 (yük araçları /sw'den):

1. **Ansible deposu zip'i.** Yeni `bmw_portal/nginx_loadtest/files/arac_hazirla.sh` zip listesinde
   **ayrıca** sayılmalı; değişenler `nginx_loadtest.yml`, `README.md`, `files/durdur.sh`,
   `bmw_nginx/tests/check_nginx_loadtest_job.py`. Bu andan Portal dağıtılana dek ön kontrol / koşu
   "arac degiskenleri eksik ya da gecersiz ..." ile reddedilir; durdur çalışır.
2. **Portal** (DB: `nginx_loadtest_araclar` tablosu ve `nginx_loadtest_kosular.arac_id` açılışta
   CREATE / ALTER ile kendiliğinden eklenir; eski satırlar `arac_id` NULL). Önce iki arşiv özetini
   `.env`'e yazın (§2.2 "Arşiv özetlerini sabitleme"); yoksa hazırlama 409 `arac_ozet_sabit_yok`.
3. Admin › Yük Testi › **Araçlar** › "Araçları hazırla" (GBLABT02). Set hazır olana dek ön kontrol /
   koşu 409 `araclar_hazir_degil`.
4. Kanarya: Ansible deposundaki `bmw_portal/nginx_loadtest/README.md` "Kanarya" listesi (araç işinin
   set_stats alanları, /sw izinleri, vekilsiz deneme, k6 ve wrk ön kontrolü RHEL 8 ve RHEL 9 yük
   makinesinde, Durdur'da `arac/` silinmesi, /sw'deki ikili bozulunca "sha256 farkli").

Ara dönem (fail-closed):

* Portal yeni, playbook eski: eski kapı işaret yolunu kabul eder ama ikili orada yoktur → ön kontrol
  "k6 yok ya da calistirilamiyor: /yeni-playbook-gerekli/k6" ile FAIL; Portal da "yük aracı kopyası
  doğrulanamadı: ölçülemedi (playbook araç kopyalamayı desteklemiyor olabilir; Ansible deposunu
  güncelleyin)" der. Araç hazırlama işi eski kapıda reddedilir; Portal satırı FAILED yazar ve
  sonuna " (Ansible deposu güncel değil: araclar kipi yok)" ekler. Durdur çalışır.
* Playbook yeni, Portal eski: ön kontrol / koşu yeni araç kapısında "arac degiskenleri eksik ya da
  gecersiz ... Portal surumu playbook ile uyumsuz ya da araclar hazirlanmadi" ile reddedilir; durdur
  çalışır.
* Dağıtımdan önce alınmış (≤ 15 dk) OK ön kontrolle koşu 409 `on_kontrol_eski` "Yük araçları ön
  kontrolden bu yana yeniden hazırlandı; ön kontrolü yeniden çalıştırın." (beklenen).

Önceki turlar: tur 3'te Portal önce, sonra zip (`wrk_kos.sh`, `yuk_wrk.lua`); tur 2 ve 3 ara dönem
kuralları geçmişte kaldı.

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
   **Form düzeni (sade turu):** üstte yalnız senaryo, hedef (IP + Host başlığı + yük makinesi), yük
   (k6 hızları / wrk bağlantıları) ve ölçüm süresi; tahmini toplam süre büyük yazılır. Üç hazır ayar
   düğmesi alanları doldurur (sonra elle değiştirilebilir, ekran "Özel ayar" der): **Hızlı deneme**
   (~5 dk, küçük yük, tekrar 1), **Standart** (sunucu varsayılanı) ve **Kapasite** (hedef sınırına
   kadar beş kademe). Hazır ayarlar `GET /hedefler` `sinirlar`'ına, hedefin ölçülmüş `limit_req` /
   `limit_conn` tavanına, serbest tavanlara (200 r/s / 50 bağlantı) ve 2700 sn bütçeye kırpılır;
   testte sunucunun kendi `parametreler` doğrulamasından geçtiği sınanır. Tekrar, ısınma, boşluk,
   boşta, kip, sıkıştırma, protokol (HTTP/1.1 / HTTP/2, §5.2), maks VU, iş parçacığı ve SNI kapalı
   **Gelişmiş ayarlar** bölümündedir; her alanın altında etkisini anlatan bir cümle vardır. Gönderilen
   gövde ve sunucu doğrulamaları değişmedi (protokol eklendi: `parametreler.protokol`, yoksa `h1`).
5. **Ön kontrol** (yük üretmez) — sunucu: seçilen IP hedefte yerel mi, Host başlığı `nginx -T`'de var
   mı (uyarı), tek nginx master, `/web_log` doluluğu ve okunabilirliği, etkin `log_format`'ta
   `user-agent=` var mı; serbest: IP yük makinesinde yerel değil mi ve yük makinesindeki izin dosyası
   (eşleşen girdi raporlanır). İki kipte: seçili motor var mı (sürüm, sha256), senaryodaki her yol 200
   dönüyor mu, sıkıştırma (statik / dinamik / yok). HTTP/2 koşusunda ayrıca her yol curl `--http2` ile
   denenir; hedef bu Host için ALPN ile HTTP/2 sunmuyorsa ya da ölçülemediyse koşu **başlatılamaz**
   (§5.2).
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
8. **Sonuç** — geçerlilik `GECERLI` / `KISMI` / `GECERSIZ` / `OKUNAMADI` ve nedenleri. En üstte koşu
   özeti (gönderilen toplam istek, en iyi / en kötü p95 ve hangi adımda olduğu, hata durumu) ve adım
   başına **özet tablo**: adım (hız ya da bağlantı × tekrar), gönderilen istek (yalnız ölçüm fazı),
   gerçek hız, medyan (p50), p95, p99 (ms), hata %, 429, 5xx, host CPU %, sonuç. Her sütun başlığının
   ipucu ölçünün ne anlattığını yazar. Nedenler düz Türkçe cümledir (ham kod altta küçük); aynı neden
   bir kez yazılır, etkilenen adımlar ve — varsa — reload anı ("saat … civarında, 250/sn · r2 ölçüm
   sırasında") ile. Teknik sütunlar (TTFB, dropped, istemci/sunucu istek hızı, CPU-ms/istek, kapasite)
   ve grafikler kapalı **Ayrıntı** bölümündedir; CPU-ms/istek ve kapasite ölçülemediyse "—" ve nedeni
   ipucunda (§5.0). Serbestte sunucu alanları boş, wrk'de adım sütunu bağlantı sayısıdır. Erken duran koşu
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

### Araçlar

Yük Testi › **Araçlar** (herkes görür; düğmeler yalnız Admin'e):

* **Etkin araç seti #N** — k6 ve wrk sürümü ve sha256'sı, derleme makinesi (RHEL / glibc), hazırlanma
  zamanı ve kişi, AWX işi, /sw dizini, arşiv özetleri (sabit değerle doğrulandı). Admin'e **Geri çek**.
* **Arşiv özetleri sabitlenmemiş** (kırmızı, herkes görür) — eksik / geçersiz env adları; bu durumda
  hazırlama kapalıdır ve hiçbir set kullanılmaz.
* **Araçları hazırla** (Admin) — derleme makinesi seçilir (`NGINX_LOADTEST_DERLEME_HOSTLARI`), vekil
  sunucu ve iki sabit özet gösterilir; onaydan sonra AWX `araclar` işi başlar (kilit `A|araclar` +
  `L|<derleme>`; aynı anda tek hazırlama işi). Süren koşular etkilenmez; yeni set yalnız iş başarıyla
  bitince etkin olur. İş sürerken panel 10 sn'de bir yenilenir. İptal ucu yoktur (AWX'ten iptal).
  İş AWX'te okunamaz hâlde kalırsa (AWX sunucusu yapılandırmadan kalktı, kalıcı 403 / 5xx) panel süre
  sınırı (40 dk) aşılınca "durumu okunamıyor" uyarısı gösterir; Portal okumayı bütçe + 10 dk + 12 sa
  dener, sonra kaydı `OKUNAMADI` yazar ve düğme açılır (kilit 12 saatlik devralma kuralıyla zaten düşer).
* **Geri çek** (Admin) — DONE bir seti onay penceresiyle devre dışı bırakır (§2.2); etkin set kurala
  uyan bir önceki sete düşer. Geçmişte "geri çekildi" / "özet farklı" (şu anki sabitlerle hazırlanmamış)
  çipleri görünür.
* **Uyarılar** — set yoksa "Kullanılabilir araç seti yok" (sunucunun nedeniyle); wrk glibc > 2.28
  istiyorsa "wrk RHEL 8’de çalışmayabilir".
* **Geçmiş** — son 10 hazırlama işi (durum, derleme makinesi, sürümler, hata).

Ön kontrol ve koşu etkin seti ister: özet env'i yoksa 409 `araclar_ozet_sabit_yok`, hiç uygun set
yoksa `araclar_hazir_degil`, setler başka özetlerle hazırlandıysa `araclar_ozet_degisti`, uygun setler
geri çekildiyse `araclar_geri_cekildi` (kapı şablon çözümünden sonra, kilitten önce: kilit / satır /
iş oluşmaz). Ön kontrol satırına kullandığı set yazılır (`arac_id`); koşu, ön kontrolün seti hâlâ
etkin değilse (yeniden hazırlandı / geri çekildi) ya da ön kontrol araç setlerinden önce yapıldıysa
(`arac_id` NULL, ayrı metin) 409 `on_kontrol_eski`. Ön kontrolde "Araç kopyası (sha256)" satırı yük makinesindeki kopyanın
doğrulanıp doğrulanmadığını gösterir; doğrulanmayan kopya, sha256'sı setten farklı kopya ve
çalıştırılamayan kopya (ör. glibc uyumsuz) **engeldir**.

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
| Ön kontrol / koşu: arşiv özeti env'i (`NGINX_LOADTEST_K6_ARSIV_SHA256` / `_WRK_KAYNAK_SHA256`) yok ya da geçersiz | `araclar_ozet_sabit_yok` |
| Ön kontrol / koşu: etkin araç seti yok (başarılı, geri çekilmemiş, şu anki özetlerle) | `araclar_hazir_degil` |
| Ön kontrol / koşu: başarılı setler başka arşiv özetleriyle hazırlandı (env değişti) | `araclar_ozet_degisti` |
| Ön kontrol / koşu: şu anki özetlerle hazırlanmış setler geri çekildi | `araclar_geri_cekildi` |
| Ön kontrol / koşu: araç seti okunamadı | `db_okunamadi` (424) |
| Koşu: ön kontrolün araç seti (`arac_id`) yok ya da artık etkin değil (değerlendirmeden önce) | `on_kontrol_eski` |
| Araç hazırlama: derleme makinesi izin listesinde değil / vekil geçersiz / arşiv özetleri sabitlenmemiş | `derleme_host_izinsiz` / `arac_proxy_gecersiz` / `arac_ozet_sabit_yok` |
| Araç geri çekme: set yok / DONE değil / zaten geri çekildi | `arac_yok` / `arac_geri_cekilemez` / `zaten_geri_cekildi` |

`vhost_hedefte_yok` artık üretilmez (Host başlığı serbest metin, §3 adım 4). Ret gövdesinde IP'nin
bilinen sahipleri `sahipler: [{ host, env, nginx, kaynaklar }]` (en çok 10) döner.

Diğerleri: AWX sunucu / iş numarası **istemciden alınmaz** (koşu satırından okunur); `LIMIT_MUAF` ve
proxy değişkenleri koşu kiplerinde hiç gönderilmez (son kapı fazladan ve eksik anahtarı reddeder: her
ön kontrol / koşu / durdurma işi tam 34 değişkenle (34. `yuk_protokol`, §5.2), araç hazırlama işi tam 10 değişkenle gider — vekil
`yuk_proxy` yalnız onda; playbook kurallarının aynası); iş geçmişine senaryo gövdesi yerine boyut izi
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
`L|<YUK>` (yük makinesi), `A|araclar` (aynı anda tek araç hazırlama işi; `L|<DERLEME>` ile birlikte
alınır: derleme bir yük makinesinde yapılırsa o makinedeki yük işini bekletir ve tersi). Sunucu hedefinde ön kontrol `T` + `L`, koşu `G` + `T` + `L`; **serbest
hedefte ön kontrol de** `G` alır (`G` + `T|IP:` + `L`): serbest ön kontrolün istekleri VIP
arkasındaki bir hostun ölçüm penceresine girmesin. **VIP arkasındaki hostlar `T` kilidiyle
korunmaz** (Portal VIP'in havuzunu bilmez). Dolu kilit mesajı kimin hangi işi tuttuğunu söyler
(`ön kontrol 10.20.30.40 (serbest) <- GBNGXT34 (wrk)`).

AWX iptali (`canceled`) ya da hatası (`error`, ör. execution node kaybı) uzaktaki async
`kos.sh`/k6'yı, `wrk_kos.sh`/wrk'yi ve ayrık CPU kaydediciyi **durdurmaz**. Kilit bu yüzden yalnız "AWX
işi bitti" diye bırakılmaz; bağlı işin türüne (`bag_turu`) ve AWX durumuna göre karar verilir
(`kilit.cjs` `bagliIsKarari`, tek kural; sonuçlandırıcı, kilit süpürmesi ve yeni kilit alma aynı
kuralı kullanır):

| AWX durumu | ön kontrol (yük yok) | koşu | araç hazırlama (`bag_turu 'araclar'`) | durdurma işi |
|---|---|---|---|---|
| `successful` | bırak | bırak | bırak | bırak |
| `failed` | bırak | bırak (playbook temizledi) | bırak | **tut** (kalan süreç olabilir) |
| `canceled`, `error` | bırak | **tut** | **tut** (uzakta `timeout -k 30 1800` ile biten derleme sürebilir) | **tut** |
| bitmemiş / okunamadı | tutulur (değişmez) | | | |

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

### 5.0 Reload, CPU ve sonuç özeti (sade turu, 2026-11-02)
İlk gerçek koşuda (R2, GBNGXT33) nginx koşu sırasında iki kez reload oldu; ekran negatif CPU-ms/istek
(-1,372) ve negatif kapasite gösterdi. Nedeni: kaydedici worker CPU'sunu **o anki** worker'ların toplamı
olarak yazar; eski worker'lar çıkınca toplam düşer.

* **CPU-ms/istek ve kapasite asla negatif ya da 0 değildir.** Ölçüm penceresinde reload (worker PID
  kümesi değişti ya da 'shutting down' worker var), ham sayaç geriye gittiyse ya da arka plan
  çıkarılınca sonuç negatifse CPU alanları **boş** (null) kalır; adım uyarısı
  `cpu_olculemedi(reload | sayac_geriledi | net_negatif)`, `ham.cpu_olculemedi` = kod. Kapasite yalnız
  CPU-ms/istek > 0 iken hesaplanır. Karar (`/karsilastir`) bu değerleri kullanmaz; DB'deki eski negatif
  değer de kararda boş sayılır. Host CPU (`/proc/stat`) reload'dan etkilenmez, kalır. (karsilastir.py
  bu durumda sayı yazardı: bilinçli fark, testte açık eşleme.)
* **Reload anı**: kaydedici örneklerinde PID kümesinin değiştiği / 'shutting down' worker görülen her
  ardışık dizi bir olaydır: ilk görüldüğü an, ondan önceki değişmemiş örnek (reload bu ikisi arasında),
  son örnek, worker sayıları, adım ve fazı ve değdiği adımlar. Faz **CPU penceresiyle kesin** eşleşir
  (h2 turu, 2026-11-02): CPU-ms/istek, ölçüm fazının tamamına değil, nginx logundaki ölçüm satırlarının
  `[ilk + 3 sn, son − 2 sn]` aralığına (log yoksa istemci saatiyle `[başlangıç + ısınma + 5, bitiş − 5]`)
  bakar. Fazlar (ilk tutan):
  * `olcum` — olayın kanıtı (bitişik iki örnekte farklı PID kümesi ya da 'shutting down' worker
    örneği) bir adımın CPU penceresinin içinde: adım reload nedeniyle `GECERSIZ` ve CPU'su boştur.
    Isınmada / boşlukta / koşu öncesinde başlayıp eski worker'ları pencereye taşan reload da budur.
  * `olcum_kenari` — olay ölçüm fazına (başlangıç + ısınma .. bitiş) değiyor ama CPU penceresinin
    **dışında** (ölçümün ilk ya da son birkaç saniyesi): adım **etkilenmez**, ekran "ölçümün başında ya
    da sonunda, CPU penceresi dışında (ölçüm etkilenmedi)" der. Eskiden bu olay `olcum` yazılıyor, adım
    ise `GECERLI` kalıyordu (çelişki).
  * `isinma` / `bosluk` (bir önceki adımdan sonraki boşluk) / `kosu_oncesi` — o an süren adım ve fazı.
  Değişmez: bir adımın nedenlerinde `reload(worker_pid_degisti)` varsa **ve yalnız o zaman** o adıma
  yazılmış bir `olcum` olayı vardır (tek olay boşluksuz iki adımın penceresine kanıt bırakırsa ilk adıma
  yazılır). Kenar olay başka kesitteyse (adımın CPU'su başka kaydedici dosyasından) de `olcum_kenari`dır.
  Analiz özetinde `ozet.reloadlar`, adım satırında `ham.reloadlar`. Yalnız gösterimdir; geçerlilik
  kuralı değişmez (penceredeki reload yine `GECERSIZ`).
* **Konfigürasyon değişimi** (`konf_degisti`) kaydedicinin yalnız başta ve sonda aldığı özet farkıdır:
  anı bilinmez ve **tüm** adımlara yazılır. Değişikliğin anını bulmak kaydedicide (Ansible) ara özet
  ister; bu tur kapsamı dışında.
* **Neden kodları** sabit bir listededir (`analiz.cjs` `NEDEN_KALIPLARI`); ekran her kodu düz Türkçe
  cümleye çevirir. Yeni kod eklenirse listeye de eklenir (test fikstür çıktısının her satırını sınar).
* **Sonuç özeti** (`GET /kosular/:id` → `kosu.sonucOzeti`): adım sayısı, geçerli adım sayısı, toplam
  istek (yalnız ölçüm fazı; ısınma hariç), en iyi / en kötü p95 (GECERLI + DOYMA adımlardan; hiç yoksa
  tüm adımlardan, `p95Kapsam: 'tum'`), toplam 429 / 5xx, en yüksek hata oranı, `hataVar`, CPU'su
  ölçülemeyen adım sayısı, `konfDegisti`, reload olayları. Eski koşularda da çalışır (eksik alan
  null / `[]`).
* **Eski koşular (R2 dahil):** reload anları yalnız bu turdan sonra analiz edilen koşularda vardır;
  R2'nin satırları eski analizle yazıldığı için ekranda reload nedeni cümlesi çıkar, "saat …" çıkmaz.
  Negatif değerler API'de null'a çevrilir (DB değişmez).
* **Gerçek R2 fikstürü:** `__tests__/r2-gercek.test.cjs` R2 iş çıktısındaki sayıları (6 adımın
  başlangıcı, istek, gerçek hız, p50 / p95 / p99, dropped, kaydedici konf özeti) sentetik kaydedici
  örnekleri ve iki ölçüm içi reload ile tüm zincirden geçirir (analiz → poller → DB satırı → API);
  çıktısı `fixtures/r2-gercek-api.json`'da bayt bayt kilitlidir ve arayüz testi (SD11) aynı dosyayı
  çizer. Fikstür bilerek değişirse `YUK_R2_FIKSTUR_YAZ=1` ile yeniden yazılır.

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
| `hatali_kosu(kos.sh_durdurdu)` | Metin wrk'te de aynen: TUR'u `wrk_kos.sh` durdurduysa da (429 / 5xx / soket / hata oranı / beklenmeyen protokol / hata kodu / ölçüm yok). |

**Karşılaştırma (kararVer)** — ilk satır (`referans=.. aday=.. senaryo=.. kip=.. ae=..`) değişmez; hemen ardından:

* motorlar farklıysa `VERI_YOK`: `farkli yuk araci: referans <m>, aday <m>; k6 (acik dongu, istek/sn) ve wrk (kapali dongu, baglanti) sonuclari karsilastirilmaz`;
* protokoller farklıysa `VERI_YOK`: `farkli protokol: referans HTTP/1.1, aday HTTP/2; ayni protokolle yeniden kosun` (§5.2);
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

### 5.2 Protokol (HTTP/1.1 / HTTP/2)

Tarayıcılar HTTPS'te çoğunlukla HTTP/2 kullanır; HTTP/2 nginx'in CPU'sunu (HPACK, akış yönetimi) ve
yanıt süresini HTTP/1.1'den farklı etkiler. Koşu bu yüzden protokolü seçebilir (**Gelişmiş ayarlar** ›
Protokol). Varsayılan ve alanı olmayan **eski koşular HTTP/1.1**'dir; davranışları değişmedi.

* **Kısıtlar:** HTTP/2 yalnız **k6** ile (wrk yalnız HTTP/1.1 konuşur) ve yalnız **keep-alive (`ka`)**
  bağlantı kipiyle seçilir. "Her isteğe yeni bağlantı" HTTP/2'de tarayıcı davranışı değildir ve k6'nın bu
  durumdaki davranışı ölçülmedi. Kural her katmanda aynıdır: arayüz (seçim kapalı), sunucu (400
  `gecersiz_istek`: "HTTP/2 yalnız k6 ile seçilebilir; wrk yalnız HTTP/1.1 konuşur." / "HTTP/2 yalnız
  keep-alive (ka) bağlantı kipiyle koşulur; …"), Portal son kapısı (`yuk_protokol` ihlali), playbook
  kapısı ve betikler (`kos.sh`, `wrk_kos.sh`, `yuk_k6.js`).
* **Saklama:** protokol koşu satırının `parametreler` JSON'undadır (`"protokol":"h1"|"h2"`); **DB şeması
  değişmedi**. Liste ucu protokolü `parametreler`'den `LIKE '%"protokol":"h2"%'` ile okur (`JSON_VALUE`
  değil: Portal DB'sinin uyumluluk seviyesi bilinmiyor; kanonik JSON boşluksuzdur). Ön kontrol → koşu
  eşitliğinde protokolsüz (bu sürümden önce saklanmış) ön kontrol `h1` sayılır.
* **AWX:** extra var `yuk_protokol` (`'h1'` | `'h2'`) Portal'dan **her zaman** gider (34. değişken;
  durdurma işinde eski satırdan `h1`). Playbook kapısı `yuk_protokol | default('h1')` kullanır: hangi
  tarafın önce dağıtıldığı fark etmez. Yeni Portal + eski playbook (HTTP/2 istendi, HTTP/1.1 koşuldu)
  üç yerde yakalanır: ön kontrolde `alpn_h2` gelmez → engel ("HTTP/2 desteği ölçülemedi …"); set_stats
  `protokol` yankısı farklıysa sonuç bu koşuya ait sayılmaz (`OKUNAMADI`, "yayınlanan sonuç bu koşuya
  ait değil (protokol h1)"); analizde istemci satırında `protokol` kolonu yoksa
  `protokol_farkli(beklenen=h2,olculen=yok)`.
* **Ön kontrol (ALPN):** HTTP/2 koşusunda yük makinesindeki curl her tekil yolu `--http2` ile dener;
  özet `protokol`, `curl_h2`, `yollar_yanitli`, `yollar_h2`, `alpn_h2` taşır. Engeller (TEK, ilk tutan; motor
  engelinden hemen sonra): ön kontrol HTTP/2 için yapılmamış (`protokol` `h1`) → "ön kontrol HTTP/2 için
  yapılmadı"; curl HTTP/2'siz → "yük makinesindeki curl HTTP/2 desteklemiyor"; `alpn_h2` false →
  "Hedef bu Host için HTTP/2 sunmuyor (ALPN): n/m yol HTTP/2 ile yanıt verdi …"; `alpn_h2` true değil
  (yok / ölçülemedi) → "HTTP/2 desteği ölçülemedi …" (fail-closed). HTTP/1.1 koşusunda bu alanlar
  **okunmaz**, çıktı öncekiyle birebir aynıdır. **SNI notu:** SNI kapalıyken (Host yalnız başlıkta) nginx
  ALPN'i IP:443'ün **varsayılan** sunucusunun http2 ayarıyla seçer; `listen … http2` (eski biçim) dinleme
  soketi geneline, `http2 on;` (1.25.1+) SNI ile seçilen server bloğuna uygulanır. Hedef site h2 açıkken
  "sunmuyor" görüyorsanız SNI'yi açın.
* **k6'nın HTTP/2 modeli (MAKUL, sahada ölçülmedi):** k6 v0.49 (Go net/http) HTTP/2'yi ALPN ile seçer
  (`GODEBUG=http2client=0` yalnız HTTP/1.1 koşusunda verilir). Her sanal kullanıcı kendi bağlantısında
  istekleri **sırayla** gönderir (VU başına tek akış); tarayıcıdaki gibi tek bağlantıda çok sayıda eş
  zamanlı akış ölçülmez. HTTP/2 koşusuna bu yüzden koşu uyarısı yazılır:
  `h2_vu_basina_tek_akis(tarayici_coklamasi_olculmez)`. İlk gerçek HTTP/2 koşusunda nginx
  `connection_request` (adım `ham.yeniden_baglanti_yuzde`) ile doğrulanmalıdır (≈ 100 beklenir).
  CPU-ms/istek ve p95 yalnız **aynı protokolle** koşulmuş koşularla karşılaştırılır.
* **Çalışma anı denetimi:** k6 `setup()` her kontrol yolunun protokolünü beklenenle (`HTTP/1.1` |
  `HTTP/2.0`) karşılaştırır; ölçüm / ısınma isteklerinde beklenen dışı yanıt `protokol_uyumsuz` sayacını
  artırır ve koşuyu keser (`kos.sh` DUR).
* **Sonuç kolonları:** istemci CSV / JSON şeması 30 kolon **aynen** + sonda `protokol` (`h1` | `h2`) ve
  `protokol_uyumsuz` (32 kolon; wrk hep `h1` / `0`). `http2` kolonu yeni satırlarda yalnız bilgidir (HTTP/2.0
  yanıt sayısı, ısınma + ölçüm); geçerlilik kararı `protokol_uyumsuz`'dan verilir: HTTP/1.1'de
  `> 0` → `http2` (eski kod), HTTP/2'de `> 0` → `h2_disi(<n>)`. Satırın `protokol`'ü koşununkinden farklıysa
  `protokol_farkli(beklenen=<p>,olculen=<p|yok>)`. Kolonu olmayan eski satır HTTP/1.1 koşusunda bugünkü
  kuralla (`http2 > 0` → `http2`) değerlendirilir. Adım `ham`'ında `protokol` / `protokol_uyumsuz` yalnız
  kolon varsa bulunur (eski koşuların analiz çıktısı değişmedi). TUR adı değişmedi (protokol koşu
  düzeyinde sabittir).
* **Karşılaştırma:** farklı protokol `VERI_YOK` ("aynı protokolle yeniden koşun"; motor kuralından hemen
  sonra, wrk iş parçacığı / tavan kurallarından önce).

| Neden | Anlamı |
|---|---|
| `h2_disi(<n>)` | HTTP/2 koşusunda `<n>` yanıt HTTP/2 dışında geldi; adım HTTP/2 ölçümü sayılmaz. Hedefin bu Host için h2 sunduğunu doğrulayın ya da HTTP/1.1 ile koşun. |
| `protokol_farkli(beklenen=<p>,olculen=<p\|yok>)` | Yük aracı istenen protokolü kullanmadı (`yok` = istemci satırında protokol kolonu yok: eski `yuk_k6.js`). Ansible deposunu güncelleyin, koşuyu tekrarlayın. |
| `http2` | Yalnız HTTP/1.1 koşusunda: HTTP/2 ile gidildi (`GODEBUG=http2client=0` tutmadı). |

---

## 6. API

Taban `/api/nginx-loadtest`. Yanıt `{ ok: true, ... }` ya da `{ ok: false, message, code }` (IP
retlerinde ayrıca `sahipler`).

| Uç | Erişim | Not |
|---|---|---|
| `GET /hedefler` | okuma | hedefler (uygun / değil + neden, aday IP, vhost önerileri, ölçülen tavanlar), yük makineleri, sınırlar (`baglantiMin`, `maxBaglanti`, `maxBaglantiSayisi`, `isParcacigiMin`, `maxIsParcacigi`, `serbestTavanRps`, `serbestMaxBaglanti` dahil), varsayılanlar (`motor`, `baglantilar`, `is_parcacigi`, `protokol: 'h1'`, `serbest: { hizlar, maxvu }` dahil), `serbest: { acik, aglar }` (`aglar` yalnız Admin'e dolu), `motorlar: ['k6', 'wrk']`, `protokoller: ['h1', 'h2']` (alan yoksa arayüz yalnız HTTP/1.1 sunar), `araclar: { hazir, aracId, k6Surum, wrkSurum, kod: null \| 'araclar_ozet_sabit_yok' \| 'araclar_hazir_degil' \| 'araclar_ozet_degisti' \| 'araclar_geri_cekildi' \| 'db_okunamadi', mesaj }` (araç seti okunamazsa `hazir: false`, `db_okunamadi`; uç yine 200) |
| `GET /ip-sinifi?ip=&yukHost=&hedefHost=` | Admin | yazılan IP'nin sınıfı; DB'ye ve denetime **yazmaz**. `ip` zorunlu, iki host isteğe bağlı (verilmiş ama geçersizse 400; `yukHost` yoksa `ayni_host` denetimi atlanır). Sunucu: `{ ok, tur: 'sunucu', ip, host, env, vhostlar, vhostVerisi, hizSiniri, vuSiniri, uygun, neden, kod, kaynaklar }` (`uygun: false` da 200'dür: ön kontrol yapılamaz); serbest: `{ ok, tur: 'serbest', ip, host: null, ag, digerSahipler: [{ host, env }] }`; ret: §4.1 kodları (400 / 409 / 424) + `sahipler` |
| `GET /senaryolar`, `GET /senaryolar/:id` | okuma | `:id` TSV'yi ve özeti de döner |
| `POST /senaryolar`, `DELETE /senaryolar/:id` | Admin | silme yumuşaktır |
| `POST /kosular/on-kontrol` | Admin | `{ senaryoId, hedefHost?, hedefIp, vhost, yukHost, sni, parametreler, etiket? }` → `{ kosuId, jobId, awxServerId }`. `hedefHost` isteğe bağlı (`undefined` / `null` / `''` = yazılan IP sınıflandırılır). `parametreler.motor` `'k6'` (varsayılan) ya da `'wrk'`; k6: `hizlar`, `maxvu`; wrk: `baglantilar`, `is_parcacigi`; ortak `tekrar`, `isinma`, `sure`, `bosluk`, `bosta`, `kip`, `ae`, `protokol` (`'h1'` varsayılan \| `'h2'` yalnız k6 + `kip: 'ka'`; aksi 400). `tavan_rps` gönderilse de yok sayılır (sunucu hesaplar). |
| `POST /kosular` | Admin | `{ onKontrolKosuId, confirmText, uyariOnay }` — `confirmText` sunucu hedefinde host adı, serbest hedefte hedef IP |
| `GET /kosular?islem=&durum=&hedef=&ip=&hedefTuru=&motor=&onceki=&limit=` | okuma | `islem` ∈ `kosu`, `on_kontrol`; `durum` ∈ `QUEUED`, `RUNNING`, `FINALIZING`, `DONE`, `FAILED`, `CANCELED`, `OKUNAMADI`; `hedef` = sunucu adı; `ip` = hedef IPv4; `hedefTuru` ∈ `sunucu`, `serbest`; `motor` ∈ `k6`, `wrk`; `onceki` = koşu no (yalnız `id < onceki`, "daha eski" sayfası); `limit` 1..200 (varsayılan 50). Sıra `id` azalan. Yanıtta `dahaVar` (limit + 1 satır çekilir). Satırlarda `hedefTuru`, `motor`, `protokol` (`h1` \| `h2`; eski satır `h1`), `hedefHost` (serbestte `null`). Geçersiz değer (ya da tekrarlanan parametre) → 400 `gecersiz_istek` |
| `GET /kosular/:id` | okuma | ayrıntı: parametreler, `hedefTuru`, `motor`, `protokol`, ön kontrol özeti (HTTP/2'de `protokol`, `curl_h2`, `alpn_h2`, `yollar_yanitli`, `yollar_h2`) + engel / uyarı listesi (`onKontrolUyarilari` = plan uyarıları başta + ön kontrol uyarıları), `planUyarilari` (ön kontrol satırınınki), `serbestAg` (serbest satırda Portal izin listesinde **şu an** eşleşen ağ ya da `null`), geçerlilik nedenleri, adımlar; `durdurIsi: { awxServerId, awxJobId } \| null` (son durdurma işi), `sonuclandirmaDenemesi` (sonuçlandırma deneme sayısı); tur 4: `aracId` (satırın arac seti ya da `null` — eski satır) ve `aracSeti: { id, k6Surum, wrkSurum, k6Sha256, wrkSha256, derlemeHost } \| null` (durumundan bağımsız); `aracId` doluysa ön kontrol engellerine araç kopyası maddeleri eklenir; sade turu: `sonucOzeti` (§5.0) ve her adımda `cpuOlculemedi` (`reload` \| `sayac_geriledi` \| `net_negatif` \| `negatif_deger` — eski satırda DB'deki negatif / 0 değer \| `null`) ile `reloadlar: [{ t, tOnce, tSon, tur, faz }]` (epoch sn; `faz` ∈ `isinma`, `olcum`, `olcum_kenari`, `bosluk`, `kosu_oncesi`, §5.0); `cpuMsIstek` / `kapasiteRps` asla ≤ 0 (eski satırda da null'a çevrilir, DB değişmez) |
| `GET /kosular/:id/durum?since=` | Admin | maskeli iş çıktısı; `since` = elinizdeki metnin uzunluğu → yalnız devamı (`outputOffset`, `outputLength`) |
| `POST /kosular/:id/durdur` | Admin | AWX iptali + (koşu) `durdur` kipi. Başarı: `{ ok, iptal, iptalHatasi, durdurIsi: { jobId, awxServerId } \| null, durdurHatasi: null }`. 409 `baslatiliyor`, 409 `kosu_bitti`, 424 `durdur_baslatilamadi` (gövdede `iptal`, `iptalHatasi`, `durdurHatasi`; metin motor ve türe göre), 424 `awx_okunamadi` (ön kontrol iptal edilemedi) |
| `POST /kosular/:id/yeniden-oku` | Admin | sonucu okunamamış koşuyu yeniden sonuçlandırır → `{ ok: true }`; değilse 409 `yeniden_okunamaz` |
| `GET /karsilastir?ref=&aday=&esikCpu=&esikP95=` | okuma | karar, nedenler, tablo, kademe, kombinasyon; `ref` / `aday` özetinde `motor`, `hedefTuru`, `protokol` (farklıysa karar `VERI_YOK`, §5.2) |
| `GET /araclar` | okuma | `{ ok, etkin, calisan, gecmis (en çok 10, id azalan), ayar: { derlemeHostlari, varsayilanDerlemeHost, k6Surum, wrkSurum: '4.2.0', proxyTanimli, proxy (yalnız Admin'e dolu), proxyHatasi, k6ArsivSha256, wrkKaynakSha256 (env sabitleri ya da null), ozetEksikleri (['<ENV> tanımlı değil' \| '<ENV> 64 hex değil']), isSuresiSn (2400) }, kapi: { kod, mesaj } }` (`kapi` = `/hedefler` `araclar.kod` / `mesaj`). Araç seti: `{ id, durum, derlemeHost, k6Surum, wrkSurum, k6Sha256, wrkSha256, k6ArsivSha256, wrkKaynakSha256, ozetlerGuncel, geriCekildi, geriCeken, geriCekmeAt, calismaYasSn, swDizin (yalnız DONE), derlemeRhel, derlemeGlibc, wrkGlibcGerekli, wrkOpenssl, wrkLuajit, hata, awxServerId, awxJobId, awxUrl, createdBy, createdAt, startedAt, finishedAt }` |
| `POST /araclar` | Admin | `{ derlemeHost? }` (yoksa listenin ilki) → `{ aracId, jobId, awxServerId }`. 400 `gecersiz_istek` (geçersiz ad), 409 `derleme_host_izinsiz`, 409 `arac_proxy_gecersiz`, 409 `arac_ozet_sabit_yok` (iki arşiv özeti env'i zorunlu; iş, kilit, kayıt yok), 409 `sablon_yok`, 409 `kilit_dolu` ("Başka bir araç hazırlama işi sürüyor ..."), 409 `sinir_asildi` (son kapı), 424 `db_okunamadi` / `awx_okunamadi`. Extra vars: `yuk_islem='araclar'` + 9 alan (README); `yuk_k6_arsiv_sha256` / `yuk_wrk_kaynak_sha256` her zaman 64 küçük hex; `limit` boş |
| `POST /araclar/:id/geri-cek` | Admin | gövde yok → `{ ok, arac, kapi: { hazir, aracId, kod, mesaj } }` (yeni etkin set ya da neden). Denetim `nginx_loadtest_araclar_geri_cek`. 400 `gecersiz_istek`, 409 `arac_yok`, `arac_geri_cekilemez` (DONE değil), `zaten_geri_cekildi`, 424 `db_okunamadi`. Eski `POST /araclar/:id/onayla` kalktı |

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
| Ön kontrol engeli "wrk yük makinesinde çalışıyor ama sürümü okunamadı ya da 4 altında" | Arac setindeki wrk beklenen sürüm satırını basmıyor: araç setini yeniden hazırlayın (Yük Testi › Araçlar). |
| Ön kontrol engeli "wrk yük makinesinde bulunamadı ya da çalıştırılamıyor" / "k6 yük makinesinde bulunamadı" | Kopya çalışmadı: aynı ön kontrolde "yük aracı ..." engeline bakın. Engel `/yeni-playbook-gerekli/...` yolunu anıyorsa playbook eski (§2.5): Ansible deposunu güncelleyin. |
| 409 `araclar_hazir_degil` | Etkin araç seti yok (ilk dağıtım ya da hazırlama işleri başarısız). Admin › Yük Testi › Araçlar › "Araçları hazırla". |
| 409 `araclar_geri_cekildi` | Şu anki özetlerle hazırlanmış setlerin hepsi geri çekildi: araçları yeniden hazırlayın. |
| 409 `on_kontrol_eski`: "Etkin yük aracı seti ön kontrolden bu yana değişti" | Ön kontrolden sonra yeni bir set etkin oldu ya da ön kontrolün seti geri çekildi: ön kontrolü yeniden çalıştırın. |
| 409 `on_kontrol_eski`: "Bu ön kontrol araç setleri gelmeden (eski sürümle) yapıldı" | Ön kontrol tur 4'ten önce alındı (`arac_id` NULL): ön kontrolü yeniden çalıştırın. |
| Ön kontrol engeli "yük aracı kopyası doğrulanamadı: sha256 farkli (...)" | /sw'deki ikili set hazırlandıktan sonra değişmiş ya da bozulmuş; kopya çalıştırılmadan silindi. Araçları yeniden hazırlayın. "ölçülemedi (playbook araç kopyalamayı desteklemiyor olabilir ...)" ise playbook eski. "kopya basarisiz: ..." ise yük makinesinde www /sw'deki set dizinini okuyamıyor. |
| Ön kontrol engeli "yük aracı çalıştırılamadı: glibc uyumsuz: makinede glibc 2.28, arac GLIBC_2.34 istiyor" | wrk RHEL 9'da derlendi, yük makinesi RHEL 8. Listeye (`NGINX_LOADTEST_DERLEME_HOSTLARI`) bir RHEL 8 DEV / TEST / QA nginx makinesi ekleyip araçları orada yeniden hazırlayın (§2.2). |
| Araç işi FAILED "derleme makinesi ...: indirme basarisiz (k6 checksums / k6 arsivi / wrk kaynagi): ..." | Vekil (407 kimlik / 403 yasak), vekilin GitHub'a (ve `objects.githubusercontent.com` yönlendirmesine) izni ya da TLS (kurum CA'sı güven deposunda değil: "certificate verify failed") — TLS doğrulaması kapatılmaz. `NGINX_LOADTEST_ARAC_PROXY`'yi ve vekil kurallarını kontrol edin. Checksum tutmazsa aşağıdaki satıra bakın. |
| Araç işi FAILED "... did not match ..." / "... sabit arsiv ozetiyle (NGINX_LOADTEST_K6_ARSIV_SHA256) farkli ..." / "arsiv ozeti sabit degerden farkli ..." + "(arşiv sabitlenen özetle uyuşmuyor ...)" | İndirilen arşiv `NGINX_LOADTEST_K6_ARSIV_SHA256` / `NGINX_LOADTEST_WRK_KAYNAK_SHA256` ile aynı değil; hiçbir şey açılmadı / derlenmedi. Arşivi kurum vekili dışında yeniden doğrulayın (§2.2 "Arşiv özetlerini sabitleme"); gerçekten değiştiyse env değerini güncelleyip Portal'ı yeniden başlatın. Değişen arşiv bir tedarik zinciri saldırısı da olabilir: doğrulamadan sabitlemeyin. |
| "Araçları hazırla" 409 `arac_ozet_sabit_yok` / panelde kırmızı "Arşiv özetleri sabitlenmemiş" | İki env değeri yok ya da tam 64 hex değil (§2.2 "Arşiv özetlerini sabitleme"). |
| Ön kontrol 409 `araclar_ozet_degisti` | Env'deki özetler değişti; mevcut setler eski özetlerle hazırlandı. Araçları yeniden hazırlayın. |
| Panelde "Hazırlama işinin durumu okunamıyor" | AWX işi okunamıyor (sunucu yapılandırmadan kalktı, kalıcı 403 / 5xx). İşi AWX'ten kontrol edin; Portal bütçe + 10 dk + 12 sa sonra kaydı `OKUNAMADI` yazar ve hazırlama yeniden açılır. |
| Araç işi FAILED "/sw yayini: arac dizini zaten var: ..." | Aynı iş AWX'ten yeniden başlatılmış; dizine iki kez yazılmaz. Portal'dan yeniden hazırlayın. |
| Araç işi FAILED "... (Ansible deposu güncel değil: araclar kipi yok)" | AWX'teki playbook tur 4 öncesi: Ansible deposu zip'ini güncelleyin (§2.5). |
| Araç işi FAILED "derleme: ..." | `arac_hazirla.sh` ileti metni: eksik derleme aracı (`derleme araci yok: perl` vb.), `make basarisiz (rc N): ...`, wrk sistem kütüphanesine bağlı, beklenmeyen arşiv üyesi. Derleme makinesini değiştirin ya da eksik paketi kurdurun. |
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
