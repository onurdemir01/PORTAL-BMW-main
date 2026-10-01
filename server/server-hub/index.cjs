// server/server-hub/index.cjs - Server Hub (2026-09-21).
//
// Kullanici: "sunucu reboot oldugunda her sey dogru acilacak mi ve sunucularda atil bir sey var
// mi" — gunluk tarama (bmw_automation_folder/server_hub) dbo.Server_Hub_* tablolarina yazar;
// burasi son taramayi okur, assess.cjs ile bulguya cevirir, "simdi tara" (tek sunucu, reboot
// oncesi) ve "duzelt" (tek sunucu, tek eylem; ONCE PLAN, sonra onay) islerini AWX'te tetikler.
//
// Yetki: sayfa Admin'e seed'li; uclar da Admin'e kapali (Nginx Hub deseni). Duzeltme yalniz
// Admin ve yalniz assess'in urettigi eylem/parametrelerle (client istedigi komutu gonderemez).
'use strict';

const express = require('express');
const { assess, flattenFindings } = require('./assess.cjs');

const REGISTRY_KEYS = Object.freeze({ scan: 'server_hub_scan', fix: 'server_hub_fix' });
const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,62}$/;
const FIX_ACTIONS = new Set([
  'jboss_autostart_on',
  'jboss_autostart_off',
  'jboss_retire',
  'apache_comment_line',
  'apache_retire_vhost',
]);

// Son degerlendirme onbellegi (tum filo icin 7 tablo okumak 1-2 sn; ekran her acilista yeniden
// okumasin). 60 sn; ?fresh=1 ve is bitisleri atlar.
let _cache = { at: 0, value: null };
const CACHE_MS = 60 * 1000;

async function loadLatest() {
  const { query } = require('../inventory/mssql.cjs');
  const ex = await query(`SELECT OBJECT_ID('dbo.Server_Hub_Hosts') AS oid`);
  if (!ex.recordset?.[0]?.oid) return { tableMissing: true, data: null };
  // her sunucunun SON taramasi (gun): Hosts tablosundaki max scan_date
  const q = (table) =>
    query(
      `SELECT t.* FROM ${table} t
       JOIN (SELECT host, MAX(scan_date) AS d FROM dbo.Server_Hub_Hosts GROUP BY host) m
         ON m.host = t.host AND m.d = t.scan_date`,
    ).then((r) => r.recordset || []);
  // JVM GERCEGI (kullanici, 2026-09-22): "JVM bilgilerini middleware_applications_inventory/jboss
  // job'inin veritabanindan cek." dbo.MWAppsInventory uygulama basina satir tutar: status
  // (running/stopped), jvm_count, autostarts ("true false ..."), env, tier. Server Hub'in kendi CLI
  // taramasiyla BIRLESTIRILIR: CLI yoksa envanter, ikisi de varsa celiski bulgusu.
  const mwApps = await query(
    `SELECT host, app, env, domain, status, jvm_count, autostarts, tier FROM dbo.MWAppsInventory WHERE host IS NOT NULL AND app IS NOT NULL`,
  )
    .then((r) => r.recordset || [])
    .catch(() => []);
  // URUN KAYNAGI ENVANTER (kullanici, 2026-09-24): "hangi sunucuda hangi urun var" dbo.Inventory'den
  // gelir; tarama sonucu CANLI durumdur. Ikisi ayri tutulur ve ORTUSMEYENLER bulgu olur - tarama bir
  // urunu goremediyse (yetki/yol) sessizce "urun yok" demek yerine kapsam farki raporlanir.
  // Kolon adlari kuruluma gore degisebildigi icin once sys.columns'a bakilir; olmayan kolon sorguya
  // girmez (eksik kolon tum sorguyu dusururdu).
  const invCols = await query(
    `SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Inventory')`,
  )
    .then((r) => (r.recordset || []).map((c) => String(c.name)))
    .catch(() => []);
  const hasCol = (n) => invCols.some((c) => c.toLowerCase() === n.toLowerCase());
  const PRODUCT_COLS = [
    { col: 'nginx_version', product: 'NGINX' },
    { col: 'ihs_version', product: 'IHS' },
    { col: 'apache_version', product: 'RHA' },
    { col: 'httpd_version', product: 'RHA' },
    { col: 'jboss_version', product: 'JBOSS' },
    { col: 'was_version', product: 'WAS' },
  ].filter((x) => hasCol(x.col));
  const invSelect = ['host', hasCol('env') ? 'env' : null, ...PRODUCT_COLS.map((x) => x.col)]
    .filter(Boolean)
    .join(', ');
  const invEnv = await query(`SELECT ${invSelect} FROM dbo.Inventory WHERE host IS NOT NULL`)
    .then((r) =>
      (r.recordset || []).map((row) => {
        const products = [];
        for (const { col, product } of PRODUCT_COLS) {
          const v = row[col] == null ? '' : String(row[col]).trim();
          if (v && !products.includes(product)) products.push(product);
        }
        return { host: row.host, env: row.env, invProducts: products };
      }),
    )
    .catch(() => []);
  const [hosts, init, jboss, jvms, web, vhosts, ips, sshd] = await Promise.all([
    q('dbo.Server_Hub_Hosts'),
    q('dbo.Server_Hub_Init'),
    q('dbo.Server_Hub_Jboss'),
    q('dbo.Server_Hub_Jvms'),
    q('dbo.Server_Hub_Web'),
    q('dbo.Server_Hub_Vhosts'),
    q('dbo.Server_Hub_Ips'),
    q('dbo.Server_Hub_Sshd').catch(() => []), // tablo eski taramada yoksa
  ]);
  return {
    tableMissing: false,
    data: { hosts, init, jboss, jvms, web, vhosts, ips, sshd, mwApps, invEnv },
  };
}

