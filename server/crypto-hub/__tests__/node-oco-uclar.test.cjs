// server/crypto-hub/__tests__/node-oco-uclar.test.cjs - sihirbaz ve ekranlarin dayandigi runner uclari.
//
// OU: Ekran testleri bu uclari mocklar; alan silinirse ekran testleri yesil kalirken sihirbaz her
// OCO'lu talebi durdurur ya da onayli bekleyen metni kaybolur. Gercek runner kaydi, gercek
// pencere hesabi ve deadline; sahte olan OCO servisi ve Smart store.
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const N = require('../../../shared/cryptoHubNodes.cjs');
const runner = require('../../ansible/runner.cjs');
const ocoClient = require('../../oco/client.cjs');
const smartStore = require('../../smart/store.cjs');

const uclar = {};
const kaydet = (metot) => (yol, ...fn) => {
  if (typeof yol === 'string') uclar[`${metot} ${yol}`] = fn[fn.length - 1];
};
const app = new Proxy({}, { get: (_, k) => (k === 'use' ? () => {} : kaydet(k)) });

function cagir(uc, req) {
  return new Promise((resolve, reject) => {
    const res = {
      durum: 200,
      status(n) {
        this.durum = n;
        return this;
      },
      json(govde) {
        resolve({ status: this.durum, body: govde });
      },
    };
    Promise.resolve(uclar[uc](req, res)).catch(reject);
  });
}

const bilet = (ek = {}) => ({
  id: 1,
  status: 'PENDING',
  smartStateName: 'Tamamlandi',
  approvedAt: '2026-11-06T10:00:00.000Z',
  pendingLaunch: { templateName: 'crypto_hub_ops', extraVars: {} },
  createdAt: new Date(),
  ...ek,
});

before(() => {
  runner.initAnsibleRunner(app);
  require('../../smart/poller.cjs').stopPoller();
  require('../../oco/poller.cjs').stopPoller();
});
after(() => {
  require('../../smart/poller.cjs').stopPoller();
  require('../../oco/poller.cjs').stopPoller();
});

test('OU1 /ss/oco/validate: sihirbazin hesapladigi ISO alanlari doner, ocoPencereKarari onlarla calisir', async (t) => {
  const uc = 'post /api/ansible/ss/oco/validate';
  assert.equal(typeof uclar[uc], 'function', 'uc kaydi bulunamadi (bekci kor)');
  const basMs = Date.now() + 60 * 60000;
  const sonMs = basMs + 240 * 60000;
  t.mock.method(ocoClient, 'getChangeOrder', async () => ({
    payload: {
      GetChangeOrderByWfInstanceIdResult: {
        Result: { PlannedStartDate: `/Date(${basMs}+0300)/`, PlannedEndDate: `/Date(${sonMs}+0300)/` },
      },
    },
    result: { Subject: 'Node gecisi' },
  }));
  const r = await cagir(uc, { body: { ocoNumber: ' 22502813 ' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const o = r.body.oco;
  assert.equal(Date.parse(o.windowStartIso), basMs);
  assert.equal(Date.parse(o.windowEndIso), sonMs);
  assert.equal(o.ocoNumber, '22502813');
  const karar = N.ocoPencereKarari({
    basMs: Date.parse(o.windowStartIso),
    sonMs: Date.parse(o.windowEndIso),
    simdiMs: Date.now(),
    smartKapali: false,
  });
  assert.equal(karar.kod, 'bekle');
});

test('OU2 /ss/smart-tickets/mine: approvedAt ve son tarih ekrana gider', async (t) => {
  const uc = 'get /api/ansible/ss/smart-tickets/mine';
  const son = new Date(Date.now() + 3600000).toISOString();
  t.mock.method(smartStore, 'listByUsername', async () => [
    bilet({
      pendingLaunch: { ...bilet().pendingLaunch, sonBaslamaIso: son, ocoWindowEndIso: son, pencereBekle: true },
    }),
    bilet({ id: 2, approvedAt: null }),
  ]);
  const r = await cagir(uc, { session: { user: { username: 'ali' } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.tickets[0].approvedAt, '2026-11-06T10:00:00.000Z');
  assert.equal(r.body.tickets[0].deadlineKaynak, 'oco');
  assert.equal(r.body.tickets[0].deadline, son);
  assert.equal(r.body.tickets[1].approvedAt, null);
});

test('OU3 /ss/smart-tickets/all: approvedAt admin ekranina gider', async (t) => {
  const uc = 'get /api/ansible/ss/smart-tickets/all';
  t.mock.method(smartStore, 'listAll', async () => ({ total: 1, tickets: [bilet()] }));
  t.mock.method(smartStore, 'statusSummary', async () => ({}));
  const r = await cagir(uc, { query: {} });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.tickets[0].approvedAt, '2026-11-06T10:00:00.000Z');
});
