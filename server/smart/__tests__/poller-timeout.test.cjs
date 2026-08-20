// server/smart/__tests__/poller-timeout.test.cjs — Smart onay zaman asimi icin GUVENLIK
// regresyon testleri (DB / gercek Smart API gerektirmez).
//
// KRITIK DAVRANIS: suresi dolmus bir talep, Smart o anda "Tamamlandi" donse BILE
// otomasyonu (AWX job'i) TETIKLEMEMELIDIR. Bu, kullanicinin acik talebidir
// ("15 dakika icinde onaylanmazsa ... otomasyon asla tetiklenmesin") ve poller'daki
// kontrol SIRASINA baglidir - sure kontrolu launch blogundan ONCE gelmek zorunda.
// Sira yanlislikla degistirilirse bu test kirilir.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  Object.assign(process.env, vars);
  const restore = () => {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  };
  let result;
  try { result = fn(); } catch (err) { restore(); throw err; }
  if (result && typeof result.then === 'function') return result.finally(restore);
  restore();
  return result;
}

// poller.cjs'in require ettigi store/client'i, gercek modulleri diske dokunmadan
// degistirmek icin require cache'ine sahte modul yerlestirilir.
function loadPollerWith({ tickets, statusFor }) {
  const storePath = require.resolve('../store.cjs');
  const clientPath = require.resolve('../client.cjs');
  const configPath = require.resolve('../config.cjs');
  const pollerPath = require.resolve('../poller.cjs');
  const savedStore = require.cache[storePath];
  const savedClient = require.cache[clientPath];
  const savedPoller = require.cache[pollerPath];

  const marks = [];
  const fakeStore = {
    listPending: async () => tickets,
    markState: async (id, patch) => { marks.push({ id, ...patch }); },
  };
  const fakeClient = { checkTicketStatus: async (extId) => statusFor(extId) };

  require.cache[storePath] = new Module(storePath, null);
  require.cache[storePath].exports = fakeStore;
  require.cache[storePath].loaded = true;
  require.cache[clientPath] = new Module(clientPath, null);
  require.cache[clientPath].exports = fakeClient;
  require.cache[clientPath].loaded = true;
  delete require.cache[pollerPath];
  delete require.cache[configPath]; // env degisikligi taze okunsun

  const poller = require('../poller.cjs');
  const restore = () => {
    if (savedStore) require.cache[storePath] = savedStore; else delete require.cache[storePath];
    if (savedClient) require.cache[clientPath] = savedClient; else delete require.cache[clientPath];
    if (savedPoller) require.cache[pollerPath] = savedPoller; else delete require.cache[pollerPath];
    delete require.cache[configPath];
  };
  return { poller, marks, restore };
}

const SMART_ENV = {
  SMART_API_URL: 'https://smart.example', // isConfigured() true olsun
  SMART_API_USERNAME: 'u',
  SMART_API_PASSWORD: 'p',
};

function ticketAgedMinutes(min) {
  return {
    id: 1,
    externalTicketId: '999',
    createdAt: new Date(Date.now() - min * 60000).toISOString(),
    smartStateName: 'Onay Bekliyor',
  };
}

test('varsayilan zaman asimi 15 DAKIKA (saat degil)', () => {
  withEnv({ ...SMART_ENV, SMART_TICKET_TIMEOUT_MINUTES: undefined }, () => {
    delete require.cache[require.resolve('../config.cjs')];
    const { getConfig } = require('../config.cjs');
    assert.strictEqual(getConfig().ticketTimeoutMinutes, 15);
  });
});

test('bayat SMART_TICKET_TIMEOUT_HOURS degeri ARTIK OKUNMUYOR (15 dk korunur)', () => {
  withEnv({ ...SMART_ENV, SMART_TICKET_TIMEOUT_HOURS: '24', SMART_TICKET_TIMEOUT_MINUTES: undefined }, () => {
    delete require.cache[require.resolve('../config.cjs')];
    const { getConfig } = require('../config.cjs');
    assert.strictEqual(getConfig().ticketTimeoutMinutes, 15);
  });
});

test('16 dakikalik talep TIMEOUT olur ve otomasyon TETIKLENMEZ (Smart "Tamamlandi" dese bile)', async () => {
  await withEnv({ ...SMART_ENV, SMART_TICKET_TIMEOUT_MINUTES: '15' }, async () => {
    let launched = 0;
    const { poller, marks, restore } = loadPollerWith({
      tickets: [ticketAgedMinutes(16)],
      // Smart onaylamis olsa BILE launch olmamali - kritik senaryo.
      statusFor: () => ({ completed: true, rejected: false, stateName: 'Tamamlandı', statusCode: '1000' }),
    });
    try {
      poller.startPoller(async () => { launched++; return { jobId: 123 }; });
      await poller.tick();
      assert.strictEqual(launched, 0, 'suresi dolmus talep otomasyonu TETIKLEMEMELI');
      assert.strictEqual(marks.length, 1);
      assert.strictEqual(marks[0].status, 'TIMEOUT');
      assert.strictEqual(marks[0].resolved, true);
      assert.match(marks[0].errorMessage, /15 dakika/);
    } finally {
      poller.stopPoller();
      restore();
    }
  });
});

test('14 dakikalik ONAYLI talep normal sekilde tetiklenir (timeout erken calismamali)', async () => {
  await withEnv({ ...SMART_ENV, SMART_TICKET_TIMEOUT_MINUTES: '15' }, async () => {
    let launched = 0;
    const { poller, marks, restore } = loadPollerWith({
      tickets: [ticketAgedMinutes(14)],
      statusFor: () => ({ completed: true, rejected: false, stateName: 'Tamamlandı', statusCode: '1000' }),
    });
    try {
      poller.startPoller(async () => { launched++; return { jobId: 77 }; });
      await poller.tick();
      assert.strictEqual(launched, 1, 'suresi DOLMAMIS onayli talep tetiklenmeli');
      assert.strictEqual(marks[0].status, 'LAUNCHED');
      assert.strictEqual(marks[0].awxJobId, 77);
    } finally {
      poller.stopPoller();
      restore();
    }
  });
});

test('gecersiz/sifir SMART_TICKET_TIMEOUT_MINUTES guvenli varsayilana (15) duser', () => {
  for (const bad of ['0', '-5', 'abc', '']) {
    withEnv({ ...SMART_ENV, SMART_TICKET_TIMEOUT_MINUTES: bad }, () => {
      delete require.cache[require.resolve('../config.cjs')];
      const { getConfig } = require('../config.cjs');
      assert.strictEqual(getConfig().ticketTimeoutMinutes, 15, `deger "${bad}" icin 15 beklendi`);
    });
  }
});
