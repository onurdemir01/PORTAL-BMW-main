// server/selfservice/__tests__/api-generator-secim.test.cjs - Self Servis > Nginx API Generator: rate limit
// icin API SECIMI (2026-10-22).
//
// Kullanici: "rate limit degistirmeye tikladiklarinda ilgili API'yi elle degil oradan drop down menuden
// secerek girmelerini rica ediyorum." API kapatma / acma (selected_api, active_api, deactive_api) statik
// survey listesidir, DOKUNULMAZ.
//
// Kilitler:
//   AG1 api_generator sablonunda chosen_api KODLA envanter listesine baglanir; yalniz rate_limit_change / read
//   AG2 KOD KAZANIR: DB'deki farkli / bos kaynak, hidden, kosul yok sayilir; DB etiketi korunur
//   AG3 baska sablonda girdi AYNEN (ayni nesne); girdi hicbir durumda degistirilmez (dondurulmus nesne)
//   AG4 diger alan ayarlari (selected_api ...) oldugu gibi kalir
//   AG5 runner: survey ekrani, sablon detayi ve launch AYNI etkin ayarlari kullanir
//   AG6 runner (GERCEK fonksiyonlar kaynaktan): mapSurveySpec kosulu / zorunlulugu / kodlaBagli'yi istemciye
//       verir; resolveLaunchExtraVars kosulu saglanmayan alani dogrulamaz ve GONDERMEZ, etkinken bos ise 400
//   AG7 AWX'te zorunlu ve varsayilansiz alan kosulla gizlenmez (AWX launch'i reddederdi)
//   AG8 secenek kaynagi: yalniz job'in o ortam / site sunuculari, yalniz izinli domain onekli konfigurasyon
//       adlari ('.conf' atilmis), etiket ornek yol + mevcut limitler + kapsam, eksik sunuculu API ayri grupta
//   AG9 (depo verilirse) host listeleri, izinli domainler VE kanal kumeleri api_generator deposuyla AYNI
//   AG10 Survey Tasarimcisi alani da kodla bagli (gercek resolveCustomSurveyExtraVars)
//   AG11 secimin ayrintisi (SAF): ayni zone'u paylasan uclar, kok, baska konfigurasyon; zone bilgisi yoksa durust
//   AG12 ayrinti yalniz listedeki degere; sinirli onbellek
//   AG13 prod'da kanal bos / taninmiyorsa liste, ayrinti ve launch 400 (job da kanalsiz durur)
//   AG14 ayrinti rotasi ayni korumada; panel secimin saginda
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ag = require('../api-generator-secim.cjs');
const cs = require('../../ansible/choice-sources.cjs');
const { apiGeneratorHosts, API_CLUSTERS } = require('../../../shared/nginxApiClusters.cjs');
const surveyConditions = require('../../../shared/surveyConditions.cjs');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'ansible', 'runner.cjs'), 'utf8');
const DETAY = { playbook: 'bmw_nginx/api_generator/api_generator.yaml' };
const BASKA = { playbook: 'bmw_nginx/nginx_ops/nginx_ops.yml' };

function derinDondur(o) {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    for (const v of Object.values(o)) derinDondur(v);
  }
  return o;
}

test('AG1 api_generator: chosen_api envanter listesine bagli, yalniz rate_limit_change / read', () => {
  const ov = ag.etkinOverrides(DETAY, { fieldOverrides: [] });
  const c = ov.fieldOverrides.find((o) => o.fieldName === 'chosen_api');
  assert.ok(c, 'chosen_api ayari yok');
  assert.equal(c.choicesSource.source, 'nginx-api-gateway-confs');
  assert.deepEqual(c.choicesSource.params, { env: 'env', site: 'site', channel: 'channel', islem: 'op_selection' });
  assert.deepEqual(c.choicesSource.optional, ['site', 'channel', 'islem']);
  assert.equal(c.choicesSource.details, true, 'secimin ayrintisi (birlikte etkilenecek uclar) acik degil');
  assert.equal(typeof cs.getSource(c.choicesSource.source).details, 'function');
  assert.equal(c.hidden, false);
  assert.equal(c.requiredWhenActive, true);
  assert.equal(c.kodlaBagli, true);
  for (const [op, gorunur] of [['rate_limit_change', true], ['read', true], ['activate', false], ['deactivate', false],
    ['create', false], ['delete', false], ['', false], ['RATE_LIMIT_CHANGE', false]]) {
    assert.equal(surveyConditions.isFieldActive(c.dependsOn, { op_selection: op }), gorunur, op);
  }
  assert.ok(cs.getSource(c.choicesSource.source), 'kaynak kayitli degil');
  for (const yol of ['bmw_nginx/api_generator/api_generator.yml', 'api_generator/api_generator.yaml', 'x/API_GENERATOR/API_GENERATOR.YAML'])
    assert.ok(ag.apiGeneratorMi({ playbook: yol }), yol);
  for (const yol of ['bmw_nginx/api_generator/location_limit_backfill.yml', 'bmw_nginx/api_expose/api_expose.yaml', '', 'api_generator.yaml'])
    assert.ok(!ag.apiGeneratorMi({ playbook: yol }), yol);
});

test('AG2 kod kazanir: DB kaynagi / gizleme / kosulu ezilir, DB etiketi ve varsayilani korunur', () => {
  const db = {
    fieldOverrides: [{ fieldName: 'chosen_api', label: 'API seçin', defaultValue: '', hidden: true,
      choicesSource: { source: 'nginx-api-locations', params: { env: 'env' } }, dependsOn: { mode: 'all', conditions: [{ field: 'x', equals: 'y' }] } }],
  };
  const c = ag.etkinOverrides(DETAY, db).fieldOverrides.find((o) => o.fieldName === 'chosen_api');
  assert.equal(c.label, 'API seçin');
  assert.equal(c.defaultValue, '');
  assert.equal(c.hidden, false);
  assert.equal(c.choicesSource.source, 'nginx-api-gateway-confs');
  assert.equal(surveyConditions.isFieldActive(c.dependsOn, { op_selection: 'rate_limit_change', x: 'z' }), true);
  assert.equal(ag.etkinOverrides(DETAY, db).fieldOverrides.filter((o) => o.fieldName === 'chosen_api').length, 1);
});

