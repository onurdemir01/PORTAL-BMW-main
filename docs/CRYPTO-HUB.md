# Crypto Hub

Ekibin yönettiği iki üçüncü parti uygulama — **Metaco** ve **Wyden** — için geliştirici ve
rezilyans ekiplerine tek ekran. Kullanıcı önce **uygulama → domain → ortam** seçer; ardından o
kiracının durumunu, sürümlerini ve podlarını görür, gerektiğinde log alır / rollout atar /
replika değiştirir.

> Kaynak: kullanıcının Metaco ve Wyden runbook'ları (2026-09-25/26) + `bmw_automation_folder/crypto_hub`.

---

## 1. Parçalar

| Parça | Yer |
|---|---|
| Ekran | `src/components/crypto_hub/` (`CryptoHubPage`, `PlanModal`, `OpsPanel`) |
| API | `server/crypto-hub/index.cjs` → `/api/crypto-hub/*` |
| Kiracı kataloğu | `shared/cryptoHubTenants.cjs` ↔ `bmw_automation_folder/crypto_hub/vars/tenants.yml` |
| İşlem planları | `shared/cryptoHubActions.cjs` |
| Tarama işi | `bmw_automation_folder/crypto_hub/crypto_hub_inventory.yml` |
| İşlem işi | `bmw_automation_folder/crypto_hub/crypto_hub_ops.yml` |
| Tablolar | `dbo.Crypto_Hub_{Components,Releases,ChartTags,Archives,Notes}` |
| Bekçiler | `server/crypto-hub/__tests__/crypto-hub.test.cjs` · `bmw_nginx/tests/check_crypto_hub.py` |

**Katalog iki yerde ama tek doğruluk kaynağı var.** `shared/cryptoHubTenants.cjs` ile
`vars/tenants.yml` **aynı** olmak zorunda; ayrışırlarsa ekran bir ortamı gösterirken iş başka
bir cluster'a bağlanır. CH2 bekçisi anahtar/namespace/cluster/release dörtlüsünü karşılaştırır
(Ansible deposu makinede yoksa karşılaştırmayı atlar, kataloğun kendi tutarlılığını yine
doğrular).

---

## 2. Devreye alma

### 2.1 Veritabanı

```bash
# GBLABT02 üzerinde, was kullanıcısıyla
sqlcmd -S TBMWANSALS.fw.garanti.com.tr,1453 -d TBMWANS -U TBMWANS_usr -i crypto_hub_schema.sql
```

`files/crypto_hub_schema.sql` idempotenttir (`IF OBJECT_ID(...) IS NULL`); tekrar koşmak
güvenlidir. Yeni tablo eklendiğinde (örn. `Crypto_Hub_Archives`) aynı dosya yeniden koşulur.

### 2.2 AWX template'leri

**İki ayrı template** gerekir:

| Playbook | Registry anahtarı | Env değişkeni |
|---|---|---|
| `crypto_hub_inventory.yml` | `crypto_hub_inventory` | `CRYPTO_HUB_INVENTORY_TEMPLATE_ID` |
| `crypto_hub_ops.yml` | `crypto_hub_ops` | `CRYPTO_HUB_OPS_TEMPLATE_ID` |

Her ikisinde de:

* **Survey KULLANILMAZ.** Portal her şeyi `extra_vars` ile gönderir; template'te
  **"Prompt on launch → Variables"** açık olmalı, aksi halde AWX gönderilen değişkenleri
  sessizce yok sayar.
* Credential: `tbmwans_pwd` (yükleyici için) ve cluster parolalarını taşıyan
  `bmw_openshift_jobs/global_variables/credentials.yaml` vault'u.

Template ID'si **Admin ▸ Playbook Kayıtları** ekranından ya da `.env` değişkeninden verilebilir.
Girilmemişse Portal 501 döner ve ekranda "Template ID girilmeli" yazar — sessiz kalmaz.

### 2.3 Sürüm listesi için bastion hazırlığı

* **Wyden**: `gbaocp01` üzerinde `was` kullanıcısında `wyden` helm deposu ekli olmalı
  (`helm repo list | grep wyden` → `https://repo.wyden.io/nexus/repository/wyden/`).
