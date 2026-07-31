// server/opsx/index.cjs — OpsX: Guvenli Uygulama Operasyonlari.
//
// LogX log INDIRIR; OpsX uygulama uzerinde ISLEM yapar (restart/stop/start). Ikisi de
// ayni envanteri ve ayni cluster katalogunu okur, ama OpsX'in kendi AWX job template'i
// vardir ve HICBIR dosya transferi yapmaz.
//
// HANGI AWX SUNUCUSU / TEMPLATE'I: Admin > Playbook Kayitlari ekranindan yonetilir
// (ansible_playbook_registry satirlari: opsx_legacy_operation, opsx_openshift_operation).
// LogX ile AYNI desen — template ID koda gomulu DEGIL. Registry'de template ID bos ise
// endpoint 501 doner ve kullaniciya "yonetici tanimlamali" mesaji gosterilir; sessizce
// yanlis bir job tetiklenmez.
//
// JOB'A GIDEN PARAMETRELER: Admin > OpsX Yapilandirma ekranindan duzenlenebilir
// (bkz. server/opsx/config.cjs). Varsayilan esleme:
//   application: <Uygulama Adi>
//   limit:       <Sunucu1,Sunucu2,...>   ← ayirac da yapilandirilabilir
//   operation:   restart | stop | start
// Anahtar adlari playbook'un bekledigi isimlerle degistirilebilir; ayrica her
// calistirmaya eklenecek sabit degiskenler tanimlanabilir.
'use strict';

const inventoryDb = require('../inventory/mssql.cjs');
const { getAppsTable } = require('../config/apps-table.cjs');

// Kullanicidan gelen "operation" degeri ASLA dogrudan job'a gecmez — yalniz bu
// beyaz listedeki degerlerden biri kabul edilir. Aksi halde extra_vars uzerinden
// playbook'a beklenmedik bir deger enjekte edilebilirdi.
//
// threaddump/heapdump SADECE Legacy'de anlamli (Openshift govdesinde operation
// alani zaten yok — bkz. POST /api/opsx/run yorumu); onyuz OperationStep'i de
// yalniz Legacy akisinda kullanildigi icin ayrica bir platform filtresi gerekmez.
const ALLOWED_OPERATIONS = Object.freeze({
  restart: 'Uygulamamı restart et',
  stop: 'Uygulamamı durdur',
  start: 'Uygulamamı başlat',
  threaddump: 'Thread dump al',
  heapdump: 'Heap dump al',
});

const REGISTRY_KEYS = Object.freeze({
  legacy: 'opsx_legacy_operation',
  openshift: 'opsx_openshift_operation',
});

// Legacy'ye ozel: secili sunucularda uygulamanin RUNNING/STOPPED durumunu kontrol eden
// playbook'un registry anahtari — bir "platform" degil, ayri bir is akisi oldugu icin
// REGISTRY_KEYS'in disinda tutulur.
const STATUS_CHECK_KEY = 'opsx_legacy_status_check';

// Template ID + AWX sunucusu Playbook Kayitlari'ndan cozulur. getEffectiveTemplateId()
// once satirdaki awx_template_id'ye, o bos ise satirda tanimli env degiskenine bakar
// (bkz. server/ansible/playbook-registry.cjs) — LogX'in kullandigi ayni mekanizma.
async function resolveByKey(keyName) {
  const playbookRegistry = require('../ansible/playbook-registry.cjs');
  const row = await playbookRegistry.getByKey(keyName).catch(() => null);
  if (!row || row.enabled === false) {
    return { templateId: null, serverId: null, keyName };
  }
  const templateId = playbookRegistry.getEffectiveTemplateId(row);
  // Satirda awx_server_id yoksa OPSX_AWX_SERVER_ID, o da yoksa 0 (ilk/varsayilan sunucu).
  const envServer = Number(String(process.env.OPSX_AWX_SERVER_ID || '').trim());
  const serverId = row.awxServerId != null
    ? Number(row.awxServerId)
    : (Number.isInteger(envServer) && envServer >= 0 ? envServer : 0);
  return { templateId: templateId || null, serverId, keyName };
}

