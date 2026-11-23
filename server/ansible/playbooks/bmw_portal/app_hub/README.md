# app_hub — Application Hub OpenShift canlı okuma

Portal'daki **Application Hub** ekranı (`/application-hub`) bir OpenShift uygulaması için envanterde olmayan bilgiyi bu işle okur:

- tür: Deployment, DeploymentConfig, StatefulSet ya da Argo Rollout
- replika (istenen / hazır / güncel / kullanılabilir), strateji, Argo CD izi
- container imajı, CPU / bellek istek ve limitleri
- JVM ortam değişkenleri (JAVA_OPTS ailesi), **maskeli**
- pod'lar: durum, hazır, restart, **çalıştığı node**
- HPA (min / max / güncel)

**Salt okunur.** Bastion'da yalnız `oc login` ve `oc get` çalışır. Hiçbir nesneye yazılmaz; scale ya da rollout yapılmaz.

## Portal kaydı

| Alan | Değer |
|---|---|
| Playbook kayıt anahtarı | `app_hub_ocp_canli` (Admin > Playbook Kayıtları) |
| Ortam değişkeni | `APP_HUB_OCP_TEMPLATE_ID` |
| AWX job template | `bmw_portal/app_hub/app_hub_ocp.yml`, **extra variables prompt-on-launch açık** |
| Kimlik | `bmw_openshift_jobs/global_variables/credentials.yaml` (opsx_openshift_pods ile aynı) |

## Girdi (extra_vars, Portal kurar)

| Değişken | Açıklama |
|---|---|
| `app_hub_app` | Nesne adı (`Openshift_Inventory.application`) |
| `app_hub_targets` | `[{cluster, namespace}]`, en çok 20 |
| `ocp_clusters`, `terminal_hosts` | `logx/v2/ocp.cjs buildOcpExtraVars` fan-out'u (cluster başına bastion, api_url, credential_key, username) |
| `oc_binary`, `ocp_username` … | LogX OCP çalışma zamanı ayarları (`buildOcpRuntimeVars`) |

## Çıktı

`set_stats.app_hub_ocp_result = { app, overall_status: ok|partial|failed, results: [{cluster, namespace, ok, lines[], error?}] }`

Satır biçimi `files/app_hub_ocp.sh` başında yazar (`OBJ`, `CONT`, `ENV`, `POD`, `HPA`, `NOTE`, `ERR`, `END`). Portal ayrıştırıcısı: `server/app-hub/canli.cjs satirlariCoz`. `END` gelmeyen çıktı "tamamlanmadı" sayılır.

Sonuç Portal DB'de `app_hub_ocp_canli` tablosuna yazılır. Sonraki ziyaretçi yeni iş açmadan son okumayı ve okuma zamanını görür.

## Maske

Betik yalnız JVM ile ilgili env değişkenlerini yazar: `JAVA_OPTS`, `JAVA_OPTIONS`, `JAVA_TOOL_OPTIONS`, `JDK_JAVA_OPTIONS`, `_JAVA_OPTIONS`, `JAVA_OPTS_APPEND`, `JVM_OPTS`, `CATALINA_OPTS`, `*_JAVA_OPTS`, `GC_*` ve `JAVA_*_MEM_RATIO`. Diğer env'ler (ör. `DB_PASSWORD`) hiç yazılmaz.

Değerde:
- `-X…` belirteçleri açık kalır.
- `-Dk=v` yalnız `k` beyaz listedeyse (`java.`, `jboss.`, `file.encoding`, `user.timezone`, `spring.profiles.active` …) ve sır kalıbına (`pass|pwd|secret|token|credential|key…`) uymuyorsa açık kalır. Diğerleri `-Dk=***` olur.
- Sır kalıbına uyan serbest belirteç `***` olur.

`secretKeyRef` / `configMapKeyRef` değeri **okunmaz**; yalnız referansın adı yazılır. Portal okurken `server-hub/mask.cjs maskJvmArgs` ile ikinci kez maskeler.

## Tuzaklar

