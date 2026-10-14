# ScaleX — onay kapıları

ScaleX production'da bir uygulamayı durdurabilir. Bu belge, bir isteğin **hangi kapılardan
geçtiğini**, kapıların **nereden yönetildiğini** ve bir şey ters gittiğinde **neye
bakılacağını** anlatır. Genel mimari için: [SCALEX.md](SCALEX.md).

## Neden yazıldı

2026-10-13'te prod'da doğru OCO numarası giren kullanıcılar hata aldı. OCO geçiyordu; ScaleX
için SMART onay ayarı hiç tanımlanmamıştı ve sunucu bu durumda bilerek reddediyordu. Üç şey
üst üste bindi:

1. Ret **OCO'dan sonra** geliyordu: kullanıcı numarayı girip doğrulatıyor, sonra duvara
   çarpıyordu.
2. Ret **503** ile dönüyordu. Kurumsal ters-proxy 5xx gövdelerini değiştirdiği için ekran
   açıklama yerine "portal yeniden başlatılıyor, tekrar deneyin" yazdı.
3. Önizleme, SMART'ın tanımlı olup olmadığını **bilmiyordu** ve "SMART kaydı açılacak" diyordu.

Aynı incelemede, SMART tanımlansaydı bile çalışmayacak dört şey bulundu (bilet biçimi, ekranın
"onay bekleniyor" yanıtını okuyamaması, zamanlanan işin onaysız çalışabilmesi, zamanlanan işin
portalda iz bırakmaması). Hepsi bu sürümde kapandı.

## Karar tablosu

Kapılar yalnızca **değişiklik yapan** (`Uygula`) çalıştırmalarda devrededir. `Önce kontrol et`
hiçbir kapıdan geçmez. Ortam bilinmiyorsa production sayılır.

| Ortam      | İşlem             | OCO                                   | SMART                        |
| ---------- | ----------------- | ------------------------------------- | ---------------------------- |
| herhangi   | Önce kontrol et   | yok                                   | yok                          |
| prod dışı  | hepsi             | yok (admin ortam listesine eklemediyse) | yok                        |
| production | Durdur / Ölçekle  | numara + pencere denetimi             | aşağıdaki kurala göre        |
| production | Geri Al           | sorulmaz; **gerekçe zorunlu**         | aşağıdaki kurala göre        |

Production'da SMART, sırayla şu dört soruya göre belirlenir (ilk "evet" kazanır):

| # | Soru                                                        | Sonuç                                   | Denetim kaydı                  |
| - | ----------------------------------------------------------- | --------------------------------------- | ------------------------------ |
| 1 | SMART kuralı anahtarı "gerekli değil — yalnız OCO" mu?      | SMART istenmez                          | `scalex_smart_gate_disabled`   |
| 2 | İsteği yapan, kişisel "SMART atla" tercihi açık bir Admin mi? | SMART istenmez (OCO yine sorulur)     | `smart_onayi_admin_atladi`     |
| 3 | SMART ayarındaki bir **istisna kuralı** isteği kapsıyor mu? | SMART istenmez                          | `scalex_smart_skipped_by_rule` |
| 4 | SMART ScaleX için **kullanıma hazır** mı?                   | hazır → kayıt açılır, onay beklenir     | `selfservice_smart_ticket_open` |
|   |                                                             | hazır değil → **iş başlamaz** (409)     | `scalex_gate_decision`         |

"Kullanıma hazır" dört parçanın dördü demektir: SMART onayı ScaleX şablonu için açık, Flow Key
dolu, alan eşlemesi (metadata) dolu, SMART bağlantı ayarları (Admin > Sistem) girilmiş.

### Sıra

1. SMART gerekli ama hazır değilse istek **hemen** reddedilir. OCO servisi sorulmaz, hiçbir
   kayıt açılmaz. Önizleme aynı engeli aynı metinle baştan gösterir; ekran OCO numarası istemez.
2. OCO: numara → kayıt bulundu mu → planlanan kesinti tarihi var mı → pencere açık mı.
3. SMART kaydı açılır (gerekiyorsa). İş, onay verilince başlar. Onaydan sonra işi ortak
   başlatma yolu başlatır ve bu yol AWX şablonunun "Prompt on launch" ayarına bakmaz. Bu
   yüzden ayar **kayıt açılmadan önce** denetlenir. Kapalıysa istek 409
   `awx_prompt_on_launch_disabled` ile reddedilir; SMART kaydı açılmaz, OCO sorulmaz.

### OCO penceresi henüz açılmadıysa