async function resolveTarget(platform) {
  return resolveByKey(REGISTRY_KEYS[platform]);
}

// Secilen uygulamanin bulundugu sunucular. LogX'in resolveHostsForApp'i ile ayni
// tabloyu okur ama OpsX'in kendi ihtiyaci farkli: burada env VE jboss_version bilgisi
// de dondurulur (kullanici hangi ortamdaki/versiyondaki sunucuyu sectigini gormeli —
// ayni uygulamanin host'lari FARKLI JBoss majör surumlerinde olabiliyor).
async function hostsForApp(app) {
  const appName = String(app || '').trim();
  if (!appName) {
    throw Object.assign(new Error('Uygulama adı gerekli.'), { status: 400 });
  }
  const pool = await inventoryDb.getPool();
  if (!pool) {
    throw Object.assign(new Error('Envanter veritabanına erişilemiyor.'), { status: 503 });
  }
  const req = pool.request();
  req.input('app', appName);
  const result = await req.query(
    `SELECT DISTINCT UPPER(host) AS host, env, jboss_version FROM ${getAppsTable()} WHERE app = @app ORDER BY host`
  );
  return result.recordset
    .filter((r) => r.host)
    .map((r) => ({
      host: String(r.host).trim(),
      env: String(r.env || '').trim(),
      jbossVersion: String(r.jboss_version || '').trim(),
    }));
}

