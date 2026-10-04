// server/nginx-migration/__tests__/nginx-migration-new-fleet.test.cjs
//
// URETIM TUZAGI (2026-10-03): "Production Tasimalari > Eski tanimi kaldir" nginx_ops'u
// action=delete, env=prod ile tetikliyordu ve new_fleet GONDERMIYORDU. nginx_ops.yml'in
// GBLABT02 play'i new_fleet acikca 'false' degilse silmeyi YENI PROD SPA filosuna da
// goturur: tasinmis uygulamanin yeni filodaki tanimi da silinirdi (kesinti).
//
// Testler DAVRANISI olcer: gercek Express ucu + GERCEK runner.cjs (template ayarlari, survey,
// launch, ignored_fields, iptal) yerel bir SAHTE AWX'e konusur - runner'a sarmalayici/mock
// TAKILMAZ (2026-10-04: onceki surumde sonra kontrol yalniz test sarmalayicisiyla yesildi,
// uretimde olu koddu). Duzenek: _harness.cjs.
//
//   NF1  extra_vars new_fleet='false' tasir; AWX'e giden launch govdesinde de var
//   NF2  mutlu yol (Prompt on launch acik): launch 1 kez; AWX ignored_fields {} -> 'dogrulandi'
//   NF2b launch yaniti ignored_fields TASIMAZSA -> 'olculemedi' ("dogrulandi" DENMEZ)
//   NF3  survey'de new_fleet yok + prompt kapali -> 409, launch YOK, denetim 'denied'
//   NF4  survey sorusu secenekli ve 'false' secenekte yok -> 409, launch YOK
//   NF5  template okunamadi (AWX 500 / 404) -> 409 OLCULEMEDI, launch YOK
//   NF5b template yaniti ayar ALANLARINI tasimiyor -> 409 OLCULEMEDI ("kapali" DENMEZ)
//   NF6  survey okuma HATASI (403 / bozuk bicim) + prompt kapali -> 409 OLCULEMEDI; "bos survey"
//        SAYILMAZ (V3 bekcisi)
//   NF7  survey'de 'false' kabul eden soru -> launch, via=survey, 'dogrulandi'
//   NF8  AWX new_fleet'i yine de yok sayar -> is HEMEN iptal, 409, denetim fail, damga YOK
//   NF8s ayni yaris SURVEY yolunda (on kontrol via=survey) -> yine iptal (sonra kontrol yola bagli DEGIL)
//   NF9  iptal reddedilir (is calisiyor) -> IPTAL EDILEMEDI + HEMEN iptal + tasima isi uyarisi
//   NF9b iptal reddedilir ama is zaten BITMIS -> tasima isi TETIKLENMIS OLABILIR; "iptal edin" YOK
//   NF9c iptal 405/409 + is durumu OKUNAMADI -> 'unverified': "zaten bitmis" DENMEZ, HEMEN iptal
//   NF9d iptal 405 + durum OKUNDU: bitmisse 'terminal', calisiyorsa 'cancel_failed' (HEMEN iptal)
//   NF10 baska bir degisken yok sayildi -> 'dogrulandi'; denetimde yalniz ADLAR
//   NF11 saf kurallar: soru tipleri, ignoredFields bicimleri, karar sirasi, mesajlar
//   NF12 launch yaniti job id TASIMAZ -> 'no_job_id': iptal gonderilemez, HEMEN iptal edin
//   NF13 survey sorusu DIGER isleri bozuyor (varsayilan false / zorunlu+varsayilansiz) -> silme
//        GECER ama uyari doner (delete-guard + /delete); blok mesaji bu tuzagi soyler
//   RQ1  PROD silme isi oturum kullanicisina atfedilir (requester_*; oturum `mail` tasir)
//   G1   GET /delete-guard: on kontrol sonucu; is BASLATMAZ
//   R1-R4 runner: ham template ayarlari, survey okuyucu, launch ignoredFields (yalniz ad)
//   V5/V6/V6b ekran metni: yanlis vaat yok; "yeni filo korunur" kosullu ve uc yerde
'use strict';

const h = require('./_harness.cjs');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalize } = require('../../util/guard-text.cjs');
const g = require('../new-fleet-guard.cjs');

const { awx, runner, nm } = h;

// Turkce harfleri ASCII'ye katlar: mesaj bicimden bagimsiz karsilastirilir.
const fold = (s) =>
  normalize(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0131/g, 'i')
    .toLowerCase();

before(h.start);
after(h.stop);
beforeEach(h.reset);

const BLOCK = fold("Silme isi yeni filoyu koruyamiyor: nginx_ops template'inde new_fleet survey sorusu");
const TASIMA = fold("Yeni filo tasima isi TETIKLENMIS OLABILIR - AWX'te 'Nginx - Production Migration' islerini kontrol edin");
const auditOf = () => h.audits.find((x) => x.action === 'nginx_prod_migration_delete');

// ── NF1 / NF2 ────────────────────────────────────────────────────────────────
test("NF1 extra_vars new_fleet='false' tasir (saf)", () => {
  const v = nm.buildDeleteExtraVars({ service: 'glomo', inputPath: '/base/', user: h.USERS.ekip });
  assert.equal(v.new_fleet, 'false');
  assert.equal(v.action, 'delete');
  assert.equal(v.env, 'prod');
});

