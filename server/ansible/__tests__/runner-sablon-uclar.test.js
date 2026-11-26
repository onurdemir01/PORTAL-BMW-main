// server/ansible/__tests__/runner-sablon-uclar.test.js - Self Service survey ve sablon detay uclari GERCEK runner.cjs
// ile (2026-11-24, kapsam PR-2). Sahte AWX (HTTP) + sahte Portal DB (SS ogeleri, ozellestirmeler).
//   SU1 survey: bilinmeyen sunucu 404; Admin olmayan yalniz erisebildigi ogenin sablonunu okur (kapali oge 403)
//   SU2 survey acik: AWX sorulari + override (etiket, gizli alan Admin gorunumunde), kapilar (OCO ortamlari, SMART)
//   SU3 survey kapali: ozel alanlar; gizli olan yalniz ?admin=1 ile
//   SU4 survey_spec 404: extra_vars varsayilanlarindan alan; sir tasiyan degisken alana donmez
//   SU5 AWX reddi: detail mesaji ve durumu tasinir
//   SU6 template-detail: alan eslemesi, gizli degisken adlari, son isler; survey_spec 404 bos, 5xx 502
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const SORULAR = [
  {
    variable: 'env_mode',
    question_name: 'Ortam',
    type: 'multiplechoice',
    required: true,
    default: 'qa',
    choices: 'qa\nprod',
  },
  { variable: 'gizli_alan', question_name: 'Gizli', type: 'text', required: false, default: 'x' },
];
const sablon = (id, ek = {}) => ({
  id,
  name: `Sablon ${id}`,
  description: 'aciklama',
  job_type: 'run',
  playbook: 'pb.yml',
  survey_enabled: true,
  ask_variables_on_launch: true,
  ask_limit_on_launch: true,
  ask_inventory_on_launch: false,
  extra_vars: 'hedef: ORNAPP01\nvault_password: cokgizli\nadet: 2',
  limit: 'WEB01',
  verbosity: 1,
  modified: '2026-11-01T10:00:00Z',
  summary_fields: {
    inventory: { name: 'inv1' },
    project: { name: 'proj1' },
    credentials: [
      { name: 'ssh-key', kind: 'ssh' },
      { name: 'vault', credential_type_name: 'Vault' },
    ],
    recent_jobs: [
      { id: 9, status: 'successful', finished: '2026-11-19T10:00:00Z' },
      { id: 8, status: 'failed' },
    ],
  },
  ...ek,
});
const SABLONLAR = {
  41: sablon(41),
  42: sablon(42, { survey_enabled: false }),
  43: sablon(43),
  45: sablon(45),
};
const awx = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (kod, govde) => {
    res.writeHead(kod, { 'content-type': 'application/json' });
    res.end(JSON.stringify(govde));
  };
  let m;
  if ((m = /^\/api\/v2\/job_templates\/(\d+)\/survey_spec\/$/.exec(u.pathname))) {
    if (m[1] === '43') return json(404, { detail: 'Not found' });
    if (m[1] === '45') return json(500, { detail: 'survey ic hata' });
    return json(200, { name: 's', spec: SORULAR });
  }
  if ((m = /^\/api\/v2\/job_templates\/(\d+)\/$/.exec(u.pathname))) {
    if (m[1] === '44') return json(403, { detail: 'Bu sablona yetkiniz yok' });
    return json(200, SABLONLAR[m[1]] || {});
  }
  json(404, {});
});

