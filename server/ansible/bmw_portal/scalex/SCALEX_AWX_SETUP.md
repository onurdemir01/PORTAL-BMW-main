# ScaleX — AWX Kurulum ve Yapılandırma Rehberi

ScaleX, OpenShift workload'larının keşfedilmesi ve replica işlemlerinin kontrollü şekilde gerçekleştirilmesi için iki ayrı AWX Job Template kullanır:

* **BMW Portal - ScaleX — Replica İşlemi**
* **BMW Portal - ScaleX — Keşif**

Bu doküman; ScaleX paketinin AWX projesine alınmasından Job Template yapılandırmasına, survey yüklenmesinden BMW Portal entegrasyonuna ve ilk doğrulama testlerine kadar gerekli kurulum adımlarını içerir.

## 1. Genel Akış

Kurulum sırası:

**ScaleX paketini AWX projesine kopyala → AWX Project Sync yap → iki Job Template'i yapılandır → survey JSON'larını API üzerinden yükle → Survey ve Prompt on Launch özelliklerini etkinleştir → yapılandırmayı doğrula → BMW Portal'a Template ID'lerini tanımla → SMART/OCO ayarlarını yapılandır → ilk testleri gerçekleştir.**

---

# 2. ScaleX Paketinin AWX Projesine Alınması

Portal reposundaki ScaleX paketi AWX proje reposunda aşağıdaki canonical konuma alınmalıdır:

```text
bmw_portal/scalex/scalex_app/
```

Paketin dizin yapısı önemlidir.

Playbook'lar:

```text
../../../bmw_openshift_jobs/
```

üzerinden gerekli cluster kimlik/config dosyalarına erişmektedir.

Bu nedenle AWX proje kökünde aşağıdaki yapı korunmalıdır:

```text
<AWX_PROJECT_ROOT>/
│
├── bmw_portal/
│   └── scalex/
│       └── scalex_app/
│
└── bmw_openshift_jobs/
```

Kopyalama komutu (portal deposunun kökünden çalıştırılır):

```bash
cp -r server/ansible/bmw_portal/scalex/scalex_app <AWX_PROJECT_DIR>/bmw_portal/scalex/
```

> Bu iki yol **birebir** böyle olmalıdır. Playbook `vars_files` ile
> `../../../bmw_openshift_jobs/` yolunu kullanıyor; hedef derinliği bir kademe
> kayarsa cluster kimlik dosyaları bulunamaz ve iş "catalog_source: file" ile
> sessizce yanlış katalogla koşar. `AT6` bekçisi (server/ansible/__tests__/
> playbook-tree.test.cjs) bu satırı kilitler — komutu değiştirirseniz bekçi kırmızı olur.

Paket kopyalandıktan veya güncellendikten sonra AWX üzerinde:

**Projects → ANSIBLE_6203 → Sync**

işlemi gerçekleştirilmelidir.

> ScaleX paketinde değişiklik yapıldığında yalnızca portal kodunun deploy edilmesi yeterli değildir. `scalex_app` içeriğinin AWX projesine de aktarılması gerekir.

---

# 3. AWX Job Template Yapılandırması

ScaleX iki Job Template kullanmaktadır.

## 3.1 Replica İşlemi

| Alan                         | Değer                                              |
| ---------------------------- | -------------------------------------------------- |
| Name                         | `BMW Portal - ScaleX — Replica İşlemi`             |
| Template ID                  | `2237`                                             |
| Description                  | OpenShift replica durdurma / geri alma / ölçekleme |
| Job Type                     | `Run`                                              |
| Inventory                    | `BMW - Openshift Jump Server Inventory`            |
| Project                      | `ANSIBLE_6203`                                     |
| Playbook                     | `bmw_portal/scalex/scalex_app/main.yml`            |
| Credential                   | `application_was_credentials`                      |
| Vault Credential             | `uxmid_all_credentials_vault`                      |
| Verbosity                    | `2`                                                |
| Variables → Prompt on launch | **Açık**                                           |
| Survey                       | **Açık**                                           |

## 3.2 Keşif

| Alan                         | Değer                                         |
| ---------------------------- | --------------------------------------------- |
| Name                         | `BMW Portal - ScaleX — Keşif`                 |
| Template ID                  | `2238`                                        |
| Description                  | Workload / durum / sağlık keşfi (salt okunur) |
| Job Type                     | `Run`                                         |
| Inventory                    | `BMW - Openshift Jump Server Inventory`       |
| Project                      | `ANSIBLE_6203`                                |
| Playbook                     | `bmw_portal/scalex/scalex_app/discovery.yml`  |
| Credential                   | `application_was_credentials`                 |
| Vault Credential             | `uxmid_all_credentials_vault`                 |
| Verbosity                    | `1`                                           |
| Variables → Prompt on launch | **Açık**                                      |
| Survey                       | **Açık**                                      |

