# ADR-0002: Çift Test Koşucu (`node:test` + `vitest`) ve LCOV Birleştirme

- **Durum:** Kabul Edildi
- **Tarih:** 2026-11-14

## Bağlam

Backend testleri Node'un yerleşik `node --test` koşucusunu (`.test.cjs`), frontend testleri Vitest'i (`.test.ts`/`.test.tsx`) kullanmaktadır. SonarQube Quality Gate analizinde LCOV raporu üretilmediği ve tek birleşik rapor tanımlanmadığı için coverage `%0.0` çıkmıştır (`AUD-001`).

## Karar

1. Backend coverage `--experimental-test-coverage --test-reporter=lcov` ile, frontend coverage Vitest V8 `lcov` çıktısı ile ayrı ayrı üretilir.
2. Harici npm paketine bağımlı olmayan `scripts/lcov-birlestir.cjs` modülü iki LCOV çıktısını tek `coverage/lcov.info` dosyasında birleştirir, `SF:` yollarını repo-göreli POSIX biçime normalize eder ve `DA`/`FN`/`BRDA` özetlerini yeniden hesaplar.
3. `sonar-project.properties` dosyasında yalnızca gerçek kaynak ve test glob'ları tanımlanır; yapay `sonar.coverage.exclusions` konulmaz.

## Sonuçlar

- Çalışma zamanı paketine dev bağımlılığı sızmadan (`paket.test.cjs` PK4b uyumlu) tek LCOV raporu SonarQube'a beslenir.
- Yeni eklenen her `__tests__` dizini `test-glob-coverage.test.cjs` bekçisiyle otomatik denetlenir.
