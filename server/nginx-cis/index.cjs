// server/nginx-cis/index.cjs — Nginx Hub › CIS sekmesinin HTTP yuzeyi.
//
// Veri: dbo.Nginx_Cis_Results / dbo.Nginx_Cis_Hosts (bmw_nginx/nginx_cis isi, gunde bir ve
// Portal'dan tek sunucu icin). Istisna ve kurum referanslari PORTAL DB'sinde (nginx_cis_exceptions,
// nginx_cis_overrides) — skor her istekte yeniden hesaplanir, job beklemeden etkili olur.
// "Canli skor": /rescan ucu playbook'u target_hosts ile tetikler; is bitince onbellek dusurulur.
'use strict';

const express = require('express');
const { scoreAll } = require('./score.cjs');
const { ITEMS, BY_ID } = require('./catalog.cjs');

const REGISTRY_KEY = 'nginx_cis_scan';
const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,62}$/;
let _cache = { at: 0, value: null };
const CACHE_MS = 60 * 1000;

async function loadRaw() {
  const { query } = require('../inventory/mssql.cjs');
  const ex = await query(`SELECT OBJECT_ID('dbo.Nginx_Cis_Results') AS oid`);
  if (!ex.recordset?.[0]?.oid) return { tableMissing: true, results: [], hosts: [] };
  const latest = `JOIN (SELECT host, MAX(scan_date) AS d FROM dbo.Nginx_Cis_Hosts GROUP BY host) m ON m.host = t.host AND m.d = t.scan_date`;
  const [results, hosts] = await Promise.all([
    query(`SELECT t.host, t.item_id, t.status, t.observed, t.detail FROM dbo.Nginx_Cis_Results t ${latest}`).then((r) => r.recordset || []),
    query(`SELECT t.host, t.nginx_version, t.t_state, t.msg, t.scan_date FROM dbo.Nginx_Cis_Hosts t ${latest}`).then((r) => r.recordset || []),
  ]);
  return { tableMissing: false, results, hosts };
}

async function loadPortalRules() {
  const db = require('../db/index.cjs');
  const [exceptions, overrides] = await Promise.all([
    db.query(`SELECT id, item_id, host, note, created_by, created_at FROM nginx_cis_exceptions`).then((r) => r.rows || []).catch(() => []),
    db.query(`SELECT id, item_id, expected, note, created_by, created_at FROM nginx_cis_overrides`).then((r) => r.rows || []).catch(() => []),
  ]);
  return { exceptions, overrides };
}

/** Kural damgasi: istisna/referans sayisi + en son degisiklik zamani. Kural BASKA bir Portal
 *  surecinde (ya da baska bir sekmede) degistiyse bu damga degisir ve onbellek dusurulur —
 *  kullanici: "istisnaya aldiktan sonra hemen guncellenmiyor gibi". */
async function rulesStamp() {
  try {
    const r = await require('../db/index.cjs').query(`
      SELECT (SELECT COUNT(*) FROM nginx_cis_exceptions) AS ec,
             (SELECT COUNT(*) FROM nginx_cis_overrides) AS oc,
             (SELECT MAX(created_at) FROM nginx_cis_exceptions) AS em,
             (SELECT MAX(created_at) FROM nginx_cis_overrides) AS om`);
    const x = (r.rows || [])[0] || {};
    return `${x.ec || 0}|${x.oc || 0}|${x.em || ''}|${x.om || ''}`;
  } catch {
    return 'na';
  }
}

async function getAssessment(fresh) {
  const stamp = await rulesStamp();
  if (!fresh && _cache.value && _cache.stamp === stamp && Date.now() - _cache.at < CACHE_MS) return _cache.value;
  const raw = await loadRaw();
  const rules = await loadPortalRules();
  const value = raw.tableMissing
    ? { tableMissing: true, hosts: [], perItem: [], summary: null, ...rules }
    : { tableMissing: false, ...scoreAll({ ...raw, ...rules }), ...rules };
  _cache = { at: Date.now(), stamp, value };
  return value;
}

async function resolveByKey(keyName) {
  const reg = require('../ansible/playbook-registry.cjs');
  const row = await reg.getByKey(keyName).catch(() => null);
  if (!row || row.enabled === false) return { templateId: null, serverId: null };
  return { templateId: reg.getEffectiveTemplateId(row) || null, serverId: row.awxServerId != null ? Number(row.awxServerId) : 0 };
}

