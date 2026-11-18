## Değişiklik Özeti

- **Ne değişti?** <!-- Kısa özet -->
- **İlgili PBI / Talep:** <!-- Varsa referans -->

## Kalite kapıları ([docs/KALITE-KAPILARI.md](../docs/KALITE-KAPILARI.md))

- [ ] `npm run kapi` yerelde yeşil (çıktıdaki özet satırları aşağıda)
- [ ] Sonar'a dokunan değişiklikte `npm run kapi:sonar` yeşil
- [ ] CI: `verify` ve `sonar` yeşil

<!-- npm run kapi ozeti -->

## Onaylayıcı için

- [ ] Kapı gevşetilmedi: eşik, bastırma, dışlama, test zayıflatma, dizgi bölme yok. `kalite/`, `sonar-project.properties`, `.github/workflows/`, `.husky/` değiştiyse gerekçesi yazılı.
- [ ] Yeni davranışın davranış testi var (yalnız kaynak metni okuyan bekçi değil).
- [ ] Sır, kurum iç adı / IP'si, `.env` ya da `.har` eklenmedi.
- [ ] Arayüz değiştiyse gerçek tarayıcıda bakıldı (`npm run ui:tarama`).
- [ ] Repo hijyeni: yeni dosya bir yerden bağlı; artık kullanılmayan dosya bu PR'da silindi; tek seferlik betik, rapor ya da plan eklenmedi.
