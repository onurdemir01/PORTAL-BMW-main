// server/ansible/__tests__/scalex-execute-toplu.test.cjs
//
// TOPLU EXECUTE — once hazirla, sonra patch, sonra TEK dogrulama dongusu.
//
// OLCULEN SORUN: seri yolda her uygulama kendi dogrulamasini bitirmeden
// sonrakine gecilmiyordu. Kapatmada bu, pod'larin terminationGracePeriod'u
// kadar bekleme demek: 19 uygulama x ~30 sn = ~10 dk, CLUSTER BASINA. Pod'lar
// ise PARALEL kapanir.
//
// KORUNAN UC SEY:
//   * DOGRULUK (K2): satirlar uygulama ICINDE birebir ayni ve cluster'in SON
//     DURUMU (replica, durum kaydi, HPA sabitleme) ayni. Altin cikti toplu
//     yola gecilmeden ONCEKI betikle (origin/main) uretildi.
//   * HIZ (K1): dogrulama okumasi uygulama sayisindan BAGIMSIZ ve hicbir
//     dogrulama okumasi son patch'ten ONCE yapilmiyor.
//   * GUVENLIK (K3): durum kaydi yazilamayan uygulama HIC patch'lenmez.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { SENARYOLAR, executeKostur } = require('./fixtures/scalex-execute-senaryolar.cjs');
const ALTIN = require('./fixtures/scalex-execute-altin.json');

const SERI = { SCALEX_BATCH_EXECUTE: 'false' };

// ── K2: SATIRLAR VE SON DURUM ALTIN CIKTIYLA AYNI (toplu VE seri) ──────────
//
// Seri yol da sinanir: geri donus anahtari (`scalex_batch_execute: false`)
// bir acil cikis — calismadigi fark edildiginde gec olur.
for (const [ad, senaryo] of Object.entries(SENARYOLAR)) {
  test(`K2 toplu execute altin ciktiyla ayni: ${ad}`, () => {
    const r = executeKostur(senaryo);
    assert.deepEqual(r.gruplu, ALTIN[ad].gruplu, 'uygulama ici satirlar degisti');
    assert.deepEqual(r.son, ALTIN[ad].son, 'cluster`in son durumu degisti');
  });
  test(`K2b seri execute (geri donus) altin ciktiyla ayni: ${ad}`, () => {
    const r = executeKostur({ ...senaryo, env: { ...senaryo.env, ...SERI } });
    assert.deepEqual(r.gruplu, ALTIN[ad].gruplu);
    assert.deepEqual(r.son, ALTIN[ad].son);
  });
}

// ── K1: DOGRULAMA TEK DONGU ─────────────────────────────────────────────────
//
// Her uygulama patch'ten sonra BIR okumada hala eski durumda gorunur (pod'lar
// kapaniyor), ikincide hedefe ulasir. Seri yol uygulama basina iki okuma ve
// bir bekleme yapar; toplu yol N'den bagimsiz iki TUR yapar.
//
// SURE OLCULMUYOR (duvar saati esigi makine yukunu olcer). Olcut: dogrulama
// okumasi SAYISI ve SIRASI.
function nUygulama(n) {
  const adlar = Array.from({ length: n }, (_, i) => `app-${i}`);
  return {
    env: {
      ACTION: 'stop',
      WORKLOAD_KINDS: adlar.map((a) => `${a}=deploy`).join(','),
      APP_RAW: adlar.join(','),
    },
    model: {
      nesneler: {
        deploy: adlar.map((a) => ({ name: a, spec: 2, gecikme: 1 })),
        sts: [],
        dc: [],
        rollout: [],
      },
      cm: {},
    },
  };
}
const dogrulamaOkumasi = (c) => /\{\.status\.replicas\}\|\{\.status\.readyReplicas\}/.test(c);

