# PBI — Üretim log analizi (2026-09-19)

Kaynak: 13 günlük üretim logu (2026-09-06 → 2026-09-19), `prod.out` (70k satır) ve
`prod.app.log` (33k satır). Her PBI'nın kanıtı **ölçümdür**, tahmin değil.

> **Not:** Bu depo public. Log alıntıları sunucu adı, iç URL ve kullanıcı adı
> içermeyecek şekilde sadeleştirildi; sayılar ve hata sınıfları korundu.

---

## 2026-09-21 güncellemesi — iki ölçümüm yanlış çıktı

20 Eylül tarihli **daha geniş** bir log turunda bu belgedeki iki iddia
**ölçümle çürüdü**. İkisi de aşağıda düzeltildi; asıl metin, nasıl yanıldığımın
kaydı olarak duruyor.

**1. OOM sayısı üç değil YEDİ.** Dört belirtecin dördü de (`FATAL ERROR`,
`Reached heap limit`, `Last few GCs`, `JS stacktrace`) `prod.out`'ta tam **7**.
İlk analizim daha küçük bir log dilimindeydi. Uptime'lar **59 sn – 12 dk**:
sızıntı **değil**, tek bir istek 2 GB yiyor.

**Ve daha önemlisi:** `prod.app.log` çökmeyi **hiç görmüyor** (dört belirteç de
sıfır) — süreç V8 ile birlikte ölüyor ve `FATAL ERROR` yalnızca stdout'a
düşüyor. **Yalnızca app.log'a bakan "çökme yok" der ve yanılır.**

**2. `clientError ECONNRESET` bir üretim arızası DEĞİL.** 1.326 olayın 683'ü
09-12, 677'si 09-19 — **ikisi de Cumartesi, saat 05:00**. `HPE_INVALID_METHOD`
ve `HPE_INVALID_URL` aynı günlerde zirve yapıyor. Bu **haftalık zafiyet
taraması**; gerçek istemci reset'i günde ~5. Aşağıda "gürültü" diye
sınıflamıştım — **alarm dışı bırakılmalı**, düzeltilecek bir şey yok.

### Bu belgedeki PBI'ların durumu