function initOpsX(app) {
  const express = require('express');

  // Paylasilan auth guard'i (LogX v2 ile ayni desen). Auth modulu yuklenemezse
  // fallback KAPALI (deny) — guvenli varsayilan.
  let requireAuth = (req, res, next) => res.status(401).json({ ok: false, message: 'Auth modülü yok.' });
  try {
    const authMod = require('../auth/index.cjs');
    if (typeof authMod.requireAuth === 'function') requireAuth = authMod.requireAuth;
  } catch { /* auth modulu yoksa deny kalir */ }

  // GET /api/opsx/apps?search= — LogX ile AYNI kaynak (uygulama envanteri + snapshot
  // fallback). Kod tekrarlamak yerine legacy modulunun searchApps'i kullanilir.
  app.get('/api/opsx/apps', requireAuth, async (req, res) => {
    try {
      const legacy = require('../logx/v2/legacy.cjs');
      const result = await legacy.searchApps(req.query.search);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // GET /api/opsx/hosts?app= — secilen uygulamanin sunuculari
  app.get('/api/opsx/hosts', requireAuth, async (req, res) => {
    try {
      const hosts = await hostsForApp(req.query.app);
      res.json({ ok: true, hosts });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // GET /api/opsx/clusters — OpenShift env/cluster agaci. LogX'in cluster katalogu
  // AYNEN kullanilir (kullanici karari: "degerler yine ayni olsun"); yalniz onyuzdeki
  // etiket "Tenant / Is Birimi" yerine "Cluster" yazar.
  app.get('/api/opsx/clusters', requireAuth, async (req, res) => {
    try {
      const adminData = require('../logx/v2/admin.cjs');
      const tree = await adminData.getClusterTree();
      res.json({ ok: true, tree });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // GET /api/opsx/operations — desteklenen islemler (onyuz bunu hardcode etmesin)
  app.get('/api/opsx/operations', requireAuth, (req, res) => {
    res.json({
      ok: true,
      operations: Object.entries(ALLOWED_OPERATIONS).map(([key, label]) => ({ key, label })),
    });
  });

  // GET /api/opsx/job-status/:serverId/:jobId — tetiklenen job'in CANLI durumu ve
  // stdout'u. Self Service'in ss/job-status'uyla AYNI iki-cagrili desen
  // (getJobStatusOnServer + getJobOutputOnServer) — ama OpsX'in KENDI endpoint'i,
  // cunku Self Service'teki cikti-filtresi ozelligi yalnizca SS kayitlarina bagli
  // (ansible_ss_customizations) ve OpsX'te anlamsiz; ayri tutmak iki ozelligi
  // birbirine bagimli kilmiyor.
  app.get('/api/opsx/job-status/:serverId/:jobId', requireAuth, async (req, res) => {
    const serverId = Number(req.params.serverId);
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(serverId) || !Number.isInteger(jobId) || jobId <= 0) {
      return res.status(400).json({ ok: false, message: 'Geçersiz sunucu/iş numarası.' });
    }

    // IDOR korumasi: job ansible_job_history'de KAYITLI ve BASKA kullaniciya aitse
    // (admin degilse) reddet — Self Service'teki ayni kontrol. Kayit yoksa/DB hatasi
    // varsa fail-open (mesru akisi bozmaz; OpsX kendi launch'inda bu satiri zaten
    // await ile yaziyor, yani normal akista kayit her zaman mevcuttur).
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

  // POST /api/opsx/status-check — Legacy'ye ozel: secili sunucularda uygulamanin CANLI
  // RUNNING/STOPPED durumunu bir Ansible playbook'u tetikleyip HIZLICA (kisa polling ile)
  // ceker. Onyuz bunu Operasyon adiminda kullanir: uygulama STOPPED ise restart/stop/
  // thread dump/heap dump, RUNNING ise "başlat" secilemez hale gelir.
  //
  // SOZLESME: playbook'un son adiminda `ansible.builtin.set_stats` ile
  //   host_status: { "<HOST>": "running" | "stopped", ... }
  // seklinde bir artifact yayinlamasi BEKLENIR — LogX v2/getJobStatusOnServer'in zaten
  // kullandigi artifacts-tabanli desenle AYNI (bkz. runner.cjs yorumu). Admin bu playbook'u
  // Playbook Kayitlari'nda "opsx_legacy_status_check" satirina template ID olarak tanimlamali.
  //
  // Durum kontrolu BASARISIZ/zaman asimina UGRARSA fail-open davranilmaz: 502 doner ve
  // onyuz TUM islemleri devre disi birakir — bir restart/stop/dump'i YANLIS bir "durum
  // bilinmiyor, serbest birak" varsayimiyla calistirmak, yanlislikla calisan bir
  // uygulamayi durdurmaktan (ya da tersi) daha tehlikelidir.
  // jboss_version icin de operation'daki gibi beyaz liste — istemciden gelen deger
  // dogrudan extra_vars'a gecmez.
  const ALLOWED_JBOSS_VERSIONS = new Set(['jboss7', 'jboss8']);

  app.post('/api/opsx/status-check', requireAuth, express.json({ limit: '64kb' }), async (req, res) => {
    const { application, hosts, jbossVersion } = req.body || {};
    if (!String(application || '').trim()) {
      return res.status(400).json({ ok: false, message: 'Uygulama adı gerekli.' });
    }
    if (!Array.isArray(hosts) || hosts.length === 0) {
      return res.status(400).json({ ok: false, message: 'En az bir sunucu seçilmeli.' });
    }

    // Anti-TOCTOU: /run ile AYNI kontrol — client'in gonderdigi host listesine guvenilmez.
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

    const { templateId, serverId, keyName } = await resolveByKey(STATUS_CHECK_KEY);
    if (!templateId) {
      return res.status(501).json({
        ok: false,
        message: `Durum kontrolü için AWX job template'i henüz tanımlanmadı. `
               + `Yönetici, Admin > Playbook Kayıtları ekranında "${keyName}" satırının `
               + `Template ID alanını doldurmalı.`,
      });
    }

    try {
      const opsxConfig = require('./config.cjs');
      const cfg = (await opsxConfig.getConfig()).legacy;
      const runner = require('../ansible/runner.cjs');
      const limitValue = requested.join(cfg.separator);
      const extraVars = { [cfg.applicationKey]: String(application).trim() };
      // Secili host'lar tek bir JBoss majorune ait ise gonderilir (karisik ise onyuz
      // hic gondermez) — playbook'un dogru jboss-cli aracini (jboss-cli.sh/jboss-cli8.sh)
      // dogrudan secmesini saglar; boylece playbook her iki surumu de korlemesine gerek
      // kalmaz.
      if (ALLOWED_JBOSS_VERSIONS.has(jbossVersion)) {
        extraVars.jboss_version = jbossVersion;
      }
      const launch = await runner.launchJobOnServer(serverId, templateId, extraVars, limitValue);

      // Kisa polling — "hizlica ceksin" istegine uygun, sinirli sure (~30sn ust sinir).
      const POLL_MS = 1000;
      const MAX_ATTEMPTS = 30;
      const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
      let statusInfo = null;
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        statusInfo = await runner.getJobStatusOnServer(serverId, launch.jobId);
        if (TERMINAL.has(statusInfo.status)) break;
        await new Promise((r) => setTimeout(r, POLL_MS));
      }

      // 'failed' de KABUL EDILIR (yalniz 'error'/'canceled'/zaman asimi reddedilir):
      // playbook bir host'ta uygulamayi BULAMAZSA o host icin `ansible.builtin.fail`
      // tetikler ve AWX genel job durumunu "failed" yapar — ama DIGER host'lar icin
      // set_stats yine calisip artifact uretmis olabilir. "failed" durumunu topyekun
      // reddetmek, bir host'taki veri hatasi yuzunden butun sunuculardaki GECERLI
      // durum bilgisini de atmak olurdu.
      if (!statusInfo || !['successful', 'failed'].includes(statusInfo.status)) {
        return res.status(502).json({
          ok: false,
          message: statusInfo
            ? `Durum kontrolü tamamlanamadı (job durumu: ${statusInfo.status}).`
            : 'Durum kontrolü zaman aşımına uğradı.',
          jobId: launch.jobId,
        });
      }

      // Artifact anahtarlari playbook'un gonderdigi buyuk/kucuk harfe gore esnek okunur.
      // Bir host icin artifact hic yoksa (o host'ta `fail` tetiklenmis olabilir) 'unknown'
      // kalir — onyuz bunu ne "running" ne "stopped" sayar, ilgili host icin islem
      // secimini yine de kilitli tutar (bkz. OperationStep.tsx).
      const hostStatus = statusInfo.artifacts?.host_status || {};
      const statuses = {};
      for (const h of requested) {
        const raw = hostStatus[h] ?? hostStatus[h.toLowerCase()] ?? hostStatus[h.toUpperCase()];
        statuses[h] = typeof raw === 'string' ? raw.trim().toLowerCase() : 'unknown';
      }

      res.json({ ok: true, statuses, jobId: launch.jobId });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // POST /api/opsx/run — islemi tetikler.
  //
  // IKI PLATFORM, IKI FARKLI GOVDE (kullanici sartnamesi):
  //
  // Legacy — sunucu listesi AWX'in KENDI `limit` alaninda, extra_vars'ta DEGIL:
  //   { "limit": "GBCJAP01,GBCJAP03",
  //     "extra_vars": { "application": "...", "operation": "restart" } }
  //
  // Openshift — `limit` YOK; her sey extra_vars icinde:
  //   { "extra_vars": { "terminal_host": "GBAOCP01",
  //                     "namespace": "...", "app_name": "...",
  //                     "ocp_clusters": [ { env, tenant, cluster_name } ] } }
  //   Birden fazla cluster secilirse TEK bir ocp_clusters ogesi uretilir ve
  //   cluster_name virgulle birlestirilir (LogX her cluster icin AYRI oge uretir —
  //   OpsX'te sartname farkli).
  app.post('/api/opsx/run', requireAuth, express.json({ limit: '256kb' }), async (req, res) => {
    const { platform, application, hosts, operation, env, tenant, clusters, namespace, appName } = req.body || {};

    const plat = platform === 'openshift' ? 'openshift' : 'legacy';

    const { templateId, serverId, keyName } = await resolveTarget(plat);
    if (!templateId) {
      return res.status(501).json({
        ok: false,
        message: `OpsX ${plat} işlemleri için AWX job template'i henüz tanımlanmadı. `
               + `Yönetici, Admin > Playbook Kayıtları ekranında "${keyName}" satırının `
               + `Template ID alanını doldurmalı.`,
      });
    }

    const opsxConfig = require('./config.cjs');
    const cfg = (await opsxConfig.getConfig())[plat];
    const { vars: staticVars, rejected: badLines } = opsxConfig.parseExtraVarLines(cfg.extraVars);
    if (badLines.length) {
      console.warn(`[OpsX] yapilandirilmis ek degiskenlerde gecersiz satir(lar) atlandi: ${badLines.join(' | ')}`);
    }

    let extraVars;
    let limitValue = '';   // yalniz Legacy'de dolu — AWX'in --limit alani
    let logSummary;

    if (plat === 'legacy') {
      if (!ALLOWED_OPERATIONS[operation]) {
        return res.status(400).json({ ok: false, message: 'Geçersiz işlem.' });
      }
      if (!String(application || '').trim()) {
        return res.status(400).json({ ok: false, message: 'Uygulama adı gerekli.' });
      }
      if (!Array.isArray(hosts) || hosts.length === 0) {
        return res.status(400).json({ ok: false, message: 'En az bir sunucu seçilmeli.' });
      }

      // ANTI-TOCTOU: client'in gonderdigi host listesine GUVENILMEZ — envanterden
      // yeniden cozulur ve yalniz gercekten bu uygulamaya ait olanlar gecer.
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

      limitValue = requested.join(cfg.separator);
      // limit BURADA extra_vars'a KONMAZ — sartname onu ust seviyede istiyor.
      extraVars = {
        ...staticVars,
        [cfg.applicationKey]: String(application).trim(),
        [cfg.operationKey]: operation,
      };
      logSummary = `app=${String(application).trim()} limit=${limitValue} op=${operation}`;

    } else {
      // ── Openshift ───────────────────────────────────────────────────────────
      const envKey = String(env || '').trim();
      const tenantKey = String(tenant || '').trim();
      const ns = String(namespace || '').trim();
      const appN = String(appName || '').trim();

      if (!ns) return res.status(400).json({ ok: false, message: 'Namespace gerekli.' });
      if (!appN) return res.status(400).json({ ok: false, message: 'Uygulama adı (app_name) gerekli.' });
      if (!Array.isArray(clusters) || clusters.length === 0) {
        return res.status(400).json({ ok: false, message: 'En az bir cluster seçilmeli.' });
      }

      // Secim katalog agacina karsi yeniden dogrulanir — client'in gonderdigine guvenilmez.
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

      // terminal_host SUNUCUDA cozulur (ocp_terminal_host_map) — kullanici girmez,
      // client gondermez. LogX de ayni haritayi kullanir.
      const terminalHost = await adminData.getTerminalHost(tenantKey, envKey);
      if (!terminalHost) {
        return res.status(400).json({
          ok: false,
          message: `"${tenantKey}/${envKey}" için terminal/bastion host tanımlı değil — `
                 + `Admin > LogX v2 Yapılandırma ekranından eklenmeli.`,
        });
      }

      extraVars = {
        ...staticVars,
        [cfg.terminalHostKey]: terminalHost,
        [cfg.namespaceKey]: ns,
        [cfg.appNameKey]: appN,
        [cfg.clustersKey]: [{
          env: envKey,
          tenant: tenantKey,
          // Sartname: coklu secimde TEK oge, cluster_name virgulle birlesik.
          cluster_name: requested.join(cfg.separator),
        }],
      };
      // Openshift govdesinde `operation` YOK (sartnamedeki ornek govdelerde gecmiyor).
      // Gerekiyorsa Admin > OpsX Yapilandirma > "Ek sabit degiskenler" ile eklenebilir.
      logSummary = `ns=${ns} app_name=${appN} clusters=${requested.join(',')} terminal=${terminalHost}`;
    }

    try {
      const runner = require('../ansible/runner.cjs');
      // launchJobOnServer(serverId, templateId, extraVars, limit) — limit bos string
      // ise payload'a HIC eklenmez (bkz. runner.cjs: `if (limit) payload.limit = limit`),
      // dolayisiyla Openshift govdesinde ust-seviye limit alani olusmaz.
      const result = await runner.launchJobOnServer(serverId, templateId, extraVars, limitValue);

      // ansible_job_history'ye kayit: Self Service'in kullandigi AYNI genel-amacli
      // tablo. Bu, iki sey saglar: (a) job-status endpoint'i IDOR korumasi icin
      // "bu job kime ait" sorusunu cevaplayabilir, (b) ilerde bir "OpsX Gecmisi"
      // ekrani gerekirse veri zaten burada. `params` alanina extraVars'i OLDUGU GIBI
      // yazariz — Self Service'teki gibi maskeleme YOK, cunku OpsX parametreleri
      // (uygulama adi, sunucu listesi, islem) hassas veri tasimiyor.
      try {
        const db = require('../db/index.cjs');
        await db.query(
          `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            req.session?.user?.username || 'unknown',
            serverId, templateId, `OpsX: ${plat}`,
            result?.jobId, result?.status || 'pending',
            JSON.stringify({ platform: plat, ...(limitValue ? { limit: limitValue } : {}), ...extraVars }),
          ]
        );
      } catch (e) {
        console.warn('[OpsX] Gecmis kaydedilemedi:', e.message);
      }

      try {
        require('../audit/index.cjs').auditPortal(req, 'opsx_operation', {
          detail: JSON.stringify({ platform: plat, limit: limitValue || undefined, extraVars, jobId: result?.jobId ?? null }),
        });
      } catch { /* denetim kaydi best-effort */ }

      console.log(`[OpsX] ${req.session?.user?.username} -> ${plat} ${logSummary} template=${templateId} server=${serverId} job=${result?.jobId ?? '?'}`);
      res.json({
        ok: true,
        jobId: result?.jobId ?? null,
        status: result?.status ?? null,
        awxServerId: serverId,
        templateId,
        // Onyuz son ekranda job'a NE gittigini aynen gosterir.
        sentBody: { ...(limitValue ? { limit: limitValue } : {}), extra_vars: extraVars },
      });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // ── ADMIN: parametre esleme yapilandirmasi ─────────────────────────────────
  let requireAdmin = (req, res, next) => res.status(403).json({ ok: false, message: 'Auth modülü yok.' });
  try {
    const authMod = require('../auth/index.cjs');
    if (typeof authMod.requireAdmin === 'function') requireAdmin = authMod.requireAdmin;
  } catch { /* deny kalir */ }

  const opsxConfig = require('./config.cjs');

  // Mevcut yapilandirma + her platformun Playbook Kayitlari'ndaki hedefi (salt-okunur
  // ozet) — admin tek ekranda "template tanimli mi" sorusunu gorebilsin.
  app.get('/api/admin/opsx/config', requireAdmin, async (req, res) => {
    try {
      const cfg = await opsxConfig.getConfig();
      const targets = {};
      for (const plat of ['legacy', 'openshift']) {
        const t = await resolveTarget(plat);
        targets[plat] = { registryKey: t.keyName, templateId: t.templateId, awxServerId: t.serverId };
      }
      const statusCheckTarget = await resolveByKey(STATUS_CHECK_KEY);
      targets.legacyStatusCheck = {
        registryKey: statusCheckTarget.keyName,
        templateId: statusCheckTarget.templateId,
        awxServerId: statusCheckTarget.serverId,
      };
      res.json({ ok: true, config: cfg, targets, defaults: opsxConfig.DEFAULTS });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  app.put('/api/admin/opsx/config', requireAdmin, express.json({ limit: '64kb' }), async (req, res) => {
    try {
      // Gecersiz ek-degisken satirlari sessizce yutulmaz — admin'e bildirilir.
      const warnings = [];
      for (const plat of ['legacy', 'openshift']) {
        const { rejected } = opsxConfig.parseExtraVarLines(req.body?.[plat]?.extraVars);
        if (rejected.length) warnings.push(`${plat}: ${rejected.join(' | ')}`);
      }
      const saved = await opsxConfig.saveConfig(req.body);
      try {
        require('../audit/index.cjs').auditPortal(req, 'opsx_config_update', {
          detail: JSON.stringify(saved),
        });
      } catch { /* best-effort */ }
      console.log(`[OpsX] ${req.session?.user?.username} -> parametre yapilandirmasi guncellendi.`);
      res.json({ ok: true, config: saved, warnings });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  console.log('[OpsX] endpoints mounted at /api/opsx + /api/admin/opsx');
}

module.exports = { initOpsX, hostsForApp, ALLOWED_OPERATIONS };