- SMART **devrede değilse** ekran "pencere açılınca otomatik başlat" seçeneğini sunar. Kayıt
  portalda tutulur, "Zamanlanmış işlemler" panelinden iptal edilebilir ya da OCO numarası
  değiştirilebilir. İş başlayınca uzlaştırıcı onu tanır; sonucu normal bir iş gibi kaydedilir.
- Pencere saatinde işi ScaleX değil, ortak OCO zamanlayıcısı başlatır ve AWX'e anlık
  başlatmayla **aynı** değişkenleri gönderir. O yol AWX şablonunun "Prompt on launch"
  ayarına bakmadığı için bu ayar **zamanlama anında** denetlenir. Ayar kapalıysa kayıt
  açılmaz ve istek anlık başlatmadaki hatanın aynısıyla (409
  `awx_prompt_on_launch_disabled`) reddedilir.
- Pencere saatinde AWX yanıt vermezse iş **yeniden denenmez**; aynı iş iki kez başlamasın
  diye kayıt "Başarısız" olur ve işlem satırları kapanır.
- SMART **devredeyse** zamanlama sunulmaz; pencere açıldığında işlem yeniden başlatılır.
  Sebep "Bilinen sınırlar"da.

## SMART kuralı anahtarı

**Admin > ScaleX Yönetimi > Onay kapıları** kartının en üstünde, iki seçenek:

- **Gerekli** (varsayılan). SMART hazır değilse production değişiklikleri başlamaz.
- **Gerekli değil — yalnız OCO.** SMART kaydı açılmaz; OCO denetimi aynen sürer.

Tek tıkla değişir, yeniden başlatma gerekmez. Değişiklik önceki ve yeni değerle denetime
`scalex_smart_mode_changed` olarak yazılır. Kart, **sıradan bir kullanıcının bugün ne
göreceğini** tek cümleyle söyler ve SMART tanımının hangi parçasının eksik olduğunu listeler.

Aynı ayar `SCALEX_PROD_SMART_MODE` (`required` | `oco_only`) olarak Admin > Sistem'de ve
`.env`'de de durur. Boş ya da tanınmayan değer `required` sayılır: yazım hatası kapıyı açmaz.

### Ekranlar aynı kararı gösterir

Kullanıcıya kuralı söyleyen her yer sunucunun **aynı çözücüsünden** (`resolveGatePolicy`)
okur; sabit cümle yoktur:

| Yer | Uç | Ne zaman |
| --- | --- | --- |
| Kapsam adımı (ortam / tenant / cluster seçilince) | `GET /api/scalex/gate-summary` | seçim değişince |
| "Şu an durdurulmuş" › Tümünü geri al | `GET /api/scalex/gate-summary` (`restore`) | kutu açılınca |
| İşlem ve onay adımı | `POST /api/scalex/preview` | seçim tamamlanınca (kesin karar) |
| Admin kartı | `GET /api/scalex/admin/gate-status` | kart açılınca / ayar kaydedilince |

Anahtar, SMART tanımı, OCO ortam listesi, istisna kuralları ve yöneticinin kendi "SMART atla"
tercihi değiştiğinde ekranlar yeniden başlatma olmadan yeni kuralı gösterir. Kapsam adımında
namespace ve işlem henüz seçilmemiştir: bunlara bağlı bir istisna kuralı varsa ekran "kesin
karar önizlemede" der. Eskiden kapsam adımı her durumda "SMART kaydı açılacak, birden fazla
cluster seçtiysen ikinci kişi onayı istenir" yazıyordu; ikinci kişi onayı sunucuda hiç yoktu.

Admin › Sistem'deki ScaleX sayıları da aynı kurala uyar; ekran kendi sayısını tutmaz:

| Ekrandaki sayı | Kaynağı |
| --- | --- |
| Kapatmada "şu süre içinde 0 olmazsa başarısız sayılır" (önizleme) | `/preview` `verification.failSeconds`: AWX'e giden `verify_fail_seconds` ile aynı hesap (`SCALEX_VERIFY_FAIL_MULTIPLIER`) |
| Aynı cümle, İşlem adımı › Gelişmiş | `/config` `verificationTimeout.failMultiplier`; ayar okunamazsa süre yazılmaz |
| "Tek işlemde izin verilen sınır (N hedef)" | `/preview` `blastRadius.maxTargets` (`SCALEX_MAX_TARGETS`) |
| "Prod'da N hedefin üstü yazılı onay ister" | `/preview` `blastRadius.writtenConfirmThreshold` (`SCALEX_PROD_CONFIRM_THRESHOLD`) |
| Bekleme süresi varsayılanı ve aralığı | `/config` `verificationTimeout` |
| İş geçmişi "UNKNOWN … saat beklendi" | `/history` `unknownAfterHours` (`SCALEX_RECONCILE_STALE_HOURS`) |
| "Durumu tazele" kapsam ve namespace sınırı | `/config` `maxAuditGroups`, `maxAuditNamespaces` (`SCALEX_MAX_AUDIT_GROUPS`, `SCALEX_MAX_AUDIT_NAMESPACES`) |

