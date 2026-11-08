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
