# EAR Envanter — Basit Kullanım Kılavuzu

## 1. Ne işe yarar?

Bu Ansible playbook'u Linux sunuculardaki `/vhosting` ve `/vhosting8` klasörlerinde EAR/WAR uygulamalarını tarar.

- EAR/WAR, JAR, CLASS, JSP ve XML dosyalarını listeler.
- Spring, Log4j, Jackson gibi kütüphanelerin sürümlerini tespit eder.
- `OZET` hızlı tarama yapar; `TAM` ayrıntılı dosya ağacını da toplar.
- **Salt okunurdur:** Uygulamaları değiştirmez veya silmez.
- Taramayı hedef sunucuda `dzdo -u was` ile yapar.
- JBoss `domain.xml` ve `host.xml` dosyalarını okur (yalnız okuma). Her EAR'ın hangi JVM'e bağlı olduğunu ve o JVM'in auto-start ayarını çıkarır.
  - Bakılan yollar: `/usr/jboss/AppServer`, `/usr/jboss8/AppServer` ve bunların altındaki `jboss/` dizini.
  - Yalnız deployment, server-group ve JVM adları ile auto-start alınır. Parola, datasource gibi değerler alınmaz.
  - 5 MB'tan büyük ya da `DOCTYPE`/`ENTITY` içeren dosya okunmaz.
  - Okunamayan dosya "JVM yok" sayılmaz; Portal'da "okunamadı" ve nedeni görünür.
- `/vhosting` ve `/vhosting8` altında `.ear` ile bitmeyen girdileri de listeler (`APP.ear.bak`, `ESKI.war`, eski klasörler gibi). Bunlar retire şüphesi olarak değerlendirilir.

İki şekilde başlatılır:

| Kim başlatır | Sunucular nereden gelir | Sonuç |
|---|---|---|
| Portal (**Şimdi tara** ya da haftalık tarama) | Portal gönderir (`hedefler`) | Portal'da görünür |
| Sen, AWX ekranından | AWX'in **Limit** alanına yazdıkların | Birkaç dakika içinde Portal'da da görünür |

## 2. AWX bilgileri

Gerçek adlar ve ID'ler bu public repoda tutulmaz; yer tutucuların yerine kendi değerlerini koy.

