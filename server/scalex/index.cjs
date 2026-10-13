// server/scalex/index.cjs — ScaleX: OCP replica durdurma / geri alma / olcekleme.
//
// TASARIM NOTLARI
// * Hafif yol (Telnet deseni): `ansible_job_history` + `getJobStatusOnServer`. LogX'in
//   agir `logx_v2_requests` durum makinesi KURULMUYOR — burada cok adimli, yarida
//   kalabilen bir sihirbaz durumu yok; her calistirma tek bir AWX isi.
// * Kalici iz `scalex_operations` tablosunda: CLUSTER BASINA BIR SATIR. Bes
//   cluster'dan biri dustugunde hangisinin geri alinmasi gerektigi ancak boyle belli olur.
// * Emniyet kapilari `server/ansible/change-gates.cjs` ile PAYLASILIYOR (Self Service ile
//   ayni kod). ScaleX'a ozel olan yalnizca hangi durumda cagrildigi (bkz. launch.gatePolicyFor).
'use strict';

const db = require('../db/index.cjs');
const runner = require('../ansible/runner.cjs');
const playbookRegistry = require('../ansible/playbook-registry.cjs');
const templatePreflight = require('../ansible/template-preflight.cjs');
const { auditPortal } = require('../audit/index.cjs');

const catalog = require('./catalog.cjs');
const config = require('./config.cjs');
const launch = require('./launch.cjs');
const state = require('./state.cjs');
const rbacFindings = require('./rbac-findings.cjs');
const discoveryTiming = require('./discovery-timing.cjs');
const result = require('./result.cjs');
// PAYLASILAN uygulama onbellegi — LogX'in modulu. ScaleX zaten `catalog.cjs`
// uzerinden ayni katalogu OKUYOR (`ocp-catalog.cjs`); burada ayni onbellegi
// BESLIYORUZ, yani ScaleX'ten yapilan tam bir kesif LogX'i de hizlandiriyor.
// Ikinci bir tablo/modul acmak, ayni verinin iki yerde ayrismasi demekti.
const ocpCache = require('../logx/v2/ocp-cache.cjs');
const clusterCaps = require('./cluster-caps.cjs');
const capsRefresh = require('./caps-refresh.cjs');

const RUN_KEY = 'scalex_run';
const DISCOVERY_KEY = 'scalex_discovery';

// Sahiplik icin bellek-ici yedek (Telnet ile ayni): DB tokezlerse bile kullanici kendi
// isini gorebilsin. Sinirli boyut — sinirsiz bir Map bellek sizintisi olurdu.
const JOB_OWNER_CACHE = new Map();
const JOB_OWNER_MAX = 2000;
function rememberJobOwner(serverId, jobId, username) {
  if (JOB_OWNER_CACHE.size >= JOB_OWNER_MAX) {
    JOB_OWNER_CACHE.delete(JOB_OWNER_CACHE.keys().next().value);
  }
  JOB_OWNER_CACHE.set(`${serverId}:${jobId}`, String(username || '').toLowerCase());
}

// KESIF KAPSAMI: bir kesfin TUM namespace'i mi yoksa yalnizca secilen uygulamalari
// mi taradigini is bittikten sonra bilmemiz gerekiyor.
//
// NEDEN: sonuc paylasilan uygulama katalogunu (`ocp_app_cache`) besliyor ve
// `putApps` o namespace'te GORULMEYEN uygulamalari `is_deleted=1` yapiyor.
// Daraltilmis bir kesfi (kullanici 1 uygulama secti) onbellege yazmak, kalan 49
// uygulamayi SILINMIS isaretlerdi — katalog kendi kendini bosaltirdi.
//
// Boyut JOB_OWNER_CACHE ile ayni gerekceyle sinirli: sinirsiz bir Map bellek
// sizintisidir (2026-09 OOM turunda tam bu sinif tarandi).
const DISCOVERY_SCOPE_CACHE = new Map();
const DISCOVERY_SCOPE_MAX = 2000;
function rememberDiscoveryScope(serverId, jobId, scope) {
  if (DISCOVERY_SCOPE_CACHE.size >= DISCOVERY_SCOPE_MAX) {
    DISCOVERY_SCOPE_CACHE.delete(DISCOVERY_SCOPE_CACHE.keys().next().value);
  }
  DISCOVERY_SCOPE_CACHE.set(`${serverId}:${jobId}`, scope);
}

// KESIF DEFTER ISLERI IS BASINA BIR KEZ (bkz. `/discover/:s/:j/status`). Boyut
// JOB_OWNER_CACHE ile ayni gerekceyle sinirli: sinirsiz bir kume bellek sizintisidir.
const DEFTER_YAPILDI = new Set();
const DEFTER_MAX = 2000;
function defterBirKez(serverId, jobId) {
  const k = `${serverId}:${jobId}`;
  if (DEFTER_YAPILDI.has(k)) return false;
  if (DEFTER_YAPILDI.size >= DEFTER_MAX) DEFTER_YAPILDI.delete(DEFTER_YAPILDI.values().next().value);
  DEFTER_YAPILDI.add(k);
  return true;
}

// FAIL-CLOSED: sahiplik dogrulanamiyorsa erisim REDDEDILIR (503). Fail-open olsaydi bir
// DB kesintisi tum islerin herkese acilmasi demek olurdu.
async function denyIfNotOwner(req, serverId, jobId) {
  const reqUser = req.session?.user || {};
  if (reqUser.role === 'Admin') return null;
  const me = String(reqUser.username || '').toLowerCase();
  let owner = JOB_OWNER_CACHE.get(`${serverId}:${jobId}`) || null;
  if (!owner) {
    try {
      const { rows } = await db.query(
        `SELECT TOP 1 username FROM ansible_job_history WHERE job_id = $1 AND awx_server_id = $2`,
        [jobId, serverId],
      );
      owner = rows.length && rows[0].username ? String(rows[0].username).toLowerCase() : null;
    } catch (e) {
      console.warn('[ScaleX] sahiplik sorgusu basarisiz — erisim reddedildi:', e.message);
      return { status: 503, message: 'İş sahipliği doğrulanamadı, lütfen tekrar deneyin.' };
    }
  }
  if (!owner || owner !== me) {
    // BASKASININ ISINE ERISIM DENEMESI DENETIME. 403 donuyordu ama HICBIR iz
    // birakmiyordu: bir kullanicinin baska birinin prod kesinti isini gormeye
    // calismasi, denetim kaydinda gorunmesi gereken tam olarak bu tur bir olay.
    auditPortal(req, 'scalex_access_denied', {
      result: 'fail',
      detail: JSON.stringify({ serverId, jobId, owner: owner || null }),
    });
    return { status: 403, message: 'Bu iş size ait değil.' };
  }
  return null;
}

// ASYNC OLMAK ZORUNDA. `playbookRegistry.getByKey` bir Promise doner; `await`siz
// cagrildiginda `row` bir Promise olur, `row.enabled` `undefined` kalir (=== false
// DEGIL, yani ilk kontrolden gecer) ve `getEffectiveTemplateId` hem `awxTemplateId`
// hem `envVarName` icin `undefined` gorup HER ZAMAN `null` doner. Sonuc: admin
// ekranindan Template ID girilse de, .env doldurulsa da HER ScaleX cagrisi
// 501 "Template ID girilmemis" ile duser — yani ScaleX hic calismaz.
// Dogru desen LogX'te: server/logx/v2/jobs.cjs `await playbookRegistry.getByKey(...)`.
async function resolveByKey(keyName) {
  const row = await playbookRegistry.getByKey(keyName);
  if (!row || row.enabled === false) {
    throw Object.assign(
      new Error(
        `"${keyName}" playbook kaydı tanımlı/etkin değil — Admin > Playbook Kayıtları ekranından tanımlayın.`,
      ),
      { status: 501 },
    );
  }
  const templateId = playbookRegistry.getEffectiveTemplateId(row);
  if (!templateId) {
    throw Object.assign(
      new Error(`"${keyName}" için AWX Template ID girilmemiş — Admin > Playbook Kayıtları.`),
      { status: 501 },
    );
  }
  const serverId = Number(row.awxServerId || process.env.SCALEX_AWX_SERVER_ID || 1);
  return { templateId: Number(templateId), serverId, keyName };
}

