// server/ansible/__tests__/oco-smart-kayit-uclari.test.js - Zamanlanmis OCO kayitlari ve Smart talep uclari GERCEK
// runner.cjs ile (2026-11-24, kapsam PR-2). Sahte: AWX (HTTP), OCO / Smart store, playbook kaydi.
//   OK1 /ss/oco/scheduled/all: suzgecler store'a, tavan 500; modul etiketi (ScaleX / Self Service); /mine yalniz kendi
//   OK2 admin-cancel: yok 404, sonuclanmis 400; AWX schedule'in baslattigi kosan isler iptal, schedule silinir
//       (404 = zaten yok); silinemezse kayit DEGISMEZ; calisan is iptal edilemezse kayit DEGISMEZ; yaris 409; denetim
//   OK3 kullanici iptali: kendi bekleyen kaydi; degilse 404
//   OK4 smart-ticket status / detail: sahiplik (harf duyarsiz, Admin), gizli degisken maskeli; /mine son tarih alanlari
'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const AWX = { istekler: [], isler: [], silHata: null, iptalHata: null };
const awx = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  AWX.istekler.push(`${req.method} ${u.pathname}${u.search}`);
  const json = (kod, g) => {
    res.writeHead(kod, { 'content-type': 'application/json' });
    res.end(g === null ? '' : JSON.stringify(g));
  };
  if (req.method === 'GET' && u.pathname === '/api/v2/jobs/')
    return json(200, { results: AWX.isler });
  if (req.method === 'DELETE' && /^\/api\/v2\/schedules\/\d+\/$/.test(u.pathname)) {
    if (AWX.silHata) return json(AWX.silHata, { detail: 'silinemedi' });
    return json(204, null);
  }
  if (req.method === 'POST' && /^\/api\/v2\/jobs\/\d+\/cancel\/$/.test(u.pathname)) {
    if (AWX.iptalHata) return json(AWX.iptalHata, { detail: 'iptal reddi' });
    return json(202, null);
  }
  if (req.method === 'GET' && /^\/api\/v2\/jobs\/\d+\/$/.test(u.pathname))
    return json(200, { id: 1, status: 'successful' });
  json(404, {});
});

