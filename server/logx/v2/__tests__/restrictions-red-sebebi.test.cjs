// server/logx/v2/__tests__/restrictions-red-sebebi.test.cjs
//
// RED SEBEBI GORUNUR + HER RED DENETIMDE + LISTE SESSIZ DUSURMEZ (L2, 2026-10-01).
//
// Eski hal: 403 mesaji "ekibiniz bu kaynagi kisitlamis olabilir" idi; hangi kural,
// kimin icin acik, kime basvurulur — hicbiri yoktu. Redler HICBIR yere yazilmiyordu
// ve listeler kisitli kaynaklari SESSIZCE dusuruyordu: kullanici "namespace'im yok"
// saniyordu. Prod'daki grup izni hatasi (PR #159) tam olarak bu yuzden "yetkisel bir
// sey" diye haftalarca gorunmez kaldi.
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const db = require('../../../db/index.cjs');
const restrictions = require('../restrictions.cjs');
const audit = require('../../audit.cjs');

const GROUP = 'CN=odeme-ekibi,OU=Groups,DC=example,DC=com';
const APP = 'odeme-ear';
const NS_KEY = (ns) => `ark/prod/c1/${ns}`;

// ── Saf birim: mesaj ve ayrinti ─────────────────────────────────────────────

function withRows(rows, fn) {
  const orig = db.query;
  db.query = async () => ({ rows });
  return Promise.resolve(fn()).finally(() => {
    db.query = orig;
  });
}

async function reddet(type, key, rows) {
  let hata;
  await withRows(rows, async () => {
    hata = await restrictions
      .assertAllowed(type, key, { username: 'veli', role: 'User', groups: [] })
      .then(
        () => null,
        (e) => e,
      );
  });
  return hata;
}

test('R1 ret: 403 + kural + izinli grup (CN) + kullanici + basvuru yolu', async () => {
  const e = await reddet('ocp_namespace', NS_KEY('odeme-ns'), [
    { id: 1, username: null, group_dn: GROUP },
    { id: 1, username: 'ali', group_dn: null },
  ]);
  assert.ok(e, 'reddedilmedi');
  assert.equal(e.status, 403);
  assert.equal(e.code, undefined, '`code` istemcide aciklamanin yerine gecer — konmamali');
  assert.match(e.message, /"odeme-ns" namespace'i \(c1, prod\/ark\) LogX'te kısıtlı\./);
  assert.match(e.message, /grup odeme-ekibi/);
  assert.match(e.message, /kullanıcı ali/);
  assert.match(e.message, /Erişim için: LogX yöneticisi \(Admin\)\./);
  assert.deepEqual(e.restriction.allowedGroups, ['odeme-ekibi']);
  assert.deepEqual(e.restriction.allowedUsers, ['ali']);
  assert.equal(e.restriction.resourceKey, NS_KEY('odeme-ns'));
});

test('R2 hic izinli yoksa bunu soyler; legacy etiketi', async () => {
  const e = await reddet('legacy_app', APP, [{ id: 1, username: null, group_dn: null }]);
  assert.match(
    e.message,
    /^"odeme-ear" uygulaması LogX'te kısıtlı\. Bu kaynakta henüz izinli kimse yok\./,
  );
});

test('R3 uzun izinli listesi kirpilir ("ve N diger")', async () => {
  const rows = Array.from({ length: 13 }, (_, i) => ({ id: 1, username: `u${i}`, group_dn: null }));
  const e = await reddet('legacy_app', APP, rows);
  assert.match(e.message, /u9 ve 3 diğer/);
  assert.equal(e.restriction.allowedUsers.length, 13, 'yapilandirilmis alan kirpilmamali');
});

// ── Rota katmani: gercek LogX router ────────────────────────────────────────

const denetim = [];
const origQuery = db.query;
const origAuditLog = audit.log;
const ocpCache = require('../ocp-cache.cjs');
const ocpCatalog = require('../ocp-catalog.cjs');
const inventoryDb = require('../../../inventory/mssql.cjs');
const yedek = {
  cacheNs: ocpCache.getNamespaces,
  catNs: ocpCatalog.getNamespaces,
  catApps: ocpCatalog.getApps,
  pool: inventoryDb.getPool,
};

let server;
let base;
let oturum = null;

before(async () => {
  // `APP` ve `kisitli` namespace'i kisitli, yalnizca GROUP'a acik.
  db.query = async (sql, params) => {
    const s = String(sql);
    if (/FROM logx_v2_restrictions r/.test(s)) {
      if (/WHERE r.resource_type = \$1 AND r.resource_key = \$2/.test(s)) {
        const k = params[1];
        if (k === APP || /\/kisitli$/.test(k))
          return { rows: [{ id: 1, username: null, group_dn: GROUP }] };
        return { rows: [] };
      }
      // filterAllowed: tipin TUM satirlari
      return {
        rows: ['c1', 'c2'].map((c) => ({
          resource_key: NS_KEY('kisitli').replace('c1', c),
          username: null,
          group_dn: GROUP,
        })),
      };
    }
    return { rows: [] };
  };
  audit.log = async (e) => {
    denetim.push(e);
  };
  ocpCache.getNamespaces = async () => ({
    items: ['acik', 'kisitli'],
    cached: true,
    fetchedAt: null,
    stale: false,
    source: 'x',
  });
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
  ocpCatalog.getApps = async () => ({ items: [{ name: 'a' }], cached: true });
  inventoryDb.getPool = async () => ({
    request: () => ({
      input() {},
      query: async () => ({ recordset: [{ host: 'h1', env: 'PROD' }] }),
    }),
  });

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
  db.query = origQuery;
  audit.log = origAuditLog;
  ocpCache.getNamespaces = yedek.cacheNs;
  ocpCatalog.getNamespaces = yedek.catNs;
  ocpCatalog.getApps = yedek.catApps;
  inventoryDb.getPool = yedek.pool;
  server && server.close();
});

