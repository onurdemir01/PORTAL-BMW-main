# Kalite kapıları (zorunlu, herkes için)

**Kural (2026-11-15):** `main`'e giren her değişiklik — insan ya da yapay zekâ ajanı yazmış olsun — aşağıdaki kapıların **hepsinden** geçer. İstisna yok. Kapılar yalnız **sıkılaşır**: eşik düşürmek, kapı kaldırmak, bastırma (`NOSONAR`, `eslint-disable`, `@ts-ignore`, `.skip`) ya da dışlama eklemek `server/__tests__/kalite-kapilari.test.js` tarafından reddedilir.

Kurumsal teslimde 0 zafiyet kuralı ayrıca geçerlidir: [GUVENLIK-0-ZAFIYET.md](GUVENLIK-0-ZAFIYET.md).

## Tek komut

| Komut | Ne zaman | Ne yapar |
|---|---|---|
| `npm run kapi` | PR açmadan / push etmeden önce | K1–K12'nin tamamı (CI'nin koşturduğu liste) |
| `npm run kapi:hizli` | her push'ta (kanca kendisi koşturur) | hızlı kapılar: K1–K7 |
| `npm run kapi:sonar` | Sonar'a dokunan değişikliklerde; CI her PR'da koşturur | K13: yerel SonarQube kalite kapısı |

İlk kurulum: `npm run kur` (geliştirme araçları ve git kancaları).

## Kapılar

Eşiklerin tek kaynağı: [`kalite/esikler.json`](../kalite/esikler.json).

| K | Kapı | Komut | Nerede | Eşik |
|---|---|---|---|---|
| K0 | Sır taraması | `node scripts/sir-tarama.cjs` | commit öncesi, commit mesajı, CI (PR aralığı) | 0 bulgu; `.har`, `.env`, anahtar dosyası eklenemez |
| K1 | Tip denetimi | `npx tsc --noEmit` | push öncesi, CI | `strict`, 0 hata |
| K2 | Lint | `npm run lint` | commit öncesi (değişen dosya), push öncesi, CI | 0 hata, 0 uyarı (`src`, `server`, `shared`, `scripts`) |
| K3 | ASCII kuralı | `npm run lint:ascii` | push öncesi, CI | 0 ihlal |
| K4 | Sunucu denetimi | `npm run check:server` | push öncesi, CI | 0 ölümcül tanı |
| K5 | Manifest eşitliği | `node scripts/manifest.cjs --dogrula` | push öncesi, CI | kök manifest = `gelistirme/` türevi |
| K6 | Bağımlılık güvenliği | `npm run guvenlik` | push öncesi, CI | 0 zafiyet (Xray tabanı) |
| K7 | Ön kontrol | `npm run preflight` | push öncesi, CI | 0 eksik |
| K8 | Testler + kapsam | `npm run test:coverage` | CI | 0 başarısız test |
| K9 | Kapsam eşiği | `node scripts/kapsam-esik.cjs` | CI | satır kapsamı ≥ %85 |
| K10 | Mutasyon testi | `npm run test:mutation` | CI | ≥ %85 mutant öldürülür |
| K11 | SBOM ve lisans | `npm run sbom` | CI | 0 lisans ihlali |
| K12 | Derleme + paket | `npm run build`, `npm run paket` | CI | ikisi de başarılı |
| K13 | SonarQube kapısı | `node scripts/sonar-kapi.cjs` | CI (`sonar` işi), yerelde `npm run kapi:sonar` | "Portal Katı": 0 bug, 0 zafiyet, 0 kod kokusu, güvenilirlik ve güvenlik A (MQR: kod kokularının etkisi dahil), bakım A, kapsam ≥ %75, tekrar ≤ %1, hotspot %100 incelenmiş, 0 blocker / high |
| K14 | Kurumsal iş provası | `npm run kurumsal:prova` | CI (`kurumsal` işi), yerelde aynı komut | temiz ağaçta groovy'nin komutları aynen geçer, paket eksiksiz, süre ≤ 10 dk |
| K15 | Kurumsal Sonar taklidi | `node scripts/sonar-kapi.cjs --ci --kurumsal` | CI (`sonar` işi) | K13 koşulları + inceleme bekleyen 0 hotspot (inceleme kaydı uygulanmaz); kurumun sınıflandırması ve kural profiliyle ([`kalite/kurumsal-sonar.json`](../kalite/kurumsal-sonar.json)) ayrı projede |
| K16 | `main` geçmişi | `node scripts/gecmis-denetim.cjs` | commit mesajı (konu satırı), CI (`main` push aralığı, PR) | `main`'e giden her first-parent commit birleşmiş bir PR'dan gelir (`github-actions[bot]` muaf); konu satırı 8–120 karakter |
| K17 | Kurum iç adı | `node scripts/ic-ad-bekcisi.cjs` | commit öncesi (eklenen satırlar), commit mesajı, push öncesi ve CI (tüm ağaç + aralıktaki commit mesajları) | 0 kurum sunucu adı ve ad kalıbı, 0 `.com.tr` alan adı (kaçışlı biçim dahil), 0 kurum adı biçimi, 0 bilinen kurum iç ağı adresi; bulunan değer yazdırılmaz |

