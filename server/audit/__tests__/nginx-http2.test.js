// server/audit/__tests__/nginx-http2.test.js
//
// Nginx Envanteri > HTTP/2 (2026-11-18) ozet mantigi (dbo.Nginx_Audit_Servers.http2 / http2_source).
// DB gerektirmez. Kilitlenen iddialar:
//   H1 sunucu basina acik / kapali / olculmedi ve kaynak sayimi; acik olan once
//   H2 http2 NULL "olculmedi"dir, kapali SAYILMAZ (kanitsiz kapali demek acik sunucuyu temiz gosterirdi)
//   H3 bilinmeyen kaynak degeri sayilmaz ama blok acik sayilir; BIT '1'/'0' ve true/false ayni
//   H4 bloklar: acik -> olculmedi -> kapali -> HTTP degil, sonra dosya + sira; kapali blokta kaynak yok
//   H5 stream / mail bloklari HTTP degil: kapali SAYILMAZ, ayri sayilir; 'default' kaynagi (h2c)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  http2Ozeti,
  http2Satirlari,
  h2Degeri,
  KAYNAKLAR,
  HTTP_DISI,
} = require('../nginx-http2.cjs');

test('H1 sunucu basina sayim, kaynaklar, siralama', () => {
  const o = http2Ozeti([
    { host: 'gbngxp01', http2: 1, http2_source: 'server', n: 40 },
    { host: 'GBNGXP01', http2: 1, http2_source: 'socket', n: 2 },
    { host: 'GBNGXP01', http2: 0, http2_source: null, n: 3 },
    { host: 'GBNGXT01', http2: 1, http2_source: 'listen', n: 5 },
    { host: 'GBNGXT01', http2: 1, http2_source: 'http', n: 1 },
    { host: 'GBNGXA01', http2: 0, http2_source: null, n: 7 },
  ]);
  assert.deepEqual(
    o.hosts.map((h) => h.host),
    ['GBNGXP01', 'GBNGXT01', 'GBNGXA01'],
  );
  const p = o.hosts[0];
  assert.deepEqual([p.toplam, p.acik, p.kapali, p.olculmedi], [45, 42, 3, 0]);
  assert.deepEqual(p.kaynak, { server: 40, listen: 0, http: 0, socket: 2, default: 0 });
  assert.deepEqual(o.totals, {
    hosts: 3,
    hostsAcik: 2,
    hostsOlculmedi: 0,
    bloklar: 58,
    acik: 48,
    kapali: 10,
    olculmedi: 0,
    httpDisi: 0,
    kaynak: { server: 40, listen: 5, http: 1, socket: 2, default: 0 },
  });
  assert.deepEqual(KAYNAKLAR, ['server', 'listen', 'http', 'socket', 'default']);
  assert.deepEqual(HTTP_DISI, ['stream', 'mail']);
});

test('H2 NULL olculmedi; kapali sayilmaz', () => {
  const o = http2Ozeti([
    { host: 'H1', http2: null, http2_source: null, n: 4 },
    { host: 'H1', http2: 0, http2_source: null, n: 1 },
  ]);
  assert.equal(o.hosts[0].olculmedi, 4);
  assert.equal(o.hosts[0].kapali, 1);
  assert.equal(o.totals.hostsOlculmedi, 1);
  assert.equal(o.totals.hostsAcik, 0);
  assert.equal(h2Degeri(undefined), null);
  assert.equal(h2Degeri('x'), null);
});

test('H3 BIT bicimleri; bilinmeyen kaynak', () => {
  for (const v of [true, 1, '1']) assert.equal(h2Degeri(v), true);
  for (const v of [false, 0, '0']) assert.equal(h2Degeri(v), false);
  const o = http2Ozeti([
    { host: 'H', http2: true, http2_source: 'baska', n: 2 },
    { host: '', http2: true, http2_source: 'server', n: 9 },
  ]);
  assert.equal(o.hosts.length, 1, 'adsiz satir atlanir');
  assert.equal(o.hosts[0].acik, 2);
  assert.deepEqual(Object.values(o.hosts[0].kaynak), [0, 0, 0, 0, 0]);
});

test('H4 blok satirlari: siralama ve kaynak yalniz acikta', () => {
  const s = http2Satirlari([
    {
      conf_file: '/usr/nginx/conf.d/b.conf',
      seq: 3,
      listen: '443 ssl',
      server_name: 'b',
      ssl: 1,
      http2: 0,
      http2_source: 'server',
    },
    {
      conf_file: '/usr/nginx/conf.d/a.conf',
      seq: 2,
      listen: null,
      server_name: null,
      ssl: 0,
      http2: null,
      http2_source: null,
    },
    {
      conf_file: '/usr/nginx/conf.d/c.conf',
      seq: 5,
      listen: '127.0.0.1:443 ssl',
      server_name: 'c',
      ssl: true,
      http2: 1,
      http2_source: 'server',
    },
    {
      conf_file: '/usr/nginx/conf.d/c.conf',
      seq: 4,
      listen: '10.0.0.1:443 ssl http2',
      server_name: 'c0',
      ssl: '1',
      http2: '1',
      http2_source: 'listen',
    },
  ]);
  assert.deepEqual(
    s.map((x) => [x.seq, x.http2, x.kaynak]),
    [
      [4, true, 'listen'],
      [5, true, 'server'],
      [2, null, null],
      [3, false, null],
    ],
  );
  assert.equal(s[0].ssl, true);
  assert.equal(s[2].ssl, false);
  assert.equal(s[2].listen, null);
  assert.equal(s[0].confFile, '/usr/nginx/conf.d/c.conf');
});

test('H5 stream / mail HTTP degil; default kaynagi', () => {
  const o = http2Ozeti([
    { host: 'H', http2: 0, http2_source: 'stream', n: 2 },
    { host: 'H', http2: 0, http2_source: 'mail', n: 1 },
    { host: 'H', http2: 0, http2_source: null, n: 4 },
    { host: 'H', http2: 1, http2_source: 'default', n: 3 },
    { host: 'H', http2: 1, http2_source: 'stream', n: 1 },
  ]);
  const h = o.hosts[0];
  assert.deepEqual([h.toplam, h.acik, h.kapali, h.httpDisi, h.olculmedi], [11, 4, 4, 3, 0]);
  assert.equal(h.kaynak.default, 3);
  assert.equal(o.totals.httpDisi, 3);
  const s = http2Satirlari([
    { conf_file: '/a.conf', seq: 1, http2: 0, http2_source: 'stream' },
    { conf_file: '/b.conf', seq: 2, http2: 0, http2_source: null },
    { conf_file: '/c.conf', seq: 3, http2: 1, http2_source: 'default' },
  ]);
  assert.deepEqual(
    s.map((x) => [x.seq, x.kaynak, x.httpDisi]),
    [
      [3, 'default', null],
      [2, null, null],
      [1, null, 'stream'],
    ],
  );
});
