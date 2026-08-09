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
//   Legacy    -> application: <Uygulama Adi>, limit: <Sunucu1,Sunucu2,...>, operation: restart|stop|start
//   Openshift -> env: <ortam>, oc_cluster: <tenant>, oc_input: "ns1,app1;ns2,app2"
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

// Openshift bacagindaki islem secenekleri — sunucuya HICBIR sekilde `operation` olarak
// gitmez (bkz. run() Openshift dali: extra_vars sadece env/oc_cluster/oc_input tasir).
// SADECE restart su an aktif — digerleri onyuzde gorunur ama devre disi birakilir;
// ileride gercek playbook destegi eklendiginde `enabled: true` yapilip run()'a islenir.
// Sunucu tarafinda da restart DISINDA bir key kabul EDILMEZ (defence in depth).
const OCP_OPERATIONS = Object.freeze([
  { key: 'restart', label: 'Uygulamamı restart et', enabled: true },
  { key: 'threaddump', label: 'Thread dump al', enabled: false },
  { key: 'heapdump', label: 'Heap dump al', enabled: false },
  { key: 'tcpdump', label: 'Tcpdump al', enabled: false },
]);

const REGISTRY_KEYS = Object.freeze({
  legacy: 'opsx_legacy_operation',
  openshift: 'opsx_openshift_operation',
});

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
// tabloyu okur ama OpsX'in kendi ihtiyaci farkli: burada env, jboss_version VE status
// bilgisi de dondurulur (kullanici hangi ortamdaki/versiyondaki sunucuyu sectigini
// gormeli — ayni uygulamanin host'lari FARKLI JBoss majör surumlerinde olabiliyor;
// status ise canli bir Ansible sorgusuyla DEGIL, dogrudan envanterden (MWAppsInventory.status,
// "running"/"stopped") okunur — daha once bir playbook tetikleyip polling yapan
// /api/opsx/status-check yaklasimi TERK EDILDI, cunku bu deger zaten envanterde hazir.
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
    `SELECT DISTINCT UPPER(host) AS host, env, jboss_version, status FROM ${getAppsTable()} WHERE app = @app ORDER BY host`
  );
  return result.recordset
    .filter((r) => r.host)
    .map((r) => ({
      host: String(r.host).trim(),
      env: String(r.env || '').trim(),
      jbossVersion: String(r.jboss_version || '').trim(),
      status: String(r.status || '').trim().toLowerCase(),
    }));
}

// env+tenant secimine karsilik gelen GERCEK cluster isimleri (ocp_cluster_index'ten,
// LogX'in kullandigi AYNI katalog). Gercek bmw_openshift_jobs playbook'lari `hosts:
// "{{ oc_cluster }}_{{ env }}"` ile TUM bu cluster'lari TEK grupta hedefler — bu yuzden
// OpsX artik tek tek cluster_name secmez, sadece bu isimleri namespace/app onbellegini
// (ocp-cache.cjs) sorgulamak icin kullanir.
async function resolveClusterNames(env, tenant) {
  const adminData = require('../logx/v2/admin.cjs');
  const tree = await adminData.getClusterTree();
  return tree?.[env]?.[tenant] || [];
}

// LogX v2'nin paylasimli kesif onbellegini (ocp_namespace_cache/ocp_app_cache,
// bkz. server/logx/v2/ocp-cache.cjs) okur — OpsX kendi ayri bir envanter TUTMAZ, ayni
// veriyi ayri bir tabloda ikinci kez saklamak veri sapmasina yol acardi. env/tenant'a
// ait TUM gercek cluster'lardan gelen sonuclar birlestirilir (union); namespace-bazli
// erisim kisitlamasi (logx_v2_restrictions) LogX ile AYNI kapidan (restrictions.cjs)
// uygulanir — restart TETIKLEYEN bir modulde bu kontrolu atlamak LogX'ten bile daha
// riskli olurdu.
async function namespacesForCluster(env, tenant, user) {
  const clusterNames = await resolveClusterNames(env, tenant);
  if (!clusterNames.length) return [];
  const ocpCache = require('../logx/v2/ocp-cache.cjs');
  const restrictions = require('../logx/v2/restrictions.cjs');
  const seen = new Set();
  for (const clusterName of clusterNames) {
    const out = await ocpCache.getNamespaces({ env, tenant, clusterName }).catch(() => ({ items: [] }));
    for (const ns of out.items || []) seen.add(ns);
  }
  const all = [...seen].sort();
  // filterAllowed birebir anahtar eslesmesi bekler; namespace cluster-bagimsiz secildigi
  // icin her namespace'i HER gercek cluster adiyla ayrica kontrol ederiz — bir tanesinde
  // bile acikca kisitlanmissa o namespace listeden dusurulur (fail-safe).
  const finalAllowed = [];
  for (const ns of all) {
    const keys = clusterNames.map((c) => `${tenant}/${env}/${c}/${ns}`);
    const ok = await restrictions.filterAllowed('ocp_namespace', keys, user);
    if (ok.length === keys.length) finalAllowed.push(ns);
  }
  return finalAllowed;
}