test('NF2 mutlu yol (Prompt on launch acik): launch 1 kez, govdede new_fleet=false; AWX ignored_fields {} -> dogrulandi', async (t) => {
  h.mockConsole(t);
  const r = await h.sil();
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.ok, true);
  assert.equal(h.launches().length, 1, 'is baslatilmali');
  assert.equal(awx.lastLaunch.ev.new_fleet, 'false', "AWX'e giden extra_vars new_fleet='false' tasimali");
  assert.equal(awx.lastLaunch.ev.action, 'delete');
  assert.deepEqual(r.json.newFleetGuard, { via: 'prompt', postCheck: 'dogrulandi' }, 'gercek runner ignored_fields adlarini vermeli');
  assert.equal(h.cancels().length, 0);
  assert.equal(h.deleteStamp().length, 1, 'takip damgasi yazilmali');
  const a = auditOf();
  assert.equal(a.result, 'ok');
  assert.equal(JSON.parse(a.detail).postCheck, 'dogrulandi');
});

test('NF2b launch yaniti ignored_fields TASIMAZSA sonra kontrol OLCULEMEDI ("dogrulandi" DENMEZ)', async (t) => {
  const log = h.mockConsole(t);
  awx.noIgnoredFields = true;
  const r = await h.sil();
  assert.equal(r.status, 200, r.body);
  assert.deepEqual(r.json.newFleetGuard, { via: 'prompt', postCheck: 'olculemedi' });
  assert.equal(JSON.parse(auditOf().detail).postCheck, 'olculemedi');
  assert.ok(log.warn.some((l) => /OLCULEMEDI/.test(l)), 'olculemedi loga yazilmali');
});

// ── NF3 / NF4 / NF5 / NF6 ────────────────────────────────────────────────────
test("NF3 survey'de new_fleet yok + prompt kapali -> 409, launch YOK, denetim denied", async (t) => {
  h.mockConsole(t);
  awx.tpl = { ask_variables_on_launch: false, survey_enabled: true, spec: [{ variable: 'action', type: 'text' }, { variable: 'env', type: 'text' }] };
  const r = await h.sil();
  assert.equal(r.status, 409, r.body);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.code, 'survey_missing_new_fleet');
  assert.equal(r.json.measured, true);
  assert.ok(fold(r.json.message).includes(BLOCK), r.json.message);
  assert.ok(fold(r.json.message).includes('prompt on launch gerekli'));
  assert.equal(h.launches().length, 0, 'is BASLATILMAMALI');
  assert.equal(h.deleteStamp().length, 0);
  assert.equal(h.audits[0].result, 'denied');
});

test("NF4 survey sorusu secenekli ve 'false' secenekte yok -> 409, launch YOK", async (t) => {
  h.mockConsole(t);
  awx.tpl = {
    ask_variables_on_launch: false,
    survey_enabled: true,
    spec: [{ variable: 'action', type: 'text' }, { variable: 'new_fleet', type: 'multiplechoice', choices: 'true\nyes' }],
  };
  let r = await h.sil();
  assert.equal(r.status, 409, r.body);
  assert.equal(r.json.code, 'survey_rejects_false');
  assert.ok(fold(r.json.message).includes(BLOCK));
  assert.ok(fold(r.json.message).includes("'false' seceneklerde yok"), 'neden yazilmali');
  assert.equal(h.launches().length, 0);
  // Prompt on launch acik olsa da: AWX survey dogrulamasini yine uygular -> on kontrol reddeder.
  awx.tpl.ask_variables_on_launch = true;
  r = await h.sil();
  assert.equal(r.status, 409, r.body);
  assert.equal(r.json.code, 'survey_rejects_false');
  assert.equal(h.launches().length, 0);
});

test('NF5 template okunamadi (AWX 500 / 404) -> 409 OLCULEMEDI, launch YOK', async (t) => {
  h.mockConsole(t);
  for (const code of [500, 404]) {
    awx.tplStatus = code;
    const r = await h.sil();
    assert.equal(r.status, 409, r.body);
    assert.equal(r.json.code, 'template_unreadable');
    assert.equal(r.json.measured, false, 'olculemedi "yok" ile karismamali');
    assert.ok(fold(r.json.message).includes('olculemedi'));
    assert.ok(!r.body.includes(h.TOKEN), 'token yanita sizdi');
  }
  assert.equal(h.launches().length, 0);
});

test('NF5b template yaniti ayar alanlarini TASIMIYOR -> 409 OLCULEMEDI ("kapali" DENMEZ), launch YOK', async (t) => {
  h.mockConsole(t);
  for (const omit of [['ask_variables_on_launch'], ['survey_enabled'], ['ask_variables_on_launch', 'survey_enabled']]) {
    awx.tpl = { ask_variables_on_launch: false, survey_enabled: false, spec: [], omit };
    const r = await h.sil();
    assert.equal(r.status, 409, r.body);
    assert.equal(r.json.code, 'template_flags_unmeasured', `omit=${omit}`);
    assert.equal(r.json.measured, false);
    assert.ok(fold(r.json.message).includes('olculemedi'));
    assert.ok(!fold(r.json.message).includes('kapali ve prompt'), 'olculmeyen ayar "kapali" diye raporlandi');
    for (const f of omit) assert.ok(r.json.message.includes(f), `eksik alan adi yazilmali: ${f}`);
  }
  assert.equal(h.launches().length, 0);
});