* **Metaco**: chart deposu OCI'dir — güncel yol `metaco.azurecr.io/helm-next/harmonize`,
  yedek yol `helm-flat` (runbook'ta geçen eski yol). Tarama önce günceli dener, cevap
  gelmezse yedeğe düşer ve "katalog güncellenmeli" notu yazar.

### Depo kimlikleri

Kullanıcı adı katalogda durur, **parola durmaz**. Her uygulamanın parolası
`bmw_openshift_jobs/global_variables/credentials.yaml` içinde ansible-vault ile şifreli bir
değişkendir; katalog yalnızca değişkenin **adını** taşır (`registry_cred_key`).

| Uygulama | Kullanıcı | Vault değişkeni |
|---|---|---|
| Metaco | `client-garantibbva` | `metaco_registry_pwd` |
| Wyden | `garantibbva` | `wyden_registry_pwd` |

```bash
ansible-vault encrypt_string --name metaco_registry_pwd
ansible-vault encrypt_string --name wyden_registry_pwd
```

Alternatif: **AWX survey**. Survey'in `password` tipi yanıtı şifreli saklar ve çıktıda
maskeler; iki şartla kullanılabilir:

* **Soru zorunlu (required) olmamalı** — Portal bu template'i API'den, survey doldurmadan
  tetikler; zorunlu soru Portal'ın başlattığı işleri düşürür.
* **Uygulama başına ayrı değişken** kullanılmalı (`crypto_hub_registry_password_metaco` /
  `_wyden`): iki uygulamanın depo kimlikleri farklıdır, tek alan tüm kiracılar taranırken
  yalnız birine doğru gelir.

Sıra: uygulamaya özel → genel → katalog + vault. Doldurulmayan bir survey alanı **boş dizgi**
olarak geldiği için zincirde `default(…, true)` kullanılır; sade `default()` boş yanıtı
"tanımlı" sayıp vault yedeğini sessizce devre dışı bırakırdı.

Kimlik verilmezse sürüm listesi **atlanır** ve ekran "ölçülemedi" der — "yeni sürüm yok"
DEMEZ. Bekçi CH16, parolanın koda sızmadığını her koşuda doğrular.

---

## 3. Kiracılar

`shared/cryptoHubTenants.cjs` içindeki tablo özet olarak:

* **Metaco** — DAS (test, prod, **prod Ankara**) ve GAR (test, prod).
  Ana release `hmz`; **GAR production'da `hmzbank`** (runbook'ta `helm upgrade --install … hmzbank`).
