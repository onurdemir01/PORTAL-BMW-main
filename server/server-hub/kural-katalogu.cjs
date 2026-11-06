// server/server-hub/kural-katalogu.cjs - Server Hub tarama maddeleri ve bulgu seviyeleri (2026-10-20).
//
// Kullanici: "kritik, bilgi, uyari ve sorun yok olarak algilanan tarama maddeleri var. Ben hangi
// maddeler taraniyor ve hangi maddelerin hangi ciktilari kritik, uyari, bilgi ve sorun yok olarak
// algilaniyor? Bunlari liste halinde gorebilmek istiyorum ve istedigimde bunlarin kritiklik
// seviyesini degistirebilmek istiyorum."
//
// TEK KAYNAK: her tarama MADDESI, o maddenin CIKTILARI ve her ciktinin bulgu kodu + VARSAYILAN
// seviyesi. Varsayilan seviye assess.cjs'teki add('<seviye>', '<alan>', '<KOD>') ile AYNI olmali:
// bekci (__tests__/kural-katalogu.test.cjs) assess.cjs kaynagini tarar; katalogda olmayan kod,
// seviyesi tutmayan kod ya da assess'te artik uretilmeyen katalog kodu KIRMIZI.
// kod: null olan cikti "sorun yok" durumudur: bulgu uretilmez, seviyesi degistirilemez.
//
// Seviye degisikligi (ayarlar.cjs) yalniz bulgunun SEVIYESINI degistirir: sunucu durumu, sayaclar,
// siralama. Acilis Hazirligi ve ozet kartlari (reboot riski, retire adayi ...) KODA bakar; seviye
// degisse de onlar degismez.
//
// DOGRULAMA (2026-11-06, kullanici: "dogrulama icin ne yapilabilir ne eksik olabilir ne nasil kontrol
// edilsin gibi seyleri de eklesin bulgulara"): retire ile ilgili ciktilarda `dogrulama` uc parca
// tasir: neden (bulgu neye dayaniyor), eksik (taramanin goremeyecegi ne olabilir), kontrol (elle
// bakilacak komutlar; <JVM>, <EAR>, <GIRDI>, <ACCESS_LOG> yer tutucu).
//
// RETIREMENT ETIKETLERI (ETIKET_KURALLARI) bulgudan AYRIDIR: bulgu "ne goruldu", etiket "retire
// edilebilir mi" sorusudur. Hangi kuralin KESIN / SUPHELI / KAPALI oldugunu Admin degistirir
// (ayarlar.cjs 'etiket:<KURAL>'); varsayilanlar burada.
'use strict';

const SEVIYELER = ['danger', 'warning', 'info', 'ok'];

/** Alan etiketleri (ekran AREA ile ayni sozluk). */
const ALANLAR = {
  scan: 'Tarama',
  init: 'Init script',
  jboss: 'JBoss',
  jvm: 'JVM',
  web: 'Web sunucu',
  ip: 'IP',
  ssh: 'SSH',
  ear: 'Uygulama (EAR)',
};

// Ortak elle kontrol komutlari (JBoss 7: host=master, controller $HOSTNAME; JBoss 8: host=primary,
// controller $HOSTNAME:9998).
const CLI7 = (komut) => `jboss-cli.sh --connect --controller=$HOSTNAME --command="${komut}"`;
const CLI8 = (komut) => `jboss-cli8.sh --connect --controller=$HOSTNAME:9998 --command="${komut}"`;
const DEPLOYMENT_KONTROL = [
  CLI7('/host=master/server=<JVM>:read-children-resources(child-type=deployment,include-runtime=true,recursive=false)'),
  CLI8('/host=primary/server=<JVM>:read-children-resources(child-type=deployment,include-runtime=true,recursive=false)'),
];
const DURUM_KONTROL = [CLI7('ls host=master/server-config=<JVM>'), CLI8('ls host=primary/server-config=<JVM>')];
const TRAFIK_KONTROL = [
  "ls -lrt <ACCESS_LOG>*   # rotasyonla kac gunluk log var",
  "zgrep -h -v -E 'hc\\.(jsp|html)' <ACCESS_LOG>* | tail -5   # hc disi son istekler",
];
const TRAFIK_EKSIK =
  'Ayda / ceyrekte bir calisan is (batch, rapor); web katmani disindan dogrudan JVM portuna gelen istek; MQ, zamanlayici ya da EJB ile tetiklenen uygulama; 7 gunden eski log rotasyonu; DR / yedek sitedeki kopya.';

