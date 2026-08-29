// server/chaos/index.cjs — Chaos Scale: OCP replica durdurma / geri alma / olcekleme.
//
// TASARIM NOTLARI
// * Hafif yol (Telnet deseni): `ansible_job_history` + `getJobStatusOnServer`. LogX'in
//   agir `logx_v2_requests` durum makinesi KURULMUYOR — burada cok adimli, yarida
//   kalabilen bir sihirbaz durumu yok; her calistirma tek bir AWX isi.
// * Kalici iz `chaos_scale_operations` tablosunda: CLUSTER BASINA BIR SATIR. Bes
//   cluster'dan biri dustugunde hangisinin geri alinmasi gerektigi ancak boyle belli olur.
// * Emniyet kapilari `server/ansible/change-gates.cjs` ile PAYLASILIYOR (Self Service ile
//   ayni kod). Chaos'a ozel olan yalnizca hangi durumda cagrildigi (bkz. launch.gatePolicyFor).
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

const RUN_KEY = 'chaos_scale_portal';
const DISCOVERY_KEY = 'chaos_scale_discovery';

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
      console.warn('[Chaos] sahiplik sorgusu basarisiz — erisim reddedildi:', e.message);
      return { status: 503, message: 'İş sahipliği doğrulanamadı, lütfen tekrar deneyin.' };
    }
  }
  if (!owner || owner !== me) return { status: 403, message: 'Bu iş size ait değil.' };
  return null;
}

function resolveByKey(keyName) {
  const row = playbookRegistry.getByKey(keyName);
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
  const serverId = Number(row.awxServerId || process.env.CHAOS_AWX_SERVER_ID || 1);
  return { templateId: Number(templateId), serverId, keyName };
}

function currentUser(req) {
  return req.session?.user || { username: 'anonymous', role: 'User' };
}

function asyncRoute(fn) {
  return (req, res) => fn(req, res).catch((err) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[Chaos]', err);
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
  const { templateId, serverId } = resolveByKey(keyName);
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
    console.warn('[Chaos] ansible_job_history yazilamadi:', e.message);
  }
  return { serverId, templateId, jobId: job.jobId, status: job.status };
}

