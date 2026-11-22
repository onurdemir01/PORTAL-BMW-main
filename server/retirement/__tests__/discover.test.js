// server/retirement/__tests__/discover.test.js — RD1..RD5 (2026-09-21).
// Retirement kesfi: tum ortamlar (base, base-D/T/Q), Ankara siteleri, web sunucusu Web-App kuraliyla,
// JBoss nesli jboss_version'dan, Server Hub JVM durumu varsa eklenir.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildTargets, siteOf, parseAppName, genOf } = require('../discover.cjs');

test('RD1: site kurali ...AP<n> = Ankara, aksi Pendik', () => {
  assert.equal(siteOf('ORNGXAP34'), 'Ankara');
  assert.equal(siteOf('ORCJAAP02'), 'Ankara');
  assert.equal(siteOf('ORNGXP40'), 'Pendik');
  assert.equal(siteOf('DACRAAP01'), 'Ankara');
  assert.equal(siteOf('ORCJAP01'), 'Pendik'); // tier A, site harfi yok (cepsube restart Pendik seti)
  assert.equal(siteOf('ORCJAAP02'), 'Ankara'); // cepsube restart Ankara seti
  assert.equal(siteOf('ORCRAT01'), 'Pendik');
});

test('RD2: uygulama adi kurali ve JBoss nesli', () => {
  assert.deepEqual(parseAppName('CRM-T'), { base: 'CRM', env: 'TEST' });
  assert.deepEqual(parseAppName('CRM'), { base: 'CRM', env: 'PROD' });
  assert.equal(genOf('EAP 7.4.0'), 7);
  assert.equal(genOf('8.0.1'), 8);
  assert.equal(genOf(''), null);
});

test('RD3: kesif tum ortamlari ve iki siteyi toplar; web sunucusu 5. harf A->W + server_name', () => {
  const inv = [
    {
      app: 'CRM',
      host: 'ORCRAAP01',
      env: 'Production',
      domain: 'x',
      jboss_version: '7.4',
      app_path: '/vhosting/crm/crm.ear',
      status: 'running',
    },
    {
      app: 'CRM',
      host: 'ORCRAP01',
      env: 'Production',
      domain: 'x',
      jboss_version: '7.4',
      app_path: '/vhosting/crm/crm.ear',
      status: 'running',
    },
    {
      app: 'CRM-T',
      host: 'ORCRAT01',
      env: 'Test',
      domain: 'x',
      jboss_version: '8.0',
      app_path: '',
      status: 'stopped',
    },
    {
      app: 'CRMX',
      host: 'ORZZAP01',
      env: 'Production',
      domain: 'x',
      jboss_version: '7',
      app_path: '',
      status: 'running',
    }, // baska uygulama
  ];
  const certs = [
    {
      host: 'ORCRWAP01',
      ip: '1',
      port: '443',
      server_name: 'crm.fw.local',
      conf_file: '/c',
      product: 'IHS',
      env: 'P',
    },
  ];
  // JBoss 7 hedefi: yalniz adla eslesen RHA artik sayilmaz (IN10), bu yuzden ornek IHS
  const r = buildTargets('CRM', inv, certs, [
    { host: 'ORCRAAP01', jvm: 'CRM', running: 1, auto_start: 'true', scan_date: '2026-09-21' },
  ]);
  assert.equal(r.summary.total, 3);
  assert.deepEqual(r.summary.bySite, { Pendik: 2, Ankara: 1 });
  assert.equal(r.summary.prod, true);
  const ank = r.targets.find((t) => t.host === 'ORCRAAP01');
  assert.equal(ank.site, 'Ankara');
  assert.equal(ank.gen, 7);
  assert.equal(ank.web.length, 1);
  assert.equal(ank.web[0].host, 'ORCRWAP01');
  assert.equal(ank.hub.running, true);
  const t = r.targets.find((t) => t.appName === 'CRM-T');
  assert.equal(t.env, 'TEST');
  assert.equal(t.gen, 8);
  assert.equal(t.hub, null);
  assert.equal(r.targets[0].env, 'PROD', 'prod once');
});

test('RD4: ayni host+app tekrar satirlari tek hedef', () => {
  const inv = [
    { app: 'A', host: 'H1', jboss_version: '7' },
    { app: 'A', host: 'h1', jboss_version: '7', app_path: '/x' },
  ];
  assert.equal(buildTargets('A', inv, [], []).targets.length, 1);
});

test('RD5: taban adi farkli olan uygulama disarida', () => {
  assert.equal(
    buildTargets(
      'CRM',
      [
        { app: 'CRM2', host: 'H' },
        { app: 'CRM-Q', host: 'H2' },
      ],
      [],
      [],
    ).targets.length,
    1,
  );
});

