// server/logx/v2/__tests__/restrictions-group-route.test.cjs
//
// GRUP IZNI ROTA KATMANINDA CALISIYOR MU (2026-10-01).
//
// URETIM SIKAYETI: ekipler LogX'te prod'da 403 aliyor, test'te almiyor. KOK NEDEN:
// AD gruplari login'de oturuma yaziliyor (server/auth/index.cjs) ama LogX'in
// `currentUser()`i `groups` alanini ATIYORDU. `restrictions.cjs` gruplari
// `user.groups`'tan okudugu icin grup izinleri HICBIR ZAMAN eslesmiyordu: yalnizca
// grup izinli bir kisitlama, o gruptaki herkes icin TAM YASAKTI. Test DB'de
// kisitlama satiri olmadigi icin (varsayilan-acik) orada gorunmuyordu.
//
// `restrictions-group-grant.test.cjs` modulu DOGRUDAN cagiriyordu (kullanici
// nesnesini test kendisi kuruyordu) — rota katmanindaki kayip ona GORUNMEZDI.
// Bu bekci GERCEK LogX router'ini, gercek `requireAuth` ile, oturumdaki kullanici
// uzerinden kosturur.
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const db = require('../../../db/index.cjs');

const GROUP = 'CN=odeme-ekibi,OU=Groups,DC=example,DC=com';
const APP = 'odeme-ear';

// Sahte DB: yalnizca `APP` kisitli ve yalnizca `GROUP`a izinli. Diger her sorgu bos.
const origQuery = db.query;
db.query = async (sql, params) => {
  const s = String(sql);
  if (/FROM logx_v2_restrictions r/.test(s) && Array.isArray(params) && params[1] === APP) {
    return { rows: [{ id: 1, username: null, group_dn: GROUP }] };
  }
  return { rows: [] };
};

// Kapidan GECEN istegin arkasindaki envanter sorgusu: sahte havuz. Boylece "gecti"
// gercek 200 ile olculur (yalnizca "403 degil" demek, baska bir 5xx'i basari sayardi).
const inventoryDb = require('../../../inventory/mssql.cjs');
const origPool = inventoryDb.getPool;
inventoryDb.getPool = async () => ({
  request: () => ({
    input() {},
    query: async () => ({
      recordset: [{ host: 'h1', env: 'PROD', jboss_version: '7', status: 'A' }],
    }),
  }),
});

let server;
let base;
let oturum = null;

before(async () => {
  const app = express();
  app.use(express.json());
  // Gercek login akisinin oturuma yazdigi bicim (server/auth/index.cjs).
  app.use((req, _res, next) => {
    if (oturum) req.session = { user: oturum };
    next();
  });
  const { initLogXv2 } = require('../index.cjs');
  initLogXv2(app);
  await new Promise((r) => {
    server = app.listen(0, '127.0.0.1', r);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  db.query = origQuery;
  inventoryDb.getPool = origPool;
  server && server.close();
});

function istek(user, app = APP) {
  oturum = user;
  return new Promise((resolve, reject) => {
    http
      .get(`${base}/api/logx/v2/legacy/hosts?app=${encodeURIComponent(app)}`, (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ status: res.statusCode, body: b }));
      })
      .on('error', reject);
  });
}

const kullanici = (o) => ({ username: 'ali', role: 'User', authSource: 'ldap', ...o });

test('L1a GRUP izinli kisitli uygulama: gruptaki kullanici GECER (rota katmani)', async () => {
  const r = await istek(kullanici({ groups: [GROUP] }));
  assert.equal(r.status, 200, `grup izni rota katmaninda eslesmedi: ${r.status} ${r.body}`);
});

test('L1b gruba UYE OLMAYAN kullanici 403 alir (genisletme, daraltma degil)', async () => {
  const r = await istek(kullanici({ groups: ['CN=baska,OU=Groups,DC=example,DC=com'] }));
  assert.equal(r.status, 403, r.body);
});

test('L1c oturumda grup alani HIC yoksa (eski oturum / yerel kullanici) 403, cokme yok', async () => {
  const r = await istek(kullanici({}));
  assert.equal(r.status, 403, r.body);
});

test('L1d Admin her zaman gecer', async () => {
  const r = await istek(kullanici({ role: 'Admin', groups: [] }));
  assert.equal(r.status, 200, r.body);
});

test('L1e kisitlanmamis uygulama herkese acik (varsayilan-acik degismedi)', async () => {
  const r = await istek(kullanici({ groups: [] }), 'serbest-ear');
  assert.equal(r.status, 200, r.body);
});
