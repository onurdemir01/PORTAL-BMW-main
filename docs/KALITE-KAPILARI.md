# Kalite kapıları (zorunlu, herkes için)

**Kural (2026-11-15):** `main`'e giren her değişiklik — insan ya da yapay zekâ ajanı yazmış olsun — aşağıdaki kapıların **hepsinden** geçer. İstisna yok. Kapılar yalnız **sıkılaşır**: eşik düşürmek, kapı kaldırmak, bastırma (`NOSONAR`, `eslint-disable`, `@ts-ignore`, `.skip`) ya da dışlama eklemek `server/__tests__/kalite-kapilari.test.cjs` tarafından reddedilir.

Kurumsal teslimde 0 zafiyet kuralı ayrıca geçerlidir: [GUVENLIK-0-ZAFIYET.md](GUVENLIK-0-ZAFIYET.md).

## Tek komut

| Komut | Ne zaman | Ne yapar |
|---|---|---|
| `npm run kapi` | PR açmadan / push etmeden önce | K1–K12'nin tamamı (CI'nin koşturduğu liste) |
| `npm run kapi:hizli` | her push'ta (kanca kendisi koşturur) | hızlı kapılar: K1–K7 |
| `npm run kapi:sonar` | Sonar'a dokunan değişikliklerde; CI her PR'da koşturur | K13: yerel SonarQube kalite kapısı |

İlk kurulum: `npm run kur` (geliştirme araçları ve git kancaları).

## Kapılar

Eşiklerin tek kaynağı: [`kalite/esikler.json`](../kalite/esikler.json).

| K | Kapı | Komut | Nerede | Eşik |
|---|---|---|---|---|
| K0 | Sır taraması | `node scripts/sir-tarama.cjs` | commit öncesi, commit mesajı, CI (PR aralığı) | 0 bulgu; `.har`, `.env`, anahtar dosyası eklenemez |
| K1 | Tip denetimi | `npx tsc --noEmit` | push öncesi, CI | `strict`, 0 hata |
| K2 | Lint | `npm run lint` | commit öncesi (değişen dosya), push öncesi, CI | 0 hata, 0 uyarı (`src`, `server`, `shared`, `scripts`) |
| K3 | ASCII kuralı | `npm run lint:ascii` | push öncesi, CI | 0 ihlal |
| K4 | Sunucu denetimi | `npm run check:server` | push öncesi, CI | 0 ölümcül tanı |
| K5 | Manifest eşitliği | `node scripts/manifest.cjs --dogrula` | push öncesi, CI | kök manifest = `gelistirme/` türevi |
| K6 | Bağımlılık güvenliği | `npm run guvenlik` | push öncesi, CI | 0 zafiyet (Xray tabanı) |
| K7 | Ön kontrol | `npm run preflight` | push öncesi, CI | 0 eksik |
| K8 | Testler + kapsam | `npm run test:coverage` | CI | 0 başarısız test |
| K9 | Kapsam eşiği | `node scripts/kapsam-esik.cjs` | CI | satır kapsamı ≥ %70 |
| K10 | Mutasyon testi | `npm run test:mutation` | CI | ≥ %85 mutant öldürülür |
| K11 | SBOM ve lisans | `npm run sbom` | CI | 0 lisans ihlali |
| K12 | Derleme + paket | `npm run build`, `npm run paket` | CI | ikisi de başarılı |
| K13 | SonarQube kapısı | `node scripts/sonar-kapi.cjs` | CI (`sonar` işi), yerelde `npm run kapi:sonar` | "Portal Katı": 0 bug, 0 zafiyet, güvenilirlik ve güvenlik A (MQR: kod kokularının etkisi dahil), bakım A, kapsam ≥ %70, tekrar ≤ %3, hotspot %100 incelenmiş, 0 blocker / high |
| K14 | Kurumsal iş provası | `npm run kurumsal:prova` | CI (`kurumsal` işi), yerelde aynı komut | temiz ağaçta groovy'nin komutları aynen geçer, paket eksiksiz, süre ≤ 10 dk |

