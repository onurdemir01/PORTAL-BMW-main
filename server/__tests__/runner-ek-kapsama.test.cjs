'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

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

test('server/ansible/runner: legacy AWX, OAuth2/v2 token fallbacks, and multi-server AWX operations', async (t) => {
  const backups = new Map();
  const origEnv = { ...process.env };

  let oauthBehavior = 'fail_both'; // 'fail_both' | 'ok_first'
  let cancelMode = 'ok'; // 'ok' | '401' | '403' | '405' | '409'
  let jobStateOverride = null; // null | 'running' | 'successful' | 'missing' | 'nostatus'

  const awxSrv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const p = u.pathname;
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const sendJson = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(obj === null ? '' : JSON.stringify(obj));
      };

      if (p === '/api/o/token/' && req.method === 'POST') {
        if (oauthBehavior === 'ok_first')
          return sendJson(200, { access_token: 'oauth-access-tok' });
        return sendJson(400, { error_description: 'oauth primary rejected' });
      }
      if (p === '/o/token/' && req.method === 'POST') {
        return sendJson(401, { error: 'oauth secondary rejected' });
      }
      if (
        (p === '/api/v2/tokens/' || p === '/api/controller/v2/tokens/') &&
        req.method === 'POST'
      ) {
        return sendJson(200, { token: 'v2-token-abc', expires: '2099-01-01T00:00:00Z' });
      }
      if (p === '/api/v2/me/' || p === '/api/controller/v2/me/') {
        if (u.searchParams.get('empty') === '1') return sendJson(200, { results: [] });
        return sendJson(200, { results: [{ id: 12, username: 'svc_awx', is_superuser: false }] });
      }
      if (p === '/api/v2/job_templates/' && req.method === 'GET') {
        if (u.searchParams.get('page') === '2') {
          return sendJson(200, {
            results: [
              {
                id: 11,
                name: 'Deploy App',
                playbook: 'deploy.yml',
                job_type: 'run',
                summary_fields: {},
              },
            ],
            next: null,
          });
        }
        return sendJson(200, {
          results: [
            {
              id: 10,
              name: 'Health Check',
              playbook: 'hc.yml',
              ask_variables_on_launch: true,
              summary_fields: {
                inventory: { name: 'inv1' },
                labels: { results: [{ name: 'ops' }] },
              },
            },
          ],
          next: '/api/v2/job_templates/?page=2',
        });
      }
      if (p === '/api/v2/workflow_job_templates/' && req.method === 'GET') {
        return sendJson(200, { results: [{ id: 20, name: 'WF Check' }], next: null });
      }
      if (p === '/api/v2/job_templates/10/' && req.method === 'GET') {
        return sendJson(200, {
          id: 10,
          name: 'Health Check',
          playbook: 'hc.yml',
          extra_vars: 'env_mode: qa\nretry_count: 3',
          limit: 'WEB01',
          ask_variables_on_launch: true,
          ask_limit_on_launch: true,
          survey_enabled: true,
          modified: '2026-11-01T10:00:00Z',
          summary_fields: {
            user_capabilities: { edit: true, start: true },
            project: { name: 'proj1' },
            inventory: { name: 'inv1' },
          },
        });
      }
      if (p === '/api/v2/job_templates/10/survey_spec/' && req.method === 'GET') {
        return sendJson(200, {
          name: 'HC Survey',
          description: 'Params',
          spec: [
            { variable: 'target_env', type: 'text', required: true, default: 'qa' },
            { variable: 'api_secret', type: 'password', required: true, default: '$encrypted$' },
          ],
        });
      }
      if (p === '/api/v2/job_templates/10/jobs/' && req.method === 'GET') {
        return sendJson(200, {
          results: [
            {
              id: 700,
              status: 'successful',
              started: '2026-11-01T00:00:00Z',
              finished: '2026-11-01T00:01:00Z',
              limit: 'WEB01',
            },
          ],
        });
      }
      if (p === '/api/v2/job_templates/10/schedules/' && req.method === 'GET') {
        return sendJson(200, { results: [{ id: 3, name: 'Daily HC' }] });
      }
      if (p === '/api/v2/job_templates/10/launch/' && req.method === 'POST') {
        return sendJson(201, {
          id: 808,
          status: 'pending',
          ignored_fields: { limit: 'WEB01', extra_vars: { ignored_var: 1 } },
        });
      }
      if ((p === '/api/v2/jobs/' || p === '/api/controller/v2/jobs/') && req.method === 'GET') {
        return sendJson(200, {
          results: [
            {
              id: 808,
              status: 'running',
              started: '2026-11-01T00:00:00Z',
              created: '2026-11-01T00:00:00Z',
              summary_fields: {
                job_template: { id: 10, name: 'Health Check' },
                created_by: { username: 'alice' },
              },
            },
          ],
          next: null,
        });
      }
      if (
        (p === '/api/v2/workflow_jobs/' || p === '/api/controller/v2/workflow_jobs/') &&
        req.method === 'GET'
      ) {
        return sendJson(200, { results: [], next: null });
      }
      if (p === '/api/v2/jobs/404/' && req.method === 'GET') {
        return sendJson(404, { detail: 'Not found' });
      }
      if (p.startsWith('/api/v2/jobs/12/stdout') && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Standard Output too large to display (2000000 bytes)');
        return;
      }
      if (p.startsWith('/api/v2/jobs/12/job_events') && req.method === 'GET') {
        return sendJson(200, {
          results: [{ stdout: 'ev line 1' }, { stdout: 'changed=1' }],
          next: null,
        });
      }
      if (/^\/api\/(?:controller\/)?v2\/jobs\/\d+\/stdout/.test(p) && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        if (u.searchParams.get('start_line')) res.end('line two\nline three\nline four');
        else res.end('line one\nline two\nline three');
        return;
      }
      if (/^\/api\/(?:controller\/)?v2\/jobs\/\d+\/cancel\/$/.test(p) && req.method === 'POST') {
        if (cancelMode === '401') return sendJson(401, { detail: 'Invalid token' });
        if (cancelMode === '403') return sendJson(403, { detail: 'Permission denied' });
        if (cancelMode === '405') return sendJson(405, { detail: 'Method not allowed' });
        if (cancelMode === '409') return sendJson(409, { detail: 'Conflict' });
        return sendJson(202, null);
      }
      if (
        /^\/api\/(?:controller\/)?v2\/(?:jobs|workflow_jobs)\/\d+\/$/.test(p) &&
        req.method === 'GET'
      ) {
        if (jobStateOverride === 'missing') return sendJson(404, { detail: 'missing' });
        if (jobStateOverride === 'nostatus') return sendJson(200, {});
        const st = jobStateOverride || 'successful';
        return sendJson(200, {
          id: 808,
          status: st,
          started: '2026-11-01T00:00:00Z',
          finished: st === 'successful' ? '2026-11-01T00:01:00Z' : null,
          elapsed: 12,
          failed: false,
          job_template: 10,
          playbook: 'hc.yml',
          result_traceback: 'changed=2',
          artifacts: { step: 'ok' },
          summary_fields: {
            inventory: { name: 'inv1' },
            launched_by: { name: 'alice' },
            created_by: { username: 'svc_awx' },
          },
        });
      }
      return sendJson(404, { detail: `unhandled ${req.method} ${p}` });
    });
  });

  await new Promise((resolve) => awxSrv.listen(0, '127.0.0.1', resolve));
  const awxBase = `http://127.0.0.1:${awxSrv.address().port}`;
  t.after(() => {
    awxSrv.closeAllConnections?.();
    awxSrv.close();
    process.env = origEnv;
    restoreModules(backups, ['../ansible/runner.cjs']);
  });

  // Clean env and configure server 1 + legacy URL
  for (let i = 1; i <= 9; i++) {
    delete process.env[`AWX_${i}_URL`];
    delete process.env[`AWX_${i}_TOKEN`];
    delete process.env[`AWX_${i}_USER`];
    delete process.env[`AWX_${i}_PASSWORD`];
    delete process.env[`AWX_${i}_CLIENT_ID`];
    delete process.env[`AWX_${i}_CLIENT_SECRET`];
  }
  delete process.env.AWX_URL;
  delete process.env.AWX_TOKEN;
  delete process.env.AWX_USER;
  delete process.env.AWX_PASSWORD;
  delete process.env.AWX_READ_ONLY_TEMPLATE_IDS;

  setMockModule(
    '../db/index.cjs',
    {
      query: async () => ({ rows: [] }),
    },
    backups,
  );
  setMockModule(
    '../ansible/ss-tasima.cjs',
    {
      surveyYaz: async () => ({ ok: true, fark: [], surveyEnabled: true, hash: 'h1' }),
      surveyKapat: async () => ({ ok: true, surveyEnabled: false }),
    },
    backups,
  );

  delete require.cache[require.resolve('../ansible/runner.cjs')];
  const runner = require('../ansible/runner.cjs');

  // 1) isConfigured negative & legacy branch
  assert.equal(runner.isConfigured(), false);
  process.env.AWX_URL = awxBase;
  process.env.AWX_USER = 'svc';
  process.env.AWX_PASSWORD = 'secret-pass';
  assert.equal(runner.isConfigured(), true);

  // Legacy single-AWX path: listTemplates, launchJob, getJobStatus, getJobOutput
  const legTemplates = await runner.listTemplates();
  assert.equal(legTemplates.length, 2);
  await assert.rejects(() => runner.launchJob('bad'), /Geçersiz/);
  process.env.AWX_READ_ONLY_TEMPLATE_IDS = '10';
  await assert.rejects(() => runner.launchJob(99), /izin verilmiyor/);
  const legLaunch = await runner.launchJob(10, { env: 'qa' }, 'WEB01');
  assert.equal(legLaunch.jobId, 808);
  const legStatus = await runner.getJobStatus(808);
  assert.equal(legStatus.hasChanged, true);
  const legOut = await runner.getJobOutput(12); // too large -> collects job_events!
  assert.match(legOut.output, /ev line 1/);
  assert.equal(legOut.changedWarning, true);

  // 2) Multi-server with OAuth2 fallback + static & password servers
  process.env.AWX_1_URL = awxBase;
  process.env.AWX_1_NAME = 'AWX-Primary';
  process.env.AWX_1_USER = 'svc';
  process.env.AWX_1_PASSWORD = 'pw';
  process.env.AWX_1_CLIENT_ID = 'cid';
  process.env.AWX_1_CLIENT_SECRET = 'csec';

  process.env.AWX_2_URL = awxBase;
  process.env.AWX_2_NAME = 'AWX-OAuth';
  process.env.AWX_2_USER = 'svc2';
  process.env.AWX_2_PASSWORD = 'pw2';
  process.env.AWX_2_CLIENT_ID = 'cid2';
  process.env.AWX_2_CLIENT_SECRET = 'csec2';

  runner.clearTokenCache();
  delete process.env.AWX_READ_ONLY_TEMPLATE_IDS;

  // OAuth2 succeeds when ok_first set
  oauthBehavior = 'ok_first';
  const running = await runner.listRunningJobsAcrossServers();
  assert.equal(running.length, 2);

  // OAuth2 fails -> falls back to v2 token cleanly
  runner.clearTokenCache();
  oauthBehavior = 'fail_both';
  const cancelable = await runner.listCancelableTemplatesForServer(runner.getServerById(1));
  assert.equal(cancelable.length, 3);

  // Template introspection helpers
  const caps = await runner.getTemplateCapabilitiesOnServer(1, 10, 'job');
  assert.equal(caps.capabilities.edit, true);
  assert.equal(caps.tokenSource, 'oauth2');
  const ls = await runner.getTemplateLaunchSettingsOnServer(1, 10);
  assert.equal(ls.askLimitOnLaunch, true);
  const defLim = await runner.getTemplateDefaultLimitOnServer(1, 10);
  assert.equal(defLim, 'WEB01');
  const tJobs = await runner.listTemplateJobsOnServer(1, 10, {
    finishedAfter: '2026-10-01T00:00:00Z',
  });
  assert.equal(tJobs.length, 1);
  const tSum = await runner.getTemplateSummaryOnServer(1, 10);
  assert.equal(tSum.name, 'Health Check');
  const varDefs = await runner.getTemplateVariableDefaultsOnServer(1, 10);
  assert.equal(varDefs.env_mode, 'qa');
  assert.equal(varDefs.target_env, 'qa');
  assert.equal(varDefs.api_secret, undefined); // passwords excluded
  const prefilled = await runner.prefillSurveyDefaultsOnServer(1, 10, { custom: 1 });
  assert.equal(prefilled.target_env, 'qa');
  assert.equal(prefilled.api_secret, '$encrypted$');
  const specRes = await runner.getSurveySpecOnServer(1, 10);
  assert.equal(specRes.spec.length, 2);
  const detail = await runner.getTemplateDetailOnServer(1, 10);
  assert.equal(detail.id, 10);
  const wr = await runner.writeSurveySpecOnServer(1, 10, { spec: [] });
  assert.equal(wr.ok, true);
  await assert.rejects(() => runner.setSurveyEnabledOnServer(1, 10, true), /kapatma/);
  const dis = await runner.setSurveyEnabledOnServer(1, 10, false);
  assert.equal(dis.surveyEnabled, false);
  const singleJob = await runner.getJobOnServer(1, 808);
  assert.equal(singleJob.jobTemplate, 10);
  const missingJob = await runner.getJobOnServer(1, 404);
  assert.equal(missingJob.status, 'missing');
  const scheds = await runner.listTemplateSchedulesOnServer(1, 10);
  assert.equal(scheds[0].name, 'Daily HC');

  // whoAmI + job state
  const me = await runner.whoAmIWithTokenOnServer(1, 'tok-xyz');
  assert.equal(me.username, 'svc_awx');
  assert.equal((await runner.getJobStateOnServer(1, 808, 'workflow')).status, 'successful');
  assert.equal((await runner.getJobStateOnServer(1, 404)).status, 'missing');
  jobStateOverride = 'nostatus';
  await assert.rejects(() => runner.getJobStateOnServer(1, 808), /durumu.*yok/);
  jobStateOverride = null;

  // Incremental stdout + normal launch on server
  const launchRes = await runner.launchJobOnServer(
    1,
    10,
    {},
    'WEB01',
    { username: 'alice', mail: 'alice@example.internal' },
    { anketBellegi: true },
  );
  assert.deepEqual(launchRes.ignoredFields, ['limit', 'extra_vars.ignored_var']);
  const fullOut = await runner.getJobOutputOnServer(1, 808, { artimli: true });
  assert.equal(fullOut.artimliKullanildi, false);
  const incOut = await runner.getJobOutputOnServer(1, 808, { artimli: true });
  assert.equal(incOut.artimliKullanildi, true);

  // Cancel flows: 202 ok, viaToken 401, 405 terminal, 405 still running, 403 still running, 403 state missing
  assert.equal((await runner.cancelJobOnServer(1, 808)).canceled, true);
  cancelMode = '401';
  await assert.rejects(
    () => runner.cancelJobOnServer(1, 808, { authToken: 'cancel-tok', authOwner: 'alice' }),
    /GEÇERSİZ/,
  );
  cancelMode = '405';
  jobStateOverride = 'successful';
  assert.equal((await runner.cancelJobOnServer(1, 808)).alreadyTerminal, true);
  jobStateOverride = 'running';
  await assert.rejects(() => runner.cancelJobOnServer(1, 808), /ÇALIŞMAYA DEVAM/);
  cancelMode = '403';
  await assert.rejects(
    () => runner.cancelJobOnServer(1, 808, { authToken: 'cancel-tok', authOwner: 'svc_awx' }),
    /tok.*kapsam|Admin/i,
  );
  jobStateOverride = 'missing';
  await assert.rejects(() => runner.cancelJobOnServer(1, 808), /ÖLÇÜLEMEDİ/);
  jobStateOverride = null;

  // Socket ECONNREFUSED paths (awxRequest, awxRequestToServer, fetchTokenOAuth2AtPath, fetchTokenV2)
  await new Promise((resolve) => {
    awxSrv.closeAllConnections?.();
    awxSrv.close(resolve);
  });
  await assert.rejects(() => runner.listTemplates());
  await assert.rejects(() => runner.getJobStatusOnServer(1, 808));
  runner.clearTokenCache();
  await assert.rejects(() => runner.getJobStatusOnServer(1, 808));
});
