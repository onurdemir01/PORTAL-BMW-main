// shared/cryptoHubTenants.cjs — Crypto Hub kiracı kataloğu (2026-09-25).
//
// Kullanıcı: Metaco ve Wyden'i geliştirici + rezilyans ekipleri Portal'dan yönetsin; önce
// UYGULAMA → DOMAIN → ORTAM seçilsin, sonra o kiracının durumu ve sürümleri görünsün.
//
// BU DOSYA, Ansible tarafındaki bmw_automation_folder/crypto_hub/vars/tenants.yml ile AYNI
// olmak zorundadır. Ayrışırlarsa ekran bir ortamı gösterir, iş başka bir cluster'a bağlanır —
// yani en tehlikeli hata sınıfı. Bekçi (src/__tests__/crypto-hub-tenants.test.cjs) iki
// listeyi karşılaştırır; Ansible deposu bu makinede yoksa test o karşılaştırmayı ATLAR ama
// kataloğun kendi tutarlılığını yine de doğrular.
//
// ANKARA AYRI ORTAM (kullanıcı kararı): daocpankprod1 envanterde tanımlı değil, runbook'larda
// geçiyor; Hub'da "Production (Ankara)" olarak ayrı ortam görünür.
//
// WYDEN — AKTİF/PASİF CLUSTER ÇİFTLERİ (2026-09-25'te gelen 12 runbook'tan): her ortamın iki
// cluster'ı var (Pendik Hall2 / Hall3), production'da ayrıca Ankara. Aynı namespace her
// ikisinde de tanımlı, hangisinin ayakta olduğu göçlere göre değişiyor. Bu yüzden her cluster
// AYRI kiracıdır: ekran hangisinde replika koştuğunu TAHMİN ETMEZ, ÖLÇER.
//
// SÜRÜM KAYNAĞI İKİ TÜRLÜ: Metaco OCI deposundan (`chartRef` + skopeo), Wyden klasik Helm
// deposundan (`chartRepo`/`chartName` + `helm search repo`) okunur.
'use strict';

/**
 * @typedef {Object} CryptoTenant
 * @property {string} key          metaco_das_prod …
 * @property {string} app          metaco | wyden
 * @property {string} appLabel
 * @property {string} domain       das | gar
 * @property {string} domainLabel
 * @property {string} env          test | prod | prod_ank …
 * @property {string} envLabel
 * @property {boolean} production  prod ile başlayan her ortam
 * @property {string} bastion
 * @property {string} cluster
 * @property {string} apiUrl
 * @property {string} namespace    boş = yapılandırma eksik
 * @property {string} helmRelease  ana release (ekranda "koşan sürüm" bundan okunur)
 * @property {string} chartRef     OCI chart deposu (Metaco)
 * @property {string} chartRepo    klasik helm deposu alias'ı (Wyden)
 * @property {string} chartName    alias/chart (Wyden)
 */

const METACO_CHART = 'metaco.azurecr.io/helm-flat/harmonize';

