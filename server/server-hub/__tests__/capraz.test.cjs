// server/server-hub/__tests__/capraz.test.cjs - Server Hub capraz kontrolleri (2026-11-06).
//
// Kullanici: "auto-start degeri false uygulama ayakta ise ya da tam tersi ise bunlar da risktir,
// retirement icin suphedir. bu ve bunun gibi seyleri portal genelindeki butun verilerden al incele
// carp karsilastir". Anket: kopyalar / ortamlar tutarsiz, OpenShift'e tasinmis + Retirement kaydi.
//
//   C1 ad kurallari: taban ad (-D/-T/-Q, kucuk harf; tanimsiz ek ad olarak kalir), normAd
//   C2 kopya: ayni ortam + nesil + ad; kapali kopya, azinlik auto-start (esitlikte 'false'); baska
//      ortam / nesil / bayat / taramadan dusen sunucu karismaz; olculemeyen kopya "kapali" sayilmaz
//   C3 kalinti: prod yok / kapali / Retirement'la durdurulmus; envanter prod biliyorsa, prod calisiyor,
//      bayat ya da olculemiyorsa iddia YOK; QA sayilir, EDU sayilmaz; OpenShift prod notu
//   C4 ocp: ortam grubu (DEV+TEST tek), normalize birebir ad, Dynatrace var / yok / olculemedi /
//      okunamadi, aday ve "tasinmis olabilir" kosullari
//   C5 celiski: stopped / deleted x calisiyor / auto-start / paket diskte; nesil, kisa host, bayat,
//      .old paket; JVM yokken paket -> sunucu duzeyi; Retirement baglami her durumda
//   C6 okunamayan kaynak: OpenShift / Dynatrace / Retirement okunamazsa ona dayanan sonuc YOK
//   C7 bulgu metinleri: hangi kopya, hangi namespace, hangi kayit
//   C8 capraz-veri: uc kaynak ayri okunur, biri duserse digerleri gelir; 10 dk onbellek, dusen
//      kaynak onbellege alinmaz; durum ozeti indeks tasimaz
//   C9 HIZ: 2000 sunucu / 24 bin JVM tek gecis indeksiyle 1,5 sn altinda
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function stub(rel, exports) {
  const p = require.resolve(rel);
  const m = new Module(p);
  m.filename = p;
  m.loaded = true;
  m.exports = exports;
  require.cache[p] = m;
}

// ── sahte kaynaklar (C8) ────────────────────────────────────────────────────────────
const K = {
  ocp: [],
  kullanim: [],
  ret: [],
  ocpDus: false,
  kullanimDus: false,
  retDus: false,
  sorgu: [],
};
const N = (s) => String(s).replace(/\s+/g, ' ').trim();
stub('../../inventory/mssql.cjs', {
  query: async (sql) => {
    const s = N(sql);
    K.sorgu.push(s.slice(0, 60));
    if (s.includes('FROM dbo.Openshift_Inventory')) {
      if (K.ocpDus) throw new Error('Openshift_Inventory okunamadi');
      return { recordset: K.ocp };
    }
    if (s.includes('FROM dbo.BMW_Application_Usage')) {
      if (K.kullanimDus) throw new Error('timeout');
      return { recordset: K.kullanim };
    }
    throw new Error(`sahte envanter bilinmeyen SQL: ${s.slice(0, 80)}`);
  },
});
stub('../../db/index.cjs', {
  query: async (sql) => {
    const s = N(sql);
    if (s.includes('FROM retirement_targets t JOIN retirement_records r')) {
      if (K.retDus) throw new Error('baglanti yok');
      return { rows: K.ret };
    }
    throw new Error(`sahte DB bilinmeyen SQL: ${s.slice(0, 80)}`);
  },
});

const {
  caprazAnaliz,
  tabanAd,
  normAd,
  kopyaMetni,
  kalintiMetni,
  ocpMetni,
  celiskiMetni,
} = require('../capraz.cjs');
const { caprazVeri, caprazDurumu, ocpIndeksi, _sifirla } = require('../capraz-veri.cjs');
const { olcumIndeksi } = require('../../nginx-console/spa-discovery.cjs');

