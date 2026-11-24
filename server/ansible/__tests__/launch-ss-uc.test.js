// server/ansible/__tests__/launch-ss-uc.test.js - Self Service is baslatma ucu (POST /api/ansible/launch-ss) GERCEK
// runner.cjs ile (2026-11-24, kapsam PR-2). Sahte: AWX (HTTP), Portal DB (SS ogeleri / ozellestirmeler / gecmis).
// Kapi karari (change-gates) ve sablon on kontrolu kendi testlerinde; burada sahte doner, ucun onlara ne gecirdigi
// ve kararlara nasil uydugu sinanir.
//   LS1 bilinmeyen sunucu 404, gecersiz template 400, katalogda olmayan / kapali oge 403
//   LS2 survey'li sablon: zorunlu alan bos 400 (alan adiyla), gizli alan varsayilanla, ham degiskenler + kullanici bilgisi
//   LS3 survey'siz sablon: gonderilen degiskenler gider ama kapiya GUVENILMEZ olarak gitmez (gateVars disi)
//   LS4 kapi kararlari: error / respond aynen doner; taninmayan karar 500 ve is BASLATILMAZ
//   LS5 proceed: AWX launch + is gecmisi; AWX eksik zorunlu alan reddi 400 anlasilir mesajla
'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const SORULAR = [
  { variable: 'hedef', question_name: 'Hedef', type: 'text', required: true, default: '' },
  { variable: 'ortam', question_name: 'Ortam', type: 'text', required: false, default: 'qa' },
];
const AWX = { istekler: [], launchRed: null };
const awx = http.createServer((req, res) => {
  const parca = [];
  req.on('data', (c) => parca.push(c));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const govde = parca.length ? JSON.parse(Buffer.concat(parca).toString()) : null;
    AWX.istekler.push({ yontem: req.method, yol: u.pathname, govde });
    const json = (kod, g) => {
      res.writeHead(kod, { 'content-type': 'application/json' });
      res.end(JSON.stringify(g));
    };
    let m;
    if ((m = /^\/api\/v2\/job_templates\/(\d+)\/survey_spec\/$/.exec(u.pathname))) {
      if (m[1] === '42') return json(404, { detail: 'yok' });
      return json(200, { spec: SORULAR });
    }
    if ((m = /^\/api\/v2\/job_templates\/(\d+)\/launch\/$/.exec(u.pathname))) {
      if (AWX.launchRed) return json(400, AWX.launchRed);
      return json(201, { id: 950, status: 'pending', ignored_fields: {} });
    }
    if ((m = /^\/api\/v2\/job_templates\/(\d+)\/$/.exec(u.pathname))) {
      return json(200, {
        id: Number(m[1]),
        name: `Sablon ${m[1]}`,
        survey_enabled: true,
        ask_variables_on_launch: true,
        ask_limit_on_launch: true,
        extra_vars: '',
      });
    }
    json(404, {});
  });
});