const MADDELER = [
  {
    id: 'yukleme',
    alan: 'scan',
    ad: 'Son tarama yüklemesi',
    neTaranir: 'Sunucunun son taraması veritabanına yüklendi mi (yükleyicinin dışlama kaydı).',
    ciktilar: [
      { kod: 'LOAD_EXCLUDED', kosul: 'Son tarama yüklenemedi; ekranda önceki yükleme gösterilir, eylem önerilmez.', seviye: 'warning' },
      { kod: null, kosul: 'Son tarama yüklendi.', seviye: 'ok' },
    ],
  },
  {
    id: 'envanter-cift',
    alan: 'scan',
    ad: 'AWX envanterinde çift kayıt',
    neTaranir: 'Aynı makine AWX envanterinde birden çok adla geçiyor mu.',
    ciktilar: [
      { kod: 'LOAD_DUPLICATE', kosul: 'Aynı makine AWX envanterinde iki farklı adla.', seviye: 'info' },
      { kod: null, kosul: 'Makine envanterde tek adla.', seviye: 'ok' },
    ],
  },
  {
    id: 'tarama-butunlugu',
    alan: 'scan',
    ad: 'Tarama bütünlüğü',
    neTaranir: 'Taramanın bir fazı zaman bütçesini (deadline) aştı mı ya da çıktı sigortası (fuse) devreye girdi mi.',
    ciktilar: [
      { kod: 'SCAN_PARTIAL', kosul: 'Tarama kısmi: bir faz zaman bütçesini aştı ya da çıktı sigortayla kesildi.', seviye: 'info' },
      { kod: null, kosul: 'Tarama tam.', seviye: 'ok' },
    ],
  },
  {
    id: 'web-varlik',
    alan: 'scan',
    ad: 'Web ürünü varlığı',
    neTaranir: 'IHS / RHA / Nginx sunucuda kurulu mu.',
    ciktilar: [
      { kod: 'WEB_PRESENCE_UNKNOWN', kosul: 'Ürünün kurulu olup olmadığı ölçülemedi (yetki / dzdo reddi) — “kurulu değil” sayılmaz.', seviye: 'info' },
      { kod: null, kosul: 'Varlık ölçüldü.', seviye: 'ok' },
    ],
  },
  {
    id: 'urun-kapsami',
    alan: 'scan',
    ad: 'Ürün kapsamı (envanter ↔ tarama)',
    neTaranir: 'Envanterdeki (dbo.Inventory) ürünler ile taramanın gördüğü ürünler aynı mı.',
    ciktilar: [
      { kod: 'PRODUCT_NOT_SCANNED', kosul: 'Envanterde ürün var ama tarama bu sunucuda göremedi (yetki ya da yol farkı olabilir).', seviye: 'warning' },
      { kod: 'PRODUCT_NOT_IN_INVENTORY', kosul: 'Taramada ürün bulundu ama envanterde yok.', seviye: 'info' },
      { kod: null, kosul: 'Envanter ve tarama aynı ürünleri gösteriyor.', seviye: 'ok' },
    ],
  },
  {
    id: 'tarama-maliyeti',
    alan: 'scan',
    ad: 'Tarama maliyeti',
    neTaranir: 'Taramanın sunucuda harcadığı CPU süresi.',
    ciktilar: [
      { kod: 'SCAN_COST', kosul: 'Tarama 10 sn’den fazla CPU harcadı.', seviye: 'info' },
      { kod: null, kosul: 'Tarama 10 sn ya da daha az CPU harcadı.', seviye: 'ok' },
    ],
  },
  {
    id: 'init-uyumu',
    alan: 'init',
    ad: 'Init script referans uyumu',
    neTaranir: 'Init script dosyalarının özeti (sha) filo çoğunluğuyla karşılaştırılır; uyum ölçütü start.sh.',
    ciktilar: [
      { kod: 'INIT_DIFF', kosul: 'Ölçüt dosyası (start.sh) filo çoğunluğundan farklı.', seviye: 'warning' },
      { kod: 'INIT_DIFF_OLCUT_DISI', kosul: 'Ölçüt dışı bir init dosyası çoğunluktan farklı (uyum sayımına girmez).', seviye: 'info' },
      { kod: 'INIT_HOST_SPECIFIC', kosul: 'Sunucuya özel dosya (JBoss kurulumunu tarif eder) çoğunluktan farklı — beklenen durum.', seviye: 'info' },
      { kod: 'INIT_MISSING', kosul: 'Dosya sunucuda yok.', seviye: 'info' },
      { kod: 'INIT_UNREADABLE', kosul: 'Dosya okunamadı (yetki / dzdo reddi) — var / yok / farklı olduğu bilinmiyor.', seviye: 'info' },
      { kod: null, kosul: 'Dosya filo çoğunluğuyla aynı.', seviye: 'ok' },
    ],
  },
  {
    id: 'jboss-cli',
    alan: 'jboss',
    ad: 'JBoss CLI erişimi (JBoss 7 / 8)',
    neTaranir: 'jboss-cli ile host controller’a bağlanılıp JVM tanımları okunabiliyor mu.',
    ciktilar: [
      { kod: 'CLI_DENIED', kosul: 'CLI dzdo yetki reddi aldı (dzdo kuralında jboss-cli yok).', seviye: 'warning' },
      { kod: 'CLI_FAIL', kosul: 'CLI denendi, cevap vermedi.', seviye: 'info' },
      { kod: 'CLI_SKIP', kosul: 'CLI hiç çalıştırılamadı (jboss-cli yok ya da host controller çalışmıyor).', seviye: 'info' },
      { kod: 'JBOSS_KALINTI', kosul: 'JBoss dizini var ama kullanılan bir kurulum görünmüyor (kalıntı).', seviye: 'info' },
      { kod: null, kosul: 'CLI okundu.', seviye: 'ok' },
    ],
  },
  {
    id: 'host-controller',
    alan: 'jboss',
    ad: 'JBoss host controller durumu',
    neTaranir: 'Host controller’ın çalışma durumu (CLI).',
    ciktilar: [
      { kod: 'HOST_RESTART', kosul: 'Host controller restart-required ya da reload-required.', seviye: 'warning' },
      { kod: null, kosul: 'Host controller running.', seviye: 'ok' },
    ],
  },
  {
    id: 'jvm-envanteri',
    alan: 'jvm',
    ad: 'Tanımlı JVM envanteri',
    neTaranir: 'JVM tanımları CLI ya da host XML’den okunabiliyor mu ve çalışan JVM’ler tanımda var mı.',
    ciktilar: [
      { kod: 'JVM_INVENTORY_UNMEASURED', kosul: 'CLI ve host XML okunamadı; liste yalnız ps’ten — durmuş JVM’ler listede olmayabilir.', seviye: 'warning' },
      { kod: 'JVM_UNDEFINED_PROCESS', kosul: 'Tanım kaynağı okundu ama ps’te çalışan bir JVM tanımda yok.', seviye: 'warning' },
      { kod: 'JVM_DATA_MISSING', kosul: 'Taramada JBoss var ama hiç JVM satırı gelmedi.', seviye: 'warning' },
      { kod: null, kosul: 'Tanım listesi okundu ve çalışan JVM’ler tanımlı.', seviye: 'ok' },
    ],
  },
  {
    id: 'jvm-calisma',
    alan: 'jvm',
    ad: 'JVM çalışma durumu ölçümü',
    neTaranir: 'JVM süreçleri ps ile görülebiliyor mu.',
    ciktilar: [
      { kod: 'RUNNING_UNMEASURED', kosul: 'Süreç görünmüyor (hidepid / ps körlüğü) ya da şema okunamadı — kapalı sayılmaz, eylem önerilmez.', seviye: 'info' },
      { kod: null, kosul: 'Çalışma durumu ölçüldü.', seviye: 'ok' },
    ],
  },
  {
    id: 'autostart',
    alan: 'jvm',
    ad: 'Auto-start ↔ çalışma durumu (reboot sonrası açılış)',
    neTaranir: 'JVM’in şu anki çalışma durumu ile auto-start ayarı uyumlu mu: reboot sonrası aynı durum geri gelir mi.',
    ciktilar: [
      { kod: 'REBOOT_RISK', kosul: 'JVM çalışıyor ama auto-start kapalı — reboot sonrası açılmaz.', seviye: 'danger' },
      {
        kod: 'STOPPED_AUTOSTART_ON',
        kosul: 'JVM kapalı ama auto-start açık — reboot’ta açılır.',
        seviye: 'danger',
        dogrulama: {
          neden: 'Tarama JVM sürecini görmedi (kapalı) ama tanımda auto-start açık: reboot sonrası kendiliğinden açılır.',
          eksik: 'JVM bilerek kapatılmış ve yeniden açılmaması gerekiyor olabilir (retire bekleyen uygulama); ya da tarama anında yeniden başlatılıyordu.',
          kontrol: [...DURUM_KONTROL, 'ps -ef | grep -- "-D\\[Server:<JVM>\\]"   # süreç gerçekten yok mu'],
        },
      },
      { kod: 'AUTOSTART_UNKNOWN', kosul: 'JVM çalışıyor, auto-start okunamadı (CLI / envanter) — “kapalı” sayılmaz.', seviye: 'info' },
      { kod: null, kosul: 'Çalışıyor + auto-start açık ya da kapalı + auto-start kapalı.', seviye: 'ok' },
    ],
  },
  {
    id: 'jvm-envanter-tutarliligi',
    alan: 'jvm',
    ad: 'JVM envanteri ↔ tarama',
    neTaranir: 'Middleware envanterinin (MWAppsInventory) çalışma durumu ve auto-start bilgisi taramayla aynı mı.',
    ciktilar: [
      { kod: 'INV_MISMATCH', kosul: 'Envanter çalışma durumu ya da auto-start’ta taramayla çelişiyor.', seviye: 'info' },
      { kod: null, kosul: 'Envanter ve tarama tutarlı.', seviye: 'ok' },
    ],
  },
  {
    id: 'jvm-restart',
    alan: 'jvm',
    ad: 'JVM restart gerekliliği',
    neTaranir: 'Çalışan JVM’in server-state değeri (CLI).',
    ciktilar: [
      { kod: 'RESTART_REQUIRED', kosul: 'JVM restart-required ya da reload-required: runtime’da etkin olmayan yapılandırma değişikliği var.', seviye: 'warning' },
      { kod: null, kosul: 'JVM running.', seviye: 'ok' },
    ],
  },
  {
    id: 'jvm-parametre',
    alan: 'jvm',
    ad: 'JVM parametreleri (yapılandırma ↔ çalışan süreç)',
    neTaranir: 'Çalışan JVM sürecinin parametreleri ile tanımdaki (host.xml / CLI jvm-options) parametreler aynı mı.',
    ciktilar: [
      {
        kod: 'JVM_PARAM_FARKI',
        kosul: 'JVM çalışıyor ama yapılandırılan parametreler çalışan süreçtekinden farklı — bir sonraki restart’ta davranış değişir.',
        seviye: 'danger',
        dogrulama: {
          neden: 'Taramanın jvm_arg_diff alanı en az bir parametrede “running” ile “configured” değerini farklı buldu.',
          eksik: 'Değişiklik bilerek yapılmış ve restart planlanmış olabilir; parametre başlatma betiğinden (start.sh) ekleniyor olabilir.',
          kontrol: [
            CLI7('/host=master/server-config=<JVM>/jvm=<JVM>:read-resource'),
            'ps -ef | grep -- "-D\\[Server:<JVM>\\]" | tr " " "\\n" | grep -- "^-"   # çalışan parametreler',
            'Server Hub > sunucu > JVM satırı > parametre farkı (maskeli ayrıntı)',
          ],
        },
      },
      { kod: null, kosul: 'Parametreler aynı ya da fark ölçülemedi.', seviye: 'ok' },
    ],
  },
  {
    id: 'jvm-yuk',
    alan: 'jvm',
    ad: 'JVM yükü (web katmanı trafiği)',
    neTaranir: 'JVM’e giden web katmanı access log istekleri, son 7 gün (hc.jsp / hc.html hariç).',
    ciktilar: [
      {
        kod: 'RETIRE_CANDIDATE',
        kosul: 'JVM kapalı ve 7 gündür istek yok — retire adayı.',
        seviye: 'warning',
        dogrulama: {
          neden: 'JVM süreci yok ve eşlenen web katmanı vhost’larının access log’unda son 7 günde (hc.jsp / hc.html hariç) istek yok.',
          eksik: TRAFIK_EKSIK,
          kontrol: [...DURUM_KONTROL, ...TRAFIK_KONTROL, 'CMDB / uygulama sahibi: uygulama kapatıldı mı, taşındı mı'],
        },
      },
      {
        kod: 'NO_LOAD',
        kosul: 'JVM çalışıyor ama 7 gündür istek yok.',
        seviye: 'warning',
        dogrulama: {
          neden: 'JVM çalışıyor, eşlenen vhost’larda son 7 günde istek yok.',
          eksik: TRAFIK_EKSIK,
          kontrol: [...DEPLOYMENT_KONTROL, ...TRAFIK_KONTROL],
        },
      },
      { kod: 'TRAFFIC_UNATTRIBUTED', kosul: 'Web katmanında hiçbir JVM’e atfedilemeyen proxy trafiği var — retire önerilmez.', seviye: 'warning' },
      {
        kod: 'TRAFFIC_UNVERIFIED',
        kosul: 'JVM kapalı, trafik doğrulanamadı (log okunamadı ya da web sunucusu ölçülemedi).',
        seviye: 'info',
        dogrulama: {
          neden: 'Eşlenen access log okunamadı ya da web sunucusu ölçülemedi: “istek yok” iddiası kurulmadı.',
          eksik: 'Log başka kullanıcıya ait (izin), web sunucusu taranmadı, vhost başka bir sunucuda.',
          kontrol: TRAFIK_KONTROL,
        },
      },
      { kod: 'STOPPED', kosul: 'JVM kapalı, auto-start kapalı, web katmanı eşlenemedi.', seviye: 'info' },
      { kod: null, kosul: 'JVM istek alıyor.', seviye: 'ok' },
    ],
  },
  {
    id: 'web-sozdizimi',
    alan: 'web',
    ad: 'Web sunucu sözdizimi',
    neTaranir: 'IHS / RHA için apachectl -t, Nginx için nginx -t; çalışan kurulumun argümanlarıyla.',
    ciktilar: [
      { kod: 'SYNTAX_FAIL', kosul: 'Sözdizimi hatası doğrulandı.', seviye: 'danger' },
      { kod: 'SYNTAX_UNVERIFIED', kosul: 'Kontrol çalıştı ama erişim / ortam yüzünden doğrulanamadı (config hatası değil).', seviye: 'warning' },
      { kod: 'SYNTAX_UNKNOWN', kosul: 'Kontrol sonucu ölçülemedi.', seviye: 'info' },
      { kod: null, kosul: 'Sözdizimi doğru.', seviye: 'ok' },
    ],
  },
  {
    id: 'web-surec',
    alan: 'web',
    ad: 'Web sunucu süreci',
    neTaranir: 'Vhost tanımı olan web ürününün süreci çalışıyor mu (ps).',
    ciktilar: [
      { kod: 'NOT_RUNNING', kosul: 'Ürün süreç listesinde yok ama vhost tanımları var.', seviye: 'warning' },
      { kod: null, kosul: 'Ürün çalışıyor.', seviye: 'ok' },
    ],
  },
  {
    id: 'vhost-yuk',
    alan: 'web',
    ad: 'Vhost yükü',
    neTaranir: 'JVM’e bağlı olmayan vhost’ların access log istekleri, son 7 gün.',
    ciktilar: [
      { kod: 'VHOST_IDLE', kosul: 'Vhost 7 gündür istek almıyor.', seviye: 'info' },
      { kod: null, kosul: 'Vhost istek alıyor.', seviye: 'ok' },
    ],
  },
  {
    id: 'ip',
    alan: 'ip',
    ad: 'IP kullanımı',
    neTaranir: 'Sunucudaki birincil olmayan IP’ler bir vhost ya da soket tarafından kullanılıyor mu.',
    ciktilar: [
      { kod: 'IP_UNUSED', kosul: 'IP hiçbir vhost / soket tarafından kullanılmıyor (boşta IP).', seviye: 'info' },
      { kod: null, kosul: 'IP kullanılıyor.', seviye: 'ok' },
    ],
  },
  {
    id: 'sshd',
    alan: 'ssh',
    ad: 'sshd oturum sınırı',
    neTaranir: 'sshd MaxSessions değeri ve açık oturum sayısı (Ansible delegate / forks tıkanması).',
    ciktilar: [
      { kod: 'SSH_SESSIONS_NEAR', kosul: 'Açık oturum sayısı MaxSessions’ın %80’ine ulaştı.', seviye: 'warning' },
      { kod: 'SSH_MAXSESSIONS_LOW', kosul: 'MaxSessions 10 ya da altı (varsayılan); öneri 64.', seviye: 'info' },
      { kod: null, kosul: 'MaxSessions 10’dan büyük ve sınırdan uzak.', seviye: 'ok' },
    ],
  },
  // ── Uygulama (EAR) alani (2026-11-06): veri Server Hub taramasindan DEGIL, Uygulama Envanteri'nin
  // (ear_tara.py) son taramasindan gelir. Veri yoksa ya da EAR_VERI_MAX_GUN'den eskiyse bulgu YOK.
  {
    id: 'ear-war',
    alan: 'ear',
    ad: 'EAR içeriği (WAR)',
    neTaranir: '/vhosting ve /vhosting8 altındaki her EAR’ın içinde WAR (web modülü) var mı (Uygulama Envanteri taraması).',
    ciktilar: [
      {
        kod: 'EAR_WAR_YOK',
        kosul: 'EAR tam tarandı ve içinde hiç WAR yok — çalıştıracak web modülü yok, silinebilir olabilir.',
        seviye: 'warning',
        dogrulama: {
          neden: 'Uygulama Envanteri EAR’ı eksiksiz taradı (durum TAM) ve içinde .war bulmadı.',
          eksik: 'Yalnız EJB / MDB / zamanlayıcı içeren EAR’lar bilerek WAR taşımaz; modül EAR dışında (paylaşılan dizinde) olabilir.',
          kontrol: [
            'ls -la /vhosting/<EAR> /vhosting8/<EAR>',
            'cat /vhosting/<EAR>/META-INF/application.xml   # <module> listesi (web / ejb / java)',
            "unzip -l /vhosting/<EAR> | grep -i -E '\\.(war|jar)$'   # .ear arşiviyse",
          ],
        },
      },
      { kod: null, kosul: 'EAR en az bir WAR taşıyor ya da tam taranmadı.', seviye: 'ok' },
    ],
  },
  {
    id: 'ear-kok',
    alan: 'ear',
    ad: 'Kökteki EAR dışı girdiler',
    neTaranir: '/vhosting ve /vhosting8 kökünde .ear ile bitmeyen dosya / dizin / bağ (yok sayma listesi hariç).',
    ciktilar: [
      {
        kod: 'KOK_EAR_DISI',
        kosul: 'Kökte .ear ile bitmeyen girdi var (APP.ear.bak, ESKI.war, eski dizin …) — retire şüphesi.',
        seviye: 'info',
        dogrulama: {
          neden: 'Uygulama dağıtım kökünde JBoss’un yüklemediği adla girdi var: yedek, eski sürüm ya da elle bırakılmış dosya olabilir.',
          eksik: 'Girdi bir betik, paylaşılan kütüphane ya da yapılandırma dizini olabilir (o zaman yok sayma listesine eklenmeli).',
          kontrol: [
            'ls -la /vhosting/<GIRDI>',
            'grep -rl "<GIRDI>" /usr/jboss/AppServer/domain/configuration /vhosting/scripts 2>/dev/null   # kullanan var mı',
            'crontab -l -u was | grep "<GIRDI>"',
          ],
        },
      },
      { kod: null, kosul: 'Kökte yalnız .ear ve yok sayılan girdiler var.', seviye: 'ok' },
    ],
  },
  {
    id: 'ear-jvm',
    alan: 'ear',
    ad: 'EAR ↔ JVM eşlemesi (domain.xml / host.xml)',
    neTaranir: 'Diskteki her EAR domain.xml’de bir deployment olarak tanımlı mı, bir server-group’a atanmış mı ve o grubun bu sunucuda JVM’i var mı (host.xml).',
    ciktilar: [
      {
        kod: 'EAR_JVM_YOK',
        kosul: 'EAR diskte var ama domain.xml / host.xml onu hiçbir JVM’e bağlamıyor.',
        seviye: 'warning',
        dogrulama: {
          neden: 'Yapılandırma okundu ve EAR için deployment tanımı, server-group ataması ya da bu sunucuda JVM bulunmadı.',
          eksik: 'Deployment adı diskteki dosya adından farklı ve yol göreli (relative-to) tanımlı olabilir; EAR başka bir JBoss kurulumundan yükleniyor olabilir.',
          kontrol: [
            "grep -n '<deployment ' /usr/jboss/AppServer/domain/configuration/domain.xml",
            "grep -n '<server ' /usr/jboss/AppServer/domain/configuration/host.xml",
            CLI7(':read-children-names(child-type=deployment)'),
          ],
        },
      },
      {
        kod: 'EAR_XML_OLCULEMEDI',
        kosul: 'JBoss yapılandırması okunamadı — EAR’ların JVM eşlemesi yapılamadı (“JVM yok” sayılmaz).',
        seviye: 'info',
        dogrulama: {
          neden: 'domain.xml / host.xml yok, okunamadı (izin), 5 MB üstü ya da DOCTYPE / ENTITY içerdiği için okunmadı.',
          eksik: 'Kurulum standart yolların dışında olabilir (/usr/jboss*/AppServer[/jboss]).',
          kontrol: [
            'ls -la /usr/jboss/AppServer/domain/configuration /usr/jboss8/AppServer/domain/configuration',
            "dzdo -u was head -c 300 /usr/jboss/AppServer/domain/configuration/domain.xml",
          ],
        },
      },
      { kod: null, kosul: 'EAR en az bir JVM’e bağlı.', seviye: 'ok' },
    ],
  },
  // FAZ 2 (2026-11-06; kullanici: "JVM ayakta ancak deployment'i incelesin"): Uygulama Envanteri
  // ayari "Deployment kontrolu" ACIK iken calisan her JVM'de JBoss CLI okumasi. Kapaliyken bulgu YOK.
  {
    id: 'ear-deployment',
    alan: 'ear',
    ad: 'Deployment durumu (JBoss CLI)',
    neTaranir:
      'Çalışan her JVM’de read-children-resources(child-type=deployment): deployment var mı, durumu (OK / FAILED) ve etkin mi. Uygulama Envanteri ayarı “Deployment kontrolü” açıkken.',
    ciktilar: [
      {
        kod: 'DEPLOY_YOK',
        kosul: 'JVM ayakta ama üzerinde hiçbir deployment yok — boşta çalışan JVM.',
        seviye: 'danger',
        dogrulama: {
          neden: 'JBoss CLI çalışan JVM’in deployment listesini boş döndü.',
          eksik: 'Uygulama yeniden dağıtılıyor olabilir (deploy sırasında liste kısa süre boştur); JVM bilerek boş bırakılmış olabilir.',
          kontrol: DEPLOYMENT_KONTROL,
        },
      },
      {
        kod: 'DEPLOY_FAILED',
        kosul: 'Deployment durumu FAILED — uygulama JVM’de çalışmıyor.',
        seviye: 'danger',
        dogrulama: {
          neden: 'Deployment’ın çalışma zamanı durumu FAILED (sunucu logunda hata nedeni).',
          eksik: 'Tarama anında yeniden başlatma sürüyor olabilir.',
          kontrol: [...DEPLOYMENT_KONTROL, 'tail -200 /vhosting/<EAR>/../logs/server.log   # ya da JVM’in server.log’u'],
        },
      },
      {
        kod: 'DEPLOY_KAPALI',
        kosul: 'Deployment tanımlı ama devre dışı (enabled=false).',
        seviye: 'warning',
        dogrulama: {
          neden: 'Deployment etkin değil: JVM onu yüklemiyor.',
          eksik: 'Bilerek kapatılmış (geçici bakım) olabilir.',
          kontrol: DEPLOYMENT_KONTROL,
        },
      },
      {
        kod: 'DEPLOY_OLCULEMEDI',
        kosul: 'Deployment durumu ölçülemedi (CLI yok, yanıt vermedi, zaman aşımı) — “deployment yok” sayılmaz.',
        seviye: 'info',
        dogrulama: {
          neden: 'JBoss CLI bulunamadı, bağlanamadı, süre aşıldı ya da çıktı okunamadı.',
          eksik: 'Kurulum standart yolların dışında olabilir; host controller kapalı olabilir.',
          kontrol: [CLI7('ls host=master'), CLI8('ls host=primary')],
        },
      },
      { kod: null, kosul: 'Çalışan JVM’lerin deployment’ları OK ve etkin (ya da kontrol kapalı).', seviye: 'ok' },
    ],
  },
];