test('RD9 eksiz paket adi QA sunucusundaysa QA (envanter env), PROD DEGIL; son ek varsa o kazanir; belirsizse PROD', () => {
  // Kullanici (2026-10-12): "paket isminden dolayi QA retirement'lari production gibi algilaniyor"
  const { hedefOrtami } = require('../discover.cjs');
  assert.equal(hedefOrtami('ORPAYMENT', 'QA'), 'QA');
  assert.equal(hedefOrtami('ORPAYMENT', 'Test'), 'TEST');
  assert.equal(hedefOrtami('ORPAYMENT', 'Production'), 'PROD');
  assert.equal(hedefOrtami('ORPAYMENT', ''), 'PROD', 'envanter bos iken guvenli taraf PROD olmali');
  assert.equal(hedefOrtami('ORPAYMENT', 'Uydurma'), 'PROD');
  assert.equal(
    hedefOrtami('ORPAYMENT-D', 'Test'),
    'DEV',
    'son ek envanterden once gelmeli (sutun D/T ayirt edemez)',
  );
  assert.equal(hedefOrtami('ORPAYMENT-Q', 'Production'), 'QA');
  const out = buildTargets(
    'ORPAYMENT',
    [
      {
        app: 'ORPAYMENT',
        host: 'ORJBOQ16',
        env: 'QA',
        domain: 'x',
        jboss_version: '8.0',
        app_path: '',
        status: 'running',
      },
      {
        app: 'ORPAYMENT',
        host: 'ORJBOP16',
        env: 'Production',
        domain: 'x',
        jboss_version: '8.0',
        app_path: '',
        status: 'running',
      },
    ],
    [],
    [],
    [],
  );
  const by = Object.fromEntries(out.targets.map((t) => [t.host, t.env]));
  assert.deepEqual(by, { ORJBOQ16: 'QA', ORJBOP16: 'PROD' });
  assert.equal(out.summary.byEnv.QA, 1);
});

test('RD10 AJP/proxy: ad tutmasa da vhost hedefi uygulamanin sunucusu + JVM portu ise BULUNUR', () => {
  // Kullanici (2026-10-12): "uygulamanin ismi onur ama Apache'ye cansu.fwsirket.invalid diye tanim yapilmis olabilir"
  const inv = [
    {
      app: 'ONUR',
      host: 'ORJBOP10',
      env: 'Production',
      domain: 'fw.sirket.invalid',
      jboss_version: '7.4',
      app_path: '',
      status: 'stopped',
    },
  ]; // IHS -> JBoss 7
  const jvm = [
    {
      host: 'ORJBOP10',
      jvm: 'ONUR',
      running: 0,
      auto_start: 'false',
      scan_date: '2026-10-12',
      ports: '',
      cfg_ports: '8159,8230',
    },
  ];
  const V = (host, sn, px, listen = '10.9.9.9:443') => ({
    host,
    server_name: sn,
    listen,
    conf_file: `/usr/IBMIHS/conf/${sn}.conf`,
    product: 'IHS',
    proxy_targets: px,
  });
  const vh = [
    V('ORJBOWP10', 'cansu.fw.sirket.invalid', 'orjbop10:8159'), // ad tutmuyor, AJP tutuyor
    V('ORJBOWP10', 'ip-hedef.fw.sirket.invalid', '10.1.2.3:8230'), // IP -> tek sahibi ORJBOP10
    V('ORJBOWP10', 'vip.fw.sirket.invalid', '10.5.5.5:8159'), // IP iki sunucuda (VIP) -> cozulmez
    V('ORJBOWP10', 'baska-port.fw.sirket.invalid', 'orjbop10:9999'), // port JVM'in degil
    V('ORJBOWP10', 'dinamik.fw.sirket.invalid', '~DYNAMIC'), // olculemedi: eslesme sayilmaz
    V('ORJBOP10', 'yerel.fw.sirket.invalid', 'localhost:8159'), // ayni sunucuda localhost
  ];
  const ips = [
    { host: 'ORJBOP10', ip: '10.1.2.3' },
    { host: 'ORJBOP10', ip: '10.5.5.5' },
    { host: 'ORJBOP11', ip: '10.5.5.5' },
  ];
  const t = buildTargets('ONUR', inv, [], jvm, vh, ips).targets[0];
  const bulunan = t.web.map((w) => [w.serverName, w.kaynak]).sort();
  assert.deepEqual(bulunan, [
    ['cansu.fw.sirket.invalid', 'ajp'],
    ['ip-hedef.fw.sirket.invalid', 'ajp'],
    ['yerel.fw.sirket.invalid', 'ajp'],
  ]);
  assert.match(t.webHow, /AJP\/proxy hedefi = JVM portu \(3 vhost, 3 yalniz AJP ile bulundu\)/);
  assert.equal(
    t.web.find((w) => w.serverName === 'cansu.fw.sirket.invalid').ajpHedef,
    'orjbop10:8159',
  );
});

