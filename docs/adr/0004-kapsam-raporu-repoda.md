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

## Düzeltme (2026-11-18): repodaki rapor kurumsal Sonar'a hiç ulaşmadı

Kurumsal pipeline'ın Sonar adımı incelendi; birkaç ayarı komut satırından veriyor ve böylece `sonar-project.properties`'i eziyor:

| Ayar | Kurumsal değer |
|---|---|
| `sonar.sources` | `.` |
| `sonar.tests` | `.` |
| `sonar.test.inclusions` | `**/*.test.js,**/*.test.tsx` |
| `sonar.exclusions` | sabit bir liste |
| `sonar.javascript.lcov.reportPaths` | çalışma alanında `**/coverage/lcov.info` deseniyle bulunan dosyalar |

Sonuçları:

- **`kalite/kapsam/lcov.info` hiç okunmadı.** Bu desene uymuyor ve repodaki `reportPaths` ezildi. %0 kapsamın asıl sebebi pipeline'da testlerin koşmamasıdır.
- **Kalıcı çözüm pipeline tanımındadır:** Jenkins `build.commands` içinde `npm run test:coverage` koşar, `coverage/lcov.info` aynı çalışma alanında oluşur, tarayıcı onu bulur. Kurumsal groovy dosyası repo dışındadır.
- **Vitest kapsamı yalnız `lcov.info` üretir (`lcovonly`).** HTML raporun JS ve CSS dosyaları, kaynak gibi taranıp bulgu üretirdi.
- **Kalan kısıt kurumsal kütüphanededir.** `.test.cjs` ve `.test.ts` dosyaları ile `__tests__` yardımcıları test sayılmaz, kaynak kod gibi taranır. Repo bunu ayarla düzeltemez; kütüphanenin, `sonar-project.properties` varken bu ayarları ezmemesi istenir.
- **Kaldırma:** Pipeline'da kapsam görüldüğünde `kalite/kapsam/`, `kapsam-raporu.yml` ve bu ADR'nin "Şimdi" maddesi kaldırılır.
