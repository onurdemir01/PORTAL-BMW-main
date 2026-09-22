// server/ansible/__tests__/survey-required-defaults.test.cjs — "AWX HTTP 400: survey'inde zorunlu
// alan(lar) eksik: 'tbmwans_pwd' value missing" (2026-09-22, uretim).
//
// Portal'in kendi baslattigi isler (Nginx CIS "Skoru tazele", Server Hub "Simdi tara", Retirement,
// Nginx Hub dokumu) extra_vars'i KODDA kurar; AWX survey'inde ZORUNLU olan ama bu listede olmayan
// bir alan varsa (tipik olarak tbmwans_pwd parolasi) AWX launch'i reddeder — alan survey'de
// TANIMLI ve varsayilani olsa bile. Cozum: launch'tan once survey_spec okunur ve yalniz EKSIK
// zorunlu alanlar template'in KENDI varsayilaniyla tamamlanir. Parola alanlarinda AWX varsayilani
// "$encrypted$" doner; aynen geri gonderilir, parola Portal'a hic inmez.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'runner.cjs'), 'utf8');

/** runner.cjs'ten fillRequiredSurveyDefaults'i izole calistir (AWX cagrisini taklit ederek). */
function loadFn(specFields, { throws = null } = {}) {
  const body = SRC.slice(SRC.indexOf('async function fillRequiredSurveyDefaults'), SRC.indexOf('async function launchJobOnServer'));
  const calls = [];
  const awxRequestToServer = async (_s, _t, method, p) => {
    calls.push([method, p]);
    if (throws) throw throws;
    return { spec: specFields };
  };
  const console_ = { log: () => {}, warn: () => {} };
  // eslint-disable-next-line no-new-func
  const factory = new Function('awxRequestToServer', 'console', `${body}; return fillRequiredSurveyDefaults;`);
  return { fn: factory(awxRequestToServer, console_), calls };
}

const F = (variable, required, def, type = 'text') => ({ variable, required, default: def, type, question_name: variable });

test('SR1 eksik ZORUNLU alan template varsayilaniyla tamamlanir; parola $encrypted$ olarak gider', async () => {
  const { fn } = loadFn([F('tbmwans_pwd', true, '$encrypted$', 'password'), F('target_hosts', false, '')]);
  const out = await fn({}, 't', 42, { target_hosts: 'GBNGXP40' });
  assert.deepEqual(out, { target_hosts: 'GBNGXP40', tbmwans_pwd: '$encrypted$' });
});

test('SR2 kullanicinin/isin gonderdigi deger ASLA ezilmez', async () => {
  const { fn } = loadFn([F('tbmwans_pwd', true, '$encrypted$', 'password'), F('mode', true, 'report')]);
  const out = await fn({}, 't', 42, { mode: 'apply', tbmwans_pwd: 'acikparola' });
  assert.equal(out.mode, 'apply', 'gonderilen deger korunmali');
  assert.equal(out.tbmwans_pwd, 'acikparola');
});

test('SR3 zorunlu OLMAYAN alan ve varsayilani OLMAYAN zorunlu alan doldurulmaz', async () => {
  const { fn } = loadFn([F('opsiyonel', false, 'x'), F('zorunlu_bos', true, ''), F('zorunlu_null', true, null)]);
  const out = await fn({}, 't', 42, { a: 1 });
  assert.deepEqual(out, { a: 1 }, 'AWX kendi hata mesajini versin: hangi alan eksik orada yazar');
});

test('SR4 bos string gonderilmis zorunlu alan da varsayilanla doldurulur', async () => {
  const { fn } = loadFn([F('tbmwans_pwd', true, '$encrypted$', 'password')]);
  const out = await fn({}, 't', 42, { tbmwans_pwd: '' });
  assert.equal(out.tbmwans_pwd, '$encrypted$');
});

test('SR5 survey yoksa (404) ya da AWX okunamazsa launch ENGELLENMEZ (fail-open)', async () => {
  const { fn: f404 } = loadFn([], { throws: Object.assign(new Error('not found'), { status: 404 }) });
  assert.deepEqual(await f404({}, 't', 42, { a: 1 }), { a: 1 });
  const { fn: fErr } = loadFn([], { throws: Object.assign(new Error('AWX erisilemiyor'), { status: 500 }) });
  assert.deepEqual(await fErr({}, 't', 42, { a: 1 }), { a: 1 });
  const { fn: fEmpty } = loadFn([]);
  assert.deepEqual(await fEmpty({}, 't', 42, { a: 1 }), { a: 1 });
});

test('SR6 launchJobOnServer bu tamamlamayi GERCEKTEN cagiriyor (payload kurulmadan once)', () => {
  const launch = SRC.slice(SRC.indexOf('async function launchJobOnServer'), SRC.indexOf('async function getJobStatusOnServer'));
  const iFill = launch.indexOf('fillRequiredSurveyDefaults(');
  const iPayload = launch.indexOf('const payload = {');
  assert.ok(iFill > 0, 'launch survey varsayilanlarini doldurmali');
  assert.ok(iFill < iPayload, 'tamamlama payload kurulmadan ONCE olmali');
  assert.ok(/withRequesterVars\(withDefaults, requester\)/.test(launch), 'tamamlanmis vars requester bilgisiyle birlesmeli');
});
