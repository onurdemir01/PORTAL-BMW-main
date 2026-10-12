// server/retirement/__tests__/discover.test.cjs — RD1..RD5 (2026-09-21).
// Retirement kesfi: tum ortamlar (base, base-D/T/Q), Ankara siteleri, web sunucusu Web-App kuraliyla,
// JBoss nesli jboss_version'dan, Server Hub JVM durumu varsa eklenir.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildTargets, siteOf, parseAppName, genOf } = require('../discover.cjs');

test('RD1: site kurali ...AP<n> = Ankara, aksi Pendik', () => {
  assert.equal(siteOf('GBNGXAP34'), 'Ankara');
  assert.equal(siteOf('GBCJAAP02'), 'Ankara');
  assert.equal(siteOf('GBNGXP40'), 'Pendik');
  assert.equal(siteOf('DACRAAP01'), 'Ankara');
  assert.equal(siteOf('GBCJAP01'), 'Pendik'); // tier A, site harfi yok (cepsube restart Pendik seti)
  assert.equal(siteOf('GBCJAAP02'), 'Ankara'); // cepsube restart Ankara seti
  assert.equal(siteOf('GBCRAT01'), 'Pendik');
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
    { app: 'CRM', host: 'GBCRAAP01', env: 'Production', domain: 'x', jboss_version: '7.4', app_path: '/vhosting/crm/crm.ear', status: 'running' },
    { app: 'CRM', host: 'GBCRAP01', env: 'Production', domain: 'x', jboss_version: '7.4', app_path: '/vhosting/crm/crm.ear', status: 'running' },
    { app: 'CRM-T', host: 'GBCRAT01', env: 'Test', domain: 'x', jboss_version: '8.0', app_path: '', status: 'stopped' },
    { app: 'CRMX', host: 'GBZZAP01', env: 'Production', domain: 'x', jboss_version: '7', app_path: '', status: 'running' }, // baska uygulama
  ];
  const certs = [{ host: 'GBCRWAP01', ip: '1', port: '443', server_name: 'crm.fw.local', conf_file: '/c', product: 'RHA', env: 'P' }];
  const r = buildTargets('CRM', inv, certs, [{ host: 'GBCRAAP01', jvm: 'CRM', running: 1, auto_start: 'true', scan_date: '2026-09-21' }]);
  assert.equal(r.summary.total, 3);
  assert.deepEqual(r.summary.bySite, { Pendik: 2, Ankara: 1 });
  assert.equal(r.summary.prod, true);
  const ank = r.targets.find((t) => t.host === 'GBCRAAP01');
  assert.equal(ank.site, 'Ankara');
  assert.equal(ank.gen, 7);
  assert.equal(ank.web.length, 1);
  assert.equal(ank.web[0].host, 'GBCRWAP01');
  assert.equal(ank.hub.running, true);
  const t = r.targets.find((t) => t.appName === 'CRM-T');
  assert.equal(t.env, 'TEST'); assert.equal(t.gen, 8); assert.equal(t.hub, null);
  assert.equal(r.targets[0].env, 'PROD', 'prod once');
});

test('RD4: ayni host+app tekrar satirlari tek hedef', () => {
  const inv = [{ app: 'A', host: 'H1', jboss_version: '7' }, { app: 'A', host: 'h1', jboss_version: '7', app_path: '/x' }];
  assert.equal(buildTargets('A', inv, [], []).targets.length, 1);
});

test('RD5: taban adi farkli olan uygulama disarida', () => {
  assert.equal(buildTargets('CRM', [{ app: 'CRM2', host: 'H' }, { app: 'CRM-Q', host: 'H2' }], [], []).targets.length, 1);
});

