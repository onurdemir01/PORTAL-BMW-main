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
//
// 2026-10-14: OLCUM ARTIK DAVRANISTAN. Bu dosyanin ilk hali "SMART reddi OCO'dan SONRA
// mi" diye KAYNAK SIRASINA bakiyordu ve politika fonksiyonunu kaynaktan dilimleyip
// calistiriyordu. Sira bilerek degisti (SMART hazir degilse OCO HIC sorulmaz: is zaten
// baslayamaz) ve dilim, yeni bir yardimci fonksiyon eklenince kirildi. "OCO koduna
// ulasilabiliyor mu" sorusunun dogru olcusu sira degil, OCO servisinin GERCEKTEN
// soruldugudur: istek gercek yonlendiriciden gecer (bkz. fixtures/scalex-sim.cjs).
'use strict';

const sim = require('./fixtures/scalex-sim.cjs');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const IX = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const g = sim.launch.gatePolicyFor;

test.before(() => sim.baslat());
test.after(() => sim.durdur());
test.beforeEach(() => sim.sifirla());

test('OG1 OCO kapisi ERISILEBILIR: SMART devrede degilken de hazirken de OCO servisi SORULUR', async (t) => {
  sim.konsoluSustur(t);
  // Uretimdeki ariza: HER prod `apply` OCO'ya varmadan oluyordu (13,5 gunde 0 sorgu).
  // SMART kapali (admin anahtari):
  sim.smartKipi('oco_only');
  let r = await sim.calistir({ ocoNumber: '1234567' });
  assert.equal(r.status, 200, r.metin);
  assert.equal(sim.kayit.ocoSorgulari.length, 1, 'SMART kapaliyken OCO sorulmadi');
  // SMART hazir:
  sim.sifirla();
  sim.ayar.ozellestirme = { smartApproval: { ...sim.SMART_HAZIR } };
  r = await sim.calistir({ ocoNumber: '1234567' });
  assert.equal(r.json.pendingApproval, true, r.metin);
  assert.equal(sim.kayit.ocoSorgulari.length, 1, 'SMART hazirken OCO sorulmadi');
  // OCO hatasi SMART biletinden ONCE gelir: penceresi gecmis bir kayit icin bilet acilmaz.
  sim.sifirla();
  sim.ayar.ozellestirme = { smartApproval: { ...sim.SMART_HAZIR } };
  sim.ayar.oco = 'gecti';
  r = await sim.calistir({ ocoNumber: '1234567' });
  assert.equal(r.json.ocoExpired, true, r.metin);
  assert.equal(sim.kayit.smartTalepleri.length, 0, 'penceresi gecmis OCO icin SMART bileti acildi');
  // BILEREK DEGISEN SIRA: SMART gerekli + hazir degil -> OCO HIC sorulmaz.
  sim.sifirla();
  r = await sim.calistir({ ocoNumber: '1234567' });
  assert.equal(r.json.code, 'smart_not_configured');
  assert.equal(sim.kayit.ocoSorgulari.length, 0);
});

test('OG2 `ocoCheck` ADMIN AYARINDAN okunuyor, sabit DEGIL; ayar satiri YOKSA kapi ACIK', async (t) => {
  sim.konsoluSustur(t);
  sim.smartKipi('oco_only');
  // Satir yok (uretimdeki durum) -> numara istenir.
  let r = await sim.calistir();
  assert.equal(r.json.ocoRequired, true, 'ayar satiri yokken kapi SESSIZCE indi');
  assert.equal(sim.baslatmalar().length, 0);
  // Admin kapatti -> numarasiz baslar.
  sim.sifirla();
  sim.smartKipi('oco_only');
  sim.ayar.ozellestirme = { ocoCheck: { enabled: false } };
  r = await sim.calistir();
  assert.equal(r.status, 200, 'admin ekranindaki anahtar ScaleX icin hicbir sey yapmiyor');
  assert.equal(sim.kayit.ocoSorgulari.length, 0);
});

test('OG3 kapali kapi DENETIME yaziliyor (sessiz kapanma yok) — yalniz prod`da, yalniz admin kapattiginda', async (t) => {
  sim.konsoluSustur(t);
  sim.smartKipi('oco_only');
  sim.ayar.ozellestirme = { ocoCheck: { enabled: false } };
  await sim.calistir();
  assert.equal(sim.denetimde('scalex_oco_gate_disabled').length, 1, 'kapali kapidan gecen prod isi iz birakmadi');
  // Prod disi: kapinin istenmemesi normal, iz gurultu olurdu.
  sim.sifirla();
  sim.ayar.ozellestirme = { ocoCheck: { enabled: false } };
  await sim.calistir({ env: 'test' });
  assert.equal(sim.denetimde('scalex_oco_gate_disabled').length, 0);
  // Kapi ACIKKEN: iz yok.
  sim.sifirla();
  sim.smartKipi('oco_only');
  await sim.calistir({ ocoNumber: '1234567' });
  assert.equal(sim.denetimde('scalex_oco_gate_disabled').length, 0, 'acik kapi "kapali" diye izlendi');
});