test('K1 dogrulama okumasi uygulama sayisindan BAGIMSIZ, hepsi son patch`ten SONRA', () => {
  const kucuk = executeKostur(nUygulama(2));
  const buyuk = executeKostur(nUygulama(6));
  const say = (r) => r.cagrilar.filter(dogrulamaOkumasi).length;
  assert.equal(
    say(buyuk),
    say(kucuk),
    `6 uygulama ${say(buyuk)}, 2 uygulama ${say(kucuk)} dogrulama okumasi — beklemeler uygulama basina`,
  );
  // KORLUK PANZEHIRI: okuma sayisi dusurmenin en kolay yolu dogrulamayi
  // atlamak. Alti uygulamanin ALTISI da VERIFY;OK almis olmali.
  assert.equal(buyuk.satirlar.filter((l) => /;VERIFY;OK;/.test(l)).length, 6);
  // SIRA: son patch, ilk dogrulama okumasindan ONCE. Aksi halde uygulamalar
  // hala birer birer bekleniyor demektir.
  const sonPatch = buyuk.cagrilar.map((c) => /^patch deploy /.test(c)).lastIndexOf(true);
  const ilkOkuma = buyuk.cagrilar.findIndex(dogrulamaOkumasi);
  assert.ok(
    sonPatch >= 0 && ilkOkuma > sonPatch,
    `dogrulama (${ilkOkuma}) son patch'ten (${sonPatch}) once basliyor`,
  );
  // Ve seri yol GERCEKTEN uygulama basina okuyordu — bekci neyi olctugunu
  // kaybetmesin.
  const seri = executeKostur({ ...nUygulama(6), env: { ...nUygulama(6).env, ...SERI } });
  assert.ok(say(seri) >= 12, `seri yol ${say(seri)} okuma — olcum anlamsizlasti`);
});

// ── K3: DURUM KAYDI YAZILAMAYAN UYGULAMA PATCH'LENMEZ ───────────────────────
//
// "Once hepsini hazirla" sirasi bu kurali GEVSETMEMELI: kayit yoksa geri
// alma imkansiz ve replica 0'a indirilmis bir uygulama sessizce kaybolur.
// Kural UYGULAMA BASINA: `odeme-api`nin kaydi yazilamiyor -> patch YOK.
// `kafka`nin gecerli bir `scaled_down` kaydi ZATEN var (yazim gerekmiyor) ->
// patch'lenir. Ikinci yari bekcinin korlugunu da kapatir: "hic patch yok"
// assert'i butun patch'leri silen bir mutasyonla da gecerdi.
test('K3 durum kaydi yazilamayan uygulama patch`lenmez, kaydi hazir olan patch`lenir', () => {
  const r = executeKostur(SENARYOLAR['stop-durum-yazilamaz']);
  const patch = (ad) => r.cagrilar.filter((c) => new RegExp(`^patch (deploy|sts) ${ad} `).test(c));
  assert.deepEqual(
    patch('odeme-api'),
    [],
    'kaydi yazilamayan uygulama patch`lendi — geri alinamaz',
  );
  assert.equal(r.son.nesneler['deploy/odeme-api'], 3);
  assert.equal(patch('kafka').length, 1, 'kaydi hazir olan uygulama patch`lenmedi');
  assert.equal(r.son.nesneler['sts/kafka'], 0);
});

// ── K4: TAKILI UYGULAMA DIGERLERINI BEKLETMEZ ───────────────────────────────
//
// Seri yolda takili bir uygulama (FAIL esigine kadar) arkasindaki uygulamalarin
// patch'ini de geciktiriyordu. Toplu yolda patch'lerin hepsi dogrulamadan once
// yapilir: takili uygulama listenin BASINDA olsa bile digeri hemen kapatilir.
test('K4 takili uygulama listenin basinda olsa bile digerinin patch`i beklemez', () => {
  const s = SENARYOLAR['stop-takili'];
  const r = executeKostur({ ...s, env: { ...s.env, APP_RAW: 'kafka,odeme-api' } });
  const ilkOkuma = r.cagrilar.findIndex(dogrulamaOkumasi);
  const odemePatch = r.cagrilar.findIndex((c) => /^patch deploy odeme-api /.test(c));
  assert.ok(
    odemePatch >= 0 && odemePatch < ilkOkuma,
    'ikinci uygulamanin patch`i takili uygulamanin dogrulamasini bekledi',
  );
  assert.ok(r.satirlar.some((l) => /;odeme-api;Deployment;VERIFY;OK;/.test(l)));
  assert.ok(r.satirlar.some((l) => /;kafka;StatefulSet;VERIFY;FAIL;/.test(l)));
});