async function appsForNamespace(env, tenant, namespace, user) {
  const ns = String(namespace || '').trim();
  if (!ns) return [];
  const clusterNames = await resolveClusterNames(env, tenant);
  if (!clusterNames.length) return [];
  const ocpCache = require('../logx/v2/ocp-cache.cjs');
  const restrictions = require('../logx/v2/restrictions.cjs');
  const seen = new Set();
  for (const clusterName of clusterNames) {
    const resourceKey = `${tenant}/${env}/${clusterName}/${ns}`;
    const allowed = await restrictions.isAllowed('ocp_namespace', resourceKey, user).catch(() => false);
    if (!allowed) continue;
    const out = await ocpCache.getApps({ env, tenant, clusterName, namespace: ns }).catch(() => ({ items: [] }));
    for (const item of out.items || []) seen.add(item.name);
  }
  return [...seen].sort();
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

  // OpsX sayfasi kullaniciya kapaliysa GERCEK 403 (kozmetik degil): sayfa gizlense de
  // API'ler aciktir ve URL'i bilen biri dogrudan cagirabilirdi. LogX v2 ile ayni desen
  // (logx/v2/index.cjs). Admin route'lari ayrica requireAdmin tasir.
  try {
    const { requireVisiblePrefix } = require('../auth/visibility.cjs');
    app.use('/api/opsx', requireVisiblePrefix('OpsX'));
  } catch { /* motor yoksa yoksay */ }

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

  // GET /api/opsx/ocp/namespaces?env=&tenant= — LogX v2'nin paylasimli kesif onbellegin-
  // den (ocp_namespace_cache), secilen env/tenant'a ait TUM gercek cluster'larda GORULMUS
  // namespace'ler (kisitlananlar dusurulmus). Kullanici bunlardan secebilir ya da
  // bilmiyorsa/onbellekte henuz yoksa serbest metin girebilir (onyuz karari).
  app.get('/api/opsx/ocp/namespaces', requireAuth, async (req, res) => {
    try {
      const env = String(req.query.env || '').trim();
      const tenant = String(req.query.tenant || '').trim();
      if (!env || !tenant) return res.status(400).json({ ok: false, message: 'env ve tenant gerekli.' });
      const user = req.session?.user || {};
      const namespaces = await namespacesForCluster(env, tenant, user);
      res.json({ ok: true, namespaces });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // GET /api/opsx/ocp/apps?env=&tenant=&namespace= — namespace secildiginde otomatik
  // fetch edilen, SADECE bu listeden secilebilen (freetext girisi yok) uygulama dropdown'u.
  app.get('/api/opsx/ocp/apps', requireAuth, async (req, res) => {
    try {
      const env = String(req.query.env || '').trim();
      const tenant = String(req.query.tenant || '').trim();
      const namespace = String(req.query.namespace || '').trim();
      if (!env || !tenant || !namespace) {
        return res.status(400).json({ ok: false, message: 'env, tenant ve namespace gerekli.' });
      }
      const user = req.session?.user || {};
      const apps = await appsForNamespace(env, tenant, namespace, user);
      res.json({ ok: true, apps });
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

  // GET /api/opsx/ocp/operations — Openshift bacagindaki islem butonlari (sadece restart aktif).
  app.get('/api/opsx/ocp/operations', requireAuth, (req, res) => {
    res.json({ ok: true, operations: OCP_OPERATIONS });
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

  // POST /api/opsx/run — islemi tetikler.
  //
  // IKI PLATFORM, IKI FARKLI GOVDE (kullanici sartnamesi):
  //
  // Legacy — sunucu listesi AWX'in KENDI `limit` alaninda, extra_vars'ta DEGIL:
  //   { "limit": "GBCJAP01,GBCJAP03",
  //     "extra_vars": { "application": "...", "operation": "restart" } }
  //
  // Openshift — `limit` YOK; her sey extra_vars icinde, gercek bmw_openshift_jobs
  // playbook'larinin (application_rollout.yaml) bekledigi AYNI govde:
  //   { "extra_vars": { "env": "prod", "oc_cluster": "ark",
  //                     "oc_input": "ns1,app1;ns2,app2" } }
  //   terminal_host YOK — playbook `hosts: "{{ oc_cluster }}_{{ env }}"` ile hedefi
  //   kendisi cozer. oc_input, tek POST'ta birden fazla namespace/uygulama ciftini
  //   ";" ile tasir (onyuzde birikimli eklenir — bkz. OcpTargetStep.tsx).
  app.post('/api/opsx/run', requireAuth, express.json({ limit: '256kb' }), async (req, res) => {
    const { platform, application, hosts, operation, env, tenant, pairs, ocOperation } = req.body || {};

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

      // Su an SADECE restart aktif — sunucu tarafinda da beyaz liste kontrolu
      // (defence in depth; onyuzde zaten disable ama client'a guvenilmez).
      const ocOp = OCP_OPERATIONS.find((o) => o.key === ocOperation);
      if (!ocOp || !ocOp.enabled) {
        return res.status(400).json({ ok: false, message: 'Bu Openshift işlemi henüz kullanıma açık değil.' });
      }

      if (!envKey || !tenantKey) {
        return res.status(400).json({ ok: false, message: 'Ortam ve cluster (tenant) gerekli.' });
      }

      // Secim katalog agacina karsi yeniden dogrulanir — client'in gonderdigine guvenilmez.
      const adminData = require('../logx/v2/admin.cjs');
      let tree;
      try {
        tree = await adminData.getClusterTree();
      } catch (err) {
        return res.status(503).json({ ok: false, message: `Cluster kataloğu okunamadı: ${err.message}` });
      }
      if (!tree[envKey]) {
        return res.status(400).json({ ok: false, message: `Ortam tanımlı değil: ${envKey}` });
      }
      const clusterNames = tree[envKey][tenantKey];
      if (!clusterNames) {
        return res.status(400).json({ ok: false, message: `Cluster tanımlı değil: ${tenantKey}` });
      }

      // Her cift {namespace, application} sekliyle gelir. Namespace serbest metin
      // olabilir (kullanici biliyorsa) ya da onbellekten secilmis olabilir — ikisi de
      // burada AYNI sekilde ele alinir: format/bosluk dogrulanir, gercekte var olup
      // olmadigini playbook'un kendisi (`oc get`) belirler.
      if (!Array.isArray(pairs) || pairs.length === 0) {
        return res.status(400).json({ ok: false, message: 'En az bir namespace/uygulama çifti eklenmeli.' });
      }
      const cleanPairs = [];
      const restrictions = require('../logx/v2/restrictions.cjs');
      const user = req.session?.user || {};
      for (const p of pairs) {
        const ns = String(p?.namespace || '').trim();
        const appN = String(p?.application || '').trim();
        if (!ns || !appN) {
          return res.status(400).json({ ok: false, message: 'Her satırda namespace ve uygulama adı dolu olmalı.' });
        }
        if (ns.includes(',') || ns.includes(';') || appN.includes(',') || appN.includes(';')) {
          return res.status(400).json({ ok: false, message: 'Namespace/uygulama adı "," veya ";" içeremez.' });
        }
        // YETKI KONTROLU: bu tenant/env grubundaki HERHANGI bir gercek cluster icin bu
        // namespace acikca kisitlanmissa (LogX v2 > Erisim Kisitlamalari) tum istek
        // reddedilir — restart calistiran bir modulde bunu atlamak LogX'ten (salt log
        // indirme) bile daha riskli olurdu. fail-safe: tek bir kisitlama tum grubu kapatir.
        for (const clusterName of clusterNames) {
          const resourceKey = `${tenantKey}/${envKey}/${clusterName}/${ns}`;
          const allowed = await restrictions.isAllowed('ocp_namespace', resourceKey, user).catch(() => false);
          if (!allowed) {
            return res.status(403).json({
              ok: false,
              message: `"${ns}" namespace'i için erişim yetkiniz yok — ekibiniz bu kaynağı kısıtlamış olabilir.`,
            });
          }
        }
        cleanPairs.push(`${ns},${appN}`);
      }

      extraVars = {
        ...staticVars,
        [cfg.envKey]: envKey,
        [cfg.ocClusterKey]: tenantKey,
        [cfg.ocInputKey]: cleanPairs.join(';'),
      };
      logSummary = `env=${envKey} oc_cluster=${tenantKey} oc_input=${cleanPairs.join(';')}`;
    }

    try {
      const runner = require('../ansible/runner.cjs');
      // AWX'te "Prompt on launch" kapaliysa gonderilen extra_vars SESSIZCE yutulur ve
      // playbook bos girdiyle calisir. LogX ile ORTAK kontrol (2026-08-09 olayi).
      await require('../ansible/template-preflight.cjs')
        .assertTemplateAcceptsExtraVars(serverId, templateId, extraVars, { label: keyName });
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
