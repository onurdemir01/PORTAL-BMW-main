// server/opsx/__tests__/toplu-restart-baslat.test.js - Server Hub > Toplu Restart'in OpsX ayagi (2026-11-14).
//
// topluRestartBaslat (server/opsx/index.cjs): tek JVM restart'i, POST /api/opsx/run ile AYNI fonksiyonlar
// (legacyIstegiHazirla + opsxIsiBaslat). Kilitlenen kurallar:
//   OB1 test ortami: limit = host + ORLABT02, server_config_map tek JVM / kurulum kolu, jboss_version, is gecmisi +
//       'opsx_operation' denetimi, istegi yapan onaylayan admin
//   OB2 URETIM HIC BASLATILMAZ: envanter ortami prod / bos, sunucu adi prod -> 409 code 'uretim', launch YOK
//       (Smart onay kapisi toplu yurutmede calisamaz; kapi atlanmaz, yol acilmaz)
//   OB3 sablon Limit'i kabul etmiyor -> 409 'limit_kabul_edilmiyor'; olculemiyor -> 503 'limit_olculemedi'; launch YOK
//   OB4 metadatahub standalone hostlari (adla BASLAYAN) -> 409 'standalone', envantere bile gidilmez
//   OB5 anti-TOCTOU: uygulama o sunucuda yok / kurulum kolu farkli -> 400, launch YOK
//   OB6 kaynak bekcisi: route ayni fonksiyonlari kullanir; prod kapisi route'ta launch'tan once; toplu yol prod
//       kapisini (Smart bileti) cagirmaz ama uretimIstegi'ni launch'tan once cagirir
//   OB7 ad kurali: envanter TEST diyen ama adinin ortam harfi P olan host -> 409 'uretim', launch YOK
//   OB8 belirsiz launch: AWX POST zaman asimi / 5xx -> launchBelirsiz (Toplu Restart 'dokunulmadi' demez);
//       AWX 4xx reddi kesin -> isaret YOK
'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function stub(rel, exports) {
  const p = require.resolve(rel);
  const m = new Module(p);
  m.filename = p;
  m.loaded = true;
  m.exports = exports;
  require.cache[p] = m;
}

const S = {
  inv: [],
  launches: [],
  history: [],
  audits: [],
  settings: { askLimitOnLaunch: true },
  settingsHata: null,
  poolSorgu: 0,
  launchHata: null,
};
stub('../../inventory/mssql.cjs', {
  getPool: async () => ({
    request: () => {
      const inp = {};
      return {
        input: (k, v) => {
          inp[k] = v;
        },
        query: async () => {
          S.poolSorgu += 1;
          return { recordset: S.inv.filter((r) => r.app === inp.app) };
        },
      };
    },
  }),
});
stub('../../config/apps-table.cjs', { getAppsTable: () => 'dbo.MWAppsInventory' });
stub('../../ansible/playbook-registry.cjs', {
  getByKey: async (k) => (k === 'opsx_legacy_operation' ? { enabled: true, awxServerId: 3 } : null),
  getEffectiveTemplateId: () => 77,
});
stub('../config.cjs', {
  getConfig: async () => ({
    legacy: {
      extraVars: '',
      applicationKey: 'application',
      operationKey: 'operation',
      separator: ',',
    },
  }),
  parseExtraVarLines: () => ({ vars: {}, rejected: [] }),
});
stub('../../ansible/runner.cjs', {
  getTemplateLaunchSettingsOnServer: async () => {
    if (S.settingsHata) throw new Error(S.settingsHata);
    return S.settings;
  },
  launchJobOnServer: async (serverId, templateId, extraVars, limit, user) => {
    S.launches.push({ serverId, templateId, extraVars, limit, user: user && user.username });
    if (S.launchHata) throw S.launchHata;
    return { jobId: 4242, status: 'pending' };
  },
});
stub('../../ansible/template-preflight.cjs', { assertTemplateAcceptsExtraVars: async () => {} });
stub('../../db/index.cjs', {
  query: async (sql, p) => {
    if (/INSERT INTO ansible_job_history/.test(sql)) S.history.push(p);
    return { rows: [], rowCount: 1 };
  },
});
stub('../../audit/index.cjs', {
  auditPortal: (req, tur, d) =>
    S.audits.push({ user: req.session.user.username, tur, d: JSON.parse(d.detail) }),
});

const O = require('../index.cjs');

