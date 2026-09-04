# ScaleX — AWX Kurulum Rehberi

ScaleX iki AWX job template'i kullanır. Bu rehber, klasörün kopyalanmasından
portalda "aktif" hale gelmesine kadar olan **tüm** adımları içerir.

**Özet akış:** klasörü kopyala → iki template oluştur → survey'leri API ile yükle →
Admin > Playbook Kayıtları'na Template ID gir → SMART/OCO ayarını tanımla → kullan.

---

## 1. Klasörü AWX projesine kopyala

```bash
# Portal reposundan AWX proje reposuna. HEDEF KLASOR SERBEST; tek sart
# `global_variables/` ile KARDES olmasi.
cp -r server/ansible/scalex_file/scalex_app  <awx-projesi>/<klasör>/
```

`scalex_app/`, `global_variables/` ile **kardeş** olmalı — playbook'lar
`../global_variables/credentials.yaml` ve `../global_variables/mail_vars.yml`
dosyalarını bu göreli yoldan okur. Üretimdeki kurulum
`bmw_portal/scalex/scalex_app/` yolunda (AWX job #3280508 ile doğrulandı);
template'in **Playbook** alanına o projedeki gerçek yolu yazın.

AWX'te **Projects > (proje) > Sync** ile yeni dosyaları çek.

---

## 2. İki job template oluştur

| Alan | `scalex_run` | `scalex_discovery` |
|---|---|---|
| **Name** | ScaleX — Replica İşlemi | ScaleX — Keşif |
| **Description** | OpenShift replica durdurma / geri alma / ölçekleme | Workload / durum / sağlık keşfi (salt okunur) |
| **Job Type** | `run` | `run` |
| **Inventory** | BMW - Openshift Jump Server Inventory | (aynı) |
| **Project** | ANSIBLE_6203 | (aynı) |
| **Playbook** | `<klasör>/scalex_app/main.yml` | `<klasör>/scalex_app/discovery.yml` |
| **Credentials** | `application_was_credentials` (ssh) + `uxmid_all_credentials_vault` (vault) | (aynı) |
| **Verbosity** | 2 | 1 |
| **Variables → Prompt on launch** | ✅ **AÇIK** | ✅ **AÇIK** |
| **Survey** | Adım 3'te API ile yüklenir, `survey_enabled: true` | (aynı) |

### ⚠️ "Prompt on launch → Variables" kapalıysa

AWX gönderilen `extra_vars`'ı **sessizce yok sayar**: HTTP 201 döner, iş başlar,
playbook boş girdiyle çalışır. Hata mesajı yoktur. Bu tuzak bu kurumda üretimde
yaşandı ve teşhisi pahalıydı.

İki koruma var:
- Portal launch'tan **önce** kontrol eder (`server/ansible/template-preflight.cjs`)
  ve kapalıysa **409** ile reddeder, işi hiç başlatmaz.
- Playbook kendi kataloğuna düştüğünde bunu `catalog_source: file` olarak raporlar;
  ekran bunu uyarı olarak gösterir.

`scalex_clusters_override` ve `scalex_target_clusters` survey'de **yoktur**
(AWX survey soruları skalerdir, dict/list taşıyamaz) — bu ikisi yalnızca
"Prompt on launch" yoluyla gelir. Kapalıysa portal kataloğu hiç ulaşmaz.

Template ID'yi URL'den not alın: `/templates/job_template/**123**/details`

---

## Paket sürümü — kopyalamayı unutmadığınızı nasıl anlarsınız

`scalex_app/VERSION` bir sayı taşır ve `files/scalex_runner.sh` içindeki
`PACKAGE_VERSION` ile aynıdır. Çalıştırıcı her işte ilk satırda bunu bildirir:

```
<cluster>;<jump>;-;-;RUNNER;INFO;package_version=3 phase=discover
```

Portal kendi beklediği sürümü biliyor (`server/scalex/result.cjs`
`EXPECTED_PACKAGE_VERSION`) ve uyuşmazlıkta keşif ekranında **söyler**:
"AWX'te 3 numaralı paket koşuyor, portal 5 bekliyor."

Bu paket AWX'e **elle** kopyalandığı için, portal güncellenip `scalex_app/`
kopyalanmadığında eskiden ortada hiçbir işaret olmuyordu; ekran yalnızca
"güncel sürüm kopyalanmamış olabilir" diye tahmin ediyordu.

**Sürümü artıran her değişiklikten sonra klasörü yeniden kopyalayın ve
survey'i yeniden yükleyin.**

> **Sürüm 4 (2026-09-04):** keşif artık tip listesini `oc api-resources` ile cluster'dan
> alıyor, `api_absent` / `no_permission` ayrımı bu envantere dayanıyor ve `WORKLOAD_KIND`
> satırı **tam kaynak adını** (`resource=statefulsets.apps`) taşıyor. Portal bu alanı
> ekranda RBAC cümlesinde kullanıyor. `scalex_app/` yeniden kopyalanmalı.
>
> Sürüm ile paket içeriği bir daha sessizce ayrışmasın diye `scalex_app/PACKAGE_MANIFEST`
> runner'ın sha256'sını tutar; `scalex_runner.sh` değişip sürüm artmazsa test kırmızı olur
> (`scalex-awx-package.test.cjs`, S9).

## 3. Survey'i API ile yükle

> **Neden API:** survey 17 soru taşıyor ve her sorunun `required: false` olması
> ZORUNLU (gerekçe aşağıda). Arayüzden tek tek girmek hem yavaş hem hataya açık;
> JSON dosyası ayrıca depoda versiyonlanıyor ve testlerle doğrulanıyor.

```bash
export AWX_URL="https://maestro2"
export AWX_TOKEN="…"                    # Settings > Users > Tokens
export RUN_TID=123                      # scalex_run template id
export DISC_TID=124                     # scalex_discovery template id

# 3.1 — Survey spec'i yükle
curl -sS -X POST "$AWX_URL/api/v2/job_templates/$RUN_TID/survey_spec/" \
  -H "Authorization: Bearer $AWX_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @awx/scalex_run.survey.json

curl -sS -X POST "$AWX_URL/api/v2/job_templates/$DISC_TID/survey_spec/" \
  -H "Authorization: Bearer $AWX_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @awx/scalex_discovery.survey.json

# 3.2 — Survey'i ETKINLESTIR ve Prompt on launch'i AC (ikisi de sart)
for TID in $RUN_TID $DISC_TID; do
  curl -sS -X PATCH "$AWX_URL/api/v2/job_templates/$TID/" \
    -H "Authorization: Bearer $AWX_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"survey_enabled": true, "ask_variables_on_launch": true}'
done

# 3.3 — Dogrula
curl -sS "$AWX_URL/api/v2/job_templates/$RUN_TID/survey_spec/" \
  -H "Authorization: Bearer $AWX_TOKEN" | python3 -m json.tool | head -30

curl -sS "$AWX_URL/api/v2/job_templates/$RUN_TID/" \
  -H "Authorization: Bearer $AWX_TOKEN" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print({k:d[k] for k in ["survey_enabled","ask_variables_on_launch"]})'
# Beklenen: {'survey_enabled': True, 'ask_variables_on_launch': True}
```

**Geri alma** (survey'i tamamen kaldırır):

```bash
curl -sS -X DELETE "$AWX_URL/api/v2/job_templates/$RUN_TID/survey_spec/" \
  -H "Authorization: Bearer $AWX_TOKEN"
```

### ⚠️ Hiçbir survey sorusu `required: true` olmamalı

AWX, `survey_enabled: true` iken **API launch'ında zorunlu survey sorularını
doğrular** ve eksik olan için `400 variables_needed_to_start` döner.

Üretimdeki eski survey'de 14 sorunun 13'ü zorunluydu ve uygulama alanının
değişken adı `oc_app` idi — portal ise `target_app_names` gönderiyor. O survey
aynen açılsaydı **portalın her launch'ı 400 alırdı**.

Bu yüzden bu paketteki survey'lerde:
- Her sorunun `variable` adı portalın gönderdiği `extra_var` adıyla **birebir** aynı.
- Hiçbir soru zorunlu **değil**.
- Portalın **koşullu** gönderdiği alanların (`target_replicas`, `hpa_pin`,
  `mail_cc`) **varsayılanı yok** — varsayılan olsaydı AWX onu gönderilmeyen
  çalıştırmalara da enjekte ederdi (ör. istenmediği halde her işlemde HPA'ya
  dokunmak).
- `target_cluster_name` **serbest metin**; çoktan seçmeli olsaydı katalogda yeni
  bir cluster tanımlandığında survey güncellenene kadar portal 400 alırdı.

Bu kuralların hepsi `server/ansible/__tests__/scalex-awx-package.test.cjs`
tarafından kilitlenmiştir.

---

## 4. Portalda aktifleştir — Admin > Playbook Kayıtları

Bu adım olmadan ScaleX ekranı **çalışmaz** (`501 "Template ID girilmemiş"`).

| Anahtar | Görünen ad | Doldurulacak |
|---|---|---|
| `scalex_run` | ScaleX — Replica İşlemi (OCP) | **AWX Template ID** + **AWX Sunucusu**, *Etkin* işaretli |
| `scalex_discovery` | ScaleX — Keşif (salt okunur) | (aynı) |

Satırlar sunucu açılışında otomatik seed edilir; admin yalnızca bu iki alanı
doldurur. Ekrandaki rozet ID'nin nereden geldiğini söyler:
yeşil `DB: #123` / mavi `.env: SCALEX_TEMPLATE_ID` / gri `Tanımsız`.

**`.env` yedeği** (DB satırı boşsa okunur; DB değeri env'i **ezer**):

```env
SCALEX_TEMPLATE_ID=
SCALEX_DISCOVERY_TEMPLATE_ID=
SCALEX_AWX_SERVER_ID=          # boş = 1
```

> **AWX Sunucusu yanlışsa `AWX HTTP 404` alırsınız** — template başka bir AWX
> sunucusunda aranıyor demektir (`ansible_awx_servers.server_no`).

---

## 5. SMART / OCO onay kapıları

**Admin > Ansible > Self Servis Özelleştirmeleri (FieldOverridesModal)** →
ScaleX'in `(awx_server_id, template_id)` satırı:

| Alan | Not |
|---|---|
| `smartApproval.enabled` | Prod `apply` için **zorunlu** |
| `smartApproval.flowKey` | SMART akış anahtarı |
| `smartApproval.metadataFields` | **"Alanları Getir"** ile gerçek `ElementName`'leri çekip eşleyin — sabit `{application, requestedBy}` hiçbir gerçek akışla eşleşmez ve SMART `400 Invalid Request` döner |
| `smartApproval.integrationKey` | Servis bazında RFF token override'ı (boşsa global) |
| `ocoCheck.enabled` | ScaleX prod'da kapıyı politikadan zaten açık tutar |

### Kapı politikası (2026-09-01)

| Durum | OCO | SMART |
|---|---|---|
| `dry_run` (her ortam) | yok | yok |
| **prod dışı** `apply` | **yok** | **yok** |
| prod `restore` + apply | uyarır, engellemez (gerekçe **zorunlu**) | gerekli |
| prod `stop` / `scale` + apply | gerekli | gerekli |

Ortam bilinmiyorsa **prod sayılır** (kapı açılır). Değişiklik izi ortamdan
bağımsız olarak her zaman tutulur: `scalex_operations` tablosu + denetim kaydı.

> **SMART yapılandırılmadan prod'da `apply` çalışmaz.** Sunucu `503
> smart_not_configured` ile reddeder — bilinçli fail-closed karar. Bu arada
> "Önce kontrol et" (`dry_run`) modu çalışmaya devam eder.

**SMART onayı beklerken AWX'te iş YOKTUR.** İstek portal DB'sinde bekler
(`smart_tickets`), sunucu tarafı 30 sn'de bir SMART'a sorar, onay gelince işi o an
başlatır. 15 dakikada onay gelmezse talep zaman aşımına uğrar ve otomasyon **hiç
tetiklenmez**. Uzlaştırıcı bilet sonucunu `scalex_operations` satırına yazar
(`PENDING_APPROVAL` → `RUNNING` → `FINISHED`), böylece geri alma yolu açık kalır.

---

## 6. Görünürlük

Sunucu açılışında element bazında otomatik seed edilir. Yeniden başlatmadan
yapmak için: `deploy/sql/2026-08-30-scalex-gorunurluk.sql`.

---

## 7. İlk çalıştırma — doğrulama sırası

1. **Lab ortamında keşif** (`workloads`): ekranda uygulama listesi + HPA/GitOps/PDB rozetleri gelmeli.
2. **Lab'da `dry_run` + `stop`**: kapı sorulmamalı, sonuç paneli dolmalı, cluster'a dokunulmamalı.
3. **Test ortamında `apply` + `stop`**: OCO numarası **sorulmamalı**, SMART bileti **açılmamalı**, iş doğrudan çalışmalı.
4. **Prod'da `apply` + `stop`**: OCO numarası sorulur, pencere doğrulanır, SMART bileti açılır.
5. **Geri Al**: uygulama ayağa kalkar, ayna satırı silinir, ConfigMap temizlenir.

---

## 8. Sık karşılaşılan hatalar

| Hata / belirti | Sebep | Çözüm |
|---|---|---|
| `501 "scalex_run" için AWX Template ID girilmemiş` | Admin > Playbook Kayıtları satırı boş ya da pasif | Template ID + AWX Sunucusu gir, *Etkin* işaretle |
| `409 awx_prompt_on_launch_disabled` | Template'te **Variables → Prompt on launch** kapalı | Aç (Adım 2). Portal işi hiç başlatmadan keser |
| `400 variables_needed_to_start` | Survey'de **zorunlu** bir soru var; portal onu göndermiyor | Survey'i bu paketteki JSON ile yeniden yükle (hepsi opsiyonel) |
| `AWX HTTP 404` | Template başka bir AWX sunucusunda aranıyor | Playbook Kayıtları satırındaki **AWX Sunucusu**'nu düzelt |
| "Sonuç bulunamadı" (iş yeşil) | `set_stats` adımı çalışmamış | `tasks/25_publish_result.yml` çalıştığını doğrula; `main.yml` onu `20_build_report`'tan **sonra**, mail'den **önce** çağırır |
| Ekranda `catalog_source: file` uyarısı | AWX `extra_vars`'ı yutmuş (Prompt on launch kapalı) ya da portal katalog gönderemedi | Adım 2'yi kontrol et |
| `503 smart_not_configured` | Prod `apply` isteniyor ama SMART ayarı yok | Adım 5 |
| `skipping: no hosts matched` | Bastion (`jump_server`) AWX inventory'sinde yok | Playbook bastion'ı `add_host` ile dinamik ekler; yine de SSH ile erişilebilir ve credential doğru olmalı |
| `Forbidden: User "system:anonymous" cannot list …` | Bastion hedef cluster'a `oc login` değil | Vault cluster kimliği (`uxmid_*`) ve RBAC'i kontrol et; playbook bunu cluster başına `FAIL` satırı olarak raporlar |
| Geri alma `state ConfigMap not found` diyor | Uygulama eski önekle (`chaos-scale-state-`) durdurulmuş ve okuma kaybolmuş | `scalex_runner.sh` her iki öneki de okur; `STATE_CM_PREFIX_LEGACY` sabitinin durduğunu doğrula |
| `'x' is undefined` ile düşüyor | `when:` ile korunan bir `set_fact` ilklenmemiş | Play başında koşulsuz ilkle (bu paketteki `_cluster_source` / `_result_published` örnekleri) |

---

## 9. Bu paket değişirse

`server/ansible/__tests__/scalex-awx-package.test.cjs` çalıştırın:

```bash
node --test server/ansible/__tests__/scalex-awx-package.test.cjs
```

Testler gerçek `scalex_runner.sh`'i sahte bir `oc` ile çalıştırıp çıktısını
portalın gerçek ayrıştırıcısından geçirir; survey ↔ `extra_vars` eşleşmesini ve
`set_stats` alan listesini de kilitler.