// ── saf fiksturler ──────────────────────────────────────────────────────────────────
const H = (host, env, jvms, ek = {}) => ({
  host,
  env,
  fresh: true,
  taramadanDustu: false,
  jvms,
  ...ek,
});
const J = (name, ek = {}) => ({
  gen: 7,
  name,
  running: true,
  runningKnown: true,
  autoStart: 'true',
  trafficState: 'ACTIVE',
  ...ek,
});
const KAPALI = { running: false };
const OCP = (rows) => ({ okunamadi: false, indeks: ocpIndeksi(rows) });
const KUL = (rows) => ({ okunamadi: false, indeks: olcumIndeksi(rows) });
const RET = (hedefler) => ({ okunamadi: false, hedefler });
const ocpSatir = (application, namespace, cluster = 'gbocpprod1') => ({
  cluster,
  namespace,
  application,
});
const kulSatir = (app, namespace, req, ek = {}) => ({
  cluster: 'gbocpprod1',
  namespace,
  app,
  scan_date: '2026-11-05',
  window_days: 7,
  req_total: req,
  services_total: 1,
  measured: 1,
  note: '',
  ...ek,
});
const hedef = (host, uygulama, durum, ek = {}) => ({
  hedef: 7,
  kayit: 12,
  host,
  uygulama,
  gen: 7,
  yol: `/vhosting/${uygulama}.ear`,
  durum,
  kayitDurum: 'open',
  durduruldu: '2026-10-20',
  ...ek,
});
const ac = (hostlar, g) => caprazAnaliz(hostlar, g);
const jv = (r, host, hostlar, ad, gen = 7) =>
  r.jvm(
    host,
    hostlar.find((h) => h.host === host).jvms.find((j) => j.name === ad && j.gen === gen),
  );

test('C1 ad kurallari: taban ad ve normAd', () => {
  assert.equal(tabanAd('ODEME-T'), 'ODEME');
  assert.equal(tabanAd('ODEME-D'), 'ODEME');
  assert.equal(tabanAd('ODEME-Q'), 'ODEME');
  assert.equal(tabanAd('odeme-t'), 'odeme', 'kucuk harfli ek de atilir (parseApp ortami uygular)');
  assert.equal(tabanAd('ODEME'), 'ODEME');
  assert.equal(tabanAd('PAY-A'), 'PAY-A', 'tanimsiz tek harf ek atilmaz: gercek ad olabilir');
  assert.equal(tabanAd('X-RAY-T'), 'X-RAY');
  assert.equal(normAd('Odeme_App-1'), 'odemeapp1');
  assert.equal(normAd(' Odeme.App '), 'odemeapp');
});

test('C2 kopya: ayni ortamdaki sapan kopya isaretlenir; baska ortam / nesil / bayat karismaz', () => {
  // Calisma: biri calisiyor, biri kapali -> kapali olan.
  let hs = [H('P1', 'PROD', [J('pay')]), H('P2', 'PROD', [J('pay', KAPALI)])];
  let r = ac(hs);
  assert.equal(jv(r, 'P1', hs, 'pay'), null, 'calisan kopya isaretlenmez');
  assert.deepEqual(jv(r, 'P2', hs, 'pay').kopya.nedenler, ['calisma']);
  assert.deepEqual(jv(r, 'P2', hs, 'pay').kopya.digerleri, [
    { host: 'P1', calisiyor: true, autoStart: 'true' },
  ]);
  // Auto-start: azinlik isaretlenir.
  hs = [
    H('P1', 'PROD', [J('pay')]),
    H('P2', 'PROD', [J('pay', { autoStart: 'false' })]),
    H('P3', 'PROD', [J('pay')]),
  ];
  r = ac(hs);
  assert.deepEqual(jv(r, 'P2', hs, 'pay').kopya.nedenler, ['autostart']);
  assert.equal(jv(r, 'P1', hs, 'pay'), null);
  assert.equal(jv(r, 'P2', hs, 'pay').kopya.kopyaSayisi, 3);
  // Cogunluk 'false': 'true' olan sapar.
  hs = [
    H('P1', 'PROD', [J('pay', { autoStart: 'false' })]),
    H('P2', 'PROD', [J('pay', { autoStart: 'false' })]),
    H('P3', 'PROD', [J('pay')]),
  ];
  assert.deepEqual(jv(ac(hs), 'P3', hs, 'pay').kopya.nedenler, ['autostart']);
  // Esitlik: 'false' olan isaretlenir (kapatma yonu).
  hs = [H('P1', 'PROD', [J('pay')]), H('P2', 'PROD', [J('pay', { autoStart: 'false' })])];
  r = ac(hs);
  assert.equal(jv(r, 'P1', hs, 'pay'), null);
  assert.deepEqual(jv(r, 'P2', hs, 'pay').kopya.nedenler, ['autostart']);
  // Iki neden birden.
  hs = [
    H('P1', 'PROD', [J('pay')]),
    H('P2', 'PROD', [J('pay', { ...KAPALI, autoStart: 'false' })]),
    H('P3', 'PROD', [J('pay')]),
  ];
  assert.deepEqual(jv(ac(hs), 'P2', hs, 'pay').kopya.nedenler, ['calisma', 'autostart']);
  // Hepsi kapali (ayni auto-start): tutarli, kimse sapmiyor.
  hs = [H('P1', 'PROD', [J('pay', KAPALI)]), H('P2', 'PROD', [J('pay', KAPALI)])];
  r = ac(hs);
  assert.deepEqual([jv(r, 'P1', hs, 'pay'), jv(r, 'P2', hs, 'pay')], [null, null], 'hepsi kapali');
  // Baska ortam, baska nesil: kopya degil.
  hs = [
    H('P1', 'PROD', [J('pay')]),
    H('T1', 'TEST', [J('pay', KAPALI)]),
    H('P2', 'PROD', [J('pay', { ...KAPALI, gen: 8 })]),
  ];
  r = ac(hs);
  assert.equal(jv(r, 'T1', hs, 'pay'), null, 'baska ortam');
  assert.equal(jv(r, 'P2', hs, 'pay', 8), null, 'baska nesil');
  // Bayat ya da taramadan dusen sunucu karar vermez.
  hs = [H('P1', 'PROD', [J('pay')]), H('P2', 'PROD', [J('pay', KAPALI)], { fresh: false })];
  assert.equal(jv(ac(hs), 'P2', hs, 'pay'), null, 'bayat kopya');
  hs = [H('P1', 'PROD', [J('pay')]), H('P2', 'PROD', [J('pay', KAPALI)], { taramadanDustu: true })];
  assert.equal(jv(ac(hs), 'P2', hs, 'pay'), null, 'taramadan dusen');
  // Olculemeyen kopya "kapali" degildir.
  hs = [
    H('P1', 'PROD', [J('pay')]),
    H('P2', 'PROD', [J('pay', { running: false, runningKnown: false })]),
  ];
  assert.equal(jv(ac(hs), 'P2', hs, 'pay'), null, 'olculemeyen kopya kapali sayildi');
  // Ayni sunucuda tek kopya: grup degil. Ortami bilinmeyen sunucu da karismaz.
  hs = [H('P1', 'PROD', [J('pay'), J('pay', { ...KAPALI, gen: 7, name: 'pay' })])];
  assert.equal(ac(hs).jvm('P1', hs[0].jvms[1]), null, 'tek sunucu');
  hs = [H('B1', 'BILINMIYOR', [J('pay')]), H('B2', 'BILINMIYOR', [J('pay', KAPALI)])];
  assert.equal(jv(ac(hs), 'B2', hs, 'pay'), null, 'BILINMIYOR ortam');
});