test('AG3 baska sablonda ayni nesne; girdi hicbir durumda degistirilmez', () => {
  const db = derinDondur({ ocoCheck: { enabled: true }, fieldOverrides: [{ fieldName: 'chosen_api', label: 'L', hidden: true }] });
  assert.equal(ag.etkinOverrides(BASKA, db), db);
  assert.equal(ag.etkinOverrides(null, db), db);
  const once = JSON.stringify(db);
  const out = ag.etkinOverrides(DETAY, db);
  assert.equal(JSON.stringify(db), once);
  assert.notEqual(out, db);
  assert.deepEqual(out.ocoCheck, { enabled: true });
  assert.ok(Array.isArray(ag.etkinOverrides(DETAY, {}).fieldOverrides));
  assert.ok(Array.isArray(ag.etkinOverrides(DETAY, undefined).fieldOverrides));
});

test('AG4 diger alan ayarlari (acma / kapatma listeleri dahil) oldugu gibi kalir', () => {
  const diger = [{ fieldName: 'selected_api', hidden: false, label: 'Açılacak API' }, { fieldName: 'active_api', defaultValue: 'x' },
    { fieldName: 'deactive_api', choicesSource: { source: 'nginx-hosts', params: {} } }];
  const out = ag.etkinOverrides(DETAY, { fieldOverrides: diger });
  for (const d of diger) assert.deepEqual(out.fieldOverrides.find((o) => o.fieldName === d.fieldName), d);
});

