# Güvenlik Politikası (`SECURITY.md`)

## Kapsam ve Düzenleyici Çerçeve

Bu depo kurumsal bankacılık iç altyapı portalına (`bmw-portal`) aittir. Tüm geliştirmeler BDDK Bilgi Sistemleri ve Elektronik Bankacılık Hizmetleri Yönetmeliği, KVKK, OWASP ASVS L2/L3 ve kurumsal DevSecOps sıfır zafiyet politikasına tabidir.

## Zafiyet Politikası (Sıfır Tolerans)

- **Artifactory / Xray:** Teslim edilecek paket ve dependency ağacında **0 Critical** ve **0 High** zafiyet zorunludur.
- **Tedarik Zinciri (Supply-Chain Guard):** Yeni eklenen veya güncellenen paket sürümlerinin yayımlanma yaşı kurum standartlarına göre doğrulanır; doğrulamasız tarama dışı bırakma (`|| true`, kural susturma) yasaktır.
- **SonarQube Quality Gate:** Tüm metriklerde `A` rating (Reliability, Security, Security Review, Maintainability), `0` Critical/Blocker bulgu ve en az `%70` gerçek test coverage zorunludur. `// NOSONAR`, `eslint-disable` veya yapay coverage exclusion kullanılamaz.

## Üretim Sertleştirme Gereksinimleri

- **HTTP Güvenlik Başlıkları:** `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` ve production HTTPS isteklerinde `Strict-Transport-Security` (`includeSubDomains`) zorunludur (`server/auth/guvenlik-basliklari.cjs`).
- **Oturum Çerezleri:** Production'da `__Host-portal.sid`, `HttpOnly`, `SameSite=Lax` ve `Secure=true` zorunludur (`server/auth/oturum-cerezi.cjs`, `COOKIE_SECURE`).
- **Log Maskeleme & Hata Gizliliği:** Loglarda parola, `Bearer`/`Basic` token, JWT, `Cookie`/`Set-Cookie` ve gizli sorgu parametreleri maskelenir (`server/log.cjs`). Production HTTP 5xx yanıtları iç stack/mesaj döndürmez; yalnızca `correlationId` döner.
- **Gizli Bilgi Hijyeni:** `.env`, token, sertifika (`.pem`/`.key`/`.crt`), gerçek iç IP listeleri veya `.har` dosyaları repoya commit edilemez.

## Güvenlik Açığı Bildirimi

Tespit edilen herhangi bir güvenlik zafiyeti veya gizli veri sızıntısı bulgusu kurumsal Bilgi Güvenliği ve Platform Yönetişim ekibine derhal bildirilir; herkese açık issue olarak açılmaz.
