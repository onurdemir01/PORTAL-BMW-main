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

function loadFn() {
  const src = fs.readFileSync(SRC, 'utf-8');
  const start = src.indexOf('export async function fetchSessionWithRetry');
  if (start < 0) throw new Error('fetchSessionWithRetry bulunamadi (tasinmis olabilir)');
  // Govde parantezi IMZA SATIRININ SONUNDAKI '{' - `= {}` gibi varsayilan parametreler
  // ilk '{' oldugu icin naif arama fonksiyonu bir satirda "kapatiyor" sanip bozuk kod
  // cikariyordu (ilk yazimda tam bunu yaptim, test "Unexpected token 'return'" verdi).
  const sigEnd = src.indexOf(String.fromCharCode(10), start);
  let depth = 0, end = -1;
  for (let k = src.lastIndexOf('{', sigEnd); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
  }
  const constStart = src.indexOf('const DEFAULT_DELAYS');
  const constLine = src.slice(constStart, src.indexOf('\n', constStart) + 1);
  // TS tip notasyonlarini soy.
  const body = src.slice(start, end)
    .replace(/^export\s+/, '')
    .replace(/:\s*SessionRestoreDeps\s*=\s*\{\}/, ' = {}')
    .replace(/:\s*Promise<MeResponse \| null>/, '')
    .replace(/\(u:\s*string\)/g, '(u)')
    .replace(/\(ms:\s*number\)/g, '(ms)')
    .replace(/new Promise<void>/g, 'new Promise')
    .replace(/\s+as MeResponse/g, '');
  // eslint-disable-next-line no-new-func
  return new Function(constLine + body + '\nreturn fetchSessionWithRetry;')();
}

const fetchSessionWithRetry = loadFn();

const noSleep = () => Promise.resolve();
const res = (status, body) => ({ status, json: async () => body });

test('200 -> oturum doner, TEK istek yeter', async () => {
  let calls = 0;
  const out = await fetchSessionWithRetry({
    fetchFn: async () => { calls++; return res(200, { ok: true, user: { username: 'x', role: 'User' } }); },
    sleep: noSleep,
  });
  assert.strictEqual(calls, 1);
  assert.strictEqual(out.user.username, 'x');
});

test('401 KESINDIR: yeniden DENENMEZ (gercekten cikmis kullanici bekletilmez)', async () => {
  let calls = 0;
  const out = await fetchSessionWithRetry({
    fetchFn: async () => { calls++; return res(401, { ok: false }); },
    sleep: noSleep,
  });
  assert.strictEqual(out, null);
  assert.strictEqual(calls, 1, '401 icin tek istek atilmali');
});

test('403/400 gibi diger 4xx de kesin sayilir', async () => {
  for (const st of [400, 403, 404]) {
    let calls = 0;
    const out = await fetchSessionWithRetry({
      fetchFn: async () => { calls++; return res(st, {}); }, sleep: noSleep,
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
    fetchFn: async () => { calls++; return calls <= 2 ? res(502, {}) : res(200, { ok: true, user: { username: 'y', role: 'User' } }); },
    sleep: noSleep,
  });
  assert.strictEqual(calls, 3);
  assert.strictEqual(out.user.username, 'y');
});

test('sunucu hic gelmezse SINIRLI sayida denenir ve pes edilir', async () => {
  let calls = 0, gaveUp = 0;
  const out = await fetchSessionWithRetry({
    fetchFn: async () => { calls++; throw new Error('down'); },
    sleep: noSleep,
    delays: [1, 1, 1],
    onGiveUp: () => { gaveUp++; },
  });
  assert.strictEqual(out, null);
  assert.strictEqual(calls, 4, 'ilk deneme + 3 tekrar');
  assert.strictEqual(gaveUp, 1, 'gecici hatada pes edildigi RAPORLANMALI');
});

test('iptal edilirse (unmount) denemeye devam edilmez', async () => {
  let calls = 0, cancelled = false;
  const out = await fetchSessionWithRetry({
    fetchFn: async () => { calls++; cancelled = true; throw new Error('down'); },
    sleep: noSleep,
    cancelled: () => cancelled,
    delays: [1, 1, 1, 1, 1],
  });
  assert.strictEqual(out, null);
  assert.strictEqual(calls, 1, 'iptalden sonra yeni istek atilmamali');
});