test('AG5 runner: survey ekrani, sablon detayi ve launch AYNI etkin ayarlari kullanir', () => {
  const survey = SRC.slice(SRC.indexOf("app.get('/api/ansible/survey/:serverId/:templateId'"), SRC.indexOf("app.get('/api/ansible/template-detail/"));
  assert.match(survey, /const etkinOv = require\('\.\.\/selfservice\/api-generator-secim\.cjs'\)\.etkinOverrides\(detail, overrides\)/);
  assert.match(survey, /mapSurveySpec\(spec\.spec, etkinOv,/);
  assert.match(survey, /const customFields = Array\.isArray\(etkinOv\.customSurveyFields\)\s*\?\s*etkinOv\.customSurveyFields/);
  const detay = SRC.slice(SRC.indexOf("app.get('/api/ansible/template-detail/"), SRC.indexOf("app.get('/api/ansible/template-detail/") + 3000);
  assert.match(detay, /etkinOverrides\(\s*detail,\s*readCustom\(server\.id, req\.params\.templateId\),?\s*\)/);
  const plan = SRC.slice(SRC.indexOf('async function resolveSsLaunchPlan'), SRC.indexOf('async function resolveSsLaunchPlan') + 2500);
  assert.match(plan, /const overrides = require\('\.\.\/selfservice\/api-generator-secim\.cjs'\)\.etkinOverrides\(\s*detail,\s*readCustom\(server\.id, templateId\),?\s*\)/);
});

function runnerFonksiyonlari() {
  const kes = (bas, son) => {
    const i = SRC.indexOf(bas);
    const j = SRC.indexOf(son, i);
    assert.ok(i >= 0 && j > i, `runner.cjs'te ${bas} bulunamadi`);
    return SRC.slice(i, j);
  };
  const govde =
    kes('function mapSurveySpec(', '// Bir AWX job_template detay nesnesinden') +
    kes('function kosulGecerli(', '// COKLU SECIM (2026-09-16)') +
    kes('function splitMulti(', '// SECENEK KAYNAGI DOGRULAMASI');
  return new Function('surveyConditions', `${govde}; return { mapSurveySpec, kosulGecerli, resolveLaunchExtraVars };`)(surveyConditions);
}

const ALANLAR = [
  { variable: 'op_selection', type: 'multiplechoice', required: true, default: '', choices: ['activate', 'deactivate', 'rate_limit_change', 'read'], question_name: 'İşlem' },
  { variable: 'env', type: 'multiplechoice', required: true, default: '', choices: ['dev', 'test', 'qa', 'prod'], question_name: 'Ortam' },
  { variable: 'selected_api', type: 'multiplechoice', required: false, default: '', choices: ['/x/', '/y/'], question_name: 'API' },
  { variable: 'chosen_api', type: 'text', required: false, default: '', question_name: 'Rate limit API' },
];

test('AG6 gercek mapSurveySpec / resolveLaunchExtraVars: kosul, zorunluluk, gonderilmeme', () => {
  const { mapSurveySpec, resolveLaunchExtraVars } = runnerFonksiyonlari();
  const ov = ag.etkinOverrides(DETAY, { fieldOverrides: [] });
  const alanlar = mapSurveySpec(ALANLAR, ov);
  const c = alanlar.find((f) => f.name === 'chosen_api');
  assert.equal(c.type, 'multiplechoice');
  assert.equal(c.required, true);
  assert.equal(c.kodlaBagli, true);
  assert.equal(c.choicesSource.source, 'nginx-api-gateway-confs');
  assert.ok(c.dependsOn, 'kosul istemciye gitmiyor (alan her islemde gorunur)');
  assert.equal(alanlar.find((f) => f.name === 'selected_api').dependsOn, undefined);

  let ev = resolveLaunchExtraVars(ALANLAR, ov, { op_selection: 'activate', env: 'prod', selected_api: '/x/', chosen_api: 'ORT.ESKI' });
  assert.equal('chosen_api' in ev, false, 'kosulu saglanmayan alan AWX\'e gitmemeli');
  assert.equal(ev.selected_api, '/x/');
  assert.throws(() => resolveLaunchExtraVars(ALANLAR, ov, { op_selection: 'rate_limit_change', env: 'prod', chosen_api: '' }),
    (e) => e.status === 400 && e.field === 'chosen_api');
  ev = resolveLaunchExtraVars(ALANLAR, ov, { op_selection: 'rate_limit_change', env: 'prod', chosen_api: ' ORT.CST.X.V1 ' });
  assert.equal(ev.chosen_api, 'ORT.CST.X.V1');
  ev = resolveLaunchExtraVars(ALANLAR, ov, { op_selection: 'read', env: 'prod', chosen_api: 'ORT.CST.X.V1' });
  assert.equal(ev.chosen_api, 'ORT.CST.X.V1');

  const ham = mapSurveySpec(ALANLAR, { fieldOverrides: [] }).find((f) => f.name === 'chosen_api');
  assert.equal(ham.dependsOn, undefined);
  assert.equal(ham.required, false);
  ev = resolveLaunchExtraVars(ALANLAR, { fieldOverrides: [] }, { op_selection: 'activate', env: 'prod', chosen_api: 'serbest' });
  assert.equal(ev.chosen_api, 'serbest', 'baska sablonlarin davranisi degismemeli');
});

test('AG7 AWX zorunlu + varsayilansiz alan kosulla gizlenmez; varsayilanliysa gizlenince varsayilan gider', () => {
  const { mapSurveySpec, resolveLaunchExtraVars } = runnerFonksiyonlari();
  const ov = ag.etkinOverrides(DETAY, { fieldOverrides: [] });
  const zorunlu = ALANLAR.map((f) => (f.variable === 'chosen_api' ? { ...f, required: true } : f));
  assert.equal(mapSurveySpec(zorunlu, ov).find((f) => f.name === 'chosen_api').dependsOn, undefined);
  assert.throws(() => resolveLaunchExtraVars(zorunlu, ov, { op_selection: 'activate', env: 'prod', selected_api: '/x/' }), (e) => e.status === 400);
  const varsayilanli = ALANLAR.map((f) => (f.variable === 'chosen_api' ? { ...f, required: true, default: 'YOK' } : f));
  assert.ok(mapSurveySpec(varsayilanli, ov).find((f) => f.name === 'chosen_api').dependsOn);
  const ev = resolveLaunchExtraVars(varsayilanli, ov, { op_selection: 'activate', env: 'prod', selected_api: '/x/', chosen_api: 'ORT.X' });
  assert.equal(ev.chosen_api, 'YOK');
});

test('AG8 kaynak: job sunuculari, izinli onekli konfigurasyon adlari, etiket ve gruplar', () => {
  assert.deepEqual(apiGeneratorHosts('dev'), ['GBNGWD01', 'GBNGWD02']);
  assert.deepEqual(apiGeneratorHosts('TEST', 'ankara'), ['GBNGWT03', 'GBNGWT04']);
  assert.deepEqual(apiGeneratorHosts('qa'), ['GBNGWQ01', 'GBNGWQ02']);
  const prod = apiGeneratorHosts('prod');
  assert.equal(prod.length, 54);
  assert.deepEqual(apiGeneratorHosts('Production', 'Hepsi'), prod);
  assert.ok(apiGeneratorHosts('prod', 'pendik').every((h) => /^GBNGWP/.test(h)) && apiGeneratorHosts('prod', 'pendik').length === 32);
  assert.ok(apiGeneratorHosts('prod', 'ankara').every((h) => /^GBNGWAP/.test(h)) && apiGeneratorHosts('prod', 'ankara').length === 16);
  assert.deepEqual(apiGeneratorHosts('prod', 'izmir'), []);
  assert.deepEqual(apiGeneratorHosts('uat'), []);
  const customers = apiGeneratorHosts('prod', '', 'Customers');
  assert.deepEqual(customers, API_CLUSTERS.find((k) => k.key === 'customers').hosts);
  assert.equal(customers.length, 12);
  assert.deepEqual(apiGeneratorHosts('prod', 'pendik', 'customers'), customers.filter((h) => /^GBNGWP/.test(h)));
  assert.equal(apiGeneratorHosts('prod', '', 'bilinmeyen-kanal').length, 54, 'taninmayan kanal daraltmamali');
  assert.deepEqual(apiGeneratorHosts('dev', '', 'customers'), ['GBNGWD01', 'GBNGWD02'], 'non-prod kanal ile daralmaz');

  const hosts = new Set(['GBNGWD01', 'GBNGWD02']);
  const satir = (host, conf, yol, ip, lc) => ({ host, config_file: conf, api_location: yol, ip_rate_limit: ip, server_rate_limit: lc });
  const out = cs.apiGatewayConfChoices([
    satir('GBNGWD01', 'ORT.CST.REST.A.V1.conf', '/das-a/a-channel/v0/x/y', '50r/s', '300r/s'),
    satir('GBNGWD01', 'ORT.CST.REST.A.V1.conf', '/das-a/a-channel/v0/x', '50r/s', '300r/s'),
    satir('GBNGWD02', 'ORT.CST.REST.A.V1.conf', '/das-a/a-channel/v0/x', '100r/s', null),
    satir('GBNGWD01', 'GAR.B.V1.conf', '/gar-b/v0/z', '', ''),
    satir('GBNGWD01', 'mobil-servis.conf', '/mobil/v0', '10r/s', ''),
    satir('GBNGWT03', 'ORT.TEST.ONLY.conf', '/t/v0', '1r/s', ''),
    satir('gbngwd02', 'ort.kucuk.harf.conf', '/k/v0', '', ''),
  ], hosts);
  // Kullanici (2026-10-22): "sadece API ismi gozuksun ... <API Ismi> <API> bu sekilde olsun". Etiket
  // "<konfigurasyon> - <kok yol>"; limit / kapsam / grup YOK (secimin sagindaki panelde).
  // Iki satir (2026-10-22): label = ad, alt = kok yol (kokYolu; AG16).
  assert.deepEqual(out.map((c) => c.value), ['GAR.B.V1', 'ORT.CST.REST.A.V1'], 'alfabetik, grupsuz');
  assert.deepEqual(out.map((c) => [c.label, c.alt]), [['GAR.B.V1', '/gar-b/v0/z'], ['ORT.CST.REST.A.V1', '/das-a/a-channel/v0/x']]);
  assert.ok(out.every((c) => !('group' in c)), 'grup basligi olmamali ("Envanterde rate limit gorunmuyor" yaniltiyordu)');
  const ornek = cs.apiGatewayConfChoices([
    satir('GBNGWD01', 'GAR.CST.REST.DIGITAL-ONBOARDING-PB_DIGITAL-ONBOARDING-PB-CH_V0.conf', '/digital-onboarding-pb/digital-onboarding-pb/v0/token', '', ''),
    satir('GBNGWD01', 'GAR.CST.REST.DIGITAL-ONBOARDING-PB_DIGITAL-ONBOARDING-PB-CH_V0.conf', '/digital-onboarding-pb/digital-onboarding-pb/v0/', '', ''),
  ], hosts);
  assert.deepEqual([ornek[0].label, ornek[0].alt],
    ['GAR.CST.REST.DIGITAL-ONBOARDING-PB_DIGITAL-ONBOARDING-PB-CH_V0', '/digital-onboarding-pb/digital-onboarding-pb/v0/']);
  const adli = cs.apiGatewayConfChoices([satir('GBNGWD01', 'GAR.N.conf', '/n/v0', '1r/s', ''), satir('GBNGWD01', 'GAR.N.conf', '@a', '', '')], hosts);
  assert.deepEqual([adli[0].label, adli[0].alt], ['GAR.N', '/n/v0'], '@ad (named location) API ucu / kok sayilmamali');
  const yolsuz = cs.apiGatewayConfChoices([satir('GBNGWD01', 'GAR.Y.conf', '@x', '', '')], hosts)[0];
  assert.ok(yolsuz.label === 'GAR.Y' && !('alt' in yolsuz), 'yol yoksa yalniz ad');
  // '.conf' soneki NOKTALI atilir: "GAR.Xconf" adinin sonu kirpilmamali (2026-10-22 regresyonu: /.conf$/i).
  assert.equal(cs.apiGatewayConfChoices([satir('GBNGWD01', 'GAR.Xconf', '/x/v0', '', '')], hosts)[0].value, 'GAR.Xconf');
  for (const p of ['site', 'channel']) assert.ok(!cs.getSource('nginx-api-gateway-confs').params.find((x) => x.name === p).required);
  const load = String(cs.getSource('nginx-api-gateway-confs').load);
  assert.match(load, /apiGeneratorHosts\(env, site, channel\)/);
  assert.match(load, /MAX\(scan_date\)/);
  assert.equal(new Set(API_CLUSTERS.flatMap((k) => k.hosts)).size, 54);
});

test('AG10 Survey Tasarimcisi: chosen_api alani da kodla bagli; gercek resolveCustomSurveyExtraVars ile kosul / zorunluluk', () => {
  const tasarim = [
    { name: 'op_selection', label: 'İşlem', type: 'multiplechoice', required: true, defaultValue: '', choices: ['activate', 'rate_limit_change', 'read'], hidden: false },
    { name: 'env', label: 'Ortam', type: 'multiplechoice', required: true, defaultValue: '', choices: ['dev', 'prod'], hidden: false },
    { name: 'selected_api', label: 'API', type: 'multiplechoice', required: false, defaultValue: '', choices: ['/x/'], hidden: false },
    { name: 'chosen_api', label: 'API Seçimi', type: 'text', required: false, defaultValue: '', choices: [], hidden: false,
      description: 'ipucu', choicesSource: { source: 'nginx-api-locations', params: { env: 'env' } } },
  ];
  const db = derinDondur({ fieldOverrides: [], customSurveyFields: tasarim.map((f) => ({ ...f })) });
  const out = ag.etkinOverrides(DETAY, db);
  const c = out.customSurveyFields.find((f) => f.name === 'chosen_api');
  assert.equal(c.label, 'API Seçimi');
  assert.equal(c.description, 'ipucu');
  assert.equal(c.type, 'text');
  assert.equal(c.required, true);
  assert.equal(c.kodlaBagli, true);
  assert.equal(c.choicesSource.source, 'nginx-api-gateway-confs');
  assert.ok(c.dependsOn);
  for (const n of ['op_selection', 'env', 'selected_api']) assert.deepEqual(out.customSurveyFields.find((f) => f.name === n), db.customSurveyFields.find((f) => f.name === n));
  assert.equal(ag.etkinOverrides(BASKA, db), db);
  assert.equal('customSurveyFields' in ag.etkinOverrides(DETAY, { fieldOverrides: [] }), false);

  const i = SRC.indexOf('function resolveCustomSurveyExtraVars(');
  const j = SRC.indexOf('\n    return extraVars;\n  }\n', i);
  assert.ok(i >= 0 && j > i);
  const splitMulti = SRC.slice(SRC.indexOf('function splitMulti('), SRC.indexOf('// SECENEK KAYNAGI DOGRULAMASI'));
  const coz = new Function('surveyConditions', `${splitMulti}\n${SRC.slice(i, j)}\n    return extraVars;\n  }\n; return resolveCustomSurveyExtraVars;`)(surveyConditions);
  let ev = coz(out.customSurveyFields, { op_selection: 'activate', env: 'prod', selected_api: '/x/', chosen_api: 'ORT.X' });
  assert.equal('chosen_api' in ev, false, 'acma / kapatmada chosen_api gonderilmemeli');
  assert.throws(() => coz(out.customSurveyFields, { op_selection: 'rate_limit_change', env: 'prod', chosen_api: '' }), (e) => e.status === 400);
  ev = coz(out.customSurveyFields, { op_selection: 'read', env: 'prod', chosen_api: 'ORT.X' });
  assert.equal(ev.chosen_api, 'ORT.X');
  const modal = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'components', 'self_service', 'FieldOverridesModal.tsx'), 'utf8');
  assert.match(modal, /setKodlaBagliAdlar\(new Set\(\(specRes\.fields \|\| \[\]\)\.filter\(\(f\) => f\.kodlaBagli\)/);
  assert.match(modal, /data-testid="kodla-bagli-tasarimci-alani"/);
});

test('AG9 (depo verilirse) host listeleri ve izinli domainler api_generator playbook\'uyla AYNI', (t) => {
  const depo = process.env.API_GENERATOR_ANSIBLE_DEPO;
  if (!depo) return t.skip('API_GENERATOR_ANSIBLE_DEPO tanimli degil');
  const pb = fs.readFileSync(path.join(depo, 'bmw_nginx', 'api_generator', 'api_generator.yaml'), 'utf8').replace(/\r/g, '');
  const hostlar = [...pb.matchAll(/hosts:\s*([A-Z0-9,]+)\s*$/gm)].map((m) => m[1].split(','));
  assert.deepEqual(hostlar[0], apiGeneratorHosts('dev'));
  assert.deepEqual(hostlar[1], apiGeneratorHosts('test'));
  assert.deepEqual(hostlar[2], apiGeneratorHosts('qa'));
  assert.deepEqual([...hostlar[3]].sort(), [...apiGeneratorHosts('prod')].sort());
  const rlc = fs.readFileSync(path.join(depo, 'bmw_nginx', 'api_generator', 'operations', 'tasks', 'rate_limit_change.yaml'), 'utf8');
  const blok = rlc.slice(rlc.indexOf('granted_domains:'), rlc.indexOf('- name:', rlc.indexOf('granted_domains:')));
  assert.deepEqual([...blok.matchAll(/-\s*([A-Z]{3})\s*$/gm)].map((m) => m[1]), cs.API_GENERATOR_GRANTED_DOMAINS);
  // Kanal kumeleri: Ansible prod rate_limit_change yalniz kanalin kumesinde calisir (vars/main.yaml).
  const vars = fs.readFileSync(path.join(depo, 'bmw_nginx', 'api_generator', 'operations', 'vars', 'main.yaml'), 'utf8').replace(/\r/g, '');
  const kumeler = {};
  let ad = null;
  for (const satir of vars.split('\n')) {
    const k = /^ {2}([a-z]+):\s*$/.exec(satir);
    const h = /^ {4}-\s*([A-Z0-9]+)\s*$/.exec(satir);
    if (k) kumeler[(ad = k[1])] = [];
    else if (h && ad) kumeler[ad].push(h[1]);
  }
  assert.deepEqual(Object.keys(kumeler).sort(), API_CLUSTERS.map((k) => k.key).sort());
  for (const k of API_CLUSTERS) assert.deepEqual(kumeler[k.key], k.hosts, `kume farkli: ${k.key}`);
});

// AG11-AG14 (2026-10-22). Kullanici: "secilen kok API'yle beraber etkilenecek diger children API'ler sagda
// liste halinde gozuksun kullanici bunun bilincinde olsun hepsinin rate limiti cunku kok API'nin ismiyle ayni
// zone'a tanimli" ve (prod kanal kumesi) "a secenegi ile devam et".
const zs = (host, conf, yol, ip, lc, iz, sz) => ({
  host, config_file: conf, api_location: yol, ip_rate_limit: ip, server_rate_limit: lc, ip_zone: iz, server_zone: sz,
});

test('AG11 ayrinti (SAF): zone bilgisiyle ayni zone u paylasan TUM uclar; kok; baska konfigurasyon; limitsiz uc etkilenmez', () => {
  const hosts = new Set(['GBNGWP25', 'GBNGWP26']);
  const Z = '/das-a/a-channel/v0_rate_limit';
  const L = '/das-a/a-channel/v0_location_limit';
  const rows = [
    zs('GBNGWP25', 'ORT.CST.REST.A.V1.conf', '/das-a/a-channel/v0', '50r/s', '300r/s', Z, L),
    zs('GBNGWP26', 'ORT.CST.REST.A.V1.conf', '/das-a/a-channel/v0', '60r/s', '300r/s', Z, L),
    zs('GBNGWP25', 'ORT.CST.REST.A.V1.conf', '/das-a/a-channel/v0/x', '50r/s', '300r/s', Z, L),
    zs('GBNGWP25', 'ORT.CST.REST.A.V1.conf', '/das-a/a-channel/v0/ping', '', '', '', ''),
    zs('GBNGWP25', 'ORT.CST.REST.A.V1.conf', '@custom_403_json', '', '', '', ''),
    zs('GBNGWP25', 'GAR.BASKA.V1.conf', '/gar/baska/v0', '50r/s', '', Z, ''),
    zs('GBNGWP25', 'GAR.ILGISIZ.V1.conf', '/gar/ilgisiz/v0', '10r/s', '', '/gar/ilgisiz/v0_rate_limit', ''),
    zs('GBNGWP01', 'ORT.CST.REST.A.V1.conf', '/das-a/a-channel/v0/kume-disi', '50r/s', '', '/kume-disi/v0_rate_limit', ''),
    zs('GBNGWP01', 'GAR.KUMEDISI.V1.conf', '/gar/kume-disi/v0', '50r/s', '', Z, ''),
  ];
  // Ayni satir iki sorgudan gelebilir (kendi konfigurasyonu + zone eslesmesi): bir kez sayilmali.
  const d = cs.apiGatewayConfDetay([...rows, rows[0]], hosts, 'ORT.CST.REST.A.V1', { kume: 'customers', taramaTarihi: '2026-10-22', zoneVar: true });
  assert.equal(d.zoneBilgisi, true);
  assert.deepEqual(d.zonelar, { ip: [Z], location: [L] });
  assert.deepEqual(d.uclar.map((u) => [u.yol, u.kok, u.baskaConf]), [
    ['/das-a/a-channel/v0', true, false],
    ['/das-a/a-channel/v0/ping', false, false],
    ['/das-a/a-channel/v0/x', false, false],
    ['/gar/baska/v0', false, true],
  ]);
  const [kok, ping, , baska] = d.uclar;
  assert.equal(kok.sunucu, 2);
  assert.equal(kok.ip, '50r/s / 60r/s');
  assert.equal(kok.ipFarkli, true);
  assert.deepEqual(kok.etkiler, { ip: true, location: true });
  assert.deepEqual(ping.etkiler, { ip: false, location: false }, 'limitsiz uc etkilenmez');
  assert.deepEqual(baska.etkiler, { ip: true, location: false }, 'baska konfigurasyon yalniz paylastigi zone turunde');
  assert.equal(baska.conf, 'GAR.BASKA.V1');
  assert.equal(d.etkilenen, 3);
  assert.equal(d.toplamSunucu, 2);
  assert.equal(d.kume, 'customers');
  assert.equal(cs.confZonelari(rows, hosts, 'ort.cst.rest.a.v1').join(','), [L, Z].sort().join(','));
  assert.equal(d.mod, 'degisiklik');
  assert.equal(cs.apiGatewayConfDetay(rows, hosts, 'ORT.CST.REST.A.V1', { zoneVar: true, mod: 'bilgi' }).mod, 'bilgi');
});

test('AG11c ayrinti (SAF): zone eslesmesi SUNUCU BAZINDA; @ad location un zone u sayilir ama uc olarak listelenmez', () => {
  // Inceleme 2026-10-22: konfigurasyonun OLMADIGI sunucuda job "bulunamadi" ile durur ve oradaki ortak zone'a dokunmaz;
  // playbook dosyadaki TUM limit_req satirlarini aldigi icin @ad location'in zone'u da degisir.
  const hosts = new Set(['GBNGWP25', 'GBNGWP26']);
  const Z = '/a/v0_rate_limit';
  const rows = [
    zs('GBNGWP25', 'GAR.A.conf', '/a/v0', '5r/s', '', Z, ''),
    zs('GBNGWP26', 'GAR.C.conf', '/c/v0', '5r/s', '', Z, ''),
    zs('GBNGWP25', 'GAR.AX.conf', '/a/v0/x', '5r/s', '', Z, ''),
    zs('GBNGWP26', 'GAR.AX.conf', '/a/v0/x', '5r/s', '', Z, ''),
    zs('GBNGWP25', 'GAR.A.conf', '@adli', '', '', '/adli_rate_limit', ''),
    zs('GBNGWP25', 'GAR.B.conf', '/b/v0', '9r/s', '', '/adli_rate_limit', ''),
  ];
  const d = cs.apiGatewayConfDetay(rows, hosts, 'GAR.A', { zoneVar: true });
  assert.deepEqual(d.uclar.map((u) => [u.yol, u.sunucu]), [['/a/v0', 1], ['/a/v0/x', 1], ['/b/v0', 1]],
    '/c/v0 (GAR.A nin olmadigi sunucuda) listelenmemeli; /a/v0/x yalniz GAR.A nin oldugu sunucuda etkilenir');
  assert.deepEqual(d.zonelar.ip, ['/a/v0_rate_limit', '/adli_rate_limit'], '@ad location un zone u da degisir');
  assert.ok(!d.uclar.some((u) => u.yol.startsWith('@')));
  assert.deepEqual(cs.confZonelari(rows, hosts, 'GAR.A'), ['/a/v0_rate_limit', '/adli_rate_limit']);
});

test('AG11b ayrinti (SAF): zone bilgisi YOKSA (eski yukleyici / kolon yok) yalniz bu konfigurasyon, durust isaret', () => {
  const hosts = new Set(['GBNGWD01']);
  const eski = [
    zs('GBNGWD01', 'DAS.B.V1.conf', '/b/v0', '5r/s', '', null, null),
    zs('GBNGWD01', 'DAS.B.V1.conf', '/b/v0/c', '', '', null, null),
    zs('GBNGWD01', 'DAS.DIGER.V1.conf', '/d/v0', '5r/s', '', null, null),
  ];
  for (const zoneVar of [true, false]) {
    const d = cs.apiGatewayConfDetay(eski, hosts, 'DAS.B.V1', { zoneVar });
    assert.equal(d.zoneBilgisi, false, `zoneVar=${zoneVar}: NULL zone = bilinmiyor`);
    assert.deepEqual(d.uclar.map((u) => [u.yol, u.etkiler.ip]), [['/b/v0', true], ['/b/v0/c', false]]);
    assert.equal(d.etkilenen, 1);
  }
  const kokYok = cs.apiGatewayConfDetay([zs('GBNGWD01', 'GAR.K.conf', '/a/v0', '1r/s', '', '', ''), zs('GBNGWD01', 'GAR.K.conf', '/b/v0', '1r/s', '', '', '')],
    hosts, 'GAR.K', { zoneVar: true });
  assert.ok(kokYok.uclar.every((u) => !u.kok), 'ortak onek yoksa kok isaretlenmez');
  const onek = cs.apiGatewayConfDetay([zs('GBNGWD01', 'GAR.K.conf', '/a/v0', '1r/s', '', 'z', ''), zs('GBNGWD01', 'GAR.K.conf', '/a/v01', '1r/s', '', 'z', '')],
    hosts, 'GAR.K', { zoneVar: true });
  assert.ok(onek.uclar.every((u) => !u.kok), '/a/v0, /a/v01 in koku DEGIL (yol parcasi siniri)');
});

test('AG12 loadChoiceDetails: listede olmayan deger 404, ayrintisiz kaynak 404, bos deger 400; onbellek sinirli', async () => {
  let cagri = 0;
  cs.SOURCES['test-ayrinti'] = {
    label: 't',
    params: [{ name: 'env', label: 'e', required: true }],
    async load({ env }) {
      return env ? [{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }] : [];
    },
    async details(p, v) {
      cagri += 1;
      return { v, env: p.env, n: cagri };
    },
  };
  cs.SOURCES['test-ayrintisiz'] = { label: 't', params: [], async load() { return [{ value: 'A', label: 'A' }]; } };
  try {
    cs.clearCache();
    const d1 = await cs.loadChoiceDetails('test-ayrinti', { env: 'dev', value: 'yoksay' }, 'A');
    assert.deepEqual(d1, { v: 'A', env: 'dev', n: 1 });
    assert.equal((await cs.loadChoiceDetails('test-ayrinti', { env: 'dev' }, 'A')).n, 1, 'onbellekten gelmeli');
    await assert.rejects(cs.loadChoiceDetails('test-ayrinti', { env: 'dev' }, 'C'), (e) => e.status === 404);
    await assert.rejects(cs.loadChoiceDetails('test-ayrinti', { env: '' }, 'A'), (e) => e.status === 404, 'zorunlu parametre bos: liste bos');
    await assert.rejects(cs.loadChoiceDetails('test-ayrinti', { env: 'dev' }, '  '), (e) => e.status === 400);
    await assert.rejects(cs.loadChoiceDetails('test-ayrintisiz', {}, 'A'), (e) => e.status === 404);
    await assert.rejects(cs.loadChoiceDetails('yok-boyle', {}, 'A'), (e) => e.status === 404);
    for (const s of Object.values(cs.SOURCES)) assert.ok(!s.params.some((p) => p.name === 'value'), "'value' ayrinti rotasinda deger adi");
  } finally {
    delete cs.SOURCES['test-ayrinti'];
    delete cs.SOURCES['test-ayrintisiz'];
    cs.clearCache();
  }
});

test('AG13 prod: kanal bos / taninmiyorsa liste ve ayrinti DB ye gitmeden 400; launch dogrulamasi 400 (kesinti degil)', async () => {
  const src = cs.getSource('nginx-api-gateway-confs');
  for (const channel of ['', 'customer', '  ']) {
    await assert.rejects(src.load({ env: 'prod', site: '', channel }), (e) => e.status === 400 && /Kanal|kanal/.test(e.message));
    await assert.rejects(src.details({ env: 'Production', site: '', channel }, 'ORT.X'), (e) => e.status === 400);
  }
  assert.equal(cs.apiGatewayKumesi('prod', ' Customers ').key, 'customers');
  assert.equal(cs.apiGatewayKumesi('dev', ''), null, 'non-prod kanal istemez');
  // read hicbir sey degistirmez ve job kanal bilinmiyorsa tum sunucularda okur: kanal zorunlu DEGIL (inceleme 2026-10-22)
  for (const ch of ['', 'mblcustomer']) assert.equal(cs.apiGatewayKumesi('prod', ch, 'read'), null, `read + ${ch || 'bos'} kanal`);
  assert.equal(cs.apiGatewayKumesi('prod', 'customers', ' READ ').key, 'customers', 'read + bilinen kanal yine kumeye daralir');
  for (const op of ['rate_limit_change', '', undefined]) {
    assert.throws(() => cs.apiGatewayKumesi('prod', 'mblcustomer', op), (e) => e.status === 400, String(op));
  }
  cs.clearCache();
  await assert.rejects(
    cs.assertValueInSource({ source: 'nginx-api-gateway-confs', params: { env: 'env', channel: 'channel' } }, 'ORT.X', { env: 'prod', channel: 'x' }, 'API Seçimi'),
    (e) => e.status === 400 && /^API Seçimi: Kanal "x"/.test(e.message) && /İş başlatılmadı/.test(e.message),
  );
});

test('AG16 kok yol: once ZONE ADINDAN, yoksa ortak yol oneki; en kisa location child cikarmaz', () => {
  // Kullanici (2026-10-22): "secim ekraninda kok yol degil de child API cikti ... rate limit zone isminden
  // cikartabilirsin". Kok API'nin kendi location'i dosyada yoksa en kisa location bir CHILD'dir.
  const k = cs.kokYolu;
  const childlar = ['/r/v0/ab', '/r/v0/abc/def'];
  assert.equal(k(childlar, ['/r/v0_rate_limit', '/r/v0_location_limit']), '/r/v0', 'zone adindan');
  assert.equal(k(childlar, []), '/r/v0/', 'zone yoksa ortak onek (en kisa location /r/v0/ab DEGIL)');
  assert.equal(k(['/d/v0/', '/d/v0/token'], ['/d/v0_rate_limit']), '/d/v0/', 'dosyadaki gercek yol (sondaki / dahil)');
  assert.equal(k(['/d/v0', '/d/v0/token'], ['/d/v0/_rate_limit']), '/d/v0', 'zone govdesinde sondaki / -> gercek yol');
  assert.equal(k(['/das-a/v0/x'], ['das-a/v0_rate_limit']), '/das-a/v0', 'basinda / olmayan zone govdesi');
  assert.equal(k(['/x/v0/a', '/x/v0/b'], ['ORT.CST.REST.X.V1_rate_limit']), '/x/v0/', 'yol bicimli olmayan zone adi atlanir');
  // Cocuga ozel zone (/r/v0/ab_rate_limit) da varsa TUM location'larin onu olan kok secilir.
  assert.equal(k(childlar, ['/r/v0/ab_rate_limit', '/r/v0/ab_rate_limit', '/r/v0_rate_limit']), '/r/v0');
  assert.equal(k(['/tek/v0/a'], []), '/tek/v0/a', 'tek location kendisi');
  assert.equal(k(['/a/v0', '/b/v0'], []), '/a/v0', 'ortak onek yoksa en kisa');
  assert.equal(k([], []), '');
  // Liste etiketi ve panel AYNI kurali kullanir.
  const hosts = new Set(['GBNGWD01']);
  const rows = [zs('GBNGWD01', 'GAR.R.conf', '/r/v0/ab', '1r/s', '', '/r/v0_rate_limit', ''),
    zs('GBNGWD01', 'GAR.R.conf', '/r/v0/abc/def', '1r/s', '', '/r/v0_rate_limit', '')];
  assert.equal(cs.apiGatewayConfChoices(rows, hosts)[0].alt, '/r/v0');
  const d = cs.apiGatewayConfDetay(rows, hosts, 'GAR.R', { zoneVar: true });
  assert.equal(d.kokYol, '/r/v0');
  assert.ok(d.uclar.every((u) => !u.kok), 'kok API location i dosyada yoksa hicbir uc kok isaretlenmez');
  const d2 = cs.apiGatewayConfDetay([...rows, zs('GBNGWD01', 'GAR.R.conf', '/r/v0', '1r/s', '', '/r/v0_rate_limit', '')], hosts, 'GAR.R', { zoneVar: true });
  assert.deepEqual(d2.uclar.filter((u) => u.kok).map((u) => u.yol), ['/r/v0']);
});

test('AG15 details SQL hatti (sahte mssql): zone kolonu varsa ortak kullanicilar parametreli sorulur, yoksa sorulmaz; mod', async () => {
  const yol = require.resolve('../../inventory/mssql.cjs');
  const eski = require.cache[yol];
  const cagri = [];
  let kolonVar = true;
  const Z = '/a/v0_rate_limit';
  require.cache[yol] = {
    id: yol, filename: yol, loaded: true,
    exports: {
      sql: { NVarChar: (n) => `nvarchar(${n})` },
      async query(metin, params = []) {
        cagri.push({ metin, params });
        if (/COL_LENGTH/.test(metin)) return { recordset: [{ d: '2026-10-22', iz: kolonVar ? 512 : null, sz: kolonVar ? 512 : null }] };
        if (/config_file IN/.test(metin)) {
          return { recordset: [zs('GBNGWP25', 'GAR.A.conf', '/a/v0', '5r/s', '', kolonVar ? Z : undefined, kolonVar ? '' : undefined)] };
        }
        if (/ip_zone IN/.test(metin)) return { recordset: [zs('GBNGWP25', 'GAR.B.conf', '/b/v0', '5r/s', '', Z, '')] };
        if (/SELECT host, config_file, api_location/.test(metin) && !/ IN \(/.test(metin)) {
          return { recordset: [zs('GBNGWP25', 'GAR.R.conf', '/r/v0/ab', '', '', kolonVar ? '/r/v0_rate_limit' : undefined, kolonVar ? '' : undefined)] };
        }
        throw new Error('beklenmeyen sorgu: ' + metin);
      },
    },
  };
  try {
    const src = cs.getSource('nginx-api-gateway-confs');
    let d = await src.details({ env: 'prod', site: '', channel: 'customers', islem: 'rate_limit_change' }, 'GAR.A');
    assert.equal(d.mod, 'degisiklik');
    assert.equal(d.kume, 'customers');
    assert.equal(d.toplamSunucu, 12);
    assert.deepEqual(d.uclar.map((u) => u.yol), ['/a/v0', '/b/v0']);
    const ortak = cagri.find((c) => /ip_zone IN/.test(c.metin));
    assert.ok(ortak && ortak.params.some((p) => p.value === Z) && ortak.params.some((p) => p.name === 'd'), 'zone sorgusu parametreli degil');
    const kendi = cagri.find((c) => /config_file IN/.test(c.metin));
    assert.deepEqual(kendi.params.filter((p) => /^c\d$/.test(p.name)).map((p) => p.value), ['GAR.A', 'GAR.A.conf']);
    d = await src.details({ env: 'prod', site: '', channel: 'mblcustomer', islem: 'read' }, 'GAR.A');
    assert.equal(d.mod, 'bilgi', 'read: bilgi modu');
    assert.equal(d.toplamSunucu, 54, 'read + taninmayan kanal: tum prod sunuculari');
    cagri.length = 0;
    kolonVar = false;
    d = await src.details({ env: 'dev', site: '', channel: '', islem: 'rate_limit_change' }, 'GAR.A');
    assert.equal(d.zoneBilgisi, false);
    assert.ok(!cagri.some((c) => !/COL_LENGTH/.test(c.metin) && /ip_zone/.test(c.metin)), 'kolon yokken ip_zone sorgulanmamali');
    // Liste (load): kok yol ZONE ADINDAN; kolon yokken zone okunmaz ve ortak onek / tek yol kullanilir.
    cs.clearCache();
    kolonVar = true;
    cagri.length = 0;
    let liste = await src.load({ env: 'prod', site: '', channel: 'customers', islem: 'rate_limit_change' });
    assert.deepEqual(liste, [{ value: 'GAR.R', label: 'GAR.R', alt: '/r/v0' }]);
    assert.ok(cagri.some((c) => /SELECT host, config_file, api_location, ip_zone, server_zone/.test(c.metin)), 'liste zone kolonlarini okumuyor');
    kolonVar = false;
    cagri.length = 0;
    liste = await src.load({ env: 'prod', site: '', channel: 'customers', islem: 'rate_limit_change' });
    assert.deepEqual(liste, [{ value: 'GAR.R', label: 'GAR.R', alt: '/r/v0/ab' }]);
    assert.ok(!cagri.some((c) => !/COL_LENGTH/.test(c.metin) && /ip_zone/.test(c.metin)), 'kolon yokken liste ip_zone okumamali');
  } finally {
    if (eski) require.cache[yol] = eski;
    else delete require.cache[yol];
  }
});

test('AG14 rota + istemci: ayrinti ayni korumada, deger sorguda; panel secimin saginda, ayrinti yalniz kaynak isterse', () => {
  const rota = SRC.slice(SRC.indexOf("app.get('/api/ansible/ss/choices/:source/details'"));
  assert.match(rota, /^app\.get\('\/api\/ansible\/ss\/choices\/:source\/details', requireAuth, async/);
  assert.match(rota.slice(0, 700), /choiceSources\.loadChoiceDetails\(req\.params\.source, params, String\(req\.query\.value \?\? ''\)\)/);
  assert.match(rota.slice(0, 700), /if \(k !== 'value'\) params\[k\]/);
  assert.ok(SRC.indexOf("app.get('/api/ansible/ss/choices/:source', requireAuth") > 0);
  const kok = path.join(__dirname, '..', '..', '..', 'src');
  const api = fs.readFileSync(path.join(kok, 'api', 'ansibleApi.ts'), 'utf8');
  assert.match(api, /\/ss\/choices\/\$\{encodeURIComponent\(source\)\}\/details\?/);
  const dcs = fs.readFileSync(path.join(kok, 'components', 'self_service', 'DynamicChoiceSelect.tsx'), 'utf8');
  assert.match(dcs, /if \(!source\.details\) return secim;/);
  assert.match(dcs, /\{value && !open && !missingParam && choices\.some\(\(c\) => c\.value === value\) && \(\s*<ChoiceDetailsPanel/);
});