---

# 4. Prompt on Launch Neden Zorunlu?

Her iki template'te de:

```text
Variables → Prompt on launch
```

özelliği açık olmalıdır.

Bunun AWX API karşılığı:

```json
{
  "ask_variables_on_launch": true
}
```

ScaleX portalı Job Template'i başlatırken çalışma parametrelerini `extra_vars` üzerinden gönderir.

Örneğin:

```text
execution_mode
target_platform
target_environment
target_namespace
target_app_names
operation_action
verification_timeout
scalex_clusters_override
scalex_target_clusters
...
```

`ask_variables_on_launch` kapalıysa portal tarafından gönderilen değişkenlerin AWX job'una aktarılması engellenebilir ve job beklenen parametreler olmadan çalışabilir.

Özellikle:

```text
scalex_clusters_override
scalex_target_clusters
```

survey içerisinde bulunmaz.

Bunlar dict/list yapısında oldukları için doğrudan `extra_vars` üzerinden gönderilir.

Bu nedenle **Survey Enabled** ve **Prompt on Launch** birbirinden bağımsız iki gereksinimdir ve ikisi de açık olmalıdır.

---

# 5. Survey Dosyaları

Survey tanımları repository içerisinde JSON olarak tutulmaktadır.

Replica işlemi:

```text
awx/scalex_run.survey.json
```

Keşif:

```text
awx/scalex_discovery.survey.json
```

Survey'lerin AWX arayüzünden elle oluşturulması önerilmez.

API üzerinden yükleme;

* değişken isimlerinin korunmasını,
* required/default davranışlarının standart kalmasını,
* repository ile AWX arasındaki yapılandırmanın tekrar üretilebilir olmasını

sağlar.

---

# 6. Windows CMD Üzerinden Survey Kurulumu

Aşağıdaki işlemler **Windows Command Prompt (CMD)** üzerinde çalıştırılmalıdır.

Komutları ScaleX repository dizininde çalıştırın.

Örnek:

```text
C:\Users\<USER>\Documents\gar_bmt_ansible_scripts\bmw_portal\scalex>
```

## 6.1 Ortam Değişkenlerini Tanımla

```cmd
set "AWX_URL=https://maestro2"
set "AWX_TOKEN=<AWX_TOKEN>"
set "RUN_TID=2237"
set "DISC_TID=2238"
```

AWX token:

**Settings → Users → ilgili kullanıcı → Tokens**

üzerinden alınabilir.

> Token değerini script, doküman, Git repository veya ekran çıktılarında açık şekilde saklamayın.

Değişkenleri kontrol etmek için:

```cmd
echo %AWX_URL%
echo %RUN_TID%
echo %DISC_TID%
```

Beklenen Template ID'ler:

```text
2237
2238
```

---

# 7. Survey Spec'lerini AWX'e Yükle

## 7.1 Replica İşlemi Survey

```cmd
curl -sS -X POST "%AWX_URL%/api/v2/job_templates/%RUN_TID%/survey_spec/" -H "Authorization: Bearer %AWX_TOKEN%" -H "Content-Type: application/json" --data-binary "@awx/scalex_run.survey.json"
```

## 7.2 Keşif Survey

```cmd
curl -sS -X POST "%AWX_URL%/api/v2/job_templates/%DISC_TID%/survey_spec/" -H "Authorization: Bearer %AWX_TOKEN%" -H "Content-Type: application/json" --data-binary "@awx/scalex_discovery.survey.json"
```

Komutların hata vermeden tamamlanması survey tanımlarının API tarafından kabul edildiğini gösterir.

---

# 8. Survey ve Prompt on Launch Özelliklerini Etkinleştir

Survey'in yüklenmiş olması tek başına yeterli değildir.

Her iki template için de:

```text
survey_enabled = true
ask_variables_on_launch = true
```

olmalıdır.

## Replica İşlemi — Template 2237

```cmd
curl -sS -X PATCH "%AWX_URL%/api/v2/job_templates/%RUN_TID%/" -H "Authorization: Bearer %AWX_TOKEN%" -H "Content-Type: application/json" -d "{\"survey_enabled\": true, \"ask_variables_on_launch\": true}"
```

## Keşif — Template 2238

