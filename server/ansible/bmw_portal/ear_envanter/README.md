# ear_envanter — Server Hub › Uygulama Envanteri (EAR/WAR)

`/vhosting` (JBoss 7) ve `/vhosting8` (JBoss 8) altındaki EAR/WAR uygulamalarını **salt okunur** tarar:
- teknoloji ve sürüm: Spring Boot, Spring Framework, Spring Security, log4j 1.x/2.x, logback, jackson, thymeleaf, struts, `jakarta` / `javax`
- sayılar: JSP/JSPX, TLD, JAR, CLASS; `tld` dizini var mı
- tanımlayıcılar: `web.xml`, `web.<ortam>.xml`, `jboss-web.xml`, `jboss-deployment-structure.xml`, `application.xml`
- her WAR'ın kütüphane listesi
- istenirse (TAM kip) `ls -lrtiR` benzeri dosya ağacı

Sonuç host başına tek dosya olarak GBLABT02 üzerinden `/sw`'ye yazılır. Portal aynı mount'u okuyup DB'ye alır.

## Hedefte ne çalışır

Tek `raw` görevi, `dzdo` ile `was` kimliğinde:

```sh
P=""; for c in python3 /usr/libexec/platform-python; do command -v "$c" >/dev/null 2>&1 && { P="$c"; break; }; done
[ -n "$P" ] || { echo "@@EAR_PYTHON_YOK@@"; exit 0; }
EAR_KIP=OZET EAR_KOKLER=/vhosting:/vhosting8 ... LC_ALL=C PYTHONIOENCODING=utf-8:surrogateescape "$P" -B - <<'EAR_TARA_SON'
<files/ear_tara.py, açık metin>
EAR_TARA_SON
```

- Hedefe dosya kopyalanmaz, Ansible modülü gönderilmez, bytecode yazılmaz (`-B`).
- Betik dosya içeriği okumaz. Tek istisna zip arşivlerinin (paketli `.war` / `.ear`) **merkez dizini**; o da salt okunur.
- Hiçbir şey yazmaz, silmez, izin değiştirmez.
- Uygulama içinde sembolik bağ izlenmez. Yalnız kökteki `APP.ear -> sürüm dizini` bağı tek adım izlenir ve kayda yazılır.
- `uid` / `gid` sayısaldır; NSS sorgusu yapılmaz.
- Python 3.6+ yeterli (RHEL 8 `platform-python` 3.6, RHEL 9 3.9).

> Not: Dizin okuması bazı dosya sistemlerinde erişim zamanını (atime) güncelleyebilir. İçerik, izin, boyut, mtime ve inode değişmez; test ağacında önce ve sonra karşılaştırmasıyla doğrulandı.

## Kipler

| Kip | Ne yapar | Ne zaman |
|---|---|---|
| `OZET` | Dosya başına `stat` yok (yalnız ad + tip); yalnız kütüphane jar'larının boyutu okunur | Hızlı filo keşfi |
| `TAM` | Her giriş için `lstat` + ağaç satırları; `.ear` arşivinin içindeki WAR'lar da (boyut sınırı altında) listelenir | Haftalık tam envanter, AI analizi |

## Durumlar

Eksik ya da kesik tarama **hiçbir katmanda TAM görünmez**.

| Düzey | Durumlar |
|---|---|
| Uygulama | `TAM`, `KISMI_SINIR`, `KISMI_ZAMAN`, `KISMI_IZIN`, `ARSIV_ACILMADI`, `ATLANDI_ZAMAN`, `HATA` |
| Host (betik) | `TAM`, `KISMI`, `KOK_YOK`, `ZAMAN_ASIMI` |
| Host (playbook) | `SONUC`, `PYTHON_YOK`, `KIMLIK_GECISI_YOK`, `ZAMAN_ASIMI`, `ULASILAMADI`, `HATA` |

## extra_vars (Portal gönderir)