function initChaos(app) {
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
    router.use(require('../auth/visibility.cjs').requireVisiblePrefix('Chaos Scale'));
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
    const extraVars = {
      chaos_clusters_override: launch.buildChaosClusterCatalog({
        env, tenant, clusters,
        hosts: (await require('../logx/v2/admin.cjs').resolveTerminalHosts(env, tenant, clusters)).hosts,
        meta: await require('../logx/v2/admin.cjs').resolveClusterMeta(env, tenant, clusters),
      }),
      target_platform: tenant, target_environment: env, target_namespace: namespace,
      chaos_target_clusters: clusters, discovery_mode: mode,
      ...(apps.length ? { target_app_names: apps.join(',') } : {}),
    };
    const job = await launchOnAwx({ keyName: DISCOVERY_KEY, extraVars, req, label: `Chaos keşif (${mode}) — ${namespace}` });
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
    res.json({
      ok: true, status: status.status, finished: !!status.finished, failed: !!status.failed,
      output: output.output || '', result: result.extractDiscoveryResult(status.artifacts),
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
    const policy = launch.gatePolicyFor({ action, executionMode });
    res.json({ ok: true, blastRadius: radius, gatePolicy: policy, targets: { env, tenant, namespace, clusters, apps } });
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
    const mailCc = String(req.body?.mailCc || '').trim();

    launch.assertValidTargets({ namespace, apps, action, targetReplicas, executionMode, verificationTimeout });

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

    const policy = launch.gatePolicyFor({ action, executionMode });
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
      targetReplicas, verificationTimeout, allowPartial, mailTo, mailCc,
    });

    // ── KAPILAR ─────────────────────────────────────────────────────────────
    if (policy.smart === 'require' || policy.oco === 'require') {
      const gateVars = launch.buildGateVars({ env, tenant, action, executionMode, clusters, namespace });
      const overrides = {
        // `restore` icin OCO UYARIR ama ENGELLEMEZ → kapiyi hic acmiyoruz, gerekce
        // zaten yukarida zorunlu kilindi ve asagida kayda + SMART'a gidiyor.
        ocoCheck: { enabled: policy.oco === 'require' },
        smartApproval: req.body?.smartApproval || { flowKey: process.env.CHAOS_SMART_FLOW_KEY || '' },
      };
      const decision = await launch.gates.runChangeGates({
        server: { id: 0 }, templateId: 0, username: user.username, req,
        overrides, extraVars, gateVars, detail: {}, resolvedLaunchOptions: {}, specFields: [],
        templateName: 'Chaos Scale',
        ocoNumber: req.body?.ocoNumber, ocoAction: req.body?.ocoAction,
        createOcoAwxSchedule: async () => {
          throw Object.assign(new Error('Chaos Scale işlemleri zamanlanamaz — pencere açıkken tekrar deneyin.'), { status: 400 });
        },
        friendlyAwxError: (e) => ({ status: e.status || 502, message: e.message }),
        buildSmartMetadata: () => buildChaosSmartMetadata({ user, env, tenant, clusters, namespace, apps, action, radius, reason, ocoNumber: req.body?.ocoNumber }),
      });
      // FAIL-CLOSED — `proceed` disindaki her sey burada tuketilir (bkz. change-gates.cjs).
      if (decision?.outcome === 'error') return res.status(decision.status).json(decision.body);
      if (decision?.outcome === 'respond') return res.json(decision.body);
      if (decision?.outcome !== 'proceed') {
        console.error('[Chaos] taninmayan kapi karari — is BASLATILMADI:', JSON.stringify(decision));
        return res.status(500).json({ ok: false, message: 'Değişiklik kapısı beklenmeyen bir sonuç döndürdü; iş güvenlik gereği başlatılmadı.' });
      }
    }

    const job = await launchOnAwx({
      keyName: RUN_KEY, extraVars, req,
      label: `Chaos ${action} (${executionMode}) — ${namespace} @ ${clusters.join(',')}`,
    });

    // CLUSTER BASINA BIR SATIR.
    const requestKey = `${job.serverId}:${job.jobId}`;
    for (const cluster of clusters) {
      await db.query(
        `INSERT INTO chaos_scale_operations
           (request_key, username, env, tenant, cluster_name, namespace, action, execution_mode,
            target_replicas, app_names_json, awx_server_id, awx_job_id, status, oco_number, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'RUNNING',$13,$14)`,
        [requestKey, user.username, env, tenant, cluster, namespace, action, executionMode,
          action === 'scale' ? Number(targetReplicas) : null, JSON.stringify(apps),
          job.serverId, job.jobId, String(req.body?.ocoNumber || '') || null, reason || null]
      );
    }

    auditPortal(req, 'chaos_scale_run', {
      detail: JSON.stringify({ env, tenant, clusters, namespace, apps, action, executionMode, targets: radius.targets, jobId: job.jobId }),
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
    const parsed = result.extractChaosResult(status.artifacts);
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
    const out = await runner.cancelJobOnServer(serverId, jobId);
    await db.query(
      `UPDATE chaos_scale_operations SET status = 'CANCELLED', updated_at = GETUTCDATE()
        WHERE awx_server_id = $1 AND awx_job_id = $2 AND status = 'RUNNING'`,
      [serverId, jobId]
    );
    auditPortal(req, 'chaos_scale_cancel', { detail: JSON.stringify({ serverId, jobId }) });
    res.json({ ok: true, ...out });
  }));

  // ── "Su an durdurulmus" + sapma ───────────────────────────────────────────
  router.get('/stopped', asyncRoute(async (req, res) => {
    const env = String(req.query.env || '').trim();
    const tenant = String(req.query.tenant || '').trim();
    const clusterName = String(req.query.cluster || '').trim() || null;
    if (!env || !tenant) throw Object.assign(new Error('env ve tenant zorunlu.'), { status: 400 });
    const rows = await state.listMirror({ env, tenant, clusterName });
    res.json({ ok: true, items: rows });
  }));

  router.post('/adopt', asyncRoute(async (req, res) => {
    const user = currentUser(req);
    const { env, tenant, namespace, clusters } = await resolveScope(req, { requireApps: false });
    const appName = String(req.body?.appName || '').trim();
    if (!appName) throw Object.assign(new Error('appName zorunlu.'), { status: 400 });
    if (clusters.length !== 1) throw Object.assign(new Error('Portala alma tek cluster için yapılır.'), { status: 400 });
    const row = await state.adopt({
      env, tenant, clusterName: clusters[0], namespace, appName,
      workloadKind: req.body?.workloadKind || null,
      previousReplicas: Number(req.body?.previousReplicas),
      stoppedBy: req.body?.stoppedBy || null,
      adoptedBy: user.username,
    });
    auditPortal(req, 'chaos_scale_adopt', { detail: JSON.stringify({ env, tenant, cluster: clusters[0], namespace, appName }) });
    res.json({ ok: true, item: row });
  }));

  router.get('/history', asyncRoute(async (req, res) => {
    const user = currentUser(req);
    const isAdmin = user.role === 'Admin';
    const { rows } = await db.query(
      isAdmin
        ? `SELECT TOP 200 * FROM chaos_scale_operations ORDER BY created_at DESC`
        : `SELECT TOP 200 * FROM chaos_scale_operations WHERE username = $1 ORDER BY created_at DESC`,
      isAdmin ? [] : [user.username]
    );
    res.json({ ok: true, items: rows });
  }));

  app.use('/api/chaos', router);
  console.log('[Chaos] Chaos Scale API hazir (/api/chaos)');
}

