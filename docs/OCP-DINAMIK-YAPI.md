# OCP Dinamik Yapı — Cluster Bazlı Jump Server

> Amaç: Portaldaki tüm OCP servisleri (LogX OCP, OpsX OCP, Telnet OCP) ortak, tamamen
> admin-yönetimli bir yapı üzerinden çalışır: **Ortam → Platform (tenant) → Cluster → Jump Server**.
> Hiçbir bilgi kodda sabit değildir; yeni cluster/ortam/jump server eklemek için deploy gerekmez.

## 1. Neden değişti

Eskiden bastion (jump server) **(tenant, env)** seviyesinde tekil tutuluyordu
(`ocp_terminal_host_map`, `UNIQUE(tenant, env)`). Yani bir ortamdaki tüm cluster'lar aynı
bastion'ı kullanmak zorundaydı. Yeni gereksinim: **her cluster'ın kendi jump server'ı** olabilir
ve aynı işlemde farklı cluster'lar farklı jump server'lara gidebilir.

## 2. Çözümleme önceliği (tek kapı)

Tüm OCP akışları tek fonksiyondan geçer: `resolveTerminalHosts(env, tenant, clusters)`
(`server/logx/v2/admin.cjs`).

| Sıra | Kaynak | Not |
|---|---|---|
| 1 | `ocp_cluster_index.terminal_host` | Cluster satırında doluysa **o kazanır** |
| 2 | `ocp_terminal_host_map(tenant, env)` | Yedek (eski davranış) — cluster kolonu boşsa |
| — | ikisi de yoksa | Cluster `missing` döner → akış **400** ile, hangi cluster'ın bastion'sız olduğunu söyleyerek durur |

Dönüş: `{ hosts: { [clusterName]: host }, missing: [...] }`. Bastion'lar **her job
başlatmadan önce DB'den taze** çözülür; istemcinin gönderdiği `input_json`'a asla güvenilmez.

**Admin ekranı:** Admin → LogX Yapılandırma → *OCP Cluster Hiyerarşisi* sekmesinde her satırda
"Jump Server (bastion)" kolonu. Boş bırakılan hücrede devreye girecek yedek değer soluk gösterilir
(`— yedek: gbaocp01`), yedek de yoksa `⚠ eşleme yok` uyarısı.

## 3. extra_vars v2 sözleşmesi

Portal AWX'e **her zaman üç alanı birden** gönderir:

```yaml
terminal_host: "GBAOCP01"                    # legacy skaler (= terminal_hosts[0])
terminal_hosts: ["GBAOCP01", "GBAOCP02"]     # benzersiz + alfabetik sıralı (deterministik)
ocp_clusters:
  - { env: qa, tenant: ark, cluster_name: gbocpqa1, terminal_host: GBAOCP01 }
  - { env: qa, tenant: ark, cluster_name: gbocpqa2, terminal_host: GBAOCP02 }
```

Tek bastion'lı kurulumda üretilen payload, eski payload'ın **üst kümesidir** — eski playbook
sürümü yeni alanları yok sayarsa davranış birebir aynı kalır (`buildOcpExtraVars` golden testi
bunu garanti eder: `server/logx/v2/__tests__/ocp-extra-vars.test.cjs`).

### v3 — cluster kataloğu DB'de (parola hâlâ vault'ta)

Bugüne kadar cluster'ın **API adresi ve parolası** AWX'teki `openshift_inventory_vars.yaml`
dosyasından okunuyordu (`clusters[tenant_env][cluster].url/.password`). Yeni cluster eklemek
AWX dosyası düzenlemeyi gerektiriyor, portal DB'si o cluster'ın adresini hiç bilmiyordu.

v3'te `ocp_clusters[]` öğeleri iki alan daha taşır:

```yaml
ocp_clusters:
  - env: qa
    tenant: ark
    cluster_name: gbocpqa1
    terminal_host: GBAOCP01
    api_url: "https://api.gbocpqa1.garanti.com.tr:6443"   # DB'den (ocp_cluster_index.api_url)
    credential_key: "uxmid_gar"                            # credentials.yaml'daki DEĞİŞKEN ADI
```

**Parola portal veritabanına ASLA yazılmaz.** DB yalnızca anahtarın *adını* tutar; playbook
`lookup('vars', item.credential_key)` ile değeri AWX'teki vault'tan (`credentials.yaml`) okur.
Yani "şifreyi belli kırılımlara göre credentials'tan çekiyorum" mantığı korunur, portal sadece
hangi kırılımın kullanılacağını söyler.

