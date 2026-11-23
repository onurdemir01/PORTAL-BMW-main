'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const express = require('express');

function setMockModule(relFromThisFile, exportsObj, backups) {
  const abs = require.resolve(relFromThisFile);
  if (!backups.has(abs)) backups.set(abs, require.cache[abs] || null);
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
  return abs;
}

function restoreModules(backups, targetRels = []) {
  for (const rel of targetRels) {
    try {
      delete require.cache[require.resolve(rel)];
    } catch {
      /* ignore */
    }
  }
  for (const [abs, prev] of backups.entries()) {
    if (prev) require.cache[abs] = prev;
    else delete require.cache[abs];
  }
}

test('server/telnet/index: apps, hosts, clusters, ocp namespaces, run (openshift + legacy), job-status, cancel', async (t) => {
  const backups = new Map();
  let templateOk = true;
  let restrictAllowed = true;
  const inserts = [];

  setMockModule(
    '../auth/index.cjs',
    {
      requireAuth: (req, _res, next) => {
        req.session = {
          user: {
            username: req.headers['x-user'] || 'alice',
            role: req.headers['x-role'] || 'User',
          },
        };
        next();
      },
    },
    backups,
  );
  setMockModule(
    '../auth/visibility.cjs',
    {
      requireVisiblePrefix: () => (_req, _res, next) => next(),
    },
    backups,
  );
  setMockModule(
    '../opsx/index.cjs',
    {
      hostsForApp: async () => [{ host: 'srv-app-01', env: 'prod' }],
      namespacesForCluster: async () => ['ns-alpha', 'ns-beta'],
    },
    backups,
  );
  setMockModule(
    '../logx/v2/legacy.cjs',
    {
      searchApps: async (q) => ({ apps: [{ name: `pay-api-${q || ''}` }] }),
    },
    backups,
  );
  setMockModule(
    '../logx/v2/restrictions.cjs',
    {
      assertAllowed: async () => {
        if (!restrictAllowed) throw Object.assign(new Error('kisitli'), { status: 403 });
      },
      evaluate: async () => ({ allowed: restrictAllowed, rows: [{ rule: 'deny' }] }),
      redAyrintisi: async () => ({ reason: 'restricted' }),
      denyMessage: () => 'Namespace kisitli.',
    },
    backups,
  );
  setMockModule(
    '../logx/v2/admin.cjs',
    {
      getClusterTree: async () => ({ dev: { pay: ['cluster-dev-01'] } }),
      resolveTerminalHosts: async () => ({
        hosts: { 'cluster-dev-01': 'bastion-01.example.internal' },
        missing: [],
      }),
      resolveClusterMeta: async () => ({ 'cluster-dev-01': { vault_credential_key: 'k1' } }),
    },
    backups,
  );
  setMockModule(
    '../logx/v2/ocp.cjs',
    {
      assertVaultKeysKnownOrThrow: async () => {},
      buildOcpExtraVars: ({ env, tenant, clusters }) => ({
        env,
        cluster: tenant,
        target_clusters: clusters,
      }),
      buildOcpRuntimeVars: () => ({ oc_async_timeout: 30 }),
    },
    backups,
  );
  setMockModule(
    '../logx/v2/ocp-runtime-config.cjs',
    {
      getConfig: async () => ({ ocAsyncTimeout: 30 }),
    },
    backups,
  );
  setMockModule(
    '../ansible/playbook-registry.cjs',
    {
      getByKey: async (k) => ({ key: k, enabled: templateOk, awxServerId: 0 }),
      getEffectiveTemplateId: () => (templateOk ? 701 : null),
    },
    backups,
  );
  setMockModule(
    '../ansible/runner.cjs',
    {
      launchJobOnServer: async () => ({ jobId: 9001, status: 'pending' }),
      getJobStatusOnServer: async () => ({
        status: 'successful',
        finished: true,
        failed: false,
        artifacts: {
          telnet_result: {
            overall_status: 'open',
            target: { host: '198.51.100.5', port: '443' },
            counts: { total: '1', open: '1', closed: '0', error: '0' },
            targets: [
              {
                cluster: 'cluster-dev-01',
                namespace: 'ns-alpha',
                ip: '198.51.100.5',
                port: '443',
                state: 'open',
                rc: '0',
                detail: 'ok',
              },
            ],
          },
        },
      }),
      getJobOutputOnServer: async () => ({ output: 'OPEN' }),
      cancelJobOnServer: async () => ({ canceled: true }),
    },
    backups,
  );
  setMockModule(
    '../db/index.cjs',
    {
      query: async (sql, params) => {
        if (sql.includes('INSERT INTO ansible_job_history')) inserts.push(params);
        if (sql.includes('SELECT TOP 1 username FROM ansible_job_history')) {
          return { rows: params[0] === 9002 ? [{ username: 'alice' }] : [] };
        }
        return { rows: [] };
      },
    },
    backups,
  );
  setMockModule('../audit/index.cjs', { auditPortal: () => {} }, backups);

  delete require.cache[require.resolve('../telnet/index.cjs')];
  const { initTelnet } = require('../telnet/index.cjs');

  const app = express();
  app.use(express.json());
  initTelnet(app);
  const srv = http.createServer(app);
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    srv.closeAllConnections?.();
    srv.close();
    restoreModules(backups, ['../telnet/index.cjs']);
  });

  const base = `http://127.0.0.1:${srv.address().port}`;

  assert.equal(
    (await (await fetch(`${base}/api/telnet/apps?search=core`)).json()).apps[0].name,
    'pay-api-core',
  );
  assert.equal((await fetch(`${base}/api/telnet/hosts`)).status, 400);
  assert.equal((await (await fetch(`${base}/api/telnet/hosts?app=pay`)).json()).hosts.length, 1);
  assert.equal(
    (await (await fetch(`${base}/api/telnet/clusters`)).json()).tree.dev.pay[0],
    'cluster-dev-01',
  );
  assert.equal((await fetch(`${base}/api/telnet/ocp/namespaces`)).status, 400);
  assert.equal(
    (await (await fetch(`${base}/api/telnet/ocp/namespaces?env=dev&tenant=pay`)).json()).namespaces
      .length,
    2,
  );

  // Run validation
  assert.equal(
    (
      await fetch(`${base}/api/telnet/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ip: 'bad host;', port: 80 }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(`${base}/api/telnet/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ip: '198.51.100.5', port: 99999 }),
      })
    ).status,
    400,
  );

  // OpenShift run
  let r = await fetch(`${base}/api/telnet/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      platform: 'openshift',
      env: 'dev',
      tenant: 'pay',
      cluster: 'cluster-dev-01',
      namespaces: ['ns-alpha'],
      ip: '198.51.100.5',
      port: '443',
    }),
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).jobId, 9001);

  // Legacy run (non-owned host rejected -> owned accepted)
  r = await fetch(`${base}/api/telnet/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      platform: 'legacy',
      application: 'pay',
      hosts: ['unknown-host'],
      ip: '198.51.100.5',
      port: 443,
    }),
  });
  assert.equal(r.status, 400);

  r = await fetch(`${base}/api/telnet/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      platform: 'legacy',
      application: 'pay',
      hosts: ['srv-app-01'],
      ip: '198.51.100.5',
      port: 443,
    }),
  });
  assert.equal(r.status, 200);
  assert.equal(inserts.length, 2);

  // Job status + IDOR check (bob denied, alice allowed via cache & DB fallback)
  assert.equal((await fetch(`${base}/api/telnet/job-status/bad/0`)).status, 400);
  assert.equal(
    (await fetch(`${base}/api/telnet/job-status/0/9001`, { headers: { 'x-user': 'bob' } })).status,
    403,
  );
  r = await fetch(`${base}/api/telnet/job-status/0/9001`);
  assert.equal((await r.json()).result.counts.open, 1);
  assert.equal((await fetch(`${base}/api/telnet/job-status/0/9002`)).status, 200);

  // Cancel
  assert.equal((await fetch(`${base}/api/telnet/cancel/0/9001`, { method: 'POST' })).status, 200);

  // Template missing -> 501
  templateOk = false;
  assert.equal(
    (
      await fetch(`${base}/api/telnet/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ip: '198.51.100.5', port: 80 }),
      })
    ).status,
    501,
  );
});

