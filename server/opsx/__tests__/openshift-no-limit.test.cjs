// server/opsx/__tests__/openshift-no-limit.test.cjs — Openshift dalinin AWX sozlesmesi.
//
// IKI KURALI KILITLER:
//
// 1) `limit` GONDERILMEZ. Cluster alt kumesi denendi ve kaldirildi (2026-08-12): secilen
//    adlar AWX'in `limit` alanina konuluyordu ama AWX, template'te Limit icin "Prompt on
//    launch" KAPALI oldugu icin alani SESSIZCE yok sayiyordu — portal
//    `limit: "gbocpankqa2"` gonderdi, is yine ark_qa'nin DORT host'unda kostu (job 3217901).
//    Ayrica dogru kisit zaten cluster ADI degil, o cluster'larin jump server'i olurdu.
//    Ozelligi "belki calisir" umuduyla geri koymaya karsi bekci.
//
// 2) `email` GONDERILIR. Harici application_rollout playbook'u son adimda `{{ email }}` ile
//    bilgilendirme maili atiyor; degisken gelmeyince job "'email' is undefined" ile
//    DUSUYORDU — hem de rollout ZATEN yapildiktan sonra (job 3218675). Adres, isi
//    tetikleyen kullanicinin LDAP kaydindan gelir; yonetici OpsX yapilandirmasinda
//    kendi `email`ini tanimladiysa ona dokunulmaz.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const OPSX = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const TELNET = fs.readFileSync(path.join(__dirname, '..', '..', 'telnet', 'index.cjs'), 'utf8');

test('Openshift dalinda AWX limit hesabi YOK', () => {
  // Legacy dali limit'i mesru olarak kullanir (o template'te kutu ACIK) — yasak olan,
  // Openshift dalinda limit uretmek.
  assert.ok(!/ocClusters/.test(OPSX), 'ocClusters geri gelmis — AWX bu limiti yutuyor');
  assert.ok(!/ocClusterLimit/.test(OPSX), 'Openshift dalinda limit hesabi geri gelmis');
});

test('extra_vars\'a email eklenir; admin tanimi ONCELIKLIDIR', () => {
  assert.match(OPSX, /const runnerEmail = String\(req\.session\?\.user\?\.mail \|\| ''\)\.trim\(\);/);
  // Admin `email` yazdiysa uzerine YAZILMAZ.
  assert.match(OPSX, /\.\.\.\(staticVars\.email \? \{\} : \{ email: runnerEmail \}\)/);
});

test('adres yoksa is HIC baslatilmaz (bos email = kesin hata)', () => {
  assert.match(OPSX, /if \(!staticVars\.email && !runnerEmail\)/);
  assert.match(OPSX, /E-posta adresiniz profilinizde bulunamadı/);
});

test('Telnet OCP: telnet hedefi IKI adla birden gonderilir (geriye uyum)', () => {
  // Playbook `target_host`/`target_port` okuyor, portal `ip`/`port` gonderiyordu; uc host da
  // "'target_host' is undefined" ile dustu (job 3218662). Iki ad da gonderilir ki playbook
  // hangi surumde olursa olsun calissin.
  assert.match(TELNET, /target_host: ipTrim/);
  assert.match(TELNET, /target_port: portTrim/);
  assert.match(TELNET, /ip: ipTrim/, 'eski alan adlari da KALMALI');
  assert.match(TELNET, /port: portTrim/);
});

test('Telnet OCP: LOGX MODELI — jump server\'lar ve cluster kayitlari gonderilir', () => {
  // 2026-08-12 kullanici karari: hedef host'lar JUMP SERVER'lardir, cluster'lar VERI olarak
  // gider. Eski modelde cluster -> jump server eslemesi AWX envanterinin ICINDE gizliydi ve
  // portalin `ocp_cluster_index.terminal_host` kaydi hic kullanilmiyordu.
  assert.match(TELNET, /adminData\.resolveTerminalHosts\(envKey, tenantKey, clusterNames\)/);
  assert.match(TELNET, /resolveClusterMeta\(envKey, tenantKey, clusterNames\)/);
  // Payload sekli LogX/OpsX ile AYNI yardimcidan gelir — tek yerde tanimli.
  assert.match(TELNET, /require\('\.\.\/logx\/v2\/ocp\.cjs'\)\.buildOcpExtraVars/);
  assert.match(TELNET, /\.\.\.fanout,/, 'fanout extra_vars\'a yayilmali');
  // Jump server tanimsizsa is BASLATILMAZ — sessizce eksik cluster'la kosmaz.
  assert.match(TELNET, /Jump Server \(bastion\) tanımlı değil/);
});