async function getAssessment(fresh) {
  if (!fresh && _cache.value && Date.now() - _cache.at < CACHE_MS) return _cache.value;
  const { tableMissing, data } = await loadLatest();
  const value = tableMissing
    ? { tableMissing: true, hosts: [], summary: null, latestScan: null }
    : { tableMissing: false, ...assess(data) };
  _cache = { at: Date.now(), value };
  return value;
}

// Yanit sekli: sunucu listesi HAFIF (bulgu sayilari + urunler), ayrinti /host/:host ile.
function hostRow(h) {
  return {
    host: h.host,
    scanDate: h.scanDate,
    products: h.products,
    status: h.status,
    counts: h.counts,
    env: h.env,
    envGroup: h.envGroup,
    hostClass: h.hostClass || 'genel',
    wallS: h.wallS,
    cpuS: h.cpuS,
    jvms: h.jvms.length,
    jvmsRunning: h.jvms.filter((j) => j.running).length,
    vhosts: h.vhosts.length,
    unusedIps: h.ips.filter((i) => i.usedBy === 'none' && !i.primary).length,
    topFinding:
      h.findings
        .slice()
        .sort(
          (a, b) =>
            (({ danger: 3, warning: 2, info: 1 })[b.severity] || 0) -
            ({ danger: 3, warning: 2, info: 1 }[a.severity] || 0),
        )[0]?.text || null,
  };
}

function hostDetail(h) {
  return {
    ...hostRow(h),
    findings: h.findings,
    init: h.init,
    jboss: h.jboss,
    jvms: h.jvms.map((j) => ({
      ...j,
      vhosts: j.vhosts.map((m) => ({
        host: m.host,
        product: m.v.product,
        serverName: m.v.serverName,
        req24h: m.v.req24h,
        req7d: m.v.req7d,
        hc24h: m.v.hc24h,
        sampled: m.v.sampled,
      })),
    })),
    web: h.web,
    vhosts: h.vhosts.map((v) => ({ ...v, proxyTargets: v.proxyTargetsRaw })),
    ips: h.ips,
    sshd: h.sshd,
  };
}

// ── AWX ─────────────────────────────────────────────────────────────────────────
async function resolveByKey(keyName) {
  const reg = require('../ansible/playbook-registry.cjs');
  const row = await reg.getByKey(keyName).catch(() => null);
  if (!row || row.enabled === false) return { templateId: null, serverId: null };
  return {
    templateId: reg.getEffectiveTemplateId(row) || null,
    serverId: row.awxServerId != null ? Number(row.awxServerId) : 0,
  };
}