test('C3 kalinti: prod calismiyor ama non-prod kopya calisiyor', () => {
  // Prod'da hic yok.
  let hs = [H('T1', 'TEST', [J('LEGACY-T')])];
  assert.equal(jv(ac(hs), 'T1', hs, 'LEGACY-T').kalinti.neden, 'PROD_YOK');
  assert.equal(jv(ac(hs), 'T1', hs, 'LEGACY-T').kalinti.taban, 'LEGACY');
  // Envanter taranmamis bir prod kopyasi biliyor: iddia kurulmaz.
  assert.equal(
    jv(ac(hs, { envanter: [{ app: 'LEGACY', env: 'PROD' }] }), 'T1', hs, 'LEGACY-T'),
    null,
  );
  assert.equal(
    jv(ac(hs, { envanter: [{ app: 'LEGACY-T', env: 'TEST' }] }), 'T1', hs, 'LEGACY-T').kalinti
      .neden,
    'PROD_YOK',
    'envanterdeki TEST satiri prod kaniti degil',
  );
  // Prod kopyasi kapali.
  hs = [H('T1', 'TEST', [J('LEGACY-T')]), H('P1', 'PROD', [J('LEGACY', KAPALI)])];
  const k = jv(ac(hs), 'T1', hs, 'LEGACY-T').kalinti;
  assert.equal(k.neden, 'PROD_KAPALI');
  assert.deepEqual(k.prodKopyalar, [{ host: 'P1', autoStart: 'true' }]);
  // Prod kopyasi Retirement'la durduruldu.
  const ret = RET([hedef('P1', 'LEGACY', 'stopped', { kayit: 31 })]);
  const kr = jv(ac(hs, { capraz: { retirement: ret } }), 'T1', hs, 'LEGACY-T').kalinti;
  assert.deepEqual([kr.neden, kr.retirement], ['PROD_RETIRE', [31]]);
  // Prod calisiyor / olculemiyor / bayat: iddia yok.
  hs = [H('T1', 'TEST', [J('LEGACY-T')]), H('P1', 'PROD', [J('LEGACY')])];
  assert.equal(jv(ac(hs), 'T1', hs, 'LEGACY-T'), null, 'prod calisiyor');
  hs = [
    H('T1', 'TEST', [J('LEGACY-T')]),
    H('P1', 'PROD', [J('LEGACY', { running: false, runningKnown: false })]),
  ];
  assert.equal(jv(ac(hs), 'T1', hs, 'LEGACY-T'), null, 'prod olculemedi');
  hs = [H('T1', 'TEST', [J('LEGACY-T')]), H('P1', 'PROD', [J('LEGACY', KAPALI)], { fresh: false })];
  assert.equal(jv(ac(hs), 'T1', hs, 'LEGACY-T'), null, 'prod bayat');
  // Kucuk harfli ek ve buyuk / kucuk harf: ayni taban.
  hs = [H('T1', 'TEST', [J('legacy-t')]), H('P1', 'PROD', [J('LEGACY')])];
  assert.equal(jv(ac(hs), 'T1', hs, 'legacy-t'), null, 'legacy-t ile LEGACY ayni uygulama');
  // QA sayilir, EDU sayilmaz; kapali non-prod kopya kalinti degil.
  hs = [
    H('Q1', 'QA', [J('LEGACY-Q')]),
    H('E1', 'EDU', [J('LEGACY')]),
    H('T1', 'TEST', [J('LEGACY-T', KAPALI)]),
  ];
  const r = ac(hs);
  assert.equal(jv(r, 'Q1', hs, 'LEGACY-Q').kalinti.neden, 'PROD_YOK');
  assert.equal(jv(r, 'E1', hs, 'LEGACY'), null, 'EDU');
  assert.equal(jv(r, 'T1', hs, 'LEGACY-T'), null, 'kapali test kopyasi');
  // Bayat non-prod kopya iddia kurmaz.
  hs = [H('T1', 'TEST', [J('LEGACY-T')], { fresh: false })];
  assert.equal(jv(ac(hs), 'T1', hs, 'LEGACY-T'), null);
  // OpenShift prod'da var: not.
  hs = [H('T1', 'TEST', [J('LEGACY-T')])];
  const ko = jv(
    ac(hs, { capraz: { ocp: OCP([ocpSatir('legacy', 'legacy-prod')]) } }),
    'T1',
    hs,
    'LEGACY-T',
  ).kalinti;
  assert.deepEqual(ko.ocpProd, [{ namespace: 'legacy-prod', cluster: 'gbocpprod1' }]);
  assert.equal(
    jv(ac(hs), 'T1', hs, 'LEGACY-T').kalinti.ocpProd,
    null,
    'OpenShift okunmadiysa not yok (bos dizi degil)',
  );
});