const ogeler = [41, 42].map((t) => ({
  id: `o${t}`,
  title: `Oge ${t}`,
  awx_server_id: 1,
  awx_template_id: t,
  enabled: 1,
  access_mode: 'herkes',
  access_groups: null,
}));
ogeler.push({ ...ogeler[0], id: 'kapali', awx_template_id: 43, enabled: 0, access_mode: 'kapali' });
const ozel = [
  {
    awx_server_id: 1,
    template_id: 41,
    data: JSON.stringify({
      fieldOverrides: [{ fieldName: 'ortam', hidden: true, defaultValue: 'prod' }],
      rawExtraVars: 'sabit: 1\nhedef: ezilmez',
      injectUserInfo: { enabled: true, emailKey: 'talep_eden_mail' },
    }),
  },
];
const DB = { gecmis: [] };
function sahte(rel, exports) {
  const p = require.resolve(path.join(__dirname, '..', '..', rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
sahte('db/index.cjs', {
  query: async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT * FROM ansible_ss_items')) return { rows: ogeler };
    if (s === 'SELECT * FROM ansible_ss_customizations') return { rows: ozel };
    if (s.startsWith('INSERT INTO ansible_job_history')) {
      DB.gecmis.push(params);
      return { rows: [], rowCount: 1 };
    }
    if (/COUNT\(\*\) AS n/.test(s)) return { rows: [{ n: 1 }] };
    return { rows: [], rowCount: 0 };
  },
});
const denetim = [];
sahte('audit/index.cjs', { auditPortal: (req, olay) => denetim.push(olay), auditLogin: () => {} });

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
const KULLANICI = { username: 'ornekkisi', role: 'User', groups: [], mail: 'ornek@ornek.invalid' };
function baslat(templateId, body = {}, serverId = '1') {
  return new Promise((resolve, reject) => {
    const res = {
      kod: 200,
      status(n) {
        this.kod = n;
        return this;
      },
      json(g) {
        resolve({ status: this.kod, body: g });
      },
    };
    Promise.resolve(
      uclar['post /api/ansible/launch-ss/:serverId/:templateId'](
        {
          params: { serverId, templateId: String(templateId) },
          body,
          session: { user: KULLANICI },
        },
        res,
      ),
    ).catch(reject);
  });
}

let kapilar;
let onKontrol;
const ENV = ['AWX_1_URL', 'AWX_1_TOKEN'];
const eskiEnv = {};
before(async () => {
  await new Promise((r) => awx.listen(0, '127.0.0.1', r));
  for (const k of ENV) eskiEnv[k] = process.env[k];
  process.env.AWX_1_URL = `http://127.0.0.1:${awx.address().port}`;
  process.env.AWX_1_TOKEN = 'test-token';
  const log = console.log;
  console.log = () => {};
  require('../runner.cjs').initAnsibleRunner(app);
  require('../../smart/poller.cjs').stopPoller();
  require('../../oco/poller.cjs').stopPoller();
  for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r));
  console.log = log;
  kapilar = require('../change-gates.cjs');
  onKontrol = require('../template-preflight.cjs');
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
  AWX.istekler = [];
  AWX.launchRed = null;
  DB.gecmis = [];
  denetim.length = 0;
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  t.mock.method(kapilar, 'runChangeGates', async () => ({ outcome: 'proceed' }));
  t.mock.method(onKontrol, 'assertTemplateAcceptsExtraVars', async () => {});
});

const launchGovdesi = () => {
  const l = AWX.istekler.find((x) => x.yontem === 'POST' && /\/launch\/$/.test(x.yol));
  if (!l) return null;
  const ev = l.govde.extra_vars;
  return { ...l.govde, extra_vars: typeof ev === 'string' ? JSON.parse(ev) : ev };
};

test('LS1 sunucu, template ve katalog / erisim denetimi', async () => {
  assert.equal((await baslat(41, {}, '9')).status, 404);
  assert.equal((await baslat('abc')).status, 400);
  assert.equal((await baslat(0)).status, 400);
  for (const t of [43, 44]) {
    const r = await baslat(t);
    assert.equal(r.status, 403, `template ${t}`);
    assert.match(r.body.message, /Self Service listesinde kayıtlı değil ya da size açık değil/);
  }
  assert.equal(AWX.istekler.length, 0);
});

