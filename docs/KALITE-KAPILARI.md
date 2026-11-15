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
| K13 | SonarQube kapısı | `node scripts/sonar-kapi.cjs` | CI (`sonar` işi), yerelde `npm run kapi:sonar` | "Portal Katı": 0 bug, 0 zafiyet, güvenilirlik A (MQR: kod kokularının güvenilirlik etkisi dahil), güvenlik / bakım A, kapsam ≥ %70, tekrar ≤ %3, hotspot %100 incelenmiş, 0 blocker / high |

**Commit öncesi biçim çırığı** (`scripts/bicim-kapisi.cjs`): biçimli (prettier) dosya biçimli kalır, yeni dosya biçimli olur. Biçimsiz eski dosyaya dokunmak serbesttir; toplu biçimleme ayrı, tek commit'te yapılır.

## Kancalar

`npm run kur` kurar; `--no-verify` ile atlamak **yasaktır**. Atlansa bile CI aynı kapıları yeniden koşturur ve `main` koruması kırmızı PR'ı birleştirtmez.

- `pre-commit`: değişen dosyalarda ESLint (0 uyarı), biçim çırığı, sır taraması (gitleaks kuruluysa o da).
- `commit-msg`: konu satırı 8–120 karakter; mesajda sır yok. Türkçe serbest biçim geçerlidir.
- `pre-push`: `npm run kapi:hizli`.

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) her PR'da ve `main`'e her push'ta iki iş koşturur:

- `verify`: K0–K12.
- `sonar`: K13. Taze bir SonarQube konteyneri açılır, kapı `kalite/esikler.json`'dan kurulur, kapsam raporu `verify` işinden gelir.

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

## Yapay zekâ ajanları

Aynı kurallar ajanlar için de geçerlidir; Claude Code, Codex, Qoder, Antigravity ve Gemini fark etmez. Talimat dosyaları buraya işaret eder: [`AGENTS.md`](../AGENTS.md), [`CLAUDE.md`](../CLAUDE.md), [`GEMINI.md`](../GEMINI.md), [`.agent/rules/kalite-kapilari.md`](../.agent/rules/kalite-kapilari.md). Ajan teslimden önce `npm run kapi` koşturur ve sonucu sayılarıyla raporlar.

Ajan şunları **yapmaz**:

- tarayıcıdan gizlemek için dizgi bölmek (`['', 'tmp'].join('/')` gibi), kodu veri dosyasına taşımak;
- bastırma, dışlama ya da eşik değişikliği;
- testi zayıflatmak;
- `--no-verify`.

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