test('RD9 eksiz paket adi QA sunucusundaysa QA (envanter env), PROD DEGIL; son ek varsa o kazanir; belirsizse PROD', () => {
  // Kullanici (2026-10-12): "paket isminden dolayi QA retirement'lari production gibi algilaniyor"
  const { hedefOrtami } = require('../discover.cjs');
  assert.equal(hedefOrtami('GBPAYMENT', 'QA'), 'QA');
  assert.equal(hedefOrtami('GBPAYMENT', 'Test'), 'TEST');
  assert.equal(hedefOrtami('GBPAYMENT', 'Production'), 'PROD');
  assert.equal(hedefOrtami('GBPAYMENT', ''), 'PROD', 'envanter bos iken guvenli taraf PROD olmali');
  assert.equal(hedefOrtami('GBPAYMENT', 'Uydurma'), 'PROD');
  assert.equal(hedefOrtami('GBPAYMENT-D', 'Test'), 'DEV', 'son ek envanterden once gelmeli (sutun D/T ayirt edemez)');
  assert.equal(hedefOrtami('GBPAYMENT-Q', 'Production'), 'QA');
  const out = buildTargets('GBPAYMENT', [
    { app: 'GBPAYMENT', host: 'GBJBOQ16', env: 'QA', domain: 'x', jboss_version: '8.0', app_path: '', status: 'running' },
    { app: 'GBPAYMENT', host: 'GBJBOP16', env: 'Production', domain: 'x', jboss_version: '8.0', app_path: '', status: 'running' },
  ], [], [], []);
  const by = Object.fromEntries(out.targets.map((t) => [t.host, t.env]));
  assert.deepEqual(by, { GBJBOQ16: 'QA', GBJBOP16: 'PROD' });
  assert.equal(out.summary.byEnv.QA, 1);
});

test('RD10 AJP/proxy: ad tutmasa da vhost hedefi uygulamanin sunucusu + JVM portu ise BULUNUR', () => {
  // Kullanici (2026-10-12): "uygulamanin ismi onur ama Apache'ye cansu.fwgaranti.com.tr diye tanim yapilmis olabilir"
  const inv = [{ app: 'ONUR', host: 'GBJBOP10', env: 'Production', domain: 'fw.garanti.com.tr', jboss_version: '8.0', app_path: '', status: 'stopped' }];
  const jvm = [{ host: 'GBJBOP10', jvm: 'ONUR', running: 0, auto_start: 'false', scan_date: '2026-10-12', ports: '', cfg_ports: '8159,8230' }];
  const V = (host, sn, px, listen = '10.9.9.9:443') => ({ host, server_name: sn, listen, conf_file: `/usr/IBMIHS/conf/${sn}.conf`, product: 'IHS', proxy_targets: px });
  const vh = [
    V('GBJBOWP10', 'cansu.fw.garanti.com.tr', 'gbjbop10:8159'),          // ad tutmuyor, AJP tutuyor
    V('GBJBOWP10', 'ip-hedef.fw.garanti.com.tr', '10.1.2.3:8230'),       // IP -> tek sahibi GBJBOP10
    V('GBJBOWP10', 'vip.fw.garanti.com.tr', '10.5.5.5:8159'),            // IP iki sunucuda (VIP) -> cozulmez
    V('GBJBOWP10', 'baska-port.fw.garanti.com.tr', 'gbjbop10:9999'),     // port JVM'in degil
    V('GBJBOWP10', 'dinamik.fw.garanti.com.tr', '~DYNAMIC'),             // olculemedi: eslesme sayilmaz
    V('GBJBOP10', 'yerel.fw.garanti.com.tr', 'localhost:8159'),          // ayni sunucuda localhost
  ];
  const ips = [{ host: 'GBJBOP10', ip: '10.1.2.3' }, { host: 'GBJBOP10', ip: '10.5.5.5' }, { host: 'GBJBOP11', ip: '10.5.5.5' }];
  const t = buildTargets('ONUR', inv, [], jvm, vh, ips).targets[0];
  const bulunan = t.web.map((w) => [w.serverName, w.kaynak]).sort();
  assert.deepEqual(bulunan, [['cansu.fw.garanti.com.tr', 'ajp'], ['ip-hedef.fw.garanti.com.tr', 'ajp'], ['yerel.fw.garanti.com.tr', 'ajp']]);
  assert.match(t.webHow, /AJP\/proxy hedefi = JVM portu \(3 vhost, 3 yalniz AJP ile bulundu\)/);
  assert.equal(t.web.find((w) => w.serverName === 'cansu.fw.garanti.com.tr').ajpHedef, 'gbjbop10:8159');
});

