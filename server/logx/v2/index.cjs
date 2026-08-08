// server/logx/v2/index.cjs — LogX v2 (guvenli dosya indirme yeniden tasarimi) ana router.
// Eski server/logx/index.cjs'in aksine HER route'ta requireAuth zorunludur (bu, kullanicinin
// onayladigi plandaki en kritik guvenlik duzeltmesidir — bkz. plan dosyasi §7, madde 1).
'use strict';

const express = require('express');
const requests = require('./requests.cjs');
const legacy = require('./legacy.cjs');
const ocp = require('./ocp.cjs');
const jobsMod = require('./jobs.cjs');
const downloads = require('./downloads.cjs');
const ingest = require('./ingest.cjs');
const restrictions = require('./restrictions.cjs');
const adminData = require('./admin.cjs');
const cleanup = require('./cleanup.cjs');
const audit = require('../audit.cjs');

function currentUser(req) {
  const s = req.session?.user;
  if (s) return { username: s.username, role: s.role || 'User', authSource: s.authSource || 'local', sessionToken: req.sessionID };
  // requireAuth'un header-fallback yolu (bkz. server/auth/index.cjs requireAuth) —
  // yalnizca session hic yoksa devreye girer, normal login akisinda kullanilmaz.
  const h = req.user;
  if (h) return { username: h.username, role: h.role || 'User', authSource: h.authSource || 'header', sessionToken: req.sessionID || 'header' };
  return { username: 'anonymous', role: 'User', authSource: 'local', sessionToken: req.sessionID || '' };
}

function asyncRoute(fn) {
  return (req, res) => {
    fn(req, res).catch((err) => {
      const status = err.status || 500;
      res.status(status).json({ ok: false, message: err.message, ...(err.code ? { error: err.code, invalid: err.invalid } : {}) });
    });
  };
}

async function loadOwnedRequest(req) {
  const row = await requests.getRequestRow(req.params.requestId);
  requests.assertOwnership(row, currentUser(req));
  return row;
}

// Bir job terminal duruma ULASTIGINDA (yalnizca bir kez) ilgili job tipine gore istegi
// ilerletir: discovery job'lari sonucu discovery_result_json'a yazar, transfer/fetch
// job'lari bir indirme token'i uretir.
async function finalizeIfNeeded(requestRow, jobBefore, jobAfter) {
  if (jobsMod.TERMINAL_STATUSES.has(jobBefore.status) || !jobsMod.TERMINAL_STATUSES.has(jobAfter.status)) {
    return; // zaten finalize edilmis veya henuz terminal degil
  }
  const user = { username: requestRow.username };
  switch (jobAfter.jobType) {
    case 'legacy_discovery':
      await legacy.finalizeDiscovery(requestRow, jobAfter);
      await audit.log({ username: requestRow.username, action: 'v2_discover', result: jobAfter.artifacts?.overall_status || 'unknown', detail: `platform=legacy` }).catch(() => {});
      break;
    case 'ocp_namespace_discovery':
      await ocp.finalizeNamespaceDiscovery(requestRow, jobAfter);
      break;
    case 'legacy_transfer':
    case 'ocp_discover_fetch': {
      // Cok-bastion'li OCP fetch'inde playbook bastion BASINA bir arsiv uretebilir ve
      // bunlari `staged_files[]` olarak bildirir. Tek-bastion (ve legacy transfer)
      // durumunda bu dizi yoktur; o zaman eski tekil staged_path/filename alanlari
      // kullanilir — iki durum da tek kod yolundan gecsin diye once normalize edilir.
      const art = jobAfter.artifacts || {};
      const files = Array.isArray(art.staged_files) && art.staged_files.length
        ? art.staged_files.filter((f) => f && f.staged_path)
        : (art.staged_path ? [{ staged_path: art.staged_path, filename: art.filename, size_bytes: art.size_bytes, is_fallback: art.is_fallback }] : []);
      if (files.length) {
        // Ayni arsiv icin ikinci kez token uretmeyi onle: iki es zamanli /jobs/:id/status
        // poll'u ayni terminal gecisini yakalayabilir (index.cjs:47 guard'i yarisa acik).
        const already = await downloads.listTokenizedPaths(requestRow.request_id).catch(() => new Set());
        const prefixes = [];
        const failures = [];
        for (const f of files) {
          if (already.has(f.staged_path)) continue;
          try {
            const tokenInfo = await downloads.issueDownloadToken({
              requestId: requestRow.request_id,
              username: requestRow.username,
              sessionToken: requestRow.session_token,
              stagedPath: f.staged_path,
              filename: f.filename || 'logs.zip',
              sizeBytes: f.size_bytes,
              isFallback: !!f.is_fallback,
            });
            prefixes.push(tokenInfo.token.slice(0, 8));
          } catch (err) {
            // Bir arsivin token'i uretilemezse TUM finalize'i dusurmeyiz: aksi halde istek
            // 'transferring'de kilitli kalir (guard yeniden finalize etmez) ve kullanici
            // basarili arsivlere de erisemez. Hata audit'e yazilir.
            failures.push(`${f.filename || f.staged_path}: ${err.message}`);
          }
        }
        await requests.updateRequest(requestRow.request_id, { state: 'ready' });
        await audit.log({
          username: requestRow.username,
          action: jobAfter.jobType === 'legacy_transfer' ? 'v2_transfer' : 'v2_ocp_discover_fetch',
          result: art.overall_status || 'unknown',
          detail: `download_token_issued count=${prefixes.length}/${files.length} token_prefixes=${prefixes.join(',')}`
                + (failures.length ? ` failed=[${failures.join(' | ')}]` : ''),
        }).catch(() => {});
      } else {
        await requests.updateRequest(requestRow.request_id, { state: 'failed', errorMessage: jobAfter.errorMessage || 'Transfer başarısız oldu.' });
      }
      break;
    }
    default:
      break;
  }
  void user;
}

