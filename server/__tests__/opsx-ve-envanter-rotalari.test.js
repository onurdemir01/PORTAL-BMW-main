'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
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

test('server/opsx/index: smart-config, discovery, run (legacy + openshift), dumps, poddelete, and job-status IDOR', async (t) => {
  const backups = new Map();
  let templateMissing = false;
  let wasMatch = false;

  const mockPool = {
    request: () => ({
      parameters: {},
      input(name, _type, val) {
        this.parameters[name] = { value: val };
        return this;
      },
      async query(sqlText) {
        if (sqlText.includes('FROM')) {
          return {
            recordset: [
              {
                host: 'APP01',
                env: 'test',
                jboss_version: '8.0.5',
                status: 'running',
                app_path: '/usr/jboss8/app',
              },
              {
                host: 'APP02',
                env: 'test',
                jboss_version: '7.4.1',
                status: 'stopped',
                app_path: '/usr/jboss/app',
              },
            ],
          };
        }
        return { recordset: [] };
      },
    }),
  };

  setMockModule(
    '../auth/index.cjs',
    {
      requireAuth: (req, _res, next) => {
        req.session = {
          user: {
            username: req.headers['x-user'] || 'alice',
            role: req.headers['x-role'] || 'User',
            mail: 'alice@example.internal',
          },
        };
        next();
      },
      requireAdmin: (req, res, next) =>
        req.headers['x-role'] === 'Admin' ? next() : res.status(403).json({ ok: false }),
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
    '../inventory/mssql.cjs',
    {
      getPool: async () => mockPool,
      query: async () => ({ recordset: [] }),
      sql: {},
    },
    backups,
  );
  setMockModule(
    '../opsx/was.cjs',
    {
      initOpsXWas: () => {},
      isWasPlatform: () => wasMatch,
      isWasPlaybook: (pb) => pb === 'opsx_was_operation.yml',
    },
    backups,
  );
  setMockModule(
    '../opsx/config.cjs',
    {
      SMART_PLATFORMS: ['legacy', 'was', 'openshift'],
      getConfig: async () => ({
        legacy: { separator: ',', extraVars: '' },
        openshift: { ocClusterKey: 'oc_cluster', ocInputKey: 'oc_input', extraVars: 'owner=ops' },
        smart: {
          legacy: { enabled: false },
          was: { enabled: false },
          openshift: { enabled: false },
        },
      }),
      smartPublic: (s) => s,
      saveSmartConfig: async (s) => ({ config: s, reddedilen: [] }),
      parseExtraVarLines: () => ({ vars: { owner: 'ops' }, rejected: [] }),
    },
    backups,
  );
  setMockModule(
    '../opsx/prod-approval.cjs',
    {
      FLOW_KEY_ENV: {
        legacy: 'OPSX_SMART_FLOW_KEY_LEGACY',
        was: 'OPSX_SMART_FLOW_KEY_WAS',
        openshift: 'OPSX_SMART_FLOW_KEY_OPENSHIFT',
      },
      ONAY_ZAMAN_ASIMI_DK: 15,
      uretimIstegi: (items) => {
        const hasProd = items.some((i) =>
          String(i.deger || '')
            .toLowerCase()
            .includes('prod'),
        );
        return { uretim: hasProd, sebep: hasProd ? 'ortam=prod' : null };
      },
      opsxProductionKapisi: async () => ({ proceed: true }),
    },
    backups,
  );
  setMockModule(
    '../opsx/downloads.cjs',
    {
      stagingRoot: () => '/sw/BMW_PORTAL/opsx/dumps',
      issueDownloadToken: async () => ({ token: 'dl-tok-123', expiresInMinutes: 15 }),
      getDownloadByToken: async () => null,
      isUnderStagingRoot: () => false,
      safeDownloadName: (n) => n || 'dump.tar.gz',
    },
    backups,
  );
  setMockModule(
    '../logx/v2/legacy.cjs',
    {
      searchApps: async () => ({ apps: [{ name: 'orders-api' }] }),
    },
    backups,
  );
  setMockModule(
    '../logx/v2/admin.cjs',
    {
      getClusterTree: async () => ({ dev: { pay: ['ocp-dev-01'] } }),
      resolveTerminalHosts: async () => ({
        hosts: { 'ocp-dev-01': 'jump-01.example.internal' },
        missing: [],
      }),
      resolveClusterMeta: async () => ({ 'ocp-dev-01': { vault_credential_key: 'vk1' } }),
    },
    backups,
  );
  setMockModule(
    '../logx/v2/ocp.cjs',
    {
      buildOcpExtraVars: ({ env, tenant, clusters }) => ({
        env,
        oc_cluster: tenant,
        target_clusters: clusters,
      }),
    },
    backups,
  );
  setMockModule(
    '../logx/v2/ocp-inventory.cjs',
    {
      getNamespaces: async () => ({ items: ['ns-orders', 'ns-payments'] }),
      getApps: async () => ({ items: [{ name: 'orders-svc' }] }),
    },
    backups,
  );
  setMockModule(
    '../logx/v2/restrictions.cjs',
    {
      filterAllowed: async (_kind, keys) => keys,
      isAllowed: async () => true,
    },
    backups,
  );
  setMockModule(
    '../ansible/playbook-registry.cjs',
    {
      getByKey: async (k) => ({ key: k, enabled: !templateMissing, awxServerId: 0 }),
      getEffectiveTemplateId: () => (templateMissing ? null : 601),
    },
    backups,
  );
  setMockModule(
    '../ansible/template-preflight.cjs',
    {
      assertTemplateAcceptsExtraVars: async () => {},
    },
    backups,
  );
  setMockModule(
    '../ansible/runner.cjs',
    {
      launchJobOnServer: async () => ({ jobId: 7701, status: 'pending' }),
      getJobStatusOnServer: async () => ({
        status: 'successful',
        finished: '2026-11-10T00:01:00Z',
        failed: false,
        playbook: 'opsx_legacy.yml',
        artifacts: {
          opsx_jvm_result: { hosts: { APP01: [{ pid: 1234, jbossMajor: '8' }] } },
          opsx_serverconfig_result: { hosts: { APP01: [{ name: 'srv-1', status: 'STARTED' }] } },
          opsx_pods_result: {
            pods: [{ cluster: 'ocp-dev-01', namespace: 'ns-orders', pod: 'orders-1' }],
          },
          opsx_pod_delete_result: {
            overall_status: 'ok',
            results: [{ pod: 'orders-1', status: 'Exist' }],
          },
          opsx_dump_result: {
            results: [
              {
                host: 'APP01',
                status: 'ok',
                file: '/sw/BMW_PORTAL/opsx/dumps/a.gz',
                size_bytes: 1024,
              },
            ],
          },
        },
      }),
      getJobOutputOnServer: async () => ({ output: 'DONE' }),
    },
    backups,
  );
  setMockModule(
    '../db/index.cjs',
    {
      query: async (_sql, params) => {
        if (params && params[0] === 7702) return { rows: [{ username: 'alice', params: '{}' }] };
        return { rows: [] };
      },
    },
    backups,
  );
  setMockModule('../audit/index.cjs', { auditPortal: () => {} }, backups);

  delete require.cache[require.resolve('../opsx/index.cjs')];
  const { initOpsX } = require('../opsx/index.cjs');

  const app = express();
  initOpsX(app);
  const srv = http.createServer(app);
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    srv.closeAllConnections?.();
    srv.close();
    restoreModules(backups, ['../opsx/index.cjs']);
  });
  const base = `http://127.0.0.1:${srv.address().port}`;

  // smart-config
  assert.equal((await fetch(`${base}/api/opsx/smart-config`)).status, 403);
  assert.equal(
    (await fetch(`${base}/api/opsx/smart-config`, { headers: { 'x-role': 'Admin' } })).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/opsx/smart-config`, {
        method: 'PUT',
        headers: { 'x-role': 'Admin', 'content-type': 'application/json' },
        body: JSON.stringify({ smart: { legacy: { enabled: true } } }),
      })
    ).status,
    200,
  );

  // discovery & catalog endpoints
  assert.equal(
    (await (await fetch(`${base}/api/opsx/apps?search=ord`)).json()).apps[0].name,
    'orders-api',
  );
  assert.equal(
    (await (await fetch(`${base}/api/opsx/hosts?app=orders-api`)).json()).hosts.length,
    2,
  );
  assert.equal(
    (await (await fetch(`${base}/api/opsx/clusters`)).json()).tree.dev.pay[0],
    'ocp-dev-01',
  );
  assert.equal((await fetch(`${base}/api/opsx/ocp/namespaces`)).status, 400);
  assert.equal(
    (await (await fetch(`${base}/api/opsx/ocp/namespaces?env=dev&tenant=pay`)).json()).namespaces
      .length,
    2,
  );
  assert.equal((await fetch(`${base}/api/opsx/ocp/apps`)).status, 400);
  assert.equal(
    (await (await fetch(`${base}/api/opsx/ocp/apps?env=dev&tenant=pay&namespace=ns-orders`)).json())
      .apps[0],
    'orders-svc',
  );
  assert.equal((await (await fetch(`${base}/api/opsx/operations`)).json()).operations.length, 5);
  assert.equal(
    (
      await (await fetch(`${base}/api/opsx/ocp/operations?env=prod&tenant=pay`)).json()
    ).operations.some((o) => o.needsApproval),
    true,
  );

  // Legacy run (validation errors + success)
  assert.equal(
    (
      await fetch(`${base}/api/opsx/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform: 'legacy', operation: 'bogus' }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(`${base}/api/opsx/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platform: 'legacy',
          application: 'orders-api',
          hosts: ['APP01'],
          operation: 'restart',
        }),
      })
    ).status,
    400,
  ); // missing serverConfigMap
  let r = await fetch(`${base}/api/opsx/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      platform: 'legacy',
      application: 'orders-api',
      hosts: ['APP01'],
      hostMajors: ['8'],
      operation: 'restart',
      serverConfigMap: { APP01: [{ name: 'srv-1', jbossMajor: '8' }] },
    }),
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).jobId, 7701);

  // OpenShift run
  r = await fetch(`${base}/api/opsx/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      platform: 'openshift',
      ocOperation: 'restart',
      env: 'dev',
      tenant: 'pay',
      cluster: 'ocp-dev-01',
      pairs: [{ namespace: 'ns-orders', application: 'orders-svc' }],
    }),
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).jobId, 7701);

  // Discover, dumps, poddelete POST + status endpoints
  assert.equal(
    (
      await fetch(`${base}/api/opsx/legacy/jvm/discover`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ application: 'orders-api', hosts: ['APP01'] }),
      })
    ).status,
    200,
  );
  assert.equal((await fetch(`${base}/api/opsx/legacy/jvm/0/7701/status`)).status, 200);
  assert.equal(
    (
      await fetch(`${base}/api/opsx/legacy/serverconfig/discover`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ application: 'orders-api', hosts: ['APP01'] }),
      })
    ).status,
    200,
  );
  assert.equal((await fetch(`${base}/api/opsx/legacy/serverconfig/0/7701/status`)).status, 200);
  assert.equal(
    (
      await fetch(`${base}/api/opsx/ocp/pods/discover`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          env: 'dev',
          tenant: 'pay',
          pairs: [{ namespace: 'ns-orders', application: 'orders-svc' }],
        }),
      })
    ).status,
    200,
  );
  assert.equal((await fetch(`${base}/api/opsx/ocp/pods/0/7701/status`)).status, 200);
  assert.equal(
    (
      await fetch(`${base}/api/opsx/dump/legacy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          application: 'orders-api',
          hosts: ['APP01'],
          dumpType: 'threaddump',
          pidMap: { APP01: [{ pid: 1234, jbossMajor: '8' }] },
        }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/opsx/dump/openshift`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          env: 'dev',
          tenant: 'pay',
          pairs: [{ namespace: 'ns-orders', application: 'orders-svc' }],
          dumpType: 'threaddump',
          pods: [{ cluster: 'ocp-dev-01', namespace: 'ns-orders', pod: 'orders-1' }],
        }),
      })
    ).status,
    200,
  );
  assert.equal((await fetch(`${base}/api/opsx/dump/0/7701/status`)).status, 200);
  assert.equal(
    (
      await fetch(`${base}/api/opsx/poddelete/openshift`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ consent: false }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(`${base}/api/opsx/poddelete/openshift`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          consent: true,
          env: 'dev',
          tenant: 'pay',
          pairs: [{ namespace: 'ns-orders', application: 'orders-svc' }],
          pods: [{ cluster: 'ocp-dev-01', namespace: 'ns-orders', pod: 'orders-1' }],
        }),
      })
    ).status,
    200,
  );
  assert.equal((await fetch(`${base}/api/opsx/poddelete/0/7701/status`)).status, 200);

  // Job-status IDOR & WAS gate & 501 template missing
  assert.equal((await fetch(`${base}/api/opsx/job-status/0/7701`)).status, 200);
  assert.equal(
    (await fetch(`${base}/api/opsx/job-status/0/7702`, { headers: { 'x-user': 'bob' } })).status,
    403,
  );
  wasMatch = true;
  assert.equal(
    (await fetch(`${base}/api/opsx/job-status/0/7702`, { headers: { 'x-user': 'alice' } })).status,
    409,
  );
  wasMatch = false;
  templateMissing = true;
  assert.equal(
    (
      await fetch(`${base}/api/opsx/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform: 'legacy', operation: 'restart' }),
      })
    ).status,
    501,
  );
});

