> **ARSIV** — Calisma gunlugu; guncel kurulum/sorun giderme icin bkz. [../DEPLOYMENT.md](../DEPLOYMENT.md).

# Quick Solver — Karşılaşılan Problem / Çözüm Günlüğü

> Bu dosya, projede karşılaşılan her problemin çözümünü basit ve kısa şekilde kaydeder.
> Yeni bir problem çözüldükçe altına eklenir (en yeni en üstte). Amaç: aynı sorunla
> tekrar karşılaşıldığında hızlıca "bunu daha önce nasıl çözmüştük" diye bakılabilmesi.

---

## 2026-07-18 — Light/Dark tema (Faz 5): tüm ekranlar tek token diliyle adapte

**İhtiyaç:** Portal geneli light/dark tema + `ui/` dilinin tüm ekranlara yayılması. Tokenlar
light-only'di; tema toggle/ThemeContext yoktu; 35/65 bileşen ham Tailwind gri/beyaz kullanıyordu.

**Çözüm (token-tabanlı + uyumluluk katmanı — 35 dosyaya dokunmadan):**
- `index.html`: FOUC'suz senkron init script → `<html data-theme>` (localStorage `bmw-theme` > OS).
- `src/index.css`: `:root[data-theme="dark"]` altında TÜM semantik token'lar yeniden tanımlandı
  (bg/text/border/shadow/accent) → token-tabanlı yüzeyler (card/modal/input/btn) OTOMATİK adapte.
  Ayrıca **dark uyumluluk katmanı**: `[data-theme="dark"] .bg-white/.bg-gray-50/.text-gray-*/
  .border-gray-*` → token'lara `!important` eşlendi (specificity 0,2,0 > 0,1,0). Light modda ETKİSİZ.
  `bg-white/[opacity]` overlay'leri farklı class → dokunulmaz (doğru). skeleton/btn-danger token'landı.
- `src/contexts/ThemeContext.tsx`: `theme`/`toggleTheme`, data-theme + localStorage, OS değişimi
  dinleme (açık seçim yoksa). `index.tsx`'e ThemeProvider sarıldı. Sidebar'a güneş/ay toggle (masaüstü+mobil).