function initLogXv2(app) {
  // Maskeleme kurallarini DB'den yukle (basarisizsa masker sabit setiyle devam eder).
  require('../masker.cjs').loadMaskRules().catch(() => {});
  const router = express.Router();
  // /admin CRUD'lari portal_audit_logs'a yazilir (LogX akis audit'i logx_audit_logs'ta kalir).
  try { router.use('/admin', require('../../audit/index.cjs').auditMutations('logx_admin')); } catch { /* yoksay */ }

  // Paylasilan auth guard'lari (secret-kapili; header'a dogrudan guvenmez). Auth modulu
  // yuklenemezse fallback KAPALI (deny) — guvenli varsayilan.
  let requireAuth = (req, res, next) => res.status(401).json({ ok: false, message: 'Auth modülü yok.' });
  let requireAdmin = (req, res, next) => res.status(403).json({ ok: false, message: 'Auth modülü yok.' });
  try {
    const authMod = require('../../auth/index.cjs');
    if (typeof authMod.requireAuth === 'function') requireAuth = authMod.requireAuth;
    if (typeof authMod.requireAdmin === 'function') requireAdmin = authMod.requireAdmin;
  } catch { /* auth modulu yoksa deny kalir */ }

  // A4 fetch-back UPLOAD — requireAuth'tan ONCE (auth = tek-kullanimlik token, kaynak host'un
  // session'i yok). Body streaming diske yazilir; global express.json octet-stream'i yutmaz.
  router.post('/ingest/:token', asyncRoute(ingest.handleIngestRoute));

  router.use(requireAuth);

  // LogX sayfasi gizliyse gercek 403 (kozmetik degil). Admin route'lari ayrica requireAdmin.
  try {
    const { requireVisiblePrefix } = require('../../auth/visibility.cjs');
    router.use(requireVisiblePrefix('LogX'));
  } catch { /* motor yoksa yoksay */ }

  // ── Requests (resumption + state machine) ───────────────────────────────────
  router.post('/requests', asyncRoute(async (req, res) => {
    const user = currentUser(req);
    const request = await requests.createRequest(user, req.body?.platform);
    res.json({ ok: true, requestId: request.id });
  }));

  router.get('/requests/:requestId', asyncRoute(async (req, res) => {
    const row = await loadOwnedRequest(req);
    const request = requests.normalizeRequest(row);
    const jobs = await jobsMod.listJobsForRequest(row.request_id);
    // `download` (tekil) SOZLESME OLARAK KORUNUR — eski frontend surumleri bunu okur.
    // `downloadList` cok-bastion'li fetch'te olusan TUM arsivleri tasir (tek arsivde
    // tek elemanlidir, yani yeni UI da tek kod yolundan calisir).
    const download = request.state === 'ready'
      ? await downloads.getLatestDownloadForRequest(row.request_id)
      : null;
    const downloadList = request.state === 'ready'
      ? await downloads.listDownloadsForRequest(row.request_id)
      : [];
    res.json({ ok: true, request, jobs, download, downloads: downloadList });
  }));

  // Sihirbaz "← Geri": onceki secim adimina donebilmek icin ilgili sunucu-durumunu geri sarar
  // (state='draft' + o adimdan sonraki alanlari temizler). Yalnizca guvenli, secim-oncesi
  // hedeflere izin verilir (job calisirken geri = iptal, o ayri route). Sahiplik zorunlu.
  const RESET_TARGETS = {
    legacy_app: { state: 'draft', discoveryResult: null, selectedFiles: null },
    ocp_cluster_select: { state: 'draft', input: null, discoveryResult: null },
    ocp_namespace_step: { state: 'draft', discoveryResult: null },
  };
  router.post('/requests/:requestId/reset', asyncRoute(async (req, res) => {
    const row = await loadOwnedRequest(req);
    const patch = RESET_TARGETS[req.body?.to];
    if (!patch) return res.status(400).json({ ok: false, message: 'Geçersiz geri-dönüş hedefi.' });
    await requests.updateRequest(row.request_id, { ...patch, errorMessage: null });
    res.json({ ok: true });
  }));

  // ── Legacy ───────────────────────────────────────────────────────────────────
  router.get('/legacy/apps', asyncRoute(async (req, res) => {
    const result = await legacy.searchApps(req.query.search);
    res.json({ ok: true, ...result });
  }));

  router.post('/legacy/:requestId/discover', asyncRoute(async (req, res) => {
    const row = await loadOwnedRequest(req);
    const { app, hosts } = req.body || {};
    if (app) {
      await restrictions.assertAllowed('legacy_app', app, currentUser(req));
    }
    const job = await legacy.discover(row, app, hosts);
    res.json({ ok: true, jobId: job.id });
  }));

  router.post('/legacy/:requestId/transfer', asyncRoute(async (req, res) => {
    const row = await loadOwnedRequest(req);
    const job = await legacy.transfer(row, req.body?.selected || []);
    res.json({ ok: true, jobId: job.id });
  }));

  // ── OpenShift ────────────────────────────────────────────────────────────────
  router.get('/ocp/cluster-index', asyncRoute(async (req, res) => {
    const tree = await ocp.getClusterTree();
    res.json({ ok: true, tree });
  }));

  router.post('/ocp/:requestId/select', asyncRoute(async (req, res) => {
    const row = await loadOwnedRequest(req);
    const { env, tenant, clusters } = req.body || {};
    const result = await ocp.selectClusters(row, env, tenant, clusters);
    res.json({ ok: true, ...result });
  }));

  router.post('/ocp/:requestId/namespaces/discover', asyncRoute(async (req, res) => {
    const row = await loadOwnedRequest(req);
    const job = await ocp.discoverNamespaces(row);
    res.json({ ok: true, jobId: job.id });
  }));

  router.post('/ocp/:requestId/discover-fetch', asyncRoute(async (req, res) => {
    const row = await loadOwnedRequest(req);
    const { namespace, appName } = req.body || {};
    const input = row.input_json ? JSON.parse(row.input_json) : {};
    const resourceKey = `${input.tenant}/${input.env}/${(input.clusters || []).join('+')}/${namespace}`;
    await restrictions.assertAllowed('ocp_namespace', resourceKey, currentUser(req));
    const job = await ocp.discoverFetch(row, namespace, appName);
    res.json({ ok: true, jobId: job.id });
  }));

  // ── Jobs (polling) ───────────────────────────────────────────────────────────
  router.get('/jobs/:jobId/status', asyncRoute(async (req, res) => {
    const job = await jobsMod.getJobById(req.params.jobId);
    if (!job) return res.status(404).json({ ok: false, message: 'Job bulunamadı.' });
    const requestRow = await requests.getRequestRow(job.requestId);
    requests.assertOwnership(requestRow, currentUser(req));

    const before = job;
    const after = await jobsMod.pollJob(job);
    await finalizeIfNeeded(requestRow, before, after);

    const elapsedSec = after.startedAt ? Math.floor((Date.now() - new Date(after.startedAt).getTime()) / 1000) : 0;
    res.json({ ok: true, status: after.status, jobType: after.jobType, elapsedSec, artifacts: after.artifacts, errorMessage: after.errorMessage });
  }));

  // Canli AWX stdout — yalnizca "su an ne oluyor" gorunurlugu icin, job sonucunun
  // kaynagi DEGIL (bkz. jobs.cjs getJobOutput yorumu). Ayni sahiplik kontrolu.
  router.get('/jobs/:jobId/output', asyncRoute(async (req, res) => {
    const job = await jobsMod.getJobById(req.params.jobId);
    if (!job) return res.status(404).json({ ok: false, message: 'Job bulunamadı.' });
    const requestRow = await requests.getRequestRow(job.requestId);
    requests.assertOwnership(requestRow, currentUser(req));
    const output = await jobsMod.getJobOutput(job).catch(() => '');
    res.json({ ok: true, output });
  }));

  // Calisan bir job'i iptal et. Sahiplik kontrolu status/output ile ayni. Iptal sonrasi
  // ilgili request `failed` state'ine cekilir → sihirbaz "Yeniden Basla" ekranini gosterir.
  router.post('/jobs/:jobId/cancel', asyncRoute(async (req, res) => {
    const job = await jobsMod.getJobById(req.params.jobId);
    if (!job) return res.status(404).json({ ok: false, message: 'Job bulunamadı.' });
    const requestRow = await requests.getRequestRow(job.requestId);
    requests.assertOwnership(requestRow, currentUser(req));

    const after = await jobsMod.cancelJob(job);
    await requests.updateRequest(requestRow.request_id, {
      state: 'failed',
      errorMessage: 'İşlem kullanıcı tarafından iptal edildi.',
    });
    await audit.log({ username: requestRow.username, action: 'v2_cancel', result: after.status, detail: `jobType=${after.jobType} jobId=${after.id}` }).catch(() => {});
    res.json({ ok: true, status: after.status });
  }));

  // ── Downloads ────────────────────────────────────────────────────────────────
  router.get('/downloads/:token', asyncRoute(downloads.handleDownloadRoute));

  // ── Admin: ocp_cluster_index ─────────────────────────────────────────────────
  router.get('/admin/ocp-cluster-index', requireAdmin, asyncRoute(async (req, res) => {
    res.json({ ok: true, rows: await adminData.listClusterIndex() });
  }));
  router.post('/admin/ocp-cluster-index', requireAdmin, asyncRoute(async (req, res) => {
    res.json({ ok: true, row: await adminData.createClusterIndexRow(req.body || {}) });
  }));
  router.put('/admin/ocp-cluster-index/:id', requireAdmin, asyncRoute(async (req, res) => {
    const row = await adminData.updateClusterIndexRow(req.params.id, req.body || {});
    if (!row) return res.status(404).json({ ok: false, message: 'Kayıt bulunamadı.' });
    res.json({ ok: true, row });
  }));
  router.delete('/admin/ocp-cluster-index/:id', requireAdmin, asyncRoute(async (req, res) => {
    res.json({ ok: await adminData.deleteClusterIndexRow(req.params.id) });
  }));

  // ── Admin: ocp_terminal_host_map ─────────────────────────────────────────────
  router.get('/admin/ocp-terminal-host-map', requireAdmin, asyncRoute(async (req, res) => {
    res.json({ ok: true, rows: await adminData.listTerminalHostMap() });
  }));
  router.post('/admin/ocp-terminal-host-map', requireAdmin, asyncRoute(async (req, res) => {
    res.json({ ok: true, row: await adminData.createTerminalHostRow(req.body || {}) });
  }));
  router.put('/admin/ocp-terminal-host-map/:id', requireAdmin, asyncRoute(async (req, res) => {
    const row = await adminData.updateTerminalHostRow(req.params.id, req.body || {});
    if (!row) return res.status(404).json({ ok: false, message: 'Kayıt bulunamadı.' });
    res.json({ ok: true, row });
  }));
  router.delete('/admin/ocp-terminal-host-map/:id', requireAdmin, asyncRoute(async (req, res) => {
    res.json({ ok: await adminData.deleteTerminalHostRow(req.params.id) });
  }));

  // ── Admin: logx_env_suffix_map ───────────────────────────────────────────────
  router.get('/admin/env-suffix-map', requireAdmin, asyncRoute(async (req, res) => {
    res.json({ ok: true, rows: await adminData.listEnvSuffixMap() });
  }));
  router.post('/admin/env-suffix-map', requireAdmin, asyncRoute(async (req, res) => {
    res.json({ ok: true, row: await adminData.createEnvSuffixRow(req.body || {}) });
  }));
  router.put('/admin/env-suffix-map/:id', requireAdmin, asyncRoute(async (req, res) => {
    const row = await adminData.updateEnvSuffixRow(req.params.id, req.body || {});
    if (!row) return res.status(404).json({ ok: false, message: 'Kayıt bulunamadı.' });
    res.json({ ok: true, row });
  }));
  router.delete('/admin/env-suffix-map/:id', requireAdmin, asyncRoute(async (req, res) => {
    res.json({ ok: await adminData.deleteEnvSuffixRow(req.params.id) });
  }));

  // ── Admin: PII maskeleme kurallari (logx_mask_rules) ─────────────────────────
  // Her mutasyondan sonra masker cache'i yeniden yuklenir — degisiklik aninda etkilidir.
  const masker = require('../masker.cjs');
  router.get('/admin/mask-rules', requireAdmin, asyncRoute(async (req, res) => {
    res.json({ ok: true, rows: await adminData.listMaskRules() });
  }));
  router.post('/admin/mask-rules', requireAdmin, asyncRoute(async (req, res) => {
    const row = await adminData.createMaskRule(req.body || {});
    await masker.reloadMaskRules().catch(() => {});
    res.json({ ok: true, row });
  }));
  router.put('/admin/mask-rules/:id', requireAdmin, asyncRoute(async (req, res) => {
    const row = await adminData.updateMaskRule(req.params.id, req.body || {});
    if (!row) return res.status(404).json({ ok: false, message: 'Kayıt bulunamadı.' });
    await masker.reloadMaskRules().catch(() => {});
    res.json({ ok: true, row });
  }));
  router.delete('/admin/mask-rules/:id', requireAdmin, asyncRoute(async (req, res) => {
    const ok = await adminData.deleteMaskRule(req.params.id);
    await masker.reloadMaskRules().catch(() => {});
    res.json({ ok });
  }));

  // ── Admin: restrictions (varsayilan-acik, opt-in kisitlama) ─────────────────
  router.get('/admin/restrictions', requireAdmin, asyncRoute(async (req, res) => {
    res.json({ ok: true, restrictions: await restrictions.listRestrictions() });
  }));
  router.post('/admin/restrictions', requireAdmin, asyncRoute(async (req, res) => {
    const row = await restrictions.createRestriction(req.body || {}, currentUser(req).username);
    res.json({ ok: true, restriction: row });
  }));
  router.put('/admin/restrictions/:id', requireAdmin, asyncRoute(async (req, res) => {
    const row = await restrictions.updateRestriction(req.params.id, req.body || {});
    res.json({ ok: true, restriction: row });
  }));
  router.delete('/admin/restrictions/:id', requireAdmin, asyncRoute(async (req, res) => {
    res.json({ ok: await restrictions.deleteRestriction(req.params.id) });
  }));
  router.post('/admin/restrictions/:id/grants', requireAdmin, asyncRoute(async (req, res) => {
    const grant = await restrictions.addGrant(req.params.id, req.body?.username, currentUser(req).username);
    res.json({ ok: true, grant });
  }));
  router.delete('/admin/restrictions/:id/grants/:username', requireAdmin, asyncRoute(async (req, res) => {
    res.json({ ok: await restrictions.removeGrant(req.params.id, req.params.username) });
  }));

  // ── Admin: izleme ────────────────────────────────────────────────────────────
  router.get('/admin/requests', requireAdmin, asyncRoute(async (req, res) => {
    const { state, platform, limit = 100 } = req.query;
    const rows = await requests.listRequestsForAdmin({ state, platform, limit });
    res.json({ ok: true, requests: rows });
  }));

  app.use('/api/logx/v2', router);
  cleanup.startCleanupJob();
  console.log('[LogXv2] module mounted at /api/logx/v2');
}

module.exports = { initLogXv2 };