**Kurum iç adı (K17, 2026-11-20).** Repo public: kurumun sunucu adları ve alan adları koda, teste,
belgeye ya da commit mesajına yazılmaz. Kodun bildiği kurum listeleri kurum ayarındadır
(`server/util/kurum-ayari.cjs`, `KURUM_AYAR_DOSYASI`; biçimi `deploy/kurum-ayari.ornek.json`). Playbook
değerleri AWX template Variables'tadır ([AWX-KOPYALAMA-HARITASI.md](AWX-KOPYALAMA-HARITASI.md) "Kurum
değerleri"). Örnek ve testler kurgusal ad kullanır: önek `OR`, alan adı `*.invalid`. Desenler geneldir;
gerçek ad listesi repoya girmez. Kurallar:

- **Sunucu adı:** kurum önekli ad ve ad kalıbı (`<önek>RVP*`, kısa host etiketi). Harf tutarlı; karışık
  harfli base64 yanlış pozitif vermez.
- **Alan adı:** `.com.tr` ile biten alan adı, regex içindeki kaçışlı biçimi de.
- **Kurum adı (2026-11-21):** ad yazılmaz, sözcüklerin sha256 özeti karşılaştırılır. Yasak olanlar:
  ayırt edici sözcükler, bileşik kimlikte marka parçası (`<marka>_values`), "<marka> <unvan>" ikilisi.
  Marka sözcüğü tek başına sıradan bir Türkçe sözcük olduğu için serbesttir.
- **İç ağ (2026-11-21):** bilinen gerçek ağların özeti (10.x için /16, 192.168.x için /24). Testler özel ağ
  anlamı gerektirdiği için kurgusal 10.x adresleri serbesttir.

Özetlerin kaynağı git dışında (`.ai-workspace/ic-ad/`). Bulgu yalnız `dosya:satır` ve türüyle yazılır;
değer yazdırılmaz, çünkü CI günlüğü de public. Testi `server/__tests__/ic-ad-bekcisi.test.js`; mantık
kurgusal özetlerle sınanır, gerçek listeler yalnız biçimce.

**Commit öncesi biçim çırığı** (`scripts/bicim-kapisi.cjs`): biçimli (prettier) dosya biçimli kalır, yeni dosya biçimli olur. Biçimsiz eski dosyaya dokunmak serbesttir; toplu biçimleme ayrı, tek commit'te yapılır.

## Repo hijyeni

Repoda kullanılmayan dosya kalmaz; insan ya da ajan fark etmez.

- **Yeni dosya bir referansla gelir.**
  - Belge README'den ya da ilgili belgeden bağlanır.
  - Betik `package.json`'dan ya da onu çağıran koddan bağlanır.
  - Modül, onu yükleyen koddan bağlanır.
  - ADR, [`docs/STANDARTLAR.md`](STANDARTLAR.md) listesine eklenir.
- **İşi biten dosya aynı PR'da silinir:** yerini alan kodun eskisi, artık çağrılmayan modül ve testi, tek seferlik betik ve SQL, bayat plan. Git geçmişi yeter; arşiv dizini açılmaz.
- **Repoya girmez:** tek seferlik teşhis betikleri; iş kaydı, PBI ve yol haritası (`.ai-workspace/backlog/`, git dışı); oturum raporları.
- **Bekçi:** [`scripts/repo-hijyeni.cjs`](../scripts/repo-hijyeni.cjs). Testi `server/__tests__/repo-hijyeni.test.js`, K8 içinde CI'da koşar. Şunlar kırmızıdır:
  - hiçbir koddan, testten, yapılandırmadan ya da canlı belgeden ulaşılamayan belge ya da betik (birbirini anan iki bayat belge de dahil);
  - yalnız testlerin yüklediği modül.

  `CHANGELOG.md`'de anılmak kullanım sayılmaz.
