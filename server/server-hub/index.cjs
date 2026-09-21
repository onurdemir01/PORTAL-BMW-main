// server/server-hub/index.cjs - Server Hub (2026-09-21).
//
// Kullanici: "sunucu reboot oldugunda her sey dogru acilacak mi ve sunucularda atil bir sey var
// mi" — gunluk tarama (bmw_automation_folder/server_hub) dbo.Server_Hub_* tablolarina yazar;
// burasi son taramayi okur, assess.cjs ile bulguya cevirir, "simdi tara" (tek sunucu, reboot
// oncesi) ve "duzelt" (tek sunucu, tek eylem; ONCE PLAN, sonra onay) islerini AWX'te tetikler.
//
// Yetki: sayfa Admin'e seed'li; uclar da Admin'e kapali (Nginx Hub deseni). Duzeltme yalniz
// Admin ve yalniz assess'in urettigi eylem/parametrelerle (client istedigi komutu gonderemez).
'use strict';

const express = require('express');
const { assess } = require('./assess.cjs');

const REGISTRY_KEYS = Object.freeze({ scan: 'server_hub_scan', fix: 'server_hub_fix' });
const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,62}$/;
const FIX_ACTIONS = new Set(['jboss_autostart_on', 'jboss_autostart_off', 'jboss_retire', 'apache_comment_line', 'apache_retire_vhost']);

// Son degerlendirme onbellegi (tum filo icin 7 tablo okumak 1-2 sn; ekran her acilista yeniden
// okumasin). 60 sn; ?fresh=1 ve is bitisleri atlar.
let _cache = { at: 0, value: null };
const CACHE_MS = 60 * 1000;

async function loadLatest() {
  const { query } = require('../inventory/mssql.cjs');
  const ex = await query(`SELECT OBJECT_ID('dbo.Server_Hub_Hosts') AS oid`);
  if (!ex.recordset?.[0]?.oid) return { tableMissing: true, data: null };
  // her sunucunun SON taramasi (gun): Hosts tablosundaki max scan_date
  const q = (table) => query(
    `SELECT t.* FROM ${table} t
       JOIN (SELECT host, MAX(scan_date) AS d FROM dbo.Server_Hub_Hosts GROUP BY host) m
         ON m.host = t.host AND m.d = t.scan_date`,
  ).then((r) => r.recordset || []);
  const [hosts, init, jboss, jvms, web, vhosts, ips] = await Promise.all([
    q('dbo.Server_Hub_Hosts'), q('dbo.Server_Hub_Init'), q('dbo.Server_Hub_Jboss'), q('dbo.Server_Hub_Jvms'),
    q('dbo.Server_Hub_Web'), q('dbo.Server_Hub_Vhosts'), q('dbo.Server_Hub_Ips'),
  ]);
  return { tableMissing: false, data: { hosts, init, jboss, jvms, web, vhosts, ips } };
}

async function getAssessment(fresh) {
  if (!fresh && _cache.value && Date.now() - _cache.at < CACHE_MS) return _cache.value;
  const { tableMissing, data } = await loadLatest();
  const value = tableMissing
    ? { tableMissing: true, hosts: [], summary: null, latestScan: null }
    : { tableMissing: false, ...assess(data) };
  _cache = { at: Date.now(), value };
  return value;
}

// Yanit sekli: sunucu listesi HAFIF (bulgu sayilari + urunler), ayrinti /host/:host ile.
function hostRow(h) {
  return {
    host: h.host, scanDate: h.scanDate, products: h.products, status: h.status, counts: h.counts,
    wallS: h.wallS, cpuS: h.cpuS,
    jvms: h.jvms.length, jvmsRunning: h.jvms.filter((j) => j.running).length,
    vhosts: h.vhosts.length, unusedIps: h.ips.filter((i) => i.usedBy === 'none' && !i.primary).length,
    topFinding: h.findings.slice().sort((a, b) => ({ danger: 3, warning: 2, info: 1 }[b.severity] || 0) - ({ danger: 3, warning: 2, info: 1 }[a.severity] || 0))[0]?.text || null,
  };
}

