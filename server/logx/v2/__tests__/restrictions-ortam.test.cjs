// server/logx/v2/__tests__/restrictions-ortam.test.cjs
//
// ORTAM BIRIMI (L3, 2026-10-01). Kullanici karari: "PROD loglarini yalnizca belirli
// kisi/gruplar alsin, TEST herkese acik kalsin". Kural kaynak kuraliyla BIRLIKTE
// (AND) uygulanir; ikisi de varsayilan-acik; admin her zaman gecer.
//
// Ortam etiketi OCP'de istegin `env` alanindan, Legacy'de DOSYA basina EAR
// son-ekinden (logx_env_suffix_map) gelir. Anahtar BUYUK harfe normalize edilir.
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const db = require('../../../db/index.cjs');
const restrictions = require('../restrictions.cjs');
const audit = require('../../audit.cjs');

const PROD_GRUP = 'CN=prod-log,OU=Groups,DC=example,DC=com';
const NS_GRUP = 'CN=odeme-ekibi,OU=Groups,DC=example,DC=com';
const sorgular = [];

// PROD ortami yalnizca PROD_GRUP'a; `ark/prod/c1/kisitli` namespace'i yalnizca NS_GRUP'a acik.
function sahteSorgu(sql, params) {
  const s = String(sql);
  sorgular.push({ sql: s, params });
  if (/FROM logx_v2_restrictions r/.test(s)) {
    if (/r.resource_key = \$2/.test(s)) {
      const [tip, k] = params;
      if (tip === 'env' && k === 'PROD')
        return { rows: [{ id: 1, username: null, group_dn: PROD_GRUP }] };
      if (tip === 'ocp_namespace' && /\/kisitli$/.test(k))
        return { rows: [{ id: 2, username: null, group_dn: NS_GRUP }] };
      return { rows: [] };
    }
    return { rows: [{ resource_key: 'ark/prod/c1/kisitli', username: null, group_dn: NS_GRUP }] };
  }
  if (/INSERT INTO logx_v2_restrictions/.test(s))
    return { rows: [{ id: 9, resource_key: params[1] }] };
  return { rows: [] };
}

// ── Birim ───────────────────────────────────────────────────────────────────

