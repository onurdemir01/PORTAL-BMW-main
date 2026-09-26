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
    configJobStatus: r.config_job_status || null,
    configJobFinishedAt: r.config_job_finished_at ? new Date(r.config_job_finished_at).toISOString() : null,
    configService: r.config_service || null,
    configLocation: r.config_location || null,
    deleteJobId: r.delete_job_id == null ? null : Number(r.delete_job_id),
    deleteRequestedAt: r.delete_requested_at ? new Date(r.delete_requested_at).toISOString() : null,
    deleteRequestedBy: r.delete_requested_by || null,
    deleteJobStatus: r.delete_job_status || null,
    updatedBy: r.updated_by || null,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  };
}

/**
 * "Tanim zaten olusturuldu mu?" - dugmeyi pasife cekme kurali (2026-09-23, kullanici).
 *
 * IKI KANIT BIRDEN aranir:
 *   1) o yol icin tanim job'i BASARIYLA bitti (`status === 'successful'`)
 *   2) BIR SONRAKI TARAMA donusunde tanim gercekten gorundu (`newStatus === 'defined'`,
 *      yani nginx_config_audit o location'i yeni sunuculariN TAMAMINDA buldu)
 *
 * Neden ikisi birden: yalniz job'a bakmak yanlis olurdu (job basarili bitip de dosya
 * beklenen yere yazilmamis olabilir; ornegin yanlis servis/vhost). Yalniz taramaya bakmak
 * da yetmez - tanim elle de yazilmis olabilir ve kullanici "biz mi yaptik" diye bilemez.
 * Kullanicinin istegi acikti: "ancak ve ancak job basarili bittiyse VE bir sonraki
 * veritabani dongusunde tanimin gercekten yapildigini goruyorsan".
 *
 * @param {{status?: string|null}|null} pathJob  o yol icin tanim job kaydi
 * @param {string|null} newStatus                taramanin yeni sunuculardaki durumu
 */
function isDefinitionConfirmed(pathJob, newStatus) {
  const jobOk = !!pathJob && String(pathJob.status || '').toLowerCase() === 'successful';
  return jobOk && String(newStatus || '') === 'defined';
}

/** Playbook'a giden extra_vars - saf, test edilebilir. */
// OCP cluster'i ENVANTERDEN cozulur, TAHMIN EDILMEZ (2026-09-26). Playbook'un cekme
// play'i `name == ocp_cluster` ile suzulur; yanlis/bos bir deger verirsek HICBIR jump
// server kosmaz ve is "paket gelmemis" halde yesil biter. Bu yuzden cluster bulunamazsa
// paket cekmeyi hic BASLATMIYORUZ (playbook'taki assert ikinci kapi).
async function resolveCluster(namespace, application) {
  const { query, sql } = require('../inventory/mssql.cjs');
  const r = await query(
    `SELECT DISTINCT cluster FROM dbo.Openshift_Inventory
      WHERE namespace = @ns AND application = @app AND cluster IS NOT NULL AND LTRIM(RTRIM(cluster)) <> ''`,
    [
      { name: 'ns', type: sql.NVarChar(256), value: String(namespace || '').trim() },
      { name: 'app', type: sql.NVarChar(256), value: String(application || '').trim() },
    ],
  );
  const rows = (r.recordset || []).map((x) => String(x.cluster || '').trim()).filter(Boolean);
  // Ayni uygulama birden fazla cluster'da olabilir; hangisinden cekecegimizi TAHMIN
  // ETMEYIZ - belirsizligi cagirana soyleriz.
  return { clusters: rows, cluster: rows.length === 1 ? rows[0] : null };
}

