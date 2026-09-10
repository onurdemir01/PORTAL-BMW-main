// server/audit/__tests__/nginx-hosts.test.cjs
//
// nginx sunucu adindan ORTAM ve AG KATMANI turetme. DB gerektirmez.
//
// Iki tuzak burada kilitleniyor:
//
// 1) GBNGXT51 - ad kalibi YANILTIR. 'T' harfi test der ama ortami EDU'dur. Sessizce
//    TEST saymak, edu uygulamalarini test rakamlarina karistirirdi; bu yuzden ACIK bir
//    istisna tutuluyor.
//
// 2) KATMAN KALIPLA TURETILEMEZ. GBNGXT50 intranet, GBNGXT34 internet - ikisi de
//    "GBNGXT" ile basliyor. Kalip uydurmak yerine ACIK LISTE kullaniliyor; listede
//    olmayan her host internete acik SAYILIR (yeni bir intranet sunucusu eklenirse
//    listeye yazilmali).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { envOfHost, tierOfHost, siteOfHost, orderEnvs } = require('../nginx-hosts.cjs');

test('GBNGXT51 EDU"dur - ad kalibi yaniltir, istisna ACIK tutulur', () => {
  assert.equal(envOfHost('GBNGXT51'), 'EDU');
  assert.equal(envOfHost('gbngxt51'), 'EDU', 'kucuk harf de taninir');
  // Komsusu ise gercekten test:
  assert.equal(envOfHost('GBNGXT50'), 'TEST');
});

test('intranet SPA sunuculari dogru ortama duser', () => {
  assert.equal(envOfHost('GBNGXD50'), 'DEV');
  assert.equal(envOfHost('GBNGXQ50'), 'QA');
  for (const h of ['GBNGXP50', 'GBNGXP51', 'GBNGXP52', 'GBNGXP53']) {
    assert.equal(envOfHost(h), 'PROD', h);
  }
  for (const h of ['GBNGXAP50', 'GBNGXAP51']) {
    assert.equal(envOfHost(h), 'PROD', h);
    assert.equal(siteOfHost(h), 'Ankara', h + ' AP -> Ankara');
  }
});

test('KATMAN: on 10 sunucu intranet, digerleri internet', () => {
  const intranet = [
    'GBNGXD50', 'GBNGXT50', 'GBNGXT51', 'GBNGXQ50',
    'GBNGXP50', 'GBNGXP51', 'GBNGXP52', 'GBNGXP53', 'GBNGXAP50', 'GBNGXAP51',
  ];
  for (const h of intranet) assert.equal(tierOfHost(h), 'intranet', h);
});

test('KATMAN KALIPLA TURETILEMEZ - ayni onek iki katmanda', () => {
  // Asil risk bu: birisi "GBNGXT ile baslayan intranet" gibi bir kural yazarsa
  // GBNGXT34 yanlis siniflanir ve internet kapsami bozulur.
  assert.equal(tierOfHost('GBNGXT50'), 'intranet');
  assert.equal(tierOfHost('GBNGXT34'), 'internet');
  assert.equal(tierOfHost('GBNGXD50'), 'intranet');
  assert.equal(tierOfHost('GBNGXD01'), 'internet');
});

test('listede OLMAYAN host internete acik SAYILIR (varsayilan guvenli taraf)', () => {
  assert.equal(tierOfHost('GBRVPP07'), 'internet');
  assert.equal(tierOfHost('GBNGWT03'), 'internet');
  assert.equal(tierOfHost('bilinmeyen'), 'internet');
  assert.equal(tierOfHost(''), 'internet');
});

test('EDU ortam siralamasinda TEST ile QA arasinda', () => {
  const seen = new Set(['PROD', 'EDU', 'DEV', 'TEST', 'QA']);
  assert.deepEqual(orderEnvs(seen), ['DEV', 'TEST', 'EDU', 'QA', 'PROD']);
});

test('taninmayan sunucu SESSIZCE bir ortama atanmaz', () => {
  assert.equal(envOfHost('kimbilir'), 'BILINMIYOR');
  assert.equal(envOfHost(''), 'BILINMIYOR');
  assert.equal(envOfHost(null), 'BILINMIYOR');
});
