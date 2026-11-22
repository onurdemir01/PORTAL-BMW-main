// server/server-hub/__tests__/xml-autostart-kapat.test.js - DOMAIN KAPALIYKEN HOST XML ile auto-start KAPAT (2026-11-15).
//
// Kullanici karari: "biz 'Tek tek, bilincli kullanim icin XML yolu ekleyebilirim' opsiyonunu devreye alalim ben
// bunlari gormek istemiyorum. bunlar yanlis retire edilmis uygulamalar o yuzden auto-start'lari kapatilmali".
//   XK1 xmlKapatKapisi: YALNIZ domainKapali + durmus (olculmus) + auto-start true; calisan domain, calisan JVM,
//       olculemeyen, zaten false, bilinmeyen, envanter, taramada yok -> 400 (Turkce neden)
//   XK2 assess JBOSS_DOMAIN_DOWN: domain'in TUM JVM'leri auto-start false -> bilgi (prod + ortam bilinmiyor dahil),
//       metin "reboot'ta acilacak JVM yok"; biri acik / bilinmiyor -> uyari; Admin seviyesi kazanir (adminSeviye)
//   XK3 dogrulama katmani: XML isi items ile kaydedilir; OK/SKIP oge false dogrulanir, FAIL / plan dogrulanmaz;
//       JBOSS_DOMAIN_DOWN metni / sayi / seviye ayni katmandan yeniden kurulur (Admin seviyesi korunur)
//   XK4 /jvm-autostart-xml uctan uca: plan (plan_only true, jvms tek metin, kayit yok) -> uygula (plan_only false,
//       kayit + kilit) -> is biter -> /host false + bulgu bilgi; ikinci uygulama 400 "zaten"; suren is 409
//   XK5 /jvm-autostart-xml red: calisan domain, calisan JVM, plan+confirmed, ikisi de yok, cift ad, gecersiz gen /
//       ad, bos liste; /jvm-autostart domain kapali JVM'de hala 400 (CLI yolu acilmadi)
//   XK6 (inceleme F1/F2) sunucu + nesil basina TEK XML isi: kayitli XML isi surerken BASKA JVM'e uygulama 409 (plan
//       serbest); is bitince acilir; launch suresince ikinci istek await'ten once 409; katman xmlRezervasyon
//   XK7 (inceleme F4) /host: katman JBOSS_DOMAIN_DOWN'u bilgiye indirince sunucu durumu / sayaclar ayni bulgulardan
'use strict';
const { esnek } = require('../../__tests__/fixtures/kod-deseni.cjs');

const { test: nodeTest, beforeEach } = require('node:test');
const test = (ad, fn) => nodeTest(ad, { timeout: 15000 }, fn);
const assert = require('node:assert/strict');
const Module = require('node:module');

function stub(rel, exports) {
  const p = require.resolve(rel);
  const m = new Module(p);
  m.filename = p;
  m.loaded = true;
  m.exports = exports;
  require.cache[p] = m;
}

const {
  xmlKapatKapisi,
  kur,
  ogeSonuclari,
  XML_KAPAT_EYLEMI,
} = require('../autostart-dogrulama.cjs');
const { assess: assessHam } = require('../assess.cjs');

const HC_NOT = 'host controller calismiyor, CLI acilmadi';
const GUN = new Date().toISOString().slice(0, 10);
const NOW = Date.now();

