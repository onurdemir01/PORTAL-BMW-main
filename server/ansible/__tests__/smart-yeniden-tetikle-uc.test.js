// server/ansible/__tests__/smart-yeniden-tetikle-uc.test.js - Zaman asimina ugramis Smart talebini Admin'in yeniden
// tetiklemesi, GERCEK runner.cjs uclari ile (2026-11-24, kapsam PR-2). yeniden-tetikle.test.js saf kurallari sinar;
// uclar (retrigger-check / retrigger) testsizdi. Sahte: AWX (HTTP), Smart store / istemci, OCO istemci / kayit.
//   RT1 check: uygun degil 404/409; ScaleX'e bagli 409; Smart okunamazsa engel; OCO kapsami
//   RT2 retrigger reddleri: gerekce, ScaleX, Smart reddi, OCO numarasi / penceresi kapali, yaris (claim) -> denetim RED
//   RT3 dogrudan tetik: AWX launch, onaysizsa atlama denetimi, OCO kaydi LAUNCHED, bilet LAUNCHED
//   RT4 yeni OCO, pencere ileride: AWX schedule; OCO kaydi markRetriggered yoksa yeni kayit; bilet SCHEDULED
//   RT5 AWX hatasi: claim edilmis bilet ERROR; is basladiktan sonra bilet yazilamazsa uyariyla basari
'use strict';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const AWX = { istekler: [], launchHata: false, dusur: [] };
const awx = http.createServer((req, res) => {
  const parcalar = [];
  req.on('data', (c) => parcalar.push(c));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const govde = parcalar.length ? JSON.parse(Buffer.concat(parcalar).toString()) : null;
    AWX.istekler.push({ yontem: req.method, yol: u.pathname, govde });
    const json = (kod, g) => {
      res.writeHead(kod, { 'content-type': 'application/json' });
      res.end(JSON.stringify(g));
    };
    if (req.method === 'POST' && /^\/api\/v2\/job_templates\/\d+\/launch\/$/.test(u.pathname)) {
      if (AWX.launchHata) return json(400, { detail: 'Envanter yok' });
      return json(201, { id: 901, status: 'pending', ignored_fields: {} });
    }
    if (req.method === 'POST' && u.pathname === '/api/v2/schedules/') {
      const extra = { ...(govde.extra_data || {}) };
      for (const k of AWX.dusur) delete extra[k];
      return json(201, { id: 55, name: govde.name, extra_data: extra });
    }
    if (req.method === 'DELETE') return json(204, {});
    json(404, {});
  });
});