test('C4 ocp: ayni ortam grubu, birebir normalize ad, Dynatrace ve aday kosullari', () => {
  const ocp = OCP([
    ocpSatir('pay', 'pay-prod'),
    ocpSatir('pay', 'pay-prod', 'gbocpprod2'),
    ocpSatir('pay', 'pay-test', 'gbocptest1'),
    ocpSatir('Odeme_App', 'odeme-dev', 'gbocptest1'),
    ocpSatir('pay-app', 'payapp-qa', 'gbocpqa1'),
    ocpSatir('falcon', 'falcon-operator'),
  ]);
  const hs = [
    H('P1', 'PROD', [J('pay'), J('falcon')]),
    H('T1', 'TEST', [J('pay-T'), J('ODEME-APP-T')]),
    H('D1', 'DEV', [J('pay-D')]),
    H('Q1', 'QA', [J('pay-Q'), J('PAY-APP-Q')]),
  ];
  const kullanim = KUL([
    kulSatir('pay', 'pay-prod', 120),
    kulSatir('pay', 'pay-prod', 30, { cluster: 'gbocpprod2' }),
  ]);
  const r = ac(hs, { capraz: { ocp, kullanim } });
  const p = jv(r, 'P1', hs, 'pay').ocp;
  assert.deepEqual(
    p.eslesme.map((x) => [x.namespace, x.cluster]),
    [
      ['pay-prod', 'gbocpprod1'],
      ['pay-prod', 'gbocpprod2'],
    ],
  );
  assert.deepEqual(
    [p.istek, p.istekOlculdu, p.pencereGun],
    [150, true, 7],
    'cluster toplanir, namespace|app bir kez',
  );
  assert.deepEqual(
    [p.aday, p.tasinmisOlabilir],
    [true, false],
    'OpenShift istek aliyor -> aday; JBoss canli -> tasinma yok',
  );
  assert.deepEqual(
    jv(r, 'T1', hs, 'pay-T').ocp.eslesme.map((x) => x.namespace),
    ['pay-test'],
    'TEST yalniz -test',
  );
  assert.deepEqual(
    jv(r, 'D1', hs, 'pay-D').ocp.eslesme.map((x) => x.namespace),
    ['pay-test'],
    'DEV + TEST tek grup',
  );
  assert.equal(jv(r, 'Q1', hs, 'pay-Q'), null, 'QA namespace yok');
  assert.deepEqual(jv(r, 'T1', hs, 'ODEME-APP-T').ocp.ad, {
    jboss: 'ODEME-APP-T',
    taban: 'ODEME-APP',
    ocp: 'Odeme_App',
  });
  assert.deepEqual(
    jv(r, 'Q1', hs, 'PAY-APP-Q').ocp.eslesme.map((x) => x.namespace),
    ['payapp-qa'],
    'pay-app ~ PAY-APP',
  );
  assert.equal(jv(r, 'P1', hs, 'falcon'), null, 'ortami olmayan namespace (operator) eslesmez');
  // Olculmeyen namespace: istek null ('yok' degil); olculen yerde istek varsa sayi kalir.
  const t = jv(r, 'T1', hs, 'pay-T').ocp;
  assert.deepEqual([t.istek, t.istekOlculdu], [null, false]);
  assert.deepEqual(
    [t.aday, t.tasinmisOlabilir],
    [false, false],
    'canli + trafikli JBoss, olculmeyen OpenShift: aday degil',
  );
  // Kapali / trafiksiz JBoss: aday; OpenShift istek aliyorsa "tasinmis olabilir".
  const hk = [
    H('P1', 'PROD', [J('pay', KAPALI)]),
    H('P2', 'PROD', [J('pay', { trafficState: 'NO_RECENT_TRAFFIC' })]),
  ];
  const rk = ac(hk, { capraz: { ocp, kullanim } });
  assert.deepEqual(
    [jv(rk, 'P1', hk, 'pay').ocp.aday, jv(rk, 'P1', hk, 'pay').ocp.tasinmisOlabilir],
    [true, true],
  );
  assert.deepEqual(
    [jv(rk, 'P2', hk, 'pay').ocp.aday, jv(rk, 'P2', hk, 'pay').ocp.tasinmisOlabilir],
    [true, true],
  );
  // JBoss bosta ama OpenShift istek ALMIYOR (olculdu, 0): aday, ama "tasinmis" denmez.
  const r0b = jv(
    ac(hk, { capraz: { ocp, kullanim: KUL([kulSatir('pay', 'pay-prod', 0)]) } }),
    'P1',
    hk,
    'pay',
  ).ocp;
  assert.deepEqual([r0b.istek, r0b.aday, r0b.tasinmisOlabilir], [0, true, false]);
  // Olculemeyen JBoss "kapali" sayilmaz.
  const ho = [
    H('P1', 'PROD', [J('pay', { running: false, runningKnown: false, trafficState: null })]),
  ];
  const ro = jv(ac(ho, { capraz: { ocp, kullanim: KUL([]) } }), 'P1', ho, 'pay').ocp;
  assert.deepEqual([ro.aday, ro.istek], [false, null]);
  // Dynatrace 0 ve olculdu: "yok" (0), aday degil (JBoss canli).
  const r0 = jv(
    ac(hs, { capraz: { ocp, kullanim: KUL([kulSatir('pay', 'pay-prod', 0)]) } }),
    'P1',
    hs,
    'pay',
  ).ocp;
  assert.deepEqual([r0.istek, r0.aday], [0, false]);
  // Dynatrace okunamadi.
  const rd = jv(ac(hs, { capraz: { ocp, kullanim: { okunamadi: true } } }), 'P1', hs, 'pay').ocp;
  assert.deepEqual([rd.istek, rd.istekOlculdu, rd.kullanimOkunamadi], [null, false, true]);
  // Bayat sunucu karar vermez.
  const hb = [H('P1', 'PROD', [J('pay')], { fresh: false })];
  assert.equal(jv(ac(hb, { capraz: { ocp, kullanim } }), 'P1', hb, 'pay'), null);
});

