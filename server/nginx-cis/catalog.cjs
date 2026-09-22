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
  { id: '1.1.1', title: 'NGINX kurulu ve sürümü okunabiliyor', section: 'Kurulum', level: 1, scored: true, expects: null, fix: 'nginx binary bulunamadı — kurulum/izin kontrolü.' },
  { id: '2.1.2', title: 'WebDAV modülü derlenmemiş', section: 'Modül asgarisi', level: 1, scored: true, expects: null, fix: 'nginx WebDAV (--with-http_dav_module) olmadan derlenmeli.' },
  { id: '2.1.3', title: 'gzip modülü kapalı', section: 'Modül asgarisi', level: 2, scored: true, expects: 'off', fix: 'gzip off; (BREACH/CRIME riski). Kurumda gzip gerekiyorsa istisnaya alın.' },
  { id: '2.1.4', title: 'autoindex kapalı', section: 'Modül asgarisi', level: 1, scored: true, expects: 'off', fix: 'autoindex off; — dizin listeleme kapatılmalı.' },
  { id: '2.2.1', title: 'NGINX servis hesabıyla çalışıyor', section: 'Hesap', level: 1, scored: true, expects: 'www', fix: 'user www; (kurum standardı).' },
  { id: '2.2.2', title: 'Servis hesabı kilitli', section: 'Hesap', level: 1, scored: true, expects: null, fix: 'passwd -l www' },
  { id: '2.2.3', title: 'Servis hesabının kabuğu geçersiz', section: 'Hesap', level: 1, scored: true, expects: null, fix: 'chsh -s /sbin/nologin www' },
  { id: '2.3.1', title: 'NGINX dosyaları root/servis hesabına ait', section: 'Dosya izinleri', level: 1, scored: true, expects: null, fix: 'chown root:root /usr/nginx/nginx.conf' },
  { id: '2.3.2', title: 'NGINX dosyalarına erişim kısıtlı', section: 'Dosya izinleri', level: 1, scored: true, expects: null, fix: 'chmod 640 /usr/nginx/nginx.conf (diğerlerine kapalı).' },
  { id: '2.3.3', title: 'PID dosyası korumalı', section: 'Dosya izinleri', level: 1, scored: true, expects: null, fix: 'chmod 644 nginx.pid, sahibi root.' },
  { id: '2.4.1', title: 'Yalnız yetkili portlar dinleniyor', section: 'Ağ', level: 1, scored: false, expects: null, fix: 'Dinlenen port listesi kurum politikasıyla karşılaştırılmalı (manuel).' },
  { id: '2.4.3', title: 'keepalive_timeout ≤ 10 sn', section: 'Ağ', level: 1, scored: true, expects: '10', fix: 'keepalive_timeout 10; (kurum değeri farklıysa Kendi referansım ile tanımlayın).' },
  { id: '2.4.4', title: 'send_timeout ≤ 10 sn', section: 'Ağ', level: 1, scored: true, expects: '10', fix: 'send_timeout 10;' },
  { id: '2.5.1', title: 'server_tokens off', section: 'Bilgi sızıntısı', level: 1, scored: true, expects: 'off', fix: 'server_tokens off; — sürüm bilgisi gizlenir.' },
  { id: '2.5.2', title: 'Özel hata sayfaları tanımlı', section: 'Bilgi sızıntısı', level: 1, scored: true, expects: null, fix: 'error_page ile kurum hata sayfası (gt-error-page.html).' },
  { id: '2.5.4', title: 'Upstream başlıkları gizleniyor', section: 'Bilgi sızıntısı', level: 1, scored: true, expects: null, fix: 'proxy_hide_header X-Powered-By; (ve benzerleri).' },
  { id: '3.2', title: 'Erişim günlüğü açık', section: 'Günlük', level: 1, scored: true, expects: null, fix: 'access_log tanımlı olmalı (bmw formatı).' },
  { id: '3.3', title: 'Hata günlüğü uygun seviyede', section: 'Günlük', level: 1, scored: true, expects: null, fix: 'error_log /web_log/error.log warn; (info|notice|warn|error).' },
  { id: '3.4', title: 'Günlük rotasyonu kurulu', section: 'Günlük', level: 1, scored: true, expects: null, fix: 'nginx_log_rotate job’ı /web_log altına logrotate kurar.' },
  { id: '3.7', title: 'Kaynak IP upstream’e geçiriliyor', section: 'Günlük', level: 1, scored: true, expects: null, fix: 'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;' },
  { id: '4.1.1', title: 'HTTP → HTTPS yönlendirmesi var', section: 'Şifreleme', level: 1, scored: true, expects: null, fix: 'return 301 https://$host$request_uri;' },
  { id: '4.1.3', title: 'Özel anahtar izinleri kısıtlı', section: 'Şifreleme', level: 1, scored: true, expects: null, fix: 'chmod 600 (yalnız sahibi) — ssl_certificate_key dosyaları.' },
  { id: '4.1.4', title: 'Yalnız TLSv1.2/1.3', section: 'Şifreleme', level: 1, scored: true, expects: 'TLSv1.2 TLSv1.3', fix: 'ssl_protocols TLSv1.2 TLSv1.3;' },
  { id: '4.1.5', title: 'Zayıf şifreler kapalı', section: 'Şifreleme', level: 1, scored: true, expects: null, fix: 'ssl_ciphers listesinde RC4/MD5/DES/NULL/EXPORT olmamalı.' },
  { id: '4.1.6', title: 'Özel DH parametresi', section: 'Şifreleme', level: 2, scored: true, expects: null, fix: 'ssl_dhparam /usr/nginx/ssl/dhparam.pem; (2048+ bit).' },
  { id: '4.1.7', title: 'OCSP stapling açık', section: 'Şifreleme', level: 2, scored: true, expects: 'on', fix: 'ssl_stapling on; ssl_stapling_verify on;' },
  { id: '4.1.8', title: 'HSTS başlığı (≥ 6 ay)', section: 'Şifreleme', level: 1, scored: true, expects: null, fix: 'add_header Strict-Transport-Security "max-age=15768000" always;' },
  { id: '4.1.13', title: 'TLS session ticket kapalı', section: 'Şifreleme', level: 2, scored: true, expects: 'off', fix: 'ssl_session_tickets off;' },
  { id: '5.2.1', title: 'client_header/body_timeout ≤ 10 sn', section: 'İstek süzme', level: 1, scored: true, expects: null, fix: 'client_header_timeout 10; client_body_timeout 10;' },
  { id: '5.2.2', title: 'client_max_body_size sınırlı', section: 'İstek süzme', level: 1, scored: false, expects: '100K', fix: 'CIS 100K önerir; kurum değerini “Kendi referansım” ile tanımlayın (ör. 1m, 10m).' },
  { id: '5.2.3', title: 'large_client_header_buffers sınırlı', section: 'İstek süzme', level: 1, scored: true, expects: '2 1k', fix: 'large_client_header_buffers 2 1k;' },
  { id: '5.3.1', title: 'X-Frame-Options başlığı', section: 'Güvenlik başlıkları', level: 1, scored: true, expects: null, fix: 'add_header X-Frame-Options "SAMEORIGIN";' },
  { id: '5.3.2', title: 'X-Content-Type-Options başlığı', section: 'Güvenlik başlıkları', level: 1, scored: true, expects: 'nosniff', fix: 'add_header X-Content-Type-Options "nosniff";' },
  { id: '5.3.3', title: 'X-XSS-Protection başlığı', section: 'Güvenlik başlıkları', level: 1, scored: true, expects: '1; mode=block', fix: 'add_header X-XSS-Protection "1; mode=block";' },
];

const BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

/** Deger karsilastirmasi: bosluk/tirnak/noktali virgul ve buyuk-kucuk harf goz ardi. */
function normVal(v) {
  return String(v == null ? '' : v).trim().replace(/;$/, '').replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').toLowerCase();
}

module.exports = { ITEMS, BY_ID, normVal };