test('server/links & server/nobetci routes, cache/DB fallbacks, URL validation, and avatar', async (t) => {
  const backups = new Map();
  const origEnv = { ...process.env };
  const linkRows = [
    {
      id: '1',
      label: 'Docs',
      url: '/docs',
      category: 'Portal',
      description: 'Internal docs',
      is_active: 1,
      sort_order: 0,
      open_in_new_tab: 0,
      icon: '',
      visible_to: 'Admin,User',
      is_favorite: 1,
      purpose: 'Help',
      how_to_use: 'Click',
    },
    {
      id: '2',
      label: 'Admin Console',
      url: 'https://admin.example.internal',
      category: 'Ops',
      description: 'Only admins',
      is_active: 1,
      sort_order: 1,
      open_in_new_tab: 1,
      icon: '',
      visible_to: 'Admin',
      is_favorite: 0,
      purpose: '',
      how_to_use: '',
    },
  ];

  // Loopback HTTP server pretending to be Nobetci API
  const now = Date.now();
  let nobetFail = false;
  const nobetApiSrv = http.createServer((_req, res) => {
    if (nobetFail) {
      res.writeHead(500);
      res.end('fail');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify([
        {
          asRecordId: 501,
          startDate: new Date(now - 3600_000).toISOString(),
          endDate: new Date(now + 3600_000).toISOString(),
          asNobetci: {
            fullName: 'Onur Test',
            intercom: '1234',
            email: 'onur@example.internal',
            gsm: '+905550001122',
          },
          yedekNobetci: {
            fullName: 'Yedek Test',
            intercom: 'NULL',
            email: 'yedek@example.internal',
            gsm: '+905550001133',
          },
        },
      ]),
    );
  });
  await new Promise((resolve) => nobetApiSrv.listen(0, '127.0.0.1', resolve));

  delete process.env.NOBETCI_TEAM_ID;
  process.env.NOBETCI_API_URL = `http://127.0.0.1:${nobetApiSrv.address().port}/list`;

  setMockModule(
    '../db/index.cjs',
    {
      query: async (sql, params) => {
        if (sql.includes('SELECT COUNT(*)'))
          return { rows: [{ n: linkRows.length, cnt: linkRows.length }] };
        if (sql.includes('SELECT * FROM portal_links ORDER BY')) return { rows: linkRows.slice() };
        if (sql.startsWith('INSERT INTO portal_links')) {
          linkRows.push({
            id: params[0],
            label: params[1],
            url: params[2],
            category: params[3],
            description: params[4],
            is_active: params[5],
            sort_order: params[6],
            open_in_new_tab: params[7],
            icon: params[8],
            visible_to: params[9],
            is_favorite: params[10],
            purpose: params[11],
            how_to_use: params[12],
          });
          return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith('UPDATE portal_links SET label=')) {
          const row = linkRows.find((r) => r.id === params[11]);
          if (row) {
            row.label = params[0];
            row.url = params[1];
          }
          return { rowCount: row ? 1 : 0, rows: [] };
        }
        if (sql.startsWith('DELETE FROM portal_links')) {
          const idx = linkRows.findIndex((r) => r.id === params[0]);
          if (idx >= 0) linkRows.splice(idx, 1);
          return { rowCount: 1, rows: [] };
        }
        if (sql.includes('nobetci_cache')) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      },
    },
    backups,
  );
  setMockModule(
    '../auth/index.cjs',
    {
      getRequestRole: (req) => req.headers['x-role'] || 'User',
      requireAdmin: (req, res, next) =>
        req.headers['x-role'] === 'Admin' ? next() : res.status(403).json({ ok: false }),
      // Nobet uclari oturum ister (2026-11-14): `x-user: none` oturumsuz istegi temsil eder.
      requireAuth: (req, res, next) =>
        req.headers['x-user'] === 'none' ? res.status(401).json({ ok: false }) : next(),
    },
    backups,
  );
  setMockModule(
    '../auth/visibility.cjs',
    {
      requireVisiblePrefix: () => (_req, _res, next) => next(),
    },
    backups,
  );
  setMockModule(
    '../audit/index.cjs',
    {
      auditMutations: () => (_req, _res, next) => next(),
    },
    backups,
  );
  setMockModule(
    '../duty-roster/index.cjs',
    {
      readDutyRoster: () => [
        {
          date: new Date().toISOString().slice(0, 10),
          firstName: 'Fallback',
          lastName: 'User',
          phone: '111',
        },
      ],
    },
    backups,
  );
  setMockModule(
    '../ansible/runner.cjs',
    {
      clearTokenCache: () => {},
    },
    backups,
  );
  setMockModule(
    '../auth/ldap.cjs',
    {
      findLdapUserByEmail: async () => ({
        displayName: 'Onur LDAP',
        department: 'Middleware',
        title: 'Lead',
        avatarUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }),
    },
    backups,
  );

  delete require.cache[require.resolve('../links/index.cjs')];
  delete require.cache[require.resolve('../nobetci/index.cjs')];
  const { initLinks } = require('../links/index.cjs');
  const { initNobetci } = require('../nobetci/index.cjs');

  const app = express();
  app.use(express.json());
  initLinks(app);
  initNobetci(app);
  await new Promise((r) => setTimeout(r, 30));

  const srv = http.createServer(app);
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    srv.closeAllConnections?.();
    srv.close();
    nobetApiSrv.closeAllConnections?.();
    nobetApiSrv.close();
    process.env = origEnv;
    restoreModules(backups, ['../links/index.cjs', '../nobetci/index.cjs']);
  });

  const base = `http://127.0.0.1:${srv.address().port}`;

  // Links visibility & CRUD + XSS gate
  let r = await fetch(`${base}/api/links`);
  assert.equal((await r.json()).links.length, 1);
  r = await fetch(`${base}/api/links`, { headers: { 'x-role': 'Admin' } });
  assert.equal((await r.json()).links.length, 2);

  assert.equal(
    (
      await fetch(`${base}/api/links`, {
        method: 'POST',
        headers: { 'x-role': 'Admin', 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'Bad', url: 'javascript:alert(1)', category: 'X' }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(`${base}/api/links`, {
        method: 'POST',
        headers: { 'x-role': 'Admin', 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'ProtoRel', url: '//evil.example.com', category: 'X' }),
      })
    ).status,
    400,
  );

  r = await fetch(`${base}/api/links`, {
    method: 'POST',
    headers: { 'x-role': 'Admin', 'content-type': 'application/json' },
    body: JSON.stringify({
      label: 'Portal Monitor',
      url: 'https://monitor.example.internal',
      category: 'Ops',
      visibleTo: ['Admin', 'User'],
    }),
  });
  assert.equal(r.status, 200);
  const createdId = (await r.json()).link.id;

  assert.equal(
    (
      await fetch(`${base}/api/links/${createdId}`, {
        method: 'PUT',
        headers: { 'x-role': 'Admin', 'content-type': 'application/json' },
        body: JSON.stringify({
          label: 'Portal Monitor 2',
          url: 'https://monitor2.example.internal',
          category: 'Ops',
        }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/links/missing-id`, {
        method: 'PUT',
        headers: { 'x-role': 'Admin', 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await fetch(`${base}/api/links/reorder`, {
        method: 'POST',
        headers: { 'x-role': 'Admin', 'content-type': 'application/json' },
        body: JSON.stringify({ orderedIds: ['2', '1'] }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/links/${createdId}`, {
        method: 'DELETE',
        headers: { 'x-role': 'Admin' },
      })
    ).status,
    200,
  );

  // Nobetci live, avatar, list, admin cache clear. Oturumsuz istek uca ulasmaz.
  for (const uc of ['/api/nobetci/today', '/api/nobetci/today/avatar', '/api/nobetci/list']) {
    assert.equal((await fetch(`${base}${uc}`, { headers: { 'x-user': 'none' } })).status, 401, uc);
  }
  r = await fetch(`${base}/api/nobetci/today`);
  let body = await r.json();
  assert.equal(body.source, 'api');
  assert.equal(body.name, 'Onur LDAP');
  assert.equal(body.avatarUrl, '/api/nobetci/today/avatar');

  r = await fetch(`${base}/api/nobetci/today/avatar`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'private, max-age=300');

  const curMonth = new Date(now).toISOString().slice(0, 7);
  r = await fetch(`${base}/api/nobetci/list?month=${curMonth}`);
  assert.equal((await r.json()).records.length, 1);

  assert.equal((await fetch(`${base}/api/admin/nobetci/source-status`)).status, 403);
  r = await fetch(`${base}/api/admin/nobetci/source-status`, { headers: { 'x-role': 'Admin' } });
  assert.equal((await r.json()).currentSource, 'api_live');

  assert.equal(
    (
      await fetch(`${base}/api/admin/cache/nobetci`, {
        method: 'POST',
        headers: { 'x-role': 'Admin' },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/admin/cache/awx-tokens`, {
        method: 'POST',
        headers: { 'x-role': 'Admin' },
      })
    ).status,
    200,
  );
});

test('server/auth/visibility-routes & server/spa-report/index HTTP routes and helpers', async (t) => {
  const backups = new Map();
  let version = 3;
  const savedRules = [];

  setMockModule(
    '../audit/index.cjs',
    {
      auditMutations: () => (_req, _res, next) => next(),
    },
    backups,
  );
  setMockModule(
    '../auth/index.cjs',
    {
      requireAuth: (req, _res, next) => {
        req.session = { user: { username: 'ali', role: 'Admin' } };
        next();
      },
    },
    backups,
  );
  setMockModule(
    '../auth/visibility.cjs',
    {
      readVisibility: async () => ({ Denetim: ['Admin'] }),
      writeVisibility: async () => ({ ok: true, failed: [] }),
      bumpVersion: () => {
        version++;
      },
      getVersion: () => version,
      resolveVisibilitySoft: async () => ({ version, visibility: { Denetim: true } }),
      requireVisible: () => (_req, _res, next) => next(),
    },
    backups,
  );
  setMockModule(
    '../auth/elements.cjs',
    {
      listElements: async () => [
        { key: 'grp:ops', type: 'nav_group', enabled: true, sortOrder: 1, label: 'Ops' },
        {
          key: 'Denetim',
          type: 'page',
          enabled: true,
          sortOrder: 1,
          parentKey: 'grp:ops',
          label: 'Denetim',
        },
      ],
      listRules: async () => [
        { elementKey: 'Denetim', principalType: 'user', principalId: 'ali', allow: true },
        {
          elementKey: 'tab:denetim:envanter',
          principalType: 'user',
          principalId: 'ali',
          allow: true,
        },
        {
          elementKey: 'CryptoHub',
          principalType: 'email',
          principalId: 'ali@example.internal',
          allow: true,
        },
        { elementKey: 'NginxConsole', principalType: 'group', principalId: 'ops', allow: true },
      ],
      upsertElement: async () => {},
      setElementEnabled: async () => {},
      setElementStrict: async () => true,
      setElementRules: async (key, rules) => savedRules.push({ key, rules }),
      propagateToStrictDescendants: async () => [],
    },
    backups,
  );
  setMockModule(
    '../auth/utils.cjs',
    {
      getRequestUser: (req) => req.session?.user || { username: 'ali', role: 'Admin' },
    },
    backups,
  );
  setMockModule(
    '../db/index.cjs',
    {
      query: async (sql) => {
        if (sql.includes('SELECT TOP 1')) return { rows: [] };
        return { rows: [] };
      },
    },
    backups,
  );
  setMockModule(
    '../spa-report/intranet.cjs',
    {
      mountIntranet: () => {},
      invalidateCache: () => {},
    },
    backups,
  );
  setMockModule(
    '../inventory/mssql.cjs',
    {
      query: async () => ({ recordset: [] }),
      sql: {},
    },
    backups,
  );
  setMockModule(
    '../spa-report/build.cjs',
    {
      buildSpaReport: async () => ({ apps: [], summary: {} }),
    },
    backups,
  );
  setMockModule(
    '../audit/nginx-host-labels.cjs',
    {
      surum: () => ({}),
    },
    backups,
  );

  delete require.cache[require.resolve('../auth/visibility-routes.cjs')];
  delete require.cache[require.resolve('../spa-report/index.cjs')];
  const { initVisibilityRoutes } = require('../auth/visibility-routes.cjs');
  const { initSpaReport, declKey } = require('../spa-report/index.cjs');

  const app = express();
  app.use(express.json());
  const requireAuth = (req, _res, next) => {
    req.session = { user: { username: 'ali', role: 'Admin' } };
    next();
  };
  const requireAdmin = requireAuth;
  initVisibilityRoutes(app, { requireAuth, requireAdmin });
  initSpaReport(app);

  const srv = http.createServer(app);
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    srv.closeAllConnections?.();
    srv.close();
    restoreModules(backups, ['../auth/visibility-routes.cjs', '../spa-report/index.cjs']);
  });

  const base = `http://127.0.0.1:${srv.address().port}`;

  const verRes = await fetch(`${base}/api/visibility/version`);
  assert.equal(verRes.status, 200);
  assert.equal(verRes.headers.get('etag'), 'W/"vis-v3"');
  assert.equal(verRes.headers.get('cache-control'), 'private, no-cache');
  assert.equal((await verRes.json()).version, 3);
  const notModRes = await fetch(`${base}/api/visibility/version`, {
    headers: { 'if-none-match': 'W/"vis-v3"' },
  });
  assert.equal(notModRes.status, 304);
  assert.equal((await (await fetch(`${base}/api/visibility/resolved`)).json()).ok_engine, true);
  assert.equal(
    (await (await fetch(`${base}/api/visibility/nav-groups`)).json()).groups[0].pageKeys[0],
    'Denetim',
  );

  assert.equal(
    (
      await fetch(`${base}/api/visibility/pages`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ visibility: { Denetim: ['Admin'] } }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/visibility/denetim-access`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ principalType: 'user', principalId: 'veli', tabs: ['envanter'] }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/visibility/crypto-access`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          principalType: 'email',
          principalId: 'veli@example.internal',
          tabs: 'all',
        }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/visibility/nginx-access`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ principalType: 'group', principalId: 'g1', tabs: 'all' }),
      })
    ).status,
    200,
  );
  assert.ok(savedRules.length > 0);

  // spa-report declKey + declare routes
  assert.equal(declKey('ns1', 'app1', '/loc1').length, 64);
  assert.equal(
    (
      await fetch(`${base}/api/spa-report/declare`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          namespace: 'ns1',
          application: 'app1',
          location: '/api',
          inUse: 'yes',
        }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/spa-report/declare`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          namespace: 'ns1',
          application: 'app1',
          inUse: 'no',
          note: 'retired',
        }),
      })
    ).status,
    200,
  );
});
