// server/ansible/__tests__/ss-custom-history.test.cjs — SELF SERVIS AYARLARI KAYBOLMASIN.
//
// OLAY (2026-09-16): "Centric Certificates - Database Updater" servisinin Survey Tasarimcisi
// ayarlari kayboldu. Kod hicbir yerde satir SILMIYOR; kayip iki yoldan mumkundu:
//   (a) Admin ekrani ayarlari OKUYAMAYINCA (catch -> bos varsayilan) bos acilir, "Kaydet"
//       bos hali DB'ye yazar (tek satir, tek surum: geri donus yok).
//   (b) readCustom onbellegi yalniz boot'ta yukleniyordu; iki portal sureci (yasandi) ya da
//       baska bir yazar varken ekran ESKI hali gosterir, kaydet eski hali geri yazar.
// Bekci: gecmis tablosu + arsivleme, taze onbellek, okuma basarisizsa kaydetme kilidi.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
const codeOnly = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

test('SH1 her kayittan once onceki surum gecmise yazilir (tablo + arsiv + restore ucu)', () => {
  const schema = read('db/mssql-setup.cjs');
  assert.ok(schema.includes('CREATE TABLE ansible_ss_customizations_history'), 'gecmis tablosu yok');
  const src = codeOnly(read('ansible/runner.cjs'));
  assert.match(src, /async function writeCustom\(serverId, templateId, data, opts = \{\}\) \{\s*await archiveCustom\(/, 'writeCustom arsivlemeden yaziyor');
  assert.match(src, /INSERT INTO ansible_ss_customizations_history/, 'arsiv insert yok');
  assert.match(src, /'\/api\/ansible\/ss\/custom\/:serverId\/:templateId\/history'/, 'gecmis listesi ucu yok');
  assert.match(src, /'\/api\/ansible\/ss\/custom\/:serverId\/:templateId\/restore\/:historyId'/, 'geri yukleme ucu yok');
  assert.match(src, /auditPortal\(req, 'ss_custom_save'/, 'kayit denetim izine dusmuyor');
});

test('SH2 admin ekrani DB\'deki GUNCEL hali okur (onbellek tazelenir), okuma hatasi 400 (nginx HTML degil)', () => {
  const src = codeOnly(read('ansible/runner.cjs'));
  assert.match(src, /async function freshCustom\(/, 'taze okuma yok');
  assert.match(src, /customization: await freshCustom\(server\.id, req\.params\.templateId\)/, 'GET custom taze okumuyor (eski onbellek -> ezme)');
  assert.match(src, /_ssCustomLoadedAt = Date\.now\(\)/, 'onbellek yas damgasi yok');
  assert.doesNotMatch(src, /custom\/:serverId\/:templateId', requireAuth, requireAdmin, async \(req, res\) => \{\s*const server = getServerById\(req\.params\.serverId\);\s*if \(!server\) return res\.status\(404\)/, 'GET custom 404 donuyor - nginx HTML sayfasina cevirir, ekran bos acilir');
});

test('SH3 ekran: ayarlar okunamadiysa Kaydet KILITLI; gecmis paneli + geri yukleme', () => {
  const modal = codeOnly(read('../src/components/self_service/FieldOverridesModal.tsx'));
  assert.match(modal, /setLoadFailed\(true\)/, 'okuma hatasi isaretlenmiyor');
  assert.match(modal, /disabled=\{saving \|\| loadFailed\}/, 'Kaydet okuma hatasinda kilitlenmiyor (bos halle ezme yolu acik)');
  assert.match(modal, /ansibleApi\.customizationHistory\(/, 'gecmis listesi cekilmiyor');
  assert.match(modal, /ansibleApi\.restoreCustomization\(/, 'geri yukleme yok');
  assert.match(modal, /window\.confirm\(/, 'geri yukleme onaysiz');
});
