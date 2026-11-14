# Güvenlik kuralı: teslim her zaman 0 zafiyet

**Karar (2026-11-12, herkes için geçerli):** Kurumsal güvenlik taramasından (bağımlılık taraması + kod analizi) geçen her teslim **0 zafiyet** ile geçer.

- İstisna (ignore rule) yoktur.
- Bir zafiyet kapatılamıyorsa o paket teslimden çıkarılır ya da değiştirilir.
- Sonuçta uygulama çalışır durumda kalmalıdır.

## Model: taranan ağaç = kurulan ağaç

Kurumsal pipeline repo kökünde `npm install`'ın kurduğu **bütün** ağacı tarar. Geliştirme araçlarının bazı alt paketlerinin düzeltmesi yayımlanmamış olabilir; bugün örneği vite ve vitest'in glob kütüphanesi (bakımcısı bulguyu zafiyet saymıyor ve düzeltme yayımlamıyor).

Üretimde ve kurumsal pipeline'da geliştirme aracı çalışmaz. Bu yüzden **kök manifest yalnız çalışma zamanı paketlerini taşır** (2026-11-14):

| Dosya | İçerik | Kim yazar |
|---|---|---|
| `gelistirme/package.json` + `package-lock.json` | **Tam** ağaç: çalışma zamanı + geliştirme. Tek kaynak. | Elle / Dependabot |
| `package.json` (`dependencies`, `overrides`) + `package-lock.json` | Yalnız çalışma zamanı; sürümler tam kilitle birebir. | `npm run manifest` (türetilir) |

- Kurumsal tarama `main`'i doğrudan alır ve yalnız sunucuda çalışan ağacı görür. Ayrı bir teslim dalı ya da kopyası yoktur.
- Geliştirici kurulumu `npm run kur`: tam ağacı `gelistirme/` altına kurar ve kökteki `node_modules`'u ona bağlar. Araçlar ve testler bugünkü gibi çalışır.
- Paket ekleme / güncelleme `gelistirme/` içinde yapılır, ardından `npm run manifest`. Eşitlik testle sınanır (`npm run manifest -- --dogrula`).
- `npm run guvenlik` **tam** ağaca bakar: geliştirmede düzeltmesi yayımlanmış her bulgu yine build'i durdurur.

Sunucuya dağıtılan şey **çalışma zamanı paketidir** (`npm run paket`):

- `package.json`'da `devDependencies` yoktur.
- `package-lock.json` repo kilidinden budanır; sürümler birebir aynı kalır.
- Arayüz önceden derlenmiş `dist/`'tir ve hash manifesti taşır.
- `npm run build` derleme değil, dist **doğrulamasıdır**.

Kurulum: `docs/KURULUM-PAKET.md`. Sunucu tarafında `deploy/release.sh`, `release-git.sh` ve `run.sh` kurulumdan sonra ağaçta geliştirme paketi bırakmaz (`deploy/stage-lib.sh` → `stage_bagimlilik_ve_build`). Kaynak ağaçtan dağıtımda sıra: tam kurulum → derleme → geliştirme ağacının kaldırılması (`scripts/kur.cjs --calisma-zamani`).

## Kapılar

| Nerede | Ne |
|---|---|
| `npm run guvenlik` (Jenkins "Güvenlik" aşaması) | `npm audit`: çalışma zamanında **her** seviye; geliştirmede düzeltmesi yayımlanmış **her** bulgu build'i durdurur. |
| `server/__tests__/guvenlik-tabanlari.test.cjs` | Kurumsal taramanın ihlal saydığı sürümlere kilit geri düşemez; `overrides` silinemez; kök manifest geliştirme paketi taşıyamaz ve tam manifestle eşit kalır; `prepare` araçsız kurulumu düşürmez. |
| `server/__tests__/paket.test.cjs` | Pakete geliştirme aracı sızamaz; çalışma zamanı kodu tanımsız paket yükleyemez; dağıtım betikleri dev paketi bırakamaz. |
| Yerel tarama tezgâhı (repo dışı) | Push öncesi birden çok tarayıcı. Kurumsal tarayıcının kendi bulgu listesinden türetilen sürüm aralığı kontrolü zorunlu kapıdır. |

**Not:** Tarayıcıların veritabanları farklıdır. `npm audit` / OSV, kurumsal tarayıcının bulgularının ancak bir kısmını bilir. Yerelde "temiz" demek kurumsal taramada 0 demek değildir. Bu yüzden her kurumsal tarama sonucu tezgâhın aralık listesine işlenir.

## Paket ekleme / güncelleme kuralı

1. **7 gün bekleme.** Yayımlanalı 7 günden az olan sürüm alınmaz (tedarik zinciri solucanları):

   ```bash
   npm update <paket> --before=<7 gün önce> --ignore-scripts
   ```

   **İstisna: güvenlik düzeltmesi beklemez (2026-11-14).** Kurumsal taramanın ihlal saydığı bir bulguyu kapatan sürüm 7 gün dolmadan alınabilir; o zaman şunların **hepsi** zorunludur:
   - Bulguyu kapatan **en düşük** sürüm alınır, en yenisi değil (`--before=<o sürümün yayım anı>`).
   - Yayımcı bir önceki sürümle aynıdır ya da sürüm yayımcı kanıtı (provenance) taşır.
   - Bir önceki sürümle tarball farkı okunur: kurulum betiği, ağ / süreç / ortam değişkeni erişimi eklenmemiş olmalı.
   - Sürümün getirdiği yeni alt paketler de aynı kontrolden geçer.

2. **Kontrol:** yayım tarihi, registry, integrity ve install-script.
3. **Hedef sürüm birden çok veritabanında temiz olmalı:** OSV + kurumsal aralık listesi.
4. **Yeni zafiyet yaratılmaz.** Eklenen paketin kendi alt ağacı da temiz olmalı. Örneğin bir lint eklentisi zafiyetli bir glob sürümü çekiyorsa repoya eklenmez.
5. **Üst paketin aralığı düzeltmeye izin vermiyorsa** `overrides` kullanılır (kapsamlı, yalnız gerekli üst paket altında). Override'ın çalıştığı testle sınanır.
6. **Düzeltmesi olmayan zafiyet:**
   - Çalışma zamanındaysa paket değiştirilir ya da kaldırılır.
   - Yalnız geliştirmedeyse pakete girmediği doğrulanır ve yukarı akış izlenir. Düzeltme yayımlanınca `npm run guvenlik` onu ister.
