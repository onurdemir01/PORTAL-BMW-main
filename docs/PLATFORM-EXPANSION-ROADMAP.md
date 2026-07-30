# Platform Genişletme Yol Haritası — Kurumsal Teknoloji Entegrasyonu

> Kapsam: Dynatrace/Instana'nın yanına Splunk/Kibana, orta-uzun vadede JBoss/Tomcat/Apache/
> Nginx/WebSphere/IHS derinliği, OpenShift/Kubernetes, CI/CD (Jenkins/Bitbucket), ArgoCD/GitOps
> ve paralelde kademeli UI modernizasyonu (Apple/OpenAI referanslı, paylaşılan tasarım sistemi).
> `docs/AI-INTEGRATION-ROADMAP.md` ve `docs/NETWORK-HARDENING-BACKLOG.md` ile aynı ruhla canlı
> tutulan bir belge — her sprint bitince buraya işlenir.

---

## ✅ Sprint 0 — Paylaşılan Tasarım Sistemi + Gruplu Navigasyon (TAMAMLANDI, 2026-07-11)

- Yeni bileşenler: `src/utils/statusColor.ts`, `src/components/common/{Badge,Card,Button,
  StatTile,EmptyState,SectionHeader}.tsx` — mevcut `.card`/`.btn-*`/`.badge` CSS class'larını
  tipli bileşenlere sarar, görsel sonuç korunur (tarayıcıda doğrulandı).
- `src/components/common/Tabs.tsx`'e `variant="pills"` eklendi; `DynatracePage.tsx`'in iki
  elle-yazılmış tab çubuğu (ana + Instana alt-tab) buna taşındı.
- `DynatracePage.tsx` genelinde tekrarlanan Badge/Card/Button/EmptyState/SectionHeader
  kullanımları yeni bileşenlere geçirildi (SeverityBadge kasıtlı olarak DOKUNULMADI — DT'nin
  6 farklı hue'lu enum'u genel statusColor paletiyle 1:1 örtüşmüyor, zorlamak sahte tutarlılık
  yaratırdı).
- `src/components/Sidebar.tsx`: düz 11 öğelik liste → gruplu mega-menu (Genel, Gözlemlenebilirlik,
  Operasyon, Otomasyon, AI Analist, Kaynaklar, Admin). Tek öğeli gruplar doğrudan link, çok
  öğeliler dropdown; mobilde accordion. `page-visibility` filtreleme mantığı DEĞİŞMEDİ.
- Doğrulama: `tsc --noEmit` + `npm run build` temiz; Playwright ile masaüstü dropdown, mobil
  accordion ve DynatracePage sekme geçişleri görsel olarak doğrulandı (ekran görüntüleri alındı).

## ✅ Sprint 1 — Splunk + Kibana (TAMAMLANDI, 2026-07-11)