const istek = (u = 'mehmet') => ({ session: { user: { username: u, role: 'Admin' } } });
const satir = (host, env, appPath) => ({
  app: 'crm',
  host,
  env,
  jboss_version: '8.0.1',
  status: 'running',
  app_path: appPath,
});

beforeEach(() => {
  S.inv = [
    satir('APP01', 'TEST', '/vhosting8/crm.ear'),
    satir('APP02', 'TEST', '/vhosting/crm.ear'),
  ];
  S.launches = [];
  S.history = [];
  S.audits = [];
  S.settings = { askLimitOnLaunch: true };
  S.settingsHata = null;
  S.poolSorgu = 0;
  S.launchHata = null;
  const log = console.log;
  console.log = () => {};
  process.on('exit', () => {
    console.log = log;
  });
});

test('OB1 test ortami: tek JVM, limit host + ORLABT02, kurulum kolu, gecmis + denetim', async () => {
  const r = await O.topluRestartBaslat({
    req: istek(),
    application: 'crm',
    host: 'app01',
    gen: 8,
    jvm: 'crm',
  });
  assert.deepEqual(
    [r.jobId, r.awxServerId, r.templateId, r.limit],
    [4242, 3, 77, 'APP01,ORLABT02'],
  );
  assert.equal(S.launches.length, 1);
  const l = S.launches[0];
  assert.deepEqual(l.extraVars, {
    application: 'crm',
    operation: 'restart',
    jboss_version: 'jboss8',
    server_config_map: { APP01: [{ name: 'crm', jbossMajor: '8' }] },
  });
  assert.equal(l.limit, 'APP01,ORLABT02');
  assert.equal(l.user, 'mehmet');
  assert.equal(S.history.length, 1);
  assert.equal(S.audits.length, 1);
  assert.deepEqual(
    [S.audits[0].tur, S.audits[0].user, S.audits[0].d.jobId],
    ['opsx_operation', 'mehmet', 4242],
  );
});

test('OB2 uretim hic baslatilmaz: envanter prod, bos ortam, prod sunucu adi', async () => {
  S.inv = [satir('APP01', 'Production', '/vhosting8/crm.ear')];
  await assert.rejects(
    O.topluRestartBaslat({ req: istek(), application: 'crm', host: 'APP01', gen: 8, jvm: 'crm' }),
    (e) => e.status === 409 && e.code === 'uretim' && /OpsX'ten tek tek/.test(e.message),
  );
  S.inv = [satir('APP01', '', '/vhosting8/crm.ear')];
  await assert.rejects(
    O.topluRestartBaslat({ req: istek(), application: 'crm', host: 'APP01', gen: 8, jvm: 'crm' }),
    (e) => e.code === 'uretim' && /ortamı bilinmiyor/.test(e.message),
  );
  S.inv = [satir('ORJBPROD01', 'TEST', '/vhosting8/crm.ear')];
  await assert.rejects(
    O.topluRestartBaslat({
      req: istek(),
      application: 'crm',
      host: 'ORJBPROD01',
      gen: 8,
      jvm: 'crm',
    }),
    (e) => e.code === 'uretim' && /sunucu=ORJBPROD01/.test(e.message),
  );
  assert.equal(S.launches.length, 0);
  assert.equal(S.audits.length, 0);
});

test('OB3 sablon Limit kabul etmiyor / olculemiyor: launch YOK', async () => {
  S.settings = { askLimitOnLaunch: false };
  await assert.rejects(
    O.topluRestartBaslat({ req: istek(), application: 'crm', host: 'APP01', gen: 8, jvm: 'crm' }),
    (e) =>
      e.status === 409 && e.code === 'limit_kabul_edilmiyor' && /Prompt on launch/.test(e.message),
  );
  S.settings = {};
  await assert.rejects(
    O.topluRestartBaslat({ req: istek(), application: 'crm', host: 'APP01', gen: 8, jvm: 'crm' }),
    (e) => e.code === 'limit_kabul_edilmiyor',
  );
  S.settingsHata = 'AWX 502';
  await assert.rejects(
    O.topluRestartBaslat({ req: istek(), application: 'crm', host: 'APP01', gen: 8, jvm: 'crm' }),
    (e) => e.status === 503 && e.code === 'limit_olculemedi',
  );
  await assert.rejects(O.legacyLimitKontrol(), (e) => e.code === 'limit_olculemedi');
  assert.equal(S.launches.length, 0);
});

