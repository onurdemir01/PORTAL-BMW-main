# Configuration Delivery (`configuration_delivery`)

nginx kurulum dosyalarını (`bmw_defaults.conf`, `proxy_settings.conf`, `rate_limits.conf`,
`log_format.conf`, `gt-error-page.html`, `nginx.conf`) seçilen sunuculara **seçimli** dağıtır.
Kaynak `files/` altındaki kopyalardır; `nginx_installation` referansıyla aynı tutulmalıdır
(Denetim > Nginx Audit "Dosya farkı" bunu ölçer).

| | |
|---|---|
| Playbook | `bmw_nginx/configuration_delivery/configuration_delivery.yaml` |
| Kabuk | `files/fix_permissions.sh`, `files/nginx_test_or_reload.sh` |
| Portal | Self Servis > Otomasyon > *Nginx - Configuration Delivery* (aşağıda kurulum) |

## 1. Girdiler

| Değişken | Tip | Açıklama |
|---|---|---|
| `files` | liste **veya** virgül/satır ayrımlı dizge | Üzerine yazılacak dosyalar. Geçerli adlar: `bmw_defaults.conf`, `proxy_settings.conf`, `rate_limits.conf`, `log_format.conf`, `gt-error-page.html`, `nginx.conf` |
| `target_hosts` | liste veya virgüllü | Hedef sunucular (`hosts:` buradan; yoksa `all` + AWX limit) |
| `dry_run` | bool, varsayılan `false` | `true`: yalnız **fark** gösterir (check mode + diff), hiçbir şey yazmaz, reload yok |
| `fix_permissions` | bool, varsayılan `true` | sahiplik/izin düzeni; `dhparam.pem` **yoksa** üretilir (eskiden her koşuda yeniden üretiliyordu) |
| `version` | `Plus` / `Opensource`, opsiyonel | `nginx.conf` kaynağı (`nginx_plus.conf` / `nginx_opensource.conf`). Verilmezse sunucudan `nginx -v` ile **otomatik** |

Eskiden hangi dosyanın gideceği playbook'ta satır yorumlayarak seçiliyordu; artık `files` ile.

## 2. Akış

1. `files` normalize edilir, bilinmeyen ad varsa iş **başlamadan** durur.
2. Seçilen dosyalar `backup: yes` ile kopyalanır (`dry_run` ise yalnız fark).
3. `fix_permissions` → `files/fix_permissions.sh`.
4. `nginx -t` (plus/OSS ayrımı `files/nginx_test_or_reload.sh`); düşerse **tüm** dosyalar
   yedekten geri alınır, host FAIL. Geçerse **yalnız bir şey değiştiyse** reload.

## 3. Portal'da kurulum (bir kez, Admin)

Self Servis'te bu template için **Alan Ayarları**: AWX survey kapalıysa Survey Tasarımcısı:

| Alan | Tip | Ayar |
|---|---|---|
| `files` | **Çoklu Seçim (onay kutuları)** | seçenekler: yukarıdaki 6 dosya adı; zorunlu |
| `target_hosts` | Çoklu Seçim | Seçenek kaynağı: **Nginx sunucuları (Nginx Envanteri)**; zorunlu |
| `dry_run` | Tekli Seçim `true`/`false` | varsayılan `false` |
| `fix_permissions` | Tekli Seçim | varsayılan `true` (ya da gizli) |

Portal çoklu seçimi AWX'e **liste** olarak gönderir; playbook liste ve dizgeyi aynı işler.
Kullanıcı dosyaları ve sunucuları tikleyerek seçer; önce `dry_run=true` ile farkı görmesi
önerilir.

## 4. Elle (AWX) kullanım

```
-e '{"files": ["bmw_defaults.conf","log_format.conf"], "target_hosts": "GBNGXT33,GBNGXT34", "dry_run": true}'
```

Test: `python bmw_nginx/tests/check_configuration_delivery.py`