- **Bekçi bir alt sınırdır:** yorumda anılıp kullanılmayan dosyayı yakalamaz; onaylayıcı bakar.

## Kurumsal Jenkins

Kurumsal iş tanımının kaynağı [`deploy/jenkins/DVL_JAVASCRIPT_GAR_BMW_PORTAL.groovy`](../deploy/jenkins/DVL_JAVASCRIPT_GAR_BMW_PORTAL.groovy).

- **Değişiklik sırası:** önce bu dosya değiştirilir, sonra kurumsal iş tanımı deposuna kopyalanır. E-posta yer tutucusu orada doldurulur; gerçek adres public repoya yazılmaz.
- **Tek giriş noktası (değişmez sözleşme):** groovy'nin `commands` listesi yalnız `install` ve `run kurumsal:derle` içerir. Derleme adımları `scripts/kurumsal-derle.cjs`'tedir: kur, kapsam, build, paket.
  - **Neden:** groovy her dala aynı anda uygulanır; kod ise dal dal ilerler. 2026-11-18'deki iş #46'da groovy, kurumsal dalda henüz bulunmayan `kapsam:kurumsal` betiğini çağırdı ve iş `npm error Missing script` ile düştü.
  - **Kural:** adım eklemek ya da değiştirmek groovy değişikliği gerektirmez; değişiklik bu betikte yapılır. Groovy'ye yeni bir `run …` eklenmez (bekçi KJ1 / KJ3).
  - **Kurumsal depo:** yeni sözleşmeyle ilk kez çalışacak dala önce güncel kod gönderilir.
