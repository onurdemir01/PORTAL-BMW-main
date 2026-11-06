// server/server-hub/__tests__/uygulama-360.test.cjs - Server Hub > Uygulama 360 (2026-11-07).
//
//   U1 gruplama: taban ad (-D/-T/-Q, kucuk harf) tek satir; taramadan dusen sunucu yok, bayat sayilir;
//      ortamlar PROD once, acik / kapali / olculemedi ayri
//   U2 kopya: auto-start uyumsuzlugu iki yon (olculemeyen calisma karar vermez); istek yalniz olculen
//      vhost'lardan; trafik ozeti var / yok / olculemedi
//   U3 Uygulama Envanteri: EAR yalniz ayni ad + nesil; veri yoksa null ("yok" degil); WAR toplami;
//      deployment en kotusu; olculemeyen / bos / FAILED / devre disi
//   U4 capraz + Retirement + etiket: riskli kopya; OpenShift yerleri bir kez, istek ortam grubu basina bir
//      kez, olculmeyen null; Retirement hedef basina bir kez; en yuksek etiket, kurallar sayisal sirali;
//      EAR etiketi uygulama satirina girmez
//   U5 siralama: etiket seviyesi, sonra riskli kopya, sonra ad
//   U6 ayrinti: kopyalar ortam sirasinda, etiketler ozet (kopya tasimaz); bilinmeyen ad null
//   U7 uclar: liste, 400 gecersiz ad, 409 artik yok, 424 degerlendirme okunamadi, tablo yok -> bos liste
//   U8 HIZ: 2000 sunucu / 24 bin JVM + etiketler 1,5 sn altinda
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { uygulamalar360, mount } = require('../uygulama-360.cjs');

const H = (host, env, jvms, ek = {}) => ({
  host,
  env,
  fresh: true,
  taramadanDustu: false,
  scanDate: '2026-11-07',
  hostClass: 'genel',
  jvms,
  ear: null,
  ...ek,
});
const J = (name, ek = {}) => ({
  gen: 7,
  name,
  running: true,
  runningKnown: true,
  autoStart: 'true',
  trafficState: 'ACTIVE',
  tier: '2',
  vhosts: [],
  ...ek,
});
const V = (req7d) => ({
  host: 'W',
  v: { serverName: 's', req7d, trafficState: 'ACTIVE' },
  kind: 'WEB_APP',
});
const satir = (r, ad) => r.uygulamalar.find((u) => u.anahtar === ad);
const etiket = (ad, ek = {}) => ({
  anahtar: `JVM|${ad.toUpperCase()}|PROD|7`,
  tur: 'JVM',
  ad,
  ortam: 'PROD',
  seviye: 'SUPHELI',
  kurallar: ['R8'],
  durum: 'BEKLIYOR',
  retirementHazir: false,
  kopyalar: [{ host: 'P1' }],
  ...ek,
});

test('U1 gruplama: taban ad tek satir; dusen sunucu yok, bayat sayilir; ortamlar sirali', () => {
  const r = uygulamalar360([
    H('T1', 'TEST', [J('PAY-T'), J('PAY-T', { gen: 8 })]),
    H('P1', 'PROD', [J('PAY')]),
    H('P2', 'PROD', [J('PAY', { running: false })]),
    H('Q1', 'QA', [J('pay-q', { running: false, runningKnown: false })]),
    H('D1', 'DEV', [J('PAY-D')], { taramadanDustu: true }),
    H('P3', 'PROD', [J('PAY')], { fresh: false }),
  ]);
  assert.equal(r.uygulamalar.length, 1, 'PAY, PAY-T, pay-q ayri satir oldu');
  const u = satir(r, 'PAY');
  assert.deepEqual(u.ortamlar, [
    { ortam: 'PROD', toplam: 3, acik: 2, kapali: 1, olculemedi: 0 },
    { ortam: 'QA', toplam: 1, acik: 0, kapali: 0, olculemedi: 1 },
    { ortam: 'TEST', toplam: 2, acik: 2, kapali: 0, olculemedi: 0 },
  ]);
  assert.deepEqual(
    [u.kopyaSayisi, u.sunucuSayisi, u.nesiller, u.calisan, u.kapali, u.olculemeyen, u.bayatKopya],
    [6, 5, [7, 8], 4, 1, 1, 1],
  );
  assert.equal(u.ad, 'PAY-T'.replace('-T', ''), 'gorunen ad ilk kopyanin taban adi');
});

