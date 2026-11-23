# AWX'e kopyalama haritası

`server/ansible/playbooks/bmw_portal/` klasörü, AWX projesindeki `bmw_portal/` ile **birebir
aynıdır**. Klasörü olduğu gibi kopyalayabilirsiniz:

```bash
cp -r server/ansible/playbooks/bmw_portal/ <AWX_PROJECT_DIR>/
```

Klasör `server/ansible/playbooks/` altındadır (2026-11-20, kurumsal iş #52). Bu dizin portalın
çalıştırdığı kod değildir, AWX çalıştırır; bu yüzden **kurumsal depoya gitmez**: kurumsal aktarımda
silinir ([KALITE-KAPILARI.md](KALITE-KAPILARI.md) "Kurumsal aktarım"). Portal çalışma zamanı yalnız
`server/ansible/playbook-revisions.json`'u okur.

## Neden birebir aynı olmak zorunda

Bu kozmetik bir tercih değil. Playbook'lar kimlik dosyasını **`playbook_dir`'e göreli**
arar:

```yaml
playbook_dir ~ '/../../../bmw_openshift_jobs/global_variables/credentials.yaml'
```

İki repoda derinlik aynı olmazsa, portalda geçen bir şey AWX'te patlar.

> **Üretimde bu oldu (AWX #3296360, #3296365, #3296411 — 2026-09-06).** Playbook AWX'te
> `bmw_portal/logx/ocp/` altına (üç seviye) taşınmıştı ama yolu iki seviye varsayıyordu.
> Kimlik dosyası bulunamadı, **Ansible bunu hata saymadı**, parola boş kaldı,
> `oc login` sessizce patladı ve ekran `Missing or incomplete configuration info`
> diye yanıltıcı bir hata gösterdi — kullanıcıyı elinde olmayan `~/.kube/config`
> dosyasına yönlendirerek. Portal reposunda hiçbir test kırmızı dönmemişti: burada
> ağaç düzdü ve "derinlik" diye bir kavram yoktu.

`server/ansible/__tests__/playbook-tree.test.js` (AT3) artık her playbook'un göreli
yollarının **kendi derinliğiyle** tutarlı olduğunu ölçer.

## Ağaç

| Portal                            | AWX                       | Derinlik |
| --------------------------------- | ------------------------- | -------- |
| `bmw_portal/logx/legacy/`         | `bmw_portal/logx/legacy/` | 2        |
| `bmw_portal/logx/ocp/`            | `bmw_portal/logx/ocp/`    | 2        |
| `bmw_portal/opsx_legacy_dump/`    | aynı                      | 1        |
| `bmw_portal/opsx_openshift_dump/` | aynı                      | 1        |
| `bmw_portal/scalex/scalex_app/`   | aynı                      | 2        |
| `bmw_portal/spa_package_install/` | aynı                      | 1        |
| `bmw_portal/telnet_openshift/`    | aynı                      | 1        |

`bmw_openshift_jobs/` **`bmw_portal/` ile kardeştir** — yani her iki repoda da aynı
kökün altında. Derinlik `d` olan bir playbook'un kimlik dosyasına ulaşmak için
`(d+1)` adet `../` gerekir.

## Ad değişikliği

Portal içinde `ocp_telnet_control` diye anılan playbook AWX'te
**`telnet_openshift/telnet_openshift.yaml`** adıyla durur. Eşleme
`server/ansible/paths.cjs` içindeki `PLAYBOOKS` haritasındadır — tek kaynak orasıdır.

## Kurum değerleri: AWX template Variables (2026-11-20)

Repo public: kurumun sunucu adları, alan adları ve adresleri playbook'lara yazılmaz (kalite kapısı
K17, [KALITE-KAPILARI.md](KALITE-KAPILARI.md)). Bunlar AWX'te verilir: şablonun **Variables** alanında
ya da AWX projesindeki `bmw_openshift_jobs/global_variables/*.yml`'de. Playbook'larda bu değerlerin
varsayılanı **yoktur**; tanımsız değer sessizce eski bir sunucuya gitmez, açık hata ya da "yapılmadı"
satırı verir. Gerçek değerler repo dışında tutulur.

| Değişken                       | Şablon(lar)                                                                                         | Anlamı                                                                                                                             | Tanımsızsa                                                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `portal_yazici_host`           | `nginx_console_fetch`, `nginx_console_push`, `ear_envanter`, `opsx_was_operation`, `nginx_loadtest` | /sw'ye yazan, envanter DB'sine erişen sunucu (kısa ad)                                                                             | fetch: ilk play açılmaz; push / ear / loadtest: girdi kapısı durur, hiçbir şey yapılmaz; opsx_was: işlem yapılır, envanter yazılmaz ve sonuç satırı söyler |
| `portal_envanter_sql_sunucusu` | `opsx_was_operation`                                                                                | `dbo.WASAppsInventory` SQL sunucusu, `ad,port`                                                                                     | envanter yazılmaz                                                                                                                                          |
| `portal_edu_hostlari`          | `nginx_loadtest`                                                                                    | yük testine kapalı EDU nginx listesi (boş liste olabilir)                                                                          | girdi kapısı durur                                                                                                                                         |
| `smtp_host`, `mail_from`       | `opsx_openshift_pod_delete` (ScaleX zaten böyle)                                                    | posta sunucusu ve gönderen (`mail_vars.yml`)                                                                                       | e-posta gönderilmez, iş çıktısında satır                                                                                                                   |
| `opsx_http_proxy`              | `opsx_openshift_pod_delete`                                                                         | Teams webhook vekili (`teams_vars.yml`'ye de yazılabilir)                                                                          | vekilsiz denenir ve iş çıktısına satır düşer; gönderilemezse HTTP durumu yazılır                                                                           |
| `spi_package_base_url`         | `spa_package_install`                                                                               | Artifactory paket kökü (`https://<artifactory>/artifactory/ark-binaries` biçimi); paket `<kök>/<namespace>/<uygulama>/<sürüm>.zip` | girdi kapısı durur, hiçbir sunucuya gidilmez                                                                                                               |
| `spi_allowed_hosts`            | `spa_package_install`                                                                               | kuruluma açık PROD intranet Nginx sunucuları (liste); `spi_items[].hosts` bunun alt kümesi olmalı                                  | girdi kapısı durur                                                                                                                                         |

"Tanımsız" burada üç durum demektir: değişken yok, boş (`""`) ya da null. Üçü de aynı davranır. Sonuç
(`set_stats`) yayınlayan işlerde (`nginx_loadtest`, `nginx_console_fetch`, `opsx_was_operation`) Portal'ın
okuduğu sonuç bu durumda da yayınlanır. `nginx_console_push` ve `ear_envanter` her geçersiz girdide olduğu
gibi girdi kapısında sonuçsuz durur. Neden önemli: `delegate_to` atlanacak görevde bile şablonlanır; tanımsız
değişken ansible-core 2.19+'da, boş ya da null değer her sürümde patlar. Localhost düşer, son play'deki
sonuç hiç yayınlanmaz. Bu yüzden her `delegate_to` çözülemeyen `yazici-sunucu-tanimsiz` yer tutucusuna
düşer (`default(…, true)`), girdi kapıları da değişkeni ilk görevde ister. Bekçi:
`server/ansible/__tests__/kurum-degiskenleri-kosum.test.js`; gerçek `ansible-playbook`, üç durumun hepsi.
Hem core 2.21 hem 2.16'da koşturulur.

ScaleX'in yedek cluster kataloğu (`scalex/scalex_app/openshift_inventory_scalex.yaml`) yalnız AWX'te
durur; repoda biçimi `openshift_inventory_scalex.ornek.yaml` adıyla kurgusal değerlerle vardır. Yukarıdaki
`cp -r` dosya silmez, gerçek katalog AWX'te kalır; gerçek dosyayı repoya **geri kopyalamayın**. AWX
klasörünü silip temiz kopyalarsanız (`rm` + `cp`) gerçek kataloğu yerine koyun; yoksa Portal
`scalex_clusters_override` göndermediğinde katalog okuması "could not locate file" ile düşer.

AWX'e kopyalanmayan kök playbook'lar da aynı kuralla değer alır: `nginx_config_migration.yml`
(`portal_goc_kaynak_host`, `portal_goc_hedefleri`, `portal_ocp_terminal_host`) ve
`ocp_pod_source_extract.yml` (`terminal_host` ve `dest_base_dir` zorunlu; göçte `ocp_extract` iken
`ocp_dest_base_dir` zorunlu).

## AWX'e KOPYALANMAYANLAR

`server/ansible/playbooks/` altındakiler AWX projesinde **yoktur**: portal/AI
tanılaması için dururlar (`nginx_status.yml`, `disk_usage_status.yml`, …). Oraya
kopyalamayın. `AT4` bekçisi iki ağaçta aynı adın bulunmadığını doğrular.

## Yeni playbook eklerken

1. AWX'teki **gerçek** yerini ve adını öğrenin.
2. `server/ansible/playbooks/bmw_portal/` altına aynı yolla koyun.
3. `server/ansible/paths.cjs` → `PLAYBOOKS` haritasına ekleyin.
4. `npm test` — `AT2` kayıtsız dosyayı, `AT3` yanlış derinliği yakalar.
