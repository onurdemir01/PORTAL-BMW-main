# BMW Portal — Claude Code talimatı

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