test('U2 kopya: auto-start uyumsuzlugu, istek, trafik ozeti', () => {
  const r = uygulamalar360([
    H('P1', 'PROD', [
      J('a', { autoStart: 'false' }),
      J('b', { running: false, autoStart: 'true' }),
      J('c', { running: false, runningKnown: false, autoStart: 'true' }),
      J('d', { running: false, autoStart: 'false' }),
    ]),
  ]);
  const k = (ad) => r.ayrinti(ad).kopyalar[0];
  assert.equal(k('a').autostartUyumsuz, 'REBOOT_RISK');
  assert.equal(k('b').autostartUyumsuz, 'STOPPED_AUTOSTART_ON');
  assert.equal(k('c').autostartUyumsuz, null, 'olculemeyen calisma uyumsuzluk sayilmaz');
  assert.equal(k('d').autostartUyumsuz, null, 'kapali + auto-start kapali tutarli');
  assert.equal(k('c').calisiyor, null);
  assert.deepEqual(
    ['a', 'b', 'c', 'd'].map((a) => satir(r, a.toUpperCase()).autostartUyumsuz),
    [1, 1, 0, 0],
  );
  // Istek: yalniz olculen (req7d >= 0) vhost'lar; hic olculen yoksa null.
  const ri = uygulamalar360([
    H('P1', 'PROD', [
      J('x', { vhosts: [V(10), V(null), V(-1), V(5)] }),
      J('y', { vhosts: [V(null)] }),
    ]),
  ]);
  assert.deepEqual([satir(ri, 'X').istek7g, satir(ri, 'Y').istek7g], [15, null]);
  // Trafik: biri ACTIVE -> var; hepsi olculup bos -> yok; biri olculemedi / eslenmedi -> olculemedi.
  const t = (...l) =>
    satir(uygulamalar360(l.map((ts, i) => H(`P${i}`, 'PROD', [J('z', { trafficState: ts })]))), 'Z')
      .trafik;
  assert.equal(t('NO_RECENT_TRAFFIC', 'ACTIVE'), 'ACTIVE');
  assert.equal(t('NO_RECENT_TRAFFIC', 'NO_RECENT_TRAFFIC'), 'NO_RECENT_TRAFFIC');
  assert.equal(t('NO_RECENT_TRAFFIC', 'UNREADABLE'), 'OLCULEMEDI');
  assert.equal(t('NO_RECENT_TRAFFIC', null), 'OLCULEMEDI', 'eslenmeyen kopya "yok" degil');
});

test('U3 Uygulama Envanteri: EAR eslemesi, WAR, deployment', () => {
  const ear = (uygulamalar, deployment = null) => ({ durum: 'VAR', uygulamalar, deployment });
  const U7 = (ad, jvm, war, jboss = '7') => ({
    kok: '/vhosting',
    ad,
    jboss,
    warSayisi: war,
    xml: { durum: 'VAR', jvmler: [{ ad: jvm }] },
  });
  const hs = [
    H('P1', 'PROD', [J('pay'), J('pay', { gen: 8 })], {
      ear: ear(
        [
          U7('PAY.ear', 'PAY', 3),
          U7('PAY8.ear', 'pay', 1, '8'),
          U7('BASKA.ear', 'baska', 9),
          U7('X.ear', 'pay', 2, '?'),
        ],
        {
          jvmler: [
            {
              nesil: 7,
              ad: 'pay',
              durum: 'OK',
              deploymentlar: [{ ad: 'PAY.ear', durum: 'OK', etkin: true }],
            },
            {
              nesil: 8,
              ad: 'pay',
              durum: 'OK',
              deploymentlar: [{ ad: 'PAY8.ear', durum: 'FAILED', etkin: true }],
            },
          ],
        },
      ),
    }),
    H('P2', 'PROD', [J('pay')], { ear: { durum: 'ESKI' } }),
  ];
  const r = uygulamalar360(hs);
  const d = r.ayrinti('pay');
  const k7 = d.kopyalar.find((k) => k.host === 'P1' && k.gen === 7);
  const k8 = d.kopyalar.find((k) => k.host === 'P1' && k.gen === 8);
  assert.deepEqual(
    k7.ear.map((e) => e.ad),
    ['PAY.ear', 'X.ear'],
    'ad buyuk / kucuk harf duyarsiz, nesil bilinmiyorsa (?) dahil',
  );
  assert.deepEqual(
    k8.ear.map((e) => e.ad),
    ['PAY8.ear', 'X.ear'],
  );
  assert.equal(
    d.kopyalar.find((k) => k.host === 'P2').ear,
    null,
    'eski EAR verisi "yok" degil, bilinmiyor',
  );
  assert.deepEqual([k7.deployment, k8.deployment], ['OK', 'FAILED']);
  assert.deepEqual(satir(r, 'PAY').ear, { sayi: 3, war: 3 + 2 + 1 + 2, olculmeyenKopya: 1 });
  assert.equal(satir(r, 'PAY').deployment, 'FAILED', 'en kotu deployment');
  const dep = (dj) =>
    uygulamalar360([
      H('P1', 'PROD', [J('q')], { ear: ear([], { jvmler: [{ nesil: 7, ad: 'q', ...dj }] }) }),
    ]).ayrinti('q').kopyalar[0].deployment;
  assert.equal(dep({ durum: 'CLI_YOK' }), 'OLCULEMEDI');
  assert.equal(dep({ durum: 'OK', deploymentlar: [] }), 'YOK');
  assert.equal(
    dep({ durum: 'OK', deploymentlar: [{ ad: 'a', durum: 'OK', etkin: false }] }),
    'KAPALI',
  );
  assert.equal(dep({ nesil: 8, durum: 'OK', deploymentlar: [] }), null, 'baska nesil eslesmez');
  assert.equal(
    uygulamalar360([H('P1', 'PROD', [J('q')])]).ayrinti('q').kopyalar[0].deployment,
    null,
  );
  assert.equal(satir(uygulamalar360([H('P1', 'PROD', [J('q')])]), 'Q').ear, null);
});