test('C5 celiski: Retirement STOP / silme yapildi ama sunucu baska soyluyor', () => {
  const ear =
    (...adlar) =>
    () => ({ uygulamalar: adlar.map((ad) => ({ ad, kok: '/vhosting' })) });
  const c = (hs, hedefler, earOf) => ac(hs, { capraz: { retirement: RET(hedefler) }, earOf });
  let hs = [H('P1', 'PROD', [J('pay')])];
  assert.deepEqual(
    jv(c(hs, [hedef('P1', 'pay', 'stopped')]), 'P1', hs, 'pay').celiski[0].nedenler,
    ['calisiyor', 'autostart'],
  );
  hs = [H('P1', 'PROD', [J('pay', KAPALI)])];
  const cs = jv(c(hs, [hedef('P1', 'pay', 'stopped')]), 'P1', hs, 'pay').celiski;
  assert.deepEqual(cs, [
    {
      kayit: 12,
      hedef: 7,
      durum: 'stopped',
      durduruldu: '2026-10-20',
      nedenler: ['autostart'],
      paket: null,
    },
  ]);
  hs = [H('P1', 'PROD', [J('pay', { ...KAPALI, autoStart: 'false' })])];
  assert.deepEqual(
    jv(c(hs, [hedef('P1', 'pay', 'stopped')]), 'P1', hs, 'pay').celiski,
    [],
    'STOP tam: celiski yok',
  );
  assert.deepEqual(
    jv(c(hs, [hedef('P1', 'pay', 'stopped')], ear('pay.ear')), 'P1', hs, 'pay').celiski[0].nedenler,
    ['paket'],
  );
  assert.deepEqual(
    jv(c(hs, [hedef('P1', 'pay', 'stopped')], ear('pay.ear.364244_Delete_6.old')), 'P1', hs, 'pay')
      .celiski,
    [],
    ".old paket STOP'un beklenen sonucu",
  );
  assert.deepEqual(
    jv(c(hs, [hedef('P1', 'pay', 'deleted')], ear('pay.ear')), 'P1', hs, 'pay').celiski[0].durum,
    'deleted',
  );
  // Surec durumlari celiski degil ama baglam olarak gorunur.
  hs = [H('P1', 'PROD', [J('pay')])];
  for (const d of ['pending', 'planned', 'stop_scheduled', 'stopping', 'active', 'failed']) {
    const x = jv(c(hs, [hedef('P1', 'pay', d)]), 'P1', hs, 'pay');
    assert.deepEqual([x.celiski, x.retirement], [[], [{ kayit: 12, hedef: 7, durum: d }]], d);
  }
  // Nesil: hedefin nesli farkliysa eslesmez; null her nesle uyar. Tam ad + kisa host.
  hs = [H('P1', 'PROD', [J('pay')])];
  assert.equal(c(hs, [hedef('P1', 'pay', 'stopped', { gen: 8 })]).jvm('P1', hs[0].jvms[0]), null);
  const fq = jv(c(hs, [hedef('p1.bmw.local', 'PAY', 'stopped', { gen: null })]), 'P1', hs, 'pay');
  assert.deepEqual(
    [fq.celiski.length, fq.retirement.length],
    [1, 1],
    'FQDN hedef: celiski ve baglam',
  );
  // Bayat sunucu: celiski yok (baglam kalir).
  hs = [H('P1', 'PROD', [J('pay')], { fresh: false })];
  const xb = jv(c(hs, [hedef('P1', 'pay', 'stopped')]), 'P1', hs, 'pay');
  assert.deepEqual([xb.celiski, xb.retirement.length], [[], 1]);
  // JVM taramada yok, paket diskte: sunucu duzeyi.
  hs = [H('P1', 'PROD', [J('baska')])];
  const r = c(hs, [hedef('P1', 'pay', 'deleted')], ear('pay.ear'));
  assert.deepEqual(r.host('P1'), [
    {
      kayit: 12,
      hedef: 7,
      durum: 'deleted',
      durduruldu: '2026-10-20',
      uygulama: 'pay',
      paket: 'pay.ear',
      kok: '/vhosting',
    },
  ]);
  assert.deepEqual(
    c(hs, [hedef('P1', 'pay', 'deleted')]).host('P1'),
    [],
    'EAR verisi yok: iddia yok',
  );
});

