# Değişiklik Günlüğü (`CHANGELOG.md`)

Format [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) esas alınarak hazırlanmıştır.

## [Unreleased]

### Fixed (Admin › DB tam yedeği, 2026-11-27; PR-2 testlerinin bulduğu hata)
- **Aynı anda iki yedek:** "Şimdi Çalıştır"a iki hızlı tıklama (ya da zamanlayıcıyla çakışan elle çalıştırma) iki tam yedeği birden başlatıyordu. Durum havuz bağlantısı beklenene kadar `running` olmuyordu; "zaten çalışıyor" koruması ve ucun 409 yanıtı bu arada etkisizdi. Aynı saniyeye düşen iki akış aynı CSV dosyasına yazıyordu. Durum artık bağlantı beklenmeden önce `running`.
- **Havuz istisnası:** bağlantı istisnayla düşerse durum `error` olur ve "Portal DB bağlantısı yok." yazar, `running`'de takılı kalmaz. Zamanlayıcı eskisi gibi sonraki tikte yeniden dener.
- Test: `tam-yedek` (DY1-DY8). Düzeltmeden önce DY3, DY4 ve DY7 kırmızıydı.

### Fixed (AI Analist › Splunk aracı, 2026-11-27; PR-2 testlerinin bulduğu hata)
- `portal_splunk_search` aramayı en çok 60 dakikayla yapıyor, başlığa ise istenen pencereyi yazıyordu ("son 500 dk"). AI, 60 dakikalık sonucu 500 dakikalık sanıp yanlış sonuç çıkarıyordu. Artık başlıkta aranan pencere yazıyor (1-60 dk, varsayılan 15). Negatif değer istemciye de 1 olarak gidiyor. Test: `portal-araclari` AT7.

### Fixed (LogX › indirme bağlantısı, 2026-11-27; PR-2 testlerinin bulduğu hata)
- Toplama / aktarım işi arşiv ürettiği halde hiçbir arşiv için indirme bağlantısı üretilemezse (ör. disk dolu) istek yine "hazır" yapılıyordu. Sihirbaz "indirilecek arşiv bulunamadı (temizlenmiş olabilir)" diyor, gerçek sebep yalnız denetim kaydında kalıyordu. Artık istek başarısız olur ve kullanıcı "Arşiv hazırlandı ama indirme bağlantısı üretilemedi" mesajını görür. Bir arşivin bağlantısı üretildiyse ya da eş zamanlı ikinci yoklama arşivleri önceden bağlantılı bulduysa istek hazır kalır.

### Fixed (üst üste pencerelerde ESC, ikinci adım, 2026-11-28)
- #354 ESC dinleyicisini çizimden önceye aldı, ama dinleyicinin çağırdığı kapatma işlevini tutan ref hâlâ çizimden sonra tazeleniyordu. Bileşen yeniden kurulmadan yalnız açılıp kapanan bir katmanda ilk karedeki ESC, bir önceki çizimin işlevini çağırıyor ve katman kapanmıyordu. Retirement kayıt penceresinde onay katmanı buna örnek; CI'da RE8 bu yüzden yeniden kırıldı (#348).
- `useEscIleKapat` ve `Modal`'ın ref'i de artık layout efektinde, kayıttan önce tazeleniyor. Test: `katman-esc-ilk-kare` EK4 / EK5. Her dosyanın eski hali kendi testini kırmızı yapıyor.

### Fixed (LogX › OpenShift sihirbazı, 2026-11-27; PR-2 testlerinin bulduğu üç hata)
- Kayıtlı namespace listesinden "Geri" cluster seçimine dönmüyordu. İstemci yalnız listeyi temizliyordu, istekte seçili cluster'lar duruyordu; adım "Namespace listesi hazırlanıyor…"a düşüyor ve hiçbir şey başlamadığı için kullanıcı sonsuz bir bekleme ekranında kalıyordu. Artık geri dönüş sunucuda geri sarılır.
- Cluster seçimine dönüp aynı cluster'ları yeniden seçen kullanıcıda namespace listesi bir daha hazırlanmıyordu (tekrar tetikleme koruması aynı anahtarı görüyordu). Koruma geri dönüşte sıfırlanır.
- Bir uygulama taraması yapıldıktan sonra "Geri" ve "sepete ekle" uygulama ekranından çıkmıyordu; kullanıcı başka namespace seçemiyordu. Sayfa yenilenince taranan namespace'e dönülmesi için konan geri düşüş, kullanıcı açıkça geri döndüğünde de çalışıyordu. Artık yalnız henüz seçim yapılmamışken çalışır.

### Fixed (Denetim › Init / Deployment script sapması, 2026-11-27; PR-2 testlerinin bulduğu hata)
- Veri okunamayınca ekranın tamamı tek bir hata kutusuna dönüyordu; kök seçimi ve "Yenile" de kayboluyordu. Okunamayan bir köke (ör. `/vhosting8`) geçen kullanıcı sayfayı yenilemeden önceki köke dönemiyordu. Artık araç çubuğu yerinde kalır; özet ve tabloların yerine "okunamadı" ve sebebi gösterilir ("Tekrar dene"). Önceki kökün verisi yeni kökün altında gösterilmez.

