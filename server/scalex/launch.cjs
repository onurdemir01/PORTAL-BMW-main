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
  return ['prod', 'production'].includes(
    String(env || '')
      .trim()
      .toLowerCase(),
  );
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
    clusterCount,
    appCount,
    targets,
    isProd: prod,
    action,
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

// KESIF de kullanici girdisini playbook'a tasir — DOGRULAMA ORTAK OLMALI.
//
// `/discover` uzun sure `assertValidTargets`i cagirmiyordu: yalnizca `/preview` ve
// `/run` doguluyordu. Oysa kesif de `target_namespace` / `target_app_names` degerlerini
// AWX uzerinden playbook'a, oradan `oc` komut satirina tasiyor. Yetki katmani bu bosluga
// engel DEGIL: kisitlama satiri yoksa varsayilan-ACIK gecer. Yani portalin tek savunma
// hatti buydu ve kesif yolunda YOKTU.
//
// Kesifte `apps` OPSIYONEL (namespace'i tarayip listeyi ogrenmek icin cagriliyor) —
// tek fark bu; format kurallari BIREBIR ayni ve tek yerden geliyor.
function assertValidDiscoveryTargets({ namespace, apps = [] }) {
  const bad = (msg) => {
    throw Object.assign(new Error(msg), { status: 400 });
  };
  if (!namespace || namespace.length > 63 || !NS_RE.test(namespace))
    bad(`Geçersiz namespace: ${namespace}`);
  for (const a of apps) {
    if (!a || a.length > 253 || !APP_RE.test(a)) bad(`Geçersiz uygulama adı: ${a}`);
  }
}

