// server/filex/index.cjs — FileX: Self Servis dosya listeleme (SADECE Legacy).
//
// OpsX'in AYNI deseni: kullanıcı uygulama adı + JBoss sürümü + sunucu seçer, bu portal
// bir AWX job'ı tetikler ve sonucu okur. FileX'in OpsX'ten farkı: hiçbir işlem YAPMAZ
// (restart/stop/start yok) — yalnızca seçilen uygulamanın .ear dizinindeki (logs HARİÇ)
// tüm dosyaları `ls -la` bilgisi + sha512sum ile SALT-OKUNUR listeler. Kullanıcılar
// "paketim geçmiş mi geçmemiş mi" sorusunu kendi repo'larındaki checksum'la
// karşılaştırarak bize sormadan cevaplayabilsin diye.
//
// HANGI AWX SUNUCUSU / TEMPLATE'I: Admin > Playbook Kayıtları ekranından yönetilir
// (ansible_playbook_registry satırı: filex_list_files). Referans playbook sözleşmesi
// için bkz. server/ansible/playbooks/filex_list_files.yml.
'use strict';

const REGISTRY_KEY = 'filex_list_files';

async function resolveTarget() {
  const playbookRegistry = require('../ansible/playbook-registry.cjs');
  const row = await playbookRegistry.getByKey(REGISTRY_KEY).catch(() => null);
  if (!row || row.enabled === false) {
    return { templateId: null, serverId: null };
  }
  const templateId = playbookRegistry.getEffectiveTemplateId(row);
  const envServer = Number(String(process.env.FILEX_AWX_SERVER_ID || '').trim());
  const serverId = row.awxServerId != null
    ? Number(row.awxServerId)
    : (Number.isInteger(envServer) && envServer >= 0 ? envServer : 0);
  return { templateId: templateId || null, serverId };
}

// AWX'in `artifacts` alanindan filex_result'i okur — OpsX/LogX ile AYNI ilke: ham stdout
// ASLA parse edilmez, sonuc her zaman playbook'un set_stats ile yayinladigi yapilandirilmis
// JSON'dan gelir. LogX v2'nin jobs.cjs'teki extractLogxResultFromArtifacts'inin FileX icin
// kucuk bir kopyasi — LogX'in kendi kalici request/job tablosuna bagimli olmadan, OpsX gibi
// hafif (stateless) bir akista kullanilabilsin diye ayri tutulur.
function extractFilexResult(rawArtifacts) {
  const artifacts = rawArtifacts || {};
  if (artifacts.filex_result && typeof artifacts.filex_result === 'object') return artifacts.filex_result;
  if (artifacts.data?.filex_result && typeof artifacts.data.filex_result === 'object') return artifacts.data.filex_result;
  if (artifacts.ansible_stats?.data?.filex_result && typeof artifacts.ansible_stats.data.filex_result === 'object') {
    return artifacts.ansible_stats.data.filex_result;
  }
  return null;
}

