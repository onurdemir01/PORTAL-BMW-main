// server/ansible/__tests__/ss-job-status-uc.test.js - Self Service is durumu ucu GERCEK runner.cjs ile (2026-11-24,
// kapsam PR-2). was-genel-uclar ve job-stdout-artimli handler'i kaynaktan cikarip `new Function` ile kosturur:
// davranisi sinar ama dosyanin kendisi hic calismaz (kapsam 0). Burada gercek initAnsibleRunner, sahte AWX (HTTP),
// sahte Portal DB; uc kaydedilen handler'iyla cagrilir.
//   JS1 bilinmeyen sunucu 404; AWX hatasi 502
//   JS2 sahiplik: baskasinin isi Admin olmayana 403, Admin'e acik; gecmis okunamazsa (WAS disi) fail-open
//   JS3 WAS isi: gecmis okunamazsa 503, gecmissiz Admin olmayan 403; cikti maskeli
//   JS4 terminal durum: gecmis sonlanir, denetim BIR kez; stdout bir kez arsivlenir; kosan iste ikisi de yok
//   JS5 cikti filtresi: eslesen satirlar; eslesme yoksa ekranda sebep (filterNoMatch); ozellestirme yok / kapali
'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const AWX = {
  status: 'successful',
  playbook: 'saglik.yml',
  stdout: 'TASK [a]\nRESULT ok\nPLAY RECAP',
  hata: false,
  istekler: [],
};
const awx = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  AWX.istekler.push(u.pathname);
  if (AWX.hata) {
    res.writeHead(500, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ detail: 'AWX ic hata' }));
  }
  if (/^\/api\/v2\/jobs\/\d+\/stdout\/$/.test(u.pathname)) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end(AWX.stdout);
  }
  if (/^\/api\/v2\/jobs\/\d+\/$/.test(u.pathname)) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(
      JSON.stringify({
        id: 77,
        status: AWX.status,
        playbook: AWX.playbook,
        failed: AWX.status === 'failed',
        result_traceback: AWX.status === 'failed' ? 'Traceback x' : '',
        job_explanation: '',
        finished: '2026-11-24T10:00:00Z',
      }),
    );
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end('{}');
});

