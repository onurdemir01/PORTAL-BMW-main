// server/retirement/index.cjs - Uygulama Retirement akisi (2026-09-21) — kayit + kesif + STOP adimi.
//
// Ekibin elle sureci: Smart silme kaydi (364244_Delete_6) -> [prod: OCO + SCC bilgi] -> STOP
// (auto-start kapat, durdur, paketi .<smart>.old) -> stop + >=10 gun ve secilen tarih -> SILME ->
// IP/LB/DNS Smart kayitlari. Burada ilk uc parca: kayit, kesif (tum ortamlar + Ankara), STOP.
// Silme ve IP/LB/DNS adimlari sonraki surumde (kayit alanlari simdiden var: planned_delete_at,
// dns_reuse, lb_reuse).
//
// Kurallar: silme tarihi = planned_delete_at (kaydi acan verdi) ya da stop + delete_after_days (45).
// PROD hedef: oco_no zorunlu; ilk gercek STOP'ta SCC maili (RETIREMENT_SCC_MAIL_TO env; bossa uyari).
// STOP her zaman once PLAN (plan_only=true) kosar, kullanici onaylayinca uygulanir.
'use strict';

const express = require('express');
const { discover, searchApps } = require('./discover.cjs');

const REGISTRY_KEY = 'app_retirement_stop';
// DELETE AYRI TEMPLATE (2026-10-06): kendi playbook'u, kendi girdileri ve kendi
// `set_stats` anahtari var. STOP'un template'ini kullanmak, plan_only gibi ortak bir
// degisken yuzunden yanlis adimi tetiklemek demekti.
const DELETE_REGISTRY_KEY = 'app_retirement_delete';
const DEFAULT_DAYS = Number(process.env.RETIREMENT_DELETE_DAYS || 45);
const SCC_MAIL_TO = (process.env.RETIREMENT_SCC_MAIL_TO || '').trim();
const SCC_MAIL_CC = (process.env.RETIREMENT_SCC_MAIL_CC || '').trim();
const isAdmin = (req) => req.session?.user?.role === 'Admin';
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function db() { return require('../db/index.cjs'); }
function rowRecord(r) {
  return {
    id: r.id, app: r.app, smartNo: r.smart_no, ocoNo: r.oco_no, ownerEmail: r.owner_email, requestedBy: r.requested_by,
    status: r.status, deleteAfterDays: r.delete_after_days, plannedDeleteAt: r.planned_delete_at ? new Date(r.planned_delete_at).toISOString().slice(0, 10) : null,
    stopAt: r.stop_at, dnsReuse: !!r.dns_reuse, lbReuse: !!r.lb_reuse, sccNotifiedAt: r.scc_notified_at, notes: r.notes,
    createdAt: r.created_at, updatedAt: r.updated_at,
    // etkin silme tarihi: verilmisse o, degilse stop + gun (stop yoksa null)
    effectiveDeleteAt: r.planned_delete_at ? new Date(r.planned_delete_at).toISOString().slice(0, 10)
      : r.stop_at ? new Date(new Date(r.stop_at).getTime() + Number(r.delete_after_days || DEFAULT_DAYS) * 86400000).toISOString().slice(0, 10) : null,
  };
}
function rowTarget(t) {
  let web = [];
  try { web = t.web_json ? JSON.parse(t.web_json) : []; } catch { web = []; }
  return {
    id: t.id, recordId: t.record_id, host: t.host, site: t.site, env: t.env, appName: t.app_name, gen: t.jboss_gen, appPath: t.app_path,
    web, status: t.status, planText: t.plan_text, resultText: t.result_text, lastJobId: t.last_job_id, stoppedAt: t.stopped_at, updatedAt: t.updated_at,
    // PLAN/SONUC AYRINTISI (uretim bulgusu 2026-10-06): playbook `set_stats` ile STEP ve
    // RENAMED satirlarini da yayinliyor. Onceden YALNIZ tek satirlik RESULT saklaniyordu;
    // kullanici plani gozden gecirirken "2 paket yeniden adlandirilacak" goruyordu, HANGI
    // iki paket oldugunu DEGIL. Islem geri alinamaz, ayrinti gorunmek zorunda.
    detail: (() => {
      try {
        return t.detail_json ? JSON.parse(t.detail_json) : null;
      } catch {
        return null;
      }
    })(),
  };
}
async function addEvent(recordId, username, kind, text) {
  try { await db().query(`INSERT INTO retirement_events (record_id, username, kind, text) VALUES ($1, $2, $3, $4)`, [recordId, username || null, kind, String(text || '').slice(0, 1000)]); } catch (e) { console.warn('[Retirement] event yazilamadi:', e.message); }
}
async function loadRecord(id) {
  const r = await db().query(`SELECT * FROM retirement_records WHERE id = $1`, [id]);
  if (!r.rows?.length) return null;
  const [t, e] = await Promise.all([
    db().query(`SELECT * FROM retirement_targets WHERE record_id = $1 ORDER BY CASE env WHEN 'PROD' THEN 0 WHEN 'QA' THEN 1 WHEN 'TEST' THEN 2 ELSE 3 END, site, host`, [id]),
    db().query(`SELECT TOP 200 * FROM retirement_events WHERE record_id = $1 ORDER BY at DESC, id DESC`, [id]),
  ]);
  return { ...rowRecord(r.rows[0]), targets: (t.rows || []).map(rowTarget), events: (e.rows || []).map((x) => ({ id: x.id, at: x.at, username: x.username, kind: x.kind, text: x.text })) };
}

