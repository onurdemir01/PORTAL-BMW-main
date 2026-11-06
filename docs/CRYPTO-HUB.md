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

**`skopeo` kurulu değilse liste kaybolmaz:** tarama Docker Registry v2 API'sine düşer
(önce Basic, olmazsa ACR token takası) ve bu yola düştüğünü NOTE ile yazar. Kimlik curl'e
stdin'den verilir; komut satırına yazılmaz (`ps` ile okunabilirdi). TLS doğrulaması
varsayılan açıktır, `REG_INSECURE=1` ile bilinçli olarak kapatılabilir.

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

### Upgrade akışı

Üç adım: **1) Hedef sürüm → 2) Mevcut values → 3) Uygulanacak komutlar.**

İkinci adımda koşan release'in values'ı (maskeli) gösterilir ve kullanıcıdan
*"bu değerlerle devam ediyorum"* onayı istenir. Upgrade bu dosyayı kullandığı için, içine
bakmadan onaylamak gözü kapalı değiştirmek olurdu.

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

> **values dosyalarının içeriği veritabanında tutulmaz.** Arşiv tablosunda yalnızca ad,
> boyut ve tarih vardır. İçerik **istendiği anda** canlı okunur (aşağıya bakın) ve hiçbir
> yerde saklanmaz.

### values.yaml

Sürümler sekmesinde koşan release'in **values.yaml** düğmesi var. Ekran:

* **Varsayılan maskeli** — `password`, `secret`, `token`, `keystore`… anahtarlarının değerleri
  `****`. Gerçek değerler ancak "Gerçek değerleri göster" ile gelir ve bu istek
  `crypto_hub_values_reveal` olarak denetim kaydına yazılır.
* **Düzenle** — metni değiştirir, yanında satır bazlı **fark** gösterir. Kaydetmeden önce
  dosyanın yedeği alınır (`<dosya>.<tarih>.bak`); yedek alınamazsa yazılmaz.
* **Maskeli metin kaydedilemez.** `****` içeren bir içeriği yazmak gerçek parolayı silerdi;
  hem ekran hem sunucu bunu reddeder.
* Yazmak tek başına kümeye dokunmaz; yeni değerler bir sonraki **upgrade** ile uygulanır.

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
3. **Prod'da yazan her işlem** OCO penceresi + Smart onayına bağlanacak (node değişikliği bağlandı, D8)

---

## 10. Indexer / Node değişikliği (2026-11-02)

Metaco kiracılarında node'a bağlı her **grubun** (yeni tip `uis:<zincirAğ>` ya da eski tip
`eski:<ad>`) şu anki node'u maskeli gösterilir. Yetkili kullanıcı grubun her rolü için yeni
değeri yazıp gerekçe girer, Portal **Smart bileti** açar (Crypto Hub'ın kendi ayarı ya da OpsX
OpenShift flow'u, D7); onaydan sonra mevcut Smart poller'ı `crypto_hub_ops` template'ini `crypto_hub_action=node_change` ile
başlatır (değer launch anında tek bir kancayla eklenir, 10.5).
Kod `server/crypto-hub/node.cjs`, ayar `server/crypto-hub/smart-ayar.cjs`, sabitler
`shared/cryptoHubNodes.cjs`.

### 10.1 Kullanıcı kararları

| # | Karar | Uygulama |
|---|---|---|
| D1 | Crypto Hub ayarı boşsa OpsX OpenShift'in kategorisi (konsolide flow) kullanılır (D7 ile genişledi) | `smartApprovalFor('openshift')`: flow key, metadata şablonu ve integration key OpsX'ten gelir. OpsX'te Smart kapatılmış olsa (`enabled:false`) bile node talebi onaysız **koşmaz**; admin atlama yolu da yok. |
| D2 | Node değeri serbest metin (2026-11-03; iş birimi onaylı) | Node listesi **yok** (iki depodan da kalktı). Kullanıcı sihirbazda rol başına yeni değeri yazar (uis: `rpc`; eski tip rollere göre, ör. solana `rpc`+`ws`, btc `p2p`+`rpc`, polkadot `url`+`auth`). Portal değeri Python ile **aynı** kurallarla doğrular (`shared/cryptoHubNodes.cjs` `degerDogrula`, 10.5), DB'de yalnız şifreli tutar, ekranda / Smart'ta / denetimde yalnız maskeli değer + sha256 gösterir. Bir rol **boş** bırakılabilir: env boş değere yazılır; sihirbaz açık uyarı ve ayrı onay kutusu ister (`bosOnay`). |
| D3 | Eski tip de değiştirilebilir | 11 eski grup (10.7) + yeni tip `uis-*` grupları tek kuralla (10.9: adapter/api `NODE_ADDR`, indexer `NODE_URI_<ZA>` yoksa `NODE_ADDR`, processor yok). |
| D4 | İstanbul ve Ankara ayrı talep | Her kiracı ayrı talep, ayrı bilet. `metaco_das_prod` talebinden sonra yanıttaki `esTalepOnerisi` Ankara'yı önerir (değer taşımaz; Ankara değerini kullanıcı yeniden yazar); Ankara talebi `esTalepId` taşır. İstemci göndermezse (sihirbaz kapatılıp yeniden açıldı) sunucu, İstanbul'da aynı grup için son 7 günde açılmış, reddedilmemiş ve başka Ankara talebine bağlanmamış talebe **kendisi** bağlar. |
| D6 | Bileşenlerin aynı node'da olup olmadığı bilinmiyor (2026-11-02) | Sihirbaz node taşıyan bileşenleri **işaretli** getirir (varsayılan birlikte); kullanıcı işareti kaldırıp alt küme seçebilir; seçilenler arasında hepsi ya da hiçbiri. Her bileşenin şu anki node'u yanında. Bileşenler farklı node'lardaysa "Bileşenler farklı node'lara bağlı" notu; **seçilenler** farklı node'lardaysa (tek node'a toplama) ek onay. Smart kaydı değişecek ve değişmeyecek bileşenleri ayrı satırlarda yazar. Tek deployment'lı gruplarda (eski tip) seçim gösterilmez. |
| D7 | Crypto Hub'ın kendi Smart ayarı (2026-11-06) | Sağ üstte yalnız Admin'e görünen "Smart Onayı" penceresi; `portal_config_blobs` `crypto-hub:smart` satırı, her okuma DB'den. **Blok kuralı:** flow + şablon ikisi boş → OpsX OpenShift bloğunun tamamı; ikisi dolu → Crypto bloğu (token Crypto'nun, yoksa sistem token'ı, OpsX'in değil); yarım → PUT 400, talep 503. Yalnız yorum içeren şablon boş sayılır. Ayar okunamazsa talep 503 alır, OpsX'e **düşmez**. **Kapatma:** `enabled:false` yalnız `tenant.production === false` kiracıda ve etiket savunmasıyla etkilidir (`smartKapaliMi`); kaynak yalnız `tenantOf` sabit listesidir, gövde ve `NODE_ENV` okunmaz. Production kiracıda bu satır hiç etkili olmaz. OpsX'in `enabled`'ı burada okunmaz. Kapalı test kiracısında iş onaysız başlar (10.2 adım 2b), denetime yazılır. `admin-smart-atla` bağlanmaz. **Ekranın gördüğü mod:** sihirbaz onaysız metni gösterdiyse gövdede `onaysizKabul: true` gider. Bu alan kararı VERMEZ (`smartKapaliMi` gövdeyi görmez), yalnız durdurur: sunucunun kararına uymuyorsa iki yönde de **409 `crypto_node_smart_mod_degisti`**, satır yazılmaz, bilet ve iş başlamaz. |
| D8 | Node değişikliğinde OCO (2026-11-06) | **Karar:** `ocoGerekliMi(tenant, blob)`. Production ya da üretim etiketli kiracıda (`tenant.production !== false` dahil) her zaman zorunlu; test kiracıda yalnız `crypto-hub:smart` satırındaki `ocoTest === true` iken. Varsayılan kapalı: `OCO_API_URL` tek servis, test için ayrı OCO yok. `ocoCheck.environments` kullanılmaz (`env`/`ortam` anahtarına bakar, node `extra_vars`'ında yok, `prod_ank`'i production saymaz). Ayar okunamazsa talep 503. **Pencere:** bilet `PENDING` kalır, iş pencerede başlar (10.10); AWX schedule kullanılmaz, numara `extra_vars`'a konmaz, `plan_sha` ve Ansible değişmez. Ufuk `OCO_UFUK_GUN=7`; son başlama pencere sonu − `OCO_SON_PAY_DK=30`, ama pencere açıldıktan sonra en çok `OCO_ACIK_BEKLEME_DK=1440` (uzun OCO'da bilet ve kilit pencere sonuna kadar sürmez). |
| D5 | Yalnız yetkili kullanıcı | Yeni öğe `cryptohub:node:degistir` (Admin › Crypto Hub Erişimi › "node"). Tek başına yalnız Indexer / Node sekmesini açar. `app:metaco` tek başına talep **açtırmaz**, yalnız görüntületir. |

