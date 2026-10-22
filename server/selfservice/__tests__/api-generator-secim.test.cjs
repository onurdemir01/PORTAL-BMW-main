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
//   AG9 (depo verilirse) host listeleri ve izinli domainler api_generator playbook'uyla AYNI
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
  assert.deepEqual(c.choicesSource.params, { env: 'env', site: 'site', channel: 'channel' });
  assert.deepEqual(c.choicesSource.optional, ['site', 'channel']);
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
  assert.deepEqual(out.map((c) => c.value), ['ORT.CST.REST.A.V1', 'GAR.B.V1']);
  const a = out[0];
  assert.equal(a.group, 'Rate limit tanımlı — tüm sunucularda var');
  assert.equal(a.label,
    'ORT.CST.REST.A.V1  ·  örnek uç /das-a/a-channel/v0/x (dosyada 2 uç)  ·  IP limiti 100r/s / 50r/s (sunucular arasında farklı)' +
    '  ·  location limiti 300r/s  ·  2/2 sunucuda var');
  assert.match(out[1].label, /IP limiti tanımsız  ·  location limiti tanımsız  ·  1\/2 sunucuda var$/);
  assert.match(out[1].group, /Rate limit tanımı yok/);
  const eksik = cs.apiGatewayConfChoices([satir('GBNGWD01', 'DAS.C.V1.conf', '/c/v0', '5r/s', '')], hosts, 'customers');
  assert.match(eksik[0].group, /bazı sunucularda yok/);
  assert.match(eksik[0].label, /1\/2 sunucuda var \(customers\)$/);
  const sirali = cs.apiGatewayConfChoices([satir('GBNGWD01', 'GAR.Z.conf', '/z', '', ''), satir('GBNGWD01', 'GAR.Y.conf', '/y', '1r/s', ''),
    satir('GBNGWD01', 'GAR.X.conf', '/x', '1r/s', ''), satir('GBNGWD02', 'GAR.X.conf', '/x', '1r/s', '')], hosts);
  assert.deepEqual(sirali.map((c) => c.value), ['GAR.X', 'GAR.Y', 'GAR.Z'], 'gruplar: tanimli+tam, tanimli+eksik, limitsiz');
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
});
