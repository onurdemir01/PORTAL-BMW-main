// server/scalex/launch.cjs — extra_vars uretimi, patlama yaricapi ve degisiklik kapilari.
'use strict';

const adminData = require('../logx/v2/admin.cjs');
const ocp = require('../logx/v2/ocp.cjs');
const gates = require('../ansible/change-gates.cjs');

const ACTIONS = Object.freeze(['stop', 'restore', 'scale']);
const MODES = Object.freeze(['dry_run', 'apply']);
const VERIFICATION_TIMEOUTS = Object.freeze(['30', '60', '120']);

// Bir istekte izin verilen azami (cluster x uygulama) cifti. Ust sinir olmadan bir
// kullanici yuzlerce hedef gonderip tek isle cok genis bir kesinti yaratabilirdi.
const MAX_TARGETS = 200;

// Prod'da bu esigin ustundeki her calistirma YAZILI onay ister (kullanici namespace
// adini elle yazar). Isi ENGELLEMEZ — yalnizca "ne kadarina dokunuyorum" sorusunu
// kullanicinin onune koyar.
const PROD_WRITTEN_CONFIRM_THRESHOLD = 5;

const NS_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const APP_RE = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;

function isProdEnv(env) {
  return ['prod', 'production'].includes(String(env || '').trim().toLowerCase());
}

// SAF — dogrudan test edilir. Ekran bunu `/preview` uzerinden okur ve kullaniciya
// calistirmadan ONCE gosterir.
function computeBlastRadius({ clusters = [], apps = [], environment, action, executionMode }) {
  const clusterCount = clusters.length;
  const appCount = apps.length;
  const targets = clusterCount * appCount;
  const prod = isProdEnv(environment);
  // `dry_run` hicbir sey degistirmez; yazili onay istemek anlamsiz surtunme olurdu.
  const mutating = executionMode === 'apply';
  return {
    clusterCount, appCount, targets, isProd: prod, action,
    multiCluster: clusterCount > 1,
    requiresWrittenConfirm: mutating && prod && targets > PROD_WRITTEN_CONFIRM_THRESHOLD,
    // Prod + cok cluster = ikinci kisi onayi (kullanici karari). Playbook tarafindaki
    // `bulk_change_confirmation` bunun makine karsiligi.
    requiresSecondPerson: mutating && prod && clusterCount > 1,
    exceedsMaxTargets: targets > MAX_TARGETS,
  };
}

// Portal DB'sindeki cluster satirlarini playbook'un bekledigi katalog seklinde uretir.
// Alan eslemesi: tenant→platform, env→environments[], terminal_host→jump_server,
// api_url→api_url, vault_credential_key→credential.
//
// `ansible_host` BILEREK jump_server ile AYNI: portal tarafinda ikisi tek bir alanda
// (`terminal_host`) tutuluyor. Playbook `ansible_host | default(jump_server)` yaptigi
// icin ikisini de yazmak gereksiz — yalnizca `jump_server` gonderiliyor.
function buildScaleXClusterCatalog({ env, tenant, clusters, hosts, meta }) {
  const out = {};
  for (const name of clusters) {
    const m = meta[name] || {};
    const host = hosts[name];
    out[name] = {
      enabled: true,
      platform: tenant,
      environments: [env],
      jump_server: host,
      api_url: m.api_url,
      credential: m.vault_credential_key,
    };
  }
  return { version: 1, defaults: { tls_verify: false }, clusters: out };
}

function assertValidTargets({ namespace, apps, action, targetReplicas, executionMode, verificationTimeout }) {
  const bad = (msg) => { throw Object.assign(new Error(msg), { status: 400 }); };
  if (!ACTIONS.includes(action)) bad(`Geçersiz işlem: ${action}`);
  if (!MODES.includes(executionMode)) bad(`Geçersiz çalıştırma modu: ${executionMode}`);
  if (!VERIFICATION_TIMEOUTS.includes(String(verificationTimeout))) bad('Geçersiz sonuç kontrol süresi.');
  // Bu degerler `oc` komut satirina gidiyor — playbook ve kabuk tarafinda da ayni
  // dogrulama var; portal ISI HIC BASLATMADAN kesiyor.
  if (!namespace || namespace.length > 63 || !NS_RE.test(namespace)) bad(`Geçersiz namespace: ${namespace}`);
  if (!apps.length) bad('En az bir uygulama seçilmeli.');
  for (const a of apps) {
    if (a.length > 253 || !APP_RE.test(a)) bad(`Geçersiz uygulama adı: ${a}`);
  }
  if (action === 'scale') {
    if (!/^[0-9]+$/.test(String(targetReplicas ?? ''))) bad('Ölçekleme için hedef replica 0 veya daha büyük tam sayı olmalı.');
  }
}

