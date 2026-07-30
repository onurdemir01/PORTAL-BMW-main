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
// beyaz listedeki uc degerden biri kabul edilir. Aksi halde extra_vars uzerinden
// playbook'a beklenmedik bir deger enjekte edilebilirdi.
const ALLOWED_OPERATIONS = Object.freeze({
  restart: 'Uygulamamı restart et',
  stop: 'Uygulamamı durdur',
  start: 'Uygulamamı başlat',
});

const REGISTRY_KEYS = Object.freeze({
  legacy: 'opsx_legacy_operation',
  openshift: 'opsx_openshift_operation',
});

// Template ID + AWX sunucusu Playbook Kayitlari'ndan cozulur. getEffectiveTemplateId()
// once satirdaki awx_template_id'ye, o bos ise satirda tanimli env degiskenine bakar
// (bkz. server/ansible/playbook-registry.cjs) — LogX'in kullandigi ayni mekanizma.
async function resolveTarget(platform) {
  const playbookRegistry = require('../ansible/playbook-registry.cjs');
  const keyName = REGISTRY_KEYS[platform];
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

// Secilen uygulamanin bulundugu sunucular. LogX'in resolveHostsForApp'i ile ayni
// tabloyu okur ama OpsX'in kendi ihtiyaci farkli: burada env bilgisi de dondurulur
// (kullanici hangi ortamdaki sunucuyu sectigini gormeli).
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
    `SELECT DISTINCT UPPER(host) AS host, env FROM ${getAppsTable()} WHERE app = @app ORDER BY host`
  );
  return result.recordset
    .filter((r) => r.host)
    .map((r) => ({ host: String(r.host).trim(), env: String(r.env || '').trim() }));
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
