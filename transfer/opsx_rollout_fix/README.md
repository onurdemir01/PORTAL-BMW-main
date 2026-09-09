# opsx rollout düzeltmesi — elden taşıma paketi

> **Bu klasör Portal'ın parçası değildir.** Ansible deposuna (`gar_bmt_ansible_scripts`)
> push yetkim olmadığı için değişiklik buraya, taşınmak üzere konuldu. Ansible deposuna
> uygulandıktan sonra bu klasör silinebilir.
>
> Kanonik commit: `be56d7aac` — *opsx rollout: tip tespiti UYGULAMA BASINA*

## Sorun

`bmw_portal/opsx_openshift_application_rollout` içinde `rollout.yaml`'daki
`oc patch ... restartAt` komutu **doğruydu** — komuta **sıra gelmiyordu**.

`main.yaml` tipi **tek sefer, tüm parti için** tespit ediyordu ve tespit döngüsü **ilk
uygulamada `exit`** ediyordu. İkinci ve sonraki uygulamalara hiç bakılmadan, çıkan tek
`rc` (0/44/55/66) bütün partiyi tek bir dala yönlendiriyordu:

```
uygulama-bir (Deployment)   -> Exist,Success
uygulama-iki (Argo Rollout) -> "Not Exist,Failed"    <-- restart hiç denenmedi
```

Ters yön de geçerliydi: parti bir Rollout ile başlarsa Deployment'lar "Not Exist" olurdu.

Portal tek koşuda birden fazla `(namespace, application)` çifti gönderiyor
(`server/opsx/index.cjs` → `cleanPairs.map(...).join(';')`), yani hata pratikte
tetikleniyordu. Tek uygulamada veya tek tipli partide sorun görünmüyordu — "bazen
çalışıyor" hissi bundan.

## Çözüm

Döngüde `exit` yerine **`continue`**. Her uygulama kendi tipine göre işlenir ve tam
olarak bir CSV satırı üretir (`restart_all.yaml`).

Ayrıca `restartAt` tarafında iki iyileştirme:

* `oc patch` **değişiklik olmasa da 0 döner** ("unchanged"). Yalnız çıkış koduna bakmak,
  hiçbir şey olmadığı hâlde `Success` yazdırıyordu. Alan artık **geri okunup** yazılan
  değerle karşılaştırılıyor; tutmuyorsa `Failed`.
* Başarısızlık nedenleri (oc'nin gerçek çıktısı, istenen/okunan damga) **stderr**'e
  yazılıp ayrı bir debug görevinde gösteriliyor. stdout'a yazılamazdı — o doğrudan
  `application_rollout.csv`'ye ekleniyor, raporu bozardı.

## Ne yapılacak

Hepsi `gar_bmt_ansible_scripts` deposunda, `bmw_portal/` altında.

**1. Kopyala** (üzerine yaz / yeni ekle)

| Buradaki dosya | Hedef |
|---|---|
| `opsx_openshift_application_rollout/operations/tasks/main.yaml` | aynı yol — **üzerine yaz** |
| `opsx_openshift_application_rollout/operations/tasks/restart_all.yaml` | aynı yol — **yeni dosya** |
| `tests/check_rollout_dispatch.py` | `bmw_portal/tests/` — **yeni dosya** |

**2. Sil** — bu üçü artık kullanılmıyor. Aynı restart+CSV mantığı üç kez kopyalanmıştı;
`restart_all.yaml` üçünün yerine geçiyor. Silinmezlerse zarar vermez, sadece ölü kod
olarak kalırlar:

```
bmw_portal/opsx_openshift_application_rollout/operations/tasks/deployment.yaml
bmw_portal/opsx_openshift_application_rollout/operations/tasks/rollout.yaml
bmw_portal/opsx_openshift_application_rollout/operations/tasks/deploymentconfig.yaml
```

**3. AWX project sync** → sonra karışık tipli bir parti ile deneyin (bir Deployment +
bir Argo Rollout aynı koşuda). Eskiden Argo olan "Not Exist,Failed" derdi.

## Doğrulama

```bash
python bmw_portal/tests/check_rollout_dispatch.py
```

Test, `restart_all.yaml` içindeki kabuk bloğunu dosyadan çıkarıp **sahte bir `oc` ile
gerçekten çalıştırır** — iddiayı metin üzerinden değil davranış üzerinden doğrular.
Karışık parti (Deployment + Argo Rollout + DC + hiçbiri) doğru işlenmeli; ayrıca
"patch'i sessizce yutan oc" senaryosuyla geri-okuma korumasının `Success` yazmadığı
kanıtlanır. `bash` gerektirir (Git Bash olur).

## Değişmeyenler

* `target_cluster` desteği (tek cluster kısıtlaması) **korundu**
* Teams kartı, cluster'lar arası birleştirme, CSV formatı **aynı**
* non-ARK davranışı **aynı**: tespit zaten önce `deployment`'a bakıyor; Argo CRD'si
  olmayan cluster'da `oc get rollouts` hata verip bir sonraki tipe geçiyor