- Rollout CRD'si olmayan cluster'da `rollouts.argoproj.io` sorgusu hata değil `NOTE` üretir. Aynı kural DeploymentConfig için de geçerli.
- Parola `oc login` argümanında görünür (bastion `ps`). Bu, `opsx_openshift_pods.yaml` ile aynı modeldir. Parola komut satırına Ansible'dan değil ortam değişkeninden gelir ve `no_log` altındadır.
- Kubeconfig iş başına `/tmp/app-hub-<iş>-<cluster>-<ns>.kubeconfig` dosyasına yazılır ve iş sonunda silinir. Betik kopyası `/var/tmp/.app_hub_ocp.*.sh` adıyla oluşturulur, sha1 ile doğrulanır ve silinir.
- Bekçi: `server/app-hub/__tests__/app-hub.test.cjs` (AH1-AH5). Sahte `oc` ile maske, yalnız `login`/`get` kullanımı, yorum satırı yokluğu ve `set_stats`'ın `fail`'den önce gelmesi denetlenir.

---

# app_hub_fleet — saatlik filo taraması (2026-11-18)

Portal, Application Hub'daki **tüm** OpenShift uygulamalarının verisini saatte bir kendiliğinden tazeler. Bu tarama `app_hub_fleet.yml` ile yapılır. "Canlı oku" yalnız o anki durum gerektiğinde kullanılır. Ekranda (cluster, namespace) başına hangi veri daha yeniyse o gösterilir; kartta kaynağı ("saatlik tarama" ya da "canlı okuma") ve okuma zamanı yazar.

Toplanan bilgi canlı okumayla aynıdır: tür, replika, imaj, CPU / bellek istek ve limitleri, maskeli JVM env'leri, pod'lar, node'lar ve HPA. Ek olarak her uygulamanın **pod sayısı** (hazır / toplam) toplanır. Pod sayısı tüm pod'lardan hesaplanır; pod listesi en çok 200 satır gösterir.

**Salt okunur.** Cluster başına tek `oc login` yapılır, ardından tür başına tek `oc get -A` çalışır: deployment, deploymentconfig, statefulset, rollouts, pods ve hpa. Hiçbir nesneye yazılmaz.

## Portal kaydı

| Alan | Değer |
|---|---|
| Playbook kayıt anahtarı | `app_hub_ocp_filo` (Admin > Playbook Kayıtları) |
| Ortam değişkeni | `APP_HUB_OCP_FILO_TEMPLATE_ID` |
| AWX job template | `bmw_portal/app_hub/app_hub_fleet.yml`. **Extra variables prompt-on-launch açık olmalı.** Limit boş bırakılır. |
| Kimlik | Bastion'lar ve yazıcı sunucu için geçerli makine kimliği, `credentials.yaml` (canlı okumayla aynı) |
| Aralık | `APP_HUB_FILO_ARALIK_DK` (varsayılan 60; en az 30) |
| Kapatma | `APP_HUB_FILO_KAPALI=1`. Şablon tanımlı değilse de tarama hiç başlamaz. |
| Paylaşılan dizin | `APP_HUB_FILO_DIR` (varsayılan `/sw/BMW_PORTAL/app_hub_ocp`) |
| Yazıcı sunucu | `APP_HUB_FILO_YAZICI`; boşsa Portal sunucusunun kısa adı (büyük harf) kullanılır. Bu sunucu `/sw`'ye yazabilmeli ve AWX'ten erişilebilir olmalı. |

## Girdi (extra_vars, Portal kurar)

| Değişken | Açıklama |
|---|---|
| `ocp_clusters`, `terminal_hosts` | Portal cluster kataloğundaki **tüm aktif** cluster'lar. Fan-out canlı okumayla aynıdır (`buildOcpExtraVars`). |
| `app_hub_fleet_run` | Portal koşu numarası |
| `app_hub_fleet_dir` | Paylaşılan dizin. Sonuç `<dizin>/run-<koşu>/raw/<CLUSTER>.out` dosyasına yazılır. |
| `app_hub_fleet_writer` | Dosyayı yazan sunucu (`delegate_to`) |
| `app_hub_fleet_slots` | Aynı bastion'da aynı anda taranan cluster sayısı (varsayılan 3). `oc get pods -A` belleği nedeniyle sınırlıdır. |
| `app_hub_fleet_parallel` | `-A` yasaksa, namespace başına okumanın paralelliği (varsayılan 6) |
| `app_hub_fleet_cluster_timeout` | Cluster başına süre sınırı (varsayılan 1800 sn; slot alındıktan sonra başlar) |
| `app_hub_fleet_poll_delay` | Taramaların bitişini yoklama aralığı (varsayılan 15 sn; testler 1 verir) |

