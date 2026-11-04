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

## AWX template

- Proje: bu ağaç (`bmw_portal/ear_envanter/ear_envanter.yml`).
- Variables **prompt on launch AÇIK**. Kapalıysa `hedefler` sessizce yutulur.
- **Forks 50.**
- Makine kimliği hedeflere ve GBLABT02'ye bağlanabilmeli; `dzdo` ile `was` geçişi izinli olmalı (LogX Legacy ile aynı).
- Template ID: Admin › Sistem › `EAR_ENVANTER_TEMPLATE_ID`; Playbook Kayıtları › `server_hub_ear_envanter`.

## Elle pilot (tek host, insan okunur, salt okunur)

```bash
ssh <host> "dzdo -u was /bin/sh -c 'EAR_CIKTI=insan EAR_KIP=OZET python3 -B -'" < files/ear_tara.py
```
