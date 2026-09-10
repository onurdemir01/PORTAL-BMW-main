# API Generator (`api_generator`)

Nginx API gateway sunucularında **API tanımı oluşturma, okuma, silme, aktif/pasif etme ve
rate limit değiştirme** işlerini yapar.

| | |
|---|---|
| Playbook | `bmw_nginx/api_generator/api_generator.yaml` |
| Rol | `operations` (akış seçimi: `operations/tasks/main.yaml`) |
| Ortamlar | dev / test / qa / prod |
| Teams bildirimi | Her işlem sonunda gönderilir (`operations/tasks/teams_notify.yaml`) |

Konfigürasyon dosyaları `channel` ve `api` alanlarından türetilir:

```
/usr/nginx/conf.d/<channel>-<ENV>.conf
/usr/nginx/conf.d/<channel>-<ENV>-apis/<api>.conf
```

---

## 1. Hangi sunucuda çalışır?

| Ortam | Sunucular |
|---|---|
| dev | `GBNGWD01`, `GBNGWD02` |
| test | `GBNGWT03`, `GBNGWT04` |
| qa | `GBNGWQ01`, `GBNGWQ02` |
| prod | **36 sunucu** — 24 Pendik + 12 Ankara |

Production dağılımı:

| Lokasyon | Önek | Sunucular |
|---|---|---|
| Pendik | `GBNGWP` | `GBNGWP01`–`GBNGWP16`, `GBNGWP25`–`GBNGWP32` |
| Ankara | `GBNGWAP` | `GBNGWAP01`–`GBNGWAP08`, `GBNGWAP22`–`GBNGWAP25` |

`channel` **sunucu seçmez** — yalnızca hangi konfigürasyon dosyasına dokunulacağını
belirler. Lokasyon kısıtı için `site` alanı kullanılır (§3).

---

## 2. Survey alanları

| Değişken | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `op_selection` | Multiple Choice | Evet | İşlem — bkz. §4 |
| `env` | Multiple Choice | Evet | `dev` / `test` / `qa` / `prod` |
| `channel` | Text | Evet | Kanal adı; vhost dosyasını belirler |
| `api` | Text | Evet | API adı; `<channel>-<ENV>-apis/<api>.conf` |
| `site` | Multiple Choice | Hayır | `all` / `pendik` / `ankara` — **varsayılan `all`** |
| `limit_type` | Multiple Choice | Hayır | `ip` / `location` / `both` — **varsayılan `ip`** |
| `new_limit_req_zone_rate` | Text | rate_limit_change | Yeni IP bazlı limit |
| `new_location_limit_rate` | Text | rate_limit_change | Yeni location bazlı limit |
| `requester_name` | Text | Hayır | Teams bildiriminde etiketlenecek isim |
| `requester_email` | Text | Hayır | Etiketleme için e-posta |

`requester_name` ve `requester_email` **birlikte** dolu olmalıdır. Teams, mention
etiketiyle gövde metni uyuşmazsa isteği 400 ile reddeder; bu yüzden ikisinden biri
eksikse etiket hiç eklenmez, bildirim yine gider.

---

## 3. `site` — Pendik / Ankara ayrımı (yalnızca production)

Varsayılan **her zaman `all`**. Alan survey'de hiç tanımlı olmasa veya boş gelse bile
36 sunucunun tamamında çalışır — yani mevcut çağrılar etkilenmez.

| `site` | Çalışacağı sunucular |
|---|---|
| boş / `all` / `hepsi` / `tumu` / `tümü` | 36 sunucunun tamamı |
| `pendik` | `GBNGWP*` (24 sunucu) |
| `ankara` | `GBNGWAP*` (12 sunucu) |

Teams bildirimi hangi sunucuların etkilendiğini listeler.

---

## 4. İşlemler (`op_selection`)

| Değer | Ne yapar |
|---|---|
| `create` | Yeni API tanımı oluşturur (`<channel>-<ENV>-apis/<api>.conf`) |
| `read` | Mevcut tanımı okur, değişiklik yapmaz |
| `delete` | Tanımı kaldırır |
| `activate` | Pasif tanımı aktif eder |
| `deactivate` | Tanımı pasife alır |
| `rate_limit_change` | Rate limit değerlerini değiştirir — bkz. §5 |

---

## 5. `rate_limit_change` — IP ve location bazlı limit

`limit_type` ile hangi limitin değişeceği seçilir:

| `limit_type` | Değişen | Gereken alan |
|---|---|---|
| `ip` (varsayılan) | IP bazlı `limit_req_zone` | `new_limit_req_zone_rate` |
| `location` | Location bazlı limit | `new_location_limit_rate` |
| `both` | İkisi birden | her ikisi |

Zone adları konfigürasyondan **okunarak** bulunur (`zone=` ifadesi doğrudan çıkarılır),
elle tahmin edilmez. Bir API'de istenen tipte zone tanımı yoksa iş sessizce başarılı
sayılmaz: o zone `rl_missing_zones` listesine düşer ve bildirimde ayrıca raporlanır.

Bildirimde değişiklik **öncesi ve sonrası** değerler birlikte gösterilir.

> **Not — bozulmuş bir desen:** zone tespitinde `uniq` kullanılmamalıdır. `uniq` yalnızca
> **bitişik** tekrarları siler; sıralanmamış çıktıda tekrarlar kalır ve ardından gelen
> `lineinfile`, regexp eşleşmediği için dosyanın **sonuna satır ekler**. Bu, konfigürasyonu
> bozar. Bu yüzden akış `replace` kullanır — `replace` asla ekleme yapmaz.

---

## 6. Bilinen eksikler

* `operations/tasks/main.yaml`, `op_selection` değeri `open_nginx` veya `close_nginx`
  olduğunda `open_nginx.yaml` / `close_nginx.yaml` dosyalarını çağırıyor —
  **bu dosyalar depoda yok.** Bu iki seçenek survey'e eklenmemelidir.
* `delete` akışı `_location_limit` tanımını kaldırmıyor.
* `create.yaml` içindeki bir geri alma dalında yanlış dosya soneki kullanılıyor.
* `activate` / `deactivate` akışlarında `nginx_reload.rc` tanımsız kalabiliyor.
* Rate limit değerinin biçimi `create` ile `rate_limit_change` arasında tutarsız.
