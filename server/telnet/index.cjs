// server/telnet/index.cjs — Telnet: Uygulama Sunucularinda Hizli Baglanti Testi.
//
// OpsX'in Legacy/Openshift + uygulama/sunucu secim akisinin BIREBIR kopyasi (kullanici
// istegi) — tek fark: son adimda bir ISLEM (restart/stop/...) degil, IP + Port sorulur
// ve Ansible'a { limit, extra_vars: { ip, port } } govdesiyle tetiklenir. Uygulama adi
// SADECE sunucu-tarafinda anti-TOCTOU dogrulamasi icin kullanilir, playbook'a
// GONDERILMEZ (kullanici sartnamesi — extra_vars yalniz ip/port icerir).
//
// HANGI AWX SUNUCUSU / TEMPLATE'I: Admin > Playbook Kayitlari ekranindan yonetilir
// (ansible_playbook_registry satirlari: telnet_legacy_operation, telnet_openshift_operation)
// — OpsX ile AYNI desen, template ID koda gomulu DEGIL.
'use strict';

const { hostsForApp } = require('../opsx/index.cjs');

const REGISTRY_KEYS = Object.freeze({
  legacy: 'telnet_legacy_operation',
  openshift: 'telnet_openshift_operation',
});

async function resolveTarget(platform) {
  const playbookRegistry = require('../ansible/playbook-registry.cjs');
  const keyName = REGISTRY_KEYS[platform];
  const row = await playbookRegistry.getByKey(keyName).catch(() => null);
  if (!row || row.enabled === false) {
    return { templateId: null, serverId: null, keyName };
  }
  const templateId = playbookRegistry.getEffectiveTemplateId(row);
  const envServer = Number(String(process.env.TELNET_AWX_SERVER_ID || '').trim());
  const serverId = row.awxServerId != null
    ? Number(row.awxServerId)
    : (Number.isInteger(envServer) && envServer >= 0 ? envServer : 0);
  return { templateId: templateId || null, serverId, keyName };
}

// IP/host icin basit bicim korumasi — shell/YAML enjeksiyonuna acik karakterleri
// (bosluk, noktali virgul, tirnak, backtick vb.) reddeder; belirli bir IPv4/IPv6/
// hostname sozdizimi ZORLANMAZ (kullanici DNS adi da girebilir), sadece TEHLIKELI
// karakterler elenir.
const SAFE_HOST_RE = /^[A-Za-z0-9.\-:_]{1,255}$/;

