// server/scalex/launch.cjs — extra_vars uretimi, patlama yaricapi ve degisiklik kapilari.
'use strict';

const adminData = require('../logx/v2/admin.cjs');
const ocp = require('../logx/v2/ocp.cjs');
const gates = require('../ansible/change-gates.cjs');
const config = require('./config.cjs');

const ACTIONS = Object.freeze(['stop', 'restore', 'scale']);
const MODES = Object.freeze(['dry_run', 'apply']);
// DOGRULAMA BUTCESI — SANIYE.
//
// Eskiden uc onayarli deger vardi ('30','60','120') ve varsayilan 60 sn idi.
// Kullanici karari (2026-09-17): varsayilan HER YERDE 5 dakika, ekstra isteyen
// SANIYE cinsinden girsin.
//
// Butce ACMA ve KAPATMA'da FARKLI anlamlara gelir (bkz. scalex_runner.sh
// verify_replicas): acmada "bu kadar bekle, sonra uyarip basarili bit",
// kapatmada "bu kadar sonra uyar, iki kati sonra fail".
// ── BU DORT DEGER ARTIK SABIT DEGIL: ADMIN EKRANINDAN GELIYOR ──────────────
//
// Kullanici istegi (2026-09-17): "timeout vb yapilari da admin ekranindan
// verebilecek ve bu degiskenleri de degistirince dinamik calisacak".
//
// `server/scalex/config.cjs` her cagrida `process.env`i YENIDEN okur; Admin >
// Sistem ekranindan yazilan deger `setEnvOverride` ile ayni anda `process.env`e
// islendigi icin SONRAKI ISTEK yeni degerle calisir — RESTART GEREKMEZ.
//
// ASAGIDAKI GETTER'LAR FONKSIYON, SABIT DEGIL. Modul duzeyinde
// `const X = tunable(...)` yazmak dinamikligi SESSIZCE oldururdu: deger boot'ta
// donar ve admin ekrani bir daha hicbir seyi degistirmez. Bekci
// (scalex-dinamik-ayarlar.test.cjs) bunu ayni proses icinde KANITLIYOR.
const verifyTimeoutDefault = () => config.tunable('SCALEX_VERIFY_TIMEOUT_DEFAULT');
const verifyTimeoutMin = () => config.tunable('SCALEX_VERIFY_TIMEOUT_MIN');
const verifyTimeoutMax = () => config.tunable('SCALEX_VERIFY_TIMEOUT_MAX');

/**
 * Saniye butcesini dogrular. Bos/undefined -> varsayilan.
 * Gecersiz deger SESSIZCE varsayilana DUSMEZ: kullanici 30000 yazdiysa bunu
 * bilmeli, aksi halde "neden 5 dk bekledi" sorusu cevapsiz kalir.
 */
function normalizeVerificationTimeout(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return verifyTimeoutDefault();
  if (!/^[0-9]{1,7}$/.test(t)) return null;
  const n = Number(t);
  if (n < verifyTimeoutMin() || n > verifyTimeoutMax()) return null;
  return n;
}

// Bir istekte izin verilen azami (cluster x uygulama) cifti. Ust sinir olmadan bir
// kullanici yuzlerce hedef gonderip tek isle cok genis bir kesinti yaratabilirdi.
const maxTargets = () => config.tunable('SCALEX_MAX_TARGETS');

