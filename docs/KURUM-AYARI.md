# Kurum ayarı (`KURUM_AYAR_DOSYASI`)

Kodun çalışmak için bildiği kurum listeleri tek bir JSON dosyasındadır: nginx filosu, OpenShift
cluster'ları, Crypto Hub kiracıları, Self Servis uyarıları, varsayılan hedef sunucular. Repo public
olduğu için bu adlar koda yazılmaz ([KALITE-KAPILARI.md](KALITE-KAPILARI.md) K17).

- Okuyan: `server/util/kurum-ayari.cjs`. Dosya her erişimde değişiklik zamanına, boyutuna ve inode/ctime değerine göre yeniden
  okunur; değişiklik yeniden başlatma istemez.
- Biçim: [`deploy/kurum-ayari.ornek.json`](../deploy/kurum-ayari.ornek.json) (kurgusal değerler; testler
  ve yerel geliştirme bunu kullanır).
- Üretimde dosya repo dışındadır. Yolu Portal'ın ortam dosyasındaki `KURUM_AYAR_DOSYASI` verir.
- Fail-loud: dosya tanımsız, okunamaz ya da bozuksa uygulama düşmez, örnek değere de düşülmez. Bölümler boş
  gelir, ekranlar "kurum ayarı yok" der ve üstte uyarı bandı görünür.

## Portal'dan düzenleme

**Admin › Sistem › Kurum Ayarı** sekmesi (yalnız Admin). Dosyayı sunucuda elle açmak gerekmez.

1. **Durum.** Dosya adı (dizin gösterilmez), geçerli JSON mu, son değişiklik zamanı, boyut ve sha256
   özeti görünür. Portal kullanıcısının dosyaya ya da dizine yazma izni yoksa ekran bunu önceden söyler.
2. **Düzenleme.** Üst düzey bir bölüm seçilir (`nginx`, `ocp`, ...) ya da tüm dosya düzenlenir. JSON
   geçerliliği yazarken denetlenir; hata Türkçe ve satır / sütunla söylenir. Bölüm kipinde diğer bölümler
   aynen kalır; kayıt dosyayı iki boşluk girintiyle yeniden yazar.
3. **Fark ön izlemesi.** "Farkı göster" değişen anahtar yollarını listeler: eklenen, silinen ve değişen
   alanlar. İlkel değerli listelerde eklenen ve çıkan değerler ayrı görünür; yalnız sıra değiştiyse o da
   yazılır. Nesne öğeli listeler sıra numarasıyla alan alan gösterilir (`selfServis.operasyonUyarilari[2].aciklama`).
   Değerler aynı kalıp yalnız biçim (girinti, anahtar sırası) değiştiyse ekran bunu söyler ve kayda izin
   verir. Kayıt ancak ön izlemeden sonra yapılır.
4. **Geçmiş ve geri dönüş.** Her kayıtta dosyanın eski hali yedeklenir. Yedeğin zamanı dosyanın
   **değiştirildiği** andır; içerik o andan önceki haldir ("Bu zamana kadar geçerli hal"). Bir yedek
   seçilince güncel dosyayla farkı gösterilir. "Bu yedeğe geri dön" normal kayıt yolundan geçer: yine
   yedek alınır, çakışma kilidi ve bütün kurallar yine geçerlidir.

Fark hesabı, onay isteyen silmeler ve sunucu adı kuralı ekranla sunucuda ortaktır: `shared/kurumAyari.cjs`.

### Kayıt kuralları (`server/admin/kurum-ayari-duzenle.cjs`)

