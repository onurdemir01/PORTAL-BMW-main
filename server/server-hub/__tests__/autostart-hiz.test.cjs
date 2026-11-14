// server/server-hub/__tests__/autostart-hiz.test.cjs - Ayrinti / JVM auto-start hizi ve sonucu (2026-11-14).
//
// Kullanici: "server hub ayrinti sayfalari cok yavas calisiyor. Ayrinti -> JVM -> Auto-Start Kapat/Ac
// tuslari cok yavas calisiyor, calisip calismadiklarindan da emin olamiyorum".
//   AS1 dogrulama katmani: yalniz Portal'in actigi is, successful + ayni eylem + OK|SKIP -> deger; FAIL /
//       PLAN / baska eylem / bilinmeyen is -> yok; yeni tarama (loaded_at) ya da 24 saat -> tarama tek kaynak
//   AS2 /jvm-autostart: son taramada CALISAN JVM'de KAPAT 400, is ACILMAZ (betik FORCE'suz reddeder);
//       calisma durumu olculemeyen JVM kapi degil; kontrol: durmus JVM'de is acilir
//   AS3 launch basina AWX sablonu TEK GET (getTemplateSummaryOnServer), tum sablon listesi HIC okunmaz
//   AS4 uctan uca: is biter (OK) -> /job-status autoStart.dogrulandi, /host yeni deger + taramadaki deger,
//       ikinci tik "zaten ... dogrulandi" 400 (is acilmaz); auto-start isi bitince onbellek SILINMEZ,
//       baska is (tarama) bitince silinir
//   AS5 preflight: tek okuma dusunce liste yedek yolu; ayni hata kodlari (409)
//   AS6 /retire-etiketleri?host=: yalniz o sunucunun etiketleri; etiketle() ayni girdilerde yeniden kosmaz,
//       kontrol icerigi degisince kosar
//   AS7 /iliski/karar (bayatOlur): var olan grafik hemen doner, arkada TEK tazeleme; bayatOlur yoksa bekler
//   AS8 /host ayrintisi: sys.columns 60 sn onbellekten (iki acilis, tek sema okumasi); okunamadi onbellege alinmaz
'use strict';

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

const APP = 'GBCJAP01';
const gun = new Date().toISOString().slice(0, 10);
const SEMA = {
  Server_Hub_Hosts: ['id', 'scan_date', 'host', 'products', 'wall_s', 'cpu_s', 'note', 'scan_ver', 'rec_counts', 'scan_errors', 'proc_visibility', 'sock_visibility', 'loaded_at'],
  Server_Hub_Init: ['id', 'scan_date', 'host', 'root', 'file', 'status', 'sha512'],
  Server_Hub_Jboss: ['id', 'scan_date', 'host', 'gen', 'host_name', 'host_state', 'cli', 'note'],
  Server_Hub_Jvms: ['id', 'scan_date', 'host', 'gen', 'jvm', 'grp', 'running', 'auto_start', 'server_state', 'ports', 'running_src', 'cfg_src', 'jvm_args'],
  Server_Hub_Web: ['id', 'scan_date', 'host', 'product', 'running', 'syntax', 'detail'],
  Server_Hub_Vhosts: ['id', 'scan_date', 'host', 'product', 'listen', 'server_name', 'aliases', 'access_log', 'proxy_targets', 'req_24h', 'req_7d', 'hc_24h', 'shared', 'sampled', 'conf_file'],
  Server_Hub_Ips: ['id', 'scan_date', 'host', 'ip', 'iface', 'used_by', 'is_primary'],
  Server_Hub_Sshd: ['id', 'scan_date', 'host', 'max_sessions', 'max_startups', 'active_sessions'],
};
const jvm = (ad, ek) => ({ id: ad, scan_date: gun, host: APP, gen: 7, jvm: ad, grp: 'g', running: 0, auto_start: 'false', server_state: 'stopped', ports: '', running_src: 'PS_ABSENT', cfg_src: 'CLI_WILDCARD', ...ek });
let loadedAt = new Date(Date.now() - 3600 * 1000).toISOString();
const satirlar = () => ({
  Server_Hub_Hosts: [{ id: 1, scan_date: gun, host: APP, products: 'JBOSS7', wall_s: 1, cpu_s: 0.1, note: '', scan_ver: '2.1', rec_counts: '', scan_errors: '', proc_visibility: 'FULL', sock_visibility: 'PID', loaded_at: loadedAt }],
  Server_Hub_Jboss: [{ id: 1, scan_date: gun, host: APP, gen: 7, host_name: 'm', host_state: 'running', cli: 'OK', note: '' }],
  Server_Hub_Jvms: [
    jvm('durmus'),
    jvm('kosan', { running: 1, running_src: 'PS', auto_start: 'true', server_state: 'running', ports: '8080' }),
    jvm('gizli', { running_src: 'UNMEASURED', auto_start: 'true', server_state: 'unknown' }),
  ],
});