**Geriye uyum bilinçlidir:** alan boşsa portal anahtarı **hiç göndermez** ve playbook eski
inventory yoluna düşer:

```yaml
resolved_url: "{{ item.api_url if has_portal_meta else clusters[inventory_key][name].url }}"
```

`openshift_inventory_vars.yaml` `first_found` ile **opsiyonel** hale getirildi — dosya
kaldırılsa bile playbook yüklenir. Geri alma: kolonları NULL'lamak yeter, kod değişmez.

### Kataloğun bir kerelik tohumlanması

`server/db/data/ocp-inventory-seed.cjs` (~62 satır, **parola yok**) + `ocp-bootstrap-seed.cjs`
ilk açılışta eksik cluster'ları ekler. Üç kural:

- **Bir kere çalışır.** İşaret `portal_settings.ocp_bootstrap_seed_v1`'de tutulur; admin'in
  sildiği bir cluster restart'ta geri gelmez.
- **Yeniler PASİF başlar** (`is_active=0`, `source='inventory-seed'`) — doğrulanmadan
  üretime sızmaz.
- **Hepsi başarısız olursa işaret YAZILMAZ** (`{incomplete:true}`) — aksi halde katalog
  kalıcı olarak boş kalırdı. Seed çağrısı bu yüzden `setupTables()`'ın **en sonunda**,
  kolonları ekleyen ALTER'lardan sonra durur.

Admin ekranı (OCP Cluster Hiyerarşisi sekmesi) durumu gösterir ve "Yeniden çalıştır" sunar;
yeniden çalıştırma mevcut satırlara dokunmaz, yalnız eksikleri ekler.

## 4. Playbook deseni (çoklu bastion)

`logx_ocp_namespace_discovery.yml` ve `logx_ocp_discover_fetch.yml` üç play'e ayrıldı:

1. **play1 (localhost)** — etkin bastion listesini hesaplar, her birini `add_host` ile
   `logx_terminal` grubuna ekler. `discover_fetch` ayrıca her host'a kendi arşiv adını
   (`logx_archive_name`) host-var olarak verir.
2. **play2 (`hosts: logx_terminal`)** — her bastion `my_ocp_clusters` ile **yalnız kendi**
   cluster'larını işler. Cluster öğelerinde `terminal_host` yoksa (eski payload) tüm liste tek
   bastion'da işlenir; kısmi tanımlı payload'da sahipsizler ilk (alfabetik) bastion'a düşer.
3. **play3 (localhost, TEK YAZAR)** — sonuçları birleştirip `set_stats logx_result` yayınlar.

> **Neden tek yazar?** Birden çok host aynı `set_stats` anahtarını yazarsa Ansible listeleri
> birleştirmez, **sonuncu yazan ezer**. play3 istenen HER cluster'ı sahibinin fact'inden toplar;
> raporlamayan (erişilemez) bastion'ın cluster'ları `status: error` olarak işaretlenir — sessizce
> kaybolup `overall_status`'ü yanlışlıkla `success` yapmazlar.

**Çıktı sözleşmesi korunur:** `logx_result` = `{ overall_status, clusters[] }` + fetch'te eski
tekil alanlar (`terminal_host`, `staged_path`, `filename`, `size_bytes`, `is_fallback`) **ilk
arşivi** gösterir; yeni `staged_files[]` her arşivi taşır (bastion başına bir arşiv).

**Rollout sırası (önemli):** playbook v2 eski skaler payload ile de çalışır →
**önce AWX projesi**, sonra portal deploy edilir. Portal rollback'i AWX'e dokunmaz.

## 5. OpsX / Telnet

