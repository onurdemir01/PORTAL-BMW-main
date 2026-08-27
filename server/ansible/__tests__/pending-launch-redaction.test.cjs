// server/ansible/__tests__/pending-launch-redaction.test.cjs — onay bekleyen isin
// gizli alanlari API'den ve stdout'tan sizmasin.
//
// IKI AYRI SIZINTI (2026-08-28 incelemesi):
//
// A3) Smart bilet uclari `ticket.pendingLaunch.extraVars`i HAM donuyordu. Bu nesne,
//     sablonun `password`/`secret` isaretli alanlari dahil kullanicinin girdigi HER SEYI
//     tasiyor. Ayni veri GECMIS kaydina yazilirken zaten `redactExtraVarsForHistory` ile
//     temizleniyordu — yani redaksiyon fonksiyonu vardi, bu iki ucta cagrilmiyordu.
//
// A4) Tani amacli `console.log`lar render edilmis metadata'yi ve Smart istek govdesini
//     DEGERLERIYLE basiyordu. Portal loglari operasyon ekibinde genis okunur; sablon
//     alanina girilen parola duz metin olarak oraya dusuyordu. Uzunluk/doluluk bilgisi
//     tani icin yeterli — deger gerekmiyor.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RUNNER = fs.readFileSync(path.join(__dirname, '..', 'runner.cjs'), 'utf8');
const SMART = fs.readFileSync(path.join(__dirname, '..', '..', 'smart', 'client.cjs'), 'utf8');

test('A3: pendingLaunch.extraVars HAM donmuyor', () => {
  assert.ok(
    !/extraVars:\s*ticket\.pendingLaunch\?\.extraVars\s*\|\|\s*\{\}/.test(RUNNER),
    'ham extraVars hala donuluyor — sablonun password alanlari API yanitinda'
  );
});

test('A3: her iki bilet ucunda da redaksiyon var', () => {
  // Iki farkli uc, iki farkli degisken adi kullaniyor (`ticket` ve liste dongusunde `t`).
  const hits = RUNNER.match(/redactExtraVarsForHistory\(\s*\n\s*\w+\.pendingLaunch\?\.extraVars/g) || [];
  assert.equal(hits.length, 2, `iki ucta da redaksiyon bekleniyordu, bulunan: ${hits.length}`);
});

test('A3: redaksiyona specFields de gecirilir (hangi alan gizli ondan bilinir)', () => {
  // specFields olmadan fonksiyon hangi alanin `password` tipinde oldugunu BILEMEZ ve
  // sessizce hicbir seyi maskelemez — sessiz bir gecis olurdu.
  assert.match(RUNNER, /\w+\.pendingLaunch\?\.specFields,/);
});

test('A4: metadata log’u degerleri degil doluluk/uzunlugu basar', () => {
  assert.match(RUNNER, /const metadataShape = /);
  assert.match(RUNNER, /`<dolu:\$\{String\(v\)\.length\}>`/);
  assert.ok(
    !/console\.log\([^)]*JSON\.stringify\(metadata\)/.test(RUNNER),
    'ham metadata hala stdout’a basiliyor'
  );
});

test('A4: Smart govde log’u deger tasimaz', () => {
  assert.match(SMART, /value: String\(m\.value \?\? ''\)\.length > 0 \? `<dolu:\$\{String\(m\.value\)\.length\}>` : '<bos>'/);
  assert.ok(
    !/JSON\.stringify\(body\.metadataData\)/.test(SMART),
    'ham Smart govdesi hala loglaniyor'
  );
});
