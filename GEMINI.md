# BMW Portal — Gemini / Antigravity talimatı

@AGENTS.md

## Zorunlu: kalite kapıları

Ayrıntı: [docs/KALITE-KAPILARI.md](docs/KALITE-KAPILARI.md).

- PR açmadan / push etmeden önce `npm run kapi` koştur; sonucu sayılarıyla raporla. Sonar'a dokunan işte `npm run kapi:sonar` da koştur.
- Merge yalnız CI'da `verify` ve `sonar` yeşilken ve onaylayıcı onayıyla yapılır.
- Kapıları gevşetme:
  - eşik düşürmek;
  - bastırma ya da dışlama eklemek;
  - testi zayıflatmak;
  - tarayıcıdan gizlemek için dizgi bölmek ya da kodu veri dosyasına taşımak;
  - `--no-verify`.
- Repo public: sır, iç ad (kurum alan adı, sunucu, IP, kişi) ve `.har` commit edilmez.
- Node testleri `*.test.js` adını taşır (`*.test.cjs` değil): kurumsal Sonar testi yalnız `*.test.js` / `*.test.tsx` adından tanır; klasördeki `package.json` (`"type": "commonjs"`) onları CommonJS yapar. Ayrıntı: [docs/KALITE-KAPILARI.md](docs/KALITE-KAPILARI.md) "Kurumsal Sonar".
- Repo hijyeni: kullanılmayan dosya bırakılmaz.
  - Yeni dosya bir yerden bağlanır (README / ilgili belge / `package.json` / kullanan kod).
  - İşi biten dosya aynı PR'da silinir; arşiv dizini açılmaz, git geçmişi yeter.
  - Tek seferlik betik, iş kaydı / PBI, yol haritası ve oturum raporu repoya girmez (`.ai-workspace/`).
  - Bekçi: `scripts/repo-hijyeni.cjs` (CI'da).
- Aynı dala aynı anda tek ajan yazar; başka bir ajanın açık PR'ı o ajan durdurulmadan devralınmaz.
