# Chaos Scale — OCO / SMART ihtiyaç ve netleşmesi gereken noktalar

**Kime:** OCO (Change Management) ve SMART/RFF ekipleri
**Neden:** BMW Portal'a **Chaos Scale** sayfası ekleniyor — OpenShift uygulamalarında
replica durdurma, geri alma ve ölçekleme. Bu işlem üretimde **hizmet kesintisi
yaratabilir**, dolayısıyla portalın mevcut Self Service akışındaki kurumsal emniyet
kapılarından geçmesi gerekiyor.

Bu doküman **portalın hazır olduğu** kısmı ve **sizden netleşmesini beklediğimiz**
kısmı ayırır. Portal tarafında yeni bir entegrasyon yazılmıyor — bugün Self Service'te
çalışan mekanizmanın aynısı kullanılacak.

---

## 1. İşlem ne yapıyor (kapsam)

| İşlem | Ne yapar | Geri alınabilir mi |
|---|---|---|
| **Durdur** (`stop`) | Uygulamanın `spec.replicas` değerini **0** yapar. Önceki değer namespace içinde `chaos-scale-state-<app>` ConfigMap'ine yazılır. | **Evet** — kayıtlı önceki değere dönülür |
| **Geri Al** (`restore`) | ConfigMap'teki önceki replica sayısına döner, sonra ConfigMap'i siler. | — (zaten geri alma) |
| **Ölçekle** (`scale`) | `spec.replicas` değerini verilen sayıya çeker. | Kısmen — önceki değer sonuçta raporlanır |
| **Önce kontrol et** (`dry_run`) | Hiçbir şey değiştirmez, yalnızca ön kontrol yapar. | Değişiklik yok |

**HPA'ya hiçbir koşulda dokunulmaz** — yalnızca okunur ve raporlanır.

Kapsam bir işte `cluster × uygulama` çarpımı kadar olabilir. Portal ekranı bu sayıyı
**patlama yarıçapı** olarak çalıştırmadan önce gösterir.

---

## 2. SMART — netleşmesi gerekenler

Portal tarafı hazır: talep açma (`createoperationalrequest/v1`), durum sorgulama
(`loadwfinstancestatus/v1`), Basic Auth + `rff-request-token`, 15 dakikalık zaman aşımı
ve onay bekleyen talepler için yoklama zaten çalışıyor.

### S1. Ayrı bir `flowKey` mi, mevcut Self Service akışı mı?

Chaos Scale, Self Service'ten **farklı bir risk sınıfı**: sonucu doğrudan hizmet
kesintisi. Ayrı bir akış anahtarı istiyor musunuz, yoksa mevcut operasyonel talep akışı
yeterli mi?

### S2. Metadata alanları (`ElementName` eşlemesi)

Portal, talebi açarken aşağıdaki bilgileri gönderebilir. **Hangilerinin karşılığı akışta
var, `ElementName` değerleri tam olarak nedir?** (Portal'daki ad ile SMART'taki
`ElementName` **birebir** tutmak zorunda — tutmazsa talep açılırken hata döner.)

| Portal'ın gönderebileceği | Örnek değer |
|---|---|
| İşlemi yapan kullanıcı | `hakanisc` |
| Ortam / platform | `prod` / `ark` |
| Cluster(lar) | `gbocpprod1, gbocpprod2` |
| Namespace | `odeme-prod` |
| Uygulamalar | `payment-api, batch-worker` |
| İşlem | `Durdur` / `Geri Al` / `Ölçekle` |
| Hedef replica | `0` |
| **Etkilenecek hedef sayısı** | `6` (2 cluster × 3 uygulama) |
| Geri alınabilir mi | `Evet` |
| OCO numarası (varsa) | `1234567` |

### S3. `integrationKey` gerekiyor mu?

Portal servis bazında `rff-request-token` override'ı destekliyor. Chaos Scale için ayrı
bir token mı kullanılacak, global token mı?

### S4. Onay süresi

Portal varsayılanı **15 dakika**; süre dolarsa talep `TIMEOUT` olur ve otomasyon **hiç
çalışmaz** (yarım kalmış bir işlem oluşmaz). Bir kesinti işlemi için 15 dakika uygun mu,
yoksa daha uzun mu olmalı?

### S5. İptal

Bilinen bir kısıt: **SMART tarafında bir kaydı kapatan REST ucu bilinmiyor.** Kullanıcı
portaldan iptal ettiğinde portal kendi kaydını `CANCELLED` yapıyor ve otomasyonu asla
tetiklemiyor, ama **SMART'taki kayıt açık kalıyor**. Bunun için bir uç var mı, yoksa
kayıt elle mi kapatılmalı?

---

## 3. OCO — netleşmesi gerekenler

Portal tarafı hazır: `getChangeOrderByWfInstanceId` sorgusu, `PlannedInterruption`
penceresi hesabı (başlangıç = bitiş ise **2 saat** kuralı dâhil), pencere öncesi için
zamanlama, pencere dolmuşsa engelleme.

