// src/components/server_hub/__tests__/toplu-siniflama.test.ts — Toplu iş başarısızlık kategorileri (2026-11-15).
//
//   TS1 GERÇEK mesajlar (toplu-autostart.cjs, toplu-restart.cjs, autostart-dogrulama.cjs, Ansible server_hub_fix.sh;
//       betik mesajı Portal'da "canlı okumada: <mesaj>" olarak öğeye yazılır) doğru kümeye düşer
//   TS2 sıra: domain kapalı > tarama eski ("artık aday değil (JBoss 8 domain kapalı ...)"); İPTAL durumu metinle
//       ezilir ("plan eskidi"); YARIM_KALDI "AWX'e gitmiş olabilir" iptal kümesi (bağlantı değil); "AWX çıktısına bakın"
//       tek başına bağlantı değildir
//   TS3 sayım: yalnız başarısız durumlar, yalnız sıfır olmayan kümeler, sabit sıra; süzme
//   TS5 host XML (2026-11-15): server_hub_fix.sh jboss_autostart_xml_off şablonları ve Portal sarmalayıcıları
import { describe, it, expect } from 'vitest';
import {
  AUTOSTART_BASARISIZ,
  KATEGORI,
  KATEGORI_SIRASI,
  RESTART_BASARISIZ,
  kategoriSayimi,
  kategoriyeGore,
  siniflandir,
  type TopluKategori,
} from '@/components/server_hub/topluSiniflama';

