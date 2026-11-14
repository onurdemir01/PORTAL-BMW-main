# Değişiklik Günlüğü (`CHANGELOG.md`)

Format [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) esas alınarak hazırlanmıştır.

## [Unreleased]

### Added
- `server/util/guvenlik-yardimci.cjs`: `TRUST_PROXY` env çözümleyici (`resolveTrustProxy`) ve `correlationId` tabanlı global hata yanıtı (`formatGlobalError`, `globalErrorMiddleware`).
- `scripts/lcov-birlestir.cjs`: `node:test` ve `vitest` LCOV çıktılarını tek `coverage/lcov.info` altında birleştiren araç ve birim testleri (`server/__tests__/lcov-birlestir.test.cjs`).
- `sonar-project.properties`, `.editorconfig`, `SECURITY.md`, `CONTRIBUTING.md`, `docs/STANDARTLAR.md` ve `docs/adr/0001..0003`.
- İstemci URL doğrulama birim testleri (`src/utils/__tests__/url.test.ts`).

### Changed
- `server/auth/guvenlik-basliklari.cjs`: Tam `Content-Security-Policy`, `Permissions-Policy` ve production varsayılan `Strict-Transport-Security` (`includeSubDomains`) eklendi.
- `server/auth/oturum-cerezi.cjs` & `server/auth/index.cjs`: `COOKIE_SECURE` env desteği bağlandı.
- `server/log.cjs` & `server/service.cjs`: `Bearer`/`Basic`, `JWT`, `Cookie`/`Set-Cookie`, hassas sorgu/JSON alanları loglarda maskelendi; `sessionOrIpKey` kimlik spoofing'ine karşı doğrulamalı hale getirildi.
- `server/nobetci/index.cjs`: `/api/nobetci/today/avatar` yanıtında `Cache-Control: private, max-age=300` uygulandı.
- `server/admin/branding.cjs` & `server/server-hub/notlar.cjs`: Zayıf `sha1`/`md5` özetleri `sha256` ile değiştirildi.
- `src/utils/url.ts`: `new URL()` tabanlı sıkı `http:`/`https:` izin listesi uygulandı.
- `.gitignore`: `coverage/`, `*.har` ve yerel çalışma artıkları eklendi.

### Fixed
- `server/index.cjs`: Sabit iç proxy IP adresi kaldırıldı ve production hata yanıtlarından `detail: err.message` sızıntısı engellendi.
