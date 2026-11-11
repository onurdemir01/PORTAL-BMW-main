// server/server-hub/__tests__/senaryo.test.cjs — retirement senaryo ve karar motoru (2026-11-07).
//
//   SN1 DOGRULUK TABLOSU: her senaryo icin sentetik filo -> beklenen karar ve maddeler
//   SN2 DEGISMEZLER (tohumlu rastgele 400 senaryo): olculemeyen engelleyici girdi -> RETIRE_ADAYI degil;
//       gercek trafik ya da web disi cagiran -> KULLANIMDA; celiski + kullanim yok -> KARAR_VERILEMEZ
//   SN3 uygulama toplamasi ve yapilabilecekler (en cok 3; yalniz yonlendir / elle / bilgi; calistiran yok)
//   SN4 uclar: /iliski/kararlar ve /iliski/karar (app / sunucu / kopya), 400 / 409; uc saati motora verir; hata 424
//   SN5 tazelik her kanitin kendi sunucusundan (web sunucusu Server Hub / UE taramasi, baglanti UE taramasi):
//       bayat sifir "olculemedi", aday olamaz; kullanim kaniti bayat da olsa kazanir
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { grafikKur, A } = require('../iliski-grafigi.cjs');
const { dogrula } = require('../dogrulama.cjs');
const { kararla, KARARLAR } = require('../senaryo.cjs');

const APP = 'APPSRV01';
const WEB = 'WEBSRV01';
// Sabit saat: fikstur taramalari 2026-11-06; tazelik (UE_TAZE_GUN) duvar saatine bagli kalmasin.
const SIMDI = () => Date.parse('2026-11-07T12:00:00Z');

/**
 * Tek uygulama kopyasi (JVM APP1, APPSRV01) + 3-tier web (WEBSRV01). Bayraklar:
 *   calisiyor true | false | null; esleme KESIN | ZAYIF | YOK; log OLCULDU | KISMI | YOK (Faz W yok);
 *   gercek (7 gun gercek istek), hc; baglanti YOK (olculmedi) | TEMIZ | CAGIRAN | WEB_AJP;
 *   bayat (Server Hub taze degil); celiski (Server Hub baska JVM diyor)
 */
