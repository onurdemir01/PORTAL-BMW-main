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
const launch = require('./launch.cjs');
const state = require('./state.cjs');
const result = require('./result.cjs');

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
        [jobId, serverId]
      );
      owner = rows.length && rows[0].username ? String(rows[0].username).toLowerCase() : null;
    } catch (e) {
      console.warn('[ScaleX] sahiplik sorgusu basarisiz — erisim reddedildi:', e.message);
      return { status: 503, message: 'İş sahipliği doğrulanamadı, lütfen tekrar deneyin.' };
    }
  }
  if (!owner || owner !== me) return { status: 403, message: 'Bu iş size ait değil.' };
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
      new Error(`"${keyName}" playbook kaydı tanımlı/etkin değil — Admin > Playbook Kayıtları ekranından tanımlayın.`),
      { status: 501 }
    );
  }
  const templateId = playbookRegistry.getEffectiveTemplateId(row);
  if (!templateId) {
    throw Object.assign(
      new Error(`"${keyName}" için AWX Template ID girilmemiş — Admin > Playbook Kayıtları.`),
      { status: 501 }
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
  requestKey, username, env, tenant, clusters, namespace, action, executionMode,
  targetReplicas, apps, serverId, jobId, status, ocoNumber, reason, smartTicketId = null,
}) {
  for (const cluster of clusters) {
    await db.query(
      `INSERT INTO scalex_operations
         (request_key, username, env, tenant, cluster_name, namespace, action, execution_mode,
          target_replicas, app_names_json, awx_server_id, awx_job_id, status, oco_number, reason,
          smart_ticket_id, approval_state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [requestKey, username, env, tenant, cluster, namespace, action, executionMode,
        action === 'scale' ? Number(targetReplicas) : null, JSON.stringify(apps),
        serverId ?? null, jobId ?? null, status, String(ocoNumber || '') || null, reason || null,
        smartTicketId, smartTicketId ? 'PENDING' : null]
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
async function runScaleXGates({
  req, user, policy, env, tenant, clusters, namespace, apps, action, executionMode,
  targetReplicas, extraVars, reason, ocoNumber,
}) {
  if (policy.smart !== 'require' && policy.oco !== 'require') return { outcome: 'proceed' };

  const gateVars = launch.buildGateVars({ env, tenant, action, executionMode, clusters, namespace });
  // SMART/OCO AYARLARI URETIMDEKI YAPIDAN GELIR. Self Service'teki nginx isleri
  // gibi, ayarlar `ansible_ss_customizations` tablosunda ScaleX'in KENDI
  // (awxServerId, templateId) satirinda durur ve admin bunlari `FieldOverridesModal`
  // ekranindan — nginx isi icin kullandigi ekranin AYNISINDAN — yonetir.
  // Env degiskeni ya da client'tan gelen deger KULLANILMAZ: birincisi ikinci bir
  // ayar yuzeyi olurdu, ikincisi kullanicinin kendi kapisini yapilandirmasi demekti.
  const { templateId: runTemplateId, serverId: runServerId } = await resolveByKey(RUN_KEY);
  const svcConfig = await require('../ansible/ss-customizations.cjs').readCustom(runServerId, runTemplateId);
  // FAIL-CLOSED: SMART "gerekli" iken AYAR YOKSA is BASLATILMAZ.
  //
  // `smart-gate.isSmartRequired` bos ayarda `false` doner (`!smartApproval.enabled`).
  // Bu, Self Service icin dogru varsayilan — orada SMART opsiyonel bir eklenti. Ama
  // ScaleX'te `policy.smart === 'require'` demek "bu islem onaysiz yapilmamali"
  // demek; ayar satiri yoksa sessizce onaysiz gecmek, kapiyi HIC KOYMAMAKLA ayni
  // sey olurdu. Ustelik ekran kullaniciya "SMART kaydi acilacak" YAZIYOR — sessiz
  // gecis, kullaniciya YALAN soylenmesi anlamina gelirdi.
  if (policy.smart === 'require' && !svcConfig.smartApproval?.enabled) {
    return {
      outcome: 'error', status: 503,
      body: {
        ok: false, code: 'smart_not_configured',
        message: 'ScaleX için SMART onay yapılandırması yapılmamış; değişiklik uygulanmadı. '
          + 'Admin > Ansible > Self Servis Özelleştirmeleri ekranından ScaleX şablonu için '
          + 'SMART onayını (flowKey ve metadata alanları) tanımlayın. '
          + 'Bu arada "Önce kontrol et" modu kullanılabilir — hiçbir değişiklik yapmaz.',
      },
    };
  }
  const overrides = {
    // `restore` icin OCO UYARIR ama ENGELLEMEZ → kapiyi hic acmiyoruz; gerekce
    // zaten cagiranda zorunlu kilindi ve kayda + SMART'a gidiyor.
    // Admin OCO'yu kapatmis olsa bile prod'da acik tutuyoruz — bu sayfa bir
    // kesinti araci, kapinin varsayilani "acik" olmali.
    ocoCheck: { enabled: policy.oco === 'require' },
    smartApproval: svcConfig.smartApproval || {},
  };
  const radius = launch.computeBlastRadius({ clusters, apps, environment: env, action, executionMode });
  const decision = await launch.gates.runChangeGates({
    // GERCEK sunucu/template kimligi — 0 DEGIL. SMART onayi geldiginde bilet
    // `runner.cjs` tarafindan oynatiliyor ve orada `getServerById(ticket.awxServerId)`
    // cagriliyor; 0 yazilsaydi onaylanmis bir prod islemi "AWX sunucusu bulunamadi"
    // ile SESSIZCE olur, kullanici onayladigi isin hic calismadigini yalnizca hata
    // logundan ogrenebilirdi. Template kimligi de gercek olmali, yoksa oynatma
    // YANLIS sablonu tetiklerdi.
    server: { id: runServerId }, templateId: runTemplateId, username: user.username, req,
    overrides, extraVars, gateVars, detail: {}, resolvedLaunchOptions: {}, specFields: [],
    templateName: 'ScaleX',
    ocoNumber,
    // OCO PENCERESI HENUZ ACILMADIYSA: ortak kapi normalde kullaniciya
    // "zamanla mi, sonra mi?" diye sorar (400 `ocoDecisionRequired`). ScaleX icin
    // ZAMANLAMA YOK — asagidaki `createOcoAwxSchedule` bilerek hata firlatiyor
    // (bir kesinti araci, kendiliginden ateslenen ertelenmis is birakmamali).
    // Dolayisiyla sorulan iki secenekten biri HER ZAMAN patlardi ve ekranda o
    // secimi yapacak alan da yok: kullanici "Calistir"a basar, ayni mesaji alir,
    // tekrar basar — kapali dongu. Var olmayan secimi sormak yerine tek gecerli
    // cevabi veriyoruz: `later` → is BASLATILMAZ, kullanici pencere acildiginda
    // geri gelir. Ekran bunu `ocoDeferred` ile net bir mesaj olarak gosterir.
    ocoAction: 'later',
    createOcoAwxSchedule: async () => {
      throw Object.assign(new Error('ScaleX işlemleri zamanlanamaz — pencere açıkken tekrar deneyin.'), { status: 400 });
    },
    friendlyAwxError: (e) => ({ status: e.status || 502, message: e.message }),
    buildSmartMetadata: () => buildScaleXSmartMetadata({ user, env, tenant, clusters, namespace, apps, action, radius, reason, ocoNumber }),
  });

  // IZ: kapinin her karari — is baslamamis olsa bile — denetime yazilir. Kapida
  // duran calistirmalar uzun sure ScaleX adina HICBIR audit satiri birakmiyordu;
  // yalnizca `selfservice_*` kayitlari kaliyordu ve hangi ScaleX istegine ait
  // olduklari kayitlardan okunamiyordu.
  if (decision?.outcome !== 'proceed') {
    auditPortal(req, 'scalex_gate_decision', {
      detail: JSON.stringify({
        env, tenant, clusters, namespace, apps, action, executionMode,
        outcome: decision?.outcome ?? 'bilinmiyor', policy,
        ocoRequired: decision?.body?.ocoRequired ?? false,
        ocoDeferred: decision?.body?.ocoDeferred ?? false,
        ocoExpired: decision?.body?.ocoExpired ?? false,
        pendingApproval: decision?.body?.pendingApproval ?? false,
        ticketId: decision?.body?.ticketId ?? null,
      }),
    });
  }

  if (decision?.outcome === 'error') return { outcome: 'error', status: decision.status, body: decision.body };
  if (decision?.outcome === 'respond') {
    // SMART bileti ACILDI: is AWX'te henuz YOK, ama portal kaydi SIMDI yazilmali.
    // Yazilmazsa onay geldiginde is calisir ve portal bunu hic ogrenemez —
    // ayna guncellenmez, geri alma yolu kapanir (bkz. insertOperationRows).
    if (decision.body?.pendingApproval && decision.body?.ticketId) {
      await insertOperationRows({
        requestKey: `smart:${decision.body.ticketId}`,
        username: user.username, env, tenant, clusters, namespace, action, executionMode,
        targetReplicas, apps, serverId: runServerId, jobId: null, status: 'PENDING_APPROVAL',
        ocoNumber, reason, smartTicketId: Number(decision.body.ticketId),
      });
    }
    return { outcome: 'respond', body: decision.body };
  }
  if (decision?.outcome !== 'proceed') {
    console.error('[ScaleX] taninmayan kapi karari — is BASLATILMADI:', JSON.stringify(decision));
    return {
      outcome: 'error', status: 500,
      body: { ok: false, message: 'Değişiklik kapısı beklenmeyen bir sonuç döndürdü; iş güvenlik gereği başlatılmadı.' },
    };
  }
  return { outcome: 'proceed' };
}

function currentUser(req) {
  return req.session?.user || { username: 'anonymous', role: 'User' };
}

function asyncRoute(fn) {
  return (req, res) => fn(req, res).catch((err) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[ScaleX]', err);
    res.status(status).json({ ok: false, message: err.message, code: err.code });
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
  const clusters = [...new Set((Array.isArray(b.clusters) ? b.clusters : []).map((c) => String(c).trim()).filter(Boolean))];
  const apps = [...new Set((Array.isArray(b.apps) ? b.apps : []).map((a) => String(a).trim()).filter(Boolean))];

  if (!env || !tenant) throw Object.assign(new Error('env ve tenant zorunlu.'), { status: 400 });
  if (!clusters.length) throw Object.assign(new Error('En az bir cluster seçilmeli.'), { status: 400 });
  if (requireApps && !apps.length) throw Object.assign(new Error('En az bir uygulama seçilmeli.'), { status: 400 });

  await catalog.assertClustersExist({ env, tenant, clusters });
  await catalog.assertNamespaceAllowed({ env, tenant, clusters, namespace, user });
  if (apps.length) await catalog.assertAppsAllowed({ env, tenant, clusters, namespace, apps, user });

  return { user, env, tenant, namespace, clusters, apps };
}

async function launchOnAwx({ keyName, extraVars, req, label }) {
  const { templateId, serverId } = await resolveByKey(keyName);
  // "Prompt on launch > Variables" kapaliysa AWX gonderdigimiz her seyi SESSIZCE yutar,
  // HTTP 201 doner ve playbook survey varsayilanlariyla calisir. Bu tuzak bu kurumda
  // uretimde yasandi; is BASLATILMADAN once kesiliyor.
  await templatePreflight.assertTemplateAcceptsExtraVars(serverId, templateId, extraVars, { label });
  const job = await runner.launchJobOnServer(serverId, templateId, extraVars, '', req.session?.user);
  rememberJobOwner(serverId, job.jobId, currentUser(req).username);
  try {
    await db.query(
      `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, started_at, params)
       VALUES ($1,$2,$3,$4,$5,$6,GETUTCDATE(),$7)`,
      [currentUser(req).username, serverId, templateId, label.slice(0, 500), job.jobId, job.status,
        JSON.stringify({ label })]
    );
  } catch (e) {
    // Gecmis kaydi yazilamadi — is ZATEN BASLADI, geri alinamaz. Sessizce yutmak yerine
    // logluyoruz; sahiplik kontrolu bellek-ici yedege duser.
    console.warn('[ScaleX] ansible_job_history yazilamadi:', e.message);
  }
  return { serverId, templateId, jobId: job.jobId, status: job.status };
}

function initScaleX(app) {
  const express = require('express');
  const router = express.Router();

  let requireAuth = (req, res) => res.status(401).json({ ok: false, message: 'Auth modülü yok.' });
  try {
    const authMod = require('../auth/index.cjs');
    if (typeof authMod.requireAuth === 'function') requireAuth = authMod.requireAuth;
  } catch { /* auth yoksa deny kalir */ }

  router.use(express.json({ limit: '512kb' }));
  router.use(requireAuth);
  try {
    router.use(require('../auth/visibility.cjs').requireVisiblePrefix('ScaleX'));
  } catch { /* gorunurluk motoru yoksa auth tek basina korur */ }

  // ── Katalog ───────────────────────────────────────────────────────────────
  router.get('/clusters', asyncRoute(async (req, res) => {
    res.json({ ok: true, tree: await catalog.getClusterTree() });
  }));

  router.get('/namespaces', asyncRoute(async (req, res) => {
    const env = String(req.query.env || '').trim();
    const tenant = String(req.query.tenant || '').trim();
    const clusters = String(req.query.clusters || '').split(',').map((c) => c.trim()).filter(Boolean);
    if (!env || !tenant || !clusters.length) {
      throw Object.assign(new Error('env, tenant ve clusters zorunlu.'), { status: 400 });
    }
    res.json({ ok: true, ...(await catalog.getNamespaces({ env, tenant, clusterNames: clusters, user: currentUser(req) })) });
  }));

  // ── Kesif (salt okunur) ───────────────────────────────────────────────────
  router.post('/discover', asyncRoute(async (req, res) => {
    const mode = ['workloads', 'state', 'health'].includes(req.body?.mode) ? req.body.mode : 'workloads';
    const { env, tenant, namespace, clusters, apps } = await resolveScope(req, { requireApps: mode === 'health' });
    // Kesif de bu degerleri playbook'a, oradan `oc` komut satirina tasiyor — `/preview`
    // ve `/run` ile AYNI format kurallari burada da gecerli (bkz. launch.cjs basligi).
    launch.assertValidDiscoveryTargets({ namespace, apps });
    const extraVars = {
      scalex_clusters_override: launch.buildScaleXClusterCatalog({
        env, tenant, clusters,
        hosts: (await require('../logx/v2/admin.cjs').resolveTerminalHosts(env, tenant, clusters)).hosts,
        meta: await require('../logx/v2/admin.cjs').resolveClusterMeta(env, tenant, clusters),
      }),
      target_platform: tenant, target_environment: env, target_namespace: namespace,
      scalex_target_clusters: clusters, discovery_mode: mode,
      ...(apps.length ? { target_app_names: apps.join(',') } : {}),
    };
    const job = await launchOnAwx({ keyName: DISCOVERY_KEY, extraVars, req, label: `ScaleX keşif (${mode}) — ${namespace}` });
    // IZ: kesif salt-okunur ama YINE DE kullanici girdisini (`namespace`,
    // `target_app_names`) AWX uzerinden `oc` komut satirina tasiyor. Denetim kaydi
    // olmadan "bu namespace'i kim tarattı" sorusu yanitlanamiyordu.
    auditPortal(req, 'scalex_discovery', {
      detail: JSON.stringify({ env, tenant, clusters, namespace, apps, mode, jobId: job.jobId }),
    });
    res.json({ ok: true, mode, ...job });
  }));

  router.get('/discover/:serverId/:jobId/status', asyncRoute(async (req, res) => {
    const serverId = Number(req.params.serverId);
    const jobId = Number(req.params.jobId);
    const denied = await denyIfNotOwner(req, serverId, jobId);
    if (denied) return res.status(denied.status).json({ ok: false, message: denied.message });
    const [status, output] = await Promise.all([
      runner.getJobStatusOnServer(serverId, jobId),
      runner.getJobOutputOnServer(serverId, jobId).catch(() => ({ output: '' })),
    ]);
    const parsed = result.extractDiscoveryResult(status.artifacts);

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
          env: parsed.environment, tenant: parsed.platform,
          scannedClusters: parsed.clusters || [],
          clusterStates: (parsed.states || []).map((st) => ({
            env: parsed.environment, tenant: parsed.platform,
            clusterName: st.cluster, namespace: parsed.namespace, appName: st.appName,
            previousReplicas: st.previousReplicas, phase: st.phase,
            stoppedBy: st.createdBy, workloadKind: st.kind, legacy: st.legacy,
          })),
        });
      } catch (e) {
        // Sapma tazelenemedi — kesif sonucunu GIZLEME. Kullanici listeyi yine gorur,
        // yalnizca sapma isaretleri bir onceki taramadan kalir.
        console.warn('[ScaleX] sapma tazelenemedi:', e.message);
      }
    }

    res.json({
      ok: true, status: status.status, finished: !!status.finished, failed: !!status.failed,
      output: output.output || '', result: parsed,
    });
  }));

  // ── Onizleme — HICBIR SEY TETIKLEMEZ, HICBIR SEY KAYDETMEZ ────────────────
  // Asil karar `/run`da YENIDEN verilir; bu uc yalnizca ekrani besler.
  router.post('/preview', asyncRoute(async (req, res) => {
    const { env, tenant, namespace, clusters, apps } = await resolveScope(req);
    const action = String(req.body?.action || 'stop');
    const executionMode = String(req.body?.executionMode || 'dry_run');
    const targetReplicas = req.body?.targetReplicas;
    launch.assertValidTargets({
      namespace, apps, action, targetReplicas, executionMode,
      verificationTimeout: req.body?.verificationTimeout ?? '60',
    });
    const radius = launch.computeBlastRadius({ clusters, apps, environment: env, action, executionMode });
    const policy = launch.gatePolicyFor({ action, executionMode, environment: env });
    res.json({
      ok: true, blastRadius: radius, gatePolicy: policy,
      hpaPinAllowed: launch.isHpaPinAllowed({ action, targetReplicas, restoreTargets: req.body?.restoreTargets }),
      targets: { env, tenant, namespace, clusters, apps },
    });
  }));

  // ── Calistirma ────────────────────────────────────────────────────────────
  router.post('/run', asyncRoute(async (req, res) => {
    const { user, env, tenant, namespace, clusters, apps } = await resolveScope(req);
    const action = String(req.body?.action || '');
    const executionMode = String(req.body?.executionMode || '');
    const targetReplicas = req.body?.targetReplicas;
    const verificationTimeout = req.body?.verificationTimeout ?? '60';
    const allowPartial = req.body?.allowPartial !== false;
    const reason = String(req.body?.reason || '').trim();
    // CC kullanicidan gelir ve mail gorevine ulasir — satir sonu/format dogrulanmadan
    // gecerse SMTP baslik enjeksiyonu mumkun olurdu.
    const mailCc = launch.sanitizeMailCc(req.body?.mailCc);
    // Client `hpaPin: true` gonderse bile kurallar SUNUCUDA uygulanir.
    const hpaPin = req.body?.hpaPin === true
      && launch.isHpaPinAllowed({ action, targetReplicas, restoreTargets: req.body?.restoreTargets });

    launch.assertValidTargets({ namespace, apps, action, targetReplicas, executionMode, verificationTimeout });

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
        new Error('Replica sayısını 0 yapmak için "Durdur" işlemini kullanın — önceki değer saklanır ve geri alabilirsiniz. "Ölçekle" ile 0 verildiğinde geri alınacak bir kayıt oluşmaz.'),
        { status: 400, code: 'use_stop_for_zero' }
      );
    }

    const radius = launch.computeBlastRadius({ clusters, apps, environment: env, action, executionMode });
    if (radius.exceedsMaxTargets) {
      throw Object.assign(
        new Error(`Tek işlemde en fazla ${launch.MAX_TARGETS} hedef: ${radius.targets} seçildi (${radius.clusterCount} cluster × ${radius.appCount} uygulama).`),
        { status: 400 }
      );
    }
    // YAZILI ONAY: kullanici namespace adini ELLE yazar. Client'in `writtenConfirm`
    // alanini uydurmasi ise yaramaz — deger namespace ile BIREBIR eslesmek zorunda.
    if (radius.requiresWrittenConfirm && String(req.body?.writtenConfirm || '').trim() !== namespace) {
      return res.status(400).json({
        ok: false, writtenConfirmRequired: true, blastRadius: radius,
        message: `Bu işlem ${radius.targets} hedefi etkiliyor ve ortam prod. Onaylamak için namespace adını yazın: ${namespace}`,
      });
    }

    const policy = launch.gatePolicyFor({ action, executionMode, environment: env });
    // Geri alma OCO penceresi disinda da calisabilir ama GEREKCESIZ calisamaz —
    // iz kalmali ve gerekce hem portal kaydina hem SMART metadata'sina gitmeli.
    if (policy.oco === 'warn' && !reason) {
      return res.status(400).json({
        ok: false, reasonRequired: true,
        message: 'Geri alma işlemi için gerekçe zorunlu (örn. olay/kayıt numarası).',
      });
    }

    // Mail: oturumdaki kullanicinin adresi. CC istege bagli.
    const mailTo = String(user.mail || '').trim();
    if (!mailTo) {
      throw Object.assign(
        new Error('Oturumunuzda e-posta adresi yok; rapor gönderilemez. Yöneticinize başvurun.'),
        { status: 400 }
      );
    }

    const extraVars = await launch.buildRunExtraVars({
      env, tenant, clusters, namespace, apps, action, executionMode,
      targetReplicas, verificationTimeout, allowPartial, mailTo, mailCc, hpaPin,
    });

    // ── KAPILAR ─────────────────────────────────────────────────────────────
    // Govde ORTAK: `/run` ve `/restore-all` AYNI kapidan gecer. Iki kopya tutmak,
    // birinde yapilan duzeltmenin digerinde sessizce eskimesi demekti — `/restore-all`
    // tam olarak boyle kapisiz kalmisti (yorumu "Geri Al'in kapi politikasini
    // devralir" DIYORDU, kod devralmiyordu).
    const gate = await runScaleXGates({
      req, user, policy, env, tenant, clusters, namespace, apps, action, executionMode,
      targetReplicas, extraVars, reason, ocoNumber: req.body?.ocoNumber,
    });
    if (gate.outcome === 'error') return res.status(gate.status).json(gate.body);
    if (gate.outcome === 'respond') return res.json(gate.body);
    const job = await launchOnAwx({
      keyName: RUN_KEY, extraVars, req,
      label: `ScaleX ${action} (${executionMode}) — ${namespace} @ ${clusters.join(',')}`,
    });

    await insertOperationRows({
      requestKey: `${job.serverId}:${job.jobId}`,
      username: user.username, env, tenant, clusters, namespace, action, executionMode,
      targetReplicas, apps, serverId: job.serverId, jobId: job.jobId, status: 'RUNNING',
      ocoNumber: req.body?.ocoNumber, reason,
    });

    auditPortal(req, 'scalex_operation', {
      // HPA'ya dokunmak politikanin tersi — denetim kaydinda ACIKCA gorunmeli.
      detail: JSON.stringify({ env, tenant, clusters, namespace, apps, action, executionMode, targets: radius.targets, jobId: job.jobId, hpaPin }),
    });
    res.json({ ok: true, ...job, blastRadius: radius });
  }));

  router.get('/run/:serverId/:jobId/status', asyncRoute(async (req, res) => {
    const serverId = Number(req.params.serverId);
    const jobId = Number(req.params.jobId);
    const denied = await denyIfNotOwner(req, serverId, jobId);
    if (denied) return res.status(denied.status).json({ ok: false, message: denied.message });
    const [status, output] = await Promise.all([
      runner.getJobStatusOnServer(serverId, jobId),
      runner.getJobOutputOnServer(serverId, jobId).catch(() => ({ output: '' })),
    ]);
    const parsed = result.extractScaleXResult(status.artifacts);
    if (status.finished) await finalizeOperation({ serverId, jobId, status, parsed });
    res.json({
      ok: true, status: status.status, finished: !!status.finished, failed: !!status.failed,
      output: output.output || '', result: parsed,
      // Portal katalogu gonderdigi halde playbook DOSYAYA dustuyse AWX template'inde
      // "Prompt on launch > Variables" kapali demektir — kullanici bunu bilmeli.
      catalogWarning: parsed && parsed.catalogSource === 'file'
        ? 'Playbook cluster kataloğunu portaldan DEĞİL kendi dosyasından okudu — AWX template ayarını kontrol edin (Prompt on launch > Variables).'
        : null,
    });
  }));

  router.post('/cancel/:serverId/:jobId', asyncRoute(async (req, res) => {
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
      [serverId, jobId]
    );
    if (!own.length) {
      return res.status(404).json({ ok: false, message: 'Bu iş bir ScaleX işlemi değil.' });
    }
    const out = await runner.cancelJobOnServer(serverId, jobId);
    await db.query(
      `UPDATE scalex_operations SET status = 'CANCELLED', updated_at = GETUTCDATE()
        WHERE awx_server_id = $1 AND awx_job_id = $2 AND status = 'RUNNING'`,
      [serverId, jobId]
    );
    auditPortal(req, 'scalex_cancel', { detail: JSON.stringify({ serverId, jobId }) });
    res.json({ ok: true, ...out });
  }));

  // ── "Su an durdurulmus" + sapma ───────────────────────────────────────────
  router.get('/stopped', asyncRoute(async (req, res) => {
    const env = String(req.query.env || '').trim();
    const tenant = String(req.query.tenant || '').trim();
    const clusterName = String(req.query.cluster || '').trim() || null;
    if (!env || !tenant) throw Object.assign(new Error('env ve tenant zorunlu.'), { status: 400 });
    const all = await state.listMirror({ env, tenant, clusterName });
    // Bu uc `resolveScope`tan GECMEZ (namespace almiyor), bu yuzden yetki suzgeci
    // BURADA uygulanmali — aksi halde kisitli bir namespace'in adi ve orada durdurulmus
    // uygulamalar, o namespace'i goremeyen kullaniciya listelenirdi.
    const rows = await catalog.filterStoppedForUser(all, { env, tenant, user: currentUser(req) });
    // `truncated` FILTRELEMEDEN ONCE okunur: `filterStoppedForUser` yeni bir dizi
    // dondugu icin bayrak orada kaybolur.
    res.json({
      ok: true, items: rows,
      hiddenCount: all.length - rows.length,
      truncated: all.truncated === true, limit: state.MIRROR_LIMIT,
    });
  }));

  router.post('/adopt', asyncRoute(async (req, res) => {
    const user = currentUser(req);
    const { env, tenant, namespace, clusters } = await resolveScope(req, { requireApps: false });
    const appName = String(req.body?.appName || '').trim();
    if (!appName) throw Object.assign(new Error('appName zorunlu.'), { status: 400 });
    if (clusters.length !== 1) throw Object.assign(new Error('Portala alma tek cluster için yapılır.'), { status: 400 });
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
      throw Object.assign(new Error('previousReplicas 0-1000 arası tam sayı olmalı.'), { status: 400 });
    }
    const row = await state.adopt({
      env, tenant, clusterName: clusters[0], namespace, appName,
      workloadKind: req.body?.workloadKind || null,
      previousReplicas: prev,
      // KAYDI ALAN KISI OTURUMDAN. Client'in `stoppedBy` gondermesine izin vermek,
      // denetim izine BASKASININ adini yazdirmak demekti — panel bu alani "durduran
      // kisi" olarak gosteriyor.
      stoppedBy: user.username,
      adoptedBy: user.username,
    });
    auditPortal(req, 'scalex_adopt', { detail: JSON.stringify({ env, tenant, cluster: clusters[0], namespace, appName }) });
    res.json({ ok: true, item: row });
  }));

  // TOPLU GERI ALMA. Bir olay sirasinda 6 uygulamayi tek tek geri almak 6 ayri
  // is + 6 ayri onay demek; kurtarma sirasinda bu gercek bir maliyet.
  //
  // Gerekce ZORUNLU: bu uc, `Geri Al`in kapi politikasini (OCO uyarir-engellemez)
  // devralir ve gerekce hem portal kaydina hem SMART metadata'sina gider.
  router.post('/restore-all', asyncRoute(async (req, res) => {
    const user = currentUser(req);
    const env = String(req.body?.env || '').trim();
    const tenant = String(req.body?.tenant || '').trim();
    const reason = String(req.body?.reason || '').trim();
    if (!env || !tenant) throw Object.assign(new Error('env ve tenant zorunlu.'), { status: 400 });
    if (!reason) {
      return res.status(400).json({
        ok: false, reasonRequired: true,
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
      if (!groups.has(k)) groups.set(k, { cluster: r.clusterName, namespace: r.namespace, apps: [] });
      groups.get(k).apps.push(r.appName);
    }

    // KAPI: toplu geri alma da TEKIL `Geri Al` ile AYNI politikadan gecer.
    // Bu blok uzun sure YOKTU: yorum "Geri Al'in kapi politikasini devralir" diyordu
    // ama kod dogrudan `launchOnAwx` cagiriyordu. Yani prod'da tekil geri alma SMART
    // kaydi acarken TOPLU geri alma hicbir onay olmadan calisiyordu — kapiyi bir
    // dugmeyle atlamak mumkundu.
    const policy = launch.gatePolicyFor({ action: 'restore', executionMode: 'apply', environment: env });

    const launched = [];
    const pendingApproval = [];
    const blocked = [];
    for (const g of groups.values()) {
      const extraVars = await launch.buildRunExtraVars({
        env, tenant, clusters: [g.cluster], namespace: g.namespace, apps: g.apps,
        action: 'restore', executionMode: 'apply', targetReplicas: undefined,
        verificationTimeout: '60', allowPartial: true,
        mailTo: String(user.mail || '').trim(), mailCc: '',
      });

      const gate = await runScaleXGates({
        req, user, policy, env, tenant, clusters: [g.cluster], namespace: g.namespace,
        apps: g.apps, action: 'restore', executionMode: 'apply', targetReplicas: undefined,
        extraVars, reason, ocoNumber: undefined,
      });
      if (gate.outcome === 'error') {
        // HICBIR grup henuz baslamadiysa hata YAPILANDIRMA duzeyindedir (or.
        // `smart_not_configured`) ve her grup icin ayni sekilde duserdi — kullaniciyi
        // N kez ayni mesajla ugrastirmak yerine dogrudan don.
        if (!launched.length && !pendingApproval.length) return res.status(gate.status).json(gate.body);
        blocked.push({ cluster: g.cluster, namespace: g.namespace, message: gate.body?.message || 'Kapı reddetti.' });
        continue;
      }
      if (gate.outcome === 'respond') {
        if (gate.body?.pendingApproval) {
          pendingApproval.push({
            cluster: g.cluster, namespace: g.namespace, apps: g.apps,
            ticketId: gate.body.ticketId, externalTicketId: gate.body.externalTicketId,
          });
        } else {
          blocked.push({ cluster: g.cluster, namespace: g.namespace, message: gate.body?.message || 'İş başlatılmadı.' });
        }
        continue;
      }

      const job = await launchOnAwx({
        keyName: RUN_KEY, extraVars, req,
        label: `ScaleX toplu geri alma — ${g.namespace} @ ${g.cluster}`,
      });
      await insertOperationRows({
        requestKey: `${job.serverId}:${job.jobId}`,
        username: user.username, env, tenant, clusters: [g.cluster], namespace: g.namespace,
        action: 'restore', executionMode: 'apply', targetReplicas: undefined, apps: g.apps,
        serverId: job.serverId, jobId: job.jobId, status: 'RUNNING', ocoNumber: null, reason,
      });
      launched.push({ ...job, cluster: g.cluster, namespace: g.namespace, apps: g.apps });
    }

    auditPortal(req, 'scalex_restore_all', {
      detail: JSON.stringify({
        env, tenant, groups: groups.size, apps: targets.length, reason,
        launched: launched.length, pendingApproval: pendingApproval.length, blocked: blocked.length,
      }),
    });
    res.json({ ok: true, launched, pendingApproval, blocked });
  }));

  router.get('/history', asyncRoute(async (req, res) => {
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
      isAdmin ? [] : [user.username]
    );
    res.json({ ok: true, items: rows });
  }));

  app.use('/api/scalex', router);

  // EMNIYET AGI: islemleri sunucu tarafinda da sonuclandir. Bu cagri olmadan
  // `finalizeOperation` YALNIZCA tarayicinin yoklamasindan calisir ve kullanici
  // sekmeyi kapatirsa islem sonsuza dek RUNNING kalir, ayna hic yazilmaz ve
  // "Su an durdurulmus" paneli yanlis bilgi verir (bkz. reconciler.cjs basligi).
  require('./reconciler.cjs').startReconciler();

  console.log('[ScaleX] ScaleX API hazir (/api/scalex) + uzlastirici acik');
}

// SMART metadata'si. `reason` ve patlama yaricapi BILEREK iceride: onay veren kisi
// "kac hedefe dokunuluyor" ve "neden" sorularinin cevabini gormeli.
function buildScaleXSmartMetadata({ user, env, tenant, clusters, namespace, apps, action, radius, reason, ocoNumber }) {
  return [
    { key: 'requestedBy', value: user.username },
    { key: 'environment', value: env },
    { key: 'platform', value: tenant },
    { key: 'cluster', value: clusters.join(', ') },
    { key: 'namespace', value: namespace },
    { key: 'application', value: apps.join(', ') },
    { key: 'action', value: action },
    { key: 'blastRadius', value: String(radius.targets) },
    { key: 'reason', value: reason || '-' },
    { key: 'ocoNumber', value: String(ocoNumber || '-') },
  ];
}

// Is bitince kaydi ve AYNAYI guncelle.
//
// AYNA YALNIZCA DOGRULANMIS hedefler icin guncellenir: playbook `VERIFY;OK` demedigi
// bir uygulama icin "durduruldu" yazmak, ekranin YALAN soylemesi olurdu.
async function finalizeOperation({ serverId, jobId, status, parsed }) {
  try {
    const { rows } = await db.query(
      `SELECT * FROM scalex_operations WHERE awx_server_id = $1 AND awx_job_id = $2`,
      [serverId, jobId]
    );
    if (!rows.length || rows.every((r) => r.status !== 'RUNNING')) return;

    await db.query(
      `UPDATE scalex_operations
          SET status = 'FINISHED', overall_status = $3, result_json = $4, updated_at = GETUTCDATE()
        WHERE awx_server_id = $1 AND awx_job_id = $2 AND status = 'RUNNING'`,
      [serverId, jobId, parsed ? parsed.overallStatus : String(status.status || '').toUpperCase(),
        parsed ? JSON.stringify(parsed).slice(0, 1000000) : null]
    );

    if (!parsed || parsed.mode !== 'apply') return;
    // Ortak alanlar (env/tenant/namespace/username) TUM satirlarda ayni — ayni
    // istekten uretiliyorlar. Farkli olan tek sey `cluster_name`, ve `operation_id`
    // o cluster'in KENDI satirina baglanmali: `rows[0].id` yazmak, bes cluster'lik
    // bir istekte "hangi cluster'i geri alacagim" sorusunun cevabini bozardi.
    const op = rows[0];
    const idByCluster = new Map(rows.map((r) => [r.cluster_name, r.id]));
    for (const t of parsed.targets) {
      if (t.status !== 'OK') continue;
      if (parsed.action === 'stop') {
        // `previous_replicas` sonuc satirinda YOK — kesif/durum denetimi onu getirir.
        // Burada yalnizca "durduruldu" gercegi kaydedilir; `[Durumu Tazele]` ayrintiyi
        // cluster'dan alir. Uydurulmus bir sayi yazmak, geri almayi BOZARDI.
        await state.upsertStopped({
          env: op.env, tenant: op.tenant, clusterName: t.cluster, namespace: op.namespace,
          appName: t.app, workloadKind: t.kind, previousReplicas: null,
          stoppedBy: op.username, operationId: idByCluster.get(t.cluster) ?? op.id,
        });
      } else if (parsed.action === 'restore') {
        await state.clearRestored({
          env: op.env, tenant: op.tenant, clusterName: t.cluster,
          namespace: op.namespace, appName: t.app,
        });
      }
    }
  } catch (e) {
    // Sonuc gosterimini BLOKLAMA: ayna guncellenemedi diye kullanicinin isinin sonucunu
    // gizlemek, cozdugu sorundan buyuk bir sorun olurdu. Sapma zaten `[Durumu Tazele]`
    // ile yakalanir.
    console.warn('[ScaleX] islem sonuclandirilamadi:', e.message);
  }
}

module.exports = { initScaleX, denyIfNotOwner, resolveByKey, buildScaleXSmartMetadata, finalizeOperation };