* **Wyden** — dev, test, QA ve production. Her ortamın **iki cluster'ı** var
  (Pendik Hall2 / Hall3), production'da ayrıca Ankara. Aynı namespace hepsinde tanımlı;
  hangisinin ayakta olduğu göçlere göre değişir, bu yüzden **her cluster ayrı kiracıdır** —
  ekran hangisinde replika koştuğunu tahmin etmez, ölçer. Ana release `wydenapp`
  (aynı namespace'te `keycloak` ve `wyden-vault-<ortam>` de vardır).

---

## 4. Production kapısı

Kullanıcı kararı (2026-09-26): **production ortamları şimdilik kapalı.**

* `shared/cryptoHubTenants.cjs` → `PRODUCTION_ENABLED = false`
* `crypto_hub_inventory.yml` / `crypto_hub_ops.yml` → `crypto_hub_include_production`
  (varsayılan `false`)

Kapatma yalnızca görsel değildir: kiracı çözen **her** API ucu kapalı kiracıyı **403** ile
keser (CH7 bekçisi bunu her uç için ayrı ayrı doğrular). Ekranda production ortamı **görünür
ama kilitlidir** — listeden kaldırmak "production nerede?" sorusunu doğururdu.

Geri açarken **iki yer birden** açılmalı: Portal sabiti ve AWX extra_var'ı.

---

## 5. Ekranlar

### Durum
Deployment/StatefulSet listesi: istenen/hazır replika, imaj, sürüm, durum
(çalışıyor · eksik replika · kapalı). Her satırda **Rollout** ve **Replika** işlemleri.

### Ortam seçimi ve geri dönüş

Seçilen kiracı **URL'de** tutulur (`/crypto-hub?t=metaco_gar_test`). Bu sayede yan menüdeki
"Crypto Hub" bağlantısı seçim ekranına döner, tarayıcı geri tuşu çalışır ve bağlantı
paylaşılabilir. Bağlantıdaki anahtar katalogda yoksa ekran bunu söyler ve seçim ekranını açar.

### Podlar
Pod listesi (faz, hazır kap, restart, node), çoklu seçim, **Log göster** ve
**Seçilenleri sil**. Log penceresi: tail 100–5000, `--previous`, kap adı.

### Sürümler
Koşan chart sürümü (ana release'ten), depodaki sürümler ve **bastion'da hazır sürümler**
(indirilmiş chart + values dosyaları). Metaco'da depo sorgulanamadığı için pratik sürüm
geçmişi bu arşivdir.

> **values dosyalarının içeriği Portal'a alınmaz.** `garanti_values.yaml` parola
> barındırabiliyor; yalnızca ad, boyut ve tarih tutulur.

---

## 6. Yazan işlemler ve onay

`Upgrade / Kapat / Aç` işlemleri **ön onay penceresinden** geçer: pencere koşacak komutları
sırayla gösterir, kümeye dokunan adımları ayrı işaretler ve Portal dışı adımları
(LinuxOne, Jenkins, iş birimi) planın içinde bırakır — sırası önemlidir.

Pod silme / rollout / replika da aynı mantıkla önce **koşacak komutu** gösterir. Bu bir ekran
süsü değildir: `/api/crypto-hub/ops` `confirmed: true` almadan **HTTP 428** döner.

### Betik sınırları (`files/crypto_hub_ops.sh`)

| Sınır | Neden |
|---|---|
| Hedefler açıkça verilir; `--all`, `--selector`, `-l` yok | Yanlış bir etiket tüm namespace'i söndürebilir |
| Boş hedefle yazan işlem koşmaz | Boşluk "hepsi" anlamına gelmemeli |
| `--force` yalnız `--grace-period=0` ile | `oc` tek başına `--force`'u yok sayar |
| Log salt okunur, `-f` yok | Takip eden iş AWX'te asılı kalır |
| `pod_delete` yalnız pod alır | `oc delete pod deployment/x` anlamsız ve karıştırıcı |
| `rollout`/`scale` yalnız deployment/statefulset | Yanlış tür sessizce başarısız olmasın |
| Hedef adı k8s desenine uymalı | Kabuk enjeksiyonu kapalı |

---

## 7. "Ölçülemedi" ile "yok" ayrıdır

Bu ayrım her katmanda korunur:

* Chart deposu sorgulanamadıysa sürüm listesi **boş** kalır ama ekran "yeni sürüm yok" demez,
  **"ölçülemedi"** der.
* `oc get statefulset` gibi bir aşama **Forbidden** dönerse bileşen listesi eksiktir; plan
  bunu "bu türdeki bileşenler planda YOK, yetki verilmeden uygulanmamalı" diye yazar (CH12).
* Tarama sıfır satır üretirse yükleyici **veritabanına dokunmaz** (rc 3): boş bir tarama
  ekranı "hiçbir şey yok" diye susturmamalı.

---

## 8. Yetkiler

İşler **servis hesabıyla** koşar (varsayılan `uxmid`, kiracının `credential_key`'inden
parola). "Kim yaptı" bilgisi Portal'ın `ansible_job_history` kaydında durur.

Servis hesabının ilgili namespace'te en az şu yetkileri olmalı:

| İşlem | Gerekli |
|---|---|
| Durum / plan | `get,list` → `deployments`, `statefulsets` |
| Podlar / log | `get,list` → `pods`, `get` → `pods/log` |
| Pod silme | `delete` → `pods` |
| Rollout / replika | `patch,update` → `deployments`, `statefulsets` (+ `statefulsets/scale`) |

> 2026-09-26'da GAR test ortamında `uxmid` için `statefulsets` **list** yetkisi çıkmadı;
> ekran hatayı gizlemeden gösteriyor ama bileşen listesi o türde eksik kalıyor.

---

## 9. Sonraki fazlar

1. **Konfigürasyon** — Helm values / env var / ConfigMap; önce fark, sonra onay, yedek + geri alma
2. **Upgrade'in çalıştırılması** — plan zaten üretiliyor; yazan playbook bağlanınca onay
   düğmesi açılır (`runnable` bayrağı)
3. **Prod'da yazan her işlem** OCO penceresi + Smart onayına bağlanacak