| PBI | Durum |
|---|---|
| P0-1 OOM | Dört ayrı yol kapatıldı (PR #106/#108/#109/#112) + ortak sınırlı okuma yardımcısı (#118). **Üretimde doğrulanmadı** — düzeltmeler log penceresinden sonra; bellek nabzı (#112) bir sonraki turda bunu ölçülebilir kılacak |
| P0-2 Denetim kaydı | Kapatıldı (#107), spool'un kendisi de sınırlandı (#109) |
| P1-1 ScaleX keşfi | Anlık uygulama listesi (#110) + Cluster Yetenek Envanteri (#116) |
| P1-2 Önizle/uygula | Önizle → işaretle → uygula (#119/#120) + hedef bazlı seçim (#123) |
| P1-3 401 fırtınası | Görünürlük döngüsü (#117) + **oturum-bitti kapısı** (bu tur): imzalı 401 sonrası `/api/*` ağa çıkmaz. Kalan yarısı `SESSION_STORE` — sunucu tarafı ayar |
| P2-1 Log gürültüsü | MCP geri çekilme + TLS önbelleği (#121); ECONNRESET **yeniden sınıflandı** |
| P2-2 Yavaş uçlar | Kısmen (#112, #118) |
| P3-1 MSSQL/AWX 403 | AWX 403 kapatıldı (#117); MSSQL havuzu **açık** |

| # | Başlık | Sınıf | Öncelik | Büyüklük |
|---|---|---|---|---|
| [P0-1](#p0-1) | AWX iş çıktısı OOM ile portalı çökertiyor | hata | P0 | M |
| [P0-2](#p0-2) | Denetim kaydı sessizce kayboluyor | hata | P0 | M |
| [P1-1](#p1-1) | ScaleX keşfi 64 sn — önbellek yok | performans | P1 | L |
| [P1-2](#p1-2) | Önizle → işaretle → uygula akışı eksik | UX | P1 | M |
| [P1-3](#p1-3) | Oturumsuz istemci yoklaması: ~9.700 gereksiz istek | performans | P1 | S |
| [P2-1](#p2-1) | Log gürültüsü: ERROR hacminin %95'i gerçek hata değil | gürültü | P2 | S |
| [P2-2](#p2-2) | Yavaş uçlar | performans | P2 | M |
| [P3-1](#p3-1) | MSSQL havuz hatası ve AWX cancel 403 | hata | P3 | S |

---

## <a id="p0-1"></a>P0-1 — AWX iş çıktısı OOM ile portalı çökertiyor

**Sınıf:** hata · **Öncelik:** P0 · **Büyüklük:** M

### Kanıt
`prod.out` sonunda **iki** OOM (`FATAL ERROR`, `Reached heap limit`, `Last few GCs`,
`JS stacktrace` desenlerinin her biri tam **2** kez geçiyor). İkincisinin son JS işlemi:

```
718421 ms: Mark-Compact 2090.0 (2122.6) -> 2065.6 MB ... allocation failure
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
13: v8::internal::Runtime_StringSplit(...)      <-- son JS islemi
```

**`split` son damla, sebep DEĞİL.** İki çökmenin son JS karesi **farklı**:
OOM #1 `Runtime_AllocateInYoungGeneration` (split **yok**), OOM #2
`Runtime_StringSplit` — ama ikisi de aynı ~2 GB'da. Belirleyici satır şu:
**Mark-Compact'tan SONRA hâlâ 2065 MB canlı.** Yani 2 GB, GC'nin toplayamadığı
**tutulan (retained)** veriydi; `split` yalnızca sıradaki tahsisti.

Destekleyen ölçüm: `GET /jobs/N/output` **ortalama 20,8 sn, en fazla 35,8 sn**
(98 yavaş istek).

### Kök neden (kod okunarak doğrulandı)
`server/ansible/runner.cjs` içinde iki yol da aynı zinciri izliyor
(`getJobOutput` ve `getJobOutputOnServer`):

0. **`fetchAwxPlainText` yanıtın tamamını tek bir string'e yığıyordu**
   (`data += chunk`, tavan yok, akış yok). Asıl tutulan bellek burası.
1. AWX `/stdout/?format=txt` ucu kendi iç eşiğini (varsayılan 1 MB) aşınca
   gerçek çıktı yerine *"Standard Output too large to display"* metnini döner
   — yani o 1 MB eşiği **kazara** bir korumaydı ve aşıldığında devre dışı kalıyordu.
2. `isAwxStdoutTooLarge` bunu yakalar ve **`collectJobEventsStdout`** yedeğine düşer.
3. O fonksiyon **40.000 event'e kadar** `chunks[]` dizisine biriktirip
   `chunks.join('\n')` ile **tek bir dev string** üretir — **boyut sınırı yok**.
4. `runner.cjs` çıktıyı `output.split('\n')` ile satırlara böler: aynı veri artık
   hem string hem dizi olarak bellekte → heap iki katına çıkar → 2 GB'da OOM.

`split`'in tek amacı bir regex testi (`changed=` arama). Dizi **hiç gerekmiyor**.

**Yükselteç:** aynı çıktı **her yoklamada yeniden** indiriliyor ve istemci çıktı
büyüdükçe **daha sık** yokluyor (`JobTrackerContext` `RUN_MS = 1500`). Altı eş
zamanlı işin tamponları aynı anda canlı olduğu için GC toplayamıyor.

### Etki
Portal çöker; o anda açık tüm oturumlar düşer, çalışan izleme döngüleri kopar.
Tetikleyici sıradan: çıktısı büyük **herhangi bir** AWX işini görüntülemek.

### Düzeltme
1. `collectJobEventsStdout`'a **bayt bütçesi**: bütçe dolunca biriktirmeyi durdur
   ve çıktının sonuna **kırpıldığını açıkça yazan** bir satır ekle (sessiz kırpma yok).
   Kök düzeltme budur — string'i kaynağında sınırlar, tüm tüketicileri korur.
2. `output.split('\n')` yerine string üzerinde doğrudan regex — dizi ayırmadan.
3. `--max-old-space-size` **çözüm değil**, yalnızca ikinci kemer.

### Kabul ölçütü
- ~100 MB'lık sahte bir iş çıktısı ayrıştırılırken süreç **çökmüyor** ve heap
  kullanımı bütçeyle sınırlı kalıyor (ölçülen RSS ile kanıtlanır).
- Kırpma olduğunda kullanıcı bunu **görüyor**.
- Bekçi: bütçeyi kaldıran bir mutasyon testi **kırmızıya** düşürüyor.

---

## <a id="p0-2"></a>P0-2 — Denetim kaydı sessizce kayboluyor

**Sınıf:** hata · **Öncelik:** P0 · **Büyüklük:** M

### Kanıt
2026-09-18, 06:56 → 11:52 arasında **25 denetim yazımı başarısız**:

```
[ERROR] [audit:portal_audit_logs] write failed:
        The transaction log for database '...' is full due to 'LOG_BACKUP'
```

Yaklaşık **5 saatlik** bir pencerede denetim kaydı üretilemedi.

### Etki
Denetim kaydı bu portalda "kim neyi ne zaman yaptı" sorusunun tek cevabı ve
prod kesinti işlerini kapsıyor. Kayıt kaybı sessiz: yazan kod hatayı yutuyor,
kullanıcıya ve yöneticiye **hiçbir şey** görünmüyor.

### Düzeltme
DB yazımı başarısız olduğunda kayıt diske düşsün (append-only yedek dosya), DB
döndüğünde aktarılsın. Düşüş **görünür** olsun (sağlık ucu / admin ekranı).

### Kabul ölçütü
- DB yazımı bilerek düşürüldüğünde kayıt **kaybolmuyor** ve DB dönünce tabloya
  giriyor.
- Düşüş süresi ve kaç kaydın beklediği bir yerde **okunabiliyor**.

---

## <a id="p1-1"></a>P1-1 — ScaleX keşfi 64 sn sürüyor, önbellek yok

**Sınıf:** performans · **Öncelik:** P1 · **Büyüklük:** L

### Kanıt
Ölçüm (HAR): 2 cluster / 1 namespace keşfi **64 saniye** —
`POST /discover` 2,5 sn + AWX işi ~60 sn + yoklama aralığı 3–4 sn.
Üretim logunda **hiçbir ScaleX ucu** yavaş listesinde yok: portal tarafı hızlı,
sürenin tamamı AWX işinde.

Cluster başına ~32 sn ve cluster'lar **seri** koşuyor.

### Kök neden
Keşif sonucu **hiçbir yere yazılmıyor**; her açılışta sıfırdan AWX işi koşuyor.
Cluster içi en büyük kalem `load_extra_scalable_resources`: her API grubu için
**iki `oc get --raw`** → cluster başına **30–50 çağrı**. Bu çıktı (cluster'da
`scale` alt kaynağına sahip CRD listesi) **namespace'ten bağımsız ve aylarca
sabit**.

### Düzeltme
- Cluster düzeyi CRD listesi **önbelleğe** alınır.
- Uygulama listesi ve tipi zaten DB'den geliyor (`GET /apps`, envanter ∪ önbellek)
  ve ekran bunu keşfi beklemeden gösteriyor — **bu altyapı korunur**.
- Replica / HPA gibi **karar girdisi** alanlar **her zaman canlı**, ama yalnızca
  **seçilen uygulamalar** için hedefli okunur; tarama yok.
- Önbellek bayatsa iş yükü tipi haritası **gönderilmez** (`auto`'ya bırakılır):
  yanlış harita sessizce kabul edilmiyor, işi düşürüyor.
- Önbellek üç durumu ayırır: **yok / boş / okunamadı**.

### Kabul ölçütü
- Aynı kapsamda **ikinci açılış < 3 sn**.
- Ekran hangi verinin önbellekten (ve ne zaman alındığını), hangisinin canlı
  olduğunu **ayrı ayrı** söylüyor.
- Canlı alanların liste ucuna sızmasını yasaklayan mevcut bekçi **yeşil** kalıyor.

---

## <a id="p1-2"></a>P1-2 — Önizle → işaretle → uygula akışı eksik

**Sınıf:** UX · **Öncelik:** P1 · **Büyüklük:** M

### Kanıt (kod)
- Seçim **ad bazlı**, hedef bazlı değil: sihirbaz yalnızca uygulama adlarını
  tutuyor ve hedefler `uygulama × cluster` **çarpımı** olarak üretiliyor. Yani
  *"şu cluster'da uygula, ötekinde uygulama"* **bugün ifade edilemiyor**.
- Çalıştırma ucu önizlemeye **hiç referans vermiyor**; kapsamı sıfırdan çözüyor.
  "Gördüğün hâlâ geçerli mi" kontrolü yok.
- Önizleme cluster'a dokunmuyor; gösterilen replica sayıları **keşif anındaki**
  değerler.

### Etki
Kullanıcı 4 cluster'lık bir listede tek bir cluster'ı hariç tutamıyor; ya hepsi
ya hiçbiri. Ayrıca önizleme ile çalıştırma arasında HPA replica'yı değiştirmişse
kullanıcı **gördüğünden farklı** bir işlemi onaylamış oluyor.

### Düzeltme
Hedef bazlı seçim (cluster × uygulama onay kutusu) + önizlemede hedef başına
**canlı** durum + "seçilenleri uygula". Çalıştırma, önizlemenin gördüğü hedef
kümesini doğrular; ayrışma varsa **uygulamaz, söyler**.

### Kabul ölçütü
- İşaretlenmeyen hedef AWX'e giden değişkenlere **girmiyor** (bekçiyle kilitli).
- Önizlemeden sonra replica değişirse çalıştırma **uyarıyor**.

---

## <a id="p1-3"></a>P1-3 — Oturumsuz istemci yoklaması: ~9.700 gereksiz istek

**Sınıf:** performans · **Öncelik:** P1 · **Büyüklük:** S

### Kanıt
13 günde **17.166 WARN**'ın büyük çoğunluğu oturumsuz istek:

| uç | 401 sayısı |
|---|---|
| `/api/visibility/resolved` | 3.675 |
| `/api/visibility/version` | 3.006 |
| `/api/ansible/ss/smart-tickets/mine` | 854 |
| `/api/visibility/pages` | 670 |
| `/api/auth/me` | 670 |
| `/api/auth/prefs` | 669 |
| diğer (`users/online`, `ss/job-status`, …) | ~220 |

Ayrıca `403 GET /api/links` 427 kez.

### Etki
Oturumu düşmüş açık bir sekme sunucuyu saniyeler aralığıyla dövüyor. Hem boşa
CPU/DB hem de gerçek hataları gömen log hacmi.

### Düzeltme
- 401 alan yoklama döngüsü **durur** ve kullanıcıyı oturum ekranına yönlendirir.
- Sunucuda oturumsuz istek **WARN değil**: bu beklenen bir durum, hata değil.

### Kabul ölçütü
Oturumu dolmuş bir sekme 60 saniyede **≤ 2** istek üretiyor.

### Çözüldü (2026-09-22) — kapı döngülerin ALTINA kondu

PR #117 görünürlük yoklamasını `user` bağımlılığına bağlayarak durdurdu ama
`user` kapısı **olmayan** döngüler kaldı (örn. talep paneli `smart-tickets/mine`
ucunu 120 sn'de bir **koşulsuz** yokluyordu — 854 adet 401). Her döngüyü tek tek
yamamak whack-a-mole olurdu: bugün ondan fazla `setInterval` var ve gelecek ay
yazılacak on birincisi aynı hatayı geri getirirdi.

Bunun yerine tek bir kapı: oturumun bittiği bir kez anlaşıldığında `/api/*`
istekleri **ağa hiç çıkmaz**. Döngü dönmeye devam etse bile sunucuya tek bir
istek gitmez.

**Çıplak 401'e bakmak neden yanlış olurdu:** bu depoda 401 iki ayrı şey demek.
`server/ansible/runner.cjs` AWX hatasını `{ status: res.statusCode }` ile
sarıyor ve 22 route `res.status(err.status || 500)` yazıyor — yani **portalın
AWX token'ı düşerse tarayıcı 401 görür**. Çıplak duruma bakan bir kapı, AWX
token'ı dolduğunda portalı kullanan **herkesi** dışarı atardı. Bu yüzden oturum
401'leri — ve yalnızca onlar — sunucuda imzalanıyor; giriş denemesinin
başarısızlığı (yanlış parola) bilerek imzalanmıyor.

---

## <a id="p2-1"></a>P2-1 — Log gürültüsü: ERROR hacminin %95'i gerçek hata değil

**Sınıf:** gürültü · **Öncelik:** P2 · **Büyüklük:** S

### Kanıt
Toplam **2.430 ERROR**:

| kaynak | sayı | gerçek hata mı |
|---|---|---|
| `clientError ... ECONNRESET` | 1.322 | **hayır — ve gürültü de değil.** 2026-09-21 ölçümü: olayların %99'u iki Cumartesi 05:00'te yoğunlaşıyor, `HPE_INVALID_*` protokol hatalarıyla birlikte. Bu **haftalık zafiyet taraması**; alarm dışı bırakılmalı |
| MCP entegrasyonu bağlantı hatası | 838 | evet ama **tek** hata, 838 kez yazılıyor |
| `clientError ... HPE_INVALID_*` | 208 | hayır — bozuk HTTP (tarama/LB) |
| denetim yazımı (P0-2) | 25 | **evet** |
| MSSQL havuz | 12 | **evet** |
| AWX cancel 403 | 8 | **evet** |

Ayrıca bir TLS hazırlık satırı **açılış başına ~22 kez** yazılıyor (1.485 satır /
67 açılış).

### Etki
Gerçek hatalar (45 satır) gürültünün (2.385 satır) içinde kayboluyor.

### Düzeltme
Soket seviyesi hataları uygun seviyeye indir (ve örnekle); kapalı entegrasyon
için **geri çekilmeli** yeniden deneme + tekrar eden hatayı özetleyerek yaz;
TLS hazırlık satırını açılışta bir kez yaz.

### Kabul ölçütü
Aynı iş yükünde ERROR hacmi **%80+** azalıyor; yukarıdaki 45 gerçek hata
**kaybolmuyor**.

---

## <a id="p2-2"></a>P2-2 — Yavaş uçlar

**Sınıf:** performans · **Öncelik:** P2 · **Büyüklük:** M

### Kanıt (üretim ölçümü)

| uç | yavaş istek | ortalama | en fazla |
|---|---|---|---|
| `GET /jobs/N/output` | 98 | **20,8 sn** | 35,8 sn |
| `GET /jobs/N/status` | 302 | 2,5 sn | **77,5 sn** |
| `GET /data/NginxRateLimitInventory` | 80 | **11,5 sn** | 30,1 sn |
| `GET /api/ansible/awx/recent-jobs` | 112 | 4,2 sn | 25,0 sn |
| `GET /data/TruststoreCertificateInventory` | 117 | 1,4 sn | 17,0 sn |
| `GET /api/ansible/ss/job-status/N/N` | **2.446** | 0,6 sn | 5,5 sn |

### Düzeltme
`/jobs/N/output` P0-1 ile aynı kök. `ss/job-status` en yüksek hacim: yoklama
aralığı ve yanıt boyutu gözden geçirilir. Envanter sorguları için indeks/sütun
daraltma.

### Kabul ölçütü
Her uç için önce/sonra ölçüm; `[slow]` satır sayısı **yarıya** iniyor.

---

## <a id="p3-1"></a>P3-1 — MSSQL havuz hatası ve AWX cancel 403

**Sınıf:** hata · **Öncelik:** P3 · **Büyüklük:** S

12 × `MSSQL pool error — baglanti yeniden kurulacak` ve 8 × AWX iş iptalinde
HTTP 403. Düşük hacim; kök neden araştırması ve kullanıcıya dönen mesajın
netleştirilmesi.

---

## Yöntem notu

Bu belgedeki her sayı doğrudan log dosyalarından ölçüldü. **Bir ölçümüm yanlış
çıktı ve düzeltildi:** ilk okumada "crash loop" sandığım şey yanlış açılış
işareti saymaktan, "9 OOM" ise geniş bir desenden kaynaklanıyordu (bir TLS satırı her bağlantı denemesinde
yazılıyor, açılışta değil). Gerçek sayı **13 günde 67 yeniden başlatma** — günde
~5, medyan 94 dakika arayla — ki bu dağıtım temposuyla uyumlu ve **çökme döngüsü
değil**.