// AWX (Server Hub ile ayni desen)
async function launch(req, templateName, extraVars, detail, key = REGISTRY_KEY) {
  const reg = require('../ansible/playbook-registry.cjs');
  const row = await reg.getByKey(key).catch(() => null);
  const templateId = row && row.enabled !== false ? reg.getEffectiveTemplateId(row) : null;
  const serverId = row && row.awxServerId != null ? Number(row.awxServerId) : 0;
  if (!templateId) throw Object.assign(new Error(`AWX job template'i tanımlı değil: Admin › Playbook Kayıtları › "${key}" satırına Template ID girilmeli.`), { status: 501 });
  const runner = require('../ansible/runner.cjs');
  await require('../ansible/template-preflight.cjs').assertTemplateAcceptsExtraVars(serverId, templateId, extraVars, { label: key });
  const user = req.session?.user || {};
  const result = await runner.launchJobOnServer(serverId, templateId, extraVars, '', user);
  try {
    await db().query(`INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user.username || 'unknown', serverId, templateId, templateName, result?.jobId, result?.status || 'pending', JSON.stringify(extraVars)]);
  } catch (e) { console.warn('[Retirement] job gecmisi yazilamadi:', e.message); }
  try { require('../audit/index.cjs').auditPortal(req, 'retirement', { detail: JSON.stringify({ ...detail, jobId: result?.jobId ?? null }) }); } catch { /* best-effort */ }
  return { jobId: result?.jobId ?? null, status: result?.status ?? null, awxServerId: serverId };
}

function initRetirement(app) {
  const { requireAuth } = require('../auth/index.cjs');
  const router = express.Router();
  router.use(express.json({ limit: '512kb' }));
  router.use(requireAuth);
  router.use((req, res, next) => (isAdmin(req) ? next() : res.status(403).json({ ok: false, message: 'Retirement yalnız Admin.' })));
  try { router.use(require('../auth/visibility.cjs').requireVisiblePrefix('ServerHub')); } catch { /* yoksay */ }

  router.get('/config', (_req, res) => res.json({ ok: true, defaultDays: DEFAULT_DAYS, sccMailConfigured: !!SCC_MAIL_TO, sccMailTo: SCC_MAIL_TO || null,
    smartFlows: { delete: '364244_Delete_6', lbMemberUpdate: '642180_Update', lbDelete: '364378_Delete_6', lbIpDelete: '364308_Delete_6', dnsIntranetDelete: '2523535_Delete_6', dnsInternetDelete: '349792_Delete' } }));

  router.get('/apps', async (req, res) => {
    try { res.json({ ok: true, apps: await searchApps(String(req.query.q || '')) }); }
    catch (err) { res.status(500).json({ ok: false, message: err.message }); }
  });

  router.get('/discover', async (req, res) => {
    const base = String(req.query.app || '').trim();
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(base)) return res.status(400).json({ ok: false, message: 'Geçersiz uygulama adı.' });
    try { res.json({ ok: true, ...(await discover(base)) }); }
    catch (err) { res.status(500).json({ ok: false, message: err.message }); }
  });

  router.get('/', async (_req, res) => {
    try {
      const r = await db().query(`SELECT r.*, (SELECT COUNT(*) FROM retirement_targets t WHERE t.record_id = r.id) AS n_targets,
        (SELECT COUNT(*) FROM retirement_targets t WHERE t.record_id = r.id AND t.status = 'stopped') AS n_stopped
        FROM retirement_records r ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'stopped' THEN 1 ELSE 2 END, r.created_at DESC`);
      res.json({ ok: true, records: (r.rows || []).map((x) => ({ ...rowRecord(x), targets: Number(x.n_targets), stopped: Number(x.n_stopped) })) });
    } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
  });

  router.get('/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, message: 'Geçersiz kayıt.' });
    try {
      const rec = await loadRecord(id);
      if (!rec) return res.status(400).json({ ok: false, message: 'Kayıt yok.' });
      res.json({ ok: true, record: rec });
    } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
  });

  // Kayit ac: kesif snapshot'i hedef olarak yazilir (kullanici hedef secebilir: targets[] host|appName)
  router.post('/', async (req, res) => {
    const b = req.body || {};
    const app = String(b.app || '').trim();
    const smartNo = String(b.smartNo || '').trim();
    const ocoNo = String(b.ocoNo || '').trim();
    const days = Number.isInteger(Number(b.deleteAfterDays)) && Number(b.deleteAfterDays) > 0 ? Number(b.deleteAfterDays) : DEFAULT_DAYS;
    const planned = b.plannedDeleteAt ? String(b.plannedDeleteAt).slice(0, 10) : null;
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(app)) return res.status(400).json({ ok: false, message: 'Geçersiz uygulama adı.' });
    if (!SAFE_ID.test(smartNo)) return res.status(400).json({ ok: false, message: 'Smart kayıt numarası gerekli (harf/rakam).' });
    if (ocoNo && !SAFE_ID.test(ocoNo)) return res.status(400).json({ ok: false, message: 'OCO numarası harf/rakam olmalı.' });
    if (planned && !/^\d{4}-\d{2}-\d{2}$/.test(planned)) return res.status(400).json({ ok: false, message: 'Silme tarihi YYYY-AA-GG olmalı.' });
    try {
      const disc = await discover(app);
      const wanted = Array.isArray(b.targets) && b.targets.length ? new Set(b.targets.map((t) => `${String(t.host).toUpperCase()}|${t.appName}`)) : null;
      const targets = disc.targets.filter((t) => !wanted || wanted.has(`${t.host}|${t.appName}`));
      if (!targets.length) return res.status(400).json({ ok: false, message: 'Envanterde bu uygulama için hedef bulunamadı (MWAppsInventory).' });
      if (targets.some((t) => t.env === 'PROD') && !ocoNo) return res.status(400).json({ ok: false, message: 'PROD hedef var: altyapı OCO numarası zorunlu (kayıtla birlikte açılmalı).' });
      const user = req.session?.user?.username || 'unknown';
      const ins = await db().query(
        `INSERT INTO retirement_records (app, smart_no, oco_no, owner_email, requested_by, delete_after_days, planned_delete_at, dns_reuse, lb_reuse, notes)
         OUTPUT INSERTED.id VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [app, smartNo, ocoNo || null, String(b.ownerEmail || '').slice(0, 256) || null, user, days, planned, b.dnsReuse ? 1 : 0, b.lbReuse ? 1 : 0, String(b.notes || '').slice(0, 4000) || null],
      );
      const id = ins.rows[0].id;
      for (const t of targets) {
        await db().query(`INSERT INTO retirement_targets (record_id, host, site, env, app_name, jboss_gen, app_path, web_json) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, t.host, t.site, t.env, t.appName, t.gen, t.appPath || null, JSON.stringify(t.web)]);
      }
      await addEvent(id, user, 'created', `Kayıt açıldı: ${targets.length} hedef (${disc.summary.bySite.Pendik} Pendik, ${disc.summary.bySite.Ankara} Ankara); Smart ${smartNo}${ocoNo ? ', OCO ' + ocoNo : ''}; silme ${planned || days + ' gün sonra'}`);
      try { require('../audit/index.cjs').auditPortal(req, 'retirement', { detail: JSON.stringify({ op: 'create', id, app, targets: targets.length }) }); } catch { /* */ }
      res.json({ ok: true, id, record: await loadRecord(id) });
    } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
  });

  router.post('/:id/cancel', async (req, res) => {
    const id = Number(req.params.id);
    try {
      await db().query(`UPDATE retirement_records SET status = 'cancelled', updated_at = GETUTCDATE() WHERE id = $1`, [id]);
      await addEvent(id, req.session?.user?.username, 'cancelled', String(req.body?.reason || '').slice(0, 500) || 'iptal');
      res.json({ ok: true, record: await loadRecord(id) });
    } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
  });

  router.post('/:id/note', async (req, res) => {
    const id = Number(req.params.id);
    const text = String(req.body?.text || '').trim().slice(0, 1000);
    if (!text) return res.status(400).json({ ok: false, message: 'Not boş.' });
    try { await addEvent(id, req.session?.user?.username, 'note', text); res.json({ ok: true, record: await loadRecord(id) }); }
    catch (err) { res.status(500).json({ ok: false, message: err.message }); }
  });

  // STOP: plan (confirmed=false) -> onay (confirmed=true). PROD: OCO zorunlu, ilk gercek stop'ta SCC maili.
  router.post('/:id/targets/:tid/stop', async (req, res) => {
    const id = Number(req.params.id); const tid = Number(req.params.tid);
    const confirmed = req.body?.confirmed === true;
    try {
      const rec = await loadRecord(id);
      if (!rec) return res.status(400).json({ ok: false, message: 'Kayıt yok.' });
      if (rec.status === 'cancelled') return res.status(400).json({ ok: false, message: 'Kayıt iptal edilmiş.' });
      const t = rec.targets.find((x) => x.id === tid);
      if (!t) return res.status(400).json({ ok: false, message: 'Hedef yok.' });
      if (!t.gen) return res.status(400).json({ ok: false, message: `${t.host}: JBoss nesli belirlenemedi (envanter jboss_version boş).` });
      if (t.env === 'PROD' && !rec.ocoNo) return res.status(400).json({ ok: false, message: 'PROD hedef için OCO numarası gerekli.' });
      if (t.status === 'stopped') return res.status(400).json({ ok: false, message: 'Bu hedef zaten durdurulmuş.' });
      // ── OCO PENCERESINE ZAMANLAMA (kullanici karari 2026-10-06) ─────────────────
      // "Production icin OCO talebi girisi zorunlu olacak, OCO'daki tarih ve saate gore
      //  uygulama stop adimi baslar."
      //
      // YALNIZ GERCEK STOP'TA: plan (confirmed=false) hicbir seyi degistirmez, pencere
      // beklemesi anlamsiz olurdu - kullanici plani GORMEK icin kosturuyor.
      // YALNIZ PROD'DA: test/qa hedeflerinde OCO yok ve beklemek gereksiz.
      if (confirmed && t.env === 'PROD' && rec.ocoNo) {
        const ocoClient = require('../oco/client.cjs');
        const ocoWindow = require('../oco/window.cjs');
        let order;
        try {
          order = await ocoClient.getChangeOrder(rec.ocoNo);
        } catch (e) {
          return res.status(ocoClient.httpStatus(e)).json({ ok: false, ocoRequired: true, message: e.message });
        }
        const pi = ocoWindow.extractPlannedInterruption(order.payload);
        if (!pi || !pi.startDate)
          return res.status(400).json({ ok: false, message: `OCO ${rec.ocoNo} kaydinda planlanan kesinti tarihi yok — STOP baslatilmadi.` });
        const w = ocoWindow.evaluateWindow({ startDate: pi.startDate, endDate: pi.endDate });
        if (!w.ok) return res.status(400).json({ ok: false, message: w.message });
        const plan = ocoWindow.nextRunAt({ windowStart: w.windowStart, windowEnd: w.windowEnd });
        if (plan.mode === 'none') return res.status(400).json({ ok: false, message: plan.reason });
        if (plan.mode === 'schedule') {
          // IS BASLATILMAZ. Zamanlama kaydin kendisinde durur; retirement poller'i
          // pencere acilinca tetikler (bkz. poller.cjs). AWX-native schedule YOK:
          // kaydi Portal tutuyor, iptal ve gorunurluk burada.
          await db().query(
            `UPDATE retirement_targets SET status = 'stop_scheduled', scheduled_at = $1, window_end = $2, plan_text = $3, updated_at = GETUTCDATE() WHERE id = $4`,
            [plan.runAt, w.windowEnd, `OCO ${rec.ocoNo} penceresine zamanlandi: ${plan.text}`.slice(0, 1000), tid],
          );
          await addEvent(id, req.session?.user?.username, 'schedule', `${t.appName} @ ${t.host}: ${plan.reason}`);
          return res.json({ ok: true, scheduled: true, runAt: plan.runAt, runAtText: plan.text, windowEnd: w.windowEnd, message: plan.reason });
        }
        // plan.mode === 'now': pencere ACIK, asagidaki normal launch kosar. Pencere SONU
        // yine yazilir ki poller yarim kalmis bir isi pencere disinda tekrar denemesin.
        await db().query(`UPDATE retirement_targets SET window_end = $1 WHERE id = $2`, [w.windowEnd, tid]);
      }

      const notifyScc = confirmed && t.env === 'PROD' && !rec.sccNotifiedAt;
      if (notifyScc && !SCC_MAIL_TO) console.warn('[Retirement] RETIREMENT_SCC_MAIL_TO tanimsiz; SCC maili gonderilemeyecek');
      const extraVars = {
        target_host: t.host, application: t.appName, jboss_gen: String(t.gen), smart_no: rec.smartNo, app_path: t.appPath || '',
        plan_only: !confirmed, notify_scc: notifyScc && !!SCC_MAIL_TO, scc_mail_to: SCC_MAIL_TO, scc_mail_cc: SCC_MAIL_CC || undefined,
        oco_no: rec.ocoNo || '', requested_by: req.session?.user?.username || 'Portal',
      };
      const r = await launch(req, `Retirement: ${confirmed ? 'STOP' : 'plan'} ${t.appName} @ ${t.host}`, extraVars, { op: confirmed ? 'stop' : 'plan', id, tid });
      await db().query(`UPDATE retirement_targets SET status = $1, last_job_id = $2, updated_at = GETUTCDATE() WHERE id = $3`, [confirmed ? 'stopping' : 'planning', r.jobId, tid]);
      if (rec.status === 'open' && confirmed) await db().query(`UPDATE retirement_records SET status = 'stopping', updated_at = GETUTCDATE() WHERE id = $1`, [id]);
      await addEvent(id, req.session?.user?.username, confirmed ? 'stop' : 'plan', `${t.appName} @ ${t.host} (${t.env}, ${t.site}) iş #${r.jobId}${notifyScc ? (SCC_MAIL_TO ? ' · SCC maili' : ' · SCC adresi tanımsız!') : ''}`);
      res.json({ ok: true, ...r, planOnly: !confirmed, sccWarning: notifyScc && !SCC_MAIL_TO ? 'RETIREMENT_SCC_MAIL_TO tanımlı değil — SCC maili gönderilmedi.' : null });
    } catch (err) { res.status(err.status || 500).json({ ok: false, message: err.message }); }
  });

  // Is durumu: bitince hedef/kayit durumu guncellenir (set_stats app_retirement_stop_result)
  router.get('/:id/targets/:tid/job-status/:serverId/:jobId', async (req, res) => {
    const id = Number(req.params.id); const tid = Number(req.params.tid);
    const serverId = Number(req.params.serverId); const jobId = Number(req.params.jobId);
    if (![id, tid, serverId, jobId].every(Number.isInteger)) return res.status(400).json({ ok: false, message: 'Geçersiz parametre.' });
    try {
      const runner = require('../ansible/runner.cjs');
      const [statusInfo, outputInfo] = await Promise.all([runner.getJobStatusOnServer(serverId, jobId), runner.getJobOutputOnServer(serverId, jobId)]);
      const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
      let result = null;
      if (TERMINAL.has(statusInfo.status)) {
        const { extractStatsKey } = require('../opsx/index.cjs');
        result = extractStatsKey(statusInfo.artifacts, 'app_retirement_stop_result') || null;
        const line = String(result?.line || '');
        const msg = line.split('\t').slice(2).join(' — ') || statusInfo.status;
        // AYRINTI: STEP ve RENAMED satirlari. `line` yalniz OZET; plan onayinda hangi
        // dosyalara dokunulacagi bu listelerde. Alanlar gelmezse null yazilir (eski
        // playbook surumu) - uydurulmaz.
        const detailJson = (() => {
          const st = Array.isArray(result?.steps) ? result.steps : null;
          const rn = Array.isArray(result?.renamed) ? result.renamed : null;
          if (!st && !rn) return null;
          return JSON.stringify({ steps: st || [], renamed: rn || [] }).slice(0, 60000);
        })();
        const cur = await db().query(`SELECT status, last_job_id FROM retirement_targets WHERE id = $1`, [tid]);
        const row = cur.rows?.[0];
        if (row && Number(row.last_job_id) === jobId && (row.status === 'planning' || row.status === 'stopping')) {
          const planOnly = result ? !!result.plan_only : row.status === 'planning';
          if (planOnly) {
            await db().query(`UPDATE retirement_targets SET status = $1, plan_text = $2, detail_json = $3, updated_at = GETUTCDATE() WHERE id = $4`, [statusInfo.status === 'successful' ? 'planned' : 'failed', msg.slice(0, 1000), detailJson, tid]);
          } else if (statusInfo.status === 'successful' && /\tOK\t/.test(line)) {
            await db().query(`UPDATE retirement_targets SET status = 'stopped', result_text = $1, detail_json = $2, stopped_at = GETUTCDATE(), updated_at = GETUTCDATE() WHERE id = $3`, [msg.slice(0, 1000), detailJson, tid]);
            await db().query(`UPDATE retirement_records SET stop_at = COALESCE(stop_at, GETUTCDATE()), scc_notified_at = CASE WHEN $2 = 1 THEN COALESCE(scc_notified_at, GETUTCDATE()) ELSE scc_notified_at END, updated_at = GETUTCDATE() WHERE id = $1`, [id, SCC_MAIL_TO ? 1 : 0]);
            const left = await db().query(`SELECT COUNT(*) AS n FROM retirement_targets WHERE record_id = $1 AND status <> 'stopped' AND status <> 'skipped'`, [id]);
            if (Number(left.rows?.[0]?.n) === 0) await db().query(`UPDATE retirement_records SET status = 'stopped', updated_at = GETUTCDATE() WHERE id = $1`, [id]);
          } else {
            await db().query(`UPDATE retirement_targets SET status = 'failed', result_text = $1, detail_json = $2, updated_at = GETUTCDATE() WHERE id = $3`, [msg.slice(0, 1000), detailJson, tid]);
          }
          await addEvent(id, null, planOnly ? 'plan-result' : 'stop-result', `iş #${jobId}: ${msg}`);
        }
      }
      res.json({ ok: true, status: statusInfo.status, output: outputInfo.output || '', result });
    } catch (err) { res.status(err.status || 500).json({ ok: false, message: err.message }); }
  });

  // ── POLLER (kullanici karari 2026-10-06) ──────────────────────────────────────
  // STOP: OCO kesinti penceresi acilinca. DELETE: silme tarihi gelince, ekstra onay YOK.
  // Launcher ENJEKTE EDILIR; poller AWX'i tanimaz (dongusel require yok, testi aga cikmaz).
  //
  // `req` YOK: isi poller basliyor, oturum da yok. launch() `req.session?.user` okuyor ve
  // undefined'a dayanikli; tetikleyen kimlik olay kaydinda (addEvent username=null ->
  // "sistem") ve extraVars.requested_by'da yaziyor.
  try {
    require('./poller.cjs').startPoller(async (kind, t) => {
      const ortak = {
        target_host: t.host,
        application: t.application,
        jboss_gen: String(t.gen),
        smart_no: t.smartNo,
        app_path: t.appPath || '',
        requested_by: 'Portal (zamanlanmis)',
      };
      if (kind === 'stop') {
        // SCC MAILI ZAMANLANMIS KOSUDA DA GIDER: PROD'da ilk gercek stop'ta bildirim
        // sarti, isi insanin mi poller'in mi baslattigina bagli degil.
        const rec = await db().query(`SELECT scc_notified_at FROM retirement_records WHERE id = $1`, [t.recordId]);
        const notify = t.env === 'PROD' && !rec.rows?.[0]?.scc_notified_at && !!SCC_MAIL_TO;
        return launch(
          null,
          `Retirement: STOP ${t.application} @ ${t.host} (zamanlanmis)`,
          { ...ortak, plan_only: false, notify_scc: notify, scc_mail_to: SCC_MAIL_TO, scc_mail_cc: SCC_MAIL_CC || undefined, oco_no: t.ocoNo || '' },
          { op: 'stop', id: t.recordId, tid: t.targetId },
        );
      }
      return launch(
        null,
        `Retirement: DELETE ${t.application} @ ${t.host}`,
        { ...ortak, plan_only: false },
        { op: 'delete', id: t.recordId, tid: t.targetId },
        DELETE_REGISTRY_KEY,
      );
    },
    // SONLANDIRICI: DELETE'i kimse izlemiyor, sonucu poller yazmak zorunda.
    // OKUNAMADI != BASARISIZ: AWX'e ulasilamadiysa `terminal:false` doner ve hedef
    // 'deleting'de KALIR; bir sonraki tick tekrar bakar. 'failed' yazmak, aslinda
    // basarili olmus bir silmeyi basarisiz gostermek olurdu.
    async (t) => {
      const reg = require('../ansible/playbook-registry.cjs');
      const row = await reg.getByKey(DELETE_REGISTRY_KEY).catch(() => null);
      const serverId = row && row.awxServerId != null ? Number(row.awxServerId) : 0;
      const runner = require('../ansible/runner.cjs');
      const info = await runner.getJobStatusOnServer(serverId, Number(t.delete_job_id));
      const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
      if (!TERMINAL.has(info.status)) return { terminal: false };
      const { extractStatsKey } = require('../opsx/index.cjs');
      const r = extractStatsKey(info.artifacts, 'app_retirement_delete_result') || null;
      const line = String(r?.line || '');
      const msg = line.split('	').slice(2).join(' — ') || info.status;
      // ARTIFACT OKUNAMADIYSA is 'successful' olsa bile OK SAYILMAZ: playbook sonucu
      // `set_stats` ile bildiriyor; bildirim yoksa ne yapildigini BILMIYORUZ.
      const ok = info.status === 'successful' && line.split('\t')[2] === 'OK';
      return { terminal: true, ok, message: msg };
    });
  } catch (e) {
    console.warn('[Retirement] poller baslatilamadi:', e.message);
  }

  app.use('/api/retirement', router);
  console.log('[Retirement] mounted at /api/retirement');
}

module.exports = { initRetirement, REGISTRY_KEY, DELETE_REGISTRY_KEY, DEFAULT_DAYS };
