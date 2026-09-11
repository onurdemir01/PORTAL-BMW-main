# `bmw_portal/scalex/` — ScaleX'in AWX paketi

Bu klasör, ScaleX'in AWX tarafında çalışması için gereken **her şeyi** taşır ve
kurumsal AWX proje reposuna **olduğu gibi kopyalanacak** şekilde düzenlenmiştir.

Portal bu dosyaları **çalıştırmaz** — burada referans olarak dururlar ki portal
sözleşmesi (`extra_vars` adları, `set_stats` anahtarları) ile playbook aynı depoda,
aynı commit'te ve aynı testlerle birlikte doğrulanabilsin. LogX'te de aynı düzen
`server/ansible/bmw_portal/logx/` altında var.

> Sözleşme testleri: `server/ansible/__tests__/scalex-awx-package.test.cjs`.
> Bu testler gerçek `scalex_runner.sh`'i sahte bir `oc` ile çalıştırıp çıktısını
> portalın gerçek ayrıştırıcısından (`server/scalex/result.cjs`) geçirir.

---

## Ne, nereye kopyalanır

| Buradaki yol           | AWX projesindeki yol                                                         |
| ---------------------- | ---------------------------------------------------------------------------- |
| `scalex_app/` (tamamı) | `<AWX_PROJECT_DIR>/bmw_portal/scalex/scalex_app/`                            |
| `awx/*.survey.json`    | Kopyalanmaz — AWX API'siyle template'e yüklenir (bkz. `SCALEX_AWX_SETUP.md`) |

```
AWX_PROJECT_DIR/
├── bmw_portal/
│   └── scalex/
│       └── scalex_app/          ← bu paketten kopyalanır
│           ├── main.yml         (mutasyon: stop / restore / scale, dry_run + apply)
│           ├── discovery.yml    (keşif: workloads / state / health — SALT OKUNUR)
│           ├── openshift_inventory_scalex.yaml   (yedek cluster kataloğu)
│           ├── tasks/
│           └── files/scalex_runner.sh
└── bmw_openshift_jobs/
    └── global_variables/        ← ZATEN VAR, bu pakette YOK
        ├── credentials.yaml     (vault: OCP servis kullanıcısı parolaları + `username`)
        └── mail_vars.yml        (SMTP: smtp_host, smtp_port, mail_from, mail_subject_prefix)
```

`main.yml` ve `discovery.yml`,
`../../../bmw_openshift_jobs/global_variables/` yolunu kullanır. Bu yüzden yukarıdaki
göreli derinlik sözleşmedir; paket başka bir seviyeye konursa `vars_files` çözülemez
ve iş açılışta düşer.