/** @type {CryptoTenant[]} */
const CRYPTO_TENANTS = Object.freeze([
  {
    key: 'metaco_das_test', app: 'metaco', appLabel: 'Metaco',
    domain: 'das', domainLabel: 'DAS (Dijital Varlık)',
    env: 'test', envLabel: 'Non-Production', production: false,
    bastion: 'damtct01', cluster: 'daocptest1',
    apiUrl: 'https://api.daocptest1.fw.dijitalvarlik.com.tr:6443',
    namespace: 'harmonize-test', helmRelease: 'hmz',
    chartRef: METACO_CHART, chartRepo: '', chartName: '',
  },
  {
    key: 'metaco_das_prod', app: 'metaco', appLabel: 'Metaco',
    domain: 'das', domainLabel: 'DAS (Dijital Varlık)',
    env: 'prod', envLabel: 'Production', production: true,
    bastion: 'daaocp01', cluster: 'daocpprod1',
    apiUrl: 'https://api.daocpprod1.fw.dijitalvarlik.com.tr:6443',
    namespace: 'harmonize-prod', helmRelease: 'hmz',
    chartRef: METACO_CHART, chartRepo: '', chartName: '',
  },
  {
    key: 'metaco_das_prod_ank', app: 'metaco', appLabel: 'Metaco',
    domain: 'das', domainLabel: 'DAS (Dijital Varlık)',
    env: 'prod_ank', envLabel: 'Production (Ankara)', production: true,
    bastion: 'daaocp01', cluster: 'daocpankprod1',
    apiUrl: 'https://api.daocpankprod1.fw.dijitalvarlik.com.tr:6443',
    namespace: 'harmonize-prod', helmRelease: 'hmz',
    chartRef: METACO_CHART, chartRepo: '', chartName: '',
  },
  {
    key: 'metaco_gar_test', app: 'metaco', appLabel: 'Metaco',
    domain: 'gar', domainLabel: 'GAR (Banka)',
    env: 'test', envLabel: 'Non-Production', production: false,
    bastion: 'damtct01', cluster: 'gbocp3rdcwtest1',
    apiUrl: 'https://api.gbocp3rdcwtest1.fw.garanti.com.tr:6443',
    namespace: 'harmonize-test', helmRelease: 'hmz',
    chartRef: METACO_CHART, chartRepo: '', chartName: '',
  },
  {
    key: 'metaco_gar_prod', app: 'metaco', appLabel: 'Metaco',
    domain: 'gar', domainLabel: 'GAR (Banka)',
    env: 'prod', envLabel: 'Production', production: true,
    bastion: 'daaocp01', cluster: 'gbocp3rdcwprod1',
    apiUrl: 'https://api.gbocp3rdcwprod1.fw.garanti.com.tr:6443',
    // GAR PROD'DA RELEASE ADI FARKLI: runbook'ta `helm upgrade --install … hmzbank ./harmonize/`
    // ve tum deployment'lar `hmzbank-harmonize-*`. DAS tarafi ve testler `hmz`.
    namespace: 'harmonize-prod', helmRelease: 'hmzbank',
    chartRef: METACO_CHART, chartRepo: '', chartName: '',
  },

  // ── WYDEN ───────────────────────────────────────────────────────────────────────────
  // Ana release `wydenapp` (chart wyden/wyden). Aynı namespace'te `keycloak` ve
  // `wyden-vault-<ortam>` release'leri de var; tarama hepsini listeler, ekran koşan sürümü
  // ANA release'ten okur.
  {
    key: 'wyden_dev', app: 'wyden', appLabel: 'Wyden',
    domain: 'gar', domainLabel: 'GAR (Banka)',
    env: 'dev', envLabel: 'Development (Pendik Hall2)', production: false,
    bastion: 'gbaocp01', cluster: 'giocp3rdwytest1',
    apiUrl: 'https://api.giocp3rdwytest1.fw.gteknoloji.com.tr:6443',
    namespace: 'gih-das-trading-wyden-dev', helmRelease: 'wydenapp',
    chartRef: '', chartRepo: 'wyden', chartName: 'wyden/wyden',
  },
  {
    key: 'wyden_test', app: 'wyden', appLabel: 'Wyden',
    domain: 'gar', domainLabel: 'GAR (Banka)',
    env: 'test', envLabel: 'Test (Pendik Hall3)', production: false,
    bastion: 'gbaocp01', cluster: 'giocp3rdwytest2',
    apiUrl: 'https://api.giocp3rdwytest2.fw.gteknoloji.com.tr:6443',
    namespace: 'gih-das-trading-wyden-test', helmRelease: 'wydenapp',
    chartRef: '', chartRepo: 'wyden', chartName: 'wyden/wyden',
  },
  {
    key: 'wyden_qa_h2', app: 'wyden', appLabel: 'Wyden',
    domain: 'gar', domainLabel: 'GAR (Banka)',
    env: 'qa', envLabel: 'QA (Pendik Hall2)', production: false,
    bastion: 'gbaocp01', cluster: 'giocp3rdwytest1',
    apiUrl: 'https://api.giocp3rdwytest1.fw.gteknoloji.com.tr:6443',
    namespace: 'gih-das-trading-wyden-qa', helmRelease: 'wydenapp',
    chartRef: '', chartRepo: 'wyden', chartName: 'wyden/wyden',
  },
  {
    key: 'wyden_qa_h3', app: 'wyden', appLabel: 'Wyden',
    domain: 'gar', domainLabel: 'GAR (Banka)',
    env: 'qa_h3', envLabel: 'QA (Pendik Hall3)', production: false,
    bastion: 'gbaocp01', cluster: 'giocp3rdwytest2',
    apiUrl: 'https://api.giocp3rdwytest2.fw.gteknoloji.com.tr:6443',
    namespace: 'gih-das-trading-wyden-qa', helmRelease: 'wydenapp',
    chartRef: '', chartRepo: 'wyden', chartName: 'wyden/wyden',
  },
  {
    key: 'wyden_prod_h3', app: 'wyden', appLabel: 'Wyden',
    domain: 'gar', domainLabel: 'GAR (Banka)',
    env: 'prod', envLabel: 'Production (Pendik Hall3)', production: true,
    bastion: 'gbaocp01', cluster: 'giocp3rdwyprod2',
    apiUrl: 'https://api.giocp3rdwyprod2.fw.gteknoloji.com.tr:6443',
    namespace: 'gih-das-trading-wyden-prod', helmRelease: 'wydenapp',
    chartRef: '', chartRepo: 'wyden', chartName: 'wyden/wyden',
  },
  {
    key: 'wyden_prod_h2', app: 'wyden', appLabel: 'Wyden',
    domain: 'gar', domainLabel: 'GAR (Banka)',
    env: 'prod_h2', envLabel: 'Production (Pendik Hall2)', production: true,
    bastion: 'gbaocp01', cluster: 'giocp3rdwyprod1',
    apiUrl: 'https://api.giocp3rdwyprod1.fw.gteknoloji.com.tr:6443',
    namespace: 'gih-das-trading-wyden-prod', helmRelease: 'wydenapp',
    chartRef: '', chartRepo: 'wyden', chartName: 'wyden/wyden',
  },
  {
    key: 'wyden_prod_ank', app: 'wyden', appLabel: 'Wyden',
    domain: 'gar', domainLabel: 'GAR (Banka)',
    env: 'prod_ank', envLabel: 'Production (Ankara)', production: true,
    bastion: 'gbaocp01', cluster: 'giocpank3rdwyprod1',
    apiUrl: 'https://api.giocpank3rdwyprod1.fw.gteknoloji.com.tr:6443',
    namespace: 'gih-das-trading-wyden-prod', helmRelease: 'wydenapp',
    chartRef: '', chartRepo: 'wyden', chartName: 'wyden/wyden',
  },
]);

