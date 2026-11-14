# Init Scripts — Portal ↔ Ansible veri sözleşmesi

Ekran: **Denetim › Init Scripts** (`GET /api/denetim/init-scripts?root=vhosting|vhosting8`).
Kod: `server/audit/denetim.cjs` (`INIT_SCRIPTS`, `readInitExtras`, `readInitAge`,
`scriptDeviationReport`, `eskiSapmaRaporu`). Testler: `server/audit/__tests__/init-scripts-referans.test.cjs`.
Veritabanı: **TBMWANS**. Portal bu tabloların hiçbirine **yazmaz**, DDL çalıştırmaz.

Ansible tarafı (`bmw_wds_scripts/initialize/check_initialize.yaml` ve loader
`files/initiliaze_scripts_inventory.py`) **kullanıcıdadır**. Bu belge Portal'ın neyi, hangi adla
ve hangi tiple okuduğunu, Portal'ın hangi kuralla karşılaştırdığını anlatır; playbook/loader
bunu üretirse ekran yeni davranışa kendiliğinden geçer, üretmezse eskisi gibi çalışır.

## 1. Neden (2026-11-14)

`appdomain.service` dağıtılan sürümle aynı olduğu hâlde "farklı" görünüyordu. Üç neden:

1. AWX job `check_initialize.yaml` ilk `localhost` `/sw` yazımında düşüyordu
   (`Destination directory /sw/WAS_IMAGES/Ansible/Middleware_Inventory does not exist`,
   `NO MORE HOSTS LEFT`). Tablolar yenilenmedi; ekran **eski** veriyi gösterdi ve verinin
   yaşı hiçbir yerde görünmüyordu.
2. Referans **çoğunluk** hash'iydi; yeni ve doğru dağıtılmış sunucular azınlıkta kalınca
   "sapan" görünüyordu.
3. Ham `sha512sum` gözle görünmeyen bayt farklarını (son satır sonu, CRLF, satır sonu boşluğu)
   ayrı sürüm sayıyordu.

## 2. Zorunlu tablolar (eski sözleşme — değişmedi)

`dbo.InitScriptsInventory` (`/vhosting`) ve `dbo.InitScriptsInventory8` (`/vhosting8`).
Geniş biçim: sunucu başına **bir satır**, dosya başına **bir sütun**, değer **ham** sha512.

| Sütun | Tip (beklenen) | Dosya | Not |
|---|---|---|---|
| `host` | `NVARCHAR` | — | **Zorunlu.** Yoksa ekran boş döner. Boşluk kırpılır, boş host satırı atılır. |
| `appdomain_service` | `NVARCHAR(128) NULL` | `appdomain.service` | Sunucu geneli dosya (`/etc/systemd/system`), iki tabloya da yazılır. |
| `start_sh` | `NVARCHAR(128) NULL` | `start.sh` | |
| `functions_sh` | `NVARCHAR(128) NULL` | `functions.sh` | |
| `startCTG_sh` | `NVARCHAR(128) NULL` | `startCTG.sh` | |
| `startWAS_sh` | `NVARCHAR(128) NULL` | `startWAS.sh` | |
| `startWEB_sh` | `NVARCHAR(128) NULL` | `startWEB.sh` | |
| `startJboss_sh` | `NVARCHAR(128) NULL` | `startJboss.sh` | |
| `startJboss8_sh` | `NVARCHAR(128) NULL` | `startJboss8.sh` | |
| `startNginx_sh` | `NVARCHAR(128) NULL` | `startNginx.sh` | |
| `startIHS_sh` | `NVARCHAR(128) NULL` | `startIHS.sh` | |
| `exceptionList_ini` | `NVARCHAR(128) NULL` | `exceptionList.ini` | |
| `startApplicationServers_jy` | `NVARCHAR(128) NULL` | `startApplicationServers.jy` | |
| `stopApplicationServers_jy` | `NVARCHAR(128) NULL` | `stopApplicationServers.jy` | |
| `startRHA_sh` | `NVARCHAR(128) NULL` | `startRHA.sh` | Opsiyonel sütun (yeni). |
| `startLiberty_sh` | `NVARCHAR(128) NULL` | `startLiberty.sh` | Opsiyonel sütun (yeni). |
| `startCustom_sh` | `NVARCHAR(128) NULL` | `startCustom.sh` | Sunucuya özel; sapma sayılmaz, yalnız "var/yok" ve sürüm listesi. |
| `load_date` | `DATETIME2 NULL` | — | **Opsiyonel, önerilir.** Verinin yaşı buradan okunur (bkz. §6). |