test("NF6 survey okuma HATASI (403 / bozuk bicim) + prompt kapali -> 409 OLCULEMEDI; 'bos survey' SAYILMAZ", async (t) => {
  h.mockConsole(t);
  // Survey'de new_fleet sorusu VAR ama okunamiyor: "soru yok" (survey_missing_new_fleet) denmemeli.
  awx.tpl = { ask_variables_on_launch: false, survey_enabled: true, spec: [{ variable: 'new_fleet', type: 'text' }] };
  awx.surveyStatus = 403;
  let r = await h.sil();
  assert.equal(r.status, 409, r.body);
  assert.equal(r.json.code, 'survey_unreadable');
  assert.equal(r.json.measured, false);
  assert.ok(fold(r.json.message).includes('olculemedi'));
  assert.ok(!r.body.includes(h.TOKEN), 'AWX hata govdesindeki token yanita sizdi');
  awx.surveyStatus = 0;
  awx.surveyBody = { spec: 'bozuk' };
  r = await h.sil();
  assert.equal(r.status, 409, r.body);
  assert.equal(r.json.code, 'survey_unreadable');
  assert.equal(r.json.measured, false);
  assert.equal(h.launches().length, 0, 'is BASLATILMAMALI');
});

test("NF7 survey'de 'false' kabul eden soru -> launch, via=survey, sonra kontrol dogrulandi", async (t) => {
  h.mockConsole(t);
  awx.tpl = {
    ask_variables_on_launch: false,
    survey_enabled: true,
    spec: [
      ...['action', 'env', 'service', 'input_path', 'email', 'requester_name', 'requester_email', 'requester_username', 'requester_is_fallback'].map(
        (v) => ({ variable: v, type: 'text' }),
      ),
      { variable: 'new_fleet', type: 'multiplechoice', choices: ['true', 'false'] },
    ],
  };
  const r = await h.sil();
  assert.equal(r.status, 200, r.body);
  assert.deepEqual(r.json.newFleetGuard, { via: 'survey', postCheck: 'dogrulandi' });
  assert.equal(h.launches().length, 1);
  assert.equal(awx.lastLaunch.ev.new_fleet, 'false');
});

// ── NF8 / NF9 / NF10: SONRA KONTROL (gercek runner; sarmalayici YOK) ──────────
test('NF8 AWX new_fleet i yine de yok sayar -> is HEMEN iptal, 409, denetim fail, takip damgasi YOK', async (t) => {
  const log = h.mockConsole(t);
  awx.forceIgnore = ['new_fleet']; // on kontrol gecti (prompt acik) ama AWX yine de yok saydi
  const r = await h.sil();
  assert.equal(r.status, 409, r.body);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.code, 'new_fleet_ignored');
  assert.equal(r.json.canceled, true);
  assert.equal(r.json.cancelOutcome, 'canceled');
  assert.equal(h.launches().length, 1);
  assert.equal(h.cancels().length, 1, 'Portal kendi baslattigi isi iptal etmeli');
  assert.equal(h.cancels()[0].yol, `/api/v2/jobs/${h.JOB_ID}/cancel/`);
  assert.equal(awx.jobStatus, 'canceled');
  assert.ok(fold(r.json.message).includes('yok saydi'));
  assert.ok(fold(r.json.message).includes(TASIMA), 'tetiklenmis olabilecek tasima isi icin uyari');
  assert.equal(h.deleteStamp().length, 0, 'iptal edilen is "zamanlandi" diye damgalanmamali');
  const a = auditOf();
  assert.equal(a.result, 'fail');
  const d = JSON.parse(a.detail);
  assert.equal(d.canceled, true);
  assert.deepEqual(d.ignoredFields, ['extra_vars.new_fleet']);
  assert.ok(log.error.some((l) => /YOK SAYDI/.test(l) && /TETIKLENMIS OLABILIR/.test(l)), 'hata loga yazilmali');
});

test('NF8s ayni yaris SURVEY yolunda: on kontrol via=survey gecti, AWX yine de yok saydi -> is iptal, 409', async (t) => {
  h.mockConsole(t);
  awx.tpl = { ask_variables_on_launch: false, survey_enabled: true, spec: [{ variable: 'new_fleet', type: 'text' }], omit: [] };
  awx.forceIgnore = ['new_fleet'];
  const r = await h.sil();
  assert.equal(r.status, 409, r.body);
  assert.equal(r.json.code, 'new_fleet_ignored');
  assert.equal(r.json.cancelOutcome, 'canceled');
  assert.equal(h.launches().length, 1);
  assert.equal(h.cancels().length, 1, 'survey yolunda da Portal isi iptal etmeli');
  assert.equal(h.deleteStamp().length, 0);
});

