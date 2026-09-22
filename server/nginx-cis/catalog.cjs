// server/nginx-cis/catalog.cjs — CIS NGINX Benchmark madde katalogu (SAF, test edilir).
//
// Kullanici (2026-09-22): "Nginx Hub'da ayri sekme, gercek CIS maddeleri, ama bizim ortama uydurmak
// lazim; istedigim maddeyi istisnaya alip skordan dusurebileyim, kendi referans degerimi
// verebileyim, skoru job ile canli tazeleyebileyim."
//
// Kaynak: CIS NGINX Benchmark v2.1.0 (bolum/madde numaralari birebir). Tarayici
// (bmw_nginx/nginx_cis/files/nginx_cis_scan.sh) her madde icin PASS/FAIL/NA/MANUAL + OLCULEN deger
// uretir; KARAR burada verilir ki istisna ve kurum referansi job beklemeden etkili olsun:
//   - exceptions (item_id [+ host]) -> madde skor paydasindan DUSER ("istisna")
//   - overrides  (item_id -> expected) -> olculen deger bu degerle karsilastirilir ("kendi referansim")
// Agirlik: level 1 = 1, level 2 = 1 (CIS puanlamasi esit agirlikli); "scored" olmayan maddeler
// (MANUAL) skora girmez, ayrica gosterilir.
'use strict';

