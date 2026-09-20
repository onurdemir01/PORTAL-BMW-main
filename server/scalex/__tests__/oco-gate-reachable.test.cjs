// server/scalex/__tests__/oco-gate-reachable.test.cjs
//
// ScaleX'te OCO kapisi "bozuk" degildi — ERISILEMEZDI.
//
// KANIT (uretim loglari, 13,5 gun, 2026-09-20):
//   grep -icE "scalex.*oco|oco.*scalex"  ->  0    (iki dosyada da SIFIR)
//   smart_not_configured                 -> 11    (sonuncusu 2026-09-20T08:20:11,
//                                                  log bitiminden 14 DAKIKA once)
//
// SEBEP: `runScaleXGates` icinde SMART'in "yapilandirilmamis" 503'u,
// OCO kapisini iceren `runChangeGates` cagrisindan 30 SATIR ONCE donuyordu.
// Uretimde `ansible_ss_customizations`ta ScaleX satiri hic olmadigi icin HER
// prod `apply` orada oluyordu ve `ocoClient.getChangeOrder` HIC CAGRILMIYORDU.
//
// Bu dosya sirayi ve ayar okumayi kilitler. Testler KAYNAK METNI degil KARAR
// NOKTASINI olcer; "degisken var mi" demek bu depoda defalarca kor bekci uretti.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const IX = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const LAUNCH = path.join(__dirname, '..', 'launch.cjs');

test('OG1 SMART 503`u OCO kapisindan SONRA doner (erisilemezlik kapandi)', () => {
  const govde = IX.slice(IX.indexOf('async function runScaleXGates'), IX.indexOf('// ── GERI ALMA KILIDI'));
  const kapi = govde.indexOf('runChangeGates(');
  const smart503 = govde.indexOf("code: 'smart_not_configured'");
  assert.ok(kapi > 0, 'runChangeGates cagrisi bulunamadi');
  assert.ok(smart503 > 0, 'SMART 503 bulunamadi');
  assert.ok(
    smart503 > kapi,
    'SMART 503 hala OCO kapisindan ONCE — OCO koduna ulasilamaz (uretimdeki ariza)',
  );
});

test('OG2 `ocoCheck` ADMIN AYARINDAN okunuyor, sabit DEGIL', () => {
  const govde = IX.slice(IX.indexOf('async function runScaleXGates'), IX.indexOf('// ── GERI ALMA KILIDI'));
  // Eski hali: `ocoCheck: { enabled: policy.oco === 'require' }` — admin ekranindaki
  // anahtar ScaleX icin HICBIR SEY yapmiyordu.
  assert.match(govde, /svcConfig\.ocoCheck/, 'admin ayari OKUNMUYOR');
  assert.match(govde, /ocoCfg\.enabled !== false/, 'varsayilan ACIK degil — ayar satiri yoksa kapi SESSIZCE inerdi');
});

test('OG3 kapali kapi DENETIME yaziliyor (sessiz kapanma yok)', () => {
  const govde = IX.slice(IX.indexOf('async function runScaleXGates'), IX.indexOf('// ── GERI ALMA KILIDI'));
  assert.match(govde, /scalex_oco_gate_disabled/, 'kapali kapi denetime yazilmiyor');
  // Kosul: YALNIZCA prod'da ve YALNIZCA admin kapattiginda.
  assert.match(govde, /policy\.oco === 'require' && !ocoAdminEnabled/, 'kosul yanlis — her durumda ya da hic yazilir');
});

// ── gatePolicyFor: EKRAN ile SUNUCU AYRISMAMALI ────────────────────────────
function policyFn() {
  const src = fs.readFileSync(LAUNCH, 'utf8');
  const i = src.indexOf('function gatePolicyFor');
  const j = src.indexOf('function buildGateVars');
  const k = src.indexOf('function isProdEnv');
  const kSon = src.indexOf('\n}', k) + 2;
  return new Function(`${src.slice(k, kSon)}\n${src.slice(i, j)}\nreturn gatePolicyFor;`)();
}

test('OG4 ayar yokken bugunku davranis AYNEN surer (prod`da require)', () => {
  const g = policyFn();
  assert.equal(g({ action: 'stop', executionMode: 'apply', environment: 'prod' }).oco, 'require');
  assert.equal(g({ action: 'stop', executionMode: 'apply', environment: 'test' }).oco, 'skip');
  // Ortam BILINMIYORSA prod sayilir — bu kural korunmali.
  assert.equal(g({ action: 'stop', executionMode: 'apply', environment: '' }).oco, 'require');
  assert.equal(g({ action: 'stop', executionMode: 'dry_run', environment: 'prod' }).oco, 'skip');
});

