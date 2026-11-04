# BMW Portal tanıtım sunumu

On slaytlık tanıtım destesi (Kasım 2026). Karma kitle için hazırlandı: üstte iş değeri ve rakam, altta kısa teknik not. Deste Claude Code (yapay zekâ) ile hazırlandı; rakamların hepsi depodan ölçüldü.

| Dosya                     | Ne işe yarar                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| `BMW-Portal-Tanitim.pdf`  | Okumak, paylaşmak, yazdırmak için                                                                   |
| `BMW-Portal-Tanitim.pptx` | PowerPoint / Keynote'ta düzenlemek için                                                             |
| `kaynak/project/`         | Destenin kaynağı: `deck.json` + `slides/*.html` (1920×1080, her slayt tek `<section>`) ve görseller |

## Akış

1. **BMW Portal** — operasyonun tek kapısı
2. **Tek Giriş, 21 Ekran** — beş hatlı metro haritası (Gözlem hattı: yakında)
3. **Bir Tıkın Arkası** — tek düğmenin arkasındaki sekiz adım
4. **Bütün Yollar Aynı Kapıdan** — beş modül, dört kapı (Erişim, OCO, SMART, İz)
5. **Ekip Kendi İşini Görür** — ScaleX, Otomasyon, LogX, OpsX
6. **Yük Testi: Sunucu Ne Kadar Dayanır?**
7. **Emekliye Ayırmaktan Kripto Altyapısına** — Server Hub ve Crypto Hub
8. **Her Uygulamanın Bir Sahibi Var** — Denetim
9. **Kaynak Koda Dokunmadan** — Admin Merkezi
10. **Her 100 Satır Koda 57 Satır Test** — kalite güvencesi

## Ekran görüntüleri

Görüntüler yerel geliştirme ortamında, **uydurma örnek veriyle** çekildi: gerçek sunucu adı, IP, kullanıcı ya da kayıt yok (`ornek.*` adları, `192.0.2.x` belge IP aralığı). Her görüntünün yanındaki sarı kesik çerçeveli **"Buradan aldım"** etiketi, gerçek ortamın görüntüsüyle değiştirilecek yeri gösterir.

| Slayt | Görüntü                       | Portal yolu                                                  |
| ----- | ----------------------------- | ------------------------------------------------------------ |
| 1     | ScaleX, Yük Testi, Denetim    | `/scalex`, `/nginx-console?tab=yuktesti`, `/denetim?tab=ocp` |
| 3     | Otomasyon kartları            | `/self-service`                                              |
| 4     | Admin › Smart Talepleri       | `/admin?tab=smarttickets`                                    |
| 5     | ScaleX, Otomasyon, LogX, OpsX | `/scalex`, `/self-service`, `/logx`, `/opsx`                 |
| 6     | Yük Testi koşu sonucu         | `/nginx-console?tab=yuktesti`                                |
| 7     | Retirement kaydı, Crypto Hub  | `/server-hub`, `/crypto-hub`                                 |
| 8     | Denetim › OpenShift           | `/denetim?tab=ocp`                                           |
| 9     | Admin › Sistem                | `/admin?tab=system`                                          |

Logo `kaynak/project/ds/logo/logo.png`; on slaytın hepsi bu tek dosyayı kullanır.

## Rakamlar ve kaynakları

Hepsi `origin/main` 6312fb81 (4 Kasım 2026) üzerinde ölçüldü.

| Rakam               | Değer                                                                                        | Kaynak                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Ekran               | 21                                                                                           | `src/config/elements.ts` `PAGES`                                                     |
| Admin sekmesi       | 16                                                                                           | `src/config/elements.ts` `admintab:*`                                                |
| Birleştirilen PR    | 211                                                                                          | `git log --merges`                                                                   |
| Süre                | 14 hafta (30 Temmuz – 4 Kasım)                                                               | `git log`                                                                            |
| AI eşliğinde commit | 928 / 997 = %93                                                                              | `git log --no-merges --format=%B \| grep -ci 'Co-Authored-By: Claude'`               |
| Ansible             | 31 playbook, 47 YAML, 15.124 satır                                                           | `git ls-tree server/ansible` + `hosts:` içerenler                                    |
| Bağlı sistem        | 8 (AWX, OpenShift, nginx, SMART, OCO, CMDB, LDAP, MSSQL); yakında Dynatrace, Instana, Splunk | modüllerin istemcileri                                                               |
| Otomatik test       | 4.306 sunucu + 1.032 arayüz = 5.338                                                          | `npm test`, `npx vitest run`                                                         |
| Test sonucu         | sunucu 4.284 geçti, 11 kırmızı, 11 atlandı; arayüz 1.032 / 1.032                             | aynı koşu                                                                            |
| Kod / test satırı   | ~221 bin / ~127 bin (her 100 satıra 57 satır test)                                           | `git grep -c ''`                                                                     |
| Test dosyası        | 341 sunucu + 144 arayüz                                                                      | `git ls-tree`                                                                        |
| Tarayıcı taraması   | 136 ölçüm                                                                                    | `docs/UI-TARAMA.md`                                                                  |
| Mutasyon turu       | 253 commit mesajında                                                                         | `git log -i --grep mutasyon`                                                         |
| Onay katmanı        | 5 modül × 4 kapı                                                                             | `server/ansible/change-gates.cjs`, `smart-gate.cjs`, `server/opsx/prod-approval.cjs` |
| ScaleX              | 59 Ansible görevi (varsayılan yürütme yolu)                                                  | `server/ansible/bmw_portal/scalex/scalex_app/`                                       |
| Yük Testi           | 5000 istek/sn üst sınır, en çok 16 koşu karşılaştırma, k6 + wrk, 318 test                    | `server/nginx-loadtest/dogrula.cjs`, `coklu.cjs`                                     |
| Uygulama sahibi     | CMDB → ARK → namespace, 5 ekranda kaynağıyla                                                 | commit e75d43ba                                                                      |
| Admin › Sistem      | 87 ayar, 22'si anında geçerli, 17 grup                                                       | `server/db/env-overrides.cjs`, `src/components/admin/tabs/sistem/gruplar.ts`         |

## Renkler ve yazı

Renkler portalın kendi belirteçlerinden (`src/index.css`): koyu tema `#151515` / `#1F1F1F`, vurgu `#0066cc`, açık zemin `#ffffff` → `#e0f0ff`, ikincil vurgu logonun camgöbeği `#2EE6D6`. Yazı tipleri: Space Grotesk (başlık ve rakamlar), IBM Plex Sans (metin), IBM Plex Mono (yol ve etiketler).