function filo({
  calisiyor = true,
  esleme = 'KESIN',
  log = 'OLCULDU',
  gercek = 0,
  hc = 0,
  baglanti = 'TEMIZ',
  bayat = false,
  celiski = false,
  ad = 'APP1',
  ikinci = null,
} = {}) {
  const shV = {
    product: 'IHS',
    listen: '*:80',
    serverName: `${ad.toLowerCase()}.ornek.local`,
    aliases: '',
  };
  const j = {
    gen: 8,
    name: ad,
    running: calisiyor === true,
    runningKnown: calisiyor !== null,
    autoStart: 'true',
    ports: calisiyor ? [8109] : [],
    cfgPorts: [],
    cfgPortsAuth: false,
    vhosts: esleme === 'ZAYIF' ? [{ host: WEB, v: shV, kind: 'WEB_APP' }] : [],
    trafficState: null,
  };
  const diger = {
    gen: 8,
    name: 'BASKA',
    running: true,
    runningKnown: true,
    autoStart: 'true',
    ports: [8209],
    cfgPorts: [],
    cfgPortsAuth: false,
    vhosts: celiski ? [{ host: WEB, v: shV, kind: 'EXACT_JVM' }] : [],
    trafficState: null,
  };
  const hosts = [
    {
      host: APP,
      env: 'PROD',
      scanDate: '2026-11-07',
      fresh: !bayat,
      jvms: [j, diger],
      web: [],
      vhosts: [],
      ips: [{ ip: '10.0.1.1' }],
    },
    {
      host: WEB,
      env: 'PROD',
      scanDate: '2026-11-07',
      fresh: true,
      jvms: [],
      web: [{ product: 'IHS', running: true, runningKnown: true }],
      vhosts: esleme === 'ZAYIF' || celiski ? [shV] : [],
      ips: [{ ip: '10.0.0.10' }],
    },
    {
      host: 'CLISRV01',
      env: 'PROD',
      scanDate: '2026-11-07',
      fresh: true,
      jvms: [],
      web: [],
      vhosts: [],
      ips: [{ ip: '10.0.9.1' }],
    },
  ];
  const kur = {
    kurulum: '/usr/jboss8/AppServer',
    nesil: '8',
    olculdu: true,
    faz: true,
    sunucular: [
      { ad, grup: 'g', soket_grubu: '', port_ofseti: 100 },
      { ad: 'BASKA', grup: 'g', soket_grubu: '', port_ofseti: 200 },
    ],
    gruplar: [{ ad: 'g', profil: 'p', soket_grubu: 's', port_ofseti: 0, deployment: 1 }],
    // GUCLU esleme icin mod_cluster: profil web sunucusuna kaydolur, balancer bos (taban ad eslesir).
    soket_gruplari: [
      {
        ad: 's',
        soketler: { ajp: 8009 },
        outbound: esleme === 'GUCLU' ? [{ ad: 'w', host: 'websrv01', port: 6666 }] : [],
      },
    ],
    profiller:
      esleme === 'GUCLU'
        ? [
            {
              ad: 'p',
              modcluster: {
                tur: 'proxy',
                proxies: ['w'],
                proxy_list: [],
                balancer: '',
                advertise: false,
              },
            },
          ]
        : [],
  };
  const logOz =
    log === 'YOK'
      ? null
      : { durum: log, gercek_7g: gercek, hc_7g: hc, hc_istemcileri: hc ? ['10.0.0.250'] : [] };
  const vhostW = {
    server_name: shV.serverName,
    aliases: [],
    adres: ['*:80'],
    belirsiz: false,
    hedefler:
      esleme === 'KESIN'
        ? [{ tur: 'proxy', sema: 'ajp', host: '10.0.1.1', port: 8109 }]
        : esleme === 'GUCLU'
          ? [{ tur: 'mc', sema: 'balancer', host: ad.toLowerCase(), port: null }]
          : [],
    jk: [],
    log: logOz,
  };
  // Ikinci esli vhost (ayni JVM'e KESIN): log durumu ayri (ornek: KISMI).
  const vhost2 = ikinci
    ? {
        server_name: `ikinci-${shV.serverName}`,
        aliases: [],
        adres: ['*:80'],
        belirsiz: false,
        hedefler: [{ tur: 'proxy', sema: 'ajp', host: '10.0.1.1', port: 8109 }],
        jk: [],
        log: { durum: ikinci, gercek_7g: 0, hc_7g: 0, hc_istemcileri: [] },
      }
    : null;
  const uzaklar =
    baglanti === 'CAGIRAN'
      ? [{ ip: '10.0.9.1', gozlem: 3 }]
      : baglanti === 'WEB_AJP'
        ? [{ ip: '10.0.0.10', gozlem: 2 }]
        : [];
  const hv = new Map([
    [
      APP,
      {
        host: APP,
        taranma: '2026-11-06T00:00:00.000Z',
        jboss: [kur],
        web: null,
        baglanti:
          baglanti === 'YOK'
            ? null
            : {
                durum: 'OLCULDU',
                portlar: [{ port: 8109, dinleniyor: calisiyor === true, uzaklar }],
              },
        was: null,
      },
    ],
    [
      WEB,
      {
        host: WEB,
        taranma: '2026-11-06T00:00:00.000Z',
        jboss: null,
        web: {
          durum: 'TAM',
          ipler: ['10.0.0.10'],
          kurulumlar: [
            {
              urun: 'IHS',
              calisiyor: true,
              hata_sayisi: 0,
              mod_cluster: false,
              vhostlar: esleme === 'YOK' ? [] : vhost2 ? [vhostW, vhost2] : [vhostW],
              ana_hedefler: [],
              jk_global: [],
              workers: [],
              balancerlar: [],
              was: null,
            },
          ],
        },
        baglanti: null,
        was: null,
      },
    ],
  ]);
  return { hosts, veri: { hostlar: hv, ipEnvanteri: { okunamadi: false, satirlar: [] } } };
}
function karar(bayrak) {
  const { hosts, veri } = filo(bayrak);
  const g = grafikKur({ hosts, veri });
  const dogrulamalar = dogrula(g, { veri });
  const r = kararla({ g, dogrulamalar, hosts, simdi: SIMDI });
  return { k: r.kopyalar.get(A.jvm(APP, 8, bayrak.ad || 'APP1')), r, g };
}
const kodlar = (k) => k.maddeler.map((m) => m.kod);

