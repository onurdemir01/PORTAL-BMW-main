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
const { assess, flattenFindings, parseTargets, hedefUserinfoSil } = require('./assess.cjs');
const { maskText, maskJvmArgs, maskJvmArgDiff } = require('./mask.cjs');

// ── KOLON LISTELERI (sozlesme v3 P9) ───────────────────────────────────────────────
// Yildizli (tum kolon) SELECT YOK. Her tablo icin BEKLENEN kolonlar (sozlesme kayit_tipleri + DDL) ile
// tablodaki MEVCUT kolonlarin kesisimi secilir; mevcut kolonlar TEK sys.columns sorgusundan
// gelir. Boylece DDL henuz kosmamis eski 8 tablolu semada da uclar dusmez (eksik kolon JS'te
// null okunur). Eskiden Hosts/Jvms/Web/Vhosts sorgularinda catch yoktu; tek "Invalid column
// name" tum Promise.all'i reddederdi.
const SH_KOLONLAR = Object.freeze({
  'dbo.Server_Hub_Hosts': [
    'host', 'scan_date', 'products', 'wall_s', 'cpu_s', 'note',
    'scan_ver', 'rec_counts', 'scan_errors', 'proc_visibility', 'sock_visibility', 'loaded_at',
  ],
  'dbo.Server_Hub_Init': ['host', 'scan_date', 'root', 'file', 'status', 'sha512'],
  'dbo.Server_Hub_Jboss': [
    'host', 'scan_date', 'gen', 'host_name', 'host_state', 'cli', 'note',
    'mgmt_cfg', 'mgmt_state', 'cli_rescue', 'cli_run_as', 'host_config', 'dc_role',
  ],
  // FILO sorgusu: jvm_args / configured_jvm_args / jvm_arg_diff YOK (agir; yalniz tek
  // sunucu ayrintisinda, maskeli - JVM_AGIR_KOLONLAR).
  'dbo.Server_Hub_Jvms': [
    'host', 'scan_date', 'gen', 'jvm', 'grp', 'running', 'auto_start', 'server_state', 'ports',
    'running_src', 'cfg_src', 'state_src', 'config_changed', 'config_risk',
    'config_mtime_epoch', 'process_start_epoch', 'os_startup', 'reboot_expected',
    'reboot_status', 'cfg_ports', 'cfg_ports_src', 'jvm_arg_status', 'jvm_args_src',
  ],
  'dbo.Server_Hub_Web': [
    'host', 'scan_date', 'product', 'running', 'syntax', 'detail',
    'check_class', 'syntax_verification', 'run_as', 'check_rc', 'vhost_trust', 'running_src',
  ],
  'dbo.Server_Hub_Vhosts': [
    'host', 'scan_date', 'product', 'listen', 'server_name', 'aliases', 'access_log',
    'proxy_targets', 'req_24h', 'req_7d', 'hc_24h', 'shared', 'sampled', 'conf_file',
    'traffic_state', 'traffic_reason', 'cover_from_epoch', 'last_req_epoch',
    'last_line_epoch', 'log_read_as',
  ],
  'dbo.Server_Hub_Ips': ['host', 'scan_date', 'ip', 'iface', 'used_by', 'is_primary'],
  'dbo.Server_Hub_Sshd': ['host', 'scan_date', 'max_sessions', 'max_startups', 'active_sessions'],
});
const JVM_AGIR_KOLONLAR = Object.freeze(['jvm_args', 'configured_jvm_args', 'jvm_arg_diff']);
// sys.columns OKUNAMAZSA yalniz eski semanin kolonlari secilir - bunlar her zaman var.
// KAPALI KALIR (C3): SQL Server'da yetkisiz sys.columns hata atmaz (satirlari suzer); bu
// dal pratikte GECICI hatada (zaman asimi, kilitlenme, baglanti) calisir. O zaman
// running_src / scan_ver / vhost_trust secilmez ve v3 UNMEASURED JVM "kapali" okunurdu.
// loadLatest bu durumda data.schemaUnknown=true isaretler: assess HICBIR eylem onermez,
// running=0 bilinmiyor sayilir, geri alma serbest denmez; sonuc ONBELLEGE ALINMAZ.
const SH_ESKI_KOLONLAR = Object.freeze({
  'dbo.Server_Hub_Hosts': ['host', 'scan_date', 'products', 'wall_s', 'cpu_s', 'note'],
  'dbo.Server_Hub_Init': ['host', 'scan_date', 'root', 'file', 'status', 'sha512'],
  'dbo.Server_Hub_Jboss': ['host', 'scan_date', 'gen', 'host_name', 'host_state', 'cli', 'note'],
  'dbo.Server_Hub_Jvms': [
    'host', 'scan_date', 'gen', 'jvm', 'grp', 'running', 'auto_start', 'server_state', 'ports',
  ],
  'dbo.Server_Hub_Web': ['host', 'scan_date', 'product', 'running', 'syntax', 'detail'],
  'dbo.Server_Hub_Vhosts': [
    'host', 'scan_date', 'product', 'listen', 'server_name', 'aliases', 'access_log',
    'proxy_targets', 'req_24h', 'req_7d', 'hc_24h', 'shared', 'sampled', 'conf_file',
  ],
  'dbo.Server_Hub_Ips': ['host', 'scan_date', 'ip', 'iface', 'used_by', 'is_primary'],
  'dbo.Server_Hub_Sshd': ['host', 'scan_date', 'max_sessions', 'max_startups', 'active_sessions'],
});