Üretimdeki kurulum `bmw_portal/scalex/scalex_app/` yolunda duruyor (AWX job #3280508).

---

## Bu paket, üretimde çalışan `chaos_scale_app`'in devamıdır

Kaynak: `github.com/hknisci/garanti_tasks` → `scale/`. Yapı korundu
(`main.yml` → `01_prepare` → `02_select_targets` → precheck → strict guard →
execute → `20_build_report` → `30_send_mail`); portal ile çalışabilmesi için
eklenenler:

| Değişiklik                                                           | Neden                                                                                                                                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`set_stats` ile `scalex_result` yayını** (`25_publish_result.yml`) | Çalışan otomasyonda `set_stats` **hiç yoktu**. Portal sonucu **yalnızca** bu artifact'tan okur; onsuz her iş "sonuç bulunamadı" ile biterdi.                                                |
| **`block`/`rescue` + `26_publish_validation.yml`**                   | Girdi doğrulaması düştüğünde playbook `set_stats`'a hiç ulaşmıyordu. Artık `stage: validation` + hata metni + düşen görev adı yayınlanıyor.                                                 |
| **Portal kataloğu kazanır** (`scalex_clusters_override`)             | Cluster/bastion/vault bilgisi Admin > LogX Yapılandırma'dan tek yerden yönetiliyor. Dosya artık yalnızca elle çalıştırma yedeği; hangisinin kullanıldığı `catalog_source` ile raporlanıyor. |
| **`scalex_target_clusters` listesi önceliklidir**                    | Portal listeyi kullanıcının **yetki süzgecinden** geçirerek üretiyor. `all` ile katalogdan yeniden türetmek, kullanıcının göremediği bir cluster'ı geri getirebilirdi.                      |
| **Durum ConfigMap öneki `scalex-state-`**                            | Eski önek (`chaos-scale-state-`) **okunmaya devam ediyor** ve `legacy=yes` rozetiyle işaretleniyor — bugün durdurulmuş uygulamalar geri alınabilir kalmalı.                                 |
| **Keşif fazı** (`SCALEX_PHASE=discover`)                             | Çalışan pakette keşif yoktu. Portalın ikinci template'i (`scalex_discovery`) bunu bekliyor. Ayrı betik yazılmadı: oturum açma / `oc` yolu bulma / kubeconfig mantığı aynı dosyada.          |
| **`hpa_pin` (opsiyonel)**                                            | Varsayılan davranış **değişmedi**: HPA okunur, dokunulmaz. Bayrak yalnızca kullanıcı ekranda açıkça isterse ve yalnızca `stop` dışı + hedef ≥ 1 durumunda etkindir.                         |

`mail_cc` desteği çalışan pakette **zaten vardı**; değiştirilmedi.

---

## Çalışma dizini adları neden hâlâ `chaos-scale-job`

`scalex_runner.sh` bastion üzerinde `/sw/openshift/chaos-scale-job` gibi geçici
çalışma dizinleri kullanır. Bu adlar **bilerek değiştirilmedi**: dizinler
üretimdeki bastion'larda mevcut ve izinleri ayarlı; yeniden adlandırmak, üst
dizinde yazma izni olmayan bir host'ta işi düşürürdü. Bu yollar sözleşmenin
parçası değil, yalnızca geçici alan.

---

## Hangi workload tipleri

Keşif tip listesini **cluster'ın kendisinden** alır:
`oc api-resources --namespaced=true --verbs=list` — bu çağrı yetki gerektirmez
(discovery her kimliğe açıktır) ve iki soruyu birbirinden ayırır: _"bu tip burada var mı"_
ve _"listeleyebiliyor muyum"_. Envanter okunamazsa aşağıdaki sabit listeye düşülür,
davranış gerilemez.

Bilinen tipler şunlar; işlem yalnızca **ölçeklenebilir** olanlara dokunur.

| Tip              | Keşifte | İşlem | Neden                                                    |
| ---------------- | ------- | ----- | -------------------------------------------------------- |
| Deployment       | ✅      | ✅    |                                                          |
| StatefulSet      | ✅      | ✅    |                                                          |
| DeploymentConfig | ✅      | ✅    |                                                          |
| Argo Rollout     | ✅      | ✅    |                                                          |
| DaemonSet        | ✅      | ❌    | `spec.replicas` yoktur; düğüm sayısıyla ölçeklenir       |
| CronJob          | ✅      | ❌    | `spec.suspend` ile durdurulur; replica semantiği taşımaz |

ReplicaSet / ReplicationController / Pod **bilerek dışarıdadır**: bunlar
Deployment ve DeploymentConfig'in sahip olduğu nesnelerdir. Listelemek her
uygulamayı iki kez gösterir ve kullanıcıya denetleyicinin saniyeler içinde geri
alacağı bir "ölçekle" düğmesi sunardı.

**Listede olmayan tipler de görünür.** Cluster'da `scale` alt kaynağı olan bir CRD
(operator ile gelen `kafkas.kafka.strimzi.io` gibi) keşifte listelenir ve
`scalable=no reason=unsupported_kind` ile gelir: **görünür ama seçilemez.** İşlem yolu bu
tipler için uçtan uca denenmedi; `scalable=yes` demek, çalışacağını kanıtlamadığımız bir
düğme sunmak olurdu.

**Bakılamayan tip sessizce atlanmaz.** Bir tipin `oc get`'i düşerse (yetki yok,
DeploymentConfig API'si kapalı, Rollout CRD'si kurulu değil) keşif bunu ayrıca
bildirir ve nedenini ayırır:

```
;-;DeploymentConfig;WORKLOAD_KIND;WARN;kind=dc reason=api_absent verb=list ...
;-;ArgoRollout;WORKLOAD_KIND;WARN;kind=rollout reason=no_permission verb=list ...
```

`no_permission` kullanıcının platform ekibinden isteyebileceği bir şeydir;
`api_absent` hakkında yapacak bir şey olmayan bir olgudur. Bu ayrım olmadan ekran
"StatefulSet yok" ile "StatefulSet'e bakamadım"ı ayırt edemiyordu.

## Tip tespiti: `workload_kinds`

İşlem tarafında tip `auto` ile tespit edilir. Aynı ad birden fazla tipte varsa
(bir Deployment ile aynı adlı bir DeploymentConfig) otomatik tespit işi durdurur —
doğru davranış, ama kullanıcının çıkış yolu yoktu.

Portal keşifte tipi zaten gördüğü için artık söylüyor: opsiyonel `workload_kinds`
survey alanı `uygulama=tip` çiftlerini taşır (`odeme-api=deploy,kafka=sts`).
Geçerli tipler `deploy`, `sts`, `dc`, `rollout`. Boş bırakılırsa bugünkü `auto`
davranışı aynen sürer, yani elle çalıştırma bozulmaz.

## Sırada ne var

Kurulum adımları, AWX template alanları, survey'in API ile yüklenmesi ve portalda
aktifleştirme: **`SCALEX_AWX_SETUP.md`**.
