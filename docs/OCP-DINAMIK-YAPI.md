# OCP Dinamik Yapı — Cluster Bazlı Jump Server

> **NOT (Onur):** Bu dosya sadece BASTION/jump-server çözümlemesini kapsar — hâlâ geçerli.
> Namespace/uygulama KATALOĞUNUN kaynağı ise bu belgeden SONRA değişti: birincil kaynak
> artık `ocp_namespace_cache`/`ocp_app_cache` değil, bağımsız zamanlanmış
> `dbo.Openshift_Inventory` tablosu. Detay ve gerekçe için önce
> [OCP-NAMESPACE-KATALOGU-KARARI.md](./OCP-NAMESPACE-KATALOGU-KARARI.md) okunmalı —
> namespace/uygulama seçim akışını değiştirmeden önce Onur ile konuşulması gerekir.

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
    username: "uxmid"                                      # DB'den (ocp_cluster_index.ocp_username)
```

### `username` — 2026-08-09 üretim arızasının kökü

Playbook'lar `oc login --username={{ username }}` yazıyordu. Bu değişken **yalnızca**
`openshift_inventory_vars.yaml` içinde tanımlıydı; o dosya AWX projesinde **yok** ve
`first_found ... errors='ignore'` ile sessizce atlanıyordu. Sonuç: her bastion
`'username' is undefined` ile rescue'ya düştü, **üç cluster'ın üçü de** `status: error`
döndürdü, kullanıcı boş bir namespace ekranı gördü. `oc` keşfi, bastion ayrımı ve parola
çözümlemesi doğru çalışıyordu — tek eksik kullanıcı adıydı.

Çözüm sırası (playbook'ta `resolved_username`):

1. `ocp_clusters[i].username` — cluster satırı (`ocp_cluster_index.ocp_username`)
2. `ocp_username` — portalın genel varsayılanı (Admin > **OCP Çalıştırma Ayarları**)
3. `username` — eski inventory değişkeni (yalnızca geriye uyum)

Üçü de boşsa o cluster **doğrulamada elenir** ve anlaşılır bir hata metni döner; diğer
cluster'lar çalışmaya devam eder. Eskiden bu durum tüm bastion'ı düşürüyordu.

Kullanıcı adı kabuk komut satırına gittiği için hem portalda hem playbook'ta
`[A-Za-z0-9][A-Za-z0-9._\-@]*` kalıbına zorlanır.

**Vault anahtarı kataloğu:** `ocp_vault_key_catalog` tablosu `credentials.yaml` içindeki
değişken adlarını (uxmid_gar, uxmid_gtek, uxmid_das, uxmid_gtdmz, uxmid_gtekdmz,
uxmid_takasnet, uxmid_gohas) tutar; Admin > LogX Yapılandırma > **Vault Anahtarları**
sekmesinden yönetilir ve cluster satırındaki "Vault Anahtarı" alanının önerilerini besler.
Kullanımdaki bir anahtar silinemez. **Parola burada da tutulmaz.**

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

### 5c. Jinja apostrof tuzağı (2026-08-09 üretim arızası #2)

`username` düzeltmesiyle eklenen hata mesajı, **tek tırnaklı** bir Jinja string'i içinde
ters bölüyle kaçırılmış apostrof taşıyordu:

```yaml
~ 'alanini doldurun ya da OCP Calistirma Ayarlari\'nda genel varsayilani girin: '
```

AWX'teki ansible-core 2.16.11 / jinja 3.1.4 bunu YAML gibi yorumlamadı: string apostrofta
bitti, kalan `nda` sözdizimi sanıldı ve **üç playbook da** şu hatayla düştü:

```
template error while templating string: expected token ')', got 'nda'
```

Düzeltme: dış tırnağı **çift tırnak** yapmak, apostrofu normal karakter olarak bırakmak.

> **Bu sınıf `ansible-playbook --syntax-check`'ten GEÇER** (YAML geçerlidir, ifade ancak
> çalışma anında derlenir) ve davranış ansible/jinja **sürümüne göre değişir** — daha yeni
> bir sürümde yerelde sessizce çalışabilir. Bu yüzden koruma bir **grep testidir**:
> `server/ansible/__tests__/ocp-playbook-username.test.cjs` bu playbook'larda kaçırılmış
> apostrof bulunmasını yasaklar. Aynı test, `>-` katlamalı skaler **içine** `#` yorum
> satırı konmasını da yasaklar (orada `#` YAML yorumu değildir, ifadenin parçası olur).

