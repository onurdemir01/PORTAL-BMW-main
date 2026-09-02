# ScaleX — OCP replica durdurma / geri alma / ölçekleme

ScaleX, OpenShift iş yüklerinin replica sayısını portal üzerinden değiştirir. Üç işlem
de aynı mekanizmadır — bu yüzden adı "Chaos" değil **ScaleX**:

| İşlem | Ne yapar | Geri alınabilir mi |
|---|---|---|
| **Durdur** | `spec.replicas = 0`, önceki değer cluster'da bir ConfigMap'e yazılır | Evet — kayıt portalda ve cluster'da |
| **Geri Al** | Saklanan değere döner, kaydı siler | — |
| **Ölçekle** | Verilen sayıya çeker | Hayır — bu yol kayıt **bırakmaz** |

> **Ölçekle ile 0 verilemez.** Sunucu `use_stop_for_zero` ile reddeder. İki yol da 0'a
> götürürken birinin hafızası olup diğerinin olmaması bir tuzaktı.

## Mimari

```
Ekran (src/components/scalex)
   └─ /api/scalex  (server/scalex/index.cjs)
        ├─ catalog.cjs   cluster/namespace/uygulama katalogu + yetki
        ├─ launch.cjs    extra_vars üretimi, patlama yarıçapı, kapı politikası
        ├─ result.cjs    playbook artifact'ının ayrıştırılması
        ├─ state.cjs     scalex_state_mirror (durdurulmuş kayıtlar + sapma)
        └─ reconciler.cjs  yarım kalmış işleri SUNUCU tarafında sonuçlandırır
             ↓
        AWX (scalex_run / scalex_discovery şablonları)
             ↓
        server/ansible/scalex_file/scalex_app/*
        (playbook kaynağı — AWX'e kopyalanır; LogX ile aynı düzen)
```

### Neden bir uzlaştırıcı var

`finalizeOperation` uzun süre **yalnızca** tarayıcının durum yoklamasından çağrılıyordu.
Kullanıcı sekmeyi kapatırsa AWX işi çalışmaya devam eder ve uygulamaları gerçekten
durdurur, ama portal bunu hiç öğrenmez: işlem sonsuza dek `RUNNING` kalır, ayna boş
kalır ve "Şu an durdurulmuş" paneli **yanlış** bilgi verir — geri alma yolu kapanır.
`reconciler.cjs` periyodik olarak `RUNNING` işleri AWX'ten sorup sonuçlandırır. Mantık
tek yerde: uzlaştırıcı da aynı `finalizeOperation`'ı çağırır.

## Güvenlik kapıları

Kapı politikası `launch.gatePolicyFor` ile belirlenir:

| Durum | OCO | SMART |
|---|---|---|
| `dry_run` (Önce kontrol et) | yok | yok |
| `restore` + apply | uyarır, engellemez (gerekçe **zorunlu**) | gerekli |
| `stop` / `scale` + apply | gerekli | gerekli |

Kapılar **ortak modülden** gelir (`server/ansible/change-gates.cjs`) — Self Service'teki
nginx işleriyle aynı yol. Ayarlar `ansible_ss_customizations` tablosunda ScaleX'in kendi
`(awx_server_id, template_id)` satırında durur ve **Admin > Ansible > FieldOverridesModal**
ile yönetilir.

> **SMART yapılandırılmadan prod'da `apply` çalışmaz.** Sunucu `smart_not_configured` ile
> reddeder. Bu bilinçli bir fail-closed karardır: ayar satırı yokken `isSmartRequired`
> `false` döner ve işlem **onaysız** geçerdi — üstelik ekran kullanıcıya "SMART kaydı
> açılacak" yazarken.

### Prod tespiti

`server/oco/prod-detect.cjs` yalnızca `env` / `ortam` anahtarlarına bakar (bilinçli
olarak sabit). ScaleX ortamı `target_environment` adıyla gönderdiği için prod tespiti
**`gateVars`'tan da** okunur. İki kaynağı birlikte okumak güvenlidir: kapıyı yalnızca
daha sık açtırır, asla kapatmaz.

## Yetkilendirme

Varsayılan **açık** (LogX/OpsX ile aynı model): `logx_v2_restrictions` tablosunda satırı
olmayan kaynak herkese açıktır. Satırı varsa yalnızca grant'ı olanlar erişir.

- `ocp_namespace` — `<tenant>/<env>/<cluster>/<namespace>`
- `ocp_app` — `<tenant>/<env>/<cluster>/<namespace>/<app>`

Grant'lar kullanıcı adına **veya** AD grubuna verilebilir (`logx_v2_restriction_group_grants`;
grup üyeliği oturumdaki `user.groups`'tan okunur). Bu tablo LogX/OpsX/Telnet ile
**paylaşılır** — buradaki her değişiklik üç çalışan modülü etkiler.

