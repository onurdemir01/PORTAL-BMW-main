// server/nginx-migration/index.cjs - "Production Tasimalari > Tanim olustur".
//
// Eski GBRVP* sunucusundaki bir proxy_pass location'ini, YENI prod SPA sunucularinda
// SPA tanimi olarak olusturan AWX job'ini tetikler. Arkasindaki playbook:
//   gar_bmt_ansible_scripts/bmw_nginx/nginx_ops/nginx_prod_migration.yml
// (nginx_ops'un `operations` rolu; non-prod SPA olusturma akisinin aynisi, hedef yeni
// sunucular, env=prod -> <SERVICE>-PROD.conf, migration_mode=true -> 23:00 zamanlamasi yok).
//
// NEYI GONDERIR: service (vhost), application, namespace (gercek, -prod'lu), input_path
// (eski sunucudaki context path), requester. Hedef sunuculari PLAYBOOK secer (GLOMO /
// GLOMO-disi) - Portal host listesi gondermez; uc yerdeki liste birebir tutulur.
//
// ANTI-TAMPER: istemcinin gonderdigi (group, namespace, application, service, inputPath)
// dordulusu, Portal'in KENDI tasima gorunumunde (loadMigration) gercekten bir satir mi?
// Aksi halde istemci istedigi uygulama/yol icin tanim yazdirabilirdi. Ayrica satir
// "hazir" ya da "kismi" degilse (uygulama dizini hicbir yeni sunucuda yoksa) playbook
// zaten spa_facts'te durur; burada da acik mesajla reddedilir - job bosuna kosmasin.
'use strict';

const express = require('express');

const CONFIG_NAME = 'nginx-prod-migration';

/** Playbook'a giden extra_vars - saf, test edilebilir. */
function buildExtraVars({ service, application, namespace, inputPath, user }) {
  return {
    service: String(service || '').trim().toUpperCase(),
    application: String(application || '').trim(),
    namespace: String(namespace || '').trim(),
    input_path: String(inputPath || '').trim(),
    requester_name: (user && (user.displayName || user.username)) || '',
    requester_email: (user && user.email) || '',
  };
}

/**
 * Istegi tasima gorunumune karsi dogrular.
 * @returns {{ok:true, app:Object, path:Object} | {ok:false, status:number, message:string}}
 */
function validateRequest(groups, { group, namespace, application, service, inputPath }) {
  const g = (groups || []).find((x) => x.id === String(group || ''));
  if (!g) return { ok: false, status: 400, message: 'Geçersiz taşıma grubu.' };
  const ns = String(namespace || '').trim().toLowerCase();
  const app = String(application || '').trim().toLowerCase();
  const row = g.apps.find((a) => a.namespace === ns && a.application === app);
  if (!row) {
    return { ok: false, status: 400, message: `${ns}/${app} bu grubun taşıma listesinde yok.` };
  }
  const svc = String(service || '').trim().toUpperCase();
  const loc = String(inputPath || '').trim();
  const p = row.paths.find((x) => x.service.toUpperCase() === svc && x.location === loc);
  if (!p) {
    return {
      ok: false,
      status: 400,
      message: `${svc} ${loc} bu uygulamanın eski sunucudaki location'ları arasında yok.`,
    };
  }
  if (row.status === 'not-scanned') {
    return {
      ok: false,
      status: 409,
      message: 'Yeni sunucular henüz taranmadı; uygulama dizini var mı bilinmiyor. Önce nginx_config_audit koşmalı.',
    };
  }
  if (row.status === 'missing') {
    return {
      ok: false,
      status: 409,
      message: `${app} taranan hiçbir yeni sunucuda deploy edilmemiş (/usr/nginx/applications/${ns}/${app}). Playbook dizin yoksa durur; önce deploy gerekli.`,
    };
  }
  return { ok: true, app: row, path: p };
}

function initNginxMigration(app) {
  const db = require('../db/index.cjs');
  const { requireAuth, requireAdmin, getRequestUser } = require('../auth/index.cjs');
  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));
  router.use(requireAuth);

  async function readConfig() {
    try {
      const { rows } = await db.query(`SELECT data FROM portal_config_blobs WHERE name = $1`, [CONFIG_NAME]);
      const raw = rows?.[0]?.data;
      const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw || {};
      return { awxServerId: Number(cfg.awxServerId) || 0, templateId: Number(cfg.templateId) || 0 };
    } catch {
      return { awxServerId: 0, templateId: 0 };
    }
  }

  router.get('/config', async (_req, res) => {
    res.json({ ok: true, config: await readConfig() });
  });

  router.put('/config', requireAdmin, async (req, res) => {
    const awxServerId = Number(req.body?.awxServerId) || 0;
    const templateId = Number(req.body?.templateId) || 0;
    if (awxServerId <= 0 || templateId <= 0) {
      return res.status(400).json({ ok: false, message: 'AWX sunucusu ve template ID zorunlu.' });
    }
    const data = JSON.stringify({ awxServerId, templateId });
    try {
      const ex = await db.query(`SELECT 1 FROM portal_config_blobs WHERE name = $1`, [CONFIG_NAME]);
      if (ex.rows.length) {
        await db.query(`UPDATE portal_config_blobs SET data = $2 WHERE name = $1`, [CONFIG_NAME, data]);
      } else {
        await db.query(`INSERT INTO portal_config_blobs (name, data) VALUES ($1, $2)`, [CONFIG_NAME, data]);
      }
      res.json({ ok: true, config: { awxServerId, templateId } });
    } catch (err) {
      res.status(503).json({ ok: false, message: err.message });
    }
  });

  // -- Eylem: yeni sunucularda SPA tanimi olustur ------------------------------
  router.post('/create', async (req, res) => {
    const cfg = await readConfig();
    if (!cfg.awxServerId || !cfg.templateId) {
      return res.status(409).json({
        ok: false,
        message:
          'Taşıma job\'ı henüz yapılandırılmamış. nginx_prod_migration.yml için AWX\'te açılan ' +
          'template, bu sayfadaki yönetici panelinden tanıtılmalı.',
      });
    }
    try {
      const { query, sql } = require('../inventory/mssql.cjs');
      const { loadMigration } = require('../audit/nginx-migration.cjs');
      const view = await loadMigration({ query, sql, hasProxyColumns: null });
      const v = validateRequest(view.groups, req.body || {});
      if (!v.ok) return res.status(v.status).json({ ok: false, message: v.message });

      const { launchJobOnServer } = require('../ansible/runner.cjs');
      const user = getRequestUser(req) || {};
      const extra = buildExtraVars({
        service: v.path.service,
        application: v.app.application,
        namespace: v.app.namespace,
        inputPath: v.path.location,
        user,
      });
      const job = await launchJobOnServer(cfg.awxServerId, cfg.templateId, extra, '', user.username || null);
      try {
        require('../audit/index.cjs').auditPortal(req, 'nginx_prod_migration_create', {
          username: user.username,
          result: 'ok',
          detail: JSON.stringify({ ...extra, jobId: job?.id || null, group: req.body?.group }),
        });
      } catch {
        /* audit modulu yoksa yoksay */
      }
      const g = view.groups.find((x) => x.id === String(req.body?.group || ''));
      res.json({ ok: true, job, extraVars: extra, targetHosts: g ? g.newHosts : [] });
    } catch (err) {
      res.status(err.status || 503).json({ ok: false, message: err.message });
    }
  });

  app.use('/api/nginx-migration', router);
}

module.exports = { initNginxMigration, buildExtraVars, validateRequest, _CONFIG_NAME: CONFIG_NAME };
