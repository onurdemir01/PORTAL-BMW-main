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
};

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
      { kod: 'STOPPED_AUTOSTART_ON', kosul: 'JVM kapalı ama auto-start açık — reboot’ta açılır.', seviye: 'warning' },
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
    id: 'jvm-yuk',
    alan: 'jvm',
    ad: 'JVM yükü (web katmanı trafiği)',
    neTaranir: 'JVM’e giden web katmanı access log istekleri, son 7 gün (hc.jsp / hc.html hariç).',
    ciktilar: [
      { kod: 'RETIRE_CANDIDATE', kosul: 'JVM kapalı ve 7 gündür istek yok — retire adayı.', seviye: 'warning' },
      { kod: 'NO_LOAD', kosul: 'JVM çalışıyor ama 7 gündür istek yok.', seviye: 'warning' },
      { kod: 'TRAFFIC_UNATTRIBUTED', kosul: 'Web katmanında hiçbir JVM’e atfedilemeyen proxy trafiği var — retire önerilmez.', seviye: 'warning' },
      { kod: 'TRAFFIC_UNVERIFIED', kosul: 'JVM kapalı, trafik doğrulanamadı (log okunamadı ya da web sunucusu ölçülemedi).', seviye: 'info' },
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
];

/** kod -> { seviye (varsayilan), madde, alan, kosul } */
const KODLAR = new Map();
for (const m of MADDELER)
  for (const c of m.ciktilar)
    if (c.kod) KODLAR.set(c.kod, { seviye: c.seviye, madde: m.id, alan: m.alan, kosul: c.kosul });

module.exports = { MADDELER, KODLAR, SEVIYELER, ALANLAR };
