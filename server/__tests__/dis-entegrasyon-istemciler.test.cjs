'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
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

async function startTcpEcho() {
  const srv = net.createServer((sock) => sock.end());
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  return srv;
}

test('server/kibana & server/splunk client + Express routes', async (t) => {
  const backups = new Map();
  const origEnv = { ...process.env };
  const origFetch = globalThis.fetch;
  const tcpSrv = await startTcpEcho();
  const port = tcpSrv.address().port;

  let fetchMode = 'ok';
  globalThis.fetch = async (input, init) => {
    const urlStr = typeof input === 'string' ? input : (input && input.href) || String(input);
    if (!urlStr.includes('/services/search/jobs/export')) {
      return origFetch(input, init);
    }
    if (fetchMode === 'network_err') throw new Error('connect ECONNREFUSED');
    if (fetchMode === 'http_500') {
      return new Response('internal err', { status: 500 });
    }
    const payload = [
      JSON.stringify({ preview: true }),
      'not-json-line',
      JSON.stringify({ result: { _raw: 'GET /ok 200', host: 'web-01' } }),
    ].join('\n');
    return new Response(payload, { status: 200 });
  };

  setMockModule(
    '../auth/index.cjs',
    {
      requireAuth: (req, res, next) => {
        req.session = { user: { username: 'tester', role: req.headers['x-test-role'] || 'User' } };
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
    '../mcp/client.cjs',
    {
      buildDispatcher: () => undefined,
    },
    backups,
  );

  delete require.cache[require.resolve('../kibana/client.cjs')];
  delete require.cache[require.resolve('../kibana/index.cjs')];
  delete require.cache[require.resolve('../splunk/client.cjs')];
  delete require.cache[require.resolve('../splunk/index.cjs')];

  const kibanaClient = require('../kibana/client.cjs');
  const { initKibana } = require('../kibana/index.cjs');
  const splunkClient = require('../splunk/client.cjs');
  const { initSplunk } = require('../splunk/index.cjs');

  const app = express();
  initKibana(app);
  initSplunk(app);
  const httpSrv = http.createServer(app);
  await new Promise((resolve) => httpSrv.listen(0, '127.0.0.1', resolve));

  t.after(() => {
    httpSrv.closeAllConnections?.();
    httpSrv.close();
    tcpSrv.close();
    globalThis.fetch = origFetch;
    process.env = origEnv;
    restoreModules(backups, [
      '../kibana/client.cjs',
      '../kibana/index.cjs',
      '../splunk/client.cjs',
      '../splunk/index.cjs',
    ]);
  });

  const base = `http://127.0.0.1:${httpSrv.address().port}`;

  // Kibana unconfigured -> unreachable -> reachable
  delete process.env.KIBANA_BASE_URL;
  assert.equal(kibanaClient.isConfigured(), false);
  let r = await fetch(`${base}/api/kibana/health`);
  assert.equal((await r.json()).configured, false);

  process.env.KIBANA_BASE_URL = `http://127.0.0.1:${port}`;
  r = await fetch(`${base}/api/kibana/health`);
  let body = await r.json();
  assert.equal(body.configured, true);
  assert.equal(body.reachable, true);

  process.env.KIBANA_BASE_URL = 'not-a-url';
  r = await fetch(`${base}/api/kibana/health`);
  assert.equal((await r.json()).reachable, false);

  // Splunk client & routes
  delete process.env.SPLUNK_BASE_URL;
  delete process.env.SPLUNK_TOKEN;
  r = await fetch(`${base}/api/splunk/health`);
  assert.equal((await r.json()).configured, false);

  await assert.rejects(() => splunkClient.search({ product: 'nginx' }), /SPLUNK_BASE_URL/);

  process.env.SPLUNK_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.SPLUNK_TOKEN = 'test-token-value';
  r = await fetch(`${base}/api/splunk/health`);
  assert.equal((await r.json()).reachable, true);

  r = await fetch(`${base}/api/splunk/products`);
  assert.ok((await r.json()).products.includes('nginx'));

  r = await fetch(`${base}/api/splunk/search`);
  assert.equal(r.status, 400);

  r = await fetch(`${base}/api/splunk/search?product=nginx&windowMinutes=10`);
  body = await r.json();
  assert.equal(body.source, 'live');
  assert.equal(body.eventCount, 1);

  // Cache hit
  r = await fetch(`${base}/api/splunk/search?product=nginx&windowMinutes=10`);
  assert.equal((await r.json()).source, 'cache');

  // Error branches
  fetchMode = 'http_500';
  r = await fetch(`${base}/api/splunk/search?product=nginx&refresh=1`);
  assert.equal(r.status, 502);

  fetchMode = 'network_err';
  await assert.rejects(() => splunkClient.search({ product: 'invalid_prod' }), /Geçersiz ürün/);
});

test('server/instana & server/dynatrace routes: health, problems, events, entities, metrics, cache', async (t) => {
  const backups = new Map();
  const origInstanaUrl = process.env.INSTANA_MCP_URL;
  process.env.INSTANA_MCP_URL = 'https://instana-mcp.example.internal/mcp';

  let dtFail = false;
  let instanaConfigured = true;
  let instanaFail = false;

  setMockModule(
    '../auth/index.cjs',
    {
      requireAuth: (req, _res, next) => {
        req.session = { user: { username: 'opsuser', role: 'User' } };
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
    '../inventory/index.cjs',
    {
      getTeamOwnership: async (names) =>
        new Map(names.map((n) => [String(n).toLowerCase(), { ekibi: 'Platform' }])),
    },
    backups,
  );
  setMockModule(
    '../instana/client.cjs',
    {
      isConfigured: () => instanaConfigured,
      listTools: async () => {
        if (instanaFail) throw new Error('instana tools err');
        return [{ name: 'get_open_issues' }];
      },
      callTool: async (tool) => {
        if (instanaFail) throw new Error('instana err');
        if (tool === 'get_open_issues')
          return {
            issues: [
              { host: 'web-a', title: 'High CPU' },
              { host: 'db-a', title: 'Disk' },
            ],
          };
        if (tool === 'get_events') return { events: [{ entityName: 'web-a', summary: 'Restart' }] };
        if (tool === 'get_services') return { services: [{ serviceName: 'pay-api' }] };
        return {};
      },
    },
    backups,
  );
  setMockModule(
    '../dynatrace/client.cjs',
    {
      isConfigured: () => true,
      checkReachable: async () => true,
      checkConnect: async () => !dtFail,
      getStatus: () => ({
        connectedUrl: dtFail ? null : 'https://dt.example.internal',
        configuredUrl: 'https://dt.example.internal',
        lastError: dtFail ? { at: '2026-11-14T00:00:00Z' } : null,
      }),
      getDefaultAlias: async () => 'prod',
      getEnvironments: async () => {
        if (dtFail) throw new Error('dt env error');
        return { aliases: ['prod', 'nonprod'], raw: 'prod,nonprod' };
      },
      listTools: async () => {
        if (dtFail) throw new Error('dt tools error');
        return [{ name: 'dynatrace_managed_list_problems' }];
      },
      callTool: async (tool) => {
        if (dtFail) throw new Error('dt mcp error');
        if (tool === 'dynatrace_managed_list_problems') {
          return {
            text: 'problemId: P-1\n  displayId: P-100\n  title: web-a memory leak\n  status: OPEN',
          };
        }
        if (tool === 'dynatrace_managed_list_events') {
          return { text: 'eventId: E-1\n  eventType: DEPLOYMENT\n  title: rollout' };
        }
        if (tool === 'dynatrace_managed_discover_entities') {
          return { text: 'entityId: HOST-1\n  displayName: web-a\n  type: HOST' };
        }
        return { text: `ok:${tool}` };
      },
    },
    backups,
  );

  delete require.cache[require.resolve('../instana/index.cjs')];
  delete require.cache[require.resolve('../dynatrace/index.cjs')];
  delete require.cache[require.resolve('../dynatrace/cache.cjs')];

  const { initInstana } = require('../instana/index.cjs');
  const { initDynatrace } = require('../dynatrace/index.cjs');

  const app = express();
  app.use(express.json());
  initInstana(app);
  initDynatrace(app);

  const srv = http.createServer(app);
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    srv.closeAllConnections?.();
    srv.close();
    if (origInstanaUrl === undefined) delete process.env.INSTANA_MCP_URL;
    else process.env.INSTANA_MCP_URL = origInstanaUrl;
    restoreModules(backups, [
      '../instana/index.cjs',
      '../dynatrace/index.cjs',
      '../dynatrace/cache.cjs',
    ]);
  });

  const base = `http://127.0.0.1:${srv.address().port}`;

  // Instana
  let r = await fetch(`${base}/api/instana/health`);
  assert.equal((await r.json()).mcpUrl, 'https://instana-mcp.example.internal/mcp');

  r = await fetch(`${base}/api/instana/tools`);
  assert.equal((await r.json()).tools[0].name, 'get_open_issues');

  r = await fetch(`${base}/api/instana/problems?q=web-a`);
  let body = await r.json();
  assert.equal(body.source, 'mcp');
  assert.equal(body.issues.length, 1);
  assert.equal(body.issues[0].owningTeam.ekibi, 'Platform');

  r = await fetch(`${base}/api/instana/problems?q=web-a`);
  assert.equal((await r.json()).source, 'cache');

  r = await fetch(`${base}/api/instana/events`);
  assert.equal((await r.json()).events.length, 1);

  r = await fetch(`${base}/api/instana/services`);
  assert.equal((await r.json()).services.length, 1);
  await fetch(`${base}/api/instana/services`); // cached

  await fetch(`${base}/api/instana/cache`, { method: 'DELETE' });

  instanaFail = true;
  assert.equal((await fetch(`${base}/api/instana/problems?refresh=1`)).status, 502);
  assert.equal((await fetch(`${base}/api/instana/events`)).status, 502);
  assert.equal((await fetch(`${base}/api/instana/tools`)).status, 502);
  instanaConfigured = false;
  assert.equal((await (await fetch(`${base}/api/instana/problems`)).json()).ok, false);

  // Dynatrace
  assert.equal((await (await fetch(`${base}/api/dynatrace/health`)).json()).mcpConnected, true);
  assert.equal((await (await fetch(`${base}/api/dynatrace/health`)).json()).mcpConnected, true); // cached

  assert.equal(
    (await (await fetch(`${base}/api/dynatrace/environments`)).json()).defaultAlias,
    'prod',
  );
  assert.equal((await (await fetch(`${base}/api/dynatrace/tools`)).json()).tools.length, 1);

  r = await fetch(`${base}/api/dynatrace/problems?host=web-a`);
  body = await r.json();
  assert.equal(body.problems.length, 1);
  assert.equal(
    (await (await fetch(`${base}/api/dynatrace/problems?host=web-a`)).json()).source,
    'cache',
  );

  assert.equal((await (await fetch(`${base}/api/dynatrace/problems/P-1`)).json()).ok, true);
  assert.equal(
    (
      await (
        await fetch(`${base}/api/dynatrace/events?host=web-a&tag=env:prod&managementZone=Core`)
      ).json()
    ).events.length,
    1,
  );
  assert.equal(
    (
      await (
        await fetch(`${base}/api/dynatrace/events?host=web-a&tag=env:prod&managementZone=Core`)
      ).json()
    ).source,
    'cache',
  );

  assert.equal((await fetch(`${base}/api/dynatrace/entities`)).status, 400);
  r = await fetch(`${base}/api/dynatrace/entities?name=web-a&tag=tier:web`);
  body = await r.json();
  assert.equal(body.entities[0].owningTeam.ekibi, 'Platform');

  assert.equal((await (await fetch(`${base}/api/dynatrace/entities/HOST-1`)).json()).ok, true);
  assert.equal((await (await fetch(`${base}/api/dynatrace/metrics?search=cpu`)).json()).ok, true);
  assert.equal(
    (
      await fetch(`${base}/api/dynatrace/metrics/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(`${base}/api/dynatrace/metrics/query`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ metricSelector: 'builtin:host.cpu.usage' }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/dynatrace/logs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'ERROR' }),
      })
    ).status,
    200,
  );
  assert.equal((await fetch(`${base}/api/dynatrace/cache`, { method: 'DELETE' })).status, 200);

  dtFail = true;
  assert.equal((await fetch(`${base}/api/dynatrace/problems?refresh=1`)).status, 502);
  assert.equal((await fetch(`${base}/api/dynatrace/environments`)).status, 502);
});

test('server/ai-analyst, server/logx, and server/ansible routers', async (t) => {
  const backups = new Map();
  let aiConfigured = true;
  let rateLimited = false;
  let orchestrateMode = 'ok';
  let analyzeErr = null;

  setMockModule(
    '../auth/index.cjs',
    {
      requireAuth: (req, _res, next) => {
        req.session = { user: { username: 'ali', role: req.headers['x-role'] || 'User' } };
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
    '../ai/provider.cjs',
    {
      isConfigured: () => aiConfigured,
      getProvider: () => 'openai',
      activeModel: () => 'gpt-4o',
      checkRateLimit: () => rateLimited,
      getFeatureLimits: () => ({ chatPerHour: 20 }),
    },
    backups,
  );
  setMockModule(
    '../logx/ai-analyzer.cjs',
    {
      analyze: async (lines) => {
        if (analyzeErr) throw analyzeErr;
        return { summary: `analyzed ${lines.length}` };
      },
    },
    backups,
  );
  setMockModule(
    '../ai-analyst/orchestrator.cjs',
    {
      orchestrate: async ({ emit }) => {
        emit({ type: 'tool_call', name: 'dt_problems', args: {} });
        emit({ type: 'text', text: 'Analysis done.' });
        if (orchestrateMode === 'quota') {
          throw new Error('AI API 429 rate_limit_exceeded');
        }
      },
    },
    backups,
  );
  setMockModule(
    '../ai-analyst/history.cjs',
    {
      logUsage: async () => {},
      createConversation: async () => 11,
      appendMessage: async () => {},
      listConversations: async () => [{ id: 11, title: 'Chat' }],
      getConversation: async (_u, id) => (id === '11' ? { id: 11, messages: [] } : null),
      deleteConversation: async (_u, id) => id === '11',
      usageSummary: async () => [{ day: '2026-11-14', count: 3 }],
    },
    backups,
  );

  setMockModule(
    '../db/index.cjs',
    {
      isAvailable: async () => true,
    },
    backups,
  );
  setMockModule(
    '../logx/inventory.cjs',
    {
      listHosts: async () => [{ id: 1, hostname: 'app-1' }],
      getAllHosts: async () => [{ id: 1, hostname: 'app-1' }],
      createHost: async (d) => ({ id: 2, ...d }),
      updateHost: async (id, d) => (id === 2 ? { id, ...d } : null),
      deleteHost: async (id) => id === 2,
    },
    backups,
  );
  setMockModule(
    '../logx/audit.cjs',
    {
      getLogs: async () => [{ id: 1, action: 'view' }],
      verifyChain: async () => ({ valid: true, checked: 1 }),
    },
    backups,
  );
  setMockModule(
    '../ansible/playbook-registry.cjs',
    {
      getByKey: async (key) =>
        key === 'missing'
          ? null
          : { key, enabled: true, handler: 'host_target', displayName: 'Heap' },
      getEffectiveTemplateId: (row) => (row.key === 'no_tpl' ? null : 55),
    },
    backups,
  );
  setMockModule(
    '../ansible/runner.cjs',
    {
      initAnsibleRunner: () => {},
      isConfigured: () => false,
    },
    backups,
  );

  delete require.cache[require.resolve('../ai-analyst/index.cjs')];
  delete require.cache[require.resolve('../logx/index.cjs')];
  delete require.cache[require.resolve('../ansible/index.cjs')];

  const { initAiAnalyst } = require('../ai-analyst/index.cjs');
  const { initLogX } = require('../logx/index.cjs');
  const { initAnsible } = require('../ansible/index.cjs');

  const app = express();
  app.use(express.json());
  initAiAnalyst(app);
  initLogX(app);
  initAnsible(app);

  const srv = http.createServer(app);
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    srv.closeAllConnections?.();
    srv.close();
    restoreModules(backups, [
      '../ai-analyst/index.cjs',
      '../logx/index.cjs',
      '../ansible/index.cjs',
    ]);
  });

  const base = `http://127.0.0.1:${srv.address().port}`;

  // AI Analyst
  assert.equal((await (await fetch(`${base}/api/ai-analyst/health`)).json()).provider, 'openai');
  assert.equal(
    (
      await fetch(`${base}/api/ai-analyst/analyze-logs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
    400,
  );
  let r = await fetch(`${base}/api/ai-analyst/analyze-logs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lines: ['err 1'] }),
  });
  assert.equal((await r.json()).summary, 'analyzed 1');

  analyzeErr = Object.assign(new Error('AI API 429'), { status: 429 });
  assert.equal(
    (
      await fetch(`${base}/api/ai-analyst/analyze-logs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lines: ['e'] }),
      })
    ).status,
    429,
  );
  analyzeErr = null;

  // Chat SSE
  assert.equal(
    (
      await fetch(`${base}/api/ai-analyst/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
    400,
  );
  r = await fetch(`${base}/api/ai-analyst/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'check prod' }] }),
  });
  const sseText = await r.text();
  assert.match(sseText, /"type":"done"/);

  orchestrateMode = 'quota';
  r = await fetch(`${base}/api/ai-analyst/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'again' }], conversationId: 11 }),
  });
  assert.match(await r.text(), /kotası doldu/);

  rateLimited = true;
  assert.equal(
    (
      await fetch(`${base}/api/ai-analyst/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }] }),
      })
    ).status,
    429,
  );
  rateLimited = false;

  aiConfigured = false;
  assert.equal(
    (
      await fetch(`${base}/api/ai-analyst/analyze-logs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lines: ['x'] }),
      })
    ).status,
    503,
  );

  assert.equal(
    (await (await fetch(`${base}/api/ai-analyst/conversations`)).json()).conversations.length,
    1,
  );
  assert.equal((await fetch(`${base}/api/ai-analyst/conversations/11`)).status, 200);
  assert.equal((await fetch(`${base}/api/ai-analyst/conversations/999`)).status, 404);
  assert.equal(
    (await fetch(`${base}/api/ai-analyst/conversations/11`, { method: 'DELETE' })).status,
    200,
  );
  assert.equal(
    (await fetch(`${base}/api/ai-analyst/conversations/999`, { method: 'DELETE' })).status,
    404,
  );
  assert.equal((await fetch(`${base}/api/ai-analyst/usage`)).status, 403);
  assert.equal(
    (await fetch(`${base}/api/ai-analyst/usage`, { headers: { 'x-role': 'Admin' } })).status,
    200,
  );

  // LogX + Ansible
  assert.equal((await (await fetch(`${base}/api/logx/health`)).json()).db, true);
  assert.equal((await (await fetch(`${base}/api/logx/inventory`)).json()).hosts.length, 1);
  assert.equal((await fetch(`${base}/api/logx/admin/inventory`)).status, 403);
  assert.equal(
    (await fetch(`${base}/api/logx/admin/inventory`, { headers: { 'x-role': 'Admin' } })).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/logx/admin/inventory`, {
        method: 'POST',
        headers: { 'x-role': 'Admin', 'content-type': 'application/json' },
        body: JSON.stringify({ hostname: 'h2', ip: '198.51.100.2' }),
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await fetch(`${base}/api/logx/admin/inventory/2`, {
        method: 'PUT',
        headers: { 'x-role': 'Admin', 'content-type': 'application/json' },
        body: JSON.stringify({ hostname: 'h2', ip: '198.51.100.2' }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/logx/admin/inventory/99`, {
        method: 'PUT',
        headers: { 'x-role': 'Admin', 'content-type': 'application/json' },
        body: JSON.stringify({ hostname: 'h2', ip: '198.51.100.2' }),
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await fetch(`${base}/api/logx/admin/inventory/2`, {
        method: 'DELETE',
        headers: { 'x-role': 'Admin' },
      })
    ).status,
    200,
  );
  assert.equal(
    (await fetch(`${base}/api/logx/admin/audit`, { headers: { 'x-role': 'Admin' } })).status,
    200,
  );
  assert.equal(
    (await fetch(`${base}/api/logx/admin/audit/verify`, { headers: { 'x-role': 'Admin' } })).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/logx/playbook-run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(`${base}/api/logx/playbook-run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'heap', hostname: 'h1' }),
      })
    ).status,
    503,
  );

  assert.equal((await (await fetch(`${base}/api/ansible/health`)).json()).awxConfigured, false);
});