```cmd
curl -sS -X PATCH "%AWX_URL%/api/v2/job_templates/%DISC_TID%/" -H "Authorization: Bearer %AWX_TOKEN%" -H "Content-Type: application/json" -d "{\"survey_enabled\": true, \"ask_variables_on_launch\": true}"
```

AWX PATCH çağrısı sonrasında template JSON'unu döndürür.

Replica template için çıktıda:

```json
"id": 2237,
"ask_variables_on_launch": true,
"survey_enabled": true
```

Keşif template için:

```json
"id": 2238,
"ask_variables_on_launch": true,
"survey_enabled": true
```

değerlerinin bulunması gerekir.

---

# 9. Survey Yapılandırmasını Doğrula

Önce Replica İşlemi survey'inin gerçekten yüklendiğini kontrol edin:

```cmd
curl -sS "%AWX_URL%/api/v2/job_templates/%RUN_TID%/survey_spec/" -H "Authorization: Bearer %AWX_TOKEN%" | python -m json.tool
```

Çıktının başlangıcında:

```json
{
    "name": "ScaleX | Replica Islemi",
    "spec": [
        ...
    ]
}
```

görülmelidir.

Survey içerisinde örneğin aşağıdaki değişkenlerin bulunması beklenir:

```text
execution_mode
target_platform
target_environment
cluster_selection_mode
target_cluster_name
target_namespace
target_app_names
workload_kinds
operation_action
target_replicas
verification_timeout
verify_warn_seconds
verify_fail_seconds
allow_partial_execution
change_confirmation
bulk_change_confirmation
hpa_pin
mail_to
mail_cc
```

---

# 10. Template Ayarlarını Doğrula

## Replica İşlemi — 2237

```cmd
curl -sS "%AWX_URL%/api/v2/job_templates/%RUN_TID%/" -H "Authorization: Bearer %AWX_TOKEN%" | python -c "import json,sys; d=json.load(sys.stdin); print({k:d[k] for k in ['survey_enabled','ask_variables_on_launch']})"
```

Beklenen:

```text
{'survey_enabled': True, 'ask_variables_on_launch': True}
```

## Keşif — 2238

```cmd
curl -sS "%AWX_URL%/api/v2/job_templates/%DISC_TID%/" -H "Authorization: Bearer %AWX_TOKEN%" | python -c "import json,sys; d=json.load(sys.stdin); print({k:d[k] for k in ['survey_enabled','ask_variables_on_launch']})"
```

Beklenen:

```text
{'survey_enabled': True, 'ask_variables_on_launch': True}
```

Her iki çıktı da bu şekildeyse AWX tarafındaki temel ScaleX template yapılandırması tamamlanmıştır.

---

# 11. Survey Tasarım Kuralları

ScaleX survey'lerinde hiçbir soru:

```json
"required": true
```

olmamalıdır.

Tüm sorular:

```json
"required": false
```

olarak tanımlanmalıdır.

Bunun nedeni portalın alanları işlem türüne göre koşullu göndermesidir.

AWX, survey açıkken zorunlu bir değişken gönderilmezse launch çağrısını:

```text
HTTP 400
variables_needed_to_start
```

ile reddedebilir.

Ayrıca survey'deki `variable` isimleri portalın gönderdiği `extra_vars` isimleriyle birebir eşleşmelidir.

Örneğin doğru değişken:

```text
target_app_names
```

Eski değişken:

```text
oc_app
```

Playbook geriye dönük uyumluluk için eski alanı kabul edebilse de portalın canonical değişkeni `target_app_names`'tir.

---

# 12. Koşullu Alanlarda Default Kullanımı

Aşağıdaki alanlar portal tarafından yalnızca gerektiğinde gönderilir:

```text
target_replicas
hpa_pin
mail_cc
```

Bu alanlara survey seviyesinde zorunlu default verilmemelidir.

Örneğin `target_replicas`, yalnızca:

```text
operation_action = scale
```

olduğunda anlamlıdır.

Benzer şekilde HPA işlemi talep edilmemişse AWX'in otomatik olarak `hpa_pin=true` gibi bir değer enjekte etmesi istenmez.

---

# 13. HPA Davranışı

ScaleX'in temel davranışı:

```text
HPA okunur, varsayılan olarak değiştirilmez.
```

`hpa_pin` varsayılan olarak kapalıdır.

HPA sabitleme açıkça talep edildiğinde HPA `min/max` değerleri hedef replica değerine göre düzenlenebilir.

Ancak:

```text
operation_action = stop
```

ve hedef replica:

```text
0
```

olduğunda HPA pin uygulanmamalıdır.

---

# 14. Doğrulama Süreleri

Replica işlemi survey'inde üç önemli süre bulunmaktadır.