test('server/inventory/index: /tables, /table-visibility, /columns, /data, /query, /saved-queries, /history', async (t) => {
  const backups = new Map();

  const sampleRows = [
    { host: 'SRV01', env: 'prod', app: 'pay', owner_team: 'Core' },
    { host: 'SRV02', env: 'test', app: 'pay', owner_team: 'Core' },
  ];
  const mockPool = {
    request: () => ({
      parameters: {},
      input(name, _type, val) {
        this.parameters[name] = { value: val };
        return this;
      },
      async query(q) {
        if (q.includes('INFORMATION_SCHEMA.TABLES')) {
          return {
            recordset: [
              { TABLE_NAME: 'MWAppsInventory' },
              { TABLE_NAME: 'Inventory' },
              { TABLE_NAME: 'sys' },
            ],
          };
        }
        if (q.includes('INFORMATION_SCHEMA.COLUMNS')) {
          return {
            recordset: [
              { COLUMN_NAME: 'host', DATA_TYPE: 'nvarchar' },
              { COLUMN_NAME: 'env', DATA_TYPE: 'nvarchar' },
              { COLUMN_NAME: 'app', DATA_TYPE: 'nvarchar' },
              { COLUMN_NAME: 'owner_team', DATA_TYPE: 'nvarchar' },
            ],
          };
        }
        if (q.includes('SELECT COUNT(*) AS total'))
          return { recordset: [{ total: sampleRows.length }] };
        if (q.includes('AS val, COUNT(*) AS cnt'))
          return {
            recordset: [
              { val: 'prod', cnt: 1 },
              { val: 'test', cnt: 1 },
            ],
          };
        return { recordset: sampleRows };
      },
    }),
  };

  setMockModule(
    '../inventory/mssql.cjs',
    {
      getPool: async () => mockPool,
      isAvailable: () => true,
      poolStats: () => ({ connected: true }),
      query: async (sqlText) => {
        if (sqlText.includes('INFORMATION_SCHEMA.TABLES')) {
          return {
            recordset: [
              { TABLE_NAME: 'MWAppsInventory' },
              { TABLE_NAME: 'Inventory' },
              { TABLE_NAME: 'sys' },
            ],
          };
        }
        if (sqlText.includes('INFORMATION_SCHEMA.COLUMNS')) {
          return {
            recordset: [
              { COLUMN_NAME: 'host', DATA_TYPE: 'nvarchar' },
              { COLUMN_NAME: 'env', DATA_TYPE: 'nvarchar' },
              { COLUMN_NAME: 'app', DATA_TYPE: 'nvarchar' },
              { COLUMN_NAME: 'owner_team', DATA_TYPE: 'nvarchar' },
            ],
          };
        }
        if (sqlText.includes('is_active = 0')) return { recordset: [] };
        if (
          sqlText.includes('inventory_table_role_visibility') &&
          sqlText.includes('SELECT COUNT(*)')
        )
          return { recordset: [{ n: 1 }] };
        if (sqlText.includes('FROM inventory_table_role_visibility'))
          return {
            recordset: [
              { role_name: 'User', table_name: 'MWAppsInventory' },
              { role_name: 'Admin', table_name: '*' },
            ],
          };
        if (sqlText.includes('SELECT COUNT(*)')) return { recordset: [{ cnt: 1, n: 1 }] };
        if (sqlText.includes('inventory_table_aliases'))
          return { recordset: [{ table_name: 'MWAppsInventory', alias: 'Uygulamalar' }] };
        if (sqlText.includes('inventory_table_visibility')) {
          return {
            recordset: [
              {
                id: 1,
                schema_name: 'dbo',
                table_name: 'MWAppsInventory',
                display_name: 'Uygulamalar',
                is_active: 1,
                sort_order: 1,
                override_count: 0,
              },
            ],
          };
        }
        if (sqlText.includes('inventory_table_user_override')) return { recordset: [] };
        if (sqlText.includes('inventory_table_column_visibility')) return { recordset: [] };
        if (sqlText.includes('inventory_saved_queries'))
          return {
            recordset: [
              {
                name: 'all-hosts',
                description: '',
                sql_text: 'SELECT * FROM Inventory',
                table_name: 'Inventory',
                created_by: 'alice',
                is_public: 1,
                is_default: 0,
              },
            ],
          };
        return { recordset: [] };
      },
      sql: { VarChar: () => 'varchar', NVarChar: () => 'nvarchar', Int: 'int' },
    },
    backups,
  );
  setMockModule(
    '../db/index.cjs',
    {
      query: async () => ({ rows: [] }),
    },
    backups,
  );
  setMockModule(
    '../inventory/history-config.cjs',
    {
      effectiveTables: async () => [
        { table: 'Inventory', label: 'Envanter', mode: 'snapshot', key: ['host'] },
      ],
      COMMON_VOLATILE: ['updated_at'],
      invalidateCache: () => {},
    },
    backups,
  );
  setMockModule(
    '../inventory/history.cjs',
    {
      recentRuns: async () => [{ id: 1 }],
      rowsAt: async () => sampleRows,
      diff: async () => ({ added: [], removed: [], changed: [] }),
      rowCountSeries: async () => [],
    },
    backups,
  );
  setMockModule(
    '../inventory/history-scheduler.cjs',
    {
      start: () => {},
      tick: async () => ({ ok: true }),
    },
    backups,
  );
  setMockModule(
    '../auth/index.cjs',
    {
      getRequestUser: (req) => ({
        username: req.headers['x-user'] || 'alice',
        role: req.headers['x-role'] || 'Admin',
      }),
      getRequestRole: (req) => req.headers['x-role'] || 'Admin',
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
      auditPortal: () => {},
    },
    backups,
  );

  delete require.cache[require.resolve('../inventory/index.cjs')];
  const { initInventory, resetTableCache } = require('../inventory/index.cjs');
  resetTableCache?.();

  const app = express();
  initInventory(app);
  const srv = http.createServer(app);
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    srv.closeAllConnections?.();
    srv.close();
    restoreModules(backups, ['../inventory/index.cjs']);
  });
  const base = `http://127.0.0.1:${srv.address().port}`;

  assert.equal((await fetch(`${base}/api/inventory/health`)).status, 200);
  const tbls = await (await fetch(`${base}/api/inventory/tables?viewAsRole=User`)).json();
  assert.ok(tbls.tables.includes('MWAppsInventory'));
  assert.equal(
    (await (await fetch(`${base}/api/inventory/table-aliases`)).json()).aliases.MWAppsInventory,
    'Uygulamalar',
  );
  assert.equal((await fetch(`${base}/api/inventory/table-visibility`)).status, 200);
  assert.equal(
    (await fetch(`${base}/api/inventory/table-visibility`, { headers: { 'x-role': 'User' } }))
      .status,
    403,
  );
  assert.equal(
    (await (await fetch(`${base}/api/inventory/columns/MWAppsInventory`)).json()).columns.length,
    4,
  );
  assert.equal((await fetch(`${base}/api/inventory/columns/sys`)).status, 403);
  assert.equal(
    (await (await fetch(`${base}/api/inventory/distinct/MWAppsInventory/env`)).json()).values
      .length,
    2,
  );

  // /data/:table countOnly + filterGroup + search + blocked check
  assert.equal(
    (await (await fetch(`${base}/api/inventory/data/MWAppsInventory?countOnly=true`)).json()).total,
    2,
  );
  const fg = encodeURIComponent(
    JSON.stringify({ mode: 'AND', filters: [{ col: 'env', op: 'equals', value: 'prod' }] }),
  );
  const mf = encodeURIComponent(JSON.stringify({ env: ['prod'] }));
  const dataRes = await (
    await fetch(
      `${base}/api/inventory/data/MWAppsInventory?search=pay&orderBy=host&orderDir=DESC&filterGroup=${fg}&multiFilters=${mf}`,
    )
  ).json();
  assert.equal(dataRes.rows.length, 2);
  assert.equal(
    (await fetch(`${base}/api/inventory/data/Inventory`, { headers: { 'x-role': 'User' } })).status,
    403,
  );

  // /query validation (non-Admin, DROP rejected, SELECT allowed) + saved-queries + history
  assert.equal(
    (
      await fetch(`${base}/api/inventory/query`, {
        method: 'POST',
        headers: { 'x-role': 'User', 'content-type': 'application/json' },
        body: JSON.stringify({ sqlText: 'SELECT * FROM Inventory' }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${base}/api/inventory/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sqlText: 'DROP TABLE Inventory' }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${base}/api/inventory/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sqlText: 'SELECT * FROM MWAppsInventory' }),
      })
    ).status,
    200,
  );
  assert.equal((await fetch(`${base}/api/inventory/saved-queries`)).status, 200);
  assert.equal((await fetch(`${base}/api/inventory/history/tables`)).status, 200);
  assert.equal((await fetch(`${base}/api/inventory/history/config`)).status, 200);
});