### 5d. Çoklu hedef ve arşiv adlandırma

Kullanıcı tek çalıştırmada birden fazla **(namespace, uygulama)** çifti seçebilir
(OpsX'in "Listeye Ekle" deseninin LogX karşılığı — `steps/ocp/TargetListStep.tsx`).

İş birimi = **cluster × namespace × uygulama**. Her birim kendi dizininde toplanır ve
**kendi arşivini** üretir:

```
<cluster>__<namespace>__<uygulama>__<archive_id>.zip
gbocpprod2__reference-applications-prod__parallel-composition-v3__0dda63d4.zip
```

Eskiden ad yalnızca jump server + rastgele hash'ti (`gbarkp54__0dda63d4….zip`) ve indirilen
dosyanın neye ait olduğu anlaşılmıyordu.

- Portal `ocp_targets[]` + kısa `archive_id` gönderir; **adı playbook kurar**
  (`server/logx/v2/ocp.cjs` → `discoverFetch(row, targets)`).
- `ocp_targets` yoksa playbook eski tekil alanlardan tek elemanlı liste kurar —
  **tek hedef, çoklunun özel hâlidir**; iki ayrı kod yolu yok.
- Yetki kapısı (`assertNamespaceAllowed`) **her hedef için ayrı** çalışır.
- Üst sınır: `MAX_TARGETS = 20` (her çift ayrı bir `oc login` + pod taraması demek).
- `staged_files[]` birim başına bir öğe taşır; portal zaten her öğe için ayrı indirme
  token'ı üretiyordu — o taraf değişmedi.

### 5e. Katalog okuma: envanter ∪ önbellek

**Kırık döngü:** sihirbaz namespace/uygulamayı yalnızca `dbo.Openshift_Inventory`'den
okuyordu, ama "Bu namespace'i tara" sonucu `ocp_*_cache`'e yazılıyordu ve **o tabloları
kimse okumuyordu**. Taramayı tetikleyen kullanıcı bile sonucu göremiyordu.

`server/logx/v2/ocp-catalog.cjs` iki kaynağı **birleştirir**:

| | Kaynak | Yazan |
|---|---|---|
| Birincil | `dbo.Openshift_Inventory` | portal dışı, zamanlanmış Ansible job'ı (Onur'un kararı) |
| Ek | `ocp_namespace_cache` / `ocp_app_cache` | kullanıcı taraması + `ocp-sync.cjs` |

- Aynı ad iki kaynakta da varsa **envanter** kaynak etiketini kazanır; uygulama kaydında
  ise **önbellek** kazanır (kind/replica bilgisi orada, envanterde yalnızca ad var).
- **Onur'un kararı korunur:** bu modül envanter tablosuna **YAZMAZ**, yalnızca okur.
  Test bunu kilitler (`__tests__/ocp-catalog.test.cjs`).
- Kısıtlama filtresi yerinde kalır (`index.cjs`), birleştirme filtreden önce olur.
- Rozet kaynağı gösterir: "Envanterden • 2 saat önce" / "Envanter + tarama" + satır
  bazında `tarama` etiketi.

**Periyodik sync artık uygulama önbelleğini de besler** (`ocp-sync.cjs`): namespace
taramasının ardından aynı teknik istekle uygulama keşfi çalışır ve sonuç `periodic`
kaynağıyla yazılır. `periodicSyncMaxNamespaces` (varsayılan 40, `0` = kapalı) tur başına
taranacak namespace sayısını sınırlar. Amaç: kullanıcının ~1 dk beklediği keşif job'ına
ihtiyacı azaltmak. **Sync bütünüyle varsayılan KAPALI** (`periodicSyncEnabled: false`).

### 5f. Playbook hazırlık paneli

Admin > LogX Yapılandırma > OCP Cluster Hiyerarşisi'nde: beş LogX playbook kaydı için
template ID tanımlı mı, AWX'te bulunuyor mu, **Prompt on launch açık mı**. Üretimde bir
keşif 503 döndüğünde sebebini AWX'e girmeden görmek için
(`GET /admin/playbook-readiness`, `template-preflight.cjs` yeniden kullanılır).

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

