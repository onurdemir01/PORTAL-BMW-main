# BMW Portal — Agent Rehberi

Bu depo, geliştirme akışını destekleyen uzman ajanları içerir. Her ajanın sorumluluk alanı, tetiklenme koşulları ve sınırları aşağıda belgelenmiştir.

## Değişmez kural: 0 zafiyet (2026-11-12, herkes için)

Kurumsal güvenlik taramasından geçen her teslim **0 zafiyet** ile geçer; istisna yoktur. Gerekirse her yere dokunulur, ama sonuçta uygulama **çalışır** kalır. Kuruma ve sunucuya giden şey çalışma zamanı paketidir (`npm run paket`); yeni paket 7 gün bekler ve yeni zafiyet yaratamaz. Ayrıntı ve kapılar: `docs/GUVENLIK-0-ZAFIYET.md`.

## Değişmez kural: kalite kapıları (2026-11-15, herkes için)

`main`'e giren her değişiklik, insan ya da ajan yazmış olsun, [docs/KALITE-KAPILARI.md](docs/KALITE-KAPILARI.md)'deki kapıların **hepsinden** geçer.

- Teslimden önce `npm run kapi` koşturulur; sonuç sayılarıyla raporlanır ("geçti" demek yetmez).
- CI'da `verify` ve `sonar` yeşil olmadan merge yok; onay, onaylayıcı listesinden geçmiş bir inceleyiciden gelir.
- Kapılar yalnız sıkılaşır. Şunlar yasaktır:
  - eşik düşürmek;
  - bastırma ya da dışlama eklemek (`NOSONAR`, `eslint-disable`, `@ts-ignore`, `.skip`, `sonar.*.exclusions`);
  - testi zayıflatmak;
  - tarayıcıdan gizlemek için kodu bölmek;
  - `--no-verify`.

## Değişmez kural: repo hijyeni (2026-11-18, herkes için)

Repoda kullanılmayan dosya kalmaz; insan ya da ajan fark etmez. Ayrıntı: [docs/KALITE-KAPILARI.md](docs/KALITE-KAPILARI.md) "Repo hijyeni".

- Node testleri `*.test.js` adını taşır (`*.test.cjs` değil): kurumsal Sonar testi yalnız `*.test.js` / `*.test.tsx` adından tanır; klasördeki `package.json` (`"type": "commonjs"`) onları CommonJS yapar. Ayrıntı: [docs/KALITE-KAPILARI.md](docs/KALITE-KAPILARI.md) "Kurumsal Sonar".
- Repo hijyeni: kullanılmayan dosya bırakılmaz.
  - Yeni dosya bir yerden bağlanır (README / ilgili belge / `package.json` / kullanan kod).
  - İşi biten dosya aynı PR'da silinir; arşiv dizini açılmaz, git geçmişi yeter.
  - Tek seferlik betik, iş kaydı / PBI, yol haritası ve oturum raporu repoya girmez (`.ai-workspace/`).
  - Bekçi: `scripts/repo-hijyeni.cjs` (CI'da).
- Aynı dala aynı anda tek ajan yazar; başka bir ajanın açık PR'ı o ajan durdurulmadan devralınmaz.

## Proje Ajanları (`.claude/agents/`)

### `logx-uzman`

**Sorumluluk**: LogX v2 modülü — OCP uygulama keşfi, log indirme state machine, vault entegrasyonu, güvenlik sınırları.
**Tetiklenme**: LogX ile ilgili kod değişikliği, bug tespiti veya mimari soru olduğunda.
**Sınırlar**: Yalnızca LogX modülü; ScaleX/OpsX/FileX/Telnet kapsamı dışı.

### `playbook-denetci`

**Sorumluluk**: Ansible/AWX playbook denetimi — üretim tuzakları, survey sözleşmesi, `set_stats` yayını, rescue yolları, katalog uyumluluğu.
**Tetiklenme**: `server/ansible/` altında bir değişiklik yapıldığında veya AWX paketi güncellendiğinde.
**Sınırlar**: Yalnızca Ansible/AWX tarafı; portal Node.js/React kodu kapsamı dışı.

### `portal-kesif`

**Sorumluluk**: Kod tabanının salt-okunur keşfi — dosya konumları, bağımlılıklar, kalıplar, sahiplik sınırları.
**Tetiklenme**: "Nerede tanımlı?", "Hangi dosyalar referans veriyor?", "Bu modülün kapsamı ne?" gibi araştırma sorularında.
**Sınırlar**: Yalnızca okuma; hiçbir dosyayı değiştirmez.

### `uretim-teshis`

**Sorumluluk**: Üretim olaylarının tanısı — HAR dosyaları, AWX job logları, sunucu çıktılarından kök neden çıkarımı.
**Tetiklenme**: Kullanıcı bir üretim hatası, beklenmeyen davranış veya performans sorunu bildirdiğinde.
**Sınırlar**: Yalnızca tanı; düzeltme uygulamaz (düzeltmeyi ana ajana önerir).

## Doğrulayıcı Rolü (oturum düzeyinde)

Bu rol, ana ajanın her turdaki çıktısını **düşmanca doğrulamak** için tasarlanmıştır. Bir onaylayıcı değildir; her turda ya bir bulgu üretir ya da bulgu üretemediğini kanıtlar.

### Çevrim (her turda sırayla)

1. **Senkron**: `git fetch` + `git log --oneline origin/main -5`
2. **Delta al**: Ana ajanın son turda neye dokunduğunu belirle
3. **Kanıt üret**: Denetim listesini uygula (bekçi körlüğü, sessiz başarısızlık, Portal↔AWX sözleşmesi, yetki, dürüstlük, teslim öncesi, kalite kapıları: `docs/KALITE-KAPILARI.md` onaylayıcı listesi — CI `verify` + `sonar` yeşil mi, kapı gevşetildi mi, repo hijyeni: yetim ya da tek seferlik dosya eklendi mi)
4. **Görev kuyruğunu yeniden sırala**
5. **Çıktı ver**: `TUR <n>` biçiminde — bulgular, görevler, kapananlar, denenenler

### Kurallar

- Kanıtsız bulgu yazma; çalıştırılamayan bulgular `MAKUL` güven seviyesiyle işaretlenir
- Ana ajanın kodunu düzeltme; görev üret
- Yeni bekçi önerirken körlüğünü de öner (mutasyon testi)
- Aynı bulguyu iki kez açma; kapanmadıysa "hâlâ açık" diye taşı

## Kullanım

Ajanlar, Qoder CLI'da `/agent` komutu veya ilgili skill'ler aracılığıyla çağrılabilir. Doğrulayıcı rolü, ana ajana ek bir sorgu olarak veya ayrı bir oturumda çalıştırılır.

Ayrıntılı ajan tanımları için `.claude/agents/<ajan-adi>.md` dosyalarına bakınız.
