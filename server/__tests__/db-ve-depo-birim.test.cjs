'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

function setMockModule(relFromThisFile, exportsObj, backups) {
  const abs = require.resolve(relFromThisFile);
  if (!backups.has(abs)) {
    backups.set(abs, require.cache[abs] || null);
  }
  require.cache[abs] = {
    id: abs,
    filename: abs,
    loaded: true,
    exports: exportsObj,
  };
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

test('server/db/config-mirror: restoreFileFromDb covers restored, seeded, noop, skip and mirrorToDb', async () => {
  const backups = new Map();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-mirror-'));
  const queries = [];

  try {
    setMockModule(
      '../db/index.cjs',
      {
        query: async (sql, params) => {
          queries.push({ sql, params });
          if (sql.includes('SELECT data FROM portal_config_blobs')) {
            if (params[0] === 'restorable') {
              return { rows: [{ data: JSON.stringify({ hello: 'world' }) }] };
            }
            if (params[0] === 'noop-blob') {
              return { rows: [{ data: '{}' }] };
            }
            if (params[0] === 'err-blob') {
              throw new Error('db down');
            }
            return { rows: [] };
          }
          if (sql.includes('SELECT 1 FROM portal_config_blobs')) {
            return { rows: params[0] === 'existing-mirror' ? [{ x: 1 }] : [] };
          }
          return { rows: [] };
        },
      },
      backups,
    );

    delete require.cache[require.resolve('../db/config-mirror.cjs')];
    const cm = require('../db/config-mirror.cjs');

    const restorePath = path.join(tmpDir, 'restore.json');
    assert.equal(await cm.restoreFileFromDb('restorable', restorePath), 'restored');
    assert.deepEqual(JSON.parse(fs.readFileSync(restorePath, 'utf8')), { hello: 'world' });

    const seedPath = path.join(tmpDir, 'seed.json');
    fs.writeFileSync(seedPath, JSON.stringify({ seeded: true }));
    assert.equal(await cm.restoreFileFromDb('seed-target', seedPath), 'seeded');

    assert.equal(await cm.restoreFileFromDb('noop-blob', seedPath), 'noop');
    assert.equal(await cm.restoreFileFromDb('err-blob', seedPath), 'skip');

    cm.mirrorToDb('existing-mirror', { a: 1 });
    cm.mirrorToDb('new-mirror', { b: 2 });
    await new Promise((r) => setTimeout(r, 30));

    assert.ok(queries.some((q) => q.sql.includes('UPDATE portal_config_blobs')));
    assert.ok(queries.some((q) => q.sql.includes('INSERT INTO portal_config_blobs')));

    await cm.reconcileAllConfigBlobs();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    restoreModules(backups, ['../db/config-mirror.cjs']);
  }
});

test('server/db/seed & migrate: insert/skip hosts and exit cleanly on success and failure', async () => {
  const backups = new Map();
  const origExit = process.exit;
  const origAppEnv = process.env.APP_ENV;
  const dbInserts = [];
  let setupCalls = 0;

  try {
    setMockModule(
      '../db/mssql-setup.cjs',
      {
        setupTables: async () => {
          setupCalls++;
          if (setupCalls === 3) throw new Error('migrate failure');
        },
      },
      backups,
    );
    setMockModule(
      '../db/index.cjs',
      {
        query: async (sql, params) => {
          if (sql.includes('SELECT 1 AS x FROM inventory_hosts')) {
            return { rows: params[0] === 'app-server-01' ? [{ x: 1 }] : [] };
          }
          dbInserts.push(params[0]);
          return { rows: [] };
        },
      },
      backups,
    );

    // 1) seed.cjs
    const seedExitCode = await new Promise((resolve) => {
      process.exit = (code) => resolve(code);
      delete require.cache[require.resolve('../db/seed.cjs')];
      require('../db/seed.cjs');
    });
    assert.equal(seedExitCode, 0);
    assert.ok(dbInserts.includes('app-server-02'));
    assert.ok(!dbInserts.includes('app-server-01'));

    // 2) migrate.cjs success
    process.env.APP_ENV = 'test';
    const migrateOkCode = await new Promise((resolve) => {
      process.exit = (code) => resolve(code);
      delete require.cache[require.resolve('../db/migrate.cjs')];
      require('../db/migrate.cjs');
    });
    assert.equal(migrateOkCode, 0);

    // 3) migrate.cjs error branch
    const migrateErrCode = await new Promise((resolve) => {
      process.exit = (code) => resolve(code);
      delete require.cache[require.resolve('../db/migrate.cjs')];
      require('../db/migrate.cjs');
    });
    assert.equal(migrateErrCode, 1);
  } finally {
    process.exit = origExit;
    if (origAppEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = origAppEnv;
    restoreModules(backups, ['../db/seed.cjs', '../db/migrate.cjs']);
  }
});

test('server/selfservice/store: fallback defaults, DB load, and group updates', async () => {
  const backups = new Map();
  let failLoad = false;
  let storedRow = {
    id: 'grp-ansible',
    group_key: 'ansible',
    label: 'Ansible',
    icon: 'CommandLineIcon',
    sort_order: 1,
    is_active: 1,
  };

  try {
    setMockModule(
      '../db/index.cjs',
      {
        query: async (sql, params) => {
          if (sql.startsWith('SELECT * FROM selfservice_groups')) {
            if (failLoad) throw new Error('db unreachable');
            return { rows: [storedRow] };
          }
          if (sql.startsWith('UPDATE selfservice_groups')) {
            storedRow = {
              ...storedRow,
              label: params[0],
              icon: params[1],
              sort_order: params[2],
              is_active: params[3] ? 1 : 0,
            };
            return { rowCount: 1, rows: [] };
          }
          return { rows: [] };
        },
      },
      backups,
    );

    delete require.cache[require.resolve('../selfservice/store.cjs')];
    const store = require('../selfservice/store.cjs');

    // Before load: static fallback
    assert.equal(store.readGroups()[0].groupKey, 'ansible');

    // Failed DB load keeps fallback without throwing
    failLoad = true;
    await store.loadSelfServiceStore();
    assert.equal(store.readGroups()[0].isActive, true);

    // Successful load and update
    failLoad = false;
    await store.loadSelfServiceStore();
    assert.equal(await store.updateGroup('missing', { label: 'X' }), null);

    const updated = await store.updateGroup('grp-ansible', {
      label: 'Otomasyon',
      icon: 'PlayIcon',
      sortOrder: 3,
      isActive: false,
    });
    assert.equal(updated.label, 'Otomasyon');
    assert.equal(updated.sortOrder, 3);
    assert.equal(updated.isActive, false);
  } finally {
    restoreModules(backups, ['../selfservice/store.cjs']);
  }
});

test('server/logx/inventory: CRUD operations and boolean normalization', async () => {
  const backups = new Map();
  const sampleRow = {
    id: 7,
    hostname: 'srv-01',
    fqdn: 'srv-01.example.internal',
    ip: '198.51.100.10',
    environment: 'dev',
    product_type: 'backend',
    middleware_type: 'JBoss',
    middleware_version: '7.4',
    port: 1111,
    is_active: 1,
    notes: 'n',
    server_type: 'generic',
  };

  try {
    setMockModule(
      '../db/index.cjs',
      {
        query: async (sql, params) => {
          if (sql.includes('WHERE is_active = 1')) return { rows: [sampleRow] };
          if (sql.includes('FROM inventory_hosts\n     ORDER BY'))
            return { rows: [{ ...sampleRow, is_active: false }] };
          if (sql.includes('WHERE id = $1') && sql.startsWith('SELECT')) {
            return { rows: params[0] === 7 ? [sampleRow] : [] };
          }
          if (sql.startsWith('INSERT INTO inventory_hosts')) {
            return { rows: [{ ...sampleRow, id: 8, hostname: params[0], is_active: params[8] }] };
          }
          if (sql.startsWith('UPDATE inventory_hosts')) {
            return {
              rows:
                params[11] === 7
                  ? [{ ...sampleRow, hostname: params[0], is_active: params[8] }]
                  : [],
            };
          }
          if (sql.startsWith('DELETE FROM inventory_hosts')) {
            return { rowCount: params[0] === 7 ? 1 : 0 };
          }
          return { rows: [] };
        },
      },
      backups,
    );

    delete require.cache[require.resolve('../logx/inventory.cjs')];
    const inv = require('../logx/inventory.cjs');

    const active = await inv.listHosts();
    assert.equal(active[0].is_active, true);

    const all = await inv.getAllHosts();
    assert.equal(all[0].is_active, false);

    assert.equal((await inv.getHostById(7)).hostname, 'srv-01');
    assert.equal(await inv.getHostById(999), null);

    const created = await inv.createHost({
      hostname: 'srv-02',
      ip: '198.51.100.11',
      is_active: true,
    });
    assert.equal(created.id, 8);

    const updated = await inv.updateHost(7, {
      hostname: 'srv-01-upd',
      ip: '198.51.100.10',
      is_active: false,
    });
    assert.equal(updated.hostname, 'srv-01-upd');
    assert.equal(updated.is_active, false);
    assert.equal(await inv.updateHost(999, { hostname: 'x', ip: '1.1.1.1' }), null);

    assert.equal(await inv.deleteHost(7), true);
    assert.equal(await inv.deleteHost(999), false);
  } finally {
    restoreModules(backups, ['../logx/inventory.cjs']);
  }
});

test('server/inventory/history-scheduler: todayUtcStart, alreadyRanToday, tick, start/stop', async () => {
  const backups = new Map();
  const origEnabled = process.env.INVENTORY_HISTORY_ENABLED;
  let ranTodayRows = [{ ok: 1 }];
  let failCheck = false;
  let snapshotCalls = 0;

  try {
    setMockModule(
      '../db/index.cjs',
      {
        query: async () => {
          if (failCheck) throw new Error('check failed');
          return { rows: ranTodayRows };
        },
      },
      backups,
    );
    setMockModule(
      '../inventory/history.cjs',
      {
        snapshotAll: async () => {
          snapshotCalls++;
          if (snapshotCalls === 2) throw new Error('snapshot error');
          return [{ table: 'inventory_hosts', status: 'ok', added: 1, changed: 0, removed: 0 }];
        },
      },
      backups,
    );

    delete require.cache[require.resolve('../inventory/history-scheduler.cjs')];
    const sched = require('../inventory/history-scheduler.cjs');

    const utc = sched._todayUtcStart(new Date('2026-11-14T15:30:00Z'));
    assert.equal(utc.toISOString(), '2026-11-14T00:00:00.000Z');

    assert.equal(await sched._alreadyRanToday(), true);
    assert.equal(await sched.tick(), null);

    failCheck = true;
    assert.equal(await sched.tick(), null);

    failCheck = false;
    ranTodayRows = [];
    const res = await sched.tick();
    assert.equal(res.length, 1);
    assert.equal(snapshotCalls, 1);

    // Error branch in snapshotAll returns null cleanly and resets _running flag
    assert.equal(await sched.tick({ force: true }), null);

    // Disabled start
    process.env.INVENTORY_HISTORY_ENABLED = 'false';
    sched.start();
    sched.stop();

    // Enabled start & stop
    process.env.INVENTORY_HISTORY_ENABLED = 'true';
    sched.start();
    sched.start(); // idempotent
    sched.stop();
  } finally {
    if (origEnabled === undefined) delete process.env.INVENTORY_HISTORY_ENABLED;
    else process.env.INVENTORY_HISTORY_ENABLED = origEnabled;
    restoreModules(backups, ['../inventory/history-scheduler.cjs']);
  }
});

test('server/mcp/index: HTTP endpoints status, tools, call and auth/error gates', async (t) => {
  const backups = new Map();
  let allowAuth = true;
  let allowAdmin = true;
  let throwOnTools = false;

  setMockModule(
    '../auth/index.cjs',
    {
      requireAuth: (req, res, next) => (allowAuth ? next() : res.status(401).json({ ok: false })),
      requireAdmin: (req, res, next) => (allowAdmin ? next() : res.status(403).json({ ok: false })),
    },
    backups,
  );
  setMockModule(
    '../dynatrace/client.cjs',
    {
      getStatus: () => ({ connected: true }),
      listTools: async () => [{ name: 'dt_tool' }],
      listToolsFull: async () => {
        if (throwOnTools) throw new Error('mcp down');
        return [{ name: 'dt_tool', inputSchema: {} }];
      },
      callTool: async (tool, args) => ({ tool, args }),
    },
    backups,
  );
  setMockModule(
    '../instana/client.cjs',
    {
      getStatus: (env) => ({ connected: true, env }),
      listTools: async (env) => [{ name: 'in_tool', env }],
      listToolsFull: async (env) => [{ name: 'in_tool', env, inputSchema: {} }],
      callTool: async (tool, args, env) => ({ tool, args, env }),
    },
    backups,
  );

  delete require.cache[require.resolve('../mcp/index.cjs')];
  const { initMcp } = require('../mcp/index.cjs');

  const app = express();
  app.use(express.json());
  initMcp(app);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.close();
    restoreModules(backups, ['../mcp/index.cjs']);
  });

  const base = `http://127.0.0.1:${server.address().port}`;

  // Status
  let r = await fetch(`${base}/api/mcp/instana/status?env=prod`);
  assert.equal(r.status, 200);
  let body = await r.json();
  assert.equal(body.status.env, 'prod');

  r = await fetch(`${base}/api/mcp/dynatrace/status`);
  assert.equal(r.status, 200);

  r = await fetch(`${base}/api/mcp/unknown/status`);
  assert.equal(r.status, 404);

  // Tools
  r = await fetch(`${base}/api/mcp/dynatrace/tools`);
  assert.equal((await r.json()).tools[0].name, 'dt_tool');

  r = await fetch(`${base}/api/mcp/instana/tools?env=prod&full=1`);
  assert.equal((await r.json()).tools[0].env, 'prod');

  throwOnTools = true;
  r = await fetch(`${base}/api/mcp/dynatrace/tools?full=1`);
  assert.equal(r.status, 502);
  throwOnTools = false;

  // Call validation + routing
  r = await fetch(`${base}/api/mcp/dynatrace/call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(r.status, 400);

  r = await fetch(`${base}/api/mcp/instana/call`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool: 'get_services', args: { k: 1 }, env: 'prod' }),
  });
  body = await r.json();
  assert.equal(body.result.env, 'prod');

  // Auth / Admin deny check
  allowAdmin = false;
  r = await fetch(`${base}/api/mcp/dynatrace/status`);
  assert.equal(r.status, 403);
  allowAuth = false;
  r = await fetch(`${base}/api/mcp/dynatrace/status`);
  assert.equal(r.status, 401);
});
