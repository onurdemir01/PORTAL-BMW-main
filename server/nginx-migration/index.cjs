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
// SILME (kullanici, 2026-09-14): eski GBRVP* sunucusundaki location + (referanssiz kaldiysa)
// upstream blogunu kaldirir. Yeni playbook YOK: mevcut nginx_ops (action=delete, env=prod)
// akisi kullanilir - o akis prod'da ANINDA silmez, dogrular ve AWX'te 23:00 icin
// zamanlar; gercek silmeyi nginx_scheduled_ops yapar (location + kullanilmayan upstream,
// nginx -t dusunce geri alma, Teams). Bu yuzden Portal'da ayri bir template id
// (deleteTemplateId = nginx_ops template'i) tutulur.
//
// ANTI-TAMPER: istemcinin gonderdigi (group, namespace, application, service, inputPath)
// dordulusu, Portal'in KENDI tasima gorunumunde (loadMigration) gercekten bir satir mi?
// Aksi halde istemci istedigi uygulama/yol icin tanim yazdirabilirdi. Ayrica satir
// "hazir" ya da "kismi" degilse (uygulama dizini hicbir yeni sunucuda yoksa) playbook
// zaten spa_facts'te durur; burada da acik mesajla reddedilir - job bosuna kosmasin.
'use strict';

const express = require('express');

const CONFIG_NAME = 'nginx-prod-migration';

// Gecis takibi (nginx_migration_tracking): uygulama basina durum + tarihler + not.
const TRACK_STATES = ['none', 'planned', 'migrated', 'cancelled'];

/** Istemciden gelen takip kaydini dogrular/normalize eder (saf, test edilebilir). */
function normalizeTracking(body) {
  const group = String(body?.group || '').trim();
  const namespace = String(body?.namespace || '').trim().toLowerCase();
  const application = String(body?.application || '').trim().toLowerCase();
  const state = String(body?.state || 'none').trim().toLowerCase();
  const date = (v) => {
    const t = String(v || '').trim();
    if (!t) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new Error(`Tarih YYYY-AA-GG olmali: ${t}`);
    return t;
  };
  if (!group || !namespace || !application) throw new Error('group, namespace, application zorunlu.');
  if (!TRACK_STATES.includes(state)) throw new Error(`Gecersiz durum: ${state}`);
  const plannedDate = date(body?.plannedDate);
  const migratedDate = date(body?.migratedDate);
  if (state === 'migrated' && !migratedDate) throw new Error('"Gecti" icin gecis tarihi zorunlu.');
  if (state === 'planned' && !plannedDate) throw new Error('"Planlandi" icin planlanan tarih zorunlu.');
  return {
    group, namespace, application, state, plannedDate, migratedDate,
    note: String(body?.note || '').trim().slice(0, 500) || null,
  };
}

function rowToTracking(r) {
  const d = (v) => (v ? String(v instanceof Date ? v.toISOString().slice(0, 10) : v).slice(0, 10) : null);
  return {
    group: r.group_id,
    namespace: r.namespace,
    application: r.application,
    state: r.state || 'none',
    plannedDate: d(r.planned_date),
    migratedDate: d(r.migrated_date),
    note: r.note || null,
    configJobId: r.config_job_id == null ? null : Number(r.config_job_id),
    configCreatedAt: r.config_created_at ? new Date(r.config_created_at).toISOString() : null,
    configCreatedBy: r.config_created_by || null,
    deleteJobId: r.delete_job_id == null ? null : Number(r.delete_job_id),
    deleteRequestedAt: r.delete_requested_at ? new Date(r.delete_requested_at).toISOString() : null,
    deleteRequestedBy: r.delete_requested_by || null,
    updatedBy: r.updated_by || null,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  };
}

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

/** nginx_ops (action=delete, env=prod) extra_vars - saf, test edilebilir. */
function buildDeleteExtraVars({ service, inputPath, user }) {
  return {
    action: 'delete',
    env: 'prod',
    service: String(service || '').trim().toUpperCase(),
    input_path: String(inputPath || '').trim(),
    email: (user && user.email) || '',
    requester_name: (user && (user.displayName || user.username)) || '',
    requester_email: (user && user.email) || '',
  };
}

/**
 * Istegi tasima gorunumune karsi dogrular.
 * @returns {{ok:true, app:Object, path:Object} | {ok:false, status:number, message:string}}
 */
