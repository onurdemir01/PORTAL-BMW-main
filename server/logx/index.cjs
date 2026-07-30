// server/logx/index.cjs — LogX (v1) admin/inventory yardimci router'i.
//
// Faz 7 kesim (cutover) notu: Port-1111 reverse-proxy akisi (test-access, session/open,
// session/heartbeat, session/close, /proxy/:sessionId), logx_permissions tabanli eski
// yetkilendirme (admin/permissions) ve kullanilmayan /analyze alias'i BU DOSYADAN
// KALDIRILDI — bkz. LogX v2 (server/logx/v2/), bu guvenlik aciklarini kapatan ve dosya
// tabanli guvenli indirme sunan yeni implementasyon. Geriye yalnizca hâlâ kullanilan
// paylasilan altyapi birakildi: inventory_hosts CRUD (admin ekrani + AI Analyst
// araclari tarafindan kullaniliyor), audit log goruntuleme (logx_audit_logs artik HEM
// eski hem v2 aksiyonlarini iceriyor) ve /playbook-run (genel tanilama, log-fetching'le
// ilgisiz).
'use strict';

const express = require('express');
const db = require('../db/index.cjs');
const inventory = require('./inventory.cjs');
const audit = require('./audit.cjs');
const { requireAuth } = require('../auth/index.cjs');

function getUser(req) {
  if (req.session?.user) {
    const u = req.session.user;
    return { username: u.username, role: u.role || 'User', authSource: u.authSource || 'local' };
  }
  return { username: 'anonymous', role: 'User', authSource: 'local' };
}

function initLogX(app) {
  const router = express.Router();

  // ── Health ──────────────────────────────────────────────────────────────────
  router.get('/health', async (_req, res) => {
    const dbOk = await db.isAvailable().catch(() => false);
    res.json({ ok: true, service: 'logx', db: dbOk });
  });

  // ── Inventory (public, active hosts only) ────────────────────────────────────
  router.get('/inventory', async (_req, res) => {
    try {
      const hosts = await inventory.listHosts();
      res.json({ ok: true, hosts });
    } catch (err) {
      res.status(503).json({ ok: false, error: 'Database unavailable', detail: err.message });
    }
  });

  // ── Admin: Inventory CRUD ─────────────────────────────────────────────────────
  router.get('/admin/inventory', async (req, res) => {
    if (getUser(req).role !== 'Admin') return res.status(403).json({ ok: false, error: 'Admin only' });
    try {
      const hosts = await inventory.getAllHosts();
      res.json({ ok: true, hosts });
    } catch (err) { res.status(503).json({ ok: false, error: err.message }); }
  });

  router.post('/admin/inventory', async (req, res) => {
    if (getUser(req).role !== 'Admin') return res.status(403).json({ ok: false, error: 'Admin only' });
    const { hostname, ip } = req.body || {};
    if (!hostname || !ip) return res.status(400).json({ ok: false, error: 'hostname and ip required' });
    try {
      const host = await inventory.createHost(req.body);
      res.status(201).json({ ok: true, host });
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
  });

  router.put('/admin/inventory/:id', async (req, res) => {
    if (getUser(req).role !== 'Admin') return res.status(403).json({ ok: false, error: 'Admin only' });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, error: 'Invalid id' });
    try {
      const host = await inventory.updateHost(id, req.body);
      if (!host) return res.status(404).json({ ok: false, error: 'Not found' });
      res.json({ ok: true, host });
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
  });

  router.delete('/admin/inventory/:id', async (req, res) => {
    if (getUser(req).role !== 'Admin') return res.status(403).json({ ok: false, error: 'Admin only' });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, error: 'Invalid id' });
    try {
      const deleted = await inventory.deleteHost(id);
      res.json({ ok: deleted });
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
  });

  // ── Admin: Audit log (logx_audit_logs — hem eski hem LogX v2 aksiyonlarini icerir) ──
  router.get('/admin/audit', async (req, res) => {
    if (getUser(req).role !== 'Admin') return res.status(403).json({ ok: false, error: 'Admin only' });
    const { username, targetHost, action, limit = '50', offset = '0' } = req.query;
    const parsedLimit  = Math.min(500, Math.max(1, parseInt(limit, 10) || 50));
    const parsedOffset = Math.max(0, parseInt(offset, 10) || 0);
    try {
      const logs = await audit.getLogs({ limit: parsedLimit, offset: parsedOffset,
        username, targetHost, action });
      res.json({ ok: true, logs, page: Math.floor(parsedOffset / parsedLimit) + 1, limit: parsedLimit });
    } catch (err) { res.status(503).json({ ok: false, error: err.message }); }
  });

  router.get('/admin/audit/verify', async (req, res) => {
    if (getUser(req).role !== 'Admin') return res.status(403).json({ ok: false, error: 'Admin only' });
    try {
      const result = await audit.verifyChain();
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(503).json({ ok: false, error: err.message });
    }
  });

  // POST /api/logx/playbook-run — DB'de kayitli (Admin > Playbook Kayitlari veya .env)
  // herhangi bir "host_target" tanilama playbook'unu calistirir (jvm_heap_status,
  // network_connectivity_check, disk_usage_status, vb. — bkz. server/ansible/
  // playbook-registry.cjs). Log-fetching'le ilgisi yok, dokunulmadi.
  router.post('/playbook-run', requireAuth, async (req, res) => {
    const { key, hostname } = req.body || {};
    if (!key) return res.status(400).json({ ok: false, error: 'key gerekli.' });
    if (!hostname) return res.status(400).json({ ok: false, error: 'hostname gerekli.' });

    let runnerMod, playbookRegistry;
    try {
      runnerMod = require('../ansible/runner.cjs');
      playbookRegistry = require('../ansible/playbook-registry.cjs');
    } catch {
      return res.status(503).json({ ok: false, error: 'Ansible modülleri yüklenemedi.' });
    }
    if (!runnerMod.isConfigured()) {
      return res.status(503).json({ ok: false, error: 'AWX yapılandırılmamış. NEEDS.md dosyasına bakın.' });
    }

    const row = await playbookRegistry.getByKey(key).catch(() => null);
    if (!row || !row.enabled || row.handler !== 'host_target') {
      return res.status(404).json({ ok: false, error: 'Playbook bulunamadı veya kullanılamıyor.' });
    }
    const templateId = playbookRegistry.getEffectiveTemplateId(row);
    if (!templateId) {
      return res.status(503).json({ ok: false, error: `${row.displayName} için template ID tanımlı değil (Admin > Playbook Kayıtları veya ${row.envVarName}).` });
    }

    try {
      const launch = await runnerMod.launchJob(Number(templateId), { target_hosts: hostname }, hostname);

      let attempts = 0;
      let jobStatus;
      while (attempts < 30) {
        await new Promise(r => setTimeout(r, 2000));
        jobStatus = await runnerMod.getJobStatus(launch.jobId);
        if (['successful', 'failed', 'error', 'canceled'].includes(jobStatus.status)) break;
        attempts++;
      }

      if (!jobStatus || jobStatus.status !== 'successful') {
        return res.status(502).json({ ok: false, error: `AWX job ${jobStatus?.status || 'timeout'}`, jobId: launch.jobId });
      }

      const output = await runnerMod.getJobOutput(launch.jobId);
      res.json({ ok: true, output: output.output, jobId: launch.jobId, displayName: row.displayName });
    } catch (err) {
      res.status(502).json({ ok: false, error: err.message });
    }
  });

  app.use('/api/logx', router);
  console.log('[LogX] module mounted at /api/logx (v1 — yalnizca inventory/audit/playbook-run)');
}

module.exports = { initLogX };