// SMART metadata'si. `reason` ve patlama yaricapi BILEREK iceride: onay veren kisi
// "kac hedefe dokunuluyor" ve "neden" sorularinin cevabini gormeli.
function buildChaosSmartMetadata({ user, env, tenant, clusters, namespace, apps, action, radius, reason, ocoNumber }) {
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
      `SELECT * FROM chaos_scale_operations WHERE awx_server_id = $1 AND awx_job_id = $2`,
      [serverId, jobId]
    );
    if (!rows.length || rows.every((r) => r.status !== 'RUNNING')) return;

    await db.query(
      `UPDATE chaos_scale_operations
          SET status = 'FINISHED', overall_status = $3, result_json = $4, updated_at = GETUTCDATE()
        WHERE awx_server_id = $1 AND awx_job_id = $2 AND status = 'RUNNING'`,
      [serverId, jobId, parsed ? parsed.overallStatus : String(status.status || '').toUpperCase(),
        parsed ? JSON.stringify(parsed).slice(0, 1000000) : null]
    );

    if (!parsed || parsed.mode !== 'apply') return;
    const op = rows[0];
    for (const t of parsed.targets) {
      if (t.status !== 'OK') continue;
      if (parsed.action === 'stop') {
        // `previous_replicas` sonuc satirinda YOK — kesif/durum denetimi onu getirir.
        // Burada yalnizca "durduruldu" gercegi kaydedilir; `[Durumu Tazele]` ayrintiyi
        // cluster'dan alir. Uydurulmus bir sayi yazmak, geri almayi BOZARDI.
        await state.upsertStopped({
          env: op.env, tenant: op.tenant, clusterName: t.cluster, namespace: op.namespace,
          appName: t.app, workloadKind: t.kind, previousReplicas: null,
          stoppedBy: op.username, operationId: op.id,
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
    console.warn('[Chaos] islem sonuclandirilamadi:', e.message);
  }
}

module.exports = { initChaos, denyIfNotOwner, resolveByKey, buildChaosSmartMetadata, finalizeOperation };
