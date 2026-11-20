// server/server-hub/__tests__/kopya-durumu.test.js - Server Hub > Kopya Durumu (2026-11-14).
//
// Kullanici: "Bazi JBoss uygulamalari production'da toplam 5 makinede sadece birinde acik."
//
//   KD1 prod 1/5: grup basina tek satir, calisan / kapali / toplam, kapali sunucular listesi
//   KD2 bayat ve olculemeyen kopya "bilinmiyor": kapali SAYILMAZ, karar vermez; taramadan dusen toplama
//       girmez ama `dusen` olarak yazilir (sessizce kaybolmaz)
//   KD3 gruplama: farkli ortam / nesil / ad ayri grup; tek sunuculu grup listelenmez; ad buyuk / kucuk harf
//   KD4 KOPYA_TUTARSIZ ile birebir: sapan kopyalar ve tutarsiz gruplar caprazAnaliz ile ayni (TEK kural)
//   KD5 auto-start uyumsuzlugu sayisi, Retirement ve OpenShift ozeti
//   KD6 siralama: prod once, calisma tutarsizligi auto-start farkindan once, oran calisan/(calisan+kapali)
//       (bilinmiyor paydaya girmez, hic olculmeyen en sona), sonra kopya sayisi
//   KD7 bulgu metni "x/y kopya calisiyor": payda sekmeyle AYNI (bayat dahil), bilinmiyor ayrica yazilir
//   KD8 uc: liste + esleme aciklamasi (sinirlar dahil), tablo yok -> bos, 424, degerlendirme basina tek hesap
//   KD9 ayni sunucuda cift satir: kapali sunucu bir kez yazilir
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { kopyaDurumu, ESLESME, mount } = require('../kopya-durumu.cjs');
const { caprazAnaliz, kopyaMetni } = require('../capraz.cjs');

const H = (host, env, jvms, ek = {}) => ({
  host,
  env,
  fresh: true,
  taramadanDustu: false,
  scanDate: '2026-11-14',
  jvms,
  ...ek,
});
const J = (name, ek = {}) => ({
  gen: 7,
  name,
  running: true,
  runningKnown: true,
  autoStart: 'true',
  serverState: 'running',
  ...ek,
});
const KAPALI = { running: false, serverState: 'stopped' };
const grubu = (r, app, env = 'PROD', gen = 7) =>
  r.gruplar.find((g) => g.app === app && g.env === env && g.gen === gen);

test('KD1 prod 1/5: tek satir, sayilar ve kapali sunucular', () => {
  const r = kopyaDurumu([
    H('P1', 'PROD', [J('PAY')]),
    H('P2', 'PROD', [J('PAY', KAPALI)]),
    H('P3', 'PROD', [J('PAY', KAPALI)]),
    H('P4', 'PROD', [J('PAY', KAPALI)]),
    H('P5', 'PROD', [J('PAY', KAPALI)]),
  ]);
  assert.equal(r.gruplar.length, 1);
  const g = r.gruplar[0];
  assert.deepEqual(
    [g.app, g.env, g.gen, g.running, g.stopped, g.unknown, g.total, g.tutarsiz, g.calismaTutarsiz],
    ['PAY', 'PROD', 7, 1, 4, 0, 5, true, true],
  );
  assert.deepEqual(g.stoppedHosts, ['P2', 'P3', 'P4', 'P5']);
  assert.deepEqual(
    g.copies.map((k) => [k.host, k.durum, k.serverState, k.fresh, k.scanDate]),
    [
      ['P1', 'calisiyor', 'running', true, '2026-11-14'],
      ['P2', 'kapali', 'stopped', true, '2026-11-14'],
      ['P3', 'kapali', 'stopped', true, '2026-11-14'],
      ['P4', 'kapali', 'stopped', true, '2026-11-14'],
      ['P5', 'kapali', 'stopped', true, '2026-11-14'],
    ],
  );
  assert.deepEqual(r.ozet, {
    grup: 1,
    tutarsiz: 1,
    prodTutarsiz: 1,
    calismaTutarsiz: 1,
    autoStartTutarsiz: 0,
  });
});