test('NF9 iptal reddedilir (is calisiyor) -> IPTAL EDILEMEDI + HEMEN iptal + tasima isi uyarisi; token SIZMAZ', async (t) => {
  const log = h.mockConsole(t);
  awx.forceIgnore = ['new_fleet'];
  awx.cancel = '403';
  awx.jobStatus = 'running';
  const r = await h.sil();
  assert.equal(r.status, 409, r.body);
  assert.equal(r.json.canceled, false);
  assert.equal(r.json.cancelOutcome, 'cancel_failed');
  const m = fold(r.json.message);
  assert.ok(m.includes('iptal edilemedi'));
  assert.ok(m.includes('hemen iptal edin'));
  assert.ok(m.includes(TASIMA), 'iptal reddedildiginde de tasima isi uyarisi olmali');
  assert.ok(!r.body.includes(h.TOKEN), 'token HTTP yanitina sizdi');
  assert.ok(!JSON.stringify(h.audits).includes(h.TOKEN), 'token denetime sizdi');
  // Sahte AWX 403 govdesinde Authorization basligini geri yansitir: maskeleme GERCEKTEN calisti mi?
  assert.ok(r.json.message.includes('Bearer ***'), 'AWX hata metni maskelenmeden ya da hic gelmedi');
  const bizim = [...log.warn, ...log.error, ...log.log].filter((l) => l.includes('[nginx-migration]'));
  assert.ok(bizim.length > 0);
  assert.ok(!bizim.some((l) => l.includes(h.TOKEN)), 'token loga sizdi');
  assert.equal(h.deleteStamp().length, 0);
});

test('NF9b iptal reddedilir ama is zaten BITMIS -> tasima isi TETIKLENMIS OLABILIR; bitmis isi "iptal edin" DENMEZ', async (t) => {
  h.mockConsole(t);
  awx.forceIgnore = ['new_fleet'];
  awx.cancel = '403';
  awx.jobStatus = 'successful';
  const r = await h.sil();
  assert.equal(r.status, 409, r.body);
  assert.equal(r.json.canceled, false);
  assert.equal(r.json.cancelOutcome, 'terminal');
  const m = fold(r.json.message);
  assert.ok(m.includes('zaten bitmis'), r.json.message);
  assert.ok(m.includes('successful'));
  assert.ok(m.includes(TASIMA), 'is bittiyse tasima isi buyuk olasilikla tetiklendi: uyari ZORUNLU');
  assert.ok(!m.includes('hemen iptal edin'), 'bitmis bir isi iptal etmesi istenmemeli');
  assert.equal(h.deleteStamp().length, 0);
  assert.equal(auditOf().result, 'fail');
});

test('NF9c iptal 405/409 + is durumu OKUNAMADI (5xx / 404) -> unverified: "zaten bitmis" DENMEZ, HEMEN iptal edin', async (t) => {
  const log = h.mockConsole(t);
  for (const [cancel, jobGet] of [['405', 500], ['409', 404], ['405', 404]]) {
    h.reset();
    awx.forceIgnore = ['new_fleet'];
    awx.cancel = cancel;
    awx.jobGetStatus = jobGet;
    awx.jobStatus = 'running'; // gercekte is hala kosuyor - Portal bunu OLCEMIYOR
    const r = await h.sil();
    const k = `cancel=${cancel} jobGet=${jobGet}`;
    assert.equal(r.status, 409, `${k}: ${r.body}`);
    assert.equal(r.json.code, 'new_fleet_ignored');
    assert.equal(r.json.canceled, false, k);
    assert.equal(r.json.cancelOutcome, 'unverified', k);
    const m = fold(r.json.message);
    assert.ok(!m.includes('zaten bitmis'), `${k}: durum OLCULEMEDI iken "bitmis" dendi: ${r.json.message}`);
    assert.ok(m.includes('hemen iptal edin'), `${k}: is calisiyor olabilir, iptal istenmeli`);
    assert.ok(m.includes('olculemedi'), k);
    assert.ok(m.includes(TASIMA), k);
    assert.ok(!r.body.includes(h.TOKEN), 'token yanita sizdi');
    assert.equal(h.cancels().length, 1, k);
    assert.equal(h.deleteStamp().length, 0, k);
    const d = JSON.parse(auditOf().detail);
    assert.equal(d.cancelOutcome, 'unverified', k);
    assert.equal(d.stateVerified, false, `${k}: denetimde stateVerified:false yazilmali`);
  }
  assert.ok(log.error.some((l) => /unverified/.test(l)), 'sonuc loga yazilmali');
});

test('NF9d iptal 405 + durum OKUNDU: is bitmisse terminal (iptal istenmez), hala kosuyorsa cancel_failed (HEMEN iptal)', async (t) => {
  h.mockConsole(t);
  awx.forceIgnore = ['new_fleet'];
  awx.cancel = '405';
  awx.jobStatus = 'failed';
  let r = await h.sil();
  assert.equal(r.status, 409, r.body);
  assert.equal(r.json.cancelOutcome, 'terminal');
  assert.equal(JSON.parse(auditOf().detail).stateVerified, true);
  let m = fold(r.json.message);
  assert.ok(m.includes('zaten bitmis') && m.includes('failed'), r.json.message);
  assert.ok(!m.includes('hemen iptal edin'));
  h.reset();
  awx.forceIgnore = ['new_fleet'];
  awx.cancel = '405';
  awx.jobStatus = 'running';
  r = await h.sil();
  assert.equal(r.status, 409, r.body);
  assert.equal(r.json.cancelOutcome, 'cancel_failed');
  m = fold(r.json.message);
  assert.ok(m.includes('hemen iptal edin'), r.json.message);
  assert.ok(!m.includes('zaten bitmis'));
});

