// server/opsx/index.cjs — OpsX: Guvenli Uygulama Operasyonlari.
//
// LogX log INDIRIR; OpsX uygulama uzerinde ISLEM yapar (restart/stop/start) VEYA dosya
// URETIP indirtir (thread/heap dump — bkz. dosya sonundaki "Thread/Heap Dump" bolumu,
// server/opsx/downloads.cjs). Ikisi de ayni envanteri ve ayni cluster katalogunu okur.
//
// HANGI AWX SUNUCUSU / TEMPLATE'I: Admin > Playbook Kayitlari ekranindan yonetilir
// (ansible_playbook_registry satirlari: opsx_legacy_operation, opsx_openshift_operation,
// opsx_legacy_dump, opsx_openshift_dump). LogX ile AYNI desen — template ID koda gomulu
// DEGIL. Registry'de template ID bos ise endpoint 501 doner ve kullaniciya "yonetici
// tanimlamali" mesaji gosterilir; sessizce yanlis bir job tetiklenmez.
//
// JOB'A GIDEN PARAMETRELER: server/opsx/config.cjs'te tanimli (anahtar adlari +
// her calistirmaya eklenen sabit degiskenler) — bunu duzenleyen ayri bir admin ekrani
// ARTIK YOK (kaldirildi, kararsizdi); degisiklik gerekirse dogrudan kod uzerinden yapilir.
// Varsayilan esleme:
//   Legacy    -> application: <Uygulama Adi>, limit: <Sunucu1,Sunucu2,...>, operation: restart|stop|start
//   Openshift -> env: <ortam>, oc_cluster: <tenant>, oc_input: "ns1,app1;ns2,app2"
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

// Openshift bacagindaki islem secenekleri — restart, extra_vars'ta `operation` olarak
// DEGIL ozel bir openshift_operations sabitiyle gider (bkz. run() Openshift dali).
// threaddump/heapdump artik AYRI bir AWX job template'i (opsx_openshift_dump, bkz.
// POST /api/opsx/dump/openshift) uzerinden calisir — bu listedeki enabled bayragi SADECE
// onyuzdeki dugmenin tiklanabilir olup olmadigini belirler. tcpdump henuz desteklenmiyor.
// Sunucu tarafinda da bu listenin disinda bir key kabul EDILMEZ (defence in depth).
const OCP_OPERATIONS = Object.freeze([
  { key: 'restart', label: 'Uygulamamı restart et', enabled: true },
  { key: 'threaddump', label: 'Thread dump al', enabled: true },
  { key: 'heapdump', label: 'Heap dump al', enabled: true },
  { key: 'tcpdump', label: 'Tcpdump al', enabled: false },
]);