test('KD2 bayat / olculemeyen kopya bilinmiyor: kapali sayilmaz, karar vermez; dusen sunucu yok', () => {
  let r = kopyaDurumu([
    H('P1', 'PROD', [J('PAY')]),
    H('P2', 'PROD', [J('PAY', KAPALI)], { fresh: false }),
    H('P3', 'PROD', [J('PAY', { running: false, runningKnown: false })]),
    H('P4', 'PROD', [J('PAY', KAPALI)], { taramadanDustu: true }),
  ]);
  let g = grubu(r, 'PAY');
  assert.deepEqual([g.total, g.running, g.stopped, g.unknown], [3, 1, 0, 2]);
  assert.equal(g.tutarsiz, false, 'bayat kapali kopya tutarsizlik karari verdi');
  assert.deepEqual(g.stoppedHosts, []);
  const p2 = g.copies.find((k) => k.host === 'P2');
  assert.deepEqual([p2.durum, p2.running, p2.fresh, p2.sapma], ['bilinmiyor', false, false, []]);
  assert.equal(g.copies.find((k) => k.host === 'P3').running, null);
  assert.ok(!g.copies.some((k) => k.host === 'P4'), 'taramadan dusen sunucu satira girdi');
  assert.deepEqual(
    g.dusen,
    [{ host: 'P4', scanDate: '2026-11-14' }],
    'taramadan dusen kopya sessizce kayboldu',
  );
  // Iki kopyali grubun ikincisi taramadan dustu: grup kaybolmaz, "1/1 + 1 dustu" olarak gorunur.
  r = kopyaDurumu([
    H('P1', 'PROD', [J('PAY')]),
    H('P2', 'PROD', [J('PAY')], { taramadanDustu: true }),
  ]);
  g = grubu(r, 'PAY');
  assert.deepEqual(
    [g.total, g.running, g.tutarsiz, g.dusen.map((d) => d.host)],
    [1, 1, false, ['P2']],
  );
  // Yalniz dusen sunucularda olan grup listelenmez.
  r = kopyaDurumu([
    H('P1', 'PROD', [J('ESKI')], { taramadanDustu: true }),
    H('P2', 'PROD', [J('ESKI')], { taramadanDustu: true }),
  ]);
  assert.equal(r.gruplar.length, 0);
  // Taze kopya yalniz bir sunucuda: karar yok ama satir (2 sunucu) var.
  r = kopyaDurumu([
    H('P1', 'PROD', [J('PAY')]),
    H('P2', 'PROD', [J('PAY', KAPALI)], { fresh: false }),
  ]);
  g = grubu(r, 'PAY');
  assert.deepEqual([g.total, g.unknown, g.tutarsiz], [2, 1, false]);
});

test('KD3 gruplama: ortam / nesil / ad ayri; tek sunucu listelenmez; ad buyuk / kucuk harf duyarsiz', () => {
  const r = kopyaDurumu([
    H('P1', 'PROD', [
      J('PAY'),
      J('PAY', { gen: 8 }),
      J('TEK'),
      J('IKI'),
      J('IKI', { serverState: 'x' }),
    ]),
    H('P2', 'PROD', [J('pay', KAPALI), J('PAY1')]),
    H('Q1', 'QA', [J('PAY')]),
    H('Q2', 'QA', [J('PAY')]),
    H('X1', 'ALPHA', [J('PAY')]),
    H('X2', 'ALPHA', [J('PAY', KAPALI)]),
  ]);
  assert.deepEqual(
    r.gruplar.map((g) => `${g.env}|${g.gen}|${g.app}|${g.total}`).sort(),
    ['PROD|7|PAY|2', 'QA|7|PAY|2'],
    'tek sunuculu grup (PAY gen 8, TEK, IKI ayni sunucuda, PAY1) ya da ORTAM_GRUBU disi ortam listelendi',
  );
  assert.equal(grubu(r, 'PAY', 'QA').tutarsiz, false);
});

test('KD4 KOPYA_TUTARSIZ ile birebir: sapan kopyalar ve tutarsiz gruplar ayni', () => {
  const as = ['true', 'false', 'unknown'];
  const hosts = [];
  for (let i = 0; i < 12; i++) {
    const jv = [];
    for (let a = 0; a < 6; a++)
      if ((i + a) % 4 !== 0)
        jv.push(
          J(`APP${a}`, {
            running: (i * 7 + a) % 3 !== 0,
            runningKnown: (i + a * 5) % 7 !== 0,
            autoStart: as[(i * 3 + a) % 3],
          }),
        );
    hosts.push(H(`H${i}`, i % 3 === 0 ? 'QA' : 'PROD', jv, { fresh: i % 5 !== 4 }));
  }
  const cx = caprazAnaliz(hosts);
  const r = kopyaDurumu(hosts);
  const beklenen = [];
  for (const h of hosts)
    for (const j of h.jvms) {
      const k = cx.jvm(h.host, j);
      if (k && k.kopya) beklenen.push(`${h.host}|${j.name}|${k.kopya.nedenler.join('+')}`);
    }
  const bulunan = r.gruplar.flatMap((g) =>
    g.copies.filter((k) => k.sapma.length).map((k) => `${k.host}|${g.app}|${k.sapma.join('+')}`),
  );
  assert.ok(beklenen.length > 3, 'fikstur tutarsizlik uretmedi');
  assert.deepEqual(bulunan.sort(), beklenen.sort());
  for (const g of r.gruplar)
    assert.equal(
      g.tutarsiz,
      g.copies.some((k) => k.sapma.length),
      `${g.anahtar} tutarsiz bayragi`,
    );
});