Kurallar:

- Portal önce `sys.columns` ile hangi sütunların olduğuna bakar; yalnız yukarıdaki listede olan
  ve tabloda bulunan sütunları `SELECT` eder. Eksik dosya sütunu ekranda "henüz sütun yok"
  uyarısı olur, hata değildir. **İstisna:** "Opsiyonel sütun (yeni)" olarak işaretli
  `startRHA_sh` / `startLiberty_sh` yoksa uyarı **çıkmaz** (eski loader bunları yazmaz; eski
  ekran birebir kalır). Loader yazınca sekmede kendiliğinden görünürler.
- Değer: **küçük harf, 128 hex karakter** (`sha512sum` çıktısının ilk alanı). Portal dizgi
  karşılaştırır (büyük/küçük harf duyarlı); referans tablosundaki hash'ler de aynı biçimde olmalı.
- Dosya yoksa / okunamıyorsa / hash alınamadıysa sütun **NULL** (ya da boş) kalır. Portal "yok"
  kararını **yalnız bu sütundan** verir; ayrıntı tablosundaki `state` yalnız "yok" ile
  "okunamıyor" ayrımını yapar.

## 3. Opsiyonel tablo: `dbo.InitScriptsDetail`

Uzun biçim: `(host, kök, dosya)` başına bir satır.

| Sütun | Tip (beklenen) | Portal okur mu | Anlamı |
|---|---|---|---|
| `host` | `NVARCHAR(64) NOT NULL` | evet | Geniş tablodaki `host` ile **birebir aynı** yazım (kırpılarak eşlenir). |
| `root` | `NVARCHAR(16) NOT NULL` | evet | `vhosting` ya da `vhosting8` (küçük harf, tam bu değerler). |
| `script` | `NVARCHAR(64) NOT NULL` | evet | Dosya **adı**, §2'deki "Dosya" sütunundaki yazımla birebir (ör. `appdomain.service`, `start.sh`). Listede olmayan ad yok sayılır. |
| `raw_sha512` | `NVARCHAR(128) NULL` | hayır | Ham hash; Portal hamı geniş tablodan alır. Tutarlılık için aynı değer yazılmalı. |
| `norm_sha512` | `NVARCHAR(128) NULL` | evet | Normalleştirilmiş içeriğin sha512'si (§5). Dosya okunamadıysa NULL. |
| `has_cr` | `BIT NULL` | evet | Dosyada en az bir CR (`\r`) baytı varsa 1. |
| `state` | `NVARCHAR(16) NULL` | evet | `OK`, `MISSING`, `UNREADABLE`, `ERROR` (büyük harf önerilir; Portal büyütür). |
| `scan_date` | `DATETIME2 NOT NULL` | evet (yalnız yaş) | Koşunun zaman damgası; `load_date` yoksa yaş buradan (§6). |

Portal sorgusu (sabit tablo/sütun adları, kök ve dosya adları bağlı parametre):

```sql
SELECT host, root, script, norm_sha512, has_cr, state FROM dbo.InitScriptsDetail
 WHERE root = @root OR (root = @other AND script IN (@hw0))   -- @hw0 = 'appdomain.service'
```

"Ayrıntı var" sayılması için bu kökte **en az bir** satırda `norm_sha512` ya da `state` dolu
olmalıdır. Tablo var ama bu kök için satır yoksa Portal eski davranışa döner.