**Commit öncesi biçim çırığı** (`scripts/bicim-kapisi.cjs`): biçimli (prettier) dosya biçimli kalır, yeni dosya biçimli olur. Biçimsiz eski dosyaya dokunmak serbesttir; toplu biçimleme ayrı, tek commit'te yapılır.

## Repo hijyeni

Repoda kullanılmayan dosya kalmaz; insan ya da ajan fark etmez.

- **Yeni dosya bir referansla gelir.**
  - Belge README'den ya da ilgili belgeden bağlanır.
  - Betik `package.json`'dan ya da onu çağıran koddan bağlanır.
  - Modül, onu yükleyen koddan bağlanır.
  - ADR, [`docs/STANDARTLAR.md`](STANDARTLAR.md) listesine eklenir.
- **İşi biten dosya aynı PR'da silinir:** yerini alan kodun eskisi, artık çağrılmayan modül ve testi, tek seferlik betik ve SQL, bayat plan. Git geçmişi yeter; arşiv dizini açılmaz.
- **Repoya girmez:** tek seferlik teşhis betikleri; iş kaydı, PBI ve yol haritası (`.ai-workspace/backlog/`, git dışı); oturum raporları.
- **Bekçi:** [`scripts/repo-hijyeni.cjs`](../scripts/repo-hijyeni.cjs). Testi `server/__tests__/repo-hijyeni.test.cjs`, K8 içinde CI'da koşar. Şunlar kırmızıdır:
  - hiçbir koddan, testten, yapılandırmadan ya da canlı belgeden ulaşılamayan belge ya da betik (birbirini anan iki bayat belge de dahil);
  - yalnız testlerin yüklediği modül.

  `CHANGELOG.md`'de anılmak kullanım sayılmaz.
- **Bekçi bir alt sınırdır:** yorumda anılıp kullanılmayan dosyayı yakalamaz; onaylayıcı bakar.

## Kurumsal Jenkins

Kurumsal iş tanımının kaynağı [`deploy/jenkins/DVL_JAVASCRIPT_GAR_BMW_PORTAL.groovy`](../deploy/jenkins/DVL_JAVASCRIPT_GAR_BMW_PORTAL.groovy).

- **Değişiklik sırası:** önce bu dosya değiştirilir, sonra kurumsal iş tanımı deposuna kopyalanır. E-posta yer tutucusu orada doldurulur; gerçek adres public repoya yazılmaz.
- **Tek giriş noktası (değişmez sözleşme):** groovy'nin `commands` listesi yalnız `install` ve `run kurumsal:derle` içerir. Derleme adımları `scripts/kurumsal-derle.cjs`'tedir: kur, kapsam, build, paket.
  - **Neden:** groovy her dala aynı anda uygulanır; kod ise dal dal ilerler. 2026-11-18'deki iş #46'da groovy, kurumsal dalda henüz bulunmayan `kapsam:kurumsal` betiğini çağırdı ve iş `npm error Missing script` ile düştü.
  - **Kural:** adım eklemek ya da değiştirmek groovy değişikliği gerektirmez; değişiklik bu betikte yapılır. Groovy'ye yeni bir `run …` eklenmez (bekçi KJ1 / KJ3).
  - **Kurumsal depo:** yeni sözleşmeyle ilk kez çalışacak dala önce güncel kod gönderilir.