// ── XK1 ───────────────────────────────────────────────────────────────────────────────────────────
test('XK1 xmlKapatKapisi yalniz domain kapali + durmus + auto-start true', () => {
  const ctx = { host: 'ORCJAP01', jvm: 'app1', gen: 8 };
  const iyi = {
    name: 'app1',
    gen: 8,
    source: 'cli',
    cfgSrc: 'XML',
    domainKapali: true,
    running: false,
    runningKnown: true,
    autoStart: 'true',
  };
  assert.equal(xmlKapatKapisi(iyi, ctx), null);
  const red = (ek, re) => {
    const k = xmlKapatKapisi(ek === null ? null : { ...iyi, ...ek }, ctx);
    assert.ok(k, `kapi acik kaldi: ${JSON.stringify(ek)}`);
    assert.equal(k.status, 400);
    assert.match(k.message, re);
    assert.match(k.message, /iş açılmadı/);
  };
  red(null, /taramada yok/);
  red({ domainKapali: undefined }, /domain'i kapalı görünmüyor .* Auto-start Kapat'ı kullanın/);
  red({ domainKapali: false }, /domain'i kapalı görünmüyor/);
  red({ running: true }, /ÇALIŞIYOR/);
  red({ runningKnown: false }, /çalışma durumu ölçülemedi/);
  red({ autoStart: 'false' }, /zaten auto-start KAPALI/);
  red({ autoStart: 'false', autoStartDogrulama: { jobId: 77, at: 'x' } }, /iş #77 ile doğrulandı/);
  red({ autoStart: 'unknown' }, /bilinmiyor/);
  red({ yalnizEnvanter: true, source: 'envanter' }, /yalnız envanterde/);
  red({ cfgSrc: 'UNAVAILABLE' }, /tanım kaynağında yok/);
  // inceleme F6: kaynaktan bagimsiz (arayuz xmlKapatilabilir ile ayni)
  red({ source: 'xml', cfgSrc: 'UNAVAILABLE' }, /tanım kaynağında yok/);
});

// ── XK2 / XK3: assess verisi ─────────────────────────────────────────────────────────────────────
const hostSatiri = (host) => ({
  host,
  scan_date: GUN,
  products: 'JBOSS8',
  wall_s: 1,
  cpu_s: 0.1,
  note: '',
  scan_ver: '2.4',
  rec_counts: '',
  scan_errors: '',
  proc_visibility: 'FULL',
  sock_visibility: 'PID',
  loaded_at: `${GUN}T06:00:00Z`,
});
const jvmSatiri = (host, ad, running, autoStart) => ({
  host,
  gen: 8,
  jvm: ad,
  grp: `${ad}-group`,
  running,
  auto_start: autoStart,
  server_state: running ? 'running' : 'stopped',
  ports: '',
  running_src: running ? 'PS' : 'PS_ABSENT',
  cfg_src: 'XML',
});
const veri = (host, asDegerleri) => ({
  hosts: [hostSatiri(host)],
  init: [],
  jboss: [
    {
      host,
      gen: 8,
      host_name: 'master',
      host_state: '',
      cli: 'SKIP',
      note: `${HC_NOT}; host XML tahmini: host.xml`,
    },
  ],
  jvms: asDegerleri.map((v, i) => jvmSatiri(host, `app${i + 1}`, 0, v)),
  web: [],
  vhosts: [],
  ips: [],
});
const dd = (A, host) =>
  A.hosts.find((h) => h.host === host).findings.find((f) => f.code === 'JBOSS_DOMAIN_DOWN');

test('XK2 JBOSS_DOMAIN_DOWN: hepsi false -> her ortamda bilgi; acik/bilinmeyen varsa uyari; Admin kazanir', () => {
  const HEPSI =
    "JBoss 8 domain kapalı (host controller çalışmıyor) — 2 JVM durmuş, hepsinde host XML'de auto-start kapalı: reboot'ta açılacak JVM yok; JVM bazında auto-start bulgusu üretilmedi";
  for (const host of ['ORBFAP01', 'ORBFAA01', 'ORBFAT01']) {
    const f = dd(assessHam(veri(host, ['false', 'false']), { now: NOW }), host);
    assert.equal(f.severity, 'info', host);
    assert.equal(f.text, HEPSI);
    assert.equal(f.autoStartAcik, 0);
    assert.equal(f.ortamTavani, undefined, `${host}: ortam tavani degil, reboot'ta acilacak yok`);
    assert.equal(f.defaultSeverity, undefined);
    assert.equal(f.adminSeviye, undefined);
  }
  const acik = dd(assessHam(veri('ORBFAP01', ['false', 'true']), { now: NOW }), 'ORBFAP01');
  assert.equal(acik.severity, 'warning');
  assert.equal(acik.autoStartAcik, 1);
  const bilinmeyen = dd(
    assessHam(veri('ORBFAP01', ['false', 'unknown']), { now: NOW }),
    'ORBFAP01',
  );
  assert.equal(bilinmeyen.severity, 'warning', 'bilinmeyen auto-start: reboot guvenli denemez');
  // Admin seviyesi kazanir (uyari dediyse hepsi false olsa da uyari)
  const adm = dd(
    assessHam(veri('ORBFAP01', ['false', 'false']), {
      now: NOW,
      seviyeler: { JBOSS_DOMAIN_DOWN: 'warning' },
    }),
    'ORBFAP01',
  );
  assert.deepEqual([adm.severity, adm.adminSeviye], ['warning', true]);
  const kr = dd(
    assessHam(veri('ORBFAP01', ['false', 'false']), {
      now: NOW,
      seviyeler: { JBOSS_DOMAIN_DOWN: 'danger' },
    }),
    'ORBFAP01',
  );
  assert.equal(kr.severity, 'danger');
});

test('XK3 dogrulama katmani: XML isi items; OK/SKIP dogrulanir; bulgu metni / seviye katmandan', () => {
  const host = 'ORBFAP01';
  const A = assessHam(veri(host, ['true', 'true', 'false']), { now: NOW });
  const h = A.hosts.find((x) => x.host === host);
  const f0 = dd(A, host);
  assert.deepEqual([f0.severity, f0.autoStartAcik], ['warning', 2]);
  let simdi = 1000;
  const k = kur({ simdi: () => simdi });
  const items = ['app1', 'app2'].map((jvm) => ({ gen: 8, jvm, action: XML_KAPAT_EYLEMI }));
  // plan_only sonucu ve FAIL oge dogrulanmaz
  k.isKaydetToplu(1, 50, { host, h, items });
  const satir = (jvm, d) => ({
    gen: '8',
    jvm,
    action: XML_KAPAT_EYLEMI,
    line: `RESULT\t${XML_KAPAT_EYLEMI}\t${d}\t${jvm} m`,
  });
  const b0 = k.isBitti(1, 50, 'successful', {
    action: XML_KAPAT_EYLEMI,
    plan_only: true,
    items: [satir('app1', 'PLAN')],
  });
  assert.equal(b0.toplu, true);
  assert.equal(b0.ogeler[0].dogrulandi, false);
  assert.equal(k._boyut().dogrulanan, 0);
  // ogeSonuclari XML eylemini liste kipi sayar; baska eylemin satiri eslesmez
  const os = ogeSonuclari(items, {
    action: XML_KAPAT_EYLEMI,
    plan_only: false,
    items: [satir('app1', 'OK'), satir('app2', 'FAIL')],
  });
  assert.deepEqual(
    os.map((o) => [o.jvm, o.durum, o.dogrulandi]),
    [
      ['app1', 'OK', true],
      ['app2', 'FAIL', false],
    ],
  );
  // uygulama: app1 OK, app2 SKIP -> ikisi de false dogrulandi
  k.isKaydetToplu(1, 51, { host, h, items });
  assert.ok(k.surenIs(host, 8, 'app1'), 'XML isi suren is kilidine girmeli');
  simdi += 10;
  const b = k.isBitti(1, 51, 'failed', {
    action: XML_KAPAT_EYLEMI,
    plan_only: false,
    items: [satir('app1', 'OK'), satir('app2', 'SKIP')],
  });
  assert.deepEqual(
    b.ogeler.map((o) => o.dogrulandi),
    [true, true],
  );
  assert.equal(k.surenIs(host, 8, 'app1'), null);
  const j1 = k.uygulaJvm(
    h,
    h.jvms.find((j) => j.name === 'app1'),
  );
  assert.deepEqual(
    [j1.autoStart, j1.autoStartTarama, j1.autoStartDogrulama.jobId],
    ['false', 'true', 51],
  );
  const f = k.uygulaBulgu(h, f0);
  assert.equal(f.severity, 'info');
  assert.equal(f.autoStartAcik, 0);
  assert.match(f.text, /hepsinde host XML'de auto-start kapalı: reboot'ta açılacak JVM yok/);
  assert.equal(f.autoStartDogrulama.jobId, 51);
  assert.equal(f0.severity, 'warning', 'katman bulguyu yerinde degistirmemeli');
  // Admin seviyesi varsa seviye korunur, metin yine guncellenir
  const fa = k.uygulaBulgu(h, { ...f0, adminSeviye: true, severity: 'danger' });
  assert.equal(fa.severity, 'danger');
  assert.equal(fa.autoStartAcik, 0);
  // baska sunucu / dogrulama yok: ayni nesne
  const k2 = kur();
  assert.equal(k2.uygulaBulgu(h, f0), f0);
});

// ── XK4 / XK5: uclar (gercek initServerHub, sahte DB + AWX) ────────────────────────────────────────
const APP = 'ORCJAP01';
const SEMA = {
  Server_Hub_Hosts: [
    'id',
    'scan_date',
    'host',
    'products',
    'wall_s',
    'cpu_s',
    'note',
    'scan_ver',
    'rec_counts',
    'scan_errors',
    'proc_visibility',
    'sock_visibility',
    'loaded_at',
  ],
  Server_Hub_Init: ['id', 'scan_date', 'host', 'root', 'file', 'status', 'sha512'],
  Server_Hub_Jboss: ['id', 'scan_date', 'host', 'gen', 'host_name', 'host_state', 'cli', 'note'],
  Server_Hub_Jvms: [
    'id',
    'scan_date',
    'host',
    'gen',
    'jvm',
    'grp',
    'running',
    'auto_start',
    'server_state',
    'ports',
    'running_src',
    'cfg_src',
    'jvm_args',
  ],
  Server_Hub_Web: ['id', 'scan_date', 'host', 'product', 'running', 'syntax', 'detail'],
  Server_Hub_Vhosts: [
    'id',
    'scan_date',
    'host',
    'product',
    'listen',
    'server_name',
    'aliases',
    'access_log',
    'proxy_targets',
    'req_24h',
    'req_7d',
    'hc_24h',
    'shared',
    'sampled',
    'conf_file',
  ],
  Server_Hub_Ips: ['id', 'scan_date', 'host', 'ip', 'iface', 'used_by', 'is_primary'],
  Server_Hub_Sshd: ['id', 'scan_date', 'host', 'max_sessions', 'max_startups', 'active_sessions'],
};
const loadedAt = new Date(Date.now() - 3600 * 1000).toISOString();
const dbJvm = (gen, ad, ek) => ({
  id: `${gen}${ad}`,
  scan_date: GUN,
  host: APP,
  gen,
  jvm: ad,
  grp: 'g',
  running: 0,
  auto_start: 'true',
  server_state: 'stopped',
  ports: '',
  running_src: 'PS_ABSENT',
  cfg_src: 'XML',
  ...ek,
});
const dbVeri = { kosanYok: false };
const satirlar = () => ({
  Server_Hub_Hosts: [
    {
      id: 1,
      scan_date: GUN,
      host: APP,
      products: 'JBOSS7 JBOSS8',
      wall_s: 1,
      cpu_s: 0.1,
      note: '',
      scan_ver: '2.4',
      rec_counts: '',
      scan_errors: '',
      proc_visibility: 'FULL',
      sock_visibility: 'PID',
      loaded_at: loadedAt,
    },
  ],
  Server_Hub_Jboss: [
    {
      id: 1,
      scan_date: GUN,
      host: APP,
      gen: 7,
      host_name: 'm',
      host_state: 'running',
      cli: 'OK',
      note: '',
    },
    {
      id: 2,
      scan_date: GUN,
      host: APP,
      gen: 8,
      host_name: 'master',
      host_state: '',
      cli: 'SKIP',
      note: `${HC_NOT}; host XML tahmini: host.xml`,
    },
  ],
  Server_Hub_Jvms: [
    dbJvm(8, 'yanlis1'),
    dbJvm(8, 'yanlis2'),
    dbJvm(8, 'zatenkapali', { auto_start: 'false' }),
    dbJvm(8, 'kosan8', { running: 1, running_src: 'PS', server_state: 'running', ports: '8080' }),
    dbJvm(7, 'acikdomain', { cfg_src: 'CLI_WILDCARD' }),
  ].filter((j) => !(dbVeri.kosanYok && j.jvm === 'kosan8')),
});
stub('../../inventory/mssql.cjs', {
  sql: { NVarChar: () => 'nvarchar' },
  query: async (q) => {
    const s = String(q);
    if (/OBJECT_ID\('dbo\.Server_Hub_Hosts'\) AS oid/.test(s)) return { recordset: [{ oid: 1 }] };
    if (/FROM sys\.columns c WHERE c\.object_id IN/.test(s)) {
      const out = [];
      for (const m of s.matchAll(/OBJECT_ID\('dbo\.(\w+)'\)/g))
        for (const c of SEMA[m[1]] || []) out.push({ tbl: m[1], name: c });
      return { recordset: out };
    }
    if (/sys\.columns WHERE object_id/.test(s)) return { recordset: [] };
    const m = /FROM dbo\.(Server_Hub_\w+) t\b/.exec(s);
    if (m) return { recordset: satirlar()[m[1]] || [] };
    return { recordset: [] };
  },
});
stub('../../db/index.cjs', { query: async () => ({ rows: [] }) });
stub('../../auth/index.cjs', { requireAuth: (_q, _s, n) => n() });
stub('../../auth/visibility.cjs', { requireVisiblePrefix: () => (_q, _s, n) => n() });
stub('../../audit/index.cjs', { auditPortal: () => {} });
stub('../../ansible/playbook-registry.cjs', {
  getByKey: async () => ({ enabled: true, awxServerId: 1 }),
  getEffectiveTemplateId: () => 77,
});
stub('../../opsx/index.cjs', {
  extractStatsKey: (a, k) => (a && a[k] && typeof a[k] === 'object' ? a[k] : null),
});
const awx = { launch: [], durum: new Map(), bekle: null, bekleyen: 0 };
stub('../../ansible/runner.cjs', {
  getServers: () => [{ id: 1 }],
  getTemplateSummaryOnServer: async (_s, id) => ({
    id,
    name: 'fix',
    playbook: 'bmw_automation_folder/server_hub/server_hub_fix.yml',
    askVariablesOnLaunch: true,
  }),
  listTemplatesForServer: async () => [],
  launchJobOnServer: async (serverId, templateId, extraVars) => {
    if (awx.bekle) {
      awx.bekleyen++;
      await awx.bekle;
    }
    const jobId = 700 + awx.launch.length;
    awx.launch.push({ serverId, templateId, extraVars, jobId });
    return { jobId, status: 'pending' };
  },
  getJobStatusOnServer: async (_s, jobId) =>
    awx.durum.get(jobId) || { status: 'running', artifacts: {} },
  getJobOutputOnServer: async () => ({ output: '' }),
});
const SH = require('../index.cjs');

beforeEach(() => {
  SH._onbellekSifirlaForTest();
  awx.launch.length = 0;
  awx.durum.clear();
  awx.bekle = null;
  awx.bekleyen = 0;
  dbVeri.kosanYok = false;
});

async function httpIle(fn) {
  const express = require('express');
  const app = express();
  app.use((req, _res, next) => {
    req.session = { user: { role: 'Admin', username: 'test' } };
    next();
  });
  const log = console.log;
  console.log = () => {};
  try {
    SH.initServerHub(app);
  } finally {
    console.log = log;
  }
  const srv = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  try {
    return await fn(`http://127.0.0.1:${srv.address().port}/api/server-hub`);
  } finally {
    if (typeof srv.closeAllConnections === 'function') srv.closeAllConnections();
    srv.close();
  }
}
const postXml = (kok, body) =>
  fetch(`${kok}/jvm-autostart-xml`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ host: APP, gen: 8, ...body }),
    signal: AbortSignal.timeout(5000),
  });
