// server/opsx/__tests__/config-parse.test.cjs — config.cjs'in saf fonksiyonlari:
// parseExtraVarLines (admin "key: value" editoru) + normalizePlatform (admin ekranindan
// gelen YAML-benzeri metnin guvenli ayrismasi).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseExtraVarLines, DEFAULTS, KEY_FIELDS, CLUSTER_LIST_STYLES } = require('../config.cjs');

// ── parseExtraVarLines ────────────────────────────────────────────────────────
test('parseExtraVarLines: gecerli "key: value" satirlari nesneye cevrilir', () => {
  const { vars, rejected } = parseExtraVarLines('timeout: 120\nretries: 3');
  assert.deepEqual(vars, { timeout: '120', retries: '3' });
  assert.deepEqual(rejected, []);
});

test('parseExtraVarLines: bos/satirlar ve yorumlar ATLANIR', () => {
  const { vars, rejected } = parseExtraVarLines('\n  \n# bu yorum\nkey: value\n');
  assert.deepEqual(vars, { key: 'value' });
  assert.deepEqual(rejected, []);
});

test('parseExtraVarLines: iki nokta icermeyen satirlar REDDEDILIR', () => {
  const { vars, rejected } = parseExtraVarLines('gecersiz satir\nok: 1');
  assert.deepEqual(vars, { ok: '1' });
  assert.deepEqual(rejected, ['gecersiz satir']);
});

test('parseExtraVarLines: guvenli olmayan anahtar adlari REDDEDILIR (enjeksiyon onlemi)', () => {
  const { vars, rejected } = parseExtraVarLines(
    'key-with-dash: 1\n2starts_with_digit: 2\nvalid_key: 3',
  );
  assert.deepEqual(vars, { valid_key: '3' });
  assert.equal(rejected.length, 2, 'gecersiz anahtarlar rejected listesine dusmeli');
});

test('parseExtraVarLines: deger icinde iki nokta GECEBILIR (URL, saat, vb.)', () => {
  const { vars } = parseExtraVarLines('url: https://example.com:8080/path\ntime: 12:30:00');
  assert.equal(vars.url, 'https://example.com:8080/path');
  assert.equal(vars.time, '12:30:00');
});

test('parseExtraVarLines: null/undefined/boş girdi guvenli varsayilanlara duser', () => {
  assert.deepEqual(parseExtraVarLines(null), { vars: {}, rejected: [] });
  assert.deepEqual(parseExtraVarLines(undefined), { vars: {}, rejected: [] });
  assert.deepEqual(parseExtraVarLines(''), { vars: {}, rejected: [] });
});

test('parseExtraVarLines: bos deger GECERLI (key: "" seklinde)', () => {
  const { vars } = parseExtraVarLines('empty_val:');
  assert.equal(vars.empty_val, '');
});

test('parseExtraVarLines: deger basindaki/sonundaki bosluklar kirpilir', () => {
  const { vars } = parseExtraVarLines('key:   value with spaces   ');
  assert.equal(vars.key, 'value with spaces');
});

// ── DEFAULTS / KEY_FIELDS / CLUSTER_LIST_STYLES sabitleri ─────────────────────
test('DEFAULTS.legacy: zorunlu alan adlari eksiksiz', () => {
  assert.ok(DEFAULTS.legacy.applicationKey);
  assert.ok(DEFAULTS.legacy.operationKey);
  assert.ok(typeof DEFAULTS.legacy.extraVars === 'string');
  assert.ok(DEFAULTS.legacy.separator);
});

test('DEFAULTS.openshift: Telnet icin gereken alan adlari eksiksiz', () => {
  const required = [
    'terminalHostKey',
    'terminalHostsKey',
    'namespaceKey',
    'appNameKey',
    'clustersKey',
  ];
  for (const key of required) {
    assert.ok(DEFAULTS.openshift[key], `DEFAULTS.openshift.${key} eksik — Telnet kirilir`);
  }
});

test('KEY_FIELDS: legacy ve openshift platformlari tanimli', () => {
  assert.ok(Array.isArray(KEY_FIELDS.legacy));
  assert.ok(Array.isArray(KEY_FIELDS.openshift));
  assert.ok(KEY_FIELDS.legacy.length > 0);
  assert.ok(KEY_FIELDS.openshift.length > 0);
});

test('CLUSTER_LIST_STYLES: joined ve perCluster modlari tanimli', () => {
  assert.ok(CLUSTER_LIST_STYLES.includes('joined'));
  assert.ok(CLUSTER_LIST_STYLES.includes('perCluster'));
});

test('DEFAULTS nesnesi dondurulmustur (kazara ust duzey mutasyon onlenir)', () => {
  assert.ok(Object.isFrozen(DEFAULTS));
});
