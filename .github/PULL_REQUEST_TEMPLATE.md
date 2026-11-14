## Değişiklik Özeti

- **Ne değişti?** <!-- Kısa özet -->
- **İlgili PBI / Talep:** <!-- Varsa referans -->

## Doğrulama Kontrol Listesi (`CONTRIBUTING.md` & `SECURITY.md`)

- [ ] `npm run lint` (`--max-warnings 0`, sıfır yeni uyarı/bastırma)
- [ ] `npm run lint:ascii` (sunucu ve betiklerde ASCII kuralı)
- [ ] `npx tsc --noEmit` (strict TypeScript kontrolü)
- [ ] `npm test` (Node.js sunucu ve mimari bekçi testleri)
- [ ] `npm run test:ui` (Vitest istemci testleri)
- [ ] `npm run guvenlik` (npm audit + Xray taban kapısı — 0 Critical / 0 High)
- [ ] `npm run sbom` (CycloneDX SBOM ve lisans uyumu)
- [ ] `npm run preflight` (kurumsal sürüm ön kontrolü)
- [ ] `npm run build` ve `npm run paket` doğrulandı

## Güvenlik ve Uyumluluk

- [ ] Yeni gizli anahtar, gerçek kurum IP'si, `.env` veya `.har` dosyası eklenmedi
- [ ] `NOSONAR`, `@ts-ignore`, `eslint-disable`, `it.skip` veya yapay coverage hariç tutma eklenmedi
- [ ] Yetkilendirme / girdi doğrulama / log maskeleme kuralları korundu
