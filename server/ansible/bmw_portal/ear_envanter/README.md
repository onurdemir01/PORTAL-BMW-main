# EAR Envanter — Basit Kullanım Kılavuzu

## 1. Ne işe yarar?

Bu Ansible playbook'u Linux sunuculardaki `/vhosting` ve `/vhosting8` klasörlerinde EAR/WAR uygulamalarını tarar.

- EAR/WAR, JAR, CLASS, JSP ve XML dosyalarını listeler.
- Spring, Log4j, Jackson gibi kütüphanelerin sürümlerini tespit eder.
- `OZET` hızlı tarama yapar; `TAM` ayrıntılı dosya ağacını da toplar.
- **Salt okunurdur:** Uygulamaları değiştirmez veya silmez.
- Taramayı hedef sunucuda `dzdo -u was` ile yapar.

## 2. AWX bilgileri

| Ayar | Değer |
|---|---|
| AWX | `https://maestro2` |
| Project | `ANSIBLE_6203` — ID `252` |
| Inventory | `Linux 6203 - Dynamic Inventory` — ID `125` |
| Job Template | `BMW Portal - EAR Envanter` — ID `2376` |
| Credential | `application_was_credentials` — ID `21` |
| Playbook | `bmw_portal/ear_envanter/ear_envanter.yml` |
| Forks | `30` |
| Timeout | `3600` saniye |

**Şablon zaten oluşturuldu ve credential bağlandı. Yeniden oluşturman gerekmez.**

AWX şablonu: https://maestro2/#/templates/job_template/2376/details

## 3. Gerekli dosyalar

Git projesinin `master` dalında şu iki dosya bulunmalı:

```text
bmw_portal/ear_envanter/ear_envanter.yml
bmw_portal/ear_envanter/files/ear_tara.py
```

Dosyaları Git'e gönderdikten sonra AWX'te **Projects > ANSIBLE_6203 > Sync** yap. Bilgisayarındaki yerel dosyalar tek başına yeterli değildir.

## 4. En kolay test: AWX ekranından

1. AWX'te **Templates > BMW Portal - EAR Envanter** şablonunu aç.
2. **Launch** seç.
3. **Variables** alanına şunu yaz (sunucu adını değiştir):

```yaml
hedefler: [SUNUCU_ADI]
ear_kip: OZET
ear_kosu_no: 999999
ear_parti_no: 1
```

4. İşi başlat ve **Jobs** ekranından sonucu kontrol et.

> `hedefler` bir listedir: Köşeli parantezleri silme. Hedef sunucu Inventory 125'te bulunmalıdır.

## 5. İstersen PowerShell ile test et

Komutlar **PowerShell** içindir, CMD komutu değildir. AWX token'ını ekrana veya dosyaya açık olarak yazma.

### Bağlan

```powershell
$AWX = "https://maestro2/api/v2"
$TOKEN = Read-Host "AWX Token"
```

### Test dosyasını oluştur

```powershell
notepad deneme.json
```

Dosyanın içine yapıştır ve `SUNUCU_ADI` kısmını değiştir:

```json
{
  "extra_vars": {
    "hedefler": ["SUNUCU_ADI"],
    "ear_kip": "OZET",
    "ear_kosu_no": 999999,
    "ear_parti_no": 1
  }
}
```

PowerShell'de BOM hatasını önlemek için (bu JSON yalnızca ASCII karakterleri içermeli):

```powershell
Get-Content .\deneme.json | Set-Content .\deneme-temiz.json -Encoding Ascii
```

### Taramayı başlat

```powershell
curl.exe -sS -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data-binary "@deneme-temiz.json" "$AWX/job_templates/2376/launch/"
```

Gelen yanıttaki `job` numarasını AWX **Jobs** ekranında aç.

İşin durumunu komutla görmek istersen `JOB_ID`'yi değiştir:

```powershell
curl.exe -sS -H "Authorization: Bearer $TOKEN" "$AWX/jobs/JOB_ID/" | ConvertFrom-Json | Select-Object id,status,failed
```

İş bitince token değişkenini temizle:

```powershell
Remove-Variable TOKEN
```

## 6. Sonuçlar nerede?

Çıktılar GBLABT02 üzerinde tutulur:

```text
/sw/BMW_PORTAL/ear_envanter/kosu-999999/raw/SUNUCU_ADI.out
```

Portal üzerinden başlatılan normal taramalarda `999999` yerine gerçek koşu numarası kullanılır. Çıktı `.out` dosyası sıkıştırılmış/veri kodlanmış içeriktir; düz metin rapor değildir.

## 7. Sık görülen hatalar

| Hata | Kontrol et |
|---|---|
| `Playbook not found` | Dosyalar Git'te mi? Project Sync yapıldı mı? |
| `UNREACHABLE` / `ULASILAMADI` | Sunucu Inventory 125'te mi, SSH erişimi var mı? |
| `KIMLIK_GECISI_YOK` | Credential ile `dzdo -u was` yetkisi var mı? |
| `PYTHON_YOK` | Sunucuda Python 3 var mı? |
| `Prompt on launch` hatası | Şablonda Variables > Prompt on launch açık mı? |
| `JSON parse error ... BOM` | JSON'u UTF-8 BOM olmadan kaydet. |

## 8. Portal bağlantısı

Portal yönetiminde **Admin > Playbook Kayıtları > `server_hub_ear_envanter`** kaydına Template ID olarak **`2376`** gir.

Ardından **Server Hub > Uygulama Envanteri > Şimdi tara** üzerinden tarama başlatılabilir.

**Not:** AWX şablonuna Survey veya AWX Schedule ekleme. Variables > Prompt on launch açık, Privilege Escalation kapalı olmalı. Otomatik haftalık tarama gerekiyorsa Portal'ın kendi ayarlarından açılır.