| Değişken | Örnek | Açıklama |
|---|---|---|
| `hedefler` | `["APPSRV01"]` | Zorunlu. Bir parti; en çok `ear_parti_siniri` (varsayılan 100) |
| `ear_kip` | `OZET` / `TAM` | |
| `ear_kosu_no`, `ear_parti_no` | `12`, `3` | Portal'ın numaraları; dizin adı `kosu-<no>` |
| `ear_dizin` | `/sw/BMW_PORTAL/ear_envanter` | Çıktı kökü (GBLABT02'de) |
| `ear_okuma_kullanicisi` | `was` | `dzdo` ile; boş verilirse become yok |
| `ear_kokler` | `/vhosting:/vhosting8` | |
| `ear_sure` | `300` | Betik içi yumuşak bütçe (sn) |
| `ear_zaman_asimi` | `600` | Ansible görev zaman aşımı (sn); kesin sınır |
| `ear_sinir_uygulama`, `ear_sinir_host`, `ear_arsiv_mb` | `25000`, `200000`, `64` | |

## Çıktı

- **Dosya:** `<ear_dizin>/kosu-<no>/raw/<HOST>.out`. İçinde `@@EAR_ENVANTER_BASLA@@` ile `@@EAR_ENVANTER_BITTI@@` arasında zlib + base64 JSON var (`sema: 1`, `tarayici_surum`).
- **AWX `set_stats`:** `ear_envanter_result` = `{kosu_no, parti_no, kip, playbook_surum, beklenen, sonuc_alinan, hostlar[{host, paket, durum, rc, bayt, hata}]}`.
- Ansible 2.16'da bu sayılar metin olarak gelir; Portal sayıya çevirir.

## AWX template (adım adım)

Şablon iki yoldan biriyle oluşturulur: arayüzden (2A) ya da komutla (2B; Windows CMD veya RHEL 8). Sonuç aynıdır, diğer adımlar ikisinde de ortaktır.

### 1. Dosyaları AWX projesine kopyala

1. `server/ansible/bmw_portal/` klasörünü AWX projesindeki `bmw_portal/` klasörüne birebir kopyala (derinlik aynı kalmalı; bkz. `docs/AWX-KOPYALAMA-HARITASI.md`). Bu iş için gereken iki dosya:
   - `bmw_portal/ear_envanter/ear_envanter.yml`
   - `bmw_portal/ear_envanter/files/ear_tara.py`: playbook'un yanındaki `files/` alt klasöründe olmalı, yoksa betik bulunamaz.
2. AWX › Resources › Projects › proje › **Sync** (komutla: 2B, Adım 4). Sync yapılmazsa yeni playbook seçim listesinde çıkmaz.

### 2A. Şablonu arayüzden oluştur

AWX › Resources › Templates › Add › **Add job template**

| Alan | Değer |
|---|---|
| Name | Örneğin `BMW Portal - EAR Envanter` (ad serbest) |
| Job type | `Run` |
| Inventory | JBoss/WAS sunucu adlarını ve GBLABT02'yi çözebilen envanter (LogX Legacy / OpsX WAS'ın kullandığı) |
| Project | `bmw_portal` ağacının bulunduğu proje |
| Playbook | `bmw_portal/ear_envanter/ear_envanter.yml`. Portal adın `ear_envanter.yml` olduğunu denetler; başka bir playbook seçilirse iş başlatılmaz (409). |
| Execution environment | Diğer `bmw_portal` şablonlarıyla aynı. Yalnız `ansible.builtin` modülleri kullanılıyor, ek koleksiyon gerekmez. |
| Credentials | LogX Legacy / OpsX WAS'ın makine credential'ı (dzdo ile `was`'a geçebilen) |
| Variables | Boş; **Prompt on launch AÇIK**. Kapalıysa AWX, Portal'ın gönderdiği `hedefler` listesini sessizce yok sayar; Portal başlatmadan önce sınar ve işi başlatmaz. |
| Limit | Boş; Prompt on launch **kapalı** (Portal `limit` göndermez; hedefler `add_host` ile eklenir) |
| Forks | **50** |
| Verbosity | `0 (Normal)` |
| Timeout | **3600** sn. ÖZET partisi en çok 100 sunucu; Forks 50 ile iki dalga × sunucu başına en çok 600 sn (`ear_zaman_asimi`) + `/sw` kopyası. |
| Privilege Escalation | **Kapalı.** `dzdo → was` geçişini playbook yalnız tarama görevinde kendisi yapar. Açılırsa GBLABT02'deki dizin ve kopya adımları da kimlik değiştirir. |
| Concurrent jobs | **Kapalı.** Portal partileri zaten sırayla başlatır. |
| Survey | **Ekleme** (bkz. 3. bölüm). |

**Save**'e bas. Template ID adres çubuğundaki URL'dedir: `.../templates/job_template/<ID>/details`.

### 2B. Şablonu komutla oluştur (Windows CMD / RHEL 8)

Komutlar AWX API'sini `curl` ile çağırır. `curl` Windows 10/11'de ve RHEL 8'de hazır gelir; kurulum gerekmez.

- Her adımda önce **Windows CMD**, sonra **RHEL 8** komutu var. Fark yalnız değişken yazımında: Windows'ta `%AWX%`, RHEL'de `$AWX`.
- Örnekteki sayıları kendi ID'lerinle değiştir: proje `12`, envanter `34`, credential `7`, şablon `57`.
- Bir komutun çıktısı `cikti.json` dosyasına yazılır. Windows'ta `notepad cikti.json` ile, RHEL'de `head -c 120 cikti.json; echo` ile dosyanın **başına** bakmak yeterli.

**Adım 1: Çalışma klasörü ve AWX adresi**

İki `ping` adresinden hangisi JSON (içinde `"version"`) döndürüyorsa API yolu odur: klasik AWX `/api/v2`, AAP 2.5 `/api/controller/v2`. `AWX` değişkenine o yolu yaz.

```bat
mkdir %USERPROFILE%\awx-ear
cd /d %USERPROFILE%\awx-ear
curl -s https://AWX_ADRESI/api/v2/ping/
curl -s https://AWX_ADRESI/api/controller/v2/ping/
set AWX=https://AWX_ADRESI/api/v2
```

```bash
mkdir -p ~/awx-ear && cd ~/awx-ear
curl -s https://AWX_ADRESI/api/v2/ping/
curl -s https://AWX_ADRESI/api/controller/v2/ping/
AWX=https://AWX_ADRESI/api/v2
```

Sertifika hatası (`SSL certificate problem`) alırsan her `curl`'e `--cacert kurum-ca.pem` ekle (kurumun kök sertifikası). Windows'ta `CRYPT_E_NO_REVOCATION_CHECK` hatasında `--ssl-no-revoke` ekle. Doğrulamayı `-k` ile kapatma.

**Adım 2: Token**

AWX arayüzünde sağ üstte kullanıcı adın › **Tokens** › Add (AAP 2.5'te kullanıcı sayfasındaki API tokens sekmesi), Scope: **Write**. Token bir kez gösterilir; kopyala. Komut satırında görünmesin diye bir dosyaya yazılır. Son komut kullanıcı adını gösteriyorsa token çalışıyor.

```bat
set /p "T=Token: "
> awx-baslik.txt echo Authorization: Bearer %T%
set T=
curl -s -H @awx-baslik.txt %AWX%/me/
```

```bash
( umask 077; read -rsp 'Token: ' T; echo; printf 'Authorization: Bearer %s\n' "$T" > awx-baslik.txt )
curl -s -H @awx-baslik.txt $AWX/me/
```

`Authentication credentials were not provided` ya da `Invalid token` görürsen token yanlış ya da süresi dolmuş.

**Adım 3: Proje, envanter ve credential ID'leri**

En kolayı arayüz: öğeye tıkla, adres çubuğundaki sayı ID'dir (`.../projects/12/details` → `12`). Komutla (adı birebir yaz, büyük/küçük harf dahil):

```bat
curl -s -G -H @awx-baslik.txt --data-urlencode "name=PROJE ADI" %AWX%/projects/ -o cikti.json
notepad cikti.json
```

```bash
curl -s -G -H @awx-baslik.txt --data-urlencode "name=PROJE ADI" $AWX/projects/ -o cikti.json
head -c 120 cikti.json; echo
```

Çıktının başı `{"count":1,"next":null,"previous":null,"results":[{"id":12,` gibidir: ID = `12`. `"count":0` ise ad yanlış. Envanter için `projects/` yerine `inventories/`, credential için `credentials/` yaz.

**Adım 4: Projeyi güncelle (Sync)**

Proje Git'ten geliyorsa gerekli; elle kopyalanan (Manual) projede bu adımı atla. Komuttan sonra bir dakika bekle; güncelleme bitmeden şablon `Playbook not found` der.

```bat
curl -sS --fail -X POST -H @awx-baslik.txt %AWX%/projects/12/update/ -o cikti.json && echo TAMAM
```

```bash
curl -sS --fail -X POST -H @awx-baslik.txt $AWX/projects/12/update/ -o cikti.json && echo TAMAM
```

**Adım 5: Şablon dosyası**

`sablon.json` dosyasını oluştur:
- Windows: `notepad sablon.json` (yeni dosya sorusuna Evet), içeriği yapıştır, kaydet. Kodlamada "UTF-8 (BOM'lu)" seçme.
- RHEL: `cat > sablon.json` yaz, Enter, içeriği yapıştır, Enter, sonra Ctrl+D.

`project` ve `inventory` sayılarını Adım 3'teki ID'lerle değiştir:

```json
{
  "name": "BMW Portal - EAR Envanter",
  "description": "Server Hub > Uygulama Envanteri: salt okunur EAR/WAR taramasi",
  "job_type": "run",
  "project": 12,
  "inventory": 34,
  "playbook": "bmw_portal/ear_envanter/ear_envanter.yml",
  "forks": 50,
  "timeout": 3600,
  "verbosity": 0,
  "ask_variables_on_launch": true,
  "ask_limit_on_launch": false,
  "become_enabled": false,
  "allow_simultaneous": false,
  "survey_enabled": false
}
```

Diğer `bmw_portal` şablonları belirli bir Execution Environment kullanıyorsa `"execution_environment": <ID>,` satırını ekle. ID'si Adım 3'teki gibi `execution_environments/` adresinden bulunur.

**Adım 6: Şablonu oluştur**

```bat
curl -sS -H @awx-baslik.txt -H "Content-Type: application/json" --data-binary @sablon.json %AWX%/job_templates/ -o cikti.json
notepad cikti.json
```

```bash
curl -sS -H @awx-baslik.txt -H "Content-Type: application/json" --data-binary @sablon.json $AWX/job_templates/ -o cikti.json
head -c 120 cikti.json; echo
```

Çıktı `{"id":57,"type":"job_template",` ile başlıyorsa şablon oluştu: **Template ID = 57**. Başka bir şey dönerse:

| Çıktıda | Sebep |
|---|---|
| `already exists` | Aynı adla şablon var. Adı değiştir ya da var olanı Adım 9 ile düzelt. |
| `Playbook not found` | Dosyalar projeye kopyalanmamış ya da Sync bitmemiş |
| `Invalid pk` | Proje ya da envanter ID'si yanlış |

**Adım 7: Credential'ı bağla** (`7` credential, `57` şablon ID'si)

```bat
curl -sS --fail -H @awx-baslik.txt -H "Content-Type: application/json" -d "{\"id\": 7}" %AWX%/job_templates/57/credentials/ && echo TAMAM
```

```bash
curl -sS --fail -H @awx-baslik.txt -H "Content-Type: application/json" -d '{"id": 7}' $AWX/job_templates/57/credentials/ && echo TAMAM
```

**Adım 8: Kontrol**

Survey olmamalı; komut `{}` döndürmeli:

```bat
curl -s -H @awx-baslik.txt %AWX%/job_templates/57/survey_spec/
```

```bash
curl -s -H @awx-baslik.txt $AWX/job_templates/57/survey_spec/
```

Ayarların tamamını görmek için AWX'e girişliyken tarayıcıda Adım 1'deki API adresinin sonuna `/job_templates/57/` ekleyip aç. Şunlar görünmeli: `ask_variables_on_launch: true`, `forks: 50`, `timeout: 3600`, `become_enabled: false`, `survey_enabled: false`.

**Adım 9: Var olan şablonu düzelt** (arayüzden açılmış ya da ayarı yanlış bir şablon için)

`duzelt.json` dosyasını Adım 5'teki gibi oluştur:

```json
{
  "ask_variables_on_launch": true,
  "ask_limit_on_launch": false,
  "forks": 50,
  "timeout": 3600,
  "become_enabled": false,
  "allow_simultaneous": false,
  "survey_enabled": false
}
```

```bat
curl -sS --fail -X PATCH -H @awx-baslik.txt -H "Content-Type: application/json" --data-binary @duzelt.json %AWX%/job_templates/57/ -o cikti.json && echo TAMAM
```

```bash
curl -sS --fail -X PATCH -H @awx-baslik.txt -H "Content-Type: application/json" --data-binary @duzelt.json $AWX/job_templates/57/ -o cikti.json && echo TAMAM
```

Şablona survey eklenmişse sil:

```bat
curl -sS --fail -X DELETE -H @awx-baslik.txt %AWX%/job_templates/57/survey_spec/ && echo TAMAM
```

```bash
curl -sS --fail -X DELETE -H @awx-baslik.txt $AWX/job_templates/57/survey_spec/ && echo TAMAM
```

**Adım 10: Bitirince**

Token dosyasını sil. İstersen token'ı da AWX arayüzünden (Tokens) sil.

```bat
del awx-baslik.txt
```

```bash
rm -f awx-baslik.txt
```

### 3. Değişkenler ve survey

- **Variables: şablona değişken yazma, boş kalsın.** Portal her başlatmada değişkenleri kendisi gönderir (yukarıdaki "extra_vars" tablosu); varsayılanlar playbook'tadır. Şablona yazılan değer her işe sessizce eklenir ve Portal'ın göndermediği bir değişkeni (örneğin `ear_yazici_host`) değiştirebilir.
- **Survey: gerekmez, ekleme.**
  - `hedefler` bir liste; survey'de liste tipi yok. Metin alanı string gönderir, playbook'un girdi doğrulaması bunu reddeder.
  - Survey'deki zorunlu alanlar ve tip denetimi, Portal'ın başlattığı işi AWX'te reddettirebilir.
  - Değişkenleri Portal zaten "Prompt on launch" üzerinden gönderiyor.
- AWX'ten elle denemek için survey yerine Launch ekranındaki **Variables** kutusu kullanılır (6. bölüm sonu).

### 4. Yetki ve zamanlama

- **Execute yetkisi yalnız Portal'ın AWX'e bağlandığı servis hesabında olsun.** extra_vars her değişkenin önüne geçer; şablonu AWX'ten elle başlatabilen biri `ear_okuma_kullanicisi`'nı ya da `ear_yazici_host`'u değiştirebilir. Yetki arayüzden verilir: şablon sayfasındaki erişim (Access) sekmesi › Add.
- **AWX'te bu şablona Schedule ekleme.** Haftalık tarama Portal'ın kendi zamanlayıcısıdır. AWX'ten `hedefler` olmadan başlayan iş ilk play'deki girdi doğrulamasında düşer.

### 5. Portal'a bağla

1. Admin › Playbook Kayıtları › `server_hub_ear_envanter` satırına Template ID'yi gir ve kaydet. Sunucu ortamında `EAR_ENVANTER_TEMPLATE_ID` de kullanılabilir.
2. Server Hub › Uygulama Envanteri sekmesinde "AWX template'i tanımlı değil" uyarısı kalkmalı ve **Şimdi tara** düğmesi açılmalı.

### 6. Pilot

1. **Şimdi tara** penceresinde "Seçili sunucular"ı seç, 1–5 sunucu gir, kip olarak **TAM**'ı seç.
2. AWX iş çıktısında tarama adımı `censored` görünür. Bu normal (`no_log`): betik ve çıktı AWX olay tablosuna yazılmaz.
3. Dosyalar GBLABT02 üzerinde `/sw/BMW_PORTAL/ear_envanter/kosu-<no>/raw/<HOST>.out` altına yazılır. Bu yüzden:
   - Bağlanan kullanıcı GBLABT02'de bu klasöre yazabilmeli.
   - Portal aynı yolu okuyabilmeli (`EAR_ENVANTER_DIR`).

| Ekranda görülen | Anlamı |
|---|---|
| "yanlış şablon" (409) | Template ID başka bir playbook'a ait |
| `"Prompt on launch" (Variables) kapalı` | Şablonda Variables › Prompt on launch kapalı |
| Sunucu `KIMLIK_GECISI_YOK` | O sunucuda `dzdo -u was` izni yok |
| Sunucu `PYTHON_YOK` | Sunucuda `python3` ya da `/usr/libexec/platform-python` yok |
| Sunucu `ULASILAMADI` | SSH bağlantısı kurulamadı ya da envanter adı çözemedi |

Sonuçlar doğruysa Uygulama Envanteri › Ayarlar'dan haftalık taramayı aç. Varsayılan **kapalı**dır; açılınca Pazar 02:00 (TR), TAM kip.

#### AWX'ten tek sunucuyla deneme (isteğe bağlı)

Portal'dan önce SSH, `dzdo` ve `/sw` yazımını tek sunucuda denemek için. Sonuç Portal'a yansımaz; `kosu-999999` dizinini Portal'ın saklama işi 7 gün sonra kendisi siler.

Arayüzden: Templates › şablon › **Launch** › Variables kutusuna yaz:

```yaml
hedefler: [SUNUCU_ADI]
ear_kip: OZET
ear_kosu_no: 999999
ear_parti_no: 1
```

Komutla: 2B'deki `AWX` değişkeni ve `awx-baslik.txt` gerekir (Adım 10'da sildiysen Adım 1-2'yi tekrarla). `deneme.json` dosyasını Adım 5'teki gibi oluştur:

```json
{"extra_vars": {"hedefler": ["SUNUCU_ADI"], "ear_kip": "OZET", "ear_kosu_no": 999999, "ear_parti_no": 1}}
```

```bat
curl -sS -H @awx-baslik.txt -H "Content-Type: application/json" --data-binary @deneme.json %AWX%/job_templates/57/launch/ -o cikti.json
notepad cikti.json
```

```bash
curl -sS -H @awx-baslik.txt -H "Content-Type: application/json" --data-binary @deneme.json $AWX/job_templates/57/launch/ -o cikti.json
head -c 120 cikti.json; echo
```

Çıktı `{"job":1234,"ignored_fields":{}` ile başlar. `ignored_fields` içinde `extra_vars` görünüyorsa Prompt on launch kapalıdır.

AWX › Jobs › 1234 ekranında:
- **Successful:** sunucu tarandı, sonuç `/sw/BMW_PORTAL/ear_envanter/kosu-999999/raw/` altına yazıldı.
- **Failed:** son satırdaki `Hicbir sunucudan envanter alinamadi. Sonuclar: [...]` sunucunun durumunu verir. Anlamları yukarıdaki tabloda.

## Elle pilot (tek host, insan okunur, salt okunur)

```bash
ssh <host> "dzdo -u was /bin/sh -c 'EAR_CIKTI=insan EAR_KIP=OZET python3 -B -'" < files/ear_tara.py
```