test('OG5 admin kapatirsa prod`da da sorulmaz AMA `ocoGateDisabled` ile GORUNUR', () => {
  const g = policyFn();
  const p = g({ action: 'stop', executionMode: 'apply', environment: 'prod', ocoConfig: { enabled: false } });
  assert.equal(p.oco, 'skip', 'admin kapattigi halde hala isteniyor');
  assert.equal(p.ocoGateDisabled, true, 'kapali kapi GORUNMUYOR — sessiz kapanma');
  // SMART kapisi bundan ETKILENMEZ.
  assert.equal(p.smart, 'require', 'OCO ayari SMART kapisini da indirmis');
});

test('OG6 ortam listesi verilirse O liste gecerli (prod disi ortamda da istenebilir)', () => {
  const g = policyFn();
  const cfg = { enabled: true, environments: ['prod', 'test'] };
  assert.equal(g({ action: 'stop', executionMode: 'apply', environment: 'test', ocoConfig: cfg }).oco, 'require');
  assert.equal(g({ action: 'stop', executionMode: 'apply', environment: 'dev', ocoConfig: cfg }).oco, 'skip');
  // Harf duyarsiz: katalogdaki etiket 'PROD' olabilir.
  assert.equal(g({ action: 'stop', executionMode: 'apply', environment: 'PROD', ocoConfig: cfg }).oco, 'require');
});

test('OG7 BOS liste "hicbir ortam" demektir, liste YOKLUGUNDAN farklidir', () => {
  const g = policyFn();
  // Liste yok -> prod'da istenir
  assert.equal(g({ action: 'stop', executionMode: 'apply', environment: 'prod', ocoConfig: { enabled: true } }).oco, 'require');
  // Bos liste -> hicbir yerde istenmez, AMA prod'da GORUNUR olur
  const bos = g({ action: 'stop', executionMode: 'apply', environment: 'prod', ocoConfig: { enabled: true, environments: [] } });
  assert.equal(bos.oco, 'skip', 'bos liste "her prod" gibi ele alinmis');
});

test('OG8 ortak kapi (`change-gates`) ayni listeyi TANIYOR — ekran/sunucu ayrismaz', () => {
  const cg = require('../../ansible/change-gates.cjs');
  const gateVars = { env: 'test' };
  // Liste YOKSA: prod degil -> kapi kapali (bugunku kural)
  assert.equal(cg.isOcoGateApplicable({ ocoCheck: { enabled: true } }, {}, gateVars), false);
  // Liste VARSA: test listede -> kapi ACIK
  assert.equal(
    cg.isOcoGateApplicable({ ocoCheck: { enabled: true, environments: ['test'] } }, {}, gateVars),
    true,
    'ortak kapi ortam listesini TANIMIYOR — /preview ister, /run reddeder',
  );
  // Bos liste -> hicbir ortam
  assert.equal(
    cg.isOcoGateApplicable({ ocoCheck: { enabled: true, environments: [] } }, {}, { env: 'prod' }),
    false,
  );
  // enabled=false her seyi kapatir
  assert.equal(
    cg.isOcoGateApplicable({ ocoCheck: { enabled: false, environments: ['prod'] } }, {}, { env: 'prod' }),
    false,
  );
});

test('OG9 UC ucun hepsi ayni OCO ayarini okuyor (politika ayrismaz)', () => {
  // Bu dosyada tam bu sinifta bir ariza yasandi: `/preview` ile `/run` farkli
  // politika uretiyor, ekran numara istiyor, sunucu numarayi kullanmiyordu.
  const kez = (IX.match(/ocoConfig: await readOcoConfig\(\)/g) || []).length;
  assert.equal(kez, 3, `gatePolicyFor cagri yerlerinin ${kez} tanesi ayari okuyor, 3 olmali`);
  assert.match(IX, /async function readOcoConfig/, 'ortak okuyucu yok — her uc kendi okursa AYRISIR');
});

test('OG10 DB okunamazsa kapi ACIK kalir (fail-safe yonu dogru)', () => {
  const govde = IX.slice(IX.indexOf('async function readOcoConfig'), IX.indexOf('async function runScaleXGates'));
  assert.match(govde, /return \{\}/, 'hata halinde bos ayar donmuyor');
  // Bos ayar -> `enabled !== false` -> ACIK. Ters yon (DB tokezlemesi kapiyi
  // KAPATSA) bir kesinti aracinda kabul edilemezdi.
  const g = policyFn();
  assert.equal(g({ action: 'stop', executionMode: 'apply', environment: 'prod', ocoConfig: {} }).oco, 'require');
});