const al = (url) => fetch(url, { signal: AbortSignal.timeout(5000) });
const satirX = (jvm, d) => ({
  gen: '8',
  jvm,
  action: XML_KAPAT_EYLEMI,
  line: `RESULT\t${XML_KAPAT_EYLEMI}\t${d}\t${jvm} auto-start=false (host XML host.xml, geri okundu)`,
});

test('XK4 uctan uca: plan -> uygula -> /host false + JBOSS_DOMAIN_DOWN bilgi; ikinci uygulama zaten; suren is 409', async () => {
  await httpIle(async (kok) => {
    const ilk = await (await al(`${kok}/host/${APP}`)).json();
    const f0 = ilk.host.findings.find((f) => f.code === 'JBOSS_DOMAIN_DOWN');
    assert.equal(f0.severity, 'warning');
    assert.equal(f0.autoStartAcik, 2);
    // plan: salt okunur is, kayit / kilit yok
    const p = await postXml(kok, { jvms: ['yanlis1', 'yanlis2'], plan: true });
    assert.equal(p.status, 200, JSON.stringify(await p.clone().json()));
    const pj = await p.json();
    assert.deepEqual(
      [pj.planOnly, pj.action, pj.prod, pj.jvms],
      [true, XML_KAPAT_EYLEMI, true, ['yanlis1', 'yanlis2']],
    );
    assert.deepEqual(awx.launch[0].extraVars, {
      target_host: APP,
      action: 'jboss_autostart_xml_off',
      plan_only: true,
      reload: false,
      gen: 8,
      jvms: 'yanlis1 yanlis2',
    });
    assert.equal(
      SH._autoStart._boyut().topluIsler,
      0,
      'plan isi dogrulama katmanina kaydedilmemeli',
    );
    // uygulama
    const u = await (await postXml(kok, { jvms: ['yanlis1', 'yanlis2'], confirmed: true })).json();
    assert.equal(u.ok, true);
    assert.equal(awx.launch[1].extraVars.plan_only, false);
    assert.equal(awx.launch[1].extraVars.jvms, 'yanlis1 yanlis2');
    // is surerken ayni JVM'e yeni is 409 (tek satir /jvm-autostart-xml ve plan degil)
    const kilit = await postXml(kok, { jvms: ['yanlis1'], confirmed: true });
    assert.equal(kilit.status, 409);
    assert.match((await kilit.json()).message, /hâlâ sürüyor/);
    assert.equal(awx.launch.length, 2);
    // is biter: oge OK -> dogrulandi
    awx.durum.set(u.jobId, {
      status: 'successful',
      artifacts: {
        server_hub_fix_result: {
          host: APP,
          action: XML_KAPAT_EYLEMI,
          plan_only: false,
          line: `RESULT\t${XML_KAPAT_EYLEMI}\tOK\t2 JVM`,
          items: [satirX('yanlis1', 'OK'), satirX('yanlis2', 'OK')],
        },
      },
    });
    const js = await (await al(`${kok}/job-status/1/${u.jobId}`)).json();
    assert.equal(js.autoStart.toplu, true);
    assert.deepEqual(
      js.autoStart.ogeler.map((o) => [o.jvm, o.durum, o.dogrulandi]),
      [
        ['yanlis1', 'OK', true],
        ['yanlis2', 'OK', true],
      ],
    );
    const sonra = await (await al(`${kok}/host/${APP}`)).json();
    for (const ad of ['yanlis1', 'yanlis2']) {
      const j = sonra.host.jvms.find((x) => x.name === ad);
      assert.deepEqual(
        [j.autoStart, j.autoStartTarama, j.autoStartDogrulama.jobId],
        ['false', 'true', u.jobId],
        ad,
      );
    }
    const f = sonra.host.findings.find((x) => x.code === 'JBOSS_DOMAIN_DOWN');
    assert.equal(f.autoStartAcik, 0);
    // kosan8 calisiyor (auto-start true): domain'de hepsi false DEGIL -> uyari kalir, metin yeni sayiyi soyler
    assert.equal(f.severity, 'warning');
    assert.doesNotMatch(f.text, esnek(/auto-start açık: reboot/));
    // Bulgular sekmesi (/findings) da ayni katman
    const fl = (await (await al(`${kok}/findings`)).json()).findings.find(
      (x) => x.host === APP && x.code === 'JBOSS_DOMAIN_DOWN',
    );
    assert.equal(fl.autoStartAcik, 0);
    // ikinci uygulama: zaten kapali (dogrulanmis deger) -> 400, is yok
    const ik = await postXml(kok, { jvms: ['yanlis1'], confirmed: true });
    assert.equal(ik.status, 400);
    assert.match(
      (await ik.json()).message,
      new RegExp(`zaten auto-start KAPALI.*iş #${u.jobId} ile doğrulandı`),
    );
    assert.equal(awx.launch.length, 2);
  });
});

