# Değişiklik Günlüğü (`CHANGELOG.md`)

Format [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) esas alınarak hazırlanmıştır.

## [Unreleased]

### Added
- K16 `main` geçmişi (`scripts/gecmis-denetim.cjs`, CI `verify`): `main`'e giden her first-parent commit birleşmiş bir PR'dan gelmeli, konu satırı 8–120 karakter; `commit-msg` kancası konu kuralını aynı yerden okur (bekçi GD1-GD5).
- K15 kurum kural profili: "Portal Kurumsal" her dilde `kalite/kurumsal-sonar.json` `profil`den kurulur (kurumsal iş #52 bulguları + Sonar way bug / zafiyet / hotspot); K15 inceleme kaydı uygulamaz, inceleme bekleyen hotspot mutlak 0 (bekçi KK14). K13 / K15 kapısında kod kokusu mutlak (0).
- ESLint'te kurumun Sonar kuralları (`eslint-plugin-sonarjs`, `KURUM_JS` / `KURUM_TS`); kurumsal iş #52'nin 1597 kod kokusu ve HTML yorum bulgusu kapandı (bekçi KK13: kurumun HTML "yorumlanmış kod" sezgisi).
- `scripts/arac-yolu.cjs`: geliştirme betiklerinin çalıştırdığı dış araçlar (git, npm, npx, docker, zip, gitleaks, cygpath) PATH'te aranmaz; yalnız sabit sistem dizinlerinden ve Node'un kurulum dizininden mutlak yolla çalışır (Sonar S4036; bekçi AY1-AY3).
- Kurumsal Sonar taklidi (K15): CI `sonar` işi, kurumun sınıflandırmasıyla (`kalite/kurumsal-sonar.json`) ayrı bir projeye de tarar ve aynı kapıyı uygular (`node scripts/sonar-kapi.cjs --ci --kurumsal`, bekçi KK12).
- Kurumsal teslim imzası `kalite/teslim.json` (`scripts/teslim.cjs`, `.github/workflows/teslim-imzasi.yml`): main'deki her dosyanın git blob sha'sı, her main push'undan sonra tazelenir. `kurumsal:derle`'nin ilk adımı kodu bununla karşılaştırır ve yarım aktarımı dosya dosya söyler (bekçi TS1-TS8).
- Kurumsal iş provası `npm run kurumsal:prova` (`scripts/kurumsal-prova.cjs`, CI'da `kurumsal` işi, K14): temiz ağaçta, groovy'deki Node sürümüyle groovy'nin komutları aynen; paket ve 10 dk süre sınırı denetlenir. `sonar` işi provayı bekler (bekçi KJ7/KJ8).
- `npm run kapsam:kurumsal`: CI'ın ürettiği kapsam raporunu kurumsal Sonar adımının aradığı `coverage/lcov.info`'ya koyar (bayatsa Sonar koşusunu düşürür).
- Repo hijyeni bekçisi `scripts/repo-hijyeni.cjs` (`server/__tests__/repo-hijyeni.test.cjs`): hiçbir yerden ulaşılamayan belge/betik ve yalnız testlerin yüklediği modül CI'da kırmızı. Kural tüm talimat dosyalarında (AGENTS, CLAUDE, GEMINI, `.agent/rules`, CONTRIBUTING, PR şablonu).
- Kurumsal Jenkins iş tanımı `deploy/jenkins/DVL_JAVASCRIPT_GAR_BMW_PORTAL.groovy` (test + kapsam adımıyla) ve bekçisi `server/__tests__/kurumsal-pipeline.test.cjs`.
- Proje ajanlarının tanımları (`.claude/agents/*.md`) repoda; her biri zorunlu kalite kapılarına bağlı (KK9).
- `server/util/guvenlik-yardimci.cjs`: `TRUST_PROXY` env çözümleyici (`resolveTrustProxy`) ve `correlationId` tabanlı global hata yanıtı (`formatGlobalError`, `globalErrorMiddleware`).
- `scripts/lcov-birlestir.cjs`: `node:test` ve `vitest` LCOV çıktılarını tek `coverage/lcov.info` altında birleştiren araç ve birim testleri (`server/__tests__/lcov-birlestir.test.cjs`).
- `sonar-project.properties`, `.editorconfig`, `SECURITY.md`, `CONTRIBUTING.md`, `docs/STANDARTLAR.md` ve `docs/adr/0001..0003`.
- İstemci URL doğrulama birim testleri (`src/utils/__tests__/url.test.ts`).

### Fixed (OpsX WAS sonuc satiri, 2026-11-21)
- OpsX WAS: `>-` blok içindeki `split('\t')` sekmeye bölmüyordu (Ansible Jinja ifadesindeki ters bölüyü çiftler). Her başarılı restart/stop/start OLCULEMEDI ile bitiyor, AWX işi FAILED oluyor, `dbo.WASAppsInventory` hiç güncellenmiyordu; keşif de her hostu "ölçülemedi" sayıyordu. Sekme çift tırnaklı değişkende (`opsx_was_sekme`). Aynı tuzak OpsX Legacy dump'ta (`split('\n')[-1]`, çok satırlı çıktıda yanlış dosya adı) da düzeldi. Gerçek `ansible-playbook` bekçisi `opsx-was-gercek-kosum.test.js` (düzeltme öncesi 4/4 kırmızı) ve genel metin kuralı `playbook-jinja-traps.test.js` TUZAK 5.

### Fixed (kurumsal Jenkins, 2026-11-18)
- Kurumsal sınıflandırmada görünen bulgular (K15'in ilk koşusu: 8 bug, 28 zafiyet, `scripts/` ve test yardımcılarında) kodda düzeltildi; bastırma ya da dışlama yok:
  - geri izlemeli düzenli ifadeler doğrusal yazıldı; eski ve yeni sonuçlar 1675 repo metninde ve kötü girdilerde aynı (S8786);
  - sıralamalar `varsayilanSira` ile (S2871); beklenmeyen promise (S9383);
  - test yardımcılarında `http` / sabit parola / özel IP (S5332, S2068, S1313).
  - `ear_regex_esdeger.py` eski desenleri tutmuyor: eşdeğerlik, eski desenin aynı ~15 bin deterministik girdideki çıktı özetiyle (sha256) kanıtlanıyor.
- Kurumsal Sonar (iş #49, kapsam %50, güvenlik F): kurumun `scanOnSonar` adımı testleri yalnız `*.test.js` / `*.test.tsx` adından tanıyordu; 511 Node testi (`*.test.cjs`) üretim kodu sayıldı. Node testleri `*.test.js` oldu (`server/` ve Node testi olan `src/**/__tests__/` altında `"type": "commonjs"`); `npm test` eski adı reddeder (KK11). Biçim kapısı yeniden adlandırmayı tanır: HEAD biçimi eski yoldan okunur (KK3b).
- Kurumsal iş #50 (`teslim butunlugu`, 37 eksik dosya): `.github/`, `.claude/`, `.agent/` ve `sunum/` kurumsal depoya gitmiyor. Teslim imzası bu dizinleri iki yönde de yok sayar (`scripts/teslim.cjs` `KURUMA_GITMEYEN`, bekçi TS1/TS4b).
- Kurumsal iş #48 (`Missing script: "kurumsal:derle"`): kurumsal dal main'in yarım bir kopyasıydı (ZIP üzerine kopyalama: `scripts/kurumsal-derle.cjs` gelmiş, aynı commit'teki `package.json` satırı gelmemişti). Aktarım yöntemi (`git rm -r -q .` + ZIP içeriği) `docs/KALITE-KAPILARI.md` "Kurumsal aktarım"da; yarım kopya artık derlemenin ilk adımında yakalanır.
- Kurumsal iş #46 (`Missing script: "kapsam:kurumsal"`): groovy, kurumsal daldaki eski kodda olmayan bir betiği çağırıyordu. Groovy artık yalnız `install` + `run kurumsal:derle` çağırıyor; adımlar `scripts/kurumsal-derle.cjs`'te kodla birlikte sürümleniyor (bekçi KJ5/KJ6).
- TST ve PRD iş tanımları (`deploy/jenkins/TST_…`, `PRD_…`): derleme DVL ile birebir aynı; TST deployment `BMWPORTAL-T`, PRD'de deploy yok (bekçi KJ4).
- Kurumsal iş tanımı kurumdaki çalışan işler ve `standart_pipeline` koduyla hizalandı: `tools: [nodejs]` (Linux ajanı), `npm run kur`, paket `build/` altında, war `BMWPORTAL.war`, deployment `BMWPORTAL-D` (SI kaydı). `scripts/paket.cjs` repo içinde yalnız `build/` altına yazabilir.

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
