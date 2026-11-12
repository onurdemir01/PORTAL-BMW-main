// server/__tests__/gcm-etiket.test.cjs — ortam ayari sifrelemesinde GCM etiket uzunlugu (2026-11-12).
//
// SAST bulgusu: createDecipheriv('aes-256-gcm') authTagLength'siz cagriliyordu; GCM kisaltilmis
// bir dogrulama etiketini (4 bayta kadar) kabul eder ve sahte bir degerin dogrulamayi tahminle
// gecme olasiligi buyur. Etiket 16 bayta sabitlendi.
//   GE1 sifrele -> coz gidis donus ayni deger; etiket 16 bayt
//   GE2 kisaltilmis etiket (4 / 12 bayt) reddedilir
//   GE3 degistirilmis sifreli metin reddedilir (GCM dogrulamasi)
//   GE4 kaynakta authTagLength iki tarafta da var
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

process.env.ENV_OVERRIDES_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
const { encryptSecretValue, decryptSecretValue } = require('../db/env-overrides.cjs');

const ON = 'enc:v1:';
const ac = (s) => JSON.parse(Buffer.from(s.slice(ON.length), 'base64').toString('utf8'));
const kapa = (p) => ON + Buffer.from(JSON.stringify(p)).toString('base64');

test('GE1 gidis donus ve 16 baytlik etiket', () => {
  const s = encryptSecretValue('gizli-deger-123');
  assert.ok(s.startsWith(ON));
  assert.equal(Buffer.from(ac(s).tag, 'base64').length, 16);
  assert.equal(decryptSecretValue(s), 'gizli-deger-123');
});

test('GE2 kisaltilmis etiket reddedilir', () => {
  const p = ac(encryptSecretValue('x'));
  for (const n of [4, 12]) {
    const kisa = { ...p, tag: Buffer.from(p.tag, 'base64').subarray(0, n).toString('base64') };
    assert.throws(
      () => decryptSecretValue(kapa(kisa)),
      /etiketi uzunlugu/,
      `${n} bayt kabul edildi`,
    );
  }
});

test('GE3 degistirilmis sifreli metin reddedilir', () => {
  const p = ac(encryptSecretValue('degismesin'));
  const b = Buffer.from(p.enc, 'base64');
  b[0] ^= 1;
  assert.throws(() => decryptSecretValue(kapa({ ...p, enc: b.toString('base64') })));
});

test('GE4 kaynakta authTagLength iki tarafta da', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'db', 'env-overrides.cjs'), 'utf8');
  assert.match(src, /createCipheriv\('aes-256-gcm', key, iv, \{ authTagLength: GCM_ETIKET \}\)/);
  assert.match(src, /createDecipheriv\('aes-256-gcm'[\s\S]{0,80}authTagLength: GCM_ETIKET/);
});
