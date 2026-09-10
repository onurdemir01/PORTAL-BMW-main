# API'yi İnternete Aç (`api_expose`)

Test ortamındaki bir API tanımını, internete açık sunucuya (**GBNGXT07**) **birebir**
kopyalar. Portal → *Nginx API Envanteri* ekranındaki **"API'yi internete aç"** butonu
bu playbook'u tetikler.

| | |
|---|---|
| Playbook | `bmw_nginx/api_expose/api_expose.yml` |
| Ortam | **yalnızca `test`** — başka ortam açıkça reddedilir |
| Kaynak | API'nin hâlihazırda tanımlı olduğu test sunucusu (ör. `GBNGWT03`) |
| Hedef | `GBNGXT07` (`target_host` ile değiştirilebilir) |

## Neden kopyalama, yeniden üretme değil

`api_generator/create.yaml` konfigürasyon bloğunu **dışarıdan** alır (`location_append`,
base64). O blok hiçbir envanterde saklanmıyor — yalnızca kaynak sunucudaki dosyanın
kendisinde var. Parametrelerden yeniden üretmeye çalışmak, kaynaktakinden **farklı** bir
tanım üretme riski taşırdı. Bu yüzden dosya olduğu gibi okunup taşınıyor.

Aynı mantıkla limit zone satırları da tahmin edilmiyor: `limit-zones.conf`'tan bu API'ye
ait **gerçek satırlar** çekilip hedefe yazılıyor.

## Girdiler (AWX survey / extra_vars)

| Değişken | Zorunlu | Örnek |
|---|---|---|
| `channel` | Evet | `mobile` |
| `env` | Evet | `test` (başka değer reddedilir) |
| `api` | Evet | conf dosyasının adı (`.conf` hariç) |
| `source_host` | Evet | `GBNGWT03` |
| `target_host` | Hayır | varsayılan `GBNGXT07` |

## Güvenlik kontrolleri

1. **`env` yalnızca `test`** olabilir — production'a bu yolla dokunulamaz.
2. **Kaynak tanım gerçekten var mı** — yoksa durur (envanter kaydı bayat olabilir).
3. **Hedefte include var mı** — hiçbir vhost `<channel>-<env>-apis/*.conf` dizinini
   include etmiyorsa **durur**. Bu kontrol olmasaydı dosya yazılır, nginx onu hiç
   yüklemez ve iş *"başarılı"* görünürken API internete **açılmamış** olurdu.
4. Mevcut tanım **yedeklenir**, sonra üzerine yazılır.
5. `nginx -t` başarısızsa: yeni dosya kaldırılır (öncesinde yoktu) veya yedek geri
   yüklenir (öncesinde vardı), tekrar test edilir ve iş **açık hata** ile biter.
6. Yalnız test geçerse `nginx -s reload`.

## Kurulum

1. `GBNGXT07` **envanterde mevcut** — `bmw_openshift_jobs/truststore_inventory`
   doğrudan `hosts: GBNGXT07` ile hedefliyor, yani AWX bu adı çözebiliyor. (Bu playbook
   hedefi `target_host` ile doğrudan verdiği için `nginx_ops`/`api_generator`'ın sabit
   host listelerinde bulunmasına da gerek yok.)
2. Hedef sunucuda `<channel>-<env>` vhost'u ve `include .../<channel>-<env>-apis/*.conf`
   satırı bulunmalı — yoksa playbook 3. maddedeki kontrolle durur.
3. AWX'te bu playbook için bir job template açılıp survey'e yukarıdaki alanlar eklenmeli.
4. Portal Admin → template kimliği ayarlanmalı (Portal butonu onu tetikliyor).