**Doğrulama:** tsc ✓, build ✓; Playwright ile login sayfası light (regresyonsuz) + dark (bg #0B1220,
kart/input'lar dark surface, metin okunur) görsel doğrulandı. Kalan 3 semantik alert banner
(amber/red tint) her iki modda okunur → bilinçli bırakıldı.

**Neden bu yaklaşım:** Tam per-bileşen dark audit (35 dosya) yerine token + uyumluluk katmanı;
"çalışanı bozma" (light modda sıfır değişiklik) + tek noktadan yönetilebilir tutarlı dark tema.

## 2026-07-18 — Çok-ortamlı (dev/test/qa/prod) script-tabanlı kurulum (nginx 443/80 → 8081/8543)

**İhtiyaç:** production ↔ dev/test/qa geçişlerine hazırlık. dev/test/qa aynı (nonprod) sunucuda,
prod ayrı sunucuda. zip→unzip→`npm i`→`npm run build`→tek script ile ortam başlatma (nohup, kolay kill).

**Çözüm:**
- `server/index.cjs`: env yükleme `APP_ENV` (veya ilk CLI argümanı) ile `.env.<APP_ENV>`'i ÖNCE
  yükler (otoriter), sonra `.env.local` → `.env` fallback. APP_ENV boşsa davranış birebir eski
  (geriye dönük). Boot log ortam+PORT yazar.
- `.env.dev/.test/.qa/.prod` (`.env.example`'dan türetildi; nonprod PORT=8081 paylaşımlı, prod=8543).
  `.env.example` 16 eksik anahtarla tamamlandı (SESSION_STORE, PORTAL_TRUSTED_HEADER_SECRET,
  LOGX_INGEST_*, PORTAL_DB_POOL_*, CORS_ORIGIN, API_RATE_LIMIT_PER_MIN...). `.gitignore`: `.env.*`
  (yalnız `.env.example` tracked). Şablonlarda `CORP_CA_CERT_PATH` boş → fresh install boot eder.
- `deploy/run.sh <dev|test|qa|prod> [start|stop|restart|status|logs]`: nohup + `logs/<env>.pid`/
  `.out`. nonprod mutual-exclusion (dev/test/qa 8081'i paylaşır → yeni ortam öncekini durdurur).
  bash 3.2 uyumlu (`set -uo pipefail`, `-e` YOK; same-line `local` bağımlılığı ayrıldı).
- `package.json`: `test:all`/`qa`/`prod`/`dev:serve` = `node server/index.cjs <env>`.
- `deploy/nginx-bmw-fe.conf`: `bmw.fe.garanti.com.tr`, 443 (TLS) + 80 (→301), upstream tek yerden
  8081/8543. SSE `proxy_buffering off`, büyük indirme `proxy_max_temp_file_size 0`, `X-Forwarded-Proto
  https`. LogX ikinci-origin YOK (v1 kalıntı). `docs/SETUP-SIMPLE.md` + `docs/MINDMAP.md` eklendi.

**Not:** Boot `CORP_CA_CERT_PATH bulunamadı` verirse → `.env.<env>`'de yol var ama dosya yok; yolu
düzeltin veya boş bırakın. Eski systemd yolu (`deploy/bmw-portal.service`) alternatif olarak korundu.

## 2026-07-18 — Legacy çoklu-host log indirme: sadece İLK/SON sunucu görünüyordu (5 sunuculu app'te 4'ü kayıp)

**Problem:** Bir uygulama birden çok sunucuda (ör. 5) çalıştığında LogX v2 Legacy keşfi UI'da
yalnızca tek bir sunucuyu ve onun dizinlerini gösteriyordu; diğer sunucular hiç sunulmuyordu.

**Kök neden (yalnızca PLAYBOOK):** `server/ansible/playbooks/logx_legacy_discovery.yml`
`strategy: free` ile çoklu host üzerinde koşuyor ve HER host tek tek `set_stats` ile
`logx_result.hosts: ["{{ host_result }}"]` (yalnızca kendisi) yayıyordu — `per_host: false` +
`aggregate: true` bir DICT üzerinde uygulandığında son host öncekini EZİYOR → birleşik artifact
tek host kalıyor. OCP'nin sorunsuz çalışmasının nedeni: OCP keşfi `set_stats`'i TEK terminal host
üzerinde çağırıp tüm cluster'ları orada topluyor (ezme yok). Backend (`legacy.cjs
finalizeDiscovery`) ve UI (`FileSelectionStep`) zaten çoklu-host'a hazırdı — sorun tamamen veri
katmanındaydı.

**Çözüm:** Keşif play'inde per-host `set_stats` kaldırıldı; her host `group_by: key=logx_discovered`
ile bir gruba eklendi. Ayrı bir `hosts: localhost, run_once: true` play tüm host'ların
`host_result` fact'ini `groups['logx_discovered'] | map('extract', hostvars, 'host_result')` ile
toplayıp `set_stats` (aggregate: false) ile TEK KEZ yayınlıyor. (`strategy: free` altında in-play
run_once güvenilmez olduğu için ayrı localhost play.) Tek-host durumunda da doğru (grup 1 host).
Ayrıca transfer playbook'undaki "tek kaynak host" assertion'ı kaldırılıp çoklu-host eklendi: her
host kendi loglarını paylaşımlı staging'de per-host ZIP'e yazar, run_once bir aggregator tüm
per-host ZIP'leri TEK `archive_name` ZIP'inde birleştirir → downstream (staged_path/filename/
size_bytes) sözleşmesi DEĞİŞMEZ. Tek-host yolu (dogrudan ZIP + fallback + A4 ingest) birebir korundu.
UI `FileSelectionStep` host-içi dizin gruplama + host/dizin toplu-seç ile genişletildi.

**Nasıl uygulanır:** Playbook'lar REFERANS — kullanıcı kendi deploy'una birebir yansıtır.
Çoklu-host transfer, tüm kaynak hostların aynı paylaşımlı `staging_dir`'i mount etmesini gerektirir.

## 2026-07-18 — Self-service Ansible canlı log artık akmıyordu (job çalışırken)

**Problem:** Self-service job çalışırken canlı log eskiden akıyordu, artık akmıyordu.

**Kök neden:** Canlı log SSE değil polling tabanlı (`ss/job-status` → AWX `/stdout/?format=txt`,
3sn). Poll döngüsü 5 ARDIŞIK hatada (ör. oturum yenilenirken tek bir geçici 401 — MemoryStore
proses-izolasyonu/secure-cookie kök nedeniyle) kalıcı olarak DURUYORDU → akış ölüyordu. Backend
tarafı doğruydu (koşan job için de stdout çekiliyor; IDOR sahiplik kontrolü `requireAuth` geçtiği
için sahip kullanıcıyı asla engellemiyor).

**Çözüm:** `SelfServicePage.tsx` polling'i sabit setInterval yerine kendini-zamanlayan uyarlanabilir
döngüye çevrildi: stdout akarken hızlı (~1.5sn), henüz çıktı yokken 3sn, terminal olunca durur.
Geçici hatada HEMEN pes etmez — artan gecikmeyle ~50sn (12 deneme) tekrar dener ve "Bağlantı
yenileniyor…" gösterir. Kalıcı çözüm için oturum kalıcılığı (SESSION_STORE=mssql + proxy
X-Forwarded-Proto) ayrıca uygulanmalı.

## 2026-07-18 — Modal tema tutarlılığı: ortak Modal + ui/Form dili yayıldı

**Problem:** Modallar tutarsız (raw `bg-white`/`border-gray`, native `<select>`, dekoratif Mac
trafik-ışığı çubuğu, İngilizce metin, mavi-600 butonlar) — mevcut tasarım tokenları/`ui/Form`
diliyle hizalı değildi.

**Çözüm:** Ortak `common/Modal.tsx` genişletildi (ikon+başlık+alt-metin+footer slotları, token
yüzey). Raw modallar yeniden yazıldı: `SelfServiceItemModal`, `SimpleNameModal`, `SessionTimeoutModal`
(→ Modal + ui/Form), `FieldOverridesModal` (Mac-bar kaldırıldı, token input'lar), AnsiblePage
modal yüzeyleri `bg-white`→`var(--bg-surface)`. Native `<select>`'ler form/modal bağlamında
`ui/Form` `Select`'e çevrildi; `Select`/`TextInput`/`Textarea`'ya `sizeVariant="sm"` eklendi
(kompakt admin formları için). **Sınır:** araç-çubuğu filtreleri ve tablo-hücresi select'leri
(modal değil, kompakt bağlam) native bırakıldı — form-boyutlu kontrol layout'u bozardı ("çalışanı
bozma").

## 2026-07-12 — Ansible Self-Service: AWX'in "prompt on launch" survey/limit/forks alanları hiç yüzeye çıkmıyordu

**Problem:** Bir AWX job template'i Self Service kataloğuna kaydedilirken, o template'in AWX'te
işaretlediği "prompt on launch" bayrakları (forks/job_tags/skip_tags/verbosity/job_type) ve
survey'in `survey_enabled` durumu hiç dikkate alınmıyordu — yalnızca `limit` her zaman
(bayrağa bakılmaksızın) gösteriliyor, geri kalanı (forks/tags/vs) hiç desteklenmiyordu.
Ayrıca survey'deki OPSİYONEL alanları admin'in kullanıcıya gösterip göstermeyeceğini seçtiği
bir arayüz yoktu — bu iş için backend'de `readCustom`/`writeCustom` + `/api/ansible/ss/custom/
:templateId` zaten VARDI ama hiçbir frontend bileşeni buna bağlı değildi (ölü/bağlanmamış kod).
Ayrıca override'lar yalnızca `templateId` ile anahtarlanıyordu — aynı ID awx1 VE awx2'de farklı
template'lere denk gelebileceği için bu bir çakışma riskiydi.

**Çözüm:** `server/ansible/runner.cjs`'e paylaşılan helper'lar eklendi: `mapSurveySpec` (iki ayrı
survey-mapping kod tekrarının yerini aldı, zorunlu alanların override ile gizlenmesini/required
değerinin değiştirilmesini engeller), `extractLaunchOptions` (tüm `ask_*_on_launch` bayraklarını
okur), `resolveLaunchExtraVars` (launch anında sunucu tarafında YENİDEN doğrular, gizli alanların
varsayılan değerini AÇIKÇA extra_vars'a enjekte eder — sessizce atlamaz), `buildAwxLaunchPayload`
(yalnızca AWX'in gerçekten izin verdiği ve değer sağlanmış built-in alanları payload'a ekler),
`friendlyAwxError` (AWX'in ham hata gövdesini anlaşılır mesaja çevirir). Overrides deposu
`${serverId}_${templateId}` composite key'e taşındı (eski `${templateId}.json` dosyalarına geriye
dönük okuma fallback'iyle). Frontend'de `SurveyModal` artık `survey_enabled`/`launchOptions`'a
göre alanları koşullu gösteriyor, zorunlu alan boşsa submit'i istemci tarafında da engelliyor;
yeni bir "Alanları Yönet" admin paneli (`FieldOverridesModal`) var olan-ama-bağlanmamış
customization API'lerini kullanıcı arayüzüne bağladı. **Ders:** Backend'de "var ama kullanılmıyor"
bir endpoint/store bulursan (`grep` ile sıfır frontend referansı), onu silmeden önce mutlaka
NEDEN yazıldığını anlamaya çalış — çoğu zaman eksik olan şey backend mantığı değil, ona bağlanacak
bir UI'dır.

---

## 2026-07-11 — Tüm "Yardım" modalları (ve potansiyel olarak her `position: fixed` modal) sayfa uzunluğuna göre kırpılıyor/kayıyordu

**Problem:** Dashboard + Envanter/LogX/Self Service/Performance/Nöbet sayfalarına eklenen "Yardım"
modalları bazen düzgün açılıyor, bazen ekranın üstünde/altında kırpılıyor ya da sayfa kaydırıldıkça
onunla birlikte kayıyordu — sabit (`position: fixed`) olmaları gerekirken viewport'a değil, sayfa
içeriğine göre konumlanıyorlardı.

**Kök neden:** `src/layouts/AppLayout.tsx`'teki her sayfayı saran `.page-enter` class'ı
`springIn` animasyonunu `animation-fill-mode: both` ile kullanıyordu ve `springIn`'in `100%`
karesi `transform: translateY(0) scale(1);` gibi kimlik-eşdeğeri ama `none` OLMAYAN bir değerdi.
CSS spesifikasyonuna göre `none` dışında herhangi bir `transform` değeri, o elemanı `position:
fixed` torunları için YENİ BİR CONTAINING BLOCK yapar — yani animasyon bittikten sonra bile
`.page-enter` kalıcı olarak modalların viewport yerine sayfa içeriğine göre konumlanmasına neden
oluyordu. Bu, LogX'in eski modalı da dahil `fixed inset-0` kullanan HER modalı etkileyen genel bir
altyapı hatasıydı, yeni eklenen kod değildi.

**Çözüm:** `src/styles/animations.css`'teki `springIn`/`countUp`/`slideUpSpring`/`rotateIn`/
`slideUp`/`slideInRight`/`slideInLeft`/`scaleIn`/`toastSlideIn` keyframe'lerinin "dinlenme"
durumundaki (`to`/`100%`) `transform` değerleri `transform: none;` olarak değiştirildi (görsel
olarak birebir aynı, ama artık containing-block yaratmıyor). Ayrıca `src/components/common/
HelpModal.tsx`, `ReactDOM.createPortal(..., document.body)` ile render edilecek şekilde
güncellendi — bu, ileride eklenecek herhangi bir animasyon/hover-transform'un modalı tekrar
kırmasına karşı ek bir güvence sağlıyor. **Ders:** `animation-fill-mode: both` kullanan HERHANGİ
bir keyframe'in son karesinde `transform` varsa, o elemanın `position: fixed` alt elemanlarını
sonsuza dek "hapsedebileceğini" unutma — kimlik-eşdeğeri bir transform (`translateY(0)`,
`scale(1)`, `rotate(0deg)`) ile gerçek `none` arasındaki fark CSS'te anlamlıdır.

---

## 2026-07-11 — Playbook Kayıtları doğrulanırken 404 aldım: yeni route değil, ölü (zombie) sunucu süreciymiş

**Problem:** Yeni eklenen `GET /api/ansible/playbooks/available` ve `POST /api/logx/playbook-run`
route'larını `curl` ile test ederken sürekli Express'in varsayılan "Cannot GET/POST" 404 sayfasını
aldım — sanki route hiç kayıtlı değilmiş gibi. Kodu (`runner.cjs`) satır satır okudum, route
tanımları doğru sırada ve doğru path'teydi; `node --check` de temizdi.

**Çözüm:** Önceki bir arka plan `node server/index.cjs &` komutu `kill`/`wait` düzgün
sonlanmadığı için portta (5055/5056) ESKİ bir süreç hâlâ dinliyordu (`lsof -i :5055` ile
görüldü, `ps aux | grep`). Yeni curl istekleri o eski sürece gidiyordu. `kill -9 <pid>` ile
temizleyip sunucuyu tekrar başlatınca her iki route da doğru şekilde 401/400 döndü. **Ders:**
Arka planda sunucu başlatıp test ederken, "route bulunamadı" gibi beklenmedik bir 404 görürsen
önce kodu şüphelenmeden önce `lsof -i :<port>` ile GERÇEKTEN hangi sürecin o portu dinlediğini
doğrula — özellikle art arda birden çok arka plan komutu çalıştırıldıysa. Ayrıntılı sistem
dokümantasyonu için bkz. [PLAYBOOK-REGISTRY.md](./PLAYBOOK-REGISTRY.md).

---

## 2026-07-11 — Roadmap yanlış varsayımı: "ansible-templates.json'da gerçek AWX ID'leri var"

**Problem:** İlk roadmap taslağında (bir Explore ajanının özetine dayanarak) `server/data/
ansible-templates.json`'da "OC SCALE DOWN", "oc login" gibi gerçek/kullanılabilir AWX template
kayıtları olduğu varsayıldı. Dosyayı bizzat okuyunca bunların da diğerleri (a/ad/asd/df/cds) gibi
placeholder olduğu ortaya çıktı (`content: "---"`, `goUrl: "google.com.tr"`). Bu dosya
(`server/ansible/store.cjs`) zaten serbest-metin bir not/bilgi kütüphanesi — self-service
kataloğunun (`ansible-ss-items.json`) ihtiyaç duyduğu SAYISAL `awxTemplateId` kavramını hiç
içermiyor.

**Çözüm:** Sahte/uydurma bir template ID ile self-service kataloğunu doldurmadım (yanlış ID =
gerçek AWX sunucusunda yanlış/tehlikeli bir şeyi tetikleyebilir). Kullanıcıyla doğrulandı:
gerekli admin arayüzü (`SelfServiceAdminTab.tsx`, `ansibleApi.saveSsItem`) zaten var ve
çalışıyor — kullanıcı gerçek AWX template ID'lerini kurumsal ağdan kendisi girecek. **Ders:**
Bir Explore ajanının "gerçek veri var" özetini, özellikle sonraki bir sprintin kod üretimi bu
veriye dayanacaksa, ilgili dosyayı bizzat okumadan roadmap'e/plana yazma.

---

## 2026-07-11 — Badge bileşeninde Tailwind v4 class-çakışma riski

**Problem:** Yeni `Badge` bileşeninde çağıran taraf hem varsayılan renk sınıflarının (statusColor'dan)
HEM DE kendi özel renk `className`'ini (ör. event-type etiketinin sabit indigo rengi) aynı anda
DOM'a yazıyordu. Tailwind v4 class'ları build-time'da statik tarıyor — runtime'da iki farklı
`bg-*`/`font-*` sınıfı aynı anda varsa hangisinin kazanacağı öngörülemez, çünkü hiçbiri "runtime
string birleştirme/replace" ile üretilmemiş olsa bile ikisi de DOM'da bulunuyor.

**Çözüm:** `Badge`, `level` prop'u verilmediğinde hiç renk sınıfı hesaplamıyor — çağıranın
`className`'i renklendirmeyi tam olarak devralıyor. Ayrıca `font-semibold`/`font-normal` için de
aynı sorunu önlemek üzere ayrı bir `weight` prop'u eklendi (className ile font-weight override
etmek yerine). bkz. `src/components/common/Badge.tsx`.

---

## 2026-07-11 — Sprint 1 planı: Kibana sekmesi eklenmedi (bilinçli sapma)

**Not:** Plan "Kibana için de yalnızca NotConfigured kartı göster" diyordu ama backend
health-check (`/api/kibana/health`) dışında bir frontend sekmesi eklemedim — Splunk sekmesiyle
birlikte DynatracePage'e 7. bir sekme daha eklemek, o sekme yalnızca "yapılandırılmamış" gösterip
başka hiçbir şey yapmayacağı için gereksiz UI karmaşası (kullanıcının "gereksiz göz yoran
yapılar olmamalı" isteğiyle çelişirdi). Kibana gerçek arama/dashboard entegrasyonu (Artım 3)
geldiğinde bir sekme eklemek daha anlamlı.

---

## 2026-07-11 — Instana sekmesi ham JSON dump gösteriyordu, Dynatrace'in gerisindeydi

**Problem:** İlk Instana entegrasyonunda (aynı gün, erken saatte) tool şemaları bilinmediği
için Issues/Events/Services için tek bir "Issues" sekmesi vardı ve her kayıt
`<pre>{JSON.stringify(it)}</pre>` ile ham basılıyordu — Dynatrace tarafındaki gibi kart görünümü,
ekip sahipliği, filtre çipleri yoktu.

**Çözüm:** Backend'e `enrichWithTeamOwnership` eklendi — tam alan adı bilinmediği için yaygın
aday anahtarlar (`host`, `hostName`, `entityName`, `label`, `name`, `serviceName`, `title`)
sırayla deneniyor, eşleşen kayıtlar `getTeamOwnership` ile (Dynatrace'teki AYNI fonksiyon)
zenginleştiriliyor. Frontend'de Issues/Events/Services alt-sekmeleri + jenerik "akıllı kart"
(başlık/durum tahmini + ekip rozeti + AI butonu + katlanabilir ham JSON) eklendi — bilgi
kaybı olmasın diye ham veri hâlâ "detay" ile erişilebilir. bkz. `server/instana/index.cjs`,
`src/components/dynatrace/DynatracePage.tsx` (`InstanaItemCard`).

---

## 2026-07-11 — Self Service Ansible launch endpoint allowlist'i atlıyordu

**Problem:** `POST /api/ansible/launch-ss/:serverId/:templateId` yalnızca giriş yapmış
olmayı (`requireAuth`) istiyordu; admin yetkisi ya da self-service'e kayıtlı
(`ansible-ss-items.json`) olma kontrolü YOKTU. Herhangi bir kullanıcı, UI'ı hiç
kullanmadan doğrudan bu endpoint'e istek atarak o AWX sunucusundaki herhangi bir
template'i (curated listede olmasa bile) tetikleyebilirdi.

**Çözüm:** Route'a, çağrılan (serverId, templateId) çiftinin `ansible-ss-items.json`'da
`enabled: true` olarak kayıtlı olup olmadığını kontrol eden bir adım eklendi; kayıtlı
değilse 403 dönüyor. bkz. `server/ansible/runner.cjs` — `/api/ansible/launch-ss/...` route'u.

---

## 2026-07-11 — LogX AI ve AI Analist (MCP AI) birbirini çağıramıyordu

**Problem:** LogX'in log analiz AI'ı (`ai-analyzer.cjs`) ve AI Analist'in Dynatrace/Instana
tool-use orkestratörü (`orchestrator.cjs`) tamamen ayrı çalışıyordu; aralarındaki tek
köprü, log raporunun düz metin olarak sohbete yapıştırılmasıydı (host/ortam bilgisi kaybolur,
DT/Instana korelasyonu otomatik tetiklenmezdi).

**Çözüm:** `portal_logx_analyze_log` adında yeni bir araç eklendi — orkestratör artık log
analiz motorunu doğrudan bir "tool" olarak çağırabiliyor. Ters yönde, LogX panelindeki
"sohbette derinleştir" butonu artık (biliniyorsa) host adını da taşıyor ve DT/Instana
korelasyonunu açıkça isteyen bir mesaj üretiyor. bkz. `server/ai-analyst/portal-tools.cjs`,
`src/components/ai_analyst/LogAnalysisPanel.tsx`.

---

## 2026-07-11 — Dynatrace/Instana REST katmanı host/tag/takım filtreleyemiyordu

**Problem:** `/api/dynatrace/*` ve `/api/instana/*` route'ları yalnızca env/status/zaman
aralığı gibi dar bir parametre seti kabul ediyordu; host, tag, management zone, ekip
sahipliği gibi filtreler UI'a hiç yansımıyordu.

**Çözüm:** Dynatrace tarafında `entitySelector` oluşturucusu tag/managementZone/host
klozlarını destekleyecek şekilde genişletildi; entity sonuçları artık `ekip_infos`
envanter tablosuyla (varsa) eşleştirilip `owningTeam` alanı dönüyor. Instana tarafında
tool şemaları repo'da bilinmediği için (canlı MCP sunucusundan geliyor) parametre
doğrudan tool çağrısına eklenmedi — bunun yerine dönen sonuç üzerinde jenerik bir
serbest-metin (`q`) filtresi uygulanıyor. bkz. `server/dynatrace/index.cjs`,
`server/instana/index.cjs`, `server/inventory/index.cjs` (`getTeamOwnership`).

---

## 2026-07-11 — Sohbet sırasında yanlışlıkla iki Instana API token'ı ekrana basıldı

**Problem:** `.env.local` içeriğini kontrol ederken kullanılan bir redaksiyon regex'i
(`(PASSWORD|SECRET|TOKEN|KEY)=...`) `INSTANA_API_TOKEN_NONPROD`/`_PROD` gibi TOKEN'dan
SONRA ek sonek içeren değişken adlarını yakalayamadı; iki token değeri konuşma
kaydına düz metin olarak geçti.

**Çözüm (ders):** `.env*` dosyalarının içeriğini asla toplu `cat`/`sed` ile ekrana
basma — tek tek anahtar adına göre `grep -c` (sadece anahtarın var/yok olduğunu say)
kullan, ya da yalnızca değer içermeyen satırları (yorumlar, path'ler) göster. Değer
kesinlikle görülmesi gerekiyorsa önce kullanıcıya sor.

---

## 2026-07-17 — `x-portal-role` header ile yetki-yükseltme backdoor'u kapatıldı (Faz 0)

**Problem:** `requireAuth` ve birçok modül (tasks, inventory, links, logx-v2, mcp,
ansible) session yoksa `x-portal-role` / `x-portal-user` HEADER'larına güveniyordu.
Session'sız herhangi bir istemci `x-portal-role: Admin` yollayıp admin işlemleri
yapabilirdi. Ayrıca `server/selfservice/index.cjs` mutasyon route'ları hiç guard'sızdı.

**Çözüm:** Header-tabanlı auth artık VARSAYILAN OLARAK KAPALI. Yalnızca
`PORTAL_TRUSTED_HEADER_SECRET` env değişkeni set edilmişse VE çağıran eşleşen
`x-portal-auth-secret` header'ını sunuyorsa header auth çalışır (yalnız iç servis-servis).
Tüm modüller header'ı doğrudan okumak yerine `auth/index.cjs`'in `getRequestUser` /
`getRequestRole` / tek `requireAdmin` yardımcılarını kullanıyor. Self-service mutasyonları
artık `requireAuth`+`requireAdmin` arkasında.

**Deployment notu:** LDAP/session ile giren gerçek kullanıcılar ETKİLENMEZ. Eğer bir iç
otomasyon `x-portal-*` header'larıyla API çağırıyorduysa, artık `.env.local`'a
`PORTAL_TRUSTED_HEADER_SECRET=<uzun-rastgele>` ekleyip her isteğe
`x-portal-auth-secret: <aynı-değer>` header'ını koymalı; aksi halde 401/403 alır.
bkz. `server/auth/index.cjs` (`trustedHeaderUser`, `getRequestUser`, `requireAdmin`).

---

## 2026-07-17 — Dinamik görünürlük motoru eklendi (Faz 1)

**Ne:** Sayfa/tab/buton bazında admin-kontrollü görünürlük için `portal_elements` +
`portal_element_visibility` tabloları ve `server/auth/visibility.cjs` motoru eklendi.
Çözünürlük: `enabled` kill-switch → Admin her zaman görür → user kuralı > role kuralı →
`default_visible`. `GET /api/auth/visibility` çözülmüş harita + `version` döner; admin
yazımı `bumpVersion()` ile versiyonu artırır (istemci poll'leyip reload'suz tazeler).
İlk kurulumda mevcut `page_visibility` satırları yeni modele taşınır (idempotent seed).

---

## 2026-07-17 — Görünürlük artık sunucu-tarafında GERÇEKTEN zorlanıyor (Faz 3)

**Ne:** Önceden sayfa gizleme kozmetikti (nav gizlenir + /403 route redirect) ama arkadaki
API her authenticated kullanıcıya cevap veriyordu. Artık her sayfa-modülü kendi element
anahtarıyla `requireVisiblePrefix(...)` arkasında — gizli sayfanın API'si **403** döner:
performance (dynatrace/instana/splunk→'Performance'), tasks→'Görevler', links→'Linkler',
inventory→'Envanter', logx v2→'LogX', ai-analyst→'AI Analist', selfservice→'Self Service',
duty-roster→'Nöbet'.

**Dashboard'u bozmamak için muafiyetler:** `/health` (probe), selfservice `/count` (KPI),
ve `/api/nobetci/*` (dashboard nöbetçi widget'ı) muaf tutuldu — tüm authenticated
kullanıcılara açık. Cross-page dashboard fetch'leri (tasks stats vb.) zaten frontend'de
`canViewPage(...)` ile korunuyor veya `.catch` ile zarifçe boşa düşüyor.

**Not (kapsam):** `/api/ansible/*` bilinçli olarak page-gate EDİLMEDİ — hem Ansible sayfası
hem Self Service tarafından paylaşılıyor (mutasyonları zaten requireAdmin). AI tool'larının
per-playbook görünürlüğe bağlanması Faz 4'e (playbook'ların element'e dönüşmesi) bırakıldı.
bkz. server/auth/visibility.cjs `requireVisiblePrefix`.

---

## 2026-07-17 — AI infra-tool'ları element görünürlüğüne bağlandı (Faz 4, güvenlik-hassas)

**Ne:** AI Analist'in playbook-registry'den türeyen altyapı araçları artık istek sahibi
kullanıcının `aitool:<keyName>` element görünürlüğüne bağlı — admin bir `aitool:<key>`
elementi ekleyip belirli kullanıcı/role kapatarak o AI aracını dinamik kısıtlayabilir
(element yoksa varsayılan açık, mevcut davranış korunur). Ayrıca `feature:ai_infra_launch`
kill-switch'i eklendi: kapatınca AI, Ansible job'ı BAŞLATAMAZ (Admin dahil). Bkz.
server/ai-analyst/portal-tools.cjs, ELEMENT_SEED (feature:ai_infra_launch).

**Faz 4 kalan (ertelendi — DB'li ortam gerektirir):** JSON depolarının (selfservice/links/
duty-roster/ocp-clusters) DB'ye taşınması ve AWX/MCP sunucularının DB-registry'si, bu
ortamda MSSQL olmadığı için güvenli şekilde uygulanıp DOĞRULANAMADI; ayrıca JSON stores
şu an DB-outage'ına dayanıklı — DB'ye taşımak bu dayanıklılığı azaltır. Bu iş, DB erişimi
olan bir oturumda + JSON fallback katmanıyla yapılmalı.

---

## 2026-07-17 — JSON config depoları DB'ye taşındı (Faz 4, DB-mirror + dosya-fallback)

**Ne:** links / selfservice / duty-roster / ocp-clusters JSON depoları artık portal DB'de
`portal_config_blobs` tablosunda (store başına tek JSON blob) KALICI olarak yansıtılıyor.
Desen (server/db/config-mirror.cjs): writeX() önce dosyaya yazar (sync, handler'lar
değişmedi), sonra `mirrorToDb()` ile DB'ye fire-and-forget yansıtır; startup'ta
`reconcileAllConfigBlobs()` — dosya yoksa DB'den geri yükler (redeploy kurtarma), DB boşsa
dosyadan seed eder (ilk JSON→DB göçü).

**Neden bu desen:** store'lar senkron ve bu ortamda MSSQL yok — handler'ları async'e çevirmek
yerine düşük-riskli mirror deseni seçildi. Sonuç: config DB'de merkezî+kalıcı (redeploy/dosya
kaybına dayanır) AMA DB-outage'da dosyayla çalışmaya devam eder (dayanıklılık korunur).

**Deliberately ertelendi (güvenlik incelemesi gerektirir):** AWX/MCP sunucularının DB-registry'si
— AWX credential'ları (token/parola) env'de tutuluyor; bunları DB'ye taşımak secret-in-DB
kararı gerektirir, kör uygulanmamalı. Nav/admin-tab öğeleri zaten portal_elements ile
görünürlük-kontrollü (Faz 2/3).

---

## 2026-07-17 — Modülerleştirme + SQL adaptör testleri (Faz 5)

**Testler:** `server/db/__tests__/adapter.test.cjs` — Postgres→MSSQL çeviri katmanı (adaptSql/
coerce) için 11 birim testi ($n→@pn, RETURNING→OUTPUT, boolean/ILIKE/NOW/LIMIT-OFFSET,
coerce). Denetimin işaret ettiği kırılgan, test-edilmemiş dikiş artık güvence altında.
Bilinen sınırlama (string içindeki $n) test ile BELGELENDİ. Toplam test: 37 (18 logx + 8
görünürlük/prefix + 11 adaptör).

**Ayrıştırmalar (god-module küçültme):** `server/admin/system-config.cjs` (env editör,
index.cjs'den) ve `server/ansible/ocp-store.cjs` (OCP cluster veri katmanı, runner.cjs'den)
kendi modüllerine taşındı — davranış birebir korundu, boot ile doğrulandı.

**Bilinçli ertelenen (verbatim taşıma, runtime doğrulanamaz):** index.cjs Nöbet grubu
(duty-roster + nöbetçi proxy: harici HTTPS/LDAP çağrıları) ve runner.cjs AWX HTTP/token/launch
çekirdeği (1585 sat.). Bu kod aktif dış entegrasyonlara bağlı ve bu ortamda AWX/nöbetçi
olmadan çalıştırılıp doğrulanamadığı için kör taşınması regresyon riski taşır — DB/AWX'li
bir ortamda yapılmalı.

---

## 2026-07-17 — Dashboard canlı görünürlük + self-service job logları + LogX playbook dayanıklılığı

**Dashboard izleri (Part 1):** Sayfa kapatılınca dashboard'da kalan öğeler `canViewPage` ile
gate'lendi: "DT Bağlı" rozeti + DT problem banner + DT problems fetch → `canViewPage("Performance")`;
"AI Analist'e Hızlı Soru Sor" çubuğu + "AI ile özetle" butonu → `canViewPage("AI Analist")`;
inventory count fetch → `canViewPage("Envanter")`. Canlılık: AuthContext 45sn versiyon-poll +
admin kaydından sonra anında `refreshVisibility()` (Faz 2). bkz. src/components/DashboardPage.tsx.

**Self-service job logları (Part 2):** Parse/erken hatada AWX `/stdout` BOŞ döner; hata
`result_traceback`/`job_explanation` alanlarındadır. `ss/job-status` artık bunları döndürüyor;
modal log önceliği stdout > traceback > explanation, fail'de hep bir şey gösterir (runner.cjs
ss/job-status, ansibleApi.ssJobStatus, SelfServicePage poll).

**LogX OCP playbook dayanıklılığı (Part 3):** `oc get projects/pods` `Forbidden: system:anonymous`
dönünce (bastion cluster'a oc login DEĞİL) `async_status` wait'i fail edip play'i abort ediyordu →
set_stats hiç çalışmıyordu. Fix: wait task'larına `ignore_errors: true` + namespace discovery'de
`block/rescue` — rescue yapılandırılmış `failed` artifact yayınlar. Kök neden INFRA (oc login/RBAC).
bkz. logx_ocp_namespace_discovery.yml, logx_ocp_discover_fetch.yml, LOGX-V2-PLAYBOOKS.md.

---

## 2026-07-18 — OCP namespace picker (ilerlemiyor + çirkin isimler) + indirme UX

**Namespace seçince ilerlemiyordu:** `LogXWizardPage` step türetmesinde `state ===
"namespaces_discovered"` iken adım DAİMA `ocp_namespace_picker` idi; `chosenNamespace` göz ardı
ediliyordu → seçim app_name adımına geçmiyordu. Fix: `namespaces_discovered` + chosenNamespace →
`ocp_app_name`.

**Namespace isimleri çirkin (`project.project.openshift.io/<ad>`):** `oc get projects -o name`
API-group önekli döner; playbook'un `regex_replace('^project/')`'i bu öneki sıyırmıyor. Portal
tarafında normalize edildi (playbook'a dokunmadan): `finalizeNamespaceDiscovery` namespace'leri
son `/`'ten sonrası olacak şekilde temizler + tekilleştirir; picker'da savunma amaçlı ikinci
temizleme + sistem namespace'lerini (openshift-*/kube-*) sona sıralama + sayaç. Bkz.
server/logx/v2/ocp.cjs (cleanNamespaceName/normalizeDiscoveryResult), NamespacePickerStep.tsx.

**İndirme (dosya inmiyor):** DownloadStep düz `<a href>` navigasyonuydu — hata olunca tarayıcıda
ham JSON açılıyordu. Artık `fetch(credentials:'include')` + blob indirme + NET hata mesajı
("arşiv portalda bulunamadı / staging mount"). Backend file-missing'de staged_path'i sunucu
log'una yazar (teşhis). **Kök neden çoğunlukla INFRA:** yeni legacy transfer playbook'u arşivi
KAYNAK host'ta staging'e yazıyor; o dizin portal sunucusuna AYNI NFS yolundan mount değilse
portal ZIP'i okuyamaz. staging_dir kaynak host'lar ile portal arasında paylaşılan mount olmalı.

---

## 2026-07-18 — Self-service job logları modalda + canlı animasyonlu terminal

**Log görünürlüğü:** Yeni ortak bileşen `AnsibleLogTerminal` (src/components/common/) — durum pili
(nabız), çalışırken soldan sağa tarama parıltısı (term-scan), satır sonunda yanıp sönen imleç,
yeni çıktı geldiğinde kenar flash'ı, otomatik en-alta kaydırma, satır sayısı, kopyala. Kullanıldığı
yerler: Self-Service çalıştırma modalı (jobOutput) + LogX v2 JobProgress ("Ansible çıktısını göster").
Self-service poll'u artık İLK isteği beklemeden atıyor (3sn boşluk yok).

**Geçmiş job logu (eksikti):** İş Geçmişi modalında bir job'a tıklayınca logu AYNI modalda
master-detail olarak açılıyor (ssJobStatus ile output/traceback çekilir). Önceden geçmişten log
görüntülemenin hiçbir yolu yoktu.

**Uçtan-uca bug taraması — bulundu ama BİLİNÇLİ ertelendi (düşük risk):** `GET /api/ansible/ss/
job-status/:serverId/:jobId` yalnız `requireAuth` — sahiplik doğrulaması YOK; bir kullanıcı
serverId+jobId tahmin ederek BAŞKASININ job stdout/traceback'ini okuyabilir (IDOR). İç portal +
tahmin gerektirir → düşük şiddet. Düzeltme ansible_job_history'e karşı sahiplik kontrolü ister ama
run-modal'ın launch-sonrası anlık poll'unu bozmamak için history-yazım zamanlaması kontrol edilmeli.

---

## 2026-07-18 — İndirme resolver (Sprint 1) + Vite proxy/HMR (Sprint 3)

**İndirme (arşiv portalda bulunamıyor):** `handleDownloadRoute` artık playbook'un bildirdiği
`staged_path`'e körü körüne bağlı değil. Yeni `resolveStagedFile({stagedPath, filename})` dosyayı
(1) staged_path, (2) portalın KENDİ staging köklerinde `basename(filename)` ile arar → paylaşılan
NFS'te mount yolu farklı olsa bile bulur. filename kripto-rastgele olduğundan basename-arama
güvenli (traversal yok; 5 birim testi — server/logx/v2/__tests__/downloads-resolver.test.cjs).
Bulunamazsa net 404 + sunucu log'unda aranan kökler. Dosya paylaşılan NFS'te DEĞİLSE hâlâ
bulunamaz (infra) — staging = portal ile paylaşılan NFS mount olmalı (bkz. LOGX-V2-PLAYBOOKS.md).

**Vite/HMR ters-proxy (wss bağlanamıyor):** `vite.config.ts`'e env-parametreli `server.hmr`
(host/protocol/clientPort) + `allowedHosts` + `origin` eklendi. `.env.local`'da `VITE_HMR_HOST`,
`VITE_HMR_PROTOCOL=wss`, `VITE_HMR_CLIENT_PORT=443`, `VITE_ALLOWED_HOSTS` set edilince proxy
arkasında HMR bağlanır; set edilmezse localhost varsayılanı bozulmaz. Prod'da dev sunucusu
kullanılmaz — `NODE_ENV=production` ile `dist/` statik servis edilir (zaten var). bkz. DEPLOYMENT.md.

---

## 2026-07-18 — DB-persistence doğrulama testleri + indirme audit (Sprint 2)

`server/logx/v2/__tests__/persistence.test.cjs` — db.query mock'lanarak DB yazımları doğrulanır
(gerçek MSSQL gerekmez): issueDownloadToken→logx_v2_downloads INSERT (token/filename/staged_path/
size; bozuk size→NULL), updateRequest→state geçişi, finalizeNamespaceDiscovery→normalize+persist,
cancelJob→canceled UPDATE (+ idempotent terminal). Toplam 49 test. Ayrıca indirme TÜKETİMİ artık
hash-zincirli audit'e yazılıyor (`action=v2_download`, result ok/not_found) — kim neyi indirdi izlenir.

---

## 2026-07-18 — Redis'siz ölçek sertleştirme (Sprint 4) + hafif metrik (Sprint 5)

**Session:** opt-in MSSQL session store (`SESSION_STORE=mssql`, `portal_sessions` tablosu,
harici servis yok) — restart'ta logout olmaz, bellek şişmesi kalkar; boşsa MemoryStore
(geri-alınabilir). `server/auth/mssql-session-store.cjs` (+5 birim testi).
**Rate limit:** IP yerine session(kullanıcı) bazlı (`connect.sid` cookie) → kurumsal NAT
yanlış-ban'ı biter; IPv6-güvenli `ipKeyGenerator` fallback (`API_RATE_LIMIT_PER_MIN`).
**Pool/index:** portal DB pool max 10→25/min 2 (env); logx_audit/downloads/jobs/requests
index'leri (idempotent). **Code-splitting:** ağır sayfalar `React.lazy` → ana bundle ~1.4MB→635KB.
**Metrik:** `GET /api/metrics-lite` (admin) — istek/hata/latency p50-p95-p99, event-loop lag,
bellek, portal DB havuz doluluğu; bağımlılık yok (`server/metrics.cjs`).
**Ertelendi:** photoUrl'ü session'dan çıkarma (frontend coupling), 1000-kullanıcı yük testi
(canlı DB gerekir), yatay ölçek → Hazelcast fazı. Toplam test: 54.

---

## 2026-07-18 — A4 fetch-back: kaynak host NFS'e erişemezse arşivi portal'a push

Log-kaynak host paylaşılan NFS'e yazamadığında indirme çalışmıyordu (resolver dosyayı bulamaz).
Çözüm: token-auth'lu **ingest (upload) endpoint** — `POST /api/logx/v2/ingest/:token` (requireAuth
DIŞINDA; auth = tek-kullanımlık, TTL'li kripto token). Portal her transfer job'ına `ingest_url`
extra_var'ı verir (legacy.transfer + ocp.discoverFetch → issueIngestToken). Playbook NFS
başarısızsa `curl --data-binary @arşiv -H "Content-Type: application/octet-stream" <ingest_url>`
ile yükler; portal STREAMING olarak (bellekte buffer'lamadan) `LOGX_STAGING_FALLBACK_DIR`'e yazar,
token'ı tüketilmiş işaretler; download resolver fallback dizininden okur. Tablo: `logx_v2_ingest`
(token/request_id/filename/fallback_dir/consumed/expires). Env: `LOGX_INGEST_BASE_URL`,
`LOGX_INGEST_TTL_MINUTES`, `LOGX_INGEST_MAX_BYTES` (200MB). Cleanup job süresi dolanları siler.
5 birim testi (toplam 59). bkz. server/logx/v2/ingest.cjs, DEPLOYMENT/LOGX-V2-PLAYBOOKS.md.

---

## 2026-07-18 — Kararlılık paketi: oturum/401, admin 500→409, job history, UI reference (Faz 0-5)

**401→403 cascade:** `GET /api/auth/session-debug` teşhis ucu eklendi (MemoryStore proses-izole /
secure-cookie). Frontend `visibilityReady` bayrağı: görünürlük SUNUCUDAN yüklenmeden gated fetch
(tasks/stats vb.) atılmıyor → geçici 401'de 403 cascade yok. Kalıcı çözüm: `SESSION_STORE=mssql`
(hazır) + prod ters-proxy `X-Forwarded-Proto: https` (DEPLOYMENT.md).

**İndirme 500 (Vite HTML) + HMR:** kök = dev'i ters-proxy arkasında çalıştırmak. Çözüm: gerçek
kullanım PROD modda (`npm run start`, Vite yok, tek Node stream eder). Dev için VITE_HMR_* + WS
upgrade (DEPLOYMENT.md).

**Admin "OCP cluster ekle" 500:** `UNIQUE(env,tenant,cluster_name)` duplicate → yakalanmamış hata.
`admin.cjs` create* fonksiyonları unique ihlalini (MSSQL 2627/2601) yakalayıp **409 dostça mesaj**
döndürüyor (3 test).

**Job history "hep pending":** `ansible_job_history.status` yalnız launch'ta yazılıyordu; `ss/job-status`
artık canlı status terminal ise geçmiş satırını UPDATE ediyor. History detay rozeti CANLI status
gösteriyor; koşan job'ta "henüz çıktı yok" vs eskimiş job'ta "bulunamadı" ayrımı.

**UI reference (Faz 5):** `src/components/ui/Form.tsx` (Field/TextInput/Textarea/Select — TEK form
dili, native <select> yerine stillendirilmiş, satır-içi hata + aria). Self-Service "İş Başlat" modalı
referans ekran olarak yeniden: temiz başlık (Mac-bar kaldırıldı), gruplu alanlar, **alan-bazlı canlı
doğrulama** (zorunlu/sayısal/choices), geçersizken sebepli disabled. Kalan: light/dark tema + diğer
ekranlara yayılım (5.1/5.4). Toplam test: 62.

---

## 2026-07-18 — ss/job-status IDOR kapatıldı + geçmiş yazımı await

`GET /api/ansible/ss/job-status/:serverId/:jobId` yalnız requireAuth idi → serverId+jobId tahmin
edip BAŞKASININ job stdout/traceback'ini okumak mümkündü. Fix: `ansible_job_history` INSERT artık
`res.json`'dan ÖNCE await ediliyor (ilk poll'da satır hazır + Faz 4 finalize güvenilir); job-status
kayıtlı ve BAŞKA kullanıcıya ait ise (admin değilse) 403. Kayıt yok/DB hatası → fail-open (meşru
polling bozulmaz). Toplam test: 62.
