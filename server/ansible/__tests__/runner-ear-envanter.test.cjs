// server/ansible/__tests__/runner-ear-envanter.test.cjs - Uygulama Envanteri icin eklenen iki salt okunur
// AWX okuyucusu (2026-11-05), sahte AWX sunucusuna karsi.
//
//   RE1 listTemplateJobsOnServer: yalniz bitmis isler, yeniden eskiye, finished__gt; bozuk kayit atilir;
//       gecersiz template ID AWX'e gitmez; AAP 2.5 tabaninda onekli yoldan gider
//   RE2 getTemplateDefaultLimitOnServer: Limit metni HAM doner; alan yoksa undefined; hata FIRLATIR
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

for (const k of Object.keys(process.env)) {
  if (/^AWX_/.test(k) || /^(HTTPS?_PROXY|https?_proxy)$/.test(k)) delete process.env[k];
}

const awx = { srv: null, istekler: [], cevap: (_req) => ({ durum: 404, govde: {} }) };

before(async () => {
  awx.srv = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      awx.istekler.push({ method: req.method, url: req.url });
      const { durum, govde } = awx.cevap(req);
      res.writeHead(durum, { 'content-type': 'application/json' });
      res.end(JSON.stringify(govde));
    });
  });
  await new Promise((r) => awx.srv.listen(0, '127.0.0.1', r));
  process.env.AWX_1_URL = `http://127.0.0.1:${awx.srv.address().port}`;
  process.env.AWX_1_TOKEN = 'test-token';
  process.env.AWX_1_NAME = 'awx-test';
});

after(() => new Promise((r) => awx.srv.close(r)));

const runner = () => require('../runner.cjs');

test('RE1 listTemplateJobsOnServer', async () => {
  awx.cevap = (req) =>
    /\/job_templates\/4242\/jobs\/\?/.test(req.url)
      ? {
          durum: 200,
          govde: {
            count: 4,
            results: [
              { id: 901, status: 'successful', finished: '2026-11-05T10:00:00Z' },
              { id: 'x', status: 'successful' },
              null,
              { id: 900, status: 'failed' },
            ],
          },
        }
      : { durum: 404, govde: { detail: 'yok' } };
  const r = await runner().listTemplateJobsOnServer(1, 4242, {
    finishedAfter: '2026-10-29T12:00:00.000Z',
    pageSize: 50,
  });
  assert.deepEqual(r, [
    { id: 901, status: 'successful', finished: '2026-11-05T10:00:00Z' },
    { id: 900, status: 'failed', finished: null },
  ]);
  const son = awx.istekler.at(-1);
  assert.equal(son.method, 'GET');
  const u = new URL(son.url, 'http://x');
  assert.equal(u.pathname, '/api/v2/job_templates/4242/jobs/');
  assert.equal(u.searchParams.get('order_by'), '-id');
  assert.equal(u.searchParams.get('page_size'), '50');
  assert.equal(u.searchParams.get('status__in'), 'successful,failed,error,canceled');
  assert.equal(u.searchParams.get('finished__gt'), '2026-10-29T12:00:00.000Z');

  const once = awx.istekler.length;
  await assert.rejects(runner().listTemplateJobsOnServer(1, 0), (e) => e.status === 400);
  await assert.rejects(runner().listTemplateJobsOnServer(1, 'x'), (e) => e.status === 400);
  assert.equal(awx.istekler.length, once, 'gecersiz template ID AWX e gitmemeli');

  process.env.AWX_1_API_BASE = '/api/controller/v2';
  try {
    await runner().listTemplateJobsOnServer(1, 4242);
    assert.ok(
      awx.istekler.at(-1).url.startsWith('/api/controller/v2/job_templates/4242/jobs/?'),
      awx.istekler.at(-1).url,
    );
  } finally {
    delete process.env.AWX_1_API_BASE;
  }
});

test('RE2 getTemplateDefaultLimitOnServer', async () => {
  let govde = { id: 4242, name: 'BMW Portal - EAR Envanter', limit: 'all' };
  let durum = 200;
  awx.cevap = () => ({ durum, govde });
  assert.equal(await runner().getTemplateDefaultLimitOnServer(1, 4242), 'all');
  assert.equal(awx.istekler.at(-1).url, '/api/v2/job_templates/4242/');
  govde = { id: 4242, limit: '' };
  assert.equal(await runner().getTemplateDefaultLimitOnServer(1, 4242), '');
  govde = { id: 4242 };
  assert.equal(await runner().getTemplateDefaultLimitOnServer(1, 4242), undefined);
  govde = { id: 4242, limit: 5 };
  assert.equal(await runner().getTemplateDefaultLimitOnServer(1, 4242), undefined);
  durum = 403;
  govde = { detail: 'yetki yok' };
  await assert.rejects(runner().getTemplateDefaultLimitOnServer(1, 4242));
});