function sahte(rel, exports) {
  const p = require.resolve(path.join(__dirname, '..', '..', rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
sahte('db/index.cjs', {
  query: async (sql) =>
    /COUNT\(\*\) AS n/.test(String(sql)) ? { rows: [{ n: 1 }] } : { rows: [], rowCount: 0 },
});
const denetim = [];
sahte('audit/index.cjs', {
  auditPortal: (req, olay, ek) =>
    denetim.push({ olay, detay: ek?.detail ? JSON.parse(ek.detail) : null }),
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
const ADMIN = { username: 'adm1', role: 'Admin' };
const KULLANICI = { username: 'OrnekKisi', role: 'User' };
function cagir(uc, { params = {}, query = {}, body = {}, user = ADMIN } = {}) {
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
    Promise.resolve(uclar[uc]({ params, query, body, session: { user } }, res)).catch(reject);
  });
}

const kayit = (ek = {}) => ({
  id: 5,
  username: 'ornekkisi',
  ocoNumber: '22500001',
  ocoSubject: 'Kesinti',
  runAt: '2026-12-01T22:00:00Z',
  windowEnd: '2026-12-02T02:00:00Z',
  status: 'AWX_SCHEDULED',
  awxJobId: null,
  awxScheduleId: 55,
  errorMessage: null,
  awxServerId: 1,
  awxTemplateId: 41,
  pendingLaunch: { templateName: 'ScaleX Stop' },
  cancelledBy: null,
  cancelNote: null,
  createdAt: '2026-11-20T10:00:00Z',
  ...ek,
});
const bilet = (ek = {}) => ({
  id: 7,
  status: 'PENDING',
  username: 'ornekkisi',
  smartStateName: 'Onay bekliyor',
  awxJobId: null,
  awxServerId: 1,
  errorMessage: null,
  externalTicketId: 'SM-1',
  flowKey: 'akış',
  createdAt: new Date('2026-11-24T08:00:00Z'),
  resolvedAt: null,
  pendingLaunch: {
    templateName: 'Sifre degistir',
    extraVars: { hedef: 'ORNAPP01', parola: 'cokgizli', gizli_alan: 'x' },
    specFields: [{ variable: 'parola', type: 'password' }],
    overrides: { fieldOverrides: [{ fieldName: 'gizli_alan', hidden: true }] },
  },
  ...ek,
});

let ocoStore;
let smartStore;
let kayitlar;
const ENV = ['AWX_1_URL', 'AWX_1_TOKEN'];
const eskiEnv = {};
before(async () => {
  await new Promise((r) => awx.listen(0, '127.0.0.1', r));
  for (const k of ENV) eskiEnv[k] = process.env[k];
  process.env.AWX_1_URL = `http://127.0.0.1:${awx.address().port}`;
  process.env.AWX_1_TOKEN = 'test-token';
  require('../runner.cjs').initAnsibleRunner(app);
  require('../../smart/poller.cjs').stopPoller();
  require('../../oco/poller.cjs').stopPoller();
  ocoStore = require('../../oco/store.cjs');
  smartStore = require('../../smart/store.cjs');
  kayitlar = require('../playbook-registry.cjs');
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
  Object.assign(AWX, { istekler: [], isler: [], silHata: null, iptalHata: null });
  denetim.length = 0;
  t.mock.method(console, 'warn', () => {});
  t.mock.method(ocoStore, 'get', async () => kayit());
  t.mock.method(ocoStore, 'adminCancel', async (id, alan) => ({
    ...kayit(),
    status: 'CANCELLED',
    ...alan,
  }));
});

test('OK1 zamanlanmis liste: suzgecler, tavan, modul etiketi; mine yalniz kendi', async (t) => {
  const listAll = t.mock.method(ocoStore, 'listAll', async () => ({
    total: 2,
    items: [kayit(), kayit({ id: 6, awxTemplateId: 77, pendingLaunch: null })],
  }));
  t.mock.method(kayitlar, 'getByKey', async (k) =>
    k === 'scalex_run' ? { awxServerId: 1 } : null,
  );
  t.mock.method(kayitlar, 'getEffectiveTemplateId', () => 41);
  const r = await cagir('get /api/ansible/ss/oco/scheduled/all', {
    query: { limit: '9999', offset: '20', status: ' SCHEDULED ', username: ' ali ', q: ' oco ' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(listAll.mock.calls[0].arguments[0], {
    limit: 500,
    offset: 20,
    status: 'SCHEDULED',
    username: 'ali',
    q: 'oco',
  });
  assert.equal(r.body.total, 2);
  assert.deepEqual(
    r.body.items.map((x) => [x.module, x.templateName]),
    [
      ['ScaleX', 'ScaleX Stop'],
      ['Self Service', ''],
    ],
  );
  assert.equal('pendingLaunch' in r.body.items[0], false, 'ham paket istemciye gitti');
  listAll.mock.mockImplementation(async () => {
    throw new Error('DB yok');
  });
  assert.equal((await cagir('get /api/ansible/ss/oco/scheduled/all')).status, 500);

  const mine = t.mock.method(ocoStore, 'listByUsername', async () => [kayit()]);
  const m = await cagir('get /api/ansible/ss/oco/scheduled/mine', { user: KULLANICI });
  assert.equal(mine.mock.calls[0].arguments[0], 'OrnekKisi');
  assert.deepEqual(Object.keys(m.body.items[0]).sort(), [
    'awxJobId',
    'errorMessage',
    'id',
    'ocoNumber',
    'ocoSubject',
    'runAt',
    'status',
    'templateName',
    'windowEnd',
  ]);
});

test('OK2 admin-cancel: schedule ve kosan isler; hata yollarinda kayit degismez', async () => {
  const uc = 'post /api/ansible/ss/oco/scheduled/:id/admin-cancel';
  ocoStore.get.mock.mockImplementation(async () => null);
  assert.equal((await cagir(uc, { params: { id: '5' } })).status, 404);
  ocoStore.get.mock.mockImplementation(async () => kayit({ status: 'EXPIRED' }));
  const son = await cagir(uc, { params: { id: '5' } });
  assert.equal(son.status, 400);
  assert.match(son.body.message, /zaten sonuçlanmış \(EXPIRED\)/);

  ocoStore.get.mock.mockImplementation(async () => kayit());
  AWX.isler = [
    { id: 801, status: 'running' },
    { id: 802, status: 'successful' },
  ];
  let r = await cagir(uc, { params: { id: '5' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.note, /AWX job #801 iptal edildi/);
  assert.match(r.body.note, /AWX schedule #55 silindi/);
  assert.ok(!r.body.note.includes('#802'), 'biten is iptal edilmeye calisildi');
  assert.ok(AWX.istekler.includes('GET /api/v2/jobs/?schedule=55&page_size=50'));
  assert.equal(ocoStore.adminCancel.mock.calls.at(-1).arguments[1].cancelledBy, 'adm1');
  assert.equal(denetim.at(-1).olay, 'selfservice_oco_admin_cancel');

  AWX.isler = [];
  AWX.silHata = 404;
  r = await cagir(uc, { params: { id: '5' } });
  assert.match(r.body.note, /schedule henüz job başlatmamıştı; AWX schedule #55 zaten yoktu/);

  const once = ocoStore.adminCancel.mock.callCount();
  AWX.silHata = 500;
  r = await cagir(uc, { params: { id: '5' } });
  assert.equal(r.status, 500);
  assert.match(r.body.message, /Kayıt DEĞİŞTİRİLMEDİ/);
  assert.equal(ocoStore.adminCancel.mock.callCount(), once, 'silinemeyen schedule kaydi kapatti');

  AWX.silHata = null;
  ocoStore.get.mock.mockImplementation(async () =>
    kayit({ status: 'LAUNCHED', awxScheduleId: null, awxJobId: 900 }),
  );
  r = await cagir(uc, { params: { id: '5' } });
  assert.equal(r.status, 200);
  assert.match(r.body.note, /AWX job #900 iptal edildi/);
  AWX.iptalHata = 500;
  r = await cagir(uc, { params: { id: '5' } });
  assert.equal(r.status, 500);
  assert.match(r.body.message, /Çalışan AWX job iptal edilemedi/);
  AWX.iptalHata = null;

  ocoStore.get.mock.mockImplementation(async () => kayit({ awxServerId: 9 }));
  r = await cagir(uc, { params: { id: '5' } });
  assert.equal(r.status, 404);
  assert.match(r.body.message, /kayıt değiştirilmedi/);

  ocoStore.get.mock.mockImplementation(async () =>
    kayit({ status: 'SCHEDULED', awxScheduleId: null }),
  );
  ocoStore.adminCancel.mock.mockImplementation(async () => null);
  r = await cagir(uc, { params: { id: '5' } });
  assert.equal(r.status, 409);
});

test('OK3 kullanici iptali yalniz kendi bekleyen kaydi', async (t) => {
  const uc = 'post /api/ansible/ss/oco/scheduled/:id/cancel';
  const iptal = t.mock.method(ocoStore, 'cancel', async () => kayit({ status: 'CANCELLED' }));
  let r = await cagir(uc, { params: { id: '5' }, user: KULLANICI });
  assert.deepEqual(r.body, { ok: true });
  assert.deepEqual(iptal.mock.calls[0].arguments, [5, 'OrnekKisi']);
  assert.equal(denetim.at(-1).olay, 'selfservice_oco_cancelled');
  iptal.mock.mockImplementation(async () => null);
  r = await cagir(uc, { params: { id: '5' }, user: KULLANICI });
  assert.equal(r.status, 404);
  iptal.mock.mockImplementation(async () => {
    throw new Error('DB yok');
  });
  assert.equal((await cagir(uc, { params: { id: '5' }, user: KULLANICI })).status, 500);
});

test('OK4 smart talep: sahiplik, maskeli degiskenler, son tarih alanlari', async (t) => {
  const al = t.mock.method(smartStore, 'getTicket', async () => bilet());
  for (const uc of [
    'get /api/ansible/ss/smart-ticket/:id/status',
    'get /api/ansible/ss/smart-ticket/:id/detail',
  ]) {
    al.mock.mockImplementation(async () => null);
    assert.equal((await cagir(uc, { params: { id: '7' }, user: KULLANICI })).status, 404, uc);
    al.mock.mockImplementation(async () => bilet({ username: 'baskasi' }));
    assert.equal((await cagir(uc, { params: { id: '7' }, user: KULLANICI })).status, 403, uc);
    assert.equal((await cagir(uc, { params: { id: '7' }, user: ADMIN })).status, 200, uc);
    al.mock.mockImplementation(async () => bilet());
    assert.equal((await cagir(uc, { params: { id: '7' }, user: KULLANICI })).status, 200, uc);
    al.mock.mockImplementation(async () => {
      throw new Error('DB yok');
    });
    assert.equal((await cagir(uc, { params: { id: '7' }, user: KULLANICI })).status, 500, uc);
  }
  al.mock.mockImplementation(async () => bilet());
  const d = await cagir('get /api/ansible/ss/smart-ticket/:id/detail', {
    params: { id: '7' },
    user: KULLANICI,
  });
  assert.deepEqual(d.body.extraVars, {
    hedef: 'ORNAPP01',
    parola: '***gizli***',
    gizli_alan: '***gizli***',
  });
  assert.ok(!JSON.stringify(d.body).includes('cokgizli'), 'parola istemciye gitti');
  const s = await cagir('get /api/ansible/ss/smart-ticket/:id/status', {
    params: { id: '7' },
    user: KULLANICI,
  });
  assert.equal(s.body.status, 'PENDING');
  assert.ok('deadline' in s.body && 'deadlineKaynak' in s.body && s.body.serverNow);

  t.mock.method(smartStore, 'listByUsername', async () => [
    bilet(),
    bilet({ id: 8, status: 'LAUNCHED' }),
  ]);
  const m = await cagir('get /api/ansible/ss/smart-tickets/mine', { user: KULLANICI });
  assert.equal(m.body.tickets.length, 2);
  assert.ok(!JSON.stringify(m.body).includes('cokgizli'), 'mine ham paketi tasidi');
  assert.ok('deadline' in m.body.tickets[0]);
});