### verification_timeout

Varsayılan:

```text
300 saniye
```

Genel sonuç kontrol süresidir.

### verify_warn_seconds

Varsayılan:

```text
300 saniye
```

Uyarı eşiğidir.

Workload açılırken bu süre aşılırsa ScaleX uyarı üretip beklemeyi bırakabilir.

### verify_fail_seconds

Varsayılan:

```text
600 saniye
```

Özellikle kapatma işleminde kullanılır.

Workload replica değerinin `0` olması bu süre içerisinde gerçekleşmezse işlem başarısız kabul edilir.

---

# 15. BMW Portal Üzerinde Template Tanımları

AWX tarafı tamamlandıktan sonra:

**Admin → Playbook Kayıtları**

ekranına girin.

Aşağıdaki kayıtları yapılandırın:

| Anahtar            | Template                             | AWX Template ID |
| ------------------ | ------------------------------------ | --------------: |
| `scalex_run`       | BMW Portal - ScaleX — Replica İşlemi |        **2237** |
| `scalex_discovery` | BMW Portal - ScaleX — Keşif          |        **2238** |

Her iki kayıtta da:

* doğru AWX sunucusu seçilmeli,
* Template ID girilmeli,
* kayıt **Etkin** olmalıdır.

Bu tanımlar yapılmazsa portal ScaleX template'ini çözemediği için işlem başlatamaz.

---

# 16. Environment Yedek Tanımları

DB tabanlı Playbook Kaydı kullanılmadığı durumda aşağıdaki environment değişkenleri fallback olarak kullanılabilir:

```env
SCALEX_TEMPLATE_ID=2237
SCALEX_DISCOVERY_TEMPLATE_ID=2238
SCALEX_AWX_SERVER_ID=
```

Ancak DB'de Playbook Kaydı tanımlanmışsa DB değeri environment değerinin önüne geçer.

---

# 17. SMART / OCO Onay Kapıları

Prod ortamındaki gerçek değişiklikler için ScaleX onay mekanizmaları uygular.

Yapılandırma:

**Admin → Ansible → Self Servis Özelleştirmeleri**

üzerinden ScaleX template kaydı için gerçekleştirilir.

Başlıca alanlar:

```text
smartApproval.enabled
smartApproval.flowKey
smartApproval.metadataFields
smartApproval.integrationKey
ocoCheck.enabled
```

SMART metadata alanları tahmin edilmemelidir.

**Alanları Getir** fonksiyonu kullanılarak gerçek SMART `ElementName` değerleri alınmalı ve eşleştirme bunlar üzerinden yapılmalıdır.

---

# 18. Onay Politikası

ScaleX çalışma politikasının genel davranışı:

| İşlem                    | OCO           | SMART   |
| ------------------------ | ------------- | ------- |
| `dry_run` — tüm ortamlar | Yok           | Yok     |
| Prod dışı `apply`        | Yok           | Yok     |
| Prod `restore` + `apply` | Uyarı/gerekçe | Gerekli |
| Prod `stop` + `apply`    | Gerekli       | Gerekli |
| Prod `scale` + `apply`   | Gerekli       | Gerekli |

Ortam belirlenemiyorsa güvenli tarafta kalmak amacıyla prod politikası uygulanır.

SMART yapılandırılmadan prod `apply` talebi:

```text
503 smart_not_configured
```

ile reddedilebilir.

`dry_run` işlemleri bundan etkilenmez.

---

# 19. İlk Çalıştırma ve Kabul Testleri

Kurulum sonrasında aşağıdaki sırayla test yapılmalıdır:

1. **Lab — Keşif**

   Uygulama/workload listesi gelmeli ve HPA, GitOps, PDB gibi keşif bilgileri görüntülenmelidir.

2. **Lab — dry_run + stop**

   Cluster üzerinde değişiklik yapılmamalı; precheck ve sonuç raporu oluşmalıdır.

3. **Test — apply + stop**

   Workload gerçekten durdurulmalı. Prod onay kapıları devreye girmemelidir.

4. **Test — restore**

   Workload daha önce kaydedilen replica değerine dönmelidir.

5. **Prod — apply + stop**

   OCO/SMART politikaları devreye girmeli ve onay tamamlanmadan AWX değişiklik işi başlamamalıdır.

---

# 20. Sık Karşılaşılan Hatalar

### `501 "scalex_run" için AWX Template ID girilmemiş`

**Sebep:** Portal Playbook Kayıtları içerisinde Template ID tanımlanmamış veya kayıt pasif.