const ORNEK: [string, string, TopluKategori][] = [
  // ── host controller / domain kapali ──
  [
    'FAIL',
    "canlı okumada: host controller'a baglanilamadi ya da adi okunamadi (controller orbfaa01:9990, :read-attribute(name=local-host-name)): Failed to connect to the controller: The controller is not available at orbfaa01:9990: java.net.ConnectException: WFLYPRT0053: Could not connect to remote+http://orbfaa01:9990. The connection failed: Connection refused - HICBIR SEY DEGISMEDI (auto-start / server-config yalniz calisan host controller uzerinden degisir; XML elle duzenlenmez)",
    'hc_kapali',
  ],
  [
    'DUSTU',
    "canlı okumada: host controller'a baglanilamadi ya da adi okunamadi (controller x:9990, :read-attribute(name=local-host-name)): - HICBIR SEY DEGISMEDI",
    'hc_kapali',
  ],
  [
    'DUSTU',
    'seçim doğrulamasında düştü: artık aday değil (JBoss 8 domain kapalı (taramada host controller çalışmıyordu) — auto-start canlı okunamaz; iş açılmaz.)',
    'hc_kapali',
  ],
  [
    'DUSTU',
    'onay anında: JBoss 7 domain kapalı (taramada host controller çalışmıyordu) — auto-start canlı okunamaz; iş açılmaz.',
    'hc_kapali',
  ],
  // metin kesilse de (M(..., 1000)) "domain kapalı" tek başına yeter
  ['DUSTU', 'seçim doğrulamasında düştü: artık aday değil (JBoss 7 domain kapalı', 'hc_kapali'],
  // ── ortam / yetki ──
  [
    'DUSTU',
    'canlı okumada: yedek dizini acilamadi: /sw/WAS_IMAGES/server-hub-backup/GBX - mkdir: cannot create directory: Permission denied - HICBIR SEY DEGISMEDI',
    'ortam_yetki',
  ],
  [
    'FAIL',
    'jboss-cli was olarak kosulmuyor (betik www ile kostu; fix play become_user was olmali)',
    'ortam_yetki',
  ],
  ['FAIL', 'gecici dizin acilamadi', 'ortam_yetki'],
  [
    'FAIL',
    "dzdo izin vermedi (www -> was): kural listesine '/usr/jboss/bin/jboss-cli.sh' eklenmeli",
    'ortam_yetki',
  ],
  ['FAIL', "Sorry, user www is not allowed to execute '/bin/bash -lc ...' as was", 'ortam_yetki'],
  // ── tarama eski / zaten hedefte ──
  [
    'DUSTU',
    'canlı değer zaten false — tarama eski (app1 auto-start zaten false (host=master, CLI))',
    'tarama_eski',
  ],
  ['SKIP', 'app1 auto-start zaten false (host=master, CLI)', 'tarama_eski'],
  ['DUSTU', 'seçim doğrulamasında düştü: artık aday değil (tarama değişti)', 'tarama_eski'],
  ['DUSTU', 'seçim doğrulamasında düştü: artık aday değil (eylem değişti)', 'tarama_eski'],
  ['IPTAL', 'plan eskidi (15 dk)', 'tarama_eski'],
  ['IPTAL', 'önizleme eskidi (15 dk)', 'tarama_eski'],
  ['DUSTU', 'önizlemede düştü: fark kalmadı', 'tarama_eski'],
  ['DUSTU', 'önizlemede düştü: JVM artık çalışmıyor', 'tarama_eski'],
  [
    'DUSTU',
    "onay anında: app1 son taramada ÇALIŞIYOR — çalışan JVM'in auto-start'ı kapatılmaz (betik reddeder); iş açılmadı. Önce JVM'i durdurun, sonra sunucuyu yeniden tarayın.",
    'tarama_eski',
  ],
  [
    'FAIL',
    "app1 su an CALISIYOR; calisan JVM'in auto-start'i kapatilmaz (FORCE=true ile zorlanabilir)",
    'tarama_eski',
  ],
  // ── tanim ──
  [
    'DUSTU',
    "canlı okumada: app1 bu host controller'da (host=master) tanimli degil - HICBIR SEY DEGISMEDI",
    'tanim',
  ],
  [
    'DUSTU',
    'seçim doğrulamasında düştü: Taramada bu sunucuda aynı adlı JVM iki kez var (iki kayıt) — hangisi olduğu belirsiz, iş açılmaz; sunucu ayrıntısından bakın.',
    'tanim',
  ],
  ['FAIL', "app1 auto-start ifade (${...}) ile tanimli; Portal'dan degistirilmez (elle)", 'tanim'],
  // ── iptal / yarim kaldi ──
  ['IPTAL', 'iptal edildi', 'iptal'],
  ['IPTAL', 'iptal edildi (çalıştırılmadı)', 'iptal'],
  ['YARIM_KALDI', 'Portal yeniden başladı — çalıştırılmadı', 'iptal'],
  [
    'YARIM_KALDI',
    "AWX'e gitmiş olabilir — AWX'ten kontrol edin, sonra sunucuyu yeniden tarayın",
    'iptal',
  ],
  [
    'YARIM_KALDI',
    "iş numarası yazılamadı — AWX'e gitmiş olabilir; AWX'ten kontrol edin, sonra sunucuyu yeniden tarayın",
    'iptal',
  ],
  ['DUSTU', 'kayıt yarım kaldı', 'iptal'],
  // ── baglanti / sure / AWX ──
  ['DUSTU', 'plan başlatılamadı: AWX 503', 'baglanti_sure'],
  ['DUSTU', "plan işi #77 3 saatte bitmedi — AWX'ten kontrol edin", 'baglanti_sure'],
  [
    'FAIL',
    "iş #88 3 saatte bitmedi — sonucu AWX'ten kontrol edin, sonra sunucuyu yeniden tarayın",
    'baglanti_sure',
  ],
  ['FAIL', 'iş başlatılamadı: ETIMEDOUT', 'baglanti_sure'],
  ['FAIL', 'sonuç okunamadı (iş #9 failed)', 'baglanti_sure'],
  ['FAIL', 'canlı okumada: cli_timeout', 'baglanti_sure'],
  [
    'DUSTU',
    "seçim doğrulanamadı: 10 dakikada başarılamadı — taze değerlendirme (TBMWANS kapalı); JVM'e dokunulmadı",
    'baglanti_sure',
  ],
  [
    'FAIL',
    "restart isteği belirsiz hatayla döndü (AWX'te sürüyor olabilir): socket hang up — AWX'ten kontrol edin, sonra sunucuyu yeniden tarayın",
    'baglanti_sure',
  ],
  [
    'DUSTU',
    "önizlemede düştü: tarama işi #5 failed; sonuç (set_stats) okunamadı — AWX'ten kontrol edin",
    'baglanti_sure',
  ],
  ['FAIL', 'host GBX unreachable', 'baglanti_sure'],
  // ── diger ──
  [
    'FAIL',
    'restart işi #4 bitti ama JVM STARTED olmadı (30 × 5 sn) — AWX çıktısına bakın; aynı uygulamanın bekleyen kopyaları atlandı',
    'diger',
  ],
  [
    'KAPANMADI',
    "restart edildi ama fark kapanmadı — tarama yanlış uyarı veriyor olabilir (server-group jvm ayarı domain.xml'de olabilir ya da host XML diskte değişmiş ama host controller yeniden yüklenmemiş olabilir)",
    'diger',
  ],
  [
    'FAIL',
    'restart sonrası taramada JVM çalışmıyor (iş #4) — aynı uygulamanın bekleyen kopyaları atlandı',
    'diger',
  ],
  [
    'ATLANDI',
    "aynı uygulamanın kopyası A/app1 restart'ta ayağa kalkmadı — bu kopya korunmak için çalıştırılmadı",
    'diger',
  ],
  ['FAIL', 'CLI basarili gorundu ama geri okunan auto-start=true (host=master)', 'diger'],
  ['FAIL', '', 'diger'],
];