Doğrulama + bastion çözümleme + extra_vars üretimi artık **ortak** `server/opsx/ocp-target.cjs`
(Telnet'in kopyası ve koda sabit anahtar adları kaldırıldı).

Cluster listesinin biçimi Admin → OpsX Yapılandırma'dan seçilir (deploy gerekmez):

| `clusterListStyle` | Davranış |
|---|---|
| `joined` (**varsayılan**) | Bugünkü sözleşme: tek öğe, cluster adları ayıraçla birleşik. Seçilen cluster'lar **farklı** jump server'lara düşerse sessizce birini seçmek yerine ne yapılacağını söyleyen **400** döner. |
| `perCluster` | LogX ile aynı v2 sözleşmesi (her cluster kendi bastion'ı + `terminal_hosts[]`). **Yalnızca** OpsX/Telnet playbook'ları çoklu bastion destekliyorsa seçin. |

## 6. Katalog birleştirme (aşamalı)

Portalda ortak anahtarı olmayan iki OCP kataloğu vardı:

| Katalog | Anahtar | Kullanan |
|---|---|---|
| `ansible_ocp_clusters` | `id` / `name` (+`jump_host`) | Ansible Info ekranı, AI pod-status |
| `ocp_cluster_index` | `env` + `tenant` + `cluster_name` | LogX / OpsX / Telnet sihirbazları |

**Bu sürümde (dual-write):** `ansible_ocp_clusters` üzerindeki her ekleme/güncelleme/silme
`ocp_cluster_index`'e de aynalanır (`legacy_id` ile eşleşir, idempotent; boot'ta
`syncClustersIntoIndex()` mevcut satırları taşır). Ayna yazımı **best-effort**'tur — hatası ana
işlemi düşürmez. **Okuma hâlâ eski tablodan** yapılır, böylece her an geri dönülebilir.

**Güvenlik:** Ansible kataloğunda `tenant` kavramı yoktu. Tenant'ı boş olan kayıtlar
`_atanmadi` tenant'ı ile ve **`is_active = 0`** aynalanır; `getClusterTree`/`clusterExists`
yalnızca aktif satırları okuduğu için admin tenant atayıp aktive edene kadar sihirbaz ağacı
kirlenmez. Admin bu alanı **Admin → Ansible Info → Tenant/Platform** alanından doldurur.
Varsayılan tenant etiketi `OCP_CATALOG_DEFAULT_TENANT` env'i ile değiştirilebilir.

**Sonraki adım (bu sürümde YOK):** okumanın birleşik tabloya alınması, ardından
`ansible_ocp_clusters` yazımının durdurulup tablonun düşürülmesi.

## 7. Staging / fallback dizinleri

İki ayrı kavram karıştırılmamalı (eskiden yazılan yer ile aranan yer uyuşmuyordu):

| Fonksiyon (`server/logx/v2/downloads.cjs`) | Anlamı |
|---|---|
| `remoteFallbackDir()` | Playbook'a `fallback_dir` olarak gider, **uzak host'ta (bastion)** yaratılır. Varsayılan `/tmp/logx-v2-fallback` — portalın kendi yolu uzak makinede yaratılamayabilir. |
| `localFallbackDir()` | Portalın **kendi diskinde** ingest (fetch-back) ile yazılan yer (`data/logx-v2-fallback`). |

`LOGX_STAGING_FALLBACK_DIR` set edilirse ikisi de onu kullanır (paylaşılan mount senaryosu).
`stagingRoots()` her ikisini de tarar.

## 8. Görünürlük mekanizması (denetim sonrası)

- **Fail-closed:** `requireVisible` motor okunamazsa artık **503** döner (eskiden erişimi
  açıyordu). Admin muaftır (kesintide portal onarılabilsin). Acil kaçış: `VISIBILITY_FAIL_OPEN=1`.
- **Parent → child kaskadı** gerçekten uygulanır: bir menü/sayfa kapatılırsa altındaki
  tab/buton da gizlenir (döngü korumalı).
- **Sunucu tarafı koruma:** `/api/opsx` ve `/api/telnet` mount'larında `requireVisiblePrefix`.
  Ansible'da **sayfaya özgü** uçlar korunur — `/api/ansible` prefix'inin tamamı kapatılamaz,
  çünkü `/ss/*`, `/survey/*`, `/awx/recent-jobs` Self Service ve Dashboard tarafından
  Ansible sayfası görünmese de kullanılır.
- **Admin sekmeleri** `admintab:*` anahtarlarıyla gerçekten filtrelenir; CommandPalette
  görünmeyen sayfaları listelemez; `PageVisibilityTab` kaydederken yönetmediği kuralları
  (ör. Admin rol kuralı) artık silmez.
- `/api/visibility/pages` artık `requireAuth` ister.

## 9. Bilinçli davranış değişiklikleri (operasyona duyurulmalı)

1. **OpsX/Telnet artık cluster kolonunu tercih eder.** Bir cluster satırına Jump Server
   yazıldığı anda OpsX/Telnet de o hosta gider (eskiden her zaman tenant/env yedeği
   kullanılırdı). Kolon boş kaldığı sürece davranış **birebir eskisi gibidir**.
2. **`joined` modda karışık bastion = hata.** Seçilen cluster'lar farklı jump server'lara
   düşerse işlem sessizce birini seçmez, ne yapılacağını söyleyen 400 döner.
3. **Telnet, OpsX'in OpenShift yapılandırmasını paylaşır.** Değişken adları/ayıraç/liste
   biçimi ikisini birden etkiler (admin ekranında uyarı gösterilir). Ayrı bir Telnet
   yapılandırması gerekirse `config.cjs`'e `telnet.openshift` bloğu eklenmelidir.
4. **Admin sekmeleri artık gerçekten gizlenebilir.** "Sayfa Erişimi" sekmesi bilinçli olarak
   **kaçış kapısı** bırakıldı ve asla gizlenmez — aksi halde kuralları geri almanın UI yolu
   kalmazdı.
5. **Görünürlük haritası alınamazsa korumalı sayfa açılmaz.** İstemci artık 401/503'ü
   "başarılı" saymaz (eskiden `safeJson` HTTP durumunu yok sayıyordu); login sonrası harita
   hemen tazelenir.

## 10. Üretim olayı (2026-08-08) ve `oc` keşfi

**Ne oldu:** Cluster-başına jump server canlıda denendi. Portal doğru payload'ı gönderdi,
3 bastion envantere eklendi, her biri kendi cluster alt kümesini aldı — **mekanizma çalıştı**.
Ancak playbook `oc_binary: /usr/local/bin/oc` sabitini bekliyordu; sunucularda `oc` gerçekte
`/bin/oc` konumundaydı. Üç bastion da `assert`'te fatal oldu.

**Neden hiç sonuç dönmedi:** Ansible'da bir play'de *tüm* hostlar fail olursa sonraki play'ler
farklı host pattern (localhost) kullansa bile atlanır. Toplayıcı Play3 hiç çalışmadı →
`set_stats` yazılmadı → artifacts boş → portal jenerik "yapılandırılmış çıktı bulunamadı"
mesajını verdi ve gerçek neden (`oc` yok) hiçbir yerde görünmedi.

**Alınan önlemler:**

| Sorun | Çözüm |
|---|---|
| Sabit `oc` yolu | Playbook `oc`'yi keşfediyor: override → aday yollar (`stat`) → `command -v oc`. Bulunamazsa `fail` (assert değil). |
| Tek bastion tüm işi öldürüyor | Play2'nin oc'ye bağımlı kısmı `block`/`rescue` içinde; çöken bastion'ın cluster'ları `status: error` olur, host FAIL sayılmaz, diğerleri devam eder. |
| Play3 hiç çalışmıyor | Artık hiçbir host FAIL olmadığı için garanti çalışır; ek sigorta `meta: clear_host_errors`. |
| Kullanıcı gerçek nedeni göremiyor | Mesaj sadeleşti (iş no + yöneticiye başvur); başarısız ekranında **Ansible çıktı paneli** açılabiliyor; teknik ayrıntı Admin'e ve audit'e gidiyor. |
| Yollar koda gömülü | Admin → LogX Yapılandırma → **OCP Çalıştırma Ayarları** (aday yollar + zaman aşımları), deploy gerektirmez. |

## 10b. Keşif önbelleği ve uygulama keşfi

**Sorun:** namespace keşfi request-scoped'tı (`logx_v2_requests.discovery_result_json`) —
kullanıcılar arasında paylaşılmıyor, her seferinde bir AWX job'ı gerekiyordu. Uygulama adını
ise kullanıcı **ezberden bilmek** zorundaydı (serbest metin).

**Çözüm — iki paylaşımlı tablo:**

| Tablo | İçerik | Varsayılan TTL |
|---|---|---|
| `ocp_namespace_cache` | (env, tenant, cluster) → namespace listesi | 24 saat |
| `ocp_app_cache` | (…, namespace) → kind, ad, replika, image, `app` etiketi | 12 saat |

Sihirbaz **önce önbelleğe** bakar; liste anında gelir ve rozet ne zaman alındığını söyler.
Bayatsa (TTL geçmiş) satır **silinmez**, sarı uyarıyla gösterilir — bayat liste boş ekrandan
iyidir. Her durumda **"Burada keşfet"** butonu canlı taramayı tetikler.

Uygulama keşfi yeni bir playbook'la yapılır (`logx_ocp_app_discovery.yml`):
`oc get deployment,deploymentconfig,statefulset,daemonset,cronjob,pod,service,route -o jsonpath`
ile satır satır `kind|name|replicas|image|podImage|labelApp|created` üretir; **ayrıştırma
portalda** (`ocp-app-parse.cjs`) yapılır — tam JSON pod spec'leri AWX artifact'ini gereksiz
şişirirdi. Alan sayısı 7'den az VEYA fazla olan satır atılır (image içinde `|` geçerse alanlar
kayar ve sessizce yanlış veri yazılırdı).