const REGISTRY_KEYS = Object.freeze({
  legacy: 'opsx_legacy_operation',
  openshift: 'opsx_openshift_operation',
  legacyDump: 'opsx_legacy_dump',
  openshiftDump: 'opsx_openshift_dump',
  openshiftPods: 'opsx_openshift_pods',
  legacyJvmDiscover: 'opsx_legacy_jvm_discover',
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

// Legacy sunucu listesini anti-TOCTOU ile dogrular ve secilen sunucularin ORTAK JBoss
// majör surumunu (varsa) turetir. Hem POST /api/opsx/run (restart/stop/start) hem
// POST /api/opsx/dump/legacy tarafindan kullanilir — ikisi de AYNI dogrulama/türetme
// kurallarina tabi olmali.
async function resolveLegacyTargets(application, hosts) {
  if (!String(application || '').trim()) {
    throw Object.assign(new Error('Uygulama adı gerekli.'), { status: 400 });
  }
  if (!Array.isArray(hosts) || hosts.length === 0) {
    throw Object.assign(new Error('En az bir sunucu seçilmeli.'), { status: 400 });
  }
  const appHosts = await hostsForApp(application);
  const allowed = new Set(appHosts.map((h) => h.host.toUpperCase()));
  const requested = hosts.map((h) => String(h || '').trim().toUpperCase()).filter(Boolean);
  const notMine = requested.filter((h) => !allowed.has(h));
  if (notMine.length) {
    throw Object.assign(new Error(`Bu sunucular seçilen uygulamaya ait değil: ${notMine.join(', ')}`), { status: 400 });
  }
  // jboss_version: "8.0.7" -> jboss8, "7.3.10" -> jboss7. WAS gibi JBoss olmayan
  // uygulamalarda bos/tanimsiz surum HATA sayilmaz (null doner, cagiran extra_vars'a
  // hic eklemez). Karisik 7.X/8.X secimi ARTIK REDDEDILMEZ (kullanici karari) —
  // "all" gonderilir, playbook'un kendisi hangi majorlerin gercekten var oldugunu
  // (jboss_existence/jboss8_existence, bkz. bmw_portal/java_app_ops/operations/tasks/
  // main.yml) zaten ayrica kontrol ediyor.
  const versionByHost = new Map(appHosts.map((h) => [h.host.toUpperCase(), h.jbossVersion]));
  const jbossMajors = new Set();
  for (const h of requested) {
    const major = (versionByHost.get(h) || '').match(/^(\d+)/)?.[1];
    if (major === '7' || major === '8') jbossMajors.add(major);
  }
  const jbossVersion = jbossMajors.size > 1 ? 'all' : (jbossMajors.size === 1 ? `jboss${[...jbossMajors][0]}` : null);
  return { requested, jbossVersion };
}

// Openshift namespace/uygulama ciftlerini cluster katalogu + erisim kisitlamalarina
// karsi dogrular. Hem POST /api/opsx/run (restart) hem POST /api/opsx/dump/openshift
// tarafindan kullanilir.
async function resolveOpenshiftTargets(env, tenant, pairs, user) {
  const envKey = String(env || '').trim();
  const tenantKey = String(tenant || '').trim();
  if (!envKey || !tenantKey) {
    throw Object.assign(new Error('Ortam ve cluster (tenant) gerekli.'), { status: 400 });
  }
  const adminData = require('../logx/v2/admin.cjs');
  let tree;
  try {
    tree = await adminData.getClusterTree();
  } catch (err) {
    throw Object.assign(new Error(`Cluster kataloğu okunamadı: ${err.message}`), { status: 503 });
  }
  if (!tree[envKey]) throw Object.assign(new Error(`Ortam tanımlı değil: ${envKey}`), { status: 400 });
  const clusterNames = tree[envKey][tenantKey];
  if (!clusterNames) throw Object.assign(new Error(`Cluster tanımlı değil: ${tenantKey}`), { status: 400 });
  if (!Array.isArray(pairs) || pairs.length === 0) {
    throw Object.assign(new Error('En az bir namespace/uygulama çifti eklenmeli.'), { status: 400 });
  }
  const cleanPairs = [];
  const restrictions = require('../logx/v2/restrictions.cjs');
  for (const p of pairs) {
    const ns = String(p?.namespace || '').trim();
    const appN = String(p?.application || '').trim();
    if (!ns || !appN) {
      throw Object.assign(new Error('Her satırda namespace ve uygulama adı dolu olmalı.'), { status: 400 });
    }
    if (ns.includes(',') || ns.includes(';') || appN.includes(',') || appN.includes(';')) {
      throw Object.assign(new Error('Namespace/uygulama adı "," veya ";" içeremez.'), { status: 400 });
    }
    // YETKI KONTROLU: bu tenant/env grubundaki HERHANGI bir gercek cluster icin bu
    // namespace acikca kisitlanmissa (LogX v2 > Erisim Kisitlamalari) tum istek
    // reddedilir — restart/dump tetikleyen bir modulde bunu atlamak LogX'ten (salt log
    // indirme) bile daha riskli olurdu. fail-safe: tek bir kisitlama tum grubu kapatir.
    for (const clusterName of clusterNames) {
      const resourceKey = `${tenantKey}/${envKey}/${clusterName}/${ns}`;
      const allowed = await restrictions.isAllowed('ocp_namespace', resourceKey, user).catch(() => false);
      if (!allowed) {
        throw Object.assign(
          new Error(`"${ns}" namespace'i için erişim yetkiniz yok — ekibiniz bu kaynağı kısıtlamış olabilir.`),
          { status: 403 }
        );
      }
    }
    cleanPairs.push({ namespace: ns, application: appN, joined: `${ns},${appN}` });
  }
  return { envKey, tenantKey, cleanPairs, clusterNames };
}

// Client'in gonderdigi cluster alt kumesini, bu tenant/env icin DB'den AZ ONCE cozulmus
// gercek cluster listesine karsi dogrular (ANTI-TOCTOU). Grup disindaki bir isim ne AWX
// `limit`ine ne de `ocp_clusters[]`e sizabilir.
//
// Bos/gonderilmemis liste = KISITLAMA YOK: cagiran bugunku davranisi (tum cluster'lar)
// surdurur. Bu, "calisan yapiyi bozma" kuralinin somut hali — alan opsiyoneldir, eski
// onyuz yeni sunucuyla aynen calisir.
function pickClusterSubset(requested, clusterNames) {
  if (!Array.isArray(requested) || requested.length === 0) return clusterNames;
  const wanted = [...new Set(requested.map((c) => String(c || '').trim()).filter(Boolean))];
  if (!wanted.length) return clusterNames;
  const unknown = wanted.filter((c) => !clusterNames.includes(c));
  if (unknown.length) {
    throw Object.assign(new Error(`Geçersiz cluster: ${unknown.join(', ')}`), { status: 400 });
  }
  return wanted;
}

// Bir tenant'a BIRDEN FAZLA gercek OCP cluster'i bagli olabilir (getClusterTree()) — pod
// kesfi/dump eskiden bunlardan yalniz BIRINE (AWX inventory grubundaki run_once ilk host)
// bagleniyordu, digerlerindeki pod'lar hic gorunmuyordu (bildirilen hata). LogX v2'nin
// AYNI sorunu cozen, production'da kanitlanmis mekanizmasi burada YENIDEN KULLANILIR
// (sifirdan yazilmaz): cluster basina bastion+metadata (api_url/vault anahtari) DB'den
// cozulur, playbook'un `ocp_clusters[]`/`terminal_hosts[]` ile fan-out yapabilmesi icin
// extra_vars kurulur — bkz. server/ansible/playbooks/logx_ocp_discover_fetch.yml.
async function resolveOcpClusterFanout(envKey, tenantKey, clusterNames) {
  const adminData = require('../logx/v2/admin.cjs');
  const { buildOcpExtraVars } = require('../logx/v2/ocp.cjs');
  const { hosts, missing } = await adminData.resolveTerminalHosts(envKey, tenantKey, clusterNames);
  if (missing.length) {
    throw Object.assign(
      new Error(
        `Şu cluster'lar için Jump Server (bastion) tanımlı değil: ${missing.join(', ')} — ` +
        `Admin > LogX Yapılandırma ekranından cluster satırına Jump Server girin.`
      ),
      { status: 400 }
    );
  }
  const meta = await adminData.resolveClusterMeta(envKey, tenantKey, clusterNames).catch(() => ({}));
  return buildOcpExtraVars({ env: envKey, tenant: tenantKey, clusters: clusterNames, hosts, meta });
}

// AWX artifacts'inden bir set_stats anahtarini okur. AWX controller surumune gore ayni
// veri UC FARKLI sekilde gelebilir (top-level / data / ansible_stats.data) — LogX'in
// extractLogxResultFromArtifacts'iyle AYNI tolerans (bkz. server/logx/v2/jobs.cjs).
function extractStatsKey(rawArtifacts, key) {
  const artifacts = rawArtifacts || {};
  for (const candidate of [
    artifacts[key],
    artifacts.data?.[key],
    artifacts.ansible_stats?.data?.[key],
  ]) {
    if (candidate && typeof candidate === 'object') return candidate;
  }
  return null;
}

// Dump playbook'unun son adimda set_stats ile yayinladigi yapilandirilmis sonuc.
function extractOpsxDumpResult(rawArtifacts) {
  return extractStatsKey(rawArtifacts, 'opsx_dump_result');
}

// Pod kesfi playbook'unun (opsx_openshift_pods.yaml) sonucu.
function extractOpsxPodsResult(rawArtifacts) {
  return extractStatsKey(rawArtifacts, 'opsx_pods_result');
}

// JVM kesfi playbook'unun (opsx_legacy_jvm_discover.yml) sonucu.
function extractOpsxJvmResult(rawArtifacts) {
  return extractStatsKey(rawArtifacts, 'opsx_jvm_result');
}

// env+tenant secimine karsilik gelen GERCEK cluster isimleri (ocp_cluster_index'ten,
// LogX'in kullandigi AYNI katalog). Gercek bmw_openshift_jobs playbook'lari `hosts:
// "{{ oc_cluster }}_{{ env }}"` ile TUM bu cluster'lari TEK grupta hedefler — bu yuzden
// OpsX artik tek tek cluster_name secmez, sadece bu isimleri namespace/app envanterini
// (ocp-inventory.cjs → dbo.Openshift_Inventory) sorgulamak icin kullanir.
async function resolveClusterNames(env, tenant) {
  const adminData = require('../logx/v2/admin.cjs');
  const tree = await adminData.getClusterTree();
  return tree?.[env]?.[tenant] || [];
}

// PORTALDAN BAGIMSIZ, zamanlanmis bir Ansible job'i (openshift_inventory.yml) TUM
// cluster'lari periyodik tarayip dbo.Openshift_Inventory'i besler; OpsX burada SADECE
// OKUR — kendi bir AWX job'i tetiklemez, bu yuzden secim aninda doner (bkz.
// server/logx/v2/ocp-inventory.cjs basindaki mimari notu — ONUR'UN KARARI, degistirmeden
// once onunla konusun). Namespace-bazli erisim kisitlamasi (logx_v2_restrictions) LogX
// ile AYNI kapidan (restrictions.cjs) uygulanir — restart TETIKLEYEN bir modulde bu
// kontrolu atlamak LogX'ten (salt log indirme) bile daha riskli olurdu.
async function namespacesForCluster(env, tenant, user) {
  const clusterNames = await resolveClusterNames(env, tenant);
  if (!clusterNames.length) return [];
  const ocpInventory = require('../logx/v2/ocp-inventory.cjs');
  const restrictions = require('../logx/v2/restrictions.cjs');
  const out = await ocpInventory.getNamespaces({ clusterNames }).catch(() => ({ items: [] }));
  const all = [...new Set(out.items || [])].sort();
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
  const ocpInventory = require('../logx/v2/ocp-inventory.cjs');
  const restrictions = require('../logx/v2/restrictions.cjs');
  // Bu namespace HERHANGI bir cluster'da kisitlanmissa TUM uygulama listesi gizlenir
  // (fail-safe — ayni gerekce yukarida).
  for (const clusterName of clusterNames) {
    const resourceKey = `${tenant}/${env}/${clusterName}/${ns}`;
    const allowed = await restrictions.isAllowed('ocp_namespace', resourceKey, user).catch(() => false);
    if (!allowed) return [];
  }
  const out = await ocpInventory.getApps({ clusterNames, namespace: ns }).catch(() => ({ items: [] }));
  return [...new Set((out.items || []).map((i) => i.name))].sort();
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
  //   Bir tenant/env grubuna BIRDEN FAZLA gercek cluster bagli olabilir (ör. ark_prod →
  //   gbocpprod1,gbocpprod2,gbocpprod4) — uygulama sahibi bazen SADECE birini hedeflemek
  //   ister. Bunun icin oc_cluster/env DEGISTIRILMEZ (harici application_rollout.yaml'in
  //   `hosts:`/prepare.yaml grup dogrulamasi hala bunlara bagimli) — bunun yerine, Legacy'nin
  //   zaten kullandigi AYNI mekanizma (AWX'in KENDI `limit` alani) ocClusters[] doluysa
  //   secili gercek cluster adlariyla doldurulur; Ansible bunu oc_cluster_env grubuyla
  //   KESISTIRIR. Bos/gonderilmemis ocClusters = kisitlama yok (tum cluster'lar, eski davranis).
  app.post('/api/opsx/run', requireAuth, express.json({ limit: '256kb' }), async (req, res) => {
    const { platform, application, hosts, operation, env, tenant, pairs, ocOperation, ocClusters } = req.body || {};

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
    let limitValue = '';   // Legacy'de HER ZAMAN dolu; Openshift'te SADECE cluster kisitlamasi secildiyse — AWX'in --limit alani
    let logSummary;

    if (plat === 'legacy') {
      if (!ALLOWED_OPERATIONS[operation]) {
        return res.status(400).json({ ok: false, message: 'Geçersiz işlem.' });
      }
      // ANTI-TOCTOU + jboss_version turetme: resolveLegacyTargets() (bkz. dosya basi) —
      // dump endpoint'iyle PAYLASILAN, tek yerde tanimli dogrulama.
      let requested, jbossVersion;
      try {
        ({ requested, jbossVersion } = await resolveLegacyTargets(application, hosts));
      } catch (err) {
        return res.status(err.status || 500).json({ ok: false, message: err.message });
      }

      limitValue = requested.join(cfg.separator);
      // limit BURADA extra_vars'a KONMAZ — sartname onu ust seviyede istiyor.
      extraVars = {
        ...staticVars,
        [cfg.applicationKey]: String(application).trim(),
        [cfg.operationKey]: operation,
        ...(jbossVersion ? { jboss_version: jbossVersion } : {}),
      };

      logSummary = `app=${String(application).trim()} limit=${limitValue} op=${operation}${jbossVersion ? ` jboss_version=${jbossVersion}` : ''}`;

    } else {
      // ── Openshift ───────────────────────────────────────────────────────────
      // /api/opsx/run SADECE restart/rollout icin — threaddump/heapdump artik enabled:true
      // ama AYRI bir AWX template'e (opsx_openshift_dump, bkz. POST /api/opsx/dump/openshift)
      // gider, bu route'a DEGIL. `ocOp.key !== 'restart'` kontrolu bu ayrimi sunucu
      // tarafinda da zorunlu kilar (defence in depth; onyuz zaten dogru route'a yonlendirir
      // ama client'a guvenilmez).
      const ocOp = OCP_OPERATIONS.find((o) => o.key === ocOperation);
      if (!ocOp || !ocOp.enabled || ocOp.key !== 'restart') {
        return res.status(400).json({ ok: false, message: 'Bu Openshift işlemi henüz kullanıma açık değil.' });
      }

      // Katalog + erisim kisitlamasi dogrulamasi: resolveOpenshiftTargets() (bkz. dosya
      // basi) — dump endpoint'iyle PAYLASILAN, tek yerde tanimli dogrulama.
      let envKey, tenantKey, cleanPairs, clusterNames;
      try {
        const user = req.session?.user || {};
        ({ envKey, tenantKey, cleanPairs, clusterNames } = await resolveOpenshiftTargets(env, tenant, pairs, user));
      } catch (err) {
        return res.status(err.status || 500).json({ ok: false, message: err.message });
      }
      const ocInput = cleanPairs.map((p) => p.joined).join(';');

      // ANTI-TOCTOU: client'in gonderdigi ocClusters[], resolveOpenshiftTargets'in bu
      // tenant/env icin DB'den az once cozdugu gercek cluster listesine (clusterNames)
      // KARSI dogrulanir — bu grubun disindaki bir isim limit'e asla sizmaz.
      let ocClusterLimit = '';
      try {
        const picked = pickClusterSubset(ocClusters, clusterNames);
        // Hepsi seciliyse `limit` BOS birakilir — AWX'e gereksiz bir kisit gondermemek
        // bugunku davranisi birebir korur.
        if (picked.length < clusterNames.length) ocClusterLimit = picked.join(cfg.separator);
      } catch (err) {
        return res.status(err.status || 400).json({ ok: false, message: err.message });
      }
      limitValue = ocClusterLimit;

      extraVars = {
        ...staticVars,
        [cfg.envKey]: envKey,
        [cfg.ocClusterKey]: tenantKey,
        [cfg.ocInputKey]: ocInput,
        // Su an SADECE restart/rollout aktif (bkz. OCP_OPERATIONS) — bmw_openshift_jobs
        // AWX job template'inin hangi operasyonu calistiracagini secen sabit deger.
        openshift_operations: 'openshift_application_rollout',
        choise: true,
      };
      logSummary = `env=${envKey} oc_cluster=${tenantKey} oc_input=${ocInput}${ocClusterLimit ? ` limit=${ocClusterLimit}` : ''}`;
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

  // ── Thread/Heap Dump ──────────────────────────────────────────────────────────
  // restart/stop/start'tan (yukaridaki /api/opsx/run) BILEREK AYRI: dump islemleri bir
  // dosya URETIP kullaniciya indirtiyor, bu yuzden AYRI AWX template'leri (opsx_legacy_dump/
  // opsx_openshift_dump) ve LogX'in "job bitince set_stats'tan yapilandirilmis sonuc oku +
  // indirme token'i uret" desenini (bkz. server/logx/v2/jobs.cjs + downloads.cjs) izler —
  // ama LogX'in logx_v2_requests/logx_v2_jobs state-machine'ine BAGLANMADAN, kendi tek
  // tablolu mekanizmasiyla (server/opsx/downloads.cjs).
  const DUMP_TYPES = new Set(['threaddump', 'heapdump']);

  // JBoss majorune gore izin verilen kurulum yolu (opsx_legacy_jvm_discover.yml'de
  // SABIT olarak tanimli /usr/jboss/ (7) ve /usr/jboss8/ (8) ile eslesir — kullanicinin
  // verdigi GERCEK komutlardan). "all" (karisik 7/8 secimi) ya da bilinmeyen bir surumde
  // HER IKISI de kabul edilir; keskin bir major biliniyorsa SADECE o kabul edilir —
  // aksi halde Jboss8 secilse bile ayni uygulamanin Jboss7 JVM'i listeye sizardi
  // (bildirilen hata: "Jboss8 secmeme ragmen Jboss7 JVM'inin PID'sini de getirdi").
  function jbossMajorsFor(jbossVersion) {
    if (jbossVersion === 'jboss7') return ['7'];
    if (jbossVersion === 'jboss8') return ['8'];
    return ['7', '8'];
  }

  // ── Legacy JVM KESFI ──────────────────────────────────────────────────────────
  // Ayni uygulamaya ait BIRDEN FAZLA JVM ayni host'ta calisiyor olabilir — eskiden dump
  // playbook'u PID'i korlemesine (`pgrep -f 'jboss|wildfly|eap' | head -1`) buluyordu,
  // uygulama adini hic kullanmiyordu ve boyle bir durumda sessizce SADECE ILKINI aliyordu.
  // Artik OpenShift pod kesfiyle AYNI desen: sihirbaz secili host'larda ANLIK bir AWX job'i
  // (opsx_legacy_jvm_discover.yml) tetikleyip application adina VE secilen JBoss majorune
  // ait kurulum yolunda calisan JVM'leri (PID + komut satiri) listeler, kullanici bir/birden
  // fazla (host,pid) cifti secer.
  //
  // POST /api/opsx/legacy/jvm/discover — { application, hosts } → { jobId, awxServerId }
  app.post('/api/opsx/legacy/jvm/discover', requireAuth, express.json({ limit: '16kb' }), async (req, res) => {
    const { application, hosts } = req.body || {};
    const { templateId, serverId, keyName } = await resolveTarget('legacyJvmDiscover');
    if (!templateId) {
      return res.status(501).json({
        ok: false,
        message: `OpsX Legacy JVM keşfi için AWX job template'i henüz tanımlanmadı. `
               + `Yönetici, Admin > Playbook Kayıtları ekranında "${keyName}" satırının `
               + `Template ID alanını doldurmalı.`,
      });
    }

    // Anti-TOCTOU: host'ların gercekten bu uygulamaya ait oldugu VE ortak JBoss majorunun
    // (varsa) ne oldugu MEVCUT resolveLegacyTargets ile dogrulanir/turetilir — dump
    // launch'inin zaten kullandigi AYNI kapi, ayni turetme.
    let requested, jbossVersion;
    try {
      ({ requested, jbossVersion } = await resolveLegacyTargets(application, hosts));
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, message: err.message });
    }

    const limitValue = requested.join(',');
    const extraVars = {
      application: String(application).trim(),
      jboss_majors: jbossMajorsFor(jbossVersion),
    };

    try {
      const runner = require('../ansible/runner.cjs');
      await require('../ansible/template-preflight.cjs')
        .assertTemplateAcceptsExtraVars(serverId, templateId, extraVars, { label: keyName });
      const result = await runner.launchJobOnServer(serverId, templateId, extraVars, limitValue);

      // IDOR korumasi /api/opsx/legacy/jvm/:serverId/:jobId/status'ta bu kayda bakar.
      try {
        const db = require('../db/index.cjs');
        await db.query(
          `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            req.session?.user?.username || 'unknown',
            serverId, templateId, `OpsX: Legacy JVM keşfi`,
            result?.jobId, result?.status || 'pending',
            JSON.stringify({ platform: 'legacy-jvm-discover', limit: limitValue, ...extraVars }),
          ]
        );
      } catch (e) {
        console.warn('[OpsX] JVM kesfi gecmisi kaydedilemedi:', e.message);
      }

      console.log(`[OpsX] ${req.session?.user?.username} -> jvm kesfi app=${application} limit=${limitValue} template=${templateId} server=${serverId} job=${result?.jobId ?? '?'}`);
      res.json({ ok: true, jobId: result?.jobId ?? null, status: result?.status ?? null, awxServerId: serverId });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // GET /api/opsx/legacy/jvm/:serverId/:jobId/status — is bitince JVM listesini doner.
  app.get('/api/opsx/legacy/jvm/:serverId/:jobId/status', requireAuth, async (req, res) => {
    const serverId = Number(req.params.serverId);
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(serverId) || !Number.isInteger(jobId) || jobId <= 0) {
      return res.status(400).json({ ok: false, message: 'Geçersiz sunucu/iş numarası.' });
    }

    const reqUser = req.session?.user || {};
    try {
      const db = require('../db/index.cjs');
      if (reqUser.role !== 'Admin') {
        const { rows } = await db.query(
          `SELECT TOP 1 username FROM ansible_job_history WHERE job_id = $1 AND awx_server_id = $2`,
          [jobId, serverId]
        );
        if (rows.length && rows[0].username && String(rows[0].username).toLowerCase() !== String(reqUser.username || '').toLowerCase()) {
          return res.status(403).json({ ok: false, message: 'Bu iş size ait değil.' });
        }
      }
    } catch { /* DB hiccup -> fail-open, /job-status ile ayni desen */ }

    try {
      const runner = require('../ansible/runner.cjs');
      const statusInfo = await runner.getJobStatusOnServer(serverId, jobId);
      const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
      if (!TERMINAL.has(statusInfo.status)) {
        return res.json({ ok: true, status: statusInfo.status });
      }
      if (statusInfo.status !== 'successful') {
        return res.json({ ok: true, status: statusInfo.status, message: 'JVM listesi alınamadı (iş başarısız oldu).' });
      }

      const raw = extractOpsxJvmResult(statusInfo.artifacts);
      if (!raw) {
        return res.json({
          ok: true,
          status: statusInfo.status,
          message: 'İş tamamlandı ancak JVM listesi alınamadı — playbook\'un set_stats adımını kontrol edin.',
        });
      }
      res.json({ ok: true, status: statusInfo.status, jvms: raw.results || [] });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // POST /api/opsx/dump/legacy — { application, hosts, dumpType, pidMap }
  app.post('/api/opsx/dump/legacy', requireAuth, express.json({ limit: '64kb' }), async (req, res) => {
    const { application, hosts, dumpType, pidMap } = req.body || {};
    if (!DUMP_TYPES.has(dumpType)) {
      return res.status(400).json({ ok: false, message: 'Geçersiz dump tipi.' });
    }
    const { templateId, serverId, keyName } = await resolveTarget('legacyDump');
    if (!templateId) {
      return res.status(501).json({
        ok: false,
        message: `OpsX Legacy dump işlemi için AWX job template'i henüz tanımlanmadı. `
               + `Yönetici, Admin > Playbook Kayıtları ekranında "${keyName}" satırının `
               + `Template ID alanını doldurmalı.`,
      });
    }

    let requested, jbossVersion;
    try {
      ({ requested, jbossVersion } = await resolveLegacyTargets(application, hosts));
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, message: err.message });
    }

    // pid_map anti-TOCTOU: her anahtar yukarida dogrulanan `requested` host kumesinin bir
    // uyesi OLMALI (host secimiyle PID secimi tutarsiz olamaz). Her oge {pid, jbossMajor}
    // — pid kucuk bir pozitif tamsayi olmali (playbook'ta shell'e enjekte edildigi icin —
    // opsx_openshift_dump.yaml'daki `pods` adi dogrulamasiyla AYNI gerekce), jbossMajor
    // SADECE '7' ya da '8' olabilir (playbook'ta HANGI SABIT JDK yolunun kullanilacagini
    // secer — /usr/jboss/ vs /usr/jboss8/, kullanicinin verdigi GERCEK komutlar).
    if (!pidMap || typeof pidMap !== 'object' || Array.isArray(pidMap) || Object.keys(pidMap).length === 0) {
      return res.status(400).json({ ok: false, message: 'En az bir JVM (host + PID) seçilmeli.' });
    }
    const allowedHosts = new Set(requested);
    const cleanPidMap = {};
    for (const [host, items] of Object.entries(pidMap)) {
      const h = String(host || '').trim().toUpperCase();
      if (!allowedHosts.has(h)) {
        return res.status(400).json({ ok: false, message: `Bu host seçilen sunucular arasında değil: ${host}` });
      }
      if (!Array.isArray(items) || items.length === 0) continue;
      const seen = new Set();
      const cleanItems = [];
      for (const it of items) {
        const pid = String(it?.pid || '').trim();
        const jbossMajor = String(it?.jbossMajor || '').trim();
        if (!/^\d{1,10}$/.test(pid)) {
          return res.status(400).json({ ok: false, message: `Geçersiz PID: ${it?.pid}` });
        }
        if (jbossMajor !== '7' && jbossMajor !== '8') {
          return res.status(400).json({ ok: false, message: `Geçersiz JBoss sürümü: ${it?.jbossMajor}` });
        }
        const dedupeKey = `${pid}:${jbossMajor}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        cleanItems.push({ pid, jbossMajor });
      }
      if (cleanItems.length) cleanPidMap[h] = cleanItems;
    }
    if (Object.keys(cleanPidMap).length === 0) {
      return res.status(400).json({ ok: false, message: 'En az bir JVM (host + PID) seçilmeli.' });
    }

    const opsxDownloads = require('./downloads.cjs');
    const limitValue = requested.join(',');
    const extraVars = {
      application: String(application).trim(),
      dump_type: dumpType,
      staging_dir: opsxDownloads.stagingRoot(),
      pid_map: cleanPidMap,
      ...(jbossVersion ? { jboss_version: jbossVersion } : {}),
    };

    try {
      const runner = require('../ansible/runner.cjs');
      await require('../ansible/template-preflight.cjs')
        .assertTemplateAcceptsExtraVars(serverId, templateId, extraVars, { label: keyName });
      const result = await runner.launchJobOnServer(serverId, templateId, extraVars, limitValue);

      try {
        const db = require('../db/index.cjs');
        await db.query(
          `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            req.session?.user?.username || 'unknown',
            serverId, templateId, `OpsX: Legacy ${dumpType}`,
            result?.jobId, result?.status || 'pending',
            JSON.stringify({ platform: 'legacy-dump', limit: limitValue, ...extraVars }),
          ]
        );
      } catch (e) {
        console.warn('[OpsX] Dump gecmisi kaydedilemedi:', e.message);
      }

      try {
        require('../audit/index.cjs').auditPortal(req, 'opsx_dump', {
          detail: JSON.stringify({ platform: 'legacy', dumpType, limit: limitValue, jobId: result?.jobId ?? null }),
        });
      } catch { /* best-effort */ }

      console.log(`[OpsX] ${req.session?.user?.username} -> legacy dump app=${application} type=${dumpType} limit=${limitValue} template=${templateId} server=${serverId} job=${result?.jobId ?? '?'}`);
      res.json({
        ok: true,
        jobId: result?.jobId ?? null,
        status: result?.status ?? null,
        awxServerId: serverId,
        sentBody: { limit: limitValue, extra_vars: extraVars },
      });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // ── Openshift POD KESFI ────────────────────────────────────────────────────────
  // Pod adlari EFEMERALDIR (her deploy'da degisir) — envanterde tutulamaz, bu yuzden
  // sihirbaz ANLIK bir AWX job'i (opsx_openshift_pods.yaml) tetikleyip namespace'teki
  // pod'lari listeler. Kullanici listeden bir veya birden fazla pod secer, dump o
  // pod'lardan alinir.
  //
  // POST /api/opsx/ocp/pods/discover — { env, tenant, pairs } → { jobId, awxServerId }
  //
  // COKLU NAMESPACE: OcpTargetStep birden fazla (namespace, uygulama) cifti biriktirmeye
  // izin veriyor (restart bunu zaten destekliyordu) — pod kesfi/dump artik TEK bir
  // namespace'e ZORLAMIYOR, `pairs`'teki TUM namespace'lere (VE tenant'a bagli TUM gercek
  // cluster'lara) paralel bakar. `application` alani burada islevsel degil (pod kesfi
  // uygulama adina gore filtrelemiyor) ama HER pair yine de erisim kisitlamasindan
  // (resolveOpenshiftTargets) tek tek gecer.
  app.post('/api/opsx/ocp/pods/discover', requireAuth, express.json({ limit: '16kb' }), async (req, res) => {
    // `clusters` OPSIYONEL: gonderilmezse bugunku davranis (tenant'in TUM gercek
    // cluster'larina paralel baglan) aynen surer. Gonderilirse kesif yalniz o
    // cluster'lara baglanir — daha az `oc login`, daha hizli sonuc, daha kisa pod listesi
    // (2026-08-12 kullanici istegi).
    const { env, tenant, pairs, clusters } = req.body || {};
    const { templateId, serverId, keyName } = await resolveTarget('openshiftPods');
    if (!templateId) {
      return res.status(501).json({
        ok: false,
        message: `OpsX Openshift pod keşfi için AWX job template'i henüz tanımlanmadı. `
               + `Yönetici, Admin > Playbook Kayıtları ekranında "${keyName}" satırının `
               + `Template ID alanını doldurmalı.`,
      });
    }

    // Namespace/tenant dogrulamasi restart/dump ile AYNI kapidan gecer (katalog +
    // erisim kisitlamasi) — kullanici goremedigi bir namespace'in pod'larini listeleyemez.
    let envKey, tenantKey, cleanPairs, clusterNames, fanout;
    try {
      const user = req.session?.user || {};
      ({ envKey, tenantKey, cleanPairs, clusterNames } = await resolveOpenshiftTargets(
        env, tenant, pairs, user
      ));
      // Kullanicinin sectigi alt kume, DB'den az once cozulen listeye karsi dogrulanir.
      const targetClusters = pickClusterSubset(clusters, clusterNames);
      // Bir tenant'a BIRDEN FAZLA gercek cluster bagli olabilir — SECILENLERIN hepsine
      // paralel baglanip pod'un HANGI cluster'da oldugunu gostermek icin (bkz.
      // resolveOcpClusterFanout yorumu) fan-out extra_vars'i kurulur; TEK `oc_cluster`
      // alanina guvenilmez.
      fanout = await resolveOcpClusterFanout(envKey, tenantKey, targetClusters);
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, message: err.message });
    }

    const namespaces = [...new Set(cleanPairs.map((p) => p.namespace))];
    const extraVars = { ...fanout, namespaces };

    try {
      const runner = require('../ansible/runner.cjs');
      await require('../ansible/template-preflight.cjs')
        .assertTemplateAcceptsExtraVars(serverId, templateId, extraVars, { label: keyName });
      const result = await runner.launchJobOnServer(serverId, templateId, extraVars, '');

      // IDOR korumasi /api/opsx/ocp/pods/:serverId/:jobId/status'ta bu kayda bakar.
      try {
        const db = require('../db/index.cjs');
        await db.query(
          `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            req.session?.user?.username || 'unknown',
            serverId, templateId, `OpsX: Openshift pod keşfi`,
            result?.jobId, result?.status || 'pending',
            JSON.stringify({ platform: 'openshift-pods', ...extraVars }),
          ]
        );
      } catch (e) {
        console.warn('[OpsX] Pod kesfi gecmisi kaydedilemedi:', e.message);
      }

      console.log(`[OpsX] ${req.session?.user?.username} -> pod kesfi env=${envKey} tenant=${tenantKey} clusters=${clusterNames.join(',')} namespaces=${namespaces.join(',')} template=${templateId} server=${serverId} job=${result?.jobId ?? '?'}`);
      res.json({ ok: true, jobId: result?.jobId ?? null, status: result?.status ?? null, awxServerId: serverId });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // GET /api/opsx/ocp/pods/:serverId/:jobId/status — job bitince pod listesini doner.
  app.get('/api/opsx/ocp/pods/:serverId/:jobId/status', requireAuth, async (req, res) => {
    const serverId = Number(req.params.serverId);
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(serverId) || !Number.isInteger(jobId) || jobId <= 0) {
      return res.status(400).json({ ok: false, message: 'Geçersiz sunucu/iş numarası.' });
    }

    const reqUser = req.session?.user || {};
    try {
      const db = require('../db/index.cjs');
      if (reqUser.role !== 'Admin') {
        const { rows } = await db.query(
          `SELECT TOP 1 username FROM ansible_job_history WHERE job_id = $1 AND awx_server_id = $2`,
          [jobId, serverId]
        );
        if (rows.length && rows[0].username && String(rows[0].username).toLowerCase() !== String(reqUser.username || '').toLowerCase()) {
          return res.status(403).json({ ok: false, message: 'Bu iş size ait değil.' });
        }
      }
    } catch { /* DB hiccup -> fail-open, /job-status ile ayni desen */ }

    try {
      const runner = require('../ansible/runner.cjs');
      const statusInfo = await runner.getJobStatusOnServer(serverId, jobId);
      const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
      if (!TERMINAL.has(statusInfo.status)) {
        return res.json({ ok: true, status: statusInfo.status });
      }
      if (statusInfo.status !== 'successful') {
        return res.json({ ok: true, status: statusInfo.status, message: 'Pod listesi alınamadı (iş başarısız oldu).' });
      }

      const raw = extractOpsxPodsResult(statusInfo.artifacts);
      if (!raw) {
        return res.json({
          ok: true,
          status: statusInfo.status,
          message: 'İş tamamlandı ancak pod listesi alınamadı — playbook\'un set_stats adımını kontrol edin.',
        });
      }
      // COK-CLUSTER: bir cluster basarisiz olsa bile DIGERLERININ pod'lari gosterilir
      // (block/rescue izolasyonu, bkz. pod-parse.cjs) — sadece HICBIR cluster'dan pod
      // gelmediyse hata olarak raporlanir. Kismi basarida `message` da doner, kullanici
      // hangi cluster'in atlandigini gorur ama bulunan pod'lari yine secebilir.
      const parsed = require('./pod-parse.cjs').parsePodDiscoveryResult(raw);
      if (parsed.pods.length === 0 && parsed.error) {
        return res.json({ ok: true, status: statusInfo.status, message: parsed.error });
      }
      res.json({
        ok: true,
        status: statusInfo.status,
        namespaces: parsed.namespaces,
        pods: parsed.pods,
        ...(parsed.error ? { message: parsed.error } : {}),
      });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // POST /api/opsx/dump/openshift — { env, tenant, namespace, pods: [{cluster,pod}],
  //                                   dumpType, threadDumpCount?, threadDumpInterval? }
  //
  // GERCEK PLAYBOOK SOZLESMESI (bmw_portal/opsx_openshift_dump/opsx_openshift_dump.yaml,
  // get_dump.yaml referans alinarak yazildi): rollout'un `env`/`oc_input` sozlesmesinden
  // FARKLI. Hedefleme POD SEVIYESINDEDIR — kullanici yukaridaki kesif adiminda cikan
  // listeden bir veya birden fazla pod secer (uygulama adi degil). Her pod HANGI gercek
  // cluster'dan geldigini de tasir (kesif artik TUM cluster'lara bakiyor — bkz.
  // resolveOcpClusterFanout) — playbook o cluster'a baglanip dump'i oradan alir. Teslimat
  // LogX'in OCP log-cekme akisiyla AYNI desen: dump'lar pod'lardan cekilir, TEK bir
  // arsivde toplanip staging_dir'e birakilir — opsx_dump_downloads token sistemi Legacy
  // ile AYNI (FTP YOK).
  //
  // Coklu thread dump: YALNIZ thread dump icin dump_count/dump_interval gonderilir
  // (varsayilan 1 dump, beklemesiz). Heap dump'ta bu alanlar HIC gonderilmez.
  //
  // COKLU NAMESPACE: pod'lar artik TEK bir namespace'e sabitlenmez — her pod HANGI
  // namespace'ten geldigini de tasir (`pairs`'teki namespace'lerden biri OLMALI, anti-TOCTOU).
  app.post('/api/opsx/dump/openshift', requireAuth, express.json({ limit: '64kb' }), async (req, res) => {
    const { env, tenant, pairs, pods, dumpType, threadDumpCount, threadDumpInterval } = req.body || {};
    if (!DUMP_TYPES.has(dumpType)) {
      return res.status(400).json({ ok: false, message: 'Geçersiz dump tipi.' });
    }
    const { templateId, serverId, keyName } = await resolveTarget('openshiftDump');
    if (!templateId) {
      return res.status(501).json({
        ok: false,
        message: `OpsX Openshift dump işlemi için AWX job template'i henüz tanımlanmadı. `
               + `Yönetici, Admin > Playbook Kayıtları ekranında "${keyName}" satırının `
               + `Template ID alanını doldurmalı.`,
      });
    }

    let envKey, tenantKey, cleanPairs, clusterNames;
    try {
      const user = req.session?.user || {};
      ({ envKey, tenantKey, cleanPairs, clusterNames } = await resolveOpenshiftTargets(
        env, tenant, pairs, user
      ));
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, message: err.message });
    }
    const allowedNamespaces = new Set(cleanPairs.map((p) => p.namespace));

    // Pod+cluster+namespace ucluleri client'tan gelir ama kesif job'inin ciktisindan
    // secilir — anti-TOCTOU: her cluster adi katalogdan dogrulanmis clusterNames'in, her
    // namespace de yukarida dogrulanmis `pairs`'in bir uyesi OLMALI (Legacy'nin pid_map'teki
    // jbossMajor dogrulamasiyla AYNI gerekce). Pod adi bicimi de dogrulanir — playbook
    // bunlari shell'e gecirdigi icin (oc exec) Kubernetes ad sozdizimi disinda bir sey
    // KABUL EDILMEZ.
    if (!Array.isArray(pods) || pods.length === 0) {
      return res.status(400).json({ ok: false, message: 'En az bir pod seçilmeli.' });
    }
    const allowedClusters = new Set(clusterNames);
    const podNameRe = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/i;
    const seen = new Set();
    const cleanPodTargets = [];
    for (const p of pods) {
      const cluster = String(p?.cluster || '').trim();
      const namespace = String(p?.namespace || '').trim();
      const pod = String(p?.pod || '').trim();
      if (!allowedClusters.has(cluster)) {
        return res.status(400).json({ ok: false, message: `Bu cluster seçilen tenant altında değil: ${p?.cluster}` });
      }
      if (!allowedNamespaces.has(namespace)) {
        return res.status(400).json({ ok: false, message: `Bu namespace seçilenler arasında değil: ${p?.namespace}` });
      }
      if (!podNameRe.test(pod) || pod.length > 253) {
        return res.status(400).json({ ok: false, message: `Geçersiz pod adı: ${p?.pod}` });
      }
      const key = `${cluster}::${namespace}::${pod}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cleanPodTargets.push({ cluster, namespace, pod });
    }
    if (cleanPodTargets.length === 0) {
      return res.status(400).json({ ok: false, message: 'En az bir pod seçilmeli.' });
    }

    // Sadece secili pod'larin kapsadigi cluster'lara login acilir — kullanicinin
    // gormedigi/secmedigi diger cluster'lara gereksiz baglanti YOK.
    const neededClusters = [...new Set(cleanPodTargets.map((t) => t.cluster))];
    let fanout;
    try {
      fanout = await resolveOcpClusterFanout(envKey, tenantKey, neededClusters);
    } catch (err) {
      return res.status(err.status || 500).json({ ok: false, message: err.message });
    }

    const opsxDownloads = require('./downloads.cjs');
    const extraVars = {
      ...fanout,
      ocp_pod_targets: cleanPodTargets.map((t) => ({ cluster_name: t.cluster, namespace: t.namespace, pod: t.pod })),
      choose: dumpType === 'heapdump' ? 'memory' : 'cpu',
      staging_dir: opsxDownloads.stagingRoot(),
    };

    // Coklu thread dump — playbook'taki AYNI sinirlar (1-100 adet, 0-3600 sn).
    if (dumpType === 'threaddump') {
      const count = Number(threadDumpCount ?? 1);
      const interval = Number(threadDumpInterval ?? 0);
      if (!Number.isInteger(count) || count < 1 || count > 100) {
        return res.status(400).json({ ok: false, message: 'Thread dump adedi 1-100 arasında olmalı.' });
      }
      if (!Number.isInteger(interval) || interval < 0 || interval > 3600) {
        return res.status(400).json({ ok: false, message: 'Thread dump aralığı 0-3600 saniye arasında olmalı.' });
      }
      extraVars.dump_count = count;
      extraVars.dump_interval = interval;
    }

    try {
      const runner = require('../ansible/runner.cjs');
      await require('../ansible/template-preflight.cjs')
        .assertTemplateAcceptsExtraVars(serverId, templateId, extraVars, { label: keyName });
      const result = await runner.launchJobOnServer(serverId, templateId, extraVars, '');

      try {
        const db = require('../db/index.cjs');
        await db.query(
          `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            req.session?.user?.username || 'unknown',
            serverId, templateId, `OpsX: Openshift ${dumpType}`,
            result?.jobId, result?.status || 'pending',
            JSON.stringify({ platform: 'openshift-dump', ...extraVars }),
          ]
        );
      } catch (e) {
        console.warn('[OpsX] Dump gecmisi kaydedilemedi:', e.message);
      }

      try {
        require('../audit/index.cjs').auditPortal(req, 'opsx_dump', {
          detail: JSON.stringify({ platform: 'openshift', dumpType, extraVars, jobId: result?.jobId ?? null }),
        });
      } catch { /* best-effort */ }

      console.log(`[OpsX] ${req.session?.user?.username} -> openshift dump env=${envKey} tenant=${tenantKey} clusters=${neededClusters.join(',')} type=${dumpType} template=${templateId} server=${serverId} job=${result?.jobId ?? '?'}`);
      res.json({
        ok: true,
        jobId: result?.jobId ?? null,
        status: result?.status ?? null,
        awxServerId: serverId,
        sentBody: { extra_vars: extraVars },
      });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // GET /api/opsx/dump/:serverId/:jobId/status — job terminal + basariliysa
  // artifacts.opsx_dump_result okunur, her basarili sonuc icin bir indirme token'i
  // uretilir. IDOR korumasi /api/opsx/job-status ile AYNI desen (ansible_job_history'de
  // sahiplik kontrolu).
  app.get('/api/opsx/dump/:serverId/:jobId/status', requireAuth, async (req, res) => {
    const serverId = Number(req.params.serverId);
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(serverId) || !Number.isInteger(jobId) || jobId <= 0) {
      return res.status(400).json({ ok: false, message: 'Geçersiz sunucu/iş numarası.' });
    }

    const reqUser = req.session?.user || {};
    try {
      const db = require('../db/index.cjs');
      if (reqUser.role !== 'Admin') {
        const { rows } = await db.query(
          `SELECT TOP 1 username FROM ansible_job_history WHERE job_id = $1 AND awx_server_id = $2`,
          [jobId, serverId]
        );
        if (rows.length && rows[0].username && String(rows[0].username).toLowerCase() !== String(reqUser.username || '').toLowerCase()) {
          return res.status(403).json({ ok: false, message: 'Bu iş size ait değil.' });
        }
      }
    } catch { /* DB hiccup -> fail-open, /job-status ile ayni desen */ }

    try {
      const runner = require('../ansible/runner.cjs');
      const statusInfo = await runner.getJobStatusOnServer(serverId, jobId);
      const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
      if (!TERMINAL.has(statusInfo.status)) {
        return res.json({ ok: true, status: statusInfo.status });
      }
      if (statusInfo.status !== 'successful') {
        return res.json({ ok: true, status: statusInfo.status, message: 'İşlem başarısız oldu.' });
      }

      const dumpResult = extractOpsxDumpResult(statusInfo.artifacts);
      if (!dumpResult) {
        return res.json({
          ok: true,
          status: statusInfo.status,
          message: 'İşlem tamamlandı ancak sonuç alınamadı — playbook\'un set_stats adımını kontrol edin.',
        });
      }

      const opsxDownloads = require('./downloads.cjs');
      const results = [];
      for (const r of (dumpResult.results || [])) {
        if (r.ok && r.staged_path && r.filename) {
          const { token } = await opsxDownloads.issueDownloadToken({
            username: reqUser.username || 'unknown',
            awxServerId: serverId,
            awxJobId: jobId,
            stagedPath: r.staged_path,
            filename: r.filename,
            sizeBytes: r.size_bytes,
          });
          results.push({ ...r, downloadToken: token });
        } else {
          results.push(r);
        }
      }
      res.json({ ok: true, status: statusInfo.status, results });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // GET /api/opsx/dump/download/:token — server/opsx/downloads.cjs'e delege eder.
  app.get('/api/opsx/dump/download/:token', requireAuth, async (req, res) => {
    await require('./downloads.cjs').handleDownloadRoute(req, res);
  });

  console.log('[OpsX] endpoints mounted at /api/opsx');
}

module.exports = {
  initOpsX, hostsForApp, ALLOWED_OPERATIONS, namespacesForCluster,
  extractOpsxDumpResult, extractOpsxPodsResult, extractOpsxJvmResult,
  // Testler icin: cluster alt kumesi dogrulamasi (anti-TOCTOU) route disinda da
  // dogrulanabilsin — HTTP katmani olmadan.
  pickClusterSubset,
};