Namespace sınırını sunucu da uygular: `/discover` (ve ScaleX'in kapsam alan her ucu) sınırı
aşan ya da biçimi geçersiz bir namespace listesini, yetki sorgusu yapmadan ve AWX işi
başlatmadan `400` ile reddeder. Uygulama listesinin de sert bir üst sınırı vardır (hedef
tavanının admin'in de aşamadığı değeri, 2000).

## SMART'ı tanımlamak

Aynı karttaki **SMART / OCO ayarlarını düzenle** düğmesi ayar penceresini açar.

1. "Smart onayı gerekli"yi açın, **Flow Key**'i girin.
2. "Alanları Getir" ile akışın alan adlarını (ElementName) alın.
3. **Alan eşlemesi**ni yazın: satır başına `ElementName: değer`. Değerde şu değişkenler
   kullanılabilir (pencere bunları örnek değerleriyle listeler):

   | Değişken                 | İçerik                                             |
   | ------------------------ | -------------------------------------------------- |
   | `{{scalex.ozet}}`        | işlemin tek cümlelik özeti                         |
   | `{{scalex.islem}}`       | Durdur / Geri Al / Ölçekle                         |
   | `{{scalex.ortam}}`, `{{scalex.tenant}}` | ortam ve tenant                     |
   | `{{scalex.clusterlar}}`, `{{scalex.namespace}}`, `{{scalex.uygulamalar}}` | kapsam |
   | `{{scalex.hedefSayisi}}`, `{{scalex.hedefReplica}}` | hedef sayısı; ölçeklemede hedef replica |
   | `{{scalex.gerekce}}`, `{{scalex.oco}}` | gerekçe ve OCO numarası              |
   | `{{scalex.talepEden}}`, `{{username}}`, `{{email}}` | isteği yapan            |

4. "Önizle" ile sonucu görün, kaydedin. Kart "SMART'a gidecek alanlar"ı örnek bir işlemle
   gösterir; şablonda tanımsız bir değişken varsa hatayı adıyla söyler.

**İstisna kuralı** (aynı penceredeki "şu durumda onay isteme" alanı) ScaleX'te de geçerlidir.
Eşleşebilen alanlar: `action` (`stop` / `restore` / `scale`), `namespace`, `tenant`, `env`,
`cluster_count`. Örnek: `action: restore` — geri alma SMART beklemeden başlar. Kural eşleşen
istek ekranda "SMART istisna kuralı" olarak görünür ve denetime yazılır. Kural alanları
sunucuda üretilir; isteğin gövdesine alan ekleyerek tetiklenemez.

## Hata kodları

Bilerek verilen her ret **4xx**'tür ve gövdede `message` taşır. Asıl kaynak bir 5xx ise
`upstreamStatus` alanında durur.

| Durum | `code`                           | Anlamı                                               |
| ----- | -------------------------------- | ---------------------------------------------------- |
| 400   | —                                | OCO numarası / gerekçe / yazılı onay eksik ya da OCO reddi |
| 409   | `smart_not_configured`           | SMART gerekli ama hazır değil (`missing` eksikleri sayar) |
| 409   | `scalex_not_configured`          | ScaleX şablonu Playbook Kayıtları'nda tanımsız        |
| 409   | `awx_prompt_on_launch_disabled`  | AWX şablonunda "Prompt on launch > Variables" kapalı  |
| 409   | `restore_in_progress`            | aynı hedef için geri alma sürüyor                     |
| 409   | `schedule_needs_admin_cancel`    | kayıt AWX zamanlayıcısında / SMART onayında; Admin iptali gerekir |
| 409   | `gate_inconsistent`              | SMART gerekli dendi ama kayıt açılmadı; iş başlatılmadı |
| 409   | — (`upstreamStatus` dolu)        | ortak kapı 5xx döndü (ör. SMART talebi açılamadı)     |
| 424   | `awx_unreachable`                | AWX başlatma isteğine yanıt vermedi                   |

Durum yoklama uçları (`…/status`) bu çevrimin dışındadır: geçici hata 5xx olarak kalır ve
ekran sınırlı sayıda yeniden dener.

## Canlıya alma

Bu sürüm AWX tarafında **hiçbir şey değiştirmez** (playbook ve `scalex_runner.sh` aynı);
kopyalama gerekmez.

1. Sürüm çıktıktan sonra production'da durum **aynıdır**: SMART tanımlı değilse değişiklik
   başlamaz. Fark, ekranın bunu OCO numarası istemeden söylemesidir.
2. **Admin > ScaleX Yönetimi > Onay kapıları**nı açın. Kartın ilk satırı kullanıcıların bugün
   ne gördüğünü yazar.
3. İki yoldan biri:
   - SMART'ı tanımlayın (yukarıdaki adımlar). Kart "SMART kaydı açılır ve onay beklenir" der.
   - Anahtarı "Gerekli değil — yalnız OCO"ya alın.
4. İlk gerçek işlemde bakılacaklar:
   - Önizlemedeki rozetler beklediğinizi söylüyor mu (`OCO: numara istenecek`, `SMART: …`).
   - SMART yolunda: kayıt Smart'ta açıldı mı, alanlar dolu mu; ekran "SMART kaydı açıldı
     (numara)" yazıyor mu; onaydan sonra iş "İş geçmişi"nde `RUNNING` → `FINISHED` oldu mu.
   - Durdurma bittikten sonra uygulama "Şu an durdurulmuş" panelinde görünüyor mu.
   - Admin > Denetim'de `scalex_` süzgeciyle izler.

## Bilinen sınırlar

- **SMART devredeyken zamanlama yok.** Ortak kapıda onay sonrası iş AWX'in kendi zamanlayıcısına
  devrediliyor; portal o işin numarasını öğrenemiyor ve portaldan iptal AWX'teki zamanlamayı
  silmiyor. ScaleX bu yolu kullanmaz.
- **Gerçek SMART talebi yerelde açılamaz.** Biletin biçimi ve şablon testle ölçülür; ilk gerçek
  talep kanaryadır.
- **Zamanlanan işte kapı kararı zamanlama anında donar.** Kayıt açıldıktan sonra anahtar
  değişse de iş zamanlandığı kararla çalışır. Kayıt görünür ve iptal edilebilir.
- **"Prompt on launch" istekten sonra kapatılırsa iş başlar ama hemen iptal edilir.** Ayar
  istek anında (zamanlama ya da SMART kaydı açılırken) denetlenir. Pencere saatine ya da
  onaya kadar ayar kapatılırsa, AWX işi kabul eder ama değişkenleri yok sayar. Ortak başlatma
  yolu yalnız ScaleX'in açtığı korumayla (`yutmaKorumasi`) bunu anında görür: işi iptal
  eder, kaydı "Başarısız" yapar ve denetime `ansible_launch_ignored_vars_cancelled`
  yazar. AWX iptal isteğine yanıt vermezse mesaj işin iptal edilemediğini ve AWX ekranından
  durdurulması gerektiğini söyler. Self Service'in davranışı değişmedi.
- **OCO denetimi bir takvim denetimidir**: kaydın var olduğuna ve planlanan pencereye bakar;
  onay durumunu ya da hedef sistemleri okumaz (Admin > ScaleX Yönetimi > OCO Tanı bunu gösterir).

## Testler

- `server/scalex/__tests__/scalex-kapi-matrisi.test.cjs` — istek gerçek yönlendiriciden geçer
  (`fixtures/scalex-sim.cjs`: gerçek ortak kapı ve gerçek `runner`, sahte AWX / OCO / SMART).
  928 hücrelik karar matrisi ve bu belgedeki her kural için ayrı test. Pencere saatindeki ve
  SMART onayı sonrasındaki başlatmalar da gerçek yoldan koşar: gerçek OCO zamanlayıcısı ve
  runner'ın gerçek başlatma fonksiyonu sahte AWX'e gider.
- `src/components/scalex/__tests__/ScaleXKapilar.test.tsx` — ekran, sunucunun gerçek
  yanıtlarıyla (`fixtures/kapi-yanitlari.json`) denenir.
- KM26 — kapsam adımının okuduğu özet, aynı ayarlarla `/preview`in kararıyla birebir aynı
  (72 hücre); anahtar ve OCO ortam listesi değişince anında değişir; dış sisteme gidilmez.
- `src/components/scalex/__tests__/KapiKurali.test.tsx` — kapsam uyarısı ve toplu geri alma
  kutusu her ayarda doğru cümleyi söyler (girdi: sunucunun gerçek özet yanıtları).
- `scripts/ui-tarama/scalex-akis.mjs` — sihirbaz gerçek tarayıcıda, veriyle dolu gezilir.