test('NF10 baska bir degisken yok sayildi -> dogrulandi; denetimde yalniz ADLAR (deger YOK)', async (t) => {
  h.mockConsole(t);
  awx.forceIgnore = ['email'];
  const r = await h.sil();
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.newFleetGuard.postCheck, 'dogrulandi');
  assert.equal(h.cancels().length, 0);
  const d = JSON.parse(auditOf().detail);
  assert.deepEqual(d.ignoredFields, ['extra_vars.email']);
  assert.equal(awx.lastIgnored.extra_vars.email, 'o@x', 'kurgu: AWX degeri dondurdu');
});

// ── NF11: saf kurallar ───────────────────────────────────────────────────────
test('NF11a soru tipleri: AWX dogrulamasiyla ayni', () => {
  const ok = (q) => g.surveyQuestionAcceptsFalse({ variable: 'new_fleet', ...q }).ok;
  assert.equal(ok({ type: 'text' }), true);
  assert.equal(ok({ type: 'textarea', min: 0, max: 5 }), true);
  assert.equal(ok({ type: 'text', max: 4 }), false, "'false' 5 karakter");
  assert.equal(ok({ type: 'text', min: 6 }), false);
  assert.equal(ok({ type: 'multiplechoice', choices: 'true\nfalse' }), true);
  assert.equal(ok({ type: 'multiplechoice', choices: ['true', 'false'] }), true);
  assert.equal(ok({ type: 'multiplechoice', choices: 'true\nFalse' }), false, 'AWX birebir karsilastirir');
  assert.equal(ok({ type: 'multiselect', choices: 'true\nfalse' }), false, 'multiselect liste ister; playbook listeyi false okumaz');
  assert.equal(ok({ type: 'integer' }), false);
  assert.equal(ok({ type: 'float' }), false);
});

test('NF11b ignoredFields (runner adlari): tanimsiz/bicimsiz = OLCULEMEDI (null), bos = false', () => {
  const f = g.ignoredFieldsHasNewFleet;
  assert.equal(f(undefined), null);
  assert.equal(f(null), null);
  assert.equal(f({ extra_vars: { new_fleet: 'false' } }), null, 'ham AWX nesnesi runner bicimi degil: olculemedi');
  assert.equal(f([]), false);
  assert.equal(f(['extra_vars.new_fleet']), true);
  assert.equal(f(['extra_vars.email', 'limit']), false);
  assert.equal(f(['extra_vars.new_fleet_x']), false);
  assert.equal(f(['extra_vars.?']), null, 'adi cikarilamayan yok sayilmis degisken: olculemedi');
  assert.equal(f(['?']), null);
  assert.equal(f(['extra_vars.?', 'extra_vars.new_fleet']), true);
});