### Fixed (Otomasyon › servis formu, 2026-11-27; PR-2 testlerinin bulduğu iki hata)
- İş geçmişi penceresi, geçmiş okunamayınca ("ok: false" yanıtı ya da düşen istek) "Son 30 günde iş yok." diyordu; düşen istek ayrıca yakalanmıyordu. Artık "okunamadı" ve sebebi gösterilir, yeniden denenebilir.
- "Formu Temizle" dokunulmamış formda da açık gelebiliyordu. Şablonun varsayılan değeri ya da AWX'in kapalı çalışma zamanı seçeneklerindeki mevcut değer (ör. verbosity 1, job type check) "doldurulmuş" sayılıyordu; basınca aynı değerler geri geliyor, ekranda hiçbir şey değişmiyordu. Düğme artık yalnız form açılıştakinden farklıysa açık.

### Fixed (Nginx Hub › Konfigürasyon, 2026-11-27; PR-2 testlerinin bulduğu beş hata)
- Dashboard, Instances, Kullanılmayan, Tutarlılık ve CIS'ten "Konfigürasyon'da aç" sunucuyu seçmiyordu; sekme boş açılıyordu. 2026-11-14'teki lint düzeltmesinde `useEffect` "önceki değer" kalıbına çevrilmiş, kalıp yalnız değişimi yakalıyor, ilk açılışı yakalamıyordu. Gelen sunucu artık ilk değer.
- Sunucu ağacı okunamazsa ekranda önceki sunucunun ağacı kalıyor, tıklanan dosya yeni sunucudan isteniyordu. Artık ağaç boşalır; "okunamadı" ayrı gösterilir ve yeniden denenebilir.
- Sürüm geçmişi okunamayınca "Henüz kayıt yok" yazıyordu. Geçmiş ucu "Değişiklikler" sekmesine bağlı; o sekmesi kapalı kullanıcı 403 alıyordu. Ağ hatasında da ekran yükleniyor'da kalıyordu. Artık "okunamadı" ve sebebi gösterilir, yeniden denenebilir.
- "Diğer sunucularda" karşılaştırması okunamazsa düğme hiçbir şey yapmıyordu; artık hata bildirilir.
- Salt okunur kullanıcı ağaç panelinde "Yenile" görüyordu; sunucu `/refresh`'i Admin dışına 403 ile kapattığı için her seferinde reddediliyordu. Düğme artık yalnız Admin'de; sol paneldeki döküm araçlarıyla aynı.

### Fixed (üst üste pencerelerde ESC, 2026-11-27)