function hostDetail(h) {
  return {
    ...hostRow(h),
    findings: h.findings,
    init: h.init, jboss: h.jboss,
    jvms: h.jvms.map((j) => ({ ...j, vhosts: j.vhosts.map((m) => ({ host: m.host, product: m.v.product, serverName: m.v.serverName, req24h: m.v.req24h, req7d: m.v.req7d, hc24h: m.v.hc24h, sampled: m.v.sampled })) })),
    web: h.web, vhosts: h.vhosts.map((v) => ({ ...v, proxyTargets: v.proxyTargetsRaw })), ips: h.ips,
  };
}

// ── AWX ─────────────────────────────────────────────────────────────────────────
async function resolveByKey(keyName) {
  const reg = require('../ansible/playbook-registry.cjs');
  const row = await reg.getByKey(keyName).catch(() => null);
  if (!row || row.enabled === false) return { templateId: null, serverId: null };
  return { templateId: reg.getEffectiveTemplateId(row) || null, serverId: row.awxServerId != null ? Number(row.awxServerId) : 0 };
}

async function launch(req, keyName, templateName, extraVars, detail) {
  const { templateId, serverId } = await resolveByKey(keyName);
  if (!templateId) {
    throw Object.assign(new Error(`AWX job template'i tanımlı değil: Admin › Playbook Kayıtları › "${keyName}" satırına Template ID girilmeli.`), { status: 501 });
  }
  const runner = require('../ansible/runner.cjs');
  await require('../ansible/template-preflight.cjs').assertTemplateAcceptsExtraVars(serverId, templateId, extraVars, { label: keyName });
  const user = req.session?.user || {};
  const result = await runner.launchJobOnServer(serverId, templateId, extraVars, '', user);
  try {
    const db = require('../db/index.cjs');
    await db.query(
      `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user.username || 'unknown', serverId, templateId, templateName, result?.jobId, result?.status || 'pending', JSON.stringify(extraVars)],
    );
  } catch (e) { console.warn('[ServerHub] job gecmisi yazilamadi:', e.message); }
  try { require('../audit/index.cjs').auditPortal(req, 'server_hub', { detail: JSON.stringify({ ...detail, jobId: result?.jobId ?? null }) }); } catch { /* best-effort */ }
  return { jobId: result?.jobId ?? null, status: result?.status ?? null, awxServerId: serverId };
}

const isAdmin = (req) => req.session?.user?.role === 'Admin';

function initServerHub(app) {
  const { requireAuth } = require('../auth/index.cjs');
  const router = express.Router();
  router.use(express.json({ limit: '256kb' }));
  router.use(requireAuth);
  router.use((req, res, next) => (isAdmin(req) ? next() : res.status(403).json({ ok: false, message: 'Server Hub yalnız Admin.' })));
  try {
    const { requireVisiblePrefix } = require('../auth/visibility.cjs');
    router.use(requireVisiblePrefix('ServerHub'));
  } catch { /* motor yoksa yoksay */ }

  router.get('/overview', async (req, res) => {
    try {
      const a = await getAssessment(req.query.fresh === '1');
      if (a.tableMissing) return res.json({ ok: true, tableMissing: true, message: 'dbo.Server_Hub_* tabloları henüz yok — server_hub_scan job\'ı bir kez koşmalı.', hosts: [], summary: null, latestScan: null });
      res.json({ ok: true, tableMissing: false, latestScan: a.latestScan, summary: a.summary, hosts: a.hosts.map(hostRow) });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message || 'Server Hub verisi alınamadı.' });
    }
  });

  router.get('/host/:host', async (req, res) => {
    const host = String(req.params.host || '').toUpperCase();
    if (!HOST_RE.test(host)) return res.status(400).json({ ok: false, message: 'Geçersiz sunucu adı.' });
    try {
      const a = await getAssessment(req.query.fresh === '1');
      const h = a.hosts.find((x) => x.host === host);
      if (!h) return res.status(400).json({ ok: false, message: `${host} için tarama verisi yok.` });
      res.json({ ok: true, host: hostDetail(h) });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  // Tek sunucu (reboot oncesi) tarama: target_hosts ile; loader o sunucunun bugunku satirlarini yeniler.
  router.post('/scan', async (req, res) => {
    const hosts = [...new Set((Array.isArray(req.body?.hosts) ? req.body.hosts : []).map((h) => String(h || '').trim().toUpperCase()).filter(Boolean))];
    if (!hosts.length || hosts.length > 50 || hosts.some((h) => !HOST_RE.test(h))) return res.status(400).json({ ok: false, message: '1-50 arası geçerli sunucu adı gerekli.' });
    try {
      const r = await launch(req, REGISTRY_KEYS.scan, `Server Hub: tara ${hosts.length === 1 ? hosts[0] : hosts.length + ' sunucu'}`, { target_hosts: hosts.join(',') }, { op: 'scan', hosts });
      res.json({ ok: true, ...r });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // Duzelt: yalniz assess'in urettigi eylemler (sunucu tarafinda yeniden turetilir, client'a guvenilmez).
  // plan_only=true -> PLAN (degisiklik yok); confirmed=true -> uygular.
  router.post('/fix', async (req, res) => {
    const host = String(req.body?.host || '').toUpperCase();
    const code = String(req.body?.code || '');
    const fixKey = String(req.body?.fixKey || '');
    const confirmed = req.body?.confirmed === true;
    const reload = req.body?.reload === true;
    if (!HOST_RE.test(host)) return res.status(400).json({ ok: false, message: 'Geçersiz sunucu adı.' });
    try {
      const a = await getAssessment(true);
      const h = a.hosts.find((x) => x.host === host);
      if (!h) return res.status(400).json({ ok: false, message: `${host} için tarama verisi yok.` });
      const finding = h.findings.find((f) => f.fix && f.code === code && JSON.stringify(f.fix) === fixKey);
      if (!finding) return res.status(400).json({ ok: false, message: 'Bu bulgu için tanımlı bir düzeltme yok ya da tarama verisi değişti — sayfayı yenileyin.' });
      const fix = finding.fix;
      if (!FIX_ACTIONS.has(fix.action)) return res.status(400).json({ ok: false, message: 'Bilinmeyen eylem.' });
      const extraVars = { target_host: host, action: fix.action, plan_only: !confirmed, reload };
      for (const k of ['gen', 'jvm', 'product', 'file', 'line', 'server_name']) if (fix[k] != null) extraVars[k] = fix[k];
      const r = await launch(req, REGISTRY_KEYS.fix, `Server Hub: ${confirmed ? 'düzelt' : 'plan'} ${fix.action} @ ${host}`, extraVars, { op: confirmed ? 'fix' : 'plan', host, code, fix });
      res.json({ ok: true, ...r, planOnly: !confirmed });
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
      const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
      let result = null;
      if (TERMINAL.has(statusInfo.status)) {
        const { extractStatsKey } = require('../opsx/index.cjs');
        result = extractStatsKey(statusInfo.artifacts, 'server_hub_fix_result') || extractStatsKey(statusInfo.artifacts, 'server_hub_scan_result') || null;
        _cache = { at: 0, value: null }; // tarama/duzeltme bitti -> sonraki okuma taze
      }
      res.json({ ok: true, status: statusInfo.status, output: outputInfo.output || '', result });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  app.use('/api/server-hub', router);
  console.log('[ServerHub] mounted at /api/server-hub');
}

module.exports = { initServerHub, REGISTRY_KEYS, FIX_ACTIONS, HOST_RE, hostRow, hostDetail };