> Grup grant tablosu yoksa yetki sorgusu patlamaz: bir kez uyarılır ve grup grant'ları
> **devre dışı** bırakılarak devam edilir. Gerileme yönü fail-closed.

## Kurulum

Ayrıntılı adımlar (AWX template alanları, survey'in API ile yüklenmesi, sık hatalar):
**`server/ansible/scalex_file/SCALEX_AWX_SETUP.md`**. Özet:

1. **AWX**: `server/ansible/scalex_file/scalex_app/` klasörünü AWX projesinde
   AWX projenizde `global_variables/` ile **kardeş** bir klasöre kopyalayın
   (üretimde `bmw_portal/scalex/scalex_app/`); iki şablon oluşturun
   (`main.yml` ve `discovery.yml`). Her ikisinde de **Prompt on launch > Variables
   AÇIK** olmalı — kapalıysa `extra_vars` sessizce yutulur ve playbook kendi katalog
   dosyasına düşer (ekran bunu `catalogWarning` ile söyler).
   Survey **açık** olabilir ama **hiçbir sorusu zorunlu olmamalı**: zorunlu bir soru,
   portalın API launch'ını `400 variables_needed_to_start` ile düşürür. Hazır
   tanımlar `scalex_file/awx/*.survey.json`.
2. **Portal**: Admin > Playbook Kayıtları'nda `scalex_run` / `scalex_discovery`
   satırlarına AWX şablon ve sunucu kimliğini girin (ya da `.env`'deki
   `SCALEX_TEMPLATE_ID` / `SCALEX_DISCOVERY_TEMPLATE_ID` / `SCALEX_AWX_SERVER_ID`).
3. **SMART/OCO**: Admin > Ansible > FieldOverridesModal ile ScaleX şablonu için
   `flowKey`, `metadataFields` ve `ocoCheck` tanımlayın. Prod `apply` için SMART
   yapılandırması **zorunludur** (fail-closed).
4. **Görünürlük**: sunucu açılışında element bazında otomatik seed edilir. Yeniden
   başlatmadan yapmak için `deploy/sql/2026-08-30-scalex-gorunurluk.sql`.

## Sessiz geri alma tuzakları

Bu ekran, "iş yeşil döndü ama değişiklik birkaç dakika sonra geri alındı" sınıfındaki
sorunları özellikle hedefler:

- **HPA** — replica 0'da HPA kendiliğinden devre dışı kalır (`ScalingActive=False`),
  bu yüzden `Durdur` kalıcıdır ve bu artık **okunan koşula** dayanır, şansa değil.
  Replica ≥ 1'de HPA devralabilir; ekran uyarır ve isteğe bağlı **sabitleme** sunar.
  Sabitleme yalnızca hedefi **bilinen ve ≥ 1** olan işlemlerde sunulur — hedef 0'da
  `minReplicas: 0` ya reddedilir ya da uygulamayı 0'da kilitler.
- **GitOps/ArgoCD** — auto-sync değişikliği geri alabilir; keşif etiketleri okur ve
  rozet gösterir.
- **PDB** — `minAvailable` tahliyeyi engelleyebilir; namespace'teki PDB'ler uyarı olur.
- **Doğrula-ve-tut** — hedefe ulaşıldıktan sonra `SETTLE_SECONDS` beklenip tekrar
  bakılır. Bu tek kontrol HPA'yı, GitOps'u ve operatör reconciler'larını aynı anda
  yakalar.

## Testler

```bash
npm test          # scripts/run-tests.cjs — Node sürümüne göre bayrak seçer
```

ScaleX bekçileri: `server/scalex/__tests__/` (doğrulama, sözleşme, güvenlik
düzeltmeleri, uzlaştırıcı) + `src/__tests__/scalex-ui-validation.test.cjs` +
`server/ansible/__tests__/scalex-awx-package.test.cjs`.

Sonuncusu **gerçek `scalex_runner.sh`'i sahte bir `oc` ile çalıştırır** ve çıktısını
portalın gerçek ayrıştırıcısından (`result.cjs`) geçirir; ayrıca survey ↔ `extra_vars`
eşleşmesini ve `set_stats` alan listesini kilitler. Playbook ayrı bir depoda çalıştığı
için bu sözleşme aksi halde ancak üretimde ("sonuç bulunamadı") görünürdü.

> Bekçi yazarken kural: her yeni bekçi, **kasıtlı bir mutasyonla** kör olmadığı
> kanıtlanır. Bu depoda birden çok kez, testin kendi açıklamasıyla eşleşip her zaman
> yeşil dönen bekçiler yazıldı.