function al(yol, user) {
  oturum = user;
  return new Promise((resolve, reject) => {
    http
      .get(`${base}/api/logx/v2${yol}`, (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b || '{}') }));
      })
      .on('error', reject);
  });
}

const veli = { username: 'veli', role: 'User', authSource: 'ldap', groups: ['CN=baska,OU=x'] };
const admin = { username: 'boss', role: 'Admin', authSource: 'ldap', groups: [] };

test('R4 rota: 403 yaniti `restriction` tasir, `error` alani YOK, red DENETIME yazilir', async () => {
  denetim.length = 0;
  const r = await al(`/legacy/hosts?app=${APP}`, veli);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, undefined, 'istemci `error`u mesajin yerine gosterir');
  assert.match(r.body.message, /LogX'te kısıtlı/);
  assert.deepEqual(r.body.restriction.allowedGroups, ['odeme-ekibi']);
  const kayit = denetim.find((d) => d.action === 'v2_denied');
  assert.ok(kayit, 'red denetime yazilmadi');
  assert.equal(kayit.username, 'veli');
  assert.equal(kayit.result, 'denied');
  const d = JSON.parse(kayit.detail);
  assert.equal(d.type, 'legacy_app');
  assert.equal(d.key, APP);
  assert.match(d.route, /^GET \/api\/logx\/v2\/legacy\/hosts$/);
});

test('R5 admin reddedilmez ve red kaydi DUSMEZ', async () => {
  denetim.length = 0;
  const r = await al(`/legacy/hosts?app=${APP}`, admin);
  assert.equal(r.status, 200);
  assert.equal(denetim.filter((d) => d.action === 'v2_denied').length, 0);
});

test('R6 namespace listeleri gizlenen SAYIYI soyler, ADI sizdirmaz', async () => {
  for (const yol of [
    '/ocp/cache/namespaces?env=prod&tenant=ark&cluster=c1',
    '/ocp/inventory/namespaces?env=prod&tenant=ark&clusters=c1',
  ]) {
    const r = await al(yol, veli);
    assert.equal(r.status, 200, `${yol}: ${JSON.stringify(r.body)}`);
    assert.deepEqual(r.body.items, ['acik'], yol);
    assert.equal(r.body.hiddenCount, 1, `${yol} gizleneni saymiyor`);
    assert.ok(!JSON.stringify(r.body).includes('kisitli'), `${yol} kisitli adi sizdiriyor`);
    const a = await al(yol, admin);
    assert.equal(a.body.hiddenCount, 0, `${yol} admin icin gizleme yok`);
  }
});

test('R7 kisitli namespace`in uygulama listesi: bos + `restriction` + mesaj + denetim', async () => {
  denetim.length = 0;
  const r = await al('/ocp/inventory/apps?env=prod&tenant=ark&clusters=c1&namespace=kisitli', veli);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items, []);
  assert.ok(r.body.restriction, 'restriction ayrintisi yok');
  assert.match(r.body.message, /"kisitli" namespace'i/);
  assert.ok(
    denetim.some((d) => d.action === 'v2_denied'),
    'denetime yazilmadi',
  );
  const acik = await al('/ocp/inventory/apps?env=prod&tenant=ark&clusters=c1&namespace=acik', veli);
  assert.equal(acik.body.restriction, undefined);
  assert.equal(acik.body.items.length, 1);
});

// ── R8: CANLI KESIF SONUCU da gizlenen SAYIYI tasir ─────────────────────────
// Onbellek/envanter listesinden ayri yol: AWX kesfinin sonucu `GET /requests/:id`
// ile okunur ve `filterDiscoveryResult` cluster BASINA suzer.
test('R8 canli kesif sonucu: cluster basina hiddenCount, ad sizmiyor', async () => {
  const requests = require('../requests.cjs');
  const jobsMod = require('../jobs.cjs');
  const y = {
    row: requests.getRequestRow,
    own: requests.assertOwnership,
    norm: requests.normalizeRequest,
    jobs: jobsMod.listJobsForRequest,
  };
  requests.getRequestRow = async () => ({ request_id: 'r1' });
  requests.assertOwnership = () => {};
  requests.normalizeRequest = () => ({
    state: 'ocp_namespace_picker',
    platform: 'openshift',
    input: { tenant: 'ark', env: 'prod', clusters: ['c1'] },
    discoveryResult: {
      overall_status: 'ok',
      clusters: [{ cluster_name: 'c1', status: 'ok', namespaces: ['acik', 'kisitli'] }],
    },
  });
  jobsMod.listJobsForRequest = async () => [];
  try {
    const r = await al('/requests/r1', veli);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const c = r.body.request.discoveryResult.clusters[0];
    assert.deepEqual(c.namespaces, ['acik']);
    assert.equal(c.hiddenCount, 1);
    assert.ok(!JSON.stringify(r.body).includes('kisitli'), 'kisitli ad sizdi');
  } finally {
    requests.getRequestRow = y.row;
    requests.assertOwnership = y.own;
    requests.normalizeRequest = y.norm;
    jobsMod.listJobsForRequest = y.jobs;
  }
});