// İnceleme (2026-11-15) bulguları: her satır kaynaktaki GERÇEK şablondan (yer tutucular örnek değerle).
const INCELEME: [string, string, TopluKategori][] = [
  // B-F1 bayat tarama -> tarama eski (autostart-dogrulama.cjs:97 onay anında / atlandı; toplu-restart.cjs:199)
  [
    'DUSTU',
    'onay anında: ORX01 taraması bayat (bayat kanıt: 2026-11-10) — auto-start değiştirilemez, iş açılmadı. Önce sunucuyu yeniden tarayın.',
    'tarama_eski',
  ],
  [
    'DUSTU',
    'atlandı: ORX01 taraması bayat (bayat kanıt: 2026-11-10, son yükleme dışlandı) — auto-start değiştirilemez, iş açılmadı. Önce sunucuyu yeniden tarayın.',
    'tarama_eski',
  ],
  ['ATLANDI', 'atlandı: tarama bayat (2026-11-10) — önce sunucuyu yeniden tarayın.', 'tarama_eski'],
  [
    'DUSTU',
    'önizlemede düştü: tarama bayat (2026-11-10, son yükleme dışlandı) — önce sunucuyu yeniden tarayın.',
    'tarama_eski',
  ],
  // B-F2 "artık aday değil (<iç neden>)": iç neden kazanır (toplu-autostart.cjs:486 / toplu-restart.cjs:643)
  [
    'DUSTU',
    'seçim doğrulamasında düştü: artık aday değil (Taramada bu sunucuda aynı adlı JVM iki kez var (iki kayıt) — hangisi olduğu belirsiz, iş açılmaz; sunucu ayrıntısından bakın.)',
    'tanim',
  ],
  [
    'DUSTU',
    'seçim doğrulamasında düştü: artık aday değil (JBoss sürümü (7/8) taramada belirlenemedi — iş açılmaz.)',
    'tanim',
  ],
  [
    'DUSTU',
    'seçim doğrulamasında düştü: artık aday değil (ORX01 taraması bayat (bayat kanıt: 2026-11-10) — auto-start değiştirilemez, iş açılmadı. Önce sunucuyu yeniden tarayın.)',
    'tarama_eski',
  ],
  // B-F3 server_hub_fix.sh backup() "yedek alinamadi: $1 -> $BK"
  [
    'FAIL',
    'canlı okumada: yedek alinamadi: /usr/jboss8/domain/configuration/host.xml -> /sw/WAS_IMAGES/server-hub-backup/ORX01/20261115',
    'ortam_yetki',
  ],
  // B-F4 ortam / tanım / tarama
  [
    'DUSTU',
    "onay anında: ORX01 üzerinde app1 yalnız envanterde (MWAppsInventory) — taramada JVM'i yok, auto-start değiştirilemez; iş açılmadı.",
    'tanim',
  ],
  [
    'ATLANDI',
    "atlandı: envanterde (MWAppsInventory) eşleşen uygulama yok — OpsX restart'ı uygulama adıyla çalışır; OpsX'ten tek tek.",
    'tanim',
  ],
  ['DUSTU', 'önizlemede düştü: JBoss sürümü (7/8) bilinmiyor.', 'tanim'],
  ['DUSTU', 'önizlemede düştü: fark artık ölçülemiyor', 'tarama_eski'],
  ['DUSTU', 'önizlemede düştü: JVM yeni taramada yok', 'tarama_eski'],
  ['FAIL', 'jboss-cli yok (/usr/jboss8/bin) - HICBIR SEY DEGISMEDI', 'ortam_yetki'],
  [
    'FAIL',
    "CLI hatasi: Error: Could not find or load main class org.jboss.modules.Main java: '/usr/jboss8/jdk/bin/java' yok, JAVA_HOME='/usr/jboss/jdk' gecersiz; PATH'teki java denendi",
    'ortam_yetki',
  ],
  [
    'FAIL',
    "canlı okumada: host controller'a baglanilamadi ya da adi okunamadi (controller x:9990, :read-attribute(name=local-host-name)): java: '/usr/jboss8/jdk/bin/java' yok, JAVA_HOME='' gecersiz; PATH'teki java denendi - HICBIR SEY DEGISMEDI",
    'ortam_yetki',
  ],
  // B-F5 "Connection refused" yalnız controller bağlamında host controller
  [
    'DUSTU',
    "seçim doğrulanamadı: 10 dakikada başarılamadı — Taze değerlendirme okunamadı (connect ECONNREFUSED 10.1.1.1:1433 Connection refused); JVM'e dokunulmadı",
    'baglanti_sure',
  ],
  [
    'FAIL',
    'WFLYPRT0053: Could not connect to remote+http://orbfaa01:9990. The connection failed',
    'hc_kapali',
  ],
  // B-F6 hiç çalıştırılmayan satır (toplu-restart.cjs topluDurdur): içteki neden başka öğenindir
  [
    'ATLANDI',
    "atlandı: toplu iş durduruldu: ORX01/app1 restart isteği belirsiz hatayla döndü (AWX'te sürüyor olabilir): socket hang up — sonucu AWX'ten kontrol edin, sonra kalanlar için yeni toplu iş açın",
    'iptal',
  ],
  [
    'ATLANDI',
    "atlandı: toplu iş durduruldu: ORX01/app1 host controller'a baglanilamadi — sonucu AWX'ten kontrol edin, sonra kalanlar için yeni toplu iş açın",
    'iptal',
  ],
  [
    'ATLANDI',
    "atlandı: prod — OpsX'ten tek tek (Smart onayı; toplu restart prod'a dokunmaz).",
    'diger',
  ],
  // B-F7 restart kanıtı yok -> kardeşleriyle aynı küme; şema okunamadı Portal tarafı
  [
    'FAIL',
    'restart kanıtı yok: set_stats STARTED yok ve süreç başlangıç zamanı ölçülemedi (iş #12) — AWX çıktısına bakın',
    'diger',
  ],
  ['ATLANDI', 'atlandı: Server Hub şeması (sys.columns) okunamadı — eylem önerilmez.', 'diger'],
  [
    'DUSTU',
    "plan okunamadı (iş #123 failed; set_stats yok — AWX'teki server_hub_fix.yml jboss_autostart_items kipini tanımıyor olabilir (playbook güncel mi?))",
    'ortam_yetki',
  ],
];