## Çıktı

- **Dosya:** cluster başına bir dosya oluşur. Dosyanın ilk satırı `APPHUB_FLEET_SUMMARY`'dir, ardından `@@APPHUB_FLEET_BEGIN@@ base64(gzip(kayıtlar)) @@APPHUB_FLEET_END@@` gelir. Kayıt biçimi `files/app_hub_fleet.sh` dosyasının başında yazar. Veri AWX artifact'ına konmaz, çünkü filo verisi AWX ve Portal JSON sınırlarını aşar.
- **set_stats:** `app_hub_fleet_result = { run, dir, overall_status, results: [{cluster, ok, complete, written, summary, error}] }`. Yalnız özet içerir.
  - `written` yalnız paylaşılan dosya gerçekten yazıldıysa `true` olur. Yazma düşerse (dizin yok, disk dolu, izin yok) `error` "could not write to the shared directory: <sebep>" olur ve cluster `ok` sayılmaz. Hiçbir cluster yazılamazsa iş FAILED biter.
  - Giriş kapısı düşerse (eksik ya da geçersiz değişken) de yayınlanır: `{ overall_status: failed, error, results: [] }`. Portal koşuyu bu sebeple HATA yazar.
  - Ulaşılamayan bastion'un cluster'ları "bastion unreachable: <sebep>" taşır.
  - `terminal_host`'u boş ya da `null` olan cluster sıralanmış ilk bastion'da taranır; toplayıcı da aynı bastion'a bakar.
  - Bastion'da geçici dosya (kubeconfig, parola, betik) silinemezse sonuç yine yayınlanır, `cleanup_errors` dolar ve iş en sonda FAILED olur. Portal bunu koşunun hata alanına yazar. Temizlikte `assert` yoktur: tek bastion'lık partide düşen assert toplayıcı play'i hiç koşturmazdı.
  - Yazıcı sunucu giriş kapısında ulaşılamazsa sebep "writer host unreachable" ile yayınlanır; yazma anında ulaşılamazsa cluster `written:false` olur.
- **Portal tarafı:** dosyaları `server/app-hub/filo.cjs` okur ve `app_hub_ocp_filo` tablosuna **fark** yazar:
  - yeni satır eklenir,
  - değişen satır güncellenir,
  - değişmeyen satırın yalnız zamanı tazelenir,
  - görülmeyen satır silinir.

## Tuzaklar

- **Okunamadı ≠ yok:**
  - `-A` yasaksa betik namespace başına okumaya geri döner.
  - Okunamayan namespace `NSFAIL` olarak işaretlenir; bir tür hiç okunamazsa `KINDFAIL` yazılır. Bu kapsamdaki satırlar **silinmez**, eski zamanıyla kalır.
  - Pod listesi okunamayan yerde pod sayısı "ölçülemedi" görünür, 0 yazılmaz.
  - `END` kaydı gelmeyen dosya hiç yazılmaz.
- **Pod'un sahibi** ek `oc` çağrısı yapmadan çıkarılır:
  - ReplicaSet adı, `<ad>-<pod-template-hash>` biçiminden (Rollout için `rollouts-pod-template-hash` kullanılır);
  - ReplicationController, `deploymentconfig` etiketinden;
  - StatefulSet doğrudan.
  
  Job / CronJob pod'ları uygulamaya sayılmaz.