const DB = {
  gecmis: null,
  gecmisHata: false,
  guncellenen: 1,
  arsivVar: false,
  arsiv: [],
  ozel: [],
};
const denetim = [];
function sahte(rel, exports) {
  const p = require.resolve(path.join(__dirname, '..', '..', rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
sahte('db/index.cjs', {
  query: async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (/^SELECT TOP 1 username, template_id, params FROM ansible_job_history/.test(s)) {
      if (DB.gecmisHata) throw new Error('DB erisilemiyor');
      return { rows: DB.gecmis ? [{ ...DB.gecmis }] : [] };
    }
    if (/^UPDATE ansible_job_history SET status/.test(s))
      return { rows: [], rowCount: DB.guncellenen };
    if (/^SELECT 1 FROM ansible_job_output/.test(s)) return { rows: DB.arsivVar ? [{ x: 1 }] : [] };
    if (/^INSERT INTO ansible_job_output/.test(s)) {
      DB.arsiv.push(params[2]);
      return { rows: [], rowCount: 1 };
    }
    if (s === 'SELECT * FROM ansible_ss_customizations') return { rows: DB.ozel };
    if (/COUNT\(\*\) AS n/.test(s)) return { rows: [{ n: 1 }] };
    return { rows: [], rowCount: 0 };
  },
});
sahte('audit/index.cjs', {
  auditPortal: (req, olay, ek) => denetim.push({ olay, ek }),
  auditLogin: () => {},
});

const uclar = {};
const app = new Proxy(
  {},
  {
    get: (_, k) =>
      k === 'use'
        ? () => {}
        : (yol, ...fn) => {
            if (typeof yol === 'string') uclar[`${String(k)} ${yol}`] = fn[fn.length - 1];
          },
  },
);
function cagir(user, jobId = '77', serverId = '1') {
  return new Promise((resolve, reject) => {
    const res = {
      kod: 200,
      status(n) {
        this.kod = n;
        return this;
      },
      json(govde) {
        resolve({ status: this.kod, body: govde });
      },
    };
    Promise.resolve(
      uclar['get /api/ansible/ss/job-status/:serverId/:jobId'](
        { params: { serverId, jobId }, session: { user } },
        res,
      ),
    ).catch(reject);
  });
}
const KULLANICI = { username: 'ornekkisi', role: 'User' };
const ADMIN = { username: 'adm1', role: 'Admin' };
const ENV = ['AWX_1_URL', 'AWX_1_TOKEN', 'AWX_1_NAME'];
const eskiEnv = {};
let runner;

before(async () => {
  await new Promise((r) => awx.listen(0, '127.0.0.1', r));
  for (const k of ENV) eskiEnv[k] = process.env[k];
  process.env.AWX_1_URL = `http://127.0.0.1:${awx.address().port}`;
  process.env.AWX_1_TOKEN = 'test-token';
  process.env.AWX_1_NAME = 'AWX Test';
  DB.ozel = [
    {
      awx_server_id: 1,
      template_id: 41,
      data: JSON.stringify({ outputFilter: { enabled: true, contains: 'RESULT' } }),
    },
    {
      awx_server_id: 1,
      template_id: 42,
      data: JSON.stringify({ outputFilter: { enabled: true, contains: 'BULUNMAZ' } }),
    },
    { awx_server_id: 1, template_id: 43, data: JSON.stringify({ fields: {} }) },
  ];
  runner = require('../runner.cjs');
  runner.initAnsibleRunner(app);
  require('../../smart/poller.cjs').stopPoller();
  require('../../oco/poller.cjs').stopPoller();
  // SS ozellestirme onbellegi acilista DB'den yuklenir.
  for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r));
});
after(() => {
  require('../../smart/poller.cjs').stopPoller();
  require('../../oco/poller.cjs').stopPoller();
  awx.close();
  for (const k of ENV) {
    if (eskiEnv[k] === undefined) delete process.env[k];
    else process.env[k] = eskiEnv[k];
  }
});
beforeEach((t) => {
  Object.assign(AWX, { status: 'successful', playbook: 'saglik.yml', hata: false, istekler: [] });
  AWX.stdout = 'TASK [a]\nRESULT ok\nPLAY RECAP';
  Object.assign(DB, {
    gecmis: null,
    gecmisHata: false,
    guncellenen: 1,
    arsivVar: false,
    arsiv: [],
  });
  denetim.length = 0;
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
});

test('JS1 bilinmeyen sunucu 404, AWX hatasi 502', async () => {
  assert.equal(typeof uclar['get /api/ansible/ss/job-status/:serverId/:jobId'], 'function');
  const yok = await cagir(KULLANICI, '77', '9');
  assert.equal(yok.status, 404);
  AWX.hata = true;
  const r = await cagir(KULLANICI);
  assert.equal(r.status, 502);
  assert.equal(r.body.ok, false);
});

test('JS2 sahiplik: baskasinin isi 403, Admin acik; gecmis okunamazsa fail-open', async () => {
  DB.gecmis = { username: 'BaskaKisi', template_id: null, params: '{}' };
  const r = await cagir(KULLANICI);
  assert.equal(r.status, 403);
  assert.equal(r.body.message, 'Bu iş size ait değil.');
  assert.equal(AWX.istekler.length, 0, 'yetkisiz istekte AWX cagrildi');
  assert.equal((await cagir(ADMIN)).status, 200);
  DB.gecmis = { username: 'OrnekKisi', template_id: null, params: '{}' };
  assert.equal((await cagir(KULLANICI)).status, 200, 'harf farki sahipligi bozmamali');
  DB.gecmisHata = true;
  const acik = await cagir(KULLANICI);
  assert.equal(acik.status, 200, 'WAS disi iste DB hiccup yoklamayi bozmamali');
});