### O1. Bir OCO kaydı kaç cluster'ı kapsar?

Chaos Scale'de tek bir işlem **birden çok cluster'a** dokunabilir (`ark_prod` grubunda
10+ cluster var). Bir OCO kaydı bunların hepsini kapsayabilir mi, yoksa **cluster başına
ayrı kayıt** mı gerekir? Portal her cluster için ayrı kayıt tutuyor; OCO tarafında da
ayrı gerekiyorsa ekran kullanıcıdan birden çok OCO numarası isteyecek şekilde kurulur.

### O2. `restore` (geri alma) için OCO zorunlu mu?

**Önerimiz: hayır — uyarsın ama engellemesin.**

Gerekçe: geri alma bir **onarım** işlemidir. Bir olay sırasında OCO penceresi kapalı diye
sistemi ayağa kaldıramamak, kapının çözdüğü sorundan daha büyük bir sorun olur. SMART
kaydı yine açılır (iz kalsın), yalnızca OCO penceresi zorlayıcı olmaz.

**Kabul etmezseniz** `restore` da tam kapıdan geçecek şekilde kurarız — karar sizin.

### O3. Pencere öncesi "zamanla" seçeneği anlamlı mı?

Portal, OCO penceresi henüz **başlamamışsa** işi pencere başlangıcına zamanlayabiliyor.
Replica durdurma için bu anlamlı mı, yoksa kullanıcı o saatte başında mı olmalı?

### O4. Ölçekleme (`scale`) bir "değişiklik" mi?

`stop` açıkça kesinti. Peki replica sayısını **artırmak** (ör. 3 → 6, kapasite artışı)
OCO gerektiriyor mu? Bugün portal her `apply` işlemini aynı sınıfta değerlendiriyor.

---

## 4. Portalın kendi bulduğu, sizi ilgilendiren bir risk

> Bu Chaos Scale'den **bağımsız**, bugün Self Service'i de etkileyen bir konu —
> incelenirken çıktı, bilginize.

**OCO pencere hesabı sunucunun saat dilimini kullanıyor.** `server/oco/window.cjs`,
OCO'dan gelen `dd.MM.yyyy HH:mm:ss` biçimindeki tarihleri **yerel saatte** kuruyor;
varsayım "portal sunucusu da kurum saatinde (`Europe/Istanbul`) çalışıyor".

Ancak portal deposunda `process.env.TZ` **hiçbir yerde ayarlanmıyor** (deploy scriptleri,
Jenkinsfile, `.env.example` tarandı). Prod sunucusu UTC ile çalışıyorsa **tüm OCO
pencereleri 3 saat kayar** — pencere içindeyken "süresi dolmuş" denebilir ya da tersi.

Ayrıca AWX zamanlaması için kullanılan `OCO_SCHEDULE_TZ` değişkeni, Admin ekranından
değiştirilebilen ayarlar listesinde **yok**; yalnızca gerçek `.env` dosyasıyla
ayarlanabiliyor.

**Bizden istenen:** prod portal sunucusunun saat dilimini teyit edin. `Europe/Istanbul`
değilse portal tarafında açıkça sabitlenmesi gerekir; bu, Chaos Scale'den bağımsız olarak
bugünkü Self Service OCO davranışını da düzeltir.

---

## 5. Portalın taahhüdü

Sizden bir şey beklemeden şunlar zaten olacak:

- Her gerçek değişiklik (`apply`) **denetim kaydına** yazılır: kim, ne zaman, hangi
  cluster/namespace/uygulama, hangi işlem, hangi SMART/OCO numarası.
- Ortam **prod** ise ve OCO açık pencere yoksa iş **hiç başlatılmaz**.
- Prod + çok cluster işlemlerinde kullanıcı hedef namespace adını **elle yazarak** teyit
  eder.
- Portal, cluster'da **hangi uygulamaların durdurulmuş olduğunu** sürekli izler ve
  cluster gerçeğiyle kendi kaydı ayrışırsa (biri elle geri almış, biri AWX'ten elle
  durdurmuş) bunu **gizlemez, ekranda gösterir**.
- Hiçbir işlem HPA'ya dokunmaz.
- `dry_run` hiçbir kapı gerektirmez — hiçbir şey değiştirmediği için.

---

## 6. Cevap beklediğimiz sorular — özet

| # | Soru | Cevap |
|---|---|---|
| S1 | Ayrı `flowKey` mi? | |
| S2 | `ElementName` eşlemesi nedir? | |
| S3 | Ayrı `integrationKey` gerekiyor mu? | |
| S4 | 15 dakika onay süresi uygun mu? | |
| S5 | Kaydı kapatan bir uç var mı? | |
| O1 | Bir OCO kaydı çok cluster'ı kapsar mı? | |
| O2 | `restore` için OCO zorunlu mu? (önerimiz: hayır) | |
| O3 | Pencere öncesi zamanlama anlamlı mı? | |
| O4 | Replica **artırma** OCO gerektirir mi? | |
| TZ | Prod portal sunucusunun saat dilimi nedir? | |
