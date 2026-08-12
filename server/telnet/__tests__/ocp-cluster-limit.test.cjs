// server/telnet/__tests__/ocp-cluster-limit.test.cjs — Telnet OCP cluster kisitlamasi.
//
// NEDEN KAYNAK SOZLESMESI TESTI: bu dogrulama route handler'inin icinde duruyor ve HTTP
// katmani olmadan cagrilamiyor. Kilitlenmek istenen sey davranisin KENDISI degil, kolayca
// geri alinabilecek UC BAGLANTI:
//
//   1) OCP dalinda launchJobOnServer'a `clusterLimit` gecilir — eskiden sabit `''` idi ve
//      is her zaman `{{ cluster }}_{{ env }}` grubunun TAMAMINA gidiyordu.
//   2) Client'in gonderdigi cluster adlari, DB'den okunan gruba karsi dogrulanir; grup
//      disinda bir ad 400 ile reddedilir (anti-TOCTOU) — aksi halde kullanici yetkisi
//      olmayan bir cluster'da telnet testi tetikleyebilirdi.
//   3) Bos/gonderilmemis liste `limit`i BOS birakir (bugunku davranis korunur).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');

test('OCP dalinda AWX limit alanina clusterLimit gecilir (sabit boş string DEGIL)', () => {
  assert.match(
    SRC,
    /launchJobOnServer\(serverId, templateId, extraVars, clusterLimit\)/,
    'cluster secimi limit olarak gonderilmiyor — is yine tum gruba gider'
  );
  assert.ok(
    !/namespace: ns[\s\S]{0,400}launchJobOnServer\(serverId, templateId, extraVars, ''\)/.test(SRC),
    "OCP dalinda sabit '' limit geri gelmis"
  );
});

test('grup disindaki cluster adi 400 ile reddedilir', () => {
  assert.match(SRC, /const unknown = wanted\.filter\(\(c\) => !groupClusters\.includes\(c\)\)/);
  assert.match(SRC, /Geçersiz cluster: \$\{unknown\.join\(', '\)\}/);
});

test('bos/gonderilmemis secim limit uretmez (geriye uyum)', () => {
  // `clusters` yoksa `if (Array.isArray(clusters) && clusters.length > 0)` govdesine hic
  // girilmez; clusterLimit '' kalir.
  assert.match(SRC, /let clusterLimit = '';/);
  assert.match(SRC, /if \(Array\.isArray\(clusters\) && clusters\.length > 0\)/);
  // Tumu seciliyse de kisitlama uygulanmaz.
  assert.match(SRC, /wanted\.length < groupClusters\.length\) clusterLimit = wanted\.join\(','\)/);
});
