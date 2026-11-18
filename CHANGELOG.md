# Değişiklik Günlüğü (`CHANGELOG.md`)

Format [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) esas alınarak hazırlanmıştır.

## [Unreleased]

### Added
- Repo hijyeni bekçisi `scripts/repo-hijyeni.cjs` (`server/__tests__/repo-hijyeni.test.cjs`): hiçbir yerden ulaşılamayan belge/betik ve yalnız testlerin yüklediği modül CI'da kırmızı. Kural tüm talimat dosyalarında (AGENTS, CLAUDE, GEMINI, `.agent/rules`, CONTRIBUTING, PR şablonu).
- Kurumsal Jenkins iş tanımı `deploy/jenkins/DVL_JAVASCRIPT_GAR_BMW_PORTAL.groovy` (test + kapsam adımıyla) ve bekçisi `server/__tests__/kurumsal-pipeline.test.cjs`.
- Proje ajanlarının tanımları (`.claude/agents/*.md`) repoda; her biri zorunlu kalite kapılarına bağlı (KK9).
- `server/util/guvenlik-yardimci.cjs`: `TRUST_PROXY` env çözümleyici (`resolveTrustProxy`) ve `correlationId` tabanlı global hata yanıtı (`formatGlobalError`, `globalErrorMiddleware`).
- `scripts/lcov-birlestir.cjs`: `node:test` ve `vitest` LCOV çıktılarını tek `coverage/lcov.info` altında birleştiren araç ve birim testleri (`server/__tests__/lcov-birlestir.test.cjs`).
- `sonar-project.properties`, `.editorconfig`, `SECURITY.md`, `CONTRIBUTING.md`, `docs/STANDARTLAR.md` ve `docs/adr/0001..0003`.
- İstemci URL doğrulama birim testleri (`src/utils/__tests__/url.test.ts`).

### Removed
- Kullanılmayan dosyalar (2026-11-18): `docs/archive/` (QUICK-SOLVER, TOPOLOGY, deploy-legacy.sh), iki yol haritası ve MINDMAP, OpenShift arayüz önizlemesi (`docs/UI-OPENSHIFT.md`, `docs/ui-onizleme.html`), tek seferlik betikler (`fix-username-case`, `oco-arama-dene`, `standardize-src`) ve SQL (`2026-07-27-envanter-navgroup.sql`).
- İş kaydı niteliğindeki üç belge (`docs/PBI-2026-09-19-*`, `docs/NETWORK-HARDENING-BACKLOG.md`, `docs/OCO-SMART-CHAOS-SCALE-IHTIYAC.md`) repodan çıkıp git dışındaki backlog'a taşındı.
- Ölü kod: `src/utils/url.ts`, `src/utils/safeUrl.ts` (Linkler sayfası 2026-10-02'de kalktı; sunucu kapısı duruyor) ve `server/opsx/ocp-target.cjs` (2026-08-11'den beri çağrılmıyordu). Mutasyon kapısında `url.ts` hedefinin yerini app-hub sahiplik doğrulaması aldı.

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