const ITEMS = [
  { id: '1.1.1', title: 'NGINX kurulu ve sürümü okunabiliyor', section: 'Kurulum', level: 1, scored: true, expects: null, fix: 'nginx binary bulunamadı — kurulum/izin kontrolü.', rationale: "Denetimin diğer maddeleri nginx’in çalıştırılabilmesine bağlıdır; binary yoksa hiçbir ölçü alınamaz.", check: "`nginx -V` çalıştırılır; sürüm satırı okunur." },
  { id: '2.1.2', title: 'WebDAV modülü derlenmemiş', section: 'Modül asgarisi', level: 1, scored: true, expects: null, fix: 'nginx WebDAV (--with-http_dav_module) olmadan derlenmeli.', rationale: "WebDAV modülü açıkken uzaktan dosya yazma yolları açılabilir; web sunucusunda gereksizdir.", check: "`nginx -V` derleme argümanlarında `http_dav_module` aranır." },
  { id: '2.1.3', title: 'gzip modülü kapalı', section: 'Modül asgarisi', level: 2, scored: true, expects: 'off', fix: 'gzip off; (BREACH/CRIME riski). Kurumda gzip gerekiyorsa istisnaya alın.', rationale: "TLS üzerinden sıkıştırma (BREACH/CRIME) oturum çerezlerinin sızmasına yol açabilir.", check: "`nginx -V` modülü + birleşik konfigürasyonda `gzip` direktifi." },
  { id: '2.1.4', title: 'autoindex kapalı', section: 'Modül asgarisi', level: 1, scored: true, expects: 'off', fix: 'autoindex off; — dizin listeleme kapatılmalı.', rationale: "autoindex açıkken dizin içeriği listelenir; dosya adları ve yapı dışarı sızar.", check: "Birleşik konfigürasyonda `autoindex` değerleri." },
  { id: '2.2.1', title: 'NGINX servis hesabıyla çalışıyor', section: 'Hesap', level: 1, scored: true, expects: 'www', fix: 'user www; (kurum standardı).', rationale: "Web sunucusu ayrıcalıksız bir servis hesabıyla çalışmalı; root ile çalışan nginx’te tek açık tüm sunucuyu verir.", check: "Global bağlamdaki `user` direktifi kurum standardı (www) ile karşılaştırılır." },
  { id: '2.2.2', title: 'Servis hesabı kilitli', section: 'Hesap', level: 1, scored: true, expects: null, fix: 'passwd -l www', rationale: "Servis hesabıyla interaktif giriş yapılamamalı; kilitli hesap parola ile oturum açmayı engeller.", check: "`passwd -S <kullanıcı>` çıktısındaki durum alanı." },
  { id: '2.2.3', title: 'Servis hesabının kabuğu geçersiz', section: 'Hesap', level: 1, scored: true, expects: null, fix: 'chsh -s /sbin/nologin www', rationale: "Kabuğu olan servis hesabı, ele geçirilen bir süreçten kalıcı erişime dönüşebilir.", check: "`getent passwd` çıktısındaki kabuk /sbin/nologin ya da /bin/false olmalı." },
  { id: '2.3.1', title: 'NGINX dosyaları root/servis hesabına ait', section: 'Dosya izinleri', level: 1, scored: true, expects: null, fix: 'chown root:root /usr/nginx/nginx.conf', rationale: "Konfigürasyonu yazma yetkisi genişse saldırgan yönlendirme ekleyebilir.", check: "`stat` ile nginx.conf sahibi okunur (root ya da servis hesabı)." },
  { id: '2.3.2', title: 'NGINX dosyalarına erişim kısıtlı', section: 'Dosya izinleri', level: 1, scored: true, expects: null, fix: 'chmod 640 /usr/nginx/nginx.conf (diğerlerine kapalı).', rationale: "Diğer kullanıcılara okuma/yazma açık konfigürasyon, upstream adresleri ve sertifika yollarını sızdırır.", check: "`stat -c %a` ile nginx.conf izinleri; “diğerleri” biti kapalı olmalı." },
  { id: '2.3.3', title: 'PID dosyası korumalı', section: 'Dosya izinleri', level: 1, scored: true, expects: null, fix: 'chmod 644 nginx.pid, sahibi root.', rationale: "PID dosyasına yazabilen bir kullanıcı, nginx’in sinyal göndereceği süreci değiştirebilir.", check: "`stat` ile PID dosyası izni ve sahibi." },
  { id: '2.4.1', title: 'Yalnız yetkili portlar dinleniyor', section: 'Ağ', level: 1, scored: false, expects: null, fix: 'Dinlenen port listesi kurum politikasıyla karşılaştırılmalı (manuel).', rationale: "Beklenmeyen portta dinleyen bir vhost, denetlenmemiş bir giriş noktasıdır.", check: "Birleşik konfigürasyondaki tüm `listen` portları listelenir; karşılaştırma kurum politikasına göre elle yapılır." },
  { id: '2.4.3', title: 'keepalive_timeout ≤ 10 sn', section: 'Ağ', level: 1, scored: true, expects: '10', fix: 'keepalive_timeout 10; (kurum değeri farklıysa Kendi referansım ile tanımlayın).', rationale: "Uzun keepalive, az sayıda istemcinin tüm bağlantı havuzunu tutmasına (DoS) izin verir.", check: "Global `keepalive_timeout` değeri saniyeye çevrilip sınırla karşılaştırılır." },
  { id: '2.4.4', title: 'send_timeout ≤ 10 sn', section: 'Ağ', level: 1, scored: true, expects: '10', fix: 'send_timeout 10;', rationale: "Yavaş istemciler yanıt gönderimini uzatarak bağlantıları meşgul edebilir.", check: "Global `send_timeout` değeri." },
  { id: '2.5.1', title: 'server_tokens off', section: 'Bilgi sızıntısı', level: 1, scored: true, expects: 'off', fix: 'server_tokens off; — sürüm bilgisi gizlenir.', rationale: "Sürüm bilgisi, o sürüme ait bilinen açıkların hedefli denenmesini kolaylaştırır.", check: "Global `server_tokens` değeri; tanımsızsa nginx varsayılanı “on”dur." },
  { id: '2.5.2', title: 'Özel hata sayfaları tanımlı', section: 'Bilgi sızıntısı', level: 1, scored: true, expects: null, fix: 'error_page ile kurum hata sayfası (gt-error-page.html).', rationale: "Varsayılan hata sayfaları sunucu ve sürüm bilgisini gösterir.", check: "Konfigürasyonda `error_page` tanımı aranır (kurumda gt-error-page.html)." },
  { id: '2.5.4', title: 'Upstream başlıkları gizleniyor', section: 'Bilgi sızıntısı', level: 1, scored: true, expects: null, fix: 'proxy_hide_header X-Powered-By; (ve benzerleri).', rationale: "Upstream’in döndürdüğü X-Powered-By gibi başlıklar iç mimariyi açık eder.", check: "`proxy_hide_header` satırlarının sayısı." },
  { id: '3.2', title: 'Erişim günlüğü açık', section: 'Günlük', level: 1, scored: true, expects: null, fix: 'access_log tanımlı olmalı (bmw formatı).', rationale: "Erişim günlüğü olmadan bir saldırının izi sürülemez.", check: "Konfigürasyondaki `access_log` değerleri; “off” ya da tanımsız başarısızdır." },
  { id: '3.3', title: 'Hata günlüğü uygun seviyede', section: 'Günlük', level: 1, scored: true, expects: null, fix: 'error_log /web_log/error.log warn; (info|notice|warn|error).', rationale: "Hata günlüğü uygun seviyede tutulmazsa saldırı belirtileri kaydedilmez.", check: "Global `error_log` satırındaki seviye (info|notice|warn|error)." },
  { id: '3.4', title: 'Günlük rotasyonu kurulu', section: 'Günlük', level: 1, scored: true, expects: null, fix: 'nginx_log_rotate job’ı /web_log altına logrotate kurar.', rationale: "Rotasyon yoksa disk dolar ve günlükler kaybolur; olay incelemesi imkânsızlaşır.", check: "/etc/logrotate.d altında nginx kaydı ya da /web_log altındaki kurum rotasyon dosyası." },
  { id: '3.7', title: 'Kaynak IP upstream’e geçiriliyor', section: 'Günlük', level: 1, scored: true, expects: null, fix: 'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;', rationale: "Proxy arkasında gerçek istemci IP’si geçirilmezse günlükler tek bir IP gösterir.", check: "`proxy_set_header X-Forwarded-For` satırlarının sayısı." },
  { id: '4.1.1', title: 'HTTP → HTTPS yönlendirmesi var', section: 'Şifreleme', level: 1, scored: true, expects: null, fix: 'return 301 https://$host$request_uri;', rationale: "Şifresiz HTTP isteği, kimlik bilgilerini açık metin olarak taşır.", check: "Konfigürasyonda `return 301/302 https://` yönlendirmesi aranır." },
  { id: '4.1.3', title: 'Özel anahtar izinleri kısıtlı', section: 'Şifreleme', level: 1, scored: true, expects: null, fix: 'chmod 600 (yalnız sahibi) — ssl_certificate_key dosyaları.', rationale: "Özel anahtarı okuyabilen herkes trafiği çözebilir ve sunucuyu taklit edebilir.", check: "`ssl_certificate_key` dosyalarının izinleri; yalnız sahibine açık olmalı." },
  { id: '4.1.4', title: 'Yalnız TLSv1.2/1.3', section: 'Şifreleme', level: 1, scored: true, expects: 'TLSv1.2 TLSv1.3', fix: 'ssl_protocols TLSv1.2 TLSv1.3;', rationale: "TLS 1.0/1.1 ve SSL sürümlerinde bilinen kriptografik zayıflıklar vardır.", check: "Global `ssl_protocols` değeri." },
  { id: '4.1.5', title: 'Zayıf şifreler kapalı', section: 'Şifreleme', level: 1, scored: true, expects: null, fix: 'ssl_ciphers listesinde RC4/MD5/DES/NULL/EXPORT olmamalı.', rationale: "Zayıf şifre takımları trafiğin çözülmesini kolaylaştırır.", check: "`ssl_ciphers` listesindeki pozitif girdilerde RC4/MD5/DES/NULL/EXPORT aranır (`!` ile dışlananlar sayılmaz)." },
  { id: '4.1.6', title: 'Özel DH parametresi', section: 'Şifreleme', level: 2, scored: true, expects: null, fix: 'ssl_dhparam /usr/nginx/ssl/dhparam.pem; (2048+ bit).', rationale: "Paylaşılan/zayıf DH parametreleri Logjam türü saldırılara açıktır.", check: "`ssl_dhparam` tanımı." },
  { id: '4.1.7', title: 'OCSP stapling açık', section: 'Şifreleme', level: 2, scored: true, expects: 'on', fix: 'ssl_stapling on; ssl_stapling_verify on;', rationale: "OCSP stapling, iptal edilmiş sertifikanın hızlı fark edilmesini sağlar ve gizliliği artırır.", check: "Global `ssl_stapling` değeri." },
  { id: '4.1.8', title: 'HSTS başlığı (≥ 6 ay)', section: 'Şifreleme', level: 1, scored: true, expects: null, fix: 'add_header Strict-Transport-Security "max-age=15768000" always;', rationale: "HSTS, tarayıcının HTTPS’e zorlanmasını sağlar; düşürme saldırılarını engeller.", check: "`Strict-Transport-Security` başlığındaki `max-age` değeri." },
  { id: '4.1.13', title: 'TLS session ticket kapalı', section: 'Şifreleme', level: 2, scored: true, expects: 'off', fix: 'ssl_session_tickets off;', rationale: "Session ticket anahtarları düzenli değişmezse ileri gizlilik (forward secrecy) kaybolur.", check: "Global `ssl_session_tickets` değeri." },
  { id: '5.2.1', title: 'client_header/body_timeout ≤ 10 sn', section: 'İstek süzme', level: 1, scored: true, expects: null, fix: 'client_header_timeout 10; client_body_timeout 10;', rationale: "Yavaş istek saldırıları (Slowloris) bağlantıları açık tutarak sunucuyu tüketir.", check: "Global `client_header_timeout` ve `client_body_timeout` değerleri." },
  { id: '5.2.2', title: 'client_max_body_size sınırlı', section: 'İstek süzme', level: 1, scored: false, expects: '100K', fix: 'CIS 100K önerir; kurum değerini “Kendi referansım” ile tanımlayın (ör. 1m, 10m).', rationale: "Sınırsız gövde boyutu, bellek/disk tüketen yükleme saldırılarına izin verir.", check: "Global `client_max_body_size` değeri; kurum sınırı Portal’dan tanımlanır." },
  { id: '5.2.3', title: 'large_client_header_buffers sınırlı', section: 'İstek süzme', level: 1, scored: true, expects: '2 1k', fix: 'large_client_header_buffers 2 1k;', rationale: "Aşırı büyük başlık tamponları bellek tüketimi için kullanılabilir.", check: "Global `large_client_header_buffers` değeri." },
  { id: '5.3.1', title: 'X-Frame-Options başlığı', section: 'Güvenlik başlıkları', level: 1, scored: true, expects: null, fix: 'add_header X-Frame-Options "SAMEORIGIN";', rationale: "Çerçeveleme (clickjacking) saldırılarında sayfa görünmez bir çerçevede açılır.", check: "`add_header X-Frame-Options` satırı." },
  { id: '5.3.2', title: 'X-Content-Type-Options başlığı', section: 'Güvenlik başlıkları', level: 1, scored: true, expects: 'nosniff', fix: 'add_header X-Content-Type-Options "nosniff";', rationale: "Tarayıcının içerik türünü tahmin etmesi (MIME sniffing) XSS’e yol açabilir.", check: "`add_header X-Content-Type-Options` satırı." },
  { id: '5.3.3', title: 'X-XSS-Protection başlığı', section: 'Güvenlik başlıkları', level: 1, scored: true, expects: '1; mode=block', fix: 'add_header X-XSS-Protection "1; mode=block";', rationale: "Eski tarayıcılarda yansıyan XSS için ek koruma sağlar.", check: "`add_header X-XSS-Protection` satırı." },
];

const BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

/** Madde numarasi dogal siralama: 2.4.3 < 2.10.1 (metin siralamasi bunu yanlis yapar). */
function cmpItemId(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** Deger karsilastirmasi: bosluk/tirnak/noktali virgul ve buyuk-kucuk harf goz ardi. */
function normVal(v) {
  return String(v == null ? '' : v).trim().replace(/;$/, '').replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Iki degerin AYNI seyi soyleyip soylemedigi (2026-09-22, kullanici: "kendi referansimi
 * ekledigim halde gectigini yazmiyor"). Duz metin esitligi cok kati kaliyordu:
 *   "20M" ile "20m", "10" ile "10s", "1024k" ile "1m" ayni degerdir.
 * Kural:
 *   - normalize (bosluk/tirnak/noktali virgul/buyuk-kucuk harf) esitse AYNI
 *   - ikisi de "sayi + birim" ise: birimlerden biri boska ve sayilar esitse AYNI
 *   - ikisi de bayt birimi (k/m/g) ise bayta cevrilip karsilastirilir
 * Dogrudan zaman birimi donusumu YAPILMAZ: "m" nginx'te hem megabayt hem dakika olabilir,
 * yanlis gecirme riskini almiyoruz.
 */
const BYTE_UNIT = { k: 1024, m: 1048576, g: 1073741824 };
function numUnit(v) {
  const m = /^(\d+(?:\.\d+)?)\s*([a-z]*)$/.exec(normVal(v));
  return m ? { n: Number(m[1]), u: m[2] } : null;
}
function sameVal(a, b) {
  if (normVal(a) === normVal(b)) return true;
  const A = numUnit(a);
  const B = numUnit(b);
  if (!A || !B) return false;
  if (A.u === B.u) return A.n === B.n;
  if (!A.u || !B.u) return A.n === B.n;
  if (BYTE_UNIT[A.u] && BYTE_UNIT[B.u]) return A.n * BYTE_UNIT[A.u] === B.n * BYTE_UNIT[B.u];
  return false;
}

module.exports = { ITEMS, BY_ID, normVal, sameVal, cmpItemId };
