# Kalite kapıları (zorunlu)

Bu depodaki her değişiklik [docs/KALITE-KAPILARI.md](../../docs/KALITE-KAPILARI.md)'deki kapılardan geçer. Genel kurallar: [AGENTS.md](../../AGENTS.md).

- Teslimden önce `npm run kapi` (Sonar'a dokunan işte `npm run kapi:sonar` da). Sonucu sayılarıyla raporla.
- Merge yalnız CI'da `verify` ve `sonar` yeşilken, onaylayıcı onayıyla.
- Yasak:
  - eşik düşürmek;
  - bastırma (`NOSONAR`, `eslint-disable`, `@ts-ignore`, `.skip`);
  - Sonar dışlaması;
  - tarayıcıdan gizlemek için dizgi bölmek (`['', 'tmp'].join('/')` gibi);
  - testi zayıflatmak;
  - `--no-verify`;
  - sır, iç ad ya da `.har` commit etmek.