### 10.2 Akış

1. **Okuma**: `POST /api/crypto-hub/node-read {tenant}` → `node_env_get` (salt okunur, Smart'sız).
   Sonuç `GET /node-read/:serverId/:jobId` ile alınır; 10 dk taze sayılır.
2. **Talep**: `POST /node-change {tenant, grup, yeni, bosOnay?, gerekce, tutarsizlikOnay?, onayMetni?, esTalepId?, bilesenler?}`.
   `yeni` = rol → yeni değer (serbest metin, **kırpılmaz**; anahtarlar grubun rolleriyle birebir,
   değilse **400 `node_girdi`**). Biçim hatası **400 `node_deger_bicim`** (gövdede `rol`, `neden`),
   boş rol + `bosOnay !== true` **400 `node_bos_onay`**, girilen değerin sha256'sı seçilen her
   literal satırdakiyle aynıysa **409 `node_ayni_node`**, izin listesi yoksa **409 `node_izin_yok`**.
   `bilesenler` = değişecek deployment adları (yoksa node taşıyan hepsi; boş, grup dışı ya da
   node taşımayan bileşen **400 `node_secim`**). Plan yalnız seçilenlerden; `expect` grubun TÜM
   literal satırlarını taşır (seçilmeyen bileşen onay beklerken değişirse iş yazmadan durur).
   Sıra: yetki → kiracı açık mı → girdi → okuma taze mi → grup planı (değişken yok / ölçülemedi /
   referans / GitOps / araç / bileşen seçimi / değer şekli / değer biçimi / boş onayı / aynı değer
   (seçilenler) / tutarsızlık (seçilenler) / prod'da grup adı) → Smart ayarı (D7; okunamazsa
   **503 `crypto_node_smart_okunamadi`**, yarımsa **503 `crypto_node_smart_yarim`**; ortak
   `nginxRedCevirici` bu POST'ları istemciye 424 + `upstreamStatus: 503` + `nginxRed` olarak iletir,
   `safeJson` fırlatır, sihirbaz sunucunun metnini gösterir) → ekranın gördüğü mod (D7) → template → **tekil indeks kapısı** → **OCO kapısı (D8, 10.10; önizlemede çalışmaz)** → **şifreleme anahtarı kapısı (prod)** → satır `ACILIYOR`
   (değer `yeni_deger_secret`'ta şifreli) → preflight + survey ön doldurma → template değişkenleri (şablon bağlamı;
   OpsX bloğunda OpsX OpenShift template'i, kendi blokta `crypto_hub_ops`) → bilet (`pending_launch_json`'da yer tutucu
   `crypto_hub_node_yeni_b64: ''`) → satır `BEKLIYOR`.
2b. **Smart kapalı test kiracısı (D7)**: satır `ACILIYOR` + `sonuc_kod='ONAYSIZ'` yazılır, preflight
   ve ön doldurma aynıdır; sonra `dogrudanBaslat`: ayar yeniden okunur → `launchOncesiDegerEkle`
   (`id:null`; plan/zarf/sha denetimleri ve gizliler) → CAS `ACILIYOR → CALISIYOR` +
   `yeni_deger_secret = NULL` (`rowCount !== 1` ise iş başlamaz) → denetim
   `crypto_hub_node_onaysiz_calisti` (AWX'ten **önce**) → `performSsLaunchOnServer` (poller ile aynı
   gövde, `yutmaKorumasi: true`, gizliler, `specFields` password) → job bağı → denetim
   `crypto_hub_node_change_talep` (`ticketId: null`). Yanıt `{ok, pendingApproval:false, onaysiz:true,
   talepId, jobId, awxServerId}`. İş kesin başlamadıysa (AWX 4xx, JSON olmayan vekil 4xx, bağlantı
   kurulamadı, token alınamadı) satır `HATA/DOGRUDAN_HATA`, 409. Zaman aşımı / 5xx / kopan bağlantı:
   iş başlamış olabilir; satır `CALISIYOR` açık kalır, kilit korunur, yanıt **424**. AWX değişkenleri
   yuttu ve iş iptal edilemediyse job numarası satıra bağlanır, yanıt yine 424 ama metin işi AWX'ten
   durdurmayı söyler. Job yoksa satır 90 dk sonra `OLCULEMEDI/TAKILDI` kapanır; job varsa AWX sonucu okunur. Önizleme bu
   modda da Smart yolunda kalır. `/ops` node işlerini yine tanımaz.
3. **Onay**: Smart poller → runner poller geri çağrısında **tek kanca**
   `pendingLaunch.launchOncesi === 'crypto_hub_node'` → pencere kararı `launchPenceresiDenetle` (D8) →
   `launchOncesiDegerEkle` (şifreli kolonu
   çözer; talep no, kiracı/grup, bilet, `plan_sha` ve değerlerin sha256'sı `new_sha` ile
   tutmazsa iş başlamaz) → `performSsLaunch(extraVars: launchExtraVars)`. Kanca başka bilet
   türünde çalışmaz, Crypto bileti AWX schedule dalına hiç girmez; launch hatası metni
   `gizliTemizle`'den geçer (değer `smart_tickets.error_message`'a düşmez). Onay süresi
   **1440 dk** (`pendingLaunch.onayZamanAsimiDk`; OCO'lu talepte verilmez, son tarih son başlama saatidir), `yutmaKorumasi: true`.
4. **Sonuç**: 5 dk'lık arka plan taraması ve `GET /node-change/:id` satırı ilerletir. Smart
   `REJECTED/TIMEOUT/CANCELLED/ERROR` → `REDDEDILDI/ZAMAN_ASIMI/IPTAL/HATA`. İş bitince
   `crypto_hub_ops_result` içindeki `NODESUM` → `BASARILI/GERI_ALINDI/BAYAT/BASARISIZ`.
   `NODESUM <kiracı> <sonuç> <plan_sha|-> <talep|-> <kod>`: başarı yalnız talep no **ve**
   `plan_sha` birebir eşleşirse; `-` yalnız olumsuz sonuçta kabul edilir.
   **NODESUM yoksa ya da başka talebe aitse `OLCULEMEDI`** (başarı uydurulmaz). Kapatma tek
   kezdir (`kapandi_at IS NULL` CAS); sonuç denetimi (`crypto_hub_node_change_result`) bir kez,
   talep sahibi adına yazılır.
5. **Takılan talep**: bilete bağlanmış açık satır `ONAY_DK + 30 + 60` dk'yı (`TAKILDI_DK`; OCO'lu
   talepte en az son başlama + 120 dk; normal pencerede bu pencere sonu + 90 dk'dır) aşar ve
   iş sonucu hâlâ okunamıyorsa (bilet `LAUNCHING`'de takılı, `LAUNCHED` ama job yok, `SCHEDULED`,
   Smart yapılandırılmamış ve hiç `TIMEOUT` olmayan `PENDING`, AWX kalıcı hata) satır
   **`OLCULEMEDI/TAKILDI`** kapanır — başarı sayılmaz, ekran "durum bilinmiyor, mevcut node'ları
   okuyun" der. Bilet hâlâ `PENDING` ise Portal'da iptal edilir (sonradan onaylansa da iş
   başlamaz). İptal edilemezse (poller bileti bu arada almış olabilir) satır ve kilit açık
   kalır, sonraki taramada yeniden denenir. AWX işi okunabiliyor ve sürüyorsa satır açık kalır.