test('SN1 dogruluk tablosu', () => {
  const tablo = [
    // [aciklama, bayraklar, beklenen karar, bulunmasi gereken maddeler, bulunmamasi gerekenler]
    ['gercek trafik', { gercek: 40 }, 'KULLANIMDA', ['WEB_TRAFIK_VAR'], []],
    [
      'gercek trafik + celiski: kullanim kazanir',
      { gercek: 40, celiski: true },
      'KULLANIMDA',
      ['WEB_TRAFIK_VAR', 'CELISKI'],
      [],
    ],
    ['web disi cagiran', { baglanti: 'CAGIRAN' }, 'KULLANIMDA', ['CAGIRAN_VAR'], []],
    [
      'web katmaninin AJP baglantisi kullanim sayilmaz',
      { baglanti: 'WEB_AJP' },
      'RETIRE_ADAYI',
      ['WEB_TRAFIK_YOK'],
      ['CAGIRAN_VAR'],
    ],
    ['sikı kosullarin hepsi', {}, 'RETIRE_ADAYI', ['WEB_TRAFIK_YOK'], ['WEB_TRAFIK_OLCULEMEDI']],
    [
      'yalniz saglik kontrolu',
      { hc: 10080 },
      'RETIRE_ADAYI',
      ['WEB_YALNIZ_HC'],
      ['WEB_TRAFIK_YOK'],
    ],
    ['celiski, kullanim yok', { celiski: true }, 'KARAR_VERILEMEZ', ['CELISKI'], []],
    [
      'log kismi: 7 gun iddiasi kurulmaz',
      { log: 'KISMI' },
      'KARAR_VERILEMEZ',
      ['WEB_TRAFIK_OLCULEMEDI'],
      [],
    ],
    ['Faz W yok', { log: 'YOK' }, 'KARAR_VERILEMEZ', ['WEB_TRAFIK_OLCULEMEDI'], []],
    [
      'yalniz ad eslemesi (zayif)',
      { esleme: 'ZAYIF' },
      'KARAR_VERILEMEZ',
      ['WEB_ESLEME_ZAYIF'],
      [],
    ],
    [
      'calisiyor, web eslemesi yok (ic servis olabilir)',
      { esleme: 'YOK' },
      'KARAR_VERILEMEZ',
      ['WEB_ESLEME_YOK'],
      [],
    ],
    ['bayat kanit', { bayat: true }, 'SUPHELI', ['BAYAT', 'WEB_TRAFIK_YOK'], []],
    [
      'baglanti olculmedi, calisiyor',
      { baglanti: 'YOK' },
      'SUPHELI',
      ['BAGLANTI_OLCULMEDI', 'WEB_TRAFIK_YOK'],
      [],
    ],
    [
      'kapali + KESIN esleme + trafik yok; baglanti olculmese de',
      { calisiyor: false, baglanti: 'YOK' },
      'RETIRE_ADAYI',
      ['JVM_KAPALI', 'AUTOSTART_UYUMSUZ'],
      ['BAGLANTI_OLCULMEDI'],
    ],
    [
      'kapali ama vhost istek aliyor: kirik zincir',
      { calisiyor: false, gercek: 5 },
      'KULLANIMDA',
      ['KIRIK_ZINCIR', 'WEB_TRAFIK_VAR'],
      [],
    ],
    [
      'kapali, esleme yok',
      { calisiyor: false, esleme: 'YOK' },
      'SUPHELI',
      ['JVM_KAPALI', 'WEB_ESLEME_YOK'],
      [],
    ],
    [
      'iki esli vhost: biri sifir (destek), digerinin logu kismi -> aday degil, supheli',
      { ikinci: 'KISMI' },
      'SUPHELI',
      ['WEB_TRAFIK_YOK', 'WEB_TRAFIK_OLCULEMEDI'],
      [],
    ],
    [
      'yalniz GUCLU (mod_cluster) esleme: KESIN / dogrulanmis degil -> aday degil',
      { esleme: 'GUCLU' },
      'SUPHELI',
      ['WEB_TRAFIK_YOK'],
      [],
    ],
  ];
  for (const [ack, b, beklenen, var_, yok] of tablo) {
    const { k } = karar(b);
    assert.equal(k.karar, beklenen, `${ack}: ${k.karar} (${kodlar(k).join(', ')})`);
    for (const m of var_)
      assert.ok(kodlar(k).includes(m), `${ack}: ${m} yok (${kodlar(k).join(', ')})`);
    for (const m of yok) assert.ok(!kodlar(k).includes(m), `${ack}: ${m} olmamali`);
  }
});

