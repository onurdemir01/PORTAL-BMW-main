// server/telnet/index.cjs — Telnet: Uygulama Sunucularinda Hizli Baglanti Testi.
//
// Legacy: OpsX'in uygulama/sunucu secim akisinin BIREBIR kopyasi (kullanici istegi) —
// tek fark: son adimda bir ISLEM (restart/stop/...) degil, IP + Port sorulur ve
// Ansible'a { limit, extra_vars: { ip, port } } govdesiyle tetiklenir. Uygulama adi
// SADECE sunucu-tarafinda anti-TOCTOU dogrulamasi icin kullanilir, playbook'a
// GONDERILMEZ (kullanici sartnamesi — extra_vars yalniz ip/port icerir).
//
// Openshift (2026-08-12'den beri LOGX MODELI): hedef JUMP SERVER'lardir, cluster'lar VERI
// olarak gider — portal `terminal_hosts[]`/`ocp_clusters[]` gonderir (bkz. asagidaki not).
// Onceki not (artik gecerli DEGIL): cluster secimi/terminal_host/bastion cozumleme YOK (eski bastion-bazli
// akis kullanici karariyla kaldirildi) — sadece ortam + tenant/is birimi + namespace(ler).
//
// COKLU NAMESPACE TEK JOBDA (2026-08-12, ikinci karar): eskiden HER namespace icin AYRI
// bir AWX job'i tetikleniyordu (results: [...] donuyordu). Playbook artik (cluster x
// namespace) capraz carpimini TEK jobda isliyor (bkz. ocp_telnet_control.yml `product()`
// notu) - portal da TEK job tetikler, Legacy ile AYNI TelnetRunResult seklini doner.
//
// HANGI AWX SUNUCUSU / TEMPLATE'I: Admin > Playbook Kayitlari ekranindan yonetilir
// (ansible_playbook_registry satirlari: telnet_legacy_operation, telnet_openshift_operation)
// — OpsX ile AYNI desen, template ID koda gomulu DEGIL.
'use strict';