test('RD11 JVM portu bilinmiyorsa (cfg_ports ve ports bos) AJP eslesmesi YAPILMAZ; ad eslesmesi aynen calisir', () => {
  const inv = [
    {
      app: 'ONUR',
      host: 'ORJBOP10',
      env: 'Production',
      domain: 'fw.sirket.invalid',
      jboss_version: '7.4',
    },
  ]; // IHS -> JBoss 7
  const vh = [
    {
      host: 'ORJBOP10',
      server_name: 'onur.fw.sirket.invalid',
      listen: '*:443',
      conf_file: '/c',
      product: 'IHS',
      proxy_targets: 'orjbop10:8159',
    },
  ];
  const t = buildTargets(
    'ONUR',
    inv,
    [],
    [{ host: 'ORJBOP10', jvm: 'ONUR', running: 0, ports: '', cfg_ports: null }],
    vh,
    [],
  ).targets[0];
  assert.deepEqual(
    t.web.map((w) => [w.serverName, w.kaynak]),
    [['onur.fw.sirket.invalid', 'ad']],
  );
});

// 3-TIER WEB ADAYI AB->WP (2026-10-12, kullanici: "GOJBAB03'un web hostu GOJBWP03"). Eski tek kural
// (5. harf A->W) var olmayan GOJBWB03'u uretiyordu; web katmani sessizce "eslenemedi" kaliyordu.
test('T3W1 GOJBAB03 -> web GOJBWP03 (Server Hub vhost) bulunur', () => {
  const inv = [
    { app: 'GFYSVC-D', host: 'GOJBAB03', env: 'DEV', domain: 'odmz.invalid', jboss_version: '7' },
  ];
  const vh = [
    {
      host: 'GOJBWP03',
      server_name: 'gfysvc-d.odmz.invalid',
      aliases: '',
      listen: '*:443',
      conf_file: '/x/a.conf',
      product: 'IHS',
    },
  ];
  const t = buildTargets('GFYSVC', inv, [], [], vh).targets[0];
  assert.equal(t.web.length, 1, t.webHow);
  assert.equal(t.web[0].host, 'GOJBWP03');
  assert.equal(t.webUyari, null);
});

test('T3W2 sertifika envanterinde GOJBWP03 de bulunur', () => {
  const inv = [
    { app: 'GFYSVC-D', host: 'GOJBAB03', env: 'DEV', domain: 'odmz.invalid', jboss_version: '7' },
  ];
  const certs = [
    {
      host: 'GOJBWP03',
      server_name: 'gfysvc-d.odmz.invalid',
      port: '443',
      conf_file: '/x/a.conf',
      product: 'IHS',
    },
  ];
  const t = buildTargets('GFYSVC', inv, certs, [], []).targets[0];
  assert.equal(t.web[0]?.host, 'GOJBWP03', t.webHow);
});

test('T3W3 web bulunamazsa SESSIZ KALINMAZ: 3-tier uyarisi denenen adaylarla', () => {
  const inv = [
    { app: 'GFYSVC-D', host: 'GOJBAB03', env: 'DEV', domain: 'odmz.invalid', jboss_version: '7' },
  ];
  const r = buildTargets('GFYSVC', inv, [], [], []);
  const t = r.targets[0];
  assert.equal(t.web.length, 0);
  assert.match(t.webUyari, /^3-tier: web vhost'u BULUNAMADI/);
  assert.match(t.webUyari, /GOJBWB03/);
  assert.match(t.webUyari, /GOJBWP03 \(taramada yok\)/);
  assert.equal(r.summary.webBulunamadi, 1);
});

test('T3W4 aday kurali: Pendik 6 harf, Ankara 7 harf; 5. harf A->W, son harf -> P', () => {
  const { webHostAdaylari } = require('../../audit/web-app.cjs');
  assert.deepEqual(webHostAdaylari('GOJBAB03'), ['GOJBWB03', 'GOJBWP03']);
  assert.deepEqual(webHostAdaylari('ORCJAP01'), ['ORCJWP01']);
  assert.deepEqual(webHostAdaylari('DACRAAP01'), ['DACRWAP01']);
  assert.deepEqual(webHostAdaylari('DACRAAB01'), ['DACRWAB01', 'DACRWAP01']);
  assert.deepEqual(webHostAdaylari('ORNGXP40'), []);
});
