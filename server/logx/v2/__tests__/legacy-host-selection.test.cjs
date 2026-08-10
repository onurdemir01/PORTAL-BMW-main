// server/logx/v2/__tests__/legacy-host-selection.test.cjs — legacy keşfinde SUNUCU SEÇİMİ.
//
// NEDEN VAR: bir uygulamanın 30 sunucusu olabiliyor ve keşif bugüne kadar HEPSİNİ
// tarıyordu (dakikalarca süren job + kullanılamaz uzunlukta dosya listesi). Artık
// kullanıcı sunucu seçiyor. Seçim istemciden geldiği için ENVANTERDEN YENIDEN
// DOGRULANIR — aksi halde kullanıcı, yetkisi olmayan bir uygulamanın sunucusunu
// istek gövdesine yazıp orada log tarayabilirdi (anti-TOCTOU deseni, transfer() ile ayni).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const inventoryDb = require('../../../inventory/mssql.cjs');
const jobs = require('../jobs.cjs');
const requests = require('../requests.cjs');
const legacy = require('../legacy.cjs');

const REQUEST = { request_id: 'req-1' };

// Envanterde APP1 icin iki host var. Sorgu `UPPER(host)` donduruyor.
function fakePool(hosts) {
  return {
    request: () => ({
      input() { return this; },
      query: async () => ({ recordset: hosts.map((h) => ({ host: h })) }),
    }),
  };
}

async function withStubs(hosts, fn) {
  const oldPool = inventoryDb.getPool;
  const oldLaunch = jobs.launchJob;
  const oldUpdate = requests.updateRequest;
  const launched = [];
  inventoryDb.getPool = async () => fakePool(hosts);
  jobs.launchJob = async (requestId, type, vars) => { launched.push({ type, vars }); return { jobId: 1 }; };
  requests.updateRequest = async () => {};
  try {
    return await fn(launched);
  } finally {
    inventoryDb.getPool = oldPool;
    jobs.launchJob = oldLaunch;
    requests.updateRequest = oldUpdate;
  }
}

test('seçilen sunucular yalnız onlar taranır (30 sunucu yerine 1)', async () => {
  await withStubs(['GBCJAP01', 'GBCJAP02', 'GBCJAP03'], async (launched) => {
    await legacy.discover(REQUEST, 'APP1', ['gbcjap02']);
    assert.equal(launched.length, 1);
    assert.equal(launched[0].vars.target_hosts, 'GBCJAP02', 'yalnız seçilen host taranmalı');
  });
});

test('envanterde OLMAYAN sunucu REDDEDILIR (istemciye guvenilmez)', async () => {
  await withStubs(['GBCJAP01'], async (launched) => {
    await assert.rejects(
      () => legacy.discover(REQUEST, 'APP1', ['GBCJAP01', 'BASKA-UYGULAMANIN-SUNUCUSU']),
      (e) => e.status === 400 && /ait değil/.test(e.message)
    );
    assert.equal(launched.length, 0, 'doğrulama başarısızsa job HIC baslamamali');
  });
});

test('seçim yoksa ESKI DAVRANIS korunur — tüm envanter hostları', async () => {
  await withStubs(['GBCJAP01', 'GBCJAP02'], async (launched) => {
    await legacy.discover(REQUEST, 'APP1', undefined);
    assert.equal(launched[0].vars.target_hosts, 'GBCJAP01,GBCJAP02');
  });
});

test('listHostsForApp(): sunucu seçim ekranı için env/sürüm/durum da döner', async () => {
  const oldPool = inventoryDb.getPool;
  inventoryDb.getPool = async () => ({
    request: () => ({
      input() { return this; },
      query: async () => ({
        recordset: [{ host: 'GBCJAP01', env: 'PROD', jboss_version: 'EAP7', status: 'running' }],
      }),
    }),
  });
  try {
    const rows = await legacy.listHostsForApp('APP1');
    assert.deepEqual(rows, [{ host: 'GBCJAP01', env: 'PROD', jbossVersion: 'EAP7', status: 'running' }]);
  } finally {
    inventoryDb.getPool = oldPool;
  }
});