| Durum                                                                                     | Yanıt                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dosya ekran açıldıktan sonra değişti (başka admin ya da sunucuda elle)                    | 409 `cakisma`: "Yeniden yükle". Editördeki metin korunur. Fark ön izlemesi, başkasının değiştirdiği ve bu kaydın ezeceği yolları ayrıca işaretler. Tüm dosya kipinde ekran, metnin eski hale dayandığını söyler. |
| İçerik JSON nesnesi değil                                                                 | 400 `json`. Hata satır ve sütun söyler, içerikten alıntı yapmaz.                                                                                                                                                 |
| İçerik 64 düzeyden derin iç içe                                                           | 400 `derinlik`                                                                                                                                                                                                   |
| İçerik 1 MB'tan büyük                                                                     | 413 `boyut` (ekran kaydetmeden önce uyarır)                                                                                                                                                                      |
| Üst düzey bölüm siliniyor, boşaltılıyor (`{}`, `[]`) ya da türü değişiyor (`null`, metin) | 428 `bolum-silme-onayi`: ayrıca onay gerekir. Ekran silinecek bölümleri sorar.                                                                                                                                   |
| Dolu bir sunucu adı alanı (`SUNUCU_ALANLARI`) siliniyor                                   | 428, aynı onay                                                                                                                                                                                                   |
| Bilinen sunucu adı alanında yeni bir kural ihlali                                         | 400 `sunucu-adi`: ihlalin yolu söylenir, değeri yazılmaz.                                                                                                                                                        |
| Geri yüklenen içerik adı verilen yedeğin içeriği değil                                    | 400 `yedek-uyusmuyor`; yedek yoksa `yedek-yok`                                                                                                                                                                   |
| Dosya repo çalışma ağacının içinde (yerel geliştirmede izlenen örnek dosya)               | 409 `repo-ici`: kaydedilmez. Denemek için dosyayı repo dışına kopyalayın.                                                                                                                                        |
| `KURUM_AYAR_DOSYASI` tanımsız ya da dosya yok                                             | Ekran salt okunur. Portal dosya ve dizin oluşturmaz.                                                                                                                                                             |
| Dosya salt okunur ya da dizine yazma izni yok (`EACCES` / `EPERM` / `EROFS`)              | `yazma-izni`: "dosyaya VE dizine yazma izni gerekir". Dosya değişmez.                                                                                                                                            |
| Disk dolu (`ENOSPC` / `EDQUOT`)                                                           | `disk-dolu`. Dosya değişmez.                                                                                                                                                                                     |
| Yedek dizini dizin değil (dosya / sembolik bağ)                                           | `yedek-dizini`. Dosya değişmez.                                                                                                                                                                                  |
| Aynı kullanıcı dakikada 10'dan fazla kayıt yaptı                                          | 429                                                                                                                                                                                                              |

**Hata yanıtı.** Kayıttaki 5xx hatalar (`yazma-izni`, `disk-dolu`, `yedek-dizini`, `dogrulama`,
`yazma-hatasi`, `env-yok`) **424** olarak döner; asıl kod `upstreamStatus`ta, `nginxRed: true`
(`server/util/nginx-red.cjs` kalıbı). Kurumsal nginx 5xx gövdesini HTML sayfasıyla değiştirir; böylece
izin hatasının metni ekrana ulaşır.

**Salt okunur dosya.** `rename` yalnız dizin yazma izni ister: salt okunur bir dosyanın üstüne de
yazardı. Portal bunu yapmaz; dosyada yazma izni yoksa kayıt `yazma-izni` ile reddedilir. Dosyayı
Portal'dan değiştirilemez kılmak için salt okunur yapmak yeterlidir.

**Sunucu adı denetimi.** Okuyan taraf, `sunucuListesi`, `sunucuHaritasi` ve `sunucuAdi` ile okunan
alanlarda ve `nginx.rvp` (RP Seçimi: `sunucular` anahtarları, `kutular` listeleri) içinde kurala uymayan
girdiyi sessizce atar; yalnız "n geçersiz girdi atıldı" der. Bir yazım hatası böylece sunucuyu
otomasyondan düşürürdü. Bu yüzden kayıt yeni ihlali **reddeder**.

- Kural: harfle başlar; harf, rakam, tire. Kural tek yerdedir (`shared/kurumAyari.cjs` `SUNUCU`).
- Denetlenen alanlar `SUNUCU_ALANLARI` listesindedir.
- Dosyada zaten bulunan bir ihlal ilgisiz bir bölümün kaydını engellemez. Engellenen yalnız yeni
  ihlaldir; tekrar sayılır (eskide bir kez olan bozuk değerin ikinci kopyası yeni ihlaldir).
- Geri yükleme de bu kurala tabidir: yedekte, güncel dosyada artık olmayan geçersiz bir ad varsa geri
  yükleme reddedilir ve ekran ihlalin yolunu gösterir. Okuyucunun sessizce atacağı adı geri getirmek
  korunan hatanın ta kendisidir; önce adı düzeltin.