test('RD11 JVM portu bilinmiyorsa (cfg_ports ve ports bos) AJP eslesmesi YAPILMAZ; ad eslesmesi aynen calisir', () => {
  const inv = [{ app: 'ONUR', host: 'GBJBOP10', env: 'Production', domain: 'fw.garanti.com.tr', jboss_version: '8.0' }];
  const vh = [{ host: 'GBJBOP10', server_name: 'onur.fw.garanti.com.tr', listen: '*:443', conf_file: '/c', product: 'IHS', proxy_targets: 'gbjbop10:8159' }];
  const t = buildTargets('ONUR', inv, [], [{ host: 'GBJBOP10', jvm: 'ONUR', running: 0, ports: '', cfg_ports: null }], vh, []).targets[0];
  assert.deepEqual(t.web.map((w) => [w.serverName, w.kaynak]), [['onur.fw.garanti.com.tr', 'ad']]);
});

// 3-TIER WEB ADAYI AB->WP (2026-10-12, kullanici: "GOJBAB03'un web hostu GOJBWP03"). Eski tek kural
// (5. harf A->W) var olmayan GOJBWB03'u uretiyordu; web katmani sessizce "eslenemedi" kaliyordu.
test('T3W1 GOJBAB03 -> web GOJBWP03 (Server Hub vhost) bulunur', () => {
  const inv = [{ app: 'GFYSVC-D', host: 'GOJBAB03', env: 'DEV', domain: 'gtdmz.com.tr', jboss_version: '7' }];
  const vh = [{ host: 'GOJBWP03', server_name: 'gfysvc-d.gtdmz.com.tr', aliases: '', listen: '*:443', conf_file: '/x/a.conf', product: 'IHS' }];
  const t = buildTargets('GFYSVC', inv, [], [], vh).targets[0];
  assert.equal(t.web.length, 1, t.webHow);
  assert.equal(t.web[0].host, 'GOJBWP03');
  assert.equal(t.webUyari, null);
});

test('T3W2 sertifika envanterinde GOJBWP03 de bulunur', () => {
  const inv = [{ app: 'GFYSVC-D', host: 'GOJBAB03', env: 'DEV', domain: 'gtdmz.com.tr', jboss_version: '7' }];
  const certs = [{ host: 'GOJBWP03', server_name: 'gfysvc-d.gtdmz.com.tr', port: '443', conf_file: '/x/a.conf', product: 'IHS' }];
  const t = buildTargets('GFYSVC', inv, certs, [], []).targets[0];
  assert.equal(t.web[0]?.host, 'GOJBWP03', t.webHow);
});

test('T3W3 web bulunamazsa SESSIZ KALINMAZ: 3-tier uyarisi denenen adaylarla', () => {
  const inv = [{ app: 'GFYSVC-D', host: 'GOJBAB03', env: 'DEV', domain: 'gtdmz.com.tr', jboss_version: '7' }];
  const r = buildTargets('GFYSVC', inv, [], [], []);
  const t = r.targets[0];
  assert.equal(t.web.length, 0);
  assert.match(t.webUyari, /^3-tier: web vhost'u BULUNAMADI/);
  assert.match(t.webUyari, /GOJBWB03/);
  assert.match(t.webUyari, /GOJBWP03 \(taramada yok\)/);
  assert.equal(r.summary.webBulunamadi, 1);
});