/** kod -> { seviye (varsayilan), madde, alan, kosul, dogrulama } */
const KODLAR = new Map();
for (const m of MADDELER)
  for (const c of m.ciktilar)
    if (c.kod)
      KODLAR.set(c.kod, { seviye: c.seviye, madde: m.id, alan: m.alan, kosul: c.kosul, dogrulama: c.dogrulama || null });

// ── RETIREMENT ETIKET KURALLARI (2026-11-06) ────────────────────────────────────────────────
// Kullanici: "Kesin olarak retire edilecek teknoloji de retirement tagi olsun supheli olan da";
// "retiere etiketi ayri olsun bulgular ayri olsun retiere etiketi koyma kismi vs de admin tarafindan
// editlenebilir olsun". tur: etiketin konusu (JVM: uygulama/JVM adi, EAR: diskteki EAR, GIRDI:
// kokteki .ear disi girdi); konu + ortam basina TEK etiket, eslenik kopyalar birlikte degerlendirilir.
const ETIKET_SEVIYELERI = ['KESIN', 'SUPHELI', 'KAPALI'];
const ETIKET_KURALLARI = [
  {
    kural: 'R1',
    tur: 'JVM',
    ad: 'Kapalı + auto-start açık + trafik yok',
    kosul: 'JVM kapalı, auto-start açık ve web katmanında 7 gündür istek yok.',
    varsayilan: 'KESIN',
    dogrulama: {
      neden: 'Uygulama ayakta değil, reboot’ta açılacak şekilde bırakılmış ve kimse istek göndermiyor.',
      eksik: TRAFIK_EKSIK,
      kontrol: [...DURUM_KONTROL, ...TRAFIK_KONTROL, 'CMDB / uygulama sahibi onayı'],
    },
  },
  {
    kural: 'R2',
    tur: 'JVM',
    ad: 'Kapalı + auto-start kapalı + trafik var',
    kosul: 'JVM kapalı, auto-start kapalı ama web katmanına (IHS) istek gelmeye devam ediyor.',
    varsayilan: 'SUPHELI',
    dogrulama: {
      neden: 'Uygulama bilerek kapatılmış görünüyor ama web katmanı hâlâ istek alıyor: istemciler hata alıyor olabilir.',
      eksik: 'İstekler yalnız izleme / tarayıcı botu olabilir; vhost başka bir JVM’e de yönlendiriyor olabilir.',
      kontrol: [...TRAFIK_KONTROL, 'Vhost’un proxy hedeflerini kontrol et: başka JVM’e de gidiyor mu'],
    },
  },
  {
    kural: 'R3',
    tur: 'EAR',
    ad: 'EAR var, WAR yok',
    kosul: 'EAR tam tarandı ve içinde hiç WAR yok.',
    varsayilan: 'SUPHELI',
    dogrulama: null, // EAR_WAR_YOK ile ayni
    kod: 'EAR_WAR_YOK',
  },
  {
    kural: 'R4',
    tur: 'GIRDI',
    ad: 'Kökte .ear ile bitmeyen girdi',
    kosul: '/vhosting veya /vhosting8 kökünde .ear ile bitmeyen girdi (yok sayma listesi hariç).',
    varsayilan: 'SUPHELI',
    dogrulama: null,
    kod: 'KOK_EAR_DISI',
  },
  {
    kural: 'R5',
    tur: 'EAR',
    ad: 'EAR diskte var, JVM yok',
    kosul: 'EAR diskte var ama domain.xml / host.xml onu hiçbir JVM’e bağlamıyor.',
    varsayilan: 'SUPHELI',
    dogrulama: null,
    kod: 'EAR_JVM_YOK',
  },
  {
    kural: 'R6',
    tur: 'JVM',
    ad: 'Deployment adı diskteki EAR’la uyuşmuyor',
    kosul: 'Çalışan JVM’deki bir deployment’ın adı /vhosting(8) altındaki hiçbir EAR’la eşleşmiyor (Faz 2).',
    varsayilan: 'SUPHELI',
    dogrulama: {
      neden: 'JVM diskte karşılığı olmayan bir içerik çalıştırıyor: eski / yönetilen içerik ya da elle dağıtılmış paket olabilir.',
      eksik: 'Deployment doğrudan .war olarak ya da /vhosting dışından dağıtılmış olabilir (o zaman yanlış alarm).',
      kontrol: [...DEPLOYMENT_KONTROL, "grep -n '<deployment ' /usr/jboss/AppServer/domain/configuration/domain.xml"],
    },
  },
].map((k) => ({ ...k, dogrulama: k.dogrulama || KODLAR.get(k.kod).dogrulama }));

// Kokte yok sayilan girdiler (Admin degistirir: 'liste:kok_yoksay'). scripts: start.sh
// /vhosting/scripts/initialize'i kullaniyor.
const KOK_YOKSAY_VARSAYILAN = ['lost+found', 'log', 'logs', 'scripts', 'temp', 'tmp'];

module.exports = {
  MADDELER,
  KODLAR,
  SEVIYELER,
  ALANLAR,
  ETIKET_SEVIYELERI,
  ETIKET_KURALLARI,
  KOK_YOKSAY_VARSAYILAN,
};
