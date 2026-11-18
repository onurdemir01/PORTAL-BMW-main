// server/audit/__tests__/nginx-upstream-envanter.test.js
//
// Nginx Hub > Upstream Envanteri (2026-11-19) ozet mantigi. DB gerektirmez. Kilitlenen iddialar:
//   UE1 "bagli" = en az bir upstream'i kullaniliyor (location ya da stream); tanimli ama kullanilmayan
//       bagli SAYILMAZ; taranamayan sunucu "bagli degil" SAYILMAZ (olculmedi); bagli olan once
//   UE2 detay: upstream basina TUM server satirlari, kullanan server_name + location; atlayan
//       (dogrudan / degisken / unix / tanimsiz) location'lar hedefe gore; sahibi bilinmeyen (srv 0)
//       location'a ad uydurulmaz; kullanilan once
//   UE3 servers olculmedi (eski tarayici): liste YOK, eldeki SON server ayrica; kesik liste (+N)
//   UE4 ters arama: adres / upstream adi; kesik ya da olculmeyen listede SON server da aranir
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const ue = require('../nginx-upstream-envanter.cjs');

const env = (h) => (h.startsWith('GBNGXP') ? 'PROD' : 'TEST');

test('UE1 sunucu basina bagli / kullanilmayan / olculmedi', () => {
  const o = ue.upstreamOzeti(
    [
      { host: 'gbngxp01', status: 'ok' },
      { host: 'GBNGXT01', status: 'ok' },
      { host: 'GBNGXT02', status: 'fail' },
      { host: 'GBNGXT03', status: 'noinst' },
      { host: 'GBNGXT04', status: 'ok' },
      { host: 'GBNGXT05', status: 'fail' },
    ],
    [
      { host: 'GBNGXP01', n: 3, kullanilan: 2, resolve_yok: 1, keepalive_yok: 0 },
      { host: 'GBNGXT01', n: 2, kullanilan: 0, resolve_yok: 0, keepalive_yok: 2 },
      // stream proxy_pass: location yok ama upstream kullaniliyor -> bagli
      { host: 'GBNGXT04', n: 1, kullanilan: 1, resolve_yok: 0, keepalive_yok: 0 },
      // tarama fail ama kismi dokumde kullanim kaniti var -> bagli kalir
      { host: 'GBNGXT05', n: 1, kullanilan: 1, resolve_yok: 0, keepalive_yok: 0 },
    ],
    [
      { host: 'GBNGXP01', target_kind: 'upstream', n: 7 },
      { host: 'GBNGXP01', target_kind: 'fqdn', n: 2 },
      { host: 'GBNGXP01', target_kind: 'variable', n: 1 },
      { host: 'GBNGXT02', target_kind: 'undefined', n: 1 },
    ],
    env,
  );
  assert.deepEqual(
    o.hosts.map((h) => [h.host, h.ortam, h.bagli, h.olculmedi, h.upstream, h.kullanilmayan]),
    [
      ['GBNGXP01', 'PROD', true, false, 3, 1],
      ['GBNGXT04', 'TEST', true, false, 1, 0],
      ['GBNGXT05', 'TEST', true, false, 1, 0],
      ['GBNGXT01', 'TEST', false, false, 2, 2],
      ['GBNGXT02', 'TEST', false, true, 0, 0],
      ['GBNGXT03', 'TEST', false, true, 0, 0],
    ],
  );
  assert.equal(o.hosts[0].upstreamLocation, 7);
  assert.equal(o.hosts[0].degiskenLocation, 1);
  assert.deepEqual(o.totals, {
    hosts: 6,
    bagli: 3,
    bagliDegil: 1,
    olculmedi: 2,
    upstreamsiz: 0,
    upstream: 7,
    kullanilmayan: 3,
    dogrudanLocation: 2,
    degiskenLocation: 1,
    tanimsizLocation: 1,
  });
});

