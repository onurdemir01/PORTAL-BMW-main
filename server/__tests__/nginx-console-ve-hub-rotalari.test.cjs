'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
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

test('server/nginx-console/index: HTTP endpoints /hosts, /tree, /file, /compare, /certs, /ratelimit, /drift, /orphans, /refresh, /push, /history, /changes, /blob, /job-status', async (t) => {
  const backups = new Map();
  const origEnv = { ...process.env };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ngxhub-'));
  const rawPath = path.join(tmpDir, 'raw');
  fs.mkdirSync(rawPath, { recursive: true });

  const conf1 = 'server { listen 80; }\n';
  const sha1 = crypto.createHash('sha256').update(conf1).digest('hex');
  const conf2 = 'server { listen 8080; }\n';
  const sha2 = crypto.createHash('sha256').update(conf2).digest('hex');
  const unusedConf = '# unused\n';
  const shaUnused = crypto.createHash('sha256').update(unusedConf).digest('hex');

  const mkDump = (host, mainContent, mainSha, extraUnused = false) =>
    [
      `@@HOST ${host}`,
      '@@TIME 2026-11-10T10:00:00Z',
      '@@PREFIX /usr/nginx',
      '@@NGINX_T ok',
      'nginx: configuration file /usr/nginx/conf/nginx.conf test is successful',
      '@@END',
      '@@LOADED',
      '/usr/nginx/conf/nginx.conf',
      '@@END',
      '@@TREE',
      `${mainContent.length}\t2026-11-10T10:00:00Z\t${mainSha}\twww\t/usr/nginx/conf/nginx.conf`,
      ...(extraUnused
        ? [
            `${unusedConf.length}\t2026-11-10T10:00:00Z\t${shaUnused}\twww\t/usr/nginx/conf.d/unused.conf`,
          ]
        : []),
      '@@END',
      `@@FILE /usr/nginx/conf/nginx.conf ${mainSha} ${mainContent.length}`,
      mainContent.trimEnd(),
      '@@END',
      ...(extraUnused
        ? [
            `@@FILE /usr/nginx/conf.d/unused.conf ${shaUnused} ${unusedConf.length}`,
            unusedConf.trimEnd(),
            '@@END',
          ]
        : []),
      '@@CERT /usr/nginx/ssl/site.crt',
      'exists=1',
      'notAfter=Nov 10 10:00:00 2027 GMT',
      'subject=CN=site.example.internal',
      '@@END',
    ].join('\n');

  fs.writeFileSync(path.join(rawPath, 'WEB01.txt'), mkDump('WEB01', conf1, sha1, true), 'utf8');
  fs.writeFileSync(path.join(rawPath, 'WEB02.txt'), mkDump('WEB02', conf2, sha2, false), 'utf8');
  process.env.NGINX_CONSOLE_DIR = tmpDir;

  setMockModule(
    '../auth/index.cjs',
    {
      requireAuth: (req, _res, next) => {
        req.session = {
          user: {
            username: req.headers['x-user'] || 'alice',
            role: req.headers['x-role'] || 'Admin',
          },
        };
        next();
      },
      requireAdmin: (req, res, next) =>
        req.headers['x-role'] === 'User' ? res.status(403).json({ ok: false }) : next(),
    },
    backups,
  );
  setMockModule(
    '../auth/visibility.cjs',
    {
      requireVisiblePrefix: () => (_req, _res, next) => next(),
      requireVisible: () => (_req, _res, next) => next(),
    },
    backups,
  );
  setMockModule(
    '../audit/nginx-host-labels.cjs',
    {
      etiketHaritasi: async () => ({ m: new Map(), hata: null }),
      etiketleriUygula: (row) => row,
      degisinceHaberVer: () => {},
    },
    backups,
  );
  setMockModule(
    '../inventory/mssql.cjs',
    {
      query: async (sqlText) => {
        if (sqlText.includes('FROM dbo.Inventory') || sqlText.includes('Inventory')) {
          return {
            recordset: [
              {
                host: 'WEB01',
                env: 'prod',
                location: 'IST',
                site: 'dc1',
                cpu: 4,
                memory_gb: 16,
                os: 'RHEL',
                service: 'Portal',
                nginx_version: '1.24',
                prefix: '/usr/nginx',
                config_count: 2,
                ip: '198.51.100.10',
              },
            ],
          };
        }
        return { recordset: [] };
      },
      sql: {},
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
  setMockModule('../audit/index.cjs', { auditPortal: () => {} }, backups);
  setMockModule(
    '../nginx-console/eski-sunucu.cjs',
    {
      suzgec: async () => ({
        ayir: (rows) => rows,
        bilgi: () => ({ sayi: 0, hostlar: [], gun: 14 }),
      }),
      adaylar: async () => ({ adaylar: [], gun: 14 }),
      temizle: async () => ({ hosts: [], toplamSatir: 0, butceDoldu: false, kalanVar: false }),
    },
    backups,
  );
  setMockModule(
    '../nginx-console/ratelimit.cjs',
    {
      loadRateLimits: async () => ({
        ok: true,
        hosts: [{ host: 'WEB01', env: 'prod', zones: [{ name: 'api', rate: '10r/s' }] }],
        summary: { hostCount: 1 },
        availableDates: ['2026-11-10'],
        scanDate: '2026-11-10',
      }),
      toCsv: () => '\ufeffhost;zone\r\nWEB01;api\r\n',
    },
    backups,
  );
  setMockModule(
    '../ansible/playbook-registry.cjs',
    {
      getByKey: async (k) => ({ key: k, enabled: true, awxServerId: 0 }),
      getEffectiveTemplateId: () => 501,
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
      launchJobOnServer: async () => ({ jobId: 8801, status: 'pending' }),
      getJobStatusOnServer: async () => ({
        status: 'successful',
        artifacts: { nginx_console_push_result: { ok: true, changed: true } },
      }),
      getJobOutputOnServer: async () => ({ output: 'OK' }),
    },
    backups,
  );

  delete require.cache[require.resolve('../nginx-console/history.cjs')];
  delete require.cache[require.resolve('../nginx-console/index.cjs')];
  const { initNginxConsole } = require('../nginx-console/index.cjs');

  const app = express();
  initNginxConsole(app);
  const srv = http.createServer(app);
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    srv.closeAllConnections?.();
    srv.close();
    process.env = origEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    restoreModules(backups, ['../nginx-console/index.cjs', '../nginx-console/history.cjs']);
  });
  const base = `http://127.0.0.1:${srv.address().port}`;

  // Admin gate vs non-admin readonly gate
  assert.equal(
    (
      await fetch(`${base}/api/nginx-console/refresh`, {
        method: 'POST',
        headers: { 'x-role': 'User', 'content-type': 'application/json' },
        body: JSON.stringify({ hosts: ['WEB01'] }),
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(`${base}/api/nginx-console/hosts`, { headers: { 'x-role': 'User' } })).status,
    200,
  );
  const hostsRes = await (await fetch(`${base}/api/nginx-console/hosts`)).json();
  assert.equal(hostsRes.ok, true);
  assert.equal(hostsRes.hosts.length, 2);

  // Tree, file, compare, certs, ratelimit, ratelimit.csv, drift, orphans
  const treeRes = await (await fetch(`${base}/api/nginx-console/tree/WEB01`)).json();
  assert.equal(treeRes.fileCount, 2);
  assert.ok(treeRes.tree && typeof treeRes.tree === 'object');
  assert.equal(
    (
      await (
        await fetch(`${base}/api/nginx-console/file/WEB01?path=/usr/nginx/conf/nginx.conf`)
      ).json()
    ).sha256,
    sha1,
  );
  assert.equal(
    (
      await (
        await fetch(`${base}/api/nginx-console/compare?path=/usr/nginx/conf/nginx.conf`)
      ).json()
    ).variants,
    2,
  );
  assert.equal((await (await fetch(`${base}/api/nginx-console/certs`)).json()).certs.length, 2);
  assert.equal((await (await fetch(`${base}/api/nginx-console/ratelimit`)).json()).hosts.length, 1);
  const csvRes = await fetch(`${base}/api/nginx-console/ratelimit.csv`);
  assert.equal(csvRes.status, 200);
  assert.match(await csvRes.text(), /WEB01;api/);
  assert.equal((await fetch(`${base}/api/nginx-console/drift`)).status, 200);
  const orp = await (await fetch(`${base}/api/nginx-console/orphans`)).json();
  assert.equal(orp.ok, true);
  assert.equal(orp.summary.unloaded, 1);

  // Refresh & orphans cleanup (validation + launch)
  assert.equal(
    (
      await fetch(`${base}/api/nginx-console/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(`${base}/api/nginx-console/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hosts: ['WEB01'] }),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/nginx-console/orphans/cleanup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ host: 'WEB01', mode: 'plan', paths: ['/etc/passwd'] }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(`${base}/api/nginx-console/orphans/cleanup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          host: 'WEB01',
          mode: 'plan',
          paths: ['/usr/nginx/conf/nginx.conf'],
        }),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await fetch(`${base}/api/nginx-console/orphans/cleanup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          host: 'WEB01',
          mode: 'plan',
          paths: ['/usr/nginx/conf.d/unused.conf'],
        }),
      })
    ).status,
    200,
  );

  // Push (validation + conflict + valid + blob)
  assert.equal(
    (
      await fetch(`${base}/api/nginx-console/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hosts: ['WEB01'], path: '/etc/shadow', content: 'x' }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(`${base}/api/nginx-console/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          hosts: ['WEB01'],
          path: '/usr/nginx/conf/nginx.conf',
          content: 'server { listen 8081; }',
          expectedSha: { WEB01: '0000' },
        }),
      })
    ).status,
    409,
  );
  const pushOk = await (
    await fetch(`${base}/api/nginx-console/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hosts: ['WEB01'],
        path: '/usr/nginx/conf/nginx.conf',
        content: 'server { listen 8081; }\n',
        expectedSha: { WEB01: sha1 },
      }),
    })
  ).json();
  assert.equal(pushOk.ok, true);

  // History, changes, blob, eski-sunucular, job-status
  assert.equal(
    (await fetch(`${base}/api/nginx-console/history/WEB01?path=/usr/nginx/conf/nginx.conf`)).status,
    200,
  );
  assert.equal((await fetch(`${base}/api/nginx-console/changes`)).status, 200);
  assert.equal((await fetch(`${base}/api/nginx-console/blob/${pushOk.newSha256}`)).status, 200);
  assert.equal((await fetch(`${base}/api/nginx-console/eski-sunucular`)).status, 200);
  assert.equal(
    (await (await fetch(`${base}/api/nginx-console/job-status/0/8801`)).json()).result.changed,
    true,
  );
});