test('O1 ortam anahtari BUYUK harfe normalize edilir; mesaj ortami soyler', async () => {
  const orig = db.query;
  db.query = async (sql, params) => sahteSorgu(sql, params);
  try {
    const e = await restrictions
      .assertEnvAllowed(' prod ', { username: 'veli', role: 'User', groups: [] })
      .then(
        () => null,
        (x) => x,
      );
    assert.ok(e, 'kucuk harfli "prod" PROD kuralina eslesmedi');
    assert.equal(e.status, 403);
    assert.match(e.message, /^PROD ortamı LogX'te kısıtlı\. İzinli: grup prod-log\./);
    assert.equal(e.restriction.resourceType, 'env');
    assert.equal(e.restriction.resourceKey, 'PROD');
    // Admin ve izinli grup gecer; bos etiket kural uygulamaz.
    await restrictions.assertEnvAllowed('prod', { username: 'a', role: 'Admin' });
    await restrictions.assertEnvAllowed('PROD', {
      username: 'b',
      role: 'User',
      groups: [PROD_GRUP],
    });
    await restrictions.assertEnvAllowed('', { username: 'veli', role: 'User', groups: [] });
    await restrictions.assertEnvAllowed('test', { username: 'veli', role: 'User', groups: [] });
  } finally {
    db.query = orig;
  }
});

test('O2 ortam kisitlamasi olusturulurken anahtar BUYUK harfe cevrilir', async () => {
  const orig = db.query;
  sorgular.length = 0;
  db.query = async (sql, params) => sahteSorgu(sql, params);
  try {
    await restrictions.createRestriction({ resourceType: 'env', resourceKey: ' prod ' }, 'admin');
    const ins = sorgular.find((q) => /INSERT INTO logx_v2_restrictions/.test(q.sql));
    assert.equal(ins.params[0], 'env');
    assert.equal(ins.params[1], 'PROD');
  } finally {
    db.query = orig;
  }
});

// ── Rota katmani ────────────────────────────────────────────────────────────

const denetim = [];
const yedek = {};
let server;
let base;
let oturum = null;

before(async () => {
  yedek.query = db.query;
  db.query = async (sql, params) => sahteSorgu(sql, params);
  yedek.audit = audit.log;
  audit.log = async (e) => {
    denetim.push(e);
  };
  const ocp = require('../ocp.cjs');
  yedek.select = ocp.selectClusters;
  ocp.selectClusters = async () => ({ selected: true });
  const ocpCatalog = require('../ocp-catalog.cjs');
  yedek.catNs = ocpCatalog.getNamespaces;
  ocpCatalog.getNamespaces = async () => ({
    items: ['acik', 'kisitli'],
    cached: true,
    fetchedAt: null,
    stale: false,
    source: 'mixed',
    sources: {},
    counts: {},
    clusters: {},
  });
  yedek.catApps = ocpCatalog.getApps;
  ocpCatalog.getApps = async () => ({ items: [{ name: 'a' }], cached: true });
  const ocpCache = require('../ocp-cache.cjs');
  yedek.cacheApps = ocpCache.getApps;
  ocpCache.getApps = async () => ({ items: [{ name: 'a' }], cached: true });
  const requests = require('../requests.cjs');
  yedek.req = {
    row: requests.getRequestRow,
    own: requests.assertOwnership,
    norm: requests.normalizeRequest,
  };
  requests.assertOwnership = () => {};
  const legacy = require('../legacy.cjs');
  yedek.transfer = legacy.transfer;
  legacy.transfer = async () => ({ id: 'j1' });
  const jobsMod = require('../jobs.cjs');
  yedek.jobs = jobsMod.listJobsForRequest;
  jobsMod.listJobsForRequest = async () => [];

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (oturum) req.session = { user: oturum };
    next();
  });
  require('../index.cjs').initLogXv2(app);
  await new Promise((r) => {
    server = app.listen(0, '127.0.0.1', r);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  db.query = yedek.query;
  audit.log = yedek.audit;
  require('../ocp.cjs').selectClusters = yedek.select;
  const ocpCatalog = require('../ocp-catalog.cjs');
  ocpCatalog.getNamespaces = yedek.catNs;
  ocpCatalog.getApps = yedek.catApps;
  require('../ocp-cache.cjs').getApps = yedek.cacheApps;
  const requests = require('../requests.cjs');
  requests.getRequestRow = yedek.req.row;
  requests.assertOwnership = yedek.req.own;
  requests.normalizeRequest = yedek.req.norm;
  require('../legacy.cjs').transfer = yedek.transfer;
  require('../jobs.cjs').listJobsForRequest = yedek.jobs;
  server && server.close();
});

function istek(method, yol, user, body) {
  oturum = user;
  return new Promise((resolve, reject) => {
    const r = http.request(
      `${base}/api/logx/v2${yol}`,
      { method, headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b || '{}') }));
      },
    );
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

const kim = (groups, role = 'User') => ({ username: 'veli', role, authSource: 'ldap', groups });
const yabanci = kim(['CN=baska,OU=x']);
const prodcu = kim([PROD_GRUP]);
const ikisi = kim([PROD_GRUP, NS_GRUP]);
const admin = kim([], 'Admin');

function ocpIstegi() {
  require('../requests.cjs').getRequestRow = async () => ({
    request_id: 'r1',
    input_json: JSON.stringify({ tenant: 'ark', env: 'prod', clusters: ['c1'] }),
  });
}