test('XK5 red: calisan domain / JVM, plan+confirmed, cift ad, gecersiz girdi; /jvm-autostart domain kapalida hala 400', async () => {
  await httpIle(async (kok) => {
    const bekle = async (body, re, durum = 400) => {
      const r = await postXml(kok, body);
      assert.equal(r.status, durum, JSON.stringify(body));
      assert.match((await r.json()).message, re, JSON.stringify(body));
    };
    await bekle({ gen: 7, jvms: ['acikdomain'], plan: true }, /domain'i kapalı görünmüyor/);
    await bekle({ jvms: ['kosan8'], plan: true }, /ÇALIŞIYOR/);
    await bekle({ jvms: ['zatenkapali'], confirmed: true }, /zaten auto-start KAPALI/);
    await bekle(
      { jvms: ['yanlis1', 'kosan8', 'yok9'], plan: true },
      /^2 JVM reddedildi \(iş açılmadı\):.*ÇALIŞIYOR.*taramada yok/,
    );
    await bekle({ jvms: ['yanlis1'], plan: true, confirmed: true }, /ikisi birden olmaz/);
    await bekle({ jvms: ['yanlis1'] }, /Önce plan/);
    await bekle({ jvms: ['yanlis1', 'yanlis1'], plan: true }, /iki kez/);
    await bekle({ jvms: ['a;b'], plan: true }, /Geçersiz JVM adı/);
    await bekle({ jvms: [], plan: true }, /1-200 arası/);
    await bekle({ jvms: 'yanlis1', plan: true }, /1-200 arası/);
    await bekle({ gen: 9, jvms: ['yanlis1'], plan: true }, /gen 7 ya da 8/);
    assert.equal(awx.launch.length, 0, 'reddedilen istek is acti');
    // CLI tek-JVM yolu domain kapali JVM'de hala kapali (iki yon)
    const r = await fetch(`${kok}/jvm-autostart`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ host: APP, gen: 8, jvm: 'yanlis1', enable: false, confirmed: true }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).message, /domain kapalı/);
    assert.equal(awx.launch.length, 0);
  });
});