function buildExtraVars({ service, application, namespace, inputPath, user, fetchPackage, ocpCluster, podWebroot }) {
  return {
    service: String(service || '').trim().toUpperCase(),
    application: String(application || '').trim(),
    namespace: String(namespace || '').trim(),
    input_path: String(inputPath || '').trim(),
    // AKIS SABITLERI ACIKCA GONDERILIR (job 3343114, 2026-09-23).
    //
    // Eskiden bunlar gonderilmiyordu: "playbook zaten sabitliyor" deniyordu. Ama playbook'un
    // GIRDI DOGRULAMA play'inde (hosts: localhost) bu degiskenlerin play vars'i YOKTUR ve
    // AWX, template survey'inde tanimli bir alanin VARSAYILANINI is baslarken extra_vars'a
    // koyar. Survey'de env/action/app_type kalmissa (bu template nginx_ops'tan turetilmisti)
    // is "env prod degil" diyerek daha ilk gorevde dusuyordu - uretimde tam olarak bu oldu.
    //
    // Acikca gonderilen deger, survey varsayilanini da play vars'i da EZER; playbook'un
    // kapisi (assert) yine yerinde durur ve yanlis bir akisi engellemeye devam eder.
    env: 'prod',
    action: 'create',
    app_type: 'spa',
    migration_mode: true,
    requester_name: (user && (user.displayName || user.username)) || '',
    requester_email: (user && user.email) || '',
    // Paket cekme ISTEGE BAGLI: alanlar her zaman gonderilir ki survey varsayilani
    // sessizce devreye girip beklenmedik bir cekme baslatmasin.
    fetch_package: !!fetchPackage,
    ocp_cluster: fetchPackage ? String(ocpCluster || '').trim() : '',
    pod_webroot: fetchPackage ? String(podWebroot || '').trim() : '',
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
function validateRequest(groups, { group, namespace, application, service, inputPath, force = false }, { ignoreStatus = false, allowMissing = false } = {}) {
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
  // "DEPLOY EDILMEMIS" ENGELI, PAKET GETIRME ISTENDIGINDE GECERSIZDIR (2026-09-26).
  //
  // Bu kapi, uygulama dizini olmadan tanim isinin duracagi icin konmustu. Paketi
  // OpenShift'ten getirme ozelligi TAM OLARAK bu durumu cozuyor: is once paketi
  // pod'dan cekip /hysdeploy + /usr/nginx/applications altina aciyor, SONRA tanimi
  // olusturuyor. Kapiyi burada da uygulamak, ozelligin hedefledigi tek senaryoyu
  // bastan reddetmek olurdu - kullanici dugmeye basar, "once deploy gerekli" cevabini
  // alir ve dugmenin ne ise yaradigini anlamaz.
  if (row.status === 'missing' && !allowMissing) {
    return {
      ok: false,
      status: 409,
      message: `${app} taranan hiçbir yeni sunucuda deploy edilmemiş (/usr/nginx/applications/${ns}/${app}). `
        + 'Playbook dizin yoksa durur; önce deploy gerekli — ya da "Paketi getir + tanımla" ile '
        + "paketi OpenShift'teki çalışan pod'dan getirin.",
    };
  }
  // ZATEN TANIMLI YOLA TEKRAR TANIM ACMA (2026-09-26, kullanici: "tanimli uygulamalarda
  // 'Tanim olustur' butonu aktif, engeller misin").
  //
  // KANIT TARAMADIR, job kaydi DEGIL: tanim elle ya da baska bir akisla acilmis olabilir
  // (Glomo'da yeni tanimlar hala eski yoldan geliyor). Job kaydi arayan eski kural, boyle
  // satirlari "tanimsiz" sayip ustune bir kez daha yaziyordu.
  if (!force && p.newStatus === 'defined') {
    return {
      ok: false,
      status: 409,
      message: `${svc} ${loc} yeni sunucuların tamamında ZATEN TANIMLI (son tarama). Yeniden oluşturmak istiyorsanız force ile gönderin.`,
    };
  }
  return { ok: true, app: row, path: p };
}

/** launchJobOnServer -> istemci/DB sekli. Ayni sekil OpsX/SS ile: { id, status }. */
function jobShape(launched, awxServerId) {
  const id = launched && launched.jobId != null ? Number(launched.jobId) : null;
  return { id, status: (launched && launched.status) || 'pending', awxServerId };
}

const JOB_TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
const JOB_LIVE = new Set(['pending', 'waiting', 'running', 'new']);

/** ansible_job_history kaydi (best-effort): Ansible sekmesindeki gecmis + job-status IDOR bekcisi. */
async function recordJobHistory(awxServerId, templateId, templateName, job, extra, user) {
  if (job.id == null) return;
  try {
    const db = require('../db/index.cjs');
    await db.query(
      `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user.username || 'unknown', awxServerId, templateId, templateName, job.id, job.status || 'pending', JSON.stringify(extra)],
    );
  } catch (e) {
    console.warn('[nginx-migration] job gecmisi kaydedilemedi:', e.message);
  }
}

/**
 * Job'in AWX durumunu takip tablosuna isler (config_job_id / delete_job_id eslesen satirlar).
 * Terminal olunca bitis zamani da yazilir. Ekran bunu okur: "tanim olusturuldu" / "job hatali".
 */
async function syncJobStatusToTracking(db, jobId, status) {
  if (!jobId || !status) return;
  const fin = JOB_TERMINAL.has(status);
  try {
    // Yol basina kayit da ayni anda guncellenir: dugmenin pasif olmasi bu satira bakar.
    await db.query(
      `UPDATE nginx_migration_path_jobs SET status = $2${fin ? ', finished_at = COALESCE(finished_at, GETUTCDATE())' : ''}
        WHERE job_id = $1 AND (status IS NULL OR status <> $2)`,
      [jobId, status],
    ).catch(() => {});
    await db.query(
      `UPDATE nginx_migration_tracking SET config_job_status = $2${fin ? ', config_job_finished_at = COALESCE(config_job_finished_at, GETUTCDATE())' : ''}
        WHERE config_job_id = $1 AND (config_job_status IS NULL OR config_job_status <> $2)`,
      [jobId, status],
    );
    await db.query(
      `UPDATE nginx_migration_tracking SET delete_job_status = $2
        WHERE delete_job_id = $1 AND (delete_job_status IS NULL OR delete_job_status <> $2)`,
      [jobId, status],
    );
  } catch (e) {
    console.warn('[nginx-migration] job durumu takibe yazilamadi:', e.message);
  }
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

  // -- Job izleme (2026-09-18): "Tanim olustur"a basinca pencere acilir, AWX'e gitmeden
  // canli stdout gorunur. Terminal durum takip tablosuna da islenir (ekran yansimasi).
  router.get('/job-status/:jobId', async (req, res) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId <= 0) return res.status(400).json({ ok: false, message: 'Geçersiz iş numarası.' });
    const cfg = await readConfig();
    if (!cfg.awxServerId) return res.status(409).json({ ok: false, message: 'Taşıma job\'ı yapılandırılmamış.' });
    try {
      const runner = require('../ansible/runner.cjs');
      const [statusInfo, outputInfo] = await Promise.all([
        runner.getJobStatusOnServer(cfg.awxServerId, jobId),
        runner.getJobOutputOnServer(cfg.awxServerId, jobId),
      ]);
      await syncJobStatusToTracking(db, jobId, statusInfo.status);
      res.json({ ok: true, status: statusInfo.status, output: outputInfo.output || '', finished: statusInfo.finished, failed: statusInfo.failed });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // -- Gecis takibi --------------------------------------------------------------
  router.get('/tracking', async (_req, res) => {
    try {
      // UZLASTIRMA: pencere kapatilmis / tarayici kapanmis olsa da son 3 gunun "canli" gorunen
      // job'lari AWX'ten sorulur, terminal olanlar tabloya islenir (en fazla 10 satir, paralel).
      try {
        const live = await db.query(
          `SELECT TOP 10 config_job_id AS job_id FROM nginx_migration_tracking
            WHERE config_job_id IS NOT NULL AND (config_job_status IS NULL OR config_job_status IN ('pending','waiting','running','new'))
              AND config_created_at > DATEADD(day, -3, GETUTCDATE())
           UNION
           SELECT TOP 10 delete_job_id FROM nginx_migration_tracking
            WHERE delete_job_id IS NOT NULL AND (delete_job_status IS NULL OR delete_job_status IN ('pending','waiting','running','new'))
              AND delete_requested_at > DATEADD(day, -3, GETUTCDATE())`,
        );
        const cfg = live.rows.length ? await readConfig() : null;
        if (cfg && cfg.awxServerId) {
          const runner = require('../ansible/runner.cjs');
          await Promise.allSettled(
            live.rows.map(async (r) => {
              const st = await runner.getJobStatusOnServer(cfg.awxServerId, Number(r.job_id));
              await syncJobStatusToTracking(db, Number(r.job_id), st.status);
            }),
          );
        }
      } catch (e) {
        console.warn('[nginx-migration] job uzlastirma atlandi:', e.message);
      }
      const { rows } = await db.query(
        `SELECT group_id, namespace, application, state, planned_date, migrated_date, note,
                config_job_id, config_created_at, config_created_by,
                config_job_status, config_job_finished_at, config_service, config_location,
                delete_job_id, delete_requested_at, delete_requested_by, delete_job_status, updated_by, updated_at
           FROM nginx_migration_tracking`,
      );
      // Yol basina tanim job'lari: ekran "tanim zaten olusturuldu" kararini bunlardan verir.
      let pathJobs = [];
      try {
        const pj = await db.query(
          `SELECT group_id, namespace, application, service, location, job_id, status, created_at, created_by, finished_at
             FROM nginx_migration_path_jobs`,
        );
        pathJobs = (pj.rows || []).map((r) => ({
          group: r.group_id,
          namespace: r.namespace,
          application: r.application,
          service: r.service,
          location: r.location,
          jobId: r.job_id == null ? null : Number(r.job_id),
          status: r.status || null,
          createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
          createdBy: r.created_by || null,
          finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
        }));
      } catch (e) {
        console.warn('[nginx-migration] yol bazli job kayitlari okunamadi:', e.message);
      }
      res.json({ ok: true, rows: rows.map(rowToTracking), pathJobs });
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
                config_job_status, config_job_finished_at, config_service, config_location,
                delete_job_id, delete_requested_at, delete_requested_by, delete_job_status, updated_by, updated_at
           FROM nginx_migration_tracking WHERE group_id = $1 AND namespace = $2 AND application = $3`,
        [t.group, t.namespace, t.application],
      );
      res.json({ ok: true, row: r.rows[0] ? rowToTracking(r.rows[0]) : null });
    } catch (err) {
      res.status(503).json({ ok: false, message: err.message });
    }
  });

  // TOPLU TAKIP (kullanici, 2026-09-24): "toplu uygulama secip gecis tarihi ve planlama
  // tarihi girebilmek istiyorum". Tek tek kaydetmek yerine ayni durum/tarih/not N uygulamaya
  // yazilir. Tek tek PUT atmak da mumkundu; tek ucta toplamanin sebebi: N istegin yarisinda
  // tarayici kapanirsa kayitlarin yarisi eski yarisi yeni kalirdi ve kullanici hangisinin
  // yazildigini bilemezdi. Burada her ogenin sonucu AYRI donuyor (yazilan / hata), ekran da
  // ne olduğunu satir satir gosteriyor.
  // TARAMA TAZELEME (kullanici, 2026-09-24): "yeni gelen uygulamalar tasimalarda direkt
  // gozuksun ki tasinip tasinmadigini anlayabileyim". Ekran verisi nginx_config_audit
  // taramasindan gelir ve o is gunde bir kosar; yeni tanim ertesi gune kadar gorunmezdi.
  // Artik ayni is target_hosts ile ANINDA kosturulabiliyor - veri yine TEK kaynaktan
  // (taramadan) gelir, Portal kendi "beklemede" kaydini uydurmaz.
  const AUDIT_KEY = 'nginx_config_audit';
  const HOSTS_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,62}$/;

  async function launchAudit(hosts, user, label) {
    const { templateId, serverId } = await resolveByKey(AUDIT_KEY);
    if (!templateId) {
      const e = new Error(`AWX job template'i tanımlı değil: Admin › Playbook Kayıtları › "${AUDIT_KEY}" satırına Template ID girilmeli.`);
      e.status = 501;
      throw e;
    }
    const clean = (hosts || []).map((h) => String(h).trim().toUpperCase()).filter((h) => HOSTS_RE.test(h));
    const extraVars = clean.length ? { target_hosts: clean.join(',') } : {};
    await require('../ansible/template-preflight.cjs').assertTemplateAcceptsExtraVars(serverId, templateId, extraVars, { label: AUDIT_KEY });
    const result = await require('../ansible/runner.cjs').launchJobOnServer(serverId, templateId, extraVars, '', user || {});
    try {
      await db.query(
        `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [(user && user.username) || 'portal', serverId, templateId, `Nginx tarama: ${label || (clean.length ? clean.join(',') : 'tüm filo')}`, result?.jobId, result?.status || 'pending', JSON.stringify(extraVars)],
      );
    } catch (e) { console.warn('[nginx-migration] tarama job gecmisi yazilamadi:', e.message); }
    return { jobId: result?.jobId ?? null, status: result?.status ?? null, awxServerId: serverId, hosts: clean };
  }

  router.post('/rescan', async (req, res) => {
    try {
      const hosts = Array.isArray(req.body?.hosts) ? req.body.hosts : [];
      const out = await launchAudit(hosts, getRequestUser(req), req.body?.label);
      res.json({ ok: true, ...out });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  const BULK_MAX = 200;
  router.put('/tracking/bulk', async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ ok: false, message: 'En az bir uygulama seçilmeli.' });
    if (items.length > BULK_MAX) {
      return res.status(400).json({ ok: false, message: `Tek seferde en fazla ${BULK_MAX} uygulama güncellenebilir (seçilen: ${items.length}).` });
    }
    const user = getRequestUser(req) || {};
    const by = user.username || null;

    // Once TUMUNU dogrula: bir ogede hata varsa HICBIRI yazilmaz. Yarim uygulanan toplu
    // islem, kullanicinin "hangileri gecti?" diye tek tek bakmasi demektir.
    const norm = [];
    for (const raw of items) {
      try {
        norm.push(normalizeTracking({ ...req.body, ...raw }));
      } catch (err) {
        return res.status(400).json({
          ok: false,
          message: `${raw?.application || '(uygulama?)'} · ${raw?.namespace || '?'}: ${err.message}`,
        });
      }
    }

    const written = [];
    const failed = [];
    for (const it of norm) {
      try {
        const ex = await db.query(
          `SELECT id FROM nginx_migration_tracking WHERE group_id = $1 AND namespace = $2 AND application = $3`,
          [it.group, it.namespace, it.application],
        );
        if (ex.rows.length) {
          await db.query(
            `UPDATE nginx_migration_tracking
                SET state = $4, planned_date = $5, migrated_date = $6, note = $7, updated_by = $8, updated_at = GETUTCDATE()
              WHERE group_id = $1 AND namespace = $2 AND application = $3`,
            [it.group, it.namespace, it.application, it.state, it.plannedDate, it.migratedDate, it.note, by],
          );
        } else {
          await db.query(
            `INSERT INTO nginx_migration_tracking (group_id, namespace, application, state, planned_date, migrated_date, note, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [it.group, it.namespace, it.application, it.state, it.plannedDate, it.migratedDate, it.note, by],
          );
        }
        written.push(it);
      } catch (err) {
        failed.push({ namespace: it.namespace, application: it.application, message: err.message });
      }
    }

    try {
      require('../audit/index.cjs').auditPortal(req, 'nginx_prod_migration_track_bulk', {
        username: by,
        result: failed.length ? 'partial' : 'ok',
        detail: JSON.stringify({
          count: norm.length, written: written.length, failed: failed.length,
          state: norm[0]?.state, plannedDate: norm[0]?.plannedDate, migratedDate: norm[0]?.migratedDate,
          apps: written.map((x) => `${x.namespace}/${x.application}`).slice(0, 50),
        }),
      });
    } catch { /* audit yoksa yoksay */ }

    let rows = [];
    try {
      const r = await db.query(
        `SELECT group_id, namespace, application, state, planned_date, migrated_date, note,
                config_job_id, config_created_at, config_created_by,
                config_job_status, config_job_finished_at, config_service, config_location,
                delete_job_id, delete_requested_at, delete_requested_by, delete_job_status, updated_by, updated_at
           FROM nginx_migration_tracking`,
      );
      const key = new Set(written.map((x) => `${x.group}|${x.namespace}|${x.application}`));
      rows = (r.rows || []).map(rowToTracking).filter((x) => key.has(`${x.group}|${x.namespace}|${x.application}`));
    } catch (err) {
      return res.json({ ok: true, written: written.length, failed, rows: [], message: `Kaydedildi ama liste okunamadı: ${err.message}` });
    }
    res.json({ ok: failed.length === 0, written: written.length, failed, rows });
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
      // Paket getirme isteniyorsa "deploy edilmemis" kapisi ACILIR: isin kendisi paketi
      // getirecek. Diger kapilar (taranmadi / zaten tanimli) yerinde kalir.
      const fetchPackage = req.body?.fetchPackage === true;
      const v = validateRequest(view.groups, req.body || {}, { allowMissing: fetchPackage });
      if (!v.ok) return res.status(v.status).json({ ok: false, message: v.message });

      // TANIM ZATEN OLUSTURULDUYSA YENIDEN TETIKLENMEZ (2026-09-23, kullanici).
      // Ekran dugmeyi pasife ceker; burasi ikinci kapidir - bayat bir sekme ya da dogrudan
      // istek de ayni kurala tabidir. Kural: job BASARILI + tarama tanimi GORDU.
      try {
        const gid = String(req.body?.group || '');
        const pj = await db.query(
          `SELECT status FROM nginx_migration_path_jobs
            WHERE group_id = $1 AND namespace = $2 AND application = $3 AND service = $4 AND location = $5`,
          [gid, v.app.namespace, v.app.application, v.path.service, v.path.location],
        );
        if (isDefinitionConfirmed((pj.rows || [])[0] || null, v.path.newStatus)) {
          return res.status(409).json({
            ok: false,
            message: `${v.path.service} ${v.path.location} tanimi zaten olusturuldu: job basariyla bitti ve tarama tanimi yeni sunucularda gordu. Yeniden olusturmaya gerek yok.`,
          });
        }
      } catch (e) {
        console.warn('[nginx-migration] tanim kontrolu atlandi:', e.message);
      }

      const { launchJobOnServer } = require('../ansible/runner.cjs');
      const user = getRequestUser(req) || {};
      let ocpCluster = '';
      if (fetchPackage) {
        let found = { clusters: [], cluster: null };
        try {
          found = await resolveCluster(v.app.namespace, v.app.application);
        } catch (e) {
          return res.status(503).json({
            ok: false,
            message: `OpenShift envanteri okunamadi, paket cekilemez: ${e.message}`,
          });
        }
        if (!found.cluster) {
          return res.status(409).json({
            ok: false,
            message: found.clusters.length
              ? `${v.app.application} birden fazla cluster'da bulundu (${found.clusters.join(', ')}). `
                + 'Hangisinden cekilecegi belirsiz - paket cekme baslatilmadi.'
              : `${v.app.application} (${v.app.namespace}) OpenShift envanterinde bulunamadi. `
                + 'Paket cekilemez; once openshift_inventory job\'i kosmali.',
          });
        }
        ocpCluster = found.cluster;
      }
      const extra = buildExtraVars({
        service: v.path.service,
        application: v.app.application,
        namespace: v.app.namespace,
        inputPath: v.path.location,
        user,
        fetchPackage,
        ocpCluster,
        podWebroot: req.body?.podWebroot,
      });
      const launched = await launchJobOnServer(cfg.awxServerId, cfg.templateId, extra, '', user.username || null);
      // launchJobOnServer { jobId, status } dondurur; onceki kod `job.id` okuyordu ve damga
      // HEP NULL kaliyordu (2026-09-18). Istemciye ayni sekil + awxServerId (izleme penceresi).
      const job = jobShape(launched, cfg.awxServerId);
      await recordJobHistory(cfg.awxServerId, cfg.templateId, (fetchPackage ? 'Nginx PROD taşıması: paket getir + tanım oluştur' : 'Nginx PROD taşıması: tanım oluştur'), job, extra, user);
      try {
        require('../audit/index.cjs').auditPortal(req, 'nginx_prod_migration_create', {
          username: user.username,
          result: 'ok',
          detail: JSON.stringify({ ...extra, jobId: job.id, group: req.body?.group }),
        });
      } catch {
        /* audit modulu yoksa yoksay */
      }
      // Takip kaydina "tanim olusturuldu" damgasi: kayit yoksa olusturulur (durum 'none'
      // kalir - gecis KARARI kullanicinin), varsa yalniz config_* alanlari guncellenir.
      try {
        const gid = String(req.body?.group || '');
        const jobId = job.id;
        const ex = await db.query(
          `SELECT id FROM nginx_migration_tracking WHERE group_id = $1 AND namespace = $2 AND application = $3`,
          [gid, v.app.namespace, v.app.application],
        );
        // Yol basina kayit: dugmenin pasif olmasi bu satira bakar (uygulama basina tek
        // satir tutan tracking, cok yollu uygulamalarda son yolu ezerdi).
        try {
          const upd = await db.query(
            `UPDATE nginx_migration_path_jobs
                SET job_id = $6, status = $7, created_at = GETUTCDATE(), created_by = $8, finished_at = NULL
              WHERE group_id = $1 AND namespace = $2 AND application = $3 AND service = $4 AND location = $5`,
            [gid, v.app.namespace, v.app.application, v.path.service, v.path.location, jobId, job.status || 'pending', user.username || null],
          );
          if (!upd.rowCount) {
            await db.query(
              `INSERT INTO nginx_migration_path_jobs (group_id, namespace, application, service, location, job_id, status, created_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [gid, v.app.namespace, v.app.application, v.path.service, v.path.location, jobId, job.status || 'pending', user.username || null],
            );
          }
        } catch (e) {
          console.warn('[nginx-migration] yol bazli job kaydi yazilamadi:', e.message);
        }
        if (ex.rows.length) {
          await db.query(
            `UPDATE nginx_migration_tracking SET config_job_id = $4, config_created_at = GETUTCDATE(), config_created_by = $5,
                    config_job_status = $6, config_job_finished_at = NULL, config_service = $7, config_location = $8
              WHERE group_id = $1 AND namespace = $2 AND application = $3`,
            [gid, v.app.namespace, v.app.application, jobId, user.username || null, job.status || 'pending', v.path.service, v.path.location],
          );
        } else {
          await db.query(
            `INSERT INTO nginx_migration_tracking (group_id, namespace, application, state, config_job_id, config_created_at, config_created_by, config_job_status, config_service, config_location, updated_by)
             VALUES ($1, $2, $3, 'none', $4, GETUTCDATE(), $5, $6, $7, $8, $5)`,
            [gid, v.app.namespace, v.app.application, jobId, user.username || null, job.status || 'pending', v.path.service, v.path.location],
          );
        }
      } catch (e) {
        console.warn('[nginx-migration] takip damgasi yazilamadi:', e.message);
      }
      const g = view.groups.find((x) => x.id === String(req.body?.group || ''));
      res.json({ ok: true, job, awxServerId: cfg.awxServerId, extraVars: extra, targetHosts: g ? g.newHosts : [], fetchPackage, ocpCluster });
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
      const launched = await launchJobOnServer(cfg.awxServerId, cfg.deleteTemplateId, extra, '', user.username || null);
      const job = jobShape(launched, cfg.awxServerId);
      await recordJobHistory(cfg.awxServerId, cfg.deleteTemplateId, 'Nginx PROD taşıması: eski tanımı kaldır', job, extra, user);
      try {
        require('../audit/index.cjs').auditPortal(req, 'nginx_prod_migration_delete', {
          username: user.username, result: 'ok',
          detail: JSON.stringify({ ...extra, jobId: job.id, group: req.body?.group, namespace: v.app.namespace, application: v.app.application }),
        });
      } catch { /* audit yoksa yoksay */ }
      try {
        const gid = String(req.body?.group || '');
        const jobId = job.id;
        const ex = await db.query(
          `SELECT id FROM nginx_migration_tracking WHERE group_id = $1 AND namespace = $2 AND application = $3`,
          [gid, v.app.namespace, v.app.application],
        );
        if (ex.rows.length) {
          await db.query(
            `UPDATE nginx_migration_tracking SET delete_job_id = $4, delete_requested_at = GETUTCDATE(), delete_requested_by = $5, delete_job_status = $6
              WHERE group_id = $1 AND namespace = $2 AND application = $3`,
            [gid, v.app.namespace, v.app.application, jobId, user.username || null, job.status || 'pending'],
          );
        } else {
          await db.query(
            `INSERT INTO nginx_migration_tracking (group_id, namespace, application, state, delete_job_id, delete_requested_at, delete_requested_by, delete_job_status, updated_by)
             VALUES ($1, $2, $3, 'none', $4, GETUTCDATE(), $5, $6, $5)`,
            [gid, v.app.namespace, v.app.application, jobId, user.username || null, job.status || 'pending'],
          );
        }
      } catch (e) {
        console.warn('[nginx-migration] silme damgasi yazilamadi:', e.message);
      }
      const g = view.groups.find((x) => x.id === String(req.body?.group || ''));
      res.json({ ok: true, job, awxServerId: cfg.awxServerId, extraVars: extra, oldHosts: g ? g.oldHosts : [], scheduled: true });
    } catch (err) {
      res.status(err.status || 503).json({ ok: false, message: err.message });
    }
  });

  app.use('/api/nginx-migration', router);
}

module.exports = {
  resolveCluster, initNginxMigration, isDefinitionConfirmed, buildExtraVars, buildDeleteExtraVars, validateRequest, normalizeTracking, rowToTracking, jobShape, syncJobStatusToTracking, JOB_TERMINAL, JOB_LIVE, TRACK_STATES, _CONFIG_NAME: CONFIG_NAME };