test('O3 cluster seciminde kapali ortam EN ERKEN reddedilir (+ denetim); acik ortam gecer', async () => {
  denetim.length = 0;
  require('../requests.cjs').getRequestRow = async () => ({ request_id: 'r1' });
  const r = await istek('POST', '/ocp/r1/select', yabanci, {
    env: 'prod',
    tenant: 'ark',
    clusters: ['c1'],
  });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(r.body.restriction.resourceType, 'env');
  assert.match(r.body.message, /PROD ortamı LogX'te kısıtlı/);
  assert.ok(denetim.some((d) => d.action === 'v2_denied' && JSON.parse(d.detail).type === 'env'));
  const t = await istek('POST', '/ocp/r1/select', yabanci, {
    env: 'test',
    tenant: 'ark',
    clusters: ['c1'],
  });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  const p = await istek('POST', '/ocp/r1/select', prodcu, {
    env: 'prod',
    tenant: 'ark',
    clusters: ['c1'],
  });
  assert.equal(p.status, 200);
  const a = await istek('POST', '/ocp/r1/select', admin, {
    env: 'prod',
    tenant: 'ark',
    clusters: ['c1'],
  });
  assert.equal(a.status, 200);
});

test('O4 AND: ortam acik ama namespace kapali -> 403; ikisi de acik -> 200', async () => {
  const yol = '/ocp/cache/apps?env=prod&tenant=ark&cluster=c1&namespace=kisitli';
  const a = await istek('GET', yol, prodcu);
  assert.equal(a.status, 403);
  assert.equal(a.body.restriction.resourceType, 'ocp_namespace');
  const b = await istek('GET', yol, ikisi);
  assert.equal(b.status, 200, JSON.stringify(b.body));
  // Ortam kapali, namespace serbest -> yine 403 (ortam reddi).
  const c = await istek(
    'GET',
    '/ocp/cache/apps?env=prod&tenant=ark&cluster=c1&namespace=acik',
    yabanci,
  );
  assert.equal(c.status, 403);
  assert.equal(c.body.restriction.resourceType, 'env');
});

test('O5 ortam kapaliyken namespace listesi TAMAMEN gizli: sayi + sebep, ad yok', async () => {
  const r = await istek(
    'GET',
    '/ocp/inventory/namespaces?env=prod&tenant=ark&clusters=c1',
    yabanci,
  );
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items, []);
  assert.equal(r.body.hiddenCount, 2);
  assert.equal(r.body.restriction.resourceType, 'env');
  assert.ok(
    !JSON.stringify(r.body).includes('kisitli') && !JSON.stringify(r.body).includes('"acik"'),
  );
  const t = await istek(
    'GET',
    '/ocp/inventory/namespaces?env=test&tenant=ark&clusters=c1',
    yabanci,
  );
  assert.deepEqual(t.body.items, ['acik', 'kisitli']);
});

test('O5b onbellek namespace listesi de ortam kapaliyken tamamen gizli', async () => {
  const ocpCache = require('../ocp-cache.cjs');
  const y = ocpCache.getNamespaces;
  ocpCache.getNamespaces = async () => ({
    items: ['acik', 'kisitli'],
    cached: true,
    fetchedAt: null,
    stale: false,
    source: 'x',
  });
  try {
    const r = await istek('GET', '/ocp/cache/namespaces?env=prod&tenant=ark&cluster=c1', yabanci);
    assert.deepEqual(r.body.items, []);
    assert.equal(r.body.hiddenCount, 2);
    assert.equal(r.body.restriction.resourceType, 'env');
    const p = await istek('GET', '/ocp/cache/namespaces?env=prod&tenant=ark&cluster=c1', prodcu);
    assert.deepEqual(p.body.items, ['acik'], 'ortam acik: yalnizca namespace kurali kalir');
  } finally {
    ocpCache.getNamespaces = y;
  }
});

