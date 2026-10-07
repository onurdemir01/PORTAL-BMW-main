// server/retirement/__tests__/registry-seed.test.cjs — RS1..RS2 (2026-10-08).
//
// Kullanici: "rollback yapmak istedigimde template id kayitli olmasina ragmen 'AWX job
// template'i tanimli degil' hatasini aliyorum." Sebep: DELETE (2026-10-06) ve GERI AL
// (2026-10-07) adimlari eklendiginde Playbook Kayitlari'na TOHUM SATIRI eklenmemisti; yalniz
// `app_retirement_stop` vardi. Admin ekrandan elle satir acinca anahtar farkli yazilabiliyor
// ve Portal o satiri hic bulmuyordu. Ustelik hata uc farkli sebebi (satir yok / kapali /
// Template ID bos) TEK cumleyle soyluyordu.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const IDX = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
const SETUP = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'mssql-setup.cjs'), 'utf8');
const tohum = SETUP.slice(SETUP.indexOf('const PLAYBOOK_REGISTRY_SEED'), SETUP.indexOf('async function seedPlaybookRegistry'));

test('RS1 retirement kodunun kullandigi HER kayit anahtarinin tohum satiri var', () => {
  assert.ok(tohum.length > 1000, 'tohum listesi bulunamadi');
  // Anahtar sabitleri (..._REGISTRY_KEY = '...') + dogrudan getByKey('...') cagrilari
  const anahtarlar = new Set([
    ...[...IDX.matchAll(/REGISTRY_KEY = '([a-z0-9_]+)'/g)].map((m) => m[1]),
    ...[...IDX.matchAll(/getByKey\('([a-z0-9_]+)'\)/g)].map((m) => m[1]),
  ]);
  for (const k of ['app_retirement_stop', 'app_retirement_delete', 'app_retirement_rollback'])
    assert.ok(anahtarlar.has(k), `beklenen anahtar kodda yok: ${k} (bekci kendini dogrulayamiyor)`);
  for (const k of anahtarlar)
    assert.match(tohum, new RegExp(`key_name: '${k}'`), `"${k}" icin tohum satiri YOK - admin elle acmak zorunda kalir ve anahtari farkli yazabilir`);
});

test('RS2 "tanimli degil" hatasi UC sebebi AYRI soyler', () => {
  const fn = IDX.slice(IDX.indexOf('async function launch('), IDX.indexOf('const runner = require', IDX.indexOf('async function launch(')));
  assert.match(fn, /anahtarlı satır YOK/, 'satir yok durumu ayri soylenmiyor');
  assert.match(fn, /satırı KAPALI/, 'kapali satir durumu ayri soylenmiyor');
  assert.match(fn, /satırında Template ID boş/, 'bos Template ID durumu ayri soylenmiyor');
});