- **Maske:**
  - `SAFE_PREFIX`, `SECRET_RE` ve `JVM_ENV_RE` iki betikte birebir aynıdır; bekçi AF4 bunu denetler.
  - Desenler awk'a `ENVIRON` ile verilir. `awk -v` kullanılırsa `java\.` desenindeki kaçış yutulur ve beyaz liste gevşer. Canlı okuma betiğinde de 2026-11-18'de bu yüzden düzeltildi.
- **Koşu kuralları:**
  - Aynı zaman dilimi iki kez koşmaz; koşular üst üste binmez. Kural DB'de uygulanır (`app_hub_ocp_filo_kosu.anahtar` UNIQUE + UPDLOCK); iki Portal süreci açık olsa da geçerlidir.
  - Portal kapalıyken kaçan dilim telafi edilmez; bir sonraki dilim zaten tam taramadır.
- **Saklama:**
  - Koşu satırları 14 gün tutulur.
  - `/sw` koşu dizinleri 48 saat tutulur.
  - 7 gündür tazelenmeyen önbellek satırı silinir; bu, katalogdan çıkan cluster'ları kapsar.
- **Bastion'da geçici dosyalar (2026-11-22):**
  - Parola betiğe tek seferlik bir dosyayla gider: koşu dizininde `p.<cluster>` (0600, `no_log` ile yazılır). Betik dosyayı okur ve hemen siler.
    - Ansible `environment:` kullanılmaz: ortam değişkenleri uzak komut satırına (`/bin/sh -c 'OCP_PASS=…'`) yazılır. Bu satır `ps`'te ve `-vvv` AWX çıktısında görünür; `no_log` bunu gizlemez.
    - `command` `stdin:` de kullanılmaz: ansible-core 2.16 modül argümanlarını (stdin dahil) async iş dosyasına (`~/.ansible_async/<jid>`) düz metin yazar.
    - `oc login` parolayı `--password` yerine stdin'den alır; argv login süresince `ps`'te herkese görünüyordu. oc 4.22'nin tty olmayan stdin'den parola okuduğu sahte bir OAuth sunucusuyla doğrulandı (2026-11-22). Bastion'daki oc okumazsa login boş parolayla düşer, tarama "oc login failed" der. Merge sonrası ilk saatlik koşu kanaryadır; düşerse yalnız bu değişikliğin commit'i geri alınır.
  - Kubeconfig betiğin kendi iş dizinindedir (`/tmp/app-hub-fleet-w.<iş>.XXXXXXXX`, 0700, mktemp). Tahmin edilebilir bir `/tmp` yolu yoktur. Playbook iş sonunda bu işin dizinlerini siler ve kalmadığını doğrular; 3 saatten eski artıklar da silinir.
  - Koşu (slot) dizini `ansible.builtin.tempfile` ile açılır (0700, rastgele ad). Slot kilitleri ve tek seferlik parola dosyaları buradadır; 3 saatten eski artıklar (iptal edilen işler) sonraki koşuda silinir. Betik sahibi kendisi olmayan, symlink olan ya da başkasına yazılabilir slot dizinini reddeder ve symlink slot dosyasını açmaz. Eski sabit yol (`/tmp/app-hub-fleet-slots-<iş>`) başka bir yerel kullanıcının `slot.N -> <dosya>` koyup dosyayı sıfırlatmasına ya da kilitleri tutmasına izin veriyordu.
- **Bekçi:**
  - `server/app-hub/__tests__/app-hub-filo.test.js` (AF1-AF19), `src/components/app_hub/__tests__/ocp-pod.test.tsx` (OP1-OP5) ve ekranda ortam içi cluster karşılaştırması `src/components/app_hub/__tests__/ocp-karsilastir.test.tsx` (OK1-OK8).
  - Gerçek `ansible-playbook` koşumu: `server/ansible/__tests__/app-hub-filo-gercek-kosum.test.js` (FK1-FK7: async dosyasında ve `-vvv`'de parola, yazılamayan dosya, ulaşılamayan bastion ve yazıcı, boş `terminal_host`, giriş kapısı, silinemeyen geçici dosya). CI'da da koşar (GitHub Ubuntu imajında `ansible-playbook` kurulu); 2.16'ya özgü async sızıntısı için yerelde PATH'e eski sürüm konur.