test('U4 capraz, Retirement ve etiket ozeti', () => {
  const ocp = (ns, istek, tas = false) => ({
    eslesme: [
      { namespace: ns, cluster: 'c1', uygulama: 'pay' },
      { namespace: ns, cluster: 'c2', uygulama: 'pay' },
    ],
    eslesmeSayisi: 2,
    ad: { jboss: 'pay', taban: 'pay', ocp: 'pay' },
    istek,
    istekOlculdu: istek != null,
    tasinmisOlabilir: tas,
  });
  const ret = (kayit, hedef, durum) => ({ kayit, hedef, durum });
  const hs = [
    H('P1', 'PROD', [
      J('pay', {
        capraz: { kopya: null, kalinti: null, ocp: ocp('pay-prod', 40), celiski: [] },
        retirement: [ret(4, 9, 'stopped')],
      }),
    ]),
    H('P2', 'PROD', [
      J('pay', {
        running: false,
        capraz: {
          kopya: { nedenler: ['calisma'] },
          kalinti: null,
          ocp: ocp('pay-prod', 40, true),
          celiski: [{ kayit: 4, hedef: 9, durum: 'stopped', nedenler: ['autostart'] }],
        },
        retirement: [ret(4, 9, 'stopped'), ret(2, 3, 'planned')],
      }),
    ]),
    H('T1', 'TEST', [
      J('pay-T', {
        capraz: {
          kopya: null,
          kalinti: { neden: 'PROD_KAPALI' },
          ocp: ocp('pay-test', null),
          celiski: [],
        },
      }),
    ]),
    H('T2', 'TEST', [J('pay-T')]),
  ];
  const r = uygulamalar360(hs, [
    etiket('pay', { kurallar: ['R12', 'R8'], durum: 'DOGRULANDI' }),
    etiket('pay-T', {
      anahtar: 'JVM|PAY-T|TEST|7',
      seviye: 'KESIN',
      kurallar: ['R10'],
      retirementHazir: true,
    }),
    { ...etiket('PAY.ear'), tur: 'EAR', anahtar: 'EAR|PAY.EAR|PROD|7', seviye: 'KESIN' },
  ]);
  const u = satir(r, 'PAY');
  assert.deepEqual(
    [u.kopyaTutarsiz, u.kalinti, u.celiski, u.autostartUyumsuz, u.riskliKopya],
    [1, 1, 1, 1, 2],
    'P2 (kopya + celiski + STOPPED_AUTOSTART_ON) ve T1 (kalinti) riskli; P1 ve T2 degil',
  );
  assert.deepEqual(u.ocp, {
    yerler: [
      { namespace: 'pay-prod', cluster: 'c1', uygulama: 'pay' },
      { namespace: 'pay-prod', cluster: 'c2', uygulama: 'pay' },
      { namespace: 'pay-test', cluster: 'c1', uygulama: 'pay' },
      { namespace: 'pay-test', cluster: 'c2', uygulama: 'pay' },
    ],
    yerSayisi: 4,
    istek: 40,
    tasinmisOlabilir: true,
  });
  assert.deepEqual(u.retirement, [
    { kayit: 2, hedef: 3, durum: 'planned', host: 'P2' },
    { kayit: 4, hedef: 9, durum: 'stopped', host: 'P1' },
  ]);
  assert.deepEqual(u.etiket, {
    seviye: 'KESIN',
    kurallar: ['R8', 'R10', 'R12'],
    sayi: 2,
    bekleyen: 1,
    hazir: 1,
  });
  // En yuksek seviye sirasindan bagimsiz; JVM disi etiket (adi tabanla ayni GIRDI bile) satira girmez.
  const r2 = uygulamalar360(hs, [
    etiket('pay-T', { anahtar: 'JVM|PAY-T|TEST|7', seviye: 'KESIN', kurallar: ['R10'] }),
    etiket('pay', { kurallar: ['R8'] }),
    {
      ...etiket('pay'),
      tur: 'GIRDI',
      anahtar: 'GIRDI|pay|PROD|/vhosting',
      seviye: 'KESIN',
      kurallar: ['R4'],
    },
  ]);
  assert.deepEqual(
    [
      satir(r2, 'PAY').etiket.seviye,
      satir(r2, 'PAY').etiket.sayi,
      satir(r2, 'PAY').etiket.kurallar,
    ],
    ['KESIN', 2, ['R8', 'R10']],
  );
  // Yalniz Retirement celiskisi olan kopya da risklidir.
  const rc = uygulamalar360([
    H('P9', 'PROD', [
      J('solo', {
        capraz: {
          kopya: null,
          kalinti: null,
          ocp: null,
          celiski: [{ kayit: 1, hedef: 1, durum: 'stopped', nedenler: ['calisiyor'] }],
        },
      }),
    ]),
  ]);
  assert.deepEqual([satir(rc, 'SOLO').riskliKopya, satir(rc, 'SOLO').celiski], [1, 1]);
  // OpenShift'in hic olculmeyen istegi null ("0" degil).
  const rn = uygulamalar360([hs[2]]);
  assert.equal(satir(rn, 'PAY').ocp.istek, null);
  assert.equal(satir(uygulamalar360([hs[3]]), 'PAY').ocp, null);
});