- **Kurumsal aktarım (ZIP):** kurumsal dal main'in **birebir** kopyası olur. Kurumsal PC GitHub'a git ile erişemediği için kod main ZIP'iyle taşınır. Yöntem, kurumsal klonda, kurumsal dalda:
  1. `git pull`
  2. `git rm -r -q .`: izlenen bütün dosyalar silinir. Kopyalarken "üzerine yaz / atla" sorusu çıkmaz ve main'de silinmiş dosyalar geride kalmaz.
  3. GitHub'dan main ZIP'i indirilir; `PORTAL-BMW-main-main` klasörünün **içeriği** klonun köküne kopyalanır. ZIP, GitHub Actions'taki "Teslim imzası" ve "Kapsam raporu" işleri bittikten sonra indirilir.
  4. `git add -A`. Node varsa `node scripts/teslim.cjs --dogrula` çalıştırılır; `BIREBIR` yazmalı.
  5. Commit (kurumun PBI biçimiyle), push, iş yeniden koşturulur.
  - **Neden:** 2026-11-18'deki iş #48'de dal, main'in yarım bir kopyasıydı. Aynı commit'te gelen iki dosyadan `scripts/kurumsal-derle.cjs` gelmiş, `package.json` satırı gelmemişti; iş `npm error Missing script` ile düştü. Var olan dosyaların üzerine kopyalama bu tür karışık ağaç üretir.
  - **Kuruma gitmeyenler:** `.github/`, `.claude/`, `.agent/` (GitHub CI ve ajan talimatları) ve `sunum/` (tanıtım sunumu). Kurumsal derlemede kullanılmazlar ve kurumsal depoya gitmezler. İmza onları iki yönde de yok sayar: kopyalansalar da kopyalanmasalar da ilk adım geçer (iş #50).
  - **Teslim imzası:** [`kalite/teslim.json`](../kalite/teslim.json), main'deki her izlenen dosyanın git blob sha'sı (`kalite/` ve kuruma gitmeyenler hariç). [`.github/workflows/teslim-imzasi.yml`](../.github/workflows/teslim-imzasi.yml) her main push'undan sonra tazeler; elle düzenlenmez. `kurumsal:derle`'nin ilk adımı ([`scripts/teslim.cjs`](../scripts/teslim.cjs) `--dogrula`) kodu bununla karşılaştırır. Fark varsa iş orada durur ve farkı dosya dosya söyler: içeriği farklı, eksik, fazla.
  - **Tazeleme penceresi:** main'e push'tan sonra yaklaşık bir dakika imza eskidir. O arada indirilen ZIP ilk adımda düşer; mesaj nedenini söyler, ZIP yeniden indirilir.
  - **Sınır:** `package.json`'ın kendisi eskiyse `kurumsal:derle` hiç çalışmaz (iş #48). Onu yalnız bu aktarım yöntemi önler.
- **Prova (K14):** [`scripts/kurumsal-prova.cjs`](../scripts/kurumsal-prova.cjs) kurumsal işi CI'da tekrarlar. Kurumsal klon gibi temiz bir git ağacında, groovy'deki Node sürümüyle:
  - imzayı yazar;
  - `npm install` çalıştırır (kurumun `jf npm install`'ı);
  - groovy'nin geri kalan komutlarını aynen `npm <komut>` olarak koşturur;
  - `compress` dizininde çalışma zamanı paketinin eksiksiz olduğunu denetler;
  - toplam süre 10 dakikayı geçerse kırmızı olur (kurumun sınırı 15 dakika).

  Kayıt defteri ve JFrog'un `.npmrc`'si gibi kurum ortamı farkları provada yoktur.
- **Ajan:** `tools` yalnız `nodejs` verilir. Kütüphane npm + yalnız nodejs için Linux ajanını (`POD&&NODEJS`) kendisi seçer; ajan elle verilmez. Araç verilmezse iş varsayılan ajana düşer ve derleme araçları kurulamaz (2026-11-18'e kadarki kırık iş).
- **Kapsam:** (`kurumsal:derle` içinde) testler bu işte koşturulmaz; npm komutlarının hepsi tek bir 15 dakikalık zaman aşımı içinde. CI her main push'unda gerçek testlerle `kalite/kapsam/` raporunu üretir. `npm run kapsam:kurumsal` bu raporu, kurumsal Sonar adımının aradığı `coverage/lcov.info`'ya koyar.
  - Rapor kaynakla aynı değilse Sonar koşusunu düşürür; yanlış eşleşen kapsam yüklenmez.
  - Normal derlemede yalnız uyarır.
- **Paket:** `build/BMWPORTAL/PORTAL-BMW-main` altında üretilir. Kütüphanenin Sonar adımı `build/**`'i taramaz; zip adımı çalışma alanı içinden okur. War'ın kökü `PORTAL-BMW-main/`, çünkü `deploy/release.sh` bunu bekler.
- **Adlar:** `BMWPORTAL.war` ve `BMWPORTAL-D`, uygulamanın SI/CMDB kaydındaki war ve deployment adlarıdır.
- **TST ve PRD:** [`TST_…`](../deploy/jenkins/TST_JAVASCRIPT_GAR_BMW_PORTAL.groovy) ve [`PRD_…`](../deploy/jenkins/PRD_JAVASCRIPT_GAR_BMW_PORTAL.groovy). Derleme, paket, war ve staging DVL ile birebir aynıdır (bekçi KJ4).
  - TST deployment adı `BMWPORTAL-T`. Kurumdaki `-D` / `-T` / `-Q` kalıbından türetildi; TST SI kaydıyla doğrulanmalı.
  - PRD'de deploy adımı yoktur. Üretim kurulumu staging'deki `BMWPORTAL.war`'dan ayrı süreçle yapılır.
- **Bekçi:** `server/__tests__/kurumsal-pipeline.test.cjs` (teslim imzası: `server/__tests__/teslim.test.cjs`). Şunları denetler:
  - Node sürümü izin listesinde ve Dockerfile ile aynı;
  - araç yalnız nodejs, elle ajan yok;
  - komut sırası ve betiklerin varlığı;
  - paketin yeri;
  - war ve deployment adları SI kaydıyla aynı;
  - gerçek e-posta adresi yok.

## Kancalar

`npm run kur` kurar; `--no-verify` ile atlamak **yasaktır**. Atlansa bile CI aynı kapıları yeniden koşturur ve `main` koruması kırmızı PR'ı birleştirtmez.

- `pre-commit`: değişen dosyalarda ESLint (0 uyarı), biçim çırığı, sır taraması (gitleaks kuruluysa o da).
- `commit-msg`: konu satırı 8–120 karakter; mesajda sır yok. Türkçe serbest biçim geçerlidir.
- `pre-push`: `npm run kapi:hizli`.

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) her PR'da ve `main`'e her push'ta üç iş koşturur:

- `verify`: K0–K12.
- `kurumsal`: K14. Node sürümü groovy'den okunur; aşağıdaki "Kurumsal Jenkins" bölümüne bakın.
- `sonar`: K13. Taze bir SonarQube konteyneri açılır, kapı `kalite/esikler.json`'dan kurulur, kapsam raporu `verify` işinden gelir. `verify` ve `kurumsal`'ı bekler; zorunlu kontrol olduğu için prova da fiilen zorunludur.

`scripts/kapi.cjs` içindeki liste ile CI adımlarının eşitliği testle kilitlidir. Hiçbir adım `continue-on-error` ya da `|| true` taşımaz.

## SonarQube ayrıntısı

- **Profil:** Sonar way (JS/TS/Python). **Kapı:** "Portal Katı"; koşulları `kalite/esikler.json` `sonar.kosullar`. Betik her koşuda kapıyı bu listeye eşitler.
- **Kopya (CPD) dışı:** yalnız bildirimsel veri dosyaları. Liste ve gerekçeleri `kalite/esikler.json` `sonar.cpdHaric`'tedir ve `sonar-project.properties` ile birebir aynıdır. Kod dosyası eklenmez.
- **Kapsam dışlaması (`sonar.coverage.exclusions`) ve sorun bastırma (`sonar.issue.ignore.*`) yoktur.** Bunları eklemek kırmızıdır.
- **Gerekçeli incelemeler** [`kalite/sonar-inceleme.json`](../kalite/sonar-inceleme.json)'da tutulur. Eşleşme ölçütü kural + dosya + satır içeriğidir. Betik eşleşen bulguyu işaretler:
  - hotspot ise "Reviewed – Safe";
  - sunucu sürümü aynı kuralı sorun olarak açmışsa (26.x'te S5443 gibi) "Accepted".

  Kaydı olmayan bulgu açık kalır ve kapı kırmızı olur. Kayıt yalnız gerçekten güvenli olup kodda dürüst düzeltmesi olmayan bulgu içindir ve CODEOWNERS onayından geçer. Her kaydın dosyası ve içerik metni gerçekten var olmalıdır; bayat kayıt test tarafından reddedilir.
- **Tip bilgisi:** tarama geliştirme ağacı kurulu (`npm run kur`) yapılır. Tip denetimli kurallar (örn. bekletilmeyen promise, S9383) ancak böyle çalışır.
- **Yerelde:** Docker varsa `node scripts/sonar-kapi.cjs --docker` konteyneri kendi açar. Çalışan bir sunucu varsa `SONAR_HOST_URL` + `SONAR_TOKEN` (ya da `SONAR_ADMIN_PASSWORD`) verilir.
- **Kurumsal SonarQube'un kapısı ayrıdır ve daha gevşektir.** Bu kapı, kurumda kırmızı çıkmamanın yerel garantisidir.

## Onaylayıcı (PR inceleyen) kontrol listesi

Onay vermeden önce:

1. **CI'da `verify` ve `sonar` yeşil.** Ajanın ya da yazarın "geçti" demesi yetmez; CI çıktısına bakılır.
2. **Kapı gevşetilmedi.** Şu dosyalardan birine dokunan PR ayrıca gerekçelendirilir: `kalite/esikler.json`, `kalite/sonar-inceleme.json`, `sonar-project.properties`, `.github/workflows/`, `.husky/`, `scripts/kapi.cjs`, `scripts/sonar-kapi.cjs`, `server/__tests__/kalite-kapilari.test.cjs`.
3. **Yeni davranışın testi var.** Kaynak metni okuyan bekçi tek başına yetmez; davranış testi olmalı. Yeni bekçi için mutasyonla körlük denetimi yapılmış olmalı.
4. **Sır, iç ad, `.har` yok.** Repo public: kurum alan adı, sunucu adı, IP, kişi adı eklenmez.
5. **Arayüz değiştiyse** gerçek tarayıcıda bakılmış (`npm run ui:tarama`).
6. **Repo hijyeni.** Yeni dosya bir yerden bağlı; yerini alan ya da artık kullanılmayan dosya aynı PR'da silinmiş; tek seferlik betik, rapor ya da plan eklenmemiş.

## Yapay zekâ ajanları

Aynı kurallar ajanlar için de geçerlidir; Claude Code, Codex, Qoder, Antigravity ve Gemini fark etmez. Talimat dosyaları buraya işaret eder: [`AGENTS.md`](../AGENTS.md), [`CLAUDE.md`](../CLAUDE.md), [`GEMINI.md`](../GEMINI.md), [`.agent/rules/kalite-kapilari.md`](../.agent/rules/kalite-kapilari.md) ve proje ajanlarının tanımları (`.claude/agents/*.md`). Ajan teslimden önce `npm run kapi` koşturur ve sonucu sayılarıyla raporlar.

Ajan şunları **yapmaz**:

- tarayıcıdan gizlemek için dizgi bölmek (`['', 'tmp'].join('/')` gibi), kodu veri dosyasına taşımak;
- bastırma, dışlama ya da eşik değişikliği;
- testi zayıflatmak;
- `--no-verify`;
- kullanılmayan dosya bırakmak ya da tek seferlik betik, rapor, plan eklemek (repo hijyeni);
- başka bir ajanın çalıştığı dala yazmak (aynı dala aynı anda tek ajan; devralmadan önce o ajan durdurulur).

## Depo sahibi için: `main` koruması

Kapıları zorunlu kılan son halka budur. Yalnız depo yöneticisi açabilir; katkıcıların yazma yetkisi yetmez. Kural seti [`kalite/main-korumasi.json`](../kalite/main-korumasi.json)'dadır:

- PR zorunlu;
- 1 onay, CODEOWNERS onayı, yeni push eski onayı düşürür;
- `verify` ve `sonar` yeşil ve dal güncel;
- yorumlar çözülmüş;
- zorla push ve dal silme yasak.

```bash
gh api -X POST repos/onurdemir01/PORTAL-BMW-main/rulesets --input kalite/main-korumasi.json
```

**Kapsam raporu iş akışı** (`kapsam-raporu.yml`) `main`'e kendisi yazar. Koruma açıkken bunun için bir **deploy key** gerekir:

1. Yazma yetkili bir deploy key oluşturulur (Settings › Deploy keys).
2. Özel anahtarı `KAPSAM_DEPLOY_KEY` sırrına konur.
3. Kural seti deploy key'lere atlama izni verir (`bypass_actors`).

Sır tanımlı değilse iş akışı eskisi gibi `GITHUB_TOKEN` ile dener; koruma açıkken bu push reddedilir.
