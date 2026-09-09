# opsx rollout düzeltmesi — elden taşıma paketi

> **Bu klasör Portal'ın parçası değildir.** Ansible deposuna (`gar_bmt_ansible_scripts`)
> push yetkim olmadığı için değişiklik buraya, taşınmak üzere konuldu. Uygulandıktan
> sonra silinebilir.
>
> Kanonik commit: `e5a63b400`

## Sorun

`bmw_portal/opsx_openshift_application_rollout` içinde `rollout.yaml`'daki
`oc patch ... restartAt` komutu **doğruydu** — komuta **sıra gelmiyordu**.

`main.yaml` tipi **tek sefer, tüm parti için** tespit ediyordu ve tespit döngüsü **ilk
uygulamada `exit`** ediyordu. Sonraki uygulamalara hiç bakılmadan, çıkan tek `rc`
(0/44/55/66) bütün partiyi tek bir dala yönlendiriyordu:

```
uygulama-bir (Deployment)   -> Exist,Success
uygulama-iki (Argo Rollout) -> "Not Exist,Failed"    <-- restart hiç denenmedi
```

Ters yön de geçerliydi: parti bir Rollout ile başlarsa Deployment'lar "Not Exist" olurdu.

Portal tek koşuda birden fazla `(namespace, application)` çifti gönderiyor
(`server/opsx/index.cjs` → `cleanPairs.map(...).join(';')`). Tek uygulamada veya tek
tipli partide sorun görünmüyordu — "bazen çalışıyor" hissi bundan.

## Çözüm — dosya-başına-tip düzeni korundu

Döngüde `exit` yerine **`continue`**; tespit **uygulama başına** yapılıyor ve her tip
dosyası **yalnız kendi listesini** işliyor.

```
detect.yaml (YENİ)   her uygulamayı ayrı değerlendirir, "<tip>,<ns>,<app>" satırları
                     üretir ve üç listeye ayırır
main.yaml            tipe göre dağıtım — her dosyaya `target_input` olarak yalnız kendi
                     listesi verilir
deployment.yaml      artık `oc_input` değil `target_input` işler
rollout.yaml         aynı + restartAt geri-okuması (aşağıda)
deploymentconfig.yaml aynı
```

ARK / non-ARK dallanmasına gerek kalmadı: tespit zaten "önce deployment, sonra rollouts,
sonra dc" sırasıyla çalışıyor; Argo CRD'si olmayan bir cluster'da `oc get rollouts` hata
verip bir sonraki tipe geçiyor — **non-ARK davranışı aynen korunuyor**.

## Ayrıca düzeltilen iki şey

Bunlar düzenle ilgili değil, gerçek hatalardı:

* **`oc patch` "unchanged" durumunda da 0 döner.** Yalnız çıkış koduna bakmak, hiçbir şey
  olmadığı hâlde `Success` yazdırıyordu. `spec.restartAt` artık **geri okunup** yazılan
  değerle karşılaştırılıyor; tutmuyorsa `Failed`.
* Başarısızlık nedenleri (oc'nin gerçek çıktısı) **stderr**'e yazılıp ayrı bir debug
  görevinde gösteriliyor. stdout'a yazılamazdı — o doğrudan
  `application_rollout.csv`'ye ekleniyor.
* Hiçbir tipte bulunamayan uygulamalar `main.yaml`'da rapora **ekleniyor**. Aksi hâlde
  istenen uygulama CSV'de hiç görünmez ve Teams kartında sessizce kaybolurdu.

## Ne yapılacak

Hepsi `gar_bmt_ansible_scripts` deposunda, `bmw_portal/` altında. **Sadece kopyalama var,
silinecek dosya yok.**

| Buradaki dosya | Hedef | Durum |
|---|---|---|
| `opsx_openshift_application_rollout/operations/tasks/detect.yaml` | aynı yol | **yeni** |
| `opsx_openshift_application_rollout/operations/tasks/main.yaml` | aynı yol | üzerine yaz |
| `opsx_openshift_application_rollout/operations/tasks/deployment.yaml` | aynı yol | üzerine yaz |
| `opsx_openshift_application_rollout/operations/tasks/rollout.yaml` | aynı yol | üzerine yaz |
| `opsx_openshift_application_rollout/operations/tasks/deploymentconfig.yaml` | aynı yol | üzerine yaz |
| `tests/check_rollout_dispatch.py` | `bmw_portal/tests/` | **yeni** |

**`prepare.yaml`'a dokunulmadı** — bu pakette yok, hedefte olduğu gibi kalmalı.

Sonra **AWX project sync** → karışık tipli bir partiyle deneyin (bir Deployment + bir
Argo Rollout aynı koşuda). Eskiden Argo olan "Not Exist,Failed" derdi.

## Doğrulama

```bash
python bmw_portal/tests/check_rollout_dispatch.py
```

Test dört katmanı ayrı ayrı doğrular: `detect.yaml`'ın kabuk bloğunu **sahte bir `oc` ile
gerçekten çalıştırır**, `set_fact` ayrıştırmasını Jinja ile kontrol eder, her tip
dosyasının kendi listesini işlediğini gösterir, ve "patch'i sessizce yutan oc"
senaryosunda `Success` yazılmadığını kanıtlar. `bash` gerektirir (Git Bash olur).

## Değişmeyenler

`target_cluster` desteği, Teams kartı, cluster'lar arası birleştirme, CSV formatı,
`prepare.yaml` ve non-ARK davranışı — hepsi aynı.
