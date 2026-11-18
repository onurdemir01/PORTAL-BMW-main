# Kurumsal Mühendislik Standartları (`docs/STANDARTLAR.md`)

## 1. Güvenlik ve Uyum İlkeleri

- **En Az Ayrıcalık ve Varsayılan Güvenli Ayar:** Production varsayılanları (`COOKIE_SECURE`, tek atlamalı `TRUST_PROXY`, production'da `err.message` gizleme) açık opt-out gerektirir; `HSTS` bilinçli olarak opt-in'dir (`PORTAL_HSTS_MAX_AGE`); geliştirme kısayolları production'da kapalıdır.
- **İstek Doğrulama ve Başlık Güvenliği:** Tüm yanıtlar `guvenlikBasliklari()` üzerinden geçer (`CSP`, `Permissions-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`; `HSTS` yalnız açıkça ayarlanırsa). Rate-limit anahtarları sahteciliğe açık ham istemci başlıklarına (`x-portal-user`) güvenmez.
- **Hassas Veri Maskeleme:** Log katmanı (`server/log.cjs` `kimlikMaskele`) parola, token, cookie ve gizli alanları yazar yazmaz maskeler.

## 2. Kriptografi Standartları

- Özet ve ETag/fingerprint hesaplamalarında **SHA-256** (`crypto.createHash('sha256')`) kullanılır; **MD5** ve **SHA-1** yeni veya mevcut kodda kullanılamaz.

## 3. Kod Kalitesi ve ASCII Kuralı

- `server/` ve `scripts/` altındaki `.cjs`/`.mjs` dosyalarındaki **yorum satırları** ve **`console.*` çağrıları** yalnızca 7-bit ASCII içerir (`npm run lint:ascii`).
- Tekrarlayan güvenlik veya doğrulama mantığı paylaşılan saf yardımcı modüllere (`server/util/`) alınır.
- Bastırıcı direktifler (`NOSONAR`, `eslint-disable`, `@ts-ignore`) yasaktır.

## 4. Test ve Coverage Standartları

- **Backend:** Node built-in test runner (`node --test`), tüm `__tests__` dizinleri `scripts/run-tests.cjs` `TEST_DIRS` içinde kayıtlı olmalıdır (`test-glob-coverage.test.js` bekçisi).
- **Frontend:** Vitest (`src/**/__tests__/**/*.test.ts(x)`).
- **LCOV Birleştirme:** `scripts/lcov-birlestir.cjs` tüm LCOV çıktılarını `coverage/lcov.info` altında repo-göreli yollarla birleştirir; coverage hedefine ulaşmak için source exclusion kullanılamaz.

## 5. Mimari Karar Kayıtları (ADR)

Önemli mimari seçimler `docs/adr/` altında numaralı ADR dosyalarıyla kayıt altına alınır. Yeni ADR bu listeye eklenir (repo hijyeni bekçisi listede olmayanı yetim sayar):

- [0001 — Oturum deposu ve çerez sertleştirme](adr/0001-session-store-and-cookie-hardening.md)
- [0002 — İki test koşucusu ve LCOV birleştirme](adr/0002-dual-test-runner-and-lcov-merge.md)
- [0003 — Çalışma zamanı paketi budama ve 0 zafiyet kapısı](adr/0003-runtime-package-prune-and-zero-vuln-gate.md)
- [0004 — Kapsam raporu repoda](adr/0004-kapsam-raporu-repoda.md)