test('C6 okunamayan kaynak: ona dayanan sonuc YOK; ic kontroller (kopya, kalinti) calisir', () => {
  const hs = [
    H('P1', 'PROD', [J('pay')]),
    H('P2', 'PROD', [J('pay', KAPALI)]),
    H('T1', 'TEST', [J('LEGACY-T')]),
  ];
  const capraz = {
    ocp: {
      okunamadi: true,
      hata: 'x',
      indeks: new Map([
        ['pay', [{ cluster: 'c', namespace: 'pay-prod', uygulama: 'pay', ortam: 'prod' }]],
      ]),
    },
    kullanim: { okunamadi: true, indeks: new Map() },
    retirement: { okunamadi: true, hedefler: [hedef('P1', 'pay', 'stopped')] },
  };
  for (const g of [{ capraz }, { capraz: null }, {}]) {
    const r = ac(hs, g);
    assert.equal(jv(r, 'P1', hs, 'pay'), null, 'okunamayan OpenShift / Retirement sonuc uretti');
    assert.deepEqual(jv(r, 'P2', hs, 'pay').kopya.nedenler, ['calisma']);
    assert.deepEqual(
      [
        jv(r, 'P2', hs, 'pay').ocp,
        jv(r, 'P2', hs, 'pay').celiski,
        jv(r, 'P2', hs, 'pay').retirement,
      ],
      [null, [], []],
    );
    assert.equal(jv(r, 'T1', hs, 'LEGACY-T').kalinti.neden, 'PROD_YOK');
  }
});