test('U5 siralama: etiket seviyesi, riskli kopya, ad', () => {
  const r = uygulamalar360(
    [
      H('P1', 'PROD', [
        J('zeta', { autoStart: 'false' }),
        J('alfa'),
        J('beta', { autoStart: 'false' }),
        J('kesin'),
        J('supheli'),
      ]),
      H('P2', 'PROD', [J('beta', { autoStart: 'false' })]),
    ],
    [etiket('supheli'), etiket('kesin', { seviye: 'KESIN' })],
  );
  assert.deepEqual(
    r.uygulamalar.map((u) => u.ad),
    ['kesin', 'supheli', 'beta', 'zeta', 'alfa'],
  );
});

test('U6 ayrinti: kopyalar ortam sirasinda, etiketler ozet; bilinmeyen null', () => {
  const r = uygulamalar360(
    [
      H('T1', 'TEST', [J('pay-T')]),
      H('P2', 'PROD', [J('pay')]),
      H('P1', 'PROD', [J('pay', { gen: 8 }), J('pay')]),
    ],
    [etiket('pay')],
  );
  const d = r.ayrinti('PAY');
  assert.deepEqual(
    d.kopyalar.map((k) => `${k.ortam}|${k.host}|${k.gen}`),
    ['PROD|P1|7', 'PROD|P1|8', 'PROD|P2|7', 'TEST|T1|7'],
  );
  assert.equal(d.etiketler[0].kopyalar, undefined, 'etiket kopyalari tasindi');
  assert.equal(d.etiketler[0].kopyaSayisi, 1);
  assert.equal(r.ayrinti('pay').anahtar, 'PAY', 'ad buyuk / kucuk harf duyarsiz');
  assert.equal(r.ayrinti('YOK'), null);
});