// Prod'da bu esigin ustundeki her calistirma YAZILI onay ister (kullanici namespace
// adini elle yazar). Isi ENGELLEMEZ — yalnizca "ne kadarina dokunuyorum" sorusunu
// kullanicinin onune koyar.
const prodWrittenConfirmThreshold = () => config.tunable('SCALEX_PROD_CONFIRM_THRESHOLD');

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
function computeBlastRadius({
  clusters = [],
  apps = [],
  environment,
  action,
  executionMode,
  // HEDEF BAZLI SECIM: verilmisse hedef sayisi CARPIM DEGIL, GERCEK secim
  // sayisidir. Carpimi kullanmak, kullanici hedeflerin yarisini haric
  // tuttugunda bile "yazili onay gerekir" demek — ve daha kotusu, `maxTargets`
  // sinirini HIC etkilenmeyecek hedefler yuzunden asmak olurdu.
  selectedTargets = null,
}) {
  const clusterCount = clusters.length;
  const appCount = apps.length;
  const targets = Array.isArray(selectedTargets) && selectedTargets.length
    ? selectedTargets.length
    : clusterCount * appCount;
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
    requiresWrittenConfirm: mutating && prod && targets > prodWrittenConfirmThreshold(),
    // Prod + cok cluster = ikinci kisi onayi (kullanici karari). Playbook tarafindaki
    // `bulk_change_confirmation` bunun makine karsiligi.
    requiresSecondPerson: mutating && prod && clusterCount > 1,
    exceedsMaxTargets: targets > maxTargets(),
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
  if (normalizeVerificationTimeout(verificationTimeout) === null)
    bad(
      `Geçersiz sonuç kontrol süresi: "${verificationTimeout}". ` +
        `${verifyTimeoutMin()}–${verifyTimeoutMax()} arası bir saniye değeri girin.`,
    );
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
/**
 * HEDEF BAZLI SECIM — cluster basina uygulama listesi.
 *
 * NEDEN VAR: secim bugune kadar AD BAZLIYDI (`selected: string[]`) ve hedefler
 * `uygulama × cluster` CARPIMI olarak uretiliyordu. Yani *"su cluster'da uygula,
 * otekinde uygulama"* IFADE EDILEMIYORDU: kullanici dort cluster'lik bir listede
 * tek bir cluster'i haric tutamiyor, ya hepsi ya hicbiri oluyordu.
 *
 * Playbook tarafi bunu ZATEN destekliyor: `10_run_phase.yml` her cluster icin
 * betigi AYRI cagiriyor ve `WORKLOAD_KINDS` orada cluster basina cozuluyor.
 * Ayni deseni `APP_RAW` icin kuruyoruz.
 *
 * @param targets `[{ cluster, name }]` — kullanicinin ISARETLI biraktiklari
 * @param allowedApps yetki suzgecinden gecmis uygulama adlari
 * @returns `{ cluster: 'app1,app2' }` — SECIM TAM CARPIMSA `{}` (bkz. cagiran)
 */
function buildClusterAppMap(targets, allowedApps) {
  if (!Array.isArray(targets) || !targets.length) return {};
  const allowed = new Set(allowedApps || []);
  const byCluster = new Map();
  for (const t of targets) {
    const cluster = String(t?.cluster || '').trim();
    const name = String(t?.name || '').trim();
    // Yetki suzgecinden GECMEYEN ad buraya giremez. Istemciden gelen bir liste
    // asla kapsami GENISLETEMEZ — yalnizca DARALTABILIR.
    if (!cluster || !name || !allowed.has(name)) continue;
    if (!byCluster.has(cluster)) byCluster.set(cluster, new Set());
    byCluster.get(cluster).add(name);
  }
  const out = {};
  for (const [cluster, set] of byCluster) out[cluster] = [...set].sort().join(',');
  return out;
}

/**
 * Secim TAM CARPIM mi? (her cluster'da her uygulama isaretli)
 *
 * Tam carpimsa `scalex_cluster_apps` GONDERILMEZ ve davranis bugunku ile
 * BIREBIR ayni kalir — gereksiz bir extra_var is kaydini kirletmez ve eski
 * playbook surumleriyle uyum bozulmaz.
 */
function isFullProduct(clusterAppMap, clusters, apps) {
  const c = Object.keys(clusterAppMap);
  if (c.length !== clusters.length) return false;
  const beklenen = [...apps].sort().join(',');
  return c.every((k) => clusterAppMap[k] === beklenen);
}

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
  // HEDEF BAZLI SECIM: `[{ cluster, name }]`. Bos/verilmemisse davranis
  // bugunku TAM CARPIM ile birebir ayni kalir.
  targets = null,
}) {
  const hosts = await ocpResolveHosts(env, tenant, clusters);
  const meta = await adminData.resolveClusterMeta(env, tenant, clusters);
  // Vault anahtari katalogda yoksa is HIC BASLAMAZ — bu on kontrol LogX/Telnet'te de
  // ayni sekilde kullaniliyor ve bir uretim arizasindan sonra eklenmisti.
  await ocp.assertVaultKeysKnownOrThrow(meta);

  const radius = computeBlastRadius({ clusters, apps, environment: env, action, executionMode });

  const verifySeconds =
    normalizeVerificationTimeout(verificationTimeout) ?? verifyTimeoutDefault();
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
    // CLUSTER BASINA UYGULAMA LISTESI — YALNIZCA secim tam carpim DEGILSE.
    //
    // Tam carpimda gondermek davranisi degistirmezdi ama her is kaydina
    // gereksiz bir extra_var eklerdi; ayrica playbook'un eski bir surumu
    // AWX'te kosuyorsa bu alan sessizce yok sayilir ve TAM CARPIM davranisi
    // dogru kalir. Daraltilmis bir secimde ise alan SART — yoksa haric
    // tutulan hedefler yine islem gorur.
    ...((m) => (m && Object.keys(m).length ? { scalex_cluster_apps: m } : {}))(
      (() => {
        const harita = buildClusterAppMap(targets, apps);
        if (!Object.keys(harita).length) return null;
        return isFullProduct(harita, clusters, apps) ? null : harita;
      })(),
    ),
    operation_action: action,
    // SAYI OLARAK gonderilir, string DEGIL. AWX survey'inde bu soru `integer` tipinde
    // ve AWX tipi DOGRULUYOR: string gonderildiginde launch
    // `400: Value 2 for 'target_replicas' expected to be an integer.` ile REDDEDILIR —
    // yani `Olcekle` islemi hic calismiyordu (2026-09-01 uretim tespiti).
    // Playbook tarafi etkilenmez: `01_prepare.yml` degeri `| string | trim` ile
    // normalize edip regexle dogruluyor.
    ...(action === 'scale' ? { target_replicas: Number(targetReplicas) } : {}),
    // SAYI, STRING DEGIL. Bu uc soru AWX survey'inde `integer` tipinde; string
    // gonderilirse AWX launch'i 400 ile duser (bu depoda kayitli bir tuzak —
    // bkz. scalex-awx-package.test.cjs S7).
    //
    // `?? DEFAULT` KASITLI: `normalizeVerificationTimeout` gecersiz girdide `null`
    // doner ve `Number(null)` SIFIR olur — yani dogrulama bir sekilde atlanirsa
    // AWX'e "0 sn" giderdi. Burada null'a yer yok; dogrulama zaten `validate()`te
    // 400 veriyor, bu ikinci kemer.
    verification_timeout: Number(verifySeconds),
    // ACMA/KAPATMA ASIMETRISI. Uyari esigi butcenin KENDISI; kapatmanin fail esigi
    // iki kati. Betik bu ikisini ayri okur (bkz. scalex_runner.sh verify_replicas).
    verify_warn_seconds: Number(verifySeconds),
    // KAPATMADA FAIL ESIGI. Carpan da admin ayari (kullanici karari: 5 dk uyar,
    // 10 dk fail). Acmada FAIL YOK; betik uyarip basarili biter.
    verify_fail_seconds: Number(verifySeconds) * config.tunable('SCALEX_VERIFY_FAIL_MULTIPLIER'),
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
//
// `ocoConfig` (2026-09-20): admin ayari. `{ enabled, environments }`.
//   enabled=false      -> OCO hicbir yerde istenmez (prod dahil) AMA bu GORUNUR
//                         olur: `ocoGateDisabled: true` doner, ekran kirmizi uyarir
//                         ve sunucu tarafi denetime ayri bir kayit yazar.
//   environments=[...]  -> yalnizca bu ortamlar. Liste YOKSA bugunku kural (prod).
//
// BU PARAMETRE SART: `change-gates.isOcoGateApplicable` artik listeye bakiyor.
// Bu fonksiyon ona AYAK UYDURMAZSA ekran ile sunucu AYRISIR — ornegin admin
// `test` eklediginde `/preview` "skip" der, numara alani hic cikmaz, sonra
// `/run` `ocoRequired` ile reddeder. Yukaridaki yorumun anlattigi arizanin
// birebir aynisi, ters yonden.
function gatePolicyFor({ action, executionMode, environment, ocoConfig }) {
  if (executionMode !== 'apply')
    return { oco: 'skip', smart: 'skip', reason: 'dry_run hicbir sey degistirmez' };

  const envKnown = typeof environment === 'string' && environment.trim() !== '';
  const prod = !envKnown || isProdEnv(environment); // ORTAM BILINMIYORSA PROD SAYILIR

  // OCO hangi ortamlarda isteniyor?
  const cfg = ocoConfig || {};
  const adminEnabled = cfg.enabled !== false; // ayar yoksa ACIK — bkz. index.cjs
  const liste = Array.isArray(cfg.environments) ? cfg.environments : null;
  const ortamKapsamda = liste
    ? liste.some((e) => String(e || '').trim().toLowerCase() === String(environment || '').trim().toLowerCase())
    : prod;
  const ocoUygulanir = adminEnabled && ortamKapsamda;

  // KAPI KAPALI MI, VE BU GORUNMELI MI? Yalnizca prod'da anlamli: prod disinda
  // kapinin zaten istenmemesi normal, uyari gurultu olurdu.
  const ocoGateDisabled = prod && !adminEnabled;

  // SMART ortam kurali DEGISMEDI: yalnizca production.
  if (!prod) {
    return {
      oco: ocoUygulanir ? (action === 'restore' ? 'warn' : 'require') : 'skip',
      smart: 'skip',
      ocoGateDisabled: false,
      reason: ocoUygulanir
        ? 'prod disi ortam — OCO admin ayariyla bu ortamda da isteniyor'
        : 'prod disi ortam — onay kapilari yalnizca production icin',
    };
  }
  if (action === 'restore')
    return {
      oco: ocoUygulanir ? 'warn' : 'skip',
      smart: 'require',
      ocoGateDisabled,
      reason: 'geri alma bir onarim islemidir',
    };
  return {
    oco: ocoUygulanir ? 'require' : 'skip',
    smart: 'require',
    ocoGateDisabled,
    reason: ocoGateDisabled ? 'OCO kapisi admin tarafindan KAPATILMIS' : null,
  };
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
  // GERIYE UYUM: eski adlar FONKSIYON olarak disa aciliyor. Sabit olarak
  // birakmak, cagiranin degeri boot'ta dondurmasina yol acardi.
  verifyTimeoutDefault,
  verifyTimeoutMin,
  verifyTimeoutMax,
  normalizeVerificationTimeout,
  maxTargets,
  prodWrittenConfirmThreshold,
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
  buildClusterAppMap,
  isFullProduct,
  gatePolicyFor,
  buildGateVars,
  gates,
};
