# Katkı Rehberi (`CONTRIBUTING.md`)

## Geliştirme Akışı

1. **Dal Stratejisi:** Her değişiklik kısa ömürlü bir feature/fix dalında yapılır; `main` doğrudan değiştirilmez.
2. **Standart ve İnceleme:** Mimari/kodlama standartları için [docs/STANDARTLAR.md](docs/STANDARTLAR.md) dosyasını okuyun.
3. **Commit Mesajları:** Konvansiyonel commit biçimi önerilir (`feat:`, `fix:`, `security:`, `test:`, `docs:`, `chore:`).

## Doğrulama Kontrol Listesi (Merge Öncesi Zorunlu)

Her PR / commit öncesinde aşağıdaki komutların tamamı hatasız geçmelidir:

- `npm test` — Tüm `node --test` sunucu ve mimari bekçi testleri
- `npm run test:ui` — Tüm `vitest` istemci testleri
- `npm run lint:ascii` — Sunucu ve betiklerde Türkçe ASCII guard kontrolü
- `npm run lint` — ESLint kontrolü (sıfır yeni uyarı)
- `npx tsc --noEmit` — Frontend TypeScript tip kontrolü
- `npm run build` — Production Vite derlemesi
- `npm run preflight` — Kurumsal sürüm/sertleştirme ön kontrolü

## Yasak Uygulamalar

- `NOSONAR`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `it.skip` eklenemez.
- `sonar.coverage.exclusions` ile yapay coverage artışı yapılamaz.
- Gizli anahtar, gerçek kurum IP'si veya `.har` kayıtları commit edilemez.