test('KD5 auto-start uyumsuzlugu, Retirement ve OpenShift ozeti', () => {
  const ret = [{ kayit: 12, hedef: 7, durum: 'stopped' }];
  const ocp = { eslesme: [{ namespace: 'pay-prod', cluster: 'c1', uygulama: 'pay' }] };
  const r = kopyaDurumu([
    H('P1', 'PROD', [J('PAY', { capraz: { ocp } })]),
    H('P2', 'PROD', [J('PAY', { autoStart: 'false', retirement: ret })]),
    H('P3', 'PROD', [J('PAY', { capraz: { ocp } })]),
  ]);
  const g = grubu(r, 'PAY');
  assert.deepEqual(
    [
      g.tutarsiz,
      g.calismaTutarsiz,
      g.autoStartTutarsiz,
      g.autoStartUyumsuz,
      g.autoStartAcik,
      g.autoStartKapali,
    ],
    [true, false, true, 1, 2, 1],
  );
  assert.deepEqual(g.copies.find((k) => k.host === 'P2').sapma, ['autostart']);
  assert.deepEqual(g.retirement, [{ kayit: 12, hedef: 7, durum: 'stopped' }]);
  assert.deepEqual(g.ocp, [{ namespace: 'pay-prod', cluster: 'c1' }]);
});

test('KD6 siralama: prod once, en kotu oran, kopya sayisi', () => {
  const r = kopyaDurumu([
    H('Q1', 'QA', [J('QAAPP', KAPALI)]),
    H('Q2', 'QA', [J('QAAPP', KAPALI)]),
    H('P1', 'PROD', [J('IYI'), J('YARIM'), J('KOTU'), J('BUYUK')]),
    H('P2', 'PROD', [J('IYI'), J('YARIM', KAPALI), J('KOTU', KAPALI), J('BUYUK', KAPALI)]),
    H('P3', 'PROD', [J('KOTU', KAPALI), J('BUYUK', KAPALI)]),
    H('P4', 'PROD', [J('BUYUK', KAPALI)]),
  ]);
  assert.deepEqual(
    r.gruplar.map((g) => g.app),
    ['BUYUK', 'KOTU', 'YARIM', 'IYI', 'QAAPP'],
  );
  // Yalniz auto-start farkli 0/5 grup, "1/5 calisiyor" grubunun ONUNE gecmez; bilinmiyor paydaya girmez;
  // hic olculmeyen grup en sona.
  const r2 = kopyaDurumu([
    H('P1', 'PROD', [
      J('ASFARK', { ...KAPALI, autoStart: 'false' }),
      J('BIRDE5'),
      J('BIL'),
      J('UCDE5'),
      J('OLCULMEZ', { runningKnown: false }),
    ]),
    H('P2', 'PROD', [
      J('ASFARK', KAPALI),
      J('BIRDE5', KAPALI),
      J('BIL'),
      J('UCDE5'),
      J('OLCULMEZ', { runningKnown: false }),
    ]),
    H('P3', 'PROD', [J('ASFARK', KAPALI), J('BIRDE5', KAPALI), J('BIL', KAPALI), J('UCDE5')]),
    H('P4', 'PROD', [
      J('ASFARK', KAPALI),
      J('BIRDE5', KAPALI),
      J('BIL', { runningKnown: false }),
      J('UCDE5', KAPALI),
    ]),
    H('P5', 'PROD', [
      J('ASFARK', KAPALI),
      J('BIRDE5', KAPALI),
      J('BIL', { runningKnown: false }),
      J('UCDE5', KAPALI),
    ]),
  ]);
  assert.deepEqual(
    r2.gruplar.map((g) => g.app),
    ['BIRDE5', 'UCDE5', 'BIL', 'ASFARK', 'OLCULMEZ'],
    'siralama: calisma tutarsizligi once, bilinmiyor paydada degil, olculmeyen sonda',
  );
  assert.deepEqual(
    r2.gruplar.map((g) => g.oran),
    [0.2, 0.6, 2 / 3, 0, null],
  );
});