function validateRequest(groups, { group, namespace, application, service, inputPath }, { ignoreStatus = false } = {}) {
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
  if (ignoreStatus) return { ok: true, app: row, path: p };
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
      return {
        awxServerId: Number(cfg.awxServerId) || 0,
        templateId: Number(cfg.templateId) || 0,
        deleteTemplateId: Number(cfg.deleteTemplateId) || 0,
      };
    } catch {
      return { awxServerId: 0, templateId: 0, deleteTemplateId: 0 };
    }
  }

  // -- Gecis takibi --------------------------------------------------------------
  router.get('/tracking', async (_req, res) => {
    try {
      const { rows } = await db.query(
        `SELECT group_id, namespace, application, state, planned_date, migrated_date, note,
                config_job_id, config_created_at, config_created_by,
                delete_job_id, delete_requested_at, delete_requested_by, updated_by, updated_at
           FROM nginx_migration_tracking`,
      );
      res.json({ ok: true, rows: rows.map(rowToTracking) });
    } catch (err) {
      res.status(503).json({ ok: false, message: err.message });
    }
  });

  // Kayit: giris yapmis her kullanici (ekip takip eder); kim/ne zaman yazildi tutulur.
  router.put('/tracking', async (req, res) => {
    let t;
    try {
      t = normalizeTracking(req.body);
    } catch (err) {
      return res.status(400).json({ ok: false, message: err.message });
    }
    const user = getRequestUser(req) || {};
    const by = user.username || null;
    try {
      const ex = await db.query(
        `SELECT id FROM nginx_migration_tracking WHERE group_id = $1 AND namespace = $2 AND application = $3`,
        [t.group, t.namespace, t.application],
      );
      if (ex.rows.length) {
        await db.query(
          `UPDATE nginx_migration_tracking
              SET state = $4, planned_date = $5, migrated_date = $6, note = $7, updated_by = $8, updated_at = GETUTCDATE()
            WHERE group_id = $1 AND namespace = $2 AND application = $3`,
          [t.group, t.namespace, t.application, t.state, t.plannedDate, t.migratedDate, t.note, by],
        );
      } else {
        await db.query(
          `INSERT INTO nginx_migration_tracking (group_id, namespace, application, state, planned_date, migrated_date, note, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [t.group, t.namespace, t.application, t.state, t.plannedDate, t.migratedDate, t.note, by],
        );
      }
      try {
        require('../audit/index.cjs').auditPortal(req, 'nginx_prod_migration_track', {
          username: by, result: 'ok', detail: JSON.stringify(t),
        });
      } catch { /* audit yoksa yoksay */ }
      const r = await db.query(
        `SELECT group_id, namespace, application, state, planned_date, migrated_date, note,
                config_job_id, config_created_at, config_created_by,
                delete_job_id, delete_requested_at, delete_requested_by, updated_by, updated_at
           FROM nginx_migration_tracking WHERE group_id = $1 AND namespace = $2 AND application = $3`,
        [t.group, t.namespace, t.application],
      );
      res.json({ ok: true, row: r.rows[0] ? rowToTracking(r.rows[0]) : null });
    } catch (err) {
      res.status(503).json({ ok: false, message: err.message });
    }
  });

  router.get('/config', async (_req, res) => {
    res.json({ ok: true, config: await readConfig() });
  });

  router.put('/config', requireAdmin, async (req, res) => {
    const awxServerId = Number(req.body?.awxServerId) || 0;
    const templateId = Number(req.body?.templateId) || 0;
    const deleteTemplateId = Number(req.body?.deleteTemplateId) || 0; // istege bagli: nginx_ops
    if (awxServerId <= 0 || templateId <= 0) {
      return res.status(400).json({ ok: false, message: 'AWX sunucusu ve template ID zorunlu.' });
    }
    const data = JSON.stringify({ awxServerId, templateId, deleteTemplateId });
    try {
      const ex = await db.query(`SELECT 1 FROM portal_config_blobs WHERE name = $1`, [CONFIG_NAME]);
      if (ex.rows.length) {
        await db.query(`UPDATE portal_config_blobs SET data = $2 WHERE name = $1`, [CONFIG_NAME, data]);
      } else {
        await db.query(`INSERT INTO portal_config_blobs (name, data) VALUES ($1, $2)`, [CONFIG_NAME, data]);
      }
      res.json({ ok: true, config: { awxServerId, templateId, deleteTemplateId } });
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
      // Takip kaydina "tanim olusturuldu" damgasi: kayit yoksa olusturulur (durum 'none'
      // kalir - gecis KARARI kullanicinin), varsa yalniz config_* alanlari guncellenir.
      try {
        const gid = String(req.body?.group || '');
        const jobId = job && job.id != null ? Number(job.id) : null;
        const ex = await db.query(
          `SELECT id FROM nginx_migration_tracking WHERE group_id = $1 AND namespace = $2 AND application = $3`,
          [gid, v.app.namespace, v.app.application],
        );
        if (ex.rows.length) {
          await db.query(
            `UPDATE nginx_migration_tracking SET config_job_id = $4, config_created_at = GETUTCDATE(), config_created_by = $5
              WHERE group_id = $1 AND namespace = $2 AND application = $3`,
            [gid, v.app.namespace, v.app.application, jobId, user.username || null],
          );
        } else {
          await db.query(
            `INSERT INTO nginx_migration_tracking (group_id, namespace, application, state, config_job_id, config_created_at, config_created_by, updated_by)
             VALUES ($1, $2, $3, 'none', $4, GETUTCDATE(), $5, $5)`,
            [gid, v.app.namespace, v.app.application, jobId, user.username || null],
          );
        }
      } catch (e) {
        console.warn('[nginx-migration] takip damgasi yazilamadi:', e.message);
      }
      const g = view.groups.find((x) => x.id === String(req.body?.group || ''));
      res.json({ ok: true, job, extraVars: extra, targetHosts: g ? g.newHosts : [] });
    } catch (err) {
      res.status(err.status || 503).json({ ok: false, message: err.message });
    }
  });

  // -- Eylem: eski sunucudaki location (+ upstream) tanimini kaldir (23:00'e zamanlanir) --
  router.post('/delete', async (req, res) => {
    const cfg = await readConfig();
    if (!cfg.awxServerId || !cfg.deleteTemplateId) {
      return res.status(409).json({
        ok: false,
        message:
          'Silme job\'ı henüz yapılandırılmamış. nginx_ops (Nginx Reverse Proxy Operations) template ' +
          'ID\'si bu sayfadaki yönetici panelinde "Silme job\'ı" alanına girilmeli.',
      });
    }
    try {
      const { query, sql } = require('../inventory/mssql.cjs');
      const { loadMigration } = require('../audit/nginx-migration.cjs');
      const view = await loadMigration({ query, sql, hasProxyColumns: null });
      // Silmede satirin yeni sunucudaki hazirligi ONEMSIZ (eski sunucudan kaldiriyoruz);
      // yalnizca (grup, ns, app, servis, location) gercekten tasima listesinde mi.
      const v = validateRequest(view.groups, req.body || {}, { ignoreStatus: true });
      if (!v.ok) return res.status(v.status).json({ ok: false, message: v.message });

      const { launchJobOnServer } = require('../ansible/runner.cjs');
      const user = getRequestUser(req) || {};
      const extra = buildDeleteExtraVars({ service: v.path.service, inputPath: v.path.location, user });
      const job = await launchJobOnServer(cfg.awxServerId, cfg.deleteTemplateId, extra, '', user.username || null);
      try {
        require('../audit/index.cjs').auditPortal(req, 'nginx_prod_migration_delete', {
          username: user.username, result: 'ok',
          detail: JSON.stringify({ ...extra, jobId: job?.id || null, group: req.body?.group, namespace: v.app.namespace, application: v.app.application }),
        });
      } catch { /* audit yoksa yoksay */ }
      try {
        const gid = String(req.body?.group || '');
        const jobId = job && job.id != null ? Number(job.id) : null;
        const ex = await db.query(
          `SELECT id FROM nginx_migration_tracking WHERE group_id = $1 AND namespace = $2 AND application = $3`,
          [gid, v.app.namespace, v.app.application],
        );
        if (ex.rows.length) {
          await db.query(
            `UPDATE nginx_migration_tracking SET delete_job_id = $4, delete_requested_at = GETUTCDATE(), delete_requested_by = $5
              WHERE group_id = $1 AND namespace = $2 AND application = $3`,
            [gid, v.app.namespace, v.app.application, jobId, user.username || null],
          );
        } else {
          await db.query(
            `INSERT INTO nginx_migration_tracking (group_id, namespace, application, state, delete_job_id, delete_requested_at, delete_requested_by, updated_by)
             VALUES ($1, $2, $3, 'none', $4, GETUTCDATE(), $5, $5)`,
            [gid, v.app.namespace, v.app.application, jobId, user.username || null],
          );
        }
      } catch (e) {
        console.warn('[nginx-migration] silme damgasi yazilamadi:', e.message);
      }
      const g = view.groups.find((x) => x.id === String(req.body?.group || ''));
      res.json({ ok: true, job, extraVars: extra, oldHosts: g ? g.oldHosts : [], scheduled: true });
    } catch (err) {
      res.status(err.status || 503).json({ ok: false, message: err.message });
    }
  });

  app.use('/api/nginx-migration', router);
}

module.exports = { initNginxMigration, buildExtraVars, buildDeleteExtraVars, validateRequest, normalizeTracking, rowToTracking, TRACK_STATES, _CONFIG_NAME: CONFIG_NAME };