test('UE2 detay: tum serverlar, kullananlar, atlayanlar, sahibi bilinmeyen', () => {
  const d = ue.upstreamDetayi(
    [
      {
        conf_file: '/u/a.conf',
        name: 'bos',
        server: 'x:1',
        servers: 'x:1',
        resolve: 0,
        keepalive: 0,
        zone: 0,
        used: 0,
      },
      {
        conf_file: '/u/a.conf',
        name: 'app',
        server: 'b:443 backup',
        servers: 'a:443 resolve ; b:443 backup',
        resolve: 1,
        keepalive: 1,
        zone: 1,
        used: 1,
      },
    ],
    [
      {
        conf_file: '/c/s1.conf',
        srv_seq: 2,
        location: '/z',
        proxy_target: 'app',
        target_kind: 'upstream',
      },
      {
        conf_file: '/c/s1.conf',
        srv_seq: 1,
        location: '/a',
        proxy_target: 'app',
        target_kind: 'upstream',
      },
      {
        conf_file: '/c/snip.conf',
        srv_seq: 0,
        location: '/s',
        proxy_target: 'app',
        target_kind: 'upstream',
      },
      {
        conf_file: '/c/s1.conf',
        srv_seq: 1,
        location: '/d',
        proxy_target: 'db.example',
        target_kind: 'fqdn',
      },
      {
        conf_file: '/c/s1.conf',
        srv_seq: 1,
        location: '/v',
        proxy_target: '$be',
        target_kind: 'variable',
      },
      {
        conf_file: '/c/s1.conf',
        srv_seq: 9,
        location: '/t',
        proxy_target: 'yok',
        target_kind: 'undefined',
      },
      {
        conf_file: '/c/s1.conf',
        srv_seq: 1,
        location: '/n',
        proxy_target: '',
        target_kind: 'none',
      },
    ],
    [
      { seq: 1, server_name: 'bir.example', conf_file: '/c/s1.conf' },
      { seq: 2, server_name: 'iki.example', conf_file: '/c/s1.conf' },
    ],
    true,
  );
  assert.deepEqual(
    d.upstreams.map((u) => [u.ad, u.servers, u.serversKesik, u.sonServer, u.kullaniliyor]),
    [
      ['app', ['a:443 resolve', 'b:443 backup'], 0, null, true],
      ['bos', ['x:1'], 0, null, false],
    ],
  );
  assert.deepEqual(
    d.upstreams[0].kullananlar.map((k) => [k.serverName, k.location]),
    [
      [null, '/s'],
      ['bir.example', '/a'],
      ['iki.example', '/z'],
    ],
  );
  assert.deepEqual(
    d.dogrudan.map((x) => [x.hedef, x.tur, x.kullananlar.map((k) => k.serverName)]),
    [
      ['$be', 'variable', ['bir.example']],
      ['db.example', 'fqdn', ['bir.example']],
      ['yok', 'undefined', [null]],
    ],
  );
});

test('UE3 servers olculmedi: liste yok, son server ayri; kesik liste', () => {
  const d = ue.upstreamDetayi(
    [
      {
        conf_file: '/u',
        name: 'app',
        server: 'b:443',
        servers: null,
        resolve: 1,
        keepalive: 1,
        zone: 0,
        used: 1,
      },
      {
        conf_file: '/u',
        name: 'cok',
        server: 's9:1',
        servers: 's1:1 ; s2:1 ; +7',
        resolve: 0,
        keepalive: 0,
        zone: 0,
        used: 1,
      },
    ],
    [],
    [],
    true,
  );
  const app = d.upstreams.find((u) => u.ad === 'app');
  const cok = d.upstreams.find((u) => u.ad === 'cok');
  assert.equal(app.servers, null);
  assert.equal(app.sonServer, 'b:443');
  assert.deepEqual([cok.servers, cok.serversKesik, cok.sonServer], [['s1:1', 's2:1'], 7, null]);
  const eski = ue.upstreamDetayi(
    [{ conf_file: '/u', name: 'x', server: 'q:1', servers: 'q:1', used: 0 }],
    [],
    [],
    false,
  );
  assert.deepEqual([eski.upstreams[0].servers, eski.upstreams[0].sonServer], [null, 'q:1']);
  assert.equal(ue.serverListesi(null), null);
  assert.deepEqual(ue.serverListesi('a ; b'), { liste: ['a', 'b'], kesik: 0 });
  assert.deepEqual(ue.serverListesi('a ; +12'), { liste: ['a'], kesik: 12 });
  assert.equal(ue.adresOf('  a.example:443 resolve weight=2'), 'a.example:443');
  assert.deepEqual(ue.DOGRUDAN_TURLER, ['fqdn', 'variable', 'unix', 'undefined']);
});

test('UE4 ters arama', () => {
  const rows = [
    {
      host: 'gbngxp01',
      name: 'app',
      server: 'b.example:443',
      servers: 'a.example:443 resolve ; b.example:443',
      used: 1,
    },
    { host: 'GBNGXT01', name: 'A.EXAMPLE-UPS', server: 'c:1', servers: 'c:1', used: 0 },
    { host: 'GBNGXT02', name: 'diger', server: 'q:1', servers: 'q:1', used: 1 },
    // kesik liste: aranan SON satir listede yok ama `server` kolonunda var
    { host: 'GBNGXT03', name: 'havuz', server: 'z.example:443', servers: 'p:1 ; +40', used: 1 },
  ];
  const s = ue.aramaSonucu(rows, 'A.Example', true);
  assert.deepEqual(
    s.map((x) => [x.host, x.upstream, x.eslesen, x.adEsler, x.tamListe, x.kullaniliyor]),
    [
      ['GBNGXP01', 'app', ['a.example:443'], false, true, true],
      ['GBNGXT01', 'A.EXAMPLE-UPS', [], true, true, false],
    ],
  );
  assert.deepEqual(
    ue.aramaSonucu(rows, 'z.example', true).map((x) => [x.host, x.eslesen, x.tamListe]),
    [['GBNGXT03', ['z.example:443'], false]],
    'kesik listede son server da aranir, tam liste DEGIL denir',
  );
  const eski = ue.aramaSonucu(rows, 'a.example', false);
  assert.deepEqual(
    eski.map((x) => [x.host, x.eslesen, x.tamListe]),
    [['GBNGXT01', [], false]],
    'servers olculmediyse yalniz son server satirina bakilir',
  );
});