const isAdmin = (req) => req.session?.user?.role === 'Admin';

function initNginxCis(app) {
  const { requireAuth } = require('../auth/index.cjs');
  const router = express.Router();
  router.use(express.json({ limit: '256kb' }));
  router.use(requireAuth);
  router.use((req, res, next) => (isAdmin(req) ? next() : res.status(403).json({ ok: false, message: 'CIS denetimi yalnız Admin.' })));
  try {
    const { requireVisiblePrefix, requireVisible } = require('../auth/visibility.cjs');
    router.use(requireVisiblePrefix('NginxConsole'));
    router.use(requireVisible('tab:nginx:cis'));
  } catch { /* motor yoksa yoksay */ }

  router.get('/overview', async (req, res) => {
    try {
      const a = await getAssessment(req.query.fresh === '1');
      if (a.tableMissing) {
        return res.json({ ok: true, tableMissing: true, message: 'dbo.Nginx_Cis_* tabloları henüz yok — nginx_cis job\'ı bir kez koşmalı.', hosts: [], perItem: [], summary: null, catalog: ITEMS, exceptions: [], overrides: [] });
      }
      res.json({
        ok: true, tableMissing: false, summary: a.summary, perItem: a.perItem, catalog: ITEMS,
        exceptions: a.exceptions, overrides: a.overrides,
        hosts: a.hosts.map((h) => ({ host: h.host, nginxVersion: h.nginxVersion, tState: h.tState, scanDate: h.scanDate, score: h.score, passed: h.passed, failed: h.failed, excepted: h.excepted, skipped: h.skipped })),
      });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message || 'CIS verisi alınamadı.' });
    }
  });

  router.get('/host/:host', async (req, res) => {
    const host = String(req.params.host || '').toUpperCase();
    if (!HOST_RE.test(host)) return res.status(400).json({ ok: false, message: 'Geçersiz sunucu adı.' });
    try {
      const a = await getAssessment(req.query.fresh === '1');
      const h = (a.hosts || []).find((x) => x.host === host);
      if (!h) return res.status(404).json({ ok: false, message: `${host} için CIS taraması yok.` });
      res.json({ ok: true, host: h });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  // Istisna: madde (global) ya da madde+sunucu. Skordan DUSER.
  router.put('/exceptions', async (req, res) => {
    try {
      const itemId = String(req.body?.itemId || '').trim();
      const host = req.body?.host ? String(req.body.host).trim().toUpperCase() : null;
      const note = String(req.body?.note || '').trim().slice(0, 500);
      if (!BY_ID.has(itemId)) return res.status(400).json({ ok: false, message: 'Bilinmeyen CIS maddesi.' });
      if (host && !HOST_RE.test(host)) return res.status(400).json({ ok: false, message: 'Geçersiz sunucu adı.' });
      if (!note) return res.status(400).json({ ok: false, message: 'Not zorunlu — istisnanın gerekçesi kaybolmasın.' });
      const db = require('../db/index.cjs');
      const by = req.session?.user?.username || null;
      const ex = await db.query(`SELECT id FROM nginx_cis_exceptions WHERE item_id = $1 AND ISNULL(host, '') = $2`, [itemId, host || '']);
      if ((ex.rows || []).length) await db.query(`UPDATE nginx_cis_exceptions SET note = $2, created_by = $3, created_at = GETUTCDATE() WHERE id = $1`, [ex.rows[0].id, note, by]);
      else await db.query(`INSERT INTO nginx_cis_exceptions (item_id, host, note, created_by) VALUES ($1, $2, $3, $4)`, [itemId, host, note, by]);
      _cache = { at: 0, value: null };
      try { require('../audit/index.cjs').auditPortal(req, 'nginx_cis_exception_set', { detail: JSON.stringify({ itemId, host, note }) }); } catch { /* best-effort */ }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  router.delete('/exceptions/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, message: 'id geçersiz' });
      await require('../db/index.cjs').query(`DELETE FROM nginx_cis_exceptions WHERE id = $1`, [id]);
      _cache = { at: 0, value: null };
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  // Kurum referansi: maddenin beklenen degeri (CIS yerine bizim deger).
  router.put('/overrides', async (req, res) => {
    try {
      const itemId = String(req.body?.itemId || '').trim();
      const expected = String(req.body?.expected ?? '').trim().slice(0, 256);
      const note = String(req.body?.note || '').trim().slice(0, 500);
      if (!BY_ID.has(itemId)) return res.status(400).json({ ok: false, message: 'Bilinmeyen CIS maddesi.' });
      if (!expected) return res.status(400).json({ ok: false, message: 'Beklenen değer zorunlu.' });
      const db = require('../db/index.cjs');
      const by = req.session?.user?.username || null;
      // Coklu deger (2026-09-22, kullanici): bir madde icin birden fazla kabul edilen deger
      // girilebilir (ornek 5.2.2 -> 1m ve 10m); ayni deger ikinci kez eklenirse notu guncellenir.
      const ex = await db.query(`SELECT id FROM nginx_cis_overrides WHERE item_id = $1 AND expected = $2`, [itemId, expected]);
      if ((ex.rows || []).length) await db.query(`UPDATE nginx_cis_overrides SET note = $2, created_by = $3, created_at = GETUTCDATE() WHERE id = $1`, [ex.rows[0].id, note, by]);
      else await db.query(`INSERT INTO nginx_cis_overrides (item_id, expected, note, created_by) VALUES ($1, $2, $3, $4)`, [itemId, expected, note, by]);
      _cache = { at: 0, value: null };
      try { require('../audit/index.cjs').auditPortal(req, 'nginx_cis_override_set', { detail: JSON.stringify({ itemId, expected, note }) }); } catch { /* best-effort */ }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  router.delete('/overrides/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, message: 'id geçersiz' });
      await require('../db/index.cjs').query(`DELETE FROM nginx_cis_overrides WHERE id = $1`, [id]);
      _cache = { at: 0, value: null };
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  // Canli skor: secilen sunucular (bos = tum filo) icin CIS taramasini AWX'te tetikle.
  router.post('/rescan', async (req, res) => {
    try {
      const hosts = Array.isArray(req.body?.hosts) ? req.body.hosts.map((h) => String(h).trim().toUpperCase()).filter((h) => HOST_RE.test(h)) : [];
      const { templateId, serverId } = await resolveByKey(REGISTRY_KEY);
      if (!templateId) return res.status(501).json({ ok: false, message: `AWX job template'i tanımlı değil: Admin › Playbook Kayıtları › "${REGISTRY_KEY}" satırına Template ID girilmeli.` });
      const extraVars = hosts.length ? { target_hosts: hosts.join(',') } : {};
      await require('../ansible/template-preflight.cjs').assertTemplateAcceptsExtraVars(serverId, templateId, extraVars, { label: REGISTRY_KEY });
      const user = req.session?.user || {};
      const result = await require('../ansible/runner.cjs').launchJobOnServer(serverId, templateId, extraVars, '', user);
      try {
        await require('../db/index.cjs').query(
          `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [user.username || 'unknown', serverId, templateId, `Nginx CIS: ${hosts.length ? hosts.join(',') : 'tüm filo'}`, result?.jobId, result?.status || 'pending', JSON.stringify(extraVars)],
        );
      } catch (e) { console.warn('[NginxCIS] job gecmisi yazilamadi:', e.message); }
      res.json({ ok: true, jobId: result?.jobId ?? null, status: result?.status ?? null, awxServerId: serverId, hosts });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  router.get('/job-status/:serverId/:jobId', async (req, res) => {
    const serverId = Number(req.params.serverId);
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(serverId) || !Number.isInteger(jobId) || jobId <= 0) return res.status(400).json({ ok: false, message: 'Geçersiz iş numarası.' });
    try {
      const runner = require('../ansible/runner.cjs');
      const [statusInfo, outputInfo] = await Promise.all([runner.getJobStatusOnServer(serverId, jobId), runner.getJobOutputOnServer(serverId, jobId)]);
      if (['successful', 'failed', 'error', 'canceled'].includes(statusInfo.status)) _cache = { at: 0, value: null };
      res.json({ ok: true, status: statusInfo.status, output: outputInfo?.output || '' });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  app.use('/api/nginx-cis', router);
}

module.exports = { initNginxCis, REGISTRY_KEY, getAssessment };
