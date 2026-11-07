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
- **Deployment kontrolü (Faz 2, isteğe bağlı, varsayılan KAPALI):** çalışan her JVM için JBoss CLI ile yalnız okuma komutu çalıştırır:
  `read-children-resources(child-type=deployment,include-runtime=true,recursive=false)`.
  - JBoss 7: `jboss-cli.sh`, `--controller=$HOSTNAME`, `host=master`. JBoss 8: `jboss-cli8.sh`, `--controller=$HOSTNAME:9998`, `host=primary`.
  - Çalışan JVM'ler `ps`'teki `-D[Server:<ad>]` süreçlerinden bulunur. CLI çağrısı başına 15 sn, sunucu başına toplam 180 sn sınırı vardır.
  - Sonuç Server Hub'da “deployment yok”, “FAILED”, “devre dışı” bulguları ve “deployment adı diskteki EAR'la uyuşmuyor” etiketi olarak görünür.
  - Her çalışan JVM için bir CLI (Java) süreci başlatır. Önce tek sunucuda pilot yapın.
  - Portal'dan açmak için: **Uygulama Envanteri › Ayarlar › Deployment kontrolü = ACIK**. AWX'ten elle: Variables alanına `ear_deployment_kontrol: true`.
- **Web kontrolü (Faz W, isteğe bağlı, varsayılan KAPALI):** Apache / IHS web katmanını yalnız okuyarak çıkarır:
  - **Config ağacı:**
    - `Include`, `VirtualHost`, `ServerName` / `ServerAlias`, `Listen`;
    - `ProxyPass` / balancer üyeleri, `RewriteRule [P]`;
    - `JkMount` + `workers.properties`;
    - mod_cluster yönergeleri;
    - WebSphere eklentisi (`plugin-cfg.xml`).
  - **Config hataları:** eksik `Include`, döngü.
  - **Soket ve IP:** dinlenen soketler (`/proc/net/tcp`), sunucunun IP'leri (`ip -o addr show`).
  - **Log özeti:** access log'dan son 7 günün gerçek / sağlık kontrolü (`hc.html`, `hc.jsp`) / statik istek sayıları; error log'dan arka uca bağlanamama sayıları.
  - **Yapmadıkları:**
    - `httpd` / `apachectl` çalıştırılmaz;
    - çalışan web sunucusuna istek atılmaz;
    - SSL anahtarı okunmaz, sertifika dosyasının yalnız varlığına bakılır;
    - sorgu dizesi ve URL'nin tamamı alınmaz.
  - **Sınırlar:** Log okuma sunucu başına 256 MB ve 240 sn ile sınırlı. Sınıra takılan ya da 7 günden kısa log "kısmi" görünür; hiçbir zaman "istek yok" sayılmaz.
  - **Kimlik:** Config ve log dosyaları okuma kimliğiyle (varsayılan `was`) okunur. Okunamayan dosya "okunamadı" görünür. IHS / Apache logları `root`'a aitse, **Web okuma kimliği** ayarına okuyabilen kullanıcıyı yazın (dzdo kuralı gerekir).
  - **Açmak:**
    - Portal'dan: **Uygulama Envanteri › Ayarlar › Web kontrolü = ACIK**. Kapsamda **Web sunucuları** (3-tier web sunucuları JBoss envanterinde yoktur) ya da **Filo + web** seçilebilir.
    - AWX'ten elle: Variables alanına `ear_web_kontrol: true`.

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

Git projesinin `master` dalında şu dosyalar bulunmalı:

```text
bmw_portal/ear_envanter/ear_envanter.yml
bmw_portal/ear_envanter/files/ear_tara.py
bmw_portal/ear_envanter/files/deployment_oku.sh
bmw_portal/ear_envanter/files/web_tara.py
```

Dosyaları Git'e gönderdikten sonra AWX'te **Projects > `<PROJE_ADI>` > Sync** yap. Bilgisayarındaki yerel dosyalar tek başına yeterli değildir.

> `ear_tara.py` değiştiğinde (örneğin JBoss yapılandırma okuması eklendiğinde) yalnız bu dosyayı kopyalayıp **Sync** yapman yeter. Playbook değişmediyse onu yeniden kopyalaman gerekmez.

> Faz 2 (deployment kontrolü) için üç dosya birlikte kopyalanmalı: `ear_envanter.yml`, `files/ear_tara.py` ve yeni `files/deployment_oku.sh`.

> Faz W (web kontrolü) için iki dosya birlikte kopyalanmalı: `ear_envanter.yml` ve yeni `files/web_tara.py`. Pilot: AWX'ten tek bir web sunucusunu Limit'e yazıp Variables alanına `ear_web_kontrol: true` ekle.

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