async function buildRunExtraVars({
  env, tenant, clusters, namespace, apps, action, executionMode,
  targetReplicas, verificationTimeout, allowPartial, mailTo, mailCc, hpaPin = false,
}) {
  const hosts = await ocpResolveHosts(env, tenant, clusters);
  const meta = await adminData.resolveClusterMeta(env, tenant, clusters);
  // Vault anahtari katalogda yoksa is HIC BASLAMAZ — bu on kontrol LogX/Telnet'te de
  // ayni sekilde kullaniliyor ve bir uretim arizasindan sonra eklenmisti.
  await ocp.assertVaultKeysKnownOrThrow(meta);

  const radius = computeBlastRadius({ clusters, apps, environment: env, action, executionMode });

  return {
    // Katalog portal DB'sinden; playbook `scalex_clusters_override` yoksa kendi
    // dosyasina duser (AWX'ten elle calistirma bozulmaz).
    scalex_clusters_override: buildScaleXClusterCatalog({ env, tenant, clusters, hosts, meta }),
    execution_mode: executionMode,
    target_platform: tenant,
    target_environment: env,
    // Portal cluster'lari VERI olarak gonderiyor; AWX `limit`ine gerek yok (o alan
    // bu kurumda sessizce yutuluyordu). Tek cluster de coklu da ayni yoldan gider.
    cluster_selection_mode: clusters.length > 1 ? 'all' : 'single',
    target_cluster_name: clusters.length > 1 ? 'all' : clusters[0],
    scalex_target_clusters: clusters,
    target_namespace: namespace,
    target_app_names: apps.join(','),
    operation_action: action,
    ...(action === 'scale' ? { target_replicas: String(targetReplicas) } : {}),
    verification_timeout: String(verificationTimeout),
    allow_partial_execution: allowPartial ? 'true' : 'false',
    // ONAY KUTULARI SUNUCUDA URETILIR, client'tan GELMEZ. Kullanici ekranda
    // "anladim" derse portal bunu uretir; client'in dogrudan `change_confirmation: true`
    // gondermesi hicbir kapiyi acmaz.
    change_confirmation: executionMode === 'apply' ? 'true' : 'false',
    bulk_change_confirmation: radius.multiCluster && executionMode === 'apply' ? 'true' : 'false',
    // HPA SABITLEME — yalnizca kullanici EKRANDA acikca isaretlerse ve yalnizca
    // scale/restore icin. `stop`ta hic gonderilmez: replica 0'da HPA kendiliginden
    // devre disi kalir (ScalingActive=False), sabitlemeye gerek yok ve `minReplicas`
    // zaten 0 olamaz.
    ...(hpaPin && action !== 'stop' ? { hpa_pin: 'true' } : {}),
    mail_to: mailTo,
    ...(mailCc ? { mail_cc: mailCc } : {}),
  };
}

async function ocpResolveHosts(env, tenant, clusters) {
  const { hosts, missing } = await adminData.resolveTerminalHosts(env, tenant, clusters);
  if (missing.length) {
    throw Object.assign(
      new Error(
        `Şu cluster'lar için Jump Server tanımlı değil: ${missing.join(', ')} — ` +
        `Admin > LogX Yapılandırma ekranından cluster satırına Jump Server girin.`
      ),
      { status: 400 }
    );
  }
  return hosts;
}

// ScaleX'a ozel kapi kurallari. Ortak kapi modulu (`change-gates.cjs`) Self Service ile
// PAYLASILIR; burada yalnizca hangi durumda cagrilacagina karar veriliyor.
//
//   * `dry_run`  → HICBIR kapi. Hicbir sey degistirmiyor; kapi koymak, kullaniciyi
//                  guvenli yolu secmekten CAYDIRIRDI.
//   * `restore`  → SMART kaydi acilir, OCO UYARIR ama ENGELLEMEZ. Geri alma bir ONARIM
//                  islemidir; bir olay sirasinda OCO penceresi kapali diye sistemi
//                  ayaga kaldiramamak, kapinin cozdugu sorundan buyuk olur. Pencere
//                  disindaysa GEREKCE zorunlu ve gerekce hem kayda hem SMART'a gider.
//   * digerleri  → tam kapi (prod'da OCO + her apply'da SMART).
// HPA sabitleme yalnizca su kosullarda ANLAMLI ve GUVENLI:
//   * `stop` DEGIL — 0'da HPA zaten devre disi, ustelik minReplicas 0 olamaz
//   * hedef >= 1
// Ekran bu kurali uygular, sunucu da AYRICA uygular (client'a guvenilmez).
function isHpaPinAllowed({ action, targetReplicas }) {
  if (action === 'stop') return false;
  if (action === 'scale') return /^[0-9]+$/.test(String(targetReplicas ?? '')) && Number(targetReplicas) >= 1;
  return action === 'restore';   // hedef kayitli durumdan gelir, >= 1 varsayilir
}

function gatePolicyFor({ action, executionMode }) {
  if (executionMode !== 'apply') return { oco: 'skip', smart: 'skip', reason: 'dry_run hicbir sey degistirmez' };
  if (action === 'restore') return { oco: 'warn', smart: 'require', reason: 'geri alma bir onarim islemidir' };
  return { oco: 'require', smart: 'require', reason: null };
}

// `gateVars` TAMAMEN SUNUCUDA uretilir — client'tan hicbir anahtar kapiya girmez.
// Self Service'te bu ayrim bir guvenlik acigini kapatmisti (kullanici govdeye bir alan
// ekleyerek onayi atlatabiliyordu); ScaleX'ta client zaten hic extra_vars gondermiyor.
function buildGateVars({ env, tenant, action, executionMode, clusters, namespace }) {
  return {
    env, ortam: env, tenant, action, execution_mode: executionMode,
    cluster_count: String(clusters.length), namespace,
  };
}

module.exports = {
  ACTIONS, MODES, VERIFICATION_TIMEOUTS, MAX_TARGETS, PROD_WRITTEN_CONFIRM_THRESHOLD,
  isProdEnv, computeBlastRadius, isHpaPinAllowed, buildScaleXClusterCatalog, assertValidTargets,
  buildRunExtraVars, gatePolicyFor, buildGateVars, gates,
};