// ── gatePolicyFor: EKRAN ile SUNUCU AYRISMAMALI ────────────────────────────
// GERCEK fonksiyon cagrilir (kaynak dilimi degil).
test('OG4 ayar yokken bugunku davranis AYNEN surer (prod`da require)', () => {
  assert.equal(g({ action: 'stop', executionMode: 'apply', environment: 'prod' }).oco, 'require');
  assert.equal(g({ action: 'stop', executionMode: 'apply', environment: 'test' }).oco, 'skip');
  // Ortam BILINMIYORSA prod sayilir — bu kural korunmali.
  assert.equal(g({ action: 'stop', executionMode: 'apply', environment: '' }).oco, 'require');
  assert.equal(g({ action: 'stop', executionMode: 'dry_run', environment: 'prod' }).oco, 'skip');
});

test('OG5 admin kapatirsa prod`da da sorulmaz AMA `ocoGateDisabled` ile GORUNUR', () => {
  const p = g({ action: 'stop', executionMode: 'apply', environment: 'prod', ocoConfig: { enabled: false } });
  assert.equal(p.oco, 'skip', 'admin kapattigi halde hala isteniyor');
  assert.equal(p.ocoGateDisabled, true, 'kapali kapi GORUNMUYOR — sessiz kapanma');
  // SMART kapisi bundan ETKILENMEZ.
  assert.equal(p.smart, 'require', 'OCO ayari SMART kapisini da indirmis');
});

test('OG6 ortam listesi verilirse O liste gecerli (prod disi ortamda da istenebilir)', () => {
  const cfg = { enabled: true, environments: ['prod', 'test'] };
  assert.equal(g({ action: 'stop', executionMode: 'apply', environment: 'test', ocoConfig: cfg }).oco, 'require');
  assert.equal(g({ action: 'stop', executionMode: 'apply', environment: 'dev', ocoConfig: cfg }).oco, 'skip');
  // Harf duyarsiz: katalogdaki etiket 'PROD' olabilir.
  assert.equal(g({ action: 'stop', executionMode: 'apply', environment: 'PROD', ocoConfig: cfg }).oco, 'require');
});

test('OG7 BOS liste "hicbir ortam" demektir, liste YOKLUGUNDAN farklidir', () => {
  // Liste yok -> prod'da istenir
  assert.equal(g({ action: 'stop', executionMode: 'apply', environment: 'prod', ocoConfig: { enabled: true } }).oco, 'require');
  // Bos liste -> hicbir yerde istenmez
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

test('OG9 kapi politikasi TEK yerde cozuluyor; ekran ve sunucu ayni ayari goruyor', async (t) => {
  sim.konsoluSustur(t);
  // Bu dosyada tam bu sinifta bir ariza yasandi: `/preview` ile `/run` farkli politika
  // uretiyor, ekran numara istiyor, sunucu numarayi kullanmiyordu.
  // DAVRANIS: admin `test`i listeye ekler -> onizleme ister, calistirma da ister.
  sim.ayar.ozellestirme = { ocoCheck: { enabled: true, environments: ['test'] } };
  assert.equal((await sim.onizle({ env: 'test' })).json.gatePolicy.oco, 'require');
  assert.equal((await sim.calistir({ env: 'test' })).json.ocoRequired, true, 'onizleme ister, calistirma sormaz');
  // ...ve prod listede YOK -> ikisi de istemez (SMART ayri kapi; yalniz OCO olculuyor).
  sim.smartKipi('oco_only');
  assert.equal((await sim.onizle()).json.gatePolicy.oco, 'skip');
  assert.equal((await sim.calistir()).status, 200);
  assert.equal(sim.kayit.ocoSorgulari.length, 0);

  // YAPI: `gatePolicyFor` yalniz ortak cozucuden cagrilir. Bir uc onu DOGRUDAN cagirirsa
  // ayari kendi okumak zorunda kalir ve uclar yine ayrisir.
  const kod = IX.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.equal((kod.match(/gatePolicyFor\(/g) || []).length, 1, '`gatePolicyFor` birden fazla yerden cagriliyor');
  const cozucu = kod.slice(kod.indexOf('async function resolveGatePolicy'), kod.indexOf('function istemciyeUlasan'));
  assert.match(cozucu, /gatePolicyFor\(/, 'tek cagri ortak cozucude degil');
  assert.ok((kod.match(/await resolveGatePolicy\(req, \{/g) || []).length >= 4, 'uclar ortak cozucuyu kullanmiyor');
});

test('OG10 ayar okunamazsa kapi ACIK kalir (fail-safe yonu dogru)', async (t) => {
  sim.konsoluSustur(t);
  // `ss-customizations.readCustom` DB okunamayinca BOS NESNE doner (firlatmaz). Bos ayar
  // -> `enabled !== false` -> OCO ACIK; SMART "hazir degil". Ters yon (DB tokezlemesi
  // kapiyi KAPATSA) bir kesinti aracinda kabul edilemezdi.
  sim.ayar.ozellestirme = null;
  const p = (await sim.onizle()).json.gatePolicy;
  assert.equal(p.oco, 'require');
  assert.equal(p.smart, 'require');
  assert.equal(g({ action: 'stop', executionMode: 'apply', environment: 'prod', ocoConfig: {} }).oco, 'require');
  const r = await sim.calistir({ ocoNumber: '1234567' });
  assert.equal(sim.baslatmalar().length, 0, 'ayar yokken prod isi BASLADI');
  assert.equal(r.status, 409);
});