| Ayar | Değer |
|---|---|
| AWX | `https://<AWX_ADRESI>` |
| Project | `<PROJE_ADI>` — ID `<PROJE_ID>` |
| Inventory | `<ENVANTER_ADI>` — ID `<ENVANTER_ID>` |
| Job Template | `BMW Portal - EAR Envanter` — ID `<TEMPLATE_ID>` |
| Credential | `<CREDENTIAL_ADI>` (dzdo ile `was`'a geçebilen) |
| Playbook | `bmw_portal/ear_envanter/ear_envanter.yml` |
| Variables | Boş; **Prompt on launch açık** |
| Limit | **Boş**; **Prompt on launch açık** |
| Forks | `30` |
| Timeout | `3600` saniye |
| Privilege Escalation | Kapalı |

**Şablonun Limit alanını boş bırak.** Limit'e şablonda kalıcı bir değer (`all` bile) yazılırsa Portal'ın başlattığı taramalar hiçbir sunucuyu taramadan biter. Portal bu yüzden Limit'i dolu şablonla taramayı başlatmaz ve uyarır. Sunucuları her seferinde **Launch** ekranında yaz.

## 3. Gerekli dosyalar

Git projesinin `master` dalında şu iki dosya bulunmalı:

```text
bmw_portal/ear_envanter/ear_envanter.yml
bmw_portal/ear_envanter/files/ear_tara.py
```

Dosyaları Git'e gönderdikten sonra AWX'te **Projects > `<PROJE_ADI>` > Sync** yap. Bilgisayarındaki yerel dosyalar tek başına yeterli değildir.

> `ear_tara.py` değiştiğinde (örneğin JBoss yapılandırma okuması eklendiğinde) yalnız bu dosyayı kopyalayıp **Sync** yapman yeter. Playbook değişmediyse onu yeniden kopyalaman gerekmez.

## 4. En kolay test: AWX ekranından

1. AWX'te **Templates > BMW Portal - EAR Envanter** şablonunu aç.
2. **Launch** seç.
3. **Limit** alanına taranacak sunucuları virgülle yaz: `SUNUCU1,SUNUCU2`
4. **Variables** alanına bir şey yazma. Ayrıntılı tarama istersen yalnız şunu yaz:

```yaml
ear_kip: TAM
```

5. İşi başlat ve **Jobs** ekranından sonucu kontrol et.

> Sunucu adı envanterde göründüğü gibi yazılmalı. **Limit boşsa iş "Sunucu secilmedi" diyerek durur**; tüm envanter taranmaz.
>
> İş bittikten birkaç dakika sonra Portal'da **Server Hub > Uygulama Envanteri > Koşular** listesinde **AWX (Limit)** kaynağıyla görünür.

## 5. İstersen PowerShell ile test et

Komutlar **PowerShell** içindir, CMD komutu değildir. AWX token'ını ekrana veya dosyaya açık olarak yazma.

### Bağlan

```powershell
$AWX = "https://<AWX_ADRESI>/api/v2"
$TOKEN = Read-Host "AWX Token"
```

AAP 2.5 kullanılıyorsa adres `https://<AWX_ADRESI>/api/controller/v2` olur.

### Test dosyasını oluştur

```powershell
notepad deneme.json
```

Dosyanın içine yapıştır ve `SUNUCU_ADI` kısmını değiştir:

```json
{
  "limit": "SUNUCU_ADI",
  "extra_vars": {
    "ear_kip": "OZET"
  }
}
```

PowerShell'de BOM hatasını önlemek için (bu JSON yalnızca ASCII karakterleri içermeli):

```powershell
Get-Content .\deneme.json | Set-Content .\deneme-temiz.json -Encoding Ascii
```

### Taramayı başlat

```powershell
curl.exe -sS -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data-binary "@deneme-temiz.json" "$AWX/job_templates/<TEMPLATE_ID>/launch/"
```

Gelen yanıttaki `job` numarasını AWX **Jobs** ekranında aç. Yanıttaki `ignored_fields` içinde `limit` görünüyorsa şablonda Limit › Prompt on launch kapalıdır.

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
Portal'ın başlattığı tarama:  /sw/BMW_PORTAL/ear_envanter/kosu-<KOSU_NO>/raw/SUNUCU_ADI.out
AWX'ten Limit ile başlatılan: /sw/BMW_PORTAL/ear_envanter/awx-<AWX_IS_NO>/raw/SUNUCU_ADI.out
```

Dosya adı sunucunun kısa adıdır, büyük harfle (`sunucu1.alan.adi` → `SUNUCU1.out`). Çıktı `.out` dosyası sıkıştırılmış/veri kodlanmış içeriktir; düz metin rapor değildir. Okunur hali Portal'dadır.

## 7. Sık görülen hatalar

| Hata | Kontrol et |
|---|---|
| `Sunucu secilmedi: AWX'te Limit alanina ...` | Launch ekranında Limit'e sunucu yaz. |
| Portal: `AWX şablonunun ... Limit alanı dolu` | Şablonun Limit alanını boşalt; sunucuyu Launch ekranında yaz. |
| `Playbook not found` | Dosyalar Git'te mi? Project Sync yapıldı mı? |
| `UNREACHABLE` / `ULASILAMADI` | Sunucu envanterde mi, SSH erişimi var mı? |
| `KIMLIK_GECISI_YOK` | Credential ile `dzdo -u was` yetkisi var mı? |
| `PYTHON_YOK` | Sunucuda Python 3 var mı? |
| `Prompt on launch` hatası | Şablonda Variables > Prompt on launch açık mı? |
| `JSON parse error ... BOM` | JSON'u UTF-8 BOM olmadan kaydet. |

## 8. Portal bağlantısı

Portal yönetiminde **Admin > Playbook Kayıtları > `server_hub_ear_envanter`** kaydına Template ID olarak `<TEMPLATE_ID>` gir.

Ardından **Server Hub > Uygulama Envanteri > Şimdi tara** üzerinden tarama başlatılabilir.

**Not:** AWX şablonuna Survey veya AWX Schedule ekleme. Variables ve Limit > Prompt on launch açık, Limit alanı boş, Privilege Escalation kapalı olmalı. Otomatik haftalık tarama gerekiyorsa Portal'ın kendi ayarlarından açılır.
