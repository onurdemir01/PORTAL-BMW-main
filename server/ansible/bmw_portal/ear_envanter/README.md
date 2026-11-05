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

### 1. Dosyaları AWX projesine kopyala

1. `server/ansible/bmw_portal/` klasörünü AWX projesindeki `bmw_portal/` klasörüne birebir kopyala (derinlik aynı kalmalı; bkz. `docs/AWX-KOPYALAMA-HARITASI.md`). Bu iş için gereken iki dosya:
   - `bmw_portal/ear_envanter/ear_envanter.yml`
   - `bmw_portal/ear_envanter/files/ear_tara.py`: playbook'un yanındaki `files/` alt klasöründe olmalı, yoksa betik bulunamaz.
2. AWX › Resources › Projects › proje › **Sync**. Sync yapılmazsa yeni playbook seçim listesinde çıkmaz.

### 2. Şablonu oluştur

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

**Save**'e bas. Template ID adres çubuğundaki URL'dedir: `.../templates/job_template/<ID>/details`.

### 3. Yetki ve zamanlama

- **Execute yetkisi yalnız Portal'ın AWX'e bağlandığı servis hesabında olsun.** extra_vars her değişkenin önüne geçer; şablonu AWX'ten elle başlatabilen biri `ear_okuma_kullanicisi`'nı ya da `ear_yazici_host`'u değiştirebilir.
- **AWX'te bu şablona Schedule ekleme.** Haftalık tarama Portal'ın kendi zamanlayıcısıdır. AWX'ten `hedefler` olmadan başlayan iş ilk play'deki girdi doğrulamasında düşer.

### 4. Portal'a bağla

1. Admin › Playbook Kayıtları › `server_hub_ear_envanter` satırına Template ID'yi gir ve kaydet. Sunucu ortamında `EAR_ENVANTER_TEMPLATE_ID` de kullanılabilir.
2. Server Hub › Uygulama Envanteri sekmesinde "AWX template'i tanımlı değil" uyarısı kalkmalı ve **Şimdi tara** düğmesi açılmalı.

### 5. Pilot

1. **Şimdi tara** penceresinde "Seçili sunucular"ı seç, 1–5 sunucu gir, kip olarak **TAM**'ı seç.
2. AWX iş çıktısında tarama adımı `censored` görünür. Bu normal (`no_log`): betik ve çıktı AWX olay tablosuna yazılmaz.
3. Dosyalar GBLABT02 üzerinde `/sw/BMW_PORTAL/ear_envanter/kosu-<no>/raw/<HOST>.out` altına yazılır. Bu yüzden:
   - Bağlanan kullanıcı GBLABT02'de bu klasöre yazabilmeli.
   - Portal aynı yolu okuyabilmeli (`EAR_ENVANTER_DIR`).

| Ekranda görülen | Anlamı |
|---|---|
| "yanlış şablon" (409) | Template ID başka bir playbook'a ait |
| `"Prompt on launch" (Variables) kapalı` | 2. adımdaki Variables › Prompt on launch kapalı |
| Sunucu `KIMLIK_GECISI_YOK` | O sunucuda `dzdo -u was` izni yok |
| Sunucu `PYTHON_YOK` | Sunucuda `python3` ya da `/usr/libexec/platform-python` yok |
| Sunucu `ULASILAMADI` | SSH bağlantısı kurulamadı ya da envanter adı çözemedi |

Sonuçlar doğruysa Uygulama Envanteri › Ayarlar'dan haftalık taramayı aç. Varsayılan **kapalı**dır; açılınca Pazar 02:00 (TR), TAM kip.

## Elle pilot (tek host, insan okunur, salt okunur)

```bash
ssh <host> "dzdo -u was /bin/sh -c 'EAR_CIKTI=insan EAR_KIP=OZET python3 -B -'" < files/ear_tara.py
```
