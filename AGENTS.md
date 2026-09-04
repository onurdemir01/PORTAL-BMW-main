# BMW Portal — Agent Rehberi

Bu depo, geliştirme akışını destekleyen uzman ajanları içerir. Her ajanın sorumluluk alanı, tetiklenme koşulları ve sınırları aşağıda belgelenmiştir.

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
3. **Kanıt üret**: Denetim listesini uygula (bekçi körlüğü, sessiz başarısızlık, Portal↔AWX sözleşmesi, yetki, dürüstlük, teslim öncesi)
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
