# LogX v2 — Ansible Playbook Kurulum Rehberi (Basit)

LogX v2 (güvenli log indirme) 4 tane Ansible playbook kullanır. Bu playbook'lar
portal reposunda **yalnızca referans** olarak durur (`server/ansible/playbooks/logx_*.yml`);
gerçek çalışacak kopyalar **ayrı Ansible projesine** deploy edilir ve **AWX'te job
template** olarak tanımlanır. Portal bu template'leri sadece "başlat + durumunu izle"
şeklinde kullanır.

---

## 1. Ne yapacaksın (özet)

1. 5 playbook'u Ansible projene koy (biz `bmw_automation_folder/portal_tamplates/` altına koyduk).
2. Her biri için AWX'te bir **Job Template** oluştur (aşağıdaki tablo).
3. Template'lerde **"Prompt on launch → Variables (Değişken sorar)"** açık olsun (portal extra_vars gönderiyor).
4. Template ID'lerini ve **hangi AWX sunucusunda** olduklarını `.env.local`'a yaz (Bölüm 3).
5. Bitti — portalda LogX ekranından kullan.

---

## 2. 5 Playbook / Template

| Playbook dosyası | Ne yapar | Gereken extra_vars |
|---|---|---|
| `logx_legacy_discovery.yml` | Legacy sunucularda (`/vhosting`, `/vhosting8`) uygulamanın log dosyalarını **bulur** (indirmez) | `app_name`, `target_hosts` |
| `logx_legacy_transfer.yml` | Seçilen log dosyalarını zip'leyip staging dizinine **kopyalar** | `selected_files`, `staging_dir`, `fallback_dir`, `archive_name` |
| `logx_ocp_namespace_discovery.yml` | Seçilen cluster(lar)da namespace listesini getirir | `terminal_host`, `ocp_clusters` |
| `logx_ocp_discover_fetch.yml` | Seçilen **her (cluster × namespace × uygulama) birimi** için pod loglarını çeker, zip'ler, staging'e bırakır | `ocp_clusters`, `ocp_targets[]`, `archive_id`, `staging_dir`, `fallback_dir` (+ geriye uyum: `terminal_host`, `oc_namespace_input`, `app_name`) |
| `logx_ocp_app_discovery.yml` | **(yeni)** Verilen namespace'lerdeki uygulama/objeleri listeler — kullanıcı uygulama adını ezberden bilmek zorunda kalmasın | `terminal_host`, `ocp_clusters` (her öğede `namespaces`), `ocp_namespaces` |

**Çıktı sözleşmesi (hepsi için ortak):** Playbook'un SON adımı
`ansible.builtin.set_stats` ile `logx_result` adında bir JSON yayınlar. Portal sonucu
**bu JSON'dan** okur (ham stdout'u parse ETMEZ). Format her playbook dosyasının başındaki
yorumda yazılı. Bu adım ÇALIŞMAZSA portal "sonuç bulunamadı" der.

---

## 3. `.env.local`'a eklenecekler

```env
# 5 template hangi AWX sunucusunda? (AWX_1_* = 1, AWX_2_* = 2 ...). Hepsi aynı
# sunucudaysa tek satır yeterli. YANLIŞSA "AWX HTTP 404" alırsın.
AWX_LOGX_SERVER_ID=2

# AWX'teki job template ID'leri:
AWX_LOGX_LEGACY_DISCOVERY_TEMPLATE_ID=2139
AWX_LOGX_LEGACY_TRANSFER_TEMPLATE_ID=2140
AWX_LOGX_OCP_NAMESPACE_DISCOVERY_TEMPLATE_ID=2142
AWX_LOGX_OCP_DISCOVER_FETCH_TEMPLATE_ID=2141
# Uygulama/obje keşfi (yeni). Boşsa yalnızca bu özellik çalışmaz, sihirbazın
# geri kalanı etkilenmez — serbest metinle uygulama adı girme yolu korunur.
AWX_LOGX_OCP_APP_DISCOVERY_TEMPLATE_ID=

# Portalın okuyabildiği (NFS) staging dizinleri — playbook zip'i buraya bırakır:
LOGX_V2_STAGING_LEGACY_DIR=/sw/BMW_PORTAL/logs/legacy
LOGX_V2_STAGING_OCP_DIR=/sw/BMW_PORTAL/logs/ocp
# NFS erişilemezse portal sunucusunda kullanılacak yerel yedek dizin:
LOGX_STAGING_FALLBACK_DIR=/tmp/logx-v2-fallback
```

