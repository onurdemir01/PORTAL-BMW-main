# Ansible değişiklikleri — elden taşıma paketi

> **Bu klasör Portal'ın parçası değildir.** Ansible deposuna (`gar_bmt_ansible_scripts`)
> push yetkim olmadığı için 9–10 Eylül akşamı hazırlanan dosyalar buraya kondu.
> Uygulandıktan sonra klasör silinebilir.

## Nasıl uygulanır

Klasör yapısı Ansible deposuyla **birebir aynı**, o yüzden içeriği doğrudan depo köküne
kopyalamak yeterli:

```bash
cp -r transfer/bmw_nginx  transfer/bmw_portal  /yol/gar_bmt_ansible_scripts/
```

**Silinecek dosya yok.** Hepsi ya yeni ya da üzerine yazılacak.

Sonra **AWX project sync**.

## Doğrulama

```bash
cd /yol/gar_bmt_ansible_scripts
python bmw_portal/tests/check_rollout_dispatch.py
```

`bash` gerektirir (Git Bash olur). Sahte bir `oc` ile kabuk bloklarını gerçekten
çalıştırır — iddiayı metin üzerinden değil davranış üzerinden doğrular.

---

## 1. opsx rollout — tip tespiti uygulama başına

`bmw_portal/opsx_openshift_application_rollout/`

**Sorun:** `rollout.yaml`'daki `oc patch ... restartAt` komutu **doğruydu** — komuta
**sıra gelmiyordu**. `main.yaml` tipi tek sefer, tüm parti için tespit ediyordu ve tespit
döngüsü **ilk uygulamada `exit`** ediyordu. Karışık tipte bir partide:

```
uygulama-bir (Deployment)   -> Exist,Success
uygulama-iki (Argo Rollout) -> "Not Exist,Failed"    <-- restart hiç denenmedi
```

Ters yön de geçerliydi. Portal tek koşuda birden fazla `(namespace, application)` çifti
gönderdiği için hata pratikte tetikleniyordu; tek uygulamada veya tek tipli partide
görünmüyordu.

**Çözüm:** döngüde `exit` yerine `continue`. Yeni `detect.yaml` her uygulamayı ayrı
değerlendirip üç listeye ayırıyor; her tip dosyası **yalnız kendi listesini** işliyor.
Dosya-başına-tip düzeni **korundu** (sizin tercihiniz) — kardeş job ile hiza bozulmadı.

Ayrıca `rollout.yaml`'da: `oc patch` "unchanged" durumunda da 0 döndüğü için
`spec.restartAt` artık **geri okunup** yazılan değerle karşılaştırılıyor; tutmuyorsa
`Failed`. Hata nedenleri stderr'e yazılıyor (stdout doğrudan CSV'ye gidiyor, oraya
yazılamazdı).

| Dosya | Durum |
|---|---|
| `operations/tasks/detect.yaml` | **yeni** |
| `operations/tasks/main.yaml` | üzerine yaz |
| `operations/tasks/deployment.yaml` | üzerine yaz |
| `operations/tasks/rollout.yaml` | üzerine yaz |
| `operations/tasks/deploymentconfig.yaml` | üzerine yaz |
| `bmw_portal/tests/check_rollout_dispatch.py` | **yeni** |

`prepare.yaml`'a dokunulmadı — pakette yok, olduğu gibi kalmalı.

> **Not:** ara bir denemede üç tip dosyasını tek dosyada birleştirmiştim
> (`restart_all.yaml`); siz eski düzeni tercih edince geri alındı. O dosya size hiç
> ulaşmadığı için silinecek bir şey yok.

---

## 2. api_expose — test API'sini internete açık sunucuya kopyalar

`bmw_nginx/api_expose/` — **yeni playbook.** Portal'daki *Denetim → Nginx API Envanteri →
İnternete Açma* butonunun arkasındaki iş.

Dosyayı yeniden üretmiyor, kaynak sunucudan **birebir okuyup taşıyor**: `create.yaml`
konfigürasyon bloğunu dışarıdan alıyor (`location_append`, base64) ve o blok hiçbir
envanterde saklanmıyor — yalnızca dosyanın kendisinde var.

`channel` **sorulmuyor, keşfediliyor**: envanter sadece `basename` sakladığı için dizin
adı kayıtlı değil; playbook kaynak sunucuda arıyor ve birden fazla eşleşme bulursa açık
hata veriyor.

Güvenlik: yalnız `env=test`; kaynak tanım gerçekten var mı; **hedefte `include` var mı**
(yoksa durur — dosya yazılsa nginx onu hiç yüklemez ve API açılmış *görünüp* açılmamış
olurdu); yedek + `nginx -t` + başarısızsa geri alma.

Ayrıntı: `bmw_nginx/api_expose/README.md`

### Butonun çalışması için gerekenler

1. Hedef sunucuda `<channel>-test` vhost'u ve `include .../<channel>-test-apis/*.conf`
   satırı
2. `api_expose.yml` için bir **AWX job template**
3. Portal'da o template kimliğinin ayarlanması

GBNGXT07 zaten envanterde — `truststore_inventory` doğrudan hedefliyor.

---

## 3. api_generator/README.md — yol düzeltmesi

Konfigürasyon yolu `<channel>-apis/` yazıyordu; `create.yaml`'daki gerçek yol
`<channel>-<ENV>-apis/`. Üç yerde düzeltildi. Belge hatası, kod değişikliği yok.

---

## Kapsam

Bu paket yalnızca **9–10 Eylül akşamı** yapılan işi içerir. Ansible deposunda toplam
**59 bekleyen commit** var; öncekiler (nginx_ops host seçimi düzeltmesi, README'ler,
yorum kırpma, `nginx_config_audit` proxy desteği) bu pakette **yok** — onlar için
commit'leri taşımak gerekiyor.