test('C7 bulgu metinleri: hangi kopya, hangi namespace, hangi kayit', () => {
  assert.equal(
    kopyaMetni(
      { autoStart: 'false' },
      {
        nedenler: ['calisma', 'autostart'],
        digerleri: [
          { host: 'P1', calisiyor: true, autoStart: 'true' },
          { host: 'P3', calisiyor: null, autoStart: 'unknown' },
        ],
        kopyaSayisi: 3,
      },
    ),
    'bu kopya kapalı, aynı ortamda çalışan kopya var; auto-start KAPALI, öteki kopyalardan farklı — öteki kopyalar: P1 (çalışıyor, auto-start açık), P3 (ölçülemedi, auto-start bilinmiyor)',
  );
  assert.match(
    kopyaMetni(
      { autoStart: 'true' },
      {
        nedenler: ['calisma'],
        digerleri: [{ host: 'P1', calisiyor: true, autoStart: 'true' }],
        kopyaSayisi: 14,
      },
    ),
    / \+12$/,
    'gosterilmeyen kopya sayisi',
  );
  assert.equal(
    kalintiMetni({ neden: 'PROD_YOK', prodKopyalar: [], retirement: [], ocpProd: null }),
    "prod'da kopyası yok (tarama ve envanter)",
  );
  assert.equal(
    kalintiMetni({
      neden: 'PROD_KAPALI',
      prodKopyalar: [{ host: 'P1' }, { host: 'P2' }],
      retirement: [],
      ocpProd: [
        { namespace: 'l-prod', cluster: 'c1' },
        { namespace: 'l-prod', cluster: 'c2' },
      ],
    }),
    "prod kopyaları kapalı: P1, P2 — OpenShift prod'da var (l-prod @ c1 +1): uygulama taşınmış olabilir",
  );
  assert.equal(
    kalintiMetni({
      neden: 'PROD_RETIRE',
      prodKopyalar: [{ host: 'P1' }],
      retirement: [31, 32],
      ocpProd: [],
    }),
    'prod kopyası Retirement ile durduruldu (#31, #32)',
  );
  const o = {
    eslesme: [{ namespace: 'pay-prod', cluster: 'c1' }],
    eslesmeSayisi: 3,
    ad: { jboss: 'PAY', ocp: 'pay' },
    istek: 150,
    pencereGun: 7,
    kullanimOkunamadi: false,
    tasinmisOlabilir: true,
  };
  assert.equal(
    ocpMetni(o),
    "OpenShift'te de var: pay-prod @ c1 +2 (ad eşleşmesi: PAY ↔ pay) — Dynatrace 7 gün: 150 istek — JBoss kopyası boşta, uygulama OpenShift'e taşınmış olabilir",
  );
  assert.match(
    ocpMetni({ ...o, istek: null, tasinmisOlabilir: false }),
    /— Dynatrace isteği ölçülemedi$/,
  );
  assert.match(ocpMetni({ ...o, kullanimOkunamadi: true, istek: null }), /Dynatrace okunamadı/);
  assert.doesNotMatch(ocpMetni({ ...o, ad: { jboss: 'pay', ocp: 'pay' } }), /ad eşleşmesi/);
  assert.equal(
    celiskiMetni({
      kayit: 12,
      durum: 'stopped',
      durduruldu: '2026-10-20',
      nedenler: ['calisiyor', 'autostart', 'paket'],
      paket: 'pay.ear',
    }),
    "Retirement #12 hedefi STOP edildi (2026-10-20) ama JVM çalışıyor, auto-start AÇIK (reboot'ta geri gelir), paket özgün adıyla diskte (pay.ear)",
  );
  assert.match(
    celiskiMetni({
      kayit: 3,
      durum: 'deleted',
      durduruldu: null,
      nedenler: ['paket'],
      paket: 'x.ear',
    }),
    /^Retirement #3 hedefi silindi ama paket/,
  );
});