> Not: Template ID + sunucu ID'yi istersen `.env` yerine **Admin > Playbook Kayıtları**
> ekranından da girebilirsin (DB'deki değer env'i ezer). Ekranda değer boşsa env
> fallback devreye girer.

---

## 4. Sık Karşılaşılan Hatalar

| Hata | Sebep | Çözüm |
|---|---|---|
| `AWX HTTP 404` | Template yanlış AWX sunucusunda aranıyor | `AWX_LOGX_SERVER_ID` doğru sunucuyu göstersin (ör. Maestro 2 → `2`) |
| `... template ID yapılandırılmamış` | Env/DB'de template ID boş | İlgili `AWX_LOGX_*_TEMPLATE_ID` doldur |
| `sonuç bulunamadı (artifacts.logx_result)` | Playbook `set_stats` adımı çalışmamış | Playbook'un son adımının `logx_result` yayınladığını doğrula |
| İndirme başarısız / dosya yok | Staging dizinine yazılamıyor | NFS mount + izinleri kontrol et, `LOGX_STAGING_FALLBACK_DIR` yazılabilir olsun |
| OCP: `skipping: no hosts matched` | `terminal_host` (bastion) AWX inventory'sinde yok | Playbook artık `add_host` ile bastion'ı dinamik ekliyor; yine de bastion **SSH ile erişilebilir** olmalı ve AWX credential'ı doğru olmalı |
| `Error converting nvarchar to bigint` | Eski playbook `size_bytes`'ı yanlış anahtardan (`dest_state`) üretmiş | Playbook `size_bytes: {{ archive_result.size \| default(0) \| int }}` kullanmalı (backend zaten güvenli tamsayıya zorluyor) |
| OCP: `Forbidden: User "system:anonymous" cannot list ... projects/pods` | Bastion (terminal_host) hedef cluster'a **`oc login` DEĞİL** — oturumsuz/anonim çağrı; vault cluster kimliği (ör. `uxmid`) oturum açmamış veya RBAC yetkisiz | Bastion'da hedef cluster için geçerli `oc login`/context olmalı (gerçek login adımı ayrı projede). Referans playbook artık `ignore_errors` + `block/rescue` ile bu hatayı **per-cluster `error`** olarak yakalayıp portal'a `overall_status: failed` + net mesaj döndürür (sessiz "artifacts bulunamadı" yerine) |
| `Log arşivi portal sunucusunda bulunamadı` (indirme 404) | Playbook arşivi kaynak host'un **yerel diskine** yazıyor ya da staging dizini portal ile **aynı NFS yolundan** paylaşılmıyor | **staging_dir = portal ile PAYLAŞILAN NFS mount** olmalı; kaynak host arşivi NFS'e cp yapmalı, portal aynı NFS'ten okur. Portalın env'i (`LOGX_V2_STAGING_LEGACY_DIR`/`_OCP_DIR`) portalın NFS mount yolunu göstermeli. Portal artık dosyayı `filename` ile bu köklerde de arar (mount yolu farkına dayanıklı — bkz. `downloads.cjs resolveStagedFile`); yine de dosya paylaşılan NFS'te DEĞİLSE bulunamaz. Kaynak host NFS'e erişemiyorsa arşiv portal host'una fetch edilmeli |

### İndirme dosya-erişim mimarisi (özet)

Portal, indirilecek ZIP'i **dosya sisteminden okuyup stream eder** (token akışı FS yolunu
gizler). Bu yüzden arşiv, **portal sunucusunun okuyabildiği bir konumda** olmalı:

