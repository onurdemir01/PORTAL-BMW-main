# Kurumsal Mühendislik Standartları (`docs/STANDARTLAR.md`)

## 1. Güvenlik ve Uyum İlkeleri

- **En Az Ayrıcalık ve Varsayılan Güvenli Ayar:** Production varsayılanları (`COOKIE_SECURE`, `HSTS`, `TRUST_PROXY=loopback`, production'da `err.message` gizleme) açık opt-out gerektirir; geliştirme kısayolları production'da kapalıdır.
- **İstek Doğrulama ve Başlık Güvenliği:** Tüm yanıtlar `guvenlikBasliklari()` üzerinden geçer (`CSP`, `Permissions-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HTTPS'te `HSTS`). Rate-limit anahtarları sahteciliğe açık ham istemci başlıklarına (`x-portal-user`) güvenmez.
- **Hassas Veri Maskeleme:** Log katmanı (`server/log.cjs` `kimlikMaskele`) parola, token, cookie ve gizli alanları yazar yazmaz maskeler.

## 2. Kriptografi Standartları

- Özet ve ETag/fingerprint hesaplamalarında **SHA-256** (`crypto.createHash('sha256')`) kullanılır; **MD5** ve **SHA-1** yeni veya mevcut kodda kullanılamaz.

## 3. Kod Kalitesi ve ASCII Kuralı

- `server/` ve `scripts/` altındaki `.cjs`/`.mjs` dosyalarındaki **yorum satırları** ve **`console.*` çağrıları** yalnızca 7-bit ASCII içerir (`npm run lint:ascii`).
- Tekrarlayan güvenlik veya doğrulama mantığı paylaşılan saf yardımcı modüllere (`server/util/`) alınır.
- Bastırıcı direktifler (`NOSONAR`, `eslint-disable`, `@ts-ignore`) yasaktır.

## 4. Test ve Coverage Standartları

- **Backend:** Node built-in test runner (`node --test`), tüm `__tests__` dizinleri `scripts/run-tests.cjs` `TEST_DIRS` içinde kayıtlı olmalıdır (`test-glob-coverage.test.cjs` bekçisi).
- **Frontend:** Vitest (`src/**/__tests__/**/*.test.ts(x)`).
- **LCOV Birleştirme:** `scripts/lcov-birlestir.cjs` tüm LCOV çıktılarını `coverage/lcov.info` altında repo-göreli yollarla birleştirir; coverage hedefine ulaşmak için source exclusion kullanılamaz.

## 5. Mimari Karar Kayıtları (ADR)

Önemli mimari seçimler `docs/adr/` altında numaralı ADR dosyalarıyla kayıt altına alınır (`0001`, `0002`, `0003`, ...).