// CC adresleri kullanicidan gelir ve playbook'un mail gorevine ulasir. `.trim()` yalnizca
// BASTAKI/SONDAKI boslugu siler — gomulu `\r\n` aynen kalirdi ve bu, klasik SMTP BASLIK
// ENJEKSIYONU demek ("a@x.com\r\nBcc: disari@saldirgan.com"). `mail_to` guvende cunku
// oturumdan geliyor; acik yalnizca CC'deydi.
//
// Kurallar: satir sonu/kontrol karakteri KESIN yasak, adres formati zorunlu, en fazla
// 10 adres ve 320 karakter/adres (RFC 5321 sinirlari).
const MAIL_RE = /^[^\s@,;:<>"\\]+@[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/;
const MAX_CC = 10;

function sanitizeMailCc(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  const bad = (msg) => {
    throw Object.assign(new Error(msg), { status: 400 });
  };
  // Kontrol karakterlerini adres ayristirmasindan ONCE reddet: virgulle bolup her parcayi
  // ayri dogrulamak, `\r\n` tasiyan bir parcayi format hatasi olarak zaten yakalardi —
  // ama hatayi ACIKCA soylemek, kullanicinin kopyala-yapistir sirasinda ne oldugunu
  // anlamasini sagliyor.
  if (/[\r\n\t\0]/.test(value)) bad('CC adresinde satır sonu veya kontrol karakteri olamaz.');
  const parts = value
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (!parts.length) bad('CC adresi okunamadı.');
  if (parts.length > MAX_CC)
    bad(`En fazla ${MAX_CC} CC adresi verilebilir (${parts.length} girildi).`);
  for (const a of parts) {
    if (a.length > 320 || !MAIL_RE.test(a)) bad(`Geçersiz CC adresi: ${a}`);
  }
  return parts.join(',');
}

function assertValidTargets({
  namespace,
  apps,
  action,
  targetReplicas,
  executionMode,
  verificationTimeout,
}) {
  const bad = (msg) => {
    throw Object.assign(new Error(msg), { status: 400 });
  };
  if (!ACTIONS.includes(action)) bad(`Geçersiz işlem: ${action}`);
  if (!MODES.includes(executionMode)) bad(`Geçersiz çalıştırma modu: ${executionMode}`);
  if (!VERIFICATION_TIMEOUTS.includes(String(verificationTimeout)))
    bad('Geçersiz sonuç kontrol süresi.');
  // Bu degerler `oc` komut satirina gidiyor — playbook ve kabuk tarafinda da ayni
  // dogrulama var; portal ISI HIC BASLATMADAN kesiyor.
  if (!namespace || namespace.length > 63 || !NS_RE.test(namespace))
    bad(`Geçersiz namespace: ${namespace}`);
  if (!apps.length) bad('En az bir uygulama seçilmeli.');
  for (const a of apps) {
    if (a.length > 253 || !APP_RE.test(a)) bad(`Geçersiz uygulama adı: ${a}`);
  }
  if (action === 'scale') {
    if (!/^[0-9]+$/.test(String(targetReplicas ?? '')))
      bad('Ölçekleme için hedef replica 0 veya daha büyük tam sayı olmalı.');
  }
}

// UYGULAMA BASINA TIP HARITASI: "kafka=sts,odeme-api=deploy".
//
// NEDEN: playbook tipi `auto` ile tespit ediyordu ve ayni ad birden fazla tipte
// varsa (bir Deployment ile ayni adli bir DeploymentConfig) `ambiguous` deyip isi
// DUSURUYORDU — kullanicinin cikis yolu yoktu. Portal ise tipi kesifte ZATEN
// gormustu; tahmin ettirmek yerine soyluyoruz. Kullaniciya yeni bir adim eklenmez.
//
// YALNIZCA KESIFTEN GELEN satirlar gonderilir (ekran `source === 'discovery'`
// suzgecini uygular): aynadan turetilen sentetik satirlarda tip alani ESKI bir
// kayittan gelir ve bayat olabilir; bayat bir tiple islem yapmak yanlis nesneye
// dokunmak demektir. Haritaya girmeyen uygulamalar icin playbook bugunku `auto`
// taramasini yapar — davranis degismez.
const SCALABLE_KINDS = new Set(['deploy', 'sts', 'dc', 'rollout']);
const KIND_ALIASES = new Map([
  ['deployment', 'deploy'],
  ['deploy', 'deploy'],
  ['statefulset', 'sts'],
  ['sts', 'sts'],
  ['deploymentconfig', 'dc'],
  ['dc', 'dc'],
  ['argorollout', 'rollout'],
  ['rollout', 'rollout'],
]);

function buildWorkloadKindMap(entries, allowedApps) {
  if (!Array.isArray(entries) || !entries.length) return '';
  // ISTEMCIDEN GELEN VERI DOGRULANIR. Guvenlik siniri degil (playbook nesnenin
  // gercekten var oldugunu ayrica dogruluyor) ama bir yazim hatasi ya da bozuk
  // istemci yuzunden `oc` komut satirina cop girmesin: yalnizca BILINEN tipler ve
  // yalnizca bu istekte zaten dogrulanmis uygulama adlari haritaya girer.
  const allowed = new Set(allowedApps || []);
  const byApp = new Map();
  for (const e of entries) {
    const name = String(e?.name || '').trim();
    if (!allowed.has(name)) continue;
    const kind = KIND_ALIASES.get(
      String(e?.kind || '')
        .trim()
        .toLowerCase(),
    );
    if (!kind || !SCALABLE_KINDS.has(kind)) continue;
    // AYNI AD IKI TIPTE GELDIYSE HARITAYA HIC GIRMEZ. Birini secmek, kullanicinin
    // vermedigi bir karari onun adina vermek olurdu; playbook o uygulama icin
    // `ambiguous` diyerek DURUR ve bu DOGRU sonuctur.
    if (byApp.has(name) && byApp.get(name) !== kind) {
      byApp.set(name, null);
      continue;
    }
    if (!byApp.has(name)) byApp.set(name, kind);
  }
  return [...byApp.entries()]
    .filter(([, k]) => k)
    .map(([name, k]) => `${name}=${k}`)
    .join(',');
}

// CLUSTER BASINA TIP HARITASI: { "cluster1": "app=deploy,app2=sts", ... }.
//
// Ayni uygulama adi FARKLI cluster'larda FARKLI tipte olabilir (or. test
// cluster'inda Deployment, prod cluster'inda StatefulSet). Eski duz `workload_kinds`
// haritasi bunu tek bir `app=kind` ciftine indirgedigi icin bu durumda is
// `ambiguous` olarak dusuyordu. Yeni sozlesme cluster'a gore ayri haritalar gonderir;
// ayni cluster icinde ayni adi iki farkli tip hala belirsizdir (null) ve playbook
// o cluster icin `auto` taramasina duser.
function buildClusterWorkloadKindMap(entries, allowedApps) {
  // ISTEMCIDEN gelen veri DUZ DIZI de olabilir, cluster bazinda gruplu nesne de.
  // Her iki sekil normalize edilerek ayni givenlik/tip suzgecinden gecirilir.
  let flat = entries;
  if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
    flat = Object.entries(entries).flatMap(([cluster, arr]) =>
      Array.isArray(arr) ? arr.map((e) => ({ ...e, cluster })) : [],
    );
  }
  if (!Array.isArray(flat) || !flat.length) return {};
  const allowed = new Set(allowedApps || []);
  const byCluster = new Map();
  for (const e of flat) {
    const cluster = String(e?.cluster || '').trim();
    const name = String(e?.name || '').trim();
    if (!cluster || !allowed.has(name)) continue;
    const kind = KIND_ALIASES.get(
      String(e?.kind || '')
        .trim()
        .toLowerCase(),
    );
    if (!kind || !SCALABLE_KINDS.has(kind)) continue;
    if (!byCluster.has(cluster)) byCluster.set(cluster, new Map());
    const byApp = byCluster.get(cluster);
    if (byApp.has(name) && byApp.get(name) !== kind) {
      byApp.set(name, null);
      continue;
    }
    if (!byApp.has(name)) byApp.set(name, kind);
  }
  const out = {};
  for (const [cluster, byApp] of byCluster) {
    const pairs = [...byApp.entries()]
      .filter(([, k]) => k)
      .map(([name, k]) => `${name}=${k}`)
      .join(',');
    // Haritaya giren bir kayit olup da hepsi belirsiz ciktiysa cluster
    // acikca bos harita olarak doner; playbook bu cluster icin `auto`
    // taramasina duser. Hic gecerli kayit yoksa cluster hic yazilmaz.
    if (pairs || byApp.size > 0) out[cluster] = pairs;
  }
  return out;
}

