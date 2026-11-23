# spa_package_install — Intranet SPA paket kurulumu

Bazı PROD intranet SPA uygulamaları OpenShift'te koşuyor ama paketleri Nginx sunucularına hiç gelmemiş. Bu iş, bu uygulamaları geçişleri beklemeden kurar:

- paket Artifactory'den çekilir;
- `application.json` OpenShift ConfigMap'inden alınır;
- kurulum, sunucudaki mevcut deployment betikleriyle (`/vhosting/HYSUXSCRIPTS`) yapılır.

Yalnız **ilk kurulum** yapılır. Hedef sunucuda uygulama zaten varsa (dizin ya da iki conf'tan biri) ya da paket dizini `/hysdeploy/<ns>/<app>` zaten varsa, dosyaların üzerine yazılmaz ve satır `SKIP` olur.

Portal tarafı: Ark SPA > Intranet SPA ekranındaki paket kurulumu (`/api/spa-report/intranet/paket/*`). Uygulamak için Portal'da onay kutusuna `PROD` yazılır.

> **Sahada doğrulanmadı (2026-11-23).** Betikler sahte araçlarla test edildi (`server/ansible/__tests__/spa-package-install.test.js`); gerçek AWX, bastion ve Nginx sunucusunda henüz koşmadı. İlk koşu `plan` kipinde ve tek kalemle yapılmalıdır.

## Portal kaydı

| Alan | Değer |
|---|---|
| Playbook kayıt anahtarı | `spa_package_install` (Admin > Playbook Kayıtları) |
| Ortam değişkeni | `SPA_PACKAGE_INSTALL_TEMPLATE_ID` |
| AWX job template | `bmw_portal/spa_package_install/spa_package_install.yml` |
| Şablon doğrulaması | `server/ansible/template-preflight.cjs` (`BEKLENEN_PLAYBOOK`): şablon başka bir playbook koşturuyorsa iş başlamaz |

## AWX şablonu

- **Extra variables prompt-on-launch AÇIK olmalı.** Kapalıysa AWX Portal'ın gönderdiği değişkenleri yok sayar ve girdi kapısı "Zorunlu degiskenler eksik" diye durur.
- **Limit** boş bırakılır. Hedefler `add_host` ile kurulur; AWX `limit`'i zaten yok sayar.
- **Inventory:** hem bastion'lara hem PROD intranet Nginx sunucularına SSH ile erişebilen bir envanter seçilir. Bastion'lar `terminal_hosts` ile, Nginx sunucuları `spi_items[].hosts` ile dinamik eklenir.
- **Credential:** bmw_nginx deployment şablonlarındaki makine kimliği kullanılır. Nginx tarafında `become: true`, `become_user: www`, `become_method: dzdo` çalışmalıdır. Bastion tarafında OCP kimliği `bmw_openshift_jobs/global_variables/credentials.yaml` dosyasından okunur (app_hub ile aynı).
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
| `spi_validate_certs` | hayır (true) | `false` olursa Artifactory isteği `curl -k` ile yapılır. |
| `spi_download_timeout` | hayır (600) | İndirme süre sınırı (saniye), en çok 3600. |
| `spi_max_zip_mb` | hayır (512) | Paket boyut sınırı (MB), en çok 2048. HEAD'deki Content-Length ve `curl --max-filesize` ile uygulanır. |

## Girdi (extra_vars, Portal kurar)

| Değişken | Açıklama |
|---|---|
| `spi_mode` | `plan` (hiçbir şey yazmaz) ya da `apply` |
| `spi_items` | 1..10 kalem: `{id: '<ns>/<app>', namespace, application, version, cluster, hosts: [..]}`; `hosts` 1..8 sunucu |
| `terminal_hosts`, `ocp_clusters`, `oc_binary` … | `app_hub_ocp.yml` ile aynı OCP fan-out'u (`buildOcpRuntimeVars`) |
| `tower_job_id` | AWX verir; deployment betiklerine `job_no` olarak gider. Sayısal değilse girdi kapısı durur. |

Biçimler: namespace `^[a-z0-9]([-a-z0-9]*[a-z0-9])?$`, uygulama `^[A-Za-z0-9]([-A-Za-z0-9._]*[A-Za-z0-9])?$`, sürüm `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`, sunucu `^[A-Z0-9-]{3,32}$`.

## Akış

| Play | Nerede | Ne yapar |
|---|---|---|
| 1 | localhost | Girdi kapısı: mod, kalem/sunucu sınırları, izinli sunucu alt kümesi, biçimler, kurum değerleri. Bastion'lar `spi_terminal`, Nginx sunucuları `spi_nginx` grubuna eklenir. |
| 2 | bastion (salt okunur) | Önce `ping` ile bastion'a erişim denenir. Erişilemezse o bastion'un her kalemi tek bir hata alır: `bastion erisilemedi: <bastion>`. Erişilirse kalem başına `files/spa_package_ocp.sh` çalışır; yalnız kalemin cluster'ı bu bastion'a aitse. Yalnız `oc login` ve `oc get` kullanılır, Secret okunmaz. Betik `mktemp -d /tmp/spa-pkg-<iş>-<n>.XXXXXX` ile koşuya özel 0700 bir dizin açar; kubeconfig ve oc hata dosyası bu dizindedir ve betik çıkarken dizini siler. Betik `/var/tmp`'ye kopyalanır ve sha1 ile doğrulanır. İş sonunda `/tmp/spa-pkg-<iş>-*` kalıntısı ve betik silinir, temizlik doğrulanır. |
| 3 | localhost | OCP sonuçları `files/spa_package_merge.py` ile birleştirilir: `ansible_playbook_python -I`, yalnız standart kitaplık, girdi stdin'den JSON, çıktı stdout'a JSON, `no_log`. Kurallar aşağıdaki "Kalem geçerliliği" tablosundadır. Geçerli kalemlerden sunucu başına iş listesi kurulur. |
| 4 | Nginx (www, dzdo) | `files/spa_package_host.sh` `/var/tmp`'ye kopyalanır, sha1 ile doğrulanır ve kalem başına çalışır. `application.json` betiğe **stdin** ile verilir. Betik sonunda silinir. |
| 5 | localhost | `set_stats spa_package_install_result` yayınlanır, ardından herhangi bir `FAIL` varsa iş düşer. |

OCP okuması (`spa_package_ocp.sh`): adı uygulama adı olan nesne `deployment | deploymentconfig | statefulset | rollouts.argoproj.io` türlerinin **hepsinde** okunur. Portal'ın ana nesne kuralıyla (`server/app-hub/filo.cjs` `anaNesne`) `spec.replicas` değeri en büyük olan seçilir. Değer yoksa 0 sayılır; eşitlikte bu sıradaki ilk tür kazanır. Örnek: 0 replikalı eski bir Deployment ile 3 replikalı bir Rollout varsa Rollout okunur. Seçilen Argo Rollout `workloadRef` taşıyorsa imaj ve volume'lar ilgili Deployment'ın template'inden okunur. ConfigMap şöyle seçilir:

1. Pod template'teki volume'lar (configMap ve projected) içinden data'sında `application.json` anahtarı olanlar alınır. Tam bir tane varsa o seçilir.
2. Hiç yoksa yedek olarak `-l app=<uygulama>` etiketli ConfigMap'ler aranır. Tam bir tane varsa o seçilir.
3. Sıfır ya da birden çok aday kalırsa `ERR` döner ve adlar yazılır. `application.json` en çok 1 MB olabilir.

### Kalem geçerliliği (`spa_package_merge.py`)

Bir kural tutmazsa kalemin tüm sunucuları `FAIL` / `ocp` olur.

| Kural | Hata metni |
|---|---|
| Cluster Portal OCP kataloğunda olmalı | `cluster Portal OCP katalogunda yok: <cluster>` |
| Bastion erişilebilir olmalı ve sonuç bildirmeli | `bastion erisilemedi: <bastion>`, `Bastion sonuc bildirmedi ...` |
| Bastion `ERR` yazmamış olmalı (ör. birden çok ConfigMap) ve çıktı `END` ile bitmeli | `ERR` metni, `OCP okumasi tamamlanmadi (END satiri yok)` |
| En az bir container imajının yolu `…/<namespace>/<uygulama>` olmalı. Büyük/küçük harf duyarsızdır, registry portu sorun değildir, başka yoldaki yan container'lar yok sayılır. | `imaj yolu uygulamayla eslesmiyor: <imajlar>` |
| Eşleşen imajlar etiketli olmalı; digest (`@sha256:`) ya da etiketsiz imaj kabul edilmez | `imaj etiketsiz ya da digest ile: <imajlar>` |
| Eşleşen imajların hepsi aynı etiketi taşımalı | `uygulama imaji birden cok etiketle kosuyor: <etiketler>` |
| Etiket planlanan sürümle birebir aynı olmalı (Portal'ın saatlik verisi eski olabilir) | `OCP'de kosan surum <etiket>, planlanan <sürüm> (Portal verisi eski olabilir)` |
| Tek bir ConfigMap satırı olmalı | `application.json ConfigMap'i okunamadi` |
| `application.json` base64 çözülmeli, en çok 1 MB, geçerli JSON ve JSON **nesnesi** olmalı (dizi olmaz) | `... base64 cozulemedi`, `... cok buyuk`, `... gecersiz JSON`, `... JSON nesnesi degil` |

## Sunucu adımları (`spa_package_host.sh`)

| Adım (`step`) | İş | Hata olursa |
|---|---|---|
| `check` (plan) | Sırayla denetlenir (tablonun altındaki listeye bakın) | `FAIL` ya da `SKIP`. Hiçbir şey yazılmaz. |
| `download` | `/hysdeploy/<ns>` yoksa açılır ve 777 yapılır. Kural `1-nginx_pre_deployment.sh` ile aynıdır: pipeline yükleyicisi orada yeni uygulama dizini açabilmelidir. Ardından `/hysdeploy/<ns>/<app>` açılır; o an başka bir süreç açtıysa `FAIL` olur ve dizine dokunulmaz. Paket `.<sürüm>.zip.part` dosyasına indirilir. | Betiğin yazdıkları silinir. Betiğin açtığı dizinler yalnız boş kaldıysa silinir. |
| `zip_check` | `unzip -tq` ile sağlamlık, arşiv kökünde `index.html`, ardından `mv -n` ile `<sürüm>.zip` adına taşıma. Hedef zip varsa üzerine yazılmaz (`FAIL`). | Aynı; önceden var olan zip silinmez. |
| `write` | `/hysdeploy/<ns>/<app>/application.json` (0644) yazılır; dosya varsa üzerine yazılmaz | aynı |
| `check` (yeniden) | Kurulum adımlarından **hemen önce** hedefler yeniden denetlenir | Hedef artık varsa `FAIL kurulum sirasinda baska bir deployment hedefi olusturdu`. İndirilen dosyalar silinir, `nginx_delete.sh` **çağrılmaz**. |
| `pre_deployment` `unzip` `configuration` `syntax_check` `reload` | `bash nginx_<adım>.sh prod <ns> <app> <sürüm> portal / <job_no>` | "Hata ve geri alma notları" bölümündeki kurallar. İlk kurulumda yedek olmadığından `nginx_rollback.sh` 49 ile düşerdi. Mesaj geri almanın sonucunu da yazar. |
| `verify` | `server_name` ve listen IP üretilen conf'tan okunur, `/ready` ve `/config` 200 dönmeli | aynı |
| `cleanup` | `nginx_cleanup_backup.sh` | Kurulum `OK` kalır, mesaja uyarı eklenir. |

Plan denetimleri, sırayla:

1. Deployment betikleri var mı. Yoksa `FAIL eksik deployment betigi`.
2. `/usr/nginx/applications/<ns>/<app>`, `/usr/nginx/conf.d/<app>-<ns>.conf` ve `/usr/nginx/conf.d/application-confs/<app>-<ns>.conf` hiçbiri yok mu. Biri varsa `SKIP zaten kurulu (...)`.
3. `/hysdeploy/<ns>/<app>` yok mu. Varsa `SKIP paket dizini zaten var (pipeline yuklemis olabilir); elle bakin`. Dizin, paket ya da `.env` silinmez, üzerine yazılmaz.
4. `/hysdeploy/<ns>` varsa o, yoksa `/hysdeploy` yazılabilir mi. Değilse `FAIL ... yazilabilir degil`. `/hysdeploy/<ns>` sembolik bağsa `FAIL`.
5. Paket HEAD isteği 200 dönüyor mu. Değilse `FAIL paket bulunamadi ya da erisilemiyor (HTTP ...)`.
6. `Content-Type` `application/zip`, `application/x-zip-compressed` ya da `application/octet-stream` mı. Parametre (`; charset=...`) ve büyük/küçük harf yok sayılır. Değilse `FAIL paket ZIP degil (Content-Type: ...)`.
7. `Content-Length` (varsa) `spi_max_zip_mb` içinde mi. Değilse `FAIL paket cok buyuk`.

`config.json` dosyasını ayrıca kopyalamaya gerek yoktur: `nginx_unzip.sh`, `application.json`'u hem `application.json` hem `config.json` olarak kopyalar. Kilitleri de deployment betikleri kendileri alır (`nginx_deploy_lock.sh`).

Betik her yolda tek bir son satır yazar: `RESULT<TAB>status<TAB>step<TAB>mesaj` (`OK | PLAN_OK | SKIP | FAIL`). Çıkış kodu `FAIL`'de 1, diğerlerinde 0'dır. Beklenmeyen çıkışta trap aynı satırı yazar. Mesaja paket adresi ve `server_name` konmaz, çünkü kurum adı Portal DB'sine taşınmamalıdır.

## Çıktı

```yaml
spa_package_install_result:
  mode: plan | apply
  overall: ok | partial | failed
  items:
    - id, namespace, application, version, cluster
      ocp: { ok, image, tag, configmap, error }
      hosts: [ { host, status: PLAN_OK|OK|SKIP|FAIL, step, message } ]
```

OCP okuması düşen kalemin tüm sunucuları `FAIL` / `ocp` olur. Erişilemeyen sunucu `FAIL` / `unreachable` olur. `zip_url` yayınlanmaz.

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

- `application.json`, ortam değişkeni yerine **stdin** ile gider. Bunun iki nedeni var: tek bir ortam değişkeni Linux'ta 128 KB ile sınırlıdır, ve ortam değişkenleri `/proc/<pid>/environ`'da görünür. İçerik `no_log` altındadır.
- Playbook'ta `#` yorum satırı ve `{{ }}` içinde kaçışlı tırnak yoktur. Sekme karakteri play değişkeni `spi_tab` olarak YAML'da tanımlıdır.
- Bilinen sınır: OCP parolası betiğe ortam değişkeniyle gelir, ama `oc login --password=...` onu `oc` sürecinin komut satırına koyar. Login süresince aynı bastion'daki yerel kullanıcılar parolayı `ps` ile görebilir (`app_hub_ocp.sh` ile aynı kalıp). Login'den sonra `OCP_PASS` silinir.
- Kapılar (plan bağlılığı, PROD onayı, eşzamanlı iş, 24 saat) Portal'ın paket ucundadır (`server/spa-report/paket-kurulum.cjs`). Şablon AWX'ten ya da Portal'ın genel "playbook çalıştır" ekranından elle başlatılırsa bu kapılar yoktur; geriye playbook'un kendi kapıları kalır: sunucular `spi_allowed_hosts` alt kümesi, OCP'de koşan etiket = `version`, hedef / paket dizini varsa `SKIP`. Şablonu elle başlatmayın; AWX'te yalnız Portal'ın kullanıcısına yetki verin.
- Bekçi: `server/ansible/__tests__/spa-package-install.test.js` (SPI1-SPI40). Betikleri gerçek bash ile sahte `HYSUXSCRIPTS` / `curl` / `unzip` / `oc` araçlarıyla, `spa_package_merge.py`'yi gerçek Python ile koşturur.