- **Splunk** (`server/splunk/{client,index}.cjs`, `src/api/splunkApi.ts`,
  `SplunkTab` → `DynatracePage.tsx`'e 6. sekme): sabit SPL şablonu (`SPLUNK_PRODUCT_FIELD`
  env'den — alan KEŞFİ yok, kasıtlı basit başlangıç), TLS/proxy için `server/mcp/client.cjs`'in
  `buildDispatcher`'ı yeniden kullanıldı (yeni export edildi). KPI hesaplama (rps/latency/P95)
  bilinmeyen gerçek log formatına dayanacağı için bu sprintte YOK — ham event sayısı + örnek
  satırlar. `portal_splunk_search` AI tool'u yalnızca ürün+zaman aralığı kabul eder, serbest
  SPL YOK (Instana'daki "genel filtre, tool parametresi değil" temkinliliğiyle aynı sınıf).
- **Kibana**: Artım 1 (link kaydı, `important-links.json`) + Artım 2 (`server/kibana/*`,
  yalnızca `/api/kibana/health`) tamamlandı. Gerçek arama/dashboard entegrasyonu (Artım 3)
  kasıtlı olarak ERTELENDİ — canlı erişim teyit edilmeden inşa edilmedi. Bu sprintte ayrıca
  frontend'de ayrı bir Kibana sekmesi eklenmedi (yalnızca "yapılandırılmamış" gösterecek boş
  bir sekme UI karmaşası yaratırdı — plandan bilinçli küçük bir sapma, bkz. QUICK-SOLVER.md).
- **Güvenlik temizliği:** `server/data/performance-config.json` ve `performance-cache.json`
  (git'e işlenmiş, placeholder-secret'lı, hiçbir kod tarafından okunmuyordu) silindi;
  `.env.example`'a `SPLUNK_*`/`KIBANA_BASE_URL` bölümü eklendi (DT/Instana ile aynı desen).
- Doğrulama: `tsc`/`build` temiz; `/api/splunk/{health,products,search}` ve `/api/kibana/health`
  yapılandırılmamış ortamda zarifçe `configured:false` dönüyor (çökme yok); links listesinde
  Splunk/Kibana görünüyor; `grep` ile performance-config/cache kalıntısı kalmadığı doğrulandı.

## ✅ Sprint 2 — Middleware Derinliği: JVM Heap Durumu (TAMAMLANDI, 2026-07-11)

- `server/ansible/playbooks/jvm_heap_status.yml` (zaten vardı, salt-okunur jstat/jmap) artık
  portala bağlı: `AWX_JVM_HEAP_TEMPLATE_ID` env var + `portal_jvm_heap_status` AI tool
  (`server/ai-analyst/portal-tools.cjs`, jenerik `runReadOnlyAwxTemplate` yardımcısıyla —
  `fetchRawLogLines`'ın genel hali, mevcut test edilmiş fonksiyona dokunulmadı).
- LogX sayfasına (`LogXPage.tsx`) "JVM Heap Durumu" paneli eklendi — yalnızca seçili hostun
  `middleware_type` alanı JBoss/WildFly/EAP eşleşmesi varsa gösterilir (gereksiz UI karmaşası
  yaratmamak için koşullu). Yeni `POST /api/logx/jvm-heap-status` route'u `ansible-fetch`
  route'uyla birebir aynı launch+poll deseni.
- Doğrulama: `tsc`/`build` temiz; endpoint config'siz ortamda zarifçe 503/400 dönüyor.

## ✅ Sprint 3 — Container/Platform: OpenShift Pod Durumu (TAMAMLANDI, 2026-07-11)

- `server/ansible/ocp-clusters.json` şemasına `jumpHost` alanı eklendi (zaten `oc login`
  yapılmış bastion/jump host — `runner.cjs` CRUD + `AnsibleConfigTab.tsx` formu güncellendi).
- `AWX_OCP_POD_STATUS_TEMPLATE_ID` env var + `portal_ocp_pod_status` AI tool (cluster adı +
  opsiyonel namespace/label selector ile `ocp_pod_status.yml`'i tetikler).
- Admin > Ansible Config'teki her cluster kartına, `jumpHost` tanımlıysa, "Pod Durumu" butonu
  eklendi (`POST /api/ansible/clusters/:id/pod-status`) — anlık `oc get pods/nodes/clusteroperators`
  çıktısını gösterir.
- Doğrulama: `tsc`/`build` temiz; nonexistent cluster'da 404, jumpHost'suz cluster'da 400
  doğrulandı.

## Sprint 4 — Self-Service Katalog Doldurma (KOD DEĞİŞİKLİĞİ GEREKMİYOR — kullanıcı verisi bekliyor)

**Düzeltme:** Bu roadmap'in önceki sürümü `ansible-templates.json`'da "gerçek şablonlar zaten
var" diyordu — bu YANLIŞTI. O dosya (`server/ansible/store.cjs`) aslında serbest-metin bir
bilgi/not kütüphanesi (`content`/`goUrl` keyfi alanlar) — numaralı bir AWX template ID kavramı
hiç içermiyor; "OC SCALE DOWN"/"oc login" gibi görünüşte gerçek girdiler bile `content: "---"`,
`goUrl: "google.com.tr"` gibi placeholder veri. Self-service kataloğu (`ansible-ss-items.json`,
`{awxServerId, awxTemplateId}` şeması) gerçek, sayısal AWX job template ID'leri gerektirir —
bunlar yalnızca kullanıcının kendi AWX sunucusunda mevcuttur, bu ortamdan bilinemez/uydurulamaz.

**Karar (kullanıcıyla doğrulandı):** Gerekli admin arayüzü zaten TAM ÇALIŞIR durumda —
`SelfServiceAdminTab.tsx` / `SelfServicePage.tsx`'in admin formu (`ansibleApi.saveSsItem`) +
`.env`'deki `AWX_*_TEMPLATE_ID` değişkenleri (bu sprintte eklenenler dahil) zaten "gerçek ID'yi
siz girin" desenini takip ediyor. Kullanıcı bunu kurumsal ağdan kendi AWX erişimiyle dolduracak
— kod tarafında yapılacak bir şey yok, bu adım kapalı sayılabilir.

## ❌ Sprint 5 — CI/CD Görünürlüğü (Jenkins/Bitbucket) — REDDEDİLDİ (kullanıcı kararı, 2026-07-11)

Kullanıcı açıkça istemedi: "jenkins entegrasyonu olmasın", "bitbucket entegrasyonu olmasın".
Bu reponun kendi `Jenkinsfile`'ı (kendi build/deploy pipeline'ı) zaten var ve bu karardan
etkilenmiyor — reddedilen şey, Jenkins/Bitbucket'ı PORTALIN İZLEDİĞİ bir dış sistem olarak
entegre etmekti. Bu madde artık kapalı; ileride fikir değişirse yeniden açılabilir.

## ⏸️ Sprint 6 — ArgoCD/GitOps — ERTELENDİ (henüz ArgoCD yok, 2026-07-11)

Kullanıcının henüz bir ArgoCD kurulumu yok. Bu oturumda `mcp__argocd__*` araçları (Claude Code
ortam yeteneği, portal koduyla ilgisi yok) denendi — `ARGOCD_BASE_URL` tanımlı değildi, yani
bağlı bir sunucu yoktu. ArgoCD kurulduğunda bu madde yeniden değerlendirilebilir (Splunk/Kibana/
OCP ile aynı desen: `server/argocd/{client,index}.cjs` + health-check + kademeli genişletme).

---

## Genel durum (2026-07-11 itibarıyla)

Roadmap'teki tüm maddeler ya **tamamlandı** (Sprint 0-3) ya **kullanıcı kararıyla kapatıldı**
(Sprint 4: kod gerekmiyor, veri kullanıcıda; Sprint 5: reddedildi; Sprint 6: ön koşul yok).
Yeni bir teknoloji/entegrasyon talebi gelene kadar bu roadmap'te açık bir iş kalmadı.

## Sonraki UI adımları (Sprint 0'ın devamı, henüz başlanmadı)

- Sprint 0'da yalnızca `DynatracePage.tsx` migrate edildi (en yüksek tekrar yoğunluğu buradaydı).
  Dashboard/Ansible/LogX sayfaları fırsat buldukça aynı bileşenlere taşınabilir.
- Dark mode / tema anahtarı hâlâ yok — hiçbir sprintte "ucuz" görünmedi, talep gelirse ayrı
  bir sprint olarak ele alınmalı (mevcut CSS token yapısı buna hazır bir temel sağlıyor).