test('O5c CANLI kesif sonucu (kucuk harfli `prod` girdisi) ortam kapaliyken tamamen gizli', async () => {
  const requests = require('../requests.cjs');
  requests.getRequestRow = async () => ({ request_id: 'r3' });
  requests.normalizeRequest = () => ({
    state: 'ocp_namespace_picker',
    platform: 'openshift',
    input: { tenant: 'ark', env: 'prod', clusters: ['c1'] },
    discoveryResult: {
      overall_status: 'ok',
      clusters: [{ cluster_name: 'c1', status: 'ok', namespaces: ['acik', 'kisitli'] }],
    },
  });
  const r = await istek('GET', '/requests/r3', yabanci);
  const c = r.body.request.discoveryResult.clusters[0];
  assert.deepEqual(c.namespaces, []);
  assert.equal(c.hiddenCount, 2);
  const p = await istek('GET', '/requests/r3', prodcu);
  assert.deepEqual(p.body.request.discoveryResult.clusters[0].namespaces, ['acik']);
});

test('O6 ortam kapaliyken uygulama listesi bos + sebep', async () => {
  const r = await istek(
    'GET',
    '/ocp/inventory/apps?env=prod&tenant=ark&clusters=c1&namespace=acik',
    yabanci,
  );
  assert.deepEqual(r.body.items, []);
  assert.equal(r.body.restriction.resourceType, 'env');
});

test('O7 namespace kesfi ve log cekme kapali ortamda reddedilir (istek girdisinden)', async () => {
  ocpIstegi();
  const k = await istek('POST', '/ocp/r1/namespaces/discover', yabanci);
  assert.equal(k.status, 403, JSON.stringify(k.body));
  const f = await istek('POST', '/ocp/r1/discover-fetch', yabanci, {
    targets: [{ namespace: 'acik', appName: 'a' }],
  });
  assert.equal(f.status, 403, JSON.stringify(f.body));
  assert.equal(f.body.restriction.resourceType, 'env');
});

// ── Legacy: ortam DOSYA basina ──────────────────────────────────────────────

const LEGACY_SONUC = {
  overall_status: 'ok',
  hosts: [
    {
      host: 'h1',
      status: 'ok',
      files: [
        { path: '/a/X.ear/p.log', environment: 'PROD' },
        { path: '/a/X-T.ear/t.log', environment: 'TEST' },
      ],
    },
  ],
};

test('O8 legacy kesif sonucu: kapali ortamin dosyalari gizli, SAYI ve ortam soylenir', async () => {
  const requests = require('../requests.cjs');
  requests.getRequestRow = async () => ({ request_id: 'r2' });
  requests.normalizeRequest = () => ({
    state: 'discovered',
    platform: 'legacy',
    input: {},
    discoveryResult: JSON.parse(JSON.stringify(LEGACY_SONUC)),
  });
  const r = await istek('GET', '/requests/r2', yabanci);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = r.body.request.discoveryResult;
  assert.deepEqual(
    d.hosts[0].files.map((f) => f.path),
    ['/a/X-T.ear/t.log'],
  );
  assert.equal(d.hiddenFiles, 1);
  assert.deepEqual(d.hiddenEnvs, ['PROD']);
  const p = await istek('GET', '/requests/r2', prodcu);
  assert.equal(p.body.request.discoveryResult.hosts[0].files.length, 2);
  assert.equal(p.body.request.discoveryResult.hiddenFiles, undefined);
});

test('O9 legacy transfer: gizli PROD dosyasinin yolu dogrudan gonderilse de 403', async () => {
  require('../requests.cjs').getRequestRow = async () => ({
    request_id: 'r2',
    discovery_result_json: JSON.stringify(LEGACY_SONUC),
  });
  const r = await istek('POST', '/legacy/r2/transfer', yabanci, {
    selected: [{ host: 'h1', path: '/a/X.ear/p.log' }],
  });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(r.body.restriction.resourceKey, 'PROD');
  const t = await istek('POST', '/legacy/r2/transfer', yabanci, {
    selected: [{ host: 'h1', path: '/a/X-T.ear/t.log' }],
  });
  assert.equal(t.status, 200, JSON.stringify(t.body));
});
