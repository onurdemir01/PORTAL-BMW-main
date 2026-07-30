# LogX Ansible Log Fetch — Kurulum Kılavuzu

## Amaç

Portal'daki LogX sayfası, 1111 portu üzerinden erişilemeyen sunucularda Ansible AWX üzerinden log çekmek için bir fallback mekanizması içermektedir. Bu kılavuz AWX'te gerekli template'i nasıl oluşturacağınızı anlatmaktadır.

---

## Gereksinimler

- AWX/Tower erişimi + admin token
- `fetch_remote_logs.yml` playbook'unun AWX'e proje olarak eklenmesi
- Hedef sunuculara SSH erişimi olan bir AWX credential
- `.env.local` dosyasında aşağıdaki değişkenler:

```env
AWX_URL=https://maestro2
AWX_TOKEN=<AWX_admin_token_buraya>
AWX_LOG_FETCH_TEMPLATE_ID=<aşağıda oluşturacağınız template ID>
AWX_READ_ONLY_TEMPLATE_IDS=<template_id1>,<template_id2>,...
```

---

## Adım 1: Proje Oluşturma (AWX)

1. AWX → **Projects** → **Add**
2. Name: `BMW Portal Playbooks`
3. SCM Type: `Manual` (veya Git repo varsa Git)
4. Playbook Directory: `server/ansible/playbooks/` içindeki dosyaların bulunduğu dizin
5. **Save**

---

## Adım 2: Template Oluşturma

1. AWX → **Templates** → **Add** → **Job Template**
2. Aşağıdaki değerleri girin:

| Alan | Değer |
|------|-------|
| Name | `BMW Portal - Log Fetch` |
| Job Type | `Run` |
| Inventory | Sunucularınızı içeren inventory |
| Project | `BMW Portal Playbooks` |
| Playbook | `fetch_remote_logs.yml` |
| Credentials | SSH credential (hedef sunuculara erişim için) |
| Verbosity | `1 (Verbose)` |
| Extra Variables | (boş — portal tarafından gönderilecek) |
| ✅ Prompt on launch | **İşaretleyin** (extra vars için) |

3. **Save** → Template ID'yi not alın (URL'den: `/templates/job_template/123/`)

---

## Adım 3: Environment Değişkenlerini Ayarlayın

`.env.local` dosyasına ekleyin:

```env
AWX_LOG_FETCH_TEMPLATE_ID=123
AWX_READ_ONLY_TEMPLATE_IDS=123
```

Birden fazla template varsa virgülle ayırın:
```env
AWX_READ_ONLY_TEMPLATE_IDS=123,124,125
```

---

## Adım 4: Playbook Extra Variables

Template `fetch_remote_logs.yml` aşağıdaki değişkenleri kabul eder:

| Değişken | Açıklama | Örnek |
|----------|----------|-------|
| `target_host` | Hedef sunucu hostname veya IP | `10.10.10.50` |
| `log_file_path` | Log dosyasının tam yolu | `/opt/jboss/standalone/log/server.log` |
| `grep_pattern` | Grep için aranacak pattern (opsiyonel) | `ERROR\|WARN` |
| `lines` | Kaç satır alınacak (varsayılan 200) | `500` |

Portal bu değerleri otomatik olarak AWX'e gönderir.

---

## Adım 5: Test

AWX Job çalıştıktan sonra portal:
1. Job ID'yi alır
2. Her 2 saniyede bir job durumunu kontrol eder (max 60 saniye)
3. Job tamamlanınca çıktıyı LogX ekranında gösterir
4. Çıktıda `changed:` satırı görünürse **sarı uyarı** gösterilir (production-safe kontrolü)

---

## Yaygın Sorunlar

| Sorun | Çözüm |
|-------|-------|
| `AWX_LOG_FETCH_TEMPLATE_ID` ayarlanmamış | Yukarıdaki env değişkenini ekleyin |
| AWX bağlantısı yok | `AWX_URL` ve `AWX_TOKEN` kontrolü |
| SSH erişim hatası | AWX credential'ında doğru SSH key var mı? |
| Log dosyası bulunamadı | `log_file_path` değerini kontrol edin |
| `changed:` uyarısı | Playbook read-only olmayan bir değişiklik yaptı — playbook'u kontrol edin |

---

## Güvenlik Notları

- `fetch_remote_logs.yml` tamamen read-only'dir; hiçbir değişiklik yapmaz
- Tüm tasklar `changed_when: false` ile işaretlidir
- Template ID'leri `AWX_READ_ONLY_TEMPLATE_IDS` ile kısıtlanmıştır
- Sadece whitelist'teki host'lara erişim yapılır (LogX Inventory kontrolü)
- Log çıktısı AI'ya gönderilmeden önce PII maskeleme uygulanır