test('LS2 survey: zorunlu alan, gizli varsayilan, ham degiskenler ve kullanici bilgisi', async () => {
  let r = await baslat(41, { extraVars: { hedef: '  ' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'hedef');
  assert.match(r.body.message, /Zorunlu alan boş: Hedef/);
  assert.equal(launchGovdesi(), null, 'eksik alanla is baslatildi');

  r = await baslat(41, {
    extraVars: { hedef: ' ORNAPP01 ', ortam: 'qa' },
    limit: 'WEB01',
    templateName: 'Saglik',
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true, jobId: 950, status: 'pending' });
  const g = launchGovdesi();
  assert.equal(g.extra_vars.hedef, 'ORNAPP01', 'survey degeri ham degiskenle ezildi');
  assert.equal(g.extra_vars.ortam, 'prod', 'gizli alan kullanici degeriyle doldu');
  assert.equal(g.extra_vars.sabit, '1');
  assert.equal(g.extra_vars.talep_eden_mail, 'ornek@ornek.invalid');
  assert.equal(g.extra_vars.username, 'ornekkisi');
  assert.equal(g.limit, 'WEB01');
  const karar = kapilar.runChangeGates.mock.calls.at(-1).arguments[0];
  assert.equal(karar.username, 'ornekkisi');
  assert.equal(karar.gateVars.hedef, 'ORNAPP01');
  assert.equal(onKontrol.assertTemplateAcceptsExtraVars.mock.calls.at(-1).arguments[1], 41);
});

test('LS3 survey yoksa gonderilen degiskenler guvenilmez: kapiya gitmez', async () => {
  const r = await baslat(42, { extraVars: { env: 'prod', bos: ' ', sayi: 3 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const g = launchGovdesi();
  assert.equal(g.extra_vars.env, 'prod');
  assert.equal(g.extra_vars.sayi, '3');
  assert.equal('bos' in g.extra_vars, false);
  const karar = kapilar.runChangeGates.mock.calls.at(-1).arguments[0];
  assert.equal('env' in karar.gateVars, false, 'kullanici degiskeni kapi kararina guvenilir girdi');
  assert.equal(karar.extraVars.env, 'prod');
});

test('LS4 kapi kararlari: error ve respond aynen; taninmayan karar is baslatmaz', async () => {
  kapilar.runChangeGates.mock.mockImplementation(async () => ({
    outcome: 'error',
    status: 409,
    body: { ok: false, message: 'OCO penceresi disinda' },
  }));
  let r = await baslat(41, { extraVars: { hedef: 'A' } });
  assert.deepEqual([r.status, r.body.message], [409, 'OCO penceresi disinda']);
  kapilar.runChangeGates.mock.mockImplementation(async () => ({
    outcome: 'respond',
    body: { ok: true, pendingApproval: true, ticketId: 5 },
  }));
  r = await baslat(41, { extraVars: { hedef: 'A' } });
  assert.deepEqual(r.body, { ok: true, pendingApproval: true, ticketId: 5 });
  kapilar.runChangeGates.mock.mockImplementation(async () => ({ outcome: 'belirsiz' }));
  r = await baslat(41, { extraVars: { hedef: 'A' } });
  assert.equal(r.status, 500);
  assert.match(r.body.message, /güvenlik gereği başlatılmadı/);
  assert.equal(launchGovdesi(), null, 'kapi karari olmadan is baslatildi');
});

test('LS5 proceed: launch ve gecmis; AWX eksik alan reddi anlasilir mesaj', async () => {
  let r = await baslat(41, { extraVars: { hedef: 'ORNAPP01' }, templateName: 'Saglik' });
  assert.equal(r.status, 200);
  assert.equal(DB.gecmis.length, 1);
  assert.deepEqual(DB.gecmis[0].slice(0, 5), ['ornekkisi', 1, 41, 'Saglik', 950]);
  assert.ok(denetim.includes('selfservice_ansible_launch'));
  AWX.launchRed = { variables_needed_to_start: ['hedef_ortam'] };
  r = await baslat(41, { extraVars: { hedef: 'ORNAPP01' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.message, 'Eksik zorunlu alan(lar): hedef_ortam');
  AWX.launchRed = { extra_vars: ['bozuk deger'] };
  r = await baslat(41, { extraVars: { hedef: 'ORNAPP01' } });
  assert.equal(r.body.message, 'Parametre hatası: bozuk deger');
});