// HOST XML (2026-11-15): server_hub_fix.sh jboss_autostart_xml_off `result FAIL` / ITEM şablonları (yer tutucular örnek
// değerle) ve Portal sarmalayıcıları (toplu-autostart.cjs: "host XML planında: ", "atlandı: ", topluDurdur).
const HOST_XML: [string, string, TopluKategori][] = [
  // host controller şimdi çalışıyor / yazma sırasında açıldı -> domain artık kapalı değil: tarama eski (hc_kapali değil)
  [
    'DUSTU',
    "host XML planında: JBoss 8 host controller / process controller CALISIYOR (yonetim portu 9998 dinleniyor (host controller ps'te gorunmuyor ama port acik)) - XML yolu yalniz domain kapaliyken; calisan domain'de auto-start CLI ile (jboss_autostart_off) degisir - HICBIR SEY DEGISMEDI",
    'tarama_eski',
  ],
  [
    'FAIL',
    'host controller yazma sirasinda acildi - XML degisikligi geri alindi (/usr/jboss8/domain/configuration/host.xml yedekten: /sw/WAS_IMAGES/server-hub-backup/ORX01/20261115-101010/host.xml); HC yeni icerigi okumus olabilir - etkin auto-start belirsiz, sonraki taramayi bekleyin',
    'tarama_eski',
  ],
  [
    'FAIL',
    'host controller yazmadan once acildi ya da ps okunamadi (pid 4242 java -D[Host Controller]) - HICBIR SEY DEGISMEDI',
    'tarama_eski',
  ],
  [
    'FAIL',
    "app1 su an CALISIYOR (ps) - calisan JVM'in auto-start'i bu yoldan kapatilmaz - HICBIR SEY DEGISMEDI",
    'tarama_eski',
  ],
  [
    'FAIL',
    '/usr/jboss8/domain/configuration/host.xml bu sirada degisti - HICBIR SEY DEGISMEDI',
    'tarama_eski',
  ],
  [
    'DUSTU',
    "onay anında: app1 (JBoss 8) domain'i kapalı görünmüyor (taramada host controller çalışıyordu ya da ölçülemedi) — host XML yolu yalnız domain kapalıyken açılır; çalışan domain'de satırdaki Auto-start Kapat'ı kullanın; iş açılmadı.",
    'tarama_eski',
  ],
  [
    'DUSTU',
    "host XML'de auto-start zaten false — tarama eski (auto-start zaten false (host.xml))",
    'tarama_eski',
  ],
  // dosya betikle güvenle değiştirilemiyor: elle
  [
    'FAIL',
    'host controller yazma sirasinda acildi ve GERI ALMA BASARISIZ - /usr/jboss8/domain/configuration/host.xml elle /sw/WAS_IMAGES/server-hub-backup/ORX01/20261115-101010/host.xml ile geri yazilmali',
    'elle',
  ],
  [
    'DUSTU',
    'host XML planında: /usr/jboss8/domain/configuration/host.xml sembolik bag; elle duzenlenmeli - HICBIR SEY DEGISMEDI',
    'elle',
  ],
  [
    'DUSTU',
    'host XML planında: /usr/jboss8/domain/configuration/host.xml sert bagli (2 ad; mv bagi koparir); elle - HICBIR SEY DEGISMEDI',
    'elle',
  ],
  [
    'DUSTU',
    "host XML planında: /usr/jboss8/domain/configuration/host.xml ACL tasiyor (ls '+'; gecici dosya + mv ACL'yi korumaz); elle - HICBIR SEY DEGISMEDI",
    'elle',
  ],
  [
    'DUSTU',
    'host XML planında: host XML dosyasi kesin belirlenemedi (/usr/jboss8/domain/configuration: domain.conf ayari, host.xml ya da tek aday yok / birden fazla aday) - HICBIR SEY DEGISMEDI',
    'elle',
  ],
  [
    'DUSTU',
    "host XML planında: domain.conf varsayilan disi domain dizini ayarliyor: -Djboss.domain.base.dir=/data/dom - secilen /usr/jboss8/domain/configuration/host.xml gercek domain'in dosyasi olmayabilir; elle - HICBIR SEY DEGISMEDI",
    'elle',
  ],
  [
    'DUSTU',
    'host XML planında: /usr/jboss8/domain/configuration/host.xml ayristirilamadi: kapanmamis XML yorumu (<!--) - HICBIR SEY DEGISMEDI',
    'elle',
  ],
  [
    'FAIL',
    'sahip/izin/SELinux baglami korunamiyor (/usr/jboss8/domain/configuration/host.xml 501:501:600:system_u:object_r:usr_t:s0, kopya 501:501:600:?) - HICBIR SEY DEGISMEDI',
    'elle',
  ],
  [
    'DUSTU',
    'host XML planında: /usr/jboss8/domain/configuration/host.xml grubu farkli: gecici dosya + mv sahibi/grubu koruyamaz; elle - HICBIR SEY DEGISMEDI',
    'elle',
  ],
  [
    'DUSTU',
    "host XML planında: dogrulama (xmllint xpath): <server> sayisi '4' -> '3' - HICBIR SEY DEGISMEDI",
    'elle',
  ],
  [
    'DUSTU',
    'host XML planında: dogrulama: auto-start ozniteligi disinda fark var - HICBIR SEY DEGISMEDI',
    'elle',
  ],
  [
    'FAIL',
    "yazildi ama geri okunan app1 '1\tv:true' (yedek /sw/WAS_IMAGES/server-hub-backup/ORX01/20261115-101010/host.xml)",
    'elle',
  ],
  // ITEM satırları: tanım
  ['DUSTU', 'host XML planında: host.xml icinde <servers> altinda tanimli degil', 'tanim'],
  ['DUSTU', 'host XML planında: host.xml icinde 2 kez tanimli (tek olmali)', 'tanim'],
  ['DUSTU', 'host XML planında: auto-start ifade (${...}) ile tanimli; elle', 'tanim'],
  ['DUSTU', 'host XML planında: beklenmeyen auto-start degeri: yes', 'tanim'],
  // başka JVM reddedildi: bu JVM denenmedi
  ['FAIL', 'istek durduruldu (baska JVM reddedildi)', 'iptal'],
  [
    'FAIL',
    "istek durduruldu (baska JVM reddedildi): app2 su an CALISIYOR (ps) - calisan JVM'in auto-start'i bu yoldan kapatilmaz - HICBIR SEY DEGISMEDI",
    'iptal',
  ],
  [
    'YARIM_KALDI',
    'çalıştırılmadı: toplu iş durduruldu — ORX01 host XML işi #5 yazıldı ama geri okunan dosya beklenenden farklı (etkin auto-start belirsiz). Önce o sunucudaki host XML dosyasını yedekle karşılaştırın (yedek yolu öğe satırında; gerekirse elle geri yazın), sunucuyu yeniden tarayın, sonra yeni toplu iş açın.',
    'iptal',
  ],
  [
    'YARIM_KALDI',
    'çalıştırılmadı: toplu iş durduruldu — ORX01 host XML işi #5 geri almada başarısız (dosya elle geri yazılmalı). Önce o sunucudaki host XML dosyasını yedekten elle geri yazın (yedek yolu öğe satırında), sunucuyu yeniden tarayın, sonra yeni toplu iş açın.',
    'iptal',
  ],
  // ortam / yetki
  [
    'FAIL',
    'yedek yolu dolu: /sw/WAS_IMAGES/server-hub-backup/ORX01/20261115-101010/host.xml.4242 - HICBIR SEY DEGISMEDI',
    'ortam_yetki',
  ],
  [
    'DUSTU',
    'host XML planında: host XML was olarak duzenlenir; betik www ile kostu (fix play become_user was olmali) - HICBIR SEY DEGISMEDI',
    'ortam_yetki',
  ],
  [
    'FAIL',
    'flock yok; ayni dosyaya eszamanli is engellenemez - HICBIR SEY DEGISMEDI',
    'ortam_yetki',
  ],
  [
    'DUSTU',
    'host XML planında: /usr/jboss8/domain/configuration/host.xml okunamiyor - HICBIR SEY DEGISMEDI',
    'ortam_yetki',
  ],
  [
    'FAIL',
    '/usr/jboss8/domain/configuration icinde gecici dosya acilamadi - HICBIR SEY DEGISMEDI',
    'ortam_yetki',
  ],
  ['FAIL', 'yeni icerik gecici dosyaya yazilamadi - HICBIR SEY DEGISMEDI', 'ortam_yetki'],
  [
    'FAIL',
    'mv basarisiz (/usr/jboss8/domain/configuration/host.xml) - HICBIR SEY DEGISMEDI',
    'ortam_yetki',
  ],
  // inceleme #6: dosya / ps hiç okunamadı -> ortam / yetki (bağlantı değil)
  [
    'DUSTU',
    "host XML planında: ps okunamadi; host controller'in kapali oldugu dogrulanamadi - HICBIR SEY DEGISMEDI",
    'ortam_yetki',
  ],
  [
    'DUSTU',
    'host XML planında: /usr/jboss8/domain/configuration/host.xml okunamadi - HICBIR SEY DEGISMEDI',
    'ortam_yetki',
  ],
  // eşzamanlı iş / ps / AWX
  [
    'FAIL',
    '/usr/jboss8/domain/configuration uzerinde baska bir host XML isi suruyor (kilit) - HICBIR SEY DEGISMEDI',
    'baglanti_sure',
  ],
  [
    'DUSTU',
    'atlandı: XNP01 üzerinde JBoss 7 host XML işi #77 hâlâ sürüyor — aynı dosyaya ikinci iş açılmaz.',
    'baglanti_sure',
  ],
  [
    'DUSTU',
    "plan okunamadı (iş #9 failed; set_stats yok — AWX'teki server_hub_fix.yml jboss_autostart_xml_off kipini tanımıyor olabilir (playbook güncel mi?))",
    'ortam_yetki',
  ],
  // prod onayı yok: Portal tarafı
  [
    'DUSTU',
    'seçim doğrulamasında düştü: XNP01 Production / ortamı bilinmeyen sunucu — prod onayı verilmedi (host XML ile kapatılmaz)',
    'diger',
  ],
];

