# BMW Portal — çalışma zamanı paketi: kurulum

Bu dizin `npm run paket` ile üretilmiş **çalışma zamanı paketidir**. İçinde:

- `server/`, `shared/`: sunucu kodu.
- `src/`, `index.html`, `public/`: arayüz **kaynağı**. Kod incelemesi için; çalışma zamanında kullanılmaz.
- `dist/`: **önceden derlenmiş** arayüz. Dosya hash'leri `dist/.manifest.sha256`'da.
- `deploy/`, `docs/`, `scripts/`: kurulum ve işletim betikleri.
- `package.json` / `package-lock.json`: **yalnız çalışma zamanı bağımlılıkları**. Geliştirme araçları (vite, vitest, eslint…) yoktur.

## Neden geliştirme araçları yok

Bağımlılık taraması `npm install`'ın kurduğu ağacın tamamını tarar. Üretimde geliştirme aracı çalışmaz: sunucu yalnız çalışma zamanı paketlerini yükler, arayüz hazır `dist/`'tir.

Taranan ağaç, kurulan ağaçla aynıdır. Paket bu yüzden geliştirme araçlarının (örneğin düzeltmesi yayımlanmamış zafiyet taşıyan bir glob kütüphanesinin) açıklarını taşımaz.

## Kurulum

Node.js 22.23.4+ (ya da 24.15+ / 26+) gerekir.

```bash
npm ci                 # yalniz calisma zamani bagimliliklari (devDependencies yok)
npm run build          # DERLEME DEGIL: dist/ eksiksiz ve degismemis mi diye dogrular
npm test               # duman testi: bagimliliklar cozuluyor, sunucu girisi gecerli, dist dogru
npm start              # NODE_ENV=production; ortam dosyasi icin docs/DEPLOYMENT.md
```

Sunucuda kalıcı kurulum `deploy/release.sh <env>` ve `deploy/run.sh <env> start` ile yapılır (`docs/DEPLOYMENT.md`). İkisi de bu paketle çalışır: `npm ci --omit=dev` + `npm run build` (doğrulama).

Jenkins gibi bir CI `npm install` + `npm run build` + `npm test` çalıştırırsa üçü de geliştirme aracı olmadan geçer.

## Arayüzü değiştirmek

Arayüz değişikliği **repoda** yapılır ve paket yeniden üretilir:

```bash
npm run paket -- --cikti <dizin> [--zip <dosya.zip>]
```

Bu dizindeki `src/` düzenlenirse `dist/` değişmez. `npm run build` bunu fark etmez, çünkü yalnız `dist/`'i doğrular. Kaynak ile çıktı ancak paket yeniden üretilince eşleşir.

## Ortam dosyası

`.env.example` örnektir. Gerçek `.env.<ortam>` dosyaları **pakette yoktur** ve sunucuda tutulur. `release.sh` bunları eski sürümden yenisine taşır.