async function buildRunExtraVars({
  env,
  tenant,
  clusters,
  namespace,
  apps,
  action,
  executionMode,
  targetReplicas,
  verificationTimeout,
  allowPartial,
  mailTo,
  mailCc,
  hpaPin = false,
  workloadKinds = null,
  clusterWorkloadKinds = null,
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
    // Bos string GONDERILMEZ: survey alani opsiyonel ve bos deger playbook'ta
    // `auto`ya duser — ayni sonuc, ama gereksiz bir extra_var is kaydini kirletirdi.
    ...((m) => (m ? { workload_kinds: m } : {}))(buildWorkloadKindMap(workloadKinds, apps)),
    // CLUSTER BASINA TIP HARITASI: ayni uygulama adi farkli cluster'larda farkli
    // tipte olabilir. Bos nesne GONDERILMEZ; eski istemciler icin `workload_kinds`
    // hala gecerli ve playbook o degeri kullanir.
    ...((m) => (m && Object.keys(m).length ? { cluster_workload_kinds: m } : {}))(
      buildClusterWorkloadKindMap(clusterWorkloadKinds, apps),
    ),
    operation_action: action,
    // SAYI OLARAK gonderilir, string DEGIL. AWX survey'inde bu soru `integer` tipinde
    // ve AWX tipi DOGRULUYOR: string gonderildiginde launch
    // `400: Value 2 for 'target_replicas' expected to be an integer.` ile REDDEDILIR —
    // yani `Olcekle` islemi hic calismiyordu (2026-09-01 uretim tespiti).
    // Playbook tarafi etkilenmez: `01_prepare.yml` degeri `| string | trim` ile
    // normalize edip regexle dogruluyor.
    ...(action === 'scale' ? { target_replicas: Number(targetReplicas) } : {}),
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
          `Admin > LogX Yapılandırma ekranından cluster satırına Jump Server girin.`,
      ),
      { status: 400 },
    );
  }
  return hosts;
}

// ScaleX'a ozel kapi kurallari. Ortak kapi modulu (`change-gates.cjs`) Self Service ile
// PAYLASILIR; burada yalnizca hangi durumda cagrilacagina karar veriliyor.
//
//   * `dry_run`  → HICBIR kapi. Hicbir sey degistirmiyor; kapi koymak, kullaniciyi
//                  guvenli yolu secmekten CAYDIRIRDI.
//   * PROD DISI  → HICBIR kapi. Kullanici karari (2026-09-01). OCO bir "planlanan
//                  kesinti penceresi" kaydidir ve yalnizca production icin acilir;
//                  test/dev'de OCO numarasi ISTEMEK, kullaniciyi var olmayan bir kaydi
//                  uydurmaya zorlamak demekti. SMART de ayni gerekceyle prod'a baglandi.
//                  Degisiklik IZI gevsemez: her calistirma ortamdan bagimsiz olarak
//                  audit'e ve `scalex_operations` tablosuna yazilir.
//   * `restore`  → SMART kaydi acilir, OCO UYARIR ama ENGELLEMEZ. Geri alma bir ONARIM
//                  islemidir; bir olay sirasinda OCO penceresi kapali diye sistemi
//                  ayaga kaldiramamak, kapinin cozdugu sorundan buyuk olur. Pencere
//                  disindaysa GEREKCE zorunlu ve gerekce hem kayda hem SMART'a gider.
//   * digerleri  → prod'da tam kapi (OCO + SMART).
// HPA sabitleme yalnizca su kosullarda ANLAMLI ve GUVENLI:
//   * `stop` DEGIL — 0'da HPA zaten devre disi, ustelik minReplicas 0 olamaz
//   * hedef >= 1
// Ekran bu kurali uygular, sunucu da AYRICA uygular (client'a guvenilmez).
// HPA SABITLEME NE ZAMAN SUNULABILIR?
//
// Sabitleme HPA'nin `minReplicas`/`maxReplicas` degerlerini hedefe esitler. Hedef 0 ise
// bu YAPILAMAZ: `HPAScaleToZero` ozellik kapisi kapaliyken (varsayilan) API
// `minReplicas: 0`i reddeder; acikken de uygulamayi 0'da SABITLER — yani "geri al"
// islemi hicbir seyi ayaga kaldirmaz.
//
// `restore` uzun sure KOSULSUZ izinliydi ve yorumu varsayimi itiraf ediyordu
// ("hedef >= 1 VARSAYILIR"). Varsayim yanlis: `previous_replicas = 0` BILEREK gecerli
// bir geri alma hedefi (bkz. result.cjs `restorable: prev !== null` ve A25 bekcisi) —
// zaten 0 replikadayken durdurulmus ya da once 0'a olceklenmis uygulamalar boyle.
//
// Portal `restore` hedefini kendisi BILMIYOR (deger cluster'daki ConfigMap'te). Bu
// yuzden kural: hedefler ACIKCA bildirilmediyse sabitleme SUNULMAZ. Bilgi yoklugu
// "izin ver"e degil "izin verme"ye cozunur. Bildirim client'tan gelir ama yalnizca
// KISITLAYICI yonde is gorur — uydurulmus bir liste en kotu ihtimalle eski davranisi
// verir, hicbir sey ACMAZ.
function isHpaPinAllowed({ action, targetReplicas, restoreTargets }) {
  if (action === 'stop') return false;
  if (action === 'scale')
    return /^[0-9]+$/.test(String(targetReplicas ?? '')) && Number(targetReplicas) >= 1;
  if (action !== 'restore') return false;
  if (!Array.isArray(restoreTargets) || restoreTargets.length === 0) return false;
  return restoreTargets.every((n) => Number.isInteger(Number(n)) && Number(n) >= 1);
}