test('C8 capraz-veri: kaynaklar ayri okunur, onbellek, durum ozeti', async () => {
  const sifirla = () => {
    _sifirla();
    Object.assign(K, {
      ocp: [],
      kullanim: [],
      ret: [],
      ocpDus: false,
      kullanimDus: false,
      retDus: false,
      sorgu: [],
    });
  };
  sifirla();
  K.ocp = [
    ocpSatir('pay', 'pay-prod'),
    ocpSatir('falcon', 'falcon-operator'),
    ocpSatir(null, 'x-prod'),
  ];
  K.kullanim = [kulSatir('pay', 'pay-prod', 9)];
  K.ret = [
    {
      id: 4,
      record_id: 2,
      host: 'P1',
      app_name: 'pay',
      jboss_gen: 7,
      app_path: '/vhosting/pay.ear',
      status: 'STOPPED',
      stopped_at: new Date('2026-10-20T08:00:00Z'),
      kayit_durum: 'stopped',
    },
    {
      id: 5,
      record_id: 2,
      host: 'P2',
      app_name: 'pay',
      jboss_gen: null,
      app_path: null,
      status: 'pending',
      stopped_at: null,
      kayit_durum: 'open',
    },
  ];
  let v = await caprazVeri();
  assert.deepEqual(
    [...v.ocp.indeks.keys()],
    ['pay'],
    'ortami olmayan namespace ve adsiz satir atlanir',
  );
  assert.equal(v.kullanim.indeks.get('pay-prod|pay').reqShown, 9);
  assert.deepEqual(v.retirement.hedefler[0], {
    hedef: 4,
    kayit: 2,
    host: 'P1',
    uygulama: 'pay',
    gen: 7,
    yol: '/vhosting/pay.ear',
    durum: 'stopped',
    kayitDurum: 'stopped',
    durduruldu: '2026-10-20',
  });
  assert.deepEqual([v.retirement.hedefler[1].gen, v.retirement.hedefler[1].yol], [null, null]);
  assert.deepEqual(caprazDurumu(v), {
    ocp: { okunamadi: false, hata: '', uygulama: 1 },
    kullanim: { okunamadi: false, hata: '', olcum: 1 },
    retirement: { okunamadi: false, hata: '', hedef: 2 },
  });
  assert.equal(JSON.stringify(caprazDurumu(v)).includes('indeks'), false, 'durum indeks tasimaz');
  // Onbellek: OpenShift / Dynatrace 10 dk tekrar okunmaz; Retirement her seferinde okunur.
  K.sorgu = [];
  K.ret = [];
  v = await caprazVeri();
  assert.deepEqual([K.sorgu.length, v.retirement.hedefler.length, v.ocp.indeks.size], [0, 0, 1]);
  // Bir kaynak duserse digerleri gelir; dusen kaynak onbellege alinmaz.
  sifirla();
  K.ocp = [ocpSatir('pay', 'pay-prod')];
  K.kullanimDus = true;
  K.retDus = true;
  v = await caprazVeri();
  assert.deepEqual(
    [v.ocp.okunamadi, v.kullanim.okunamadi, v.retirement.okunamadi],
    [false, true, true],
  );
  assert.equal(v.kullanim.hata, 'timeout');
  assert.deepEqual(caprazDurumu(v).retirement, { okunamadi: true, hata: 'baglanti yok', hedef: 0 });
  K.kullanimDus = false;
  K.sorgu = [];
  v = await caprazVeri();
  assert.equal(K.sorgu.length, 2, 'dusen kaynak onbellege alinmis');
  assert.equal(v.kullanim.okunamadi, false);
  sifirla();
  K.ocpDus = true;
  v = await caprazVeri();
  assert.deepEqual([v.ocp.okunamadi, v.ocp.indeks.size, v.kullanim.okunamadi], [true, 0, false]);
  assert.equal(caprazDurumu(null), null);
  sifirla();
});

test('C9 hiz: 2000 sunucu / 24 bin JVM tek gecis indeksiyle 1,5 sn altinda', () => {
  const hostlar = [];
  const ENV = ['PROD', 'TEST', 'QA', 'DEV'];
  for (let i = 0; i < 2000; i++) {
    const env = ENV[i % 4];
    const ek = env === 'PROD' ? '' : `-${env[0]}`;
    hostlar.push(
      H(
        `GBXXAP${String(i).padStart(4, '0')}`,
        env,
        Array.from({ length: 12 }, (_, k) =>
          J(`app${(i * 7 + k) % 900}${ek}`, {
            running: (i + k) % 3 !== 0,
            autoStart: (i + k) % 5 ? 'true' : 'false',
            trafficState: k % 4 ? 'ACTIVE' : 'NO_RECENT_TRAFFIC',
          }),
        ),
      ),
    );
  }
  const ocpRows = [];
  const kulRows = [];
  for (let a = 0; a < 900; a += 2)
    for (const e of ['prod', 'test', 'qa']) {
      ocpRows.push(
        ocpSatir(`app${a}`, `ns${a}-${e}`),
        ocpSatir(`app${a}`, `ns${a}-${e}`, 'gbocpprod2'),
      );
      kulRows.push(kulSatir(`app${a}`, `ns${a}-${e}`, a % 3));
    }
  const hedefler = Array.from({ length: 500 }, (_, i) =>
    hedef(
      `GBXXAP${String(i * 4).padStart(4, '0')}`,
      `app${(i * 28) % 900}`,
      i % 2 ? 'stopped' : 'planned',
      { hedef: i },
    ),
  );
  const t0 = Date.now();
  const r = ac(hostlar, {
    capraz: { ocp: OCP(ocpRows), kullanim: KUL(kulRows), retirement: RET(hedefler) },
  });
  let say = 0;
  for (const h of hostlar) for (const j of h.jvms) if (r.jvm(h.host, j)) say++;
  const ms = Date.now() - t0;
  assert.ok(say > 5000, `senaryo kurulamadi (${say})`);
  assert.ok(ms < 1500, `capraz analiz yavas: ${ms} ms (JVM basina filo taramasi mi geldi?)`);
});
