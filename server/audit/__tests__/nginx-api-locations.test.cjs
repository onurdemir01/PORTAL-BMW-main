// server/audit/__tests__/nginx-api-locations.test.cjs
//
// "Nginx API Envanteri > API Bazli" gorunumunun ozet mantigi. DB gerektirmez.
//
// Bu gorunumun degeri sayi saymak degil, FARKI ayirt etmek: ayni API yolunun
//   * AYNI ortamdaki sunucular arasinda farkli limit tasimasi  -> genelde HATA
//   * ORTAMLAR arasi farkli limit tasimasi                     -> kasitli olabilir
// ikisi ayni bayrakla gosterilseydi gercek hata gurultu icinde kaybolurdu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeLocations } = require('../nginx-api-locations.cjs');

const row = (host, config_file, api_location, ip = null, srv = null) => ({
  host, config_file, api_location, ip_rate_limit: ip, server_rate_limit: srv,
});

test('her yol icin ortam -> sunucu kirilimi', () => {
  const { rows, envs } = summarizeLocations([
    row('GBNGWT03', 'x.conf', '/a'),
    row('GBNGWT04', 'x.conf', '/a'),
    row('GBNGWP01', 'x.conf', '/a'),
  ]);
  assert.deepEqual(envs, ['TEST', 'PROD']);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].envs.TEST.hosts, ['GBNGWT03', 'GBNGWT04']);
  assert.deepEqual(rows[0].envs.PROD.hosts, ['GBNGWP01']);
  assert.equal(rows[0].totalHosts, 3);
});

test('bir ortamda hic yoksa EKSIK olarak isaretlenir', () => {
  const { rows } = summarizeLocations([
    row('GBNGWT03', 'x.conf', '/a'),
    row('GBNGWP01', 'x.conf', '/b'),
  ]);
  const a = rows.find((r) => r.location === '/a');
  const b = rows.find((r) => r.location === '/b');
  assert.deepEqual(a.missingEnvs, ['PROD']);
  assert.deepEqual(b.missingEnvs, ['TEST']);
});

test('SUNUCU farki: ayni ortamda farkli limit -> limitDrift', () => {
  const { rows } = summarizeLocations([
    row('GBNGWP01', 'x.conf', '/a', '300r/s'),
    row('GBNGWP02', 'x.conf', '/a', '250r/s'),
  ]);
  assert.equal(rows[0].limitDrift, true);
  assert.deepEqual(rows[0].envs.PROD.ipRateLimits, ['250r/s', '300r/s'], 'ikisi de tasinir');
  assert.equal(rows[0].envLimitDrift, false, 'tek ortam var, ortamlar arasi fark yok');
});

test('ORTAM farki: ortamlar arasi farkli limit -> envLimitDrift', () => {
  const { rows } = summarizeLocations([
    row('GBNGWT03', 'x.conf', '/a', '50r/s'),
    row('GBNGWP01', 'x.conf', '/a', '300r/s'),
  ]);
  assert.equal(rows[0].envLimitDrift, true);
  assert.equal(rows[0].limitDrift, false, 'her ortamda tek deger - ic fark yok');
});

test('tutarli dagitimda HICBIR bayrak yanmaz', () => {
  const { rows } = summarizeLocations([
    row('GBNGWT03', 'x.conf', '/a', '50r/s'),
    row('GBNGWT04', 'x.conf', '/a', '50r/s'),
    row('GBNGWP01', 'x.conf', '/a', '50r/s'),
  ]);
  assert.equal(rows[0].limitDrift, false);
  assert.equal(rows[0].envLimitDrift, false);
  assert.deepEqual(rows[0].missingEnvs, []);
});

test('limitsiz yollar bayrak URETMEZ (bos kume fark sayilmaz)', () => {
  const { rows } = summarizeLocations([
    row('GBNGWT03', 'x.conf', '/a'),
    row('GBNGWP01', 'x.conf', '/a'),
  ]);
  assert.equal(rows[0].limitDrift, false);
  assert.equal(rows[0].envLimitDrift, false);
  assert.deepEqual(rows[0].envs.TEST.ipRateLimits, []);
});

test('BILINMIYOR ortam karsilastirmaya KATILMAZ ve eksik saydirmaz', () => {
  const { rows, envs } = summarizeLocations([
    row('GBNGWT03', 'x.conf', '/a', '50r/s'),
    row('tanimsiz', 'x.conf', '/a', '999r/s'),
  ]);
  assert.ok(envs.includes('BILINMIYOR'), 'gizlenmez');
  assert.ok(!rows[0].missingEnvs.includes('BILINMIYOR'));
  assert.equal(rows[0].envLimitDrift, false, 'BILINMIYOR ortam farki URETMEZ');
});

test('ayni yol FARKLI dosyalarda ayri satirdir', () => {
  const { rows } = summarizeLocations([
    row('GBNGWT03', 'a.conf', '/ortak'),
    row('GBNGWT03', 'b.conf', '/ortak'),
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.config), ['a.conf', 'b.conf'], 'dosya adina gore sirali');
});

test('bos/eksik alanlar atlanir, cokme olmaz', () => {
  const { rows } = summarizeLocations([
    row('GBNGWT03', '', '/yok'),
    row('GBNGWT03', 'x.conf', ''),
    row('GBNGWT03', 'x.conf', '/var'),
  ]);
  assert.deepEqual(rows.map((r) => r.location), ['/var']);
  assert.deepEqual(summarizeLocations([]).rows, []);
  assert.deepEqual(summarizeLocations(undefined).rows, []);
});