test('NF11c karar: ham bayrak yoksa OLCULEMEDI; survey okunamazsa prompt kapaliysa ret; survey kapali + prompt kapali ret', () => {
  const a = g.assessNewFleetGuard;
  assert.equal(a({ template: { surveyEnabled: true, askVariablesOnLaunch: false }, survey: { measured: false, error: 'x' } }).code, 'survey_unreadable');
  assert.equal(a({ template: { surveyEnabled: true, askVariablesOnLaunch: false }, survey: { measured: false, error: 'x' } }).measured, false);
  assert.equal(a({ template: { surveyEnabled: false, askVariablesOnLaunch: false } }).code, 'no_survey_no_prompt');
  assert.equal(a({ template: { surveyEnabled: false, askVariablesOnLaunch: true } }).ok, true);
  // Prompt acikken survey okunamasa da guvenli: AWX ya degiskeni gecirir ya da 400 ile reddeder.
  assert.deepEqual(a({ template: { surveyEnabled: true, askVariablesOnLaunch: true }, survey: { measured: false, error: 'x' } }), { ok: true, via: 'prompt' });
  const u = a({ template: { surveyEnabled: false } });
  assert.equal(u.ok, false);
  assert.equal(u.code, 'template_flags_unmeasured', 'prompt bilinmiyorsa (undefined) ACIK ya da KAPALI sayilmaz');
  assert.equal(u.measured, false);
  const r = a({ template: null, templateError: 'AWX HTTP 500' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(r.measured, false);
  assert.equal(r.code, 'template_unreadable');
});

test('NF11d sonra kontrol mesaji: tasima isi uyarisi HER sonucta; "iptal edin" yalniz is calisiyor olabilirken', () => {
  const W = fold(g.MIGRATION_JOB_WARNING);
  for (const outcome of /** @type {const} */ (['canceled', 'terminal', 'cancel_failed', 'no_job_id', 'unknown'])) {
    const m = fold(g.ignoredMessage({ jobId: 7, outcome, awxStatus: 'successful', error: 'x' }));
    assert.ok(m.includes(W), `${outcome}: tasima isi uyarisi yok`);
    assert.ok(m.includes(fold(g.NEW_FLEET_BLOCK_MESSAGE)), `${outcome}: ne gerektigi yazilmali`);
    const iptalEdin = m.includes('hemen iptal edin');
    assert.equal(iptalEdin, ['cancel_failed', 'no_job_id', 'unknown', 'unverified'].includes(outcome), `${outcome}: "iptal edin" yanlis yerde`);
  }
  // 'unverified': durum OLCULEMEDI - "bitti" ile karismaz.
  const u = fold(g.ignoredMessage({ jobId: 7, outcome: 'unverified', error: 'AWX HTTP 500' }));
  assert.ok(!u.includes('zaten bitmis'), u);
  assert.ok(u.includes('olculemedi'));
  assert.ok(u.includes('awx http 500'), 'durum okuma hatasi yazilmali');
});

// ── NF12: launch job id dondurmezse ──────────────────────────────────────────
test('NF12 launch yaniti job id TASIMAZ + new_fleet yok sayildi -> no_job_id: iptal GONDERILMEZ, HEMEN iptal edin', async (t) => {
  h.mockConsole(t);
  awx.forceIgnore = ['new_fleet'];
  awx.launchNoId = true;
  const r = await h.sil();
  assert.equal(r.status, 409, r.body);
  assert.equal(r.json.code, 'new_fleet_ignored');
  assert.equal(r.json.cancelOutcome, 'no_job_id');
  assert.equal(h.cancels().length, 0, 'job id yokken iptal istegi gonderilemez');
  const m = fold(r.json.message);
  assert.ok(m.includes('hemen iptal edin'));
  assert.ok(m.includes(TASIMA));
});

// ── NF13: survey sorusu DIGER isleri bozuyor mu (varsayilan / zorunluluk) ────
const SV = (q) => ({ ask_variables_on_launch: false, survey_enabled: true, spec: [{ variable: 'new_fleet', type: 'text', ...q }], omit: [] });
const UYARI_FALSE = fold('new_fleet göndermeyen diğer tüm prod nginx_ops işleri');
const UYARI_ZORUNLU = fold('ZORUNLU ve varsayılanı yok');

test("NF13a survey varsayilani 'false' -> silme GECER ama uyari doner (delete-guard + /delete + denetim)", async (t) => {
  const log = h.mockConsole(t);
  awx.tpl = SV({ default: 'false' });
  const gd = await h.call('GET', '/api/nginx-migration/delete-guard');
  assert.equal(gd.status, 200, gd.body);
  assert.equal(gd.json.guard.ok, true, 'silme bloklanmamali: Portal false u acikca gonderir');
  assert.ok(fold(gd.json.guard.warning || '').includes(UYARI_FALSE), gd.body);
  const r = await h.sil();
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.newFleetGuard.via, 'survey');
  assert.ok(fold(r.json.newFleetGuard.warning || '').includes(UYARI_FALSE), r.body);
  assert.equal(h.launches().length, 1);
  assert.ok(JSON.parse(auditOf().detail).surveyWarning, 'uyari denetime yazilmali');
  assert.ok(log.warn.some((l) => /varsayilan\/zorunluluk/.test(l)));
});

test('NF13b zorunlu + varsayilansiz soru -> uyari; varsayilan bos/true ve zorunlu degil -> uyari YOK', async (t) => {
  h.mockConsole(t);
  awx.tpl = SV({ required: true, default: '' });
  let gd = await h.call('GET', '/api/nginx-migration/delete-guard');
  assert.equal(gd.json.guard.ok, true);
  assert.ok(fold(gd.json.guard.warning || '').includes(UYARI_ZORUNLU), gd.body);
  for (const q of [{ required: false, default: '' }, { required: false, default: 'true' }, { required: true, default: 'true' }, {}]) {
    awx.tpl = SV(q);
    gd = await h.call('GET', '/api/nginx-migration/delete-guard');
    assert.deepEqual(gd.json.guard, { ok: true, via: 'survey' }, `uyari olmamali: ${JSON.stringify(q)}`);
  }
  const r = await h.sil();
  assert.equal(r.status, 200, r.body);
  assert.deepEqual(r.json.newFleetGuard, { via: 'survey', postCheck: 'dogrulandi' });
});

test('NF13c saf: varsayilan playbook gibi trim+lower okunur; blok mesaji varsayilan/zorunluluk tuzagini soyler', () => {
  const w = g.surveyQuestionSideEffects;
  for (const d of ['false', ' False ', 'NO', '0', false, 0]) assert.ok(fold(w({ default: d })).includes(UYARI_FALSE), `default=${JSON.stringify(d)}`);
  for (const d of ['', 'true', 'yes', '1', null, undefined]) assert.equal(w({ default: d }), '', `default=${JSON.stringify(d)}`);
  assert.ok(fold(w({ required: true })).includes(UYARI_ZORUNLU));
  assert.ok(fold(w({ required: true, default: '  ' })).includes(UYARI_ZORUNLU));
  assert.equal(w({ required: true, default: 'true' }), '');
  const a = g.assessNewFleetGuard({ template: { askVariablesOnLaunch: true, surveyEnabled: true }, survey: { measured: true, spec: [{ variable: 'new_fleet', type: 'multiplechoice', choices: ['true', 'false'], default: 'false' }] } });
  assert.equal(a.ok, true);
  assert.ok(fold(a.warning).includes(UYARI_FALSE), 'prompt acik olsa da survey varsayilani diger islere gider');
  const B = fold(g.NEW_FLEET_BLOCK_MESSAGE);
  assert.ok(B.includes('zorunlu olmamali'), 'yonetici yonergesi zorunluluk tuzagini soylemeli');
  assert.ok(B.includes('varsayilani bos ya da true olmali'), 'yonetici yonergesi varsayilan tuzagini soylemeli');
});

// ── RQ1: talep eden dogru atfedilir ──────────────────────────────────────────
test('RQ1 PROD silme ve tanim isi OTURUM KULLANICISINA atfedilir (oturum mail tasir, email TASIMAZ)', async (t) => {
  h.mockConsole(t);
  assert.equal(h.USERS.ekip.email, undefined, 'kurgu: oturum nesnesi gercek sekliyle (mail)');
  for (const { ad, cagir } of [
    { ad: 'silme', cagir: () => h.sil() },
    { ad: 'tanim', cagir: () => h.call('POST', '/api/nginx-migration/create', { ...h.BODY, inputPath: '/yeni/' }) },
  ]) {
    h.reset();
    const r = await cagir();
    assert.equal(r.status, 200, `${ad}: ${r.body}`);
    const ev = awx.lastLaunch.ev;
    assert.equal(ev.requester_username, 'odemir', `${ad}: is 'bilinmiyor'a atfedildi`);
    assert.equal(ev.requester_is_fallback, false, `${ad}: varsayilana dusuldu`);
    assert.equal(ev.requester_email, 'o@x', ad);
    assert.equal(ev.requester_name, 'Onur Test', ad);
    if (ad === 'silme') assert.equal(ev.email, 'o@x', "survey 'email' (23:00 isinin requester_email'i) bos gitmemeli");
  }
});

// ── G1: ekran icin on kontrol ucu ────────────────────────────────────────────
test('G1 GET /delete-guard: on kontrol sonucunu doner, is BASLATMAZ', async (t) => {
  h.mockConsole(t);
  let r = await h.call('GET', '/api/nginx-migration/delete-guard');
  assert.equal(r.status, 200, r.body);
  assert.deepEqual(r.json.guard, { ok: true, via: 'prompt' });
  awx.tpl = { ask_variables_on_launch: false, survey_enabled: true, spec: [{ variable: 'action', type: 'text' }] };
  r = await h.call('GET', '/api/nginx-migration/delete-guard');
  assert.equal(r.status, 200, r.body);
  assert.equal(r.json.guard.ok, false);
  assert.equal(r.json.guard.code, 'survey_missing_new_fleet');
  assert.equal(r.json.guard.measured, true);
  assert.ok(fold(r.json.guard.message).includes(BLOCK), 'neden yazilmali');
  awx.tplStatus = 500;
  r = await h.call('GET', '/api/nginx-migration/delete-guard');
  assert.equal(r.json.guard.ok, false);
  assert.equal(r.json.guard.measured, false, 'okunamadi = OLCULEMEDI');
  assert.equal(h.launches().length, 0, 'on kontrol ucu is BASLATMAMALI');
  assert.equal(h.audits.length, 0);
});

// ── R1-R4: runner (gercek, sahte AWX'e) ──────────────────────────────────────
test('R1 runner.getTemplateLaunchSettingsOnServer: HAM bayraklar; alan yoksa undefined (false DEGIL)', async () => {
  awx.tpl = { ask_variables_on_launch: false, survey_enabled: true, spec: [], omit: [] };
  let s = await runner.getTemplateLaunchSettingsOnServer(1, h.DELETE_TPL);
  assert.deepEqual(s, { id: h.DELETE_TPL, name: 'Nginx Reverse Proxy Operations', askVariablesOnLaunch: false, surveyEnabled: true });
  awx.tpl.omit = ['ask_variables_on_launch', 'survey_enabled'];
  s = await runner.getTemplateLaunchSettingsOnServer(1, h.DELETE_TPL);
  assert.equal(s.askVariablesOnLaunch, undefined);
  assert.equal(s.surveyEnabled, undefined);
  awx.tplStatus = 403;
  await assert.rejects(runner.getTemplateLaunchSettingsOnServer(1, h.DELETE_TPL), (e) => /** @type {any} */ (e).status === 403);
});

test('R2 runner.getSurveySpecOnServer: {} -> bos; hata FIRLATIR (yutmaz); bozuk bicim -> hata', async () => {
  awx.tpl = { ask_variables_on_launch: false, survey_enabled: false, spec: [] };
  assert.deepEqual(await runner.getSurveySpecOnServer(1, h.DELETE_TPL), { spec: [] });
  awx.tpl = { ask_variables_on_launch: false, survey_enabled: true, spec: [{ variable: 'new_fleet', type: 'text' }] };
  assert.deepEqual(await runner.getSurveySpecOnServer(1, h.DELETE_TPL), { spec: [{ variable: 'new_fleet', type: 'text' }] });
  awx.surveyStatus = 403;
  await assert.rejects(runner.getSurveySpecOnServer(1, h.DELETE_TPL), (e) => /** @type {any} */ (e).status === 403);
  awx.surveyStatus = 0;
  awx.surveyBody = { spec: 'bozuk' };
  await assert.rejects(runner.getSurveySpecOnServer(1, h.DELETE_TPL));
});

test('R3 runner.launchJobOnServer: ignored_fields yalniz ADLARLA doner; alan yoksa anahtar YOK (eski cagiranlar degismez)', async (t) => {
  h.mockConsole(t);
  const GIZLI = 'GIZLI-DEGER-5fd2c1';
  awx.tpl = { ask_variables_on_launch: false, survey_enabled: true, spec: [{ variable: 'a', type: 'text' }] };
  const out = await runner.launchJobOnServer(1, h.DELETE_TPL, { a: '1', parola: GIZLI }, '', h.USERS.ekip);
  assert.equal(out.jobId, h.JOB_ID);
  assert.ok(out.ignoredFields.includes('extra_vars.parola'), JSON.stringify(out));
  assert.ok(!JSON.stringify(out).includes(GIZLI), 'yok sayilan degiskenin DEGERI disari sizdi');
  assert.equal(awx.lastIgnored.extra_vars.parola, GIZLI, 'kurgu: AWX degeri dondurdu');
  awx.noIgnoredFields = true;
  const eski = await runner.launchJobOnServer(1, h.DELETE_TPL, { a: '1' }, '', h.USERS.ekip);
  assert.deepEqual(eski, { jobId: h.JOB_ID, status: 'pending' }, 'ignored_fields yoksa donus sekli ESKISIYLE ayni');
});

test('R4 runner._ignoredFieldNames bicimleri', () => {
  const f = runner._ignoredFieldNames;
  assert.deepEqual(f({}), []);
  assert.deepEqual(f(null), []);
  assert.deepEqual(f({ extra_vars: { new_fleet: 'false', x: 1 }, limit: 'h1' }), ['extra_vars.new_fleet', 'extra_vars.x', 'limit']);
  assert.deepEqual(f({ extra_vars: '{"new_fleet": "false"}' }), ['extra_vars.new_fleet']);
  assert.deepEqual(f({ extra_vars: 'new_fleet: false\naction: delete\n  ic: 1' }), ['extra_vars.new_fleet', 'extra_vars.action']);
  assert.deepEqual(f({ extra_vars: '%%%' }), ['extra_vars.?']);
  assert.deepEqual(f('{"extra_vars": {"new_fleet": "false"}}'), ['extra_vars.new_fleet']);
  assert.deepEqual(f('bozuk'), ['?']);
  assert.deepEqual(f([1]), ['?']);
});

// ── V5 / V6 / V6b: EKRAN METNI (kaynak; bicimden bagimsiz) ───────────────────
// Satir basi // yorumlari atilir: bekci EKRANA giden metni olcer, gecmisi anlatan yorumu degil.
const UI = normalize(
  fs
    .readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'denetim', 'NginxProdMigration.tsx'), 'utf8')
    .replace(/^[ \t]*\/\/.*$/gm, ''),
);