let tamOkuma = 0;
let semaOkuma = 0;
let semaDussun = false;
stub('../../inventory/mssql.cjs', {
  sql: { NVarChar: () => 'nvarchar' },
  query: async (q) => {
    const s = String(q);
    if (/OBJECT_ID\('dbo\.Server_Hub_Hosts'\) AS oid/.test(s)) {
      tamOkuma += 1;
      return { recordset: [{ oid: 1 }] };
    }
    if (/FROM sys\.columns c WHERE c\.object_id IN/.test(s)) {
      semaOkuma += 1;
      if (semaDussun) throw new Error('Timeout expired');
      const out = [];
      for (const m of s.matchAll(/OBJECT_ID\('dbo\.(\w+)'\)/g)) for (const c of SEMA[m[1]] || []) out.push({ tbl: m[1], name: c });
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
stub('../../ansible/playbook-registry.cjs', { getByKey: async () => ({ enabled: true, awxServerId: 1 }), getEffectiveTemplateId: () => 77 });
stub('../../opsx/index.cjs', {
  extractStatsKey: (a, k) => (a && a[k] && typeof a[k] === 'object' ? a[k] : null),
});

// Sahte AWX: sablon tek GET / liste sayaclari, baslatilan isler, is durumlari.
const awx = { ozet: 0, liste: 0, launch: [], durum: new Map(), ozetDussun: false, playbook: 'bmw_automation_folder/server_hub/server_hub_fix.yml' };
stub('../../ansible/runner.cjs', {
  getServers: () => [{ id: 1 }],
  getTemplateSummaryOnServer: async (_s, id) => {
    awx.ozet += 1;
    if (awx.ozetDussun) throw new Error('AWX yok');
    return { id, name: 'fix', playbook: awx.playbook, askVariablesOnLaunch: true };
  },
  listTemplatesForServer: async () => {
    awx.liste += 1;
    return [{ id: 77, name: 'fix', playbook: awx.playbook, ask_variables: true }];
  },
  launchJobOnServer: async (serverId, templateId, extraVars) => {
    const jobId = 900 + awx.launch.length;
    awx.launch.push({ serverId, templateId, extraVars, jobId });
    return { jobId, status: 'pending' };
  },
  getJobStatusOnServer: async (_s, jobId) => awx.durum.get(jobId) || { status: 'running', artifacts: {} },
  getJobOutputOnServer: async () => ({ output: '' }),
});

const SH = require('../index.cjs');

beforeEach(() => {
  SH._onbellekSifirlaForTest();
  tamOkuma = 0;
  semaOkuma = 0;
  semaDussun = false;
  awx.ozet = 0;
  awx.liste = 0;
  awx.launch.length = 0;
  awx.durum.clear();
  awx.ozetDussun = false;
  loadedAt = new Date(Date.now() - 3600 * 1000).toISOString();
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
const post = (kok, body) =>
  fetch(`${kok}/jvm-autostart`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ host: APP, gen: 7, confirmed: true, ...body }),
    signal: AbortSignal.timeout(5000),
  });
const al = (url) => fetch(url, { signal: AbortSignal.timeout(5000) });
const sonuc = (action, durum, mesaj = 'x') => ({
  server_hub_fix_result: { host: APP, action, plan_only: false, line: `RESULT\t${action}\t${durum}\t${mesaj}` },
});

test('AS1 dogrulama katmani', () => {
  const { kur, sonucSatiri } = require('../autostart-dogrulama.cjs');
  assert.deepEqual(sonucSatiri('RESULT\tjboss_autostart_on\tOK\tpay auto-start=true'), {
    action: 'jboss_autostart_on',
    durum: 'OK',
    mesaj: 'pay auto-start=true',
  });
  assert.equal(sonucSatiri('cikti yok'), null);
  let simdi = 1_000_000;
  const k = kur({ simdi: () => simdi });
  const h = { host: APP, scanDate: gun, loadedAt: simdi - 1000 };
  const j = { gen: 7, name: 'Pay', autoStart: 'false' };
  const sr = (action, durum, ek = {}) => ({ action, plan_only: false, line: `RESULT\t${action}\t${durum}\tm`, ...ek });
  // bilinmeyen is: katmanin isi degil (cagiran onbellegi siler)
  assert.deepEqual(k.isBitti(1, 5, 'successful', sr('jboss_autostart_on', 'OK')), { kayitli: false });
  // FAIL / PLAN / baska eylem / failed durum: deger YOK
  for (const [st, r] of [
    ['failed', sr('jboss_autostart_on', 'FAIL')],
    // is 'successful' olsa da satir FAIL / PLAN ise dogrulama YOK (yalniz OK | SKIP)
    ['successful', sr('jboss_autostart_on', 'FAIL')],
    ['successful', sr('jboss_autostart_on', 'PLAN')],
    ['successful', sr('jboss_autostart_on', 'PLAN', { plan_only: 'True' })],
    ['successful', sr('jboss_autostart_off', 'OK')],
    ['successful', null],
  ]) {
    k.isKaydet(1, 6, { host: APP, gen: 7, jvm: 'pay', action: 'jboss_autostart_on', h });
    const b = k.isBitti(1, 6, st, r);
    assert.equal(b.kayitli, true);
    assert.equal(b.dogrulandi, false, JSON.stringify(r));
    assert.equal(k.gecerli(h, j), null);
  }
  // baska eylem kaydi alinmaz
  k.isKaydet(1, 7, { host: APP, gen: 7, jvm: 'pay', action: 'jboss_retire', h });
  assert.deepEqual(k.isBitti(1, 7, 'successful', sr('jboss_retire', 'OK')), { kayitli: false });
  // OK: dogrulandi; ikinci kez islenmez
  k.isKaydet(1, 8, { host: APP, gen: 7, jvm: 'pay', action: 'jboss_autostart_on', h });
  simdi += 10;
  const ok = k.isBitti(1, 8, 'successful', sr('jboss_autostart_on', 'OK'));
  assert.equal(ok.dogrulandi, true);
  assert.equal(ok.deger, 'true');
  assert.deepEqual(k.isBitti(1, 8, 'successful', sr('jboss_autostart_on', 'OK')), { kayitli: false });
  const u = k.uygulaJvm(h, j);
  assert.equal(u.autoStart, 'true');
  assert.equal(u.autoStartTarama, 'false');
  assert.equal(u.autoStartDogrulama.jobId, 8);
  // SKIP de dogrular (betik CLI'de zaten hedef degeri okudu)
  k.isKaydet(1, 9, { host: APP, gen: 7, jvm: 'pay', action: 'jboss_autostart_off', h });
  assert.equal(k.isBitti(1, 9, 'successful', sr('jboss_autostart_off', 'SKIP')).deger, 'false');
  assert.equal(k.gecerli(h, j).autoStart, 'false');
  // yeni tarama (dogrulamadan SONRA yuklendi): tarama tek kaynak
  assert.equal(k.gecerli({ ...h, loadedAt: simdi + 5 }, j), null);
  // 24 saat
  k.isKaydet(1, 10, { host: APP, gen: 7, jvm: 'pay', action: 'jboss_autostart_on', h });
  k.isBitti(1, 10, 'successful', sr('jboss_autostart_on', 'OK'));
  simdi += 24 * 3600 * 1000 + 1;
  assert.equal(k.gecerli(h, j), null);
});

test('AS2 calisan JVM de KAPAT 400, is acilmaz; olculemeyen kapi degil; durmus JVM de is acilir', async () => {
  await httpIle(async (kok) => {
    const r = await post(kok, { jvm: 'kosan', enable: false });
    assert.equal(r.status, 400);
    assert.match((await r.json()).message, /ÇALIŞIYOR/);
    assert.equal(awx.launch.length, 0, 'calisan JVM icin is acildi');
    const g = await post(kok, { jvm: 'gizli', enable: false });
    assert.equal(g.status, 200, 'calisma durumu olculemeyen JVM kapida kaldi');
    const d = await post(kok, { jvm: 'durmus', enable: true });
    assert.equal(d.status, 200);
    assert.equal(awx.launch.length, 2);
    assert.deepEqual(awx.launch[1].extraVars, { target_host: APP, action: 'jboss_autostart_on', plan_only: false, reload: false, gen: 7, jvm: 'durmus' });
    assert.match(d.headers.get('server-timing'), /^assess;dur=\d+, launch;dur=\d+$/);
  });
});

test('AS3 launch basina sablon TEK GET, liste hic', async () => {
  await httpIle(async (kok) => {
    const d = await post(kok, { jvm: 'durmus', enable: true });
    assert.equal(d.status, 200);
    assert.equal(awx.ozet, 1, `sablon ${awx.ozet} kez okundu`);
    assert.equal(awx.liste, 0, 'tum sablon listesi okundu');
    // yanlis playbook: AYNI 409 (TP1), is acilmaz
    awx.playbook = 'x/app_retirement_rollback.yml';
    try {
      const y = await post(kok, { jvm: 'durmus', enable: true });
      assert.equal(y.status, 409);
      assert.equal(awx.launch.length, 1);
    } finally {
      awx.playbook = 'bmw_automation_folder/server_hub/server_hub_fix.yml';
    }
  });
});

test('AS4 uctan uca: dogrulanan deger /host ta, ikinci tik zaten, onbellek silinmez', async () => {
  await httpIle(async (kok) => {
    const d = await (await post(kok, { jvm: 'durmus', enable: true })).json();
    assert.equal(d.ok, true);
    const jobId = d.jobId;
    awx.durum.set(jobId, { status: 'successful', artifacts: sonuc('jboss_autostart_on', 'OK', 'durmus auto-start=true (CLI ile dogrulandi)') });
    const okuma0 = tamOkuma;
    const js = await (await al(`${kok}/job-status/1/${jobId}`)).json();
    assert.equal(js.status, 'successful');
    assert.deepEqual(js.autoStart, { dogrulandi: true, deger: 'true' });
    const h = await al(`${kok}/host/${APP}`);
    assert.equal(h.headers.get('server-timing'), 'sh;desc="onbellek"', 'auto-start isi bitince onbellek silindi');
    assert.equal(tamOkuma, okuma0, 'auto-start isi bitince tam okuma yapildi');
    const j = (await h.json()).host.jvms.find((x) => x.name === 'durmus');
    assert.equal(j.autoStart, 'true', 'dogrulanan deger ayrintida yok');
    assert.equal(j.autoStartTarama, 'false');
    assert.equal(j.autoStartDogrulama.jobId, jobId);
    const ikinci = await post(kok, { jvm: 'durmus', enable: true });
    assert.equal(ikinci.status, 400);
    assert.match((await ikinci.json()).message, new RegExp(`zaten auto-start AÇIK.*iş #${jobId} ile doğrulandı`));
    assert.equal(awx.launch.length, 1, 'ayni is ikinci kez acildi');
    // Baska is (or. tarama; katmanda kaydi yok) bitince onbellek eskisi gibi silinir.
    awx.durum.set(4242, { status: 'successful', artifacts: {} });
    await al(`${kok}/job-status/1/4242`);
    const sonra = await al(`${kok}/host/${APP}`);
    assert.match(sonra.headers.get('server-timing'), /^sh;desc="taze"/);
    // Yeni tarama (loaded_at dogrulamadan sonra) gelince tarama tek kaynak.
    loadedAt = new Date(Date.now() + 60 * 1000).toISOString();
    const yeni = await (await al(`${kok}/host/${APP}?fresh=1`)).json();
    assert.equal(yeni.host.jvms.find((x) => x.name === 'durmus').autoStart, 'false');
  });
});

test('AS5 preflight: tek okuma dusunce liste yedek yolu; ayni hata kodlari', async () => {
  const pf = require('../../ansible/template-preflight.cjs');
  awx.ozetDussun = true;
  const t = await pf.sablonOku(1, 77);
  assert.equal(t.playbook, awx.playbook);
  assert.equal(awx.liste, 1);
  awx.ozetDussun = false;
  assert.throws(
    () => pf.sablonKontrol({ name: 'x', playbook: 'a/b.yml', ask_variables: true }, { templateId: 77, key: 'server_hub_fix', extraVars: { a: 1 } }),
    (e) => e.status === 409 && e.code === 'awx_template_playbook_mismatch',
  );
  assert.throws(
    () => pf.sablonKontrol({ name: 'x', playbook: 'server_hub_fix.yml', ask_variables: false }, { templateId: 77, key: 'server_hub_fix', extraVars: { a: 1 } }),
    (e) => e.status === 409 && e.code === 'awx_prompt_on_launch_disabled',
  );
  pf.sablonKontrol(null, { templateId: 77, key: 'server_hub_fix', extraVars: { a: 1 } }); // fail-open
  pf.sablonKontrol({ name: 'x', playbook: 'server_hub_fix.yml', ask_variables: null }, { templateId: 77, key: 'server_hub_fix', extraVars: { a: 1 } });
});

test('AS6 etiket hesabi onbellegi (ayni girdi -> yeniden hesap yok)', async () => {
  const { etiketHesabiKur } = require('../retire-uclar.cjs');
  const a = { tableMissing: false, hosts: [] };
  let kosu = 0;
  let kontroller = new Map([['k1', { sonuc: 'DOGRULANDI', imza: 'i' }]]);
  const etiketleFn = () => {
    kosu += 1;
    return {
      ozet: { toplam: 2 },
      etiketler: [
        { anahtar: 'e1', hostlar: [APP, 'GBX'], kopyalar: [{}, {}] },
        { anahtar: 'e2', hostlar: ['GBX'], kopyalar: [{}] },
      ],
    };
  };
  const bag = { getAssessment: async () => a, ayarlar: { oku: async () => ({ etiketler: { R1: 'KESIN' } }) }, kontrol: { kontrolleriOku: async () => kontroller } };
  const hesap = etiketHesabiKur({ ...bag, etiketleFn });
  const r1 = await hesap(false);
  const r2 = await hesap(false);
  assert.equal(kosu, 1, 'ayni girdilerde etiketle yeniden kostu');
  assert.equal(r1.sonuc, r2.sonuc);
  kontroller = new Map([['k1', { sonuc: 'YANLIS_ALARM', imza: 'i' }]]);
  await hesap(false);
  assert.equal(kosu, 2, 'kontrol degisince yeniden hesaplanmadi');
});

test('AS6b ?host= suzgeci etiketleri gercekten daraltir', async () => {
  const p = require.resolve('../retire-uclar.cjs');
  const etPath = require.resolve('../retire-etiket.cjs');
  const kayitli = require.cache[etPath];
  const kayitliUc = require.cache[p];
  const gercek = require('../retire-etiket.cjs');
  stub('../retire-etiket.cjs', {
    ...gercek,
    etiketle: () => ({
      ozet: { toplam: 2 },
      etiketler: [
        { anahtar: 'e1', hostlar: [APP, 'GBX'], kopyalar: [{}, {}] },
        { anahtar: 'e2', hostlar: ['GBX'], kopyalar: [{}] },
      ],
    }),
  });
  delete require.cache[p];
  try {
    const { mount } = require('../retire-uclar.cjs');
    const express = require('express');
    const app = express();
    const router = express.Router();
    mount(router, {
      getAssessment: async () => ({ tableMissing: false, hosts: [] }),
      ayarlar: { oku: async () => ({ etiketler: {} }) },
      kontrol: { kontrolleriOku: async () => new Map() },
      audit: () => {},
    });
    app.use(router);
    const srv = await new Promise((r) => {
      const s = app.listen(0, '127.0.0.1', () => r(s));
    });
    try {
      const kok = `http://127.0.0.1:${srv.address().port}`;
      const tum = await (await al(`${kok}/retire-etiketleri`)).json();
      const tek = await (await al(`${kok}/retire-etiketleri?host=${APP}`)).json();
      assert.deepEqual(tum.etiketler.map((e) => e.anahtar), ['e1', 'e2']);
      assert.deepEqual(tek.etiketler.map((e) => e.anahtar), ['e1'], 'host suzgeci daraltmadi');
      assert.deepEqual(tek.ozet, tum.ozet, 'ozet filo geneli kalmali');
      assert.equal(tek.etiketler[0].kopyaSayisi, 2);
    } finally {
      srv.close();
    }
  } finally {
    if (kayitli) require.cache[etPath] = kayitli;
    else delete require.cache[etPath];
    if (kayitliUc) require.cache[p] = kayitliUc;
    else delete require.cache[p];
  }
});

test('AS7 iliski /iliski/karar bayat grafik hemen, arkada tek tazeleme', async () => {
  const { iliskiHesabiKur } = require('../iliski-uclar.cjs');
  let simdi = 1000;
  let okuma = 0;
  let a = { tableMissing: false, hosts: [] };
  let coz = null;
  const hesap = iliskiHesabiKur({
    getAssessment: async () => a,
    iliskiVerisi: async () => {
      okuma += 1;
      if (coz) await new Promise((r) => (coz = r));
      return {};
    },
    simdi: () => simdi,
  });
  const ilk = await hesap(false);
  assert.equal(okuma, 1);
  a = { tableMissing: false, hosts: [] }; // yeni degerlendirme nesnesi
  simdi += 61000;
  coz = () => {};
  const b = await hesap(false, { bayatOlur: true });
  assert.equal(b.bayat, true, 'bayat isaretli degil');
  assert.equal(b.grafik, ilk.grafik, 'bayat grafik hemen donmedi');
  const c = await hesap(false, { bayatOlur: true });
  assert.equal(c.grafik, ilk.grafik);
  await new Promise((r) => setImmediate(r));
  assert.equal(okuma, 2, 'iki bayat istek tek tazeleme baslatmali');
  coz();
  coz = null;
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  const d = await hesap(false, { bayatOlur: true });
  assert.notEqual(d.grafik, ilk.grafik, 'arka plan sonucu yazilmadi');
  assert.equal(d.bayat, undefined);
  // bayatOlur yoksa (yazma / imza uclari) bekler
  a = { tableMissing: false, hosts: [] };
  const e = await hesap(false);
  assert.equal(e.bayat, undefined);
  assert.equal(e.a, a);
});

test('AS8 /host sema 60 sn onbellekten; okunamadi onbellege alinmaz', async () => {
  await httpIle(async (kok) => {
    await SH.getAssessment(false);
    const s0 = semaOkuma;
    await al(`${kok}/host/${APP}`);
    await al(`${kok}/host/${APP}`);
    assert.equal(semaOkuma - s0, 1, `iki acilista sema ${semaOkuma - s0} kez okundu`);
    SH._onbellekSifirlaForTest();
    await SH.getAssessment(false);
    semaDussun = true;
    const s1 = semaOkuma;
    await al(`${kok}/host/${APP}`);
    await al(`${kok}/host/${APP}`);
    assert.equal(semaOkuma - s1, 2, 'okunamayan sema onbellege alindi');
  });
});

// -- Inceleme turu (2026-11-14) ----------------------------------------------------------
//   AS9  saat tabani: loaded_at DB'de SYSDATETIME() (UTC+3), surucu UTC sanar -> h.loadedAt ~3 saat ILERI.
//        Dogrulama katmani bunu duvar saatiyle karsilastirip hemen dusuyordu (ekran eski degere donuyordu).
//   AS10 suren is kilidi: ayni JVM'de Portal'in actigi is surerken ikinci istek 409 (is acilmaz); is AWX'te
//        bittiyse (istemci yoklamayi birakmis) kilit kontrolu sonucu isler ve "zaten" kapisi onu gorur
//   AS11 bulgu katmani: dogrulanan auto-start bulgusu /findings ve /host'ta dugmesini kaybeder (fix null)
//   AS13 iliski bayat grafik yalniz AYNI tarama verisinden; yeni tarama yuklendiyse bekler
const OK_SATIRI = (action) => ({ action, plan_only: false, line: `RESULT\t${action}\tOK\tm` });

test('AS9 saat tabani: loaded_at +3 saat kaymis olsa da dogrulama katmani kalir', async () => {
  const { kur } = require('../autostart-dogrulama.cjs');
  let simdi = 10_000_000;
  const k = kur({ simdi: () => simdi });
  const KAYMA = 3 * 3600 * 1000;
  // tarama 1 saat once yuklendi; DB yerel saati surucude UTC sanildigi icin +3 saat
  const h = { host: APP, scanDate: gun, loadedAt: simdi - 3600 * 1000 + KAYMA };
  const j = { gen: 7, name: 'pay', autoStart: 'false' };
  k.isKaydet(1, 50, { host: APP, gen: 7, jvm: 'pay', action: 'jboss_autostart_on', h });
  simdi += 60_000;
  assert.equal(k.isBitti(1, 50, 'successful', OK_SATIRI('jboss_autostart_on')).dogrulandi, true);
  assert.equal(k.uygulaJvm(h, j).autoStart, 'true', 'kaymis loaded_at katmani dusurdu');
  // ayni kaymayla gelen YENI tarama (loaded_at artti) katmani dusurur
  assert.equal(k.gecerli({ ...h, loadedAt: h.loadedAt + 1000 }, j), null);
  // is acilirken loaded_at yoktu, simdi var: yeni yukleyici yeni tarama yazdi
  const h0 = { host: APP, scanDate: gun, loadedAt: null };
  k.isKaydet(1, 51, { host: APP, gen: 7, jvm: 'pay', action: 'jboss_autostart_on', h: h0 });
  k.isBitti(1, 51, 'successful', OK_SATIRI('jboss_autostart_on'));
  assert.equal(k.gecerli(h0, j).autoStart, 'true');
  assert.equal(k.gecerli({ ...h0, loadedAt: 5 }, j), null);
  // uctan uca: tarama kaymis saatle "1 saat once" yuklenmis
  loadedAt = new Date(Date.now() - 3600 * 1000 + KAYMA).toISOString();
  await httpIle(async (kok) => {
    const d = await (await post(kok, { jvm: 'durmus', enable: true })).json();
    assert.equal(d.ok, true);
    awx.durum.set(d.jobId, { status: 'successful', artifacts: sonuc('jboss_autostart_on', 'OK') });
    await al(`${kok}/job-status/1/${d.jobId}`);
    const det = await (await al(`${kok}/host/${APP}`)).json();
    assert.equal(det.host.jvms.find((x) => x.name === 'durmus').autoStart, 'true', 'ekran eski degere dondu');
    const ikinci = await post(kok, { jvm: 'durmus', enable: true });
    assert.equal(ikinci.status, 400);
    assert.equal(awx.launch.length, 1, 'ayni is ikinci kez acildi');
  });
});

test('AS10 suren is kilidi: ikinci istek 409; AWX te biten is kilidi kaldirir ve sonucu islenir', async () => {
  await httpIle(async (kok) => {
    const d = await (await post(kok, { jvm: 'durmus', enable: true })).json();
    assert.equal(d.ok, true);
    // is suruyor (sahte AWX varsayilani running): zit yonde bile yeni is yok
    const zit = await post(kok, { jvm: 'durmus', enable: false });
    assert.equal(zit.status, 409);
    const zj = await zit.json();
    assert.equal(zj.code, 'autostart_is_suruyor');
    assert.match(zj.message, new RegExp(`#${d.jobId} hâlâ sürüyor`));
    assert.equal(awx.launch.length, 1, 'suren is varken ikinci is acildi');
    // baska JVM serbest
    assert.equal((await post(kok, { jvm: 'gizli', enable: false })).status, 200);
    // is AWX'te bitti ama istemci yoklamadi: kilit kontrolu sonucu isler, "zaten" kapisi gorur
    awx.durum.set(d.jobId, { status: 'successful', artifacts: sonuc('jboss_autostart_on', 'OK') });
    const tekrar = await post(kok, { jvm: 'durmus', enable: true });
    assert.equal(tekrar.status, 400);
    assert.match((await tekrar.json()).message, /zaten auto-start AÇIK.*doğrulandı/);
    // ve artik zit yon acilabilir
    assert.equal((await post(kok, { jvm: 'durmus', enable: false })).status, 200);
    assert.equal(awx.launch.length, 3);
  });
});

test('AS11 bulgu katmani: dogrulanan auto-start bulgusunun dugmesi kalkar', () => {
  const { kur } = require('../autostart-dogrulama.cjs');
  const k = kur();
  const h = { host: APP, scanDate: gun, loadedAt: 1000 };
  const f = { host: APP, code: 'REBOOT_RISK', fixable: true, fix: { action: 'jboss_autostart_on', gen: 7, jvm: 'pay' } };
  assert.equal(k.uygulaBulgu(h, f), f, 'katman bosken bulgu degismemeli');
  k.isKaydet(1, 60, { host: APP, gen: 7, jvm: 'pay', action: 'jboss_autostart_on', h });
  k.isBitti(1, 60, 'successful', OK_SATIRI('jboss_autostart_on'));
  const u = k.uygulaBulgu(h, f);
  assert.equal(u.fix, null);
  assert.equal(u.fixable, false);
  assert.equal(u.autoStartDogrulama.jobId, 60);
  // ters yonlu bulgu (hedef farkli) ve baska JVM dokunulmaz
  const ters = { ...f, fix: { action: 'jboss_autostart_off', gen: 7, jvm: 'pay' } };
  assert.equal(k.uygulaBulgu(h, ters), ters);
  const baska = { ...f, fix: { action: 'jboss_autostart_on', gen: 7, jvm: 'diger' } };
  assert.equal(k.uygulaBulgu(h, baska), baska);
  // detay bulgusunda fixable alani yoksa eklenmez
  const detay = { code: 'REBOOT_RISK', fix: { action: 'jboss_autostart_on', gen: 7, jvm: 'pay' } };
  assert.equal('fixable' in k.uygulaBulgu(h, detay), false);
});

test('AS11b /findings ve /host bulgulari katmanli', async () => {
  await httpIle(async (kok) => {
    const d = await (await post(kok, { jvm: 'durmus', enable: true })).json();
    awx.durum.set(d.jobId, { status: 'successful', artifacts: sonuc('jboss_autostart_on', 'OK') });
    await al(`${kok}/job-status/1/${d.jobId}`);
    // onbellekteki degerlendirmeye bu JVM icin auto-start ON oneren bir bulgu ekle
    const a = await SH.getAssessment(false);
    const h = a.hosts.find((x) => x.host === APP);
    h.findings.push({ severity: 'danger', area: 'jvm', code: 'REBOOT_RISK', text: 't', fix: { action: 'jboss_autostart_on', gen: 7, jvm: 'durmus' } });
    const fl = (await (await al(`${kok}/findings`)).json()).findings.find((f) => f.code === 'REBOOT_RISK');
    assert.ok(fl, 'bulgu listede yok');
    assert.equal(fl.fix, null, '/findings dugmesi kalkmadi');
    assert.equal(fl.autoStartDogrulama.jobId, d.jobId);
    const df = (await (await al(`${kok}/host/${APP}`)).json()).host.findings.find((f) => f.code === 'REBOOT_RISK');
    assert.equal(df.fix, null, '/host bulgusu dugmesini kaybetmedi');
  });
});

test('AS13 iliski bayat grafik yalniz ayni tarama verisinden', async () => {
  const { iliskiHesabiKur } = require('../iliski-uclar.cjs');
  let simdi = 1000;
  let a = { tableMissing: false, latestScan: gun, hosts: [{ host: APP, loadedAt: 100, jvms: [], findings: [] }] };
  const hesap = iliskiHesabiKur({ getAssessment: async () => a, iliskiVerisi: async () => ({}), simdi: () => simdi });
  const ilk = await hesap(false);
  // ayni veri, yeni nesne (onbellek tazelendi): bayat grafik hemen
  a = { ...a, hosts: [{ ...a.hosts[0] }] };
  simdi += 61000;
  assert.equal((await hesap(false, { bayatOlur: true })).bayat, true);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  // yeni tarama yuklendi (loaded_at artti): bekler, eski karar donmez
  a = { ...a, hosts: [{ ...a.hosts[0], loadedAt: 200 }] };
  simdi += 61000;
  const yeni = await hesap(false, { bayatOlur: true });
  assert.equal(yeni.bayat, undefined, 'yeni taramadan sonra bayat grafik dondu');
  assert.equal(yeni.a, a);
  assert.notEqual(yeni.grafik, ilk.grafik);
});
