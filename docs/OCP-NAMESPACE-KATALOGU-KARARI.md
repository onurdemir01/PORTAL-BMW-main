# OCP Namespace/Uygulama Kataloğu — Mimari Karar

> **Bu bir tartışmaya açık teknik tercih değil, Onur'un (proje sahibi) verdiği bir karardır.**
> LogX'in OpenShift bacağındaki `ocp_namespace_cache` / `ocp_app_cache` + kullanıcı-tetikli
> AWX keşif akışını (`ocp-cache.cjs`, `discoverNamespaces`/`discoverApps`) namespace/uygulama
> **kataloğunun birincil kaynağı** olmaktan çıkarıp yerine bağımsız, zamanlanmış bir Ansible
> job'ının beslediği tek bir tablo koyduk. Bu dosyayı değiştirmeden, ya da OpsX/LogX'in bu
> tabloyu okuma şeklini eski kullanıcı-tetikli mimariye geri döndürmeden önce **Onur ile
> konuşulması gerekir.**

## Ne değişti

- **Yeni kaynak:** `dbo.Openshift_Inventory (cluster, namespace, application, loaded_at)`.
  Bu tabloyu, **portaldan tamamen bağımsız**, AWX'te zamanlanmış bir Ansible job'ı
  (`openshift_inventory.yml` — `middleware_inventory.yml` ile aynı konvansiyonla, bu repo'nun
  **dışında** tutulur) günlük/periyodik olarak baştan yazar: her gerçek cluster'a bağlanır,
  `oc get deployments/rollouts/dc` ile tüm namespace'leri tarar, sonucu tabloya yükler.
- **Okuma ucu:** `server/logx/v2/ocp-inventory.cjs` — sadece SELECT yapar, **hiçbir AWX job'ı
  tetiklemez**. Hem OpsX (`server/opsx/index.cjs`) hem de LogX
  (`server/logx/v2/index.cjs` → `/ocp/inventory/namespaces`, `/ocp/inventory/apps`) bu tek
  modülden okur. Bu yüzden namespace/uygulama seçimi her zaman **anında** döner.
- **Ne kaldı:** `ocp-cache.cjs`, `ocp_namespace_cache`/`ocp_app_cache` tabloları,
  `discoverNamespaces`/`discoverApps` uçları ve `/ocp/cache/*` route'ları **silinmedi**.
  LogX sihirbazının "Yeniden tara" / "Bu namespace'i tara" butonları hâlâ bu canlı-keşif
  yolunu **fallback** olarak kullanır — envanterde henüz taranmamış yepyeni bir namespace
  için kaçış yolu. Ama artık **birincil** kaynak değiller.
- **Erişim kısıtlaması korunuyor:** `logx_v2_restrictions` / `restrictions.cjs` üzerinden
  namespace bazlı erişim kontrolü hem OpsX hem LogX'te aynı şekilde uygulanmaya devam
  ediyor — bu güvenlik katmanı bu kararla değişmedi, sadece verinin NEREDEN geldiği değişti.

## Neden

Aynı gece iki ayrı geliştirme kolu aynı sorunu (namespace/uygulama kataloğu) birbirinden
habersiz iki farklı mimariyle çözmüştü: biri kullanıcı-tetikli AWX keşif + paylaşımlı TTL
önbellek, diğeri (bu karar) portaldan bağımsız zamanlanmış toplu tarama. Onur, ikincisini
seçti: portalın kendi başına AWX job'ı tetiklememesi, tek bir okuma noktası olması ve
`middleware_inventory.yml` ile aynı, halihazırda kanıtlanmış deploy/izleme deseni izlemesi.

## Bu değişikliği yapmadan önce

`server/logx/v2/ocp-inventory.cjs`, `server/opsx/index.cjs`'teki
`namespacesForCluster`/`appsForNamespace`, `LogXWizardPage.tsx`'teki `loadNamespaceCache`
veya `AppNameStep.tsx`'in envanter okuma mantığını değiştirmeden — ya da bunları tekrar
`ocp-cache.cjs`'e bağlamadan önce **Onur ile iletişime geçin.**
