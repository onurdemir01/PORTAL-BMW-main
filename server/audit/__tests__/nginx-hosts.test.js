// server/audit/__tests__/nginx-hosts.test.js
//
// nginx sunucu adindan ORTAM ve AG KATMANI turetme. DB gerektirmez.
//
// Iki tuzak burada kilitleniyor:
//
// 1) ORNGXT51 - ad kalibi YANILTIR. 'T' harfi test der ama ortami EDU'dur. Sessizce
//    TEST saymak, edu uygulamalarini test rakamlarina karistirirdi; bu yuzden ACIK bir
//    istisna tutuluyor.
//
// 2) KATMAN KALIPLA TURETILEMEZ. ORNGXT50 intranet, ORNGXT34 internet - ikisi de
//    "ORNGXT" ile basliyor. Kalip uydurmak yerine ACIK LISTE kullaniliyor; listede
//    olmayan her host internete acik SAYILIR (yeni bir intranet sunucusu eklenirse
//    listeye yazilmali).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { envOfHost, tierOfHost, siteOfHost, orderEnvs } = require('../nginx-hosts.cjs');

test('ORNGXT51 EDU"dur - ad kalibi yaniltir, istisna ACIK tutulur', () => {
  assert.equal(envOfHost('ORNGXT51'), 'EDU');
  assert.equal(envOfHost('orngxt51'), 'EDU', 'kucuk harf de taninir');
  // Komsusu ise gercekten test:
  assert.equal(envOfHost('ORNGXT50'), 'TEST');
});

test('intranet SPA sunuculari dogru ortama duser', () => {
  assert.equal(envOfHost('ORNGXD50'), 'DEV');
  assert.equal(envOfHost('ORNGXQ50'), 'QA');
  for (const h of ['ORNGXP50', 'ORNGXP51', 'ORNGXP52', 'ORNGXP53']) {
    assert.equal(envOfHost(h), 'PROD', h);
  }
  for (const h of ['ORNGXAP50', 'ORNGXAP51']) {
    assert.equal(envOfHost(h), 'PROD', h);
    assert.equal(siteOfHost(h), 'Ankara', h + ' AP -> Ankara');
  }
});

test('KATMAN: on 10 sunucu intranet, digerleri internet', () => {
  const intranet = [
    'ORNGXD50',
    'ORNGXT50',
    'ORNGXT51',
    'ORNGXQ50',
    'ORNGXP50',
    'ORNGXP51',
    'ORNGXP52',
    'ORNGXP53',
    'ORNGXAP50',
    'ORNGXAP51',
  ];
  for (const h of intranet) assert.equal(tierOfHost(h), 'intranet', h);
});

test('KATMAN KALIPLA TURETILEMEZ - ayni onek iki katmanda', () => {
  // Asil risk bu: birisi "ORNGXT ile baslayan intranet" gibi bir kural yazarsa
  // ORNGXT34 yanlis siniflanir ve internet kapsami bozulur.
  assert.equal(tierOfHost('ORNGXT50'), 'intranet');
  assert.equal(tierOfHost('ORNGXT34'), 'internet');
  assert.equal(tierOfHost('ORNGXD50'), 'intranet');
  assert.equal(tierOfHost('ORNGXD01'), 'internet');
});

test('listede OLMAYAN host internete acik SAYILIR (varsayilan guvenli taraf)', () => {
  assert.equal(tierOfHost('ORRVPP07'), 'internet');
  assert.equal(tierOfHost('ORNGWT03'), 'internet');
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