const ogeler = [
  {
    id: 'a',
    title: 'Saglik',
    awx_server_id: 1,
    awx_template_id: 41,
    enabled: 1,
    access_mode: 'herkes',
    access_groups: null,
  },
  {
    id: 'b',
    title: 'Kapali',
    awx_server_id: 1,
    awx_template_id: 46,
    enabled: 0,
    access_mode: 'kapali',
    access_groups: null,
  },
  {
    id: 'c',
    title: 'Kapali survey',
    awx_server_id: 1,
    awx_template_id: 42,
    enabled: 1,
    access_mode: 'herkes',
    access_groups: null,
  },
];
const ozel = [
  {
    awx_server_id: 1,
    template_id: 41,
    data: JSON.stringify({
      fieldOverrides: [
        { fieldName: 'env_mode', label: 'Hedef ortam' },
        { fieldName: 'gizli_alan', hidden: true },
      ],
      ocoCheck: { enabled: true, environments: [' PROD ', '', null] },
      smartApproval: { enabled: true },
    }),
  },
  {
    awx_server_id: 1,
    template_id: 42,
    data: JSON.stringify({
      customSurveyFields: [
        { name: 'bilet', label: 'Bilet', type: 'text' },
        { name: 'ic', label: 'Ic', type: 'text', hidden: true },
      ],
    }),
  },
  {
    awx_server_id: 1,
    template_id: 43,
    data: JSON.stringify({
      fieldOverrides: [{ fieldName: 'adet', label: 'Adet', required: true, defaultValue: '5' }],
    }),
  },
];
function sahte(rel, exports) {
  const p = require.resolve(path.join(__dirname, '..', '..', rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
sahte('db/index.cjs', {
  query: async (sql) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT * FROM ansible_ss_items')) return { rows: ogeler };
    if (s === 'SELECT * FROM ansible_ss_customizations') return { rows: ozel };
    if (/COUNT\(\*\) AS n/.test(s)) return { rows: [{ n: 1 }] };
    return { rows: [], rowCount: 0 };
  },
});
sahte('audit/index.cjs', { auditPortal: () => {}, auditLogin: () => {} });

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
function cagir(uc, { params, query = {}, user }) {
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
    Promise.resolve(uclar[uc]({ params, query, session: { user } }, res)).catch(reject);
  });
}
const survey = (templateId, user, query) =>
  cagir('get /api/ansible/survey/:serverId/:templateId', {
    params: { serverId: '1', templateId: String(templateId) },
    query,
    user,
  });
const KULLANICI = { username: 'ornekkisi', role: 'User', groups: [] };
const ADMIN = { username: 'adm1', role: 'Admin', groups: [] };
const ENV = ['AWX_1_URL', 'AWX_1_TOKEN'];
const eskiEnv = {};
const sessiz = {};

before(async () => {
  await new Promise((r) => awx.listen(0, '127.0.0.1', r));
  for (const k of ENV) eskiEnv[k] = process.env[k];
  process.env.AWX_1_URL = `http://127.0.0.1:${awx.address().port}`;
  process.env.AWX_1_TOKEN = 'test-token';
  sessiz.log = console.log;
  sessiz.warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  require('../runner.cjs').initAnsibleRunner(app);
  require('../../smart/poller.cjs').stopPoller();
  require('../../oco/poller.cjs').stopPoller();
  for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r));
});
after(() => {
  require('../../smart/poller.cjs').stopPoller();
  require('../../oco/poller.cjs').stopPoller();
  awx.close();
  console.log = sessiz.log;
  console.warn = sessiz.warn;
  for (const k of ENV) {
    if (eskiEnv[k] === undefined) delete process.env[k];
    else process.env[k] = eskiEnv[k];
  }
});

test('SU1 survey: bilinmeyen sunucu 404, erisilemeyen oge 403', async () => {
  const yok = await cagir('get /api/ansible/survey/:serverId/:templateId', {
    params: { serverId: '9', templateId: '41' },
    user: KULLANICI,
  });
  assert.equal(yok.status, 404);
  const kapali = await survey(46, KULLANICI);
  assert.equal(kapali.status, 403);
  assert.equal(kapali.body.message, 'Bu servis size açık değil.');
  assert.equal((await survey(47, KULLANICI)).status, 403, 'katalogda olmayan sablon');
  assert.equal((await survey(41, KULLANICI)).status, 200);
});

