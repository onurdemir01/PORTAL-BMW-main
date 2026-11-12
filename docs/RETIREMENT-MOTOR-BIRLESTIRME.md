# İki Motoru Birleştirme Planı (Etiket → Analiz)

> **Not (2026-11-11, plan sonrası düzeltme):** Planın 9/2 önerisi ("elle Yeni kayıt kapansın, her kayıt kapıdan geçsin") ekibin gerçek sürecine uymaz. Retirement, uygulama sahibinin açtığı **Smart silme kaydıyla** başlar; çoğu kayıt analizden gelmez. Bu yüzden kapı iki kaynaklı olmalı:
> - **ANALIZ kaynaklı kayıt** (Portal'ın "retire edilebilir" önerisinden): tam kapı. RETIRE_ADAYI + DOGRULANDI + imza + birebir hedef.
> - **SMART kaynaklı kayıt** (sahibin talebi): Smart numarası zaten zorunlu. Analiz kararı kayıt anında hesaplanır ve kayda yazılır. **KULLANIMDA ise kayıt açılmaz** (gerekçe + ikinci Admin onayıyla aşılabilir). KARAR_VERILEMEZ / SUPHELI ise kırmızı uyarı ve STOP öncesi ön kontrolde tekrar sorulur. Boş `targets` ile "bütün ortamlar" yolu iki kaynakta da kapanır.
>
> Sunucu tarafında bugün hiçbir karar denetimi yok (`server/retirement/index.cjs:460-506` elle doğrulandı): kayıt açma yalnız uygulama adı, Smart no ve PROD için OCO no ister.

> Salt okuma yapıldı, hiçbir dosya değiştirilmedi. Satır numaraları okuma raporlarından alındı. Kodda yeniden kontrol edilenler: `server/retirement/index.cjs:460-506`, `senaryo.cjs:252-273, :419-434, :504-510`, `retire-etiket.cjs:210-226, :271-301` ve `mssql-setup.cjs` içindeki `retirement_records` şeması. Çalıştırılarak kanıtlanmamış iddialar **(doğrulanmadı)** olarak işaretli.

## Plan seçimi (kısa)

| Plan | Güvenlik | Geri alınabilirlik | Efor | Kullanıcıya değer | Karara sadakat | Not |
|---|---|---|---|---|---|---|
| 1 Analiz-merkezli | 4/5 | 4/5 | 25-32 gün | Geç gelir (kapı Faz 4'te) | 5/5 | En ayrıntılı madde ve göç tasarımı |
| 2 Katmanlı | 4/5 | 4/5 | 24-31 gün | Orta | 4/5 | Ucuz ara yamaları var (seviye kontrolü, düğmeyi gizleme) |
| **3 Önce kapı** | **5/5** | **5/5** | 30-34 gün | **Asıl açık ilk kapanır** | 5/5 | Kapı önce gölgede, sonra zorunlu açılıyor; mod kodda sabit |

**Kazanan: Plan 3.** Diğer iki plandan alınanlar:
- Plan 2'den: ilk gün yapılabilecek iki ucuz önlem (Analiz düğmesini gizleme, Etiket'teki seviye açığını kapatma).
- Plan 1'den: madde eşlemesi, "artık içerik" birimi, `NESIL_BILINMIYOR` / `WAS_DEGERLENDIRILMEDI` maddeleri, `kaynak` alanı gelmeyen isteğin reddi ve rastgele değişmez testi (SN7).

---

## 1) Neden

Bugün iki motor aynı sunucu için farklı karar veriyor ve **hiçbiri sunucu tarafında kayıt açmayı engellemiyor**:
- `POST /api/retirement` karar, doğrulama ya da imza denetimi yapmıyor (`server/retirement/index.cjs:460-506`).
- `targets` boş gelirse uygulamanın **bütün ortamlarındaki** hedefleri alıyor (`:476-485`).

Somut örnek (doğrulanmadı): Server Hub'a göre trafiği olmayan, kapalı ve auto-start'ı açık bir JVM düşünelim.
- Etiket motoru buna **R1 KESIN** der ve DOGRULANDI işaretlenince "Retirement kaydı aç" düğmesi çıkar.
- Analiz motoru aynı JVM'in access log'unda gerçek trafik görür ve **KULLANIMDA** der.
- Bunun tersi de var: Analiz'deki "Retirement kaydı aç" düğmesi hiç doğrulama istemiyor (`RetirementAnaliziTab.tsx:892-905`).

## 2) Hedef durum

**Tek karar akışı.** Analiz, kopya kararlarını grup düzeyinde birleştirir. Elle kontrol (DOGRULANDI) bu grup kararına bağlanır. Kayıt açılırken sunucu kararı **yeniden hesaplar**.

```
Server Hub + Uygulama Envanteri + R1-R12 adayları + retireEngeli kodları
      → Analiz kopya kararı (jvm:/was:)
      → GRUP kararı  grup:<TABAN>|<ORTAM>|<NESIL>
      → Elle kontrol (imzaya bağlı)
      → Sunucu kapısı (POST /api/retirement)
```

**Karar dili (değişmiyor):** KULLANIMDA, RETIRE_ADAYI, SUPHELI, KARAR_VERILEMEZ, SORUN_YOK.

**Kontrol durumu:** BILINMIYOR, BEKLIYOR, VERI_DEGISTI, DOGRULANDI, YANLIS_ALARM.

**Grup birimi.** Bugünkü `app:TABAN` birimi PROD, TEST, QA ve nesilleri birleştiriyor. Bu yüzden kapı bu birime bağlanamaz; `app:` yalnız özet olarak kalır. Grup birimi Etiket'in `JVM|AD|ortam|gen` konusuna ve Retirement hedef anahtarı `host|app|gen`'e denk düşer.

**Kapı kuralı.** Kayıt yalnız şunların hepsi tutarsa açılır:
1. Grup kararı **RETIRE_ADAYI**.
2. Kontrol **DOGRULANDI**.
3. Kontrolün imzası = güncel imza = istekteki imza.
4. Hedef kümesi = grubun kopya kümesi (birebir).

Bunlardan biri okunamazsa kapı kapalı kalır.

## 3) R1-R12 → Analiz eşleme tablosu

**Admin seviyesinin yeni anlamı:**
- **KAPALI:** madde üretilmez.
- **SUPHELI:** madde ekranda görünür, karara etkisi yok.
- **KESIN:** madde DESTEKLER ağırlığı alır. Kararı en fazla SUPHELI'ye taşır, **asla RETIRE_ADAYI yapmaz.**

| Kural | Ne demek | Analiz'deki karşılığı | Yeni davranış |
|---|---|---|---|
| R1 | Kapalı + auto-start açık + trafik yok | JVM_KAPALI + WEB_TRAFIK_YOK + AUTOSTART_UYUMSUZ | Bileşik DESTEKLER madde. Aday olmak için Analiz'in kendi koşulları gerekir (güvenli eşleme, taze sıfır trafik). |
| R2 | Kapalı + auto-start kapalı + trafik VAR | WEB_TRAFIK_VAR + KIRIK_ZINCIR | Yalnız bilgi. Karar her zaman KULLANIMDA. Admin seviyesi bunu değiştiremez. |
| R3 `EAR_WAR_YOK` | EAR'da WAR yok | Karşılığı yok (EAR düğümü yok) | "Artık içerik / disk temizliği" listesi. **Kayıt açamaz.** |
| R4 `KOK_EAR_DISI` | Kökte .ear dışı girdi | Karşılığı yok | Artık içerik. Kayıt açamaz. `liste:kok_yoksay` aynen kalır. |
| R5 `EAR_JVM_YOK` | EAR hiçbir JVM'e bağlı değil | Karşılığı yok (`EAR_YOK` ters anlamlı) | Artık içerik. Kayıt açamaz. |
| R6 | Deployment adı diskteki EAR'la uyuşmuyor | Yok (`DEPLOY_SORUNU` bunu kapsamıyor) | Yeni madde `DEPLOY_AD_UYUSMAZ` (DESTEKLER). |
| R7 `REBOOT_RISK` | Çalışıyor + auto-start kapalı | AUTOSTART_UYUMSUZ'un bir kolu | Ayrı NOTR madde. |
| R8 `STOPPED_AUTOSTART_ON` | Kapalı + auto-start açık | AUTOSTART_UYUMSUZ'un diğer kolu | Ayrı NOTR madde. |
| R9 `KOPYA_TUTARSIZ` | Kardeş kopyalar tutarsız | Yok | NOTR madde (`j.capraz.kopya`). |
| R10 `ORTAM_KALINTISI` | PROD kapalı, non-prod çalışıyor | Yok | NOTR madde (`j.capraz.kalinti`). |
| R11 `OCP_KOPYASI` | Aynı uygulama OpenShift'te | OCP_TASINMIS | Birleşir. Başlık düzeltilir: madde OCP trafiği ölçülmeden de çıkıyor. |
| R12 `RETIRE_KAYDI_CELISKI` | Retire edilmiş ama geri dönmüş | RETIREMENT_KAYDI (NOTR) | **Çelişki.** Grubu KARAR_VERILEMEZ'e kilitler. EAR biçimi artık içerik listesine gider. |

**Analiz'e eklenecek engeller (EKSIK maddeleri, Admin kapatamaz):**
- Etiket'in `retireEngeli` kodları: STALE, LEGACY, WEB_TIER, MAPPING, NO_V2, UNATTRIBUTED (`assess.cjs:1142-1183`)
- `NESIL_BILINMIYOR`
- `WAS_DEGERLENDIRILMEDI`
- `KAPSAM_DISI_KOPYA`: envanterde olup grafikte olmayan kopya
- `SEVIYE_OKUNAMADI`

## 4) Fazlar

| Faz | Ne yapılır | Kullanıcı ne görür | Geri alma | Gün |
|---|---|---|---|---|
| **0 Acil önlem** | (a) Analiz'deki doğrulamasız "Retirement kaydı aç" düğmesi gizlenir. SN3 ve RN2 testleri ters çevrilir. (b) Etiket ara yaması: `retirementHazir` hesabına `kayit.seviye === seviye` eklenir. Böylece SUPHELI iken verilmiş bir onay, kural sonradan KESIN'e çekilince kapıyı açamaz (`retire-etiket.cjs:301`; değer `retire-kontrol.cjs:32`'de zaten okunuyor). | Analiz'de düğme yerine "Kayıt için doğrulama gerekli" yazısı. | Tek commit revert | 1 |
| **1 Analiz açıkları** | ZAYIF eşlemeli vhost'taki trafik KULLANIMDA sayılır (`senaryo.cjs:252-273`). `retireEngeli` kodları EKSIK maddesi olur. WAS kopyaları değerlendirmeye bağlanır; bağlanamayan WAS kopyası aday olamaz. Web ve IP düğümündeki çelişkiler (VHOST_KAPSAMI, WEB_CALISMA, IP_ENVANTERI) kopyayı kilitler. Bilinmeyen nesil `?` olarak yazılır ve aday olamaz. Ölü GRUP_BOS maddesi bağlanır ya da silinir. | Bazı RETIRE_ADAYI kararları SUPHELI ya da KARAR_VERILEMEZ'e düşer. Önceki ve sonraki sayılar faz notunda verilir. | Revert; DB değişikliği yok | 3-4 |
| **2 Grup + kontrol deposu** | `grup:TABAN\|ORTAM\|NESIL` kararı ve `/iliski/karar?anahtar=grup:…` ucu. Yeni tablolar `server_hub_karar_kontrol` ve append-only `_gecmisi`. `PUT /iliski/kontrol` ucu: DOGRULANDI **yalnız RETIRE_ADAYI iken** yazılabilir, değilse 409. İmza eskiyse 409, tablo okunamazsa 424. | Analiz'de grup satırları ve kontrol formu (Etiket'teki form taşınır). | Revert; yeni tablolar boş kalır | 4-5 |
| **3 Sunucu kapısı** | `POST /api/retirement` 6. bölümdeki kuralları uygular. `retirement_records` tablosuna iz kolonları eklenir. Önce `KAPI_MODU='GOLGE'`: kapı yalnız "engellenirdi" kaydı yazar (`op:'kapi_golge'`). 3-5 gün sonra `'ZORUNLU'`. Mod **kod sabitidir, DB ayarı değildir.** Yönlendirme dize karşılaştırması yerine `tur:'retirement_ac'` koduna geçer. Öneriyle açılan formda hedefler kilitlenir. | Kayıt yalnız Analiz'de doğrulanmış gruptan açılır. Etiket düğmesi "Analiz'de doğrula" yönlendirmesine döner. | Mod GOLGE'ye alınır ya da revert; kolonlar NULL kabul ettiği için kalabilir | 6-7, +3-5 gün gölge |
| **4 Karşılaştırma raporu** | `GET /iliski/golge-karsilastirma` ucu ve günlük özet tablosu. Sınıflar: KRITIK_A_KESIN_B_KULLANIMDA, A_KESIN_B_KARARSIZ, B_ADAY_A_YOK, B_ADAY_A_ENGEL, A_ONLY_EAR_GIRDI, ANAHTAR_ESLENEMEDI, UYUM. | Admin'e salt okunur "Karşılaştırma" görünümü. | Revert | 3, +en az 2 hafta gözlem |
| **5 R1-R12 + Admin seviyesi + göç** | 3. bölümdeki eşleme uygulanır. `etiket:R*` ayarları yeni anlamla okunur. R seviyeleri imzaya girer. Eski kontroller bilgi olarak taşınır (5. bölüm). | Analiz'de "Kural bulguları (R1-R12)" bölümü; KAPALI kurallar soluk görünür. | Revert; ayar anahtarı aynı kaldığı için eski kod aynı satırları okur | 6-7 |
| **6 Arayüz tek kaynak** | Etiket kartı, sütun ve "retire adayı" çipi **aynı commit'te** Analiz kararına geçer: `sunucuOzet.ts:73-84`, `Uygulama360Tab.tsx:102-120`, `uygulama360.ts:13-16,46`, SunucuPaneli bölümleri. HostsTab ve Ayrıntı girişlerine de `onRetirementAc` verilir. Not etiketleriyle karışmasın diye R kuralları "kural bulgusu" adını alır. `KurallarTab` metnine "KESIN tek başına kayıt açtırmaz" eklenir. | Her ekranda tek bir "retire adayı" sayısı. | Revert; sunucu kapısı yerinde kalır | 5-6 |
| **7 Etiket motorunu kaldırma** | Önce 2 hafta boyunca eski yazma ucu 410 döner ve eski uç çağrıları audit'te sayılır. Sonra `retire-etiket.cjs`, `retire-kontrol.cjs`, `retire-uclar.cjs`, `RetireEtiketleri.tsx` ve `retireEtiket.ts` silinir. `assess.cjs` içindeki R üretimi **kalır**, çünkü Analiz'in girdisi. | Eski etiket ekranı kalkar. | Revert; veri yerinde | 2-3, +2 hafta |

**Toplam:** yaklaşık **30-36 iş günü** ve **4-5 hafta takvim**.

**Kritik yol:** 0 → 1 → 2 → 3, sonra 4 ile 5 paralel, ardından 6 → 7. Faz 0 ilk gün çıkabilir.

## 5) Veri taşıma

| Veri | Ne olur |
|---|---|
| `server_hub_retire_kontrol` (Portal DB) | `JVM\|AD\|ORTAM\|GEN` anahtarı `grup:tabanAd(AD)\|ORTAM\|GEN`'e eşlenir. Yeni tabloya **"önceki kontrol" bilgisi** olarak yazılır, imza geçersizdir. **Hiçbir kayıt DOGRULANDI olarak taşınmaz;** hepsi VERI_DEGISTI / BEKLIYOR başlar. YANLIS_ALARM işaretlileri de listeye geri döner. EAR ve GIRDI kayıtları artık içerik listesine bağlanır. Eşlenemeyenler öksüz raporunda sayıyla gösterilir. |
| `server_hub_retire_kontrol_gecmisi` | Silinmez. Yeni geçmişte `eski_anahtar` alanıyla ve bir GOC satırıyla bağlanır. |
| `server_hub_ayarlar` `etiket:R1..R12`, `liste:kok_yoksay` | **Anahtar adları değişmez.** DB'deki satır koddaki varsayılanı ezer; adı değiştirmek Admin'in seçimlerini sessizce siler. Anlam 3. bölümdeki gibi değişir. |
| `server_hub_ayar_gecmisi` | Dokunulmaz. |
| `server_hub_gorunumler` (`ekran='retirement-etiketleri'`) | Kalır (yetim satır zararsız). İstenirse kolonlar eşlenerek yeni ekrana kopyalanır. |
| localStorage `ear-tablo:retire-etiketleri` | Taşınmaz; yalnız kolaylık amaçlı. |

Göç betiği idempotenttir, önce kuru koşu yapar ve düz SQL olarak hedef **Portal DB**'dir (TBMWANS değil). DELETE ya da DROP yok. Etiket'in kontrol tabloları kalıcı salt okunur arşiv olur.

## 6) Güvenlik kapısı (sunucuda zorunlu)

**Kural metni:** "Retirement kaydı yalnız Analiz'in grup kararı RETIRE_ADAYI olan, bu kararın güncel kanıt imzasıyla DOGRULANDI işaretlenmiş ve hedefleri bu grubun kopyalarıyla birebir aynı olan bir istekten açılır. Kanıt değiştiyse ya da herhangi bir kaynak okunamıyorsa kayıt açılmaz."

`POST /api/retirement` için kontrol sırası:
1. İstekte `kaynak` yoksa **400**. Bu, eski istemcinin kapıyı atlamasını önler. `kaynak:'ANALIZ'` için `kararAnahtari` ve `kararImza` zorunlu.
2. Karar önbelleği atlanarak taze hesaplanır. Hesap, kontrol tablosu ya da ayar okunamazsa **424**.
3. Şunlardan biri tutmazsa **409** ve gövdede neden kodu:
   - karar RETIRE_ADAYI değil
   - kontrol DOGRULANDI değil
   - imza uyuşmuyor (gövdede güncel imza döner)
   - `app` grubun TABAN'ı değil
4. **Kapsam kilidi:**
   - `targets[]` zorunlu.
   - (host, app, gen) kümesi grubun kopya kümesine **eşit** olmalı.
   - `discover(app)` sonucunda aynı ortam ve nesilde olup grafikte bulunmayan bir hedef varsa **409**.
   - Boş `targets` ile "hepsini al" yolu kapatılır.
5. Kontrol satırı, kaydı açan INSERT ile aynı transaction içinde `UPDLOCK` ile yeniden okunur.
6. İz kolonları NULL kabul eder: `kaynak`, `karar_anahtari`, `karar_imza`, `karar_ozeti` (JSON), `dogrulayan`, `dogrulama_zamani`. Aynı alanlar audit detayına (`index.cjs:507`) ve `created` olayına da yazılır.

**Kontrol imzası:** sha256. Sayı ve tarih **girmez** (Etiket'teki ilke). İmzaya girenler:
- grup anahtarı ve grup kararı
- her kopya için: anahtar, karar, sıralı madde kodları, vhost anahtarları ve her birinin ölçümü (VAR/YOK/OLCULEMEDI), eşleme gücü, çalışma durumu, auto-start, tazelik, çağıran var/yok
- discover hedef kümesi
- R kurallarının etkin seviyeleri
- `retireEngeli` kodları

Bugünkü not imzası (`notlar.cjs:452-465`) bu iş için fazla kaba; kullanılmaz.

## 7) Test ve bekçiler

**Korunacak değişmezler (zayıflatılamaz):**
- SN1, SN2, SN5: kullanım kanıtı her zaman kazanır; bayat sıfır trafik "ölçülemedi" sayılır.
- NT6: not kararı değiştirmez.
- AR4, RA1, C6: bilinmeyen değer asla yeşil görünmez.
- IG9.
- v2-güvenlik: D1-C17, D1-C19, EK-3, T3-C6.
- RE5c'nin birleşik karşılığı: bağlı JVM çalışıyorsa aday yok.

**Yeni bekçiler ve mutasyonla körlük testi:**

| Kod | Bekçi | Mutasyon (test kırmızıya dönmeli) |
|---|---|---|
| G1 | Kontrolsüz aday, SUPHELI+DOGRULANDI, KARAR_VERILEMEZ+DOGRULANDI, YANLIS_ALARM ve VERI_DEGISTI durumlarında POST → 409 | Kapı çağrısı silinir |
| G2 | Eski imza → 409; kanıt değişince VERI_DEGISTI | İmza karşılaştırması silinir |
| G3 | Başka ortamdan hedef, grafikte olmayan hedef ya da boş `targets` → 409 | Kapsam kontrolü silinir |
| G4 | Hesap, kontrol ya da ayar okunamazsa → 424 ve `kayitHazir=false` | Fail-closed dalı silinir ya da varsayılana dönülür |
| G5 (SN7) | 400+ tohumlu rastgele senaryo, R1-R12 seviyelerinin her kombinasyonunda: SN2 engelleri varken RETIRE_ADAYI yok; kullanım varken KULLANIMDA | R maddesi RETIRE_ADAYI koşuluna eklenir |
| G6 | KESIN vhost'ta sıfır trafik + ZAYIF vhost'ta trafik VAR → KULLANIMDA | Zayıf vhost `trafikVar`'dan çıkarılır |
| G7 | Her `retireEngeli` kodu, WAS değerlendirilmemiş, nesil `?` → aday değil | Ilgili EKSIK satırı silinir |
| G8 | Taşınan eski DOGRULANDI kapıyı açmaz | Göç imzayı aynen kopyalar |
| G9 | İmza sayı ve tarihe duyarsız; kopya, ölçüm, seviye ve madde değişikliğine duyarlı | Seviye imzadan çıkarılır |
| G10 | Yayılan notlar (`dogrudan=false`), `veriDegisti` ve BILINEN notu kapıyı etkilemez | — |
| G11 | SN3 ve RN2 ters: yönlendirme ya da düğme yalnız DOGRULANDI ile | — |
| G12 | `etiket:R1=KAPALI` satırı varken R1 maddesi üretilmez | — |

**Kurallar:**
- Mutasyon geri alındıktan sonra `git diff --quiet` ile dosyanın orijinaliyle birebir aynı olduğu doğrulanır.
- Bekçilerde yol ayracına bağımlılık, `npx` ya da canlı ağaca probe olmaz.

**Kabul ölçütü:**
- Sunucu testleri: bilinen 6 platform kırmızısı (EA1, EE15, FA5, EW8, EA7, EA10) dışında yeni kırmızı yok.
- UI testleri: 267/267 artı yeni testler.

**Güncellenecek testler:**
- RE7 ve RE10 → yeni kontrol ve kapı testleri.
- RA2, RA3, RA4, RA12, SO2, U4, U5, UA4, UA5, KR4.
- `analiz-rozeti.test.tsx:224-226` ve `bmw-hub-sekmeler.test.tsx:109`.

## 8) Riskler

1. **Bugün açık olan kapı:** Faz 3 ZORUNLU olana kadar doğrudan API çağrısı ya da elle form kayıt açabilir. Faz 0 bu açığı yalnız arayüzde daraltır.
2. **Aday sayısı azalacak.** Bugün Etiket'te KESIN+DOGRULANDI olan bazı uygulamalar artık kayıt açamayacak. Örnekler: web eşlemesi olmayan kapalı JVM (SN1'e göre SUPHELI), Faz W log trafiği, web dışı çağıran, CALISMA_DINLEME çelişkisi, ZAYIF WEB_APP eşlemesi (doğrulanmadı). Bu güvenli yönde bir değişiklik.
3. **WAS retirement'ı fiilen durabilir.** WAS kopyalarının değerlendirmesi kurulamazsa (bugün `jvmAssess` yalnız JVM'le doluyor) kapı kapalı kalır.
4. **Bütün eski onaylar yeniden istenecek.** Admin'e sayıyla önceden duyurulmalı.
5. **Nesil `0` / `?` farkı** aynı JVM'i iki kopya olarak sayabilir (doğrulanmadı). `NESIL_BILINMIYOR` maddesi bunu kapıda durdurur.
6. **Geçişte çift sayı:** Faz 6 tek commit'te yapılmazsa ekranlarda iki farklı "retire adayı" sayısı görünür.
7. **Performans:** R maddeleri eklenince IG10 bütçesi (3000 sunucu ≤ 1,5 sn) yeniden ölçülmeli.
8. **Gürültü:** 6 platform kırmızısı yeni bir kırmızıyı gizleyebilir. Kabulde testler adlarıyla eşlenmeli.

