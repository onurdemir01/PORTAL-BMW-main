// server/nginx-expose/__tests__/group-test-apis.test.cjs
//
// "API'yi internete ac" ekraninin liste mantigi. DB gerektirmez.
//
// Buradaki iki ozellik GUVENLIKLE ilgili, o yuzden kilitleniyor:
//   1) liste YALNIZCA test ortamini dondurur - playbook da yalnizca env=test kabul
//      ediyor; ikisi ayrisirsa kullanici butonu gorur ama is sebepsiz reddedilir,
//      ya da daha kotusu yanlis ortamdan kopyalama denenir.
//   2) bir API = BIR DOSYA; ayni dosya birden cok sunucuda ayna olabilir, hostlar
//      toplanip yollar tekillestirilmeli - aksi halde ayni yol defalarca gorunurdu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _groupTestApis: groupTestApis } = require('../index.cjs');

const row = (host, config_file, api_location, ip = null, srv = null) => ({
  host, config_file, api_location, ip_rate_limit: ip, server_rate_limit: srv,
});

test('YALNIZCA test ortamı — diğer ortamlar listeye girmez', () => {
  const { rows, hosts } = groupTestApis([
    row('GBNGWT03', 'testapi.conf', '/t/v1'),
    row('GBNGWD01', 'devapi.conf', '/d/v1'),   // DEV
    row('GBNGWP01', 'prodapi.conf', '/p/v1'),  // PROD
    row('GBNGWQ01', 'qaapi.conf', '/q/v1'),    // QA
  ]);
  assert.deepEqual(rows.map((r) => r.configFile), ['testapi.conf']);
  assert.deepEqual(hosts, ['GBNGWT03']);
});

test('tanınmayan sunucu adı listeye GİRMEZ (sessizce test sayılmaz)', () => {
  const { rows } = groupTestApis([
    row('kimbilir', 'x.conf', '/x'),
    row('GBNGWT04', 'y.conf', '/y'),
  ]);
  assert.deepEqual(rows.map((r) => r.configFile), ['y.conf']);
});

test('api adı dosya adından .conf çıkarılarak türer (playbook bunu bekler)', () => {
  const { rows } = groupTestApis([row('GBNGWT03', 'musteri-api.conf', '/m/v1')]);
  assert.equal(rows[0].api, 'musteri-api');
  assert.equal(rows[0].configFile, 'musteri-api.conf');
});

test('aynı dosya birden çok sunucuda: hostlar toplanır, yollar TEKİLLEŞİR', () => {
  const { rows } = groupTestApis([
    row('GBNGWT04', 'x.conf', '/a'),
    row('GBNGWT03', 'x.conf', '/a'),   // ayni yol, baska sunucu
    row('GBNGWT03', 'x.conf', '/b'),
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].hosts, ['GBNGWT03', 'GBNGWT04'], 'sirali ve tekil');
  assert.deepEqual(rows[0].locations.map((l) => l.path), ['/a', '/b'], 'yol tekrarlanmaz');
});

test('rate limitler yolla birlikte taşınır', () => {
  const { rows } = groupTestApis([
    row('GBNGWT03', 'x.conf', '/a', '50r/s', '300r/s'),
    row('GBNGWT03', 'x.conf', '/b'),
  ]);
  const a = rows[0].locations.find((l) => l.path === '/a');
  const b = rows[0].locations.find((l) => l.path === '/b');
  assert.equal(a.ipRateLimit, '50r/s');
  assert.equal(a.serverRateLimit, '300r/s');
  assert.equal(b.ipRateLimit, null, 'limitsiz yol null doner (bos string degil)');
});

test('dosya adı boş satırlar atlanır, çökme olmaz', () => {
  const { rows } = groupTestApis([
    row('GBNGWT03', '', '/bos'),
    row('GBNGWT03', 'gecerli.conf', '/g'),
  ]);
  assert.deepEqual(rows.map((r) => r.configFile), ['gecerli.conf']);
});

test('boş girdi çökmez', () => {
  assert.deepEqual(groupTestApis([]), { rows: [], hosts: [] });
  assert.deepEqual(groupTestApis(undefined), { rows: [], hosts: [] });
});

test('dosyalar ada göre sıralı döner (ekranda kararlı sıra)', () => {
  const { rows } = groupTestApis([
    row('GBNGWT03', 'zeta.conf', '/z'),
    row('GBNGWT03', 'alfa.conf', '/a'),
  ]);
  assert.deepEqual(rows.map((r) => r.configFile), ['alfa.conf', 'zeta.conf']);
});