**Silinen objelerin takibi:** ölçüt ad listesi değil **tur başlangıç zamanı**
(`fetched_at < runStart` → `is_deleted=1`). `NOT IN (...)` MSSQL'in 2100 parametre sınırına
takılıyordu (2097+ namespace'li cluster'da tüm yazım sessizce düşerdi) ve namespace tamamen
boşaldığında hiç çalışmıyordu.

**Periyodik besleme** (`ocp-sync.cjs`) — **varsayılan KAPALI**. Admin > OCP Çalıştırma
Ayarları'ndan açılır; acil durumda `LOGX_OCP_SYNC_DISABLED=1` ile kod değişikliği olmadan
durdurulur. Yalnızca `is_active=1 AND api_url IS NOT NULL AND vault_credential_key IS NOT NULL`
cluster'ları, bastion'a göre gruplayarak, en eski senkronlanandan başlayarak tarar. Ürettiği
teknik istek satırı iş bitince **silinir** (aksi halde admin istek listesini doldururdu).

## 11. AWX projesine taşıma

Bu repodaki playbook'lar **referans kopyadır**; çalıştırılan sürüm AWX projesindedir
(`bmw_automation_folder/portal_tamplates/`). Buradaki düzeltmeler AWX'e kopyalanmadıkça
üretime yansımaz.