test('OB4 metadatahub standalone: envantere gidilmeden reddedilir', async () => {
  for (const h of ['ORABAT01', 'orabap02', 'ORABAT01X']) {
    await assert.rejects(
      O.topluRestartBaslat({ req: istek(), application: 'crm', host: h, gen: 8, jvm: 'crm' }),
      (e) => e.code === 'standalone',
    );
  }
  assert.equal(O.metadatahubHostMu('ORABAX01'), false);
  assert.equal(S.poolSorgu, 0);
  assert.equal(S.launches.length, 0);
});

test('OB5 anti-TOCTOU: uygulama sunucuda yok / kurulum kolu farkli -> 400', async () => {
  await assert.rejects(
    O.topluRestartBaslat({ req: istek(), application: 'crm', host: 'APP09', gen: 8, jvm: 'crm' }),
    (e) => e.status === 400 && /ait değil/.test(e.message),
  );
  await assert.rejects(
    O.topluRestartBaslat({ req: istek(), application: 'crm', host: 'APP02', gen: 8, jvm: 'crm' }),
    (e) => e.status === 400 && /JBoss 8/.test(e.message),
  );
  await assert.rejects(
    O.topluRestartBaslat({
      req: istek(),
      application: 'crm',
      host: 'APP01',
      gen: 8,
      jvm: 'crm;rm',
    }),
    (e) => e.status === 400 && /server-config/.test(e.message),
  );
  assert.equal(S.launches.length, 0);
});

test("OB6 kaynak bekcisi: route ayni fonksiyonlar; prod kapisi route'ta launch'tan once; toplu yol Smart kapisi cagirmaz", () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
  const route = src.slice(
    src.indexOf("app.post('/api/opsx/run'"),
    src.indexOf('// ── Thread/Heap Dump'),
  );
  assert.match(route, /await legacyIstegiHazirla\(/);
  const kapi = route.indexOf('opsxProductionKapisi(');
  const bas = route.indexOf('await opsxIsiBaslat(');
  assert.ok(kapi > 0 && bas > kapi, "route: prod kapisi launch'tan once olmali");
  const fn = src.slice(
    src.indexOf('async function topluRestartBaslat('),
    src.indexOf('function initOpsX('),
  );
  assert.ok(!fn.includes('opsxProductionKapisi'), 'toplu yol Smart bileti acmamali');
  const u = fn.indexOf('uretimIstegi(');
  const l = fn.indexOf('opsxIsiBaslat(');
  const lk = fn.indexOf('legacyLimitKontrol()');
  assert.ok(u > 0 && l > u && lk > 0 && l > lk, "uretim ve limit kontrolu launch'tan once");
  assert.ok(!/launchJobOnServer/.test(fn), "toplu yol launch'i yalniz opsxIsiBaslat ile yapar");
});

test('OB7 ad kurali: envanter TEST ama ad prod (ortam harfi P) -> uretim, launch YOK', async () => {
  S.inv = [satir('ORJBOP18', 'TEST', '/vhosting8/crm.ear')];
  await assert.rejects(
    O.topluRestartBaslat({
      req: istek(),
      application: 'crm',
      host: 'ORJBOP18',
      gen: 8,
      jvm: 'crm',
    }),
    (e) => e.status === 409 && e.code === 'uretim' && /ad. kural/.test(e.message),
  );
  assert.equal(S.launches.length, 0);
  assert.equal(O.adKuraliProdMu('gojbwp03.dom.local'), true);
  for (const h of ['ORJBOT18', 'ORJBOD01', 'APP01', 'GOJBAQ03'])
    assert.equal(O.adKuraliProdMu(h), false, h);
});

test('OB8 belirsiz launch: zaman asimi / 5xx isaretlenir, AWX 4xx reddi isaretlenmez', async () => {
  for (const [hata, belirsiz] of [
    [new Error('socket hang up'), true],
    [Object.assign(new Error('AWX HTTP 502'), { status: 502 }), true],
    [Object.assign(new Error('AWX HTTP 400: limit'), { status: 400 }), false],
    [Object.assign(new Error('AWX HTTP 403'), { status: 403 }), false],
  ]) {
    S.launchHata = hata;
    await assert.rejects(
      O.topluRestartBaslat({ req: istek(), application: 'crm', host: 'APP01', gen: 8, jvm: 'crm' }),
      (e) => e === hata && (e.launchBelirsiz === true) === belirsiz,
    );
  }
  assert.equal(S.history.length, 0, 'basarisiz launch gecmise yazilmaz');
});