## 9) Karar bekleyen sorular

1. **Analiz'deki doğrulamasız "Retirement kaydı aç" düğmesi bugün (Faz 0) gizlensin mi?** Önerim: **Evet.** Tek satırlık, geri alınabilir bir değişiklik.
2. **RetirementTab'daki elle "Yeni kayıt" (Server Hub önerisi olmadan) ne olsun?** Önerim: **kapansın.** Bütün kayıtlar kapıdan geçsin. İstisna gerekirse ancak `kaynak=ELLE`, en az 20 karakter gerekçe, ikinci Admin onayı ve kırmızı rozetle.
3. **Karar birimi `uygulama + ORTAM + NESIL` olsun mu?** Önerim: **Evet.** Bir uygulamanın bütün ortamlarını retire etmek için her grup ayrı ayrı doğrulanır. Ek bir sıra kuralı (örneğin "DEV doğrulanmadan PROD açılamaz") şimdilik yok.
4. **Kayıt grubun tamamı için mi açılsın, yoksa bir alt küme (tek host) için de mi?** Önerim: **Yalnız grubun tamamı.** Alt küme gerekirse grup yeniden doğrulanır.
5. **R3, R4, R5 ve EAR biçimli R12 nereye gitsin?** Önerim: **Ayrı "artık içerik / disk temizliği" listesi, kayıt açamaz.** Grafiğe `ear:` / `girdi:` düğümü eklemek ayrıca 5-8 gün tutar.
6. **Etiket'in `retireEngeli` kodları (WEB_TIER, NO_V2, UNATTRIBUTED vb.) RETIRE_ADAYI'yı engellesin mi?** Önerim: **Evet.** Aday sayısı azalır ama yanlış retire riski kapanır.
7. **Değerlendirilemeyen WAS kopyaları kapıyı kapatsın mı?** Önerim: **Evet.** Önce bugün WAS uygulamaları için kayıt açılıp açılmadığına bakılmalı; açılıyorsa Faz 1'deki WAS bağlantısı öne alınır.
8. **Admin'in KESIN seviyesi kalsın mı?** Önerim: **Kalsın.** Anlamı "DESTEKLER ağırlığı, kayıt kapısını açmaz" olur ve bu KurallarTab'da açıkça yazar.
9. **R2 ekranda kalsın mı?** Önerim: **Yalnız bilgi maddesi olarak kalsın.**
10. **Kapı modu (GOLGE / ZORUNLU) yalnız koddan mı değişsin?** Önerim: **Evet.** DB anahtarı olmasın, çünkü eski DB satırı koddaki varsayılanı ezebilir.
11. **Gölge süreleri ve çıkış eşiği?** Önerim:
    - Kapı gölgesi 3-5 iş günü.
    - Karşılaştırma raporu en az 2 hafta ve en az 2 Uygulama Envanteri tarama döngüsü.
    - Çıkış eşiği: açıklanmamış KRITIK ve B_ADAY_A_ENGEL satırı = 0; B_ADAY_A_YOK satırlarının hepsi elle incelenmiş.
12. **Eski kontrol tabloları ne olsun?** Önerim: **Kalıcı salt okunur arşiv.** Silinmesin.