/**
 * Server_Hub tablolarinin mevcut kolonlari, TEK sys.columns sorgusuyla.
 * @returns {Promise<{ ok: boolean, cols: Map<string, Set<string>> }>}  ok=false: okunamadi
 */
async function shKolonlari(query) {
  const tablolar = Object.keys(SH_KOLONLAR);
  const ids = tablolar.map((t) => `OBJECT_ID('${t}')`).join(', ');
  try {
    const r = await query(
      `SELECT OBJECT_NAME(c.object_id) AS tbl, c.name AS name FROM sys.columns c WHERE c.object_id IN (${ids})`,
    );
    const cols = new Map();
    for (const row of r.recordset || []) {
      const t = `dbo.${String(row.tbl)}`.toLowerCase();
      if (!cols.has(t)) cols.set(t, new Set());
      cols.get(t).add(String(row.name).toLowerCase());
    }
    return { ok: true, cols };
  } catch {
    return { ok: false, cols: new Map() };
  }
}

/** Beklenen (SPEC) kolonlarin tabloda MEVCUT olanlari. Tablo yoksa []. */
function secilecekKolonlar(tablo, kol, beklenen) {
  if (!kol.ok) return SH_ESKI_KOLONLAR[tablo] || [];
  const var_ = kol.cols.get(tablo.toLowerCase());
  if (!var_) return [];
  return beklenen.filter((c) => var_.has(c.toLowerCase()));
}

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
  const kol = await shKolonlari(query);
  // her sunucunun SON taramasi (gun): Hosts tablosundaki max scan_date. Kolonlar acikca
  // (sys.columns ile kesisim); [koseli] ad: 'file' SQL Server'da ayrilmis sozcuk.
  const q = (table) => {
    const cols = secilecekKolonlar(table, kol, SH_KOLONLAR[table]);
    if (!cols.length) return Promise.resolve([]);
    return query(
      `SELECT ${cols.map((c) => `t.[${c}]`).join(', ')} FROM ${table} t
       JOIN (SELECT host, MAX(scan_date) AS d FROM dbo.Server_Hub_Hosts GROUP BY host) m
         ON m.host = t.host AND m.d = t.scan_date`,
    ).then((r) => r.recordset || []);
  };
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
    // RHA SUTUNU `rha_version` (2026-10-01'de uretimde OLCULDU). Burada once
    // `apache_version` / `httpd_version` yaziyordu; IKISI DE dbo.Inventory'de YOK, bu
    // yuzden RHA envanteri her zaman 0 okunuyordu. Tablonun gercek sutunlari:
    //   ihs_version · jboss_version · nginx_version · rha_version · was_version · ctg_version
    { col: 'rha_version', product: 'RHA' },
    { col: 'jboss_version', product: 'JBOSS' },
    { col: 'was_version', product: 'WAS' },
  ];
  // HANGI URUNUN ENVANTER SUTUNU YOK (2026-10-01): olmayan sutunu sessizce atmak, o urunun
  // envanterini 0 gosteriyordu. Uretimde RHA tam olarak boyle okundu - `apache_version` da
  // `httpd_version` da dbo.Inventory'de YOK, panel "envanterde 0 RHA var" dedi ve tablo
  // tutarsiz gorundu. "Sutun yok" ile "envanterde yok" AYRI seylerdir; hangisinin eksik
  // oldugu yukari tasinir ve ekran 0 yerine "envanter sutunu yok" yazar.
  const PRODUCT_COLS_ALL = PRODUCT_COLS;
  const invProductCols = {};
  for (const { col, product } of PRODUCT_COLS_ALL) {
    if (!invProductCols[product]) invProductCols[product] = { cols: [], present: [] };
    invProductCols[product].cols.push(col);
    if (hasCol(col)) invProductCols[product].present.push(col);
  }
  const invProductUnknown = Object.fromEntries(
    Object.entries(invProductCols).map(([p, v]) => [p, v.present.length === 0]),
  );
  const invSelect = [
    'host',
    hasCol('env') ? 'env' : null,
    ...[...new Set(PRODUCT_COLS_ALL.filter((x) => hasCol(x.col)).map((x) => x.col))],
  ]
    .filter(Boolean)
    .join(', ');
  const invEnv = await query(`SELECT ${invSelect} FROM dbo.Inventory WHERE host IS NOT NULL`)
    .then((r) =>
      (r.recordset || []).map((row) => {
        const products = [];
        for (const { col, product } of PRODUCT_COLS_ALL) {
          if (!hasCol(col)) continue;
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
  // YUKLEME IZI (sozlesme v3): sunucu basina EN YENI scan_date'in LoadIssues satirlari.
  // Ayni (host, scan_date) icin loader yalniz son kosunun satirlarini tutar. Tablo henuz
  // yoksa (DDL kosmamis) bos liste: LOAD_EXCLUDED uretilmez, uclar dusmez.
  const loadIssues = await query(
    `SELECT li.host, li.scan_date, li.issue, li.detail, li.run_at FROM dbo.Server_Hub_LoadIssues li
     JOIN (SELECT host, MAX(scan_date) AS d FROM dbo.Server_Hub_LoadIssues GROUP BY host) m
       ON m.host = li.host AND m.d = li.scan_date`,
  )
    .then((r) => r.recordset || [])
    .catch(() => []);
  return {
    tableMissing: false,
    data: {
      hosts,
      init,
      jboss,
      jvms,
      web,
      vhosts,
      ips,
      sshd,
      loadIssues,
      mwApps,
      invEnv,
      invProductUnknown,
      // C3: kolon listesi okunamadi -> sema bilinmiyor (assess kapali kalir)
      schemaUnknown: !kol.ok,
    },
  };
}

/**
 * Tek sunucu ayrintisi icin AGIR JVM kolonlari (jvm_args ailesi). Filo sorgusunda yoktur
 * (hacim; P9). Kolon semada yoksa (eski sema / dalga 3 oncesi) bos Map.
 * @returns {Promise<Map<string, object>>}  anahtar `${gen}|${jvm kucuk harf}`
 */
async function loadJvmAgir(host) {
  const { query, sql } = require('../inventory/mssql.cjs');
  const kol = await shKolonlari(query);
  if (!kol.ok) return new Map();
  const var_ = kol.cols.get('dbo.server_hub_jvms') || new Set();
  const agir = JVM_AGIR_KOLONLAR.filter((c) => var_.has(c));
  if (!agir.length) return new Map();
  const rows = await query(
    `SELECT t.[gen], t.[jvm], ${agir.map((c) => `t.[${c}]`).join(', ')} FROM dbo.Server_Hub_Jvms t
     JOIN (SELECT host, MAX(scan_date) AS d FROM dbo.Server_Hub_Hosts GROUP BY host) m
       ON m.host = t.host AND m.d = t.scan_date
     WHERE t.host = @h OR t.host LIKE @h + '.%'`,
    [{ name: 'h', type: sql.NVarChar(64), value: host }],
  )
    .then((r) => r.recordset || [])
    .catch(() => []);
  const out = new Map();
  for (const r of rows) out.set(`${Number(r.gen)}|${String(r.jvm || '').trim().toLowerCase()}`, r);
  return out;
}

async function getAssessment(fresh) {
  if (!fresh && _cache.value && Date.now() - _cache.at < CACHE_MS) return _cache.value;
  const { tableMissing, data } = await loadLatest();
  const value = tableMissing
    ? { tableMissing: true, hosts: [], summary: null, latestScan: null }
    : { tableMissing: false, ...assess(data) };
  // SEMA BILINMIYOR (C3) sonucu onbellege ALINMAZ: gecici hata 60 sn boyunca "kapali" /
  // "geri alma serbest" gostermesin; bir sonraki istek kolonlari yeniden okur. Onceki
  // (saglam) onbellek de silinir - ekran ayni dakika icinde iki farkli gercek gostermesin.
  if (value.schemaUnknown) _cache = { at: 0, value: null };
  else _cache = { at: Date.now(), value };
  return value;
}

/** /overview rollback alani (EK-1). Sema bilinmiyorsa v3 sayimi yapilamaz: geri alma YOK. */
function rollbackBilgisi(a) {
  const sv = (a.summary && a.summary.scanVersion) || null;
  if (a.schemaUnknown || (sv && sv.schemaUnknown))
    return {
      allowed: false,
      v3Hosts: null,
      schemaUnknown: true,
      message:
        'Server Hub şeması (sys.columns) okunamadı — v3 tarama sayısı bilinmiyor; Portal eski sürüme geri alınmamalı. Sayfayı yenileyin.',
    };
  if (sv && sv.v3Hosts > 0)
    return {
      allowed: false,
      v3Hosts: sv.v3Hosts,
      message: `${sv.v3Hosts} sunucunun son taraması yeni tarayıcıdan (scan_ver dolu) — Portal eski sürüme geri alınmamalı; önce Ansible geri alınıp eski tarayıcıyla bir tarama yüklenmeli.`,
    };
  return { allowed: true, v3Hosts: 0, message: '' };
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
    // v3: calisma durumu OLCULEMEYEN JVM "calisiyor" da "kapali" da sayilmaz; ayri sayac
    jvmsRunning: h.jvms.filter((j) => j.runningKnown !== false && j.running).length,
    jvmsUnmeasured: h.jvms.filter((j) => j.runningKnown === false).length,
    // tazelik kapisi (bayat / son yuklemede disarida kalan sunucuda eylem yok)
    fresh: h.fresh !== false,
    vhosts: h.vhosts.length,
    unusedIps: h.ips.filter((i) => i.usedBy === 'none' && !i.primary).length,
    // bulgu metni serbest metin tasiyabilir (note/detail) -> maskeli (kural 9)
    topFinding:
      maskText(
        h.findings
          .slice()
          .sort(
            (a, b) =>
              (({ danger: 3, warning: 2, info: 1 })[b.severity] || 0) -
              ({ danger: 3, warning: 2, info: 1 }[a.severity] || 0),
          )[0]?.text,
      ) || null,
  };
}

/**
 * Tek sunucu ayrintisi. MASKE (kural 9, ucuncu katman): serbest metin alanlari (note,
 * detail, cli_rescue, bulgu metni) desen maskesiyle, jvm_args ailesi BEYAZ LISTEYLE.
 * Maske idempotenttir; assess zaten maskeli yuklese de cikista yeniden uygulanir.
 * @param {object} h      assess() sunucusu
 * @param {Map<string, object>} [agir]  loadJvmAgir() ciktisi (jvm_args ailesi, ham)
 */
function hostDetail(h, agir) {
  const agirOf = (j) => (agir ? agir.get(`${j.gen}|${String(j.name || '').toLowerCase()}`) : null);
  return {
    ...hostRow(h),
    scanVer: h.scanVer || null,
    scanErrors: h.scanErrors || [],
    procVisibility: h.procVisibility || null,
    sockVisibility: h.sockVisibility || null,
    note: maskText(h.note || ''),
    loadExcluded: !!h.loadExcluded,
    // C3: sema okunamadi -> bu sunucuda hicbir eylem yok, calisma durumlari bilinmiyor
    schemaUnknown: h.schemaUnknown === true,
    findings: h.findings.map((f) => ({ ...f, text: maskText(f.text) })),
    init: h.init,
    jboss: h.jboss.map((b) => ({
      ...b,
      note: maskText(b.note),
      cliRescue: b.cliRescue == null ? b.cliRescue : maskText(b.cliRescue),
    })),
    jvms: h.jvms.map((j) => {
      const a = agirOf(j) || {};
      const ham = (k, alan) => (a[k] !== undefined ? a[k] : j[alan]);
      return {
        ...j,
        // runningKnown / runningSrc donuk arayuz (UI 'bilinmiyor' gosterir)
        runningKnown: j.runningKnown !== false,
        runningSrc: j.runningSrc || null,
        jvmArgs: maskJvmArgs(ham('jvm_args', 'jvmArgs') ?? null),
        configuredJvmArgs: maskJvmArgs(ham('configured_jvm_args', 'configuredJvmArgs') ?? null),
        jvmArgDiff: maskJvmArgDiff(ham('jvm_arg_diff', 'jvmArgDiff') ?? null),
        vhosts: j.vhosts.map((m) => ({
          host: m.host,
          product: m.v.product,
          serverName: m.v.serverName,
          req24h: m.v.req24h,
          req7d: m.v.req7d,
          hc24h: m.v.hc24h,
          sampled: m.v.sampled,
          kind: m.kind || null,
          trafficState: m.v.trafficState || null,
          trafficReason: m.v.trafficReason || null,
        })),
      };
    }),
    // Ekran web durumunu runningSrc'den okur: calisma durumu bilinmeyen satir (sema okunamadi,
    // C3) 'UNMEASURED' olarak gider - "calismiyor" gosterilmesin.
    web: h.web.map((w) => ({
      ...w,
      runningSrc: w.runningSrc || (w.runningKnown === false ? 'UNMEASURED' : null),
      detail: maskText(w.detail),
    })),
    // proxy_targets (C5): userinfo YAPISAL silinir (assess zaten siler; burada ucuncu katman
    // olarak yeniden). Spread'deki proxyTargetsRaw da AYNI temiz degerle ezilir - eski
    // tarayicinin 'svc:S3cr@backend:8080' satiri yanita hicbir alandan cikmaz.
    vhosts: h.vhosts.map((v) => {
      const pt = hedefUserinfoSil(v.proxyTargetsRaw || '');
      return { ...v, proxyTargetsRaw: pt, proxyTargets: pt };
    }),
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
  // YANLIS SABLON (2026-10-08 uretim olayi: server_hub_fix satirinda rollback sablonu vardi).
  await require('../ansible/template-preflight.cjs').assertRegistryPlaybook(serverId, templateId, keyName);
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
        // EK-2: son basarili yukleme FRESH_MAX_DAYS'ten eskiyse { lastLoad, ageDays };
        // bu durumda hicbir sunucu taze degildir ve tum eylemler kapalidir.
        staleFleet: a.staleFleet || null,
        // C3: sys.columns okunamadi -> tum eylemler kapali, sonuc onbellekte degil
        schemaUnknown: a.schemaUnknown === true,
        // EK-1: v3 tarayici verisi varken (ya da sema bilinmiyorken) Portal eski surume
        // geri ALINMAZ.
        rollback: rollbackBilgisi(a),
        summary: a.summary,
        // Taramadan dusen sunucular listede yok; summary.taramadanDusen'de ayri.
        hosts: a.hosts.filter((h) => !h.taramadanDustu).map(hostRow),
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
        // EK-2 (C7): Bulgular sekmesinin kirmizi bandi bu alani okur; /overview ile AYNI.
        staleFleet: a.staleFleet || null,
        schemaUnknown: a.schemaUnknown === true,
        taramadanDusen: a.summary?.taramadanDusen || null,
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
      // jvm_args ailesi yalniz burada (tek sunucu) okunur ve maskelenir (P9 / kural 9)
      const agir = await loadJvmAgir(host).catch(() => new Map());
      res.json({ ok: true, host: hostDetail(h, agir) });
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

  // -- TOPLU AUTO-START DUZELTMESI (kullanici, 2026-09-28; 2026-10-01'de KALDIRILDI, asagi) --
  // "auto-start'i kapali olup JVM process'i acik olan TUM bulgulari tek tusla ac" ve
  // tersi: "auto-start'i acik olup process'i kapali olanlari tek tusla kapat".
  //
  // ONCE PLAN, SONRA ONAY (kullanicinin secimi): plan HICBIR IS BASLATMAZ - liste zaten
  // ── ACILIS HAZIRLIGI (kullanici, 2026-10-01) ───────────────────────────────────────
  // "Ben sana sunucu listesi verdigimde o sunucularin sorunsuz acilip acilmayacagini bana
  // bir executive summary gibi vermeni istiyorum."
  //
  // SALT OKUNUR: hicbir is baslatmaz, hicbir sunucuya dokunmaz. Mevcut taramanin
  // bulgularini "yeniden baslatirsam geri gelir mi" sorusuna gore yeniden siniflar.
  router.post('/reboot-readiness', async (req, res) => {
    try {
      const ham = req.body?.hosts;
      const metin = Array.isArray(ham) ? ham.join(',') : String(ham || '');
      // parseTargets ZATEN var ve tarama ekraninda kullaniliyor: ayni yapistirma bicimi
      // (virgul / satir / FQDN / port eki) burada da calissin diye AYNI ayristirici.
      const istenen = parseTargets(metin.replace(/[\s;]+/g, ',')).map((t) => t.host);
      if (!istenen.length)
        return res.status(400).json({ ok: false, message: 'Sunucu listesi boş.' });
      if (istenen.length > 500)
        return res
          .status(400)
          .json({ ok: false, message: 'Tek seferde en fazla 500 sunucu sorgulanabilir.' });
      const a = await getAssessment(false);
      const { rebootReadiness } = require('./reboot-readiness.cjs');
      res.json({ ok: true, ...rebootReadiness(a.hosts || [], istenen, a.latestScan || null) });
    } catch (err) {
      res.status(err.status || 500).json({ ok: false, message: err.message });
    }
  });

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
      // YAZMA KAPILARI (v3 "bayat sunucuda TUM yazma eylemleri onerilmez", EK-6.13; tur 4): satir
      // dugmesi bulgudan bagimsizdir, /fix'in finding.fix kapilarini (bayat / sema) devralmaz.
      // Sema okunamadiysa running_src / cfg_src / auto_start kaniti secilmedi; bayat ya da son
      // yuklemede disarida kalan sunucunun auto-start degeri bugunu anlatmaz. Is ACILMAZ.
      // running_src=UNMEASURED BILEREK kapi degil (v3: tek-JVM dugmesi admine acik, onay uyarir).
      if (a.schemaUnknown === true || h.schemaUnknown === true)
        return res.status(400).json({
          ok: false,
          message:
            'Server Hub şeması (sys.columns) okunamadı — eylem önerilmez; auto-start değiştirilemez, iş açılmadı. Sayfayı yenileyin.',
        });
      if (h.fresh !== true)
        return res.status(400).json({
          ok: false,
          message: `${host} taraması bayat (bayat kanıt: ${h.scanDate || '?'}${h.loadExcluded ? ', son yükleme dışlandı' : ''}) — auto-start değiştirilemez, iş açılmadı. Önce sunucuyu yeniden tarayın.`,
        });
      const j = (h.jvms || []).find((x) => x.name === jvm && Number(x.gen) === gen);
      if (!j)
        return res.status(400).json({
          ok: false,
          message: `${host} üzerinde ${jvm} (JBoss ${gen}) taramada yok — sayfayı yenileyin.`,
        });
      // TANIMSIZ SUREC (EK-6.7, tur 3 #8): cfg_src=UNAVAILABLE JVM tanim kaynaginda YOK;
      // auto-start'i olmayan bir sey degistirilemez (playbook da host XML'de bulamaz).
      if (j.source === 'cli' && j.cfgSrc === 'UNAVAILABLE')
        return res.status(400).json({
          ok: false,
          message: `${jvm} (JBoss ${gen}) tanım kaynağında yok (ps'te tanımsız süreç) — auto-start değiştirilemez, iş açılmadı.`,
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

  // Reboot Kontrolu (2026-10-08): once/sonra goruntu + otomatik duzeltme (reboot-check.cjs).
  require('./reboot-check.cjs').mount(router, { launch, HOST_RE });

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

module.exports = {
  initServerHub,
  REGISTRY_KEYS,
  FIX_ACTIONS,
  HOST_RE,
  hostRow,
  hostDetail,
  loadLatest,
  SH_KOLONLAR,
  JVM_AGIR_KOLONLAR,
};