test('XK6 sunucu + nesil basina tek XML isi: baska JVM 409, plan serbest, is bitince acilir; launch suresince 409', async () => {
  // katman: senkron rezervasyon
  const k = kur();
  const b1 = k.xmlRezervasyon('orcjap01', 8);
  assert.equal(typeof b1, 'function');
  assert.equal(k.xmlRezervasyon('ORCJAP01', 8), null, 'ayni sunucu + nesil ikinci rezervasyon');
  assert.equal(typeof k.xmlRezervasyon('ORCJAP01', 7), 'function', 'baska nesil serbest');
  b1();
  assert.equal(typeof k.xmlRezervasyon('ORCJAP01', 8), 'function', 'birak sonrasi serbest');
  k.isKaydetToplu(1, 900, {
    host: APP,
    h: null,
    items: [{ gen: 8, jvm: 'yanlis1', action: XML_KAPAT_EYLEMI }],
  });
  assert.deepEqual(k.xmlSurenIs(APP, 8), { serverId: 1, jobId: 900, jvm: 'yanlis1' });
  assert.equal(k.xmlSurenIs(APP, 7), null);
  k.isKaydetToplu(1, 901, {
    host: APP,
    h: null,
    items: [{ gen: 8, jvm: 'yanlis2', action: 'jboss_autostart_off' }],
  });
  k.isBitti(1, 900, 'failed', null);
  assert.equal(k.xmlSurenIs(APP, 8), null, 'XML disi toplu is XML kilidi sayilmaz');

  await httpIle(async (kok) => {
    const u = await (await postXml(kok, { jvms: ['yanlis1'], confirmed: true })).json();
    assert.equal(u.ok, true);
    // ayni dosya, BASKA JVM: 409 (eskiden JVM kilidi yalniz yanlis1'i tutuyordu)
    const r = await postXml(kok, { jvms: ['yanlis2'], confirmed: true });
    assert.equal(r.status, 409);
    const rj = await r.json();
    assert.equal(rj.code, 'xml_is_suruyor');
    assert.match(
      rj.message,
      new RegExp(`host XML işi #${u.jobId} hâlâ sürüyor — aynı dosyaya ikinci iş açılmaz`),
    );
    // plan salt okunur: kilide takilmaz
    assert.equal((await postXml(kok, { jvms: ['yanlis2'], plan: true })).status, 200);
    assert.equal(awx.launch.length, 2);
    // is biter (FAIL): kilit kalkar, yanlis2 acilir
    awx.durum.set(u.jobId, {
      status: 'failed',
      artifacts: {
        server_hub_fix_result: {
          action: XML_KAPAT_EYLEMI,
          plan_only: false,
          line: `RESULT	${XML_KAPAT_EYLEMI}	FAIL	kilit`,
          items: [],
        },
      },
    });
    const r2 = await postXml(kok, { jvms: ['yanlis2'], confirmed: true });
    assert.equal(r2.status, 200, JSON.stringify(await r2.clone().json()));
    assert.equal(awx.launch.length, 3);
    // launch suresince (kayit henuz yok) ikinci istek: HICBIR await'ten once 409
    awx.durum.set(awx.launch[2].jobId, { status: 'successful', artifacts: {} });
    await al(`${kok}/job-status/1/${awx.launch[2].jobId}`);
    let ac;
    awx.bekle = new Promise((x) => {
      ac = x;
    });
    const p1 = postXml(kok, { jvms: ['yanlis1'], confirmed: true });
    for (let i = 0; i < 200 && awx.bekleyen === 0; i++) await new Promise((x) => setTimeout(x, 10));
    assert.equal(awx.bekleyen, 1, 'ilk istek launch asamasina ulasmadi');
    const p2 = await postXml(kok, { jvms: ['yanlis2'], confirmed: true });
    assert.equal(p2.status, 409);
    assert.match((await p2.json()).message, /şu an başlatılıyor — aynı dosyaya ikinci iş açılmaz/);
    ac();
    assert.equal((await p1).status, 200);
    assert.equal(SH._autoStart._boyut().rezerveXml, 0, 'rezervasyon birakilmadi');
  });
});

