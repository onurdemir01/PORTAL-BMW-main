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
// ── BICIM DUYARSIZ OKUMA ────────────────────────────────────────────────────
// Bu bekciler bir KURALI kilitler ("su cagri su argumanlarla yapiliyor"), satir
// duzenini degil. Depoya prettier girdiginde cagrilar cok satira yayildi ve tirnak
// bicimi degisti; kural aynen dururken bekciler KIRMIZI oldu.
//
// `norm()` yalnizca iki seyi normalize eder: ardisik bosluklari tek boslugua indirir
// ve tek tirnagi cift tirnaga cevirir. ANLAM tasiyan hicbir sey silinmez — yanlis
// argumanla yapilan bir cagri hala yakalanir (mutasyonla dogrulandi).
const norm = (s) => s.replace(/\s+/g, ' ').replace(/'/g, '"');

test('Openshift dalinda restrictions.isAllowed cagriliyor', () => {
  // `norm()` tek tirnagi cift tirnaga cevirir; desen de oyle yazilir.
  assert.match(
    norm(SRC),
    /\.isAllowed\( ?"ocp_namespace", ?resourceKey, ?user,? ?\)/,
    'namespace yetki kapisi yok — kisitli namespace Telnet ile erisilebilir',
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
    "isAllowed patladiginda true'ya dusen bir varsayilan kapiyi ise yaramaz hale getirir",
  );
  assert.match(SRC, /res\.status\(403\)/, 'reddedilen istek 403 donmeli');
});

test('kapi, AWX job tetiklenmeden ONCE gelir', () => {
  // SIRA korunur: `norm()` yalnizca bosluk/tirnak esitler, satirlari yeniden
  // siralamaz — indeks karsilastirmasi anlamli kalir.
  const N = norm(SRC);
  const gateIdx = N.search(/\.isAllowed\( ?"ocp_namespace"/);
  const launchIdx = N.search(/launchJobTemplate|launchJobOnServer|runner\.launch|awx\.launch/);
  assert.ok(gateIdx > 0, 'kapi bulunamadi');
  assert.ok(launchIdx > 0, 'AWX tetikleme cagrisi bulunamadi — test guncellenmeli');
  assert.ok(
    gateIdx < launchIdx,
    'yetki kontrolu AWX tetiklemesinden SONRA — is zaten baslamis olur',
  );
});

test('grubun TUM cluster’lari taranir (tek kisitlama tum istegi kapatir)', () => {
  // OpsX ile ayni fail-safe ilke: bir namespace gruptaki herhangi bir cluster icin
  // kisitliysa, kullanici hangi cluster’i sectiginden bagimsiz olarak reddedilir.
  assert.match(norm(SRC), /for \( ?const clusterName of groupClusters ?\)/);
});
