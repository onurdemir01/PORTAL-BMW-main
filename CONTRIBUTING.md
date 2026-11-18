# Katkı Rehberi (`CONTRIBUTING.md`)

## Geliştirme Akışı

1. **Kurulum:** `npm run kur` (geliştirme araçları + git kancaları).
2. **Dal stratejisi:** Her değişiklik kısa ömürlü bir dalda yapılır ve PR ile `main`'e girer.
3. **Standartlar:** Mimari ve kodlama standartları [docs/STANDARTLAR.md](docs/STANDARTLAR.md)'de.
4. **Commit mesajı:** Türkçe serbest biçim geçerlidir. Konu satırı 8–120 karakter olur ve ne yapıldığını söyler; mesajda sır olmaz (`commit-msg` kancası denetler).

## Kalite kapıları (zorunlu)

Tek kaynak: [docs/KALITE-KAPILARI.md](docs/KALITE-KAPILARI.md).

- PR açmadan önce `npm run kapi` koşturulur. Kapsadığı kapılar:
  - tip denetimi, lint, ASCII, sunucu denetimi, manifest;
  - bağımlılık güvenliği, ön kontrol;
  - testler + kapsam ≥ %70;
  - mutasyon, SBOM;
  - derleme + paket.
- Sonar'a dokunan değişiklikte `npm run kapi:sonar` da koşturulur.
- Kancalar commit ve push anında hızlı kapıları kendisi koşturur. `--no-verify` yasaktır.
- CI'da `verify` ve `sonar` yeşil olmadan ve onaylayıcı onayı olmadan merge yoktur.

## Yasak uygulamalar

- `NOSONAR`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `.only` / `.skip` eklenemez (tavanlar `kalite/esikler.json`).
- `sonar.coverage.exclusions`, `sonar.issue.ignore.*` ya da kaynak dışlaması eklenemez.
- Tarayıcıdan gizlemek için dizgi bölmek ya da kodu veri dosyasına taşımak yasaktır.
- Eşik düşürmek ve testi zayıflatmak yasaktır.

### Repo hijyeni

- Repo hijyeni: kullanılmayan dosya bırakılmaz.
  - Yeni dosya bir yerden bağlanır (README / ilgili belge / `package.json` / kullanan kod).
  - İşi biten dosya aynı PR'da silinir; arşiv dizini açılmaz, git geçmişi yeter.
  - Tek seferlik betik, iş kaydı / PBI, yol haritası ve oturum raporu repoya girmez (`.ai-workspace/`).
  - Bekçi: `scripts/repo-hijyeni.cjs` (CI'da).
- Aynı dala aynı anda tek ajan yazar; başka bir ajanın açık PR'ı o ajan durdurulmadan devralınmaz.
- Gizli anahtar, kurum iç adı / IP'si, `.env` ya da `.har` commit edilemez.