6. **Yönetici kapatması**: `POST /node-change/:id/kapat {gerekce}` — yalnız Admin, gerekçe 10–500.
   Satır `IPTAL/ADMIN_KAPATTI` kapanır (kilit açılır), `PENDING` bilet Portal'da iptal edilir,
   `crypto_hub_node_change_admin_kapat` ve sonuç denetimi yazılır. Takip penceresinde
   "Talebi kapat (yönetici)" düğmesi. AWX işi başlamış talep (`awx_job_id` dolu) ya da Portal'da
   iptal edilemeyen `PENDING` bilet **409** ile kapatılmaz. Smart kaydı okunamıyorsa **503**,
   bilet artık `PENDING` değilse (ör. onaylanmış/başlatılıyor) **409** döner; AWX numarası henüz
   satıra yazılmamış olsa da kilit korunur. `ACILIYOR` satırına Smart bileti henüz bağlanmadıysa
   da kapatma **409** döner. Dış bilet açılıp satıra bağlama başarısız olursa Portal başarı
   bildirmez; `PENDING` bilet iptal edilir, iptal yarışı varsa satır açık ve kilitli kalır.
   Kilidi erken bırakmak ikinci bir değişikliğin aynı gruba yazılmasıyla yarışabilirdi; bu
   satırlar iş sonucuyla ya da 5. maddedeki süreyle kapanır.