const { hostsForApp, namespacesForCluster } = require('../opsx/index.cjs');

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

  // Telnet sayfasi kullaniciya kapaliysa GERCEK 403 (OpsX/LogX v2 ile ayni desen).
  try {
    const { requireVisiblePrefix } = require('../auth/visibility.cjs');
    app.use('/api/telnet', requireVisiblePrefix('Telnet'));
  } catch { /* motor yoksa yoksay */ }

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

  // GET /api/telnet/ocp/namespaces?env=&tenant= — OpsX'in namespacesForCluster'ini
  // DOGRUDAN yeniden kullanir (ayni onbellek + erisim kisitlamasi filtresi — kod tekrari yok).
  app.get('/api/telnet/ocp/namespaces', requireAuth, async (req, res) => {
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
  //   Tek istek = tek AWX job'i, yanit tek nesnedir (jobId/status/...).
  //
  // Openshift — cluster secimi/terminal_host/bastion cozumleme YOK (kullanici karari,
  // eski bastion-bazli akis kaldirildi): TEK AWX job'i, TUM namespace'ler extra_vars'ta:
  //   { "namespaces": ["ns1", "ns2"], "extra_vars": { "env": "test", "cluster": "ark",
  //     "namespaces": ["ns1","ns2"], "ip": "...", "port": "..." } }
  //   Yanit Legacy ile AYNI sekil: `{ ok, jobId, status, awxServerId, templateId, sentBody }`
  //   (bkz. src/api/telnetApi.ts TelnetRunResult) — eskiden namespace basina ayri job/sonuc
  //   dizisi donuyordu, playbook artik (cluster x namespace) capraz carpimini TEK jobda
  //   islediginden buna gerek kalmadi.
  //
  // Not: `application` yalniz sunucu-tarafi anti-TOCTOU dogrulamasi icindir, extra_vars'a
  // KONMAZ (kullanici sartnamesi).
  app.post('/api/telnet/run', requireAuth, express.json({ limit: '64kb' }), async (req, res) => {
    const { platform, application, hosts, env, tenant, namespaces, ip, port } = req.body || {};
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

    // ── Openshift: erken donus, Legacy'den TAMAMEN AYRI govde/yanit sekli ──────────────
    if (plat === 'openshift') {
      const envKey = String(env || '').trim();
      const tenantKey = String(tenant || '').trim();
      if (!envKey || !tenantKey) {
        return res.status(400).json({ ok: false, message: 'Ortam ve tenant/iş birimi gerekli.' });
      }
      // Katalog dogrulamasi — client'in gonderdigine guvenilmez (OpsX ile ayni ilke).
      const adminData = require('../logx/v2/admin.cjs');
      let tree;
      try {
        tree = await adminData.getClusterTree();
      } catch (err) {
        return res.status(503).json({ ok: false, message: `Cluster kataloğu okunamadı: ${err.message}` });
      }
      if (!tree[envKey]) return res.status(400).json({ ok: false, message: `Ortam tanımlı değil: ${envKey}` });
      if (!tree[envKey][tenantKey]) return res.status(400).json({ ok: false, message: `Tenant/İş birimi tanımlı değil: ${tenantKey}` });

      if (!Array.isArray(namespaces) || namespaces.length === 0) {
        return res.status(400).json({ ok: false, message: 'En az bir namespace seçilmeli.' });
      }
      const cleanNamespaces = [...new Set(namespaces.map((n) => String(n || '').trim()).filter(Boolean))];
      if (cleanNamespaces.length === 0) {
        return res.status(400).json({ ok: false, message: 'En az bir namespace seçilmeli.' });
      }
      const badNs = cleanNamespaces.find((n) => n.includes(',') || n.includes(';'));
      if (badNs) {
        return res.status(400).json({ ok: false, message: `Geçersiz namespace adı: ${badNs}` });
      }

      // ── LOGX MODELI (2026-08-12 kullanici karari) ──────────────────────────────
      // Playbook artik `{{ cluster }}_{{ env }}` envanter GRUBUNU hedeflemiyor; hedef
      // JUMP SERVER'lardir ve cluster'lar VERI olarak gider — LogX'in uretimde kanitlanmis
      // modeli (bkz. logx_ocp_discover_fetch.yml: portal `terminal_hosts[]` gonderir,
      // playbook `add_host` ile onlari gruba atar, her bastion kendi cluster'ina
      // `oc login` yapar).
      //
      // NEDEN: eski modelde cluster -> jump server eslemesi AWX envanterinin ICINDE gizliydi
      // (envanterde `gbocpqa1` hem GRUP hem HOST olarak tanimli — Ansible bunu uyari olarak
      // basiyor). Portalin DB'sindeki `ocp_cluster_index.terminal_host` kaydi hic
      // kullanilmiyordu. Artik eslemenin tek kaynagi portal.
      //
      // YAN FAYDA: cluster alt kumesi secimi bu modelde AWX `limit`ine HIC ihtiyac duymadan
      // mumkun hale gelir (az cluster secilirse az `ocp_clusters[]` kaydi gonderilir) —
      // `limit`in sessizce yutulmasi sorunu bu yolda hic ortaya cikmaz.
      const clusterNames = tree[envKey][tenantKey];
      let fanout;
      try {
        const { hosts, missing } = await adminData.resolveTerminalHosts(envKey, tenantKey, clusterNames);
        if (missing.length) {
          return res.status(400).json({
            ok: false,
            message: `Şu cluster'lar için Jump Server (bastion) tanımlı değil: ${missing.join(', ')} — `
                   + `Admin > LogX Yapılandırma ekranından cluster satırına Jump Server girin.`,
          });
        }
        const meta = await adminData.resolveClusterMeta(envKey, tenantKey, clusterNames).catch(() => ({}));
        const ocpMod = require('../logx/v2/ocp.cjs');
        // RUNTIME AYARLARI DA GONDERILMELI (2026-08-12, uretim job 3218799/3218800):
        // `oc login --username` degeri once cluster satirindan (`ocp_username` kolonu),
        // O YOKSA portalin GENEL varsayilanindan gelir — ve genel varsayilan yalnizca
        // `buildOcpRuntimeVars` ile tasinir. Telnet bunu gondermeyince kullanici adi BOS
        // kaldi ve UC cluster'da da login dustu; hata `no_log` altinda gorunmuyordu.
        // LogX'in uc job'i da bu ikiliyi (extra + runtime) BIRLIKTE gonderiyor — ayni
        // dersin ikinci kez ogrenilmemesi icin burada da oyle.
        const runtimeCfg = await require('../logx/v2/ocp-runtime-config.cjs').getConfig().catch(() => ({}));
        // LogX ve OpsX ile AYNI yardimci — payload sekli tek yerde tanimli.
        fanout = {
          ...ocpMod.buildOcpExtraVars({ env: envKey, tenant: tenantKey, clusters: clusterNames, hosts, meta }),
          ...ocpMod.buildOcpRuntimeVars(runtimeCfg),
        };
      } catch (err) {
        return res.status(err.status || 500).json({ ok: false, message: err.message });
      }

      // GERIYE UYUM ALIASI (2026-08-12, uretim): playbook telnet hedefini
      // `{{ target_host }}` / `{{ target_port }}` adlariyla okuyor, portal ise `ip`/`port`
      // gonderiyordu — job 3218662'de UC host da "'target_host' is undefined" ile dustu ve
      // telnet ciktisi "VARIABLE IS NOT DEFINED!" oldu. Iki adi da gonderiyoruz: playbook
      // hangi surumde olursa olsun calisir, AWX'e kopyalama beklenmez. (Ayni desen LogX'te
      // `oc_namespace_input` + `namespace` icin de kullaniliyor.)
      const extraVars = {
        // Jump server + cluster baglanti kayitlari (terminal_hosts[], ocp_clusters[]).
        ...fanout,
        env: envKey,
        cluster: tenantKey,
        // COKLU NAMESPACE TEK JOBDA: playbook (cluster x namespace) capraz carpimini
        // kendisi kuruyor (bkz. ocp_telnet_control.yml `product()` notu).
        namespaces: cleanNamespaces,
        ip: ipTrim,
        port: portTrim,
        target_host: ipTrim,
        target_port: portTrim,
      };

      const runner = require('../ansible/runner.cjs');
      try {
        const result = await runner.launchJobOnServer(serverId, templateId, extraVars, '');

        try {
          const db = require('../db/index.cjs');
          await db.query(
            `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              req.session?.user?.username || 'unknown',
              serverId, templateId, `Telnet: openshift (${cleanNamespaces.join(',')})`,
              result?.jobId, result?.status || 'pending',
              JSON.stringify({ platform: 'openshift', ...extraVars }),
            ]
          );
        } catch (e) {
          console.warn('[Telnet] Gecmis kaydedilemedi:', e.message);
        }

        try {
          require('../audit/index.cjs').auditPortal(req, 'telnet_operation', {
            detail: JSON.stringify({ platform: 'openshift', extraVars, jobId: result?.jobId ?? null }),
          });
        } catch { /* denetim kaydi best-effort */ }

        console.log(`[Telnet] ${req.session?.user?.username} -> openshift env=${envKey} cluster=${tenantKey} namespaces=${cleanNamespaces.join(',')} ip=${ipTrim} port=${portTrim} template=${templateId} server=${serverId} job=${result?.jobId ?? '?'}`);
        return res.json({
          ok: true,
          jobId: result?.jobId ?? null,
          status: result?.status ?? null,
          awxServerId: serverId,
          templateId,
          sentBody: { extra_vars: extraVars },
        });
      } catch (err) {
        return res.status(err.status || 500).json({ ok: false, message: err.message });
      }
    }

    // ── Legacy ──────────────────────────────────────────────────────────────────────
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

    const limitValue = requested.join(',');
    const extraVars = { ip: ipTrim, port: portTrim };
    const logSummary = `app=${String(application).trim()} limit=${limitValue} ip=${ipTrim} port=${portTrim}`;

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
            serverId, templateId, `Telnet: legacy`,
            result?.jobId, result?.status || 'pending',
            JSON.stringify({ platform: 'legacy', limit: limitValue, ...extraVars }),
          ]
        );
      } catch (e) {
        console.warn('[Telnet] Gecmis kaydedilemedi:', e.message);
      }

      try {
        require('../audit/index.cjs').auditPortal(req, 'telnet_operation', {
          detail: JSON.stringify({ platform: 'legacy', limit: limitValue, extraVars, jobId: result?.jobId ?? null }),
        });
      } catch { /* denetim kaydi best-effort */ }

      console.log(`[Telnet] ${req.session?.user?.username} -> legacy ${logSummary} template=${templateId} server=${serverId} job=${result?.jobId ?? '?'}`);
      res.json({
        ok: true,
        jobId: result?.jobId ?? null,
        status: result?.status ?? null,
        awxServerId: serverId,
        templateId,
        sentBody: { limit: limitValue, extra_vars: extraVars },
      });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  console.log('[Telnet] endpoints mounted at /api/telnet');
}

module.exports = { initTelnet };