describe('topluSiniflama', () => {
  it('TS5 host XML (jboss_autostart_xml_off) mesajları: elle / tarama eski / tanım / iptal / ortam', () => {
    for (const [durum, neden, beklenen] of HOST_XML)
      expect([neden, siniflandir(neden, durum)]).toEqual([neden, beklenen]);
    expect(KATEGORI_SIRASI.indexOf('elle')).toBe(KATEGORI_SIRASI.indexOf('tanim') + 1);
    expect(KATEGORI.elle.etiket).toMatch(/host XML/);
    expect(KATEGORI.hc_kapali.ne).toMatch(
      /“Domain kapalı — auto-start host XML üzerinden kapat” bölümünden/,
    );
    // CLI host controller mesajındaki "XML elle duzenlenmez" elle kümesine düşmez
    expect(
      siniflandir(
        "canlı okumada: host controller'a baglanilamadi - HICBIR SEY DEGISMEDI (auto-start / server-config yalniz calisan host controller uzerinden degisir; XML elle duzenlenmez)",
        'DUSTU',
      ),
    ).toBe('hc_kapali');
  });

  it('TS4 inceleme bulguları: gerçek şablonlar doğru kümede', () => {
    for (const [durum, neden, beklenen] of INCELEME)
      expect([neden, siniflandir(neden, durum)]).toEqual([neden, beklenen]);
    expect(KATEGORI.iptal.etiket).toMatch(/durduruldu/);
    expect(KATEGORI.diger.ne).toMatch(/OpsX/);
  });

  it('TS1 gerçek mesajlar doğru kümeye düşer', () => {
    for (const [durum, neden, beklenen] of ORNEK)
      expect([neden, siniflandir(neden, durum)]).toEqual([neden, beklenen]);
    expect(siniflandir(null, 'FAIL')).toBe('diger');
    expect(siniflandir(null, 'IPTAL')).toBe('iptal');
  });

  it('TS2 her kümenin Türkçe etiketi ve "ne yapılır" satırı var; İptal yazımı', () => {
    for (const k of KATEGORI_SIRASI) {
      expect(KATEGORI[k].etiket.length).toBeGreaterThan(2);
      expect(KATEGORI[k].ne.length).toBeGreaterThan(20);
    }
    expect(KATEGORI.iptal.etiket).toMatch(/^İptal/);
    expect(Object.values(KATEGORI).some((x) => /Vazgeç/.test(x.etiket + x.ne))).toBe(false);
    expect(KATEGORI.hc_kapali.ne).toMatch(
      /domain açılınca sunucuyu yeniden tarayıp yeniden planlayın/,
    );
    expect(KATEGORI.ortam_yetki.ne).toMatch(/dzdo/);
  });

  it('TS3 sayım: yalnız başarısız, yalnız sıfır olmayan, sabit sıra; süzme', () => {
    const og = [
      { durum: 'OK', neden: 'app auto-start=false (host=m, CLI ile dogrulandi)' },
      { durum: 'FAIL', neden: 'Connection refused orbfaa01:9990' },
      { durum: 'DUSTU', neden: 'canlı değer zaten true — tarama eski' },
      { durum: 'FAIL', neden: "host controller'a baglanilamadi" },
      { durum: 'PLAN_GECTI', neden: 'canlı değer hâlâ uyumsuz' },
    ];
    expect(kategoriSayimi(og, AUTOSTART_BASARISIZ)).toEqual([
      { kategori: 'hc_kapali', adet: 2 },
      { kategori: 'tarama_eski', adet: 1 },
    ]);
    expect(kategoriyeGore(og, AUTOSTART_BASARISIZ, 'hc_kapali').map((o) => o.durum)).toEqual([
      'FAIL',
      'FAIL',
    ]);
    expect(kategoriyeGore(og, AUTOSTART_BASARISIZ, null)).toHaveLength(5);
    // secili kume bosaldiysa (yenilenen liste) hepsi
    expect(kategoriyeGore(og, AUTOSTART_BASARISIZ, 'iptal')).toHaveLength(5);
    expect(RESTART_BASARISIZ.has('KAPANMADI')).toBe(true);
    expect(RESTART_BASARISIZ.has('KAPANDI')).toBe(false);
    expect(AUTOSTART_BASARISIZ.has('OK')).toBe(false);
  });
});

// TS6 (2026-11-18, Sonar S8786): `/<yol> okunamadi - hicbir sey degismedi` dogrusal; anlam ayni.
describe('TS6 yol okunamadi deseni dogrusal ve ayni kumeyi yakalar', () => {
  it('yol + okunamadi -> ortam_yetki; yolsuz / yalniz egik cizgi -> yakalanmaz', () => {
    expect(siniflandir('/opt/jboss/standalone.xml okunamadi - hicbir sey degismedi')).toBe(
      'ortam_yetki',
    );
    expect(siniflandir('x /a/b okunamadi - hicbir sey degismedi')).toBe('ortam_yetki');
    expect(siniflandir('/ okunamadi - hicbir sey degismedi')).not.toBe('ortam_yetki');
    expect(siniflandir('dosya okunamadi - hicbir sey degismedi')).not.toBe('ortam_yetki');
  });
  it('uzun bosluksuz yol metninde hizli (eskisi 50 bin karakterde ~1 sn)', () => {
    const kotu = `/${'a/'.repeat(25000)}`;
    const bas = Date.now();
    siniflandir(kotu);
    expect(Date.now() - bas).toBeLessThan(200);
  });
});