> **Sürüm sapması uyarısı — 2026-08-09 itibarıyla GİDERİLDİ.** 2026-08-08'de AWX'teki
> `logx_ocp_discover_fetch.yml` hâlâ eski tek-bastion sürümüydü. 2026-08-09 üretim
> denemesinin job çıktısı her iki playbook'un da **çoklu-bastion sürümünde** olduğunu
> gösterdi (her bastion kendi cluster alt kümesini işledi, `oc` keşfi çalıştı). Uyarı
> tarihsel kayıt olarak burada duruyor: **iki playbook birlikte güncellenmelidir**, yalnız
> birini güncellemek sihirbazın ilk adımını çalışır gösterip ikinci adımda düşürür —
> kullanıcı için en kafa karıştırıcı senaryo.
>
> **`vars_files` yolu:** AWX `credentials.yaml` kullanır. Repo kopyaları buna hizalandı;
> ileride değişirse taşımadan önce dosyaların `vars_files` satırları karşılaştırılmalıdır
> (yanlış yol = her host için fatal, teşhisi zor bir hata).
>
> **"Prompt on launch" ZORUNLU.** AWX job template'inde Variables > *Prompt on launch*
> kapalıysa AWX, portalın gönderdiği extra_vars'ı **sessizce yok sayar**: job başlar,
> playbook boş girdiyle çalışır ve anlamsız bir assert hatası verir. 2026-08-09'da
> `logx_ocp_app_discovery` tam olarak böyle düştü (AWX arayüzünde değişkenler `{}`).
> Portal artık launch öncesi bunu kontrol eder ve işi hiç başlatmadan ne yapılacağını
> söyler (`server/ansible/template-preflight.cjs`). **Üç template'te de işaretli olmalı.**

**Sıra — önce AWX, sonra portal:**
1. **Üç** playbook'u AWX projesindeki karşılıklarının üzerine kopyala, proje senkronu
   çalıştır. Yeni sürüm **eski payload ile de çalışır** (portal henüz `username`
   göndermese bile eski `username` değişkenine düşer), bu yüzden bu adım tek başına
   güvenlidir.
2. Üç template'te de **Variables > Prompt on launch** işaretli olduğunu doğrula
   (yukarıdaki nota bak). `logx_ocp_app_discovery` için template yoksa aç ve ID'sini
   `AWX_LOGX_OCP_APP_DISCOVERY_TEMPLATE_ID`'ye ya da Playbook Kayıtları satırına yaz.
3. Portalı deploy et. İlk açılışta şema `ocp_cluster_index.ocp_username` kolonunu ve
   `ocp_vault_key_catalog` tablosunu ekler; vault anahtarları bir kerelik seed edilir
   (işaret: `portal_settings.ocp_vault_key_seed_v1`).
4. Admin > LogX Yapılandırma > OCP Cluster Hiyerarşisi'nde kullanılan cluster'ların
   **OCP Kullanıcı Adı** alanını doldur (boş bırakılırsa OCP Çalıştırma Ayarları'ndaki
   genel varsayılan — `uxmid` — devreye girer).

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
npm test          # 310/310 yeşil olmalı
npx tsc --noEmit  # yeni hata olmamalı (mevcut 4 hata bu işten önce de vardı)
npm run build
ansible-playbook --syntax-check server/ansible/playbooks/logx_ocp_*.yml   # üçü de temiz

# Jinja apostrof regresyonu — `--syntax-check` bu sınıfı YAKALAMAZ (bkz. §5c)
grep -rn "\\\\'" server/ansible/playbooks/logx_ocp_*.yml   # boş dönmeli
```

> `--syntax-check` adımını atlamayın: YAML geçerli olduğu hâlde Ansible'ın yükleyemediği
> playbook'lar (bkz. §11 kesme işareti notu) yalnızca burada görünür.
>
> Ama tek başına **yetmez**: Jinja ifadeleri çalışma anında derlenir. Bir ifadeyi
> değiştirdiyseniz scratchpad'de birebir kopyasını içeren küçük bir playbook'u gerçekten
> `ansible-playbook` ile çalıştırıp mesajın beklendiği gibi üretildiğini görün.

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
