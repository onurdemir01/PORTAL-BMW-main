// server/telnet/__tests__/namespace-restrictions.test.cjs — Telnet Openshift dalinda
// namespace YETKI kapisi.
//
// ACIK (2026-08-28 incelemesi): Openshift dalinda namespace icin YAPILAN TEK dogrulama
// "bos degil + ',' veya ';' icermiyor"du. `restrictions.isAllowed` bu dosyada HIC
// gecmiyordu. Oysa ayni namespace kataloglari LogX v2 > Erisim Kisitlamalari ile
// kisitlanabiliyor ve OpsX (server/opsx/index.cjs) ile LogX bu kapiyi uyguluyor.
// Sonuc: kullanici arayuzde HIC gormedigi bir namespace adini govdeye elle yazip
// Telnet ile o namespace'te gecici pod acabiliyordu — kisitlamanin etrafindan dolasma.
//
// Bu test kapinin (a) var oldugunu, (b) AWX tetiklenmeden ONCE calistigini,
// (c) fail-safe oldugunu (kontrol patlarsa REDDET) kilitler.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');

test('Openshift dalinda restrictions.isAllowed cagriliyor', () => {
  assert.match(
    SRC,
    /restrictions\.isAllowed\('ocp_namespace', resourceKey, user\)/,
    'namespace yetki kapisi yok — kisitli namespace Telnet ile erisilebilir'
  );
});

test('resourceKey OpsX/LogX ile AYNI bicimde uretilir', () => {
  // Bicim uyusmazsa kisitlama kaydi hic eslesmez ve kapi sessizce her seyi gecirir.
  assert.match(SRC, /`\$\{tenantKey\}\/\$\{envKey\}\/\$\{clusterName\}\/\$\{ns\}`/);
});

test('kontrol fail-safe: hata REDDE dusurur, gecirmez', () => {
  assert.match(
    SRC,
    /\.catch\(\(\) => false\)/,
    'isAllowed patladiginda true\'ya dusen bir varsayilan kapiyi ise yaramaz hale getirir'
  );
  assert.match(SRC, /res\.status\(403\)/, 'reddedilen istek 403 donmeli');
});

test('kapi, AWX job tetiklenmeden ONCE gelir', () => {
  const gateIdx = SRC.indexOf("restrictions.isAllowed('ocp_namespace'");
  const launchIdx = SRC.search(/launchJobTemplate|runner\.launch|awx\.launch/);
  assert.ok(gateIdx > 0, 'kapi bulunamadi');
  assert.ok(launchIdx > 0, 'AWX tetikleme cagrisi bulunamadi — test guncellenmeli');
  assert.ok(gateIdx < launchIdx, 'yetki kontrolu AWX tetiklemesinden SONRA — is zaten baslamis olur');
});

test('grubun TUM cluster’lari taranir (tek kisitlama tum istegi kapatir)', () => {
  // OpsX ile ayni fail-safe ilke: bir namespace gruptaki herhangi bir cluster icin
  // kisitliysa, kullanici hangi cluster’i sectiginden bagimsiz olarak reddedilir.
  assert.match(SRC, /for \(const clusterName of groupClusters\)/);
});