function initFileX(app) {
  const express = require('express');

  let requireAuth = (req, res, next) => res.status(401).json({ ok: false, message: 'Auth modülü yok.' });
  try {
    const authMod = require('../auth/index.cjs');
    if (typeof authMod.requireAuth === 'function') requireAuth = authMod.requireAuth;
  } catch { /* auth modulu yoksa deny kalir */ }

  try {
    const { requireVisiblePrefix } = require('../auth/visibility.cjs');
    app.use('/api/filex', requireVisiblePrefix('FileX'));
  } catch { /* motor yoksa yoksay */ }

  // GET /api/filex/apps?search= — OpsX/LogX ile AYNI kaynak.
  app.get('/api/filex/apps', requireAuth, async (req, res) => {
    try {
      const legacy = require('../logx/v2/legacy.cjs');
      const result = await legacy.searchApps(req.query.search);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // GET /api/filex/hosts?app= — OpsX'in hostsForApp'ini AYNEN kullanır (kod tekrarı yok).
  app.get('/api/filex/hosts', requireAuth, async (req, res) => {
    try {
      const { hostsForApp } = require('../opsx/index.cjs');
      const hosts = await hostsForApp(req.query.app);
      res.json({ ok: true, hosts });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // POST /api/filex/run — { application, hosts } -> AWX job tetikler.
  app.post('/api/filex/run', requireAuth, express.json({ limit: '64kb' }), async (req, res) => {
    const { application, hosts } = req.body || {};

    const { templateId, serverId } = await resolveTarget();
    if (!templateId) {
      return res.status(501).json({
        ok: false,
        message: `FileX için AWX job template'i henüz tanımlanmadı. Yönetici, Admin > `
               + `Playbook Kayıtları ekranında "${REGISTRY_KEY}" satırının Template ID `
               + `alanını doldurmalı.`,
      });
    }

    if (!String(application || '').trim()) {
      return res.status(400).json({ ok: false, message: 'Uygulama adı gerekli.' });
    }
    if (!Array.isArray(hosts) || hosts.length === 0) {
      return res.status(400).json({ ok: false, message: 'En az bir sunucu seçilmeli.' });
    }

    // ANTI-TOCTOU: OpsX ile AYNI kontrol — client'in gonderdigi host listesine guvenilmez.
    const { hostsForApp } = require('../opsx/index.cjs');
    let allowed;
    try {
      allowed = new Set((await hostsForApp(application)).map((h) => h.host.toUpperCase()));
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, message: err.message });
    }
    const requested = hosts.map((h) => String(h || '').trim().toUpperCase()).filter(Boolean);
    const notMine = requested.filter((h) => !allowed.has(h));
    if (notMine.length) {
      return res.status(400).json({
        ok: false,
        message: `Bu sunucular seçilen uygulamaya ait değil: ${notMine.join(', ')}`,
      });
    }

    const extraVars = { app_name: String(application).trim(), target_hosts: requested.join(',') };

    try {
      const runner = require('../ansible/runner.cjs');
      const result = await runner.launchJobOnServer(serverId, templateId, extraVars, '');

      try {
        const db = require('../db/index.cjs');
        await db.query(
          `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            req.session?.user?.username || 'unknown',
            serverId, templateId, 'FileX: dosya listeleme',
            result?.jobId, result?.status || 'pending',
            JSON.stringify(extraVars),
          ]
        );
      } catch (e) {
        console.warn('[FileX] Gecmis kaydedilemedi:', e.message);
      }

      try {
        require('../audit/index.cjs').auditPortal(req, 'filex_list_files', {
          detail: JSON.stringify({ extraVars, jobId: result?.jobId ?? null }),
        });
      } catch { /* denetim kaydi best-effort */ }

      console.log(`[FileX] ${req.session?.user?.username} -> app=${extraVars.app_name} hosts=${extraVars.target_hosts} template=${templateId} server=${serverId} job=${result?.jobId ?? '?'}`);
      res.json({ ok: true, jobId: result?.jobId ?? null, status: result?.status ?? null, awxServerId: serverId });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // GET /api/filex/job-status/:serverId/:jobId — canlı durum + (bitince) yapılandırılmış sonuç.
  app.get('/api/filex/job-status/:serverId/:jobId', requireAuth, async (req, res) => {
    const serverId = Number(req.params.serverId);
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(serverId) || !Number.isInteger(jobId) || jobId <= 0) {
      return res.status(400).json({ ok: false, message: 'Geçersiz sunucu/iş numarası.' });
    }

    // IDOR korumasi: OpsX ile AYNI kontrol.
    try {
      const db = require('../db/index.cjs');
      const reqUser = req.session?.user || {};
      if (reqUser.role !== 'Admin') {
        const { rows } = await db.query(
          `SELECT TOP 1 username FROM ansible_job_history WHERE job_id = $1 AND awx_server_id = $2`,
          [jobId, serverId]
        );
        if (rows.length && rows[0].username && String(rows[0].username).toLowerCase() !== String(reqUser.username || '').toLowerCase()) {
          return res.status(403).json({ ok: false, message: 'Bu iş size ait değil.' });
        }
      }
    } catch { /* DB hiccup -> fail-open */ }

    try {
      const runner = require('../ansible/runner.cjs');
      const statusInfo = await runner.getJobStatusOnServer(serverId, jobId);
      const finished = statusInfo.finished;
      const result = finished ? extractFilexResult(statusInfo.artifacts) : null;
      res.json({
        ok: true,
        status: statusInfo.status,
        finished,
        failed: statusInfo.failed || (finished && !result),
        result,
      });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  console.log('[FileX] endpoints mounted at /api/filex');
}

module.exports = { initFileX };