- Kod yeni bir sunucu adı alanı okumaya başlarsa listeye eklenmesi gerekir. Bekçi:
  `server/admin/__tests__/kurum-ayari-duzenle.test.js` KA16 (`sunucu*()` çağrıları ve `SUNUCU` ile süzen
  `bolum(...)` okuyucuları; modülün kendi `SUNUCU` regex'ini tanımlaması yasak). Kör nokta: anahtarı
  değişkenle verilen çağrı ve `kurumAyari().veri` üzerinden doğrudan okuyan kod.
- Kapsam dışı: `nginx.ortamIstisnalari` anahtarları sunucu adı kuralıyla süzülmez (okuyucu atmaz).
- Reddedilen yanıtın yolu (`nginx.apiKumeleri.<küme>[i]`) kurum anahtar adlarını içerebilir ve
  `[API hata]` sunucu loguna düşer. Değer yazılmaz; log iç sunucudadır, repoya girmez (kabul edildi).

**Yedek.** Dosyanın yanındaki `<dosya>.yedek/` alt dizinine yazılır, ör.
`kurum-ayari.json.yedek/20261127T101112345Z.json` (aynı milisaniyede `-1`, `-2`, ...).

- Alt dizin `0700`, yedekler `0600` izinle oluşur. Dizin önceden varsa gerçek dizin olmalıdır (dosya ya da
  sembolik bağsa kayıt reddedilir); izni gevşekse `0700`'e daraltılır.
- En yeni 30 yedek tutulur, eskileri budanır. Sıra ad (zaman, sonra ek sayısı) ile; az önce alınan
  yedek hiç budanmaz (saat geri gitse de). Kalıba uymayan dosyalara dokunulmaz.
- Yazma başarısız olursa yeni alınan yedek silinir (kotayı yemez); yarıda kalan yedek de silinir.
- Yedek adı istemciden yalnız bu sıkı kalıpla kabul edilir (yol geçişi yok).

**Atomik yazma.** Yeni içerik aynı dizinde geçici bir dosyaya yazılır, `fsync` edilir ve `rename` ile
dosyanın yerine konur.

- Özgün dosya modu korunur. Sahiplik korunmaz: dosya Portal kullanıcısına ait olmalıdır.
- `KURUM_AYAR_DOSYASI` sembolik bağsa bağın hedefi yazılır, bağ korunur.
- Yazımdan sonra okuyucu dosyayı yeniden okur; verinin gönderilenle aynı olduğunu doğrular.
- Okuyucu önbelleği yol, değişiklik zamanı, boyut, inode ve ctime ile tutulur: kaba saat çözünürlüklü
  dosya sisteminde aynı tikte aynı boyutla yapılan elle düzenleme de görülür.

**Denetim.** Her kayıt Portal denetim kaydına (`portal_audit_logs`, Admin › Denetim Kaydı) yazılır.

- Eylem `kurum_ayari_update`, geri dönüşte `kurum_ayari_restore` (yalnız içerik o yedeğinkiyle aynıysa).
- Ayrıntıda dosya adı, eski ve yeni sha, yedek adı ve değişen anahtar yolları bulunur. **Değerler
  yazılmaz.** Kategori başına 40 yol; fazlası `(+N)` ile söylenir.
- Değişen yollar yazmadan **önce** hesaplanır. Yazma aşamasındaki her hata (izin, disk, doğrulama,
  beklenmeyen) `result=fail` ile, `code=` ve yollarla kaydedilir: dosyaya yazılıp denetime düşmeyen
  değişiklik olmaz.

**Bilinen sınırlar.**

- Bölüm kipinde kayıt dosyayı `JSON.stringify` ile yeniden yazar: girinti iki boşluk olur, `1.0` → `1`,
  tamsayı biçimli anahtarlar öne sıralanır, 2^53 üstü tamsayı hassasiyet kaybeder (fark ön
  izlemesi bunu göstermez). Böyle bir değer varsa tüm dosya kipini kullanın; metin olduğu gibi yazılır.
- Yinelenen JSON anahtarında `JSON.parse` sonuncuyu alır.
- Çakışma kilidi süreç içidir; birden çok Portal süreci aynı dosyaya yazarsa sha kontrolü ile rename
  arasındaki dar pencere korunmaz.
- Ekran ve sunucu aynı JSON gövde sınırını (2 MB) paylaşır; kaçış karakterleriyle şişen, 1 MB'a yakın
  içerik uygulamanın 413'ü yerine Express'in kendi 413'ünü alabilir.

**Sunucu hazırlığı.** Portal'ın çalıştığı kullanıcının dosyaya **ve bulunduğu dizine** yazma izni
olmalıdır; dosyanın sahibi de Portal kullanıcısı olmalıdır (rename sahipliği Portal'a geçirir). Yedek alt
dizini ve geçici dosya o dizinde oluşur. Elle düzenleme hâlâ mümkündür. Elle yapılan değişiklik ekranda
açık olan bir düzenlemeyle çakışırsa ekran 409 verir.

Yerel geliştirmede `.env.example` izlenen `deploy/kurum-ayari.ornek.json`'u gösterir: ekran onu okur ama
kaydetmez (`repo-ici`). Düzenlemeyi denemek için dosyayı repo dışına kopyalayıp `KURUM_AYAR_DOSYASI`'nı
oraya çevirin; gerçek kurum adlarını repoya giren hiçbir dosyaya yazmayın (K17).