- **Kurumsal aktarım (ZIP):** kurumsal dal main'in **birebir** kopyası olur. Kurumsal PC GitHub'a git ile erişemediği için kod main ZIP'iyle taşınır. Yöntem, kurumsal klonda, kurumsal dalda:
  1. `git pull`
  2. `git rm -r -q .`: izlenen bütün dosyalar silinir. Kopyalarken "üzerine yaz / atla" sorusu çıkmaz ve main'de silinmiş dosyalar geride kalmaz.
  3. GitHub'dan main ZIP'i indirilir; `PORTAL-BMW-main-main` klasörünün **içeriği** klonun köküne kopyalanır. ZIP, GitHub Actions'taki "Teslim imzası" ve "Kapsam raporu" işleri bittikten sonra indirilir.
  4. Kuruma gitmeyen dizinler silinir: `.github`, `.claude`, `.agent`, `sunum`, `server/ansible/playbooks`.
  5. `git add -A`. Node varsa `node scripts/teslim.cjs --dogrula` çalıştırılır; `BIREBIR` yazmalı.
  6. Commit (kurumun PBI biçimiyle), push, iş yeniden koşturulur.
  - **Neden:** 2026-11-18'deki iş #48'de dal, main'in yarım bir kopyasıydı. Aynı commit'te gelen iki dosyadan `scripts/kurumsal-derle.cjs` gelmiş, `package.json` satırı gelmemişti; iş `npm error Missing script` ile düştü. Var olan dosyaların üzerine kopyalama bu tür karışık ağaç üretir.
  - **Kuruma gitmeyenler:** liste tek yerde, [`scripts/teslim.cjs`](../scripts/teslim.cjs) `KURUMA_GITMEYEN`. Kurumsal derlemede kullanılmazlar ve kurumsal depoya gitmezler. İmza onları iki yönde de yok sayar: kopyalansalar da kopyalanmasalar da ilk adım geçer.
    - `.github/`, `.claude/`, `.agent/`: GitHub CI ve ajan talimatları (iş #50).
    - `sunum/`: tanıtım sunumu (iş #50).
    - `server/ansible/playbooks/`: Ansible playbook'ları; AWX aynası `bmw_portal/` ve tanı playbook'ları (iş #52). Portal bunları çalıştırmaz, AWX çalıştırır; AWX'e kopyalama [AWX-KOPYALAMA-HARITASI.md](AWX-KOPYALAMA-HARITASI.md). Kurumsal Sonar 14 hotspot'un 11'ini ve 6 Python bulgusunu burada buluyordu. Çalışma zamanı yalnız `server/ansible/playbook-revisions.json`'u okur; o bu dizinin dışındadır.
  - **Teslim imzası:** [`kalite/teslim.json`](../kalite/teslim.json), main'deki her izlenen dosyanın git blob sha'sı (`kalite/` ve kuruma gitmeyenler hariç). [`.github/workflows/teslim-imzasi.yml`](../.github/workflows/teslim-imzasi.yml) her main push'undan sonra tazeler; elle düzenlenmez. `kurumsal:derle`'nin ilk adımı ([`scripts/teslim.cjs`](../scripts/teslim.cjs) `--dogrula`) kodu bununla karşılaştırır. Fark varsa iş orada durur ve farkı dosya dosya söyler: içeriği farklı, eksik, fazla.
  - **Tazeleme penceresi:** main'e push'tan sonra yaklaşık bir dakika imza eskidir. O arada indirilen ZIP ilk adımda düşer; mesaj nedenini söyler, ZIP yeniden indirilir.
  - **Sınır:** `package.json`'ın kendisi eskiyse `kurumsal:derle` hiç çalışmaz (iş #48). Onu yalnız bu aktarım yöntemi önler.
- **Prova (K14):** [`scripts/kurumsal-prova.cjs`](../scripts/kurumsal-prova.cjs) kurumsal işi CI'da tekrarlar. Kurumsal klon gibi temiz bir git ağacında, groovy'deki Node sürümüyle:
  - imzayı yazar;
  - kuruma gitmeyen dizinleri ağaçtan ve indeksten siler (kurumsal depodaki ağaç);
  - `npm install` çalıştırır (kurumun `jf npm install`'ı);
  - groovy'nin geri kalan komutlarını aynen `npm <komut>` olarak koşturur;
  - `compress` dizininde çalışma zamanı paketinin eksiksiz olduğunu denetler;
  - paketin içinde `server/index.cjs`'in yüklediği her modülü yükler (Ansible'sız ağaçta eksik dosya burada düşer);
  - toplam süre 10 dakikayı geçerse kırmızı olur (kurumun sınırı 15 dakika).

  Kayıt defteri ve JFrog'un `.npmrc`'si gibi kurum ortamı farkları provada yoktur.
- **Ajan:** `tools` yalnız `nodejs` verilir. Kütüphane npm + yalnız nodejs için Linux ajanını (`POD&&NODEJS`) kendisi seçer; ajan elle verilmez. Araç verilmezse iş varsayılan ajana düşer ve derleme araçları kurulamaz (2026-11-18'e kadarki kırık iş).
- **Kurumsal Sonar (iş #49):** kütüphanenin `scanOnSonar` adımı `sonar.sources=.`, `sonar.tests=.`, `sonar.test.inclusions=**/*.test.js,**/*.test.tsx` ve kendi `sonar.exclusions` listesini komut satırından verir; `sonar-project.properties`'teki karşılıkları ezilir (diğer anahtarları, ör. CPD dışlaması, okunur).
  - **Sonuç:** test olarak yalnız `*.test.js` ve `*.test.tsx` sayılır. 2026-11-18'e kadar Node testleri `*.test.cjs` idi; 511 test dosyası üretim kodu sayıldı. Kapsam %50'ye indi, testlerdeki sahte parolalar güvenlik bulgusu oldu.
  - **Kural:** Node testleri `*.test.js`. Klasördeki `package.json` (`"type": "commonjs"`; `server/` ve Node testi olan `src/**/__tests__/`) onları CommonJS yapar. `npm test` eski adı (`.test.cjs`) görünce durur; bekçi KK11.
  - **Taklit (K15):** CI `sonar` işi, kurumun sınıflandırmasıyla ([`kalite/kurumsal-sonar.json`](../kalite/kurumsal-sonar.json), iş #49 logundan) ayrı bir projeye de tarar. Kapı K13 ile aynı ("Portal Katı"). Kurum yerel incelemelerimizi görmediği için K15 `kalite/sonar-inceleme.json` kayıtlarını uygulamaz ve inceleme bekleyen hotspot sayısını kendisi denetler: 0 değilse kırmızı (SonarQube `security_hotspots`'u kapı koşulu olarak kabul etmez). Kuruma gitmeyen dizinler kurumsal depoda olmadığı için taklitte de taranmaz (teslim listesinin aynısı). Kurumun göreceği kapsam ve bulgular merge'den önce görünür. Liste yalnız genel desenleri taşır (başka uygulamaların adları yazılmaz); bekçi KK12 dondurur.
  - **Kural profili (iş #52):** kurumun "GT way" profili dışa aktarılamıyor; bulgulardan türetilir. K15 her dilde "Portal Kurumsal" profilini `kurumsal-sonar.json` `profil`den her koşuda sıfırdan kurar: Sonar way'in bug / zafiyet / hotspot kuralları + kurumun bulgu verdiği kurallar, parametreleriyle (ör. S5843 eşiği 20, Python S107 en çok 7 parametre). Yerel sunucuda etkinleşemeyen kural K15'i durdurur. Aynı JS / TS kuralları commit anında ESLint'te ([`eslint.config.js`](../eslint.config.js) `KURUM_JS` / `KURUM_TS`); bekçi KK14 ikisini eşit tutar. Kurumsal taramada yeni bir kural bulgu verirse ikisine de eklenir.
  - **HTML:** kurumun HTML eklentisi yorumdaki `="`, `/>`, `</` gibi parçaları "yorumlanmış kod" sayar (iş #52, `index.html:12`). Bekçi KK13 aynı sezgiyi kuruma giden HTML'de uygular.
  - **Sınır:** taklit SonarQube Community ile koşar; kurumun Enterprise'a özgü JS güvenlik (taint) ve kurumsal sır analizi taklitte yoktur. PL/SQL ve Ansible çözümleyicileri ve `docker:S6505` de yoktur (`profil.yereldeYok`); Dockerfile'daki betiksiz kurulumu KK15 bekler.
  - **Kurum talebi:** `scanOnSonar`'ın `sonar-project.properties`'e uyması (`.ai-workspace/kurum-talep.md`). Gelse de ad kuralı kalır.
- **Kapsam:** (`kurumsal:derle` içinde) testler bu işte koşturulmaz; npm komutlarının hepsi tek bir 15 dakikalık zaman aşımı içinde. CI her main push'unda gerçek testlerle `kalite/kapsam/` raporunu üretir. `npm run kapsam:kurumsal` bu raporu, kurumsal Sonar adımının aradığı `coverage/lcov.info`'ya koyar.
  - Rapor kurumun kaynak saydığı her kod dosyasını taşır: `scripts/` ve `__tests__` yardımcıları dahil, test dosyaları (adından) ve kuruma gitmeyenler hariç (`scripts/kapsam-yayinla.cjs` `kaynakMi`). Tazeleme tetikleyicisi bu dosyaların hepsini izler; bekçi KP5.
  - Rapor kaynakla aynı değilse Sonar koşusunu düşürür; yanlış eşleşen kapsam yüklenmez.
  - Normal derlemede yalnız uyarır.
- **Paket:** `build/BMWPORTAL/PORTAL-BMW-main` altında üretilir. Kurumsal hattın çalışma alanında açtığı `.npm-cache/` ve `.jfrog/` git dışıdır (iş #52'de ağacı "kirli" gösteriyorlardı); ağaç yine kirliyse paket ilk 10 yolu loga yazar. Kütüphanenin Sonar adımı `build/**`'i taramaz; zip adımı çalışma alanı içinden okur. War'ın kökü `PORTAL-BMW-main/`, çünkü `deploy/release.sh` bunu bekler.
- **Adlar:** `BMWPORTAL.war` ve `BMWPORTAL-D`, uygulamanın SI/CMDB kaydındaki war ve deployment adlarıdır.
- **TST ve PRD:** [`TST_…`](../deploy/jenkins/TST_JAVASCRIPT_GAR_BMW_PORTAL.groovy) ve [`PRD_…`](../deploy/jenkins/PRD_JAVASCRIPT_GAR_BMW_PORTAL.groovy). Derleme, paket, war ve staging DVL ile birebir aynıdır (bekçi KJ4).
  - TST deployment adı `BMWPORTAL-T`. Kurumdaki `-D` / `-T` / `-Q` kalıbından türetildi; TST SI kaydıyla doğrulanmalı.
  - PRD'de deploy adımı yoktur. Üretim kurulumu staging'deki `BMWPORTAL.war`'dan ayrı süreçle yapılır.
- **Bekçi:** `server/__tests__/kurumsal-pipeline.test.js` (teslim imzası: `server/__tests__/teslim.test.js`). Şunları denetler:
  - Node sürümü izin listesinde ve Dockerfile ile aynı;
  - araç yalnız nodejs, elle ajan yok;
  - komut sırası ve betiklerin varlığı;
  - paketin yeri;
  - war ve deployment adları SI kaydıyla aynı;
  - gerçek e-posta adresi yok.

## Kancalar

`npm run kur` kurar; `--no-verify` ile atlamak **yasaktır**. Atlansa bile CI aynı kapıları yeniden koşturur ve `main` koruması kırmızı PR'ı birleştirtmez.

- `pre-commit`: değişen dosyalarda ESLint (0 uyarı), biçim çırığı, sır taraması (gitleaks kuruluysa o da), kurum iç adı (K17, eklenen satırlar).
- `commit-msg`: konu satırı 8–120 karakter (kuralın tek kaynağı `scripts/gecmis-denetim.cjs`; CI aynı kuralı K16'da `main`'e giden commit'lere uygular); mesajda sır ve kurum iç adı yok (K17). Türkçe serbest biçim geçerlidir.
- `pre-push`: `npm run kapi:hizli`.

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) her PR'da ve `main`'e her push'ta üç iş koşturur:

- `verify`: K0–K12, K16 ve K17. K16 commit → PR ilişkisini GitHub API'den okur; iş bunun için yalnız `pull-requests: read` izni alır. PR olayında yalnız PR commit'lerinin konu satırına bakar. Zorla push'ta (önceki uç yeni geçmişin atası değil) yalnız son commit denetlenir ve bu yazılır. İhlal push'u geri almaz; CI'ı kırmızı yapar ve iş özetine yazar (`main` koruması ayrı, aşağıda).
- `kurumsal`: K14. Node sürümü groovy'den okunur; aşağıdaki "Kurumsal Jenkins" bölümüne bakın.
- `sonar`: K13 ve K15. Taze bir SonarQube konteyneri açılır, kapı `kalite/esikler.json`'dan kurulur, kapsam raporu `verify` işinden gelir. K15 aynı kapıyla ikinci bir tarama yapar: kurumun sınıflandırmasıyla, ayrı projede (aşağıda "Kurumsal Sonar"). `verify` ve `kurumsal`'ı bekler; zorunlu kontrol olduğu için prova da fiilen zorunludur.

`scripts/kapi.cjs` içindeki liste ile CI adımlarının eşitliği testle kilitlidir. Hiçbir adım `continue-on-error` ya da `|| true` taşımaz.

## SonarQube ayrıntısı

- **Profil:** K13 Sonar way (JS/TS/Python), K15 "Portal Kurumsal" (yukarıda "Kurumsal Sonar"). **Kapı:** "Portal Katı"; koşulları `kalite/esikler.json` `sonar.kosullar` (kod kokusu mutlak: 0). Betik her koşuda kapıyı bu listeye eşitler.
- **Kopya (CPD) dışı:** yalnız bildirimsel veri dosyaları. Liste ve gerekçeleri `kalite/esikler.json` `sonar.cpdHaric`'tedir ve `sonar-project.properties` ile birebir aynıdır. Kod dosyası eklenmez.
- **Kapsam dışlaması (`sonar.coverage.exclusions`) ve sorun bastırma (`sonar.issue.ignore.*`) yoktur.** Bunları eklemek kırmızıdır.
- **Gerekçeli incelemeler** [`kalite/sonar-inceleme.json`](../kalite/sonar-inceleme.json)'da tutulur (yalnız K13; K15 uygulamaz). Eşleşme ölçütü kural + dosya + satır içeriğidir. Betik eşleşen bulguyu işaretler:
  - hotspot ise "Reviewed – Safe";
  - sunucu sürümü aynı kuralı sorun olarak açmışsa (26.x'te S5443 gibi) "Accepted".

  Kaydı olmayan bulgu açık kalır ve kapı kırmızı olur. Kayıt yalnız gerçekten güvenli olup kodda dürüst düzeltmesi olmayan bulgu içindir ve CODEOWNERS onayından geçer. Her kaydın dosyası ve içerik metni gerçekten var olmalıdır; bayat kayıt test tarafından reddedilir.
- **Tip bilgisi:** tarama geliştirme ağacı kurulu (`npm run kur`) yapılır. Tip denetimli kurallar (örn. bekletilmeyen promise, S9383) ancak böyle çalışır.
- **Yerelde:** Docker varsa `node scripts/sonar-kapi.cjs --docker` konteyneri kendi açar. Çalışan bir sunucu varsa `SONAR_HOST_URL` + `SONAR_TOKEN` (ya da `SONAR_ADMIN_PASSWORD`) verilir.
- **Kurumsal SonarQube'un kapısı ayrıdır ve daha gevşektir.** Bu kapı, kurumda kırmızı çıkmamanın yerel garantisidir.

## Onaylayıcı (PR inceleyen) kontrol listesi

Onay vermeden önce:

1. **CI'da `verify` ve `sonar` yeşil.** Ajanın ya da yazarın "geçti" demesi yetmez; CI çıktısına bakılır.
2. **Kapı gevşetilmedi.** Şu dosyalardan birine dokunan PR ayrıca gerekçelendirilir: `kalite/esikler.json`, `kalite/sonar-inceleme.json`, `sonar-project.properties`, `.github/workflows/`, `.husky/`, `scripts/kapi.cjs`, `scripts/sonar-kapi.cjs`, `server/__tests__/kalite-kapilari.test.js`.
3. **Yeni davranışın testi var.** Kaynak metni okuyan bekçi tek başına yetmez; davranış testi olmalı. Yeni bekçi için mutasyonla körlük denetimi yapılmış olmalı.
4. **Sır, iç ad, `.har` yok.** Repo public: kurum alan adı, sunucu adı, IP, kişi adı eklenmez.
5. **Arayüz değiştiyse** gerçek tarayıcıda bakılmış (`npm run ui:tarama`).
6. **Repo hijyeni.** Yeni dosya bir yerden bağlı; yerini alan ya da artık kullanılmayan dosya aynı PR'da silinmiş; tek seferlik betik, rapor ya da plan eklenmemiş.

## Yapay zekâ ajanları

Aynı kurallar ajanlar için de geçerlidir; Claude Code, Codex, Qoder, Antigravity ve Gemini fark etmez. Talimat dosyaları buraya işaret eder: [`AGENTS.md`](../AGENTS.md), [`CLAUDE.md`](../CLAUDE.md), [`GEMINI.md`](../GEMINI.md), [`.agent/rules/kalite-kapilari.md`](../.agent/rules/kalite-kapilari.md) ve proje ajanlarının tanımları (`.claude/agents/*.md`). Ajan teslimden önce `npm run kapi` koşturur ve sonucu sayılarıyla raporlar.

Ajan şunları **yapmaz**:

- tarayıcıdan gizlemek için dizgi bölmek (`['', 'tmp'].join('/')` gibi), kodu veri dosyasına taşımak;
- bastırma, dışlama ya da eşik değişikliği;
- testi zayıflatmak;
- `--no-verify`;
- kullanılmayan dosya bırakmak ya da tek seferlik betik, rapor, plan eklemek (repo hijyeni);
- başka bir ajanın çalıştığı dala yazmak (aynı dala aynı anda tek ajan; devralmadan önce o ajan durdurulur).

## Depo sahibi için: `main` koruması

Kapıları zorunlu kılan son halka budur. Yalnız depo yöneticisi açabilir; katkıcıların yazma yetkisi yetmez. Kural seti [`kalite/main-korumasi.json`](../kalite/main-korumasi.json)'dadır:

- PR zorunlu;
- 1 onay, CODEOWNERS onayı, yeni push eski onayı düşürür;
- `verify` ve `sonar` yeşil ve dal güncel;
- yorumlar çözülmüş;
- zorla push ve dal silme yasak.

```bash
gh api -X POST repos/onurdemir01/PORTAL-BMW-main/rulesets --input kalite/main-korumasi.json
```

**Kapsam raporu iş akışı** (`kapsam-raporu.yml`) `main`'e kendisi yazar. Koruma açıkken bunun için bir **deploy key** gerekir:

1. Yazma yetkili bir deploy key oluşturulur (Settings › Deploy keys).
2. Özel anahtarı `KAPSAM_DEPLOY_KEY` sırrına konur.
3. Kural seti deploy key'lere atlama izni verir (`bypass_actors`).

Sır tanımlı değilse iş akışı eskisi gibi `GITHUB_TOKEN` ile dener; koruma açıkken bu push reddedilir.