**Taşınacak dosyalar (3):**
- `server/ansible/playbooks/logx_ocp_namespace_discovery.yml`
- `server/ansible/playbooks/logx_ocp_discover_fetch.yml`
- `server/ansible/playbooks/logx_ocp_app_discovery.yml` — **YENİ.** AWX'te ayrıca bir
  Job Template açılmalı ve ID'si `AWX_LOGX_OCP_APP_DISCOVERY_TEMPLATE_ID` ortam değişkenine
  (ya da playbook kayıt tablosundaki `logx_ocp_app_discovery` satırına) yazılmalıdır. Template
  yoksa uygulama keşfi butonu hata verir; sihirbazın geri kalanı etkilenmez.

> **Shell bloklarında kesme işareti kullanmayın.** Ansible argümanları bölerken tek tırnakları
> sayar; `shell: |` bloğunun **yorum satırında** tek başına bir `'` (ör. "API'si") bloğu
> `unbalanced jinja2 block or quotes` ile reddettirir ve playbook **hiç yüklenmez**. YAML
> geçerli kalır, testler yeşil görünür — hata ancak AWX'te çalıştırınca çıkar. Bu sınıfı
> `server/ansible/__tests__/playbook-shell-quotes.test.cjs` yakalar.

> **Sürüm sapması uyarısı (2026-08-08 tespiti).** AWX'teki iki playbook AYNI sürümde
> olmayabilir. Son tespit edilen durum:
>
> | Playbook | AWX'te | Sonuç |
> |---|---|---|
> | `logx_ocp_namespace_discovery.yml` | çoklu-bastion ✅, `oc_binary` elle `/bin/oc` yamalı | Namespace keşfi çalışır |
> | `logx_ocp_discover_fetch.yml` | **eski tek-bastion** (2 play), `oc_binary: /usr/local/bin/oc` | **Log çekme adımı aynı hatayla düşer** |
>
> İki playbook birlikte güncellenmelidir. Yalnız birini güncellemek, sihirbazın ilk adımını
> çalışır gösterip ikinci adımda aynı hataya düşürür — kullanıcı için en kafa karıştırıcı senaryo.
>
> Ayrıca eski `discover_fetch`, portalın gönderdiği `terminal_hosts` ve cluster-başına
> `terminal_host` alanlarını **yok sayar**; tüm cluster'ları tek bastionda (alfabetik ilk)
> işler. Yani "her cluster kendi jump server'ından" garantisi log çekme adımında sağlanmaz.
>
> **`vars_files` yolu:** AWX `credentials.yaml` kullanır. Repo kopyaları bu sürümde buna
> hizalandı; ileride değişirse taşımadan önce iki dosyanın `vars_files` satırları
> karşılaştırılmalıdır (yanlış yol = her host için fatal, teşhisi zor bir hata).

