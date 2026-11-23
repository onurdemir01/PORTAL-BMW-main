# spa_package_install — Intranet SPA paket kurulumu

Bazı PROD intranet SPA uygulamaları OpenShift'te koşuyor ama paketleri Nginx sunucularına hiç gelmemiş. Bu iş, bu uygulamaları geçişleri beklemeden kurar:

- paket Artifactory'den çekilir;
- `application.json`, uygulamanın OpenShift route'u üzerinden `https://<route host>/config` adresinden alınır. OpenShift'te koşan pod'daki nginx aynı `configuration_template` ile `/config` isteğine `config.json` dosyasını döner; bu dosya ConfigMap'teki `application.json`'dur;
- kurulum, sunucudaki mevcut deployment betikleriyle (`/vhosting/HYSUXSCRIPTS`) yapılır.

Yalnız **ilk kurulum** yapılır. Hedef sunucuda uygulama zaten varsa (dizin ya da iki conf'tan biri) ya da paket dizini `/hysdeploy/<ns>/<app>` zaten varsa, dosyaların üzerine yazılmaz ve satır `SKIP` olur.

Portal tarafı: Ark SPA > Intranet SPA ekranındaki paket kurulumu (`/api/spa-report/intranet/paket/*`). Uygulamak için Portal'da onay kutusuna `PROD` yazılır.

> **Bastion yok (2026-11-23, kullanıcı kararı "A").** Hem bastion'lara hem PROD intranet Nginx sunucularına bağlanan ortak bir AWX envanteri ya da kimliği yok. Bu yüzden playbook OpenShift'i okumaz. Sürüm Portal'ın saatlik OCP taramasından gelir; kullanılan PROD okuması 3 saatten eskiyse Portal kalemi kurdurmaz (`bayat` engeli). `application.json` Nginx sunucusunun kendisi tarafından `/config`'ten çekilir.

> **Sahada doğrulanmadı (2026-11-23).** Betik sahte araçlarla test edildi (`server/ansible/__tests__/spa-package-install.test.js`); gerçek AWX ve Nginx sunucusunda henüz koşmadı. İlk koşu `plan` kipinde ve tek kalemle yapılmalıdır. Nginx sunucusunun route adreslerine HTTPS ile çıkabildiği sahada ilk planda görülür.

## Portal kaydı

| Alan | Değer |
|---|---|
| Playbook kayıt anahtarı | `spa_package_install` (Admin > Playbook Kayıtları) |
| Ortam değişkeni | `SPA_PACKAGE_INSTALL_TEMPLATE_ID` |
| AWX job template | `bmw_portal/spa_package_install/spa_package_install.yml` |
| Şablon doğrulaması | `server/ansible/template-preflight.cjs` (`BEKLENEN_PLAYBOOK`): şablon başka bir playbook koşturuyorsa iş başlamaz |

## AWX şablonu

- **Extra variables prompt-on-launch AÇIK olmalı.** Kapalıysa AWX Portal'ın gönderdiği değişkenleri yok sayar ve girdi kapısı "Zorunlu degiskenler eksik" diye durur.
- **Limit** boş bırakılır. Nginx sunucuları `spi_items[].hosts` ile `add_host` üzerinden eklenir; AWX `limit`'i zaten yok sayar.
- **Inventory ve Credential:** `bmw_nginx/nginx_deployment_spa` şablonuyla **aynı** envanter ve makine kimliği. Nginx tarafında `become: true`, `become_user: www`, `become_method: dzdo` çalışmalıdır. Bastion ve OpenShift kimliği gerekmez; `bmw_openshift_jobs/global_variables/credentials.yaml` bu playbook için **gerekmez**.
- **Variables** alanına kurum değerleri yazılır. Bu değerler repoda yoktur ve varsayılanları da yoktur (K17, `docs/AWX-KOPYALAMA-HARITASI.md` "Kurum değerleri"):

```yaml
spi_package_base_url: 'https://<artifactory>/artifactory/ark-binaries'
spi_allowed_hosts:
  - <PROD intranet nginx 1>
  - <PROD intranet nginx 2>
spi_validate_certs: true
spi_download_timeout: 600
spi_max_zip_mb: 512
```

| Değişken | Zorunlu | Anlamı |
|---|---|---|
| `spi_package_base_url` | evet | Paket kökü, `https://` ile başlar. Paket adresi `<kök>/<namespace>/<uygulama>/<sürüm>.zip` olarak kurulur. Sondaki `/` atılır. Değer Artifactory'nin **REST yoludur**: `https://<artifactory>/artifactory/<repo>` (ör. `.../artifactory/ark-binaries`). Tarayıcı arayüzünün yolu (`https://<artifactory>/ui/native/<repo>/...`) **bu değer değildir**: o adres ZIP yerine HTML sayfası döner ve plan aşaması `paket ZIP degil (Content-Type: text/html...)` diye durur. |
| `spi_allowed_hosts` | evet | Kuruluma açık sunucular. `spi_items[].hosts` bu listenin alt kümesi değilse girdi kapısı durur. |
| `spi_validate_certs` | hayır (true) | `false` olursa Artifactory ve `/config` istekleri `curl -k` ile yapılır. |
| `spi_download_timeout` | hayır (600) | İndirme süre sınırı (saniye), en çok 3600. |
| `spi_max_zip_mb` | hayır (512) | Paket boyut sınırı (MB), en çok 2048. HEAD'deki Content-Length ve `curl --max-filesize` ile uygulanır. |

## Girdi (extra_vars, Portal kurar)

| Değişken | Açıklama |
|---|---|
| `spi_mode` | `plan` (sunucuya hiçbir şey yazmaz) ya da `apply` |
| `spi_items` | 1..10 kalem: `{id: '<ns>/<app>', namespace, application, version, cluster, hosts: [..], config_urls: [..]}`; `hosts` 1..8 sunucu; `config_urls` 1..3 tekil `https://<route host>/config`. `cluster` yalnız Portal'ın bilgisi içindir, playbook kullanmaz. |
| `tower_job_id` | AWX verir; deployment betiklerine `job_no` olarak gider. Sayısal değilse girdi kapısı durur. |

Biçimler: namespace `^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`, uygulama `^[A-Za-z0-9]([-A-Za-z0-9._]*[A-Za-z0-9])?$`, sürüm `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`, sunucu `^[A-Z0-9-]{3,32}$`, config adresi `^https://([A-Za-z0-9-]{1,63}[.])+[A-Za-z][A-Za-z0-9-]{0,62}/config$`, en çok 268 karakter (host en çok 253). Port, kullanıcı, sorgu ve başka yol kabul edilmez. Host en az bir nokta içerir ve son etiketi harfle başlar: IP literal'i (`169.254.169.254`), `localhost` ve tek etiketli ad geçmez, istek iç adreslere gitmesin. Aynı desen Portal'da (`ROUTE_HOST_RE`), girdi kapısında (`spi_config_url_re`) ve betikte (`CFG_URL_RE`) vardır; SPI41 üçünün aynı olduğunu denetler. Ansible'ın `match` testi Python `re.match`'tir ve `$` sondaki satır sonunu kabul eder; bu yüzden kapı namespace, uygulama, sürüm ve her config adresi için ayrıca `x == (x | trim)` ister (SPI48 bunu gerçek Python `re` ve Jinja ile sınar). Betik de `SPI_CONFIG_URLS`'u tümüyle denetler: tek boşluk ayrımlı 1..3 adres, satır sonu yok.

Portal `config_urls`'ü SPA keşfinin route ayrıntısından kurar (küçük harf, tekil, en çok 3). Bir adres yalnız şu durumda alınır: uygulamanın **PROD** cluster'ında (Portal cluster kataloğu), arkasında nginx bulunmuş (SPA) bir route'a ait ve **başka bir uygulamayla paylaşılmıyor**. Aynı adres keşifte başka bir (namespace, uygulama) satırında da görünüyorsa yol tabanlı route olabilir: `https://<adres>/config` o zaman başka bir uygulamanın `config.json`'unu döner. Bu yüzden bu adres alınmaz. Sıra: intranet (`reencrypt`) route'u önce, yalnız internet (`passthrough`) olan sonda. Elenen adres sayısı `config-adresi-elendi` bilgi uyarısıyla görünür (adres yazılmaz). Hiç adres kalmazsa aday `config-adresi-yok` engeliyle kurulamaz. `config_urls` iş geçmişine ve denetim kaydına yazılmaz; sonuç mesajı yalnız sıra numarasını söyler.

## Akış

| Play | Nerede | Ne yapar |
|---|---|---|
| 1 | localhost | Girdi kapısı: mod, kalem/sunucu sınırları, izinli sunucu alt kümesi, biçimler (`config_urls` dahil), kurum değerleri. Nginx sunucuları `spi_nginx` grubuna eklenir ve sunucu başına iş listesi kurulur. |
| 2 | Nginx (www, dzdo) | `files/spa_package_host.sh` `/var/tmp`'ye kopyalanır, sha1 ile doğrulanır ve kalem başına çalışır. Betik sonunda silinir. Koşu görevi `no_log`'dur. |
| 3 | localhost | `set_stats spa_package_install_result` yayınlanır, ardından herhangi bir `FAIL` varsa iş düşer. |

## Sunucu adımları (`spa_package_host.sh`)

| Adım (`step`) | İş | Hata olursa |
|---|---|---|
| `check` (plan) | Sırayla denetlenir (tablonun altındaki listeye bakın) | `FAIL` ya da `SKIP`. Sunucuya hiçbir şey yazılmaz. |
| `config` (plan) | `/config` adresleri sırayla denenir; ilk geçerli JSON nesnesi alınır (ayrıntı aşağıda) | `FAIL`, mesaj her adresin nedenini sıra numarasıyla yazar. |
| `download` | `/hysdeploy/<ns>` yoksa açılır ve 777 yapılır. Kural `1-nginx_pre_deployment.sh` ile aynıdır: pipeline yükleyicisi orada yeni uygulama dizini açabilmelidir. Ardından `/hysdeploy/<ns>/<app>` açılır; o an başka bir süreç açtıysa `FAIL` olur ve dizine dokunulmaz. Paket `.<sürüm>.zip.part` dosyasına indirilir. | Betiğin yazdıkları silinir. Betiğin açtığı dizinler yalnız boş kaldıysa silinir. |
| `zip_check` | `unzip -tq` ile sağlamlık, arşiv kökünde `index.html`, ardından `mv -n` ile `<sürüm>.zip` adına taşıma. Hedef zip varsa üzerine yazılmaz (`FAIL`). | Aynı; önceden var olan zip silinmez. |
| `write` | `/config`'ten çekilen içerik **birebir** `/hysdeploy/<ns>/<app>/application.json` (0644) olarak yazılır; dosya varsa üzerine yazılmaz | aynı |
| `check` (yeniden) | Kurulum adımlarından **hemen önce** hedefler yeniden denetlenir | Hedef artık varsa `FAIL kurulum sirasinda baska bir deployment hedefi olusturdu`. İndirilen dosyalar silinir, `nginx_delete.sh` **çağrılmaz**. |
| `pre_deployment` `unzip` `configuration` `syntax_check` `reload` | `bash nginx_<adım>.sh prod <ns> <app> <sürüm> portal / <job_no>` | "Hata ve geri alma notları" bölümündeki kurallar. İlk kurulumda yedek olmadığından `nginx_rollback.sh` 49 ile düşerdi. Mesaj geri almanın sonucunu da yazar. |
| `verify` | `server_name` ve listen IP üretilen conf'tan okunur, `/` (`index.html`) ve `/config` 200 dönmeli. `/ready` denetlenmez: şablonda bir dizine alias olduğu için nginx her zaman 301 döner (job 3590287'de bu yüzden 6 sunucuda kurulum geri alınmıştı). | aynı |
| `cleanup` | `nginx_cleanup_backup.sh` | Kurulum `OK` kalır, mesaja uyarı eklenir. |