function initTelnet(app) {
  const express = require('express');

  // Paylasilan auth guard'i (OpsX/LogX v2 ile ayni desen).
  let requireAuth = (req, res, next) => res.status(401).json({ ok: false, message: 'Auth modülü yok.' });
  try {
    const authMod = require('../auth/index.cjs');
    if (typeof authMod.requireAuth === 'function') requireAuth = authMod.requireAuth;
  } catch { /* auth modulu yoksa deny kalir */ }

  // GET /api/telnet/apps?search= — OpsX ile AYNI kaynak.
  app.get('/api/telnet/apps', requireAuth, async (req, res) => {
    try {
      const legacy = require('../logx/v2/legacy.cjs');
      const result = await legacy.searchApps(req.query.search);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // GET /api/telnet/hosts?app= — OpsX'in hostsForApp'ini DOGRUDAN yeniden kullanir
  // (ayni env/jboss_version/status alanlari — kod tekrari yok).
  app.get('/api/telnet/hosts', requireAuth, async (req, res) => {
    try {
      const hosts = await hostsForApp(req.query.app);
      res.json({ ok: true, hosts });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // GET /api/telnet/clusters — OpsX/LogX ile AYNI cluster katalogu.
  app.get('/api/telnet/clusters', requireAuth, async (req, res) => {
    try {
      const adminData = require('../logx/v2/admin.cjs');
      const tree = await adminData.getClusterTree();
      res.json({ ok: true, tree });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // GET /api/telnet/job-status/:serverId/:jobId — OpsX ile AYNI canli-durum deseni.
  app.get('/api/telnet/job-status/:serverId/:jobId', requireAuth, async (req, res) => {
    const serverId = Number(req.params.serverId);
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(serverId) || !Number.isInteger(jobId) || jobId <= 0) {
      return res.status(400).json({ ok: false, message: 'Geçersiz sunucu/iş numarası.' });
    }

    // IDOR korumasi: OpsX ile AYNI kontrol. Kayit yoksa/DB hatasi varsa fail-open.
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
      const [statusInfo, outputInfo] = await Promise.all([
        runner.getJobStatusOnServer(serverId, jobId),
        runner.getJobOutputOnServer(serverId, jobId),
      ]);
      res.json({
        ok: true,
        status: statusInfo.status,
        output: outputInfo.output || '',
        finished: statusInfo.finished,
        failed: statusInfo.failed,
      });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // POST /api/telnet/run — testi tetikler.
  //
  // Legacy — sunucu listesi AWX'in KENDI `limit` alaninda:
  //   { "limit": "GBCJAP01,GBCJAP03", "extra_vars": { "ip": "...", "port": "..." } }
  // Openshift — `limit` YOK, terminal_host uzerinden calisir:
  //   { "extra_vars": { "terminal_host": "...", "namespace": "...",
  //                      "ocp_clusters": [...], "ip": "...", "port": "..." } }
  // Not: `application` yalniz sunucu-tarafi anti-TOCTOU dogrulamasi icindir, extra_vars'a
  // KONMAZ (kullanici sartnamesi).
  app.post('/api/telnet/run', requireAuth, express.json({ limit: '64kb' }), async (req, res) => {
    const { platform, application, hosts, env, tenant, clusters, namespace, ip, port } = req.body || {};
    const plat = platform === 'openshift' ? 'openshift' : 'legacy';

    const { templateId, serverId, keyName } = await resolveTarget(plat);
    if (!templateId) {
      return res.status(501).json({
        ok: false,
        message: `Telnet ${plat} testi için AWX job template'i henüz tanımlanmadı. `
               + `Yönetici, Admin > Playbook Kayıtları ekranında "${keyName}" satırının `
               + `Template ID alanını doldurmalı.`,
      });
    }

    const ipTrim = String(ip || '').trim();
    const portTrim = String(port || '').trim();
    if (!SAFE_HOST_RE.test(ipTrim)) {
      return res.status(400).json({ ok: false, message: 'Geçersiz IP/host adı.' });
    }
    const portNum = Number(portTrim);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      return res.status(400).json({ ok: false, message: 'Port 1-65535 arasında bir sayı olmalı.' });
    }

    let extraVars;
    let limitValue = '';   // yalniz Legacy'de dolu
    let logSummary;

    if (plat === 'legacy') {
      if (!String(application || '').trim()) {
        return res.status(400).json({ ok: false, message: 'Uygulama adı gerekli.' });
      }
      if (!Array.isArray(hosts) || hosts.length === 0) {
        return res.status(400).json({ ok: false, message: 'En az bir sunucu seçilmeli.' });
      }

      // ANTI-TOCTOU: OpsX ile AYNI kontrol — client'in gonderdigi host listesine guvenilmez.
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

      limitValue = requested.join(',');
      extraVars = { ip: ipTrim, port: portTrim };
      logSummary = `app=${String(application).trim()} limit=${limitValue} ip=${ipTrim} port=${portTrim}`;

    } else {
      // ── Openshift ───────────────────────────────────────────────────────────
      const envKey = String(env || '').trim();
      const tenantKey = String(tenant || '').trim();
      const ns = String(namespace || '').trim();

      if (!ns) return res.status(400).json({ ok: false, message: 'Namespace gerekli.' });
      if (!Array.isArray(clusters) || clusters.length === 0) {
        return res.status(400).json({ ok: false, message: 'En az bir cluster seçilmeli.' });
      }

      const adminData = require('../logx/v2/admin.cjs');
      let tree;
      try {
        tree = await adminData.getClusterTree();
      } catch (err) {
        return res.status(503).json({ ok: false, message: `Cluster kataloğu okunamadı: ${err.message}` });
      }
      if (!envKey || !tree[envKey]) {
        return res.status(400).json({ ok: false, message: `Ortam tanımlı değil: ${envKey || '(boş)'}` });
      }
      if (!tenantKey || !tree[envKey][tenantKey]) {
        return res.status(400).json({ ok: false, message: `Tenant tanımlı değil: ${tenantKey || '(boş)'}` });
      }
      const validClusters = new Set(tree[envKey][tenantKey] || []);
      const requested = clusters.map((c) => String(c || '').trim()).filter(Boolean);
      const notValid = requested.filter((c) => !validClusters.has(c));
      if (notValid.length) {
        return res.status(400).json({
          ok: false,
          message: `Bu cluster'lar "${envKey}/${tenantKey}" altında tanımlı değil: ${notValid.join(', ')}`,
        });
      }

      const terminalHost = await adminData.getTerminalHost(tenantKey, envKey);
      if (!terminalHost) {
        return res.status(400).json({
          ok: false,
          message: `"${tenantKey}/${envKey}" için terminal/bastion host tanımlı değil — `
                 + `Admin > LogX v2 Yapılandırma ekranından eklenmeli.`,
        });
      }

      extraVars = {
        terminal_host: terminalHost,
        namespace: ns,
        ocp_clusters: [{ env: envKey, tenant: tenantKey, cluster_name: requested.join(',') }],
        ip: ipTrim,
        port: portTrim,
      };
      logSummary = `ns=${ns} clusters=${requested.join(',')} terminal=${terminalHost} ip=${ipTrim} port=${portTrim}`;
    }

    try {
      const runner = require('../ansible/runner.cjs');
      const result = await runner.launchJobOnServer(serverId, templateId, extraVars, limitValue);

      // ansible_job_history'ye kayit — OpsX ile AYNI genel-amacli tablo (job-status
      // endpoint'inin IDOR korumasi bu kayda bakar).
      try {
        const db = require('../db/index.cjs');
        await db.query(
          `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            req.session?.user?.username || 'unknown',
            serverId, templateId, `Telnet: ${plat}`,
            result?.jobId, result?.status || 'pending',
            JSON.stringify({ platform: plat, ...(limitValue ? { limit: limitValue } : {}), ...extraVars }),
          ]
        );
      } catch (e) {
        console.warn('[Telnet] Gecmis kaydedilemedi:', e.message);
      }

      try {
        require('../audit/index.cjs').auditPortal(req, 'telnet_operation', {
          detail: JSON.stringify({ platform: plat, limit: limitValue || undefined, extraVars, jobId: result?.jobId ?? null }),
        });
      } catch { /* denetim kaydi best-effort */ }

      console.log(`[Telnet] ${req.session?.user?.username} -> ${plat} ${logSummary} template=${templateId} server=${serverId} job=${result?.jobId ?? '?'}`);
      res.json({
        ok: true,
        jobId: result?.jobId ?? null,
        status: result?.status ?? null,
        awxServerId: serverId,
        templateId,
        sentBody: { ...(limitValue ? { limit: limitValue } : {}), extra_vars: extraVars },
      });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  console.log('[Telnet] endpoints mounted at /api/telnet');
}

module.exports = { initTelnet };