test('KD7 bulgu metni: x/y kopya calisiyor', () => {
  const hs = [
    H('P1', 'PROD', [J('PAY')]),
    H('P2', 'PROD', [J('PAY', KAPALI)]),
    H('P3', 'PROD', [J('PAY', KAPALI)]),
    H('P4', 'PROD', [J('PAY', { running: false, runningKnown: false })]),
  ];
  const cx = caprazAnaliz(hs);
  const k = cx.jvm('P2', hs[1].jvms[0]).kopya;
  assert.deepEqual(
    [k.calisanSayisi, k.bilinmeyenSayisi, k.toplamSayisi, k.kopyaSayisi],
    [1, 1, 4, 4],
  );
  assert.match(
    kopyaMetni(hs[1].jvms[0], k),
    /^1\/4 kopya çalışıyor \(1 bilinmiyor\); bu kopya kapalı/,
  );
  // Bayat kopya: Bulgular paydasi sekmeyle AYNI (bayat dahil toplam, bilinmiyor olarak).
  const hb = [...hs, H('P5', 'PROD', [J('PAY')], { fresh: false })];
  const kb = caprazAnaliz(hb).jvm('P2', hb[1].jvms[0]).kopya;
  const gb = grubu(kopyaDurumu(hb), 'PAY');
  assert.deepEqual(
    [kb.calisanSayisi, kb.toplamSayisi, kb.bilinmeyenSayisi],
    [gb.running, gb.total, gb.unknown],
  );
  assert.deepEqual([gb.running, gb.total, gb.unknown], [1, 5, 2]);
  assert.match(kopyaMetni(hb[1].jvms[0], kb), /^1\/5 kopya çalışıyor \(2 bilinmiyor\)/);
  // Eski bicimdeki nesne (sayi yok): metin degismez.
  assert.match(
    kopyaMetni({ autoStart: 'true' }, { nedenler: ['calisma'], digerleri: [], kopyaSayisi: 2 }),
    /^bu kopya kapalı/,
  );
});

test('KD8 uc: liste + esleme aciklamasi, tablo yok, 424', async () => {
  let durum = 'tamam';
  const hosts = [H('P1', 'PROD', [J('PAY')]), H('P2', 'PROD', [J('PAY', KAPALI)])];
  const degerlendirme = { tableMissing: false, hosts, latestScan: '2026-11-14', capraz: null };
  const app = express();
  const router = express.Router();
  mount(router, {
    getAssessment: async () => {
      if (durum === 'dus') throw new Error('Server Hub okunamadı');
      if (durum === 'yok') return { tableMissing: true };
      return degerlendirme;
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
    let r = await al('/kopya-durumu');
    assert.equal(r.status, 200);
    assert.deepEqual(
      [r.body.gruplar.length, r.body.gruplar[0].running, r.body.ozet.tutarsiz],
      [1, 1, 1],
    );
    assert.deepEqual(r.body.eslesme, ESLESME);
    assert.match(r.body.eslesme.kacirabilir, /Farklı JVM adıyla/);
    assert.match(r.body.eslesme.digerSinirlar, /envanterden/);
    assert.match(r.body.eslesme.dusen, /taramadan düşen/);
    // Ayni degerlendirme nesnesi: ikinci istek yeniden hesaplamaz (hosts degisse de onbellekten).
    hosts[1].jvms[0].running = true;
    r = await al('/kopya-durumu');
    assert.equal(r.body.gruplar[0].running, 1, 'ayni degerlendirme icin yeniden hesaplandi');
    durum = 'yok';
    r = await al('/kopya-durumu');
    assert.deepEqual([r.status, r.body.tableMissing, r.body.gruplar.length], [200, true, 0]);
    durum = 'dus';
    r = await al('/kopya-durumu');
    assert.equal(r.status, 424);
    assert.match(r.body.message, /okunamadı/);
  } finally {
    srv.close();
  }
});

test('KD9 ayni sunucuda cift satir: kapali sunucu bir kez yazilir', () => {
  const r = kopyaDurumu([
    H('P1', 'PROD', [J('PAY'), J('PAY', KAPALI), J('PAY', KAPALI)]),
    H('P2', 'PROD', [J('PAY')]),
  ]);
  assert.deepEqual(grubu(r, 'PAY').stoppedHosts, ['P1']);
});