// PRODUCTION ŞİMDİLİK KAPALI (kullanıcı, 2026-09-26: "şimdilik Crypto Hub için Production'ı
// kapat"). Tek anahtar: `true` yapıldığında ekranda seçilebilir ve API yeniden açılır.
// Kapatma YALNIZCA ekranda gizlemek DEĞİL — sunucu da /overview ve /rescan'i reddeder, yoksa
// doğrudan API çağrısıyla production'a bakılabilirdi. Ansible tarafındaki karşılığı:
// crypto_hub_inventory.yml'deki `crypto_hub_include_production` (varsayılan false).
const PRODUCTION_ENABLED = false;

/** Kiracı şu an kullanıma açık mı? (production kapalıyken prod kiracıları kapalıdır) */
function isOpen(tenant) {
  return !!tenant && (PRODUCTION_ENABLED || !tenant.production);
}

const byKey = new Map(CRYPTO_TENANTS.map((t) => [t.key, t]));

/** Anahtardan kiracı; bilinmeyen anahtar null döner (istemciden gelen metin doğrudan kullanılmaz). */
function tenantOf(key) {
  return byKey.get(String(key || '').trim()) || null;
}

/** Ekranın seçim ağacı: uygulama → domain → ortam. Yapılandırması eksik olan da, şu an kapalı
 *  olan da GÖRÜNÜR (kullanıcı neden giremediğini anlasın); `ready`/`open` ile işaretlenir. */
function selectionTree() {
  const apps = [];
  for (const t of CRYPTO_TENANTS) {
    let app = apps.find((a) => a.app === t.app);
    if (!app) { app = { app: t.app, label: t.appLabel, domains: [] }; apps.push(app); }
    let dom = app.domains.find((d) => d.domain === t.domain);
    if (!dom) { dom = { domain: t.domain, label: t.domainLabel, envs: [] }; app.domains.push(dom); }
    dom.envs.push({
      key: t.key, env: t.env, label: t.envLabel, production: t.production,
      cluster: t.cluster, namespace: t.namespace, ready: !!t.namespace,
      open: isOpen(t),
    });
  }
  return apps;
}

module.exports = { CRYPTO_TENANTS, tenantOf, selectionTree, isOpen, PRODUCTION_ENABLED };