7. **Numara metni**: bekleyen talep her yerde aynı biçimde: Smart numarası varsa `Smart #<no>`,
   yoksa `Portal #<talep>` (`shared/cryptoHubNodes.cjs` `talepNoMetni` = ekran `smartNo`).

### 10.3 Smart şablonu (admin)

İki yer vardır (D7). **Crypto Hub › Smart Onayı** penceresinde Flow Key + şablon doluysa o
kullanılır: Alanları Getir, Otomatik Doldur ve Önizle (`POST /smart-config/onizle`, gerçek
`cryptoNodeMetadata`, örnek talep, Smart'a gitmez) burada çalışır. Şablon yine aşağıdaki `opsx.*`
bağlamıyla yazılır; `extraVars.*` `crypto_hub_ops` template'inden gelir, OpsX sabit ek değişkenleri ve
anahtar adları karışmaz; bilet metnindeki "OpsX OpenShift onay akışı ortak kullanılır" ibaresi
yazılmaz. Entegrasyon anahtarı `encryptSecretValue` ile saklanır, API'de yalnız
`integrationKeySet` döner; şifreleme anahtarı yoksa kaydı reddedilir. Boş bırakılırsa sistem
token'ı kullanılır (OpsX'inki değil). Flow Key silinir ya da değişirse kayıtlı anahtar da silinir
(flow'lar ayrı anahtarla yayınlanabilir). Çözülen token yalnız `createTicket`'e gider,
`pending_launch_json`'a yazılmaz (`pendingLaunchExtras.overrides: {}`). Çözülemeyen token ekranda
`token_cozulemedi` durumudur, talep 503 alır. Alanları Getir sistem anahtarıyla sorgular.

İkisi de boşsa OpsX ekranı › **Smart Onayı** › OpenShift şablonu Crypto node taleplerini de taşır.
Aşağıdaki tablo bu düşüşü anlatır. Crypto bağlamı OpsX ile **aynı adları aynı sözlükle** doldurur. Bu yüzden mevcut dropdown
eşlemeleri (ör. `{% if opsx.ortam == 'prod' %}Production_9{% else %}…{% endif %}`) aynen çalışır:

| Bağlam | OpsX OpenShift | Crypto node |
|---|---|---|
| `opsx.islem` (≤ 400) | `Openshift rollout (restart)` | `Crypto Hub Indexer/Node Change — <kiracı> (…) — İstanbul/Ankara — <grup> [<id>] -> <yeni maskeli özet ≤ 160> \| Bileşenler: <seçilenler> \| Eski: <eski maskeli>` — bileşen listesi **asla kesilmez**; yeni maskeli özet 160 karakteri aşarsa kırpılır (tam hâli `opsx.aciklama` ve `opsx.yeniNode`'da); kesilecekse önce kiracı öneki kısalır, kalan pay yalnız eski özete verilir. Smart metninde sha256 yoktur |
| `opsx.platform / uretimSebebi / talepEden` | `openshift` / `ortam=prod` / kullanıcı | aynı (`uretimSebebi` test kiracıda boş — OpsX test'te bilet açmaz) |
| `opsx.ortam` | `test` / `prod` | `test` / `prod` (Ankara da `prod`) |
| `opsx.cluster` | `metaco_das` … | `metaco_das` / `metaco_gar` |
| `opsx.hedefler` | `ns,app;…` | `<namespace>,<deployment>;…` (yalnız seçilenler) |
| `extraVars.oc_cluster / oc_input / oc_environment / email / choise` | OpsX değerleri | aynı adlar, Crypto değerleri (`choise: true`) |
| `extraVars.<sabit>` | OpsX yapılandırmasındaki sabit ek değişkenler (`cfg.openshift.extraVars`) | **aynı** sabitler, aynı öncelik (`email` sabitlerde yoksa oturumdan) |
| `extraVars.*` | OpsX OpenShift template değişkenleri (ör. `job_type`) | **aynı** template'in değişkenleri — JOBTYPE gibi alanlar OpsX değerini taşır |
| `extraVars.openshift_operations` | `openshift_application_rollout` | **verilmez** (bu bir rollout değil) |
| `extraVars.target_cluster` | yalnız tek cluster seçilince | **verilmez** (OpsX'te de isteğe bağlı; şablonda `\| default`) |

Eşlik bekçisi `node-birim.test.cjs` N5c GERÇEK `opsxProductionKapisi`'ni koşturur, OpsX'in
şablona verdiği bağlamı yakalar ve `opsx.*` / `extraVars.*` anahtarlarının node bağlamında
olduğunu (adıyla yazılı istisnalar hariç) ve `uretimSebebi` / `talepEden` değerlerinin aynı
olduğunu doğrular. OpsX'e yeni bir anahtar eklenirse bekçi kırmızı olur.

**OCO (D8):** OCO'lu talepte `opsx.aciklama`'ya numara, pencere ve son başlama satırı eklenir.
`opsx.ocoNo` ve `opsx.ocoPencere` şablonda kullanılabilir; önizlemede ve OCO'suz talepte boştur, o
yüzden `{{ opsx.ocoNo | default('') }}` biçiminde yazılır.

**Bilet metni karışmaz (PS5):** `opsx.aciklama`'nın ilk satırı `Crypto Hub Indexer/Node Change —
NODE DEĞİŞİKLİĞİ (rollout/restart değil; OpsX OpenShift onay akışı ortak kullanılır)`; ardından
"Değişecek bileşenler" ve "Değişmeyecek bileşenler" satırları. JOBTYPE gibi dropdown alanları
OpsX template değerini taşır; işlemi ayırt eden metin `opsx.islem` / `opsx.aciklama`'dır.

Yalnız Crypto'nun verdiği ek alanlar (`opsx.aciklama` çok satırlı tam metin, `opsx.kiraci`,
`opsx.lokasyon`, `opsx.grup`, `opsx.grupBaslik`, `opsx.eskiNode` (maskeli), `opsx.yeniNode`
(yeni değerin **maskeli** özeti, ör. `rpc=https://host:8545/****`), `opsx.bosRoller` (boş
bırakılan roller, yoksa `''`), `opsx.gerekce`, `opsx.deploymentlar`, `opsx.esTalep`) şablonda yalnız
`| default(...)` ile kullanılmalı, ör. `ACIKLAMA: {{ opsx.aciklama | default(opsx.islem) }}`.
Aksi halde OpsX'in kendi talebi render hatasıyla düşer. Şablon OpsX'e özgü bir alanı
default'suz kullanırsa node talebi **400 `crypto_node_smart_sablon`** ile açılmaz; şablon boşsa
da 400 döner (sabit nesneyle bilet açılmaz). Şablonda `Production` sabit yazıyorsa test talebi
de Smart'ta Production görünür. Boş rol varsa `opsx.aciklama`'ya "Uyarı: <roller> boş değerle
yazılacak (talep eden onayladı; uygulama node'suz kalabilir)." satırı eklenir. Admin önizleme:
`POST /api/crypto-hub/node-smart-onizle {tenant, grup, bilesenler?}` (Smart'a gitmez, satır
yazmaz, **değer almaz**: yeni özet her rol için `rol=(önizleme)`) — dönen `metadata` her alanın
render edilmiş değerini gösterir; dropdown alanları gönderimden önce buradan kontrol edilir.

**T14 kabul ölçütü (canlı, test kiracı):** konsolide OpsX flow'u şimdiye dek YALNIZ prod
biletleri taşıdı (OpsX test'te bilet açmaz); Faz 1'deki tüm node biletleri `ortam=test` ve boş
`uretimSebebi` ile gider. (1) Önizlemede ve açılan bilette JRENV, JOBTYPE ve **tüm**
`PARAMETER_DROPDOWN` alanları dolu ve doğru görünmeli; test değerinin Name/KeyML karşılığı
`GetModuleParametersWithoutCache`'ten bulunmalı (eşleşmeyen değeri Smart hata vermeden boş
bırakır). (2) JOBTYPE OpsX template değerini (rollout) gösterir: onaycı işlemi `ACIKLAMA`'nın
ilk satırından ("NODE DEĞİŞİKLİĞİ") ayırt eder; ayrı bir iş tipi gerekiyorsa şablonda
`{% if opsx.kiraci is defined %}…{% endif %}` dalı kurulur. (3) Bilet metninde değişecek
bileşenler kesilmeden, yeni değer yalnız maskeli görünmeli.

### 10.4 Veritabanı (Portal DB)

Tablo `crypto_hub_node_changes` (bkz. `server/db/mssql-setup.cjs`). Durumlar: açık `ACILIYOR
BEKLIYOR CALISIYOR`; kapalı `BASARILI GERI_ALINDI BAYAT BASARISIZ OLCULEMEDI REDDEDILDI
ZAMAN_ASIMI IPTAL HATA`. Satır silinmez. D7 doğrudan yolu yeni kolon istemez: açık satırda
`sonuc_kod = 'ONAYSIZ'` işaretidir (kapanışta gerçek kodla ezilir); `smart_ticket_id` boş `CALISIYOR`
satırı başka yolla oluşmaz.

**Kolonlar (2026-11-03):** `yeni_deger_secret NVARCHAR(MAX) NULL` = girilen değerin
(`crypto_hub_node_yeni_b64` metni) `encryptSecretValue` (AES-256-GCM, `enc:v1:`) ile şifreli
hâli; iş AWX'e verildiği tarama turunda (`CALISIYOR` UPDATE'i) ve her kapanışta (`talepKapat`)
**NULL** yapılır. Kolon adı `_secret` ile bittiği için tam yedek onu maskeler. Genel listeler
(`SUTUNLAR`) bu kolonu asla seçmez, yalnız launch kancası okur. `eski_ozet` / `yeni_ozet` /
`sonuc_json` yalnız maskeli. Eski kurulumdaki `yeni_node_id` / `yeni_node_ad` kolonları
düşürülmez (yıkıcı göç yok), `yeni_node_id` nullable yapılır; kod onları okumaz/yazmaz, yeni
kurulumda hiç yoktur.

**OCO kolonları (2026-11-06, D8):** `oco_no NVARCHAR(32)`, `oco_pencere_bas DATETIME2`,
`oco_pencere_son DATETIME2` (hepsi NULL) ve `smart_tickets.approved_at DATETIME2 NULL`. CREATE ve
`alters` ile idempotent eklenir. Setup'taki ALTER hatası yalnız log'a düştüğü için kolonların varlığı
kurulumdan kanıtlanamaz: talep anında `INFORMATION_SCHEMA.COLUMNS` okunur (olumlu sonuç 10 dk
önbellekte). Kolon eksikse OCO'lu talep **503 `node_oco_kolon_yok`** alır, satır yazılmaz. OCO'suz
akış bozulmaz: okumalar `sutunlar()` ile eski kolon listesine düşer, OCO'suz INSERT bu kolonları
hiç adlandırmaz.

**Devreye alma:** Portal ve Ansible ZIP birlikte gider. Öncesinde Portal DB'de
`SELECT id FROM crypto_hub_node_changes WHERE kapandi_at IS NULL` boş dönmeli; açık talep varsa
Admin "Talebi kapat" ile kapatır. Karışık sürüm fail-closed'dur (yeni Portal + eski playbook:
eski assert `crypto_hub_node_id` ister, iş düşer → `OLCULEMEDI`; eski Portal + yeni playbook:
`crypto_hub_node_yeni_b64` yok, assert düşer) ve hiçbir durumda kümeye yazılmaz.

**Tek açık talep:** filtreli tekil indeks
`UX_chnc_acik ON crypto_hub_node_changes (tenant_key, kilit) WHERE kapandi_at IS NULL`.
Talep açılırken indeks `sys.indexes`'te (`is_unique=1`, `has_filter=1`) doğrulanır; yoksa
**503 `node_kilit_indeksi_yok`** döner (fail-closed). BTC ve LTC aynı deployment'ı paylaştığı
için aynı kilidi (`eski-nbxplorer-mainnet`) kullanır.

Yarım kalan açılışlar: `ACILIYOR` satır 10 dk'yı geçerse ve bilet `smart_tickets`'ta varsa
sahiplenilir (`BEKLIYOR`); yoksa `HATA/ACILIS_KESILDI` olur. Yerel kaydı yazılamayan (yetim)
bilet `BEKLIYOR` kalır (ikinci talep açılmasın diye) ve 24 sa sonra `HATA/YETIM_BILET` olur.

### 10.5 Değer kuralı (sızıntı en aza)

**Değerin bulunduğu yerler** (başka yer yok): istek gövdesi → `crypto_hub_node_changes.yeni_deger_secret`
(şifreli; iş başlayınca / kapanınca NULL) → launch kancası (onay sonrası ya da D7 doğrudan yolu; bu
yolda kolon AWX çağrısından **önce** NULL olur, değer yalnız bellekte durur) → AWX `extra_vars`
(`crypto_hub_node_yeni_b64`) ve **AWX iş kaydı**. AWX iş kaydı `extra_vars`'ı (base64 değer
dahil) gösterir — kullanıcı bunu kabul etti. Sonraki adım (zorunlu değil): template anketine
`crypto_hub_node_yeni_b64` için password sorusu eklenirse AWX değeri `$encrypted$` saklar. Soru
zorunlu olmamalı, varsayılanı olmamalı, en çok uzunluğu en az 16384 olmalı. Talep açılırken
`prefillSurveyDefaultsOnServer` sonrasında yer tutucu yine `''` yapılır (zorunlu + varsayılanlı bir
soru onu `$encrypted$` ile doldursa kanca her talebi reddederdi). AWX 4xx gövdesi değeri yansıtsa
da `awxRequestToServer` kancanın gizlilerini (`opts.gizliler`) log satırında, hata metninde ve
`e.body`'de maskeler; poller'ın `error_message`'ı ayrıca `gizliTemizle`'den geçer. Doğrudan yol aynı
`performSsLaunch` gövdesini kullanır; `launchJobOnServer` (gizliler taşımaz) ve `gecmisIcin` (kısa
değeri geçmişe düz yazar) bu yolda **kullanılmaz**.