const DB = { scalexBagli: false, gecmis: [] };
function sahte(rel, exports) {
  const p = require.resolve(path.join(__dirname, '..', '..', rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
sahte('db/index.cjs', {
  query: async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT TOP 1 id FROM scalex_operations'))
      return { rows: DB.scalexBagli ? [{ id: 3 }] : [] };
    if (s.startsWith('INSERT INTO ansible_job_history')) {
      DB.gecmis.push(params);
      return { rows: [], rowCount: 1 };
    }
    if (/COUNT\(\*\) AS n/.test(s)) return { rows: [{ n: 1 }] };
    return { rows: [], rowCount: 0 };
  },
});
const denetim = [];
sahte('audit/index.cjs', {
  auditPortal: (req, olay, ek) =>
    denetim.push({ olay, detay: ek?.detail ? JSON.parse(ek.detail) : ek }),
  auditLogin: () => {},
});
sahte('auth/users.cjs', {
  getUserIdentity: async (u) => ({
    username: u,
    displayName: 'Ornek Kisi',
    mail: 'ornek@ornek.invalid',
  }),
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
function cagir(uc, id, body) {
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
      uclar[uc](
        {
          params: { id: String(id) },
          body,
          session: { user: { username: 'adm1', role: 'Admin' } },
        },
        res,
      ),
    ).catch(reject);
  });
}
const CHECK = 'get /api/ansible/ss/smart-ticket/:id/retrigger-check';
const RETRIGGER = 'post /api/ansible/ss/smart-ticket/:id/retrigger';
const NOT = 'gece kesintisinde kacirildi, tekrar';

let smartStore;
let smartClient;
let ocoClient;
let ocoStore;
const bilet = (ek = {}) => ({
  id: 7,
  status: 'TIMEOUT',
  username: 'ornekkisi',
  awxServerId: 1,
  awxTemplateId: 41,
  externalTicketId: 'SM-9',
  smartStateName: 'Onay bekliyor',
  pendingLaunch: {
    detail: { id: 41, ask_variables_on_launch: true, ask_limit_on_launch: true },
    extraVars: { hedef: 'ORNAPP01' },
    resolvedLaunchOptions: { limit: 'WEB01' },
    username: 'ornekkisi',
    templateName: 'ScaleX Stop',
  },
  ...ek,
});
const ocoBilet = (ek = {}) =>
  bilet({
    pendingLaunch: {
      ...bilet().pendingLaunch,
      extraVars: { hedef: 'ORNAPP01', oco_number: '22500001' },
      ocoRecordId: 12,
      ocoWindowStartIso: '2026-11-01T22:00:00.000Z',
      ocoWindowEndIso: '2026-11-02T02:00:00.000Z',
    },
    ...ek,
  });
const ocoYaniti = (basMs, sonMs) => ({
  payload: {
    GetChangeOrderByWfInstanceIdResult: {
      Result: {
        PlannedStartDate: `/Date(${basMs}+0300)/`,
        PlannedEndDate: `/Date(${sonMs}+0300)/`,
      },
    },
  },
  result: { Subject: 'Yeni kesinti' },
});

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
  smartStore = require('../../smart/store.cjs');
  smartClient = require('../../smart/client.cjs');
  ocoClient = require('../../oco/client.cjs');
  ocoStore = require('../../oco/store.cjs');
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

let durumlar;
beforeEach((t) => {
  AWX.istekler = [];
  AWX.launchHata = false;
  AWX.dusur = [];
  DB.scalexBagli = false;
  DB.gecmis = [];
  denetim.length = 0;
  durumlar = [];
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(smartStore, 'getTicket', async () => bilet());
  t.mock.method(smartStore, 'claimTimeoutForRetrigger', async (id) => ({
    ...bilet(),
    id,
    status: 'LAUNCHING',
  }));
  t.mock.method(smartStore, 'markState', async (id, alanlar) => {
    durumlar.push({ id, ...alanlar });
    return true;
  });
  t.mock.method(smartClient, 'checkTicketStatus', async () => ({
    statusCode: '50',
    stateName: 'Onay bekliyor',
  }));
  t.mock.method(ocoStore, 'markRetriggered', async () => true);
  t.mock.method(ocoStore, 'createAwxScheduled', async () => ({ id: 31 }));
});

test('RT1 retrigger-check: uygunluk, ScaleX baglantisi, Smart durumu, OCO kapsami', async (t) => {
  smartStore.getTicket.mock.mockImplementation(async () => null);
  assert.equal((await cagir(CHECK, 7)).status, 404);
  smartStore.getTicket.mock.mockImplementation(async () => bilet({ status: 'LAUNCHED' }));
  const r409 = await cagir(CHECK, 7);
  assert.equal(r409.status, 409);
  assert.match(r409.body.message, /durum: LAUNCHED/);
  smartStore.getTicket.mock.mockImplementation(async () => bilet());
  DB.scalexBagli = true;
  assert.equal((await cagir(CHECK, 7)).status, 409);
  DB.scalexBagli = false;
  let r = await cagir(CHECK, 7);
  assert.equal(r.status, 200);
  assert.equal(r.body.smart.durum, 'bekliyor');
  assert.deepEqual(r.body.oco, {
    kapsamli: false,
    ocoNumber: null,
    windowStartIso: null,
    windowEndIso: null,
  });
  assert.equal(r.body.notEnAz, 10);
  smartStore.getTicket.mock.mockImplementation(async () => ocoBilet());
  t.mock.method(smartClient, 'checkTicketStatus', async () => {
    throw new Error('Smart zaman asimi');
  });
  r = await cagir(CHECK, 7);
  assert.equal(r.body.smart.durum, 'okunamadi');
  assert.equal(r.body.smart.engel, true);
  assert.deepEqual(r.body.oco, {
    kapsamli: true,
    ocoNumber: '22500001',
    windowStartIso: '2026-11-01T22:00:00.000Z',
    windowEndIso: '2026-11-02T02:00:00.000Z',
  });
  smartStore.getTicket.mock.mockImplementation(async () => {
    throw new Error('DB yok');
  });
  assert.equal((await cagir(CHECK, 7)).status, 500);
});

test('RT2 retrigger reddleri denetime RED olarak yazilir, AWX cagrilmaz', async (t) => {
  const red = async (body, durum, desen) => {
    denetim.length = 0;
    const r = await cagir(RETRIGGER, 7, body);
    assert.equal(r.status, durum, JSON.stringify(r.body));
    assert.match(r.body.message, desen);
    assert.equal(denetim.at(-1).olay, 'selfservice_smart_ticket_retrigger_denied');
    assert.equal(denetim.at(-1).detay.sonuc, 'RED');
  };
  await red({ note: 'kisa' }, 400, /Gerekçe zorunlu/);
  DB.scalexBagli = true;
  await red({ note: NOT }, 409, /ScaleX işlemine bağlı/);
  DB.scalexBagli = false;
  t.mock.method(smartClient, 'checkTicketStatus', async () => ({
    statusCode: '2000',
    stateName: 'Reddedildi',
  }));
  await red({ note: NOT }, 409, /REDDEDİLMİŞ/);
  t.mock.method(smartClient, 'checkTicketStatus', async () => ({ statusCode: '1000' }));

  smartStore.getTicket.mock.mockImplementation(async () => ocoBilet());
  await red({ note: NOT }, 400, /yeni OCO numarası girin/);
  await red({ note: NOT, mode: 'oco', ocoNumber: '22500001' }, 400, /penceresi kapanmış kaydı/);
  t.mock.method(ocoClient, 'getChangeOrder', async () => ({ payload: {}, result: {} }));
  await red({ note: NOT, mode: 'oco', ocoNumber: '22509999' }, 400, /planlanan kesinti tarihi yok/);
  const gecmis = Date.now() - 5 * 3600e3;
  t.mock.method(ocoClient, 'getChangeOrder', async () => ocoYaniti(gecmis, gecmis + 3600e3));
  await red(
    { note: NOT, mode: 'oco', ocoNumber: '22509999' },
    400,
    /kapanmış; başka bir OCO girin/,
  );
  t.mock.method(ocoClient, 'getChangeOrder', async () => {
    throw Object.assign(new Error('OCO servisi yok'), { status: 503 });
  });
  t.mock.method(ocoClient, 'httpStatus', () => 503);
  await red({ note: NOT, mode: 'oco', ocoNumber: '22509999' }, 503, /OCO servisi yok/);

  smartStore.getTicket.mock.mockImplementation(async () => bilet({ awxServerId: 9 }));
  await red({ note: NOT }, 409, /AWX sunucusu bulunamadı/);
  smartStore.getTicket.mock.mockImplementation(async () => bilet());
  smartStore.claimTimeoutForRetrigger.mock.mockImplementation(async () => null);
  await red({ note: NOT }, 409, /durum değiştirdi/);
  assert.equal(AWX.istekler.length, 0, 'reddedilen istekte AWX cagrildi');
});

test('RT3 dogrudan tetik: AWX launch, onay atlama denetimi, OCO kaydi ve bilet LAUNCHED', async () => {
  smartStore.getTicket.mock.mockImplementation(async () => ocoBilet());
  const r = await cagir(RETRIGGER, 7, {
    note: NOT,
    mode: 'pencereDisi',
    outsideWindowConfirm: true,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'LAUNCHED');
  assert.equal(r.body.jobId, 901);
  assert.equal(r.body.ocoKayit, 12);
  const launch = AWX.istekler.find((x) => x.yol === '/api/v2/job_templates/41/launch/');
  // AWX'e extra_vars JSON metni olarak gider (tipler korunur).
  const ev =
    typeof launch.govde.extra_vars === 'string'
      ? JSON.parse(launch.govde.extra_vars)
      : launch.govde.extra_vars;
  assert.equal(ev.hedef, 'ORNAPP01');
  assert.equal(ev.oco_number, '22500001', 'pencere disi tetik eski OCO numarasini tasir');
  assert.equal(launch.govde.limit, 'WEB01');
  assert.deepEqual(ocoStore.markRetriggered.mock.calls[0].arguments[0], 12);
  assert.equal(ocoStore.markRetriggered.mock.calls[0].arguments[1].status, 'LAUNCHED');
  assert.equal(durumlar.at(-1).status, 'LAUNCHED');
  assert.equal(durumlar.at(-1).expected, 'LAUNCHING');
  const olaylar = denetim.map((d) => d.olay);
  assert.ok(olaylar.includes('selfservice_smart_ticket_retrigger'));
  const atlama = denetim.find((d) => d.olay === 'smart_onayi_admin_atladi');
  assert.ok(atlama, 'onaysiz tetikte Smart atlamasi denetime yazilmali');
  assert.equal(atlama.detay.yer, 'smart_talep_yeniden_tetikle');
  assert.equal(atlama.detay.smartStatusCode, '50');

  assert.equal(DB.gecmis.length, 1, 'is gecmisi yazilmadi');
});

test('RT4 yeni OCO, pencere ileride: AWX schedule, OCO kaydi, bilet SCHEDULED', async (t) => {
  const bas = Date.now() + 3 * 3600e3;
  t.mock.method(ocoClient, 'getChangeOrder', async () => ocoYaniti(bas, bas + 4 * 3600e3));
  smartStore.getTicket.mock.mockImplementation(async () => ocoBilet());
  let r = await cagir(RETRIGGER, 7, { note: NOT, mode: 'oco', ocoNumber: '22509999' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, 'SCHEDULED');
  assert.equal(r.body.awxScheduleId, 55);
  assert.equal(r.body.ocoKayit, 12);
  const sch = AWX.istekler.find((x) => x.yol === '/api/v2/schedules/');
  assert.equal(sch.govde.unified_job_template, 41);
  assert.equal(sch.govde.extra_data.oco_number, '22509999');
  assert.equal(sch.govde.limit, 'WEB01');
  assert.match(sch.govde.rrule, /COUNT=1/);
  assert.equal(durumlar.at(-1).status, 'SCHEDULED');
  // Bagli OCO kaydi FAILED degilse yeni kayit acilir.
  ocoStore.markRetriggered.mock.mockImplementation(async () => false);
  r = await cagir(RETRIGGER, 7, { note: NOT, mode: 'oco', ocoNumber: '22509999' });
  assert.equal(r.body.ocoKayit, 31);
  const yeni = ocoStore.createAwxScheduled.mock.calls[0].arguments[0];
  assert.equal(yeni.ocoNumber, '22509999');
  assert.equal(yeni.ocoSubject, 'Yeni kesinti');
  assert.equal(yeni.pendingLaunch.ocoRecordId, undefined);
  // AWX degiskeni yok sayarsa zamanlama silinir ve hata doner (bilet ERROR).
  AWX.dusur = ['oco_number'];
  r = await cagir(RETRIGGER, 7, { note: NOT, mode: 'oco', ocoNumber: '22509999' });
  assert.equal(r.status, 400);
  assert.ok(AWX.istekler.some((x) => x.yontem === 'DELETE' && x.yol === '/api/v2/schedules/55/'));
  assert.equal(durumlar.at(-1).status, 'ERROR');
});

test('RT5 AWX hatasi bileti ERROR yapar; bilet yazilamazsa uyariyla basari', async () => {
  AWX.launchHata = true;
  let r = await cagir(RETRIGGER, 7, { note: NOT });
  assert.equal(r.status, 400);
  assert.equal(durumlar.at(-1).status, 'ERROR');
  assert.match(
    durumlar.at(-1).errorMessage,
    /Admin adm1 yeniden tetikledi ama AWX çağrısı başarısız/,
  );
  assert.equal(denetim.at(-1).detay.sonuc, 'ERROR');

  AWX.launchHata = false;
  smartStore.markState.mock.mockImplementation(async () => {
    throw new Error('DB yazilamadi');
  });
  r = await cagir(RETRIGGER, 7, { note: NOT });
  assert.equal(r.status, 200);
  assert.equal(r.body.warning, true);
  assert.equal(r.body.status, 'LAUNCHED');
  assert.match(r.body.message, /job #901/);
  assert.equal(denetim.at(-1).detay.biletYazilamadi, true);
});