test('JS3 WAS isi: gecmis okunamazsa 503, gecmissiz Admin olmayan 403, cikti maskeli', async () => {
  AWX.playbook = '/runner/project/opsx_was_operation.yml';
  AWX.stdout = 'stopServer.sh app1 -password Gizli123 password=abc\nRESULT\tstop\tOK';
  DB.gecmisHata = true;
  let r = await cagir(KULLANICI);
  assert.equal(r.status, 503);
  DB.gecmisHata = false;
  r = await cagir(KULLANICI);
  assert.equal(r.status, 403);
  r = await cagir(ADMIN);
  assert.equal(r.status, 200);
  assert.ok(!r.body.output.includes('Gizli123'), 'WAS ciktisi maskesiz dondu');
  assert.ok(!DB.arsiv.join('').includes('Gizli123'), 'WAS ciktisi maskesiz arsivlendi');
  // Gecmisteki platform alani da WAS isi sayar.
  AWX.playbook = 'baska.yml';
  DB.gecmis = { username: 'ornekkisi', template_id: null, params: '{"platform":"was-nd"}' };
  r = await cagir(KULLANICI);
  assert.equal(r.status, 200);
  assert.ok(!r.body.output.includes('Gizli123'));
});

test('JS4 terminal durumda gecmis sonlanir ve arsivlenir; kosan iste yazim yok', async () => {
  DB.gecmis = { username: 'ornekkisi', template_id: null, params: '{}' };
  AWX.status = 'running';
  let r = await cagir(KULLANICI);
  assert.equal(r.body.status, 'running');
  assert.equal(denetim.length, 0);
  assert.equal(DB.arsiv.length, 0);

  AWX.status = 'failed';
  r = await cagir(KULLANICI);
  assert.equal(r.body.status, 'failed');
  assert.equal(r.body.failed, true);
  assert.equal(r.body.resultTraceback, 'Traceback x');
  assert.deepEqual(
    denetim.map((d) => d.olay),
    ['selfservice_ansible_complete'],
  );
  assert.equal(denetim[0].ek.result, 'failed');
  assert.equal(JSON.parse(denetim[0].ek.detail).jobId, 77);
  assert.deepEqual(DB.arsiv, [AWX.stdout]);
  // Sonraki yoklama: satir zaten terminal (UPDATE 0) ve arsiv var -> ikinci kez yazilmaz.
  DB.guncellenen = 0;
  DB.arsivVar = true;
  await cagir(KULLANICI);
  assert.equal(denetim.length, 1);
  assert.equal(DB.arsiv.length, 1);
});

test('JS5 cikti filtresi: eslesen satirlar, eslesmezse ekranda sebep, ozellestirme yok', async () => {
  DB.gecmis = { username: 'ornekkisi', template_id: 41, params: '{}' };
  let r = await cagir(KULLANICI);
  assert.equal(r.body.output.trim(), 'RESULT ok');
  assert.equal(r.body.filterNoMatch, null);
  assert.deepEqual(DB.arsiv, [AWX.stdout], 'arsiv HAM cikti tasimali');

  DB.gecmis = { username: 'ornekkisi', template_id: 42, params: '{}' };
  r = await cagir(KULLANICI);
  assert.match(r.body.output, /Çıktı filtresi hiçbir satırla eşleşmedi \(aranan: "BULUNMAZ"/);
  assert.equal(r.body.filterNoMatch.trim(), r.body.output.trim());

  for (const tid of [43, 44]) {
    DB.gecmis = { username: 'ornekkisi', template_id: tid, params: '{}' };
    r = await cagir(KULLANICI);
    assert.equal(r.body.output, AWX.stdout, `template ${tid}: tam cikti bekleniyordu`);
  }
});
