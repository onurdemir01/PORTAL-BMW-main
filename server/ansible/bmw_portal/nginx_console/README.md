# nginx_console — Portal › Nginx Hub (2026-09-19)

Tüm nginx sunucularının konfigürasyon ağacı, dosya içerikleri ve sertifikaları Portal'da; tek
dosya değişikliği Portal'dan push. Portal sunuculara **yalnız Ansible** ile ulaşır, nginx
dosyalarına **www** kullanıcısıyla (dzdo) dokunulur.

## İki job

| Job | Playbook | Ne yapar |
|---|---|---|
| `nginx_console_fetch` | `nginx_console_fetch.yml` | `target_hosts` listesindeki sunucularda `files/nginx_console_dump.sh` (salt okunur): `nginx -t`, `conf.d`+`conf` ağacı (boyut/mtime/sha256), 512 KB altı dosya içerikleri, `ssl_certificate` kullanımları ve `openssl x509` ayrıntıları. Çıktı **GBLABT02 üzerinden** `<console_dir>/raw/<HOST>.txt` (nginx sunucularında /sw yok). |
| `nginx_console_push` | `nginx_console_push.yml` | Tek sunucu, tek dosya (`create`/`update`): `files/nginx_console_push.sh` — yol beyaz listesi (`/usr/nginx/conf.d/`, `/usr/nginx/conf/`), SPA deployment kilidi (`/vhosting/HYSUXSCRIPTS/nginx_deploy_lock.sh` varsa), yedek `conf.d/.console_backup/`, yaz, `nginx -t` (düşerse **geri alır**), `nginx -s reload`; ardından dokum yenilenir. Sonuç `set_stats nginx_console_push_result`. |

Host seçimi `add_host` ile (AWX `limit` template'te prompt-on-launch açık değilse yok sayılır).
`target_hosts` **verilmezse** fetch job'ı tüm nginx filosunu envanterden keşfeder — `nginx_audit`
ve `nginx_metadata` ile aynı betik (`../../bmw_nginx/nginx_metadata/files/get_nginx_hosts.py`,
`dbo.Inventory.nginx_version` dolu olanlar), GBLABT02'de `was` ile. Bu yüzden bu klasör AWX'te
`bmw_nginx` ile aynı projede (gar_bmt_ansible_scripts) durmalı.

## Sık tarama ve süre — nasıl hızlı kalır

Kullanıcı gereksinimi: ekip sunucuda elle değişiklik yapabiliyor, Portal en az **30 dakikada bir** tüm
filoyu görmeli. Üç mekanizma:

1. **Parmak izi ile artımlı dokum** (`force_full` verilmezse): her sunucuda tek kısa komut —
   `conf.d`+`conf` ağacının (boyut, mtime, yol) sha256'sı, `/var/tmp/.nginx_console_fp`'deki son
   dokum iziyle karşılaştırılır; aynıysa dokum ve /sw kopyası **atlanır**. 311 sunucuda tipik koşu:
   1 SSH turu/sunucu + yalnız değişenlerde dokum. Portal'daki "Yenile" ise `force_full: true` gönderir.
2. **AWX Forks**: template'te Forks'u **50** yapın (varsayılan 5 → 311 sunucu 5'erli dalgalar; nginx_audit'in
   30-40 dakikasının asıl sebebi bu + gövde başına çok görev + DB yükleme).
3. **Publish sırasında sha kontrolü**: dokum eski olsa bile push betiği sunucudaki **anlık** sha'yı
   Portal'ın gördüğüyle karşılaştırır; arkadaşınız o dosyayı elle değiştirdiyse iş **durur** (rc 60),
   üzerine yazmaz. Çakışma koruması tarama sıklığından bağımsızdır.

Zamanlama önerisi: fetch template'ine `*/30` schedule, extra vars boş (tüm filo, artımlı).

## Süre

Sunucu başına birkaç saniye; **tüm filo 30–40 dk** (kullanıcı deneyimi, `nginx -T` taramalarıyla aynı).
Portal'daki "Yenile" yalnız seçili sunucuları gönderir; "Tüm filo" düğmesi ve gece zamanlaması
`target_hosts` göndermez → envanter keşfi. Zamanlamak için: fetch template'ine schedule, extra vars boş.

## Kurulum

1. AWX'te iki job template (bu playbook'lar, extra vars prompt-on-launch açık).
2. Admin › Playbook Kayıtları → `nginx_console_fetch` ve `nginx_console_push` satırlarına Template ID.
3. `console_dir` (`/sw/BMW_PORTAL/nginx_console`) GBLABT02'de var olmalı, `raw/` altı Portal tarafından okunur
   (`NGINX_CONSOLE_DIR` env ile değiştirilebilir).
4. Sayfa yalnız **Admin**; push ucu sunucu tarafında da Admin'e kapalı.

## Güvenlik notları

- Dokum betiği `.key`/`private` dosyalarını hiç okumaz; sertifika için yalnız var/yok.
- Push betiği `..`, sembolik bağ, `.console_backup/` ve beyaz liste dışını reddeder (rc 50).
- `expected_sha256`: Portal'ın gördüğü hal; dosya o arada değiştiyse rc 60 (force ile geçilir).
- Her push `ansible_job_history` + `portal_audit_logs` (`nginx_console`) + sunucuda `conf.d/.console_journal.log`.

## Çıkış kodları (push)

0 ok · 50 yol yasak · 51 içerik/mod · 59 kilit · 60 sha uyuşmazlığı · 61 create ama dosya var ·
62 `nginx -t` düştü (geri alındı) · 63 reload düştü (dosya yeni haliyle kaldı, -t temizdi).

## Konfigürasyon geçmişi (Git benzeri, 2026-09-19)

Ek job/SSH **yok**; dokumdaki sha256'lar kullanılır. Portal her yeni dokumu işlerken:
- dosya içeriklerini **içerik adresli** saklar: `<console_dir>/objects/<sha[0:2]>/<sha>` — aynı içerik
  filoda bir kez (20 sunucudaki aynı vhost = tek blob; ~20-40 MB + değişiklik başına birkaç KB),
- `nginx_hub_file_state` (host,path → son sha) ile karşılaştırıp **yalnız değişen** dosya için
  `nginx_hub_file_history`'ye bir satır yazar (kaynak: `first-seen` / `server` = sunucuda elle /
  `portal-publish` = kim, hangi job / `deleted`). Değişmeyen dosya için satır yok.
- Publish anında `pending=1` satır açılır; dokum aynı sha'yı görünce bağlanır → "Portal publish".
- Dump betiği ağaç satırına `stat %U` (dosya sahibi) ekler: elle değişikliklerde ipucu.

Ekran: dosya panelinde **Geçmiş** (sürümler, fark, şu ankiyle, "bu sürüme dön" → Publish),
üst sekmede **Değişiklikler** (filo geneli akış, kaynak/tarih filtresi, diff). Uçlar:
`GET /history/:host?path=`, `GET /changes`, `GET /blob/:sha`.