- Bir pencerenin içinden açılan onay katmanı ya da ikinci pencere, ESC dinleyicisini çizildikten sonra kaydediyordu (`useEffect`). Açıldığı ilk karelerde basılan ESC alttaki pencereyi kapatıyordu: kullanıcı onayı kapatmak isterken bütün kayıt penceresini kaybediyordu. CI'da Retirement RE8 testi yük altında tam bu araya düşüp `main`'i kırmızı yaptı.
- `useEscIleKapat` (`common/pencereKlavye.ts`) ve `Modal` yığına ve klavyeye artık layout efektinde, çizimden önce giriyor. Test: `katman-esc-ilk-kare` (EK1-EK3; ESC'yi yeni katmanın ilk karesinde basar; her düzeltme geri alınınca kendi testi kırmızı).

### Changed (Intranet SPA: geçiş takvimi, 2026-11-27)

- Intranet SPA sayfası (`/ark-spa/intranet-spa`) yalnız geçiş takvimini gösteriyor: `set`, `gecis_tarihi`, `sira`, `ekip`, `ekip_eposta`, `namespace`, `uygulama`, `route_adresleri`, `dynatrace_durumu`, `dynatrace_istek`, `aciklama`, bu sırayla (Pilot, Set 1..N; set içinde sıra). Süzgeç: set, ekip, metin; CSV aynı 11 sütun. Kaldırılan bölümler: ekip beyanı, değerlendirme, özet kutuları, intranet sunucu kurulumu ve ayrıntı satırı. Paket kurulumu bölümü (`IntranetPaketKurulum`, yalnız Admin) takvim listesinin altında kalıyor (kullanıcı kararı: zincir geri kondu).
- Takvim Portal DB'de (`intranet_spa_takvim`, anahtar set + namespace + uygulama; `server/spa-report/intranet-takvim.cjs`). Her uygulama DC başına bir satırdır: önce bir DC'nin setlerinde, sonra diğer DC'nin setlerinde geçer (aynı uygulama farklı setlerde yer alır, aynı sette iki kez yer alamaz). Satır anahtarı, tek satır düzeltme, açıklama, takvimde yok, canlı eşleşme ve önizleme farkı (yeni / çıkacak / tarihi değişen / elle düzeltme kaybı) bu anahtarla. Admin CSV yükler: sunucuda önizleme (set özeti, mevcut takvime göre fark, satır hataları, uyarılar), onayla mevcut takvimin yerine geçer (set planını silmez); hatalı dosya reddedilir. Aynı uygulamanın aynı DC'de iki sette olması satır hatası değil uyarıdır (DC set planından; plan yoksa denetlenmez); set planı tarihinden farklı satırlar ve planda olmayan setler de uyarı olarak sayılır. Admin tek uygulamanın geçiş tarihini düzeltir; satır sürümüyle 409 kilidi, her değişiklik `auditPortal`'a yazılır. Elle düzeltme kaybı yalnız tek satır düzeltmesini sayar (`elle_tarih`; set tarihi yayılımı ve yükleme işareti kaldırır, `guncelleyen` yalnız son değiştirendir). Admin olmayan salt okur: takvim ve set planı yazımı sunucuda Admin'e kapalı. Açıklama kutusu yalnız Admin'e görünür; bu bir ekran tercihidir, yetki sınırı değil: not mevcut beyan ucundan (`PUT /api/spa-report/intranet/declare`) gider ve o uç SPA Raporu ile aynı kuralla sayfayı gören herkese açıktır (değiştirilmedi).
- Set planı (`intranet_spa_set_plani`, `server/spa-report/intranet-set-plani.cjs`): set başına geçiş tarihi, DC, eski / yeni IP (IPv4 doğrulanır, boş olabilir). Admin "Set ilerlemesi" satırından düzenler (`PUT /api/spa-report/intranet/takvim/set`) ya da CSV yükler (`set;gecis_tarihi;dc;eski_ip;yeni_ip`, tarih "gg.aa.yyyy GünAdı"; önizle → onayla). Setin tarihi değişince o setteki uygulamaların tarihi de aynı transaction'da değişir (önce "Set N: X uygulamanın geçiş tarihi … olacak" onayı; setin her satırının sürümü denetlenir); set toplu tarihin tek yolu budur. Plan yüklemesi planın yerine geçer, takvimi silmez; tarihi değişen setlerin uygulama satırlarını taşır ve önizlemede set başına kaç uygulamanın (elle düzeltilmiş olanlar dahil) değişeceğini söyler. Aynı uygulamanın aynı DC'de birden fazla sette olması plan önizlemesinde ve set düzeltmesinin yanıtında da DC başına özetle uyarılır (yazımı engellemez; DC kırpılmış, harf duyarsız). Plan satırı sürümü ve plan + takvim yükleme kilidi (409), audit `intranet_spa_set_plani_duzelt` / `intranet_spa_set_plani_yukle` (yüklemede değişen, yeni ve kalkan setlerin eski ve yeni değerleri). GET takvim yanıtı planı da taşır.
- "Set ilerlemesi" tablosu (uygulama listesinin üstünde; set kartlarının yerine tek set görünümü): DC başına grup (plan sırasıyla), Set | Tarih | DC | Eski IP | Yeni IP | Uygulama | Setin payı | Toplam geçmiş olacak | Toplamın yüzdesi | Durum. Uygulama sayısı, pay ve yüzde sabit değil, DC'deki takvim satırlarından hesaplanır; setin payı kullanıcının tablosundaki gibi oran, üç ondalık (0,156; `utils/datetime.ts` `fmtOran`), toplamın yüzdesi bir ondalık (%17,5; `fmtYuzde`), Türkçe virgül. DC grubu kırpılmış ve harf duyarsız (sunucunun aynı DC uyarısıyla aynı kural). Durum bugüne göre (`PORTAL_TZ`, `portalGunu`): Geçti / Bugün / Planlı; setin uygulamaları farklı tarihteyse "N uygulama farklı tarihte". Plansız set "plan yok" ve "DC belirtilmemiş" altında, uygulaması 0 olan plan seti de görünür. Satıra tıklamak set süzgecini açar / kapatır; tablo CSV indirilir (formülsüz).
- Yükleme doğrulaması: yalnız başlıklı dosya (planı silerdi), UTF-8 olmayan dosya (Excel cp1254 kaydı), tekrar eden başlık, Kubernetes adı olmayan namespace / uygulama ve gün adı tarihe uymayan satır reddedilir. Metin sınırı 600 000 karakter (gövde global 2 MB ayrıştırıcıya sığar; takvime özel ayrıştırıcı gereksizdi, kaldırıldı).
- Kilit: yükleme yeni satırları eski planın en büyük sürümü + 1 ile yazar (yeniden yüklemeden sonra eski ekranın sürümü tutmaz) ve yükleme kilidi sürüm toplamını içerir (önizlemeden sonra yapılan tarih düzeltmesi yüklemeyi 409 yapar; önizleme kaybolacak elle düzeltmeleri sayar). Tek satır düzeltmede okuma ve yazım tek transaction'da satır kilidiyle.
- CSV indirmede =, +, -, @ ile başlayan hücre etkisizleştirilir (formül enjeksiyonu).
- Repo hijyeni bekçisi (`scripts/repo-hijyeni.cjs`) üretilen `kalite/teslim.json`'u referans saymıyor: imza her izlenen dosyanın yolunu taşıdığı için her modül "anılmış" sayılıyor, ölü kod kuralı hiç tetiklenmiyordu. RH2 mutasyonla sınandı.
- Alan önceliği: uygulama canlı Intranet SPA raporunda eşleşirse route canlıdan, Dynatrace yalnız ölçüm varsa canlıdan, açıklama uygulama notundan (boşsa listeden); ekip / e-posta listeden (sıra set içindeki ekip sırası; listede boşsa canlıdan); eşleşmezse hepsi listeden. Takvimde olmayan canlı PROD uygulamaları ayrı sayılır. İstemcisi kalmayan `GET /api/spa-report/intranet` ucu kaldırıldı; `loadIntranet` (kurulum hesabı dahil) takvim, paket kurulumu ve Nginx Hub › Kapsam & Taşıma için aynen kalır.
- Paket kurulumu zinciri (ekran, sunucu ucu, AWX playbook'u, `arkSpaApi` paket uçları) değişmedi; sayfa testi bölümün bağlı olduğunu sınar (IT10).

### Fixed (Denetim › Nginx PROD taşıması, 2026-11-27; PR-2 testlerinin bulduğu hata)
- Toplu geçiş takibinde bazı uygulamalar yazılamadığında (kısmi başarı) pencere yine kapanıyordu; yazılamayanların listesi ve sebebi hiç görünmüyor, kullanıcı hepsinin yazıldığını sanıyordu. Artık pencere yalnız tam başarıda kapanır ve seçim o zaman temizlenir; yazılan satırlar yine hemen tabloya işlenir.

### Fixed (main kirmizi: Kurum Ayari testleri, 2026-11-27)
- PR'sız `5f222cb5` (Admin › Kurum Ayarı) `main`'i iki yerden kırmızı yaptı. Düzeltme yalnız testte; üretim kodu değişmedi.
  - **CI'da (TY1):** yeni uç testi sunucuyu host'suz `listen(0)` ile açıyordu (macOS'ta aralıklı yanlış süreç). Sunucu artık `127.0.0.1`'e bağlanıyor.
  - **Yerel kapıda (K8, macOS):** fikstürün geçici dizini çözülmemiş yoldu. `os.tmpdir()` macOS'ta `/var` → `/private/var` sembolik bağı; modül dosyayı `realpath` ile çözdüğü için yol karşılaştıran sahteler hiç tetiklenmiyor, KA12 / KA19 / KA23 düşüyordu. Linux CI bunu görmez. Fikstür dizinleri artık gerçek yol.

### Added (Admin › Kurum Ayarı, 2026-11-27; PR'sız `5f222cb5`, bu girdi sonradan)
- `KURUM_AYAR_DOSYASI` Portal'dan düzenlenir (yalnız Admin): bölüm ya da tüm dosya, kaydetmeden önce zorunlu fark ön izlemesi, son 30 yedekten geri dönüş.
- Uç `/api/admin/kurum-ayari`:
  - sha kilidi (409);
  - atomik yazma;
  - 0700 / 0600 yedek;
  - silme onayı (428);
  - geçersiz sunucu adı reddi;
  - boyut ve derinlik sınırı, kullanıcı başına yazma sınırı;
  - repo içindeki dosyaya yazmaz;
  - denetim kaydı (anahtar yolları, değer yok).
- Belge: [docs/KURUM-AYARI.md](docs/KURUM-AYARI.md).

### Security (kurum ic adi: LDAP DN korlugu, 2026-11-26)

- K17 kurum alan adını LDAP DN biçiminde (`DC=<ad>,DC=com,DC=tr`) görmüyordu: noktalı desen bileşenlere bölünmüş adı yakalamıyor, kurum adı da `,DC=` ayırıcısı yüzünden bileşik sayılmıyordu. Bu yüzden kurumun AD alan adı yedi dosyada duruyordu: üretim LDAP servis hesabı ve grup DN'leri (`server/ansible/NEEDS.md`), iki ekran örneği (`TabAccessPanel`, ortam değişkenleri) ve dört test. Bekçi iki biçimi de yakalıyor (mutasyonla sınandı); geçişler kurgusal `DC=ornek,DC=invalid`'e çevrildi. Değerler git geçmişinde duruyor; geçmişin yeniden yazımı ayrı (onay bekliyor).

### Changed (kalite: kapsam esik merdiveni, PR-2, 2026-11-26)

- Kapsam eşikleri sıkılaştı: yerel satır kapsamı (K9) %80 → %85, Sonar kapsam koşulu (K13 / K15) %75 → %78. #329-#333'ün davranış testleri sonrası main: yerel satır %86,6, dal %71,9; kurumsal Sonar kapsamı 81,4 (K13 80,6). Taban (`server/__tests__/kalite-kapilari.test.js`) aynı değerlere çekildi; eşikler yalnız sıkılaşır.
- Yeni davranış testleri (PR-2b..2f): AWX runner Self Service / Smart / OCO / AWX sunucu uçları gerçek `initAnsibleRunner` ile koşuyor (önceki "handler'ı kaynaktan çıkar" testleri kapsam saymıyordu); Retirement, ScaleX, envanter, DB kurulum / bakım, Nginx CIS / Audit uçları; ekranlar: AI Analist, Nginx Audit / API / CIS / kullanılmayan dosyalar / sunucu sayfası, Crypto Hub işlemleri ve ön onay, Telnet ve OpsX sihirbazları, Ansible, Admin › ScaleX, Self Servis taşıma detayı ve pencereleri.
- SPA paket kurulumu aday satırı `memo`: seçimde yalnız değişen satır çiziliyor (52 satırlık tabloda 50 tık 0,7 sn → 0,135 sn; davranış aynı).

### Fixed (yerel kapi kararliligi, 2026-11-24)

- Yerel HTTP testleri sunucuyu `127.0.0.1`'e bağlıyor ve `listening`'i bekliyor (29 dosya). `listen(0)` çift yığın `::` dinliyordu; macOS'ta aynı port `127.0.0.1`'de başka bir süreçte açıksa istek o sürece gidiyor, BN3 / AH14 aralıklı düşüyor ve kapı yeniden koşturuluyordu. Bekçi TY1/TY2 host'suz `listen(0)`'ı yasaklar.

### Fixed (PR'siz commit'lerin incelemesi, PR-R, 2026-11-24: Intranet SPA paket kurulumu)

- Dış süre sınırı betiğin iç bütçesinden kısaydı; dolarsa bash adım bitmeden trap'i çalıştırmıyor, KILL ile geri alma yapılmadan PROD Nginx'te yarım kurulum kalıyordu. Sınır artık iç bütçeden türetiliyor; adımlar arka planda + `wait` ile koşuyor, TERM/INT'te adım durup geri alınıyor; SIGPIPE/SIGHUP yok sayılıyor (okuyan taraf gidince kurulum yarım kalmıyor).
- Tek sunucuda temizlik sırasında bağlantı koparsa sonuç hiç yayınlanmıyordu (kurulum başarılı olsa da); girdi kapısı düşünce de. Artık iki durumda da yayınlanıyor (`cleanup_errors`, `error`), Portal kapı hatasının sebebini gösteriyor.
- Paket indirmede boyut sınırı Content-Length'siz yanıtta da uygulanıyor; paket adresinde kimlik bilgisi (`@`) reddediliyor; `-v` çıktısı komut / ortam yerine temiz özetten basılıyor.

### Changed (kalite: kopya %1, kapsam ölçümü kurumla aynı; PR-2 ilk dilim, 2026-11-24)

- Kapsam raporu (`kalite/kapsam/lcov.info`) kurumsal Sonar'ın kaynak saydığı her kod dosyasını taşıyor: `scripts/` ve `__tests__` yardımcıları da (kurum yalnız `*.test.js` / `*.test.tsx`'i test sayar). Önceden kurum testlerin çalıştırdığı ~12 bin satırı %0 sayıyordu. Sunucu tip denetimi `shared/` ve `scripts/`'i de kapsıyor.
- Kopya (Sonar CPD) kurumsal taramada %1,9'dan %1'in altına indi: davranış değişmeden ortak modüllere taşındı. Toplu Auto-Start / Restart çekirdeği (`server/server-hub/toplu-cekirdek.cjs`) ve sekmeleri; OpsX sonuç / iş açılış / pod hedefi / Legacy keşif uçları ve OpsX-Telnet-FileX katalog uçları; Telnet / FileX / OpsX sihirbaz adımları; Retirement ve Yük Testi iş çıktısı görüntüleyicisi; AWX runner bayt kapısı ve şablon listesi; iş kaydı (`server/ansible/is-kaydi.cjs`); 5xx yanıtı (`hataYanitlayici`); halka grafik; Crypto Hub test düzenekleri.
- Kaynak metnine bakan güvenlik bekçileri taşınan kuralları yeni yerlerinde ve modüllerin onları çağırdığını arıyor; her biri mutasyonla sınandı.

### Fixed (PR'siz commit'lerin incelemesi, PR-R, 2026-11-23: Nginx)

- Nginx Hub › Tutarlılık › Paketler: symlink içeriği özete ve parmak izine girmiyordu; farklı kütüphanelere giden aynı adlı bağ iki sunucuyu "eşit" gösteriyordu. Bağ artık izleniyor (kullanıcı kararı); kırık bağ, döngü, girdi sınırı ve `find` zaman aşımı `okunamadi`; bağsız uygulamada iz ve önbellek değişmez. Fetch parmak izi bağları da kapsıyor; parmak izi ve döküm görevlerinin Ansible zaman aşımı var (asılan tek sunucu tüm dökümü bekletmez).
- Yük Testi ön kontrol: hidepid altında master 0 kanıt sayılıyordu; çalışan nginx pid dosyasını görünmeyen bir yola yazıyorsa hedef "nginx'siz" ölçülürdü. Artık belirlenemedi (`-`), README'deki fail-closed sözüyle uyumlu; hidepid=1 (pid 1 görünür ama okunamaz) de yakalanıyor.

### Changed (PR'siz commit'lerin incelemesi, PR-R, 2026-11-23: EAR kullanım kanıtı)

- EAR Temizliği: izin yüzünden okunamayan **uygulama hesabı** süreci (uid ≥ `UID_MIN`; ya da sahibi ayrılmamış okunamayan, eski tarama) artık "kullanılmıyor" sayılmıyor; silme reddediliyor (kullanıcı kararı). Tarayıcı `was` ile koşar ve başka kullanıcının `cwd` / `fd`'sini göremez; o süreç dizini kullanıyor olabilir. Tarayıcı okunamayanları `/proc/<pid>/status` Uid'ine göre ayırır (`okunamayan_diger`); root, sistem hesapları ve taramanın kendi oturum zinciri (Ansible sshd) uyarı olarak kalır. Eski taramalar yeniden taranana kadar okunamayan süreç varsa silme kapalıdır.
- EAR envanter taraması: kesin zaman aşımı yumuşak bütçeden ve bağlantı örneklerinin uykusundan geniş; kullanım ölçümü bütçenin dışında koştuğu için büyük `ear_sure`'de görev zaman aşımına düşüyordu. Görev zaman aşımı artık `ZAMAN_ASIMI` yazıyor (eskiden rescue `HATA` yazıyordu; 2.16 ve 2.21 iletileri).

### Fixed (PR'siz commit'lerin incelemesi, PR-R, 2026-11-22: Application Hub saatlik filo taramasi)

- Paylaşılan dizine yazılamayan tarama "ok / written" yayınlanıyor ve iş yeşil bitiyordu (copy eylemi modül düşse de `checksum` ekliyordu). Artık `written:false`, sebep metni, cluster `ok` değil; hiçbir cluster yazılamazsa iş FAILED.
- OCP parolası Ansible `environment:` ile uzak komut satırına ve `-vvv` AWX çıktısına gidiyordu; artık 0700 koşu dizininde tek seferlik 0600 dosyayla gidiyor, betik okuyup siliyor (`stdin:` değil: ansible-core 2.16 onu async iş dosyasına düz yazar). Kubeconfig betiğin 0700 iş dizininde, koşu dizini `tempfile` ile açılıyor (tahmin edilebilir `/tmp` yolları kalktı; güvensiz dizin ya da parola dosyası reddediliyor).
- Bastion'da geçici dosya silinemeyince ya da yazıcı ulaşılamayınca sonuç artık yine yayınlanıyor (`cleanup_errors`, "writer host unreachable"); yazma anında ulaşılamayan yazıcı `written:true` sayılmıyor.
- Ulaşılamayan bastion "oc binary is missing" yerine "bastion unreachable" raporlanıyor; `terminal_host`'u boş / `null` cluster'lar ilk bastion'da taranıyor (önceden hiç taranmıyordu); giriş kapısı düşünce de sonuç yayınlanıyor ve Portal koşuyu sebebiyle HATA yazıyor.
- Tarama yükü yazma döngüsünde yeniden gömülmüyor (denetleyici belleği); `until: fleet_wait is finished` (2.16 DEPRECATION uyarısı); README'deki süre varsayılanı düzeltildi (1800 sn).

### Fixed (main kırmızı, 2026-11-23)

- Nginx Hub SPA keşfi ekran testi (gidiş-dönüş) `main`'de kırmızıydı: PR'sız `bd14d224` / `c58f4b4d` sunucu satırına yalnız sunucu içi `routeDetay` alanını ekledi ve gövdeden sildi; test tam satırın her alanını ekranda bekliyordu. Sunucu içi alanlar artık tek sabitte (`YANIT_SUNUCU_ICI`); gövde kurulumu ve test oradan okur, test bu alanların gövdeye sızmadığını da sınar.

### Fixed (PR'siz commit'lerin incelemesi, PR-R, 2026-11-22)

- Server Hub EAR Temizliği: Production / ortamı bilinmeyen sunucuda silme artık yalnız açık bir OCO değişiklik penceresinde (tekli ve toplu silmede OCO numarası; kuyrukta bekleyen iş açılmadan önce pencere yeniden denetlenir, kapanmışsa kayıt sebebiyle iptal; OCO okunamazsa silme yok). Kullanıcı kararı; ScaleX gibi diğer yıkıcı üretim işlemleriyle aynı kapı.
- Server Hub host XML ile auto-start kapatma (tekli): Production onayı yalnız ekrandaydı; doğrudan API çağrısı prod host XML'ini onaysız değiştirebiliyordu. Sunucu artık `prodOnay` ister (toplu yolla aynı kural, `400 prod_onay`).

### Added

- K17 kurum iç adı (`scripts/ic-ad-bekcisi.cjs`; commit öncesi, commit mesajı, push öncesi, CI tüm ağaç + aralıktaki mesajlar): kurum önekli sunucu adı ve kalıbı, `.com.tr` alan adı (kaçışlı biçim dahil), kurum adı (sözcük özetleri) ve bilinen kurum iç ağı adresi (ağ özetleri) repoya giremez; ad ya da ağ listesi repoda değil, bulunan değer yazdırılmaz (testi `server/__tests__/ic-ad-bekcisi.test.js`, mutasyonla sınandı).
- Kurum ayarı `KURUM_AYAR_DOSYASI` (`server/util/kurum-ayari.cjs`, biçimi `deploy/kurum-ayari.ornek.json`): nginx filosu, göç grupları, API kümeleri, RVP, OCP kümeleri ve tohumu, Crypto Hub kiracı altyapısı, OpsX ve self servis kurum değerleri koddan çıktı. Dosya yok ya da bozuksa ilgili bölüm boş döner ve ekranda uyarı çıkar; örnek değere düşülmez.
- Playbook kurum değerleri AWX template Variables'ta (`portal_yazici_host`, `portal_envanter_sql_sunucusu`, `portal_edu_hostlari`; pod silme postası `mail_vars.yml`): varsayılan yok, tanımsızsa iş açıkça durur ve sonuç yine yayınlanır (`docs/AWX-KOPYALAMA-HARITASI.md` "Kurum değerleri"; gerçek Ansible bekçisi `server/ansible/__tests__/kurum-degiskenleri-kosum.test.js`, core 2.21 ve 2.16).
- K16 `main` geçmişi (`scripts/gecmis-denetim.cjs`, CI `verify`): `main`'e giden her first-parent commit birleşmiş bir PR'dan gelmeli, konu satırı 8–120 karakter; `commit-msg` kancası konu kuralını aynı yerden okur (bekçi GD1-GD5).
- K15 kurum kural profili: "Portal Kurumsal" her dilde `kalite/kurumsal-sonar.json` `profil`den kurulur (kurumsal iş #52 bulguları + Sonar way bug / zafiyet / hotspot); K15 inceleme kaydı uygulamaz, inceleme bekleyen hotspot mutlak 0 (bekçi KK14). K13 / K15 kapısında kod kokusu mutlak (0).
- ESLint'te kurumun Sonar kuralları (`eslint-plugin-sonarjs`, `KURUM_JS` / `KURUM_TS`); kurumsal iş #52'nin 1597 kod kokusu ve HTML yorum bulgusu kapandı (bekçi KK13: kurumun HTML "yorumlanmış kod" sezgisi).
- `scripts/arac-yolu.cjs`: geliştirme betiklerinin çalıştırdığı dış araçlar (git, npm, npx, docker, zip, gitleaks, cygpath) PATH'te aranmaz; yalnız sabit sistem dizinlerinden ve Node'un kurulum dizininden mutlak yolla çalışır (Sonar S4036; bekçi AY1-AY3).
- Kurumsal Sonar taklidi (K15): CI `sonar` işi, kurumun sınıflandırmasıyla (`kalite/kurumsal-sonar.json`) ayrı bir projeye de tarar ve aynı kapıyı uygular (`node scripts/sonar-kapi.cjs --ci --kurumsal`, bekçi KK12).
- Kurumsal teslim imzası `kalite/teslim.json` (`scripts/teslim.cjs`, `.github/workflows/teslim-imzasi.yml`): main'deki her dosyanın git blob sha'sı, her main push'undan sonra tazelenir. `kurumsal:derle`'nin ilk adımı kodu bununla karşılaştırır ve yarım aktarımı dosya dosya söyler (bekçi TS1-TS8).
- Kurumsal iş provası `npm run kurumsal:prova` (`scripts/kurumsal-prova.cjs`, CI'da `kurumsal` işi, K14): temiz ağaçta, groovy'deki Node sürümüyle groovy'nin komutları aynen; paket ve 10 dk süre sınırı denetlenir. `sonar` işi provayı bekler (bekçi KJ7/KJ8).
- `npm run kapsam:kurumsal`: CI'ın ürettiği kapsam raporunu kurumsal Sonar adımının aradığı `coverage/lcov.info`'ya koyar (bayatsa Sonar koşusunu düşürür).
- Repo hijyeni bekçisi `scripts/repo-hijyeni.cjs` (`server/__tests__/repo-hijyeni.test.cjs`): hiçbir yerden ulaşılamayan belge/betik ve yalnız testlerin yüklediği modül CI'da kırmızı. Kural tüm talimat dosyalarında (AGENTS, CLAUDE, GEMINI, `.agent/rules`, CONTRIBUTING, PR şablonu).
- Kurumsal Jenkins iş tanımı `deploy/jenkins/DVL_JAVASCRIPT_GAR_BMW_PORTAL.groovy` (test + kapsam adımıyla) ve bekçisi `server/__tests__/kurumsal-pipeline.test.cjs`.
- Proje ajanlarının tanımları (`.claude/agents/*.md`) repoda; her biri zorunlu kalite kapılarına bağlı (KK9).
- `server/util/guvenlik-yardimci.cjs`: `TRUST_PROXY` env çözümleyici (`resolveTrustProxy`) ve `correlationId` tabanlı global hata yanıtı (`formatGlobalError`, `globalErrorMiddleware`).
- `scripts/lcov-birlestir.cjs`: `node:test` ve `vitest` LCOV çıktılarını tek `coverage/lcov.info` altında birleştiren araç ve birim testleri (`server/__tests__/lcov-birlestir.test.cjs`).
- `sonar-project.properties`, `.editorconfig`, `SECURITY.md`, `CONTRIBUTING.md`, `docs/STANDARTLAR.md` ve `docs/adr/0001..0003`.
- İstemci URL doğrulama birim testleri (`src/utils/__tests__/url.test.ts`).

### Fixed (OpsX WAS sonuc satiri, 2026-11-21)

- OpsX WAS: `>-` blok içindeki `split('\t')` sekmeye bölmüyordu (Ansible Jinja ifadesindeki ters bölüyü çiftler). Her başarılı restart/stop/start OLCULEMEDI ile bitiyor, AWX işi FAILED oluyor, `dbo.WASAppsInventory` hiç güncellenmiyordu; keşif de her hostu "ölçülemedi" sayıyordu. Sekme çift tırnaklı değişkende (`opsx_was_sekme`). Aynı tuzak OpsX Legacy dump'ta (`split('\n')[-1]`, çok satırlı çıktıda yanlış dosya adı) da düzeldi. Gerçek `ansible-playbook` bekçisi `opsx-was-gercek-kosum.test.js` (düzeltme öncesi 4/4 kırmızı) ve genel metin kuralı `playbook-jinja-traps.test.js` TUZAK 5.

### Fixed (kurumsal Jenkins, 2026-11-18)

- Kurumsal sınıflandırmada görünen bulgular (K15'in ilk koşusu: 8 bug, 28 zafiyet, `scripts/` ve test yardımcılarında) kodda düzeltildi; bastırma ya da dışlama yok:
  - geri izlemeli düzenli ifadeler doğrusal yazıldı; eski ve yeni sonuçlar 1675 repo metninde ve kötü girdilerde aynı (S8786);
  - sıralamalar `varsayilanSira` ile (S2871); beklenmeyen promise (S9383);
  - test yardımcılarında `http` / sabit parola / özel IP (S5332, S2068, S1313).
  - `ear_regex_esdeger.py` eski desenleri tutmuyor: eşdeğerlik, eski desenin aynı ~15 bin deterministik girdideki çıktı özetiyle (sha256) kanıtlanıyor.
- Kurumsal Sonar (iş #49, kapsam %50, güvenlik F): kurumun `scanOnSonar` adımı testleri yalnız `*.test.js` / `*.test.tsx` adından tanıyordu; 511 Node testi (`*.test.cjs`) üretim kodu sayıldı. Node testleri `*.test.js` oldu (`server/` ve Node testi olan `src/**/__tests__/` altında `"type": "commonjs"`); `npm test` eski adı reddeder (KK11). Biçim kapısı yeniden adlandırmayı tanır: HEAD biçimi eski yoldan okunur (KK3b).
- Kurumsal iş #50 (`teslim butunlugu`, 37 eksik dosya): `.github/`, `.claude/`, `.agent/` ve `sunum/` kurumsal depoya gitmiyor. Teslim imzası bu dizinleri iki yönde de yok sayar (`scripts/teslim.cjs` `KURUMA_GITMEYEN`, bekçi TS1/TS4b).
- Kurumsal iş #48 (`Missing script: "kurumsal:derle"`): kurumsal dal main'in yarım bir kopyasıydı (ZIP üzerine kopyalama: `scripts/kurumsal-derle.cjs` gelmiş, aynı commit'teki `package.json` satırı gelmemişti). Aktarım yöntemi (`git rm -r -q .` + ZIP içeriği) `docs/KALITE-KAPILARI.md` "Kurumsal aktarım"da; yarım kopya artık derlemenin ilk adımında yakalanır.
- Kurumsal iş #46 (`Missing script: "kapsam:kurumsal"`): groovy, kurumsal daldaki eski kodda olmayan bir betiği çağırıyordu. Groovy artık yalnız `install` + `run kurumsal:derle` çağırıyor; adımlar `scripts/kurumsal-derle.cjs`'te kodla birlikte sürümleniyor (bekçi KJ5/KJ6).
- TST ve PRD iş tanımları (`deploy/jenkins/TST_…`, `PRD_…`): derleme DVL ile birebir aynı; TST deployment `BMWPORTAL-T`, PRD'de deploy yok (bekçi KJ4).
- Kurumsal iş tanımı kurumdaki çalışan işler ve `standart_pipeline` koduyla hizalandı: `tools: [nodejs]` (Linux ajanı), `npm run kur`, paket `build/` altında, war `BMWPORTAL.war`, deployment `BMWPORTAL-D` (SI kaydı). `scripts/paket.cjs` repo içinde yalnız `build/` altına yazabilir.

### Removed

- Glomo Geçiş Planı sayfası (2026-11-23, kullanıcı: artık ihtiyaç yok): menü, `/api/spa-report/gecis/*` uçları ve kurum ayarındaki `spaRapor` bölümü kalktı; eski menü kaydı açılışta silinir (`removeRetiredPages`). `spa_gecis_*` tabloları ve verisi DB'de olduğu gibi kalır.
- Kullanılmayan dosyalar (2026-11-18): `docs/archive/` (QUICK-SOLVER, TOPOLOGY, deploy-legacy.sh), iki yol haritası ve MINDMAP, OpenShift arayüz önizlemesi (`docs/UI-OPENSHIFT.md`, `docs/ui-onizleme.html`), tek seferlik betikler (`fix-username-case`, `oco-arama-dene`, `standardize-src`) ve SQL (`2026-07-27-envanter-navgroup.sql`).
- İş kaydı niteliğindeki üç belge (`docs/PBI-2026-09-19-*`, `docs/NETWORK-HARDENING-BACKLOG.md`, `docs/OCO-SMART-CHAOS-SCALE-IHTIYAC.md`) repodan çıkıp git dışındaki backlog'a taşındı.
- Ölü kod: `src/utils/url.ts`, `src/utils/safeUrl.ts` (Linkler sayfası 2026-10-02'de kalktı; sunucu kapısı duruyor) ve `server/opsx/ocp-target.cjs` (2026-08-11'den beri çağrılmıyordu). Mutasyon kapısında `url.ts` hedefinin yerini app-hub sahiplik doğrulaması aldı.

### Changed

- Repodaki kurum sunucu, alan ve kişi adları kurgusal karşılıklarına çevrildi (ad kuralı korunur: önek `OR`, alan adları `*.invalid`); ScaleX yedek kataloğu repoda yalnız kurgusal biçim (`openshift_inventory_scalex.ornek.yaml`), gerçeği AWX'te.
- Ad kalıpları önek bağımsız (`^[A-Z]{2}NG…`, `^([A-Z]{2}RVP|[A-Z]{2}NG[WX]A?P)`): kod ve playbook kurum önekini bilmez.
- Kurum adı repodan çıktı: Crypto Hub values yolu ve dosya adı (`resValuesPath`, `valuesDosyasi`) ve Smart login domain'i (`smart.domain`, `SMART_DOMAIN` önce gelir; ikisi de yoksa talep açılmaz) kurum ayarında; ekran metinleri nötr; LICENSE telif satırı `BMW Portal`. Depo sahibinin adı testlerde kurgusal.
- Glomo geçiş planının Excel verisi (210 uygulama) ve Set 7 talep listesi kurum ayarında (`spaRapor.glomoGecis`); repoda kurgusal örnek. Ayar yoksa plan tablodaki satırlarla açılır, sebep yalnız Admin'e (GG12, GG13).
- Gerçek iç ağ adresleri (DNS, LB, test makineleri) testlerde ve ekran metninde kurgusal ağlara çevrildi; Web Uygulaması DNS açıklaması artık `WEB_APP_DNS_SUNUCULARI` ayarına dayanır.
- `server/auth/guvenlik-basliklari.cjs`: Tam `Content-Security-Policy`, `Permissions-Policy` ve production varsayılan `Strict-Transport-Security` (`includeSubDomains`) eklendi.
- `server/auth/oturum-cerezi.cjs` & `server/auth/index.cjs`: `COOKIE_SECURE` env desteği bağlandı.
- `server/log.cjs` & `server/service.cjs`: `Bearer`/`Basic`, `JWT`, `Cookie`/`Set-Cookie`, hassas sorgu/JSON alanları loglarda maskelendi; `sessionOrIpKey` kimlik spoofing'ine karşı doğrulamalı hale getirildi.
- `server/nobetci/index.cjs`: `/api/nobetci/today/avatar` yanıtında `Cache-Control: private, max-age=300` uygulandı.
- `server/admin/branding.cjs` & `server/server-hub/notlar.cjs`: Zayıf `sha1`/`md5` özetleri `sha256` ile değiştirildi.
- `src/utils/url.ts`: `new URL()` tabanlı sıkı `http:`/`https:` izin listesi uygulandı.
- `.gitignore`: `coverage/`, `*.har` ve yerel çalışma artıkları eklendi.

### Fixed

- `server/index.cjs`: Sabit iç proxy IP adresi kaldırıldı ve production hata yanıtlarından `detail: err.message` sızıntısı engellendi.
