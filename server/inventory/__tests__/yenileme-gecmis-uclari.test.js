// server/inventory/__tests__/yenileme-gecmis-uclari.test.js - Envanter yenileme (AWX) ve gecmis yapilandirma
// uclari gercek express ile (2026-11-24, kapsam PR-2). refresh-admin-only ve history-routes kaynak metnine bakar;
// burada uclar kosar. Sahte: dis DB (mssql), Portal DB, AWX runner, gecmis modulleri.
//   EY1 /refresh/run: Admin disi 403; secim dogrulamasi (bos, gecersiz, "tumu" + baska); Maestro2 yoksa 503;
//       tetik: tekillestirilmis secim AWX'e, gecmis + denetim; gecmis yazilamasa da basari; AWX hatasi durumu tasir
//   EY2 /refresh/job-status: gecersiz no 400; baskasinin isi 403 (Admin acik, DB hiccup fail-open); durum + cikti
//   EY3 gecmis okuma: /at /diff /series tarih dogrulamasi, gun sonu, gun tavani
//   EY4 /history/config: Admin; liste + aday tablolar; PUT dogrulama (ad, anahtar, tabloda olmayan kolon), UPDATE
//       yoksa INSERT, onbellek tazelenir; /history/snapshot zorla tick
'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

const KOK = path.join(__dirname, '..', '..');
function sahte(rel, exports) {
  const p = require.resolve(path.join(KOK, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const DIS = { kolonlar: ['hostname', 'ip', 'env'] };
sahte('inventory/mssql.cjs', {
  isAvailable: () => true,
  getPool: async () => null,
  poolStats: () => ({}),
  sql: new Proxy({}, { get: () => () => 'tip' }),
  query: async (q) => {
    const s = String(q);
    if (s.includes('INFORMATION_SCHEMA.COLUMNS'))
      return { recordset: DIS.kolonlar.map((c) => ({ COLUMN_NAME: c, DATA_TYPE: 'nvarchar' })) };
    if (s.includes('INFORMATION_SCHEMA.TABLES'))
      return { recordset: [{ TABLE_NAME: 'Inventory' }, { TABLE_NAME: 'Server_Hub_Ear' }] };
    return { recordset: [] };
  },
});
const P = {
  gecmis: null,
  gecmisHata: false,
  yazim: [],
  guncellenen: 0,
  insertHata: false,
  ayar: [],
};
sahte('db/index.cjs', {
  query: async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT TOP 1 username FROM ansible_job_history')) {
      if (P.gecmisHata) throw new Error('DB erisilemiyor');
      return { rows: P.gecmis ? [P.gecmis] : [] };
    }
    if (s.startsWith('INSERT INTO ansible_job_history')) {
      if (P.insertHata) throw new Error('gecmis yazilamadi');
      P.yazim.push({ s, params });
      return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('SELECT table_name, label, mode')) return { rows: P.ayar };
    if (s.startsWith('UPDATE inventory_history_config')) {
      P.yazim.push({ s, params });
      return { rows: [], rowCount: P.guncellenen };
    }
    if (s.startsWith('INSERT INTO inventory_history_config')) {
      P.yazim.push({ s, params });
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  },
});
sahte('auth/index.cjs', {
  getRequestUser: (req) => req.session?.user || null,
  getRequestRole: (req) => req.session?.user?.role || null,
});
sahte('auth/visibility.cjs', { requireVisiblePrefix: () => (req, res, next) => next() });
const denetim = [];
sahte('audit/index.cjs', {
  auditMutations: () => (req, res, next) => next(),
  auditPortal: (req, olay, ek) => denetim.push({ olay, detay: JSON.parse(ek.detail) }),
});
const R = {
  sunucular: [],
  launch: null,
  launchHata: null,
  cagri: [],
  durum: { status: 'running' },
};
sahte('ansible/runner.cjs', {
  getServers: () => R.sunucular,
  launchJobOnServer: async (...a) => {
    R.cagri.push(a);
    if (R.launchHata) throw R.launchHata;
    return R.launch;
  },
  getJobStatusOnServer: async () => R.durum,
  getJobOutputOnServer: async () => ({ output: 'PLAY RECAP' }),
});
const G = { cagri: [] };
sahte('inventory/history.cjs', {
  rowsAt: async (t, at) => {
    G.cagri.push(['at', t, at]);
    return [{ hostname: 'A' }];
  },
  diff: async (t, a, b) => {
    G.cagri.push(['diff', t, a, b]);
    return { added: [], removed: [], changed: [] };
  },
  rowCountSeries: async (t, gun) => {
    G.cagri.push(['series', t, gun]);
    return [];
  },
});
sahte('inventory/history-scheduler.cjs', { tick: async (o) => ({ zorla: o.force, alinan: 2 }) });

let srv;
let base;
let tazelendi = 0;
before(async () => {
  const hc = require('../history-config.cjs');
  const orijinal = hc.invalidateCache;
  hc.invalidateCache = () => {
    tazelendi++;
    return orijinal();
  };
  const app = express();
  app.use((req, res, next) => {
    const rol = req.headers['x-rol'];
    if (rol) req.session = { user: { username: req.headers['x-kim'] || 'ornekkisi', role: rol } };
    next();
  });
  require('../index.cjs').initInventory(app);
  await new Promise((r) => {
    srv = app.listen(0, '127.0.0.1', r);
  });
  base = `http://127.0.0.1:${srv.address().port}/api/inventory`;
});
after(() => srv.close());
beforeEach((t) => {
  R.sunucular = [{ id: 3, name: 'Maestro 2 AWX' }];
  Object.assign(R, {
    launch: { jobId: 77, status: 'pending' },
    launchHata: null,
    cagri: [],
    durum: { status: 'running' },
  });
  Object.assign(P, {
    gecmis: null,
    gecmisHata: false,
    yazim: [],
    guncellenen: 0,
    insertHata: false,
    ayar: [],
  });
  G.cagri = [];
  denetim.length = 0;
  t.mock.method(console, 'warn', () => {});
});

async function istek(yol, { rol = 'Admin', kim, method = 'GET', body } = {}) {
  const r = await fetch(base + yol, {
    method,
    headers: {
      ...(rol ? { 'x-rol': rol } : {}),
      ...(kim ? { 'x-kim': kim } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
}

test('EY1 /refresh/run: yetki, secim dogrulamasi, Maestro2, tetik', async () => {
  const run = (body, rol) => istek('/refresh/run', { method: 'POST', body, rol });
  assert.equal((await run({ choices: ['all'] }, 'User')).status, 403);
  for (const [body, re] of [
    [{}, /En az bir değer/],
    [{ choices: [] }, /En az bir değer/],
    [{ choices: ['nginx', 'oracle'] }, /Geçersiz seçim: oracle/],
    [{ choices: ['all', 'nginx'] }, /"Tümü" seçiliyken/],
  ]) {
    const r = await run(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.body.message, re);
  }
  R.sunucular = [{ id: 1, name: 'Maestro AWX' }];
  assert.equal((await run({ choices: ['nginx'] })).status, 503, 'maestro (2 olmayan) secildi');
  R.sunucular = [
    { id: 1, name: 'AWX Ana' },
    { id: 3, name: 'maestro_2' },
  ];
  const r = await run({ choices: [' NGINX ', 'jboss', 'nginx', ''] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, {
    ok: true,
    jobId: 77,
    status: 'pending',
    awxServerId: 3,
    choices: ['nginx', 'jboss'],
  });
  assert.deepEqual(R.cagri[0].slice(0, 3), [3, 612, { choise: 'nginx,jboss' }]);
  assert.equal(P.yazim[0].params[3], 'Envanteri Yenile');
  assert.deepEqual(denetim.at(-1), {
    olay: 'inventory_refresh',
    detay: { choices: ['nginx', 'jboss'], jobId: 77 },
  });

  P.insertHata = true;
  assert.equal((await run({ choices: ['all'] })).status, 200, 'gecmis hatasi tetigi bozmamali');
  R.launchHata = Object.assign(new Error('Prompt on launch kapali'), { status: 409 });
  const h = await run({ choices: ['all'] });
  assert.deepEqual([h.status, h.body.message], [409, 'Prompt on launch kapali']);
});

test('EY2 /refresh/job-status: dogrulama, sahiplik, durum', async () => {
  assert.equal((await istek('/refresh/job-status/0')).status, 400);
  assert.equal((await istek('/refresh/job-status/abc')).status, 400);
  P.gecmis = { username: 'BaskaKisi' };
  let r = await istek('/refresh/job-status/77', { rol: 'User' });
  assert.equal(r.status, 403);
  r = await istek('/refresh/job-status/77', { rol: 'User', kim: 'baskakisi' });
  assert.equal(r.status, 200, 'harf farki sahipligi bozmamali');
  r = await istek('/refresh/job-status/77');
  assert.deepEqual(r.body, { ok: true, status: 'running', output: 'PLAY RECAP' });
  P.gecmisHata = true;
  assert.equal(
    (await istek('/refresh/job-status/77', { rol: 'User' })).status,
    200,
    'DB hiccup fail-open',
  );
  R.sunucular = [];
  assert.equal((await istek('/refresh/job-status/77')).status, 503);
});

test('EY3 gecmis okuma uclari: tarih dogrulamasi, gun sonu, gun tavani', async () => {
  assert.equal((await istek('/history/at?table=Inventory&date=dun')).status, 400);
  let r = await istek('/history/at?table=Inventory&date=2026-11-20');
  assert.equal(r.body.at, '2026-11-20T23:59:59.999Z', 'yalniz tarih verilince gun sonu alinmali');
  assert.equal(r.body.count, 1);
  r = await istek('/history/at?table=Inventory&date=2026-11-20T10:00:00Z');
  assert.equal(r.body.at, '2026-11-20T10:00:00.000Z');
  assert.equal((await istek('/history/diff?table=Inventory&from=x&to=2026-11-20')).status, 400);
  r = await istek('/history/diff?table=Inventory&from=2026-11-01&to=2026-11-20');
  assert.equal(r.status, 200);
  assert.equal(G.cagri.at(-1)[3].toISOString(), '2026-11-20T23:59:59.999Z');
  await istek('/history/series?table=Inventory&days=9999');
  assert.equal(G.cagri.at(-1)[2], 365);
  await istek('/history/series?table=Inventory&days=0');
  assert.equal(G.cagri.at(-1)[2], 30);
});

test('EY4 /history/config: liste, dogrulama, UPDATE yoksa INSERT, zorla snapshot', async () => {
  assert.equal((await istek('/history/config', { rol: 'User' })).status, 403);
  P.ayar = [
    {
      table_name: 'Inventory',
      label: 'Envanter',
      mode: 'snapshot',
      key_columns: '["hostname"]',
      enabled: 1,
    },
    { table_name: 'Bozuk', label: 'B', mode: 'native', key_columns: '{bozuk', enabled: 0 },
  ];
  let r = await istek('/history/config');
  assert.deepEqual(
    r.body.configured.map((c) => [c.table, c.key, c.enabled]),
    [
      ['Inventory', ['hostname'], true],
      ['Bozuk', [], false],
    ],
  );
  assert.deepEqual(r.body.candidates, ['Server_Hub_Ear']);

  const put = (body, rol) => istek('/history/config', { method: 'PUT', body, rol });
  assert.equal((await put({ table: 'Inventory' }, 'User')).status, 403);
  for (const [body, re] of [
    [{ table: 'drop table;' }, /Geçersiz tablo adı/],
    [{ table: 'Inventory', enabled: true, key: [' '] }, /en az bir anahtar kolon/],
    [
      { table: 'Inventory', key: ['hostname', 'yok_kolon'] },
      /Tabloda olmayan kolon\(lar\): yok_kolon/,
    ],
  ]) {
    r = await put(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.body.message, re);
  }
  const once = tazelendi;
  r = await put({ table: 'Inventory', key: ['HOSTNAME'], enabled: true, mode: 'garip' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const [upd, ins] = P.yazim;
  assert.match(upd.s, /^UPDATE inventory_history_config/);
  assert.match(ins.s, /^INSERT INTO inventory_history_config/);
  assert.deepEqual(ins.params.slice(0, 4), ['Inventory', 'Inventory', 'snapshot', '["HOSTNAME"]']);
  assert.equal(ins.params[5], 1);
  assert.equal(ins.params[6], 'ornekkisi');
  assert.equal(tazelendi, once + 1, 'gecmis kapsami onbellegi tazelenmedi');
  P.yazim = [];
  P.guncellenen = 1;
  await put({ table: 'Inventory', mode: 'native', enabled: false });
  assert.equal(P.yazim.length, 1, 'satir varken INSERT gitti');
  assert.equal(P.yazim[0].params[2], 'native');

  assert.equal((await istek('/history/snapshot', { method: 'POST', rol: 'User' })).status, 403);
  r = await istek('/history/snapshot', { method: 'POST' });
  assert.deepEqual(r.body, { ok: true, result: { zorla: true, alinan: 2 } });
});
