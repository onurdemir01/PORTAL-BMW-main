# ADR 0004 — Kapsam raporu repoda taşınır (geçici)

- **Durum:** Kabul edildi (2026-11-14)
- **İlgili:** ADR 0002 (iki test koşucusu ve LCOV birleştirme)

## Bağlam

Kurumsal SonarQube kapsamı %0 gösteriyordu. Kök neden:

- SonarQube kapsamı, analiz anındaki çalışma ağacında bir LCOV dosyası bulursa görür.
- Kurumsal pipeline testleri koşturamıyor: Node 16 (testler `node:test` ve Vitest ile Node 22+ ister) ve pipeline'da test aşaması yok.
- `coverage/` git dışıdır; yerelde ya da GitHub'da üretilen rapor kurumsal ağaca hiç ulaşmaz.

## Karar

İki yol birlikte yürür:

1. **Şimdi:** rapor repoda, `kalite/kapsam/` altında taşınır.
   - `npm run test:coverage && npm run kapsam:yayinla` üretir: `lcov.info` (yalnız kaynak dosyaları, yalnız SonarQube'un okuduğu satırlar) ve `ozet.json` (kaynak ağacının özeti, oran).
   - `.github/workflows/kapsam-raporu.yml` main'e her push'tan sonra raporu yeniler ve yalnız `kalite/kapsam/`'ı commit eder.
   - `sonar-project.properties`: `sonar.javascript.lcov.reportPaths=kalite/kapsam/lcov.info,coverage/lcov.info`.
2. **Kalıcı:** kurumdan pipeline'a Node 22 + test + kapsam aşaması istenir. Eklenince bu iş akışı ve `kalite/kapsam/` kaldırılır; pipeline `coverage/lcov.info`'yu kendisi üretir.

## Bayatlık

- Rapor, üretildiği kaynak ağacına bağlıdır. Kaynak değişip rapor yenilenmezse SonarQube satırları yanlış eşleştirir.
- `npm run kapsam:dogrula` raporun kaynakla aynı olduğunu sınar (bayatsa çıkış 1).
- **Kuruma teslimden önce** (`main` kurumsal depoya gönderilmeden önce) `npm run kapsam:dogrula` geçmelidir. Geçmiyorsa iş akışının bitmesi beklenir ya da `npm run test:coverage && npm run kapsam:yayinla` ile yenilenip commit edilir.
- PR kontrolüne konmaz: her PR kaynağı değiştirdiği için rapor PR'da her zaman bayattır; yenileme main'de yapılır.

## Sonuçlar

- Depo her yenilemede yaklaşık 3 MB'lık (sıkıştırılmış ~0,8 MB) bir metin farkı taşır.
- Rapor yalnız sonuçtur; kapsamın kendisi testlerle üretilir. Elle düzenlenmez, dışlama ile oran yükseltilmez.