1. **Önerilen (paylaşılan NFS):** log-kaynak host arşivi `staging_dir` (= paylaşılan NFS mount)
   içine yazar → portal aynı NFS'ten okur. `LOGX_V2_STAGING_*` env'leri **portalın** NFS mount
   yolunu göstermeli (kaynak host'taki yolla aynı olması şart değil — portal `filename` ile arar).
2. **Fallback — yerel fallback dizini:** kaynak host `staging_dir`'e yazamazsa arşivi
   `fallback_dir`'e bırakır. Bu dizin portal ile paylaşılmıyorsa dosya indirilemez; indirme
   ekranı bu durumda **uyarı gösterir** (sessiz 404 yok).

> **`ingest_url` ARTIK GÖNDERİLMİYOR (2026-08-09).** Hiçbir playbook onu çağırmıyordu
> (`grep ingest_url server/ansible/playbooks/` → 0 sonuç) ve üretilen URL portalın KENDİ
> `localhost`'unu gösterdiği için bastion'dan zaten erişilemezdi; her çalıştırmada boşuna
> token + DB satırı üretiyordu. Ingest ucu (`server/logx/v2/ingest.cjs`) silinmedi — gerçek
> bir fetch-back gerekirse yeri hazır, ama o gün gelene kadar portal bu değişkeni göndermez.
> `server/ansible/__tests__/ocp-staging-parity.test.cjs` bunu kilitler.

---

## 5. Güvenlik (kısa)

- Playbook'lar kullanıcı girdisini **shell'e enjekte ETMEZ** — dosya keşfi
  `ansible.builtin.find`, log çekme `oc`/`fetch` modülleriyle yapılır.
- OCP cluster URL/parolası **portalda tutulmaz**; playbook bunları kendi vault'undan
  (`uxmid_*`) çözer. Portal sadece `env/tenant/cluster/namespace/app` gibi tanımlayıcı
  değerleri gönderir.
- İndirme linkleri tek kullanıcıya bağlı, kripto-rastgele ve TTL'li (15 dk).

---

## OCP playbook'ları: `oc` keşfi ve hata izolasyonu (2026-08-08)

Üretimde playbook `oc`'yi sabit bir yolda (`/usr/local/bin/oc`) arıyordu; sunucularda `oc`
`/bin/oc` olduğu için tüm jump server'lar aynı anda düştü ve iş hiç sonuç üretemedi
(tüm hostlar fail olunca Ansible toplayıcı play'i de atlar). Alınan önlemler:

1. **`oc` yolu artık sabit değil** — her jump server'da sırayla admin override → aday yollar
   → `PATH` denenir. Aday listesi ve zaman aşımları **Admin → LogX Yapılandırma → OCP
   Çalıştırma Ayarları** ekranından, deploy gerekmeden değiştirilir.
2. **Bastion başına hata izolasyonu** — bir jump server çökse bile diğerleri devam eder,
   toplayıcı play her zaman çalışır; sonuç `partial` döner ve hangi cluster'ın neden
   başarısız olduğu portalda görünür.

Ayrıntı, AWX projesine taşıma adımları ve geri alma:
[OCP-DINAMIK-YAPI.md](OCP-DINAMIK-YAPI.md) §10–11.

---

## Playbook yazarken kaçınılması gerekenler (gerçek arızalardan)

Bunların her biri üretimde ya da doğrulamada bir kez yaşandı; hepsi **YAML geçerliyken**
çıkan hatalar, yani gözle bakınca fark edilmezler.

| Tuzak | Ne olur | Doğrusu |
|---|---|---|
| `shell: \|` bloğunun **yorum** satırında kesme işareti (`API'si`) | Ansible argümanları bölerken tek tırnakları sayar → `unbalanced jinja2 block or quotes`, playbook **hiç yüklenmez** | Yorumlarda kesme işareti kullanma. `playbook-shell-quotes.test.cjs` bunu yakalar |
| `async_status` sonucunda `item.target` | Orijinal döngü öğesi bir seviye **altta** durur; `'dict object' has no attribute 'target'` ile blok çöker | `item.item.target` |
| Birden çok host aynı `set_stats` anahtarını yazar | Ansible listeleri **birleştirmez**, son yazan ezer | Tek yazarlı `localhost` toplayıcı play |
| `rescue` unreachable host'u yakalar sanmak | Yakalamaz; sonraki play'ler "NO MORE HOSTS LEFT" ile atlanır | `ignore_unreachable: true` + toplayıcıda "yanıt vermeyen bastion" kontrolü |
| Çok tipli `oc get`te rc'ye bakmak | Tek bir tip patlarsa (kapalı DeploymentConfig API kaynağı, route RBAC reddi) **başarılı** tiplerin çıktısı da atılır | Ölçüt "satır geldi mi"; stderr ayrı tutulur |
| Staging dizinini `dzdo -u <kullanıcı>` ile hazırlamaya çalışmak | Bastion'da o kullanıcı yoksa `dzdo: unknown user: was` → staging hiç oluşmaz, arşivler bastion'ın yerel `/tmp` dizinine düşer, **indirme 404** verir (2026-08-09, job 3208785: 6 arşivin hiçbiri inmedi) | Legacy modeli: `dzdo` YOK, staging kullanıcısı/mod ayarı YOK. `stat` ile `/sw` mount'una bak, arşivi **doğrudan** oraya yaz, olmazsa `fallback_dir` |
| `overall_status: >-` içinde `{% set %}` | Katlamalı skalerde satırlar boşluğa dönüşür, değer `"  success"` olur ve karşılaştırma tutmaz | Tek ifade yaz (ya da portalda `trim`) |

**Her değişiklikten sonra:**

```bash
ansible-playbook --syntax-check server/ansible/playbooks/logx_ocp_app_discovery.yml
```
