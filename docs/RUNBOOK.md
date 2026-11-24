# BMW Portal Operasyon ve Yönetişim Runbook (`docs/RUNBOOK.md`)

> Kurumsal bankacılık ortamı operasyon el kitabı. Dağıtım ve AWX el adımları için ayrıca [DEVREYE-ALMA.md](DEVREYE-ALMA.md) ve [DEPLOYMENT.md](DEPLOYMENT.md) belgelerine bakın.

---

## 1. Hızlı Sağlık ve Doğrulama Komutları

| Kontrol                         | Komut                                      | Beklenen Sonuç                                          |
| ------------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| Ortam ve sürüm ön kontrolü      | `npm run preflight`                        | `0` eksik (exit `0`)                                    |
| Bağımlılık güvenlik kapısı      | `npm run guvenlik`                         | Çalışma zamanında `0` zafiyet (exit `0`)                |
| SBOM ve SPDX lisans uyumu       | `npm run sbom`                             | CycloneDX 1.5 çıktıları + `0` lisans ihlali             |
| Tip ve statik sözdizimi         | `npx tsc --noEmit && npm run check:server` | `0` TS / CJS hatası                                     |
| Linter ve ASCII uyumu           | `npm run lint && npm run lint:ascii`       | `0` hata, `0` uyarı                                     |
| Kapsam + LCOV birleştirme       | `npm run test:coverage`                    | `coverage/lcov.info` satır >= `%80` (K9), Sonar kapsamı >= `%75`, tekrar <= `%1` (K13 / K15; `kalite/esikler.json`) |
| Kritik güvenlik mutasyon kapısı | `npm run test:mutation`                    | Kill oranı >= `%85`                                     |
| Üretim derleme ve paketleme     | `npm run build && npm run paket`           | Doğrulanmış çalışma zamanı paketi                       |

---

## 2. Güvenlik ve Uyum Kontrolleri

### HTTP Güvenlik Başlıkları ve Oturum Sertleştirmesi

- `server/auth/guvenlik-basliklari.cjs`: Tüm yanıtlar `Content-Security-Policy`, `Permissions-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy` ve production'da `Strict-Transport-Security` (`max-age=31536000; includeSubDomains`) başlıklarıyla döner (`PORTAL_HSTS_MAX_AGE=0` yalnızca TLS proxy olmayan yerel testlerde kullanılır).
- `COOKIE_SECURE=true` env ayarıyla HTTPS arkasındaki QA/Test ortamlarında oturum çerezlerine `Secure` bayrağı zorlanır (`server/auth/oturum-cerezi.cjs`).
- Rate limiter (`server/service.cjs` `sessionOrIpKey`) yalnızca kriptografik doğrulamalı oturum kimliği veya `TRUST_PROXY` (`server/util/guvenlik-yardimci.cjs`) ile güvenilen istemci IP adresini kullanır; sahte başlıklar yoksayılır.

### Log Maskeleme ve Hata Gizleme

- `server/log.cjs` `kimlikMaskele`: Authorization (`Bearer`/`Basic`), JWT token'ları, `Cookie`/`Set-Cookie`, URL kimlik bilgileri, parola/secret/token KV çiftleri ve iç hassas alanlar loga yazılmadan önce maskelenir.
- Global Express hata yakalayıcısı (`server/util/guvenlik-yardimci.cjs` `globalErrorMiddleware`): `NODE_ENV=production` ortamında ham `err.message`/stack trace istemciye dönülmez; rastgele `correlationId` ile sunucu logu ve istemci yanıtı korele edilir.

### Gizli Bilgi (Secret) Sızıntısı Olay Müdahalesi

1. Tespit edilen token/parola/webhook URL'ini ilgili sistemde **derhal iptal edin / döndürün** (Secret Rotation).
2. Aktif çalışma dizininde (`src/`, `server/`, `.env*`) düz metin değer kalmadığından emin olun (`.env*` repoya asla alınmaz; yalnız `.env.example` şablonu saklanır).
3. Git geçmişine girmiş sırlar için kurum güvenlik ekibiyle koordine olarak `git filter-repo` ile geçmiş temizliği ve tüm geliştirici/CI kopyalarının yeniden klonlanmasını uygulayın.

---

## 3. Performans ve İstek Korumaları

- `src/api/prefsApi.ts`: Kullanıcı tercih güncellemeleri (`PUT /api/auth/prefs`) `250 ms` penceresinde birleştirilir ve yerel önbellekle özdeş değişiklikler ağa çıkarılmaz (`flush()` sayfa kapanışında bekleyen yazımları tamamlar).
- `server/auth/visibility-routes.cjs` (`GET /api/visibility/version`): `ETag` (`W/"vis-v<n>"`) + `304 Not Modified` döner; istemci (`src/contexts/AuthContext.tsx` & `src/api/adminApi.ts`) gizli sekmede yoklamayı atlar ve eşzamanlı çağrıları birleştirir.
- `server/nginx-console/index.cjs` (`/certs`, `/drift`): Dashboard özet görünümü `?limit=5&sort=daysLeft` ve `DriftTab` varsayılan `?includeLocal=0` ile gereksiz çok-megabaytlık yükleri azaltır; tam sayfalama (`limit`, `offset`, `hasMore`) desteklenir.

---

## 4. Kalite Kapıları ve SonarQube

- Proje tanımı kök dizindeki `sonar-project.properties` (`JAVASCRIPT:GAR_BMW_PORTAL`) dosyasındadır.
- `npm run test:coverage` çalıştırıldığında Node ve Vitest kapsamları `scripts/lcov-birlestir.cjs` tarafından göreli POSIX `SF:` yollarıyla `coverage/lcov.info` dosyasına birleştirilir.
- SonarQube sunucusu ortam değişkenleri (`SONAR_HOST_URL`, `SONAR_TOKEN`) tanımlıysa CI pipeline taramayı çalıştırır ve **Quality Gate `PASSED`** sonucu gelmeden yapıyı onaylamaz.

---

## 5. Geri Alma (Rollback) Prosedürü

1. Sunucuda `deploy/release.sh` aracılığıyla önceki doğrulanmış `PORTAL-BMW-main.zip` sürümünü geri yükleyin.
2. Veri tabanı şema değişikliği yoksa süreç yeniden başlatıldıktan sonra `/api/health` uç noktasından HTTP `200` yanıtını ve `logs/<env>.app.log` içinde hata artışı olmadığını doğrulayın.
3. Geri alma nedenini ilgili PBI ve olay kaydına işleyin.
