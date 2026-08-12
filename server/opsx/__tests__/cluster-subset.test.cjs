// server/opsx/__tests__/cluster-subset.test.cjs — cluster alt kumesi dogrulamasi.
//
// NEDEN VAR (2026-08-12): bir tenant/env grubuna birden fazla GERCEK cluster bagli olabilir
// (ör. ark_prod → gbocpprod1, gbocpprod2, gbocpprod4). Kullanici artik yalnizca bir kismini
// hedefleyebiliyor; bu secim AWX `limit`ine (restart) ya da `ocp_clusters[]` fan-out'una
// (pod kesfi) donusuyor.
//
// GUVENLIK: secim CLIENT'tan gelir. Grup disinda bir isim `limit`e ya da fan-out'a sizarsa
// kullanici yetkisi olmayan bir cluster'da is tetikleyebilirdi. Bu yuzden liste, sunucunun
// DB'den AZ ONCE cozdugu gercek listeye karsi yeniden dogrulanir (anti-TOCTOU).
//
// GERIYE UYUM: bos/gonderilmemis liste = KISITLAMA YOK. Eski onyuz yeni sunucuyla aynen
// calisir; "calisan yapiyi bozma" kuralinin somut testi budur.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickClusterSubset } = require('../index.cjs');

const GROUP = ['gbocpprod1', 'gbocpprod2', 'gbocpprod4'];

test('gonderilmemis/bos liste → TUM cluster\'lar (bugunku davranis korunur)', () => {
  assert.deepEqual(pickClusterSubset(undefined, GROUP), GROUP);
  assert.deepEqual(pickClusterSubset([], GROUP), GROUP);
  assert.deepEqual(pickClusterSubset(null, GROUP), GROUP);
  // Yalnizca bosluk iceren girdiler de "secim yok" sayilir.
  assert.deepEqual(pickClusterSubset(['', '  '], GROUP), GROUP);
});

test('gecerli alt kume kirpilir ve tekillestirilir', () => {
  assert.deepEqual(pickClusterSubset([' gbocpprod2 ', 'gbocpprod2'], GROUP), ['gbocpprod2']);
});

test('GRUP DISINDA bir isim 400 ile REDDEDILIR (anti-TOCTOU)', () => {
  assert.throws(
    () => pickClusterSubset(['gbocpprod2', 'baska-tenantin-clusteri'], GROUP),
    (err) => err.status === 400 && /Geçersiz cluster: baska-tenantin-clusteri/.test(err.message)
  );
});

test('tum grup acikca secilirse de gecerlidir (kisitlama uygulanmaz)', () => {
  // Cagiran taraf "hepsi secili" durumunda `limit` gondermez; burada dogrulanan sey
  // listenin AYNEN geri donmesi.
  assert.deepEqual(pickClusterSubset([...GROUP], GROUP), GROUP);
});