test('SU2 survey acik: sorular, override, gizli alan ve kapilar', async () => {
  const r = await survey(41, KULLANICI);
  assert.equal(r.body.surveyEnabled, true);
  assert.deepEqual(
    r.body.fields.map((f) => f.name),
    ['env_mode'],
    'gizli alan kullaniciya gitti',
  );
  assert.equal(r.body.fields[0].label, 'Hedef ortam');
  assert.equal(r.body.fields[0].required, true);
  assert.deepEqual(r.body.gates, { oco: true, ocoEnvironments: ['prod'], smart: true });
  assert.equal(r.body.askVariables, true);
  assert.equal(r.body.templateId, '41');
  const adm = await survey(41, ADMIN, { admin: '1' });
  assert.deepEqual(
    adm.body.fields.map((f) => f.name),
    ['env_mode', 'gizli_alan'],
  );
  const admDuz = await survey(41, ADMIN);
  assert.equal(admDuz.body.fields.length, 1, 'admin=1 olmadan gizli alan gosterilmemeli');
});

test('SU3 survey kapali: ozel alanlar, gizli olan yalniz admin gorunumunde', async () => {
  const r = await survey(42, KULLANICI);
  assert.equal(r.body.surveyEnabled, false);
  assert.deepEqual(
    r.body.fields.map((f) => f.name),
    ['bilet'],
  );
  assert.deepEqual(r.body.gates, { oco: false, ocoEnvironments: null, smart: false });
  const adm = await survey(42, ADMIN, { admin: '1' });
  assert.deepEqual(
    adm.body.fields.map((f) => f.name),
    ['bilet', 'ic'],
  );
});

test('SU4 survey_spec yoksa extra_vars varsayilanlari; sir tasiyan degisken alan olmaz', async () => {
  const r = await survey(43, ADMIN);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const adlar = r.body.fields.map((f) => f.name);
  assert.ok(adlar.includes('hedef'));
  assert.ok(!adlar.includes('vault_password'), 'sir tasiyan degisken alana dondu');
  const adet = r.body.fields.find((f) => f.name === 'adet');
  assert.deepEqual(
    { label: adet.label, required: adet.required, defaultValue: adet.defaultValue },
    { label: 'Adet', required: true, defaultValue: '5' },
  );
  assert.equal(r.body.fields.find((f) => f.name === 'hedef').defaultValue, 'ORNAPP01');
});

test('SU5 AWX reddi durum ve mesaj olarak tasinir', async () => {
  const r = await survey(44, ADMIN);
  assert.equal(r.status, 403);
  assert.equal(r.body.message, 'Bu sablona yetkiniz yok');
});

test('SU6 template-detail: eslemeler, gizli degiskenler, son isler, survey hatasi', async () => {
  const uc = 'get /api/ansible/template-detail/:serverId/:templateId';
  const yok = await cagir(uc, { params: { serverId: '9', templateId: '41' }, user: ADMIN });
  assert.equal(yok.status, 404);
  const r = await cagir(uc, { params: { serverId: '1', templateId: '41' }, user: KULLANICI });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const t = r.body.template;
  assert.equal(t.inventory, 'inv1');
  assert.equal(t.project, 'proj1');
  assert.deepEqual(t.credentials, [
    { name: 'ssh-key', kind: 'ssh' },
    { name: 'vault', kind: 'Vault' },
  ]);
  assert.ok(!t.extraVars.includes('cokgizli'), 'sir degeri tarayiciya gitti');
  assert.deepEqual(t.hiddenVariables, ['vault_password']);
  assert.deepEqual(t.extraVarsParsed, { hedef: 'ORNAPP01', adet: '2' });
  assert.deepEqual(t.recentJobs, [
    { id: 9, status: 'successful', finished: '2026-11-19T10:00:00Z' },
    { id: 8, status: 'failed', finished: null },
  ]);
  assert.equal(t.askLimit, true);
  assert.equal(t.askInventory, false);
  assert.deepEqual(
    t.surveyFields.map((f) => f.name),
    ['env_mode'],
    'Admin olmayana gizli survey alani gitti',
  );
  const adm = await cagir(uc, { params: { serverId: '1', templateId: '41' }, user: ADMIN });
  assert.equal(adm.body.template.surveyFields.length, 2);
  const bos = await cagir(uc, { params: { serverId: '1', templateId: '43' }, user: ADMIN });
  assert.deepEqual(bos.body.template.surveyFields, []);
  const hata = await cagir(uc, { params: { serverId: '1', templateId: '45' }, user: ADMIN });
  assert.equal(hata.status, 502);
});