// KAPI POLITIKASI — kurallarin gerekcesi icin yukaridaki blok.
//
// ORTAM BILINMIYORSA PROD SAYILIR. `environment` bos/tanimsiz geldiginde `isProdEnv`
// `false` donerdi ve kapilar SESSIZCE kapanirdi — yani yeni bir cagiran alani gecirmeyi
// unutursa prod korumasi kaybolurdu. Bilgi yoklugu "izin ver"e degil "kapiyi ac"a
// cozunur.
//
// SUNUCU DAVRANISI DEGISMIYOR, EKRAN GERCEKLE HIZALANIYOR: `change-gates.isOcoGateApplicable`
// zaten prod degilse kapiyi hic acmiyordu (prod-detect.cjs). Ama bu fonksiyon ortami
// gormedigi icin `/preview` test ortaminda da `oco: 'require'` donuyor, PreviewStep
// OCO numarasi isteyip "Calistir" butonunu kilitliyordu. Sunucu o numarayi HIC
// KULLANMIYORDU.
function gatePolicyFor({ action, executionMode, environment }) {
  if (executionMode !== 'apply')
    return { oco: 'skip', smart: 'skip', reason: 'dry_run hicbir sey degistirmez' };
  const envKnown = typeof environment === 'string' && environment.trim() !== '';
  if (envKnown && !isProdEnv(environment)) {
    return {
      oco: 'skip',
      smart: 'skip',
      reason: 'prod disi ortam — onay kapilari yalnizca production icin',
    };
  }
  if (action === 'restore')
    return { oco: 'warn', smart: 'require', reason: 'geri alma bir onarim islemidir' };
  return { oco: 'require', smart: 'require', reason: null };
}

// `gateVars` TAMAMEN SUNUCUDA uretilir — client'tan hicbir anahtar kapiya girmez.
// Self Service'te bu ayrim bir guvenlik acigini kapatmisti (kullanici govdeye bir alan
// ekleyerek onayi atlatabiliyordu); ScaleX'ta client zaten hic extra_vars gondermiyor.
function buildGateVars({ env, tenant, action, executionMode, clusters, namespace }) {
  return {
    env,
    ortam: env,
    tenant,
    action,
    execution_mode: executionMode,
    cluster_count: String(clusters.length),
    namespace,
  };
}

module.exports = {
  ACTIONS,
  MODES,
  VERIFICATION_TIMEOUTS,
  MAX_TARGETS,
  PROD_WRITTEN_CONFIRM_THRESHOLD,
  isProdEnv,
  computeBlastRadius,
  isHpaPinAllowed,
  buildScaleXClusterCatalog,
  assertValidTargets,
  assertValidDiscoveryTargets,
  sanitizeMailCc,
  buildRunExtraVars,
  buildWorkloadKindMap,
  buildClusterWorkloadKindMap,
  gatePolicyFor,
  buildGateVars,
  gates,
};