**Çözüm:** `scalex_run = 2237` ve `scalex_discovery = 2238` kayıtlarını doğru AWX sunucusuyla etkinleştirin.

---

### `409 awx_prompt_on_launch_disabled`

**Sebep:** Template'te `Variables → Prompt on launch` kapalı.

**Çözüm:**

```json
"ask_variables_on_launch": true
```

olduğunu doğrulayın.

---

### `400 variables_needed_to_start`

**Sebep:** Survey içerisinde `required: true` olan ancak portalın göndermediği bir değişken vardır.

**Çözüm:** Repository'deki güncel survey JSON'unu API üzerinden yeniden yükleyin.

---

### `AWX HTTP 404`

**Sebep:** Portal template'i yanlış AWX sunucusunda arıyor.

**Çözüm:** Admin → Playbook Kayıtları içerisindeki AWX Sunucusu eşlemesini kontrol edin.

---

### `catalog_source: file`

**Sebep:** Portalın gönderdiği cluster kataloğu AWX job'una ulaşmamış olabilir.

En önemli kontrollerden biri:

```text
ask_variables_on_launch = true
```

olmasıdır.

---

### `503 smart_not_configured`

**Sebep:** Prod `apply` isteniyor ancak SMART yapılandırılmamış.

**Çözüm:** ScaleX SMART approval konfigürasyonunu tamamlayın.

---

### `Forbidden: User "system:anonymous" cannot list ...`

**Sebep:** Bastion üzerinden hedef cluster'a geçerli `oc login` gerçekleştirilememiş veya kullanılan kimliğin RBAC yetkisi yetersiz.

**Çözüm:** Cluster credential/vault bilgilerini ve OpenShift RBAC yetkilerini kontrol edin.

---

### `skipping: no hosts matched`

**Sebep:** Hedef jump server'ın inventory/host eşleşmesinde veya erişiminde problem olabilir.

**Çözüm:** AWX Inventory, jump server adı, SSH credential ve erişimi kontrol edilmelidir.

---

# 21. Paket Güncellendiğinde Yapılacaklar

`scalex_app` içerisinde davranışı etkileyen bir değişiklik yapıldığında:

1. Güncel `scalex_app` AWX proje reposuna aktarılır.
2. Gerekliyse paket `VERSION` artırılır.
3. `PACKAGE_MANIFEST` güncellenir.
4. AWX Project Sync yapılır.
5. Güncel survey JSON'ları yeniden yüklenir.
6. `survey_enabled` ve `ask_variables_on_launch` tekrar doğrulanır.
7. ScaleX paket testleri çalıştırılır.
8. Önce keşif, ardından `dry_run` ile fonksiyonel doğrulama yapılır.

Test:

```bash
node --test server/ansible/__tests__/scalex-awx-package.test.cjs
```

---

# 22. Mevcut Kurulum Durumu

Mevcut AWX kurulumunda kullanılan template'ler:

```text
Replica İşlemi : 2237
Keşif           : 2238
```

Her iki template için de doğrulanan ayarlar:

```text
survey_enabled          = True
ask_variables_on_launch = True
```

Replica İşlemi:

```text
BMW Portal - ScaleX — Replica İşlemi
Playbook: bmw_portal/scalex/scalex_app/main.yml
Template ID: 2237
```

Keşif:

```text
BMW Portal - ScaleX — Keşif
Playbook: bmw_portal/scalex/scalex_app/discovery.yml
Template ID: 2238
```

Dolayısıyla AWX tarafındaki temel template ve survey entegrasyonu mevcut kurulumda aktiftir.

---

# 23. Hızlı Kontrol Listesi

Kurulum veya paket güncellemesi sonrasında aşağıdaki maddeler kontrol edilmelidir:

* `scalex_app` doğru AWX proje konumunda.
* ANSIBLE_6203 Project Sync başarılı.
* Replica Template ID = `2237`.
* Discovery Template ID = `2238`.
* `scalex_run.survey.json` yüklendi.
* `scalex_discovery.survey.json` yüklendi.
* `survey_enabled = true`.
* `ask_variables_on_launch = true`.
* Survey sorularında `required: true` yok.
* Portal Playbook Kayıtları doğru AWX sunucusuna bağlı.
* `scalex_run` → `2237`.
* `scalex_discovery` → `2238`.
* SMART/OCO prod politikaları tanımlı.
* Lab keşif testi başarılı.
* `dry_run` testi başarılı.
* Test ortamında `apply/stop/restore` doğrulandı.

Bu kontroller tamamlandığında ScaleX, BMW Portal üzerinden AWX tabanlı OpenShift keşif ve replica operasyonları için kullanıma hazırdır.