## 4. Opsiyonel tablo: `dbo.InitScriptsReference` (ekip sürümü)

| Sütun | Tip (beklenen) | Portal okur mu | Anlamı |
|---|---|---|---|
| `script` | `NVARCHAR(64) NOT NULL` | evet | Dosya adı, §2 yazımıyla birebir. Dosya başına **en fazla bir** satır. Birden çoksa Portal `ORDER BY script, norm_sha512, raw_sha512` ile okur ve **ilkini** alır (deterministik ama keyfi; loader tek satır yazmalı). |
| `raw_sha512` | `NVARCHAR(128) NOT NULL` | evet | Depodaki kopyanın ham hash'i. |
| `norm_sha512` | `NVARCHAR(128) NOT NULL` | evet | Depodaki kopyanın normalleştirilmiş hash'i. **Boşsa satır yok sayılır.** |
| `has_cr` | `BIT NULL` | hayır | |
| `source` | `NVARCHAR(16) NOT NULL` | hayır | Ör. `repo`. |
| `scan_date` | `DATETIME2 NOT NULL` | hayır | |

Beklenen satırlar: `bmw_wds_scripts/initialize/files/` altındaki, `initialize.yaml`'ın gerçekten
dağıttığı dosyaların kopyaları (ve `appdomain.service`'in referans kopyası). Kopyası olmayan
dosya için **satır yazılmaz** (ör. `startWEB.sh`, `exceptionList.ini`,
`stopApplicationServers.jy`); `startCustom.sh` sunucuya özeldir, satırı olsa da Portal kullanmaz.
Satırı olmayan dosyada Portal çoğunluğa düşer (ekranda "çoğunluk" etiketi, üst şeritte "karma").

Hash'ler §5'teki kuralla, dağıtılan dosyanın **kendisinden** hesaplanmalı (Windows çalışma
kopyasındaki CRLF'li hâlinden değil; `core.autocrlf=true` tuzağı).

## 5. Normalleştirme kuralı (playbook/loader birebir aynısını uygulamalı)

Bayt düzeyinde, sırayla:

1. Tüm CR baytları (`\r`, 0x0D) silinir.
2. İçerik `\n` ile satırlara bölünür; her satırın **sonundaki** boşluk/sekme (`[ \t]+`) kırpılır.
   Satır başı ve satır içi boşluklara dokunulmaz.
3. Sondaki boş satırlar atılır (aradaki boş satırlar kalır).
4. Kalan her satır tam bir `\n` ile biter. Hiç satır kalmazsa sonuç boş içeriktir.
5. `norm_sha512` = sonucun sha512'si (küçük harf hex).

Kanonik biçim "düzgün kaydedilmiş Unix dosyası"dır: onun ham ve normalleştirilmiş hash'i aynıdır.
Karakter kodlaması dönüştürülmez (BOM varsa kalır ve fark sayılır).

Python:

```python
def norm_bytes(data: bytes) -> bytes:
    lines = [ln.rstrip(b" \t") for ln in data.replace(b"\r", b"").split(b"\n")]
    while lines and lines[-1] == b"":
        lines.pop()
    return b"".join(ln + b"\n" for ln in lines)
```

Sunucuda (bash + awk, `LC_ALL=C`):

```bash
LC_ALL=C tr -d '\r' < "$f" | LC_ALL=C awk '{ sub(/[ \t]+$/, ""); a[NR] = $0; if ($0 != "") last = NR }
  END { for (i = 1; i <= last; i++) print a[i] }' | sha512sum | awk '{print $1}'
```

Test vektörleri (dördü de aynı norma iner; sonuncusu boş içerik):

| Girdi | Normalleştirilmiş içerik | `norm_sha512` (ilk 16) |
|---|---|---|
| `a\nb` | `a\nb\n` | `a10ae0008f11be07` |
| `a\r\nb\r\n` | `a\nb\n` | `a10ae0008f11be07` |
| `a  \nb\t\n\n\n` | `a\nb\n` | `a10ae0008f11be07` |
| `a\nb\n` | `a\nb\n` | `a10ae0008f11be07` |
| ` \n\r\n` | (boş) | `cf83e1357eefb8bd` |

`a\nb\n` tam hash: `a10ae0008f11be0760dd55ac8236209da415d12a6208f8e2c340e41db45685b429868b2325f2bdd7334c3297253aca7475379943d7cf004941553aa734ac839e`.

## 6. Verinin yaşı

Kaynak önceliği:

1. Geniş tabloda `load_date` sütunu varsa: `MAX(load_date)`.
2. Yoksa `dbo.InitScriptsDetail` varsa: bu kökün `MAX(scan_date)`.
3. İkisi de yoksa (yalnız eski iki tablo): **yaş bilinmiyor**.

Yaş SQL Server'da `DATEDIFF(MINUTE, MAX(...), SYSDATETIME())` ile hesaplanır, yani zaman
damgası **SQL Server saatiyle** yazılmalıdır (loader `SELECT SYSDATETIME()` ile koşu başına tek
değer almalı, istemci/EE saati değil). Yanıt alanları: `loadedAt` (`YYYY-MM-DD HH:MM:SS`),
`ageMinutes`, `ageDays`, `ageSource` (`load_date` | `scan_date` | `null`).

Ekran:

- 48 saatten eski: amber uyarı **"Veri X gün önce yüklendi — check_initialize işi çalışmıyor
  olabilir."** + son yükleme zamanı.
- Bilinmiyor: amber uyarı "Verinin yaşı bilinmiyor (eski yükleyici); sonuçlar güncel olmayabilir."
- Daha yeni: nötr bilgi satırı "Veri N saat önce yüklendi (...)".

Yaş sorgusu düşerse uç yine 200 döner, yaş "bilinmiyor" olur.

## 7. Portal'ın karşılaştırma kuralı

### 7.1 Yalnız eski iki tablo (ayrıntı ve referans yok)

2026-11-14 öncesi algoritma **birebir** çalışır (`eskiSapmaRaporu`; test IR2b eski kodun
kopyasıyla alan alan karşılaştırır):

- Sürüm = ham hash. Referans = bu kökün (sekmenin) çoğunluk hash'i; eşitlikte hash'e göre sıralı ilk.
- Çoğunluktan farklı her ham hash = sapma. Boş sütun = eksik.
- `appdomain.service` her sekmede kendi çoğunluğuna göre ölçülür (öteki kökün tablosu okunmaz).
- `GBEVM*` / `GBPRV*` ayrı raporlanır; satırları genel envanterin çoğunluğuna göre ölçülür.
- `missingColumns` eskisiyle aynıdır (opsiyonel `startRHA.sh`/`startLiberty.sh` eklenmez).
- Ekran: başlıklar ("Çoğunluk", "Çoğunluktan sapan", "çoğunlukla birebir aynı"), çip yokluğu ve
  CSV sütunları eskisi gibi. Deployment Scripts ekranı da aynı (ortak bileşen; yeni CSV sütunları
  yalnız Init'te).
- Tek görünür ek: veri yaşı şeridi (§6). Yanıta nötr yeni alanlar eklenir (`formatOnlyCount: 0`,
  `crlfCount: 0`, `referenceSource: 'cogunluk'` ...), istemci bunları eski veride göstermez.

### 7.2 Ayrıntı ve/veya ekip referansı var

Referans önceliği (dosya başına): ekip sürümü (`InitScriptsReference.norm_sha512` dolu) →
yoksa çoğunluk. Çoğunluk normalleştirilmiş içeriğe göre gruplanır (norm yoksa ham).

| Durum | Sonuç | Sayılır mı |
|---|---|---|
| ham == referans ham, ya da ham == referans norm | uyumlu | — |
| ham farklı, norm == referans norm | **"yalnız biçim farkı (boşluk/satır sonu)"** (gri) | sapma **sayılmaz** |
| `.sh`/`.jy` dosyasında `has_cr = 1` | "CRLF — betik çalışmayabilir" (amber) | ayrı sayılır; sunucu "tam uyumlu" sayılmaz |
| norm farklı | gerçek sapma | sapma |
| geniş sütun boş, `state` = `UNREADABLE`/`ERROR` | "okunamıyor" | ayrı listelenir |
| geniş sütun boş, diğer | eksik | eksik |

- Aynı normdaki farklı ham hash'ler tek sürümün "bayt biçimleri" olarak açılır listede gösterilir.
  "Sapma sayılmaz" notu yalnız referans sürümünde yazılır; referanstan farklı bir sürümün bayt
  biçimleri o sürümle birlikte sapan sayılır.
- Bir sunucunun ayrıntı satırı eksikse (norm bilinmiyor) ama ham hash'i normu bilinen başka bir
  kopyayla (ya da ekip referansının ham hash'iyle) aynıysa, o normu alır; aynı içerik ham/norm
  anahtarı yüzünden iki sürüm sayılmaz.
- Tek sürüm olup ekip sürümüyle uyuşmayan dosyada "1 sürüm" rozeti yeşil değil amber
  ("referans değil") gösterilir.
- `startCustom.sh` (sunucuya özel) için de CR uyarısı sunucu satırında görünür.
- `appdomain.service` (sunucu geneli): ayrıntı varken referansı iki kökün satırları birleştirilip
  sunucu başına bir kez hesaplanır; iki sekme aynı referansı gösterir. Ekip referansı varsa o kullanılır.
- `GBEVM*` / `GBPRV*`: genel envanterin referansına (ekip sürümü dahil) göre ölçülür.
- `.service`/`.ini` dosyalarında CR uyarı değildir (yalnız biçim farkı).

## 8. Yokluk ve hata davranışı

| Durum | Portal |
|---|---|
| `InitScriptsDetail` ve `InitScriptsReference` yok | §7.1 (eski davranış) + yaş şeridi |
| `InitScriptsDetail` var, bu kökte dolu satır yok | §7.1 (referans tablosu da yoksa) |
| Yalnız `InitScriptsReference` var | ekip referansı ham hash'le karşılaştırılır: ham == referans ham/norm → uyumlu, diğerleri sapma (biçim farkı ayrımı için norm gerekir) |
| Ek tablo sorgularından **herhangi biri** hata verir (ilk, ayrıntı, referans ya da öteki kök) | uç 200; `extrasError` dolu; o ana kadar okunan ayrıntı/referans da **atılır**; ekranda "Ayrıntı tabloları okunamadı ..." ve §7.1 (yarım yeni yol üretilmez) |
| `load_date` / `scan_date` yok ya da boş | "Verinin yaşı bilinmiyor" uyarısı |
| Geniş tabloda `host` yok ya da hiç dosya sütunu yok | boş rapor, `missingColumns` dolu |

## 9. Loader için kontrol listesi

- [ ] Geniş tablolar: sözleşme aynen; `load_date DATETIME2` her satıra koşunun tek `SYSDATETIME()` değeri.
- [ ] Boş/eksik taramada tablolar **TRUNCATE edilmez** (job 13418 gibi bir koşu veriyi silmemeli; yaş uyarısı eski veriyi zaten işaretler).
- [ ] `InitScriptsDetail`: `root` ∈ {`vhosting`, `vhosting8`}, `script` §2 dosya adları, hash'ler küçük harf hex.
- [ ] `InitScriptsReference`: yalnız depoda kopyası olan dosyalar; `norm_sha512` dolu.
- [ ] Normalleştirme §5 ile aynı; test vektörleri tutuyor.
- [ ] Sunucuya giden `.sh`/`.jy` dosyaları LF (yoksa Portal haklı olarak CRLF uyarısı verir).