**Değerin bulunmadığı yerler:** `smart_tickets.pending_launch_json` (yer tutucu `''`; Smart
entegrasyon anahtarı da burada yok),
`ansible_job_history.params` ve launch denetimi (`specFields` password satırı → `***gizli***`),
bilet ayrıntı ekranları, Portal denetimi (`crypto_hub_node_change_talep` yalnız `yeniOzet`
maskeli + `yeniSha` sha256 + `bosRoller` yazar; crypto-hub router'ında `auditMutations` yok,
istek gövdesi denetime düşmez), Portal logları, Smart metadata, ekran (yalnız maskeli; sihirbaz
değeri yalnız bileşen state'inde tutar, URL'ye / tarayıcı deposuna / console'a yazmaz).
Bilinen artık risk (MAKUL): `awxRequestToServer` AWX 4xx gövdesini loglar; AWX launch hataları
değişkenin adını yansıtır, değerini değil.

**Production'da şifreleme anahtarı zorunlu:** `ENV_OVERRIDES_ENCRYPTION_KEY` tanımlı değilse
talep **503 `node_sifreleme_yok`** ile açılmaz (satır yazılmaz, Smart açılmaz); kanca da
production'da `enc:v1:` önekli olmayan değeri reddeder. Dev/test'te mevcut yardımcı davranışı
geçerlidir (anahtarsız düz).

**Doğrulama (iki tarafta aynı, bekçi CHN12 + ortak vektörler `tests/deger_vektorleri.json`):**
boş değilse ASCII yazdırılabilir (`^[\x20-\x7e]+$`), en çok 2048; her biçimde `;`, `` ` ``, `$(`
yok; `url` `^(https?|wss?)://` (küçük harf) ve boşluk / `"` / `$` / `'` / `;` / `<` / `>` /
`\` / `` ` `` yok; `hostport` `host:port` (port 1–65535); `sır` baş/son boşluksuz. Ansible
değeri yeniden doğrular (Portal'a güvenmez). Değer asla kabuğa, argv'ye, ortam değişkenine ya
da oc komut satırına girmez (playbook stdin'le 0600 dosyaya yazar, betik okur okumaz siler).

**Maske:** Portal betiğin maskeli alanlarını bir kez daha süzer: yalnız `şema://host[:port][/****]`,
`host:port`, `****` ve boş literal değer için `(bos)` geçer, gerisi `****` olur.

### 10.6 Production

Faz 1'de prod (İstanbul, Ankara, GAR) okuma dahil **kapalı**. Açılış İKİ anahtarla birlikte
yapılır: `shared/cryptoHubNodes.cjs` `NODE_PROD_ACIK` listesine kiracı anahtarı + Ansible
`vars/tenants.yml` `node_degisikligi_acik: true` (ZIP). `PRODUCTION_ENABLED` ve
`crypto_hub_include_production` bunu açmaz. Bekçi CHN9 iki listenin eşit olmasını ister.
Prod'da talep için grup adı aynen yazılır.

### 10.7 Eski tip gruplar

| Grup | Deployment eki | Kilit | Env'ler |
|---|---|---|---|
| `eski:solana-mainnet` | `solana-mainnet` | `eski-solana-mainnet` | `SOLRPC`, `SOLWSRPC` |
| `eski:btc-mainnet` | `nbxplorer-mainnet` | `eski-nbxplorer-mainnet` | `NBXPLORER_BTCNODEENDPOINT`, `NBXPLORER_BTCRPCURL` |
| `eski:ltc-mainnet` | `nbxplorer-mainnet` | `eski-nbxplorer-mainnet` | `NBXPLORER_LTCNODEENDPOINT`, `NBXPLORER_LTCRPCURL` |
| `eski:btc-testnet` | `nbxplorer-testnet` | `eski-nbxplorer-testnet` | `NBXPLORER_BTCNODEENDPOINT`, `NBXPLORER_BTCRPCURL` |
| `eski:ethereum-mainnet` | `ethereum-mainnet` | `eski-ethereum-mainnet` | `ETH_INDEXER_NODE_URI` |
| `eski:ethereum-testnet-sepolia` | `ethereum-testnet-sepolia` | `eski-ethereum-testnet-sepolia` | `ETH_INDEXER_NODE_URI` |
| `eski:avalanche-c-chain-mainnet` | `avalanche-c-chain-mainnet` | `eski-avalanche-c-chain-mainnet` | `ETH_INDEXER_NODE_URI` |
| `eski:polygon-mainnet` | `polygon-mainnet` | `eski-polygon-mainnet` | `ETH_INDEXER_NODE_URI` |
| `eski:cardano-mainnet` | `cardano-mainnet` | `eski-cardano-mainnet` | `OGMIOS` |
| `eski:xrpl-mainnet` | `xrpl-mainnet` | `eski-xrpl-mainnet` | `XRP_INDEXER_SERVER_URI` |
| `eski:polkadot-assethub` | `substrate-polkadot-assethub` | `eski-substrate-polkadot-assethub` | `SIDECAR_URL`, `SIDECAR_AUTH_VALUE` (sır) |

Deployment adı `<release>-harmonize-<ek>` (DAS `hmz-`, GAR `hmzbank-`). Eski
`bmw_openshift_jobs/metaco/node_changes.yaml` bu akışta **kullanılmaz**; içindeki gömülü SA
jetonları döndürülmeli (ayrı iş). Dosya **silinmez**: `bmw_openshift_jobs/smart_operations/smart_operations.yaml`
onu `import_playbook` ediyor (eski metaco_ops Smart akışı, AWX'te bir template'e bağlı olabilir).
Portal'da kod referansı yok.

### 10.8 Faz 0 (das test, ilk koşu)

`node_env_get` önce das test'te koşulur. Ölçülenler: her `uis-*` bileşeninde hangi env'ler var
ve kaynak türü (10.9), `oc set env -e -` stdin ve `--patch-file` desteği, GitOps (Argo CD)
sahipliği, replika 0 bileşenler, helm values eşleşmesi, processor/adapter `envFrom` kaynakları
(`NODEDEP` envFrom notu). Bulgular buraya ve Ansible README'sine yazılır. `node_change` ancak
bunlar kapandıktan sonra koşturulur.

### 10.9 Yeni tip (uis) env haritası (kullanıcı ölçümü, harmonize-test 2026-11-02)

| Grup | adapter | api | indexer | processor |
|---|---|---|---|---|
| `evm-ethereum-mainnet` | `NODE_ADDR` | `NODE_ADDR` | `NODE_URI_EVM_ETHEREUM_MAINNET` | — |
| `evm-ethereum-testnet-sepolia` | `NODE_ADDR` | `NODE_ADDR` | `NODE_URI_EVM_ETHEREUM_TESTNET_SEPOLIA` | — |
| `solana-mainnet` | `NODE_ADDR` | `NODE_ADDR` | `NODE_URI_SOLANA_MAINNET` | — |
| `xrpl-mainnet` | (deployment yok) | `NODE_ADDR` | `NODE_ADDR` | — |

Kural (Ansible `vars/nodes.yml` `crypto_hub_node_uis_kurali`, tek kaynak): adapter/api
`NODE_ADDR`; indexer `NODE_URI_<ZA>` (ZA = zincirAğ büyük harf, `-` → `_`), yoksa `NODE_ADDR`;
processor node env taşımaz. Yeni bir uis grubu kurala uyuyorsa kendiliğinden değiştirilebilir;
beklenen değişken hiçbir bileşende yoksa grup **"Değiştirilemez: node değişkeni bulunamadı"**
olarak gösterilir (`node_degisken_yok`). **Asla değişmeyenler** (betik ve Portal'da aynı desen,
`YASAK_ENV_RE`; Portal bu adları taşıyan satırı ayrıştırırken atar): `HTTP(S)_PROXY`, `NO_PROXY`,
`ADAPTER_ADDR`, `ADDRESS_API_URL_*`, `EVENT_API_URL`, `CHAIN_ID*`.

**Kaynak sözlüğü** (betik `KAYNAKLAR` = Portal `NODE_KAYNAKLARI`, bekçi CHN11): `literal`,
`secretRef` / `configMapRef` / `alanRef` (valueFrom — referans), `envFrom` (kapta açık yok, envFrom
kaynağı adı **kesin** tanımlıyor — referans), `belirsiz` (envFrom kaynağı okunamadı — ölçülemedi),
`yok`. Grubun değişkenini taşımayan kaptaki envFrom (ör. processor'daki genel ConfigMap) grubu
kilitlemez. Yeni değer bastion'a task ortamıyla değil, playbook'un stdin'den yazdığı 0600
dosyayla gider (`NODE_YENI_DOSYA`; betik okur okumaz siler; Ansible README "Yeni değer").

### 10.10 OCO penceresi (D8, 2026-11-06)

**Talep anı** (`ocoKapisi`; satır yazılmadan ve Smart'a gidilmeden önce, önizleme dışında). Karar
`shared/cryptoHubNodes.cjs` `ocoPencereKarari`'dadır; sihirbaz aynı fonksiyonla metin gösterir, sunucu
OCO'yu talep anında yeniden okur.

| Durum | Sonuç |
|---|---|
| Numara yok | 400 `node_oco_gerekli`, `ocoRequired: true` |
| OCO okunamadı, tarih yok, aralık bozuk | `ocoClient.httpStatus` kodu, `node_oco_okunamadi` |
| Pencere kapandı | 400 `node_oco_gecti`, `ocoExpired: true` |
| Pencere 30 dk'dan kısa | 400 `node_oco_kisa` (son başlama pencere başından önce kalırdı) |
| Son başlama geçti | 400 `node_oco_son_baslama` |
| Başlangıç 7 günden uzak | 400 `node_oco_ufuk` |
| Kolon yok ya da kolon okuması doğrulanamadı | 503 `node_oco_kolon_yok` |

**Durum matrisi**

| Smart | OCO | Pencere açılmadı | Pencere açık | Kapandı |
|---|---|---|---|---|
| Açık | Gerekli | Bilet; onay gelse de pencereye kadar bekler | Bilet; onay gelince son başlamaya kadar çalışır | 400 |
| Kapalı (test) | Gerekli | 400 `node_oco_pencere_bekleniyor`: pencere açılınca tekrar açın | Doğrudan başlar, denetime yazılır | 400 |
| Açık / kapalı (test) | Gerekmiyor | Bugünkü akış; numara gelse de okunmaz | Aynı | Aynı |
| Production | Sabit zorunlu | Bilet; bekler | Bilet | 400 |

**Paket:** `pendingLaunch` şunları taşır: `ocoNumber`, `ocoWindowStartIso`, `ocoWindowEndIso`,
`sonBaslamaIso`, `pencereBekle: true`. `onayZamanAsimiDk` verilmez. `talepSonTarihi` (`deadline.cjs`)
`sonBaslamaIso` varsa onu `oco` sınırı alır; ekran sayacı, `smart.sonTarih` ve poller'ın `TIMEOUT` anı
aynıdır.

**Onay:** Poller sıralaması değişmedi; süre kontrolü başta. `status.completed` iken pencere
açılmadıysa `smart_tickets.approved_at` bir kez yazılır, claim yapılmaz, bilet `PENDING` kalır. Pencere
açılınca sonraki turda claim. `pencereBekle` taşımayan bilet bu dala girmez. Runner geri çağrısı
`launchPenceresiDenetle` ile yeniden karar verir: `schedule` ya da `none` sonucu, son başlamanın geçmiş
olması ve yarım paket `throw` eder, bilet `ERROR` olur. Karar kancadan önce olduğu için pencere dışında
şifreli değer çözülmez. Crypto bileti `createOcoAwxSchedule`'a ulaşamaz: schedule `extraVars`'ı yer
tutucuyla kaldırırdı, `launchExtraVars` ise değeri AWX schedule'a yazardı.

**Son başlama:** `ocoSonBaslamaMs` = `min(pencere sonu − 30 dk, max(pencere başı, talep anı) + 24 saat)`.
OCO penceresinin uzunluğunun üst sınırı yoktur; bu tavan olmadan 60 günlük bir OCO'da bilet her turda
Smart'a sorulur, grup kilitli kalır, değer kolonda durur. Tavan OCO'suz talebin 24 saatlik onay süresidir.
Normal pencerede (24 saatten kısa) sonuç pencere sonu − 30 dk'dır. Uzun pencerede süresi dolan talep
aynı OCO ile yeniden açılabilir.

**Takip:** `satiriIlerlet` üst sınırı `max(TAKILDI_DK, son başlama + 120 dk)`; normal pencerede bu pencere
sonu + 90 dk'dır. Sınır hesabı satırdaki pencere kolonlarına dayanır: satır bu kolonlar olmadan okunduysa
ve kolonların yokluğu kesinleşmediyse (`ocoKolonOku` `false` dönmediyse) o tur `TAKILDI` kararı verilmez.
`INFORMATION_SCHEMA` okuma hatası "kolon yok" değildir; son olumlu sonuç korunur, talep kapısı ise
sonuç bilinmiyorsa 503 verir. Ekran onaylı bekleyen talepte "Onaylandı, pencere bekleniyor" der (Node
ekranı, Smart Talepleri, Taleplerim). Onaylanmış ama başlatılamamış talebin `ZAMAN_ASIMI` metni "onay
gelmedi" demez (`sonuc.smart.onayGeldi`). `approved_at` boşsa metin "Portal onay görmedi" der, "gelmedi"
demez: süre kontrolü Smart sorgusundan önce çalışır, Portal ya da Smart API kapalıyken verilen onay
okunmamış olabilir.

**Değer ve kilit ömrü:** Şifreli değer pencere açılana kadar `yeni_deger_secret`'ta kalır, grup kilidi
(`UX_chnc_acik`) bu süre boyunca tutulur; ikinci talep 409 alır. Bilet en geç son başlamada kapanır: en
uzun bekleme 7 gün ufuk + 24 saat tavandır. `LAUNCHING`'de takılan satır için bunun üstüne 2 saat eklenir
(satır TAKILDI ile kapanınca değer silinir). OCO'suz talepte sınır 25,5 saattir.
Uzun beklemede `plan_sha` ve `expect` değişmez; grup bu arada değiştiyse iş `BAYAT` durur, hiçbir şey
yazmaz.

**Bilinçli kabul edilen hata modları**

- **İptal edilmiş OCO kontrol edilmez.** Kapı yalnız tarihlere bakar; `OcoStatus` okunmaz. Tarihi uyan
  iptal edilmiş numara geçer.
- **Pencere saatinde OCO yeniden okunmaz.** OCO kaydırılırsa Portal talep anındaki pencereyle çalışır.
  Numara değiştirilemez: iptal + yeni talep.
- **Smart API o an kapalıysa** durum okunamaz, tur atlanır; son başlamaya kadar düzelmezse bilet
  `TIMEOUT` olur, iş başlamaz. Bu sırada verilmiş onay Portal'a ulaşmamış olabilir; metin bunu söyler.
- **Portal pencere boyunca kapalıysa** dönüşte son başlama geçmişse `TIMEOUT`; geçmemişse ilk turda
  başlar.
- **Smart'taki kayıt** `TIMEOUT` sonrası açık kalabilir (kapatma API'si yok); sonradan onaylansa da iş
  başlamaz, mesaj bunu söyler.
- **AWX hatası:** bilet `ERROR`, satır `HATA`, yeniden deneme yok; pencere açıksa kullanıcı yeni talep
  açar.
- **Launch sırasında çökme:** bilet `LAUNCHING`'de kalır; satır genişletilmiş TAKILDI ile `OLCULEMEDI`
  kapanır.
