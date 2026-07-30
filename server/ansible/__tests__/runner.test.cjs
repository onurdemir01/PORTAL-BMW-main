// server/ansible/__tests__/runner.test.cjs — AWX stdout kok-neden duzeltmesinin
// (plan Bolum A2: getJobOutputOnServer/getJobOutput artik duz-metin stdout'u
// JSON.parse ETMIYOR, bos donduren eski hatanin regresyon testi) + job_events
// fallback'inin dogrulamasi. Gercek AWX gerektirmez — yerel bir http sunucusu
// AWX'in stdout (text/plain) ve job_events (JSON) uclerini taklit eder.
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

let server;
let baseUrl;
const responses = new Map(); // jobId → { stdout: string, events: Array<{stdout}> }

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const stdoutMatch = url.pathname.match(/^\/api\/v2\/jobs\/(\d+)\/stdout\/$/);
    const eventsMatch = url.pathname.match(/^\/api\/v2\/jobs\/(\d+)\/job_events\/$/);

    if (stdoutMatch) {
      const jobId = stdoutMatch[1];
      const fixture = responses.get(jobId) || { stdout: '' };
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(fixture.stdout);
      return;
    }
    if (eventsMatch) {
      const jobId = eventsMatch[1];
      const fixture = responses.get(jobId) || { events: [] };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ results: fixture.events || [], next: null }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ detail: 'not found' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  process.env.AWX_URL = baseUrl;
  process.env.AWX_TOKEN = 'test-token';
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  delete process.env.AWX_URL;
  delete process.env.AWX_TOKEN;
});

const runner = require('../runner.cjs');

test('getJobOutputOnServer(): basarisiz bir job icin GERCEK duz-metin stdout doner (eski hata: her zaman JSON.parse edip bos donuyordu)', async () => {
  responses.set('9001', { stdout: 'TASK [restart aware] ****\nfatal: [host1]: FAILED! => changed=0\n' });
  const { output } = await runner.getJobOutputOnServer(0, 9001);
  assert.match(output, /fatal: \[host1\]/);
});

test('getJobOutput(): tek-sunucu (legacy AWX_URL) varyanti da ayni sekilde gercek stdout doner', async () => {
  responses.set('9002', { stdout: 'ok=1 changed=1 unreachable=0 failed=0\n' });
  const { output, changedWarning } = await runner.getJobOutput(9002);
  assert.match(output, /changed=1/);
  assert.equal(changedWarning, true);
});

test('getJobOutputOnServer(): stdout GERCEKTEN bossa (parse hatasi degil) job_events uzerinden fallback toplanir', async () => {
  responses.set('9003', {
    stdout: '',
    events: [
      { stdout: 'PLAY [all] ***' },
      { stdout: '' },
      { stdout: 'TASK [debug] ***\nok: [host1]' },
    ],
  });
  const { output } = await runner.getJobOutputOnServer(0, 9003);
  assert.match(output, /PLAY \[all\]/);
  assert.match(output, /TASK \[debug\]/);
});

test('getJobOutputOnServer(): stdout VE job_events ikisi de bossa sessizce bos string doner (crash etmez)', async () => {
  responses.set('9004', { stdout: '', events: [] });
  const { output } = await runner.getJobOutputOnServer(0, 9004);
  assert.equal(output, '');
});
