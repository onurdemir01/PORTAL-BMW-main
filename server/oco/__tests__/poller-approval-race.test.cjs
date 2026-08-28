// server/oco/__tests__/poller-approval-race.test.cjs — zamanlanmis is tetiklemesinin
// IKI YALANI (2026-08-28 incelemesi). DB/AWX gerektirmez; store require cache'ten
// degistirilir (server/smart/__tests__/poller-timeout.test.cjs ile AYNI desen).
//
// B1 · "TETIKLENDI" YALANI. Smart onayi acikken `_launch` bir JOB degil, bir BILET
//      dondurur: `{ pendingApproval: true, ticketId, externalTicketId }`. Eski kod bunu
//      da `markLaunched(rec.id, result?.jobId ?? null)` ile yaziyordu — `jobId` olmadigi
//      icin kayit `LAUNCHED` + `awx_job_id = NULL` oluyordu. Admin panelinde YESIL
//      "Tetiklendi" rozeti cikiyor, ortada calisan job YOK; bilet 15 dk icinde
//      onaylanmazsa is sessizce olurken ekranda hicbir sey degismiyordu.
//
// B2 · IPTAL YARISI. `_launch` AWX'i ag uzerinden cagirir (saniyeler). Kullanici bu
//      arada "iptal"e basarsa kayit CANCELLED olur; eski kod sonra KOSULSUZ
//      `UPDATE ... WHERE id = $1` yazip iptali EZIYORDU. Cok ornekli kurulumda ayni
//      kaydi iki poller birden tetikleyebiliyordu. Cozum: SCHEDULED -> LAUNCHING
//      claim'ini KAZANAN tetikler.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function loadPollerWith({ records, claimWins = true }) {
  const storePath = require.resolve('../store.cjs');
  const pollerPath = require.resolve('../poller.cjs');
  const savedStore = require.cache[storePath];
  const savedPoller = require.cache[pollerPath];

  const calls = [];
  const fakeStore = {
    listScheduled: async () => records,
    claimForLaunch: async (id) => { calls.push(['claim', id]); return claimWins ? records.find((r) => r.id === id) : null; },
    markLaunched: async (id, jobId) => { calls.push(['markLaunched', id, jobId]); return true; },
    markPendingApproval: async (id, info) => { calls.push(['markPendingApproval', id, info]); return true; },
    markFailed: async (id, msg) => { calls.push(['markFailed', id, msg]); return true; },
    markExpired: async (id) => { calls.push(['markExpired', id]); return true; },
  };

  require.cache[storePath] = new Module(storePath, null);
  require.cache[storePath].exports = fakeStore;
  require.cache[storePath].loaded = true;
  delete require.cache[pollerPath];

  const poller = require('../poller.cjs');
  const restore = () => {
    if (savedStore) require.cache[storePath] = savedStore; else delete require.cache[storePath];
    if (savedPoller) require.cache[pollerPath] = savedPoller; else delete require.cache[pollerPath];
  };
  return { poller, calls, restore };
}

function dueRecord(id = 7) {
  return {
    id,
    ocoNumber: 'OCO-1',
    awxServerId: 1,
    awxTemplateId: 2,
    runAt: new Date(Date.now() - 60000).toISOString(),      // saati GELDI
    windowEnd: new Date(Date.now() + 3600000).toISOString(), // pencere ACIK
    pendingLaunch: {},
  };
}

test('B1: onay bekleyen sonuc LAUNCHED yazilmaz, PENDING_APPROVAL yazilir', async () => {
  const { poller, calls, restore } = loadPollerWith({ records: [dueRecord()] });
  try {
    poller.startPoller(async () => ({ pendingApproval: true, ticketId: 55, externalTicketId: 'SMART-9' }));
    await poller.tick();

    const launched = calls.filter((c) => c[0] === 'markLaunched');
    assert.equal(launched.length, 0, 'onay bekleyen kayit LAUNCHED yazilmis — panel yesil gorunur, job YOK');

    const pending = calls.find((c) => c[0] === 'markPendingApproval');
    assert.ok(pending, 'PENDING_APPROVAL yazilmadi');
    assert.equal(pending[2].smartTicketId, 55, 'bilet ID kaydedilmeli — onay gelince kayit bu ID ile kapanir');
  } finally { restore(); }
});

test('B1: gercek job donduren sonuc yine LAUNCHED yazilir (regresyon olmasin)', async () => {
  const { poller, calls, restore } = loadPollerWith({ records: [dueRecord()] });
  try {
    poller.startPoller(async () => ({ jobId: 4242 }));
    await poller.tick();
    const launched = calls.find((c) => c[0] === 'markLaunched');
    assert.ok(launched, 'normal tetikleme LAUNCHED yazmali');
    assert.equal(launched[2], 4242);
  } finally { restore(); }
});

test('B2: tetiklemeden ONCE claim edilir', async () => {
  const order = [];
  const { poller, calls, restore } = loadPollerWith({ records: [dueRecord()] });
  try {
    poller.startPoller(async () => { order.push('launch'); return { jobId: 1 }; });
    await poller.tick();
    const claimIdx = calls.findIndex((c) => c[0] === 'claim');
    assert.ok(claimIdx >= 0, 'claim hic cagrilmadi — iptal ezilebilir, cift tetikleme mumkun');
    assert.equal(order[0], 'launch');
    assert.ok(calls[claimIdx] && calls[claimIdx][0] === 'claim' && claimIdx === 0, 'claim ILK islem olmali');
  } finally { restore(); }
});

test('B2: claim kaybedilirse AWX HIC cagrilmaz (iptal edilmis kayit tetiklenmez)', async () => {
  let launched = 0;
  const { poller, calls, restore } = loadPollerWith({ records: [dueRecord()], claimWins: false });
  try {
    poller.startPoller(async () => { launched++; return { jobId: 1 }; });
    await poller.tick();
    assert.equal(launched, 0, 'claim kaybedildigi halde AWX tetiklenmis — iptal edilen is calisir');
    assert.equal(calls.filter((c) => c[0] === 'markLaunched').length, 0);
  } finally { restore(); }
});

test('B2: es zamanli iki tick, isi IKI KEZ tetiklemez (re-entrancy guard)', async () => {
  let launched = 0;
  const { poller, restore } = loadPollerWith({ records: [dueRecord()] });
  try {
    poller.startPoller(async () => {
      launched++;
      await new Promise((r) => setTimeout(r, 20)); // AWX cagrisini taklit et
      return { jobId: 1 };
    });
    await Promise.all([poller.tick(), poller.tick()]);
    assert.equal(launched, 1, 'ust uste binen tick ayni isi iki kez tetikledi');
  } finally { restore(); }
});