Plan denetimleri, sırayla:

1. Deployment betikleri var mı. Yoksa `FAIL eksik deployment betigi`.
2. `/usr/nginx/applications/<ns>/<app>`, `/usr/nginx/conf.d/<app>-<ns>.conf` ve `/usr/nginx/conf.d/application-confs/<app>-<ns>.conf` hiçbiri yok mu. Biri varsa `SKIP zaten kurulu (...)`.
3. `/hysdeploy/<ns>/<app>` yok mu. Varsa `SKIP paket dizini zaten var (pipeline yuklemis olabilir); elle bakin`. Dizin, paket ya da `.env` silinmez, üzerine yazılmaz.
4. `/hysdeploy/<ns>` varsa o, yoksa `/hysdeploy` yazılabilir mi. Değilse `FAIL ... yazilabilir degil`. `/hysdeploy/<ns>` sembolik bağsa `FAIL`.
5. Paket HEAD isteği 200 dönüyor mu. Değilse `FAIL paket bulunamadi ya da erisilemiyor (HTTP ...)`.
6. `Content-Type` `application/zip`, `application/x-zip-compressed` ya da `application/octet-stream` mı. Parametre (`; charset=...`) ve büyük/küçük harf yok sayılır. Değilse `FAIL paket ZIP degil (Content-Type: ...)`.
7. `Content-Length` (varsa) `spi_max_zip_mb` içinde mi. Değilse `FAIL paket cok buyuk`.
8. `/config`: adresler sırayla denenir, ilk geçerli olan alınır (sonrakilere gidilmez). Bir adres geçerlidir:
   - `curl` yalnız `https` (yönlendirme de yalnız `https`, en çok 3), `--max-time 30`, `--max-filesize 1 MB`; `-k` yalnız `spi_validate_certs: false` iken;
   - HTTP 200 (son yönlendirmenin durum kodu, `-D` başlıklarından), yanıt boş değil, en çok 1 MB. `--max-filesize` yalnız Content-Length bilinen yanıtta işler; eski curl (8.4 öncesi, RHEL 8'de 7.61) chunked yanıtı kesmez. Bu yüzden gövde `head -c` ile en çok 1 MB + 1 bayt okunur: sınırı aşan yanıtın indirmesi orada durur ve `1 MB ustu` sayılır (SPI47);
   - ilk boşluk olmayan karakter `<` değil (HTML: oturum sayfası ya da Nginx hata sayfası);
   - Python `json` ile geçerli JSON (UTF-8, BOM kabul) ve JSON **nesnesi** (dizi ya da tek değer olmaz).

   Hiçbiri geçmezse `FAIL config` ve mesaj `application.json /config'ten alinamadi (1. adres: HTTP 404; 2. adres: HTML dondu (JSON degil))` biçimindedir. Adres mesaja yazılmaz (kurum alan adı Portal DB'sine taşınmasın); içerik hiçbir çıktıya yazılmaz. İçerik koşuya özel bir geçici dizine (`$TMPDIR/.spa_package_cfg.*`, 0700) iner ve betik çıkarken silinir; plan sunucunun kurulum dizinlerine bir şey yazmaz.

JSON denetimi için Python, Ansible'ın o sunucuda bulduğu yorumlayıcıdır (`SPI_PYTHON` = `discovered_interpreter_python`). Yoksa sırayla `/usr/libexec/platform-python`, `python3`, `python` aranır. Hiçbiri yoksa `FAIL config JSON denetimi icin python bulunamadi` (Ansible modül koşturabildiğine göre bir yorumlayıcı vardır).

`config.json` dosyasını ayrıca kopyalamaya gerek yoktur: `nginx_unzip.sh`, `application.json`'u hem `application.json` hem `config.json` olarak kopyalar. Kilitleri de deployment betikleri kendileri alır (`nginx_deploy_lock.sh`).

Betik her yolda tek bir son satır yazar: `RESULT<TAB>status<TAB>step<TAB>mesaj` (`OK | PLAN_OK | SKIP | FAIL`). Çıkış kodu `FAIL`'de 1, diğerlerinde 0'dır. Beklenmeyen çıkışta trap aynı satırı yazar. Mesaja paket adresi, `/config` adresi ve `server_name` konmaz, çünkü kurum adı Portal DB'sine taşınmamalıdır.

## Çıktı

```yaml
spa_package_install_result:
  mode: plan | apply
  overall: ok | partial | failed
  items:
    - id, namespace, application, version
      hosts: [ { host, status: PLAN_OK|OK|SKIP|FAIL, step, message } ]
```

Erişilemeyen sunucu `FAIL` / `unreachable` olur. `zip_url` ve `config_urls` yayınlanmaz. Playbook OpenShift okumadığı için sonuçta `ocp` alanı yoktur.

## Bilinen sınırlar

- İçerik, uygulamanın **o an** `/config`'te sunduğu dosyadır. ConfigMap değiştirilip pod yeniden başlatılmadıysa eski içerik gelir.
- Route DNS'i zaten Nginx'i gösteriyorsa (geçiş yapılmışsa) `/config` OpenShift'ten değil Nginx'in kendisinden gelir. Uygulama Nginx'te kurulu değilse yanıt 404 ya da HTML olur ve satır `FAIL config` olur.
- Sürüm playbook'ta yeniden doğrulanmaz. Portal kullanılan PROD okuması 3 saatten eskiyse kalemi kurdurmaz; uygulamada ayrıca sürüm plandakiyle aynı olmalıdır.
- `/config` isteği kurulacak Nginx sunucusundan çıkar; sunucunun route adreslerine HTTPS ile erişimi yoksa satır `FAIL config ... erisilemedi (curl rc=...)` olur.
- Keşif route'un yolunu (`spec.path`) tutmaz. Yol tabanlı bir route'un adresi başka bir uygulamanın route'unda da görünüyorsa Portal o adresi kullanmaz (yukarıda). Aynı host'u paylaşan diğer route keşifte yoksa (ör. platform namespace'inde) bu ayırt edilemez; içerik yine yalnız JSON nesnesi denetiminden geçer, uygulamayla ilişkisi denetlenmez.
- `/config` yönlendirmeyi (yalnız `https`, en çok 3) izler. Yönlendirmenin gittiği adres yukarıdaki host kuralından geçmez; route'u ve pod'u denetleyen biri isteği başka bir `https` adresine yönlendirebilir ve dönen JSON nesnesi `application.json` olur. Yönlendirmeyi kapatmak (2026-11-23 kararı "https-only redirect" diyor) kullanıcıya sorulacak açık bir karardır.

## Hata ve geri alma notları

Deployment adımı ya da doğrulama düşerse geri alma yalnız hedef **bu koşunun** ise yapılır:

| Durum | Ne yapılır | Mesaj |
|---|---|---|
| `/usr/nginx/applications/<ns>/<app>/.version` planlanan sürümü taşıyor | `nginx_delete.sh <ns> <app>`. Betiğin açtığı `/hysdeploy/<ns>` boş kaldıysa o da silinir. | `geri alma: nginx_delete.sh rc=0 ...` |
| Uygulama dizini yok, ama var olan conf'lar bu uygulamanın dizinini gösteriyor (sunucu conf'u için: bu uygulamanın app conf'unu `include` ediyor) | `nginx_delete.sh <ns> <app>` | aynı |
| Uygulama dizini de conf'lar da hiç oluşmamış (ör. `pre_deployment` düştü) | Yalnız betiğin indirdiği dosyalar silinir; `nginx_delete.sh` çağrılmaz | `geri alma: hedef olusmamisti, indirilen dosyalar silindi` |
| Uygulama dizininin yanında başka bir işin unzip yedeği (`<app>_<job>`, job bu koşu değil) var: aynı sürümü kuran başka bir deployment araya girmiş | **Hiçbir şeye dokunulmaz** | `geri alma yapilmadi: ... baska bir isin yedegi var: <app>_<job>` |
| Diğer her durum (`.version` başka ya da yok, conf başka yeri gösteriyor) | **Hiçbir şeye dokunulmaz** | `geri alma yapilmadi: hedef baska bir surec tarafindan degistirilmis (...) - elle inceleyin` |

Geri almanın sınırları:

- `.version` dosyasını `nginx_unzip.sh` en son yazar. `unzip` adımı yarıda düşerse uygulama dizini `.version` olmadan kalır. Bu durumda geri alma yapılmaz; mesaj elle incelemeyi söyler (`nginx_delete.sh <ns> <app>`).
- `nginx_delete.sh`, `/hysdeploy/<ns>/<app>` dizinini de siler. Bu dizin kurulumdan önce varsa iş zaten `SKIP` olur; pipeline'ın yüklediği paket bu yüzden silinmez. `nginx_delete.sh` yedeği `/sw` altına alır; ayrıntı için bmw_nginx README "Uygulama silme" bölümüne bakın.
- Geri alma da düşerse mesaj `geri alma BASARISIZ: nginx_delete.sh rc=<n>` olur. Bu durumda sunucu elle incelenir.
- Süre sınırı (`timeout`) deployment adımı sırasında dolarsa betik yarım kalmış olabilir. Mesaj `nginx_delete.sh <ns> <app>` ile elle geri almayı söyler.
- Aynı iş tekrar koşturulursa `SKIP` döner: yarım kalan kurulum, hedefi oluşturduysa üzerine yazılmaz.

## Tuzaklar

- Playbook'ta `#` yorum satırı ve `{{ }}` içinde kaçışlı tırnak yoktur. Sekme karakteri play değişkeni `spi_tab` olarak YAML'da tanımlıdır.
- Kapılar (plan bağlılığı, PROD onayı, eşzamanlı iş, 24 saat, 3 saatlik bayatlık) Portal'ın paket ucundadır (`server/spa-report/paket-kurulum.cjs`). Şablon AWX'ten ya da Portal'ın genel "playbook çalıştır" ekranından elle başlatılırsa bu kapılar yoktur; geriye playbook'un kendi kapıları kalır: sunucular `spi_allowed_hosts` alt kümesi, `config_urls` biçimi, `/config` geçerli JSON nesnesi, hedef / paket dizini varsa `SKIP`. Sürüm elle başlatmada hiç doğrulanmaz. Şablonu elle başlatmayın; AWX'te yalnız Portal'ın kullanıcısına yetki verin.
- Bekçi: `server/ansible/__tests__/spa-package-install.test.js` (SPI1-SPI22, SPI28-SPI34, SPI41-SPI48). Betiği gerçek bash ve gerçek Python JSON denetimiyle, sahte `HYSUXSCRIPTS` / `curl` / `unzip` araçlarıyla koşturur.