function prng(tohum) {
  let s = tohum >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const sec = (r, l) => l[Math.floor(r() * l.length)];

test('SN2 degismezler (tohumlu rastgele 400 senaryo)', () => {
  const r = prng(20261107);
  for (let i = 0; i < 400; i++) {
    const b = {
      calisiyor: sec(r, [true, false, null]),
      esleme: sec(r, ['KESIN', 'ZAYIF', 'YOK']),
      log: sec(r, ['OLCULDU', 'KISMI', 'YOK']),
      gercek: sec(r, [0, 0, 3]),
      hc: sec(r, [0, 100]),
      baglanti: sec(r, ['YOK', 'TEMIZ', 'CAGIRAN', 'WEB_AJP']),
      bayat: r() < 0.2,
      celiski: r() < 0.2,
    };
    const { k } = karar(b);
    const ack = JSON.stringify(b);
    const kullanim =
      (b.esleme === 'KESIN' && b.gercek > 0 && b.log !== 'YOK') || b.baglanti === 'CAGIRAN';
    if (kullanim) assert.equal(k.karar, 'KULLANIMDA', `kullanim kaniti: ${ack}`);
    // Olculemeyen engelleyici girdi: trafik olculmedi / kismi, esleme zayif ya da yok, bayat, celiski,
    // calisan JVM'de baglanti olculmedi -> asla RETIRE_ADAYI.
    const engel =
      b.log !== 'OLCULDU' ||
      b.esleme !== 'KESIN' ||
      b.bayat ||
      b.celiski ||
      (b.calisiyor !== false && b.baglanti === 'YOK');
    if (engel)
      assert.notEqual(
        k.karar,
        'RETIRE_ADAYI',
        `engel varken RETIRE_ADAYI: ${ack} -> ${kodlar(k).join(', ')}`,
      );
    if (b.celiski && !kullanim && k.maddeler.some((m) => m.kod === 'CELISKI'))
      assert.equal(k.karar, 'KARAR_VERILEMEZ', `celiski: ${ack}`);
    assert.ok(KARARLAR.includes(k.karar));
  }
});

test('SN3 uygulama toplamasi ve yapilabilecekler', () => {
  // Iki kopya: APP1 (test ortami, kullanilmiyor) ve APP1-T ayni taban uygulama
  const a = filo({ ad: 'APP9' });
  const b = filo({ ad: 'APP9-T', gercek: 12 });
  const hosts = [
    ...a.hosts.map((h) => (h.host === APP ? h : h)),
    { ...b.hosts[0], host: 'APPSRV02', ips: [{ ip: '10.0.1.2' }] },
  ];
  const hv = new Map(a.veri.hostlar);
  const k2 = b.veri.hostlar.get(APP);
  hv.set('APPSRV02', { ...k2, host: 'APPSRV02' });
  const wb = b.veri.hostlar.get(WEB);
  const vb = wb.web.kurulumlar[0].vhostlar[0];
  hv.get(WEB).web.kurulumlar[0].vhostlar.push({
    ...vb,
    hedefler: [{ tur: 'proxy', sema: 'ajp', host: '10.0.1.2', port: 8109 }],
  });
  const veri = { hostlar: hv, ipEnvanteri: { okunamadi: false, satirlar: [] } };
  const g = grafikKur({ hosts, veri });
  const r = kararla({ g, dogrulamalar: dogrula(g, { veri }), hosts, simdi: SIMDI });
  const u = r.uygulamalar.get('app:APP9');
  assert.equal(u.karar, 'KULLANIMDA', u.ozet);
  assert.match(u.ozet, /2 kopya: 1 kopya kullanımda, 1 kopya retire adayı/);
  assert.ok(u.yapilabilecekler.length <= 3);
  assert.ok(u.yapilabilecekler.every((x) => ['yonlendir', 'elle', 'bilgi'].includes(x.tur)));
  // Tek kopya retire adayi -> uygulama RETIRE_ADAYI; FAZ 0 (2026-11-11): Retirement'a DOGRUDAN
  // yonlendirme YOK (dogrulamasiz kayit yolu), yalniz "once elle dogrulayin" maddesi.
  const { r: r2 } = karar({});
  const u2 = r2.uygulamalar.get('app:APP1');
  assert.equal(u2.karar, 'RETIRE_ADAYI');
  assert.ok(!u2.yapilabilecekler.some((x) => x.tur === 'yonlendir' && /Retirement/.test(x.metin)), 'dogrulamasiz Retirement yonlendirmesi geri geldi');
  assert.ok(u2.yapilabilecekler.some((x) => x.tur === 'elle' && /elle doğrulayın/.test(x.metin)));
  // Karar verilemeyen: eksik veri yonlendirmesi
  const { r: r3 } = karar({ log: 'YOK' });
  assert.ok(
    r3.uygulamalar.get('app:APP1').yapilabilecekler.some((x) => /Web kontrolü/.test(x.metin)),
  );
});

test('SN4 uclar: /iliski/kararlar ve /iliski/karar', async () => {
  const { hosts, veri } = filo({});
  const app = express();
  const router = express.Router();
  require('../iliski-uclar.cjs').mount(router, {
    getAssessment: async () => ({ tableMissing: false, hosts }),
    iliskiVerisi: async () => veri,
    simdi: SIMDI,
  });
  app.use('/api/server-hub', router);
  const srv = app.listen(0);
  const kok = `http://127.0.0.1:${srv.address().port}/api/server-hub`;
  const J = async (u) => {
    const r = await fetch(u);
    return { status: r.status, body: await r.json() };
  };
  try {
    const l = await J(`${kok}/iliski/kararlar?fresh=1`);
    assert.equal(l.status, 200);
    assert.equal(l.body.uygulamalar.find((u) => u.anahtar === 'app:APP1').karar, 'RETIRE_ADAYI');
    assert.equal(l.body.sayilar.RETIRE_ADAYI >= 1, true);
    const a = await J(`${kok}/iliski/karar?anahtar=${encodeURIComponent('app:APP1')}`);
    assert.deepEqual(
      [a.status, a.body.tur, a.body.kopyalar[0].karar],
      [200, 'app', 'RETIRE_ADAYI'],
    );
    const s = await J(`${kok}/iliski/karar?anahtar=${encodeURIComponent('sunucu:WEBSRV01')}`);
    assert.deepEqual([s.status, s.body.tur, s.body.web[0].vhost], [200, 'sunucu', 1]);
    const kk = await J(`${kok}/iliski/karar?anahtar=${encodeURIComponent('jvm:APPSRV01|8|APP1')}`);
    assert.equal(kk.body.kopya.karar, 'RETIRE_ADAYI');
    assert.deepEqual(kk.body.kopya.uygulamalar, ['app:APP1'], 'kopyadan uygulamaya gecis');
    assert.equal((await J(`${kok}/iliski/karar?anahtar=app:YOK`)).status, 409);
    assert.equal((await J(`${kok}/iliski/karar?anahtar=vhost:x`)).status, 400);
  } finally {
    srv.close();
  }
  // Uc saati karar motoruna verir: ayni fikstur iki ay sonra (Faz W / baglanti bayat) aday DEGIL.
  // Hesap hatasi 424 (5xx degil: nginx govdeyi HTML yapar, ekran "okunamadi" diyemez).
  const ikinci = express();
  const r2 = express.Router();
  require('../iliski-uclar.cjs').mount(r2, {
    getAssessment: async () => ({ tableMissing: false, hosts }),
    iliskiVerisi: async () => veri,
    simdi: () => Date.parse('2027-01-07T12:00:00Z'),
  });
  const r3 = express.Router();
  require('../iliski-uclar.cjs').mount(r3, {
    getAssessment: async () => {
      throw new Error('assess patladi');
    },
    iliskiVerisi: async () => veri,
  });
  ikinci.use('/a', r2);
  ikinci.use('/b', r3);
  const srv2 = ikinci.listen(0);
  const k2 = `http://127.0.0.1:${srv2.address().port}`;
  try {
    const kk = await J(`${k2}/a/iliski/karar?anahtar=${encodeURIComponent('jvm:APPSRV01|8|APP1')}`);
    assert.notEqual(kk.body.kopya.karar, 'RETIRE_ADAYI', 'bayat kanit aday yapmaz');
    for (const u of [
      '/iliski/durum',
      '/iliski/ara?q=app',
      '/iliski/kararlar',
      '/iliski/karar?anahtar=app:APP1',
    ]) {
      const r = await J(`${k2}/b${u}`);
      assert.deepEqual([r.status, r.body.ok, r.body.message], [424, false, 'assess patladi'], u);
    }
    const v = await J(`${k2}/b/iliski/varlik?anahtar=app:APP1`);
    assert.equal(v.status, 424);
  } finally {
    srv2.close();
  }
});

test('SN5 tazelik her kanitin kendi sunucusundan: bayat sifir "olculemedi", aday olamaz', () => {
  const kopya = (f, simdi = SIMDI) => {
    const g = grafikKur(f);
    const r = kararla({ g, dogrulamalar: dogrula(g, { veri: f.veri }), hosts: f.hosts, simdi });
    return r.kopyalar.get(A.jvm(APP, 8, 'APP1'));
  };
  // (a) 3-tier: sifir yalniz web sunucusunun access log'undan; o tarama 23 gun once -> aday degil.
  const a = filo({});
  assert.equal(kopya(a).karar, 'RETIRE_ADAYI', 'taze taban');
  a.veri.hostlar.get(WEB).taranma = '2026-10-15T00:00:00.000Z';
  const ka = kopya(a);
  assert.notEqual(ka.karar, 'RETIRE_ADAYI', kodlar(ka).join(', '));
  const m = ka.maddeler.find((x) => x.kod === 'WEB_TRAFIK_OLCULEMEDI');
  assert.ok(m && /bayat/.test(m.metin) && /2026-10-15/.test(m.metin), m && m.metin);
  assert.ok(ka.eksikler.some((e) => /taze ölçüm/.test(e.ne) && /WEBSRV01/.test(e.nasil)));
  assert.ok(!kodlar(ka).includes('WEB_TRAFIK_YOK'), 'bayat sifir destek sayilmaz');

  // (b) sifir yalniz Server Hub req_7d'den (Faz W logu yok): web sunucusunun Server Hub taramasi bayatsa aday degil.
  const sh = () => {
    const f = filo({ log: 'YOK' });
    const web = f.hosts.find((h) => h.host === WEB);
    const v = {
      product: 'IHS',
      listen: '*:80',
      serverName: 'app1.ornek.local',
      aliases: '',
      req7d: 0,
      hc24h: 0,
      trafficState: 'NO_RECENT_TRAFFIC',
    };
    web.vhosts = [v];
    f.hosts[0].jvms[0].vhosts = [{ host: WEB, v, kind: 'EXACT_JVM' }];
    return f;
  };
  assert.equal(kopya(sh()).karar, 'RETIRE_ADAYI', 'Server Hub taze sifir yeterli');
  const b = sh();
  b.hosts.find((h) => h.host === WEB).fresh = false;
  const kb = kopya(b);
  assert.notEqual(kb.karar, 'RETIRE_ADAYI', kodlar(kb).join(', '));
  assert.ok(kb.maddeler.some((x) => x.kod === 'WEB_TRAFIK_OLCULEMEDI' && /bayat/.test(x.metin)));

  // (c) baglanti goruntusu uygulama sunucusunun UE taramasindan: 9.5 gun once (TAZELIK farki 7 gun, UYUM)
  //     -> calisan JVM icin "web disi cagiran yok" kurulmaz; kapali JVM icin baglanti gerekmez.
  const simdi2 = () => Date.parse('2026-11-09T12:00:00Z');
  const c = filo({});
  c.veri.hostlar.get(APP).taranma = '2026-10-31T00:00:00.000Z';
  const kc = kopya(c, simdi2);
  assert.notEqual(kc.karar, 'RETIRE_ADAYI', kodlar(kc).join(', '));
  assert.ok(
    kc.maddeler.some((x) => x.kod === 'BAYAT' && /bağlantı görüntüsü 2026-10-31/.test(x.metin)),
  );
  assert.ok(kc.eksikler.some((e) => e.ne === 'taze bağlantı görüntüsü'));
  const d = filo({ calisiyor: false });
  d.veri.hostlar.get(APP).taranma = '2026-10-31T00:00:00.000Z';
  assert.equal(
    kopya(d, simdi2).karar,
    'RETIRE_ADAYI',
    'kapali JVM: baglanti bayatligi engel degil',
  );

  // (d) kullanim kaniti bayat da olsa kazanir (guvenli taraf).
  const e = filo({ gercek: 9 });
  e.veri.hostlar.get(WEB).taranma = '2026-09-01T00:00:00.000Z';
  assert.equal(kopya(e).karar, 'KULLANIMDA');
});

// FAZ 1 (2026-11-11, docs/RETIREMENT-MOTOR-BIRLESTIRME.md): Analiz aciklari.
//   SN6a ZAYIF (yalniz ada dayanan) eslemeli vhost'un gercek trafigi KULLANIMDA (G6)
//   SN6b Server Hub retire engeli (STALE / WEB_TIER / MAPPING ...) varken RETIRE_ADAYI yok (G7)
//   SN6c JBoss nesli bilinmeyen kopya RETIRE_ADAYI olamaz (G7)
function kararHosts(bayrak, degistir) {
  const { hosts, veri } = filo(bayrak);
  degistir(hosts);
  const g = grafikKur({ hosts, veri });
  const r = kararla({ g, dogrulamalar: dogrula(g, { veri }), hosts, simdi: SIMDI });
  return { r, g };
}
test('SN6a zayif eslemeli vhost trafigi kullanimdir', () => {
  const sifir = karar({ esleme: 'ZAYIF', gercek: 0 }).k;
  assert.notEqual(sifir.karar, 'RETIRE_ADAYI', 'zayif esleme retire adayi yapti');
  const { k } = karar({ esleme: 'ZAYIF', gercek: 40 });
  assert.equal(k.karar, 'KULLANIMDA', `zayif eslemeli trafik kullanim sayilmadi: ${kodlar(k).join(',')}`);
  assert.ok(kodlar(k).includes('WEB_TRAFIK_VAR'));
});
test('SN6b retire engeli adayi kapatir (KARAR_VERILEMEZ, sorun yok DEGIL)', () => {
  assert.equal(karar({}).k.karar, 'RETIRE_ADAYI', 'fikstur on kosulu');
  const { r } = kararHosts({}, (hosts) => {
    hosts[0].jvms[0].retireEngeli = { kod: 'WEB_TIER', metin: 'web katmaninda olculemeyen host var: X' };
  });
  const k = r.kopyalar.get(A.jvm(APP, 8, 'APP1'));
  assert.equal(k.karar, 'KARAR_VERILEMEZ');
  assert.ok(kodlar(k).includes('RETIRE_ENGELI'));
  // Kullanim kaniti engelden once gelir.
  const { r: r2 } = kararHosts({ gercek: 5 }, (hosts) => {
    hosts[0].jvms[0].retireEngeli = { kod: 'STALE', metin: 'bayat' };
  });
  assert.equal(r2.kopyalar.get(A.jvm(APP, 8, 'APP1')).karar, 'KULLANIMDA');
});
test('SN6c nesli bilinmeyen kopya aday olamaz', () => {
  const { r } = kararHosts({}, (hosts) => {
    hosts[0].jvms[0].gen = null;
  });
  const k = [...r.kopyalar.values()].find((x) => x.anahtar.startsWith(`jvm:${APP}|?|APP1`));
  assert.ok(k, 'nesilsiz kopya grafikte yok');
  assert.notEqual(k.karar, 'RETIRE_ADAYI');
  assert.ok(kodlar(k).includes('NESIL_BILINMIYOR'));
});