**Sıra — önce AWX, sonra portal:**
1. İki playbook'u AWX projesindeki karşılıklarının üzerine kopyala, proje senkronu çalıştır.
   Yeni playbook **eski payload ile de çalışır** (portal henüz yeni alanları göndermese bile),
   bu yüzden bu adım tek başına güvenlidir.
2. Portalı deploy et (Faz 3–6: sade hata mesajı, log paneli, admin ayarları).

**Geri alma:** Playbook'u önceki sürüme döndürmek yeterlidir. Acil durumda **kod değişikliği
olmadan** da belirli bir yola sabitlenebilir: AWX template'inin extra_vars alanına
`oc_binary: <yol>` yazmak (veya portaldaki "Kesin yol" alanı) o yolu **aday listesinin başına**
koyar — sunucuda varsa kesin olarak o kullanılır. Yol bulunamazsa iş durmaz, diğer adaylara
düşülür (bilinçli: yanlış yazılmış bir override tüm işi kilitlemesin).

**Doğrulama (AWX'te):** Job çıktısında `Probe candidate oc paths` ve `Resolve the oc binary
for this bastion` adımları görünmeli; bir bastion çökerse `PLAY RECAP`'te o host `failed=0`
(rescue devrede) olmalı ve toplayıcı play çalışmalıdır.

## 12. Doğrulama

```bash
npm test          # 247/247 yeşil olmalı
npx tsc --noEmit  # yeni hata olmamalı (mevcut 4 hata bu işten önce de vardı)
npm run build
ansible-playbook --syntax-check server/ansible/playbooks/logx_ocp_*.yml   # üçü de temiz
```

> `--syntax-check` adımını atlamayın: YAML geçerli olduğu hâlde Ansible'ın yükleyemediği
> playbook'lar (bkz. §11 kesme işareti notu) yalnızca burada görünür.

Manuel kontrol listesi:

1. **LogX OCP — tek bastion:** payload eski haliyle birebir aynı olmalı (regresyon).
2. **LogX OCP — iki farklı bastion:** namespace listesi birleşik gelir, indirme adımında
   **iki ayrı arşiv satırı** görünür.
3. **Bastion'sız cluster:** anlaşılır 400 (hangi cluster olduğu yazar).
4. **OpsX/Telnet:** `joined` modda regresyon; farklı bastion'lar seçilince açıklayıcı 400;
   `perCluster` moda geçince (playbook hazırsa) uçtan uca.
5. **Admin:** cluster satırına Jump Server yazınca anında etkili; boş hücrede yedek görünüyor;
   Ansible Info'da tenant atanınca kayıt sihirbaz ağacında beliriyor.
6. **Görünürlük:** User'a OpsX/Telnet/Ansible kapatınca nav + doğrudan URL + API 403;
   DB kesintisinde normal kullanıcı 503, admin geçebiliyor.
7. **Katalog tohumlaması:** ① İlk boot → seed raporu (`inserted/skipped`), yeni satırlar
   **pasif**, mevcutlar aktif · ② İkinci boot → seed atlanır · ③ Admin bir cluster siler →
   restart'ta geri gelmez.
8. **v3 alanları:** `api_url`+`vault_credential_key` dolu bir cluster ile namespace keşfi →
   AWX'te extra_vars'ta görünür, `openshift_inventory_vars.yaml` olmadan login olur.
   Alanlar boşken eski davranış (inventory yolu) aynen sürer.
9. **Önbellek:** namespace listesi anında gelir + "Önbellekten" rozeti; "Burada keşfet"
   tazeler; TTL geçince sarı uyarı çıkar ama liste kaybolmaz.
10. **Uygulama keşfi:** namespace seçtikten sonra liste objelerle dolar (kind + replika);
    **serbest metin hâlâ çalışır** (listede olmayan/yeni uygulama).
11. **Yetki:** kısıtlı bir namespace için grant'ı olmayan kullanıcı onu ne önbellek
    listesinde görür ne de uygulamalarını tarayabilir (çoklu cluster seçiminde de).