async function launch(req, keyName, templateName, extraVars, detail) {
  const { templateId, serverId } = await resolveByKey(keyName);
  if (!templateId) {
    throw Object.assign(
      new Error(
        `AWX job template'i tanımlı değil: Admin › Playbook Kayıtları › "${keyName}" satırına Template ID girilmeli.`,
      ),
      { status: 501 },
    );
  }
  const runner = require('../ansible/runner.cjs');
  await require('../ansible/template-preflight.cjs').assertTemplateAcceptsExtraVars(
    serverId,
    templateId,
    extraVars,
    { label: keyName },
  );
  const user = req.session?.user || {};
  const result = await runner.launchJobOnServer(serverId, templateId, extraVars, '', user);
  try {
    const db = require('../db/index.cjs');
    await db.query(
      `INSERT INTO ansible_job_history (username, awx_server_id, template_id, template_name, job_id, status, params) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        user.username || 'unknown',
        serverId,
        templateId,
        templateName,
        result?.jobId,
        result?.status || 'pending',
        JSON.stringify(extraVars),
      ],
    );
  } catch (e) {
    console.warn('[ServerHub] job gecmisi yazilamadi:', e.message);
  }
  try {
    require('../audit/index.cjs').auditPortal(req, 'server_hub', {
      detail: JSON.stringify({ ...detail, jobId: result?.jobId ?? null }),
    });
  } catch {
    /* best-effort */
  }
  return { jobId: result?.jobId ?? null, status: result?.status ?? null, awxServerId: serverId };
}

const isAdmin = (req) => req.session?.user?.role === 'Admin';

function initServerHub(app) {
  const { requireAuth } = require('../auth/index.cjs');
  const router = express.Router();
  router.use(express.json({ limit: '256kb' }));
  router.use(requireAuth);
  router.use((req, res, next) =>
    isAdmin(req)
      ? next()
      : res.status(403).json({ ok: false, message: 'Server Hub yalnız Admin.' }),
  );
  try {
    const { requireVisiblePrefix } = require('../auth/visibility.cjs');
    router.use(requireVisiblePrefix('ServerHub'));
  } catch {
    /* motor yoksa yoksay */
  }

  router.get('/overview', async (req, res) => {
    try {
      const a = await getAssessment(req.query.fresh === '1');
      if (a.tableMissing)
        return res.json({
          ok: true,
          tableMissing: true,
          message: "dbo.Server_Hub_* tabloları henüz yok — server_hub_scan job'ı bir kez koşmalı.",
          hosts: [],
          summary: null,
          latestScan: null,
        });
      res.json({
        ok: true,
        tableMissing: false,
        latestScan: a.latestScan,
        summary: a.summary,
        hosts: a.hosts.map(hostRow),
      });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message || 'Server Hub verisi alınamadı.' });
    }
  });

  // Bulgular (2026-09-22): "init/apache sozdizimi sorunlarini toplu liste olarak nasil gorurum?"
  // Tum sunucularin bulgulari tek listede; istemci suzer (alan/kod/onem/urun), CSV verir.
  router.get('/findings', async (req, res) => {
    try {
      const a = await getAssessment(req.query.fresh === '1');
      if (a.tableMissing)
        return res.json({ ok: true, tableMissing: true, findings: [], latestScan: null });
      res.json({
        ok: true,
        tableMissing: false,
        latestScan: a.latestScan,
        findings: flattenFindings(a.hosts),
      });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message || 'Bulgular alınamadı.' });
    }
  });

  router.get('/host/:host', async (req, res) => {
    const host = String(req.params.host || '').toUpperCase();
    if (!HOST_RE.test(host))
      return res.status(400).json({ ok: false, message: 'Geçersiz sunucu adı.' });
    try {
      const a = await getAssessment(req.query.fresh === '1');
      const h = a.hosts.find((x) => x.host === host);
      if (!h)
        return res.status(400).json({ ok: false, message: `${host} için tarama verisi yok.` });
      res.json({ ok: true, host: hostDetail(h) });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  // Tek sunucu (reboot oncesi) tarama: target_hosts ile; loader o sunucunun bugunku satirlarini yeniler.
  router.post('/scan', async (req, res) => {
    const hosts = [
      ...new Set(
        (Array.isArray(req.body?.hosts) ? req.body.hosts : [])
          .map((h) =>
            String(h || '')
              .trim()
              .toUpperCase(),
          )
          .filter(Boolean),
      ),
    ];
    if (!hosts.length || hosts.length > 50 || hosts.some((h) => !HOST_RE.test(h)))
      return res.status(400).json({ ok: false, message: '1-50 arası geçerli sunucu adı gerekli.' });
    try {
      const r = await launch(
        req,
        REGISTRY_KEYS.scan,
        `Server Hub: tara ${hosts.length === 1 ? hosts[0] : hosts.length + ' sunucu'}`,
        { target_hosts: hosts.join(',') },
        { op: 'scan', hosts },
      );
      res.json({ ok: true, ...r });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // Duzelt: yalniz assess'in urettigi eylemler (sunucu tarafinda yeniden turetilir, client'a guvenilmez).
  // plan_only=true -> PLAN (degisiklik yok); confirmed=true -> uygular.
  router.post('/fix', async (req, res) => {
    const host = String(req.body?.host || '').toUpperCase();
    const code = String(req.body?.code || '');
    const fixKey = String(req.body?.fixKey || '');
    const confirmed = req.body?.confirmed === true;
    const reload = req.body?.reload === true;
    if (!HOST_RE.test(host))
      return res.status(400).json({ ok: false, message: 'Geçersiz sunucu adı.' });
    try {
      const a = await getAssessment(true);
      const h = a.hosts.find((x) => x.host === host);
      if (!h)
        return res.status(400).json({ ok: false, message: `${host} için tarama verisi yok.` });
      const finding = h.findings.find(
        (f) => f.fix && f.code === code && JSON.stringify(f.fix) === fixKey,
      );
      if (!finding)
        return res
          .status(400)
          .json({
            ok: false,
            message:
              'Bu bulgu için tanımlı bir düzeltme yok ya da tarama verisi değişti — sayfayı yenileyin.',
          });
      const fix = finding.fix;
      if (!FIX_ACTIONS.has(fix.action))
        return res.status(400).json({ ok: false, message: 'Bilinmeyen eylem.' });
      const extraVars = { target_host: host, action: fix.action, plan_only: !confirmed, reload };
      for (const k of ['gen', 'jvm', 'product', 'file', 'line', 'server_name'])
        if (fix[k] != null) extraVars[k] = fix[k];
      const r = await launch(
        req,
        REGISTRY_KEYS.fix,
        `Server Hub: ${confirmed ? 'düzelt' : 'plan'} ${fix.action} @ ${host}`,
        extraVars,
        { op: confirmed ? 'fix' : 'plan', host, code, fix },
      );
      res.json({ ok: true, ...r, planOnly: !confirmed });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // ── TOPLU AUTO-START DÜZELTMESİ (kullanıcı, 2026-09-28) ─────────────────────────────
  // "auto-start'ı kapalı olup JVM process'i açık olan TÜM bulguları tek tuşla aç" ve
  // tersi: "auto-start'ı açık olup process'i kapalı olanları tek tuşla kapat".
  //
  // ÖNCE PLAN, SONRA ONAY (kullanıcının seçimi): plan HİÇBİR İŞ BAŞLATMAZ — liste zaten
  // ── SATIR BAZINDA JVM AUTO-START (kullanici, 2026-10-01) ───────────────────────────
  // "Ben oraya girdigim zaman satir satir hangi jvm'lerde auto start kapaliysa onun
  // saginda bir buton olsun ben tikladigimda acilsin veya ben tikladigimda kapansin."
  //
  // `/fix`ten FARKI: orasi BULGU bazlidir - yalniz bir bulgu uretmis JVM'ler duzeltilebilir
  // (kosan ama auto-start kapali / kapali ama auto-start acik). Kullanici ise HER satirda
  // dugme istiyor, bulgu olsun olmasin.
  //
  // HEDEF TARAMADAN DOGRULANIR: host/gen/jvm uclusu son taramada GERCEKTEN var mi diye
  // bakilir. Istemciden gelen bir JVM adini dogrudan playbook'a gecirmek, extra_vars
  // uzerinden keyfi hedef secmeye acik kapi birakirdi.
  //
  // TOPLU YOK: bu uc TEK (host, jvm) alir. Duzeltme playbook'u da virgullu hedef listesini
  // BILEREK reddeder; o koruma 2026-09-28'de toplu uc tarafindan deliniyordu, kaldirildi.
  const JVM_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

  router.post('/jvm-autostart', async (req, res) => {
    const host = String(req.body?.host || '').toUpperCase();
    const jvm = String(req.body?.jvm || '').trim();
    const gen = Number(req.body?.gen);
    const enable = req.body?.enable === true;
    // ACIK ONAY SART: istemciden kazara gelen bir istek sunucuda bir sey DEGISTIRMEMELI.
    if (req.body?.confirmed !== true)
      return res
        .status(400)
        .json({ ok: false, message: 'Bu işlem açık onay ister (confirmed).' });
    if (!HOST_RE.test(host))
      return res.status(400).json({ ok: false, message: 'Geçersiz sunucu adı.' });
    if (!JVM_RE.test(jvm))
      return res.status(400).json({ ok: false, message: 'Geçersiz JVM adı.' });
    if (!Number.isInteger(gen))
      return res.status(400).json({ ok: false, message: 'Geçersiz JBoss sürümü (gen).' });
    try {
      const a = await getAssessment(true);
      const h = (a.hosts || []).find((x) => x.host === host);
      if (!h)
        return res.status(400).json({ ok: false, message: `${host} için tarama verisi yok.` });
      const j = (h.jvms || []).find((x) => x.name === jvm && Number(x.gen) === gen);
      if (!j)
        return res.status(400).json({
          ok: false,
          message: `${host} üzerinde ${jvm} (JBoss ${gen}) taramada yok — sayfayı yenileyin.`,
        });
      // ZATEN ISTENEN DURUMDAYSA IS ACILMAZ. "unknown" ise ACILIR: olculemedigi icin
      // kullanici bilerek bir tarafa cekmek isteyebilir.
      const hedef = enable ? 'true' : 'false';
      if (j.autoStart === hedef)
        return res.status(400).json({
          ok: false,
          message: `${jvm} zaten auto-start ${enable ? 'AÇIK' : 'KAPALI'} görünüyor — iş açılmadı.`,
        });
      const action = enable ? 'jboss_autostart_on' : 'jboss_autostart_off';
      if (!FIX_ACTIONS.has(action))
        return res.status(400).json({ ok: false, message: 'Bilinmeyen eylem.' });
      const r = await launch(
        req,
        REGISTRY_KEYS.fix,
        `Server Hub: ${action} @ ${host}/${jvm}`,
        { target_host: host, action, plan_only: false, reload: false, gen, jvm },
        { op: 'jvm-autostart', host, fix: { action, gen, jvm } },
      );
      res.json({ ok: true, ...r, action, host, jvm, gen });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  // TOPLU DUZELTME KALDIRILDI (kullanici, 2026-10-01): "jboss jvm auto start da toplu ac
  // toplu kapat sakin getirme o cok riskli... toplu islem sakin olmasin cok tehlikeli."
  //
  // Tek tiklamayla yuzlerce sunucuda auto-start degistirmek, yanlis bir taramanin
  // sonucunu da yuzlerce sunucuya yayardi. Dogrusu satir bazinda tek tek onay:
  // `POST /fix` ZATEN bunu yapiyor (tek host + tek JVM) ve duzeltme playbook'u virgullu
  // hedef listesini BILEREK reddediyor. Toplu uc o korumayi N kez cagirarak deliyordu.
  //
  // Geri getirmek isteyen once su soruyu cevaplasin: yanlis bir tarama sonucu kac
  // sunucuya yayilir?

  router.get('/job-status/:serverId/:jobId', async (req, res) => {
    const serverId = Number(req.params.serverId);
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(serverId) || !Number.isInteger(jobId) || jobId <= 0)
      return res.status(400).json({ ok: false, message: 'Geçersiz iş numarası.' });
    try {
      const runner = require('../ansible/runner.cjs');
      const [statusInfo, outputInfo] = await Promise.all([
        runner.getJobStatusOnServer(serverId, jobId),
        runner.getJobOutputOnServer(serverId, jobId),
      ]);
      const TERMINAL = new Set(['successful', 'failed', 'error', 'canceled']);
      let result = null;
      if (TERMINAL.has(statusInfo.status)) {
        const { extractStatsKey } = require('../opsx/index.cjs');
        result =
          extractStatsKey(statusInfo.artifacts, 'server_hub_fix_result') ||
          extractStatsKey(statusInfo.artifacts, 'server_hub_scan_result') ||
          null;
        _cache = { at: 0, value: null }; // tarama/duzeltme bitti -> sonraki okuma taze
      }
      res.json({ ok: true, status: statusInfo.status, output: outputInfo.output || '', result });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

  app.use('/api/server-hub', router);
  console.log('[ServerHub] mounted at /api/server-hub');
}

module.exports = { initServerHub, REGISTRY_KEYS, FIX_ACTIONS, HOST_RE, hostRow, hostDetail };
