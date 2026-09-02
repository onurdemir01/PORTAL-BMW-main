# `scalex_file/` — ScaleX'in AWX paketi

Bu klasör, ScaleX'in AWX tarafında çalışması için gereken **her şeyi** taşır ve
kurumsal AWX proje reposuna **olduğu gibi kopyalanacak** şekilde düzenlenmiştir.

Portal bu dosyaları **çalıştırmaz** — burada referans olarak dururlar ki portal
sözleşmesi (`extra_vars` adları, `set_stats` anahtarları) ile playbook aynı depoda,
aynı commit'te ve aynı testlerle birlikte doğrulanabilsin. LogX'te de aynı düzen var
(`server/ansible/playbooks/logx_*.yml`).

> Sözleşme testleri: `server/ansible/__tests__/scalex-awx-package.test.cjs`.
> Bu testler gerçek `scalex_runner.sh`'i sahte bir `oc` ile çalıştırıp çıktısını
> portalın gerçek ayrıştırıcısından (`server/scalex/result.cjs`) geçirir.

---

## Ne, nereye kopyalanır

| Buradaki yol | AWX projesindeki yol |
|---|---|
| `scalex_app/` (tamamı) | `<proje>/<klasör>/scalex_app/` — konum serbest |
| `awx/*.survey.json` | Kopyalanmaz — AWX API'siyle template'e yüklenir (bkz. `SCALEX_AWX_SETUP.md`) |

```
bmw_openshift_jobs/
├── global_variables/            ← ZATEN VAR, bu pakette YOK
│   ├── credentials.yaml         (vault: OCP servis kullanıcısı parolaları + `username`)
│   └── mail_vars.yml            (SMTP: smtp_host, smtp_port, mail_from, mail_subject_prefix)
└── scalex_app/                  ← bu paketten kopyalanır
    ├── main.yml                 (mutasyon: stop / restore / scale, dry_run + apply)
    ├── discovery.yml            (keşif: workloads / state / health — SALT OKUNUR)
    ├── openshift_inventory_scalex.yaml   (yedek cluster kataloğu)
    ├── tasks/
    │   ├── 01_prepare.yml  02_select_targets.yml  10_run_phase.yml
    │   ├── 20_build_report.yml  25_publish_result.yml  26_publish_validation.yml
    │   ├── 30_send_mail.yml
    │   └── discovery/ 01_prepare.yml  10_discover.yml
    │                  25_publish_result.yml  26_publish_validation.yml
    └── files/
        └── scalex_runner.sh     (cluster üzerindeki tüm `oc` işi — tek dosya)
```

**Tek şart — klasörün mutlak yolu değil, göreli konumu:** `main.yml` ve `discovery.yml`
`../global_variables/` yolunu kullanır, yani `scalex_app/` klasörü **`global_variables/`
ile kardeş** olmalıdır. Başka bir yere konursa `vars_files` çözülemez ve iş açılışta düşer.

Üretimdeki kurulum bu koşulu sağlayan `bmw_portal/scalex/scalex_app/` yolunda duruyor
(AWX job #3280508). Aşağıdaki ağaç `bmw_openshift_jobs/` örneğiyle çizilmiştir; kendi
projenizdeki klasör adı farklı olabilir.

---

## Bu paket, üretimde çalışan `chaos_scale_app`'in devamıdır

Kaynak: `github.com/hknisci/garanti_tasks` → `scale/`. Yapı korundu
(`main.yml` → `01_prepare` → `02_select_targets` → precheck → strict guard →
execute → `20_build_report` → `30_send_mail`); portal ile çalışabilmesi için
eklenenler:

| Değişiklik | Neden |
|---|---|
| **`set_stats` ile `scalex_result` yayını** (`25_publish_result.yml`) | Çalışan otomasyonda `set_stats` **hiç yoktu**. Portal sonucu **yalnızca** bu artifact'tan okur; onsuz her iş "sonuç bulunamadı" ile biterdi. |
| **`block`/`rescue` + `26_publish_validation.yml`** | Girdi doğrulaması düştüğünde playbook `set_stats`'a hiç ulaşmıyordu. Artık `stage: validation` + hata metni + düşen görev adı yayınlanıyor. |
| **Portal kataloğu kazanır** (`scalex_clusters_override`) | Cluster/bastion/vault bilgisi Admin > LogX Yapılandırma'dan tek yerden yönetiliyor. Dosya artık yalnızca elle çalıştırma yedeği; hangisinin kullanıldığı `catalog_source` ile raporlanıyor. |
| **`scalex_target_clusters` listesi önceliklidir** | Portal listeyi kullanıcının **yetki süzgecinden** geçirerek üretiyor. `all` ile katalogdan yeniden türetmek, kullanıcının göremediği bir cluster'ı geri getirebilirdi. |
| **Durum ConfigMap öneki `scalex-state-`** | Eski önek (`chaos-scale-state-`) **okunmaya devam ediyor** ve `legacy=yes` rozetiyle işaretleniyor — bugün durdurulmuş uygulamalar geri alınabilir kalmalı. |
| **Keşif fazı** (`SCALEX_PHASE=discover`) | Çalışan pakette keşif yoktu. Portalın ikinci template'i (`scalex_discovery`) bunu bekliyor. Ayrı betik yazılmadı: oturum açma / `oc` yolu bulma / kubeconfig mantığı aynı dosyada. |
| **`hpa_pin` (opsiyonel)** | Varsayılan davranış **değişmedi**: HPA okunur, dokunulmaz. Bayrak yalnızca kullanıcı ekranda açıkça isterse ve yalnızca `stop` dışı + hedef ≥ 1 durumunda etkindir. |

`mail_cc` desteği çalışan pakette **zaten vardı**; değiştirilmedi.

---

## Çalışma dizini adları neden hâlâ `chaos-scale-job`

`scalex_runner.sh` bastion üzerinde `/sw/openshift/chaos-scale-job` gibi geçici
çalışma dizinleri kullanır. Bu adlar **bilerek değiştirilmedi**: dizinler
üretimdeki bastion'larda mevcut ve izinleri ayarlı; yeniden adlandırmak, üst
dizinde yazma izni olmayan bir host'ta işi düşürürdü. Bu yollar sözleşmenin
parçası değil, yalnızca geçici alan.

---

## Sırada ne var

Kurulum adımları, AWX template alanları, survey'in API ile yüklenmesi ve portalda
aktifleştirme: **`SCALEX_AWX_SETUP.md`**.
