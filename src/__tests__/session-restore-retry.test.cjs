// src/__tests__/session-restore-retry.test.cjs
//
// NEDEN VAR: "release gecince herkesin session'i dusuyor" sikayeti. Sunucu tarafinda
// bir sey bozulmus degildi - oturumlar MSSQL'de duruyor ve SESSION_SECRET sabit.
// Sorun ISTEMCIDEYDI: acilista /api/auth/me TEK KEZ cagriliyor ve `r.ok` degilse
// sonuc "oturum yok" sayiliyordu. Release sirasinda backend birkac saniye kapali
// oldugu icin o pencerede sayfayi acan herkes, cerezi GECERLI oldugu halde login
// ekranina dusuyordu.
//
// Ayrim sunucuda zaten mevcut:  401 = oturum yok (KESIN),  5xx/ag hatasi = GECICI.
// Bu test o ayrimin korundugunu ve gecici hatalarda yeniden denendigini dogrular.
//
// Fonksiyon KAYNAKTAN cikarilip calistirilir; sleep enjekte edildigi icin test
// gercek zamanda beklemez.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'contexts', 'sessionRestore.ts');

function loadFn(timers = { setTimeout, clearTimeout }) {
  // Gercek TS modulunu derle: timeout govdesi ve yardimcilari regex ile kaybolmasin.
  const ts = require('typescript');
  const js = ts.transpileModule(fs.readFileSync(SRC, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('exports', 'setTimeout', 'clearTimeout', js)(
    exports,
    timers.setTimeout,
    timers.clearTimeout,
  );
  return exports.fetchSessionWithRetry;
}

const fetchSessionWithRetry = loadFn();

const noSleep = () => Promise.resolve();
const res = (status, body) => ({ status, json: async () => body });

test('200 -> oturum doner, TEK istek yeter', async () => {
  let calls = 0;
  const out = await fetchSessionWithRetry({
    fetchFn: async () => {
      calls++;
      return res(200, { ok: true, user: { username: 'x', role: 'User' } });
    },
    sleep: noSleep,
  });
  assert.strictEqual(calls, 1);
  assert.strictEqual(out.user.username, 'x');
});

test('401 KESINDIR: yeniden DENENMEZ (gercekten cikmis kullanici bekletilmez)', async () => {
  let calls = 0;
  const out = await fetchSessionWithRetry({
    fetchFn: async () => {
      calls++;
      return res(401, { ok: false });
    },
    sleep: noSleep,
  });
  assert.strictEqual(out, null);
  assert.strictEqual(calls, 1, '401 icin tek istek atilmali');
});

test('403/400 gibi diger 4xx de kesin sayilir', async () => {
  for (const st of [400, 403, 404]) {
    let calls = 0;
    const out = await fetchSessionWithRetry({
      fetchFn: async () => {
        calls++;
        return res(st, {});
      },
      sleep: noSleep,
    });
    assert.strictEqual(out, null, String(st));
    assert.strictEqual(calls, 1, String(st));
  }
});

test('AG HATASI gecicidir: yeniden denenir ve sunucu gelince oturum KURTARILIR', async () => {
  // Release senaryosu: ilk 3 istek backend kapali oldugu icin patlar, sonra acilir.
  let calls = 0;
  const out = await fetchSessionWithRetry({
    fetchFn: async () => {
      calls++;
      if (calls <= 3) throw new Error('ECONNREFUSED');
      return res(200, { ok: true, user: { username: 'onur', role: 'Admin' } });
    },
    sleep: noSleep,
  });
  assert.strictEqual(calls, 4);
  assert.strictEqual(out.user.username, 'onur', 'oturum login ekranina dusmeden kurtarilmali');
});

test('502/503 de gecicidir (nginx ayakta, backend restart ediyor)', async () => {
  let calls = 0;
  const out = await fetchSessionWithRetry({
    fetchFn: async () => {
      calls++;
      return calls <= 2
        ? res(502, {})
        : res(200, { ok: true, user: { username: 'y', role: 'User' } });
    },
    sleep: noSleep,
  });
  assert.strictEqual(calls, 3);
  assert.strictEqual(out.user.username, 'y');
});

test('sunucu hic gelmezse SINIRLI sayida denenir ve pes edilir', async () => {
  let calls = 0,
    gaveUp = 0;
  const out = await fetchSessionWithRetry({
    fetchFn: async () => {
      calls++;
      throw new Error('down');
    },
    sleep: noSleep,
    delays: [1, 1, 1],
    onGiveUp: () => {
      gaveUp++;
    },
  });
  assert.strictEqual(out, null);
  assert.strictEqual(calls, 4, 'ilk deneme + 3 tekrar');
  assert.strictEqual(gaveUp, 1, 'gecici hatada pes edildigi RAPORLANMALI');
});

test('iptal edilirse (unmount) denemeye devam edilmez', async () => {
  let calls = 0,
    cancelled = false;
  const out = await fetchSessionWithRetry({
    fetchFn: async () => {
      calls++;
      cancelled = true;
      throw new Error('down');
    },
    sleep: noSleep,
    cancelled: () => cancelled,
    delays: [1, 1, 1, 1, 1],
  });
  assert.strictEqual(out, null);
  assert.strictEqual(calls, 1, 'iptalden sonra yeni istek atilmamali');
});

function clock() {
  const pending = new Map();
  let id = 0;
  return {
    pending,
    setTimeout(fn, ms) {
      pending.set(++id, { fn, ms });
      return id;
    },
    clearTimeout(key) {
      pending.delete(key);
    },
    fire() {
      assert.strictEqual(pending.size, 1, 'denemenin bir timeout timeri olmali');
      const [key, entry] = pending.entries().next().value;
      pending.delete(key);
      entry.fn();
    },
  };
}

for (const phase of ['headers', 'body']) {
  test(
    `yanit ${phase} beklemesi timeout ile biter ve istek iptal edilir`,
    { timeout: 1000 },
    async () => {
      const timers = clock();
      const restore = loadFn(timers);
      let signal,
        gaveUp = 0;
      const never = new Promise(() => {});
      const task = restore({
        fetchFn: async (_, options) => {
          signal = options?.signal;
          return phase === 'headers' ? never : { status: 200, json: () => never };
        },
        delays: [],
        timeoutMs: 10,
        onGiveUp: (attempts) => {
          gaveUp = attempts;
        },
      });
      await Promise.resolve();
      assert.strictEqual(timers.pending.size, 1);
      timers.fire();
      assert.strictEqual(await task, null);
      assert.strictEqual(signal.aborted, true);
      assert.strictEqual(gaveUp, 1);
      assert.strictEqual(timers.pending.size, 0);
    },
  );
}

test('timeout sonrasi yeni signal ile retry oturumu kurtarir', { timeout: 1000 }, async () => {
  const timers = clock();
  const signals = [];
  const task = loadFn(timers)({
    fetchFn: async (_, options) => {
      signals.push(options.signal);
      return signals.length === 1 ? new Promise(() => {}) : res(200, { ok: true });
    },
    sleep: noSleep,
    delays: [0],
  });
  timers.fire();
  assert.strictEqual((await task).ok, true);
  assert.strictEqual(signals.length, 2);
  assert.strictEqual(signals[0].aborted, true);
  assert.strictEqual(signals[1].aborted, false);
  assert.strictEqual(timers.pending.size, 0);
});

test('basari, kesin HTTP hata ve JSON hatasi timer birakmaz', async () => {
  for (const response of [
    res(200, { ok: true }),
    res(401, {}),
    {
      status: 200,
      json: async () => {
        throw new Error('bad json');
      },
    },
  ]) {
    const timers = clock();
    await loadFn(timers)({ fetchFn: async () => response, delays: [] });
    assert.strictEqual(timers.pending.size, 0);
  }
});