// CLUSTER BASINA BIR SATIR. Iki cagirandan da kullanilir: isi HEMEN baslatan yol
// (`status: 'RUNNING'`) ve SMART onayi bekleyen yol (`status: 'PENDING_APPROVAL'`,
// `jobId` henuz YOK).
//
// NEDEN ONAY BEKLERKEN DE YAZIYORUZ: kapi `pendingApproval` ile donunce `/run` erken
// cikiyordu ve bu INSERT hic calismiyordu. Onay gelince isi SMART poller'i
// `runner.performSsLaunch` ile baslatir; o yol yalnizca `ansible_job_history`ye yazar,
// `scalex_operations`i BILMEZ. Sonuc zinciri: uzlastirici RUNNING satir bulamaz →
// `finalizeOperation` hic calismaz → `scalex_state_mirror` guncellenmez → uygulama
// "Su an durdurulmus" listesine DUSMEZ → GERI ALMA YOLU KAPANIR. Yani prod'daki her
// onayli durdurma, portalin geri alinabilirlik vaadini kiriyordu.
//
// `request_key` onay yolunda `smart:<ticketId>` olur; is baslayinca uzlastirici onu
// gercek `<serverId>:<jobId>` ile degistirir (bkz. reconciler.adoptApprovedTickets).
async function insertOperationRows({
  requestKey,
  username,
  // Sahibin AD gruplari — "kendi actigini kendi ekibi gorsun" kurali icin.
  // Eylem anindaki uyelik yazilir; sonradan ogrenmenin yolu yok.
  usernameGroups,
  env,
  tenant,
  clusters,
  namespace,
  action,
  executionMode,
  targetReplicas,
  apps,
  serverId,
  jobId,
  status,
  ocoNumber,
  reason,
  smartTicketId = null,
}) {
  for (const cluster of clusters) {
    await db.query(
      `INSERT INTO scalex_operations
         (request_key, username, env, tenant, cluster_name, namespace, action, execution_mode,
          target_replicas, app_names_json, awx_server_id, awx_job_id, status, oco_number, reason,
          smart_ticket_id, approval_state, username_groups)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        requestKey,
        username,
        env,
        tenant,
        cluster,
        namespace,
        action,
        executionMode,
        action === 'scale' ? Number(targetReplicas) : null,
        JSON.stringify(apps),
        serverId ?? null,
        jobId ?? null,
        status,
        String(ocoNumber || '') || null,
        reason || null,
        smartTicketId,
        smartTicketId ? 'PENDING' : null,
        // Bos dizi ile `null` AYRI SEYLER: `null` = grup bilgisi HIC yazilmadi
        // (eski kayit), `[]` = kullanicinin grubu yok. Ikisini birlestirmek,
        // eski kayitlari "grupsuz" sayip gorunurlugu yanlis hesaplardi.
        Array.isArray(usernameGroups) ? JSON.stringify(usernameGroups.slice(0, 200)) : null,
      ],
    );
  }
}

// ScaleX'in DEGISIKLIK KAPISI — `/run` ve `/restore-all` icin TEK govde.
//
// `res`e DOKUNMAZ: karar nesnesi doner ({ outcome: 'proceed' | 'error' | 'respond' }),
// cagiran onu kendi sozlesmesine cevirir. Ortak kapi modulunun (`change-gates.cjs`)
// Express'ten kopartilma gerekcesinin aynisi — burada da ikinci bir cagiran cikti.
//
// SET KAPALI: `proceed` disindaki her deger cagiranda tuketilmek ZORUNDA; taninmayan
// bir deger FAIL-CLOSED ele alinir (bkz. change-gates.cjs sozlesmesi).
// ── HEDEF BAZLI SECIM ───────────────────────────────────────────────────────
//
// Secim bugune kadar AD BAZLIYDI ve hedefler `uygulama × cluster` CARPIMI
// olarak uretiliyordu — yani "su cluster'da uygula, otekinde uygulama" IFADE
// EDILEMIYORDU.
//
// ISTEMCIDEN GELEN LISTE ASLA KAPSAMI GENISLETEMEZ, yalnizca DARALTABILIR:
// her hedef, zaten yetki suzgecinden gecmis `apps` ve `clusters` kumelerinin
// ICINDE olmak zorunda. Aksi halde kullanici govdeye bir satir ekleyerek
// goremedigi bir cluster'a dokunabilirdi.
function normalizeTargets(raw, { clusters, apps }) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const clusterSet = new Set(clusters);
  const appSet = new Set(apps);
  const gorulen = new Set();
  const out = [];
  for (const t of raw) {
    const cluster = String(t?.cluster || '').trim();
    const name = String(t?.name || '').trim();
    if (!clusterSet.has(cluster) || !appSet.has(name)) continue;
    const k = `${cluster}\u0000${name}`;
    if (gorulen.has(k)) continue;
    gorulen.add(k);
    out.push({ cluster, name });
  }
  return out.length ? out : null;
}

// ── KAPI AYARINI TEK YERDEN OKU (2026-10-13) ───────────────────────────────
//
// SMART ve OCO ayarlari AYNI satirda durur (`ansible_ss_customizations`, ScaleX'in
// kendi sablonu). Eskiden `/preview` yalnizca OCO kismini okuyordu; SMART'in hazir
// olup olmadigini YALNIZCA `/run` biliyordu. Sonuc uretimde yasandi: ekran "SMART
// kaydi acilacak" deyip OCO numarasi istedi, sunucu numara girildikten SONRA reddetti.
//
// OKUNAMAZSA `svcConfig: {}` doner: OCO varsayilana duser (ACIK, yalniz prod) ve SMART
// "hazir degil" sayilir — bilgi yoklugu hicbir kapiyi INDIRMEZ. Hata saklanir; isi
// gercekten baslatacak cagiran (`runScaleXGates`) onu oldugu gibi firlatir.
async function readGateConfig() {
  try {
    const { templateId, serverId } = await resolveByKey(RUN_KEY);
    const cfg = await require('../ansible/ss-customizations.cjs').readCustom(serverId, templateId);
    return { serverId, templateId, svcConfig: cfg || {}, hata: null };
  } catch (e) {
    console.warn('[ScaleX] kapi ayari okunamadi, varsayilan (prod: OCO acik, SMART gerekli) kullaniliyor:', e.message);
    return { serverId: null, templateId: null, svcConfig: {}, hata: e };
  }
}

// ── KAPI POLITIKASI — HER UC BURADAN (2026-10-13) ───────────────────────────
//
// `launch.gatePolicyFor` SAF bir fonksiyon; girdilerini toplamak (ayar satiri, SMART
// kipi, SMART baglantisi, admin'in kisisel tercihi) bu fonksiyonun isi. `/preview`,
// `/run`, `/restore-all` ve OCO tani ucu YALNIZCA bunu cagirir: girdileri her ucta ayri
// toplamak, bu dosyada iki kez yasanan "ekran bir sey soyler, sunucu baska bir sey
// yapar" ayrismasinin kaynagiydi.
async function resolveGatePolicy(
  req,
  // `herkesIcin`: admin'in KISISEL atlama tercihi hesaba katilmaz. Yalniz durum karti
  // kullanir — orada sorulan "siradan bir kullanici ne gorur", "ben ne gorurum" degil.
  { action, executionMode, environment, tenant = '', clusters = [], namespace = '', herkesIcin = false },
) {
  const gateCfg = await readGateConfig();
  let smartClientReady = false;
  try {
    smartClientReady = require('../smart/client.cjs').isConfigured() === true;
  } catch {
    smartClientReady = false;
  }
  const missing = launch.smartEksikleri(gateCfg.svcConfig.smartApproval, { smartClientReady });
  const mode = config.smartMode().value;
  // KISISEL TERCIH yalnizca sonucu DEGISTIREBILECEGI durumda okunur (bir DB okumasi):
  // kip `required` ve calistirma `apply`. Okunamazsa `false` doner (admin-smart-atla
  // FAIL-CLOSED) — atlama olmaz, onay istenir.
  const adminSkip =
    !herkesIcin && executionMode === 'apply' && mode === 'required'
      ? await require('../ansible/admin-smart-atla.cjs').adminSmartAtliyor(req)
      : false;
  // ISTISNA KURALI: ortak kapinin kullandigi AYNI fonksiyon, AYNI kapi degiskenleri
  // (`launch.buildGateVars`). Iki ayri eslestirme, ekranla sunucuyu yine ayirirdi.
  const sa = gateCfg.svcConfig.smartApproval || {};
  let skipRule = null;
  if (sa.enabled && executionMode === 'apply') {
    const es = launch.gates.matchSmartSkip(
      sa,
      launch.buildGateVars({ env: environment, tenant, action, executionMode, clusters, namespace }),
    );
    if (es.skip) skipRule = { field: es.field, value: es.value };
  }
  const policy = launch.gatePolicyFor({
    action,
    executionMode,
    environment,
    ocoConfig: gateCfg.svcConfig.ocoCheck || {},
    smart: { mode, configured: missing.length === 0, missing, adminSkip, skipRule },
  });
  return { policy, gateCfg };
}

// ORTAK KAPININ 5xx'i KULLANICIYA ULASMAZ. Kurumsal ters-proxy 5xx govdelerini SPA
// sayfasiyla degistiriyor (bkz. template-preflight.cjs, 2026-08-10 HAR'i): sunucu
// "Smart talebi acilamadi: ..." derken ekran "Portal yeniden baslatiliyor, tekrar
// deneyin" yaziyor ve kullanici ayni istegi tekrar tekrar gonderiyor (2026-10-13: bes
// kez). Bilincli bir RET 4xx'tir; asil kod govdede `upstreamStatus` olarak durur.
function istemciyeUlasan(status, body) {
  const n = Number(status) || 500;
  if (n < 500) return { status: n, body };
  return { status: 409, body: { ...(body || {}), upstreamStatus: n } };
}

// ── SMART GEREKLI AMA HAZIR DEGIL: RET + IZ, TEK GOVDE ──────────────────────
//
// SIRA (2026-10-13). Bu ret 2026-09-20'de OCO kapisindan SONRAYA alinmisti: o gun OCO
// koduna hic ulasilamadigi kanitlanmisti ve "kullanici once gercek OCO hatasini gorsun"
// istenmisti. Uretimde tersi yasandi: kullanici OCO'yu DUZELTIP gecti, sonra bu duvara
// carpti — ve OCO ne olursa olsun is zaten baslayamazdi. Ustelik sonraya almak bir ACIK
// birakti: pencere henuz acilmamissa ortak kapi "zamanla" secimini kabul edip kayit
// aciyor ve bu rede HIC ULASILMIYORDU; zamanlanan is pencere saatinde SMART'siz calisirdi.
//
// Artik engel `/preview`da BASTAN soyleniyor (ekran OCO numarasi istemez) ve burada ayni
// kararla, AYNI METINLE reddediliyor. OCO kapisinin erisilebilirligi SMART devrede
// degilken/hazirken olculur (bkz. scalex-kapi-matrisi.test.cjs).
//
// IKI CAGIRAN, TEK GOVDE: `/run` kilit almadan ve AWX sozlugunu kurmadan ONCE doner;
// `runScaleXGates` (toplu geri alma dahil) ortak kapidan once ayni fonksiyonu cagirir.
//
// AYAR OKUNAMADIYSA asil sebep odur ("Template ID girilmemis" gibi); "SMART hazir degil"
// demek kullaniciyi yanlis ekrana gonderirdi. Hata oldugu gibi yukari cikar.
function engelKarari(req, policy, gateCfg, iz) {
  if (gateCfg && gateCfg.hata) throw gateCfg.hata;
  auditPortal(req, 'scalex_gate_decision', {
    result: 'fail',
    detail: JSON.stringify({
      ...iz,
      outcome: 'blocked',
      code: policy.blocked.code,
      missing: policy.smartMissing || [],
    }),
  });
  return {
    outcome: 'error',
    status: 409,
    body: {
      ok: false,
      code: policy.blocked.code,
      gates: { oco: 'not_checked', smart: 'not_configured' },
      missing: policy.smartMissing || [],
      message: policy.blocked.message,
    },
  };
}

async function runScaleXGates({
  req,
  user,
  policy,
  gateCfg,
  env,
  tenant,
  clusters,
  namespace,
  apps,
  action,
  executionMode,
  targetReplicas,
  extraVars,
  reason,
  ocoNumber,
  ocoAction,
}) {
  const izDetayi = () =>
    JSON.stringify({ env, tenant, clusters, namespace, apps, action, executionMode });
  // SMART'SIZ GECEN PROD UYGULAMASI SESSIZ KALMAZ. Iki ayri yol, iki ayri iz:
  //   * admin anahtari kapali   -> `scalex_smart_gate_disabled`
  //   * admin'in kisisel tercihi -> `smart_onayi_admin_atladi` (Self Service ile AYNI eylem;
  //     ortak kapi bu izi yalniz SMART ayari tanimliyken yaziyor, burada ayar olmasa da yazilir)
  // Is GERCEKTEN ilerlerken yazilir (baslatma ya da zamanlama); OCO numarasi eksik diye
  // donen bir el sikisma turu iz birakmaz.
  const smartsizIz = () => {
    if (policy.smartStatus === 'disabled_by_admin') {
      auditPortal(req, 'scalex_smart_gate_disabled', { result: 'warn', detail: izDetayi() });
    } else if (policy.smartStatus === 'admin_skip') {
      require('../ansible/admin-smart-atla.cjs').atlamayiDenetle(req, 'scalex', {
        env,
        tenant,
        clusters,
        namespace,
        action,
      });
    } else if (policy.smartStatus === 'skipped_by_rule') {
      auditPortal(req, 'scalex_smart_skipped_by_rule', {
        result: 'warn',
        detail: JSON.stringify({
          env, tenant, clusters, namespace, apps, action, executionMode,
          rule: policy.smartSkipRule || null,
        }),
      });
    }
  };

  // OCO KAPISI ADMIN TARAFINDAN KAPATILMIS HALDE gecen prod isi de SESSIZ KALMAZ: ayri bir
  // eylem olarak denetime yazilir. SMART iziyle AYNI anlarda: is baslarken ya da onay
  // bileti acilirken (onay gelince is OCO sorulmadan calisacak). Reddedilen istek yazmaz.
  //
  // 2026-10-14: bu iz eskiden fonksiyonun ORTASINDA yaziliyordu ve iki kapi da kapaliyken
  // (admin anahtari + OCO kapali) asagidaki erken donus ona HIC ULASMIYORDU — prod'da
  // hicbir kapidan gecmeyen is yalniz SMART izini birakiyordu.
  const ocoKapaliIz = () => {
    if (policy.ocoGateDisabled) {
      auditPortal(req, 'scalex_oco_gate_disabled', { result: 'warn', detail: izDetayi() });
    }
  };

  if (policy.smart !== 'require' && policy.oco !== 'require') {
    ocoKapaliIz();
    smartsizIz();
    return { outcome: 'proceed' };
  }

  // SMART gerekli ama hazir degil: EN BASTA, hicbir dis cagri yapmadan (bkz. engelKarari).
  if (policy.blocked) {
    return engelKarari(req, policy, gateCfg, { env, tenant, clusters, namespace, apps, action, executionMode });
  }

  // Buradan sonrasi GERCEK sablon kimligi ister (SMART bileti ve zamanlama kaydi ona
  // baglanir). Okunamadiysa is BASLATILMAZ — hata oldugu gibi yukari cikar.
  if (!gateCfg || gateCfg.serverId == null || gateCfg.templateId == null) {
    throw (
      (gateCfg && gateCfg.hata) ||
      Object.assign(new Error('ScaleX kapı ayarı okunamadı; iş güvenlik gereği başlatılmadı.'), {
        status: 409,
        code: 'scalex_not_configured',
      })
    );
  }
  const runServerId = gateCfg.serverId;
  const runTemplateId = gateCfg.templateId;
  const svcConfig = gateCfg.svcConfig || {};

  const gateVars = launch.buildGateVars({
    env,
    tenant,
    action,
    executionMode,
    clusters,
    namespace,
  });

  // ── OCO KAPISI AYARI ────────────────────────────────────────────────────────
  //
  // `enabled` ADMIN AYARINDAN okunur. VARSAYILAN ACIK (`!== false`): ayar satiri YOKSA
  // kapi SESSIZCE inmez.
  const ocoCfg = svcConfig.ocoCheck || {};
  const ocoAdminEnabled = ocoCfg.enabled !== false;
  const ocoEnvironments = Array.isArray(ocoCfg.environments) ? ocoCfg.environments : null;
  const overrides = {
    // `restore` icin OCO UYARIR ama ENGELLEMEZ -> kapiyi hic acmiyoruz; gerekce
    // zaten cagiranda zorunlu kilindi ve kayda + SMART'a gidiyor.
    ocoCheck: {
      enabled: ocoAdminEnabled && policy.oco === 'require',
      // Liste verilmisse ortak kapi ONU kullanir; verilmemisse bugunku prod
      // kurali gecerli kalir (bkz. change-gates.isOcoGateApplicable).
      ...(ocoEnvironments ? { environments: ocoEnvironments } : {}),
    },
    // SMART AYARI YALNIZCA SMART DEVREDEYKEN ortak kapiya gider. Kip `oco_only` ya da
    // admin'in kisisel tercihi varken dolu bir ayar gecmek, ortak kapinin bilet acmasi
    // demek olurdu; ayrica bu nesne ZAMANLANAN plana da yazilir ve pencere saatinde
    // onay kapisini ORADAN okurlar.
    smartApproval: policy.smart === 'require' ? svcConfig.smartApproval || {} : {},
  };

  const radius = launch.computeBlastRadius({
    clusters,
    apps,
    environment: env,
    action,
    executionMode,
  });
  const scalexOzet = scalexSmartBaglami({
    user,
    env,
    tenant,
    clusters,
    namespace,
    apps,
    action,
    targetReplicas,
    radius,
    reason,
    ocoNumber,
  });
  const decision = await launch.gates.runChangeGates({
    // GERCEK sunucu/template kimligi — 0 DEGIL. SMART onayi geldiginde bilet
    // `runner.cjs` tarafindan oynatiliyor ve orada `getServerById(ticket.awxServerId)`
    // cagriliyor; 0 yazilsaydi onaylanmis bir prod islemi "AWX sunucusu bulunamadi"
    // ile SESSIZCE olurdu.
    server: { id: runServerId },
    templateId: runTemplateId,
    username: user.username,
    req,
    overrides,
    extraVars,
    gateVars,
    detail: {},
    resolvedLaunchOptions: {},
    specFields: [],
    templateName: 'ScaleX',
    ocoNumber,
    // PENCERE HENUZ ACILMADIYSA kullaniciya sorulur; "zamanla" secimi YALNIZCA
    // `policy.schedulable` iken ortak kapiya gider (bkz. launch.gatePolicyFor). Istemci
    // alani elle gonderse de sunucu kendi kararini uygular.
    ocoAction: policy.schedulable && ocoAction === 'schedule' ? 'schedule' : 'later',
    // ZAMANLAMA PORTALDA TUTULUR (AWX-native degil): kayit portalda iptal edilir ve
    // guncellenir; poller kesinti saatinde isi baslatir.
    preferPortalScheduler: true,
    // Gorunurluk: kullanici KENDI ve GRUBUNUN kayitlarini gorur/iptal eder.
    ownerGroups: Array.isArray(user.groups) ? user.groups : null,
    createOcoAwxSchedule: async () => {
      // `preferPortalScheduler: true` oldugu icin ortak kapi buraya HIC gelmez.
      // Yine de firlatiyoruz: sessizce AWX-native zamanlamaya dusmek, kaydin
      // portal tarafindan iptal edilememesi demek olurdu.
      throw Object.assign(
        new Error('ScaleX zamanlamasi portal tarafinda tutulur — AWX schedule kullanilmaz.'),
        { status: 500 },
      );
    },
    friendlyAwxError: (e) => ({ status: e.status || 502, message: e.message }),
    // ALAN ESLEMESI ADMIN'IN SABLONUNDAN (2026-10-13). Eskiden bu kanca sablonu YOK
    // SAYIP sabit bir DIZI donduruyordu; Smart istemcisi nesne bekledigi icin anahtarlar
    // "0, 1, 2..." oluyordu ve bilet hic acilamazdi.
    buildSmartMetadata: (metadataFieldsRaw, ctx) =>
      buildScaleXSmartMetadata(metadataFieldsRaw, ctx, scalexOzet),
  });

  // IZ: kapinin her karari — is baslamamis olsa bile — denetime yazilir.
  if (decision?.outcome !== 'proceed') {
    auditPortal(req, 'scalex_gate_decision', {
      detail: JSON.stringify({
        env,
        tenant,
        clusters,
        namespace,
        apps,
        action,
        executionMode,
        outcome: decision?.outcome ?? 'bilinmiyor',
        policy,
        ocoRequired: decision?.body?.ocoRequired ?? false,
        ocoDeferred: decision?.body?.ocoDeferred ?? false,
        ocoExpired: decision?.body?.ocoExpired ?? false,
        ocoScheduled: decision?.body?.ocoScheduled ?? false,
        pendingApproval: decision?.body?.pendingApproval ?? false,
        ticketId: decision?.body?.ticketId ?? null,
      }),
    });
  }

  if (decision?.outcome === 'error') {
    return { outcome: 'error', ...istemciyeUlasan(decision.status, decision.body) };
  }
  if (decision?.outcome === 'respond') {
    const body = decision.body || {};
    // PORTAL KAYDI SIMDI YAZILMALI — is AWX'te henuz YOK. Yazilmazsa is sonradan
    // (onayla ya da pencere saatinde) calisir ve portal bunu hic ogrenemez: ayna
    // guncellenmez, uygulama "Su an durdurulmus"a dusmez, geri alma kisayolu cikmaz.
    const bekleyenKayit = (ek) =>
      insertOperationRows({
        username: user.username,
        usernameGroups: user.groups,
        env,
        tenant,
        clusters,
        namespace,
        action,
        executionMode,
        targetReplicas,
        apps,
        serverId: runServerId,
        jobId: null,
        ocoNumber,
        reason,
        ...ek,
      });
    if (body.pendingApproval && body.ticketId) {
      await bekleyenKayit({
        requestKey: `smart:${body.ticketId}`,
        status: 'PENDING_APPROVAL',
        smartTicketId: Number(body.ticketId),
      });
      ocoKapaliIz();
    } else if (body.ocoScheduled && body.scheduleId != null) {
      // ZAMANLANDI (2026-10-13). Bu dal uzun sure HICBIR kayit yazmiyordu: pencere
      // saatinde OCO zamanlayicisi isi `performSsLaunch` ile baslatiyor ve o yol
      // ScaleX'i BILMIYOR. Uzlastirici `oco:<kayit>` anahtarindan kaydi izler
      // (bkz. reconciler.adoptScheduledLaunches).
      await bekleyenKayit({ requestKey: `oco:${body.scheduleId}`, status: 'SCHEDULED' });
      smartsizIz();
    }
    // Ekran "zamanlayayim mi" diye YALNIZCA zamanlanabilir bir istekte sorar.
    return {
      outcome: 'respond',
      body: body.ocoDeferred ? { ...body, schedulable: policy.schedulable === true } : body,
    };
  }
  if (decision?.outcome !== 'proceed') {
    console.error('[ScaleX] taninmayan kapi karari — is BASLATILMADI:', JSON.stringify(decision));
    return {
      outcome: 'error',
      status: 409,
      body: {
        ok: false,
        upstreamStatus: 500,
        message:
          'Değişiklik kapısı beklenmeyen bir sonuç döndürdü; iş güvenlik gereği başlatılmadı.',
      },
    };
  }

  // SON EMNIYET: politika "SMART gerekli" dedi ama ortak kapi bilet ACMADAN gecti.
  // Bugun buna yol acan bir dal yok (istisna kurali ve admin tercihi politikada
  // cozuluyor); yarin ortak kapiya eklenecek bir atlama yolu ScaleX'i SESSIZCE
  // onaysiz birakmasin diye is burada durur.
  if (policy.smart === 'require') {
    console.error('[ScaleX] SMART gerekli dendi ama ortak kapi bilet acmadan gecti — is BASLATILMADI');
    auditPortal(req, 'scalex_gate_decision', {
      result: 'fail',
      detail: JSON.stringify({ env, tenant, clusters, namespace, apps, action, executionMode, outcome: 'inconsistent' }),
    });
    return {
      outcome: 'error',
      status: 409,
      body: {
        ok: false,
        code: 'gate_inconsistent',
        message:
          'SMART onayı gerekiyor ancak onay kaydı açılmadı; iş güvenlik gereği başlatılmadı. Yöneticinize bildirin.',
      },
    };
  }

  ocoKapaliIz();
  smartsizIz();
  return { outcome: 'proceed' };
}

// ── GERI ALMA KILIDI (ortak) ────────────────────────────────────────────────
//
// Ayni hedefe ikinci bir geri alma islemini engeller. Kilit AYNANIN KENDISINDE,
// tek ifadelik compare-and-set (`scaled_down` → `restoring`, bkz. state.cjs).
// `absent` bir CAKISMA DEGILDIR: AWX'ten elle durdurulmus bir uygulamanin portal
// kaydi yoktur ve onu reddetmek bugun calisan bir yolu kapatirdi.
//
// TUMU YA DA HICBIRI: bir hedef bile mesgulse alinan kilitler geri birakilir ve is
// hic baslatilmaz. Kismi kilitle calistirmak, kullaniciya "6 hedefin 4'u gitti"
// demek olurdu ve kalan iki hedefin kilidi de bizde asili kalirdi.
async function acquireRestoreLocks({ env, tenant, clusters, namespace, apps }) {
  const acquired = [];
  const busy = [];
  for (const cluster of clusters) {
    for (const app of apps) {
      const target = { env, tenant, clusterName: cluster, namespace, appName: app };
      const outcome = await state.tryLockRestore(target);
      if (outcome === 'locked') acquired.push(target);
      else if (outcome === 'busy') busy.push({ cluster, app });
    }
  }
  if (busy.length) {
    await releaseRestoreLocks(acquired);
    return { ok: false, busy };
  }
  return { ok: true, acquired };
}

async function releaseRestoreLocks(targets) {
  for (const t of targets || []) {
    try {
      await state.unlockRestore(t);
    } catch (e) {
      console.warn('[ScaleX] geri alma kilidi birakilamadi:', e.message);
    }
  }
}

function restoreConflictBody(busy) {
  const list = busy.map((b) => `${b.app} (${b.cluster})`).join(', ');
  return {
    ok: false,
    code: 'restore_in_progress',
    busy,
    message:
      `Bu uygulamalar için zaten bir geri alma işlemi sürüyor: ${list}. ` +
      'İş bitince “Şu an durdurulmuş” listesi kendiliğinden güncellenir.',
  };
}

function currentUser(req) {
  return req.session?.user || { username: 'anonymous', role: 'User' };
}

function asyncRoute(fn) {
  return (req, res) =>
    fn(req, res).catch((err) => {
      const status = err.status || 500;
      if (status >= 500) console.error('[ScaleX]', err);
      res.status(status).json({ ok: false, message: err.message, code: err.code });
    });
}

// ── BILINCLI RET KULLANICIYA ULASSIN (2026-10-13) ───────────────────────────
//
// `asyncRoute` hatanin `status`unu aynen doner. ScaleX'in BILEREK firlattigi bazi
// hatalar 5xx tasiyor: "Template ID girilmemis" (501), AWX'e ulasilamadi (502/503/504).
// Kurumsal ters-proxy 5xx govdelerini degistirdigi icin (bkz. `istemciyeUlasan`) bu
// mesajlar ekrana HIC ulasmiyor; kullanici "portal yeniden baslatiliyor" okuyup ayni
// istegi tekrarliyor.
//
// YALNIZCA KULLANICININ BASLATTIGI ISTEKLERDE (POST) kullanilir. Yoklama (GET status)
// uclari `asyncRoute`ta KALIR: yoklayicilar gecici hatayi FIRLATILAN hatadan sayiyor
// (`safeJson` JSON olmayan 5xx'te firlatir); 4xx JSON donmek, sinirli yeniden denemeyi
// sinirsiz bir "bitmedi" dongusune cevirirdi.
//
//   501            -> 409  yapilandirma eksik (kullanici tekrar deneyerek cozemez)
//   502 / 503 / 504 -> 424  bagimli sistem (AWX) yanit vermedi
//   500 ve digerleri -> AYNEN (beklenmeyen hata; genel mesaj dogrudur)
function eylemRoute(fn) {
  return (req, res) =>
    fn(req, res).catch((err) => {
      const asil = err.status || 500;
      const status = asil === 501 ? 409 : [502, 503, 504].includes(asil) ? 424 : asil;
      if (asil >= 500) console.error('[ScaleX]', err);
      res.status(status).json({
        ok: false,
        message: err.message,
        code: err.code || (asil === 501 ? 'scalex_not_configured' : status === 424 ? 'awx_unreachable' : undefined),
        ...(status !== asil ? { upstreamStatus: asil } : {}),
      });
    });
}

// Ortak girdi cozumleme + anti-TOCTOU dogrulama. HER calistirmada bastan kosar;
// client'in gonderdigi hicbir sey "daha once dogrulanmisti" diye atlanmaz.
async function resolveScope(req, { requireApps = true } = {}) {
  const user = currentUser(req);
  const b = req.body || {};
  const env = String(b.env || '').trim();
  const tenant = String(b.tenant || '').trim();
  const namespace = String(b.namespace || '').trim();
  const clusters = [
    ...new Set(
      (Array.isArray(b.clusters) ? b.clusters : []).map((c) => String(c).trim()).filter(Boolean),
    ),
  ];
  const apps = [
    ...new Set((Array.isArray(b.apps) ? b.apps : []).map((a) => String(a).trim()).filter(Boolean)),
  ];
  // ── EK NAMESPACE'LER (TEK ISTE COK NAMESPACE) ──────────────────────────────
  //
  // `namespace` TEKIL KALIYOR ve listenin ILKIDIR: her cagiran onu gonderiyor,
  // her bekci onu kilitliyor. `namespaces` yalnizca EKLENIYOR; gelmediginde
  // davranis birebir bugunku olur.
  //
  // YETKI HER NAMESPACE ICIN AYRI SORULUR (asagida). Yalnizca ilkini sormak,
  // kullanicinin GORMEDIGI bir namespace'in uygulama adlarini ona listelemek
  // olurdu — ve bu uc `assertNamespaceAllowed`in var olus sebebi.
  const namespaces = [
    ...new Set(
      [namespace, ...(Array.isArray(b.namespaces) ? b.namespaces : [])]
        .map((n) => String(n).trim())
        .filter(Boolean),
    ),
  ];

  if (!env || !tenant) throw Object.assign(new Error('env ve tenant zorunlu.'), { status: 400 });
  if (!clusters.length)
    throw Object.assign(new Error('En az bir cluster seçilmeli.'), { status: 400 });
  if (requireApps && !apps.length)
    throw Object.assign(new Error('En az bir uygulama seçilmeli.'), { status: 400 });

  await catalog.assertClustersExist({ env, tenant, clusters });
  // HER namespace icin AYRI yetki kontrolu. `namespaces` bos degilse `namespace`
  // de onun ilk elemanidir, yani tek namespace'li cagrilarda davranis ayni.
  for (const ns of namespaces.length ? namespaces : [namespace]) {
    await catalog.assertNamespaceAllowed({ env, tenant, clusters, namespace: ns, user });
  }
  if (apps.length)
    await catalog.assertAppsAllowed({ env, tenant, clusters, namespace, apps, user });

  return { user, env, tenant, namespace, namespaces, clusters, apps };
}

// ── ON KONTROL BELLEGI (2026-10-13) ─────────────────────────────────────────
//
// OLCUM (prod.app.log, 13 baslatma): `POST /discover` ortalama 2 694 ms — AWX isi
// kuyruga GIRMEDEN once. Sebep: her baslatma once AWX'teki TUM sablon listesini sayfa
// sayfa cekiyordu (`template-preflight.findTemplate` -> `listTemplatesForServer`),
// sonra anket tanimini soruyor, sonra isi baslatiyordu.
//
// Artik TEK sablon okunur ve "degisken kabul ediyor" karari kisa sure hatirlanir.
//   * YALNIZCA OLUMLU karar hatirlanir. "Kapali" hatirlanmaz: admin kutuyu isaretledigi
//     anda kullanicinin sonraki denemesi gecmeli.
//   * Okunamayan ayar hatirlanmaz ve BLOKLAMAZ (eski kontrolle ayni: fail-open).
//   * EMNIYET AGI: bellek bayatken admin "Prompt on launch"i kapatirsa AWX degiskenleri
//     sessizce yutar. Baslatma yaniti bunu `ignored_fields` ile SOYLER; o durumda is
//     iptal edilir, bellek silinir ve ayni 409 doner (asagida).
const ONKONTROL_TTL_MS = 5 * 60 * 1000;
const ONKONTROL_BELLEK = new Map();
const onkontrolAnahtari = (serverId, templateId) => `${Number(serverId)}:${Number(templateId)}`;

async function assertSablonDegiskenKabulEdiyor(serverId, templateId, extraVars, { label }) {
  if (!extraVars || typeof extraVars !== 'object' || Object.keys(extraVars).length === 0) return;
  const k = onkontrolAnahtari(serverId, templateId);
  if ((ONKONTROL_BELLEK.get(k) || 0) > Date.now()) return;
  let ayar;
  try {
    ayar = await runner.getTemplateLaunchSettingsOnServer(serverId, templateId);
  } catch {
    return; // ayar okunamadi -> fail-open, HATIRLANMAZ
  }
  if (ayar.askVariablesOnLaunch === false) {
    throw templatePreflight.promptKapaliHatasi({
      templateId,
      templateName: ayar.name,
      label,
      degiskenSayisi: Object.keys(extraVars).length,
    });
  }
  if (ayar.askVariablesOnLaunch === true) ONKONTROL_BELLEK.set(k, Date.now() + ONKONTROL_TTL_MS);
}

async function launchOnAwx({ keyName, extraVars, req, label }) {
  const { templateId, serverId } = await resolveByKey(keyName);
  // "Prompt on launch > Variables" kapaliysa AWX gonderdigimiz her seyi SESSIZCE yutar,
  // HTTP 201 doner ve playbook survey varsayilanlariyla calisir. Bu tuzak bu kurumda
  // uretimde yasandi; is BASLATILMADAN once kesiliyor.
  await assertSablonDegiskenKabulEdiyor(serverId, templateId, extraVars, { label });
  const job = await runner.launchJobOnServer(
    serverId,
    templateId,
    extraVars,
    '',
    req.session?.user,
    // Anket tanimi kisa sure hatirlansin (her baslatmada bir AWX cagrisi daha).
    { anketBellegi: true },
  );
  // EMNIYET AGI: AWX degiskenleri YOK SAYDIYSA is yanlis girdiyle kosuyor demektir.
  const yutulan = (job.ignoredFields || []).filter((ad) => String(ad).startsWith('extra_vars'));
  if (yutulan.length) {
    ONKONTROL_BELLEK.delete(onkontrolAnahtari(serverId, templateId));
    await runner
      .cancelJobOnServer(serverId, job.jobId)
      .catch((e) => console.warn(`[ScaleX] yutulan degiskenli is #${job.jobId} iptal edilemedi:`, e.message));
    throw templatePreflight.promptKapaliHatasi({
      templateId,
      templateName: '',
      label,
      degiskenSayisi: yutulan.length,
    });
  }
  rememberJobOwner(serverId, job.jobId, currentUser(req).username);
  try {
    await db.query(
      `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, started_at, params)
       VALUES ($1,$2,$3,$4,$5,$6,GETUTCDATE(),$7)`,
      [
        currentUser(req).username,
        serverId,
        templateId,
        label.slice(0, 500),
        job.jobId,
        job.status,
        JSON.stringify({ label }),
      ],
    );
  } catch (e) {
    // Gecmis kaydi yazilamadi — is ZATEN BASLADI, geri alinamaz. Sessizce yutmak yerine
    // logluyoruz; sahiplik kontrolu bellek-ici yedege duser.
    console.warn('[ScaleX] ansible_job_history yazilamadi:', e.message);
  }
  return { serverId, templateId, jobId: job.jobId, status: job.status };
}

// `capabilities` isinin extra_vars'i. `/discover` (Admin > Tara) ile arka plan
// tazeleyicisi AYNI bicimi kullanir: iki kopya, birinde yapilan duzeltmenin
// digerinde sessizce eskimesi demekti.
async function capabilitiesExtraVars({ env, tenant, clusters }) {
  const admin = require('../logx/v2/admin.cjs');
  return {
    scalex_clusters_override: launch.buildScaleXClusterCatalog({
      env,
      tenant,
      clusters,
      hosts: (await admin.resolveTerminalHosts(env, tenant, clusters)).hosts,
      meta: await admin.resolveClusterMeta(env, tenant, clusters),
    }),
    target_platform: tenant,
    target_environment: env,
    target_namespace: '',
    scalex_target_clusters: clusters,
    discovery_mode: 'capabilities',
  };
}

// Arka plan izleyicisinin AWX/DB baglantilari.
function capsDeps() {
  return {
    list: (q) => clusterCaps.list(q),
    getStatus: (serverId, jobId) => runner.getJobStatusOnServer(serverId, jobId),
    parse: (artifacts) => result.extractDiscoveryResult(artifacts),
    save: (rec) => clusterCaps.save(rec),
  };
}

function initScaleX(app) {
  const express = require('express');
  const router = express.Router();

  let requireAuth = (req, res) => res.status(401).json({ ok: false, message: 'Auth modülü yok.' });
  try {
    const authMod = require('../auth/index.cjs');
    if (typeof authMod.requireAuth === 'function') requireAuth = authMod.requireAuth;
  } catch {
    /* auth yoksa deny kalir */
  }

  router.use(express.json({ limit: '512kb' }));
  router.use(requireAuth);
  try {
    router.use(require('../auth/visibility.cjs').requireVisiblePrefix('ScaleX'));
  } catch {
    /* gorunurluk motoru yoksa auth tek basina korur */
  }

  // ── Ayarlar — EKRANIN SINIRLARI SUNUCUDAN OGRENMESI ──────────────────────
  //
  // Sinirlar admin ekranindan degisebiliyor (bkz. server/scalex/config.cjs). Ekran
  // onlari ELDE tutsaydi, admin 300'u 600 yaptiginda kullanici hala "30-3600 arasi"
  // gorur, girdigi degeri sunucu reddeder ve sebebi hicbir yerde YAZMAZDI.
  // Bu uc her istekte GUNCEL degeri doner — onbellege ALINMAZ.
  //
  // GIZLI BILGI YOK: yalnizca sinirlar. `problems` de burada, cunku tutarsiz bir
  // ayari GIZLEMEK ekranin anlamsiz bir aralik gostermesi demekti.
  router.get(
    '/config',
    asyncRoute(async (_req, res) => {
      res.json({ ok: true, ...require('./config.cjs').publicConfig() });
    }),
  );

  // ── Katalog ───────────────────────────────────────────────────────────────
  router.get(
    '/clusters',
    asyncRoute(async (req, res) => {
      res.json({ ok: true, tree: await catalog.getClusterTree() });
    }),
  );

  router.get(
    '/namespaces',
    asyncRoute(async (req, res) => {
      const env = String(req.query.env || '').trim();
      const tenant = String(req.query.tenant || '').trim();
      const clusters = String(req.query.clusters || '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      if (!env || !tenant || !clusters.length) {
        throw Object.assign(new Error('env, tenant ve clusters zorunlu.'), { status: 400 });
      }
      res.json({
        ok: true,
        ...(await catalog.getNamespaces({
          env,
          tenant,
          clusterNames: clusters,
          user: currentUser(req),
        })),
      });
    }),
  );

  // UYGULAMA LISTESI — ANINDA, AWX'e HIC DOKUNMADAN.
  //
  // Ad/tip listesi paylasilan katalogdan (`dbo.Openshift_Inventory` ∪ `ocp_app_cache`)
  // geliyor; ekran bunu beklemeden aciyor. CANLI veri (replica, HPA, GitOps, durum)
  // BU UCTAN GELMEZ — onlar icin `/discover` calisir ve ekran sutunlari sonradan
  // doldurur. Bayat bir replica sayisi ya da `restorable` bayragi YANLIS ISLEM demek.
  router.get(
    '/apps',
    asyncRoute(async (req, res) => {
      const env = String(req.query.env || '').trim();
      const tenant = String(req.query.tenant || '').trim();
      const namespace = String(req.query.namespace || '').trim();
      const clusters = String(req.query.clusters || '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      if (!env || !tenant || !namespace || !clusters.length) {
        throw Object.assign(new Error('env, tenant, namespace ve clusters zorunlu.'), {
          status: 400,
        });
      }
      // Namespace adi `oc` komut satirina GITMIYOR ama katalog sorgusuna giriyor;
      // yine de calistirma yoluyla AYNI format kurallarindan gecsin.
      launch.assertValidDiscoveryTargets({ namespace });
      const user = currentUser(req);
      // Namespace yetkisi ONCE: goremedigi bir namespace'in uygulama adlarini
      // listelemek, adlarin kendisini sizdirmak olurdu.
      await catalog.assertClustersExist({ env, tenant, clusters });
      await catalog.assertNamespaceAllowed({ env, tenant, clusters, namespace, user });
      res.json({
        ok: true,
        ...(await catalog.listApps({ env, tenant, clusterNames: clusters, namespace, user })),
      });
    }),
  );

  // ── Kesif (salt okunur) ───────────────────────────────────────────────────
  router.post(
    '/discover',
    eylemRoute(async (req, res) => {
      const mode = ['workloads', 'state', 'health', 'capabilities'].includes(req.body?.mode)
        ? req.body.mode
        : 'workloads';
      const { env, tenant, namespace, namespaces, clusters, apps } = await resolveScope(req, {
        requireApps: mode === 'health',
      });
      // ── COK NAMESPACE YALNIZCA `workloads` ve `state`TE ──────────────────────
      //
      // `health` satirlari (PODS/EVENTS) SERBEST METIN tasiyor ve namespace
      // alani yok; cok namespace'li bir saglik kesfinde satirlar hangi
      // namespace'e ait oldugu ANLASILMAZ hale gelirdi. `capabilities` ise
      // cluster duzeyi — namespace'e hic girmiyor.
      //
      // Sessizce ilkine dusmek yerine REDDEDILIYOR: sessiz daralma, kullanicinin
      // taradigini sandigi namespace'lerin hic taranmamasi demekti.
      const ekNamespaceVar = namespaces.length > 1;
      if (ekNamespaceVar && mode !== 'workloads' && mode !== 'state') {
        throw Object.assign(
          new Error(
            `Çoklu namespace yalnızca 'workloads' ve 'state' keşfinde desteklenir (mode=${mode}).`,
          ),
          { status: 400 },
        );
      }
      // Kesif de bu degerleri playbook'a, oradan `oc` komut satirina tasiyor — `/preview`
      // ve `/run` ile AYNI format kurallari burada da gecerli (bkz. launch.cjs basligi).
      // `mode` GECILIR: `capabilities` cluster duzeyi bir taramadir ve namespace istemez.
      launch.assertValidDiscoveryTargets({ namespace, apps, mode });
      // CLUSTER YETENEK ONBELLEGI — kesifteki ~50 `oc get --raw` cagrisini atlatir.
      //
      // UC DURUM AYRI (bkz. cluster-caps.cjs): guvenilir bir kayit YOKSA
      // (hic taranmamis / okunamamis / kapsamin bir kismi eksik) BOS gecilir ve
      // betik ESKI yolu kosar. "Onbellek yok"u "CRD yok" saymak, olceklenebilir
      // operator nesnelerini SESSIZCE listeden dusurmek olurdu.
      //
      // `capabilities` modunda BILEREK okunmaz: o mod onbellegi URETIR,
      // tuketmez. Aksi halde bayat bir liste kendini sonsuza dek dogrularadi.
      //
      // IKI BICIM BIRDEN GONDERILIR:
      //   `scalex_cluster_kinds` → CLUSTER BASINA sozluk (yeni, asil yol)
      //   `scalex_extra_kinds`   → tek birlesik liste (ESKI paketler icin)
      // Yeni playbook sozluk geldiginde YALNIZCA onu okur; birlesik listeye
      // DUSMEZ. Dusseydi, sozlukte olmayan cluster baskasinin listesiyle
      // sinirlanirdi — kismi onbellegin asil tehlikesi tam olarak buydu.
      // ── BAGIMSIZ OKUMALAR AYNI ANDA (2026-10-13) ─────────────────────────────
      //
      // Bes okuma (iki yetenek onbellegi, jump server, cluster ayrintisi, canli
      // yoklama listesi) birbirinden BAGIMSIZ ama sirayla bekleniyordu; her biri bir
      // DB turu. Kurallar AYNEN duruyor: yetenek ve yoklama okumalari BEST-EFFORT
      // (dusen okuma kesfi DUSURMEZ, yalnizca hizlandirmaz), jump server ve cluster
      // ayrintisi ZORUNLU (dusen okuma istegi dusurur).
      const admin = require('../logx/v2/admin.cjs');
      const [bulunan, clusterKinds, terminal, meta, liveProbe] = await Promise.all([
        // `kindsForScope` kapsamin TAMAMI icin guvenilir kayit ister.
        mode === 'capabilities'
          ? null
          : clusterCaps.kindsForScope({ env, tenant, clusterNames: clusters }).catch((e) => {
              console.warn('[ScaleX] yetenek onbellegi okunamadi, tam tarama:', e.message);
              return null;
            }),
        // AYRI OKUMA, AYRI KURAL: harita her cluster'i KENDI kaydiyla degerlendirir;
        // eksik olan yalnizca kendisi soguk yolu kosar.
        mode === 'capabilities'
          ? {}
          : clusterCaps.kindsPerCluster({ env, tenant, clusterNames: clusters }).catch((e) => {
              console.warn('[ScaleX] cluster basina yetenek haritasi okunamadi:', e.message);
              return {};
            }),
        admin.resolveTerminalHosts(env, tenant, clusters),
        admin.resolveClusterMeta(env, tenant, clusters),
        // CANLI YOKLAMA LISTESI — yalnizca `state` kesfinde. LISTEYI SUNUCU DOLDURUR,
        // ISTEMCI DEGIL: karar icin gereken TAM liste aynadadir. `target_app_names`DEN
        // AYRI: o degisken ConfigMap listelemesini de suzuyor; bu listeyle suzseydik
        // cluster'da durdurulmus ama portalda kaydi OLMAYAN uygulamalar gorunmez olurdu.
        mode !== 'state'
          ? []
          : state
              .listMirror({ env, tenant })
              .then((rows) => [
                ...new Set(
                  rows
                    .filter((r) => clusters.includes(r.clusterName) && r.namespace === namespace)
                    .map((r) => r.appName),
                ),
              ])
              .catch((e) => {
                // BEST-EFFORT: uretilemezse kesif YINE KOSAR, yalnizca "ayakta mi"
                // sorusu cevapsiz kalir.
                console.warn('[ScaleX] canli yoklama listesi uretilemedi:', e.message);
                return [];
              }),
      ]);
      // IKI BICIM BIRDEN GONDERILIR:
      //   `scalex_cluster_kinds` -> CLUSTER BASINA sozluk (yeni, asil yol)
      //   `scalex_extra_kinds`   -> tek birlesik liste (ESKI paketler icin)
      // "Onbellek yok"u "CRD yok" saymak, olceklenebilir operator nesnelerini SESSIZCE
      // listeden dusurmek olurdu; guvenilir kayit YOKSA bos gecilir ve betik tam tarar.
      const extraKinds = bulunan && bulunan.length ? bulunan.join(',') : '';

      const extraVars = {
        scalex_clusters_override: launch.buildScaleXClusterCatalog({
          env,
          tenant,
          clusters,
          hosts: terminal.hosts,
          meta,
        }),
        target_platform: tenant,
        target_environment: env,
        target_namespace: namespace,
        // EK NAMESPACE'LER — yalnizca BIRDEN FAZLA varsa gonderilir.
        ...(ekNamespaceVar ? { scalex_target_namespaces: namespaces } : {}),
        scalex_target_clusters: clusters,
        discovery_mode: mode,
        ...(apps.length ? { target_app_names: apps.join(',') } : {}),
        ...(extraKinds ? { scalex_extra_kinds: extraKinds } : {}),
        // BOS SOZLUK HIC GONDERILMEZ: gonderseydik yeni playbook "portal sozluk
        // yolluyor" deyip birlesik listeyi de yok sayar ve elde HICBIR onbellek
        // kalmazdi. Emsal: `scalex_cluster_apps` (PR #123).
        ...(Object.keys(clusterKinds).length
          ? {
              scalex_cluster_kinds: Object.fromEntries(
                Object.entries(clusterKinds).map(([c, k]) => [c, k.join(',')]),
              ),
            }
          : {}),
        ...(liveProbe.length ? { scalex_live_probe_apps: liveProbe.join(',') } : {}),
      };
      const job = await launchOnAwx({
        keyName: DISCOVERY_KEY,
        extraVars,
        req,
        label: `ScaleX keşif (${mode}) — ${namespace}`,
      });

      // ── YETENEK ONBELLEGI: ARKA PLANDA, KULLANICI BEKLEMEZ ─────────────────
      //
      // Kesif artik ekstra CRD'leri ENUMERE ETMIYOR (cluster basina ~50 `oc get
      // --raw`, uretimde 11-15 sn). Kaydi olmayan ya da bayat cluster'lar icin
      // ayri bir `capabilities` isi baslatilir ve sonucu SUNUCU izler. Donusu
      // BEKLENMEZ ve hicbir hatasi bu istegi dusurmez. Kullanicinin isi ONCE
      // baslatildi: AWX kuyrugunda arka plan isi onun onune gecemez.
      const scannedBy = currentUser(req).username;
      if (mode === 'workloads') {
        capsRefresh
          .arkaPlandaTazele({
            env,
            tenant,
            clusters,
            scannedBy,
            deps: {
              ...capsDeps(),
              launch: async (hedefler) =>
                launchOnAwx({
                  keyName: DISCOVERY_KEY,
                  extraVars: await capabilitiesExtraVars({ env, tenant, clusters: hedefler }),
                  req,
                  label: 'ScaleX yetenek taraması (arka plan)',
                }),
            },
          })
          .catch(() => {});
      }
      // ADMIN > TARA: sonuc eskiden YALNIZCA `/status` yoklandiginda yaziliyordu
      // ve o dugmeden sonra hicbir sey yoklamiyordu — tarama yapiliyor, sonuc
      // tabloya HIC yazilmiyordu. Artik sunucu izler.
      if (mode === 'capabilities') {
        capsRefresh
          .izleVeKaydet({
            serverId: job.serverId,
            jobId: job.jobId,
            scannedBy,
            deps: capsDeps(),
          })
          .catch((e) => console.warn('[ScaleX] yetenek taramasi izlenemedi:', e.message));
      }
      // KAPSAM HATIRLANIR: is bittiginde sonucun paylasilan uygulama katalogunu
      // besleyip beslemeyecegine bu belirliyor. `full` yalnizca uygulama listesi
      // GONDERILMEDIGINDE true — daraltilmis bir kesfi katalog yazimi saymak,
      // secilmeyen uygulamalari silinmis isaretlerdi (bkz. rememberDiscoveryScope).
      rememberDiscoveryScope(job.serverId, job.jobId, {
        env,
        tenant,
        namespace,
        namespaces,
        clusters,
        mode,
        full: apps.length === 0,
      });

      // IZ: kesif salt-okunur ama YINE DE kullanici girdisini (`namespace`,
      // `target_app_names`) AWX uzerinden `oc` komut satirina tasiyor. Denetim kaydi
      // olmadan "bu namespace'i kim taratti" sorusu yanitlanamiyordu.
      auditPortal(req, 'scalex_discovery', {
        detail: JSON.stringify({ env, tenant, clusters, namespace, apps, mode, jobId: job.jobId }),
      });
      res.json({ ok: true, mode, ...job });
    }),
  );

  // ── NAMESPACE TARAMASI (canli) ─────────────────────────────────────────────
  //
  // ScaleX namespace listesini YALNIZCA katalogdan okuyordu: `dbo.Openshift_Inventory`
  // (zamanlanmis is) ∪ `ocp_namespace_cache` (kullanici taramalari). Envanter gecikmeli
  // yazildigi icin YENI acilmis bir namespace ScaleX'te HIC gorunmuyordu ve kullanicinin
  // yapabilecegi bir sey yoktu — LogX'te "Bu namespace'i tara" dugmesi VARDI, ScaleX'te
  // yoktu.
  //
  // AYNI PLAYBOOK, AYNI ONBELLEK: `logx_ocp_namespace_discovery` calisir ve sonuc
  // PAYLASILAN `ocp_namespace_cache`e yazilir (bkz. ocp.cacheNamespaceDiscovery).
  // Yani ScaleX'ten yapilan tarama LogX'i de besler, tersi de gecerli. Mimari
  // DEGISMEDI: `dbo.Openshift_Inventory` birincil kaynak olmaya devam ediyor ve
  // portal ona YAZMIYOR (bkz. docs/OCP-NAMESPACE-KATALOGU-KARARI.md).
  router.post(
    '/namespaces/discover',
    eylemRoute(async (req, res) => {
      const b = req.body || {};
      const env = String(b.env || '').trim();
      const tenant = String(b.tenant || '').trim();
      const clusters = [
        ...new Set(
          (Array.isArray(b.clusters) ? b.clusters : [])
            .map((c) => String(c).trim())
            .filter(Boolean),
        ),
      ];
      if (!env || !tenant)
        throw Object.assign(new Error('env ve tenant zorunlu.'), { status: 400 });
      if (!clusters.length)
        throw Object.assign(new Error('En az bir cluster seçilmeli.'), { status: 400 });
      // Namespace HENUZ YOK — taranacak olan o. Bu yuzden `assertNamespaceAllowed`
      // cagrilamaz; kapi cluster duzeyinde kurulur. Namespace bazli yetki, listeyi
      // OKURKEN uygulanmaya devam ediyor (catalog.getNamespaces → restrictions),
      // yani tarama kisitli bir namespace'i kullaniciya GORUNUR yapmaz.
      await catalog.assertClustersExist({ env, tenant, clusters });

      const admin = require('../logx/v2/admin.cjs');
      const ocp = require('../logx/v2/ocp.cjs');
      const extraVars = {
        ...ocp.buildOcpExtraVars({
          env,
          tenant,
          clusters,
          hosts: (await admin.resolveTerminalHosts(env, tenant, clusters)).hosts,
          meta: await admin.resolveClusterMeta(env, tenant, clusters),
        }),
        ...ocp.buildOcpRuntimeVars(
          await require('../logx/v2/ocp-runtime-config.cjs')
            .getConfig()
            .catch(() => ({})),
        ),
      };

      const job = await launchOnAwx({
        keyName: 'logx_ocp_namespace_discovery',
        extraVars,
        req,
        label: `ScaleX namespace taraması — ${tenant}/${env}`,
      });
      auditPortal(req, 'scalex_namespace_discovery', {
        detail: JSON.stringify({ env, tenant, clusters, jobId: job.jobId }),
      });
      res.json({ ok: true, ...job });
    }),
  );

  router.get(
    '/namespaces/discover/:serverId/:jobId/status',
    asyncRoute(async (req, res) => {
      const serverId = Number(req.params.serverId);
      const jobId = Number(req.params.jobId);
      const denied = await denyIfNotOwner(req, serverId, jobId);
      if (denied) return res.status(denied.status).json({ ok: false, message: denied.message });
      const env = String(req.query.env || '').trim();
      const tenant = String(req.query.tenant || '').trim();

      const status = await runner.getJobStatusOnServer(serverId, jobId);

      // ONBELLEGE YAZMA BURADA — AYRI BIR UC DEGIL. Istemciye "tarama bitti, simdi
      // de sonucu kaydet" diye ikinci bir cagri yaptirmak, o cagriyi unutan ya da
      // sekmesini kapatan her kullanicida sonucun SESSIZCE kaybolmasi demekti.
      // (`refreshDrift` ve `rbacFindings.record` ile ayni gerekce.)
      let clusters = [];
      if (status.finished && status.artifacts && env && tenant) {
        try {
          const normalized = await require('../logx/v2/ocp.cjs').cacheNamespaceDiscovery({
            env,
            tenant,
            artifacts: status.artifacts,
          });
          clusters = normalized.clusters || [];
          auditPortal(req, 'scalex_namespace_discovery_result', {
            result: clusters.some((c) => c.status === 'ok') ? 'ok' : 'fail',
            detail: JSON.stringify({
              serverId,
              jobId,
              clusters: clusters.map((c) => ({
                cluster: c.cluster_name,
                status: c.status,
                count: (c.namespaces || []).length,
              })),
            }),
          });
        } catch (e) {
          // Onbellek yazimi BEST-EFFORT; tarama sonucu bu yuzden gizlenmez.
          console.warn('[ScaleX] namespace taramasi onbellege yazilamadi:', e.message);
        }
      }

      res.json({
        ok: true,
        status: status.status,
        finished: status.finished,
        failed: status.failed,
        // Cluster basina durum + HATA METNI: "hicbiri taranamadi" ile "namespace yok"
        // ayni ekran degildir (bkz. PR #66).
        clusters: clusters.map((c) => ({
          cluster: c.cluster_name,
          status: c.status,
          count: (c.namespaces || []).length,
          error: c.error || '',
        })),
        message: status.errorMessage || undefined,
      });
    }),
  );

  router.get(
    '/discover/:serverId/:jobId/status',
    asyncRoute(async (req, res) => {
      const serverId = Number(req.params.serverId);
      const jobId = Number(req.params.jobId);
      const denied = await denyIfNotOwner(req, serverId, jobId);
      if (denied) return res.status(denied.status).json({ ok: false, message: denied.message });
      // IS BITMEDEN STDOUT INDIRILMEZ.
      //
      // Bu uc her 3 saniyede bir yoklaniyor ve her yoklamada isin stdout'unun
      // TAMAMI indiriliyordu. Oysa kesif yolunda ciktiyi OKUYAN KIMSE YOK: uc
      // cagiran da (`WorkloadStep.poll`, `ScaleXPage` saglik dongusu,
      // `StoppedPanel` tarama dongusu) `finished` gelene kadar yanitin geri
      // kalanini atiyor. Yani 60 saniyelik bir kesifte ~20 kez MB'larca metin
      // indirilip cope atiliyordu — hem AWX'i hem portali yavaslatan, HICBIR
      // seye yaramayan bir maliyet.
      //
      // BITMIS ISTE DE INDIRILMEZ (2026-10). Uc cagiran da yalnizca `finished`
      // ve `result` okuyor; sonuc `set_stats` artifact'indan (`status.artifacts`)
      // geliyor. Bitmis iste tam cekim YANITI BEKLETIYORDU: kullanici sonucu,
      // kimsenin okumadigi bir indirme bitene kadar goremiyordu (AWX stdout
      // indirmesi uretimde ortalama ~20 sn olculdu, bkz. runner.cjs
      // `getJobOutputOnServer`). Bu bekleme AWX isinin DISINDA oldugu icin
      // Admin > Kesif suresi kirilimi onu gostermez. Ciktiya ihtiyac duyan
      // AWX arayuzunden isin ciktisina bakar.
      const status = await runner.getJobStatusOnServer(serverId, jobId);
      const parsed = result.extractDiscoveryResult(status.artifacts);

      // ── YANIT ONCE, DEFTER ISLERI SONRA (2026-10-13) ───────────────────────
      //
      // Is bittiginde bu uc alti ayri kayit yaziyordu (denetim, RBAC bulgulari, sure
      // olcumu, sapma, yetenek envanteri, uygulama katalogu) ve YANITI hepsi bitene
      // kadar bekletiyordu: kullanici, sonucu zaten elde olan bir kesfin ekranini
      // birkac DB turu daha bekliyordu (prod.app.log: `GET /discover` ort. 1,7 sn).
      // Ustelik uc her yoklamada yeniden kostugu icin ayni kayitlar tekrar yaziliyor,
      // denetime ayni sonuc birden cok kez dusuyordu.
      //
      // TEK ISTISNA sapma tazelemesi (`state` kipi): "Su an durdurulmus" paneli
      // `finished`i gorur gormez listeyi yeniden okuyor; tazeleme yanittan SONRA
      // bitseydi panel bir onceki taramanin isaretlerini gosterirdi. O yuzden beklenir.
      // SAPMA TAZELEME BURADA. `state` kesfi bittiginde portal aynasini cluster gercegiyle
      // karsilastirip `drift_status`u guncelliyoruz.
      //
      // NEDEN AYRI BIR UC DEGIL: `/run/:s/:j/status` de ayni sekilde `finalizeOperation`
      // cagiriyor. Istemciye "kesif bitti, simdi de sapmayi tazele" diye ikinci bir cagri
      // yaptirmak, o cagriyi unutan/sekmesini kapatan her kullanicida sapmanin SESSIZCE
      // guncellenmemesi demekti — ki bu ozelligin ilk halinde tam olarak boyle oldu:
      // `refreshDrift` yazildi, test edildi ve HICBIR YERDEN CAGRILMADI.
      if (status.finished && parsed && parsed.mode === 'state') {
        try {
          await state.refreshDrift({
            env: parsed.environment,
            tenant: parsed.platform,
            scannedClusters: parsed.clusters || [],
            clusterStates: (parsed.states || []).map((st) => ({
              env: parsed.environment,
              tenant: parsed.platform,
              clusterName: st.cluster,
              // SATIR BASINA: tek bir `parsed.namespace`, cok namespace'li bir iste
              // sapma isaretlerini YANLIS namespace'e yazardi.
              namespace: st.namespace || parsed.namespace,
              appName: st.appName,
              previousReplicas: st.previousReplicas,
              phase: st.phase,
              stoppedBy: st.createdBy,
              workloadKind: st.kind,
              legacy: st.legacy,
            })),
            // CANLI REPLICA: "ConfigMap yok" ile "uygulama kapali" ayri sorular.
            liveStates: (parsed.live || []).map((lv) => ({
              env: parsed.environment,
              tenant: parsed.platform,
              clusterName: lv.cluster,
              namespace: lv.namespace || parsed.namespace,
              appName: lv.appName,
              readyReplicas: lv.readyReplicas,
              workloadAbsent: lv.workloadAbsent,
            })),
          });
        } catch (e) {
          // Sapma tazelenemedi — kesif sonucunu GIZLEME. Kullanici listeyi yine gorur,
          // yalnizca sapma isaretleri bir onceki taramadan kalir.
          console.warn('[ScaleX] sapma tazelenemedi:', e.message);
        }
      }

      // Defter isleri IS BASINA BIR KEZ ve yanittan SONRA. Hicbiri kesfin sonucunu
      // degistirmez; hepsi best-effort (her biri kendi hatasini yutar ve loglar).
      const defterIsleri = async () => {
        // KESIF SONUCU DENETIME. Baslatma ani zaten yaziliyordu (`scalex_discovery`) ama
        // NE KESFEDILDIGI hicbir yere yazilmiyordu: is bittikten sonra AWX retention'i
        // dolunca sonuc tamamen kayboluyordu. Ozet yeterli — ham satirlar denetim
        // kaydinin 2000 karakterlik `detail` sinirini zaten asardi.
        if (status.finished) {
          auditPortal(req, 'scalex_discovery_result', {
            result: parsed && parsed.overallStatus === 'error' ? 'fail' : 'ok',
            detail: JSON.stringify({
              serverId,
              jobId,
              mode: parsed ? parsed.mode : null,
              overallStatus: parsed ? parsed.overallStatus : null,
              namespace: parsed ? parsed.namespace : null,
              namespaces: parsed ? parsed.namespaces : [],
              clusters: parsed ? parsed.clusters : [],
              failedClusters: parsed ? parsed.failedClusters : [],
              counts: parsed ? parsed.counts : null,
              workloads: parsed && parsed.workloads ? parsed.workloads.length : undefined,
              states: parsed && parsed.states ? parsed.states.length : undefined,
            }),
          });
        }

        // OKUNAMAYAN TIPLER BIRIKTIRILIR. Kesif bunlari zaten raporluyordu ama rapor
        // yalnizca O ANKI kullanicinin ekraninda kaliyordu: ayni talep platform ekibine
        // tekrar tekrar aciliyor, hangi namespace'te neyin eksik oldugu hicbir yerde
        // toplu durmuyordu. `refreshDrift` ile AYNI gerekce: istemciye ikinci bir cagri
        // yaptirmak, sekmesini kapatan her kullanicida kaydin sessizce dusmesi demekti.
        if (status.finished && parsed && parsed.mode === 'workloads') {
          try {
            // SATIR BASINA NAMESPACE: tablo `UNIQUE(env,tenant,cluster,namespace,kind)`.
            // Tek bir `parsed.namespace` gecmek, cok namespace'li bir iste B
            // namespace'inin eksiklerini A'nin satirina yazmak olurdu.
            await rbacFindings.record({
              env: parsed.environment,
              tenant: parsed.platform,
              namespace: parsed.namespace,
              kindReports: (parsed.kindReports || []).map((k) => ({
                ...k,
                namespace: k.namespace || parsed.namespace,
              })),
            });
          } catch (e) {
            // Birikim BEST-EFFORT: yazilamadiysa kesif sonucu GIZLENMEZ. Bu bir denetim
            // kaydi degil, bir kolaylik; DB tokezlemesi calisan bir kesfi dusurmemeli.
            console.warn('[ScaleX] RBAC bulgulari kaydedilemedi:', e.message);
          }
        }

        // SURE OLCUMU KAYDEDILIR — HER MODDA.
        //
        // `workloads` ile sinirlandirilmadi: `capabilities` taramasi kesfin en
        // pahali iki kalemini ONCEDEN hesaplayan mod ve onun maliyeti de tam
        // olarak olculmesi gereken sey. `state`/`health` de ayni AWX + login
        // sabit maliyetini odyor; yalnizca birini olcmek, tabanin yarisini
        // gormemek olurdu.
        if (status.finished && parsed && (parsed.timing || []).length) {
          try {
            await discoveryTiming.record({
              env: parsed.environment,
              tenant: parsed.platform,
              namespace: parsed.namespace,
              timing: parsed.timing,
              awxJobId: jobId,
              // Is duzeyi kirilim: AWX zamanlari + playbook paylari.
              job: { created: status.created, started: status.started, finished: status.finished },
              playbookTiming: parsed.playbookTiming,
            });
          } catch (e) {
            // BEST-EFFORT: olcum yazilamadiysa kesif sonucu GIZLENMEZ.
            console.warn('[ScaleX] kesif suresi kaydedilemedi:', e.message);
          }
        }

        // YETENEK ENVANTERINI YAZ — `capabilities` modunda.
        //
        // Her cluster AYRI satira yazilir: tek bir birlesik liste yazmak, bir
        // cluster'da OLMAYAN bir CRD'yi orada VARMIS gibi gostermek olurdu.
        //
        // OKUNAMAMIS tarama da yazilir ama `resourcesReadable: false` ile — o
        // satir ekranda gorunur (admin "burada yetki eksik" der) ama kesfi
        // HIZLANDIRMAK icin KULLANILMAZ.
        // MODA DEGIL SATIRA BAKILIR: paket v18-20'nin `workloads` kesfi de soguk
        // yolda yetenek satirlari basiyordu (v21 basmaz; onbellegi arka plan isi
        // doldurur). AWX'te eski paket kosarken o satirlar yok sayilmasin.
        if (status.finished && parsed && (parsed.capabilities || []).length) {
          try {
            await capsRefresh.kaydetYetenekler(parsed, {
              save: (rec) => clusterCaps.save(rec),
              scannedBy: currentUser(req).username,
              awxJobId: jobId,
            });
          } catch (e) {
            // BEST-EFFORT: yazilamadiysa tarama sonucu GIZLENMEZ; yalnizca bir
            // sonraki kesif hizlanmaz.
            console.warn('[ScaleX] yetenek envanteri yazilamadi:', e.message);
          }
        }

        // KATALOGU BESLE — YALNIZCA TAM NAMESPACE TARAMASINDA.
        //
        // Kullanicinin istegi: "her kesfi db ye yaz bir kere, db de olani oradan oku".
        // Yazilan sey YALNIZCA KIMLIK: ad + tip. Replica/image/HPA gibi CANLI alanlar
        // BILEREK `null` gecilir — bayat bir replica sayisi yanlis isleme, bayat bir
        // `restorable` bayragi `STATE;FAIL` ile dusen bir ise yol acar (R2 bekcisinin
        // gerekcesi). Katalog "bu namespace'te ne var" sorusunu cevaplar, "su anda ne
        // durumda" sorusunu DEGIL.
        //
        // DARALTILMIS KESIF YAZILMAZ: `putApps` gorulmeyen uygulamalari is_deleted=1
        // yapar; 1 uygulamalik bir kesfi yazmak kalan 49'u silerdi.
        const kapsam = DISCOVERY_SCOPE_CACHE.get(`${serverId}:${jobId}`);
        if (status.finished && parsed && parsed.mode === 'workloads' && kapsam && kapsam.full) {
          try {
            // ── ANAHTAR (CLUSTER, NAMESPACE) ─────────────────────────────────
            //
            // Bir is artik birden fazla namespace tarayabiliyor. Gruplamayi
            // yalnizca cluster'a gore yapip tek bir `parsed.namespace` yazmak, B
            // namespace'inin is yuklerini A altina yazmak demekti — ve `putApps`
            // gorulmeyen uygulamalari `is_deleted=1` yaptigi icin B'nin katalogu
            // KOMPLE SILINIRDI. Bu depoda en pahali hata sinifi olan "sessiz
            // eksik"in en yikici bicimi.
            const basarisiz = new Set(parsed.failedClusters || []);
            const taranan = (parsed.namespaces || []).filter(Boolean);
            const perScope = new Map();
            const anahtar = (c, ns) => `${c}\u0000${ns}`;
            for (const c of parsed.clusters || []) {
              if (basarisiz.has(c)) continue;
              // TARANMIS her namespace icin bir girdi — is yuku BULUNMASA DA.
              // Bos birakmak, "tarandi ve hicbir sey yok" halini yazamamak olurdu
              // ve o namespace'in bayat katalogu sonsuza dek kalirdi.
              for (const ns of taranan) perScope.set(anahtar(c, ns), []);
            }
            for (const w of parsed.workloads || []) {
              const arr = perScope.get(anahtar(w.cluster, w.namespace || parsed.namespace));
              // Taranamayan bir cluster'in ya da taranmamis bir namespace'in satiri
              // olmamali; olduysa da yazmayiz.
              if (arr) arr.push({ name: w.name, kind: w.kind, replicas: null, image: null });
            }
            const entries = [...perScope.entries()].map(([k, objects]) => {
              const [clusterName, namespace] = k.split('\u0000');
              return { clusterName, namespace, status: 'ok', objects };
            });
            if (entries.length) {
              await ocpCache.putApps({
                env: parsed.environment,
                tenant: parsed.platform,
                entries,
                source: 'discovery',
              });
            }
          } catch (e) {
            // BEST-EFFORT: katalog yazilamadiysa kesif sonucu GIZLENMEZ. Kullanici
            // listeyi yine gorur, yalnizca bir sonraki acilis hizlanmaz.
            console.warn('[ScaleX] uygulama katalogu guncellenemedi:', e.message);
          }
        }
      };

      res.json({
        ok: true,
        status: status.status,
        finished: !!status.finished,
        failed: !!status.failed,
        result: parsed,
      });
      if (status.finished && defterBirKez(serverId, jobId)) {
        defterIsleri().catch((e) =>
          console.warn('[ScaleX] kesif defter isleri tamamlanamadi:', e.message),
        );
      }
    }),
  );

  // ── Onizleme — HICBIR SEY TETIKLEMEZ, HICBIR SEY KAYDETMEZ ────────────────
  // Asil karar `/run`da YENIDEN verilir; bu uc yalnizca ekrani besler.
  router.post(
    '/preview',
    eylemRoute(async (req, res) => {
      const { env, tenant, namespace, clusters, apps } = await resolveScope(req);
      const action = String(req.body?.action || 'stop');
      const executionMode = String(req.body?.executionMode || 'dry_run');
      const targetReplicas = req.body?.targetReplicas;
      launch.assertValidTargets({
        namespace,
        apps,
        action,
        targetReplicas,
        executionMode,
        // VARSAYILAN SUNUCU SABITINDEN. Burada ELDE '60' yaziliydi ve PR #98'in
        // 300'e cektigi varsayilani BU UC sessizce eskitiyordu: onizleme bir butce,
        // calistirma baska bir butce gosteriyordu.
        // `launch.VERIFICATION_TIMEOUT_DEFAULT` ARTIK YOK: PR #100 bu satiri yazdi,
        // PR #102 sabitleri getter'a cevirdi. Iki dal FARKLI satirlara dokundugu
        // icin merge temiz gecti — hicbiri tek basina bozuk degildi, BIRLESIMI
        // bozuktu. `String(undefined)` -> "undefined" -> 400. Ustelik bekcinin
        // kendisi bu OLU ADI kilitliyordu (bkz. scalex-verify-timing VT1).
        verificationTimeout:
          req.body?.verificationTimeout ?? String(launch.verifyTimeoutDefault()),
      });
      const selectedTargets = normalizeTargets(req.body?.targets, { clusters, apps });
      const radius = launch.computeBlastRadius({
        clusters,
        apps,
        environment: env,
        action,
        executionMode,
        selectedTargets,
      });
      const { policy, gateCfg } = await resolveGatePolicy(req, {
        action,
        executionMode,
        environment: env,
        tenant,
        clusters,
        namespace,
      });
      res.json({
        ok: true,
        blastRadius: radius,
        gatePolicy: policy,
        // ScaleX sablonu cozulemediyse HICBIR is baslayamaz (on kontrol dahil). Ekran bunu
        // "Calistir"dan once soyler; `/run` ayni metinle reddeder.
        configError: gateCfg.hata
          ? {
              code: gateCfg.hata.status === 501 ? 'scalex_not_configured' : 'config_unreadable',
              message: gateCfg.hata.message,
            }
          : null,
        hpaPinAllowed: launch.isHpaPinAllowed({
          action,
          targetReplicas,
          restoreTargets: req.body?.restoreTargets,
        }),
        targets: { env, tenant, namespace, clusters, apps },
      });
    }),
  );

  // ── Calistirma ────────────────────────────────────────────────────────────
  router.post(
    '/run',
    eylemRoute(async (req, res) => {
      const { user, env, tenant, namespace, clusters, apps } = await resolveScope(req);
      const action = String(req.body?.action || '');
      const executionMode = String(req.body?.executionMode || '');
      const targetReplicas = req.body?.targetReplicas;
      // ELDE YAZILI '60' DEGIL. PR #100 "60 artiklarini temizle" basligiyla gitti
      // ama bekci regex'i yalnizca `verificationTimeout:` NESNE-OZELLIK yazimini
      // yasakliyordu; bu `=` yazimi suzgecten gecti ve ISI GERCEKTEN BASLATAN uc
      // burasi.
      const verificationTimeout =
        req.body?.verificationTimeout ?? String(launch.verifyTimeoutDefault());
      const allowPartial = req.body?.allowPartial !== false;
      const reason = String(req.body?.reason || '').trim();
      // CC kullanicidan gelir ve mail gorevine ulasir — satir sonu/format dogrulanmadan
      // gecerse SMTP baslik enjeksiyonu mumkun olurdu.
      const mailCc = launch.sanitizeMailCc(req.body?.mailCc);
      // Client `hpaPin: true` gonderse bile kurallar SUNUCUDA uygulanir.
      const hpaPin =
        req.body?.hpaPin === true &&
        launch.isHpaPinAllowed({
          action,
          targetReplicas,
          restoreTargets: req.body?.restoreTargets,
        });

      launch.assertValidTargets({
        namespace,
        apps,
        action,
        targetReplicas,
        executionMode,
        verificationTimeout,
      });

      // `Olcekle` ile 0 SESSIZ BIR TUZAKTI: playbook yalnizca `stop` dalinda geri alma
      // durumunu kaydeder. Yani "Olcekle -> 0" uygulamayi durdurur ama ConfigMap kaydi
      // OLUSMAZ, portal aynasina satir DUSMEZ, "Su an durdurulmus" listesinde GORUNMEZ
      // ve `Geri Al` "Run stop first" ile duser. Kullanici uygulamayi kapatir ve geri
      // getirmenin portal icinde bir yolu KALMAZ.
      //
      // Iki yol da 0'a gotururken birinin hafizasi olmasi, digerinin olmamasi bir
      // tasarim hatasiydi. `Durdur` zaten "hafizali 0" demek.
      if (action === 'scale' && Number(targetReplicas) === 0) {
        throw Object.assign(
          new Error(
            'Replica sayısını 0 yapmak için "Durdur" işlemini kullanın — önceki değer saklanır ve geri alabilirsiniz. "Ölçekle" ile 0 verildiğinde geri alınacak bir kayıt oluşmaz.',
          ),
          { status: 400, code: 'use_stop_for_zero' },
        );
      }

      const selectedTargets = normalizeTargets(req.body?.targets, { clusters, apps });
      const radius = launch.computeBlastRadius({
        clusters,
        apps,
        environment: env,
        action,
        executionMode,
        selectedTargets,
      });
      if (radius.exceedsMaxTargets) {
        throw Object.assign(
          new Error(
            `Tek işlemde en fazla ${launch.maxTargets()} hedef: ${radius.targets} seçildi (${radius.clusterCount} cluster × ${radius.appCount} uygulama).`,
          ),
          { status: 400 },
        );
      }
      // YAZILI ONAY: kullanici namespace adini ELLE yazar. Client'in `writtenConfirm`
      // alanini uydurmasi ise yaramaz — deger namespace ile BIREBIR eslesmek zorunda.
      if (
        radius.requiresWrittenConfirm &&
        String(req.body?.writtenConfirm || '').trim() !== namespace
      ) {
        return res.status(400).json({
          ok: false,
          writtenConfirmRequired: true,
          blastRadius: radius,
          message: `Bu işlem ${radius.targets} hedefi etkiliyor ve ortam prod. Onaylamak için namespace adını yazın: ${namespace}`,
        });
      }

      const { policy, gateCfg } = await resolveGatePolicy(req, {
        action,
        executionMode,
        environment: env,
        tenant,
        clusters,
        namespace,
      });
      // SMART GEREKLI AMA HAZIR DEGIL: geri alma kilidi ve AWX sozlugu kurulmadan ONCE
      // don — engelli bir istek kilit alip birakmasin, AWX/DB'ye gitmesin.
      if (policy.blocked) {
        const ret = engelKarari(req, policy, gateCfg, {
          env, tenant, clusters, namespace, apps, action, executionMode,
        });
        return res.status(ret.status).json(ret.body);
      }
      // Geri alma OCO penceresi disinda da calisabilir ama GEREKCESIZ calisamaz —
      // iz kalmali ve gerekce hem portal kaydina hem SMART metadata'sina gitmeli.
      if (policy.oco === 'warn' && !reason) {
        return res.status(400).json({
          ok: false,
          reasonRequired: true,
          message: 'Geri alma işlemi için gerekçe zorunlu (örn. olay/kayıt numarası).',
        });
      }

      // Mail: oturumdaki kullanicinin adresi. CC istege bagli.
      const mailTo = String(user.mail || '').trim();
      if (!mailTo) {
        throw Object.assign(
          new Error('Oturumunuzda e-posta adresi yok; rapor gönderilemez. Yöneticinize başvurun.'),
          { status: 400 },
        );
      }

      const extraVars = await launch.buildRunExtraVars({
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
        hpaPin,
        // TIP HARITASI: ekranin KESIFTE gordugu tipler. Playbook boylece tahmin
        // etmek zorunda kalmiyor ve "ayni ad iki tipte var" belirsizligi isi
        // dusurmuyor. `buildWorkloadKindMap` gelen veriyi `apps` listesine ve bilinen
        // tiplere karsi suzer — istemciden gelen hicbir sey dogrudan gecmez.
        workloadKinds: req.body?.workloadKinds,
        // CLUSTER BASINA TIP HARITASI: ayni uygulama farkli cluster'larda farkli
        // tipte olabilir; her cluster kendi haritasini alir.
        clusterWorkloadKinds: req.body?.clusterWorkloadKinds,
        // HEDEF BAZLI SECIM: kullanici bir cluster'da bir uygulamayi haric
        // tuttuysa o hedef `extra_vars`a GIRMEZ. Liste normalize edilmis
        // (yetki suzgecinden gecmis) haliyle gonderilir.
        targets: selectedTargets,
      });

      // ── GERI ALMA KILIDI ────────────────────────────────────────────────────
      // KAPIDAN ONCE alinir: kapi SMART onayi icin beklemeye gecerse (`pendingApproval`)
      // is AWX'te henuz yoktur ama kilit TUTULMALI — aksi halde onay beklenirken ikinci
      // bir geri alma baslatilabilirdi. Kapi reddederse kilit birakilir.
      const locking =
        action === 'restore' && executionMode === 'apply'
          ? await acquireRestoreLocks({ env, tenant, clusters, namespace, apps })
          : { ok: true, acquired: [] };
      if (!locking.ok) return res.status(409).json(restoreConflictBody(locking.busy));

      // ── KAPILAR ─────────────────────────────────────────────────────────────
      // Govde ORTAK: `/run` ve `/restore-all` AYNI kapidan gecer. Iki kopya tutmak,
      // birinde yapilan duzeltmenin digerinde sessizce eskimesi demekti — `/restore-all`
      // tam olarak boyle kapisiz kalmisti (yorumu "Geri Al'in kapi politikasini
      // devralir" DIYORDU, kod devralmiyordu).
      let gate;
      try {
        gate = await runScaleXGates({
          req,
          user,
          policy,
          gateCfg,
          env,
          tenant,
          clusters,
          namespace,
          apps,
          action,
          executionMode,
          targetReplicas,
          extraVars,
          reason,
          ocoNumber: req.body?.ocoNumber,
          // Kullanicinin "pencere acilinca otomatik baslat" secimi.
          ocoAction: req.body?.ocoAction,
        });
      } catch (e) {
        await releaseRestoreLocks(locking.acquired);
        throw e;
      }
      if (gate.outcome === 'error') {
        await releaseRestoreLocks(locking.acquired);
        return res.status(gate.status).json(gate.body);
      }
      if (gate.outcome === 'respond') {
        // `pendingApproval` DISINDA is hic baslamayacak (or. `ocoDeferred`) — kilit
        // birakilmali. Onay bekleyen yolda kilit TUTULUR; bilet cozuldugunde
        // uzlastirici ya isi baslatir ya kilidi birakir.
        if (!gate.body?.pendingApproval) await releaseRestoreLocks(locking.acquired);
        return res.json(gate.body);
      }

      // AWX baslatma patlarsa kilit BIZDE kalmamali — kullanici bir daha hic
      // deneyemezdi.
      let job;
      try {
        job = await launchOnAwx({
          keyName: RUN_KEY,
          extraVars,
          req,
          label: `ScaleX ${action} (${executionMode}) — ${namespace} @ ${clusters.join(',')}`,
        });
      } catch (e) {
        await releaseRestoreLocks(locking.acquired);
        throw e;
      }

      await insertOperationRows({
        requestKey: `${job.serverId}:${job.jobId}`,
        username: user.username,
        usernameGroups: user.groups,
        env,
        tenant,
        clusters,
        namespace,
        action,
        executionMode,
        targetReplicas,
        apps,
        serverId: job.serverId,
        jobId: job.jobId,
        status: 'RUNNING',
        ocoNumber: req.body?.ocoNumber,
        reason,
      });

      auditPortal(req, 'scalex_operation', {
        // HPA'ya dokunmak politikanin tersi — denetim kaydinda ACIKCA gorunmeli.
        detail: JSON.stringify({
          env,
          tenant,
          clusters,
          namespace,
          apps,
          action,
          executionMode,
          targets: radius.targets,
          jobId: job.jobId,
          hpaPin,
        }),
      });
      res.json({ ok: true, ...job, blastRadius: radius });
    }),
  );

  router.get(
    '/run/:serverId/:jobId/status',
    asyncRoute(async (req, res) => {
      const serverId = Number(req.params.serverId);
      const jobId = Number(req.params.jobId);
      const denied = await denyIfNotOwner(req, serverId, jobId);
      if (denied) return res.status(denied.status).json({ ok: false, message: denied.message });
      // CIKTI CANLI GOSTERILIYOR (`AnsibleLogTerminal`), bu yuzden kesif yolundaki
      // "hic indirme" cozumu burada UYGULANAMAZ — terminal bos kalirdi.
      //
      // ── SONUC CIKTIYI BEKLEMEZ (2026-10-13) ────────────────────────────────
      //
      // Yapilandirilmis sonuc `set_stats` artifact'indan gelir ve durum cagrisiyla
      // HAZIRDIR. Eskiden bitmis iste once ciktinin TAMAMI indiriliyordu ve yanit o
      // bitene kadar bekliyordu; ustelik ekran `finished`i gorunce ayni ucu BIR DAHA
      // cagiriyordu (ikinci tam indirme). Kullanici, AWX'te bitmis bir isin sonucunu
      // iki indirme sonra goruyordu.
      //
      //   * varsayilan : durum + ARTIMLI cikti AYNI ANDA istenir (iki AWX turu yerine
      //                  birinin suresi). Bitmis iste de artimli doner; `outputFinal: false`
      //                  ekrana "son metin ayrica gelecek" der.
      //   * ?cikti=tam : ekran is bitince BIR KEZ ister; tam cekim. Kullanicinin gordugu
      //                  son metin hicbir zaman artimlardan TUREMEZ.
      const tamCikti = String(req.query?.cikti || '') === 'tam';
      const bosCikti = () => ({ output: '' });
      const [status, artimli] = await Promise.all([
        runner.getJobStatusOnServer(serverId, jobId),
        tamCikti
          ? null
          : runner.getJobOutputOnServer(serverId, jobId, { artimli: true }).catch(bosCikti),
      ]);
      const output = tamCikti
        ? await runner.getJobOutputOnServer(serverId, jobId).catch(bosCikti)
        : artimli;
      const parsed = result.extractScaleXResult(status.artifacts);
      if (status.finished) await finalizeOperation({ serverId, jobId, status, parsed });
      res.json({
        ok: true,
        status: status.status,
        finished: !!status.finished,
        failed: !!status.failed,
        output: output.output || '',
        // `false`: bu metin artimli cekimden; is bittiyse ekran tam metni `?cikti=tam` ile ister.
        outputFinal: tamCikti,
        result: parsed,
        // Portal katalogu gonderdigi halde playbook DOSYAYA dustuyse AWX template'inde
        // "Prompt on launch > Variables" kapali demektir — kullanici bunu bilmeli.
        catalogWarning:
          parsed && parsed.catalogSource === 'file'
            ? 'Playbook cluster kataloğunu portaldan DEĞİL kendi dosyasından okudu — AWX template ayarını kontrol edin (Prompt on launch > Variables).'
            : null,
      });
    }),
  );

  router.post(
    '/cancel/:serverId/:jobId',
    eylemRoute(async (req, res) => {
      const serverId = Number(req.params.serverId);
      const jobId = Number(req.params.jobId);
      const denied = await denyIfNotOwner(req, serverId, jobId);
      if (denied) return res.status(denied.status).json({ ok: false, message: denied.message });
      // KAPSAM: sahiplik kontrolu `ansible_job_history` uzerinden yapiliyor ve MODUL
      // AYRIMI YOK — bu uc, kullanicinin LogX/OpsX/Telnet uzerinden baslattigi kendi
      // islerini de iptal edebilirdi. Yetki yukselmesi degil (is zaten onun), ama ScaleX
      // ucunun ScaleX DISI islere dokunmasi icin bir sebep yok ve `UPDATE` de her
      // durumda kosuyordu. Isin gercekten bir ScaleX islemi oldugunu dogruluyoruz.
      const { rows: own } = await db.query(
        `SELECT TOP 1 id FROM scalex_operations WHERE awx_server_id = $1 AND awx_job_id = $2`,
        [serverId, jobId],
      );
      if (!own.length) {
        return res.status(404).json({ ok: false, message: 'Bu iş bir ScaleX işlemi değil.' });
      }
      const out = await runner.cancelJobOnServer(serverId, jobId);
      await db.query(
        `UPDATE scalex_operations SET status = 'CANCELLED', updated_at = GETUTCDATE()
        WHERE awx_server_id = $1 AND awx_job_id = $2 AND status = 'RUNNING'`,
        [serverId, jobId],
      );
      auditPortal(req, 'scalex_cancel', { detail: JSON.stringify({ serverId, jobId }) });
      res.json({ ok: true, ...out });
    }),
  );

  // ── "Su an durdurulmus" + sapma ───────────────────────────────────────────
  router.get(
    '/stopped',
    asyncRoute(async (req, res) => {
      const env = String(req.query.env || '').trim();
      const tenant = String(req.query.tenant || '').trim();
      const clusterName = String(req.query.cluster || '').trim() || null;
      // KAPSAM OPSIYONEL. "Hizli aksiyon" paneli sihirbazin ILK adiminda da gorunuyor ve
      // orada henuz secilmis bir env/tenant yok. Kapsam verilirse liste ona daralir.
      //
      // BU BIR POLITIKA KARARI: kapsamsiz listede kullanicinin GOREBILDIGI tum
      // namespace adlari (prod dahil) gorunur hale gelir. Yetki suzgeci aynen
      // uygulaniyor — yalnizca gorunurlugun VARSAYILAN kapsami genisliyor — ama bu
      // genisleme denetim kaydina yaziliyor.
      const scoped = !!(env && tenant);
      const all = scoped
        ? await state.listMirror({ env, tenant, clusterName })
        : await state.listMirrorAll();
      if (!scoped) {
        auditPortal(req, 'scalex_stopped_global', {
          detail: JSON.stringify({ rows: all.length, truncated: all.truncated === true }),
        });
      }
      // Bu uc `resolveScope`tan GECMEZ (namespace almiyor), bu yuzden yetki suzgeci
      // BURADA uygulanmali — aksi halde kisitli bir namespace'in adi ve orada durdurulmus
      // uygulamalar, o namespace'i goremeyen kullaniciya listelenirdi.
      const allowed = await catalog.filterStoppedForUser(all, {
        env,
        tenant,
        user: currentUser(req),
      });
      // SAHIPLIK SUZGECI AYRI VE SONRA. Yetki kapisi "bu namespace'i gorebilir
      // misin", bu ise "bu KAYIT senin (ya da ekibinin) mi" sorusunu yanitlar.
      // Ikisini tek fonksiyonda birlestirmek, birinde yapilan bir gevsemenin
      // digerini de sessizce gevsetmesi demekti.
      const rows = catalog.filterStoppedByOwnership(allowed, { user: currentUser(req) });
      // `truncated` FILTRELEMEDEN ONCE okunur: `filterStoppedForUser` yeni bir dizi
      // dondugu icin bayrak orada kaybolur.
      res.json({
        ok: true,
        items: rows,
        // GIZLENEN SAYISI IKI SUZGECI DE KAPSAR (yetki + sahiplik). Kullanici
        // "listede yok" ile "sana gosterilmiyor"u ayirt edebilmeli.
        hiddenCount: all.length - rows.length,
        hiddenByOwnership: allowed.length - rows.length,
        truncated: all.truncated === true,
        limit: state.MIRROR_LIMIT,
      });
    }),
  );

  router.post(
    '/adopt',
    eylemRoute(async (req, res) => {
      const user = currentUser(req);
      const { env, tenant, namespace, clusters } = await resolveScope(req, { requireApps: false });
      const appName = String(req.body?.appName || '').trim();
      if (!appName) throw Object.assign(new Error('appName zorunlu.'), { status: 400 });
      if (clusters.length !== 1)
        throw Object.assign(new Error('Portala alma tek cluster için yapılır.'), { status: 400 });
      // `appName` `apps` dizisine GIRMEDIGI icin `resolveScope` icindeki uygulama bazli
      // yetki kontrolunden gecmiyordu ve formati hic dogrulanmiyordu. Ikisi de burada.
      launch.assertValidDiscoveryTargets({ namespace, apps: [appName] });
      await catalog.assertAppsAllowed({ env, tenant, clusters, namespace, apps: [appName], user });

      // `previousReplicas` KULLANICIDAN GELIR ve "geri alinca kac replica olacak"
      // sorusunun cevabidir — uydurma bir sayi, geri almayi sessizce YANLIS yapardi.
      // Sinirli ve tam sayi olmasi sart; makul bir ust sinirin disi reddedilir.
      const prevRaw = req.body?.previousReplicas;
      const prev = Number(prevRaw);
      if (!Number.isInteger(prev) || prev < 0 || prev > 1000) {
        throw Object.assign(new Error('previousReplicas 0-1000 arası tam sayı olmalı.'), {
          status: 400,
        });
      }
      const row = await state.adopt({
        env,
        tenant,
        clusterName: clusters[0],
        namespace,
        appName,
        workloadKind: req.body?.workloadKind || null,
        previousReplicas: prev,
        // KAYDI ALAN KISI OTURUMDAN. Client'in `stoppedBy` gondermesine izin vermek,
        // denetim izine BASKASININ adini yazdirmak demekti — panel bu alani "durduran
        // kisi" olarak gosteriyor.
        stoppedBy: user.username,
        adoptedBy: user.username,
      });
      auditPortal(req, 'scalex_adopt', {
        detail: JSON.stringify({ env, tenant, cluster: clusters[0], namespace, appName }),
      });
      res.json({ ok: true, item: row });
    }),
  );

  // TOPLU GERI ALMA. Bir olay sirasinda 6 uygulamayi tek tek geri almak 6 ayri
  // is + 6 ayri onay demek; kurtarma sirasinda bu gercek bir maliyet.
  //
  // Gerekce ZORUNLU: bu uc, `Geri Al`in kapi politikasini (OCO uyarir-engellemez)
  // devralir ve gerekce hem portal kaydina hem SMART metadata'sina gider.
  router.post(
    '/restore-all',
    eylemRoute(async (req, res) => {
      const user = currentUser(req);
      const env = String(req.body?.env || '').trim();
      const tenant = String(req.body?.tenant || '').trim();
      const reason = String(req.body?.reason || '').trim();
      if (!env || !tenant)
        throw Object.assign(new Error('env ve tenant zorunlu.'), { status: 400 });
      if (!reason) {
        return res.status(400).json({
          ok: false,
          reasonRequired: true,
          message: 'Toplu geri alma için gerekçe zorunlu (örn. olay/kayıt numarası).',
        });
      }

      // YETKI SUZGECI ONCE: kullanicinin goremedigi bir namespace'i geri almasi
      // mumkun olmamali. `/stopped` ile AYNI suzgec.
      const all = await state.listMirror({ env, tenant });
      const visible = await catalog.filterStoppedForUser(all, { env, tenant, user });
      // Yalnizca cluster gercegiyle UYUMLU kayitlar: sapmis bir kaydi geri almaya
      // calismak `STATE;FAIL` ile duserdi ve kullaniciya yalanci bir "denendi" verirdi.
      const targets = visible.filter((r) => r.driftStatus === 'in_sync');
      if (!targets.length) {
        return res.json({ ok: true, launched: [], message: 'Geri alınabilecek kayıt yok.' });
      }

      // (cluster, namespace) basina TEK is: playbook (cluster x uygulama) carpimini
      // kendi yapiyor, ayni namespace icin tek is yeterli.
      const groups = new Map();
      for (const r of targets) {
        const k = `${r.clusterName}|${r.namespace}`;
        if (!groups.has(k))
          groups.set(k, { cluster: r.clusterName, namespace: r.namespace, apps: [] });
        groups.get(k).apps.push(r.appName);
      }

      // KAPI: toplu geri alma da TEKIL `Geri Al` ile AYNI politikadan gecer.
      // Bu blok uzun sure YOKTU: yorum "Geri Al'in kapi politikasini devralir" diyordu
      // ama kod dogrudan `launchOnAwx` cagiriyordu. Yani prod'da tekil geri alma SMART
      // kaydi acarken TOPLU geri alma hicbir onay olmadan calisiyordu — kapiyi bir
      // dugmeyle atlamak mumkundu.
      const launched = [];
      const pendingApproval = [];
      const blocked = [];
      for (const g of groups.values()) {
        // GRUP BASINA: SMART istisna kurali namespace'e bakabilir; tek bir politika
        // butun gruplara uygulansaydi ekranin soyledigi ile kapinin yaptigi ayrisirdi.
        // Ayar satiri kisa omurlu bellekten gelir (ss-customizations), ek maliyet kucuk.
        const { policy, gateCfg } = await resolveGatePolicy(req, {
          action: 'restore',
          executionMode: 'apply',
          environment: env,
          tenant,
          clusters: [g.cluster],
          namespace: g.namespace,
        });
        // TOPLU GERI ALMA: HPA pin UYGULANMAZ (her uygulama icin ayri pin ayari
        // tekil geri almada mumkun ama toplu islemde guvenli degil — HPA minReplicas
        // uygulama bazli degisir ve toplu sabitleme yanlis uygulamayi etkileyebilir).
        // TIP HARITASI: /run ile AYNI. `targets` her satirda `workloadKind` tasir
        // (state.cjs:79); grup bazinda harita uretilir ve playbook "ayni ad iki
        // tipte var" belirsizligini otomatik cozer.
        const groupTargets = targets.filter(
          (r) => r.clusterName === g.cluster && r.namespace === g.namespace,
        );
        const extraVars = await launch.buildRunExtraVars({
          env,
          tenant,
          clusters: [g.cluster],
          namespace: g.namespace,
          apps: g.apps,
          action: 'restore',
          executionMode: 'apply',
          targetReplicas: undefined,
          // TOPLU GERI ALMA da admin ayarini gormeli. Sabit '60' ile, acmada pod
          // 60 sn'de hazir degilse her hedef "uyarili" donuyordu — tek fark
          // butcenin 300 yerine 60 olmasiyken.
          verificationTimeout: String(launch.verifyTimeoutDefault()),
          allowPartial: true,
          mailTo: String(user.mail || '').trim(),
          mailCc: '',
          hpaPin: false,
          workloadKinds: groupTargets.map((r) => ({ name: r.appName, kind: r.workloadKind })),
        });

        // KILIT: grup basina. Mesgul bir grup TUM istegi dusurmez — `blocked`a duser
        // ve digerleri denenmeye devam eder. Bir kesinti sirasinda tek bir cakisma
        // yuzunden kalan bes grubu hic denememek en pahali hata olurdu.
        const groupLock = await acquireRestoreLocks({
          env,
          tenant,
          clusters: [g.cluster],
          namespace: g.namespace,
          apps: g.apps,
        });
        if (!groupLock.ok) {
          blocked.push({
            cluster: g.cluster,
            namespace: g.namespace,
            message: restoreConflictBody(groupLock.busy).message,
          });
          continue;
        }

        const gate = await runScaleXGates({
          req,
          user,
          policy,
          gateCfg,
          env,
          tenant,
          clusters: [g.cluster],
          namespace: g.namespace,
          apps: g.apps,
          action: 'restore',
          executionMode: 'apply',
          targetReplicas: undefined,
          extraVars,
          reason,
          ocoNumber: undefined,
        }).catch(async (e) => {
          await releaseRestoreLocks(groupLock.acquired);
          throw e;
        });
        if (gate.outcome === 'error') {
          await releaseRestoreLocks(groupLock.acquired);
          // HICBIR grup henuz baslamadiysa hata YAPILANDIRMA duzeyindedir (or.
          // `smart_not_configured`) ve her grup icin ayni sekilde duserdi — kullaniciyi
          // N kez ayni mesajla ugrastirmak yerine dogrudan don.
          if (!launched.length && !pendingApproval.length)
            return res.status(gate.status).json(gate.body);
          blocked.push({
            cluster: g.cluster,
            namespace: g.namespace,
            message: gate.body?.message || 'Kapı reddetti.',
          });
          continue;
        }
        if (gate.outcome === 'respond') {
          // Onay bekleyen grubun kilidi TUTULUR; diger her yolda birakilir.
          if (!gate.body?.pendingApproval) await releaseRestoreLocks(groupLock.acquired);
          if (gate.body?.pendingApproval) {
            pendingApproval.push({
              cluster: g.cluster,
              namespace: g.namespace,
              apps: g.apps,
              ticketId: gate.body.ticketId,
              externalTicketId: gate.body.externalTicketId,
            });
          } else {
            blocked.push({
              cluster: g.cluster,
              namespace: g.namespace,
              message: gate.body?.message || 'İş başlatılmadı.',
            });
          }
          continue;
        }

        let job;
        try {
          job = await launchOnAwx({
            keyName: RUN_KEY,
            extraVars,
            req,
            label: `ScaleX toplu geri alma — ${g.namespace} @ ${g.cluster}`,
          });
        } catch (e) {
          await releaseRestoreLocks(groupLock.acquired);
          throw e;
        }
        await insertOperationRows({
          requestKey: `${job.serverId}:${job.jobId}`,
          username: user.username,
          usernameGroups: user.groups,
          env,
          tenant,
          clusters: [g.cluster],
          namespace: g.namespace,
          action: 'restore',
          executionMode: 'apply',
          targetReplicas: undefined,
          apps: g.apps,
          serverId: job.serverId,
          jobId: job.jobId,
          status: 'RUNNING',
          ocoNumber: null,
          reason,
        });
        launched.push({ ...job, cluster: g.cluster, namespace: g.namespace, apps: g.apps });
      }

      auditPortal(req, 'scalex_restore_all', {
        detail: JSON.stringify({
          env,
          tenant,
          groups: groups.size,
          apps: targets.length,
          reason,
          launched: launched.length,
          pendingApproval: pendingApproval.length,
          blocked: blocked.length,
        }),
      });
      res.json({ ok: true, launched, pendingApproval, blocked });
    }),
  );

  // ── ZAMANLANMIS OCO TETIKLEMELERI — KULLANICI UCLARI ────────────────────
  //
  // GORUNURLUK: kullanici KENDI ve GRUBUNUN kayitlarini gorur, Admin hepsini.
  // Grup bilgisi kayit acilirken yaziliyor (`owner_groups`); `null` (eski kayit)
  // grup uzerinden gorunur SAYILMAZ — "bilmiyoruz"u "senin grubun" saymak
  // baskasinin kesinti kaydini gostermek olurdu.
  router.get(
    '/oco-schedules',
    asyncRoute(async (req, res) => {
      const u = currentUser(req);
      const ocoStore = require('../oco/store.cjs');
      const { items, truncated } = await ocoStore.listForUser({
        username: u.username,
        groups: u.groups,
        limit: Number(req.query?.limit) || 100,
      });
      // ADMIN HEPSINI GORUR. Ayri bir sorgu degil, ayni listenin suzgecsiz hali:
      // iki ayri sorgu zamanla AYRISIRDI.
      const gorunur = u.role === 'Admin'
        ? (await ocoStore.listAll({ limit: Number(req.query?.limit) || 100 }))
        : items;
      res.json({ ok: true, items: gorunur, truncated, scope: u.role === 'Admin' ? 'all' : 'mine+groups' });
    }),
  );

  // IPTAL — "her noktada iptal edilsin" (kullanicinin istegi).
  // Sahip, GRUP UYESI ve Admin iptal edebilir; iptal EDEN her zaman kaydedilir.
  router.post(
    '/oco-schedules/:id/cancel',
    eylemRoute(async (req, res) => {
      const u = currentUser(req);
      const ocoStore = require('../oco/store.cjs');
      const rec = await ocoStore.get(Number(req.params.id));
      if (!rec) return res.status(404).json({ ok: false, message: 'Kayit bulunamadi.' });
      if (!ocoStore.canManage(rec, u)) {
        // BASKASININ KAYDINA ERISIM DENEMESI DENETIME — `denyIfNotOwner`
        // ile ayni gerekce: 403 donup iz birakmamak, bir kesinti aracinda
        // kabul edilemez.
        auditPortal(req, 'scalex_oco_schedule_forbidden', {
          result: 'fail',
          detail: JSON.stringify({ id: rec.id, owner: rec.username }),
        });
        return res.status(403).json({ ok: false, message: 'Bu kayit sizin ya da grubunuzun degil.' });
      }
      // ── YALNIZCA `SCHEDULED` KAYIT BURADAN IPTAL EDILIR (2026-10-13) ─────────
      //
      // `cancelBy` yalnizca PORTAL KAYDINI degistirir. Kayit `AWX_SCHEDULED` ise is
      // AWX'in KENDI zamanlayicisinda bekliyordur; `PENDING_APPROVAL` ise acik bir SMART
      // bileti vardir. Ikisinde de portal kaydini "iptal" yapmak isi DURDURMAZ: AWX
      // zamanlamasi yine tetikler, bilet sonradan onaylanirsa is yine baslar — ekran
      // "iptal edildi" derken prod'da durdurma calisir.
      //
      // ScaleX bu iki duruma artik kayit SOKMUYOR (SMART devredeyken zamanlama kapali,
      // bkz. launch.gatePolicyFor). Eski yoldan kalmis bir kayit varsa yaniltici bir
      // "iptal edildi" yerine RED ve dogru adres: Admin iptali AWX zamanlamasini da siler.
      if (['AWX_SCHEDULED', 'PENDING_APPROVAL'].includes(rec.status)) {
        return res.status(409).json({
          ok: false,
          code: 'schedule_needs_admin_cancel',
          message:
            `Bu kayıt "${rec.status}" durumunda: iş AWX zamanlayıcısında ya da SMART onayında ` +
            'bekliyor ve buradan iptal edilirse yine çalışabilir. Bir yöneticiden ' +
            'Admin > Zamanlanmış İşler ekranından iptal etmesini isteyin.',
        });
      }
      const iptal = await ocoStore.cancelBy(rec.id, {
        cancelledBy: u.username,
        note: String(req.body?.note || '').slice(0, 1000),
      });
      if (!iptal) {
        // Kosullu UPDATE 0 satir etkiledi: kayit bu arada tetiklendi ya da
        // zaten kapandi. SESSIZCE "iptal edildi" DEMEYIZ.
        return res.status(409).json({
          ok: false,
          message: `Kayit iptal edilemedi — durumu "${rec.status}". Tetiklenmis ya da zaten kapanmis olabilir.`,
        });
      }
      // ISLEM SATIRLARI DA KAPANIR: zamanlama aninda `oco:<kayit>` anahtariyla yazilmisti.
      // Uzlastirici bunu bir sonraki turda zaten yapar; burada ANINDA yapiyoruz ki is
      // gecmisi iptalden hemen sonra "zamanlandi" demesin. Yazilamazsa iptal YINE gecerli.
      await db
        .query(
          `UPDATE scalex_operations
              SET status = 'CANCELLED', error_message = $2, updated_at = GETUTCDATE()
            WHERE request_key = $1 AND status = 'SCHEDULED'`,
          [`oco:${rec.id}`, `Zamanlama iptal edildi (${u.username}).`],
        )
        .catch((e) => console.warn('[ScaleX] iptal edilen zamanlamanin islem satiri kapatilamadi:', e.message));
      auditPortal(req, 'scalex_oco_schedule_cancelled', {
        detail: JSON.stringify({ id: rec.id, owner: rec.username, oco: rec.ocoNumber }),
      });
      res.json({ ok: true, record: iptal });
    }),
  );

  // GUNCELLEME — "guncellemek isterse guncellesin her noktada".
  // YALNIZCA `SCHEDULED` iken: tetiklenmis bir isi "guncellemek" onu sessizce
  // ezmek olurdu (store.update kosullu UPDATE ile bunu zorluyor).
  router.post(
    '/oco-schedules/:id/update',
    eylemRoute(async (req, res) => {
      const u = currentUser(req);
      const ocoStore = require('../oco/store.cjs');
      const rec = await ocoStore.get(Number(req.params.id));
      if (!rec) return res.status(404).json({ ok: false, message: 'Kayit bulunamadi.' });
      if (!ocoStore.canManage(rec, u)) {
        auditPortal(req, 'scalex_oco_schedule_forbidden', {
          result: 'fail',
          detail: JSON.stringify({ id: rec.id, owner: rec.username }),
        });
        return res.status(403).json({ ok: false, message: 'Bu kayit sizin ya da grubunuzun degil.' });
      }

      // YENI NUMARA VERILDIYSE DOGRULANIR. Numara degistirip pencereyi eski
      // kayittan devam ettirmek, DOGRULANMAMIS bir OCO ile is baslatmak olurdu.
      const yeniNumara = String(req.body?.ocoNumber || '').trim();
      let yama = {};
      if (yeniNumara && yeniNumara !== rec.ocoNumber) {
        const ocoClient = require('../oco/client.cjs');
        const ocoWindow = require('../oco/window.cjs');
        let order;
        try {
          order = await ocoClient.getChangeOrder(yeniNumara);
        } catch (e) {
          return res.status(ocoClient.httpStatus(e)).json({ ok: false, message: e.message });
        }
        const planned = ocoWindow.extractPlannedInterruption(order.payload);
        if (!planned) {
          return res.status(400).json({
            ok: false,
            message: `OCO ${yeniNumara} kaydinda planlanan kesinti tarihi yok.`,
          });
        }
        const w = ocoWindow.evaluateWindow({ startDate: planned.startDate, endDate: planned.endDate });
        if (!w.ok) return res.status(400).json({ ok: false, message: w.message });
        if (w.phase === 'expired') {
          return res.status(400).json({ ok: false, ocoExpired: true, message: w.message });
        }
        yama = {
          ocoNumber: yeniNumara,
          ocoSubject: order.result?.OcoWfIdSubject || order.result?.Subject || null,
          runAt: w.windowStart,
          windowEnd: w.windowEnd,
        };
      }

      const guncel = await ocoStore.update(rec.id, yama);
      if (!guncel) {
        return res.status(409).json({
          ok: false,
          message: `Kayit guncellenemedi — durumu "${rec.status}". Yalnizca beklemedeki kayitlar guncellenebilir.`,
        });
      }
      auditPortal(req, 'scalex_oco_schedule_updated', {
        detail: JSON.stringify({ id: rec.id, oncekiOco: rec.ocoNumber, yeniOco: guncel.ocoNumber }),
      });
      res.json({ ok: true, record: guncel });
    }),
  );

  // ── ADMIN: ONAY KAPILARININ DURUMU (2026-10-13) ───────────────────────────
  //
  // "ScaleX prod'da neden calismiyor" sorusunun cevabi hicbir ekranda YOKTU: admin
  // sayfasi kurali anlatiyordu ("SMART yapilandirilmadan prod'da apply calismaz") ama
  // SU ANKI durumu gostermiyordu. Bu uc kullanicinin `/preview`da aldigi KARARIN
  // AYNISINI (ayni cozucu) admin'e verir: kip, SMART hazir mi, eksik ne, OCO acik mi.
  //
  // SALT OKUNUR; SMART bileti acmaz. `onizleme` sablonu ORNEK degerlerle render eder:
  // admin, Smart'a hangi alanlarin gidecegini gercek bir talep acmadan gorur. Kip
  // DEGISIKLIGI bu uctan yapilmaz: Admin > Sistem'in ucu (denetimli) kullanilir.
  router.get(
    '/admin/gate-status',
    asyncRoute(async (req, res) => {
      if (currentUser(req).role !== 'Admin') {
        return res.status(403).json({ ok: false, message: 'Bu ekran yalnizca yoneticilere acik.' });
      }
      const { policy, gateCfg } = await resolveGatePolicy(req, {
        action: 'stop',
        executionMode: 'apply',
        environment: 'prod',
        herkesIcin: true,
      });
      const smartApproval = gateCfg.svcConfig.smartApproval || {};
      // Admin'in KENDI tetiklemelerinde SMART atlaniyor mu (kisisel tercih) — kartta ayri
      // satir; yukaridaki `policy` siradan kullanicinin gorecegi karardir.
      const kendiAtlamasi = await require('../ansible/admin-smart-atla.cjs').adminSmartAtliyor(req);
      const istisna = launch.gates.parseSmartSkipRules(smartApproval.skipWhen);
      const ornek = scalexSmartBaglami({
        user: currentUser(req),
        env: 'prod',
        tenant: 'ornek-tenant',
        clusters: ['ornek-cluster-1', 'ornek-cluster-2'],
        namespace: 'ornek-namespace',
        apps: ['ornek-api', 'ornek-worker'],
        action: 'stop',
        radius: { targets: 4 },
        reason: 'ornek gerekce',
        ocoNumber: '1234567',
      });
      let onizleme = null;
      let onizlemeHatasi = null;
      if (String(smartApproval.metadataFields || '').trim()) {
        try {
          onizleme = buildScaleXSmartMetadata(
            smartApproval.metadataFields,
            {
              username: currentUser(req).username,
              email: currentUser(req).mail || '',
              templateName: 'ScaleX',
              templateId: gateCfg.templateId,
              extraVars: {},
            },
            ornek,
          );
        } catch (e) {
          onizlemeHatasi = e.message;
        }
      }
      const kip = config.smartMode();
      res.json({
        ok: true,
        smartMode: kip.value,
        smartModeSource: kip.source,
        smartModeProblem: kip.problem,
        // Kullanicinin bugun prod'da `Durdur + Uygula` icin alacagi karar.
        policy,
        template: { serverId: gateCfg.serverId, templateId: gateCfg.templateId },
        configError: gateCfg.hata ? gateCfg.hata.message : null,
        smart: {
          enabled: smartApproval.enabled === true,
          flowKey: String(smartApproval.flowKey || '').trim() || null,
          hasMetadata: !!String(smartApproval.metadataFields || '').trim(),
          missing: launch.smartEksikleri(smartApproval, {
            smartClientReady: (() => {
              try {
                return require('../smart/client.cjs').isConfigured() === true;
              } catch {
                return false;
              }
            })(),
          }),
          onizleme,
          onizlemeHatasi,
          // "Su durumda onay isteme" satirlari: ScaleX'te de gecerli, ekranda gorunur.
          // Eslesen alanlar: env, ortam, tenant, action, execution_mode, cluster_count, namespace.
          skipRules: istisna.rules,
          skipRulesInvalid: istisna.invalid,
        },
        adminSkipSelf: kendiAtlamasi === true,
        // Sablonda kullanilabilecek degiskenler ve ornek degerleri (ekran yardim metni).
        ornekBaglam: ornek,
      });
    }),
  );

  // ── SMART KURALI ANAHTARI (yalniz Admin) ─────────────────────────────────
  //
  // Ayar genel Admin > Sistem ucundan da yazilabilir; bu uc ONU DEGISTIRMEZ, durum
  // kartindaki tek tiklik anahtarin ucudur. Farki IZ: genel uc `system_config_update`
  // yazar (anahtar + deger); burada ONCEKI ve YENI kip ayri bir eylemle
  // (`scalex_smart_mode_changed`) kaydedilir — "prod'da SMART onayini kim, ne zaman
  // kapatti" sorusu ScaleX denetim suzgecinden tek satirda cevaplanir.
  //
  // Deger `process.env`e ANINDA yazilir (env-overrides.setEnvOverride) ve
  // `config.smartMode()` her cagrida oradan okur: restart gerekmez.
  router.put(
    '/admin/smart-mode',
    eylemRoute(async (req, res) => {
      const u = currentUser(req);
      if (u.role !== 'Admin') {
        return res.status(403).json({ ok: false, message: 'Bu ayar yalnizca yoneticilere acik.' });
      }
      const mode = String(req.body?.mode ?? '')
        .trim()
        .toLowerCase();
      // BOS DEGER KABUL EDILMEZ: genel uc bosu "varsayilana don" sayar; bu uc bir SECIM
      // kaydeder ve secimin ne oldugu iz kaydinda acik yazmali.
      if (!config.SMART_MODES.includes(mode)) {
        return res.status(400).json({
          ok: false,
          message: `SMART kuralı yalnızca "required" ya da "oco_only" olabilir.`,
        });
      }
      const onceki = config.smartMode().value;
      await require('../db/env-overrides.cjs').setEnvOverride(config.SMART_MODE_KEY, mode, u.username);
      auditPortal(req, 'scalex_smart_mode_changed', {
        // Kapatmak bir guvenlik karari: denetim listesinde uyari olarak gorunur.
        result: mode === 'oco_only' ? 'warn' : 'ok',
        detail: JSON.stringify({ onceki, yeni: mode }),
      });
      res.json({ ok: true, smartMode: config.smartMode().value, onceki });
    }),
  );

  // ── CLUSTER YETENEK ENVANTERI — "Denetim gibi ekran" ────────────────────
  //
  // Cluster basina: son tarama zamani, bulunan olceklenebilir tip sayisi,
  // OKUNAMAYAN kaynaklar (RBAC bosluklari). Admin buradan toplu tarama
  // baslatir; kesif o envanteri okuyup cluster basina ~50 `oc get --raw`
  // cagrisini atlar.
  router.get(
    '/admin/cluster-caps',
    asyncRoute(async (req, res) => {
      if (currentUser(req).role !== 'Admin') {
        return res.status(403).json({ ok: false, message: 'Bu ekran yalnizca yoneticilere acik.' });
      }
      const env = String(req.query?.env || '').trim();
      const tenant = String(req.query?.tenant || '').trim();
      const items = await clusterCaps.list({ env: env || undefined, tenant: tenant || undefined });
      res.json({ ok: true, items, ttlDays: clusterCaps.CAPS_TTL_DAYS });
    }),
  );

  router.get(
    '/admin/oco-diagnose',
    asyncRoute(async (req, res) => {
      // ── OCO TANI — SALT OKUNUR ────────────────────────────────────────────
      //
      // "Bir ornek OCO girince ne cikiyor, hangisi nasil dikkate aliniyor?"
      // sorusunun cevabi bugun HICBIR YERDE gorunmuyor. Portal servisin
      // yanitindan yalnizca UC sey okuyor (kayit var mi, planlanan kesinti
      // saatleri, baslik); onay durumu / status / hedef sistemler HIC
      // okunmuyor. Bu uc o gercegi ekrana tasir.
      //
      // HICBIR SEY BASLATMAZ: AWX isi acmaz, SMART kaydi yaratmaz, DB'ye
      // yazmaz. Tek yan etkisi denetim kaydidir.
      if (currentUser(req).role !== 'Admin') {
        return res.status(403).json({ ok: false, message: 'Bu ekran yalnizca yoneticilere acik.' });
      }
      const num = String(req.query?.number || '').trim();
      if (!num) {
        return res.status(400).json({ ok: false, message: 'OCO numarasi zorunlu.' });
      }

      // Ayar hic girilmemisse bunu ACIKCA soyle. Onceden `OCO_API_URL`in kod
      // icinde bir varsayilani vardi ve "ayar yok" durumu "servise ulasilamadi"
      // gibi gorunuyordu — iki apayri sorun, tek mesaj.
      const ocoConfig = require('../oco/config.cjs');
      if (!ocoConfig.isConfigured()) {
        return res.status(503).json({
          ok: false,
          notConfigured: true,
          message: 'OCO servisi yapilandirilmamis (Admin > Sistem > OCO_API_URL).',
        });
      }

      // KIM NEYI SORGULADI — denetime. Sorgu salt okunur ama bir uretim
      // degisiklik kaydini okuyor; izsiz kalmamali.
      auditPortal(req, 'scalex_oco_diagnose', { detail: JSON.stringify({ oco: num }) });

      const ocoClient = require('../oco/client.cjs');
      const diagnoseMod = require('../oco/diagnose.cjs');
      let order;
      try {
        order = await ocoClient.getChangeOrder(num);
      } catch (e) {
        // Tani ekraninda hata da BIR SONUCTUR: kullanici "numara mi yanlis,
        // servis mi erisilemez" ayrimini gormeli.
        return res.status(200).json({
          ok: false,
          lookupFailed: true,
          status: ocoClient.httpStatus(e),
          message: e.message,
          readFields: diagnoseMod.READ_FIELDS,
        });
      }

      const diagnosis = diagnoseMod.diagnose(order);
      // Kapi simulasyonu: sorgulanan kapsam admin'den gelir, varsayilan prod.
      const env = String(req.query?.env || 'prod').trim();
      const action = String(req.query?.action || 'stop').trim();
      const { policy } = await resolveGatePolicy(req, {
        action,
        executionMode: 'apply',
        environment: env,
      });
      const simulation = diagnoseMod.simulateGate({
        diagnosis,
        ocoApplies: policy.oco === 'require',
      });

      res.json({
        ok: true,
        number: num,
        ...diagnosis,
        scope: { env, action, executionMode: 'apply' },
        gatePolicy: policy,
        simulation,
      });
    }),
  );

  // ── ADMIN: OKUNAMAYAN TIPLER (RBAC BULGULARI) ─────────────────────────────
  //
  // Kullanici ekraninda artik TEK SATIR ozet var; tam liste burada birikiyor.
  // Yalnizca Admin: bu, platform ekibine goturulecek bir is listesi, son
  // kullanicinin gunluk akisinin parcasi degil.
  router.get(
    '/admin/rbac-findings',
    asyncRoute(async (req, res) => {
      if (currentUser(req).role !== 'Admin') {
        return res.status(403).json({ ok: false, message: 'Bu liste yalnizca yoneticilere acik.' });
      }
      const findings = await rbacFindings.list({ reason: req.query?.reason });
      res.json({ ok: true, findings, limit: rbacFindings.LIST_LIMIT });
    }),
  );

  // ── ADMIN: KESIF SURE OLCUMU ──────────────────────────────────────────────
  //
  // "Kesif hizlandi mi" sorusunun URETIMDEKI cevabi. Sentetik bekci `oc` cagri
  // sayisini olcer; AWX kuyrugunu ve bastion RTT'sini OLCEMEZ. Bu liste olculer.
  //
  // Yalnizca Admin: burada cluster adlari ve is numaralari var, ve bu bir
  // kapasite/performans gorunumu — son kullanicinin akisinin parcasi degil.
  router.get(
    '/admin/discovery-timing',
    asyncRoute(async (req, res) => {
      if (currentUser(req).role !== 'Admin') {
        return res.status(403).json({ ok: false, message: 'Bu liste yalnizca yoneticilere acik.' });
      }
      const rows = await discoveryTiming.list({ limit: req.query?.limit });
      res.json({
        ok: true,
        timings: rows,
        limit: discoveryTiming.LIST_LIMIT,
        retentionDays: discoveryTiming.RETENTION_DAYS,
      });
    }),
  );

  // Cozulen bir eksigi listeden dusurmek icin. SILME BILEREK VAR: platform ekibi
  // yetkiyi verdiginde satir bir sonraki kesife kadar "cozulmemis" gorunurdu ve
  // ekran guvenilirligini yitirirdi.
  router.delete(
    '/admin/rbac-findings/:id',
    asyncRoute(async (req, res) => {
      if (currentUser(req).role !== 'Admin') {
        return res.status(403).json({ ok: false, message: 'Bu islem yalnizca yoneticilere acik.' });
      }
      await rbacFindings.remove(req.params.id);
      auditPortal(req, 'scalex_rbac_finding_cleared', { detail: String(req.params.id) });
      res.json({ ok: true });
    }),
  );

  router.get(
    '/history',
    asyncRoute(async (req, res) => {
      const user = currentUser(req);
      const isAdmin = user.role === 'Admin';
      // `SELECT *` DEGIL: `result_json` ve `error_message` NVARCHAR(MAX) ve tek bir isin
      // sonucu yuz binlerce karakter olabiliyor (hedef basina satirlar). 200 satirla
      // carpilinca liste yaniti onlarca MB'a cikabilirdi — oysa gecmis LISTESI bu iki
      // alani hic gostermiyor. Ayrinti gerektiginde is durumu ucundan okunuyor.
      // Kolonlar her iki sorguda da ELLE yazili: SQL metnine sablon degiskeni koymak
      // (`${...}`) bu modulde bir bekci tarafindan yasak — sabit bile olsa, enjeksiyon
      // incelemesini "bu deger nereden geliyor?" sorusuna mahkum ediyor.
      const { rows } = await db.query(
        isAdmin
          ? `SELECT TOP 200 id, request_key, username, env, tenant, cluster_name, namespace,
                  action, execution_mode, target_replicas, app_names_json,
                  awx_server_id, awx_job_id, status, overall_status,
                  smart_ticket_id, oco_number, approval_state, approved_by, approved_at,
                  reason, created_at, updated_at
             FROM scalex_operations ORDER BY created_at DESC`
          : `SELECT TOP 200 id, request_key, username, env, tenant, cluster_name, namespace,
                  action, execution_mode, target_replicas, app_names_json,
                  awx_server_id, awx_job_id, status, overall_status,
                  smart_ticket_id, oco_number, approval_state, approved_by, approved_at,
                  reason, created_at, updated_at
             FROM scalex_operations WHERE username = $1 ORDER BY created_at DESC`,
        isAdmin ? [] : [user.username],
      );
      res.json({ ok: true, items: rows });
    }),
  );

  app.use('/api/scalex', router);

  // EMNIYET AGI: islemleri sunucu tarafinda da sonuclandir. Bu cagri olmadan
  // `finalizeOperation` YALNIZCA tarayicinin yoklamasindan calisir ve kullanici
  // sekmeyi kapatirsa islem sonsuza dek RUNNING kalir, ayna hic yazilmaz ve
  // "Su an durdurulmus" paneli yanlis bilgi verir (bkz. reconciler.cjs basligi).
  require('./reconciler.cjs').startReconciler();

  console.log('[ScaleX] ScaleX API hazir (/api/scalex) + uzlastirici acik');
}

// ── SMART METADATA (2026-10-13) ─────────────────────────────────────────────
//
// IKI HATA BIRDEN VARDI ve ikisi de ayni sonucu uretiyordu: ScaleX icin SMART bileti
// HIC ACILAMAZDI.
//   1. Bu fonksiyon `[{ key, value }, ...]` DIZISI donduruyordu. Smart istemcisi
//      (`smart/client.cjs createTicket`) NESNE bekler ve `Object.entries` ile acar;
//      dizide anahtarlar "0", "1", "2"... olur, degerler "[object Object]".
//   2. Admin'in ekrandan tanimladigi alan eslemesi (`metadataFields`) hic okunmuyordu.
//      Smart, flow'un gercek alan adlariyla (ElementName) eslesmeyen bir govdeyi
//      "400 Invalid Request" ile reddeder — OpsX'te yasanan arizanin aynisi
//      (bkz. server/smart/metadata.cjs basligi).
// Uretimde SMART hic tanimlanmadigi icin bu yol bir kez bile kosmadi; hata gorunmedi.
//
// Sablon VARSA Self Service ve OpsX ile AYNI isleyiciden gecer; ScaleX'e ozgu degerler
// `{{scalex.ortam}}`, `{{scalex.namespace}}`, `{{scalex.uygulamalar}}` ... ile kullanilir.
// Sablon YOKSA ayni degerler duz bir NESNE olarak gider (kapi bu durumda zaten "hazir
// degil" der; bu dal yalnizca dogrudan cagiranlar icin).
const ISLEM_ADI = Object.freeze({ stop: 'Durdur', restore: 'Geri Al', scale: 'Ölçekle' });

function scalexSmartBaglami({
  user,
  env,
  tenant,
  clusters,
  namespace,
  apps,
  action,
  targetReplicas,
  radius,
  reason,
  ocoNumber,
}) {
  const islem = ISLEM_ADI[action] || String(action || '');
  const clusterlar = (clusters || []).join(', ');
  const uygulamalar = (apps || []).join(', ');
  return {
    talepEden: String(user?.username || ''),
    ortam: String(env || ''),
    tenant: String(tenant || ''),
    clusterlar,
    namespace: String(namespace || ''),
    uygulamalar,
    islem,
    hedefSayisi: String(radius?.targets ?? ''),
    hedefReplica: action === 'scale' ? String(targetReplicas ?? '') : '',
    gerekce: reason || '-',
    oco: String(ocoNumber || '-'),
    ozet: `ScaleX ${islem}: ${namespace} (${env} / ${tenant}) — ${uygulamalar} @ ${clusterlar}`,
  };
}

function buildScaleXSmartMetadata(metadataFieldsRaw, ctx, scalex) {
  if (!String(metadataFieldsRaw || '').trim()) return { ...scalex };
  return require('../smart/metadata.cjs').buildSmartMetadata(metadataFieldsRaw, {
    ...(ctx || {}),
    scalex,
  });
}

// Is bitince kaydi ve AYNAYI guncelle.
//
// AYNA YALNIZCA DOGRULANMIS hedefler icin guncellenir: playbook `VERIFY;OK` demedigi
// bir uygulama icin "durduruldu" yazmak, ekranin YALAN soylemesi olurdu.
// `result_json` icin GUVENLI serilestirme.
//
// Onceki hali `JSON.stringify(parsed).slice(0, 1_000_000)` idi — kirpma JSON-FARKINDA
// DEGIL: 1 MB'i asan bir sonucta alan JSON olarak AYRISTIRILAMAZ hale geliyor ve bu
// SESSIZ oluyordu. Playbook kendi kirpmasini bayrakla bildiriyor (`rows_truncated`);
// sunucu tarafindaki bu kirpma hicbir iz birakmiyordu.
//
// Cozum: VERI duzeyinde kucult. Once `rows` (acik ara en buyuk alan), sonra `targets`
// atilir ve her adimda bir bayrak birakilir. Kayit her zaman GECERLI JSON kalir ve
// okuyan taraf neyin eksik oldugunu BILIR.
const RESULT_JSON_MAX = 1000000;

function storableResult(parsed) {
  if (!parsed) return null;
  let out = parsed;
  let json = JSON.stringify(out);
  if (json.length <= RESULT_JSON_MAX) return json;

  out = { ...out, rows: [], rowsDroppedForStorage: true };
  json = JSON.stringify(out);
  if (json.length <= RESULT_JSON_MAX) return json;

  out = { ...out, targets: [], targetsDroppedForStorage: true };
  json = JSON.stringify(out);
  if (json.length <= RESULT_JSON_MAX) return json;

  // Buraya dusmek icin ozet alanlarin TEK BASINA 1 MB'i asmasi gerekir — pratikte
  // imkansiz. Yine de sessiz bozuk JSON birakmaktansa ACIK bir isaret birakilir.
  return JSON.stringify({
    overallStatus: out.overallStatus,
    stage: out.stage,
    mode: out.mode,
    action: out.action,
    namespace: out.namespace,
    jobId: out.jobId,
    storageError: 'sonuc kaydi 1 MB sinirini asti; ayrintilar AWX job logunda',
  });
}

async function finalizeOperation({ serverId, jobId, status, parsed }) {
  try {
    const { rows } = await db.query(
      `SELECT * FROM scalex_operations WHERE awx_server_id = $1 AND awx_job_id = $2`,
      [serverId, jobId],
    );
    if (!rows.length || rows.every((r) => r.status !== 'RUNNING')) return;

    await db.query(
      `UPDATE scalex_operations
          SET status = 'FINISHED', overall_status = $3, result_json = $4, updated_at = GETUTCDATE()
        WHERE awx_server_id = $1 AND awx_job_id = $2 AND status = 'RUNNING'`,
      [
        serverId,
        jobId,
        parsed ? parsed.overallStatus : String(status.status || '').toUpperCase(),
        storableResult(parsed),
      ],
    );

    // Ortak alanlar (env/tenant/namespace/username) TUM satirlarda ayni — ayni
    // istekten uretiliyorlar. Farkli olan tek sey `cluster_name`, ve `operation_id`
    // o cluster'in KENDI satirina baglanmali: `rows[0].id` yazmak, bes cluster'lik
    // bir istekte "hangi cluster'i geri alacagim" sorusunun cevabini bozardi.
    const op = rows[0];

    // ISIN GERCEK SONUCU DENETIME — `apply` kontrolunden ONCE.
    // Buraya kadar denetim kaydinda yalnizca "X kullanicisi stop BASLATTI" vardi;
    // isin gercekten calisip calismadigi, kac hedefin dustugu HIC YOKTU. `dry_run` da
    // yazilir: "on kontrol kostu ve ne dedi" sorusu da denetlenebilir olmali.
    //
    // `req` YOK — bu fonksiyon uzlastiricidan da cagriliyor. `auditPortal` bunu
    // destekler; kullanici islem satirindan alinir.
    //
    // `detail` 2000 KARAKTERDE KIRPILIYOR (hash'ten ONCE, bkz. server/audit/index.cjs):
    // ham `rows`/`targets` buraya KONMAZ. Denetime OZET, ham cikti `result_json`a.
    auditPortal(null, 'scalex_finalize', {
      username: op.username,
      result: parsed && parsed.overallStatus === 'FAIL' ? 'fail' : 'ok',
      detail: JSON.stringify({
        serverId,
        jobId,
        env: op.env,
        tenant: op.tenant,
        namespace: op.namespace,
        action: parsed ? parsed.action : op.action,
        mode: parsed ? parsed.mode : op.execution_mode,
        overallStatus: parsed ? parsed.overallStatus : null,
        counts: parsed ? parsed.counts : null,
      }),
    });

    if (!parsed || parsed.mode !== 'apply') return;
    const idByCluster = new Map(rows.map((r) => [r.cluster_name, r.id]));
    // Aynaya NE YAZILDIGI da ayri bir iz — asagida bkz. `scalex_mirror_update`.
    const mirror = { stopped: [], restored: [], unlocked: [] };
    for (const t of parsed.targets) {
      // ── "UYGULANDI MI" ile "OK MI" AYRI SORULAR ────────────────────────────
      //
      // URETIM (2026-09-17, is #3326330): geri alma WARN dondu, portal "geri
      // alinamadi" yazdi, uygulama AYAKTAYDI (replicas 1, readyReplicas 1, pod
      // Running) ve ayni is `STATE;OK;Deleted restore state ConfigMap` basmisti.
      // Betik isi basarili saydi, portal basarisiz — iki taraf ZIT karar verdi.
      //
      // Sebep: acmada pod'un hazir olmasi butceyi gecince betik UYARIR ve isi
      // basarili sayar (kullanici karari: "beklemeyi birak, uyari yaz, is
      // basarili bitsin"). O hedef `WARN` doner; `status !== 'OK'` onu HATA
      // sayiyordu. Karar artik `verified` alanindan geliyor: replica degisikligi
      // CLUSTER'DA UYGULANDI mi?
      //
      // `verified` YOKSA (paket 7 ve oncesi) `false` gelir ve ESKI davranis
      // gecerli olur — geriye uyumlu.
      const applied = t.status === 'OK' || t.verified === true;
      if (!applied) {
        // BASARISIZ GERI ALMA: kilit BIZDE kalmamali. Basarili yolda satir zaten
        // siliniyor (`clearRestored`), ama FAIL/WARN donen bir hedefin ayna satiri
        // `restoring` fazinda asili kalirdi ve kullanici o uygulamayi bir daha hic
        // geri alamazdi. Uzlastiricinin yetim kilit turu bunu nihayetinde toplar;
        // burada ANINDA birakiyoruz ki kullanici hemen tekrar deneyebilsin.
        if (parsed.action === 'restore') {
          // KILIDI BIRAKMAKLA YETINME — SONUCU DA YAZ.
          //
          // Eskiden yalnizca kilit birakiliyordu; satir "durdurulmus" olarak
          // kaliyor ama DENENDIGI hicbir yerde yazmiyordu. Kullanici dort
          // cluster'i geri alip ikisi olmadiginda, o iki satiri HIC DENENMEMIS
          // olanlardan ayirt edemiyordu — ve neden olmadigini da goremiyordu.
          // `recordRestoreFailure` kilidi de birakir (tek UPDATE).
          await state
            .recordRestoreFailure({
              env: op.env,
              tenant: op.tenant,
              clusterName: t.cluster,
              namespace: op.namespace,
              appName: t.app,
              error: t.detail || `Hedef ${t.status} dondu.`,
            })
            .then(() => {
              mirror.unlocked.push(`${t.cluster}/${t.app}`);
            })
            .catch((e) => console.warn('[ScaleX] geri alma sonucu yazilamadi:', e.message));
        }
        continue;
      }
      if (parsed.action === 'stop') {
        // `previous_replicas` sonuc satirinda YOK — kesif/durum denetimi onu getirir.
        // Burada yalnizca "durduruldu" gercegi kaydedilir; `[Durumu Tazele]` ayrintiyi
        // cluster'dan alir. Uydurulmus bir sayi yazmak, geri almayi BOZARDI.
        await state.upsertStopped({
          env: op.env,
          tenant: op.tenant,
          clusterName: t.cluster,
          namespace: op.namespace,
          appName: t.app,
          workloadKind: t.kind,
          previousReplicas: null,
          stoppedBy: op.username,
          // Sahibin gruplari ISLEM KAYDINDAN gelir: bu kod yolunda oturum YOK
          // (is AWX'ten donerken isleniyor). `null` kalirsa kayit "grup bilgisi
          // yazilmamis" sayilir ve gorunurlukte eski kayitlar gibi ele alinir.
          stoppedByGroups: (() => {
            try {
              const v = JSON.parse(op.username_groups || 'null');
              return Array.isArray(v) ? v : null;
            } catch {
              return null;
            }
          })(),
          operationId: idByCluster.get(t.cluster) ?? op.id,
        });
        mirror.stopped.push(`${t.cluster}/${t.app}`);
      } else if (parsed.action === 'restore') {
        await state.clearRestored({
          env: op.env,
          tenant: op.tenant,
          clusterName: t.cluster,
          namespace: op.namespace,
          appName: t.app,
        });
        // IZDE AYRIMI KORU: "OK" ile "uygulandi ama pod hazir olmayi surduruyor"
        // ayni sey degil. Ayna ikisinde de temizlenir (kayit anlamsizlastigi icin)
        // ama denetim kaydi hangisinin yasandigini SOYLEMELI.
        mirror.restored.push(
          t.status === 'OK' ? `${t.cluster}/${t.app}` : `${t.cluster}/${t.app} (uyarili)`,
        );
      }
    }
    // AYNA DEGISIKLIGI AYRI BIR IZ. Sapma tespitinin ("biri portal disindan is
    // yapmis") ve geri alma yolunun dayandigi tablo bu; ne zaman ve hangi islemle
    // degistigi denetlenebilir olmali.
    if (mirror.stopped.length || mirror.restored.length || mirror.unlocked.length) {
      auditPortal(null, 'scalex_mirror_update', {
        username: op.username,
        detail: JSON.stringify({
          serverId,
          jobId,
          env: op.env,
          tenant: op.tenant,
          namespace: op.namespace,
          stopped: mirror.stopped,
          restored: mirror.restored,
          unlocked: mirror.unlocked,
        }),
      });
    }
  } catch (e) {
    // Sonuc gosterimini BLOKLAMA: ayna guncellenemedi diye kullanicinin isinin sonucunu
    // gizlemek, cozdugu sorundan buyuk bir sorun olurdu. Sapma zaten `[Durumu Tazele]`
    // ile yakalanir.
    console.warn('[ScaleX] islem sonuclandirilamadi:', e.message);
  }
}

module.exports = {
  initScaleX,
  denyIfNotOwner,
  resolveByKey,
  buildScaleXSmartMetadata,
  scalexSmartBaglami,
  resolveGatePolicy,
  runScaleXGates,
  finalizeOperation,
};
