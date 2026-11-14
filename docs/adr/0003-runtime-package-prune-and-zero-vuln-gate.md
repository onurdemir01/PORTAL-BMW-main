# ADR-0003: Çalışma Zamanı Paket Budama ve Sıfır Zafiyet Kapısı

- **Durum:** Kabul Edildi
- **Tarih:** 2026-11-14

## Bağlam

Kurumsal Artifactory / Xray taramaları geliştirme araçlarını (`devDependencies`) da içeren tam dependency ağacını tarayabildiği gibi, teslim edilecek çalışma zamanı paketinin geliştirme paketi sızdırmaması gerekmektedir.

## Karar

1. Geliştirme araçları (`vite`, `vitest`, `eslint` vb.) yalnız build/test aşamasında kullanılır; dağıtım paketi `scripts/paket.cjs` aracılığıyla yalnızca çalışma zamanı bağımlılıklarıyla budanmış `package.json` ve `package-lock.json` üretir.
2. Tüm bağımlılıklar için `0 Critical` ve `0 High` zafiyet zorunludur; tarama bulguları sessizce bastırılmaz (`|| true` kullanılmaz).
3. `server/util/` ve `scripts/` üretim kodu yalnız Node standart kütüphanesi veya `dependencies` içindeki paketleri içe aktarır (`PK4b`).

## Sonuçlar

- Üretim sunucusuna gereksiz geliştirme paketi taşınmaz ve saldırı yüzeyi küçülür.
- Dev ve runtime zafiyet ayrımı denetlenebilir ve otomasyona bağlanmış hale gelir.