test('U7 uclar: liste, 400, 409, 424, tablo yok', async () => {
  let durum = 'tamam';
  const hosts = [H('P1', 'PROD', [J('pay')])];
  const app = express();
  const router = express.Router();
  mount(router, {
    etiketHesabi: async () => {
      if (durum === 'dus') throw new Error('Server Hub okunamadı');
      if (durum === 'yok') return { a: { tableMissing: true }, sonuc: { etiketler: [] } };
      return {
        a: {
          tableMissing: false,
          hosts,
          latestScan: '2026-11-07',
          capraz: { ocp: { okunamadi: true } },
        },
        sonuc: { etiketler: [etiket('pay')] },
      };
    },
  });
  app.use('/api/server-hub', router);
  const srv = await new Promise((res) => {
    const s = app.listen(0, '127.0.0.1', () => res(s));
  });
  const kok = `http://127.0.0.1:${srv.address().port}/api/server-hub`;
  const al = async (p) => {
    const r = await fetch(kok + p);
    return { status: r.status, body: await r.json() };
  };
  try {
    let r = await al('/uygulamalar-360');
    assert.equal(r.status, 200);
    assert.deepEqual(
      [r.body.uygulamalar.length, r.body.uygulamalar[0].etiket.seviye, r.body.capraz.ocp.okunamadi],
      [1, 'SUPHELI', true],
    );
    assert.equal(r.body.uygulamalar[0].kopyalar, undefined, 'liste kopya tasidi');
    r = await al('/uygulama-360/pay');
    assert.deepEqual([r.status, r.body.uygulama.kopyalar.length], [200, 1]);
    for (const kotu of ['a%20b', '..%2Fx', 'x'.repeat(129)])
      assert.equal((await al(`/uygulama-360/${kotu}`)).status, 400, kotu);
    r = await al('/uygulama-360/YOKUM');
    assert.equal(r.status, 409);
    assert.match(r.body.message, /artık listede yok/);
    durum = 'dus';
    assert.equal((await al('/uygulamalar-360')).status, 424);
    assert.equal((await al('/uygulama-360/pay')).status, 424);
    durum = 'yok';
    r = await al('/uygulamalar-360');
    assert.deepEqual([r.status, r.body.tableMissing, r.body.uygulamalar], [200, true, []]);
    assert.equal((await al('/uygulama-360/pay')).status, 409);
  } finally {
    srv.close();
  }
});

test('U8 hiz: 2000 sunucu / 24 bin JVM + etiketler 1,5 sn altinda', () => {
  const ENV = ['PROD', 'TEST', 'QA', 'DEV'];
  const hosts = [];
  const etiketler = [];
  for (let i = 0; i < 2000; i++) {
    const env = ENV[i % 4];
    const ek = env === 'PROD' ? '' : `-${env[0]}`;
    hosts.push(
      H(
        `GBXXAP${String(i).padStart(4, '0')}`,
        env,
        Array.from({ length: 12 }, (_, k) =>
          J(`app${(i * 7 + k) % 900}${ek}`, {
            running: (i + k) % 3 !== 0,
            autoStart: (i + k) % 5 ? 'true' : 'false',
            vhosts: [V(i % 50)],
            retirement: k === 0 ? [{ kayit: i, hedef: i, durum: 'stopped' }] : [],
          }),
        ),
        {
          ear: {
            durum: 'VAR',
            uygulamalar: Array.from({ length: 20 }, (_, k) => ({
              kok: '/vhosting',
              ad: `E${k}.ear`,
              jboss: '7',
              warSayisi: 1,
              xml: { durum: 'VAR', jvmler: [{ ad: `app${(i * 7 + k) % 900}${ek}` }] },
            })),
            deployment: null,
          },
        },
      ),
    );
  }
  for (let a = 0; a < 900; a++)
    etiketler.push(etiket(`app${a}`, { anahtar: `JVM|APP${a}|PROD|7` }));
  const t0 = Date.now();
  const r = uygulamalar360(hosts, etiketler);
  const d = r.ayrinti('APP5');
  const ms = Date.now() - t0;
  assert.equal(r.uygulamalar.length, 900);
  assert.ok(d.kopyalar.length >= 20, `senaryo kurulamadi (${d.kopyalar.length})`);
  assert.ok(ms < 1500, `Uygulama 360 yavas: ${ms} ms (uygulama basina filo taramasi mi geldi?)`);
});