test('V5 eski KOSULSUZ vaat ("Yeni sunuculara dokunulmaz") ekranda YOK', () => {
  assert.ok(!/Yeni sunuculara\s+dokunulmaz/i.test(UI), 'yanlis vaat geri geldi');
  assert.ok(UI.includes("const NEW_FLEET_KEPT = 'Yalnız ESKİ sunuculardan kaldırır; yeni filo korunur.';"), 'vaat metni degisti');
});

test('V6 "yeni filo korunur": basari mesajinda ve dugme ipucunda; olculemediyse basari mesaji bunu soyler', () => {
  assert.ok(UI.includes("Eski sunucular: ${(r.oldHosts || []).join(', ')}. ${NEW_FLEET_KEPT}"), 'basari mesajinda yok');
  assert.ok(UI.includes("r.newFleetGuard?.postCheck === 'olculemedi' ?"), 'sonra kontrol olculemediyse basari mesaji bunu soylemeli');
  assert.ok(UI.includes("kaldır — 23:00'e zamanlanır. ${NEW_FLEET_KEPT} Portal, AWX'in bunu kabul ettiğini doğrulayamazsa işi başlatmaz.`"), 'dugme ipucunda yok ya da kosulsuz');
});

test('V6b onay penceresi: vaat YALNIZ on kontrol gecerse; gecmezse NEDENI; red mesaji nedeniyle; korunamiyorsa onay kapali', () => {
  assert.ok(UI.includes("{delGuard?.state === 'ok' && ( <Note tone='info' title={NEW_FLEET_KEPT}>"), 'vaat kosullu degil');
  assert.equal(UI.split('title={NEW_FLEET_KEPT}').length, 2, 'vaat basligi tek yerde (ok dalinda) olmali');
  assert.ok(UI.includes("{delGuard?.state === 'blocked' && ( <Note tone='danger' title={NEW_FLEET_BLOCKED}>"), 'korunamiyorsa uyari yok');
  assert.ok(UI.includes("{delGuard.measured === false && <b>Durum ÖLÇÜLEMEDİ (yok demek değil). </b>} {delGuard.message}"), 'neden/olculemedi gosterilmiyor');
  assert.ok(UI.includes("disabled={busy || delGuard?.state === 'blocked' || delGuard?.state === 'loading'}"), 'korunamiyorsa onay dugmesi kapanmali');
  assert.ok(UI.includes("} else setResult({ tone: 'bad', text: deleteRefusalText(r) });"), 'silme reddi nedeniyle gosterilmeli');
  assert.ok(UI.includes("const r = await nginxMigrationApi.deleteGuard();"), 'on kontrol okunmuyor');
});
