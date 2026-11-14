// server/ansible/playbook-kullanim.cjs - Playbook Kayitlari: hangi anahtari Portal'in hangi
// ozelligi kullaniyor (2026-11-02).
//
// Admin bir kaydi silmeden once "Bu kaydi <ozellik> kullaniyor; silerseniz o ekran calismaz"
// uyarisini gorur (silme yine serbest). Liste STATIK: kod icindeki getByKey('...') / ..._KEY
// sabitleri / REGISTRY_KEYS tablolarindan elle cikarildi. Kaymasin diye bekci var:
// server/ansible/__tests__/playbook-kayit-silme.test.cjs (PK1) server/ altinda bir seed
// anahtarini adiyla anan her kod dosyasini tarar; burada karsiligi olmayan anahtar ya da
// seed'de olmayan fazla anahtar testi kirar.
//
// "AI Analist" satirlari: kodda anahtarla cagrilmazlar ama buildRegistryTools
// (server/ai-analyst/portal-tools.cjs) etkin + Template ID'li HER satiri sohbet aracina cevirir.
'use strict';

const AI = 'AI Analist (sohbet tanılama aracı)';

const KULLANIM = Object.freeze({
  jvm_heap_status: AI,
  network_connectivity_check: AI,
  disk_usage_status: AI,
  system_health_overview: AI,
  web_server_status: AI,
  service_status_check: AI,
  ocp_pod_status: 'LogX > OpenShift Pod Durumu ve AI Analist',
  logx_legacy_discovery: 'LogX (Legacy log keşfi)',
  logx_legacy_transfer: 'LogX (Legacy log aktarımı)',
  logx_ocp_namespace_discovery: 'LogX ve ScaleX (OpenShift namespace keşfi)',
  logx_ocp_app_discovery: 'LogX (OpenShift uygulama keşfi)',
  logx_ocp_discover_fetch: 'LogX (OpenShift log indirme)',
  opsx_legacy_operation: 'OpsX (Legacy JBoss işlemleri)',
  opsx_was_discover: 'OpsX (WAS keşfi)',
  opsx_was_operation: 'OpsX (WAS işlemleri)',
  opsx_openshift_operation: 'OpsX (OpenShift işlemleri) ve Crypto Hub',
  opsx_legacy_dump: 'OpsX (Legacy thread/heap dump)',
  opsx_openshift_dump: 'OpsX (OpenShift thread/heap dump)',
  opsx_openshift_pod_delete: 'OpsX (OpenShift pod silme)',
  opsx_openshift_pods: 'OpsX (OpenShift pod listesi)',
  opsx_legacy_jvm_discover: 'OpsX (Legacy JVM keşfi)',
  opsx_legacy_serverconfig_discover: 'OpsX (Legacy sunucu yapılandırma keşfi)',
  nginx_console_fetch: 'Nginx Hub > Konsol (yapılandırma okuma)',
  nginx_console_push: 'Nginx Hub > Konsol (yapılandırma gönderme)',
  nginx_orphan_cleanup: 'Nginx Hub > Konsol (sahipsiz yapılandırma temizliği)',
  nginx_config_audit: 'Nginx yapılandırma denetimi (taşıma ekranı)',
  nginx_cis_scan: 'Nginx CIS taraması',
  nginx_loadtest_run: 'Nginx Hub > Yük Testi',
  crypto_hub_ops: 'Crypto Hub',
  crypto_hub_inventory: 'Crypto Hub (envanter)',
  app_hub_ocp_canli: 'Application Hub (OpenShift canlı okuma)',
  server_hub_scan: 'Server Hub (tarama) ve App Retirement',
  server_hub_fix: 'Server Hub (düzeltme), App Retirement ve Application Hub (JVM parametresi)',
  reboot_check: 'BMW Hub > Reboot Kontrolü',
  server_hub_ear_envanter: 'Server Hub > Uygulama Envanteri',
  app_retirement_stop: 'BMW Hub > Retirement (durdurma)',
  app_retirement_delete: 'BMW Hub > Retirement (silme)',
  app_retirement_rollback: 'BMW Hub > Retirement (geri alma)',
  telnet_legacy_operation: 'Telnet (Legacy)',
  telnet_openshift_operation: 'Telnet (OpenShift)',
  scalex_run: 'ScaleX',
  scalex_discovery: 'ScaleX (keşif)',
  filex_list_files: 'FileX (dosya listeleme)',
});

// Anahtari kullanan ozelligin adi; Portal kodu kullanmiyorsa null.
function kullananOzellik(keyName) {
  const k = String(keyName || '');
  return Object.hasOwn(KULLANIM, k) ? KULLANIM[k] : null;
}

module.exports = { KULLANIM, kullananOzellik };