test('XK7 /host: katman JBOSS_DOMAIN_DOWN bilgiye inince sunucu durumu / sayaclar ayni bulgulardan', async () => {
  dbVeri.kosanYok = true;
  await httpIle(async (kok) => {
    const ilk = (await (await al(`${kok}/host/${APP}`)).json()).host;
    const f0 = ilk.findings.find((f) => f.code === 'JBOSS_DOMAIN_DOWN');
    assert.equal(f0.severity, 'warning');
    const u = await (await postXml(kok, { jvms: ['yanlis1', 'yanlis2'], confirmed: true })).json();
    awx.durum.set(u.jobId, {
      status: 'successful',
      artifacts: {
        server_hub_fix_result: {
          host: APP,
          action: XML_KAPAT_EYLEMI,
          plan_only: false,
          line: `RESULT	${XML_KAPAT_EYLEMI}	OK	2 JVM`,
          items: [satirX('yanlis1', 'OK'), satirX('yanlis2', 'OK')],
        },
      },
    });
    await al(`${kok}/job-status/1/${u.jobId}`);
    const son = (await (await al(`${kok}/host/${APP}`)).json()).host;
    const f = son.findings.find((x) => x.code === 'JBOSS_DOMAIN_DOWN');
    assert.equal(f.severity, 'info');
    assert.match(f.text, /reboot'ta açılacak JVM yok/);
    const say = (F, sv) => F.filter((x) => x.severity === sv).length;
    assert.deepEqual(son.counts, {
      danger: say(son.findings, 'danger'),
      warning: say(son.findings, 'warning'),
      info: say(son.findings, 'info'),
    });
    assert.equal(son.counts.warning, ilk.counts.warning - 1);
    assert.equal(son.counts.info, ilk.counts.info + 1);
    const SV = ['ok', 'info', 'warning', 'danger'];
    const enKotu = son.findings.reduce((a, x) => Math.max(a, SV.indexOf(x.severity)), 0);
    assert.equal(son.status, SV[enKotu]);
  });
});
