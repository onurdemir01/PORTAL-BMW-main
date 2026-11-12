# Güvenlik kuralı: teslim her zaman 0 zafiyet

**Karar (2026-11-12, herkes için geçerli):** Kurumsal güvenlik taramasından (bağımlılık taraması + kod analizi) geçen her teslim **0 zafiyet** ile geçer.

- İstisna (ignore rule) yoktur.
- Bir zafiyet kapatılamıyorsa o paket teslimden çıkarılır ya da değiştirilir.
- Sonuçta uygulama çalışır durumda kalmalıdır.

## Model: taranan ağaç = kurulan ağaç

Kurumsal pipeline `npm install`'ın kurduğu **bütün** ağacı tarar, geliştirme araçları dahil. Geliştirme araçlarının bazı alt paketlerinin düzeltmesi yayımlanmamış olabilir; bugün örneği vite ve vitest'in glob kütüphanesi.

Üretimde geliştirme aracı çalışmaz. Bu yüzden kuruma ve sunucuya giden şey **çalışma zamanı paketidir** (`npm run paket`):

- `package.json`'da `devDependencies` yoktur.
- `package-lock.json` repo kilidinden budanır; sürümler birebir aynı kalır.
- Arayüz önceden derlenmiş `dist/`'tir ve hash manifesti taşır.
- `npm run build` derleme değil, dist **doğrulamasıdır**.

Kurulum: `docs/KURULUM-PAKET.md`. Sunucu tarafında `deploy/release.sh`, `release-git.sh` ve `run.sh` kurulumdan sonra ağaçta geliştirme paketi bırakmaz (`deploy/stage-lib.sh` → `stage_bagimlilik_ve_build`).

## Kapılar

| Nerede | Ne |
|---|---|
| `npm run guvenlik` (Jenkins "Güvenlik" aşaması) | `npm audit`: çalışma zamanında **her** seviye; geliştirmede düzeltmesi yayımlanmış **her** bulgu build'i durdurur. |
| `server/__tests__/guvenlik-tabanlari.test.cjs` | Kurumsal taramanın ihlal saydığı sürümlere kilit geri düşemez; `overrides` silinemez. |
| `server/__tests__/paket.test.cjs` | Pakete geliştirme aracı sızamaz; çalışma zamanı kodu tanımsız paket yükleyemez; dağıtım betikleri dev paketi bırakamaz. |
| Yerel tarama tezgâhı (repo dışı) | Push öncesi birden çok tarayıcı. Kurumsal tarayıcının kendi bulgu listesinden türetilen sürüm aralığı kontrolü zorunlu kapıdır. |

**Not:** Tarayıcıların veritabanları farklıdır. `npm audit` / OSV, kurumsal tarayıcının bulgularının ancak bir kısmını bilir. Yerelde "temiz" demek kurumsal taramada 0 demek değildir. Bu yüzden her kurumsal tarama sonucu tezgâhın aralık listesine işlenir.

## Paket ekleme / güncelleme kuralı

1. **7 gün bekleme.** Yayımlanalı 7 günden az olan sürüm alınmaz (tedarik zinciri solucanları):

   ```bash
   npm update <paket> --before=<7 gün önce> --ignore-scripts
   ```

2. **Kontrol:** yayım tarihi, registry, integrity ve install-script.
3. **Hedef sürüm birden çok veritabanında temiz olmalı:** OSV + kurumsal aralık listesi.
4. **Yeni zafiyet yaratılmaz.** Eklenen paketin kendi alt ağacı da temiz olmalı. Örneğin bir lint eklentisi zafiyetli bir glob sürümü çekiyorsa repoya eklenmez.
5. **Üst paketin aralığı düzeltmeye izin vermiyorsa** `overrides` kullanılır (kapsamlı, yalnız gerekli üst paket altında). Override'ın çalıştığı testle sınanır.
6. **Düzeltmesi olmayan zafiyet:**
   - Çalışma zamanındaysa paket değiştirilir ya da kaldırılır.
   - Yalnız geliştirmedeyse pakete girmediği doğrulanır ve yukarı akış izlenir. Düzeltme yayımlanınca `npm run guvenlik` onu ister.
